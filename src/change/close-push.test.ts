import { createHash } from "node:crypto";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startChange, transitionChange, closeChange } from "./orchestrator.js";
import { NodeGitAdapter } from "./git.js";
import { CodepatrolError } from "../shared/errors.js";

function git(workspace: string, args: string[]): string { return execFileSync("git", args, { cwd: workspace, encoding: "utf8" }).trim(); }
function at(second: number) { return { now: new Date(`2026-07-24T10:00:${String(second).padStart(2, "0")}.000Z`) }; }

describe("close push integration", () => {
	test("close output includes push suggestion and performs opt-in push when flag is true", async () => {
		const root = mkdtempSync(join(tmpdir(), "codepatrol-push-"));
		const remoteDir = join(root, "remote");
		const workspace = join(root, "workspace");
		try {
			mkdirSync(remoteDir);
			git(remoteDir, ["init", "--bare", "-b", "main"]);

			mkdirSync(workspace);
			git(workspace, ["init", "-b", "main"]);
			writeFileSync(join(workspace, ".gitignore"), ".codepatrol/runtime/\ndocs/codepatrol/improvement-reports/\n");
			writeFileSync(join(workspace, "README.md"), "baseline\n");
			git(workspace, ["add", "."]);
			git(workspace, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "baseline"]);
			git(workspace, ["remote", "add", "origin", remoteDir]);
			
			const id = "2026-07-24-push-test";
			await startChange(workspace, { workId: id, title: "Test push", targetBranch: "main", actor: "codex" }, at(1));
			
			let pushCalled = false;
			const mockGit = new NodeGitAdapter(workspace);
			mockGit.push = async (remote: string, branch: string, signal?: AbortSignal) => {
				pushCalled = true;
				return await new NodeGitAdapter(workspace).push(remote, branch, signal);
			};

			const closeOpts = { now: at(2).now, git: mockGit };

			const hashOf = (p: string) => createHash("sha256").update(readFileSync(join(workspace, p))).digest("hex");
			const h = (p: string) => ({ path: p, sha256: hashOf(p), intent: "create" as const });

			mkdirSync(join(workspace, `.codepatrol/changes/${id}/plan`), { recursive: true });
			writeFileSync(join(workspace, `.codepatrol/changes/${id}/plan/spec.md`), "s\n");
			writeFileSync(join(workspace, `.codepatrol/changes/${id}/plan/plan.md`), "p\n");
			await transitionChange(workspace, id, { type: "usage", actor: "test", stage: "plan", run: { id: "p1", started_at: at(2).now.toISOString(), finished_at: at(3).now.toISOString(), elapsed_ms: 1000, characters: { status: "unavailable", reason: "test" } } }, closeOpts);
			await transitionChange(workspace, id, { type: "checkpoint", actor: "test", stage: "plan", result: "ready", nextAction: "next", artifacts: [h(`.codepatrol/changes/${id}/plan/spec.md`), h(`.codepatrol/changes/${id}/plan/plan.md`)] }, closeOpts);
			
			await transitionChange(workspace, id, { type: "begin", actor: "test", stage: "review", nextAction: "next" }, closeOpts);
			await transitionChange(workspace, id, { type: "usage", actor: "test", stage: "review", run: { id: "r1", started_at: at(4).now.toISOString(), finished_at: at(5).now.toISOString(), elapsed_ms: 1000, characters: { status: "unavailable", reason: "test" } } }, closeOpts);
			mkdirSync(join(workspace, `.codepatrol/changes/${id}/review`), { recursive: true });
			writeFileSync(join(workspace, `.codepatrol/changes/${id}/review/report.md`), "r\n");
			await transitionChange(workspace, id, { type: "checkpoint", actor: "test", stage: "review", result: "approve", nextAction: "next", artifacts: [h(`.codepatrol/changes/${id}/review/report.md`)] }, closeOpts);
			
			await transitionChange(workspace, id, { type: "begin", actor: "test", stage: "apply", nextAction: "next" }, closeOpts);
			await transitionChange(workspace, id, { type: "usage", actor: "test", stage: "apply", run: { id: "a1", started_at: at(6).now.toISOString(), finished_at: at(7).now.toISOString(), elapsed_ms: 1000, characters: { status: "unavailable", reason: "test" } } }, closeOpts);
			mkdirSync(join(workspace, `.codepatrol/changes/${id}/apply`), { recursive: true });
			writeFileSync(join(workspace, `.codepatrol/changes/${id}/apply/journal.md`), "a\n");
			writeFileSync(join(workspace, "README.md"), "changed\n");
			await transitionChange(workspace, id, { type: "checkpoint", actor: "test", stage: "apply", result: "implemented", nextAction: "next", artifacts: [h(`.codepatrol/changes/${id}/apply/journal.md`)], changes: ["README.md"] }, closeOpts);
			
			await transitionChange(workspace, id, { type: "begin", actor: "test", stage: "verify", nextAction: "next" }, closeOpts);
			await transitionChange(workspace, id, { type: "usage", actor: "test", stage: "verify", run: { id: "v1", started_at: at(8).now.toISOString(), finished_at: at(9).now.toISOString(), elapsed_ms: 1000, characters: { status: "unavailable", reason: "test" } } }, closeOpts);
			mkdirSync(join(workspace, `.codepatrol/changes/${id}/verify`), { recursive: true });
			writeFileSync(join(workspace, `.codepatrol/changes/${id}/verify/report.md`), "v\n");
			await transitionChange(workspace, id, { type: "checkpoint", actor: "test", stage: "verify", result: "commit", nextAction: "next", artifacts: [h(`.codepatrol/changes/${id}/verify/report.md`)] }, closeOpts);

			await transitionChange(workspace, id, { type: "begin", actor: "test", stage: "close", nextAction: "next" }, closeOpts);
			await transitionChange(workspace, id, { type: "usage", actor: "test", stage: "close", run: { id: "c1", started_at: at(10).now.toISOString(), finished_at: at(11).now.toISOString(), elapsed_ms: 1000, characters: { status: "unavailable", reason: "test" } } }, closeOpts);
			const dirty = await new NodeGitAdapter(workspace).status();
			console.log("DIRTY", dirty);
			const resultNoPush = await closeChange(workspace, id, { outcome: "commit", actor: "test", authority: "approved" }, closeOpts);
			assert.equal(resultNoPush.pushSuggestion, "git push origin main");
			assert.equal(pushCalled, false);
			
			const id2 = "2026-07-24-push-test2";
			await startChange(workspace, { workId: id2, title: "Test push 2", targetBranch: "main", actor: "codex" }, closeOpts);
			
			mkdirSync(join(workspace, `.codepatrol/changes/${id2}/plan`), { recursive: true });
			writeFileSync(join(workspace, `.codepatrol/changes/${id2}/plan/spec.md`), "s\n");
			writeFileSync(join(workspace, `.codepatrol/changes/${id2}/plan/plan.md`), "p\n");
			await transitionChange(workspace, id2, { type: "usage", actor: "test", stage: "plan", run: { id: "p2", started_at: at(12).now.toISOString(), finished_at: at(13).now.toISOString(), elapsed_ms: 1000, characters: { status: "unavailable", reason: "test" } } }, closeOpts);
			await transitionChange(workspace, id2, { type: "checkpoint", actor: "test", stage: "plan", result: "ready", nextAction: "next", artifacts: [h(`.codepatrol/changes/${id2}/plan/spec.md`), h(`.codepatrol/changes/${id2}/plan/plan.md`)] }, closeOpts);
			
			await transitionChange(workspace, id2, { type: "begin", actor: "test", stage: "review", nextAction: "next" }, closeOpts);
			await transitionChange(workspace, id2, { type: "usage", actor: "test", stage: "review", run: { id: "r2", started_at: at(14).now.toISOString(), finished_at: at(15).now.toISOString(), elapsed_ms: 1000, characters: { status: "unavailable", reason: "test" } } }, closeOpts);
			mkdirSync(join(workspace, `.codepatrol/changes/${id2}/review`), { recursive: true });
			writeFileSync(join(workspace, `.codepatrol/changes/${id2}/review/report.md`), "r\n");
			await transitionChange(workspace, id2, { type: "checkpoint", actor: "test", stage: "review", result: "approve", nextAction: "next", artifacts: [h(`.codepatrol/changes/${id2}/review/report.md`)] }, closeOpts);
			
			await transitionChange(workspace, id2, { type: "begin", actor: "test", stage: "apply", nextAction: "next" }, closeOpts);
			await transitionChange(workspace, id2, { type: "usage", actor: "test", stage: "apply", run: { id: "a2", started_at: at(16).now.toISOString(), finished_at: at(17).now.toISOString(), elapsed_ms: 1000, characters: { status: "unavailable", reason: "test" } } }, closeOpts);
			mkdirSync(join(workspace, `.codepatrol/changes/${id2}/apply`), { recursive: true });
			writeFileSync(join(workspace, `.codepatrol/changes/${id2}/apply/journal.md`), "a\n");
			writeFileSync(join(workspace, "README.md"), "changed 2\n");
			await transitionChange(workspace, id2, { type: "checkpoint", actor: "test", stage: "apply", result: "implemented", nextAction: "next", artifacts: [h(`.codepatrol/changes/${id2}/apply/journal.md`)], changes: ["README.md"] }, closeOpts);
			
			await transitionChange(workspace, id2, { type: "begin", actor: "test", stage: "verify", nextAction: "next" }, closeOpts);
			await transitionChange(workspace, id2, { type: "usage", actor: "test", stage: "verify", run: { id: "v2", started_at: at(18).now.toISOString(), finished_at: at(19).now.toISOString(), elapsed_ms: 1000, characters: { status: "unavailable", reason: "test" } } }, closeOpts);
			mkdirSync(join(workspace, `.codepatrol/changes/${id2}/verify`), { recursive: true });
			writeFileSync(join(workspace, `.codepatrol/changes/${id2}/verify/report.md`), "v\n");
			await transitionChange(workspace, id2, { type: "checkpoint", actor: "test", stage: "verify", result: "commit", nextAction: "next", artifacts: [h(`.codepatrol/changes/${id2}/verify/report.md`)] }, closeOpts);

			await transitionChange(workspace, id2, { type: "begin", actor: "test", stage: "close", nextAction: "next" }, closeOpts);
			await transitionChange(workspace, id2, { type: "usage", actor: "test", stage: "close", run: { id: "c2", started_at: at(20).now.toISOString(), finished_at: at(21).now.toISOString(), elapsed_ms: 1000, characters: { status: "unavailable", reason: "test" } } }, closeOpts);
			pushCalled = false;
			const resultPush = await closeChange(workspace, id2, { outcome: "commit", actor: "test", authority: "approved", push: true }, closeOpts);
			assert.equal(resultPush.pushSuggestion, undefined, "no suggestion when push is auto-performed");
			assert.equal(pushCalled, true);
			assert.equal(resultPush.pushError, undefined);

			const id3 = "2026-07-24-push-test3";
			await startChange(workspace, { workId: id3, title: "Test push 3", targetBranch: "main", actor: "codex" }, closeOpts);
			
			mkdirSync(join(workspace, `.codepatrol/changes/${id3}/plan`), { recursive: true });
			writeFileSync(join(workspace, `.codepatrol/changes/${id3}/plan/spec.md`), "s\n");
			writeFileSync(join(workspace, `.codepatrol/changes/${id3}/plan/plan.md`), "p\n");
			await transitionChange(workspace, id3, { type: "usage", actor: "test", stage: "plan", run: { id: "p3", started_at: at(12).now.toISOString(), finished_at: at(13).now.toISOString(), elapsed_ms: 1000, characters: { status: "unavailable", reason: "test" } } }, closeOpts);
			await transitionChange(workspace, id3, { type: "checkpoint", actor: "test", stage: "plan", result: "ready", nextAction: "next", artifacts: [h(`.codepatrol/changes/${id3}/plan/spec.md`), h(`.codepatrol/changes/${id3}/plan/plan.md`)] }, closeOpts);
			
			await transitionChange(workspace, id3, { type: "begin", actor: "test", stage: "review", nextAction: "next" }, closeOpts);
			await transitionChange(workspace, id3, { type: "usage", actor: "test", stage: "review", run: { id: "r3", started_at: at(14).now.toISOString(), finished_at: at(15).now.toISOString(), elapsed_ms: 1000, characters: { status: "unavailable", reason: "test" } } }, closeOpts);
			mkdirSync(join(workspace, `.codepatrol/changes/${id3}/review`), { recursive: true });
			writeFileSync(join(workspace, `.codepatrol/changes/${id3}/review/report.md`), "r\n");
			await transitionChange(workspace, id3, { type: "checkpoint", actor: "test", stage: "review", result: "approve", nextAction: "next", artifacts: [h(`.codepatrol/changes/${id3}/review/report.md`)] }, closeOpts);
			
			await transitionChange(workspace, id3, { type: "begin", actor: "test", stage: "apply", nextAction: "next" }, closeOpts);
			await transitionChange(workspace, id3, { type: "usage", actor: "test", stage: "apply", run: { id: "a3", started_at: at(16).now.toISOString(), finished_at: at(17).now.toISOString(), elapsed_ms: 1000, characters: { status: "unavailable", reason: "test" } } }, closeOpts);
			mkdirSync(join(workspace, `.codepatrol/changes/${id3}/apply`), { recursive: true });
			writeFileSync(join(workspace, `.codepatrol/changes/${id3}/apply/journal.md`), "a\n");
			writeFileSync(join(workspace, "README.md"), "changed 3\n");
			await transitionChange(workspace, id3, { type: "checkpoint", actor: "test", stage: "apply", result: "implemented", nextAction: "next", artifacts: [h(`.codepatrol/changes/${id3}/apply/journal.md`)], changes: ["README.md"] }, closeOpts);
			
			await transitionChange(workspace, id3, { type: "begin", actor: "test", stage: "verify", nextAction: "next" }, closeOpts);
			await transitionChange(workspace, id3, { type: "usage", actor: "test", stage: "verify", run: { id: "v3", started_at: at(18).now.toISOString(), finished_at: at(19).now.toISOString(), elapsed_ms: 1000, characters: { status: "unavailable", reason: "test" } } }, closeOpts);
			mkdirSync(join(workspace, `.codepatrol/changes/${id3}/verify`), { recursive: true });
			writeFileSync(join(workspace, `.codepatrol/changes/${id3}/verify/report.md`), "v\n");
			await transitionChange(workspace, id3, { type: "checkpoint", actor: "test", stage: "verify", result: "commit", nextAction: "next", artifacts: [h(`.codepatrol/changes/${id3}/verify/report.md`)] }, closeOpts);

			await transitionChange(workspace, id3, { type: "begin", actor: "test", stage: "close", nextAction: "next" }, closeOpts);
			await transitionChange(workspace, id3, { type: "usage", actor: "test", stage: "close", run: { id: "c3", started_at: at(20).now.toISOString(), finished_at: at(21).now.toISOString(), elapsed_ms: 1000, characters: { status: "unavailable", reason: "test" } } }, closeOpts);
			pushCalled = false;
			const failingMockGit = new NodeGitAdapter(workspace);
			failingMockGit.push = async () => {
				pushCalled = true;
				throw new CodepatrolError("PUSH_FAILED", "mock push failure", 5);
			};
			const failingOpts = { now: at(2).now, git: failingMockGit };
			const resultFailingPush = await closeChange(workspace, id3, { outcome: "commit", actor: "test", authority: "approved", push: true }, failingOpts);
			assert.equal(pushCalled, true);
			assert.equal(resultFailingPush.pushError?.code, "PUSH_FAILED");
			assert.equal(resultFailingPush.pushError?.message, "mock push failure");

		} finally { rmSync(root, { recursive: true, force: true }); }
	});
});