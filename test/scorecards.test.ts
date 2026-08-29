import assert from "node:assert/strict";
import test from "node:test";
import { newRound, type State, type Task } from "../src/core.js";
import {
  buildReviewProtocol,
  computeReviewOutcome,
  RUBRICS,
  rubricFor,
  SCORECARD_ANCHORS,
  totalFor,
  validateScorecard,
} from "../src/scorecards.js";
import { stableJson } from "../src/shared.js";
import { fixture } from "./helpers.js";

function task(operation: "spec-review" | "plan-review" | "build-review"): Task {
  return {
    id: "TASK-review",
    operation,
    subjectId: operation === "spec-review" ? "INIT-1" : "WAVE-1.1",
    round: 1,
    status: "open",
    source: { harness: "test", model: null, agent: null },
    workspace: null,
    baseCommit: null,
    proposalId: null,
    result: null,
    verification: [],
    failure: null,
    createdAt: new Date(0).toISOString(),
    finishedAt: null,
  };
}

function stateWith(proposalIds: string[]): State {
  const { repo } = fixture();
  repo.mutate("seed", (state) => {
    state.inits.push({
      id: "INIT-1",
      title: "Scorecards",
      brief: "Test",
      status: "specifying",
      specRounds: [newRound("spec", 1)],
      selectedSpecId: null,
      waveIds: [],
      reviewReturns: 0,
      createdAt: new Date(0).toISOString(),
    });
    state.waves.push({
      id: "WAVE-1.1",
      initId: "INIT-1",
      title: "Wave",
      status: "building",
      workIds: ["WORK-1.1.1"],
      planRounds: [newRound("plan", 1)],
      buildRounds: [newRound("build", 1)],
      selectedPlanId: null,
      selectedBuildId: null,
      reviewReturns: { plan: 0, build: 0 },
      ship: null,
    });
    state.works.push({
      id: "WORK-1.1.1",
      waveId: "WAVE-1.1",
      key: "work",
      title: "Work",
      description: "Work",
      acceptance: [{ id: "AC-1.1.1.1", text: "Accept" }],
      blockedBy: [],
      status: "pending",
    });
    for (const proposalId of proposalIds) {
      state.proposals.push({
        id: proposalId,
        taskId: "TASK-producer",
        operation: "build",
        subjectId: "WAVE-1.1",
        round: 1,
        source: { harness: "test", model: null, agent: null },
        document: null,
        candidate: {
          ref: `refs/codepatrol/v1/candidates/WAVE-1.1/${proposalId}`,
          baseCommit: "a".repeat(40),
          commit: "b".repeat(40),
          tree: "c".repeat(40),
          changedPaths: [],
        },
        summary: null,
        createdAt: new Date(0).toISOString(),
      });
    }
  });
  return repo.readState().state;
}

test("rubric constants match the approved weights and anchors", () => {
  assert.deepEqual(SCORECARD_ANCHORS, [0, 25, 50, 75, 100]);
  const spec = RUBRICS["spec-v1"] as (typeof RUBRICS)["spec-v1"];
  const plan = RUBRICS["plan-v1"] as (typeof RUBRICS)["plan-v1"];
  const build = RUBRICS["build-v1"] as (typeof RUBRICS)["build-v1"];
  assert.deepEqual(
    spec.categories.map((entry) => [entry.category, entry.weight]),
    [
      ["intent-alignment", 25],
      ["scope-completeness", 20],
      ["work-slicing", 15],
      ["acceptance-testability", 20],
      ["domain-fit", 10],
      ["architectural-fit", 10],
    ],
  );
  assert.deepEqual(
    plan.categories.map((entry) => [entry.category, entry.weight]),
    [
      ["acceptance-traceability", 25],
      ["executability", 20],
      ["technical-feasibility", 15],
      ["verification-strategy", 20],
      ["minimality", 10],
      ["architectural-fit", 10],
    ],
  );
  assert.deepEqual(
    build.categories.map((entry) => [entry.category, entry.weight]),
    [
      ["acceptance-fulfillment", 30],
      ["plan-fidelity", 15],
      ["test-quality", 15],
      ["verification-evidence", 15],
      ["minimality", 10],
      ["repository-fit", 15],
    ],
  );
});

test("review protocol assigns deterministic labels and a sorted evidence catalog", () => {
  const state = stateWith(["PROP-b", "PROP-a"]);
  const t = task("build-review");
  const protocol = buildReviewProtocol(state, t, ["PROP-b", "PROP-a"]);
  assert.equal(protocol.rubricVersion, "build-v1");
  assert.deepEqual(protocol.labels, { "PROP-a": "C01", "PROP-b": "C02" });
  assert.deepEqual(protocol.auditProvenance, { C01: "PROP-a", C02: "PROP-b" });
  assert.deepEqual(protocol.anchors, [0, 25, 50, 75, 100]);
  assert.ok(protocol.evidenceCatalog.includes("proposal:PROP-a"));
  assert.ok(protocol.evidenceCatalog.includes("acceptance:AC-1.1.1.1"));
  assert.ok(protocol.evidenceCatalog.includes("repository:".concat("b".repeat(40))));
  const sorted = [...protocol.evidenceCatalog].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(protocol.evidenceCatalog, sorted);
});

test("review protocols expose ordered operation-specific dimensions", () => {
  const expected = {
    "spec-review": [
      "scope-coverage",
      "requirement-grounding",
      "acceptance-clarity",
      "unresolved-ambiguity",
    ],
    "plan-review": [
      "acceptance-mapping",
      "code-locality",
      "dependency-risk-coverage",
      "verification-specificity",
    ],
    "build-review": [
      "acceptance-evidence",
      "test-verification-evidence",
      "regression-risk",
      "change-scope",
    ],
  } as const;
  for (const operation of Object.keys(expected) as Array<keyof typeof expected>) {
    const protocol = buildReviewProtocol(stateWith(["PROP-a"]), task(operation), [
      "PROP-a",
    ]);
    assert.equal(protocol.operation, operation);
    assert.deepEqual(
      protocol.dimensions?.map((dimension) => dimension.dimension),
      expected[operation],
    );
    assert.equal(
      protocol.dimensions?.reduce((sum, dimension) => sum + dimension.weight, 0),
      100,
    );
  }
});

test("stage scorecards validate dimensions and host totals independently of input order", () => {
  const state = stateWith(["PROP-a"]);
  const t = task("spec-review");
  const protocol = buildReviewProtocol(state, t, ["PROP-a"]);
  const stage = {
    operation: "spec-review",
    dimensions: [
      {
        dimension: "scope-coverage",
        level: 25,
        rationale: "Scope is explicit.",
        evidenceRefs: ["proposal:PROP-a"],
      },
      {
        dimension: "requirement-grounding",
        level: 50,
        rationale: "Requirements are grounded.",
        evidenceRefs: ["proposal:PROP-a"],
      },
      {
        dimension: "acceptance-clarity",
        level: 75,
        rationale: "Acceptance is clear.",
        evidenceRefs: ["proposal:PROP-a"],
      },
      {
        dimension: "unresolved-ambiguity",
        level: 100,
        rationale: "No material ambiguity remains.",
        evidenceRefs: ["proposal:PROP-a"],
      },
    ],
  };
  assert.doesNotThrow(() => validateScorecard(protocol, stage as never));
  const outcome = computeReviewOutcome(state, t, protocol, [
    { proposalId: "PROP-a", status: "passed", scorecard: stage as never },
  ]);
  assert.equal(outcome.candidates[0]?.total, 63);

  const invalid = (change: object) => ({
    ...stage,
    dimensions: stage.dimensions.map((entry, index) =>
      index === 0 ? { ...entry, ...change } : entry,
    ),
  });
  for (const malformed of [
    invalid({ dimension: "unknown" }),
    invalid({ level: 101 }),
    invalid({ evidenceRefs: ["missing:evidence"] }),
    invalid({ evidenceRefs: [] }),
  ]) {
    assert.throws(
      () => validateScorecard(protocol, malformed as never),
      (error: unknown) => (error as { code?: string }).code === "INVALID_RESULT",
    );
  }
});

test("stage scorecard ranking uses profile before proposal id and rejects an unresolved tie", () => {
  const state = stateWith(["PROP-a", "PROP-b"]);
  const a = state.proposals.find((proposal) => proposal.id === "PROP-a");
  const b = state.proposals.find((proposal) => proposal.id === "PROP-b");
  if (a) a.contextProfile = "zeta";
  if (b) b.contextProfile = "alpha";
  const t = task("plan-review");
  const protocol = buildReviewProtocol(state, t, ["PROP-b", "PROP-a"]);
  const dimensions = [
    "acceptance-mapping",
    "code-locality",
    "dependency-risk-coverage",
    "verification-specificity",
  ];
  const scorecard = (operation: string, proposalId: string) => ({
    operation,
    dimensions: dimensions.map((dimension) => ({
      dimension,
      level: 50,
      rationale: "Comparable evidence.",
      evidenceRefs: [`proposal:${proposalId}`],
    })),
  });
  const outcome = computeReviewOutcome(state, t, protocol, [
    {
      proposalId: "PROP-a",
      status: "passed",
      scorecard: scorecard("plan-review", "PROP-a") as never,
    },
    {
      proposalId: "PROP-b",
      status: "passed",
      scorecard: scorecard("plan-review", "PROP-b") as never,
    },
  ]);
  assert.deepEqual(
    outcome.candidates.map((candidate) => candidate.proposalId),
    ["PROP-b", "PROP-a"],
  );
  assert.throws(
    () =>
      computeReviewOutcome(state, t, protocol, [
        {
          proposalId: "PROP-a",
          status: "passed",
          scorecard: scorecard("plan-review", "PROP-a") as never,
        },
        {
          proposalId: "PROP-a",
          status: "passed",
          scorecard: scorecard("plan-review", "PROP-a") as never,
        },
      ]),
    (error: unknown) => (error as { code?: string }).code === "INVALID_RESULT",
  );
});

test("scorecard protocol bytes do not depend on proposal input order", () => {
  const state = stateWith(["PROP-a", "PROP-b"]);
  const t = task("build-review");
  const forward = buildReviewProtocol(state, t, ["PROP-a", "PROP-b"]);
  const reverse = buildReviewProtocol(state, t, ["PROP-b", "PROP-a"]);
  assert.equal(stableJson(forward), stableJson(reverse));
});

test("total uses floor((sum(weight*level)+50)/100)", () => {
  const rubric = rubricFor("spec-review");
  const levels = [50, 50, 50, 50, 50, 50];
  const weighted = rubric.categories.reduce(
    (sum, entry, index) => sum + entry.weight * (levels[index] ?? 0),
    0,
  );
  assert.equal(totalFor(rubric, levels), Math.floor((weighted + 50) / 100));
  assert.equal(totalFor(rubric, [0, 0, 0, 0, 0, 0]), 0);
  assert.equal(totalFor(rubric, [100, 100, 100, 100, 100, 100]), 100);
});

test("scorecard validation rejects wrong version, order, and unknown evidence", () => {
  const state = stateWith(["PROP-a"]);
  const t = task("spec-review");
  const protocol = buildReviewProtocol(state, t, ["PROP-a"]);
  const valid = {
    rubricVersion: "spec-v1",
    assessments: protocol.rubric.categories.map((entry) => ({
      category: entry.category,
      level: 50,
      rationale: "ok",
      evidenceRefs: ["proposal:PROP-a"],
    })),
  };
  assert.doesNotThrow(() => validateScorecard(protocol, valid));
  assert.throws(
    () => validateScorecard(protocol, { ...valid, rubricVersion: "plan-v1" }),
    (error: unknown) => (error as { code?: string }).code === "INVALID_RESULT",
  );
  const reordered = {
    ...valid,
    assessments: [...valid.assessments].reverse(),
  };
  assert.throws(
    () => validateScorecard(protocol, reordered),
    (error: unknown) => (error as { code?: string }).code === "INVALID_RESULT",
  );
  const badEvidence = {
    ...valid,
    assessments: valid.assessments.map((entry, index) =>
      index === 0 ? { ...entry, evidenceRefs: ["unknown:ref"] } : entry,
    ),
  };
  assert.throws(
    () => validateScorecard(protocol, badEvidence),
    (error: unknown) => (error as { code?: string }).code === "INVALID_RESULT",
  );
  const emptyRationale = {
    ...valid,
    assessments: valid.assessments.map((entry, index) =>
      index === 0 ? { ...entry, rationale: "  " } : entry,
    ),
  };
  assert.throws(
    () => validateScorecard(protocol, emptyRationale),
    (error: unknown) => (error as { code?: string }).code === "INVALID_RESULT",
  );
});

test("a review rejects mixed legacy and stage scorecard shapes for every operation", () => {
  for (const operation of ["spec-review", "plan-review", "build-review"] as const) {
    const state = stateWith(["PROP-a", "PROP-b"]);
    const t = task(operation);
    const protocol = buildReviewProtocol(state, t, ["PROP-a", "PROP-b"]);
    const stage = {
      operation,
      dimensions: (protocol.dimensions ?? []).map((entry) => ({
        dimension: entry.dimension,
        level: 50,
        rationale: "Stage evidence",
        evidenceRefs: ["proposal:PROP-a"],
      })),
    };
    const legacy = {
      rubricVersion: protocol.rubricVersion,
      assessments: protocol.rubric.categories.map((entry) => ({
        category: entry.category,
        level: 50,
        rationale: "Legacy evidence",
        evidenceRefs: ["proposal:PROP-b"],
      })),
    };
    assert.throws(
      () =>
        computeReviewOutcome(state, t, protocol, [
          { proposalId: "PROP-a", status: "passed", scorecard: stage as never },
          { proposalId: "PROP-b", status: "passed", scorecard: legacy },
        ]),
      (error: unknown) => (error as { code?: string }).code === "INVALID_RESULT",
    );
  }
});

test("ranking orders by effective passed, total, levels, then proposalId", () => {
  const state = stateWith(["PROP-a", "PROP-b", "PROP-c"]);
  const t = task("build-review");
  t.verification = [
    {
      proposalId: "PROP-a",
      status: "passed",
      argv: [],
      exitCode: 0,
      durationMs: 0,
      output: "",
      outputDigest: "x",
      truncated: false,
    },
    {
      proposalId: "PROP-b",
      status: "passed",
      argv: [],
      exitCode: 0,
      durationMs: 0,
      output: "",
      outputDigest: "x",
      truncated: false,
    },
    {
      proposalId: "PROP-c",
      status: "failed",
      argv: [],
      exitCode: 1,
      durationMs: 0,
      output: "",
      outputDigest: "x",
      truncated: false,
    },
  ];
  const protocol = buildReviewProtocol(state, t, ["PROP-a", "PROP-b", "PROP-c"]);
  const scorecard = (proposalId: string, level: number) => ({
    rubricVersion: "build-v1",
    assessments: protocol.rubric.categories.map((entry) => ({
      category: entry.category,
      level,
      rationale: "ok",
      evidenceRefs: [`proposal:${proposalId}`],
    })),
  });
  const outcome = computeReviewOutcome(state, t, protocol, [
    { proposalId: "PROP-a", status: "passed", scorecard: scorecard("PROP-a", 50) },
    { proposalId: "PROP-b", status: "passed", scorecard: scorecard("PROP-b", 75) },
    { proposalId: "PROP-c", status: "passed", scorecard: scorecard("PROP-c", 100) },
  ]);
  assert.deepEqual(
    outcome.candidates.map((candidate) => candidate.proposalId),
    ["PROP-b", "PROP-a", "PROP-c"],
  );
  assert.deepEqual(
    outcome.candidates.map((candidate) => candidate.rank),
    [1, 2, 3],
  );
  assert.equal(outcome.candidates[0]?.effectivePassed, true);
  assert.equal(outcome.candidates[2]?.effectivePassed, false);
  assert.equal(outcome.winner, "C02");
});

test("input-order invariance: ranking is independent of verdict order", () => {
  const state = stateWith(["PROP-a", "PROP-b"]);
  const t = task("plan-review");
  const protocol = buildReviewProtocol(state, t, ["PROP-a", "PROP-b"]);
  const scorecard = (proposalId: string, level: number) => ({
    rubricVersion: "plan-v1",
    assessments: protocol.rubric.categories.map((entry) => ({
      category: entry.category,
      level,
      rationale: "ok",
      evidenceRefs: [`proposal:${proposalId}`],
    })),
  });
  const forward = computeReviewOutcome(state, t, protocol, [
    { proposalId: "PROP-a", status: "passed", scorecard: scorecard("PROP-a", 50) },
    { proposalId: "PROP-b", status: "passed", scorecard: scorecard("PROP-b", 50) },
  ]);
  const reversed = computeReviewOutcome(state, t, protocol, [
    { proposalId: "PROP-b", status: "passed", scorecard: scorecard("PROP-b", 50) },
    { proposalId: "PROP-a", status: "passed", scorecard: scorecard("PROP-a", 50) },
  ]);
  assert.deepEqual(
    forward.candidates.map((candidate) => candidate.proposalId),
    reversed.candidates.map((candidate) => candidate.proposalId),
  );
  assert.deepEqual(
    forward.candidates.map((candidate) => candidate.rank),
    reversed.candidates.map((candidate) => candidate.rank),
  );
});

test("legacy reviews without a protocol accept optional scores and no scorecard", () => {
  const { service } = fixture();
  const init = service.createInit("Legacy", "Historical review path");
  const source = { harness: "test", model: null, agent: null };
  const spec = service.openProducer("spec", init.id, source).task;
  const proposal = service.submitTask(spec.id, {
    title: "Legacy",
    intent: "Historical",
    waves: [
      {
        key: "w",
        title: "W",
        works: [
          {
            key: "k",
            title: "K",
            description: "D",
            acceptance: ["A"],
            blockedBy: [],
          },
        ],
      },
    ],
  }).task.proposalId as string;
  const review = service.openReview("spec-review", init.id, source).task;
  service.repo.mutate("strip protocol", (state) => {
    const stored = state.tasks.find((entry) => entry.id === review.id);
    if (stored) delete stored.reviewProtocol;
  });
  const submitted = service.submitTask(review.id, {
    decision: "approve",
    selectedProposalId: proposal,
    summary: "Legacy approval",
    candidates: [
      { proposalId: proposal, status: "passed", summary: "Valid", score: 80 },
    ],
  });
  assert.equal(submitted.task.status, "submitted");
  assert.equal(submitted.reviewOutcome, undefined);
});
