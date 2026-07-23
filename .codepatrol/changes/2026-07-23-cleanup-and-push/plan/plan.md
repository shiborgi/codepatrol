# Plan — Minor improvements, push option, token count logic, and legacy cleanup

- Work id: `2026-07-23-cleanup-and-push`
- Governing spec: `spec.md`
- Target baseline: main

## Goal and approach

Amend governance to support an optional git push in the `close` step, introduce a character-based token approximation in the Pi extension, include harness/model in the actor string, and remove legacy `workflow prime` test leftovers.

## Global constraints

Maintain safety floors: do not break existing YAML `change.yaml` fixture compatibility. Do not push unless a terminal commit succeeds.

## Simplicity proof

- Selected rung: direct local change
- Reused capabilities: Existing metric pipeline and Git layer.
- Forbidden speculative surface: No automatic git push unless explicitly requested.
- Expected surface delta: Modify `AGENTS.md`, `skills/codepatrol-close/SKILL.md`, `src/change/git.ts`, `src/change/orchestrator.ts`, `.pi/index.ts`, `src/cli/cli.test.ts`.

## Acceptance mapping

| Criterion | Task(s) | Verification |
|---|---|---|
| AC-1 | T1, T2, T3 | Check docs and verify `npm run test` on `git.test.ts`. |
| AC-2 | T4 | Verify token metrics match `Math.ceil(chars / 4)`. |
| AC-3 | T5 | Check `actor` payload in `run-recorded` tests. |
| AC-4 | T6 | Run `npm run test` and check for absence of `workflow prime` failure. |

## Dependency order

`T1 → T2 → T3`; `T4` and `T5` modify the same file and should be grouped; `T6` is independent.

### T1 — Governance amendment

**Purpose:** Satisfies AC-1 by legally permitting remote push operations.

**Depends on:** None

**Files:**
- Modify: `AGENTS.md`
- Modify: `skills/codepatrol-close/SKILL.md`

**Interfaces:**
- N/A

**Simplicity proof:** Pure text modification.

**Surface delta:** 2 docs modified.

**Steps:**
1. In `AGENTS.md`, alter "Remote operations remain out of scope" to explicitly allow pushing the target branch upon Close.
2. In `skills/codepatrol-close/SKILL.md`, amend "never fetch, push" to allow conditional pushes if the user payload requests it.

### T2 — GitAdapter Push

**Purpose:** Satisfies AC-1 by providing a push method.

**Depends on:** None

**Files:**
- Modify: `src/change/git.ts`

**Interfaces:**
- Produces: `push(branch: string, signal?: AbortSignal): Promise<void>` in `GitAdapter`

**Simplicity proof:** Add standard `git push origin <branch>` execution.

**Surface delta:** 1 file modified.

**Steps:**
1. Add `push` to the `GitAdapter` interface and `NodeGitAdapter`.
2. Ensure it runs `["push", "origin", branch]`.

### T3 — Close step push option

**Purpose:** Satisfies AC-1 by conditionally pushing after commit.

**Depends on:** T2

**Files:**
- Modify: `src/change/types.ts`
- Modify: `src/change/orchestrator.ts`

**Interfaces:**
- Modify: `CloseInput` adds `push?: boolean`.

**Simplicity proof:** Minimal branching logic in `completeFinalization`.

**Surface delta:** 2 files modified.

**Steps:**
1. Add `push?: boolean` to `CloseInput` in `types.ts`.
2. In `orchestrator.ts` `completeFinalization`, if `outcome === "commit"` and `push` is true, call `git.push(view.identity.target_branch, signal)`.

### T4 — Token approximation and Actor tracking

**Purpose:** Satisfies AC-2 and AC-3 by decoupling from API usage and enriching the actor field.

**Depends on:** None

**Files:**
- Modify: `.pi/index.ts`
- Modify: `.pi/index.test.ts`

**Interfaces:**
- Modify: `sumPiUsage` estimates tokens. `codepatrol_record_run` modifies intent `actor`.

**Simplicity proof:** Arithmetic estimation is safer than sweeping schema renames. String interpolation for actor is trivial.

**Surface delta:** 2 files modified.

**Steps:**
1. In `sumPiUsage`, measure `String(message.content || "").length` instead of `.usage`. Add to `inputChars` (user/system) and `outputChars` (assistant).
2. Return tokens as `Math.ceil(inputChars / 4)` and `Math.ceil(outputChars / 4)`.
3. In `codepatrol_record_run`, build the `actor` string: `` `pi (${active.usage.model || "unknown"})` `` and use this in the `TransitionIntent`.
4. Update `index.test.ts` to match these new arithmetic rules and actor string formats.

### T5 — Legacy cleanup

**Purpose:** Satisfies AC-4 by removing dead test code.

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
