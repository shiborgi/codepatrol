import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { Repository } from "../src/git.js";
import { commitCandidate, fixture } from "./helpers.js";

test("prospective state is validated before publication", () => {
  const { repo } = fixture();
  assert.throws(
    () =>
      repo.mutate("invalid", (state) => {
        state.nextInit = 0;
      }),
    (error: unknown) => (error as { code?: string }).code === "STATE_INVALID",
  );
  assert.equal(repo.resolveRef("refs/codepatrol/v1/state"), null);
});

test("verification setup failure is infrastructure evidence", () => {
  const { repo } = fixture();
  const base = repo.currentCommit("main");
  const workspace = repo.createWorkspace("TASK-fixture", base);
  commitCandidate(workspace, "infrastructure");
  const candidate = repo.submitCandidate(
    "TASK-fixture",
    "WAVE-1.1",
    "PROP-fixture",
    base,
  );
  repo.removeWorkspace("TASK-fixture");
  const evidence = repo.verifyCandidate(
    "PROP-fixture",
    candidate.commit,
    ["codepatrol-command-that-does-not-exist"],
    1_000,
  );
  assert.equal(evidence.status, "infrastructure-failed");
  assert.equal(evidence.exitCode, null);
  repo.deleteRef(candidate.ref, candidate.commit);
});

test("repository identity survives a filesystem move", () => {
  const { root, repo, service } = fixture();
  service.createInit("Move", "Keep state readable");
  const projectId = repo.projectId;
  const moved = `${root}-moved`;
  renameSync(root, moved);
  const reopened = new Repository(moved);
  assert.equal(reopened.projectId, projectId);
  assert.equal(reopened.readState().state.inits[0]?.id, "INIT-1");
});

test("stale lock owned by a dead process is recovered", () => {
  const { repo, service } = fixture();
  const lock = resolve(repo.commonDir, "codepatrol-v1.lock");
  mkdirSync(lock);
  writeFileSync(resolve(lock, "owner.json"), JSON.stringify({ pid: 2_147_483_647 }));
  assert.equal(service.createInit("Lock", "Recover").id, "INIT-1");
});

test("old ownerless lock is recovered without racing acquisition", () => {
  const { repo, service } = fixture();
  const lock = resolve(repo.commonDir, "codepatrol-v1.lock");
  mkdirSync(lock);
  const old = new Date(Date.now() - 10_000);
  utimesSync(lock, old, old);
  assert.equal(service.createInit("Lock", "Recover ownerless lock").id, "INIT-1");
});

test("cleanup preserves active build workspaces", () => {
  const { repo, service } = fixture();
  const base = repo.currentCommit("main");
  const workspace = repo.createWorkspace("TASK-active", base);
  repo.mutate("active task fixture", (state) => {
    state.tasks.push({
      id: "TASK-active",
      operation: "build",
      subjectId: "WAVE-1.1",
      round: 1,
      status: "open",
      source: { harness: "test", model: null, agent: null },
      workspace,
      baseCommit: base,
      proposalId: null,
      result: null,
      verification: [],
      failure: null,
      createdAt: new Date().toISOString(),
      finishedAt: null,
    });
  });
  const cleanup = service.cleanup();
  assert.deepEqual(cleanup.preservedWorktrees, [workspace]);
  assert.deepEqual(repo.listManagedWorktrees(), [workspace]);
  repo.removeWorkspace("TASK-active");
});

test("cleanup recovers an interrupted pre-transaction Ship", () => {
  const { repo, service } = fixture();
  const base = repo.currentCommit("main");
  const workspace = repo.createWorkspace("TASK-ship", base);
  commitCandidate(workspace, "ship-journal");
  const candidate = repo.submitCandidate("TASK-ship", "WAVE-1.1", "PROP-ship", base);
  repo.removeWorkspace("TASK-ship");
  const journal = resolve(repo.commonDir, "codepatrol-v1-ship.json");
  writeFileSync(
    journal,
    JSON.stringify({
      branch: "main",
      oldMain: base,
      oldTree: repo.git(["rev-parse", `${base}^{tree}`]).trim(),
      candidateCommit: candidate.commit,
      candidateTree: candidate.tree,
    }),
  );
  repo.git(["read-tree", "-m", "-u", base, candidate.commit]);
  assert.equal(existsSync(journal), true);
  service.cleanup();
  assert.equal(existsSync(journal), false);
  assert.equal(repo.git(["status", "--porcelain"]), "");
  assert.equal(repo.currentCommit("main"), base);
});

test("Ship refuses an ignored local path added by the candidate", () => {
  const { root, repo } = fixture();
  writeFileSync(resolve(repo.commonDir, "info", "exclude"), ".env\n");
  const base = repo.currentCommit("main");
  const workspace = repo.createWorkspace("TASK-collision", base);
  writeFileSync(resolve(workspace, ".env"), "candidate-secret\n");
  repo.git(["add", "-f", ".env"], workspace);
  repo.git(
    [
      "-c",
      "user.name=Builder",
      "-c",
      "user.email=builder@example.com",
      "commit",
      "-m",
      "add environment file",
    ],
    workspace,
  );
  const candidate = repo.submitCandidate(
    "TASK-collision",
    "WAVE-1.1",
    "PROP-collision",
    base,
  );
  repo.removeWorkspace("TASK-collision");
  writeFileSync(resolve(root, ".env"), "local-secret\n");
  const state = repo.readState().state;
  state.sequence += 1;
  assert.throws(
    () =>
      repo.atomicShip(
        state,
        null,
        "main",
        base,
        candidate.ref,
        candidate.commit,
        "collision",
      ),
    (error: unknown) => (error as { code?: string }).code === "LOCAL_PATH_COLLISION",
  );
  assert.equal(repo.currentCommit("main"), base);
  assert.equal(repo.resolveRef(candidate.ref), candidate.commit);
});

test("Ship recovery refuses an ignored path restored after interruption", () => {
  const { root, repo, service } = fixture();
  writeFileSync(resolve(root, ".env"), "tracked-original\n");
  repo.git(["add", ".env"]);
  repo.git([
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-m",
    "track environment fixture",
  ]);
  writeFileSync(resolve(repo.commonDir, "info", "exclude"), ".env\n");
  const base = repo.currentCommit("main");
  const workspace = repo.createWorkspace("TASK-recovery-collision", base);
  repo.git(["rm", ".env"], workspace);
  repo.git(
    [
      "-c",
      "user.name=Builder",
      "-c",
      "user.email=builder@example.com",
      "commit",
      "-m",
      "remove environment file",
    ],
    workspace,
  );
  const candidate = repo.submitCandidate(
    "TASK-recovery-collision",
    "WAVE-1.1",
    "PROP-recovery-collision",
    base,
  );
  repo.removeWorkspace("TASK-recovery-collision");
  const journal = resolve(repo.commonDir, "codepatrol-v1-ship.json");
  writeFileSync(
    journal,
    JSON.stringify({
      branch: "main",
      oldMain: base,
      oldTree: repo.git(["rev-parse", `${base}^{tree}`]).trim(),
      candidateCommit: candidate.commit,
      candidateTree: candidate.tree,
    }),
  );
  repo.git(["read-tree", "-m", "-u", base, candidate.commit]);
  writeFileSync(resolve(root, ".env"), "local-recreated\n");
  assert.throws(
    () => service.cleanup(),
    (error: unknown) => (error as { code?: string }).code === "SHIP_RECOVERY_REQUIRED",
  );
  assert.equal(readFileSync(resolve(root, ".env"), "utf8"), "local-recreated\n");
});
