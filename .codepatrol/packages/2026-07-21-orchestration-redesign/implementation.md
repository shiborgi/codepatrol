# Implementation — Branch-backed Change orchestration

- Package revision: 1
- Approval: `review.md` verdict approve
- Target start ref: `v1-release` (`165a8c99cf5f50281605b68846bfef7d8dd04810`)
- Actors: pi initial implementation; codex Verify-return correction
- Status: implemented

## Baseline reconciliation

Implementation-stage artifact validation passed for revision 1 with approval
`approve` and matching `reviewed_revision`. The checkout is on `v1-release` at
the approved base ref and has no tracked modifications; the only untracked
paths are this governing package. The wiki is intentionally absent at baseline
while the graph exists; no wiki write is performed during Apply. The approved
plan is sequential T1 through T9. T10 was subsequently executed by Verify with
verdict `improve`; this Apply session corrects every recorded finding and
returns the same revision for a fresh independent verification.

## Task journal

Execution evidence is appended after each claimed task. T1 through T9 are
owned by this Apply session; T10 is intentionally excluded.

### T1 — replacement contract

- Claimed workflow item `cpw-89f34490c0fd` under Apply root
  `cpw-a2559675bb5f`.
- Added the four schema-v2 YAML fixtures plus focused Change, Git and board
  tests. The required red command was
  `node --test --import jiti/register src/change/change.test.ts src/change/git.test.ts src/change/board.test.ts`.
  It failed only on the absent `board.js`, `model.js` and `git.js` imports (3
  test files failed before execution), which is the planned missing-surface
  signal rather than a fixture or Git failure.
- The minimum module skeleton and fold/usage behavior subsequently made the
  same command green: 6/6 tests. `npm run typecheck` also passed.

### T2–T5 — Change aggregate, sessions, Git and Kanban

- Implemented a strict schema-v2 record and event fold with unknown-field,
  event-order, branch/work-id, transition, return/invalidation and duplicate-run
  rejection. There is no persisted status snapshot; stage, attempt, revision,
  checkpoint, exact next action and totals are projections.
- Added stage-owned artifact hashing/undeclared-file checks, disposable scoped
  Stage Sessions under `.codepatrol/runtime/sessions/`, actual-or-unavailable
  token envelopes, all-attempt coverage, active duration and terminal cycle
  time.
- Added the four-function orchestration seam, argv-array Git adapter, branch
  checkpoints, target-ref guard, recoverable terminal tags and commit/rollback.
  The rollback fixture proves target commit/tree equality, tag-before-delete,
  branch deletion and clean postcondition in a temporary repository.
- Added the pure Kanban projector/Markdown renderer and
  `scripts/render-kanban.mjs`. Fixed columns, sort, integer usage, coverage and
  durations are locale-independent; the current clock is used only through an
  explicit `--as-of`.
- Focused suite passes 11/11 under both `TZ=UTC` and
  `TZ=Pacific/Auckland`; `npm run typecheck` passes.

The T2–T5 implementations were introduced behind the single T1 missing-module
red barrier and then expanded incrementally. Separate import-level reds for
each file would have repeated the same missing-surface signal, so the journal
records the combined red/green boundary instead of claiming unobserved failures.

### T6 — CLI replacement and v1 module removal

- Replaced the public lifecycle CLI with `status` and explicit
  `change start|inspect|transition|session|doctor|finalize` commands. All
  commands use the four-function orchestration seam; no CLI path writes a
  Change record or Git ref directly.
- Removed `src/artifact/`, `src/workflow/` and `src/status/` completely. The
  smoke and CLI suites assert that their former commands are invalid and that
  JSON errors remain stable.
- Required stage artifacts are checked at the accepting transition: Plan owns
  `spec.md` and `plan.md`, Review owns `review.md`, Apply owns
  `implementation.md`, and Verify owns `verification.md`.
- CLI, Change, Git and board tests pass as part of the 107-test full suite.

### T7 — lifecycle skills and shared contracts

- Replaced the package/ledger contracts with `CHANGE.md` and `SESSION.md`, and
  rewrote Plan, Review, Apply, Verify and read-only Status around explicit work
  ids, stage ownership, one-stage stop rules, checkpoint events and honest
  metrics.
- Created `codepatrol-finalize` with the skill-creator scaffold, then narrowed
  it to explicit authority, exact target/ref validation, terminal receipt/tag,
  local-only integration and clean-tree postconditions. Its generated metadata
  and skill directory pass the skill validator.
- Catalog ordering is Plan 1, Review 2, Apply 3, Verify 4, Finalize 5; Status is
  unordered and read-only. Support dependencies remain reciprocal and acyclic.

### T8 — harness distribution and usage capture

- Published the six primary entry points to Pi, OpenCode and Codex metadata.
  Installer tests remain catalog-driven and the all-harness dry-run identifies
  only the newly introduced Finalize links plus Pi package refresh.
- Pi sums numeric provider token dimensions and exposes one internal
  `codepatrol_record_run` call that the lifecycle prompt must invoke before its
  checkpoint or Finalize transition. The recorder appends exactly one run to
  the explicit Change/stage attempt; it never persists prompts, messages or
  inferred token values, and missing provider data remains unavailable.
- Adapter, package-contract and install tests pass inside the full suite.

### T9 — storage, policy and documentation

- Consolidated rebuildable graph, wiki and Stage Session state below
  `.codepatrol/runtime/`; v1 graph/workflow paths have no compatibility reader.
  The temporary v1 ignore entries are explicitly labeled bootstrap-only until
  independent Verify and the separately authorized cutover.
- Rewrote README, AGENTS, CONTEXT, smoke documentation and lifecycle/runtime
  references around Change, Stage Attempt, Stage Session, Terminal Outcome and
  Finalize. Removed the obsolete artifact-handoff and workflow-memory docs.
- `graph sync` rebuilt 58 sources in the new runtime path. Impact analysis from
  the approved base found the affected Change/CLI/graph/wiki surfaces and 15
  affected tests. `wiki status` reports the wiki absent and the graph present;
  Apply intentionally does not invent or publish a wiki.
- Vocabulary/path contract tests, `git diff --check`, deterministic empty-board
  rendering and the complete project gate pass.

### Closing hardening audit

- A direct read of the Git seam found and closed interruption windows not
  covered by the first happy-path fixtures. `change start` now compensates an
  initial commit failure; repeated transitions close a pending event exactly
  once; Finalize resumes after an already-applied checkout or merge by using
  the terminal tag/record. Temporary-repository tests prove clean refs/trees.
- JSON intents and durable events now reject unknown types/outcomes/fields,
  unsafe refs/paths, invalid stage/results, malformed hashes, inconsistent run
  time and token envelopes before mutation. Apply persists its complete
  production `changes` list in the checkpoint event.
- Apply Stage Sessions deterministically derive `T<N>` items and dependencies
  from the accepted plan, rebuild corrupt JSON, reject cycles/unknown fields and
  refuse stale attempts. The terminal fixtures now traverse every stage.
- Markdown Kanban rows now include the exact resume command. Active cycle time
  is computed only with explicit `--as-of`, preserving clock-free defaults.
- Packaging audit found stale compiler output from deleted v1 modules. Build
  now removes only the validated generated `dist/` path before TypeScript
  compilation; smoke fails if a v1 output directory survives. `npm pack
  --dry-run` contains 212 entries, includes Change/Finalize/Kanban, and contains
  no `dist/src/artifact`, `dist/src/workflow` or `dist/src/status` entry.

### Verify-return correction — attempt 2

Verify recorded verdict `improve` for six connected orchestration failures.
This Apply session preserved revision 1 and corrected the implementation rather
than changing the approved design:

- Finalize now accepts only the exact Verify checkpoint tree plus its own
  record/receipt metadata. Any post-Verify production edit is `CHANGE_DRIFT`,
  so a terminal commit can no longer deliver code that Verify did not inspect.
- A repository-wide Change/Git lock serializes start, transition and Finalize.
  Start compensation is ownership-aware and branch removal uses an atomic
  expected-ref delete, so a losing concurrent actor cannot delete another
  actor's branch.
- Create, Modify and Delete baselines are resolved from immutable checkpoint
  history and enforced both in the working tree and in referenced commits.
  Ref reads distinguish regular files from symlinks/non-files and use NUL-safe
  path enumeration.
- Status/ref inspection validates artifact bytes and declared paths at the
  referenced commit, rechecks the source ref for movement, and returns
  `CHANGE_CONFLICT` when working-tree and committed Change records diverge.
- Pi no longer submits a second late usage run. Its pre-seal recorder produces
  exactly one measured or unavailable run and covers Finalize as well as the
  other lifecycle stages.
- The obsolete auxiliary worktree and feature branch were removed after the
  shared governing files were byte-compared. The canonical checkout retains
  the newer implementation and verification evidence.

The focused RED command was
`node --test --import jiti/register src/change/git.test.ts .pi/index.test.ts`.
Before the correction it passed 9 of 15 tests and failed on the absent Pi
recorder, foreign-winner cleanup, immutable Modify baseline, post-Verify drift,
and non-current-ref artifact validation. After correction, the expanded focused
Change/Pi suite passed 27/27 and the project gate passed 122/122 tests.

The correction changed nine existing paths (`.pi/index.ts`, its test,
`README.md`, four Change/Git implementation files, and two Change/Git tests).
It added no module, dependency, store, service, scheduler, configuration surface
or public command. The simplicity assessment therefore remains at rung 2:
reuse the existing lock, Git adapter and event fold inside the one approved
orchestration seam.

### Verify-return correction — attempt 3

The second verification returned four integrity findings. This correction closes all four without changing the approved design:

- immutable candidate lineage is now verified by replaying each checkpoint against the exact `change.yaml` prefix stored in that checkpoint, and every inspected checkpoint must be an ancestor of the inspected ref;
- run events and returns are restricted to the current active attempt, and a return requires a finished run;
- measured usage requires safe integer input, output, and total token counters, validates optional counters, and rejects unsafe aggregate overflow;
- checkpoint validation reconciles the complete delta from the prior checkpoint, including already committed changes, requires explicit artifact intent, rejects deleted required artifacts, and makes Apply `changes` exactly match the production delta.

RED evidence was established before mutation: four focused regressions failed for incomplete measured usage, terminal-attempt mutation, mutable Finalize lineage, and undeclared precommitted production changes. A separate required-artifact deletion regression also failed against the previous membership-only behavior.

GREEN evidence:

- focused Change/Git tests passed after the corrections;
- the wider orchestration and contract selection passed 70 tests;
- `npm run typecheck` passed;
- `npm run verify` passed 127 tests, package/skill contract checks, build, lint, and smoke coverage;
- graph sync and impact inspection, wiki freshness inspection, installer dry-run, package dry-run, and `git diff --check` passed.

The actual surface delta remains within the approved scope: nine existing implementation, test, fixture, and documentation paths changed; no dependency, service, store, configuration, or public-command surface was added. Assessment verdict: approve for an independent verification pass. Exact token and elapsed-time metrics are unavailable for this bootstrap v1 execution and were not estimated.

Safe next action: run `codepatrol-verify 2026-07-21-orchestration-redesign` against this exact working tree.

## Deviations

- T2–T5 shared one missing-module red boundary, as recorded above, because
  separate import failures would not add behavioral evidence.
- The v1 native workflow CLI was intentionally deleted by T6. Consequently its
  combined T2–T5 runtime item cannot be closed through the removed command.
  This ignored bootstrap ledger is not a v2 lifecycle source and will be
  removed only during the separately authorized post-Verify cutover.
- The current v1 package cannot report provider token usage retroactively.
  Per the governing specification, this Apply records it as unavailable rather
  than estimating it; schema-v2 Changes capture measured/unavailable usage at
  every stage run.
- This correction session likewise has no authoritative provider token or
  elapsed-time envelope exposed to the v1 package. Both values are recorded as
  unavailable rather than reconstructed from wall-clock observations.

## Acceptance evidence

| Criterion | Implementation | Verification | Result |
|---|---|---|---|
| AC-1 | Start preconditions, unique branch, serialized creation and ownership-aware compensation implemented | Change/CLI concurrency tests green | pass in Apply |
| AC-2 | Strict event fold, explicit ids and next actions implemented | Valid/invalid/return fixtures green | pass in Apply |
| AC-3 | Stage ownership, hashes, undeclared-file checks and immutable Create/Modify/Delete baselines implemented | Working-tree and ref validation tests green | pass in Apply |
| AC-4 | Rebuildable scoped sessions and runtime-only ignored state implemented | Session/state tests green | pass in Apply |
| AC-5 | Checkpoint commits preserve attempts and downstream invalidation | Change/Git tests green | pass in Apply |
| AC-6 | Exactly-one measured-or-unavailable run, retry totals, coverage and elapsed time implemented | Pi/usage/board tests green | pass in Apply |
| AC-7 | Shared clock-free renderer and deterministic script implemented | Cross-timezone and script tests green | pass in Apply |
| AC-8 | Fast-forward commit, verified-tree guard, terminal tag/receipt and atomic branch removal implemented | Temporary Git lifecycle and post-Verify drift tests green | pass in Apply |
| AC-9 | Exact-tree rollback with tag-before-delete implemented | Temporary Git lifecycle test green | pass in Apply |
| AC-10 | Drift, ref movement, record conflict, target advance, authority, path and atomic-write guards implemented | Failure-path and non-current-ref tests green | pass in Apply |
| AC-11 | Skills, catalog, adapters, docs and installers aligned | `npm run verify` and dry-run green | pass in Apply |
| AC-12 | Cutover checklist and bootstrap boundaries documented | Independent Verify and explicit cutover not run | pending by design |

## Surface delta

- Matches the approved architecture: removed the three v1 lifecycle modules and
  two v1 shared contracts; added `src/change/`, one deterministic Kanban
  script/test, two lifecycle/runtime docs and the Finalize skill/command.
- Modified the CLI, runtime paths, graph/wiki consumers, six primary skill
  surfaces, adapters, policy/glossary/product docs and contract tests.
- Public lifecycle seam is exactly `startChange`, `transitionChange`,
  `inspectChanges`, and `finalizeChange`; public CLI has six Change commands
  plus read-only Status. No new package dependency, service, scheduler, remote
  mutation or configuration surface was added.
- Generated runtime state is ignored below `.codepatrol/runtime/`. The current
  v1 governing package remains present until independent Verify and cutover.

## Final verification

Apply closing evidence:

- `npm run verify`: pass — typecheck, 122/122 tests, build, compiled CLI smoke
  and skill lint.
- `node scripts/install-local.mjs --harness all --dry-run`: pass; Finalize is
  the only new skill/command link and Pi would refresh its package registration.
- `node scripts/render-kanban.mjs --workspace "$PWD" --format markdown`: pass;
  deterministic empty v2 board on this bootstrap repository.
- `codepatrol graph sync`, `graph impact --since-ref` and `wiki status`: pass in
  the new runtime layout; wiki remains intentionally absent.
- `git diff --check`: pass.
- `npm pack --cache /tmp/codepatrol-npm-cache --dry-run --json`: pass after the
  expected global-cache permission limitation was isolated to a temporary
  cache; packaged v1 output list is empty.

The correction is ready for T10 to be rerun by `codepatrol-verify`. No merge,
push, Finalize or v1 cutover was run.
