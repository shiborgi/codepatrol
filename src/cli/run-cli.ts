import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { acquireLock } from "../adapters/lock.js";
import { CodepatrolError, fail } from "../core/errors.js";
import { prettyJson } from "../core/json.js";
import { parseStage, STAGES } from "../core/work.js";
import { parseArgs } from "./args.js";
import { improveCommand, initiativeCommand, waveCommand, workCommand } from "./commands/inspect.js";
import { projectCommand, shipPublishCommand, stateCommand, syncCommand } from "./commands/remote.js";
import { specCommand } from "./commands/spec.js";
import { stageCommand } from "./commands/stage.js";
import { type Context, makeContext, type RunCliOptions } from "./context.js";
import { acceptedFlags, renderHelp, resolveCommand } from "./surface.js";

export type { CliIO, RunCliOptions } from "./context.js";

const HELP = renderHelp();

export async function runCli(argv: string[], options: RunCliOptions): Promise<number> {
  const { io } = options;
  try {
    const { rest, workspace } = extractWorkspace(argv);
    const cwd = options.cwd ?? workspace ?? process.cwd();
    const ctx = makeContext({ ...options, cwd });
    if (options.lock === false || !isMutating(rest)) {
      return await dispatch(rest, ctx);
    }
    const release = await acquireLock(ctx.git, cwd, rest.join(" "), options.now);
    try {
      return await dispatch(rest, ctx);
    } finally {
      await release();
    }
  } catch (error) {
    if (error instanceof CodepatrolError) {
      io.err(prettyJson({ error: error.code, message: error.message }));
      return error.exitCode;
    }
    io.err(prettyJson({ error: "INTERNAL", message: error instanceof Error ? error.message : String(error) }));
    return 1;
  }
}

/** Commands that write state take the repository lock; readers never do. */
const MUTATING = new Set([
  "wave:verdict",
  "spec:start",
  "spec:complete",
  "sync",
  "state:fetch",
  "state:push",
  "work:reblock",
  "plan:start",
  "plan:complete",
  "review:start",
  "review:complete",
  "build:start",
  "build:complete",
  "verify:start",
  "verify:complete",
  "ship:start",
  "ship:complete",
  "ship:publish",
]);

function isMutating(argv: string[]): boolean {
  const [command, sub] = argv;
  if (command === undefined) return false;
  if (command === "sync") return true;
  return MUTATING.has(`${command}:${sub ?? ""}`);
}

function extractWorkspace(argv: string[]): { rest: string[]; workspace?: string } {
  const rest: string[] = [];
  let workspace: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] as string;
    if (token === "--workspace") {
      workspace = argv[index + 1];
      if (workspace === undefined) fail("USAGE", "--workspace requires a value");
      index += 1;
    } else if (token.startsWith("--workspace=")) {
      workspace = token.slice("--workspace=".length);
    } else {
      rest.push(token);
    }
  }
  return workspace !== undefined ? { rest, workspace } : { rest };
}

async function dispatch(argv: string[], ctx: Context): Promise<number> {
  if (argv.includes("--help") || argv.length === 0) {
    ctx.io.out(HELP);
    return 0;
  }
  if (argv.includes("--version")) {
    ctx.io.out(`${readVersion()}\n`);
    return 0;
  }
  const args = parseArgs(argv);
  const [command, sub, ...rest] = args.positionals;
  if (command === undefined) {
    ctx.io.out(HELP);
    return 0;
  }
  const spec = resolveCommand(args.positionals);
  if (spec !== undefined) {
    const allowed = acceptedFlags(spec);
    for (const name of args.flags.keys()) {
      if (!allowed.has(name)) fail("USAGE", `--${name} is not accepted by ${spec.path.join(" ")}`);
    }
  }

  switch (command) {
    case "initiative":
      return initiativeCommand(sub, rest, ctx);
    case "work":
      return workCommand(sub, rest, ctx, args);
    case "wave":
      return waveCommand(sub, rest, ctx, args);
    case "spec":
      return specCommand(sub, args, ctx);
    case "sync":
      return syncCommand(args, ctx);
    case "improve":
      return improveCommand(sub, args, ctx);
    case "state":
      return stateCommand(sub, args, ctx);
    case "project":
      return projectCommand(sub, ctx);
    default:
      if (command === "ship" && sub === "publish") {
        return shipPublishCommand(args, ctx);
      }
      if ((STAGES as readonly string[]).includes(command)) {
        return stageCommand(parseStage(command), sub, args, ctx);
      }
      fail("USAGE", `unknown command ${JSON.stringify(command)}\n${HELP}`);
  }
}

/** The published version, read from the manifest so the two cannot drift. */
function readVersion(): string {
  const manifest = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
  const parsed = JSON.parse(readFileSync(manifest, "utf8")) as { version?: unknown };
  if (typeof parsed.version !== "string" || parsed.version.trim() === "") {
    fail("INVALID_STATE", "package.json declares no version");
  }
  return parsed.version;
}
