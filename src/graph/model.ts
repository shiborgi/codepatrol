/**
 * Graph vocabulary: node/edge types, the persisted document schema, and the
 * read-only GraphSnapshot every consumer sees. Tools and analysis never touch
 * raw maps — they go through the snapshot interface built here.
 */
import type { LanguageId } from "./languages.js";
import type { FileExtract } from "./extract.js";

export type Confidence = "extracted" | "inferred" | "ambiguous";

export type NodeKind = "file" | "function" | "method" | "class" | "interface" | "type" | "const" | "external";

export interface GraphNode {
	id: string;
	kind: NodeKind;
	name: string;
	/** Repo-relative path; absent for external nodes. */
	file?: string;
	line?: number;
	endLine?: number;
	exported?: boolean;
	isTest?: boolean;
}

export type EdgeKind = "imports" | "calls" | "inherits" | "tests";

export interface GraphEdge {
	from: string;
	to: string;
	kind: EdgeKind;
	confidence: Confidence;
	line?: number;
}

export interface GraphStats {
	files: number;
	symbols: number;
	edgesByKind: Record<EdgeKind, number>;
	edgesByConfidence: Record<Confidence, number>;
	droppedAmbiguousCalls: number;
}

/** Persisted per-file extraction; cross-file links are recomputed on load. */
export interface FileRecord extends FileExtract {
	hash: string;
	language: LanguageId;
}

export interface GraphDocument {
	version: 1;
	builtAt: string;
	files: Record<string, FileRecord>;
}

export function emptyDocument(): GraphDocument {
	return { version: 1, builtAt: new Date().toISOString(), files: {} };
}

export function fileId(path: string): string {
	return `file:${path}`;
}

export function symbolId(path: string, name: string, line: number): string {
	return `sym:${path}#${name}@${line}`;
}

export function externalId(name: string): string {
	return `ext:${name}`;
}

export interface GraphSnapshot {
	files(): string[];
	node(id: string): GraphNode | undefined;
	fileNode(path: string): GraphNode | undefined;
	nodes(): Iterable<GraphNode>;
	symbolsByName(name: string): GraphNode[];
	symbolsInFile(path: string): GraphNode[];
	outEdges(id: string, kinds?: EdgeKind[]): GraphEdge[];
	inEdges(id: string, kinds?: EdgeKind[]): GraphEdge[];
	/** Repo files importing `path` (file-level, resolved edges only). */
	importersOf(path: string): string[];
	/** Repo files `path` imports (file-level, resolved edges only). */
	importsOf(path: string): string[];
	stats(): GraphStats;
}

export function createSnapshot(
	nodes: GraphNode[],
	edges: GraphEdge[],
	droppedAmbiguousCalls: number,
): GraphSnapshot {
	const byId = new Map<string, GraphNode>();
	const byName = new Map<string, GraphNode[]>();
	const byFile = new Map<string, GraphNode[]>();
	const filePaths: string[] = [];
	for (const node of nodes) {
		byId.set(node.id, node);
		if (node.kind === "file") {
			filePaths.push(node.file!);
			continue;
		}
		if (node.kind === "external") continue;
		const names = byName.get(node.name) ?? [];
		names.push(node);
		byName.set(node.name, names);
		const inFile = byFile.get(node.file!) ?? [];
		inFile.push(node);
		byFile.set(node.file!, inFile);
	}

	const out = new Map<string, GraphEdge[]>();
	const incoming = new Map<string, GraphEdge[]>();
	for (const edge of edges) {
		(out.get(edge.from) ?? out.set(edge.from, []).get(edge.from)!).push(edge);
		(incoming.get(edge.to) ?? incoming.set(edge.to, []).get(edge.to)!).push(edge);
	}

	const filtered = (list: GraphEdge[] | undefined, kinds?: EdgeKind[]): GraphEdge[] => {
		if (!list) return [];
		return kinds ? list.filter((e) => kinds.includes(e.kind)) : [...list];
	};

	const fileNeighbors = (path: string, direction: "in" | "out"): string[] => {
		const id = fileId(path);
		const list = direction === "out" ? out.get(id) : incoming.get(id);
		const result: string[] = [];
		for (const edge of list ?? []) {
			if (edge.kind !== "imports") continue;
			const other = byId.get(direction === "out" ? edge.to : edge.from);
			if (other?.kind === "file") result.push(other.file!);
		}
		return [...new Set(result)].sort();
	};

	return {
		files: () => [...filePaths].sort(),
		node: (id) => byId.get(id),
		fileNode: (path) => byId.get(fileId(path)),
		nodes: () => byId.values(),
		symbolsByName: (name) => byName.get(name) ?? [],
		symbolsInFile: (path) => byFile.get(path) ?? [],
		outEdges: (id, kinds) => filtered(out.get(id), kinds),
		inEdges: (id, kinds) => filtered(incoming.get(id), kinds),
		importersOf: (path) => fileNeighbors(path, "in"),
		importsOf: (path) => fileNeighbors(path, "out"),
		stats: () => {
			const edgesByKind: Record<EdgeKind, number> = { imports: 0, calls: 0, inherits: 0, tests: 0 };
			const edgesByConfidence: Record<Confidence, number> = { extracted: 0, inferred: 0, ambiguous: 0 };
			for (const edge of edges) {
				edgesByKind[edge.kind]++;
				edgesByConfidence[edge.confidence]++;
			}
			let symbols = 0;
			for (const list of byFile.values()) symbols += list.length;
			return { files: filePaths.length, symbols, edgesByKind, edgesByConfidence, droppedAmbiguousCalls };
		},
	};
}
