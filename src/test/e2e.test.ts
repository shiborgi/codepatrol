import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { localGit } from "../adapters/git.js";
import { StateStore } from "../adapters/state-store.js";
import { runCli } from "../cli/run-cli.js";
import { FakeGitHub } from "./support/github.js";
import { createRepo } from "./support/repo.js";

function gitAt(cwd: string, args: string[]): string {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith("GIT_")) env[key] = value;
  }
  return execFileSync("git", args, { cwd, encoding: "utf8", env }).trim();
}

test("required end-to-end scenario: blocker and dependent, projection, state transfer", async () => {
  const repo = createRepo();
  const files = mkdtempSync(join(tmpdir(), "codepatrol-e2e-"));
  const originPath = mkdtempSync(join(tmpdir(), "codepatrol-e2e-remote-"));
  try {
    gitAt(originPath, ["init", "--bare", "-b", "main"]);
    repo.git(["remote", "add", "origin", originPath]);
    repo.git(["push", "-u", "origin", "main"]);

    const github = new FakeGitHub();
    const out: string[] = [];
    const err: string[] = [];
    const io = {
      out(text: string) {
        out.push(text);
      },
      err(text: string) {
        err.push(text);
      },
    };
    const run = async (argv: string[]) => {
      const code = await runCli(argv, { io, cwd: repo.path, githubFactory: () => github });
      assert.equal(code, 0, `expected exit 0 for: ${argv.join(" ")}; stderr: ${err.join("")}`);
      return out.splice(0).join("");
    };

    writeFileSync(
      join(files, "initiative.json"),
      JSON.stringify({
        schemaVersion: 1,
        type: "codepatrol-initiative-document",
        initiative: { id: "INIT-1", title: "E2E initiative", intent: "prove the stabilized lifecycle" },
        waves: [{ id: "WAVE-1.1", title: "Wave 1", intent: "deliver wave 1" }],
        works: [
          {
            id: "WORK-1.1.1",
            wave: "WAVE-1.1",
            title: "Blocker",
            description: "must land first",
            workType: "task",
            priority: "p1",
            delivery: "no-code",
            acceptance: ["blocker verified"],
            blockedBy: [],
          },
          {
            id: "WORK-1.1.2",
            wave: "WAVE-1.1",
            title: "Dependent",
            description: "blocked by the first",
            workType: "feature",
            priority: "p2",
            delivery: "no-code",
            acceptance: ["dependent verified"],
            blockedBy: ["WORK-1.1.1"],
          },
        ],
      }),
    );
    writeFileSync(
      join(files, "spec-result.json"),
      JSON.stringify({ decision: "apply", summary: "e2e spec", todo: [{ id: "t1", status: "done" }] }),
    );
    writeFileSync(join(files, "todo.json"), JSON.stringify({ todo: [{ id: "t1", title: "execute" }] }));
    const continueResult = { decision: "continue", summary: "progress", todo: [{ id: "t1", status: "done" }] };
    const verifyResult = { ...continueResult, acceptance: [{ index: 0, status: "passed", summary: "observed" }] };
    const acceptResult = {
      decision: "accept",
      summary: "accepted",
      authority: "e2e",
      todo: [{ id: "t1", status: "done" }],
    };
    writeFileSync(join(files, "continue.json"), JSON.stringify(continueResult));
    writeFileSync(join(files, "verify.json"), JSON.stringify(verifyResult));
    writeFileSync(join(files, "accept.json"), JSON.stringify(acceptResult));

    const baseCommit = repo.headCommit("refs/heads/main");
    const refsBefore = repo.refs();
    const worktreesBefore = repo.git(["worktree", "list", "--porcelain"]);

    const applied = JSON.parse(
      await run(["spec", "start", "--initiative", "INIT-1", "--todo", join(files, "todo.json")]),
    );
    const specRunId = applied.runId;
    await run([
      "spec",
      "complete",
      "--initiative",
      "INIT-1",
      "--run",
      specRunId,
      "--result",
      join(files, "spec-result.json"),
      "--file",
      join(files, "initiative.json"),
    ]);

    const stage = async (workId: string, name: string, resultFile: string) => {
      const started = JSON.parse(await run([name, "start", "--work", workId, "--todo", join(files, "todo.json")]));
      await run([
        name,
        "complete",
        "--work",
        workId,
        "--run",
        started.attempt.runId,
        "--result",
        join(files, resultFile),
      ]);
    };

    await stage("WORK-1.1.2", "plan", "continue.json");
    await stage("WORK-1.1.2", "review", "continue.json");

    const blocked = await runCli(["build", "start", "--work", "WORK-1.1.2", "--todo", join(files, "todo.json")], {
      io,
      cwd: repo.path,
      githubFactory: () => github,
    });
    assert.equal(blocked, 1, "dependent build is refused while the blocker is not accepted");
    out.splice(0);
    err.splice(0);
    const dependentNow = JSON.parse(await run(["work", "show", "WORK-1.1.2"]));
    assert.equal(dependentNow.work.workflow.state, "ready");
    assert.equal(dependentNow.work.workflow.stage, "build");

    await stage("WORK-1.1.1", "plan", "continue.json");
    await stage("WORK-1.1.1", "review", "continue.json");
    await stage("WORK-1.1.1", "build", "continue.json");
    await stage("WORK-1.1.1", "verify", "verify.json");
    await stage("WORK-1.1.1", "ship", "accept.json");

    await stage("WORK-1.1.2", "build", "continue.json");
    await stage("WORK-1.1.2", "verify", "verify.json");
    await stage("WORK-1.1.2", "ship", "accept.json");

    repo.git(["remote", "set-url", "origin", "https://github.com/test/repo.git"]);
    await run(["sync"]);
    repo.git(["remote", "set-url", "origin", originPath]);
    for (const issue of github.issues) {
      assert.equal(issue.state, "closed", `issue ${issue.number} closed`);
    }
    assert.equal(github.issues.length, 2);
    assert.equal(github.milestones.length, 1);
    assert.equal(github.milestones[0]?.state, "closed", "milestone closed");

    assert.equal(repo.headCommit("refs/heads/main"), baseCommit, "main never moved");
    assert.deepEqual(repo.headRefs(), ["refs/heads/main"], "no branch created");
    assert.equal(repo.git(["worktree", "list", "--porcelain"]), worktreesBefore, "no worktree created");
    const newRefs = repo.refs().filter((ref) => !refsBefore.includes(ref));
    assert.deepEqual(newRefs, ["refs/codepatrol/state"], "only the state ref changed");

    const pushed = JSON.parse(await run(["state", "push"]));
    assert.equal(pushed.relation, "equal");

    const clonePath = mkdtempSync(join(tmpdir(), "codepatrol-e2e-clone-"));
    rmSync(clonePath, { recursive: true, force: true });
    gitAt(".", ["clone", "--quiet", originPath, clonePath]);
    try {
      const cloneIo = { out: (t: string) => out.push(t), err: (t: string) => err.push(t) };
      const fetchCode = await runCli(["state", "fetch"], { io: cloneIo, cwd: clonePath, githubFactory: () => github });
      assert.equal(fetchCode, 0, err.join(""));
      const cloneStore = new StateStore(localGit(clonePath));
      const snapshot = await cloneStore.read();
      assert.equal(snapshot.works.get("WORK-1.1.1")?.completion?.outcome, "accepted");
      assert.equal(snapshot.works.get("WORK-1.1.2")?.completion?.outcome, "accepted");
      const localStore = new StateStore(localGit(repo.path));
      assert.equal(snapshot.commit, (await localStore.read()).commit, "clone reads the same terminal state");
    } finally {
      rmSync(clonePath, { recursive: true, force: true });
    }
  } finally {
    repo.cleanup();
    rmSync(files, { recursive: true, force: true });
    rmSync(originPath, { recursive: true, force: true });
  }
});
