import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runCli } from "../src/cli.js";
import {
  type AgentInventoryEntry,
  deriveTaskClass,
  emptyMemory,
  type OrchestratorConfig,
  rankRoutes,
  selectRoutesForFanout,
} from "../src/orchestrator.js";
import { fixture, git } from "./helpers.js";

const resolverScript = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../test/fixtures/fake-agent-resolver.mjs",
);

const inventory: AgentInventoryEntry[] = [
  {
    reference: "agentpatrol/developer",
    version: "1.0.0",
    capabilities: ["build", "implementation"],
    operations: ["build"],
  },
  {
    reference: "agentpatrol/frontend-engineer",
    version: "1.0.0",
    capabilities: ["build", "frontend", "interaction"],
    operations: ["build"],
  },
  {
    reference: "agentpatrol/sre-engineer",
    version: "1.0.0",
    capabilities: ["build", "operations", "reliability"],
    operations: ["build"],
  },
];

const config: OrchestratorConfig = {
  policyVersion: "1",
  uncertaintyThreshold: 5,
  maxFanout: 2,
  minObservations: 3,
  explorationInterval: 10,
  coldStartPrior: 20,
  maxObservations: 5000,
  maxAggregates: 1000,
};

test("normalizes frontend task-language aliases", () => {
  for (const subject of [
    "front page",
    "frontend screen",
    "ui flow",
    "interaction design",
  ]) {
    assert.equal(deriveTaskClass(subject, inventory, {}), "frontend");
  }
});

test("normalizes operations aliases and prefers specialist capabilities", () => {
  assert.equal(deriveTaskClass("ops deployment", inventory, {}), "operations");
  assert.equal(deriveTaskClass("operations deployment", inventory, {}), "operations");
  assert.equal(deriveTaskClass("reliability work", inventory, {}), "reliability");
  assert.equal(deriveTaskClass("build operations work", inventory, {}), "operations");
});

test("ranks the matching specialist above the configured generic build route", () => {
  const ranked = rankRoutes(
    inventory.map((agent) => ({
      key: `${agent.reference}@${agent.version}:none`,
      agent: { reference: agent.reference, version: agent.version },
      contextProfile: null,
      tags: agent.capabilities,
      isDefault: agent.reference === "agentpatrol/developer",
    })),
    "frontend",
    emptyMemory(),
    config,
    0,
  ).ranked;

  assert.equal(ranked[0]?.agent.reference, "agentpatrol/frontend-engineer");
});

test("uses the configured default as the deterministic generic fallback", () => {
  const { ranked, confidence } = rankRoutes(
    [
      {
        key: "agentpatrol/developer@1.0.0:none",
        agent: { reference: "agentpatrol/developer", version: "1.0.0" },
        contextProfile: null,
        tags: ["build", "implementation"],
        isDefault: true,
      },
      {
        key: "agentpatrol/frontend-engineer@1.0.0:none",
        agent: { reference: "agentpatrol/frontend-engineer", version: "1.0.0" },
        contextProfile: null,
        tags: ["build", "frontend", "interaction"],
        isDefault: false,
      },
    ],
    "general",
    emptyMemory(),
    config,
    0,
  );

  assert.equal(ranked[0]?.agent.reference, "agentpatrol/developer");
  assert.equal(
    selectRoutesForFanout(ranked, confidence < config.uncertaintyThreshold, 2, false)
      .selected.length,
    1,
  );
});

test("explicit agent, execution, and context-profile overrides bypass content routing", async () => {
  const log = resolve(
    tmpdir(),
    `codepatrol-routing-override-${process.pid}-${Date.now()}.log`,
  );
  const { root } = fixture();
  const configWithOrchestration = {
    agentCatalog: {
      argv: [process.execPath, resolverScript, "valid", log],
      timeoutMs: 10_000,
      defaults: {
        build: { agent: "agentpatrol/developer", version: "1.0.0" },
      },
    },
    contextPatrol: {
      argv: [process.execPath, process.execPath],
      timeoutMs: 10_000,
      profiles: {
        none: { facets: ["structure"], maxOutputBytes: 9600 },
      },
      defaults: {},
    },
    orchestrator: {
      policyVersion: "15",
      uncertaintyThreshold: 5,
      maxFanout: 2,
      minObservations: 3,
      explorationInterval: 10,
      coldStartPrior: 20,
      maxObservations: 5000,
      maxAggregates: 1000,
    },
  };
  writeFileSync(
    resolve(root, "codepatrol.json"),
    JSON.stringify({
      schemaVersion: 1,
      baseBranch: "main",
      verification: {
        argv: [process.execPath, "-e", "process.exit(0)"],
        timeoutMs: 10_000,
      },
      maxReviewReturns: 3,
      ...configWithOrchestration,
    }),
  );
  git(root, ["add", "codepatrol.json"]);
  git(root, [
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-m",
    "configure orchestrator override test",
  ]);
  const created = await runCli([
    "node",
    "codepatrol",
    "--workspace",
    root,
    "init",
    "create",
    "--title",
    "Overrides",
  ]);
  const initId = (JSON.parse(created.stdout) as { id: string }).id;

  const agentsOpen = await runCli([
    "node",
    "codepatrol",
    "--workspace",
    root,
    "spec",
    "open",
    "--init",
    initId,
    "--harness",
    "test",
    "--agents",
    "agentpatrol/second@1.0.0",
  ]);
  assert.equal(agentsOpen.exitCode, 0, agentsOpen.stderr);
  const agentsTasks = JSON.parse(agentsOpen.stdout) as {
    tasks: Array<{ task: { source: { agent: string } } }>;
  };
  assert.equal(agentsTasks.tasks[0]?.task.source.agent, "agentpatrol/second");

  const executionsOpen = await runCli([
    "node",
    "codepatrol",
    "--workspace",
    root,
    "spec",
    "open",
    "--init",
    initId,
    "--executions",
    JSON.stringify([
      {
        schemaVersion: 1,
        harness: "test-exec",
        model: "model-a",
        contextProfile: null,
        agentProfile: null,
      },
      {
        schemaVersion: 1,
        harness: "test-exec",
        model: "model-b",
        contextProfile: null,
        agentProfile: null,
      },
    ]),
  ]);
  assert.equal(executionsOpen.exitCode, 0, executionsOpen.stderr);
  const executionsTasks = JSON.parse(executionsOpen.stdout) as {
    tasks: Array<{ task: { source: { harness: string }; execution?: unknown } }>;
  };
  assert.equal(executionsTasks.tasks[0]?.task.source.harness, "test-exec");
  assert.equal(executionsTasks.tasks[1]?.task.source.harness, "test-exec");
  assert.ok(executionsTasks.tasks[0]?.task.execution);

  const profilesOpen = await runCli([
    "node",
    "codepatrol",
    "--workspace",
    root,
    "spec",
    "open",
    "--init",
    initId,
    "--harness",
    "test",
    "--agents",
    "agentpatrol/first@1.0.0",
    "--context-profile",
    "none",
  ]);
  assert.equal(profilesOpen.exitCode, 0, profilesOpen.stderr);
  const profilesTasks = JSON.parse(profilesOpen.stdout) as {
    tasks: Array<{ task: { source: { agent: string } } }>;
  };
  assert.equal(profilesTasks.tasks[0]?.task.source.agent, "agentpatrol/first");
});
