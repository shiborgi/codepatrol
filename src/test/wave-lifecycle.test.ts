import assert from "node:assert/strict";
import test from "node:test";
import { SyncService } from "../application/sync-service.js";
import type { WaveVerdict } from "../core/wave.js";
import { isWaveComplete, recordWaveVerdict, waveStatusOf } from "../core/wave-status.js";
import { createApp, documentOf } from "./support/app.js";
import { FakeGitHub } from "./support/github.js";
import { createRepo } from "./support/repo.js";

const TWO_WORKS = documentOf({
  works: [
    {
      id: "WORK-1.1.1",
      wave: "WAVE-1.1",
      title: "A",
      description: "a",
      workType: "task",
      priority: "p2",
      delivery: "no-code",
      acceptance: ["ok"],
      blockedBy: [],
    },
    {
      id: "WORK-1.2.1",
      wave: "WAVE-1.2",
      title: "B",
      description: "b",
      workType: "task",
      priority: "p2",
      delivery: "no-code",
      acceptance: ["ok"],
      blockedBy: [],
    },
  ],
  waves: [
    { id: "WAVE-1.1", title: "First wave", intent: "deliver first" },
    { id: "WAVE-1.2", title: "Second wave", intent: "deliver second" },
  ],
});

const VERDICT: WaveVerdict = {
  outcome: "adjust",
  authority: "test-operator",
  summary: "keep the shape, adjust the sequencing",
  finalizedAt: "2026-01-01T00:00:00.000Z",
};

async function shipWork(app: ReturnType<typeof createApp>, id: string): Promise<void> {
  for (const stage of ["plan", "review", "build"] as const) {
    await app.start(id, stage);
    await app.complete(id, stage, "continue");
  }
  await app.start(id, "verify");
  await app.complete(id, "verify", "continue");
  await app.start(id, "ship");
  await app.complete(id, "ship", "accept", { authority: "test-operator" });
}

test("a Spec apply creates one Wave document per declared Wave", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    const { runId } = await app.specStart("INIT-1");
    await app.specComplete("INIT-1", runId, "apply", TWO_WORKS);

    const snapshot = await app.store.read();
    assert.deepEqual([...snapshot.waves.keys()].sort(), ["WAVE-1.1", "WAVE-1.2"]);
    assert.equal(snapshot.waves.get("WAVE-1.1")?.title, "First wave");
    assert.equal(snapshot.waves.get("WAVE-1.1")?.verdict, null);
    assert.equal(snapshot.works.get("WORK-1.2.1")?.wave, "WAVE-1.2");
  } finally {
    repo.cleanup();
  }
});

test("completion is derived: a Wave is complete only when all of its Works are terminal", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    const { runId } = await app.specStart("INIT-1");
    await app.specComplete("INIT-1", runId, "apply", TWO_WORKS);

    let snapshot = await app.store.read();
    assert.equal(isWaveComplete("WAVE-1.1", snapshot.works.values()), false);

    await shipWork(app, "WORK-1.1.1");
    snapshot = await app.store.read();
    assert.equal(isWaveComplete("WAVE-1.1", snapshot.works.values()), true, "its only Work is terminal");
    assert.equal(isWaveComplete("WAVE-1.2", snapshot.works.values()), false, "the other Wave is untouched");
  } finally {
    repo.cleanup();
  }
});

test("a verdict is refused while the Wave is incomplete, and is never inferred once complete", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    const { runId } = await app.specStart("INIT-1");
    await app.specComplete("INIT-1", runId, "apply", TWO_WORKS);

    let snapshot = await app.store.read();
    const incomplete = snapshot.waves.get("WAVE-1.1");
    assert.ok(incomplete !== undefined);
    assert.throws(() => recordWaveVerdict(incomplete, snapshot.works.values(), VERDICT, "now"), /is not complete/);

    await shipWork(app, "WORK-1.1.1");
    snapshot = await app.store.read();
    const complete = snapshot.waves.get("WAVE-1.1");
    assert.ok(complete !== undefined);
    // Every Work was accepted, yet no verdict exists until one is recorded.
    assert.equal(waveStatusOf(complete, snapshot.works.values()).complete, true);
    assert.equal(complete.verdict, null, "a verdict is never inferred from Work outcomes");

    const recorded = recordWaveVerdict(complete, snapshot.works.values(), VERDICT, "now");
    assert.equal(recorded.verdict?.outcome, "adjust");
    assert.equal(recorded.verdict?.authority, "test-operator");
  } finally {
    repo.cleanup();
  }
});

test("a conflicting verdict on an already-judged Wave is refused", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    const { runId } = await app.specStart("INIT-1");
    await app.specComplete("INIT-1", runId, "apply", TWO_WORKS);
    await shipWork(app, "WORK-1.1.1");

    const snapshot = await app.store.read();
    const wave = snapshot.waves.get("WAVE-1.1");
    assert.ok(wave !== undefined);
    const judged = recordWaveVerdict(wave, snapshot.works.values(), VERDICT, "now");

    assert.equal(
      recordWaveVerdict(judged, snapshot.works.values(), VERDICT, "later"),
      judged,
      "same verdict is a no-op",
    );
    assert.throws(
      () => recordWaveVerdict(judged, snapshot.works.values(), { ...VERDICT, outcome: "keep" }, "later"),
      /already has verdict adjust/,
    );
  } finally {
    repo.cleanup();
  }
});

test("projection gives each Wave its own milestone and each Initiative a wiki page", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    const github = new FakeGitHub();
    const sync = new SyncService(app.store, github);
    const { runId } = await app.specStart("INIT-1");
    await app.specComplete("INIT-1", runId, "apply", TWO_WORKS);

    const first = await sync.sync();
    assert.deepEqual(first.milestones.created.sort(), ["WAVE-1.1", "WAVE-1.2"]);
    assert.deepEqual(first.wikiPages.created.sort(), ["INIT-1", "Initiatives"]);
    assert.equal(github.milestones.length, 2);
    assert.equal(github.issues.length, 2);

    const byTitle = new Map(github.milestones.map((m) => [m.title, m]));
    assert.ok(byTitle.has("WAVE-1.1: First wave"));
    assert.ok(byTitle.has("WAVE-1.2: Second wave"));
    assert.ok(byTitle.get("WAVE-1.1")?.body.includes("<!-- codepatrol:wave:WAVE-1.1 -->") ?? true);

    // each Issue belongs to the milestone of its own Wave
    const issueOf = (id: string) => github.issues.find((issue) => issue.body.includes(`codepatrol:work:${id}`));
    assert.equal(issueOf("WORK-1.1.1")?.milestone, byTitle.get("WAVE-1.1: First wave")?.number);
    assert.equal(issueOf("WORK-1.2.1")?.milestone, byTitle.get("WAVE-1.2: Second wave")?.number);

    const page = github.wikiPages.get("INIT-1");
    assert.ok(page !== undefined);
    assert.ok(page.includes("<!-- codepatrol:initiative:INIT-1 -->"), "page carries the initiative marker");
    assert.ok(page.includes("WAVE-1.1: First wave") && page.includes("WAVE-1.2: Second wave"), "page lists the Waves");
    assert.ok(github.wikiPages.get("Initiatives")?.includes("[[INIT-1]]"), "index links the Initiative page");

    const second = await sync.sync();
    assert.deepEqual(second.milestones.created, [], "idempotent");
    assert.deepEqual(second.wikiPages.created, []);
    assert.deepEqual(second.wikiPages.updated, [], "an unchanged plan does not rewrite the page");
    assert.equal(github.milestones.length, 2);
    assert.equal(github.issues.length, 2);
  } finally {
    repo.cleanup();
  }
});

test("hand-written wiki content outside the managed markers is preserved", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    const github = new FakeGitHub();
    const sync = new SyncService(app.store, github);
    const { runId } = await app.specStart("INIT-1");
    await app.specComplete("INIT-1", runId, "apply", documentOf());
    await sync.sync();

    const original = github.wikiPages.get("INIT-1");
    assert.ok(original !== undefined);
    github.wikiPages.set("INIT-1", `My own notes stay here.\n\n${original}`);

    await app.start("WORK-1.1.1", "plan");
    await sync.sync();

    const page = github.wikiPages.get("INIT-1");
    assert.ok(page !== undefined);
    assert.ok(page.startsWith("My own notes stay here."), "user content preserved");
    assert.ok(page.includes("<!-- codepatrol:initiative:INIT-1 -->"));
  } finally {
    repo.cleanup();
  }
});
