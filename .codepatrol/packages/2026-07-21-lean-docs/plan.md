# Plan — Lean docs directory and codepatrol namespace

- Work id: `2026-07-21-lean-docs`
- Governing spec: `spec.md`
- Target baseline: branch `main`, `HEAD` = `2d69b44`, clean tree

## Goal and approach

Migrate all process artifacts (`.codepatrol/work/`, `.codepatrol/adr/`, `.codepatrol/architecture/`) into the `.codepatrol/` namespace (`.codepatrol/packages/`, `.codepatrol/adr/`, `.codepatrol/architecture/`) to leave `docs/` exclusively for functional project documentation. Update `.gitignore` to allow tracking these new subdirectories, and update all source code and skill documentation to point to the new paths. Because this plan's own artifact package lives at the old path, the migration of the active package directory must be the final step, ensuring tooling stability during the execution.

## Global constraints

- No new dependency, CLI command, flag, validation stage, manifest field, configuration, or runtime state.
- All tests must pass, adapting their fixtures to the new paths.
- The active package (`.codepatrol/work/2026-07-21-lean-docs`) must be moved to the new path as the final mutation.

## Acceptance mapping

| Criterion | Task(s) | Verification |
|---|---|---|
| AC-1 | T2, T3 | `npm test` — artifact suite passes against `.codepatrol/packages/` |
| AC-2 | T4 | `node scripts/lint-skills.mjs` and `npm run verify` |
| AC-3 | T1 | manual check of `.gitignore` |
| AC-4 | T2, T4 | `grep -r "docs/codepatrol" .` returns no hits |
| AC-5 | T8 | `npm run verify` exits 0 |
| AC-6 | T6 | kanban logic ignores empty items |
| AC-7 | T4 | verify review/plan contracts explicitly prevent single-step apply |
| AC-8 | T7 | verify step agent is recorded as the real executing harness/model |

## Dependency order

`T1 → T2`; `T1 → T4`; `T2 → T3`; `T3 → T5`; `T4 → T5`; `T6 → T8`; `T7 → T8`; all → `T8`.

### T1 — Consolidate Namespace and Paths
1. Update `src/shared/workspace.ts`, `src/artifact/service.ts`, and CLI definitions.
2. Change the hardcoded default artifact directory to `.codepatrol/packages/`.
3. Change ADR directory to `.codepatrol/adr/` and architecture research to `.codepatrol/architecture/`.
4. Update `.gitignore` to allow these paths while ignoring local memory/graph.

### T2 — Update references across tests and configs
1. Run a bulk replace from `.codepatrol/work/` and `docs/codepatrol` to `.codepatrol/packages/` across `src/`, `skills/`, and `docs/`.
2. Do the same for ADRs and architecture research.

### T3 — Update TypeScript test fixtures

**Steps:**
1. Update any string containing `.codepatrol/work` or `docs/codepatrol` to `.codepatrol/packages` in the test fixtures (`src/artifact/artifact.test.ts`, `src/artifact/review-check.test.ts`, `src/cli/cli.test.ts`).
2. Run `npm test` and ensure these suites pass.

### T4 — Update Markdown documentation and Skills

1. Run a workspace-wide exact string replacement: `docs/codepatrol` -> `.codepatrol/packages`.
2. Run a workspace-wide exact string replacement: `.codepatrol/work` -> `.codepatrol/packages`.
3. Run a workspace-wide exact string replacement: `.codepatrol/adr` -> `.codepatrol/adr`.
4. Run a workspace-wide exact string replacement: `.codepatrol/architecture` -> `.codepatrol/architecture`.
5. Edit `skills/codepatrol-plan/SKILL.md`, `skills/codepatrol-review/SKILL.md`, `skills/codepatrol-apply/SKILL.md`, and `skills/codepatrol-verify/SKILL.md` to explicitly state: "NEVER automatically invoke the next workflow (e.g. do not run apply after review). Stop and await user instruction after sealing the stage."
6. Run `node scripts/lint-skills.mjs` and the `skills-contract.test.mjs` suite.

### T5 — Migrate the active package directory

1. Merge the fix for kanban logic in `src/status/service.ts` to strictly ignore ledger-only open items unless they correspond to physical items, also update `skills/codepatrol-status/SKILL.md` prompt constraints.
2. Move active package: `mkdir -p .codepatrol/packages && mv .codepatrol/work/* .codepatrol/packages/ && rmdir .codepatrol/work`.

### T6 — Fix Status Kanban Display

**Purpose:** Satisfies AC-6.

**Files:**
- Modify: `src/status/service.ts`

**Steps:**
1. Filter out `data.workflows` entries in `statusSummary` if they are fully disconnected from physical packages. Only include ledger-only workflows if they are not just "ghosts" of deleted packages. Or purely iterate over `visiblePackages`. Since the `SKILL.md` kanban parsing handles open workflows, we just ensure `statusSummary` does not surface old package references. Wait, the actual issue is the skill prompt instruction placing missing physical packages into Plan. So I will also update `skills/codepatrol-status/SKILL.md` to NOT surface ledger-only entries that are missing their physical packages.

### T7 — Fix Agent Identity Stamping

**Purpose:** Satisfies AC-8.

**Files:**
- Modify: `src/artifact/service.ts` or `src/cli/commands.ts`

**Steps:**
1. Investigate how `stamp.harness` and `stamp.model` are generated and passed to `artifact validate` or `artifact record`.
2. Fix it to correctly derive the harness/model from the current execution environment rather than copying statically. Tests for this logic should be adapted.

### T8 — Final verification

**Purpose:** Independently verify AC-1 through AC-8. Owned by `codepatrol-verify`.

**Steps:**
1. Run `npm run verify`.
2. Confirm the active packages are now at `.codepatrol/packages/...`.
3. Confirm `git status` shows the new directory is tracked.
4. Run `grep -ri ".codepatrol/work" .` and confirm it is clean.
