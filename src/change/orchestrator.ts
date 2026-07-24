import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { parse } from "yaml";
import { CodepatrolError } from "../shared/errors.js";
import { withWorkspaceLock } from "../shared/lock.js";
import { resolveInside } from "../shared/workspace.js";
import { NodeGitAdapter, type GitAdapter } from "./git.js";
import { foldChange } from "./model.js";
import { changeRecordPath, listWorkingTreeChangeIds, readChangeRecord, writeChangeRecord, appendChangeEvent } from "./store.js";
import * as trace from "./trace.js";
import { writeImprovementReport, mirrorImprovementReport } from "./improvement-report.js";
import { validateStageArtifacts, validateStageArtifactsFromReader, type ArtifactReader, type BaselineReader } from "./validation.js";
import { validateRun } from "./usage.js";
import type { ArtifactBinding, ChangeEvent, ChangeQuery, ChangeRecordV2, ChangeView, CloseInput, CloseResult, OperationOptions, Stage, StageAttempt, StartChangeInput, TransitionIntent } from "./types.js";
import { STAGES } from "./types.js";

function now(options: OperationOptions): Date { return options.now ?? new Date(); }
function eventBase(view: ChangeView, actor: string, options: OperationOptions) { return { id: randomUUID(), at: now(options).toISOString(), actor, stage: view.stage, attempt: view.attempt }; }
function gitFor(workspace: string, options: OperationOptions): GitAdapter { return options.git ?? new NodeGitAdapter(workspace); }
function relativeRecord(workId: string): string { return `.codepatrol/changes/${workId}/change.yaml`; }
function parseStatusPaths(status: string): string[] { return status.split("\n").filter(Boolean).map((line) => line.slice(3).split(" -> ").at(-1)!).filter((path) => Boolean(path) && path !== ".codepatrol/" && !path.startsWith(".codepatrol/runtime/")); }
function ensurePath(path: string): void {
	if (!path || /[\0\r\n]/.test(path) || path.startsWith("/") || path.split("/").includes("..") || path.startsWith(".codepatrol/runtime/")) throw new CodepatrolError("CHANGE_INVALID", `Unsafe checkpoint path: ${path}.`, 4);
}
function requireObject(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new CodepatrolError("INVALID_ARGUMENT", `${label} must be a JSON object.`, 2);
	return value as Record<string, unknown>;
}
function exactInput(value: Record<string, unknown>, allowed: string[], label: string): void {
	for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new CodepatrolError("INVALID_ARGUMENT", `${label} contains unknown field ${key}.`, 2);
}
function textInput(value: unknown, field: string): string {
	if (typeof value !== "string" || !value.trim()) throw new CodepatrolError("INVALID_ARGUMENT", `${field} must be a non-empty string.`, 2);
	return value;
}
function assertStartInput(input: StartChangeInput): void {
	const value = requireObject(input, "Change start"); exactInput(value, ["workId", "title", "targetBranch", "actor", "nextAction"], "Change start");
	textInput(value.workId, "workId"); textInput(value.title, "title"); textInput(value.actor, "actor");
	const target = textInput(value.targetBranch, "targetBranch");
	if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(target) || target.includes("..") || target.includes("//") || target.endsWith("/") || target.includes("@{")) throw new CodepatrolError("INVALID_ARGUMENT", "targetBranch is not a safe Git branch name.", 2);
	if (value.nextAction !== undefined) textInput(value.nextAction, "nextAction");
}
function assertTransitionIntent(intent: TransitionIntent): void {
	const value = requireObject(intent, "Transition"); const type = textInput(value.type, "type");
	const fields: Record<string, string[]> = {
		begin: ["type", "actor", "stage", "nextAction"], usage: ["type", "actor", "stage", "run"], checkpoint: ["type", "actor", "stage", "result", "artifacts", "changes", "nextAction"],
		return: ["type", "actor", "stage", "toStage", "reason", "nextAction"], block: ["type", "actor", "stage", "reason", "nextAction"], resume: ["type", "actor", "stage", "nextAction"],
	};
	if (!fields[type]) throw new CodepatrolError("INVALID_ARGUMENT", `Unknown transition type: ${type}.`, 2);
	exactInput(value, fields[type], "Transition"); textInput(value.actor, "actor");
	if (typeof value.stage !== "string" || !STAGES.includes(value.stage as typeof STAGES[number])) throw new CodepatrolError("INVALID_ARGUMENT", "stage is invalid.", 2);
	if (["begin", "checkpoint", "return", "block", "resume"].includes(type)) textInput(value.nextAction, "nextAction");
	if (["return", "block"].includes(type)) textInput(value.reason, "reason");
	if (type === "usage") validateRun(value.run as never);
	if (type === "return" && value.toStage !== "plan" && value.toStage !== "apply") throw new CodepatrolError("INVALID_ARGUMENT", "toStage must be plan or apply.", 2);
	if (type === "checkpoint") {
		if (value.stage === "close" || !Array.isArray(value.artifacts)) throw new CodepatrolError("INVALID_ARGUMENT", "Checkpoint stage/artifacts are invalid.", 2);
		const expected = { plan: "ready", review: "approve", apply: "implemented", verify: "commit" } as const;
		if (value.result !== expected[value.stage as keyof typeof expected]) throw new CodepatrolError("INVALID_ARGUMENT", `Checkpoint result is invalid for ${String(value.stage)}.`, 2);
		for (const raw of value.artifacts) {
			const artifact = requireObject(raw, "Artifact binding"); exactInput(artifact, ["path", "sha256", "intent"], "Artifact binding"); ensurePath(textInput(artifact.path, "artifact.path"));
			if (typeof artifact.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(artifact.sha256)) throw new CodepatrolError("INVALID_ARGUMENT", "artifact.sha256 must be lowercase SHA-256.", 2);
				if (!["create", "modify", "delete"].includes(artifact.intent as string)) throw new CodepatrolError("INVALID_ARGUMENT", "artifact.intent is required and must be create, modify, or delete.", 2);
		}
		if (value.stage === "apply" && !Array.isArray(value.changes)) throw new CodepatrolError("INVALID_ARGUMENT", "Apply checkpoint requires an explicit changes array.", 2);
		if (value.stage !== "apply" && value.changes !== undefined) throw new CodepatrolError("INVALID_ARGUMENT", "Only Apply may declare production changes.", 2);
		if (value.changes !== undefined && (!Array.isArray(value.changes) || value.changes.some((path) => typeof path !== "string"))) throw new CodepatrolError("INVALID_ARGUMENT", "changes must be an array of paths.", 2);
	}
}
function assertCloseInput(input: CloseInput): void {
	const value = requireObject(input, "Close"); exactInput(value, ["outcome", "actor", "authority"], "Close");
	if (value.outcome !== "commit" && value.outcome !== "rollback") throw new CodepatrolError("INVALID_ARGUMENT", "Close outcome must be commit or rollback.", 2);
	textInput(value.actor, "actor"); textInput(value.authority, "authority");
}
function eventMatchesIntent(event: ChangeEvent | undefined, intent: TransitionIntent): boolean {
	if (!event || event.stage !== intent.stage) return false;
	if (intent.type === "begin") return event.type === "stage-began" && event.actor === intent.actor && event.next_action === intent.nextAction;
	if (intent.type === "usage") return event.type === "run-recorded" && event.actor === intent.actor && event.run.id === intent.run.id;
	if (intent.type === "checkpoint") return event.type === "stage-checkpointed" && event.actor === intent.actor && event.result === intent.result && event.next_action === intent.nextAction && JSON.stringify(event.artifacts) === JSON.stringify(intent.artifacts) && JSON.stringify(event.changes ?? []) === JSON.stringify(intent.changes ?? []);
	if (intent.type === "return") return event.type === "stage-returned" && event.actor === intent.actor && event.to_stage === intent.toStage && event.reason === intent.reason && event.next_action === intent.nextAction;
	if (intent.type === "block") return event.type === "stage-blocked" && event.actor === intent.actor && event.reason === intent.reason && event.next_action === intent.nextAction;
	return event.type === "stage-resumed" && event.actor === intent.actor && event.next_action === intent.nextAction;
}
async function commitMetadata(git: GitAdapter, workId: string, message: string, signal?: AbortSignal): Promise<string> {
	await git.add([relativeRecord(workId)], signal); return git.commit(message, false, signal);
}

function baselineRef(record: ChangeRecordV2, checkpoint?: string): string {
	let prior = record.identity.base_commit;
	for (const event of record.events) {
		if (event.type !== "stage-checkpointed") continue;
		if (checkpoint && event.checkpoint === checkpoint) return prior;
		prior = event.checkpoint;
	}
	if (checkpoint) throw new CodepatrolError("CHANGE_DRIFT", `Checkpoint is not present in Change history: ${checkpoint}.`, 4);
	return prior;
}

async function materializeBaseline(git: GitAdapter, ref: string, bindings: ArtifactBinding[], signal?: AbortSignal): Promise<BaselineReader> {
	await git.tree(ref, signal);
	const entries = await Promise.all(bindings.map(async (binding) => [binding.path, await git.pathExists(ref, binding.path, signal)] as const));
	const existing = new Map(entries); return { exists: (path) => existing.get(path) ?? false };
}

async function validateWorkspaceArtifacts(git: GitAdapter, workspace: string, record: ChangeRecordV2, stage: Stage, bindings: ArtifactBinding[], checkpoint?: string, signal?: AbortSignal): Promise<void> {
	const baseline = await materializeBaseline(git, baselineRef(record, checkpoint), bindings, signal); validateStageArtifacts(workspace, record, stage, bindings, baseline);
}

async function validateRefArtifacts(git: GitAdapter, record: ChangeRecordV2, stage: Stage, attempt: StageAttempt, ref: string, signal?: AbortSignal): Promise<void> {
	if (!attempt.checkpoint) throw new CodepatrolError("CHANGE_DRIFT", `Accepted ${stage} attempt has no checkpoint.`, 4);
	const prefix = `.codepatrol/changes/${record.identity.work_id}/${stage}/`;
	const [contentEntries, files, baseline] = await Promise.all([
		Promise.all(attempt.artifacts.map(async (binding) => { const [exists, content] = await Promise.all([git.pathExists(ref, binding.path, signal), git.readFile(ref, binding.path, signal)]); return [binding.path, exists ? content ?? null : undefined] as const; })),
		git.files(ref, prefix, signal),
		materializeBaseline(git, baselineRef(record, attempt.checkpoint), attempt.artifacts, signal),
	]);
	const contents = new Map(contentEntries); const reader: ArtifactReader = { read: (path) => contents.get(path), files: () => files };
	validateStageArtifactsFromReader(record, stage, attempt.artifacts, reader, baseline);
}

async function validateAcceptedRefArtifacts(git: GitAdapter, record: ChangeRecordV2, ref: string, signal?: AbortSignal): Promise<void> {
	const view = foldChange(record);
	for (const stage of ["plan", "review", "apply", "verify"] as const) {
		const accepted = view.attempts[stage].filter((item) => item.status === "completed").at(-1); if (accepted) await validateRefArtifacts(git, record, stage, accepted, ref, signal);
	}
}

async function assertVerifiedCandidate(git: GitAdapter, view: ChangeView, ref: string, allowedPaths: string[], signal?: AbortSignal): Promise<void> {
	const verified = view.attempts.verify.filter((item) => item.status === "completed" && item.result === "commit").at(-1);
	if (!verified?.checkpoint || !verified.tree) throw new CodepatrolError("CHANGE_DRIFT", "Close requires an accepted Verify checkpoint and tree.", 4);
	if (await git.tree(verified.checkpoint, signal) !== verified.tree) throw new CodepatrolError("CHANGE_DRIFT", "Verify checkpoint tree does not match the recorded tree.", 4);
	const allowed = new Set(allowedPaths); const drift = (await git.changedPaths(verified.checkpoint, ref, signal)).filter((path) => !allowed.has(path));
	if (drift.length) throw new CodepatrolError("CHANGE_DRIFT", `Candidate changed after Verify: ${drift.join(", ")}.`, 4);
}

async function validateCheckpointLineage(git: GitAdapter, record: ChangeRecordV2, ref: string, signal?: AbortSignal): Promise<void> {
	const prefix: ChangeEvent[] = [];
	for (const event of record.events) {
		if (event.type === "stage-checkpointed") {
			if (!event.tree || await git.tree(event.checkpoint, signal) !== event.tree || !await git.isAncestor(event.checkpoint, ref, signal)) throw new CodepatrolError("CHANGE_DRIFT", `Checkpoint lineage is invalid for ${event.stage}#${event.attempt}.`, 4);
			const raw = await git.show(event.checkpoint, relativeRecord(record.identity.work_id), signal);
			if (!raw) throw new CodepatrolError("CHANGE_DRIFT", `Checkpoint ${event.checkpoint} is missing its Change record.`, 4);
			const checkpointRecord = recordFromYaml(raw); const expected: ChangeRecordV2 = { ...record, events: structuredClone(prefix) };
			foldChange(checkpointRecord); foldChange(expected);
			if (JSON.stringify(checkpointRecord) !== JSON.stringify(expected)) throw new CodepatrolError("CHANGE_DRIFT", `Checkpoint record prefix drifted for ${event.stage}#${event.attempt}.`, 4);
		}
		prefix.push(event);
	}
}

export async function startChange(workspace: string, input: StartChangeInput, options: OperationOptions = {}): Promise<ChangeView> {
	assertStartInput(input);
	return withWorkspaceLock(workspace, "change-git", "change.start", () => startChangeLocked(workspace, input, options), { signal: options.signal });
}

async function startChangeLocked(workspace: string, input: StartChangeInput, options: OperationOptions): Promise<ChangeView> {
	const git = gitFor(workspace, options); await git.assertTrusted(options.signal);
	if (parseStatusPaths(await git.status(options.signal)).length) throw new CodepatrolError("CHANGE_CONFLICT", "Change start requires a clean worktree.", 4);
	const current = await git.currentBranch(options.signal); if (current !== input.targetBranch) throw new CodepatrolError("CHANGE_CONFLICT", `Expected target branch ${input.targetBranch}, found ${current}.`, 4);
	const branch = `codepatrol/${input.workId}`; const terminal = (await git.refs("refs/tags/codepatrol", options.signal)).some((ref) => ref.endsWith(`/${input.workId}`));
	if (await git.branchExists(branch, options.signal) || existsSync(changeRecordPath(workspace, input.workId)) || terminal) throw new CodepatrolError("CHANGE_CONFLICT", `Change already exists: ${input.workId}.`, 4);
	const base = await git.head("HEAD", options.signal); const at = now(options).toISOString();
	const record: ChangeRecordV2 = { schema_version: 2, identity: { work_id: input.workId, title: input.title, created_at: at, branch, target_branch: input.targetBranch, base_commit: base }, events: [{ id: randomUUID(), type: "change-started", at, actor: input.actor, stage: "plan", attempt: 1, next_action: input.nextAction ?? `codepatrol-plan ${input.workId} on ${branch}` }] };
	foldChange(record);
	let branchCreated = false; let recordOwned = false;
	try {
		await git.createBranch(branch, base, options.signal);
		branchCreated = true; recordOwned = true;
		writeChangeRecord(workspace, record); try { trace.append(workspace, input.workId, { kind: "event", at: now(options).toISOString(), stage: "plan", attempt: 1, type: "change-started" }); } catch { /* trace is fire-and-forget */ } await commitMetadata(git, input.workId, `chore(codepatrol): start ${input.workId}`, options.signal); return foldChange(record);
	} catch (cause) {
		if (recordOwned) {
			try { await git.unstage([relativeRecord(input.workId)]); } catch { /* Preserve the original start failure. */ }
			rmSync(changeDirectoryForCleanup(workspace, input.workId), { recursive: true, force: true });
		}
		if (branchCreated) {
			try { if (await git.currentBranch() === branch) await git.checkout(input.targetBranch); } catch { /* Preserve the original start failure. */ }
			try { if (await git.branchExists(branch)) await git.deleteBranch(branch, base); } catch { /* Preserve the original start failure. */ }
		}
		try { trace.close(workspace, input.workId); } catch { /* Preserve the original start failure. */ }
		throw cause;
	}
}

function changeDirectoryForCleanup(workspace: string, workId: string): string {
	return resolveInside(workspace, `.codepatrol/changes/${workId}`);
}

async function assertCurrentBranch(git: GitAdapter, view: ChangeView, signal?: AbortSignal): Promise<void> {
	const branch = await git.currentBranch(signal); if (branch !== view.identity.branch) throw new CodepatrolError("CHANGE_CONFLICT", `Expected branch ${view.identity.branch}, found ${branch}.`, 4);
}

export async function transitionChange(workspace: string, workId: string, intent: TransitionIntent, options: OperationOptions = {}): Promise<ChangeView> {
	assertTransitionIntent(intent);
	return withWorkspaceLock(workspace, "change-git", "change.transition", () => transitionChangeLocked(workspace, workId, intent, options), { signal: options.signal });
}

async function transitionChangeLocked(workspace: string, workId: string, intent: TransitionIntent, options: OperationOptions): Promise<ChangeView> {
	const git = gitFor(workspace, options); await git.assertTrusted(options.signal);
	let record = readChangeRecord(workspace, workId); let view = foldChange(record); await assertCurrentBranch(git, view, options.signal); await validateCheckpointLineage(git, record, "HEAD", options.signal);
	if (intent.stage === "close") await assertVerifiedCandidate(git, view, "HEAD", [relativeRecord(workId)], options.signal);
	if (eventMatchesIntent(record.events.at(-1), intent)) {
		const statusPaths = parseStatusPaths(await git.status(options.signal));
		if (statusPaths.length === 0) return view;
		if (statusPaths.length === 1 && statusPaths[0] === relativeRecord(workId)) {
			await commitMetadata(git, workId, `chore(codepatrol): recover ${intent.type} ${intent.stage} ${workId}`, options.signal); return view;
		}
		throw new CodepatrolError("CHANGE_CONFLICT", `Transition recovery found unrelated worktree paths: ${statusPaths.join(", ")}.`, 4);
	}
	if (intent.stage !== view.stage) throw new CodepatrolError("CHANGE_CONFLICT", `Expected ${view.stage}, received ${intent.stage}.`, 4);
	let event: ChangeEvent;
	if (intent.type === "checkpoint") {
		const required: Record<string, string[]> = {
			plan: [`.codepatrol/changes/${workId}/plan/spec.md`, `.codepatrol/changes/${workId}/plan/plan.md`],
			review: [`.codepatrol/changes/${workId}/review/report.md`],
			apply: [`.codepatrol/changes/${workId}/apply/journal.md`],
			verify: [`.codepatrol/changes/${workId}/verify/report.md`],
		};
		const declared = new Set(intent.artifacts.map((item) => item.path)); const missing = required[intent.stage].filter((path) => !intent.artifacts.some((item) => item.path === path && item.intent !== "delete"));
		if (missing.length) throw new CodepatrolError("CHANGE_INVALID", `Checkpoint is missing required ${intent.stage} artifacts: ${missing.join(", ")}.`, 4);
		await validateWorkspaceArtifacts(git, workspace, record, intent.stage, intent.artifacts, undefined, options.signal);
		const paths = [...intent.artifacts.filter((item) => item.intent !== "delete").map((item) => item.path), ...(intent.changes ?? [])]; paths.forEach(ensurePath);
		const allowed = new Set([...paths, ...intent.artifacts.filter((item) => item.intent === "delete").map((item) => item.path), relativeRecord(workId)]);
		const prior = baselineRef(record); const dirty = parseStatusPaths(await git.status(options.signal)); const committed = await git.changedPaths(prior, "HEAD", options.signal); const candidate = [...new Set([...committed, ...dirty])];
		const unexpected = candidate.filter((path) => !allowed.has(path));
		if (unexpected.length) throw new CodepatrolError("CHANGE_CONFLICT", `Checkpoint has undeclared worktree paths: ${unexpected.join(", ")}.`, 4);
		const actualProduction = candidate.filter((path) => !path.startsWith(`.codepatrol/changes/${workId}/`)).sort(); const declaredProduction = [...(intent.changes ?? [])].sort();
		if (JSON.stringify(actualProduction) !== JSON.stringify(declaredProduction)) throw new CodepatrolError("CHANGE_CONFLICT", "Apply changes do not match the complete candidate production delta.", 4);
		await git.add([...new Set([...paths, ...intent.artifacts.map((item) => item.path)])], options.signal);
		const checkpoint = await git.commit(`chore(codepatrol): ${intent.stage} content ${workId}`, true, options.signal); const tree = await git.tree(checkpoint, options.signal);
		const finalDelta = await git.changedPaths(prior, checkpoint, options.signal); const unexpectedFinal = finalDelta.filter((path) => !allowed.has(path)); const finalProduction = finalDelta.filter((path) => !path.startsWith(`.codepatrol/changes/${workId}/`)).sort();
		if (unexpectedFinal.length || JSON.stringify(finalProduction) !== JSON.stringify(declaredProduction)) throw new CodepatrolError("CHANGE_CONFLICT", "Checkpoint commit does not match its declared artifact and production paths.", 4);
		event = { ...eventBase(view, intent.actor, options), type: "stage-checkpointed", stage: intent.stage, result: intent.result, checkpoint, tree, artifacts: intent.artifacts, ...(intent.stage === "apply" ? { changes: intent.changes ?? [] } : {}), next_action: intent.nextAction };
	} else if (intent.type === "begin") event = { ...eventBase(view, intent.actor, options), type: "stage-began", next_action: intent.nextAction };
	else if (intent.type === "usage") {
		const target = view.attempts[intent.stage].at(-1); if (!target || target.status === "invalidated") throw new CodepatrolError("CHANGE_CONFLICT", `No accepted ${intent.stage} attempt can receive usage.`, 4);
		event = { id: randomUUID(), at: now(options).toISOString(), actor: intent.actor, stage: intent.stage, attempt: target.attempt, type: "run-recorded", run: intent.run };
	}
	else if (intent.type === "return") event = { ...eventBase(view, intent.actor, options), type: "stage-returned", to_stage: intent.toStage, reason: intent.reason, next_action: intent.nextAction };
	else if (intent.type === "block") event = { ...eventBase(view, intent.actor, options), type: "stage-blocked", reason: intent.reason, next_action: intent.nextAction };
	else event = { ...eventBase(view, intent.actor, options), type: "stage-resumed", next_action: intent.nextAction };
	record = await appendChangeEvent(workspace, workId, event, options); try { trace.append(workspace, workId, { kind: "event", at: now(options).toISOString(), stage: event.stage, attempt: "attempt" in event ? event.attempt : 0, type: event.type }); } catch { /* trace is fire-and-forget */ } await commitMetadata(git, workId, `chore(codepatrol): ${intent.type} ${intent.stage} ${workId}`, options.signal); return foldChange(record);
}

function recordFromYaml(raw: string): ChangeRecordV2 {
	const parsed = parse(raw) as any;
	if (parsed && Array.isArray(parsed.events)) {
		for (const event of parsed.events) {
			if (event.run && "tokens" in event.run) {
				event.run.characters = event.run.tokens;
				delete event.run.tokens;
			}
		}
	}
	return parsed as ChangeRecordV2;
}
export async function inspectChanges(workspace: string, query: ChangeQuery = {}, options: OperationOptions = {}): Promise<ChangeView[]> {
	const git = gitFor(workspace, options); await git.assertTrusted(options.signal); const records = new Map<string, { record: ChangeRecordV2; source: string }>(); const terminalHeads = new Map<string, string>();
	const addRecord = (id: string, record: ChangeRecordV2, source: string): void => {
		const existing = records.get(id);
		if (existing && JSON.stringify(existing.record) !== JSON.stringify(record)) throw new CodepatrolError("CHANGE_CONFLICT", `Conflicting Change copies for ${id}: ${existing.source} and ${source}.`, 4);
		if (!existing) records.set(id, { record, source });
	};
	for (const id of listWorkingTreeChangeIds(workspace)) {
		const record = readChangeRecord(workspace, id); const view = foldChange(record);
		for (const stage of ["plan", "review", "apply", "verify"] as const) {
			const accepted = view.attempts[stage].filter((item) => item.status === "completed").at(-1); if (accepted) await validateWorkspaceArtifacts(git, workspace, record, stage, accepted.artifacts, accepted.checkpoint, options.signal);
		}
		addRecord(id, record, "working tree");
	}
	for (const ref of await git.refs("refs/heads/codepatrol", options.signal)) {
		const id = ref.slice("codepatrol/".length); const head = await git.head(ref, options.signal); const raw = await git.show(head, relativeRecord(id), options.signal);
		if (!raw) throw new CodepatrolError("CHANGE_DRIFT", `Active branch ${ref} is missing ${relativeRecord(id)}.`, 4);
			const record = recordFromYaml(raw); foldChange(record); await validateCheckpointLineage(git, record, head, options.signal); await validateAcceptedRefArtifacts(git, record, head, options.signal);
		if (await git.head(ref, options.signal) !== head) throw new CodepatrolError("CHANGE_CONFLICT", `Active branch moved during inspection: ${ref}.`, 4);
		addRecord(id, record, ref);
	}
	if (query.all) for (const prefix of ["refs/tags/codepatrol/committed", "refs/tags/codepatrol/rolled-back"]) for (const ref of await git.refs(prefix, options.signal)) {
		const id = ref.split("/").at(-1)!; const head = await git.head(ref, options.signal);
		if (terminalHeads.has(id) && terminalHeads.get(id) !== head) throw new CodepatrolError("CHANGE_CONFLICT", `Conflicting terminal refs for Change ${id}.`, 4);
		terminalHeads.set(id, head); const raw = await git.show(head, relativeRecord(id), options.signal);
		if (!raw) throw new CodepatrolError("CHANGE_DRIFT", `Terminal tag ${ref} is missing ${relativeRecord(id)}.`, 4);
			const record = recordFromYaml(raw); foldChange(record); await validateCheckpointLineage(git, record, head, options.signal); await validateAcceptedRefArtifacts(git, record, head, options.signal);
		if (await git.head(ref, options.signal) !== head) throw new CodepatrolError("CHANGE_CONFLICT", `Terminal tag moved during inspection: ${ref}.`, 4);
		addRecord(id, record, ref);
	}
	const views = [...records.values()].map(({ record }) => { const view = foldChange(record); const terminalCommit = terminalHeads.get(view.identity.work_id); return terminalCommit ? { ...view, terminalCommit } : view; }); const filtered = query.workId ? views.filter((view) => view.identity.work_id === query.workId) : views;
	if (query.workId && filtered.length !== 1) throw new CodepatrolError("CHANGE_NOT_FOUND", `Change not found: ${query.workId}.`, 4);
	return filtered.sort((a, b) => a.identity.created_at.localeCompare(b.identity.created_at) || a.identity.work_id.localeCompare(b.identity.work_id));
}

export async function closeChange(workspace: string, workId: string, input: CloseInput, options: OperationOptions = {}): Promise<CloseResult> {
	assertCloseInput(input);
	return withWorkspaceLock(workspace, "change-git", "change.close", () => closeChangeLocked(workspace, workId, input, options), { signal: options.signal });
}

async function closeChangeLocked(workspace: string, workId: string, input: CloseInput, options: OperationOptions): Promise<CloseResult> {
	const git = gitFor(workspace, options); await git.assertTrusted(options.signal);
	const requestedOutcome = input.outcome === "commit" ? "committed" : "rolled-back";
	const requestedTag = `codepatrol/${requestedOutcome}/${workId}`;
	const terminalRefs = await git.refs("refs/tags/codepatrol", options.signal);
	const existingTag = terminalRefs.find((ref) => ref === requestedTag);
	const oppositeTag = terminalRefs.find((ref) => ref.endsWith(`/${workId}`) && ref !== requestedTag);
	if (oppositeTag) throw new CodepatrolError("CHANGE_CONFLICT", `Change already has terminal tag ${oppositeTag}.`, 4);
	let record: ChangeRecordV2;
	if (existsSync(changeRecordPath(workspace, workId))) record = readChangeRecord(workspace, workId);
	else {
		const raw = existingTag ? await git.show(existingTag, relativeRecord(workId), options.signal) : undefined;
		if (!raw) throw new CodepatrolError("CHANGE_NOT_FOUND", `Change not found: ${workId}.`, 4);
		record = recordFromYaml(raw);
	}
	let view = foldChange(record); await validateCheckpointLineage(git, record, existingTag ?? "HEAD", options.signal);
	if (view.state === "terminal") {
		if (view.outcome !== requestedOutcome) throw new CodepatrolError("CHANGE_CONFLICT", `Change is already ${view.outcome}.`, 4);
		await assertVerifiedCandidate(git, view, existingTag ?? "HEAD", [relativeRecord(workId), `.codepatrol/changes/${workId}/close/receipt.md`, `.codepatrol/changes/${workId}/close/improvement-report.md`, `docs/codepatrol/improvement-reports/${workId}.md`], options.signal);
		const recoveryPaths = parseStatusPaths(await git.status(options.signal)); const allowedRecovery = existingTag ? new Set<string>([relativeRecord(workId), `.codepatrol/changes/${workId}/close/receipt.md`, `.codepatrol/changes/${workId}/close/improvement-report.md`, `docs/codepatrol/improvement-reports/${workId}.md`]) : new Set([relativeRecord(workId)]); const unexpectedRecovery = recoveryPaths.filter((path) => !allowedRecovery.has(path));
		if (unexpectedRecovery.length) throw new CodepatrolError("CHANGE_CONFLICT", `Close recovery found unrelated worktree paths: ${unexpectedRecovery.join(", ")}.`, 4);
		let tag = existingTag;
		if (!tag) {
			await assertCurrentBranch(git, view, options.signal);
			const statusPaths = parseStatusPaths(await git.status(options.signal));
			if (statusPaths.some((path) => path !== relativeRecord(workId))) throw new CodepatrolError("CHANGE_CONFLICT", `Close recovery found unrelated worktree paths: ${statusPaths.join(", ")}.`, 4);
			if (statusPaths.length) await commitMetadata(git, workId, `chore(codepatrol): ${requestedOutcome} ${workId}`, options.signal);
			const terminalHead = await git.head("HEAD", options.signal);
			await git.tag(requestedTag, terminalHead, options.signal);
			tag = requestedTag;
		}
		const terminalCommit = await git.head(tag, options.signal);
		if (await git.branchExists(view.identity.branch, options.signal)) {
			const branchHead = await git.head(view.identity.branch, options.signal);
			if (branchHead !== terminalCommit) throw new CodepatrolError("CHANGE_DRIFT", `Feature branch advanced after terminal tag ${tag}.`, 4);
		}
		await completeFinalization(git, view, input.outcome, tag, terminalCommit, options.signal);
		return { outcome: requestedOutcome, workId, targetBranch: view.identity.target_branch, terminalCommit, tag };
	}
	await assertCurrentBranch(git, view, options.signal);
	if (view.stage !== "close" || view.state !== "active" || !view.attempts.close.at(-1)?.runs.some((run) => run.finished_at)) throw new CodepatrolError("CHANGE_CONFLICT", "Close must be active with a finished run.", 4);
	await assertVerifiedCandidate(git, view, "HEAD", [relativeRecord(workId)], options.signal);
	const receiptPath = `.codepatrol/changes/${workId}/close/receipt.md`;
	const statusPaths = parseStatusPaths(await git.status(options.signal));
	if (statusPaths.some((path) => path !== receiptPath)) throw new CodepatrolError("CHANGE_CONFLICT", `Close requires a clean worktree; found ${statusPaths.join(", ")}.`, 4);
	const targetHead = await git.head(view.identity.target_branch, options.signal); if (targetHead !== view.identity.base_commit) throw new CodepatrolError("TARGET_ADVANCED", `Target advanced from ${view.identity.base_commit} to ${targetHead}.`, 4);
	const outcome = requestedOutcome; const tag = requestedTag; const at = now(options).toISOString();
	const absolute = resolveInside(workspace, receiptPath); mkdirSync(resolveInside(workspace, `.codepatrol/changes/${workId}/close`), { recursive: true });
	writeFileSync(absolute, `# Close receipt\n\n- Work: \`${workId}\`\n- Outcome: \`${outcome}\`\n- Target: \`${view.identity.target_branch}\`\n- Base: \`${view.identity.base_commit}\`\n- Authority: ${input.authority}\n- Recorded at: \`${at}\`\n`, "utf8");
	await git.add([receiptPath], options.signal); const receiptCommit = await git.commit(`chore(codepatrol): ${outcome} receipt ${workId}`, false, options.signal);
	const event: ChangeEvent = { ...eventBase(view, input.actor, { ...options, now: new Date(at) }), type: "change-closed", stage: "close", outcome, commit: receiptCommit, tag, receipt: "close/receipt.md" };
	await appendChangeEvent(workspace, workId, event, options); try { trace.append(workspace, workId, { kind: "event", at: now(options).toISOString(), stage: event.stage, attempt: 0, type: event.type }); } catch { /* trace is fire-and-forget */ }
	let reportPath: string | undefined; try { reportPath = writeImprovementReport(workspace, workId); mirrorImprovementReport(workspace, workId, reportPath); } catch (cause) { process.stderr.write(`[close] improvement report failed: ${(cause as Error).message}\n`); }
	const pathsToCommit = [relativeRecord(workId)]; if (reportPath) pathsToCommit.push(reportPath);
	await git.add(pathsToCommit, options.signal); const terminalCommit = await git.commit(`chore(codepatrol): ${outcome} ${workId}`, false, options.signal); await git.tag(tag, terminalCommit, options.signal);
	view = foldChange({ ...record, events: [...record.events, event] });
	try { trace.close(workspace, workId); } catch { /* trace cleanup is best-effort */ }
	await completeFinalization(git, view, input.outcome, tag, terminalCommit, options.signal);
	return { outcome, workId, targetBranch: view.identity.target_branch, terminalCommit, tag };
}

async function completeFinalization(git: GitAdapter, view: ChangeView, outcome: CloseInput["outcome"], tag: string, terminalCommit: string, signal?: AbortSignal): Promise<void> {
	const targetHead = await git.head(view.identity.target_branch, signal);
	if (outcome === "rollback" && targetHead !== view.identity.base_commit) throw new CodepatrolError("TARGET_ADVANCED", `Rollback target advanced from ${view.identity.base_commit} to ${targetHead}.`, 4);
	if (outcome === "commit" && targetHead !== view.identity.base_commit && targetHead !== terminalCommit) throw new CodepatrolError("TARGET_ADVANCED", `Commit target is neither the recorded base nor terminal commit: ${targetHead}.`, 4);
	const current = await git.currentBranch(signal);
	if (current !== view.identity.branch && current !== view.identity.target_branch) throw new CodepatrolError("CHANGE_CONFLICT", `Close recovery found unrelated branch ${current}.`, 4);
	if (current !== view.identity.target_branch) await git.checkout(view.identity.target_branch, signal);
	if (outcome === "commit") {
		await closeWork(git, view, tag, terminalCommit, signal);
	} else if (outcome === "rollback") {
		const checkedOutHead = await git.head("HEAD", signal);
		if (checkedOutHead !== view.identity.base_commit) throw new CodepatrolError("TARGET_ADVANCED", "Target changed during rollback.", 4);
		if (await git.branchExists(view.identity.branch, signal)) await git.deleteBranch(view.identity.branch, terminalCommit, signal);
	}
	if (parseStatusPaths(await git.status(signal)).length) throw new CodepatrolError("CHANGE_CONFLICT", "Close postcondition requires a clean worktree.", 4);
}

async function closeWork(git: GitAdapter, view: ChangeView, tag: string, terminalCommit: string, signal?: AbortSignal): Promise<void> {
	const checkedOutHead = await git.head("HEAD", signal);
	if (checkedOutHead === view.identity.base_commit) await git.mergeFf(tag, signal);
	else if (checkedOutHead !== terminalCommit) throw new CodepatrolError("TARGET_ADVANCED", "Target changed during Close.", 4);
	if (await git.branchExists(view.identity.branch, signal)) await git.deleteBranch(view.identity.branch, terminalCommit, signal);
}
