import type { ChangeView, RunUsage, Stage, UsageSummary } from "./types.js";
import { STAGES } from "./types.js";
import { aggregateUsage } from "./usage.js";

export interface KanbanRow { work: string; branch: string; plan: string; review: string; apply: string; verify: string; close: string; total: string; nextAction?: string; createdAt: string; workId: string }
export interface KanbanBoard { generatedAsOf: string | null; rows: KanbanRow[] }
function duration(ms: number | undefined): string { if (ms === undefined) return "-"; const seconds = Math.floor(ms / 1000); const hours = Math.floor(seconds / 3600); const minutes = Math.floor((seconds % 3600) / 60); const rest = seconds % 60; return hours ? `${hours}h${String(minutes).padStart(2, "0")}m` : minutes ? `${minutes}m${String(rest).padStart(2, "0")}s` : `${rest}s`; }
function tokenText(usage: UsageSummary): string { return `${usage.tokens.total}${usage.tokens.complete ? "" : "~"}t ${usage.tokens.coverage}`; }
function runsWithAsOf(runs: RunUsage[], asOf?: string): RunUsage[] {
	if (!asOf) return runs;
	const end = Date.parse(asOf);
	return runs.map((run) => run.finished_at ? run : { ...run, finished_at: asOf, elapsed_ms: Math.max(0, end - Date.parse(run.started_at)) });
}
function stageCell(view: ChangeView, stage: Stage, asOf?: string): string {
	const attempts = view.attempts[stage]; if (!attempts.length) return "-";
	const last = attempts.at(-1)!; const usage = aggregateUsage(runsWithAsOf(attempts.flatMap((item) => item.runs), asOf));
	return `#${last.attempt} ${last.result ?? last.status}; ${tokenText(usage)}; ${duration(usage.activeMs)}`;
}
export function projectKanban(changes: ChangeView[], options: { asOf?: string; all?: boolean } = {}): KanbanBoard {
	const ids = new Set<string>();
	const rows = changes.filter((view) => options.all || view.state !== "terminal").sort((a, b) => a.identity.created_at.localeCompare(b.identity.created_at) || a.identity.work_id.localeCompare(b.identity.work_id)).map((view) => {
		if (ids.has(view.identity.work_id)) throw new Error(`Conflicting Change copies: ${view.identity.work_id}`); ids.add(view.identity.work_id);
		const totalRuns = Object.values(view.attempts).flat().flatMap((item) => item.runs); const total = aggregateUsage(runsWithAsOf(totalRuns, options.asOf));
		const cycleMs = view.cycleMs ?? (options.asOf ? Math.max(0, Date.parse(options.asOf) - Date.parse(view.identity.created_at)) : undefined);
		return { work: `${view.identity.work_id} ${view.identity.title}`, workId: view.identity.work_id, createdAt: view.identity.created_at, branch: view.identity.branch, plan: stageCell(view, "plan", options.asOf), review: stageCell(view, "review", options.asOf), apply: stageCell(view, "apply", options.asOf), verify: stageCell(view, "verify", options.asOf), close: view.outcome ? `${view.outcome === "committed" ? "commit" : "rollback"} ${view.terminalCommit?.slice(0, 12)}` : stageCell(view, "close", options.asOf), total: `${tokenText(total)}; active ${duration(total.activeMs)}; cycle ${duration(cycleMs)}`, ...(view.nextAction ? { nextAction: view.nextAction } : {}) };
	});
	return { generatedAsOf: options.asOf ?? null, rows };
}
function escape(value: string): string { return value.replaceAll("|", "\\|").replaceAll("\n", " "); }
export function renderKanbanMarkdown(board: KanbanBoard): string {
	const header = "| Work | Branch | Plan | Review | Apply | Verify | Close | Total |\n|---|---|---|---|---|---|---|---|\n";
	return header + board.rows.map((row) => `| ${escape(row.work)}${row.nextAction ? `<br>next: ${escape(row.nextAction)}` : ""} | ${escape(row.branch)} | ${escape(row.plan)} | ${escape(row.review)} | ${escape(row.apply)} | ${escape(row.verify)} | ${escape(row.close)} | ${escape(row.total)} |`).join("\n") + (board.rows.length ? "\n" : "");
}
