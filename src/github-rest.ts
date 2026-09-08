import { z } from "zod";
import { VERSION } from "./contracts.js";

const MAX_RESPONSE_BYTES = 1_048_576;
const MAX_PAGES = 100;
const MAX_ENTITIES = 10_000;
const TIMEOUT_MS = 30_000;

const milestoneSchema = z
  .object({
    number: z.number().int().positive(),
    title: z.string(),
    description: z.string().nullable(),
    state: z.enum(["open", "closed"]),
    due_on: z.string().nullable().optional(),
    html_url: z.string().url(),
  })
  .passthrough();
const issueSchema = z
  .object({
    number: z.number().int().positive(),
    title: z.string(),
    body: z.string().nullable(),
    state: z.enum(["open", "closed"]),
    milestone: z.object({ number: z.number().int().positive() }).nullable(),
    pull_request: z.unknown().optional(),
    html_url: z.string().url(),
  })
  .passthrough();
const repositorySchema = z.object({ has_wiki: z.boolean() }).passthrough();

export type GitHubMilestone = z.infer<typeof milestoneSchema>;
export type GitHubIssue = z.infer<typeof issueSchema>;
export interface MilestoneWrite {
  title: string;
  description: string;
  state: "open" | "closed";
  due_on: string | null;
}
export interface IssueWrite {
  title: string;
  body: string;
  milestone: number;
  state: "open" | "closed";
  state_reason?: "completed";
}

export interface GitHubRestAdapter {
  preflight(): Promise<{ hasWiki: boolean }>;
  listMilestones(): Promise<GitHubMilestone[]>;
  listIssues(): Promise<GitHubIssue[]>;
  createMilestone(value: MilestoneWrite): Promise<GitHubMilestone>;
  updateMilestone(number: number, value: MilestoneWrite): Promise<GitHubMilestone>;
  createIssue(value: IssueWrite): Promise<GitHubIssue>;
  updateIssue(number: number, value: IssueWrite): Promise<GitHubIssue>;
}

export class GitHubRestClient implements GitHubRestAdapter {
  constructor(
    private readonly repository: string,
    private readonly token: string,
    private readonly fetcher: typeof fetch = globalThis.fetch,
  ) {}

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await this.fetcher(`https://api.github.com${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
          "User-Agent": `codepatrol/${VERSION}`,
          "X-GitHub-Api-Version": "2022-11-28",
          ...init.headers,
        },
      });
      const declared = Number(response.headers.get("content-length") ?? 0);
      if (declared > MAX_RESPONSE_BYTES)
        throw new Error("GitHub response exceeds byte limit");
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > MAX_RESPONSE_BYTES)
        throw new Error("GitHub response exceeds byte limit");
      const text = bytes.toString("utf8");
      if (!response.ok)
        throw new Error(
          `GitHub API ${response.status}: ${text.slice(0, 500) || "request failed"}`,
        );
      if (!text) return undefined;
      try {
        return JSON.parse(text);
      } catch {
        throw new Error("GitHub returned malformed JSON");
      }
    } catch (error) {
      if ((error as Error).name === "AbortError")
        throw new Error("GitHub request timed out");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private async pages<T>(path: string, schema: z.ZodType<T>): Promise<T[]> {
    const values: T[] = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const separator = path.includes("?") ? "&" : "?";
      const raw = await this.request(`${path}${separator}per_page=100&page=${page}`);
      const batch = z.array(schema).max(100).parse(raw);
      values.push(...batch);
      if (values.length > MAX_ENTITIES) throw new Error("GitHub entity limit exceeded");
      if (batch.length < 100) return values;
    }
    throw new Error("GitHub pagination limit exceeded");
  }

  async preflight() {
    const repo = repositorySchema.parse(
      await this.request(`/repos/${this.repository}`),
    );
    return { hasWiki: repo.has_wiki };
  }
  listMilestones() {
    return this.pages(
      `/repos/${this.repository}/milestones?state=all&sort=due_on&direction=asc`,
      milestoneSchema,
    );
  }
  async listIssues() {
    return (
      await this.pages(`/repos/${this.repository}/issues?state=all`, issueSchema)
    ).filter((issue) => issue.pull_request === undefined);
  }
  async createMilestone(value: MilestoneWrite) {
    return milestoneSchema.parse(
      await this.request(`/repos/${this.repository}/milestones`, {
        method: "POST",
        body: JSON.stringify(value),
      }),
    );
  }
  async updateMilestone(number: number, value: MilestoneWrite) {
    return milestoneSchema.parse(
      await this.request(`/repos/${this.repository}/milestones/${number}`, {
        method: "PATCH",
        body: JSON.stringify(value),
      }),
    );
  }
  async createIssue(value: IssueWrite) {
    return issueSchema.parse(
      await this.request(`/repos/${this.repository}/issues`, {
        method: "POST",
        body: JSON.stringify(value),
      }),
    );
  }
  async updateIssue(number: number, value: IssueWrite) {
    return issueSchema.parse(
      await this.request(`/repos/${this.repository}/issues/${number}`, {
        method: "PATCH",
        body: JSON.stringify(value),
      }),
    );
  }
}
