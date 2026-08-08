import assert from "node:assert/strict";
import test from "node:test";
import { localGit } from "../adapters/git.js";
import { StateStore } from "../adapters/state-store.js";
import { canonicalJson } from "../core/json.js";
import type { Work } from "../core/work.js";
import { createApp, documentOf, TODO } from "./support/app.js";
import { createRepo, type TestRepo } from "./support/repo.js";

async function applySpec(app: ReturnType<typeof createApp>, doc = documentOf()): Promise<void> {
  const snapshot = await app.store.read();
  if (snapshot.initiatives.get("INIT-1")?.definitionState === "defined") return;
  const started = await app.specStart("INIT-1");
  await app.specComplete("INIT-1", started.runId, "apply", doc);
}

function buildState(repo: TestRepo, files: Record<string, string>): string {
  const treeInput = (entries: string[]) => repo.gitWithInput(["mktree"], `${entries.join("\n")}\n`);
  const initiatives: string[] = [];
  const waves: string[] = [];
  const works: string[] = [];
  const others: string[] = [];
  for (const [path, content] of Object.entries(files)) {
    const blob = repo.gitWithInput(["hash-object", "-w", "--stdin"], content);
    const entry = `100644 blob ${blob}\t${path.split("/").pop()}`;
    if (path.startsWith(".codepatrol/initiatives/")) initiatives.push(entry);
    else if (path.startsWith(".codepatrol/waves/")) waves.push(entry);
    else if (path.startsWith(".codepatrol/works/")) works.push(entry);
    else others.push(`100644 blob ${blob}\t${path}`);
  }
  const rootEntries: string[] = [];
  if (initiatives.length > 0) rootEntries.push(`040000 tree ${treeInput(initiatives)}\tinitiatives`);
  if (waves.length > 0) rootEntries.push(`040000 tree ${treeInput(waves)}\twaves`);
  if (works.length > 0) rootEntries.push(`040000 tree ${treeInput(works)}\tworks`);
  for (const other of others) rootEntries.push(other);
  const codepatrolTree = treeInput(rootEntries);
  const rootTree = treeInput([`040000 tree ${codepatrolTree}\t.codepatrol`]);
  const commit = repo.gitWithInput(["commit-tree", rootTree, "-m", "corrupt"]);
  repo.git(["update-ref", "refs/codepatrol/state", commit]);
  return commit;
}

async function withInitiative(
  app: ReturnType<typeof createApp>,
  files: Record<string, string>,
): Promise<Record<string, string>> {
  const snapshot = await app.store.read();
  const initiative = snapshot.initiatives.get("INIT-1");
  assert.ok(initiative !== undefined);
  const waves: Record<string, string> = {};
  for (const wave of snapshot.waves.values()) {
    waves[`.codepatrol/waves/${wave.id}.json`] = canonicalJson(wave);
  }
  return { ".codepatrol/initiatives/INIT-1.json": canonicalJson(initiative), ...waves, ...files };
}

async function readWork(repo: TestRepo, id: string): Promise<Work> {
  const store = new StateStore(localGit(repo.path));
  const snapshot = await store.read();
  const work = snapshot.works.get(id);
  assert.ok(work !== undefined);
  return work;
}

test("unexpected paths in the state tree are corruption", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    await applySpec(app);
    const work = await readWork(repo, "WORK-1.1.1");
    buildState(
      repo,
      await withInitiative(app, {
        ".codepatrol/works/WORK-1.1.1.json": canonicalJson(work),
        ".codepatrol/works/README.md": "nope\n",
      }),
    );
    await assert.rejects(app.store.read(), /unexpected path/);
  } finally {
    repo.cleanup();
  }
});

test("filename id must match document id", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    await applySpec(app);
    const work = await readWork(repo, "WORK-1.1.1");
    buildState(repo, await withInitiative(app, { ".codepatrol/works/WORK-1.1.2.json": canonicalJson(work) }));
    await assert.rejects(app.store.read(), /filename id WORK-1.1.2 does not match document id WORK-1.1.1/);
  } finally {
    repo.cleanup();
  }
});

test("invalid id in state path is corruption", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    await applySpec(app);
    const work = await readWork(repo, "WORK-1.1.1");
    buildState(repo, await withInitiative(app, { ".codepatrol/works/WORK-1.1.01.json": canonicalJson(work) }));
    await assert.rejects(app.store.read(), /invalid id in state path/);
  } finally {
    repo.cleanup();
  }
});

test("a ready work with an active attempt is corruption", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    await applySpec(app);
    await app.start("WORK-1.1.1", "plan");
    const work = await readWork(repo, "WORK-1.1.1");
    const corrupt: Work = { ...work, workflow: { ...work.workflow, state: "ready" } };
    buildState(repo, await withInitiative(app, { ".codepatrol/works/WORK-1.1.1.json": canonicalJson(corrupt) }));
    await assert.rejects(app.store.read(), /does not match reconstructed/);
  } finally {
    repo.cleanup();
  }
});

test("a completed attempt without a result is corruption", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    await applySpec(app);
    await app.start("WORK-1.1.1", "plan");
    const work = await readWork(repo, "WORK-1.1.1");
    const attempt = work.attempts[0];
    assert.ok(attempt !== undefined);
    const corrupt: Work = {
      ...work,
      workflow: { ...work.workflow, state: "ready" },
      attempts: [{ ...attempt, status: "completed", finishedAt: attempt.startedAt }],
    };
    buildState(repo, await withInitiative(app, { ".codepatrol/works/WORK-1.1.1.json": canonicalJson(corrupt) }));
    await assert.rejects(app.store.read(), /completed attempt lacks finishedAt or result/);
  } finally {
    repo.cleanup();
  }
});

test("duplicate run ids across attempts are corruption", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    const started = await app.specStart("INIT-1");
    await app.specComplete(
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
        ],
      }),
    );
    await app.start("WORK-1.1.1", "plan");
    const a = await readWork(repo, "WORK-1.1.1");
    const b = await readWork(repo, "WORK-1.1.2");
    const attempt = a.attempts[0];
    assert.ok(attempt !== undefined);
    const corruptB: Work = {
      ...b,
      workflow: { ...b.workflow, state: "active" },
      attempts: [{ ...attempt, stage: "plan" }],
    };
    buildState(
      repo,
      await withInitiative(app, {
        ".codepatrol/works/WORK-1.1.1.json": canonicalJson(a),
        ".codepatrol/works/WORK-1.1.2.json": canonicalJson(corruptB),
      }),
    );
    await assert.rejects(app.store.read(), /multiple works have active attempts|appears more than once/);
  } finally {
    repo.cleanup();
  }
});

test("a work referring to a missing initiative is corruption", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    await applySpec(app);
    const work = await readWork(repo, "WORK-1.1.1");
    buildState(repo, { ".codepatrol/works/WORK-1.1.1.json": canonicalJson(work) });
    await assert.rejects(app.store.read(), /missing initiative/);
  } finally {
    repo.cleanup();
  }
});

test("a dependency cycle in stored state is corruption", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    const started = await app.specStart("INIT-1");
    await app.specComplete(
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
    );
    const initiative = (await app.store.read()).initiatives.get("INIT-1");
    assert.ok(initiative !== undefined);
    const a = await readWork(repo, "WORK-1.1.1");
    const b = await readWork(repo, "WORK-1.1.2");
    buildState(
      repo,
      await withInitiative(app, {
        ".codepatrol/works/WORK-1.1.1.json": canonicalJson({ ...a, blockedBy: ["WORK-1.1.2"] }),
        ".codepatrol/works/WORK-1.1.2.json": canonicalJson(b),
      }),
    );
    await assert.rejects(app.store.read(), /cycle/);
  } finally {
    repo.cleanup();
  }
});

test("attempt numbers out of sequence are corruption", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    await applySpec(app);
    await app.start("WORK-1.1.1", "plan", TODO);
    const work = await readWork(repo, "WORK-1.1.1");
    const attempt = work.attempts[0];
    assert.ok(attempt !== undefined);
    buildState(
      repo,
      await withInitiative(app, {
        ".codepatrol/works/WORK-1.1.1.json": canonicalJson({ ...work, attempts: [{ ...attempt, attempt: 7 }] }),
      }),
    );
    await assert.rejects(app.store.read(), /out of sequence/);
  } finally {
    repo.cleanup();
  }
});

const C1 = "a".repeat(40);
const C2 = "b".repeat(40);

async function progressedWork(
  repo: TestRepo,
  stages: ("plan" | "review" | "build" | "verify" | "ship")[],
): Promise<{ app: ReturnType<typeof createApp>; work: Work }> {
  const app = createApp(repo.path);
  await applySpec(app);
  for (const stage of stages) {
    await app.runStage(
      "WORK-1.1.1",
      stage,
      stage === "ship" ? "accept" : "continue",
      stage === "ship" ? { authority: "tester" } : {},
    );
  }
  const snapshot = await app.store.read();
  const work = snapshot.works.get("WORK-1.1.1");
  assert.ok(work !== undefined);
  return { app, work };
}

async function expectCorrupt(
  repo: TestRepo,
  app: ReturnType<typeof createApp>,
  work: Work,
  pattern: RegExp,
): Promise<void> {
  buildState(repo, await withInitiative(app, { ".codepatrol/works/WORK-1.1.1.json": canonicalJson(work) }));
  await assert.rejects(app.store.read(), pattern);
}

test("reconstruction: review without plan is corruption", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    await applySpec(app);
    await app.start("WORK-1.1.1", "plan");
    const { work } = await progressedWork(repo, []);
    const attempt = work.attempts[0];
    assert.ok(attempt !== undefined);
    const corrupt: Work = {
      ...work,
      workflow: { state: "active", stage: "review", updatedAt: work.createdAt },
      attempts: [{ ...attempt, stage: "review", execution: { ...attempt.execution, role: "review" } }],
    };
    await expectCorrupt(repo, app, corrupt, /not reachable/);
  } finally {
    repo.cleanup();
  }
});

test("reconstruction: build without review is corruption", async () => {
  const repo = createRepo();
  try {
    const { app, work } = await progressedWork(repo, ["plan"]);
    const corrupt: Work = { ...work, workflow: { ...work.workflow, stage: "build" } };
    await expectCorrupt(repo, app, corrupt, /persisted stage build does not match reconstructed review/);
  } finally {
    repo.cleanup();
  }
});

test("reconstruction: verify without a build candidate is corruption", async () => {
  const repo = createRepo();
  try {
    const { app, work } = await progressedWork(repo, ["plan", "review"]);
    const verifyAttempt = {
      stage: "verify" as const,
      attempt: 1,
      runId: "run-verify",
      status: "active" as const,
      execution: { role: "verify" as const, harness: "test" },
      todo: [{ id: "t1", title: "verify" }],
      startedAt: work.createdAt,
      evidence: { candidateCommit: C1 },
    };
    const corrupt: Work = {
      ...work,
      workflow: { state: "active", stage: "verify", updatedAt: work.createdAt },
      attempts: [...work.attempts, verifyAttempt],
    };
    await expectCorrupt(repo, app, corrupt, /not reachable|without a build candidate/);
  } finally {
    repo.cleanup();
  }
});

test("reconstruction: ship without a verified candidate is corruption", async () => {
  const repo = createRepo();
  try {
    const { app, work } = await progressedWork(repo, ["plan", "review", "build"]);
    const shipAttempt = {
      stage: "ship" as const,
      attempt: 1,
      runId: "run-ship",
      status: "active" as const,
      execution: { role: "ship" as const, harness: "test" },
      todo: [{ id: "t1", title: "ship" }],
      startedAt: work.createdAt,
      evidence: { candidateCommit: C1 },
    };
    const corrupt: Work = {
      ...work,
      workflow: { state: "active", stage: "ship", updatedAt: work.createdAt },
      attempts: [...work.attempts, shipAttempt],
    };
    await expectCorrupt(repo, app, corrupt, /not reachable|without a verified candidate/);
  } finally {
    repo.cleanup();
  }
});

test("reconstruction: attempt after terminal completion is corruption", async () => {
  const repo = createRepo();
  try {
    const { app, work } = await progressedWork(repo, ["plan", "review", "build", "verify", "ship"]);
    const extra = {
      stage: "plan" as const,
      attempt: 2,
      runId: "run-extra",
      status: "active" as const,
      execution: { role: "plan" as const, harness: "test" },
      todo: [{ id: "t1", title: "again" }],
      startedAt: work.createdAt,
    };
    await expectCorrupt(repo, app, { ...work, attempts: [...work.attempts, extra] }, /after terminal completion/);
  } finally {
    repo.cleanup();
  }
});

test("reconstruction: persisted completion inconsistent with ship result is corruption", async () => {
  const repo = createRepo();
  try {
    const { app, work } = await progressedWork(repo, ["plan", "review", "build", "verify", "ship"]);
    assert.ok(work.completion !== null);
    const corrupt: Work = { ...work, completion: { ...work.completion, outcome: "rolled-back" } };
    await expectCorrupt(repo, app, corrupt, /completion does not match/);
  } finally {
    repo.cleanup();
  }
});

test("reconstruction: invalid return target is corruption", async () => {
  const repo = createRepo();
  try {
    const { app, work } = await progressedWork(repo, ["plan"]);
    const review = {
      stage: "review" as const,
      attempt: 1,
      runId: "run-review",
      status: "completed" as const,
      execution: { role: "review" as const, harness: "test" },
      todo: [{ id: "t1", title: "review" }],
      startedAt: work.createdAt,
      finishedAt: work.createdAt,
      result: {
        decision: "return" as const,
        returnTo: "build" as const,
        summary: "bad",
        todo: [{ id: "t1", status: "done" as const }],
      },
    };
    const corrupt: Work = {
      ...work,
      workflow: { state: "ready", stage: "build", updatedAt: work.createdAt },
      attempts: [...work.attempts, review],
    };
    await expectCorrupt(repo, app, corrupt, /may only return/);
  } finally {
    repo.cleanup();
  }
});

test("reconstruction: acceptance evidence on a non-verify attempt is corruption", async () => {
  const repo = createRepo();
  try {
    const { app, work } = await progressedWork(repo, ["plan"]);
    const attempt = work.attempts[0];
    assert.ok(attempt !== undefined && attempt.result !== undefined);
    const corrupt: Work = {
      ...work,
      attempts: [
        { ...attempt, result: { ...attempt.result, acceptance: [{ index: 0, status: "passed", summary: "ok" }] } },
      ],
    };
    await expectCorrupt(repo, app, corrupt, /acceptance evidence is only valid at verify/);
  } finally {
    repo.cleanup();
  }
});

test("reconstruction: missing build evidence is corruption", async () => {
  const repo = createRepo();
  try {
    const { app, work } = await progressedWork(repo, ["plan", "review", "build"]);
    const build = work.attempts.find((a) => a.stage === "build");
    assert.ok(build !== undefined);
    const stripped = { ...build };
    delete stripped.evidence;
    const corrupt: Work = { ...work, attempts: work.attempts.map((a) => (a === build ? stripped : a)) };
    await expectCorrupt(repo, app, corrupt, /lacks baseCommit|lacks candidateCommit/);
  } finally {
    repo.cleanup();
  }
});

test("reconstruction: verify candidate differing from build candidate is corruption", async () => {
  const repo = createRepo();
  try {
    const { app, work } = await progressedWork(repo, ["plan", "review", "build", "verify"]);
    const verify = work.attempts.find((a) => a.stage === "verify");
    assert.ok(verify !== undefined);
    const altered = { ...verify, evidence: { candidateCommit: C2 } };
    const corrupt: Work = { ...work, attempts: work.attempts.map((a) => (a === verify ? altered : a)) };
    await expectCorrupt(repo, app, corrupt, /verify candidate differs/);
  } finally {
    repo.cleanup();
  }
});

test("reconstruction: ship candidate differing from verified candidate is corruption", async () => {
  const repo = createRepo();
  try {
    const { app, work } = await progressedWork(repo, ["plan", "review", "build", "verify", "ship"]);
    const ship = work.attempts.find((a) => a.stage === "ship");
    assert.ok(ship !== undefined);
    const altered = { ...ship, evidence: { candidateCommit: C2 } };
    const corrupt: Work = { ...work, attempts: work.attempts.map((a) => (a === ship ? altered : a)) };
    await expectCorrupt(repo, app, corrupt, /ship candidate differs/);
  } finally {
    repo.cleanup();
  }
});

void C1;
