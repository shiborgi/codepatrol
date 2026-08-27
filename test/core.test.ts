import assert from "node:assert/strict";
import test from "node:test";
import { createState, digest, specDocumentSchema, stateSchema } from "../src/core.js";

test("Spec contract is strict and requires acceptance", () => {
  const result = specDocumentSchema.safeParse({
    title: "Feature",
    intent: "Deliver it",
    waves: [{ key: "first", title: "First", works: [] }],
  });
  assert.equal(result.success, false);
});

test("State rejects unknown legacy fields", () => {
  const result = stateSchema.safeParse({
    schemaVersion: 1,
    projectId: "project",
    sequence: 0,
    nextInit: 1,
    inits: [],
    waves: [],
    works: [],
    tasks: [],
    proposals: [],
    initiatives: [],
  });
  assert.equal(result.success, false);
});

test("State v1 validates resolved instruction snapshots", () => {
  const old = createState("project");
  assert.equal(stateSchema.safeParse(old).success, true);

  const instructions = "Use the catalog guidance";
  const resolved = structuredClone(old);
  resolved.tasks.push({
    id: "TASK-1",
    operation: "spec",
    subjectId: "INIT-1",
    round: 1,
    status: "open",
    source: {
      harness: "test",
      model: null,
      agent: "agentpatrol/steward",
      agentVersion: "1.0.0",
      agentDigest: `sha256:${"a".repeat(64)}`,
      agentInstructionsDigest: `sha256:${digest(instructions)}`,
    },
    agentInstructions: instructions,
    workspace: null,
    baseCommit: null,
    proposalId: null,
    result: null,
    verification: [],
    failure: null,
    createdAt: new Date(0).toISOString(),
    finishedAt: null,
  });
  assert.equal(stateSchema.safeParse(resolved).success, true);
  const task = resolved.tasks[0];
  assert.ok(task);
  task.agentInstructions = "tampered";
  assert.equal(stateSchema.safeParse(resolved).success, false);
});

test("State v1 accepts proposals without contextProfile", () => {
  const state = createState("project");
  state.proposals.push({
    id: "PROP-1",
    taskId: "TASK-1",
    operation: "spec",
    subjectId: "INIT-1",
    round: 1,
    source: { harness: "test", model: null, agent: null },
    document: { title: "Legacy" },
    candidate: null,
    summary: null,
    createdAt: new Date(0).toISOString(),
  });
  assert.equal(stateSchema.safeParse(state).success, true);
});
