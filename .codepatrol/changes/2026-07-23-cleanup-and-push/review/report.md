# Review — Minor improvements, token count logic, actor tracking, and legacy cleanup

- Change: `2026-07-23-cleanup-and-push`
- Incoming revision: 6
- Reviewed revision: 6
- Reviewer: opencode (codepatrol-review)
- Evidence date: 2026-07-24T00:18:00.000Z

## Scope and evidence

Files inspected (read-only):

- `.codepatrol/changes/2026-07-23-cleanup-and-push/plan/spec.md` — sha256 `8bfc5d02…844` (matches declared).
- `.codepatrol/changes/2026-07-23-cleanup-and-push/plan/plan.md` — sha256 `d17e1723…888` (matches declared).
- `.codepatrol/changes/2026-07-23-cleanup-and-push/review/report.md` — Reviews 2, 3, 4, 5 (all returned) preserved; this is Review attempt 6.

Git reconciliation:

- Branch: `codepatrol/2026-07-23-cleanup-and-push` (HEAD `0b0510e…623a`).
- Base commit: `85936b5e1f5fbc5f10c32725042b610772d978d1` equals `main`.
- Working tree clean.

Substrate evidence (cited files verified):

- `src/change/orchestrator.ts:241` — `function recordFromYaml(raw: string): ChangeRecordV2 { return parse(raw) as ChangeRecordV2; }` — the migration shim target. Called at lines 141, 259, 268, 295; one shim benefits every call site.
- `src/change/board.ts:8` — `usage.tokens.{total,complete,coverage}`; listed correctly in T1.
- `src/change/types.ts:5,9,26` — `TokenUsage`, `RunUsage.tokens`, `UsageSummary.tokens`; listed correctly in T1.
- `src/change/usage.ts` — every `run.tokens`/`result.tokens` reference listed in T1 step 4.
- `src/change/fixtures/{committed,returned,rolled-back}-change.yaml` — `grep -c tokens` returns 5, 2, 5. T2 lists exactly these three.
- `src/change/fixtures/active-change.yaml` — `grep -c tokens` returns 0; correctly absent from T2's Files list (the prior minor defect is fixed).
- `src/change/change.test.ts` (10 refs), `git.test.ts` (13 refs), `board.test.ts` (2 refs) — all in T2.
- `.pi/index.ts:25-30` — `sumPiUsage` reads `message.usage` and tracks `message.model`. T4 step 1 retains `message.model` tracking — the actor string in T4 step 3 (`` `pi (${active.usage.model || "unknown"})` ``) receives a real model from assistant messages.
- `.pi/index.test.ts` exists and contains 4 `tokens`/`characters`/`sumPiUsage` references — T4 step 4 asserts there.
- `src/cli/cli.test.ts:39` — `run(["workflow", "prime", ...])` legacy assertion; T5 deletes it.

Plan attempt 6 has resolved every defect flagged in Reviews 1-5:

- Push excluded (`spec.md:26`).
- `tokens` → `characters` rename (no `chars/4` heuristic).
- Model preserved for actor string (no AC-3/AC-2 contradiction).
- `board.ts`, `board.test.ts`, three fixture YAMLs included in correct tasks (Review 3 fix-first).
- T3's `recordFromYaml` migration shim targets `src/change/orchestrator.ts` (Review 5 major).
- `active-change.yaml` removed from T2 (Review 5 minor).
- Dependency order `T1 → T2 → T3 → T4` matches per-task metadata.
- No incorrect T4/T5 grouping claim.

## Findings

No findings. The Plan attempt 6 is internally consistent, substrate-aligned, and the file lists match `grep` evidence.

## Artifact adjustments

| Artifact | Change | Reason | Acceptance criteria affected |
|---|---|---|---|
| `spec.md` | none | plan is decision-complete | AC-1, AC-2, AC-3 |
| `plan.md` | none | bounded corrections are not needed in-place | T1, T2, T3, T4, T5 |

## Acceptance coverage

| Criterion | Spec is unambiguous | Plan task(s) | Verification is red-capable | Result |
|---|---|---|---|---|
| AC-1 — Characters-based metric with rename + YAML backward-compat | yes | T1, T2, T3, T4 | yes — `npm run typecheck` (catches `board.ts`, all renamed call sites) and `npm run test` (catches `change.test.ts`, `git.test.ts`, `board.test.ts`, all three fixtures, `.pi/index.test.ts`); legacy YAMLs parse via the T3 migration shim | covered |
| AC-2 — `actor` string includes harness and model | yes | T4 step 3 | yes — `.pi/index.test.ts` asserts `intent.actor === \`pi (${model})\``; T4 step 1 retains `message.model` so the field is non-`undefined` for assistant messages | covered |
| AC-3 — Legacy `workflow prime` test removed | yes | T5 | yes — `npm run test` on `cli.test.ts` shows the `workflow prime` assertion gone | covered |

## Simplicity axis

- Selected rung: direct local change (confirmed).
- Safety floor: preserved — push is excluded; the migration shim prevents crash on legacy YAMLs; character counting gracefully handles missing `message.content` via `String(message.content || "").length`.
- Surface delta: 12 files (`src/change/types.ts`, `src/change/usage.ts`, `src/change/board.ts`, `src/change/change.test.ts`, `src/change/git.test.ts`, `src/change/board.test.ts`, `src/change/fixtures/{committed,returned,rolled-back}-change.yaml`, `src/change/orchestrator.ts`, `.pi/index.ts`, `.pi/index.test.ts`, `src/cli/cli.test.ts`). The Plan's "~10 files" figure understates by two; non-blocking — the listed file counts per task are accurate (3 + 6 + 1 + 2 + 1 = 13 line-items, but `.pi/index.ts` and `.pi/index.test.ts` are paired in T4 so 12 distinct files).

| Category | Location | Removable surface or replacement | Safety/acceptance impact | Disposition |
|---|---|---|---|---|
| reuse | `src/change/orchestrator.ts:241` `recordFromYaml` | the migration shim lives here; existing parse path is preserved | none — single chokepoint benefits all four call sites | already sufficient |
| built-in | `UsageSummary.tokens` rename → `characters` | schema-level rename with backward-compat | none — covered by migration shim and fixture migration | already sufficient |
| simplify | `src/cli/cli.test.ts:39` | exact deletion | none — line is dead | accepted |

Deferred constraints: none (per `spec.md:57`).

## Executability audit

- Paths: every cited file exists. T3's `src/change/orchestrator.ts:241` `recordFromYaml` is the chokepoint for the migration shim.
- Interfaces: T1's rename is mechanical (`TokenUsage` → `CharacterUsage`, `tokens` → `characters`). T2 mirrors T1 in tests and three fixtures. T3 adds a defensive migration shim inside the existing one-line `recordFromYaml`. T4 drops `message.usage` for math but keeps `message.model`. T5 deletes one assertion.
- Dependencies: no new packages.
- Commands: T1/T2/T3/T4 verify with `npm run typecheck` and `npm run test`. T5 verifies with `npm run test` on `cli.test.ts`. T3's migration shim is testable by loading a fixture with `tokens:` and asserting the post-`recordFromYaml` object has `characters:` instead.
- Rollback: all changes are reversible via a single Git revert; the migration shim is gated to old records only and the rename is mechanical.
- Context independence: the Plan is self-contained — every cited file, command, and AC trace is in the spec/plan or in this report.

No unresolved assumptions.

## Verdict

`approve`

The Plan attempt 6 has resolved every defect flagged in Reviews 1-5 without introducing any new ones. The file lists match `grep` evidence. The migration shim lives in the correct file. The dependency order is coherent with per-task metadata. Every AC has a red-capable verification path. The Plan is ready for `codepatrol-apply 2026-07-23-cleanup-and-push on codepatrol/2026-07-23-cleanup-and-push`.

## External evidence sufficiency

`not required` — the Change is internal to the project's harness (TypeScript types, pi extension, YAML migration shim, legacy test removal). No external protocol or dependency governs this Plan.

## Residual risks and evidence gaps

- Token-metric coverage for this Review is `0/1` measured (opencode harness) and `0/5` measured across Reviews 2-6.
- Prior Review reports (Reviews 2-5) are preserved on disk as historical records; only Review 6 is the live verdict.
- T3's migration shim is a runtime compatibility layer; it does not migrate on-disk state. A workspace that has already been closed under the old schema will still contain `tokens:` YAML literals until Apply runs T2's fixture migration. External users with their own change records under the old schema will be auto-migrated at read time — this is the intended behavior per `spec.md:65`.
- Apply must still execute all five tasks (T1 through T5) in dependency order; the Project's full gate (`npm run verify` per `package.json:42`) must pass at the end.
