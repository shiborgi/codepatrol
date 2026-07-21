# Plan — Apply orchestration and skill contract hardening

- Work id: `2026-07-21-apply-orchestration-hardening`
- Governing spec: `spec.md`
- Target baseline: branch `v1-release`, `HEAD` `1f03fd2`, clean source tree before this package; package artifacts are under `.codepatrol/packages/2026-07-21-apply-orchestration-hardening/`.

## Goal and approach

Harden the existing deep Apply workflow and its shared runtime seams without adding a scheduler, provider integration, or new runtime module. First establish red-capable tests for lock cleanup, symlink typing, workflow conditional invariants, catalog contracts, and hermetic installer verification. Then make the smallest changes at the existing seams, update the portable skill/command/glossary contracts, and finish with the full gate plus diff/surface audit. The implementer must preserve the approved artifact package as immutable and stop at `implemented`; verification remains a separate primary workflow.

## Global constraints

- No new production dependency, service, MCP server, hosted telemetry, PR bot, scheduler, or provider-specific API.
- Use Node standard-library behavior already present for locks and symlinks; reuse the current artifact/workflow/catalog modules.
- Preserve path containment, ownership/conflict rules, atomic writes, cancellation, approval/revision checks, and deprecated `merge` compatibility.
- Keep `approve` canonical and do not change review finding categories.
- `nextAction` is required only for non-closed persisted items; closing removes it and closed records remain valid.
- Primary lifecycle order is Plan → Review → Apply → Verify. No primary may auto-invoke another. Support triggers are conditional and must be explicit in the catalog and prose.
- Evidence is concise and path-based; do not store raw conversation, prompts, secrets, or full logs.
- Preserve unrelated user changes and do not edit package `spec.md`, `plan.md`, `review.md`, or producer evidence during Apply.

## Simplicity proof

- Selected rung: direct local change with local/runtime reuse.
- Reused capabilities: `withWorkspaceLock`, `install-lib.mjs` preflight/rollback, workflow ledger/store, `skills/catalog.yaml`, existing skill linter, artifact-stage validators, and current test seams.
- Forbidden speculative surface: no orchestrator class, plugin registry, new dependency, scheduler, exporter, protocol schema, telemetry store, or generic abstraction used by only one caller.
- Expected surface delta: modify the named runtime seams, tests, catalog/linter/contracts/commands/docs/glossary/package metadata; add only package evidence and no new production module or runtime state.

## Acceptance mapping

| Criterion | Task(s) | Verification |
|---|---|---|
| AC-1 | T1 | injected post-open lock failure test plus `src/shared/workspace.test.ts` and affected writer tests |
| AC-2 | T2 | installer file/dir/rollback tests and `node --test scripts/install-lib.test.mjs` |
| AC-3 | T3 | workflow create/update/load/close tests and `src/workflow/workflow.test.ts` |
| AC-4 | T4 | catalog/Apply contract fixtures and precondition checklist review; `scripts/skills-contract.test.mjs` |
| AC-5 | T4, T5 | task evidence/stop/deviation contract fixtures and Apply format checks |
| AC-6 | T4, T5 | `node scripts/lint-skills.mjs`, `node --test scripts/skills-contract.test.mjs scripts/package-contract.test.mjs` |
| AC-7 | T7 | `codepatrol-verify` runs `npm run verify` in a clean checkout/environment with hermetic installer tests |
| AC-8 | T5, T6, T7 | targeted scans, package/diff/surface audit, and independent delivery verification |

## Dependency order

`T1 → T6`; `T2 → T6`; `T3 → T4 → T5 → T6 → T7`. T2 and T3 are independent after T1's evidence convention is established, but Pi executes them sequentially. T4 must precede T5 because the format and catalog contract is written before skill prose is reconciled. T7 is owned by `codepatrol-verify` and is not an Apply task.

### T1 — Lock failure cleanup and red-capable seam

**Purpose:** Satisfies AC-1 by preventing a lock created by the current attempt from becoming an orphan while preserving ownership safety.

**Depends on:** —

**Files:**

- Modify: `src/shared/lock.ts`
- Modify: `src/shared/workspace.test.ts`

**Interfaces:**

- Consumes: `withWorkspaceLock(workspace, name, command, fn, options)` and standard `node:fs` primitives.
- Produces: post-open failure cleanup that removes only the current attempt's lock path before rethrowing.
- Invariants/errors: `EEXIST` remains a wait/reclaim path; another owner's lock is never unlinked; descriptor cleanup is best effort but no descriptor leaks on the failure path; cancellation and timeout behavior remain unchanged.

**Simplicity proof:** Reuse the existing function and token/record cleanup. No lock abstraction or retry policy is added.

**Surface delta:** one implementation edit and one test; no public API, dependency, configuration, or runtime-state change.

**Steps:**

1. Add a deterministic test at the internal acquisition seam. Refactor `withWorkspaceLock` only as needed so an `/** @internal */` exported `acquireLock(path, token, command, io)` function receives the existing filesystem operations through a narrow `LockIo` object; keep `withWorkspaceLock`'s public arguments and default behavior unchanged. The test imports this internal seam and supplies a `LockIo` whose `writeRecord` throws after the real `openSync(..., "wx")` succeeds, then asserts the operation rejects and the lock path is absent. Add a second assertion that cleanup does not unlink a pre-existing lock owned by another attempt. The internal export is not added to any package barrel or CLI surface.
2. Run `node --test --import jiti/register src/shared/workspace.test.ts`.
   Expected red: the injected post-open failure leaves the lock file present or cannot observe cleanup; setup/syntax failure does not count.
3. Implement an attempt-owned descriptor/path flag. On any non-`EEXIST` error after creation, close the descriptor through a safe best-effort helper, unlink the path only when this attempt created it, and rethrow. Do not broaden cleanup to paths created by other processes.
4. Run the focused test, then `node --test --import jiti/register src/shared/workspace.test.ts src/artifact/artifact.test.ts src/workflow/workflow.test.ts src/wiki/wiki.test.ts`.
   Expected green: all pass and no orphan lock remains.
5. Record exact red/green results and assessment in `implementation.md`; do not close the task without the ownership/race assertion.

**Task result:** changed paths, red/green evidence, assessment, and next action are appended to `implementation.md`.

### T2 — Typed installer links and hermetic installer verification

**Purpose:** Satisfies AC-2 and contributes to AC-7 by making file/dir symlink behavior correct and removing the ambient-CLI test dependency.

**Depends on:** T1

**Files:**

- Modify: `scripts/install-lib.mjs`
- Modify: `scripts/install-lib.test.mjs`

**Interfaces:**

- Consumes: `preflightLink`, `applyLinkPlan`, `rollbackLinks`, `applyRemovalPlan`, and `rollbackRemovals`.
- Produces: each link operation carries a source-derived `linkType`, and all creation/restoration paths use it; tests provide a fake `codepatrol` executable wherever `verify()` checks the CLI.
- Invariants/errors: source type is stable across create/relink/uninstall rollback; user-owned conflicts still fail; broken owned links still remove; dry-run remains write-free; Pi behavior is unchanged.

**Simplicity proof:** Use `lstatSync(source).isDirectory()` and the existing symlink API; do not add a link adapter module. Use the existing test fixture's temporary home/bin for the fake CLI.

**Surface delta:** one script and one test modified; no dependency/config/runtime-state change.

**Steps:**

1. Add/extend tests for an OpenCode command file and a skill directory that assert the symlink target and source-kind behavior. Add a rollback test with multiple operations where a later operation fails, asserting both file and directory links are restored/removed correctly. Set up a fake executable named `codepatrol` in the temporary test home/PATH for every `verify()` call, including the current OpenCode-only test.
2. Run `node --test --import jiti/register scripts/install-lib.test.mjs`.
   Expected red: current implementation either cannot satisfy the file-kind assertion/rollback scenario or the existing OpenCode verification fails because the fake CLI is not supplied.
3. Derive `linkType` from a source `lstat` in the preflight operation and use it in create and rollback functions. Preserve source/target containment and conflict checks.
4. Run the focused suite and `node --test --import jiti/register scripts/package-contract.test.mjs scripts/skills-contract.test.mjs`.
   Expected green: all installer and contract tests pass without ambient global binaries.
5. Record actual source-kind, rollback, and hermetic verification evidence.

**Task result:** changed paths, red/green evidence, assessment, and next action are appended to `implementation.md`.

### T3 — Conditional workflow `nextAction` invariant

**Purpose:** Satisfies AC-3 without introducing the false claim that closed records must retain a next action.

**Depends on:** T1

**Files:**

- Modify: `src/workflow/types.ts`
- Modify: `src/workflow/store.ts`
- Modify: `src/workflow/service.ts`
- Modify: `src/workflow/workflow.test.ts`
- Modify: `src/status/status.test.ts`
- Modify: `src/cli/cli.test.ts`
- Modify: `docs/workflow-memory.md`

**Interfaces:**

- Consumes: `WorkflowItemV1`, `CreateWorkflowInput`, `UpdateWorkflowInput`, `WorkflowRootSummary`, ledger load/write and close transitions.
- Produces: a conditional type/runtime contract: every non-closed item has a non-empty `nextAction`; closed items may omit it; update cannot clear it through a non-close operation. The `WorkflowItemV1` interface keeps `nextAction?: string` (the same JSON shape encodes both states) and a shared `assertNextActionInvariant` helper enforces the conditional rule at create, update, and load time.
- Invariants/errors: malformed non-closed persisted records fail `WORKFLOW_INVALID`; valid closed historical records remain readable; `workflow close` removes the field; summaries continue to omit absent closed actions; all creation fixtures explicitly provide `nextAction` except tests whose purpose is rejection.

**Simplicity proof:** Reuse the existing field and close transition; add validation rather than a schema version or new field. Keep input types expressive for `workflow close` semantics.

**Surface delta:** existing types/service/store/docs/tests modified; no schema version, dependency, or storage location change.

**Steps:**

1. Add tests for: create without `nextAction` rejected for open task/root; update with `nextAction: null` rejected while non-closed; malformed open ledger rejected on load; closed ledger without `nextAction` accepted; successful close removes `nextAction`.
2. Run `node --test --import jiti/register src/workflow/workflow.test.ts src/status/status.test.ts`.
   Expected red: current creation/load/update paths accept missing or cleared `nextAction` for non-closed items.
3. Use a discriminated `WorkflowItemV1` union keyed by `status` or, more practically, keep the single shape and add a shared runtime validator (`assertNextActionInvariant` in `types.ts`) used by create, update, and load. Require the field during non-closed creation/update, reject `nextAction: null` for non-closed items, and preserve close removal. Update `WorkflowRootSummary` similarly where it represents an open root, while keeping `CreateWorkflowInput` and `UpdateWorkflowInput` expressive for create/close semantics.
4. Update `docs/workflow-memory.md` to state the conditional invariant and closed exception.
5. Run workflow/status/CLI affected tests and `npm run typecheck`.
   Expected green: valid lifecycle transitions pass and malformed records fail with stable errors.
6. Record whether any existing valid fixture needed a `nextAction` and confirm no legacy test became meaningless; remove only tests that assert the superseded invalid behavior.

**Task result:** changed paths, red/green evidence, assessment, and next action are appended to `implementation.md`.

### T4 — Catalog and Apply execution contract

**Purpose:** Satisfies AC-4 through AC-6 by making invocation order, support triggers, evidence gates, and stop authority explicit and lintable.

**Depends on:** T3

**Files:**

- Modify: `skills/catalog.yaml`
- Modify: `scripts/lint-skills.mjs`
- Modify: `scripts/skills-contract.test.mjs`
- Modify: `skills/codepatrol-apply/SKILL.md`
- Modify: `skills/execute-change/SKILL.md`
- Modify: `skills/assess-change/SKILL.md`
- Modify: `skills/verification-strategy/SKILL.md`
- Modify: `skills/_shared/EXECUTION.md`
- Modify: `skills/_shared/WORKFLOW.md`
- Modify: `skills/codepatrol-apply/IMPLEMENTATION-FORMAT.md`

**Interfaces:**

- Consumes: catalog role/mutation/reciprocity data, approved package/ledger contracts, and current sequential fallback.
- Produces: minimal `order` metadata for primary workflows and explicit conditional `triggers` entries with exact `target`/`when` values for support invocations; Apply precondition/task/post-task/stop rules; machine checks for contradictions and stale/unsupported edges.
- Invariants/errors: exactly five primaries; no primary-to-primary `mayInvoke`; every declared trigger is a support skill, has a supported target and condition, and is reciprocal; order is Plan < Review < Apply < Verify; support mutation policy matches its declared role; sequential fallback is semantically equivalent to native delegation; semantic deviation never gets hidden as a bounded deviation.

**Simplicity proof:** Extend the existing YAML catalog and linter rather than creating a scheduler or runtime graph. Trigger values are the finite values listed in the specification; no free-form trigger language is introduced.

**Surface delta:** catalog fields, linter rules, contract tests, and prose/format corrections; no runtime command or dependency.

**Steps:**

1. Add failing catalog fixtures/tests for wrong primary order, a non-reciprocal trigger, a primary trigger target, a trigger lacking a condition, an unsupported `when` value, a support skill with an incompatible mutation policy, and a primary skill that lacks the stop/evidence/deviation contract. Refactor `scripts/lint-skills.mjs` to export a `lintSkillTree(root)` function while retaining its current CLI entry point; the test invokes that function against temporary copies of the skill tree.
2. Run `node --test --import jiti/register scripts/skills-contract.test.mjs` and `node scripts/lint-skills.mjs`.
   Expected red: new fixtures expose that current catalog/linter has no order/trigger/command-drift checks.
3. Add only the minimal catalog metadata and deterministic linter checks. Represent each trigger with the exact `{target, when}` shape and the finite `when` values defined in `spec.md`; reject unknown trigger values, missing reciprocal declarations, primary targets, and malformed entries. Validate Agent Skills frontmatter name/description constraints and the recommended instruction-size limit without requiring optional external fields. Do not make the linter parse arbitrary natural language as a workflow engine; check explicit structural declarations and required contract phrases/sections.

   The final trigger table is fixed for this revision:

   | Caller | Target | When |
   |---|---|---|
   | `codepatrol-plan` | `codebase-design` | `when-module-or-seam-change` |
   | `codepatrol-plan` | `diagnose-bug` | `when-bug-mode` |
   | `codepatrol-plan` | `domain-modeling` | `when-domain-term-settled` |
   | `codepatrol-plan` | `grilling` | `when-load-bearing-decision-unsettled` |
   | `codepatrol-plan` | `research-technology` | `when-external-evidence-required` |
   | `codepatrol-plan` | `solution-simplification` | `always-before-recommendation` |
   | `codepatrol-plan` | `writing-plans` | `after-spec-decision-complete` |
   | `codepatrol-review` | `assess-change` | `always-before-verdict` |
   | `codepatrol-review` | `writing-plans` | `when-plan-correction-required` |
   | `codepatrol-review` | `research-technology` | `when-external-evidence-required` |
   | `codepatrol-apply` | `execute-change` | `always-before-task-mutation` |
   | `codepatrol-verify` | `assess-change` | `always-before-verdict` |
   | `codepatrol-verify` | `verification-strategy` | `always-before-verdict` |
   | `assess-change` | `solution-simplification` | `always-before-assessment` |
   | `diagnose-bug` | `verification-strategy` | `after-root-cause` |
   | `domain-modeling` | `codebase-design` | `when-seam-or-module-decision` |
   | `execute-change` | `assess-change` | `after-task-result` |
   | `execute-change` | `codebase-wiki` | `when-wiki-refresh-required` |
   | `execute-change` | `domain-modeling` | `when-domain-term-settled` |
   | `execute-change` | `solution-simplification` | `always-before-task-mutation` |
   | `execute-change` | `verification-strategy` | `when-behavior-change` |
   | `grilling` | `domain-modeling` | `after-decision-tree` |
   | `grilling` | `codebase-design` | `when-seam-or-module-decision` |
   | `solution-simplification` | `codebase-design` | `when-irreducible-seam` |
   | `solution-simplification` | `verification-strategy` | `always-before-recommendation` |
   | `writing-plans` | `solution-simplification` | `always-before-recommendation` |
   | `writing-plans` | `verification-strategy` | `always-before-recommendation` |

4. Rewrite Apply/execute/assessment/shared execution prose to state: exact implementation-stage gate; one claimed task at a time; dependency order; support trigger evaluation before mutation; red/characterization then green; post-task assessment and journal before closure; semantic/environmental routing; final stop and no downstream primary invocation.
5. Run the focused contract tests and `npm run lint:skills`.
   Expected green: valid catalog and all primary/support contracts pass; each intentionally invalid fixture fails for the expected reason.
6. Record trigger/order evidence and confirm no duplicate support skill or contradictory instruction was introduced.

**Task result:** changed paths, red/green evidence, assessment, and next action are appended to `implementation.md`.

### T5 — Distribution, glossary, dependency, and Qodo disposition cleanup

**Purpose:** Satisfies AC-6 and AC-8 by reconciling all shipped instructions and recording why valid/invalid Qodo comments were handled as they were.

**Depends on:** T4

**Files:**

- Modify: `.opencode/commands/codepatrol-plan.md`
- Modify: `.opencode/commands/codepatrol-review.md`
- Modify: `.opencode/commands/codepatrol-apply.md`
- Modify: `.opencode/commands/codepatrol-verify.md`
- Modify: `CONTEXT.md`
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `skills/diagnose-bug/SKILL.md`
- Modify: `skills/domain-modeling/SKILL.md`
- Modify: `skills/grilling/SKILL.md`
- Modify: `skills/codepatrol-plan/SKILL.md`
- Modify: `skills/codepatrol-review/SKILL.md`
- Modify: `skills/codepatrol-status/SKILL.md`
- Modify: `package.json`
- Modify: `package-lock.json` (only if package metadata changes it)
- Create: `.codepatrol/packages/2026-07-21-apply-orchestration-hardening/evidence/qodo-disposition.md`

**Interfaces:**

- Consumes: Qodo report, pinned external revision evidence, canonical README/AGENTS/CONTEXT contracts, and public command templates.
- Produces: coherent shipped instructions: packages path, `approve` vocabulary, generated wiki guidance, pinned attribution, pure glossary terms with `_Avoid_`, and a bounded optional peer range.
- Invariants/errors: command templates cannot contradict their skill; no raw floating inspiration repository URL remains where a pinned revision is claimed; no product promise is added to AGENTS; `approve` remains canonical and Qodo false positives remain documented rather than “fixed” by weakening the parser.

**Simplicity proof:** Text/metadata correction and existing package range only; no docs wiki placeholder, new glossary abstraction, or review integration.

**Surface delta:** documentation, command templates, one package metadata range, and one durable Qodo evidence file; no runtime behavior beyond metadata.

**Steps:**

1. Add a deterministic scan/test for stale `.opencode/commands/` paths/verdicts, floating inspiration URLs, missing `_Avoid_` entries, and peer range `*`.
2. Run the focused scan/test.
   Expected red: current plan/review command templates and floating links are detected; the peer range is `*`.
3. Correct only the verified drift. Pin the three inspiration links to the exact current revisions recorded in `spec.md`/`evidence/reference-concepts.md`; do not claim a revision that was not consulted. Shorten `Distribution Adapter` to functional role and add `_Avoid_` to `Fix-first`/`Rework`. Describe absent wiki as a status/generation condition. Keep historical package evidence unchanged and explicitly excluded.
4. Create `evidence/qodo-disposition.md` with each Qodo item classified as accept, reject/false-positive, or reinterpret, exact verified location, and the test/plan consuming it. Do not duplicate the full report.
5. Add the command-template assertion removed from T4: every `.opencode/commands/codepatrol-*.md` must name its matching skill, use `.codepatrol/packages` where a package path is described, and use `approve`/`fix-first`/`rework` for review verdicts.
6. Run the focused scan, `node scripts/lint-skills.mjs`, and package contract tests.
   Expected green: no shipped command contradiction or unpinned claimed inspiration remains; canonical verdict/category behavior is unchanged.

**Task result:** changed paths, red/green evidence, assessment, and next action are appended to `implementation.md`.

### T6 — Apply closing affected gate and surface audit

**Purpose:** Satisfies the Apply-side portion of AC-5 and AC-8 by reconciling task evidence, affected callers, and actual surface delta. This task is executed by Apply; the full project gate and delivery verdict remain owned by `codepatrol-verify` in T7.

**Depends on:** T1, T2, T3, T4, T5

**Files:**

- Create: `.codepatrol/packages/2026-07-21-apply-orchestration-hardening/implementation.md`
- Modify: `.codepatrol/packages/2026-07-21-apply-orchestration-hardening/handoff.yaml`
- Modify: graph/runtime state only through the existing CLI commands; do not commit generated local state

**Interfaces:**

- Consumes: all task evidence, graph impact, approved AC mapping, and current diff.
- Produces: complete implementation journal, actual surface delta reconciliation, artifact hashes, `steps.apply`, and status `implemented` only when every AC has passing task evidence.
- Invariants/errors: do not run or record a commit verdict; do not auto-invoke Verify; accidental files/debug output stop sealing; semantic deviations return to review.

**Simplicity proof:** Reuse the existing Apply journal and graph/CLI gates; no second report or root progress file.

**Surface delta:** implementation journal/manifest metadata and refreshed graph evidence only; no additional production surface.

**Steps:**

1. Run `node bin/codepatrol.js graph sync --workspace "$PWD" --format json`, then graph impact for `src/shared/lock.ts`, `scripts/install-lib.mjs`, `src/workflow/types.ts`, and all changed skill/catalog files where supported. Confirm the affected test set is included in the journal.
2. Run the final affected gate only: `node --test --import jiti/register scripts/install-lib.test.mjs scripts/skills-contract.test.mjs scripts/package-contract.test.mjs src/shared/workspace.test.ts src/workflow/workflow.test.ts src/status/status.test.ts`, plus `npm run typecheck` and `npm run lint:skills`. Do not run `npm run verify` here; that is T7's independent delivery gate. Expected: all affected checks pass without an ambient global binary.
3. Inspect `git diff --name-status`, `git diff --check`, and tracked/untracked files. Compare every changed path/dependency/interface/config/runtime-state entry to the spec forecast and record actual delta; remove only accidental temporary files within task ownership.
4. Map each AC-N to concrete implementation paths and independently observed commands/results. Confirm no `DC-1` trigger fired; if it did, stop and return to review rather than invent an upgrade.
5. Set implementation journal status `implemented`, stamp `steps.apply`, run `node bin/codepatrol.js artifact record --manifest .codepatrol/packages/2026-07-21-apply-orchestration-hardening/handoff.yaml --workspace "$PWD" --format json`, then validate the implementation stage.
6. Stop and report the package path, commands/results, residual risks, and explicit recommendation to run `codepatrol-verify`. Do not invoke it automatically.

**Task result:** changed paths, affected gate, actual surface delta, acceptance evidence, and safe next action are appended to `implementation.md`.

### T7 — Independent delivery verification

**Purpose:** Satisfies AC-7 and the independent portion of AC-8. This task belongs exclusively to `codepatrol-verify` and must not be claimed or executed by `codepatrol-apply`.

**Depends on:** T6

**Files:**

- Create: `.codepatrol/packages/2026-07-21-apply-orchestration-hardening/verification.md`
- Modify: `.codepatrol/packages/2026-07-21-apply-orchestration-hardening/handoff.yaml`

**Interfaces:**

- Consumes: implemented package, `implementation.base_ref`, complete diff, all governing artifacts, graph impact, and task evidence treated as claims to re-execute.
- Produces: independent AC-1 through AC-8 verification, full `npm run verify` result, blast-radius/unplanned-change audit, and exactly one `commit` or `improve` verdict.
- Invariants/errors: verification never edits production code or approved artifacts; an implementation-only defect returns to Apply; a contract or mixed defect returns to Plan; no verdict is granted on inherited claims alone.

**Steps:**

1. Validate the verification stage and read `spec.md`, `plan.md`, `review.md`, `implementation.md`, and governing evidence.
2. Re-run every acceptance check, then run `npm run verify` in a clean checkout/environment. Expected: typecheck, all tests, build, CLI smoke, lint, and package contracts pass; installer tests do not require an ambient global binary.
3. Run graph impact since `implementation.base_ref`, inspect the complete diff and surface delta, and check all command/template, catalog, Qodo-disposition, and external-evidence claims.
4. Record each AC result, evidence gaps, residual risks, and implementation-versus-contract defect classification in `verification.md`; record one final verdict in the manifest and stop.

## Rollback and final verification contract

Rollback before sealing is `git restore` only for files owned by the current task after confirming no unrelated user changes, plus removal of package-local temporary fixtures. Runtime lock/install/workflow operations must use their own safe cleanup/rollback paths. The independent `codepatrol-verify` workflow must later rerun the full gate, inspect blast radius and unplanned changes, and decide `commit` or `improve`; Apply must not claim commit readiness.
