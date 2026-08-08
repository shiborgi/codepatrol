import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { localGit } from "../adapters/git.js";
import { StateStore } from "../adapters/state-store.js";
import { runCli } from "../cli/run-cli.js";
import type { Work } from "../core/work.js";
import { createApp, documentOf, result, TODO } from "./support/app.js";
import { createRepo } from "./support/repo.js";

async function applySpec(app: ReturnType<typeof createApp>, doc = documentOf()): Promise<void> {
  const snapshot = await app.store.read();
  if (snapshot.initiatives.get("INIT-1")?.definitionState === "defined") return;
  const started = await app.specStart("INIT-1");
  await app.specComplete("INIT-1", started.runId, "apply", doc);
}

function io() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    sink: {
      out(text: string) {
        out.push(text);
      },
      err(text: string) {
        err.push(text);
      },
    },
    out: () => out.splice(0).join(""),
    err: () => err.splice(0).join(""),
  };
}

test("an invalid mutation is rejected before the state ref moves", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    await applySpec(app);
    const authoritative = repo.headCommit("refs/codepatrol/state");

    await assert.rejects(
      app.store.transact((snapshot) => {
        const work = snapshot.works.get("WORK-1.1.1") as Work;
        const corrupt: Work = { ...work, workflow: { ...work.workflow, stage: "build" } };
        return { message: "corrupt", works: new Map([["WORK-1.1.1", corrupt]]) };
      }),
      /does not match reconstructed/,
    );

    assert.equal(
      repo.headCommit("refs/codepatrol/state"),
      authoritative,
      "previous state commit remains authoritative",
    );
    const snapshot = await app.store.read();
    assert.equal(snapshot.works.get("WORK-1.1.1")?.workflow.stage, "plan", "state remains readable");
  } finally {
    repo.cleanup();
  }
});

test("concurrent transactions retry from the latest valid snapshot", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    await applySpec(app);

    const storeA = new StateStore(localGit(repo.path));
    const storeB = new StateStore(localGit(repo.path));

    await Promise.all([
      storeA.transact(() => ({ message: "concurrent a" })),
      storeB.transact(() => ({ message: "concurrent b" })),
    ]);

    const snapshot = await storeA.read();
    assert.equal(snapshot.initiatives.size, 1, "state intact after concurrent access");
    assert.ok(snapshot.works.has("WORK-1.1.1"), "works still present");
  } finally {
    repo.cleanup();
  }
});

test("empty flag values fail without writing state", async () => {
  const repo = createRepo();
  const files = mkdtempSync(join(tmpdir(), "codepatrol-flags-"));
  try {
    const app = createApp(repo.path);
    await applySpec(app);
    const before = repo.headCommit("refs/codepatrol/state");
    writeFileSync(join(files, "todo.json"), JSON.stringify({ todo: [{ id: "t1", title: "x" }] }));

    for (const flag of ["--harness=", "--model="]) {
      const { sink, err } = io();
      const code = await runCli(["plan", "start", "--work", "WORK-1.1.1", "--todo", join(files, "todo.json"), flag], {
        io: sink,
        cwd: repo.path,
      });
      assert.equal(code, 2, `${flag} is a usage error`);
      assert.equal(JSON.parse(err()).error, "USAGE");
      assert.equal(repo.headCommit("refs/codepatrol/state"), before, "no state write");
    }

    await assert.rejects(
      app.works.start("WORK-1.1.1", "plan", { harness: "", todo: TODO }),
      /harness must be non-empty/,
    );
    assert.equal(repo.headCommit("refs/codepatrol/state"), before, "API-level rejection writes nothing");
  } finally {
    repo.cleanup();
    rmSync(files, { recursive: true, force: true });
  }
});

test("reordered todo and acceptance results replay idempotently; changed content conflicts", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    await applySpec(app);
    const started = await app.start("WORK-1.1.1", "plan");
    await app.works.complete("WORK-1.1.1", "plan", started.attempt.runId, result("continue"));
    const before = repo.headCommit("refs/codepatrol/state");

    const reordered = result("continue");
    reordered.todo.reverse();
    const replayed = await app.works.complete("WORK-1.1.1", "plan", started.attempt.runId, reordered);
    assert.equal(replayed.workflow.stage, "review");
    assert.equal(repo.headCommit("refs/codepatrol/state"), before, "order-independent replay writes nothing");

    const changed = result("continue");
    changed.todo[0] = { ...changed.todo[0]!, note: "different" };
    await assert.rejects(app.works.complete("WORK-1.1.1", "plan", started.attempt.runId, changed), /different result/);
  } finally {
    repo.cleanup();
  }
});

test("dirty checkouts are refused at every build/verify/ship boundary without moving state", async () => {
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
            title: "Coded",
            description: "d",
            workType: "task",
            priority: "p2",
            delivery: "code",
            acceptance: ["ok"],
            blockedBy: [],
          },
        ],
      }),
    );
    await app.runStage("WORK-1.1.1", "plan", "continue");
    await app.runStage("WORK-1.1.1", "review", "continue");

    writeFileSync(join(repo.path, "untracked.txt"), "noise");
    await assert.rejects(app.start("WORK-1.1.1", "build"), /requires a clean checkout/);
    rmSync(join(repo.path, "untracked.txt"));

    writeFileSync(join(repo.path, "staged.txt"), "noise");
    repo.git(["add", "staged.txt"]);
    await assert.rejects(app.start("WORK-1.1.1", "build"), /requires a clean checkout/);
    repo.git(["reset", "-q", "--", "staged.txt"]);
    rmSync(join(repo.path, "staged.txt"));

    await app.start("WORK-1.1.1", "build");
    const stateBefore = repo.headCommit("refs/codepatrol/state");
    await assert.rejects(app.complete("WORK-1.1.1", "build", "continue"), /code work but HEAD is unchanged/);
    assert.equal(repo.headCommit("refs/codepatrol/state"), stateBefore, "failed validation performs no state write");

    writeFileSync(join(repo.path, "feature.txt"), "content");
    repo.git(["add", "feature.txt"]);
    repo.git(["commit", "-q", "-m", "candidate"]);
    writeFileSync(join(repo.path, "feature.txt"), "modified after commit");
    await assert.rejects(app.complete("WORK-1.1.1", "build", "continue"), /requires a clean checkout/);
    repo.git(["checkout", "--", "feature.txt"]);
    await app.complete("WORK-1.1.1", "build", "continue");

    writeFileSync(join(repo.path, "untracked.txt"), "noise");
    await assert.rejects(app.start("WORK-1.1.1", "verify"), /requires a clean checkout/);
    rmSync(join(repo.path, "untracked.txt"));

    const verify = await app.start("WORK-1.1.1", "verify");
    writeFileSync(join(repo.path, "untracked.txt"), "noise");
    await assert.rejects(
      app.works.complete("WORK-1.1.1", "verify", verify.attempt.runId, result("continue", "verify")),
      /requires a clean checkout/,
    );
    rmSync(join(repo.path, "untracked.txt"));
    await app.works.complete("WORK-1.1.1", "verify", verify.attempt.runId, result("continue", "verify"));

    writeFileSync(join(repo.path, "untracked.txt"), "noise");
    await assert.rejects(app.start("WORK-1.1.1", "ship"), /requires a clean checkout/);
    rmSync(join(repo.path, "untracked.txt"));
    const shipAttempt = await app.start("WORK-1.1.1", "ship");
    writeFileSync(join(repo.path, "untracked.txt"), "noise");
    await assert.rejects(
      app.works.complete(
        "WORK-1.1.1",
        "ship",
        shipAttempt.attempt.runId,
        result("accept", "ship", { authority: "tester" }),
      ),
      /requires a clean checkout/,
    );
    rmSync(join(repo.path, "untracked.txt"));
    await app.works.complete(
      "WORK-1.1.1",
      "ship",
      shipAttempt.attempt.runId,
      result("accept", "ship", { authority: "tester" }),
    );
  } finally {
    repo.cleanup();
  }
});

test("work evidence reports availability and state stays readable when product objects vanish", async () => {
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
            title: "Coded",
            description: "d",
            workType: "task",
            priority: "p2",
            delivery: "code",
            acceptance: ["ok"],
            blockedBy: [],
          },
        ],
      }),
    );
    await app.runStage("WORK-1.1.1", "plan", "continue");
    await app.runStage("WORK-1.1.1", "review", "continue");
    await app.start("WORK-1.1.1", "build");
    repo.git(["checkout", "-q", "-b", "candidate-branch"]);
    writeFileSync(join(repo.path, "code.txt"), "work");
    repo.git(["add", "code.txt"]);
    repo.git(["commit", "-q", "-m", "candidate"]);
    const candidate = repo.headCommit("HEAD");
    await app.complete("WORK-1.1.1", "build", "continue");

    const { sink, out } = io();
    const code = await runCli(["work", "evidence", "WORK-1.1.1"], { io: sink, cwd: repo.path });
    assert.equal(code, 0);
    const report = JSON.parse(out());
    const candidateEntry = report.evidence.find((entry: { kind: string }) => entry.kind === "candidateCommit");
    assert.equal(candidateEntry.commit, candidate);
    assert.equal(candidateEntry.available, true);
    assert.equal(candidateEntry.isHead, true);

    repo.git(["checkout", "-q", "main"]);
    repo.git(["branch", "-q", "-D", "candidate-branch"]);
    repo.git(["reflog", "expire", "--expire=now", "--all"]);
    repo.git(["gc", "--prune=now", "--quiet"]);

    const code2 = await runCli(["work", "evidence", "WORK-1.1.1"], { io: sink, cwd: repo.path });
    assert.equal(code2, 0);
    const report2 = JSON.parse(out());
    assert.equal(
      report2.evidence.find((entry: { kind: string }) => entry.kind === "candidateCommit").available,
      false,
      "candidate object is gone",
    );

    const snapshot = await app.store.read();
    assert.equal(
      snapshot.works.get("WORK-1.1.1")?.workflow.stage,
      "verify",
      "state remains readable without product objects",
    );
  } finally {
    repo.cleanup();
  }
});
