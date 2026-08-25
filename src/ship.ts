import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import type { CommandResult } from "./command.js";
import type { State } from "./core.js";
import { assertDomain, CodePatrolError, ERROR_CODES } from "./errors.js";
import { STATE_REF } from "./shared.js";

export const shipJournalSchema = z
  .object({
    branch: z.string().min(1),
    oldMain: z.string().min(1),
    oldTree: z.string().min(1),
    candidateCommit: z.string().min(1),
    candidateTree: z.string().min(1),
  })
  .strict();

export type ShipJournal = z.infer<typeof shipJournalSchema>;

export function shipJournalPath(commonDir: string): string {
  return resolve(commonDir, "codepatrol-v1-ship.json");
}

export interface ShipStore {
  readonly root: string;
  readonly commonDir: string;
  readonly zeroOid: string;
  git(args: string[], cwd?: string, input?: string): string;
  tryGit(args: string[], cwd?: string, input?: string): CommandResult;
  currentCommit(branch: string): string;
  createStateCommit(state: State, parent: string | null, event: string): string;
}

export function performAtomicShip(
  store: ShipStore,
  state: State,
  oldStateOid: string | null,
  branch: string,
  oldMain: string,
  candidateRef: string,
  candidateCommit: string,
  event: string,
): void {
  const currentBranch = store.git(["symbolic-ref", "--short", "HEAD"]).trim();
  assertDomain(
    currentBranch === branch && store.git(["rev-parse", "HEAD"]).trim() === oldMain,
    ERROR_CODES.BASE_NOT_CHECKED_OUT,
    `Ship must run from the clean ${branch} checkout`,
  );
  assertDomain(
    !store.git(["status", "--porcelain"]).trim(),
    ERROR_CODES.DIRTY_MAIN,
    `the ${branch} checkout must be clean`,
  );
  const addedPaths = store
    .git(["diff", "--name-only", "--diff-filter=A", "-z", oldMain, candidateCommit])
    .split("\0")
    .filter(Boolean);
  const collisions = addedPaths.filter((path) => existsSync(resolve(store.root, path)));
  assertDomain(
    collisions.length === 0,
    ERROR_CODES.LOCAL_PATH_COLLISION,
    `candidate would overwrite local paths: ${collisions.join(", ")}`,
  );
  const stateCommit = store.createStateCommit(state, oldStateOid, event);
  const journal = shipJournalPath(store.commonDir);
  const entry: ShipJournal = {
    branch,
    oldMain,
    oldTree: store.git(["rev-parse", `${oldMain}^{tree}`]).trim(),
    candidateCommit,
    candidateTree: store.git(["rev-parse", `${candidateCommit}^{tree}`]).trim(),
  };
  writeJsonAtomic(journal, entry);
  store.git(["read-tree", "-m", "-u", oldMain, candidateCommit]);
  const transaction = [
    "start",
    `update refs/heads/${branch} ${candidateCommit} ${oldMain}`,
    `update ${STATE_REF} ${stateCommit} ${oldStateOid ?? store.zeroOid}`,
    `delete ${candidateRef} ${candidateCommit}`,
    "prepare",
    "commit",
    "",
  ].join("\n");
  const result = store.tryGit(["update-ref", "--stdin"], store.root, transaction);
  if (result.status !== "succeeded") {
    store.git(["read-tree", "--reset", "-u", oldMain]);
    rmSync(journal, { force: true });
    throw new CodePatrolError(
      ERROR_CODES.SHIP_CONFLICT,
      result.stderr.trim() || "atomic ship failed",
    );
  }
  rmSync(journal, { force: true });
}

export function performAtomicRollback(
  store: ShipStore,
  state: State,
  oldStateOid: string | null,
  candidateRef: string,
  candidateCommit: string,
  event: string,
): void {
  const stateCommit = store.createStateCommit(state, oldStateOid, event);
  const transaction = [
    "start",
    `update ${STATE_REF} ${stateCommit} ${oldStateOid ?? store.zeroOid}`,
    `delete ${candidateRef} ${candidateCommit}`,
    "prepare",
    "commit",
    "",
  ].join("\n");
  const result = store.tryGit(["update-ref", "--stdin"], store.root, transaction);
  if (result.status !== "succeeded") {
    throw new CodePatrolError(
      ERROR_CODES.SHIP_CONFLICT,
      result.stderr.trim() || "atomic rollback failed",
    );
  }
}

export function recoverShipJournal(store: ShipStore): void {
  const journal = shipJournalPath(store.commonDir);
  if (!existsSync(journal)) return;
  const entry = readShipJournal(journal);
  const branchCommit = store.currentCommit(entry.branch);
  const target =
    branchCommit === entry.candidateCommit ? entry.candidateCommit : entry.oldMain;
  const expectedTree =
    target === entry.candidateCommit ? entry.candidateTree : entry.oldTree;
  const indexTree = store.git(["write-tree"]).trim();
  const worktreeMatchesIndex =
    store.tryGit(["diff-files", "--quiet"]).status === "succeeded";
  assertDomain(
    worktreeMatchesIndex && [entry.oldTree, entry.candidateTree].includes(indexTree),
    ERROR_CODES.SHIP_RECOVERY_REQUIRED,
    "Ship was interrupted and the checkout changed afterwards; inspect it manually",
  );
  assertDomain(
    [entry.oldMain, entry.candidateCommit].includes(branchCommit),
    ERROR_CODES.SHIP_RECOVERY_REQUIRED,
    "Ship was interrupted and the base branch moved unexpectedly",
  );
  const addedByRecovery = store
    .git(["diff", "--name-only", "--diff-filter=A", "-z", indexTree, expectedTree])
    .split("\0")
    .filter(Boolean);
  const collisions = addedByRecovery.filter((path) =>
    existsSync(resolve(store.root, path)),
  );
  assertDomain(
    collisions.length === 0,
    ERROR_CODES.SHIP_RECOVERY_REQUIRED,
    `recovery would overwrite local paths: ${collisions.join(", ")}`,
  );
  store.git(["read-tree", "--reset", "-u", target]);
  assertDomain(
    store.git(["write-tree"]).trim() === expectedTree,
    ERROR_CODES.SHIP_RECOVERY_REQUIRED,
    "Ship checkout recovery did not reach the expected tree",
  );
  rmSync(journal, { force: true });
}

export function shipJournalExists(commonDir: string): boolean {
  return existsSync(shipJournalPath(commonDir));
}

function readShipJournal(path: string): ShipJournal {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new CodePatrolError(
      ERROR_CODES.SHIP_RECOVERY_REQUIRED,
      "Ship journal is corrupt",
    );
  }
  const parsed = shipJournalSchema.safeParse(raw);
  if (!parsed.success) {
    throw new CodePatrolError(
      ERROR_CODES.SHIP_RECOVERY_REQUIRED,
      "Ship journal is corrupt",
    );
  }
  return parsed.data;
}

function writeJsonAtomic(path: string, value: unknown): void {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let descriptor: number | null = null;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, JSON.stringify(value));
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    renameSync(temporary, path);
  } catch (error) {
    if (descriptor !== null) closeSync(descriptor);
    rmSync(temporary, { force: true });
    throw new CodePatrolError(
      ERROR_CODES.SHIP_JOURNAL_FAILED,
      error instanceof Error ? error.message : String(error),
    );
  }
}
