import { randomUUID } from "node:crypto";
import { lstat, mkdir, realpath } from "node:fs/promises";
import { userInfo } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { loadConfig } from "./config.js";
import {
  boundedJson,
  type Catalog,
  type Config,
  type Context,
  configSchema,
  inputSchema,
  MAX_PLAN_BYTES,
  MAX_STATE_BYTES,
  PayloadLimitError,
  type ResolvedAgent,
  relativePathSchema,
  STAGES,
  type Stage,
  type TaskInput,
} from "./contracts.js";
import type { ExecutionPlan, PlannedStage, RunState, StageRecord } from "./domain.js";
import { executeStage, verifyBuild } from "./executor.js";
import { syncRemote } from "./github-sync.js";
import { recallMemory, rememberMemory } from "./memorypatrol.js";
import { requireModelpatrolCredential } from "./modelpatrol.js";
import { getCatalog, getContext, resolveAgent } from "./providers.js";
import { selectRoute } from "./routing.js";
import { runProcess } from "./rpc.js";
import { readRun, saveRun, stateDirectory, withStateLock } from "./state.js";
import { readTelemetry, recordTelemetry, type TelemetryEvent } from "./telemetry.js";

async function prepare(raw: unknown, override?: Config) {
  const input = inputSchema.parse(raw);
  input.root = await realpath(input.root);
  const config = override ? configSchema.parse(override) : await loadConfig(input);
  return { input, config };
}

async function resolveStage(
  input: TaskInput,
  config: Config,
  catalog: Catalog,
  stage: Stage,
  history: TelemetryEvent[],
  agents: Map<string, ResolvedAgent>,
  overview: Context,
  contexts = new Map<string, Context>(),
): Promise<PlannedStage> {
  const route = selectRoute(catalog, stage, input.task, overview.signals, history);
  const contextKey = `${stage}:${route.contextProfile}`;
  let context = contexts.get(contextKey);
  if (!context) {
    context = await getContext(config, input, stage, route.contextProfile);
    contexts.set(contextKey, context);
  }
  const key = JSON.stringify([catalog.contentDigest, route.persona, route.profiles]);
  let agent = agents.get(key);
  if (!agent) {
    agent = await resolveAgent(
      config,
      input.root,
      catalog,
      route.persona,
      route.profiles,
    );
    agents.set(key, agent);
  }
  return { stage, route, agent, context };
}

async function createPlan(input: TaskInput, config: Config, historyRoot = input.root) {
  const catalog = await getCatalog(config, input.root);
  const history = await readTelemetry(historyRoot, config.telemetry.enabled);
  const agents = new Map<string, ResolvedAgent>();
  const contexts = new Map<string, Context>();
  const overview = await getContext(config, input, "spec", "overview");
  contexts.set("spec:overview", overview);
  const stages: PlannedStage[] = [];
  for (const stage of STAGES) {
    stages.push(
      await resolveStage(
        input,
        config,
        catalog,
        stage,
        history,
        agents,
        overview,
        contexts,
      ),
    );
    boundedJson(stages, MAX_PLAN_BYTES, "Execution plan");
  }
  const plan: ExecutionPlan = {
    protocolVersion: "1.0",
    root: input.root,
    task: input.task,
    catalogDigest: catalog.contentDigest,
    overview,
    stages,
  };
  boundedJson(plan, MAX_PLAN_BYTES, "Execution plan");
  return { plan, catalog, agents };
}

export async function plan(raw: unknown, override?: Config): Promise<ExecutionPlan> {
  const { input, config } = await prepare(raw, override);
  return (await createPlan(input, config)).plan;
}

async function stageInput(
  input: TaskInput,
  previous: StageRecord[],
): Promise<TaskInput> {
  const seeds: string[] = [];
  const excludedDirectories = new Set([
    "dist",
    "build",
    "coverage",
    ".next",
    ".codepatrol",
    ".memorypatrol",
    "node_modules",
    "vendor",
  ]);
  const excluded = (path: string) =>
    path.split("/").some((segment) => excludedDirectories.has(segment));
  for (const record of [...previous].reverse()) {
    if (record.stage.endsWith("-review") || record.stage === "ship") continue;
    for (const path of record.result?.artifacts ?? []) {
      if (seeds.length >= 100) break;
      if (
        seeds.includes(path) ||
        excluded(path) ||
        !relativePathSchema.safeParse(path).success
      )
        continue;
      try {
        const target = await realpath(join(input.root, path));
        const local = relative(input.root, target);
        if (
          local.startsWith("../") ||
          isAbsolute(local) ||
          !(await lstat(target)).isFile()
        )
          continue;
        seeds.push(path);
      } catch {
        /* Missing or escaping artifacts are not context permissions. */
      }
    }
  }
  for (const path of input.paths)
    if (!excluded(path) && !seeds.includes(path) && seeds.length < 100)
      seeds.push(path);
  // Match ContextPatrol's complete stdin limit as well as its path count limit.
  while (
    seeds.length &&
    Buffer.byteLength(JSON.stringify({ ...input, paths: seeds })) > 60_000
  )
    seeds.pop();
  return { ...input, paths: seeds };
}

export async function run(raw: unknown, override?: Config): Promise<RunState> {
  const { input, config } = await prepare(raw, override);
  const verification = config.verification;
  if (!config.executor || !verification)
    throw new Error(
      "run requires explicit executor and verification commands; neither has a default",
    );
  requireModelpatrolCredential(config);
  const git = (args: string[], cwd = input.root) =>
    runProcess(["git", ...args], { cwd, limits: config.limits });
  const top = await realpath((await git(["rev-parse", "--show-toplevel"])).trim());
  if (top !== input.root)
    throw new Error("run root must be the Git repository top level");
  const completed = await withStateLock(input.root, async (directory) => {
    const status = await git([
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
    ]);
    if (
      status
        .split("\0")
        .filter(Boolean)
        .some(
          (entry) =>
            !entry.startsWith("?? .codepatrol/v1/") &&
            !entry.startsWith("?? .memorypatrol/v1/"),
        )
    ) {
      throw new Error(
        "run requires a clean target repository (commit or remove pending changes first)",
      );
    }
    const workspaces = join(directory, "workspaces");
    const runId = randomUUID();
    const workspace = join(workspaces, runId);
    const now = new Date().toISOString();
    const state: RunState = {
      protocolVersion: "1.0",
      stateVersion: 1,
      runId,
      root: input.root,
      workspace,
      baseCommit: (await git(["rev-parse", "HEAD"])).trim(),
      createdAt: now,
      updatedAt: now,
      input,
      status: "running",
      stages: [],
    };
    await saveRun(state, true);
    const persist = async () => {
      state.updatedAt = new Date().toISOString();
      await saveRun(state);
    };
    try {
      // Validate aggregate provider data before creating a worktree or invoking an executor.
      const session = await createPlan(input, config);
      const proposed = { ...session.plan, root: workspace };
      boundedJson(proposed, MAX_PLAN_BYTES, "Execution plan");
      await mkdir(workspaces, { recursive: true, mode: 0o700 });
      if (!(await lstat(workspaces)).isDirectory())
        throw new Error("Workspaces directory must not be a symlink");
      await git(["worktree", "add", "--detach", workspace, state.baseCommit]);
      const workspaceInput = { ...input, root: workspace };
      state.plan = proposed;
      await persist();
      for (const stage of STAGES) {
        if (!state.plan) throw new Error("Missing execution plan");
        const catalog = await getCatalog(config, workspace);
        if (catalog.contentDigest !== session.catalog.contentDigest) {
          throw new Error(
            "Provider catalog content changed during execution; start a fresh plan",
          );
        }
        const currentInput = await stageInput(workspaceInput, state.stages);
        const planned = await resolveStage(
          currentInput,
          config,
          catalog,
          stage,
          await readTelemetry(input.root, config.telemetry.enabled),
          session.agents,
          session.plan.overview,
        );
        const updatedPlan: ExecutionPlan = {
          ...state.plan,
          stages: state.plan.stages.map((item) =>
            item.stage === stage ? planned : item,
          ),
        };
        boundedJson(updatedPlan, MAX_PLAN_BYTES, "Execution plan");
        const record: StageRecord = { ...planned, status: "failed", durationMs: 0 };
        // Reserve the maximum accepted response, verification argv and bounded error overhead
        // before arbitrary writes. Every accepted result must remain durably representable.
        const reserve =
          config.limits.maxOutputBytes +
          Buffer.byteLength(JSON.stringify(verification)) +
          65_536;
        boundedJson(
          { ...state, plan: updatedPlan, stages: [...state.stages, record] },
          MAX_STATE_BYTES - reserve,
          "Run state capacity before executor",
        );
        state.plan = updatedPlan;
        state.activeStage = stage;
        // Persist intent before invoking trusted, potentially non-idempotent code. Never replay it.
        await persist();
        const start = performance.now();
        try {
          const memory = await recallMemory(config, input.root, input.task);
          const execution = await executeStage(config, {
            protocolVersion: "1.0",
            runId,
            stage,
            task: input.task,
            workspace,
            agent: planned.agent,
            context: planned.context,
            ...(memory ? { memory } : {}),
            previous: state.stages,
            tracking: input.tracking,
          });
          record.result = execution.result;
          if (record.result.status !== "passed")
            throw new Error(`Executor blocked ${stage}`);
          if (
            (stage.endsWith("-review") || stage === "ship") &&
            record.result.approved === false
          )
            throw new Error(`Executor blocked ${stage}`);
          if (stage === "build") {
            const verificationStart = performance.now();
            record.verification = {
              status: "failed",
              argv: verification,
              durationMs: 0,
            };
            try {
              await verifyBuild(config, workspace);
              record.verification.status = "passed";
            } finally {
              record.verification.durationMs = performance.now() - verificationStart;
            }
          }
          await rememberMemory(config, input.root, execution.memories);
          record.status = "passed";
        } catch (error) {
          record.error =
            error instanceof Error ? error.message.slice(0, 4096) : "Stage failed";
        }
        record.durationMs = performance.now() - start;
        state.stages.push(record);
        if (record.status === "failed") {
          state.status = "blocked";
          state.error = record.error ?? `Stage ${stage} failed`;
        }
        await persist();
        const review = stage.endsWith("-review");
        if (review) {
          const producer = state.stages.at(-2);
          if (producer)
            await recordTelemetry(
              input.root,
              config.telemetry.enabled,
              runId,
              producer,
              record.result?.status === "passed" && record.result.approved !== undefined
                ? record.result.approved
                  ? "success"
                  : "failure"
                : "unknown",
            );
        }
        if (review || record.status === "failed" || stage === "ship") {
          await recordTelemetry(
            input.root,
            config.telemetry.enabled,
            runId,
            record,
            review ? "unknown" : record.status === "failed" ? "failure" : "unknown",
          );
        }
        if (state.status === "blocked") break;
      }
      if (state.status === "running") state.status = "awaiting-approval";
      delete state.activeStage;
    } catch (error) {
      state.status = "blocked";
      state.error =
        error instanceof Error ? error.message.slice(0, 4096) : "Run failed";
      if (error instanceof PayloadLimitError) delete state.plan;
    }
    await persist();
    return state;
  });
  if (config.remote?.github.sync === "run-end")
    await syncRemote({ root: input.root, config: input.config }).catch(() => {});
  return completed;
}

export async function approve(options: {
  root: string;
  runId: string;
  confirm: boolean;
}): Promise<RunState> {
  if (options.confirm !== true) throw new Error("Approval requires explicit --confirm");
  const root = await realpath(options.root);
  const approved = await withStateLock(root, async () => {
    const state = await readRun(root, options.runId);
    if (
      state.status !== "awaiting-approval" ||
      state.stages.length !== STAGES.length ||
      state.stages.some(
        (record, index) =>
          record.stage !== STAGES[index] ||
          record.status !== "passed" ||
          record.result?.status !== "passed" ||
          (record.stage.endsWith("-review") && record.result.approved !== true),
      ) ||
      state.stages.find((record) => record.stage === "build")?.verification?.status !==
        "passed"
    ) {
      throw new Error("Run is not eligible for operator approval");
    }
    state.approval = {
      confirmed: true,
      operator: userInfo().username,
      at: new Date().toISOString(),
    };
    state.status = "approved";
    state.updatedAt = state.approval.at;
    await saveRun(state);
    return state;
  });
  const config = await loadConfig({ root });
  if (config.remote?.github.sync === "run-end")
    await syncRemote({ root }).catch(() => {});
  return approved;
}

export { stateDirectory };
