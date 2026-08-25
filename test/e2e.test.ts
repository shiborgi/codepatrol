import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import type { Source } from "../src/core.js";
import { commitCandidate, fixture, git } from "./helpers.js";

const producer: Source = { harness: "test-producer", model: "model-a", agent: null };
const reviewer: Source = { harness: "test-reviewer", model: "model-b", agent: null };

function spec(title: string) {
  return {
    title,
    intent: `Implement ${title}`,
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

test("golden path selects among multiple Specs, Plans, and Builds", () => {
  const { root, repo, service } = fixture();
  const init = service.createInit("New feature", "Choose the strongest implementation");

  const specTaskA = service.openProducer("spec", init.id, producer).task;
  const specProposalA = service.submitTask(specTaskA.id, spec("Option A")).task
    .proposalId as string;
  const specTaskB = service.openProducer("spec", init.id, producer).task;
  const specProposalB = service.submitTask(specTaskB.id, spec("Option B")).task
    .proposalId as string;

  const specReview = service.openReview("spec-review", init.id, reviewer).task;
  service.submitTask(specReview.id, {
    decision: "approve",
    selectedProposalId: specProposalB,
    summary: "Option B is clearer",
    candidates: [
      { proposalId: specProposalA, status: "passed", summary: "Valid", score: 100 },
      { proposalId: specProposalB, status: "passed", summary: "Best", score: 0 },
    ],
  });

  const wave = service.list("wave")[0] as { id: string };
  const work = service.list("work")[0] as {
    id: string;
    acceptance: Array<{ id: string }>;
  };
  const plan = (summary: string) => ({
    works: [
      {
        workId: work.id,
        summary,
        steps: [{ summary: "Implement", acceptanceIds: [work.acceptance[0]?.id] }],
      },
    ],
    verification: "Run the configured gate",
    openQuestions: [],
  });
  const planTaskA = service.openProducer("plan", wave.id, producer).task;
  const planProposalA = service.submitTask(planTaskA.id, plan("Plan A")).task
    .proposalId as string;
  const planTaskB = service.openProducer("plan", wave.id, producer).task;
  const planProposalB = service.submitTask(planTaskB.id, plan("Plan B")).task
    .proposalId as string;
  const planReview = service.openReview("plan-review", wave.id, reviewer).task;
  service.submitTask(planReview.id, {
    decision: "approve",
    selectedProposalId: planProposalB,
    summary: "Plan B is smaller",
    candidates: [
      { proposalId: planProposalA, status: "passed", summary: "Valid", score: 100 },
      { proposalId: planProposalB, status: "passed", summary: "Best", score: 0 },
    ],
  });

  const buildTaskA = service.openProducer("build", wave.id, producer).task;
  commitCandidate(buildTaskA.workspace as string, "candidate-a");
  const buildProposalA = service.submitTask(buildTaskA.id, {
    summary: "Candidate A",
    works: [{ workId: work.id, summary: "Implemented A" }],
  }).task.proposalId as string;
  const buildTaskB = service.openProducer("build", wave.id, producer).task;
  commitCandidate(buildTaskB.workspace as string, "candidate-b");
  const buildProposalB = service.submitTask(buildTaskB.id, {
    summary: "Candidate B",
    works: [{ workId: work.id, summary: "Implemented B" }],
  }).task.proposalId as string;

  const buildReview = service.openReview("build-review", wave.id, reviewer).task;
  assert.equal(buildReview.status, "open");
  assert.deepEqual(
    buildReview.verification.map((entry) => entry.status),
    ["passed", "passed"],
  );
  service.submitTask(buildReview.id, {
    decision: "approve",
    selectedProposalId: buildProposalB,
    summary: "Candidate B is better",
    candidates: [
      { proposalId: buildProposalA, status: "passed", summary: "Valid", score: 100 },
      { proposalId: buildProposalB, status: "passed", summary: "Best", score: 0 },
    ],
    acceptance: [
      { id: work.acceptance[0]?.id, status: "passed", summary: "Demonstrated" },
    ],
  });

  const shipped = service.shipAccept(wave.id) as { commit: string };
  assert.equal(git(root, ["rev-parse", "HEAD"]).trim(), shipped.commit);
  assert.equal(readFileSync(resolve(root, "result.txt"), "utf8"), "candidate-b\n");
  assert.equal(git(root, ["status", "--porcelain"]), "");
  assert.deepEqual(repo.listManagedWorktrees(), []);
  assert.equal(
    service.list("work")[0] && (service.list("work")[0] as { status: string }).status,
    "accepted",
  );
  assert.equal(repo.resolveRef("refs/codepatrol/v1/state") !== null, true);
  assert.equal(
    repo.resolveRef(`refs/codepatrol/v1/candidates/${wave.id}/${buildProposalA}`),
    null,
  );
  assert.equal(
    repo.resolveRef(`refs/codepatrol/v1/candidates/${wave.id}/${buildProposalB}`),
    null,
  );
});

test("open tasks are recoverable and review refuses active producers", () => {
  const { service } = fixture();
  const init = service.createInit("Recovery", "Do not wedge the repository");
  const completed = service.openProducer("spec", init.id, producer).task;
  service.submitTask(completed.id, spec("Recovery"));
  const abandoned = service.openProducer("spec", init.id, producer).task;
  assert.equal(service.showTask(abandoned.id).task.status, "open");
  assert.throws(
    () => service.openReview("spec-review", init.id, reviewer),
    (error: unknown) => (error as { code?: string }).code === "PRODUCERS_ACTIVE",
  );
  service.cancelTask(abandoned.id);
  assert.equal(service.showTask(abandoned.id).task.status, "cancelled");
  assert.equal(
    service.openReview("spec-review", init.id, reviewer).task.status,
    "open",
  );
  assert.throws(
    () => service.resumeInit(init.id),
    (error: unknown) => (error as { code?: string }).code === "RESUME_NOT_ALLOWED",
  );
});

test("invalid results leave a task open", () => {
  const { service } = fixture();
  const init = service.createInit("Validation", "Reject malformed output");
  const task = service.openProducer("spec", init.id, producer).task;
  assert.throws(
    () => service.submitTask(task.id, { title: "Incomplete" }),
    (error: unknown) => (error as { code?: string }).code === "INVALID_RESULT",
  );
  assert.equal(service.showTask(task.id).task.status, "open");
});
