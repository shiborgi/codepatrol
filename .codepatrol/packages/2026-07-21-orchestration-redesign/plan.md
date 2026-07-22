# Plan — Branch-backed Change orchestration

- Work id: `2026-07-21-orchestration-redesign`
- Governing spec: `spec.md`
- Target baseline: branch `v1-release` at
  `165a8c99cf5f50281605b68846bfef7d8dd04810`

## Goal and approach

Replace the independent artifact-package, workflow-ledger and Status systems
with one branch-backed Change aggregate. Implement the target test-first around
one event fold and four-function orchestration interface; retain Git only as the
snapshot/ref adapter and ignored per-attempt sessions only as rebuildable
progress. Then rewire the CLI, deterministic Kanban script, five lifecycle
skills plus Status, distribution adapters, policies and documentation. No v1
compatibility reader remains.

Implementation proceeds through characterization fixtures, pure record/fold and
baseline validation, runtime session/usage accounting, Git orchestration,
deterministic board rendering, CLI replacement, skill/distribution alignment,
and full verification. The current v1 package remains intact through Apply and
Verify. Its deletion is a separately authorized post-verification cutover so the
producer contract is never removed while it governs implementation.

## Global constraints

- Preserve unrelated user changes. Every mutation session begins by validating
  the exact package, branch and Git status; do not reset, force-update, rebase,
  push, or choose a work by recency.
- Production behavior is test-first. Observe the specified focused red signal
  before each minimum implementation. A behavior-preserving move uses a passing
  characterization that must remain green.
- Keep the external Change module interface limited to `startChange`,
  `transitionChange`, `inspectChanges`, and `finalizeChange`. CLI, script and
  harness surfaces adapt to it; they do not mutate YAML, runtime sessions or Git
  refs directly.
- `change.yaml` has immutable identity plus ordered validated events. Do not add
  a mutable top-level lifecycle status, current stage, total, or next action;
  derive those values with the fold.
- Every active Change has branch `codepatrol/<work-id>` and one target/base
  binding. Git mutation uses an injected adapter, exact expected SHAs, locks and
  cancellation. Production and in-memory/test adapters are the two real
  adapters at this seam.
- Terminal integration is fast-forward-only and never remote. Create a
  recoverable tag before branch deletion. Rollback must leave the target tree
  byte-identical.
- All durable Change files are stage-owned and declared/hashed. All ignored
  state is below `.codepatrol/runtime/`; raw logs, conversations, prompts,
  credentials and scratch payloads never enter a Change.
- Token usage is actual provider/harness measurement or explicit unavailable.
  Never infer spend from text length. Sum every attempt and expose coverage.
  Keep active time and end-to-end cycle time distinct.
- The Kanban renderer is pure and shared by CLI and script. Fix ordering, UTC,
  duration/token formatting and symbols. A changing clock affects output only
  when the caller supplies `--as-of`.
- Node.js 20 remains the runtime floor. Reuse `yaml`, Node standard library,
  existing atomic writes, workspace containment, locks and error envelopes. Add
  no dependency, network service, configuration surface or scheduler.
- Update domain language only when the implementation and docs land together.
  Use Change, Stage Attempt, Stage Session and Terminal Outcome consistently;
  do not retain Change Package or Operational Memory as current v2 terms.
- `codepatrol-apply` executes T1 through T9 and stops at `implemented`. T10 is the
  independent Verify duty. The post-verification cutover requires a new explicit
  user instruction and is never run by Apply.

## Simplicity proof

- Selected rung: minimum new implementation.
- Reused capabilities: Node filesystem/crypto/child-process primitives, Git
  refs/commits/tags, installed YAML parser, `atomicWriteFile`, workspace path
  containment, workspace locks, cancellation/error envelopes, code graph, wiki
  status, catalog-driven installers and existing verification commands.
- Forbidden speculative surface: v1 migration reader, external database,
  provider memory, issue tracker, remote ref discovery by default, implicit
  fetch/push, rebase/conflict resolution, currency costing, token estimation,
  event compaction, optional stage ordering, plugin stage types, manually
  rendered Kanban, and a second lifecycle snapshot/cache.
- Expected surface delta: remove `src/artifact/`, `src/workflow/`, `src/status/`
  and their v1 shared docs; add `src/change/`, one Kanban script/test and one
  Finalize skill/command. Modify CLI/state, skills/catalog/contracts, Pi and
  OpenCode adapters, policy/docs/glossary, package scripts and contract/smoke
  tests. Runtime paths consolidate under `.codepatrol/runtime/`. No dependency
  or remote/runtime service is added.

## Acceptance mapping

| Criterion | Task(s) | Verification |
|---|---|---|
| AC-1 | T1, T2, T4, T6 | `node --test --import jiti/register src/change/change.test.ts src/change/git.test.ts` |
| AC-2 | T1, T2, T4, T6 | event-table/property fixtures plus `node --test --import jiti/register src/change/change.test.ts` |
| AC-3 | T1, T2, T6 | baseline replay and undeclared-file fixtures in `src/change/change.test.ts` |
| AC-4 | T1, T3, T6, T9 | session rebuild/corruption tests and `.gitignore`/path contract checks |
| AC-5 | T1, T2, T4 | return/checkpoint invalidation and exact-tree Git fixture tests |
| AC-6 | T1, T3, T5 | usage aggregation tests and golden board totals with incomplete coverage |
| AC-7 | T1, T5, T6 | `node --test --import jiti/register src/change/board.test.ts scripts/render-kanban.test.mjs` run twice under different `TZ` values |
| AC-8 | T1, T4, T7, T8 | fast-forward commit, failure recovery, Finalize contract and adapter tests |
| AC-9 | T1, T4, T7, T8 | rollback target-tree equality, tag-before-delete and Finalize contract tests |
| AC-10 | T2, T3, T4, T6 | path, cancellation, crash-point, ref-race and doctor fail-closed fixtures |
| AC-11 | T6, T7, T8, T9, T10 | `npm run verify` and installer/skill/package contract tests |
| AC-12 | T9, T10, Finalize rollout | independent verification, explicit `v1-release` cutover checklist, clean `main`, full gate and empty v2 board |

## Dependency order

`T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10`.

The order is intentionally sequential because later tasks consume interfaces or
rewrite files owned by earlier tasks. Read-only test commands may run in
parallel, but no tasks have independent write ownership.

### T1 — Freeze the replacement contract with red fixtures

**Purpose:** Establishes red-capable proof for AC-1 through AC-10 before any new
orchestration implementation exists.

**Depends on:** None

**Files:**

- Create: `src/change/change.test.ts`
- Create: `src/change/git.test.ts`
- Create: `src/change/board.test.ts`
- Create: `src/change/fixtures/active-change.yaml`
- Create: `src/change/fixtures/returned-change.yaml`
- Create: `src/change/fixtures/committed-change.yaml`
- Create: `src/change/fixtures/rolled-back-change.yaml`

**Interfaces:**

- Consumes: current v1 behavior only as characterization evidence; no v1 type is
  a target interface.
- Produces: executable schema/event/transition tables, Git fixture scenarios,
  board golden inputs and expected v2 error codes.
- Invariants/errors: every fixture has one work id/branch; invalid event order,
  duplicate branch mapping, drift, incomplete usage and ref races have explicit
  expected errors; test Git repos never use the real repository.

**Simplicity proof:** Static YAML fixtures and Node temporary Git repositories
are enough to demand the complete contract; no test framework or mock library
is added.

**Surface delta:** +7 test/fixture files; no dependency, public interface,
configuration or external runtime state.

**Steps:**

1. Encode the forward route, every return route, block/resume, multiple attempts,
   artifact ownership/hash drift, baseline-stable `Create` validation, measured
   and unavailable token runs, active/cycle time, deterministic board rows,
   commit, rollback, target advance, cancellation and crash points.
2. Use injected clock/Git/filesystem test doubles for pure tests and `mkdtemp`
   repositories for actual Git behavior. Assert target trees and refs, not only
   command exit codes.
3. Run
   `node --test --import jiti/register src/change/change.test.ts src/change/git.test.ts src/change/board.test.ts`.
   Expected red: imports for `types.ts`, `model.ts`, `store.ts`, `validation.ts`,
   `usage.ts`, `git.ts`, `orchestrator.ts` and `board.ts` are missing. A syntax,
   fixture or Git-availability failure is not accepted.
4. Record the exact red command/result in `implementation.md`; do not weaken a
   fixture to match the later implementation.

**Task result:** changed paths, red evidence and any fixture limitation are
appended to `implementation.md`.

### T2 — Implement the Change record, event fold and baseline validator

**Purpose:** Satisfies AC-2, AC-3 and the durable-state portion of AC-10 by
making one validated event sequence the sole lifecycle source.

**Depends on:** T1

**Files:**

- Create: `src/change/types.ts`
- Create: `src/change/model.ts`
- Create: `src/change/store.ts`
- Create: `src/change/validation.ts`
- Modify after T1: `src/change/change.test.ts`

**Interfaces:**

- Produces: `ChangeRecordV2`, `ChangeEvent`, `Stage`, `StageAttempt`,
  `ChangeView`, `TransitionIntent`, `foldChange(record): ChangeView`,
  `readChangeRecord(workspace, workId)`,
  `appendChangeEvent(workspace, workId, event, options)`, and
  `validateStageArtifacts(record, stage, baseline): ValidationResult`.
- Consumes: `atomicWriteFile`, workspace containment, SHA-256, YAML and injected
  clock.
- Invariants/errors: immutable identity; monotonically ordered event sequence;
  exactly one projected stage; explicit work id; allowed transition/attempt;
  non-empty exact next action; stage-owned declared files only; baseline-bound
  path classification; portable paths and symlink containment; unknown schema
  keys rejected. Errors are stable `CHANGE_INVALID`, `CHANGE_DRIFT`,
  `CHANGE_CONFLICT` or `CHANGE_NOT_FOUND` envelopes.

**Simplicity proof:** One event fold replaces artifact status/revision/steps and
workflow-root status/nextAction. A second projection snapshot or generic event
framework is forbidden.

**Surface delta:** +4 production files; one test changes; no dependency or
external state.

**Steps:**

1. Implement the minimum strict schema and table-driven fold needed by the T1
   events. Derive revision, current stage, attempt, current checkpoint, exact
   next action and invalidated downstream attempts.
2. Write/read atomically under a per-Change lock. Validate the complete proposed
   record before replacement; the previous record remains intact on failure or
   cancellation.
3. Bind every stage-owned artifact and reject any unlisted file under the Change
   directory. Evaluate Plan `Create`/`Modify`/`Delete` markers against the
   recorded Plan baseline tree, not the live post-Apply checkout.
4. Run `node --test --import jiti/register src/change/change.test.ts`.
   Expected green at this task: schema, fold, return/invalidation, containment,
   ownership, hash and baseline-replay cases pass; Git/orchestration and metrics
   cases may remain red only where their later modules are still missing.
5. Run the old package regression
   `codepatrol artifact validate --manifest .codepatrol/packages/2026-07-21-apply-orchestration-hardening/handoff.yaml --stage plan --workspace "$PWD" --format json`
   and retain its current phase-dependent failure as characterization evidence;
   the equivalent v2 fixture must pass before and after candidate files exist.

**Task result:** fold table, atomicity and baseline evidence are appended to
`implementation.md`.

### T3 — Add rebuildable Stage Sessions and honest usage accounting

**Purpose:** Satisfies AC-4 and AC-6 without reintroducing lifecycle state in a
second store.

**Depends on:** T2

**Files:**

- Create: `src/change/session.ts`
- Create: `src/change/usage.ts`
- Modify after T2: `src/change/types.ts`
- Modify after T2: `src/change/model.ts`
- Modify after T1: `src/change/change.test.ts`
- Modify: `src/shared/state.ts`

**Interfaces:**

- Produces: `primeStageSession(workspace, workId, stage, attempt)`,
  `readySessionItems`, `claimSessionItem`, `closeSessionItem`,
  `discardAndRebuildSession`, `TokenUsage`, `RunUsage`, and
  `aggregateUsage(events): UsageSummary`.
- Consumes: the projected Change and accepted stage artifacts; session paths
  from `.codepatrol/runtime/sessions/<work-id>/<stage>/<attempt>.json`.
- Invariants/errors: a session key must match the projected current attempt; it
  cannot carry lifecycle/revision/approval/terminal fields; corruption is
  discardable; claims are atomic; each finished run records measured usage or
  explicit unavailable reason; totals deduplicate run ids and expose coverage;
  timestamps and elapsed milliseconds are non-negative and consistent.

**Simplicity proof:** Reuse the useful dependency/claim behavior in a scoped
session but delete global roots, project memories, recency selection and
compaction. Durable decisions stay in Change artifacts/CONTEXT/ADRs.

**Surface delta:** +2 production files; 4 existing/new files change; runtime
paths consolidate; no dependency or public configuration.

**Steps:**

1. Add focused cases for missing/corrupt session rebuild, stale attempt refusal,
   atomic claim, interrupted run, duplicate run id, cache dimensions,
   unavailable usage and multi-attempt totals.
2. Run `node --test --import jiti/register src/change/change.test.ts`.
   Expected red: session/usage behavior is missing while the T2 fold cases stay
   green.
3. Implement the bounded session schema and rebuild operation. Store concise
   results/artifact paths only; reject conversation-like/raw-log payloads above
   the documented limits.
4. Implement measured/unavailable token envelopes and active/cycle aggregation.
   Provider `total` is authoritative; cached/reasoning dimensions are displayed
   but not double-counted. Incomplete runs reduce coverage.
5. Run the focused test again. Expected green: all session and usage cases pass,
   including totals across returned attempts; Git/board imports may remain red.

**Task result:** session rebuild and token/time matrix are appended to
`implementation.md`.

### T4 — Implement branch checkpoints and terminal commit or rollback

**Purpose:** Satisfies AC-1, AC-5, AC-8, AC-9 and the Git/crash portions of
AC-10 through one deep orchestration seam.

**Depends on:** T3

**Files:**

- Create: `src/change/git.ts`
- Create: `src/change/orchestrator.ts`
- Modify after T2: `src/change/types.ts`
- Modify after T2: `src/change/store.ts`
- Modify after T2: `src/change/model.ts`
- Modify after T1: `src/change/change.test.ts`
- Modify after T1: `src/change/git.test.ts`

**Interfaces:**

- Produces: `GitAdapter`, `NodeGitAdapter`, `startChange`, `transitionChange`,
  `inspectChanges`, and `finalizeChange` with the exact signatures from
  `spec.md`.
- Consumes: Change store/fold, Stage Sessions, usage envelopes, filesystem lock,
  injected clock and Git executable.
- Invariants/errors: clean trusted worktree; exact branch/target/base SHA;
  `codepatrol/<work-id>` uniqueness; checkpoint after valid event/artifacts;
  Verify commit/tree binding; unchanged target; fast-forward only; explicit
  final authority; terminal tag before branch deletion; idempotent recovery;
  rollback target equality; no remote, force, rebase or implicit conflict
  resolution.

**Simplicity proof:** Git owns snapshots and refs; the Change owns domain state.
One production and one in-memory adapter make the seam testable without exposing
subcommands to callers.

**Surface delta:** +2 production files; 5 files change; local branches, commits
and tags become declared runtime behavior; no dependency or remote state.

**Steps:**

1. Expand Git fixtures for dirty start, duplicate work/branch, wrong branch,
   successful checkpoints, returned attempts, target advance, commit, rollback,
   cancellation and a failure injected before/after tag and ref operations.
2. Run `node --test --import jiti/register src/change/git.test.ts src/change/change.test.ts`.
   Expected red: orchestration functions/Git adapter are missing while pure
   T2/T3 cases stay green.
3. Implement the Node adapter with argv arrays and captured output; never build
   shell command strings from user data. Validate refs and SHAs before every
   mutation and inject the adapter into orchestration tests.
4. Implement start and transition checkpoints. Write artifacts/events before
   the checkpoint; on failure retain the last accepted projection and an exact
   recoverable next action.
5. Implement Finalize commit and rollback. Create the receipt, terminal event,
   checkpoint and recoverable tag before deleting the branch. Refuse advanced
   targets with `TARGET_ADVANCED`; never auto-sync.
6. Re-run the focused command. Expected green: all state/Git cases pass and each
   temporary repository ends in the asserted clean ref/tree state.

**Task result:** exact Git commands, crash matrix and ref/tree assertions are
appended to `implementation.md`.

### T5 — Generate the Kanban and aggregate metrics deterministically

**Purpose:** Satisfies AC-6 and AC-7 with one pure projection shared by script
and CLI.

**Depends on:** T4

**Files:**

- Create: `src/change/board.ts`
- Create: `scripts/render-kanban.mjs`
- Create: `scripts/render-kanban.test.mjs`
- Modify after T1: `src/change/board.test.ts`
- Modify after T4: `src/change/orchestrator.ts`
- Modify: `package.json`

**Interfaces:**

- Produces: `projectKanban(changes, options): KanbanBoard`,
  `renderKanbanMarkdown(board): string`, JSON serialization and the executable
  `scripts/render-kanban.mjs --workspace PATH --format markdown|json [--all]
  [--as-of ISO]`.
- Consumes: `inspectChanges` projections, active branches, terminal tags and
  current worktree overlay.
- Invariants/errors: one row per work id; conflicting copies fail; stable sort
  by creation time/work id; fixed Work/Branch/Plan/Review/Apply/Verify/Finalize/
  Total columns; UTC and locale independence; explicit clock; all-attempt token
  and timing totals with coverage; exact resume command.

**Simplicity proof:** The script imports the compiled shared projector/renderer;
it does not duplicate table logic or ask a model to format results.

**Surface delta:** +3 files; 3 files change; one package script/export changes;
no dependency or external state.

**Steps:**

1. Define byte-for-byte Markdown and JSON goldens for active, returned,
   blocked, partially measured, committed and rolled-back fixtures.
2. Run
   `TZ=UTC node --test --import jiti/register src/change/board.test.ts scripts/render-kanban.test.mjs`.
   Expected red: board projector/renderer and script output do not exist.
3. Implement discovery/projection with injected refs and optional `asOf`.
   Completed/default output must not call `Date.now()`.
4. Format stage cells with attempt/result, token coverage and duration; format
   Total with all-attempt measured tokens, active duration and cycle time.
5. Add `npm run kanban` and package the script. Run the test once with `TZ=UTC`
   and once with `TZ=Pacific/Auckland`. Expected green: outputs are
   byte-identical and snapshot ordering is unchanged.

**Task result:** golden output, locale/clock proof and metric coverage are
appended to `implementation.md`.

### T6 — Replace v1 CLI, artifact, workflow and status modules

**Purpose:** Satisfies AC-1 through AC-7 and AC-10 at the user-facing CLI while
removing the split-brain implementation.

**Depends on:** T5

**Files:**

- Modify: `src/cli/args.ts`
- Modify: `src/cli/commands.ts`
- Modify: `src/cli/output.ts`
- Modify: `src/cli/cli.test.ts`
- Modify: `scripts/smoke-cli.mjs`
- Delete: `src/artifact/artifact.test.ts`
- Delete: `src/artifact/plan-check.test.ts`
- Delete: `src/artifact/plan-check.ts`
- Delete: `src/artifact/review-check.test.ts`
- Delete: `src/artifact/review-check.ts`
- Delete: `src/artifact/service.ts`
- Delete: `src/artifact/types.ts`
- Delete: `src/workflow/service.ts`
- Delete: `src/workflow/store.ts`
- Delete: `src/workflow/types.ts`
- Delete: `src/workflow/workflow.test.ts`
- Delete: `src/status/service.ts`
- Delete: `src/status/status.test.ts`
- Delete: `src/status/types.ts`

**Interfaces:**

- Produces: `codepatrol status`, `change start`, `change inspect`,
  `change transition`, `change session`, `change doctor`, and `change finalize`
  JSON/text envelopes over the Change module.
- Removes: every `artifact *` and `workflow *` command and all package/workflow
  status joining.
- Invariants/errors: explicit `--id` for inspect/transition/session/finalize;
  stdin/file JSON inputs remain workspace-contained; validation findings have
  nonzero stable exits; Status output is exactly the deterministic renderer;
  doctor may rebuild runtime only and cannot mutate durable events/hashes/refs.

**Simplicity proof:** One command group replaces two state command groups and a
join. The CLI remains a thin adapter; lifecycle rules stay in `src/change/`.

**Surface delta:** 5 files change; 14 v1 source/test files are removed; no new
dependency or network/configuration state.

**Steps:**

1. Rewrite CLI tests around fixed schema-v2 inputs and temporary Git repos.
   Assert old commands return `INVALID_ARGUMENT`; assert missing ids never
   choose a row by recency.
2. Run `node --test --import jiti/register src/cli/cli.test.ts`.
   Expected red: current CLI exposes artifact/workflow commands and cannot serve
   Change/Kanban contracts.
3. Rewire parsing, commands and output to the four-function Change seam and
   session adapter. Preserve workspace resolution, JSON envelopes, exit codes,
   cancellation and path checks.
4. Make `status` return/render the same board object as the script. Include
   exact resume command and measured coverage; never hide malformed/conflicting
   Changes as warnings.
5. Delete the v1 modules only after the Change and CLI tests cover their retained
   safety behavior. Update smoke assertions for new help/status/doctor commands.
6. Run `npm run typecheck`, `npm test`, and `npm run smoke:cli`.
   Expected green: no import references `src/artifact`, `src/workflow` or
   `src/status`; all new and unaffected graph/wiki/shared tests pass.

**Task result:** command matrix, deletion reconciliation and regression results
are appended to `implementation.md`.

### T7 — Rewrite lifecycle skills and contracts around Change

**Purpose:** Satisfies AC-8, AC-9 and AC-11 by giving every harness the same
stage ownership, exact resume protocol, metrics contract and terminal stop.

**Depends on:** T6

**Files:**

- Delete: `skills/_shared/ARTIFACTS.md`
- Delete: `skills/_shared/WORKFLOW.md`
- Create: `skills/_shared/CHANGE.md`
- Create: `skills/_shared/SESSION.md`
- Modify: `skills/_shared/CODEPATROL-CLI.md`
- Modify: `skills/_shared/ROLES.md`
- Modify: `skills/_shared/SPEC-FORMAT.md`
- Modify: `skills/catalog.yaml`
- Modify: `skills/codepatrol-plan/SKILL.md`
- Modify: `skills/codepatrol-plan/MARKDOWN-REPORT.md`
- Modify: `skills/codepatrol-review/SKILL.md`
- Modify: `skills/codepatrol-review/REVIEW-FORMAT.md`
- Modify: `skills/codepatrol-apply/SKILL.md`
- Modify: `skills/codepatrol-apply/IMPLEMENTATION-FORMAT.md`
- Modify: `skills/codepatrol-verify/SKILL.md`
- Modify: `skills/codepatrol-verify/VERIFICATION-FORMAT.md`
- Modify: `skills/codepatrol-status/SKILL.md`
- Create: `skills/codepatrol-finalize/SKILL.md`
- Create: `skills/codepatrol-finalize/FINALIZE-FORMAT.md`
- Create: `skills/codepatrol-finalize/agents/openai.yaml`
- Modify: `skills/assess-change/SKILL.md`
- Modify: `skills/domain-modeling/ADR-FORMAT.md`
- Modify: `skills/execute-change/SKILL.md`
- Modify: `skills/research-technology/SKILL.md`
- Modify: `skills/solution-simplification/SKILL.md`
- Modify: `skills/writing-plans/SKILL.md`
- Modify: `skills/writing-plans/PLAN-FORMAT.md`
- Modify: `scripts/lint-skills.mjs`
- Modify: `scripts/skills-contract.test.mjs`
- Modify: `scripts/package-contract.test.mjs`

**Interfaces:**

- Produces: lifecycle order Plan(1), Review(2), Apply(3), Verify(4),
  Finalize(5), with Status as unordered read-only dispatcher; exact stage
  transition/ownership tables; mandatory stage run metrics; explicit
  checkpoint/stop rule; Finalize commit/rollback receipt.
- Consumes: `change inspect/transition/session/finalize`, Change artifacts and
  deterministic script output.
- Invariants/errors: a primary begins only from its projected stage/branch;
  never invokes the next primary; Plan/Review/Apply/Verify cannot finalize;
  Status cannot manually redraw the table; Finalize requires explicit user
  action and writes only its receipt/event plus authorized Git result.

**Simplicity proof:** Shared CHANGE/SESSION contracts replace duplicated
ARTIFACTS/WORKFLOW prose. Finalize is irreducible because terminal Git mutation
has different authority from Verify's read-only verdict.

**Surface delta:** +5 skill/contract files, -2 v1 contracts, 23 files modified;
one new public skill; no dependency or provider-specific semantic fork.

**Steps:**

1. Update contract tests first to require exactly six public entries (five
   ordered lifecycle skills plus Status), stage-owned paths, branch binding,
   event-only lifecycle state, metrics/unavailable coverage, deterministic
   Status script and Finalize stop/authority rules.
2. Run
   `node --test scripts/skills-contract.test.mjs scripts/package-contract.test.mjs`.
   Expected red: v1 paths/commands, four-stage order and missing Finalize violate
   the new assertions.
3. Write CHANGE/SESSION contracts and update shared personas/formats. Ensure
   every primary begins with explicit `change inspect --id`, starts/finishes a
   run record, checkpoints only its own stage and stops.
4. Rewrite Plan to create the branch/Change before analysis; Review to bind the
   Plan checkpoint; Apply to rebuild the scoped session; Verify to bind the
   candidate commit/tree and advance only to Finalize; Status to execute and
   reproduce script output verbatim; Finalize to perform only explicit commit or
   rollback and leave a clean valid checkout.
5. Update support skill paths/vocabulary and ADR location without changing their
   core responsibilities. Remove every current `.codepatrol/packagesflows/`,
   `.codepatrol/packages/` and `.codepatrol/workflows/` contract reference except
   the clearly marked v1 cutover history.
6. Update catalog/lint order, roles, invocation edges and mutation policy.
   Finalize has `mutation: authorized`; Status has no lifecycle order.
7. Run the focused tests and `npm run lint:skills`. Expected green: catalog,
   relative links, frontmatter, order, paths, stop rules and support edges all
   pass.

**Task result:** lifecycle ownership matrix and skill gate results are appended
to `implementation.md`.

### T8 — Publish Finalize and metrics through every distribution adapter

**Purpose:** Completes AC-8, AC-9 and AC-11 for Pi, OpenCode and filesystem
installers, including automatic Pi usage capture where authoritative data is
available.

**Depends on:** T7

**Files:**

- Modify: `.pi/index.ts`
- Modify: `.pi/index.test.ts`
- Modify: `.opencode/commands/codepatrol-plan.md`
- Modify: `.opencode/commands/codepatrol-review.md`
- Modify: `.opencode/commands/codepatrol-apply.md`
- Modify: `.opencode/commands/codepatrol-verify.md`
- Modify: `.opencode/commands/codepatrol-status.md`
- Create: `.opencode/commands/codepatrol-finalize.md`
- Modify: `skills/codepatrol-plan/agents/openai.yaml`
- Modify: `skills/codepatrol-review/agents/openai.yaml`
- Modify: `skills/codepatrol-apply/agents/openai.yaml`
- Modify: `skills/codepatrol-verify/agents/openai.yaml`
- Modify: `skills/codepatrol-status/agents/openai.yaml`
- Modify: `scripts/install-lib.test.mjs`

**Interfaces:**

- Produces: six canonical adapter entry points; Pi run usage delta envelopes;
  matching OpenCode/Codex prompts with explicit work id/branch/stop semantics.
- Consumes: catalog-driven installer discovery and portable measured/unavailable
  usage schema.
- Invariants/errors: provider usage is recorded only for the active Change run;
  aborted/error messages remain measured with their provider values; adapters
  never persist raw session content; generic adapters submit measured usage only
  when their harness exposes it, otherwise unavailable with reason.

**Simplicity proof:** Installer production already reads primary roles from the
catalog, so only adapter templates/tests change. Pi reuses its installed
assistant usage/event contract; no cross-provider introspection layer is added.

**Surface delta:** +1 OpenCode command, 11 adapter/prompt/test files change; no
installer production change, dependency, credential or network surface.

**Steps:**

1. Update Pi tests to expect Plan/Review/Apply/Verify/Finalize/Status and usage
   capture scoped to a fixed fixture Change. Update installer tests to prove the
   new primary and OpenCode command are linked/unlinked idempotently.
2. Run
   `node --test --import jiti/register .pi/index.test.ts scripts/install-lib.test.mjs`.
   Expected red: Finalize is absent and no Pi usage envelope reaches the Change
   run.
3. Register Finalize, preserve the sequential kickoff, and hook authoritative Pi
   completion usage as a delta for the active run. Store dimensions/identity,
   never messages.
4. Add/update OpenCode and Codex presentation prompts. Status must call the
   deterministic script; Finalize must require an explicit id and action.
5. Re-run the focused test, then
   `node scripts/install-local.mjs --harness all --dry-run`.
   Expected green: six public skills/commands appear exactly once and no support
   skill is exposed.

**Task result:** adapter matrix, usage source and dry-run output are appended to
`implementation.md`.

### T9 — Align storage taxonomy, policy, glossary and product documentation

**Purpose:** Satisfies AC-4, AC-11 and the tested/prepared portion of AC-12 by
making the new model self-contained and removing every competing documented
location.

**Depends on:** T8

**Files:**

- Modify: `.gitignore`
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `CONTEXT.md`
- Delete: `docs/artifact-handoff.md`
- Delete: `docs/workflow-memory.md`
- Create: `docs/change-lifecycle.md`
- Create: `docs/runtime-state.md`
- Modify: `docs/smoke-tests.md`

**Interfaces:**

- Produces: canonical repository/product policy, domain glossary, tracked/runtime
  layout, command reference, branch/checkpoint/finalization contract, metrics
  semantics and the explicit v1 cutover checklist.
- Consumes: implemented schema/CLI/skills and verified file locations.
- Invariants/errors: README remains functional contract; catalog remains role/
  edge authority; Change artifacts remain durable truth; no root progress file;
  no v1 current path promise; destructive cutover names exact targets, requires
  clean `main`/expected SHA and runs only after independent Verify/user authority.

**Simplicity proof:** Two focused docs replace two v1 docs. Glossary records only
settled v2 terms; implementation details remain in lifecycle/runtime docs.

**Surface delta:** +2 docs, -2 v1 docs, 5 policy/docs files change; ignored state
collapses to one runtime root; no dependency or external state.

**Steps:**

1. Rewrite `.gitignore` so `.codepatrol/changes/` stays tracked and the entire
   `.codepatrol/runtime/` is ignored. Remove individual v1 runtime patterns.
2. Update README command/layout/install/workflow/metrics/finalization sections
   from implemented behavior. State Git prerequisite, local checkpoint commits,
   no implicit remote operations, and measured/unavailable token semantics.
3. Replace AGENTS lifecycle, sources of truth, resume, mutation, completion and
   cutover rules. Every harness must begin from `change inspect`, never recency.
4. Replace Change Package/Operational Memory glossary terms with Change/Stage
   Attempt/Stage Session/Terminal Outcome; add Codepatrol Finalize and retain the
   other workflow/verdict meanings.
5. Write lifecycle/runtime docs and smoke cases. The v1 cutover section names
   branch `v1-release`, target `main`, old tracked `.codepatrol/packages/` and
   ignored v1 runtime directories, requires exact inspection before deletion,
   and preserves recovery in Git history/tag.
6. Run `rg -n '\.codepatrol/(packages|workflows)|artifact package|workflow ledger' README.md AGENTS.md CONTEXT.md docs skills scripts .pi .opencode src`.
   Expected: no live v2 contract hit; any history/cutover hit is explicitly
   labeled v1 and cannot be mistaken for a supported path.
7. Run `npm run lint:skills` and the package/skill contract tests. Expected
   green with no broken link, stale primary count, or competing path.

**Task result:** vocabulary/path audit and cutover safety review are appended to
`implementation.md`.

### T10 — Independently verify the complete replacement and blast radius

**Purpose:** Re-verifies AC-1 through AC-12, reconciles actual surface, and
produces the delivery verdict. This task belongs to `codepatrol-verify`, not the
Apply session.

**Depends on:** T9

**Files:**

- No production file mutation; Verify writes only the package's v1
  `verification.md` and allowed manifest metadata until the explicit cutover.

**Interfaces:**

- Consumes: exact implemented diff from
  `165a8c99cf5f50281605b68846bfef7d8dd04810`, governing package, graph impact,
  all Change/Git/board/CLI/skill/adapter tests and rollout checklist.
- Produces: independent commit/improve verdict with classified findings and
  exact commands/results.
- Invariants/errors: re-execute rather than trust implementation claims; inspect
  every deleted/created path; verify no v1 runtime is read; test rollback only
  in fixtures; do not merge, commit, cut over or delete real refs/artifacts.

**Simplicity proof:** One full existing project gate plus focused risk fixtures
is sufficient; no parallel test framework, external service or duplicate report
is added.

**Surface delta:** verification artifacts only; reconcile actual additions,
deletions, public interfaces, Git refs, runtime paths and generated state against
the spec.

**Steps:**

1. Validate the incoming implementation and read the complete spec, plan,
   review, implementation journal and evidence. Confirm the implementation is
   on `v1-release` and no real Finalize/cutover was executed.
2. Run focused suites:
   `node --test --import jiti/register src/change/change.test.ts src/change/git.test.ts src/change/board.test.ts src/cli/cli.test.ts .pi/index.test.ts scripts/render-kanban.test.mjs scripts/install-lib.test.mjs scripts/skills-contract.test.mjs scripts/package-contract.test.mjs`.
   Expected: all pass; red-capability is demonstrated by the recorded T1/T2-T9
   failures and mutation tests.
3. Run the Kanban script twice with the same fixtures under different `TZ`
   values and compare bytes. Inspect measured/unavailable coverage, all-attempt
   totals, elapsed/active/cycle values and exact resume commands.
4. Re-run commit, rollback, target-advanced, cancellation and crash fixtures.
   Confirm all temporary repos end clean; terminal tags precede deletion; no
   remote command is invoked.
5. Run `npm run verify`. Expected: typecheck, complete tests, build, compiled CLI
   smoke and skill lint pass with no warnings attributable to this change.
6. Run `codepatrol graph sync --workspace "$PWD" --format json`, then
   `codepatrol graph impact --since-ref 165a8c99cf5f50281605b68846bfef7d8dd04810 --workspace "$PWD" --format json`.
   Exercise every reported affected test and inspect any affected seam absent
   from this plan.
7. Run `codepatrol wiki status --workspace "$PWD" --format json`. Because the
   wiki is absent at baseline, confirm it remains an intentionally absent valid
   substrate rather than generating an unreviewed bundle. Confirm the graph is
   fresh and `CONTEXT.md`/`docs/adr/` policy matches the delivered model.
8. Inspect `git diff --stat`, `git diff --check`, `git status --short`, all Change
   runtime paths and `npm run kanban`. Reject undeclared durable files, scratch
   JSON, stale v1 code references or a dirty accidental runtime artifact.
9. Map evidence to every AC, reconcile actual surface delta and DC triggers, and
   record residual risk. A green verdict authorizes only the separate Finalize
   rollout below; it does not execute it.

**Task result:** independent evidence and one commit/improve verdict are written
to `verification.md`.

## Finalize rollout after a green T10

This is not an Apply or Verify task. It runs only after a new explicit user
instruction authorizes closing the current release branch.

1. Record the verified `v1-release` SHA and confirm `git status --short` is empty.
   Confirm `main` is the declared target and has not advanced unexpectedly.
2. Integrate `v1-release` into `main` with a fast-forward-only operation. If it
   cannot fast-forward, stop; do not rebase or resolve automatically.
3. On clean `main`, enumerate and verify the exact tracked legacy paths under
   `.codepatrol/packages/` and the exact ignored v1 runtime paths documented in
   `docs/change-lifecycle.md`. Delete only those targets. This intentionally
   includes this v1 governing package after its evidence has been merged into
   Git history.
4. Run `npm run verify`, the compiled v2 `codepatrol status`, and
   `scripts/render-kanban.mjs`. Expected: full gate green, zero active rows, no
   `.codepatrol/packages/` or `.codepatrol/workflows/`, and only the documented
   empty/rebuildable `.codepatrol/runtime/` state.
5. Commit the cutover cleanup on `main`, create the documented v2 cutover tag,
   and delete local `v1-release` only after the tag and clean valid `main` are
   confirmed. Push or remote deletion remains a separate explicit user action.
