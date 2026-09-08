import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  appendFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { z } from "zod";
import {
  approve,
  CONTEXT_PROFILES,
  type Config,
  catalogSchema,
  configSchema,
  contentDigest,
  contextProfileFor,
  contextRequestFor,
  getCatalog,
  getContext,
  historicalAdjustment,
  inputSchema,
  MAX_PLAN_BYTES,
  MAX_ROUTE_ALTERNATIVES,
  MAX_STATE_BYTES,
  plan,
  type RouteIdentity,
  readRun,
  readTelemetry,
  resolveAgent,
  rpc,
  run,
  runCli,
  runProcess,
  STAGES,
  type StageRecord,
  selectRoute,
  stateDirectory,
  type TelemetryEvent,
  telemetrySummary,
} from "../src/index.js";
import { saveRun, withStateLock } from "../src/state.js";
import { recordTelemetry } from "../src/telemetry.js";

const exec = promisify(execFile);
const adapter = resolve("test/fixtures/neural-adapter.mjs");
const command = (mode: string, behavior = "pass") => [
  process.execPath,
  adapter,
  mode,
  behavior,
];
function config(behavior = "pass", verification = "pass"): Config {
  return configSchema.parse({
    protocolVersion: "1.0",
    providers: {
      agents: { catalog: command("catalog"), resolve: command("resolve") },
      context: command("context"),
    },
    executor: command("execute", behavior),
    verification: command("verify", verification),
  });
}
async function fixture(t: { after: (fn: () => Promise<void>) => void }, git = false) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "codepatrol-v1-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "source.tsx"), "export const Component = () => null;\n");
  if (git) {
    await exec("git", ["init", "-q", root]);
    await exec("git", ["add", "."], { cwd: root });
    await exec(
      "git",
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.test",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "-qm",
        "fixture",
      ],
      { cwd: root },
    );
  }
  return {
    protocolVersion: "1.0" as const,
    root,
    task: "Repair React and Python MCP integration",
    paths: ["source.tsx"],
  };
}
function event(
  route: RouteIdentity,
  feedback: TelemetryEvent["feedback"],
): TelemetryEvent {
  return {
    schemaVersion: 1,
    type: "stage",
    runId: randomUUID(),
    at: new Date().toISOString(),
    route: {
      stage: route.stage,
      taskClass: route.taskClass,
      persona: route.persona,
      profiles: route.profiles,
      contextProfile: route.contextProfile,
      catalogDigest: route.catalogDigest,
    },
    status: feedback === "failure" ? "failed" : "passed",
    feedback,
    durationMs: 1,
    agentDigest: "a".repeat(64),
    contextDigest: "b".repeat(64),
    snapshot: "c".repeat(64),
  };
}

test("content-only authoring drift invalidates resolution, history and active runs", async (t) => {
  const input = await fixture(t, true);
  await mkdir(stateDirectory(input.root), { recursive: true });
  const authoring = join(stateDirectory(input.root), "authoring.txt");
  await writeFile(authoring, "first skill body");
  const settings = config("drift");
  settings.providers.agents.catalog = [...command("catalog"), authoring];
  settings.providers.agents.resolve = [...command("resolve"), authoring];
  settings.executor = [...command("execute", "drift"), authoring];
  const before = await getCatalog(settings, input.root);
  const route = selectRoute(before, "build", input.task, ["react"]);
  const history = Array.from({ length: 3 }, () => event(route, "failure"));
  await writeFile(authoring, "second skill body, same version and metadata");
  const after = await getCatalog(settings, input.root);
  assert.deepEqual(before.personas, after.personas);
  assert.deepEqual(before.profiles, after.profiles);
  assert.equal(before.catalogVersion, after.catalogVersion);
  assert.notEqual(before.contentDigest, after.contentDigest);
  await assert.rejects(
    resolveAgent(settings, input.root, before, "developer", ["react"]),
    /does not match catalog/,
  );
  const agent = await resolveAgent(settings, input.root, after, "developer", ["react"]);
  assert.equal(agent.catalogDigest, after.contentDigest);
  assert.equal(
    historicalAdjustment(selectRoute(after, "build", input.task, ["react"]), history)
      .samples,
    0,
  );
  const state = await run(input, settings);
  assert.equal(state.status, "blocked");
  assert.match(state.error ?? "", /catalog content changed/);
  assert.deepEqual(
    state.stages.map((record) => record.stage),
    ["spec"],
  );
  assert.equal(state.plan?.catalogDigest, after.contentDigest);
  assert.equal((await readRun(input.root, state.runId)).status, "blocked");
});

test("three valid rejections never demote reviewers or teach approval bias", async (t) => {
  const input = { ...(await fixture(t, true)), task: "Repair component" };
  const settings = config("reject-spec-review");
  for (let index = 0; index < 3; index++)
    assert.equal((await run(input, settings)).status, "blocked");
  const history = await readTelemetry(input.root);
  const reviews = history.filter((item) => item.route.stage === "spec-review");
  assert.equal(reviews.length, 3);
  assert.ok(reviews.every((item) => item.feedback === "unknown"));
  const proposed = await plan(input, settings);
  const reviewer = proposed.stages[1]?.route;
  assert.ok(reviewer);
  assert.deepEqual(reviewer.profiles, ["react"]);
  assert.equal(reviewer.adjustment, 0);
  assert.equal(reviewer.samples, 0);
  assert.equal(
    historicalAdjustment(
      reviewer,
      reviews.map((item) => ({ ...item, feedback: "failure" })),
    ).adjustment,
    0,
    "Even old biased reviewer observations cannot affect scores",
  );
  assert.equal(
    history.filter((item) => item.route.stage === "spec" && item.feedback === "failure")
      .length,
    3,
  );
});

test("context selection uses the audited fixed stage map and two task alternatives", () => {
  for (const stage of STAGES) {
    assert.equal(
      contextProfileFor(stage, "Maintain project", ["react"]).profile,
      CONTEXT_PROFILES[stage],
    );
  }
  for (const [stage, task, expected] of [
    ["spec", "Repair React form validation", "overview"],
    ["spec", "Refactor React module boundaries", "architecture"],
    ["plan", "Repair React form validation", "implementation"],
    ["plan", "Refactor React module boundaries", "architecture"],
    ["build", "Repair React form validation", "implementation"],
    ["build", "Refactor React module boundaries", "implementation"],
    ["spec-review", "Repair React form validation", "review"],
    ["spec-review", "Refactor React module boundaries", "review"],
    ["plan-review", "Refactor React module boundaries", "review"],
    ["build-review", "Refactor React module boundaries", "review"],
    ["ship", "Repair React form validation", "review"],
    ["ship", "Check React release readiness", "review"],
  ] as const) {
    const choice = contextProfileFor(stage, task, ["react"]);
    assert.equal(choice.profile, expected);
    assert.ok(
      choice.reasons.some(
        (reason) => reason.includes(expected) && reason.includes(stage),
      ),
    );
    assert.deepEqual(contextProfileFor(stage, task, ["react"]), choice);
  }
  assert.equal(
    contextProfileFor("spec", "Repair package imports", ["react"]).profile,
    "overview",
  );
  assert.equal(
    contextProfileFor("spec", "Repair package imports", ["react", "monorepo"]).profile,
    "overview",
  );
  assert.equal(
    CONTEXT_PROFILES.plan,
    "architecture",
    "Exported defaults are not mutated by dynamic choices",
  );
});

test("context partitions isolate history without monorepo signal alternatives", async (t) => {
  const input = await fixture(t);
  const catalog = await getCatalog(config(), input.root);
  const task = "Repair package imports";
  const original = selectRoute(catalog, "spec", task, ["react"]);
  const history = Array.from({ length: 3 }, () => event(original, "failure"));
  assert.equal(original.contextProfile, "overview");
  assert.equal(original.baseScore, 1.15);
  const learned = selectRoute(catalog, "spec", task, ["react"], history);
  assert.deepEqual(learned.profiles, ["general"]);
  assert.equal(learned.baseScore, 1);
  assert.equal(learned.contextProfile, "overview");
  assert.ok(learned.alternatives.every((route) => route.contextProfile === "overview"));
  const structural = selectRoute(catalog, "spec", task, ["react", "monorepo"], history);
  assert.equal(structural.taskClass, original.taskClass);
  assert.equal(structural.persona, original.persona);
  assert.deepEqual(structural.profiles, learned.profiles);
  assert.equal(structural.catalogDigest, original.catalogDigest);
  assert.equal(structural.contextProfile, "overview");
  assert.equal(structural.samples, learned.samples);
  assert.equal(structural.adjustment, learned.adjustment);
  assert.equal(historicalAdjustment(structural, history).samples, 0);
});

test("providers receive exact audited stage context budgets", async (t) => {
  const input = await fixture(t, true);
  await mkdir(stateDirectory(input.root), { recursive: true });
  const trace = join(stateDirectory(input.root), "dynamic-context.jsonl");
  const settings = config();
  settings.providers.context = [...command("context"), "", trace];
  for (const [task, expected] of [
    [
      "Repair React component",
      [
        "overview",
        "review",
        "implementation",
        "review",
        "implementation",
        "review",
        "review",
      ],
    ],
    [
      "Refactor React module boundaries",
      [
        "architecture",
        "review",
        "architecture",
        "review",
        "implementation",
        "review",
        "review",
      ],
    ],
    [
      "Check React release readiness",
      [
        "overview",
        "review",
        "architecture",
        "review",
        "implementation",
        "review",
        "review",
      ],
    ],
  ] as const) {
    await writeFile(trace, "");
    const proposed = await plan({ ...input, task }, settings);
    assert.deepEqual(
      proposed.stages.map((item) => item.route.contextProfile),
      expected,
    );
    assert.deepEqual(
      proposed.stages.map((item) => item.context.profile),
      expected,
    );
    const calls = (await readFile(trace, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const requestedProfiles =
      expected[0] === "overview" ? expected : ["overview", ...expected];
    assert.deepEqual(
      calls.map((call) => call.profile),
      requestedProfiles,
      "Each stage receives its selected profile with its own policy budget",
    );
    const expectedBudgets = expected.map((profile, index) => {
      const stage = STAGES[index];
      if (stage === undefined) throw new Error("Missing expected stage");
      return contextRequestFor(stage, profile);
    });
    if (expected[0] !== "overview")
      expectedBudgets.unshift(contextRequestFor("spec", "overview"));
    assert.deepEqual(
      calls.map((call) => call.budget),
      expectedBudgets,
    );
  }
  await writeFile(trace, "");
  const state = await run(
    { ...input, task: "Refactor React module boundaries" },
    settings,
  );
  assert.equal(state.status, "awaiting-approval", state.error);
  assert.deepEqual(
    state.stages.map((record) => record.context.profile),
    [
      "architecture",
      "review",
      "architecture",
      "review",
      "implementation",
      "review",
      "review",
    ],
  );
  const calls = (await readFile(trace, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    calls.filter((call) => call.cwd === state.workspace).map((call) => call.profile),
    state.stages.map((record) => record.route.contextProfile),
  );
  assert.equal(state.stages[4]?.verification?.status, "passed");
});

test("every stage refreshes actual artifacts and stack signals; planning caches providers", async (t) => {
  const input = { ...(await fixture(t, true)), task: "Repair component" };
  await mkdir(stateDirectory(input.root), { recursive: true });
  const trace = join(stateDirectory(input.root), "provider-calls.jsonl");
  const settings = config("evolving");
  settings.providers.agents.catalog = [...command("catalog"), "", trace];
  settings.providers.agents.resolve = [...command("resolve"), "", trace];
  settings.providers.context = [...command("context"), "", trace];
  const proposed = await plan(input, settings);
  const calls = (await readFile(trace, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(calls.filter((call) => call.mode === "catalog").length, 1);
  assert.equal(calls.filter((call) => call.mode === "context").length, 7);
  assert.equal(calls.filter((call) => call.mode === "resolve").length, 4);
  assert.deepEqual(proposed.stages[4]?.route.profiles, ["react"]);
  await writeFile(trace, "");
  const state = await run(input, settings);
  assert.equal(state.status, "awaiting-approval", state.error);
  for (const [producerIndex, reviewIndex, artifact] of [
    [0, 1, "spec.md"],
    [2, 3, "plan.md"],
    [4, 5, "BUILD.txt"],
  ] as const) {
    assert.notEqual(
      state.stages[producerIndex]?.context.snapshot,
      state.stages[reviewIndex]?.context.snapshot,
    );
    assert.ok(
      state.stages[reviewIndex]?.context.files.some(
        (file) => file.path === artifact && file.reasons.includes("artifact seed"),
      ),
    );
  }
  assert.deepEqual(state.stages[4]?.route.profiles, ["react"]);
  const runCalls = (await readFile(trace, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(
    runCalls.filter((call) => call.mode === "catalog").length,
    8,
    "One preflight catalog plus one per stage, not seven whole plans per stage",
  );
  assert.equal(runCalls.filter((call) => call.mode === "context").length, 14);
  assert.ok(
    runCalls.filter((call) => call.mode === "resolve").length <= 7,
    "Immutable route resolutions are reused",
  );
});

test("artifact seeds exclude generated directories, traversal, globs, missing files and escaping symlinks", async (t) => {
  const input = await fixture(t, true);
  await mkdir(stateDirectory(input.root), { recursive: true });
  const outside = join(stateDirectory(input.root), "outside.md");
  const trace = join(stateDirectory(input.root), "seeds.jsonl");
  await writeFile(outside, "not inside the execution worktree");
  const settings = config("artifact-seeds");
  settings.executor = [...command("execute", "artifact-seeds"), outside];
  settings.providers.context = [...command("context"), "", trace];
  const state = await run(input, settings);
  assert.equal(state.status, "awaiting-approval", state.error);
  const queries = (await readFile(trace, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const seeded = queries.filter((query) => query.paths.includes("spec.md"));
  assert.ok(seeded.length > 0);
  assert.equal(seeded[0].paths.length, 100);
  for (const query of seeded) {
    assert.ok(query.paths.length <= 100);
    assert.equal(new Set(query.paths).size, query.paths.length);
    for (const invalid of [
      "escape.md",
      "../outside.md",
      "C:evil",
      "a*b",
      "missing.md",
      "dist/generated.md",
      "build/generated.md",
      "coverage/generated.md",
      ".next/generated.md",
      ".codepatrol/generated.md",
      "node_modules/generated.md",
      "vendor/generated.md",
    ])
      assert.ok(!query.paths.includes(invalid));
  }
});

test("timeout and overflow settle even when detached descendants inherit pipes", {
  skip: process.platform === "win32",
}, async (t) => {
  const input = await fixture(t);
  for (const mode of ["escaped-descendant", "escaped-overflow"]) {
    const pidPath = join(input.root, `${mode}.pid`);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        runProcess(command(mode, pidPath), {
          cwd: input.root,
          limits: { timeoutMs: 500, maxOutputBytes: 1024 },
        }).then(
          () => "unexpected pass",
          (error: Error) => error.message,
        ),
        new Promise<string>((resolve) => {
          timer = setTimeout(() => resolve("did not settle"), 2500);
        }),
      ]);
      assert.match(
        result,
        mode === "escaped-descendant" ? /timed out/ : /output exceeds/,
      );
    } finally {
      clearTimeout(timer);
      const pid = Number(await readFile(pidPath, "utf8"));
      assert.ok(pid > 0);
      try {
        process.kill(pid, "SIGKILL");
      } catch (error) {
        assert.equal((error as NodeJS.ErrnoException).code, "ESRCH");
      }
    }
  }
});

test("telemetry rotation owns exclusive random files and rejects symlinked parents", async (t) => {
  const input = await fixture(t);
  const proposed = await plan(input, config());
  const record: StageRecord = {
    ...(proposed.stages[0] as NonNullable<(typeof proposed.stages)[0]>),
    status: "passed",
    durationMs: 1,
  };
  const directory = stateDirectory(input.root);
  await mkdir(directory, { recursive: true });
  const source = join(input.root, "source.tsx");
  const original = await readFile(source, "utf8");
  await symlink(source, join(directory, "telemetry.compact"));
  await writeFile(join(directory, "telemetry.jsonl"), `${"x".repeat(1_048_577)}\n`);
  await recordTelemetry(input.root, true, randomUUID(), record, "unknown");
  assert.equal(await readFile(source, "utf8"), original);
  assert.equal(await readlink(join(directory, "telemetry.compact")), source);
  assert.equal((await readTelemetry(input.root)).length, 1);
  assert.ok(!(await readdir(directory)).some((name) => name.endsWith(".tmp")));
  const second = await fixture(t);
  const outside = join(input.root, "outside");
  await mkdir(outside);
  await symlink(outside, join(second.root, ".codepatrol"));
  await recordTelemetry(second.root, true, randomUUID(), record, "unknown");
  assert.deepEqual(await readdir(outside), []);
  assert.deepEqual(await readTelemetry(second.root), []);
  await assert.rejects(
    withStateLock(second.root, async () => {}),
    /symlink/,
  );
});

test("amplified valid catalogs have bounded alternatives and oversized plans block before worktree creation", async (t) => {
  const input = await fixture(t, true);
  const amplified = config();
  amplified.providers.agents.catalog = command("catalog", "amplified");
  amplified.providers.agents.resolve = command("resolve", "amplified");
  const catalog = await getCatalog(amplified, input.root);
  assert.equal(catalog.personas.length, 256);
  assert.equal(catalog.profiles.length, 256);
  assert.equal(
    selectRoute(catalog, "build", "Repair React", ["react"]).alternatives.length,
    MAX_ROUTE_ALTERNATIVES,
  );
  assert.ok(
    Buffer.byteLength(JSON.stringify(await plan(input, amplified))) < MAX_PLAN_BYTES,
  );
  const oversized = config();
  oversized.limits.maxOutputBytes = 16_777_216;
  oversized.providers.agents.catalog = command("catalog", "oversize-plan");
  oversized.providers.agents.resolve = command("resolve", "oversize-plan");
  await assert.rejects(plan(input, oversized), /Execution plan exceeds/);
  const blocked = await run(input, oversized);
  assert.equal(blocked.status, "blocked");
  assert.match(blocked.error ?? "", /Execution plan exceeds/);
  assert.equal(blocked.plan, undefined);
  assert.equal(blocked.stages.length, 0);
  await assert.rejects(lstat(blocked.workspace), { code: "ENOENT" });
  assert.deepEqual(await readRun(input.root, blocked.runId), blocked);
  const path = join(stateDirectory(input.root), `${blocked.runId}.json`);
  assert.ok((await stat(path)).size < 16_384);
  const original = await readFile(path, "utf8");
  const largePlan = await plan(input, config());
  const file = largePlan.overview.files[0];
  assert.ok(file);
  file.excerpt = "x".repeat(MAX_PLAN_BYTES);
  const { digest: _digest, ...contextPayload } = largePlan.overview;
  largePlan.overview.digest = contentDigest(contextPayload);
  const largePlanState = { ...blocked, plan: largePlan };
  await assert.rejects(
    withStateLock(input.root, () => saveRun(largePlanState)),
    /Execution plan exceeds/,
  );
  assert.equal(await readFile(path, "utf8"), original);
  await writeFile(path, JSON.stringify(largePlanState));
  await assert.rejects(readRun(input.root, blocked.runId), /Execution plan exceeds/);
  await writeFile(path, original);
  const tooLarge = { ...blocked, error: "x".repeat(MAX_STATE_BYTES) };
  await assert.rejects(
    withStateLock(input.root, () => saveRun(tooLarge)),
    /Run state exceeds/,
  );
  assert.equal(
    await readFile(path, "utf8"),
    original,
    "Oversized writes cannot replace authoritative state",
  );
  await writeFile(path, JSON.stringify(tooLarge));
  await assert.rejects(
    readRun(input.root, blocked.runId),
    /JSON file exceeds byte limit/,
  );
});

test("ContextPatrol task and path constraints reject inputs before creating state or worktrees", async (t) => {
  const input = await fixture(t, true);
  for (const patch of [
    { task: "x".repeat(8193) },
    { task: " " },
    { paths: ["source.tsx", "source.tsx"] },
    { paths: Array.from({ length: 101 }, (_, index) => `file-${index}.ts`) },
    ...[
      "a".repeat(1025),
      "a\nb",
      "a\u007fb",
      "C:foo",
      "C:/foo",
      "a*b",
      "a?b",
      "a[b",
      "a{b",
      "a\\b",
      "a//b",
      "./a",
      "../a",
    ].map((path) => ({ paths: [path] })),
  ])
    await assert.rejects(run({ ...input, ...patch }, config()));
  assert.equal(
    inputSchema.parse({ ...input, task: "x".repeat(8192), paths: ["a".repeat(1024)] })
      .task.length,
    8192,
  );
  await assert.rejects(lstat(join(input.root, ".codepatrol")), { code: "ENOENT" });
});

test("closed v1 contracts, portable defaults and no traversal", () => {
  const defaults = configSchema.parse({ protocolVersion: "1.0" });
  assert.deepEqual(defaults.providers.agents.catalog, ["agentpatrol", "catalog"]);
  assert.equal(defaults.executor, undefined);
  assert.equal(defaults.verification, undefined);
  assert.throws(() => configSchema.parse({ protocolVersion: "0.9" }));
  assert.throws(() => configSchema.parse({ protocolVersion: "1.0", remote: {} }));
  assert.throws(() =>
    configSchema.parse({ protocolVersion: "1.0", providers: { context: [""] } }),
  );
  assert.throws(() =>
    inputSchema.parse({
      protocolVersion: "1.0",
      root: "/tmp",
      task: "x",
      paths: ["../secret"],
    }),
  );
  assert.equal(
    contentDigest({ b: 2, a: { d: 4, c: 3 } }),
    contentDigest({ a: { c: 3, d: 4 }, b: 2 }),
  );
});

test("plan uses real provider RPC, multi-select profiles, stage contexts, no executor or Git required", async (t) => {
  const input = await fixture(t);
  const settings = config();
  delete settings.executor;
  delete settings.verification;
  const result = await plan(input, settings);
  assert.deepEqual(
    result.stages.map((item) => item.stage),
    STAGES,
  );
  for (const item of result.stages) {
    assert.deepEqual(item.route.profiles, ["mcp", "python", "react"]);
    assert.equal(item.agent.persona, item.route.persona);
    assert.equal(item.context.profile, item.route.contextProfile);
    assert.ok(item.route.reasons.length >= 4);
  }
  assert.equal(result.stages[4]?.context.profile, "implementation");
  assert.equal(result.stages[2]?.context.profile, "architecture");
  await assert.rejects(readFile(join(input.root, "BUILD.txt")));
  await assert.rejects(readFile(join(stateDirectory(input.root), "telemetry.jsonl")));
  await assert.rejects(run(input, settings), /explicit executor and verification/);
});

test("full lifecycle isolates writes, refreshes build context, records evidence and manual approval", async (t) => {
  const input = await fixture(t, true);
  const state = await run(input, config("usage"));
  assert.equal(state.status, "awaiting-approval", state.error);
  assert.equal(state.root, input.root);
  assert.notEqual(state.workspace, input.root);
  assert.deepEqual(
    state.stages.map((item) => item.stage),
    STAGES,
  );
  assert.equal(state.stages[4]?.verification?.status, "passed");
  assert.deepEqual(state.stages[4]?.verification?.argv, command("verify"));
  assert.notEqual(state.stages[4]?.context.snapshot, state.stages[5]?.context.snapshot);
  assert.equal(state.plan?.root, state.workspace);
  assert.equal(
    await readFile(join(state.workspace, "BUILD.txt"), "utf8"),
    "implemented by fixture\n",
  );
  await assert.rejects(readFile(join(input.root, "BUILD.txt")));
  assert.equal(
    (await exec("git", ["rev-parse", "HEAD"], { cwd: input.root })).stdout.trim(),
    state.baseCommit,
  );
  await assert.rejects(
    approve({ root: input.root, runId: state.runId, confirm: false }),
    /confirm/,
  );
  assert.deepEqual(await readRun(input.root, state.runId), state);
  const approved = await approve({
    root: input.root,
    runId: state.runId,
    confirm: true,
  });
  assert.equal(approved.status, "approved");
  assert.equal(approved.approval?.confirmed, true);
  await assert.rejects(
    approve({ root: input.root, runId: state.runId, confirm: true }),
    /not eligible/,
  );
  const history = await readTelemetry(input.root);
  assert.equal(history.length, 7);
  assert.equal(
    history.find((item) => item.route.stage === "ship")?.feedback,
    "unknown",
  );
  assert.equal(history[0]?.usage?.inputTokens, 12);
  const text = await readFile(
    join(stateDirectory(input.root), "telemetry.jsonl"),
    "utf8",
  );
  for (const sensitive of [
    input.task,
    "Component",
    input.root,
    "Fixture spec",
    "instructions",
    "summary",
    "artifacts",
  ])
    assert.ok(!text.includes(sensitive));
  assert.equal((await telemetrySummary(input.root)).routes.length, 7);
});

for (const [behavior, verification, last] of [
  ["fail-spec", "pass", "spec"],
  ["reject-spec-review", "pass", "spec-review"],
  ["missing-approved", "pass", "spec-review"],
  ["reject-plan-review", "pass", "plan-review"],
  ["fail-build", "pass", "build"],
  ["pass", "fail", "build"],
  ["reject-build-review", "pass", "build-review"],
  ["reject-ship", "pass", "ship"],
] as const)
  test(`fail closed: ${behavior}/${verification}`, async (t) => {
    const input = await fixture(t, true);
    const state = await run(input, config(behavior, verification));
    assert.equal(state.status, "blocked");
    assert.equal(state.stages.at(-1)?.stage, last);
    assert.equal(state.stages.at(-1)?.status, "failed");
    await assert.rejects(
      approve({ root: input.root, runId: state.runId, confirm: true }),
      /not eligible/,
    );
    assert.deepEqual(await readRun(input.root, state.runId), state);
    const executions = (
      await readFile(join(state.workspace, "execution.jsonl"), "utf8")
    )
      .trim()
      .split("\n");
    assert.equal(
      executions.length,
      STAGES.indexOf(last) + 1,
      "no replay or later executor calls",
    );
    const history = await readTelemetry(input.root);
    if (behavior === "missing-approved") {
      assert.equal(
        history.find((item) => item.route.stage === "spec")?.feedback,
        "unknown",
        "A broken reviewer is not negative producer evidence",
      );
    }
    if (behavior === "reject-build-review" || verification === "fail") {
      assert.equal(
        history.find((item) => item.route.stage === "build")?.feedback,
        "failure",
      );
    }
  });

test("dirty targets can plan but cannot run; disabled and broken telemetry cannot fail execution", async (t) => {
  const input = await fixture(t, true);
  await writeFile(join(input.root, "dirty.txt"), "dirty");
  assert.equal((await plan(input, config())).stages.length, 7);
  await assert.rejects(run(input, config()), /clean target/);
  await rm(join(input.root, "dirty.txt"));
  const settings = config();
  settings.telemetry.enabled = false;
  const first = await run(input, settings);
  assert.equal(first.status, "awaiting-approval");
  await assert.rejects(readFile(join(stateDirectory(input.root), "telemetry.jsonl")));
  await mkdir(join(input.root, ".memorypatrol/v1"), { recursive: true });
  await writeFile(join(input.root, ".memorypatrol/v1/active"), "codepatrol\n");
  await mkdir(join(stateDirectory(input.root), "telemetry.jsonl"));
  assert.equal((await run(input, config())).status, "awaiting-approval");
});

test("exclusive writer lock blocks run and approval, never takes over stale locks", async (t) => {
  const input = await fixture(t, true);
  await mkdir(stateDirectory(input.root), { recursive: true });
  await writeFile(join(stateDirectory(input.root), "writer.lock"), "stale");
  await assert.rejects(run(input, config()), /locked/);
  await assert.rejects(
    approve({ root: input.root, runId: randomUUID(), confirm: true }),
    /locked/,
  );
  assert.equal(
    await readFile(join(stateDirectory(input.root), "writer.lock"), "utf8"),
    "stale",
  );
});

test("live writers are exclusive and state readers only observe complete JSON", async (t) => {
  const input = await fixture(t, true);
  const pending = run(input, config("slow"));
  let statePath: string | undefined;
  try {
    for (let attempt = 0; attempt < 200; attempt++) {
      const files = await readdir(stateDirectory(input.root)).catch(() => []);
      const file = files.find((name) => /^[a-f0-9-]{36}\.json$/.test(name));
      if (file) {
        statePath = join(stateDirectory(input.root), file);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(statePath, "initial state is published before executor invocation");
    const initial = JSON.parse(await readFile(statePath, "utf8"));
    assert.equal(initial.status, "running");
    await assert.rejects(run(input, config()), /locked/);
    await assert.rejects(
      approve({ root: input.root, runId: initial.runId, confirm: true }),
      /locked/,
    );
    for (let attempt = 0; attempt < 80; attempt++) {
      const snapshot = JSON.parse(await readFile(statePath, "utf8"));
      assert.equal(snapshot.runId, initial.runId);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  } finally {
    assert.equal((await pending).status, "awaiting-approval");
  }
});

test("bounded RPC rejects timeout, excess pipes, exit, JSON, protocol and digest failures", async (t) => {
  const input = await fixture(t);
  const options = {
    cwd: input.root,
    limits: { timeoutMs: 1000, maxOutputBytes: 1024 },
  };
  for (const mode of ["overflow", "stderr-overflow", "nonzero", "malformed"]) {
    await assert.rejects(
      rpc(command(mode), { protocolVersion: "0.9" }, z.unknown(), options),
    );
  }
  await assert.rejects(
    runProcess(command("timeout"), {
      ...options,
      limits: { ...options.limits, timeoutMs: 50 },
    }),
    /timed out/,
  );
  await assert.rejects(
    rpc(command("echo"), "x".repeat(2048), z.unknown(), options),
    /input exceeds/,
  );
  const settings = config();
  settings.providers.agents.catalog = command("catalog", "bad-version");
  await assert.rejects(getCatalog(settings, input.root), /Invalid protocol response/);
  settings.providers.context = command("context", "bad-digest");
  await assert.rejects(
    getContext(settings, input, "spec", "overview"),
    /digest mismatch/,
  );
  const catalog = await getCatalog(config(), input.root);
  settings.providers.agents.resolve = command("resolve", "bad-digest");
  await assert.rejects(
    resolveAgent(settings, input.root, catalog, "developer", ["react"]),
    /digest mismatch/,
  );
  await assert.rejects(
    resolveAgent(config(), input.root, catalog, "unknown", ["react"]),
    /Unknown catalog/,
  );
  assert.deepEqual(
    (await resolveAgent(config(), input.root, catalog, "developer", [])).profiles,
    [],
  );
  assert.deepEqual(
    (await resolveAgent(config(), input.root, catalog, "developer", ["react", "react"]))
      .profiles,
    ["react"],
  );
  assert.deepEqual(
    await rpc(
      command("echo"),
      { protocolVersion: "1.0", literal: "; touch NEVER" },
      z.unknown(),
      options,
    ),
    { protocolVersion: "1.0", literal: "; touch NEVER" },
  );
});

test("adaptive scoring changes selection only after minimum samples in exact partitions", async (t) => {
  const input = await fixture(t);
  const catalog = await getCatalog(config(), input.root);
  const original = selectRoute(catalog, "build", "Repair React", ["react"]);
  assert.deepEqual(
    selectRoute(catalog, "build", "Repair component", ["react"]).profiles,
    ["react"],
    "Stack signals independently influence routing",
  );
  const extended = catalogSchema.parse({
    ...catalog,
    profiles: [
      ...catalog.profiles,
      ...["a_b", "a.b", "a-b"].map((id) => ({
        id,
        description: id,
        signals: ["component"],
        skills: [],
      })),
    ],
  });
  assert.deepEqual(
    selectRoute(extended, "build", "Repair component", []).profiles,
    ["a-b", "a.b", "a_b"],
    "Profile ordering is canonical and locale independent",
  );
  assert.deepEqual(original.profiles, ["react"]);
  const losses = Array.from({ length: 3 }, () => event(original, "failure"));
  assert.deepEqual(
    selectRoute(catalog, "build", "Repair React", ["react"], losses.slice(0, 2))
      .profiles,
    ["react"],
  );
  const learned = selectRoute(catalog, "build", "Repair React", ["react"], losses);
  assert.deepEqual(learned.profiles, ["general"]);
  assert.equal(learned.persona, "developer");
  for (const patch of [
    { stage: "plan" },
    { taskClass: "feature" },
    { persona: "qa" },
    { profiles: ["python"] },
    { contextProfile: "review" },
    { catalogDigest: "d".repeat(64) },
  ])
    assert.equal(
      historicalAdjustment({ ...original, ...patch } as RouteIdentity, losses).samples,
      0,
    );
  assert.equal(
    historicalAdjustment(original, [...losses, ...losses]).samples,
    3,
    "duplicate runs cannot inflate samples",
  );
  assert.equal(
    historicalAdjustment(
      original,
      Array.from({ length: 5000 }, () => event(original, "success")),
    ).samples,
    100,
  );
  assert.throws(() =>
    catalogSchema.parse({ ...catalog, personas: [catalog.personas[0]] }),
  );
  await mkdir(stateDirectory(input.root), { recursive: true });
  await writeFile(
    join(stateDirectory(input.root), "telemetry.jsonl"),
    `invalid\n${losses.map((item) => JSON.stringify(item)).join("\n")}\n`,
  );
  await appendFile(
    join(stateDirectory(input.root), "telemetry.jsonl"),
    `${JSON.stringify({ ...losses[0], task: "secret" })}\n{truncated`,
  );
  assert.equal((await readTelemetry(input.root)).length, 3);
  assert.deepEqual(await readTelemetry(input.root, false), []);
  const result = await plan({ ...input, task: "Repair React" }, config());
  assert.deepEqual(
    result.stages[4]?.route.profiles,
    ["general"],
    "planning consumes actual local history",
  );
});

test("CLI rejects legacy/unknown commands and loads JSON input", async (t) => {
  const input = await fixture(t);
  await writeFile(join(input.root, "codepatrol.json"), JSON.stringify(config()));
  const path = join(input.root, "task.json");
  await writeFile(path, JSON.stringify(input));
  assert.equal((await runCli(["node", "codepatrol", "--version"])).stdout, "1.0.0\n");
  assert.equal((await runCli(["node", "codepatrol", "setup"])).exitCode, 1);
  assert.equal(
    (await runCli(["node", "codepatrol", "plan", "--input", path, "--unknown"]))
      .exitCode,
    1,
  );
  const result = await runCli(["node", "codepatrol", "plan", "--input", path]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).stages.length, 7);
});
