import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { HARNESS_COMMANDS, HARNESSES, harnessBody } from "../adapters/harness-templates.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * What every harness command must say. The assertions live against the shared
 * source in `skills/harness/`, because that is where the content exists once;
 * `harness-templates.test.ts` proves the three harnesses carry it unchanged.
 */
for (const command of HARNESS_COMMANDS) {
  test(`the shared ${command} instructions bind the executor to the contract`, () => {
    const body = harnessBody(repoRoot, command);
    const skillPath = `skills/codepatrol-${command}/SKILL.md`;
    assert.ok(body.includes(skillPath), `references ${skillPath}`);
    assert.ok(existsSync(join(repoRoot, skillPath)), `${skillPath} exists`);
    assert.ok(body.includes("$ARGUMENTS"), "passes the operator's arguments through");
    assert.ok(body.includes("Do not edit refs/codepatrol/state manually"), "prohibits manual state editing");
  });
}

test("the shared build instructions confine implementation to the worktree", () => {
  const body = harnessBody(repoRoot, "build");
  assert.ok(body.includes("work exclusively in the"), "work happens in the worktree");
  assert.ok(body.includes("Never implement in the base checkout"), "never in the base checkout");
});

test("each harness directory holds exactly the six commands and nothing else", () => {
  for (const harness of HARNESSES) {
    const directory = join(repoRoot, harness.directory);
    assert.ok(existsSync(directory) && statSync(directory).isDirectory(), `${harness.directory} exists`);
    const files = readdirSync(directory)
      .filter((file) => file.endsWith(".md"))
      .sort();
    assert.deepEqual(files, HARNESS_COMMANDS.map((command) => `codepatrol-${command}.md`).sort(), harness.id);
  }
});

test("every harness command declares a non-empty description", () => {
  for (const harness of HARNESSES) {
    for (const command of HARNESS_COMMANDS) {
      const content = readFileSync(join(repoRoot, harness.directory, `codepatrol-${command}.md`), "utf8");
      const end = content.indexOf("---", 3);
      assert.ok(content.startsWith("---") && end > 0, `${harness.id}/${command} has frontmatter`);
      const description = /description:\s*(.+)/.exec(content.slice(3, end))?.[1]?.trim();
      assert.ok(description !== undefined, `${harness.id}/${command} declares a description`);
      assert.ok(description.length > 0, `${harness.id}/${command} description is non-empty`);
    }
  }
});
