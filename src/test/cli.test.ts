import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runCli } from "../cli/run-cli.js";
import { FakeGitHub } from "./support/github.js";
import { createRepo } from "./support/repo.js";

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

function writeDocs(files: string): {
  initiative: string;
  todo: string;
  result: string;
  specStart: string;
  specResult: string;
} {
  const initiative = join(files, "initiative.json");
  const todo = join(files, "todo.json");
  const result = join(files, "result.json");
  const specResult = join(files, "spec-result.json");
  writeFileSync(
    initiative,
    JSON.stringify({
      schemaVersion: 1,
      type: "codepatrol-initiative-document",
      initiative: { id: "INIT-1", title: "CLI initiative", intent: "exercise the cli" },
      waves: [{ id: "WAVE-1.1", title: "Wave 1", intent: "deliver wave 1" }],
      works: [
        {
          id: "WORK-1.1.1",
          wave: "WAVE-1.1",
          title: "CLI work",
          description: "via files",
          workType: "task",
          priority: "p2",
          delivery: "no-code",
          acceptance: ["json out"],
          blockedBy: [],
        },
      ],
    }),
  );
  writeFileSync(todo, JSON.stringify({ todo: [{ id: "t1", title: "do it" }] }));
  writeFileSync(result, JSON.stringify({ decision: "continue", summary: "ok", todo: [{ id: "t1", status: "done" }] }));
  writeFileSync(
    specResult,
    JSON.stringify({ decision: "apply", summary: "cli apply", todo: [{ id: "t1", status: "done" }] }),
  );
  return { initiative, todo, result, specStart: todo, specResult };
}

test("importing the package root has no side effects", () => {
  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `await import(${JSON.stringify(join(process.cwd(), "dist/index.js"))}); console.log("OK")`,
    ],
    { encoding: "utf8" },
  );
  assert.equal(output.trim(), "OK");
});

test("cli drives the lifecycle over json files with run-bound completion", async () => {
  const repo = createRepo();
  const files = mkdtempSync(join(tmpdir(), "codepatrol-cli-"));
  try {
    const { sink, out, err } = io();
    const docs = writeDocs(files);
    const run = (argv: string[]) => runCli(argv, { io: sink, cwd: repo.path, githubFactory: () => new FakeGitHub() });

    assert.equal(await run(["spec", "start", "--initiative", "INIT-1", "--todo", docs.specStart]), 0);
    const started = JSON.parse(out());
    const specRunId = started.runId;
    assert.equal(started.initiative, "INIT-1");

    assert.equal(
      await run([
        "spec",
        "complete",
        "--initiative",
        "INIT-1",
        "--run",
        specRunId,
        "--result",
        docs.specResult,
        "--file",
        docs.initiative,
      ]),
      0,
    );
    assert.deepEqual(JSON.parse(out()).works, ["WORK-1.1.1"]);

    assert.equal(await run(["plan", "start", "--work", "WORK-1.1.1", "--todo", docs.todo]), 0);
    const workStarted = JSON.parse(out());
    const runId = workStarted.attempt.runId;
    assert.ok(typeof runId === "string");

    assert.equal(
      await run(["plan", "complete", "--work", "WORK-1.1.1", "--result", docs.result]),
      2,
      "completion requires --run",
    );
    out();
    err();

    assert.equal(await run(["plan", "complete", "--work", "WORK-1.1.1", "--run", runId, "--result", docs.result]), 0);
    out();

    assert.equal(await run(["work", "show", "WORK-1.1.1"]), 0);
    assert.equal(JSON.parse(out()).work.workflow.stage, "review");

    assert.equal(await run(["initiative", "list"]), 0);
    assert.equal(JSON.parse(out()).initiatives.length, 1);

    assert.equal(err(), "");
  } finally {
    repo.cleanup();
    rmSync(files, { recursive: true, force: true });
  }
});

test("cli reports domain errors as json with exit code 1", async () => {
  const repo = createRepo();
  try {
    const { sink, err } = io();
    const code = await runCli(["work", "show", "WORK-9.1.9"], { io: sink, cwd: repo.path });
    assert.equal(code, 1);
    assert.equal(JSON.parse(err()).error, "NOT_FOUND");
  } finally {
    repo.cleanup();
  }
});

test("github failure during a stage transition is a warning with exit code zero", async () => {
  const repo = createRepo();
  const files = mkdtempSync(join(tmpdir(), "codepatrol-cli-"));
  try {
    repo.git(["remote", "add", "origin", "https://github.com/test/repo.git"]);
    const github = new FakeGitHub();
    const { sink, out, err } = io();
    const docs = writeDocs(files);
    const run = (argv: string[]) => runCli(argv, { io: sink, cwd: repo.path, githubFactory: () => github });

    await run(["spec", "start", "--initiative", "INIT-1", "--todo", docs.specStart]);
    const started = JSON.parse(out());
    await run([
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
    out();
    github.failNext();
    const code = await run(["plan", "start", "--work", "WORK-1.1.1", "--todo", docs.todo]);
    assert.equal(code, 0, "transition succeeds despite projection failure");
    assert.ok(err().includes("github projection failed"));
    out();

    const show = await run(["work", "show", "WORK-1.1.1"]);
    assert.equal(show, 0);
    assert.equal(JSON.parse(out()).work.workflow.state, "active", "local transition recorded");
  } finally {
    repo.cleanup();
    rmSync(files, { recursive: true, force: true });
  }
});

test("explicit sync with a failing github returns a controlled non-zero exit", async () => {
  const repo = createRepo();
  const files = mkdtempSync(join(tmpdir(), "codepatrol-cli-"));
  try {
    repo.git(["remote", "add", "origin", "https://github.com/test/repo.git"]);
    const github = new FakeGitHub();
    const { sink, out, err } = io();
    const docs = writeDocs(files);
    const run = (argv: string[]) => runCli(argv, { io: sink, cwd: repo.path, githubFactory: () => github });

    await run(["spec", "start", "--initiative", "INIT-1", "--todo", docs.specStart]);
    const started = JSON.parse(out());
    await run([
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
    out();
    github.failAfter(0);
    const code = await run(["sync"]);
    assert.equal(code, 1, "controlled failure, not a crash");
    const parsed = JSON.parse(err());
    assert.equal(parsed.error, "INTERNAL", "fake failure surfaces as a controlled error");
    assert.ok(parsed.message.includes("injected GitHub failure"));
  } finally {
    repo.cleanup();
    rmSync(files, { recursive: true, force: true });
  }
});
