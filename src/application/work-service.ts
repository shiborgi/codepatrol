import type { ChangePort } from "../adapters/change.js";
import type { CheckoutPort } from "../adapters/checkout.js";
import type { Git } from "../adapters/git.js";
import type { StateSnapshot, StateStore } from "../adapters/state-store.js";
import { fail } from "../core/errors.js";
import type { CapabilityRef } from "../core/execution.js";
import { assertAcyclic, assertBuildUnblocked, assertWaveScopedConcurrency } from "../core/graph.js";
import { canonicalJson } from "../core/json.js";
import { completeStage, executionContractMatches, startStage } from "../core/lifecycle.js";
import { activeSpecExecution } from "../core/spec-lifecycle.js";
import { compareWorkIdsCanonically, currentWaveLayer } from "../core/wave-execution.js";
import {
  type Attempt,
  type AttemptResult,
  activeAttempt,
  type ExecutionIdentity,
  normalizeResult,
  type RemotePublication,
  type Stage,
  type TodoItem,
  type Work,
} from "../core/work.js";
import { AttemptEvidenceRecorder } from "./attempt-evidence.js";

export interface WorkView {
  work: Work;
  blockers: { id: string; accepted: boolean }[];
}

/** What an attempt records about who executed it, before it is opened. */
export interface StageExecutionInput {
  harness: string;
  model?: string;
  profile?: string;
  capabilities?: CapabilityRef[];
  compositionDigest?: string;
}

export interface StartedAttempt {
  work: Work;
  attempt: Attempt;
  resumed: boolean;
}

/** A wave-scoped start covers its whole layer, and nothing outside it. */
function assertTodoCoversLayer(
  layer: readonly Work[],
  todoByWork: ReadonlyMap<string, TodoItem[]>,
  waveId: string,
): void {
  const declared = new Set(todoByWork.keys());
  for (const work of layer) {
    if (!declared.has(work.id)) fail("INVALID_INPUT", `todo document has no entry for ${work.id}`);
    declared.delete(work.id);
  }
  if (declared.size > 0) {
    fail(
      "INVALID_INPUT",
      `todo document declares works outside the current layer of ${waveId}: ${[...declared].join(", ")}`,
    );
  }
}

function assertTodoShape(todo: readonly TodoItem[]): void {
  const seen = new Set<string>();
  for (const item of todo) {
    if (item.id.trim() === "" || item.title.trim() === "") {
      fail("INVALID_INPUT", "todo ids and titles must be non-empty");
    }
    if (seen.has(item.id)) fail("INVALID_INPUT", `duplicate todo id ${JSON.stringify(item.id)}`);
    seen.add(item.id);
  }
}

/** A wave-scoped completion covers its whole layer or none of it. */
function assertSameSet(active: readonly string[], provided: readonly string[], waveId: string, stage: Stage): void {
  const missing = active.filter((id) => !provided.includes(id));
  if (missing.length > 0) {
    fail(
      "INVALID_INPUT",
      `the result document omits active works of wave ${waveId} at ${stage}: ${missing.join(", ")}`,
    );
  }
  const unexpected = provided.filter((id) => !active.includes(id));
  if (unexpected.length > 0) {
    fail(
      "INVALID_INPUT",
      `the result document includes works with no active ${stage} attempt: ${unexpected.join(", ")}`,
    );
  }
}

export class WorkService {
  constructor(
    private readonly store: StateStore,
    private readonly now: () => string,
    private readonly uuid: () => string,
    checkout: CheckoutPort,
    change?: ChangePort,
    repoRoot?: string,
    localGitFactory?: (path: string) => Git,
    git?: Git,
    warnSink?: (message: string) => void,
  ) {
    this.evidence = new AttemptEvidenceRecorder(checkout, change, repoRoot, localGitFactory, git, warnSink);
  }

  /** Observes the repository on behalf of an attempt; decides nothing. */
  private readonly evidence: AttemptEvidenceRecorder;

  async listWorks(): Promise<Work[]> {
    const snapshot = await this.store.read();
    return [...snapshot.works.values()].sort((a, b) => compareWorkIdsCanonically(a.id, b.id));
  }

  async showWork(id: string): Promise<WorkView> {
    const snapshot = await this.store.read();
    const work = snapshot.works.get(id);
    if (work === undefined) fail("NOT_FOUND", `work ${id} does not exist`);
    return {
      work,
      blockers: work.blockedBy.map((blockerId) => ({
        id: blockerId,
        accepted: snapshot.works.get(blockerId)?.completion?.outcome === "accepted",
      })),
    };
  }

  /** Builds the execution identity an attempt records, from validated input. */
  private executionOf(stage: Stage, input: StageExecutionInput): ExecutionIdentity {
    if (input.harness.trim() === "") fail("INVALID_INPUT", "harness must be non-empty");
    if (input.model !== undefined && input.model.trim() === "")
      fail("INVALID_INPUT", "model must be non-empty when present");
    if (input.profile !== undefined && input.profile.trim() === "")
      fail("INVALID_INPUT", "profile must be non-empty when present");
    const execution: ExecutionIdentity = { role: stage, harness: input.harness };
    if (input.model !== undefined) execution.model = input.model;
    if (input.profile !== undefined) execution.profile = input.profile;
    if (input.capabilities !== undefined) execution.capabilities = input.capabilities;
    if (input.compositionDigest !== undefined) execution.compositionDigest = input.compositionDigest;
    return execution;
  }

  /**
   * Opens one attempt, or recognises the one already open. The Work form and
   * the Wave form share this: a layer is the several-Works case of the same
   * rule, never a second implementation of it.
   */
  private async openAttempt(
    snapshot: StateSnapshot,
    work: Work,
    stage: Stage,
    execution: ExecutionIdentity,
    todo: TodoItem[],
    minted: Set<string>,
  ): Promise<{ entry: StartedAttempt; changed?: Work }> {
    assertTodoShape(todo);
    const live = activeAttempt(work);
    if (live !== undefined) {
      if (live.stage !== stage) fail("INVALID_STATE", `${work.id} already has an active attempt at ${live.stage}`);
      if (!executionContractMatches(live, execution, todo)) {
        fail(
          "INVALID_INPUT",
          `${work.id} has an active ${stage} run with a different execution contract; refusing resume`,
        );
      }
      return { entry: { work, attempt: live, resumed: true } };
    }

    const evidence = await this.evidence.startEvidence(work, stage);
    const runId = this.uuid();
    const taken =
      minted.has(runId) || [...snapshot.works.values()].some((o) => o.attempts.some((a) => a.runId === runId));
    if (taken) fail("CONFLICT", `run id ${runId} already exists in repository state`);
    minted.add(runId);

    const next = startStage(work, stage, {
      runId,
      execution,
      todo,
      now: this.now(),
      ...(evidence !== undefined ? { evidence } : {}),
    });
    return { entry: { work: next, attempt: activeAttempt(next) as Attempt, resumed: false }, changed: next };
  }

  /**
   * Applies one result to one attempt, or recognises that the exact same result
   * was already applied. Shared by the Work form and the Wave form.
   */
  private async closeAttempt(
    work: Work,
    stage: Stage,
    runId: string,
    result: AttemptResult,
  ): Promise<{ work: Work; changed?: Work }> {
    const live = activeAttempt(work);
    if (live === undefined) {
      const previous = work.attempts.find((attempt) => attempt.runId === runId);
      if (previous === undefined) fail("INVALID_STATE", `${work.id} has no attempt with run ${runId}`);
      if (previous.stage !== stage || previous.result === undefined) {
        fail("INVALID_STATE", `run ${runId} of ${work.id} cannot complete ${stage}`);
      }
      if (canonicalJson(previous.result) !== canonicalJson(result)) {
        fail("RESULT_CONFLICT", `run ${runId} of ${work.id} already completed with a different result`);
      }
      return { work };
    }
    if (live.runId !== runId) fail("INVALID_STATE", `${work.id} active run is ${live.runId}, not ${runId}`);

    const evidence = await this.evidence.completeEvidence(work, stage, live, result);
    const next = completeStage(work, stage, runId, result, this.now(), evidence);
    return { work: next, changed: next };
  }

  /** Guards that must hold before any attempt of a stage is opened. */
  private async assertCanStart(snapshot: StateSnapshot, works: readonly Work[], stage: Stage): Promise<void> {
    if (this.hasActiveSpec(snapshot)) fail("INVALID_STATE", "a spec execution is active; cannot start work");
    assertWaveScopedConcurrency([...snapshot.works.values()], works[0] as Work);
    if (stage === "build") {
      for (const work of works) assertBuildUnblocked(work, snapshot.works);
      // Every Work is inspected before any branch or worktree is created, so a
      // start that cannot succeed leaves no orphan resource behind.
      await this.evidence.preflightBuild(works);
    }
  }

  async start(id: string, stage: Stage, input: StageExecutionInput & { todo: TodoItem[] }): Promise<StartedAttempt> {
    const execution = this.executionOf(stage, input);
    let outcome: StartedAttempt | undefined;
    await this.store.transact(async (snapshot) => {
      const work = snapshot.works.get(id);
      if (work === undefined) fail("NOT_FOUND", `work ${id} does not exist`);

      if (activeAttempt(work) === undefined) await this.assertCanStart(snapshot, [work], stage);
      const opened = await this.openAttempt(snapshot, work, stage, execution, input.todo, new Set());
      outcome = opened.entry;
      if (opened.changed === undefined) return { message: `codepatrol: noop ${id} ${stage}` };
      return {
        message: `codepatrol: start ${id} ${stage}#${opened.entry.attempt.attempt}`,
        works: new Map([[id, opened.changed]]),
      };
    });
    return outcome as StartedAttempt;
  }

  async complete(id: string, stage: Stage, runId: string, input: AttemptResult): Promise<Work> {
    const result = normalizeResult(input);
    let completed: Work | undefined;
    await this.store.transact(async (snapshot) => {
      const work = snapshot.works.get(id);
      if (work === undefined) fail("NOT_FOUND", `work ${id} does not exist`);
      const closed = await this.closeAttempt(work, stage, runId, result);
      completed = closed.work;
      if (closed.changed === undefined) return { message: `codepatrol: noop ${id} ${stage}` };
      return {
        message: `codepatrol: complete ${id} ${stage} (${result.decision})`,
        works: new Map([[id, closed.changed]]),
      };
    });
    await this.evidence.cleanupAfterShip(completed as Work, stage);
    return completed as Work;
  }

  /**
   * Opens one attempt per Work of the Wave's current layer, in a single state
   * transaction: either every Work of the layer is active afterwards, or none
   * is. Works already active with an identical contract resume instead of
   * starting again, so repeating the command is a no-op.
   */
  async startWave(
    waveId: string,
    stage: Stage,
    input: StageExecutionInput & { todoByWork: ReadonlyMap<string, TodoItem[]> },
  ): Promise<{ wave: string; layer: string[]; started: StartedAttempt[] }> {
    if (stage === "ship") fail("USAGE", "ship is only available for one work at a time");
    const execution = this.executionOf(stage, input);
    let outcome: { wave: string; layer: string[]; started: StartedAttempt[] } = {
      wave: waveId,
      layer: [],
      started: [],
    };
    await this.store.transact(async (snapshot) => {
      const layer = currentWaveLayer(waveId, [...snapshot.works.values()], stage);
      if (layer.length === 0) fail("INVALID_STATE", `wave ${waveId} has no work waiting at ${stage}`);
      assertTodoCoversLayer(layer, input.todoByWork, waveId);
      await this.assertCanStart(snapshot, layer, stage);

      const started: StartedAttempt[] = [];
      const changed = new Map<string, Work>();
      const minted = new Set<string>();
      for (const work of layer) {
        const todo = input.todoByWork.get(work.id) as TodoItem[];
        const opened = await this.openAttempt(snapshot, work, stage, execution, todo, minted);
        started.push(opened.entry);
        if (opened.changed !== undefined) changed.set(work.id, opened.changed);
      }

      outcome = { wave: waveId, layer: layer.map((work) => work.id), started };
      if (changed.size === 0) return { message: `codepatrol: noop ${waveId} ${stage}` };
      return { message: `codepatrol: start ${waveId} ${stage} (${changed.size} works)`, works: changed };
    });
    return outcome;
  }

  /**
   * Applies one result per Work of the Wave's active layer in a single
   * transaction. A single mismatched run refuses the whole batch, so a layer is
   * never left half-completed; decisions may differ between Works.
   */
  async completeWave(
    waveId: string,
    stage: Stage,
    entries: readonly { workId: string; runId: string; result: AttemptResult }[],
  ): Promise<{ wave: string; completed: Work[] }> {
    if (stage === "ship") fail("USAGE", "ship is only available for one work at a time");
    const normalized = entries.map((entry) => ({ ...entry, result: normalizeResult(entry.result) }));
    if (new Set(normalized.map((entry) => entry.workId)).size !== normalized.length) {
      fail("INVALID_INPUT", "the result document repeats a work");
    }
    let completed: Work[] = [];
    await this.store.transact(async (snapshot) => {
      const active = [...snapshot.works.values()]
        .filter((work) => work.wave === waveId && activeAttempt(work)?.stage === stage)
        .map((work) => work.id)
        .sort(compareWorkIdsCanonically);
      if (active.length > 0) {
        assertSameSet(
          active,
          [...normalized.map((entry) => entry.workId)].sort(compareWorkIdsCanonically),
          waveId,
          stage,
        );
      }

      const results: Work[] = [];
      const changed = new Map<string, Work>();
      for (const entry of normalized) {
        const work = snapshot.works.get(entry.workId);
        if (work === undefined) fail("NOT_FOUND", `work ${entry.workId} does not exist`);
        if (work.wave !== waveId) fail("INVALID_INPUT", `${entry.workId} does not belong to wave ${waveId}`);
        const closed = await this.closeAttempt(work, stage, entry.runId, entry.result);
        results.push(closed.work);
        if (closed.changed !== undefined) changed.set(closed.changed.id, closed.changed);
      }

      completed = results;
      if (changed.size === 0) return { message: `codepatrol: noop ${waveId} ${stage}` };
      return { message: `codepatrol: complete ${waveId} ${stage} (${changed.size} works)`, works: changed };
    });
    for (const work of completed) await this.evidence.cleanupAfterShip(work, stage);
    return { wave: waveId, completed };
  }

  async recordRemotePublication(workId: string, runId: string, publication: RemotePublication): Promise<void> {
    await this.store.transact((snapshot) => {
      const work = snapshot.works.get(workId);
      if (work === undefined) fail("NOT_FOUND", `work ${workId} does not exist`);
      const attempt = work.attempts.find((a) => a.runId === runId);
      if (attempt === undefined) fail("NOT_FOUND", `work ${workId} has no attempt with run ${runId}`);
      if (attempt.stage !== "ship") fail("INVALID_STATE", "remotePublication can only be recorded on ship attempts");
      const updated: Work = {
        ...work,
        attempts: work.attempts.map((a) =>
          a.runId === runId ? { ...a, evidence: { ...(a.evidence ?? {}), remotePublication: publication } } : a,
        ),
      };
      return { message: `codepatrol: recordRemotePublication ${workId}`, works: new Map([[workId, updated]]) };
    });
  }

  async reblock(id: string, blockedBy: string[], reason: { summary: string; authority: string }): Promise<Work> {
    if (reason.summary.trim() === "") fail("INVALID_INPUT", "reblock reason summary must be non-empty");
    if (reason.authority.trim() === "") fail("INVALID_INPUT", "reblock authority must be non-empty");
    if (new Set(blockedBy).size !== blockedBy.length) fail("INVALID_INPUT", "duplicate blockedBy entries");
    let updated: Work | undefined;
    await this.store.transact((snapshot) => {
      const work = snapshot.works.get(id);
      if (work === undefined) fail("NOT_FOUND", `work ${id} does not exist`);
      if (work.completion !== null) fail("INVALID_STATE", `${id} is terminal and cannot be reblocked`);
      if (activeAttempt(work) !== undefined)
        fail("INVALID_STATE", `${id} has an active attempt and cannot be reblocked`);
      for (const blocker of blockedBy) {
        if (blocker === id) fail("INVALID_INPUT", `${id} cannot block itself`);
        const blockerWork = snapshot.works.get(blocker);
        if (blockerWork === undefined) fail("NOT_FOUND", `blocker ${blocker} does not exist`);
        if (blockerWork.initiative !== work.initiative) {
          fail("INVALID_INPUT", `${id} cannot depend on ${blocker} from another initiative`);
        }
      }
      const next: Work = {
        ...work,
        blockedBy,
        dependencyRevisions: [
          ...work.dependencyRevisions,
          {
            revision: work.dependencyRevisions.length + 1,
            previous: work.blockedBy,
            next: blockedBy,
            summary: reason.summary,
            authority: reason.authority,
            changedAt: this.now(),
          },
        ],
      };
      const graph = new Map(snapshot.works);
      graph.set(id, next);
      assertAcyclic([...graph.values()]);
      updated = next;
      return { message: `codepatrol: reblock ${id}`, works: new Map([[id, next]]) };
    });
    return updated as Work;
  }

  private hasActiveSpec(snapshot: StateSnapshot): boolean {
    return [...snapshot.initiatives.values()].some((initiative) => activeSpecExecution(initiative) !== undefined);
  }
}
