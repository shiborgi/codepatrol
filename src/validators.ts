import type {
  BuildReview,
  PlanDocument,
  Round,
  SpecDocument,
  State,
  Task,
  Wave,
} from "./core.js";

export { parseResult, resultAs } from "./service/results.js";

import { assertDomain, ERROR_CODES, type ErrorCode } from "./errors.js";
import { getWork } from "./selectors.js";
import type { ParsedResult } from "./service/results.js";

export type { ParsedResult };

export function validateSpec(document: SpecDocument): void {
  const waveKeys = document.waves.map((wave) => wave.key);
  assertExactSet(waveKeys, [...new Set(waveKeys)], "DUPLICATE_WAVE_KEY");
  const works = document.waves.flatMap((wave) => wave.works);
  const workKeys = works.map((work) => work.key);
  assertExactSet(workKeys, [...new Set(workKeys)], "DUPLICATE_WORK_KEY");
  const known = new Set(workKeys);
  for (const work of works) {
    for (const blocker of work.blockedBy) {
      assertDomain(
        known.has(blocker),
        ERROR_CODES.UNKNOWN_BLOCKER,
        `${blocker} is not a Work key`,
      );
      assertDomain(
        blocker !== work.key,
        ERROR_CODES.BLOCKER_CYCLE,
        `${work.key} blocks itself`,
      );
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byKey = new Map(works.map((work) => [work.key, work]));
  const visit = (key: string): void => {
    assertDomain(
      !visiting.has(key),
      ERROR_CODES.BLOCKER_CYCLE,
      `dependency cycle includes ${key}`,
    );
    if (visited.has(key)) return;
    visiting.add(key);
    for (const blocker of byKey.get(key)?.blockedBy ?? []) visit(blocker);
    visiting.delete(key);
    visited.add(key);
  };
  for (const key of workKeys) visit(key);
}

export function validatePlan(state: State, wave: Wave, plan: PlanDocument): void {
  assertDomain(
    plan.openQuestions.length === 0,
    ERROR_CODES.OPEN_QUESTIONS,
    "plan has open questions",
  );
  assertExactSet(
    plan.works.map((entry) => entry.workId),
    wave.workIds,
    "WORK_COVERAGE_MISMATCH",
  );
  for (const entry of plan.works) {
    const expected = getWork(state, entry.workId).acceptance.map(
      (acceptance) => acceptance.id,
    );
    const covered = entry.steps.flatMap((step) => step.acceptanceIds);
    assertDomain(
      covered.every((acceptanceId) => expected.includes(acceptanceId)),
      ERROR_CODES.UNKNOWN_ACCEPTANCE,
      `${entry.workId} plan references unknown acceptance criteria`,
    );
    assertDomain(
      expected.every((acceptanceId) => covered.includes(acceptanceId)),
      ERROR_CODES.ACCEPTANCE_NOT_COVERED,
      `${entry.workId} plan does not cover every acceptance criterion`,
    );
  }
}

export function validateBuildApproval(
  state: State,
  wave: Wave,
  task: Task,
  result: BuildReview,
  selected: string,
): void {
  const evidence = task.verification.find((entry) => entry.proposalId === selected);
  assertDomain(
    evidence?.status === "passed",
    ERROR_CODES.VERIFICATION_FAILED,
    "selected candidate did not pass verification",
  );
  const expected = wave.workIds.flatMap((workId) =>
    getWork(state, workId).acceptance.map((item) => item.id),
  );
  const acceptance = result.acceptance;
  assertExactSet(
    acceptance.map((entry) => entry.id),
    expected,
    "ACCEPTANCE_MISMATCH",
  );
  assertDomain(
    acceptance.every((entry) => entry.status === "passed"),
    ERROR_CODES.ACCEPTANCE_FAILED,
    "all acceptance criteria must pass",
  );
}

export function assertCandidateVerdicts(
  round: Round,
  result: Record<string, unknown>,
): void {
  const candidates = result.candidates as Array<{ proposalId: string }>;
  assertExactSet(
    candidates.map((entry) => entry.proposalId),
    round.proposalIds,
    "CANDIDATE_COVERAGE_MISMATCH",
  );
}

export function validateContextComparison(
  task: Task,
  result: Record<string, unknown>,
): void {
  const artifacts = task.contextProfileArtifacts ?? [];
  const comparison = result.contextComparison as
    | {
        verdicts?: Array<{ profile?: string; status?: string }>;
        selectedContextProfile?: string;
      }
    | undefined;
  const uniqueProfiles = [...new Set(artifacts.map((artifact) => artifact.profile))];
  if (uniqueProfiles.length <= 1) {
    assertDomain(
      comparison === undefined,
      ERROR_CODES.INVALID_RESULT,
      "contextComparison is only valid when multiple profiles are supplied",
    );
    return;
  }
  assertDomain(
    comparison !== undefined,
    ERROR_CODES.INVALID_RESULT,
    "multiple context profiles require a contextComparison",
  );
  const verdicts = comparison.verdicts ?? [];
  assertExactSet(
    verdicts.map((entry) => entry.profile as string),
    uniqueProfiles,
    "CONTEXT_COMPARISON_MISMATCH",
  );
  if (comparison.selectedContextProfile !== undefined) {
    assertDomain(
      artifacts.some(
        (artifact) =>
          artifact.profile === comparison.selectedContextProfile &&
          artifact.availability.status === "available",
      ),
      ERROR_CODES.INVALID_RESULT,
      "selectedContextProfile must name a supplied profile",
    );
    assertDomain(
      verdicts.some(
        (entry) =>
          entry.profile === comparison.selectedContextProfile &&
          entry.status === "passed",
      ),
      ERROR_CODES.INVALID_RESULT,
      "selectedContextProfile must name a passing profile",
    );
  }
  for (const artifact of artifacts) {
    const verdict = verdicts.find((entry) => entry.profile === artifact.profile);
    assertDomain(
      (artifact.availability.status === "unavailable") ===
        (verdict?.status === "unavailable"),
      ERROR_CODES.INVALID_RESULT,
      `context profile ${artifact.profile} availability does not match its verdict`,
    );
  }
}

export function assertExactSet(
  actual: string[],
  expected: string[],
  code: ErrorCode,
): void {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  assertDomain(
    actualSet.size === actual.length &&
      expectedSet.size === expected.length &&
      actualSet.size === expectedSet.size &&
      [...actualSet].every((value) => expectedSet.has(value)),
    code,
    `expected [${expected.join(", ")}], received [${actual.join(", ")}]`,
  );
}

export function assertBlockers(state: State, wave: Wave): void {
  for (const workId of wave.workIds) {
    const work = getWork(state, workId);
    for (const blockerId of work.blockedBy) {
      const blocker = getWork(state, blockerId);
      if (blocker.waveId !== wave.id) {
        assertDomain(
          blocker.status === "accepted",
          ERROR_CODES.BLOCKED,
          `${workId} is blocked by ${blockerId}`,
        );
      }
    }
  }
}
