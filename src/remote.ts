import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { canonicalCommentary } from "./commentary.js";
import type { Config } from "./config.js";
import type { Init, State, Wave, Work } from "./core.js";
import { assertDomain, CodePatrolError, ERROR_CODES } from "./errors.js";
import type { Repository } from "./git.js";
import { type RunContext, systemRunContext } from "./run-context.js";
import { VERSION } from "./version.js";

interface GitHubConfig {
  enabled: boolean;
  repo?: string;
  gitRemote: string;
  tokenEnv: string;
  wiki: boolean;
  milestones: boolean;
  issues: boolean;
  comments: boolean;
}

interface Milestone {
  number: number;
  title: string;
  description: string | null;
  state: "open" | "closed";
}

interface Issue {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  pull_request?: unknown;
  milestone?: { number: number } | null;
}

interface Comment {
  id: number;
  body: string;
}

class GitHub {
  constructor(
    private readonly repository: string,
    private readonly token: string,
    private readonly ctx: RunContext,
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.ctx.fetch(`https://api.github.com${path}`, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        "User-Agent": `codepatrol/${VERSION}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...init?.headers,
      },
    });
    if (!response.ok) {
      throw new CodePatrolError(
        ERROR_CODES.REMOTE_FAILED,
        `GitHub ${response.status}: ${(await response.text()).slice(0, 500)}`,
      );
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  private async pages<T>(path: string): Promise<T[]> {
    const values: T[] = [];
    for (let page = 1; ; page += 1) {
      const separator = path.includes("?") ? "&" : "?";
      const batch = await this.request<T[]>(
        `${path}${separator}per_page=100&page=${page}`,
      );
      values.push(...batch);
      if (batch.length < 100) return values;
    }
  }

  async syncMilestone(
    wave: Wave,
  ): Promise<{ number: number; created: boolean; updated: boolean }> {
    const marker = `<!-- codepatrol:wave:${wave.id} -->`;
    const all = await this.pages<Milestone>(
      `/repos/${this.repository}/milestones?state=all&sort=due_on&direction=asc`,
    );
    const existing = all.find((milestone) => milestone.description?.includes(marker));
    const body = {
      title: `${wave.id}: ${wave.title}`,
      description: `${marker}\nManaged by CodePatrol.`,
      state: ["accepted", "rolled-back"].includes(wave.status) ? "closed" : "open",
    };
    if (existing) {
      const updated =
        existing.title !== body.title ||
        existing.description !== body.description ||
        existing.state !== body.state;
      if (!updated) return { number: existing.number, created: false, updated: false };
      await this.request(`/repos/${this.repository}/milestones/${existing.number}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      return { number: existing.number, created: false, updated: true };
    }
    const created = await this.request<Milestone>(
      `/repos/${this.repository}/milestones`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );
    return { number: created.number, created: true, updated: false };
  }

  async syncIssue(
    work: Work,
    milestone: number | null,
  ): Promise<{ number: number; created: boolean; updated: boolean }> {
    const marker = `<!-- codepatrol:work:${work.id} -->`;
    const all = await this.pages<Issue>(`/repos/${this.repository}/issues?state=all`);
    const existing = all.find(
      (issue) => !issue.pull_request && issue.body?.includes(marker),
    );
    const acceptance = work.acceptance
      .map(
        (item) =>
          `- [${work.status === "accepted" ? "x" : " "}] ${item.id}: ${item.text}`,
      )
      .join("\n");
    const body = {
      title: `${work.id}: ${work.title}`,
      body: `${marker}\n${work.description}\n\n## Acceptance\n${acceptance}`,
      milestone,
      state: ["accepted", "rolled-back"].includes(work.status) ? "closed" : "open",
    };
    if (existing) {
      const updated =
        existing.title !== body.title ||
        existing.body !== body.body ||
        existing.state !== body.state ||
        (existing.milestone?.number ?? null) !== milestone;
      if (!updated) return { number: existing.number, created: false, updated: false };
      await this.request(`/repos/${this.repository}/issues/${existing.number}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      return { number: existing.number, created: false, updated: true };
    }
    const created = await this.request<Issue>(`/repos/${this.repository}/issues`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return { number: created.number, created: true, updated: false };
  }

  async listWorkIssues(): Promise<Issue[]> {
    return (
      await this.pages<Issue>(`/repos/${this.repository}/issues?state=all`)
    ).filter(
      (issue) =>
        !issue.pull_request && Boolean(issue.body?.includes("<!-- codepatrol:work:")),
    );
  }

  async upsertComment(
    issue: number,
    body: string,
  ): Promise<"created" | "updated" | "updated-and-deleted" | "deleted" | "unchanged"> {
    const comments = await this.pages<Comment>(
      `/repos/${this.repository}/issues/${issue}/comments`,
    );
    const marker = body.match(/<!-- codepatrol:comment:[^ ]+ -->/)?.[0];
    if (!marker) return "created";
    const matches = comments
      .filter((comment) => comment.body.includes(marker))
      .sort((a, b) => a.id - b.id);
    const existing = matches[0];
    if (!existing) {
      await this.request(`/repos/${this.repository}/issues/${issue}/comments`, {
        method: "POST",
        body: JSON.stringify({ body }),
      });
      return "created";
    }
    let mutation: "updated" | "updated-and-deleted" | "deleted" | "unchanged" =
      "unchanged";
    if (existing.body !== body) {
      await this.request(`/repos/${this.repository}/issues/comments/${existing.id}`, {
        method: "PATCH",
        body: JSON.stringify({ body }),
      });
      mutation = "updated";
    }
    for (const duplicate of matches.slice(1)) {
      await this.request(`/repos/${this.repository}/issues/comments/${duplicate.id}`, {
        method: "DELETE",
      });
      mutation = mutation === "updated" ? "updated-and-deleted" : "deleted";
    }
    return mutation;
  }
}

export async function upsertGitHubComments(
  repo: Repository,
  config: Config,
  comments: Array<{ workId: string; body: string }>,
  ctx: RunContext = systemRunContext(),
): Promise<{
  commentsCreated: number;
  commentsUpdated: number;
  commentsDeleted: number;
  commentsUnchanged: number;
}> {
  const github = config.remote?.github;
  if (
    !github?.enabled ||
    !github.issues ||
    github.comments === false ||
    comments.length === 0
  )
    return {
      commentsCreated: 0,
      commentsUpdated: 0,
      commentsDeleted: 0,
      commentsUnchanged: 0,
    };
  const repository = github.repo ?? detectRepository(repo, github);
  const token = ctx.env(github.tokenEnv) ?? ctx.env("GH_TOKEN");
  assertDomain(
    token,
    ERROR_CODES.REMOTE_AUTH_MISSING,
    `${github.tokenEnv} or GH_TOKEN is required`,
  );
  const client = new GitHub(repository, token, ctx);
  const issues = await client.listWorkIssues();
  let commentsCreated = 0;
  let commentsUpdated = 0;
  let commentsDeleted = 0;
  let commentsUnchanged = 0;
  for (const comment of comments) {
    const issue = issues.find((entry) =>
      entry.body?.includes(`<!-- codepatrol:work:${comment.workId} -->`),
    );
    if (issue) {
      const mutation = await client.upsertComment(issue.number, comment.body);
      if (mutation === "created") commentsCreated += 1;
      if (mutation === "updated") commentsUpdated += 1;
      if (mutation === "updated-and-deleted") commentsUpdated += 1;
      if (mutation === "deleted") commentsDeleted += 1;
      if (mutation === "updated-and-deleted") commentsDeleted += 1;
      if (mutation === "unchanged") commentsUnchanged += 1;
    }
  }
  return { commentsCreated, commentsUpdated, commentsDeleted, commentsUnchanged };
}

export async function syncGitHub(
  repo: Repository,
  config: Config,
  ctx: RunContext = systemRunContext(),
): Promise<{
  repository: string;
  milestones: number;
  issues: number;
  wiki: boolean;
  milestonesCreated: number;
  milestonesUpdated: number;
  issuesCreated: number;
  issuesUpdated: number;
  commentsCreated: number;
  commentsUpdated: number;
  commentsDeleted: number;
  commentsUnchanged: number;
}> {
  const github = config.remote?.github;
  assertDomain(
    github?.enabled,
    ERROR_CODES.REMOTE_DISABLED,
    "GitHub synchronization is disabled",
  );
  const repository = github.repo ?? detectRepository(repo, github);
  const token = ctx.env(github.tokenEnv) ?? ctx.env("GH_TOKEN");
  assertDomain(
    token,
    ERROR_CODES.REMOTE_AUTH_MISSING,
    `${github.tokenEnv} or GH_TOKEN is required`,
  );
  const state = repo.readState().state;
  const client = new GitHub(repository, token, ctx);
  const milestones = new Map<string, number>();
  let milestonesCreated = 0;
  let milestonesUpdated = 0;
  if (github.milestones) {
    for (const wave of state.waves) {
      const mutation = await client.syncMilestone(wave);
      milestones.set(wave.id, mutation.number);
      milestonesCreated += Number(mutation.created);
      milestonesUpdated += Number(mutation.updated);
    }
  }
  let issueCount = 0;
  let issuesCreated = 0;
  let issuesUpdated = 0;
  if (github.issues) {
    for (const work of state.works) {
      const mutation = await client.syncIssue(
        work,
        milestones.get(work.waveId) ?? null,
      );
      issuesCreated += Number(mutation.created);
      issuesUpdated += Number(mutation.updated);
      issueCount += 1;
    }
  }
  if (github.wiki) await syncWiki(repository, token, state, ctx);
  const comments = await upsertGitHubComments(
    repo,
    config,
    canonicalCommentary(state),
    ctx,
  );
  return {
    repository,
    milestones: milestones.size,
    issues: issueCount,
    wiki: github.wiki,
    milestonesCreated,
    milestonesUpdated,
    issuesCreated,
    issuesUpdated,
    ...comments,
  };
}

function detectRepository(repo: Repository, config: GitHubConfig): string {
  const url = repo.git(["remote", "get-url", config.gitRemote]).trim();
  const match = url.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!match)
    throw new CodePatrolError(
      ERROR_CODES.REMOTE_REPO_UNKNOWN,
      `cannot parse GitHub repository from ${url}`,
    );
  return `${match[1]}/${match[2]}`;
}

function syncWiki(
  repository: string,
  token: string,
  state: State,
  ctx: RunContext,
): void {
  const temporary = mkdtempSync(resolve(tmpdir(), "codepatrol-wiki-"));
  try {
    const checkout = resolve(temporary, "wiki");
    const askpass = resolve(temporary, "askpass.sh");
    writeFileSync(
      askpass,
      '#!/bin/sh\ncase "$1" in *Username*) printf "%s" "x-access-token" ;; *) printf "%s" "$CODEPATROL_GITHUB_TOKEN" ;; esac\n',
    );
    chmodSync(askpass, 0o700);
    const env = {
      ...ctx.envAll(),
      GIT_ASKPASS: askpass,
      GIT_TERMINAL_PROMPT: "0",
      CODEPATROL_GITHUB_TOKEN: token,
    };
    const remote = `https://github.com/${repository}.wiki.git`;
    const clone = spawnSync("git", ["clone", "--quiet", remote, checkout], {
      encoding: "utf8",
      env,
    });
    if (clone.status !== 0) {
      mkdirSync(checkout, { recursive: true });
      runWikiGit(checkout, env, ["init", "--quiet"]);
      runWikiGit(checkout, env, ["remote", "add", "origin", remote]);
    }
    const index = [
      "<!-- codepatrol:index -->",
      "# Initiatives",
      "",
      ...state.inits.map(
        (init) => `- [[CodePatrol-${init.id}|${init.id}]] ${init.title}`,
      ),
      "",
    ];
    writeOwnedWikiPage(
      resolve(checkout, "CodePatrol-Initiatives.md"),
      "<!-- codepatrol:index -->",
      index.join("\n"),
    );
    for (const init of state.inits) {
      writeOwnedWikiPage(
        resolve(checkout, `CodePatrol-${init.id}.md`),
        `<!-- codepatrol:init:${init.id} -->`,
        renderInit(init, state),
      );
    }
    runWikiGit(checkout, env, ["add", "--all"]);
    const changed = spawnSync("git", ["diff", "--cached", "--quiet"], {
      cwd: checkout,
      env,
    });
    if (changed.status !== 0) {
      runWikiGit(checkout, env, [
        "-c",
        "user.name=CodePatrol",
        "-c",
        "user.email=codepatrol@local",
        "commit",
        "--quiet",
        "-m",
        "Sync CodePatrol initiatives",
      ]);
      runWikiGit(checkout, env, ["push", "--quiet", "origin", "HEAD:master"]);
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function writeOwnedWikiPage(path: string, marker: string, content: string): void {
  if (existsSync(path) && !readFileSync(path, "utf8").includes(marker)) {
    throw new CodePatrolError(
      ERROR_CODES.REMOTE_OWNERSHIP_CONFLICT,
      `refusing to overwrite Wiki page without ownership marker: ${path}`,
    );
  }
  writeFileSync(path, content);
}

function runWikiGit(cwd: string, env: NodeJS.ProcessEnv, args: string[]): void {
  const result = spawnSync("git", args, { cwd, env, encoding: "utf8" });
  if (result.status !== 0) {
    throw new CodePatrolError(
      ERROR_CODES.REMOTE_WIKI_FAILED,
      result.stderr?.trim() || `git ${args[0]} failed`,
    );
  }
}

function renderInit(init: Init, state: State): string {
  const lines = [
    `<!-- codepatrol:init:${init.id} -->`,
    `# ${init.id}: ${init.title}`,
    "",
    init.brief,
    "",
    `Status: **${init.status}**`,
    "",
    "## Waves",
    "",
  ];
  for (const waveId of init.waveIds) {
    const wave = state.waves.find((candidate) => candidate.id === waveId) as Wave;
    lines.push(`- ${wave.id}: ${wave.title} (${wave.status})`);
    for (const workId of wave.workIds) {
      const work = state.works.find((candidate) => candidate.id === workId) as Work;
      lines.push(`  - ${work.id}: ${work.title} (${work.status})`);
    }
  }
  lines.push("");
  return lines.join("\n");
}
