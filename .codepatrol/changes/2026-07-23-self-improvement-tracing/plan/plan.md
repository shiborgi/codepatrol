# Plan — Ephemeral tracing and self-improvement report

- Work id: `2026-07-23-self-improvement-tracing`
- Governing spec: `spec.md`
- Target baseline: main at `e6debc057df53789b455fd30930ba35609836423`

## Goal and approach

Add a per-Change JSONL trace at `.codepatrol/runtime/traces/<work-id>.jsonl` that captures every codepatrol CLI invocation and every orchestrator event, plus a self-improvement report generator that runs at Close. The trace is created lazily on the first append, never written to durable storage, and is deleted at Close. The report is written both to `.codepatrol/changes/<work-id>/close/improvement-report.md` (durable, kept with the Change) and mirrored to `docs/codepatrol/improvement-reports/<work-id>.md` (gitignored, per-workspace signal for the next Plan). The Plan skill is extended to read the most recent mirror and surface its top three recommendations as `Improvement signals:` lines in the new spec's Intent section.

## Global constraints

- The trace file is ephemeral: it lives under `.codepatrol/runtime/` and is deleted at Close. The report is durable: it is committed with the Change.
- Trace write/delete failures must never abort the lifecycle.
- The CLI hook redacts well-known secret fields (`provider.options.apiKey`, `provider.options.headers.Authorization`, anything in `headers.*.Authorization`) before writing to the trace.
- No durable schema change: `ChangeRecordV2` and `RunUsage` are untouched.
- All existing tests (`npm run test`, 127/127) and gates (`npm run verify`) must remain green.

## Simplicity proof

- Selected rung: direct local change.
- Reused capabilities: existing `withWorkspaceLock`, `atomicWriteFile` (`src/shared/atomic-store.ts`), and the orchestrator's per-Change lock pattern. The trace is a side channel; it does not participate in the durable path.
- Forbidden speculative surface: no cross-workspace aggregation, no live streaming, no DB-backed store, no auto-application of recommendations.
- Expected surface delta: 2 new modules (`src/change/trace.ts`, `src/change/improvement-report.ts`), 2 new test files, 4 small hook insertions in `src/cli/main.ts` and `src/change/orchestrator.ts`, 1 SKILL.md update, 1 .gitignore entry, 1 gitignored mirror directory. No schema change, no dependency change.

## Acceptance mapping

| Criterion | Task(s) | Verification |
|---|---|---|
| AC-1 — Trace is created on first append and deleted at Close | T1, T2, T3, T5 | `npm run test src/change/trace.test.ts`; manual run of `change start` + `change close` and `git status --porcelain` shows no trace file at the end |
| AC-2 — Report at `.codepatrol/changes/<work-id>/close/improvement-report.md` has all required sections | T4, T5 | `npm run test src/change/improvement-report.test.ts`; manual run of `change close` on a synthetic change and `cat` of the report |
| AC-3 — Subsequent Plan reads `docs/codepatrol/improvement-reports/<prior-id>.md` and surfaces top three recommendations in new spec.md | T6, T7 | `npm run test src/change/improvement-report.test.ts` (which asserts the mirror is written); manual run of `change start` after a Close and inspection of the new spec.md |
| AC-4 — All existing tests and gates still green | T1, T2, T3, T4, T5, T6 | `npm run verify` passes; existing 127 tests still green; kanban still emits `~c` suffix |

## Dependency order

`T1 → T2 → T3 → T4 → T5 → T6 → T7`. T1 is the trace module; T2 and T3 add the hook sites; T4 builds the report; T5 wires it into Close; T6 mirrors the report and updates `.gitignore`; T7 updates the Plan skill.

### T1 — Trace module

**Purpose:** Satisfies AC-1 by providing the per-Change trace channel.

**Depends on:** None

**Files:**

- Create: `src/change/trace.ts`
- Create: `src/change/trace.test.ts`

**Interfaces:**

- `path(workspace, workId): string` — returns `.codepatrol/runtime/traces/<work-id>.jsonl` (creates the directory if absent).
- `open(workspace, workId): void` — creates the empty file and any parent directories; idempotent.
- `append(workspace, workId, entry: TraceEntry): void` — appends one JSONL line; creates the file lazily if needed; fails silently on write errors (logs to stderr but does not throw).
- `close(workspace, workId): void` — deletes the trace file; missing file is not an error.
- `read(workspace, workId): TraceEntry[]` — reads all lines; missing file returns `[]`; malformed lines are skipped with a stderr warning.
- `redact(input: unknown): unknown` — recursive redactor that masks well-known secret fields before they reach the trace.
- `TraceEntry` — discriminated union: `{ kind: "command", at, command, args }` | `{ kind: "event", at, stage, attempt, type }` | `{ kind: "error", at, command, code, message }`.

**Simplicity proof:** Reuse `withWorkspaceLock` and `atomicWriteFile`. The trace is append-only; a flat JSONL file with one entry per line keeps the format simple and human-readable.

**Surface delta:** 2 new files.

**Steps:**

1. Add the test below at the seam.

   ```typescript
   test("trace append creates the file lazily and close removes it", () => {
     const workspace = mkdtempSync(join(tmpdir(), "codepatrol-trace-"));
     try {
       trace.open(workspace, "w1");
       trace.append(workspace, "w1", { kind: "command", at: "2026-07-24T00:00:00.000Z", command: "change start", args: {} });
       trace.append(workspace, "w1", { kind: "event", at: "2026-07-24T00:00:01.000Z", stage: "plan", attempt: 1, type: "stage-began" });
       const entries = trace.read(workspace, "w1");
       assert.equal(entries.length, 2);
       trace.close(workspace, "w1");
       assert.equal(existsSync(trace.path(workspace, "w1")), false);
     } finally { rmSync(workspace, { recursive: true, force: true }); }
   });
   ```

2. Run `node --test src/change/trace.test.ts`. Expected red: `trace` module does not exist.
3. Implement `src/change/trace.ts` exactly to the declared interface.
4. Run `node --test src/change/trace.test.ts`. Expected green: the new test passes.
5. Run `npm run typecheck`. Expected: clean.

**Task result:** append to `apply/journal.md` after T1 lands.

### T2 — CLI hook

**Purpose:** Satisfies AC-1 by recording every CLI invocation.

**Depends on:** T1

**Files:**

- Modify: `src/cli/main.ts`

**Interfaces:**

- Wrap each top-level action group (`change start`, `change transition`, `change session`, `change close`, `change inspect`) so the entrypoint records `kind: "command"` before dispatch and `kind: "error"` on `CodepatrolError`.
- The wrap is a single helper `recordCommand(workspace, command, args, fn)` that returns the action's result or rethrows the error after appending a `kind: "error"` entry.

**Simplicity proof:** One helper, five call sites. No new dependencies; no new error types.

**Surface delta:** 1 file modified, ~30 lines.

**Steps:**

1. Add a unit test for `recordCommand` in a new test file (or extend an existing one if preferred) that asserts the trace file contains both `command` and `error` entries after a successful and a failing call.
2. Run the targeted test. Expected red: the helper does not exist.
3. Implement the helper in `src/cli/main.ts`; wrap each top-level action group.
4. Run the targeted test. Expected green.
5. Run `npm run verify`. Expected: all green.

**Task result:** append to `apply/journal.md`.

### T3 — Orchestrator hook

**Purpose:** Satisfies AC-1 by mirroring the durable event log into the trace.

**Depends on:** T1, T2

**Files:**

- Modify: `src/change/orchestrator.ts`

**Interfaces:**

- In each `*Locked` function (`startChangeLocked`, `transitionChangeLocked`, `closeChangeLocked`), after the event is appended to the change record, call `trace.append(workspace, workId, { kind: "event", at, stage, attempt, type })`. The call is wrapped in try/catch and never throws.

**Simplicity proof:** One-line additions in three places. The trace is fire-and-forget.

**Surface delta:** 1 file modified, ~10 lines.

**Steps:**

1. Add a unit test in `src/change/orchestrator.test.ts` (or a new `src/change/trace-integration.test.ts`) that runs `startChangeLocked` in a temp workspace and asserts the trace file contains an `event` entry after the call.
2. Run the targeted test. Expected red: the trace file is empty.
3. Implement the hook in `src/change/orchestrator.ts`.
4. Run the targeted test. Expected green.
5. Run `npm run verify`. Expected: all green.

**Task result:** append to `apply/journal.md`.

### T4 — Improvement report module

**Purpose:** Satisfies AC-2 by generating the report.

**Depends on:** T1, T3

**Files:**

- Create: `src/change/improvement-report.ts`
- Create: `src/change/improvement-report.test.ts`

**Interfaces:**

- `ImprovementReport` — structured object with `summary`, `perStage: Record<Stage, { attempts: number, returns: number, elapsedMs: number }>`, `returns: { stage: Stage; attempt: number; reason: string }[]`, `topErrors: { code: string; count: number; sampleMessage: string }[]`, `elapsedPerStage: Record<Stage, number>`, `artifactStats: { count: number; totalBytes: number }`, `recommendations: string[]`.
- `generateImprovementReport(workspace, workId): ImprovementReport` — reads the trace and the change record, aggregates the data, returns the report object. Returns an empty report (with `recommendations: ["No trace available for this Change."]`) if both sources are absent.
- `renderReportMarkdown(report: ImprovementReport): string` — pure function that returns the markdown body.
- `writeImprovementReport(workspace, workId): string` — calls `generateImprovementReport`, renders, writes to `.codepatrol/changes/<work-id>/close/improvement-report.md`, and returns the path.
- `mirrorImprovementReport(workspace, workId, sourcePath): string` — copies the report to `docs/codepatrol/improvement-reports/<work-id>.md`; creates the directory if absent. Returns the mirror path.

**Simplicity proof:** The trace is already JSONL; the change record is already YAML. Aggregation is straightforward counting and grouping. Recommendations are produced by a small set of rules (e.g., "if Plan returns > 2, recommend `assess-change` precondition"; "if any stage has 0 attempts in this Change, recommend checking stage skip conditions").

**Surface delta:** 2 new files.

**Steps:**

1. Add the test below.

   ```typescript
   test("report aggregates trace and change record into the required sections", () => {
     // create a workspace, write a synthetic change.yaml with 1 plan and 2 review returns,
     // write a trace.jsonl with 2 commands and 1 error,
     // call generateImprovementReport(workspace, "w"),
     // assert the report has all 7 sections and a non-empty recommendations array.
   });
   ```

2. Run the targeted test. Expected red: `improvement-report` module does not exist.
3. Implement `src/change/improvement-report.ts` to the declared interface.
4. Run the targeted test. Expected green.
5. Run `npm run verify`. Expected: all green.

**Task result:** append to `apply/journal.md`.

### T5 — Close integration

**Purpose:** Satisfies AC-1 and AC-2 by wiring the report into Close and deleting the trace.

**Depends on:** T4

**Files:**

- Modify: `src/change/orchestrator.ts` (`closeChangeLocked`)

**Interfaces:**

- After the terminal commit, before `git.deleteBranch`, call `writeImprovementReport(workspace, workId)` and `mirrorImprovementReport(workspace, workId, ...)`. Then call `trace.close(workspace, workId)`. All three calls are wrapped in try/catch and log to stderr on failure without aborting Close.

**Simplicity proof:** Three new lines in `closeChangeLocked`, behind an existing try/catch. The report is informational; the trace delete is cleanup.

**Surface delta:** 1 file modified, ~10 lines.

**Steps:**

1. Add a unit test that runs `closeChangeLocked` on a synthetic committed Change in a temp workspace and asserts that `.codepatrol/changes/<work-id>/close/improvement-report.md` exists, `docs/codepatrol/improvement-reports/<work-id>.md` exists, and the trace file is gone.
2. Run the targeted test. Expected red: the report file is not written; the trace file is not deleted.
3. Implement the integration in `src/change/orchestrator.ts:closeChangeLocked`.
4. Run the targeted test. Expected green.
5. Run `npm run verify`. Expected: all green.

**Task result:** append to `apply/journal.md`.

### T6 — Mirror directory and .gitignore

**Purpose:** Satisfies AC-3 by ensuring the next Plan can find prior reports.

**Depends on:** T5

**Files:**

- Modify: `.gitignore` — add `docs/codepatrol/improvement-reports/`

**Interfaces:**

- The mirror directory is created at runtime by `mirrorImprovementReport`. The gitignore entry ensures the directory is local-only.

**Simplicity proof:** One line in `.gitignore`; the directory is created by T5's integration.

**Surface delta:** 1 line in `.gitignore`.

**Steps:**

1. Run `git check-ignore docs/codepatrol/improvement-reports/` (after the directory exists from T5). Expected: ignored.
2. Add `docs/codepatrol/improvement-reports/` to `.gitignore` if not already covered.
3. Re-run `git check-ignore`. Expected: ignored.

**Task result:** append to `apply/journal.md`.

### T7 — Plan skill update

**Purpose:** Satisfies AC-3 by instructing the next Plan to read prior reports.

**Depends on:** T5

**Files:**

- Modify: `skills/codepatrol-plan/SKILL.md`
- Modify: `skills/_shared/CODEPATROL-CLI.md` (if it carries the same instruction)

**Interfaces:**

- In the "Bind or start exactly one Change" section of `codepatrol-plan/SKILL.md`, after the "For a brownfield Change, sync the graph once" step, add a step that reads the most recent `docs/codepatrol/improvement-reports/*.md` (sorted by file mtime, take the most recent) and surfaces the top three `recommendations` lines as `Improvement signals:` in the new spec's Intent section.

**Simplicity proof:** The plan skill is the right seam: it is the brownfield Change entry point and is required to be context-free, so it must read every prior signal it can find.

**Surface delta:** 1 SKILL.md modified, ~10 lines.

**Steps:**

1. Confirm the most recent `docs/codepatrol/improvement-reports/<id>.md` exists (created by T5's integration on a prior Change). The next Plan will read it.
2. Add the explicit "read prior improvement report" step to the Plan skill body.
3. Add a tiny self-test note in the SKILL.md file pointing the reader to the new step.

**Task result:** append to `apply/journal.md`.

### Final verification

- Run `npm run verify` (typecheck, test, build, smoke:cli, lint:skills). All must pass.
- Run a manual end-to-end on this Change: complete Apply, complete Verify, complete Close, and confirm the trace file is gone, the durable report is committed, the mirror is gitignored, and the new Plan on a fresh Change surfaces the prior recommendations.
- Diff the workspace and confirm only the planned files were touched. Reconcile with the spec's `Expected surface delta` and explain any difference.
- Sync the graph and confirm no new ambiguous edges were introduced.
- Confirm no `DC-N` trigger was activated; if one was, follow its upgrade path.
- Record residual risks and the rollback path in `apply/journal.md`.

## Rules

- Exact create/modify/delete paths and public interface names are mandatory.
- Each task includes a red-capable test; the Plan cannot checkpoint to Review while any test is left red.
- Dependencies and file ownership make concurrency safe: T1 owns `src/change/trace.ts`; T2 owns `src/cli/main.ts`; T3 owns the `src/change/orchestrator.ts` event hook; T4 owns `src/change/improvement-report.ts`; T5 owns the `src/change/orchestrator.ts` Close hook; T6 owns `.gitignore`; T7 owns the SKILL files. No two tasks write the same file.
- The CLI hook must redact before writing; the test in T2 asserts redaction of well-known secret fields.
