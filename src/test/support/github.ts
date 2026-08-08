import type {
  GitHubComment,
  GitHubIssue,
  GitHubMilestone,
  GitHubPort,
  GitHubWikiPage,
  ProjectRef,
  ProjectSingleSelectField,
} from "../../application/ports.js";

export class FakeGitHub implements GitHubPort {
  milestones: GitHubMilestone[] = [];
  issues: GitHubIssue[] = [];
  comments = new Map<number, GitHubComment[]>();
  labels = new Set<string>();
  wikiPages = new Map<string, string>();
  projects = new Map<string, { id: string; number: number; owner: string }>();
  projectFields = new Map<string, ProjectSingleSelectField[]>();
  projectItems: { id: string; projectId: string; issueNumber: number }[] = [];
  itemFieldValues = new Map<string, string>();
  private nextProjectId = 1;
  private nextFieldId = 1;
  private nextOptionId = 1;
  private nextItemId = 1;
  failing = false;
  calls: string[] = [];
  private budget = Infinity;

  private nextMilestone = 1;
  private nextIssue = 1;
  private nextComment = 1;

  failNext(): void {
    this.failing = true;
  }

  failAfter(calls: number): void {
    this.budget = calls;
  }

  clearFailure(): void {
    this.budget = Infinity;
    this.failing = false;
  }

  setNextIssueNumber(next: number): void {
    this.nextIssue = next;
  }

  private async guard<T>(call: string, action: () => T): Promise<T> {
    this.calls.push(call);
    if (this.budget <= 0) {
      throw new Error(`injected GitHub failure on ${call}`);
    }
    this.budget -= 1;
    if (this.failing) {
      this.failing = false;
      throw new Error(`injected GitHub failure on ${call}`);
    }
    return action();
  }

  listMilestones(): Promise<GitHubMilestone[]> {
    return this.guard("listMilestones", () => this.milestones.map((m) => ({ ...m })));
  }

  createMilestone(input: { title: string; body: string }): Promise<GitHubMilestone> {
    return this.guard("createMilestone", () => {
      const milestone: GitHubMilestone = {
        number: this.nextMilestone++,
        title: input.title,
        body: input.body,
        state: "open",
      };
      this.milestones.push(milestone);
      return { ...milestone };
    });
  }

  updateMilestone(number: number, input: { title?: string; body?: string; state?: "open" | "closed" }): Promise<void> {
    return this.guard("updateMilestone", () => {
      const milestone = this.milestones.find((m) => m.number === number);
      if (milestone === undefined) throw new Error(`milestone ${number} not found`);
      if (input.title !== undefined) milestone.title = input.title;
      if (input.body !== undefined) milestone.body = input.body;
      if (input.state !== undefined) milestone.state = input.state;
    });
  }

  listIssues(): Promise<GitHubIssue[]> {
    return this.guard("listIssues", () => this.issues.map((issue) => ({ ...issue, labels: [...issue.labels] })));
  }

  createIssue(input: {
    title: string;
    body: string;
    labels: string[];
    milestone: number | null;
  }): Promise<GitHubIssue> {
    return this.guard("createIssue", () => {
      const issue: GitHubIssue = {
        number: this.nextIssue++,
        title: input.title,
        body: input.body,
        state: "open",
        labels: [...input.labels],
        milestone: input.milestone,
      };
      this.issues.push(issue);
      return { ...issue, labels: [...issue.labels] };
    });
  }

  updateIssue(
    number: number,
    input: { title?: string; body?: string; labels?: string[]; milestone?: number | null; state?: "open" | "closed" },
  ): Promise<void> {
    return this.guard("updateIssue", () => {
      const issue = this.issues.find((candidate) => candidate.number === number);
      if (issue === undefined) throw new Error(`issue ${number} not found`);
      if (input.title !== undefined) issue.title = input.title;
      if (input.body !== undefined) issue.body = input.body;
      if (input.labels !== undefined) issue.labels = [...input.labels];
      if (input.milestone !== undefined) issue.milestone = input.milestone;
      if (input.state !== undefined) issue.state = input.state;
    });
  }

  listComments(issueNumber: number): Promise<GitHubComment[]> {
    return this.guard("listComments", () => [...(this.comments.get(issueNumber) ?? [])]);
  }

  createComment(issueNumber: number, body: string): Promise<GitHubComment> {
    return this.guard("createComment", () => {
      const comment: GitHubComment = { id: this.nextComment++, body };
      const list = this.comments.get(issueNumber) ?? [];
      list.push(comment);
      this.comments.set(issueNumber, list);
      return { ...comment };
    });
  }

  updateComment(id: number, body: string): Promise<void> {
    return this.guard("updateComment", () => {
      for (const list of this.comments.values()) {
        const comment = list.find((candidate) => candidate.id === id);
        if (comment !== undefined) {
          comment.body = body;
          return;
        }
      }
      throw new Error(`comment ${id} not found`);
    });
  }

  ensureLabel(name: string, _color: string): Promise<void> {
    return this.guard("ensureLabel", () => {
      this.labels.add(name);
    });
  }

  /** Seeds a project the way GitHub would already have it, fields included. */
  seedProject(owner: string, number: number, fields: Record<string, string[]> = {}): string {
    const id = `PVT_${this.nextProjectId++}`;
    this.projects.set(`${owner}/${number}`, { id, number, owner });
    this.projectFields.set(
      id,
      Object.entries(fields).map(([name, options]) => ({
        id: `FIELD_${this.nextFieldId++}`,
        name,
        options: options.map((option) => ({ id: `OPT_${this.nextOptionId++}`, name: option })),
      })),
    );
    return id;
  }

  async resolveProject(owner: string, number: number): Promise<ProjectRef> {
    return this.guard("resolveProject", () => {
      const project = this.projects.get(`${owner}/${number}`);
      if (project === undefined) throw new Error(`project ${owner}/${number} not found`);
      return { id: project.id, number: project.number };
    });
  }

  async resolveSingleSelectField(projectId: string, name: string): Promise<ProjectSingleSelectField | null> {
    return this.guard("resolveSingleSelectField", () => {
      const field = (this.projectFields.get(projectId) ?? []).find((candidate) => candidate.name === name);
      return field === undefined ? null : { ...field, options: field.options.map((o) => ({ ...o })) };
    });
  }

  async createSingleSelectField(projectId: string, name: string, options: string[]): Promise<ProjectSingleSelectField> {
    return this.guard("createSingleSelectField", () => {
      const field: ProjectSingleSelectField = {
        id: `FIELD_${this.nextFieldId++}`,
        name,
        options: options.map((option) => ({ id: `OPT_${this.nextOptionId++}`, name: option })),
      };
      const fields = this.projectFields.get(projectId) ?? [];
      fields.push(field);
      this.projectFields.set(projectId, fields);
      return { ...field, options: field.options.map((o) => ({ ...o })) };
    });
  }

  async addFieldOptions(
    projectId: string,
    field: ProjectSingleSelectField,
    options: string[],
  ): Promise<ProjectSingleSelectField> {
    return this.guard("addFieldOptions", () => {
      const stored = (this.projectFields.get(projectId) ?? []).find((candidate) => candidate.id === field.id);
      if (stored === undefined) throw new Error(`field ${field.id} not found`);
      for (const option of options) {
        if (!stored.options.some((existing) => existing.name === option)) {
          stored.options.push({ id: `OPT_${this.nextOptionId++}`, name: option });
        }
      }
      return { ...stored, options: stored.options.map((o) => ({ ...o })) };
    });
  }

  async findProjectItem(projectId: string, issueNumber: number): Promise<string | null> {
    return this.guard("findProjectItem", () => {
      return (
        this.projectItems.find((item) => item.projectId === projectId && item.issueNumber === issueNumber)?.id ?? null
      );
    });
  }

  async addProjectItem(projectId: string, issueNumber: number): Promise<string> {
    return this.guard("addProjectItem", () => {
      const id = `ITEM_${this.nextItemId++}`;
      this.projectItems.push({ id, projectId, issueNumber });
      return id;
    });
  }

  async readItemFieldValue(_projectId: string, itemId: string, fieldId: string): Promise<string | null> {
    return this.guard("readItemFieldValue", () => this.itemFieldValues.get(`${itemId}:${fieldId}`) ?? null);
  }

  async setItemFieldValue(_projectId: string, itemId: string, fieldId: string, optionId: string | null): Promise<void> {
    return this.guard("setItemFieldValue", () => {
      if (optionId === null) this.itemFieldValues.delete(`${itemId}:${fieldId}`);
      else this.itemFieldValues.set(`${itemId}:${fieldId}`, optionId);
    });
  }

  /** Test convenience: the option name currently set on an item's field. */
  fieldValueName(itemId: string, projectId: string, fieldName: string): string | null {
    const field = (this.projectFields.get(projectId) ?? []).find((candidate) => candidate.name === fieldName);
    if (field === undefined) return null;
    const optionId = this.itemFieldValues.get(`${itemId}:${field.id}`);
    if (optionId === undefined) return null;
    return field.options.find((option) => option.id === optionId)?.name ?? null;
  }

  readWikiPage(name: string): Promise<GitHubWikiPage | null> {
    return this.guard("readWikiPage", () => {
      const body = this.wikiPages.get(name);
      return body === undefined ? null : { name, body };
    });
  }

  writeWikiPage(name: string, body: string): Promise<void> {
    return this.guard("writeWikiPage", () => {
      this.wikiPages.set(name, body);
    });
  }
}
