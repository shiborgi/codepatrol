import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runCli } from "../cli/run-cli.js";
import { FakeGitHub } from "./support/github.js";
import { createRepo } from "./support/repo.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

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

function extractSpecDocumentFromSkillMd(): Record<string, unknown> {
  const raw = readFileSync(join(repoRoot, "skills", "codepatrol-spec", "SKILL.md"), "utf8");
  const match = raw.match(/```json\n([\s\S]*?)```/);
  assert.ok(match, "SKILL.md must contain a ```json block");
  const jsonBlock = match![1];
  assert.ok(typeof jsonBlock === "string", "json block must have content");
  const json = jsonBlock
    .split("\n")
    .map((line) => line.replace(/^ {3}/, ""))
    .join("\n");
  return JSON.parse(json);
}

function writeSpecFiles(filesDir: string, document: Record<string, unknown>) {
  const initiativePath = join(filesDir, "initiative.json");
  const todoPath = join(filesDir, "spec-todo.json");
  const specResultPath = join(filesDir, "spec-result.json");
  writeFileSync(initiativePath, JSON.stringify(document));
  writeFileSync(todoPath, JSON.stringify({ todo: [{ id: "s1", title: "test spec" }] }));
  writeFileSync(
    specResultPath,
    JSON.stringify({
      decision: "apply",
      summary: "test apply",
      todo: [{ id: "s1", status: "done", note: "test" }],
    }),
  );
  return { initiative: initiativePath, todo: todoPath, specResult: specResultPath };
}

test("spec contract document from SKILL.md passes spec start → spec complete apply", async () => {
  const document = extractSpecDocumentFromSkillMd();
  const repo = createRepo();
  const files = mkdtempSync(join(tmpdir(), "codepatrol-specdoc-"));
  try {
    const { sink, out, err } = io();
    const docs = writeSpecFiles(files, document);
    const run = (argv: string[]) => runCli(argv, { io: sink, cwd: repo.path, githubFactory: () => new FakeGitHub() });

    assert.equal(await run(["spec", "start", "--initiative", "INIT-1", "--todo", docs.todo]), 0);
    const started = JSON.parse(out());
    assert.equal(started.initiative, "INIT-1", "spec start must reference INIT-1");
    const specRunId = started.runId;
    assert.ok(typeof specRunId === "string" && specRunId.length > 0, "spec start must return a run id");

    const completeCode = await run([
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
    ]);
    const completeOut = out();
    assert.equal(completeCode, 0, `spec complete apply failed: stderr=${err()}`);
    const parsed = JSON.parse(completeOut);
    assert.ok(parsed.works.includes("WORK-1.1.1"), `expected WORK-1.1.1 in works, got ${JSON.stringify(parsed.works)}`);
    assert.equal(err(), "");
  } finally {
    repo.cleanup();
    rmSync(files, { recursive: true, force: true });
  }
});

test("spec contract document rejection: missing waves causes spec complete to fail", async () => {
  const document = extractSpecDocumentFromSkillMd();
  const bad = { ...document };
  delete (bad as Record<string, unknown>).waves;
  const repo = createRepo();
  const files = mkdtempSync(join(tmpdir(), "codepatrol-specdoc-"));
  try {
    const { sink, out, err } = io();
    const docs = writeSpecFiles(files, bad);
    const run = (argv: string[]) => runCli(argv, { io: sink, cwd: repo.path, githubFactory: () => new FakeGitHub() });

    await run(["spec", "start", "--initiative", "INIT-1", "--todo", docs.todo]);
    const started = JSON.parse(out());
    const specRunId = started.runId;

    const code = await run([
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
    ]);
    assert.notEqual(code, 0, "spec complete should reject a document without waves");
    const parsed = JSON.parse(err());
    assert.equal(parsed.error, "INVALID_INPUT");
    assert.ok(parsed.message.includes("waves"), `error message must mention waves, got: ${parsed.message}`);
  } finally {
    repo.cleanup();
    rmSync(files, { recursive: true, force: true });
  }
});

test("spec contract document rejection: bad work id format causes spec complete to fail", async () => {
  const document = extractSpecDocumentFromSkillMd();
  const bad = JSON.parse(JSON.stringify(document));
  bad.works[0].id = "INIT-1.1";
  const repo = createRepo();
  const files = mkdtempSync(join(tmpdir(), "codepatrol-specdoc-"));
  try {
    const { sink, out } = io();
    const docs = writeSpecFiles(files, bad);
    const run = (argv: string[]) => runCli(argv, { io: sink, cwd: repo.path, githubFactory: () => new FakeGitHub() });

    await run(["spec", "start", "--initiative", "INIT-1", "--todo", docs.todo]);
    const started = JSON.parse(out());
    const specRunId = started.runId;

    const code = await run([
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
    ]);
    assert.notEqual(code, 0, "spec complete should reject a document with bad work id");
  } finally {
    repo.cleanup();
    rmSync(files, { recursive: true, force: true });
  }
});
