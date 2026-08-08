import assert from "node:assert/strict";
import test from "node:test";
import { ImproveService } from "../application/improve-service.js";
import { optionalFlag, parseArgs, repeatedFlag, requireFlag } from "../cli/args.js";
import { assertCompositionConsistency } from "../core/execution.js";
import { assertAcyclic, assertBuildUnblocked, assertWaveScopedConcurrency, unresolvedBlockers } from "../core/graph.js";
import type { Initiative, InitiativeDefinition, SpecResult, WorkDefinition } from "../core/initiative.js";
import {
  activeSpecExecution,
  canonicalDefinition,
  computeDocumentHash,
  normalizedResultEqual,
  validateSpecDocument,
  validateWorkDefinition,
} from "../core/spec-lifecycle.js";
import type { Work } from "../core/work.js";
import { createApp, documentOf } from "./support/app.js";
import { createRepo } from "./support/repo.js";

// ── cli/args ────────────────────────────────────────────────────────────────

test("parseArgs separates positionals, valued flags, boolean flags and repetitions", () => {
  const args = parseArgs([
    "plan",
    "start",
    "--work",
    "WORK-1.1.1",
    "--todo=todo.json",
    "--publish",
    "--blocked-by",
    "WORK-1.1.2",
    "--blocked-by",
    "WORK-1.1.3",
  ]);
  assert.deepEqual(args.positionals, ["plan", "start"]);
  assert.equal(requireFlag(args, "work"), "WORK-1.1.1");
  assert.equal(requireFlag(args, "todo"), "todo.json");
  assert.equal(args.flags.get("publish"), true);
  assert.deepEqual(repeatedFlag(args, "blocked-by"), ["WORK-1.1.2", "WORK-1.1.3"]);
  assert.equal(optionalFlag(args, "absent"), undefined);
});

test("a flag without a value is refused where a value is required", () => {
  const args = parseArgs(["sync", "--work"]);
  assert.throws(() => requireFlag(args, "work"), /--work requires a value/);
  assert.throws(() => optionalFlag(args, "work"), /--work requires a value/);
  assert.throws(() => requireFlag(parseArgs([]), "work"), /--work requires a value/);
});

test("repeatedFlag reads an absent flag as empty, a single use as one value, and refuses a valueless one", () => {
  assert.deepEqual(repeatedFlag(parseArgs(["work", "reblock"]), "blocked-by"), []);
  assert.deepEqual(repeatedFlag(parseArgs(["--blocked-by", "WORK-1.1.2"]), "blocked-by"), ["WORK-1.1.2"]);
  assert.throws(() => repeatedFlag(parseArgs(["--blocked-by"]), "blocked-by"), /--blocked-by requires a value/);
});

// ── core/execution ──────────────────────────────────────────────────────────

test("composition fields are all present or all absent", () => {
  assert.doesNotThrow(() => assertCompositionConsistency({ role: "plan", harness: "test" }, "attempt"));
  assert.doesNotThrow(() =>
    assertCompositionConsistency(
      { role: "plan", harness: "test", profile: "core", capabilities: [], compositionDigest: "abc" },
      "attempt",
    ),
  );
  assert.throws(
    () => assertCompositionConsistency({ role: "plan", harness: "test", profile: "core" }, "attempt"),
    /must be all present or all absent/,
  );
});

// ── core/graph ──────────────────────────────────────────────────────────────

function graphWork(id: string, wave: string, blockedBy: string[] = [], completion: unknown = null): Work {
  return {
    id,
    wave,
    blockedBy,
    completion,
    attempts: [],
    workflow: { state: "ready", stage: "plan" },
  } as unknown as Work;
}

function activeWork(id: string, wave: string): Work {
  return {
    ...graphWork(id, wave),
    attempts: [{ stage: "plan", status: "active", runId: `run-${id}` }],
    workflow: { state: "active", stage: "plan" },
  } as unknown as Work;
}

test("assertAcyclic accepts a chain and names the cycle it finds", () => {
  const chain = [graphWork("WORK-1.1.1", "WAVE-1.1"), graphWork("WORK-1.1.2", "WAVE-1.1", ["WORK-1.1.1"])];
  assert.doesNotThrow(() => assertAcyclic(chain));

  const cyclic = [
    graphWork("WORK-1.1.1", "WAVE-1.1", ["WORK-1.1.2"]),
    graphWork("WORK-1.1.2", "WAVE-1.1", ["WORK-1.1.1"]),
  ];
  assert.throws(() => assertAcyclic(cyclic), /dependency cycle detected/);
});

test("unresolvedBlockers lists what is not accepted and refuses an unknown blocker", () => {
  const accepted = graphWork("WORK-1.1.1", "WAVE-1.1", [], { outcome: "accepted" });
  const pending = graphWork("WORK-1.1.2", "WAVE-1.1");
  const dependent = graphWork("WORK-1.1.3", "WAVE-1.1", ["WORK-1.1.1", "WORK-1.1.2"]);
  const byId = new Map([accepted, pending, dependent].map((work) => [work.id, work]));

  assert.deepEqual(
    unresolvedBlockers(dependent, byId).map((work) => work.id),
    ["WORK-1.1.2"],
  );
  assert.throws(() => assertBuildUnblocked(dependent, byId), /cannot build until blockers are accepted/);
  assert.throws(
    () => unresolvedBlockers(graphWork("WORK-1.1.4", "WAVE-1.1", ["WORK-9.9.9"]), byId),
    /depends on unknown work/,
  );
});

test("wave-scoped concurrency admits siblings and refuses another wave", () => {
  const running = activeWork("WORK-1.1.1", "WAVE-1.1");
  const sibling = graphWork("WORK-1.1.2", "WAVE-1.1");
  const stranger = graphWork("WORK-1.2.1", "WAVE-1.2");

  assert.doesNotThrow(() => assertWaveScopedConcurrency([running, sibling, stranger], sibling));
  assert.throws(
    () => assertWaveScopedConcurrency([running, sibling, stranger], stranger),
    /wave WAVE-1\.1 holds the active execution/,
  );
});

// ── core/spec-lifecycle ─────────────────────────────────────────────────────

function definitionOf(works: WorkDefinition[]): InitiativeDefinition {
  return {
    title: "Title",
    intent: "Intent",
    waves: [{ id: "WAVE-1.1", title: "Wave", intent: "Wave intent" }],
    works,
  } as unknown as InitiativeDefinition;
}

function workDefinition(id: string, blockedBy: string[] = []): WorkDefinition {
  return {
    id,
    wave: "WAVE-1.1",
    title: `Work ${id}`,
    description: "description",
    workType: "task",
    priority: "p2",
    delivery: "no-code",
    acceptance: ["done"],
    blockedBy,
  } as unknown as WorkDefinition;
}

test("the document hash depends on content and not on key order", () => {
  const first = definitionOf([workDefinition("WORK-1.1.1")]);
  const second = definitionOf([workDefinition("WORK-1.1.1")]);
  assert.equal(computeDocumentHash(first), computeDocumentHash(second));
  assert.equal(canonicalDefinition(first), canonicalDefinition(second));

  const changed = definitionOf([workDefinition("WORK-1.1.2")]);
  assert.notEqual(computeDocumentHash(changed), computeDocumentHash(first));
});

test("validateWorkDefinition refuses empty text and duplicate blockers", () => {
  assert.doesNotThrow(() => validateWorkDefinition(workDefinition("WORK-1.1.1")));
  assert.throws(() => validateWorkDefinition({ ...workDefinition("WORK-1.1.1"), title: "  " }), /title must be/);
  assert.throws(
    () => validateWorkDefinition({ ...workDefinition("WORK-1.1.1"), description: "" }),
    /description must be/,
  );
  assert.throws(
    () => validateWorkDefinition({ ...workDefinition("WORK-1.1.1"), acceptance: [" "] }),
    /acceptance criteria must be/,
  );
  assert.throws(
    () => validateWorkDefinition(workDefinition("WORK-1.1.1", ["WORK-1.1.2", "WORK-1.1.2"])),
    /duplicate blockedBy/,
  );
});

test("validateSpecDocument classifies works and refuses undeclared waves and self blocking", () => {
  const document = {
    schemaVersion: 1 as const,
    type: "codepatrol-initiative-document" as const,
    initiative: { id: "INIT-1", title: "T", intent: "I" },
    waves: [{ id: "WAVE-1.1", title: "Wave", intent: "Intent" }],
    works: [workDefinition("WORK-1.1.1"), workDefinition("WORK-1.1.2", ["WORK-1.1.1"])],
  };
  const plan = validateSpecDocument(document, new Map());
  assert.deepEqual(
    plan.created.map((work) => work.id),
    ["WORK-1.1.1", "WORK-1.1.2"],
  );
  assert.deepEqual(plan.updated, []);
  assert.deepEqual(plan.deleted, []);

  assert.throws(
    () =>
      validateSpecDocument({ ...document, works: [{ ...workDefinition("WORK-1.1.1"), wave: "WAVE-1.9" }] }, new Map()),
    /does not declare/,
  );
  assert.throws(
    () => validateSpecDocument({ ...document, works: [workDefinition("WORK-1.1.1", ["WORK-1.1.1"])] }, new Map()),
    /cannot block itself/,
  );
  assert.throws(
    () => validateSpecDocument({ ...document, works: [workDefinition("WORK-1.1.1", ["WORK-1.1.9"])] }, new Map()),
    /depends on unknown work/,
  );
});

test("normalizedResultEqual ignores irrelevant ordering and activeSpecExecution finds the live run", () => {
  const a = { decision: "apply", summary: "s", todo: [{ id: "t1", status: "done" }] } as unknown as SpecResult;
  const b = { decision: "apply", summary: "s", todo: [{ id: "t1", status: "done" }] } as unknown as SpecResult;
  assert.equal(normalizedResultEqual(a, b), true);
  assert.equal(normalizedResultEqual(a, { ...a, summary: "other" } as SpecResult), false);

  const idle = { specExecutions: [{ runId: "r1", status: "completed" }] } as unknown as Initiative;
  assert.equal(activeSpecExecution(idle), undefined);
  const running = { specExecutions: [{ runId: "r2", status: "active" }] } as unknown as Initiative;
  assert.equal(activeSpecExecution(running)?.runId, "r2");
});

// ── application/improve-service ─────────────────────────────────────────────

test("improve inspect reports the scoped works and refuses unknown scopes", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    const document = documentOf();
    const { runId } = await app.specStart(document.initiative.id);
    await app.specComplete(document.initiative.id, runId, "apply", document);

    const service = new ImproveService(app.store, () => "2026-01-01T00:00:00.000Z");
    const report = await service.inspect({ initiative: "INIT-1" });
    assert.equal(report.observedAt, "2026-01-01T00:00:00.000Z");
    assert.equal(report.works.scoped, 1);

    await assert.rejects(service.inspect({ initiative: "INIT-9" }), /initiative INIT-9 does not exist/);
    await assert.rejects(service.inspect({ since: "not-a-date" }), /--since must be a valid ISO date/);
  } finally {
    repo.cleanup();
  }
});
