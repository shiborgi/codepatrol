import { fail } from "./errors.js";
import type { ExecutionIdentity } from "./execution.js";
import { canonicalJson } from "./json.js";
import type { Attempt, AttemptEvidence, AttemptResult, Stage, TodoItem, Work } from "./work.js";
import { activeAttempt } from "./work.js";

const NEXT_STAGE: Record<Stage, Stage | null> = {
  plan: "review",
  review: "build",
  build: "verify",
  verify: "ship",
  ship: null,
};

const RETURN_TARGETS: Record<Stage, Stage[]> = {
  plan: [],
  review: ["plan"],
  build: ["plan"],
  verify: ["build", "plan"],
  ship: [],
};

export function startStage(
  work: Work,
  stage: Stage,
  input: { runId: string; execution: ExecutionIdentity; todo: TodoItem[]; now: string; evidence?: AttemptEvidence },
): Work {
  if (work.completion !== null) {
    fail("INVALID_STATE", `${work.id} is terminal (${work.completion.outcome})`);
  }
  if (activeAttempt(work) !== undefined) {
    fail("INVALID_STATE", `${work.id} already has an active attempt at ${work.workflow.stage}`);
  }
  if (work.workflow.state !== "ready") {
    fail("INVALID_STATE", `${work.id} is ${work.workflow.state}, cannot start ${stage}`);
  }
  if (input.execution.role !== stage) {
    fail("INVALID_INPUT", `execution.role ${input.execution.role} does not match stage ${stage}`);
  }
  if (work.workflow.stage !== stage) {
    if (!(stage === "verify" && work.workflow.stage === "ship")) {
      fail("INVALID_STATE", `${work.id} is at stage ${work.workflow.stage}, cannot start ${stage}`);
    }
  }
  const seen = new Set<string>();
  for (const item of input.todo) {
    if (seen.has(item.id)) fail("INVALID_INPUT", `duplicate todo id ${JSON.stringify(item.id)}`);
    seen.add(item.id);
  }
  const attemptNumber = work.attempts.filter((attempt) => attempt.stage === stage).length + 1;
  const attempt: Attempt = {
    stage,
    attempt: attemptNumber,
    runId: input.runId,
    status: "active",
    execution: input.execution as Attempt["execution"],
    todo: input.todo,
    startedAt: input.now,
  };
  if (input.evidence !== undefined) attempt.evidence = input.evidence;
  return {
    ...work,
    workflow: { state: "active", stage, updatedAt: input.now },
    attempts: [...work.attempts, attempt],
  };
}

export function executionContractMatches(attempt: Attempt, execution: ExecutionIdentity, todo: TodoItem[]): boolean {
  if (attempt.stage !== execution.role) return false;
  if (attempt.execution.harness !== execution.harness) return false;
  if ((attempt.execution.model ?? null) !== (execution.model ?? null)) return false;
  if ((attempt.execution.profile ?? null) !== (execution.profile ?? null)) return false;
  if ((attempt.execution.compositionDigest ?? null) !== (execution.compositionDigest ?? null)) return false;
  if (canonicalJson(attempt.execution.capabilities ?? null) !== canonicalJson(execution.capabilities ?? null))
    return false;
  if (attempt.todo.length !== todo.length) return false;
  return attempt.todo.every((item, index) => {
    const other = todo[index];
    return other !== undefined && other.id === item.id && other.title === item.title;
  });
}

export function completeStage(
  work: Work,
  stage: Stage,
  runId: string,
  result: AttemptResult,
  now: string,
  evidence?: AttemptEvidence,
): Work {
  if (work.completion !== null) {
    fail("INVALID_STATE", `${work.id} is terminal (${work.completion.outcome})`);
  }
  const attempt = activeAttempt(work);
  if (attempt === undefined) {
    fail("INVALID_STATE", `${work.id} has no active attempt at ${stage}`);
  }
  if (attempt.stage !== stage) {
    fail("INVALID_STATE", `${work.id} active attempt is at ${attempt.stage}, not ${stage}`);
  }
  if (attempt.runId !== runId) {
    fail("INVALID_STATE", `${work.id} active run is ${attempt.runId}, not ${runId}`);
  }
  validateTodoCoverage(attempt, result);
  validateAcceptance(work, stage, result);
  validateDecision(stage, result);

  const finished: Attempt = { ...attempt, status: "completed", finishedAt: now, result };
  if (evidence !== undefined || attempt.evidence !== undefined) {
    finished.evidence = { ...attempt.evidence, ...evidence };
  }
  const attempts = work.attempts.map((entry) => (entry === attempt ? finished : entry));

  if (result.decision === "continue") {
    const next = NEXT_STAGE[stage];
    if (next === null) fail("INVALID_INPUT", `stage ${stage} cannot continue`);
    return {
      ...work,
      workflow: { state: "ready", stage: next, updatedAt: now },
      attempts,
    };
  }
  if (result.decision === "return") {
    const target = result.returnTo;
    if (target === undefined) fail("INVALID_INPUT", `return from ${stage} requires returnTo`);
    return {
      ...work,
      workflow: { state: "ready", stage: target, updatedAt: now },
      attempts,
    };
  }
  const outcome = result.decision === "accept" ? "accepted" : "rolled-back";
  return {
    ...work,
    workflow: { state: "terminal", stage, updatedAt: now },
    attempts,
    completion: {
      outcome,
      authority: result.authority ?? "",
      summary: result.summary,
      finalizedAt: now,
    },
  };
}

export function validateTodoCoverage(attempt: { todo: TodoItem[] }, result: AttemptResult): void {
  const expected = new Set(attempt.todo.map((item) => item.id));
  const seen = new Set<string>();
  for (const entry of result.todo) {
    if (!expected.has(entry.id)) {
      fail("INVALID_INPUT", `result.todo references unknown todo id ${JSON.stringify(entry.id)}`);
    }
    if (seen.has(entry.id)) {
      fail("INVALID_INPUT", `result.todo repeats todo id ${JSON.stringify(entry.id)}`);
    }
    seen.add(entry.id);
  }
  for (const id of expected) {
    if (!seen.has(id)) {
      fail("INVALID_INPUT", `result.todo does not account for todo id ${JSON.stringify(id)}`);
    }
  }
}

export function validateAcceptance(work: Work, stage: Stage, result: AttemptResult): void {
  if (stage !== "verify") return;
  const acceptance = result.acceptance;
  if (acceptance === undefined) {
    fail("INVALID_INPUT", `verify result must address every acceptance criterion of ${work.id}`);
  }
  const seen = new Set<number>();
  for (const entry of acceptance) {
    if (entry.index >= work.acceptance.length) {
      fail(
        "INVALID_INPUT",
        `acceptance index ${entry.index} out of range for ${work.id} (${work.acceptance.length} criteria)`,
      );
    }
    if (seen.has(entry.index)) {
      fail("INVALID_INPUT", `acceptance index ${entry.index} reported twice`);
    }
    seen.add(entry.index);
  }
  for (let index = 0; index < work.acceptance.length; index += 1) {
    if (!seen.has(index)) {
      fail("INVALID_INPUT", `acceptance criterion ${index} of ${work.id} is not addressed`);
    }
  }
  if (result.decision === "continue") {
    for (const entry of acceptance) {
      if (entry.status === "failed") {
        fail("INVALID_INPUT", `verify cannot continue: acceptance criterion ${entry.index} failed`);
      }
    }
  }
}

export function validateDecision(stage: Stage, result: AttemptResult): void {
  if (result.returnTo !== undefined && result.decision !== "return") {
    fail("INVALID_INPUT", `returnTo is only valid with decision return`);
  }
  if (
    result.authority !== undefined &&
    !(stage === "ship" && (result.decision === "accept" || result.decision === "rollback"))
  ) {
    fail("INVALID_INPUT", `authority is only valid for ship accept|rollback`);
  }
  if (result.acceptance !== undefined && stage !== "verify") {
    fail("INVALID_INPUT", `acceptance evidence is only valid at verify`);
  }
  if (result.acceptance !== undefined) {
    for (const entry of result.acceptance) {
      if (entry.status === "not-applicable" && entry.summary.trim() === "") {
        fail("INVALID_INPUT", `acceptance criterion ${entry.index}: not-applicable requires a justification`);
      }
    }
  }
  switch (result.decision) {
    case "continue":
      if (stage === "ship") fail("INVALID_INPUT", "ship must accept or rollback");
      break;
    case "return": {
      const target = result.returnTo;
      if (target === undefined || !RETURN_TARGETS[stage].includes(target)) {
        fail("INVALID_INPUT", `stage ${stage} may only return to ${RETURN_TARGETS[stage].join("|") || "nothing"}`);
      }
      break;
    }
    case "accept":
    case "rollback":
      if (stage !== "ship") fail("INVALID_INPUT", `${result.decision} is only valid at ship`);
      if (result.authority === undefined || result.authority.trim() === "") {
        fail("INVALID_INPUT", `${result.decision} requires authority`);
      }
      break;
  }
}
