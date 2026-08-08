import assert from "node:assert/strict";
import test from "node:test";
import { completeStage, executionContractMatches, startStage } from "../core/lifecycle.js";
import { type AttemptResult, activeAttempt, createWork, type Stage, type Work } from "../core/work.js";

const NOW = "2026-01-01T00:00:00.000Z";
const RUN = "run-1";

function work(acceptance: string[] = []): Work {
  return createWork({
    id: "WORK-1.1.1",
    title: "w",
    description: "d",
    workType: "task",
    priority: "p2",
    delivery: "no-code",
    acceptance,
    blockedBy: [],
    specRevision: 1,
    now: NOW,
  });
}

function start(w: Work, stage: Stage): Work {
  return startStage(w, stage, {
    runId: RUN,
    execution: { role: stage, harness: "test" },
    todo: [{ id: "t1", title: "task" }],
    now: NOW,
  });
}

function complete(
  w: Work,
  stage: Stage,
  decision: AttemptResult["decision"],
  extra: Partial<AttemptResult> = {},
): Work {
  const result: AttemptResult = {
    decision,
    summary: "done",
    todo: [{ id: "t1", status: "done" }],
    ...extra,
  };
  if (stage === "verify" && result.acceptance === undefined) {
    result.acceptance = w.acceptance.map((_, index) => ({ index, status: "passed", summary: "ok" }));
  }
  return completeStage(w, stage, RUN, result, NOW);
}

function runThrough(
  w: Work,
  stage: Stage,
  decision: AttemptResult["decision"],
  extra: Partial<AttemptResult> = {},
): Work {
  return complete(start(w, stage), stage, decision, extra);
}

test("plan -> review -> build -> verify -> ship -> accept", () => {
  let w = runThrough(work(["c1"]), "plan", "continue");
  assert.equal(w.workflow.state, "ready");
  assert.equal(w.workflow.stage, "review");
  w = runThrough(w, "review", "continue");
  assert.equal(w.workflow.stage, "build");
  w = runThrough(w, "build", "continue");
  assert.equal(w.workflow.stage, "verify");
  w = runThrough(w, "verify", "continue");
  assert.equal(w.workflow.stage, "ship");
  w = runThrough(w, "ship", "accept", { authority: "user" });
  assert.equal(w.workflow.state, "terminal");
  assert.equal(w.completion?.outcome, "accepted");
  assert.equal(w.completion?.authority, "user");
});

test("continue and return release the work to ready", () => {
  let w = runThrough(work(), "plan", "continue");
  assert.equal(w.workflow.state, "ready");
  assert.equal(activeAttempt(w), undefined);
  w = start(w, "review");
  assert.equal(w.workflow.state, "active");
  w = complete(w, "review", "return", { returnTo: "plan" });
  assert.equal(w.workflow.state, "ready");
  assert.equal(w.workflow.stage, "plan");
  assert.equal(activeAttempt(w), undefined);
});

test("attempt numbers are per stage", () => {
  let w = runThrough(work(), "plan", "continue");
  w = runThrough(w, "review", "return", { returnTo: "plan" });
  w = start(w, "plan");
  assert.equal(activeAttempt(w)?.attempt, 2, "second plan attempt");
  w = complete(w, "plan", "continue");
  w = start(w, "review");
  assert.equal(activeAttempt(w)?.attempt, 2, "second review attempt");
});

test("review returns to plan; verify returns to build or plan", () => {
  let w = runThrough(work(["c1"]), "plan", "continue");
  w = runThrough(w, "review", "continue");
  w = runThrough(w, "build", "continue");
  w = runThrough(w, "verify", "return", { returnTo: "build" });
  assert.equal(w.workflow.stage, "build");
  w = runThrough(w, "build", "continue");
  w = start(w, "verify");
  assert.throws(() => complete(w, "verify", "return", { returnTo: "review" }), /may only return/);
});

test("ship rollback terminates with rolled-back", () => {
  let w = runThrough(work(["c1"]), "plan", "continue");
  w = runThrough(w, "review", "continue");
  w = runThrough(w, "build", "continue");
  w = runThrough(w, "verify", "continue");
  w = runThrough(w, "ship", "rollback", { authority: "user" });
  assert.equal(w.completion?.outcome, "rolled-back");
});

test("accept/rollback require ship and authority", () => {
  const w = start(work(), "plan");
  assert.throws(() => complete(w, "plan", "accept", { authority: "user" }), /only valid/);
});

test("cannot continue from ship", () => {
  let w = runThrough(work(["c1"]), "plan", "continue");
  w = runThrough(w, "review", "continue");
  w = runThrough(w, "build", "continue");
  w = runThrough(w, "verify", "continue");
  w = start(w, "ship");
  assert.throws(() => complete(w, "ship", "continue"), /cannot continue|must accept or rollback/);
});

test("start requires expected stage and no active attempt", () => {
  const w = start(work(), "plan");
  assert.throws(() => start(w, "review"), /active attempt/);
  assert.throws(() => start(work(), "build"), /cannot start build/);
});

test("terminal work refuses start and complete", () => {
  let w = runThrough(work(["c1"]), "plan", "continue");
  w = runThrough(w, "review", "continue");
  w = runThrough(w, "build", "continue");
  w = runThrough(w, "verify", "continue");
  w = runThrough(w, "ship", "accept", { authority: "user" });
  assert.throws(() => start(w, "plan"), /terminal/);
  assert.throws(() => complete(w, "ship", "accept", { authority: "user" }), /terminal/);
});

test("completion is bound to the run id", () => {
  const w = start(work(), "plan");
  assert.throws(
    () =>
      completeStage(
        w,
        "plan",
        "other-run",
        { decision: "continue", summary: "s", todo: [{ id: "t1", status: "done" }] },
        NOW,
      ),
    /active run is run-1/,
  );
});

test("result must account for every todo exactly once", () => {
  const w = start(work(), "plan");
  assert.throws(
    () => completeStage(w, "plan", RUN, { decision: "continue", summary: "s", todo: [] }, NOW),
    /does not account/,
  );
  assert.throws(
    () =>
      completeStage(
        w,
        "plan",
        RUN,
        {
          decision: "continue",
          summary: "s",
          todo: [
            { id: "t1", status: "done" },
            { id: "t1", status: "done" },
          ],
        },
        NOW,
      ),
    /repeats todo id/,
  );
  assert.throws(
    () =>
      completeStage(
        w,
        "plan",
        RUN,
        {
          decision: "continue",
          summary: "s",
          todo: [
            { id: "t1", status: "done" },
            { id: "nope", status: "done" },
          ],
        },
        NOW,
      ),
    /unknown todo id/,
  );
});

test("duplicate todo ids are refused at start", () => {
  assert.throws(
    () =>
      startStage(work(), "plan", {
        runId: RUN,
        execution: { role: "plan", harness: "test" },
        todo: [
          { id: "t1", title: "a" },
          { id: "t1", title: "b" },
        ],
        now: NOW,
      }),
    /duplicate todo id/,
  );
});

test("verify requires acceptance coverage and refuses failed criteria on continue", () => {
  let w = runThrough(work(["c1", "c2"]), "plan", "continue");
  w = runThrough(w, "review", "continue");
  w = runThrough(w, "build", "continue");
  w = start(w, "verify");
  assert.throws(
    () =>
      completeStage(
        w,
        "verify",
        RUN,
        { decision: "continue", summary: "s", todo: [{ id: "t1", status: "done" }] },
        NOW,
      ),
    /must address every acceptance criterion/,
  );
  assert.throws(
    () =>
      completeStage(
        w,
        "verify",
        RUN,
        {
          decision: "continue",
          summary: "s",
          todo: [{ id: "t1", status: "done" }],
          acceptance: [
            { index: 0, status: "passed", summary: "ok" },
            { index: 1, status: "failed", summary: "broken" },
          ],
        },
        NOW,
      ),
    /acceptance criterion 1 failed/,
  );
  const done = complete(w, "verify", "continue", {
    acceptance: [
      { index: 0, status: "passed", summary: "ok" },
      { index: 1, status: "not-applicable", summary: "not relevant here" },
    ],
  });
  assert.equal(done.workflow.stage, "ship");
});

test("resume contract compares stage, harness, model, profile, compositionDigest, capabilities and todo", () => {
  const w = start(work(), "plan");
  const attempt = activeAttempt(w);
  assert.ok(attempt !== undefined);
  assert.ok(executionContractMatches(attempt, { role: "plan", harness: "test" }, [{ id: "t1", title: "task" }]));
  assert.ok(!executionContractMatches(attempt, { role: "plan", harness: "other" }, [{ id: "t1", title: "task" }]));
  assert.ok(
    !executionContractMatches(attempt, { role: "plan", harness: "test", model: "m" }, [{ id: "t1", title: "task" }]),
  );
  assert.ok(
    !executionContractMatches(attempt, { role: "plan", harness: "test", profile: "p" }, [{ id: "t1", title: "task" }]),
  );
  assert.ok(
    !executionContractMatches(attempt, { role: "plan", harness: "test", compositionDigest: "abc" }, [
      { id: "t1", title: "task" },
    ]),
  );
  assert.ok(
    !executionContractMatches(
      attempt,
      { role: "plan", harness: "test", capabilities: [{ id: "c1", version: 1, digest: "d".repeat(64) }] },
      [{ id: "t1", title: "task" }],
    ),
  );
  assert.ok(!executionContractMatches(attempt, { role: "plan", harness: "test" }, [{ id: "t1", title: "changed" }]));
  assert.ok(
    !executionContractMatches(attempt, { role: "plan", harness: "test" }, [
      { id: "t1", title: "task" },
      { id: "t2", title: "more" },
    ]),
  );
});
