import { z } from "zod";
import { AGENT_REFERENCE, EXACT_AGENT_VERSION } from "./agent-protocol.js";
import { contextProfileUnavailableReasons } from "./context-provider.js";
import { executionRecordSchema, fingerprintSchema } from "./execution.js";
import { digest, sha256Schema, stableJson } from "./shared.js";

export const producerOperations = ["spec", "plan", "build"] as const;
export const reviewOperations = ["spec-review", "plan-review", "build-review"] as const;
export const operations = [...producerOperations, ...reviewOperations] as const;

export type ProducerOperation = (typeof producerOperations)[number];
export type ReviewOperation = (typeof reviewOperations)[number];
export type Operation = (typeof operations)[number];

const contextSnapshotSchema = z
  .object({
    profile: z.string().min(1),
    reportDigest: sha256Schema,
    requestDigest: sha256Schema,
    report: z.record(z.unknown()),
  })
  .strict();

const contextProfileArtifactSchema = z
  .object({
    schemaVersion: z.literal(1),
    profile: z.string().min(1),
    requestDigest: sha256Schema.nullable(),
    reportDigest: sha256Schema.nullable(),
    coverage: z
      .object({
        limited: z.boolean(),
        outputBytes: z.number().int().nonnegative(),
        omittedFiles: z.number().int().nonnegative(),
        omittedRelations: z.number().int().nonnegative(),
        omittedSnippets: z.number().int().nonnegative(),
        omittedSymbols: z.number().int().nonnegative(),
      })
      .strict(),
    evidenceRefs: z.array(z.string()).superRefine((refs, context) => {
      if (
        refs.some(
          (ref, index) => index > 0 && (refs[index - 1] ?? "").localeCompare(ref) >= 0,
        )
      )
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "evidence refs must be sorted and unique",
        });
    }),
    availability: z.discriminatedUnion("status", [
      z.object({ status: z.literal("available") }).strict(),
      z
        .object({
          status: z.literal("unavailable"),
          reason: z.enum(contextProfileUnavailableReasons),
        })
        .strict(),
    ]),
    proposalId: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((artifact, context) => {
    const hasDigests =
      artifact.requestDigest !== null && artifact.reportDigest !== null;
    if ((artifact.availability.status === "available") !== hasDigests) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "artifact availability must match digest availability",
      });
    }
  });

const sourceSchema = z
  .object({
    harness: z.string().min(1),
    model: z.string().min(1).nullable().default(null),
    agent: z.string().regex(AGENT_REFERENCE).nullable().default(null),
    agentVersion: z.string().regex(EXACT_AGENT_VERSION).optional(),
    agentDigest: sha256Schema.optional(),
    agentInstructionsDigest: sha256Schema.optional(),
  })
  .strict()
  .superRefine((source, context) => {
    const resolved = [
      source.agentVersion,
      source.agentDigest,
      source.agentInstructionsDigest,
    ];
    if (resolved.some((value) => value !== undefined)) {
      if (!source.agent || !resolved.every((value) => value !== undefined)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "resolved agent provenance must be complete",
        });
      }
    }
  });

export type Source = z.infer<typeof sourceSchema>;

export const specDocumentSchema = z
  .object({
    title: z.string().min(1),
    intent: z.string().min(1),
    waves: z
      .array(
        z
          .object({
            key: z.string().min(1),
            title: z.string().min(1),
            works: z
              .array(
                z
                  .object({
                    key: z.string().min(1),
                    title: z.string().min(1),
                    description: z.string(),
                    acceptance: z.array(z.string().min(1)).min(1),
                    blockedBy: z.array(z.string().min(1)).default([]),
                  })
                  .strict(),
              )
              .min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export const planDocumentSchema = z
  .object({
    works: z.array(
      z
        .object({
          workId: z.string().min(1),
          summary: z.string().min(1),
          steps: z
            .array(
              z
                .object({
                  summary: z.string().min(1),
                  acceptanceIds: z.array(z.string().min(1)).min(1),
                })
                .strict(),
            )
            .min(1),
        })
        .strict(),
    ),
    verification: z.string().min(1),
    openQuestions: z.array(z.string().min(1)).default([]),
  })
  .strict();

export const buildResultSchema = z
  .object({
    summary: z.string().min(1),
    works: z.array(
      z
        .object({
          workId: z.string().min(1),
          summary: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict();

const scorecardAssessmentSchema = z
  .object({
    category: z.string().min(1),
    level: z.number().int().min(0).max(100),
    rationale: z.string().min(1),
    evidenceRefs: z.array(z.string().min(1)),
  })
  .strict();

const legacyCandidateScorecardSchema = z
  .object({
    rubricVersion: z.string().min(1),
    assessments: z.array(scorecardAssessmentSchema),
  })
  .strict();

const stageScorecardAssessmentSchema = z
  .object({
    dimension: z.string().min(1),
    level: z.number().int().min(0).max(100),
    rationale: z.string().min(1),
    evidenceRefs: z.array(z.string().min(1)),
  })
  .strict();

const stageCandidateScorecardSchema = z
  .object({
    operation: z.enum(reviewOperations),
    dimensions: z.array(stageScorecardAssessmentSchema),
    rubricVersion: z.string().min(1).optional(),
  })
  .strict();

const candidateScorecardSchema = z.union([
  legacyCandidateScorecardSchema,
  stageCandidateScorecardSchema,
]);

const candidateVerdictSchema = z
  .object({
    proposalId: z.string().min(1),
    status: z.enum(["passed", "failed"]),
    summary: z.string().min(1),
    score: z.number().int().min(0).max(100).optional(),
    scorecard: candidateScorecardSchema.optional(),
  })
  .strict();

const contextVerdictSchema = z.discriminatedUnion("status", [
  z
    .object({
      profile: z.string().min(1),
      status: z.enum(["passed", "failed"]),
      score: z.number().int().min(0).max(100),
      summary: z.string().min(1),
    })
    .strict(),
  z
    .object({
      profile: z.string().min(1),
      status: z.literal("unavailable"),
      summary: z.string().min(1),
    })
    .strict(),
]);

const contextComparisonSchema = z
  .object({
    verdicts: z.array(contextVerdictSchema).min(1),
    selectedContextProfile: z.string().min(1).optional(),
  })
  .strict();

export const documentReviewSchema = z
  .object({
    decision: z.enum(["approve", "return"]),
    selectedProposalId: z.string().min(1).optional(),
    summary: z.string().min(1),
    candidates: z.array(candidateVerdictSchema).min(1),
    contextComparison: contextComparisonSchema.optional(),
  })
  .strict();

export const buildReviewSchema = documentReviewSchema.extend({
  acceptance: z.array(
    z
      .object({
        id: z.string().min(1),
        status: z.enum(["passed", "failed"]),
        summary: z.string().min(1),
      })
      .strict(),
  ),
});

export const arbitrationResultSchema = z
  .object({
    selectedAttemptId: z.string().min(1),
    rationale: z.string().min(1),
  })
  .strict();

const rubricCategorySchema = z
  .object({ category: z.string().min(1), weight: z.number().int().positive() })
  .strict();

const rubricSchema = z
  .object({
    version: z.string().min(1),
    categories: z.array(rubricCategorySchema),
  })
  .strict();

export const reviewProtocolSchema = z
  .object({
    rubricVersion: z.string().min(1),
    rubric: rubricSchema,
    operation: z.enum(reviewOperations).optional(),
    dimensions: z
      .array(
        z
          .object({
            dimension: z.string().min(1),
            weight: z.number().int().positive(),
          })
          .strict(),
      )
      .optional(),
    anchors: z.array(z.number().int().min(0).max(100)),
    labels: z.record(z.string(), z.string().min(1)),
    auditProvenance: z.record(z.string(), z.string().min(1)),
    evidenceCatalog: z.array(z.string().min(1)),
  })
  .strict();

const rankedCandidateSchema = z
  .object({
    label: z.string().min(1),
    proposalId: z.string().min(1),
    profile: z.string().min(1).nullable().optional(),
    total: z.number().int().min(0).max(100),
    levels: z.array(z.number().int().min(0).max(100)),
    rank: z.number().int().positive(),
    effectivePassed: z.boolean(),
    decidingComparator: z.string().nullable(),
  })
  .strict();

export const reviewOutcomeSchema = z
  .object({
    rubricVersion: z.string().min(1),
    operation: z.enum(reviewOperations).optional(),
    hardGateStatus: z.enum(["passed", "failed", "blocked"]),
    candidates: z.array(rankedCandidateSchema),
    winner: z.string().nullable(),
    decidingComparator: z.string().nullable(),
    execution: z.object({ descriptors: z.array(z.string().min(1)) }).strict(),
    digestClasses: z.record(z.string(), z.string()),
  })
  .strict();

const acceptanceSchema = z.object({ id: z.string(), text: z.string().min(1) }).strict();
const workSchema = z
  .object({
    id: z.string(),
    waveId: z.string(),
    key: z.string(),
    title: z.string(),
    description: z.string(),
    acceptance: z.array(acceptanceSchema),
    blockedBy: z.array(z.string()),
    status: z.enum(["pending", "accepted", "rolled-back"]),
  })
  .strict();

const verificationSchema = z
  .object({
    proposalId: z.string(),
    status: z.enum(["passed", "failed", "infrastructure-failed"]),
    argv: z.array(z.string()),
    exitCode: z.number().int().nullable(),
    durationMs: z.number().int().nonnegative(),
    output: z.string(),
    outputDigest: z.string(),
    truncated: z.boolean(),
  })
  .strict();

const taskSchema = z
  .object({
    id: z.string(),
    operation: z.enum(operations),
    subjectId: z.string(),
    round: z.number().int().positive(),
    status: z.enum([
      "preparing",
      "open",
      "submitted",
      "cancelled",
      "failed",
      "blocked",
    ]),
    source: sourceSchema,
    agentInstructions: z
      .string()
      .min(1)
      .max(256 * 1024)
      .refine((value) => Buffer.byteLength(value, "utf8") <= 256 * 1024, {
        message: "agent instructions must not exceed 262144 UTF-8 bytes",
      })
      .optional(),
    contextSnapshot: contextSnapshotSchema.optional(),
    contextSnapshots: z.array(contextSnapshotSchema).optional(),
    contextProfileArtifacts: z.array(contextProfileArtifactSchema).optional(),
    execution: executionRecordSchema.optional(),
    fingerprint: fingerprintSchema.optional(),
    reviewProtocol: reviewProtocolSchema.optional(),
    reviewOutcome: reviewOutcomeSchema.optional(),
    workspace: z.string().nullable(),
    baseCommit: z.string().nullable(),
    proposalId: z.string().nullable(),
    result: z.record(z.unknown()).nullable(),
    verification: z.array(verificationSchema),
    failure: z.object({ code: z.string(), message: z.string() }).strict().nullable(),
    createdAt: z.string(),
    finishedAt: z.string().nullable(),
    routingDecisionId: z.string().optional(),
    reviewRole: z.enum(["authoritative", "attempt", "arbitration"]).optional(),
    reviewBatchId: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((task, context) => {
    const resolved = task.source.agentInstructionsDigest !== undefined;
    if (resolved !== (task.agentInstructions !== undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "resolved task provenance and agent instructions must be stored together",
      });
    } else if (
      task.agentInstructions !== undefined &&
      `sha256:${digest(task.agentInstructions)}` !== task.source.agentInstructionsDigest
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "agent instructions digest does not match the snapshot",
      });
    }
    if (task.contextSnapshot) {
      const report = { ...task.contextSnapshot.report };
      delete report.reportDigest;
      const reportDigest = `sha256:${digest(stableJson(report))}`;
      if (reportDigest !== task.contextSnapshot.reportDigest) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "context report digest does not match the snapshot",
        });
      }
    }
    for (const snapshot of task.contextSnapshots ?? []) {
      const report = { ...snapshot.report };
      delete report.reportDigest;
      const reportDigest = `sha256:${digest(stableJson(report))}`;
      if (reportDigest !== snapshot.reportDigest) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "context report digest does not match the snapshot",
        });
      }
    }
  });

const proposalSchema = z
  .object({
    id: z.string(),
    taskId: z.string(),
    operation: z.enum(producerOperations),
    subjectId: z.string(),
    round: z.number().int().positive(),
    source: sourceSchema,
    document: z.record(z.unknown()).nullable(),
    candidate: z
      .object({
        ref: z.string(),
        baseCommit: z.string(),
        commit: z.string(),
        tree: z.string(),
        changedPaths: z.array(z.string()),
      })
      .strict()
      .nullable(),
    summary: z.string().nullable(),
    contextProfile: z.string().min(1).nullable().optional(),
    execution: executionRecordSchema.optional(),
    fingerprint: fingerprintSchema.optional(),
    createdAt: z.string(),
  })
  .strict();

const roundSchema = z
  .object({
    number: z.number().int().positive(),
    operation: z.enum(producerOperations),
    status: z.enum(["open", "reviewing", "approved", "returned"]),
    proposalIds: z.array(z.string()),
    reviewTaskId: z.string().nullable(),
    selectedProposalId: z.string().nullable(),
    reviewAttemptIds: z.array(z.string()).optional().default([]),
    arbitrationTaskId: z.string().nullable().optional().default(null),
    reviewBatchId: z.string().nullable().optional().default(null),
  })
  .strict();

const waveSchema = z
  .object({
    id: z.string(),
    initId: z.string(),
    title: z.string(),
    status: z.enum([
      "planning",
      "building",
      "ready-to-ship",
      "accepted",
      "rolled-back",
    ]),
    workIds: z.array(z.string()),
    planRounds: z.array(roundSchema),
    buildRounds: z.array(roundSchema),
    selectedPlanId: z.string().nullable(),
    selectedBuildId: z.string().nullable(),
    reviewReturns: z
      .object({
        plan: z.number().int().nonnegative(),
        build: z.number().int().nonnegative(),
      })
      .strict(),
    ship: z
      .object({
        decision: z.enum(["accept", "rollback"]),
        candidateCommit: z.string(),
        at: z.string(),
      })
      .strict()
      .nullable(),
  })
  .strict();

const initSchema = z
  .object({
    id: z.string(),
    title: z.string().min(1),
    brief: z.string(),
    status: z.enum(["specifying", "active", "accepted", "rolled-back"]),
    specRounds: z.array(roundSchema),
    selectedSpecId: z.string().nullable(),
    waveIds: z.array(z.string()),
    reviewReturns: z.number().int().nonnegative(),
    createdAt: z.string(),
  })
  .strict();

const routeKeySchema = z.string().min(1).max(200);

const scoreComponentSchema = z
  .object({ name: z.string().min(1), value: z.number().int() })
  .strict();

const routingDecisionSchema = z
  .object({
    decisionId: z.string(),
    operation: z.enum(operations),
    policyVersion: z.string(),
    policyDigest: sha256Schema,
    taskFeatureDigest: sha256Schema,
    taskClass: z.string().min(1),
    memoryDigest: sha256Schema,
    eligibleRoutes: z.array(routeKeySchema),
    scoreComponents: z.array(scoreComponentSchema),
    selectedRoutes: z.array(routeKeySchema),
    uncertainty: z.number().int(),
    fanoutReason: z.enum(["confident", "uncertain", "exploration", "explicit"]),
    overrideMode: z.enum(["none", "agents", "profiles", "both", "executions"]),
    createdAt: z.string(),
  })
  .strict();

const routingObservationSchema = z
  .object({
    observationKey: z.string(),
    decisionId: z.string(),
    routeKey: routeKeySchema,
    taskId: z.string(),
    proposalId: z.string().nullable(),
    outcome: z.string(),
    hostEffectivePass: z.boolean().optional(),
    hostRank: z.number().int().optional(),
    hostSelected: z.boolean().optional(),
    hostVerified: z.boolean().optional(),
    hostReviewScore: z.number().int().optional(),
    hostReturnCount: z.number().int().optional(),
    durationMs: z.number().int().optional(),
    createdAt: z.string(),
  })
  .strict();

const routingAggregateSchema = z
  .object({
    routeKey: routeKeySchema,
    operation: z.enum(operations),
    taskClass: z.string(),
    observationCount: z.number().int().nonnegative(),
    effectivePassCount: z.number().int().nonnegative(),
    selectedCount: z.number().int().nonnegative(),
    verifiedCount: z.number().int().nonnegative(),
    reviewScoreTotal: z.number().int().nonnegative(),
    returnCount: z.number().int().nonnegative(),
    lastUpdated: z.string(),
  })
  .strict();

export const stateSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectId: z.string(),
    sequence: z.number().int().nonnegative(),
    nextInit: z.number().int().positive(),
    inits: z.array(initSchema),
    waves: z.array(waveSchema),
    works: z.array(workSchema),
    tasks: z.array(taskSchema),
    proposals: z.array(proposalSchema),
    routing: z
      .object({
        schemaVersion: z.literal(1),
        decisions: z.array(routingDecisionSchema).default([]),
        observations: z.array(routingObservationSchema).default([]),
        aggregates: z.array(routingAggregateSchema).default([]),
      })
      .strict()
      .optional()
      .default({ schemaVersion: 1, decisions: [], observations: [], aggregates: [] }),
  })
  .strict();

export type RoutingDecision = z.infer<typeof routingDecisionSchema>;
export type RoutingObservation = z.infer<typeof routingObservationSchema>;
export type RoutingAggregate = z.infer<typeof routingAggregateSchema>;
export type RoutingMemory = z.infer<typeof stateSchema>["routing"];

export type State = z.infer<typeof stateSchema>;
export type Init = State["inits"][number];
export type Wave = State["waves"][number];
export type Work = State["works"][number];
export type Task = State["tasks"][number];
export type Proposal = State["proposals"][number];
export type Round = Init["specRounds"][number];
export type Verification = Task["verification"][number];
export type SpecDocument = z.infer<typeof specDocumentSchema>;
export type PlanDocument = z.infer<typeof planDocumentSchema>;
export type BuildResult = z.infer<typeof buildResultSchema>;
export type DocumentReview = z.infer<typeof documentReviewSchema>;
export type BuildReview = z.infer<typeof buildReviewSchema>;
export type ArbitrationResult = z.infer<typeof arbitrationResultSchema>;
export type ReviewProtocol = z.infer<typeof reviewProtocolSchema>;
export type ReviewOutcome = z.infer<typeof reviewOutcomeSchema>;
export type CandidateScorecard = z.infer<typeof candidateScorecardSchema>;
export type TaskEnvelope = {
  task: Task;
  input: unknown;
  resultContract: string;
  agentInstructions?: string;
  contextSnapshot?: unknown;
  contextSnapshots?: unknown;
  contextProfileArtifacts?: unknown;
  execution?: unknown;
  fingerprint?: unknown;
  reviewProtocol?: ReviewProtocol;
  reviewOutcome?: ReviewOutcome;
};

export { digest, sha256Schema } from "./shared.js";
