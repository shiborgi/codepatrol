import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { files: string[] };

/** The paths the README lists as delivered, extracted from the README itself. */
function promisedHarnessFiles(): string[] {
  const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
  return [...readme.matchAll(/^- `(\.(?:opencode|claude|pi)\/[^`]+)`$/gm)].map((match) => match[1] as string);
}

function includedByManifest(relative: string): boolean {
  return manifest.files.some((entry) => {
    if (entry.startsWith("!")) return false;
    return relative === entry || relative.startsWith(`${entry}/`);
  });
}

test("the README promises the eighteen harness command files", () => {
  assert.equal(promisedHarnessFiles().length, 18, "six commands for each of the three harnesses");
});

test("every file the README promises exists and is packaged", () => {
  const missingOnDisk: string[] = [];
  const missingFromPackage: string[] = [];
  for (const relative of promisedHarnessFiles()) {
    if (!existsSync(join(repoRoot, relative))) missingOnDisk.push(relative);
    if (!includedByManifest(relative)) missingFromPackage.push(relative);
  }
  assert.deepEqual(missingOnDisk, [], "the promised files exist in the repository");
  assert.deepEqual(missingFromPackage, [], "the promised files are covered by package.json files");
});

test("the compiled tests stay out of the published package", () => {
  assert.ok(manifest.files.includes("!dist/test"), "dist/test is excluded");
});

test("the packaged artifact job checks the promised templates", () => {
  const workflow = readFileSync(join(repoRoot, ".github", "workflows", "verify.yml"), "utf8");
  for (const directory of [".opencode/commands", ".claude/commands", ".pi/prompts"]) {
    assert.ok(
      workflow.includes(`node_modules/codepatrol/${directory}/codepatrol-$stage.md`),
      `the artifact job verifies ${directory} in the clean install`,
    );
  }
});
