import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runCli } from "../src/cli.js";
import type { ContextSnapshot } from "../src/context-provider.js";
import type { Source } from "../src/core.js";
import { digest, stableJson } from "../src/shared.js";
import { commitCandidate, fixture, git } from "./helpers.js";

const producer: Source = { harness: "test-producer", model: "model-a", agent: null };
const reviewer: Source = { harness: "test-reviewer", model: "model-b", agent: null };

function contextSnapshot(profile: string): ContextSnapshot {
  const report = { profile };
  return {
    profile,
    reportDigest: `sha256:${digest(stableJson(report))}`,
    requestDigest: `sha256:${"a".repeat(64)}`,
    report,
  };
}

function specDoc() {
  return {
    title: "Workspace flow",
    intent: "Exercise build workspace behavior",
    waves: [
      {
        key: "delivery",
        title: "Delivery",
        works: [
          {
            key: "implementation",
            title: "Implementation",
            description: "Build the feature",
            acceptance: ["The selected implementation is shipped"],
            blockedBy: [],
          },
        ],
      },
    ],
  };
}

function driveToBuild(service: ReturnType<typeof fixture>["service"]) {
  const init = service.createInit(
    "Workspace flow",
    "Exercise build workspace behavior",
  );
  const specTask = service.openProducer("spec", init.id, producer).task;
  const specProposalId = service.submitTask(specTask.id, specDoc()).task
    .proposalId as string;
  const specReview = service.openReview("spec-review", init.id, reviewer).task;
  service.submitTask(specReview.id, {
    decision: "approve",
    selectedProposalId: specProposalId,
    summary: "Approved",
    candidates: [{ proposalId: specProposalId, status: "passed", summary: "Valid" }],
  });
  const wave = service.list("wave")[0] as { id: string };
  const work = service.list("work")[0] as {
    id: string;
    acceptance: Array<{ id: string }>;
  };
  const planTask = service.openProducer("plan", wave.id, producer).task;
  const planProposalId = service.submitTask(planTask.id, {
    works: [
      {
        workId: work.id,
        summary: "Plan",
        steps: [{ summary: "Implement", acceptanceIds: [work.acceptance[0]?.id] }],
      },
    ],
    verification: "Run the configured gate",
    openQuestions: [],
  }).task.proposalId as string;
  const planReview = service.openReview("plan-review", wave.id, reviewer).task;
  service.submitTask(planReview.id, {
    decision: "approve",
    selectedProposalId: planProposalId,
    summary: "Approved",
    candidates: [{ proposalId: planProposalId, status: "passed", summary: "Valid" }],
  });
  const buildTask = service.openProducer("build", wave.id, producer).task;
  return { wave, work, buildTask };
}

function buildResult(workId: string) {
  return { summary: "Candidate", works: [{ workId, summary: "Implemented" }] };
}

test("submitted proposals record contextProfile without leaking snapshots into review input", () => {
  const { service } = fixture();
  const init = service.createInit("Provenance", "Context profile on proposals");
  const withContext = service.openProducer(
    "spec",
    init.id,
    producer,
    undefined,
    "",
    contextSnapshot("orientation"),
  ).task;
  const withoutContext = service.openProducer("spec", init.id, producer).task;
  const withId = service.submitTask(withContext.id, specDoc()).task
    .proposalId as string;
  const withoutId = service.submitTask(withoutContext.id, specDoc()).task
    .proposalId as string;
  const mixed = service.openReview("spec-review", init.id, reviewer);
  const mixedInput = mixed.input as {
    proposals: Array<{ id: string; contextProfile?: string | null }>;
  };
  assert.equal(
    mixedInput.proposals.find((proposal) => proposal.id === withId)?.contextProfile,
    "orientation",
  );
  assert.equal(
    mixedInput.proposals.find((proposal) => proposal.id === withoutId)?.contextProfile,
    null,
  );
  assert.ok(mixedInput.proposals.every((proposal) => !("contextSnapshot" in proposal)));
  assert.match(mixed.resultContract, /with-context and without-context/);
  service.submitTask(mixed.task.id, {
    decision: "approve",
    selectedProposalId: withId,
    summary: "Compared tracks",
    candidates: [
      { proposalId: withId, status: "passed", summary: "With context", score: 1 },
      { proposalId: withoutId, status: "passed", summary: "Without context", score: 0 },
    ],
  });
});

test("single-track review keeps the existing resultContract", () => {
  const { service } = fixture();
  const init = service.createInit("Single", "One profile");
  const task = service.openProducer(
    "spec",
    init.id,
    producer,
    undefined,
    "",
    contextSnapshot("orientation"),
  ).task;
  const proposalId = service.submitTask(task.id, specDoc()).task.proposalId as string;
  const review = service.openReview("spec-review", init.id, reviewer);
  const reviewInput = review.input as {
    proposals: Array<{ contextProfile?: string | null }>;
  };
  assert.equal(
    review.resultContract,
    "Evaluate every proposal; approve with selectedProposalId or return without a selection.",
  );
  assert.equal(reviewInput.proposals[0]?.contextProfile, "orientation");
  service.submitTask(review.task.id, {
    decision: "approve",
    selectedProposalId: proposalId,
    summary: "Single track",
    candidates: [{ proposalId, status: "passed", summary: "Valid" }],
  });
});

test("producer selections retain their individual context snapshots", () => {
  const { service } = fixture();
  const init = service.createInit("Context", "Per-task context");
  const first = contextSnapshot("focused");
  const second = contextSnapshot("broad");
  const opened = service.openProducers("spec", init.id, [
    { source: producer, agentInstructions: "", contextSnapshot: first },
    { source: reviewer, agentInstructions: "", contextSnapshot: second },
  ]);
  assert.deepEqual(
    opened.tasks.map(
      ({ contextSnapshot }) => (contextSnapshot as ContextSnapshot).profile,
    ),
    ["focused", "broad"],
  );
});

function linkSharedSource(root: string): void {
  mkdirSync(resolve(root, "node_modules"));
  writeFileSync(resolve(root, "node_modules", "marker.txt"), "shared\n");
}

test("shared-path links do not dirty an otherwise clean build worktree", () => {
  const { service, root } = fixture(undefined, ["node_modules"]);
  linkSharedSource(root);
  const { work, buildTask } = driveToBuild(service);
  const workspace = buildTask.workspace as string;
  assert.equal(existsSync(resolve(workspace, "node_modules")), true);
  commitCandidate(workspace, "shared-path");
  const submitted = service.submitTask(buildTask.id, buildResult(work.id));
  assert.equal(submitted.task.status, "submitted");
});

test("real uncommitted changes still fail build submission", () => {
  const { service, root } = fixture(undefined, ["node_modules"]);
  linkSharedSource(root);
  const { work, buildTask } = driveToBuild(service);
  const workspace = buildTask.workspace as string;
  commitCandidate(workspace, "dirty");
  writeFileSync(resolve(workspace, "stray.txt"), "stray\n");
  assert.throws(
    () => service.submitTask(buildTask.id, buildResult(work.id)),
    (error: unknown) => (error as { code?: string }).code === "DIRTY_WORKTREE",
  );
});

test("task submit resolves from inside a managed build worktree", async () => {
  const { service } = fixture();
  const { work, buildTask } = driveToBuild(service);
  const workspace = buildTask.workspace as string;
  commitCandidate(workspace, "from-worktree");
  const resultDir = mkdtempSync(resolve(tmpdir(), "codepatrol-result-"));
  const resultFile = resolve(resultDir, "result.json");
  writeFileSync(resultFile, JSON.stringify(buildResult(work.id)));
  const result = await runCli([
    "node",
    "codepatrol",
    "--workspace",
    workspace,
    "task",
    "submit",
    "--task",
    buildTask.id,
    "--result",
    resultFile,
  ]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(service.showTask(buildTask.id).task.status, "submitted");
});

test("seed conflict keeps a build task and workspace", () => {
  const { root, service } = fixture();
  const { wave, work, buildTask } = driveToBuild(service);
  commitCandidate(buildTask.workspace as string, "seed");
  const proposalId = service.submitTask(buildTask.id, buildResult(work.id)).task
    .proposalId as string;
  const review = service.openReview("build-review", wave.id, reviewer).task;
  service.submitTask(review.id, {
    decision: "approve",
    selectedProposalId: proposalId,
    summary: "Approved",
    candidates: [{ proposalId, status: "passed", summary: "Valid" }],
    acceptance: [
      { id: work.acceptance[0]?.id as string, status: "passed", summary: "Ok" },
    ],
  });
  writeFileSync(resolve(root, "result.txt"), "main-advance\n");
  git(root, ["add", "result.txt"]);
  git(root, [
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-m",
    "advance main",
  ]);
  const rebuilt = service.openProducer("build", wave.id, producer, proposalId);
  assert.ok(rebuilt.task.id);
  assert.equal(rebuilt.task.status, "failed");
  assert.equal(rebuilt.task.failure?.code, "SEED_CONFLICT");
  assert.equal(existsSync(rebuilt.task.workspace as string), true);
  const rebuiltWave = service.show("wave", wave.id) as { status: string };
  assert.equal(rebuiltWave.status, "building");
  assert.ok(
    service
      .list("task")
      .some(
        (task) =>
          (task as { id: string }).id === rebuilt.task.id &&
          (task as { workspace: string | null }).workspace !== null,
      ),
  );
});

test("build worktrees survive submit until build-review submits", () => {
  const { service } = fixture();
  const { wave, work, buildTask } = driveToBuild(service);
  const workspace = buildTask.workspace as string;
  commitCandidate(workspace, "keep-until-review");
  service.submitTask(buildTask.id, buildResult(work.id));
  assert.equal(existsSync(workspace), true);
  const cleanup = service.cleanup();
  assert.equal(cleanup.preservedWorktrees.includes(workspace), true);
  assert.equal(existsSync(workspace), true);
  const proposalId = service.showTask(buildTask.id).task.proposalId as string;
  const review = service.openReview("build-review", wave.id, reviewer).task;
  service.submitTask(review.id, {
    decision: "approve",
    selectedProposalId: proposalId,
    summary: "Approved",
    candidates: [{ proposalId, status: "passed", summary: "Valid" }],
    acceptance: [
      { id: work.acceptance[0]?.id as string, status: "passed", summary: "Ok" },
    ],
  });
  assert.equal(existsSync(workspace), false);
});

test("build-review context targets the candidate commit against the build base", async () => {
  const log = resolve(tmpdir(), `codepatrol-context-${process.pid}-${Date.now()}.log`);
  const provider = resolve(
    fileURLToPath(new URL(".", import.meta.url)),
    "../../test/fixtures/fake-context-provider.mjs",
  );
  const { root, repo, service } = fixture();
  const { wave, work, buildTask } = driveToBuild(service);
  commitCandidate(buildTask.workspace as string, "context-target");
  const submitted = service.submitTask(buildTask.id, buildResult(work.id));
  const stored = repo
    .readState()
    .state.proposals.find((entry) => entry.id === submitted.task.proposalId);
  assert.ok(stored?.candidate);
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
      contextPatrol: {
        argv: [process.execPath, provider, log],
        timeoutMs: 10_000,
        profiles: {
          impact: { facets: ["changes", "symbols"], maxOutputBytes: 14400 },
        },
        defaults: { "build-review": "impact" },
      },
    }),
  );
  const opened = await runCli([
    "node",
    "codepatrol",
    "--workspace",
    root,
    "build-review",
    "open",
    "--wave",
    wave.id,
    "--harness",
    "reviewer",
  ]);
  assert.equal(opened.exitCode, 0, opened.stderr);
  const envelope = JSON.parse(opened.stdout) as {
    contextSnapshot: {
      report: { target: { commit: string } };
    };
  };
  const recorded = JSON.parse(readFileSync(log, "utf8").trim()) as {
    target: { kind: string; oid: string };
    baseline: { oid: string };
  };
  assert.equal(recorded.target.kind, "commit");
  assert.equal(recorded.target.oid, stored.candidate.commit);
  assert.equal(recorded.baseline.oid, stored.candidate.baseCommit);
  assert.equal(envelope.contextSnapshot.report.target.commit, stored.candidate.commit);
});

test("non-managed directories keep typed repository errors", async () => {
  const outside = mkdtempSync(resolve(tmpdir(), "codepatrol-not-a-repo-"));
  const result = await runCli([
    "node",
    "codepatrol",
    "--workspace",
    outside,
    "task",
    "list",
  ]);
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /NOT_A_REPOSITORY/);
});
