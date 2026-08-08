import { fail } from "./errors.js";
import type { ExecutionIdentity, TodoItem } from "./execution.js";
import { assertAcyclic } from "./graph.js";
import { initiativeIdOf, parseInitiativeId } from "./identifiers.js";
import type {
  DefinedInitiative,
  DraftInitiative,
  Initiative,
  InitiativeDefinition,
  SpecExecution,
  SpecResult,
  SpecRevision,
  WaveDefinition,
  WorkDefinition,
} from "./initiative.js";
import { canonicalJson, sha256Hex } from "./json.js";
import type { Work } from "./work.js";

export interface SpecDocument {
  schemaVersion: 1;
  type: "codepatrol-initiative-document";
  initiative: {
    id: string;
    title: string;
    intent: string;
  };
  waves: WaveDefinition[];
  works: WorkDefinition[];
}

export function canonicalDefinition(definition: InitiativeDefinition): string {
  const sorted = {
    title: definition.title,
    intent: definition.intent,
    waves: [...definition.waves]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((w) => ({ id: w.id, title: w.title, intent: w.intent })),
    works: [...definition.works]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((w) => ({
        id: w.id,
        wave: w.wave,
        title: w.title,
        description: w.description,
        workType: w.workType,
        priority: w.priority,
        delivery: w.delivery,
        acceptance: w.acceptance,
        blockedBy: [...w.blockedBy].sort((x, y) => x.localeCompare(y)),
      })),
  };
  return canonicalJson(sorted);
}

export function computeDocumentHash(definition: InitiativeDefinition): string {
  return sha256Hex(canonicalDefinition(definition));
}

export function startSpec(
  initiative: Initiative | undefined,
  input: {
    id: string;
    runId: string;
    execution: ExecutionIdentity<"spec">;
    todo: TodoItem[];
    now: string;
  },
): { initiative: Initiative; execution: SpecExecution } {
  if (initiative !== undefined) {
    const active = initiative.specExecutions.find((e) => e.status === "active");
    if (active !== undefined) {
      fail("INVALID_STATE", `${initiative.id} already has an active spec execution (${active.runId})`);
    }
    const newExecution: SpecExecution = {
      runId: input.runId,
      status: "active",
      execution: input.execution,
      todo: input.todo,
      baseRevision: initiative.definitionState === "defined" ? initiative.currentSpecRevision : null,
      startedAt: input.now,
    };
    return {
      initiative: {
        ...initiative,
        specExecutions: [...initiative.specExecutions, newExecution],
        updatedAt: input.now,
      },
      execution: newExecution,
    };
  }

  const newInitiative: DraftInitiative = {
    schemaVersion: 1,
    type: "codepatrol-initiative",
    id: parseInitiativeId(input.id),
    definitionState: "draft",
    currentSpecRevision: null,
    specRevisions: [],
    specExecutions: [],
    createdAt: input.now,
    updatedAt: input.now,
  };
  const newExecution: SpecExecution = {
    runId: input.runId,
    status: "active",
    execution: input.execution,
    todo: input.todo,
    baseRevision: null,
    startedAt: input.now,
  };
  newInitiative.specExecutions.push(newExecution);
  return { initiative: newInitiative, execution: newExecution };
}

export function completeSpec(
  initiative: Initiative,
  runId: string,
  result: SpecResult,
  now: string,
  document?: SpecDocument,
): { initiative: Initiative; works: Map<string, Work>; revision?: SpecRevision } {
  const active = initiative.specExecutions.find((e) => e.status === "active");
  if (active === undefined) {
    const previous = initiative.specExecutions.find((e) => e.runId === runId);
    if (previous === undefined) {
      fail("INVALID_STATE", `${initiative.id} has no spec execution with run ${runId}`);
    }
    if (previous.status !== "completed" || previous.result === undefined) {
      fail("INVALID_STATE", `spec run ${runId} of ${initiative.id} is not complete`);
    }
    if (!normalizedResultEqual(previous.result, result)) {
      fail("RESULT_CONFLICT", `spec run ${runId} of ${initiative.id} already completed with a different result`);
    }
    if (result.decision === "apply") {
      const revision = initiative.specRevisions.find((r) => r.runId === runId);
      if (revision === undefined) {
        fail("STATE_CORRUPT", `completed apply spec run ${runId} has no revision`);
      }
      return { initiative, works: new Map(), revision };
    }
    return { initiative, works: new Map() };
  }

  if (active.runId !== runId) {
    fail("INVALID_STATE", `${initiative.id} active spec run is ${active.runId}, not ${runId}`);
  }

  validateTodoCoverage(active, result);

  const baseRevision = active.baseRevision;
  if (initiative.definitionState === "defined" && baseRevision !== null) {
    if (initiative.currentSpecRevision !== baseRevision) {
      fail(
        "CONFLICT",
        `${initiative.id}: spec base revision ${baseRevision} does not match current revision ${initiative.currentSpecRevision}`,
      );
    }
  }

  const completed: SpecExecution = {
    ...active,
    status: "completed",
    finishedAt: now,
    result,
  };

  if (result.decision === "discard") {
    return {
      initiative: {
        ...initiative,
        specExecutions: replaceActive(initiative.specExecutions, completed),
        updatedAt: now,
      },
      works: new Map(),
    };
  }

  if (document === undefined) {
    fail("INVALID_INPUT", "spec file is required for an apply decision");
  }

  if (document.initiative.id !== initiative.id) {
    fail(
      "INVALID_INPUT",
      `spec document initiative id ${document.initiative.id} does not match initiative ${initiative.id}`,
    );
  }

  const documentHash = computeDocumentHash({
    title: document.initiative.title,
    intent: document.initiative.intent,
    waves: document.waves,
    works: document.works,
  });

  const nextRevision =
    initiative.specRevisions.length > 0
      ? initiative.specRevisions[initiative.specRevisions.length - 1]!.revision + 1
      : 1;

  const applied: SpecExecution = {
    ...completed,
    documentHash,
    appliedRevision: nextRevision,
  };

  const revision: SpecRevision = {
    revision: nextRevision,
    runId,
    createdAt: now,
    summary: result.summary,
    documentHash,
    definition: {
      title: document.initiative.title,
      intent: document.initiative.intent,
      waves: document.waves,
      works: document.works,
    },
  };

  const defined: DefinedInitiative = {
    ...initiative,
    definitionState: "defined",
    title: document.initiative.title,
    intent: document.initiative.intent,
    currentSpecRevision: nextRevision,
    specRevisions: [...initiative.specRevisions, revision],
    specExecutions: replaceActive(initiative.specExecutions, applied),
    updatedAt: now,
  };

  return { initiative: defined, works: new Map(), revision };
}

export function validateSpecDocument(
  document: SpecDocument,
  existingWorks: ReadonlyMap<string, Work>,
): { created: WorkDefinition[]; updated: WorkDefinition[]; deleted: string[] } {
  const workIds = new Set<string>();
  const created: WorkDefinition[] = [];
  const updated: WorkDefinition[] = [];
  const deleted: string[] = [];

  const waveIds = new Set<string>();
  for (const wave of document.waves) {
    if (waveIds.has(wave.id)) fail("INVALID_INPUT", `duplicate wave id ${wave.id} in spec document`);
    if (initiativeIdOf(wave.id) !== document.initiative.id) {
      fail("INVALID_INPUT", `wave ${wave.id} does not belong to initiative ${document.initiative.id}`);
    }
    waveIds.add(wave.id);
  }

  for (const entry of document.works) {
    validateWorkDefinition(entry);
    if (workIds.has(entry.id)) fail("INVALID_INPUT", `duplicate work id ${entry.id} in spec document`);
    if (!waveIds.has(entry.wave)) {
      fail("INVALID_INPUT", `${entry.id} refers to wave ${entry.wave} which the spec document does not declare`);
    }
    workIds.add(entry.id);
  }

  // A Wave that already contains a started Work may not be removed: its Works
  // carry evidence that the revision cannot invalidate.
  for (const existing of existingWorks.values()) {
    const hasStarted = existing.workflow.state !== "ready" || existing.attempts.length > 0;
    if (hasStarted && !waveIds.has(existing.wave)) {
      fail(
        "INVALID_STATE",
        `wave ${existing.wave} contains started work ${existing.id} and cannot be removed from the spec document`,
      );
    }
  }

  for (const entry of document.works) {
    if (entry.blockedBy.includes(entry.id)) {
      fail("INVALID_INPUT", `${entry.id} cannot block itself`);
    }
    for (const blocker of entry.blockedBy) {
      if (!workIds.has(blocker) && !existingWorks.has(blocker)) {
        fail("INVALID_INPUT", `${entry.id} depends on unknown work ${blocker}`);
      }
    }
  }

  const workGraph: { id: string; blockedBy: string[] }[] = [];
  for (const entry of document.works) {
    workGraph.push({ id: entry.id, blockedBy: entry.blockedBy.filter((b) => workIds.has(b)) });
  }
  for (const existing of existingWorks.values()) {
    workGraph.push({ id: existing.id, blockedBy: existing.blockedBy });
  }
  assertAcyclic(workGraph as unknown as Work[]);

  for (const existing of existingWorks.values()) {
    if (!workIds.has(existing.id)) {
      const hasStarted = existing.workflow.state !== "ready" || existing.attempts.length > 0;
      if (hasStarted) {
        fail("INVALID_STATE", `started work ${existing.id} cannot be omitted from the spec document`);
      }
      const isReferenced = [...existingWorks.values()].some(
        (w) => w.blockedBy.includes(existing.id) && workIds.has(w.id) && w.id !== existing.id,
      );
      if (!isReferenced) {
        for (const entry of document.works) {
          if (entry.id !== existing.id && entry.blockedBy.includes(existing.id)) {
            fail(
              "INVALID_INPUT",
              `cannot delete ${existing.id}: it is still referenced as a dependency by ${entry.id}`,
            );
          }
        }
      }
      deleted.push(existing.id);
    }
  }

  for (const entry of document.works) {
    const existing = existingWorks.get(entry.id);
    if (existing === undefined) {
      created.push(entry);
    } else {
      const hasStarted = existing.workflow.state !== "ready" || existing.attempts.length > 0;
      if (hasStarted) {
        const isSame = workDefsEqual(entry, existing);
        if (!isSame) {
          fail("INVALID_STATE", `started work ${entry.id} cannot be changed`);
        }
      } else {
        updated.push(entry);
      }
    }
  }

  return { created, updated, deleted };
}

export function validateWorkDefinition(entry: WorkDefinition): void {
  if (entry.title.trim() === "") fail("INVALID_INPUT", "work title must be non-empty");
  if (entry.description.trim() === "") fail("INVALID_INPUT", "work description must be non-empty");
  if (entry.acceptance.some((c) => c.trim() === "")) {
    fail("INVALID_INPUT", "acceptance criteria must be non-empty");
  }
  if (new Set(entry.blockedBy).size !== entry.blockedBy.length) {
    fail("INVALID_INPUT", `duplicate blockedBy entries in work ${entry.id}`);
  }
}

function workDefsEqual(def: WorkDefinition, work: Work): boolean {
  return (
    def.id === work.id &&
    def.wave === work.wave &&
    def.title === work.title &&
    def.description === work.description &&
    def.workType === work.workType &&
    def.priority === work.priority &&
    def.delivery === work.delivery &&
    arraysEqual(def.acceptance, work.acceptance) &&
    arraysEqual([...def.blockedBy].sort(), [...work.blockedBy].sort())
  );
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function validateTodoCoverage(execution: { todo: TodoItem[] }, result: SpecResult): void {
  const expected = new Set(execution.todo.map((item) => item.id));
  const seen = new Set<string>();
  for (const entry of result.todo) {
    if (!expected.has(entry.id)) {
      fail("INVALID_INPUT", `spec result.todo references unknown todo id ${JSON.stringify(entry.id)}`);
    }
    if (seen.has(entry.id)) {
      fail("INVALID_INPUT", `spec result.todo repeats todo id ${JSON.stringify(entry.id)}`);
    }
    seen.add(entry.id);
  }
  for (const id of expected) {
    if (!seen.has(id)) {
      fail("INVALID_INPUT", `spec result.todo does not account for todo id ${JSON.stringify(id)}`);
    }
  }
}

function replaceActive(executions: SpecExecution[], completed: SpecExecution): SpecExecution[] {
  return executions.map((e) => (e.status === "active" ? completed : e));
}

export function normalizedResultEqual(a: SpecResult, b: SpecResult): boolean {
  const normalized = (r: SpecResult): SpecResult => ({
    decision: r.decision,
    summary: r.summary,
    todo: [...r.todo].sort((x, y) => x.id.localeCompare(y.id)),
  });
  return canonicalJson(normalized(a)) === canonicalJson(normalized(b));
}

export function activeSpecExecution(initiative: Initiative): SpecExecution | undefined {
  return initiative.specExecutions.find((e) => e.status === "active");
}
