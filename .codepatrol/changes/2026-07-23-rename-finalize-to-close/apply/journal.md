# Implementation Journal

### T1 — Core types and schema

**Completed:** Renamed `finalize` to `close` across `src/change/types.ts`, `src/change/model.ts`, and `src/change/board.ts`.
**Evidence:** `npx tsc -p tsconfig.build.json --noEmit` returned expected TS errors referencing `FinalizeInput`, `change-finalized`, etc in `orchestrator.ts` and `cli/commands.ts`.

### T2 — Orchestrator and CLI

**Completed:** Renamed orchestrator methods (`closeChange`, etc.), CLI commands (`change close`), and directory paths (`close/receipt.md`).
**Evidence:** `npx tsc -p tsconfig.build.json --noEmit` is green for source files (only `.pi/index.ts` remains red, to be fixed in T4).

### T3 — Tests and Fixtures

**Completed:** Updated tests (`change.test.ts`, `board.test.ts`, `git.test.ts`, `.pi/index.test.ts`), fixtures, and `smoke-cli.mjs` to expect `close`. Note: also fixed `.pi/index.ts` alongside tests to unblock compilation.
**Evidence:** `npm run build && npm run test && node scripts/smoke-cli.mjs` all run cleanly.

### T4 — Skills, Documentation and Extensions

**Completed:** Renamed `codepatrol-finalize` skill to `codepatrol-close`, and its internal format doc to `CLOSE-FORMAT.md`. Renamed opencode command. Updated paths/references in `README.md`, `AGENTS.md`, `docs/`, `scripts/`, `skills/` and `.pi/index.ts`.
**Evidence:** Tests passed, `node scripts/lint-skills.mjs` passed. All occurrences successfully renamed.

### T5 — Final Verification

**Completed:** Verified all ACs.
**Evidence:** 
- `npx tsc` and `npm run test` passed successfully.
- `node scripts/lint-skills.mjs` and contract tests passed.
- `codepatrol graph find --query finalize` returns no matches.
- Smoke tests ran perfectly with `change close` working as expected.
