# Apply Journal — Finalize Merge Main

## T1 — Extract closeWork function

**Action**: Extracted `closeWork` in `src/change/orchestrator.ts` and updated `completeFinalization` to call it.
**Result**: Preserved safety checks and successfully passed `change/git.test.ts` baseline assertions and full project gate.

All criteria met.
