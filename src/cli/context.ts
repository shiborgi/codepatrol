import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { GitChangeManager } from "../adapters/change.js";
import { GitCheckout } from "../adapters/checkout.js";
import { loadProjectConfig } from "../adapters/config.js";
import { GhGitHub, githubRepository } from "../adapters/gh.js";
import { type Git, localGit } from "../adapters/git.js";
import { type StateSnapshot, StateStore } from "../adapters/state-store.js";
import type { GitHubPort } from "../application/ports.js";
import type { PublicationEnvironment } from "../application/publication.js";
import { SpecService } from "../application/spec-service.js";
import { type SyncScope, SyncService } from "../application/sync-service.js";
import { WorkService } from "../application/work-service.js";
import { fail } from "../core/errors.js";
import { prettyJson } from "../core/json.js";

export interface CliIO {
  out(text: string): void;
  err(text: string): void;
}

export interface RunCliOptions {
  io: CliIO;
  cwd?: string;
  now?: () => string;
  uuid?: () => string;
  githubFactory?: (repo: string) => GitHubPort;
  lock?: boolean;
}

/** Everything a command needs, wired once at the process boundary. */
export interface Context {
  io: CliIO;
  git: Git;
  store: StateStore;
  now: () => string;
  uuid: () => string;
  githubFactory: (repo: string) => GitHubPort;
  cwd: string;
}

export function makeContext(options: RunCliOptions): Context {
  const cwd = options.cwd ?? process.cwd();
  const git = localGit(cwd);
  return {
    io: options.io,
    git,
    store: new StateStore(git),
    now: options.now ?? (() => new Date().toISOString()),
    uuid: options.uuid ?? (() => randomUUID()),
    githubFactory: options.githubFactory ?? ((repo: string) => new GhGitHub(repo)),
    cwd,
  };
}

export function workService(ctx: Context): WorkService {
  const change = new GitChangeManager(ctx.git, ctx.cwd, (path) => localGit(path));
  return new WorkService(
    ctx.store,
    ctx.now,
    ctx.uuid,
    new GitCheckout(ctx.git),
    change,
    ctx.cwd,
    (path) => localGit(path),
    ctx.git,
    (msg) => ctx.io.err(msg),
  );
}

export function specService(ctx: Context): SpecService {
  return new SpecService(ctx.store, ctx.now, ctx.uuid);
}

export async function snapshot(ctx: Context): Promise<StateSnapshot> {
  return ctx.store.read();
}

export async function resolveGitHub(ctx: Context): Promise<GitHubPort | null> {
  const remote = await ctx.git.exec(["remote", "get-url", "origin"], { allowFailure: true });
  if (remote.code !== 0) return null;
  const repo = githubRepository(remote.stdout.trim());
  return repo === null ? null : ctx.githubFactory(repo);
}

export function publicationEnvironment(ctx: Context): PublicationEnvironment {
  return {
    git: ctx.git,
    now: ctx.now,
    hasRemote: async () => (await ctx.git.exec(["remote", "get-url", "origin"], { allowFailure: true })).code === 0,
  };
}

export async function bestEffortSync(ctx: Context, scope: SyncScope): Promise<void> {
  try {
    const github = await resolveGitHub(ctx);
    if (github === null) return;
    await new SyncService(ctx.store, github, loadProjectConfig(ctx.cwd)).sync(scope);
  } catch (error) {
    ctx.io.err(
      prettyJson({
        warning: "github projection failed; run `codepatrol sync` to converge",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

export async function readJson(path: string): Promise<unknown> {
  const absolute = resolve(path);
  const content = await readFile(absolute, "utf8").catch(() => fail("USAGE", `cannot read file ${path}`));
  if (content.length > 1_000_000) fail("USAGE", `file ${path} exceeds 1MB`);
  try {
    return JSON.parse(content);
  } catch {
    return fail("USAGE", `file ${path} is not valid JSON`);
  }
}
