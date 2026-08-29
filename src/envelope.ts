import type {
  Operation,
  Proposal,
  ReviewOperation,
  Round,
  State,
  Task,
  TaskEnvelope,
} from "./core.js";
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
    return { init: getInit(state, task.subjectId), proposals: proposals(state, round) };
  }
  const wave = getWave(state, task.subjectId);
  const works = wave.workIds.map((workId) => getWork(state, workId));
  if (task.operation === "plan") {
    return { wave, works, previousReviews: reviews(state, wave.id, "plan-review") };
  }
  if (task.operation === "plan-review") {
    const round = getRound(wave.planRounds, task.round);
    return { wave, works, proposals: proposals(state, round) };
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
  return {
    wave,
    works,
    plan: selectedPlan,
    candidates: proposals(state, round),
    verification: task.verification,
  };
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
        task.status === "submitted",
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
  const multi = task?.contextSnapshots && task.contextSnapshots.length > 1;
  if (operation === "spec") return "Submit a SpecDocument with keyed Waves and Works.";
  if (operation === "plan")
    return "Submit a PlanDocument covering every Work and acceptance ID.";
  if (operation === "build")
    return "Commit a clean implementation in workspace and submit its Work summaries.";
  const multiSuffix = multi
    ? " Report a contextComparison verdict for every supplied profile."
    : "";
  if (operation === "build-review") {
    return comparison
      ? `Compare ${comparison} in the summary, select at most one, and report every acceptance criterion.${multiSuffix}`
      : `Evaluate every candidate, select at most one, and report every acceptance criterion.${multiSuffix}`;
  }
  return comparison
    ? `Compare ${comparison} in the summary; approve with selectedProposalId or return without a selection.${multiSuffix}`
    : `Evaluate every proposal; approve with selectedProposalId or return without a selection.${multiSuffix}`;
}

function contextProfileComparison(state: State, task: Task): string | undefined {
  const round = reviewRound(state, task);
  if (!round) return undefined;
  const profiles = new Set(
    round.proposalIds.map(
      (proposalId) => getProposal(state, proposalId).contextProfile ?? null,
    ),
  );
  if (profiles.size <= 1) return undefined;
  const named = [...profiles]
    .filter((profile): profile is string => profile !== null)
    .sort((left, right) => left.localeCompare(right));
  const namedText = `${named.length === 1 ? "named profile" : "named profiles"} ${named.map((profile) => JSON.stringify(profile)).join(", ")}`;
  return profiles.has(null) ? `${namedText} versus null (no context)` : namedText;
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
