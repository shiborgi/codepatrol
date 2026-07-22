# Specification — Branch-backed Change orchestration

## Intent

- Origin: improve-codebase
- Mode: architecture
- Target baseline: branch `v1-release` at
  `165a8c99cf5f50281605b68846bfef7d8dd04810`; the checkout was clean before
  this proposal added its own untracked v1 package. `main` is `d1ea4f6` and has
  not yet received the v1 product.
- Governing constraints: current `CONTEXT.md` terms **Public Workflow**,
  **Codepatrol Plan**, **Codepatrol Review**, **Codepatrol Apply**,
  **Codepatrol Verify**, **Change Package**, **Operational Memory**,
  **Support Skill**, and **Distribution Adapter**. The implementation replaces
  Change Package and Operational Memory with the terms **Change** and **Stage
  Session**, adds **Codepatrol Finalize**, and updates the glossary atomically
  with the product contract.
- Substrate state: graph present, v1 built at `2026-07-22T02:11:08.634Z`, 58
  files and SHA-256
  `3a35aab35a92184b69c78c6bbf8d9eda7f7500d33adeba6cd176638464eb5d8e`;
  wiki absent, with six expected pages and four uncovered validator files.
- Problem: one work currently has independently writable package, ledger and
  implicit Git states. Their identifiers and lifecycle statuses drift, Status
  hides some drift, resume may pick unrelated work by recency, completed works
  remain open, generated files lack ownership, and no terminal action closes
  the branch. Step attempts, actual token usage and elapsed time are not
  retained.
- Outcome: every Plan creates one branch-backed Change whose event sequence is
  the sole lifecycle truth from Plan through explicit commit or rollback; every
  harness receives an exact next action, every durable/runtime artifact has one
  location and owner, and a deterministic script renders a complete Kanban with
  per-stage and total token/time metrics.

## Scope

### In scope

- Replace schema-v1 artifact packages, workflow roots/ledger, and the Status
  join with a schema-v2 Change aggregate and a deep orchestration interface.
- Require one `codepatrol/<work-id>` branch per Plan, one Change per branch, an
  exact target branch/base commit, stage checkpoint commits, and a Verify-bound
  candidate commit/tree.
- Represent lifecycle, revision, attempts, returns, blocks, next actions,
  provenance, artifact hashes, elapsed intervals, token usage and terminal
  outcome as validated Change events; derive the current view rather than store
  a second status snapshot.
- Keep portable artifacts under stage-owned directories in
  `.codepatrol/changes/<work-id>/`; reject undeclared durable files.
- Replace the global workflow ledger with disposable, explicit work/stage/
  attempt Stage Sessions under `.codepatrol/runtime/sessions/`. Rebuild session
  tasks from the current accepted plan or stage contract.
- Consolidate every ignored Codepatrol file beneath `.codepatrol/runtime/` and
  move durable ADRs to `docs/adr/`. Eliminate root scratch JSON and empty
  architecture namespaces.
- Add `codepatrol-finalize`, with explicit and recoverable `commit` and
  `rollback` outcomes, plus terminal tags and a clean-checkout postcondition.
- Make `codepatrol-status` a read-only dispatcher over the deterministic Change
  projection and add `scripts/render-kanban.mjs` with stable Markdown/JSON
  output, fixed columns, stable ordering, and golden tests.
- Record all Plan, Review, Apply, Verify and Finalize attempts. Calculate
  provider-reported token totals and elapsed durations per stage and for the
  complete work, including rework; expose measurement coverage and never
  substitute estimates for unavailable usage.
- Align README, AGENTS policy, glossary, shared contracts, all primary/support
  skill references, catalog, installers, Pi, OpenCode and tests with the new
  lifecycle.
- Define and test the one-time `v1-release` → `main` cutover that removes v1
  packages/runtime after independent verification and starts schema v2 with an
  empty active board.

### Out of scope

- Backward-compatible reading, migration or status display for schema-v1
  packages and workflow ledgers. Git history is the archive.
- Automatic push, pull, remote branch deletion, force update, rebase, conflict
  resolution, or non-fast-forward integration.
- A provider scheduler, hosted database, external issue tracker, provider
  memory service, MCP server, or storage of raw harness conversations.
- Estimating tokens from artifact bytes, text tokenization, elapsed wall time or
  model pricing when a harness does not report actual usage.
- Cost conversion to currency. Providers price cached/reasoning tokens
  differently; this change records token dimensions and source only.
- Parallel mutation of one Change or automatic lifecycle advancement after a
  primary skill returns. User authority remains required at every primary
  handoff and for Finalize.
- Supporting repositories without Git. The branch-per-Plan requirement makes a
  trusted Git worktree a v2 prerequisite.

## Current evidence

The governing facts are recorded in `evidence/analysis.md`. Load-bearing points
are:

- `src/status/service.ts:19-24` intentionally hides ledger-only roots from the
  default board, contradicting `skills/codepatrol-status/SKILL.md:26-38` and
  allowing stale work to disappear.
- `src/workflow/service.ts:377-383` picks the newest active root when no id is
  supplied. In this session it selected a Verify workflow unrelated to the
  user's new architecture request.
- The current ledger contains 206 items and 34 roots in one 253 KB ignored
  file. Before this proposal, 13 roots were non-closed even though all three
  physical packages were verified.
- The verified `apply-orchestration-hardening` package coexists with open Apply
  root `cpw-f7cc15d62232`. The verified `post-apply-assessment` package coexists
  with Apply and Verify roots still `waiting-user` and carrying obsolete next
  actions.
- Re-running the deterministic Plan gate against `apply-orchestration-hardening`
  fails because its three planned `Create` files now exist. Plan validation is
  therefore checkout-phase dependent rather than bound to its declared base.
- `src/artifact/types.ts:27-31` has one overwriteable timestamp stamp per stage.
  It cannot represent starts, elapsed time, retries, token usage or coverage.
  Schema v1 accepts unknown top-level and nested keys; current manifests already
  use inconsistent extensions.
- `lean-docs/evidence/` contains eight tracked JSON execution files that are not
  declared in its handoff manifest. Root-level workflow payloads and a stale
  graph overview also survive with no owner.
- Git has only `main` and `v1-release`; three independently reviewable works
  were committed on `v1-release`. Package `base_ref` values do not identify a
  unique delivered diff on the shared branch.
- Pi's installed session contract exposes actual assistant token usage and
  extension completion events. Generic filesystem skill adapters do not expose
  one portable usage hook, so explicit unavailable records are necessary for
  honest cross-harness totals.
- The baseline `npm run verify` is green: typecheck, 185/185 tests, build,
  compiled CLI smoke and skill lint all pass. The replacement may not trade
  current graph/wiki/workspace safety for lifecycle simplification.

Confidence is high for repository behavior because commands, source, manifests,
ledger data and Git refs were inspected directly. The only measurement gap is
the actual token usage of this v1 Plan session: v1 did not capture a start
snapshot or provider usage, so it cannot be reconstructed honestly.

## Proposed design

### Domain model and invariant

A **Change** is the complete, independently reviewable work identified by one
`work_id`, one active branch and one validated event sequence. It replaces both
Change Package and workflow root. A **Stage Attempt** is one Plan, Review, Apply,
Verify or Finalize attempt within the Change. A **Stage Session** is ignored,
rebuildable operational progress for exactly one attempt. A **Terminal Outcome**
is either `committed` or `rolled-back` and always has a recoverable Git tag.

The tracked layout is:

```text
.codepatrol/changes/<work-id>/
├── change.yaml
├── plan/
│   ├── spec.md
│   ├── plan.md
│   └── evidence/
├── review/
│   ├── report.md
│   └── evidence/
├── apply/
│   ├── journal.md
│   └── evidence/
├── verify/
│   ├── report.md
│   └── evidence/
└── finalize/
    └── receipt.md
```

`change.yaml` schema v2 stores immutable identity (`work_id`, title, creation
time, branch, target branch and base commit) plus ordered events. It does not
store an independently editable current status. The fold validates sequence,
allowed transition, attempt number, revision, previous/current checkpoint,
artifact ownership/hashes, actor, next action and metrics. Unknown fields,
undeclared durable files, path escapes, hash drift, branch mismatch, conflicting
refs and invalid event order fail closed.

The public TypeScript seam is deliberately small:

```typescript
startChange(workspace: string, input: StartChangeInput, options?: OperationOptions): Promise<ChangeView>
transitionChange(workspace: string, workId: string, intent: TransitionIntent, options?: OperationOptions): Promise<ChangeView>
inspectChanges(workspace: string, query?: ChangeQuery): Promise<ChangeView[]>
finalizeChange(workspace: string, workId: string, input: FinalizeInput, options?: OperationOptions): Promise<FinalizeResult>
```

`TransitionIntent` is a discriminated union for begin, checkpoint, return,
block, resume and usage events. Callers never mutate YAML, sessions or Git refs
directly. An injected `GitAdapter` has production and in-memory fixture
adapters; artifact hashing, event validation, locks and crash recovery stay
behind the Change interface.

### Lifecycle

The only forward route is Plan → Review → Apply → Verify → Finalize. Review
`approve` advances to Apply; `fix-first` or `rework` returns to a new Plan
attempt with recorded findings. Apply may block on an external condition;
contract or plan defects return to Plan. Verify `commit` advances to Finalize;
implementation defects return to a new Apply attempt, while any contract defect
returns to Plan. Every return invalidates later accepted attempts in the
projection without erasing their history.

Every projected non-terminal Change has exactly one current stage and a
non-empty next action containing the work id, expected branch and exact primary
skill/CLI entry. No command may choose by recency. Status may list all rows, but
resume always requires a work id.

### Git contract

`startChange` requires a clean trusted worktree and a named target branch,
creates `codepatrol/<work-id>` from its exact head, writes the initial Change,
and creates a system checkpoint commit. A stage begins only on that branch and
only from the projected predecessor. A successful stage checkpoint commits the
Change events and owned artifacts, leaving a clean tree and binding the next
stage to the exact checkpoint. Verify binds its report to both candidate commit
and tree hash.

Finalize is the only normal module allowed to close the branch:

- `commit` requires explicit user authority, a current Verify `commit` verdict,
  unchanged target ref, a clean tree, and fast-forward-only integration. It
  writes `finalize/receipt.md`, records a terminal event, creates a terminal
  checkpoint and `codepatrol/committed/<work-id>` tag, validates the target,
  then deletes the feature branch. A failure keeps a tagged/checkpointed ref and
  an idempotent next action.
- `rollback` requires explicit user authority, writes the receipt/event,
  creates `codepatrol/rolled-back/<work-id>` before deleting the feature branch,
  leaves the target tree unchanged, and validates a clean checkout. The tag
  keeps the entire abandoned Change recoverable.

If the target ref advanced, Finalize refuses rather than rebasing or resolving.
The Change returns to an explicit sync/reverification action; no verified tree
is silently changed.

### Runtime and resume

All ignored state moves under `.codepatrol/runtime/`: graph, wiki manifest and
transactions, sessions, evaluations, locks, temporary inputs and state version.
Each Stage Session is keyed by work id, stage and attempt. It may contain bounded
tasks, dependencies, claims, conclusions, artifact paths and next action, but
never owns lifecycle, revision, approval, terminal outcome or project-wide
decisions. If absent or corrupt, it is discarded and rebuilt from the Change's
current accepted artifacts. Project language lives in `CONTEXT.md`; durable
architectural decisions live in `docs/adr/`.

### Metrics

Every stage attempt contains one or more run records. The CLI records start and
finish timestamps and computes non-negative elapsed milliseconds. Completed run
intervals contribute to active time; first Change start through terminal event
is reported separately as cycle time. Interrupted/incomplete intervals remain
visible and reduce timing coverage rather than being guessed.

Token records have two valid shapes:

```typescript
type TokenUsage =
  | { status: "measured"; source: "provider" | "harness"; input: number; output: number;
      cacheRead?: number; cacheWrite?: number; reasoning?: number; total: number }
  | { status: "unavailable"; reason: string };
```

The Pi adapter calculates a delta from provider usage surfaced by assistant
messages/events. Other harnesses may submit an equivalent measured envelope at
stage sealing. Every run must contain measured or unavailable status. Totals sum
all attempts and all measured dimensions exactly once, show `measured_runs /
total_runs`, and mark incomplete totals. Cached/reasoning fields are not added
again when the provider total already includes them. Raw transcripts, prompts
and credentials are forbidden.

### Deterministic Kanban

`src/change/board.ts` is a pure projector/renderer used by both the CLI and
`scripts/render-kanban.mjs`. Discovery reads active `codepatrol/*` branches,
terminal tags and the current worktree overlay; it never joins a second ledger.
Duplicate work ids with different records are errors. Rows sort by creation ISO
timestamp then work id. Columns are fixed: Work, Branch, Plan, Review, Apply,
Verify, Finalize and Total. Each stage cell contains attempt/result, measured
tokens with coverage, and elapsed duration. Finalize shows `commit <sha>` or
`rollback <sha>`. Total shows all-attempt tokens, active duration and cycle time.

Markdown and JSON outputs use UTC, fixed ASCII status symbols, integer token
counts, deterministic duration formatting and no locale-dependent formatting.
An active interval is not advanced by the current clock unless the caller passes
an explicit `--as-of`; golden fixtures therefore reproduce byte-for-byte.
`codepatrol-status` prints this output rather than asking the model to construct
or reinterpret a table, and then repeats the exact projected resume command.

### Artifact and baseline validation

Stage validation receives the recorded baseline/checkpoint tree. A Plan `Create`
marker is checked against its Plan baseline, not whichever checkout exists after
Apply. Review, Apply and Verify validate the immutable accepted checkpoint and
their own owned artifacts. The validator can therefore be re-run after
implementation without changing meaning.

All writers retain workspace containment, per-Change and Git locks, cancellation
checks and atomic file writes. The orchestrator writes artifacts first and the
event/checkpoint last; recovery recognizes incomplete operations and either
finishes the idempotent step or leaves the previous projection unchanged.
`change doctor` may rebuild runtime and report durable drift, but may never
refresh hashes, alter events, delete refs or repair production files silently.

## Alternatives

1. Harden schema-v1 package and global ledger with transactions and a doctor.
   Rejected because two portable/local identities and status vocabularies remain
   independently writable; branch, metrics and Finalize would create more
   reconciliation state. Compatibility is not required.
2. Use Git commits/tags as the only lifecycle state. Rejected because interrupted
   work, next actions, artifact ownership and per-run metrics do not fit safely
   in commit naming conventions, and ordinary rebase/squash operations would
   rewrite the domain model.
3. Expose one command/module per stage. Rejected as the central seam because it
   duplicates transition, lock, hashing and metrics rules. Stage-specific CLI
   ergonomics may adapt to one discriminated `transitionChange` interface.

## Simplicity decision

- Selected rung: minimum new implementation.
- Earlier rungs: the behavior must exist because every acceptance criterion
  depends on an enforceable lifecycle. Current package/workflow/status modules
  cannot be reused without preserving the split truth. Node/YAML primitives do
  not supply the domain state machine. Git natively supplies refs, snapshots
  and rollback, and is reused for those responsibilities, but it does not own
  stage contracts, interrupted sessions or usage metrics. Installed dependencies
  add no missing orchestrator. A direct guard in Status cannot prevent writes
  through artifact/workflow commands.
- Irreducible complexity: one validated Change event fold, one Git adapter, one
  disposable session store, and one deterministic board/usage projection hide
  branch safety, artifact ownership, transitions, retries, recovery and metrics
  behind four public functions.
- Safety floor: exact explicit work id; clean-worktree and branch/ref checks;
  path/symlink containment; locks and cancellation; immutable checkpoint/hash
  binding; no recency selection; no automatic force/rebase/push; explicit user
  authority for commit/rollback; recoverable tags before branch deletion;
  honest token/timing coverage; no raw conversations or secrets; complete
  contract, affected and wider verification gates.
- Expected surface delta: remove the artifact, workflow and status modules and
  their global state contracts; add one `src/change/` module family, a
  deterministic Kanban script, a Finalize skill/adapter entry, and schema-v2
  lifecycle/runtime documentation. Modify CLI, state paths, skills, catalog,
  installer contracts, Pi/OpenCode adapters, README, AGENTS, glossary,
  `.gitignore`, package scripts and smoke/contract tests. Add no dependency,
  network service, public configuration file or external runtime state beyond
  Git branches/tags and `.codepatrol/runtime/`.

## Deferred constraints

| ID | Chosen simplification | Known ceiling | Observable trigger | Upgrade path |
|---|---|---|---|---|
| DC-1 | Discover local active Changes from Codepatrol branch/tag refs and the current worktree; no remote registry | Rows created only on an un-fetched remote are invisible locally | A user supplies a fetched repository where an expected `work_id` exists only on a remote ref | Add an explicit, read-only `--remote <name>` discovery adapter; never fetch implicitly |
| DC-2 | Require fast-forward-only Finalize | Concurrent target changes prevent otherwise valid integration | Finalize reports `TARGET_ADVANCED` for a verified Change | Add an explicit sync event that merges the target into the feature branch, invalidates Verify, and requires a new Verify attempt before Finalize |
| DC-3 | Provider/harness token envelopes; unavailable is valid and visible | Filesystem-only harnesses may have incomplete token coverage | A supported adapter exposes a stable authoritative usage hook | Add an adapter-specific collector that emits the same portable measured envelope; do not parse transcripts |

## Compatibility and rollout

This is an intentional schema and CLI break. Delete v1 artifact/workflow/status
commands and do not read `.codepatrol/packages/` or
`.codepatrol/workflows/ledger.json` in v2. Installation is upgraded in place by
the normal local installer after the code lands.

The current work is completed under the old v1 package because it defines v2.
After Review, Apply and independent Verify report commit-ready evidence, the
user explicitly merges `v1-release` into `main`. On clean `main`, the documented
bootstrap checklist resolves the exact tracked `.codepatrol/packages/` paths and
ignored v1 runtime paths, deletes only those verified targets, regenerates empty
v2 runtime state, runs the full project gate and deterministic board, commits
the cleanup, tags the cutover, and deletes `v1-release`. The expected board has
zero active rows. A failure before the cleanup commit is recoverable from
`v1-release` and Git history.

Normal v2 rollback is branch-local and never rewrites the target. Normal commit
is fast-forward-only and validates the target before deleting the feature
branch. Remote publication remains an explicit separate user action.

## Risks and mitigations

- Git command failure between checkpoint operations could leave refs/artifacts
  partially advanced. Mitigation: injected adapter, exact precondition SHAs,
  per-Change/Git lock, idempotent transaction marker, terminal tag before
  deletion, and crash-point tests.
- Event logs could grow after many rework cycles. Mitigation: Changes are
  independently bounded; events are concise and Git history is the archive. Do
  not add compaction until a measured ceiling is observed.
- Automatic checkpoint commits change the existing no-commit workflow.
  Mitigation: document system checkpoint versus terminal integration, require a
  dedicated branch, never push, and make this behavior part of explicit primary
  invocation.
- Token totals can be incomparable or incomplete across providers. Mitigation:
  retain source/model/dimensions, show measurement coverage, never estimate,
  and do not calculate currency.
- A deterministic board scanning refs may encounter a manually rewritten
  branch. Mitigation: validate work id, event sequence, checkpoint and tag;
  surface conflicts as blocking errors rather than choosing one copy.
- The broad breaking rewrite can leave prose/adapter drift. Mitigation:
  catalog-driven contract tests enumerate every primary, path, order, stop rule,
  deterministic script and adapter; full installer/smoke gates are mandatory.
- The current package cannot measure its own tokens retroactively. Mitigation:
  state the gap; verification must not invent a value. Schema-v2 capture starts
  with the first v2 Change.

## Acceptance criteria

- AC-1: Given a clean Git target and a new Plan intent, `change start` creates
  exactly one `codepatrol/<work-id>` branch and one valid schema-v2 Change whose
  projected current stage is Plan; a second branch/id mapping or dirty baseline
  is rejected without partial state.
- AC-2: Given any valid or invalid sequence of Plan, Review, Apply, Verify and
  Finalize events, the Change fold produces exactly one permitted current stage
  and exact next action or rejects the sequence; no command resumes by recency.
- AC-3: Given stage artifacts and a recorded baseline/checkpoint, validation
  binds every durable file to its stage and hash, rejects undeclared files and
  drift, and yields the same Plan result before and after Apply.
- AC-4: Given an absent or corrupt Stage Session, the current attempt is rebuilt
  from the Change and accepted plan without changing lifecycle; all ignored
  Codepatrol state exists only under `.codepatrol/runtime/` and root scratch
  inputs are cleaned.
- AC-5: Given successful or returned stage attempts, system checkpoint commits
  bind exact artifacts/source, preserve every attempt and invalidate stale
  downstream acceptance without erasing provenance.
- AC-6: Given measured and unavailable run usage across retries, every stage and
  total reports exact summed tokens, measured/total coverage, active elapsed
  time and cycle time; unavailable data is never estimated or silently omitted.
- AC-7: Given a fixed set of Change branch/tag fixtures and an optional fixed
  `--as-of`, `scripts/render-kanban.mjs` produces byte-identical Markdown and
  JSON with one row per Plan and fixed Plan, Review, Apply, Verify, Finalize and
  Total columns; each active row includes the exact resume command.
- AC-8: Given a Verify `commit` verdict and explicit Finalize `commit`, the exact
  verified Change integrates fast-forward-only into its unchanged target,
  receives a recoverable terminal tag/receipt, deletes its feature branch only
  after validation, and leaves a clean valid checkout.
- AC-9: Given explicit Finalize `rollback`, the target tree remains unchanged,
  a recoverable rollback tag/receipt preserves the Change, the feature branch is
  removed only after the tag exists, and the checkout is clean and valid.
- AC-10: Given target advance, branch mismatch, hash drift, missing authority,
  path escape, cancellation or injected crash at a mutation point, the
  orchestrator fails closed with an idempotent exact next action and never
  force-updates, rebases, pushes or silently refreshes governing data.
- AC-11: Given any installed supported harness, catalog, installer, Pi/OpenCode
  adapters, primary/support skills, README, AGENTS and glossary agree on the
  five-stage lifecycle plus read-only Status, stage ownership, explicit IDs,
  metrics and terminal stop rules; all contract/lint/smoke tests pass.
- AC-12: Given the independently verified `v1-release` cutover and explicit user
  authorization, merging to `main` and removing exactly the v1 tracked packages
  and ignored runtime leaves `main` clean, the complete project gate green, no
  active legacy artifacts, and the schema-v2 Kanban empty and valid.

## Decisions and open questions

- Decision: one Change event sequence is authoritative; Git refs identify
  snapshots and Stage Sessions are rebuildable execution memory. Neither may
  introduce another lifecycle status.
- Decision: the deep interface is `startChange`, `transitionChange`,
  `inspectChanges`, and `finalizeChange`; CLI commands and skills are adapters.
- Decision: five lifecycle primaries are ordered Plan, Review, Apply, Verify,
  Finalize. Status remains a read-only public dispatcher without lifecycle
  order.
- Decision: every Plan owns one `codepatrol/<work-id>` branch. System checkpoint
  commits are local workflow snapshots; Finalize commit is target integration.
- Decision: the lifecycle ends only at `committed` or `rolled-back`; Verify
  `commit` means ready for Finalize, not complete.
- Decision: metrics include all attempts. Token values require provider/harness
  measurement; incomplete coverage is explicit. Time distinguishes summed
  closed-run active duration from end-to-end cycle time.
- Decision: the Kanban is code-generated and byte-deterministic. The Status
  skill must not redraw or reinterpret it.
- Decision: v2 requires Git and ships no schema-v1 compatibility reader. The
  current branch uses an explicit one-time, post-verification cutover.
- Domain invariant cross-check: current Plan/Review/Apply/Verify responsibilities
  and Support Skill/Distribution Adapter meanings remain. Change Package and
  Operational Memory are replaced rather than overloaded. Approve, Fix-first
  and Rework retain review meaning. Verify's `commit` becomes a gate to
  Finalize; only Finalize owns terminal commit/rollback. `CONTEXT.md` is not
  edited by this proposal because these terms are not current until the reviewed
  implementation lands; its update is an atomic implementation task.
- Open questions: None. DC-1 through DC-3 are trigger-bearing limits, not
  unresolved scope or interface decisions.
