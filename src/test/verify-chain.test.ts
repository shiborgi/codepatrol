import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const scripts = (
  JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { scripts: Record<string, string> }
).scripts;

/** The steps the verification chain must keep running. Removing one is a regression. */
const REQUIRED_STEPS = [
  "typecheck",
  "lint",
  "coverage:run",
  "smoke:run",
  "closed-loop:run",
  "local-delivery:run",
  "cli-check:run",
];

/** Steps that read the source tree directly and therefore need no build. */
const SOURCE_LEVEL_STEPS = new Set(["build", "typecheck", "lint"]);

function invocationsOf(script: string): string[] {
  return [...script.matchAll(/npm run ([\w:-]+)/g)].map((match) => match[1] as string);
}

test("verify builds the project exactly once", () => {
  const steps = invocationsOf(scripts.verify as string);
  const builds = steps.filter((step) => step === "build");
  assert.equal(builds.length, 1, `verify invokes build once, got ${builds.length}`);
  for (const step of steps) {
    if (SOURCE_LEVEL_STEPS.has(step)) continue;
    assert.ok(step.endsWith(":run"), `verify calls the build-free variant of each step, got ${step}`);
  }
});

test("verify runs every required step", () => {
  const steps = new Set(invocationsOf(scripts.verify as string));
  for (const required of REQUIRED_STEPS) {
    assert.ok(steps.has(required), `verify runs ${required}`);
  }
});

test("every build-free step has a standalone wrapper that builds first", () => {
  for (const name of Object.keys(scripts)) {
    if (!name.endsWith(":run")) continue;
    const standalone = name.slice(0, -":run".length);
    const wrapper = scripts[standalone];
    assert.ok(wrapper !== undefined, `${standalone} exists as the standalone form of ${name}`);
    assert.match(wrapper, /npm run build/, `${standalone} builds before running`);
    assert.ok(invocationsOf(wrapper).includes(name), `${standalone} delegates to ${name}`);
  }
});

test("CI runs the whole chain instead of enumerating its steps", () => {
  const workflow = readFileSync(join(repoRoot, ".github", "workflows", "verify.yml"), "utf8");
  const verifyJob = workflow.slice(workflow.indexOf("  verify:"), workflow.indexOf("  artifact:"));
  assert.match(verifyJob, /run: npm run verify/, "the verify job runs the full chain");
  for (const step of REQUIRED_STEPS) {
    assert.doesNotMatch(
      verifyJob,
      new RegExp(`run: npm run ${step.replace(":", "\\:")}\\b`),
      `the verify job does not run ${step} on its own`,
    );
  }
  assert.doesNotMatch(verifyJob, /run: npm test\b/, "the verify job does not run the test script on its own");
  assert.match(workflow, /os: \[ubuntu-latest, macos-latest\]/, "the operating system matrix is preserved");
  assert.match(workflow, /node: \["20", "22"\]/, "the Node version matrix is preserved");
  assert.match(workflow, /Validate the published artifact/, "the packaged artifact job still runs");
});

test("the suite is run with coverage measured by the native runner, with no new dependency", () => {
  const coverage = scripts["coverage:run"] as string;
  assert.match(coverage, /node --test/, "coverage comes from the Node test runner");
  assert.match(coverage, /--experimental-test-coverage/, "coverage is measured, not merely run");
  assert.doesNotMatch(coverage, /c8|nyc|istanbul/, "no coverage dependency is introduced");
  const manifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
    devDependencies: Record<string, string>;
    dependencies?: Record<string, string>;
  };
  assert.equal(manifest.dependencies, undefined, "the package still has no runtime dependency");
  for (const name of Object.keys(manifest.devDependencies)) {
    assert.doesNotMatch(name, /c8|nyc|istanbul/, `${name} is not a coverage tool`);
  }
});

test("the editorconfig agrees with the formatter configuration", () => {
  const biome = JSON.parse(readFileSync(join(repoRoot, "biome.json"), "utf8")) as {
    formatter: { indentStyle: string; indentWidth: number; lineWidth: number; lineEnding: string };
  };
  const editorconfig = readFileSync(join(repoRoot, ".editorconfig"), "utf8");
  assert.match(editorconfig, new RegExp(`indent_style = ${biome.formatter.indentStyle}`), "indent style agrees");
  assert.match(editorconfig, new RegExp(`indent_size = ${biome.formatter.indentWidth}`), "indent width agrees");
  assert.match(editorconfig, new RegExp(`max_line_length = ${biome.formatter.lineWidth}`), "line width agrees");
  assert.match(editorconfig, new RegExp(`end_of_line = ${biome.formatter.lineEnding}`), "line ending agrees");
});

test("lint is a check, never a rewrite, and the rewriting form is separate", () => {
  assert.equal(scripts.lint, "biome check", "the gate never writes");
  assert.match(scripts.format as string, /--write/, "the rewriting form is a separate script");
  assert.doesNotMatch(scripts.verify as string, /npm run format\b/, "verify never rewrites the source tree");
});

test("build-free steps never invoke the compiler themselves", () => {
  for (const [name, script] of Object.entries(scripts)) {
    if (!name.endsWith(":run")) continue;
    assert.doesNotMatch(script, /tsc|npm run build/, `${name} assumes dist already exists`);
  }
});
