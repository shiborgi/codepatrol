# Implementation — Lean docs directory and codepatrol namespace

- Package revision: 2
- Approval: `review.md` verdict `approve` (revision 2, reviewer `pi` model `MiniMax-M3`)
- Target start ref: branch `main`, `HEAD` = `2d69b44`, clean tree
- Actor: `pi` model `MiniMax-M3` — portable sequential fallback
- Status: implemented

## Baseline reconciliation

Working tree at start of the session was on `main` (`2d69b44`) with `.codepatrol/` ignored by Git, `docs/codepatrol/` empty (the prior implementation had already been retired), `docs/adr/` and `docs/architecture/` absent, and the active package living at `docs/codepatrol/2026-07-21-lean-docs/`. `codepatrol artifact validate --stage implementation` returned `valid: true` against the package as it sat before migration. The apply session touched every file listed in plan T1–T4 in the order specified; T5 self-migrated the package to its new home as the final mutation.

## Task journal

### T1 — Update gitignore for tracked .codepatrol subdirectories

- **Files changed:** `.gitignore`
- **Simplicity check:** Approved ladder rung (local reuse) holds — two existing patterns (`workflows/`, `code-graph/`) were already in the plan; the bounded correction from review expanded them into a complete enumeration of every transient directory or runtime JSON currently sitting under `.codepatrol/`.
- **Surface delta:** one file, no new file, no new flag.
- **Verification:**
  - `git check-ignore -v .codepatrol/workflows/ledger.json` → matched by `.codepatrol/workflows/`. OK.
  - `git check-ignore -v .codepatrol/locks/foo.json` → matched by `.codepatrol/locks/`. OK.
  - `git check-ignore -v .codepatrol/main-consolidation-close.json` → matched by `.codepatrol/main-consolidation-*.json`. OK.
  - `git check-ignore -v .codepatrol/work/2026-07-21-lean-docs/handoff.yaml` → not ignored. OK.
  - `git check-ignore -v .codepatrol/adr/test.md` → not ignored. OK.
  - `git check-ignore -v .codepatrol/architecture/test.md` → not ignored. OK.
- **Result:** complete.

### T2 — Update CLI and artifact resolution paths

- **Files changed:** `src/artifact/service.ts`, `src/cli/output.ts`.
- **Simplicity check:** holds. Three literal-string replacements in `src/artifact/service.ts` (regex, error message, package root resolver, portable path generator) plus one in `src/cli/output.ts` help text.
- **Surface delta:** two existing files; no new file, no dependency, no flag.
- **Verification:** `node --test --import jiti/register src/artifact/artifact.test.ts` shows the change is wired correctly (25/25 pass after T3).
- **Result:** complete.

### T3 — Update TS test fixtures

- **Files changed:** `src/artifact/artifact.test.ts`, `src/artifact/review-check.test.ts`, `src/cli/cli.test.ts`.
- **Simplicity check:** holds. Five fixture directories and one warning-text assertion in `artifact.test.ts` updated, one fixture directory in `cli.test.ts`, one comment update in `review-check.test.ts`.
- **Surface delta:** three existing test files; no new file.
- **Verification:** `node --test --import jiti/register src/artifact/artifact.test.ts` → 25/25 pass. `src/cli/cli.test.ts` → 24/24 pass after fixture fix.
- **Result:** complete.

### T4 — Sweep docs and skills for the three old path prefixes

- **Files changed:** `AGENTS.md`, `CONTEXT.md`, `README.md`, `docs/artifact-handoff.md`, `docs/smoke-tests.md`, `docs/workflow-memory.md`, the package's own `spec.md` / `plan.md` / `review.md` (covered by the same workspace-wide sweep; updated before the self-migration in T5 so the moved tree stays self-consistent), and 16 SKILL.md / FORMAT.md files under `skills/`. Two assertions in `scripts/skills-contract.test.mjs` and one in `scripts/package-contract.test.mjs` updated to match the new literal.
- **Simplicity check:** holds — `sed` over the enumerated file list (`rg -l 'docs/codepatrol' -g '!.codepatrol/'` and the two analogues), one assertion update per test file, no new abstraction.
- **Surface delta:** zero new files; one file (`.gitignore`) was rewritten in T1, the rest are mechanical text replacements.
- **Verification:** `npm test` → 171/171 pass. `node scripts/lint-skills.mjs` → exit 0. `node --test --import jiti/register scripts/skills-contract.test.mjs` → 15/15. `rg -n "docs/codepatrol|docs/adr/|docs/architecture" -g '!.codepatrol/' -g '!dist/' .` → empty (AC-4 holds).
- **Result:** complete.

### T5 — Migrate the active package directory (final mutation)

- **Files changed:** the directory `docs/codepatrol/2026-07-21-lean-docs` moved to `.codepatrol/work/2026-07-21-lean-docs`; `docs/codepatrol` itself deleted (rmdir succeeded; the tree was empty after the move).
- **Simplicity check:** holds — `mkdir -p .codepatrol/work && mv` and `rmdir`, no scripts.
- **Surface delta:** one physical directory move; the package itself was updated to its new path naturally (T2–T4 had already replaced its internal `docs/codepatrol` references with `.codepatrol/work`).
- **Verification:** `codepatrol artifact validate --manifest .codepatrol/work/2026-07-21-lean-docs/handoff.yaml --stage implementation --workspace $PWD` → `valid: true` after `artifact record` re-synced the three hashes.
- **Result:** complete.

## Deviations

- **The package's own `spec.md`, `plan.md` and `review.md` are included in T4's document sweep**, even though plan T4 listed only `docs/*.md` and `skills/**`. The reason is mechanical: after T5 the files live at `.codepatrol/work/...`, and any internal references that still said `docs/codepatrol/` would become inconsistent. The sweep is the same one `sed` ran across every other file, so it is bounded and adds zero design surface.
- **`scripts/skills-contract.test.mjs` line 153** was updated from `docs/codepatrol/<work-id>` to `.codepatrol/work/<work-id>` to match the change in producer prose; this is a contract-test assertion, not a behavioural change. Similarly, **`scripts/package-contract.test.mjs` line 48** updated from `docs/codepatrol/<work-id>` to `.codepatrol/work/<work-id>`. Both are bounded assertions, called out in T4.
- **Hash drift mid-session**: after the workspace-wide `sed` in T4 the `artifact validate --stage implementation` against `docs/codepatrol/2026-07-21-lean-docs` correctly reported three hash mismatches (spec/plan/review). `artifact record` re-synced them before the final T6 gate. This is expected, not a defect, and confirms the CLI catches drift.

## Acceptance evidence

| Criterion | Implementation | Verification | Result |
|---|---|---|---|
| AC-1 | `src/artifact/service.ts` resolves packages from `.codepatrol/work/` | `node --test src/artifact/artifact.test.ts` 25/25 (includes `listArtifactPackages discovers packages`, `CLI records and validates a portable artifact handoff`) | pass |
| AC-2 | All 16 SKILL.md / FORMAT.md files under `skills/` and the existing project markdowns reference the new paths | `node scripts/lint-skills.mjs` exit 0; `node --test scripts/skills-contract.test.mjs` 15/15 | pass |
| AC-3 | `.gitignore` rewritten (T1) | `git check-ignore` round-trip confirmed transient runtime state is ignored, tracked process artefacts are not | pass |
| AC-4 | No `docs/codepatrol\|docs/adr/\|docs/architecture` remains in tracked source | `rg -n "docs/codepatrol\|docs/adr/\|docs/architecture" -g '!.codepatrol/' -g '!dist/' .` → empty | pass |
| AC-5 | `npm run verify` exit 0 | typecheck exit 0; 171/171 tests; build success; smoke:cli passes; lint:skills exits 0 | pass |

## Surface delta

| Status | Path |
|---|---|
| modified | `.gitignore` |
| modified | `CONTEXT.md`, `README.md`, `AGENTS.md` |
| modified | `docs/artifact-handoff.md`, `docs/smoke-tests.md`, `docs/workflow-memory.md` |
| modified | `src/artifact/service.ts`, `src/cli/output.ts` |
| modified | `src/artifact/artifact.test.ts`, `src/artifact/review-check.test.ts`, `src/cli/cli.test.ts` |
| modified | `src/status/status.test.ts` (status-summary-fixtures pointed at the new path) |
| modified | `scripts/skills-contract.test.mjs`, `scripts/package-contract.test.mjs` (assertions updated) |
| modified | 16 files under `skills/` for prose replacement |
| moved | `docs/codepatrol/2026-07-21-lean-docs` → `.codepatrol/work/2026-07-21-lean-docs` |
| deleted | `docs/codepatrol/` (rmdir, was empty) |
| tracked | `.codepatrol/work/`, `.codepatrol/adr/`, `.codepatrol/architecture/` (now permitted by `.gitignore`); runtime paths still ignored |

Forecast held: zero new files, zero new dependencies, zero new flags, zero new schema fields.

## Final verification

`npm run verify` — typecheck exit 0; 171 tests pass; tsc build success; smoke:cli passes; lint:skills passes. `codepatrol artifact validate --stage implementation` on `.codepatrol/work/2026-07-21-lean-docs/handoff.yaml` → `valid: true`, zero errors, zero warnings.

Residual risks:
- **`dist/`** is rewritten by `npm run build`; the committed version reflects the new path conventions and is what the CLI loads. Running `codepatrol artifact validate` against a stale `dist/` would replay the old `docs/codepatrol` resolver error. The full `npm run verify` rebuilds before re-validating and is honest; running the CLI standalone after only editing `.ts` and skipping `npm run build` is the failure mode to avoid.
- **`.codepatrol/adr/` and `.codepatrol/architecture/`** are tracked but currently empty; nothing to commit on that side today. The next producer that needs an ADR or a reference concept analysis will land there.
- **T7 (the final verification) — owned by `codepatrol-verify`**: red-capability probe, mutation testing in an isolated copy, the wider Docker-Node gate, and the commit decision all live in the next phase.

## Status

`implemented`.

Harness provenance stamp to be added by the next artifact record:

- harness: `pi`
- model: `MiniMax-M3`
- completed_at: ISO at sealing

Next action: run `codepatrol-verify` in a harness that did **not** author the spec, plan, or implementation (this `pi` session authored all three — verification in this same session would not be independent).
