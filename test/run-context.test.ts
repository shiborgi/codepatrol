import assert from "node:assert/strict";
import { mkdirSync, utimesSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import type { Config } from "../src/config.js";
import { newRound } from "../src/core.js";
import { Repository } from "../src/git.js";
import { syncGitHub } from "../src/remote.js";
import { noopLogger, type RunContext } from "../src/run-context.js";
import { CodePatrolService } from "../src/service.js";
import { fixture } from "./helpers.js";

const FIXED = new Date("2026-01-01T00:00:00.000Z");

function fixedContext(): RunContext {
  return {
    log: noopLogger,
    now: () => new Date(FIXED.getTime()),
    readStdin: async () => {
      throw new Error("unexpected stdin read");
    },
    env: (name) => process.env[name],
    envAll: () => process.env,
    homeDir: () => homedir(),
    fetch: () => {
      throw new Error("unexpected fetch");
    },
  };
}

function fixedFixture(): { repo: Repository; service: CodePatrolService } {
  const { root, config } = fixture();
  const ctx = fixedContext();
  const repo = new Repository(root, ctx);
  return { repo, service: new CodePatrolService(repo, config, ctx) };
}

test("ownerless lock younger than the staleness window stays locked", () => {
  const { repo, service } = fixedFixture();
  const lock = resolve(repo.commonDir, "codepatrol-v1.lock");
  mkdirSync(lock);
  const fresh = new Date(FIXED.getTime() - 1_000);
  utimesSync(lock, fresh, fresh);
  assert.throws(
    () => service.createInit("Lock", "Still fresh"),
    (error: unknown) => (error as { code?: string }).code === "STATE_LOCKED",
  );
});

test("ownerless lock older than the staleness window is recovered by the clock", () => {
  const { repo, service } = fixedFixture();
  const lock = resolve(repo.commonDir, "codepatrol-v1.lock");
  mkdirSync(lock);
  const stale = new Date(FIXED.getTime() - 6_000);
  utimesSync(lock, stale, stale);
  const init = service.createInit("Lock", "Stale by the injected clock");
  assert.equal(init.id, "INIT-1");
  assert.equal(init.createdAt, FIXED.toISOString());
});

test("remote sync uses the injected fetch and token env without globals", async () => {
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
      createdAt: FIXED.toISOString(),
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
  let milestone: Record<string, unknown> | null = null;
  let issue: Record<string, unknown> | null = null;
  let milestoneCreates = 0;
  let issueCreates = 0;
  const authorizations: string[] = [];
  const urls: string[] = [];
  const ctx: RunContext = {
    ...fixedContext(),
    env: (name) => (name === "TEST_GITHUB_TOKEN" ? "injected-token" : undefined),
    fetch: async (url, init) => {
      urls.push(url);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      authorizations.push(headers.Authorization as string);
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
    },
  };
  const first = await syncGitHub(repo, config, ctx);
  await syncGitHub(repo, config, ctx);
  assert.deepEqual(first, {
    repository: "owner/repo",
    milestones: 1,
    issues: 1,
    wiki: false,
    milestonesCreated: 1,
    milestonesUpdated: 0,
    issuesCreated: 1,
    issuesUpdated: 0,
    commentsCreated: 0,
    commentsUpdated: 0,
    commentsDeleted: 0,
    commentsUnchanged: 0,
  });
  assert.equal(milestoneCreates, 1);
  assert.equal(issueCreates, 1);
  assert.ok(urls.every((url) => url.startsWith("https://api.github.com/")));
  assert.ok(authorizations.every((value) => value === "Bearer injected-token"));
});
