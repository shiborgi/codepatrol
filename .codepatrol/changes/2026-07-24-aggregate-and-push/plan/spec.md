# Specification — Aggregate parallel review/verify and allow push at close

## Intent

- Origin: improve-codebase
- Mode: feature
- Target baseline: main at `d75ff9959f7c8bf14d726896f75c32969240b384` (after `2026-07-23-self-improvement-tracing` Close)
- Governing constraints: the change is bounded by the existing lifecycle (Plan → Review → Apply → Verify → Close); no schema break in `ChangeRecordV2` v2. The `AGENTS.md:94` clause "Remote operations remain out of scope" is removed by this Change; replaced with an explicit opt-in push policy under close authority.
- Substrate state: graph revision present; wiki state absent.
- Problem: when two or more reviewer/verifier personas work in parallel against the same `review` or `verify` attempt, the first one to call `change transition --type checkpoint` advances `view.stage` to the next stage. Subsequent parallel agents then see `view.stage !== intent.stage` and the orchestrator throws `Expected <X>, received <Y>` (orchestrator.ts:209). The parallel agents fail mid-flight and the human (or coordinator) is left to consolidate manually. Separately, the close step never reminds the maintainer that the verified candidate has not been pushed to `origin`, and the harness policy in `AGENTS.md:94` plus `skills/codepatrol-close/SKILL.md:35` hard-bans push, so a maintainer must always run `git push` outside the harness.
- Outcome: parallel reviewer/verifier personas all complete before the stage advances; persona verdicts are recorded as sub-events so divergence is detectable; if any persona returned a defect, the stage returns to the prior stage (`review` → `plan`, `verify` → `apply`) so the implementer can address every persona's findings before re-running review/verify. Separately, after a successful `close` outcome the close step prints an explicit `git push origin <target>` suggestion, and accepts an opt-in `push: true` flag on `CloseInput` that performs the push (with the policy carve-out in `AGENTS.md` and `skills/codepatrol-close/SKILL.md`).

## Scope

### In scope

- Orchestrator behaviour: when `transitionChange` is called with `intent.type === "checkpoint"` and the stage is `review` or `verify`, detect whether the current attempt has more than one closed session item (parallel personas) or whether the most recent events on the attempt are sub-events of the same logical checkpoint. In that case, record the persona verdict as a sub-event without advancing `view.stage`. The state advances only when a final "consolidation" intent (a `checkpoint` for the same stage that has no persona field) is recorded. The orchestrator enforces "all session items for the current attempt must be `closed`" before allowing the consolidation.
- New event shape: add an optional `persona?: string` field to `StageCheckpointedEvent` and `StageReturnedEvent`. When present, the event is a sub-event of the current attempt; the attempt's `status` and `result` are derived from the union of sub-events (any `returned` sub-event → attempt is `returned`; otherwise the last `checkpointed` sub-event's result wins). The existing `ChangeRecordV2` v2 schema gains the optional `persona` field; old records that lack the field still validate.
- Return-on-divergence: if any persona's checkpoint sub-event has `result: "fix-first"` (or returns with `to_stage: "plan"` / `to_stage: "apply"`), the consolidation records a `stage-returned` event for the current stage with the persona's reason aggregated. The agent(s) at the next stage are given a list of all persona findings (one `Returns` row per persona). This makes "divergence" visible: any persona's `fix-first` flips the stage to `returned`.
- `AGENTS.md`: drop the "Remote operations remain out of scope." line. Add a new "Push at close" subsection that defines the opt-in policy: push is allowed only at the close stage, only with `push: true` on `CloseInput`, only with the recorded explicit authority string, and only when the candidate binding is intact.
- `skills/codepatrol-close/SKILL.md`: update the "Never fetch, push, rebase, force, resolve conflicts, delete remote refs" line to carve out `git push origin <target>` when the close `outcome` is `commit`, `push: true` is set, and the target branch exists on `origin`. The skill body documents the suggested `git push` line for the human (always printed) and the auto-push path (when the flag is set).
- `skills/codepatrol-apply/SKILL.md` and `skills/codepatrol-plan/SKILL.md`: minor doc updates to mention the new aggregation behaviour and the push suggestion, in the same register as the prior `parallel-review` Change's T1/T2/T3.

### Out of scope

- No `git push --force` or `git push --force-with-lease`. The opt-in push is `git push origin <target>` with no force flag.
- No `git fetch`. The opt-in push does not refetch the remote; if the remote has advanced, the push will be rejected and the close step will surface the error.
- No auto-push on `rollback` outcome. Rollback leaves the target tree unchanged; the human decides whether to push.
- No rebase, no conflict resolution. The push fails fast on rejection; the maintainer handles.
- No multi-remote. The push is always `origin <target_branch>`.
- No schema migration tool. Old records (without `persona`) validate unchanged.
- No aggregation of `verify`'s `commit` / `improve` verdicts across personas at the verify stage in a single attempt beyond what's listed in the In scope section. The verify-stage consolidation follows the same rule (any persona `improve` → stage returns to apply) but is otherwise the same mechanism.

## Current evidence

- `src/change/orchestrator.ts:197-210` — `transitionChangeLocked` reads the current `view`, then asserts `intent.stage !== view.stage` at line 209. A second parallel checkpoint with the same `intent.stage` finds `view.stage` already advanced (e.g., to `apply`) and throws.
- `src/change/session.ts:11` — `SessionItem { id, title, status, dependencies, claim, result, artifacts }`. The session is the right place to record per-persona claims.
- `src/change/orchestrator.ts:188-194` — `assertCurrentBranch` is called at the start of every transition; the recovery path at line 202-207 only allows `relativeRecord(workId)` as a status path. The recovery path is the only place where the orchestrator is currently idempotent for "another agent has progressed the state" — but it requires the previous intent to be a literal match.
- `src/change/types.ts:16-25` — current event shapes: `StageCheckpointedEvent { type, result, checkpoint, tree, artifacts, next_action, ... }`. The optional `persona` field is additive.
- `AGENTS.md:92-94` — close policy: "Close requires new explicit authority, Verify `commit`, unchanged target and a clean tree. Commit is fast-forward-only. Rollback proves the target tree unchanged. Create the recoverable terminal tag before deleting the feature branch. Remote operations remain out of scope."
- `skills/codepatrol-close/SKILL.md:35` — "On target advance, dirty state, conflict or partial failure, stop with the exact reported recovery action. Never fetch, push, rebase, force, resolve conflicts, delete remote refs or edit production code."
- `src/change/orchestrator.ts:296-353` — `closeChangeLocked` already writes a receipt and a tag and (after the `self-improvement-tracing` Change) an improvement report + mirror. The new push step slots after the tag creation and before `completeFinalization` returns control to the caller.

## Proposed design

1. **Persona sub-events**: add `persona?: string` to `StageCheckpointedEvent` and `StageReturnedEvent` in `src/change/types.ts`. Validation in `model.ts` accepts the optional field; absence is the default.
2. **Parallel aggregation in `transitionChangeLocked`**: when `intent.type === "checkpoint"` and `intent.stage` is `review` or `verify` and the current attempt is in the `active` state and a parallel persona field is present on the intent (or the `view` shows prior persona-tagged events for the same attempt), record a sub-event with the persona and the result, and do NOT advance `view.stage`. The attempt's `status` is recomputed: any persona with `result: "fix-first"` (or `to_stage` set) marks the attempt as `returned`; otherwise the attempt remains `active` until a consolidation intent arrives.
3. **Consolidation intent**: a `checkpoint` for the same stage with no persona field is treated as a consolidation. The orchestrator asserts that every session item for the current attempt is in `status: "closed"` and at least one sub-event has been recorded. The consolidation records a normal `stage-checkpointed` event and advances `view.stage`. The consolidation's `result` is derived from the persona sub-events (any `fix-first` → `fix-first`; otherwise the last sub-event's `approve`/`commit` wins).
4. **Return-on-divergence**: if the consolidation result is `fix-first` (or any persona returned), the orchestrator records a `stage-returned` event (with a synthesised reason that lists every persona's `reason`). The next-stage agent (Plan for `review` → `plan`, Apply for `verify` → `apply`) reads all `Returns` rows in the report.
5. **Close-time push hint**: `closeChangeLocked` writes a trailing section to its `text` result (for `--format=text`) and a top-level `pushSuggestion: "git push origin <target>"` field in the JSON envelope. The hint is unconditional; the maintainer can copy it.
6. **Close-time opt-in push**: `CloseInput` gains an optional `push?: boolean` field. When `true` and `outcome === "commit"`, the orchestrator calls `git.push(view.identity.target_branch, options.signal)` (a new `GitAdapter.push` method) AFTER the tag is created and BEFORE `completeFinalization`. The push output is captured and surfaced in the close result. If the push fails, the close still returns successfully (the local commit is intact and tagged) but the result includes `pushError`.
7. **Policy text updates**: `AGENTS.md:94` drops the "Remote operations remain out of scope" line and adds a "Push at close" subsection that documents the opt-in flag and the failure mode (push failure does not abort close; the local tag is the source of truth). `skills/codepatrol-close/SKILL.md:35` rewrites the "Never fetch, push, ..." line to carve out the opt-in push.
8. **Doc updates**: `skills/codepatrol-apply/SKILL.md` and `skills/codepatrol-plan/SKILL.md` add a one-paragraph note about the new aggregation behaviour and the push suggestion. Same register as the prior `parallel-review` Change.

## Alternatives

- "Lock the workspace with a global lock during every transition" — rejected because the orchestrator already uses `withWorkspaceLock("change-git", ...)` per change. The bug is not lack of locking; it's that the state advances after the first persona instead of waiting for all.
- "Use a dedicated `consolidate` subcommand for parallel reviews" — rejected because the user-facing ergonomics are worse than adding a `persona` field. The persona field is invisible until used; the consolidate intent is the same `change transition --type checkpoint` for any agent.
- "Wait for N parallel agents before consolidating, where N is declared in the plan" — rejected because it forces the plan to know the parallel count up front. The session items are the right place to record "all expected personas are closed" without coupling to a count.
- "Add a `git push` CLI subcommand separate from `change close`" — rejected because it spreads the close semantics across two commands. The `push: true` flag keeps the close a single deterministic step.
- "Keep `AGENTS.md:94` intact and add a new section that says 'push is opt-in via `push: true`'" — equivalent in effect to the chosen design; the chosen design is more honest about the carve-out.

## Simplicity decision

- Selected rung: direct local change.
- Earlier rungs: the data model already supports multiple session items per attempt; the durable event log already has per-event fields; the orchestrator already calls a single `transitionChangeLocked` per CLI call. There is no lower rung.
- Irreducible complexity: the orchestrator must distinguish a parallel persona's checkpoint from a final consolidation, both of which arrive through the same `change transition --type checkpoint --result approve|fix-first` CLI surface. The distinction is the `persona` field on the intent payload.
- Safety floor: the new `push: true` flag requires explicit `authority` (already required) plus the flag in the input — double-key opt-in. The push failure does not abort close; the local tag is recoverable. `git push --force` is never used; the harness never invents force flags.
- Expected surface delta: 1 type field added (`persona?` on two event types), 1 orchestrator function modified (`transitionChangeLocked`), 1 new function (`pushAtClose` in `closeChangeLocked`), 1 new CLI input field (`CloseInput.push?: boolean`), 1 new `GitAdapter` method (`push`), 3 SKILL.md files updated, 1 `AGENTS.md` section rewritten. No new package, no schema migration.

## Deferred constraints

| ID | Chosen simplification | Known ceiling | Observable trigger | Upgrade path |
|---|---|---|---|---|
| DC-1 | Consolidation is implicit (a checkpoint with no `persona`); no explicit `consolidate` subcommand | Power-users may want to see "consolidating" in the CLI surface | A user asks for a `change transition --type consolidate` subcommand | Add the explicit subcommand; the implicit path remains the default for backwards compat. |
| DC-2 | Push failure does not abort Close; the close result carries `pushError` separately | A maintainer who only checks the close result (not `pushError`) might think the push succeeded | A maintainer reports that a push silently failed | Add a separate `codepatrol push` CLI subcommand that requires explicit acknowledgement of `pushError` before returning 0. |
| DC-3 | Persona aggregation only applies to `review` and `verify`; `plan` and `apply` are still single-persona | A future Change might want parallel `plan` (e.g., spec + plan co-design) | A user requests parallel `plan` | Generalise the persona hook to all stages; track per-attempt persona count. |

## Compatibility and rollout

- Compatible: old change records (without `persona`) validate unchanged. Old CLI invocations (without `push: true`) behave exactly as before. The new aggregation path is gated on the new `persona` field being present.
- The `AGENTS.md` carve-out only takes effect after this Change is Closed and committed. Until then, the harness's policy is "Remote operations remain out of scope" and push is rejected by every skill.
- No migration is required: the `persona` field is optional in the new event shape; old records keep working.
- Rollback: removing the changes reverts `AGENTS.md:94` to "Remote operations remain out of scope", removes the `push: true` flag handling, and removes the parallel aggregation. The orchestrator returns to its prior single-persona behaviour for any Change started after the rollback. Changes that were started under the new behaviour are unaffected by the rollback (their state machine is recorded in their `change.yaml`).

## Risks and mitigations

- Risk: a parallel reviewer that doesn't know about the new persona convention runs a plain `change transition --type checkpoint --result approve` first and is interpreted as a "consolidation" by the orchestrator (no persona field → consolidation). This advances the state and the other parallel agents then fail.
  - Mitigation: the orchestrator, when it sees a `checkpoint` for the same stage attempt that already has persona sub-events, refuses the no-persona checkpoint with `CodepatrolError("CONSOLIDATION_AFTER_SUBEVENTS", ...)`. The error message tells the agent to set `persona` on its intent.
- Risk: the `push: true` flag is set by mistake on `rollback`, causing an unintended push.
  - Mitigation: the orchestrator only performs push when `outcome === "commit"`. Rollback is a no-push path.
- Risk: the `git push` is rejected because `origin` has advanced; the close result carries `pushError` but the local commit is intact.
  - Mitigation: the close result surfaces the error; the maintainer can resolve. The local tag `codepatrol/committed/<work-id>` is the recoverable artifact; the maintainer can re-push after rebasing locally (a manual step outside the harness).
- Risk: the persona sub-events add noise to the change record. An external consumer that iterates events without filtering sees N+1 events per attempt.
  - Mitigation: the new event types are documented; consumers that want the "logical" view can filter by `persona` undefined (consolidations only). The orchestrator's `foldChange` already returns an attempt summary that masks sub-events; this is unchanged.
- Risk: re-applying the AGENTS.md and SKILL.md edits that were stashed during the prior Plan attempt. The user confirmed that this Change's Apply should re-apply the `AGENTS.md:94` carve-out. The stashed diff is restored to the working tree at the start of Apply; the apply `changes` list declares `AGENTS.md`.

## Acceptance criteria

- AC-1: With two `change session prime/claim` calls opening `review-security` and `review-architecture` items, two parallel `change transition --type checkpoint --stage review --result approve --persona review-security` and `--persona review-architecture` invocations both succeed without error; `view.stage` remains `review`; the `change.yaml` has two persona sub-events plus zero `stage-checkpointed` events. A subsequent `change transition --type checkpoint --stage review --result approve` (no `persona`) consolidates: the attempt's `status` becomes `completed`, `result` is `approve`, `view.stage` becomes `apply`, and a single `stage-checkpointed` event is recorded.
- AC-2: With one parallel persona returning `fix-first` and another returning `approve`, the consolidation records a `stage-checkpointed` event with `result: "fix-first"` and a `stage-returned` event with `to_stage: "plan"` and a synthesised reason that lists both personas' reasons. `view.stage` becomes `plan`. The next Plan reads both `Returns` rows from the report.
- AC-3: After a successful `close --outcome commit`, the close step's `--format=text` output ends with a line `Consider: git push origin main` (or the target branch). With `push: true` set in the `CloseInput` JSON, the orchestrator calls `git push origin <target>` after the tag is created; the close result's JSON envelope carries `pushError: undefined` on success or `pushError: { code, message }` on failure. The local tag `codepatrol/committed/<work-id>` always exists regardless of push outcome.
- AC-4: `npm run verify` (typecheck, test, build, smoke:cli, lint:skills) passes. The 141 existing tests still pass; new tests for the parallel aggregation path pass; the kanban render still emits the `~c` suffix.

## Decisions and open questions

- Settled: the `persona` field is the discriminator between a parallel sub-event and a final consolidation. The default (no `persona`) is "consolidation" for backward compatibility.
- Settled: the `push: true` flag is double-key opt-in (the existing `authority` string + the new flag). The push failure does not abort close; the local tag is the source of truth.
- Settled: re-applying the `AGENTS.md:94` carve-out that was stashed during this Plan is part of this Change's Apply scope.
- Open question: should the close step also surface a `prURL` after a successful `gh pr create`? Out of scope for this Change; would require a separate Change that integrates with `gh`.
- No open question blocks Plan checkpoint.
