# Plan — Minor improvements, push option, token count logic, and legacy cleanup

- Work id: `2026-07-23-cleanup-and-push`
- Governing spec: `spec.md`
- Target baseline: main

## Goal and approach

Introduce a push option during the `close` step, switch token counting to use character lengths instead of API tokens, and perform a comprehensive legacy cleanup of code and skills.

## Global constraints

Maintain safety floors: do not break existing test coverage; ensure git push only happens after a successful commit.

## Simplicity proof

- Selected rung: direct local change
- Reused capabilities: Existing git execution layer and Pi extension layer.
- Forbidden speculative surface: No new CLI arguments for push yet, just adding the underlying capability and testing it. (The CLI can pass it via JSON).
- Expected surface delta: Modifying `src/change/types.ts`, `src/change/git.ts`, `src/change/orchestrator.ts`, `.pi/index.ts`. Deleting unused skills and dead code.

## Acceptance mapping

| Criterion | Task(s) | Verification |
|---|---|---|
| AC-1 | T1, T2 | Check `close` works with push. |
| AC-2 | T3 | Check token usage metric reflects character length. |
| AC-3 | T4 | Verify `skills/` and `src/` for unused code. |

## Dependency order

`T1 → T2`; `T3` is independent; `T4` is independent.

### T1 — Git push capability

**Purpose:** Satisfies AC-1 by allowing git pushes.

**Depends on:** None

**Files:**
- Modify: `src/change/git.ts`

**Interfaces:**
- Produces: `push(branch: string, signal?: AbortSignal): Promise<void>` in `GitAdapter`

**Simplicity proof:** Add standard `git push origin <branch>` execution.

**Surface delta:** 1 file modified.

**Steps:**
1. Add `push` to the `GitAdapter` interface and implementation.
2. Ensure it runs `["push", "origin", branch]`.

### T2 — Close step push option

**Purpose:** Satisfies AC-1 by conditionally pushing after commit.

**Depends on:** T1

**Files:**
- Modify: `src/change/types.ts`
- Modify: `src/change/orchestrator.ts`

**Interfaces:**
- Modify: `CloseInput` adds `push?: boolean`.

**Simplicity proof:** Minimal branching logic in `completeFinalization`.

**Surface delta:** 2 files modified.

**Steps:**
1. Add `push?: boolean` to `CloseInput` in `types.ts`.
2. In `orchestrator.ts`, if `push` is true and outcome is `commit`, call `git.push(view.identity.target_branch, signal)` inside or after `completeFinalization`.

### T3 — Token counting via character length

**Purpose:** Satisfies AC-2 by ignoring LLM API tokens and using character counts.

**Depends on:** None

**Files:**
- Modify: `.pi/index.ts`

**Interfaces:**
- Modify: `sumPiUsage`

**Simplicity proof:** Replace property access with `message.content?.length`.

**Surface delta:** 1 file modified.

**Steps:**
1. In `sumPiUsage`, iterate messages. If role is `user` or `system`, add `String(message.content || "").length` to `input`. If role is `assistant`, add to `output`.
2. `total` becomes `input + output`.
3. Stop reading `message.usage`.

### T4 — Legacy cleanup

**Purpose:** Satisfies AC-3 by evaluating and deleting obsolete files/code.

**Depends on:** None

**Files:**
- Modify: `skills/` (delete obsolete skills)
- Modify: `src/` (clean up unused exports or old method names)

**Interfaces:**
- Deletes obsolete internal functions or unused skills.

**Simplicity proof:** Pure deletion and rename to lean down the codebase.

**Surface delta:** Multiple files potentially modified or deleted.

**Steps:**
1. Scan `skills/catalog.yaml` vs directory contents. Delete skills not listed or no longer useful.
2. Run a full codebase lint/typecheck to find unused methods/variables.
3. Remove old code patterns or refactor leftovers.
