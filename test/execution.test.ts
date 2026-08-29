import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runCli } from "../src/cli.js";
import type { ContextSnapshot } from "../src/context-provider.js";
import type { Source } from "../src/core.js";
import {
  configurationDigest,
  descriptorFromSource,
  executionDescriptorSchema,
  executionRecordSchema,
  producerArtifactDigest,
} from "../src/execution.js";
import { digest, stableJson } from "../src/shared.js";
import { commitCandidate, fixture, git } from "./helpers.js";

const producer: Source = { harness: "test-producer", model: "model-a", agent: null };
const reviewer: Source = { harness: "test-reviewer", model: "model-b", agent: null };

const resolverScript = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../test/fixtures/fake-agent-resolver.mjs",
);
const providerScript = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../test/fixtures/fake-context-provider.mjs",
);

function contextSnapshot(profile: string): ContextSnapshot {
  const report = { profile, sections: { a: 1 } };
  return {
    profile,
    reportDigest: `sha256:${digest(stableJson(report))}`,
    requestDigest: `sha256:${"a".repeat(64)}`,
    report,
  };
}

function specDoc() {
  return {
    title: "Execution flow",
    intent: "Exercise execution records",
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
  const init = service.createInit("Execution flow", "Exercise execution records");
  const specTask = service.openProducer("spec", init.id, producer).task;
  const specProposalId = service.submitTask(specTask.id, specDoc()).task
    .proposalId as string;
  const specReview = service.openReview("spec-review", init.id, reviewer).task;
  service.submitTask(specReview.id, {
    decision: "approve",
    selectedProposalId: specProposalId,
    summary: "Approved",
    candidates: [
      {
        proposalId: specProposalId,
        status: "passed",
        summary: "Valid",
        scorecard: {
          rubricVersion: "spec-v1",
          assessments: [
            {
              category: "intent-alignment",
              level: 100 as const,
              rationale: "Satisfies the rubric category with passing verification.",
              evidenceRefs: [],
            },
            {
              category: "scope-completeness",
              level: 100 as const,
              rationale: "Satisfies the rubric category with passing verification.",
              evidenceRefs: [],
            },
            {
              category: "work-slicing",
              level: 100 as const,
              rationale: "Satisfies the rubric category with passing verification.",
              evidenceRefs: [],
            },
            {
              category: "acceptance-testability",
              level: 100 as const,
              rationale: "Satisfies the rubric category with passing verification.",
              evidenceRefs: [],
            },
            {
              category: "domain-fit",
              level: 100 as const,
              rationale: "Satisfies the rubric category with passing verification.",
              evidenceRefs: [],
            },
            {
              category: "architectural-fit",
              level: 100 as const,
              rationale: "Satisfies the rubric category with passing verification.",
              evidenceRefs: [],
            },
          ],
        },
      },
    ],
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
    candidates: [
      {
        proposalId: planProposalId,
        status: "passed",
        summary: "Valid",
        scorecard: {
          rubricVersion: "plan-v1",
          assessments: [
            {
              category: "acceptance-traceability",
              level: 100 as const,
              rationale: "Satisfies the rubric category with passing verification.",
              evidenceRefs: [],
            },
            {
              category: "executability",
              level: 100 as const,
              rationale: "Satisfies the rubric category with passing verification.",
              evidenceRefs: [],
            },
            {
              category: "technical-feasibility",
              level: 100 as const,
              rationale: "Satisfies the rubric category with passing verification.",
              evidenceRefs: [],
            },
            {
              category: "verification-strategy",
              level: 100 as const,
              rationale: "Satisfies the rubric category with passing verification.",
              evidenceRefs: [],
            },
            {
              category: "minimality",
              level: 100 as const,
              rationale: "Satisfies the rubric category with passing verification.",
              evidenceRefs: [],
            },
            {
              category: "architectural-fit",
              level: 100 as const,
              rationale: "Satisfies the rubric category with passing verification.",
              evidenceRefs: [],
            },
          ],
        },
      },
    ],
  });
  const buildTask = service.openProducer("build", wave.id, producer).task;
  return { init, wave, work, buildTask };
}

function buildResult(workId: string) {
  return { summary: "Candidate", works: [{ workId, summary: "Implemented" }] };
}

function descriptor(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1 as const,
    harness: "test",
    model: "model-a",
    contextProfile: null,
    agentProfile: null,
    ...overrides,
  };
}

function writeConfig(root: string, extra: Record<string, unknown>): void {
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
      ...extra,
    }),
  );
  git(root, ["add", "codepatrol.json"]);
  git(root, [
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-m",
    "configure execution test",
  ]);
}

test("execution descriptor is strict and nullable fields are explicit", () => {
  const valid = executionDescriptorSchema.safeParse(descriptor());
  assert.equal(valid.success, true);
  assert.equal(
    executionDescriptorSchema.safeParse({
      schemaVersion: 1,
      harness: "test",
      model: null,
      contextProfile: null,
      agentProfile: { reference: "agentpatrol/architect", version: "1.0.0" },
    }).success,
    true,
  );
  assert.equal(
    executionDescriptorSchema.safeParse({
      schemaVersion: 1,
      harness: "test",
      contextProfile: null,
      agentProfile: null,
    }).success,
    false,
  );
  assert.equal(
    executionDescriptorSchema.safeParse({
      schemaVersion: 1,
      harness: "test",
      model: null,
      contextProfile: null,
      agentProfile: { reference: "agentpatrol/architect" },
    }).success,
    false,
  );
  assert.equal(
    executionDescriptorSchema.safeParse({
      schemaVersion: 1,
      harness: "test",
      model: null,
      contextProfile: null,
      agentProfile: null,
      extra: true,
    }).success,
    false,
  );
});

test("configuration digest is domain-separated and key-order independent", () => {
  const first = descriptorFromSource(
    { harness: "h", model: "m", agent: null },
    "profile",
  );
  const second = descriptorFromSource(
    { harness: "h", model: "m", agent: null },
    "profile",
  );
  assert.equal(configurationDigest(first), configurationDigest(second));
  const reordered = {
    schemaVersion: 1 as const,
    agentProfile: null,
    contextProfile: "profile",
    model: "m",
    harness: "h",
  };
  assert.equal(configurationDigest(reordered), configurationDigest(first));
  const different = descriptorFromSource(
    { harness: "h", model: "other", agent: null },
    "profile",
  );
  assert.notEqual(configurationDigest(different), configurationDigest(first));
});

test("configuration digest excludes resolved agent digests", () => {
  const base = descriptorFromSource(
    {
      harness: "h",
      model: "m",
      agent: "agentpatrol/architect",
      agentVersion: "1.0.0",
    },
    "profile",
  );
  const withDigests = descriptorFromSource(
    {
      harness: "h",
      model: "m",
      agent: "agentpatrol/architect",
      agentVersion: "1.0.0",
      agentDigest: `sha256:${"b".repeat(64)}`,
      agentInstructionsDigest: `sha256:${"c".repeat(64)}`,
    },
    "profile",
  );
  assert.equal(configurationDigest(withDigests), configurationDigest(base));
  const differentVersion = descriptorFromSource(
    {
      harness: "h",
      model: "m",
      agent: "agentpatrol/architect",
      agentVersion: "2.0.0",
    },
    "profile",
  );
  assert.notEqual(configurationDigest(differentVersion), configurationDigest(base));
});

test("execution record schema validates a normalized record", () => {
  const record = {
    schemaVersion: 1,
    descriptor: descriptor(),
    configurationDigest: configurationDigest(descriptor() as never),
    batch: { id: "BATCH-1", ordinal: 1, total: 2 },
  };
  assert.equal(executionRecordSchema.safeParse(record).success, true);
  assert.equal(
    executionRecordSchema.safeParse({
      ...record,
      batch: { id: "BATCH-1", ordinal: 1, total: 2, extra: true },
    }).success,
    false,
  );
});

test("openProducers persists host-derived execution records on each task", () => {
  const { service } = fixture();
  const init = service.createInit("Execution", "Persist records");
  const first = contextSnapshot("focused");
  const second = contextSnapshot("broad");
  const opened = service.openProducers("spec", init.id, [
    { source: producer, agentInstructions: "", contextSnapshot: first },
    { source: reviewer, agentInstructions: "", contextSnapshot: second },
  ]);
  const tasks = opened.tasks.map(({ task }) => task);
  assert.equal(tasks.length, 2);
  assert.ok(tasks.every((task) => task.execution));
  assert.equal(tasks[0]?.execution?.batch.id, tasks[1]?.execution?.batch.id);
  assert.equal(tasks[0]?.execution?.batch.ordinal, 1);
  assert.equal(tasks[1]?.execution?.batch.ordinal, 2);
  assert.equal(tasks[0]?.execution?.batch.total, 2);
  assert.equal(tasks[0]?.execution?.descriptor.contextProfile, "focused");
  assert.equal(tasks[1]?.execution?.descriptor.contextProfile, "broad");
  assert.equal(
    tasks[0]?.execution?.configurationDigest,
    configurationDigest(tasks[0]?.execution?.descriptor as never),
  );
});

test("openProducers rejects repeated canonical configuration digests before mutation", () => {
  const { service, repo } = fixture();
  const init = service.createInit("Duplicate", "Reject duplicates");
  const before = repo.readState().state.sequence;
  const same = contextSnapshot("same");
  const duplicate = descriptor();
  assert.throws(
    () =>
      service.openProducers(
        "spec",
        init.id,
        [
          { source: producer, agentInstructions: "", contextSnapshot: same },
          { source: producer, agentInstructions: "", contextSnapshot: same },
        ],
        undefined,
        undefined,
        [duplicate, duplicate],
      ),
    (error: unknown) => (error as { code?: string }).code === "DUPLICATE_EXECUTION",
  );
  assert.equal(repo.readState().state.sequence, before);
  assert.deepEqual(repo.readState().state.tasks, []);
});

test("task and proposal execution records are tamper-resistant", () => {
  const { service, repo } = fixture();
  const init = service.createInit("Tamper", "Detect tampering");
  const task = service.openProducer(
    "spec",
    init.id,
    producer,
    undefined,
    "",
    contextSnapshot("focused"),
  ).task;
  const proposalId = service.submitTask(task.id, specDoc()).task.proposalId as string;
  const state = repo.readState().state;
  const storedTask = state.tasks.find((entry) => entry.id === task.id);
  const storedProposal = state.proposals.find((entry) => entry.id === proposalId);
  assert.ok(storedTask?.execution);
  assert.ok(storedProposal?.execution);
  assert.deepEqual(storedTask.execution, storedProposal.execution);
  const tampered = structuredClone(state);
  const tamperedTask = tampered.tasks.find((entry) => entry.id === task.id);
  assert.ok(tamperedTask?.execution);
  tamperedTask.execution.descriptor = null as never;
  assert.throws(
    () =>
      repo.mutate("tamper", (next) => {
        const entry = next.tasks.find((candidate) => candidate.id === task.id);
        assert.ok(entry?.execution);
        entry.execution.descriptor = null as never;
      }),
    (error: unknown) => (error as { code?: string }).code === "STATE_INVALID",
  );
});

test("producer submission hashes the validated document with the operation domain", () => {
  const { service, repo } = fixture();
  const init = service.createInit("Artifact", "Hash documents");
  const task = service.openProducer("spec", init.id, producer).task;
  const proposalId = service.submitTask(task.id, specDoc()).task.proposalId as string;
  const state = repo.readState().state;
  const proposal = state.proposals.find((entry) => entry.id === proposalId);
  const storedTask = state.tasks.find((entry) => entry.id === task.id);
  assert.ok(proposal?.fingerprint?.artifactDigest);
  assert.equal(
    proposal.fingerprint.artifactDigest,
    producerArtifactDigest("spec", specDoc()),
  );
  assert.equal(
    storedTask?.fingerprint?.artifactDigest,
    proposal.fingerprint.artifactDigest,
  );
});

test("fingerprint exposes context request, report, and section digests", () => {
  const { service, repo } = fixture();
  const init = service.createInit("Sections", "Expose section digests");
  const task = service.openProducer(
    "spec",
    init.id,
    producer,
    undefined,
    "",
    contextSnapshot("focused"),
  ).task;
  const proposalId = service.submitTask(task.id, specDoc()).task.proposalId as string;
  const state = repo.readState().state;
  const proposal = state.proposals.find((entry) => entry.id === proposalId);
  assert.ok(proposal?.fingerprint);
  assert.equal(
    proposal.fingerprint.contextRequestDigest,
    contextSnapshot("focused").requestDigest,
  );
  assert.equal(
    proposal.fingerprint.contextReportDigest,
    contextSnapshot("focused").reportDigest,
  );
  assert.ok(proposal.fingerprint.contextSectionDigests?.length);
  assert.equal(proposal.fingerprint.contextAvailability, "context-supplied");
});

test("build fingerprint keeps result digest independent from candidate identity", () => {
  const { service, repo } = fixture();
  const { work, buildTask } = driveToBuild(service);
  commitCandidate(buildTask.workspace as string, "candidate");
  const proposalId = service.submitTask(buildTask.id, buildResult(work.id)).task
    .proposalId as string;
  const state = repo.readState().state;
  const proposal = state.proposals.find((entry) => entry.id === proposalId);
  assert.ok(proposal?.fingerprint?.artifactDigest);
  assert.ok(proposal.fingerprint.candidateCommit);
  assert.ok(proposal.fingerprint.candidateTree);
  assert.notEqual(
    proposal.fingerprint.artifactDigest,
    `sha256:${proposal.fingerprint.candidateCommit}`,
  );
  assert.equal(
    proposal.fingerprint.artifactDigest,
    producerArtifactDigest("build", buildResult(work.id)),
  );
});

test("pre-WAVE-12 fixtures read without backfilled execution or fingerprint data", () => {
  const { service, repo } = fixture();
  const init = service.createInit("Legacy", "No backfill");
  const task = service.openProducer("spec", init.id, producer).task;
  const proposalId = service.submitTask(task.id, specDoc()).task.proposalId as string;
  const state = repo.readState().state;
  const storedTask = state.tasks.find((entry) => entry.id === task.id);
  const storedProposal = state.proposals.find((entry) => entry.id === proposalId);
  assert.ok(storedTask?.execution);
  assert.ok(storedProposal?.execution);
  const legacy = structuredClone(state);
  for (const entry of legacy.tasks) {
    delete entry.execution;
    delete entry.fingerprint;
  }
  for (const entry of legacy.proposals) {
    delete entry.execution;
    delete entry.fingerprint;
  }
  repo.mutate("legacy fixture", (next) => {
    next.tasks = legacy.tasks;
    next.proposals = legacy.proposals;
  });
  const reread = repo.readState().state;
  const legacyTask = reread.tasks.find((entry) => entry.id === task.id);
  const legacyProposal = reread.proposals.find((entry) => entry.id === proposalId);
  assert.equal(legacyTask?.execution, undefined);
  assert.equal(legacyTask?.fingerprint, undefined);
  assert.equal(legacyProposal?.execution, undefined);
  assert.equal(legacyProposal?.fingerprint, undefined);
  assert.equal(service.showTask(task.id).task.execution, undefined);
  assert.equal(service.showTask(task.id).task.fingerprint, undefined);
});

test("--executions is mutually exclusive with legacy producer flags", async () => {
  const { root } = fixture();
  const created = await runCli([
    "node",
    "codepatrol",
    "--workspace",
    root,
    "init",
    "create",
    "--title",
    "Exclusive",
  ]);
  const initId = (JSON.parse(created.stdout) as { id: string }).id;
  const batch = JSON.stringify([descriptor(), descriptor({ model: "model-b" })]);
  for (const flag of ["--harness", "--model", "--context-profile", "--agents"]) {
    const result = await runCli([
      "node",
      "codepatrol",
      "--workspace",
      root,
      "spec",
      "open",
      "--init",
      initId,
      "--executions",
      batch,
      flag,
      flag === "--agents" ? "agentpatrol/architect@1.0.0" : "value",
    ]);
    assert.equal(JSON.parse(result.stderr).error, "USAGE");
  }
});

test("--executions requires at least two complete descriptors", async () => {
  const { root } = fixture();
  const created = await runCli([
    "node",
    "codepatrol",
    "--workspace",
    root,
    "init",
    "create",
    "--title",
    "Minimum",
  ]);
  const initId = (JSON.parse(created.stdout) as { id: string }).id;
  const single = await runCli([
    "node",
    "codepatrol",
    "--workspace",
    root,
    "spec",
    "open",
    "--init",
    initId,
    "--executions",
    JSON.stringify([descriptor()]),
  ]);
  assert.equal(JSON.parse(single.stderr).error, "USAGE");
  const incomplete = await runCli([
    "node",
    "codepatrol",
    "--workspace",
    root,
    "spec",
    "open",
    "--init",
    initId,
    "--executions",
    JSON.stringify([descriptor(), { schemaVersion: 1, harness: "test" }]),
  ]);
  assert.equal(JSON.parse(incomplete.stderr).error, "USAGE");
  const duplicate = await runCli([
    "node",
    "codepatrol",
    "--workspace",
    root,
    "spec",
    "open",
    "--init",
    initId,
    "--executions",
    JSON.stringify([descriptor(), descriptor()]),
  ]);
  assert.equal(JSON.parse(duplicate.stderr).error, "USAGE");
});

test("--executions resolves agents and context before one atomic mutation", async () => {
  const log = resolve(tmpdir(), `codepatrol-exec-${process.pid}-${Date.now()}.log`);
  const { root, repo } = fixture();
  writeConfig(root, {
    agentCatalog: {
      argv: [process.execPath, resolverScript, "valid", log],
      timeoutMs: 10_000,
      defaults: {},
    },
    contextPatrol: {
      argv: [process.execPath, providerScript, log],
      timeoutMs: 10_000,
      profiles: {
        focused: { facets: ["structure"], maxOutputBytes: 9600 },
        broad: { facets: ["symbols"], maxOutputBytes: 14400 },
      },
      defaults: {},
    },
  });
  const created = await runCli([
    "node",
    "codepatrol",
    "--workspace",
    root,
    "init",
    "create",
    "--title",
    "Batch",
  ]);
  const initId = (JSON.parse(created.stdout) as { id: string }).id;
  const batch = JSON.stringify([
    descriptor({
      contextProfile: "focused",
      agentProfile: { reference: "agentpatrol/architect", version: "1.0.0" },
    }),
    descriptor({
      model: "model-b",
      contextProfile: "broad",
      agentProfile: { reference: "agentpatrol/tech-lead", version: "1.0.0" },
    }),
  ]);
  const opened = await runCli([
    "node",
    "codepatrol",
    "--workspace",
    root,
    "spec",
    "open",
    "--init",
    initId,
    "--executions",
    batch,
  ]);
  assert.equal(opened.exitCode, 0, opened.stderr);
  const output = JSON.parse(opened.stdout) as {
    tasks: Array<{ task: { id: string; source: Source; execution?: unknown } }>;
  };
  assert.equal(output.tasks.length, 2);
  assert.equal(output.tasks[0]?.task.source.agent, "agentpatrol/architect");
  assert.equal(output.tasks[1]?.task.source.agent, "agentpatrol/tech-lead");
  assert.equal(output.tasks[0]?.task.source.agentDigest !== undefined, true);
  assert.equal(repo.readState().state.tasks.length, 2);
  const stored = repo.readState().state.tasks;
  assert.equal(stored[0]?.execution?.descriptor.contextProfile, "focused");
  assert.equal(stored[1]?.execution?.descriptor.contextProfile, "broad");
  assert.equal(stored[0]?.execution?.batch.id, stored[1]?.execution?.batch.id);
});

test("later-entry resolution failure leaves state and worktrees unchanged", async () => {
  const log = resolve(
    tmpdir(),
    `codepatrol-exec-fail-${process.pid}-${Date.now()}.log`,
  );
  const { root, repo } = fixture();
  writeConfig(root, {
    contextPatrol: {
      argv: [process.execPath, providerScript, log],
      timeoutMs: 10_000,
      profiles: {
        focused: { facets: ["structure"], maxOutputBytes: 9600 },
      },
      defaults: {},
    },
  });
  const created = await runCli([
    "node",
    "codepatrol",
    "--workspace",
    root,
    "init",
    "create",
    "--title",
    "Failure",
  ]);
  const initId = (JSON.parse(created.stdout) as { id: string }).id;
  const before = repo.readState().state.sequence;
  const batch = JSON.stringify([
    descriptor({ contextProfile: "focused" }),
    descriptor({ model: "model-b", contextProfile: "missing-profile" }),
  ]);
  const opened = await runCli([
    "node",
    "codepatrol",
    "--workspace",
    root,
    "spec",
    "open",
    "--init",
    initId,
    "--executions",
    batch,
  ]);
  assert.equal(JSON.parse(opened.stderr).error, "CONTEXT_PROFILE_NOT_FOUND");
  assert.equal(repo.readState().state.sequence, before);
  assert.deepEqual(repo.readState().state.tasks, []);
  assert.deepEqual(repo.listManagedWorktrees(), []);
});

test("legacy producer flags still translate through the source path", async () => {
  const log = resolve(tmpdir(), `codepatrol-legacy-${process.pid}-${Date.now()}.log`);
  const { root, repo } = fixture();
  writeConfig(root, {
    agentCatalog: {
      argv: [process.execPath, resolverScript, "valid", log],
      timeoutMs: 10_000,
      defaults: {},
    },
  });
  const created = await runCli([
    "node",
    "codepatrol",
    "--workspace",
    root,
    "init",
    "create",
    "--title",
    "Legacy",
  ]);
  const initId = (JSON.parse(created.stdout) as { id: string }).id;
  const opened = await runCli([
    "node",
    "codepatrol",
    "--workspace",
    root,
    "spec",
    "open",
    "--init",
    initId,
    "--harness",
    "test",
    "--model",
    "model-a",
    "--agents",
    "agentpatrol/architect@1.0.0",
  ]);
  assert.equal(opened.exitCode, 0, opened.stderr);
  const stored = repo.readState().state.tasks[0];
  assert.equal(stored?.source.harness, "test");
  assert.equal(stored?.source.model, "model-a");
  assert.equal(stored?.source.agent, "agentpatrol/architect");
  assert.equal(stored?.source.agentVersion, "1.0.0");
  assert.equal(stored?.source.agentDigest !== undefined, true);
});

test("shared Build base is preserved across an --executions batch", async () => {
  const { service, repo } = fixture();
  const { wave, work, buildTask } = driveToBuild(service);
  commitCandidate(buildTask.workspace as string, "seed");
  const proposalId = service.submitTask(buildTask.id, buildResult(work.id)).task
    .proposalId as string;
  const review = service.openReview("build-review", wave.id, reviewer).task;
  service.submitTask(review.id, {
    decision: "approve",
    selectedProposalId: proposalId,
    summary: "Approved",
    candidates: [
      {
        proposalId,
        status: "passed",
        summary: "Valid",
        scorecard: {
          rubricVersion: "build-v1",
          assessments: [
            {
              category: "acceptance-fulfillment",
              level: 100 as const,
              rationale: "Ok",
              evidenceRefs: [],
            },
            {
              category: "plan-fidelity",
              level: 100 as const,
              rationale: "Ok",
              evidenceRefs: [],
            },
            {
              category: "test-quality",
              level: 100 as const,
              rationale: "Ok",
              evidenceRefs: [],
            },
            {
              category: "verification-evidence",
              level: 100 as const,
              rationale: "Ok",
              evidenceRefs: [],
            },
            {
              category: "minimality",
              level: 100 as const,
              rationale: "Ok",
              evidenceRefs: [],
            },
            {
              category: "repository-fit",
              level: 100 as const,
              rationale: "Ok",
              evidenceRefs: [],
            },
          ],
        },
      },
    ],
    acceptance: [
      { id: work.acceptance[0]?.id as string, status: "passed", summary: "Ok" },
    ],
  });
  const base = repo.currentCommit("main");
  const opened = service.openProducers(
    "build",
    wave.id,
    [
      { source: producer, agentInstructions: "" },
      { source: reviewer, agentInstructions: "" },
    ],
    proposalId,
  );
  assert.equal(opened.tasks.length, 2);
  assert.equal(opened.tasks[0]?.task.baseCommit, base);
  assert.equal(opened.tasks[1]?.task.baseCommit, base);
  assert.equal(
    opened.tasks[0]?.task.execution?.batch.id,
    opened.tasks[1]?.task.execution?.batch.id,
  );
});

test("trace forward events carry batch identity", async () => {
  const { root, service } = fixture();
  const init = service.createInit("Trace batch", "Batch identity");
  const opened = service.openProducers("spec", init.id, [
    { source: producer, agentInstructions: "" },
    { source: reviewer, agentInstructions: "" },
  ]);
  const batchId = opened.tasks[0]?.task.execution?.batch.id;
  assert.ok(batchId);
  const traced = await runCli([
    "node",
    "codepatrol",
    "--workspace",
    root,
    "trace",
    "--init",
    init.id,
  ]);
  assert.equal(traced.exitCode, 0, traced.stderr);
  const payload = JSON.parse(traced.stdout) as {
    entries: Array<{ kind: string; batchId?: string }>;
  };
  const openedEntries = payload.entries.filter((entry) => entry.kind === "opened");
  assert.equal(openedEntries.length, 2);
  assert.ok(openedEntries.every((entry) => entry.batchId === batchId));
});
