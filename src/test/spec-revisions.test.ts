import assert from "node:assert/strict";
import test from "node:test";
import { createApp, documentOf } from "./support/app.js";
import { createRepo } from "./support/repo.js";

async function applySpec(app: ReturnType<typeof createApp>, doc = documentOf()): Promise<void> {
  const started = await app.specStart("INIT-1");
  await app.specComplete("INIT-1", started.runId, "apply", doc);
}

test("spec start + complete produce two state commits", async () => {
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
            workType: "task",
            priority: "p2",
            delivery: "no-code",
            acceptance: [],
            blockedBy: [],
          },
          {
            id: "WORK-1.1.2",
            wave: "WAVE-1.1",
            title: "B",
            description: "b",
            workType: "task",
            priority: "p2",
            delivery: "no-code",
            acceptance: [],
            blockedBy: [],
          },
          {
            id: "WORK-1.1.3",
            wave: "WAVE-1.1",
            title: "C",
            description: "c",
            workType: "task",
            priority: "p2",
            delivery: "no-code",
            acceptance: [],
            blockedBy: [],
          },
        ],
      }),
    );
    const count = repo.git(["rev-list", "--count", "refs/codepatrol/state"]);
    assert.equal(count, "2", "start + complete = 2 state commits");
  } finally {
    repo.cleanup();
  }
});

test("dependency cycle is refused; state retains draft-only after start", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    const started = await app.specStart("INIT-1");
    const commitAfterStart = repo.headCommit("refs/codepatrol/state");
    await assert.rejects(
      app.specComplete(
        "INIT-1",
        started.runId,
        "apply",
        documentOf({
          works: [
            {
              id: "WORK-1.1.1",
              wave: "WAVE-1.1",
              title: "A",
              description: "a",
              workType: "task",
              priority: "p2",
              delivery: "no-code",
              acceptance: [],
              blockedBy: ["WORK-1.1.2"],
            },
            {
              id: "WORK-1.1.2",
              wave: "WAVE-1.1",
              title: "B",
              description: "b",
              workType: "task",
              priority: "p2",
              delivery: "no-code",
              acceptance: [],
              blockedBy: ["WORK-1.1.1"],
            },
          ],
        }),
      ),
      /cycle/,
    );
    assert.equal(repo.headCommit("refs/codepatrol/state"), commitAfterStart, "state unchanged after rejected complete");
    const snapshot = await app.store.read();
    assert.equal(snapshot.initiatives.size, 1, "draft initiative exists");
    assert.equal(snapshot.works.size, 0, "no works were written");
    assert.equal(snapshot.initiatives.get("INIT-1")?.definitionState, "draft");
  } finally {
    repo.cleanup();
  }
});

test("cross-initiative work ids in a spec document are refused atomically", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    const s1 = await app.specStart("INIT-1");
    await app.specComplete("INIT-1", s1.runId, "apply", documentOf({ id: "INIT-1", title: "One" }));
    const s2 = await app.specStart("INIT-2");
    await app.specComplete("INIT-2", s2.runId, "apply", documentOf({ id: "INIT-2", title: "Two" }));

    const s3 = await app.specStart("INIT-3");
    const commitAfterStart = repo.headCommit("refs/codepatrol/state");
    await assert.rejects(
      app.specComplete(
        "INIT-3",
        s3.runId,
        "apply",
        documentOf({
          id: "INIT-3",
          title: "Three",
          works: [
            {
              id: "WORK-2.1.1",
              wave: "WAVE-2.1",
              title: "hijack",
              description: "d",
              workType: "task",
              priority: "p2",
              delivery: "no-code",
              acceptance: [],
              blockedBy: [],
            },
          ],
        }),
      ),
      // The Wave the hijacked Work claims belongs to another Initiative, so the
      // document is refused before any write.
      /wave WAVE-2\.1 does not belong to initiative INIT-3/,
    );
    assert.equal(
      repo.headCommit("refs/codepatrol/state"),
      commitAfterStart,
      "no partial write from the failed complete",
    );
  } finally {
    repo.cleanup();
  }
});

test("duplicate ids, unknown refs and non-canonical ids are refused", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    const started = await app.specStart("INIT-1");
    await assert.rejects(
      app.specComplete(
        "INIT-1",
        started.runId,
        "apply",
        documentOf({
          works: [
            {
              id: "WORK-1.1.1",
              wave: "WAVE-1.1",
              title: "A",
              description: "a",
              workType: "task",
              priority: "p2",
              delivery: "no-code",
              acceptance: [],
              blockedBy: [],
            },
            {
              id: "WORK-1.1.1",
              wave: "WAVE-1.1",
              title: "B",
              description: "b",
              workType: "task",
              priority: "p2",
              delivery: "no-code",
              acceptance: [],
              blockedBy: [],
            },
          ],
        }),
      ),
      /duplicate work id/,
    );
    await app.spec.complete("INIT-1", started.runId, {
      decision: "discard",
      summary: "cleanup",
      todo: [
        { id: "t1", status: "dropped" },
        { id: "t2", status: "dropped" },
      ],
    });

    const s2 = await app.specStart("INIT-1");
    await assert.rejects(
      app.specComplete(
        "INIT-1",
        s2.runId,
        "apply",
        documentOf({
          works: [
            {
              id: "WORK-1.1.1",
              wave: "WAVE-1.1",
              title: "A",
              description: "a",
              workType: "task",
              priority: "p2",
              delivery: "no-code",
              acceptance: [],
              blockedBy: ["WORK-1.1.7"],
            },
          ],
        }),
      ),
      /depends on unknown work/,
    );
    await app.spec.complete("INIT-1", s2.runId, {
      decision: "discard",
      summary: "cleanup",
      todo: [
        { id: "t1", status: "dropped" },
        { id: "t2", status: "dropped" },
      ],
    });

    const s3 = await app.specStart("INIT-1");
    await assert.rejects(
      app.specComplete(
        "INIT-1",
        s3.runId,
        "apply",
        documentOf({
          works: [
            {
              id: "WORK-1.1.01",
              wave: "WAVE-1.1",
              title: "A",
              description: "a",
              workType: "task",
              priority: "p2",
              delivery: "no-code",
              acceptance: [],
              blockedBy: [],
            },
          ],
        }),
      ),
      /id must match/,
    );
    await app.spec.complete("INIT-1", s3.runId, {
      decision: "discard",
      summary: "cleanup",
      todo: [
        { id: "t1", status: "dropped" },
        { id: "t2", status: "dropped" },
      ],
    });

    await assert.rejects(app.specStart("INIT-01"), /INIT-<number>/);

    const snapshot = await app.store.read();
    assert.equal(snapshot.works.size, 0, "no works were written");
  } finally {
    repo.cleanup();
  }
});

test("a defined initiative can start spec for a new revision", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    await applySpec(app);
    await app.runStage("WORK-1.1.1", "plan", "continue");

    await app.specStart("INIT-1");
    const snapshot = await app.store.read();
    const initiative = snapshot.initiatives.get("INIT-1");
    assert.ok(initiative !== undefined);
    const active = initiative?.specExecutions.find((e) => e.status === "active");
    assert.ok(active !== undefined, "spec can start on a defined initiative");
    assert.equal(active?.baseRevision, initiative?.currentSpecRevision, "baseRevision is set to currentSpecRevision");
  } finally {
    repo.cleanup();
  }
});

test("second initiative uses independent id counter and work prefix", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    const firstStart = await app.specStart("INIT-1");
    assert.equal(firstStart.initiative, "INIT-1");
    await app.specComplete("INIT-1", firstStart.runId, "apply", documentOf({ id: "INIT-1", title: "One" }));
    const snapshot1 = await app.store.read();
    assert.equal(snapshot1.works.size, 1, "INIT-1 has a work");

    const secondStart = await app.specStart("INIT-2");
    assert.equal(secondStart.initiative, "INIT-2");
    await app.specComplete(
      "INIT-2",
      secondStart.runId,
      "apply",
      documentOf({
        id: "INIT-2",
        title: "Two",
        works: [
          {
            id: "WORK-2.1.1",
            wave: "WAVE-2.1",
            title: "Second init work",
            description: "d",
            workType: "task",
            priority: "p2",
            delivery: "no-code",
            acceptance: [],
            blockedBy: [],
          },
        ],
      }),
    );
    const snapshot2 = await app.store.read();
    assert.equal(snapshot2.initiatives.size, 2, "two initiatives");
    const init2Works = [...snapshot2.works.values()].filter((w) => w.initiative === "INIT-2");
    assert.equal(init2Works[0]?.id, "WORK-2.1.1", "INIT-2 work has correct prefix");
  } finally {
    repo.cleanup();
  }
});

test("new Initiative Spec succeeds with other Initiatives having started and terminal Works", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    // Create INIT-1 with a work and make it terminal
    const s1 = await app.specStart("INIT-1");
    await app.specComplete("INIT-1", s1.runId, "apply", documentOf({ id: "INIT-1", title: "One" }));
    await app.runStage("WORK-1.1.1", "plan", "continue");
    await app.runStage("WORK-1.1.1", "review", "continue");
    await app.runStage("WORK-1.1.1", "build", "continue");
    await app.runStage("WORK-1.1.1", "verify", "continue", {
      acceptance: [{ index: 0, status: "passed", summary: "ok" }],
    });
    await app.runStage("WORK-1.1.1", "ship", "accept", { authority: "test" });
    const snapshot1 = await app.store.read();
    assert.equal(snapshot1.works.get("WORK-1.1.1")?.completion?.outcome, "accepted");

    // Create INIT-2 with its own work — should succeed despite WORK-1.1.1 being terminal
    const s2 = await app.specStart("INIT-2");
    await app.specComplete(
      "INIT-2",
      s2.runId,
      "apply",
      documentOf({
        id: "INIT-2",
        title: "Two",
        works: [
          {
            id: "WORK-2.1.1",
            wave: "WAVE-2.1",
            title: "Second work",
            description: "d",
            workType: "task",
            priority: "p2",
            delivery: "no-code",
            acceptance: [],
            blockedBy: [],
          },
        ],
      }),
    );
    const snapshot2 = await app.store.read();
    assert.equal(snapshot2.works.size, 2, "both works exist");
    assert.ok(snapshot2.works.has("WORK-1.1.1"));
    assert.ok(snapshot2.works.has("WORK-2.1.1"));
  } finally {
    repo.cleanup();
  }
});

test("add Work to existing Initiative via new Spec revision succeeds without relisting other Initiative Works", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    // Create INIT-1 with one work
    const s1 = await app.specStart("INIT-1");
    await app.specComplete("INIT-1", s1.runId, "apply", documentOf({ id: "INIT-1", title: "One" }));
    // Create INIT-2 with one work (terminal)
    const s2 = await app.specStart("INIT-2");
    await app.specComplete(
      "INIT-2",
      s2.runId,
      "apply",
      documentOf({
        id: "INIT-2",
        title: "Two",
        works: [
          {
            id: "WORK-2.1.1",
            wave: "WAVE-2.1",
            title: "Other work",
            description: "d",
            workType: "task",
            priority: "p2",
            delivery: "no-code",
            acceptance: ["ok"],
            blockedBy: [],
          },
        ],
      }),
    );
    await app.runStage("WORK-2.1.1", "plan", "continue");
    await app.runStage("WORK-2.1.1", "review", "continue");
    await app.runStage("WORK-2.1.1", "build", "continue");
    await app.runStage("WORK-2.1.1", "verify", "continue", {
      acceptance: [{ index: 0, status: "passed", summary: "ok" }],
    });
    await app.runStage("WORK-2.1.1", "ship", "accept", { authority: "test" });

    // Now add a second work to INIT-1 via a new revision — should succeed without relisting WORK-2.1.1
    const s3 = await app.specStart("INIT-1");
    await app.specComplete(
      "INIT-1",
      s3.runId,
      "apply",
      documentOf({
        id: "INIT-1",
        title: "One",
        works: [
          {
            id: "WORK-1.1.1",
            wave: "WAVE-1.1",
            title: "First work",
            description: "one",
            workType: "task",
            priority: "p2",
            delivery: "no-code",
            acceptance: [],
            blockedBy: [],
          },
          {
            id: "WORK-1.1.2",
            wave: "WAVE-1.1",
            title: "Second work",
            description: "two",
            workType: "feature",
            priority: "p1",
            delivery: "no-code",
            acceptance: [],
            blockedBy: [],
          },
        ],
      }),
    );
    const snapshot = await app.store.read();
    assert.ok(snapshot.works.has("WORK-1.1.1"), "WORK-1.1.1 exists");
    assert.ok(snapshot.works.has("WORK-1.1.2"), "WORK-1.1.2 created");
    assert.ok(snapshot.works.has("WORK-2.1.1"), "WORK-2.1.1 untouched");
  } finally {
    repo.cleanup();
  }
});

test("not-yet-started Work from another Initiative is never marked for deletion by unrelated Spec revision", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    // Create INIT-1 with one work
    const s1 = await app.specStart("INIT-1");
    await app.specComplete("INIT-1", s1.runId, "apply", documentOf({ id: "INIT-1", title: "One" }));

    // Create INIT-2 with one work (not started)
    const s2 = await app.specStart("INIT-2");
    await app.specComplete(
      "INIT-2",
      s2.runId,
      "apply",
      documentOf({
        id: "INIT-2",
        title: "Two",
        works: [
          {
            id: "WORK-2.1.1",
            wave: "WAVE-2.1",
            title: "Other work",
            description: "d",
            workType: "task",
            priority: "p2",
            delivery: "no-code",
            acceptance: ["ok"],
            blockedBy: [],
          },
        ],
      }),
    );

    // Create a second revision of INIT-1 (unrelated spec) — should NOT affect WORK-2.1.1
    const s3 = await app.specStart("INIT-1");
    await app.specComplete(
      "INIT-1",
      s3.runId,
      "apply",
      documentOf({
        id: "INIT-1",
        title: "One",
        works: [
          {
            id: "WORK-1.1.1",
            wave: "WAVE-1.1",
            title: "First work",
            description: "one",
            workType: "task",
            priority: "p2",
            delivery: "no-code",
            acceptance: [],
            blockedBy: [],
          },
          {
            id: "WORK-1.1.2",
            wave: "WAVE-1.1",
            title: "Added later",
            description: "added",
            workType: "task",
            priority: "p3",
            delivery: "no-code",
            acceptance: [],
            blockedBy: [],
          },
        ],
      }),
    );
    const snapshot = await app.store.read();
    assert.ok(snapshot.works.has("WORK-2.1.1"), "WORK-2.1.1 was not deleted by INIT-1's revision");
    assert.equal(snapshot.works.get("WORK-2.1.1")?.initiative, "INIT-2", "WORK-2.1.1 still belongs to INIT-2");
  } finally {
    repo.cleanup();
  }
});
