import type { ChangeEvidence } from "./change.js";
import { fail } from "./errors.js";
import type { ExecutionIdentity, TodoItem, TodoResult } from "./execution.js";
import { assertCompositionConsistency } from "./execution.js";
import { initiativeIdOf, parseWorkId, waveIdOf } from "./identifiers.js";
import {
  optionalText,
  parseCapabilities,
  rejectUnknown,
  requireArray,
  requireRecord,
  requireText,
} from "./initiative.js";

export type { ExecutionIdentity, TodoItem, TodoResult };

const WORK_TYPE = "codepatrol-work";

export const STAGES = ["plan", "review", "build", "verify", "ship"] as const;
export type Stage = (typeof STAGES)[number];

export type WorkType = "bug" | "feature" | "task";
export type WorkDelivery = "code" | "no-code";
export type WorkPriority = "p0" | "p1" | "p2" | "p3";
export type WorkflowState = "ready" | "active" | "terminal";
export type AttemptStatus = "active" | "completed";
export type CompletionOutcome = "accepted" | "rolled-back";
export type ResultDecision = "continue" | "return" | "accept" | "rollback";
export type AcceptanceStatus = "passed" | "failed" | "not-applicable";

const COMMIT_PATTERN = /^[0-9a-f]{40}$/;

export interface AcceptanceResult {
  index: number;
  status: AcceptanceStatus;
  summary: string;
}

export interface LocalIntegration {
  status: "integrated";
  finalCommit: string;
}

export type RemotePublicationStatus = "not-requested" | "pending" | "pushed" | "push-denied" | "failed";

export interface RemotePublication {
  status: RemotePublicationStatus;
  pushCommit?: string;
  error?: string;
  requestedAt?: string;
  completedAt?: string;
}

export interface AttemptEvidence {
  specRevision?: number;
  baseCommit?: string;
  candidateCommit?: string;
  changedPaths?: string[];
  change?: ChangeEvidence;
  finalCommit?: string;
  localIntegration?: LocalIntegration;
  remotePublication?: RemotePublication;
}

export interface AttemptResult {
  decision: ResultDecision;
  summary: string;
  todo: TodoResult[];
  acceptance?: AcceptanceResult[];
  returnTo?: Stage;
  authority?: string;
}

export interface Attempt {
  stage: Stage;
  attempt: number;
  runId: string;
  status: AttemptStatus;
  execution: ExecutionIdentity<Stage>;
  todo: TodoItem[];
  startedAt: string;
  finishedAt?: string;
  evidence?: AttemptEvidence;
  result?: AttemptResult;
}

export interface Workflow {
  state: WorkflowState;
  stage: Stage;
  updatedAt: string;
}

export interface Completion {
  outcome: CompletionOutcome;
  authority: string;
  summary: string;
  finalizedAt: string;
}

export interface DependencyRevision {
  revision: number;
  previous: string[];
  next: string[];
  summary: string;
  authority: string;
  changedAt: string;
}

export interface WorkGitHub {
  milestone?: number;
  issue?: number;
}

export interface Work {
  schemaVersion: 1;
  type: typeof WORK_TYPE;
  id: string;
  initiative: string;
  wave: string;
  title: string;
  description: string;
  workType: WorkType;
  priority: WorkPriority;
  delivery: WorkDelivery;
  acceptance: string[];
  blockedBy: string[];
  specRevision: number;
  workflow: Workflow;
  attempts: Attempt[];
  completion: Completion | null;
  dependencyRevisions: DependencyRevision[];
  github: WorkGitHub;
  createdAt: string;
}

export function parseStage(value: unknown, field = "stage"): Stage {
  if (typeof value !== "string" || !(STAGES as readonly string[]).includes(value)) {
    fail("INVALID_INPUT", `${field} must be one of ${STAGES.join("|")}, got ${JSON.stringify(value)}`);
  }
  return value as Stage;
}

export function parseWorkType(value: unknown, field = "workType"): WorkType {
  if (value !== "bug" && value !== "feature" && value !== "task") {
    fail("INVALID_INPUT", `${field} must be bug|feature|task, got ${JSON.stringify(value)}`);
  }
  return value;
}

export function parsePriority(value: unknown, field = "priority"): WorkPriority {
  if (value !== "p0" && value !== "p1" && value !== "p2" && value !== "p3") {
    fail("INVALID_INPUT", `${field} must be p0|p1|p2|p3, got ${JSON.stringify(value)}`);
  }
  return value;
}

function parseCommit(value: unknown, field: string): string {
  if (typeof value !== "string" || !COMMIT_PATTERN.test(value)) {
    fail("INVALID_INPUT", `${field} must be a full commit hash, got ${JSON.stringify(value)}`);
  }
  return value;
}

export function parseDelivery(value: unknown, field = "delivery"): WorkDelivery {
  if (value !== "code" && value !== "no-code") {
    fail("INVALID_INPUT", `${field} must be code|no-code, got ${JSON.stringify(value)}`);
  }
  return value;
}

export function createWork(input: {
  id: string;
  title: string;
  description: string;
  workType: WorkType;
  priority: WorkPriority;
  delivery: WorkDelivery;
  acceptance: string[];
  blockedBy: string[];
  specRevision: number;
  now: string;
}): Work {
  const id = parseWorkId(input.id);
  return {
    schemaVersion: 1,
    type: WORK_TYPE,
    id,
    initiative: initiativeIdOf(id),
    wave: waveIdOf(id),
    title: requireText(input.title, "title"),
    description: requireText(input.description, "description"),
    workType: input.workType,
    priority: input.priority,
    delivery: input.delivery,
    acceptance: input.acceptance.map((entry, index) => requireText(entry, `acceptance[${index}]`)),
    blockedBy: input.blockedBy.map((entry) => parseWorkId(entry, "blockedBy")),
    specRevision: input.specRevision,
    workflow: { state: "ready", stage: "plan", updatedAt: input.now },
    attempts: [],
    completion: null,
    dependencyRevisions: [],
    github: {},
    createdAt: input.now,
  };
}

export function activeAttempt(work: Work): Attempt | undefined {
  return work.attempts.find((attempt) => attempt.status === "active");
}

export function latestCompletedAttempt(work: Work, stage: Stage): Attempt | undefined {
  for (let index = work.attempts.length - 1; index >= 0; index -= 1) {
    const attempt = work.attempts[index] as Attempt;
    if (attempt.stage === stage && attempt.status === "completed") return attempt;
  }
  return undefined;
}

export function buildCandidate(work: Work): string | undefined {
  return latestCompletedAttempt(work, "build")?.evidence?.candidateCommit;
}

export function verifiedCandidate(work: Work): string | undefined {
  const verify = latestCompletedAttempt(work, "verify");
  if (verify?.result?.decision !== "continue") return undefined;
  return verify.evidence?.candidateCommit;
}

export function parseWork(value: unknown, context = "work"): Work {
  const record = requireRecord(value, context);
  rejectUnknown(
    record,
    [
      "schemaVersion",
      "type",
      "id",
      "initiative",
      "wave",
      "title",
      "description",
      "workType",
      "priority",
      "delivery",
      "acceptance",
      "blockedBy",
      "specRevision",
      "workflow",
      "attempts",
      "completion",
      "dependencyRevisions",
      "github",
      "createdAt",
    ],
    context,
  );
  if (record.schemaVersion !== 1)
    fail("STATE_CORRUPT", `${context}: unsupported schemaVersion ${JSON.stringify(record.schemaVersion)}`);
  if (record.type !== WORK_TYPE) fail("STATE_CORRUPT", `${context}: unsupported type`);
  const id = parseWorkId(record.id, `${context}.id`);
  const initiative = requireText(record.initiative, `${context}.initiative`);
  if (initiative !== initiativeIdOf(id)) {
    fail("STATE_CORRUPT", `${context}: initiative ${initiative} does not match id ${id}`);
  }
  const wave = requireText(record.wave, `${context}.wave`);
  if (wave !== waveIdOf(id)) {
    fail("STATE_CORRUPT", `${context}: wave ${wave} does not match id ${id}`);
  }
  const specRevision = record.specRevision;
  if (typeof specRevision !== "number" || !Number.isInteger(specRevision) || specRevision < 1) {
    fail("STATE_CORRUPT", `${context}.specRevision must be a positive integer`);
  }
  return {
    schemaVersion: 1,
    type: WORK_TYPE,
    id,
    initiative,
    wave,
    title: requireText(record.title, `${context}.title`),
    description: requireText(record.description, `${context}.description`),
    workType: parseWorkType(record.workType, `${context}.workType`),
    priority: parsePriority(record.priority, `${context}.priority`),
    delivery: parseDelivery(record.delivery, `${context}.delivery`),
    acceptance: requireStringList(record.acceptance, `${context}.acceptance`),
    blockedBy: requireStringList(record.blockedBy, `${context}.blockedBy`).map((entry) =>
      parseWorkId(entry, `${context}.blockedBy`),
    ),
    specRevision,
    workflow: parseWorkflow(record.workflow, `${context}.workflow`),
    attempts: requireArray(record.attempts, `${context}.attempts`).map((entry, index) =>
      parseAttempt(entry, `${context}.attempts[${index}]`),
    ),
    completion: record.completion === null ? null : parseCompletion(record.completion, `${context}.completion`),
    dependencyRevisions: requireArray(record.dependencyRevisions, `${context}.dependencyRevisions`).map(
      (entry, index) => parseDependencyRevision(entry, `${context}.dependencyRevisions[${index}]`),
    ),
    github: parseGitHub(record.github, `${context}.github`),
    createdAt: requireText(record.createdAt, `${context}.createdAt`),
  };
}

function parseWorkflow(value: unknown, context: string): Workflow {
  const record = requireRecord(value, context);
  rejectUnknown(record, ["state", "stage", "updatedAt"], context);
  const state = record.state;
  if (state !== "ready" && state !== "active" && state !== "terminal") {
    fail("STATE_CORRUPT", `${context}: invalid state ${JSON.stringify(state)}`);
  }
  return {
    state,
    stage: parseStage(record.stage, `${context}.stage`),
    updatedAt: requireText(record.updatedAt, `${context}.updatedAt`),
  };
}

function parseAttempt(value: unknown, context: string): Attempt {
  const record = requireRecord(value, context);
  rejectUnknown(
    record,
    ["stage", "attempt", "runId", "status", "execution", "todo", "startedAt", "finishedAt", "evidence", "result"],
    context,
  );
  const status = record.status;
  if (status !== "active" && status !== "completed") {
    fail("STATE_CORRUPT", `${context}: invalid status ${JSON.stringify(status)}`);
  }
  const attemptNumber = record.attempt;
  if (typeof attemptNumber !== "number" || !Number.isInteger(attemptNumber) || attemptNumber < 1) {
    fail("STATE_CORRUPT", `${context}.attempt must be a positive integer`);
  }
  const attempt: Attempt = {
    stage: parseStage(record.stage, `${context}.stage`),
    attempt: attemptNumber,
    runId: requireText(record.runId, `${context}.runId`),
    status,
    execution: parseExecution(record.execution, `${context}.execution`),
    todo: requireArray(record.todo, `${context}.todo`).map((entry, index) =>
      parseTodoItem(entry, `${context}.todo[${index}]`),
    ),
    startedAt: requireText(record.startedAt, `${context}.startedAt`),
  };
  const finishedAt = optionalText(record.finishedAt, `${context}.finishedAt`);
  if (finishedAt !== undefined) attempt.finishedAt = finishedAt;
  if (record.evidence !== undefined) attempt.evidence = parseEvidence(record.evidence, `${context}.evidence`);
  if (record.result !== undefined) attempt.result = parseResult(record.result, `${context}.result`);
  return attempt;
}

function parseExecution(value: unknown, context: string): ExecutionIdentity<Stage> {
  const record = requireRecord(value, context);
  rejectUnknown(record, ["role", "harness", "model", "profile", "capabilities", "compositionDigest"], context);
  const execution: ExecutionIdentity<Stage> = {
    role: parseStage(record.role, `${context}.role`),
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

export function parseTodoList(value: unknown, context = "todo"): TodoItem[] {
  if (!Array.isArray(value)) fail("INVALID_INPUT", `${context} must be an array`);
  const list = value.map((entry, index) => parseTodoItem(entry, `${context}[${index}]`));
  const seen = new Set<string>();
  for (const item of list) {
    if (seen.has(item.id)) fail("INVALID_INPUT", `${context}: duplicate todo id ${JSON.stringify(item.id)}`);
    seen.add(item.id);
  }
  return list;
}

export function parseAttemptResult(value: unknown, context = "result"): AttemptResult {
  return parseResult(value, context);
}

export function normalizeResult(result: AttemptResult): AttemptResult {
  const normalized: AttemptResult = {
    ...result,
    todo: [...result.todo].sort((a, b) => a.id.localeCompare(b.id)),
  };
  if (result.acceptance !== undefined) {
    normalized.acceptance = [...result.acceptance].sort((a, b) => a.index - b.index);
  }
  return normalized;
}

function parseResult(value: unknown, context: string): AttemptResult {
  const record = requireRecord(value, context);
  rejectUnknown(record, ["decision", "summary", "todo", "acceptance", "returnTo", "authority"], context);
  const decision = record.decision;
  if (decision !== "continue" && decision !== "return" && decision !== "accept" && decision !== "rollback") {
    fail("INVALID_INPUT", `${context}.decision must be continue|return|accept|rollback`);
  }
  const result: AttemptResult = {
    decision,
    summary: requireText(record.summary, `${context}.summary`),
    todo: parseTodoResults(record.todo, `${context}.todo`).sort((a, b) => a.id.localeCompare(b.id)),
  };
  if (record.acceptance !== undefined) {
    if (!Array.isArray(record.acceptance)) fail("INVALID_INPUT", `${context}.acceptance must be an array`);
    result.acceptance = record.acceptance
      .map((entry, index) => parseAcceptanceResult(entry, `${context}.acceptance[${index}]`))
      .sort((a, b) => a.index - b.index);
  }
  const returnTo = record.returnTo;
  if (returnTo !== undefined) result.returnTo = parseStage(returnTo, `${context}.returnTo`);
  const authority = optionalText(record.authority, `${context}.authority`);
  if (authority !== undefined) result.authority = authority;
  return result;
}

function parseTodoResults(value: unknown, context: string): TodoResult[] {
  if (!Array.isArray(value)) fail("INVALID_INPUT", `${context} must be an array`);
  const list = value.map((entry, index) => parseTodoResult(entry, `${context}[${index}]`));
  const seen = new Set<string>();
  for (const entry of list) {
    if (seen.has(entry.id)) fail("INVALID_INPUT", `${context}: duplicate todo result id ${JSON.stringify(entry.id)}`);
    seen.add(entry.id);
  }
  return list;
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

function parseAcceptanceResult(value: unknown, context: string): AcceptanceResult {
  const record = requireRecord(value, context);
  rejectUnknown(record, ["index", "status", "summary"], context);
  const index = record.index;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0) {
    fail("INVALID_INPUT", `${context}.index must be a non-negative integer`);
  }
  const status = record.status;
  if (status !== "passed" && status !== "failed" && status !== "not-applicable") {
    fail("INVALID_INPUT", `${context}.status must be passed|failed|not-applicable`);
  }
  return { index, status, summary: requireText(record.summary, `${context}.summary`) };
}

function parseEvidence(value: unknown, context: string): AttemptEvidence {
  const record = requireRecord(value, context);
  rejectUnknown(
    record,
    [
      "specRevision",
      "baseCommit",
      "candidateCommit",
      "changedPaths",
      "change",
      "finalCommit",
      "localIntegration",
      "remotePublication",
    ],
    context,
  );
  const evidence: AttemptEvidence = {};
  if (record.specRevision !== undefined) {
    if (typeof record.specRevision !== "number" || !Number.isInteger(record.specRevision) || record.specRevision < 1) {
      fail("STATE_CORRUPT", `${context}.specRevision must be a positive integer`);
    }
    evidence.specRevision = record.specRevision;
  }
  if (record.baseCommit !== undefined) evidence.baseCommit = parseCommit(record.baseCommit, `${context}.baseCommit`);
  if (record.candidateCommit !== undefined)
    evidence.candidateCommit = parseCommit(record.candidateCommit, `${context}.candidateCommit`);
  if (record.changedPaths !== undefined) {
    if (!Array.isArray(record.changedPaths)) fail("STATE_CORRUPT", `${context}.changedPaths must be an array`);
    evidence.changedPaths = (record.changedPaths as unknown[]).map((entry, index) =>
      requireText(entry, `${context}.changedPaths[${index}]`),
    );
  }
  if (record.change !== undefined) evidence.change = parseChangeEvidence(record.change, `${context}.change`);
  if (record.finalCommit !== undefined)
    evidence.finalCommit = parseCommit(record.finalCommit, `${context}.finalCommit`);
  if (record.localIntegration !== undefined)
    evidence.localIntegration = parseLocalIntegration(record.localIntegration, `${context}.localIntegration`);
  if (record.remotePublication !== undefined)
    evidence.remotePublication = parseRemotePublication(record.remotePublication, `${context}.remotePublication`);
  return evidence;
}

function parseLocalIntegration(value: unknown, context: string): LocalIntegration {
  const record = requireRecord(value, context);
  rejectUnknown(record, ["status", "finalCommit"], context);
  if (record.status !== "integrated") fail("STATE_CORRUPT", `${context}.status must be integrated`);
  return { status: "integrated", finalCommit: parseCommit(record.finalCommit, `${context}.finalCommit`) };
}

function parseRemotePublication(value: unknown, context: string): RemotePublication {
  const record = requireRecord(value, context);
  rejectUnknown(record, ["status", "pushCommit", "error", "requestedAt", "completedAt"], context);
  const status = record.status;
  if (
    status !== "not-requested" &&
    status !== "pending" &&
    status !== "pushed" &&
    status !== "push-denied" &&
    status !== "failed"
  ) {
    fail("STATE_CORRUPT", `${context}.status must be not-requested|pending|pushed|push-denied|failed`);
  }
  const pub: RemotePublication = { status };
  if (record.pushCommit !== undefined) pub.pushCommit = parseCommit(record.pushCommit, `${context}.pushCommit`);
  const error = optionalText(record.error, `${context}.error`);
  if (error !== undefined) pub.error = error;
  const requestedAt = optionalText(record.requestedAt, `${context}.requestedAt`);
  if (requestedAt !== undefined) pub.requestedAt = requestedAt;
  const completedAt = optionalText(record.completedAt, `${context}.completedAt`);
  if (completedAt !== undefined) pub.completedAt = completedAt;
  return pub;
}

function parseChangeEvidence(value: unknown, context: string): ChangeEvidence {
  const record = requireRecord(value, context);
  rejectUnknown(
    record,
    ["type", "baseRef", "baseCommit", "headRef", "candidateCommit", "worktree", "changedPaths", "commitCount"],
    context,
  );
  if (record.type !== "codepatrol-change") fail("STATE_CORRUPT", `${context}.type must be codepatrol-change`);
  const baseRef = requireText(record.baseRef, `${context}.baseRef`);
  if (!baseRef.startsWith("refs/heads/")) fail("STATE_CORRUPT", `${context}.baseRef must start with refs/heads/`);
  const headRef = requireText(record.headRef, `${context}.headRef`);
  if (!headRef.startsWith("refs/heads/")) fail("STATE_CORRUPT", `${context}.headRef must start with refs/heads/`);
  const evidence: ChangeEvidence = {
    type: "codepatrol-change",
    baseRef,
    baseCommit: parseCommit(record.baseCommit, `${context}.baseCommit`),
    headRef,
    candidateCommit: parseCommit(record.candidateCommit, `${context}.candidateCommit`),
  };
  const worktree = optionalText(record.worktree, `${context}.worktree`);
  if (worktree !== undefined) evidence.worktree = worktree;
  if (record.changedPaths !== undefined) {
    if (!Array.isArray(record.changedPaths)) fail("STATE_CORRUPT", `${context}.changedPaths must be an array`);
    evidence.changedPaths = (record.changedPaths as unknown[]).map((entry, index) =>
      requireText(entry, `${context}.changedPaths[${index}]`),
    );
  }
  const commitCount = record.commitCount;
  if (commitCount !== undefined) {
    if (typeof commitCount !== "number" || !Number.isInteger(commitCount) || commitCount < 0) {
      fail("STATE_CORRUPT", `${context}.commitCount must be a non-negative integer`);
    }
    evidence.commitCount = commitCount;
  }
  return evidence;
}

function parseCompletion(value: unknown, context: string): Completion {
  const record = requireRecord(value, context);
  rejectUnknown(record, ["outcome", "authority", "summary", "finalizedAt"], context);
  const outcome = record.outcome;
  if (outcome !== "accepted" && outcome !== "rolled-back") {
    fail("STATE_CORRUPT", `${context}: invalid outcome ${JSON.stringify(outcome)}`);
  }
  return {
    outcome,
    authority: requireText(record.authority, `${context}.authority`),
    summary: requireText(record.summary, `${context}.summary`),
    finalizedAt: requireText(record.finalizedAt, `${context}.finalizedAt`),
  };
}

function parseDependencyRevision(value: unknown, context: string): DependencyRevision {
  const record = requireRecord(value, context);
  rejectUnknown(record, ["revision", "previous", "next", "summary", "authority", "changedAt"], context);
  const revision = record.revision;
  if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 1) {
    fail("STATE_CORRUPT", `${context}.revision must be a positive integer`);
  }
  return {
    revision,
    previous: requireStringList(record.previous, `${context}.previous`).map((entry) =>
      parseWorkId(entry, `${context}.previous`),
    ),
    next: requireStringList(record.next, `${context}.next`).map((entry) => parseWorkId(entry, `${context}.next`)),
    summary: requireText(record.summary, `${context}.summary`),
    authority: requireText(record.authority, `${context}.authority`),
    changedAt: requireText(record.changedAt, `${context}.changedAt`),
  };
}

function parseGitHub(value: unknown, context: string): WorkGitHub {
  const record = requireRecord(value, context);
  rejectUnknown(record, ["milestone", "issue"], context);
  const github: WorkGitHub = {};
  if (record.milestone !== undefined) github.milestone = requireNumber(record.milestone, `${context}.milestone`);
  if (record.issue !== undefined) github.issue = requireNumber(record.issue, `${context}.issue`);
  return github;
}

function requireStringList(value: unknown, field: string): string[] {
  return requireArray(value, field).map((entry, index) => requireText(entry, `${field}[${index}]`));
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    fail("INVALID_INPUT", `${field} must be a positive integer`);
  }
  return value;
}
