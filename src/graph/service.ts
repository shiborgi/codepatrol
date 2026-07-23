import { execFileSync } from "node:child_process";
import { clusterFiles, entryPoints, impact, topFanIn, topFanOut, type Cluster } from "./analysis.js";
import type { Confidence, GraphNode, GraphSnapshot, GraphStats } from "./model.js";
import { fileId } from "./model.js";
import { graphPath, openSnapshot, syncGraph, type SyncReport } from "./store.js";
import { CodepatrolError } from "../shared/errors.js";
import { withWorkspaceLock } from "../shared/lock.js";

export interface ClusterEdge { from: number; to: number; count: number }
export interface OrientationFile {
	file: string;
	symbols: number;
	exported: number;
	fanIn: number;
	fanOut: number;
	isTest: boolean;
}

export interface GraphOverviewData {
	stats: GraphStats;
	path?: string;
	files?: OrientationFile[];
	clusters?: Cluster[];
	clusterEdges?: ClusterEdge[];
	entryPoints?: ReturnType<typeof entryPoints>;
	topFanIn?: ReturnType<typeof topFanIn>;
	topFanOut?: ReturnType<typeof topFanOut>;
}

export interface OutlineFile {
	file: string;
	exported: GraphNode[];
	internal: GraphNode[];
}

export type Relation = "callers" | "callees" | "importers" | "imports" | "inheritors" | "tests";
export const RELATIONS: Relation[] = ["callers", "callees", "importers", "imports", "inheritors", "tests"];

export interface RelatedNode {
	id: string;
	name: string;
	file?: string;
	line?: number;
	confidence?: Confidence;
}

export interface SymbolNeighbors {
	symbol: GraphNode;
	callers?: RelatedNode[];
	callees?: RelatedNode[];
	inheritors?: RelatedNode[];
}

export interface FileNeighbors {
	file: string;
	importers?: string[];
	imports?: string[];
	tests?: string[];
}

export interface GraphNeighborsData {
	symbols: SymbolNeighbors[];
	file?: FileNeighbors;
}

async function requireSnapshot(workspace: string): Promise<GraphSnapshot> {
	const snapshot = await openSnapshot(workspace);
	if (!snapshot) {
		throw new CodepatrolError("GRAPH_NOT_FOUND", "Run codepatrol graph sync first.", 4, true);
	}
	return snapshot;
}

export async function graphSync(
	workspace: string,
	options: { force?: boolean; signal?: AbortSignal } = {},
): Promise<{ path: string; report: SyncReport }> {
	return withWorkspaceLock(workspace, "graph", "graph.sync", async () => {
		const { report } = await syncGraph(workspace, { force: options.force, signal: options.signal });
		return { path: graphPath(workspace), report };
	}, { signal: options.signal });
}

function interClusterEdges(snapshot: GraphSnapshot, clusters: Cluster[]): ClusterEdge[] {
	const clusterOf = new Map<string, number>();
	for (const cluster of clusters) for (const file of cluster.files) clusterOf.set(file, cluster.id);
	const counts = new Map<string, number>();
	for (const path of snapshot.files()) {
		const from = clusterOf.get(path);
		if (from === undefined) continue;
		for (const target of snapshot.importsOf(path)) {
			const to = clusterOf.get(target);
			if (to === undefined || to === from) continue;
			const key = `${from}:${to}`;
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
	}
	return [...counts.entries()].map(([key, count]) => {
		const [from, to] = key.split(":").map(Number);
		return { from, to, count };
	});
}

export async function graphOverview(workspace: string, path?: string): Promise<GraphOverviewData> {
	const snapshot = await requireSnapshot(workspace);
	const stats = snapshot.stats();
	if (path) {
		const prefix = path.endsWith("/") ? path : `${path}/`;
		const paths = snapshot.files().filter((file) => file === path || file.startsWith(prefix));
		return {
			stats,
			path,
			files: paths.map((file) => {
				const symbols = snapshot.symbolsInFile(file);
				return {
					file,
					symbols: symbols.length,
					exported: symbols.filter((symbol) => symbol.exported).length,
					fanIn: snapshot.importersOf(file).length,
					fanOut: snapshot.importsOf(file).length,
					isTest: snapshot.fileNode(file)?.isTest === true,
				};
			}),
		};
	}
	const clusters = clusterFiles(snapshot);
	return {
		stats,
		clusters,
		clusterEdges: interClusterEdges(snapshot, clusters),
		entryPoints: entryPoints(snapshot),
		topFanIn: topFanIn(snapshot, 8),
		topFanOut: topFanOut(snapshot, 8),
	};
}

export async function graphOutline(workspace: string, path: string): Promise<OutlineFile[]> {
	const snapshot = await requireSnapshot(workspace);
	const prefix = path.endsWith("/") ? path : `${path}/`;
	return snapshot.files()
		.filter((file) => file === path || file.startsWith(prefix))
		.map((file) => {
			const symbols = snapshot.symbolsInFile(file).slice().sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
			return { file, exported: symbols.filter((symbol) => symbol.exported), internal: symbols.filter((symbol) => !symbol.exported) };
		});
}

export async function graphFind(workspace: string, query: string, exact = false): Promise<GraphNode[]> {
	const snapshot = await requireSnapshot(workspace);
	const lowered = query.toLowerCase();
	const matches: GraphNode[] = [];
	for (const node of snapshot.nodes()) {
		if (node.kind === "file" || node.kind === "external") continue;
		if (exact ? node.name === query : node.name.toLowerCase().includes(lowered)) matches.push(node);
		if (matches.length === 50) break;
	}
	return matches;
}

function related(snapshot: GraphSnapshot, edges: ReturnType<GraphSnapshot["inEdges"]>, direction: "from" | "to"): RelatedNode[] {
	return edges.flatMap((edge) => {
		const node = snapshot.node(edge[direction]);
		return node ? [{ id: node.id, name: node.name, file: node.file, line: node.line, confidence: edge.confidence }] : [];
	});
}

export async function graphNeighbors(
	workspace: string,
	options: { symbol?: string; file?: string; relations?: Relation[] },
): Promise<GraphNeighborsData> {
	const snapshot = await requireSnapshot(workspace);
	const wanted = new Set(options.relations?.length ? options.relations : RELATIONS);
	const symbols: SymbolNeighbors[] = [];
	if (options.symbol) {
		const targets = options.symbol.startsWith("sym:")
			? [snapshot.node(options.symbol)].filter((node): node is GraphNode => node !== undefined)
			: snapshot.symbolsByName(options.symbol);
		for (const symbol of targets.slice(0, 3)) {
			const item: SymbolNeighbors = { symbol };
			if (wanted.has("callers")) item.callers = related(snapshot, snapshot.inEdges(symbol.id, ["calls"]), "from");
			if (wanted.has("callees")) item.callees = related(snapshot, snapshot.outEdges(symbol.id, ["calls"]), "to");
			if (wanted.has("inheritors")) item.inheritors = related(snapshot, snapshot.inEdges(symbol.id, ["inherits"]), "from");
			symbols.push(item);
		}
	}
	let file: FileNeighbors | undefined;
	if (options.file) {
		file = { file: options.file };
		if (wanted.has("importers")) file.importers = snapshot.importersOf(options.file);
		if (wanted.has("imports")) file.imports = snapshot.importsOf(options.file);
		if (wanted.has("tests")) {
			file.tests = snapshot.inEdges(fileId(options.file), ["tests"])
				.flatMap((edge) => snapshot.node(edge.from)?.file ?? []);
		}
	}
	return { symbols, file };
}

export interface GraphImpactData {
	seeds: { files: string[]; symbols: string[]; sinceRef?: string };
	affected: Array<{ file: string; depth: number }>;
	affectedTests: string[];
	possiblyAffected: string[];
	unknownSeeds: string[];
}

export async function graphImpact(
	workspace: string,
	options: { files?: string[]; symbols?: string[]; sinceRef?: string; includeAmbiguous?: boolean },
): Promise<GraphImpactData> {
	const snapshot = await requireSnapshot(workspace);
	const files = [...(options.files ?? [])];
	let symbols = [...(options.symbols ?? [])];
	if (options.sinceRef) {
		try {
			const output = execFileSync("git", ["diff", "--name-only", options.sinceRef], {
				cwd: workspace, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
			});
			files.push(...output.split("\n").filter(Boolean));
		} catch {
			throw new CodepatrolError("INVALID_ARGUMENT", `git diff failed for ref: ${options.sinceRef}`, 2);
		}
	}
	symbols = symbols.flatMap((symbol) => symbol.startsWith("sym:")
		? [symbol]
		: snapshot.symbolsByName(symbol).map((node) => node.id));
	const result = impact(snapshot, { files, symbols }, { includeAmbiguous: options.includeAmbiguous });
	return {
		seeds: { files, symbols, sinceRef: options.sinceRef },
		affected: [...result.affectedFiles.entries()]
			.map(([file, depth]) => ({ file, depth }))
			.sort((a, b) => a.depth - b.depth || a.file.localeCompare(b.file)),
		affectedTests: result.affectedTests,
		possiblyAffected: result.possiblyAffected,
		unknownSeeds: result.unknownSeeds,
	};
}
