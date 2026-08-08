import { fail } from "./errors.js";
import type { CapabilityRef, ExecutionIdentity, TodoItem, TodoResult } from "./execution.js";
import { assertCompositionConsistency } from "./execution.js";
import { parseInitiativeId, parseWaveId, parseWorkId, waveIdOf } from "./identifiers.js";

const INITIATIVE_TYPE = "codepatrol-initiative";

export type InitiativeDefinitionState = "draft" | "defined";
export type InitiativeStatus = "draft" | "active" | "completed";

export interface InitiativeDefinition {
  title: string;
  intent: string;
  waves: WaveDefinition[];
  works: WorkDefinition[];
}

export interface WaveDefinition {
  id: string;
  title: string;
  intent: string;
}

export interface WorkDefinition {
  id: string;
  wave: string;
  title: string;
  description: string;
  workType: "bug" | "feature" | "task";
  priority: "p0" | "p1" | "p2" | "p3";
  delivery: "code" | "no-code";
  acceptance: string[];
  blockedBy: string[];
}

export interface SpecResult {
  decision: "apply" | "discard";
  summary: string;
  todo: TodoResult[];
}

export interface SpecExecution {
  runId: string;
  status: "active" | "completed";
  execution: ExecutionIdentity<"spec">;
  todo: TodoItem[];
  baseRevision: number | null;
  startedAt: string;
  finishedAt?: string;
  result?: SpecResult;
  documentHash?: string;
  appliedRevision?: number;
}

export interface SpecRevision {
  revision: number;
  runId: string;
  createdAt: string;
  summary: string;
  documentHash: string;
  definition: InitiativeDefinition;
}

export interface InitiativeBase {
  schemaVersion: 1;
  type: typeof INITIATIVE_TYPE;
  id: string;
  definitionState: InitiativeDefinitionState;
  currentSpecRevision: number | null;
  specRevisions: SpecRevision[];
  specExecutions: SpecExecution[];
  createdAt: string;
  updatedAt: string;
}

export interface DraftInitiative extends InitiativeBase {
  definitionState: "draft";
  currentSpecRevision: null;
}

export interface DefinedInitiative extends InitiativeBase {
  definitionState: "defined";
  title: string;
  intent: string;
  currentSpecRevision: number;
}

export type Initiative = DraftInitiative | DefinedInitiative;

export function initiativeStatus(
  initiative: Initiative,
  works: readonly { initiative: string; completion: unknown }[],
): InitiativeStatus {
  if (initiative.definitionState === "draft") return "draft";
  const owned = works.filter((work) => work.initiative === initiative.id);
  if (owned.length > 0 && owned.every((work) => work.completion !== null)) return "completed";
  return "active";
}

export function parseInitiative(value: unknown, context = "initiative"): Initiative {
  const record = requireRecord(value, context);
  rejectUnknown(
    record,
    [
      "schemaVersion",
      "type",
      "id",
      "definitionState",
      "title",
      "intent",
      "currentSpecRevision",
      "specRevisions",
      "specExecutions",
      "createdAt",
      "updatedAt",
    ],
    context,
  );
  if (record.schemaVersion !== 1)
    fail("STATE_CORRUPT", `${context}: unsupported schemaVersion ${JSON.stringify(record.schemaVersion)}`);
  if (record.type !== INITIATIVE_TYPE) fail("STATE_CORRUPT", `${context}: unsupported type`);
  const definitionState = record.definitionState;
  if (definitionState !== "draft" && definitionState !== "defined") {
    fail("STATE_CORRUPT", `${context}: invalid definitionState ${JSON.stringify(definitionState)}`);
  }

  const base: InitiativeBase = {
    schemaVersion: 1,
    type: INITIATIVE_TYPE,
    id: parseInitiativeId(record.id, `${context}.id`),
    definitionState,
    currentSpecRevision: null,
    specRevisions: requireArray(record.specRevisions, `${context}.specRevisions`).map((entry, index) =>
      parseSpecRevision(entry, `${context}.specRevisions[${index}]`),
    ),
    specExecutions: requireArray(record.specExecutions, `${context}.specExecutions`).map((entry, index) =>
      parseSpecExecution(entry, `${context}.specExecutions[${index}]`),
    ),
    createdAt: requireText(record.createdAt, `${context}.createdAt`),
    updatedAt: requireText(record.updatedAt, `${context}.updatedAt`),
  };

  if (definitionState === "draft") {
    if (base.specRevisions.length > 0) {
      fail("STATE_CORRUPT", `${context}: draft initiative must not have spec revisions`);
    }
    return {
      ...base,
      definitionState: "draft",
      currentSpecRevision: null,
    } as DraftInitiative;
  }

  const currentSpecRevision = record.currentSpecRevision;
  if (typeof currentSpecRevision !== "number" || !Number.isInteger(currentSpecRevision) || currentSpecRevision < 1) {
    fail("STATE_CORRUPT", `${context}: defined initiative must have a positive integer currentSpecRevision`);
  }
  const revision = base.specRevisions.find((r) => r.revision === currentSpecRevision);
  if (revision === undefined) {
    fail("STATE_CORRUPT", `${context}: currentSpecRevision ${currentSpecRevision} not found in specRevisions`);
  }

  return {
    ...base,
    definitionState: "defined",
    title: requireText(record.title, `${context}.title`),
    intent: requireText(record.intent, `${context}.intent`),
    currentSpecRevision,
  } as DefinedInitiative;
}

function parseSpecExecution(value: unknown, context: string): SpecExecution {
  const record = requireRecord(value, context);
  rejectUnknown(
    record,
    [
      "runId",
      "status",
      "execution",
      "todo",
      "baseRevision",
      "startedAt",
      "finishedAt",
      "result",
      "documentHash",
      "appliedRevision",
    ],
    context,
  );
  const status = record.status;
  if (status !== "active" && status !== "completed") {
    fail("STATE_CORRUPT", `${context}: invalid status ${JSON.stringify(status)}`);
  }
  const exec: SpecExecution = {
    runId: requireText(record.runId, `${context}.runId`),
    status,
    execution: parseExecution(record.execution, `${context}.execution`),
    todo: requireArray(record.todo, `${context}.todo`).map((entry, index) =>
      parseTodoItem(entry, `${context}.todo[${index}]`),
    ),
    baseRevision: parseBaseRevision(record.baseRevision, `${context}.baseRevision`),
    startedAt: requireText(record.startedAt, `${context}.startedAt`),
  };
  const finishedAt = optionalText(record.finishedAt, `${context}.finishedAt`);
  if (finishedAt !== undefined) exec.finishedAt = finishedAt;
  if (record.result !== undefined) exec.result = parseSpecResult(record.result, `${context}.result`);
  if (record.documentHash !== undefined)
    exec.documentHash = requireText(record.documentHash, `${context}.documentHash`);
  const appliedRevision = record.appliedRevision;
  if (appliedRevision !== undefined) {
    if (typeof appliedRevision !== "number" || !Number.isInteger(appliedRevision) || appliedRevision < 1) {
      fail("STATE_CORRUPT", `${context}.appliedRevision must be a positive integer`);
    }
    exec.appliedRevision = appliedRevision;
  }
  return exec;
}

function parseSpecRevision(value: unknown, context: string): SpecRevision {
  const record = requireRecord(value, context);
  rejectUnknown(record, ["revision", "runId", "createdAt", "summary", "documentHash", "definition"], context);
  const revision = record.revision;
  if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 1) {
    fail("STATE_CORRUPT", `${context}.revision must be a positive integer`);
  }
  return {
    revision,
    runId: requireText(record.runId, `${context}.runId`),
    createdAt: requireText(record.createdAt, `${context}.createdAt`),
    summary: requireText(record.summary, `${context}.summary`),
    documentHash: requireText(record.documentHash, `${context}.documentHash`),
    definition: parseDefinition(record.definition, `${context}.definition`),
  };
}

function parseDefinition(value: unknown, context: string): InitiativeDefinition {
  const record = requireRecord(value, context);
  rejectUnknown(record, ["title", "intent", "waves", "works"], context);
  return {
    title: requireText(record.title, `${context}.title`),
    intent: requireText(record.intent, `${context}.intent`),
    waves: requireArray(record.waves, `${context}.waves`).map((entry, index) =>
      parseWaveDef(entry, `${context}.waves[${index}]`),
    ),
    works: requireArray(record.works, `${context}.works`).map((entry, index) =>
      parseWorkDef(entry, `${context}.works[${index}]`),
    ),
  };
}

function parseWaveDef(value: unknown, context: string): WaveDefinition {
  const record = requireRecord(value, context);
  rejectUnknown(record, ["id", "title", "intent"], context);
  return {
    id: parseWaveId(record.id, `${context}.id`),
    title: requireText(record.title, `${context}.title`),
    intent: requireText(record.intent, `${context}.intent`),
  };
}

function parseWorkDef(value: unknown, context: string): WorkDefinition {
  const record = requireRecord(value, context);
  rejectUnknown(
    record,
    ["id", "wave", "title", "description", "workType", "priority", "delivery", "acceptance", "blockedBy"],
    context,
  );
  const id = parseWorkId(record.id, `${context}.id`);
  const wave = requireText(record.wave, `${context}.wave`);
  if (wave !== waveIdOf(id)) {
    fail("INVALID_INPUT", `${context}: wave ${wave} does not match id ${id}`);
  }
  return {
    id,
    wave,
    title: requireText(record.title, `${context}.title`),
    description: requireText(record.description, `${context}.description`),
    workType: parseWorkType(record.workType, `${context}.workType`),
    priority: parsePriority(record.priority, `${context}.priority`),
    delivery: parseDelivery(record.delivery, `${context}.delivery`),
    acceptance: requireStringList(record.acceptance, `${context}.acceptance`),
    blockedBy: requireStringList(record.blockedBy, `${context}.blockedBy`),
  };
}

function parseSpecResult(value: unknown, context: string): SpecResult {
  const record = requireRecord(value, context);
  rejectUnknown(record, ["decision", "summary", "todo"], context);
  const decision = record.decision;
  if (decision !== "apply" && decision !== "discard") {
    fail("INVALID_INPUT", `${context}.decision must be apply|discard`);
  }
  return {
    decision,
    summary: requireText(record.summary, `${context}.summary`),
    todo: requireArray(record.todo, `${context}.todo`).map((entry, index) =>
      parseTodoResult(entry, `${context}.todo[${index}]`),
    ),
  };
}

function parseExecution(value: unknown, context: string): ExecutionIdentity<"spec"> {
  const record = requireRecord(value, context);
  rejectUnknown(record, ["role", "harness", "model", "profile", "capabilities", "compositionDigest"], context);
  if (record.role !== "spec") fail("STATE_CORRUPT", `${context}.role must be spec`);
  const execution: ExecutionIdentity<"spec"> = {
    role: "spec",
    harness: requireText(record.harness, `${context}.harness`),
  };
  const model = optionalText(record.model, `${context}.model`);
  if (model !== undefined) execution.model = model;
  const profile = optionalText(record.profile, `${context}.profile`);
  if (profile !== undefined) execution.profile = profile;
  if (record.capabilities !== undefined)
    execution.capabilities = parseCapabilities(record.capabilities, `${context}.capabilities`);
  const compositionDigest = optionalText(record.compositionDigest, `${context}.compositionDigest`);
  if (compositionDigest !== undefined) execution.compositionDigest = compositionDigest;
  assertCompositionConsistency(execution, context);
  return execution;
}

function parseTodoItem(value: unknown, context: string): TodoItem {
  const record = requireRecord(value, context);
  rejectUnknown(record, ["id", "title"], context);
  return { id: requireText(record.id, `${context}.id`), title: requireText(record.title, `${context}.title`) };
}

function parseTodoResult(value: unknown, context: string): TodoResult {
  const record = requireRecord(value, context);
  rejectUnknown(record, ["id", "status", "note"], context);
  const status = record.status;
  if (status !== "done" && status !== "dropped") {
    fail("INVALID_INPUT", `${context}.status must be done|dropped`);
  }
  const result: TodoResult = { id: requireText(record.id, `${context}.id`), status };
  const note = optionalText(record.note, `${context}.note`);
  if (note !== undefined) result.note = note;
  return result;
}

function parseBaseRevision(value: unknown, context: string): number | null {
  if (value === null) return null;
  if (typeof value === "number" && Number.isInteger(value) && value >= 1) return value;
  fail("STATE_CORRUPT", `${context} must be null or a positive integer`);
}

function parseWorkType(value: unknown, field: string): "bug" | "feature" | "task" {
  if (value !== "bug" && value !== "feature" && value !== "task") {
    fail("INVALID_INPUT", `${field} must be bug|feature|task`);
  }
  return value;
}

function parsePriority(value: unknown, field: string): "p0" | "p1" | "p2" | "p3" {
  if (value !== "p0" && value !== "p1" && value !== "p2" && value !== "p3") {
    fail("INVALID_INPUT", `${field} must be p0|p1|p2|p3`);
  }
  return value;
}

function parseDelivery(value: unknown, field: string): "code" | "no-code" {
  if (value !== "code" && value !== "no-code") {
    fail("INVALID_INPUT", `${field} must be code|no-code`);
  }
  return value;
}

function requireStringList(value: unknown, field: string): string[] {
  return requireArray(value, field).map((entry, index) => requireText(entry, `${field}[${index}]`));
}

export function requireRecord(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("INVALID_INPUT", `${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function rejectUnknown(record: Record<string, unknown>, allowed: string[], context: string): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      fail("INVALID_INPUT", `${context}: unknown field ${JSON.stringify(key)}`);
    }
  }
}

export function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    fail("INVALID_INPUT", `${field} must be a non-empty string`);
  }
  return value;
}

export function optionalText(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return requireText(value, field);
}

export function requireArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) fail("INVALID_INPUT", `${field} must be an array`);
  return value;
}

export function parseCapabilities(value: unknown, context: string): CapabilityRef[] {
  if (!Array.isArray(value)) fail("STATE_CORRUPT", `${context} must be an array`);
  return value.map((entry, index) => {
    const record = requireRecord(entry, `${context}[${index}]`);
    rejectUnknown(record, ["id", "version", "digest"], `${context}[${index}]`);
    const version = record.version;
    if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
      fail("STATE_CORRUPT", `${context}[${index}].version must be a positive integer`);
    }
    const digest = requireText(record.digest, `${context}[${index}].digest`);
    if (digest.length !== 64 || !/^[0-9a-f]+$/.test(digest)) {
      fail("STATE_CORRUPT", `${context}[${index}].digest must be a 64-character hex string`);
    }
    return {
      id: requireText(record.id, `${context}[${index}].id`),
      version,
      digest,
    };
  });
}
