# Review — Finalize Merge Main

- Change: `2026-07-23-finalize-merge`
- Incoming revision: 1
- Reviewed revision: 1
- Reviewer: opencode
- Evidence date: 2026-07-23T16:35:00Z

## Scope and evidence

Checked:

- `change.yaml` (base_commit, branch, plan checkpoint `1878eff`).
- `plan/spec.md` (sha256 `95caba3a…`, intent `create`).
- `plan/plan.md` (sha256 `3b09ac78…`, intent `create`).
- Branch tip `d73b587` on `codepatrol/2026-07-23-finalize-merge`, base_commit `26cf8405` matches `refs/heads/main` HEAD.
- `src/change/orchestrator.ts:339-352` (current `completeFinalization`).
- `src/change/git.ts:10-73` (`GitAdapter` methods: `currentBranch`, `branchExists`, `deleteBranch`, `mergeFf`).
- `src/change/git.test.ts:134,144,213,215,219,236,240,241` (existing `finalizeChange` tests including `CHANGE_DRIFT` and `TARGET_ADVANCED`).
- `git diff --stat 26cf8405..codepatrol/2026-07-23-finalize-merge` shows only lifecycle artifacts (no production code yet — expected for Review).

Limitations: no external evidence required; substrate state is `absent`; no `research-technology` invocation needed. `assess-change` not invoked because the defects are visible from local source comparison.

## Findings

### major — plan

The proposed `completeFinalization` body in `plan.md:69-77` is a 4-line replacement for the current 11-line implementation at `src/change/orchestrator.ts:339-352`. The replacement silently drops the upstream safety checks that protect the fast-forward path. The spec's own Risks section (`spec.md:64-65`) says "Keep the existing `git.mergeFf` call and safety checks, just move them into the `closeWork` function", but the plan code does not move them — it deletes them.

What disappears in the proposed body:

1. `targetHead` (target branch HEAD) check vs `base_commit` for rollback (`orchestrator.ts:341`) → `TARGET_ADVANCED` thrown before any mutation.
2. `targetHead` check vs `base_commit || terminalCommit` for commit (`orchestrator.ts:342`) → `CHANGE_DRIFT` thrown before any mutation.
3. `currentBranch` reconciliation + `git.checkout(target_branch)` (`orchestrator.ts:343-345`) → ensures the merge runs from the target worktree.
4. Postcondition `parseStatusPaths(await git.status(signal)).length` check (`orchestrator.ts:351`) → `CHANGE_CONFLICT` if the worktree is dirty after merge.

Impact:

- `src/change/git.test.ts:240` asserts `finalizeChange(..., { outcome: "commit" }, at(19))` rejects with `CodepatrolError` code `CHANGE_DRIFT`. The proposed body skips the `targetHead`-vs-`base_commit`-or-`terminalCommit` check, so the test would either accept a non-FF state or fail downstream without the documented error code.
- `src/change/git.test.ts:213` asserts `TARGET_ADVANCED` on rollback from a wrong HEAD. The proposed rollback branch (`plan.md:73-75`) only checks `checkedOutHead` after a missing checkout step; the upstream targetHead check is gone.
- AGENTS.md prescribes "Preserve unrelated user changes. Never reset, force, rebase …". Running the merge without first reconciling to `target_branch` and verifying a clean worktree can fail into a `CHANGE_CONFLICT` only after the merge attempted, instead of before.

### major — plan

AC-1 verification (`plan.md:27`) is "manual review of `src/change/orchestrator.ts`". That is not a red-capable verification. AGENTS.md requires Apply to "establish the planned red/characterization loop" before mutating. The plan must name the existing test (e.g. `src/change/git.test.ts:240`) as the red loop and require it to fail before changes are applied, then pass after.

### minor — spec

`spec.md:29` cites user intent ("the user explicitly requests …") as current evidence. The Change records only the prompt, not an authority reference. Minor because the intent is verified by the title and the user remains the sole authority on the v1 lifecyle rename.

## Artifact adjustments

| Artifact | Change | Reason | Acceptance criteria affected |
|---|---|---|---|
| `plan.md` | Rewrite `T1` step 2: the new `completeFinalization` must retain the upstream `targetHead` checks (lines 341-342), the `currentBranch` reconciliation + `checkout` (lines 343-345), and the post-merge clean worktree postcondition (line 351). The `closeWork` extraction only owns the merge + branch delete currently at lines 347-350. | Safety floor stated in `spec.md:49` and `spec.md:64-65` requires preserving the existing checks; the current snippet violates that. | AC-1, AC-2 |
| `plan.md` | Replace "manual review" verification for AC-1 with the existing `src/change/git.test.ts` cases (lines 134, 144, 213, 240, 241) as the red loop; require they fail before the edit and pass after. | Apply requires a red-capable loop per AGENTS.md; "manual review" is not. | AC-1, AC-2 |

No edits to `spec.md` are required at the artifact level. The spec content is acceptable; the defect is in the plan implementation.

## Acceptance coverage

| Criterion | Spec is unambiguous | Plan task(s) | Verification is red-capable | Result |
|---|---|---|---|---|
| AC-1 | yes | T1 (defective) | no — manual review is not red | rework |
| AC-2 | yes | T1 (defective) | partial — `npm run test` is red-capable but the plan's `closeWork` snippet would break `git.test.ts:240` | rework |

## Simplicity axis

- Selected rung: direct local change. **Corrected**: the plan over-extracted by pulling too much into `closeWork` while leaving the caller a stripped-down version. The corrected rung keeps `closeWork` minimal (merge + branch delete) and `completeFinalization` owns the safety sequence.
- Safety floor: fast-forward guarantees (target HEAD == base_commit || terminalCommit, branch checkout, clean postcondition) — all retained. Plan currently fails this floor.
- Surface delta: 0 files added; 1 file modified (`src/change/orchestrator.ts`). Correct.

| Category | Location | Removable surface or replacement | Safety/acceptance impact | Disposition |
|---|---|---|---|---|
| remove | `plan.md:69-77` (proposed `completeFinalization`) | Drop the 4-line replacement and rewrite to keep the upstream safety checks. | Required — removes safety violation. | required correction |
| simplify | `closeWork` snippet (`plan.md:56-66`) | Keep as-is; it only owns merge + branch delete. | None. | already sufficient |

No deferred constraints. No external evidence required.

## Executability audit

- Paths/interfaces: `GitAdapter.{head, currentBranch, branchExists, deleteBranch, mergeFf, checkout, status}` exist (`git.ts:10-73`). Reusable.
- Commands: `npm test`, `npm run verify` are the documented gates.
- Red signal: not yet established. Plan must name the existing test cases as the red loop before Apply.
- Green signal: existing test cases pass after the corrected extraction.
- Rollback: feature branch `codepatrol/2026-07-23-finalize-merge` is already created from `26cf8405`; deleting the branch is the demonstrated rollback path.
- Context independence: confirm. The change is local to `src/change/orchestrator.ts` and the existing tests.
- Unresolved assumption: none after corrections.

## Verdict

`rework`

The plan replaces the current 11-line `completeFinalization` with a 4-line body that drops four distinct safety checks (targetHead reconciliation, branch checkout, drift rejection, clean-worktree postcondition). The spec's own Risks section requires preserving those checks, and the existing `src/change/git.test.ts` (lines 134, 144, 213, 240, 241) encodes them as failing assertions. Additionally, AC-1 verification is "manual review", which is not red-capable. Both AC-1 and AC-2 fail coverage. The next permitted transition is a new Plan attempt (`codepatrol-plan 2026-07-23-finalize-merge`) that keeps the upstream safety checks in `completeFinalization` and replaces the verification of AC-1 with the existing test cases.

## External evidence sufficiency

`not required` — the change is a local refactor inside `src/change/orchestrator.ts`; no external protocol, dependency, or third-party API is involved.

## Residual concerns and evidence gaps

- I did not run `npm test` or `npm run verify`; Review is read-only and the defect is provable from source.
- The plan's correctness depends on the assumption that `completeFinalization` is the only caller of `mergeFf` in the commit path. Verified by `grep` over `src/change/orchestrator.ts` (single `mergeFf` call at line 347); no other usages.
- Worktree and remote state were not touched. Branch tip `d73b587` and base_commit `26cf8405` were verified against `refs/heads/main` HEAD via `git rev-parse`.
