import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { Config } from "../src/config.js";
import { Repository } from "../src/git.js";
import { CodePatrolService } from "../src/service.js";

export function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

export function fixture(
  agentCatalog?: Config["agentCatalog"],
  sharedPaths?: string[],
): {
  root: string;
  home: string;
  repo: Repository;
  service: CodePatrolService;
  config: Config;
} {
  const root = mkdtempSync(resolve(tmpdir(), "codepatrol-test-repo-"));
  const home = mkdtempSync(resolve(tmpdir(), "codepatrol-test-home-"));
  git(root, ["init", "-b", "main"]);
  writeFileSync(resolve(root, "README.md"), "fixture\n");
  writeFileSync(
    resolve(root, "codepatrol.json"),
    JSON.stringify({
      schemaVersion: 1,
      baseBranch: "main",
      verification: {
        argv: [process.execPath, "-e", "process.exit(0)"],
        timeoutMs: 10_000,
        ...(sharedPaths ? { sharedPaths } : {}),
      },
      maxReviewReturns: 3,
      ...(agentCatalog ? { agentCatalog } : {}),
    }),
  );
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
  process.env.CODEPATROL_HOME = home;
  const config: Config = {
    schemaVersion: 1,
    baseBranch: "main",
    verification: {
      argv: [process.execPath, "-e", "process.exit(0)"],
      timeoutMs: 10_000,
      ...(sharedPaths ? { sharedPaths } : {}),
    },
    maxReviewReturns: 3,
    ...(agentCatalog ? { agentCatalog } : {}),
  };
  const repo = new Repository(root);
  return { root, home, repo, service: new CodePatrolService(repo, config), config };
}

export function commitCandidate(workspace: string, content: string): void {
  writeFileSync(resolve(workspace, "result.txt"), `${content}\n`);
  git(workspace, ["add", "result.txt"]);
  git(workspace, [
    "-c",
    "user.name=Builder",
    "-c",
    "user.email=builder@example.com",
    "commit",
    "-m",
    `candidate ${content}`,
  ]);
}
