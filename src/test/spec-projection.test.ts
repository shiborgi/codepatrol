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
      out(text: string) {
        stdout += text;
      },
      err(text: string) {
        stderr += text;
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
        {
          id: "WORK-1.1.2",
          wave: "WAVE-1.1",
          title: "Second",
          description: "two",
          workType: "task",
          priority: "p2",
          delivery: "no-code",
          acceptance: ["ok"],
          blockedBy: [],
        },
      ],
    }),
  );
  return { specStart, specResult, initiative };
}

test("spec complete apply triggers automatic GitHub projection via runCli", async () => {
  const repo = createRepo();
  const files = mkdtempSync(join(tmpdir(), "codepatrol-spec-proj-"));
  try {
    repo.git(["remote", "add", "origin", "https://github.com/test/repo.git"]);
    const github = new FakeGitHub();
    const { sink, out } = io();
    const docs = writeDocs(files);
    const run = (argv: string[]) => runCli(argv, { io: sink, cwd: repo.path, githubFactory: () => github });

    await run(["spec", "start", "--initiative", "INIT-1", "--todo", docs.specStart]);
    const started = JSON.parse(out());
    assert.equal(started.initiative, "INIT-1");

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
    const specOut = JSON.parse(out());
    assert.equal(specOut.definitionState, "defined");

    // Projection: one milestone, two issues, labels
    assert.equal(github.milestones.length, 1, "one milestone");
    assert.equal(github.milestones[0]?.title, "WAVE-1.1: Wave 1", "the milestone represents the Wave");
    assert.ok(
      github.milestones[0]?.body.includes("<!-- codepatrol:wave:WAVE-1.1 -->"),
      "milestone carries the wave marker",
    );
    assert.ok(
      github.wikiPages.get("INIT-1")?.includes("<!-- codepatrol:initiative:INIT-1 -->"),
      "the Initiative is projected to its wiki page",
    );

    assert.equal(github.issues.length, 2, "two issues");
    assert.equal(github.issues[0]?.title, "WORK-1.1.1: First");
    assert.equal(github.issues[1]?.title, "WORK-1.1.2: Second");
    assert.equal(github.issues[0]?.milestone, 1);
    assert.equal(github.issues[1]?.milestone, 1);
    assert.ok(github.issues[0]?.body.includes("<!-- codepatrol:work:WORK-1.1.1 -->"), "issue 1 marker");
    assert.ok(github.issues[1]?.body.includes("<!-- codepatrol:work:WORK-1.1.2 -->"), "issue 2 marker");

    assert.ok(github.labels.has("codepatrol:type/feature"));
    assert.ok(github.labels.has("codepatrol:type/task"));
    assert.ok(github.labels.has("codepatrol:priority/p1"));
    assert.ok(github.labels.has("codepatrol:priority/p2"));
  } finally {
    repo.cleanup();
    rmSync(files, { recursive: true, force: true });
  }
});
