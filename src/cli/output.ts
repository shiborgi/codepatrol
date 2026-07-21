import type { GraphImpactData, GraphNeighborsData, GraphOverviewData, OutlineFile } from "../graph/service.js";
import type { GraphNode } from "../graph/model.js";
import { formatTable, mermaidModuleMap } from "../graph/render.js";
import type { CodepatrolError } from "../shared/errors.js";
import type { StatusSummary } from "../status/types.js";

export interface SuccessEnvelope {
	ok: true;
	command: string;
	workspace: string;
	data: unknown;
	warnings: string[];
}

export interface ErrorEnvelope {
	ok: false;
	command: string;
	error: { code: string; message: string; retryable: boolean; details?: unknown };
}

export function successEnvelope(command: string, workspace: string, data: unknown, warnings: string[] = []): SuccessEnvelope {
	return { ok: true, command, workspace, data, warnings };
}

export function errorEnvelope(command: string, error: CodepatrolError): ErrorEnvelope {
	return {
		ok: false,
		command,
		error: { code: error.code, message: error.message, retryable: error.retryable, ...(error.details === undefined ? {} : { details: error.details }) },
	};
}

export const HELP = `codepatrol <group> <command> [options]

Status commands:
  status [--all]

Graph commands:
  graph sync [--force]
  graph overview [--path <path>]
  graph outline --file <path>
  graph find --query <text> [--exact]
  graph neighbors [--symbol <name|id>] [--file <path>] [--relation <type>...]
  graph impact [--file <path>...] [--symbol <name|id>...] [--since-ref <ref>] [--include-ambiguous]

Wiki commands:
  wiki status
  wiki validate
  wiki generate
  wiki record --input <file|->

Artifact handoff commands:
  artifact record --manifest <.codepatrol/work/<work-id>/handoff.yaml>
  artifact validate --manifest <path> --stage plan|review|implementation|verification

Workflow memory commands:
  workflow create --input <file|->
  workflow update --id <id> --input <file|->
  workflow show --id <id>
  workflow list [--status <status>] [--workflow-id <id>]
  workflow ready [--workflow-id <id>]
  workflow claim --id <id> --actor <harness>
  workflow close --id <id> --result <file|->
  workflow remember --input <file|->
  workflow prime [--workflow-id <id>] [--budget <tokens>]
  workflow compact [--workflow-id <id>]

Global options:
  --workspace <path>   Explicit workspace (then CODEPATROL_WORKSPACE, then cwd)
  --format text|json   Output format (default: text)
  --help               Show help
  --version            Show version`;

export function renderOverview(data: GraphOverviewData): string {
	if (data.path !== undefined) {
		const files = data.files ?? [];
		if (files.length === 0) return `No graph files under "${data.path}".`;
		return [
			`# Orientation — ${data.path} (${files.length} files)`, "",
			formatTable(["file", "symbols", "exported", "fan-in", "fan-out", "test"], files.map((file) => [
				file.file, String(file.symbols), String(file.exported), String(file.fanIn), String(file.fanOut), file.isTest ? "yes" : "",
			])),
		].join("\n");
	}
	const clusters = data.clusters ?? [];
	return [
		`# Architecture overview — ${data.stats.files} files, ${data.stats.symbols} symbols, ${clusters.length} clusters`, "",
		"## Clusters",
		formatTable(["cluster", "files", "e.g."], clusters.slice(0, 12).map((cluster) => [cluster.label, String(cluster.files.length), cluster.files.slice(0, 3).join(", ")])),
		"", "## Entry points",
		(data.entryPoints?.length ? data.entryPoints.map((entry) => `- ${entry.file} — ${entry.reason}`).join("\n") : "(none detected)"),
		"", "## Top fan-in (most depended upon)",
		formatTable(["file", "importers"], (data.topFanIn ?? []).map((item) => [item.file, String(item.count)])),
		"", "## Top fan-out (most dependencies)",
		formatTable(["file", "imports"], (data.topFanOut ?? []).map((item) => [item.file, String(item.count)])),
		"", "## Module map", mermaidModuleMap(clusters, data.clusterEdges ?? []),
	].join("\n");
}

export function renderOutline(files: OutlineFile[]): string {
	if (files.length === 0) return "No graph files matched the requested path.";
	return files.map((file) => [
		`## ${file.file} — ${file.exported.length} exported, ${file.internal.length} internal`,
		...file.exported.map((symbol) => `- exported ${symbol.kind} ${symbol.name} (line ${symbol.line})`),
		...(file.internal.length ? [`- internals: ${file.internal.map((symbol) => symbol.name).join(", ")}`] : []),
	].join("\n")).join("\n\n");
}

export function renderFind(nodes: GraphNode[]): string {
	if (!nodes.length) return "No matching definitions in the graph.";
	return nodes.map((node) => `${node.file}:${node.line} ${node.name} (${node.kind}, ${node.exported ? "exported" : "internal"}) — ${node.id}`).join("\n");
}

function renderRelated(label: string, entries: Array<{ name: string; file?: string; line?: number; confidence?: string }> | string[] | undefined): string {
	if (!entries?.length) return `${label}: (none)`;
	return `${label}:\n${entries.map((entry) => typeof entry === "string"
		? `  - ${entry}`
		: `  - ${entry.name}${entry.file ? ` (${entry.file}:${entry.line ?? "?"})` : ""}${entry.confidence ? ` [${entry.confidence}]` : ""}`).join("\n")}`;
}

export function renderNeighbors(data: GraphNeighborsData): string {
	const sections: string[] = [];
	for (const item of data.symbols) {
		sections.push(`# ${item.symbol.file}:${item.symbol.line} ${item.symbol.name} — ${item.symbol.id}`);
		if (item.callers) sections.push(renderRelated("callers", item.callers));
		if (item.callees) sections.push(renderRelated("callees", item.callees));
		if (item.inheritors) sections.push(renderRelated("inheritors", item.inheritors));
	}
	if (data.file) {
		sections.push(`# ${data.file.file}`);
		if (data.file.importers) sections.push(renderRelated("importers", data.file.importers));
		if (data.file.imports) sections.push(renderRelated("imports", data.file.imports));
		if (data.file.tests) sections.push(renderRelated("tested by", data.file.tests));
	}
	return sections.length ? sections.join("\n") : "No matching graph neighbors.";
}

export function renderImpact(data: GraphImpactData): string {
	return [
		`# Blast radius — ${data.seeds.files.length + data.seeds.symbols.length} seed(s), ${data.affected.length} affected file(s)`,
		`Seeds: ${[...data.seeds.files, ...data.seeds.symbols].join(", ")}`,
		"",
		data.affected.length ? formatTable(["affected file", "depth"], data.affected.map((entry) => [entry.file, String(entry.depth)])) : "No dependents found.",
		"", `Affected tests: ${data.affectedTests.length ? "" : "(none found)"}`,
		...data.affectedTests.map((test) => `  - ${test}`),
		...(data.possiblyAffected.length ? ["", `Possibly affected through ambiguous edges: ${data.possiblyAffected.join(", ")}`] : []),
		...(data.unknownSeeds.length ? ["", `Seeds not in graph: ${data.unknownSeeds.join(", ")}`] : []),
	].join("\n");
}

export function renderStatus(data: StatusSummary): string {
	if (!data.workflows.length && !data.packages.length) return "No open workflows or packages.";
	const sections: string[] = [];
	if (data.workflows.length) {
		sections.push("Workflows:", ...data.workflows.map((workflow) => [
			`  ${workflow.id} ${workflow.status} — ${workflow.title}`,
			` (ready: ${workflow.counts.ready}, active: ${workflow.counts.active}, blocked: ${workflow.counts.blocked})`,
			workflow.nextAction ? ` next: ${workflow.nextAction}` : "",
			workflow.packageWorkId ? ` [package: ${workflow.packageWorkId}]` : "",
		].join("")));
	}
	if (data.packages.length) {
		sections.push("Packages:", ...data.packages.map((pkg) =>
			`  ${pkg.workId} ${pkg.status ?? "unknown"}${pkg.revision !== undefined ? ` rev ${pkg.revision}` : ""}${pkg.workflowId ? ` [workflow: ${pkg.workflowId}]` : ""}`,
		));
	}
	return sections.join("\n");
}
