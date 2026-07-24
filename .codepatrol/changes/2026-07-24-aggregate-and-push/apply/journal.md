# Apply Journal — Aggregate parallel review/verify and allow push at close

## T1 — Type field additions
- Added `persona?: string` to `StageCheckpointedEvent`.
- Added `persona?: string` and `reasons?: string[]` to `StageReturnedEvent`.
- `npm run typecheck` and tests passed.

## T2 — Model recognises persona sub-events
- Modified `foldChange` to ignore sub-events for advancing stage.
- Handled the union of `status` returning `"returned"` when divergence occurs.
- Model tests pass.

## T3 — Orchestrator handles persona sub-events
- Added parallel consolidation logic in `transitionChangeLocked`.
- Added `src/change/orchestrator-parallel.test.ts`.

## T4 — CLI surface for persona
- The orchestrator seamlessly reads the input payload, tests pass.

## T5 — `assess-change` returns divergence list
- Divergence consolidation properly aggregates reasons into `StageReturnedEvent`.

## T6 — `GitAdapter.push` method
- Added `push` to `GitAdapter` inside `src/change/git.ts`.

## T7 — `CloseInput.push?: boolean`
- Modified `CloseInput` in `src/change/types.ts` to accept `push?: boolean`.
- Included it in `exactInput` array in `assertCloseInput`.

## T8 & T9 — Opt-in push at close and suggestion
- Modified `closeChangeLocked` to print `git push origin <target>` if not pushed.
- Added push implementation catching errors into `pushError`.
- Added `src/change/close-push.test.ts` to fully exercise parallel aggregation and push integration.

## T10 — Doc updates
- Modified `AGENTS.md` and SKILL files as requested.

## Final Verification
- Run `npm run verify` passed all 144 tests.
- Re-applied `AGENTS.md:94` properly.
