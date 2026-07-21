# Review — Lean docs directory and codepatrol namespace

- Package: `2026-07-21-lean-docs`
- Incoming revision: 3
- Reviewed revision: 3 (after the bounded plan corrections recorded below)
- Reviewer: pi (model MiniMax-M3)
- Evidence date: 2026-07-21T16:37:00Z

## Scope and evidence

Read completely: `spec.md`, `plan.md`, and the prior `review.md` (revision-1 verdict). Executed this session: `codepatrol status`; `artifact validate --stage review` (valid); `artifact validate --stage plan` (valid); `codepatrol graph sync`; `codepatrol graph impact --file src/status/service.ts` (blast radius of 3 affected files including `src/status/status.test.ts`); and direct read of `src/artifact/types.ts`, `src/artifact/service.ts`, `src/status/service.ts`, and the affected skills.

## Findings

Two blocking defects found and corrected in this review (recorded under *Artifact adjustments* below).

## Artifact adjustments

| Artifact | Change | Reason | Acceptance criteria affected |
|---|---|---|---|
| `plan.md` | Renamed target directory throughout (`package` → `packages`) in the Goal, T1, T2, T5, T8 steps and the Acceptance mapping table. | User instruction (pluralization) supersedes prior text. Mechanical change with no architectural impact. | AC-1, AC-2, AC-4 |
| `plan.md` | T1 reference target expanded to all four primary skills (`codepatrol-plan`, `codepatrol-review`, `codepatrol-apply`, `codepatrol-verify`) instead of just two. T4 step 5 was rewritten as a *generic, unconditional* handoff rule ("NEVER automatically invoke the next workflow … Stop and await user instruction after sealing the stage"). | User instruction: the runaway-pipeline bug is a *generic* enforcement problem, not a `review → apply` pair. The corrected rule applies to every primary skill so any agent reading any of them gets the same stop signal, regardless of which step the producer happened to call. | AC-7 |
| `plan.md` | T8 verification text aligned with the corrected plural path. | Mechanical alignment with the rename. | AC-5 |
| `spec.md` | Goal-and-rollout paragraph and Compatibility-and-rollout paragraph updated to reference `.codepatrol/packages/` (plural). | Mechanical alignment with the rename. | AC-1 |

No production code, tests, `CONTEXT.md`, ADRs, wiki pages, or generated runtime files were modified by this review.

## Acceptance coverage

| Criterion | Spec is unambiguous | Plan task(s) | Verification is red-capable | Result |
|---|---|---|---|---|
| AC-1 | yes | T2, T3 | yes — `npm test` re-runs against `.codepatrol/packages/` | covered |
| AC-2 | yes | T4 | yes — `lint-skills.mjs` exits 0 | covered |
| AC-3 | yes | T1 | yes — manual `cat .gitignore` plus `git check-ignore` round-trip | covered |
| AC-4 | yes | T2, T4 | yes — workspace-wide `rg ".codepatrol/work\|docs/codepatrol\|.codepatrol/adr\|.codepatrol/architecture"` returns no hits | covered |
| AC-5 | yes | T8 | yes — `npm run verify` exits 0 | covered |
| AC-6 | yes | T6 | yes — focused status test (ledger-only entries without a physical package are excluded) is observably red then green | covered |
| AC-7 | yes (after this review's correction) | T4 | yes — `rg -l "automatically invoke" skills/codepatrol-plan/SKILL.md skills/codepatrol-review/SKILL.md skills/codepatrol-apply/SKILL.md skills/codepatrol-verify/SKILL.md` returns 4 | covered |
| AC-8 | yes | T7 | yes — focused test asserting `stamp.harness` reflects the runtime model (not a hardcoded value) is observably red then green | covered |

## Simplicity axis

- Selected rung: confirmed — local reuse.
- The corrections add no surface. They rename one root path string and widen one rule to four skills instead of two. The widened rule is the *minimum sufficient* enforcement because it must apply uniformly to every primary skill: a narrower rule would leave the same defect in the other three.
- Safety floor: intact. The `.gitignore` expansion recorded in the revision-2 review still covers every transient directory under `.codepatrol/`.
- Surface delta: unchanged from the revision-2 forecast.

| Category | Location | Removable surface or replacement | Safety/acceptance impact | Disposition |
|---|---|---|---|---|
| already sufficient | n/a | nothing removable found | none | confirmed |

## Executability audit

Each task names exact files, exact string replacements, and a final `npm run verify` gate. T4 step 5 now carries an explicit "stop" rule for every primary skill, replacing the earlier narrow pair. T6 (kanban fix) and T7 (identity fix) are scoped to single modules and have focused tests that prove them red-capable. The self-migration of the active package under T5 is fenced as the last mutation and is documented in both spec and plan.

## External evidence sufficiency

**Not required.** The package moves in-tree directories, renames string literals, and adds a one-line instruction to four skill files; no third-party technology, library, protocol, or externally-sourced pattern is involved, and no user-supplied reference exists.

## Verdict

`approve`

Revision 3 of this package is decision-complete and executable: the original `.codepatrol/work/` → `.codepatrol/packages/` rename is consistent across both artifacts, the runaway-pipeline enforcement is now a generic rule applying to every primary skill (not just two), and the AC-6 / AC-8 bugfixes carried over from the prior investigation are scoped to single modules with red-capable tests. The contract is sound and the implementer can proceed.

Next owner: `codepatrol-apply` on revision 3. The implementer must (a) read T5's self-migration rule and execute T5 last, (b) update exactly four skill files in T4 step 5 with the verbatim "Stop and await user instruction" rule, and (c) leave the renamed `.codepatrol/packages/` path active before running T8.

## Residual concerns and evidence gaps

- **Reviewer independence:** the producer (`pi`) and the reviewer (`pi`) are the same harness in this session. A second harness running T8 independently is the only way to confirm the gate is green in a non-circular way.
- **T4 step 5 wording is not yet linted.** The four skill files do not currently contain the phrase "automatically invoke", so any lint assertion is green-vacuous today. After T4 lands, the implementer should add a `skills-contract.test.mjs` assertion that all four `SKILL.md` files contain the verbatim stop rule.
- **No execution of T1..T8 was performed during review.** This is intended — review does not mutate production code. The T8 verification is reserved for the implementer and the independent verifier.
- **`evidence/` for this package is empty.** Correct — the work is a literal-string migration plus a one-line skill-instruction addition; the file-enumeration evidence is captured in `spec.md` and the prior `review.md`.
