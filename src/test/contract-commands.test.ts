import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { acceptedFlags, commandSurface, resolveCommand } from "../cli/surface.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONTRACTS = ["spec", "plan", "review", "build", "verify", "ship"] as const;

interface Invocation {
  line: number;
  text: string;
}

/**
 * Collects every `codepatrol ...` invocation a contract shows, both inside
 * fenced code blocks and inside inline code spans. Prose is ignored.
 */
function invocationsOf(markdown: string): Invocation[] {
  const found: Invocation[] = [];
  let fenced = false;
  markdown.split("\n").forEach((raw, index) => {
    const line = raw.trim();
    if (line.startsWith("```")) {
      fenced = !fenced;
      return;
    }
    if (fenced) {
      if (line.startsWith("codepatrol ")) found.push({ line: index + 1, text: line });
      return;
    }
    for (const match of raw.matchAll(/`([^`]+)`/g)) {
      const span = (match[1] as string).trim();
      if (span.startsWith("codepatrol ")) found.push({ line: index + 1, text: span });
    }
  });
  return found;
}

function tokensOf(invocation: string): { path: string[]; flags: string[] } {
  const withoutComment = invocation.split(" #")[0] as string;
  const raw = withoutComment
    .split(/\s+/)
    .slice(1)
    .filter((token) => token !== "");
  const cleaned = raw.map((token) =>
    token
      .replace(/^[[`]+/, "")
      .replace(/[\]`,]+$/, "")
      .replace(/\.\.\.$/, ""),
  );
  const path: string[] = [];
  const flags: string[] = [];
  let inPath = true;
  for (const token of cleaned) {
    if (token === "") continue;
    if (token.startsWith("--")) {
      inPath = false;
      const eq = token.indexOf("=");
      flags.push(eq === -1 ? token.slice(2) : token.slice(2, eq));
      continue;
    }
    if (inPath && /^[a-z][a-z-]*$/.test(token)) {
      path.push(token);
      continue;
    }
    inPath = false;
  }
  return { path, flags };
}

/** Returns one message per invocation the CLI surface does not recognise. */
function violationsOf(markdown: string, source: string): string[] {
  const surface = commandSurface();
  const violations: string[] = [];
  for (const invocation of invocationsOf(markdown)) {
    const { path, flags } = tokensOf(invocation.text);
    const spec = resolveCommand(path, surface);
    if (spec === undefined) {
      violations.push(`${source}:${invocation.line}: unknown subcommand in ${JSON.stringify(invocation.text)}`);
      continue;
    }
    const accepted = acceptedFlags(spec, surface);
    for (const flag of flags) {
      if (!accepted.has(flag)) {
        violations.push(
          `${source}:${invocation.line}: --${flag} is not accepted by "codepatrol ${spec.path.join(" ")}"`,
        );
      }
    }
  }
  return violations;
}

for (const contract of CONTRACTS) {
  const relative = join("skills", `codepatrol-${contract}`, "SKILL.md");
  test(`${relative} only cites commands the CLI surface declares`, () => {
    const markdown = readFileSync(join(repoRoot, relative), "utf8");
    const invocations = invocationsOf(markdown);
    assert.ok(invocations.length > 0, `${relative} shows at least one codepatrol invocation`);
    assert.deepEqual(violationsOf(markdown, relative), [], `${relative} cites only declared commands`);
  });
}

test("the README cites only commands the CLI surface declares", () => {
  const markdown = readFileSync(join(repoRoot, "README.md"), "utf8");
  const invocations = invocationsOf(markdown);
  assert.ok(invocations.length > 0, "the README shows codepatrol invocations");
  assert.deepEqual(violationsOf(markdown, "README.md"), [], "the README cites only declared commands");
});

test("the README's usage block shows the commands an operator has to reach for", () => {
  const markdown = readFileSync(join(repoRoot, "README.md"), "utf8");
  const usage = markdown.slice(markdown.indexOf("## Usage"), markdown.indexOf("## Exit codes"));
  for (const expected of ["codepatrol project prepare", "--wave", "codepatrol spec start", "codepatrol sync"]) {
    assert.ok(usage.includes(expected), `the usage block shows ${expected}`);
  }
});

test("the README declares what each exit code means", () => {
  const markdown = readFileSync(join(repoRoot, "README.md"), "utf8");
  const section = markdown.slice(markdown.indexOf("## Exit codes"));
  assert.ok(section.length > 0, "the README has an exit-code section");
  for (const code of ["`0`", "`1`", "`2`"]) {
    assert.ok(section.includes(code), `the section declares ${code}`);
  }
  assert.match(section, /project prepare/, "the negative exit of project prepare is called out");
});

test("an invented subcommand or flag is reported as a violation", () => {
  const broken = [
    "```bash",
    "codepatrol frobnicate --work WORK-1.1.1",
    "codepatrol plan start --work WORK-1.1.1 --todo todo.json --nonexistent value",
    "```",
  ].join("\n");
  const violations = violationsOf(broken, "synthetic.md");
  assert.equal(violations.length, 2, "both the unknown subcommand and the unknown flag are reported");
  assert.match(violations[0] as string, /unknown subcommand/);
  assert.match(violations[1] as string, /--nonexistent is not accepted/);
});

test("the extractor reads fenced blocks and inline spans, and ignores prose", () => {
  const markdown = [
    "Run codepatrol sync when the projection drifts.",
    "Retry with `codepatrol ship publish --work <id>`.",
    "```",
    "codepatrol work list",
    "```",
  ].join("\n");
  assert.deepEqual(
    invocationsOf(markdown).map((i) => i.text),
    ["codepatrol ship publish --work <id>", "codepatrol work list"],
  );
});

test("the surface expands the stage placeholder into every stage", () => {
  const surface = commandSurface();
  for (const stage of ["plan", "review", "build", "verify", "ship"]) {
    const spec = resolveCommand([stage, "start"], surface);
    assert.ok(spec !== undefined, `${stage} start is declared`);
    assert.ok(acceptedFlags(spec).has("todo"), `${stage} start accepts --todo`);
  }
  assert.equal(
    resolveCommand(["plan", "publish"], surface),
    undefined,
    "an undeclared stage subcommand does not resolve",
  );
  assert.ok(resolveCommand(["ship", "publish"], surface) !== undefined, "ship publish is declared on its own");
});
