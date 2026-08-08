import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fail } from "../core/errors.js";
import type { Git } from "./git.js";

export interface LockInfo {
  pid: number;
  command: string;
  hostname: string;
  acquiredAt: string;
}

export type LockRelease = () => Promise<void>;

export async function acquireLock(
  git: Git,
  cwd: string,
  command: string,
  now: () => string = () => new Date().toISOString(),
): Promise<LockRelease> {
  const commonDirResult = await git.exec(["rev-parse", "--git-common-dir"]);
  const commonDir = commonDirResult.stdout.trim();
  const base = isAbsolute(commonDir) ? commonDir : resolve(cwd, commonDir);
  const lockDir = join(base, "codepatrol.lock");

  const info: LockInfo = { pid: process.pid, command, hostname: hostname(), acquiredAt: now() };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await mkdir(lockDir);
      await writeFile(join(lockDir, "info.json"), `${JSON.stringify(info, null, 2)}\n`);
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        await rm(lockDir, { recursive: true, force: true });
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const owner = await readLockInfo(lockDir);
      if (owner !== null && processAlive(owner.pid)) {
        fail(
          "CONFLICT",
          `another codepatrol process holds the lock (pid ${owner.pid}, command ${JSON.stringify(owner.command)}, since ${owner.acquiredAt})`,
        );
      }
      await rm(lockDir, { recursive: true, force: true });
    }
  }
  fail("CONFLICT", "could not acquire the codepatrol lock");
}

async function readLockInfo(lockDir: string): Promise<LockInfo | null> {
  try {
    const raw = await readFile(join(lockDir, "info.json"), "utf8");
    const parsed = JSON.parse(raw) as Partial<LockInfo>;
    if (typeof parsed.pid !== "number") return null;
    return {
      pid: parsed.pid,
      command: typeof parsed.command === "string" ? parsed.command : "unknown",
      hostname: typeof parsed.hostname === "string" ? parsed.hostname : "unknown",
      acquiredAt: typeof parsed.acquiredAt === "string" ? parsed.acquiredAt : "unknown",
    };
  } catch {
    return null;
  }
}

function processAlive(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
