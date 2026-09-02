import type {
  Operation,
  Proposal,
  ReviewOperation,
  Round,
  State,
  Task,
  TaskEnvelope,
} from "./core.js";
import {
  arbitrationEnvelopeInput,
  isArbitrationTask,
  isAuthoritativeReview,
} from "./review-orchestration.js";
import { getInit, getProposal, getRound, getWave, getWork } from "./selectors.js";

export function taskEnvelope(state: State, task: Task): TaskEnvelope {
  return {
    task: taskWithoutInstructions(task),
    input: taskInput(state, task),
    resultContract: contractFor(task.operation, state, task),
    ...(task.agentInstructions === undefined
      ? {}
      : { agentInstructions: task.agentInstructions }),
    ...(task.contextSnapshot === undefined
      ? {}
      : { contextSnapshot: task.contextSnapshot }),
    ...(task.contextProfileArtifacts === undefined
      ? {}
      : { contextProfileArtifacts: task.contextProfileArtifacts }),
    ...(task.execution === undefined ? {} : { execution: task.execution }),
    ...(task.fingerprint === undefined ? {} : { fingerprint: task.fingerprint }),
    ...(task.reviewProtocol === undefined
      ? {}
      : { reviewProtocol: task.reviewProtocol }),
    ...(task.reviewOutcome === undefined ? {} : { reviewOutcome: task.reviewOutcome }),
  };
}

function taskInput(state: State, task: Task): unknown {
  if (task.operation === "spec") {
    const init = getInit(state, task.subjectId);
    return {
      init: { id: init.id, title: init.title, brief: init.brief },
      previousReviews: reviews(state, init.id, "spec-review"),
    };
  }
  if (task.operation === "spec-review") {
    const round = getRound(getInit(state, task.subjectId).specRounds, task.round);
    if (isArbitrationTask(task)) return arbitrationEnvelopeInput(state, task);
    return {
      init: getInit(state, task.subjectId),
      proposals: proposals(state, round),
      candidates: anonymizedCandidates(state, task, round),
      ...reviewContext(task),
    };
  }
  const wave = getWave(state, task.subjectId);
  const works = wave.workIds.map((workId) => getWork(state, workId));
  if (task.operation === "plan") {
    return { wave, works, previousReviews: reviews(state, wave.id, "plan-review") };
  }
  if (task.operation === "plan-review") {
    const round = getRound(wave.planRounds, task.round);
    if (isArbitrationTask(task)) return arbitrationEnvelopeInput(state, task);
    return {
      wave,
      works,
      proposals: proposals(state, round),
      candidates: anonymizedCandidates(state, task, round),
      ...reviewContext(task),
    };
  }
  const selectedPlan = wave.selectedPlanId
    ? getProposal(state, wave.selectedPlanId)
    : null;
  if (task.operation === "build") {
    return {
      wave,
      works,
      plan: selectedPlan,
      workspace: task.workspace,
      baseCommit: task.baseCommit,
      previousReviews: reviews(state, wave.id, "build-review"),
    };
  }
  const round = getRound(wave.buildRounds, task.round);
  if (isArbitrationTask(task)) return arbitrationEnvelopeInput(state, task);
  return {
    wave,
    works,
    plan: selectedPlan,
    candidates: proposals(state, round),
    anonymizedCandidates: anonymizedCandidates(state, task, round),
    verification: task.verification,
    ...reviewContext(task),
  };
}

function reviewContext(task: Task): Record<string, unknown> {
  const artifacts = task.contextProfileArtifacts ?? [];
  if (artifacts.length <= 1) return {};
  return {
    contextProfiles: artifacts.map((artifact) => artifact.profile),
    contextProfileArtifacts: artifacts,
    scorecardDimensions: task.reviewProtocol?.dimensions ?? [],
  };
}

function anonymizedCandidates(
  _state: State,
  task: Task,
  round: Round,
): Array<{ label: string; proposalId: string }> {
  const protocol = task.reviewProtocol;
  if (!protocol) return [];
  return round.proposalIds.map((proposalId) => ({
    label: protocol.labels[proposalId] ?? proposalId,
    proposalId,
  }));
}

function proposals(state: State, round: Round): Proposal[] {
  return round.proposalIds.map((proposalId) => {
    const proposal = getProposal(state, proposalId);
    return { ...proposal, contextProfile: proposal.contextProfile ?? null };
  });
}

function reviews(state: State, subjectId: string, operation: ReviewOperation): Task[] {
  return state.tasks
    .filter(
      (task) =>
        task.subjectId === subjectId &&
        task.operation === operation &&
        task.status === "submitted" &&
        isAuthoritativeReview(task),
    )
    .map(taskWithoutInstructions);
}

export function taskWithoutInstructions(task: Task): Task {
  const sanitized = structuredClone(task);
  delete sanitized.agentInstructions;
  delete sanitized.contextSnapshot;
  delete sanitized.contextSnapshots;
  delete sanitized.contextProfileArtifacts;
  return sanitized;
}
export function contractFor(operation: Operation, state?: State, task?: Task): string {
  const comparison = state && task ? contextProfileComparison(state, task) : undefined;
  const multi =
    (task?.contextProfileArtifacts?.length ?? task?.contextSnapshots?.length ?? 0) > 1;
  const scorecardSuffix = multi
    ? " Include the protocol's ordered stage scorecard dimensions."
    : "";
  if (operation === "spec") return "Submit a SpecDocument with keyed Waves and Works.";
  if (operation === "plan")
    return "Submit a PlanDocument covering every Work and acceptance ID.";
  if (operation === "build")
    return "Commit a clean implementation in workspace and submit its Work summaries.";
  if (task?.reviewRole === "arbitration")
    return "Select exactly one valid review-attempt id and an evidence-based rationale. Do not rewrite a review.";
  const multiSuffix = multi
    ? " Report a contextComparison verdict for every supplied profile."
    : "";
  if (operation === "build-review") {
    return comparison
      ? `Compare ${comparison} in the summary, select at most one, and report every acceptance criterion.${multiSuffix}${scorecardSuffix}`
      : `Evaluate every candidate, select at most one, and report every acceptance criterion.${multiSuffix}${scorecardSuffix}`;
  }
  return comparison
    ? `Compare ${comparison} in the summary; approve with selectedProposalId or return without a selection.${multiSuffix}${scorecardSuffix}`
    : `Evaluate every proposal; approve with selectedProposalId or return without a selection.${multiSuffix}${scorecardSuffix}`;
}

function contextProfileComparison(state: State, task: Task): string | undefined {
  const round = reviewRound(state, task);
  if (!round) return undefined;
  const supplied = task.contextProfileArtifacts;
  const profiles =
    supplied && supplied.length > 1
      ? new Set(supplied.map((artifact) => artifact.profile))
      : new Set(
          round.proposalIds.map(
            (proposalId) => getProposal(state, proposalId).contextProfile ?? null,
          ),
        );
  if (profiles.size <= 1) return undefined;
  const named = [...profiles]
    .filter((profile): profile is string => profile !== null)
    .sort(compareLexical);
  const namedText = `${named.length === 1 ? "named profile" : "named profiles"} ${named.map((profile) => JSON.stringify(profile)).join(", ")}`;
  return profiles.has(null) ? `${namedText} versus null (no context)` : namedText;
}

function compareLexical(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function reviewRound(state: State, task: Task): Round | undefined {
  if (task.operation === "spec-review")
    return getRound(getInit(state, task.subjectId).specRounds, task.round);
  if (task.operation === "plan-review" || task.operation === "build-review") {
    const wave = getWave(state, task.subjectId);
    return getRound(
      task.operation === "plan-review" ? wave.planRounds : wave.buildRounds,
      task.round,
    );
  }
  return undefined;
}
