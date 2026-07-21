import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { graphFind, graphImpact, graphNeighbors, graphOutline, graphOverview, graphSync } from "../graph/service.js";
import { generateWiki } from "../wiki/generate.js";
import { wikiRecord } from "../wiki/record.js";
import { wikiStatus } from "../wiki/status.js";
import { validateWiki } from "../wiki/validate.js";
import { CodepatrolError } from "../shared/errors.js";
import { resolveInside } from "../shared/workspace.js";
import type { ParsedArgs } from "./args.js";
import { requireValue } from "./args.js";
import { renderFind, renderImpact, renderNeighbors, renderOutline, renderOverview, renderStatus } from "./output.js";
import {
	claimWorkflowItem,
	closeWorkflowItem,
	compactWorkflow,
	createWorkflowItem,
	listWorkflowItems,
	primeWorkflow,
	readyWorkflowItems,
	rememberWorkflow,
	showWorkflowItem,
	updateWorkflowItem,
} from "../workflow/service.js";
import { WORKFLOW_STATUSES, type CloseWorkflowResult, type CreateWorkflowInput, type RememberWorkflowInput, type UpdateWorkflowInput, type WorkflowItemV1, type WorkflowStatus } from "../workflow/types.js";
import { recordArtifactPackage, validateArtifactPackage } from "../artifact/service.js";
import type { ArtifactStage } from "../artifact/types.js";
import { statusSummary } from "../status/service.js";

export interface CommandResult {
	data: unknown;
	text: string;
	warnings?: string[];
	exitCode?: 0 | 4;
}

function relativePath(workspace: string, path: string): string {
	return relative(workspace, resolveInside(workspace, path)).split("\\").join("/");
}

function requireSeed(args: ParsedArgs): void {
	if (!args.files.length && !args.symbols.length && !args.sinceRef) {
		throw new CodepatrolError("INVALID_ARGUMENT", "Pass at least one --file, --symbol, or --since-ref.", 2);
	}
}

function renderSync(data: Awaited<ReturnType<typeof graphSync>>): string {
	const { report } = data;
	return [
		`Code graph synced in ${report.durationMs}ms — ${data.path}`,
		`files: scanned ${report.scanned}, extracted ${report.extracted}, unchanged ${report.unchanged}, removed ${report.removed}`,
		`nodes: ${report.stats.files} files, ${report.stats.symbols} symbols`,
		`edges: imports ${report.stats.edgesByKind.imports}, calls ${report.stats.edgesByKind.calls}, inherits ${report.stats.edgesByKind.inherits}, tests ${report.stats.edgesByKind.tests}`,
	].join("\n");
}

function readJsonInput(workspace: string, input: string, label: string): unknown {
	const raw = input === "-" ? readFileSync(0, "utf8") : readFileSync(resolveInside(workspace, input, true), "utf8");
	try { return JSON.parse(raw); }
	catch { throw new CodepatrolError("INVALID_ARGUMENT", `${label} input is not valid JSON.`, 2); }
}

function parseBudget(value: string | undefined): number | undefined {
	if (value === undefined) return undefined;
	if (!/^\d+$/.test(value)) throw new CodepatrolError("INVALID_ARGUMENT", "--budget must be an integer.", 2);
	return Number(value);
}

function renderWorkflowItem(item: WorkflowItemV1): string {
	return `${item.id} ${item.kind} ${item.status} — ${item.title}${item.nextAction ? `\nnext: ${item.nextAction}` : ""}`;
}

function renderWorkflowItems(items: WorkflowItemV1[]): string {
	return items.length ? items.map(renderWorkflowItem).join("\n") : "No workflow items matched.";
}

export async function executeCommand(args: ParsedArgs, workspace: string, signal: AbortSignal): Promise<CommandResult> {
	switch (args.command) {
		case "status": {
			const data = statusSummary(workspace, { all: args.all });
			return { data, warnings: data.warnings, text: renderStatus(data) };
		}
		case "graph.sync": {
			const data = await graphSync(workspace, { force: args.force, signal });
			return { data, text: renderSync(data) };
		}
		case "graph.overview": {
			const data = await graphOverview(workspace, args.path ? relativePath(workspace, args.path) : undefined);
			return { data, text: renderOverview(data) };
		}
		case "graph.outline": {
			if (args.files.length > 1) throw new CodepatrolError("INVALID_ARGUMENT", "Option --file may only be passed once for graph outline.", 2);
			const data = await graphOutline(workspace, relativePath(workspace, requireValue(args.file, "file")));
			return { data, text: renderOutline(data) };
		}
		case "graph.find": {
			const data = await graphFind(workspace, requireValue(args.query, "query"), args.exact);
			return { data, text: renderFind(data) };
		}
		case "graph.neighbors": {
			if (!args.symbol && !args.file) throw new CodepatrolError("INVALID_ARGUMENT", "Pass --symbol and/or --file.", 2);
			const data = await graphNeighbors(workspace, {
				symbol: args.symbol,
				file: args.file ? relativePath(workspace, args.file) : undefined,
				relations: args.relations,
			});
			return { data, text: renderNeighbors(data) };
		}
		case "graph.impact": {
			requireSeed(args);
			const data = await graphImpact(workspace, {
				files: args.files.map((path) => relativePath(workspace, path)),
				symbols: args.symbols,
				sinceRef: args.sinceRef,
				includeAmbiguous: args.includeAmbiguous,
			});
			return { data, text: renderImpact(data) };
		}
		case "wiki.status": {
			const data = await wikiStatus(workspace);
			return { data, warnings: data.warnings, text: data.text };
		}
		case "wiki.validate": {
			const data = await validateWiki(workspace);
			return { data, warnings: data.warnings.map((warning) => warning.message), text: data.text, exitCode: data.valid ? 0 : 4 };
		}
		case "wiki.generate": {
			const data = await generateWiki(workspace, { signal });
			return { data, warnings: data.warnings, text: data.text };
		}
		case "wiki.record": {
			const input = requireValue(args.input, "input");
			const payload = readJsonInput(workspace, input, "Wiki");
			const data = await wikiRecord(workspace, payload, signal);
			return { data, warnings: data.warnings, text: data.text };
		}
		case "workflow.create": {
			const payload = readJsonInput(workspace, requireValue(args.input, "input"), "Workflow") as CreateWorkflowInput;
			const data = await createWorkflowItem(workspace, payload, { signal });
			return { data, text: renderWorkflowItem(data) };
		}
		case "workflow.update": {
			const payload = readJsonInput(workspace, requireValue(args.input, "input"), "Workflow") as UpdateWorkflowInput;
			const data = await updateWorkflowItem(workspace, requireValue(args.id, "id"), payload, { signal });
			return { data, text: renderWorkflowItem(data) };
		}
		case "workflow.show": {
			const data = await showWorkflowItem(workspace, requireValue(args.id, "id"));
			return { data, text: renderWorkflowItem(data) };
		}
		case "workflow.list": {
			if (args.status && !WORKFLOW_STATUSES.includes(args.status as WorkflowStatus)) throw new CodepatrolError("INVALID_ARGUMENT", `Unsupported workflow status: ${args.status}.`, 2);
			const data = await listWorkflowItems(workspace, { workflowId: args.workflowId, status: args.status as WorkflowStatus | undefined });
			return { data, text: renderWorkflowItems(data) };
		}
		case "workflow.ready": {
			const data = await readyWorkflowItems(workspace, args.workflowId);
			return { data, text: renderWorkflowItems(data) };
		}
		case "workflow.claim": {
			const data = await claimWorkflowItem(workspace, requireValue(args.id, "id"), requireValue(args.actor, "actor"), { signal });
			return { data, text: renderWorkflowItem(data) };
		}
		case "workflow.close": {
			const payload = readJsonInput(workspace, requireValue(args.result, "result"), "Workflow result") as CloseWorkflowResult;
			const data = await closeWorkflowItem(workspace, requireValue(args.id, "id"), payload, { signal });
			return { data, text: renderWorkflowItem(data) };
		}
		case "workflow.remember": {
			const payload = readJsonInput(workspace, requireValue(args.input, "input"), "Workflow memory") as RememberWorkflowInput;
			const data = await rememberWorkflow(workspace, payload, { signal });
			return { data, text: renderWorkflowItem(data) };
		}
		case "workflow.prime": {
			const data = await primeWorkflow(workspace, { workflowId: args.workflowId, budget: parseBudget(args.budget) });
			const warnings = data.otherActiveWorkflows?.length
				? [`Multiple active workflows: ${data.otherActiveWorkflows.map((workflow) => workflow.id).join(", ")}. Resumed most recent: ${data.workflowId}. Pass --workflow-id to select another.`]
				: [];
			return { data, warnings, text: data.context };
		}
		case "workflow.compact": {
			const data = await compactWorkflow(workspace, { workflowId: args.workflowId }, { signal });
			return { data, text: data.compacted.length ? `Compacted: ${data.compacted.join(", ")}` : "No closed workflow items were eligible for compaction." };
		}
		case "artifact.record": {
			const data = await recordArtifactPackage(workspace, requireValue(args.manifest, "manifest"), signal);
			return { data, text: `Recorded artifact package ${data.work_id} revision ${data.revision}.` };
		}
		case "artifact.validate": {
			const stage = requireValue(args.stage, "stage");
			if (stage !== "plan" && stage !== "review" && stage !== "implementation" && stage !== "verification") throw new CodepatrolError("INVALID_ARGUMENT", "--stage must be plan, review, implementation, or verification.", 2);
			const data = validateArtifactPackage(workspace, requireValue(args.manifest, "manifest"), stage as ArtifactStage);
			return { data, warnings: data.warnings, text: data.text, exitCode: data.valid ? 0 : 4 };
		}
		default:
			throw new CodepatrolError("INVALID_ARGUMENT", `Unknown command: ${args.command || "(none)"}`, 2);
	}
}
