import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  configSchema,
  type ExecutorRequest,
  executeStage,
  modelpatrolEnvironment,
} from "../src/index.js";

function request(): ExecutorRequest {
  return {
    protocolVersion: "1.0",
    runId: randomUUID(),
    stage: "build",
    task: "Implement gateway",
    workspace: process.cwd(),
    agent: {
      protocolVersion: "1.0",
      catalogVersion: "1.0.0",
      catalogDigest: "a".repeat(64),
      persona: "developer",
      profiles: ["general", "react"],
      skills: [],
      instructions: "Implement the task",
      digest: "b".repeat(64),
    },
    context: {
      protocolVersion: "1.0",
      profile: "implementation",
      snapshot: "c".repeat(64),
      signals: [],
      files: [],
      graph: { nodes: [], edges: [], cycles: [], impacted: [] },
      diagnostics: [],
      stats: { scannedFiles: 0, selectedFiles: 0, truncated: false },
      digest: "d".repeat(64),
    },
    previous: [],
  };
}
const connection = {
  baseUrl: "http://127.0.0.1:4318",
  harness: "opencode",
  project: "fixture",
};

test("ModelPatrol remains opt-in and validates its closed config", () => {
  const config = configSchema.parse({ protocolVersion: "1.0" });
  assert.equal(modelpatrolEnvironment(config, request()), undefined);
  assert.throws(() =>
    configSchema.parse({
      protocolVersion: "1.0",
      modelpatrol: { ...connection, secret: "bad" },
    }),
  );
  assert.throws(() =>
    configSchema.parse({
      protocolVersion: "1.0",
      modelpatrol: { ...connection, baseUrl: "https://user:secret@example.com" },
    }),
  );
});

test("ModelPatrol emits scoped headers without mutating parent environment or input", () => {
  const config = configSchema.parse({
    protocolVersion: "1.0",
    modelpatrol: connection,
  });
  const input = request();
  const parent = { MODELPATROL_API_KEY: "fixture-secret" };
  const child = modelpatrolEnvironment(config, input, parent);
  const headers = JSON.parse(child?.MODELPATROL_HEADERS ?? "{}");
  assert.equal(headers["x-patrol-step"], "build");
  assert.equal(headers["x-patrol-profile"], "general,react");
  assert.equal(headers["x-patrol-run-id"], input.runId);
  assert.equal(child?.MODELPATROL_MODEL, "auto");
  assert.deepEqual(parent, { MODELPATROL_API_KEY: "fixture-secret" });
  assert(!JSON.stringify(input).includes("fixture-secret"));
  assert.throws(() => modelpatrolEnvironment(config, input, {}), /credential/);
});

test("executeStage delivers ModelPatrol metadata through actual child process", async () => {
  const keyName = "CODEPATROL_TEST_GATEWAY_KEY";
  const previous = process.env[keyName];
  process.env[keyName] = "fixture-only-secret";
  try {
    const script = `let input=''; process.stdin.on('data', c => input+=c); process.stdin.on('end', () => {
      const headers = JSON.parse(process.env.MODELPATROL_HEADERS);
      if(headers['x-patrol-agent'] !== 'developer' || headers['x-patrol-step'] !== 'build' || input.includes('fixture-only-secret')) process.exit(2);
      console.log(JSON.stringify({protocolVersion:'1.0',status:'passed',summary:'Headers received',artifacts:[]}));
    });`;
    const config = configSchema.parse({
      protocolVersion: "1.0",
      executor: [process.execPath, "-e", script],
      modelpatrol: { ...connection, apiKeyEnv: keyName },
    });
    assert.equal((await executeStage(config, request())).result.status, "passed");
  } finally {
    if (previous === undefined) delete process.env[keyName];
    else process.env[keyName] = previous;
  }
});
