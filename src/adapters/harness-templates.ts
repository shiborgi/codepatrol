import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fail } from "../core/errors.js";

/**
 * Every harness resolves the same six commands. The instruction body lives
 * once, in `skills/harness/<command>.md`; a harness contributes only the
 * frontmatter keys it understands.
 */
export interface HarnessSpec {
  /** Identifier used in messages. */
  id: string;
  /** Directory the harness reads its commands from, relative to the repo root. */
  directory: string;
  /** Frontmatter keys this harness supports, in the order it expects them. */
  frontmatter: readonly string[];
}

export const HARNESSES: readonly HarnessSpec[] = [
  { id: "opencode", directory: join(".opencode", "commands"), frontmatter: ["description"] },
  { id: "claude", directory: join(".claude", "commands"), frontmatter: ["description", "argument-hint"] },
  { id: "pi", directory: join(".pi", "prompts"), frontmatter: ["description", "argument-hint"] },
];

export const HARNESS_COMMANDS = ["spec", "plan", "review", "build", "verify", "ship"] as const;
export type HarnessCommand = (typeof HARNESS_COMMANDS)[number];

const SOURCE_DIR = join("skills", "harness");

interface CommandsFile {
  schemaVersion: number;
  commands: Record<string, Record<string, string>>;
}

function readCommandsFile(repoRoot: string): CommandsFile {
  const parsed = JSON.parse(readFileSync(join(repoRoot, SOURCE_DIR, "commands.json"), "utf8")) as CommandsFile;
  if (parsed.schemaVersion !== 1) {
    fail("INVALID_INPUT", `harness commands: unsupported schemaVersion ${JSON.stringify(parsed.schemaVersion)}`);
  }
  return parsed;
}

/**
 * Renders every harness command file from the single shared source. The keys
 * are repository-relative paths; regenerating and comparing is what keeps the
 * three harnesses from drifting apart.
 */
export function renderHarnessCommands(repoRoot: string): Map<string, string> {
  const { commands } = readCommandsFile(repoRoot);
  const rendered = new Map<string, string>();
  for (const command of HARNESS_COMMANDS) {
    const fields = commands[command];
    if (fields === undefined) fail("INVALID_INPUT", `harness commands: ${command} is not declared`);
    const body = readFileSync(join(repoRoot, SOURCE_DIR, `${command}.md`), "utf8");
    for (const harness of HARNESSES) {
      const frontmatter = harness.frontmatter
        .filter((key) => fields[key] !== undefined)
        .map((key) => `${key}: ${fields[key]}`)
        .join("\n");
      rendered.set(join(harness.directory, `codepatrol-${command}.md`), `---\n${frontmatter}\n---\n\n${body}`);
    }
  }
  return rendered;
}

/** The shared instruction body of a command, without any harness frontmatter. */
export function harnessBody(repoRoot: string, command: HarnessCommand): string {
  return readFileSync(join(repoRoot, SOURCE_DIR, `${command}.md`), "utf8");
}
