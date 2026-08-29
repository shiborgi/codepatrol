import {
  type BuildReview,
  type DocumentReview,
  type Init,
  newRound,
  type Operation,
  type ProducerOperation,
  type Proposal,
  planDocumentSchema,
  producerFor,
  type State,
  specDocumentSchema,
  type Task,
} from "../core.js";
import { assertDomain, CodePatrolError, ERROR_CODES } from "../errors.js";
import { getInit, getProposal, getRound, getWave, roundsFor } from "../selectors.js";
import {
  assertCandidateVerdicts,
  validateBuildApproval,
  validateContextComparison,
  validatePlan,
} from "../validators.js";
import { resultAs } from "./results.js";

function isProducer(operation: Operation): operation is ProducerOperation {
  return ["spec", "plan", "build"].includes(operation);
}

export function applyReview(
  state: State,
  task: Task,
  result: DocumentReview | BuildReview,
  maxReviewReturns: number,
): Array<{ ref: string; commit: string }> {
  assertDomain(
    !isProducer(task.operation),
    ERROR_CODES.INVALID_TASK,
    "producer task is not a review",
  );
  const operation = task.operation;
  const producer = producerFor(operation);
  const round = getRound(roundsFor(state, producer, task.subjectId), task.round);
  assertDomain(
    round.status === "reviewing",
    ERROR_CODES.ROUND_NOT_REVIEWING,
    "round is not under review",
  );
  if (operation === "spec-review") {
    assertDomain(
      getInit(state, task.subjectId).status === "specifying",
      ERROR_CODES.INVALID_STAGE,
      "Init left Spec while this review was open",
    );
  } else {
    const expected = operation === "plan-review" ? "planning" : "building";
    assertDomain(
      getWave(state, task.subjectId).status === expected,
      ERROR_CODES.INVALID_STAGE,
      `Wave left ${expected} while this review was open`,
    );
  }
  assertCandidateVerdicts(round, result);
  validateContextComparison(task, result as unknown as Record<string, unknown>);
  const decision = result.decision;
  const selected = result.selectedProposalId;
  if (decision === "approve") {
    assertDomain(
      selected,
      ERROR_CODES.SELECTION_REQUIRED,
      "approval requires selectedProposalId",
    );
    assertDomain(
      round.proposalIds.includes(selected),
      ERROR_CODES.INVALID_SELECTION,
      "selected proposal is not in round",
    );
    const verdict = result.candidates.find((entry) => entry.proposalId === selected);
    assertDomain(
      verdict?.status === "passed",
      ERROR_CODES.SELECTED_CANDIDATE_FAILED,
      "selected proposal did not pass review",
    );
    if (task.reviewProtocol && task.reviewOutcome) {
      const passing = task.reviewOutcome.candidates.filter(
        (candidate) => candidate.effectivePassed,
      );
      assertDomain(
        passing.length > 0,
        ERROR_CODES.SELECTED_CANDIDATE_FAILED,
        "no candidate passed review",
      );
      const selectedOutcome = task.reviewOutcome.candidates.find(
        (candidate) => candidate.proposalId === selected,
      );
      assertDomain(
        selectedOutcome?.rank === 1,
        ERROR_CODES.INVALID_SELECTION,
        "approval must select the rank-one candidate",
      );
    }
    round.status = "approved";
    round.selectedProposalId = selected;
    if (operation === "spec-review") {
      materializeSpec(
        state,
        getInit(state, task.subjectId),
        getProposal(state, selected),
      );
    } else if (operation === "plan-review") {
      const wave = getWave(state, task.subjectId);
      const plan = resultAs(getProposal(state, selected).document, planDocumentSchema);
      validatePlan(state, wave, plan);
      wave.selectedPlanId = selected;
      wave.status = "building";
      wave.buildRounds.push(newRound("build", 1));
    } else {
      const wave = getWave(state, task.subjectId);
      if (!("acceptance" in result)) {
        throw new CodePatrolError(
          ERROR_CODES.INTERNAL,
          "build review result has no acceptance evidence",
        );
      }
      validateBuildApproval(state, wave, task, result, selected);
      wave.selectedBuildId = selected;
      wave.status = "ready-to-ship";
    }
  } else {
    assertDomain(
      !selected,
      ERROR_CODES.INVALID_SELECTION,
      "return must not select a proposal",
    );
    round.status = "returned";
    if (operation === "spec-review") {
      const init = getInit(state, task.subjectId);
      init.reviewReturns += 1;
      if (init.reviewReturns < maxReviewReturns) {
        init.specRounds.push(newRound("spec", init.specRounds.length + 1));
      }
    } else {
      const wave = getWave(state, task.subjectId);
      const key = producer === "plan" ? "plan" : "build";
      wave.reviewReturns[key] += 1;
      if (wave.reviewReturns[key] < maxReviewReturns) {
        const rounds = producer === "plan" ? wave.planRounds : wave.buildRounds;
        rounds.push(newRound(producer, rounds.length + 1));
      }
    }
  }
  if (operation !== "build-review" || decision === "return") return [];
  return round.proposalIds
    .filter((proposalId) => proposalId !== round.selectedProposalId)
    .map((proposalId) => getProposal(state, proposalId).candidate)
    .filter((candidate): candidate is NonNullable<Proposal["candidate"]> =>
      Boolean(candidate),
    )
    .map((candidate) => ({ ref: candidate.ref, commit: candidate.commit }));
}

export function materializeSpec(state: State, init: Init, proposal: Proposal): void {
  const document = resultAs(proposal.document, specDocumentSchema);
  const workKeys = new Map<string, string>();
  document.waves.forEach((wave, waveIndex) => {
    wave.works.forEach((work, workIndex) => {
      workKeys.set(
        work.key,
        `WORK-${init.id.slice(5)}.${waveIndex + 1}.${workIndex + 1}`,
      );
    });
  });
  document.waves.forEach((definition, waveIndex) => {
    const waveId = `WAVE-${init.id.slice(5)}.${waveIndex + 1}`;
    const workIds: string[] = [];
    definition.works.forEach((definitionWork, workIndex) => {
      const workId = `WORK-${init.id.slice(5)}.${waveIndex + 1}.${workIndex + 1}`;
      workIds.push(workId);
      state.works.push({
        id: workId,
        waveId,
        key: definitionWork.key,
        title: definitionWork.title,
        description: definitionWork.description,
        acceptance: definitionWork.acceptance.map((text, acceptanceIndex) => ({
          id: `AC-${init.id.slice(5)}.${waveIndex + 1}.${workIndex + 1}.${acceptanceIndex + 1}`,
          text,
        })),
        blockedBy: definitionWork.blockedBy.map((key) => workKeys.get(key) as string),
        status: "pending",
      });
    });
    state.waves.push({
      id: waveId,
      initId: init.id,
      title: definition.title,
      status: "planning",
      workIds,
      planRounds: [newRound("plan", 1)],
      buildRounds: [],
      selectedPlanId: null,
      selectedBuildId: null,
      reviewReturns: { plan: 0, build: 0 },
      ship: null,
    });
    init.waveIds.push(waveId);
  });
  init.selectedSpecId = proposal.id;
  init.status = "active";
}
