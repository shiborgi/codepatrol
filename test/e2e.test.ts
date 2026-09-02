import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import type { Source, Task } from "../src/core.js";
import {
  commitCandidate,
  fixture,
  git,
  scorecardFor,
  stageScorecardFor,
} from "./helpers.js";

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
      {
        proposalId: specProposalA,
        status: "passed",
        summary: "Valid",
        scorecard: stageScorecardFor("spec-review", specProposalA, 25),
      },
      {
        proposalId: specProposalB,
        status: "passed",
        summary: "Best",
        scorecard: stageScorecardFor("spec-review", specProposalB, 75),
      },
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
      {
        proposalId: planProposalA,
        status: "passed",
        summary: "Valid",
        scorecard: stageScorecardFor("plan-review", planProposalA, 25),
      },
      {
        proposalId: planProposalB,
        status: "passed",
        summary: "Best",
        scorecard: stageScorecardFor("plan-review", planProposalB, 75),
      },
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
      {
        proposalId: buildProposalA,
        status: "passed",
        summary: "Valid",
        scorecard: stageScorecardFor("build-review", buildProposalA, 25),
      },
      {
        proposalId: buildProposalB,
        status: "passed",
        summary: "Best",
        scorecard: stageScorecardFor("build-review", buildProposalB, 75),
      },
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

test("approval must select the rank-one effective passing candidate", () => {
  const { service } = fixture();
  const init = service.createInit("Ranking", "Enforce rank-one selection");
  const specA = service.openProducer("spec", init.id, producer).task;
  const proposalA = service.submitTask(specA.id, spec("Option A")).task
    .proposalId as string;
  const specB = service.openProducer("spec", init.id, producer).task;
  const proposalB = service.submitTask(specB.id, spec("Option B")).task
    .proposalId as string;
  const review = service.openReview("spec-review", init.id, reviewer).task;
  assert.throws(
    () =>
      service.submitTask(review.id, {
        decision: "approve",
        selectedProposalId: proposalA,
        summary: "Selecting lower-ranked",
        candidates: [
          {
            proposalId: proposalA,
            status: "passed",
            summary: "Lower",
            scorecard: scorecardFor("spec-review", proposalA, 25),
          },
          {
            proposalId: proposalB,
            status: "passed",
            summary: "Higher",
            scorecard: scorecardFor("spec-review", proposalB, 75),
          },
        ],
      }),
    (error: unknown) => (error as { code?: string }).code === "INVALID_SELECTION",
  );
  const approved = service.submitTask(review.id, {
    decision: "approve",
    selectedProposalId: proposalB,
    summary: "Selecting rank one",
    candidates: [
      {
        proposalId: proposalA,
        status: "passed",
        summary: "Lower",
        scorecard: scorecardFor("spec-review", proposalA, 25),
      },
      {
        proposalId: proposalB,
        status: "passed",
        summary: "Higher",
        scorecard: scorecardFor("spec-review", proposalB, 75),
      },
    ],
  });
  assert.equal(approved.task.status, "submitted");
});

test("approval rejects when no candidate passes review", () => {
  const { service } = fixture();
  const init = service.createInit("NoPass", "Reject no-passing approval");
  const specA = service.openProducer("spec", init.id, producer).task;
  const proposalA = service.submitTask(specA.id, spec("Option A")).task
    .proposalId as string;
  const review = service.openReview("spec-review", init.id, reviewer).task;
  assert.throws(
    () =>
      service.submitTask(review.id, {
        decision: "approve",
        selectedProposalId: proposalA,
        summary: "No passing candidate",
        candidates: [
          {
            proposalId: proposalA,
            status: "failed",
            summary: "Failed",
            scorecard: scorecardFor("spec-review", proposalA, 0),
          },
        ],
      }),
    (error: unknown) =>
      (error as { code?: string }).code === "SELECTED_CANDIDATE_FAILED",
  );
});

test("malformed scorecards are rejected on protocol-bearing reviews", () => {
  const { service } = fixture();
  const init = service.createInit("Malformed", "Reject malformed scorecards");
  const specA = service.openProducer("spec", init.id, producer).task;
  const proposalA = service.submitTask(specA.id, spec("Option A")).task
    .proposalId as string;
  const review = service.openReview("spec-review", init.id, reviewer).task;
  const scorecard = scorecardFor("spec-review", proposalA);
  assert.throws(
    () =>
      service.submitTask(review.id, {
        decision: "return",
        summary: "Missing scorecard",
        candidates: [{ proposalId: proposalA, status: "failed", summary: "No" }],
      }),
    (error: unknown) => (error as { code?: string }).code === "INVALID_RESULT",
  );
  assert.throws(
    () =>
      service.submitTask(review.id, {
        decision: "return",
        summary: "Wrong version",
        candidates: [
          {
            proposalId: proposalA,
            status: "failed",
            summary: "No",
            scorecard: { ...scorecard, rubricVersion: "plan-v1" },
          },
        ],
      }),
    (error: unknown) => (error as { code?: string }).code === "INVALID_RESULT",
  );
  assert.throws(
    () =>
      service.submitTask(review.id, {
        decision: "return",
        summary: "Reviewer total",
        candidates: [
          {
            proposalId: proposalA,
            status: "failed",
            summary: "No",
            scorecard,
            total: 99,
          },
        ],
      }),
    (error: unknown) => (error as { code?: string }).code === "INVALID_RESULT",
  );
});

test("review submission rejects mixed scorecard shapes without sealing the round", () => {
  const { service } = fixture();
  const init = service.createInit("Mixed scorecards", "Reject incompatible vectors");
  const specA = service.openProducer("spec", init.id, producer).task;
  const proposalA = service.submitTask(specA.id, spec("Option A")).task
    .proposalId as string;
  const specB = service.openProducer("spec", init.id, producer).task;
  const proposalB = service.submitTask(specB.id, spec("Option B")).task
    .proposalId as string;
  const review = service.openReview("spec-review", init.id, reviewer).task;

  assert.throws(
    () =>
      service.submitTask(review.id, {
        decision: "return",
        summary: "Mixed scorecards are invalid",
        candidates: [
          {
            proposalId: proposalA,
            status: "failed",
            summary: "Stage card",
            scorecard: stageScorecardFor("spec-review", proposalA),
          },
          {
            proposalId: proposalB,
            status: "failed",
            summary: "Legacy card",
            scorecard: scorecardFor("spec-review", proposalB),
          },
        ],
      }),
    (error: unknown) => (error as { code?: string }).code === "INVALID_RESULT",
  );
  assert.equal(service.showTask(review.id).task.status, "open");

  const submitted = service.submitTask(review.id, {
    decision: "approve",
    selectedProposalId: proposalB,
    summary: "Uniform stage cards",
    candidates: [
      {
        proposalId: proposalA,
        status: "passed",
        summary: "Stage card",
        scorecard: stageScorecardFor("spec-review", proposalA, 25),
      },
      {
        proposalId: proposalB,
        status: "passed",
        summary: "Stage card",
        scorecard: stageScorecardFor("spec-review", proposalB, 75),
      },
    ],
  });
  assert.equal(submitted.task.status, "submitted");
});

test("a higher-scoring failed candidate cannot be selected over a passing one", () => {
  const { service } = fixture();
  const init = service.createInit("FailedHigh", "Failed cannot outrank passed");
  const specA = service.openProducer("spec", init.id, producer).task;
  const proposalA = service.submitTask(specA.id, spec("Option A")).task
    .proposalId as string;
  const specB = service.openProducer("spec", init.id, producer).task;
  const proposalB = service.submitTask(specB.id, spec("Option B")).task
    .proposalId as string;
  const review = service.openReview("spec-review", init.id, reviewer).task;
  assert.throws(
    () =>
      service.submitTask(review.id, {
        decision: "approve",
        selectedProposalId: proposalB,
        summary: "Selecting failed high scorer",
        candidates: [
          {
            proposalId: proposalA,
            status: "passed",
            summary: "Passing",
            scorecard: scorecardFor("spec-review", proposalA, 25),
          },
          {
            proposalId: proposalB,
            status: "failed",
            summary: "Failed but high",
            scorecard: scorecardFor("spec-review", proposalB, 100),
          },
        ],
      }),
    (error: unknown) =>
      (error as { code?: string }).code === "SELECTED_CANDIDATE_FAILED",
  );
  const approved = service.submitTask(review.id, {
    decision: "approve",
    selectedProposalId: proposalA,
    summary: "Selecting passing candidate",
    candidates: [
      {
        proposalId: proposalA,
        status: "passed",
        summary: "Passing",
        scorecard: scorecardFor("spec-review", proposalA, 25),
      },
      {
        proposalId: proposalB,
        status: "failed",
        summary: "Failed but high",
        scorecard: scorecardFor("spec-review", proposalB, 100),
      },
    ],
  });
  assert.equal(approved.task.status, "submitted");
});

test("review envelope exposes the anonymized protocol and candidates first", () => {
  const { service } = fixture();
  const init = service.createInit("Envelope", "Expose protocol");
  const specA = service.openProducer("spec", init.id, producer).task;
  const proposalA = service.submitTask(specA.id, spec("Option A")).task
    .proposalId as string;
  const specB = service.openProducer("spec", init.id, producer).task;
  const proposalB = service.submitTask(specB.id, spec("Option B")).task
    .proposalId as string;
  const review = service.openReview("spec-review", init.id, reviewer);
  const protocol = review.reviewProtocol as {
    rubricVersion: string;
    labels: Record<string, string>;
    auditProvenance: Record<string, string>;
    evidenceCatalog: string[];
  };
  assert.equal(protocol.rubricVersion, "spec-v1");
  const sorted = [proposalA, proposalB].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(protocol.labels, {
    [sorted[0] as string]: "C01",
    [sorted[1] as string]: "C02",
  });
  assert.deepEqual(protocol.auditProvenance, {
    C01: sorted[0] as string,
    C02: sorted[1] as string,
  });
  const input = review.input as {
    candidates: Array<{ label: string; proposalId: string }>;
  };
  assert.deepEqual(input.candidates, [
    { label: protocol.labels[proposalA] as string, proposalId: proposalA },
    { label: protocol.labels[proposalB] as string, proposalId: proposalB },
  ]);
});

test("review attempts fan out, seal the round, and arbitrate on disagreement", () => {
  const { service } = fixture();
  const init = service.createInit("Fanout", "Review attempts and arbitration");
  const specTask = service.openProducer("spec", init.id, producer).task;
  const specProposal = service.submitTask(specTask.id, spec("Fanout")).task
    .proposalId as string;

  const attemptA = service.openReviewAttempts("spec-review", init.id, [
    { source: { ...reviewer, model: "model-a" } },
    { source: { ...reviewer, model: "model-b" } },
  ]);
  assert.equal(attemptA.tasks.length, 2);
  const round = (
    service.show("init", init.id) as {
      specRounds: Array<{
        status: string;
        reviewTaskId: string | null;
        reviewAttemptIds: string[];
      }>;
    }
  ).specRounds.at(-1) as {
    status: string;
    reviewTaskId: string | null;
    reviewAttemptIds: string[];
  };
  assert.equal(round.status, "reviewing");
  assert.equal(round.reviewTaskId, null);
  assert.equal(round.reviewAttemptIds.length, 2);

  const [t1, t2] = attemptA.tasks.map((entry) => entry.task) as [Task, Task];
  service.submitTask(t1.id, {
    decision: "approve",
    selectedProposalId: specProposal,
    summary: "A",
    candidates: [
      {
        proposalId: specProposal,
        status: "passed",
        summary: "Pass",
        scorecard: stageScorecardFor("spec-review", specProposal, 75),
      },
    ],
  });
  service.submitTask(t2.id, {
    decision: "return",
    summary: "B",
    candidates: [
      {
        proposalId: specProposal,
        status: "failed",
        summary: "Fail",
        scorecard: stageScorecardFor("spec-review", specProposal, 25),
      },
    ],
  });
  const after = (
    service.show("init", init.id) as {
      specRounds: Array<{
        status: string;
        reviewTaskId: string | null;
        arbitrationTaskId: string | null;
      }>;
    }
  ).specRounds.at(-1) as {
    status: string;
    reviewTaskId: string | null;
    arbitrationTaskId: string | null;
  };
  assert.equal(after.status, "reviewing");
  assert.equal(after.reviewTaskId, null);
  assert.ok(after.arbitrationTaskId, "arbitration should open on disagreement");
  const arb = service.showTask(after.arbitrationTaskId as string);
  assert.equal(arb.task.reviewRole, "arbitration");
  const input = arb.input as {
    attempts: Array<{ attemptId: string; decision: string | null }>;
  };
  assert.equal(input.attempts.length, 2);
  service.submitTask(after.arbitrationTaskId as string, {
    selectedAttemptId: t1.id,
    rationale: "A is host-valid and approves",
  });
  const final = (
    service.show("init", init.id) as {
      specRounds: Array<{
        status: string;
        reviewTaskId: string | null;
        selectedProposalId: string | null;
      }>;
    }
  ).specRounds.at(-1) as {
    status: string;
    reviewTaskId: string | null;
    selectedProposalId: string | null;
  };
  assert.equal(final.status, "approved");
  assert.equal(final.reviewTaskId, t1.id);
  assert.equal(final.selectedProposalId, specProposal);
});
