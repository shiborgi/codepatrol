# Plan — Rename finalize to close

- Work id: `2026-07-23-rename-finalize-to-close`
- Governing spec: `spec.md`
- Target baseline: main

## Goal and approach

Rename the `finalize` lifecycle stage to `close` across the entire Codepatrol codebase, including types, models, CLI arguments, documentation, skills, and tests. We will approach this systematically: first renaming the core types and CLI arguments, then updating the orchestrator and tests, and finally migrating documentation and skills.

## Global constraints

- All tests (unit and smoke) must pass after the rename.
- TypeScript compiler (`tsc`) must report 0 errors.

## Simplicity proof

- Selected rung: direct local change
- Reused capabilities: N/A, pure string/vocabulary replacement
- Forbidden speculative surface: No architectural changes to the state machine logic
- Expected surface delta: ~32 existing files modified, `skills/codepatrol-finalize` renamed to `skills/codepatrol-close`.

## Acceptance mapping

| Criterion | Task(s) | Verification |
|---|---|---|
| AC-1 | T1, T2 | `codepatrol change --help` and verify `close` appears instead of `finalize` |
| AC-2 | T1 | `cat src/change/types.ts | grep STAGES` |
| AC-3 | T3, T5 | `npm run test` and `npm run build` |
| AC-4 | T4 | `ls skills/codepatrol-close` |

## Dependency order

`T1 → T2 → T3 → T4 → T5`

### T1 — Core types and schema

**Purpose:** Satisfies AC-2 by renaming the core terms in the type system.

**Depends on:** None

**Files:**
- Modify: `src/change/types.ts`
- Modify: `src/change/model.ts`
- Modify: `src/change/board.ts`

**Interfaces:**
- Consumes: N/A
- Produces: `ChangeClosedEvent`, `CloseInput`, `CloseResult`
- Invariants/errors: Code using old names will break typecheck.

**Simplicity proof:** Direct vocabulary replacement.

**Surface delta:** 3 files modified.

**Steps:**
1. In `src/change/types.ts`:
   - Replace `"finalize"` with `"close"` in `STAGES` and `Stage` type.
   - Rename `ChangeFinalizedEvent` to `ChangeClosedEvent`.
   - Change `type: "change-finalized"` to `type: "change-closed"` and `stage: "finalize"` to `stage: "close"`.
   - Rename `FinalizeInput` to `CloseInput`.
   - Rename `FinalizeResult` to `CloseResult`.
2. In `src/change/model.ts` and `src/change/board.ts`, update type names and properties accordingly.
3. Run `npm run check`. Expected red: many TS errors due to broken references.

### T2 — Orchestrator and CLI

**Purpose:** Satisfies AC-1 by exposing the new stage name in the CLI and orchestrator logic.

**Depends on:** T1

**Files:**
- Modify: `src/change/orchestrator.ts`
- Modify: `src/cli/args.ts`
- Modify: `src/cli/commands.ts`
- Modify: `src/cli/output.ts`

**Interfaces:**
- Consumes: renamed types from T1
- Produces: `closeChange` function

**Simplicity proof:** Direct local change.

**Surface delta:** 4 files modified.

**Steps:**
1. In `src/change/orchestrator.ts`, rename `finalizeChange` to `closeChange` and `assertFinalizeInput` to `assertCloseInput`.
2. In `src/cli/args.ts`, replace `change finalize` with `change close`.
3. In `src/cli/commands.ts`, update the `change.finalize` switch case to `change.close` and call `closeChange`.
4. In `src/cli/output.ts`, replace `"finalize"` with `"close"`.
5. Run `npm run check`. Expected red: TS errors might remain in tests.

### T3 — Tests and Fixtures

**Purpose:** Satisfies AC-3 for unit tests.

**Depends on:** T2

**Files:**
- Modify: `src/change/change.test.ts`
- Modify: `src/change/board.test.ts`
- Modify: `src/change/git.test.ts`
- Modify: `src/change/fixtures/committed-change.yaml`
- Modify: `src/change/fixtures/rolled-back-change.yaml`
- Modify: `scripts/smoke-cli.mjs`

**Interfaces:** N/A

**Simplicity proof:** Direct local change.

**Surface delta:** 6 files modified.

**Steps:**
1. Update test files to use `close` instead of `finalize`.
2. Run `npm run test` and `node scripts/smoke-cli.mjs`. Expected green.

### T4 — Skills and Documentation

**Purpose:** Satisfies AC-4 by aligning documentation and agent skills with the new terminology.

**Depends on:** T3

**Files:**
- Modify: `README.md`, `CONTEXT.md`, `AGENTS.md`
- Modify: `docs/change-lifecycle.md`, `docs/smoke-tests.md`
- Modify: `skills/catalog.yaml`, `skills/codepatrol-status/SKILL.md`, `skills/codepatrol-apply/SKILL.md`, `skills/codepatrol-verify/SKILL.md`, `skills/_shared/CHANGE.md`, `skills/_shared/CODEPATROL-CLI.md`, `skills/_shared/ROLES.md`
- Delete: `skills/codepatrol-finalize`
- Create: `skills/codepatrol-close`
- Modify: `scripts/skills-contract.test.mjs`, `scripts/lint-skills.mjs`, `scripts/package-contract.test.mjs`

**Interfaces:** N/A

**Simplicity proof:** Direct string replacements and file renames.

**Surface delta:** ~20 files modified/renamed.

**Steps:**
1. Rename the directory and files using `mv`.
2. Grep for `finalize` and `Finalize` across `docs/`, `skills/`, `scripts/`, `*.md`. Replace with `close` and `Close`.
3. Run `npm run check` and `npm run test`. Expected green.

### T5 — Final Verification

**Purpose:** Verify AC-1 to AC-4 and finalize the scope.

**Depends on:** T4

**Files:** None

**Steps:**
1. Run `npm run build && npm run test`.
2. Inspect diff for undeclared work.
3. Validate ACs via smoke tests.
