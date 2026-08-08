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
import { acceptanceOf, documentOf, type TestApp } from "./support/app.js";

const INITIATIVE_ID = "INIT-7";
const WORK_ID = "WORK-7.1.1";
const WAVE_ID = "WAVE-7.1";

interface IsolatedRepo {
  parent: string;
  repoPath: string;
  git(args: string[]): string;
  worktreePathFor(workId: string): string;
}

function createIsolatedRepo(): IsolatedRepo {
  const parent = mkdtempSync(join(tmpdir(), "codepatrol-lost-"));
  const repoPath = join(parent, "repo");
  mkdirSync(repoPath, { recursive: true });
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith("GIT_")) env[key] = value;
  }
  const git = (args: string[]): string => execFileSync("git", args, { cwd: repoPath, encoding: "utf8", env }).trim();
  return {
    parent,
    repoPath,
    git,
    worktreePathFor(workId: string) {
      return join(repoPath, "..", ".codepatrol-worktrees", workId);
    },
  };
}

interface CodeApp {
  app: TestApp;
  worktreePath: string;
}

function createCodeApp(repoRoot: string, counterSeed = 0, gitOverride?: Git): CodeApp {
  let clock = 4_000_000_000_000;
  const now = () => {
    clock += 1000;
    return new Date(clock).toISOString();
  };
  const counter = { value: counterSeed };
  const uuid = () => `00000000-0000-4000-8000-${String(++counter.value).padStart(12, "0")}`;
  const git = gitOverride ?? localGit(repoRoot);
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
        {
          decision,
          summary: `spec ${decision}`,
          todo: [{ id: "t1", status: "done" as const }],
        },
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
  const active = work?.attempts.find((a) => a.status === "active");
  return active?.runId ?? "00000000-0000-4000-8000-000000000000";
}

function codeWorkDoc() {
  return documentOf({
    id: INITIATIVE_ID,
    title: "INIT-7 lost-response recovery",
    intent: "exercise lost-response recovery",
    works: [
      {
        id: WORK_ID,
        wave: WAVE_ID,
        title: "code work",
        description: "exercise lost-response recovery",
        workType: "feature" as const,
        priority: "p1" as const,
        delivery: "code" as const,
        acceptance: ["recovery works"],
        blockedBy: [],
      },
    ],
  });
}

async function seedCodeChange(app: TestApp, worktreePath: string, _counterSeed: number): Promise<void> {
  const runId = (await app.specStart(INITIATIVE_ID)).runId;
  await app.specComplete(INITIATIVE_ID, runId, "apply", codeWorkDoc());
  await app.runStage(WORK_ID, "plan", "continue");
  await app.runStage(WORK_ID, "review", "continue");
  await app.start(WORK_ID, "build");
  assert.ok(existsSync(worktreePath), "build start creates the worktree");
  const worktreeGit = localGit(worktreePath);
  writeFileSync(join(worktreePath, "candidate.txt"), "feature for recovery");
  await worktreeGit.exec(["add", "candidate.txt"]);
  await worktreeGit.exec(["commit", "-m", "candidate change"]);
  await app.complete(WORK_ID, "build", "continue");
  await app.runStage(WORK_ID, "verify", "continue", {
    acceptance: acceptanceOf({ acceptance: ["recovery works"] }),
  });
}

async function startShip(app: TestApp): Promise<string> {
  const shipStart = await app.start(WORK_ID, "ship");
  return shipStart.attempt.runId;
}

function createFailingCASGit(baseGit: Git, failAfterSuccessCount: number): Git {
  let calls = 0;
  return {
    async exec(
      args: string[],
      options?: { input?: string; env?: Record<string, string>; allowFailure?: boolean },
    ): Promise<GitResult> {
      const cmd = args.join(" ");
      if (cmd.startsWith("update-ref refs/codepatrol/state")) {
        calls += 1;
        if (calls > failAfterSuccessCount) {
          return { code: 128, stdout: "", stderr: "fatal: cannot lock ref (injected CAS failure)" };
        }
      }
      return baseGit.exec(args, options);
    },
  };
}

test("lost-response retry adopts the existing integration commit", async () => {
  const repo = createIsolatedRepo();
  try {
    repo.git(["init", "-b", "main"]);
    repo.git(["config", "user.name", "test"]);
    repo.git(["config", "user.email", "test"]);
    writeFileSync(join(repo.repoPath, "foo.txt"), "initial");
    repo.git(["add", "-A"]);
    repo.git(["commit", "-m", "initial"]);
    const base = repo.git(["rev-parse", "HEAD"]);

    const worktreePath = repo.worktreePathFor(WORK_ID);
    const failingGit = createFailingCASGit(localGit(repo.repoPath), 11);
    const { app } = createCodeApp(repo.repoPath, 0, failingGit);
    await seedCodeChange(app, worktreePath, 100);
    const shipRunId = await startShip(app);

    const shipResult = {
      decision: "accept" as const,
      summary: "accepted",
      todo: [{ id: "t1", status: "done" as const }],
      authority: "test",
    };

    // Ship complete should fail because CAS is blocked
    await assert.rejects(() => app.works.complete(WORK_ID, "ship", shipRunId, shipResult), /could not commit state/);

    // Verify exactly one integration commit exists (the squash landed)
    const log = repo.git(["log", "--format=%H %s", "HEAD"]);
    const markerCommits = log.split("\n").filter((l) => l.includes(`codepatrol: ship ${WORK_ID}`));
    assert.equal(markerCommits.length, 1, "exactly one integration commit after failed CAS");

    // Recreate service with non-failing git and retry
    const freshGit = localGit(repo.repoPath);
    const { app: app2 } = createCodeApp(repo.repoPath, 200, freshGit);
    const work2 = await app2.works.complete(WORK_ID, "ship", shipRunId, shipResult);

    // Verify work accepted
    assert.equal(work2.completion?.outcome, "accepted");

    // Verify still exactly one integration commit (adopted, not duplicated)
    const log2 = repo.git(["log", "--format=%H %s", "HEAD"]);
    const markerCommits2 = log2.split("\n").filter((l) => l.includes(`codepatrol: ship ${WORK_ID}`));
    assert.equal(markerCommits2.length, 1, "still exactly one integration commit after retry");

    // Verify localIntegration recorded
    const snapshot = await app2.store.read();
    const work = snapshot.works.get(WORK_ID);
    const shipAttempt = work!.attempts.find((a) => a.stage === "ship");
    assert.ok(shipAttempt?.evidence?.localIntegration, "localIntegration recorded");
    assert.equal(shipAttempt!.evidence!.localIntegration!.status, "integrated");

    // Verify base advanced
    const currentBase = repo.git(["rev-parse", "HEAD"]);
    assert.notEqual(currentBase, base, "base advanced");
  } finally {
    rmSync(repo.parent, { recursive: true, force: true });
  }
});

test("poisoned marker refused (mismatched tree)", async () => {
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
    await seedCodeChange(app, worktreePath, 100);
    const shipRunId = await startShip(app);

    const snapshot = await app.store.read();
    const work = snapshot.works.get(WORK_ID);
    const verifyEntry = work!.attempts.find((a) => a.stage === "verify" && a.status === "completed");
    const candidate = verifyEntry?.evidence?.candidateCommit;
    assert.ok(candidate, "candidate commit found");

    // Inject a poisoned marker: correct subject but different tree
    const markerMessage = `codepatrol: ship ${WORK_ID} ${candidate}`;
    writeFileSync(join(repo.repoPath, "poisoned.txt"), "different content");
    repo.git(["add", "-A"]);
    repo.git(["commit", "-m", markerMessage]);

    const shipResult = {
      decision: "accept" as const,
      summary: "accepted",
      todo: [{ id: "t1", status: "done" as const }],
      authority: "test",
    };

    await assert.rejects(() => app.works.complete(WORK_ID, "ship", shipRunId, shipResult), /tree differs/);
  } finally {
    rmSync(repo.parent, { recursive: true, force: true });
  }
});

test("ambiguous marker refused", async () => {
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
    await seedCodeChange(app, worktreePath, 100);
    const shipRunId = await startShip(app);

    const snapshot = await app.store.read();
    const work = snapshot.works.get(WORK_ID);
    const verifyEntry = work!.attempts.find((a) => a.stage === "verify" && a.status === "completed");
    const candidate = verifyEntry?.evidence?.candidateCommit;
    assert.ok(candidate, "candidate commit found");

    // Inject two commits with the exact same marker
    const markerMessage = `codepatrol: ship ${WORK_ID} ${candidate}`;
    repo.git(["commit", "--allow-empty", "-m", markerMessage]);
    repo.git(["commit", "--allow-empty", "-m", markerMessage]);

    const shipResult = {
      decision: "accept" as const,
      summary: "accepted",
      todo: [{ id: "t1", status: "done" as const }],
      authority: "test",
    };

    await assert.rejects(
      () => app.works.complete(WORK_ID, "ship", shipRunId, shipResult),
      /ambiguous integration commits/,
    );
  } finally {
    rmSync(repo.parent, { recursive: true, force: true });
  }
});

test("idempotent repeat ship accept", async () => {
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
    await seedCodeChange(app, worktreePath, 100);
    const shipRunId = await startShip(app);

    const shipResult = {
      decision: "accept" as const,
      summary: "accepted",
      todo: [{ id: "t1", status: "done" as const }],
      authority: "test",
    };

    await app.works.complete(WORK_ID, "ship", shipRunId, shipResult);

    // Repeat with same result — idempotent
    const work2 = await app.works.complete(WORK_ID, "ship", shipRunId, shipResult);
    assert.equal(work2.completion?.outcome, "accepted");

    // Verify exactly one integration commit
    const log = repo.git(["log", "--format=%H %s", "HEAD"]);
    const markerCommits = log.split("\n").filter((l) => l.includes(`codepatrol: ship ${WORK_ID}`));
    assert.equal(markerCommits.length, 1, "exactly one integration commit");
  } finally {
    rmSync(repo.parent, { recursive: true, force: true });
  }
});

test("fresh integration unchanged (no existing marker)", async () => {
  const repo = createIsolatedRepo();
  try {
    repo.git(["init", "-b", "main"]);
    repo.git(["config", "user.name", "test"]);
    repo.git(["config", "user.email", "test"]);
    writeFileSync(join(repo.repoPath, "foo.txt"), "initial");
    repo.git(["add", "-A"]);
    repo.git(["commit", "-m", "initial"]);
    const base = repo.git(["rev-parse", "HEAD"]);

    const worktreePath = repo.worktreePathFor(WORK_ID);
    const { app } = createCodeApp(repo.repoPath, 0);
    await seedCodeChange(app, worktreePath, 100);
    const shipRunId = await startShip(app);

    const shipResult = {
      decision: "accept" as const,
      summary: "accepted",
      todo: [{ id: "t1", status: "done" as const }],
      authority: "test",
    };

    await app.works.complete(WORK_ID, "ship", shipRunId, shipResult);

    // Verify exactly one integration commit
    const log = repo.git(["log", "--format=%H %s", "HEAD"]);
    const markerCommits = log.split("\n").filter((l) => l.includes(`codepatrol: ship ${WORK_ID}`));
    assert.equal(markerCommits.length, 1, "exactly one integration commit");

    // Verify marker message format
    const snapshot = await app.store.read();
    const work = snapshot.works.get(WORK_ID);
    const shipAttempt = work!.attempts.find((a) => a.stage === "ship");
    const candidate = shipAttempt?.evidence?.candidateCommit;
    assert.ok(markerCommits[0]!.includes(candidate!), "marker includes candidate commit");

    // Verify base advanced
    const currentBase = repo.git(["rev-parse", "HEAD"]);
    assert.notEqual(currentBase, base, "base advanced");
  } finally {
    rmSync(repo.parent, { recursive: true, force: true });
  }
});
