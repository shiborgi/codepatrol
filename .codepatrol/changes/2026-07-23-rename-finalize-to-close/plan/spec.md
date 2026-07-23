# Specification — Rename finalize to close

## Intent

- Origin: improve-codebase
- Mode: project
- Target baseline: main
- Governing constraints: None — internal vocabulary refinement
- Substrate state: graph revision present; wiki state absent
- Problem: The term "finalize" is being renamed to "close" to improve lifecycle terminology, aligning with industry standard vocabulary (like closing issues/PRs).
- Outcome: The final stage of the Codepatrol lifecycle is consistently named "close" instead of "finalize" across code, files, skills, documentation, and the CLI.

## Scope

### In scope

- Renaming the `finalize` stage to `close` in `src/change/types.ts` and related data models.
- Renaming functions, interfaces, events (e.g. `ChangeFinalizedEvent` -> `ChangeClosedEvent`, `finalizeChange` -> `closeChange`).
- Renaming the CLI command from `change finalize` to `change close`.
- Renaming the skill directory `skills/codepatrol-finalize` to `skills/codepatrol-close`, updating its internal references, SKILL.md, FINALIZE-FORMAT.md (to CLOSE-FORMAT.md), etc.
- Updating `catalog.yaml` to register `codepatrol-close` instead of `codepatrol-finalize`.
- Adjusting all documentation (`README.md`, `CONTEXT.md`, `docs/`, `skills/_shared/`) referencing the finalize stage.
- Adjusting tests and fixtures containing `finalize` stage references.
- Renaming opencode commands (`.opencode/commands/codepatrol-finalize.md` to `codepatrol-close.md`) and Pi-extension command registrations (`.pi/index.ts`).
- Renaming the owned artifact directory from `.codepatrol/changes/<work-id>/finalize/` to `close/` in orchestrator hardcodes and skills-contract map.
- Adding a backward-compatibility normalization shim to `foldChange` (`src/change/model.ts`) to gracefully parse historical events with `stage: "finalize"` and `type: "change-finalized"` as `"close"` and `"change-closed"`.

### Out of scope

- Behavioral changes to how the closing/finalization logic actually works (Git tagging, rollback, etc.).
- Renaming variables that use "finalize" if they don't relate to the lifecycle stage (though currently they all seem to).

## Current evidence

- Code uses `finalize` in `src/change/types.ts`, `src/change/orchestrator.ts`, `src/cli/commands.ts`.
- Skill exists at `skills/codepatrol-finalize`.
- Documentation refers to Finalize as the last stage.
- Grep shows ~47 files affected by the term.
- `src/change/orchestrator.ts` hardcodes `.codepatrol/changes/${workId}/finalize/receipt.md`.
- `scripts/skills-contract.test.mjs` maps ownership to `finalize/`.
- `.pi/index.ts` and `.pi/index.test.ts` references command `codepatrol-finalize`.

## Proposed design

- Update `STAGES` in `src/change/types.ts` from `["plan", "review", "apply", "verify", "finalize"]` to `["plan", "review", "apply", "verify", "close"]`.
- Add normalization logic in `src/change/model.ts` (`foldChange`) to intercept and migrate legacy `finalize` / `change-finalized` string literals at read-time.
- Update events like `ChangeFinalizedEvent` to `ChangeClosedEvent` with `type: "change-closed"`.
- Update orchestration logic: `finalizeChange` to `closeChange` in `src/change/orchestrator.ts`.
- Update CLI parser in `src/cli/commands.ts` and `src/cli/args.ts` to map `change close` to `closeChange`.
- Rename `skills/codepatrol-finalize` to `skills/codepatrol-close`, updating its internals.
- Migrate references in all `.md` and `.yaml` files.
- Tests in `src/change/change.test.ts`, `scripts/smoke-cli.mjs`, and `.pi/index.test.ts` will be updated to reflect the new state.
- Rename `.codepatrol/changes/<work-id>/finalize/` path strings to `close/` in the orchestrator and skills-contract.
- Rename `.opencode/commands/codepatrol-finalize.md` to `.opencode/commands/codepatrol-close.md`.

## Alternatives

- Keep `finalize`: Rejected because `close` is more succinct and idiomatic.

## Simplicity decision

- Selected rung: direct local change
- Earlier rungs: N/A, this is a vocabulary refactoring.
- Irreducible complexity: N/A
- Safety floor: TypeScript compilation (`npx tsc -p tsconfig.build.json --noEmit`), unit/smoke tests (`npm run test`, `node scripts/smoke-cli.mjs`), and skill linter (`node scripts/lint-skills.mjs`) must pass.
- Expected surface delta: ~26 files modified, 1 skill directory renamed, 1 opencode command renamed. No new dependencies.

## Deferred constraints

| ID | Chosen simplification | Known ceiling | Observable trigger | Upgrade path |
|---|---|---|---|---|
| DC-1 | None | None | N/A | N/A |

## Compatibility and rollout

- Historical `change.yaml` records containing `stage: "finalize"` and `type: "change-finalized"` will be seamlessly supported via a read-time normalization shim in `foldChange`. This avoids mutating immutable historical `change.yaml` records while keeping the harness fully usable.

## Risks and mitigations

- Incomplete rename leading to type errors or missing skill references. Mitigation: Full TypeScript check via `npx tsc -p tsconfig.build.json --noEmit`, running `node scripts/lint-skills.mjs` and `npm run test`, and running the smoke tests.

## Acceptance criteria

- AC-1: CLI command `codepatrol change close` works correctly and `codepatrol change finalize` is removed.
- AC-2: The `STAGES` array in `src/change/types.ts` uses `"close"` instead of `"finalize"`.
- AC-3: All tests pass and `tsc` reports no errors.
- AC-4: Documentation and skill descriptions use "close" and the `codepatrol-close` skill exists.
- AC-5: Historical change records with `finalize` events parse successfully without throwing invalid stage errors.

## Decisions and open questions

- Decided to rename all structural events (e.g., `ChangeFinalizedEvent` to `ChangeClosedEvent`) to ensure complete consistency.
- Decided to rename the owned artifact directory from `finalize/` to `close/` (and update hardcoded paths in orchestrator/tests) to preserve complete consistency. Historical `finalize/` directories from merged changes will be ignored on disk.
