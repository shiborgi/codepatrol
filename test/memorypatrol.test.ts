import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { configSchema, run } from "../src/index.js";

const adapter = resolve("test/fixtures/neural-adapter.mjs");

test("MemoryPatrol recalls canonical-root memory and persists executor-selected insights outside run state", async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "codepatrol-memory-")));
  const trace = join(root, "memory.trace.jsonl");
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = await import("node:child_process");
  const execFile = (args: string[]) =>
    new Promise<void>((resolvePromise, reject) => {
      git.execFile("git", args, { cwd: root }, (error) =>
        error ? reject(error) : resolvePromise(),
      );
    });
  await execFile(["init", "-q"]);
  await execFile([
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.test",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--allow-empty",
    "-qm",
    "fixture",
  ]);
  const command = (mode: string, behavior = "pass") => [
    process.execPath,
    adapter,
    mode,
    behavior,
  ];
  const settings = configSchema.parse({
    protocolVersion: "1.0",
    providers: {
      agents: { catalog: command("catalog"), resolve: command("resolve") },
      context: command("context"),
    },
    executor: [process.execPath, adapter, "execute", "memory", "", trace],
    verification: command("verify"),
    memorypatrol: {
      recall: [process.execPath, adapter, "memory", "pass", "", trace],
      remember: [process.execPath, adapter, "memory", "pass", "", trace],
      handoff: [process.execPath, adapter, "memory", "pass", "", trace],
    },
  });
  const state = await run(
    { protocolVersion: "1.0", root, task: "Remember boundary" },
    settings,
  );
  assert.equal(state.status, "awaiting-approval", state.error);
  assert.equal(JSON.stringify(state).includes("durable CodePatrol memory"), false);
  const events = (await readFile(trace, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  const memoryEvents = events.filter(
    (event) =>
      event.memory === "recall" ||
      event.memory === "remember" ||
      event.memory === "handoff",
  );
  assert.equal(memoryEvents.filter((event) => event.memory === "recall").length, 7);
  assert.equal(memoryEvents.filter((event) => event.memory === "remember").length, 1);
  assert.equal(memoryEvents.filter((event) => event.memory === "handoff").length, 7);
  assert.ok(memoryEvents.every((event) => event.root === root));
  const execution = events.find((event) => event.mode === "execute") as {
    memory?: { protocolVersion?: string; store?: string };
  };
  assert.equal(execution.memory?.protocolVersion, "1.0");
  assert.equal(execution.memory?.store, "codepatrol");
});

test("MemoryPatrol configuration is closed and its recall budget is process-bounded", () => {
  assert.throws(() =>
    configSchema.parse({
      protocolVersion: "1.0",
      memorypatrol: { unexpected: true },
    }),
  );
  assert.throws(() =>
    configSchema.parse({
      protocolVersion: "1.0",
      limits: { maxOutputBytes: 1024 },
      memorypatrol: { budget: { maxBytes: 2048 } },
    }),
  );
});
