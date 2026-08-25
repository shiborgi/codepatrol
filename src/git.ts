import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { type CommandResult, execute, stableEnv } from "./command.js";
import { type State, stateSchema, type Verification } from "./core.js";
import { assertDomain, CodePatrolError, ERROR_CODES, zodIssues } from "./errors.js";
import { type RunContext, systemRunContext } from "./run-context.js";
import { STATE_REF } from "./shared.js";
import {
  performAtomicRollback,
  performAtomicShip,
  recoverShipJournal,
  shipJournalExists,
} from "./ship.js";
import { verifyCandidate } from "./verification.js";

export { STATE_REF } from "./shared.js";

export interface StateStore {
  root: string;
  projectId: string;
  readState(): { state: State; oid: string | null };
  mutate<T>(event: string, transition: (state: State) => T): T;
  withLock<T>(action: () => T): T;
  git(args: string[], cwd?: string, input?: string): string;
  tryGit(args: string[], cwd?: string, input?: string): CommandResult;
  currentCommit(branch: string): string;
  resolveRef(ref: string): string | null;
  workspacePath(taskId: string): string;
  createWorkspace(
    taskId: string,
    baseCommit: string,
    seed?: { base: string; commit: string },
  ): string;
  linkSharedPaths(workspace: string, paths: string[]): void;
  submitCandidate(
    taskId: string,
    waveId: string,
    proposalId: string,
    baseCommit: string,
    sharedPaths?: string[],
  ): {
    ref: string;
    baseCommit: string;
    commit: string;
    tree: string;
    changedPaths: string[];
  };
  removeWorkspace(taskId: string): void;
  deleteRef(ref: string, expected?: string): void;
  listManagedWorktrees(): string[];
  listRefs(prefix: string): string[];
  atomicShip(
    state: State,
    oldStateOid: string | null,
    branch: string,
    oldMain: string,
    candidateRef: string,
    candidateCommit: string,
    event: string,
  ): void;
  atomicRollback(
    state: State,
    oldStateOid: string | null,
    candidateRef: string,
    candidateCommit: string,
    event: string,
  ): void;
}

export class Repository implements StateStore {
  readonly root: string;
  readonly commonDir: string;
  readonly projectId: string;
  readonly zeroOid: string;
  private readonly ctx: RunContext;

  static open(workspace: string, ctx: RunContext = systemRunContext()): Repository {
    const probed = execute(
      "git",
      ["rev-parse", "--show-toplevel"],
      workspace,
      undefined,
      120_000,
      stableEnv(ctx.envAll()),
    );
    if (probed.status !== "succeeded") {
      throw new CodePatrolError(
        ERROR_CODES.NOT_A_REPOSITORY,
        "workspace is not a Git repository",
        2,
      );
    }
    return new Repository(workspace, ctx, probed.stdout.trim());
  }

  constructor(
    workspace: string,
    ctx: RunContext = systemRunContext(),
    resolvedRoot?: string,
  ) {
    this.ctx = ctx;
    this.root =
      resolvedRoot ?? Repository.probeRoot(workspace, stableEnv(ctx.envAll()));
    const common = this.git(["rev-parse", "--git-common-dir"]).trim();
    this.commonDir = isAbsolute(common) ? common : resolve(this.root, common);
    const existingState = this.resolveRef(STATE_REF);
    let existingProjectId: string | null = null;
    if (existingState) {
      try {
        const raw = this.git(["show", `${existingState}:state.json`]);
        const candidate = JSON.parse(raw) as { projectId?: unknown };
        if (typeof candidate.projectId === "string")
          existingProjectId = candidate.projectId;
      } catch {}
    }
    this.projectId = existingProjectId ?? randomUUID();
    const objectFormat = this.git(["rev-parse", "--show-object-format"]).trim();
    this.zeroOid = "0".repeat(objectFormat === "sha256" ? 64 : 40);
  }

  private static probeRoot(workspace: string, env: NodeJS.ProcessEnv): string {
    const result = execute(
      "git",
      ["rev-parse", "--show-toplevel"],
      workspace,
      undefined,
      120_000,
      env,
    );
    if (result.status !== "succeeded") {
      throw new CodePatrolError(
        ERROR_CODES.NOT_A_REPOSITORY,
        "workspace is not a Git repository",
        2,
      );
    }
    return result.stdout.trim();
  }

  git(args: string[], cwd = this.root, input?: string): string {
    const result = execute(
      "git",
      args,
      cwd,
      input,
      120_000,
      stableEnv(this.ctx.envAll()),
    );
    if (result.status !== "succeeded") {
      throw new CodePatrolError(
        ERROR_CODES.GIT_FAILED,
        result.error?.message || result.stderr.trim() || `git ${args[0]} failed`,
      );
    }
    return result.stdout;
  }

  tryGit(args: string[], cwd = this.root, input?: string): CommandResult {
    return execute("git", args, cwd, input, 120_000, stableEnv(this.ctx.envAll()));
  }

  resolveRef(ref: string): string | null {
    const result = this.tryGit(["rev-parse", "--verify", ref]);
    return result.status === "succeeded" ? result.stdout.trim() : null;
  }

  currentCommit(branch: string): string {
    const oid = this.resolveRef(`refs/heads/${branch}`);
    assertDomain(
      oid,
      ERROR_CODES.BASE_BRANCH_MISSING,
      `branch ${branch} does not exist`,
    );
    return oid;
  }

  withLock<T>(action: () => T): T {
    const lock = resolve(this.commonDir, "codepatrol-v1.lock");
    this.acquireLock(lock);
    try {
      recoverShipJournal(this);
      return action();
    } finally {
      rmSync(resolve(lock, "owner.json"), { force: true });
      try {
        rmdirSync(lock);
      } catch {}
    }
  }

  private acquireLock(lock: string): void {
    try {
      mkdirSync(lock);
      writeFileSync(
        resolve(lock, "owner.json"),
        JSON.stringify({
          pid: process.pid,
          createdAt: this.ctx.now().toISOString(),
        }),
      );
      return;
    } catch {}
    let owner: { pid?: number } | null = null;
    let raw = "unknown owner";
    try {
      raw = readFileSync(resolve(lock, "owner.json"), "utf8");
      owner = JSON.parse(raw) as { pid?: number };
    } catch {}
    if (typeof owner?.pid === "number" && !processIsAlive(owner.pid)) {
      rmSync(lock, { recursive: true, force: true });
      this.acquireLock(lock);
      return;
    }
    if (!owner?.pid && this.ctx.now().getTime() - statSync(lock).mtimeMs > 5_000) {
      rmSync(lock, { recursive: true, force: true });
      this.acquireLock(lock);
      return;
    }
    throw new CodePatrolError(
      ERROR_CODES.STATE_LOCKED,
      `another transition owns the lock: ${raw}`,
    );
  }

  readState(): { state: State; oid: string | null } {
    const oid = this.resolveRef(STATE_REF);
    if (!oid) {
      return {
        oid: null,
        state: {
          schemaVersion: 1,
          projectId: this.projectId,
          sequence: 0,
          nextInit: 1,
          inits: [],
          waves: [],
          works: [],
          tasks: [],
          proposals: [],
        },
      };
    }
    const raw = this.git(["show", `${oid}:state.json`]);
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new CodePatrolError(
        ERROR_CODES.STATE_CORRUPT,
        "state.json is not valid JSON",
      );
    }
    const parsed = stateSchema.safeParse(json);
    if (!parsed.success) {
      throw new CodePatrolError(ERROR_CODES.STATE_CORRUPT, zodIssues(parsed.error));
    }
    return { state: parsed.data, oid };
  }

  mutate<T>(event: string, transition: (state: State) => T): T {
    return this.withLock(() => {
      const { state, oid } = this.readState();
      const next = structuredClone(state);
      const result = transition(next);
      next.sequence += 1;
      this.writeState(next, oid, event);
      return result;
    });
  }

  writeState(state: State, oldOid: string | null, event: string): string {
    const parsed = stateSchema.safeParse(state);
    if (!parsed.success) {
      throw new CodePatrolError(ERROR_CODES.STATE_INVALID, zodIssues(parsed.error));
    }
    const commit = this.createStateCommit(state, oldOid, event);
    const update = this.tryGit([
      "update-ref",
      "-m",
      `codepatrol: ${event}`,
      STATE_REF,
      commit,
      oldOid ?? this.zeroOid,
    ]);
    if (update.status !== "succeeded") {
      throw new CodePatrolError(
        ERROR_CODES.STATE_CONFLICT,
        "state changed during the transition",
      );
    }
    return commit;
  }

  createStateCommit(state: State, parent: string | null, event: string): string {
    const stateBlob = this.git(
      ["hash-object", "-w", "--stdin"],
      this.root,
      `${JSON.stringify(state, null, 2)}\n`,
    ).trim();
    const eventBlob = this.git(
      ["hash-object", "-w", "--stdin"],
      this.root,
      `${JSON.stringify({ sequence: state.sequence, event, at: this.ctx.now().toISOString() })}\n`,
    ).trim();
    const tree = this.git(
      ["mktree"],
      this.root,
      `100644 blob ${eventBlob}\tevent.json\n100644 blob ${stateBlob}\tstate.json\n`,
    ).trim();
    const args = ["commit-tree", tree, "-m", `codepatrol: ${event}`];
    if (parent) args.push("-p", parent);
    return this.gitWithIdentity(args).trim();
  }

  private gitWithIdentity(args: string[], input?: string): string {
    const env = {
      ...stableEnv(this.ctx.envAll()),
      GIT_AUTHOR_NAME: "CodePatrol",
      GIT_AUTHOR_EMAIL: "codepatrol@local",
      GIT_COMMITTER_NAME: "CodePatrol",
      GIT_COMMITTER_EMAIL: "codepatrol@local",
    };
    const result = execute("git", args, this.root, input, 120_000, env);
    if (result.status !== "succeeded") {
      throw new CodePatrolError(
        ERROR_CODES.GIT_FAILED,
        result.error?.message || result.stderr.trim() || "git commit-tree failed",
      );
    }
    return result.stdout;
  }

  workspacePath(taskId: string): string {
    return resolve(this.workspaceRoot(), taskId);
  }

  workspaceRoot(): string {
    const home =
      this.ctx.env("CODEPATROL_HOME") ??
      resolve(this.ctx.homeDir(), ".local", "state", "codepatrol");
    const canonicalHome = existsSync(home) ? realpathSync(home) : home;
    return resolve(canonicalHome, "worktrees", this.projectId);
  }

  createWorkspace(
    taskId: string,
    baseCommit: string,
    seed?: { base: string; commit: string },
  ): string {
    const path = this.workspacePath(taskId);
    const branch = `codepatrol-v1/${taskId}`;
    mkdirSync(dirname(path), { recursive: true });
    assertDomain(
      !this.resolveRef(`refs/heads/${branch}`),
      ERROR_CODES.WORKSPACE_EXISTS,
      "task branch exists",
    );
    this.git(["worktree", "add", "-b", branch, path, baseCommit]);
    if (seed) {
      const patch = this.git(["diff", "--binary", seed.base, seed.commit]);
      if (patch) {
        const applied = this.tryGit(["apply", "--3way", "-"], path, patch);
        if (applied.status !== "succeeded") {
          this.removeWorkspace(taskId);
          throw new CodePatrolError(
            ERROR_CODES.SEED_CONFLICT,
            applied.stderr.trim() ||
              "selected candidate cannot be applied to the new base",
          );
        }
      }
    }
    return path;
  }

  linkSharedPaths(workspace: string, paths: string[]): void {
    for (const path of paths) {
      assertDomain(
        !isAbsolute(path) && !path.split(/[\\/]/).includes(".."),
        ERROR_CODES.CONFIG_INVALID,
        `verification.sharedPaths must stay inside the repository: ${path}`,
      );
      const source = resolve(this.root, path);
      const target = resolve(workspace, path);
      if (!existsSync(source) || existsSync(target)) continue;
      mkdirSync(dirname(target), { recursive: true });
      symlinkSync(
        source,
        target,
        process.platform === "win32" ? "junction" : undefined,
      );
    }
  }

  resolveManagedOwner(): Repository | null {
    const ownGitDir = resolve(this.root, ".git");
    if (resolve(this.commonDir) === ownGitDir) return null;
    const mainRoot = dirname(this.commonDir);
    try {
      const main = new Repository(mainRoot, this.ctx);
      let current = this.root;
      try {
        current = realpathSync(this.root);
      } catch {}
      return main.listManagedWorktrees().includes(current) ? main : null;
    } catch {
      return null;
    }
  }

  submitCandidate(
    taskId: string,
    waveId: string,
    proposalId: string,
    baseCommit: string,
    sharedPaths: string[] = [],
  ): {
    ref: string;
    baseCommit: string;
    commit: string;
    tree: string;
    changedPaths: string[];
  } {
    const path = this.workspacePath(taskId);
    const status = filterSharedPathEntries(
      this.git(["status", "--porcelain"], path),
      sharedPaths,
    );
    assertDomain(
      !status.trim(),
      ERROR_CODES.DIRTY_WORKTREE,
      "build worktree must be clean",
    );
    const head = this.git(["rev-parse", "HEAD"], path).trim();
    const ancestor = this.tryGit(
      ["merge-base", "--is-ancestor", baseCommit, head],
      path,
    );
    assertDomain(
      ancestor.status === "succeeded",
      ERROR_CODES.INVALID_CANDIDATE,
      "candidate is not based on the round base",
    );
    const tree = this.git(["rev-parse", `${head}^{tree}`], path).trim();
    const baseTree = this.git(["rev-parse", `${baseCommit}^{tree}`], path).trim();
    assertDomain(
      tree !== baseTree,
      ERROR_CODES.EMPTY_CANDIDATE,
      "candidate does not change the base tree",
    );
    const commit = this.gitWithIdentity([
      "commit-tree",
      tree,
      "-p",
      baseCommit,
      "-m",
      `codepatrol: candidate ${waveId} ${proposalId}`,
    ]).trim();
    const ref = `refs/codepatrol/v1/candidates/${waveId}/${proposalId}`;
    this.git(["update-ref", ref, commit, this.zeroOid]);
    const changedPaths = this.git(["diff", "--name-only", baseCommit, commit])
      .split("\n")
      .filter(Boolean);
    return { ref, baseCommit, commit, tree, changedPaths };
  }

  removeWorkspace(taskId: string): void {
    const path = this.workspacePath(taskId);
    this.tryGit(["worktree", "remove", "--force", path]);
    this.tryGit(["branch", "-D", `codepatrol-v1/${taskId}`]);
    rmSync(path, { recursive: true, force: true });
  }

  verifyCandidate(
    proposalId: string,
    candidateCommit: string,
    argv: string[],
    timeoutMs: number,
    sharedPaths: string[] = [],
  ): Verification {
    return verifyCandidate(
      this.ctx,
      this,
      proposalId,
      candidateCommit,
      argv,
      timeoutMs,
      sharedPaths,
    );
  }

  atomicShip(
    state: State,
    oldStateOid: string | null,
    branch: string,
    oldMain: string,
    candidateRef: string,
    candidateCommit: string,
    event: string,
  ): void {
    performAtomicShip(
      this,
      state,
      oldStateOid,
      branch,
      oldMain,
      candidateRef,
      candidateCommit,
      event,
    );
  }

  atomicRollback(
    state: State,
    oldStateOid: string | null,
    candidateRef: string,
    candidateCommit: string,
    event: string,
  ): void {
    performAtomicRollback(
      this,
      state,
      oldStateOid,
      candidateRef,
      candidateCommit,
      event,
    );
  }

  deleteRef(ref: string, expected?: string): void {
    const result = this.tryGit([
      "update-ref",
      "-d",
      ref,
      ...(expected ? [expected] : []),
    ]);
    if (result.status !== "succeeded") {
      throw new CodePatrolError(ERROR_CODES.CLEANUP_FAILED, `cannot delete ${ref}`);
    }
  }

  listManagedWorktrees(): string[] {
    const root = this.workspaceRoot();
    return this.git(["worktree", "list", "--porcelain"])
      .split("\n")
      .filter((line) => line.startsWith("worktree "))
      .map((line) => line.slice("worktree ".length))
      .filter((path) => path === root || path.startsWith(`${root}${sep}`));
  }

  listRefs(prefix: string): string[] {
    return this.git(["for-each-ref", "--format=%(refname)", prefix])
      .split("\n")
      .filter(Boolean);
  }

  shipRecoveryPending(): boolean {
    return shipJournalExists(this.commonDir);
  }

  readStateHistory(): Array<{
    event: { sequence: number; event: string; at: string };
    state: State;
  }> {
    if (!this.resolveRef(STATE_REF)) return [];
    return this.git(["rev-list", "--reverse", STATE_REF])
      .split("\n")
      .filter(Boolean)
      .map((commit) => ({
        event: JSON.parse(this.git(["show", `${commit}:event.json`])) as {
          sequence: number;
          event: string;
          at: string;
        },
        state: JSON.parse(this.git(["show", `${commit}:state.json`])) as State,
      }));
  }
}

export function filterSharedPathEntries(status: string, sharedPaths: string[]): string {
  if (sharedPaths.length === 0) return status;
  const ignored = new Set(sharedPaths.map((entry) => entry.split(/[\\/]/).join("/")));
  return status
    .split("\n")
    .filter((line) => {
      if (line.length < 4) return true;
      let path = line.slice(3).trim();
      if (path.startsWith('"') && path.endsWith('"')) {
        try {
          path = JSON.parse(path) as string;
        } catch {
          path = path.slice(1, -1);
        }
      }
      if (path.endsWith("/")) path = path.slice(0, -1);
      return !ignored.has(path.split(/[\\/]/).join("/"));
    })
    .join("\n");
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
