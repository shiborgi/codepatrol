# Review — Aggregate parallel review/verify and allow push at close

- Change: `2026-07-24-aggregate-and-push`
- Incoming revision: 1
- Reviewed revision: 1
- Reviewer: opencode (codepatrol-review)
- Evidence date: 2026-07-24T02:50:00.000Z

## Scope and evidence

Files inspected (read-only):

- `.codepatrol/changes/2026-07-24-aggregate-and-push/plan/spec.md` — sha256 `d77ce46b…e035` (matches declared)
- `.codepatrol/changes/2026-07-24-aggregate-and-push/plan/plan.md` — sha256 `e4ac73be…d0f2` (matches declared)
- `.codepatrol/changes/2026-07-24-aggregate-and-push/review/report.md` — none yet (Review attempt 1)

Git reconciliation:

- Branch: `codepatrol/2026-07-24-aggregate-and-push` (HEAD `8de4598d30148f2b5cc4290a62bccb62ee923a8b`)
- Base commit: `d75ff9959f7c8bf14d726896f75c32969240b384` equals `main`
- Working tree clean
- Plan checkpoint: `a91ffe89b4f4ef2ed02f4e39541fd89fdd63285d`
- The user's pre-Change `AGENTS.md` edit (removing "Remote operations remain out of scope.") is in `stash@{0}`, planned to be reapplied at T10 per the user's "incluir na Change nova" choice

Substrate evidence (cited files verified):

- `src/change/types.ts:16-21` — current event shapes: `StageCheckpointedEvent` (line 16) and `StageReturnedEvent` (line 17). Adding `persona?: string` is additive on both. Adding `reasons?: string[]` on `StageReturnedEvent` is additive.
- `src/change/types.ts:42-48` — `TransitionIntent` discriminated union. Adding an optional `persona?: string` to the `checkpoint` and `return` variants is additive.
- `src/change/types.ts:51` — `CloseInput`. Adding `push?: boolean` is additive.
- `src/change/model.ts:67` — the `specific` map listing allowed keys per event subtype. **The Plan's T1 says "validation in `model.ts:assertChangeRecord` already uses `exactKeys` per event subtype; the new field is added to the allowed keys for the two event shapes." This is correct in intent but the implementer must remember to extend the `specific` map for both `stage-checkpointed` (add `persona` to its allowed keys) and `stage-returned` (add `persona` and `reasons`). The Plan could name `model.ts:67` explicitly.**
- `src/change/model.ts:69-115` — `foldChange`'s state machine. The Plan's T2 says to introduce a `summariseAttempt` helper that aggregates sub-events into a single attempt view. **Concrete sub-event recognition requires the helper to look for events on the same attempt where the event has `persona` set OR where multiple events of the same kind exist on the same attempt. The Plan's T2 is correct in intent but does not name the exact discriminator ("`persona` field present" vs "multiple events on the same attempt").**
- `src/change/orchestrator.ts:197-209` — `transitionChangeLocked`. The Plan's T3 adds the persona sub-event and consolidation branches at the top of this function. The bug at line 209 (`intent.stage !== view.stage`) is correctly diagnosed: the first parallel agent's checkpoint advances `view.stage`, breaking the second.
- `src/change/git.ts:7-31` — `GitAdapter` interface. Adding `push(remote, branch, signal)` is additive.
- `src/change/git.ts:58` — `status` method (recently fixed to not trim). The new `push` method should follow the same pattern (no trim, or trim appropriately).
- `src/change/orchestrator.ts:296-353` — `closeChangeLocked`. Adding the push step after the tag creation (line 346) is the correct insertion point. The plan correctly identifies that the push is `git push origin <target_branch>` with no force flag.
- `AGENTS.md:91-94` — the close policy, including the line "Remote operations remain out of scope." that this Change removes. **This is a significant governance carve-out. The Plan replaces it with an opt-in push policy (double-key: `push: true` flag + existing `authority` string; push failure does not abort close).**
- `skills/codepatrol-close/SKILL.md:35` — the "Never fetch, push, rebase, force, resolve conflicts, delete remote refs" line that this Change carves out. The carve-out is symmetric with the `AGENTS.md` change.

Graph impact (computed from this Review session): the Plan's spec.md and plan.md alone have 0 affected files in the graph (they are Change artifacts, not source). The Plan's predicted surface delta (T1-T10) covers ~10 source files; the actual graph blast radius will be computed at Apply time once the source is on disk.

## Findings

### major — contract — `AGENTS.md:94` removal is a governance carve-out, not a refactor

- Location: `spec.md` §"Scope / In scope" (the AGENTS.md bullet) and `plan.md` T10.
- Verified evidence: `AGENTS.md:94` reads "Remote operations remain out of scope." today. The Plan removes this line and adds a "Push at close" subsection that allows `git push origin <target_branch>` from the orchestrator when `CloseInput.push === true`.
- Impact: this is the substantive policy change. The Plan's safeguards (double-key opt-in, no force flag, push failure does not abort close) are good but the carve-out is irreversible at runtime — once a Change sets `push: true`, the orchestrator executes `git push` without further confirmation. There is no "dry-run" mode and no "confirm before push" interactive prompt.
- Why this is a major finding rather than a blocker: the user explicitly asked for this capability through the legitimate codepatrol lifecycle (this Change). The Reviewer's role is to verify technical soundness and surface policy concerns, not to second-guess policy decisions encoded in the spec. The Plan's risk-mitigation table (`spec.md` §"Risks and mitigations") addresses the main concerns. **The Reviewer records this for the user's awareness, not as a block.**
- Required correction: none for approval, but the Plan should add an extra safety: **the `push: true` flag should require an explicit `--push` flag on the CLI as well** (not just in the JSON payload). The current design accepts `push: true` from the JSON input alone, which is fine if the maintainer reads the diff, but a CLI flag is a stronger affordance. This is a recommendation, not a blocker.

### minor — execution — T1 should name `model.ts:67` as the exact edit site

- Location: `plan.md` T1 step 1.
- Verified evidence: `model.ts:67` defines the `specific` map listing allowed keys per event type. The `exactKeys` validation at line 68 rejects any key not in `[...common, ...specific[event.type]]`. The Plan's T1 says "validation in `model.ts:assertChangeRecord` already uses `exactKeys` per event subtype; the new field is added to the allowed keys for the two event shapes." — correct intent, but the implementer must know to update the `specific` map for both `stage-checkpointed` and `stage-returned`.
- Impact: if T1 is implemented without updating the `specific` map, every persona-tagged event will fail `assertChangeRecord` at fold time with "Change record contains unknown field `persona`." This would block AC-1 and AC-2 at runtime.
- Required correction: T1 step 1 should explicitly cite `src/change/model.ts:67` and call out that the `specific` map entries for `stage-checkpointed` and `stage-returned` gain `persona` (and `stage-returned` also gains `reasons`). This is a doc/precision fix that the Apply can implement without returning to Plan.

### minor — execution — T2 should name the discriminator for sub-event detection

- Location: `plan.md` T2 step 1.
- Verified evidence: the current `foldChange` does not look for sub-events. The Plan's T2 introduces a `summariseAttempt` helper, but does not specify how sub-events are distinguished from regular events.
- Impact: the natural discriminator is the new `persona` field (sub-events carry `persona`; consolidation events do not). The Plan should name this explicitly so the implementer does not invent a different discriminator.
- Required correction: T2 step 1 should say: "Group consecutive events of the same kind on the same attempt where at least one event has a non-empty `persona` field as sub-events of a logical attempt." This is a doc/precision fix.

### minor — design — push suggestion is unconditional even when push was already performed

- Location: `plan.md` T8.
- Verified evidence: T8 prints the `Consider: git push origin <target>` line whenever `outcome === "commit"`. T9 then performs the push if `push: true` is set.
- Impact: when `push: true` is set and the push succeeds, the human still sees "Consider: git push..." which is redundant. The suggestion should be conditional on `input.push !== true` (or on `result.pushError === undefined` and `push was attempted`).
- Required correction: T8 should print the suggestion only when the push was NOT auto-performed (i.e., `input.push !== true`). When `push: true` was set, the close result's JSON envelope should report the push outcome in `pushError` instead of the suggestion.

### minor — design — no credential-handling note

- Location: `plan.md` T6 (push primitive) and T9 (push call).
- Verified evidence: T6 adds `GitAdapter.push(remote, branch, signal)`. T9 calls `git push origin <target>`. In CI environments or over SSH, push requires authentication. The Plan does not mention how authentication failures are surfaced.
- Impact: in an environment without credentials configured (e.g., a fresh CI runner without SSH keys), `git push` will fail with an authentication error. The Plan's `result.pushError` captures this, but the failure mode should be called out in the Risks section.
- Required correction: T9's verification step should include a "push fails on missing credentials → `result.pushError` carries the auth error" assertion. Not blocking; just a coverage note.

## Artifact adjustments

| Artifact | Change | Reason | Acceptance criteria affected |
|---|---|---|---|
| `spec.md` | none | spec is decision-complete | AC-1, AC-2, AC-3, AC-4 |
| `plan.md` | none — minor precision updates belong in T1/T2/T8/T9 step descriptions, not in the plan itself | Review never corrects Plan files in place; the four minor findings are bounded precision fixes that the Apply can implement | AC-1, AC-2, AC-3 |

## Acceptance coverage

| Criterion | Spec is unambiguous | Plan task(s) | Verification is red-capable | Result |
|---|---|---|---|---|
| AC-1 — Parallel personas do not prematurely advance the stage; consolidation is explicit | yes | T1, T2, T3, T4 | yes — `node --test --import jiti/register src/change/orchestrator-parallel.test.ts` (new file in T3) covers two-persona + consolidation scenarios; existing tests still pass | covered |
| AC-2 — Divergence returns the stage with a synthesised reason | yes | T1, T2, T3, T5 | yes — `node --test --import jiti/register src/change/orchestrator-parallel.test.ts` covers the fix-first + approve mix; `inspect`'s `Returns` table lists both rows | covered |
| AC-3 — Close step prints a push suggestion and accepts `push: true` for opt-in push | yes (with minor caveat noted in finding 4) | T6, T7, T8, T9, T10 | yes — `node --test --import jiti/register src/change/close-push.test.ts` (new file in T8/T9) covers text-format suggestion, JSON envelope shape, success path, mocked failure path, and `rollback` no-push path | covered |
| AC-4 — All existing tests and gates still green | yes | T1-T10 (each task ends with `npm run verify`; final verification is part of the Plan) | yes — `npm run verify` passes (typecheck, test, build, smoke:cli, lint:skills); 141 prior tests must still pass | covered |

## Simplicity axis

- Selected rung: direct local change (confirmed).
- Safety floor: the Plan's push safeguards (double-key opt-in, no force, push failure does not abort close, no rebase) preserve the existing safety floor. The persona aggregation's `CONSOLIDATION_AFTER_SUBEVENTS` guard prevents the "first persona wins" foot-gun. The `NO_SUBEVENTS_TO_CONSOLIDATE` guard prevents the "consolidation without aggregation" foot-gun. The recovery path extension accepts sub-events so a partial-write recovery still works.
- Surface delta: 1 type field added (`persona?: string` on two event types; `reasons?: string[]` on `StageReturnedEvent`), 1 new `CloseInput` field (`push?: boolean`), 1 new `GitAdapter` method (`push`), 1 orchestrator function extended, 1 new orchestrator function (`pushAtClose`), 3 SKILL.md files updated, 1 `AGENTS.md` section rewritten. No new package, no schema migration. The Plan's surface delta is honest and bounded.

| Category | Location | Removable surface or replacement | Safety/acceptance impact | Disposition |
|---|---|---|---|---|
| reuse | `src/change/session.ts:11` `SessionItem` | session items already support multiple actors and per-persona claims; the new `persona` field on events complements rather than replaces | none | already sufficient |
| built-in | `src/change/types.ts:42-48` `TransitionIntent` | the discriminated union is the right home for the new optional field | none | already sufficient |
| simplify | `AGENTS.md:94` "Remote operations remain out of scope." | the line is replaced by an opt-in push subsection in the same Close section | policy carve-out, documented in the spec's "Risks and mitigations" | required by user request |
| speculative | a separate `codepatrol push` CLI subcommand | the Plan correctly rejected this; the `push: true` flag on `CloseInput` keeps close a single deterministic step | none | rejected (DC-2 covers a future upgrade path) |

Deferred constraints: DC-1 (implicit consolidation vs explicit `consolidate` subcommand), DC-2 (`pushError` semantics vs explicit `codepatrol push` subcommand), DC-3 (persona aggregation for `plan`/`apply`). Each has a known ceiling, observable trigger, and upgrade path.

## Executability audit

- Paths: every cited file exists at the recorded path. New files (`orchestrator-parallel.test.ts`, `close-push.test.ts`) do not exist yet (red).
- Interfaces: T1's two optional fields are additive on existing event types. T3's new branches in `transitionChangeLocked` are bounded to `intent.type === "checkpoint" | "return"` and to `intent.stage === "review" | "verify"`. T6's `push` follows the same shape as `mergeFf`, `tag`, etc. T7's `push?: boolean` is one line. T8/T9 add ~20 lines to `closeChangeLocked`.
- Dependencies: no new package; all new code uses existing patterns (`withWorkspaceLock`, `git.<verb>`, `appendChangeEvent`).
- Commands: each task has a concrete verification step (`npm run typecheck`, `npm run test`, `npm run verify`).
- Rollback: removing the changes reverts `AGENTS.md:94` to the prior clause, removes the `push: true` flag, removes the persona aggregation, and removes the close-time push. The orchestrator returns to its prior single-persona, no-push behaviour. Changes that were started under the new behaviour are unaffected by the rollback.
- Context independence: the spec and plan are self-contained — every cited path, command, and AC trace is in this Review or in the spec/plan.

Unresolved assumption that blocks approval: none. The four findings are bounded precision fixes that the Apply can implement without returning to Plan. The major governance concern is recorded for the user's awareness but is encoded in the spec by the user's request and is not a Review-level block.

## Verdict

`approve`

The Plan is decision-complete, substrate-aligned, and internally consistent. The four acceptance criteria are covered by red-capable tests across T1-T5 (parallel aggregation) and T6-T9 (close push). The five gates (typecheck, test, build, smoke:cli, lint:skills) are part of every task's verification path. The persona aggregation correctly diagnoses the bug at `orchestrator.ts:209` and the fix is bounded to the persona sub-event vs consolidation discriminator. The push capability is well-safeguarded (double-key opt-in, no force, push failure does not abort close). The major finding (governance carve-out at `AGENTS.md:94`) is encoded in the spec by the user's explicit request and is recorded here for visibility, not as a block. The three minor findings (T1's `model.ts:67` precision, T2's discriminator precision, T8's suggestion condition, T9's credential note) are bounded precision fixes that the Apply can implement.

The Change is ready for `codepatrol-apply 2026-07-24-aggregate-and-push on codepatrol/2026-07-24-aggregate-and-push`.

## External evidence sufficiency

`not required` — the Change is internal to the project's harness. The persona aggregation extends the existing event model (additive optional field); the push primitive is a thin wrapper around `git push`. No external protocol or GitHub reference governs this Plan.

## Residual risks and evidence gaps

- Token-metric coverage for this Review run is `0/1` measured (opencode harness); coverage for the whole Change is `0/1` measured so far.
- The four minor findings (model.ts:67 precision, T2 discriminator precision, T8 suggestion condition, T9 credential note) are doc/precision gaps that the Apply can resolve without returning to Plan. They are recorded so the Apply author knows exactly which lines to touch.
- The major finding (AGENTS.md:94 carve-out) is irreversible at runtime. Once a Change ships with `push: true`, the orchestrator performs `git push origin <target>` without further confirmation. The maintainer must be aware of this when reviewing the change. This is documented in the spec's "Risks and mitigations" and in the AGENTS.md edit itself.
- The persona sub-events add a new dimension to the event log (one logical checkpoint can be 1-3 events depending on persona count). External consumers of `change.yaml` that iterate events without filtering by `persona` will see N+1 events per attempt. The orchestrator's `foldChange` masks sub-events in the consumer view (per the spec's "Compatibility and rollout" note). This is a known compat concern for downstream tooling; the spec's Risks section flags it.
- The `git push origin <target>` requires authentication. The Plan does not address credential management; this is out of scope for the harness (the harness runs on a machine with pre-configured credentials, or the maintainer pushes manually). Documented as a minor design note.
- The `AGENTS.md` and `SKILL.md` updates at T10 are doc-only; no behavior change there. The behavior change lives in the orchestrator and CLI input/output.
