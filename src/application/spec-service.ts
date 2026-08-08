import type { StateSnapshot, StateStore } from "../adapters/state-store.js";
import { fail } from "../core/errors.js";
import type { CapabilityRef, ExecutionIdentity, TodoItem } from "../core/execution.js";
import type {
  DraftInitiative,
  Initiative,
  SpecExecution,
  SpecResult,
  SpecRevision,
  WorkDefinition,
} from "../core/initiative.js";
import { rejectUnknown, requireArray, requireRecord, requireText } from "../core/initiative.js";
import { completeSpec, type SpecDocument, startSpec, validateSpecDocument } from "../core/spec-lifecycle.js";
import { createWave, type Wave } from "../core/wave.js";
import { activeAttempt, createWork, type Work } from "../core/work.js";

export type { SpecDocument };

export function parseDocument(value: unknown): SpecDocument {
  const record = requireRecord(value, "spec document");
  rejectUnknown(record, ["schemaVersion", "type", "initiative", "waves", "works"], "spec document");
  const schemaVersion = record.schemaVersion;
  if (schemaVersion !== 1)
    fail("INVALID_INPUT", `spec document: unsupported schemaVersion ${JSON.stringify(schemaVersion)}`);
  if (record.type !== DOCUMENT_TYPE) fail("INVALID_INPUT", `spec document.type must be ${DOCUMENT_TYPE}`);
  const initiative = requireRecord(record.initiative, "spec document.initiative");
  rejectUnknown(initiative, ["id", "title", "intent"], "spec document.initiative");
  if (typeof initiative.id !== "string" || initiative.id.trim() === "") {
    fail("INVALID_INPUT", "spec document.initiative.id is required");
  }
  requireText(initiative.title, "spec document.initiative.title");
  requireText(initiative.intent, "spec document.initiative.intent");
  if (!Array.isArray(record.waves)) fail("INVALID_INPUT", "spec document.waves must be an array");
  const waves = record.waves.map((entry, index) => {
    const v = requireRecord(entry, `spec document.waves[${index}]`);
    rejectUnknown(v, ["id", "title", "intent"], `spec document.waves[${index}]`);
    return {
      id: requireText(v.id, `spec document.waves[${index}].id`),
      title: requireText(v.title, `spec document.waves[${index}].title`),
      intent: requireText(v.intent, `spec document.waves[${index}].intent`),
    };
  });
  if (!Array.isArray(record.works)) fail("INVALID_INPUT", "spec document.works must be an array");
  const works = record.works.map((entry, index) => {
    const w = requireRecord(entry, `spec document.works[${index}]`);
    rejectUnknown(
      w,
      ["id", "wave", "title", "description", "workType", "priority", "delivery", "acceptance", "blockedBy"],
      `spec document.works[${index}]`,
    );
    if (typeof w.id !== "string" || w.id.trim() === "") {
      fail("INVALID_INPUT", `spec document.works[${index}].id is required`);
    }
    requireText(w.title, `spec document.works[${index}].title`);
    requireText(w.description, `spec document.works[${index}].description`);
    const workType = w.workType;
    if (workType !== "bug" && workType !== "feature" && workType !== "task") {
      fail("INVALID_INPUT", `spec document.works[${index}].workType must be bug|feature|task`);
    }
    const priority = w.priority;
    if (priority !== "p0" && priority !== "p1" && priority !== "p2" && priority !== "p3") {
      fail("INVALID_INPUT", `spec document.works[${index}].priority must be p0|p1|p2|p3`);
    }
    return {
      id: w.id as string,
      wave: requireText(w.wave, `spec document.works[${index}].wave`),
      title: w.title as string,
      description: w.description as string,
      workType: workType as "bug" | "feature" | "task",
      priority: priority as "p0" | "p1" | "p2" | "p3",
      delivery:
        w.delivery === "code" || w.delivery === "no-code"
          ? w.delivery
          : fail("INVALID_INPUT", `spec document.works[${index}].delivery must be code|no-code`),
      acceptance: requireArray(w.acceptance, `spec document.works[${index}].acceptance`).map((c, ci) =>
        requireText(c, `spec document.works[${index}].acceptance[${ci}]`),
      ),
      blockedBy: requireArray(w.blockedBy, `spec document.works[${index}].blockedBy`).map((b, bi) =>
        requireText(b, `spec document.works[${index}].blockedBy[${bi}]`),
      ),
    };
  });
  return {
    schemaVersion: 1 as const,
    type: DOCUMENT_TYPE,
    initiative: {
      id: initiative.id as string,
      title: initiative.title as string,
      intent: initiative.intent as string,
    },
    waves: waves as SpecDocument["waves"],
    works: works as SpecDocument["works"],
  };
}

export const DOCUMENT_TYPE = "codepatrol-initiative-document";

export interface SpecStartResult {
  initiative: string;
  method: "spec";
  runId: string;
}

export interface SpecShowResult {
  initiative: Initiative;
  works: Work[];
}

export class SpecService {
  constructor(
    private readonly store: StateStore,
    private readonly now: () => string,
    private readonly uuid: () => string,
  ) {}

  async start(input: {
    initiativeId: string;
    todo: TodoItem[];
    harness: string;
    model?: string;
    profile?: string;
    capabilities?: CapabilityRef[];
    compositionDigest?: string;
  }): Promise<SpecStartResult> {
    let result: SpecStartResult | undefined;
    await this.store.transact((snapshot) => {
      const existing = snapshot.initiatives.get(input.initiativeId);
      if (this.hasActiveWork(snapshot)) {
        fail("INVALID_STATE", "a work attempt is active; cannot start spec");
      }

      const runId = this.uuid();
      for (const other of snapshot.initiatives.values()) {
        if (other.specExecutions.some((e) => e.runId === runId)) {
          fail("CONFLICT", `run id ${runId} already exists in repository state`);
        }
      }
      for (const other of snapshot.works.values()) {
        if (other.attempts.some((a) => a.runId === runId)) {
          fail("CONFLICT", `run id ${runId} already exists in repository state`);
        }
      }

      const execution: ExecutionIdentity<"spec"> = { role: "spec", harness: input.harness };
      if (input.model !== undefined) execution.model = input.model;
      if (input.profile !== undefined) execution.profile = input.profile;
      if (input.capabilities !== undefined) execution.capabilities = input.capabilities;
      if (input.compositionDigest !== undefined) execution.compositionDigest = input.compositionDigest;

      const { initiative } = startSpec(existing !== undefined ? (existing as DraftInitiative) : undefined, {
        id: input.initiativeId,
        runId,
        execution,
        todo: input.todo,
        now: this.now(),
      });

      const initiativeChanges = new Map<string, Initiative>();
      initiativeChanges.set(initiative.id, initiative);
      result = { initiative: initiative.id, method: "spec", runId };
      return { message: `codepatrol: start spec ${initiative.id}`, initiatives: initiativeChanges };
    });
    return result as SpecStartResult;
  }

  async validate(
    initiativeId: string,
    runId: string,
    file: SpecDocument,
  ): Promise<{
    initiative: string;
    valid: boolean;
    plan: { created: WorkDefinition[]; updated: WorkDefinition[]; deleted: string[] };
  }> {
    const snapshot = await this.store.read();
    const initiative = snapshot.initiatives.get(initiativeId);
    if (initiative === undefined) fail("NOT_FOUND", `initiative ${initiativeId} does not exist`);
    const active = initiative.specExecutions.find((e) => e.runId === runId);
    if (active === undefined) fail("INVALID_STATE", `no spec execution with run ${runId} for ${initiativeId}`);
    if (active.status !== "active") fail("INVALID_STATE", `spec run ${runId} of ${initiativeId} is not active`);

    if (file.initiative.id !== initiativeId) {
      fail(
        "INVALID_INPUT",
        `spec document initiative id ${file.initiative.id} does not match initiative ${initiativeId}`,
      );
    }

    const initiativeWorks = new Map([...snapshot.works].filter(([_, w]) => w.initiative === initiativeId));
    const plan = validateSpecDocument(file, initiativeWorks);
    return { initiative: initiativeId, valid: true, plan };
  }

  async complete(
    initiativeId: string,
    runId: string,
    result: SpecResult,
    file?: SpecDocument,
  ): Promise<{ initiative: Initiative; works: Map<string, Work>; revision?: SpecRevision }> {
    let outcome: { initiative: Initiative; works: Map<string, Work>; revision?: SpecRevision } | undefined;
    await this.store.transact((snapshot) => {
      const initiative = snapshot.initiatives.get(initiativeId);
      if (initiative === undefined) fail("NOT_FOUND", `initiative ${initiativeId} does not exist`);

      let document: SpecDocument | undefined;
      if (file !== undefined) {
        document = file;
      } else if (result.decision === "apply") {
        fail("INVALID_INPUT", "spec file is required for an apply decision");
      }

      const completed = completeSpec(initiative, runId, result, this.now(), document);

      if (completed.revision !== undefined) {
        const initiativeWorks = new Map([...snapshot.works].filter(([_, w]) => w.initiative === initiativeId));
        const plan = validateSpecDocument(document!, initiativeWorks);

        const initiativeChanges = new Map<string, Initiative>();
        initiativeChanges.set(initiativeId, completed.initiative);

        const workChanges = new Map<string, Work>();
        const waveChanges = new Map<string, Wave>();
        const now = this.now();
        const revisionNumber = completed.revision.revision;

        // Waves declared by the revision are created once and then carried
        // forward; an existing Wave keeps its recorded verdict.
        const declaredWaves = new Set(document!.waves.map((w) => w.id));
        for (const def of document!.waves) {
          const existing = snapshot.waves.get(def.id);
          if (existing === undefined) {
            waveChanges.set(def.id, createWave({ id: def.id, title: def.title, intent: def.intent, now }));
          } else if (existing.title !== def.title || existing.intent !== def.intent) {
            waveChanges.set(def.id, { ...existing, title: def.title, intent: def.intent, updatedAt: now });
          }
        }
        for (const existing of snapshot.waves.values()) {
          if (existing.initiative === initiativeId && !declaredWaves.has(existing.id)) {
            waveChanges.set(existing.id, null as unknown as Wave);
          }
        }

        for (const def of plan.deleted) {
          workChanges.set(def, null as unknown as Work);
        }

        for (const def of plan.created) {
          const work = createWork({
            id: def.id,
            title: def.title,
            description: def.description,
            workType: def.workType,
            priority: def.priority,
            delivery: def.delivery,
            acceptance: def.acceptance,
            blockedBy: def.blockedBy,
            specRevision: revisionNumber,
            now,
          });
          workChanges.set(def.id, work);
        }

        for (const def of plan.updated) {
          const existing = snapshot.works.get(def.id);
          if (existing === undefined) fail("STATE_CORRUPT", `work ${def.id} not found for update`);
          const updated: Work = {
            ...existing,
            title: def.title,
            description: def.description,
            workType: def.workType,
            priority: def.priority,
            delivery: def.delivery,
            acceptance: def.acceptance,
            blockedBy: def.blockedBy,
            specRevision: revisionNumber,
          };
          workChanges.set(def.id, updated);
        }

        outcome = { initiative: completed.initiative, works: workChanges, revision: completed.revision };
        return {
          message: `codepatrol: spec apply ${initiativeId} r${revisionNumber}`,
          initiatives: initiativeChanges,
          ...(waveChanges.size > 0 ? { waves: waveChanges } : {}),
          works: workChanges,
        };
      }

      const initiativeChanges = new Map<string, Initiative>();
      initiativeChanges.set(initiativeId, completed.initiative);
      outcome = { initiative: completed.initiative, works: new Map() };
      return { message: `codepatrol: spec discard ${initiativeId}`, initiatives: initiativeChanges };
    });
    return outcome as { initiative: Initiative; works: Map<string, Work>; revision?: SpecRevision };
  }

  async show(initiativeId: string, _revision?: number): Promise<SpecShowResult> {
    const snapshot = await this.store.read();
    const initiative = snapshot.initiatives.get(initiativeId);
    if (initiative === undefined) fail("NOT_FOUND", `initiative ${initiativeId} does not exist`);
    const works = [...snapshot.works.values()].filter((w) => w.initiative === initiativeId);
    return { initiative, works };
  }

  async history(
    initiativeId: string,
  ): Promise<{ initiative: string; executions: SpecExecution[]; revisions: SpecRevision[] }> {
    const snapshot = await this.store.read();
    const initiative = snapshot.initiatives.get(initiativeId);
    if (initiative === undefined) fail("NOT_FOUND", `initiative ${initiativeId} does not exist`);
    return {
      initiative: initiative.id,
      executions: initiative.specExecutions,
      revisions: initiative.specRevisions,
    };
  }

  private hasActiveWork(snapshot: StateSnapshot): boolean {
    return [...snapshot.works.values()].some((w) => activeAttempt(w) !== undefined);
  }
}
