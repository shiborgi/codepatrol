import { realpathSync } from "node:fs";
import { type CleanupPolicy, changeBranchOf, changeHeadRefOf, changeWorktreePathOf } from "../core/change.js";
import { fail } from "../core/errors.js";
import { GitCheckout } from "./checkout.js";
import type { Git } from "./git.js";

export interface EnsureResult {
  baseCommit: string;
  headRef: string;
  worktreePath: string;
}

export interface CandidateObservation {
  candidateCommit: string;
  changedPaths: string[];
  commitCount: number;
  clean: boolean;
  changes: string[];
}

export interface WorktreeObservation {
  path: string;
  head: string;
  branch: string | undefined;
  isBare: boolean;
}

export interface ChangeInspection {
  branch: string;
  branchExists: boolean;
  branchHead: string | undefined;
  headRef: string;
  worktreePath: string;
  worktreeExists: boolean;
  worktrees: WorktreeObservation[];
  conflictingWorktreePaths: string[];
}

export interface ChangePort {
  ensure(workId: string, baseRef: string): Promise<EnsureResult>;
  observeCandidate(worktreePath: string, baseCommit: string, headRef: string): Promise<CandidateObservation>;
  inspect(workId: string): Promise<ChangeInspection>;
  cleanup(workId: string, policy: CleanupPolicy): Promise<{ warnings: string[] }>;
}

export class GitChangeManager implements ChangePort {
  constructor(
    private readonly git: Git,
    private readonly repoRoot: string,
    private readonly localGitFactory: (path: string) => Git,
  ) {}

  async ensure(workId: string, baseRef: string): Promise<EnsureResult> {
    const branch = changeBranchOf(workId);
    const headRef = changeHeadRefOf(workId);
    const path = changeWorktreePathOf(this.repoRoot, workId);

    const baseResult = await this.git.exec(["rev-parse", baseRef], { allowFailure: true });
    if (baseResult.code !== 0) {
      fail("INVALID_STATE", `base ref ${baseRef} cannot be resolved`);
    }
    const baseCommit = baseResult.stdout.trim();

    const inspection = await this.inspect(workId);

    if (inspection.worktreeExists) {
      const worktreeGit = this.localGitFactory(path);
      const branchCheck = await worktreeGit.exec(["rev-parse", "--abbrev-ref", "HEAD"], { allowFailure: true });
      const wtBranch = branchCheck.code === 0 ? branchCheck.stdout.trim() : undefined;
      if (wtBranch !== branch) {
        fail("CONFLICT", `worktree at ${path} is on branch ${wtBranch ?? "<unknown>"}, expected ${branch}`);
      }
      const status = await new GitCheckout(worktreeGit).observe();
      if (!status.clean) {
        fail("INVALID_STATE", `worktree at ${path} has uncommitted changes: ${status.changes.join(", ")}`);
      }
    } else if (inspection.branchExists) {
      const wtResult = await this.git.exec(["worktree", "add", path, headRef], { allowFailure: true });
      if (wtResult.code !== 0) {
        fail("CONFLICT", `failed to create worktree at ${path}: ${wtResult.stderr}`);
      }
    } else {
      const wtResult = await this.git.exec(["worktree", "add", "-b", branch, path, baseRef], { allowFailure: true });
      if (wtResult.code !== 0) {
        fail("CONFLICT", `failed to create worktree at ${path}: ${wtResult.stderr}`);
      }
    }

    return { baseCommit, headRef, worktreePath: path };
  }

  async observeCandidate(worktreePath: string, baseCommit: string, headRef: string): Promise<CandidateObservation> {
    const worktreeGit = this.localGitFactory(worktreePath);

    const headResult = await worktreeGit.exec(["rev-parse", "HEAD"], { allowFailure: true });
    if (headResult.code !== 0) {
      fail("INVALID_STATE", "cannot observe HEAD in worktree");
    }
    const candidateCommit = headResult.stdout.trim();

    const branchHeadResult = await this.git.exec(["rev-parse", headRef], { allowFailure: true });
    if (branchHeadResult.code !== 0 || branchHeadResult.stdout.trim() !== candidateCommit) {
      fail("INVALID_STATE", `candidate ${candidateCommit} does not match head ref ${headRef}`);
    }

    const ancestorResult = await this.git.exec(["merge-base", "--is-ancestor", baseCommit, candidateCommit], {
      allowFailure: true,
    });
    if (ancestorResult.code !== 0) {
      fail("INVALID_STATE", `candidate ${candidateCommit} is not reachable from ${baseCommit}`);
    }

    const observation = await new GitCheckout(worktreeGit).observe();

    const diffResult = await this.git.exec(["diff", "--name-only", `${baseCommit}...${candidateCommit}`]);
    const changedPaths = diffResult.stdout.split("\n").filter((line) => line.trim() !== "");

    const countResult = await this.git.exec(["rev-list", "--count", `${baseCommit}..${candidateCommit}`]);
    const commitCount = parseInt(countResult.stdout.trim(), 10);

    return {
      candidateCommit,
      changedPaths,
      commitCount,
      clean: observation.clean,
      changes: observation.changes,
    };
  }

  async inspect(workId: string): Promise<ChangeInspection> {
    const branch = changeBranchOf(workId);
    const headRef = changeHeadRefOf(workId);
    const path = changeWorktreePathOf(this.repoRoot, workId);
    const expected = resolvePath(path);

    const branchResult = await this.git.exec(["show-ref", "--verify", headRef], { allowFailure: true });
    const branchExists = branchResult.code === 0;
    const branchHead = branchExists ? (await this.git.exec(["rev-parse", headRef])).stdout.trim() : undefined;

    const wtResult = await this.git.exec(["worktree", "list", "--porcelain"]);
    const worktrees: WorktreeObservation[] = [];
    let current: Partial<WorktreeObservation> = {};
    for (const line of wtResult.stdout.split("\n")) {
      if (line.startsWith("worktree ")) {
        if (current.path !== undefined) worktrees.push(current as WorktreeObservation);
        current = { path: resolvePath(line.slice("worktree ".length)), head: "", branch: undefined, isBare: false };
      } else if (line.startsWith("HEAD ")) {
        current.head = line.slice("HEAD ".length);
      } else if (line.startsWith("branch ")) {
        current.branch = line.slice("branch ".length);
      } else if (line === "bare") {
        current.isBare = true;
      } else if (line === "" && current.path !== undefined) {
        worktrees.push(current as WorktreeObservation);
        current = {};
      }
    }
    if (current.path !== undefined) worktrees.push(current as WorktreeObservation);

    const conflictingWorktreePaths: string[] = [];
    let worktreeExists = false;
    for (const wt of worktrees) {
      const wtPath = resolvePath(wt.path);
      if (wtPath === expected) {
        worktreeExists = true;
        continue;
      }
      if (wtPath.startsWith(`${expected}/`)) continue;
      if (expected.startsWith(`${wtPath}/`)) {
        conflictingWorktreePaths.push(wt.path);
        continue;
      }
      if (wt.branch === branch || wt.branch === headRef) {
        conflictingWorktreePaths.push(wt.path);
      }
    }

    return {
      branch,
      branchExists,
      branchHead,
      headRef,
      worktreePath: path,
      worktreeExists,
      worktrees,
      conflictingWorktreePaths,
    };
  }

  async cleanup(workId: string, policy: CleanupPolicy): Promise<{ warnings: string[] }> {
    const warnings: string[] = [];
    const path = changeWorktreePathOf(this.repoRoot, workId);

    if (policy.removeWorktree) {
      const wtResult = await this.git.exec(["worktree", "remove", path], { allowFailure: true });
      if (wtResult.code !== 0) {
        warnings.push(`worktree cleanup for ${workId}: ${wtResult.stderr.trim() || "failed to remove worktree"}`);
      }
    }

    if (policy.removeBranch) {
      const branch = changeBranchOf(workId);
      const brResult = await this.git.exec(["branch", "-D", branch], { allowFailure: true });
      if (brResult.code !== 0) {
        warnings.push(`branch cleanup for ${workId}: ${brResult.stderr.trim() || "failed to delete branch"}`);
      }
    }

    return { warnings };
  }
}

function resolvePath(path: string): string {
  let head = path;
  let tail = "";
  while (head !== "" && head !== "/" && head !== ".") {
    try {
      return realpathSync(head) + tail;
    } catch {
      const slash = head.lastIndexOf("/");
      if (slash <= 0) return path;
      tail = head.slice(slash) + tail;
      head = head.slice(0, slash);
    }
  }
  return path;
}
