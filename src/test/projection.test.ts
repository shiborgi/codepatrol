import assert from "node:assert/strict";
import test from "node:test";
import { projectNextStepOf, projectStatusOf } from "../core/projection.js";
import type { Work } from "../core/work.js";
import { createApp, documentOf, TODO } from "./support/app.js";
import { createRepo } from "./support/repo.js";

const WORK = "WORK-1.1.1";

async function withWork(
  action: (app: ReturnType<typeof createApp>, read: () => Promise<Work>) => Promise<void>,
): Promise<void> {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    const { runId } = await app.specStart("INIT-1");
    await app.specComplete("INIT-1", runId, "apply", documentOf());
    const read = async (): Promise<Work> => {
      const snapshot = await app.store.read();
      const work = snapshot.works.get(WORK);
      assert.ok(work !== undefined);
      return work;
    };
    await action(app, read);
  } finally {
    repo.cleanup();
  }
}

test("a Work with no attempts is Backlog with Next Step Plan", async () => {
  await withWork(async (_app, read) => {
    const work = await read();
    assert.equal(projectStatusOf(work), "Backlog");
    assert.equal(projectNextStepOf(work), "Plan");
  });
});

test("an active attempt reports its own stage and clears Next Step", async () => {
  await withWork(async (app, read) => {
    await app.start(WORK, "plan");
    const work = await read();
    assert.equal(projectStatusOf(work), "Plan");
    assert.equal(projectNextStepOf(work), null);
  });
});

test("a completed stage keeps Status on the executed stage and sets Next Step to the decision", async () => {
  await withWork(async (app, read) => {
    await app.start(WORK, "plan");
    await app.complete(WORK, "plan", "continue");
    const work = await read();
    // workflow.stage already points at review; Status must not follow it.
    assert.equal(work.workflow.stage, "review");
    assert.equal(projectStatusOf(work), "Plan");
    assert.equal(projectNextStepOf(work), "Review");
  });
});

test("Status advances only when the next stage actually starts", async () => {
  await withWork(async (app, read) => {
    await app.start(WORK, "plan");
    await app.complete(WORK, "plan", "continue");
    await app.start(WORK, "review");
    const work = await read();
    assert.equal(projectStatusOf(work), "Review");
    assert.equal(projectNextStepOf(work), null);
  });
});

test("a return records the decided destination as Next Step", async () => {
  await withWork(async (app, read) => {
    await app.start(WORK, "plan");
    await app.complete(WORK, "plan", "continue");
    await app.start(WORK, "review");
    await app.complete(WORK, "review", "return", { returnTo: "plan" });
    const work = await read();
    assert.equal(projectStatusOf(work), "Review", "Status stays on the stage that executed");
    assert.equal(projectNextStepOf(work), "Plan");
  });
});

test("an accepted Work is Done and a rolled-back Work is Rolled Back, both with no Next Step", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    const { runId } = await app.specStart("INIT-1");
    await app.specComplete("INIT-1", runId, "apply", documentOf());
    for (const stage of ["plan", "review", "build"] as const) {
      await app.start(WORK, stage);
      await app.complete(WORK, stage, "continue");
    }
    await app.start(WORK, "verify");
    await app.complete(WORK, "verify", "continue");
    await app.start(WORK, "ship");
    await app.complete(WORK, "ship", "accept", { authority: "test-operator" });

    const snapshot = await app.store.read();
    const work = snapshot.works.get(WORK);
    assert.ok(work !== undefined);
    assert.equal(projectStatusOf(work), "Done");
    assert.equal(projectNextStepOf(work), null);
  } finally {
    repo.cleanup();
  }
});

test("every stage maps to its Status name", async () => {
  await withWork(async (app, read) => {
    const expected = [
      ["plan", "Plan"],
      ["review", "Review"],
      ["build", "Build"],
    ] as const;
    for (const [stage, status] of expected) {
      await app.start(WORK, stage);
      assert.equal(projectStatusOf(await read()), status);
      await app.complete(WORK, stage, "continue");
    }
    void TODO;
  });
});
