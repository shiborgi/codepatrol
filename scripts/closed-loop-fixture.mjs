#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cli = process.env.CODEPATROL_BIN ?? join(process.cwd(), "bin/codepatrol.js");

function makeArtifacts(dir) {
  writeFileSync(join(dir, "todo.json"), JSON.stringify({ todo: [{ id: "t1", title: "f" }] }));
  writeFileSync(
    join(dir, "continue.json"),
    JSON.stringify({ decision: "continue", summary: "f", todo: [{ id: "t1", status: "done" }] }),
  );
  writeFileSync(
    join(dir, "return-plan.json"),
    JSON.stringify({ decision: "return", summary: "f", todo: [{ id: "t1", status: "done" }], returnTo: "plan" }),
  );
  writeFileSync(
    join(dir, "spec-apply.json"),
    JSON.stringify({ decision: "apply", summary: "f", todo: [{ id: "t1", status: "done" }] }),
  );
}

function git(repo, args) {
  return execFileSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      GIT_AUTHOR_NAME: "f",
      GIT_AUTHOR_EMAIL: "f@l",
      GIT_COMMITTER_NAME: "f",
      GIT_COMMITTER_EMAIL: "f@l",
    },
  }).trim();
}

function run(repo, args) {
  return execFileSync(process.execPath, [cli, "--workspace", repo, ...args], { encoding: "utf8" });
}

function stage(repo, files, workId, stageName, resultFile) {
  const s = JSON.parse(run(repo, [stageName, "start", "--work", workId, "--todo", join(files, "todo.json")]));
  JSON.parse(
    run(repo, [stageName, "complete", "--work", workId, "--run", s.attempt.runId, "--result", join(files, resultFile)]),
  );
}

try {
  const artifacts = mkdtempSync(join(tmpdir(), "codepatrol-artifacts-"));
  makeArtifacts(artifacts);

  const signalRepo = mkdtempSync(join(tmpdir(), "codepatrol-cl-signal-"));
  git(signalRepo, ["init", "-b", "main"]);
  git(signalRepo, ["commit", "--allow-empty", "-m", "i"]);

  writeFileSync(
    join(artifacts, "initiative-signal.json"),
    JSON.stringify({
      schemaVersion: 1,
      type: "codepatrol-initiative-document",
      initiative: { id: "INIT-1", title: "Signal", intent: "fixture" },
      waves: [{ id: "WAVE-1.1", title: "Wave 1", intent: "deliver wave 1" }],
      works: [
        {
          id: "WORK-1.1.1",
          wave: "WAVE-1.1",
          title: "Signal work",
          description: "returns to plan",
          workType: "task",
          priority: "p2",
          delivery: "no-code",
          acceptance: [],
          blockedBy: [],
        },
      ],
    }),
  );

  const spec = JSON.parse(
    run(signalRepo, ["spec", "start", "--initiative", "INIT-1", "--todo", join(artifacts, "todo.json")]),
  );
  run(signalRepo, [
    "spec",
    "validate",
    "--initiative",
    "INIT-1",
    "--run",
    spec.runId,
    "--file",
    join(artifacts, "initiative-signal.json"),
  ]);
  run(signalRepo, [
    "spec",
    "complete",
    "--initiative",
    "INIT-1",
    "--run",
    spec.runId,
    "--result",
    join(artifacts, "spec-apply.json"),
    "--file",
    join(artifacts, "initiative-signal.json"),
  ]);

  stage(signalRepo, artifacts, "WORK-1.1.1", "plan", "continue.json");
  stage(signalRepo, artifacts, "WORK-1.1.1", "review", "return-plan.json");
  stage(signalRepo, artifacts, "WORK-1.1.1", "plan", "continue.json");
  stage(signalRepo, artifacts, "WORK-1.1.1", "review", "continue.json");

  const signalReport = JSON.parse(run(signalRepo, ["improve", "inspect", "--format", "json"]));
  assert.equal(signalReport.works.scoped, 1);
  assert.equal(signalReport.returns.reviewToPlan, 1, "signal: reviewToPlan === 1");
  assert.equal(signalReport.returns.buildToPlan, 0);
  assert.equal(signalReport.returns.verifyToBuild, 0);
  assert.equal(signalReport.returns.verifyToPlan, 0);
  const planRepeats = signalReport.repeatedAttempts.filter((e) => e.work === "WORK-1.1.1" && e.stage === "plan");
  assert.equal(planRepeats.length, 1);
  assert.equal(planRepeats[0].attempts, 2);
  rmSync(signalRepo, { recursive: true, force: true });

  const noSignalRepo = mkdtempSync(join(tmpdir(), "codepatrol-cl-nosignal-"));
  git(noSignalRepo, ["init", "-b", "main"]);
  git(noSignalRepo, ["commit", "--allow-empty", "-m", "i"]);

  writeFileSync(
    join(artifacts, "initiative-nosignal.json"),
    JSON.stringify({
      schemaVersion: 1,
      type: "codepatrol-initiative-document",
      initiative: { id: "INIT-1", title: "No-signal", intent: "fixture" },
      waves: [{ id: "WAVE-1.1", title: "Wave 1", intent: "deliver wave 1" }],
      works: [
        {
          id: "WORK-1.1.1",
          wave: "WAVE-1.1",
          title: "No-signal work",
          description: "clean",
          workType: "task",
          priority: "p2",
          delivery: "no-code",
          acceptance: [],
          blockedBy: [],
        },
      ],
    }),
  );

  const nsSpec = JSON.parse(
    run(noSignalRepo, ["spec", "start", "--initiative", "INIT-1", "--todo", join(artifacts, "todo.json")]),
  );
  run(noSignalRepo, [
    "spec",
    "validate",
    "--initiative",
    "INIT-1",
    "--run",
    nsSpec.runId,
    "--file",
    join(artifacts, "initiative-nosignal.json"),
  ]);
  run(noSignalRepo, [
    "spec",
    "complete",
    "--initiative",
    "INIT-1",
    "--run",
    nsSpec.runId,
    "--result",
    join(artifacts, "spec-apply.json"),
    "--file",
    join(artifacts, "initiative-nosignal.json"),
  ]);

  stage(noSignalRepo, artifacts, "WORK-1.1.1", "plan", "continue.json");
  stage(noSignalRepo, artifacts, "WORK-1.1.1", "review", "continue.json");

  const noSignalReport = JSON.parse(run(noSignalRepo, ["improve", "inspect", "--format", "json"]));
  assert.equal(noSignalReport.works.scoped, 1);
  assert.equal(noSignalReport.returns.reviewToPlan, 0, "no-signal: reviewToPlan === 0");
  assert.equal(noSignalReport.repeatedAttempts.length, 0, "no-signal: repeatedAttempts empty");
  rmSync(noSignalRepo, { recursive: true, force: true });
  rmSync(artifacts, { recursive: true, force: true });

  console.log("closed-loop: OK");
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
