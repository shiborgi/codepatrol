import type { AgentResolution } from "./agent-catalog.js";
import type { CommandResult } from "./command.js";
import { describeCommand } from "./command.js";
import type { Config } from "./config.js";
import type { ContextSnapshot } from "./context-provider.js";
import {
  type BuildReview,
  buildResultSchema,
  buildReviewSchema,
  type DocumentReview,
  documentReviewSchema,
  type Init,
  id,
  newRound,
  type Operation,
  type ProducerOperation,
  type Proposal,
  planDocumentSchema,
  producerFor,
  type ReviewOperation,
  type Round,
  type Source,
  type State,
  specDocumentSchema,
  type Task,
  type TaskEnvelope,
  type Wave,
} from "./core.js";
import { taskEnvelope, taskWithoutInstructions } from "./envelope.js";
import { assertDomain, CodePatrolError, ERROR_CODES } from "./errors.js";
import type { StateStore } from "./git.js";
import { type RunContext, systemRunContext } from "./run-context.js";
import {
  getInit,
  getOpenRound,
  getProposal,
  getRound,
  getTask,
  getWave,
  getWork,
  roundsFor,
} from "./selectors.js";
import {
  assertBlockers,
  assertCandidateVerdicts,
  assertExactSet,
  parseResult,
  resultAs,
  validateBuildApproval,
  validatePlan,
  validateSpec,
} from "./validators.js";
import { verifyCandidate } from "./verification.js";

// Keeps the service API explicit without exposing persistence details to the CLI.
export class CodePatrolService {
  constructor(
    readonly repo: StateStore,
    readonly config: Config,
    readonly ctx: RunContext = systemRunContext(),
  ) {}

  createInit(title: string, brief: string): Init {
    return this.repo.mutate("init create", (state) => {
      const number = state.nextInit;
      state.nextInit += 1;
      const init: Init = {
        id: `INIT-${number}`,
        title,
        brief,
        status: "specifying",
        specRounds: [newRound("spec", 1)],
        selectedSpecId: null,
        waveIds: [],
        reviewReturns: 0,
        createdAt: this.ctx.now().toISOString(),
      };
      state.inits.push(init);
      return init;
    });
  }

  openProducer(
    operation: ProducerOperation,
    subjectId: string,
    source: Source,
    seedProposalId?: string,
    agentInstructions?: string,
    contextSnapshot?: ContextSnapshot,
  ): TaskEnvelope {
    return this.openProducers(
      operation,
      subjectId,
      [{ source, agentInstructions: agentInstructions ?? "" }],
      seedProposalId,
      contextSnapshot,
    ).tasks[0] as TaskEnvelope;
  }

  openProducers(
    operation: ProducerOperation,
    subjectId: string,
    selections: Array<{ source: Source; agentInstructions: string }>,
    seedProposalId?: string,
    contextSnapshot?: ContextSnapshot,
  ): { tasks: TaskEnvelope[] } {
    assertDomain(
      selections.length > 0,
      ERROR_CODES.INVALID_TASK,
      "at least one producer selection is required",
    );
    const allocatedTaskIds: string[] = [];
    try {
      const taskIds = this.repo.mutate(`${operation} open ${subjectId}`, (state) => {
        let round: Round;
        let baseCommit: string | null = null;
        if (operation === "spec") {
          const init = getInit(state, subjectId);
          assertDomain(
            init.status === "specifying",
            ERROR_CODES.INVALID_STAGE,
            `${subjectId} is not specifying`,
          );
          round = getOpenRound(init.specRounds, "spec", subjectId);
        } else {
          const wave = getWave(state, subjectId);
          if (operation === "plan") {
            assertDomain(
              wave.status === "planning",
              ERROR_CODES.INVALID_STAGE,
              `${subjectId} is not planning`,
            );
            round = getOpenRound(wave.planRounds, "plan", subjectId);
          } else {
            if (wave.status === "ready-to-ship") {
              assertDomain(
                seedProposalId,
                ERROR_CODES.BASE_CHANGED,
                "a selected candidate is required to rebuild",
              );
              assertDomain(
                wave.selectedBuildId === seedProposalId,
                ERROR_CODES.CANDIDATE_NOT_SELECTED,
                "only the selected candidate can seed a rebuild",
              );
              wave.status = "building";
              wave.selectedBuildId = null;
              wave.buildRounds.push(newRound("build", wave.buildRounds.length + 1));
            }
            assertDomain(
              wave.status === "building",
              ERROR_CODES.INVALID_STAGE,
              `${subjectId} is not building`,
            );
            assertBlockers(state, wave);
            round = getOpenRound(wave.buildRounds, "build", subjectId);
            baseCommit = this.repo.currentCommit(this.config.baseBranch);
            const seedProposal = seedProposalId
              ? getProposal(state, seedProposalId)
              : null;
            assertDomain(
              !seedProposal ||
                (seedProposal.operation === "build" &&
                  seedProposal.subjectId === wave.id),
              ERROR_CODES.INVALID_CANDIDATE,
              "seed must be a build candidate from the same Wave",
            );
            const seed = seedProposal?.candidate ?? null;
            assertDomain(
              !seedProposalId || seed,
              ERROR_CODES.INVALID_CANDIDATE,
              "seed is not a build candidate",
            );
          }
        }
        for (const selection of selections) {
          const taskId = id("TASK");
          allocatedTaskIds.push(taskId);
          let workspace: string | null = null;
          if (operation === "build") {
            const seed = seedProposalId
              ? getProposal(state, seedProposalId).candidate
              : null;
            workspace = this.repo.createWorkspace(
              taskId,
              baseCommit as string,
              seed ? { base: seed.baseCommit, commit: seed.commit } : undefined,
            );
            this.repo.linkSharedPaths(
              workspace,
              this.config.verification.sharedPaths ?? [],
            );
          }
          state.tasks.push(
            createTask(this.ctx, {
              id: taskId,
              operation,
              subjectId,
              round: round.number,
              status: "open",
              source: selection.source,
              agentInstructions: selection.agentInstructions || undefined,
              contextSnapshot,
              workspace,
              baseCommit,
            }),
          );
        }
        return allocatedTaskIds;
      });
      return { tasks: taskIds.map((taskId) => this.showTask(taskId)) };
    } catch (error) {
      for (const taskId of allocatedTaskIds) this.repo.removeWorkspace(taskId);
      throw error;
    }
  }

  openReview(
    operation: ReviewOperation,
    subjectId: string,
    source: Source,
    agentInstructions?: string,
    contextSnapshot?: ContextSnapshot,
  ): TaskEnvelope {
    const producer = producerFor(operation);
    let taskId = "";
    this.repo.mutate(`${operation} open ${subjectId}`, (state) => {
      const rounds = roundsFor(state, producer, subjectId);
      const round = getOpenRound(rounds, producer, subjectId);
      assertDomain(
        round.proposalIds.length > 0,
        ERROR_CODES.NO_PROPOSALS,
        "review requires at least one proposal",
      );
      assertDomain(
        !state.tasks.some(
          (task) =>
            task.operation === producer &&
            task.subjectId === subjectId &&
            task.round === round.number &&
            ["preparing", "open", "blocked"].includes(task.status),
        ),
        ERROR_CODES.PRODUCERS_ACTIVE,
        "cancel or fail every open producer task before starting review",
      );
      assertDomain(
        !state.tasks.some(
          (task) =>
            task.operation === operation &&
            task.subjectId === subjectId &&
            task.round === round.number &&
            ["preparing", "open", "blocked"].includes(task.status),
        ),
        ERROR_CODES.REVIEW_EXISTS,
        "this round already has an active review",
      );
      taskId = id("TASK");
      const task = createTask(this.ctx, {
        id: taskId,
        operation,
        subjectId,
        round: round.number,
        status: operation === "build-review" ? "preparing" : "open",
        source,
        agentInstructions,
        contextSnapshot,
        workspace: null,
        baseCommit: null,
      });
      state.tasks.push(task);
      round.status = "reviewing";
      round.reviewTaskId = taskId;
    });
    if (operation === "build-review") this.prepareBuildReview(taskId);
    return this.showTask(taskId);
  }

  private prepareBuildReview(taskId: string): void {
    const snapshot = this.repo.readState().state;
    const task = getTask(snapshot, taskId);
    assertDomain(
      task.operation === "build-review" &&
        ["preparing", "blocked"].includes(task.status),
      ERROR_CODES.INVALID_TASK,
      "task is not a review awaiting verification",
    );
    const round = getRound(roundsFor(snapshot, "build", task.subjectId), task.round);
    const verification = round.proposalIds.map((proposalId) => {
      const candidate = getProposal(snapshot, proposalId).candidate;
      assertDomain(
        candidate,
        ERROR_CODES.INVALID_CANDIDATE,
        `${proposalId} has no candidate`,
      );
      return verifyCandidate(
        this.ctx,
        this.repo,
        proposalId,
        candidate.commit,
        this.config.verification.argv,
        this.config.verification.timeoutMs,
        this.config.verification.sharedPaths ?? [],
      );
    });
    this.repo.mutate(`build-review prepared ${task.subjectId}`, (state) => {
      const current = getTask(state, taskId);
      assertDomain(
        ["preparing", "blocked"].includes(current.status),
        ERROR_CODES.TASK_CHANGED,
        "review task changed during verification",
      );
      current.verification = verification;
      const infrastructure = verification.find(
        (entry) => entry.status === "infrastructure-failed",
      );
      current.status = infrastructure ? "blocked" : "open";
      current.failure = infrastructure
        ? {
            code: "INFRASTRUCTURE_FAILED",
            message: infrastructure.output || "verification failed to start",
          }
        : null;
    });
  }

  retryTask(taskId: string): TaskEnvelope {
    const task = getTask(this.repo.readState().state, taskId);
    assertDomain(
      task.operation === "build-review",
      ERROR_CODES.NOT_RETRYABLE,
      "only build review preparation retries",
    );
    assertDomain(
      ["preparing", "blocked"].includes(task.status),
      ERROR_CODES.NOT_RETRYABLE,
      "task is not awaiting preparation",
    );
    this.prepareBuildReview(taskId);
    return this.showTask(taskId);
  }

  submitTask(taskId: string, raw: unknown): TaskEnvelope {
    const before = getTask(this.repo.readState().state, taskId);
    assertDomain(
      before.status === "open",
      ERROR_CODES.TASK_NOT_OPEN,
      `${taskId} is not open`,
    );
    const parsed = parseResult(before.operation, raw);
    try {
      const mutation = this.repo.mutate(
        `${before.operation} submit ${before.subjectId}`,
        (state) => {
          const refsToDelete: Array<{ ref: string; commit: string }> = [];
          let submittedBuildTask: string | null = null;
          let submittedCandidate: Proposal["candidate"] = null;
          try {
            const task = getTask(state, taskId);
            assertDomain(
              task.status === "open",
              ERROR_CODES.TASK_NOT_OPEN,
              `${taskId} is not open`,
            );
            if (isProducer(task.operation)) {
              const round = getRound(
                roundsFor(state, task.operation, task.subjectId),
                task.round,
              );
              assertDomain(
                round.status === "open",
                ERROR_CODES.ROUND_SEALED,
                "the proposal round is sealed",
              );
              const proposalId = id("PROP");
              let candidate: Proposal["candidate"] = null;
              let document: Record<string, unknown> | null = null;
              let summary: string | null = null;
              if (task.operation === "spec") {
                const spec = resultAs(parsed, specDocumentSchema);
                validateSpec(spec);
                document = spec;
              } else if (task.operation === "plan") {
                const plan = resultAs(parsed, planDocumentSchema);
                validatePlan(state, getWave(state, task.subjectId), plan);
                document = plan;
              } else {
                const build = resultAs(parsed, buildResultSchema);
                const wave = getWave(state, task.subjectId);
                assertExactSet(
                  build.works.map((entry) => entry.workId),
                  wave.workIds,
                  "WORK_COVERAGE_MISMATCH",
                );
                assertDomain(
                  task.baseCommit,
                  ERROR_CODES.INVALID_TASK,
                  "build task has no base commit",
                );
                candidate = this.repo.submitCandidate(
                  task.id,
                  task.subjectId,
                  proposalId,
                  task.baseCommit,
                );
                submittedCandidate = candidate;
                summary = build.summary;
                submittedBuildTask = task.id;
              }
              const proposal: Proposal = {
                id: proposalId,
                taskId: task.id,
                operation: task.operation,
                subjectId: task.subjectId,
                round: task.round,
                source: task.source,
                document,
                candidate,
                summary,
                createdAt: this.ctx.now().toISOString(),
              };
              state.proposals.push(proposal);
              round.proposalIds.push(proposalId);
              task.proposalId = proposalId;
            } else {
              const review =
                task.operation === "build-review"
                  ? resultAs(parsed, buildReviewSchema)
                  : resultAs(parsed, documentReviewSchema);
              refsToDelete.push(...this.applyReview(state, task, review));
            }
            task.status = "submitted";
            task.result = parsed;
            task.finishedAt = this.ctx.now().toISOString();
            return { refsToDelete, submittedBuildTask, submittedCandidate };
          } catch (error) {
            if (submittedCandidate)
              throw new CandidateMutationError(submittedCandidate, error);
            throw error;
          }
        },
      );
      if (mutation.submittedBuildTask)
        this.repo.removeWorkspace(mutation.submittedBuildTask);
      for (const candidate of mutation.refsToDelete) {
        try {
          this.repo.deleteRef(candidate.ref, candidate.commit);
        } catch {}
      }
      return this.showTask(taskId);
    } catch (error) {
      const candidate =
        error instanceof CandidateMutationError ? error.candidate : null;
      if (candidate) {
        try {
          this.repo.deleteRef(candidate.ref, candidate.commit);
        } catch {}
      }
      throw error instanceof CandidateMutationError ? error.cause : error;
    }
  }

  private applyReview(
    state: State,
    task: Task,
    result: DocumentReview | BuildReview,
  ): Array<{ ref: string; commit: string }> {
    assertDomain(
      !isProducer(task.operation),
      ERROR_CODES.INVALID_TASK,
      "producer task is not a review",
    );
    const operation = task.operation;
    const producer = producerFor(operation);
    const round = getRound(roundsFor(state, producer, task.subjectId), task.round);
    assertDomain(
      round.status === "reviewing",
      ERROR_CODES.ROUND_NOT_REVIEWING,
      "round is not under review",
    );
    if (operation === "spec-review") {
      assertDomain(
        getInit(state, task.subjectId).status === "specifying",
        ERROR_CODES.INVALID_STAGE,
        "Init left Spec while this review was open",
      );
    } else {
      const expected = operation === "plan-review" ? "planning" : "building";
      assertDomain(
        getWave(state, task.subjectId).status === expected,
        ERROR_CODES.INVALID_STAGE,
        `Wave left ${expected} while this review was open`,
      );
    }
    assertCandidateVerdicts(round, result);
    const decision = result.decision;
    const selected = result.selectedProposalId;
    if (decision === "approve") {
      assertDomain(
        selected,
        ERROR_CODES.SELECTION_REQUIRED,
        "approval requires selectedProposalId",
      );
      assertDomain(
        round.proposalIds.includes(selected),
        ERROR_CODES.INVALID_SELECTION,
        "selected proposal is not in round",
      );
      const verdict = result.candidates.find((entry) => entry.proposalId === selected);
      assertDomain(
        verdict?.status === "passed",
        ERROR_CODES.SELECTED_CANDIDATE_FAILED,
        "selected proposal did not pass review",
      );
      round.status = "approved";
      round.selectedProposalId = selected;
      if (operation === "spec-review") {
        this.materializeSpec(
          state,
          getInit(state, task.subjectId),
          getProposal(state, selected),
        );
      } else if (operation === "plan-review") {
        const wave = getWave(state, task.subjectId);
        const plan = resultAs(
          getProposal(state, selected).document,
          planDocumentSchema,
        );
        validatePlan(state, wave, plan);
        wave.selectedPlanId = selected;
        wave.status = "building";
        wave.buildRounds.push(newRound("build", 1));
      } else {
        const wave = getWave(state, task.subjectId);
        if (!("acceptance" in result)) {
          throw new CodePatrolError(
            ERROR_CODES.INTERNAL,
            "build review result has no acceptance evidence",
          );
        }
        validateBuildApproval(state, wave, task, result, selected);
        wave.selectedBuildId = selected;
        wave.status = "ready-to-ship";
      }
    } else {
      assertDomain(
        !selected,
        ERROR_CODES.INVALID_SELECTION,
        "return must not select a proposal",
      );
      round.status = "returned";
      if (operation === "spec-review") {
        const init = getInit(state, task.subjectId);
        init.reviewReturns += 1;
        if (init.reviewReturns < this.config.maxReviewReturns) {
          init.specRounds.push(newRound("spec", init.specRounds.length + 1));
        }
      } else {
        const wave = getWave(state, task.subjectId);
        const key = producer === "plan" ? "plan" : "build";
        wave.reviewReturns[key] += 1;
        if (wave.reviewReturns[key] < this.config.maxReviewReturns) {
          const rounds = producer === "plan" ? wave.planRounds : wave.buildRounds;
          rounds.push(newRound(producer, rounds.length + 1));
        }
      }
    }
    if (operation !== "build-review" || decision === "return") return [];
    return round.proposalIds
      .filter((proposalId) => proposalId !== round.selectedProposalId)
      .map((proposalId) => getProposal(state, proposalId).candidate)
      .filter((candidate): candidate is NonNullable<Proposal["candidate"]> =>
        Boolean(candidate),
      )
      .map((candidate) => ({ ref: candidate.ref, commit: candidate.commit }));
  }

  private materializeSpec(state: State, init: Init, proposal: Proposal): void {
    const document = resultAs(proposal.document, specDocumentSchema);
    const workKeys = new Map<string, string>();
    document.waves.forEach((wave, waveIndex) => {
      wave.works.forEach((work, workIndex) => {
        workKeys.set(
          work.key,
          `WORK-${init.id.slice(5)}.${waveIndex + 1}.${workIndex + 1}`,
        );
      });
    });
    document.waves.forEach((definition, waveIndex) => {
      const waveId = `WAVE-${init.id.slice(5)}.${waveIndex + 1}`;
      const workIds: string[] = [];
      definition.works.forEach((definitionWork, workIndex) => {
        const workId = `WORK-${init.id.slice(5)}.${waveIndex + 1}.${workIndex + 1}`;
        workIds.push(workId);
        state.works.push({
          id: workId,
          waveId,
          key: definitionWork.key,
          title: definitionWork.title,
          description: definitionWork.description,
          acceptance: definitionWork.acceptance.map((text, acceptanceIndex) => ({
            id: `AC-${init.id.slice(5)}.${waveIndex + 1}.${workIndex + 1}.${acceptanceIndex + 1}`,
            text,
          })),
          blockedBy: definitionWork.blockedBy.map((key) => workKeys.get(key) as string),
          status: "pending",
        });
      });
      state.waves.push({
        id: waveId,
        initId: init.id,
        title: definition.title,
        status: "planning",
        workIds,
        planRounds: [newRound("plan", 1)],
        buildRounds: [],
        selectedPlanId: null,
        selectedBuildId: null,
        reviewReturns: { plan: 0, build: 0 },
        ship: null,
      });
      init.waveIds.push(waveId);
    });
    init.selectedSpecId = proposal.id;
    init.status = "active";
  }

  cancelTask(taskId: string): TaskEnvelope {
    return this.terminateTask(taskId, "cancelled");
  }

  failTask(taskId: string, message: string): TaskEnvelope {
    return this.terminateTask(taskId, "failed", message);
  }

  private terminateTask(
    taskId: string,
    status: "cancelled" | "failed",
    message?: string,
  ): TaskEnvelope {
    let workspace: string | null = null;
    this.repo.mutate(
      `task ${status === "cancelled" ? "cancel" : "fail"} ${taskId}`,
      (state) => {
        const task = getTask(state, taskId);
        assertDomain(
          ["preparing", "open", "blocked"].includes(task.status),
          ERROR_CODES.TASK_TERMINAL,
          "task is already terminal",
        );
        workspace = task.workspace;
        if (!isProducer(task.operation)) {
          const round = getRound(
            roundsFor(state, producerFor(task.operation), task.subjectId),
            task.round,
          );
          round.status = "open";
          round.reviewTaskId = null;
        }
        task.status = status;
        task.failure =
          status === "failed"
            ? { code: "EXECUTOR_FAILED", message: message as string }
            : null;
        task.finishedAt = this.ctx.now().toISOString();
      },
    );
    if (workspace) this.repo.removeWorkspace(taskId);
    return this.showTask(taskId);
  }

  resumeInit(initId: string): Init {
    return this.repo.mutate(`init resume ${initId}`, (state) => {
      const init = getInit(state, initId);
      assertDomain(
        init.status === "specifying",
        ERROR_CODES.INVALID_STAGE,
        "init is not specifying",
      );
      const latest = init.specRounds.at(-1);
      assertDomain(
        latest?.status === "returned",
        ERROR_CODES.RESUME_NOT_ALLOWED,
        "only the latest returned Spec round can be resumed",
      );
      init.specRounds.push(newRound("spec", init.specRounds.length + 1));
      return init;
    });
  }

  resumeWave(waveId: string, operation: "plan" | "build"): Wave {
    return this.repo.mutate(`wave resume ${waveId} ${operation}`, (state) => {
      const wave = getWave(state, waveId);
      const rounds = operation === "plan" ? wave.planRounds : wave.buildRounds;
      assertDomain(
        rounds.at(-1)?.status === "returned",
        ERROR_CODES.RESUME_NOT_ALLOWED,
        `only the latest returned ${operation} round can be resumed`,
      );
      assertDomain(
        wave.status === (operation === "plan" ? "planning" : "building"),
        ERROR_CODES.INVALID_STAGE,
        `${waveId} is not in ${operation}`,
      );
      rounds.push(newRound(operation, rounds.length + 1));
      return wave;
    });
  }

  showTask(taskId: string): TaskEnvelope {
    const state = this.repo.readState().state;
    return taskEnvelope(state, getTask(state, taskId));
  }

  list(kind: "init" | "wave" | "work" | "task"): unknown[] {
    const state = this.repo.readState().state;
    if (kind === "init") return state.inits;
    if (kind === "wave") return state.waves;
    if (kind === "work") return state.works;
    return state.tasks.map(taskWithoutInstructions);
  }

  show(kind: "init" | "wave" | "work", subjectId: string): unknown {
    const state = this.repo.readState().state;
    if (kind === "init") return getInit(state, subjectId);
    if (kind === "wave") return getWave(state, subjectId);
    return getWork(state, subjectId);
  }

  shipStatus(waveId: string): unknown {
    const state = this.repo.readState().state;
    const wave = getWave(state, waveId);
    assertDomain(
      wave.status === "ready-to-ship",
      ERROR_CODES.INVALID_STAGE,
      `${waveId} is not ready to ship`,
    );
    const proposal = getProposal(state, wave.selectedBuildId as string);
    return {
      waveId,
      proposal,
      currentBase: this.repo.currentCommit(this.config.baseBranch),
    };
  }

  composeShipStatus(
    waveId: string,
    resolution: AgentResolution | undefined,
    context: ContextSnapshot | undefined,
  ): Record<string, unknown> {
    return {
      ...(this.shipStatus(waveId) as Record<string, unknown>),
      ...(resolution
        ? {
            agent: resolution.agent,
            agentInstructionsDigest: resolution.instructionsDigest,
            agentInstructions: resolution.instructions,
          }
        : {}),
      ...(context === undefined ? {} : { contextSnapshot: context }),
    };
  }

  shipAccept(waveId: string): unknown {
    return this.transitionShip(waveId, "accept");
  }

  shipRollback(waveId: string): unknown {
    return this.transitionShip(waveId, "rollback");
  }

  private transitionShip(waveId: string, decision: "accept" | "rollback"): unknown {
    return this.repo.withLock(() => {
      const { state, oid } = this.repo.readState();
      const next = structuredClone(state);
      const wave = getWave(next, waveId);
      assertDomain(
        wave.status === "ready-to-ship",
        ERROR_CODES.INVALID_STAGE,
        `${waveId} is not ready to ship`,
      );
      const proposal = getProposal(next, wave.selectedBuildId as string);
      const candidate = proposal.candidate;
      assertDomain(
        candidate,
        ERROR_CODES.INVALID_CANDIDATE,
        "selected proposal has no candidate",
      );
      const main = this.repo.currentCommit(this.config.baseBranch);
      if (decision === "accept") {
        assertDomain(
          main === candidate.baseCommit,
          ERROR_CODES.BASE_CHANGED,
          "base branch changed; open a build seeded from the selected candidate",
        );
        assertDomain(
          this.repo.resolveRef(candidate.ref) === candidate.commit,
          ERROR_CODES.CANDIDATE_CHANGED,
          "selected candidate ref changed",
        );
      }
      wave.status = decision === "accept" ? "accepted" : "rolled-back";
      wave.ship = {
        decision,
        candidateCommit: candidate.commit,
        at: this.ctx.now().toISOString(),
      };
      for (const workId of wave.workIds) getWork(next, workId).status = "accepted";
      if (decision === "rollback")
        for (const workId of wave.workIds) getWork(next, workId).status = "rolled-back";
      updateInitTerminal(next, wave.initId);
      next.sequence += 1;
      if (decision === "accept")
        this.repo.atomicShip(
          next,
          oid,
          this.config.baseBranch,
          main,
          candidate.ref,
          candidate.commit,
          `ship accept ${waveId}`,
        );
      else
        this.repo.atomicRollback(
          next,
          oid,
          candidate.ref,
          candidate.commit,
          `ship rollback ${waveId}`,
        );
      this.cleanupCandidateRefs(next, waveId);
      return { waveId, decision, commit: candidate.commit };
    });
  }

  cleanup(): {
    removedWorktrees: string[];
    preservedWorktrees: string[];
    dirtyOrphans: string[];
  } {
    return this.repo.withLock(() => {
      const state = this.repo.readState().state;
      const activeWorkspaces = new Set(
        state.tasks
          .filter((task) => ["preparing", "open", "blocked"].includes(task.status))
          .map((task) => task.workspace)
          .filter((path): path is string => Boolean(path)),
      );
      const removed: string[] = [];
      const preserved: string[] = [];
      const dirty: string[] = [];
      for (const path of this.repo.listManagedWorktrees()) {
        if (activeWorkspaces.has(path)) {
          preserved.push(path);
          continue;
        }
        const status = this.repo.tryGit(["status", "--porcelain"], path);
        if (status.status !== "succeeded" || status.stdout.trim()) {
          dirty.push(path);
          continue;
        }
        this.logCleanup(
          ["worktree", "remove", path],
          this.repo.tryGit(["worktree", "remove", path]),
        );
        const taskId = path.split(/[\\/]/).at(-1) as string;
        this.logCleanup(
          ["branch", "-D", `codepatrol-v1/${taskId}`],
          this.repo.tryGit(["branch", "-D", `codepatrol-v1/${taskId}`]),
        );
        removed.push(path);
      }
      this.logCleanup(["worktree", "prune"], this.repo.tryGit(["worktree", "prune"]));
      const liveCandidates = new Set(
        state.proposals
          .filter((proposal) => {
            if (!proposal.candidate) return false;
            const wave = state.waves.find((entry) => entry.id === proposal.subjectId);
            return wave && !["accepted", "rolled-back"].includes(wave.status);
          })
          .map((proposal) => proposal.candidate?.ref),
      );
      for (const ref of this.repo.listRefs("refs/codepatrol/v1/candidates/")) {
        if (!liveCandidates.has(ref))
          this.logCleanup(
            ["update-ref", "-d", ref],
            this.repo.tryGit(["update-ref", "-d", ref]),
          );
      }
      return {
        removedWorktrees: removed,
        preservedWorktrees: preserved,
        dirtyOrphans: dirty,
      };
    });
  }

  private logCleanup(args: string[], result: CommandResult): void {
    const outcome = describeCommand(result);
    const line = `cleanup git ${args.join(" ")}: ${outcome}`;
    if (result.status === "succeeded") this.ctx.log.debug(line);
    else this.ctx.log.warn(line);
  }

  private cleanupCandidateRefs(state: State, waveId: string): void {
    for (const proposal of state.proposals) {
      if (proposal.subjectId !== waveId || !proposal.candidate) continue;
      this.repo.tryGit([
        "update-ref",
        "-d",
        proposal.candidate.ref,
        proposal.candidate.commit,
      ]);
    }
  }
}

class CandidateMutationError extends Error {
  constructor(
    readonly candidate: NonNullable<Proposal["candidate"]>,
    readonly cause: unknown,
  ) {
    super("candidate mutation failed", { cause });
  }
}

function createTask(
  ctx: RunContext,
  seed: {
    id: string;
    operation: Operation;
    subjectId: string;
    round: number;
    status: Task["status"];
    source: Source;
    agentInstructions?: string;
    contextSnapshot?: ContextSnapshot;
    workspace: string | null;
    baseCommit: string | null;
  },
): Task {
  return {
    ...seed,
    ...(seed.agentInstructions === undefined
      ? {}
      : { agentInstructions: seed.agentInstructions }),
    ...(seed.contextSnapshot === undefined
      ? {}
      : { contextSnapshot: seed.contextSnapshot }),
    proposalId: null,
    result: null,
    verification: [],
    failure: null,
    createdAt: ctx.now().toISOString(),
    finishedAt: null,
  };
}

function isProducer(operation: Operation): operation is ProducerOperation {
  return ["spec", "plan", "build"].includes(operation);
}

function updateInitTerminal(state: State, initId: string): void {
  const init = getInit(state, initId);
  const waves = init.waveIds.map((waveId) => getWave(state, waveId));
  if (waves.every((wave) => wave.status === "accepted")) init.status = "accepted";
  else if (waves.every((wave) => ["accepted", "rolled-back"].includes(wave.status))) {
    init.status = "rolled-back";
  }
}
