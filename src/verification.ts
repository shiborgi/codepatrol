import { mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import type { CommandResult } from "./command.js";
import { execute, stableEnv } from "./command.js";
import type { Verification } from "./core.js";
import { assertDomain, ERROR_CODES } from "./errors.js";
import type { RunContext } from "./run-context.js";
import { digest, LIMITS } from "./shared.js";

export interface VerificationStore {
  workspacePath(taskId: string): string;
  git(args: string[], cwd?: string, input?: string): string;
  tryGit(args: string[], cwd?: string, input?: string): CommandResult;
  linkSharedPaths(workspace: string, paths: string[]): void;
}

export function verifyCandidate(
  ctx: RunContext,
  store: VerificationStore,
  proposalId: string,
  candidateCommit: string,
  argv: string[],
  timeoutMs: number,
  sharedPaths: string[] = [],
): Verification {
  const key = `review-${proposalId}`;
  const path = store.workspacePath(key);
  const started = ctx.now().getTime();
  try {
    mkdirSync(dirname(path), { recursive: true });
    store.git(["worktree", "add", "--detach", path, candidateCommit]);
    store.linkSharedPaths(path, sharedPaths);
    const command = argv[0];
    assertDomain(command, ERROR_CODES.INVALID_RESULT, "verification command is empty");
    const result = execute(
      command,
      argv.slice(1),
      path,
      undefined,
      timeoutMs,
      stableEnv(ctx.envAll()),
    );
    const raw = `${result.stdout}${result.stderr}`;
    const truncated = raw.length > LIMITS.verificationOutputBytes;
    const output = truncated ? raw.slice(-LIMITS.verificationOutputBytes) : raw;
    if (truncated) {
      ctx.log.warn(
        `verification output for ${proposalId} exceeded ${LIMITS.verificationOutputBytes} bytes and was truncated`,
      );
    }
    const infrastructure = result.status === "unavailable" || result.exitCode === 127;
    return {
      proposalId,
      status: infrastructure
        ? "infrastructure-failed"
        : result.status === "succeeded"
          ? "passed"
          : "failed",
      argv,
      exitCode: result.status === "unavailable" ? null : result.exitCode,
      durationMs: ctx.now().getTime() - started,
      output,
      outputDigest: digest(raw),
      truncated,
    };
  } catch (error) {
    const output = error instanceof Error ? error.message : String(error);
    return {
      proposalId,
      status: "infrastructure-failed",
      argv,
      exitCode: null,
      durationMs: ctx.now().getTime() - started,
      output,
      outputDigest: digest(output),
      truncated: false,
    };
  } finally {
    const removed = store.tryGit(["worktree", "remove", "--force", path]);
    ctx.log.debug(`verification cleanup for ${proposalId}: ${removed.status}`);
    rmSync(path, { recursive: true, force: true });
  }
}
