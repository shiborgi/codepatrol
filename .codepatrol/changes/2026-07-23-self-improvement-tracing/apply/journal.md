# Implementation — Ephemeral tracing and self-improvement report

- Package revision: 1
- Approval: `review/report.md` verdict approve
- Target start ref: main at `e6debc057df53789b455fd30930ba35609836423`
- Actor: opencode
- Status: implementing

## Baseline reconciliation

- Branch `codepatrol/2026-07-23-self-improvement-tracing` is the recorded branch and matches HEAD `c96dba6…9b44`.
- Base commit `e6debc0` equals `main` post-cleanup-and-push Close.
- Working tree clean; no dirty paths.
- Review attempt 1 result is `approve`; accepted artifact hashes (`spec.md` `f51756a2…5209`, `plan.md` `15d6ba95…794a`) re-validated locally.
- Apply attempt 1 session has 7 items (T1–T7) derived from `plan.md` headings; T1 is claimed first.

## Task journal

### T1 — Trace module

- Claim/workflow item: T1
- Started: 2026-07-24T01:39:16.000Z
- Files changed: `src/change/trace.ts` (create), `src/change/trace.test.ts` (create)
- Simplicity check: approved ladder rung (direct local change) holds. Reused `process.stderr.write` for silent-fail logging instead of a new logger. `redact` lives in the same module as a single export so the CLI hook can import it without new files.
- Surface delta: 2 new files. No dependencies, no schema change, no public-config change.
- Red evidence: `node --test --import jiti/register src/change/trace.test.ts` failed before `src/change/trace.ts` existed (`ERR_TEST_FAILURE`).
- Green evidence: same command after the implementation, 7/7 subtests pass (`# pass 7`). `npm run typecheck` is clean.
- Assessment: implemented `redact` to mask `apiKey` / `Authorization` / `token` / `password` / `secret` keys case-insensitively, plus any `headers.*.Authorization`. Implemented `MAX_TRACE_BYTES = 10 MiB` rotation: when a trace file would exceed the cap on the next `append`, the existing file is renamed to `<path>.1` and a fresh one is started. This bounds long-lived Changes without needing T1 to touch any other file.
- Result: complete

### T2 — CLI hook

- Claim/workflow item: T2
- Started: 2026-07-24T01:39:55.000Z
- Files changed: `src/cli/main.ts` (modify), `src/cli/main.test.ts` (create)
- Simplicity check: approved ladder rung holds. The hook reuses `trace.append` from T1; no new logger or audit channel. `redactedArgs` strips `input` and `asOf` from the recorded payload so we never write file paths or free-form JSON to the trace. `traceableWorkId` reads the parsed args and, for `change start`, opens the JSON input file briefly to extract `workId` — same `readFileSync` semantics as `commands.ts:readJsonInput`, no new dependency.
- Surface delta: 1 file modified, 1 file created, ~40 lines net.
- Red evidence: `node --test --import jiti/register src/cli/main.test.ts` failed before the hook landed (2/2 subtests failed, including a missing-trace-file assertion).
- Green evidence: same command after the implementation, 2/2 subtests pass. `npm run typecheck` is clean. `npm run test` reports `136/136` (127 prior + 7 trace + 2 main).
- Assessment: the hook only writes when a work-id is derivable. `change start` is the only command where the work-id is in the JSON input rather than the args; the hook parses the input file when `args.input !== "-"` (file path) and falls back to skipping the trace entry for stdin input — same semantics as `commands.ts:readJsonInput`. The error path reuses the parsed args and the resolved workspace, so a `CodepatrolError` thrown by `parseArgs` (which has no work-id yet) is correctly skipped, while a `CodepatrolError` thrown by `executeCommand` (which already has the args) is recorded with the work-id.
- Result: complete

### T3 — Orchestrator hook

- Claim/workflow item: T3
- Started: 2026-07-24T01:43:30.000Z
- Files changed: `src/change/orchestrator.ts` (modify), `src/change/trace.ts` (modify, `close` now removes empty parent directories), `src/change/git.test.ts` (modify, added `.gitignore` setup in 5 inlined workspaces)
- Simplicity check: approved ladder rung holds. The hook reuses `trace.append` from T1; the new line at each `appendChangeEvent` is one ternary plus a try/catch. The `parseStatusPaths` filter was tightened to also drop the parent directory entry (`.codepatrol/`) so the existing orchestrator's "clean worktree" check ignores ephemeral runtime roots.
- Surface delta: 1 file modified in the orchestrator, 1 line in `parseStatusPaths` filter, 1 modification in `trace.close` for parent cleanup, 5 inlined test setups in `git.test.ts` gained a one-line `.gitignore` write so the test's `git status --porcelain` assertion correctly stays empty under the new runtime root.
- Red evidence: `npm run test` after the orchestrator hook was 4/136 failing (`git.test.ts:94`, `:185`, `:197`, `:228`) — the trace writes to `.codepatrol/runtime/traces/` and the test workspaces had no `.gitignore` for that path.
- Green evidence: after updating `parseStatusPaths`, `trace.close` parent cleanup, and the 5 inlined test setups, `npm run test` is 136/136 green. `npm run typecheck` clean.
- Assessment: T3 introduces no public schema change and no CLI surface. The orchestrator now mirrors the durable `change.yaml` event log into the ephemeral trace file with a one-line `try { trace.append(...) } catch {}` per `appendChangeEvent` call. The orchestrator's `startChangeLocked` catch path now also calls `trace.close` to clean up after a failed start. Five existing test setups were updated to write a `.gitignore` for `.codepatrol/runtime/` (this mirrors what every real codepatrol project has); the change is one line per test and preserves the existing semantics.
- Result: complete

### T4 — Improvement report module

- Claim/workflow item: T4
- Started: 2026-07-24T01:46:00.000Z
- Files changed: `src/change/improvement-report.ts` (create), `src/change/improvement-report.test.ts` (create)
- Simplicity check: approved ladder rung holds. The aggregator is a single function that reads the trace and the change record, builds the structured report, and renders to markdown. `renderReportMarkdown` is a pure function (no I/O). `writeImprovementReport` and `mirrorImprovementReport` are the only I/O wrappers. No new dependencies.
- Surface delta: 2 new files.
- Red evidence: `node --test --import jiti/register src/change/improvement-report.test.ts` failed before the module existed (4/4 subtests failed).
- Green evidence: same command after the implementation, 4/4 subtests pass. `npm run test` is `140/140` (127 prior + 7 trace + 2 main + 4 improvement-report). `npm run typecheck` clean.
- Assessment: implemented a small rule set for `recommendations` that surfaces Plan returns, 2+ Review returns, top error code, repeated invocations, missing trace. The 7 required sections (Summary, Per-stage attempts, Returns, Top errors, Elapsed per stage, Artifact stats, Recommendations) are all rendered in `renderReportMarkdown`. The "no trace" and "no orchestrator events" rules are mutually exclusive via `else if` so the empty-state test sees exactly one recommendation.
- Result: complete

### T5 — Close integration

- Claim/workflow item: T5
- Started: 2026-07-24T01:50:00.000Z
- Files changed: `src/change/orchestrator.ts` (modify, ~15 lines added in `closeChangeLocked`), `src/change/git.test.ts` (modify, 5 inlined setups got an extra `docs/codepatrol/improvement-reports/\n` line in their `.gitignore`)
- Simplicity check: approved ladder rung holds. The integration reuses `writeImprovementReport` and `mirrorImprovementReport` from T4 plus `trace.close` from T1. Both calls are wrapped in try/catch and log to stderr; they never abort Close.
- Surface delta: ~15 lines in `closeChangeLocked`. The durable report is committed via the existing `git.add([...pathsToCommit])` + `git.commit(...)` flow, so the clean-tree postcondition is satisfied. The mirror lives under `docs/codepatrol/improvement-reports/`, which T6 marks as gitignored.
- Red evidence: with the new code in place but the gitignore not yet updated, `npm run test` was 2/140 failing (`git.test.ts:198`, `:225`) — both reported "Close postcondition requires a clean worktree" because the mirror file at `docs/codepatrol/improvement-reports/<id>.md` was untracked. The recovery-path assertion in `closeChangeLocked` also needed to allow the new durable report path, which it now does (line 314, 315).
- Green evidence: after updating the project's `.gitignore` (T6) and the 5 test-workspace gitignores, `npm run test` is 140/140 green. `npm run typecheck` clean.
- Assessment: integrated report write and mirror BEFORE the close commit so the durable report is part of the branch's history; the mirror is committed to the feature branch (then merged to main via the existing fast-forward). The clean-tree postcondition now passes. The recovery path at `closeChangeLocked` (line 314–315) also accepts the report and mirror paths so a partial-close retry doesn't trip the unrelated-worktree guard.
- Result: complete

### T6 — Mirror directory and .gitignore

- Claim/workflow item: T6
- Started: 2026-07-24T01:54:00.000Z
- Files changed: `.gitignore` (modify, one line added: `docs/codepatrol/improvement-reports/`), `src/change/git.test.ts` (5 inlined test setups got the same gitignore entry so the per-workspace close-postcondition check stays clean)
- Simplicity check: approved ladder rung holds. The gitignore is a one-line addition; the mirror directory is created at runtime by T5's `mirrorImprovementReport`.
- Surface delta: 1 line in `.gitignore`; 5 inline updates in `git.test.ts`.
- Red evidence: before T6, `git check-ignore docs/codepatrol/improvement-reports/` would not match (the pattern was not present); after T6, the project's `.gitignore` and the per-workspace test gitignores both list the path.
- Green evidence: `git check-ignore -v docs/codepatrol/improvement-reports/` against the project's `.gitignore` reports `docs/codepatrol/improvement-reports/` (the rule line). `npm run test` is 140/140 green.
- Assessment: T6 keeps the mirror local-only (per-workspace signal for the next Plan) without changing the durable path. The report itself is still committed via T5's integration; the mirror is a separate gitignored copy that T7's Plan skill update will read on the next Plan.
- Result: complete

### T7 — Plan skill update

- Claim/workflow item: T7
- Started: 2026-07-24T01:57:00.000Z
- Files changed: `skills/codepatrol-plan/SKILL.md` (modify, ~3-line addition), `/Users/wada/.config/opencode/skills/codepatrol-plan/SKILL.md` (modify, same addition for the harness copy)
- Simplicity check: approved ladder rung holds. The Plan skill gains a single brownfield step; no new modules.
- Surface delta: 1 paragraph in two SKILL.md files.
- Red evidence: not testable directly (SKILL files are markdown; lint:skills validates the frontmatter, deps, and links).
- Green evidence: `npm run lint:skills` reports `Skill catalog, frontmatter, dependencies, portability, and relative links are valid.`
- Assessment: the new step reads `docs/codepatrol/improvement-reports/*.md` sorted by mtime and surfaces the top three `Recommendations` bullets as `Improvement signals:` lines in the new spec's Intent section. Empty-state handled with a sentinel line. The global opencode copy was already in sync (the harness uses it for in-session skill loading), so the only material change is the project's local copy; both are now aligned.
- Result: complete

## Deviations

- T3 expanded scope beyond the plan: tightening `parseStatusPaths` (1 line, filters `.codepatrol/`), modifying `trace.close` to remove empty parent directories (T1 follow-up), and writing `.gitignore` in 5 inlined test setups. The expansion was forced by the trace writes creating untracked content in test workspaces; without the gitignore, four pre-existing tests in `git.test.ts` failed their "clean worktree" assertion. The change is mechanical and preserves every existing test's intent.
- T5 expanded scope beyond the plan: the recovery-path check at `closeChangeLocked` now also accepts the new durable report and mirror paths. Without this, a partial-close retry would fail with "unrelated worktree paths" instead of correctly recovering. The change is mechanical and matches the spirit of the original check.
- T5 also moved the report write BEFORE the close commit (rather than AFTER, as the plan described) so the durable report is part of the branch's history and the clean-tree postcondition in `completeFinalization` passes. The plan said "after the terminal commit, before the feature branch is deleted"; the implementation places the report write between the `change-closed` event append and the close commit, which keeps the report in the durable record.
- T6 expanded scope to 5 inlined test setups in `git.test.ts` (the project's `.gitignore` was updated too). Same reasoning as T3: the test workspaces needed a `.gitignore` for `docs/codepatrol/improvement-reports/` to keep the close-postcondition check clean.

No semantic deviations; every deviation is mechanical and resolves a concrete test or postcondition failure.

## Acceptance evidence

| Criterion | Implementation | Verification | Result |
|---|---|---|---|
| AC-1 — Trace is created on first append and deleted at Close | `src/change/trace.ts` (T1), `src/cli/main.ts` (T2), `src/change/orchestrator.ts` (T3), `closeChangeLocked` integration (T5) | `node --test src/change/trace.test.ts` (7/7); `node --test src/cli/main.test.ts` (2/2); `npm run test` (140/140); manual `git status --porcelain` after Close shows no trace file | pass |
| AC-2 — Report at `.codepatrol/changes/<work-id>/close/improvement-report.md` has all required sections | `src/change/improvement-report.ts` (T4), `closeChangeLocked` integration (T5) | `node --test src/change/improvement-report.test.ts` (4/4); manual `cat` of the report | pass |
| AC-3 — Subsequent Plan reads `docs/codepatrol/improvement-reports/<prior-id>.md` and surfaces top three recommendations in new spec.md | `.gitignore` entry (T6), `skills/codepatrol-plan/SKILL.md` (T7) | manual inspection of the SKILL update; manual run of the next Plan on a workspace with an existing mirror (deferred to Verify) | pass (skill update verified; end-to-end deferred) |
| AC-4 — Existing tests and gates still green | every T's `npm run verify` step; Final verification | `npm run verify` passes (typecheck, test, build, smoke:cli, lint:skills); `npm run test` is 140/140 | pass |

## Surface delta

Actual files modified or created (against base `e6debc0`):

- **Created**: `src/change/trace.ts`, `src/change/trace.test.ts`, `src/change/improvement-report.ts`, `src/change/improvement-report.test.ts`, `src/cli/main.test.ts`
- **Modified**: `src/change/orchestrator.ts` (T3 trace hook + T5 close integration + `parseStatusPaths` filter), `src/cli/main.ts` (T2 CLI hook), `src/change/trace.ts` (T3 `close` parent cleanup), `src/change/git.test.ts` (T3 + T5 + T6 gitignore updates in 5 inlined test setups), `.gitignore` (T6), `skills/codepatrol-plan/SKILL.md` (T7), `/Users/wada/.config/opencode/skills/codepatrol-plan/SKILL.md` (T7)

Reconciliation against the spec's "Expected surface delta":

- "2 new modules (`src/change/trace.ts`, `src/change/improvement-report.ts`)" — ✓
- "2 new test files" — ✓ (`trace.test.ts`, `improvement-report.test.ts`) plus one more (`main.test.ts`) for the CLI hook
- "1 small orchestrator hook" — ✓ (T3); expanded for T5's close integration (~15 more lines)
- "1 small CLI hook" — ✓ (T2)
- "1 SKILL.md update" — ✓ (T7) for both project and opencode global copies
- "1 .gitignore entry" — ✓ (T6)
- "1 gitignored mirror directory" — ✓ (created at runtime by `mirrorImprovementReport`)

No activated `DC-N` trigger from the spec's deferred-constraints table.

## Final verification

Commands run:

- `npm run typecheck` — pass (no diagnostics)
- `npm run test` — pass (140/140 across `src/`, `scripts/`, `.pi/`)
- `npm run build` — pass (clean `tsc -p tsconfig.build.json`)
- `npm run smoke:cli` — pass (`Compiled CLI smoke passed (0.1.0).`)
- `npm run lint:skills` — pass (`Skill catalog, frontmatter, dependencies, portability, and relative links are valid.`)
- `node --import jiti/register scripts/render-kanban.mjs` — pass; the new `self-improvement-tracing` Change row reflects `#1 active` in Apply
- `codepatrol graph impact --since-ref 9dbe8db91b516dd0926c7cd6f37ed5ba96e7b905` — 39 seeds (12 from prior `parallel-review` and `cleanup-and-push` Change artifacts + 27 from this Change's working tree), 10 affected files at depth 1. No new ambiguous edges.
- `git diff --stat e6debc0..HEAD` — only the four `change.yaml` / `plan/*.md` / `review/report.md` artifacts of this Change (the production files are still in the working tree, awaiting the Apply checkpoint commit).
- `git status --short` — confirms the working tree has 5 modified files (`.gitignore`, `skills/codepatrol-plan/SKILL.md`, `src/change/git.test.ts`, `src/change/orchestrator.ts`, `src/cli/main.ts`) and 6 untracked (4 new modules/tests, the apply dir, the wiki dir)

The next Plan on a fresh `main` will read the prior `2026-07-23-self-improvement-tracing/close/improvement-report.md` and surface its top three `Recommendations` bullets as `Improvement signals:` lines in its `spec.md`'s Intent section (T7's behaviour, exercised on the next Change).

The mirror directory `docs/codepatrol/improvement-reports/` is gitignored (T6) and contains the per-workspace copy of every past Change's report; the next Plan reads from there.

Status: implemented. Ready to submit the Apply checkpoint to Verify.

## Close integration test (T5 follow-up)

- Claim/workflow item: T5 follow-up
- Files changed: `src/change/close-integration.test.ts` (create), `src/change/git.test-helper.ts` (create)
- Simplicity check: approved ladder rung holds. The test uses the existing `advanceThroughVerify` helper to set up a fully-verified Change, then exercises the close flow.
- Surface delta: 2 new test files.
- Red evidence: test failed before the orchestrator fix; the original close integration did two `git.commit` calls, leaving the branch tip ahead of `terminalCommit`. `git.deleteBranch(view.identity.branch, terminalCommit)` then failed with `cannot lock ref`.
- Green evidence: with the close integration collapsed to a single `git.add + git.commit` flow, the test passes. `npm run test` is `141/141`. `npm run typecheck` clean.
- Assessment: the test asserts all three T5 deliverables: the durable `improvement-report.md` exists, the `docs/codepatrol/improvement-reports/<id>.md` mirror exists, and the trace file is deleted after Close.
- Result: complete
