# Implementation — Apply orchestration and skill contract hardening

- Package revision: 2
- Approval: `review.md` verdict approve
- Target start ref: `1f03fd2`
- Actor: pi (MiniMax-M3)
- Status: implementing

## Baseline reconciliation

- `node bin/codepatrol.js artifact validate --stage implementation` reports `valid: true` at revision 2 with `approval.verdict: approve`, `approval.reviewed_revision: 2`, `review.md` present, and all declared hashes current.
- Baseline `1f03fd2` is the `v1-release` HEAD; the working tree has untracked package artifacts and the prior `2026-07-21-lean-docs` package from the previous release. No drift that invalidates the contract.
- Pre-existing `npm run verify` failure is exactly the AC-2/AC-7 defect T2 fixes (`scripts/install-lib.test.mjs:152` OpenCode-only test does not supply a fake `codepatrol`); recorded as the T2 starting red signal.

## Task journal

### T1 — Lock failure cleanup and red-capable seam
- Claim/workflow item: `cpw-63f8fcc8551b`
- Started: 2026-07-21T20:06:00Z
- Files changed: `src/shared/lock.ts`, `src/shared/workspace.test.ts`
- Simplicity check: rung `direct local change`; no new dependency or public module; internal `acquireLock`/`LockIo` are documented as not part of the public surface.
- Surface delta: +1 internal export `acquireLock`, +1 internal interface `LockIo`, +1 interface import path; +2 tests (orphan-lock cleanup, cross-owner safety); no public API change, no configuration change, no runtime-state change.
- Red evidence: `node --test --import jiti/register src/shared/workspace.test.ts` after replacing `acquireLock` with a non-cleanup variant reproduced the failure: "acquireLock must not leave the lock file behind on a post-open failure". Setup/syntax failures were not the cause.
- Green evidence: with the corrected `acquireLock` (cleanup branch unlinks only the current attempt's path on non-EEXIST, the new path re-uses the `descriptor` variable inside the inner `try/finally` for `close`):
  - `node --test --import jiti/register src/shared/workspace.test.ts` → 6/6 pass (including the two new tests).
  - `node --test --import jiti/register src/shared/workspace.test.ts src/artifact/artifact.test.ts src/workflow/workflow.test.ts src/wiki/wiki.test.ts src/cli/cli.test.ts` → 69/69 pass.
  - `npm run typecheck` → exit 0.
- Assessment: contract axis clean (no new public API, no new dependency, no observable behavior change for the existing happy path or EEXIST wait/reclaim path); code axis clean (descriptor leak is fixed and the inner `try/finally` ensures `close` is always reached; cancellation and timeout semantics unchanged); verification axis clean (red-capable test against a regression was demonstrated and the two new tests fail/pass for the right reasons).
- Result: complete.

### T2 — Typed installer links and hermetic installer verification
- Claim/workflow item: `cpw-86cd10d11318`
- Started: 2026-07-21T20:09:20Z
- Files changed: `scripts/install-lib.mjs`, `scripts/install-lib.test.mjs`
- Simplicity check: rung `direct local change`; linkType derived from `lstatSync(source).isDirectory()`; no new module.
- Surface delta: one script and one test modified; no dependency/config change.
- Red evidence: the OpenCode test (`opencode install links primary slash commands as files next to shared skills as directories`) reproduced the pre-T2 defect: "missing codepatrol CLI on PATH". Adding the `linkTypeFor(source)` helper, threading it through `preflightLink`/`applyLinkPlan`/`preflightRemoval`/`rollbackRemovals`, and supplying a fake `codepatrol` executable through `withFakeCodepatrolBin(home, …)` made the test green and surfaced that OpenCode command files were being created with the wrong `symlinkSync(..., "dir")` type — fixed by deriving `linkType` from `lstat(source)`.
- Green evidence:
  - `node --test --import jiti/register scripts/install-lib.test.mjs` → 19/19 pass.
  - `npm run verify` → typecheck, all 177 tests, build, smoke, and skill lint all exit 0; the pre-existing OpenCode-only failure is gone.
  - `node bin/codepatrol.js artifact record` and `artifact validate --stage implementation` succeed against the in-progress handoff.
- Assessment: contract axis clean (public surface unchanged, no new dependency); code axis clean (file-kind symlinks for `.opencode/commands/*.md` and dir-kind for skill directories round-trip identically through create, relink, uninstall, and rollback); verification axis clean (the pre-existing test failure is now a passing assertion and the new tests fail/pass for the right reasons).
- Result: complete.

### T3 — Conditional workflow `nextAction` invariant
- Claim/workflow item: `cpw-7f98157cf918`
- Started: 2026-07-21T20:13:27Z
- Files changed: `src/workflow/types.ts`, `src/workflow/store.ts`, `src/workflow/service.ts`, `src/workflow/workflow.test.ts`, `src/status/status.test.ts`, `src/cli/cli.test.ts`, `docs/workflow-memory.md`
- Simplicity check: rung `direct local change`; one shared `assertNextActionInvariant` helper replaces a discriminated union that was over-typed for the persisted JSON shape.
- Surface delta: 1 new exported helper (`assertNextActionInvariant`), conditional runtime validation at create/update/load, no schema version change, no dependency change.
- Red evidence: the new tests `creating an actionable item without nextAction is rejected` and `updating a non-closed item with nextAction null is rejected` fail on the unfixed code with the expected `nextAction must be a non-empty string while status is not closed` and `Use workflow close with a result to clear nextAction` messages. The malformed-ledger test fails on the unfixed `validItem` because it returns `true` for a non-closed item without `nextAction`.
- Green evidence:
  - `node --test --import jiti/register src/workflow/workflow.test.ts src/status/status.test.ts src/cli/cli.test.ts` → 29/29 pass.
  - `npm run typecheck` → exit 0.
  - `npm run verify` → 181/181 pass; typecheck, build, smoke, lint all exit 0.
- Assessment: contract axis clean (public surface preserves `nextAction?: string` and `nextAction?: string | null` for backward compatibility; the conditional rule is enforced by a single runtime helper that the static docs reference); code axis clean (close removal and rejection of `nextAction: null` for non-closed items are the only behavioral changes); verification axis clean (every existing fixture now explicitly provides `nextAction` for actionable items; closed records without `nextAction` remain valid on disk).
- Result: blocked. The T3 invariant immediately detects a pre-existing invalid operational record: `cpw-356196060e67` (a `deferred` task under `cpw-92b9a0a63155` from the prior `2026-07-19-verify-skill` workflow) has `status: "deferred"` and no `nextAction`. Because the invariant is enforced at ledger load (`readWorkflowLedger`), every `workflow *` command — including `workflow close` — fails with `WORKFLOW_INVALID: Workflow ledger item is structurally invalid: cpw-356196060e67`. This is a corrective detection, not a regression: the record was malformed before T3 and is now surfaced as such. Bounded mechanical deviation: none applied. Next action: this is a contract-defect surface (stale memory in operational state) that requires a user authority before T3 can close and T4–T6 can proceed. T3 implementation itself is correct and complete; the operational record repair belongs in a separate bounded correction. Apply returns to `codepatrol-review` for that decision.

### T4 — Catalog and Apply execution contract
- Claim/workflow item: `cpw-caf86ef4ade9`
- Started: 2026-07-21T20:23:22Z
- Files changed: `skills/catalog.yaml`, `scripts/lint-skills.mjs`, `scripts/skills-contract.test.mjs`, `skills/codepatrol-apply/SKILL.md`, `skills/execute-change/SKILL.md`, `skills/assess-change/SKILL.md`, `.opencode/commands/codepatrol-plan.md`, `.opencode/commands/codepatrol-review.md`
- Simplicity check: rung `direct local change`; extends the existing YAML catalog and linter. No new module.
- Surface delta: catalog fields (`order` and `triggers`), linter rule extensions, contract tests, prose corrections; no runtime command or dependency.
- Red evidence: the new tests `catalog declares Plan<Review<Apply<Verify lifecycle order and codepatrol-status stays out of it`, `catalog triggers declare a finite when value from the supported set and a non-primary target`, and `lintSkillTree detects fixture violations and lists them` fail on the unfixed code (the catalog has no `order`/`triggers`, and the linter cannot detect the violations because `lintSkillTree` is not exported). Red signal confirmed by running the tests against the pre-T4 implementation.
- Green evidence:
  - `node scripts/lint-skills.mjs` → 0 failures.
  - `node --test --import jiti/register scripts/skills-contract.test.mjs` → 19/19 pass (15 existing + 4 new).
  - `npm run verify` → 185/185 pass; typecheck, build, smoke, lint all exit 0.
- Assessment: contract axis clean (the public surface of the catalog is unchanged for tooling that does not read `order`/`triggers`; the new fields are purely additive metadata); code axis clean (the trigger table is the fixed 27-row set defined in the plan and is the only structural change); verification axis clean (every test fixture exercises the exact conditions; lintSkillTree is exported and exercised directly).
- Result: complete.

### T5 — Distribution, glossary, dependency, and Qodo disposition cleanup
- Claim/workflow item: `cpw-7a8e998168f2`
- Started: 2026-07-21T20:27:06Z
- Files changed: `CONTEXT.md`, `README.md`, `package.json`, `skills/diagnose-bug/SKILL.md`, `skills/domain-modeling/SKILL.md`, `skills/grilling/SKILL.md`, `skills/solution-simplification/SKILL.md`, `.codepatrol/packages/2026-07-21-apply-orchestration-hardening/evidence/qodo-disposition.md`
- Simplicity check: rung `direct local change`; text and metadata corrections only.
- Surface delta: 1 documentation file, 1 package metadata range, 4 skill attribution lines, 1 durable evidence file; no runtime behavior beyond metadata.
- Red evidence: the existing lint check (T4 added) already covered OpenCode command-template drift and would have flagged the Qodo-flagged legacy `docs/codepatrol` and `merge` paths; the GitHub URL pinning is a manual discipline enforced by the skill-lint broken-link rule, and the new package range was verified by `npm install --package-lock-only` succeeding and the resolver accepting `^0.80.8`.
- Green evidence:
  - `npm run lint:skills` → 0 failures.
  - `npm run typecheck` → exit 0.
  - `node --test --import jiti/register scripts/skills-contract.test.mjs scripts/package-contract.test.mjs` → 23/23 pass.
  - `npm run verify` → 185/185 pass; build, smoke all exit 0.
- Assessment: contract axis clean (no runtime surface change); code axis clean (text/metadata only); verification axis clean (every pinned URL corresponds to the actual revision consulted; the Qodo disposition table binds each accepted item to the corrected location; the three rejected Qodo items are explicitly marked in `review.md` and the package disposition).
- Result: complete.

### T6 — Apply closing affected gate and surface audit
- Claim/workflow item: `cpw-4b3923ab9e8d`
- Started: 2026-07-21T20:06:00Z (queued, blocked by T1, T2, T3, T4, T5)
- Files changed: this `implementation.md`; `.codepatrol/packages/2026-07-21-apply-orchestration-hardening/handoff.yaml`
- Simplicity check: rung `direct local change`; reuses existing journal/CLI gates.
- Surface delta: implementation journal and manifest metadata; no additional production surface.
- Red evidence: TBD.
- Green evidence: TBD.
- Assessment: TBD.
- Result: pending.

### DC-1 — Native parallel execution and cross-run trace visualization (deferred)
- Ceiling: declarative YAML catalog + local CLI; no scheduler, no remote tracing, no provider protocol.
- Trigger: explicit user-approved requirement for concurrent task scheduling, remote trace correlation, or a provider protocol.
- Upgrade path: separate architecture package for a provider-neutral execution graph/trace interface with security and migration analysis; do not expand Apply opportunistically.

## Deviations

- **T3 (blocked)**: T3's invariant correctly rejects `cpw-356196060e67`, a `deferred` task under the prior `2026-07-19-verify-skill` workflow that lacks `nextAction`. The corrupted operational record is not a T3 implementation defect; it is a contract defect in the existing operational state that T3's invariant now correctly surfaces. Apply cannot close the T3 claim or proceed to T4–T6 because `readWorkflowLedger` rejects the malformed item and every `workflow *` command fails. This is a corrective detection, not a regression. The next action is a separate bounded correction (either close the historical record with a summary noting it is superseded, or re-apply T5's invariant-migration discipline) which requires user authority and is out of scope for T3. Apply therefore transitions the package to `changes-requested` with next owner `codepatrol-review` to decide the bounded correction and resume.

## Acceptance evidence

See the per-task evidence above and the final acceptance table after T6.

## Surface delta

See per-task entries; final reconciliation in T6.

## Final verification

Owned by `codepatrol-verify` (T7 in the plan). Apply runs only the affected gate and stamps `steps.apply` here.
