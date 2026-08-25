import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { type AgentResolution, resolveAgent } from "./agent-catalog.js";
import { loadConfig } from "./config.js";
import { type ContextSnapshot, resolveContext } from "./context-provider.js";
import type { Operation, ProducerOperation, ReviewOperation, Source } from "./core.js";
import { CodePatrolError, ERROR_CODES, usage } from "./errors.js";
import { Repository, STATE_REF } from "./git.js";
import { syncGitHub } from "./remote.js";
import { type RunContext, stderrLogger, systemRunContext } from "./run-context.js";
import { CodePatrolService } from "./service.js";
import { setupRepository } from "./setup.js";
import { syncHooks } from "./sync-hooks.js";
import { VERSION } from "./version.js";

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

type DispatchContext = {
  command: string;
  action?: string;
  options: Map<string, string>;
  repo: Repository;
  config: ReturnType<typeof loadConfig>;
  service: CodePatrolService;
  ctx: RunContext;
};
type DispatchHandler = (context: DispatchContext) => Promise<CliResult> | CliResult;

type Handler =
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
  | "cleanup";
interface CommandSpec {
  route: string;
  options: string[];
  synopsis: string;
  handler: Handler;
}
const commonSource = ["--harness", "--model", "--context-profile"];
const commandRegistry: CommandSpec[] = [
  {
    route: "setup:",
    options: [
      "--base-branch",
      "--verification-argv",
      "--git-remote",
      "--github-repo",
      "--token-env",
      "--comments",
      "--push-main",
      "--dry-run",
      "--update",
    ],
    synopsis:
      "setup [--base-branch <branch>] [--verification-argv <JSON array>] [flags]",
    handler: "setup",
  },
  {
    route: "init:create",
    options: ["--title", "--brief"],
    synopsis: "init create --title <title> [--brief <text>]",
    handler: "init",
  },
  { route: "init:list", options: [], synopsis: "init list", handler: "init" },
  {
    route: "init:show",
    options: ["--init"],
    synopsis: "init show --init <id>",
    handler: "init",
  },
  {
    route: "init:resume",
    options: ["--init"],
    synopsis: "init resume --init <id>",
    handler: "init",
  },
  { route: "wave:list", options: [], synopsis: "wave list", handler: "wave" },
  {
    route: "wave:show",
    options: ["--wave"],
    synopsis: "wave show --wave <id>",
    handler: "wave",
  },
  {
    route: "wave:resume",
    options: ["--wave", "--operation"],
    synopsis: "wave resume --wave <id> --operation <plan|build>",
    handler: "wave",
  },
  { route: "work:list", options: [], synopsis: "work list", handler: "work" },
  {
    route: "work:show",
    options: ["--work"],
    synopsis: "work show --work <id>",
    handler: "work",
  },
  ...["spec", "plan", "build"].map((command) => ({
    route: `${command}:open`,
    options: [
      command === "spec" ? "--init" : "--wave",
      ...(command === "build" ? ["--from"] : []),
      ...commonSource,
      "--agents",
    ],
    synopsis: `${command} open ...`,
    handler: "producer" as Handler,
  })),
  ...["spec-review", "plan-review", "build-review"].map((command) => ({
    route: `${command}:open`,
    options: [command === "spec-review" ? "--init" : "--wave", ...commonSource],
    synopsis: `${command} open ...`,
    handler: "review" as Handler,
  })),
  { route: "task:list", options: [], synopsis: "task list", handler: "task" },
  {
    route: "task:show",
    options: ["--task"],
    synopsis: "task show --task <id>",
    handler: "task",
  },
  {
    route: "task:submit",
    options: ["--task", "--result"],
    synopsis: "task submit --task <id> --result -",
    handler: "task",
  },
  {
    route: "task:cancel",
    options: ["--task"],
    synopsis: "task cancel --task <id>",
    handler: "task",
  },
  {
    route: "task:fail",
    options: ["--task", "--reason"],
    synopsis: "task fail --task <id> --reason <text>",
    handler: "task",
  },
  {
    route: "task:retry",
    options: ["--task"],
    synopsis: "task retry --task <id>",
    handler: "task",
  },
  {
    route: "ship:show",
    options: ["--wave", "--context-profile"],
    synopsis: "ship show --wave <id>",
    handler: "ship",
  },
  {
    route: "ship:accept",
    options: ["--wave", "--confirm"],
    synopsis: "ship accept --wave <id> --confirm accept",
    handler: "ship",
  },
  {
    route: "ship:rollback",
    options: ["--wave", "--confirm"],
    synopsis: "ship rollback --wave <id> --confirm rollback",
    handler: "ship",
  },
  { route: "remote:sync", options: [], synopsis: "remote sync", handler: "remote" },
  { route: "doctor:", options: [], synopsis: "doctor", handler: "doctor" },
  { route: "cleanup:", options: [], synopsis: "cleanup", handler: "cleanup" },
];
const help = `CodePatrol ${VERSION}\n\nUsage:\n${commandRegistry.map(({ synopsis }) => `  codepatrol ${synopsis}`).join("\n")}\n\nGlobal: --workspace <path>, --verbose, --quiet, --help, --version\n\nExit codes:\n  0  success\n  1  workflow, verification, or internal failure\n  2  usage, configuration, repository, resolver, or result failure\n`;

export async function runCli(argv: string[]): Promise<CliResult> {
  let ctx: RunContext = systemRunContext();
  try {
    const globals = parseGlobals(argv.slice(2), process.cwd());
    if (globals.args.includes("--help") || globals.args.length === 0)
      return okText(help);
    if (globals.args.includes("--version")) return okText(`${VERSION}\n`);
    if (globals.verbose && globals.quiet)
      usage("--verbose and --quiet cannot be combined");
    ctx = systemRunContext({
      log: stderrLogger(globals.verbose ? "debug" : "silent"),
    });
    const repo = Repository.open(globals.workspace, ctx);
    const command = globals.args[0] as string;
    const action =
      command === "setup" ? undefined : (globals.args[1] as string | undefined);
    const options = parseFlags(globals.args.slice(command === "setup" ? 1 : 2));
    const spec = commandRegistry.find(
      (entry) => entry.route === `${command}:${action ?? ""}`,
    );
    if (!spec)
      usage(
        action
          ? `invalid subaction ${action} for ${command}`
          : `unknown command: ${command}`,
      );
    assertAllowedOptions(spec, options);
    if (spec.handler === "setup")
      return ok(
        setupRepository(repo, {
          baseBranch: options.get("--base-branch"),
          verificationArgv: options.get("--verification-argv"),
          gitRemote: options.get("--git-remote"),
          githubRepo: options.get("--github-repo"),
          tokenEnv: options.get("--token-env"),
          comments: options.get("--comments"),
          pushMain: options.get("--push-main"),
          dryRun: options.has("--dry-run"),
          update: options.has("--update"),
        }),
      );
    const config = loadConfig(repo.root);
    const service = new CodePatrolService(repo, config, ctx);
    const handler = handlers[spec.handler];
    const result = await handler({
      command,
      action,
      options,
      repo,
      config,
      service,
      ctx,
    });
    await dispatchHooks(command, action, options, result, { repo, config, ctx });
    return result;
  } catch (error) {
    const normalized =
      error instanceof CodePatrolError
        ? error
        : new CodePatrolError(
            ERROR_CODES.INTERNAL,
            error instanceof Error ? error.message : String(error),
            1,
            undefined,
            { cause: error },
          );
    return {
      exitCode: normalized.exitCode ?? 1,
      stdout: "",
      stderr: `${JSON.stringify({
        error: normalized.code,
        message: normalized.message,
        ...(normalized.details === undefined ? {} : { details: normalized.details }),
        ...(normalized.code === ERROR_CODES.INTERNAL && ctx.env("CODEPATROL_DEBUG")
          ? { stack: normalized.stack }
          : {}),
      })}\n`,
    };
  }
}

const handlers: Record<Handler, DispatchHandler> = {
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
    });
  },
  cleanup: ({ service }) => ok(service.cleanup()),
  setup: () => usage("setup must be dispatched before configuration loading"),
};

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

async function dispatchHooks(
  command: string,
  action: string | undefined,
  options: Map<string, string>,
  _result: CliResult,
  context: Pick<DispatchContext, "repo" | "config" | "ctx">,
): Promise<void> {
  const state = context.repo.readState().state;
  if (command === "ship" && (action === "accept" || action === "rollback")) {
    const wave = state.waves.find(
      (candidate) => candidate.id === options.get("--wave"),
    );
    if (wave?.ship)
      await syncHooks(
        context.repo,
        context.config,
        {
          kind: "ship",
          waveId: wave.id,
          decision: action,
          commit: wave.ship.candidateCommit,
        },
        context.ctx,
      );
    return;
  }
  if (command === "task" && action === "submit") {
    const taskId = parseTaskIdFromResult(_result);
    if (taskId) {
      const task = state.tasks.find((candidate) => candidate.id === taskId);
      if (task)
        await syncHooks(
          context.repo,
          context.config,
          { kind: "submit", task },
          context.ctx,
        );
    }
    return;
  }
  if (["spec", "plan", "build"].includes(command) && action === "open") {
    for (const taskId of parseTaskIdsFromResult(_result)) {
      const task = state.tasks.find((candidate) => candidate.id === taskId);
      if (task)
        await syncHooks(
          context.repo,
          context.config,
          { kind: "open", task },
          context.ctx,
        );
    }
  }
}

function parseTaskIdFromResult(result: CliResult): string | undefined {
  try {
    return (JSON.parse(result.stdout) as { task?: { id?: string } }).task?.id;
  } catch {
    return undefined;
  }
}

function parseTaskIdsFromResult(result: CliResult): string[] {
  try {
    return (
      (JSON.parse(result.stdout) as { tasks?: Array<{ task?: { id?: string } }> }).tasks
        ?.map((entry) => entry.task?.id)
        .filter((id): id is string => Boolean(id)) ?? []
    );
  } catch {
    return [];
  }
}

interface Globals {
  workspace: string;
  verbose: boolean;
  quiet: boolean;
  args: string[];
}

function parseGlobals(args: string[], cwd: string): Globals {
  let workspace = cwd;
  let verbose = false;
  let quiet = false;
  const rest: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--workspace") {
      workspace = args[index + 1] ?? usage("--workspace requires a path");
      index += 1;
    } else if (token === "--verbose") {
      verbose = true;
    } else if (token === "--quiet") {
      quiet = true;
    } else {
      rest.push(token as string);
    }
  }
  return { workspace, verbose, quiet, args: rest };
}

function parseFlags(args: string[]): Map<string, string> {
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    const equals = token?.indexOf("=") ?? -1;
    const name = equals < 0 ? token : token?.slice(0, equals);
    const inline = equals < 0 ? undefined : token?.slice(equals + 1);
    if ((name === "--dry-run" || name === "--update") && inline === undefined) {
      if (options.has(name)) usage(`duplicate option ${name}`);
      options.set(name, "true");
      continue;
    }
    const value = inline ?? args[++index];
    if (
      !name?.startsWith("--") ||
      value === undefined ||
      (inline === undefined && value.startsWith("--"))
    ) {
      usage(`invalid option near ${name ?? "end of command"}`);
    }
    if (options.has(name)) usage(`duplicate option ${name}`);
    options.set(name, value);
  }
  return options;
}

function required(options: Map<string, string>, name: string): string {
  return options.get(name) ?? usage(`${name} is required`);
}

function assertAllowedOptions(spec: CommandSpec, options: Map<string, string>): void {
  const known = spec.options;
  for (const option of options.keys()) {
    if (!known.includes(option)) usage(`unexpected option ${option}`);
  }
}

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

function ok(value: unknown): CliResult {
  return { exitCode: 0, stdout: `${JSON.stringify(value, null, 2)}\n`, stderr: "" };
}

function okText(value: string): CliResult {
  return { exitCode: 0, stdout: value, stderr: "" };
}
