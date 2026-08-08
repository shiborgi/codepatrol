import { realpathSync } from "node:fs";
import type { ChangePort } from "../adapters/change.js";
import { type CheckoutPort, GitCheckout, requireClean } from "../adapters/checkout.js";
import type { Git } from "../adapters/git.js";
import { changeCleanupPolicy, changeHeadRefOf, changeWorktreePathOf, compareChangedPaths } from "../core/change.js";
import { fail } from "../core/errors.js";
import {
  type Attempt,
  type AttemptEvidence,
  type AttemptResult,
  buildCandidate,
  latestCompletedAttempt,
  type Stage,
  verifiedCandidate,
  type Work,
} from "../core/work.js";

/**
 * Everything an attempt observes about the repository: the checkout, the
 * Change branch and worktree, the candidate commits, and the local squash on
 * Accept. It answers what was seen; deciding what that means for the Work's
 * state is the lifecycle's job, not this one's.
 */
export class AttemptEvidenceRecorder {
  constructor(
    private readonly checkout: CheckoutPort,
    private readonly change?: ChangePort,
    private readonly repoRoot?: string,
    private readonly localGitFactory?: (path: string) => Git,
    private readonly git?: Git,
    private readonly warnSink?: (message: string) => void,
  ) {}

  async cleanupAfterShip(work: Work, stage: Stage): Promise<void> {
    if (
      stage !== "ship" ||
      work.delivery !== "code" ||
      work.completion === null ||
      this.change === undefined ||
      this.warnSink === undefined
    ) {
      return;
    }
    try {
      const outcome = work.completion.outcome === "accepted" ? "accepted" : "rolled-back";
      const result = await this.change.cleanup(work.id, changeCleanupPolicy(outcome));
      for (const warning of result.warnings) this.warnSink(warning);
    } catch (error) {
      this.warnSink(`change cleanup for ${work.id}: ${(error as Error).message}`);
    }
  }

  async startEvidence(work: Work, stage: Stage): Promise<AttemptEvidence | undefined> {
    if (stage === "plan") {
      return { specRevision: work.specRevision };
    }
    if (stage === "build") {
      const observation = await this.checkout.observe();
      requireClean(observation, "build start");
      if (work.delivery === "code" && this.change !== undefined) {
        await this.decideBuild(work);
        const result = await this.change.ensure(work.id, "refs/heads/main");
        return { baseCommit: result.baseCommit };
      }
      return { baseCommit: observation.commit };
    }
    if (stage === "verify" || stage === "ship") {
      return this.checkCandidates(work, stage);
    }
    return undefined;
  }

  /**
   * Read-only inspection of every Work about to build. It refuses before the
   * first resource is created, which is what makes a wave-scoped build start
   * all-or-nothing on the filesystem and not only in state.
   */
  async preflightBuild(works: readonly Work[]): Promise<void> {
    const observation = await this.checkout.observe();
    requireClean(observation, "build start");
    for (const work of works) {
      if (work.delivery === "code" && this.change !== undefined) await this.decideBuild(work);
    }
  }

  async decideBuild(work: Work): Promise<void> {
    if (this.change === undefined) return;
    const inspection = await this.change.inspect(work.id);
    const previousBuild = latestCompletedAttempt(work, "build");
    const previousChange = previousBuild?.evidence?.change;

    if (previousChange === undefined) {
      if (inspection.branchExists) {
        fail(
          "CONFLICT",
          `build refused: unexpected change branch ${inspection.headRef} exists for ${work.id} with no recorded Change evidence; manual investigation required (orphan resource)`,
        );
      }
      for (const wt of inspection.worktrees) {
        if (wt.branch === inspection.branch) {
          fail(
            "CONFLICT",
            `build refused: unexpected worktree at ${wt.path} on branch ${wt.branch} for ${work.id} with no recorded Change evidence; manual investigation required (orphan resource)`,
          );
        }
      }
      return;
    }

    const recordedCandidate = previousChange.candidateCommit;

    if (!inspection.branchExists) {
      fail(
        "INVALID_STATE",
        `build refused: ${inspection.headRef} is missing; recorded candidate ${recordedCandidate} cannot be recovered without human action — refresh the Change by rebuilding on the current base, or restore the branch; never silently recreated from an uncertain commit`,
      );
    }

    if (inspection.branchHead !== recordedCandidate) {
      fail(
        "INVALID_STATE",
        `build refused: ${inspection.headRef} HEAD ${inspection.branchHead ?? "<missing>"} differs from recorded candidate ${recordedCandidate}; refresh the Change by rebuilding on the current base, or revert the branch to the recorded candidate — never silently recreated from an uncertain commit`,
      );
    }

    if (inspection.worktreeExists) {
      const expectedPath = resolvePathOrSelf(inspection.worktreePath);
      const wt = inspection.worktrees.find((w) => resolvePathOrSelf(w.path) === expectedPath);
      if (wt === undefined) {
        fail(
          "CONFLICT",
          `build refused: worktree at ${inspection.worktreePath} listed inconsistently; inspect manually`,
        );
      }
      if (wt.head !== recordedCandidate) {
        fail(
          "INVALID_STATE",
          `build refused: worktree at ${inspection.worktreePath} HEAD ${wt.head} differs from recorded candidate ${recordedCandidate}; refresh the Change by rebuilding on the current base`,
        );
      }
    }

    if (inspection.conflictingWorktreePaths.length > 0) {
      const conflicts = inspection.conflictingWorktreePaths
        .map((path) => `worktree at ${path} on branch ${inspection.branch}`)
        .join("; ");
      fail(
        "CONFLICT",
        `build refused: duplicate Change identity for ${work.id}; conflicting resources: ${conflicts}; ref ${inspection.headRef}; manual investigation required`,
      );
    }
  }

  async checkCandidates(work: Work, stage: Stage): Promise<AttemptEvidence | undefined> {
    const candidate = stage === "verify" ? buildCandidate(work) : verifiedCandidate(work);
    if (candidate === undefined) {
      fail("INVALID_STATE", `${work.id} has no ${stage === "verify" ? "build" : "verified"} candidate`);
    }
    const worktreePath = this.getWorktreePath(work);
    if (worktreePath !== undefined && this.localGitFactory !== undefined) {
      const checkout = new GitCheckout(this.localGitFactory(worktreePath));
      const observation = await checkout.observe();
      requireClean(observation, `${stage} start`);
      if (observation.commit !== candidate) {
        fail(
          "INVALID_STATE",
          `${stage} start refused: HEAD ${observation.commit} differs from ${stage === "verify" ? "build" : "verified"} candidate ${candidate}`,
        );
      }
      if (stage === "ship" && this.change !== undefined) {
        const buildAttempt = latestCompletedAttempt(work, "build");
        const baseCommit = buildAttempt?.evidence?.change?.baseCommit ?? buildAttempt?.evidence?.baseCommit;
        if (baseCommit !== undefined) {
          const baseObs = await this.checkout.observe();
          requireClean(baseObs, "ship start (base)");
          if (baseObs.commit !== baseCommit) {
            fail(
              "INVALID_STATE",
              `ship start refused: base branch HEAD ${baseObs.commit} differs from recorded base commit ${baseCommit}; the base advanced — re-verify or rebuild the Change (no automatic rebase)`,
            );
          }
        }
        return { ...(baseCommit !== undefined ? { baseCommit } : {}), candidateCommit: candidate };
      }
      return { candidateCommit: candidate };
    }
    const observation = await this.checkout.observe();
    requireClean(observation, `${stage} start`);
    if (observation.commit !== candidate) {
      fail(
        "INVALID_STATE",
        `${stage} start refused: HEAD ${observation.commit} differs from ${stage === "verify" ? "build" : "verified"} candidate ${candidate}`,
      );
    }
    return { candidateCommit: candidate };
  }

  async completeEvidence(
    work: Work,
    stage: Stage,
    attempt: Attempt,
    result: AttemptResult,
  ): Promise<AttemptEvidence | undefined> {
    if (stage === "build") {
      if (work.delivery === "code" && this.change !== undefined && attempt.evidence?.baseCommit !== undefined) {
        const baseCommit = attempt.evidence.baseCommit;
        const worktreePath = changeWorktreePathOf(this.repoRoot ?? "", work.id);
        const headRef = changeHeadRefOf(work.id);
        const result = await this.change.observeCandidate(worktreePath, baseCommit, headRef);
        if (!result.clean) {
          fail(
            "INVALID_STATE",
            `build complete refused: worktree is not clean; changes: ${result.changes.slice(0, 5).join(", ")}`,
          );
        }
        return {
          candidateCommit: result.candidateCommit,
          change: {
            type: "codepatrol-change" as const,
            baseRef: "refs/heads/main",
            baseCommit,
            headRef,
            candidateCommit: result.candidateCommit,
            worktree: worktreePath,
            changedPaths: result.changedPaths,
            commitCount: result.commitCount,
          },
        };
      }
      const observation = await this.checkout.observe();
      requireClean(observation, "build complete");
      const base = attempt.evidence?.baseCommit;
      if (work.delivery === "code" && base !== undefined && observation.commit === base) {
        fail("INVALID_STATE", `build complete refused: ${work.id} is a code work but HEAD is unchanged`);
      }
      return { candidateCommit: observation.commit };
    }
    if (stage === "verify" || stage === "ship") {
      const pinned = attempt.evidence?.candidateCommit;
      if (pinned === undefined) {
        fail("STATE_CORRUPT", `${work.id} ${stage} attempt has no pinned candidate`);
      }
      const worktreePath = this.getWorktreePath(work);
      if (
        stage === "ship" &&
        result.decision === "accept" &&
        work.delivery === "code" &&
        this.change !== undefined &&
        this.localGitFactory !== undefined &&
        this.repoRoot !== undefined &&
        worktreePath !== undefined
      ) {
        const baseObs = await this.checkout.observe();
        requireClean(baseObs, "ship accept");
        const headRef = changeHeadRefOf(work.id);
        const baseCommit = attempt.evidence?.baseCommit;
        if (baseCommit === undefined) {
          fail("STATE_CORRUPT", `ship accept refused: ${work.id} ship attempt lacks baseCommit`);
        }
        const finalCommit = await this.squashChange(headRef, pinned, work.id, baseCommit);
        return {
          candidateCommit: pinned,
          baseCommit,
          finalCommit,
          localIntegration: { status: "integrated", finalCommit },
        };
      }
      if (
        stage === "ship" &&
        result.decision === "rollback" &&
        work.delivery === "code" &&
        worktreePath !== undefined
      ) {
        const baseObs = await this.checkout.observe();
        requireClean(baseObs, "ship rollback");
        const baseCommit = attempt.evidence?.baseCommit;
        if (baseCommit !== undefined && baseObs.commit !== baseCommit) {
          fail(
            "INVALID_STATE",
            `ship rollback refused: base branch HEAD ${baseObs.commit} differs from recorded base commit ${baseCommit}`,
          );
        }
        const checkout = new GitCheckout(this.localGitFactory!(worktreePath));
        const obs = await checkout.observe();
        if (obs.commit !== pinned) {
          fail(
            "INVALID_STATE",
            `ship rollback refused: worktree HEAD ${obs.commit} differs from pinned candidate ${pinned}`,
          );
        }
        return { ...(baseCommit !== undefined ? { baseCommit } : {}), candidateCommit: pinned };
      }
      if (worktreePath !== undefined && this.localGitFactory !== undefined) {
        const checkout = new GitCheckout(this.localGitFactory(worktreePath));
        const observation = await checkout.observe();
        requireClean(observation, `${stage} complete`);
        if (observation.commit !== pinned) {
          fail(
            "INVALID_STATE",
            `${stage} complete refused: HEAD ${observation.commit} differs from pinned candidate ${pinned}`,
          );
        }
        if (stage === "verify" && work.delivery === "code" && this.change !== undefined) {
          const baseObs = await this.checkout.observe();
          const evidence: AttemptEvidence = { baseCommit: baseObs.commit, candidateCommit: pinned };
          const observedPaths = await this.deriveObservedPaths(work, pinned);
          if (observedPaths !== undefined) {
            const build = latestCompletedAttempt(work, "build");
            const reported = build?.evidence?.change?.changedPaths;
            if (result.decision === "continue") {
              const { match, onlyReported, onlyObserved } = compareChangedPaths(reported, observedPaths);
              if (!match) {
                fail(
                  "INVALID_STATE",
                  `verify complete refused: Build-reported changed paths differ from the real diff; reported-only: ${onlyReported.join(", ") || "(none)"}, observed-only: ${onlyObserved.join(", ") || "(none)"} — return to build or re-verify`,
                );
              }
            }
            evidence.changedPaths = observedPaths;
          }
          return evidence;
        }
        return { candidateCommit: pinned };
      }
      const observation = await this.checkout.observe();
      requireClean(observation, `${stage} complete`);
      if (stage === "ship") {
        const verified = verifiedCandidate(work);
        if (verified === undefined) fail("STATE_CORRUPT", `${work.id} ship attempt without a verified candidate`);
        if (observation.commit !== verified) {
          fail(
            "INVALID_STATE",
            `ship complete refused: HEAD ${observation.commit} differs from verified candidate ${verified}`,
          );
        }
        return { candidateCommit: verified };
      }
      if (observation.commit !== pinned) {
        fail(
          "INVALID_STATE",
          `${stage} complete refused: HEAD ${observation.commit} differs from pinned candidate ${pinned}`,
        );
      }
      if (stage === "verify" && work.delivery === "code" && this.change !== undefined) {
        const evidence: AttemptEvidence = { baseCommit: observation.commit, candidateCommit: pinned };
        const observedPaths = await this.deriveObservedPaths(work, pinned);
        if (observedPaths !== undefined) {
          const build = latestCompletedAttempt(work, "build");
          const reported = build?.evidence?.change?.changedPaths;
          if (result.decision === "continue") {
            const { match, onlyReported, onlyObserved } = compareChangedPaths(reported, observedPaths);
            if (!match) {
              fail(
                "INVALID_STATE",
                `verify complete refused: Build-reported changed paths differ from the real diff; reported-only: ${onlyReported.join(", ") || "(none)"}, observed-only: ${onlyObserved.join(", ") || "(none)"} — return to build or re-verify`,
              );
            }
          }
          evidence.changedPaths = observedPaths;
        }
        return evidence;
      }
      return { candidateCommit: pinned };
    }
    return undefined;
  }

  getWorktreePath(work: Work): string | undefined {
    const build = latestCompletedAttempt(work, "build");
    return build?.evidence?.change?.worktree;
  }

  async deriveObservedPaths(work: Work, candidate: string): Promise<string[] | undefined> {
    if (this.git === undefined) return undefined;
    const build = latestCompletedAttempt(work, "build");
    const change = build?.evidence?.change;
    if (change === undefined) return undefined;
    const diffResult = await this.git.exec(["diff", "--name-only", `${change.baseCommit}...${candidate}`], {
      allowFailure: true,
    });
    if (diffResult.code !== 0) return undefined;
    return diffResult.stdout.split("\n").filter((line) => line.trim() !== "");
  }

  async squashChange(headRef: string, candidate: string, workId: string, baseCommit: string): Promise<string> {
    if (this.git === undefined) fail("STATE_CORRUPT", "ship accept: git instance not available");
    const message = `codepatrol: ship ${workId} ${candidate}`;
    const found = await this.findIntegrationCommit(message, baseCommit, candidate);
    if (found !== undefined) return found;
    const headResult = await this.git.exec(["rev-parse", "HEAD"]);
    const currentBase = headResult.stdout.trim();
    if (currentBase !== baseCommit) {
      fail(
        "INVALID_STATE",
        `ship accept refused: base branch HEAD ${currentBase} differs from recorded base commit ${baseCommit}; the base advanced between Ship Start and Ship Complete — re-verify or rebuild the Change (no automatic rebase)`,
      );
    }
    const squashResult = await this.git.exec(["merge", "--squash", headRef]);
    if (squashResult.code !== 0) {
      fail("CONFLICT", `ship accept refused: squash merge of ${headRef} failed: ${squashResult.stderr}`);
    }
    await this.git.exec(["commit", "-m", message, "--no-edit"]);
    const finalResult = await this.git.exec(["rev-parse", "HEAD"]);
    if (finalResult.code !== 0) {
      fail("STATE_CORRUPT", "ship accept: cannot resolve HEAD after squash");
    }
    return finalResult.stdout.trim();
  }
  async findIntegrationCommit(message: string, baseCommit: string, candidate: string): Promise<string | undefined> {
    if (this.git === undefined) return undefined;
    const logResult = await this.git.exec(["log", "--format=%H%x00%s", "HEAD"], { allowFailure: true });
    if (logResult.code !== 0) return undefined;
    const lines = logResult.stdout.trim().split("\n");
    const matches: string[] = [];
    for (const line of lines) {
      if (line === "") continue;
      const nul = line.indexOf("\0");
      if (nul === -1) continue;
      const sha = line.slice(0, nul);
      const subject = line.slice(nul + 1);
      if (subject === message) {
        matches.push(sha);
      }
    }
    if (matches.length === 0) return undefined;
    if (matches.length > 1) {
      fail(
        "CONFLICT",
        `ship accept refused: ${matches.length} ambiguous integration commits found for ${JSON.stringify(message)}: ${matches.join(", ")}`,
      );
    }
    const foundSha = matches[0] as string;
    const ancestorResult = await this.git.exec(["merge-base", "--is-ancestor", foundSha, "HEAD"], {
      allowFailure: true,
    });
    if (ancestorResult.code !== 0) {
      fail("CONFLICT", `ship accept refused: found integration commit ${foundSha} is not reachable from HEAD`);
    }
    const subjectResult = await this.git.exec(["log", "-1", "--format=%s", foundSha]);
    if (subjectResult.stdout.trim() !== message) {
      fail("CONFLICT", `ship accept refused: found integration commit ${foundSha} has mismatched subject`);
    }
    const treeResult = await this.git.exec(["rev-parse", `${foundSha}^{tree}`]);
    const candidateTreeResult = await this.git.exec(["rev-parse", `${candidate}^{tree}`]);
    if (treeResult.stdout.trim() !== candidateTreeResult.stdout.trim()) {
      fail(
        "CONFLICT",
        `ship accept refused: found integration commit ${foundSha} tree differs from candidate ${candidate} tree`,
      );
    }
    const parentResult = await this.git.exec(["log", "-1", "--format=%P", foundSha]);
    const parents = parentResult.stdout.trim().split(/\s+/).filter(Boolean);
    if (parents.length !== 1 || parents[0] !== baseCommit) {
      fail(
        "CONFLICT",
        `ship accept refused: found integration commit ${foundSha} parent does not match recorded base commit ${baseCommit}`,
      );
    }
    return foundSha;
  }
}

function resolvePathOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    let head = path;
    let tail = "";
    while (head !== "" && head !== "/" && head !== ".") {
      const slash = head.lastIndexOf("/");
      if (slash <= 0) return path;
      tail = head.slice(slash) + tail;
      head = head.slice(0, slash);
      try {
        return realpathSync(head) + tail;
      } catch {}
    }
    return path;
  }
}
