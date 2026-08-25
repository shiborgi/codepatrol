import assert from "node:assert/strict";
import test from "node:test";
import type { Config } from "../src/config.js";
import { newRound } from "../src/core.js";
import { syncGitHub, upsertGitHubComments } from "../src/remote.js";
import { noopLogger, type RunContext } from "../src/run-context.js";
import { commitCandidate, fixture } from "./helpers.js";

test("GitHub sync reconciles markers without duplicate milestones or issues", async () => {
  const { repo } = fixture();
  repo.mutate("fixture state", (state) => {
    state.inits.push({
      id: "INIT-1",
      title: "Remote",
      brief: "Synchronize",
      status: "active",
      specRounds: [{ ...newRound("spec", 1), status: "approved" }],
      selectedSpecId: "PROP-spec",
      waveIds: ["WAVE-1.1"],
      reviewReturns: 0,
      createdAt: new Date().toISOString(),
    });
    state.waves.push({
      id: "WAVE-1.1",
      initId: "INIT-1",
      title: "Remote wave",
      status: "planning",
      workIds: ["WORK-1.1.1"],
      planRounds: [newRound("plan", 1)],
      buildRounds: [],
      selectedPlanId: null,
      selectedBuildId: null,
      reviewReturns: { plan: 0, build: 0 },
      ship: null,
    });
    state.works.push({
      id: "WORK-1.1.1",
      waveId: "WAVE-1.1",
      key: "remote",
      title: "Remote work",
      description: "Create an issue",
      acceptance: [{ id: "AC-1", text: "Issue exists" }],
      blockedBy: [],
      status: "pending",
    });
  });
  const config: Config = {
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
        milestones: true,
        issues: true,
        comments: true,
        pushMain: false,
      },
    },
  };
  process.env.TEST_GITHUB_TOKEN = "test-token";
  let milestone: Record<string, unknown> | null = null;
  let issue: Record<string, unknown> | null = null;
  let milestoneCreates = 0;
  let issueCreates = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.includes("/milestones?"))
      return Response.json(milestone ? [milestone] : []);
    if (url.endsWith("/milestones") && method === "POST") {
      milestoneCreates += 1;
      milestone = { number: 7, ...(JSON.parse(String(init?.body)) as object) };
      return Response.json(milestone);
    }
    if (url.endsWith("/milestones/7") && method === "PATCH") {
      milestone = { number: 7, ...(JSON.parse(String(init?.body)) as object) };
      return Response.json(milestone);
    }
    if (url.includes("/issues?")) return Response.json(issue ? [issue] : []);
    if (url.endsWith("/issues") && method === "POST") {
      issueCreates += 1;
      issue = { number: 9, ...(JSON.parse(String(init?.body)) as object) };
      return Response.json(issue);
    }
    if (url.endsWith("/issues/9") && method === "PATCH") {
      issue = { number: 9, ...(JSON.parse(String(init?.body)) as object) };
      return Response.json(issue);
    }
    return new Response("unexpected request", { status: 500 });
  };
  try {
    await syncGitHub(repo, config);
    await syncGitHub(repo, config);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.TEST_GITHUB_TOKEN;
  }
  assert.equal(milestoneCreates, 1);
  assert.equal(issueCreates, 1);
});

test("comment marker duplicates converge once and remain mutation-free", async () => {
  const { repo } = fixture();
  const config: Config = {
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
  const target = "<!-- codepatrol:comment:summary:plan:WAVE-1.1:r1 -->\ncanonical";
  let comments = [
    { id: 20, body: `${target}\nduplicate` },
    { id: 10, body: `${target}\nold` },
  ];
  const mutations: string[] = [];
  const ctx: RunContext = {
    log: noopLogger,
    now: () => new Date(),
    readStdin: async () => "",
    env: (name) => (name === "TEST_GITHUB_TOKEN" ? "token" : undefined),
    envAll: () => ({}),
    homeDir: () => "/tmp",
    fetch: async (url, init) => {
      const method = init?.method ?? "GET";
      if (url.includes("/issues?state=all"))
        return Response.json([{ number: 11, body: "<!-- codepatrol:work:WORK-1 -->" }]);
      if (url.includes("/issues/11/comments?")) return Response.json(comments);
      const id = url.match(/comments\/(\d+)$/)?.[1];
      if (method === "PATCH" && id) {
        mutations.push(`${method} ${id}`);
        comments = comments.map((comment) =>
          comment.id === Number(id)
            ? { ...comment, body: JSON.parse(String(init?.body)).body }
            : comment,
        );
        return Response.json(comments.find((comment) => comment.id === Number(id)));
      }
      if (method === "DELETE" && id) {
        mutations.push(`${method} ${id}`);
        comments = comments.filter((comment) => comment.id !== Number(id));
        return new Response(null, { status: 204 });
      }
      return new Response("unexpected", { status: 500 });
    },
  };
  const first = await upsertGitHubComments(
    repo,
    config,
    [{ workId: "WORK-1", body: target }],
    ctx,
  );
  const second = await upsertGitHubComments(
    repo,
    config,
    [{ workId: "WORK-1", body: target }],
    ctx,
  );
  assert.deepEqual(first, {
    commentsCreated: 0,
    commentsUpdated: 1,
    commentsDeleted: 1,
    commentsUnchanged: 0,
  });
  assert.deepEqual(second, {
    commentsCreated: 0,
    commentsUpdated: 0,
    commentsDeleted: 0,
    commentsUnchanged: 1,
  });
  assert.deepEqual(mutations, ["PATCH 10", "DELETE 20"]);
});

test("terminal lifecycle sync preserves historical plan and build todo and summary comments", async () => {
  const { repo, service } = fixture();
  const source = { harness: "test", model: null, agent: null };
  const init = service.createInit("Terminal remote", "Synchronize completed work");
  const spec = service.openProducer("spec", init.id, source).task;
  const specProposal = service.submitTask(spec.id, {
    title: "Terminal remote",
    intent: "Exercise historical commentary",
    waves: ["accept", "rollback"].map((key) => ({
      key,
      title: `${key} wave`,
      works: [
        {
          key: `${key}-work`,
          title: `${key} work`,
          description: "Complete the work",
          acceptance: ["It is complete"],
          blockedBy: [],
        },
      ],
    })),
  }).task.proposalId as string;
  const specReview = service.openReview("spec-review", init.id, source).task;
  service.submitTask(specReview.id, {
    decision: "approve",
    selectedProposalId: specProposal,
    summary: "Both waves are valid",
    candidates: [{ proposalId: specProposal, status: "passed", summary: "Selected" }],
  });
  for (const [index, wave] of (
    service.list("wave") as Array<{ id: string }>
  ).entries()) {
    const work = (
      service.list("work") as Array<{ id: string; acceptance: Array<{ id: string }> }>
    ).at(index) as {
      id: string;
      acceptance: Array<{ id: string }>;
    };
    const plan = service.openProducer("plan", wave.id, source).task;
    const planProposal = service.submitTask(plan.id, {
      works: [
        {
          workId: work.id,
          summary: "Implement the work",
          steps: [{ summary: "Complete it", acceptanceIds: [work.acceptance[0]?.id] }],
        },
      ],
      verification: "Run tests",
      openQuestions: [],
    }).task.proposalId as string;
    const planReview = service.openReview("plan-review", wave.id, source).task;
    service.submitTask(planReview.id, {
      decision: "approve",
      selectedProposalId: planProposal,
      summary: "Plan selected",
      candidates: [{ proposalId: planProposal, status: "passed", summary: "Selected" }],
    });
    const build = service.openProducer("build", wave.id, source).task;
    commitCandidate(build.workspace as string, `candidate-${index}`);
    const buildProposal = service.submitTask(build.id, {
      summary: "Implemented the work",
      works: [{ workId: work.id, summary: "Complete" }],
    }).task.proposalId as string;
    const buildReview = service.openReview("build-review", wave.id, source).task;
    service.submitTask(buildReview.id, {
      decision: "approve",
      selectedProposalId: buildProposal,
      summary: "Build selected",
      candidates: [
        { proposalId: buildProposal, status: "passed", summary: "Selected" },
      ],
      acceptance: [
        { id: work.acceptance[0]?.id, status: "passed", summary: "Verified" },
      ],
    });
    if (index === 0) service.shipAccept(wave.id);
    else service.shipRollback(wave.id);
  }

  const config: Config = {
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
        milestones: true,
        issues: true,
        comments: true,
        pushMain: false,
      },
    },
  };
  const milestones: Array<Record<string, unknown>> = [];
  const issues: Array<Record<string, unknown>> = [];
  const comments = new Map<number, Array<Record<string, unknown>>>();
  const requests: string[] = [];
  let mutations = 0;
  const ctx: RunContext = {
    log: noopLogger,
    now: () => new Date(),
    readStdin: async () => "",
    env: (name) => (name === "TEST_GITHUB_TOKEN" ? "token" : undefined),
    envAll: () => ({}),
    homeDir: () => "/tmp",
    fetch: async (url, init) => {
      const method = init?.method ?? "GET";
      requests.push(`${method} ${url}`);
      if (url.includes("/milestones?")) return Response.json(milestones);
      if (url.endsWith("/milestones") && method === "POST") {
        mutations += 1;
        const milestone = {
          number: milestones.length + 1,
          ...(JSON.parse(String(init?.body)) as object),
        };
        milestones.push(milestone);
        return Response.json(milestone);
      }
      if (url.includes("/issues?") && !url.includes("/comments?"))
        return Response.json(issues);
      if (url.endsWith("/issues") && method === "POST") {
        mutations += 1;
        const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
        const issue = {
          number: issues.length + 1,
          ...payload,
          milestone:
            typeof payload.milestone === "number"
              ? { number: payload.milestone }
              : null,
        };
        issues.push(issue);
        return Response.json(issue);
      }
      const commentList = url.match(/\/issues\/(\d+)\/comments\?/);
      if (commentList) return Response.json(comments.get(Number(commentList[1])) ?? []);
      const commentCreate = url.match(/\/issues\/(\d+)\/comments$/);
      if (commentCreate && method === "POST") {
        mutations += 1;
        const issue = Number(commentCreate[1]);
        const entries = comments.get(issue) ?? [];
        const comment = {
          id: entries.length + 1,
          ...(JSON.parse(String(init?.body)) as object),
        };
        entries.push(comment);
        comments.set(issue, entries);
        return Response.json(comment);
      }
      return new Response("unexpected request", { status: 500 });
    },
  };
  const first = await syncGitHub(repo, config, ctx);
  assert.equal(first.milestonesCreated, 2);
  assert.equal(first.issuesCreated, 2);
  assert.equal(first.commentsCreated > 0, true);
  assert.deepEqual(
    milestones.map(({ state }) => state),
    ["closed", "closed"],
  );
  assert.deepEqual(
    issues.map(({ state }) => state),
    ["closed", "closed"],
  );
  for (const entries of comments.values()) {
    const bodies = entries.map(({ body }) => body as string);
    for (const operation of ["plan", "build"]) {
      assert.ok(bodies.some((body) => body.includes(`comment:todo:${operation}:`)));
      assert.ok(bodies.some((body) => body.includes(`comment:summary:${operation}:`)));
    }
  }
  requests.length = 0;
  mutations = 0;
  const second = await syncGitHub(repo, config, ctx);
  assert.deepEqual(
    {
      milestonesCreated: second.milestonesCreated,
      milestonesUpdated: second.milestonesUpdated,
      issuesCreated: second.issuesCreated,
      issuesUpdated: second.issuesUpdated,
      commentsCreated: second.commentsCreated,
      commentsUpdated: second.commentsUpdated,
      commentsDeleted: second.commentsDeleted,
      commentsUnchanged: second.commentsUnchanged,
    },
    {
      milestonesCreated: 0,
      milestonesUpdated: 0,
      issuesCreated: 0,
      issuesUpdated: 0,
      commentsCreated: 0,
      commentsUpdated: 0,
      commentsDeleted: 0,
      commentsUnchanged: 18,
    },
  );
  assert.equal(mutations, 0);
  assert.equal(
    requests.some((request) => /^(POST|PATCH) /.test(request)),
    false,
  );
});
