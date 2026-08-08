import type { Git } from "../adapters/git.js";
import { STATE_REF, type StateStore } from "../adapters/state-store.js";
import { fail } from "../core/errors.js";

export type StateRelation =
  | "equal"
  | "ahead"
  | "behind"
  | "diverged"
  | "missing-local"
  | "missing-remote"
  | "unknown"
  | "unavailable";

export interface StateStatus {
  local: string | null;
  remote: string | null;
  relation: StateRelation;
  error?: string;
}

const ZERO = "0000000000000000000000000000000000000000";
const REMOTE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export class StateTransferService {
  constructor(
    private readonly git: Git,
    private readonly store: StateStore,
  ) {}

  async status(remote: string): Promise<StateStatus> {
    const safe = checkRemoteName(remote);
    const local = await this.localCommit();
    const query = await this.queryRemote(safe);
    if (query.error !== undefined) {
      return { local, remote: null, relation: "unavailable", error: query.error };
    }
    const remoteCommit = query.commit;
    if (local === null && remoteCommit === null) return { local, remote: null, relation: "unavailable" };
    if (local === null) return { local, remote: remoteCommit, relation: "missing-local" };
    if (remoteCommit === null) return { local, remote: null, relation: "missing-remote" };
    if (local === remoteCommit) return { local, remote: remoteCommit, relation: "equal" };
    if (!(await this.objectExists(remoteCommit))) {
      return { local, remote: remoteCommit, relation: "unknown" };
    }
    return { local, remote: remoteCommit, relation: await this.ancestry(local, remoteCommit) };
  }

  async fetch(remote: string): Promise<StateStatus> {
    const safe = checkRemoteName(remote);
    const before = await this.localCommit();
    const query = await this.queryRemote(safe);
    if (query.error !== undefined) fail("INVALID_STATE", `remote ${safe} is unavailable: ${query.error}`);
    if (query.commit === null) fail("NOT_FOUND", `remote ${safe} has no ${STATE_REF}`);

    const temp = tempRef(safe);
    await this.git.exec(["fetch", safe, `${STATE_REF}:${temp}`]);
    const fetched = (await this.git.exec(["rev-parse", temp])).stdout.trim();

    await this.store.readCommit(fetched);

    if (before !== null) {
      const ff = await this.git.exec(["merge-base", "--is-ancestor", before, fetched], { allowFailure: true });
      if (ff.code !== 0) {
        fail("CONFLICT", `${STATE_REF} has diverged from ${safe}; local state was not modified`);
      }
    }
    if (before === fetched) {
      return this.status(safe);
    }
    const update = await this.git.exec(["update-ref", STATE_REF, fetched, before ?? ZERO], { allowFailure: true });
    if (update.code !== 0) {
      fail("CONFLICT", `local ${STATE_REF} changed during fetch; retry`);
    }
    return this.status(safe);
  }

  async push(remote: string): Promise<StateStatus> {
    const safe = checkRemoteName(remote);
    const localSnapshot = await this.store.read();
    const local = localSnapshot.commit;
    if (local === null) fail("NOT_FOUND", `no local ${STATE_REF} to push`);

    const query = await this.queryRemote(safe);
    if (query.error !== undefined) fail("INVALID_STATE", `remote ${safe} is unavailable: ${query.error}`);
    const remoteCommit = query.commit;
    if (remoteCommit !== null) {
      if (remoteCommit === local) return { local, remote: remoteCommit, relation: "equal" };
      if (!(await this.objectExists(remoteCommit))) {
        await this.git.exec(["fetch", safe, `${STATE_REF}:${tempRef(safe)}`]);
      }
      if (!(await this.objectExists(remoteCommit))) {
        fail("CONFLICT", `remote state commit is unavailable locally; run \`codepatrol state fetch\` first`);
      }
      const ff = await this.git.exec(["merge-base", "--is-ancestor", remoteCommit, local], { allowFailure: true });
      if (ff.code !== 0) {
        fail(
          "CONFLICT",
          `${STATE_REF} push refused: remote ${safe} has diverged; run \`codepatrol state fetch\` first`,
        );
      }
    }
    const lease =
      remoteCommit === null ? `--force-with-lease=${STATE_REF}:` : `--force-with-lease=${STATE_REF}:${remoteCommit}`;
    const push = await this.git.exec(["push", safe, `${STATE_REF}:${STATE_REF}`, lease], { allowFailure: true });
    if (push.code !== 0) {
      fail("CONFLICT", `${STATE_REF} push failed: ${push.stderr.trim()}`);
    }
    return this.status(safe);
  }

  private async localCommit(): Promise<string | null> {
    const result = await this.git.exec(["rev-parse", "--verify", "--quiet", STATE_REF], { allowFailure: true });
    const commit = result.stdout.trim();
    return result.code === 0 && commit !== "" ? commit : null;
  }

  private async queryRemote(remote: string): Promise<{ commit: string | null; error?: string }> {
    const result = await this.git.exec(["ls-remote", remote, STATE_REF], { allowFailure: true });
    if (result.code !== 0) {
      return { commit: null, error: result.stderr.trim() || `ls-remote ${remote} failed` };
    }
    const line = result.stdout.split("\n").find((entry) => entry.trim() !== "");
    if (line === undefined) return { commit: null };
    const commit = line.split(/\s+/)[0];
    return { commit: commit !== undefined && commit !== "" ? commit : null };
  }

  private async objectExists(sha: string): Promise<boolean> {
    const result = await this.git.exec(["cat-file", "-e", `${sha}^{commit}`], { allowFailure: true });
    return result.code === 0;
  }

  private async ancestry(local: string, remote: string): Promise<StateRelation> {
    const localContainsRemote = await this.git.exec(["merge-base", "--is-ancestor", remote, local], {
      allowFailure: true,
    });
    if (localContainsRemote.code === 0) return "ahead";
    const remoteContainsLocal = await this.git.exec(["merge-base", "--is-ancestor", local, remote], {
      allowFailure: true,
    });
    if (remoteContainsLocal.code === 0) return "behind";
    return "diverged";
  }
}

function checkRemoteName(remote: string): string {
  if (!REMOTE_NAME.test(remote)) {
    fail("USAGE", `invalid remote name ${JSON.stringify(remote)}`);
  }
  return remote;
}

function tempRef(remote: string): string {
  return `refs/codepatrol/remotes/${remote}/state`;
}
