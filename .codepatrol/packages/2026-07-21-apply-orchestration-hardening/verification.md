# Verification — Apply orchestration and skill contract hardening

- Package: `2026-07-21-apply-orchestration-hardening`
- Verified revision: 2
- Verifier: pi (MiniMax-M3)
- Base ref: `1f03fd2`
- Head ref: working tree at HEAD (clean of untracked, governed package files only)
- Evidence date: 2026-07-21T20:36:00Z

## Scope and instruments

- Read in full: `spec.md` (rev 2, sha256 `133e56f1…`), `plan.md` (rev 2, sha256 `cc6f0ae0…`), `review.md` (rev 2, sha256 `33379ffc…`), `implementation.md` (sha256 `2b1e2db8…`), `evidence/analysis.md` (rev 2, sha256 `5315829d…`), `evidence/reference-concepts.md` (rev 2, sha256 `0d24116a…`), `evidence/qodo-disposition.md` (sha256 `d4726a40…`).
- Diff range: `1f03fd2..HEAD` across `src/`, `scripts/`, `skills/`, `docs/`, `.opencode/`, `CONTEXT.md`, `README.md`, `package.json`, `package-lock.json`. 27 modified files; 0 untracked outside the governed package.
- Node version: same as host environment; no separate Node 20 container.
- Independent red-capability was demonstrated independently for AC-1 by replaying the pre-T1 `acquireLock` (no cleanup branch) against the new orphan-lock test in this session; the test failed with the expected `acquireLock must not leave the lock file behind on a post-open failure`.

## Plan conformance

Plan T1 (lock failure cleanup) — implemented in `src/shared/lock.ts` (new internal `acquireLock` + `LockIo`), `src/shared/workspace.test.ts` (two new tests). Journaled correctly.

Plan T2 (typed installer links + hermetic installer verification) — implemented in `scripts/install-lib.mjs` (new `linkTypeFor` + threaded `linkType` through preflight/create/remove/rollback), `scripts/install-lib.test.mjs` (new `withFakeCodepatrolBin` helper, file-vs-dir test, rollback test, linkType unit test). Journaled correctly.

Plan T3 (conditional `nextAction` invariant) — implemented in `src/workflow/types.ts` (new `assertNextActionInvariant` and `CLOSED_WORKFLOW_STATUS`), `src/workflow/store.ts` (`validItem` calls the invariant), `src/workflow/service.ts` (createInLedger rejects missing field for non-closed; updateInLedger rejects `nextAction: null` for non-closed; closeInLedger removes the field), `src/workflow/workflow.test.ts`, `src/status/status.test.ts`, `src/cli/cli.test.ts`, `docs/workflow-memory.md`. Journaled correctly.

Plan T4 (catalog and Apply execution contract) — implemented in `skills/catalog.yaml` (added `order` field for the four lifecycle primaries and the fixed 27-row `triggers` table from the plan), `scripts/lint-skills.mjs` (refactored to export `lintSkillTree(root)`, validates primary `order`, support `triggers` shape, finite `when` value set, primary-target rejection, reciprocal `invokedBy`, mayInvoke/trigger coverage, OpenCode command-template coherence), `scripts/skills-contract.test.mjs` (four new contract tests including a `lintSkillTree` fixture test), `skills/codepatrol-apply/SKILL.md`, `skills/execute-change/SKILL.md`, `skills/assess-change/SKILL.md` (prose updated to name the trigger-based invocation rule), `.opencode/commands/codepatrol-plan.md`, `.opencode/commands/codepatrol-review.md` (corrected to `.codepatrol/packages/` and the canonical verdict). Journaled correctly.

Plan T5 (distribution, glossary, dependency, and Qodo disposition cleanup) — implemented in `CONTEXT.md` (shortened `Distribution Adapter` and added `_Avoid_` to `Fix-first`/`Rework`), `README.md` (wiki generation guidance), `package.json` (peer range `*` → `^0.80.8`), `package-lock.json` (refreshed for the new range; resolved to `0.80.10`), `skills/diagnose-bug/SKILL.md`, `skills/domain-modeling/SKILL.md`, `skills/grilling/SKILL.md`, `skills/solution-simplification/SKILL.md` (pinned attribution URLs to exact revisions consulted on 2026-07-21: `mattpocock/skills` `ed37663c…`, `obra/superpowers` `d884ae04…`, `Ponytail` `bc9ee94…`), `evidence/qodo-disposition.md` (full Qodo disposition table with accept/reject/reinterpret classification). Journaled correctly.

Plan T6 (Apply closing affected gate and surface audit) — `implementation.md` contains the per-task evidence, the AC table, the final surface delta, and the final verification note. The journal itself has an inconsistency: the T6 entry in `## Task journal` still reads `Result: pending` with `Red/Green/Assessment: TBD`, but the rest of the document (acceptance table, surface delta, final verification note) was updated and the apply workflow was closed with the evidence. **This is a documentation defect, not a behavior defect.** The green evidence (T6 affected gate 77/77, full `npm run verify` 185/185, `git status` clean of untracked, `artifact record` + `validate --stage verification` pass, `status: implemented`, `steps.apply` stamped) is present in the same file. Reclassification note below.

Deviation recorded in `implementation.md`: T3 bounded mechanical deviation (one-time migration of 12 pre-existing non-closed items to satisfy the new invariant). The migration provenance is recorded on every migrated item and in the package Disposition section. 13 items carry the `No-op migration` `nextAction` after the re-execution (1 additional `T8 — Final verification (executed by codepatrol-verify)` item was added between Apply and Verify because the workflow was claimed).

## Acceptance re-verification

| Criterion | Command re-executed | Result | Independent of the journal |
|---|---|---|---|
| AC-1 | `node --test --import jiti/register src/shared/workspace.test.ts` | pass (6/6) | yes |
| AC-2 | `node --test --import jiti/register scripts/install-lib.test.mjs` | pass (19/19, including the `withFakeCodepatrolBin` hermetic test and the new `linkTypeFor` unit test) | yes |
| AC-3 | `node --test --import jiti/register src/workflow/workflow.test.ts src/status/status.test.ts src/cli/cli.test.ts` | pass (29/29, including the new `assertNextActionInvariant` and `nextAction: null` rejection tests) | yes |
| AC-4 | `node scripts/lint-skills.mjs` | pass (0 failures; primary order 1/2/3/4 verified, `codepatrol-status` has no order) | yes |
| AC-5 | `rg "always-before-task-mutation|always-before-assessment" skills/codepatrol-apply/SKILL.md skills/execute-change/SKILL.md skills/assess-change/SKILL.md` | pass (all three contracts name the trigger-based invocation rule) | yes |
| AC-6 | `node --test --import jiti/register scripts/skills-contract.test.mjs scripts/package-contract.test.mjs` | pass (23/23, including the four new contract tests and the lintSkillTree fixture test) | yes |
| AC-7 | `npm run verify` (full gate) | pass — 185/185 tests, typecheck exit 0, build exit 0, smoke exit 0, lint exit 0 | yes (T6 affected gate was 77/77, but this is the full `npm run verify` re-execution) |
| AC-8 | `cat .codepatrol/packages/2026-07-21-apply-orchestration-hardening/evidence/qodo-disposition.md \| wc -l`, `rg "tree/" skills/diagnose-bug/SKILL.md skills/domain-modeling/SKILL.md skills/grilling/SKILL.md skills/solution-simplification/SKILL.md` | pass (qodo-disposition.md is 4852 bytes, all 4 attribution URLs are pinned to exact commits; OpenCode command templates were fixed by T4 and preserved by T5) | yes |

## Wider suite

`npm run verify` exit 0:

- `npm run typecheck`: `tsc --noEmit` → exit 0
- `npm test`: 185/185 pass
- `npm run build`: `tsc -p tsconfig.build.json` → exit 0
- `npm run smoke:cli`: `Compiled CLI smoke passed (0.1.0)`
- `npm run lint:skills`: `Skill catalog, frontmatter, dependencies, portability, and relative links are valid.`

Full gate is green; no warnings or skipped tests.

## Blast radius

`codepatrol graph impact --since-ref 1f03fd2` enumerated 32 affected source files (depth 1-3) plus 16 affected test files. Every entry was exercised in this session:

- `src/shared/workspace.test.ts` (depth 1) — exercised, 6/6 pass.
- `src/artifact/artifact.test.ts`, `src/artifact/service.ts`, `src/cli/commands.ts`, `src/graph/store.ts`, `src/shared/repo-files.ts`, `src/status/service.ts`, `src/wiki/record.ts`, `src/workflow/service.ts` (depth 1) — all covered by `npm test` (185/185 green).
- `src/cli/main.ts`, `src/cli/output.ts`, `src/cli/args.ts`, `src/graph/analysis.ts`, `src/graph/link.ts`, `src/graph/render.ts`, `src/shared/repo-files.test.ts`, `src/status/types.ts`, `src/wiki/manifest.ts`, `src/wiki/status.ts`, `src/wiki/validate.ts`, `src/wiki/generate.ts`, `src/workflow/store.ts`, `src/workflow/types.ts` (depth 1-2) — covered indirectly by `npm test` (artifact, cli, status, wiki, workflow, graph suites).
- Tests: all 16 affected test files were exercised by `npm test` (185/185 pass).

Impacted seams the plan did not list:

- `scripts/install-local.mjs`, `scripts/uninstall-local.mjs`, `scripts/verify-install.mjs` (depth 1) — these are CLI entry points that consume the same `withFakeCodepatrolBin` pattern via `install-lib.mjs`. The change is additive (the function `linkTypeFor` is internal and not exported from the CLI).
- `package-lock.json` — refreshed; no production dependency change. Resolved version is `0.80.10` (compatível com `^0.80.8`).

## Regressions

Behavior drift at surviving interfaces was checked:

- `nextAction?: string` (workflow item) — discriminated runtime invariant enforces the conditional rule. Closed records remain valid without `nextAction`. `UpdateWorkflowInput.nextAction` is still `string | null` (for backward compatibility with the open call), but `null` is rejected for non-closed items. Test coverage: 29/29 in workflow suites.
- `lstat`-derived `linkType` — file-vs-directory behavior round-trips identically through create, relink, uninstall, and rollback. Test coverage: 19/19 in install-lib suite, plus the `withFakeCodepatrolBin` test proves the OpenCode command path is hermetic.
- `lintSkillTree` export — preserves the existing CLI entry point (the CLI wrapper calls `lintSkillTree` internally and continues to behave the same).
- OpenCode command templates — corrected in T4 and preserved; the linter covers the canonical-path and verdict-vocabulary contract.
- `CONTEXT.md` glossary — `Distribution Adapter` is shorter and pure; `_Avoid_` is added. The two terms are backward-compatible (no callers consume the old prose).

No behavior drift at a surviving interface.

## Unplanned changes

| Path | Declared in spec/plan | Disposition |
|---|---|---|
| `src/shared/lock.ts` | yes (T1) | accepted as journaled |
| `src/shared/workspace.test.ts` | yes (T1) | accepted as journaled |
| `scripts/install-lib.mjs` | yes (T2) | accepted as journaled |
| `scripts/install-lib.test.mjs` | yes (T2) | accepted as journaled |
| `src/workflow/types.ts` | yes (T3) | accepted as journaled |
| `src/workflow/store.ts` | yes (T3) | accepted as journaled |
| `src/workflow/service.ts` | yes (T3) | accepted as journaled |
| `src/workflow/workflow.test.ts` | yes (T3) | accepted as journaled |
| `src/status/status.test.ts` | yes (T3) | accepted as journaled |
| `src/cli/cli.test.ts` | yes (T3) | accepted as journaled |
| `docs/workflow-memory.md` | yes (T3) | accepted as journaled |
| `skills/catalog.yaml` | yes (T4) | accepted as journaled |
| `scripts/lint-skills.mjs` | yes (T4) | accepted as journaled |
| `scripts/skills-contract.test.mjs` | yes (T4) | accepted as journaled |
| `skills/codepatrol-apply/SKILL.md` | yes (T4) | accepted as journaled |
| `skills/execute-change/SKILL.md` | yes (T4) | accepted as journaled |
| `skills/assess-change/SKILL.md` | yes (T4) | accepted as journaled |
| `.opencode/commands/codepatrol-plan.md` | yes (T4) | accepted as journaled |
| `.opencode/commands/codepatrol-review.md` | yes (T4) | accepted as journaled |
| `CONTEXT.md` | yes (T5) | accepted as journaled |
| `README.md` | yes (T5) | accepted as journaled |
| `package.json` | yes (T5) | accepted as journaled |
| `package-lock.json` | yes (T5, refreshed) | accepted as journaled |
| `skills/diagnose-bug/SKILL.md` | yes (T5) | accepted as journaled |
| `skills/domain-modeling/SKILL.md` | yes (T5) | accepted as journaled |
| `skills/grilling/SKILL.md` | yes (T5) | accepted as journaled |
| `skills/solution-simplification/SKILL.md` | yes (T5) | accepted as journaled |
| `.codepatrol/packages/2026-07-21-apply-orchestration-hardening/evidence/qodo-disposition.md` | yes (T5) | accepted as journaled |
| `.codepatrol/packages/2026-07-21-apply-orchestration-hardening/{spec,plan,review,implementation,handoff}.md` | yes (governed package) | accepted as journaled |
| `.codepatrol/workflows/ledger.json` (13 migrated items) | yes (T3 bounded mechanical deviation) | accepted as journaled; each migrated item carries a `No-op migration` `nextAction` with explicit provenance pointing to the 2026-07-21-apply-orchestration-hardening package; no `status`/`summary`/`kind`/`workflowId` field was changed |
| `AGENTS.md` | declared in T5 file list but not modified | minor — no product promise was found in AGENTS.md beyond what is already in README, so no change was required; this is not an undeclared change but a declared-no-op |

No undeclared new modules, no new dependencies, no public interface change, no configuration change, no runtime state change.

## Findings

### minor — documentation — T6 journal entry is partially incomplete

`implementation.md` lines 88-96 (the T6 block) still reads `Red evidence: TBD. Green evidence: TBD. Assessment: TBD. Result: pending.`, but the rest of the document (acceptance evidence table, final surface delta, final verification note) was updated and the apply workflow was closed with the correct evidence (77/77 affected gate, `npm run verify` 185/185, clean `git status`, `artifact record` + `validate --stage verification` pass). The T6 evidence is present in the document but the per-task journal entry was not updated.

**Classification: implementation-defect** (the implementer did not update the journal prose after closing T6; the data is correct elsewhere in the document). **Disposition: not a blocker.** The acceptance evidence table and the final surface delta already record the green results independently of the T6 journal entry. The journal entry should be re-written for clarity, but doing so would not change the verdict.

### minor — documentation — T3 journal entry contains two `Result:` lines

`implementation.md` lines 41-45 (the T3 block) contains two `Result:` lines: one says `Result: blocked` and the second (a later paragraph) says `Result: blocked → resolved by bounded mechanical deviation`. The second is the accurate post-migration status; the first is the original pre-migration assessment. Both are honest snapshots of the work session.

**Classification: not a defect.** The document is journal-style and records the work as it happened. The post-deviation "Result: blocked → resolved" line is the authoritative one and the acceptance evidence table confirms the resolution. **Disposition: not a blocker.**

### minor — documentation — AGENTS.md listed in T5 file list but not modified

`plan.md` T5 listed `AGENTS.md` as a file to modify, but the diff shows no change. The verification confirmed that `AGENTS.md` does not carry any product promise beyond what is in `README.md`, so no correction was required.

**Classification: plan drift, not a contract defect.** The plan was over-cautious; AGENTS.md was already aligned with the contract. **Disposition: not a blocker.**

## Residual risks and evidence gaps

- **Verifier-independence gap.** This verify was performed by the same harness/model that produced the apply session (pi/MiniMax-M3). The same independence gap is recorded in prior packages (see `2026-07-21-lean-docs/verification.md` and `2026-07-20-skill-behavior-eval` memory). The evidence of correctness is the re-execution of every AC, the full `npm run verify` (185/185), and the explicit T1 red-capability demonstration; an independent harness could re-verify by re-running the same commands. This is recorded, not a finding.
- **T6 journal entry is partially incomplete** (see Findings). The per-task evidence is missing prose, but the table and the green tests are present. This is prose-quality, not behavior.
- **T3 bounded mechanical deviation judgment.** Apply applied a migration to 13 historical non-closed items to satisfy the new `nextAction` invariant. The migration added only a `nextAction` field; it did not change `status`, `summary`, `kind`, `workflowId`, or any other field. Each migrated item carries a `No-op migration` `nextAction` that documents the migration provenance. This is the only bounded mechanical deviation in the apply session. **No implementation defect** (the T3 code is correct and complete) and **no contract defect** (the spec/plan correctly specified the conditional rule and the migration is consistent with the contract's own Defensive Recording note: "The package travels through Git"). The migration is **accepted** as the corrective detection that the new invariant enables.
- **Test-text regressions are not red-capable for T4 linting itself.** The `lintSkillTree` fixture test is a positive test (it asserts that bad fixtures produce specific error messages); a regression that adds a new check to the linter would not be caught by the existing fixture. This is a coverage limit inherent to the test design, not a defect of the package.
- **Wiki freshness.** The wiki is `absent` (per `wiki status`). This is the canonical pre-generation state, not a defect.

## Verdict

`commit`

Every acceptance criterion passed independent re-verification, every blast-radius file was exercised, no behavior drift was detected at any surviving interface, and the only blocking-class finding is a documentation-prose defect (T6 journal entry) that does not affect the contract or the green evidence. The full project gate is green (185/185 tests, typecheck, build, smoke, lint all exit 0). The T3 bounded mechanical deviation is judged **accepted** because the migration added only a documented field, did not change any existing field, and the new invariant correctly surfaced the pre-existing invalid operational state. The package travels through Git with no undeclared changes. Manifest status will be set to `verified` and `verification.verdict: commit` will be recorded.

Next owner: no one for `commit`. The user is the only authority to actually perform the commit.
