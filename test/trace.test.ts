import assert from "node:assert/strict";
import test from "node:test";
import { runCli } from "../src/cli.js";
import type { Source } from "../src/core.js";
import { problemsFromHistory, type StateHistoryEntry } from "../src/trace.js";
import { commitCandidate, fixture, scorecardFor } from "./helpers.js";

const producer: Source = { harness: "test-producer", model: "model-a", agent: null };
const reviewer: Source = { harness: "test-reviewer", model: "model-b", agent: null };

function specDoc() {
  return {
    title: "Trace flow",
    intent: "Exercise tracing and review feedback",
    waves: [
      {
        key: "delivery",
        title: "Delivery",
        works: [
          {
            key: "implementation",
            title: "Implementation",
            description: "Build the feature",
            acceptance: ["The selected implementation is shipped"],
            blockedBy: [],
          },
        ],
      },
    ],
  };
}

function driveToBuild(service: ReturnType<typeof fixture>["service"]) {
  const init = service.createInit("Trace flow", "Exercise tracing");
  const specTask = service.openProducer("spec", init.id, producer).task;
  const specProposalId = service.submitTask(specTask.id, specDoc()).task
    .proposalId as string;
  const specReview = service.openReview("spec-review", init.id, reviewer).task;
  service.submitTask(specReview.id, {
    decision: "approve",
    selectedProposalId: specProposalId,
    summary: "Approved",
    candidates: [
      {
        proposalId: specProposalId,
        status: "passed",
        summary: "Valid",
        scorecard: scorecardFor("spec-review", specProposalId),
      },
    ],
  });
  const wave = service.list("wave")[0] as { id: string };
  const work = service.list("work")[0] as {
    id: string;
    acceptance: Array<{ id: string }>;
  };
  const planTask = service.openProducer("plan", wave.id, producer).task;
  const planProposalId = service.submitTask(planTask.id, {
    works: [
      {
        workId: work.id,
        summary: "Plan",
        steps: [{ summary: "Implement", acceptanceIds: [work.acceptance[0]?.id] }],
      },
    ],
    verification: "Run the configured gate",
    openQuestions: [],
  }).task.proposalId as string;
  const planReview = service.openReview("plan-review", wave.id, reviewer).task;
  service.submitTask(planReview.id, {
    decision: "approve",
    selectedProposalId: planProposalId,
    summary: "Approved",
    candidates: [
      {
        proposalId: planProposalId,
        status: "passed",
        summary: "Valid",
        scorecard: scorecardFor("plan-review", planProposalId),
      },
    ],
  });
  const buildTask = service.openProducer("build", wave.id, producer).task;
  return { init, wave, work, buildTask };
}

function approveBuild(
  service: ReturnType<typeof fixture>["service"],
  waveId: string,
  acceptanceId: string,
  proposalId: string,
) {
  const review = service.openReview("build-review", waveId, reviewer).task;
  service.submitTask(review.id, {
    decision: "approve",
    selectedProposalId: proposalId,
    summary: "Approved",
    candidates: [
      {
        proposalId,
        status: "passed",
        summary: "Valid",
        scorecard: scorecardFor("build-review", proposalId),
      },
    ],
    acceptance: [{ id: acceptanceId, status: "passed", summary: "Demonstrated" }],
  });
}

function returnBuild(
  service: ReturnType<typeof fixture>["service"],
  waveId: string,
  acceptanceId: string,
  proposalId: string,
  summary: string,
) {
  const review = service.openReview("build-review", waveId, reviewer).task;
  service.submitTask(review.id, {
    decision: "return",
    summary,
    candidates: [
      {
        proposalId,
        status: "failed",
        summary,
        scorecard: scorecardFor("build-review", proposalId, 0),
      },
    ],
    acceptance: [{ id: acceptanceId, status: "failed", summary }],
  });
}

test("codepatrol trace --init emits an ordered timeline from committed history", async () => {
  const { root, service } = fixture();
  const { init, wave, work, buildTask } = driveToBuild(service);
  commitCandidate(buildTask.workspace as string, "shipped");
  const proposalId = service.submitTask(buildTask.id, {
    summary: "Candidate",
    works: [{ workId: work.id, summary: "Implemented" }],
  }).task.proposalId as string;
  approveBuild(service, wave.id, work.acceptance[0]?.id as string, proposalId);
  service.shipAccept(wave.id);

  const traced = await runCli([
    "node",
    "codepatrol",
    "--workspace",
    root,
    "trace",
    "--init",
    init.id,
  ]);
  assert.equal(traced.exitCode, 0, traced.stderr);
  const timeline = JSON.parse(traced.stdout) as {
    subject: string;
    entries: Array<{
      subject: string;
      operation: string;
      outcome: string;
      timestamp: string;
      kind: string;
    }>;
  };
  assert.equal(timeline.subject, init.id);
  assert.ok(timeline.entries.length > 0);
  const timestamps = timeline.entries.map((entry) => entry.timestamp);
  assert.deepEqual([...timestamps].sort(), timestamps);
  for (const entry of timeline.entries) {
    assert.ok(entry.subject);
    assert.ok(entry.operation);
    assert.ok(entry.outcome);
    assert.ok(entry.timestamp);
  }
  assert.ok(timeline.entries.some((entry) => entry.kind === "opened"));
  assert.ok(timeline.entries.some((entry) => entry.kind === "submitted"));
  assert.ok(timeline.entries.some((entry) => entry.kind === "review-decision"));
  assert.ok(timeline.entries.some((entry) => entry.kind === "verification"));
  assert.ok(
    timeline.entries.some(
      (entry) => entry.kind === "ship-decision" && entry.outcome === "accept",
    ),
  );
});

test("trace works without a remote and unknown subjects fail with typed errors", async () => {
  const { root, service } = fixture();
  const init = service.createInit("No remote", "Trace without GitHub");
  const traced = await runCli([
    "node",
    "codepatrol",
    "--workspace",
    root,
    "trace",
    "--init",
    init.id,
  ]);
  assert.equal(traced.exitCode, 0, traced.stderr);
  JSON.parse(traced.stdout);

  const unknownInit = await runCli([
    "node",
    "codepatrol",
    "--workspace",
    root,
    "trace",
    "--init",
    "INIT-missing",
  ]);
  assert.equal(unknownInit.exitCode, 1);
  assert.equal(JSON.parse(unknownInit.stderr).error, "INIT_NOT_FOUND");

  const unknownWave = await runCli([
    "node",
    "codepatrol",
    "--workspace",
    root,
    "trace",
    "--wave",
    "WAVE-missing",
  ]);
  assert.equal(unknownWave.exitCode, 1);
  assert.equal(JSON.parse(unknownWave.stderr).error, "WAVE_NOT_FOUND");
});

test("a returned build review is visible on the next build producer envelope", () => {
  const { service } = fixture();
  const { wave, work, buildTask } = driveToBuild(service);
  commitCandidate(buildTask.workspace as string, "first");
  const proposalId = service.submitTask(buildTask.id, {
    summary: "Candidate",
    works: [{ workId: work.id, summary: "Implemented" }],
  }).task.proposalId as string;
  const acceptanceId = work.acceptance[0]?.id as string;
  returnBuild(service, wave.id, acceptanceId, proposalId, "Missing tests");

  const next = service.openProducer("build", wave.id, producer);
  const previousReviews = (
    next.input as {
      previousReviews?: Array<{ result?: Record<string, unknown> }>;
    }
  ).previousReviews;
  assert.ok(previousReviews && previousReviews.length > 0);
  const review = previousReviews[0]?.result as {
    summary?: string;
    acceptance?: Array<{ id: string; status: string }>;
  };
  assert.equal(review.summary, "Missing tests");
  assert.deepEqual(
    (review.acceptance ?? [])
      .filter((entry) => entry.status === "failed")
      .map((entry) => entry.id),
    [acceptanceId],
  );
});

test("doctor lists at-risk waves and recurring acceptance failures, and stays empty when healthy", async () => {
  const healthy = fixture();
  healthy.service.createInit("Healthy", "No risk");
  const healthyDoctor = await runCli([
    "node",
    "codepatrol",
    "--workspace",
    healthy.root,
    "doctor",
  ]);
  assert.equal(healthyDoctor.exitCode, 0, healthyDoctor.stderr);
  const healthyPayload = JSON.parse(healthyDoctor.stdout) as {
    atRiskWaves: unknown[];
    recurringAcceptanceFailures: unknown[];
    openTasks: unknown[];
  };
  assert.deepEqual(healthyPayload.atRiskWaves, []);
  assert.deepEqual(healthyPayload.recurringAcceptanceFailures, []);
  assert.deepEqual(healthyPayload.openTasks, []);

  const { root, service } = fixture();
  const { wave, work, buildTask } = driveToBuild(service);
  const acceptanceId = work.acceptance[0]?.id as string;
  commitCandidate(buildTask.workspace as string, "round-1");
  const first = service.submitTask(buildTask.id, {
    summary: "Candidate",
    works: [{ workId: work.id, summary: "Implemented" }],
  }).task.proposalId as string;
  returnBuild(service, wave.id, acceptanceId, first, "Still failing");
  const secondTask = service.openProducer("build", wave.id, producer).task;
  commitCandidate(secondTask.workspace as string, "round-2");
  const second = service.submitTask(secondTask.id, {
    summary: "Candidate",
    works: [{ workId: work.id, summary: "Implemented" }],
  }).task.proposalId as string;
  returnBuild(service, wave.id, acceptanceId, second, "Still failing");

  const doctor = await runCli(["node", "codepatrol", "--workspace", root, "doctor"]);
  assert.equal(doctor.exitCode, 0, doctor.stderr);
  const payload = JSON.parse(doctor.stdout) as {
    atRiskWaves: Array<{ waveId: string }>;
    recurringAcceptanceFailures: Array<{ waveId: string; acceptanceId: string }>;
  };
  assert.ok(payload.atRiskWaves.some((entry) => entry.waveId === wave.id));
  assert.ok(
    payload.recurringAcceptanceFailures.some(
      (entry) => entry.waveId === wave.id && entry.acceptanceId === acceptanceId,
    ),
  );
});

test("trace includes cancelled producers and detects duplicate and abandoned work", async () => {
  const { root, service } = fixture();
  const { init, wave } = driveToBuild(service);
  const second = service.openProducer("build", wave.id, producer).task;
  service.cancelTask(second.id);

  const traced = await runCli([
    "node",
    "codepatrol",
    "--workspace",
    root,
    "trace",
    "--init",
    init.id,
  ]);
  assert.equal(traced.exitCode, 0, traced.stderr);
  const payload = JSON.parse(traced.stdout) as {
    entries: Array<{ kind: string; taskId?: string }>;
    problems: Array<{ kind: string; taskId?: string }>;
  };
  assert.ok(
    payload.entries.some(
      (entry) => entry.kind === "cancel" && entry.taskId === second.id,
    ),
  );
  assert.ok(payload.problems.some((problem) => problem.kind === "duplicate-producer"));
  assert.ok(
    payload.problems.some(
      (problem) =>
        problem.kind === "abandoned-producer" && problem.taskId === second.id,
    ),
  );
});

test("trace emits one review dwell finding for a later event in the same Wave", async () => {
  const { root, service } = fixture();
  const { init, wave, work, buildTask } = driveToBuild(service);
  commitCandidate(buildTask.workspace as string, "review-dwell");
  const proposalId = service.submitTask(buildTask.id, {
    summary: "Candidate",
    works: [{ workId: work.id, summary: "Implemented" }],
  }).task.proposalId as string;
  const review = service.openReview("build-review", wave.id, reviewer).task;
  service.repo.mutate(`ship accept ${wave.id}`, () => {});

  const traced = await runCli([
    "node",
    "codepatrol",
    "--workspace",
    root,
    "trace",
    "--init",
    init.id,
  ]);
  assert.equal(traced.exitCode, 0, traced.stderr);
  const payload = JSON.parse(traced.stdout) as {
    problems: Array<{ kind: string; taskId?: string }>;
  };
  const dwell = payload.problems.filter((problem) => problem.kind === "review-dwell");
  assert.deepEqual(
    dwell.map((problem) => problem.taskId),
    [review.id],
  );
  assert.ok(proposalId);
});

test("trace ignores later events from another Wave", async () => {
  const { root, service } = fixture();
  const { init, wave, work, buildTask } = driveToBuild(service);
  commitCandidate(buildTask.workspace as string, "cross-wave");
  service.submitTask(buildTask.id, {
    summary: "Candidate",
    works: [{ workId: work.id, summary: "Implemented" }],
  });
  service.openReview("build-review", wave.id, reviewer);
  service.createInit("Later event", "Advance committed history");

  const traced = await runCli([
    "node",
    "codepatrol",
    "--workspace",
    root,
    "trace",
    "--init",
    init.id,
  ]);
  assert.equal(traced.exitCode, 0, traced.stderr);
  const payload = JSON.parse(traced.stdout) as { problems: Array<{ kind: string }> };
  assert.equal(
    payload.problems.filter((problem) => problem.kind === "review-dwell").length,
    0,
  );
});

test("review submission closes only its matching tracked review", () => {
  const { service } = fixture();
  const { init, wave, work, buildTask } = driveToBuild(service);
  commitCandidate(buildTask.workspace as string, "review-isolation");
  const proposalId = service.submitTask(buildTask.id, {
    summary: "Candidate",
    works: [{ workId: work.id, summary: "Implemented" }],
  }).task.proposalId as string;
  const first = service.openReview("build-review", wave.id, reviewer).task;
  const base = service.repo.readState().state;
  const originalWave = base.waves.find((entry) => entry.id === wave.id);
  assert.ok(originalWave);
  const secondWave = { ...structuredClone(originalWave), id: "WAVE-other" };
  const second = {
    ...structuredClone(first),
    id: "TASK-other",
    subjectId: secondWave.id,
  };
  const openedFirst = structuredClone(base);
  const openedBoth = structuredClone(base);
  openedBoth.waves.push(secondWave);
  openedBoth.tasks.push(second);
  const submitted = structuredClone(openedBoth);
  const submittedFirst = submitted.tasks.find((task) => task.id === first.id);
  assert.ok(submittedFirst);
  submittedFirst.status = "submitted";
  const history: StateHistoryEntry[] = [
    {
      event: {
        sequence: 1,
        event: `build-review open ${wave.id}`,
        at: "2026-01-01T00:00:00.000Z",
      },
      state: openedFirst,
    },
    {
      event: {
        sequence: 2,
        event: `build-review open ${secondWave.id}`,
        at: "2026-01-01T00:01:00.000Z",
      },
      state: openedBoth,
    },
    {
      event: {
        sequence: 3,
        event: `build-review submit ${wave.id}`,
        at: "2026-01-01T00:02:00.000Z",
      },
      state: submitted,
    },
    {
      event: {
        sequence: 4,
        event: `ship accept ${secondWave.id}`,
        at: "2026-01-01T00:03:00.000Z",
      },
      state: submitted,
    },
  ];

  const dwell = problemsFromHistory(history, init.id, "init").filter(
    (problem) => problem.kind === "review-dwell",
  );
  assert.deepEqual(
    dwell.map((problem) => problem.taskId),
    [second.id],
  );
  assert.ok(proposalId);
});

test("doctor ignores return risks after a wave is shipped", async () => {
  const { root, service } = fixture();
  const { wave, work, buildTask } = driveToBuild(service);
  commitCandidate(buildTask.workspace as string, "terminal");
  const proposalId = service.submitTask(buildTask.id, {
    summary: "Candidate",
    works: [{ workId: work.id, summary: "Implemented" }],
  }).task.proposalId as string;
  approveBuild(service, wave.id, work.acceptance[0]?.id as string, proposalId);
  service.shipAccept(wave.id);

  const doctor = await runCli(["node", "codepatrol", "--workspace", root, "doctor"]);
  assert.equal(doctor.exitCode, 0, doctor.stderr);
  const payload = JSON.parse(doctor.stdout) as {
    atRiskWaves: unknown[];
    recurringAcceptanceFailures: unknown[];
    openTasks: unknown[];
  };
  assert.deepEqual(payload.atRiskWaves, []);
  assert.deepEqual(payload.recurringAcceptanceFailures, []);
  assert.deepEqual(payload.openTasks, []);
});

test("doctor lists the lifecycle step for open tasks", async () => {
  const { root, service } = fixture();
  const { wave, buildTask } = driveToBuild(service);
  const doctor = await runCli(["node", "codepatrol", "--workspace", root, "doctor"]);
  assert.equal(doctor.exitCode, 0, doctor.stderr);
  const payload = JSON.parse(doctor.stdout) as {
    openTasks: Array<{
      id: string;
      operation: string;
      subjectId: string;
      status: string;
      createdAt: string;
      next: string;
    }>;
  };
  const listed = payload.openTasks.find((entry) => entry.id === buildTask.id);
  assert.ok(listed);
  assert.equal(listed.operation, "build");
  assert.equal(listed.subjectId, wave.id);
  assert.equal(listed.status, "open");
  assert.ok(listed.createdAt);
  assert.equal(listed.next, "build");
});

test("doctor lists unsipped ready-to-ship waves and omits accepted ones", async () => {
  const { root, service } = fixture();
  const { wave, work, buildTask } = driveToBuild(service);
  commitCandidate(buildTask.workspace as string, "ready");
  const proposalId = service.submitTask(buildTask.id, {
    summary: "Candidate",
    works: [{ workId: work.id, summary: "Implemented" }],
  }).task.proposalId as string;
  approveBuild(service, wave.id, work.acceptance[0]?.id as string, proposalId);

  const ready = await runCli(["node", "codepatrol", "--workspace", root, "doctor"]);
  assert.equal(ready.exitCode, 0, ready.stderr);
  const readyPayload = JSON.parse(ready.stdout) as {
    unsippedReadyWaves: Array<{ id: string; next: string }>;
  };
  assert.deepEqual(readyPayload.unsippedReadyWaves, [{ id: wave.id, next: "ship" }]);

  service.shipAccept(wave.id);
  const shipped = await runCli(["node", "codepatrol", "--workspace", root, "doctor"]);
  assert.equal(shipped.exitCode, 0, shipped.stderr);
  const shippedPayload = JSON.parse(shipped.stdout) as {
    unsippedReadyWaves: Array<{ id: string; next: string }>;
  };
  assert.deepEqual(shippedPayload.unsippedReadyWaves, []);
});
