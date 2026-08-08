import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { GhGitHub } from "../adapters/gh.js";
import { localGit } from "../adapters/git.js";
import { CodepatrolError } from "../core/errors.js";

function fakeCommand(body: string, code: number): string {
  const dir = mkdtempSync(join(tmpdir(), "codepatrol-fake-"));
  const path = join(dir, "fake-cmd.sh");
  writeFileSync(path, `#!/bin/sh\nprintf '%s' '${body}'\nexit ${code}\n`);
  chmodSync(path, 0o755);
  return path;
}

test("a non-zero git process result rejects with CodepatrolError", async () => {
  const git = localGit(process.cwd());
  await assert.rejects(
    git.exec(["rev-parse", "--verify", "refs/does/not/exist"]),
    (error: unknown) => error instanceof CodepatrolError,
  );
});

test("a non-zero gh result rejects with CodepatrolError", async () => {
  const script = fakeCommand("", 3);
  const gh = new GhGitHub("owner/repo", script);
  await assert.rejects(
    gh.listIssues(),
    (error: unknown) => error instanceof CodepatrolError && error.code === "GITHUB",
  );
  rmSync(join(script, ".."), { recursive: true, force: true });
});

test("invalid JSON from gh api rejects instead of crashing", async () => {
  const script = fakeCommand("not json at all", 0);
  const gh = new GhGitHub("owner/repo", script);
  await assert.rejects(
    gh.listIssues(),
    (error: unknown) =>
      error instanceof CodepatrolError && error.code === "GITHUB" && error.message.includes("invalid JSON"),
  );
  rmSync(join(script, ".."), { recursive: true, force: true });
});

test("a missing gh binary rejects with CodepatrolError", async () => {
  const gh = new GhGitHub("owner/repo", "/nonexistent/gh-binary");
  await assert.rejects(
    gh.listIssues(),
    (error: unknown) => error instanceof CodepatrolError && error.code === "GITHUB",
  );
});

test("gh list endpoints paginate beyond one page", async () => {
  const dir = mkdtempSync(join(tmpdir(), "codepatrol-fake-"));
  const script = join(dir, "fake-gh.sh");
  writeFileSync(
    script,
    `#!/bin/sh
args="$*"
case "$args" in
  *"&page=1"*) printf '[%s]' "$(seq 1 100 | sed 's/.*/{"number":0,"title":"t","body":null,"state":"open","labels":[],"milestone":null}/' | paste -sd, -)" ;;
  *"&page=2"*) printf '[{"number":101,"title":"t","body":null,"state":"open","labels":[],"milestone":null}]' ;;
  *) printf '[]' ;;
esac
exit 0
`,
  );
  chmodSync(script, 0o755);
  const gh = new GhGitHub("owner/repo", script);
  const issues = await gh.listIssues();
  assert.equal(issues.length, 101);
  rmSync(dir, { recursive: true, force: true });
});
