import type {
  ArbitrationResult,
  BuildReview,
  DocumentReview,
  ReviewOperation,
  Round,
  State,
  Task,
} from "./core.js";
import { CodePatrolError, ERROR_CODES } from "./errors.js";
import {
  ensureRoutingMemory,
  makeObservationKey,
  makeRouteKey,
  recordObservation,
} from "./orchestrator.js";
import { getProposal, getRound, getWave, roundsFor } from "./selectors.js";
import { applyReview } from "./service/review.js";
import {
  assertCandidateVerdicts,
  validateBuildApproval,
  validateContextComparison,
} from "./validators.js";

export function isReviewAttempt(task: Task): boolean {
  return task.reviewRole === "attempt";
}

export function isArbitrationTask(task: Task): boolean {
  return task.reviewRole === "arbitration";
}

export function isAuthoritativeReview(task: Task): boolean {
  return task.reviewRole !== "attempt" && task.reviewRole !== "arbitration";
}

export function attemptTasks(state: State, batchId: string | undefined): Task[] {
  if (!batchId) return [];
  return state.tasks
    .filter((task) => task.reviewBatchId === batchId && isReviewAttempt(task))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function reviewRoundFor(state: State, task: Task): Round {
  return getRound(roundsFor(state, producerOp(task), task.subjectId), task.round);
}

function producerOp(task: Task): "spec" | "plan" | "build" {
  if (task.operation === "spec-review") return "spec";
  if (task.operation === "plan-review") return "plan";
  return "build";
}

export function attemptIsTerminal(task: Task): boolean {
  return ["submitted", "failed", "cancelled"].includes(task.status);
}

export function hostQualityTotal(task: Task): number {
  const ranked = task.reviewOutcome?.candidates.find(
    (candidate) => candidate.rank === 1,
  );
  return ranked?.total ?? 0;
}

export function pickConsensusAttempt(valid: Task[]): Task {
  const ranked = [...valid].sort((left, right) => {
    const quality = hostQualityTotal(right) - hostQualityTotal(left);
    if (quality !== 0) return quality;
    return left.id.localeCompare(right.id);
  });
  const selected = ranked[0];
  if (!selected) {
    throw new CodePatrolError(
      ERROR_CODES.INSUFFICIENT_VALID_ATTEMPTS,
      "no valid review attempt available",
    );
  }
  return selected;
}

export function attemptsAgree(valid: Task[]): boolean {
  if (valid.length === 0) return false;
  const first = reviewDecision(valid[0] as Task);
  return valid.every((task) => {
    const next = reviewDecision(task);
    return (
      next.decision === first.decision &&
      next.selectedProposalId === first.selectedProposalId
    );
  });
}

export function reviewDecision(task: Task): {
  decision: string | null;
  selectedProposalId: string | null;
} {
  const result = task.result as DocumentReview | BuildReview | null;
  if (!result || typeof result !== "object")
    return { decision: null, selectedProposalId: null };
  return {
    decision: result.decision ?? null,
    selectedProposalId: result.selectedProposalId ?? null,
  };
}

export function evaluateAttempt(
  state: State,
  task: Task,
  result: DocumentReview | BuildReview,
): { valid: boolean; reason?: string } {
  try {
    const round = reviewRoundFor(state, task);
    assertCandidateVerdicts(round, result);
    validateContextComparison(task, result as unknown as Record<string, unknown>);
    if (result.decision === "approve") {
      if (!result.selectedProposalId)
        return { valid: false, reason: "selection-required" };
      if (!round.proposalIds.includes(result.selectedProposalId))
        return { valid: false, reason: "invalid-selection" };
      const verdict = result.candidates.find(
        (entry) => entry.proposalId === result.selectedProposalId,
      );
      if (verdict?.status !== "passed")
        return { valid: false, reason: "selected-failed" };
      if (task.reviewOutcome) {
        const passing = task.reviewOutcome.candidates.filter(
          (candidate) => candidate.effectivePassed,
        );
        if (passing.length === 0) return { valid: false, reason: "hard-gate" };
        const selectedOutcome = task.reviewOutcome.candidates.find(
          (candidate) => candidate.proposalId === result.selectedProposalId,
        );
        if (selectedOutcome?.rank !== 1) return { valid: false, reason: "rank-one" };
        if (task.reviewOutcome.hardGateStatus !== "passed")
          return { valid: false, reason: "hard-gate" };
      }
      if (task.operation === "build-review") {
        if (!("acceptance" in result))
          return { valid: false, reason: "acceptance-coverage" };
        validateBuildApproval(
          state,
          getWave(state, task.subjectId),
          task,
          result,
          result.selectedProposalId,
        );
      }
    } else if (result.selectedProposalId) {
      return { valid: false, reason: "return-selected" };
    }
    return { valid: true };
  } catch (error) {
    const reason =
      error instanceof CodePatrolError ? error.code.toLowerCase() : "invalid-attempt";
    return { valid: false, reason };
  }
}

export function isValidStoredAttempt(state: State, task: Task): boolean {
  if (task.status !== "submitted" || !task.result || !isReviewAttempt(task))
    return false;
  const result = task.result as DocumentReview | BuildReview;
  if (!result.decision) return false;
  return evaluateAttempt(state, task, result).valid;
}

export function arbitrationEnvelopeInput(state: State, task: Task): unknown {
  const round = reviewRoundFor(state, task);
  const attempts = attemptTasks(
    state,
    task.reviewBatchId ?? round.reviewBatchId ?? undefined,
  );
  return {
    attempts: attempts.map((attempt, index) => {
      const decision = reviewDecision(attempt);
      const outcome = attempt.reviewOutcome;
      return {
        label: `A${String(index + 1).padStart(2, "0")}`,
        attemptId: attempt.id,
        decision: decision.decision,
        selectedProposalId: decision.selectedProposalId,
        hardGateStatus: outcome?.hardGateStatus ?? null,
        hostTotal: hostQualityTotal(attempt),
        acceptanceCoverage: Array.isArray(
          (attempt.result as BuildReview | null)?.acceptance,
        )
          ? (attempt.result as BuildReview).acceptance.map((entry) => ({
              id: entry.id,
              status: entry.status,
            }))
          : [],
        evidenceRefs: attempt.reviewProtocol?.evidenceCatalog ?? [],
        verification: attempt.verification.map((entry) => ({
          proposalId: entry.proposalId,
          status: entry.status,
        })),
        valid: isValidStoredAttempt(state, attempt),
      };
    }),
    proposalSet: round.proposalIds.map((proposalId) => ({
      label: task.reviewProtocol?.labels[proposalId] ?? proposalId,
      proposalId,
    })),
  };
}

export function applySelectedAttempt(
  state: State,
  attempt: Task,
  maxReviewReturns: number,
): Array<{ ref: string; commit: string }> {
  const result = attempt.result as DocumentReview | BuildReview;
  const gates = evaluateAttempt(state, attempt, result);
  if (!gates.valid) {
    throw new CodePatrolError(
      ERROR_CODES.ARBITRATION_INVALID,
      `selected attempt fails host gates: ${gates.reason ?? "invalid"}`,
    );
  }
  const refs = applyReview(state, attempt, result, maxReviewReturns);
  const round = reviewRoundFor(state, attempt);
  round.reviewTaskId = attempt.id;
  return refs;
}

export function routeKeyForTask(task: Task): string {
  return makeRouteKey({
    agentRef: task.source.agent ?? "none",
    agentVersion: task.source.agentVersion ?? "0.0.0",
    contextProfile: task.contextSnapshot?.profile ?? null,
  });
}

export function recordReviewerOutcome(
  state: State,
  task: Task,
  outcome: string,
  extra: {
    hostEffectivePass?: boolean;
    hostRank?: number;
    hostSelected?: boolean;
    hostVerified?: boolean;
    hostReviewScore?: number;
  } = {},
): void {
  const routing = ensureRoutingMemory(state);
  const decisionId = task.routingDecisionId ?? "DEC-none";
  const routeKey = routeKeyForTask(task);
  const observationKey = makeObservationKey(decisionId, routeKey, outcome, task.id);
  const limits = { maxObservations: 100000, maxAggregates: 10000 };
  recordObservation(
    routing,
    {
      observationKey,
      decisionId,
      routeKey,
      taskId: task.id,
      proposalId: extra.hostSelected ? reviewDecision(task).selectedProposalId : null,
      outcome,
      createdAt: task.finishedAt ?? task.createdAt,
      ...extra,
    },
    task.operation as ReviewOperation,
    "general",
    limits.maxObservations,
    limits.maxAggregates,
    {
      observationCount: 1,
      ...(extra.hostEffectivePass ? { effectivePassCount: 1 } : {}),
      ...(extra.hostSelected ? { selectedCount: 1 } : {}),
      ...(extra.hostVerified ? { verifiedCount: 1 } : {}),
      ...(extra.hostReviewScore ? { reviewScoreTotal: extra.hostReviewScore } : {}),
    },
  );
}

export function recordShipOutcome(
  state: State,
  waveId: string,
  decision: "accept" | "rollback",
): void {
  const wave = getWave(state, waveId);
  const proposal = wave.selectedBuildId
    ? getProposal(state, wave.selectedBuildId)
    : undefined;
  if (!proposal) return;
  const producer = state.tasks.find((task) => task.id === proposal.taskId);
  if (producer)
    recordReviewerOutcome(
      state,
      producer,
      decision === "accept" ? "accepted" : "rolled-back",
    );
  const review = state.tasks.find(
    (task) =>
      task.operation === "build-review" &&
      task.subjectId === waveId &&
      task.round ===
        (wave.buildRounds.find(
          (round) => round.selectedProposalId === wave.selectedBuildId,
        )?.number ?? task.round) &&
      isAuthoritativeReview(task) &&
      task.status === "submitted",
  );
  if (review)
    recordReviewerOutcome(
      state,
      review,
      decision === "accept" ? "accepted" : "rolled-back",
    );
}

export function validateArbitrationSelection(
  state: State,
  arbitration: Task,
  result: ArbitrationResult,
): Task {
  const attempt = state.tasks.find((task) => task.id === result.selectedAttemptId);
  if (
    !attempt ||
    !isReviewAttempt(attempt) ||
    attempt.reviewBatchId !== arbitration.reviewBatchId
  ) {
    throw new CodePatrolError(
      ERROR_CODES.ARBITRATION_INVALID,
      "arbiter must select exactly one valid review-attempt id from this batch",
    );
  }
  if (!isValidStoredAttempt(state, attempt)) {
    throw new CodePatrolError(
      ERROR_CODES.ARBITRATION_INVALID,
      "selected attempt is not host-valid",
    );
  }
  const stored = attempt.result as DocumentReview | BuildReview;
  const gates = evaluateAttempt(state, attempt, stored);
  if (!gates.valid) {
    throw new CodePatrolError(
      ERROR_CODES.ARBITRATION_INVALID,
      `selected attempt fails host gates: ${gates.reason ?? "invalid"}`,
    );
  }
  return attempt;
}
