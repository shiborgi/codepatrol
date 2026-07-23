/**
 * Graph analysis: blast radius (reverse transitive closure), module
 * clustering (deterministic label propagation), entry-point detection, and
 * fan-in/fan-out ranking. Pure functions over a GraphSnapshot.
 */
import type { EdgeKind, GraphNode, GraphSnapshot } from "./model.js";
import { fileId } from "./model.js";

const IMPACT_KINDS: EdgeKind[] = ["imports", "calls", "inherits"];

export interface ImpactSeeds {
	files?: string[];
	symbols?: string[];
}

export interface ImpactOptions {
	includeAmbiguous?: boolean;
	maxDepth?: number;
}

export interface ImpactResult {
	/** Affected repo files → minimum depth from a seed (seeds excluded). */
	affectedFiles: Map<string, number>;
	/** Test files that exercise a seed or an affected file — the run list. */
	affectedTests: string[];
	/** Files reachable only over ambiguous edges (when those are excluded). */
	possiblyAffected: string[];
	/** Seeds that don't exist in the graph. */
	unknownSeeds: string[];
}

export function impact(
	snapshot: GraphSnapshot,
	seeds: ImpactSeeds,
	options: ImpactOptions = {},
): ImpactResult {
	const maxDepth = options.maxDepth ?? Number.POSITIVE_INFINITY;
	const seedFiles = new Set<string>();
	const unknownSeeds: string[] = [];
	const queue: Array<{ id: string; depth: number }> = [];
	const visited = new Map<string, number>();

	const enqueue = (id: string, depth: number) => {
		const known = visited.get(id);
		if (known !== undefined && known <= depth) return;
		visited.set(id, depth);
		queue.push({ id, depth });
	};

	for (const path of seeds.files ?? []) {
		const node = snapshot.fileNode(path);
		if (!node) {
			unknownSeeds.push(path);
			continue;
		}
		seedFiles.add(path);
		enqueue(node.id, 0);
		for (const symbol of snapshot.symbolsInFile(path)) enqueue(symbol.id, 0);
	}
	for (const id of seeds.symbols ?? []) {
		const node = snapshot.node(id);
		if (!node) {
			unknownSeeds.push(id);
			continue;
		}
		if (node.file) seedFiles.add(node.file);
		enqueue(id, 0);
	}

	const affectedFiles = new Map<string, number>();
	const ambiguousBlocked = new Set<string>();

	const markAffected = (node: GraphNode, depth: number) => {
		if (!node.file || seedFiles.has(node.file)) return;
		const known = affectedFiles.get(node.file);
		if (known === undefined || depth < known) affectedFiles.set(node.file, depth);
	};

	for (let i = 0; i < queue.length; i++) {
		const { id, depth } = queue[i];
		if (depth >= maxDepth) continue;
		const node = snapshot.node(id);
		if (!node) continue;
		// A reached symbol makes its whole file affected: anything importing
		// that file is affected one step later.
		if (node.kind !== "file" && node.file && !seedFiles.has(node.file)) {
			enqueue(fileId(node.file), depth);
		}
		for (const edge of snapshot.inEdges(id, IMPACT_KINDS)) {
			const dependent = snapshot.node(edge.from);
			if (!dependent) continue;
			if (edge.confidence === "ambiguous" && !options.includeAmbiguous) {
				if (dependent.file && !seedFiles.has(dependent.file)) ambiguousBlocked.add(dependent.file);
				continue;
			}
			markAffected(dependent, depth + 1);
			enqueue(edge.from, depth + 1);
		}
	}

	const affectedTests = new Set<string>();
	for (const [path] of affectedFiles) {
		const node = snapshot.fileNode(path);
		if (node?.isTest) affectedTests.add(path);
	}
	for (const path of [...seedFiles, ...affectedFiles.keys()]) {
		for (const edge of snapshot.inEdges(fileId(path), ["tests"])) {
			const tester = snapshot.node(edge.from);
			if (tester?.file) affectedTests.add(tester.file);
		}
	}

	const possiblyAffected = [...ambiguousBlocked].filter((f) => !affectedFiles.has(f)).sort();
	return { affectedFiles, affectedTests: [...affectedTests].sort(), possiblyAffected, unknownSeeds };
}

export interface Cluster {
	id: number;
	label: string;
	files: string[];
}

/**
 * Deterministic label propagation over the undirected file-import graph.
 * Files are processed in sorted order; each adopts its neighbors' most common
 * label (lexicographically smallest on ties) until a fixed point or the
 * iteration cap.
 */
export function clusterFiles(snapshot: GraphSnapshot): Cluster[] {
	const files = snapshot.files();
	const neighbors = new Map<string, string[]>();
	for (const path of files) {
		neighbors.set(path, [...snapshot.importsOf(path), ...snapshot.importersOf(path)]);
	}

	// Directory-seeded labels: files start in their directory's community and
	// only migrate when import coupling to another community dominates.
	const labels = new Map<string, string>(
		files.map((f) => [f, f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : "."]),
	);
	for (let iteration = 0; iteration < 10; iteration++) {
		let changed = false;
		for (const path of files) {
			const counts = new Map<string, number>();
			for (const neighbor of neighbors.get(path) ?? []) {
				const label = labels.get(neighbor)!;
				counts.set(label, (counts.get(label) ?? 0) + 1);
			}
			if (counts.size === 0) continue;
			let best = labels.get(path)!;
			let bestCount = 0;
			for (const [label, count] of counts) {
				if (count > bestCount || (count === bestCount && label < best)) {
					best = label;
					bestCount = count;
				}
			}
			if (best !== labels.get(path)) {
				labels.set(path, best);
				changed = true;
			}
		}
		if (!changed) break;
	}

	const groups = new Map<string, string[]>();
	for (const path of files) {
		const label = labels.get(path)!;
		(groups.get(label) ?? groups.set(label, []).get(label)!).push(path);
	}

	const clusters = [...groups.values()]
		.map((members) => members.sort())
		.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
	return clusters.map((members, id) => ({ id, label: clusterLabel(members), files: members }));
}

function clusterLabel(members: string[]): string {
	const counts = new Map<string, number>();
	for (const path of members) {
		const dir = path.includes("/") ? path.slice(0, path.indexOf("/")) : ".";
		counts.set(dir, (counts.get(dir) ?? 0) + 1);
	}
	let best = ".";
	let bestCount = 0;
	for (const [dir, count] of counts) {
		if (count > bestCount || (count === bestCount && dir < best)) {
			best = dir;
			bestCount = count;
		}
	}
	// When one directory dominates, name the cluster after it; otherwise after
	// its most representative file.
	return best !== "." ? best : members[0];
}

const ENTRY_NAME = /(^|\/)(main|index|cli|app|server|bin|__main__)\.[^.]+$/;

export interface EntryPoint {
	file: string;
	reason: string;
}

export function entryPoints(snapshot: GraphSnapshot): EntryPoint[] {
	const entries: EntryPoint[] = [];
	for (const path of snapshot.files()) {
		const node = snapshot.fileNode(path);
		if (node?.isTest) continue;
		const productionImporters = snapshot.importersOf(path).filter((importer) => snapshot.fileNode(importer)?.isTest !== true);
		if (productionImporters.length > 0) continue;
		const nameMatch = ENTRY_NAME.exec(path);
		entries.push({
			file: path,
			reason: nameMatch ? `no production importers; entry-point name (${nameMatch[2]})` : "no production importers",
		});
	}
	return entries;
}

export interface FanCount {
	file: string;
	count: number;
}

export function topFanIn(snapshot: GraphSnapshot, limit: number): FanCount[] {
	return rank(snapshot, limit, (path) => snapshot.importersOf(path).length);
}

export function topFanOut(snapshot: GraphSnapshot, limit: number): FanCount[] {
	return rank(snapshot, limit, (path) => snapshot.importsOf(path).length);
}

function rank(snapshot: GraphSnapshot, limit: number, count: (path: string) => number): FanCount[] {
	return snapshot
		.files()
		.map((file) => ({ file, count: count(file) }))
		.filter((entry) => entry.count > 0)
		.sort((a, b) => b.count - a.count || a.file.localeCompare(b.file))
		.slice(0, limit);
}
