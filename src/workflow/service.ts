import { createHash, randomUUID } from "node:crypto";
import { atomicWriteJson } from "../shared/atomic-store.js";
import { CodepatrolError } from "../shared/errors.js";
import { withWorkspaceLock } from "../shared/lock.js";
import { resolveInside } from "../shared/workspace.js";
import { readWorkflowLedger, writeWorkflowLedger } from "./store.js";
import {
	CLOSED_WORKFLOW_STATUS,
	WORKFLOW_KINDS,
	WORKFLOW_RELATIONS,
	WORKFLOW_STATUSES,
	type CloseWorkflowResult,
	type CreateWorkflowInput,
	type PrimeWorkflowResult,
	type RememberWorkflowInput,
	type UpdateWorkflowInput,
	type WorkflowItemV1,
	type WorkflowKind,
	type WorkflowLedgerV1,
	type WorkflowRelation,
	type WorkflowRootSummary,
	type WorkflowStatus,
} from "./types.js";
import { assertNextActionInvariant } from "./types.js";

interface OperationOptions {
	signal?: AbortSignal;
	now?: Date;
}

interface ListWorkflowOptions {
	workflowId?: string;
	status?: WorkflowStatus;
}

interface PrimeWorkflowOptions {
	workflowId?: string;
	budget?: number;
}

interface CompactWorkflowOptions {
	workflowId?: string;
	olderThanDays?: number;
}

const ACTIONABLE_KINDS = new Set<WorkflowKind>(["task", "decision"]);

function invalid(message: string, details?: unknown): never {
	throw new CodepatrolError("WORKFLOW_INVALID", message, 4, false, details);
}

function notFound(id: string): never {
	throw new CodepatrolError("WORKFLOW_NOT_FOUND", `Workflow item not found: ${id}.`, 4, false, { id });
}

function conflict(message: string, details?: unknown): never {
	throw new CodepatrolError("WORKFLOW_CONFLICT", message, 5, true, details);
}

function nonEmptyString(value: unknown, field: string, maximum = 4_000): string {
	if (typeof value !== "string" || !value.trim()) invalid(`${field} must be a non-empty string.`);
	if (value.length > maximum) invalid(`${field} must not exceed ${maximum} characters.`);
	return value.trim();
}

function optionalString(value: unknown, field: string, maximum = 20_000): string {
	if (value === undefined) return "";
	if (typeof value !== "string") invalid(`${field} must be a string.`);
	if (value.length > maximum) invalid(`${field} must not exceed ${maximum} characters.`);
	return value.trim();
}

function stringList(value: unknown, field: string, maximum = 100): string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.length > maximum) invalid(`${field} must be an array with at most ${maximum} entries.`);
	return value.map((entry, index) => nonEmptyString(entry, `${field}[${index}]`, 4_000));
}

function priority(value: unknown): number {
	if (value === undefined) return 2;
	if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 4) invalid("priority must be an integer from 0 to 4.");
	return value as number;
}

function relationList(value: unknown): WorkflowRelation[] {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.length > 200) invalid("relations must be an array with at most 200 entries.");
	return value.map((entry, index) => {
		if (!entry || typeof entry !== "object") invalid(`relations[${index}] must be an object.`);
		const relation = entry as { type?: unknown; targetId?: unknown };
		if (!WORKFLOW_RELATIONS.includes(relation.type as never)) invalid(`relations[${index}].type is unsupported.`);
		return { type: relation.type as WorkflowRelation["type"], targetId: nonEmptyString(relation.targetId, `relations[${index}].targetId`, 100) };
	});
}

function getItem(ledger: WorkflowLedgerV1, id: string): WorkflowItemV1 {
	return ledger.items[id] ?? notFound(id);
}

function generateId(ledger: WorkflowLedgerV1, title: string, now: Date): string {
	for (;;) {
		const digest = createHash("sha256").update(`${randomUUID()}\0${now.toISOString()}\0${title}`).digest("hex").slice(0, 12);
		const id = `cpw-${digest}`;
		if (!ledger.items[id]) return id;
	}
}

function validateStatus(status: unknown): WorkflowStatus {
	if (!WORKFLOW_STATUSES.includes(status as never)) invalid(`Unsupported workflow status: ${String(status)}.`);
	return status as WorkflowStatus;
}

function validateKind(kind: unknown): WorkflowKind {
	if (!WORKFLOW_KINDS.includes(kind as never)) invalid(`Unsupported workflow kind: ${String(kind)}.`);
	return kind as WorkflowKind;
}

function validateReferences(ledger: WorkflowLedgerV1, item: WorkflowItemV1): void {
	const root = ledger.items[item.workflowId];
	if (!root || root.kind !== "workflow" || root.workflowId !== root.id) invalid(`workflowId must reference a workflow root: ${item.workflowId}.`);
	if (item.parentId) {
		if (item.kind === "workflow") invalid("A workflow root cannot have a parent.");
		const parent = ledger.items[item.parentId];
		if (!parent || parent.workflowId !== item.workflowId) invalid(`parentId must reference an item in workflow ${item.workflowId}.`);
		if (parent.id === item.id) invalid("An item cannot be its own parent.");
	}
	for (const relation of item.relations) {
		const target = ledger.items[relation.targetId];
		if (!target) invalid(`Relation target does not exist: ${relation.targetId}.`);
		if (target.id === item.id) invalid("An item cannot relate to itself.");
		if (relation.type === "blocks" && target.workflowId !== item.workflowId) invalid("Blocking relations must stay within one workflow.");
	}
}

function validateNoParentCycles(ledger: WorkflowLedgerV1): void {
	for (const item of Object.values(ledger.items)) {
		const seen = new Set<string>([item.id]);
		let parentId = item.parentId;
		while (parentId) {
			if (seen.has(parentId)) invalid(`Workflow parent hierarchy contains a cycle at ${parentId}.`);
			seen.add(parentId);
			parentId = ledger.items[parentId]?.parentId;
		}
	}
}

function validateNoBlockingCycles(ledger: WorkflowLedgerV1): void {
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const visit = (id: string): void => {
		if (visiting.has(id)) invalid(`Blocking relations contain a cycle at ${id}.`);
		if (visited.has(id)) return;
		visiting.add(id);
		for (const relation of ledger.items[id]?.relations ?? []) if (relation.type === "blocks") visit(relation.targetId);
		visiting.delete(id);
		visited.add(id);
	};
	for (const id of Object.keys(ledger.items)) visit(id);
}

function blockerIds(ledger: WorkflowLedgerV1, targetId: string): string[] {
	return Object.values(ledger.items)
		.filter((item) => item.status !== "closed" && item.relations.some((relation) => relation.type === "blocks" && relation.targetId === targetId))
		.map((item) => item.id);
}

function sortItems(items: WorkflowItemV1[]): WorkflowItemV1[] {
	return items.sort((left, right) => left.priority - right.priority || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
}

function readyFromLedger(ledger: WorkflowLedgerV1, workflowId?: string): WorkflowItemV1[] {
	return sortItems(Object.values(ledger.items).filter((item) => {
		if (workflowId && item.workflowId !== workflowId) return false;
		if (!ACTIONABLE_KINDS.has(item.kind) || item.status !== "open") return false;
		const root = ledger.items[item.workflowId];
		return root?.status !== "closed" && blockerIds(ledger, item.id).length === 0;
	}));
}

function touch(ledger: WorkflowLedgerV1, now: Date): void {
	ledger.updatedAt = now.toISOString();
}

async function mutate<T>(workspace: string, command: string, options: OperationOptions, fn: (ledger: WorkflowLedgerV1, now: Date) => T): Promise<T> {
	return withWorkspaceLock(workspace, "workflow", command, () => {
		const now = options.now ?? new Date();
		const ledger = readWorkflowLedger(workspace, now);
		const result = fn(ledger, now);
		touch(ledger, now);
		writeWorkflowLedger(workspace, ledger);
		return result;
	}, { signal: options.signal });
}

function createInLedger(ledger: WorkflowLedgerV1, input: CreateWorkflowInput, now: Date): WorkflowItemV1 {
	if (!input || typeof input !== "object") invalid("Workflow input must be an object.");
	const kind = validateKind(input.kind);
	const id = generateId(ledger, input.title, now);
	const workflowId = kind === "workflow" ? id : nonEmptyString(input.workflowId, "workflowId", 100);
	if (kind === "workflow" && input.workflowId) invalid("A workflow root cannot specify workflowId.");
	const status = input.status === undefined ? "open" : validateStatus(input.status);
	if (status === "in-progress") invalid("Create work as open and use workflow claim to start it.");
	if (status !== "closed" && input.nextAction === undefined) invalid("nextAction must be a non-empty string while status is not closed.");
	const nextActionValue = input.nextAction === undefined ? undefined : nonEmptyString(input.nextAction, "nextAction", 4_000);
	const item: WorkflowItemV1 = {
		schemaVersion: 1,
		id,
		workflowId,
		kind,
		scope: input.scope ?? "workflow",
		title: nonEmptyString(input.title, "title"),
		summary: optionalString(input.summary, "summary"),
		...(nextActionValue === undefined ? {} : { nextAction: nextActionValue }),
		status,
		priority: priority(input.priority),
		...(input.parentId === undefined ? {} : { parentId: nonEmptyString(input.parentId, "parentId", 100) }),
		relations: relationList(input.relations),
		acceptance: stringList(input.acceptance, "acceptance"),
		artifacts: stringList(input.artifacts, "artifacts", 200),
		createdAt: now.toISOString(),
		updatedAt: now.toISOString(),
		...(status === "closed" ? { closedAt: now.toISOString() } : {}),
	};
	if (item.scope !== "project" && item.scope !== "workflow") invalid("scope must be project or workflow.");
	ledger.items[id] = item;
	validateReferences(ledger, item);
	validateNoBlockingCycles(ledger);
	validateNoParentCycles(ledger);
	return item;
}

export async function createWorkflowItem(workspace: string, input: CreateWorkflowInput, options: OperationOptions = {}): Promise<WorkflowItemV1> {
	return mutate(workspace, "workflow.create", options, (ledger, now) => createInLedger(ledger, input, now));
}

export async function updateWorkflowItem(workspace: string, id: string, input: UpdateWorkflowInput, options: OperationOptions = {}): Promise<WorkflowItemV1> {
	return mutate(workspace, "workflow.update", options, (ledger, now) => {
		if (!input || typeof input !== "object" || Array.isArray(input)) invalid("Workflow update must be an object.");
		const item = getItem(ledger, id);
		if (item.status === "closed") conflict(`Closed workflow item cannot be updated: ${id}.`);
		if (input.status === "in-progress") invalid("Use workflow claim to start an item.");
		if (input.status === "closed") invalid("Use workflow close with a result to close an item.");
		if (input.title !== undefined) item.title = nonEmptyString(input.title, "title");
		if (input.summary !== undefined) item.summary = optionalString(input.summary, "summary");
		if (input.nextAction !== undefined) {
			if (input.nextAction === null) invalid("Use workflow close with a result to clear nextAction.");
			item.nextAction = nonEmptyString(input.nextAction, "nextAction", 4_000);
		}
		if (input.status !== undefined) {
			item.status = validateStatus(input.status);
			if (item.status === "closed") item.closedAt = now.toISOString();
			if (item.status !== "in-progress") delete item.claim;
		}
		if (input.priority !== undefined) item.priority = priority(input.priority);
		if (input.parentId !== undefined) {
			if (input.parentId === null) delete item.parentId;
			else item.parentId = nonEmptyString(input.parentId, "parentId", 100);
		}
		if (input.relations !== undefined) item.relations = relationList(input.relations);
		if (input.acceptance !== undefined) item.acceptance = stringList(input.acceptance, "acceptance");
		if (input.artifacts !== undefined) item.artifacts = stringList(input.artifacts, "artifacts", 200);
		item.updatedAt = now.toISOString();
		validateReferences(ledger, item);
		validateNoBlockingCycles(ledger);
		validateNoParentCycles(ledger);
		return item;
	});
}

export async function showWorkflowItem(workspace: string, id: string): Promise<WorkflowItemV1> {
	return getItem(readWorkflowLedger(workspace), id);
}

export async function listWorkflowItems(workspace: string, options: ListWorkflowOptions = {}): Promise<WorkflowItemV1[]> {
	const ledger = readWorkflowLedger(workspace);
	return sortItems(Object.values(ledger.items).filter((item) =>
		(!options.workflowId || item.workflowId === options.workflowId) && (!options.status || item.status === options.status),
	));
}

export async function readyWorkflowItems(workspace: string, workflowId?: string): Promise<WorkflowItemV1[]> {
	const ledger = readWorkflowLedger(workspace);
	if (workflowId) {
		const root = getItem(ledger, workflowId);
		if (root.kind !== "workflow") invalid(`${workflowId} is not a workflow root.`);
	}
	return readyFromLedger(ledger, workflowId);
}

export function listWorkflowRoots(workspace: string, options: { all?: boolean } = {}): WorkflowRootSummary[] {
	const ledger = readWorkflowLedger(workspace);
	return Object.values(ledger.items)
		.filter((item) => item.kind === "workflow" && (options.all || item.status !== "closed"))
		.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
		.map((root) => {
			const own = Object.values(ledger.items).filter((item) => item.workflowId === root.id && item.id !== root.id);
			return {
				id: root.id,
				title: root.title,
				status: root.status,
				updatedAt: root.updatedAt,
				...(root.nextAction ? { nextAction: root.nextAction } : {}),
				counts: {
					ready: readyFromLedger(ledger, root.id).length,
					active: own.filter((item) => item.status === "in-progress").length,
					blocked: own.filter((item) => ["blocked", "waiting-user"].includes(item.status)).length,
				},
			};
		});
}

export async function claimWorkflowItem(workspace: string, id: string, actor: string, options: OperationOptions = {}): Promise<WorkflowItemV1> {
	return mutate(workspace, "workflow.claim", options, (ledger, now) => {
		const item = getItem(ledger, id);
		const claimedBy = item.claim?.actor;
		if (item.status === "in-progress" && claimedBy === actor) return item;
		if (item.status !== "open") conflict(`Workflow item ${id} is ${item.status}${claimedBy ? ` and claimed by ${claimedBy}` : ""}.`, { id, claimedBy });
		if (!ACTIONABLE_KINDS.has(item.kind)) conflict(`Workflow item ${id} is not actionable.`);
		const blockers = blockerIds(ledger, id);
		if (blockers.length) conflict(`Workflow item ${id} is blocked.`, { id, blockers });
		item.status = "in-progress";
		item.claim = { actor: nonEmptyString(actor, "actor", 200), claimedAt: now.toISOString() };
		item.updatedAt = now.toISOString();
		return item;
	});
}

export async function closeWorkflowItem(workspace: string, id: string, result: CloseWorkflowResult, options: OperationOptions = {}): Promise<WorkflowItemV1> {
	return mutate(workspace, "workflow.close", options, (ledger, now) => {
		if (!result || typeof result !== "object") invalid("Workflow result must be an object.");
		const item = getItem(ledger, id);
		if (item.status === "closed") return item;
		if (item.kind === "task" && item.status !== "in-progress") conflict(`Task ${id} must be claimed before it can close.`);
		if (item.kind === "workflow") {
			const unfinished = Object.values(ledger.items).filter((candidate) => candidate.workflowId === id && candidate.id !== id && candidate.status !== "closed");
			if (unfinished.length) conflict(`Workflow ${id} has unfinished items.`, { id, unfinished: unfinished.map((candidate) => candidate.id) });
		}
		item.summary = nonEmptyString(result.summary, "summary", 20_000);
		item.artifacts = [...new Set([...item.artifacts, ...stringList(result.artifacts, "artifacts", 200)])];
		item.status = CLOSED_WORKFLOW_STATUS;
		item.closedAt = now.toISOString();
		item.updatedAt = now.toISOString();
		delete item.nextAction;
		return item;
	});
}

export async function rememberWorkflow(workspace: string, input: RememberWorkflowInput, options: OperationOptions = {}): Promise<WorkflowItemV1> {
	if (!input || typeof input !== "object") invalid("Workflow memory input must be an object.");
	return mutate(workspace, "workflow.remember", options, (ledger, now) => createInLedger(ledger, {
		kind: "memory",
		workflowId: input.workflowId,
		scope: input.scope ?? "project",
		title: input.title,
		summary: input.summary,
		artifacts: input.artifacts,
		relations: input.relations,
		status: "closed",
	}, now));
}

function boundedContext(lines: string[], maximum: number): string {
	let context = "";
	for (const line of lines) {
		const separator = context ? "\n" : "";
		const available = maximum - context.length - separator.length;
		if (available <= 0) break;
		context += separator + (line.length <= available ? line : `${line.slice(0, Math.max(0, available - 1))}…`);
	}
	return context;
}

export async function primeWorkflow(workspace: string, options: PrimeWorkflowOptions = {}): Promise<PrimeWorkflowResult> {
	const budget = options.budget ?? 1_200;
	if (!Number.isInteger(budget) || budget < 128 || budget > 16_000) invalid("budget must be an integer from 128 to 16000 tokens.");
	const ledger = readWorkflowLedger(workspace);
	const roots = Object.values(ledger.items).filter((item) => item.kind === "workflow").sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
	const root = options.workflowId ? getItem(ledger, options.workflowId) : roots.find((item) => item.status !== "closed") ?? roots[0];
	if (!root || root.kind !== "workflow") notFound(options.workflowId ?? "active workflow");
	const others = options.workflowId
		? []
		: roots.filter((item) => item.id !== root.id && item.status !== "closed");
	const own = Object.values(ledger.items).filter((item) => item.workflowId === root.id);
	const projectMemories = Object.values(ledger.items).filter((item) => item.kind === "memory" && item.scope === "project");
	const memories = [...new Map([...projectMemories, ...own.filter((item) => item.kind === "memory")].map((item) => [item.id, item])).values()];
	const ready = readyFromLedger(ledger, root.id);
	const active = own.filter((item) => item.status === "in-progress");
	const blocked = own.filter((item) => item.status !== "closed" && (["blocked", "waiting-user"].includes(item.status) || blockerIds(ledger, item.id).length > 0));
	const decisions = own.filter((item) => item.kind === "decision" && item.status === "closed");
	const completed = own.filter((item) => item.status === "closed" && item.kind === "task").sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 5);
	const lines = [
		`# Resume — ${root.title} (${root.id})`,
		...(root.summary ? [`Objective: ${root.summary}`] : []),
		...active.map((item) => `In progress: ${item.title}${item.nextAction ? ` — next: ${item.nextAction}` : ""}${item.claim ? ` (${item.claim.actor})` : ""}`),
		...ready.map((item) => `Ready: ${item.title}${item.nextAction ? ` — next: ${item.nextAction}` : ""}`),
		...blocked.map((item) => `Blocked: ${item.title}${item.nextAction ? ` — ${item.nextAction}` : ""}`),
		...decisions.map((item) => `Decision: ${item.title} — ${item.summary}`),
		...memories.map((item) => `Memory: ${item.title} — ${item.summary}${item.artifacts.length ? ` [${item.artifacts.join(", ")}]` : ""}`),
		...completed.map((item) => `Completed: ${item.title} — ${item.summary}`),
	];
	return {
		workflowId: root.id,
		context: boundedContext(lines, budget * 4),
		...(others.length
			? { otherActiveWorkflows: others.map(({ id, title, status, updatedAt }) => ({ id, title, status, updatedAt })) }
			: {}),
		counts: { ready: ready.length, active: active.length, blocked: blocked.length, decisions: decisions.length, memories: memories.length, completed: completed.length },
	};
}

export async function compactWorkflow(workspace: string, options: CompactWorkflowOptions = {}, operation: OperationOptions = {}): Promise<{ compacted: string[] }> {
	const olderThanDays = options.olderThanDays ?? 30;
	if (!Number.isFinite(olderThanDays) || olderThanDays < 0) invalid("olderThanDays must be zero or greater.");
	return mutate(workspace, "workflow.compact", operation, (ledger, now) => {
		const cutoff = now.getTime() - olderThanDays * 86_400_000;
		const candidates = Object.values(ledger.items).filter((item) =>
			item.status === "closed"
			&& (item.kind === "task" || item.kind === "evidence")
			&& !item.compacted
			&& (!options.workflowId || item.workflowId === options.workflowId)
			&& item.closedAt !== undefined
			&& new Date(item.closedAt).getTime() <= cutoff,
		);
		for (const item of candidates) {
			const archive = `.codepatrol/workflows/archive/${item.id}.json`;
			atomicWriteJson(resolveInside(workspace, archive), item);
			if (item.summary.length > 400) item.summary = `${item.summary.slice(0, 399)}…`;
			item.acceptance = [];
			item.compacted = { compactedAt: now.toISOString(), archive };
			item.updatedAt = now.toISOString();
		}
		return { compacted: candidates.map((item) => item.id) };
	});
}
