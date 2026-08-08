import { join } from "node:path";

const CHANGE_TYPE = "codepatrol-change";

export interface ChangeEvidence {
  type: typeof CHANGE_TYPE;
  baseRef: string;
  baseCommit: string;
  headRef: string;
  candidateCommit: string;
  worktree?: string;
  changedPaths?: string[];
  commitCount?: number;
}

export function changeBranchOf(workId: string): string {
  return `codepatrol/${workId}`;
}

export function changeHeadRefOf(workId: string): string {
  return `refs/heads/codepatrol/${workId}`;
}

export function changeWorktreePathOf(repoRoot: string, workId: string): string {
  return join(repoRoot, "..", ".codepatrol-worktrees", workId);
}

export type CleanupOutcome = "accepted" | "rolled-back" | "failed" | "under-investigation";

export interface CleanupPolicy {
  removeWorktree: boolean;
  removeBranch: boolean;
}

export function changeCleanupPolicy(outcome: CleanupOutcome): CleanupPolicy {
  switch (outcome) {
    case "accepted":
      return { removeWorktree: true, removeBranch: true };
    case "rolled-back":
      return { removeWorktree: true, removeBranch: false };
    case "failed":
      return { removeWorktree: false, removeBranch: false };
    case "under-investigation":
      return { removeWorktree: false, removeBranch: false };
  }
}

export interface ChangedPathsComparison {
  match: boolean;
  onlyReported: string[];
  onlyObserved: string[];
}

export function compareChangedPaths(reported: string[] | undefined, observed: string[]): ChangedPathsComparison {
  const r = canonicalPaths(reported ?? []);
  const o = canonicalPaths(observed);
  const onlyReported = r.filter((p) => !o.includes(p));
  const onlyObserved = o.filter((p) => !r.includes(p));
  return { match: onlyReported.length === 0 && onlyObserved.length === 0, onlyReported, onlyObserved };
}

function canonicalPaths(paths: string[]): string[] {
  return [...new Set(paths)].sort();
}
