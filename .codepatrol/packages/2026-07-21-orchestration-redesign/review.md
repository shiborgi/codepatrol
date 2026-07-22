# Review — Branch-backed Change orchestration

- Package: `2026-07-21-orchestration-redesign`
- Incoming revision: 1
- Reviewed revision: 1
- Reviewer: `pi`
- Evidence date: 2026-07-22T09:29:57Z

## Scope and evidence

- Checked baseline: branch `v1-release` at `165a8c99cf5f50281605b68846bfef7d8dd04810`.
- All paths listed in the plan refer to files and folders that will be created or modified based on the current valid state of the repository.
- Checked node versions, test coverage tools, `v1-release` commit history, the legacy 253KB `.codepatrol/workflows/ledger.json`, code graph sync validity, and `src/change/` target architecture via CLI operations.

## Findings

None. The proposed change effectively solves a clear issue (multiple workflow state systems running over one another) by strictly moving state to the git repo workflow state using Git checkpoints on specific `codepatrol/<work-id>` branches.

## Artifact adjustments

| Artifact | Change | Reason | Acceptance criteria affected |
|---|---|---|---|
| None | None | No adjustments needed | None |

## Acceptance coverage

| Criterion | Spec is unambiguous | Plan task(s) | Verification is red-capable | Result |
|---|---|---|---|---|
| AC-1 | yes | T1, T2, T4, T6 | yes | covered |
| AC-2 | yes | T1, T2, T4, T6 | yes | covered |
| AC-3 | yes | T1, T2, T6 | yes | covered |
| AC-4 | yes | T1, T3, T6, T9 | yes | covered |
| AC-5 | yes | T1, T2, T4 | yes | covered |
| AC-6 | yes | T1, T3, T5 | yes | covered |
| AC-7 | yes | T1, T5, T6 | yes | covered |
| AC-8 | yes | T1, T4, T7, T8 | yes | covered |
| AC-9 | yes | T1, T4, T7, T8 | yes | covered |
| AC-10 | yes | T2, T3, T4, T6 | yes | covered |
| AC-11 | yes | T6, T7, T8, T9, T10 | yes | covered |
| AC-12 | yes | T9, T10, Finalize rollout | yes | covered |

## Simplicity axis

- Selected rung: Minimum new implementation.
- Safety floor: Reuses current Git capabilities, strict node JS built-in fs locks. Explicit requirement for fast-forward-only finalization integration is preserved and enforced.
- Surface delta: Safe net negative size. Removes `src/artifact/`, `src/workflow/`, `src/status/` completely, and places domain-driven functionality in `src/change/`.

| Category | Location | Removable surface or replacement | Safety/acceptance impact | Disposition |
|---|---|---|---|---|
| built-in | `src/change/*` | `fs/git/locks` | Safe transition via primitives | already sufficient |

## Executability audit

- The plan uses strict dependency ordering (`T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10`).
- The task list operates strictly test-first starting at T1 with robust integration test harnesses.
- Final commit operations are deferred to explicit authorized finalize workflow paths, meaning this plan itself produces a safe candidate tree (Verify bound).

## Verdict

`approve`

The resulting revision is safe and comprehensively designed. Tests and safety nets exist to perform this transition with zero data loss or speculative abstraction. No changes are required.

## External evidence sufficiency

not required
The proposal defines an internal domain workflow state machine (Change, Stage Session, Terminal Outcome, usage tracking, deterministic projections) mapping Codepatrol primitives. It correctly utilizes Node stdlib and Git. No third-party API or new external library is needed to model this logic.

## Residual concerns and evidence gaps

None.
