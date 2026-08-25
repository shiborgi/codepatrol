import assert from "node:assert/strict";
import test from "node:test";
import { runCli } from "../src/cli.js";
import type { Source } from "../src/core.js";
import { commitCandidate, fixture } from "./helpers.js";

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
    candidates: [{ proposalId: specProposalId, status: "passed", summary: "Valid" }],
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
    candidates: [{ proposalId: planProposalId, status: "passed", summary: "Valid" }],
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
    candidates: [{ proposalId, status: "passed", summary: "Valid" }],
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
    candidates: [{ proposalId, status: "failed", summary }],
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
  };
  assert.deepEqual(healthyPayload.atRiskWaves, []);
  assert.deepEqual(healthyPayload.recurringAcceptanceFailures, []);

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
