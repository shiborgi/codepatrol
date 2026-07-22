import { posix } from "node:path";
import { clusterFiles, entryPoints, type Cluster } from "../graph/analysis.js";
import type { GraphNode, GraphSnapshot } from "../graph/model.js";
import { openSnapshot } from "../graph/store.js";
import { CodepatrolError } from "../shared/errors.js";
import { wikiRecord, type WikiRecordResult } from "./record.js";
import type { WikiRecordFile, WikiRecordPayload } from "./types.js";

export interface WikiGenerateOptions {
	now?: Date;
	signal?: AbortSignal;
	updateAgentsPointer?: boolean;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw new CodepatrolError("CANCELLED", "Operation cancelled.", 130, true);
}

function scalar(value: string): string {
	return JSON.stringify(value);
}

function frontmatter(fields: Record<string, string | string[]>): string {
	const lines = ["---"];
	for (const [key, value] of Object.entries(fields)) {
		if (Array.isArray(value)) {
			lines.push(`${key}:`, ...value.map((item) => `  - ${scalar(item)}`));
		} else {
			lines.push(`${key}: ${scalar(value)}`);
		}
	}
	return `${lines.join("\n")}\n---\n`;
}

function code(value: string): string {
	return `\`${value.replaceAll("`", "\\`")}\``;
}

function slug(value: string, fallback: string): string {
	const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
	return normalized || fallback;
}

function title(value: string): string {
	return value
		.split(/[\\/_-]+/)
		.filter(Boolean)
		.map((part) => part[0]?.toUpperCase() + part.slice(1))
		.join(" ") || "Root";
}

function list(items: string[], empty: string): string {
	return items.length ? items.map((item) => `- ${item}`).join("\n") : `- ${empty}`;
}

function citations(paths: string[]): string {
	return [...new Set(paths)].sort().map((path, index) => `[${index + 1}] ${code(`${path}:1`)}`).join("\n");
}

function moduleFile(cluster: Cluster): string {
	return `cluster-${String(cluster.id + 1).padStart(2, "0")}-${slug(cluster.label, "module")}.md`;
}

function clusterMap(clusters: Cluster[]): Map<string, Cluster> {
	const result = new Map<string, Cluster>();
	for (const cluster of clusters) for (const path of cluster.files) result.set(path, cluster);
	return result;
}

function interClusterDependencies(snapshot: GraphSnapshot, clusters: Cluster[]): string[] {
	const membership = clusterMap(clusters);
	const counts = new Map<string, number>();
	for (const source of snapshot.files()) {
		const from = membership.get(source);
		if (!from) continue;
		for (const target of snapshot.importsOf(source)) {
			const to = membership.get(target);
			if (!to || from.id === to.id) continue;
			const key = `${from.id}:${to.id}`;
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
	}
	return [...counts.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, count]) => {
			const [from, to] = key.split(":").map(Number);
			return `${title(clusters[from].label)} → ${title(clusters[to].label)} (${count} import${count === 1 ? "" : "s"})`;
		});
}

function exportedSymbols(snapshot: GraphSnapshot, files: string[]): GraphNode[] {
	return files
		.flatMap((path) => snapshot.symbolsInFile(path))
		.filter((symbol) => symbol.exported)
		.sort((left, right) => (left.file ?? "").localeCompare(right.file ?? "") || (left.line ?? 0) - (right.line ?? 0));
}

const MAX_RENDERED_INTERFACES = 25;

function interfaceItems(symbols: GraphNode[]): string[] {
	const visible = symbols.slice(0, MAX_RENDERED_INTERFACES).map(
		(symbol) => `${code(symbol.name)} — ${symbol.kind} at ${code(`${symbol.file}:${symbol.line ?? 1}`)}`,
	);
	const omitted = symbols.length - visible.length;
	if (omitted > 0) visible.push(`${omitted} additional exported symbol${omitted === 1 ? "" : "s"} omitted; query the graph for the complete surface.`);
	return visible;
}

function modulePage(snapshot: GraphSnapshot, cluster: Cluster, clusters: Cluster[], timestamp: string): WikiRecordFile {
	const membership = clusterMap(clusters);
	const outgoing = new Map<string, number>();
	for (const source of cluster.files) {
		for (const target of snapshot.importsOf(source)) {
			const targetCluster = membership.get(target);
			if (!targetCluster || targetCluster.id === cluster.id) continue;
			outgoing.set(targetCluster.label, (outgoing.get(targetCluster.label) ?? 0) + 1);
		}
	}
	const symbols = exportedSymbols(snapshot, cluster.files);
	const tests = cluster.files.filter((path) => snapshot.fileNode(path)?.isTest);
	const moduleTitle = title(cluster.label);
	const body = [
		frontmatter({
			type: "Software Module",
			title: moduleTitle,
			description: `Graph cluster containing ${cluster.files.length} source file${cluster.files.length === 1 ? "" : "s"}.`,
			resource: cluster.files[0],
			tags: ["architecture", "graph-cluster"],
			timestamp,
		}),
		`# ${moduleTitle}`,
		"",
		"## Files",
		"",
		list(cluster.files.map(code), "No source files detected."),
		"",
		"## Interfaces",
		"",
		list(interfaceItems(symbols), "No exported symbols detected."),
		"",
		"## Dependencies",
		"",
		list([...outgoing.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([label, count]) => `${title(label)} (${count} import${count === 1 ? "" : "s"})`), "No dependencies on other architectural modules."),
		"",
		"## Tests",
		"",
		list(tests.map(code), "No test file was identified inside this cluster."),
		"",
		"# Citations",
		"",
		citations(cluster.files),
		"",
	].join("\n");
	return { path: posix.join("modules", moduleFile(cluster)), content: body, sources: cluster.files };
}

function buildPayload(snapshot: GraphSnapshot, timestamp: string, updateAgentsPointer: boolean): WikiRecordPayload {
	const clusters = clusterFiles(snapshot);
	const entries = entryPoints(snapshot);
	const files = snapshot.files();
	const tests = files.filter((path) => snapshot.fileNode(path)?.isTest);
	const modulePages = clusters.map((cluster) => modulePage(snapshot, cluster, clusters, timestamp));
	const moduleLinks = clusters.map((cluster) => `[${title(cluster.label)}](modules/${moduleFile(cluster)}) — ${cluster.files.length} source file${cluster.files.length === 1 ? "" : "s"}.`);
	const dependencies = interClusterDependencies(snapshot, clusters);
	const architectureCitations = [
		...files.filter((path) => snapshot.fileNode(path)?.isTest !== true),
		...tests,
	];
	const architecture = [
		frontmatter({
			type: "Software Architecture",
			title: "Architecture",
			description: "Graph-backed map of entry points, architectural modules, dependencies, and tests.",
			resource: ".codepatrol/runtime/graph/graph.json",
			tags: ["architecture", "generated"],
			timestamp,
		}),
		"# Architecture",
		"",
		`Generated from ${files.length} analyzed file${files.length === 1 ? "" : "s"} grouped into ${clusters.length} architectural module${clusters.length === 1 ? "" : "s"}.`,
		"",
		"## Entry points",
		"",
		list(entries.map((entry) => `${code(`${entry.file}:1`)} — ${entry.reason}.`), "No entry point was inferred from the import graph."),
		"",
		"## Architectural modules",
		"",
		list(moduleLinks, "No architectural module was detected."),
		"",
		"## Cross-module dependencies",
		"",
		list(dependencies, "No cross-module import dependency was detected."),
		"",
		"## Tests",
		"",
		list(tests.map(code), "No test file was identified by the graph."),
		"",
		"# Citations",
		"",
		citations(architectureCitations),
		"",
	].join("\n");
	const moduleIndex = [
		"# Architectural modules",
		"",
		list(clusters.map((cluster) => `[${title(cluster.label)}](${moduleFile(cluster)}) — graph cluster with ${cluster.files.length} file${cluster.files.length === 1 ? "" : "s"}.`), "No architectural module was detected."),
		"",
	].join("\n");
	const index = [
		"---",
		'okf_version: "0.1"',
		"---",
		"",
		"# Project wiki",
		"",
		"- [Architecture](architecture.md) — graph-backed system map.",
		"- [Architectural modules](modules/index.md) — concepts grouped by graph cluster.",
		"- [Generation log](log.md) — newest generation first.",
		"",
	].join("\n");
	const date = timestamp.slice(0, 10);
	const log = `# Generation log\n\n## ${date}\n\n- Rewrote the wiki from the persisted code graph.\n`;
	return {
		version: 1,
		mode: "rewrite",
		files: [
			{ path: "index.md", content: index },
			{ path: "architecture.md", content: architecture, sources: files },
			{ path: "modules/index.md", content: moduleIndex },
			...modulePages,
			{ path: "log.md", content: log },
		],
		updateAgentsPointer,
	};
}

/** Generate and atomically commit a complete OKF wiki from the persisted graph. */
export async function generateWiki(workspace: string, options: WikiGenerateOptions = {}): Promise<WikiRecordResult> {
	throwIfAborted(options.signal);
	const snapshot = await openSnapshot(workspace);
	if (!snapshot) throw new CodepatrolError("GRAPH_NOT_FOUND", "Run codepatrol graph sync first.", 4, true);
	throwIfAborted(options.signal);
	const timestamp = (options.now ?? new Date()).toISOString();
	return wikiRecord(workspace, buildPayload(snapshot, timestamp, options.updateAgentsPointer ?? true), options.signal);
}
