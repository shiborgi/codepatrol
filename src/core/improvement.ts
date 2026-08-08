import type { Stage, Work } from "./work.js";

const REPORT_TYPE = "codepatrol-improvement-report";

export interface ImprovementReportScope {
  initiative?: string;
  since?: string;
}

export interface ImprovementReportWorks {
  scoped: number;
  withActivity: number;
  acceptedInWindow: number;
  rolledBackInWindow: number;
  currentlyActive: number;
}

export interface ImprovementReportAttemptsByStage {
  plan: number;
  review: number;
  build: number;
  verify: number;
  ship: number;
}

export interface ImprovementReportReturns {
  reviewToPlan: number;
  buildToPlan: number;
  verifyToBuild: number;
  verifyToPlan: number;
}

export interface ImprovementReportRepeatedAttempt {
  work: string;
  stage: Stage;
  attempts: number;
}

export interface ImprovementReportDurationsEntry {
  samples: number;
  averageMs: number;
  medianMs: number;
}

export interface ImprovementReport {
  schemaVersion: 1;
  type: typeof REPORT_TYPE;
  scope: ImprovementReportScope;
  observedAt: string;
  works: ImprovementReportWorks;
  attemptsByStage: ImprovementReportAttemptsByStage;
  returns: ImprovementReportReturns;
  repeatedAttempts: ImprovementReportRepeatedAttempt[];
  durations: Partial<Record<Stage, ImprovementReportDurationsEntry>>;
}

export interface DeriveOptions {
  initiative?: string;
  since?: string;
  now: string;
}

function msBetween(a: string, b: string): number {
  return new Date(b).getTime() - new Date(a).getTime();
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2);
  }
  return sorted[mid] ?? 0;
}

function toMillis(value: string): number {
  return new Date(value).getTime();
}

function attemptInWindow(attempt: { startedAt: string }, since?: string): boolean {
  if (since === undefined) return true;
  return toMillis(attempt.startedAt) >= toMillis(since);
}

function completionInWindow(work: Work, since?: string): boolean {
  if (work.completion === null) return false;
  if (since === undefined) return true;
  return toMillis(work.completion.finalizedAt) >= toMillis(since);
}

export function deriveReport(works: Work[], options: DeriveOptions): ImprovementReport {
  const scoped = works
    .filter((work) => options.initiative === undefined || work.initiative === options.initiative)
    .sort((a, b) => a.id.localeCompare(b.id));

  let withActivityCount = 0;
  let acceptedInWindowCount = 0;
  let rolledBackInWindowCount = 0;
  let currentlyActiveCount = 0;

  for (const work of scoped) {
    if (work.workflow.state === "active") currentlyActiveCount += 1;

    const hasAttemptInWindow = work.attempts.some((a) => attemptInWindow(a, options.since));
    const hasCompletionInWindow = completionInWindow(work, options.since);
    if (hasAttemptInWindow || hasCompletionInWindow) withActivityCount += 1;

    if (work.completion !== null && completionInWindow(work, options.since)) {
      if (work.completion.outcome === "accepted") acceptedInWindowCount += 1;
      else rolledBackInWindowCount += 1;
    }
  }

  const attemptsByStage: ImprovementReportAttemptsByStage = { plan: 0, review: 0, build: 0, verify: 0, ship: 0 };
  const returns: ImprovementReportReturns = { reviewToPlan: 0, buildToPlan: 0, verifyToBuild: 0, verifyToPlan: 0 };
  const repeated: ImprovementReportRepeatedAttempt[] = [];
  const durationsRaw: Partial<Record<Stage, number[]>> = {};

  for (const work of scoped) {
    for (const stage of ["plan", "review", "build", "verify", "ship"] as Stage[]) {
      const stageAttempts = work.attempts.filter((a) => a.stage === stage && attemptInWindow(a, options.since));
      const count = stageAttempts.length;
      attemptsByStage[stage] += count;

      if (count > 1) {
        repeated.push({ work: work.id, stage, attempts: count });
      }

      for (const a of stageAttempts) {
        if (a.result?.decision === "return") {
          if (a.stage === "review" && a.result.returnTo === "plan") returns.reviewToPlan += 1;
          if (a.stage === "build" && a.result.returnTo === "plan") returns.buildToPlan += 1;
          if (a.stage === "verify" && a.result.returnTo === "build") returns.verifyToBuild += 1;
          if (a.stage === "verify" && a.result.returnTo === "plan") returns.verifyToPlan += 1;
        }
        if (a.finishedAt !== undefined && a.startedAt !== undefined) {
          const duration = msBetween(a.startedAt, a.finishedAt);
          if (duration >= 0) {
            const durations = durationsRaw[stage] ?? [];
            durationsRaw[stage] = durations;
            durations.push(duration);
          }
        }
      }
    }
  }

  repeated.sort((a, b) => a.work.localeCompare(b.work) || a.stage.localeCompare(b.stage));

  const durations: ImprovementReport["durations"] = {};
  for (const stage of ["plan", "review", "build", "verify", "ship"] as Stage[]) {
    const values = durationsRaw[stage];
    if (values !== undefined && values.length > 0) {
      durations[stage] = {
        samples: values.length,
        averageMs: Math.round(values.reduce((s, v) => s + v, 0) / values.length),
        medianMs: median(values),
      };
    }
  }

  const scope: ImprovementReportScope = {};
  if (options.initiative !== undefined) scope.initiative = options.initiative;
  if (options.since !== undefined) scope.since = options.since;

  return {
    schemaVersion: 1,
    type: REPORT_TYPE,
    scope,
    observedAt: options.now,
    works: {
      scoped: scoped.length,
      withActivity: withActivityCount,
      acceptedInWindow: acceptedInWindowCount,
      rolledBackInWindow: rolledBackInWindowCount,
      currentlyActive: currentlyActiveCount,
    },
    attemptsByStage,
    returns,
    repeatedAttempts: repeated,
    durations,
  };
}
