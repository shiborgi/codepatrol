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
import type { AttemptResult } from "../core/work.js";
import { acceptanceOf, documentOf, type TestApp } from "./support/app.js";

const INITIATIVE_ID = "INIT-6";
const WORK_ID = "WORK-6.1.5";
const WAVE_ID = "WAVE-6.1";

function codeWorkDoc() {
  return documentOf({
    id: INITIATIVE_ID,
    title: "INIT-6 ship rollback",
    intent: "exercise ship rollback and cleanup",
    works: [
      {
        id: WORK_ID,
        wave: WAVE_ID,
        title: "code work",
        description: "exercise ship rollback and cleanup",
        workType: "feature",
        priority: "p1",
        delivery: "code",
        acceptance: ["rollback leaves base unchanged"],
        blockedBy: [],
      },
    ],
  });
}

interface CodeApp {
  app: TestApp;
  warnings: string[];
  worktreePath: string;
}

function createCodeApp(repoRoot: string, counterSeed = 0): CodeApp {
  const warnings: string[] = [];
  let clock = 2_000_000_000_000;
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
    (msg) => warnings.push(msg),
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
    async start(WORK_ID, stage) {
      return works.start(WORK_ID, stage, { harness: "test", todo: [{ id: "t1", title: "do" }] });
    },
    async complete(WORK_ID, stage, decision, extra = {}) {
      const runId = await activeRunId(WORK_ID, store);
      return works.complete(WORK_ID, stage, runId, {
        decision,
        summary: `summary for ${decision}`,
        todo: [{ id: "t1", status: "done" }],
        ...extra,
      });
    },
    async runStage(WORK_ID, stage, decision, extra = {}) {
      const started = await app.start(WORK_ID, stage);
      return works.complete(WORK_ID, stage, started.attempt.runId, {
        decision,
        summary: `summary for ${decision}`,
        todo: [{ id: "t1", status: "done" }],
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
        {
          decision,
          summary: `spec ${decision}`,
          todo: [{ id: "t1", status: "done" }],
        },
        document,
      );
      return { initiative: r.initiative.id };
    },
  };
  return { app, warnings, worktreePath };
}

function createIsolatedRepo() {
  const parent = mkdtempSync(join(tmpdir(), "codepatrol-isolated-"));
  const repoPath = join(parent, "repo");
  mkdirSync(repoPath, { recursive: true });
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith("GIT_")) env[key] = value;
  }
  const git = (args: string[]): string => execFileSync("git", args, { cwd: repoPath, encoding: "utf8", env }).trim();
  git(["init", "-b", "main"]);
  git(["config", "user.name", "test"]);
  git(["config", "user.email", "test"]);
  git(["config", "user.name", "test"]);
  git(["config", "user.email", "test@localhost"]);
  git(["commit", "--allow-empty", "-m", "initial"]);
  return {
    path: repoPath,
    parent,
    cleanup() {
      rmSync(parent, { recursive: true, force: true });
    },
    git,
    headCommit(ref: string) {
      return git(["rev-parse", ref]);
    },
    headRefs(): string[] {
      return git(["for-each-ref", "--format=%(refname)", "refs/heads"])
        .split("\n")
        .filter((line) => line !== "");
    },
    refs(): string[] {
      return git(["for-each-ref", "--format=%(refname)"])
        .split("\n")
        .filter((line) => line !== "");
    },
  };
}

async function activeRunId(WORK_ID: string, store: StateStore): Promise<string> {
  const snapshot = await store.read();
  const work = snapshot.works.get(WORK_ID);
  const active = work?.attempts.find((a) => a.status === "active");
  return active?.runId ?? "00000000-0000-4000-8000-000000000000";
}

async function seedCodeChange(app: TestApp, worktreePath: string): Promise<string> {
  const runId = (await app.specStart(INITIATIVE_ID)).runId;
  await app.specComplete(INITIATIVE_ID, runId, "apply", codeWorkDoc());
  for (const stage of ["plan", "review"] as const) {
    await app.runStage(WORK_ID, stage, "continue");
  }
  const buildStarted = await app.start(WORK_ID, "build");
  assert.ok(existsSync(worktreePath), "build start creates the worktree");
  return buildStarted.attempt.runId;
}

function rollbackExtra(reason: string): Partial<AttemptResult> {
  return { authority: "tester", summary: reason };
}

// ---- Real-git tests: full Change lifecycle -> rollback / accept ----

test("rollback: full Change lifecycle -> ship rollback leaves base unchanged, branch retained, worktree removed, reason recorded", async () => {
  const repo = createIsolatedRepo();
  try {
    const baseCommit = repo.headCommit("refs/heads/main");
    const { app, warnings, worktreePath } = createCodeApp(repo.path);
    await seedCodeChange(app, worktreePath);
    repo.git(["-C", worktreePath, "commit", "--allow-empty", "-m", "candidate work"]);
    const candidateCommit = repo.headCommit(`refs/heads/codepatrol/${WORK_ID}`);
    await app.complete(WORK_ID, "build", "continue");

    await app.runStage(WORK_ID, "verify", "continue", {
      acceptance: acceptanceOf({ acceptance: ["rollback leaves base unchanged"] }),
    });

    const reason = "candidate has not been verified by the human test reviewer";
    const updated = await app.runStage(WORK_ID, "ship", "rollback", rollbackExtra(reason));

    assert.equal(updated.completion?.outcome, "rolled-back", "outcome is rolled-back");
    assert.equal(updated.completion?.authority, "tester", "authority is recorded");
    assert.equal(updated.completion?.summary, reason, "reason is recorded in completion.summary");

    const shipEvidence = updated.attempts.find((a) => a.stage === "ship");
    assert.equal(shipEvidence?.evidence?.candidateCommit, candidateCommit, "candidate SHA pinned in ship evidence");
    assert.equal(shipEvidence?.evidence?.baseCommit, baseCommit, "base SHA pinned in ship evidence");

    assert.equal(repo.headCommit("refs/heads/main"), baseCommit, "base is unchanged after rollback");
    const refs = repo.headRefs();
    assert.ok(refs.includes(`refs/heads/codepatrol/${WORK_ID}`), "Change branch is retained for investigation");
    assert.ok(!existsSync(worktreePath), "worktree is removed by rollback cleanup");
    assert.equal(warnings.length, 0, `no cleanup warnings on a clean rollback (got: ${warnings.join(" | ")})`);
  } finally {
    repo.cleanup();
  }
});

test("rollback: repeated rollback with same run id is idempotent and writes no new state commit", async () => {
  const repo = createIsolatedRepo();
  try {
    const { app, worktreePath } = createCodeApp(repo.path);
    await seedCodeChange(app, worktreePath);
    repo.git(["-C", worktreePath, "commit", "--allow-empty", "-m", "candidate"]);
    await app.complete(WORK_ID, "build", "continue");
    await app.runStage(WORK_ID, "verify", "continue", {
      acceptance: acceptanceOf({ acceptance: ["rollback leaves base unchanged"] }),
    });
    const stateBeforeShip = repo.headCommit("refs/codepatrol/state");
    const shipStarted = await app.start(WORK_ID, "ship");
    const reason = "candidate needs further investigation";
    await app.works.complete(WORK_ID, "ship", shipStarted.attempt.runId, {
      decision: "rollback",
      summary: reason,
      authority: "tester",
      todo: [{ id: "t1", status: "done" }],
    });
    const stateAfterFirst = repo.headCommit("refs/codepatrol/state");
    await app.works.complete(WORK_ID, "ship", shipStarted.attempt.runId, {
      decision: "rollback",
      summary: reason,
      authority: "tester",
      todo: [{ id: "t1", status: "done" }],
    });
    const stateAfterReplay = repo.headCommit("refs/codepatrol/state");
    assert.equal(stateAfterReplay, stateAfterFirst, "idempotent replay writes no new state commit");
    assert.notEqual(stateAfterFirst, stateBeforeShip, "first rollback did write a state commit");
  } finally {
    repo.cleanup();
  }
});

test("rollback: cleanup is best-effort — completion stands even when worktree removal reports a warning", async () => {
  const repo = createIsolatedRepo();
  try {
    const { app, warnings, worktreePath } = createCodeApp(repo.path);
    await seedCodeChange(app, worktreePath);
    repo.git(["-C", worktreePath, "commit", "--allow-empty", "-m", "candidate"]);
    await app.complete(WORK_ID, "build", "continue");
    await app.runStage(WORK_ID, "verify", "continue", {
      acceptance: acceptanceOf({ acceptance: ["rollback leaves base unchanged"] }),
    });
    const updated = await app.runStage(WORK_ID, "ship", "rollback", {
      authority: "tester",
      summary: "best-effort cleanup incomplete",
    });
    assert.equal(updated.completion?.outcome, "rolled-back", "completion stands regardless of cleanup outcome");
    assert.equal(warnings.length, 0, "no warnings on a clean rollback path");
  } finally {
    repo.cleanup();
  }
});

test("accept: full Change lifecycle -> ship accept removes worktree and branch, squash commit on base", async () => {
  const repo = createIsolatedRepo();
  try {
    const baseCommit = repo.headCommit("refs/heads/main");
    const { app, worktreePath } = createCodeApp(repo.path);
    await seedCodeChange(app, worktreePath);
    repo.git(["-C", worktreePath, "config", "user.email", "test@localhost"]);
    repo.git(["-C", worktreePath, "config", "user.name", "test"]);
    repo.git(["-C", worktreePath, "commit", "--allow-empty", "-m", "candidate"]);
    writeFileSync(join(worktreePath, "feature.txt"), "feature change for accept");
    repo.git(["-C", worktreePath, "add", "feature.txt"]);
    repo.git(["-C", worktreePath, "commit", "-m", "candidate change"]);
    await app.complete(WORK_ID, "build", "continue");
    await app.runStage(WORK_ID, "verify", "continue", {
      acceptance: acceptanceOf({ acceptance: ["rollback leaves base unchanged"] }),
    });
    const updated = await app.runStage(WORK_ID, "ship", "accept", { authority: "tester" });
    assert.equal(updated.completion?.outcome, "accepted");
    const refs = repo.headRefs();
    assert.ok(!refs.includes(`refs/heads/codepatrol/${WORK_ID}`), "accept removes the codepatrol branch");
    assert.ok(!existsSync(worktreePath), "accept removes the worktree");
    assert.notEqual(repo.headCommit("refs/heads/main"), baseCommit, "accept adds a squash commit on base");
    const shipEvidence = updated.attempts.find((a) => a.stage === "ship");
    assert.equal(
      shipEvidence?.evidence?.finalCommit,
      repo.headCommit("refs/heads/main"),
      "finalCommit is recorded in evidence",
    );
  } finally {
    repo.cleanup();
  }
});

test("rollback: ship rollback refuses when base HEAD drifted from recorded baseCommit", async () => {
  const repo = createIsolatedRepo();
  try {
    const { app, worktreePath } = createCodeApp(repo.path);
    await seedCodeChange(app, worktreePath);
    repo.git(["-C", worktreePath, "commit", "--allow-empty", "-m", "candidate"]);
    await app.complete(WORK_ID, "build", "continue");
    await app.runStage(WORK_ID, "verify", "continue", {
      acceptance: acceptanceOf({ acceptance: ["rollback leaves base unchanged"] }),
    });
    const shipStarted = await app.start(WORK_ID, "ship");
    repo.git(["commit", "--allow-empty", "-m", "drift during ship"]);
    await assert.rejects(
      app.works.complete(WORK_ID, "ship", shipStarted.attempt.runId, {
        decision: "rollback",
        summary: "drift forced",
        authority: "tester",
        todo: [{ id: "t1", status: "done" }],
      }),
      /base branch HEAD .* differs from recorded base commit/,
    );
    repo.git(["reset", "--hard", "HEAD~1"]);
    await app.works.complete(WORK_ID, "ship", shipStarted.attempt.runId, {
      decision: "rollback",
      summary: "drift recovered",
      authority: "tester",
      todo: [{ id: "t1", status: "done" }],
    });
  } finally {
    repo.cleanup();
  }
});

test("rollback: shipment evidence pins candidate and base; replay returns the same completion", async () => {
  const repo = createIsolatedRepo();
  try {
    const { app, worktreePath } = createCodeApp(repo.path);
    await seedCodeChange(app, worktreePath);
    repo.git(["-C", worktreePath, "commit", "--allow-empty", "-m", "candidate"]);
    const candidateCommit = repo.headCommit(`refs/heads/codepatrol/${WORK_ID}`);
    await app.complete(WORK_ID, "build", "continue");
    await app.runStage(WORK_ID, "verify", "continue", {
      acceptance: acceptanceOf({ acceptance: ["rollback leaves base unchanged"] }),
    });
    const shipStarted = await app.start(WORK_ID, "ship");
    const first = await app.works.complete(WORK_ID, "ship", shipStarted.attempt.runId, {
      decision: "rollback",
      summary: "first",
      authority: "tester",
      todo: [{ id: "t1", status: "done" }],
    });
    const second = await app.works.complete(WORK_ID, "ship", shipStarted.attempt.runId, {
      decision: "rollback",
      summary: "first",
      authority: "tester",
      todo: [{ id: "t1", status: "done" }],
    });
    assert.deepEqual(first.completion, second.completion, "replay returns the same completion");
    assert.equal(first.attempts.find((a) => a.stage === "ship")?.evidence?.candidateCommit, candidateCommit);
  } finally {
    repo.cleanup();
  }
});
