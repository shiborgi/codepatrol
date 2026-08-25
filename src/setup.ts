import { randomUUID } from "node:crypto";
import {
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { type Config, validateConfig } from "./config.js";
import { CodePatrolError, ERROR_CODES, usage } from "./errors.js";
import type { Repository } from "./git.js";

export interface SetupOptions {
  baseBranch?: string;
  verificationArgv?: string;
  gitRemote?: string;
  githubRepo?: string;
  tokenEnv?: string;
  comments?: string;
  pushMain?: string;
  dryRun: boolean;
  update: boolean;
}

export function setupRepository(repo: Repository, options: SetupOptions): Config {
  const path = resolve(repo.root, "codepatrol.json");
  const existing = existsSync(path);
  if (existing && !options.update)
    throw new CodePatrolError(
      ERROR_CODES.CONFIG_INVALID,
      `${path} already exists; use --update`,
    );
  const current = existing ? readExisting(path) : undefined;
  const verificationArgv = options.verificationArgv
    ? parseArgv(options.verificationArgv)
    : current?.verification.argv;
  if (!verificationArgv)
    usage("--verification-argv is required when creating codepatrol.json");
  const gitRemote = options.gitRemote ?? current?.remote?.github.gitRemote ?? "origin";
  const githubRepo =
    options.githubRepo ?? current?.remote?.github.repo ?? discoverRepo(repo, gitRemote);
  if (!/^[^/\s]+\/[^/\s]+$/.test(githubRepo))
    usage("--github-repo must be owner/repository");
  const tokenEnv =
    options.tokenEnv ?? current?.remote?.github.tokenEnv ?? "GITHUB_TOKEN";
  assertTokenEnv(tokenEnv);
  const baseBranch =
    options.baseBranch ?? current?.baseBranch ?? checkedOutBranch(repo);
  const github = {
    ...(current?.remote?.github ?? { wiki: true, milestones: true, issues: true }),
    enabled: true,
    repo: githubRepo,
    gitRemote,
    tokenEnv,
    comments: parseBoolean(
      options.comments,
      current?.remote?.github.comments ?? true,
      "--comments",
    ),
    pushMain: parseBoolean(
      options.pushMain,
      current?.remote?.github.pushMain ?? false,
      "--push-main",
    ),
  };
  const next = validateConfig({
    ...(current ?? { schemaVersion: 1, maxReviewReturns: 3 }),
    schemaVersion: 1,
    baseBranch,
    verification: { ...(current?.verification ?? {}), argv: verificationArgv },
    remote: { ...(current?.remote ?? {}), github },
  });
  if (!options.dryRun) writeAtomically(path, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

function readExisting(path: string): Config {
  try {
    return validateConfig(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    if (error instanceof CodePatrolError) throw error;
    throw new CodePatrolError(
      ERROR_CODES.CONFIG_INVALID,
      `cannot parse valid JSON from ${path}`,
    );
  }
}

function parseArgv(raw: string): string[] {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    usage("--verification-argv must be a JSON string-array");
  }
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== "string" || !item)
  )
    usage("--verification-argv must be a JSON string-array");
  return value as string[];
}

function parseBoolean(
  raw: string | undefined,
  fallback: boolean,
  name: string,
): boolean {
  if (raw === undefined) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  usage(`${name} must be true or false`);
}

function assertTokenEnv(value: string): void {
  if (
    !/^[A-Z_][A-Z0-9_]*$/.test(value) ||
    /(?:gh[pousr]_|github_pat_|bearer\s|-----begin)/i.test(value)
  )
    usage("--token-env must be an environment variable name, not a token or secret");
}

function checkedOutBranch(repo: Repository): string {
  const branch = repo
    .tryGit(["symbolic-ref", "--quiet", "--short", "HEAD"])
    .stdout.trim();
  return branch || "main";
}

function discoverRepo(repo: Repository, remote: string): string {
  const result = repo.tryGit(["remote", "get-url", remote]);
  if (result.status !== "succeeded")
    throw new CodePatrolError(
      ERROR_CODES.REMOTE_REPO_UNKNOWN,
      `cannot read Git remote ${remote}`,
    );
  const url = result.stdout.trim();
  const match = url.match(
    /^(?:https?:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([^/]+)\/([^/]+?)(?:\.git)?\/?$/i,
  );
  if (!match)
    throw new CodePatrolError(
      ERROR_CODES.REMOTE_REPO_UNKNOWN,
      `cannot parse GitHub repository from ${url}`,
    );
  return `${match[1]}/${match[2]}`;
}

function writeAtomically(path: string, content: string): void {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, content, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, path);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {}
    throw new CodePatrolError(
      ERROR_CODES.CONFIG_INVALID,
      `cannot write ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
