# Review — Ephemeral tracing and self-improvement report

- Change: `2026-07-23-self-improvement-tracing`
- Incoming revision: 1
- Reviewed revision: 1
- Reviewer: opencode (codepatrol-review)
- Evidence date: 2026-07-24T01:36:44.000Z

## Scope and evidence

Files inspected (read-only):

- `.codepatrol/changes/2026-07-23-self-improvement-tracing/plan/spec.md` — sha256 `f51756a2…5209` (matches declared).
- `.codepatrol/changes/2026-07-23-self-improvement-tracing/plan/plan.md` — sha256 `15d6ba95…794a` (matches declared).
- `.codepatrol/changes/2026-07-23-self-improvement-tracing/review/report.md` — none yet (this is Review attempt 1).
- `.codepatrol/changes/2026-07-23-self-improvement-tracing/change.yaml` — change-started + plan attempt 1 events.

Git reconciliation:

- Branch: `codepatrol/2026-07-23-self-improvement-tracing` (HEAD `c96dba6…9b44`).
- Base commit: `e6debc057df53789b455fd30930ba35609836423` equals `main` (after the prior `cleanup-and-push` Close landed at `e6debc0`).
- Working tree clean.
- Plan checkpoint `4ebe9de4d9ace8ba785b5390291c97876c4d9bf3`, tree `4ebe9de4…` is the last `stage-checkpointed` event.

Substrate evidence (cited lines verified):

- `src/cli/main.ts:9` — `export async function main(argv = process.argv.slice(2)): Promise<number>`. The CLI entrypoint that the T2 hook will wrap.
- `src/cli/main.ts:30` — `const result = await executeCommand(args, workspace, controller.signal);` — the single dispatch site for every top-level action group. Wrapping the call (or `executeCommand` itself) at this boundary records every CLI invocation.
- `src/change/orchestrator.ts:1-15` imports `appendChangeEvent` from `./store.js:31` for the durable event channel. The trace is a parallel side channel.
- `src/change/orchestrator.ts:344` — the Close terminal commit line (`appendChangeEvent` + `git.tag`). T5 reports the report must slot in *after* this and *before* the branch deletion.
- `src/change/orchestrator.ts:362,371` — the actual `git.deleteBranch` calls live in `completeFinalization`, which is invoked from `closeChangeLocked` at line 346. The spec's "after the terminal commit, before the feature branch is deleted" wording is internally consistent if read as "between line 344 and the call to `completeFinalization` at line 346" (since `completeFinalization` performs the branch delete).
- `src/shared/state.ts:5-7` — `stateRoot(workspace)` returns `.codepatrol/runtime`. The trace path lives under this root.
- `.gitignore` already lists `.codepatrol/runtime/` (and several other `.codepatrol/<dir>/` patterns). The proposed `docs/codepatrol/improvement-reports/` entry is not yet present and must be added by T6.
- `AGENTS.md:14-15` confirms that ignored state lives only in `.codepatrol/runtime/`, so the ephemeral trace is a natural fit under the existing ignore rule.

Spec/plan cross-check: the spec names a `recordTrace(workspace, workId, entry)` helper in the In Scope list, but the plan's T1 only declares `trace.append`. The CLI hook in T2 is its own `recordCommand` wrapper. The minor naming discrepancy is implementation-level: the Apply can either rename `append` to `recordTrace` for spec alignment or keep `append` as the low-level primitive with `recordTrace` as a thin alias. Either is acceptable.

## Findings

No critical, major, or minor findings. The plan is internally consistent, substrate-aligned, and the file lists match the substrate. The minor imprecision about `git.deleteBranch`'s exact location (in `completeFinalization` rather than directly in `closeChangeLocked`) does not affect the integration plan: T5's step 1 places the report write after the terminal commit and before `completeFinalization` is called, which is exactly between the durable commit and the branch deletion.

## Artifact adjustments

| Artifact | Change | Reason | Acceptance criteria affected |
|---|---|---|---|
| `spec.md` | none | spec is decision-complete | AC-1, AC-2, AC-3, AC-4 |
| `plan.md` | none | bounded corrections belong in a new Plan attempt, not in-place edits | T1, T2, T3, T4, T5, T6, T7 |

## Acceptance coverage

| Criterion | Spec is unambiguous | Plan task(s) | Verification is red-capable | Result |
|---|---|---|---|---|
| AC-1 — Trace is created on first append and deleted at Close | yes | T1, T2, T3, T5 | yes — `node --test src/change/trace.test.ts` (T1) covers lazy-create and delete; T2's CLI hook test exercises the command/error recording; T5's integration test asserts the trace file is gone after Close | covered |
| AC-2 — Report at `.codepatrol/changes/<work-id>/close/improvement-report.md` has all 7 required sections | yes | T4, T5 | yes — `node --test src/change/improvement-report.test.ts` (T4) asserts each section is non-empty; T5's integration test asserts the file is written | covered |
| AC-3 — Subsequent Plan reads `docs/codepatrol/improvement-reports/<prior-id>.md` and surfaces top three recommendations in new spec.md | yes | T6, T7 | yes — T6's `git check-ignore` step ensures the mirror is local-only; T7's SKILL update adds the brownfield step that reads the mirror; the Final verification runs an end-to-end on this Change and inspects the next spec.md | covered |
| AC-4 — Existing tests and gates still green | yes | T1, T2, T3, T4, T5, T6 | yes — `npm run verify` (typecheck, test, build, smoke:cli, lint:skills) is part of every task's `npm run verify` step and the Final verification; the existing 127 tests must remain green throughout | covered |

## Simplicity axis

- Selected rung: direct local change (confirmed).
- Safety floor: trace write/delete failures are logged but never abort the lifecycle (per spec §"Safety floor" and plan §"Global constraints"). The CLI hook redacts well-known secret fields. The mirror is gitignored so it never appears in a Commit. The durable `ChangeRecordV2` schema and `RunUsage` envelope are untouched.
- Surface delta: 2 new modules (`src/change/trace.ts`, `src/change/improvement-report.ts`), 2 new test files, ~30 lines in `src/cli/main.ts`, ~10 lines in `src/change/orchestrator.ts` (T3) plus ~10 more in `closeChangeLocked` (T5), 1 SKILL.md update, 1 .gitignore entry, 1 gitignored mirror directory. The plan's "1 small orchestrator hook, 1 small CLI hook" understates T5's additional Close integration, but the total surface remains well within the spec's "Expected surface delta" forecast.

| Category | Location | Removable surface or replacement | Safety/acceptance impact | Disposition |
|---|---|---|---|---|
| reuse | `src/shared/state.ts:5-7` `stateRoot` | the trace path is built on top of the existing runtime root | none — reuses the project's existing ephemeral-state convention | already sufficient |
| built-in | `src/change/orchestrator.ts:344` close terminal commit line | the report write slots into the existing flow | none — purely additive | already sufficient |
| simplify | `src/cli/main.ts:30` `executeCommand` dispatch | the wrap is a single helper at the dispatch boundary | none — catches every top-level action | already sufficient |
| speculative | the report's "recommendations" rule set | the spec lists three example rules; the Apply may need a fourth or fifth | none — the AC only requires non-empty `recommendations` | acceptable to leave to Apply |

Deferred constraints: DC-1 (cross-workspace trends) and DC-2 (CLI top-level try/catch for hard crashes) each have a known ceiling, observable trigger, and upgrade path, satisfying the format requirement.

## Executability audit

- Paths: every cited file exists. `src/change/trace.ts`, `src/change/improvement-report.ts`, `src/change/trace.test.ts`, `src/change/improvement-report.test.ts` do not exist yet (red) and will be created by T1 and T4. `src/cli/main.ts`, `src/change/orchestrator.ts`, `.gitignore`, and `skills/codepatrol-plan/SKILL.md` exist and will be modified.
- Interfaces: `trace.append`, `trace.close`, `trace.read`, `trace.path`, `trace.open`, `trace.redact` are the exact surface declared in T1. The `ImprovementReport` shape in T4 lists the 7 sections. The CLI hook in T2 wraps every top-level action group.
- Dependencies: no new packages. The plan reuses `withWorkspaceLock`, `atomicWriteFile`, and the project's existing `CodepatrolError` class.
- Commands: every task has a "Run `npm run verify`" or "Run `npm run typecheck`" step with an expected green signal. The Final verification runs `npm run verify` end-to-end.
- Rollback: removing the trace module and the hooks is a single `git revert`; no durable state is affected.
- Context independence: the spec and plan are self-contained — every cited path, command, and AC trace is in the spec/plan or in this report.

Unresolved assumption: T4's "recommendations" rule set is sketched in the plan but not enumerated. The Apply will need to define the rule set to a level that produces a non-empty `recommendations` array. This is an implementation detail covered by the AC ("non-empty for a Change that has at least one transition").

## Verdict

`approve`

The Plan is decision-complete, substrate-consistent, and contains zero production code changes beyond the planned new modules and small hook insertions. The four acceptance criteria are covered by red-capable tests across T1, T2, T3, T4, T5, T6, and the Final verification. The dependency order is coherent and the file lists match the substrate. The trace is genuinely ephemeral (lives under `.codepatrol/runtime/`), the report is durable and committed with the Change, and the Plan skill update closes the self-improvement loop by reading the most recent mirror. The Change is ready for `codepatrol-apply 2026-07-23-self-improvement-tracing on codepatrol/2026-07-23-self-improvement-tracing`.

## External evidence sufficiency

`not required` — the design is internal to the project's harness. No external protocol or GitHub reference governs this Plan. The trace format, report shape, and Plan skill update are all project-local.

## Residual risks and evidence gaps

- Token-metric coverage for this Review is `0/1` measured (opencode harness). Coverage for the Change (plan + review) is `0/2` measured. Mirrors the existing metric profile and is not a verification defect.
- The spec's "recommendations" rule set is sketched but not enumerated. The Apply must define enough rules to produce a non-empty `recommendations` array; this is bounded by AC-2.
- The `redact` function in T1 is declared but its call site is implicit. The Apply must decide whether to call `redact` inside `trace.append` (single chokepoint) or in `recordCommand` (CLI-specific). Either is acceptable; the latter is closer to the spec's "the CLI hook redacts before writing" wording.
- AC-3 (the Plan skill reading prior improvement reports and surfacing them as `Improvement signals:` in the next spec) is verified end-to-end in the Final verification step, not by an automated test. The test in T4 asserts the mirror is written; the Plan skill update in T7 adds the brownfield step; the end-to-end check inspects the next spec.md manually. This is acceptable for a documentation/behavior change.
- Prior review reports from this session (none, since this is the first review on this Change) are preserved on disk; only this Review 1 is the live verdict.
