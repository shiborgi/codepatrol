import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { type AgentResolution, resolveAgent } from "./agent-catalog.js";
import type { CliResult } from "./cli.js";
import type { loadConfig } from "./config.js";
import { type ContextSnapshot, resolveContext } from "./context-provider.js";
import type { Operation, ProducerOperation, ReviewOperation, Source } from "./core.js";
import { usage } from "./errors.js";
import { type Repository, STATE_REF } from "./git.js";
import { syncGitHub } from "./remote.js";
import type { RunContext } from "./run-context.js";
import { getInit, getWave } from "./selectors.js";
import type { CodePatrolService } from "./service.js";
import { doctorSignals, timelineFromHistory } from "./trace.js";

export type DispatchContext = {
  command: string;
  action?: string;
  options: Map<string, string>;
  repo: Repository;
  config: ReturnType<typeof loadConfig>;
  service: CodePatrolService;
  ctx: RunContext;
};
export type DispatchHandler = (
  context: DispatchContext,
) => Promise<CliResult> | CliResult;
export type Handler =
  | "setup"
  | "init"
  | "wave"
  | "work"
  | "producer"
  | "review"
  | "task"
  | "ship"
  | "remote"
  | "doctor"
  | "trace"
  | "cleanup";

function required(options: Map<string, string>, name: string): string {
  return options.get(name) ?? usage(`${name} is required`);
}

function ok(value: unknown): CliResult {
  return { exitCode: 0, stdout: `${JSON.stringify(value, null, 2)}\n`, stderr: "" };
}

export const handlers: Record<Handler, DispatchHandler> = {
  init: ({ action, options, service }) =>
    ok(
      action === "create"
        ? service.createInit(required(options, "--title"), options.get("--brief") ?? "")
        : action === "list"
          ? service.list("init")
          : action === "show"
            ? service.show("init", required(options, "--init"))
            : service.resumeInit(required(options, "--init")),
    ),
  wave: ({ action, options, service }) => {
    if (action === "list") return ok(service.list("wave"));
    if (action === "show") return ok(service.show("wave", required(options, "--wave")));
    const operation = required(options, "--operation");
    if (operation !== "plan" && operation !== "build")
      usage("--operation must be plan or build");
    return ok(service.resumeWave(required(options, "--wave"), operation));
  },
  work: ({ action, options, service }) =>
    ok(
      action === "list"
        ? service.list("work")
        : service.show("work", required(options, "--work")),
    ),
  producer: async ({ command, options, repo, config, service, ctx }) => {
    const operation = command as ProducerOperation;
    const selections = await producerAgents(config, options, ctx);
    const context = await taskContext(config, operation, options, repo, ctx);
    return ok(
      service.openProducers(
        operation,
        required(options, operation === "spec" ? "--init" : "--wave"),
        selections,
        options.get("--from"),
        context,
      ),
    );
  },
  review: async ({ command, options, repo, config, service, ctx }) => {
    const operation = command as ReviewOperation;
    const selection = await reviewAgent(config, operation, options, ctx);
    return ok(
      service.openReview(
        operation,
        required(options, operation === "spec-review" ? "--init" : "--wave"),
        selection.source,
        selection.instructions,
        await taskContext(config, operation, options, repo, ctx),
      ),
    );
  },
  task: async ({ action, options, service, ctx }) => {
    if (action === "list") return ok(service.list("task"));
    const taskId = required(options, "--task");
    if (action === "show") return ok(service.showTask(taskId));
    if (action === "submit")
      return ok(
        service.submitTask(taskId, await readJson(ctx, required(options, "--result"))),
      );
    if (action === "cancel") return ok(service.cancelTask(taskId));
    if (action === "fail")
      return ok(service.failTask(taskId, required(options, "--reason")));
    return ok(service.retryTask(taskId));
  },
  ship: async ({ action, options, repo, config, service, ctx }) => {
    const waveId = required(options, "--wave");
    if (action === "show") {
      const resolution = await shipAgent(config, ctx);
      return ok(
        service.composeShipStatus(
          waveId,
          resolution,
          await taskContext(config, "ship", options, repo, ctx),
        ),
      );
    }
    const confirmation = required(options, "--confirm");
    if (confirmation !== action) usage(`Ship ${action} requires --confirm ${action}`);
    const durable =
      action === "accept" ? service.shipAccept(waveId) : service.shipRollback(waveId);
    const pushed = await pushMainAfterShip(repo, config, ctx);
    return {
      ...ok({ ...(durable as Record<string, unknown>), pushMain: pushed.outcome }),
      stderr: pushed.warning ? `${pushed.warning}\n` : "",
    };
  },
  remote: async ({ repo, config, ctx }) => ok(await syncGitHub(repo, config, ctx)),
  trace: ({ options, repo }) => {
    const initId = options.get("--init");
    const waveId = options.get("--wave");
    if (!initId && !waveId) usage("trace requires --init or --wave");
    if (initId && waveId) usage("trace accepts only one of --init or --wave");
    const state = repo.readState().state;
    if (initId) getInit(state, initId);
    else getWave(state, waveId as string);
    const subject = (initId ?? waveId) as string;
    return ok({
      subject,
      entries: timelineFromHistory(
        repo.readStateHistory(),
        subject,
        initId ? "init" : "wave",
      ),
    });
  },
  doctor: ({ repo, config }) => {
    const state = repo.readState();
    return ok({
      ok: true,
      repository: repo.root,
      projectId: repo.projectId,
      stateRef: STATE_REF,
      stateInitialized: Boolean(state.oid),
      sequence: state.state.sequence,
      legacyStatePresent: Boolean(repo.resolveRef("refs/codepatrol/state")),
      managedWorktrees: repo.listManagedWorktrees(),
      shipRecoveryPending: repo.shipRecoveryPending(),
      remoteEnabled: config.remote?.github.enabled ?? false,
      ...doctorSignals(state.state, config.maxReviewReturns),
    });
  },
  cleanup: ({ service }) => ok(service.cleanup()),
  setup: () => usage("setup must be dispatched before configuration loading"),
};

async function producerAgents(
  config: ReturnType<typeof loadConfig>,
  options: Map<string, string>,
  ctx: RunContext,
): Promise<Array<{ source: Source; agentInstructions: string }>> {
  const requested = required(options, "--agents")
    .split(",")
    .map((entry) => {
      const at = entry.lastIndexOf("@");
      if (at <= 0 || at === entry.length - 1)
        usage("--agents entries must be reference@version");
      return { reference: entry.slice(0, at), version: entry.slice(at + 1) };
    });
  const harness = required(options, "--harness");
  const resolved: AgentResolution[] = [];
  for (const request of requested)
    resolved.push(await resolveAgent(config.agentCatalog, request, ctx));
  return resolved.map((entry) => ({
    source: {
      harness,
      model: options.get("--model") ?? null,
      agent: entry.agent.reference,
      agentVersion: entry.agent.version,
      agentDigest: entry.agent.digest,
      agentInstructionsDigest: entry.instructionsDigest,
    },
    agentInstructions: entry.instructions,
  }));
}

async function reviewAgent(
  config: ReturnType<typeof loadConfig>,
  operation: ReviewOperation,
  options: Map<string, string>,
  ctx: RunContext,
): Promise<{ source: Source; instructions?: string }> {
  const base: Source = {
    harness: required(options, "--harness"),
    model: options.get("--model") ?? null,
    agent: null,
  };
  const requested = config.agentCatalog?.defaults[operation];
  if (!requested) return { source: base };
  const resolved = await resolveAgent(
    config.agentCatalog,
    {
      reference: requested.agent,
      version: requested.version,
    },
    ctx,
  );
  return {
    source: {
      ...base,
      agent: resolved.agent.reference,
      agentVersion: resolved.agent.version,
      agentDigest: resolved.agent.digest,
      agentInstructionsDigest: resolved.instructionsDigest,
    },
    instructions: resolved.instructions,
  };
}

async function shipAgent(
  config: ReturnType<typeof loadConfig>,
  ctx: RunContext,
): Promise<AgentResolution | undefined> {
  const requested = config.agentCatalog?.defaults.ship;
  if (!requested) return undefined;
  return resolveAgent(
    config.agentCatalog,
    {
      reference: requested.agent,
      version: requested.version,
    },
    ctx,
  );
}

async function taskContext(
  config: ReturnType<typeof loadConfig>,
  operation: Operation | "ship",
  options: Map<string, string>,
  repo: Repository,
  ctx: RunContext,
): Promise<ContextSnapshot | undefined> {
  const explicit = options.get("--context-profile");
  if (options.has("--context-profile") && !explicit)
    usage("--context-profile must not be empty");
  if (explicit === "none") return undefined;
  const profile = explicit ?? config.contextPatrol?.defaults[operation];
  if (!profile) return undefined;
  return resolveContext(
    config.contextPatrol,
    profile,
    repo.root,
    "Analyze the relevant code structure, dependencies, source boundaries, changes, and test signals for the requested change.",
    { kind: "commit", oid: repo.currentCommit(config.baseBranch) },
    undefined,
    ctx,
  );
}

async function readJson(ctx: RunContext, location: string): Promise<unknown> {
  let raw: string;
  if (location === "-") {
    raw = await ctx.readStdin();
  } else {
    try {
      raw = readFileSync(location, "utf8");
    } catch {
      usage(`cannot read ${location}`);
    }
  }
  try {
    return JSON.parse(raw);
  } catch {
    usage("result is not valid JSON");
  }
}

async function pushMainAfterShip(
  repo: Repository,
  config: ReturnType<typeof loadConfig>,
  ctx: RunContext,
): Promise<{
  outcome:
    | { status: "disabled" }
    | { status: "pushed"; reconciliation: unknown }
    | { status: "failed"; reason: string };
  warning?: string;
}> {
  const github = config.remote?.github;
  if (!(github?.enabled && github.pushMain)) return { outcome: { status: "disabled" } };
  const token = ctx.env(github.tokenEnv) ?? ctx.env("GH_TOKEN");
  if (!token) return failedPush(ctx, `${github.tokenEnv} or GH_TOKEN is required`);
  const temporary = mkdtempSync(resolve(tmpdir(), "codepatrol-push-"));
  try {
    const askpass = resolve(temporary, "askpass.sh");
    writeFileSync(
      askpass,
      '#!/bin/sh\ncase "$1" in *Username*) printf "%s" "x-access-token" ;; *) printf "%s" "$CODEPATROL_GITHUB_TOKEN" ;; esac\n',
    );
    chmodSync(askpass, 0o700);
    const result = spawnSync(
      "git",
      [
        "push",
        "--quiet",
        github.gitRemote,
        `${config.baseBranch}:${config.baseBranch}`,
      ],
      {
        cwd: repo.root,
        encoding: "utf8",
        env: {
          ...ctx.envAll(),
          GIT_ASKPASS: askpass,
          GIT_TERMINAL_PROMPT: "0",
          CODEPATROL_GITHUB_TOKEN: token,
        },
      },
    );
    if (result.status !== 0)
      return failedPush(ctx, result.stderr?.trim() || "git push failed");
    try {
      const reconciliation = await syncGitHub(repo, config, ctx);
      return { outcome: { status: "pushed", reconciliation } };
    } catch (error) {
      return failedPush(
        ctx,
        `post-push reconciliation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function failedPush(
  ctx: RunContext,
  reason: string,
): {
  outcome: { status: "failed"; reason: string };
  warning: string;
} {
  const warning = `ship completed; main push warning: ${reason}`;
  ctx.log.warn(warning);
  return {
    outcome: { status: "failed", reason },
    warning,
  };
}
