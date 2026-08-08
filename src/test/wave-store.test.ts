import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { localGit } from "../adapters/git.js";
import { StateStore } from "../adapters/state-store.js";
import type { Initiative } from "../core/initiative.js";
import { validateState } from "../core/validate.js";
import type { Wave } from "../core/wave.js";
import { createWave } from "../core/wave.js";
import type { Work } from "../core/work.js";

function createStore() {
  const parent = mkdtempSync(join(tmpdir(), "codepatrol-wave-"));
  const repoPath = join(parent, "repo");
  mkdirSync(repoPath, { recursive: true });
  const env: Record<string, string> = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" };
  env.GIT_AUTHOR_NAME = "test";
  env.GIT_AUTHOR_EMAIL = "test@localhost";
  env.GIT_COMMITTER_NAME = "test";
  env.GIT_COMMITTER_EMAIL = "test@localhost";
  const git = (args: string[]) => execFileSync("git", args, { cwd: repoPath, encoding: "utf8", env }).trim();
  git(["init", "-b", "main"]);
  git(["config", "user.name", "test"]);
  git(["config", "user.email", "test@localhost"]);
  git(["commit", "--allow-empty", "-m", "initial"]);
  return { parent, repoPath, store: new StateStore(localGit(repoPath)) };
}

test("wave round-trips through store", async () => {
  const repo = createStore();
  try {
    const now = new Date().toISOString();
    const wave = createWave({ id: "WAVE-1.1", title: "Test wave", intent: "test intent", now });

    await repo.store.transact((_snapshot) => {
      const initiative = {
        schemaVersion: 1,
        type: "codepatrol-initiative",
        id: "INIT-1",
        definitionState: "draft",
        title: "Test",
        intent: "test",
        currentSpecRevision: 0,
        specRevisions: [],
        specExecutions: [],
        createdAt: now,
        updatedAt: now,
      } as unknown as Initiative;
      return {
        message: "create initiative and wave",
        initiatives: new Map([["INIT-1", initiative]]),
        waves: new Map([["WAVE-1.1", wave as unknown as Wave]]),
      };
    });

    const snapshot = await repo.store.read();
    assert.ok(snapshot.waves.has("WAVE-1.1"));
    const read = snapshot.waves.get("WAVE-1.1");
    assert.equal(read?.id, "WAVE-1.1");
    assert.equal(read?.title, "Test wave");
    assert.equal(read?.initiative, "INIT-1");
  } finally {
    rmSync(repo.parent, { recursive: true, force: true });
  }
});

test("wave can be updated and deleted via store", async () => {
  const repo = createStore();
  try {
    const now = new Date().toISOString();
    const wave = createWave({ id: "WAVE-1.1", title: "Test", intent: "test", now });

    await repo.store.transact((_snapshot) => {
      const initiative = {
        schemaVersion: 1,
        type: "codepatrol-initiative",
        id: "INIT-1",
        definitionState: "draft",
        title: "Test",
        intent: "test",
        currentSpecRevision: 0,
        specRevisions: [],
        specExecutions: [],
        createdAt: now,
        updatedAt: now,
      } as unknown as Initiative;
      return {
        message: "create",
        initiatives: new Map([["INIT-1", initiative]]),
        waves: new Map([["WAVE-1.1", wave as unknown as Wave]]),
      };
    });

    // Update
    const updated = { ...wave, title: "Updated wave", updatedAt: new Date().toISOString() };
    await repo.store.transact(() => {
      return { message: "update", waves: new Map([["WAVE-1.1", updated as unknown as Wave]]) };
    });

    let snapshot = await repo.store.read();
    assert.equal(snapshot.waves.get("WAVE-1.1")?.title, "Updated wave");

    // Delete
    await repo.store.transact(() => {
      return { message: "delete", waves: new Map([["WAVE-1.1", null]]) };
    });

    snapshot = await repo.store.read();
    assert.equal(snapshot.waves.has("WAVE-1.1"), false);
  } finally {
    rmSync(repo.parent, { recursive: true, force: true });
  }
});

test("validateState rejects Wave with missing Initiative", () => {
  const initiatives = new Map<string, Initiative>();
  const waves = new Map<string, Wave>();
  const works = new Map<string, Work>();

  waves.set("WAVE-1.1", {
    schemaVersion: 1,
    type: "codepatrol-wave",
    id: "WAVE-1.1",
    initiative: "INIT-99",
    title: "t",
    intent: "i",
    verdict: null,
    createdAt: "now",
    updatedAt: "now",
  });
  assert.throws(() => validateState(initiatives, waves, works), /WAVE-1.1 refers to missing initiative/);
});

test("validateState rejects Work with missing wave", () => {
  const initiatives = new Map<string, Initiative>();
  const waves = new Map<string, Wave>();
  const works = new Map<string, Work>();

  initiatives.set("INIT-1", {
    schemaVersion: 1,
    type: "codepatrol-initiative",
    id: "INIT-1",
    definitionState: "defined",
    title: "t",
    intent: "i",
    currentSpecRevision: 1,
    specRevisions: [],
    specExecutions: [],
    createdAt: "now",
    updatedAt: "now",
  } as unknown as Initiative);
  works.set("WORK-1.1.1", {
    schemaVersion: 1,
    type: "codepatrol-work",
    id: "WORK-1.1.1",
    initiative: "INIT-1",
    wave: "WAVE-1.99",
    title: "t",
    description: "d",
    workType: "task",
    priority: "p2",
    delivery: "code",
    acceptance: [],
    blockedBy: [],
    specRevision: 1,
    workflow: { state: "ready", stage: "plan", updatedAt: "now" },
    attempts: [],
    completion: null,
    dependencyRevisions: [],
    github: {},
    createdAt: "now",
  } as unknown as Work);
  assert.throws(() => validateState(initiatives, waves, works), /WORK-1.1.1 refers to missing wave/);
});

test("validateState rejects Work whose wave Initiative disagrees", () => {
  const initiatives = new Map<string, Initiative>();
  const waves = new Map<string, Wave>();
  const works = new Map<string, Work>();

  initiatives.set("INIT-1", {
    schemaVersion: 1,
    type: "codepatrol-initiative",
    id: "INIT-1",
    definitionState: "defined",
    title: "t",
    intent: "i",
    currentSpecRevision: 1,
    specRevisions: [],
    specExecutions: [],
    createdAt: "now",
    updatedAt: "now",
  } as unknown as Initiative);
  initiatives.set("INIT-2", {
    schemaVersion: 1,
    type: "codepatrol-initiative",
    id: "INIT-2",
    title: "t",
    intent: "i",
    definitionState: "defined",
    currentSpecRevision: 1,
    specExecutions: [],
    github: {},
    dependencyDrafts: [],
    createdAt: "now",
    updatedAt: "now",
  } as unknown as Initiative);
  waves.set("WAVE-1.1", {
    schemaVersion: 1,
    type: "codepatrol-wave",
    id: "WAVE-1.1",
    initiative: "INIT-1",
    title: "t",
    intent: "i",
    verdict: null,
    createdAt: "now",
    updatedAt: "now",
  });
  works.set("WORK-2.1.1", {
    schemaVersion: 1,
    type: "codepatrol-work",
    id: "WORK-2.1.1",
    initiative: "INIT-2",
    wave: "WAVE-1.1",
    title: "t",
    description: "d",
    workType: "task",
    priority: "p2",
    delivery: "code",
    acceptance: [],
    blockedBy: [],
    specRevision: 1,
    workflow: { state: "ready", stage: "plan", updatedAt: "now" },
    attempts: [],
    completion: null,
    dependencyRevisions: [],
    github: {},
    createdAt: "now",
  } as unknown as Work);
  assert.throws(() => validateState(initiatives, waves, works), /wave.*belongs to initiative/);
});
