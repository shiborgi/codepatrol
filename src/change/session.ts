import { existsSync, readFileSync } from "node:fs";
import { atomicWriteJson } from "../shared/atomic-store.js";
import { CodepatrolError } from "../shared/errors.js";
import { withWorkspaceLock } from "../shared/lock.js";
import { stageSessionPath } from "../shared/state.js";
import { resolveInside } from "../shared/workspace.js";
import { foldChange } from "./model.js";
import { readChangeRecord } from "./store.js";
import { STAGES, type Stage } from "./types.js";

export interface SessionItem { id: string; title: string; status: "open" | "claimed" | "closed"; dependencies: string[]; claim?: { actor: string; at: string }; result?: string; artifacts?: string[] }
export interface StageSession { schema_version: 1; work_id: string; stage: Stage; attempt: number; items: SessionItem[]; next_action: string; updated_at: string }
const forbidden = new Set(["lifecycle", "revision", "approval", "terminal", "conversation", "messages", "transcript"]);

function validate(session: StageSession): void {
	const keys = new Set(["schema_version", "work_id", "stage", "attempt", "items", "next_action", "updated_at"]);
	for (const key of Object.keys(session)) {
		if (forbidden.has(key)) throw new CodepatrolError("CHANGE_INVALID", `Stage Session cannot own ${key}.`, 4);
		if (!keys.has(key)) throw new CodepatrolError("CHANGE_INVALID", `Stage Session contains unknown field ${key}.`, 4);
	}
	if (session.schema_version !== 1 || !/^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*$/.test(session.work_id) || !STAGES.includes(session.stage) || !Number.isSafeInteger(session.attempt) || session.attempt < 1) throw new CodepatrolError("CHANGE_INVALID", "Stage Session identity is invalid.", 4);
	if (!session.next_action?.trim() || !Number.isFinite(Date.parse(session.updated_at)) || !Array.isArray(session.items) || !session.items.length) throw new CodepatrolError("CHANGE_INVALID", "Stage Session content is incomplete.", 4);
	const ids = new Set<string>();
	for (const item of session.items) {
		const allowed = new Set(["id", "title", "status", "dependencies", "claim", "result", "artifacts"]);
		for (const key of Object.keys(item)) if (!allowed.has(key)) throw new CodepatrolError("CHANGE_INVALID", `Session item ${item.id ?? "?"} contains unknown field ${key}.`, 4);
		if (!item.id?.trim() || ids.has(item.id) || !item.title?.trim() || !["open", "claimed", "closed"].includes(item.status) || !Array.isArray(item.dependencies)) throw new CodepatrolError("CHANGE_INVALID", "Stage Session item is invalid or duplicated.", 4);
		ids.add(item.id);
		if (item.result && item.result.length > 4000) throw new CodepatrolError("CHANGE_INVALID", `Session item ${item.id} result exceeds 4000 characters.`, 4);
		for (const path of item.artifacts ?? []) if (!path || path.startsWith("/") || path.split("/").includes("..") || path.length > 500) throw new CodepatrolError("CHANGE_INVALID", `Session item ${item.id} contains an unsafe artifact path.`, 4);
	}
	for (const item of session.items) for (const dependency of item.dependencies) if (!ids.has(dependency) || dependency === item.id) throw new CodepatrolError("CHANGE_INVALID", `Session item ${item.id} has invalid dependency ${dependency}.`, 4);
	const visiting = new Set<string>(); const visited = new Set<string>();
	const visit = (id: string): void => {
		if (visiting.has(id)) throw new CodepatrolError("CHANGE_INVALID", `Stage Session dependency cycle includes ${id}.`, 4);
		if (visited.has(id)) return; visiting.add(id);
		for (const dependency of session.items.find((item) => item.id === id)!.dependencies) visit(dependency);
		visiting.delete(id); visited.add(id);
	};
	for (const id of ids) visit(id);
	if (JSON.stringify(session).length > 256_000) throw new CodepatrolError("CHANGE_INVALID", "Stage Session exceeds 256 KB.", 4);
}
function write(workspace: string, session: StageSession): StageSession { validate(session); atomicWriteJson(stageSessionPath(workspace, session.work_id, session.stage, session.attempt), session); return session; }
function deriveItems(workspace: string, workId: string, stage: Stage): SessionItem[] {
	if (stage !== "apply") return [{ id: `${stage}-work`, title: `Complete ${stage} stage contract`, status: "open", dependencies: [] }];
	const planPath = resolveInside(workspace, `.codepatrol/changes/${workId}/plan/plan.md`);
	if (!existsSync(planPath)) return [{ id: "apply-work", title: "Complete apply stage contract", status: "open", dependencies: [] }];
	const source = readFileSync(planPath, "utf8");
	const matches = [...source.matchAll(/^### (T\d+)\s+[—-]\s+(.+)$/gm)];
	const items = matches.map((match, index): SessionItem => {
		const end = matches[index + 1]?.index ?? source.length;
		const section = source.slice(match.index! + match[0].length, end);
		const dependenciesLine = section.match(/^\*\*Depends on:\*\*\s*(.+)$/m)?.[1] ?? "None";
		const dependencies = /^(none|nothing)$/i.test(dependenciesLine.trim()) ? [] : [...dependenciesLine.matchAll(/\bT\d+\b/g)].map((item) => item[0]);
		return { id: match[1], title: match[2].trim(), status: "open", dependencies };
	});
	return items.length ? items : [{ id: "apply-work", title: "Complete apply stage contract", status: "open", dependencies: [] }];
}

export function primeStageSession(workspace: string, workId: string, stage: Stage, attempt: number, now = new Date()): StageSession {
	const view = foldChange(readChangeRecord(workspace, workId));
	if (view.stage !== stage || view.attempt !== attempt || view.state === "terminal") throw new CodepatrolError("CHANGE_CONFLICT", `Session ${stage}/${attempt} is not the current attempt.`, 4);
	const path = stageSessionPath(workspace, workId, stage, attempt);
	if (existsSync(path)) {
		try {
			const session = JSON.parse(readFileSync(path, "utf8")) as StageSession;
			validate(session);
			if (session.work_id === workId && session.stage === stage && session.attempt === attempt) return session;
		} catch { /* Rebuild disposable corruption. */ }
	}
	return write(workspace, { schema_version: 1, work_id: workId, stage, attempt, items: deriveItems(workspace, workId, stage), next_action: view.nextAction ?? `Continue ${stage} for ${workId}.`, updated_at: now.toISOString() });
}
export function readySessionItems(session: StageSession): SessionItem[] { return session.items.filter((item) => item.status === "open" && item.dependencies.every((id) => session.items.find((candidate) => candidate.id === id)?.status === "closed")); }
export async function claimSessionItem(workspace: string, workId: string, stage: Stage, attempt: number, itemId: string, actor: string, now = new Date()): Promise<StageSession> {
	return withWorkspaceLock(workspace, `session-${workId}-${stage}-${attempt}`, "change.session.claim", () => {
		const session = primeStageSession(workspace, workId, stage, attempt, now); const item = readySessionItems(session).find((candidate) => candidate.id === itemId);
		if (!item) throw new CodepatrolError("CHANGE_CONFLICT", `Session item is not ready: ${itemId}.`, 4);
		item.status = "claimed"; item.claim = { actor, at: now.toISOString() }; session.updated_at = now.toISOString(); return write(workspace, session);
	});
}
export async function closeSessionItem(workspace: string, workId: string, stage: Stage, attempt: number, itemId: string, result: string, artifacts: string[] = [], now = new Date()): Promise<StageSession> {
	return withWorkspaceLock(workspace, `session-${workId}-${stage}-${attempt}`, "change.session.close", () => {
		const session = primeStageSession(workspace, workId, stage, attempt, now); const item = session.items.find((candidate) => candidate.id === itemId);
		if (!item || item.status !== "claimed") throw new CodepatrolError("CHANGE_CONFLICT", `Session item is not claimed: ${itemId}.`, 4);
		item.status = "closed"; item.result = result.slice(0, 4000); item.artifacts = artifacts; session.updated_at = now.toISOString(); return write(workspace, session);
	});
}
export function discardAndRebuildSession(workspace: string, workId: string, stage: Stage, attempt: number, now = new Date()): StageSession {
	const view = foldChange(readChangeRecord(workspace, workId));
	if (view.stage !== stage || view.attempt !== attempt || view.state === "terminal") throw new CodepatrolError("CHANGE_CONFLICT", `Session ${stage}/${attempt} is not the current attempt.`, 4);
	return write(workspace, { schema_version: 1, work_id: workId, stage, attempt, items: deriveItems(workspace, workId, stage), next_action: view.nextAction ?? `Continue ${stage}.`, updated_at: now.toISOString() });
}
