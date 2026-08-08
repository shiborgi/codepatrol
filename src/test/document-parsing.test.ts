import assert from "node:assert/strict";
import test from "node:test";
import { parseInitiative } from "../core/initiative.js";
import { parseWork } from "../core/work.js";

test("parseWork parses a work with missing optional execution fields", () => {
  const work = parseWork({
    schemaVersion: 1,
    type: "codepatrol-work",
    id: "WORK-1.1.1",
    wave: "WAVE-1.1",
    initiative: "INIT-1",
    title: "Test",
    description: "Test",
    workType: "task",
    priority: "p2",
    delivery: "code",
    acceptance: [],
    blockedBy: [],
    specRevision: 1,
    workflow: { state: "ready", stage: "plan", updatedAt: "2026-01-01T00:00:00.000Z" },
    attempts: [
      {
        stage: "plan",
        attempt: 1,
        runId: "00000000-0000-4000-8000-000000000001",
        status: "active",
        execution: { role: "plan", harness: "test" },
        todo: [{ id: "t1", title: "Test" }],
        startedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    completion: null,
    dependencyRevisions: [],
    github: {},
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(work.id, "WORK-1.1.1");
  assert.equal(work.attempts[0]?.execution.harness, "test");
  assert.equal(work.attempts[0]?.execution.profile, undefined);
});

test("parseWork preserves profile on execution identity", () => {
  const work = parseWork({
    schemaVersion: 1,
    type: "codepatrol-work",
    id: "WORK-1.1.1",
    wave: "WAVE-1.1",
    initiative: "INIT-1",
    title: "Test",
    description: "Test",
    workType: "task",
    priority: "p2",
    delivery: "code",
    acceptance: [],
    blockedBy: [],
    specRevision: 1,
    workflow: { state: "ready", stage: "plan", updatedAt: "2026-01-01T00:00:00.000Z" },
    attempts: [
      {
        stage: "plan",
        attempt: 1,
        runId: "00000000-0000-4000-8000-000000000001",
        status: "active",
        execution: {
          role: "plan",
          harness: "test",
          model: "gpt-5",
          profile: "custom-profile",
          capabilities: [],
          compositionDigest: "f".repeat(64),
        },
        todo: [{ id: "t1", title: "Test" }],
        startedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    completion: null,
    dependencyRevisions: [],
    github: {},
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(work.attempts[0]?.execution.profile, "custom-profile");
  assert.equal(work.attempts[0]?.execution.model, "gpt-5");
});

test("parseInitiative parses spec execution with profile on execution identity", () => {
  const initiative = parseInitiative({
    schemaVersion: 1,
    type: "codepatrol-initiative",
    id: "INIT-1",
    definitionState: "defined",
    title: "Test",
    intent: "Test",
    currentSpecRevision: 1,
    specRevisions: [
      {
        revision: 1,
        runId: "00000000-0000-4000-8000-000000000001",
        createdAt: "2026-01-01T00:00:00.000Z",
        summary: "Test",
        documentHash: "a".repeat(64),
        definition: { title: "Test", intent: "Test", waves: [], works: [] },
      },
    ],
    specExecutions: [
      {
        runId: "00000000-0000-4000-8000-000000000002",
        status: "completed",
        execution: {
          role: "spec",
          harness: "test",
          profile: "spec-profile",
          capabilities: [],
          compositionDigest: "e".repeat(64),
        },
        todo: [{ id: "t1", title: "do" }],
        baseRevision: null,
        startedAt: "2026-01-01T00:00:00.000Z",
        finishedAt: "2026-01-01T00:00:01.000Z",
        result: { decision: "apply", summary: "done", todo: [{ id: "t1", status: "done" }] },
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z",
  });
  assert.equal(initiative.specExecutions[0]?.execution.profile, "spec-profile");
});

test("parseWork rejects unknown top-level fields", () => {
  assert.throws(
    () =>
      parseWork({
        schemaVersion: 1,
        type: "codepatrol-work",
        id: "WORK-1.1.1",
        wave: "WAVE-1.1",
        initiative: "INIT-1",
        title: "Test",
        description: "Test",
        workType: "task",
        priority: "p2",
        delivery: "code",
        acceptance: [],
        blockedBy: [],
        specRevision: 1,
        workflow: { state: "ready", stage: "plan", updatedAt: "2026-01-01T00:00:00.000Z" },
        attempts: [],
        completion: null,
        dependencyRevisions: [],
        github: {},
        createdAt: "2026-01-01T00:00:00.000Z",
        unknownField: true,
      }),
    /unknown field "unknownField"/,
  );
});

test("parseInitiative rejects unknown top-level fields", () => {
  assert.throws(
    () =>
      parseInitiative({
        schemaVersion: 1,
        type: "codepatrol-initiative",
        id: "INIT-1",
        definitionState: "draft",
        currentSpecRevision: null,
        specRevisions: [],
        specExecutions: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        unknownField: true,
      }),
    /unknown field "unknownField"/,
  );
});

test("parseWork parses capabilities and compositionDigest on execution identity", () => {
  const work = parseWork({
    schemaVersion: 1,
    type: "codepatrol-work",
    id: "WORK-1.1.1",
    wave: "WAVE-1.1",
    initiative: "INIT-1",
    title: "Test",
    description: "Test",
    workType: "task",
    priority: "p2",
    delivery: "code",
    acceptance: [],
    blockedBy: [],
    specRevision: 1,
    workflow: { state: "ready", stage: "plan", updatedAt: "2026-01-01T00:00:00.000Z" },
    attempts: [
      {
        stage: "plan",
        attempt: 1,
        runId: "00000000-0000-4000-8000-000000000001",
        status: "active",
        execution: {
          role: "plan",
          harness: "test",
          profile: "core",
          capabilities: [{ id: "customize-opencode", version: 1, digest: "a".repeat(64) }],
          compositionDigest: "b".repeat(64),
        },
        todo: [{ id: "t1", title: "Test" }],
        startedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    completion: null,
    dependencyRevisions: [],
    github: {},
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(work.attempts[0]?.execution.capabilities?.[0]?.id, "customize-opencode");
  assert.equal(work.attempts[0]?.execution.capabilities?.[0]?.version, 1);
  assert.equal(work.attempts[0]?.execution.compositionDigest, "b".repeat(64));
});

test("parseInitiative parses spec execution with full composition", () => {
  const initiative = parseInitiative({
    schemaVersion: 1,
    type: "codepatrol-initiative",
    id: "INIT-1",
    definitionState: "defined",
    title: "Test",
    intent: "Test",
    currentSpecRevision: 1,
    specRevisions: [
      {
        revision: 1,
        runId: "00000000-0000-4000-8000-000000000001",
        createdAt: "2026-01-01T00:00:00.000Z",
        summary: "Test",
        documentHash: "a".repeat(64),
        definition: { title: "Test", intent: "Test", waves: [], works: [] },
      },
    ],
    specExecutions: [
      {
        runId: "00000000-0000-4000-8000-000000000002",
        status: "completed",
        execution: {
          role: "spec",
          harness: "test",
          profile: "core",
          capabilities: [{ id: "customize-opencode", version: 1, digest: "c".repeat(64) }],
          compositionDigest: "d".repeat(64),
        },
        todo: [{ id: "t1", title: "do" }],
        baseRevision: null,
        startedAt: "2026-01-01T00:00:00.000Z",
        finishedAt: "2026-01-01T00:00:01.000Z",
        result: { decision: "apply", summary: "done", todo: [{ id: "t1", status: "done" }] },
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z",
  });
  assert.equal(initiative.specExecutions[0]?.execution.profile, "core");
  assert.equal(initiative.specExecutions[0]?.execution.capabilities?.[0]?.id, "customize-opencode");
  assert.equal(initiative.specExecutions[0]?.execution.compositionDigest, "d".repeat(64));
});

test("parseWork rejects partial composition fields", () => {
  assert.throws(
    () =>
      parseWork({
        schemaVersion: 1,
        type: "codepatrol-work",
        id: "WORK-1.1.1",
        wave: "WAVE-1.1",
        initiative: "INIT-1",
        title: "Test",
        description: "Test",
        workType: "task",
        priority: "p2",
        delivery: "code",
        acceptance: [],
        blockedBy: [],
        specRevision: 1,
        workflow: { state: "ready", stage: "plan", updatedAt: "2026-01-01T00:00:00.000Z" },
        attempts: [
          {
            stage: "plan",
            attempt: 1,
            runId: "00000000-0000-4000-8000-000000000001",
            status: "active",
            execution: { role: "plan", harness: "test", profile: "core" },
            todo: [{ id: "t1", title: "Test" }],
            startedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        completion: null,
        dependencyRevisions: [],
        github: {},
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    /composition fields.*must be all present or all absent/,
  );
});

test("parseWork with full composition parses correctly", () => {
  const work = parseWork({
    schemaVersion: 1,
    type: "codepatrol-work",
    id: "WORK-1.1.1",
    wave: "WAVE-1.1",
    initiative: "INIT-1",
    title: "Test",
    description: "Test",
    workType: "task",
    priority: "p2",
    delivery: "code",
    acceptance: [],
    blockedBy: [],
    specRevision: 1,
    workflow: { state: "ready", stage: "plan", updatedAt: "2026-01-01T00:00:00.000Z" },
    attempts: [
      {
        stage: "plan",
        attempt: 1,
        runId: "00000000-0000-4000-8000-000000000001",
        status: "active",
        execution: {
          role: "plan",
          harness: "test",
          profile: "core",
          capabilities: [],
          compositionDigest: "a".repeat(64),
        },
        todo: [{ id: "t1", title: "Test" }],
        startedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    completion: null,
    dependencyRevisions: [],
    github: {},
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(work.attempts[0]?.execution.profile, "core");
  assert.equal(work.attempts[0]?.execution.compositionDigest, "a".repeat(64));
});
