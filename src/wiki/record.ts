import { randomUUID } from "node:crypto";
import {
	cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync,
} from "node:fs";
import { dirname, join, posix, relative } from "node:path";
import { atomicWriteFile, atomicWriteJson } from "../shared/atomic-store.js";
import { CodepatrolError } from "../shared/errors.js";
import { withWorkspaceLock } from "../shared/lock.js";
import { hashFile } from "../shared/repo-files.js";
import { stateRoot, wikiManifestPath, wikiRoot } from "../shared/state.js";
import { resolveInside } from "../shared/workspace.js";
import { loadManifest } from "./manifest.js";
import { wikiStatus } from "./status.js";
import type { WikiManifest, WikiRecordFile, WikiRecordPayload } from "./types.js";
import { validateBundle } from "./validate.js";

interface TransactionMeta {
	phase: "staging" | "old-moved" | "bundle-promoted" | "committed";
	originalHadWiki: boolean;
	originalHadManifest: boolean;
}

export type WikiTransactionPhase = "staged" | "old-moved" | "bundle-promoted" | "manifest-written";

export interface WikiRecordHooks {
	afterPhase?: (phase: WikiTransactionPhase) => void;
}

function fail(message: string): never {
	throw new CodepatrolError("INVALID_ARGUMENT", message, 2);
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw new CodepatrolError("CANCELLED", "Operation cancelled.", 130, true);
}

function normalizeWikiPath(path: unknown): string {
	if (typeof path !== "string" || !path || path.includes("\\") || path.startsWith("/")) fail(`Invalid wiki path: ${String(path)}`);
	const normalized = posix.normalize(path);
	if (normalized === ".." || normalized.startsWith("../") || !normalized.endsWith(".md")) fail(`Wiki path must be a relative Markdown file: ${path}`);
	return normalized;
}

function parsePayload(input: unknown): WikiRecordPayload {
	if (!input || typeof input !== "object") fail("Wiki payload must be a JSON object.");
	const value = input as Partial<WikiRecordPayload>;
	if (value.version !== 1) fail("Wiki payload version must be 1.");
	if (value.mode !== "rewrite" && value.mode !== "incremental") fail("Wiki payload mode must be rewrite or incremental.");
	if (!Array.isArray(value.files) || value.files.length === 0) fail("Wiki payload files must be a non-empty array.");
	const seen = new Set<string>();
	const files: WikiRecordFile[] = value.files.map((file) => {
		if (!file || typeof file !== "object") fail("Each wiki file must be an object.");
		const path = normalizeWikiPath(file.path);
		if (seen.has(path)) fail(`Duplicate wiki path: ${path}`);
		seen.add(path);
		if (typeof file.content !== "string") fail(`Wiki content must be a string: ${path}`);
		if (file.sources !== undefined && (!Array.isArray(file.sources) || file.sources.some((source) => typeof source !== "string"))) {
			fail(`Wiki sources must be an array of paths: ${path}`);
		}
		if (!path.endsWith("/index.md") && path !== "index.md" && !path.endsWith("/log.md") && path !== "log.md" && file.sources === undefined) {
			fail(`Concept file must declare sources (an empty array is allowed): ${path}`);
		}
		return { path, content: file.content, ...(file.sources === undefined ? {} : { sources: [...new Set(file.sources)] }) };
	});
	const remove = (value.remove ?? []).map(normalizeWikiPath);
	if (remove.includes("index.md")) fail("The root index.md cannot be removed.");
	if (value.mode === "rewrite" && remove.length) fail("rewrite payload must not include remove entries.");
	if (value.updateAgentsPointer !== undefined && typeof value.updateAgentsPointer !== "boolean") fail("updateAgentsPointer must be boolean.");
	return { version: 1, mode: value.mode, files, remove, updateAgentsPointer: value.updateAgentsPointer };
}

function transactionRoot(workspace: string): string {
	return join(stateRoot(workspace), "wiki", "transactions");
}

function writeMeta(directory: string, meta: TransactionMeta): void {
	atomicWriteJson(join(directory, "transaction.json"), meta);
}

function readMeta(directory: string): TransactionMeta | undefined {
	try { return JSON.parse(readFileSync(join(directory, "transaction.json"), "utf8")) as TransactionMeta; } catch { return undefined; }
}

function recoverTransaction(workspace: string, directory: string): void {
	const meta = readMeta(directory);
	if (!meta) {
		rmSync(directory, { recursive: true, force: true });
		return;
	}
	if (meta.phase === "committed") {
		rmSync(directory, { recursive: true, force: true });
		return;
	}
	const live = wikiRoot(workspace);
	const backup = join(directory, "backup");
	const oldManifest = join(directory, "old-manifest.json");
	const promotionStarted = existsSync(backup) || meta.phase === "old-moved" || meta.phase === "bundle-promoted";
	if (promotionStarted) {
		if (existsSync(live)) rmSync(live, { recursive: true, force: true });
		if (existsSync(backup)) {
			mkdirSync(dirname(live), { recursive: true });
			renameSync(backup, live);
		}
		if (meta.originalHadManifest && existsSync(oldManifest)) {
			atomicWriteFile(wikiManifestPath(workspace), readFileSync(oldManifest, "utf8"));
		} else if (!meta.originalHadManifest && existsSync(wikiManifestPath(workspace))) {
			unlinkSync(wikiManifestPath(workspace));
		}
	}
	rmSync(directory, { recursive: true, force: true });
}

export function recoverWikiTransactions(workspace: string): void {
	const root = transactionRoot(workspace);
	if (!existsSync(root)) return;
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (entry.isDirectory()) recoverTransaction(workspace, join(root, entry.name));
	}
}

function writeBundleFile(stage: string, file: WikiRecordFile): void {
	const path = join(stage, ...file.path.split("/"));
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, file.content, "utf8");
}

function bundlePaths(root: string): string[] {
	if (!existsSync(root)) return [];
	const result: string[] = [];
	const visit = (directory: string): void => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) visit(path);
			else if (entry.isFile()) result.push(relative(root, path).split("\\").join("/"));
		}
	};
	visit(root);
	return result.sort();
}

function sourceHashes(workspace: string, sources: string[]): Record<string, string> {
	const result: Record<string, string> = {};
	const canonicalWorkspace = realpathSync(workspace);
	for (const source of sources) {
		const absolute = resolveInside(workspace, source, true);
		const normalized = relative(canonicalWorkspace, absolute).split("\\").join("/");
		result[normalized] = hashFile(absolute);
	}
	return result;
}

function conceptId(path: string): string {
	return path.slice(0, -3);
}

function isConcept(path: string): boolean {
	const name = posix.basename(path);
	return name !== "index.md" && name !== "log.md";
}

function updateAgentsPointer(workspace: string): "created" | "updated" | "unchanged" {
	const begin = "<!-- codepatrol:wiki:begin -->";
	const end = "<!-- codepatrol:wiki:end -->";
	const body = `${begin}\n## Project wiki\n\nStart at \`docs/wiki/index.md\`. Use \`codepatrol wiki status --format json\` before trusting freshness.\n${end}`;
	const path = join(workspace, "AGENTS.md");
	if (!existsSync(path)) {
		atomicWriteFile(path, `${body}\n`);
		return "created";
	}
	const current = readFileSync(path, "utf8");
	const start = current.indexOf(begin);
	const finish = current.indexOf(end);
	const next = start !== -1 && finish > start
		? current.slice(0, start) + body + current.slice(finish + end.length)
		: `${current.trimEnd()}\n\n${body}\n`;
	if (next === current) return "unchanged";
	atomicWriteFile(path, next);
	return "updated";
}

export interface WikiRecordResult {
	mode: "rewrite" | "incremental";
	written: string[];
	removed: string[];
	concepts: number;
	warnings: string[];
	text: string;
}

export async function wikiRecord(workspace: string, input: unknown, signal?: AbortSignal, hooks: WikiRecordHooks = {}): Promise<WikiRecordResult> {
	const payload = parsePayload(input);
	return withWorkspaceLock(workspace, "wiki", "wiki.record", async () => {
		throwIfAborted(signal);
		recoverWikiTransactions(workspace);
		if (payload.mode === "incremental") {
			const status = await wikiStatus(workspace);
			if (!status.exists || status.rewriteRequired) {
				throw new CodepatrolError("STATE_INCOMPATIBLE", "Incremental update requires a valid bundle and compatible manifest; use mode rewrite.", 4, false, status.reasons);
			}
		}

		const id = `${Date.now()}-${randomUUID()}`;
		const directory = join(transactionRoot(workspace), id);
		const stage = join(directory, "stage");
		const live = wikiRoot(workspace);
		const backup = join(directory, "backup");
		const previousPaths = bundlePaths(live);
		mkdirSync(stage, { recursive: true });
		const meta: TransactionMeta = {
			phase: "staging",
			originalHadWiki: existsSync(live),
			originalHadManifest: existsSync(wikiManifestPath(workspace)),
		};
		writeMeta(directory, meta);
		if (meta.originalHadManifest) atomicWriteFile(join(directory, "old-manifest.json"), readFileSync(wikiManifestPath(workspace), "utf8"));

		try {
			if (payload.mode === "incremental") cpSync(live, stage, { recursive: true });
			for (const file of payload.files) {
				throwIfAborted(signal);
				writeBundleFile(stage, file);
			}
			for (const path of payload.remove ?? []) rmSync(join(stage, ...path.split("/")), { force: true });

			throwIfAborted(signal);
			const validation = validateBundle(stage);
			if (!validation.valid) {
				throw new CodepatrolError("WIKI_INVALID", "Generated wiki bundle is not OKF v0.1 conformant.", 4, false, validation.errors);
			}

			const now = new Date().toISOString();
			const previous = payload.mode === "incremental" ? loadManifest(workspace)! : undefined;
			const manifest: WikiManifest = {
				version: 1,
				okfVersion: "0.1",
				generatedAt: now,
				pages: payload.mode === "incremental" ? structuredClone(previous?.pages ?? {}) : {},
			};
			for (const path of payload.remove ?? []) if (isConcept(path)) delete manifest.pages[conceptId(path)];
			for (const file of payload.files) {
				if (!isConcept(file.path)) continue;
				manifest.pages[conceptId(file.path)] = {
					path: file.path,
					sources: sourceHashes(workspace, file.sources ?? []),
					updatedAt: now,
				};
			}
			for (const concept of validation.concepts) {
				if (!manifest.pages[concept.id]) fail(`No source record supplied for concept: ${concept.path}`);
			}
			hooks.afterPhase?.("staged");

			throwIfAborted(signal);
			mkdirSync(dirname(live), { recursive: true });
			if (meta.originalHadWiki) renameSync(live, backup);
			meta.phase = "old-moved";
			writeMeta(directory, meta);
			hooks.afterPhase?.("old-moved");
			renameSync(stage, live);
			meta.phase = "bundle-promoted";
			writeMeta(directory, meta);
			hooks.afterPhase?.("bundle-promoted");
			throwIfAborted(signal);
			atomicWriteJson(wikiManifestPath(workspace), manifest);
			hooks.afterPhase?.("manifest-written");
			meta.phase = "committed";
			writeMeta(directory, meta);
			rmSync(directory, { recursive: true, force: true });

			const warnings = validation.warnings.map((issue) => `${issue.path}: ${issue.message}`);
			if (payload.updateAgentsPointer) {
				try { updateAgentsPointer(workspace); } catch (error) { warnings.push(`AGENTS.md pointer was not updated: ${error instanceof Error ? error.message : String(error)}`); }
			}
			const currentPaths = new Set(bundlePaths(live));
			const removed = previousPaths.filter((path) => !currentPaths.has(path));
			const result: WikiRecordResult = {
				mode: payload.mode,
				written: payload.files.map((file) => file.path),
				removed,
				concepts: validation.concepts.length,
				warnings,
				text: `Wiki ${payload.mode} committed — ${validation.concepts.length} concept(s), ${payload.files.length} file(s) written, ${removed.length} removed.`,
			};
			return result;
		} catch (error) {
			recoverTransaction(workspace, directory);
			throw error;
		}
	}, { signal });
}
