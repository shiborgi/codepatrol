import type { ChildProcessByStdio } from "node:child_process";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import type {
  GitHubComment,
  GitHubIssue,
  GitHubMilestone,
  GitHubPort,
  GitHubWikiPage,
  ProjectRef,
  ProjectSingleSelectField,
} from "../application/ports.js";
import { CodepatrolError } from "../core/errors.js";
import { messageOf } from "./git.js";

export function githubRepository(url: string): string | null {
  const ssh = /^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/.exec(url);
  if (ssh !== null) return ssh[1] ?? null;
  const https = /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/.exec(url);
  if (https !== null) return https[1] ?? null;
  return null;
}

const PAGE_SIZE = 100;

function ghRaw(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (action: () => void): void => {
      if (settled) return;
      settled = true;
      action();
    };
    let child: ChildProcessByStdio<null, Readable, Readable>;
    try {
      child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      settle(() => reject(new CodepatrolError("GITHUB", `failed to spawn ${command}: ${messageOf(error)}`)));
      return;
    }
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      settle(() => reject(new CodepatrolError("GITHUB", `failed to run gh: ${messageOf(error)}`)));
    });
    child.on("close", (code) => {
      settle(() => {
        const out = Buffer.concat(stdout).toString("utf8");
        if (code !== 0) {
          reject(
            new CodepatrolError(
              "GITHUB",
              `gh ${args.join(" ")} failed: ${Buffer.concat(stderr).toString("utf8").trim()}`,
            ),
          );
          return;
        }
        resolve(out);
      });
    });
  });
}

async function ghJson(
  command: string,
  endpoint: string,
  method: "GET" | "POST" | "PATCH",
  fields: Record<string, unknown> = {},
): Promise<unknown> {
  const args = ["api", endpoint, "-X", method];
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      for (const entry of value) args.push("-f", `${key}[]=${String(entry)}`);
    } else if (typeof value === "number") {
      args.push("-F", `${key}=${String(value)}`);
    } else {
      args.push("-f", `${key}=${String(value)}`);
    }
  }
  const out = await ghRaw(command, args);
  if (out.trim() === "") return null;
  try {
    return JSON.parse(out);
  } catch {
    throw new CodepatrolError("GITHUB", `gh api returned invalid JSON for ${endpoint}`);
  }
}

async function ghGraphql(
  command: string,
  query: string,
  variables: Record<string, string | number>,
): Promise<Record<string, unknown>> {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [key, value] of Object.entries(variables)) {
    args.push(typeof value === "number" ? "-F" : "-f", `${key}=${String(value)}`);
  }
  const out = await ghRaw(command, args);
  try {
    const parsed = JSON.parse(out) as { data?: Record<string, unknown>; errors?: { message: string }[] };
    if (parsed.errors !== undefined && parsed.errors.length > 0) {
      throw new CodepatrolError("GITHUB", `graphql: ${parsed.errors.map((e) => e.message).join("; ")}`);
    }
    return (parsed.data ?? {}) as Record<string, unknown>;
  } catch (error) {
    if (error instanceof CodepatrolError) throw error;
    throw new CodepatrolError("GITHUB", "gh api graphql returned invalid JSON");
  }
}

async function ghList(command: string, endpoint: string): Promise<unknown[]> {
  const separator = endpoint.includes("?") ? "&" : "?";
  const pages: unknown[] = [];
  for (let page = 1; ; page += 1) {
    const result = await ghJson(command, `${endpoint}${separator}per_page=${PAGE_SIZE}&page=${page}`, "GET");
    if (!Array.isArray(result)) {
      throw new CodepatrolError("GITHUB", `gh api returned a non-array for ${endpoint}`);
    }
    pages.push(...result);
    if (result.length < PAGE_SIZE) return pages;
  }
}

interface RawMilestone {
  number: number;
  title: string;
  description: string | null;
  state: string;
}
interface RawIssue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  labels: { name: string }[];
  milestone: { number: number } | null;
  pull_request?: unknown;
}
interface RawComment {
  id: number;
  body: string | null;
}

export class GhGitHub implements GitHubPort {
  constructor(
    private readonly repo: string,
    private readonly command: string = "gh",
  ) {}

  async listMilestones(): Promise<GitHubMilestone[]> {
    const raw = (await ghList(this.command, `repos/${this.repo}/milestones?state=all`)) as RawMilestone[];
    return raw.map((milestone) => ({
      number: milestone.number,
      title: milestone.title,
      body: milestone.description ?? "",
      state: milestone.state === "closed" ? "closed" : "open",
    }));
  }

  async createMilestone(input: { title: string; body: string }): Promise<GitHubMilestone> {
    const raw = (await ghJson(this.command, `repos/${this.repo}/milestones`, "POST", {
      title: input.title,
      description: input.body,
    })) as RawMilestone;
    return { number: raw.number, title: raw.title, body: raw.description ?? "", state: "open" };
  }

  async updateMilestone(
    number: number,
    input: { title?: string; body?: string; state?: "open" | "closed" },
  ): Promise<void> {
    const fields: Record<string, unknown> = {};
    if (input.title !== undefined) fields.title = input.title;
    if (input.body !== undefined) fields.description = input.body;
    if (input.state !== undefined) fields.state = input.state;
    await ghJson(this.command, `repos/${this.repo}/milestones/${number}`, "PATCH", fields);
  }

  async listIssues(): Promise<GitHubIssue[]> {
    const raw = (await ghList(this.command, `repos/${this.repo}/issues?state=all`)) as RawIssue[];
    return raw.filter((issue) => issue.pull_request === undefined).map(toIssue);
  }

  async createIssue(input: {
    title: string;
    body: string;
    labels: string[];
    milestone: number | null;
  }): Promise<GitHubIssue> {
    const fields: Record<string, unknown> = { title: input.title, body: input.body, labels: input.labels };
    if (input.milestone !== null) fields.milestone = input.milestone;
    const raw = (await ghJson(this.command, `repos/${this.repo}/issues`, "POST", fields)) as RawIssue;
    return toIssue(raw);
  }

  async updateIssue(
    number: number,
    input: { title?: string; body?: string; labels?: string[]; milestone?: number | null; state?: "open" | "closed" },
  ): Promise<void> {
    const fields: Record<string, unknown> = {};
    if (input.title !== undefined) fields.title = input.title;
    if (input.body !== undefined) fields.body = input.body;
    if (input.labels !== undefined) fields.labels = input.labels;
    if (input.milestone !== undefined) fields.milestone = input.milestone;
    if (input.state !== undefined) fields.state = input.state;
    await ghJson(this.command, `repos/${this.repo}/issues/${number}`, "PATCH", fields);
  }

  async listComments(issueNumber: number): Promise<GitHubComment[]> {
    const raw = (await ghList(this.command, `repos/${this.repo}/issues/${issueNumber}/comments`)) as RawComment[];
    return raw.map((comment) => ({ id: comment.id, body: comment.body ?? "" }));
  }

  async createComment(issueNumber: number, body: string): Promise<GitHubComment> {
    const raw = (await ghJson(this.command, `repos/${this.repo}/issues/${issueNumber}/comments`, "POST", {
      body,
    })) as RawComment;
    return { id: raw.id, body: raw.body ?? "" };
  }

  async updateComment(id: number, body: string): Promise<void> {
    await ghJson(this.command, `repos/${this.repo}/issues/comments/${id}`, "PATCH", { body });
  }

  async ensureLabel(name: string, color: string): Promise<void> {
    try {
      await ghJson(this.command, `repos/${this.repo}/labels`, "POST", { name, color });
    } catch (error) {
      if (error instanceof CodepatrolError && error.message.includes("422")) return;
      throw error;
    }
  }

  // The wiki is a separate git repository, not a REST resource.
  async readWikiPage(name: string): Promise<GitHubWikiPage | null> {
    return this.withWikiClone((dir) => {
      try {
        return { name, body: readFileSync(join(dir, `${name}.md`), "utf8") };
      } catch {
        return null;
      }
    });
  }

  async writeWikiPage(name: string, body: string): Promise<void> {
    await this.withWikiClone((dir) => {
      writeFileSync(join(dir, `${name}.md`), body);
      gitAt(dir, ["add", `${name}.md`]);
      const status = gitAt(dir, ["status", "--porcelain"]);
      if (status.trim() === "") return;
      gitAt(dir, [
        "-c",
        "user.name=codepatrol",
        "-c",
        "user.email=codepatrol@localhost",
        "commit",
        "-m",
        `codepatrol: project ${name}`,
      ]);
      gitAt(dir, ["push", "origin", "HEAD"]);
    });
  }

  // An owner is either a user or an organization; asking for both in one query
  // makes GitHub error on whichever the owner is not, so they are tried in turn.
  async resolveProject(owner: string, number: number): Promise<ProjectRef> {
    for (const holder of ["user", "organization"] as const) {
      const query = `query($owner: String!, $number: Int!) {
        ${holder}(login: $owner) { projectV2(number: $number) { id number } }
      }`;
      let data: Record<string, unknown>;
      try {
        data = await ghGraphql(this.command, query, { owner, number });
      } catch {
        continue;
      }
      const project = (data[holder] as { projectV2?: { id: string; number: number } | null } | null)?.projectV2;
      if (project !== undefined && project !== null) return { id: project.id, number: project.number };
    }
    throw new CodepatrolError("GITHUB", `project ${owner}/${number} not found for owner ${owner}`);
  }

  async resolveSingleSelectField(projectId: string, name: string): Promise<ProjectSingleSelectField | null> {
    const query = `query($projectId: ID!) {
      node(id: $projectId) { ... on ProjectV2 { fields(first: 50) { nodes {
        ... on ProjectV2SingleSelectField { id name options { id name } }
      } } } }
    }`;
    const data = await ghGraphql(this.command, query, { projectId });
    const node = data.node as { fields?: { nodes?: (ProjectSingleSelectField | Record<string, never>)[] } } | null;
    const fields = (node?.fields?.nodes ?? []) as ProjectSingleSelectField[];
    return fields.find((field) => field?.name === name) ?? null;
  }

  async createSingleSelectField(projectId: string, name: string, options: string[]): Promise<ProjectSingleSelectField> {
    const optionInput = options
      .map((option) => `{ name: ${JSON.stringify(option)}, color: GRAY, description: "" }`)
      .join(", ");
    const query = `mutation($projectId: ID!, $name: String!) {
      createProjectV2Field(input: {
        projectId: $projectId, dataType: SINGLE_SELECT, name: $name,
        singleSelectOptions: [${optionInput}]
      }) { projectV2Field { ... on ProjectV2SingleSelectField { id name options { id name } } } }
    }`;
    const data = await ghGraphql(this.command, query, { projectId, name });
    const created = (data.createProjectV2Field as { projectV2Field?: ProjectSingleSelectField } | null)?.projectV2Field;
    if (created === undefined) throw new CodepatrolError("GITHUB", `could not create field ${name}`);
    return created;
  }

  async addFieldOptions(
    _projectId: string,
    field: ProjectSingleSelectField,
    options: string[],
  ): Promise<ProjectSingleSelectField> {
    const desired = [...field.options.map((option) => option.name), ...options];
    const optionInput = desired
      .map((option) => `{ name: ${JSON.stringify(option)}, color: GRAY, description: "" }`)
      .join(", ");
    const query = `mutation($fieldId: ID!) {
      updateProjectV2Field(input: { fieldId: $fieldId, singleSelectOptions: [${optionInput}] }) {
        projectV2Field { ... on ProjectV2SingleSelectField { id name options { id name } } }
      }
    }`;
    const data = await ghGraphql(this.command, query, { fieldId: field.id });
    const updated = (data.updateProjectV2Field as { projectV2Field?: ProjectSingleSelectField } | null)?.projectV2Field;
    if (updated === undefined) throw new CodepatrolError("GITHUB", `could not add options to ${field.name}`);
    return updated;
  }

  async findProjectItem(_projectId: string, issueNumber: number): Promise<string | null> {
    const query = `query($projectId: ID!) {
      node(id: $projectId) { ... on ProjectV2 { items(first: 100) { nodes {
        id content { ... on Issue { number } }
      } } } }
    }`;
    const data = await ghGraphql(this.command, query, { projectId: _projectId });
    const node = data.node as { items?: { nodes?: { id: string; content?: { number?: number } }[] } } | null;
    const items = node?.items?.nodes ?? [];
    return items.find((item) => item.content?.number === issueNumber)?.id ?? null;
  }

  async addProjectItem(projectId: string, issueNumber: number): Promise<string> {
    const issue = (await ghJson(this.command, `repos/${this.repo}/issues/${issueNumber}`, "GET")) as {
      node_id?: string;
    };
    if (issue.node_id === undefined) throw new CodepatrolError("GITHUB", `issue ${issueNumber} has no node id`);
    const query = `mutation($projectId: ID!, $contentId: ID!) {
      addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) { item { id } }
    }`;
    const data = await ghGraphql(this.command, query, { projectId, contentId: issue.node_id });
    const item = (data.addProjectV2ItemById as { item?: { id: string } } | null)?.item;
    if (item === undefined) throw new CodepatrolError("GITHUB", `could not add issue ${issueNumber} to the project`);
    return item.id;
  }

  async readItemFieldValue(_projectId: string, itemId: string, fieldId: string): Promise<string | null> {
    const query = `query($itemId: ID!) {
      node(id: $itemId) { ... on ProjectV2Item { fieldValues(first: 50) { nodes {
        ... on ProjectV2ItemFieldSingleSelectValue { optionId field { ... on ProjectV2SingleSelectField { id } } }
      } } } }
    }`;
    const data = await ghGraphql(this.command, query, { itemId });
    const node = data.node as { fieldValues?: { nodes?: { optionId?: string; field?: { id?: string } }[] } } | null;
    const values = node?.fieldValues?.nodes ?? [];
    return values.find((value) => value.field?.id === fieldId)?.optionId ?? null;
  }

  async setItemFieldValue(projectId: string, itemId: string, fieldId: string, optionId: string | null): Promise<void> {
    if (optionId === null) {
      const clear = `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!) {
        clearProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId }) { projectV2Item { id } }
      }`;
      await ghGraphql(this.command, clear, { projectId, itemId, fieldId });
      return;
    }
    const query = `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId, itemId: $itemId, fieldId: $fieldId,
        value: { singleSelectOptionId: $optionId }
      }) { projectV2Item { id } }
    }`;
    await ghGraphql(this.command, query, { projectId, itemId, fieldId, optionId });
  }

  private withWikiClone<T>(action: (dir: string) => T): T {
    const dir = mkdtempSync(join(tmpdir(), "codepatrol-wiki-"));
    try {
      gitAt(".", ["clone", "--quiet", "--depth", "1", `https://github.com/${this.repo}.wiki.git`, dir]);
      return action(dir);
    } catch (error) {
      throw new CodepatrolError("GITHUB", `wiki access for ${this.repo} failed: ${messageOf(error)}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

function gitAt(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function toIssue(raw: RawIssue): GitHubIssue {
  return {
    number: raw.number,
    title: raw.title,
    body: raw.body ?? "",
    state: raw.state === "closed" ? "closed" : "open",
    labels: raw.labels.map((label) => label.name),
    milestone: raw.milestone?.number ?? null,
  };
}
