import { CodepatrolError, fail } from "../core/errors.js";
import { isInitiativeId, isWaveId, isWorkId } from "../core/identifiers.js";
import { type Initiative, parseInitiative } from "../core/initiative.js";
import { canonicalJson } from "../core/json.js";
import { validateState } from "../core/validate.js";
import { parseWave, type Wave } from "../core/wave.js";
import { parseWork, type Work } from "../core/work.js";
import type { Git } from "./git.js";

export const STATE_REF = "refs/codepatrol/state";
const INITIATIVE_DIR = ".codepatrol/initiatives";
const WAVE_DIR = ".codepatrol/waves";
const WORK_DIR = ".codepatrol/works";
const ZERO = "0000000000000000000000000000000000000000";
const MAX_RETRIES = 5;

const COMMIT_ENV: Record<string, string> = {
  GIT_AUTHOR_NAME: "codepatrol",
  GIT_AUTHOR_EMAIL: "codepatrol@localhost",
  GIT_COMMITTER_NAME: "codepatrol",
  GIT_COMMITTER_EMAIL: "codepatrol@localhost",
};

export interface StateSnapshot {
  commit: string | null;
  initiatives: ReadonlyMap<string, Initiative>;
  waves: ReadonlyMap<string, Wave>;
  works: ReadonlyMap<string, Work>;
}

export interface StateChange {
  message: string;
  initiatives?: ReadonlyMap<string, Initiative | null>;
  waves?: ReadonlyMap<string, Wave | null>;
  works?: ReadonlyMap<string, Work | null>;
}

export function initiativePath(id: string): string {
  return `${INITIATIVE_DIR}/${id}.json`;
}

function wavePath(id: string): string {
  return `${WAVE_DIR}/${id}.json`;
}

function workPath(id: string): string {
  return `${WORK_DIR}/${id}.json`;
}

export class StateStore {
  constructor(private readonly git: Git) {}

  async read(): Promise<StateSnapshot> {
    const commit = await this.resolve();
    if (commit === null) {
      return { commit: null, initiatives: new Map(), waves: new Map(), works: new Map() };
    }
    return this.readCommit(commit);
  }

  async readCommit(commit: string): Promise<StateSnapshot> {
    const listing = await this.git.exec(["ls-tree", "-r", "-z", commit]);
    const initiatives = new Map<string, Initiative>();
    const waves = new Map<string, Wave>();
    const works = new Map<string, Work>();
    for (const entry of listing.stdout.split("\0")) {
      if (entry === "") continue;
      const tab = entry.indexOf("\t");
      const meta = entry.slice(0, tab);
      const path = entry.slice(tab + 1);
      const [mode, kind, blob] = meta.split(" ");
      if (mode !== "100644" || kind !== "blob" || blob === undefined) {
        fail("STATE_CORRUPT", `unexpected entry in state tree: ${entry}`);
      }
      if (path.startsWith(`${INITIATIVE_DIR}/`)) {
        const id = idFromPath(path, INITIATIVE_DIR, isInitiativeId);
        const content = await this.readBlob(blob);
        const initiative = parseState(() => parseInitiative(JSON.parse(content), path), path);
        if (initiative.id !== id)
          fail("STATE_CORRUPT", `${path}: filename id ${id} does not match document id ${initiative.id}`);
        initiatives.set(id, initiative);
      } else if (path.startsWith(`${WAVE_DIR}/`)) {
        const id = idFromPath(path, WAVE_DIR, isWaveId);
        const content = await this.readBlob(blob);
        const wave = parseState(() => parseWave(JSON.parse(content), path), path);
        if (wave.id !== id) fail("STATE_CORRUPT", `${path}: filename id ${id} does not match document id ${wave.id}`);
        waves.set(id, wave);
      } else if (path.startsWith(`${WORK_DIR}/`)) {
        const id = idFromPath(path, WORK_DIR, isWorkId);
        const content = await this.readBlob(blob);
        const work = parseState(() => parseWork(JSON.parse(content), path), path);
        if (work.id !== id) fail("STATE_CORRUPT", `${path}: filename id ${id} does not match document id ${work.id}`);
        works.set(id, work);
      } else {
        fail("STATE_CORRUPT", `unexpected path in state tree: ${path}`);
      }
    }
    try {
      validateState(initiatives, waves, works);
    } catch (error) {
      if (error instanceof CodepatrolError && error.code !== "STATE_CORRUPT") {
        fail("STATE_CORRUPT", error.message);
      }
      throw error;
    }
    return { commit, initiatives, waves, works };
  }

  async transact(mutate: (snapshot: StateSnapshot) => StateChange | Promise<StateChange>): Promise<StateSnapshot> {
    for (let round = 0; round < MAX_RETRIES; round += 1) {
      const snapshot = await this.read();
      const change = await mutate(snapshot);
      if (change.initiatives === undefined && change.waves === undefined && change.works === undefined) return snapshot;
      const files = new Map<string, string>();
      for (const [id, initiative] of snapshot.initiatives) files.set(initiativePath(id), canonicalJson(initiative));
      for (const [id, wave] of snapshot.waves) files.set(wavePath(id), canonicalJson(wave));
      for (const [id, work] of snapshot.works) files.set(workPath(id), canonicalJson(work));
      for (const [id, initiative] of change.initiatives ?? new Map()) {
        if (initiative === null) files.delete(initiativePath(id));
        else files.set(initiativePath(id), canonicalJson(initiative));
      }
      for (const [id, wave] of change.waves ?? new Map()) {
        if (wave === null) files.delete(wavePath(id));
        else files.set(wavePath(id), canonicalJson(wave));
      }
      for (const [id, work] of change.works ?? new Map()) {
        if (work === null) files.delete(workPath(id));
        else files.set(workPath(id), canonicalJson(work));
      }
      const newCommit = await this.writeTree(files, change.message, snapshot.commit);
      const candidate = await this.readCommit(newCommit);
      const expected = snapshot.commit ?? ZERO;
      const cas = await this.git.exec(["update-ref", STATE_REF, newCommit, expected], { allowFailure: true });
      if (cas.code === 0) return candidate;
    }
    fail("CONFLICT", `could not commit state to ${STATE_REF} after ${MAX_RETRIES} attempts`);
  }

  private async resolve(): Promise<string | null> {
    const result = await this.git.exec(["rev-parse", "--verify", "--quiet", STATE_REF], { allowFailure: true });
    const commit = result.stdout.trim();
    return result.code === 0 && commit !== "" ? commit : null;
  }

  private async readBlob(sha: string): Promise<string> {
    const result = await this.git.exec(["cat-file", "blob", sha]);
    return result.stdout;
  }

  private async writeTree(files: ReadonlyMap<string, string>, message: string, parent: string | null): Promise<string> {
    const blobs = new Map<string, string>();
    for (const [path, content] of files) {
      const blob = await this.git.exec(["hash-object", "-w", "--stdin"], { input: content });
      blobs.set(path, blob.stdout.trim());
    }
    const tree = await this.buildTree("", blobs);
    const args = ["commit-tree", tree, "-m", message];
    if (parent !== null) args.push("-p", parent);
    const commit = await this.git.exec(args, { env: COMMIT_ENV });
    return commit.stdout.trim();
  }

  private async buildTree(prefix: string, blobs: ReadonlyMap<string, string>): Promise<string> {
    const entries: string[] = [];
    const subdirs = new Set<string>();
    for (const [path, sha] of blobs) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash === -1) {
        entries.push(`100644 blob ${sha}\t${rest}`);
      } else {
        subdirs.add(rest.slice(0, slash));
      }
    }
    for (const dir of subdirs) {
      const subTree = await this.buildTree(`${prefix}${dir}/`, blobs);
      entries.push(`040000 tree ${subTree}\t${dir}`);
    }
    entries.sort();
    const result = await this.git.exec(["mktree"], { input: `${entries.join("\n")}\n` });
    return result.stdout.trim();
  }
}

function idFromPath(path: string, dir: string, valid: (id: string) => boolean): string {
  const name = path.slice(dir.length + 1);
  if (!name.endsWith(".json")) fail("STATE_CORRUPT", `unexpected path in state tree: ${path}`);
  const id = name.slice(0, name.length - ".json".length);
  if (!valid(id)) fail("STATE_CORRUPT", `invalid id in state path: ${path}`);
  return id;
}

function parseState<T>(parse: () => T, path: string): T {
  try {
    return parse();
  } catch (error) {
    if (error instanceof CodepatrolError && error.code === "STATE_CORRUPT") throw error;
    const message = error instanceof Error ? error.message : String(error);
    fail("STATE_CORRUPT", `${path}: ${message}`);
  }
}
