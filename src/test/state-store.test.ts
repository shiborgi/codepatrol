import assert from "node:assert/strict";
import test from "node:test";
import { createApp, documentOf } from "./support/app.js";
import { createRepo } from "./support/repo.js";

async function applySpec(app: ReturnType<typeof createApp>, doc = documentOf()): Promise<void> {
  const started = await app.specStart("INIT-1");
  await app.specComplete("INIT-1", started.runId, "apply", doc);
}

test("state is written only to refs/codepatrol/state; heads untouched; no branches or worktrees", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    const baseCommit = repo.headCommit("refs/heads/main");
    const refsBefore = repo.refs();
    const headsBefore = repo.headRefs();
    const worktreesBefore = repo.git(["worktree", "list", "--porcelain"]);

    await applySpec(app);
    const newRefs = repo.refs().filter((ref) => !refsBefore.includes(ref));

    assert.deepEqual(repo.headRefs(), headsBefore, "no new branches");
    assert.deepEqual(newRefs, ["refs/codepatrol/state"], "only the state ref appears");
    assert.equal(repo.headCommit("refs/heads/main"), baseCommit, "main did not move");
    assert.equal(repo.git(["worktree", "list", "--porcelain"]), worktreesBefore, "no worktrees");

    await app.runStage("WORK-1.1.1", "plan", "continue");

    assert.deepEqual(repo.headRefs(), headsBefore, "no new branches after lifecycle");
    assert.equal(repo.headCommit("refs/heads/main"), baseCommit, "main did not move after lifecycle");
    assert.equal(repo.git(["worktree", "list", "--porcelain"]), worktreesBefore, "no worktrees after lifecycle");
  } finally {
    repo.cleanup();
  }
});

test("state round-trips through the store", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    await applySpec(
      app,
      documentOf({
        works: [
          {
            id: "WORK-1.1.1",
            wave: "WAVE-1.1",
            title: "A",
            description: "a",
            workType: "feature",
            priority: "p1",
            delivery: "no-code",
            acceptance: ["ok"],
            blockedBy: [],
          },
          {
            id: "WORK-1.1.2",
            wave: "WAVE-1.1",
            title: "B",
            description: "b",
            workType: "bug",
            priority: "p0",
            delivery: "no-code",
            acceptance: [],
            blockedBy: ["WORK-1.1.1"],
          },
        ],
      }),
    );
    const snapshot = await app.store.read();
    assert.ok(snapshot.commit !== null);
    assert.equal(snapshot.initiatives.size, 1);
    assert.equal(snapshot.works.size, 2);
    assert.deepEqual(snapshot.works.get("WORK-1.1.2")?.blockedBy, ["WORK-1.1.1"]);
    assert.equal(snapshot.works.get("WORK-1.1.1")?.initiative, "INIT-1");
  } finally {
    repo.cleanup();
  }
});
