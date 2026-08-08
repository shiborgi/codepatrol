import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { localGit } from "../adapters/git.js";
import { StateStore } from "../adapters/state-store.js";
import { StateTransferService } from "../application/state-transfer.js";
import type { DefinedInitiative } from "../core/initiative.js";
import { canonicalJson } from "../core/json.js";
import { createApp, documentOf } from "./support/app.js";
import { createRepo } from "./support/repo.js";

function gitAt(cwd: string, args: string[]): string {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith("GIT_")) env[key] = value;
  }
  return execFileSync("git", args, { cwd, encoding: "utf8", env }).trim();
}

function corruptTree(
  repo: ReturnType<typeof createRepo>,
  workJson: string,
  initiativeJson: string,
  waveJson: string,
): string {
  const workBlob = repo.gitWithInput(["hash-object", "-w", "--stdin"], workJson);
  const worksTree = repo.gitWithInput(["mktree"], `100644 blob ${workBlob}\tWORK-1.1.1.json\n`);
  const initiativeBlob = repo.gitWithInput(["hash-object", "-w", "--stdin"], initiativeJson);
  const initiativesTree = repo.gitWithInput(["mktree"], `100644 blob ${initiativeBlob}\tINIT-1.json\n`);
  const waveBlob = repo.gitWithInput(["hash-object", "-w", "--stdin"], waveJson);
  const wavesTree = repo.gitWithInput(["mktree"], `100644 blob ${waveBlob}\tWAVE-1.1.json\n`);
  const codepatrolTree = repo.gitWithInput(
    ["mktree"],
    `040000 tree ${initiativesTree}\tinitiatives\n040000 tree ${wavesTree}\twaves\n040000 tree ${worksTree}\tworks\n`,
  );
  return repo.gitWithInput(["mktree"], `040000 tree ${codepatrolTree}\t.codepatrol\n`);
}

function createBare(): { path: string; cleanup(): void } {
  const path = mkdtempSync(join(tmpdir(), "codepatrol-remote-"));
  gitAt(path, ["init", "--bare", "-b", "main"]);
  return { path, cleanup: () => rmSync(path, { recursive: true, force: true }) };
}

test("state push, clone and explicit fetch transfer the exact state", async () => {
  const origin = createBare();
  const repoA = createRepo();
  try {
    repoA.git(["remote", "add", "origin", origin.path]);
    repoA.git(["push", "-u", "origin", "main"]);
    const appA = createApp(repoA.path);
    const { runId } = await appA.specStart("INIT-1");
    await appA.specComplete("INIT-1", runId, "apply", documentOf());
    await appA.runStage("WORK-1.1.1", "plan", "continue");

    const transferA = new StateTransferService(localGit(repoA.path), appA.store);
    const before = await transferA.status("origin");
    assert.equal(before.relation, "missing-remote");

    const pushed = await transferA.push("origin");
    assert.equal(pushed.relation, "equal");
    assert.deepEqual(repoA.headRefs(), ["refs/heads/main"], "push touched only the state ref");
    const remoteRefs = gitAt(origin.path, ["for-each-ref", "--format=%(refname)"]).split("\n").filter(Boolean);
    assert.deepEqual(
      remoteRefs.sort(),
      ["refs/codepatrol/state", "refs/heads/main"],
      "remote received only the state ref",
    );

    const clonePath = mkdtempSync(join(tmpdir(), "codepatrol-clone-"));
    rmSync(clonePath, { recursive: true, force: true });
    gitAt(".", ["clone", "--quiet", origin.path, clonePath]);
    try {
      const cloneRefs = gitAt(clonePath, ["for-each-ref", "--format=%(refname)"]).split("\n").filter(Boolean);
      assert.ok(!cloneRefs.includes("refs/codepatrol/state"), "ordinary clone does not fetch the state ref");

      const transferB = new StateTransferService(localGit(clonePath), new StateStore(localGit(clonePath)));
      const status = await transferB.status("origin");
      assert.equal(status.relation, "missing-local");

      const fetched = await transferB.fetch("origin");
      assert.equal(fetched.relation, "equal");

      const storeB = new StateStore(localGit(clonePath));
      const snapshotB = await storeB.read();
      assert.equal(snapshotB.works.get("WORK-1.1.1")?.workflow.stage, "review");
      const initiativeB = snapshotB.initiatives.get("INIT-1");
      assert.equal(initiativeB?.definitionState, "defined");
      assert.equal((initiativeB as DefinedInitiative).title, "Test initiative");

      const snapshotA = await appA.store.read();
      assert.equal(snapshotB.commit, snapshotA.commit, "identical state commit");
    } finally {
      rmSync(clonePath, { recursive: true, force: true });
    }
  } finally {
    repoA.cleanup();
    origin.cleanup();
  }
});

test("diverged state refs are refused on push and fetch", async () => {
  const origin = createBare();
  const repoA = createRepo();
  const repoB = createRepo();
  try {
    repoA.git(["remote", "add", "origin", origin.path]);
    repoB.git(["remote", "add", "origin", origin.path]);
    const appA = createApp(repoA.path);
    const appB = createApp(repoB.path);
    const transferA = new StateTransferService(localGit(repoA.path), appA.store);
    const transferB = new StateTransferService(localGit(repoB.path), appB.store);

    const runA = await appA.specStart("INIT-1");
    await appA.specComplete("INIT-1", runA.runId, "apply", documentOf({ title: "From A" }));
    await transferA.push("origin");

    const runB = await appB.specStart("INIT-1");
    await appB.specComplete("INIT-1", runB.runId, "apply", documentOf({ title: "From B" }));
    await assert.rejects(transferB.push("origin"), /diverged|fetch/);
    const after = await transferB.status("origin");
    assert.equal(after.relation, "diverged", "unrelated state histories cannot be reconciled");

    await assert.rejects(transferB.fetch("origin"), /diverged/);
    const localAfter = repoB.headCommit("refs/codepatrol/state");
    const snapshotB = await appB.store.read();
    assert.equal(snapshotB.commit, localAfter, "local state untouched by refused fetch");
    const initiativeB = snapshotB.initiatives.get("INIT-1");
    assert.equal(initiativeB?.definitionState, "defined");
    assert.equal((initiativeB as DefinedInitiative).title, "From B");
  } finally {
    repoA.cleanup();
    repoB.cleanup();
    origin.cleanup();
  }
});

test("state status reports unavailable without any state", async () => {
  const origin = createBare();
  const repo = createRepo();
  try {
    repo.git(["remote", "add", "origin", origin.path]);
    const store = new StateStore(localGit(repo.path));
    const transfer = new StateTransferService(localGit(repo.path), store);
    const status = await transfer.status("origin");
    assert.equal(status.relation, "unavailable");
    await assert.rejects(transfer.push("origin"), /no local/);
    await assert.rejects(transfer.fetch("origin"), /has no refs\/codepatrol\/state/);
  } finally {
    repo.cleanup();
    origin.cleanup();
  }
});

test("remote advancement: unknown without objects, behind after fetch, equal after update", async () => {
  const origin = createBare();
  const repoA = createRepo();
  const repoB = createRepo();
  try {
    repoA.git(["remote", "add", "origin", origin.path]);
    repoB.git(["remote", "add", "origin", origin.path]);
    const appA = createApp(repoA.path);
    const appB = createApp(repoB.path, 100);
    const transferA = new StateTransferService(localGit(repoA.path), appA.store);
    const transferB = new StateTransferService(localGit(repoB.path), appB.store);

    const runA1 = await appA.specStart("INIT-1");
    await appA.specComplete("INIT-1", runA1.runId, "apply", documentOf({ title: "v1" }));
    await transferA.push("origin");

    await transferB.fetch("origin");
    const statusB = await transferB.status("origin");
    assert.equal(statusB.relation, "equal");

    const runB = await appB.specStart("INIT-2");
    await appB.specComplete(
      "INIT-2",
      runB.runId,
      "apply",
      documentOf({
        id: "INIT-2",
        title: "v2",
        works: [
          {
            id: "WORK-2.1.1",
            wave: "WAVE-2.1",
            title: "v2 work",
            description: "v2",
            workType: "task",
            priority: "p2",
            delivery: "no-code",
            acceptance: [],
            blockedBy: [],
          },
        ],
      }),
    );
    await transferB.push("origin");

    const statusA = await transferA.status("origin");
    assert.equal(statusA.relation, "unknown", "remote object not available locally yet");

    await transferA.fetch("origin");
    const afterFetch = await transferA.status("origin");
    assert.equal(afterFetch.relation, "equal");
    const snapshotA = await appA.store.read();
    assert.equal(snapshotA.initiatives.size, 2, "A now sees both initiatives");
  } finally {
    repoA.cleanup();
    repoB.cleanup();
    origin.cleanup();
  }
});

test("an unreachable remote reports unavailable and fails fetch/push in a controlled way", async () => {
  const repo = createRepo();
  try {
    repo.git(["remote", "add", "origin", "/nonexistent/remote-path"]);
    const app = createApp(repo.path);
    const { runId } = await app.specStart("INIT-1");
    await app.specComplete("INIT-1", runId, "apply", documentOf());
    const transfer = new StateTransferService(localGit(repo.path), app.store);

    const status = await transfer.status("origin");
    assert.equal(status.relation, "unavailable");
    assert.ok(status.error !== undefined && status.error !== "", "underlying git error is surfaced");

    await assert.rejects(transfer.fetch("origin"), /unavailable/);
    await assert.rejects(transfer.push("origin"), /unavailable/);
    await assert.rejects(transfer.status("bad name!"), /invalid remote name/);
  } finally {
    repo.cleanup();
  }
});

test("push refuses to publish locally corrupt state", async () => {
  const origin = createBare();
  const repo = createRepo();
  try {
    repo.git(["remote", "add", "origin", origin.path]);
    const app = createApp(repo.path);
    const { runId } = await app.specStart("INIT-1");
    await app.specComplete("INIT-1", runId, "apply", documentOf());
    await app.start("WORK-1.1.1", "plan");

    const store = new StateStore(localGit(repo.path));
    const snapshot = await store.read();
    const work = snapshot.works.get("WORK-1.1.1");
    const initiative = snapshot.initiatives.get("INIT-1");
    const wave = snapshot.waves.get("WAVE-1.1");
    assert.ok(work !== undefined && initiative !== undefined && wave !== undefined);
    const corruptWorkJson = canonicalJson({ ...work, workflow: { ...work.workflow, state: "ready" as const } });
    const commit = repo.gitWithInput(
      [
        "commit-tree",
        "-m",
        "corrupt",
        "-p",
        repo.headCommit("refs/codepatrol/state"),
        corruptTree(repo, corruptWorkJson, canonicalJson(initiative), canonicalJson(wave)),
      ],
      undefined,
      {},
    );
    repo.git(["update-ref", "refs/codepatrol/state", commit]);

    const transfer = new StateTransferService(localGit(repo.path), store);
    await assert.rejects(transfer.push("origin"), /STATE_CORRUPT|does not match reconstructed/);
    const remoteRefs = gitAt(origin.path, ["for-each-ref", "--format=%(refname)"]).split("\n").filter(Boolean);
    assert.deepEqual(remoteRefs, [], "nothing was pushed");
  } finally {
    repo.cleanup();
    origin.cleanup();
  }
});
