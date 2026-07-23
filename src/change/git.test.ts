import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { NodeGitAdapter } from "./git.js";
import { closeChange, inspectChanges, startChange, transitionChange } from "./orchestrator.js";
import { CodepatrolError } from "../shared/errors.js";

function run(workspace: string, args: string[]): string { return execFileSync("git", args, { cwd: workspace, encoding: "utf8" }).trim(); }
function binding(workspace: string, path: string) { return { path, sha256: createHash("sha256").update(readFileSync(join(workspace, path))).digest("hex"), intent: "create" as const }; }
function at(second: number) { return { now: new Date(`2026-07-22T10:00:${String(second).padStart(2, "0")}.000Z`) }; }
function initialize(workspace: string): string {
	run(workspace, ["init", "-b", "main"]); writeFileSync(join(workspace, "README.md"), "baseline\n"); run(workspace, ["add", "README.md"]); run(workspace, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "baseline"]); return run(workspace, ["rev-parse", "HEAD"]);
}
async function advanceThroughVerify(workspace: string, id: string): Promise<void> {
	await startChange(workspace, { workId: id, title: "Verified candidate", targetBranch: "main", actor: "codex" }, at(1));
	for (const [index, stage] of (["plan", "review", "apply", "verify"] as const).entries()) {
		if (stage !== "plan") await transitionChange(workspace, id, { type: "begin", actor: "codex", stage, nextAction: `complete ${stage}` }, at(2 + index * 3));
		const dir = join(workspace, `.codepatrol/changes/${id}/${stage}`); mkdirSync(dir, { recursive: true }); const name = stage === "plan" ? "spec.md" : stage === "review" ? "report.md" : stage === "apply" ? "journal.md" : "report.md"; const path = `.codepatrol/changes/${id}/${stage}/${name}`; writeFileSync(join(workspace, path), `${stage}\n`); const artifacts = [binding(workspace, path)];
		if (stage === "plan") { const planPath = `.codepatrol/changes/${id}/plan/plan.md`; writeFileSync(join(workspace, planPath), "plan\n"); artifacts.push(binding(workspace, planPath)); }
		await transitionChange(workspace, id, { type: "usage", actor: "codex", stage, run: { id: `${stage}-${id}`, started_at: `2026-07-22T10:00:${String(3 + index * 3).padStart(2, "0")}.000Z`, finished_at: `2026-07-22T10:00:${String(4 + index * 3).padStart(2, "0")}.000Z`, elapsed_ms: 1000, tokens: { status: "unavailable", reason: "test" } } }, at(4 + index * 3));
		const result = stage === "plan" ? "ready" : stage === "review" ? "approve" : stage === "apply" ? "implemented" : "commit";
		await transitionChange(workspace, id, { type: "checkpoint", actor: "codex", stage, result, artifacts, ...(stage === "apply" ? { changes: [] } : {}), nextAction: `continue ${id}` }, at(5 + index * 3));
	}
}

class FailAfterCheckoutGit extends NodeGitAdapter {
	failed = false;
	override async checkout(ref: string, signal?: AbortSignal): Promise<void> {
		await super.checkout(ref, signal);
		if (!this.failed) { this.failed = true; throw new Error("injected after checkout"); }
	}
}

class FailAfterMergeGit extends NodeGitAdapter {
	failed = false;
	override async mergeFf(ref: string, signal?: AbortSignal): Promise<void> {
		await super.mergeFf(ref, signal);
		if (!this.failed) { this.failed = true; throw new Error("injected after merge"); }
	}
}

class FailInitialCommitGit extends NodeGitAdapter {
	override async commit(): Promise<string> { throw new Error("injected initial commit failure"); }
}

class CoordinatedStartGit extends NodeGitAdapter {
	branchCreated = false;
	checks = 0;
	activeChecks = 0;
	maxActiveChecks = 0;
	readonly base = "a".repeat(40);
	override async assertTrusted(): Promise<void> {}
	override async status(): Promise<string> { return ""; }
	override async currentBranch(): Promise<string> { return "main"; }
	override async refs(): Promise<string[]> { return []; }
	override async branchExists(): Promise<boolean> {
		this.activeChecks++; this.maxActiveChecks = Math.max(this.maxActiveChecks, this.activeChecks);
		const existed = this.branchCreated;
		if (this.checks++ === 0) await new Promise((resolve) => setTimeout(resolve, 25));
		this.activeChecks--;
		return existed;
	}
	override async createBranch(): Promise<void> { this.branchCreated = true; }
	override async head(): Promise<string> { return this.base; }
	override async tree(): Promise<string> { return this.base; }
	override async add(): Promise<void> {}
	override async unstage(): Promise<void> {}
	override async commit(): Promise<string> { return this.base; }
	override async deleteBranch(): Promise<void> { this.branchCreated = false; }
}

class ForeignWinnerGit extends CoordinatedStartGit {
	deleted = false;
	override async branchExists(): Promise<boolean> { return this.branchCreated; }
	override async createBranch(): Promise<void> {
		this.branchCreated = true;
		const root = join(this.workspace, ".codepatrol/changes/2026-07-22-foreign-winner"); mkdirSync(root, { recursive: true }); writeFileSync(join(root, "sentinel.txt"), "owned elsewhere\n");
		throw new Error("external winner");
	}
	override async deleteBranch(): Promise<void> { this.deleted = true; this.branchCreated = false; }
}

test("git adapter rejects a non-repository without mutating it", async () => {
	const workspace = mkdtempSync(join(tmpdir(), "codepatrol-git-"));
	const git = new NodeGitAdapter(workspace);
	await assert.rejects(git.assertTrusted(), /Git repository/);
});

test("failed Change start removes only its partial record and branch", async () => {
	const workspace = mkdtempSync(join(tmpdir(), "codepatrol-start-failure-"));
	run(workspace, ["init", "-b", "main"]); writeFileSync(join(workspace, "README.md"), "baseline\n"); run(workspace, ["add", "README.md"]); run(workspace, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "baseline"]);
	const id = "2026-07-22-start-failure";
	await assert.rejects(startChange(workspace, { workId: id, title: "Failure", targetBranch: "main", actor: "codex" }, { ...at(1), git: new FailInitialCommitGit(workspace) }), /injected initial commit failure/);
	assert.equal(run(workspace, ["branch", "--show-current"]), "main");
	assert.equal(run(workspace, ["branch", "--list", `codepatrol/${id}`]), "");
	assert.equal(run(workspace, ["status", "--porcelain"]), "");
});

test("concurrent starts serialize the shared Git checkout and preserve one valid Change", async () => {
	const workspace = mkdtempSync(join(tmpdir(), "codepatrol-start-concurrent-")); const git = new CoordinatedStartGit(workspace); const id = "2026-07-22-concurrent";
	const input = { workId: id, title: "Concurrent", targetBranch: "main", actor: "codex" };
	const results = await Promise.allSettled([startChange(workspace, input, { ...at(1), git }), startChange(workspace, input, { ...at(2), git })]);
	assert.deepEqual(results.map((result) => result.status).sort(), ["fulfilled", "rejected"]);
	assert.equal(git.branchCreated, true);
	assert.equal(git.maxActiveChecks, 1);
	assert.equal(existsSync(join(workspace, `.codepatrol/changes/${id}/change.yaml`)), true);
});

test("failed start never removes a branch or Change directory it did not create", async () => {
	const workspace = mkdtempSync(join(tmpdir(), "codepatrol-start-foreign-")); const git = new ForeignWinnerGit(workspace); const id = "2026-07-22-foreign-winner";
	await assert.rejects(startChange(workspace, { workId: id, title: "Foreign", targetBranch: "main", actor: "codex" }, { ...at(1), git }), /external winner/);
	assert.equal(existsSync(join(workspace, `.codepatrol/changes/${id}/sentinel.txt`)), true);
	assert.equal(git.deleted, false);
});

test("Plan artifact intent is checked against the immutable Git baseline", async () => {
	const workspace = mkdtempSync(join(tmpdir(), "codepatrol-baseline-")); initialize(workspace); const id = "2026-07-22-baseline";
	await startChange(workspace, { workId: id, title: "Baseline", targetBranch: "main", actor: "codex" }, at(1));
	const root = join(workspace, `.codepatrol/changes/${id}/plan`); mkdirSync(root, { recursive: true }); const spec = `.codepatrol/changes/${id}/plan/spec.md`; const plan = `.codepatrol/changes/${id}/plan/plan.md`; writeFileSync(join(workspace, spec), "spec\n"); writeFileSync(join(workspace, plan), "plan\n");
	await transitionChange(workspace, id, { type: "usage", actor: "codex", stage: "plan", run: { id: "baseline-run", started_at: "2026-07-22T10:00:02Z", finished_at: "2026-07-22T10:00:03Z", elapsed_ms: 1000, tokens: { status: "unavailable", reason: "test" } } }, at(3));
	await assert.rejects(transitionChange(workspace, id, { type: "checkpoint", actor: "codex", stage: "plan", result: "ready", artifacts: [{ ...binding(workspace, spec), intent: "modify" }, { ...binding(workspace, plan), intent: "create" }], nextAction: "review" }, at(4)), (error: unknown) => error instanceof CodepatrolError && error.code === "CHANGE_DRIFT");
});

test("Close rejects production drift committed after the accepted Verify checkpoint", async () => {
	const workspace = mkdtempSync(join(tmpdir(), "codepatrol-verify-drift-")); const base = initialize(workspace); const id = "2026-07-22-verify-drift"; await advanceThroughVerify(workspace, id);
	await transitionChange(workspace, id, { type: "begin", actor: "codex", stage: "close", nextAction: "commit" }, at(15));
	await transitionChange(workspace, id, { type: "usage", actor: "codex", stage: "close", run: { id: "close-drift", started_at: "2026-07-22T10:00:16Z", finished_at: "2026-07-22T10:00:17Z", elapsed_ms: 1000, tokens: { status: "unavailable", reason: "test" } } }, at(17));
	writeFileSync(join(workspace, "UNVERIFIED.txt"), "must not reach main\n"); run(workspace, ["add", "UNVERIFIED.txt"]); run(workspace, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "unverified"]);
	await assert.rejects(closeChange(workspace, id, { outcome: "commit", actor: "codex", authority: "test authorization" }, at(18)), (error: unknown) => error instanceof CodepatrolError && error.code === "CHANGE_DRIFT");
	assert.equal(run(workspace, ["rev-parse", "main"]), base); assert.equal(run(workspace, ["tag", "--list", `codepatrol/committed/${id}`]), ""); assert.equal(existsSync(join(workspace, `.codepatrol/changes/${id}/close/receipt.md`)), false);
});

test("Close rejects a Verify binding that does not match immutable checkpoint history", async () => {
	const workspace = mkdtempSync(join(tmpdir(), "codepatrol-lineage-")); const base = initialize(workspace); const id = "2026-07-22-lineage"; await advanceThroughVerify(workspace, id);
	await transitionChange(workspace, id, { type: "begin", actor: "codex", stage: "close", nextAction: "commit" }, at(15));
	await transitionChange(workspace, id, { type: "usage", actor: "codex", stage: "close", run: { id: "close-lineage", started_at: "2026-07-22T10:00:16Z", finished_at: "2026-07-22T10:00:17Z", elapsed_ms: 1000, tokens: { status: "unavailable", reason: "test" } } }, at(17));
	writeFileSync(join(workspace, "LATE.txt"), "late candidate content\n"); run(workspace, ["add", "LATE.txt"]); run(workspace, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "late candidate"]);
	const recordPath = join(workspace, `.codepatrol/changes/${id}/change.yaml`); const record = parse(readFileSync(recordPath, "utf8")); const verify = record.events.find((event: { type: string; stage: string }) => event.type === "stage-checkpointed" && event.stage === "verify"); verify.checkpoint = run(workspace, ["rev-parse", "HEAD"]); verify.tree = run(workspace, ["rev-parse", "HEAD^{tree}"]); writeFileSync(recordPath, stringify(record)); run(workspace, ["add", recordPath]); run(workspace, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "altered binding"]);
	await assert.rejects(closeChange(workspace, id, { outcome: "commit", actor: "codex", authority: "test authorization" }, at(18)), (error: unknown) => error instanceof CodepatrolError && error.code === "CHANGE_DRIFT");
	assert.equal(run(workspace, ["rev-parse", "main"]), base); assert.equal(run(workspace, ["tag", "--list", `codepatrol/committed/${id}`]), "");
});

test("checkpoint rejects a production path committed outside its declaration", async () => {
	const workspace = mkdtempSync(join(tmpdir(), "codepatrol-checkpoint-delta-")); initialize(workspace); const id = "2026-07-22-checkpoint-delta";
	await startChange(workspace, { workId: id, title: "Checkpoint delta", targetBranch: "main", actor: "codex" }, at(1));
	const root = join(workspace, `.codepatrol/changes/${id}/plan`); mkdirSync(root, { recursive: true }); const spec = `.codepatrol/changes/${id}/plan/spec.md`; const plan = `.codepatrol/changes/${id}/plan/plan.md`; writeFileSync(join(workspace, spec), "spec\n"); writeFileSync(join(workspace, plan), "plan\n"); writeFileSync(join(workspace, "EARLY.txt"), "not declared\n"); run(workspace, ["add", spec, plan, "EARLY.txt"]); run(workspace, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "precommitted delta"]);
	await transitionChange(workspace, id, { type: "usage", actor: "codex", stage: "plan", run: { id: "delta-run", started_at: "2026-07-22T10:00:02Z", finished_at: "2026-07-22T10:00:03Z", elapsed_ms: 1000, tokens: { status: "unavailable", reason: "test" } } }, at(3));
	await assert.rejects(transitionChange(workspace, id, { type: "checkpoint", actor: "codex", stage: "plan", result: "ready", artifacts: [binding(workspace, spec), binding(workspace, plan)], nextAction: "review" }, at(4)), (error: unknown) => error instanceof CodepatrolError && error.code === "CHANGE_CONFLICT");
});

test("checkpoint cannot satisfy required artifacts with delete bindings", async () => {
	const workspace = mkdtempSync(join(tmpdir(), "codepatrol-required-artifact-")); initialize(workspace); const id = "2026-07-22-required-artifact";
	await startChange(workspace, { workId: id, title: "Required artifact", targetBranch: "main", actor: "codex" }, at(1));
	await transitionChange(workspace, id, { type: "usage", actor: "codex", stage: "plan", run: { id: "required-run", started_at: "2026-07-22T10:00:02Z", finished_at: "2026-07-22T10:00:03Z", elapsed_ms: 1000, tokens: { status: "unavailable", reason: "test" } } }, at(3));
	const prefix = `.codepatrol/changes/${id}/plan`;
	await assert.rejects(transitionChange(workspace, id, { type: "checkpoint", actor: "codex", stage: "plan", result: "ready", artifacts: [{ path: `${prefix}/spec.md`, sha256: "a".repeat(64), intent: "delete" }, { path: `${prefix}/plan.md`, sha256: "b".repeat(64), intent: "delete" }], nextAction: "review" }, at(4)), (error: unknown) => error instanceof CodepatrolError && error.code === "CHANGE_INVALID");
});

test("inspect validates accepted artifacts loaded only from an active branch", async () => {
	const workspace = mkdtempSync(join(tmpdir(), "codepatrol-inspect-ref-")); initialize(workspace); const id = "2026-07-22-inspect-ref";
	await startChange(workspace, { workId: id, title: "Inspect", targetBranch: "main", actor: "codex" }, at(1));
	const root = join(workspace, `.codepatrol/changes/${id}/plan`); mkdirSync(root, { recursive: true }); const spec = `.codepatrol/changes/${id}/plan/spec.md`; const plan = `.codepatrol/changes/${id}/plan/plan.md`; writeFileSync(join(workspace, spec), "spec\n"); writeFileSync(join(workspace, plan), "plan\n");
	await transitionChange(workspace, id, { type: "usage", actor: "codex", stage: "plan", run: { id: "inspect-run", started_at: "2026-07-22T10:00:02Z", finished_at: "2026-07-22T10:00:03Z", elapsed_ms: 1000, tokens: { status: "unavailable", reason: "test" } } }, at(3));
	await transitionChange(workspace, id, { type: "checkpoint", actor: "codex", stage: "plan", result: "ready", artifacts: [{ ...binding(workspace, spec), intent: "create" }, { ...binding(workspace, plan), intent: "create" }], nextAction: "review" }, at(4));
	writeFileSync(join(workspace, spec), "drifted\n"); run(workspace, ["add", spec]); run(workspace, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "drift artifact"]); run(workspace, ["checkout", "main"]);
	await assert.rejects(inspectChanges(workspace, { workId: id }), (error: unknown) => error instanceof CodepatrolError && error.code === "CHANGE_DRIFT");
});

test("inspect rejects divergent working-tree and branch copies of one Change", async () => {
	const workspace = mkdtempSync(join(tmpdir(), "codepatrol-inspect-conflict-")); initialize(workspace); const id = "2026-07-22-inspect-conflict"; const branch = `codepatrol/${id}`;
	await startChange(workspace, { workId: id, title: "Conflict", targetBranch: "main", actor: "codex" }, at(1));
	const root = join(workspace, `.codepatrol/changes/${id}/plan`); mkdirSync(root, { recursive: true }); const spec = `.codepatrol/changes/${id}/plan/spec.md`; const plan = `.codepatrol/changes/${id}/plan/plan.md`; writeFileSync(join(workspace, spec), "spec\n"); writeFileSync(join(workspace, plan), "plan\n");
	await transitionChange(workspace, id, { type: "usage", actor: "codex", stage: "plan", run: { id: "conflict-run", started_at: "2026-07-22T10:00:02Z", finished_at: "2026-07-22T10:00:03Z", elapsed_ms: 1000, tokens: { status: "unavailable", reason: "test" } } }, at(3));
	await transitionChange(workspace, id, { type: "checkpoint", actor: "codex", stage: "plan", result: "ready", artifacts: [{ ...binding(workspace, spec), intent: "create" }, { ...binding(workspace, plan), intent: "create" }], nextAction: "review" }, at(4));
	run(workspace, ["checkout", "main"]); run(workspace, ["checkout", branch, "--", `.codepatrol/changes/${id}`]);
	const recordPath = join(workspace, `.codepatrol/changes/${id}/change.yaml`); const record = parse(readFileSync(recordPath, "utf8")); record.identity.title = "Conflicting working copy"; writeFileSync(recordPath, stringify(record));
	await assert.rejects(inspectChanges(workspace, { workId: id }), (error: unknown) => error instanceof CodepatrolError && error.code === "CHANGE_CONFLICT");
});

test("repeating an interrupted transition commits the pending event exactly once", async () => {
	const workspace = mkdtempSync(join(tmpdir(), "codepatrol-transition-recovery-"));
	run(workspace, ["init", "-b", "main"]); writeFileSync(join(workspace, "README.md"), "baseline\n"); run(workspace, ["add", "README.md"]); run(workspace, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "baseline"]);
	const id = "2026-07-22-transition-recovery"; await startChange(workspace, { workId: id, title: "Recovery", targetBranch: "main", actor: "codex" }, at(1));
	const intent = { type: "usage", actor: "codex", stage: "plan", run: { id: "plan-recovery", started_at: "2026-07-22T10:00:02Z", finished_at: "2026-07-22T10:00:03Z", elapsed_ms: 1000, tokens: { status: "unavailable", reason: "test" } } } as const;
	await assert.rejects(transitionChange(workspace, id, intent, { ...at(3), git: new FailInitialCommitGit(workspace) }), /injected initial commit failure/);
	assert.match(run(workspace, ["status", "--porcelain"]), /change.yaml/);
	const recovered = await transitionChange(workspace, id, intent, at(4));
	assert.equal(recovered.attempts.plan[0]?.runs.filter((item) => item.id === "plan-recovery").length, 1);
	assert.equal(run(workspace, ["status", "--porcelain"]), "");
});

test("rollback tags the complete Change, deletes its branch, and preserves the target tree", async () => {
	const workspace = mkdtempSync(join(tmpdir(), "codepatrol-lifecycle-"));
	run(workspace, ["init", "-b", "main"]); writeFileSync(join(workspace, "README.md"), "baseline\n"); run(workspace, ["add", "README.md"]); run(workspace, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "baseline"]);
	const base = run(workspace, ["rev-parse", "HEAD"]); const baseTree = run(workspace, ["rev-parse", "HEAD^{tree}"]); const id = "2026-07-22-lifecycle";
	await startChange(workspace, { workId: id, title: "Lifecycle", targetBranch: "main", actor: "codex" }, at(1));
	for (const [index, stage] of (["plan", "review", "apply", "verify"] as const).entries()) {
		if (stage !== "plan") await transitionChange(workspace, id, { type: "begin", actor: "codex", stage, nextAction: `complete ${stage}` }, at(2 + index * 3));
		const dir = join(workspace, `.codepatrol/changes/${id}/${stage}`); mkdirSync(dir, { recursive: true }); const name = stage === "plan" ? "spec.md" : stage === "review" ? "report.md" : stage === "apply" ? "journal.md" : "report.md"; const path = `.codepatrol/changes/${id}/${stage}/${name}`; writeFileSync(join(workspace, path), `${stage}\n`); const artifacts = [binding(workspace, path)];
		if (stage === "plan") { const planPath = `.codepatrol/changes/${id}/plan/plan.md`; writeFileSync(join(workspace, planPath), "plan\n"); artifacts.push(binding(workspace, planPath)); }
		await transitionChange(workspace, id, { type: "usage", actor: "codex", stage, run: { id: `${stage}-1`, started_at: `2026-07-22T10:00:${String(3 + index * 3).padStart(2, "0")}.000Z`, finished_at: `2026-07-22T10:00:${String(4 + index * 3).padStart(2, "0")}.000Z`, elapsed_ms: 1000, tokens: { status: "unavailable", reason: "test" } } }, at(4 + index * 3));
		const result = stage === "plan" ? "ready" : stage === "review" ? "approve" : stage === "apply" ? "implemented" : "commit";
		await transitionChange(workspace, id, { type: "checkpoint", actor: "codex", stage, result, artifacts, ...(stage === "apply" ? { changes: [] } : {}), nextAction: stage === "verify" ? `codepatrol-close ${id}` : `continue ${id}` }, at(5 + index * 3));
	}
	await transitionChange(workspace, id, { type: "begin", actor: "codex", stage: "close", nextAction: "rollback" }, at(15));
	await transitionChange(workspace, id, { type: "usage", actor: "codex", stage: "close", run: { id: "close-1", started_at: "2026-07-22T10:00:16.000Z", finished_at: "2026-07-22T10:00:17.000Z", elapsed_ms: 1000, tokens: { status: "measured", source: "harness", input: 1, output: 1, total: 2 } } }, at(17));
	const advanced = run(workspace, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit-tree", `${base}^{tree}`, "-p", base, "-m", "advanced target"]); run(workspace, ["update-ref", "refs/heads/main", advanced]);
	await assert.rejects(closeChange(workspace, id, { outcome: "rollback", actor: "codex", authority: "test authorization" }, at(18)), (error: unknown) => error instanceof CodepatrolError && error.code === "TARGET_ADVANCED");
	assert.equal(run(workspace, ["branch", "--show-current"]), `codepatrol/${id}`); assert.equal(run(workspace, ["tag", "--list", `codepatrol/rolled-back/${id}`]), ""); assert.equal(run(workspace, ["status", "--porcelain"]), ""); run(workspace, ["update-ref", "refs/heads/main", base]);
	await assert.rejects(closeChange(workspace, id, { outcome: "rollback", actor: "codex", authority: "test authorization" }, { ...at(19), git: new FailAfterCheckoutGit(workspace) }), /injected after checkout/);
	assert.equal(run(workspace, ["branch", "--show-current"]), "main");
	assert.match(run(workspace, ["tag", "--list", `codepatrol/rolled-back/${id}`]), /rolled-back/);
	assert.match(run(workspace, ["branch", "--list", `codepatrol/${id}`]), /codepatrol/);
	const result = await closeChange(workspace, id, { outcome: "rollback", actor: "codex", authority: "test authorization" }, at(20));
	assert.equal(result.outcome, "rolled-back"); assert.equal(run(workspace, ["rev-parse", "HEAD"]), base); assert.equal(run(workspace, ["rev-parse", "HEAD^{tree}"]), baseTree);
	assert.equal(run(workspace, ["branch", "--list", `codepatrol/${id}`]), ""); assert.match(run(workspace, ["tag", "--list", `codepatrol/rolled-back/${id}`]), /rolled-back/); assert.equal(run(workspace, ["status", "--porcelain"]), "");
});

test("commit finalization fast-forwards the unchanged target and preserves a terminal tag", async () => {
	const workspace = mkdtempSync(join(tmpdir(), "codepatrol-commit-"));
	run(workspace, ["init", "-b", "main"]); writeFileSync(join(workspace, "README.md"), "baseline\n"); run(workspace, ["add", "README.md"]); run(workspace, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "baseline"]);
	const id = "2026-07-22-commit"; await startChange(workspace, { workId: id, title: "Commit lifecycle", targetBranch: "main", actor: "codex" }, at(1));
	for (const [index, stage] of (["plan", "review", "apply", "verify"] as const).entries()) {
		if (stage !== "plan") await transitionChange(workspace, id, { type: "begin", actor: "codex", stage, nextAction: `complete ${stage}` }, at(2 + index * 3));
		const dir = join(workspace, `.codepatrol/changes/${id}/${stage}`); mkdirSync(dir, { recursive: true }); const name = stage === "plan" ? "spec.md" : stage === "review" ? "report.md" : stage === "apply" ? "journal.md" : "report.md"; const path = `.codepatrol/changes/${id}/${stage}/${name}`; writeFileSync(join(workspace, path), `${stage}\n`); const artifacts = [binding(workspace, path)];
		if (stage === "plan") { const planPath = `.codepatrol/changes/${id}/plan/plan.md`; writeFileSync(join(workspace, planPath), "plan\n"); artifacts.push(binding(workspace, planPath)); }
		await transitionChange(workspace, id, { type: "usage", actor: "codex", stage, run: { id: `${stage}-commit`, started_at: `2026-07-22T10:00:${String(3 + index * 3).padStart(2, "0")}.000Z`, finished_at: `2026-07-22T10:00:${String(4 + index * 3).padStart(2, "0")}.000Z`, elapsed_ms: 1000, tokens: { status: "unavailable", reason: "test" } } }, at(4 + index * 3));
		const result = stage === "plan" ? "ready" : stage === "review" ? "approve" : stage === "apply" ? "implemented" : "commit"; await transitionChange(workspace, id, { type: "checkpoint", actor: "codex", stage, result, artifacts, ...(stage === "apply" ? { changes: [] } : {}), nextAction: `continue ${id}` }, at(5 + index * 3));
	}
	await transitionChange(workspace, id, { type: "begin", actor: "codex", stage: "close", nextAction: "commit" }, at(15)); await transitionChange(workspace, id, { type: "usage", actor: "codex", stage: "close", run: { id: "close-commit", started_at: "2026-07-22T10:00:16Z", finished_at: "2026-07-22T10:00:17Z", elapsed_ms: 1000, tokens: { status: "unavailable", reason: "test" } } }, at(17));
	await assert.rejects(closeChange(workspace, id, { outcome: "commit", actor: "codex", authority: "test authorization" }, { ...at(18), git: new FailAfterMergeGit(workspace) }), /injected after merge/);
	assert.equal(run(workspace, ["branch", "--show-current"]), "main");
	assert.match(run(workspace, ["branch", "--list", `codepatrol/${id}`]), /codepatrol/);
	const tagHead = run(workspace, ["rev-parse", `codepatrol/committed/${id}`]); const advanced = run(workspace, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit-tree", `${tagHead}^{tree}`, "-p", tagHead, "-m", "post-terminal drift"]); run(workspace, ["update-ref", `refs/heads/codepatrol/${id}`, advanced]);
	await assert.rejects(closeChange(workspace, id, { outcome: "commit", actor: "codex", authority: "test authorization" }, at(19)), (error: unknown) => error instanceof CodepatrolError && error.code === "CHANGE_DRIFT"); run(workspace, ["update-ref", `refs/heads/codepatrol/${id}`, tagHead]);
	const result = await closeChange(workspace, id, { outcome: "commit", actor: "codex", authority: "test authorization" }, at(20));
	assert.equal(result.outcome, "committed"); assert.equal(run(workspace, ["branch", "--show-current"]), "main"); assert.equal(run(workspace, ["rev-parse", "HEAD"]), result.terminalCommit); assert.equal(run(workspace, ["branch", "--list", `codepatrol/${id}`]), ""); assert.match(run(workspace, ["tag", "--list", `codepatrol/committed/${id}`]), /committed/); assert.equal(run(workspace, ["status", "--porcelain"]), "");
});
