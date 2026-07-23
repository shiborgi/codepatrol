# Review — Finalize Merge Main (attempt 2)

- Change: `2026-07-23-finalize-merge`
- Incoming revision: 2
- Reviewed revision: 2
- Reviewer: opencode
- Evidence date: 2026-07-23T17:05:00Z

## Scope and evidence

Checked:

- `change.yaml` events and attempts through Plan checkpoint `aa8859b9` (tree `0eab425f`).
- Branch tip `ac3163b` on `codepatrol/2026-07-23-finalize-merge`, base_commit `26cf8405` matches `refs/heads/main` HEAD.
- `plan/plan.md` (sha256 `b3e0a1014b11cd54c1a759e6a40d8e6eff3e6fa54e298084bcd68544ae79f9a6`, intent `modify`).
- `plan/spec.md` (sha256 `95caba3a…`, intent `modify` — content byte-identical to attempt 1; covered as a minor audit note below).
- `src/change/orchestrator.ts:339-352` (current `completeFinalization`, unchanged from base).
- `src/change/git.test.ts:134, 144, 213, 240, 241` (red-loop candidates declared by the plan).
- Prior review report (sha256 `418031e1…`, returned from attempt 1 and removed by the planner via commit `2817ace` before the new plan run).

Limitations: no external evidence required. `assess-change` not invoked because the previous defects are now closed by inspection of the proposed diff.

## Findings

None blocking.

### minor — evidence

`plan/spec.md` is declared with intent `modify` but its sha256 is identical to the attempt 1 contents (`95caba3a…`). The orchestrator's `validateWorkspaceArtifacts` accepted the binding (hash matches the declared artifact), so the checkpoint is valid; the discrepancy is an audit trace nit, not a correctness defect. No review action required.

### minor — spec

`spec.md:64-65` still says "Keep the existing `git.mergeFf` call and safety checks, just move them into the `closeWork` function." The plan correctly keeps the checks in `completeFinalization` instead of moving them into `closeWork`, which is the right interpretation of the spec's safety floor. The spec wording is now slightly misleading; not blocking.

## Artifact adjustments

| Artifact | Change | Reason | Acceptance criteria affected |
|---|---|---|---|
| `plan.md` | none | Both prior findings (F1 over-extraction, F2 non-red verification) are resolved by the new plan. | AC-1, AC-2 |
| `spec.md` | none | Content is acceptable; the spec floor is satisfied. The wording nit is informational. | — |

## Acceptance coverage

| Criterion | Spec is unambiguous | Plan task(s) | Verification is red-capable | Result |
|---|---|---|---|---|
| AC-1 | yes | T1 (steps 2-3) | yes — `src/change/git.test.ts:134, 144, 213, 240, 241` assert `CHANGE_DRIFT` / `TARGET_ADVANCED` and were named explicitly in T1 step 4 | covered |
| AC-2 | yes | T1 (steps 2-3) | yes — same test suite driven by `npx node --test src/change/git.test.ts` plus the `npm run verify` gate | covered |

## Simplicity axis

- Selected rung: **confirmed** — direct local change to `src/change/orchestrator.ts`. The previous over-extraction is corrected: `closeWork` owns only the merge + branch delete, and `completeFinalization` retains the upstream safety sequence.
- Safety floor: **preserved** — `targetHead` reconciliation, `currentBranch` check + `checkout`, `TARGET_ADVANCED`/`CHANGE_CONFLICT` rejection, and the clean-worktree postcondition are all kept in `completeFinalization`. The new `closeWork` body uses `checkedOutHead === base_commit` to gate the merge and re-checks `checkedOutHead !== terminalCommit` for drift, matching the prior behavior.
- Surface delta: 0 files added; 1 file modified (`src/change/orchestrator.ts`). Correct.

| Category | Location | Removable surface or replacement | Safety/acceptance impact | Disposition |
|---|---|---|---|---|
| reuse | `closeWork` (new) | Reuses existing `GitAdapter` methods (`head`, `mergeFf`, `branchExists`, `deleteBranch`). | None. | already sufficient |
| built-in | `completeFinalization` rewrite | Keeps `CodepatrolError` codes (`TARGET_ADVANCED`, `CHANGE_CONFLICT`) and `parseStatusPaths` postcondition. | None — matches existing tests. | already sufficient |
| simplify | `closeWork` signature | `tag, terminalCommit` order matches the call site and reads naturally. | None. | already sufficient |

No deferred constraints. No external evidence required.

## Executability audit

- Paths/interfaces: `GitAdapter.{head, currentBranch, branchExists, deleteBranch, mergeFf, checkout, status}` verified at `src/change/git.ts:10-73`. Reusable.
- Commands: `npx node --test src/change/git.test.ts` (red/green loop), `npm run verify` (pipeline gate), `npm test` (full suite). Documented.
- Red signal: T1 step 1 records the baseline (test passes today). The same test cases are the red loop named in step 4.
- Green signal: same test cases pass after the rewrite; `npm run verify` passes.
- Rollback: feature branch `codepatrol/2026-07-23-finalize-merge`; deleting the branch is the demonstrated rollback path. No remote push to undo.
- Context independence: confirmed. The change is local to `src/change/orchestrator.ts` and the existing tests.
- Unresolved assumption: none.

## Verdict

`approve`

The new Plan retains every upstream safety check the previous attempt accidentally dropped (`targetHead` reconciliation, branch reconciliation + `checkout`, `CHANGE_DRIFT` rejection, clean-worktree postcondition), and replaces the non-red "manual review" verification with `src/change/git.test.ts` cases named by line number. The `closeWork` function is correctly scoped to the merge + branch delete, and the `completeFinalization` rewrite is operationally the same as the current code with the merge and postcondition branch delegated. AC-1 and AC-2 are both red-capable against the existing test suite. The next permitted transition is the Apply stage.

## External evidence sufficiency

`not required` — the change is a local refactor inside `src/change/orchestrator.ts`; no external protocol, dependency, or third-party API is involved.

## Residual concerns and evidence gaps

- I did not run `npx node --test src/change/git.test.ts` or `npm run verify`; Review is read-only and the proposed diff is verifiable from source and the documented test cases.
- The pre-existing review report (`review/report.md`) was removed by the planner (`2817ace`) to fix the delta before the new checkpoint. The return verdict is preserved in `change.yaml` events, so the rework lineage is intact.
- The `intent: "modify"` on a byte-identical `spec.md` is recorded as an audit nit; the orchestrator's hash validation accepted the binding, and the defect did not block checkpoint.
- I did not recheck `git status` against the worktree; the branch tip `ac3163b` matches `codepatrol/2026-07-23-finalize-merge` and the working tree carries the three Plan checkpoints plus the prior review commits recorded in `change.yaml`.
