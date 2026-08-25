import assert from "node:assert/strict";
import test from "node:test";
import { canonicalCommentary } from "../src/commentary.js";
import type { Config } from "../src/config.js";
import { newRound, type Task } from "../src/core.js";
import type { Repository } from "../src/git.js";
import { noopLogger, type RunContext } from "../src/run-context.js";
import { type HookEvent, syncHooks } from "../src/sync-hooks.js";
import { fixture } from "./helpers.js";

const remoteConfig: Config = {
  schemaVersion: 1,
  baseBranch: "main",
  verification: { argv: ["true"], timeoutMs: 1_000 },
  maxReviewReturns: 3,
  remote: {
    github: {
      enabled: true,
      repo: "owner/repo",
      gitRemote: "origin",
      tokenEnv: "TEST_GITHUB_TOKEN",
      wiki: false,
      milestones: false,
      issues: true,
      comments: true,
      pushMain: false,
    },
  },
};

type TaskMap = Record<"plan" | "build" | "plan-review" | "build-review", Task>;

function context(
  fetch: RunContext["fetch"],
  warnings: string[] = [],
  token = "token",
): RunContext {
  return {
    log: { ...noopLogger, warn: (message) => warnings.push(message) },
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    readStdin: async () => "",
    env: (name) => (name === "TEST_GITHUB_TOKEN" ? token : undefined),
    envAll: () => ({}),
    homeDir: () => "/tmp",
    fetch,
  };
}

function seed(): { repo: Repository; tasks: TaskMap } {
  const { repo } = fixture();
  const tasks = {} as TaskMap;
  repo.mutate("commentary fixtures", (state) => {
    state.waves.push({
      id: "WAVE-1.1",
      initId: "INIT-1",
      title: "Commentary wave",
      status: "building",
      workIds: ["WORK-1.1.1"],
      planRounds: [newRound("plan", 1)],
      buildRounds: [{ ...newRound("build", 1), status: "reviewing" }],
      selectedPlanId: "PROP-plan",
      selectedBuildId: null,
      reviewReturns: { plan: 0, build: 0 },
      ship: { decision: "accept", candidateCommit: "abc123", at: "now" },
    });
    state.works.push({
      id: "WORK-1.1.1",
      waveId: "WAVE-1.1",
      key: "commentary",
      title: "Commentary work",
      description: "Test remote commentary",
      acceptance: [{ id: "AC-1", text: "Comments are stable" }],
      blockedBy: [],
      status: "pending",
    });
    state.proposals.push({
      id: "PROP-plan",
      taskId: "TASK-plan",
      operation: "plan",
      subjectId: "WAVE-1.1",
      round: 1,
      source: { harness: "test", model: null, agent: null },
      document: {
        works: [
          {
            workId: "WORK-1.1.1",
            summary: "Plan the commentary integration",
            steps: [
              { summary: "Render stable marker", acceptanceIds: ["AC-1"] },
              { summary: "Update the existing comment", acceptanceIds: ["AC-2"] },
            ],
          },
        ],
        verification: "Run the commentary tests",
        openQuestions: [],
      },
      candidate: null,
      summary: "Plan summary",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    for (const operation of ["plan", "build", "plan-review", "build-review"] as const) {
      const task = {
        id: `TASK-${operation}`,
        operation,
        subjectId: "WAVE-1.1",
        round: 1,
        status: "submitted",
        source: { harness: "test", model: null, agent: null },
        workspace: null,
        baseCommit: null,
        proposalId: operation === "plan" ? "PROP-plan" : null,
        result: { decision: "approve", selectedProposalId: "PROP-plan" },
        verification: [],
        failure: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        finishedAt: "2026-01-01T00:00:00.000Z",
      } as Task;
      state.tasks.push(task);
      tasks[operation] = task;
    }
  });
  return { repo, tasks };
}

function remoteFetch(
  calls: Array<{ method: string; body?: string }>,
): RunContext["fetch"] {
  let comment: { id: number; body: string } | undefined;
  return async (url, init) => {
    const method = init?.method ?? "GET";
    if (url.includes("/issues?state=all"))
      return Response.json([
        {
          number: 11,
          body: "<!-- codepatrol:work:WORK-1.1.1 -->",
          state: "open",
        },
      ]);
    if (url.includes("/issues/11/comments?"))
      return Response.json(comment ? [comment] : []);
    if (url.includes("/issues/11/comments") || url.includes("/issues/comments/")) {
      const body = String(init?.body);
      const payload = JSON.parse(body) as { body: string };
      calls.push({ method, body: payload.body });
      comment = { id: 22, body: payload.body };
      return Response.json(comment);
    }
    return new Response("unexpected", { status: 500 });
  };
}

test("commentary templates and marker upsert are deterministic and idempotent", async () => {
  const { repo, tasks } = seed();
  const calls: Array<{ method: string; body?: string }> = [];
  const ctx = context(remoteFetch(calls));
  await syncHooks(repo, remoteConfig, { kind: "open", task: tasks.build }, ctx);
  const first = calls[0]?.body ?? "";
  assert.match(first, /### Next\n- Open Build Review\./);
  assert.match(first, /Render stable marker/);
  assert.match(first, /AC-1/);
  assert.match(first, /AC-2/);
  await syncHooks(repo, remoteConfig, { kind: "open", task: tasks.build }, ctx);
  assert.deepEqual(
    calls.map((call) => call.method),
    ["POST"],
  );
  await syncHooks(
    repo,
    remoteConfig,
    { kind: "ship", waveId: "WAVE-1.1", decision: "accept", commit: "abc123" },
    ctx,
  );
  assert.match(calls[1]?.body ?? "", /codepatrol:comment:summary:ship:WAVE-1\.1:r1/);
  assert.match(calls[1]?.body ?? "", /## CodePatrol Ship - Round 1/);
});

test("canonical commentary is independent of task insertion order", () => {
  const { repo } = seed();
  const state = repo.readState().state;
  const first = canonicalCommentary(state).map(({ body, ...comment }) => ({
    ...comment,
    body,
  }));
  const reversed = { ...state, tasks: [...state.tasks].reverse() };
  const second = canonicalCommentary(reversed).map(({ body, ...comment }) => ({
    ...comment,
    body,
  }));
  assert.deepEqual(second, first);
});

test("all lifecycle hook events select their operation and next step", async () => {
  const { repo, tasks } = seed();
  const calls: Array<{ method: string; body?: string }> = [];
  const ctx = context(remoteFetch(calls));
  const events: HookEvent[] = [
    { kind: "open", task: tasks.plan },
    { kind: "open", task: tasks.build },
    { kind: "submit", task: tasks.plan },
    { kind: "submit", task: tasks["plan-review"] },
    { kind: "submit", task: tasks.build },
    { kind: "submit", task: tasks["build-review"] },
    { kind: "ship", waveId: "WAVE-1.1", decision: "rollback", commit: "abc123" },
  ];
  for (const event of events) await syncHooks(repo, remoteConfig, event, ctx);
  const bodies = calls.map((call) => call.body ?? "");
  const body = (index: number): string => bodies[index] ?? "";
  assert.match(body(0), /comment:todo:plan:/);
  assert.match(body(0), /Open Plan Review/);
  assert.match(body(1), /comment:todo:build:/);
  assert.match(body(1), /Open Build Review/);
  assert.match(body(2), /comment:summary:plan:/);
  assert.match(body(3), /Open Build\./);
  assert.match(body(4), /comment:summary:build:/);
  assert.match(body(5), /Ship the selected candidate/);
  assert.match(body(6), /comment:summary:ship:/);
});

test("commentary failures are warnings and never escape the lifecycle hook", async () => {
  const { repo, tasks } = seed();
  const warnings: string[] = [];
  const github = remoteConfig.remote?.github;
  if (!github) throw new Error("test remote config is incomplete");
  await assert.doesNotReject(() =>
    syncHooks(
      repo,
      { ...remoteConfig, remote: undefined },
      { kind: "open", task: tasks.plan },
      context(() => {
        throw new Error("unreachable");
      }, warnings),
    ),
  );
  await assert.doesNotReject(() =>
    syncHooks(
      repo,
      { ...remoteConfig, remote: { github: { ...github, comments: false } } },
      { kind: "open", task: tasks.plan },
      context(() => {
        throw new Error("unreachable");
      }, warnings),
    ),
  );
  await assert.doesNotReject(() =>
    syncHooks(
      repo,
      remoteConfig,
      { kind: "open", task: tasks.plan },
      context(async () => new Response("failed", { status: 500 }), warnings),
    ),
  );
  await assert.doesNotReject(() =>
    syncHooks(
      repo,
      remoteConfig,
      { kind: "open", task: tasks.plan },
      context(
        () => {
          throw new Error("unreachable");
        },
        warnings,
        "",
      ),
    ),
  );
  assert.equal(warnings.length, 2);
  assert.match(warnings.at(0) ?? "", /remote commentary skipped/);
});
