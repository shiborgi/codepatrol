import { canonicalCommentary } from "./commentary.js";
import type { Config } from "./config.js";
import type { Task } from "./core.js";
import { CodePatrolError } from "./errors.js";
import type { Repository } from "./git.js";
import { upsertGitHubComments } from "./remote.js";
import type { RunContext } from "./run-context.js";

export type HookEvent =
  | { kind: "open"; task: Task }
  | { kind: "submit"; task: Task }
  | { kind: "ship"; waveId: string; decision: "accept" | "rollback"; commit: string };

export async function syncHooks(
  repo: Repository,
  config: Config,
  event: HookEvent,
  ctx: RunContext,
): Promise<void> {
  try {
    const state = repo.readState().state;
    const projected = canonicalCommentary(state);
    const key =
      event.kind === "ship"
        ? `summary:ship:${event.waveId}:r${state.waves.find((wave) => wave.id === event.waveId)?.buildRounds.at(-1)?.number ?? 1}`
        : `${event.kind === "open" && ["plan", "build"].includes(event.task.operation) ? "todo" : "summary"}:${event.task.operation}:${event.task.subjectId}:r${event.task.round}`;
    const payload = projected.filter(
      (comment) =>
        `${comment.kind}:${comment.operation}:${comment.subject}:r${comment.round}` ===
        key,
    );
    await upsertGitHubComments(repo, config, payload, ctx);
  } catch (error) {
    if (error instanceof CodePatrolError && !error.code.startsWith("REMOTE_"))
      throw error;
    ctx.log.warn(
      `remote commentary skipped: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
