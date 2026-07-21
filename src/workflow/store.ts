import { existsSync, readFileSync } from "node:fs";
import { atomicWriteJson } from "../shared/atomic-store.js";
import { CodepatrolError } from "../shared/errors.js";
import { workflowLedgerPath } from "../shared/state.js";
import { WORKFLOW_KINDS, WORKFLOW_LEDGER_VERSION, WORKFLOW_RELATIONS, WORKFLOW_STATUSES, type WorkflowItemV1, type WorkflowLedgerV1 } from "./types.js";

function validDate(value: unknown): boolean {
	return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validStringList(value: unknown): boolean {
	return Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry.length > 0);
}

function validItem(value: unknown, key: string): value is WorkflowItemV1 {
	if (!value || typeof value !== "object") return false;
	const item = value as Partial<WorkflowItemV1>;
	return item.schemaVersion === 1
		&& item.id === key
		&& typeof item.workflowId === "string"
		&& WORKFLOW_KINDS.includes(item.kind as never)
		&& (item.scope === "project" || item.scope === "workflow")
		&& typeof item.title === "string"
		&& typeof item.summary === "string"
		&& WORKFLOW_STATUSES.includes(item.status as never)
		&& Number.isInteger(item.priority) && (item.priority ?? -1) >= 0 && (item.priority ?? 5) <= 4
		&& Array.isArray(item.relations)
		&& item.relations.every((relation) => relation && WORKFLOW_RELATIONS.includes(relation.type as never) && typeof relation.targetId === "string")
		&& validStringList(item.acceptance)
		&& validStringList(item.artifacts)
		&& validDate(item.createdAt)
		&& validDate(item.updatedAt)
		&& (item.closedAt === undefined || validDate(item.closedAt))
		&& (item.claim === undefined || (typeof item.claim.actor === "string" && validDate(item.claim.claimedAt)))
		&& (item.compacted === undefined || (validDate(item.compacted.compactedAt) && typeof item.compacted.archive === "string"));
}

export function emptyWorkflowLedger(now = new Date()): WorkflowLedgerV1 {
	return { version: WORKFLOW_LEDGER_VERSION, updatedAt: now.toISOString(), items: {} };
}

export function readWorkflowLedger(workspace: string, now = new Date()): WorkflowLedgerV1 {
	const path = workflowLedgerPath(workspace);
	if (!existsSync(path)) return emptyWorkflowLedger(now);
	let value: unknown;
	try {
		value = JSON.parse(readFileSync(path, "utf8"));
	} catch {
		throw new CodepatrolError("WORKFLOW_INVALID", "Workflow ledger is not valid JSON.", 4, false, { path });
	}
	if (!value || typeof value !== "object" || (value as { version?: unknown }).version !== WORKFLOW_LEDGER_VERSION) {
		throw new CodepatrolError("STATE_INCOMPATIBLE", `Workflow ledger version must be ${WORKFLOW_LEDGER_VERSION}.`, 4, false, { path });
	}
	const ledger = value as WorkflowLedgerV1;
	if (!validDate(ledger.updatedAt) || !ledger.items || typeof ledger.items !== "object" || Array.isArray(ledger.items)) {
		throw new CodepatrolError("WORKFLOW_INVALID", "Workflow ledger root is structurally invalid.", 4, false, { path });
	}
	for (const [key, item] of Object.entries(ledger.items)) {
		if (!validItem(item, key)) throw new CodepatrolError("WORKFLOW_INVALID", `Workflow ledger item is structurally invalid: ${key}.`, 4, false, { path, id: key });
	}
	return ledger;
}

export function writeWorkflowLedger(workspace: string, ledger: WorkflowLedgerV1): void {
	atomicWriteJson(workflowLedgerPath(workspace), ledger);
}
