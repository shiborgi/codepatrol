import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse } from "yaml";
import * as trace from "./trace.js";

export interface PerStageStats { attemptCount: number; returnCount: number; checkpointCount: number; elapsedMs: number }
export interface ReturnRecord { stage: string; attempt: number; reason: string; at: string }
export interface TopError { code: string; count: number; sampleMessage: string; command?: string }
export interface ArtifactStats { count: number; totalBytes: number }
export interface ImprovementReport {
	summary: string;
	perStage: Record<string, PerStageStats>;
	returns: ReturnRecord[];
	topErrors: TopError[];
	elapsedPerStage: Record<string, number>;
	artifactStats: ArtifactStats;
	recommendations: string[];
}

const STAGES = ["plan", "review", "apply", "verify", "close"] as const;

function emptyPerStage(): Record<string, PerStageStats> {
	const out: Record<string, PerStageStats> = {};
	for (const stage of STAGES) out[stage] = { attemptCount: 0, returnCount: 0, checkpointCount: 0, elapsedMs: 0 };
	return out;
}

function recordPathFor(workspace: string, workId: string): string {
	return join(workspace, ".codepatrol", "changes", workId, "change.yaml");
}

function readChangeRecord(workspace: string, workId: string): { events: Array<Record<string, unknown>> } | null {
	const p = recordPathFor(workspace, workId);
	if (!existsSync(p)) return null;
	try {
		return parse(readFileSync(p, "utf8")) as { events: Array<Record<string, unknown>> };
	} catch {
		return null;
	}
}

function bytesForDir(dir: string): { count: number; totalBytes: number } {
	let count = 0;
	let totalBytes = 0;
	if (!existsSync(dir)) return { count, totalBytes };
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			const sub = bytesForDir(path);
			count += sub.count;
			totalBytes += sub.totalBytes;
		} else if (entry.isFile()) {
			count += 1;
			totalBytes += statSync(path).size;
		}
	}
	return { count, totalBytes };
}

export function generateImprovementReport(workspace: string, workId: string): ImprovementReport {
	const perStage = emptyPerStage();
	const elapsedPerStage: Record<string, number> = {};
	for (const stage of STAGES) elapsedPerStage[stage] = 0;
	const returns: ReturnRecord[] = [];
	const topErrorMap = new Map<string, TopError>();
	const commandCounts = new Map<string, number>();
	let commandCount = 0;

	const entries = trace.read(workspace, workId);
	for (const entry of entries) {
		if (entry.kind === "event") {
			const stage = entry.stage;
			if (!perStage[stage]) perStage[stage] = { attemptCount: 0, returnCount: 0, checkpointCount: 0, elapsedMs: 0 };
			elapsedPerStage[stage] = (elapsedPerStage[stage] ?? 0) + 0;
		} else if (entry.kind === "command") {
			commandCount += 1;
			commandCounts.set(entry.command, (commandCounts.get(entry.command) ?? 0) + 1);
		} else if (entry.kind === "error") {
			const existing = topErrorMap.get(entry.code);
			if (existing) {
				existing.count += 1;
			} else {
				topErrorMap.set(entry.code, { code: entry.code, count: 1, sampleMessage: entry.message, command: entry.command });
			}
		}
	}

	const record = readChangeRecord(workspace, workId);
	if (record) {
		const stageRun = new Map<string, { firstAt?: string; lastAt?: string }>();
		for (const raw of record.events) {
			const event = raw as { type?: string; stage?: string; attempt?: number; reason?: string; to_stage?: string; at?: string; run?: { started_at?: string; finished_at?: string; elapsed_ms?: number } };
			if (!event.stage) continue;
			const stage = event.stage;
			if (!perStage[stage]) perStage[stage] = { attemptCount: 0, returnCount: 0, checkpointCount: 0, elapsedMs: 0 };
			if (event.type === "stage-began" || event.type === "run-recorded") {
				const run = event.run;
				if (run?.elapsed_ms !== undefined) perStage[stage].elapsedMs += run.elapsed_ms;
			}
			if (event.type === "stage-began" || event.type === "stage-checkpointed" || event.type === "stage-returned" || event.type === "change-started") {
				perStage[stage].attemptCount = Math.max(perStage[stage].attemptCount, event.attempt ?? perStage[stage].attemptCount);
			}
			if (event.type === "stage-checkpointed") {
				perStage[stage].checkpointCount = Math.max(perStage[stage].checkpointCount, event.attempt ?? perStage[stage].checkpointCount);
			}
			if (event.type === "stage-returned" && event.to_stage) {
				perStage[stage].returnCount += 1;
				returns.push({ stage, attempt: event.attempt ?? 0, reason: event.reason ?? "", at: event.at ?? "" });
			}
			if (event.at) {
				const sr = stageRun.get(stage) ?? {};
				if (!sr.firstAt || event.at < sr.firstAt) sr.firstAt = event.at;
				if (!sr.lastAt || event.at > sr.lastAt) sr.lastAt = event.at;
				stageRun.set(stage, sr);
			}
		}
		for (const [stage, sr] of stageRun) {
			if (sr.firstAt && sr.lastAt) elapsedPerStage[stage] = Date.parse(sr.lastAt) - Date.parse(sr.firstAt);
		}
	}

	const artifactDir = join(workspace, ".codepatrol", "changes", workId);
	const artifactStats = bytesForDir(artifactDir);

	const topErrors = Array.from(topErrorMap.values()).sort((a, b) => b.count - a.count);
	const topCommands = Array.from(commandCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3);
	const totalAttempts = STAGES.reduce((sum, stage) => sum + (perStage[stage]?.attemptCount ?? 0), 0);
	const totalReturns = returns.length;

	const recommendations: string[] = [];
	if (totalReturns === 0 && entries.length === 0 && !record) {
		recommendations.push("No trace available for this Change.");
	} else {
		if ((perStage.plan?.returnCount ?? 0) > 0) {
			recommendations.push("Plan stage returned at least once — review the spec/plan for missing ACs or unclear constraints.");
		}
		if ((perStage.review?.returnCount ?? 0) >= 2) {
			recommendations.push("Review stage returned 2+ times — surface the top review defects to the next Plan and consider a pre-Review `assess-change` precondition.");
		}
		if (topErrors.length > 0) {
			recommendations.push(`Top error code: ${topErrors[0]?.code} (${topErrors[0]?.count}). Investigate the first occurrence's args and stage context.`);
		}
		if (topCommands.length > 0 && topCommands[0] && topCommands[0][1] >= 5) {
			recommendations.push(`Command "${topCommands[0][0]}" was invoked ${topCommands[0][1]} times — consider caching or batching repeated invocations.`);
		}
		if (totalAttempts === 0 && entries.length === 0) {
			recommendations.push("No orchestrator events recorded — verify the trace hooks are firing.");
		}
	}
	if (recommendations.length === 0) {
		recommendations.push("No notable patterns detected; continue with current process.");
	}

	const summary = `Change \`${workId}\` recorded ${entries.length} trace entries, ${totalReturns} stage return${totalReturns === 1 ? "" : "s"}, and ${topErrors.length} unique error code${topErrors.length === 1 ? "" : "s"}.`;

	return { summary, perStage, returns, topErrors, elapsedPerStage, artifactStats, recommendations };
}

export function renderReportMarkdown(r: ImprovementReport): string {
	const lines: string[] = [];
	lines.push("# Improvement report");
	lines.push("");
	lines.push("## Summary");
	lines.push(r.summary);
	lines.push("");
	lines.push("## Per-stage attempts");
	lines.push("| Stage | Attempts | Returns | Checkpoints |");
	lines.push("|---|---|---|---|");
	for (const stage of STAGES) {
		const s = r.perStage[stage] ?? { attemptCount: 0, returnCount: 0, checkpointCount: 0, elapsedMs: 0 };
		lines.push(`| ${stage} | ${s.attemptCount} | ${s.returnCount} | ${s.checkpointCount} |`);
	}
	lines.push("");
	lines.push("## Returns");
	if (r.returns.length === 0) {
		lines.push("None.");
	} else {
		lines.push("| Stage | Attempt | Reason | At |");
		lines.push("|---|---|---|---|");
		for (const ret of r.returns) lines.push(`| ${ret.stage} | ${ret.attempt} | ${ret.reason} | ${ret.at} |`);
	}
	lines.push("");
	lines.push("## Top errors");
	if (r.topErrors.length === 0) {
		lines.push("None.");
	} else {
		lines.push("| Code | Count | Sample message |");
		lines.push("|---|---|---|");
		for (const e of r.topErrors) lines.push(`| ${e.code} | ${e.count} | ${e.sampleMessage} |`);
	}
	lines.push("");
	lines.push("## Elapsed per stage");
	lines.push("| Stage | Elapsed (ms) |");
	lines.push("|---|---|");
	for (const stage of STAGES) lines.push(`| ${stage} | ${r.elapsedPerStage[stage] ?? 0} |`);
	lines.push("");
	lines.push("## Artifact stats");
	lines.push(`- Files: ${r.artifactStats.count}`);
	lines.push(`- Total bytes: ${r.artifactStats.totalBytes}`);
	lines.push("");
	lines.push("## Recommendations");
	for (const rec of r.recommendations) lines.push(`- ${rec}`);
	lines.push("");
	return lines.join("\n");
}

export function writeImprovementReport(workspace: string, workId: string): string {
	const result = generateImprovementReport(workspace, workId);
	const path = join(workspace, ".codepatrol", "changes", workId, "close", "improvement-report.md");
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, renderReportMarkdown(result), "utf8");
	return path;
}

export function mirrorImprovementReport(workspace: string, workId: string, sourcePath: string): string {
	const mirror = join(workspace, "docs", "codepatrol", "improvement-reports", `${workId}.md`);
	mkdirSync(dirname(mirror), { recursive: true });
	copyFileSync(sourcePath, mirror);
	return mirror;
}
