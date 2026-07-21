export const WORKFLOW_LEDGER_VERSION = 1 as const;

export const WORKFLOW_KINDS = ["workflow", "task", "decision", "evidence", "memory"] as const;
export type WorkflowKind = typeof WORKFLOW_KINDS[number];

export const WORKFLOW_STATUSES = ["open", "in-progress", "blocked", "waiting-user", "deferred", "closed"] as const;
export type WorkflowStatus = typeof WORKFLOW_STATUSES[number];

export const CLOSED_WORKFLOW_STATUS = "closed" as const;

export const WORKFLOW_RELATIONS = ["blocks", "relates-to", "duplicates", "supersedes", "replies-to"] as const;
export type WorkflowRelationType = typeof WORKFLOW_RELATIONS[number];

export type WorkflowScope = "project" | "workflow";

/**
 * The runtime invariant enforced by the workflow ledger is that every
 * non-closed item carries a non-empty `nextAction`, while a closed item
 * may omit it. The field is declared optional on the persisted type
 * because the same JSON shape encodes both states; consumers that need
 * the discriminated view should narrow through `assertNextAction`.
 */
export interface WorkflowRelation {
	type: WorkflowRelationType;
	targetId: string;
}

export interface WorkflowClaim {
	actor: string;
	claimedAt: string;
}

export interface WorkflowCompaction {
	compactedAt: string;
	archive: string;
}

export interface WorkflowItemV1 {
	schemaVersion: 1;
	id: string;
	workflowId: string;
	kind: WorkflowKind;
	scope: WorkflowScope;
	title: string;
	summary: string;
	nextAction?: string;
	status: WorkflowStatus;
	priority: number;
	parentId?: string;
	relations: WorkflowRelation[];
	acceptance: string[];
	artifacts: string[];
	claim?: WorkflowClaim;
	createdAt: string;
	updatedAt: string;
	closedAt?: string;
	compacted?: WorkflowCompaction;
}

export interface WorkflowLedgerV1 {
	version: 1;
	updatedAt: string;
	items: Record<string, WorkflowItemV1>;
}

export interface CreateWorkflowInput {
	kind: WorkflowKind;
	workflowId?: string;
	scope?: WorkflowScope;
	title: string;
	summary?: string;
	nextAction?: string;
	status?: WorkflowStatus;
	priority?: number;
	parentId?: string;
	relations?: WorkflowRelation[];
	acceptance?: string[];
	artifacts?: string[];
}

export interface UpdateWorkflowInput {
	title?: string;
	summary?: string;
	nextAction?: string | null;
	status?: WorkflowStatus;
	priority?: number;
	parentId?: string | null;
	relations?: WorkflowRelation[];
	acceptance?: string[];
	artifacts?: string[];
}

export interface RememberWorkflowInput {
	workflowId: string;
	scope?: WorkflowScope;
	title: string;
	summary: string;
	artifacts?: string[];
	relations?: WorkflowRelation[];
}

export interface CloseWorkflowResult {
	summary: string;
	artifacts?: string[];
}

export interface ActiveWorkflowSummary {
	id: string;
	title: string;
	status: WorkflowStatus;
	updatedAt: string;
}

export interface WorkflowRootSummary {
	id: string;
	title: string;
	status: WorkflowStatus;
	updatedAt: string;
	nextAction?: string;
	counts: {
		ready: number;
		active: number;
		blocked: number;
	};
}

export interface PrimeWorkflowResult {
	workflowId: string;
	context: string;
	otherActiveWorkflows?: ActiveWorkflowSummary[];
	counts: {
		ready: number;
		active: number;
		blocked: number;
		decisions: number;
		memories: number;
		completed: number;
	};
}

/**
 * Runtime check used by the ledger validator and by the create/update
 * paths to enforce the conditional `nextAction` invariant.
 */
export function assertNextActionInvariant(item: { status: WorkflowStatus; nextAction?: string }, path: string): void {
	if (item.status === CLOSED_WORKFLOW_STATUS) {
		if (item.nextAction !== undefined && (typeof item.nextAction !== "string" || item.nextAction.length === 0)) {
			throw new Error(`Closed item ${path} may not carry an empty nextAction.`);
		}
		return;
	}
	if (typeof item.nextAction !== "string" || item.nextAction.length === 0) {
		throw new Error(`Non-closed item ${path} must carry a non-empty nextAction.`);
	}
}
