#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repo = mkdtempSync(join(tmpdir(), "codepatrol-smoke-"));
const files = mkdtempSync(join(tmpdir(), "codepatrol-smoke-files-"));
const cli = process.env.CODEPATROL_BIN ?? join(process.cwd(), "bin/codepatrol.js");

const git = (args) =>
  execFileSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      GIT_AUTHOR_NAME: "smoke",
      GIT_AUTHOR_EMAIL: "smoke@localhost",
      GIT_COMMITTER_NAME: "smoke",
      GIT_COMMITTER_EMAIL: "smoke@localhost",
    },
  }).trim();

const run = (args) => execFileSync(process.execPath, [cli, "--workspace", repo, ...args], { encoding: "utf8" });

try {
  git(["init", "-b", "main"]);
  git(["commit", "--allow-empty", "-m", "initial"]);
  const base = git(["rev-parse", "refs/heads/main"]);

  writeFileSync(join(files, "todo.json"), JSON.stringify({ todo: [{ id: "t1", title: "smoke" }] }));
  writeFileSync(
    join(files, "spec-result-apply.json"),
    JSON.stringify({ decision: "apply", summary: "smoke apply", todo: [{ id: "t1", status: "done" }] }),
  );
  writeFileSync(
    join(files, "spec-result-discard.json"),
    JSON.stringify({ decision: "discard", summary: "smoke discard", todo: [{ id: "t1", status: "done" }] }),
  );
  writeFileSync(
    join(files, "initiative.json"),
    JSON.stringify({
      schemaVersion: 1,
      type: "codepatrol-initiative-document",
      initiative: { id: "INIT-1", title: "Smoke initiative", intent: "prove the smoke path" },
      waves: [{ id: "WAVE-1.1", title: "Wave 1", intent: "deliver wave 1" }],
      works: [
        {
          id: "WORK-1.1.1",
          wave: "WAVE-1.1",
          title: "Smoke work",
          description: "end to end",
          workType: "task",
          priority: "p2",
          delivery: "no-code",
          acceptance: ["exits zero"],
          blockedBy: [],
        },
      ],
    }),
  );

  const result = (decision, extra = {}) =>
    JSON.stringify({ decision, summary: `smoke ${decision}`, todo: [{ id: "t1", status: "done" }], ...extra });
  writeFileSync(join(files, "continue.json"), result("continue"));
  writeFileSync(
    join(files, "verify.json"),
    result("continue", { acceptance: [{ index: 0, status: "passed", summary: "smoke observed" }] }),
  );
  writeFileSync(join(files, "accept.json"), result("accept", { authority: "smoke" }));

  const started = JSON.parse(run(["spec", "start", "--initiative", "INIT-1", "--todo", join(files, "todo.json")]));
  assert.equal(started.initiative, "INIT-1");
  assert.equal(started.method, "spec");
  assert.ok(typeof started.runId === "string" && started.runId.length > 0);

  const specRunId = started.runId;

  const validated = JSON.parse(
    run(["spec", "validate", "--initiative", "INIT-1", "--run", specRunId, "--file", join(files, "initiative.json")]),
  );
  assert.equal(validated.valid, true);

  const applied = JSON.parse(
    run([
      "spec",
      "complete",
      "--initiative",
      "INIT-1",
      "--run",
      specRunId,
      "--result",
      join(files, "spec-result-apply.json"),
      "--file",
      join(files, "initiative.json"),
    ]),
  );
  assert.equal(applied.definitionState, "defined");
  assert.equal(applied.revision, 1);

  const stage = (name, resultFile) => {
    const s = JSON.parse(run([name, "start", "--work", "WORK-1.1.1", "--todo", join(files, "todo.json")]));
    JSON.parse(
      run([name, "complete", "--work", "WORK-1.1.1", "--run", s.attempt.runId, "--result", join(files, resultFile)]),
    );
  };
  stage("plan", "continue.json");
  stage("review", "continue.json");
  stage("build", "continue.json");
  stage("verify", "verify.json");
  stage("ship", "accept.json");

  const shown = JSON.parse(run(["work", "show", "WORK-1.1.1"]));
  assert.equal(shown.work.workflow.state, "terminal");
  assert.equal(shown.work.completion.outcome, "accepted");
  assert.equal(shown.work.specRevision, 1);

  assert.equal(git(["rev-parse", "refs/heads/main"]), base, "main must not move");
  const heads = git(["for-each-ref", "--format=%(refname)", "refs/heads"]).split("\n").filter(Boolean);
  assert.deepEqual(heads, ["refs/heads/main"], "no branches created");
  const refs = git(["for-each-ref", "--format=%(refname)"]).split("\n").filter(Boolean);
  assert.ok(refs.includes("refs/codepatrol/state"), "state ref exists");

  const history = JSON.parse(run(["spec", "history", "--initiative", "INIT-1"]));
  assert.equal(history.executions.length, 1);
  assert.equal(history.executions[0].status, "completed");
  assert.equal(history.revisions.length, 1);

  console.log("smoke: OK");
} finally {
  rmSync(repo, { recursive: true, force: true });
  rmSync(files, { recursive: true, force: true });
}
