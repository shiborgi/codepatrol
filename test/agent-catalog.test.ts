import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runCli } from "../src/cli.js";
import { validateConfig } from "../src/config.js";
import type { Source } from "../src/core.js";
import { parseResult } from "../src/validators.js";
import { fixture } from "./helpers.js";

const resolverScript = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../test/fixtures/fake-agent-resolver.mjs",
);

function catalog(mode: string, log: string, defaults = {}) {
  return {
    argv: [process.execPath, resolverScript, mode, log],
    timeoutMs: 10_000,
    defaults,
  };
}

async function cli(root: string, ...args: string[]) {
  return runCli(["node", "codepatrol", "--workspace", root, ...args]);
}

function requests(log: string): Array<{ reference: string; version: string }> {
  try {
    return readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { reference: string; version: string });
  } catch {
    return [];
  }
}

test("producer batches resolve before opening and return task envelopes", async () => {
  const log = resolve(tmpdir(), `codepatrol-agent-${process.pid}-${Date.now()}.log`);
  const { root, repo } = fixture(catalog("valid", log));
  const created = await cli(root, "init", "create", "--title", "Batch");
  const initId = (JSON.parse(created.stdout) as { id: string }).id;
  const opened = await cli(
    root,
    "spec",
    "open",
    "--init",
    initId,
    "--harness",
    "test",
    "--agents",
    "agentpatrol/first@1.0.0,agentpatrol/second@1.0.0",
  );
  assert.equal(opened.exitCode, 0, opened.stderr);
  const output = JSON.parse(opened.stdout) as {
    tasks: Array<{ task: { source: Source } }>;
  };
  assert.equal(output.tasks.length, 2);
  assert.deepEqual(
    output.tasks.map(({ task }) => task.source.agent),
    ["agentpatrol/first", "agentpatrol/second"],
  );
  assert.deepEqual(
    requests(log).map(({ reference, version }) => ({ reference, version })),
    [
      { reference: "agentpatrol/first", version: "1.0.0" },
      { reference: "agentpatrol/second", version: "1.0.0" },
    ],
  );
  assert.equal(repo.readState().state.tasks.length, 2);
});

test("producer profiles form a cartesian batch and none omits snapshots", async () => {
  const log = resolve(tmpdir(), `codepatrol-agent-${process.pid}-${Date.now()}.log`);
  const { root, repo } = fixture(catalog("valid", log));
  const created = await cli(root, "init", "create", "--title", "Profiles");
  const initId = (JSON.parse(created.stdout) as { id: string }).id;
  const opened = await cli(
    root,
    "spec",
    "open",
    "--init",
    initId,
    "--harness",
    "test",
    "--agents",
    "agentpatrol/first@1.0.0,agentpatrol/second@1.0.0",
    "--context-profile",
    "none,none",
  );
  assert.equal(opened.exitCode, 0, opened.stderr);
  const output = JSON.parse(opened.stdout) as {
    tasks: Array<{ task: { source: Source; contextSnapshot?: unknown } }>;
  };
  assert.equal(output.tasks.length, 4);
  assert.deepEqual(
    output.tasks.map(({ task }) => task.source.agent),
    [
      "agentpatrol/first",
      "agentpatrol/first",
      "agentpatrol/second",
      "agentpatrol/second",
    ],
  );
  assert.ok(output.tasks.every(({ task }) => task.contextSnapshot === undefined));
  assert.equal(repo.readState().state.tasks.length, 4);
});

test("producer selection is explicit and legacy role flags are rejected", async () => {
  const { root } = fixture();
  const created = await cli(root, "init", "create", "--title", "Explicit");
  const initId = (JSON.parse(created.stdout) as { id: string }).id;
  const missing = await cli(
    root,
    "spec",
    "open",
    "--init",
    initId,
    "--harness",
    "test",
  );
  assert.equal(JSON.parse(missing.stderr).error, "USAGE");
  const legacy = await cli(
    root,
    "spec",
    "open",
    "--init",
    initId,
    "--harness",
    "test",
    "--agent",
    "agentpatrol/legacy",
  );
  assert.equal(JSON.parse(legacy.stderr).error, "USAGE");
  const invalidReference = await cli(
    root,
    "spec",
    "open",
    "--init",
    initId,
    "--harness",
    "test",
    "--agents",
    "legacy@1.0.0",
  );
  assert.equal(JSON.parse(invalidReference.stderr).error, "AGENT_RESOLVER_MISMATCH");
});

test("producer defaults are used only when --agents is omitted", async () => {
  const log = resolve(tmpdir(), `codepatrol-agent-${process.pid}-${Date.now()}.log`);
  const { root } = fixture(
    catalog("valid", log, {
      spec: { agent: "agentpatrol/default-spec", version: "1.0.0" },
    }),
  );
  const created = await cli(root, "init", "create", "--title", "Default");
  const initId = (JSON.parse(created.stdout) as { id: string }).id;
  const opened = await cli(root, "spec", "open", "--init", initId, "--harness", "test");
  assert.equal(opened.exitCode, 0, opened.stderr);
  assert.equal(
    (JSON.parse(opened.stdout) as { tasks: Array<{ task: { source: Source } }> })
      .tasks[0]?.task.source.agent,
    "agentpatrol/default-spec",
  );
  const explicit = await cli(
    root,
    "spec",
    "open",
    "--init",
    initId,
    "--harness",
    "test",
    "--agents",
    "agentpatrol/explicit@1.0.0",
  );
  assert.equal(explicit.exitCode, 0, explicit.stderr);
  assert.equal(
    (JSON.parse(explicit.stdout) as { tasks: Array<{ task: { source: Source } }> })
      .tasks[0]?.task.source.agent,
    "agentpatrol/explicit",
  );
});

test("producer resolver failure leaves state and worktrees untouched", async () => {
  const log = resolve(tmpdir(), `codepatrol-agent-${process.pid}-${Date.now()}.log`);
  const { root, repo } = fixture(catalog("malformed", log));
  const created = await cli(root, "init", "create", "--title", "Failure");
  const initId = (JSON.parse(created.stdout) as { id: string }).id;
  const before = repo.readState().state.sequence;
  const result = await cli(
    root,
    "spec",
    "open",
    "--init",
    initId,
    "--harness",
    "test",
    "--agents",
    "agentpatrol/one@1.0.0,agentpatrol/two@1.0.0",
  );
  assert.equal(JSON.parse(result.stderr).error, "AGENT_RESOLVER_INVALID_RESPONSE");
  assert.equal(repo.readState().state.sequence, before);
  assert.deepEqual(repo.readState().state.tasks, []);
  assert.deepEqual(repo.listManagedWorktrees(), []);
});

test("reviews resolve their configured single default without role flags", async () => {
  const log = resolve(tmpdir(), `codepatrol-agent-${process.pid}-${Date.now()}.log`);
  const { root, service } = fixture(
    catalog("valid", log, {
      "spec-review": { agent: "agentpatrol/chief-architect", version: "1.0.0" },
    }),
  );
  const init = service.createInit("Review", "Review default");
  const task = service.openProducer("spec", init.id, {
    harness: "test",
    model: null,
    agent: null,
  }).task;
  const proposalId = service.submitTask(task.id, {
    title: "Review",
    intent: "Review",
    waves: [
      {
        key: "one",
        title: "One",
        works: [
          {
            key: "one",
            title: "One",
            description: "One",
            acceptance: ["One"],
            blockedBy: [],
          },
        ],
      },
    ],
  }).task.proposalId as string;
  assert.ok(proposalId);
  const review = await cli(
    root,
    "spec-review",
    "open",
    "--init",
    init.id,
    "--harness",
    "reviewer",
  );
  assert.equal(review.exitCode, 0, review.stderr);
  assert.equal(
    (JSON.parse(review.stdout) as { task: { source: Source } }).task.source.agent,
    "agentpatrol/chief-architect",
  );
  assert.equal(requests(log).length, 1);
});

test("configuration accepts producer defaults and remains lean without them", () => {
  const config = validateConfig({
    schemaVersion: 1,
    verification: { argv: ["true"] },
    maxReviewReturns: 3,
    agentCatalog: {
      argv: ["agentpatrol", "resolve", "--json"],
      defaults: { spec: { agent: "agentpatrol/architect", version: "1.0.0" } },
    },
  });
  assert.equal(config.agentCatalog?.defaults.spec?.agent, "agentpatrol/architect");
  assert.deepEqual(
    validateConfig({ schemaVersion: 1, verification: { argv: ["true"] } }).agentCatalog,
    undefined,
  );
});

test("review candidate scores are optional integers from 0 through 100", () => {
  const base = {
    decision: "return" as const,
    summary: "Reviewed",
    candidates: [{ proposalId: "PROP-1", status: "failed" as const, summary: "No" }],
  };
  const parsed = (value: unknown) => {
    const result = parseResult("spec-review", value);
    assert.ok("candidates" in result);
    return result;
  };
  assert.equal(parsed(base).candidates[0]?.score, undefined);
  assert.equal(
    parsed({ ...base, candidates: [{ ...base.candidates[0], score: 0 }] }).candidates[0]
      ?.score,
    0,
  );
  assert.equal(
    parsed({ ...base, candidates: [{ ...base.candidates[0], score: 100 }] })
      .candidates[0]?.score,
    100,
  );
  for (const score of [-1, 101, 1.5]) {
    assert.throws(() =>
      parsed({ ...base, candidates: [{ ...base.candidates[0], score }] }),
    );
  }
});
