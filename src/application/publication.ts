import type { Git, GitResult } from "../adapters/git.js";
import { fail } from "../core/errors.js";
import type { AttemptResult, RemotePublication, Work } from "../core/work.js";

export type PublishStatus = "pushed" | "push-denied" | "failed";

export interface PublishResult {
  status: PublishStatus;
  pushCommit?: string;
  error?: string;
}

export function classifyPushError(result: GitResult): PublishStatus {
  const stderr = result.stderr.toLowerCase();
  if (stderr.includes("denied") || stderr.includes("403") || stderr.includes("401")) {
    return "push-denied";
  }
  return "failed";
}

export async function attemptPublication(git: Git): Promise<PublishResult> {
  const pushResult = await git.exec(["push", "origin", "refs/heads/main:refs/heads/main"], { allowFailure: true });
  if (pushResult.code !== 0) {
    return { status: classifyPushError(pushResult), error: pushResult.stderr.trim() };
  }
  const head = await git.exec(["rev-parse", "HEAD"]);
  return { status: "pushed", pushCommit: head.stdout.trim() };
}

/** What a Work needs to expose for its publication state to be recorded. */
export interface PublicationRecorder {
  recordRemotePublication(workId: string, runId: string, publication: RemotePublication): Promise<void>;
}

export interface PublicationEnvironment {
  git: Git;
  now: () => string;
  /** Whether a push target exists at all; publication policy depends on it. */
  hasRemote: () => Promise<boolean>;
}

/**
 * What the caller may surface. `publication` is what was recorded on the
 * attempt; `report` is the attempt-independent view of the same event, without
 * the recording timestamps. A warning is never thrown — publication failure
 * does not invalidate a lifecycle result.
 */
export interface PublicationOutcome {
  publication: RemotePublication;
  report: RemotePublication;
  warning?: string;
}

async function pushAndRecord(
  environment: PublicationEnvironment,
  recorder: PublicationRecorder,
  workId: string,
  runId: string,
): Promise<PublicationOutcome> {
  await recorder.recordRemotePublication(workId, runId, { status: "pending", requestedAt: environment.now() });
  try {
    const result = await attemptPublication(environment.git);
    const report: RemotePublication = {
      status: result.status,
      ...(result.pushCommit !== undefined ? { pushCommit: result.pushCommit } : {}),
      ...(result.error !== undefined ? { error: result.error } : {}),
    };
    const publication: RemotePublication = { ...report, completedAt: environment.now() };
    await recorder.recordRemotePublication(workId, runId, publication);
    return { publication, report };
  } catch (error) {
    const report: RemotePublication = {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
    const publication: RemotePublication = { ...report, completedAt: environment.now() };
    await recorder.recordRemotePublication(workId, runId, publication);
    return { publication, report };
  }
}

/**
 * Decides what publication a completed Ship attempt deserves. Only an accepted
 * Work that explicitly asked to publish is pushed; everything else is recorded
 * as `not-requested` so the attempt always carries an answer.
 */
export async function publishShipOutcome(
  environment: PublicationEnvironment,
  recorder: PublicationRecorder,
  input: { workId: string; runId: string; result: AttemptResult; publishRequested: boolean },
): Promise<PublicationOutcome> {
  if (input.result.decision !== "accept" || !input.publishRequested) {
    const publication: RemotePublication = { status: "not-requested" };
    await recorder.recordRemotePublication(input.workId, input.runId, publication);
    return { publication, report: publication };
  }
  if (!(await environment.hasRemote())) {
    const publication: RemotePublication = {
      status: "failed",
      error: "no remote configured",
      completedAt: environment.now(),
    };
    await recorder.recordRemotePublication(input.workId, input.runId, publication);
    return { publication, report: publication, warning: "publication requested but no remote configured" };
  }
  return pushAndRecord(environment, recorder, input.workId, input.runId);
}

/**
 * The explicit retry path. Publication is only meaningful for an accepted Work
 * whose Ship attempt pinned a final commit; a Work already pushed is returned
 * unchanged rather than pushed twice.
 */
export async function republishAcceptedWork(
  environment: PublicationEnvironment,
  recorder: PublicationRecorder,
  work: Work,
): Promise<PublicationOutcome> {
  if (work.completion === null || work.completion.outcome !== "accepted") {
    fail(
      "INVALID_STATE",
      `ship publish requires an accepted work; ${work.id} is ${work.completion?.outcome ?? "not terminal"}`,
    );
  }
  const shipAttempt = work.attempts.find((attempt) => attempt.stage === "ship" && attempt.status === "completed");
  if (shipAttempt === undefined) fail("INVALID_STATE", `${work.id} has no completed ship attempt`);
  if (shipAttempt.evidence?.finalCommit === undefined) {
    fail("INVALID_STATE", `${work.id} ship attempt has no finalCommit`);
  }
  const existing = shipAttempt.evidence?.remotePublication;
  if (existing?.status === "pushed") return { publication: existing, report: existing };
  if (!(await environment.hasRemote())) fail("GITHUB", "no origin remote configured; cannot publish");
  return pushAndRecord(environment, recorder, work.id, shipAttempt.runId);
}
