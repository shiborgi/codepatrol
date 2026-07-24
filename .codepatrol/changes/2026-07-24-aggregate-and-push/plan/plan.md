# Plan — Aggregate parallel review/verify and allow push at close

- Work id: `2026-07-24-aggregate-and-push`
- Governing spec: `spec.md`
- Target baseline: main at `d75ff9959f7c8bf14d726896f75c32969240b384`

## Goal and approach

Fix the parallel review/verify aggregation bug (the first persona's checkpoint prematurely advances the state, breaking the second persona), add a `persona` field to discriminate parallel sub-events from the final consolidation, surface the push suggestion in close step's text output, accept an opt-in `push: true` flag on `CloseInput` that performs `git push origin <target>` with double-key opt-in (flag + existing `authority` string), and re-apply the `AGENTS.md:94` carve-out for push that was stashed during this Plan. The work is bounded by the existing lifecycle; no schema break in `ChangeRecordV2` v2; the persona field is optional and old records validate unchanged.

## Global constraints

- No `git push --force` ever. The opt-in push is `git push origin <target_branch>` with no force flag.
- Push failure does not abort Close; the local tag `codepatrol/committed/<work-id>` is the recoverable artifact.
- Persona sub-events are recorded as `StageCheckpointedEvent` and `StageReturnedEvent` with an optional `persona?: string` field. Old records validate unchanged.
- Apply must restore the stashed `AGENTS.md:94` edit (the user already chose "incluir na Change nova") and re-apply it as part of the change.
- All existing tests must remain green; the 141-test count must not regress.

## Simplicity proof

- Selected rung: direct local change.
- Reused capabilities: the durable event log already supports per-event fields; the session items already support per-persona claims; the orchestrator already calls a single `transitionChangeLocked` per CLI invocation. No new package, no new dependency.
- Forbidden speculative surface: no schema migration tool, no explicit `consolidate` subcommand, no global rebase / force push, no multi-remote.
- Expected surface delta: 1 type field added (`persona?` on two events), 1 orchestrator function extended (`transitionChangeLocked`), 1 new orchestrator function (`pushAtClose` inside `closeChangeLocked`), 1 new `CloseInput` field (`push?: boolean`), 1 new `GitAdapter` method (`push`), 3 SKILL.md files updated, 1 `AGENTS.md` section rewritten, 1 stashed `AGENTS.md` edit reapplied.

## Acceptance mapping

| Criterion | Task(s) | Verification |
|---|---|---|
| AC-1 — Parallel personas do not prematurely advance the stage; consolidation is explicit | T1, T2, T3, T4 | `node --test --import jiti/register src/change/orchestrator-parallel.test.ts` (new) with the two-persona + consolidation scenario; existing `src/change/git.test.ts` and `src/change/change.test.ts` still pass; `npm run test` ≥ 142/142 |
| AC-2 — Divergence returns the stage with a synthesised reason | T1, T2, T3, T5 | `node --test --import jiti/register src/change/orchestrator-parallel.test.ts` covers the fix-first + approve mix; the next Plan's `inspect` returns both `Returns` rows; the report's `Returns` table lists both rows |
| AC-3 — Close step prints a push suggestion and accepts `push: true` for opt-in push | T6, T7, T8, T9, T10 | `node --test --import jiti/register src/change/close-push.test.ts` (new) with text-format suggestion assertion and a mocked `git push` for the `push: true` flag; the close result's JSON envelope carries `pushError` only on failure |
| AC-4 — All existing tests and gates still green | T1-T10 | `npm run verify` passes (typecheck, test, build, smoke:cli, lint:skills); 141 prior tests still green; kanban still emits `~c` suffix; close step still writes the receipt + tag + report + mirror |

## Dependency order

`T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10`. T1-T2 extend the type model; T3-T5 add the orchestrator aggregation; T6-T10 add the close push path and the doc updates.

### T1 — Type field additions

**Purpose:** Satisfies AC-1, AC-2 by adding the `persona?: string` discriminator.

**Depends on:** None

**Files:**

- Modify: `src/change/types.ts`

**Interfaces:**

- `StageCheckpointedEvent` gains `persona?: string`.
- `StageReturnedEvent` gains `persona?: string` and `reasons?: string[]` (the latter is the synthesised reasons from the consolidation).

**Simplicity proof:** additive optional field; `model.ts:assertChangeRecord` already uses `exactKeys` per event subtype; the new field is added to the allowed keys for the two event shapes.

**Surface delta:** 2 lines in `types.ts`.

**Steps:**

1. In `types.ts`, add `persona?: string` to `StageCheckpointedEvent` (line 16-18) and to `StageReturnedEvent` (line 17). Add `reasons?: string[]` to `StageReturnedEvent`.
2. Run `npm run typecheck`. Expected green (no consumers yet).
3. Run `npm run test`. Expected: existing tests still pass (the field is optional).

**Task result:** append to `apply/journal.md` after T1 lands.

### T2 — Model recognises persona sub-events

**Purpose:** Satisfies AC-1, AC-2 by making `foldChange` aggregate sub-events into a single attempt view.

**Depends on:** T1

**Files:**

- Modify: `src/change/model.ts`

**Interfaces:**

- `foldChange` continues to return one `StageAttempt` per attempt; the attempt's `status` is derived from the sub-events:
  - any sub-event of type `stage-returned` (or any `StageReturnedEvent` with a `to_stage` set) → attempt `status: "returned"`, `result: "fix-first"` (or whatever the union of `to_stage`s indicates).
  - else the last sub-event of type `stage-checkpointed` wins for `result`.
  - the sub-events themselves are not returned to consumers; the orchestrator and `inspect` see a single logical attempt.
- `aggregateUsage` and the `attemptCount` are unchanged.

**Simplicity proof:** the consumer-facing view is unchanged; only the derivation changes.

**Surface delta:** ~20 lines in `foldChange` to walk sub-events.

**Steps:**

1. In `model.ts`, factor a `summariseAttempt(attempt: StageAttempt, events: ChangeEvent[]): StageAttempt` helper that takes the existing `events` for the attempt and produces the consumer-facing attempt view.
2. In `foldChange`, call `summariseAttempt` for each attempt and replace the attempt's `status` / `result` with the summarised values.
3. Run `npm run typecheck`. Expected green.
4. Run `npm run test`. Expected: existing tests still pass (no sub-events exist in the fixtures).

**Task result:** append to `apply/journal.md` after T2 lands.

### T3 — Orchestrator handles persona sub-events

**Purpose:** Satisfies AC-1, AC-2 by routing persona checkpoints to a sub-event and only advancing the state on a no-persona consolidation.

**Depends on:** T1, T2

**Files:**

- Modify: `src/change/orchestrator.ts`
- Create: `src/change/orchestrator-parallel.test.ts`

**Interfaces:**

- `transitionChangeLocked` (line 197) accepts an optional `persona?: string` on the `TransitionIntent` (extended in `src/cli/types.ts` and `src/cli/args.ts`).
- When `intent.type === "checkpoint"`, `intent.stage` is `review` or `verify`, and `intent.persona` is present:
  - assert that the current attempt is `active` (else `CONSOLIDATION_AFTER_SUBEVENTS` error).
  - record a sub-event of the same kind with the `persona` field set; do not advance `view.stage`.
  - return the unchanged view.
- When `intent.type === "checkpoint"`, `intent.stage` is `review` or `verify`, and `intent.persona` is absent:
  - assert that the current attempt has at least one sub-event (else `NO_SUBEVENTS_TO_CONSOLIDATE` error).
  - if any sub-event is `fix-first` or any sub-event has `to_stage`, record a `stage-returned` event with `to_stage` derived from the persona's `to_stage` and `reasons` synthesised from the persona sub-events' reasons.
  - else record a `stage-checkpointed` event with the last sub-event's `result` and the persona's `artifacts` (the durable sub-artifacts); advance `view.stage`.
- When `intent.type === "return"`, similar: if `intent.persona` is present, record a sub-event; if absent, record the final `stage-returned`.
- The orchestrator's recovery path at line 201-207 is extended: the `eventMatchesIntent` check accepts either a literal match OR a sub-event with the same kind on the same attempt. The recovery path then records the new event.

**Simplicity proof:** the orchestrator's flow is unchanged; one branch added at the top of `transitionChangeLocked` for `persona`-tagged intents.

**Surface delta:** ~50 lines in `transitionChangeLocked`.

**Steps:**

1. In `src/cli/types.ts`, add `persona?: string` to `TransitionIntent` (alongside `stage`, `actor`, etc.).
2. In `src/cli/commands.ts:121`, parse `persona` from the JSON input and pass it to `transitionChange`.
3. In `src/change/orchestrator.ts:197`, add the persona sub-event and consolidation branches.
4. In `src/change/orchestrator.ts:201-207`, extend `eventMatchesIntent` to accept sub-events.
5. Add `src/change/orchestrator-parallel.test.ts` with the AC-1 and AC-2 scenarios.
6. Run `npm run test src/change/orchestrator-parallel.test.ts` against the new file. Expected: tests pass; existing tests still pass.

**Task result:** append to `apply/journal.md` after T3 lands.

### T4 — CLI surface for persona

**Purpose:** Satisfies AC-1, AC-2 by exposing the persona field to CLIs.

**Depends on:** T3

**Files:**

- Modify: `src/cli/args.ts`
- Modify: `src/cli/commands.ts`

**Interfaces:**

- `change transition` accepts an optional `persona` field in the JSON input. The parser passes it through; the orchestrator routes it.

**Simplicity proof:** one field added to the parser; the orchestrator already accepts it from T3.

**Surface delta:** ~5 lines per file.

**Steps:**

1. In `args.ts`, add `persona` to the `KNOWN` set and to the `COMMAND_OPTIONS["change.transition"]` set.
2. In `commands.ts`, read `persona` from the input JSON and forward to `transitionChange`.
3. Run `npm run test`. Expected green.

**Task result:** append to `apply/journal.md` after T4 lands.

### T5 — `assess-change` returns divergence list

**Purpose:** Satisfies AC-2 by surfacing every persona's finding to the next stage.

**Depends on:** T3

**Files:**

- Modify: `src/change/orchestrator.ts` (the consolidation return path)

**Interfaces:**

- When the consolidation's result is `fix-first` (or any sub-event had `to_stage`), the synthesised `stage-returned` event has `reasons: string[]` containing every persona's reason. The next-stage agent reads `change inspect` and gets the `Returns` array with one row per persona.

**Simplicity proof:** the existing `Returns` table in reports already supports multiple rows; this is just a contract change.

**Surface delta:** ~10 lines in the consolidation return path.

**Steps:**

1. In `transitionChangeLocked`, when synthesising a `stage-returned` from a divergence, populate `reasons` from the sub-events.
2. Run `npm run test`. Expected green.

**Task result:** append to `apply/journal.md` after T5 lands.

### T6 — `GitAdapter.push` method

**Purpose:** Satisfies AC-3 by providing the push primitive.

**Depends on:** None

**Files:**

- Modify: `src/change/git.ts`

**Interfaces:**

- `push(remote: string, branch: string, signal?: AbortSignal): Promise<string>` — runs `git push <remote> <branch>`. Returns the stdout (a short message like `To <url>\n * branch <name> -> FETCH_HEAD`). Throws `CodepatrolError("PUSH_FAILED", ...)` on non-zero exit.

**Simplicity proof:** trivial wrapper around `git push`; same shape as `mergeFf`, `tag`, etc.

**Surface delta:** ~10 lines.

**Steps:**

1. Add `push(remote, branch, signal)` to the `GitAdapter` interface and the `NodeGitAdapter` implementation.
2. Run `npm run typecheck`. Expected green.

**Task result:** append to `apply/journal.md` after T6 lands.

### T7 — `CloseInput.push?: boolean`

**Purpose:** Satisfies AC-3 by adding the opt-in push flag.

**Depends on:** None

**Files:**

- Modify: `src/change/types.ts`

**Interfaces:**

- `CloseInput` gains `push?: boolean`.

**Simplicity proof:** one optional boolean field; the close orchestrator reads it and acts.

**Surface delta:** 1 line.

**Steps:**

1. In `types.ts`, add `push?: boolean` to `CloseInput`.
2. Run `npm run typecheck`. Expected green.

**Task result:** append to `apply/journal.md` after T7 lands.

### T8 — `closeChangeLocked` always prints a push suggestion

**Purpose:** Satisfies AC-3 (suggestion part) by emitting the `Consider: git push origin <target>` line on every successful commit.

**Depends on:** T6

**Files:**

- Modify: `src/change/orchestrator.ts:296-353` (`closeChangeLocked`)

**Interfaces:**

- The function's text output (the `result.text` field) ends with the suggestion line when `outcome === "commit"`. The JSON envelope's `data` field includes `pushSuggestion: "git push origin <target>"` when `outcome === "commit"`.

**Simplicity proof:** the suggestion is constant text; the `text` field is already the natural place for human-readable output.

**Surface delta:** ~5 lines.

**Steps:**

1. In `closeChangeLocked`, after the existing `return { outcome, workId, targetBranch, terminalCommit, tag }` line, conditionally add the push suggestion to the returned result.
2. In `commands.ts:140-142`, surface the `pushSuggestion` in the JSON envelope when present.
3. Add `src/change/close-push.test.ts` with the suggestion assertion.
4. Run `npm run test`. Expected green.

**Task result:** append to `apply/journal.md` after T8 lands.

### T9 — `closeChangeLocked` performs opt-in push when `push: true`

**Purpose:** Satisfies AC-3 (opt-in push part) by performing `git push origin <target>` when the flag is set.

**Depends on:** T6, T7, T8

**Files:**

- Modify: `src/change/orchestrator.ts:296-353` (`closeChangeLocked`)
- Create: `src/change/close-push.test.ts` (extension of T8's test)

**Interfaces:**

- After the tag is created, if `input.push === true` and `input.outcome === "commit"`, call `git.push("origin", view.identity.target_branch, options.signal)`. Wrap in try/catch; on failure, capture the error in `result.pushError: { code, message }` and continue (the close still succeeds).
- The result includes `pushError?: { code, message }` (undefined on success).

**Simplicity proof:** the push is a single call; the failure mode is captured but doesn't abort close.

**Surface delta:** ~15 lines.

**Steps:**

1. In `closeChangeLocked`, add the push call after the tag is created. Wrap in try/catch; populate `result.pushError` on failure.
2. Extend `src/change/close-push.test.ts` with the `push: true` scenarios: success, push failure (mocked), `push: true` on `rollback` (no push).
3. Run `npm run test`. Expected green.

**Task result:** append to `apply/journal.md` after T9 lands.

### T10 — Doc and policy updates

**Purpose:** Satisfies AC-1, AC-2 (doc) and AC-3 (policy) by updating the four documents.

**Depends on:** T1-T9 (the orchestrator changes must be in place before the docs reference them)

**Files:**

- Modify: `AGENTS.md:91-94` (drop the "Remote operations remain out of scope" line; add a "Push at close" subsection)
- Modify: `skills/codepatrol-close/SKILL.md:35` (carve out the opt-in push)
- Modify: `skills/codepatrol-apply/SKILL.md` (note the new aggregation behaviour)
- Modify: `skills/codepatrol-plan/SKILL.md` (note the new aggregation behaviour and the push suggestion)

**Interfaces:** the SKILL files' prose is updated; no API changes.

**Simplicity proof:** documentation only.

**Surface delta:** ~10 lines per file.

**Steps:**

1. Apply: restore the stashed `AGENTS.md` edit (`git stash pop` for the prior stash, then re-apply the same one-line removal of "Remote operations remain out of scope" if the stash has more than that). Update `skills/codepatrol-close/SKILL.md:35` to carve out the opt-in push. Update the other two SKILL files.
2. Run `npm run lint:skills`. Expected: `Skill catalog, frontmatter, dependencies, portability, and relative links are valid.`

**Task result:** append to `apply/journal.md` after T10 lands.

### Final verification

- Run `npm run verify` (typecheck, test, build, smoke:cli, lint:skills). All must pass.
- Manually exercise: start a new Change, transition through plan with two parallel reviewers, consolidate, advance to apply, close with `push: true` (mocked). Confirm the close result carries `pushError: undefined` on success and the suggested `git push origin <target>` line.
- Diff the workspace and confirm only the planned files were touched. Reconcile with the spec's "Expected surface delta" and explain every difference.
- Confirm no `DC-N` trigger was activated; if one was, follow its approved upgrade path.
- Confirm the policy rewrite in `AGENTS.md:94` is consistent with `skills/codepatrol-close/SKILL.md:35`.
- Record residual risks and the rollback path in `apply/journal.md`.

## Rules

- Exact create/modify/delete paths and public interface names are mandatory. Use line locations only when stable enough to help.
- Tasks include enough pseudocode or complete snippets to remove architectural guessing, but may leave local syntax to the implementer when existing patterns are cited precisely.
- Every command has an expected signal, including what a valid red failure looks like.
- Dependencies and file ownership make concurrency safe: T1-T2 own the type/model layer; T3-T5 own the orchestrator; T6-T9 own the close push path; T10 owns the docs.
- Every acceptance criterion is covered; every task points back to purpose and scope.
- No placeholders, mutable checkboxes, execution results, or unconditional commit commands appear in the approved plan.
