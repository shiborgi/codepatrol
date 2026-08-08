import { changeHeadRefOf } from "./change.js";
import { fail } from "./errors.js";
import { validateAcceptance, validateDecision, validateTodoCoverage } from "./lifecycle.js";
import type { Attempt, Completion, Stage, Work } from "./work.js";

export interface ReconstructedWorkflow {
  state: "ready" | "active" | "terminal";
  stage: Stage;
  completion: Completion | null;
}

const NEXT_STAGE: Record<Stage, Stage | null> = {
  plan: "review",
  review: "build",
  build: "verify",
  verify: "ship",
  ship: null,
};

function reconstructWorkflow(work: Work): ReconstructedWorkflow {
  let stage: Stage = "plan";
  let completion: Completion | null = null;
  let buildCandidate: string | undefined;
  let verifiedCandidate: string | undefined;
  const perStage = new Map<Stage, number>();

  work.attempts.forEach((attempt, position) => {
    const context = `${work.id} ${attempt.stage}#${attempt.attempt}`;

    if (completion !== null) {
      fail("STATE_CORRUPT", `${context}: attempt recorded after terminal completion`);
    }
    if (attempt.stage !== stage) {
      if (!(attempt.stage === "verify" && stage === "ship")) {
        fail("STATE_CORRUPT", `${context}: stage ${attempt.stage} is not reachable; expected ${stage}`);
      }
    }
    if (attempt.execution.role !== attempt.stage) {
      fail("STATE_CORRUPT", `${context}: execution role does not match stage`);
    }
    const expectedNumber = (perStage.get(attempt.stage) ?? 0) + 1;
    if (attempt.attempt !== expectedNumber) {
      fail("STATE_CORRUPT", `${context}: out of sequence (expected ${expectedNumber})`);
    }
    perStage.set(attempt.stage, expectedNumber);

    const todoIds = new Set<string>();
    for (const item of attempt.todo) {
      if (item.id.trim() === "" || item.title.trim() === "") {
        fail("STATE_CORRUPT", `${context}: empty todo id or title`);
      }
      if (todoIds.has(item.id)) fail("STATE_CORRUPT", `${context}: duplicate todo id ${JSON.stringify(item.id)}`);
      todoIds.add(item.id);
    }

    validateEvidence(work, attempt, buildCandidate, verifiedCandidate);

    if (attempt.status === "active") {
      if (position !== work.attempts.length - 1) {
        fail("STATE_CORRUPT", `${context}: active attempt is not the last attempt`);
      }
      if (attempt.finishedAt !== undefined || attempt.result !== undefined) {
        fail("STATE_CORRUPT", `${context}: active attempt has finishedAt or result`);
      }
      return;
    }

    if (attempt.finishedAt === undefined || attempt.result === undefined) {
      fail("STATE_CORRUPT", `${context}: completed attempt lacks finishedAt or result`);
    }
    const result = attempt.result;
    validateTodoCoverage(attempt, result);
    validateAcceptance(work, attempt.stage, result);
    validateDecision(attempt.stage, result);

    switch (result.decision) {
      case "continue": {
        if (attempt.stage === "build") {
          buildCandidate = attempt.evidence?.candidateCommit;
        }
        if (attempt.stage === "verify") {
          verifiedCandidate = attempt.evidence?.candidateCommit;
        }
        const next = NEXT_STAGE[attempt.stage];
        if (next === null) fail("STATE_CORRUPT", `${context}: ship cannot continue`);
        stage = next;
        break;
      }
      case "return": {
        if (attempt.stage === "verify") verifiedCandidate = undefined;
        if (attempt.stage === "build") buildCandidate = undefined;
        stage = result.returnTo as Stage;
        break;
      }
      case "accept":
      case "rollback":
        completion = {
          outcome: result.decision === "accept" ? "accepted" : "rolled-back",
          authority: result.authority ?? "",
          summary: result.summary,
          finalizedAt: attempt.finishedAt,
        };
        if (
          attempt.stage === "ship" &&
          completion.outcome === "accepted" &&
          attempt.evidence?.baseCommit !== undefined &&
          attempt.evidence?.finalCommit === undefined
        ) {
          fail("STATE_CORRUPT", `${context}: accepted ship attempt with baseCommit lacks finalCommit`);
        }
        if (attempt.evidence?.finalCommit !== undefined && completion.outcome !== "accepted") {
          fail("STATE_CORRUPT", `${context}: finalCommit recorded without accepted completion`);
        }
        break;
    }
  });

  const last = work.attempts[work.attempts.length - 1];
  const active = completion === null && last !== undefined && last.status === "active";
  return {
    state: completion !== null ? "terminal" : active ? "active" : "ready",
    stage,
    completion,
  };
}

function validateEvidence(
  work: Work,
  attempt: Attempt,
  buildCandidate: string | undefined,
  verifiedCandidate: string | undefined,
): void {
  const context = `${work.id} ${attempt.stage}#${attempt.attempt}`;
  const evidence = attempt.evidence;
  if (attempt.stage === "build") {
    if (evidence?.baseCommit === undefined) {
      fail("STATE_CORRUPT", `${context}: build attempt lacks baseCommit`);
    }
    if (attempt.status === "completed") {
      if (evidence.candidateCommit === undefined) {
        fail("STATE_CORRUPT", `${context}: completed build attempt lacks candidateCommit`);
      }
      if (work.delivery === "code" && evidence.candidateCommit === evidence.baseCommit) {
        fail("STATE_CORRUPT", `${context}: code work candidate equals its base commit`);
      }
    }
  }
  if (attempt.stage === "verify") {
    if (evidence?.candidateCommit === undefined) {
      fail("STATE_CORRUPT", `${context}: verify attempt lacks a pinned candidate`);
    }
    if (buildCandidate === undefined) {
      fail("STATE_CORRUPT", `${context}: verify without a build candidate`);
    }
    if (evidence.candidateCommit !== buildCandidate) {
      fail("STATE_CORRUPT", `${context}: verify candidate differs from the latest build candidate`);
    }
  }
  if (attempt.stage === "ship") {
    if (verifiedCandidate === undefined) {
      fail("STATE_CORRUPT", `${context}: ship without a verified candidate`);
    }
    if (evidence?.candidateCommit !== verifiedCandidate) {
      fail("STATE_CORRUPT", `${context}: ship candidate differs from the verified candidate`);
    }
  }
  if (evidence?.change !== undefined) {
    if (evidence.baseCommit !== undefined && evidence.change.baseCommit !== evidence.baseCommit) {
      fail("STATE_CORRUPT", `${context}: change.baseCommit differs from top-level baseCommit`);
    }
    if (evidence.candidateCommit !== undefined && evidence.change.candidateCommit !== evidence.candidateCommit) {
      fail("STATE_CORRUPT", `${context}: change.candidateCommit differs from top-level candidateCommit`);
    }
    if (evidence.change.headRef !== changeHeadRefOf(work.id)) {
      fail("STATE_CORRUPT", `${context}: change.headRef does not match expected ref for ${work.id}`);
    }
  }
}

export function assertReconstructionMatches(work: Work): void {
  const reconstructed = reconstructWorkflow(work);
  if (reconstructed.state !== work.workflow.state) {
    fail(
      "STATE_CORRUPT",
      `${work.id}: persisted state ${work.workflow.state} does not match reconstructed ${reconstructed.state}`,
    );
  }
  if (reconstructed.stage !== work.workflow.stage) {
    fail(
      "STATE_CORRUPT",
      `${work.id}: persisted stage ${work.workflow.stage} does not match reconstructed ${reconstructed.stage}`,
    );
  }
  const persisted = work.completion;
  if ((persisted === null) !== (reconstructed.completion === null)) {
    fail("STATE_CORRUPT", `${work.id}: persisted completion does not match reconstructed history`);
  }
  if (persisted !== null && reconstructed.completion !== null) {
    if (
      persisted.outcome !== reconstructed.completion.outcome ||
      persisted.finalizedAt !== reconstructed.completion.finalizedAt
    ) {
      fail("STATE_CORRUPT", `${work.id}: persisted completion does not match reconstructed history`);
    }
  }
}
