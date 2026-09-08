import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { loadConfig } from "./config.js";
import { canonicalJson, contentDigest, type TaskInput } from "./contracts.js";
import type { RunState } from "./domain.js";
import {
  type GitHubRestAdapter,
  GitHubRestClient,
  type IssueWrite,
  type MilestoneWrite,
} from "./github-rest.js";
import { type GitHubWikiAdapter, GitHubWikiClient } from "./github-wiki.js";
import { runProcess } from "./rpc.js";
import { readRuns, withStateLock } from "./state.js";

type Counts = { created: number; updated: number; unchanged: number };
type Projected = {
  kind: "init" | "wave" | "work";
  marker: string;
  title: string;
  body: string;
  state: "open" | "closed";
  dueOn?: string;
  init: string;
  wave?: string;
};
const identity = (kind: string, keys: string[]) =>
  createHash("sha256")
    .update(`codepatrol\0v1\0github\0${kind}\0${keys.join("\0")}`)
    .digest("hex");
const marker = (kind: string, keys: string[]) =>
  `<!-- codepatrol:v1:github:${identity(kind, keys)} -->`;
const block = (value: Projected) =>
  `${value.marker}\n<!-- codepatrol:BEGIN -->\nStatus: ${value.state}\n${value.body}\n<!-- codepatrol:END -->`;
const merge = (body: string | null, rendered: string, marker: string) => {
  const begin = "<!-- codepatrol:BEGIN -->";
  const end = "<!-- codepatrol:END -->";
  const current = body ?? "";
  const start = current.indexOf(marker);
  const managedStart = start >= 0 ? start : current.indexOf(begin);
  const finish = current.indexOf(end, managedStart);
  return managedStart >= 0 && finish >= managedStart
    ? `${current.slice(0, managedStart)}${rendered}${current.slice(finish + end.length)}`
    : current
      ? `${current}\n\n${rendered}`
      : rendered;
};
const tracked = (state: RunState) => state.input.tracking;
const metadata = (input: TaskInput) => canonicalJson(input.tracking);
const acceptance = (state: RunState) =>
  state.stages.find((stage) => stage.stage === "build-review")?.result?.acceptance;

/** Pure, deterministic projection of durable tracked run state. */
export function projectGitHub(states: RunState[]): Projected[] {
  const groups = new Map<string, RunState[]>();
  for (const state of states) {
    const value = tracked(state);
    if (!value) continue;
    const key = `${value.init.key}\0${value.wave.key}\0${value.work.key}`;
    const prior = groups.get(key) ?? [];
    prior.push(state);
    groups.set(key, prior);
  }
  const values: Projected[] = [];
  const waves = new Map<string, RunState[]>();
  const inits = new Map<string, RunState[]>();
  for (const statesForWork of groups.values()) {
    const first = statesForWork[0] as RunState;
    const tracking = first.input.tracking;
    if (!tracking) throw new Error("Tracked state identity mismatch");
    if (statesForWork.some((state) => metadata(state.input) !== metadata(first.input)))
      throw new Error(
        `Tracking metadata conflict for ${tracking.init.key}/${tracking.wave.key}/${tracking.work.key}`,
      );
    const selected = [...statesForWork].sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.runId.localeCompare(b.runId),
    );
    const chosen =
      selected.filter((state) => state.status === "approved").at(-1) ?? selected.at(-1);
    if (!chosen) throw new Error("Tracked state identity mismatch");
    const waveKey = `${tracking.init.key}\0${tracking.wave.key}`;
    const initStates = inits.get(tracking.init.key) ?? [];
    initStates.push(first);
    inits.set(tracking.init.key, initStates);
    const waveStates = waves.get(waveKey) ?? [];
    waveStates.push(chosen);
    waves.set(waveKey, waveStates);
    const results = acceptance(chosen);
    values.push({
      kind: "work",
      marker: marker("work", [tracking.init.key, tracking.wave.key, tracking.work.key]),
      title: tracking.work.title,
      body: `Acceptance:\n${tracking.work.acceptance
        .map((item) => {
          const result = results?.find((value) => value.key === item.key);
          return `- ${item.key}: ${item.text}${result ? ` [${result.status}: ${result.summary}]` : ""}`;
        })
        .join("\n")}`,
      state: chosen.status === "approved" ? "closed" : "open",
      init: tracking.init.key,
      wave: tracking.wave.key,
    });
  }
  for (const [waveKey, statesForWave] of waves) {
    const first = statesForWave[0] as RunState;
    const tracking = first.input.tracking;
    if (!tracking) throw new Error("Tracked state identity mismatch");
    if (
      statesForWave.some((state) => {
        const other = state.input.tracking;
        if (!other) throw new Error("Tracked state identity mismatch");
        return (
          other.wave.title !== tracking.wave.title ||
          other.wave.dueOn !== tracking.wave.dueOn
        );
      })
    )
      throw new Error(`Tracking metadata conflict for ${waveKey}`);
    values.push({
      kind: "wave",
      marker: marker("wave", [tracking.init.key, tracking.wave.key]),
      title: tracking.wave.title,
      body: `Init: ${tracking.init.title}`,
      state: statesForWave.every((state) => state.status === "approved")
        ? "closed"
        : "open",
      dueOn: tracking.wave.dueOn,
      init: tracking.init.key,
      wave: tracking.wave.key,
    });
  }
  for (const [initKey, statesForInit] of inits) {
    const first = statesForInit[0] as RunState;
    const tracking = first.input.tracking;
    if (!tracking) throw new Error("Tracked state identity mismatch");
    if (
      statesForInit.some((state) => {
        const other = state.input.tracking;
        if (!other) throw new Error("Tracked state identity mismatch");
        return (
          other.init.title !== tracking.init.title ||
          other.init.brief !== tracking.init.brief
        );
      })
    )
      throw new Error(`Tracking metadata conflict for ${initKey}`);
    values.push({
      kind: "init",
      marker: marker("init", [initKey]),
      title: tracking.init.title,
      body: tracking.init.brief,
      state: "open",
      init: initKey,
    });
  }
  return values.sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.marker.localeCompare(b.marker),
  );
}

export interface RemoteSyncDependencies {
  rest?: GitHubRestAdapter;
  wiki?: GitHubWikiAdapter;
}
export interface RemoteSyncResult {
  version: "1.0";
  repo: string;
  dryRun: boolean;
  digest: string;
  counts: { wiki: Counts; milestones: Counts; issues: Counts };
}
const empty = (): Counts => ({ created: 0, updated: 0, unchanged: 0 });
export async function syncRemote(
  options: { root: string; config?: string; dryRun?: boolean },
  deps: RemoteSyncDependencies = {},
): Promise<RemoteSyncResult> {
  const root = await realpath(options.root);
  const config = await loadConfig({ root, config: options.config });
  const github = config.remote?.github;
  if (!github) throw new Error("GitHub remote configuration is required");
  const repository =
    github.repository ??
    (
      await runProcess(["git", "config", "--get", `remote.${github.gitRemote}.url`], {
        cwd: root,
        limits: config.limits,
      })
    )
      .trim()
      .replace(/^git@github\.com:/, "")
      .replace(/^https:\/\/github\.com\//, "")
      .replace(/\.git$/, "");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))
    throw new Error("Cannot infer a GitHub repository from configured git remote");
  const token = process.env[github.tokenEnv];
  if (!token)
    throw new Error(
      `GitHub token environment variable is required: ${github.tokenEnv}`,
    );
  const rest = deps.rest ?? new GitHubRestClient(repository, token);
  const wiki = deps.wiki ?? new GitHubWikiClient(repository, token);
  return withStateLock(root, async () => {
    try {
      if (!(await rest.preflight()).hasWiki)
        throw new Error("GitHub Wiki must be initialized with Home before sync");
      const projection = projectGitHub(await readRuns(root));
      // Clone/inspect first: no REST mutation can occur before the required wiki mapping is viable.
      for (const item of projection.filter((item) => item.kind === "init")) {
        const matches = await wiki.inspect(item.marker);
        if (matches.length > 1)
          throw new Error(`Duplicate GitHub wiki marker: ${item.marker}`);
      }
      const counts = { wiki: empty(), milestones: empty(), issues: empty() };
      const record = (counts: Counts, result: "created" | "updated" | "unchanged") => {
        counts[result] += 1;
      };
      for (const item of projection.filter((item) => item.kind === "init")) {
        if (options.dryRun) counts.wiki.unchanged += 1;
        else
          record(
            counts.wiki,
            await wiki.upsert({
              marker: item.marker,
              path: `CodePatrol-Init-${item.init}.md`,
              title: item.title,
              body: block(item),
            }),
          );
      }
      const milestones = await rest.listMilestones();
      for (const item of projection.filter((item) => item.kind === "wave")) {
        const found = milestones.filter((value) =>
          (value.description ?? "").includes(item.marker),
        );
        if (found.length > 1)
          throw new Error(`Duplicate GitHub milestone marker: ${item.marker}`);
        const write: MilestoneWrite = {
          title: item.title,
          description: block(item),
          state: item.state,
          due_on: item.dueOn ? `${item.dueOn}T00:00:00Z` : null,
        };
        const existing = found[0];
        if (!existing) {
          if (options.dryRun) counts.milestones.unchanged += 1;
          else {
            await rest.createMilestone(write);
            counts.milestones.created += 1;
          }
        } else if (
          existing.title === write.title &&
          existing.description === write.description &&
          existing.state === write.state &&
          (existing.due_on ?? null) === write.due_on
        )
          counts.milestones.unchanged += 1;
        else if (options.dryRun) counts.milestones.unchanged += 1;
        else {
          await rest.updateMilestone(existing.number, write);
          counts.milestones.updated += 1;
        }
      }
      const refreshed = await rest.listMilestones();
      const issues = await rest.listIssues();
      for (const item of projection.filter((item) => item.kind === "work")) {
        const milestone = refreshed.find((value) =>
          (value.description ?? "").includes(
            marker("wave", [item.init, item.wave ?? ""]),
          ),
        )?.number;
        if (!milestone)
          throw new Error(`Missing GitHub milestone for ${item.init}/${item.wave}`);
        const found = issues.filter((value) =>
          (value.body ?? "").includes(item.marker),
        );
        if (found.length > 1)
          throw new Error(`Duplicate GitHub issue marker: ${item.marker}`);
        const write: IssueWrite = {
          title: item.title,
          body: merge(found[0]?.body ?? null, block(item), item.marker),
          milestone,
          state: item.state,
          ...(item.state === "closed" ? { state_reason: "completed" as const } : {}),
        };
        const existing = found[0];
        if (!existing) {
          if (options.dryRun) counts.issues.unchanged += 1;
          else {
            await rest.createIssue(write);
            counts.issues.created += 1;
          }
        } else if (
          existing.title === write.title &&
          existing.body === write.body &&
          existing.milestone?.number === milestone &&
          existing.state === write.state
        )
          counts.issues.unchanged += 1;
        else if (options.dryRun) counts.issues.unchanged += 1;
        else {
          await rest.updateIssue(existing.number, write);
          counts.issues.updated += 1;
        }
      }
      return {
        version: "1.0",
        repo: repository,
        dryRun: options.dryRun === true,
        digest: contentDigest(projection),
        counts,
      };
    } finally {
      await wiki.close();
    }
  });
}
