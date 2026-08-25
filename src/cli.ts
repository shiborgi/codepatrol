import { type DispatchContext, type Handler, handlers } from "./cli-handlers.js";
import { loadConfig } from "./config.js";
import { CodePatrolError, ERROR_CODES, usage } from "./errors.js";
import { Repository } from "./git.js";
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
  {
    route: "trace:",
    options: ["--init", "--wave"],
    synopsis: "trace [--init <id> | --wave <id>]",
    handler: "trace",
  },
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
    const opened = Repository.open(globals.workspace, ctx);
    const repo = opened.resolveManagedOwner() ?? opened;
    const command = globals.args[0] as string;
    const standalone = command === "setup" || command === "trace";
    const action = standalone ? undefined : (globals.args[1] as string | undefined);
    const options = parseFlags(globals.args.slice(standalone ? 1 : 2));
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

function assertAllowedOptions(spec: CommandSpec, options: Map<string, string>): void {
  const known = spec.options;
  for (const option of options.keys()) {
    if (!known.includes(option)) usage(`unexpected option ${option}`);
  }
}

function ok(value: unknown): CliResult {
  return { exitCode: 0, stdout: `${JSON.stringify(value, null, 2)}\n`, stderr: "" };
}

function okText(value: string): CliResult {
  return { exitCode: 0, stdout: value, stderr: "" };
}
