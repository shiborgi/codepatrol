import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { GitChangeManager } from "../adapters/change.js";
import { GitCheckout } from "../adapters/checkout.js";
import { localGit } from "../adapters/git.js";
import { StateStore } from "../adapters/state-store.js";
import { SpecService } from "../application/spec-service.js";
import { WorkService } from "../application/work-service.js";
import { acceptanceOf, documentOf, type TestApp } from "./support/app.js";

const INITIATIVE_ID = "INIT-6";
const WORK_ID = "WORK-6.1.6";
const WAVE_ID = "WAVE-6.1";

interface CodeApp {
  app: TestApp;
  worktreePath: string;
}

function createCodeApp(repoRoot: string, counterSeed = 0): CodeApp {
  let clock = 3_000_000_000_000;
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
    async complete(workId, stage, decision, extra = {}) {
      const runId = await activeRunId(workId, store);
      return works.complete(workId, stage, runId, {
        decision,
        summary: `summary for ${decision}`,
        todo: [{ id: "t1", status: "done" }],
        ...extra,
      });
    },
    async runStage(workId, stage, decision, extra = {}) {
      const started = await app.start(workId, stage);
      return works.complete(workId, stage, started.attempt.runId, {
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
  return { app, worktreePath };
}

function createIsolatedRepo() {
  const parent = mkdtempSync(join(tmpdir(), "codepatrol-recovery-"));
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
    worktreePathFor(workId: string) {
      return join(repoPath, "..", ".codepatrol-worktrees", workId);
    },
  };
}

async function activeRunId(workId: string, store: StateStore): Promise<string> {
  const snapshot = await store.read();
  const work = snapshot.works.get(workId);
  const active = work?.attempts.find((a) => a.status === "active");
  return active?.runId ?? "00000000-0000-4000-8000-000000000000";
}

function codeWorkDoc() {
  return documentOf({
    id: INITIATIVE_ID,
    title: "INIT-6 change recovery",
    intent: "exercise change recovery and adoption",
    works: [
      {
        id: WORK_ID,
        wave: WAVE_ID,
        title: "code work",
        description: "exercise change recovery",
        workType: "feature",
        priority: "p1",
        delivery: "code",
        acceptance: ["recovery works"],
        blockedBy: [],
      },
    ],
  });
}

async function seedCodeChange(app: TestApp, worktreePath: string, counterSeed: number): Promise<void> {
  const counter = { value: counterSeed };
  const uuid = () => `00000000-0000-4000-8000-${String(++counter.value).padStart(12, "0")}`;
  // override the uuid function to ensure unique runIds across tests
  void uuid;
  const runId = (await app.specStart(INITIATIVE_ID)).runId;
  await app.specComplete(INITIATIVE_ID, runId, "apply", codeWorkDoc());
  for (const stage of ["plan", "review"] as const) {
    await app.runStage(WORK_ID, stage, "continue");
  }
  await app.start(WORK_ID, "build");
  assert.ok(existsSync(worktreePath), "build start creates the worktree");
  const worktreeGit = localGit(worktreePath);
  writeFileSync(join(worktreePath, "candidate.txt"), "feature for change");
  await worktreeGit.exec(["add", "candidate.txt"]);
  await worktreeGit.exec(["commit", "-m", "candidate change"]);
  await app.complete(WORK_ID, "build", "continue");
  // verify with return to build so subsequent tests can re-enter the build stage
  await app.runStage(WORK_ID, "verify", "return", {
    returnTo: "build",
    acceptance: acceptanceOf({ acceptance: ["recovery works"] }),
  });
}

test("adoption: rebuild after return reuses the existing Change branch and worktree", async () => {
  const repo = createIsolatedRepo();
  try {
    const worktreePath = repo.worktreePathFor(WORK_ID);
    const { app } = createCodeApp(repo.path, 1);
    await seedCodeChange(app, worktreePath, 100);

    const branchBefore = repo.headCommit(`refs/heads/codepatrol/${WORK_ID}`);
    const wtBefore = repo.headCommit("HEAD");

    await app.start(WORK_ID, "build");
    const wtAfter = repo.headCommit("HEAD");
    assert.equal(wtAfter, wtBefore, "worktree HEAD unchanged after adopt");
    assert.equal(
      repo.headCommit(`refs/heads/codepatrol/${WORK_ID}`),
      branchBefore,
      "branch HEAD unchanged after adopt",
    );
  } finally {
    repo.cleanup();
  }
});

test("recovery: missing worktree is recreated from the existing Change branch", async () => {
  const repo = createIsolatedRepo();
  try {
    const worktreePath = repo.worktreePathFor(WORK_ID);
    const { app } = createCodeApp(repo.path, 2);
    await seedCodeChange(app, worktreePath, 200);

    repo.git(["worktree", "remove", worktreePath]);
    assert.ok(!existsSync(worktreePath), "worktree was removed");

    await app.start(WORK_ID, "build");
    assert.ok(existsSync(worktreePath), "worktree was recreated");
  } finally {
    repo.cleanup();
  }
});

test("recovery: missing recorded branch is refused with explicit message and is never silently recreated", async () => {
  const repo = createIsolatedRepo();
  try {
    const worktreePath = repo.worktreePathFor(WORK_ID);
    const { app } = createCodeApp(repo.path, 3);
    await seedCodeChange(app, worktreePath, 300);

    repo.git(["worktree", "remove", worktreePath]);
    repo.git(["branch", "-D", `codepatrol/${WORK_ID}`]);
    assert.equal(repo.headRefs().includes(`refs/heads/codepatrol/${WORK_ID}`), false, "branch removed");

    const branchBefore = repo.headRefs();

    await assert.rejects(app.start(WORK_ID, "build"), new RegExp(`refs/heads/codepatrol/${WORK_ID} is missing`));

    assert.deepEqual(repo.headRefs(), branchBefore, "no new ref was created");
  } finally {
    repo.cleanup();
  }
});

test("recovery: diverged branch HEAD (out-of-band commit) is refused INVALID_STATE", async () => {
  const repo = createIsolatedRepo();
  try {
    const worktreePath = repo.worktreePathFor(WORK_ID);
    const { app } = createCodeApp(repo.path, 4);
    await seedCodeChange(app, worktreePath, 400);

    repo.git(["-C", worktreePath, "commit", "--allow-empty", "-m", "out-of-band"]);
    const newBranchHead = repo.headCommit(`refs/heads/codepatrol/${WORK_ID}`);

    await assert.rejects(
      app.start(WORK_ID, "build"),
      new RegExp(`HEAD ${newBranchHead} differs from recorded candidate`),
    );
  } finally {
    repo.cleanup();
  }
});

test("recovery: duplicate identity (branch checked out at unexpected path) is refused CONFLICT", async () => {
  const repo = createIsolatedRepo();
  try {
    const worktreePath = repo.worktreePathFor(WORK_ID);
    const { app } = createCodeApp(repo.path, 5);
    await seedCodeChange(app, worktreePath, 500);

    // Move the branch to an unexpected worktree to simulate a conflicting resource
    repo.git(["worktree", "remove", worktreePath]);
    const otherPath = join(repo.path, "..", `extra-checkout-${Date.now()}`);
    mkdirSync(otherPath, { recursive: true });
    repo.git(["worktree", "add", otherPath, `codepatrol/${WORK_ID}`]);

    await assert.rejects(app.start(WORK_ID, "build"), /duplicate Change identity.*conflicting resources/);
  } finally {
    repo.cleanup();
  }
});

test("recovery: orphan branch with no recorded evidence is refused CONFLICT", async () => {
  const repo = createIsolatedRepo();
  try {
    const { app } = createCodeApp(repo.path, 6);
    const runId = (await app.specStart(INITIATIVE_ID)).runId;
    await app.specComplete(INITIATIVE_ID, runId, "apply", codeWorkDoc());
    for (const stage of ["plan", "review"] as const) {
      await app.runStage(WORK_ID, stage, "continue");
    }

    repo.git(["branch", `codepatrol/${WORK_ID}`]);

    await assert.rejects(app.start(WORK_ID, "build"), /unexpected change branch.*no recorded Change evidence/);
  } finally {
    repo.cleanup();
  }
});

test("recovery: base-advanced flow — rebuild records new baseCommit, verify records baseCommit", async () => {
  const repo = createIsolatedRepo();
  try {
    const worktreePath = repo.worktreePathFor(WORK_ID);
    const { app } = createCodeApp(repo.path, 7);
    await seedCodeChange(app, worktreePath, 600);

    const originalBase = repo.headCommit("refs/heads/main");

    repo.git(["commit", "--allow-empty", "-m", "advance base"]);
    const newBase = repo.headCommit("refs/heads/main");
    assert.notEqual(newBase, originalBase, "base advanced");

    const buildRebuild = await app.start(WORK_ID, "build");
    const rebuildSnapshot = await app.store.read();
    const rebuildAttempt = rebuildSnapshot.works
      .get(WORK_ID)
      ?.attempts.find((a) => a.stage === "build" && a.runId === buildRebuild.attempt.runId);
    assert.equal(rebuildAttempt?.evidence?.baseCommit, newBase, "rebuild records new baseCommit");

    const worktreeGit = localGit(worktreePath);
    // manually reconcile the branch onto the advanced base (no automatic rebase)
    await worktreeGit.exec(["rebase", "main"]);
    writeFileSync(join(worktreePath, "feature.txt"), "feature post-advance");
    await worktreeGit.exec(["add", "feature.txt"]);
    await worktreeGit.exec(["commit", "-m", "feature post-advance"]);
    await app.complete(WORK_ID, "build", "continue");

    const verifyStart = await app.start(WORK_ID, "verify");
    await app.complete(WORK_ID, "verify", "continue", {
      acceptance: acceptanceOf({ acceptance: ["recovery works"] }),
    });
    const verifySnapshot = await app.store.read();
    const verifyAttempt = verifySnapshot.works
      .get(WORK_ID)
      ?.attempts.find((a) => a.stage === "verify" && a.runId === verifyStart.attempt.runId);
    assert.equal(verifyAttempt?.evidence?.baseCommit, newBase, "verify evidence records current baseCommit");
  } finally {
    repo.cleanup();
  }
});

test("recovery: prefix work-id regression (WORK-1.1.1 vs WORK-1.1.10) — exact porcelain matching", async () => {
  const repo = createIsolatedRepo();
  try {
    const workId10 = "WORK-1.1.10";
    const workId1 = "WORK-1.1.1";
    const wtPath10 = repo.worktreePathFor(workId10);

    mkdirSync(wtPath10, { recursive: true });
    repo.git(["worktree", "add", "-b", `codepatrol/${workId10}`, wtPath10]);

    const git = localGit(repo.path);
    const change = new GitChangeManager(git, repo.path, (path) => localGit(path));
    const inspection = await change.inspect(workId10);
    assert.ok(inspection.worktreeExists, "WORK-1.1.10 worktree exists by exact match");
    assert.equal(inspection.worktreePath, wtPath10, "exact path match (no substring confusion)");

    const inspection1 = await change.inspect(workId1);
    assert.equal(inspection1.worktreeExists, false, "WORK-1.1.1 does not claim the WORK-1.1.10 worktree");
    assert.equal(
      inspection1.conflictingWorktreePaths.length,
      0,
      "WORK-1.1.10 has no conflicting resources for WORK-1.1.1",
    );

    const wt10 = inspection.worktrees.find((w) => normalizePath(w.path) === normalizePath(wtPath10));
    assert.ok(wt10 !== undefined, "WORK-1.1.10 worktree entry present");
    assert.equal(wt10?.branch, `refs/heads/codepatrol/${workId10}`);
  } finally {
    repo.cleanup();
  }
});

test("recovery: ensure() uses inspect() for exact worktree matching (no substring collision)", async () => {
  const repo = createIsolatedRepo();
  try {
    const workId10 = "WORK-1.1.10";
    const wtPath10 = repo.worktreePathFor(workId10);

    mkdirSync(wtPath10, { recursive: true });
    repo.git(["worktree", "add", "-b", `codepatrol/${workId10}`, wtPath10]);

    const git = localGit(repo.path);
    const change = new GitChangeManager(git, repo.path, (path) => localGit(path));
    const result = await change.ensure("WORK-1.1.1", "refs/heads/main");
    assert.equal(
      result.worktreePath,
      repo.worktreePathFor("WORK-1.1.1"),
      "WORK-1.1.1 worktree path is created independently",
    );
    assert.notEqual(result.worktreePath, wtPath10, "WORK-1.1.1 worktree is NOT the WORK-1.1.10 worktree");

    const wt1 = repo.worktreePathFor("WORK-1.1.1");
    assert.ok(existsSync(wt1), "WORK-1.1.1 worktree was created");
    assert.ok(existsSync(wtPath10), "WORK-1.1.10 worktree still exists");
  } finally {
    repo.cleanup();
  }
});

function normalizePath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    let head = path;
    let tail = "";
    while (head !== "" && head !== "/" && head !== ".") {
      const slash = head.lastIndexOf("/");
      if (slash <= 0) return path;
      tail = head.slice(slash) + tail;
      head = head.slice(0, slash);
      try {
        return realpathSync(head) + tail;
      } catch {}
    }
    return path;
  }
}
