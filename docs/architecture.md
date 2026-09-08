# v1 Architecture

The canonical wire contract is [protocol.md](protocol.md). The product has no
refs, envelopes, or competing candidates. GitHub tracking sync is an explicit local
state projection, not workflow authority.

## Modules

| Module | Responsibility |
| --- | --- |
| `contracts.ts` | Closed Zod wire/config schemas, canonical JSON and SHA-256 |
| `domain.ts` | Routes, proposed plans, completed stages and fresh v1 state |
| `rpc.ts` | Exact argv, no shell, bounded stdin/stdout/stderr, timeout and exit gates |
| `providers.ts` | Catalog, context and agent resolution; digest and identity checks |
| `memorypatrol.ts` | Bounded local memory recall/remember protocol, digest checks, state exclusion |
| `routing.ts` | Stage eligibility, task classification, stack matching, stable adaptive scores |
| `executor.ts` | Trusted adapter request/result and objective verification |
| `workflow.ts` | Ordered stages, worktree isolation, fail-closed gates and human approval |
| `state.ts` | Exclusive lock and run reservation, atomic fsynced state, state validation |
| `telemetry.ts` | Allowlisted optional JSONL, bounded sanitized history, feedback and summary |
| `github-sync.ts`, `github-wiki.ts`, `github-rest.ts` | Explicit tracking projection and GitHub adapters |
| `config.ts`, `cli.ts` | Bounded JSON input, portable config, strict command surface |

## Public ESM API

The package root exports declarations alongside JavaScript. No sibling source
imports or provider SDK dependencies are used.

- `plan(input: unknown, config?: Config): Promise<ExecutionPlan>`: read-only provider resolution.
- `run(input: unknown, config?: Config): Promise<RunState>`: stage failures return `blocked` state; setup/preflight errors throw.
- `approve({root: string, runId: string, confirm: boolean}): Promise<RunState>`: operator approval only.
- `syncRemote({root, config?, dryRun?}, deps?)`: explicit GitHub tracking synchronization.
- `readRun(root: string, runId: string): Promise<RunState>` and `stateDirectory(root: string): string`.
- `runCli(argv?: string[]): Promise<{exitCode: number, stdout: string, stderr: string}>`: argv includes Node and script entries.
- `loadConfig(input: TaskInput): Promise<Config>`: root-relative config lookup with portable defaults.
- `getCatalog(config, cwd)`, `getContext(config, input, stage, profile)`, `contextRequestFor(stage, profile)`, `resolveAgent(config, cwd, catalog, persona, profiles)`.
- `runProcess(argv, {cwd, limits, input?}): Promise<string>` and `rpc(argv, input, schema, {cwd, limits})`.
- `recallMemory(config, root, task)` and `rememberMemory(config, root, candidates)`; `memoryRecallSchema`, `MemoryRecall`.
- `executeStage(config, request)` and `verifyBuild(config, workspace)`; `executorRequestSchema`, `ExecutorRequest`, `StageExecution`.
- `selectRoute(catalog, stage, task, signals, history?): Route`, `classifyTask(task): TaskClass`, `CONTEXT_PROFILES`.
- `contextProfileFor(stage: Stage, task: string, signals: string[]): {profile: ContextProfile, reasons: string[]}`: deterministic task-aware context choice; `CONTEXT_PROFILES` remains the default mapping.
- `readTelemetry(root, enabled?)`, `telemetrySummary(root, enabled?)`, `historicalAdjustment(route, history)`, `routeIdentity(route)`, `routeKey(route)`.
- `telemetryEventSchema`, `TelemetryEvent`, `MIN_SAMPLES`, `MAX_HISTORY`.
- `PROTOCOL_VERSION`, `VERSION`, `STAGES`, `canonicalJson`, `contentDigest`, `validateDigest`.
- `MAX_PLAN_BYTES` (8 MiB), `MAX_STATE_BYTES` (64 MiB), `MAX_ROUTE_ALTERNATIVES` (16), `boundedJson(value, maxBytes, label)`, `PayloadLimitError`, `taskSchema`.
- All named schemas/types from `contracts.ts` and `domain.ts`, including `configSchema`, `inputSchema`, `catalogSchema`, `agentSchema`, `contextSchema`, `executorResultSchema`, `executionPlanSchema`, `runStateSchema`, `Config`, `TaskInput`, `Catalog`, `Context`, `ResolvedAgent`, `ExecutorResult`, `Stage`, `Route`, `ExecutionPlan`, `StageRecord`, `RunState`.

Use `configSchema.parse` for a fully defaulted `Config` override. Otherwise the
library loads the same config as the CLI. `ExecutionPlan.stages` entries are
`{stage, route, agent, context}`. `Route` contains its full learning partition,
`baseScore`, `adjustment`, `score`, `samples`, `reasons`, and `alternatives`.
Plan and route `catalogDigest` equal the provider's required `Catalog.contentDigest`,
which identifies all active authoring including skill bodies. `ResolvedAgent` now
requires `catalogDigest` matching that value, in addition to its own payload digest.

`RunState` includes `protocolVersion: "1.0"`, `stateVersion: 1`, UUID `runId`,
canonical target `root`, actual `workspace`, `baseCommit`, timestamps, parsed
`input`, `status`, proposed `plan`, and ordered completed `stages`. While running,
`activeStage` records durable intent. Completed records add `status`, optional
executor `result`, `durationMs`, optional `verification` (exact `argv`, `status`,
`durationMs`), and optional `error`. Memory recall responses and executor memory
candidates are intentionally absent: they are transient provider transport and are
written only to MemoryPatrol after a complete passing stage.
`approval` exists only after explicit confirmation and records `operator`, `at`,
and `confirmed: true`.

## Authority And Failure

The state lock serializes all run and approval writers for one canonical root.
It is acquired exclusively, never stolen, and held across execution. State is
outside the detached worktree, not in Git refs. A crash may leave `running` state
and a lock; there is intentionally no automatic replay of executor writes.
Retained worktrees are inspection artifacts, not immutable signed releases.

Plan needs no Git or executor and creates no state. Run requires a clean Git
top-level checkout; untracked internal `.codepatrol/v1/` and `.memorypatrol/v1/`
files do not make subsequent runs dirty. No branch is updated and no commit/push occurs. Reviews and real
verification pass independently. Preflight builds a bounded proposal before worktree
creation, caching contexts by stage/profile and agents by full catalog identity/persona/
profiles. Every stage checks the catalog identity, refreshes its contexts from the
current worktree with bounded safe producer artifact seeds, and reroutes. Resolved
immutable agents are reused, but context never carries over from the previous stage.
Commands are trusted arbitrary processes, not sandboxed code.
Telemetry is lossy advisory data, never a state/approval source. A positive
executor claim alone does not generate positive producer feedback.

Reviewer approval/rejection does not measure reviewer quality. Such telemetry is
always unknown and reviewer history contributes zero adjustment. Valid review
decisions affect producer feedback only; transport/schema failures do not establish
producer quality. Reviewer adjudication is deliberately not invented.

The compact serialized representation is shared by aggregate budget checks and
atomic state writes. Plan/state caps are checked on read and write; state capacity
is reserved for each possible bounded executor response before invocation. Oversize
plans return compact blocked run state without executing stages. RPC rejection
settles once on timeout/overflow without waiting for inherited descendant pipes.
Telemetry rotation owns random exclusive temporary files and shares state-directory
symlink checks. No telemetry failure is authoritative.

## Context Routing

Context is selected from the task and current overview signals before persona/
specialist scoring. Choices are intentionally small and explainable, not additional
execution attempts or a model-quality claim:

| Stage | Default | Task-Appropriate Alternate |
| --- | --- | --- |
| Spec | overview | architecture for refactor/structural work |
| Spec Review | review | none |
| Plan | architecture | implementation for a focused, nonstructural bugfix |
| Plan Review | review | none; preserve review evidence |
| Build | implementation | none |
| Build Review | review | none; preserve review evidence |
| Ship | review | none |

Structural cues include refactoring, architecture, module boundaries and dependency
graphs. Focused bugfix cues include forms, validation, components, functions, methods
and handlers. Stack signals do not change the context profile.

Planning queries overview only for Spec signals, then queries each selected stage
profile. Execution refreshes each selected stage context. The public policy is fixed:
overview is 30 files/24,000 bytes/depth 1; architecture 30/32,000/3; implementation
20/64,000/2; review 20/48,000/3. Context request JSON is bounded below 65,536 bytes.
Safe existing producer paths seed later queries newest first, but ContextPatrol sorts
its selected paths, so seed priority is not output ordering. Generated/artifact
directories are excluded. Its graph is local imports and heuristics; review requires
reported existing source/test artifact paths and never receives fabricated diffs or
changed paths.
The choice and reason are recorded in each route and its alternatives.

Context is fixed by these task rules before historical scoring. General versus
relevant specialist routes still start at 1 and 1.15 and receive the same bounded
history adjustment within the full partition, including chosen context profile.
There is no alternate context candidate that can evade a route's negative history:
three specialized failures still select the general route for the same context.
A genuinely different task/stack-driven context has a separate history partition.
Reviewer feedback remains non-scoring, and review/verification/human approval gates
are unchanged.
