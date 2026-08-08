import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { GitChangeManager } from "../adapters/change.js";
import { GitCheckout } from "../adapters/checkout.js";
import { localGit } from "../adapters/git.js";
import { StateStore } from "../adapters/state-store.js";
import { SpecService } from "../application/spec-service.js";
import { WorkService } from "../application/work-service.js";
import { documentOf, type TestApp } from "./support/app.js";

const INITIATIVE_ID = "INIT-7";
const WORK_ID = "WORK-7.1.5";
const WAVE_ID = "WAVE-7.1";

function createIsolatedRepo() {
  const parent = mkdtempSync(join(tmpdir(), "codepatrol-shipaccept-"));
  const repoPath = join(parent, "repo");
  mkdirSync(repoPath, { recursive: true });
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith("GIT_")) env[key] = value;
  }
  const git = (args: string[]) => execFileSync("git", args, { cwd: repoPath, encoding: "utf8", env }).trim();
  return { parent, repoPath, env, git };
}

interface CodeApp {
  app: TestApp;
  worktreePath: string;
}

function createCodeApp(repoRoot: string, counterSeed = 0): CodeApp {
  let clock = 8_000_000_000_000;
  const now = () => {
    clock += 1000;
    return new Date(clock).toISOString();
  };
  const counter = { value: counterSeed };
  const uuid = () => `00000000-0000-4000-8000-${String(++counter.value).padStart(12, "0")}`;
  const git = localGit(repoRoot);
  const store = new StateStore(git);
  const change = new GitChangeManager(git, repoRoot, (path) => localGit(path));
  const works = new WorkService(
    store,
    now,
    uuid,
    new GitCheckout(git),
    change,
    repoRoot,
    (path) => localGit(path),
    git,
    () => {},
  );
  const worktreePath = join(repoRoot, "..", ".codepatrol-worktrees", WORK_ID);
  const app: TestApp = {
    store,
    spec: new SpecService(store, now, uuid),
    works,
    async head() {
      const r = await git.exec(["rev-parse", "HEAD"], { allowFailure: true });
      return r.code === 0 ? r.stdout.trim() : null;
    },
    async start(workId, stage) {
      return works.start(workId, stage, { harness: "test", todo: [{ id: "t1", title: "do" }] });
    },
    async complete(workId, stage, decision, extra: Record<string, unknown> = {}) {
      const runId = await activeRunId(workId, store);
      return works.complete(workId, stage, runId, {
        decision,
        summary: `summary for ${decision}`,
        todo: [{ id: "t1", status: "done" as const }],
        ...extra,
      });
    },
    async runStage(workId, stage, decision, extra: Record<string, unknown> = {}) {
      const started = await app.start(workId, stage);
      return works.complete(workId, stage, started.attempt.runId, {
        decision,
        summary: `summary for ${decision}`,
        todo: [{ id: "t1", status: "done" as const }],
        ...extra,
      });
    },
    async specStart(initiativeId) {
      const r = await app.spec.start({ initiativeId, todo: [{ id: "t1", title: "do" }], harness: "test" });
      return { initiative: r.initiative, runId: r.runId };
    },
    async specComplete(initiativeId, runId, decision, document) {
      const r = await app.spec.complete(
        initiativeId,
        runId,
        { decision, summary: `spec ${decision}`, todo: [{ id: "t1", status: "done" as const }] },
        document,
      );
      return { initiative: r.initiative.id };
    },
  };
  return { app, worktreePath };
}

async function activeRunId(workId: string, store: StateStore): Promise<string> {
  const snapshot = await store.read();
  const work = snapshot.works.get(workId);
  return work?.attempts.find((a) => a.status === "active")?.runId ?? "00000000-0000-4000-8000-000000000000";
}

function codeWorkDoc() {
  return documentOf({
    id: INITIATIVE_ID,
    title: "INIT-7 ship accept",
    intent: "exercise ship accept",
    works: [
      {
        id: WORK_ID,
        wave: WAVE_ID,
        title: "code work",
        description: "ship accept",
        workType: "feature" as const,
        priority: "p1" as const,
        delivery: "code" as const,
        acceptance: ["ok"],
        blockedBy: [],
      },
    ],
  });
}

async function seedAndVerify(app: TestApp, worktreePath: string): Promise<{ candidate: string; wtPath: string }> {
  const runId = (await app.specStart(INITIATIVE_ID)).runId;
  await app.specComplete(INITIATIVE_ID, runId, "apply", codeWorkDoc());
  await app.runStage(WORK_ID, "plan", "continue");
  await app.runStage(WORK_ID, "review", "continue");
  await app.start(WORK_ID, "build");
  assert.ok(existsSync(worktreePath), "worktree exists");
  const wtGit = localGit(worktreePath);
  writeFileSync(join(worktreePath, "product.txt"), "feature");
  await wtGit.exec(["add", "product.txt"]);
  await wtGit.exec(["commit", "-m", "candidate"]);
  await app.complete(WORK_ID, "build", "continue");
  await app.runStage(WORK_ID, "verify", "continue", { acceptance: [{ index: 0, status: "passed", summary: "ok" }] });
  return { candidate: (await wtGit.exec(["rev-parse", "HEAD"])).stdout.trim(), wtPath: worktreePath };
}

// ── Production tests ──

test("accept full lifecycle: squash, finalCommit, localIntegration, cleanup", async () => {
  const repo = createIsolatedRepo();
  try {
    repo.git(["init", "-b", "main"]);
    repo.git(["config", "user.name", "test"]);
    repo.git(["config", "user.email", "test"]);
    writeFileSync(join(repo.repoPath, "foo.txt"), "initial");
    repo.git(["add", "-A"]);
    repo.git(["commit", "-m", "initial"]);
    const base = repo.git(["rev-parse", "HEAD"]);

    const worktreePath = join(repo.repoPath, "..", ".codepatrol-worktrees", WORK_ID);
    const { app } = createCodeApp(repo.repoPath, 0);
    const { candidate } = await seedAndVerify(app, worktreePath);

    const shipStart = await app.start(WORK_ID, "ship");
    await app.works.complete(WORK_ID, "ship", shipStart.attempt.runId, {
      decision: "accept" as const,
      summary: "accepted",
      todo: [{ id: "t1", status: "done" as const }],
      authority: "test",
    });

    const snapshot = await app.store.read();
    const work = snapshot.works.get(WORK_ID);
    assert.equal(work?.completion?.outcome, "accepted");
    const shipAttempt = work!.attempts.find((a) => a.stage === "ship");
    assert.ok(shipAttempt?.evidence?.finalCommit, "finalCommit recorded");
    assert.equal(
      shipAttempt.evidence.finalCommit,
      shipAttempt.evidence.localIntegration?.finalCommit,
      "finalCommit == localIntegration.finalCommit",
    );

    const mainHead = repo.git(["rev-parse", "HEAD"]);
    assert.notEqual(mainHead, base, "base advanced");
    const mainCommits = repo.git(["rev-list", "HEAD"]).split("\n");
    assert.ok(!mainCommits.includes(candidate), "intermediate commit absent from base history");

    assert.ok(!existsSync(worktreePath), "worktree removed after accept");
    const branches = repo.git(["for-each-ref", "--format=%(refname)", "refs/heads"]).split("\n").filter(Boolean);
    assert.ok(!branches.includes("refs/heads/codepatrol/WORK-7.1.5"), "change branch removed after accept");
  } finally {
    rmSync(repo.parent, { recursive: true, force: true });
  }
});

test("candidate pinning: new commit after verify refuses ship start", async () => {
  const repo = createIsolatedRepo();
  try {
    repo.git(["init", "-b", "main"]);
    repo.git(["config", "user.name", "test"]);
    repo.git(["config", "user.email", "test"]);
    writeFileSync(join(repo.repoPath, "foo.txt"), "initial");
    repo.git(["add", "-A"]);
    repo.git(["commit", "-m", "initial"]);

    const worktreePath = join(repo.repoPath, "..", ".codepatrol-worktrees", WORK_ID);
    const { app } = createCodeApp(repo.repoPath, 0);
    const { candidate, wtPath } = await seedAndVerify(app, worktreePath);

    const wtGit = localGit(wtPath);
    writeFileSync(join(wtPath, "extra.txt"), "extra");
    await wtGit.exec(["add", "extra.txt"]);
    await wtGit.exec(["commit", "-m", "extra after verify"]);
    const newHead = await wtGit.exec(["rev-parse", "HEAD"]);
    assert.notEqual(newHead, candidate, "new commit differs from candidate");

    await assert.rejects(() => app.start(WORK_ID, "ship"), /differs from verified candidate/);
  } finally {
    rmSync(repo.parent, { recursive: true, force: true });
  }
});

test("candidate pinning: dirty worktree after verify refuses ship start", async () => {
  const repo = createIsolatedRepo();
  try {
    repo.git(["init", "-b", "main"]);
    repo.git(["config", "user.name", "test"]);
    repo.git(["config", "user.email", "test"]);
    writeFileSync(join(repo.repoPath, "foo.txt"), "initial");
    repo.git(["add", "-A"]);
    repo.git(["commit", "-m", "initial"]);

    const worktreePath = join(repo.repoPath, "..", ".codepatrol-worktrees", WORK_ID);
    const { app } = createCodeApp(repo.repoPath, 0);
    await seedAndVerify(app, worktreePath);

    writeFileSync(join(worktreePath, "product.txt"), "dirty content");

    await assert.rejects(() => app.start(WORK_ID, "ship"), /requires a clean checkout/);
  } finally {
    rmSync(repo.parent, { recursive: true, force: true });
  }
});

test("dirty base checkout refuses ship accept", async () => {
  const repo = createIsolatedRepo();
  try {
    repo.git(["init", "-b", "main"]);
    repo.git(["config", "user.name", "test"]);
    repo.git(["config", "user.email", "test"]);
    writeFileSync(join(repo.repoPath, "foo.txt"), "initial");
    repo.git(["add", "-A"]);
    repo.git(["commit", "-m", "initial"]);

    const worktreePath = join(repo.repoPath, "..", ".codepatrol-worktrees", WORK_ID);
    const { app } = createCodeApp(repo.repoPath, 0);
    await seedAndVerify(app, worktreePath);

    const shipStart = await app.start(WORK_ID, "ship");
    writeFileSync(join(repo.repoPath, "foo.txt"), "dirty base");

    await assert.rejects(
      () =>
        app.works.complete(WORK_ID, "ship", shipStart.attempt.runId, {
          decision: "accept" as const,
          summary: "accepted",
          todo: [{ id: "t1", status: "done" as const }],
          authority: "test",
        }),
      /requires a clean checkout/,
    );
  } finally {
    rmSync(repo.parent, { recursive: true, force: true });
  }
});
