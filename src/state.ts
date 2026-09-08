import { randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { readJsonFile } from "./config.js";
import { boundedJson, MAX_PLAN_BYTES, MAX_STATE_BYTES } from "./contracts.js";
import { type RunState, runStateSchema } from "./domain.js";

const MAX_RUNS = 10_000;

export function stateDirectory(root: string): string {
  return join(root, ".codepatrol/v1");
}
export async function withStateLock<T>(
  root: string,
  action: (directory: string) => Promise<T>,
): Promise<T> {
  const directory = await ensureStateDirectory(root, true);
  const path = join(directory, "writer.lock");
  let lock: Awaited<ReturnType<typeof open>>;
  try {
    lock = await open(path, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new Error(
        "State is locked by another writer; no automatic retry or stale-lock takeover",
      );
    throw error;
  }
  try {
    await lock.writeFile(
      JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }),
    );
    return await action(directory);
  } finally {
    await lock.close();
    await unlink(path);
  }
}

export async function ensureStateDirectory(
  root: string,
  create = false,
): Promise<string> {
  for (const path of [join(root, ".codepatrol"), stateDirectory(root)]) {
    if (create)
      await mkdir(path, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      });
    if (!(await lstat(path)).isDirectory())
      throw new Error("State directory must be a real directory, not a symlink");
  }
  return stateDirectory(root);
}

export async function saveRun(state: RunState, initial = false): Promise<void> {
  const json = boundedJson(state, MAX_STATE_BYTES, "Run state");
  if (state.plan) boundedJson(state.plan, MAX_PLAN_BYTES, "Execution plan");
  runStateSchema.parse(state);
  const directory = await ensureStateDirectory(state.root);
  const path = join(directory, `${state.runId}.json`);
  const temp = join(directory, `${state.runId}.${randomUUID()}.tmp`);
  try {
    const file = await open(temp, "wx", 0o600);
    try {
      await file.writeFile(json);
      await file.sync();
    } finally {
      await file.close();
    }
    // Link publishes a complete fresh state exclusively, without an empty reservation file.
    if (initial) await link(temp, path);
    else await rename(temp, path);
    const dir = await open(directory, "r");
    try {
      await dir.sync();
    } finally {
      await dir.close();
    }
  } finally {
    await unlink(temp).catch(() => {});
  }
}

export async function readRun(root: string, runId: string): Promise<RunState> {
  z.string().uuid().parse(runId);
  const canonicalRoot = await realpath(root);
  await ensureStateDirectory(canonicalRoot);
  const state = runStateSchema.parse(
    await readJsonFile(
      join(stateDirectory(canonicalRoot), `${runId}.json`),
      MAX_STATE_BYTES,
    ),
  );
  if (state.plan) boundedJson(state.plan, MAX_PLAN_BYTES, "Execution plan");
  if (
    state.root !== canonicalRoot ||
    state.runId !== runId ||
    state.workspace !== join(stateDirectory(canonicalRoot), "workspaces", runId)
  ) {
    throw new Error("Run state identity mismatch");
  }
  return state;
}

export async function readRuns(root: string): Promise<RunState[]> {
  const canonicalRoot = await realpath(root);
  const directory = await ensureStateDirectory(canonicalRoot);
  const names = (await readdir(directory))
    .filter((name) => /^[a-f0-9-]{36}\.json$/.test(name))
    .sort();
  if (names.length > MAX_RUNS) throw new Error("Run state count exceeds limit");
  return Promise.all(names.map((name) => readRun(canonicalRoot, name.slice(0, -5))));
}

export const listRuns = readRuns;
