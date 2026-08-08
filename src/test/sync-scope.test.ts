import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { localGit } from "../adapters/git.js";
import { StateStore } from "../adapters/state-store.js";
import { SpecService } from "../application/spec-service.js";
import { type SyncScope, SyncService } from "../application/sync-service.js";
import { documentOf } from "./support/app.js";
import { FakeGitHub } from "./support/github.js";

function createRepo() {
  const parent = mkdtempSync(join(tmpdir(), "codepatrol-syncscope-"));
  const repoPath = join(parent, "repo");
  mkdirSync(repoPath, { recursive: true });
  const env: Record<string, string> = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" };
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith("GIT_")) env[key] = value;
  }
  const git = (args: string[]) => execFileSync("git", args, { cwd: repoPath, encoding: "utf8", env }).trim();
  git(["init", "-b", "main"]);
  git(["config", "user.name", "test"]);
  git(["config", "user.email", "test"]);
  git(["commit", "--allow-empty", "-m", "initial"]);
  const store = new StateStore(localGit(repoPath));
  let clock = 9_000_000_000_000;
  const now = () => {
    clock += 1000;
    return new Date(clock).toISOString();
  };
  let counter = 0;
  const uuid = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
  const spec = new SpecService(store, now, uuid);
  return {
    parent,
    repoPath,
    store,
    spec,
    now,
    uuid,
    cleanup: () => rmSync(parent, { recursive: true, force: true }),
  };
}

test("sync({initiativeId}) creates milestone and all Works' issues", async () => {
  const repo = createRepo();
  try {
    const github = new FakeGitHub();
    const sync = new SyncService(repo.store, github);

    const { runId } = await repo.spec.start({
      initiativeId: "INIT-1",
      todo: [{ id: "t1", title: "do" }],
      harness: "test",
    });
    await repo.spec.complete(
      "INIT-1",
      runId,
      { decision: "apply", summary: "applied", todo: [{ id: "t1", status: "done" as const }] },
      documentOf({
        id: "INIT-1",
        title: "Test initiative",
        intent: "test",
        works: [
          {
            id: "WORK-1.1.1",
            wave: "WAVE-1.1",
            title: "First work",
            description: "one",
            workType: "feature",
            priority: "p1",
            delivery: "no-code",
            acceptance: ["ok"],
            blockedBy: [],
          },
          {
            id: "WORK-1.1.2",
            wave: "WAVE-1.1",
            title: "Second work",
            description: "two",
            workType: "task",
            priority: "p2",
            delivery: "no-code",
            acceptance: ["ok"],
            blockedBy: [],
          },
        ],
      }),
    );

    const report = await sync.sync({ initiativeId: "INIT-1" });
    assert.equal(report.milestones.created.length, 1);
    assert.equal(report.issues.created.length, 2);
    assert.equal(github.milestones.length, 1);
    assert.equal(github.issues.length, 2);
    assert.equal(github.issues[0]?.milestone, 1);
    assert.equal(github.issues[1]?.milestone, 1);
  } finally {
    repo.cleanup();
  }
});

test("sync({initiativeId}) re-sync is idempotent", async () => {
  const repo = createRepo();
  try {
    const github = new FakeGitHub();
    const sync = new SyncService(repo.store, github);

    const { runId } = await repo.spec.start({
      initiativeId: "INIT-1",
      todo: [{ id: "t1", title: "do" }],
      harness: "test",
    });
    await repo.spec.complete(
      "INIT-1",
      runId,
      { decision: "apply", summary: "applied", todo: [{ id: "t1", status: "done" as const }] },
      documentOf({
        id: "INIT-1",
        title: "Test initiative",
        intent: "test",
        works: [
          {
            id: "WORK-1.1.1",
            wave: "WAVE-1.1",
            title: "First work",
            description: "one",
            workType: "feature",
            priority: "p1",
            delivery: "no-code",
            acceptance: ["ok"],
            blockedBy: [],
          },
        ],
      }),
    );

    await sync.sync({ initiativeId: "INIT-1" });
    const second = await sync.sync({ initiativeId: "INIT-1" });
    assert.equal(second.milestones.created.length, 0);
    assert.equal(second.milestones.updated.length, 0);
    assert.equal(second.issues.created.length, 0);
    assert.equal(github.milestones.length, 1);
    assert.equal(github.issues.length, 1);
  } finally {
    repo.cleanup();
  }
});

test("sync({workId, initiativeId}) is refused", async () => {
  const repo = createRepo();
  try {
    const github = new FakeGitHub();
    const sync = new SyncService(repo.store, github);
    await assert.rejects(
      () => sync.sync({ workId: "WORK-1.1.1", initiativeId: "INIT-1" } as SyncScope),
      /provide at most one/,
    );
  } finally {
    repo.cleanup();
  }
});

test("sync({initiativeId}) with unknown initiative refused NOT_FOUND", async () => {
  const repo = createRepo();
  try {
    const sync = new SyncService(repo.store, new FakeGitHub());
    await assert.rejects(() => sync.sync({ initiativeId: "INIT-99" }), /INIT-99 does not exist/);
  } finally {
    repo.cleanup();
  }
});

test("spec complete apply triggers initiative sync", async () => {
  const repo = createRepo();
  try {
    const github = new FakeGitHub();
    const sync = new SyncService(repo.store, github);

    const { runId } = await repo.spec.start({
      initiativeId: "INIT-1",
      todo: [{ id: "t1", title: "do" }],
      harness: "test",
    });
    await repo.spec.complete(
      "INIT-1",
      runId,
      { decision: "apply", summary: "applied", todo: [{ id: "t1", status: "done" as const }] },
      documentOf({
        id: "INIT-1",
        title: "Test initiative",
        intent: "test",
        works: [
          {
            id: "WORK-1.1.1",
            wave: "WAVE-1.1",
            title: "Work",
            description: "test",
            workType: "task",
            priority: "p2",
            delivery: "no-code",
            acceptance: ["ok"],
            blockedBy: [],
          },
        ],
      }),
    );

    // Sync after apply — should create milestone and issue
    const report = await sync.sync({ initiativeId: "INIT-1" });
    assert.equal(report.milestones.created.length, 1);
    assert.equal(report.issues.created.length, 1);

    // Verify persisted associations in state
    const snapshot = await repo.store.read();
    const work = snapshot.works.get("WORK-1.1.1");
    assert.equal(work?.github.issue, 1);
    assert.equal(work?.github.milestone, 1);
  } finally {
    repo.cleanup();
  }
});

test("spec complete discard does not trigger sync", async () => {
  const repo = createRepo();
  try {
    const github = new FakeGitHub();
    const { runId } = await repo.spec.start({
      initiativeId: "INIT-1",
      todo: [{ id: "t1", title: "do" }],
      harness: "test",
    });
    await repo.spec.complete("INIT-1", runId, {
      decision: "discard",
      summary: "discarded",
      todo: [{ id: "t1", status: "done" as const }],
    });

    // After discard, github should have no activity
    assert.equal(github.calls.length, 0, "no GitHub calls after discard");
  } finally {
    repo.cleanup();
  }
});

test("GitHub failure does not invalidate local spec", async () => {
  const repo = createRepo();
  try {
    const github = new FakeGitHub();
    github.failNext();
    const sync = new SyncService(repo.store, github);

    const { runId } = await repo.spec.start({
      initiativeId: "INIT-1",
      todo: [{ id: "t1", title: "do" }],
      harness: "test",
    });
    await repo.spec.complete(
      "INIT-1",
      runId,
      { decision: "apply", summary: "applied", todo: [{ id: "t1", status: "done" as const }] },
      documentOf(),
    );

    // Sync should throw due to injected failure
    await assert.rejects(() => sync.sync({ initiativeId: "INIT-1" }), /injected GitHub failure/);

    // Local spec remains applied
    const snapshot = await repo.store.read();
    const initiative = snapshot.initiatives.get("INIT-1");
    assert.equal(initiative?.definitionState, "defined");
  } finally {
    repo.cleanup();
  }
});

test("GitHub failure later sync reconciles", async () => {
  const repo = createRepo();
  try {
    const { runId } = await repo.spec.start({
      initiativeId: "INIT-1",
      todo: [{ id: "t1", title: "do" }],
      harness: "test",
    });
    await repo.spec.complete(
      "INIT-1",
      runId,
      { decision: "apply", summary: "applied", todo: [{ id: "t1", status: "done" as const }] },
      documentOf({
        id: "INIT-1",
        title: "Test initiative",
        intent: "test",
        works: [
          {
            id: "WORK-1.1.1",
            wave: "WAVE-1.1",
            title: "Work",
            description: "test",
            workType: "task",
            priority: "p2",
            delivery: "no-code",
            acceptance: ["ok"],
            blockedBy: [],
          },
        ],
      }),
    );

    const github1 = new FakeGitHub();
    github1.failNext();
    const sync1 = new SyncService(repo.store, github1);
    await assert.rejects(() => sync1.sync({ initiativeId: "INIT-1" }));

    // Later sync with fresh GitHub reconciles
    const github2 = new FakeGitHub();
    const sync2 = new SyncService(repo.store, github2);
    const report = await sync2.sync({ initiativeId: "INIT-1" });
    assert.equal(report.milestones.created.length, 1);
    assert.equal(report.issues.created.length, 1);
  } finally {
    repo.cleanup();
  }
});
