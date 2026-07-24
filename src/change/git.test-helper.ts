import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { startChange, transitionChange } from "./orchestrator.js";

function git(workspace: string, args: string[]): string { return execFileSync("git", args, { cwd: workspace, encoding: "utf8" }).trim(); }
function binding(workspace: string, path: string) { return { path, sha256: createHash("sha256").update(readFileSync(join(workspace, path))).digest("hex"), intent: "create" as const }; }
function at(second: number) { return { now: new Date(`2026-07-22T10:00:${String(second).padStart(2, "0")}.000Z`) }; }

export async function advanceThroughVerify(workspace: string, id: string): Promise<void> {
	await startChange(workspace, { workId: id, title: "Verified candidate", targetBranch: "main", actor: "codex" }, at(1));
	for (const [index, stage] of (["plan", "review", "apply", "verify"] as const).entries()) {
		if (stage !== "plan") await transitionChange(workspace, id, { type: "begin", actor: "codex", stage, nextAction: `complete ${stage}` }, at(2 + index * 3));
		const dir = join(workspace, `.codepatrol/changes/${id}/${stage}`); mkdirSync(dir, { recursive: true }); const name = stage === "plan" ? "spec.md" : stage === "review" ? "report.md" : stage === "apply" ? "journal.md" : "report.md"; const path = `.codepatrol/changes/${id}/${stage}/${name}`; writeFileSync(join(workspace, path), `${stage}\n`); const artifacts = [binding(workspace, path)];
		if (stage === "plan") { const planPath = `.codepatrol/changes/${id}/plan/plan.md`; writeFileSync(join(workspace, planPath), "plan\n"); artifacts.push(binding(workspace, planPath)); }
		await transitionChange(workspace, id, { type: "usage", actor: "codex", stage, run: { id: `${stage}-${id}`, started_at: `2026-07-22T10:00:${String(3 + index * 3).padStart(2, "0")}.000Z`, finished_at: `2026-07-22T10:00:${String(4 + index * 3).padStart(2, "0")}.000Z`, elapsed_ms: 1000, characters: { status: "unavailable", reason: "test" } } }, at(4 + index * 3));
		const result = stage === "plan" ? "ready" : stage === "review" ? "approve" : stage === "apply" ? "implemented" : "commit";
		await transitionChange(workspace, id, { type: "checkpoint", actor: "codex", stage, result, artifacts, ...(stage === "apply" ? { changes: [] } : {}), nextAction: `continue ${id}` }, at(5 + index * 3));
	}
}
