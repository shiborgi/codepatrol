import { randomUUID } from "node:crypto";
import type { AgentResolution } from "./agent-catalog.js";
import type { CommandResult } from "./command.js";
import { describeCommand } from "./command.js";
import type { Config } from "./config.js";
import type { ContextProfileArtifact, ContextSnapshot } from "./context-provider.js";
import {
  arbitrationResultSchema,
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
import {
  computeFingerprint,
  configurationDigest,
  descriptorFromSource,
  type ExecutionDescriptor,
  type ExecutionRecord,
  producerArtifactDigest,
} from "./execution.js";
import { filterSharedPathEntries, type StateStore } from "./git.js";
import type { RoutingDecisionInput } from "./orchestrator.js";
import {
  applySelectedAttempt,
  attemptIsTerminal,
  attemptsAgree,
  attemptTasks,
  evaluateAttempt,
  isArbitrationTask,
  isAuthoritativeReview,
  isReviewAttempt,
  isValidStoredAttempt,
  pickConsensusAttempt,
  recordReviewerOutcome,
  recordShipOutcome,
  reviewRoundFor,
  validateArbitrationSelection,
} from "./review-orchestration.js";
import { type RunContext, systemRunContext } from "./run-context.js";
import {
  buildReviewProtocol,
  type CandidateScorecard,
  computeReviewOutcome,
  validateScorecards,
} from "./scorecards.js";
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
import { applyReview } from "./service/review.js";
import {
  assertBlockers,
  assertExactSet,
  parseResult,
  resultAs,
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
      [{ source, agentInstructions: agentInstructions ?? "", contextSnapshot }],
      seedProposalId,
    ).tasks[0] as TaskEnvelope;
  }

  openProducers(
    operation: ProducerOperation,
    subjectId: string,
    selections: Array<{
      source: Source;
      agentInstructions: string;
      contextSnapshot?: ContextSnapshot;
    }>,
    seedProposalId?: string,
    contextSnapshot?: ContextSnapshot,
    descriptors?: ExecutionDescriptor[],
    routingDecision?: RoutingDecisionInput,
  ): { tasks: TaskEnvelope[] } {
    assertDomain(
      selections.length > 0,
      ERROR_CODES.INVALID_TASK,
      "at least one producer selection is required",
    );
    assertDomain(
      !descriptors || descriptors.length === selections.length,
      ERROR_CODES.INVALID_TASK,
      "execution descriptors must match the producer selections",
    );
    const batchId = randomUUID();
    const executions = selections.map((selection, index) => {
      const descriptor =
        descriptors?.[index] ??
        descriptorFromSource(
          selection.source,
          selection.contextSnapshot?.profile ?? contextSnapshot?.profile ?? null,
        );
      return {
        schemaVersion: 1 as const,
        descriptor,
        configurationDigest: configurationDigest(descriptor),
        batch: {
          id: batchId,
          ordinal: index + 1,
          total: selections.length,
        },
      };
    });
    const seen = new Set<string>();
    if (descriptors) {
      for (const execution of executions) {
        assertDomain(
          !seen.has(execution.configurationDigest),
          ERROR_CODES.DUPLICATE_EXECUTION,
          "repeated canonical configuration digest in producer batch",
        );
        seen.add(execution.configurationDigest);
      }
    }
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
        for (const [index, selection] of selections.entries()) {
          const taskId = id("TASK");
          allocatedTaskIds.push(taskId);
          let workspace: string | null = null;
          let status: Task["status"] = "open";
          let failure: Task["failure"] = null;
          if (operation === "build") {
            const seed = seedProposalId
              ? getProposal(state, seedProposalId).candidate
              : null;
            try {
              workspace = this.repo.createWorkspace(
                taskId,
                baseCommit as string,
                seed ? { base: seed.baseCommit, commit: seed.commit } : undefined,
              );
              this.repo.linkSharedPaths(
                workspace,
                this.config.verification.sharedPaths ?? [],
              );
            } catch (error) {
              if (
                !(error instanceof CodePatrolError) ||
                error.code !== ERROR_CODES.SEED_CONFLICT
              )
                throw error;
              workspace = this.repo.workspacePath(taskId);
              status = "failed";
              failure = { code: error.code, message: error.message };
            }
          }
          const task = createTask(this.ctx, {
            id: taskId,
            operation,
            subjectId,
            round: round.number,
            status,
            source: selection.source,
            agentInstructions: selection.agentInstructions || undefined,
            contextSnapshot: selection.contextSnapshot ?? contextSnapshot,
            execution: executions[index],
            workspace,
            baseCommit,
          });
          if (failure) {
            task.failure = failure;
            task.finishedAt = this.ctx.now().toISOString();
          }
          state.tasks.push(task);
        }
        if (!state.routing) {
          (state as any).routing = {
            schemaVersion: 1,
            decisions: [],
            observations: [],
            aggregates: [],
          };
        }
        const routing = (state as any).routing;
        const decId = `DEC-${randomUUID()}`;
        routing.decisions.push(
          routingDecision
            ? {
                ...routingDecision,
                decisionId: decId,
                createdAt: this.ctx.now().toISOString(),
              }
            : {
                decisionId: decId,
                operation,
                policyVersion: "1",
                policyDigest: "sha256:" + "0".repeat(64),
                taskFeatureDigest: "sha256:" + "0".repeat(64),
                taskClass: "general",
                memoryDigest: "sha256:" + "0".repeat(64),
                eligibleRoutes: [],
                scoreComponents: [],
                selectedRoutes: [],
                uncertainty: 0,
                fanoutReason: "explicit",
                overrideMode: "none",
                createdAt: this.ctx.now().toISOString(),
              },
        );
        for (const t of state.tasks.slice(-selections.length)) {
          (t as any).routingDecisionId = decId;
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
    contextSnapshots?: ContextSnapshot[],
    contextProfileArtifacts?: ContextProfileArtifact[],
  ): TaskEnvelope {
    const producer = producerFor(operation);
    const snapshotProfiles = contextSnapshots?.map((snapshot) => snapshot.profile);
    if (
      snapshotProfiles &&
      new Set(snapshotProfiles).size !== snapshotProfiles.length
    ) {
      throw new CodePatrolError(
        ERROR_CODES.CONTEXT_COMPARISON_MISMATCH,
        "context profiles must be unique",
      );
    }
    const artifactKeys = contextProfileArtifacts?.map(
      (artifact) => `${artifact.proposalId ?? ""}:${artifact.profile}`,
    );
    if (artifactKeys && new Set(artifactKeys).size !== artifactKeys.length) {
      throw new CodePatrolError(
        ERROR_CODES.CONTEXT_COMPARISON_MISMATCH,
        "context artifacts must be unique by proposal and profile",
      );
    }
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
        contextSnapshots,
        contextProfileArtifacts,
        workspace: null,
        baseCommit: null,
        reviewRole: "authoritative",
      });
      task.reviewProtocol = buildReviewProtocol(state, task, round.proposalIds);
      state.tasks.push(task);
      round.status = "reviewing";
      round.reviewTaskId = taskId;
      if (!state.routing) {
        (state as any).routing = {
          schemaVersion: 1,
          decisions: [],
          observations: [],
          aggregates: [],
        };
      }
      const routing = (state as any).routing;
      const decId = `DEC-${randomUUID()}`;
      const dummyDigest2 = "sha256:" + "0".repeat(64);
      routing.decisions.push({
        decisionId: decId,
        operation,
        policyVersion: "1",
        policyDigest: dummyDigest2,
        taskFeatureDigest: dummyDigest2,
        taskClass: "general",
        memoryDigest: dummyDigest2,
        eligibleRoutes: [],
        scoreComponents: [],
        selectedRoutes: [],
        uncertainty: 0,
        fanoutReason: "explicit",
        overrideMode: "none",
        createdAt: this.ctx.now().toISOString(),
      });
      (task as any).routingDecisionId = decId;
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

  openReviewAttempts(
    operation: ReviewOperation,
    subjectId: string,
    selections: Array<{
      source: Source;
      agentInstructions?: string;
      contextSnapshot?: ContextSnapshot;
      contextSnapshots?: ContextSnapshot[];
      contextProfileArtifacts?: ContextProfileArtifact[];
    }>,
  ): { tasks: TaskEnvelope[] } {
    const maxFanout = this.config.orchestrator?.maxFanout ?? 5;
    assertDomain(
      selections.length >= 2 && selections.length <= maxFanout,
      ERROR_CODES.INVALID_TASK,
      "review attempts require between two and maxFanout unique routes",
    );
    const producer = producerFor(operation);
    const batchId = randomUUID();
    const executions = selections.map((selection, index) => {
      const descriptor = descriptorFromSource(
        selection.source,
        selection.contextSnapshot?.profile ?? null,
      );
      return {
        schemaVersion: 1 as const,
        descriptor,
        configurationDigest: configurationDigest(descriptor),
        batch: { id: batchId, ordinal: index + 1, total: selections.length },
      };
    });
    const seen = new Set<string>();
    for (const execution of executions) {
      assertDomain(
        !seen.has(execution.configurationDigest),
        ERROR_CODES.DUPLICATE_EXECUTION,
        "repeated canonical configuration digest in review attempt batch",
      );
      seen.add(execution.configurationDigest);
    }
    const taskIds: string[] = [];
    this.repo.mutate(`${operation} open ${subjectId}`, (state) => {
      const round = getOpenRound(
        roundsFor(state, producer, subjectId),
        producer,
        subjectId,
      );
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
      const protocolSeed = createTask(this.ctx, {
        id: "TASK-protocol",
        operation,
        subjectId,
        round: round.number,
        status: "open",
        source: selections[0]?.source as Source,
        workspace: null,
        baseCommit: null,
      });
      const protocol = buildReviewProtocol(state, protocolSeed, round.proposalIds);
      const dummyDigest = `sha256:${"0".repeat(64)}`;
      const decId = `DEC-${randomUUID()}`;
      if (!state.routing) {
        state.routing = {
          schemaVersion: 1,
          decisions: [],
          observations: [],
          aggregates: [],
        };
      }
      state.routing.decisions.push({
        decisionId: decId,
        operation,
        policyVersion: this.config.orchestrator?.policyVersion ?? "1",
        policyDigest: dummyDigest,
        taskFeatureDigest: dummyDigest,
        taskClass: "general",
        memoryDigest: dummyDigest,
        eligibleRoutes: executions.map((entry) => entry.configurationDigest),
        scoreComponents: [],
        selectedRoutes: executions.map((entry) => entry.configurationDigest),
        uncertainty: this.config.orchestrator?.uncertaintyThreshold ?? 1,
        fanoutReason: "uncertain",
        overrideMode: "none",
        createdAt: this.ctx.now().toISOString(),
      });
      for (const [index, selection] of selections.entries()) {
        const taskId = id("TASK");
        taskIds.push(taskId);
        const task = createTask(this.ctx, {
          id: taskId,
          operation,
          subjectId,
          round: round.number,
          status: operation === "build-review" ? "preparing" : "open",
          source: selection.source,
          agentInstructions: selection.agentInstructions,
          contextSnapshot: selection.contextSnapshot,
          contextSnapshots: selection.contextSnapshots,
          contextProfileArtifacts: selection.contextProfileArtifacts,
          execution: executions[index],
          workspace: null,
          baseCommit: null,
          reviewRole: "attempt",
          reviewBatchId: batchId,
          routingDecisionId: decId,
        });
        task.reviewProtocol = structuredClone(protocol);
        state.tasks.push(task);
      }
      round.status = "reviewing";
      round.reviewTaskId = null;
      round.reviewAttemptIds = [...taskIds];
      round.reviewBatchId = batchId;
      round.arbitrationTaskId = null;
    });
    if (operation === "build-review") this.prepareBuildReviewBatch(taskIds);
    return { tasks: taskIds.map((taskId) => this.showTask(taskId)) };
  }

  openArbitration(
    operation: ReviewOperation,
    subjectId: string,
    source: Source,
    agentInstructions?: string,
  ): TaskEnvelope {
    let taskId = "";
    this.repo.mutate(`${operation} open ${subjectId}`, (state) => {
      const producer = producerFor(operation);
      const rounds = roundsFor(state, producer, subjectId);
      const round = rounds.at(-1);
      assertDomain(round, ERROR_CODES.NO_OPEN_ROUND, "round not found");
      assertDomain(
        round.status === "reviewing",
        ERROR_CODES.ROUND_NOT_REVIEWING,
        "round is not under review",
      );
      assertDomain(
        (round.reviewAttemptIds ?? []).length > 0,
        ERROR_CODES.INVALID_TASK,
        "arbitration requires review attempts",
      );
      assertDomain(
        !round.reviewTaskId,
        ERROR_CODES.REVIEW_EXISTS,
        "authoritative review already selected",
      );
      assertDomain(
        !state.tasks.some(
          (task) =>
            task.id === round.arbitrationTaskId &&
            ["preparing", "open", "blocked"].includes(task.status),
        ),
        ERROR_CODES.REVIEW_EXISTS,
        "arbitration is already open",
      );
      const attempts = attemptTasks(state, round.reviewBatchId ?? undefined);
      assertDomain(
        attempts.every(attemptIsTerminal),
        ERROR_CODES.PRODUCERS_ACTIVE,
        "every review attempt must be terminal before arbitration",
      );
      const valid = attempts.filter((attempt) => isValidStoredAttempt(state, attempt));
      const minValid = this.config.orchestrator?.minValidAttempts ?? 1;
      assertDomain(
        valid.length >= minValid,
        ERROR_CODES.INSUFFICIENT_VALID_ATTEMPTS,
        "not enough valid review attempts for arbitration",
      );
      assertDomain(
        !attemptsAgree(valid),
        ERROR_CODES.INVALID_TASK,
        "agreeing attempts do not require arbitration",
      );
      taskId = id("TASK");
      const template = attempts[0] as Task;
      const task = createTask(this.ctx, {
        id: taskId,
        operation,
        subjectId,
        round: round.number,
        status: "open",
        source,
        agentInstructions,
        workspace: null,
        baseCommit: null,
        reviewRole: "arbitration",
        reviewBatchId: round.reviewBatchId ?? template.reviewBatchId,
        routingDecisionId: template.routingDecisionId,
      });
      task.reviewProtocol = structuredClone(template.reviewProtocol);
      state.tasks.push(task);
      round.arbitrationTaskId = taskId;
    });
    return this.showTask(taskId);
  }

  private prepareBuildReviewBatch(taskIds: string[]): void {
    const snapshot = this.repo.readState().state;
    const first = getTask(snapshot, taskIds[0] as string);
    const round = getRound(roundsFor(snapshot, "build", first.subjectId), first.round);
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
    this.repo.mutate(`build-review prepared ${first.subjectId}`, (state) => {
      for (const taskId of taskIds) {
        const current = getTask(state, taskId);
        current.verification = structuredClone(verification);
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
      }
    });
  }

  submitTask(taskId: string, raw: unknown): TaskEnvelope {
    const before = getTask(this.repo.readState().state, taskId);
    assertDomain(
      before.status === "open",
      ERROR_CODES.TASK_NOT_OPEN,
      `${taskId} is not open`,
    );
    if (isArbitrationTask(before)) return this.submitArbitration(taskId, raw);
    const parsed = parseResult(before.operation, raw);
    try {
      const mutation = this.repo.mutate(
        `${before.operation} submit ${before.subjectId}`,
        (state) => {
          const refsToDelete: Array<{ ref: string; commit: string }> = [];
          let submittedCandidate: Proposal["candidate"] = null;
          const releasedBuildWorkspaces: string[] = [];
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
              let artifactDigest: string | undefined;
              if (task.operation === "spec") {
                const spec = resultAs(parsed, specDocumentSchema);
                validateSpec(spec);
                document = spec;
                artifactDigest = producerArtifactDigest("spec", spec);
              } else if (task.operation === "plan") {
                const plan = resultAs(parsed, planDocumentSchema);
                validatePlan(state, getWave(state, task.subjectId), plan);
                document = plan;
                artifactDigest = producerArtifactDigest("plan", plan);
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
                  this.config.verification.sharedPaths ?? [],
                );
                submittedCandidate = candidate;
                summary = build.summary;
                artifactDigest = producerArtifactDigest("build", build);
              }
              const fingerprint = computeFingerprint(task, {
                artifactDigest,
                ...(candidate
                  ? { candidate: { commit: candidate.commit, tree: candidate.tree } }
                  : {}),
              });
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
                contextProfile: task.contextSnapshot?.profile ?? null,
                ...(task.execution === undefined ? {} : { execution: task.execution }),
                ...(fingerprint === undefined ? {} : { fingerprint }),
                createdAt: this.ctx.now().toISOString(),
              };
              state.proposals.push(proposal);
              round.proposalIds.push(proposalId);
              task.proposalId = proposalId;
              if (fingerprint !== undefined) task.fingerprint = fingerprint;
            } else {
              const review =
                task.operation === "build-review"
                  ? resultAs(parsed, buildReviewSchema)
                  : resultAs(parsed, documentReviewSchema);
              canonicalizeReview(review);
              try {
                if (task.reviewProtocol) {
                  validateReviewScorecards(task, review);
                  const outcome = computeReviewOutcome(
                    state,
                    task,
                    task.reviewProtocol,
                    review.candidates.map((entry) => ({
                      proposalId: entry.proposalId,
                      status: entry.status,
                      scorecard: entry.scorecard as CandidateScorecard,
                    })),
                  );
                  task.reviewOutcome = outcome;
                }
              } catch (error) {
                if (isReviewAttempt(task) && error instanceof CodePatrolError) {
                  task.status = "failed";
                  task.failure = { code: error.code, message: error.message };
                  task.result = parsed as unknown as Record<string, unknown>;
                  task.finishedAt = this.ctx.now().toISOString();
                  recordReviewerOutcome(state, task, "invalid", {});
                  this.resolveReviewBatch(
                    state,
                    task,
                    refsToDelete,
                    releasedBuildWorkspaces,
                  );
                  return { refsToDelete, releasedBuildWorkspaces, submittedCandidate };
                }
                throw error;
              }
              if (isReviewAttempt(task)) {
                const gates = evaluateAttempt(state, task, review);
                task.result = parsed as unknown as Record<string, unknown>;
                task.status = "submitted";
                task.finishedAt = this.ctx.now().toISOString();
                if (!gates.valid) {
                  recordReviewerOutcome(state, task, gates.reason ?? "invalid", {});
                } else {
                  recordReviewerOutcome(state, task, "submitted", {
                    hostEffectivePass: task.reviewOutcome?.hardGateStatus === "passed",
                    hostReviewScore: task.reviewOutcome?.candidates.find(
                      (c) => c.rank === 1,
                    )?.total,
                    hostVerified: task.verification.every(
                      (entry) => entry.status === "passed",
                    ),
                  });
                }
                this.resolveReviewBatch(
                  state,
                  task,
                  refsToDelete,
                  releasedBuildWorkspaces,
                );
                return { refsToDelete, releasedBuildWorkspaces, submittedCandidate };
              }
              refsToDelete.push(
                ...applyReview(state, task, review, this.config.maxReviewReturns),
              );
              if (task.operation === "build-review") {
                for (const producer of state.tasks) {
                  if (
                    producer.operation === "build" &&
                    producer.subjectId === task.subjectId &&
                    producer.round === task.round &&
                    producer.workspace
                  )
                    releasedBuildWorkspaces.push(producer.id);
                }
              }
            }
            task.status = "submitted";
            task.result = parsed;
            task.finishedAt = this.ctx.now().toISOString();
            return { refsToDelete, releasedBuildWorkspaces, submittedCandidate };
          } catch (error) {
            if (submittedCandidate)
              throw new CandidateMutationError(submittedCandidate, error);
            throw error;
          }
        },
      );
      for (const taskId of mutation.releasedBuildWorkspaces)
        this.repo.removeWorkspace(taskId);
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

  private submitArbitration(taskId: string, raw: unknown): TaskEnvelope {
    const parsed = arbitrationResultSchema.safeParse(raw);
    if (!parsed.success) {
      throw new CodePatrolError(
        ERROR_CODES.INVALID_RESULT,
        "arbiter must select exactly one valid review-attempt id",
        2,
      );
    }
    const mutation = this.repo.mutate(
      `${getTask(this.repo.readState().state, taskId).operation} submit ${getTask(this.repo.readState().state, taskId).subjectId}`,
      (state) => {
        const task = getTask(state, taskId);
        assertDomain(
          task.status === "open",
          ERROR_CODES.TASK_NOT_OPEN,
          `${taskId} is not open`,
        );
        const attempt = validateArbitrationSelection(state, task, parsed.data);
        const refsToDelete = applySelectedAttempt(
          state,
          attempt,
          this.config.maxReviewReturns,
        );
        const releasedBuildWorkspaces: string[] = [];
        if (attempt.operation === "build-review") {
          for (const producer of state.tasks) {
            if (
              producer.operation === "build" &&
              producer.subjectId === attempt.subjectId &&
              producer.round === attempt.round &&
              producer.workspace
            )
              releasedBuildWorkspaces.push(producer.id);
          }
        }
        task.status = "submitted";
        task.result = parsed.data as unknown as Record<string, unknown>;
        task.finishedAt = this.ctx.now().toISOString();
        const batch = attemptTasks(state, task.reviewBatchId);
        for (const entry of batch) {
          recordReviewerOutcome(
            state,
            entry,
            entry.id === attempt.id ? "selected" : "rejected",
            {
              hostSelected: entry.id === attempt.id,
              hostReviewScore: entry.reviewOutcome?.candidates.find((c) => c.rank === 1)
                ?.total,
            },
          );
        }
        recordReviewerOutcome(state, task, "arbitration", { hostSelected: true });
        return { refsToDelete, releasedBuildWorkspaces };
      },
    );
    for (const producerId of mutation.releasedBuildWorkspaces)
      this.repo.removeWorkspace(producerId);
    for (const candidate of mutation.refsToDelete) {
      try {
        this.repo.deleteRef(candidate.ref, candidate.commit);
      } catch {}
    }
    return this.showTask(taskId);
  }

  private resolveReviewBatch(
    state: State,
    task: Task,
    refsToDelete: Array<{ ref: string; commit: string }>,
    releasedBuildWorkspaces: string[],
  ): void {
    const attempts = attemptTasks(state, task.reviewBatchId);
    if (attempts.length === 0 || !attempts.every(attemptIsTerminal)) return;
    const valid = attempts.filter((entry) => isValidStoredAttempt(state, entry));
    const minValid = this.config.orchestrator?.minValidAttempts ?? 1;
    if (valid.length < minValid) return;
    if (attemptsAgree(valid)) {
      const winner = pickConsensusAttempt(valid);
      refsToDelete.push(
        ...applySelectedAttempt(state, winner, this.config.maxReviewReturns),
      );
      for (const entry of attempts) {
        recordReviewerOutcome(
          state,
          entry,
          entry.id === winner.id ? "selected" : "agreement",
          {
            hostSelected: entry.id === winner.id,
            hostReviewScore: entry.reviewOutcome?.candidates.find((c) => c.rank === 1)
              ?.total,
          },
        );
      }
      if (winner.operation === "build-review") {
        for (const producer of state.tasks) {
          if (
            producer.operation === "build" &&
            producer.subjectId === winner.subjectId &&
            producer.round === winner.round &&
            producer.workspace
          )
            releasedBuildWorkspaces.push(producer.id);
        }
      }
      return;
    }
    const round = reviewRoundFor(state, task);
    if (round.arbitrationTaskId) return;
    const template = attempts[0] as Task;
    const arbId = id("TASK");
    const arbitration = createTask(this.ctx, {
      id: arbId,
      operation: task.operation,
      subjectId: task.subjectId,
      round: task.round,
      status: "open",
      source: template.source,
      agentInstructions: template.agentInstructions,
      workspace: null,
      baseCommit: null,
      reviewRole: "arbitration",
      reviewBatchId: template.reviewBatchId,
      routingDecisionId: template.routingDecisionId,
    });
    arbitration.reviewProtocol = structuredClone(template.reviewProtocol);
    state.tasks.push(arbitration);
    round.arbitrationTaskId = arbId;
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
        if (!isProducer(task.operation) && isAuthoritativeReview(task)) {
          const round = getRound(
            roundsFor(state, producerFor(task.operation), task.subjectId),
            task.round,
          );
          round.status = "open";
          round.reviewTaskId = null;
        }
        if (isArbitrationTask(task)) {
          const round = reviewRoundFor(state, task);
          round.arbitrationTaskId = null;
        }
        task.status = status;
        task.failure =
          status === "failed"
            ? { code: "EXECUTOR_FAILED", message: message as string }
            : null;
        task.finishedAt = this.ctx.now().toISOString();
        if (isReviewAttempt(task)) {
          recordReviewerOutcome(state, task, status);
          this.resolveReviewBatch(state, task, [], []);
        }
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
    const review = state.tasks.find(
      (task) =>
        task.operation === "build-review" &&
        task.subjectId === waveId &&
        task.status === "submitted" &&
        task.reviewOutcome &&
        isAuthoritativeReview(task),
    );
    return {
      waveId,
      proposal,
      currentBase: this.repo.currentCommit(this.config.baseBranch),
      ...(review?.reviewOutcome ? { reviewOutcome: review.reviewOutcome } : {}),
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
      recordShipOutcome(next, waveId, decision);
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
          .filter((task) => preserveWorkspace(state, task))
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
        if (
          status.status !== "succeeded" ||
          filterSharedPathEntries(
            status.stdout,
            this.config.verification.sharedPaths ?? [],
          ).trim()
        ) {
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
    contextSnapshots?: ContextSnapshot[];
    contextProfileArtifacts?: ContextProfileArtifact[];
    execution?: ExecutionRecord;
    workspace: string | null;
    baseCommit: string | null;
    reviewRole?: Task["reviewRole"];
    reviewBatchId?: string;
    routingDecisionId?: string;
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
    ...(seed.contextSnapshots === undefined
      ? {}
      : {
          contextSnapshots: [...seed.contextSnapshots].sort((left, right) =>
            compareLexical(left.profile, right.profile),
          ),
        }),
    ...(seed.contextProfileArtifacts === undefined
      ? {}
      : {
          contextProfileArtifacts: [...seed.contextProfileArtifacts].sort(
            (left, right) => compareLexical(left.profile, right.profile),
          ),
        }),
    ...(seed.execution === undefined ? {} : { execution: seed.execution }),
    proposalId: null,
    result: null,
    verification: [],
    failure: null,
    createdAt: ctx.now().toISOString(),
    finishedAt: null,
    ...(seed.routingDecisionId ? { routingDecisionId: seed.routingDecisionId } : {}),
    ...(seed.reviewRole ? { reviewRole: seed.reviewRole } : {}),
    ...(seed.reviewBatchId ? { reviewBatchId: seed.reviewBatchId } : {}),
  };
}

function isProducer(operation: Operation): operation is ProducerOperation {
  return ["spec", "plan", "build"].includes(operation);
}

function compareLexical(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalizeReview(review: DocumentReview | BuildReview): void {
  review.candidates.sort((left, right) =>
    compareLexical(left.proposalId, right.proposalId),
  );
  review.contextComparison?.verdicts.sort((left, right) =>
    compareLexical(left.profile, right.profile),
  );
  if ("acceptance" in review)
    review.acceptance.sort((left, right) => compareLexical(left.id, right.id));
}

function validateReviewScorecards(
  task: Task,
  review: DocumentReview | BuildReview,
): void {
  const protocol = task.reviewProtocol;
  if (!protocol) return;
  const scorecards: CandidateScorecard[] = [];
  for (const verdict of review.candidates) {
    if (!verdict.scorecard) {
      throw new CodePatrolError(
        ERROR_CODES.INVALID_RESULT,
        `candidate ${verdict.proposalId} requires a scorecard`,
      );
    }
    scorecards.push(verdict.scorecard);
  }
  validateScorecards(protocol, scorecards);
}

function preserveWorkspace(state: State, task: Task): boolean {
  if (!task.workspace) return false;
  if (["preparing", "open", "blocked"].includes(task.status)) return true;
  if (task.operation !== "build" || task.status !== "submitted") return false;
  return !state.tasks.some(
    (review) =>
      review.operation === "build-review" &&
      review.subjectId === task.subjectId &&
      review.round === task.round &&
      review.status === "submitted" &&
      isAuthoritativeReview(review),
  );
}

function updateInitTerminal(state: State, initId: string): void {
  const init = getInit(state, initId);
  const waves = init.waveIds.map((waveId) => getWave(state, waveId));
  if (waves.every((wave) => wave.status === "accepted")) init.status = "accepted";
  else if (waves.every((wave) => ["accepted", "rolled-back"].includes(wave.status))) {
    init.status = "rolled-back";
  }
}
