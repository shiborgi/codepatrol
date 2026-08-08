export interface GitHubMilestone {
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  labels: string[];
  milestone: number | null;
}

export interface GitHubComment {
  id: number;
  body: string;
}

export interface GitHubWikiPage {
  name: string;
  body: string;
}

export interface ProjectSingleSelectField {
  id: string;
  name: string;
  options: { id: string; name: string }[];
}

export interface ProjectRef {
  id: string;
  number: number;
}

export interface GitHubPort {
  listMilestones(): Promise<GitHubMilestone[]>;
  createMilestone(input: { title: string; body: string }): Promise<GitHubMilestone>;
  updateMilestone(number: number, input: { title?: string; body?: string; state?: "open" | "closed" }): Promise<void>;

  listIssues(): Promise<GitHubIssue[]>;
  createIssue(input: { title: string; body: string; labels: string[]; milestone: number | null }): Promise<GitHubIssue>;
  updateIssue(
    number: number,
    input: { title?: string; body?: string; labels?: string[]; milestone?: number | null; state?: "open" | "closed" },
  ): Promise<void>;

  listComments(issueNumber: number): Promise<GitHubComment[]>;
  createComment(issueNumber: number, body: string): Promise<GitHubComment>;
  updateComment(id: number, body: string): Promise<void>;

  ensureLabel(name: string, color: string): Promise<void>;

  readWikiPage(name: string): Promise<GitHubWikiPage | null>;
  writeWikiPage(name: string, body: string): Promise<void>;

  // GitHub Projects v2. Remote ids are rediscoverable metadata, never authority.
  resolveProject(owner: string, number: number): Promise<ProjectRef>;
  resolveSingleSelectField(projectId: string, name: string): Promise<ProjectSingleSelectField | null>;
  createSingleSelectField(projectId: string, name: string, options: string[]): Promise<ProjectSingleSelectField>;
  addFieldOptions(
    projectId: string,
    field: ProjectSingleSelectField,
    options: string[],
  ): Promise<ProjectSingleSelectField>;
  findProjectItem(projectId: string, issueNumber: number): Promise<string | null>;
  addProjectItem(projectId: string, issueNumber: number): Promise<string>;
  readItemFieldValue(projectId: string, itemId: string, fieldId: string): Promise<string | null>;
  setItemFieldValue(projectId: string, itemId: string, fieldId: string, optionId: string | null): Promise<void>;
}
