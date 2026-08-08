import assert from "node:assert/strict";
import test from "node:test";
import { currentWaveLayer, waveExecutionLayers, waveLayerIndex } from "../core/wave-execution.js";
import type { TodoItem, Work } from "../core/work.js";
import { createApp, documentOf, result, type TestApp, TODO } from "./support/app.js";
import { createRepo } from "./support/repo.js";

function workDefinition(id: string, wave: string, blockedBy: string[] = []) {
  return {
    id,
    wave,
    title: `Work ${id}`,
    description: `Deliver ${id}`,
    workType: "task" as const,
    priority: "p2" as const,
    delivery: "no-code" as const,
    acceptance: [`${id} done`],
    blockedBy,
  };
}

const WAVE_WITH_CHAIN = [
  workDefinition("WORK-1.1.1", "WAVE-1.1"),
  workDefinition("WORK-1.1.2", "WAVE-1.1", ["WORK-1.1.1"]),
  workDefinition("WORK-1.1.3", "WAVE-1.1"),
  workDefinition("WORK-1.2.1", "WAVE-1.2"),
];

async function applySpec(app: TestApp, works = WAVE_WITH_CHAIN) {
  const doc = documentOf({ works });
  const { runId } = await app.specStart(doc.initiative.id);
  await app.specComplete(doc.initiative.id, runId, "apply", doc);
  return doc;
}

function fakeWork(id: string, wave: string, blockedBy: string[] = [], completion: unknown = null): Work {
  return {
    id,
    wave,
    blockedBy,
    completion,
    attempts: [],
    workflow: { state: "ready", stage: "plan" },
  } as unknown as Work;
}

function todoFor(ids: string[]): Map<string, TodoItem[]> {
  return new Map(ids.map((id) => [id, TODO]));
}

test("layers place a blocked work strictly after its blocker and keep independents together", () => {
  const works = [
    fakeWork("WORK-1.1.3", "WAVE-1.1"),
    fakeWork("WORK-1.1.2", "WAVE-1.1", ["WORK-1.1.1"]),
    fakeWork("WORK-1.1.1", "WAVE-1.1"),
  ];
  const layers = waveExecutionLayers("WAVE-1.1", works).map((layer) => layer.map((work) => work.id));
  assert.deepEqual(layers, [["WORK-1.1.1", "WORK-1.1.3"], ["WORK-1.1.2"]]);

  const index = waveLayerIndex("WAVE-1.1", works);
  assert.ok((index.get("WORK-1.1.2") as number) > (index.get("WORK-1.1.1") as number));
});

test("layering is deterministic regardless of iteration order", () => {
  const works = [
    fakeWork("WORK-1.1.1", "WAVE-1.1"),
    fakeWork("WORK-1.1.2", "WAVE-1.1", ["WORK-1.1.1"]),
    fakeWork("WORK-1.1.10", "WAVE-1.1"),
    fakeWork("WORK-1.1.3", "WAVE-1.1"),
  ];
  const forward = waveExecutionLayers("WAVE-1.1", works).map((l) => l.map((w) => w.id));
  const reversed = waveExecutionLayers("WAVE-1.1", [...works].reverse()).map((l) => l.map((w) => w.id));
  assert.deepEqual(forward, reversed);
  assert.deepEqual(forward[0], ["WORK-1.1.1", "WORK-1.1.3", "WORK-1.1.10"], "position is compared numerically");
});

test("terminal works belong to no layer", () => {
  const works = [
    fakeWork("WORK-1.1.1", "WAVE-1.1", [], { outcome: "accepted" }),
    fakeWork("WORK-1.1.2", "WAVE-1.1", ["WORK-1.1.1"]),
  ];
  const layers = waveExecutionLayers("WAVE-1.1", works).map((l) => l.map((w) => w.id));
  assert.deepEqual(layers, [["WORK-1.1.2"]], "an accepted blocker satisfies its dependent immediately");
});

test("an unaccepted blocker outside the wave refuses the whole partition", () => {
  const works = [fakeWork("WORK-1.2.1", "WAVE-1.2", ["WORK-1.1.1"]), fakeWork("WORK-1.1.1", "WAVE-1.1")];
  assert.throws(() => waveExecutionLayers("WAVE-1.2", works), /blocker WORK-1\.1\.1 is outside wave WAVE-1\.2/);

  const accepted = [
    fakeWork("WORK-1.2.1", "WAVE-1.2", ["WORK-1.1.1"]),
    fakeWork("WORK-1.1.1", "WAVE-1.1", [], { outcome: "accepted" }),
  ];
  assert.deepEqual(
    waveExecutionLayers("WAVE-1.2", accepted).map((l) => l.map((w) => w.id)),
    [["WORK-1.2.1"]],
  );
});

test("a rolled-back blocker inside the wave refuses rather than silently unblocking", () => {
  const works = [
    fakeWork("WORK-1.1.1", "WAVE-1.1", [], { outcome: "rolled-back" }),
    fakeWork("WORK-1.1.2", "WAVE-1.1", ["WORK-1.1.1"]),
  ];
  assert.throws(() => waveExecutionLayers("WAVE-1.1", works), /terminal with outcome rolled-back/);
});

test("a cyclic wave is refused instead of partitioned", () => {
  const works = [
    fakeWork("WORK-1.1.1", "WAVE-1.1", ["WORK-1.1.2"]),
    fakeWork("WORK-1.1.2", "WAVE-1.1", ["WORK-1.1.1"]),
  ];
  assert.throws(() => waveExecutionLayers("WAVE-1.1", works), /dependency cycle|block each other/);
});

test("the current layer is the first one still waiting at the stage", () => {
  const works = [
    fakeWork("WORK-1.1.1", "WAVE-1.1", [], { outcome: "accepted" }),
    fakeWork("WORK-1.1.2", "WAVE-1.1", ["WORK-1.1.1"]),
  ];
  assert.deepEqual(
    currentWaveLayer("WAVE-1.1", works, "plan").map((w) => w.id),
    ["WORK-1.1.2"],
  );
  assert.deepEqual(currentWaveLayer("WAVE-1.1", works, "build"), [], "no work waits at a stage it has not reached");
});

test("a sibling active at another stage does not join this stage's layer", () => {
  const ready = fakeWork("WORK-1.1.1", "WAVE-1.1");
  const building = {
    ...fakeWork("WORK-1.1.3", "WAVE-1.1"),
    attempts: [{ stage: "build", status: "active", runId: "run-build" }],
    workflow: { state: "active", stage: "build" },
  } as unknown as Work;
  const works = [ready, building];

  assert.deepEqual(
    currentWaveLayer("WAVE-1.1", works, "plan").map((work) => work.id),
    ["WORK-1.1.1"],
    "planning a sibling is not blocked by another sibling's build",
  );
  assert.deepEqual(
    currentWaveLayer("WAVE-1.1", works, "build").map((work) => work.id),
    ["WORK-1.1.3"],
    "the build layer holds only the work actually building",
  );
});

test("starting a wave opens the first layer only, in one transaction", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    await applySpec(app);

    const started = await app.works.startWave("WAVE-1.1", "plan", {
      harness: "test",
      todoByWork: todoFor(["WORK-1.1.1", "WORK-1.1.3"]),
    });
    assert.deepEqual(started.layer, ["WORK-1.1.1", "WORK-1.1.3"]);
    assert.equal(started.started.length, 2);
    assert.equal(new Set(started.started.map((entry) => entry.attempt.runId)).size, 2, "each work gets its own run");

    const snapshot = await app.store.read();
    assert.equal(snapshot.works.get("WORK-1.1.2")?.workflow.state, "ready", "the blocked work stays out of the layer");
  } finally {
    repo.cleanup();
  }
});

test("a todo document that misses a work of the layer writes nothing", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    await applySpec(app);
    const before = repo.headCommit("refs/codepatrol/state");

    await assert.rejects(
      app.works.startWave("WAVE-1.1", "plan", { harness: "test", todoByWork: todoFor(["WORK-1.1.1"]) }),
      /todo document has no entry for WORK-1\.1\.3/,
    );
    assert.equal(repo.headCommit("refs/codepatrol/state"), before, "the refused start left no attempt behind");

    await assert.rejects(
      app.works.startWave("WAVE-1.1", "plan", {
        harness: "test",
        todoByWork: todoFor(["WORK-1.1.1", "WORK-1.1.3", "WORK-1.1.2"]),
      }),
      /outside the current layer of WAVE-1\.1: WORK-1\.1\.2/,
    );
    assert.equal(repo.headCommit("refs/codepatrol/state"), before, "an over-specified todo is refused too");
  } finally {
    repo.cleanup();
  }
});

test("repeating a wave start resumes the same runs and writes nothing new", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    await applySpec(app);
    const first = await app.works.startWave("WAVE-1.1", "plan", {
      harness: "test",
      todoByWork: todoFor(["WORK-1.1.1", "WORK-1.1.3"]),
    });
    const commit = repo.headCommit("refs/codepatrol/state");

    const again = await app.works.startWave("WAVE-1.1", "plan", {
      harness: "test",
      todoByWork: todoFor(["WORK-1.1.1", "WORK-1.1.3"]),
    });
    assert.deepEqual(
      again.started.map((entry) => entry.attempt.runId),
      first.started.map((entry) => entry.attempt.runId),
    );
    assert.ok(again.started.every((entry) => entry.resumed));
    assert.equal(repo.headCommit("refs/codepatrol/state"), commit, "resuming writes nothing");
  } finally {
    repo.cleanup();
  }
});

test("another wave cannot start while a wave holds the execution", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    await applySpec(app);
    await app.works.startWave("WAVE-1.1", "plan", {
      harness: "test",
      todoByWork: todoFor(["WORK-1.1.1", "WORK-1.1.3"]),
    });
    await assert.rejects(
      app.works.startWave("WAVE-1.2", "plan", { harness: "test", todoByWork: todoFor(["WORK-1.2.1"]) }),
      /wave WAVE-1\.1 holds the active execution/,
    );
  } finally {
    repo.cleanup();
  }
});

test("completing a wave applies every result at once and allows differing decisions", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    await applySpec(app);
    const started = await app.works.startWave("WAVE-1.1", "plan", {
      harness: "test",
      todoByWork: todoFor(["WORK-1.1.1", "WORK-1.1.3"]),
    });
    const runOf = (id: string) => started.started.find((entry) => entry.work.id === id)?.attempt.runId as string;

    const outcome = await app.works.completeWave("WAVE-1.1", "plan", [
      { workId: "WORK-1.1.1", runId: runOf("WORK-1.1.1"), result: result("continue", "plan") },
      { workId: "WORK-1.1.3", runId: runOf("WORK-1.1.3"), result: result("continue", "plan") },
    ]);
    assert.equal(outcome.completed.length, 2);

    const snapshot = await app.store.read();
    assert.equal(snapshot.works.get("WORK-1.1.1")?.workflow.stage, "review");
    assert.equal(snapshot.works.get("WORK-1.1.3")?.workflow.stage, "review");
  } finally {
    repo.cleanup();
  }
});

test("one wrong run refuses the whole batch and leaves the layer untouched", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    await applySpec(app);
    const started = await app.works.startWave("WAVE-1.1", "plan", {
      harness: "test",
      todoByWork: todoFor(["WORK-1.1.1", "WORK-1.1.3"]),
    });
    const runOf = (id: string) => started.started.find((entry) => entry.work.id === id)?.attempt.runId as string;
    const commit = repo.headCommit("refs/codepatrol/state");

    await assert.rejects(
      app.works.completeWave("WAVE-1.1", "plan", [
        { workId: "WORK-1.1.1", runId: runOf("WORK-1.1.1"), result: result("continue", "plan") },
        { workId: "WORK-1.1.3", runId: "00000000-0000-4000-8000-000000000999", result: result("continue", "plan") },
      ]),
      /active run is/,
    );
    assert.equal(repo.headCommit("refs/codepatrol/state"), commit, "no work of the layer advanced");

    await assert.rejects(
      app.works.completeWave("WAVE-1.1", "plan", [
        { workId: "WORK-1.1.1", runId: runOf("WORK-1.1.1"), result: result("continue", "plan") },
      ]),
      /omits active works of wave WAVE-1\.1/,
    );
    assert.equal(repo.headCommit("refs/codepatrol/state"), commit, "a partial result document is refused");
  } finally {
    repo.cleanup();
  }
});

test("repeating a wave completion is a no-op and a different result conflicts", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    await applySpec(app);
    const started = await app.works.startWave("WAVE-1.1", "plan", {
      harness: "test",
      todoByWork: todoFor(["WORK-1.1.1", "WORK-1.1.3"]),
    });
    const runOf = (id: string) => started.started.find((entry) => entry.work.id === id)?.attempt.runId as string;
    const entries = [
      { workId: "WORK-1.1.1", runId: runOf("WORK-1.1.1"), result: result("continue", "plan") },
      { workId: "WORK-1.1.3", runId: runOf("WORK-1.1.3"), result: result("continue", "plan") },
    ];
    await app.works.completeWave("WAVE-1.1", "plan", entries);
    const commit = repo.headCommit("refs/codepatrol/state");

    await app.works.completeWave("WAVE-1.1", "plan", entries);
    assert.equal(repo.headCommit("refs/codepatrol/state"), commit, "an identical repeat writes nothing");

    await assert.rejects(
      app.works.completeWave("WAVE-1.1", "plan", [
        { ...entries[0], result: result("continue", "plan", { summary: "different" }) } as (typeof entries)[0],
        entries[1] as (typeof entries)[0],
      ]),
      /already completed with a different result/,
    );
  } finally {
    repo.cleanup();
  }
});
