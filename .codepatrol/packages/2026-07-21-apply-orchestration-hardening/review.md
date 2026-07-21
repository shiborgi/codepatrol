# Review — Apply orchestration and skill contract hardening

- Package: `2026-07-21-apply-orchestration-hardening`
- Incoming revision: 1
- Reviewed revision: 2
- Reviewer: pi (MiniMax-M3)
- Evidence date: 2026-07-21T20:05:00Z

## Scope and evidence

- `node bin/codepatrol.js graph sync --workspace "$PWD" --format json`: graph present, no extraction churn.
- `node bin/codepatrol.js wiki status --workspace "$PWD" --format json`: graph present; wiki `absent`, six generated concepts stale/missing. The plan correctly records this as a generated-state condition and does not commit a placeholder `docs/wiki/`.
- `node bin/codepatrol.js graph impact --file src/shared/lock.ts ...`: artifact, graph, wiki, workflow, status writers all depend on the lock seam; `src/shared/workspace.test.ts` is the direct test.
- `node bin/codepatrol.js graph impact --file scripts/install-lib.mjs ...`: all local installer entry points and the installer test depend on the preflight/apply/rollback functions.
- `node bin/codepatrol.js graph impact --file src/workflow/types.ts ...`: workflow service/store, CLI/status, and workflow/status tests depend on the type contract.
- `node bin/codepatrol.js graph neighbors --file scripts/install-lib.mjs /src/workflow/service.ts /scripts/lint-skills.mjs ...`: confirmed affected caller lists include every test referenced by the plan.
- `npm run verify`: typecheck green, **172/173** pass. The single failure is `scripts/install-lib.test.mjs:152` "opencode install links primary slash commands next to shared skills" because `verify()` requires a fake `codepatrol` binary the test does not provide. This is the exact environmental defect T2 fixes; recorded openly as a finding for plan/apply.
- Direct reads: `src/shared/lock.ts:30-69`, `scripts/install-lib.mjs:151-237`, `src/workflow/types.ts:37-110`, `src/workflow/store.ts:16-35`, `src/workflow/service.ts:209-243,339`, `skills/catalog.yaml`, `.opencode/commands/*.md`, `package.json:58-60`, `src/artifact/plan-check.ts`, primary skills, and `skills/_shared/EXECUTION.md`.
- External sources re-fetched: [Agent Skills specification at `agentskills/agentskills` commit `38a2ff82958afee88dadf4831509e6f7e9d8ef4e`](https://github.com/agentskills/agentskills/tree/38a2ff82958afee88dadf4831509e6f7e9d8ef4e), [Danger JS at commit `2c3b5a9e0c5cffa5fc0ef9f5ff59df719444b1cd`](https://github.com/danger/danger-js/tree/2c3b5a9e0c5cffa5fc0ef9f5ff59df719444b1cd), [reviewdog at commit `a9862c2277ae85b28cee8a9c9e5ffebd5e17b1cd`](https://github.com/reviewdog/reviewdog/tree/a9862c2277ae85b28cee8a9c9e5ffebd5e17b1cd), OpenAI Agents JS guardrails/tracing pages, and MCP `2025-06-18` server/tools specification.

## Findings

### major — plan/verification — T1 had no concrete red-capable mechanism for a post-open failure

The original T1 step told the implementer to invent a test seam "if the current static imports make injection impossible," which is not a plan; it is a placeholder. The corrected T1 requires extracting an internal `acquireLock(path, token, command, io)` seam consumed only by the new test, with a `LockIo` object whose `writeRecord` throws after the real `openSync(..., "wx")` succeeds, plus an assertion that a pre-existing lock owned by another attempt is not removed. The internal export is documented as not part of the public package interface. **Status: corrected in revision 2.**

### major — contract — T4 defined catalog order/triggers as prose, not as a lintable contract

The original T4 said "minimal declarative metadata needed" but did not enumerate values, leaving every entry to be re-invented at apply time. The corrected T4 pins the exact `{target, when}` shape, defines the finite initial `when` value set, exempts `codepatrol-status` from lifecycle order, and fixes the complete caller → target → when table (27 entries) the implementer must write. Without this the catalog refactor cannot be linted and the trigger policy remains in prose. **Status: corrected in revision 2.**

### major — contract — `nextAction` invariant was expressed as a runtime rule only

The original spec framed `nextAction` as a runtime validator. Because the type system encodes a closed-record invariant, the corrected spec/plan/decision commit to expressing the rule as a discriminated `WorkflowItemV1` union so the static type and the validator agree. The plan's test list also requires every creation fixture to supply `nextAction` unless it is intentionally testing rejection. **Status: corrected in revision 2.**

### major — plan/verification — AC-7 conflated the Apply closing gate with `codepatrol-verify`

The original T6 ran `npm run verify` and recorded the final verdict inside Apply. This violates the apply/verify separation codified in `codepatrol-apply/SKILL.md` and `_shared/ARTIFACTS.md`. The corrected plan splits the work: T6 runs only the affected gate and stamps `steps.apply`, T7 is owned exclusively by `codepatrol-verify` (full `npm run verify`, blast-radius sweep, verdict classification). AC-7 is moved to T7. **Status: corrected in revision 2.**

### minor — plan — `codepatrol-status` ordering exclusion was implicit

Original spec implied all five primaries need lifecycle order; status is a read-only dispatcher with no lifecycle position. The corrected spec records that explicitly. **Status: corrected in revision 2.**

### minor — plan — command-template assertion was buried inside a documentation task

The original T4 mixed the command-template fixture into the catalog work and dropped it implicitly. The corrected plan moves that assertion into T5 alongside the actual `.opencode/commands/` fixes, where it belongs. **Status: corrected in revision 2.**

### minor — evidence — reference-concepts URLs were not pinned

Original `evidence/reference-concepts.md` cited the Agent Skills spec page and Danger JS repo without commits. The corrected analysis pins the three external revisions actually consulted on 2026-07-21 (`agentskills/agentskills` `38a2ff8...`, Danger JS `2c3b5a9...`, reviewdog `a9862c2...`) and uses tree-pinned commit links. **Status: corrected in revision 2.**

### reject — Qodo complaint about `approve` verdict

Qodo reported `approve` as "classified as violation." Current `REVIEW-FORMAT.md:57` and `src/artifact/review-check.ts:127` treat `approve` as canonical and `merge` as a deprecated compatibility alias. The verdict contract is intentional, documented, and enforced; "fixing" it would weaken the parser. **Decision: keep verdict contract, document as rejected.**

### reject — Qodo complaint about invalid review finding categories

Qodo listed `<contract|architecture|plan|evidence>` as "invalid findings." `REVIEW-FORMAT.md` does not enumerate categories (severity-only), and `src/artifact/review-check.ts` does not parse categories. **Decision: Qodo referenced an older contract; record rejection, no behavior change.**

### reject — Qodo claim about missing `docs/wiki/`

Wiki is generated by `wiki generate`; absence is a valid runtime state. The plan tells the implementer to describe wiki absence as a status/generation condition, not to commit a placeholder file. **Decision: reinterpret, no behavior change.**

### accept — Qodo items 1.1, 1.2, 2.1, 2.2, 3.1, 3.2, 4.1, 4.2

All eight accepted issues are planned in T1 (`lock`), T2 (`symlink` plus hermetic installer test), T3 (`nextAction` contract), T4/T5 (`unpinned URLs`, `peerDependencies *`), and T5 (`Distribution Adapter` glossary, `_Avoid_` entries). **Status: accepted; corrected tasks are in revision 2.**

## Artifact adjustments

| Artifact | Change | Reason | AC |
|---|---|---|---|
| `spec.md` | Added explicit `{target, when}` shape, the finite initial `when` set, the `codepatrol-status` lifecycle-order exemption, and the discriminated `WorkflowItemV1` union for AC-3. Re-scoped AC-7 to `codepatrol-verify`. | The original contract left too much to the implementer; revision 2 makes the order/trigger policy and the conditional `nextAction` rule machine-checkable, and prevents Apply from running the full delivery gate. | AC-3, AC-4, AC-6, AC-7 |
| `plan.md` | T1 requires an injected `LockIo` seam on an internal `acquireLock` function. T4 enumerates the complete 27-row caller → target → when table and the exact finite `when` values. T3 specifies the discriminated `WorkflowItemV1` union and adds `src/cli/cli.test.ts` to the test list. T6 runs only the affected gate. T7 (new) is the independent `codepatrol-verify` task that runs the full gate, blast-radius sweep, and final verdict. T5 owns the command-template assertion originally buried in T4. AC-7 mapping moves T6's full-gate command out and adds T7. | Without these changes, the apply session cannot produce red-capable evidence for AC-1, the catalog refactor cannot be linted for AC-4/AC-6, and AC-7 would have been claimed by Apply. | AC-1, AC-3, AC-4, AC-6, AC-7 |
| `evidence/reference-concepts.md` | Replaced floating URLs with commit-pinned tree links for Agent Skills, Danger JS, and reviewdog, and recorded the exact revision tokens consulted. | Honest evidence requires a pinned revision when one is claimed. | AC-8 |

No changes to `evidence/analysis.md` (already correct). No production code, tests, `CONTEXT.md`, ADRs, or wiki pages were modified by review.

## Acceptance coverage

| Criterion | Spec unambiguous | Plan task(s) | Verification red-capable | Result |
|---|---|---|---|---|
| AC-1 | yes | T1 | yes — injected `LockIo.writeRecord` fails after `openSync(..., "wx")` succeeds; second assertion confirms no cross-owner removal | covered |
| AC-2 | yes | T2 | yes — typed source/kind test plus rollback test and hermetic installer verification | covered |
| AC-3 | yes | T3 | yes — discriminated union + runtime validator reject creation/update without `nextAction` for non-closed items; closed records remain valid | covered |
| AC-4 | yes | T4 | yes — implementation-stage gate proven by `codepatrol artifact validate --stage implementation`; linter enforces trigger reciprocation, exact `when` values, lifecycle order, and command-template fixtures | covered |
| AC-5 | yes | T4, T5 | yes — Apply/format contract + assessment prose; semantic deviation routes to review; environmental blockage routes to blocked | covered |
| AC-6 | yes | T4, T5 | yes — `lintSkillTree(root)` exports plus catalog fixtures and the `.opencode/commands/` fixture | covered |
| AC-7 | yes | T7 | yes — `codepatrol-verify` reruns `npm run verify` in a clean environment, including the hermetic installer test | covered |
| AC-8 | yes | T5, T6, T7 | yes — Qodo disposition table, pinned references, targeted scans, and the independent verification's diff audit | covered |

## Simplicity axis

- Selected rung: confirmed. The package chose direct local changes that reuse `withWorkspaceLock`, `install-lib.mjs` preflight/rollback, the workflow ledger/store, the catalog/linter, and the existing artifact/plan/review checkers. No scheduler, telemetry backend, or new dependency is introduced.
- Safety floor: retained. Hash/revision/approval validation, lock cleanup, atomic workflow/artifact writes, user authority between primary steps, cancellation, deprecated `merge` compatibility, and red-capable tests are all preserved. The internal `acquireLock` test seam is documented as not part of the public package interface.
- Deferred constraint DC-1: confirmed. The chosen simplification (declarative YAML catalog + local CLI) holds; no trigger was observed. Upgrade path remains "create a separate architecture package."
- Surface delta: matched to plan. Only the planned seams change; no opportunistic cleanup. The package does not introduce new test scaffolding, lint schemas, or abstractions beyond what the trigger table and command-template fixture require.

| Category | Location | Removable surface | Safety/acceptance impact | Disposition |
|---|---|---|---|---|
| reuse | `src/shared/lock.ts` | none — only the cleanup branch is added to an existing function | none | required |
| reuse | `scripts/install-lib.mjs` | none — type derivation replaces a hard-coded `"dir"` | none | required |
| reuse | `src/workflow/types.ts` | none — discriminated union replaces an over-broad optional | AC-3 strengthened | required |
| speculative | none found | — | — | none |

## Executability audit

Paths and interfaces were verified against the graph impact output and the affected test list. Every task names exact files, interfaces, and red/green signals. Dependency order (`T1 → T6`; `T2 → T6`; `T3 → T4 → T5 → T6 → T7`) is consistent with the AC mapping and the per-task ownership rule. The plan no longer leaves T1's test seam or T4's catalog entries to inference, and the deliverer/executor boundary is now explicit.

Residual concerns and evidence gaps:

- The final catalog trigger table contains 27 rows the apply session will write verbatim. Any disagreement between this table and the existing skill prose must be reconciled at apply time and re-verified.
- T7 is the independent delivery verification owned by `codepatrol-verify`; this review records it in the plan but does not pre-run it.
- The `npm run verify` pre-existing test failure (`scripts/install-lib.test.mjs:152` OpenCode hermetic CLI) is exactly the defect T2 fixes; it is not a sign that the package is unsound.

## Verdict

`approve`

Revision 2 of this package is decision-complete and executable. The Apply execution contract, the catalog trigger schema, the conditional `nextAction` invariant, and the apply/verify boundary are all explicit, lintable, and aligned with the existing contract. The Qodo findings are correctly partitioned into accept, reject, and reinterpret dispositions, with false positives documented rather than "fixed" by weakening the parser. The implementer can proceed.

## External evidence sufficiency

**required and sufficient.** The governing `evidence/reference-concepts.md` was re-checked against the pinned revisions: `agentskills/agentskills` commit `38a2ff82958afee88dadf4831509e6f7e9d8ef4e`, Danger JS commit `2c3b5a9e0c5cffa5fc0ef9f5ff59df719444b1cd`, reviewdog commit `a9862c2277ae85b28cee8a9c9e5ffebd5e17b1cd`, OpenAI Agents JS current pages, and MCP `2025-06-18`. The load-bearing claims used by the spec are progressive skill disclosure/frontmatter, pre/post tool guardrails, structured local evidence, trust-seam validation, and diff-scoped review. The recommendation remains adaptation without integration.