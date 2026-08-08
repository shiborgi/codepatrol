import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runCli } from "../cli/run-cli.js";
import { FakeGitHub } from "./support/github.js";
import { createRepo } from "./support/repo.js";

function io() {
  let stdout = "";
  let stderr = "";
  return {
    sink: {
      out(t: string) {
        stdout += t;
      },
      err(t: string) {
        stderr += t;
      },
    },
    out: () => {
      const t = stdout;
      stdout = "";
      return t;
    },
    err: () => {
      const t = stderr;
      stderr = "";
      return t;
    },
  };
}

function writeDocs(dir: string) {
  const specStart = join(dir, "spec-todo.json");
  writeFileSync(specStart, JSON.stringify({ todo: [{ id: "t1", title: "do" }] }));
  const specResult = join(dir, "spec-result.json");
  writeFileSync(
    specResult,
    JSON.stringify({ decision: "apply", summary: "apply", todo: [{ id: "t1", status: "done" }] }),
  );
  const initiative = join(dir, "initiative.json");
  writeFileSync(
    initiative,
    JSON.stringify({
      schemaVersion: 1,
      type: "codepatrol-initiative-document",
      initiative: { id: "INIT-1", title: "Test", intent: "test" },
      waves: [{ id: "WAVE-1.1", title: "Wave 1", intent: "deliver wave 1" }],
      works: [
        {
          id: "WORK-1.1.1",
          wave: "WAVE-1.1",
          title: "First",
          description: "one",
          workType: "feature",
          priority: "p1",
          delivery: "code",
          acceptance: ["ok"],
          blockedBy: [],
        },
      ],
    }),
  );
  return { specStart, specResult, initiative };
}

test("GitHub projection failure during Spec Apply preserves local state and later sync reconciles", async () => {
  const repo = createRepo();
  const files = mkdtempSync(join(tmpdir(), "codepatrol-fail-"));
  try {
    repo.git(["remote", "add", "origin", "https://github.com/test/repo.git"]);
    const github = new FakeGitHub();
    github.failNext();
    const { sink, out, err } = io();
    const docs = writeDocs(files);
    const run = (argv: string[]) => runCli(argv, { io: sink, cwd: repo.path, githubFactory: () => github });

    await run(["spec", "start", "--initiative", "INIT-1", "--todo", docs.specStart]);
    const started = JSON.parse(out());
    const code = await run([
      "spec",
      "complete",
      "--initiative",
      "INIT-1",
      "--run",
      started.runId,
      "--result",
      docs.specResult,
      "--file",
      docs.initiative,
    ]);

    // CLI exits successfully
    assert.equal(code, 0, "spec complete succeeds despite projection failure");

    // Local spec remains defined
    const specOut = JSON.parse(out());
    assert.equal(specOut.definitionState, "defined");
    assert.deepEqual(specOut.works, ["WORK-1.1.1"]);

    // stderr has structured warning
    const stderr = err();
    assert.ok(stderr.includes("github projection failed"), "projection warning on stderr");
    assert.ok(stderr.includes("codepatrol sync"), "refers to sync for reconciliation");

    // No GitHub objects were created (failure prevented it)
    assert.equal(github.milestones.length, 0, "no milestone created");
    assert.equal(github.issues.length, 0, "no issues created");

    // Later sync reconciles
    github.clearFailure();
    await run(["sync"]);
    const syncStderr = err();
    assert.equal(syncStderr, "", "no error on sync");

    assert.equal(github.milestones.length, 1, "milestone created on reconciliation");
    assert.equal(github.issues.length, 1, "issue created on reconciliation");
    assert.equal(github.issues[0]?.title, "WORK-1.1.1: First");
    assert.equal(github.issues[0]?.milestone, 1);
  } finally {
    repo.cleanup();
    rmSync(files, { recursive: true, force: true });
  }
});
