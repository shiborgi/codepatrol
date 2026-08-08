import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { HARNESS_COMMANDS, HARNESSES, harnessBody, renderHarnessCommands } from "../adapters/harness-templates.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function bodyOf(markdown: string): string {
  const end = markdown.indexOf("\n---\n", 4);
  assert.ok(end > 0, "the file has frontmatter");
  return markdown.slice(end + 5).replace(/^\n+/, "");
}

test("every harness command file matches the shared source", () => {
  const rendered = renderHarnessCommands(repoRoot);
  assert.equal(rendered.size, HARNESSES.length * HARNESS_COMMANDS.length, "eighteen files are rendered");
  const drifted: string[] = [];
  for (const [relative, expected] of rendered) {
    if (readFileSync(join(repoRoot, relative), "utf8") !== expected) drifted.push(relative);
  }
  assert.deepEqual(drifted, [], "no harness command file drifted from skills/harness/");
});

test("the instruction body is identical across the three harnesses", () => {
  for (const command of HARNESS_COMMANDS) {
    const shared = harnessBody(repoRoot, command);
    for (const harness of HARNESSES) {
      const file = join(repoRoot, harness.directory, `codepatrol-${command}.md`);
      assert.equal(bodyOf(readFileSync(file, "utf8")), shared, `${harness.id} carries the shared body of ${command}`);
    }
  }
});

test("each harness keeps the frontmatter it requires", () => {
  const rendered = renderHarnessCommands(repoRoot);
  for (const harness of HARNESSES) {
    for (const command of HARNESS_COMMANDS) {
      const content = rendered.get(join(harness.directory, `codepatrol-${command}.md`));
      assert.ok(content !== undefined, `${harness.id} resolves codepatrol-${command}`);
      assert.match(content, /^---\ndescription: .+/, `${harness.id} declares a description for ${command}`);
      if (harness.frontmatter.includes("argument-hint")) {
        assert.match(content, /argument-hint: </, `${harness.id} declares an argument hint for ${command}`);
      } else {
        assert.doesNotMatch(content, /argument-hint:/, `${harness.id} carries no argument hint`);
      }
    }
  }
});

test("a divergent copy is detected rather than tolerated", () => {
  const rendered = renderHarnessCommands(repoRoot);
  const relative = join(HARNESSES[0]?.directory as string, "codepatrol-plan.md");
  const expected = rendered.get(relative) as string;
  const tampered = `${expected}\nAn extra step known only by this harness.\n`;
  assert.notEqual(tampered, expected, "the comparison the drift test performs distinguishes the two");
  assert.notEqual(
    bodyOf(tampered),
    harnessBody(repoRoot, "plan"),
    "a body-level divergence is visible to the body comparison",
  );
});
