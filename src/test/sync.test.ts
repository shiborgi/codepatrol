import assert from "node:assert/strict";
import test from "node:test";
import type {
  GitHubComment,
  GitHubIssue,
  GitHubMilestone,
  GitHubPort,
  GitHubWikiPage,
  ProjectRef,
  ProjectSingleSelectField,
} from "../application/ports.js";
import { SyncService, workMarker } from "../application/sync-service.js";
import { initiativeStatus } from "../core/initiative.js";
import { createApp, documentOf } from "./support/app.js";
import { FakeGitHub } from "./support/github.js";
import { createRepo } from "./support/repo.js";

class LagSimulatingGitHub implements GitHubPort {
  wikiPages = new Map<string, string>();
  private createdMilestones = new Set<number>();

  async readWikiPage(name: string): Promise<GitHubWikiPage | null> {
    const body = this.wikiPages.get(name);
    return body === undefined ? null : { name, body };
  }

  async writeWikiPage(name: string, body: string): Promise<void> {
    this.wikiPages.set(name, body);
  }

  // This fake exists to simulate list read-after-write lag; it declares no
  // project, so the Project projection is skipped entirely.
  async resolveProject(owner: string, number: number): Promise<ProjectRef> {
    throw new Error(`project ${owner}/${number} not configured in this fake`);
  }
  async resolveSingleSelectField(): Promise<ProjectSingleSelectField | null> {
    return null;
  }
  async createSingleSelectField(): Promise<ProjectSingleSelectField> {
    throw new Error("not supported");
  }
  async addFieldOptions(): Promise<ProjectSingleSelectField> {
    throw new Error("not supported");
  }
  async findProjectItem(): Promise<string | null> {
    return null;
  }
  async addProjectItem(): Promise<string> {
    throw new Error("not supported");
  }
  async readItemFieldValue(): Promise<string | null> {
    return null;
  }
  async setItemFieldValue(): Promise<void> {
    throw new Error("not supported");
  }

  private createdIssues = new Set<number>();
  private createdComments = new Set<number>();

  constructor(private readonly inner: FakeGitHub) {}

  resetCreated(): void {
    this.createdMilestones.clear();
    this.createdIssues.clear();
    this.createdComments.clear();
  }

  async listMilestones(): Promise<GitHubMilestone[]> {
    const all = await this.inner.listMilestones();
    return all.filter((m) => !this.createdMilestones.has(m.number));
  }

  async createMilestone(input: { title: string; body: string }): Promise<GitHubMilestone> {
    const created = await this.inner.createMilestone(input);
    this.createdMilestones.add(created.number);
    return created;
  }

  updateMilestone(number: number, input: { title?: string; body?: string; state?: "open" | "closed" }): Promise<void> {
    return this.inner.updateMilestone(number, input);
  }

  async listIssues(): Promise<GitHubIssue[]> {
    const all = await this.inner.listIssues();
    return all.filter((i) => !this.createdIssues.has(i.number));
  }

  async createIssue(input: {
    title: string;
    body: string;
    labels: string[];
    milestone: number | null;
  }): Promise<GitHubIssue> {
    const created = await this.inner.createIssue(input);
    this.createdIssues.add(created.number);
    return created;
  }

  updateIssue(
    number: number,
    input: { title?: string; body?: string; labels?: string[]; milestone?: number | null; state?: "open" | "closed" },
  ): Promise<void> {
    return this.inner.updateIssue(number, input);
  }

  async listComments(issueNumber: number): Promise<GitHubComment[]> {
    const all = await this.inner.listComments(issueNumber);
    return all.filter((c) => !this.createdComments.has(c.id));
  }

  async createComment(issueNumber: number, body: string): Promise<GitHubComment> {
    const created = await this.inner.createComment(issueNumber, body);
    this.createdComments.add(created.id);
    return created;
  }

  updateComment(id: number, body: string): Promise<void> {
    return this.inner.updateComment(id, body);
  }

  ensureLabel(name: string, color: string): Promise<void> {
    return this.inner.ensureLabel(name, color);
  }
}

test("sync creates milestone, issue and labels; repeated sync creates no duplicates", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    const github = new FakeGitHub();
    const sync = new SyncService(app.store, github);

    const { runId } = await app.specStart("INIT-1");
    await app.specComplete("INIT-1", runId, "apply", documentOf());
    await app.start("WORK-1.1.1", "plan");

    const first = await sync.sync();
    assert.equal(first.milestones.created.length, 1);
    assert.equal(first.issues.created.length, 1);
    assert.equal(first.comments.created.length, 1);

    const second = await sync.sync();
    assert.equal(second.milestones.created.length, 0);
    assert.equal(second.milestones.updated.length, 0);
    assert.equal(second.issues.created.length, 0);
    assert.equal(second.issues.updated.length, 0);
    assert.equal(second.comments.created.length, 0);
    assert.equal(second.comments.updated.length, 0);

    assert.equal(github.milestones.length, 1);
    assert.equal(github.issues.length, 1);
    assert.equal(github.comments.get(1)?.length, 1);
    assert.equal(github.milestones[0]?.title, "WAVE-1.1: Wave WAVE-1.1", "the milestone represents the Wave");
    assert.equal(github.issues[0]?.title, "WORK-1.1.1: First work");
    assert.equal(github.issues[0]?.milestone, 1);
    assert.ok(github.labels.has("codepatrol:type/task"));
    assert.ok(github.labels.has("codepatrol:priority/p2"));
  } finally {
    repo.cleanup();
  }
});

test("sync --work with an unknown work fails with NOT_FOUND", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    const { runId } = await app.specStart("INIT-1");
    await app.specComplete("INIT-1", runId, "apply", documentOf());
    const sync = new SyncService(app.store, new FakeGitHub());
    await assert.rejects(sync.sync({ workId: "WORK-9.1.9" }), /does not exist/);
  } finally {
    repo.cleanup();
  }
});

test("renaming updates objects matched by marker; unmanaged labels and user content are preserved", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    const github = new FakeGitHub();
    const sync = new SyncService(app.store, github);

    const run1 = await app.specStart("INIT-1");
    await app.specComplete("INIT-1", run1.runId, "apply", documentOf());
    await sync.sync();

    const issue = github.issues[0];
    assert.ok(issue !== undefined);
    issue.labels.push("triage");
    issue.body = `My own notes stay here.\n\n${issue.body}`;

    const run2 = await app.specStart("INIT-1");
    await app.specComplete(
      "INIT-1",
      run2.runId,
      "apply",
      documentOf({
        id: "INIT-1",
        title: "Renamed initiative",
        works: [
          {
            id: "WORK-1.1.1",
            wave: "WAVE-1.1",
            title: "Renamed work",
            description: "New description",
            workType: "feature",
            priority: "p1",
            delivery: "no-code",
            acceptance: ["a", "b"],
            blockedBy: [],
          },
        ],
      }),
    );
    const report = await sync.sync();

    assert.equal(report.milestones.created.length, 0);
    assert.equal(report.issues.created.length, 0);
    assert.equal(github.milestones.length, 1);
    assert.equal(github.issues.length, 1);
    assert.equal(
      github.milestones[0]?.title,
      "WAVE-1.1: Wave WAVE-1.1",
      "the milestone tracks its Wave, not the Initiative title",
    );
    assert.equal(issue.title, "WORK-1.1.1: Renamed work");
    assert.ok(issue.labels.includes("triage"), "unmanaged label preserved");
    assert.ok(issue.labels.includes("codepatrol:type/feature"));
    assert.ok(!issue.labels.includes("codepatrol:type/task"), "obsolete managed label removed");
    assert.ok(issue.body.startsWith("My own notes stay here."), "user content preserved");
    assert.ok(issue.body.includes("<!-- codepatrol:work:start -->"));
    assert.ok(issue.body.includes("New description"));
    assert.ok(issue.body.includes("- a\n- b"), "acceptance criteria updated");
  } finally {
    repo.cleanup();
  }
});

test("blocker changes update the managed section exactly", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    const github = new FakeGitHub();
    const sync = new SyncService(app.store, github);
    const run1 = await app.specStart("INIT-1");
    await app.specComplete(
      "INIT-1",
      run1.runId,
      "apply",
      documentOf({
        works: [
          {
            id: "WORK-1.1.1",
            wave: "WAVE-1.1",
            title: "A",
            description: "a",
            workType: "task",
            priority: "p2",
            delivery: "no-code",
            acceptance: [],
            blockedBy: [],
          },
          {
            id: "WORK-1.1.2",
            wave: "WAVE-1.1",
            title: "B",
            description: "b",
            workType: "task",
            priority: "p2",
            delivery: "no-code",
            acceptance: [],
            blockedBy: [],
          },
        ],
      }),
    );
    await sync.sync();
    const issue = github.issues.find((candidate) => candidate.body.includes(workMarker("WORK-1.1.2")));
    assert.ok(issue !== undefined);
    assert.ok(!issue.body.includes("Blocked by"));

    const run2 = await app.specStart("INIT-1");
    await app.specComplete(
      "INIT-1",
      run2.runId,
      "apply",
      documentOf({
        id: "INIT-1",
        title: "Test initiative",
        works: [
          {
            id: "WORK-1.1.1",
            wave: "WAVE-1.1",
            title: "A",
            description: "a",
            workType: "task",
            priority: "p2",
            delivery: "no-code",
            acceptance: [],
            blockedBy: [],
          },
          {
            id: "WORK-1.1.2",
            wave: "WAVE-1.1",
            title: "B",
            description: "b",
            workType: "task",
            priority: "p2",
            delivery: "no-code",
            acceptance: [],
            blockedBy: ["WORK-1.1.1"],
          },
        ],
      }),
    );
    await sync.sync();
    assert.ok(issue.body.includes("Blocked by: WORK-1.1.1"));
  } finally {
    repo.cleanup();
  }
});

test("stale persisted association is recovered by marker and persisted back", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    const github = new FakeGitHub();
    const sync = new SyncService(app.store, github);
    const { runId } = await app.specStart("INIT-1");
    await app.specComplete("INIT-1", runId, "apply", documentOf());
    await sync.sync();

    const snapshot = await app.store.read();
    assert.equal(snapshot.works.get("WORK-1.1.1")?.github.issue, 1);

    github.issues.push({ number: 2, title: "unrelated", body: "", state: "open", labels: [], milestone: null });
    await app.store.transact(() => ({
      message: "corrupt association",
      works: new Map([[`WORK-1.1.1`, { ...snapshot.works.get("WORK-1.1.1")!, github: { issue: 2 } }]]),
    }));

    const report = await sync.sync();
    assert.equal(report.issues.created.length, 0, "no duplicate issue");
    assert.equal(github.issues.length, 2);
    const after = await app.store.read();
    assert.equal(after.works.get("WORK-1.1.1")?.github.issue, 1, "association recovered by marker");
  } finally {
    repo.cleanup();
  }
});

test("sync adopts a remotely existing object when local association is missing", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    const github = new FakeGitHub();
    const sync = new SyncService(app.store, github);
    const { runId } = await app.specStart("INIT-1");
    await app.specComplete("INIT-1", runId, "apply", documentOf());
    await app.start("WORK-1.1.1", "plan");

    github.issues.push({
      number: 1,
      title: "WORK-1.1.1: First work",
      body: `${workMarker("WORK-1.1.1")}\n\n<!-- codepatrol:work:start -->\nDo the first thing\n<!-- codepatrol:work:end -->\n`,
      state: "open",
      labels: [],
      milestone: null,
    });

    const report = await sync.sync();
    assert.equal(report.issues.created.length, 0, "should adopt, not create");
    assert.equal(github.issues.length, 1);

    const snapshot = await app.store.read();
    assert.equal(snapshot.works.get("WORK-1.1.1")?.github.issue, 1, "association persisted");
  } finally {
    repo.cleanup();
  }
});

test("duplicate managed markers are refused", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    const github = new FakeGitHub();
    const sync = new SyncService(app.store, github);
    const { runId } = await app.specStart("INIT-1");
    await app.specComplete("INIT-1", runId, "apply", documentOf());
    await sync.sync();
    const issue = github.issues[0];
    assert.ok(issue !== undefined);
    github.issues.push({ ...issue, number: 2 });
    await assert.rejects(sync.sync(), /multiple issues carry marker.*numbers 1, 2/);
  } finally {
    repo.cleanup();
  }
});

test("terminal work closes its issue; completed initiative closes its milestone", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    const github = new FakeGitHub();
    const sync = new SyncService(app.store, github);
    const { runId } = await app.specStart("INIT-1");
    await app.specComplete("INIT-1", runId, "apply", documentOf());
    await sync.sync();
    assert.equal(github.issues[0]?.state, "open");
    assert.equal(github.milestones[0]?.state, "open");

    for (const stage of ["plan", "review", "build", "verify"] as const) {
      await app.runStage("WORK-1.1.1", stage, "continue");
    }
    await app.runStage("WORK-1.1.1", "ship", "accept", { authority: "tester" });
    await sync.sync();

    assert.equal(github.issues[0]?.state, "closed", "terminal work closes its issue");
    assert.equal(github.milestones[0]?.state, "closed", "a Wave whose Works are all terminal closes its milestone");

    const snapshot = await app.store.read();
    const initiative = snapshot.initiatives.get("INIT-1");
    assert.ok(initiative !== undefined);
    assert.equal(initiativeStatus(initiative, [...snapshot.works.values()]), "completed");
  } finally {
    repo.cleanup();
  }
});

test("run comment starts with the todo list and is reconciled with the result", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    const github = new FakeGitHub();
    const sync = new SyncService(app.store, github);

    const { runId } = await app.specStart("INIT-1");
    await app.specComplete("INIT-1", runId, "apply", documentOf());
    const started = await app.start("WORK-1.1.1", "plan");
    await sync.sync();

    const issue = github.issues[0];
    assert.ok(issue !== undefined);
    const comment = github.comments.get(issue.number)?.[0];
    assert.ok(comment !== undefined);
    assert.ok(comment.body.includes(`<!-- codepatrol:run:${started.attempt.runId} -->`));
    assert.ok(comment.body.includes("- [ ] t1: do one"));
    assert.ok(!comment.body.includes("#### Result"));

    await app.complete("WORK-1.1.1", "plan", "continue");
    await sync.sync();

    const comments = github.comments.get(issue.number) ?? [];
    assert.equal(comments.length, 1);
    assert.ok(comments[0]?.body.includes("- [x] t1: do one"));
    assert.ok(comments[0]?.body.includes("#### Result"));
    assert.ok(comments[0]?.body.includes("Decision: continue"));
  } finally {
    repo.cleanup();
  }
});

test("github failure does not lose local state; a later sync converges", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    const github = new FakeGitHub();
    const sync = new SyncService(app.store, github);

    const { runId } = await app.specStart("INIT-1");
    await app.specComplete("INIT-1", runId, "apply", documentOf());
    await app.start("WORK-1.1.1", "plan");
    const stateBefore = repo.headCommit("refs/codepatrol/state");

    github.failNext();
    await assert.rejects(sync.sync(), /injected GitHub failure/);
    assert.equal(repo.headCommit("refs/codepatrol/state"), stateBefore);

    const recovered = await sync.sync();
    assert.equal(recovered.issues.created.length, 1);
    assert.equal(github.issues.length, 1);
  } finally {
    repo.cleanup();
  }
});

test("mid-sync failure persists only resolved associations; next sync converges", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    const github = new FakeGitHub();
    const sync = new SyncService(app.store, github);
    const { runId } = await app.specStart("INIT-1");
    await app.specComplete(
      "INIT-1",
      runId,
      "apply",
      documentOf({
        works: [
          {
            id: "WORK-1.1.1",
            wave: "WAVE-1.1",
            title: "A",
            description: "a",
            workType: "task",
            priority: "p2",
            delivery: "no-code",
            acceptance: [],
            blockedBy: [],
          },
          {
            id: "WORK-1.1.2",
            wave: "WAVE-1.1",
            title: "B",
            description: "b",
            workType: "task",
            priority: "p2",
            delivery: "no-code",
            acceptance: [],
            blockedBy: [],
          },
        ],
      }),
    );

    github.failAfter(3);
    await assert.rejects(sync.sync(), /injected GitHub failure/);
    const snapshot = await app.store.read();
    for (const work of snapshot.works.values()) {
      assert.equal(work.github.issue, undefined, "no partial associations persisted");
    }

    github.clearFailure();
    const report = await sync.sync();
    assert.equal(report.issues.created.length, 2);
    assert.equal(github.issues.length, 2);
    const after = await app.store.read();
    for (const work of after.works.values()) {
      assert.ok(work.github.issue !== undefined);
    }
  } finally {
    repo.cleanup();
  }
});

test("sync copes with more than 100 pre-existing issues", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    const github = new FakeGitHub();
    for (let index = 0; index < 150; index += 1) {
      github.issues.push({
        number: index + 1,
        title: `noise ${index}`,
        body: "",
        state: "open",
        labels: [],
        milestone: null,
      });
    }
    github.setNextIssueNumber(151);
    const sync = new SyncService(app.store, github);
    const { runId } = await app.specStart("INIT-1");
    await app.specComplete("INIT-1", runId, "apply", documentOf());
    const report = await sync.sync();
    assert.equal(report.issues.created.length, 1);
    assert.equal(github.issues.length, 151);
    const created = github.issues.find((issue) => issue.body.includes(workMarker("WORK-1.1.1")));
    assert.ok(created !== undefined);
  } finally {
    repo.cleanup();
  }
});

test("sync tolerates read-after-write lag after creates", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    const github = new LagSimulatingGitHub(new FakeGitHub());
    const sync = new SyncService(app.store, github);

    const { runId } = await app.specStart("INIT-1");
    await app.specComplete("INIT-1", runId, "apply", documentOf());
    await app.start("WORK-1.1.1", "plan");

    const first = await sync.sync();
    assert.equal(first.milestones.created.length, 1);
    assert.equal(first.issues.created.length, 1);
    assert.equal(first.comments.created.length, 1);

    const snapshot = await app.store.read();
    assert.ok(snapshot.works.get("WORK-1.1.1")?.github.issue !== undefined, "association persisted");

    github.resetCreated();
    const second = await sync.sync();
    assert.equal(second.milestones.created.length, 0);
    assert.equal(second.issues.created.length, 0);
    assert.equal(second.comments.created.length, 0);
  } finally {
    repo.cleanup();
  }
});
