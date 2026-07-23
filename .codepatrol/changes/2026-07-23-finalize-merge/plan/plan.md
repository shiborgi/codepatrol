# Plan — Finalize Merge Main

- Work id: `2026-07-23-finalize-merge`
- Governing spec: `spec.md`
- Target baseline: main

## Goal and approach

Extract the Git merge integration logic from `completeFinalization` into a new `closeWork` function. `completeFinalization` will call `closeWork` to fulfill the Finalize commit outcome.

## Global constraints

- Preserve existing fast-forward merge safety checks.
- Maintain existing `GitAdapter` usage.

## Simplicity proof

- Selected rung: direct local change
- Reused capabilities: existing `GitAdapter` methods.
- Forbidden speculative surface: no new external Git commands or configuration.
- Expected surface delta: modify `src/change/orchestrator.ts`.

## Acceptance mapping

| Criterion | Task(s) | Verification |
|---|---|---|
| AC-1 | T1 | manual review of `src/change/orchestrator.ts` |
| AC-2 | T1 | `npm run test` passes, including `change/git.test.ts` |

## Dependency order

`T1`

### T1 — Extract closeWork function

**Purpose:** Satisfies AC-1 and AC-2 by refactoring the merge flow into a dedicated `closeWork` function.

**Depends on:** None

**Files:**

- Modify: `src/change/orchestrator.ts`

**Interfaces:**

- Creates: `async function closeWork(git: GitAdapter, view: ChangeView, terminalCommit: string, tag: string, signal?: AbortSignal): Promise<void>`

**Simplicity proof:** Direct local change to rearrange existing logic.

**Surface delta:** 0 files added; 1 file modified.

**Steps:**

1. In `src/change/orchestrator.ts`, create `closeWork`:
   ```typescript
   async function closeWork(git: GitAdapter, view: ChangeView, terminalCommit: string, tag: string, signal?: AbortSignal): Promise<void> {
     const checkedOutHead = await git.head("HEAD", signal);
     if (checkedOutHead === view.identity.base_commit) {
       await git.mergeFf(tag, signal);
     } else if (checkedOutHead !== terminalCommit) {
       throw new CodepatrolError("TARGET_ADVANCED", "Target changed during Finalize.", 4);
     }
     if (await git.branchExists(view.identity.branch, signal)) {
       await git.deleteBranch(view.identity.branch, terminalCommit, signal);
     }
   }
   ```
2. Update `completeFinalization` to call `closeWork`:
   ```typescript
   if (outcome === "commit") {
     await closeWork(git, view, terminalCommit, tag, signal);
   } else if (outcome === "rollback") {
     const checkedOutHead = await git.head("HEAD", signal);
     if (checkedOutHead !== view.identity.base_commit) throw new CodepatrolError("TARGET_ADVANCED", "Target changed during rollback.", 4);
     if (await git.branchExists(view.identity.branch, signal)) await git.deleteBranch(view.identity.branch, terminalCommit, signal);
   }
   ```
3. Run `npm test`.
   Expected green: tests pass.
4. Run `npm run verify`.
   Expected green: no type or lint errors.

**Task result:** Appended to `apply/journal.md`.
