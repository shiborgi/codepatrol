import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { runCli } from "../src/cli.js";
import { loadConfig } from "../src/config.js";
import { git } from "./helpers.js";

function repository(remote?: string): string {
  const root = mkdtempSync(resolve(tmpdir(), "codepatrol-setup-"));
  git(root, ["init", "-b", "feature"]);
  writeFileSync(resolve(root, "README.md"), "setup\n");
  git(root, ["add", "."]);
  git(root, [
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-m",
    "initial",
  ]);
  if (remote) git(root, ["remote", "add", "origin", remote]);
  return root;
}

function setup(root: string, ...flags: string[]) {
  return runCli(["node", "codepatrol", "--workspace", root, "setup", ...flags]);
}

test("setup works before config and normalizes HTTPS defaults", async () => {
  const root = repository("https://github.com/acme/project.git");
  const result = await setup(root, "--verification-argv", '["npm","run","check"]');
  assert.equal(result.exitCode, 0, result.stderr);
  const config = JSON.parse(result.stdout) as Record<string, unknown>;
  assert.equal(config.baseBranch, "feature");
  assert.deepEqual((config.verification as { argv: string[] }).argv, [
    "npm",
    "run",
    "check",
  ]);
  assert.equal(
    (config.remote as { github: { repo: string } }).github.repo,
    "acme/project",
  );
  assert.deepEqual(loadConfig(root), config);
});

test("setup parses SSH, flags, and keeps remote mutation-free", async () => {
  const root = repository("git@github.com:acme/project.git");
  const before = git(root, ["remote", "get-url", "origin"]);
  const result = await setup(
    root,
    '--verification-argv=["npm","test"]',
    "--base-branch",
    "main",
    "--comments",
    "false",
    "--push-main=false",
    "--token-env",
    "CI_GITHUB_TOKEN",
  );
  assert.equal(result.exitCode, 0, result.stderr);
  const github = (
    JSON.parse(result.stdout) as { remote: { github: Record<string, unknown> } }
  ).remote.github;
  assert.equal(github.repo, "acme/project");
  assert.equal(github.comments, false);
  assert.equal(github.pushMain, false);
  assert.equal(git(root, ["remote", "get-url", "origin"]), before);
});

test("setup requires override for unsupported and missing remotes", async () => {
  const unsupported = repository("https://example.com/acme/project.git");
  const rejected = await setup(unsupported, "--verification-argv", '["true"]');
  assert.equal(rejected.exitCode, 1);
  assert.match(JSON.parse(rejected.stderr).error, /REMOTE_REPO_UNKNOWN/);
  const overridden = await setup(
    unsupported,
    "--verification-argv",
    '["true"]',
    "--github-repo",
    "acme/override",
  );
  assert.equal(overridden.exitCode, 0, overridden.stderr);
  const missing = repository();
  const missingResult = await setup(missing, "--verification-argv", '["true"]');
  assert.equal(missingResult.exitCode, 1);
  assert.equal(JSON.parse(missingResult.stderr).error, "REMOTE_REPO_UNKNOWN");
});

test("setup rejects collisions and dry-run does not write", async () => {
  const root = repository("git@github.com:acme/project.git");
  const dry = await setup(root, "--verification-argv", '["true"]', "--dry-run");
  assert.equal(dry.exitCode, 0, dry.stderr);
  assert.equal(existsSync(resolve(root, "codepatrol.json")), false);
  const collision = await setup(root, "--verification-argv", '["true"]');
  assert.equal(collision.exitCode, 0, collision.stderr);
  const second = await setup(root, "--verification-argv", '["true"]');
  assert.equal(second.exitCode, 2);
  assert.equal(JSON.parse(second.stderr).error, "CONFIG_INVALID");
});

test("setup update preserves unrelated configuration and rejects token values", async () => {
  const root = repository("git@github.com:acme/project.git");
  const first = await setup(root, "--verification-argv", '["true"]');
  assert.equal(first.exitCode, 0, first.stderr);
  const original = JSON.parse(
    readFileSync(resolve(root, "codepatrol.json"), "utf8"),
  ) as Record<string, unknown>;
  original.maxReviewReturns = 9;
  original.agentCatalog = {
    argv: ["agent", "resolve"],
    defaults: {},
  };
  writeFileSync(resolve(root, "codepatrol.json"), JSON.stringify(original));
  const updated = await setup(
    root,
    "--update",
    "--verification-argv",
    '["npm","run","verify"]',
  );
  assert.equal(updated.exitCode, 0, updated.stderr);
  const config = JSON.parse(
    readFileSync(resolve(root, "codepatrol.json"), "utf8"),
  ) as Record<string, unknown>;
  assert.equal(config.maxReviewReturns, 9);
  assert.deepEqual(config.agentCatalog, {
    ...(original.agentCatalog as object),
    timeoutMs: 10_000,
  });
  assert.equal(JSON.stringify(config).includes("ghp_"), false);
  const secret = await setup(
    root,
    "--update",
    "--verification-argv",
    '["true"]',
    "--token-env",
    "ghp_not-an-environment-name",
  );
  assert.equal(secret.exitCode, 2);
  assert.equal(JSON.parse(secret.stderr).error, "USAGE");
});
