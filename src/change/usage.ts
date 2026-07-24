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
	for (const key of Object.keys(run)) if (!["id", "started_at", "finished_at", "elapsed_ms", "characters"].includes(key)) throw new CodepatrolError("CHANGE_INVALID", `Run contains unknown field ${key}.`, 4);
	if (!run.id || !run.started_at || !Number.isFinite(Date.parse(run.started_at))) throw new CodepatrolError("CHANGE_INVALID", "Run id and started_at are required.", 4);
	if (run.finished_at !== undefined && !Number.isFinite(Date.parse(run.finished_at))) throw new CodepatrolError("CHANGE_INVALID", "Run finished_at must be ISO time.", 4);
	if ((run.finished_at === undefined) !== (run.elapsed_ms === undefined)) throw new CodepatrolError("CHANGE_INVALID", "Finished runs require elapsed_ms; interrupted runs omit both.", 4);
	if (run.elapsed_ms !== undefined) {
		nonNegative(run.elapsed_ms, "elapsed_ms");
		const observed = Date.parse(run.finished_at!) - Date.parse(run.started_at);
		if (observed < 0 || observed !== run.elapsed_ms) throw new CodepatrolError("CHANGE_INVALID", "Run timestamps and elapsed_ms must agree.", 4);
	}
	if (!run.characters || typeof run.characters !== "object" || Array.isArray(run.characters)) throw new CodepatrolError("CHANGE_INVALID", "Run characters must be an object.", 4);
	if (run.characters.status === "measured") {
		for (const key of Object.keys(run.characters)) if (!["status", "source", "input", "output", "cacheRead", "cacheWrite", "reasoning", "total", "model", "harness"].includes(key)) throw new CodepatrolError("CHANGE_INVALID", `Measured characters contain unknown field ${key}.`, 4);
		if (run.characters.source !== "provider" && run.characters.source !== "harness") throw new CodepatrolError("CHANGE_INVALID", "Measured character source must be provider or harness.", 4);
		nonNegative(run.characters.input, "characters.input"); nonNegative(run.characters.output, "characters.output"); nonNegative(run.characters.total, "characters.total");
		for (const key of ["cacheRead", "cacheWrite", "reasoning"] as const) if (run.characters[key] !== undefined) nonNegative(run.characters[key], `characters.${key}`);
	} else if (run.characters.status === "unavailable") {
		for (const key of Object.keys(run.characters)) if (!["status", "reason", "model", "harness"].includes(key)) throw new CodepatrolError("CHANGE_INVALID", `Unavailable characters contain unknown field ${key}.`, 4);
		if (!run.characters.reason?.trim()) throw new CodepatrolError("CHANGE_INVALID", "Unavailable usage requires a reason.", 4);
	} else throw new CodepatrolError("CHANGE_INVALID", "Character status must be measured or unavailable.", 4);
}

export function aggregateUsage(runs: RunUsage[]): UsageSummary {
	const seen = new Set<string>();
	const result: UsageSummary = { activeMs: 0, characters: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0, measuredRuns: 0, totalRuns: 0, coverage: "0/0", complete: true } };
	for (const run of runs) {
		validateRun(run);
		if (seen.has(run.id)) throw new CodepatrolError("CHANGE_CONFLICT", `Duplicate run id: ${run.id}.`, 4);
		seen.add(run.id);
		result.characters.totalRuns++;
		result.activeMs = add(result.activeMs, run.elapsed_ms ?? 0, "elapsed_ms");
		if (run.characters.status === "measured") {
			result.characters.measuredRuns++;
			result.characters.input = add(result.characters.input, run.characters.input, "characters.input");
			result.characters.output = add(result.characters.output, run.characters.output, "characters.output");
			result.characters.cacheRead = add(result.characters.cacheRead, run.characters.cacheRead ?? 0, "characters.cacheRead");
			result.characters.cacheWrite = add(result.characters.cacheWrite, run.characters.cacheWrite ?? 0, "characters.cacheWrite");
			result.characters.reasoning = add(result.characters.reasoning, run.characters.reasoning ?? 0, "characters.reasoning");
			result.characters.total = add(result.characters.total, run.characters.total, "characters.total");
		}
	}
	result.characters.coverage = `${result.characters.measuredRuns}/${result.characters.totalRuns}`;
	result.characters.complete = result.characters.measuredRuns === result.characters.totalRuns;
	return result;
}
