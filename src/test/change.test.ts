import assert from "node:assert/strict";
import test from "node:test";
import { changeBranchOf, changeCleanupPolicy, changeHeadRefOf, changeWorktreePathOf } from "../core/change.js";
import { assertReconstructionMatches } from "../core/reconstruct.js";
import { parseWork } from "../core/work.js";

test("changeBranchOf returns codepatrol/<work-id>", () => {
  assert.equal(changeBranchOf("WORK-1.1.1"), "codepatrol/WORK-1.1.1");
});

test("the cleanup policy keeps the branch exactly when the outcome may need investigation", () => {
  assert.deepEqual(changeCleanupPolicy("accepted"), { removeWorktree: true, removeBranch: true });
  assert.deepEqual(changeCleanupPolicy("rolled-back"), { removeWorktree: true, removeBranch: false });
  assert.deepEqual(changeCleanupPolicy("failed"), { removeWorktree: false, removeBranch: false });
  assert.deepEqual(changeCleanupPolicy("under-investigation"), { removeWorktree: false, removeBranch: false });
});

test("changeHeadRefOf returns refs/heads/codepatrol/<work-id>", () => {
  assert.equal(changeHeadRefOf("WORK-1.1.1"), "refs/heads/codepatrol/WORK-1.1.1");
});

test("changeWorktreePathOf returns <parent>/.codepatrol-worktrees/<work-id> (normalized)", () => {
  assert.equal(changeWorktreePathOf("/repo", "WORK-1.1.1"), "/.codepatrol-worktrees/WORK-1.1.1");
});

test("parseWork parses evidence with change field", () => {
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
    workflow: { state: "ready", stage: "build", updatedAt: "2026-01-01T00:00:00.000Z" },
    attempts: [
      {
        stage: "build",
        attempt: 1,
        runId: "00000000-0000-4000-8000-000000000001",
        status: "completed",
        execution: { role: "build", harness: "test" },
        todo: [{ id: "t1", title: "Test" }],
        startedAt: "2026-01-01T00:00:00.000Z",
        finishedAt: "2026-01-01T00:01:00.000Z",
        result: { decision: "continue", summary: "s", todo: [{ id: "t1", status: "done" }] },
        evidence: {
          baseCommit: "a".repeat(40),
          candidateCommit: "b".repeat(40),
          change: {
            type: "codepatrol-change",
            baseRef: "refs/heads/main",
            baseCommit: "a".repeat(40),
            headRef: "refs/heads/codepatrol/WORK-1.1.1",
            candidateCommit: "b".repeat(40),
          },
        },
      },
    ],
    completion: null,
    dependencyRevisions: [],
    github: {},
    createdAt: "2026-01-01T00:00:00.000Z",
  });

  const change = work.attempts[0]?.evidence?.change;
  assert.ok(change !== undefined);
  assert.equal(change.type, "codepatrol-change");
  assert.equal(change.baseRef, "refs/heads/main");
  assert.equal(change.headRef, "refs/heads/codepatrol/WORK-1.1.1");
  assert.equal(change.baseCommit, "a".repeat(40));
  assert.equal(change.candidateCommit, "b".repeat(40));
});

test("parseWork rejects change with wrong type", () => {
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
        workflow: { state: "ready", stage: "build", updatedAt: "2026-01-01T00:00:00.000Z" },
        attempts: [
          {
            stage: "build",
            attempt: 1,
            runId: "00000000-0000-4000-8000-000000000001",
            status: "completed",
            execution: { role: "build", harness: "test" },
            todo: [{ id: "t1", title: "Test" }],
            startedAt: "2026-01-01T00:00:00.000Z",
            finishedAt: "2026-01-01T00:01:00.000Z",
            result: { decision: "continue", summary: "s", todo: [{ id: "t1", status: "done" }] },
            evidence: {
              baseCommit: "a".repeat(40),
              candidateCommit: "b".repeat(40),
              change: {
                type: "wrong-type",
                baseRef: "refs/heads/main",
                baseCommit: "a".repeat(40),
                headRef: "refs/heads/codepatrol/WORK-1.1.1",
                candidateCommit: "b".repeat(40),
              },
            },
          },
        ],
        completion: null,
        dependencyRevisions: [],
        github: {},
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    /type must be codepatrol-change/,
  );
});

test("parseWork rejects change with ref not starting with refs/heads/", () => {
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
        workflow: { state: "ready", stage: "build", updatedAt: "2026-01-01T00:00:00.000Z" },
        attempts: [
          {
            stage: "build",
            attempt: 1,
            runId: "00000000-0000-4000-8000-000000000001",
            status: "completed",
            execution: { role: "build", harness: "test" },
            todo: [{ id: "t1", title: "Test" }],
            startedAt: "2026-01-01T00:00:00.000Z",
            finishedAt: "2026-01-01T00:01:00.000Z",
            result: { decision: "continue", summary: "s", todo: [{ id: "t1", status: "done" }] },
            evidence: {
              baseCommit: "a".repeat(40),
              candidateCommit: "b".repeat(40),
              change: {
                type: "codepatrol-change",
                baseRef: "main",
                baseCommit: "a".repeat(40),
                headRef: "refs/heads/codepatrol/WORK-1.1.1",
                candidateCommit: "b".repeat(40),
              },
            },
          },
        ],
        completion: null,
        dependencyRevisions: [],
        github: {},
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    /baseRef must start with refs\/heads\//,
  );
});

test("reconstruction rejects change with mismatched baseCommit", () => {
  assert.throws(() => {
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
      workflow: { state: "ready", stage: "verify", updatedAt: "2026-01-01T00:00:00.000Z" },
      attempts: [
        {
          stage: "plan",
          attempt: 1,
          runId: "r1",
          status: "completed",
          execution: { role: "plan", harness: "test" },
          todo: [{ id: "t1", title: "Test" }],
          startedAt: "2026-01-01T00:00:00.000Z",
          finishedAt: "2026-01-01T00:01:00.000Z",
          result: { decision: "continue", summary: "s", todo: [{ id: "t1", status: "done" }] },
        },
        {
          stage: "review",
          attempt: 1,
          runId: "r2",
          status: "completed",
          execution: { role: "review", harness: "test" },
          todo: [{ id: "t1", title: "Test" }],
          startedAt: "2026-01-01T00:00:00.000Z",
          finishedAt: "2026-01-01T00:01:00.000Z",
          result: { decision: "continue", summary: "s", todo: [{ id: "t1", status: "done" }] },
        },
        {
          stage: "build",
          attempt: 1,
          runId: "00000000-0000-4000-8000-000000000001",
          status: "completed",
          execution: { role: "build", harness: "test" },
          todo: [{ id: "t1", title: "Test" }],
          startedAt: "2026-01-01T00:00:00.000Z",
          finishedAt: "2026-01-01T00:01:00.000Z",
          result: { decision: "continue", summary: "s", todo: [{ id: "t1", status: "done" }] },
          evidence: {
            baseCommit: "a".repeat(40),
            candidateCommit: "b".repeat(40),
            change: {
              type: "codepatrol-change",
              baseRef: "refs/heads/main",
              baseCommit: "c".repeat(40),
              headRef: "refs/heads/codepatrol/WORK-1.1.1",
              candidateCommit: "b".repeat(40),
            },
          },
        },
      ],
      completion: null,
      dependencyRevisions: [],
      github: {},
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assertReconstructionMatches(work);
  }, /change.baseCommit differs/);
});

test("reconstruction rejects change with wrong headRef", () => {
  assert.throws(() => {
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
      workflow: { state: "ready", stage: "verify", updatedAt: "2026-01-01T00:00:00.000Z" },
      attempts: [
        {
          stage: "plan",
          attempt: 1,
          runId: "r1",
          status: "completed",
          execution: { role: "plan", harness: "test" },
          todo: [{ id: "t1", title: "Test" }],
          startedAt: "2026-01-01T00:00:00.000Z",
          finishedAt: "2026-01-01T00:01:00.000Z",
          result: { decision: "continue", summary: "s", todo: [{ id: "t1", status: "done" }] },
        },
        {
          stage: "review",
          attempt: 1,
          runId: "r2",
          status: "completed",
          execution: { role: "review", harness: "test" },
          todo: [{ id: "t1", title: "Test" }],
          startedAt: "2026-01-01T00:00:00.000Z",
          finishedAt: "2026-01-01T00:01:00.000Z",
          result: { decision: "continue", summary: "s", todo: [{ id: "t1", status: "done" }] },
        },
        {
          stage: "build",
          attempt: 1,
          runId: "00000000-0000-4000-8000-000000000001",
          status: "completed",
          execution: { role: "build", harness: "test" },
          todo: [{ id: "t1", title: "Test" }],
          startedAt: "2026-01-01T00:00:00.000Z",
          finishedAt: "2026-01-01T00:01:00.000Z",
          result: { decision: "continue", summary: "s", todo: [{ id: "t1", status: "done" }] },
          evidence: {
            baseCommit: "a".repeat(40),
            candidateCommit: "b".repeat(40),
            change: {
              type: "codepatrol-change",
              baseRef: "refs/heads/main",
              baseCommit: "a".repeat(40),
              headRef: "refs/heads/codepatrol/WORK-9.1.9",
              candidateCommit: "b".repeat(40),
            },
          },
        },
      ],
      completion: null,
      dependencyRevisions: [],
      github: {},
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assertReconstructionMatches(work);
  }, /change.headRef does not match/);
});

test("v1 state without change field parses unchanged", () => {
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
  assert.equal(work.attempts[0]?.evidence?.change, undefined);
});
