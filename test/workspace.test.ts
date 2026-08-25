import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
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
