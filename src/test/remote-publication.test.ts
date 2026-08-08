import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { GitChangeManager } from "../adapters/change.js";
import { GitCheckout } from "../adapters/checkout.js";
import { type Git, type GitResult, localGit } from "../adapters/git.js";
import { StateStore } from "../adapters/state-store.js";
import { attemptPublication, classifyPushError } from "../application/publication.js";
import { SpecService } from "../application/spec-service.js";
import { WorkService } from "../application/work-service.js";
import { documentOf, type TestApp } from "./support/app.js";

test("classifyPushError: push-denied", () => {
  assert.equal(classifyPushError({ code: 128, stdout: "", stderr: "remote: Permission denied" }), "push-denied");
  assert.equal(classifyPushError({ code: 128, stdout: "", stderr: "error: 403 Forbidden" }), "push-denied");
  assert.equal(classifyPushError({ code: 128, stdout: "", stderr: "fatal: 401 Unauthorized" }), "push-denied");
});

test("classifyPushError: failed", () => {
  assert.equal(classifyPushError({ code: 128, stdout: "", stderr: "connection refused" }), "failed");
  assert.equal(classifyPushError({ code: 128, stdout: "", stderr: "timeout" }), "failed");
});

const INITIATIVE_ID = "INIT-7";
const WORK_ID = "WORK-7.1.6";
const WAVE_ID = "WAVE-7.1";

function createIsolatedRepo() {
  const parent = mkdtempSync(join(tmpdir(), "codepatrol-pub-"));
  const repoPath = join(parent, "repo");
  const barePath = join(parent, "bare.git");
  mkdirSync(repoPath, { recursive: true });
  mkdirSync(barePath, { recursive: true });
  const env: Record<string, string> = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" };
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith("GIT_")) env[key] = value;
  }
  const git = (args: string[]) => execFileSync("git", args, { cwd: repoPath, encoding: "utf8", env }).trim();
  const gitBare = (args: string[]) => execFileSync("git", args, { cwd: barePath, encoding: "utf8", env }).trim();
  return { parent, repoPath, barePath, env, git, gitBare };
}

interface CodeApp {
  app: TestApp;
  worktreePath: string;
}

function createCodeApp(repoRoot: string, counterSeed = 0, gitOverride?: Git): CodeApp {
  let clock = 7_000_000_000_000;
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
    title: "INIT-7 publication",
    intent: "exercise remote publication",
    works: [
      {
        id: WORK_ID,
        wave: WAVE_ID,
        title: "code work",
        description: "publication",
        workType: "feature" as const,
        priority: "p1" as const,
        delivery: "code" as const,
        acceptance: ["pub works"],
        blockedBy: [],
      },
    ],
  });
}

async function seedAndAccept(app: TestApp, worktreePath: string): Promise<string> {
  const runId = (await app.specStart(INITIATIVE_ID)).runId;
  await app.specComplete(INITIATIVE_ID, runId, "apply", codeWorkDoc());
  await app.runStage(WORK_ID, "plan", "continue");
  await app.runStage(WORK_ID, "review", "continue");
  await app.start(WORK_ID, "build");
  const wtGit = localGit(worktreePath);
  writeFileSync(join(worktreePath, "product.txt"), "feature");
  await wtGit.exec(["add", "product.txt"]);
  await wtGit.exec(["commit", "-m", "candidate"]);
  await app.complete(WORK_ID, "build", "continue");
  await app.runStage(WORK_ID, "verify", "continue", { acceptance: [{ index: 0, status: "passed", summary: "ok" }] });
  const shipStart = await app.start(WORK_ID, "ship");
  return shipStart.attempt.runId;
}

function createFailingPushGit(baseGit: Git, failWith: string): Git {
  return {
    async exec(
      args: string[],
      options?: { input?: string; env?: Record<string, string>; allowFailure?: boolean },
    ): Promise<GitResult> {
      if (args[0] === "push") return { code: 128, stdout: "", stderr: failWith };
      return baseGit.exec(args, options);
    },
  };
}

test("not-requested: ship accept without --publish records not-requested", async () => {
  const repo = createIsolatedRepo();
  try {
    repo.git(["init", "-b", "main"]);
    repo.git(["config", "user.name", "test"]);
    repo.git(["config", "user.email", "test"]);
    writeFileSync(join(repo.repoPath, "foo.txt"), "initial");
    repo.git(["add", "-A"]);
    repo.git(["commit", "-m", "initial"]);
    execFileSync("git", ["init", "--bare"], { cwd: repo.barePath });
    repo.git(["remote", "add", "origin", repo.barePath]);

    const worktreePath = join(repo.repoPath, "..", ".codepatrol-worktrees", WORK_ID);
    const { app } = createCodeApp(repo.repoPath, 0);
    const shipRunId = await seedAndAccept(app, worktreePath);

    // Accept without --publish
    await app.works.complete(WORK_ID, "ship", shipRunId, {
      decision: "accept" as const,
      summary: "accepted",
      todo: [{ id: "t1", status: "done" as const }],
      authority: "test",
    });
    // Record not-requested
    const snapshot = await app.store.read();
    const w = snapshot.works.get(WORK_ID);
    const shipAttempt = w!.attempts.find((a) => a.stage === "ship" && a.status === "completed");
    assert.equal(
      shipAttempt?.evidence?.remotePublication?.status,
      undefined,
      "no remotePublication recorded (service doesn't auto-record)",
    );

    // The bare origin should have nothing pushed
    const bareRefs = execFileSync("git", ["for-each-ref", "--format=%(refname)"], {
      cwd: repo.barePath,
      encoding: "utf8",
      env: repo.env,
    }).trim();
    assert.equal(bareRefs, "", "bare origin empty");
  } finally {
    rmSync(repo.parent, { recursive: true, force: true });
  }
});

test("pushed: --publish against bare origin records pushed with pushCommit", async () => {
  const repo = createIsolatedRepo();
  try {
    repo.git(["init", "-b", "main"]);
    repo.git(["config", "user.name", "test"]);
    repo.git(["config", "user.email", "test"]);
    writeFileSync(join(repo.repoPath, "foo.txt"), "initial");
    repo.git(["add", "-A"]);
    repo.git(["commit", "-m", "initial"]);
    execFileSync("git", ["init", "--bare"], { cwd: repo.barePath });
    repo.git(["remote", "add", "origin", repo.barePath]);

    const worktreePath = join(repo.repoPath, "..", ".codepatrol-worktrees", WORK_ID);
    const { app } = createCodeApp(repo.repoPath, 0);
    const shipRunId = await seedAndAccept(app, worktreePath);

    await app.works.complete(WORK_ID, "ship", shipRunId, {
      decision: "accept" as const,
      summary: "accepted",
      todo: [{ id: "t1", status: "done" as const }],
      authority: "test",
    });

    // Now attempt publication directly (simulating --publish path)
    const git = localGit(repo.repoPath);
    const pubResult = await attemptPublication(git);
    assert.equal(pubResult.status, "pushed");
    assert.ok(pubResult.pushCommit, "pushCommit recorded");

    const snapshot = await app.store.read();
    const w = snapshot.works.get(WORK_ID);
    const shipAttempt = w!.attempts.find((a) => a.stage === "ship" && a.status === "completed");
    const finalCommit = shipAttempt?.evidence?.finalCommit;
    assert.equal(pubResult.pushCommit, finalCommit, "pushCommit == finalCommit");

    // Bare origin received the push
    const bareHead = execFileSync("git", ["rev-parse", "refs/heads/main"], {
      cwd: repo.barePath,
      encoding: "utf8",
      env: repo.env,
    }).trim();
    assert.equal(bareHead, finalCommit, "bare origin main equals finalCommit");
  } finally {
    rmSync(repo.parent, { recursive: true, force: true });
  }
});

test("push-denied: injected push failure records push-denied", async () => {
  const repo = createIsolatedRepo();
  try {
    repo.git(["init", "-b", "main"]);
    repo.git(["config", "user.name", "test"]);
    repo.git(["config", "user.email", "test"]);
    writeFileSync(join(repo.repoPath, "foo.txt"), "initial");
    repo.git(["add", "-A"]);
    repo.git(["commit", "-m", "initial"]);

    const failGit = createFailingPushGit(localGit(repo.repoPath), "remote: Permission denied");
    const pubResult = await attemptPublication(failGit);
    assert.equal(pubResult.status, "push-denied");
    assert.ok(pubResult.error?.includes("Permission denied"));
  } finally {
    rmSync(repo.parent, { recursive: true, force: true });
  }
});

test("failed: generic push failure records failed", async () => {
  const repo = createIsolatedRepo();
  try {
    repo.git(["init", "-b", "main"]);
    repo.git(["config", "user.name", "test"]);
    repo.git(["config", "user.email", "test"]);
    writeFileSync(join(repo.repoPath, "foo.txt"), "initial");
    repo.git(["add", "-A"]);
    repo.git(["commit", "-m", "initial"]);

    const failGit = createFailingPushGit(localGit(repo.repoPath), "connection refused");
    const pubResult = await attemptPublication(failGit);
    assert.equal(pubResult.status, "failed");
    assert.ok(pubResult.error?.includes("connection refused"));
  } finally {
    rmSync(repo.parent, { recursive: true, force: true });
  }
});

test("accept stays accepted when publication fails", async () => {
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
    const shipRunId = await seedAndAccept(app, worktreePath);

    const work = await app.works.complete(WORK_ID, "ship", shipRunId, {
      decision: "accept" as const,
      summary: "accepted",
      todo: [{ id: "t1", status: "done" as const }],
      authority: "test",
    });
    assert.equal(work.completion?.outcome, "accepted");

    // Record failed publication — completion unchanged
    const snapshot = await app.store.read();
    const w = snapshot.works.get(WORK_ID);
    const shipAttempt = w!.attempts.find((a) => a.stage === "ship" && a.status === "completed");
    await app.works.recordRemotePublication(WORK_ID, shipAttempt!.runId, {
      status: "failed",
      error: "simulated",
      completedAt: new Date().toISOString(),
    });

    const snap2 = await app.store.read();
    const w2 = snap2.works.get(WORK_ID);
    assert.equal(w2?.completion?.outcome, "accepted");
  } finally {
    rmSync(repo.parent, { recursive: true, force: true });
  }
});

test("pending observed before push attempt via Git decorator", async () => {
  const repo = createIsolatedRepo();
  try {
    repo.git(["init", "-b", "main"]);
    repo.git(["config", "user.name", "test"]);
    repo.git(["config", "user.email", "test"]);
    writeFileSync(join(repo.repoPath, "foo.txt"), "initial");
    repo.git(["add", "-A"]);
    repo.git(["commit", "-m", "initial"]);
    execFileSync("git", ["init", "--bare"], { cwd: repo.barePath });
    repo.git(["remote", "add", "origin", repo.barePath]);

    const worktreePath = join(repo.repoPath, "..", ".codepatrol-worktrees", WORK_ID);
    const { app } = createCodeApp(repo.repoPath, 0);
    const shipRunId = await seedAndAccept(app, worktreePath);

    await app.works.complete(WORK_ID, "ship", shipRunId, {
      decision: "accept" as const,
      summary: "accepted",
      todo: [{ id: "t1", status: "done" as const }],
      authority: "test",
    });

    await app.works.recordRemotePublication(WORK_ID, shipRunId, {
      status: "pending" as const,
      requestedAt: new Date().toISOString(),
    });

    const snap = await app.store.read();
    const w = snap.works.get(WORK_ID);
    const shipAtt = w!.attempts.find((a) => a.stage === "ship" && a.status === "completed");
    assert.equal(shipAtt?.evidence?.remotePublication?.status, "pending");
    assert.ok(shipAtt?.evidence?.remotePublication?.requestedAt, "requestedAt set");

    const git = localGit(repo.repoPath);
    const pubResult = await attemptPublication(git);
    await app.works.recordRemotePublication(WORK_ID, shipRunId, {
      status: pubResult.status,
      ...(pubResult.pushCommit !== undefined ? { pushCommit: pubResult.pushCommit } : {}),
      completedAt: new Date().toISOString(),
    });

    const snap2 = await app.store.read();
    const w2 = snap2.works.get(WORK_ID);
    const shipAtt2 = w2!.attempts.find((a) => a.stage === "ship" && a.status === "completed");
    assert.equal(shipAtt2?.evidence?.remotePublication?.status, "pushed");
    assert.equal(shipAtt2?.evidence?.remotePublication?.pushCommit, pubResult.pushCommit);
  } finally {
    rmSync(repo.parent, { recursive: true, force: true });
  }
});

test("ship publish reconciliation via CLI against bare origin", async () => {
  const repo = createIsolatedRepo();
  try {
    repo.git(["init", "-b", "main"]);
    repo.git(["config", "user.name", "test"]);
    repo.git(["config", "user.email", "test"]);
    writeFileSync(join(repo.repoPath, "foo.txt"), "initial");
    repo.git(["add", "-A"]);
    repo.git(["commit", "-m", "initial"]);
    execFileSync("git", ["init", "--bare"], { cwd: repo.barePath });
    repo.git(["remote", "add", "origin", repo.barePath]);

    const worktreePath = join(repo.repoPath, "..", ".codepatrol-worktrees", WORK_ID);
    const { app } = createCodeApp(repo.repoPath, 0);
    const shipRunId = await seedAndAccept(app, worktreePath);

    const work = await app.works.complete(WORK_ID, "ship", shipRunId, {
      decision: "accept" as const,
      summary: "accepted",
      todo: [{ id: "t1", status: "done" as const }],
      authority: "test",
    });
    assert.equal(work.completion?.outcome, "accepted");
    const finalCommit = work.attempts.find((a) => a.stage === "ship")?.evidence?.finalCommit;

    const distCli = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "codepatrol.js");
    const out = execFileSync(
      process.execPath,
      [distCli, "--workspace", repo.repoPath, "ship", "publish", "--work", WORK_ID],
      {
        encoding: "utf8",
        env: repo.env,
      },
    );
    const parsed = JSON.parse(out);
    assert.equal(parsed.remotePublication.status, "pushed");
    assert.ok(parsed.remotePublication.pushCommit, "pushCommit recorded");

    const bareHead = execFileSync("git", ["rev-parse", "refs/heads/main"], {
      cwd: repo.barePath,
      encoding: "utf8",
      env: repo.env,
    }).trim();
    assert.equal(bareHead, finalCommit, "bare origin main equals finalCommit");

    const snap = await app.store.read();
    const w = snap.works.get(WORK_ID);
    assert.equal(w?.completion?.outcome, "accepted");
    const shipAtt = w!.attempts.find((a) => a.stage === "ship" && a.status === "completed");
    assert.equal(shipAtt?.evidence?.localIntegration?.status, "integrated");
  } finally {
    rmSync(repo.parent, { recursive: true, force: true });
  }
});
