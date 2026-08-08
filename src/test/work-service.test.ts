import assert from "node:assert/strict";
import test from "node:test";
import { parseAttemptResult } from "../core/work.js";
import type { TestApp } from "./support/app.js";
import { acceptanceOf, createApp, documentOf, result, TODO } from "./support/app.js";
import { createRepo } from "./support/repo.js";

const TWO_WORKS = [
  {
    id: "WORK-1.1.1",
    wave: "WAVE-1.1",
    title: "Blocker",
    description: "first",
    workType: "task" as const,
    priority: "p1" as const,
    delivery: "no-code" as const,
    acceptance: ["b done"],
    blockedBy: [],
  },
  {
    id: "WORK-1.1.2",
    wave: "WAVE-1.1",
    title: "Dependent",
    description: "second",
    workType: "feature" as const,
    priority: "p2" as const,
    delivery: "no-code" as const,
    acceptance: ["d done"],
    blockedBy: ["WORK-1.1.1"],
  },
];

async function applySpec(app: TestApp, doc = documentOf()) {
  const { runId } = await app.specStart(doc.initiative.id);
  await app.specComplete(doc.initiative.id, runId, "apply", doc);
}

test("deadlock regression: blocked dependent stays ready and the blocker can progress", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    await applySpec(app, documentOf({ works: TWO_WORKS }));

    await app.runStage("WORK-1.1.2", "plan", "continue");
    await app.runStage("WORK-1.1.2", "review", "continue");

    const stateCommit = repo.headCommit("refs/codepatrol/state");
    await assert.rejects(app.start("WORK-1.1.2", "build"), /cannot build until blockers are accepted/);

    let snapshot = await app.store.read();
    const dependent = snapshot.works.get("WORK-1.1.2");
    assert.equal(dependent?.workflow.state, "ready", "refused build leaves the dependent ready");
    assert.equal(dependent?.workflow.stage, "build");
    assert.equal(
      dependent?.attempts.some((a) => a.status === "active"),
      false,
    );
    assert.equal(repo.headCommit("refs/codepatrol/state"), stateCommit, "rejected start performs no state write");

    await app.runStage("WORK-1.1.1", "plan", "continue");
    await app.runStage("WORK-1.1.1", "review", "continue");
    await app.runStage("WORK-1.1.1", "build", "continue");
    await app.runStage("WORK-1.1.1", "verify", "continue");
    await app.runStage("WORK-1.1.1", "ship", "accept", { authority: "tester" });

    const started = await app.start("WORK-1.1.2", "build");
    assert.equal(started.attempt.stage, "build");

    snapshot = await app.store.read();
    assert.equal(snapshot.works.get("WORK-1.1.1")?.completion?.outcome, "accepted");
  } finally {
    repo.cleanup();
  }
});

test("execution is exclusive to one wave; siblings run together and other waves wait", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    await applySpec(
      app,
      documentOf({
        works: [
          {
            id: "WORK-1.1.1",
            wave: "WAVE-1.1",
            title: "A",
            description: "a",
            workType: "task",
            priority: "p2",
            delivery: "no-code",
            acceptance: [],
            blockedBy: [],
          },
          {
            id: "WORK-1.1.2",
            wave: "WAVE-1.1",
            title: "B",
            description: "b",
            workType: "task",
            priority: "p2",
            delivery: "no-code",
            acceptance: [],
            blockedBy: [],
          },
          {
            id: "WORK-1.2.1",
            wave: "WAVE-1.2",
            title: "C",
            description: "c",
            workType: "task",
            priority: "p2",
            delivery: "no-code",
            acceptance: [],
            blockedBy: [],
          },
        ],
      }),
    );
    await app.start("WORK-1.1.1", "plan");
    const sibling = await app.start("WORK-1.1.2", "plan");
    assert.equal(sibling.resumed, false, "a sibling of the same wave starts alongside");

    const stateCommit = repo.headCommit("refs/codepatrol/state");
    await assert.rejects(app.start("WORK-1.2.1", "plan"), /wave WAVE-1\.1 holds the active execution/);
    assert.equal(repo.headCommit("refs/codepatrol/state"), stateCommit, "rejected start writes nothing");

    await app.complete("WORK-1.1.1", "plan", "continue");
    await assert.rejects(app.start("WORK-1.2.1", "plan"), /wave WAVE-1\.1 holds the active execution/);
    await app.complete("WORK-1.1.2", "plan", "continue");
    const other = await app.start("WORK-1.2.1", "plan");
    assert.equal(other.resumed, false, "another wave starts once the first one is idle");

    const snapshot = await app.store.read();
    assert.equal(snapshot.works.get("WORK-1.1.1")?.workflow.state, "ready", "multiple works may remain ready");
    assert.equal(snapshot.works.get("WORK-1.2.1")?.workflow.state, "active");
  } finally {
    repo.cleanup();
  }
});

test("completion requires the active run id; old and unknown runs are refused", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    await applySpec(app);
    const first = await app.start("WORK-1.1.1", "plan");
    await app.works.complete("WORK-1.1.1", "plan", first.attempt.runId, result("continue"));

    await assert.rejects(
      app.works.complete("WORK-1.1.1", "review", first.attempt.runId, result("continue")),
      /cannot complete review/,
    );
    await assert.rejects(
      app.works.complete("WORK-1.1.1", "review", "00000000-0000-4000-8000-999999999999", result("continue")),
      /no attempt with run/,
    );

    const second = await app.start("WORK-1.1.1", "review");
    await assert.rejects(
      app.works.complete("WORK-1.1.1", "review", first.attempt.runId, result("continue")),
      /active run is/,
    );
    await app.works.complete("WORK-1.1.1", "review", second.attempt.runId, result("continue"));
  } finally {
    repo.cleanup();
  }
});

test("same run plus same result is idempotent; different result is RESULT_CONFLICT", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    await applySpec(app);
    const started = await app.start("WORK-1.1.1", "plan");
    const res = result("continue");
    await app.works.complete("WORK-1.1.1", "plan", started.attempt.runId, res);
    const stateCommit = repo.headCommit("refs/codepatrol/state");

    const replayed = await app.works.complete("WORK-1.1.1", "plan", started.attempt.runId, res);
    assert.equal(replayed.workflow.stage, "review");
    assert.equal(repo.headCommit("refs/codepatrol/state"), stateCommit, "idempotent replay writes nothing");

    await assert.rejects(
      app.works.complete(
        "WORK-1.1.1",
        "plan",
        started.attempt.runId,
        result("continue", undefined, { summary: "different" }),
      ),
      /RESULT_CONFLICT|different result/,
    );
  } finally {
    repo.cleanup();
  }
});

test("resume with identical inputs writes nothing; changed contract fails", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    await applySpec(app);
    const first = await app.start("WORK-1.1.1", "plan");
    const stateCommit = repo.headCommit("refs/codepatrol/state");

    const second = await app.works.start("WORK-1.1.1", "plan", { harness: "test", todo: TODO });
    assert.equal(second.resumed, true);
    assert.equal(second.attempt.runId, first.attempt.runId);
    assert.equal(repo.headCommit("refs/codepatrol/state"), stateCommit);

    await assert.rejects(
      app.works.start("WORK-1.1.1", "plan", { harness: "other", todo: TODO }),
      /different execution contract/,
    );
    await assert.rejects(
      app.works.start("WORK-1.1.1", "plan", { harness: "test", model: "m", todo: TODO }),
      /different execution contract/,
    );
    await assert.rejects(
      app.works.start("WORK-1.1.1", "plan", { harness: "test", todo: [{ id: "t1", title: "changed" }] }),
      /different execution contract/,
    );
  } finally {
    repo.cleanup();
  }
});

test("build records observed base and candidate commits; evidence input is rejected", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    await applySpec(app);
    await app.runStage("WORK-1.1.1", "plan", "continue");
    await app.runStage("WORK-1.1.1", "review", "continue");

    const baseCommit = repo.headCommit("HEAD");
    await app.start("WORK-1.1.1", "build");
    repo.git(["commit", "--allow-empty", "-m", "candidate work"]);
    const candidateCommit = repo.headCommit("HEAD");
    await app.complete("WORK-1.1.1", "build", "continue");

    const snapshot = await app.store.read();
    const build = snapshot.works.get("WORK-1.1.1")?.attempts.find((a) => a.stage === "build");
    assert.equal(build?.evidence?.baseCommit, baseCommit);
    assert.equal(build?.evidence?.candidateCommit, candidateCommit);

    assert.throws(
      () => parseAttemptResult({ decision: "continue", summary: "s", todo: [], evidence: { commit: "f".repeat(40) } }),
      /unknown field "evidence"/,
    );
  } finally {
    repo.cleanup();
  }
});

test("verify pins the build candidate and refuses drift; ship requires the verified candidate", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    await applySpec(app);
    await app.runStage("WORK-1.1.1", "plan", "continue");
    await app.runStage("WORK-1.1.1", "review", "continue");
    await app.runStage("WORK-1.1.1", "build", "continue");

    repo.git(["commit", "--allow-empty", "-m", "drift"]);
    await assert.rejects(app.start("WORK-1.1.1", "verify"), /differs from build candidate/);
    repo.git(["reset", "--hard", "HEAD~1"]);

    const verify = await app.start("WORK-1.1.1", "verify");
    repo.git(["commit", "--allow-empty", "-m", "drift during verify"]);
    await assert.rejects(
      app.works.complete("WORK-1.1.1", "verify", verify.attempt.runId, result("continue", "verify")),
      /differs from pinned candidate/,
    );
    repo.git(["reset", "--hard", "HEAD~1"]);
    await app.works.complete("WORK-1.1.1", "verify", verify.attempt.runId, result("continue", "verify"));

    repo.git(["commit", "--allow-empty", "-m", "drift before ship"]);
    await assert.rejects(app.start("WORK-1.1.1", "ship"), /differs from verified candidate/);
    repo.git(["reset", "--hard", "HEAD~1"]);

    const ship = await app.start("WORK-1.1.1", "ship");
    repo.git(["commit", "--allow-empty", "-m", "drift during ship"]);
    await assert.rejects(
      app.works.complete("WORK-1.1.1", "ship", ship.attempt.runId, result("accept", "ship", { authority: "tester" })),
      /differs from verified candidate/,
    );
    repo.git(["reset", "--hard", "HEAD~1"]);
    await app.works.complete(
      "WORK-1.1.1",
      "ship",
      ship.attempt.runId,
      result("accept", "ship", { authority: "tester" }),
    );

    const snapshot = await app.store.read();
    assert.equal(snapshot.works.get("WORK-1.1.1")?.completion?.outcome, "accepted");
  } finally {
    repo.cleanup();
  }
});

test("verify cannot continue with an unaddressed failed acceptance criterion", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    await applySpec(app);
    await app.runStage("WORK-1.1.1", "plan", "continue");
    await app.runStage("WORK-1.1.1", "review", "continue");
    await app.runStage("WORK-1.1.1", "build", "continue");
    const verify = await app.start("WORK-1.1.1", "verify");
    await assert.rejects(
      app.works.complete(
        "WORK-1.1.1",
        "verify",
        verify.attempt.runId,
        result("continue", "verify", {
          acceptance: [{ index: 0, status: "failed", summary: "broken" }],
        }),
      ),
      /criterion 0 failed/,
    );
    const snapshot = await app.store.read();
    const work = snapshot.works.get("WORK-1.1.1");
    assert.ok(work !== undefined);
    await app.works.complete(
      "WORK-1.1.1",
      "verify",
      verify.attempt.runId,
      result("continue", "verify", {
        acceptance: acceptanceOf(work),
      }),
    );
  } finally {
    repo.cleanup();
  }
});

test("accept and rollback do not modify the base branch", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    const baseCommit = repo.headCommit("refs/heads/main");
    await applySpec(app);
    for (const stage of ["plan", "review", "build", "verify"] as const) {
      await app.runStage("WORK-1.1.1", stage, "continue");
    }
    await app.runStage("WORK-1.1.1", "ship", "accept", { authority: "tester" });
    assert.equal(repo.headCommit("refs/heads/main"), baseCommit);
    assert.deepEqual(repo.headRefs(), ["refs/heads/main"]);
  } finally {
    repo.cleanup();
  }
});
