/**
 * GraphStore: the persistent, incremental home of the code graph.
 *
 * `.codepatrol/code-graph/graph.json` (inside the analyzed repo) holds per-file
 * extraction keyed by content hash — the expensive tree-sitter work. Sync
 * re-extracts only files whose hash changed, prunes deleted ones, then links
 * the whole document in memory. Snapshots are memoized per root by document
 * hash, so parallel readers and repeat CLI calls pay the
 * JSON parse once.
 */
import { readFileSync } from "node:fs";
import { setImmediate as yieldToLoop } from "node:timers/promises";
import { join } from "node:path";
import { atomicWriteFile, atomicWriteJson } from "../shared/atomic-store.js";
import { hashContent, hashFile, listFiles } from "../shared/repo-files.js";
import { graphStatePath, legacyGraphPath, STATE_VERSION, stateRoot } from "../shared/state.js";
import { extractFile } from "./extract.js";
import { languageForFile } from "./languages.js";
import { link, loadTsPaths } from "./link.js";
import type { GraphDocument, GraphSnapshot, GraphStats } from "./model.js";
import { emptyDocument } from "./model.js";

export interface SyncReport {
	scanned: number;
	extracted: number;
	unchanged: number;
	removed: number;
	durationMs: number;
	stats: GraphStats;
}

export interface SyncOptions {
	force?: boolean;
	onProgress?: (done: number, total: number) => void;
	signal?: AbortSignal;
}

export function graphPath(root: string): string {
	return graphStatePath(root);
}

const YIELD_EVERY = 25;

const memo = new Map<string, { docHash: string; snapshot: GraphSnapshot }>();

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) {
		const error = new Error("Operation cancelled.");
		error.name = "AbortError";
		throw error;
	}
}

function loadAt(path: string): { document: GraphDocument; raw: string } | undefined {
	let raw: string;
	try {
		raw = readFileSync(path, "utf8");
	} catch {
		return undefined;
	}
	try {
		const document = JSON.parse(raw) as GraphDocument;
		if (document?.version !== 1 || typeof document.files !== "object") return undefined;
		return { document, raw };
	} catch {
		return undefined; // corrupt — caller rebuilds from scratch
	}
}

function loadDocument(root: string): { document: GraphDocument; raw: string; legacy: boolean } | undefined {
	const current = loadAt(graphPath(root));
	if (current) return { ...current, legacy: false };
	const legacy = loadAt(legacyGraphPath(root));
	return legacy ? { ...legacy, legacy: true } : undefined;
}

function memoizedLink(root: string, document: GraphDocument, raw: string): GraphSnapshot {
	const docHash = hashContent(raw);
	const cached = memo.get(root);
	if (cached && cached.docHash === docHash) return cached.snapshot;
	const snapshot = link(document, loadTsPaths(root));
	memo.set(root, { docHash, snapshot });
	return snapshot;
}

export async function syncGraph(
	root: string,
	options: SyncOptions = {},
): Promise<{ report: SyncReport; snapshot: GraphSnapshot }> {
	throwIfAborted(options.signal);
	const started = Date.now();
	const loaded = options.force ? undefined : loadDocument(root);
	const previous = loaded?.document;
	const document: GraphDocument = previous ?? emptyDocument();
	document.builtAt = new Date().toISOString();

	const current = listFiles(root).filter((file) => languageForFile(file));
	const currentSet = new Set(current);

	let removed = 0;
	for (const path of Object.keys(document.files)) {
		if (!currentSet.has(path)) {
			delete document.files[path];
			removed++;
		}
	}

	let extracted = 0;
	let unchanged = 0;
	for (let i = 0; i < current.length; i++) {
		throwIfAborted(options.signal);
		const path = current[i];
		let hash: string;
		try {
			hash = hashFile(join(root, path));
		} catch {
			continue; // unreadable (racing delete, permissions) — skip this round
		}
		const existing = document.files[path];
		if (existing && existing.hash === hash) {
			unchanged++;
		} else {
			const extract = await extractFile(join(root, path));
			if (!extract) continue;
			document.files[path] = { hash, ...extract };
			extracted++;
		}
		options.onProgress?.(i + 1, current.length);
		if ((i + 1) % YIELD_EVERY === 0) await yieldToLoop();
	}

	throwIfAborted(options.signal);
	const raw = JSON.stringify(document);
	atomicWriteFile(graphPath(root), raw);
	atomicWriteJson(join(stateRoot(root), "version.json"), {
		version: STATE_VERSION,
		updatedAt: new Date().toISOString(),
		graphMigratedFromLegacy: loaded?.legacy === true,
	});

	const snapshot = memoizedLink(root, document, raw);
	return {
		report: {
			scanned: current.length,
			extracted,
			unchanged,
			removed,
			durationMs: Date.now() - started,
			stats: snapshot.stats(),
		},
		snapshot,
	};
}

/** Load and link the persisted graph without any extraction. */
export async function openSnapshot(root: string): Promise<GraphSnapshot | undefined> {
	const loaded = loadDocument(root);
	if (!loaded) return undefined;
	return memoizedLink(root, loaded.document, loaded.raw);
}
