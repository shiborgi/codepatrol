import assert from "node:assert/strict";
import test from "node:test";
import { SyncService } from "../application/sync-service.js";
import { createApp, documentOf } from "./support/app.js";
import { FakeGitHub } from "./support/github.js";
import { createRepo } from "./support/repo.js";

const OWNER = "acme";
const NUMBER = 7;
const WORK = "WORK-1.1.1";

interface Harness {
  app: ReturnType<typeof createApp>;
  github: FakeGitHub;
  sync: SyncService;
  projectId: string;
  cleanup(): void;
  /** Status and Next Step currently projected for the Work's item. */
  fields(): Promise<{ status: string | null; nextStep: string | null; itemId: string }>;
}

/** Seeds the project the way GitHub already has it: Status without Rolled Back, no Next Step. */
async function harness(
  seedFields: Record<string, string[]> = { Status: ["Backlog", "Plan", "Review", "Build", "Verify", "Ship", "Done"] },
): Promise<Harness> {
  const repo = createRepo();
  const app = createApp(repo.path);
  const github = new FakeGitHub();
  const projectId = github.seedProject(OWNER, NUMBER, seedFields);
  const sync = new SyncService(app.store, github, { owner: OWNER, number: NUMBER });
  const { runId } = await app.specStart("INIT-1");
  await app.specComplete("INIT-1", runId, "apply", documentOf());
  return {
    app,
    github,
    sync,
    projectId,
    cleanup: () => repo.cleanup(),
    async fields() {
      const issue = github.issues.find((candidate) => candidate.body.includes(`codepatrol:work:${WORK}`));
      assert.ok(issue !== undefined, "the Work has an Issue");
      const itemId = await github.findProjectItem(projectId, issue.number);
      assert.ok(itemId !== null, "the Issue is a project item");
      return {
        itemId,
        status: github.fieldValueName(itemId, projectId, "Status"),
        nextStep: github.fieldValueName(itemId, projectId, "Next Step"),
      };
    },
  };
}

test("sync adopts the existing Status field, adds the missing option and creates Next Step", async () => {
  const h = await harness();
  try {
    await h.sync.sync();

    const status = await h.github.resolveSingleSelectField(h.projectId, "Status");
    assert.ok(status !== null, "the existing Status field is adopted, not duplicated");
    assert.deepEqual(
      status.options.map((option) => option.name),
      ["Backlog", "Plan", "Review", "Build", "Verify", "Ship", "Done", "Rolled Back"],
      "the missing Rolled Back option is added and the existing ones are preserved in place",
    );

    const nextStep = await h.github.resolveSingleSelectField(h.projectId, "Next Step");
    assert.ok(nextStep !== null, "Next Step is created");
    assert.deepEqual(
      nextStep.options.map((option) => option.name),
      ["Plan", "Review", "Build", "Verify", "Ship"],
    );

    // No parallel Stage field is ever introduced.
    assert.equal(await h.github.resolveSingleSelectField(h.projectId, "Stage"), null);
  } finally {
    h.cleanup();
  }
});

test("a new Work is projected as an item at Backlog with Next Step Plan", async () => {
  const h = await harness();
  try {
    const report = await h.sync.sync();
    assert.deepEqual(report.projectItems.created, [WORK]);
    const { status, nextStep } = await h.fields();
    assert.equal(status, "Backlog");
    assert.equal(nextStep, "Plan");
  } finally {
    h.cleanup();
  }
});

test("starting a stage moves Status and clears Next Step", async () => {
  const h = await harness();
  try {
    await h.sync.sync();
    await h.app.start(WORK, "plan");
    await h.sync.sync();

    const { status, nextStep } = await h.fields();
    assert.equal(status, "Plan");
    assert.equal(nextStep, null);
  } finally {
    h.cleanup();
  }
});

test("completing a stage leaves Status where it executed and records the decided destination", async () => {
  const h = await harness();
  try {
    await h.app.start(WORK, "plan");
    await h.app.complete(WORK, "plan", "continue");
    await h.sync.sync();

    const snapshot = await h.app.store.read();
    assert.equal(snapshot.works.get(WORK)?.workflow.stage, "review", "local state already points at the next stage");

    const { status, nextStep } = await h.fields();
    assert.equal(status, "Plan", "Status does not follow workflow.stage");
    assert.equal(nextStep, "Review");
  } finally {
    h.cleanup();
  }
});

test("a return records the return target as Next Step", async () => {
  const h = await harness();
  try {
    await h.app.start(WORK, "plan");
    await h.app.complete(WORK, "plan", "continue");
    await h.app.start(WORK, "review");
    await h.app.complete(WORK, "review", "return", { returnTo: "plan" });
    await h.sync.sync();

    const { status, nextStep } = await h.fields();
    assert.equal(status, "Review");
    assert.equal(nextStep, "Plan");
  } finally {
    h.cleanup();
  }
});

test("an accepted Work reaches Done with no Next Step", async () => {
  const h = await harness();
  try {
    for (const stage of ["plan", "review", "build"] as const) {
      await h.app.start(WORK, stage);
      await h.app.complete(WORK, stage, "continue");
    }
    await h.app.start(WORK, "verify");
    await h.app.complete(WORK, "verify", "continue");
    await h.app.start(WORK, "ship");
    await h.app.complete(WORK, "ship", "accept", { authority: "test-operator" });
    await h.sync.sync();

    const { status, nextStep } = await h.fields();
    assert.equal(status, "Done");
    assert.equal(nextStep, null);
  } finally {
    h.cleanup();
  }
});

test("a rolled-back Work reaches Rolled Back, the option sync had to add", async () => {
  const h = await harness();
  try {
    for (const stage of ["plan", "review", "build"] as const) {
      await h.app.start(WORK, stage);
      await h.app.complete(WORK, stage, "continue");
    }
    await h.app.start(WORK, "verify");
    await h.app.complete(WORK, "verify", "continue");
    await h.app.start(WORK, "ship");
    await h.app.complete(WORK, "ship", "rollback", { authority: "test-operator" });
    await h.sync.sync();

    const { status, nextStep } = await h.fields();
    assert.equal(status, "Rolled Back");
    assert.equal(nextStep, null);
  } finally {
    h.cleanup();
  }
});

test("repeated sync with unchanged local state changes nothing", async () => {
  const h = await harness();
  try {
    await h.sync.sync();
    const second = await h.sync.sync();
    assert.deepEqual(second.projectItems.created, [], "no duplicate item");
    assert.deepEqual(second.projectItems.updated, [], "no redundant field write");
    assert.equal(h.github.projectItems.length, 1);
  } finally {
    h.cleanup();
  }
});

test("a manually changed Status is corrected on the next sync and local state is untouched", async () => {
  const h = await harness();
  try {
    await h.app.start(WORK, "plan");
    await h.sync.sync();
    const { itemId } = await h.fields();

    // Someone drags the card from Plan to Ship on the board.
    const status = await h.github.resolveSingleSelectField(h.projectId, "Status");
    assert.ok(status !== null);
    const shipOption = status.options.find((option) => option.name === "Ship");
    assert.ok(shipOption !== undefined);
    await h.github.setItemFieldValue(h.projectId, itemId, status.id, shipOption.id);
    assert.equal(h.github.fieldValueName(itemId, h.projectId, "Status"), "Ship", "remote drift is in place");

    const report = await h.sync.sync();
    assert.deepEqual(report.projectItems.updated, [WORK], "the drift is corrected");
    assert.equal(h.github.fieldValueName(itemId, h.projectId, "Status"), "Plan", "local state wins");

    const snapshot = await h.app.store.read();
    assert.equal(snapshot.works.get(WORK)?.workflow.stage, "plan", "the manual edit never reached local state");
    assert.equal(snapshot.works.get(WORK)?.workflow.state, "active");
  } finally {
    h.cleanup();
  }
});

test("no configured project means no project calls at all", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    const github = new FakeGitHub();
    const sync = new SyncService(app.store, github); // no ProjectConfig
    const { runId } = await app.specStart("INIT-1");
    await app.specComplete("INIT-1", runId, "apply", documentOf());

    const report = await sync.sync();
    assert.deepEqual(report.projectItems.created, []);
    assert.equal(github.projectItems.length, 0);
    assert.ok(!github.calls.some((call) => call.startsWith("resolveProject")), "the project is never resolved");
  } finally {
    repo.cleanup();
  }
});
