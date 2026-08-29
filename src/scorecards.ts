import type { ProducerOperation, ReviewOperation, State, Task } from "./core.js";
import { CodePatrolError, ERROR_CODES } from "./errors.js";
import { getProposal, getWave, getWork } from "./selectors.js";

export const SCORECARD_ANCHORS = [0, 25, 50, 75, 100] as const;

export interface RubricCategory {
  category: string;
  weight: number;
}

export interface Rubric {
  version: string;
  categories: RubricCategory[];
}

export const RUBRICS: Record<string, Rubric> = {
  "spec-v1": {
    version: "spec-v1",
    categories: [
      { category: "intent-alignment", weight: 25 },
      { category: "scope-completeness", weight: 20 },
      { category: "work-slicing", weight: 15 },
      { category: "acceptance-testability", weight: 20 },
      { category: "domain-fit", weight: 10 },
      { category: "architectural-fit", weight: 10 },
    ],
  },
  "plan-v1": {
    version: "plan-v1",
    categories: [
      { category: "acceptance-traceability", weight: 25 },
      { category: "executability", weight: 20 },
      { category: "technical-feasibility", weight: 15 },
      { category: "verification-strategy", weight: 20 },
      { category: "minimality", weight: 10 },
      { category: "architectural-fit", weight: 10 },
    ],
  },
  "build-v1": {
    version: "build-v1",
    categories: [
      { category: "acceptance-fulfillment", weight: 30 },
      { category: "plan-fidelity", weight: 15 },
      { category: "test-quality", weight: 15 },
      { category: "verification-evidence", weight: 15 },
      { category: "minimality", weight: 10 },
      { category: "repository-fit", weight: 15 },
    ],
  },
} as const;

export function rubricFor(operation: ReviewOperation): Rubric {
  const version = `${producerFor(operation)}-v1`;
  const rubric = RUBRICS[version];
  if (!rubric)
    throw new CodePatrolError(ERROR_CODES.INTERNAL, `no rubric for ${operation}`);
  return rubric;
}

export function producerFor(operation: ReviewOperation): ProducerOperation {
  return operation.replace("-review", "") as ProducerOperation;
}

export function rubricCategories(rubricVersion: string): string[] {
  const rubric = RUBRICS[rubricVersion];
  if (!rubric)
    throw new CodePatrolError(ERROR_CODES.INTERNAL, `no rubric ${rubricVersion}`);
  return rubric.categories.map((entry) => entry.category);
}

export function totalFor(rubric: Rubric, levels: number[]): number {
  let weighted = 0;
  rubric.categories.forEach((entry, index) => {
    weighted += entry.weight * (levels[index] ?? 0);
  });
  return Math.floor((weighted + 50) / 100);
}

export interface ReviewProtocol {
  rubricVersion: string;
  rubric: Rubric;
  anchors: number[];
  labels: Record<string, string>;
  auditProvenance: Record<string, string>;
  evidenceCatalog: string[];
}

export function buildReviewProtocol(
  state: State,
  task: Task,
  proposalIds: string[],
): ReviewProtocol {
  const rubric = rubricFor(task.operation as ReviewOperation);
  const sorted = [...proposalIds].sort((left, right) => left.localeCompare(right));
  const labels: Record<string, string> = {};
  const auditProvenance: Record<string, string> = {};
  sorted.forEach((proposalId, index) => {
    const label = `C${String(index + 1).padStart(2, "0")}`;
    labels[proposalId] = label;
    auditProvenance[label] = proposalId;
  });
  return {
    rubricVersion: rubric.version,
    rubric,
    anchors: [...SCORECARD_ANCHORS],
    labels,
    auditProvenance,
    evidenceCatalog: buildEvidenceCatalog(state, task, proposalIds),
  };
}

function buildEvidenceCatalog(
  state: State,
  task: Task,
  proposalIds: string[],
): string[] {
  const refs: string[] = [];
  for (const proposalId of proposalIds) refs.push(`proposal:${proposalId}`);
  if (task.operation === "build-review") {
    const wave = getWave(state, task.subjectId);
    for (const workId of wave.workIds) {
      for (const acceptance of getWork(state, workId).acceptance)
        refs.push(`acceptance:${acceptance.id}`);
    }
  }
  for (const entry of task.verification) refs.push(`verification:${entry.proposalId}`);
  for (const snapshot of task.contextSnapshots ?? [])
    refs.push(`context:${snapshot.profile}`);
  for (const artifact of task.contextProfileArtifacts ?? [])
    refs.push(`artifact:${artifact.profile}`);
  for (const proposalId of proposalIds) {
    const candidate = getProposal(state, proposalId).candidate;
    if (candidate) refs.push(`repository:${candidate.commit}`);
  }
  return [...new Set(refs)].sort((left, right) => left.localeCompare(right));
}

export interface ScorecardAssessment {
  category: string;
  level: number;
  rationale: string;
  evidenceRefs: string[];
}

export interface CandidateScorecard {
  rubricVersion: string;
  assessments: ScorecardAssessment[];
}

export function validateScorecard(
  protocol: ReviewProtocol,
  scorecard: CandidateScorecard,
): void {
  if (scorecard.rubricVersion !== protocol.rubricVersion) {
    throw new CodePatrolError(
      ERROR_CODES.INVALID_RESULT,
      `scorecard rubricVersion ${scorecard.rubricVersion} does not match ${protocol.rubricVersion}`,
    );
  }
  const expected = protocol.rubric.categories.map((entry) => entry.category);
  const actual = scorecard.assessments.map((entry) => entry.category);
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    throw new CodePatrolError(
      ERROR_CODES.INVALID_RESULT,
      `scorecard assessments must cover every category exactly once in rubric order`,
    );
  }
  const catalog = new Set(protocol.evidenceCatalog);
  for (const assessment of scorecard.assessments) {
    if (!assessment.rationale.trim()) {
      throw new CodePatrolError(
        ERROR_CODES.INVALID_RESULT,
        `scorecard assessment ${assessment.category} requires a nonempty rationale`,
      );
    }
    if (!protocol.anchors.includes(assessment.level)) {
      throw new CodePatrolError(
        ERROR_CODES.INVALID_RESULT,
        `scorecard assessment ${assessment.category} level ${assessment.level} is not an anchor`,
      );
    }
    for (let index = 0; index < assessment.evidenceRefs.length; index += 1) {
      const ref = assessment.evidenceRefs[index] as string;
      if (
        index > 0 &&
        (assessment.evidenceRefs[index - 1] as string).localeCompare(ref) >= 0
      ) {
        throw new CodePatrolError(
          ERROR_CODES.INVALID_RESULT,
          `scorecard assessment ${assessment.category} evidenceRefs must be sorted and unique`,
        );
      }
      if (!catalog.has(ref)) {
        throw new CodePatrolError(
          ERROR_CODES.INVALID_RESULT,
          `scorecard assessment ${assessment.category} references unknown evidence ${ref}`,
        );
      }
    }
  }
}

export interface RankedCandidate {
  label: string;
  proposalId: string;
  total: number;
  levels: number[];
  rank: number;
  effectivePassed: boolean;
  decidingComparator: string | null;
}

export interface ReviewOutcome {
  rubricVersion: string;
  hardGateStatus: "passed" | "failed" | "blocked";
  candidates: RankedCandidate[];
  winner: string | null;
  decidingComparator: string | null;
  execution: { descriptors: string[] };
  digestClasses: Record<string, string>;
}

export function computeReviewOutcome(
  state: State,
  task: Task,
  protocol: ReviewProtocol,
  verdicts: Array<{
    proposalId: string;
    status: "passed" | "failed";
    scorecard: CandidateScorecard;
  }>,
): ReviewOutcome {
  const rubric = protocol.rubric;
  const verification = new Map(
    task.verification.map((entry) => [entry.proposalId, entry.status]),
  );
  const ranked: RankedCandidate[] = verdicts.map((verdict) => {
    const levels = rubric.categories.map(
      (entry) =>
        verdict.scorecard.assessments.find(
          (assessment) => assessment.category === entry.category,
        )?.level ?? 0,
    );
    const verificationStatus = verification.get(verdict.proposalId);
    const effectivePassed =
      verdict.status === "passed" &&
      (task.operation !== "build-review" || verificationStatus === "passed");
    return {
      label: protocol.labels[verdict.proposalId] ?? verdict.proposalId,
      proposalId: verdict.proposalId,
      total: totalFor(rubric, levels),
      levels,
      rank: 0,
      effectivePassed,
      decidingComparator: null,
    };
  });
  ranked.sort((left, right) => compareCandidates(left, right).order);
  ranked.forEach((candidate, index) => {
    candidate.rank = index + 1;
    const next = ranked[index + 1];
    candidate.decidingComparator = next
      ? compareCandidates(candidate, next).comparator
      : null;
  });
  const passing = ranked.filter((candidate) => candidate.effectivePassed);
  const winner = passing[0]?.label ?? null;
  const decidingComparator = winner ? (ranked[0]?.decidingComparator ?? null) : null;
  const hardGateStatus = hardGateFor(state, task, verdicts);
  return {
    rubricVersion: protocol.rubricVersion,
    hardGateStatus,
    candidates: ranked,
    winner,
    decidingComparator,
    execution: { descriptors: [`rubric ${protocol.rubricVersion}`] },
    digestClasses: {
      rubric: protocol.rubricVersion,
      anchors: protocol.anchors.join(","),
    },
  };
}

function compareCandidates(
  left: RankedCandidate,
  right: RankedCandidate,
): { order: number; comparator: string } {
  if (left.effectivePassed !== right.effectivePassed)
    return {
      order: left.effectivePassed ? -1 : 1,
      comparator: "effective-passed",
    };
  if (left.total !== right.total)
    return { order: right.total - left.total, comparator: "total" };
  for (let index = 0; index < left.levels.length; index += 1) {
    const leftLevel = left.levels[index] ?? 0;
    const rightLevel = right.levels[index] ?? 0;
    if (leftLevel !== rightLevel)
      return { order: rightLevel - leftLevel, comparator: `category:${index}` };
  }
  if (left.proposalId !== right.proposalId)
    return {
      order: left.proposalId.localeCompare(right.proposalId),
      comparator: "proposal-id",
    };
  return { order: 0, comparator: "tie" };
}

function hardGateFor(
  _state: State,
  task: Task,
  verdicts: Array<{ proposalId: string; status: "passed" | "failed" }>,
): "passed" | "failed" | "blocked" {
  if (task.operation !== "build-review") return "passed";
  const infrastructure = task.verification.some(
    (entry) => entry.status === "infrastructure-failed",
  );
  if (infrastructure) return "blocked";
  const selected = verdicts.find((entry) => entry.status === "passed");
  if (!selected) return "failed";
  const verificationStatus = task.verification.find(
    (entry) => entry.proposalId === selected.proposalId,
  )?.status;
  if (verificationStatus !== "passed") return "failed";
  return "passed";
}
