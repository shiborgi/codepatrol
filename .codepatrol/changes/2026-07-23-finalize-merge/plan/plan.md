# Plan — Finalize Merge Main

- Work id: `2026-07-23-finalize-merge`
- Governing spec: `spec.md`
- Target baseline: main

## Goal and approach

Extract the Git merge integration logic for the commit outcome into a new `closeWork` function. `completeFinalization` will retain all pre-merge safety checks and post-merge state verification, but will call `closeWork` to execute the actual fast-forward merge and feature branch deletion.

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
| AC-1 | T1 | existing `src/change/git.test.ts` cases |
| AC-2 | T1 | `npm run test` passes |

## Dependency order

`T1`

### T1 — Extract closeWork function

**Purpose:** Satisfies AC-1 and AC-2 by refactoring the merge flow into a dedicated `closeWork` function without losing safety checks.

**Depends on:** None

**Files:**

- Modify: `src/change/orchestrator.ts`

**Interfaces:**

- Creates: `async function closeWork(git: GitAdapter, view: ChangeView, tag: string, terminalCommit: string, signal?: AbortSignal): Promise<void>`

**Simplicity proof:** Direct local change to rearrange existing logic.

**Surface delta:** 0 files added; 1 file modified.

**Steps:**

1. Run `npx node --test src/change/git.test.ts`.
   Expected green: tests currently pass (this acts as our characterization baseline).
2. In `src/change/orchestrator.ts`, add the new `closeWork` function below `completeFinalization`:
   ```typescript
   async function closeWork(git: GitAdapter, view: ChangeView, tag: string, terminalCommit: string, signal?: AbortSignal): Promise<void> {
   	const checkedOutHead = await git.head("HEAD", signal);
   	if (checkedOutHead === view.identity.base_commit) await git.mergeFf(tag, signal);
   	else if (checkedOutHead !== terminalCommit) throw new CodepatrolError("TARGET_ADVANCED", "Target changed during Finalize.", 4);
   	if (await git.branchExists(view.identity.branch, signal)) await git.deleteBranch(view.identity.branch, terminalCommit, signal);
   }
   ```
3. Update `completeFinalization` in `src/change/orchestrator.ts` to call `closeWork` for the commit outcome, explicitly keeping all surrounding safety checks:
   ```typescript
   async function completeFinalization(git: GitAdapter, view: ChangeView, outcome: FinalizeInput["outcome"], tag: string, terminalCommit: string, signal?: AbortSignal): Promise<void> {
   	const targetHead = await git.head(view.identity.target_branch, signal);
   	if (outcome === "rollback" && targetHead !== view.identity.base_commit) throw new CodepatrolError("TARGET_ADVANCED", `Rollback target advanced from ${view.identity.base_commit} to ${targetHead}.`, 4);
   	if (outcome === "commit" && targetHead !== view.identity.base_commit && targetHead !== terminalCommit) throw new CodepatrolError("TARGET_ADVANCED", `Commit target is neither the recorded base nor terminal commit: ${targetHead}.`, 4);
   	const current = await git.currentBranch(signal);
   	if (current !== view.identity.branch && current !== view.identity.target_branch) throw new CodepatrolError("CHANGE_CONFLICT", `Finalize recovery found unrelated branch ${current}.`, 4);
   	if (current !== view.identity.target_branch) await git.checkout(view.identity.target_branch, signal);
   	
   	if (outcome === "commit") {
   		await closeWork(git, view, tag, terminalCommit, signal);
   	} else if (outcome === "rollback") {
   		const checkedOutHead = await git.head("HEAD", signal);
   		if (checkedOutHead !== view.identity.base_commit) throw new CodepatrolError("TARGET_ADVANCED", "Target changed during rollback.", 4);
   		if (await git.branchExists(view.identity.branch, signal)) await git.deleteBranch(view.identity.branch, terminalCommit, signal);
   	}
   	
   	if (parseStatusPaths(await git.status(signal)).length) throw new CodepatrolError("CHANGE_CONFLICT", "Finalize postcondition requires a clean worktree.", 4);
   }
   ```
4. Run `npx node --test src/change/git.test.ts`.
   Expected green: tests pass. Specifically, test cases on lines 134, 144, 213, 240, 241 must still pass. This proves we retained the red-capable checks that ensure we don't merge with drift.
5. Run `npm run verify`.
   Expected green: all pipeline steps pass.

**Task result:** Appended to `apply/journal.md`.
