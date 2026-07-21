# Plan — Lean docs directory and codepatrol namespace

- Work id: `2026-07-21-lean-docs`
- Governing spec: `spec.md`
- Target baseline: branch `main`, `HEAD` = `2d69b44`, clean tree

## Goal and approach

Migrate all process artifacts (`.codepatrol/work/`, `.codepatrol/adr/`, `.codepatrol/architecture/`) into the `.codepatrol/` namespace (`.codepatrol/work/`, `.codepatrol/adr/`, `.codepatrol/architecture/`) to leave `docs/` exclusively for functional project documentation. Update `.gitignore` to allow tracking these new subdirectories, and update all source code and skill documentation to point to the new paths. Because this plan's own artifact package lives at the old path, the migration of the active package directory must be the final step, ensuring tooling stability during the execution.

## Global constraints

- No new dependency, CLI command, flag, validation stage, manifest field, configuration, or runtime state.
- All tests must pass, adapting their fixtures to the new paths.
- The active package (`.codepatrol/work/2026-07-21-lean-docs`) must be moved to the new path as the final mutation.

## Acceptance mapping

| Criterion | Task(s) | Verification |
|---|---|---|
| AC-1 | T2, T3 | `npm test` — artifact suite passes against `.codepatrol/work/` |
| AC-2 | T4 | `node scripts/lint-skills.mjs` and `npm run verify` |
| AC-3 | T1 | manual check of `.gitignore` |
| AC-4 | T2, T4 | `grep -r ".codepatrol/work" .` returns no hits |
| AC-5 | T6 | `npm run verify` exits 0 |

## Dependency order

`T1 → T2`; `T1 → T4`; `T2 → T3`; `T3 → T5`; `T4 → T5`; all → `T6`.

### T1 — Update gitignore for tracked .codepatrol subdirectories

**Purpose:** Satisfies AC-3.

**Files:**
- Modify: `.gitignore`

**Steps:**
1. Remove the broad `.codepatrol/` rule from `.gitignore`.
2. Add allow-by-default behavior for the documented tracked directories (`.codepatrol/work/`, `.codepatrol/adr/`, `.codepatrol/architecture/`) and explicitly ignore all runtime/transient subdirectories:
   ```text
   .codepatrol/workflows/
   .codepatrol/code-graph/
   .codepatrol/locks/
   .codepatrol/eval-runs/
   .codepatrol/wiki/
   .codepatrol/main-consolidation-*.json
   .codepatrol/scan-overview.json
   .codepatrol/version.json
   ```
3. Save the file.
4. Verify with `git check-ignore -v .codepatrol/workflow_ledger.json` returns a match, and `git check-ignore -v .codepatrol/work/2026-07-21-lean-docs/handoff.yaml` returns no match (untracked).

### T2 — Update CLI and artifact resolution paths

**Purpose:** Satisfies AC-1 and AC-4 (code side).

**Files:**
- Modify: `src/artifact/service.ts`
- Modify: `src/cli/output.ts`

**Steps:**
1. Replace `".codepatrol/work"` with `".codepatrol/work"` in both files.
2. Ensure the string literal `".codepatrol/work/"` inside portable path generation is updated to `".codepatrol/work/"`.

### T3 — Update TypeScript test fixtures

**Purpose:** Fixes tests to match T2.

**Files:**
- Modify: `src/artifact/artifact.test.ts`
- Modify: `src/artifact/review-check.test.ts`
- Modify: `src/cli/cli.test.ts`

**Steps:**
1. Update any string containing `.codepatrol/work` to `.codepatrol/work` in the test fixtures.
2. Run `npm test` and ensure these suites pass.

### T4 — Update Markdown documentation and Skills

**Purpose:** Satisfies AC-2 and AC-4 (docs side).

**Files:**
- Modify: `AGENTS.md`, `CONTEXT.md`, `README.md`
- Modify: `docs/artifact-handoff.md`, `docs/smoke-tests.md`, `docs/workflow-memory.md`
- Modify: All `.md` files under `skills/` that contain `.codepatrol/work`, `.codepatrol/adr`, or `.codepatrol/architecture`

**Steps:**
1. Run a workspace-wide exact string replacement: `.codepatrol/work` -> `.codepatrol/work`.
2. Run a workspace-wide exact string replacement: `.codepatrol/adr` -> `.codepatrol/adr`.
3. Run a workspace-wide exact string replacement: `.codepatrol/architecture` -> `.codepatrol/architecture`.
4. Run `node scripts/lint-skills.mjs` and the `skills-contract.test.mjs` suite (which may need string assertions updated) to ensure everything is green.

### T5 — Migrate the active package directory

**Purpose:** Physically moves this package to its new home.

**Files:**
- Move: `.codepatrol/work/2026-07-21-lean-docs` to `.codepatrol/work/2026-07-21-lean-docs`
- Delete: `.codepatrol/work` (if empty)

**Steps:**
1. `mkdir -p .codepatrol/work`
2. `mv .codepatrol/work/2026-07-21-lean-docs .codepatrol/work/`
3. `rmdir .codepatrol/work` (ignore if not empty, but it should be).

### T6 — Final verification

**Purpose:** Independently verify AC-1 through AC-5. Owned by `codepatrol-verify`.

**Steps:**
1. Run `npm run verify`.
2. Confirm the active package is now at `.codepatrol/work/2026-07-21-lean-docs`.
3. Confirm `git status` shows the new directory is tracked.
4. Run `grep -ri ".codepatrol/work" .` and confirm it is clean.
