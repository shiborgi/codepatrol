import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { runCli } from "../src/cli.js";
import { commitCandidate, fixture, git } from "./helpers.js";

test("CLI creates an Init", async () => {
  const { root } = fixture();
  const created = await runCli([
    "node",
    "codepatrol",
    "--workspace",
    root,
    "init",
    "create",
    "--title",
    "CLI feature",
    "--brief",
    "Exercise the public API",
  ]);
  assert.equal(created.exitCode, 0, created.stderr);
  const init = JSON.parse(created.stdout) as { id: string };
  assert.match(init.id, /^INIT-/);
});

test("CLI registry parses equals options and rejects invalid remote subactions", async () => {
  const { root } = fixture();
  const created = await runCli([
    "node",
    "codepatrol",
    "--workspace",
    root,
    "init",
    "create",
    "--title=Equals option",
  ]);
  assert.equal(created.exitCode, 0, created.stderr);
  assert.equal(
    (JSON.parse(created.stdout) as { title: string }).title,
    "Equals option",
  );
  const invalid = await runCli([
    "node",
    "codepatrol",
    "--workspace",
    root,
    "remote",
    "bogus",
  ]);
  assert.equal(invalid.exitCode, 2);
  assert.match(
    JSON.parse(invalid.stderr).message,
    /invalid subaction bogus for remote/,
  );
});

function readyToShip(remote?: { enabled: boolean; gitRemote?: string }) {
  const fixtureState = fixture();
  const { root, service } = fixtureState;
  if (remote) {
    writeRemoteConfig(root, remote.enabled, remote.gitRemote);
    git(root, ["add", "codepatrol.json"]);
    git(root, [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-m",
      "configure remote",
    ]);
  }
  const source = { harness: "test", model: null, agent: null };
  const init = service.createInit("Ship remote", "Push after ship");
  const spec = service.openProducer("spec", init.id, source).task;
  const specProposal = service.submitTask(spec.id, {
    title: "Ship remote",
    intent: "Push the selected candidate",
    waves: [
      {
        key: "ship",
        title: "Ship",
        works: [
          {
            key: "work",
            title: "Work",
            description: "Build",
            acceptance: ["Built"],
            blockedBy: [],
          },
        ],
      },
    ],
  }).task.proposalId as string;
  const specReview = service.openReview("spec-review", init.id, source).task;
  service.submitTask(specReview.id, {
    decision: "approve",
    selectedProposalId: specProposal,
    summary: "Selected",
    candidates: [{ proposalId: specProposal, status: "passed", summary: "Selected" }],
  });
  const wave = service.list("wave")[0] as { id: string };
  const work = service.list("work")[0] as {
    id: string;
    acceptance: Array<{ id: string }>;
  };
  const plan = service.openProducer("plan", wave.id, source).task;
  const planProposal = service.submitTask(plan.id, {
    works: [
      {
        workId: work.id,
        summary: "Build it",
        steps: [{ summary: "Implement", acceptanceIds: [work.acceptance[0]?.id] }],
      },
    ],
    verification: "Run tests",
    openQuestions: [],
  }).task.proposalId as string;
  const planReview = service.openReview("plan-review", wave.id, source).task;
  service.submitTask(planReview.id, {
    decision: "approve",
    selectedProposalId: planProposal,
    summary: "Selected",
    candidates: [{ proposalId: planProposal, status: "passed", summary: "Selected" }],
  });
  const build = service.openProducer("build", wave.id, source).task;
  commitCandidate(build.workspace as string, "ship");
  const buildProposal = service.submitTask(build.id, {
    summary: "Built",
    works: [{ workId: work.id, summary: "Built" }],
  }).task.proposalId as string;
  const buildReview = service.openReview("build-review", wave.id, source).task;
  service.submitTask(buildReview.id, {
    decision: "approve",
    selectedProposalId: buildProposal,
    summary: "Selected",
    candidates: [{ proposalId: buildProposal, status: "passed", summary: "Selected" }],
    acceptance: [{ id: work.acceptance[0]?.id, status: "passed", summary: "Verified" }],
  });
  return { ...fixtureState, waveId: wave.id };
}

function writeRemoteConfig(root: string, enabled: boolean, gitRemote = "origin"): void {
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
      remote: {
        github: {
          enabled,
          repo: "owner/repo",
          gitRemote,
          tokenEnv: "TEST_GITHUB_TOKEN",
          wiki: false,
          milestones: true,
          issues: true,
          comments: true,
          pushMain: true,
        },
      },
    }),
  );
}

function successfulGitHubFetch(afterPush: () => void): {
  calls: () => number;
  restore: () => void;
} {
  const original = globalThis.fetch;
  let count = 0;
  globalThis.fetch = async (_url, init) => {
    count += 1;
    afterPush();
    if (init?.method === "POST") return Response.json({ number: 1 });
    return Response.json([]);
  };
  return {
    calls: () => count,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

test("ship accept pushes main and reconciles only after the push", async () => {
  const { root, waveId } = readyToShip({ enabled: true });
  const remote = mkdtempSync(resolve(tmpdir(), "codepatrol-ship-remote-"));
  git(remote, ["init", "--bare"]);
  git(root, ["remote", "add", "origin", remote]);
  const fetch = successfulGitHubFetch(() => {
    assert.equal(
      git(remote, ["rev-parse", "refs/heads/main"]).trim(),
      git(root, ["rev-parse", "HEAD"]).trim(),
    );
  });
  process.env.TEST_GITHUB_TOKEN = "token";
  try {
    const result = await runCli([
      "node",
      "codepatrol",
      "--workspace",
      root,
      "ship",
      "accept",
      "--wave",
      waveId,
      "--confirm",
      "accept",
    ]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(
      (JSON.parse(result.stdout) as { pushMain: { status: string } }).pushMain.status,
      "pushed",
    );
    assert.equal(fetch.calls() > 0, true);
  } finally {
    fetch.restore();
    delete process.env.TEST_GITHUB_TOKEN;
  }
});

test("ship rollback pushes main and reconciles", async () => {
  const { root, waveId } = readyToShip({ enabled: true });
  const remote = mkdtempSync(resolve(tmpdir(), "codepatrol-ship-remote-"));
  git(remote, ["init", "--bare"]);
  git(root, ["remote", "add", "origin", remote]);
  const fetch = successfulGitHubFetch(() => undefined);
  process.env.TEST_GITHUB_TOKEN = "token";
  try {
    const result = await runCli([
      "node",
      "codepatrol",
      "--workspace",
      root,
      "ship",
      "rollback",
      "--wave",
      waveId,
      "--confirm",
      "rollback",
    ]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(
      (JSON.parse(result.stdout) as { pushMain: { status: string } }).pushMain.status,
      "pushed",
    );
    assert.equal(
      git(remote, ["rev-parse", "refs/heads/main"]).trim(),
      git(root, ["rev-parse", "HEAD"]).trim(),
    );
    assert.equal(fetch.calls() > 0, true);
  } finally {
    fetch.restore();
    delete process.env.TEST_GITHUB_TOKEN;
  }
});

test("disabled GitHub does not push main even when pushMain is enabled", async () => {
  const { root, waveId } = readyToShip({ enabled: false });
  const remote = mkdtempSync(resolve(tmpdir(), "codepatrol-ship-remote-"));
  git(remote, ["init", "--bare"]);
  git(root, ["remote", "add", "origin", remote]);
  const result = await runCli([
    "node",
    "codepatrol",
    "--workspace",
    root,
    "ship",
    "accept",
    "--wave",
    waveId,
    "--confirm",
    "accept",
  ]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual((JSON.parse(result.stdout) as { pushMain: unknown }).pushMain, {
    status: "disabled",
  });
  assert.throws(() =>
    git(remote, ["show-ref", "--verify", "--quiet", "refs/heads/main"]),
  );
});

test("push failures warn without changing successful ship exit status", async () => {
  const { root, waveId } = readyToShip({ enabled: true, gitRemote: "missing" });
  process.env.TEST_GITHUB_TOKEN = "token";
  try {
    const result = await runCli([
      "node",
      "codepatrol",
      "--workspace",
      root,
      "ship",
      "accept",
      "--wave",
      waveId,
      "--confirm",
      "accept",
    ]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(
      (JSON.parse(result.stdout) as { pushMain: { status: string } }).pushMain.status,
      "failed",
    );
    assert.match(result.stderr, /ship completed; main push warning:/);
  } finally {
    delete process.env.TEST_GITHUB_TOKEN;
  }
});
