import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TestRepo {
  path: string;
  cleanup(): void;
  git(args: string[]): string;
  gitWithInput(args: string[], input?: string, env?: Record<string, string>): string;
  refs(): string[];
  headRefs(): string[];
  headCommit(ref: string): string;
}

export function createRepo(): TestRepo {
  const path = mkdtempSync(join(tmpdir(), "codepatrol-test-"));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith("GIT_")) env[key] = value;
  }
  const git = (args: string[]): string => execFileSync("git", args, { cwd: path, encoding: "utf8", env }).trim();
  const gitWithInput = (args: string[], input?: string, extraEnv?: Record<string, string>): string =>
    execFileSync("git", args, { cwd: path, encoding: "utf8", env: { ...env, ...extraEnv }, input }).trim();

  git(["init", "-b", "main"]);
  git(["config", "user.name", "test"]);
  git(["config", "user.email", "test@localhost"]);
  git(["commit", "--allow-empty", "-m", "initial"]);

  return {
    path,
    cleanup() {
      rmSync(path, { recursive: true, force: true });
    },
    git,
    gitWithInput,
    refs() {
      return git(["for-each-ref", "--format=%(refname)"])
        .split("\n")
        .filter((line) => line !== "");
    },
    headRefs() {
      return git(["for-each-ref", "--format=%(refname)", "refs/heads"])
        .split("\n")
        .filter((line) => line !== "");
    },
    headCommit(ref: string) {
      return git(["rev-parse", ref]);
    },
  };
}
