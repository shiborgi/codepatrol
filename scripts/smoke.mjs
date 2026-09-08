import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const binary = resolve(process.argv[2] ?? "bin/codepatrol.js");
const entry = resolve(process.argv[3] ?? "dist/src/index.js");
const api = await import(pathToFileURL(entry).href);
assert.equal(api.VERSION, "1.0.0");
assert.equal(typeof api.plan, "function");
assert.equal(typeof api.run, "function");
assert.equal(typeof api.approve, "function");
const root = await mkdtemp(join(tmpdir(), "codepatrol-smoke-v1-"));
const fixture = resolve("test/fixtures/neural-adapter.mjs");
function invoke(argv, options = {}) {
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 16_777_216,
    ...options,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}
const command = (mode) => [process.execPath, fixture, mode];
try {
  await writeFile(join(root, "source.tsx"), "export const Component = () => null;\n");
  await writeFile(
    join(root, "codepatrol.json"),
    JSON.stringify({
      protocolVersion: "1.0",
      providers: {
        agents: { catalog: command("catalog"), resolve: command("resolve") },
        context: command("context"),
      },
      executor: command("execute"),
      verification: command("verify"),
      telemetry: { enabled: true },
    }),
  );
  invoke(["git", "init", "-q"]);
  invoke(["git", "add", "."]);
  invoke([
    "git",
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.test",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "fixture",
  ]);
  const input = JSON.stringify({
    protocolVersion: "1.0",
    root,
    task: "Repair React component",
  });
  const plan = JSON.parse(
    invoke([process.execPath, binary, "plan", "--input", "-"], { input }),
  );
  assert.equal(plan.stages.length, 7);
  const state = JSON.parse(
    invoke([process.execPath, binary, "run", "--input", "-"], { input }),
  );
  assert.equal(state.status, "awaiting-approval");
  assert.equal(
    await readFile(join(state.workspace, "BUILD.txt"), "utf8"),
    "implemented by fixture\n",
  );
  const approved = JSON.parse(
    invoke([
      process.execPath,
      binary,
      "approve",
      "--root",
      root,
      "--run",
      state.runId,
      "--confirm",
    ]),
  );
  assert.equal(approved.status, "approved");
  const summary = JSON.parse(
    invoke([process.execPath, binary, "telemetry", "summary", "--root", root]),
  );
  assert.equal(summary.events, 7);
  process.stdout.write(
    "v1 CLI smoke: seven stages, isolated build, verification, approval, telemetry passed\n",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
