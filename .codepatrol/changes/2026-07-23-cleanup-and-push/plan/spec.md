# Specification — Minor improvements, push option, token count logic, and legacy cleanup

## Intent

- Origin: improve-codebase
- Mode: feature
- Target baseline: main
- Governing constraints: None — isolated enhancements and cleanups
- Substrate state: absent
- Problem: The `close` step requires a manual push of the branch after committing; step token counts rely on LLM API metrics which do not accurately reflect the actual string characters of inputs/outputs; there is legacy code left over from a recent refactor.
- Outcome: The `close` step allows an option to push after commit; step token counting is based on character counts for input and output; legacy skills, dead code, and old method names are eliminated.

## Scope

### In scope

- Update `CloseInput` to support an optional `push` flag.
- Update `closeChangeLocked` and `completeFinalization` to perform a push if requested.
- Update `sumPiUsage` or equivalent token tracking in `.pi/index.ts` to calculate `input` and `output` tokens based on character length of the messages (e.g. `role === "user"` vs `role === "assistant"`).
- Evaluate `skills/` and `src/` to identify and remove unused code, old method names, and leftover files from the recent lifecycle refactor.

### Out of scope

- Re-architecting the token usage reporting schema (we will reuse the `input`/`output` fields in `UsageSummary`).

## Current evidence

- `src/change/orchestrator.ts` contains `closeChangeLocked`, which is the entry point for finalizing a change.
- `src/change/git.ts` may need an `await git.push(branch, signal)` method if one does not exist.
- `.pi/index.ts` calculates `sumPiUsage` using `message.usage.input` and `message.usage.output`.
- The `skills/catalog.yaml` defines the active skills, but there may be unused skills in the folder (e.g., if old skills were replaced by `codepatrol-*`).

## Proposed design

1. **Push option in Close**: Add `push?: boolean` to `CloseInput` in `src/change/types.ts`. In `src/change/orchestrator.ts` during `completeFinalization`, if `outcome === "commit"` and `push` is true, execute a `git push origin <target_branch>`. Add a `push` method to `GitAdapter` in `src/change/git.ts`.
2. **Token tracking**: In `.pi/index.ts`'s `sumPiUsage`, instead of relying on `message.usage`, we will sum the string length of `message.content` (if available) for `input` (user/system roles) and `output` (assistant role). 
3. **Legacy cleanup**: We will manually evaluate all skills in `skills/`, comparing them against `catalog.yaml`, and scan `src/` for unused exports, old names, and dead tests to remove them.

## Alternatives

- Keeping tokens as API tokens: Rejected because the user specifically requested character length for input/output.
- Prompting the user to push manually: Rejected because the user wants a push option directly in the close step.

## Simplicity decision

- Selected rung: direct local change
- Earlier rungs: N/A, we are modifying local behaviors.
- Irreducible complexity: Git interactions must be safely handled, handling network failures during push gracefully.
- Safety floor: Push must only happen if the close commit was successful. Token calculation must not crash if messages lack text content.
- Expected surface delta: ~3 files modified (`git.ts`, `orchestrator.ts`, `.pi/index.ts`), various legacy files deleted.

## Deferred constraints

| ID | Chosen simplification | Known ceiling | Observable trigger | Upgrade path |
|---|---|---|---|---|
| DC-1 | None | N/A | N/A | N/A |

## Compatibility and rollout

- Transparent to existing sessions. `push` defaults to false.

## Risks and mitigations

- Push might fail if remote has advanced. The user handles git resolution if push fails.
- Changing token calculation changes the scale of "tokens" to "characters", but since it's just a metric, it shouldn't affect system stability.

## Acceptance criteria

- AC-1: `CloseInput` allows `push: boolean`, and when set to true and outcome is `commit`, the target branch is pushed to origin.
- AC-2: Step token counting uses characters of input/output instead of API return metrics.
- AC-3: Legacy code, obsolete skills, and old method names are removed, ensuring the codebase is completely lean for its current architecture.

## Decisions and open questions

None.
