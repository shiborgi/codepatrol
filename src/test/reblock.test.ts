import assert from "node:assert/strict";
import test from "node:test";
import { SyncService, workMarker } from "../application/sync-service.js";
import { createApp, documentOf } from "./support/app.js";
import { FakeGitHub } from "./support/github.js";
import { createRepo } from "./support/repo.js";

const THREE = [
  {
    id: "WORK-1.1.1",
    wave: "WAVE-1.1",
    title: "Original blocker",
    description: "a",
    workType: "task" as const,
    priority: "p1" as const,
    delivery: "no-code" as const,
    acceptance: ["a"],
    blockedBy: [],
  },
  {
    id: "WORK-1.1.2",
    wave: "WAVE-1.1",
    title: "Dependent",
    description: "b",
    workType: "task" as const,
    priority: "p2" as const,
    delivery: "no-code" as const,
    acceptance: ["b"],
    blockedBy: ["WORK-1.1.1"],
  },
  {
    id: "WORK-1.1.3",
    wave: "WAVE-1.1",
    title: "Replacement",
    description: "c",
    workType: "task" as const,
    priority: "p1" as const,
    delivery: "no-code" as const,
    acceptance: ["c"],
    blockedBy: [],
  },
];

test("rolled-back blocker recovery: reblock to a replacement, audited", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    const github = new FakeGitHub();
    const sync = new SyncService(app.store, github);
    const { runId } = await app.specStart("INIT-1");
    await app.specComplete("INIT-1", runId, "apply", documentOf({ works: THREE }));

    await app.runStage("WORK-1.1.2", "plan", "continue");
    await app.runStage("WORK-1.1.2", "review", "continue");
    await assert.rejects(app.start("WORK-1.1.2", "build"), /cannot build/);

    for (const stage of ["plan", "review", "build", "verify"] as const) {
      await app.runStage("WORK-1.1.1", stage, "continue");
    }
    await app.runStage("WORK-1.1.1", "ship", "rollback", { authority: "tester" });
    await assert.rejects(app.start("WORK-1.1.2", "build"), /cannot build/, "rolled-back blocker still blocks");

    const reblocked = await app.works.reblock("WORK-1.1.2", ["WORK-1.1.3"], {
      summary: "WORK-1.1.1 rolled back and WORK-1.1.3 replaces it",
      authority: "tester",
    });
    assert.deepEqual(reblocked.blockedBy, ["WORK-1.1.3"]);
    assert.equal(reblocked.dependencyRevisions.length, 1);
    const revision = reblocked.dependencyRevisions[0];
    assert.equal(revision?.revision, 1);
    assert.deepEqual(revision?.previous, ["WORK-1.1.1"]);
    assert.deepEqual(revision?.next, ["WORK-1.1.3"]);
    assert.equal(revision?.authority, "tester");

    for (const stage of ["plan", "review", "build", "verify"] as const) {
      await app.runStage("WORK-1.1.3", stage, "continue");
    }
    await app.runStage("WORK-1.1.3", "ship", "accept", { authority: "tester" });

    const started = await app.start("WORK-1.1.2", "build");
    assert.equal(started.attempt.stage, "build", "dependent builds after reblock + accept");

    await sync.sync();
    const issue = github.issues.find((candidate) => candidate.body.includes(workMarker("WORK-1.1.2")));
    assert.ok(issue !== undefined);
    assert.ok(issue.body.includes("Blocked by: WORK-1.1.3"), "issue reflects the replacement");
    assert.ok(!issue.body.includes("Blocked by: WORK-1.1.1"));
  } finally {
    repo.cleanup();
  }
});

test("reblock refuses cycles, self-blocks, unknown blockers, terminal and active works atomically", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    const { runId } = await app.specStart("INIT-1");
    await app.specComplete("INIT-1", runId, "apply", documentOf({ works: THREE }));

    await assert.rejects(app.works.reblock("WORK-1.1.1", ["WORK-1.1.2"], { summary: "s", authority: "a" }), /cycle/);
    await assert.rejects(
      app.works.reblock("WORK-1.1.2", ["WORK-1.1.2"], { summary: "s", authority: "a" }),
      /cannot block itself/,
    );
    await assert.rejects(
      app.works.reblock("WORK-1.1.2", ["WORK-9.1.9"], { summary: "s", authority: "a" }),
      /does not exist/,
    );
    await assert.rejects(
      app.works.reblock("WORK-1.1.2", [], { summary: "", authority: "a" }),
      /summary must be non-empty/,
    );
    await assert.rejects(
      app.works.reblock("WORK-1.1.2", [], { summary: "s", authority: "" }),
      /authority must be non-empty/,
    );

    await app.start("WORK-1.1.2", "plan");
    await assert.rejects(app.works.reblock("WORK-1.1.2", [], { summary: "s", authority: "a" }), /active attempt/);
    await app.complete("WORK-1.1.2", "plan", "continue");

    const snapshot = await app.store.read();
    assert.deepEqual(snapshot.works.get("WORK-1.1.2")?.blockedBy, ["WORK-1.1.1"], "no partial reblock");
    assert.equal(snapshot.works.get("WORK-1.1.2")?.dependencyRevisions.length, 0);
  } finally {
    repo.cleanup();
  }
});

test("reblock is allowed after completed attempts while not active", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    const { runId } = await app.specStart("INIT-1");
    await app.specComplete("INIT-1", runId, "apply", documentOf({ works: THREE }));
    await app.runStage("WORK-1.1.2", "plan", "continue");
    const reblocked = await app.works.reblock("WORK-1.1.2", [], { summary: "drop the blocker", authority: "tester" });
    assert.deepEqual(reblocked.blockedBy, []);
    assert.equal(reblocked.dependencyRevisions.length, 1);
  } finally {
    repo.cleanup();
  }
});
