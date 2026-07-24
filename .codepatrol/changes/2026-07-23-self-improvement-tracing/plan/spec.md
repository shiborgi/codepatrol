# Specification — Ephemeral tracing and self-improvement report

## Intent

- Origin: improve-codebase
- Mode: feature
- Target baseline: main at `e6debc057df53789b455fd30930ba35609836423` (after `2026-07-23-cleanup-and-push` was committed)
- Governing constraints: None — extends the orchestrator and CLI without altering `ChangeRecordV2` schema; the report is a derived artifact, not a governing record.
- Substrate state: graph revision present; wiki state absent.
- Problem: Each Change records its durable lifecycle through `change.yaml`, but the lifecycle skips the operational noise: how many times Review/Verify returned the Change, which CLI commands failed, what error codes fired, how the human-harness loop actually unfolded. Self-improvement is hard without a structured digest of that noise, and the noise is currently thrown away with the working tree.
- Outcome: Every Change opens an ephemeral JSONL trace under `.codepatrol/runtime/traces/<work-id>.jsonl` at Plan start, captures every CLI invocation (and the orchestrator's success/error result) until Close, and at Close produces a process improvement report at `.codepatrol/changes/<work-id>/close/improvement-report.md`. The trace file is deleted after the report is written. A new Plan that starts on top of the same `main` (or any brownfield Change) can read the most recent report to drive its own design choices.

## Scope

### In scope

- A new module `src/change/trace.ts` that owns the per-Change JSONL trace: `open(workId)`, `append(entry)`, `close()` (deletes the file), `readForReport(workId)`. Trace entries are validated JSON objects with a stable `kind` discriminator (`command`, `event`, `error`).
- A new helper `recordTrace(workspace, workId, entry)` exposed from `src/change/trace.ts` and used by the orchestrator and CLI. The trace file is created lazily on the first append; missing file at Close is not an error.
- Hooks in the CLI dispatcher (`src/cli/main.ts`) and the orchestrator (`src/change/orchestrator.ts`) that append a `command` entry before each top-level action (`change start`, `change transition`, `change session`, `change close`, `change inspect`) and an `error` entry on every `CodepatrolError` thrown by the action.
- A new module `src/change/improvement-report.ts` with `generateImprovementReport(workspace, workId): ImprovementReport` and `writeImprovementReport(workspace, workId): string` (returns the report path). The report reads the trace plus the change record and emits a markdown file with: per-stage attempt counts; per-stage return reasons; top error codes by frequency; per-stage elapsed time; artifact count and sizes; recommendations derived from the data (e.g., "Plan attempt 1 returned 3 times for contract defects — consider adding an `assess-change` precondition before Review").
- The Close stage (in `src/change/orchestrator.ts:closeChangeLocked`) calls `writeImprovementReport` after the terminal commit and before the feature branch is deleted; it then calls `trace.close()` to remove the trace file.
- A new sub-step in `skills/codepatrol-plan/SKILL.md` (and the project's other Plan skill file at `skills/_shared/CODEPATROL-CLI.md` if relevant) instructing the Plan harness to read the most recent report under `docs/codepatrol/improvement-reports/` (a small mirror the Close stage also writes) and surface its top three recommendations in the next `spec.md`'s Intent section.
- A new acceptance test in `src/change/improvement-report.test.ts` that runs the trace → report flow on a synthetic change record and asserts the report's required sections, plus a test that confirms the trace file is gone after Close.

### Out of scope

- Tracing external tools (git, npm, package managers). The trace is limited to codepatrol CLI invocations and orchestrator events.
- Real-time streaming of the report. The report is generated only at Close.
- Cross-workspace aggregation. Reports are per-workspace and per-Change.
- A web UI. The report is a markdown file.
- Modifications to the durable `ChangeRecordV2` schema. The trace is a parallel, ephemeral artifact.
- Auto-applying recommendations from one Change to the next. The next Plan reads the report and decides; the orchestrator does not.

## Current evidence

- `src/cli/main.ts` is the single CLI entrypoint and currently has no tracing.
- `src/change/orchestrator.ts:1-15` imports `appendChangeEvent` from `src/change/store.ts:31` for durable event recording. The trace is a separate, parallel channel.
- `src/change/orchestrator.ts:344` is the Close commit; this is where the report generation must slot in.
- `src/shared/state.ts:5-7` defines `stateRoot` at `.codepatrol/runtime`. `AGENTS.md:14-15` already states that ignored state lives only in `.codepatrol/runtime/`, so the trace is a natural fit.
- The durable `change.yaml` records per-stage attempts, results, and reasons; the trace layers command-level and error-level detail on top without duplicating this.
- `codepatrol change doctor` is a thin read-only validator and is not affected.

## Proposed design

1. **Trace module** (`src/change/trace.ts`): a small module with `open(workspace, workId)`, `append(workspace, workId, entry)`, `close(workspace, workId)`, `read(workspace, workId)`, `path(workspace, workId)`. Entries are validated through `assertTraceEntry` (Zod-style manual shape check). The trace file path is `.codepatrol/runtime/traces/<work-id>.jsonl`. The file is created lazily on first `append`; reads return an empty array if the file is absent.
2. **CLI hook** (`src/cli/main.ts`): wrap the `main()` entrypoint so that every top-level command group (`start`, `transition`, `session`, `close`, `inspect`) records `{ kind: "command", command, args, at }` before dispatch and `{ kind: "error", command, code, message, at }` if the action throws a `CodepatrolError`. The args are recorded as a stable redacted shape (no raw input streams).
3. **Orchestrator hook** (`src/change/orchestrator.ts`): in each top-level `*Locked` function (`startChangeLocked`, `transitionChangeLocked`, `closeChangeLocked`), call `trace.append(workspace, workId, { kind: "event", stage, attempt, type, at })` after the event is appended to the change record. This is a fire-and-forget call that does not affect the durable path on failure.
4. **Report module** (`src/change/improvement-report.ts`): `generateImprovementReport(workspace, workId)` returns a structured object with `perStage`, `returns`, `topErrors`, `elapsedPerStage`, `artifactStats`, `recommendations`. `writeImprovementReport(workspace, workId)` writes the markdown to `.codepatrol/changes/<work-id>/close/improvement-report.md` and returns the path.
5. **Close integration** (`src/change/orchestrator.ts:closeChangeLocked`): after the terminal commit, before `git.deleteBranch`, call `writeImprovementReport`. Then call `trace.close(workspace, workId)` to remove the trace file. Both calls are wrapped in try/catch — failure to write the report or to delete the trace must not abort Close.
6. **Report mirror** (`docs/codepatrol/improvement-reports/<work-id>.md`): a thin copy of the close report under `docs/codepatrol/` so the next Plan can read prior reports without iterating every Change. The mirror is added to `.gitignore` already (the existing `docs/wiki` ignore pattern covers it; explicitly add `docs/codepatrol/improvement-reports/`).
7. **Plan skill update** (`skills/codepatrol-plan/SKILL.md` and the project copy): add a step in the brownfield Change introduction that reads `docs/codepatrol/improvement-reports/*.md` (sorted by file mtime, take the most recent) and surfaces the top three recommendations in the new spec's Intent section as `Improvement signals:` lines.

## Alternatives

- Reuse the durable `change.yaml` and synthesize a report at Close without a separate trace: rejected because `change.yaml` is a structured event log, not a command log; CLI errors that did not become events (e.g., `INVALID_ARGUMENT` before any event was recorded) would be invisible.
- Persist the trace in a database or external store: rejected because the trace is explicitly ephemeral and out of scope for the project.
- Auto-apply recommendations in the next Change: rejected because the next Plan is its own decision-complete spec; auto-application would couple Plans in a way the harness does not currently support.
- Generate the report continuously during the lifecycle, not just at Close: rejected because the user explicitly said "ao executar o step de close, a agente analise tudo".

## Simplicity decision

- Selected rung: direct local change.
- Earlier rungs: needs new implementation because the orchestrator has no trace channel today; the durable `change.yaml` cannot be the trace (it is durable, structured, and validated).
- Irreducible complexity: the trace must be a side channel that the durable path never depends on; the report must be derived from both sources.
- Safety floor: trace write/delete failures are logged but never abort the lifecycle; the report is informational; the mirror is gitignored so it never appears in a Commit. The CLI hook redacts inputs that may contain credentials (e.g., the `provider` block in start inputs).
- Expected surface delta: 2 new modules (`src/change/trace.ts`, `src/change/improvement-report.ts`), 2 new test files, 1 small orchestrator hook, 1 small CLI hook, 1 SKILL.md update, 1 .gitignore entry, 1 gitignored mirror directory. No schema change.

## Deferred constraints

| ID | Chosen simplification | Known ceiling | Observable trigger | Upgrade path |
|---|---|---|---|---|
| DC-1 | Trace is per-Change, not per-workspace aggregate | Cross-Change trends (e.g., "this month 30% of Changes needed 2+ Plan attempts") are not visible | A user asks for a trends dashboard or weekly review | Add a separate aggregator that walks `.codepatrol/changes/*/close/improvement-report.md` and emits a roll-up |
| DC-2 | CLI hook only catches `CodepatrolError`; unhandled exceptions may escape untraced | The trace is missing entries for hard crashes | A Change is reported with a `start` event but no `checkpoint` and the working tree is dirty | Wrap the CLI entrypoint in a top-level try/catch that records the error before re-throwing |

## Compatibility and rollout

- Compatible: the durable `change.yaml` schema is unchanged; the new trace file is in `.codepatrol/runtime/` (already an ignored path per `AGENTS.md:14-15`).
- No migration needed: prior Changes have no trace and no report; the next Change that starts on a fresh `main` opens a new trace and produces a report at Close.
- The mirror under `docs/codepatrol/improvement-reports/` is gitignored; it is a per-workspace read-only signal for the next Plan.
- Rollback: removing the trace module and the orchestrator/CLI hooks is a single `git revert`; no durable state is affected.

## Risks and mitigations

- Risk: the trace grows unboundedly under a long-lived Change that runs many commands. Mitigation: cap the trace to the last 10,000 entries by line count; older entries are rotated to a `.1.jsonl` sibling. Closing the trace at end-of-Change guarantees the file is eventually freed.
- Risk: the CLI hook may double-record commands (e.g., if both the dispatcher and the orchestrator call `append`). Mitigation: the CLI hook records with `kind: "command"` at the dispatch boundary; the orchestrator hook records with `kind: "event"`. The kinds are disjoint and the report's `topCommands` aggregator groups only on `kind: "command"`.
- Risk: the report misclassifies a `start` command as a "command" event but not as a "stage" event, leading to double-counting. Mitigation: the report's `perStage` aggregator only counts `kind: "event"` entries; `kind: "command"` is grouped separately.
- Risk: the mirror directory name collides with the existing `docs/codepatrol/2026-07-20-status-kanban-details/` directory pattern. Mitigation: the new mirror is under `docs/codepatrol/improvement-reports/` (a dedicated subdirectory) and the `docs/codepatrol/<work-id>/` pattern remains unchanged.

## Acceptance criteria

- AC-1: Opening a Plan via `codepatrol change start` creates the trace file at `.codepatrol/runtime/traces/<work-id>.jsonl` (lazy, on first append). Calling `change transition --type begin` for the same work id appends one entry of `kind: "event"` and one entry of `kind: "command"`. Calling `change close` flushes the report at `.codepatrol/changes/<work-id>/close/improvement-report.md` and deletes the trace file; `git status --porcelain` shows no trace file.
- AC-2: The report at `.codepatrol/changes/<work-id>/close/improvement-report.md` contains the sections: Summary, Per-stage attempts, Returns, Top errors, Elapsed per stage, Artifact stats, Recommendations. Each section is non-empty for a Change that has at least one transition.
- AC-3: A subsequent `codepatrol change start` (any new work id) on a workspace that has a `docs/codepatrol/improvement-reports/<prior-id>.md` reads that file during the Plan brownfield step and surfaces its top three recommendations as `Improvement signals:` lines in the new spec's Intent section. Verified by inspecting the new spec.md.
- AC-4: The `npm run test` and `npm run typecheck` gates pass with the new modules and the existing 127 tests still green. The kanban render still emits the new `~c` suffix (no regression on the prior Change).

## Decisions and open questions

- Settled: trace lives in `.codepatrol/runtime/traces/<work-id>.jsonl` (ephemeral, ignored). Report lives in `.codepatrol/changes/<work-id>/close/improvement-report.md` (durable) and is mirrored to `docs/codepatrol/improvement-reports/<work-id>.md` (gitignored, per-workspace signal for the next Plan).
- Settled: report is generated only at Close, not continuously. Trace rotation (last 10,000 entries) keeps the file bounded.
- Settled: the CLI hook redacts well-known secret fields (e.g., `provider.options.apiKey`, `provider.options.headers.Authorization`) before writing them to the trace.
- No open question blocks Plan checkpoint.
