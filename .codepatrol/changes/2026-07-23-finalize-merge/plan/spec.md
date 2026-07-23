# Specification — Finalize Merge Main

## Intent

- Origin: improve-codebase
- Mode: feature
- Target baseline: main
- Governing constraints: None — no specific ADR dictates the internal function structure of finalize.
- Substrate state: absent
- Problem: The finalize flow currently mixes receipt generation, state transitions, and Git integration directly in `finalizeChangeLocked` and `completeFinalization`. We need `finalize` to explicitly call a `close` function that handles the closing of a work (committing the branch and merging into main) for better separation of concerns.
- Outcome: `finalizeChange` calls an explicit `closeWork` function that commits the branch and merges to `main`.

## Scope

### In scope

- Extracting a `closeWork` function in `src/change/orchestrator.ts`.
- Updating `completeFinalization` to call `closeWork` for committing the branch and merging to main.

### Out of scope

- Changes to how rollback works, other than potentially routing it through similar separation if applicable.
- Changes to the CLI input parsing or output rendering.

## Current evidence

- `src/change/orchestrator.ts` contains `finalizeChangeLocked` and `completeFinalization`.
- `completeFinalization` merges to the target branch (e.g. `main`) via `git.mergeFf`.
- The user explicitly requests adjusting the flow so that finalize calls close and closes a work, committing the branch and doing a merge to main.

## Proposed design

Introduce a `closeWork` function in `src/change/orchestrator.ts`.
The `completeFinalization` function will call `closeWork` when the outcome is `commit`.
`closeWork` will encapsulate:
1. Verifying the target branch.
2. Merging the feature branch into `main` (or the target branch) using the tag.
3. Deleting the feature branch.

## Alternatives

Keep the logic inline in `completeFinalization`. Rejected because the prompt explicitly requests adjusting the flow so that `finalize` calls `close` to close a work, commit the branch, and merge main.

## Simplicity decision

- Selected rung: direct local change
- Earlier rungs: n/a
- Irreducible complexity: Git integration must still occur using the `GitAdapter`.
- Safety floor: The fast-forward safety checks in `completeFinalization` must be maintained.
- Expected surface delta: Modified `src/change/orchestrator.ts`.

## Deferred constraints

| ID | Chosen simplification | Known ceiling | Observable trigger | Upgrade path |
|---|---|---|---|---|
| DC-1 | None — n/a | n/a | n/a | n/a |

## Compatibility and rollout

No external compatibility impact. The `change finalize` CLI command will behave identically to users.

## Risks and mitigations

- Risk: The merge logic changes and breaks the fast-forward guarantees.
- Mitigation: Keep the existing `git.mergeFf` call and safety checks, just move them into the `closeWork` function.

## Acceptance criteria

- AC-1: `finalizeChange` (via `completeFinalization`) calls a `closeWork` function.
- AC-2: The `closeWork` function merges the branch into `main` (the target branch) and cleans up the feature branch.

## Decisions and open questions

- Decided to name the function `closeWork` for clarity since "close" could conflict with file closures.
