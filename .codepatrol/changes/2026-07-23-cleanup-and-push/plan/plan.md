# Plan — Minor improvements, token count logic, actor tracking, and legacy cleanup

- Work id: `2026-07-23-cleanup-and-push`
- Governing spec: `spec.md`
- Target baseline: main

## Goal and approach

Refactor token tracking to use exact string character lengths while correctly renaming all `tokens` fields to `characters` throughout the system. Enrich the tracking payload to include model data in the actor string. Introduce YAML backwards-compatibility for the renamed field. Remove a leftover test for a legacy CLI command.

## Global constraints

Maintain safety floors: ensure backward compatibility for old `.yaml` files using the `tokens` field. Do not execute remote operations like `git push` per project rules.

## Simplicity proof

- Selected rung: direct local change
- Reused capabilities: Existing metric pipeline.
- Forbidden speculative surface: No automatic git push (out of scope per remote-operation rules).
- Expected surface delta: Modify `src/change/types.ts`, `src/change/usage.ts`, `src/change/board.ts`, `src/change/model.ts`, `.pi/index.ts`, `src/cli/cli.test.ts`, plus tests and fixtures.

## Acceptance mapping

| Criterion | Task(s) | Verification |
|---|---|---|
| AC-1 | T1, T2, T3 | Run `npm run typecheck` and `npm run test` across change module. |
| AC-2 | T4 | Verify `actor` string matches expected format in Pi tests. |
| AC-3 | T5 | Run `npm run test` and check for absence of `workflow prime` failure. |

## Dependency order

`T1 → T2 → T3 → T4`; `T5` is independent.

### T1 — Type and core renaming

**Purpose:** Satisfies AC-1 by renaming `tokens` to `characters` across types and aggregators.

**Depends on:** None

**Files:**
- Modify: `src/change/types.ts`
- Modify: `src/change/usage.ts`
- Modify: `src/change/board.ts`

**Interfaces:**
- Modify: Rename `TokenUsage` to `CharacterUsage`. Rename `RunUsage.tokens` to `RunUsage.characters`. Rename `UsageSummary.tokens` to `UsageSummary.characters`.

**Simplicity proof:** Pure semantic rename avoiding misleading approximate metrics.

**Surface delta:** 3 files modified.

**Steps:**
1. In `types.ts`, rename `TokenUsage` to `CharacterUsage`.
2. In `RunUsage`, rename `tokens` to `characters`.
3. In `UsageSummary`, rename `tokens` to `characters`.
4. Update `validateRun` and `aggregateUsage` in `usage.ts` to reference `run.characters`. Update string literals checking for "tokens.input", etc., to "characters.input".
5. Update `src/change/board.ts` line 8 (or where it accesses `usage.tokens.*`) to use `usage.characters.*`.

### T2 — Model event renaming and fixtures

**Purpose:** Satisfies AC-1 by migrating event schemas and test cases.

**Depends on:** T1

**Files:**
- Modify: `src/change/change.test.ts`
- Modify: `src/change/git.test.ts`
- Modify: `src/change/board.test.ts`
- Modify: `src/change/fixtures/committed-change.yaml`
- Modify: `src/change/fixtures/returned-change.yaml`
- Modify: `src/change/fixtures/rolled-back-change.yaml`
- Modify: `src/change/fixtures/active-change.yaml`

**Interfaces:**
- Modify: Test mocks and fixtures use `characters` instead of `tokens`.

**Simplicity proof:** Fixes compiler errors directly caused by T1.

**Surface delta:** 7 files modified.

**Steps:**
1. In the listed `.test.ts` files, rename `tokens: { ... }` to `characters: { ... }` in all run usage mock objects.
2. In the `fixtures/*.yaml` files, rename the literal key `tokens:` to `characters:`.

### T3 — YAML parsing backward compatibility

**Purpose:** Satisfies AC-1 by mitigating the risk of crashing on older workspaces.

**Depends on:** T2

**Files:**
- Modify: `src/change/model.ts`

**Interfaces:**
- Modify: `recordFromYaml` injects a migration shim.

**Simplicity proof:** Simple structural mapping during read prevents the need for a global data migration script.

**Surface delta:** 1 file modified.

**Steps:**
1. In `src/change/model.ts`, update `recordFromYaml`.
2. Iterate over `events` in the parsed object. If an event has a `run.tokens` key, mutate it to `run.characters` and delete `run.tokens`.

### T4 — Character counting and Actor tracking

**Purpose:** Satisfies AC-1 and AC-2 by decoupling from API usage and enriching the actor field.

**Depends on:** T3

**Files:**
- Modify: `.pi/index.ts`
- Modify: `.pi/index.test.ts`

**Interfaces:**
- Modify: `sumPiUsage` returns character counts. Intent actor is formatted with model.

**Simplicity proof:** Character arithmetic is direct. Actor string formatting requires zero interface changes elsewhere.

**Surface delta:** 2 files modified.

**Steps:**
1. In `.pi/index.ts` `sumPiUsage`, loop over messages. Keep tracking `message.model`. If `role` is `user` or `system`, add `String(message.content || "").length` to `input`. If `role` is `assistant`, add to `output`.
2. Update the returned object to map these sums to `characters` fields. Stop pulling `.usage`.
3. In `codepatrol_record_run`, update the `intent` definition to set `actor: \`pi (${active.usage.model || "unknown"})\``.
4. Update `index.test.ts` to assert the correct string length sums and actor string formatting.

### T5 — Legacy cleanup

**Purpose:** Satisfies AC-3 by removing dead test code.

**Depends on:** None

**Files:**
- Modify: `src/cli/cli.test.ts`

**Interfaces:**
- Deletes obsolete test line.

**Simplicity proof:** Deletion of an unused block.

**Surface delta:** 1 file modified.

**Steps:**
1. Delete the `legacy` block in `src/cli/cli.test.ts` that tests `run(["workflow", "prime", ...])`.
2. Run `npm run test` to verify `cli.test.ts` continues to pass cleanly.
