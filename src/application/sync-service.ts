import { fail } from "../core/errors.js";
import { PROJECT_NEXT_STEPS, PROJECT_STATUSES, projectNextStepOf, projectStatusOf } from "../core/projection.js";
import {
  assertNoDuplicateMarkers,
  findByMarker,
  isManagedLabel,
  LABEL_COLORS,
  renderInitiativePage,
  renderInitiativesIndex,
  renderManagedSection,
  renderRunComment,
  renderWaveSection,
  runMarker,
  spliceInitiativesSection,
  spliceManagedSection,
  waveMarker,
  waveTitle,
  wikiPageName,
  workMarker,
  workPriorityLabel,
  workTitle,
  workTypeLabel,
} from "./sync/render.js";

export { workMarker } from "./sync/render.js";

const STATUS_FIELD = "Status";
const NEXT_STEP_FIELD = "Next Step";

import type { StateStore } from "../adapters/state-store.js";
import type { Work } from "../core/work.js";
import type { GitHubPort } from "./ports.js";

export interface ProjectConfig {
  owner: string;
  number: number;
}

export interface SyncReport {
  projectItems: { created: string[]; updated: string[] };
  wikiPages: { created: string[]; updated: string[] };
  milestones: { created: string[]; updated: string[] };
  issues: { created: string[]; updated: string[] };
  comments: { created: string[]; updated: string[] };
}

export interface SyncScope {
  workId?: string;
  initiativeId?: string;
}

/** What `project prepare` observed, said plainly enough to act on. */
export interface ProjectPreparation {
  configured: boolean;
  ready: boolean;
  project?: { owner: string; number: number; id: string };
  fields: { name: string; present: boolean; missingOptions: string[] }[];
  missing: string[];
  reason?: string;
}

export class SyncService {
  constructor(
    private readonly store: StateStore,
    private readonly github: GitHubPort,
    private readonly project?: ProjectConfig,
  ) {}

  /**
   * Reports whether the configured Project can receive the projection: access,
   * the two single-select fields, and every option the projection derives.
   * It observes and reports; it never creates remote state implicitly, so
   * running it twice says the same thing.
   */
  async prepareProject(): Promise<ProjectPreparation> {
    if (this.project === undefined) {
      return {
        configured: false,
        ready: false,
        fields: [],
        missing: ["codepatrol.json: github.project is absent or disabled"],
        reason: "no project configured",
      };
    }
    let resolved: { id: string; number: number };
    try {
      resolved = await this.github.resolveProject(this.project.owner, this.project.number);
    } catch (error) {
      return {
        configured: true,
        ready: false,
        fields: [],
        missing: [`project ${this.project.owner}/${this.project.number} is not accessible`],
        reason: error instanceof Error ? error.message : String(error),
      };
    }

    const expectations: { name: string; options: readonly string[] }[] = [
      { name: STATUS_FIELD, options: PROJECT_STATUSES },
      { name: NEXT_STEP_FIELD, options: PROJECT_NEXT_STEPS },
    ];
    const fields: ProjectPreparation["fields"] = [];
    const missing: string[] = [];
    for (const expectation of expectations) {
      const field = await this.github.resolveSingleSelectField(resolved.id, expectation.name);
      if (field === null) {
        fields.push({ name: expectation.name, present: false, missingOptions: [...expectation.options] });
        missing.push(`single-select field ${JSON.stringify(expectation.name)} does not exist`);
        continue;
      }
      const present = new Set(field.options.map((option) => option.name));
      const missingOptions = expectation.options.filter((option) => !present.has(option));
      fields.push({ name: expectation.name, present: true, missingOptions });
      for (const option of missingOptions) {
        missing.push(`field ${JSON.stringify(expectation.name)} lacks option ${JSON.stringify(option)}`);
      }
    }

    return {
      configured: true,
      ready: missing.length === 0,
      project: { owner: this.project.owner, number: this.project.number, id: resolved.id },
      fields,
      missing,
    };
  }

  async sync(scope: SyncScope = {}): Promise<SyncReport> {
    if (scope.workId !== undefined && scope.initiativeId !== undefined) {
      fail("INVALID_INPUT", "sync: provide at most one of workId and initiativeId");
    }
    const snapshot = await this.store.read();
    if (scope.workId !== undefined && !snapshot.works.has(scope.workId)) {
      fail("NOT_FOUND", `work ${scope.workId} does not exist`);
    }
    if (scope.initiativeId !== undefined) {
      const initiative = snapshot.initiatives.get(scope.initiativeId);
      if (initiative === undefined) fail("NOT_FOUND", `initiative ${scope.initiativeId} does not exist`);
      if (initiative.definitionState === "draft")
        fail("INVALID_STATE", `initiative ${scope.initiativeId} is draft; cannot sync`);
    }
    const report: SyncReport = {
      projectItems: { created: [], updated: [] },
      wikiPages: { created: [], updated: [] },
      milestones: { created: [], updated: [] },
      issues: { created: [], updated: [] },
      comments: { created: [], updated: [] },
    };

    let works: Work[];
    if (scope.workId !== undefined) {
      works = [snapshot.works.get(scope.workId) as Work];
    } else if (scope.initiativeId !== undefined) {
      works = [...snapshot.works.values()].filter((work) => work.initiative === scope.initiativeId);
    } else {
      works = [...snapshot.works.values()];
    }
    const initiativeIds = new Set(works.map((work) => work.initiative));
    const initiatives = [...snapshot.initiatives.values()]
      .filter(
        (initiative) =>
          (scope.workId === undefined && scope.initiativeId === undefined ? true : initiativeIds.has(initiative.id)) &&
          initiative.definitionState !== "draft",
      )
      .sort((a, b) => a.id.localeCompare(b.id));
    const allInitiatives = [...snapshot.initiatives.values()]
      .filter((initiative) => initiative.definitionState !== "draft")
      .sort((a, b) => Number(a.id.slice(5)) - Number(b.id.slice(5)));

    const initiativesPage = await this.github.readWikiPage("Initiatives");
    const desiredInitiativesPage = spliceInitiativesSection("", renderInitiativesIndex(allInitiatives));
    if (initiativesPage === null) {
      await this.github.writeWikiPage("Initiatives", desiredInitiativesPage);
      report.wikiPages.created.push("Initiatives");
    } else {
      const merged = spliceInitiativesSection(initiativesPage.body, renderInitiativesIndex(allInitiatives));
      if (merged !== initiativesPage.body) {
        await this.github.writeWikiPage("Initiatives", merged);
        report.wikiPages.updated.push("Initiatives");
      }
    }

    // Initiative -> Wiki page. The page is projection only; content outside the
    // managed markers is preserved.
    for (const initiative of initiatives) {
      const ownedWaves = [...snapshot.waves.values()]
        .filter((wave) => wave.initiative === initiative.id)
        .sort((a, b) => a.id.localeCompare(b.id));
      const ownedWorks = [...snapshot.works.values()]
        .filter((work) => work.initiative === initiative.id)
        .sort((a, b) => a.id.localeCompare(b.id));
      const name = wikiPageName(initiative);
      const desired = spliceManagedSection("", renderInitiativePage(initiative, ownedWaves, ownedWorks));
      const page = await this.github.readWikiPage(name);
      if (page === null) {
        await this.github.writeWikiPage(name, desired);
        report.wikiPages.created.push(initiative.id);
      } else {
        const merged = spliceManagedSection(page.body, renderInitiativePage(initiative, ownedWaves, ownedWorks));
        if (merged !== page.body) {
          await this.github.writeWikiPage(name, merged);
          report.wikiPages.updated.push(initiative.id);
        }
      }
    }

    // Wave -> Milestone. A Work's Issue associates to the milestone of its own Wave.
    const waveIds = new Set(works.map((work) => work.wave));
    const waves = [...snapshot.waves.values()]
      .filter((wave) => (scope.workId === undefined && scope.initiativeId === undefined ? true : waveIds.has(wave.id)))
      .filter((wave) => initiatives.some((initiative) => initiative.id === wave.initiative))
      .sort((a, b) => a.id.localeCompare(b.id));

    const milestones = await this.github.listMilestones();
    const milestoneNumbers = new Map<string, number>();
    for (const wave of waves) {
      const marker = waveMarker(wave.id);
      const title = waveTitle(wave);
      const owned = [...snapshot.works.values()]
        .filter((work) => work.wave === wave.id)
        .sort((a, b) => a.id.localeCompare(b.id));
      const stored = owned.find((work) => work.github.milestone !== undefined)?.github.milestone;
      assertNoDuplicateMarkers(milestones, marker, "milestones");
      let existing = stored !== undefined ? milestones.find((m) => m.number === stored) : undefined;
      if (existing !== undefined && !existing.body.includes(marker)) existing = undefined;
      existing ??= milestones.find((m) => m.body.includes(marker));

      const closed = owned.length > 0 && owned.every((work) => work.completion !== null);
      const desiredBody = spliceManagedSection(existing?.body ?? "", renderWaveSection(wave, owned));

      if (existing === undefined) {
        const created = await this.github.createMilestone({ title, body: desiredBody });
        if (closed) await this.github.updateMilestone(created.number, { state: "closed" });
        milestoneNumbers.set(wave.id, created.number);
        report.milestones.created.push(wave.id);
      } else {
        const update: { title?: string; body?: string; state?: "open" | "closed" } = {};
        if (existing.title !== title) update.title = title;
        if (existing.body !== desiredBody) update.body = desiredBody;
        if (existing.state !== (closed ? "closed" : "open")) update.state = closed ? "closed" : "open";
        if (Object.keys(update).length > 0) {
          await this.github.updateMilestone(existing.number, update);
          report.milestones.updated.push(wave.id);
        }
        milestoneNumbers.set(wave.id, existing.number);
      }
    }

    const issues = await this.github.listIssues();
    const associations = new Map<string, { milestone?: number; issue?: number }>();

    for (const work of works) {
      const milestone = milestoneNumbers.get(work.wave) ?? null;
      const managedLabels = [workTypeLabel(work), workPriorityLabel(work)];
      for (const label of managedLabels) {
        await this.github.ensureLabel(label, LABEL_COLORS[label] ?? "ededed");
      }
      const marker = workMarker(work.id);
      const title = workTitle(work);
      const desiredState = work.completion !== null ? "closed" : "open";

      assertNoDuplicateMarkers(issues, marker, "issues");
      let existing =
        work.github.issue !== undefined ? issues.find((issue) => issue.number === work.github.issue) : undefined;
      if (existing !== undefined && !existing.body.includes(marker)) existing = undefined;
      existing ??= issues.find((issue) => issue.body.includes(marker));

      let issueNumber: number;
      if (existing === undefined) {
        const body = spliceManagedSection("", renderManagedSection(work));
        const created = await this.github.createIssue({ title, body, labels: managedLabels, milestone });
        if (desiredState === "closed") await this.github.updateIssue(created.number, { state: "closed" });
        issueNumber = created.number;
        report.issues.created.push(work.id);
      } else {
        issueNumber = existing.number;
        const desiredBody = spliceManagedSection(existing.body, renderManagedSection(work));
        const desiredLabels = [...existing.labels.filter((label) => !isManagedLabel(label)), ...managedLabels];
        const labelsChanged =
          desiredLabels.length !== existing.labels.length ||
          desiredLabels.some((label) => !existing.labels.includes(label));
        const update: {
          title?: string;
          body?: string;
          labels?: string[];
          milestone?: number | null;
          state?: "open" | "closed";
        } = {};
        if (existing.title !== title) update.title = title;
        if (existing.body !== desiredBody) update.body = desiredBody;
        if (labelsChanged) update.labels = desiredLabels;
        if (existing.milestone !== milestone) update.milestone = milestone;
        if (existing.state !== desiredState) update.state = desiredState;
        if (Object.keys(update).length > 0) {
          await this.github.updateIssue(issueNumber, update);
          report.issues.updated.push(work.id);
        }
      }

      const comments = await this.github.listComments(issueNumber);
      for (const attempt of work.attempts) {
        const marker = runMarker(attempt.runId);
        const rendered = renderRunComment(attempt);
        const existingComment = findByMarker(comments, marker, "comments");
        if (existingComment === undefined) {
          await this.github.createComment(issueNumber, rendered);
          report.comments.created.push(attempt.runId);
        } else if (existingComment.body !== rendered) {
          await this.github.updateComment(existingComment.id, rendered);
          report.comments.updated.push(attempt.runId);
        }
      }

      const association: { milestone?: number; issue?: number } = {};
      if (milestone !== null) association.milestone = milestone;
      association.issue = issueNumber;
      associations.set(work.id, association);
    }

    await this.store.transact((current) => {
      const changes = new Map<string, Work>();
      for (const [id, association] of associations) {
        const work = current.works.get(id);
        if (work === undefined) continue;
        if (work.github.issue === association.issue && work.github.milestone === association.milestone) continue;
        changes.set(id, { ...work, github: association });
      }
      if (changes.size === 0) return { message: "codepatrol: sync noop" };
      return { message: "codepatrol: sync github associations", works: changes };
    });

    await this.syncProjectItems(works, associations, report);

    return report;
  }

  /**
   * Projects each Work Issue as a Project item and converges Status and Next
   * Step from the locally derived values. Remote ids are looked up every run,
   * never persisted: local state is the only authority.
   */
  private async syncProjectItems(
    works: Work[],
    associations: ReadonlyMap<string, { milestone?: number; issue?: number }>,
    report: SyncReport,
  ): Promise<void> {
    if (this.project === undefined) return;

    const project = await this.github.resolveProject(this.project.owner, this.project.number);

    let status = await this.github.resolveSingleSelectField(project.id, STATUS_FIELD);
    if (status === null) {
      status = await this.github.createSingleSelectField(project.id, STATUS_FIELD, [...PROJECT_STATUSES]);
    } else {
      const missing = PROJECT_STATUSES.filter(
        (option) => !status!.options.some((existing) => existing.name === option),
      );
      if (missing.length > 0) status = await this.github.addFieldOptions(project.id, status, missing);
    }

    let nextStep = await this.github.resolveSingleSelectField(project.id, NEXT_STEP_FIELD);
    if (nextStep === null) {
      nextStep = await this.github.createSingleSelectField(project.id, NEXT_STEP_FIELD, [...PROJECT_NEXT_STEPS]);
    } else {
      const missing = PROJECT_NEXT_STEPS.filter(
        (option) => !nextStep!.options.some((existing) => existing.name === option),
      );
      if (missing.length > 0) nextStep = await this.github.addFieldOptions(project.id, nextStep, missing);
    }

    const optionId = (field: { options: { id: string; name: string }[] }, name: string | null): string | null =>
      name === null ? null : (field.options.find((option) => option.name === name)?.id ?? null);

    for (const work of works) {
      const issueNumber = associations.get(work.id)?.issue;
      if (issueNumber === undefined) continue;

      let itemId = await this.github.findProjectItem(project.id, issueNumber);
      let created = false;
      if (itemId === null) {
        itemId = await this.github.addProjectItem(project.id, issueNumber);
        created = true;
      }

      const desiredStatus = optionId(status, projectStatusOf(work));
      const desiredNextStep = optionId(nextStep, projectNextStepOf(work));
      const currentStatus = created ? null : await this.github.readItemFieldValue(project.id, itemId, status.id);
      const currentNextStep = created ? null : await this.github.readItemFieldValue(project.id, itemId, nextStep.id);

      let changed = created;
      // Local state always wins: a manually changed field is corrected.
      if (currentStatus !== desiredStatus) {
        await this.github.setItemFieldValue(project.id, itemId, status.id, desiredStatus);
        changed = true;
      }
      if (currentNextStep !== desiredNextStep) {
        await this.github.setItemFieldValue(project.id, itemId, nextStep.id, desiredNextStep);
        changed = true;
      }

      if (created) report.projectItems.created.push(work.id);
      else if (changed) report.projectItems.updated.push(work.id);
    }
  }
}
