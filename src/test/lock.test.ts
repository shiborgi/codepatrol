import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { localGit } from "../adapters/git.js";
import { acquireLock } from "../adapters/lock.js";
import { runCli } from "../cli/run-cli.js";
import { createApp, documentOf } from "./support/app.js";
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

test("a second mutating command is refused by the lock; read-only commands work", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    const { runId } = await app.specStart("INIT-1");
    await app.specComplete("INIT-1", runId, "apply", documentOf());
    const release = await acquireLock(localGit(repo.path), repo.path, "test hold");

    const { sink, err } = io();
    const blocked = await runCli(["plan", "start", "--work", "WORK-1.1.1", "--todo", "/dev/null"], {
      io: sink,
      cwd: repo.path,
    });
    assert.equal(blocked, 1);
    assert.equal(JSON.parse(err()).error, "CONFLICT");

    const readOnly = await runCli(["work", "list"], { io: sink, cwd: repo.path });
    assert.equal(readOnly, 0, "read-only command works under a foreign lock");

    await release();
    const after = io();
    const files = mkdtempSync(join(tmpdir(), "codepatrol-lock-"));
    writeFileSync(join(files, "todo.json"), JSON.stringify({ todo: [{ id: "t1", title: "x" }] }));
    const allowed = await runCli(["plan", "start", "--work", "WORK-1.1.1", "--todo", join(files, "todo.json")], {
      io: after.sink,
      cwd: repo.path,
    });
    assert.equal(allowed, 0, "lock released after the holder finishes");
    rmSync(files, { recursive: true, force: true });
  } finally {
    repo.cleanup();
  }
});

test("the lock is released after a failing command and stale locks are recovered", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    const { runId } = await app.specStart("INIT-1");
    await app.specComplete("INIT-1", runId, "apply", documentOf());
    const { sink } = io();
    const failed = await runCli(["plan", "start", "--work", "WORK-9.1.9", "--todo", "/dev/null"], {
      io: sink,
      cwd: repo.path,
    });
    assert.ok(failed !== 0, "failing command exits non-zero but releases lock");
    const release = await acquireLock(localGit(repo.path), repo.path, "check");
    await release();

    const commonDir = repo.git(["rev-parse", "--git-common-dir"]);
    const lockDir = join(repo.path, commonDir, "codepatrol.lock");
    const { mkdirSync, writeFileSync: write } = await import("node:fs");
    mkdirSync(lockDir);
    write(
      join(lockDir, "info.json"),
      JSON.stringify({ pid: 2 ** 22, command: "dead", hostname: "x", acquiredAt: "y" }),
    );
    const recovered = await acquireLock(localGit(repo.path), repo.path, "recovery");
    await recovered();
  } finally {
    repo.cleanup();
  }
});
