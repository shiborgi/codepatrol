import { STAGES } from "../core/work.js";

/**
 * The command surface, declared once. The help text is rendered from these
 * lines and the structural contract test resolves invocations against them,
 * so a command documented here and a command the CLI prints can never be two
 * different things.
 */
const USAGE_LINES: readonly string[] = [
  "initiative list",
  "initiative show <id>",
  "work list",
  "work show <id>",
  "wave list [--initiative <id>]",
  "wave show <id>",
  "wave verdict --wave <id> --result <verdict.json>",
  "work graph",
  "work reblock --work <id> [--blocked-by <id>]... --reason <reason.json>",
  "work evidence <id>",
  "spec start --initiative <id> --todo <todo.json> [--harness <name>] [--model <name>] [--profile <name>]",
  "spec validate --initiative <id> --run <run-id> --file <document.json>",
  "spec complete --initiative <id> --run <run-id> --result <result.json> [--file <document.json>]",
  "spec show --initiative <id> [--revision <number>]",
  "spec history --initiative <id>",
  "<stage> start --work <id> --todo <todo.json> [--harness <name>] [--model <name>] [--profile <name>]",
  "<stage> complete --work <id> --run <run-id> --result <result.json>",
  "plan start --wave <id> --todo <wave-todo.json> [--harness <name>] [--model <name>] [--profile <name>]",
  "review start --wave <id> --todo <wave-todo.json> [--harness <name>] [--model <name>] [--profile <name>]",
  "build start --wave <id> --todo <wave-todo.json> [--harness <name>] [--model <name>] [--profile <name>]",
  "verify start --wave <id> --todo <wave-todo.json> [--harness <name>] [--model <name>] [--profile <name>]",
  "plan complete --wave <id> --result <wave-result.json>",
  "review complete --wave <id> --result <wave-result.json>",
  "build complete --wave <id> --result <wave-result.json>",
  "verify complete --wave <id> --result <wave-result.json>",
  "ship complete --work <id> --run <run-id> --result <result.json> [--publish]",
  "ship publish --work <id>",
  "sync [--work <id>]",
  "project prepare",
  "improve inspect [--initiative <id>] [--since <YYYY-MM-DD>] [--format json]",
  "state status [--remote <name>]",
  "state fetch [--remote <name>]",
  "state push [--remote <name>]",
];

/** Flags every command accepts, regardless of its own declaration. */
const GLOBAL_FLAGS: readonly string[] = ["workspace", "help", "version"];

export interface CommandSpec {
  /** Command path, e.g. ["spec", "start"]. Stage placeholders are expanded. */
  path: readonly string[];
  /** Long flag names the command declares, without the leading dashes. */
  flags: readonly string[];
  /** The usage line this spec was derived from, with <stage> still in place. */
  usage: string;
}

/** Strips the decorations a usage line uses to mark optionality and repetition. */
function bareToken(token: string): string {
  return token.replace(/[[\]`,.]+$/g, "").replace(/^[[`]+/g, "");
}

function isPathToken(token: string): boolean {
  return /^[a-z][a-z-]*$/.test(token) || token === "<stage>";
}

function parseUsageLine(usage: string): { path: string[]; flags: string[] } {
  const path: string[] = [];
  const flags: string[] = [];
  let inPath = true;
  for (const raw of usage.split(/\s+/).filter((t) => t !== "")) {
    const token = bareToken(raw);
    if (token === "") continue;
    if (token.startsWith("--")) {
      inPath = false;
      flags.push(token.slice(2));
      continue;
    }
    if (inPath && isPathToken(token)) {
      path.push(token);
      continue;
    }
    inPath = false;
  }
  return { path, flags };
}

/**
 * The declared surface with `<stage>` expanded into one spec per stage, so a
 * caller can resolve "plan start" without knowing about the placeholder.
 */
export function commandSurface(): CommandSpec[] {
  const specs: CommandSpec[] = [];
  for (const usage of USAGE_LINES) {
    const { path, flags } = parseUsageLine(usage);
    if (path[0] === "<stage>") {
      for (const stage of STAGES) {
        specs.push({ path: [stage, ...path.slice(1)], flags, usage });
      }
    } else {
      specs.push({ path, flags, usage });
    }
  }
  return specs;
}

/**
 * Resolves an invocation's tokens to the declared command with the longest
 * matching path prefix. Positional arguments after the path are ignored.
 */
export function resolveCommand(
  tokens: readonly string[],
  surface: readonly CommandSpec[] = commandSurface(),
): CommandSpec | undefined {
  let best: CommandSpec | undefined;
  for (const spec of surface) {
    if (spec.path.length > tokens.length) continue;
    if (!spec.path.every((segment, index) => segment === tokens[index])) continue;
    if (best === undefined || spec.path.length > best.path.length) best = spec;
  }
  return best;
}

/** Merges the declared flags of every command sharing a path prefix. */
export function acceptedFlags(spec: CommandSpec, surface: readonly CommandSpec[] = commandSurface()): Set<string> {
  const accepted = new Set<string>([...spec.flags, ...GLOBAL_FLAGS]);
  for (const other of surface) {
    if (other.path.length !== spec.path.length) continue;
    if (!other.path.every((segment, index) => segment === spec.path[index])) continue;
    for (const flag of other.flags) accepted.add(flag);
  }
  return accepted;
}

export function renderHelp(): string {
  const lines = USAGE_LINES.map((usage) => `  codepatrol ${usage}`).join("\n");
  return `codepatrol — minimal workflow and state orchestrator

Usage:
${lines}

Stages: ${STAGES.join(", ")}

Global flags:
  --workspace <path>   repository root (default: current directory)
  --help               show this help
  --version            show version
`;
}
