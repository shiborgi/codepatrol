import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { RunState } from "../src/domain.js";
import type {
  GitHubIssue,
  GitHubMilestone,
  GitHubRestAdapter,
  IssueWrite,
  MilestoneWrite,
} from "../src/github-rest.js";
import { projectGitHub, syncRemote } from "../src/github-sync.js";
import type { GitHubWikiAdapter, WikiPage } from "../src/github-wiki.js";
import { saveRun, withStateLock } from "../src/state.js";

const tracking = {
  init: { key: "init", title: "Init", brief: "Brief" },
  wave: { key: "wave", title: "Wave", dueOn: "2026-01-01" },
  work: { key: "work", title: "Work", acceptance: [{ key: "done", text: "Works" }] },
};
function state(root: string, status: RunState["status"], runId: string): RunState {
  return {
    protocolVersion: "1.0",
    stateVersion: 1,
    runId,
    root,
    workspace: join(root, ".codepatrol/v1/workspaces", runId),
    baseCommit: "a".repeat(64),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    input: {
      protocolVersion: "1.0",
      root,
      task: "secret task",
      paths: ["secret.ts"],
      tracking,
    },
    status,
    stages: [],
  };
}
class Rest implements GitHubRestAdapter {
  milestones: GitHubMilestone[] = [];
  issues: GitHubIssue[] = [];
  writes = 0;
  async preflight() {
    return { hasWiki: true };
  }
  async listMilestones() {
    return this.milestones;
  }
  async listIssues() {
    return this.issues;
  }
  async createMilestone(value: MilestoneWrite) {
    this.writes++;
    const item = {
      ...value,
      number: this.milestones.length + 1,
      html_url: "https://example.test/m",
    };
    this.milestones.push(item);
    return item;
  }
  async updateMilestone(number: number, value: MilestoneWrite) {
    this.writes++;
    const item = { ...value, number, html_url: "https://example.test/m" };
    this.milestones[this.milestones.findIndex((item) => item.number === number)] = item;
    return item;
  }
  async createIssue(value: IssueWrite) {
    this.writes++;
    const item = {
      ...value,
      number: this.issues.length + 1,
      html_url: "https://example.test/i",
      milestone: { number: value.milestone },
    };
    this.issues.push(item);
    return item;
  }
  async updateIssue(number: number, value: IssueWrite) {
    this.writes++;
    const item = {
      ...value,
      number,
      html_url: "https://example.test/i",
      milestone: { number: value.milestone },
    };
    this.issues[this.issues.findIndex((item) => item.number === number)] = item;
    return item;
  }
}
class Wiki implements GitHubWikiAdapter {
  pages: WikiPage[] = [];
  writes = 0;
  async inspect(marker: string) {
    return this.pages.filter((page) => page.body.includes(marker));
  }
  async upsert(page: { marker: string; title: string; body: string }) {
    const found = await this.inspect(page.marker);
    const body = `# ${page.title}\n\n${page.body}\n`;
    if (!found.length) {
      this.writes++;
      this.pages.push({ path: page.title, body });
      return "created" as const;
    }
    const existing = found[0];
    if (!existing) throw new Error("Wiki test state mismatch");
    if (existing.body === body) return "unchanged" as const;
    this.writes++;
    existing.body = body;
    return "updated" as const;
  }
  async close() {}
}
test("GitHub tracking sync is idempotent and excludes sensitive state", async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "codepatrol-sync-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, "sync.json"),
    JSON.stringify({
      protocolVersion: "1.0",
      remote: { github: { repository: "owner/repo" } },
    }),
  );
  const approved = state(root, "approved", "00000000-0000-4000-8000-000000000001");
  await withStateLock(root, () => saveRun(approved, true));
  const rest = new Rest();
  const wiki = new Wiki();
  const deps = { rest, wiki };
  const oldToken = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = "test";
  t.after(() => {
    if (oldToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = oldToken;
  });
  const first = await syncRemote({ root, config: "sync.json" }, deps);
  assert.deepEqual(first.counts, {
    wiki: { created: 1, updated: 0, unchanged: 0 },
    milestones: { created: 1, updated: 0, unchanged: 0 },
    issues: { created: 1, updated: 0, unchanged: 0 },
  });
  await syncRemote({ root, config: "sync.json" }, deps);
  assert.equal(rest.writes + wiki.writes, 3);
  assert.ok(!JSON.stringify(rest).includes("secret"));
  assert.equal(rest.milestones[0]?.state, "closed");
  assert.equal(rest.issues[0]?.state, "closed");
});
test("projection rejects conflicts and approved work cannot regress", () => {
  const root = "/unused";
  const approved = state(root, "approved", "00000000-0000-4000-8000-000000000001");
  const blocked = {
    ...state(root, "blocked", "00000000-0000-4000-8000-000000000002"),
    createdAt: "2026-02-01T00:00:00.000Z",
  };
  assert.equal(
    projectGitHub([approved, blocked]).find((item) => item.kind === "work")?.state,
    "closed",
  );
  const conflict = {
    ...state(root, "approved", "00000000-0000-4000-8000-000000000003"),
    input: {
      ...approved.input,
      tracking: { ...tracking, work: { ...tracking.work, title: "Other" } },
    },
  };
  assert.throws(() => projectGitHub([approved, conflict]), /metadata conflict/);
});
