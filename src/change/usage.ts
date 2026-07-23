import { CodepatrolError } from "../shared/errors.js";
import type { RunUsage, UsageSummary } from "./types.js";

function nonNegative(value: number | undefined, name: string): number {
	if (value === undefined || !Number.isSafeInteger(value) || value < 0) throw new CodepatrolError("CHANGE_INVALID", `${name} must be a non-negative integer.`, 4);
	return value;
}

function add(left: number, right: number, name: string): number {
	const value = left + right;
	if (!Number.isSafeInteger(value)) throw new CodepatrolError("CHANGE_INVALID", `${name} aggregate must remain a safe integer.`, 4);
	return value;
}

export function validateRun(run: RunUsage): void {
	if (!run || typeof run !== "object" || Array.isArray(run)) throw new CodepatrolError("CHANGE_INVALID", "Run must be an object.", 4);
	for (const key of Object.keys(run)) if (!["id", "started_at", "finished_at", "elapsed_ms", "tokens"].includes(key)) throw new CodepatrolError("CHANGE_INVALID", `Run contains unknown field ${key}.`, 4);
	if (!run.id || !run.started_at || !Number.isFinite(Date.parse(run.started_at))) throw new CodepatrolError("CHANGE_INVALID", "Run id and started_at are required.", 4);
	if (run.finished_at !== undefined && !Number.isFinite(Date.parse(run.finished_at))) throw new CodepatrolError("CHANGE_INVALID", "Run finished_at must be ISO time.", 4);
	if ((run.finished_at === undefined) !== (run.elapsed_ms === undefined)) throw new CodepatrolError("CHANGE_INVALID", "Finished runs require elapsed_ms; interrupted runs omit both.", 4);
	if (run.elapsed_ms !== undefined) {
		nonNegative(run.elapsed_ms, "elapsed_ms");
		const observed = Date.parse(run.finished_at!) - Date.parse(run.started_at);
		if (observed < 0 || observed !== run.elapsed_ms) throw new CodepatrolError("CHANGE_INVALID", "Run timestamps and elapsed_ms must agree.", 4);
	}
	if (!run.tokens || typeof run.tokens !== "object" || Array.isArray(run.tokens)) throw new CodepatrolError("CHANGE_INVALID", "Run tokens must be an object.", 4);
	if (run.tokens.status === "measured") {
		for (const key of Object.keys(run.tokens)) if (!["status", "source", "input", "output", "cacheRead", "cacheWrite", "reasoning", "total", "model", "harness"].includes(key)) throw new CodepatrolError("CHANGE_INVALID", `Measured tokens contain unknown field ${key}.`, 4);
		if (run.tokens.source !== "provider" && run.tokens.source !== "harness") throw new CodepatrolError("CHANGE_INVALID", "Measured token source must be provider or harness.", 4);
		nonNegative(run.tokens.input, "tokens.input"); nonNegative(run.tokens.output, "tokens.output"); nonNegative(run.tokens.total, "tokens.total");
		for (const key of ["cacheRead", "cacheWrite", "reasoning"] as const) if (run.tokens[key] !== undefined) nonNegative(run.tokens[key], `tokens.${key}`);
	} else if (run.tokens.status === "unavailable") {
		for (const key of Object.keys(run.tokens)) if (!["status", "reason", "model", "harness"].includes(key)) throw new CodepatrolError("CHANGE_INVALID", `Unavailable tokens contain unknown field ${key}.`, 4);
		if (!run.tokens.reason?.trim()) throw new CodepatrolError("CHANGE_INVALID", "Unavailable usage requires a reason.", 4);
	} else throw new CodepatrolError("CHANGE_INVALID", "Token status must be measured or unavailable.", 4);
}

export function aggregateUsage(runs: RunUsage[]): UsageSummary {
	const seen = new Set<string>();
	const result: UsageSummary = { activeMs: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0, measuredRuns: 0, totalRuns: 0, coverage: "0/0", complete: true } };
	for (const run of runs) {
		validateRun(run);
		if (seen.has(run.id)) throw new CodepatrolError("CHANGE_CONFLICT", `Duplicate run id: ${run.id}.`, 4);
		seen.add(run.id);
		result.tokens.totalRuns++;
		result.activeMs = add(result.activeMs, run.elapsed_ms ?? 0, "elapsed_ms");
		if (run.tokens.status === "measured") {
			result.tokens.measuredRuns++;
			result.tokens.input = add(result.tokens.input, run.tokens.input, "tokens.input");
			result.tokens.output = add(result.tokens.output, run.tokens.output, "tokens.output");
			result.tokens.cacheRead = add(result.tokens.cacheRead, run.tokens.cacheRead ?? 0, "tokens.cacheRead");
			result.tokens.cacheWrite = add(result.tokens.cacheWrite, run.tokens.cacheWrite ?? 0, "tokens.cacheWrite");
			result.tokens.reasoning = add(result.tokens.reasoning, run.tokens.reasoning ?? 0, "tokens.reasoning");
			result.tokens.total = add(result.tokens.total, run.tokens.total, "tokens.total");
		}
	}
	result.tokens.coverage = `${result.tokens.measuredRuns}/${result.tokens.totalRuns}`;
	result.tokens.complete = result.tokens.measuredRuns === result.tokens.totalRuns;
	return result;
}
