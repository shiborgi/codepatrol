import { activeAttempt, type Stage, type Work } from "./work.js";

export const PROJECT_STATUSES = [
  "Backlog",
  "Plan",
  "Review",
  "Build",
  "Verify",
  "Ship",
  "Done",
  "Rolled Back",
] as const;
export const PROJECT_NEXT_STEPS = ["Plan", "Review", "Build", "Verify", "Ship"] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export type ProjectNextStep = (typeof PROJECT_NEXT_STEPS)[number];

const STAGE_STATUS: Record<Stage, ProjectStatus> = {
  plan: "Plan",
  review: "Review",
  build: "Build",
  verify: "Verify",
  ship: "Ship",
};

const STAGE_NEXT_STEP: Record<Stage, ProjectNextStep> = {
  plan: "Plan",
  review: "Review",
  build: "Build",
  verify: "Verify",
  ship: "Ship",
};

const CONTINUE_DESTINATION: Record<Stage, ProjectNextStep | null> = {
  plan: "Review",
  review: "Build",
  build: "Verify",
  verify: "Ship",
  ship: null,
};

/**
 * The stage that actually executed or is executing — never `workflow.stage`,
 * which already points at the next expected stage once a stage completes.
 */
export function projectStatusOf(work: Work): ProjectStatus {
  if (work.completion !== null) {
    return work.completion.outcome === "accepted" ? "Done" : "Rolled Back";
  }
  const active = activeAttempt(work);
  if (active !== undefined) return STAGE_STATUS[active.stage];
  const last = latestCompleted(work);
  if (last === undefined) return "Backlog";
  return STAGE_STATUS[last.stage];
}

/** The destination decided by the most recently completed stage. */
export function projectNextStepOf(work: Work): ProjectNextStep | null {
  if (work.completion !== null) return null;
  if (activeAttempt(work) !== undefined) return null;
  const last = latestCompleted(work);
  if (last === undefined) return "Plan";
  const result = last.result;
  if (result === undefined) return null;
  if (result.decision === "return") {
    return result.returnTo === undefined ? null : STAGE_NEXT_STEP[result.returnTo];
  }
  if (result.decision === "continue") return CONTINUE_DESTINATION[last.stage];
  return null;
}

function latestCompleted(work: Work): Work["attempts"][number] | undefined {
  for (let index = work.attempts.length - 1; index >= 0; index -= 1) {
    const attempt = work.attempts[index]!;
    if (attempt.status === "completed") return attempt;
  }
  return undefined;
}
