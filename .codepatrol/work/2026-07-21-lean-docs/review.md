# Review — Lean docs directory and codepatrol namespace

- Package: `2026-07-21-lean-docs`
- Incoming revision: 1
- Reviewed revision: 2 (after the bounded plan correction recorded below)
- Reviewer: pi (model MiniMax-M3)
- Evidence date: 2026-07-21T15:42:00Z

## Scope and evidence

Read completely: `spec.md`, `plan.md`, and the current source `.gitignore`. Executed this session: `codepatrol status`; `artifact validate --stage review` (valid); `artifact validate --stage plan` (valid); `codepatrol graph sync`; `codepatrol graph impact --file src/artifact/service.ts` (confirmed broad test fan-out including `src/artifact/artifact.test.ts`, `src/artifact/review-check.test.ts`, `src/cli/cli.test.ts`); and enumeration of every `.codepatrol/work`, `.codepatrol/adr`, and `.codepatrol/architecture` reference in source, tests, skills, and docs to confirm the plan's surface forecast is complete.

## Findings

None blocking. One bounded correction recorded below.

## Artifact adjustments

| Artifact | Change | Reason | Acceptance criteria affected |
|---|---|---|---|
| `plan.md` | T1 `.gitignore` rewrite was expanded from two ignores to nine: it now ignores all transient runtime directories (`locks/`, `eval-runs/`, `wiki/`, plus three transient JSONs at the `.codepatrol/` root) so that dropping the broad `.codepatrol/` ignore does not accidentally commit internal state into the repository. | The original T1 only ignored `workflows/` and `code-graph/`. The `.codepatrol/` directory currently holds `locks/`, `eval-runs/`, `wiki/`, and four loose JSON files (e.g. `scan-overview.json`, `version.json`) that must remain local. Without the expanded rules, `git status` would surface them as untracked after the .gitignore flip. The decision rule is mechanical (any directory whose contents are an internal cache or transient state stays ignored; only the documented work, adr, and architecture trees are tracked) and changes no design surface. | AC-3 (only the mechanism by which AC-3 is satisfied; the criterion itself is unchanged). |

## Acceptance coverage

| Criterion | Spec is unambiguous | Plan task(s) | Verification is red-capable | Result |
|---|---|---|---|---|
| AC-1 | yes | T2, T3 | yes — `npm test` re-runs against `.codepatrol/work/` | covered |
| AC-2 | yes | T4 | yes — `lint-skills.mjs` exits 0 and the skill contract suite reads the new paths | covered |
| AC-3 | yes | T1 | yes — manual `cat .gitignore` plus `git check-ignore` round-trip | covered |
| AC-4 | yes | T2, T4 | yes — workspace-wide `rg ".codepatrol/work\|.codepatrol/adr\|.codepatrol/architecture"` returns no hits | covered |
| AC-5 | yes | T6 | yes — `npm run verify` exits 0 | covered |

## Simplicity axis

- Selected rung: confirmed — local reuse. The correction adds zero surface; it is four extra ignore-pattern lines on top of the two already declared.
- Safety floor: intact. All transient machine-local state (`workflows`, `code-graph`, `locks`, `eval-runs`, `wiki`, runtime JSONs) stays out of Git; only the documented process artifacts get tracked.
- Surface delta: unchanged from the revision-1 forecast — no new files, no new dependencies, no new flags, no new manifest fields; one renamed root (`.codepatrol/work/...` -> `.codepatrol/work/...`) plus two parallel relocations (`.codepatrol/adr` and `.codepatrol/architecture`).

| Category | Location | Removable surface or replacement | Safety/acceptance impact | Disposition |
|---|---|---|---|---|
| already sufficient | n/a | nothing removable found | none | confirmed |

## Executability audit

Each task names exact files, exact string replacements, and a final `npm run verify` gate. The self-migration of the active package under T5 is the only sequencing hazard — it is documented in both the spec's *Compatibility and rollout* section and the plan's *Global constraints* ("the active package must be moved to the new path as the final mutation"). An independent implementer can run T1 -> T6 in order against the current `main` checkout and arrive at the revised tree. No unresolved assumption.

## External evidence sufficiency

**Not required.** The package moves in-tree directories and renames string literals; no third-party technology, library, protocol, or externally-sourced pattern is involved, and no user-supplied reference exists.

## Verdict

`approve`

Revision 2 closes the single omission of the original plan: the `.gitignore` rewrite is now exhaustive over every transient directory currently living under `.codepatrol/`, so AC-3 can be satisfied without leaking local state into version control. The contract is decision-complete: scope is bounded to a single namespace consolidation, the path updates are mechanical (with a fully enumerated file list already produced by `rg`), the self-migration of the active package is fenced as the last mutation, and acceptance is closed by the standard gate.

Next owner: `codepatrol-apply` on revision 2. The implementer must read the T5 self-migration rule before any other write and execute T5 last.

## Residual concerns and evidence gaps

- **Reviewer independence:** the producer (`pi`) and the reviewer (`pi`) are the same harness in this session. The Qodo review of the wider repository and the prior apply/verify cycle for this codebase provide circumstantial corroboration, but they do not substitute for a second harness physically running the gate in isolation. The implementer who follows should treat this approval as governance-backed and gate their own execution independently.
- **No execution of T1..T6 was performed during review.** This is intended — review does not mutate production code. The correctness of T1's ignore-list expansion was verified by direct enumeration of `.codepatrol/` rather than by running `git check-ignore`; the implementer is expected to do that as part of T1 step 4 and surface any unexpected match.
- **`evidence/` for this package is empty.** That is correct — the work is a literal-string migration with all required evidence being the workspace-wide file list, which is captured in `spec.md` itself rather than a separate evidence file.
