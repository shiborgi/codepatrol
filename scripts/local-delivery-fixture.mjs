#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const parent = mkdtempSync(join(tmpdir(), "codepatrol-local-"));
const repo = join(parent, "repo");
mkdirSync(repo, { recursive: true });
const cli = process.env.CODEPATROL_BIN ?? join(process.cwd(), "bin/codepatrol.js");

const THE_ENV = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  GIT_AUTHOR_NAME: "local-fixture",
  GIT_AUTHOR_EMAIL: "local@localhost",
  GIT_COMMITTER_NAME: "local-fixture",
  GIT_COMMITTER_EMAIL: "local@localhost",
};

const git = (args) => execFileSync("git", args, { cwd: repo, encoding: "utf8", env: THE_ENV }).trim();
const gitAt = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", env: THE_ENV }).trim();

const run = (args) =>
  JSON.parse(execFileSync(process.execPath, [cli, "--workspace", repo, ...args], { encoding: "utf8", env: THE_ENV }));

function worktreePathFor(workId) {
  return join(parent, ".codepatrol-worktrees", workId);
}
const w = (id) => join(parent, "files", id);
mkdirSync(w("."), { recursive: true });

try {
  git(["init", "-b", "main"]);
  git(["commit", "--allow-empty", "-m", "initial"]);
  const base = git(["rev-parse", "refs/heads/main"]);

  writeFileSync(w("todo.json"), JSON.stringify({ todo: [{ id: "t1", title: "do" }] }));
  writeFileSync(
    w("spec-apply.json"),
    JSON.stringify({ decision: "apply", summary: "apply", todo: [{ id: "t1", status: "done" }] }),
  );
  const result = (decision, extra = {}) =>
    JSON.stringify({ decision, summary: `fixture ${decision}`, todo: [{ id: "t1", status: "done" }], ...extra });
  writeFileSync(w("continue.json"), result("continue"));
  writeFileSync(w("accept.json"), result("accept", { authority: "fixture" }));
  writeFileSync(w("rollback.json"), result("rollback", { authority: "fixture" }));
  writeFileSync(
    w("return-build.json"),
    result("return", { returnTo: "build", acceptance: [{ index: 0, status: "passed", summary: "ok" }] }),
  );
  writeFileSync(w("verify.json"), result("continue", { acceptance: [{ index: 0, status: "passed", summary: "ok" }] }));
  writeFileSync(
    w("initiative.json"),
    JSON.stringify({
      schemaVersion: 1,
      type: "codepatrol-initiative-document",
      initiative: { id: "INIT-1", title: "Local delivery fixture", intent: "prove code-delivery local-first contract" },
      waves: [{ id: "WAVE-1.1", title: "Wave 1", intent: "deliver wave 1" }],
      works: [
        {
          id: "WORK-1.1.1",
          wave: "WAVE-1.1",
          title: "Accept",
          description: "happy path accept",
          workType: "feature",
          priority: "p2",
          delivery: "code",
          acceptance: ["ok"],
          blockedBy: [],
        },
        {
          id: "WORK-1.1.2",
          wave: "WAVE-1.1",
          title: "Invalidation + Accept",
          description: "new commit after verify then revert and accept",
          workType: "feature",
          priority: "p2",
          delivery: "code",
          acceptance: ["ok"],
          blockedBy: [],
        },
        {
          id: "WORK-1.1.3",
          wave: "WAVE-1.1",
          title: "Dirty + Rollback",
          description: "dirty worktree then rollback",
          workType: "feature",
          priority: "p2",
          delivery: "code",
          acceptance: ["ok"],
          blockedBy: [],
        },
        {
          id: "WORK-1.1.4",
          wave: "WAVE-1.1",
          title: "Rebuild + Re-verify",
          description: "verify return, rebuild, reverify, accept",
          workType: "feature",
          priority: "p2",
          delivery: "code",
          acceptance: ["ok"],
          blockedBy: [],
        },
        {
          id: "WORK-1.1.6",
          wave: "WAVE-1.1",
          title: "Wave layer sibling A",
          description: "built in parallel with its sibling, ships first",
          workType: "feature",
          priority: "p2",
          delivery: "code",
          acceptance: ["ok"],
          blockedBy: [],
        },
        {
          id: "WORK-1.1.7",
          wave: "WAVE-1.1",
          title: "Wave layer sibling B",
          description: "built in parallel, left on a stale base once the sibling ships",
          workType: "feature",
          priority: "p2",
          delivery: "code",
          acceptance: ["ok"],
          blockedBy: [],
        },
        {
          id: "WORK-1.1.5",
          wave: "WAVE-1.1",
          title: "Base advancement",
          description: "base advanced between ship start and complete",
          workType: "feature",
          priority: "p2",
          delivery: "code",
          acceptance: ["ok"],
          blockedBy: [],
        },
      ],
    }),
  );

  const specStart = run(["spec", "start", "--initiative", "INIT-1", "--todo", w("todo.json")]);
  const validated = run([
    "spec",
    "validate",
    "--initiative",
    "INIT-1",
    "--run",
    specStart.runId,
    "--file",
    w("initiative.json"),
  ]);
  assert.equal(validated.valid, true);
  run([
    "spec",
    "complete",
    "--initiative",
    "INIT-1",
    "--run",
    specStart.runId,
    "--result",
    w("spec-apply.json"),
    "--file",
    w("initiative.json"),
  ]);

  const stageStart = (workId, name) => run([name, "start", "--work", workId, "--todo", w("todo.json")]).attempt.runId;

  function doBuild(workId) {
    let rid = stageStart(workId, "plan");
    run(["plan", "complete", "--work", workId, "--run", rid, "--result", w("continue.json")]);
    rid = stageStart(workId, "review");
    run(["review", "complete", "--work", workId, "--run", rid, "--result", w("continue.json")]);
    rid = stageStart(workId, "build");
    const wtPath = worktreePathFor(workId);
    assert.ok(existsSync(wtPath), `worktree exists: ${workId}`);
    writeFileSync(join(wtPath, "product.txt"), `feature for ${workId}`);
    gitAt(wtPath, ["add", "product.txt"]);
    gitAt(wtPath, ["commit", "-m", `first commit for ${workId}`]);
    writeFileSync(join(wtPath, "product.txt"), `feature for ${workId} v2`);
    gitAt(wtPath, ["add", "product.txt"]);
    gitAt(wtPath, ["commit", "-m", `second commit for ${workId}`]);
    run(["build", "complete", "--work", workId, "--run", rid, "--result", w("continue.json")]);
    return { wtPath, candidate: gitAt(wtPath, ["rev-parse", "HEAD"]) };
  }

  function doVerify(workId) {
    const rid = stageStart(workId, "verify");
    run(["verify", "complete", "--work", workId, "--run", rid, "--result", w("verify.json")]);
  }

  function doShipAccept(workId) {
    const rid = stageStart(workId, "ship");
    run(["ship", "complete", "--work", workId, "--run", rid, "--result", w("accept.json")]);
  }

  function doShipRollback(workId) {
    const rid = stageStart(workId, "ship");
    run(["ship", "complete", "--work", workId, "--run", rid, "--result", w("rollback.json")]);
  }

  // ── Scenario 1: WORK-1.1.1 Accept ──
  const b1 = doBuild("WORK-1.1.1");
  assert.ok(/^[0-9a-f]{40}$/.test(b1.candidate), "real candidate commit");
  assert.ok(git(["rev-parse", "refs/heads/codepatrol/WORK-1.1.1"]), "change branch exists");
  assert.ok(existsSync(b1.wtPath), "worktree exists");

  const s1 = run(["work", "show", "WORK-1.1.1"]);
  const build1 = s1.work.attempts.find((a) => a.stage === "build" && a.status === "completed");
  assert.ok(build1?.evidence?.change?.changedPaths?.includes("product.txt"), "build records product.txt");
  assert.equal(build1.evidence.change.commitCount, 2, "commitCount == 2");
  assert.equal(git(["rev-parse", "refs/heads/main"]), base, "main unchanged after build");

  doVerify("WORK-1.1.1");

  const s1v = run(["work", "show", "WORK-1.1.1"]);
  const v1 = s1v.work.attempts.find((a) => a.stage === "verify" && a.status === "completed");
  assert.ok(v1?.evidence?.changedPaths?.includes("product.txt"), "verify records observed changedPaths");
  assert.equal(gitAt(b1.wtPath, ["rev-parse", "HEAD"]), b1.candidate, "worktree HEAD == candidate");

  doShipAccept("WORK-1.1.1");

  const s1f = run(["work", "show", "WORK-1.1.1"]);
  assert.equal(s1f.work.completion.outcome, "accepted");
  const mainHead1 = git(["rev-parse", "refs/heads/main"]);
  assert.notEqual(mainHead1, base, "main advanced");
  const ship1 = s1f.work.attempts.find((a) => a.stage === "ship");
  assert.equal(
    ship1.evidence.finalCommit,
    ship1.evidence.localIntegration?.finalCommit,
    "finalCommit == localIntegration.finalCommit",
  );
  const finalTree = git(["rev-parse", `${ship1.evidence.finalCommit}^{tree}`]);
  const candTree = git(["rev-parse", `${b1.candidate}^{tree}`]);
  assert.equal(finalTree, candTree, "final commit tree == candidate tree");
  const mainCommits = git(["rev-list", "refs/heads/main"]).split("\n");
  assert.ok(!mainCommits.includes(b1.candidate), "intermediate commit absent from main history");

  assert.ok(!existsSync(b1.wtPath), "worktree removed after accept");
  let branches = git(["for-each-ref", "--format=%(refname)", "refs/heads"]).split("\n").filter(Boolean);
  assert.ok(!branches.includes("refs/heads/codepatrol/WORK-1.1.1"), "change branch removed after accept");

  // ── Scenario 2: WORK-1.1.2 Invalidation + Accept ──
  const b2 = doBuild("WORK-1.1.2");
  doVerify("WORK-1.1.2");
  // New commit after verify invalidates candidate
  writeFileSync(join(b2.wtPath, "extra.txt"), "extra");
  gitAt(b2.wtPath, ["add", "extra.txt"]);
  gitAt(b2.wtPath, ["commit", "-m", "extra commit after verify"]);
  const newCommit2 = gitAt(b2.wtPath, ["rev-parse", "HEAD"]);
  assert.notEqual(newCommit2, b2.candidate, "new commit differs from candidate");

  let failed = false;
  try {
    stageStart("WORK-1.1.2", "ship");
  } catch {
    failed = true;
  }
  assert.ok(failed, "ship start refused after new commit");

  gitAt(b2.wtPath, ["reset", "--hard", b2.candidate]);
  assert.equal(gitAt(b2.wtPath, ["rev-parse", "HEAD"]), b2.candidate, "reverted to candidate");
  doShipAccept("WORK-1.1.2");
  assert.equal(run(["work", "show", "WORK-1.1.2"]).work.completion.outcome, "accepted");

  // ── Scenario 3: WORK-1.1.3 Dirty + Rollback ──
  const b3 = doBuild("WORK-1.1.3");
  doVerify("WORK-1.1.3");
  writeFileSync(join(b3.wtPath, "product.txt"), "dirty content");
  failed = false;
  try {
    stageStart("WORK-1.1.3", "ship");
  } catch {
    failed = true;
  }
  assert.ok(failed, "ship start refused on dirty worktree");

  gitAt(b3.wtPath, ["checkout", "--", "product.txt"]);
  const preRollbackHead = git(["rev-parse", "refs/heads/main"]);
  doShipRollback("WORK-1.1.3");

  const s3f = run(["work", "show", "WORK-1.1.3"]);
  assert.equal(s3f.work.completion.outcome, "rolled-back");
  assert.equal(git(["rev-parse", "refs/heads/main"]), preRollbackHead, "main unchanged after rollback");
  assert.ok(!existsSync(b3.wtPath), "worktree removed after rollback");
  branches = git(["for-each-ref", "--format=%(refname)", "refs/heads"]).split("\n").filter(Boolean);
  assert.ok(branches.includes("refs/heads/codepatrol/WORK-1.1.3"), "change branch retained after rollback");

  // ── Scenario 4: WORK-1.1.4 Rebuild + Re-verify ──
  const b4 = doBuild("WORK-1.1.4");
  const ridV4 = stageStart("WORK-1.1.4", "verify");
  writeFileSync(join(b4.wtPath, "product.txt"), "dirty before verify complete");
  failed = false;
  try {
    run(["verify", "complete", "--work", "WORK-1.1.4", "--run", ridV4, "--result", w("continue.json")]);
  } catch {
    failed = true;
  }
  assert.ok(failed, "verify complete refused on dirty worktree");

  gitAt(b4.wtPath, ["checkout", "--", "product.txt"]);
  run(["verify", "complete", "--work", "WORK-1.1.4", "--run", ridV4, "--result", w("return-build.json")]);

  const ridB4b = stageStart("WORK-1.1.4", "build");
  writeFileSync(join(b4.wtPath, "product.txt"), "feature for WORK-1.1.4 v2 rebuilt");
  gitAt(b4.wtPath, ["add", "product.txt"]);
  gitAt(b4.wtPath, ["commit", "-m", "rebuild commit"]);
  run(["build", "complete", "--work", "WORK-1.1.4", "--run", ridB4b, "--result", w("continue.json")]);
  const newCandidate4 = gitAt(b4.wtPath, ["rev-parse", "HEAD"]);

  doVerify("WORK-1.1.4");
  doShipAccept("WORK-1.1.4");

  const s4f = run(["work", "show", "WORK-1.1.4"]);
  assert.equal(s4f.work.completion.outcome, "accepted");
  const ship4 = s4f.work.attempts.find((a) => a.stage === "ship");
  const finalTree4 = git(["rev-parse", `${ship4.evidence.finalCommit}^{tree}`]);
  const newCandTree4 = git(["rev-parse", `${newCandidate4}^{tree}`]);
  assert.equal(finalTree4, newCandTree4, "final tree == NEW candidate tree after rebuild");

  // ── Scenario 5: WORK-1.1.5 Base advancement ──
  const _b5 = doBuild("WORK-1.1.5");
  doVerify("WORK-1.1.5");
  const ridS5 = stageStart("WORK-1.1.5", "ship");
  const recordedBase5 = run(["work", "show", "WORK-1.1.5"]).work.attempts.find(
    (a) => a.stage === "ship" && a.status === "active",
  )?.evidence?.baseCommit;
  git(["commit", "--allow-empty", "-m", "base advanced"]);
  failed = false;
  try {
    run(["ship", "complete", "--work", "WORK-1.1.5", "--run", ridS5, "--result", w("accept.json")]);
  } catch {
    failed = true;
  }
  assert.ok(failed, "ship complete refused on base advancement");

  const log5 = git(["log", "--format=%H %s", "HEAD"]);
  assert.equal(
    log5.split("\n").filter((l) => l.includes("codepatrol: ship WORK-1.1.5")).length,
    0,
    "no integration commit while refused",
  );

  git(["reset", "--hard", recordedBase5]);
  run(["ship", "complete", "--work", "WORK-1.1.5", "--run", ridS5, "--result", w("accept.json")]);
  assert.equal(run(["work", "show", "WORK-1.1.5"]).work.completion.outcome, "accepted");

  // ── Scenario 6: WAVE-1.1 layer built in parallel, first ship staling the sibling ──
  const siblings = ["WORK-1.1.6", "WORK-1.1.7"];
  const waveTodo = { works: Object.fromEntries(siblings.map((id) => [id, { todo: [{ id: "t1", title: "do" }] }])) };
  writeFileSync(w("wave-todo.json"), JSON.stringify(waveTodo));
  const waveResult = (decision, extra = {}) =>
    JSON.stringify({
      works: Object.fromEntries(
        siblings.map((id) => [
          id,
          { run: runIds[id], decision, summary: `wave ${decision}`, todo: [{ id: "t1", status: "done" }], ...extra },
        ]),
      ),
    });
  const runIds = {};
  const waveStart = (stage) => {
    const started = run([stage, "start", "--wave", "WAVE-1.1", "--todo", w("wave-todo.json")]);
    assert.deepEqual(started.layer, siblings, `${stage} layer is the whole sibling pair`);
    for (const entry of started.started) runIds[entry.work] = entry.runId;
    return started;
  };

  waveStart("plan");
  writeFileSync(w("wave-continue.json"), waveResult("continue"));
  run(["plan", "complete", "--wave", "WAVE-1.1", "--result", w("wave-continue.json")]);

  waveStart("review");
  writeFileSync(w("wave-continue.json"), waveResult("continue"));
  run(["review", "complete", "--wave", "WAVE-1.1", "--result", w("wave-continue.json")]);

  waveStart("build");
  const baseBefore = git(["rev-parse", "refs/heads/main"]);
  for (const id of siblings) {
    const wtPath = worktreePathFor(id);
    assert.ok(existsSync(wtPath), `parallel worktree exists: ${id}`);
    writeFileSync(join(wtPath, `${id}.txt`), `parallel feature for ${id}`);
    gitAt(wtPath, ["add", "."]);
    gitAt(wtPath, ["commit", "-m", `parallel commit for ${id}`]);
  }
  const recordedBases = siblings.map((id) => {
    const attempt = run(["work", "show", id]).work.attempts.find((a) => a.stage === "build" && a.status === "active");
    return attempt.evidence.baseCommit;
  });
  assert.equal(new Set(recordedBases).size, 1, "both siblings are anchored on the same base commit");
  assert.equal(recordedBases[0], baseBefore, "the shared base is the branch head at start");

  writeFileSync(w("wave-continue.json"), waveResult("continue"));
  run(["build", "complete", "--wave", "WAVE-1.1", "--result", w("wave-continue.json")]);

  waveStart("verify");
  writeFileSync(
    w("wave-verify.json"),
    waveResult("continue", { acceptance: [{ index: 0, status: "passed", summary: "ok" }] }),
  );
  run(["verify", "complete", "--wave", "WAVE-1.1", "--result", w("wave-verify.json")]);

  // Ship stays work by work: the first accepted sibling advances the shared base.
  doShipAccept("WORK-1.1.6");
  assert.notEqual(git(["rev-parse", "refs/heads/main"]), baseBefore, "the accepted sibling advanced the base");

  const evidence7 = run(["work", "evidence", "WORK-1.1.7"]).evidence;
  const staleBase = evidence7.filter((entry) => entry.kind === "baseCommit" && entry.baseStale === true);
  assert.ok(staleBase.length > 0, "the sibling's change is observably anchored on a stale base");

  failed = false;
  try {
    run(["ship", "start", "--work", "WORK-1.1.7", "--todo", w("todo.json")]);
  } catch (error) {
    failed = true;
    assert.match(String(error.stdout ?? "") + String(error.stderr ?? ""), /re-verify or rebuild the Change/);
  }
  assert.ok(failed, "shipping the stale sibling is refused with a rebuild instruction");

  // ── Final state ──
  const refs = git(["for-each-ref", "--format=%(refname)"]).split("\n").filter(Boolean);
  assert.ok(refs.includes("refs/codepatrol/state"), "state ref exists");
  assert.equal(git(["remote"]), "", "no remotes configured");

  for (const wid of ["WORK-1.1.1", "WORK-1.1.2", "WORK-1.1.3", "WORK-1.1.4", "WORK-1.1.5", "WORK-1.1.6"]) {
    assert.equal(run(["work", "show", wid]).work.workflow.state, "terminal", `${wid} terminal`);
  }

  console.log("local-delivery: OK");
} finally {
  rmSync(parent, { recursive: true, force: true });
}
