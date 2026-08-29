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

export function totalFor(rubric: Rubric | StageDimension[], levels: number[]): number {
  const categories = Array.isArray(rubric) ? rubric : rubric.categories;
  const totalWeight = categories.reduce((sum, entry) => sum + entry.weight, 0);
  let weighted = 0;
  categories.forEach((entry, index) => {
    weighted += entry.weight * (levels[index] ?? 0);
  });
  return Math.floor((weighted + totalWeight / 2) / totalWeight);
}

export interface StageDimension {
  dimension: string;
  weight: number;
}

export const STAGE_DIMENSIONS: Record<ReviewOperation, StageDimension[]> = {
  "spec-review": [
    { dimension: "scope-coverage", weight: 25 },
    { dimension: "requirement-grounding", weight: 25 },
    { dimension: "acceptance-clarity", weight: 25 },
    { dimension: "unresolved-ambiguity", weight: 25 },
  ],
  "plan-review": [
    { dimension: "acceptance-mapping", weight: 25 },
    { dimension: "code-locality", weight: 25 },
    { dimension: "dependency-risk-coverage", weight: 25 },
    { dimension: "verification-specificity", weight: 25 },
  ],
  "build-review": [
    { dimension: "acceptance-evidence", weight: 25 },
    { dimension: "test-verification-evidence", weight: 25 },
    { dimension: "regression-risk", weight: 25 },
    { dimension: "change-scope", weight: 25 },
  ],
};

export function stageDimensionsFor(operation: ReviewOperation): StageDimension[] {
  return STAGE_DIMENSIONS[operation].map((dimension) => ({ ...dimension }));
}

export interface ReviewProtocol {
  rubricVersion: string;
  rubric: Rubric;
  operation?: ReviewOperation;
  dimensions?: StageDimension[];
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
  const operation = task.operation as ReviewOperation;
  const sorted = [...proposalIds].sort(compareLexical);
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
    operation,
    dimensions: stageDimensionsFor(operation),
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
  return [...new Set(refs)].sort(compareLexical);
}

export interface ScorecardAssessment {
  category: string;
  level: number;
  rationale: string;
  evidenceRefs: string[];
}

export interface StageScorecardAssessment {
  dimension: string;
  level: number;
  rationale: string;
  evidenceRefs: string[];
}

export type CandidateScorecard =
  // Keep the WAVE-12.2 rubric shape readable while new reviews use stage dimensions.
  | {
      rubricVersion: string;
      assessments: ScorecardAssessment[];
    }
  | {
      operation: ReviewOperation;
      dimensions: StageScorecardAssessment[];
      rubricVersion?: string;
    };

function isStageScorecard(
  scorecard: CandidateScorecard,
): scorecard is Extract<
  CandidateScorecard,
  { dimensions: StageScorecardAssessment[] }
> {
  return "dimensions" in scorecard;
}

export function validateScorecard(
  protocol: ReviewProtocol,
  scorecard: CandidateScorecard,
): void {
  if (isStageScorecard(scorecard)) {
    validateStageScorecard(protocol, scorecard);
    return;
  }
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
    validateEvidenceRefs(assessment.category, assessment.evidenceRefs, catalog);
  }
}

function validateStageScorecard(
  protocol: ReviewProtocol,
  scorecard: Extract<CandidateScorecard, { dimensions: StageScorecardAssessment[] }>,
): void {
  const expected = protocol.dimensions ?? [];
  if (scorecard.operation !== protocol.operation || expected.length === 0) {
    throw new CodePatrolError(
      ERROR_CODES.INVALID_RESULT,
      `scorecard operation ${scorecard.operation} does not match the review stage`,
    );
  }
  if (
    scorecard.rubricVersion !== undefined &&
    scorecard.rubricVersion !== protocol.rubricVersion
  ) {
    throw new CodePatrolError(
      ERROR_CODES.INVALID_RESULT,
      `scorecard rubricVersion ${scorecard.rubricVersion} does not match ${protocol.rubricVersion}`,
    );
  }
  const actual = scorecard.dimensions.map((entry) => entry.dimension);
  const expectedNames = expected.map((entry) => entry.dimension);
  if (
    actual.length !== expectedNames.length ||
    actual.some((value, index) => value !== expectedNames[index])
  ) {
    throw new CodePatrolError(
      ERROR_CODES.INVALID_RESULT,
      "stage scorecard dimensions must cover every dimension exactly once in stage order",
    );
  }
  const catalog = new Set(protocol.evidenceCatalog);
  for (const assessment of scorecard.dimensions) {
    if (
      !Number.isInteger(assessment.level) ||
      assessment.level < 0 ||
      assessment.level > 100
    ) {
      throw new CodePatrolError(
        ERROR_CODES.INVALID_RESULT,
        `scorecard dimension ${assessment.dimension} level ${assessment.level} is outside 0..100`,
      );
    }
    if (!assessment.rationale.trim()) {
      throw new CodePatrolError(
        ERROR_CODES.INVALID_RESULT,
        `scorecard dimension ${assessment.dimension} requires a nonempty rationale`,
      );
    }
    if (assessment.evidenceRefs.length === 0) {
      throw new CodePatrolError(
        ERROR_CODES.INVALID_RESULT,
        `scorecard dimension ${assessment.dimension} requires evidence`,
      );
    }
    validateEvidenceRefs(assessment.dimension, assessment.evidenceRefs, catalog);
  }
}

function validateEvidenceRefs(
  name: string,
  evidenceRefs: string[],
  catalog: Set<string>,
): void {
  for (let index = 0; index < evidenceRefs.length; index += 1) {
    const ref = evidenceRefs[index] as string;
    if (index > 0 && compareLexical(evidenceRefs[index - 1] as string, ref) >= 0) {
      throw new CodePatrolError(
        ERROR_CODES.INVALID_RESULT,
        `scorecard assessment ${name} evidenceRefs must be sorted and unique`,
      );
    }
    if (!catalog.has(ref)) {
      throw new CodePatrolError(
        ERROR_CODES.INVALID_RESULT,
        `scorecard assessment ${name} references unknown evidence ${ref}`,
      );
    }
  }
}

export function validateScorecards(
  protocol: ReviewProtocol,
  scorecards: CandidateScorecard[],
): void {
  const stage = scorecards[0] ? isStageScorecard(scorecards[0]) : undefined;
  if (
    stage !== undefined &&
    scorecards.some((scorecard) => isStageScorecard(scorecard) !== stage)
  ) {
    throw new CodePatrolError(
      ERROR_CODES.INVALID_RESULT,
      "all candidates in one review must use the same scorecard shape",
    );
  }
  for (const scorecard of scorecards) validateScorecard(protocol, scorecard);
}

export interface RankedCandidate {
  label: string;
  proposalId: string;
  profile: string | null;
  total: number;
  levels: number[];
  rank: number;
  effectivePassed: boolean;
  decidingComparator: string | null;
}

export interface ReviewOutcome {
  rubricVersion: string;
  operation?: ReviewOperation;
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
  validateScorecards(
    protocol,
    verdicts.map((verdict) => verdict.scorecard),
  );
  const ranked: RankedCandidate[] = verdicts.map((verdict) => {
    const normalized = scorecardLevels(protocol, verdict.scorecard);
    const verificationStatus = verification.get(verdict.proposalId);
    const effectivePassed =
      verdict.status === "passed" &&
      (task.operation !== "build-review" || verificationStatus === "passed");
    const profile = getProposal(state, verdict.proposalId).contextProfile ?? null;
    return {
      label: protocol.labels[verdict.proposalId] ?? verdict.proposalId,
      proposalId: verdict.proposalId,
      profile,
      total: normalized.stage
        ? totalForDimensions(protocol.dimensions ?? [], normalized.levels)
        : totalFor(rubric, normalized.levels),
      levels: normalized.levels,
      rank: 0,
      effectivePassed,
      decidingComparator: null,
    };
  });
  const levelComparator = verdicts.every((verdict) =>
    isStageScorecard(verdict.scorecard),
  )
    ? "dimension"
    : "category";
  ranked.sort((left, right) => compareCandidates(left, right, levelComparator).order);
  for (let index = 1; index < ranked.length; index += 1) {
    if (
      compareCandidates(
        ranked[index - 1] as RankedCandidate,
        ranked[index] as RankedCandidate,
        levelComparator,
      ).order === 0
    ) {
      throw new CodePatrolError(
        ERROR_CODES.INVALID_RESULT,
        "candidate ranking contains an unresolved tie",
      );
    }
  }
  ranked.forEach((candidate, index) => {
    candidate.rank = index + 1;
    const next = ranked[index + 1];
    candidate.decidingComparator = next
      ? compareCandidates(candidate, next, levelComparator).comparator
      : null;
  });
  const passing = ranked.filter((candidate) => candidate.effectivePassed);
  const winner = passing[0]?.label ?? null;
  const decidingComparator = winner ? (ranked[0]?.decidingComparator ?? null) : null;
  const hardGateStatus = hardGateFor(state, task, verdicts);
  return {
    rubricVersion: protocol.rubricVersion,
    operation: protocol.operation,
    hardGateStatus,
    candidates: ranked,
    winner,
    decidingComparator,
    execution: { descriptors: [`rubric ${protocol.rubricVersion}`] },
    digestClasses: {
      rubric: protocol.rubricVersion,
      anchors: protocol.anchors.join(","),
      ...(protocol.operation ? { operation: protocol.operation } : {}),
      ...(protocol.dimensions
        ? {
            dimensions: protocol.dimensions
              .map((entry) => `${entry.dimension}:${entry.weight}`)
              .join(","),
          }
        : {}),
    },
  };
}

function scorecardLevels(
  protocol: ReviewProtocol,
  scorecard: CandidateScorecard,
): { levels: number[]; stage: boolean } {
  if (isStageScorecard(scorecard)) {
    return {
      levels: (protocol.dimensions ?? []).map(
        (entry) =>
          scorecard.dimensions.find(
            (assessment) => assessment.dimension === entry.dimension,
          )?.level ?? 0,
      ),
      stage: true,
    };
  }
  return {
    levels: protocol.rubric.categories.map(
      (entry) =>
        scorecard.assessments.find(
          (assessment) => assessment.category === entry.category,
        )?.level ?? 0,
    ),
    stage: false,
  };
}

function totalForDimensions(dimensions: StageDimension[], levels: number[]): number {
  return totalFor(dimensions, levels);
}

function compareCandidates(
  left: RankedCandidate,
  right: RankedCandidate,
  levelComparator: "category" | "dimension",
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
      return {
        order: rightLevel - leftLevel,
        comparator: `${levelComparator}:${index}`,
      };
  }
  const leftProfile = left.profile ?? "";
  const rightProfile = right.profile ?? "";
  if (leftProfile !== rightProfile)
    return {
      order: compareLexical(leftProfile, rightProfile),
      comparator: "profile",
    };
  if (left.proposalId !== right.proposalId)
    return {
      order: compareLexical(left.proposalId, right.proposalId),
      comparator: "proposal-id",
    };
  return { order: 0, comparator: "tie" };
}

function compareLexical(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
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
