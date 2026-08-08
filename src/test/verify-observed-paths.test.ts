import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { GitChangeManager } from "../adapters/change.js";
import { GitCheckout } from "../adapters/checkout.js";
import { type Git, type GitResult, localGit } from "../adapters/git.js";
import { StateStore } from "../adapters/state-store.js";
import { SpecService } from "../application/spec-service.js";
import { WorkService } from "../application/work-service.js";
import { compareChangedPaths } from "../core/change.js";
import { documentOf, type TestApp } from "./support/app.js";

const INITIATIVE_ID = "INIT-7";
const WORK_ID = "WORK-7.1.3";
const WAVE_ID = "WAVE-7.1";

interface IsolatedRepo {
  parent: string;
  repoPath: string;
  git(args: string[]): string;
  worktreePathFor(workId: string): string;
}

function createIsolatedRepo(): IsolatedRepo {
  const parent = mkdtempSync(join(tmpdir(), "codepatrol-verifypaths-"));
  const repoPath = join(parent, "repo");
  mkdirSync(repoPath, { recursive: true });
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith("GIT_")) env[key] = value;
  }
  return {
    parent,
    repoPath,
    git: (args: string[]) => execFileSync("git", args, { cwd: repoPath, encoding: "utf8", env }).trim(),
    worktreePathFor: (workId: string) => join(repoPath, "..", ".codepatrol-worktrees", workId),
  };
}

interface CodeApp {
  app: TestApp;
  worktreePath: string;
}

function createCodeApp(repoRoot: string, counterSeed = 0, gitOverride?: Git, workServiceGit?: Git): CodeApp {
  let clock = 6_000_000_000_000;
  const now = () => {
    clock += 1000;
    return new Date(clock).toISOString();
  };
  const counter = { value: counterSeed };
  const uuid = () => `00000000-0000-4000-8000-${String(++counter.value).padStart(12, "0")}`;
  const baseGit = gitOverride ?? localGit(repoRoot);
  const wsGit = workServiceGit ?? baseGit;
  const store = new StateStore(baseGit);
  const change = new GitChangeManager(baseGit, repoRoot, (path) => localGit(path));
  const works = new WorkService(
    store,
    now,
    uuid,
    new GitCheckout(baseGit),
    change,
    repoRoot,
    (path) => localGit(path),
    wsGit,
  );
  const worktreePath = join(repoRoot, "..", ".codepatrol-worktrees", WORK_ID);
  const app: TestApp = {
    store,
    spec: new SpecService(store, now, uuid),
    works,
    async head() {
      const r = await baseGit.exec(["rev-parse", "HEAD"], { allowFailure: true });
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
    title: "INIT-7 verify paths",
    intent: "exercise verify changed paths",
    works: [
      {
        id: WORK_ID,
        wave: WAVE_ID,
        title: "code work",
        description: "verify paths",
        workType: "feature" as const,
        priority: "p1" as const,
        delivery: "code" as const,
        acceptance: ["paths verified"],
        blockedBy: [],
      },
    ],
  });
}

async function seedCodeChange(app: TestApp, worktreePath: string): Promise<void> {
  const runId = (await app.specStart(INITIATIVE_ID)).runId;
  await app.specComplete(INITIATIVE_ID, runId, "apply", codeWorkDoc());
  await app.runStage(WORK_ID, "plan", "continue");
  await app.runStage(WORK_ID, "review", "continue");
  await app.start(WORK_ID, "build");
  assert.ok(existsSync(worktreePath));
  const wt = localGit(worktreePath);
  writeFileSync(join(worktreePath, "candidate.txt"), "feature");
  await wt.exec(["add", "candidate.txt"]);
  await wt.exec(["commit", "-m", "candidate change"]);
  await app.complete(WORK_ID, "build", "continue");
}

function createPathTamperingGit(baseGit: Git, fakeResponse: string): Git {
  return {
    async exec(
      args: string[],
      options?: { input?: string; env?: Record<string, string>; allowFailure?: boolean },
    ): Promise<GitResult> {
      const cmd = args.join(" ");
      if (cmd.startsWith("diff --name-only")) {
        return { code: 0, stdout: fakeResponse, stderr: "" };
      }
      return baseGit.exec(args, options);
    },
  };
}

test("compareChangedPaths unit: equal sets in different order", () => {
  const cmp = compareChangedPaths(["b.txt", "a.txt"], ["a.txt", "b.txt"]);
  assert.equal(cmp.match, true);
  assert.deepEqual(cmp.onlyReported, []);
  assert.deepEqual(cmp.onlyObserved, []);
});

test("compareChangedPaths unit: subsets", () => {
  const cmp = compareChangedPaths(["a.txt", "b.txt"], ["a.txt"]);
  assert.equal(cmp.match, false);
  assert.deepEqual(cmp.onlyReported, ["b.txt"]);
  assert.deepEqual(cmp.onlyObserved, []);
});

test("compareChangedPaths unit: disjoint sets", () => {
  const cmp = compareChangedPaths(["a.txt"], ["b.txt"]);
  assert.equal(cmp.match, false);
  assert.deepEqual(cmp.onlyReported, ["a.txt"]);
  assert.deepEqual(cmp.onlyObserved, ["b.txt"]);
});

test("compareChangedPaths unit: empty reported", () => {
  const cmp = compareChangedPaths(undefined, ["a.txt"]);
  assert.equal(cmp.match, false);
  assert.deepEqual(cmp.onlyReported, []);
  assert.deepEqual(cmp.onlyObserved, ["a.txt"]);
});

test("Verify records observed changedPaths equal to real diff", async () => {
  const repo = createIsolatedRepo();
  try {
    repo.git(["init", "-b", "main"]);
    repo.git(["config", "user.name", "test"]);
    repo.git(["config", "user.email", "test"]);
    writeFileSync(join(repo.repoPath, "foo.txt"), "initial");
    repo.git(["add", "-A"]);
    repo.git(["commit", "-m", "initial"]);

    const worktreePath = repo.worktreePathFor(WORK_ID);
    const { app } = createCodeApp(repo.repoPath, 0);
    await seedCodeChange(app, worktreePath);

    const verifyStart = await app.start(WORK_ID, "verify");
    await app.works.complete(WORK_ID, "verify", verifyStart.attempt.runId, {
      decision: "continue",
      summary: "verified",
      todo: [{ id: "t1", status: "done" as const }],
      acceptance: [{ index: 0, status: "passed", summary: "ok" }],
    });

    // Verify evidence records changedPaths
    const snapshot = await app.store.read();
    const w = snapshot.works.get(WORK_ID);
    const verifyAttempt = w!.attempts.find((a) => a.stage === "verify" && a.status === "completed");
    assert.ok(verifyAttempt?.evidence?.changedPaths, "changedPaths recorded on verify");
    assert.ok(verifyAttempt!.evidence!.changedPaths!.includes("candidate.txt"), "candidate.txt in paths");

    // Distinguishability: build evidence has its own changedPaths
    const buildAttempt = w!.attempts.find((a) => a.stage === "build" && a.status === "completed");
    assert.ok(buildAttempt?.evidence?.change?.changedPaths, "build changedPaths present");
    assert.ok(verifyAttempt!.evidence!.changedPaths!.length > 0, "verify changedPaths non-empty");

    // Both match
    assert.deepEqual(
      [...verifyAttempt!.evidence!.changedPaths!].sort(),
      [...(buildAttempt?.evidence?.change?.changedPaths ?? [])].sort(),
      "verify paths equal build paths",
    );
  } finally {
    rmSync(repo.parent, { recursive: true, force: true });
  }
});

test("mismatch tripwire: continue fails on tampered path response", async () => {
  const repo = createIsolatedRepo();
  try {
    repo.git(["init", "-b", "main"]);
    repo.git(["config", "user.name", "test"]);
    repo.git(["config", "user.email", "test"]);
    writeFileSync(join(repo.repoPath, "foo.txt"), "initial");
    repo.git(["add", "-A"]);
    repo.git(["commit", "-m", "initial"]);

    const worktreePath = repo.worktreePathFor(WORK_ID);
    const { app } = createCodeApp(repo.repoPath, 0);
    await seedCodeChange(app, worktreePath);

    const tamperGit = createPathTamperingGit(localGit(repo.repoPath), "fake.txt\nextra.txt\n");
    const { app: tamperApp } = createCodeApp(repo.repoPath, 100, undefined, tamperGit);

    const verifyStart = await tamperApp.start(WORK_ID, "verify");
    await assert.rejects(
      () =>
        tamperApp.works.complete(WORK_ID, "verify", verifyStart.attempt.runId, {
          decision: "continue",
          summary: "verified",
          todo: [{ id: "t1", status: "done" as const }],
          acceptance: [{ index: 0, status: "passed", summary: "ok" }],
        }),
      /Build-reported changed paths differ/,
    );
  } finally {
    rmSync(repo.parent, { recursive: true, force: true });
  }
});

test("return allowed on mismatch: observed paths still recorded", async () => {
  const repo = createIsolatedRepo();
  try {
    repo.git(["init", "-b", "main"]);
    repo.git(["config", "user.name", "test"]);
    repo.git(["config", "user.email", "test"]);
    writeFileSync(join(repo.repoPath, "foo.txt"), "initial");
    repo.git(["add", "-A"]);
    repo.git(["commit", "-m", "initial"]);

    const worktreePath = repo.worktreePathFor(WORK_ID);
    const { app } = createCodeApp(repo.repoPath, 0);
    await seedCodeChange(app, worktreePath);

    const tamperGit = createPathTamperingGit(localGit(repo.repoPath), "fake.txt\n");
    const { app: tamperApp } = createCodeApp(repo.repoPath, 100, undefined, tamperGit);

    const verifyStart = await tamperApp.start(WORK_ID, "verify");
    await tamperApp.works.complete(WORK_ID, "verify", verifyStart.attempt.runId, {
      decision: "return",
      returnTo: "build",
      summary: "returning",
      todo: [{ id: "t1", status: "done" as const }],
      acceptance: [{ index: 0, status: "passed", summary: "ok" }],
    });

    // Verify evidence still records the observed (tampered) paths
    const snapshot = await app.store.read();
    const w = snapshot.works.get(WORK_ID);
    const verifyAttempt = w!.attempts.find((a) => a.stage === "verify" && a.status === "completed");
    assert.deepEqual(verifyAttempt?.evidence?.changedPaths, ["fake.txt"], "tampered paths recorded on return");
  } finally {
    rmSync(repo.parent, { recursive: true, force: true });
  }
});
