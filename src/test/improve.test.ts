import assert from "node:assert/strict";
import test from "node:test";
import { deriveReport } from "../core/improvement.js";
import { createWork } from "../core/work.js";

const NOW = "2026-01-01T00:00:00.000Z";
const LATER = "2026-01-01T00:01:00.000Z";
const EARLIER = "2025-12-31T00:00:00.000Z";

function w(id: string, opts: Record<string, unknown> = {}): ReturnType<typeof createWork> {
  return createWork({
    id,
    title: id,
    description: "desc",
    workType: "task",
    priority: "p2",
    delivery: "no-code",
    acceptance: [],
    blockedBy: [],
    specRevision: 1,
    now: NOW,
    ...opts,
  });
}

test("empty history produces zero counts and no durations", () => {
  const report = deriveReport([], { now: NOW });
  assert.equal(report.works.scoped, 0);
  assert.equal(report.works.withActivity, 0);
  assert.equal(report.works.acceptedInWindow, 0);
  assert.equal(report.works.rolledBackInWindow, 0);
  assert.equal(report.works.currentlyActive, 0);
  assert.equal(report.attemptsByStage.plan, 0);
  assert.equal(report.returns.reviewToPlan, 0);
  assert.equal(report.repeatedAttempts.length, 0);
  assert.equal(Object.keys(report.durations).length, 0);
  assert.deepEqual(report.scope, {});
});

test("golden fixture produces stable report", () => {
  const a = deriveReport([], { now: NOW });
  const b = deriveReport([], { now: NOW });
  assert.deepEqual(a, b);
});

test("report distinguishes absence from zero", () => {
  const report = deriveReport([], { now: NOW });
  assert.equal(report.works.scoped, 0, "scoped is zero, not absent");
  assert.equal(report.attemptsByStage.plan, 0, "plan attempts is zero, not absent");
  assert.equal(report.returns.reviewToPlan, 0, "returns is zero, not absent");
  assert.ok(!("plan" in report.durations), "durations key absent when no samples");
});

test("report counts scoped, withActivity, acceptedInWindow, rolledBackInWindow, currentlyActive", () => {
  const accepted = {
    ...w("WORK-1.1.1"),
    completion: { outcome: "accepted" as const, authority: "x", summary: "s", finalizedAt: NOW },
    workflow: { state: "terminal" as const, stage: "ship" as const, updatedAt: NOW },
    attempts: [
      {
        stage: "plan" as const,
        attempt: 1,
        runId: "r1",
        status: "completed" as const,
        execution: { role: "plan" as const, harness: "t" },
        todo: [],
        startedAt: NOW,
        finishedAt: LATER,
        result: { decision: "continue" as const, summary: "s", todo: [] },
      },
    ],
  };
  const rolledBack = {
    ...w("WORK-1.1.2"),
    completion: { outcome: "rolled-back" as const, authority: "x", summary: "s", finalizedAt: NOW },
    workflow: { state: "terminal" as const, stage: "ship" as const, updatedAt: NOW },
    attempts: [
      {
        stage: "plan" as const,
        attempt: 1,
        runId: "r2",
        status: "completed" as const,
        execution: { role: "plan" as const, harness: "t" },
        todo: [],
        startedAt: NOW,
        finishedAt: LATER,
        result: { decision: "continue" as const, summary: "s", todo: [] },
      },
    ],
  };
  const active = {
    ...w("WORK-1.1.3"),
    workflow: { state: "active" as const, stage: "plan" as const, updatedAt: NOW },
    attempts: [
      {
        stage: "plan" as const,
        attempt: 1,
        runId: "r3",
        status: "active" as const,
        execution: { role: "plan" as const, harness: "t" },
        todo: [],
        startedAt: NOW,
      },
    ],
  };
  const noActivity = {
    ...w("WORK-1.1.4"),
    workflow: { state: "ready" as const, stage: "plan" as const, updatedAt: NOW },
    attempts: [],
  };

  const report = deriveReport([accepted, rolledBack, active, noActivity], { now: NOW });
  assert.equal(report.works.scoped, 4);
  assert.equal(report.works.withActivity, 3);
  assert.equal(report.works.acceptedInWindow, 1);
  assert.equal(report.works.rolledBackInWindow, 1);
  assert.equal(report.works.currentlyActive, 1);
});

test("scope is built by derivation, contains initiative and since", () => {
  const report = deriveReport([], { initiative: "INIT-1", since: EARLIER, now: NOW });
  assert.equal(report.scope.initiative, "INIT-1");
  assert.equal(report.scope.since, EARLIER);
});

test("old work with recent attempt appears in withActivity", () => {
  const oldWork = {
    ...w("WORK-1.1.1"),
    createdAt: EARLIER,
    workflow: { state: "ready" as const, stage: "plan" as const, updatedAt: EARLIER },
    attempts: [
      {
        stage: "plan" as const,
        attempt: 1,
        runId: "r1",
        status: "completed" as const,
        execution: { role: "plan" as const, harness: "t" },
        todo: [],
        startedAt: NOW,
        finishedAt: LATER,
        result: { decision: "continue" as const, summary: "s", todo: [] },
      },
    ],
    completion: null,
  };

  const report = deriveReport([oldWork], { since: NOW, now: LATER });
  assert.equal(report.works.scoped, 1);
  assert.equal(report.works.withActivity, 1);
  assert.equal(report.attemptsByStage.plan, 1);
});

test("attempts before window are excluded", () => {
  const work = {
    ...w("WORK-1.1.1"),
    attempts: [
      {
        stage: "plan" as const,
        attempt: 1,
        runId: "r1",
        status: "completed" as const,
        execution: { role: "plan" as const, harness: "t" },
        todo: [],
        startedAt: EARLIER,
        finishedAt: NOW,
        result: { decision: "continue" as const, summary: "s", todo: [] },
      },
    ],
  };

  const report = deriveReport([work], { since: NOW, now: LATER });
  assert.equal(report.attemptsByStage.plan, 0);
  assert.equal(report.works.withActivity, 0);
});

test("completion before window not counted in acceptedInWindow", () => {
  const earlyDone = {
    ...w("WORK-1.1.1"),
    completion: { outcome: "accepted" as const, authority: "x", summary: "s", finalizedAt: EARLIER },
    workflow: { state: "terminal" as const, stage: "ship" as const, updatedAt: EARLIER },
    attempts: [
      {
        stage: "plan" as const,
        attempt: 1,
        runId: "r1",
        status: "completed" as const,
        execution: { role: "plan" as const, harness: "t" },
        todo: [],
        startedAt: EARLIER,
        finishedAt: EARLIER,
        result: { decision: "continue" as const, summary: "s", todo: [] },
      },
    ],
  };

  const report = deriveReport([earlyDone], { since: NOW, now: LATER });
  assert.equal(report.works.scoped, 1);
  assert.equal(report.works.acceptedInWindow, 0);
  assert.equal(report.works.withActivity, 0);
});

test("initiative filter restricts report", () => {
  const works = [
    { ...w("WORK-1.1.1"), attempts: [] },
    { ...w("WORK-2.1.1"), attempts: [] },
  ];

  const report = deriveReport(works, { initiative: "INIT-1", now: NOW });
  assert.equal(report.works.scoped, 1);
  assert.equal(report.scope.initiative, "INIT-1");
});

test("attemptsByStage accumulates across works", () => {
  const work = {
    ...w("WORK-1.1.1"),
    attempts: [
      {
        stage: "plan" as const,
        attempt: 1,
        runId: "r1",
        status: "completed" as const,
        execution: { role: "plan" as const, harness: "t" },
        todo: [],
        startedAt: NOW,
        finishedAt: LATER,
        result: { decision: "continue" as const, summary: "s", todo: [] },
      },
      {
        stage: "review" as const,
        attempt: 1,
        runId: "r2",
        status: "completed" as const,
        execution: { role: "review" as const, harness: "t" },
        todo: [],
        startedAt: NOW,
        finishedAt: LATER,
        result: { decision: "continue" as const, summary: "s", todo: [] },
      },
    ],
  };

  const report = deriveReport([work], { now: NOW });
  assert.equal(report.attemptsByStage.plan, 1);
  assert.equal(report.attemptsByStage.review, 1);
  assert.equal(report.attemptsByStage.build, 0);
});

test("returns are counted per stage and returnTo", () => {
  const work = {
    ...w("WORK-1.1.1"),
    attempts: [
      {
        stage: "review" as const,
        attempt: 1,
        runId: "r1",
        status: "completed" as const,
        execution: { role: "review" as const, harness: "t" },
        todo: [],
        startedAt: NOW,
        finishedAt: LATER,
        result: { decision: "return" as const, summary: "s", todo: [], returnTo: "plan" as const },
      },
      {
        stage: "verify" as const,
        attempt: 1,
        runId: "r2",
        status: "completed" as const,
        execution: { role: "verify" as const, harness: "t" },
        todo: [],
        startedAt: NOW,
        finishedAt: LATER,
        result: { decision: "return" as const, summary: "s", todo: [], returnTo: "build" as const },
      },
    ],
  };

  const report = deriveReport([work], { now: NOW });
  assert.equal(report.returns.reviewToPlan, 1);
  assert.equal(report.returns.verifyToBuild, 1);
  assert.equal(report.returns.buildToPlan, 0);
  assert.equal(report.returns.verifyToPlan, 0);
});

test("repeatedAttempts lists works with more than one attempt per stage", () => {
  const work = {
    ...w("WORK-1.1.1"),
    attempts: [
      {
        stage: "plan" as const,
        attempt: 1,
        runId: "r1",
        status: "completed" as const,
        execution: { role: "plan" as const, harness: "t" },
        todo: [],
        startedAt: NOW,
      },
      {
        stage: "plan" as const,
        attempt: 2,
        runId: "r2",
        status: "completed" as const,
        execution: { role: "plan" as const, harness: "t" },
        todo: [],
        startedAt: NOW,
      },
    ],
  };

  const report = deriveReport([work], { now: NOW });
  assert.equal(report.repeatedAttempts.length, 1);
  assert.equal(report.repeatedAttempts[0]?.work, "WORK-1.1.1");
  assert.equal(report.repeatedAttempts[0]?.stage, "plan");
  assert.equal(report.repeatedAttempts[0]?.attempts, 2);
});

test("durations are computed only when both timestamps present", () => {
  const work = {
    ...w("WORK-1.1.1"),
    attempts: [
      {
        stage: "plan" as const,
        attempt: 1,
        runId: "r1",
        status: "completed" as const,
        execution: { role: "plan" as const, harness: "t" },
        todo: [],
        startedAt: "2026-01-01T00:00:00.000Z",
        finishedAt: "2026-01-01T00:00:10.000Z",
        result: { decision: "continue" as const, summary: "s", todo: [] },
      },
      {
        stage: "plan" as const,
        attempt: 2,
        runId: "r2",
        status: "active" as const,
        execution: { role: "plan" as const, harness: "t" },
        todo: [],
        startedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  };

  const report = deriveReport([work], { now: NOW });
  const durations = report.durations as Record<string, Record<string, number>>;
  assert.ok(durations.plan !== undefined, "plan has a completed attempt");
  assert.equal(durations.plan?.samples, 1);
  assert.ok(durations.review === undefined, "review has no samples");
});

test("partial history: work with no attempts is handled", () => {
  const work = { ...w("WORK-1.1.1"), attempts: [] };
  const report = deriveReport([work], { now: NOW });
  assert.equal(report.works.scoped, 1);
  assert.equal(report.works.withActivity, 0);
  assert.equal(report.attemptsByStage.plan, 0);
});

test("since filter excludes older works from withActivity but not scoped", () => {
  const works = [{ ...w("WORK-1.1.1"), attempts: [] }];

  const report = deriveReport(works, { since: LATER, now: LATER });
  assert.equal(report.works.scoped, 1, "scoped includes the work");
  assert.equal(report.works.withActivity, 0, "no activity in window");
});

test("offset-equivalent timestamps are compared as instants", () => {
  const work = {
    ...w("WORK-1.1.1"),
    attempts: [
      {
        stage: "plan" as const,
        attempt: 1,
        runId: "r1",
        status: "completed" as const,
        execution: { role: "plan" as const, harness: "t" },
        todo: [],
        startedAt: "2026-08-05T00:00:00-03:00",
        finishedAt: "2026-08-05T00:01:00-03:00",
        result: { decision: "continue" as const, summary: "s", todo: [] },
      },
    ],
  };

  const report = deriveReport([work], { since: "2026-08-05T03:00:00Z", now: "2026-08-05T04:00:00Z" });
  assert.equal(report.attemptsByStage.plan, 1, "offset startedAt equals UTC since → inside window");
  assert.equal(report.works.withActivity, 1);
});

test("attempt exactly at since boundary is inside window", () => {
  const work = {
    ...w("WORK-1.1.1"),
    attempts: [
      {
        stage: "plan" as const,
        attempt: 1,
        runId: "r1",
        status: "completed" as const,
        execution: { role: "plan" as const, harness: "t" },
        todo: [],
        startedAt: "2026-08-05T03:00:00Z",
        finishedAt: "2026-08-05T03:01:00Z",
        result: { decision: "continue" as const, summary: "s", todo: [] },
      },
    ],
  };

  const report = deriveReport([work], { since: "2026-08-05T03:00:00Z", now: "2026-08-05T04:00:00Z" });
  assert.equal(report.attemptsByStage.plan, 1, "exact boundary is inclusive");
});

test("attempt one second before since is excluded", () => {
  const work = {
    ...w("WORK-1.1.1"),
    attempts: [
      {
        stage: "plan" as const,
        attempt: 1,
        runId: "r1",
        status: "completed" as const,
        execution: { role: "plan" as const, harness: "t" },
        todo: [],
        startedAt: "2026-08-05T02:59:59Z",
        finishedAt: "2026-08-05T03:01:00Z",
        result: { decision: "continue" as const, summary: "s", todo: [] },
      },
    ],
  };

  const report = deriveReport([work], { since: "2026-08-05T03:00:00Z", now: "2026-08-05T04:00:00Z" });
  assert.equal(report.attemptsByStage.plan, 0, "one second before since is excluded");
});

test("completion in offset zone is filtered by instant", () => {
  const work = {
    ...w("WORK-1.1.1"),
    completion: {
      outcome: "accepted" as const,
      authority: "x",
      summary: "s",
      finalizedAt: "2026-08-05T00:00:00-03:00",
    },
    workflow: { state: "terminal" as const, stage: "ship" as const, updatedAt: "2026-08-05T00:00:00-03:00" },
    attempts: [
      {
        stage: "plan" as const,
        attempt: 1,
        runId: "r1",
        status: "completed" as const,
        execution: { role: "plan" as const, harness: "t" },
        todo: [],
        startedAt: "2026-08-05T00:00:00-03:00",
        finishedAt: "2026-08-05T00:01:00-03:00",
        result: { decision: "continue" as const, summary: "s", todo: [] },
      },
    ],
  };

  const report = deriveReport([work], { since: "2026-08-05T03:00:00Z", now: "2026-08-05T04:00:00Z" });
  assert.equal(report.works.acceptedInWindow, 1, "offset completion equals UTC since → inside window");
});
