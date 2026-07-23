import { CodepatrolError } from "../shared/errors.js";
import { aggregateUsage } from "./usage.js";
import { validateRun } from "./usage.js";
import { STAGES, type ArtifactBinding, type ChangeEvent, type ChangeRecordV2, type ChangeView, type Stage, type StageAttempt } from "./types.js";

function invalid(message: string): never { throw new CodepatrolError("CHANGE_INVALID", `CHANGE_INVALID: ${message}`, 4); }
function iso(value: string, label: string): void { if (!value || !Number.isFinite(Date.parse(value))) invalid(`${label} must be an ISO timestamp.`); }
function next(stage: Stage): Stage | undefined { return STAGES[STAGES.indexOf(stage) + 1]; }
function emptyAttempts(): Record<Stage, StageAttempt[]> { return { plan: [], review: [], apply: [], verify: [], close: [] }; }
function exactKeys(value: object, allowed: string[], label: string): void {
	for (const key of Object.keys(value)) if (!allowed.includes(key)) invalid(`${label} contains unknown field ${key}.`);
}
function bindings(value: unknown, label: string): ArtifactBinding[] {
	if (!Array.isArray(value)) invalid(`${label} must be an array.`);
	const paths = new Set<string>();
	for (const item of value as ArtifactBinding[]) {
		if (!item || typeof item !== "object" || Array.isArray(item)) invalid(`${label} contains a non-object binding.`);
		exactKeys(item, ["path", "sha256", "intent"], label);
		if (typeof item.path !== "string" || !item.path || /[\0\r\n]/.test(item.path) || paths.has(item.path) || item.path.startsWith("/") || item.path.split("/").includes("..")) invalid(`${label} contains an unsafe or duplicate path.`);
		paths.add(item.path);
		if (!/^[0-9a-f]{64}$/.test(item.sha256)) invalid(`${label} contains an invalid SHA-256.`);
		if (!["create", "modify", "delete"].includes(item.intent as string)) invalid(`${label} requires create, modify or delete intent.`);
	}
	return value as ArtifactBinding[];
}

export function assertChangeRecord(record: ChangeRecordV2): void {
	if (!record || record.schema_version !== 2 || !record.identity || !Array.isArray(record.events)) invalid("Expected schema_version 2, identity and events.");
	exactKeys(record, ["schema_version", "identity", "events"], "Change record");
	const identity = record.identity;
	exactKeys(identity, ["work_id", "title", "created_at", "branch", "target_branch", "base_commit"], "Change identity");
	if (!/^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*$/.test(identity.work_id)) invalid("work_id must use YYYY-MM-DD-slug.");
	if (identity.branch !== `codepatrol/${identity.work_id}`) invalid("branch must be codepatrol/<work-id>.");
	if (!identity.title?.trim() || !identity.target_branch?.trim() || !/^[0-9a-f]{40}$/.test(identity.base_commit)) invalid("identity is incomplete.");
	iso(identity.created_at, "created_at");
	if (!record.events.length || record.events[0]?.type !== "change-started") invalid("First event must be change-started.");
}

export function foldChange(record: ChangeRecordV2): ChangeView {
	assertChangeRecord(record);
	const attempts = emptyAttempts();
	const ids = new Set<string>();
	let stage: Stage = "plan";
	let attempt = 1;
	let state: ChangeView["state"] = "active";
	let nextAction: string | undefined;
	let checkpoint: string | undefined;
	let outcome: ChangeView["outcome"];
	let terminalCommit: string | undefined;
	let previousAt = 0;
	const current = (): StageAttempt => {
		const found = attempts[stage].find((item) => item.attempt === attempt);
		if (!found) invalid(`No attempt ${attempt} exists for ${stage}.`);
		return found;
	};

	for (let index = 0; index < record.events.length; index++) {
		const event = record.events[index] as ChangeEvent;
		if (!event.id || ids.has(event.id)) invalid(`Event id is missing or duplicated at index ${index}.`);
		ids.add(event.id); iso(event.at, `events[${index}].at`);
		const at = Date.parse(event.at); if (at < previousAt) invalid("Events must be chronologically ordered."); previousAt = at;
		if (!event.actor?.trim() || !STAGES.includes(event.stage) || !Number.isSafeInteger(event.attempt) || event.attempt < 1) invalid(`Event ${event.id} has invalid actor, stage or attempt.`);
		const common = ["id", "type", "at", "actor", "stage", "attempt"];
		const specific: Record<string, string[]> = { "change-started": ["next_action"], "stage-began": ["next_action"], "run-recorded": ["run"], "stage-blocked": ["reason", "next_action"], "stage-resumed": ["next_action"], "stage-returned": ["to_stage", "reason", "next_action"], "stage-checkpointed": ["result", "checkpoint", "tree", "artifacts", "changes", "next_action"], "change-closed": ["outcome", "commit", "tag", "receipt"] };
		if (!specific[event.type]) invalid(`Unknown event type ${event.type}.`); exactKeys(event, [...common, ...specific[event.type]], `Event ${event.id}`);
		switch (event.type) {
			case "change-started":
				if (index !== 0 || event.stage !== "plan" || event.attempt !== 1 || !event.next_action?.trim()) invalid("Invalid change-started event.");
				attempts.plan.push({ attempt: 1, status: "active", runs: [], artifacts: [] }); nextAction = event.next_action; break;
			case "stage-began": {
				if (state !== "ready" || event.stage !== stage || event.attempt !== attempt || !event.next_action?.trim()) invalid(`Cannot begin ${event.stage} attempt ${event.attempt}.`);
				current().status = "active"; state = "active"; nextAction = event.next_action; break;
			}
				case "run-recorded":
					validateRun(event.run);
					if (state !== "active" || event.stage !== stage || event.attempt !== attempt) invalid("Run is not for the current active attempt.");
					if (Object.values(attempts).flat().some((item) => item.runs.some((run) => run.id === event.run.id))) throw new CodepatrolError("CHANGE_CONFLICT", `Duplicate run id: ${event.run.id}.`, 4);
					current().runs.push(event.run); break;
			case "stage-blocked":
				if (state !== "active" || event.stage !== stage || event.attempt !== attempt || !event.reason?.trim() || !event.next_action?.trim()) invalid("Invalid block event.");
				current().status = "blocked"; state = "blocked"; nextAction = event.next_action; break;
			case "stage-resumed":
				if (state !== "blocked" || event.stage !== stage || event.attempt !== attempt || !event.next_action?.trim()) invalid("Invalid resume event.");
				current().status = "active"; state = "active"; nextAction = event.next_action; break;
				case "stage-returned": {
					if ((state !== "active" && state !== "blocked") || event.stage !== stage || event.attempt !== attempt || !event.reason?.trim() || !event.next_action?.trim()) invalid("Invalid return event.");
					if (event.to_stage !== "plan" && !(event.stage === "verify" && event.to_stage === "apply")) invalid("Return target is not allowed.");
					if (!current().runs.some((run) => run.finished_at)) invalid("A return requires at least one finished run.");
				current().status = "returned"; current().result = "returned";
				for (const affected of STAGES.slice(STAGES.indexOf(event.to_stage))) for (const prior of attempts[affected]) if (prior.status === "completed") prior.status = "invalidated";
				stage = event.to_stage; attempt = (attempts[stage].at(-1)?.attempt ?? 0) + 1;
				attempts[stage].push({ attempt, status: "ready", runs: [], artifacts: [] }); state = "ready"; nextAction = event.next_action; checkpoint = undefined; break;
			}
			case "stage-checkpointed": {
				if (state !== "active" || event.stage !== stage || event.attempt !== attempt || !/^[0-9a-f]{40}$/.test(event.checkpoint) || (event.tree !== undefined && !/^[0-9a-f]{40}$/.test(event.tree)) || !event.next_action?.trim()) invalid("Invalid stage checkpoint.");
				bindings(event.artifacts, `Checkpoint ${event.id} artifacts`);
				if (event.stage === "apply") {
					if (!Array.isArray(event.changes)) invalid("Apply checkpoint must declare production changes.");
			const paths = new Set<string>(); for (const path of event.changes) { if (typeof path !== "string" || !path || /[\0\r\n]/.test(path) || paths.has(path) || path.startsWith("/") || path.split("/").includes("..")) invalid("Apply checkpoint contains an unsafe or duplicate production path."); paths.add(path); }
				} else if (event.changes !== undefined) invalid("Only Apply checkpoints may declare production changes.");
				if (!current().runs.some((run) => run.finished_at)) invalid("A checkpoint requires at least one finished run record.");
				const expected: Record<Exclude<Stage, "close">, string> = { plan: "ready", review: "approve", apply: "implemented", verify: "commit" };
				if (stage === "close" || event.result !== expected[stage]) invalid(`Unexpected ${stage} result ${event.result}.`);
				Object.assign(current(), { status: "completed", result: event.result, checkpoint: event.checkpoint, tree: event.tree, artifacts: event.artifacts, ...(event.changes ? { changes: event.changes } : {}) }); checkpoint = event.checkpoint;
				stage = next(stage)!; attempt = (attempts[stage].at(-1)?.attempt ?? 0) + 1; attempts[stage].push({ attempt, status: "ready", runs: [], artifacts: [] }); state = "ready"; nextAction = event.next_action; break;
			}
			case "change-closed":
				if (state !== "active" || stage !== "close" || event.stage !== "close" || event.attempt !== attempt || !["committed", "rolled-back"].includes(event.outcome) || !/^[0-9a-f]{40}$/.test(event.commit) || event.tag !== `codepatrol/${event.outcome}/${record.identity.work_id}` || event.receipt !== "close/receipt.md") invalid("Finalize event is not valid for the active close attempt.");
				current().status = "completed"; current().result = event.outcome; state = "terminal"; outcome = event.outcome; terminalCommit = event.commit; nextAction = undefined; break;
			default: invalid(`Unknown event type ${(event as ChangeEvent).type}.`);
		}
	}
	const runs = Object.values(attempts).flat().flatMap((item) => item.runs);
	const end = record.events.at(-1)?.at;
	const cycleMs = outcome && end ? Date.parse(end) - Date.parse(record.identity.created_at) : undefined;
	return { identity: record.identity, stage, attempt, state, ...(nextAction ? { nextAction } : {}), revision: attempts.plan.length, ...(checkpoint ? { checkpoint } : {}), ...(outcome ? { outcome } : {}), ...(terminalCommit ? { terminalCommit } : {}), attempts, usage: aggregateUsage(runs), ...(cycleMs === undefined ? {} : { cycleMs }) };
}
