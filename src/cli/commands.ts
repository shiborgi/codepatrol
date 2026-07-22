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
import { renderFind, renderImpact, renderNeighbors, renderOutline, renderOverview } from "./output.js";
import { finalizeChange, inspectChanges, startChange, transitionChange } from "../change/orchestrator.js";
import { projectKanban, renderKanbanMarkdown } from "../change/board.js";
import { claimSessionItem, closeSessionItem, discardAndRebuildSession, primeStageSession } from "../change/session.js";
import type { FinalizeInput, Stage, StartChangeInput, TransitionIntent } from "../change/types.js";

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

export async function executeCommand(args: ParsedArgs, workspace: string, signal: AbortSignal): Promise<CommandResult> {
	switch (args.command) {
		case "status": {
			if (args.asOf && !Number.isFinite(Date.parse(args.asOf))) throw new CodepatrolError("INVALID_ARGUMENT", "--as-of must be an ISO timestamp.", 2);
			const data = projectKanban(await inspectChanges(workspace, { all: args.all }, { signal }), { all: args.all, ...(args.asOf ? { asOf: args.asOf } : {}) });
			return { data, text: renderKanbanMarkdown(data) };
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
		case "change.start": {
			const data = await startChange(workspace, readJsonInput(workspace, requireValue(args.input, "input"), "Change") as StartChangeInput, { signal });
			return { data, text: data.nextAction ?? data.identity.work_id };
		}
		case "change.inspect": {
			const data = (await inspectChanges(workspace, { workId: requireValue(args.id, "id"), all: true }, { signal }))[0];
			return { data, text: `${data.identity.work_id} ${data.stage}#${data.attempt} ${data.state}${data.nextAction ? `\nnext: ${data.nextAction}` : ""}` };
		}
		case "change.transition": {
			const data = await transitionChange(workspace, requireValue(args.id, "id"), readJsonInput(workspace, requireValue(args.input, "input"), "Transition") as TransitionIntent, { signal });
			return { data, text: data.nextAction ?? `${data.identity.work_id} ${data.state}` };
		}
		case "change.session": {
			const id = requireValue(args.id, "id"); const payload = readJsonInput(workspace, requireValue(args.input, "input"), "Session") as { action: "prime" | "claim" | "close" | "rebuild"; stage: Stage; attempt: number; itemId?: string; actor?: string; result?: string; artifacts?: string[] };
			let data;
			if (payload.action === "prime") data = primeStageSession(workspace, id, payload.stage, payload.attempt);
			else if (payload.action === "claim") data = await claimSessionItem(workspace, id, payload.stage, payload.attempt, requireValue(payload.itemId, "itemId"), requireValue(payload.actor, "actor"));
			else if (payload.action === "close") data = await closeSessionItem(workspace, id, payload.stage, payload.attempt, requireValue(payload.itemId, "itemId"), requireValue(payload.result, "result"), payload.artifacts);
			else if (payload.action === "rebuild") data = discardAndRebuildSession(workspace, id, payload.stage, payload.attempt);
			else throw new CodepatrolError("INVALID_ARGUMENT", "Session action must be prime, claim, close, or rebuild.", 2);
			return { data, text: data.next_action };
		}
		case "change.doctor": {
			const data = (await inspectChanges(workspace, { workId: requireValue(args.id, "id"), all: true }, { signal }))[0];
			const session = data.state === "terminal" ? undefined : primeStageSession(workspace, data.identity.work_id, data.stage, data.attempt);
			return { data: { valid: true, change: data, session }, text: `Change ${data.identity.work_id} is structurally valid; runtime is rebuildable.` };
		}
		case "change.finalize": {
			const data = await finalizeChange(workspace, requireValue(args.id, "id"), readJsonInput(workspace, requireValue(args.input, "input"), "Finalize") as FinalizeInput, { signal });
			return { data, text: `${data.outcome} ${data.terminalCommit} (${data.tag})` };
		}
		default:
			throw new CodepatrolError("INVALID_ARGUMENT", `Unknown command: ${args.command || "(none)"}`, 2);
	}
}
