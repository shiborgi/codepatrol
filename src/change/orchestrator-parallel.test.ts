import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startChange, transitionChange, inspectChanges } from "./orchestrator.js";
import { CodepatrolError } from "../shared/errors.js";

function git(workspace: string, args: string[]): string { return execFileSync("git", args, { cwd: workspace, encoding: "utf8" }).trim(); }
function binding(workspace: string, path: string) { return { path, sha256: createHash("sha256").update(readFileSync(join(workspace, path))).digest("hex"), intent: "create" as const }; }
function at(second: number) { return { now: new Date(`2026-07-24T10:00:${String(second).padStart(2, "0")}.000Z`) }; }
function writeGitignore(workspace: string): void { writeFileSync(join(workspace, ".gitignore"), ".codepatrol/runtime/\ndocs/codepatrol/improvement-reports/\n"); }
function initRepo(workspace: string): void { writeGitignore(workspace); git(workspace, ["init", "-b", "main"]); writeFileSync(join(workspace, "README.md"), "baseline\n"); git(workspace, ["add", "."]); git(workspace, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "baseline"]); }

describe("orchestrator parallel aggregation", () => {
	test("two parallel reviewer personas both succeed without prematurely advancing the stage", async () => {
		const workspace = mkdtempSync(join(tmpdir(), "codepatrol-parallel-"));
		try {
			initRepo(workspace);
			const id = "2026-07-24-parallel-approve";
			await startChange(workspace, { workId: id, title: "Parallel reviewers", targetBranch: "main", actor: "codex" }, at(1));
			mkdirSync(join(workspace, `.codepatrol/changes/${id}/plan`), { recursive: true });
			writeFileSync(join(workspace, `.codepatrol/changes/${id}/plan/spec.md`), "spec\n");
			writeFileSync(join(workspace, `.codepatrol/changes/${id}/plan/plan.md`), "plan\n");
			const planArtifacts = [binding(workspace, `.codepatrol/changes/${id}/plan/spec.md`), binding(workspace, `.codepatrol/changes/${id}/plan/plan.md`)];
			await transitionChange(workspace, id, { type: "usage", actor: "codex", stage: "plan", run: { id: "plan-usage", started_at: "2026-07-24T10:00:03.000Z", finished_at: "2026-07-24T10:00:04.000Z", elapsed_ms: 1000, characters: { status: "unavailable", reason: "test" } } }, at(2));
			await transitionChange(workspace, id, { type: "checkpoint", actor: "codex", stage: "plan", result: "ready", artifacts: planArtifacts, nextAction: "review" }, at(3));
			await transitionChange(workspace, id, { type: "begin", actor: "codex", stage: "review", nextAction: "review" }, at(4));
			await transitionChange(workspace, id, { type: "usage", actor: "codex", stage: "review", run: { id: "review-base", started_at: "2026-07-24T10:00:05.000Z", finished_at: "2026-07-24T10:00:06.000Z", elapsed_ms: 1000, characters: { status: "unavailable", reason: "test" } } }, at(5));
			mkdirSync(join(workspace, `.codepatrol/changes/${id}/review`), { recursive: true });
			writeFileSync(join(workspace, `.codepatrol/changes/${id}/review/findings-security.md`), "security review\n");
			const persona1Artifacts = [binding(workspace, `.codepatrol/changes/${id}/review/findings-security.md`)];
			const viewAfter1 = await transitionChange(workspace, id, { type: "checkpoint", actor: "codex-security", stage: "review", result: "approve", artifacts: persona1Artifacts, nextAction: "review-consolidate", persona: "review-security" }, at(6));
			assert.equal(viewAfter1.stage, "review", "first persona checkpoint must not advance the stage");
			assert.equal(viewAfter1.attempts.review.at(-1)?.status, "active", "first persona checkpoint must leave attempt active");

			writeFileSync(join(workspace, `.codepatrol/changes/${id}/review/findings-architecture.md`), "architecture review\n");
			const persona2Artifacts = [binding(workspace, `.codepatrol/changes/${id}/review/findings-architecture.md`)];
			const viewAfter2 = await transitionChange(workspace, id, { type: "checkpoint", actor: "codex-architecture", stage: "review", result: "approve", artifacts: persona2Artifacts, nextAction: "review-consolidate", persona: "review-architecture" }, at(7));
			assert.equal(viewAfter2.stage, "review", "second persona checkpoint must not advance the stage");
			assert.equal(viewAfter2.attempts.review.at(-1)?.status, "active", "second persona checkpoint must leave attempt active");

			writeFileSync(join(workspace, `.codepatrol/changes/${id}/review/report.md`), "consolidated review\n");
			const consolidationArtifacts = [
				{ path: `.codepatrol/changes/${id}/review/report.md`, sha256: createHash("sha256").update(readFileSync(join(workspace, `.codepatrol/changes/${id}/review/report.md`))).digest("hex"), intent: "create" as const },
				{ path: `.codepatrol/changes/${id}/review/findings-security.md`, sha256: createHash("sha256").update(readFileSync(join(workspace, `.codepatrol/changes/${id}/review/findings-security.md`))).digest("hex"), intent: "modify" as const },
				{ path: `.codepatrol/changes/${id}/review/findings-architecture.md`, sha256: createHash("sha256").update(readFileSync(join(workspace, `.codepatrol/changes/${id}/review/findings-architecture.md`))).digest("hex"), intent: "modify" as const },
			];
			const viewAfterConsolidation = await transitionChange(workspace, id, { type: "checkpoint", actor: "codex", stage: "review", result: "approve", artifacts: consolidationArtifacts, nextAction: "apply" }, at(8));
			assert.equal(viewAfterConsolidation.stage, "apply", "consolidation must advance the stage");
			assert.equal(viewAfterConsolidation.attempts.review.at(-1)?.status, "completed");
		} finally { rmSync(workspace, { recursive: true, force: true }); }
	});

	test("divergence (one approve + one persona-approved) keeps the attempt active until a return event", async () => {
		const workspace = mkdtempSync(join(tmpdir(), "codepatrol-parallel-"));
		try {
			initRepo(workspace);
			const id = "2026-07-24-parallel-divergence";
			await startChange(workspace, { workId: id, title: "Parallel divergence", targetBranch: "main", actor: "codex" }, at(1));
			mkdirSync(join(workspace, `.codepatrol/changes/${id}/plan`), { recursive: true });
			writeFileSync(join(workspace, `.codepatrol/changes/${id}/plan/spec.md`), "spec\n");
			writeFileSync(join(workspace, `.codepatrol/changes/${id}/plan/plan.md`), "plan\n");
			const planArtifacts = [binding(workspace, `.codepatrol/changes/${id}/plan/spec.md`), binding(workspace, `.codepatrol/changes/${id}/plan/plan.md`)];
			await transitionChange(workspace, id, { type: "usage", actor: "codex", stage: "plan", run: { id: "plan-usage", started_at: "2026-07-24T10:00:03.000Z", finished_at: "2026-07-24T10:00:04.000Z", elapsed_ms: 1000, characters: { status: "unavailable", reason: "test" } } }, at(2));
			await transitionChange(workspace, id, { type: "checkpoint", actor: "codex", stage: "plan", result: "ready", artifacts: planArtifacts, nextAction: "review" }, at(3));
			await transitionChange(workspace, id, { type: "begin", actor: "codex", stage: "review", nextAction: "review" }, at(4));
			await transitionChange(workspace, id, { type: "usage", actor: "codex", stage: "review", run: { id: "review-base", started_at: "2026-07-24T10:00:05.000Z", finished_at: "2026-07-24T10:00:06.000Z", elapsed_ms: 1000, characters: { status: "unavailable", reason: "test" } } }, at(5));
			mkdirSync(join(workspace, `.codepatrol/changes/${id}/review`), { recursive: true });
			writeFileSync(join(workspace, `.codepatrol/changes/${id}/review/findings-security.md`), "security review\n");
			await transitionChange(workspace, id, { type: "return", actor: "codex-security", stage: "review", toStage: "plan", reason: "architecture: missing boundary check", nextAction: "review-consolidate", persona: "review-security" }, at(6));
			const view = (await inspectChanges(workspace, { workId: id }))[0]!;
			assert.equal(view.stage, "review");
			assert.equal(view.attempts.review.at(-1)?.status, "active");
			
			// Try to consolidate with approve checkpoint, should fail due to divergence
			await assert.rejects(
				transitionChange(workspace, id, { type: "checkpoint", actor: "codex", stage: "review", result: "approve", artifacts: [binding(workspace, `.codepatrol/changes/${id}/review/findings-security.md`)], nextAction: "apply" }, at(7)),
				(err: CodepatrolError) => err.code === "CONSOLIDATION_AFTER_SUBEVENTS"
			);
		} finally { rmSync(workspace, { recursive: true, force: true }); }
	});
});
