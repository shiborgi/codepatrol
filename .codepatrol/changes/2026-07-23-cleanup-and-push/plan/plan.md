# Plan — Minor improvements, push option, token count logic, and legacy cleanup

- Work id: `2026-07-23-cleanup-and-push`
- Governing spec: `spec.md`
- Target baseline: main

## Goal and approach

Refactor the token counting logic to measure string character length, renaming all associated fields to `characters` for accuracy. Additionally, remove a legacy CLI test assertion for the old `workflow prime` command.

## Global constraints

Maintain safety floors: ensure backward compatibility or graceful fallbacks if old `.yaml` files still use the `tokens` field. Do not introduce new dependencies.

## Simplicity proof

- Selected rung: direct local change
- Reused capabilities: Existing metric pipeline.
- Forbidden speculative surface: No automatic git push (out of scope per remote-operation rules).
- Expected surface delta: Modify `src/change/types.ts`, `src/change/usage.ts`, `.pi/index.ts`, `src/change/model.ts`, `src/cli/cli.test.ts`.

## Acceptance mapping

| Criterion | Task(s) | Verification |
|---|---|---|
| AC-1 | T1, T2, T3 | Run `npm run typecheck` and `npm run test` for usage metrics. |
| AC-2 | T4 | Run `npm run test` and check for absence of `workflow prime` failure. |

## Dependency order

`T1 → T2 → T3`; `T4` is independent.

### T1 — Type renaming

**Purpose:** Satisfies AC-1 by renaming `tokens` to `characters`.

**Depends on:** None

**Files:**
- Modify: `src/change/types.ts`
- Modify: `src/change/usage.ts`

**Interfaces:**
- Modify: Rename `TokenUsage` to `CharacterUsage`. Rename `RunUsage.tokens` to `RunUsage.characters`. Rename `UsageSummary.tokens` to `UsageSummary.characters`.

**Simplicity proof:** Pure semantic rename.

**Surface delta:** 2 files modified.

**Steps:**
1. In `types.ts`, rename `TokenUsage` to `CharacterUsage`.
2. In `RunUsage`, rename `tokens` to `characters`.
3. In `UsageSummary`, rename `tokens` to `characters`.
4. Update `validateRun` and `aggregateUsage` in `usage.ts` to reference `run.characters` instead of `run.tokens`. Update string literals checking for "tokens.input", etc., to "characters.input".

### T2 — Model event renaming

**Purpose:** Satisfies AC-1 by migrating the event schemas and tests.

**Depends on:** T1

**Files:**
- Modify: `src/change/model.ts`
- Modify: `src/change/change.test.ts`
- Modify: `src/change/git.test.ts`

**Interfaces:**
- Modify: The `recordFromYaml` logic might need to map `tokens` to `characters`. Test fixtures must be updated.

**Simplicity proof:** Update tests to match the new type shapes.

**Surface delta:** 3 files modified.

**Steps:**
1. In `change.test.ts`, `git.test.ts`, and `board.test.ts`, rename `tokens: { ... }` to `characters: { ... }` in all run usage mock objects.
2. Ensure no typescript errors remain in the test suite for `tokens`.

### T3 — Character counting via string length

**Purpose:** Satisfies AC-1 by dropping API usage reading and summing string lengths.

**Depends on:** T2

**Files:**
- Modify: `.pi/index.ts`
- Modify: `.pi/index.test.ts`

**Interfaces:**
- Modify: `sumPiUsage` returns `characters` instead of tokens.

**Simplicity proof:** Iterating messages and summing `message.content?.length` is simpler and matches the spec exactly.

**Surface delta:** 2 files modified.

**Steps:**
1. In `.pi/index.ts` `sumPiUsage`, loop over messages. If `role` is `user` or `system`, add `String(message.content || "").length` to `input`. If `role` is `assistant`, add to `output`.
2. Update the returned object to map these to `characters` fields instead of `totalTokens`.
3. Update `index.test.ts` to assert the correct string length sum.

### T4 — Legacy cleanup

**Purpose:** Satisfies AC-2 by removing dead test code.

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
