import { z } from "zod";
import {
  agentSchema,
  argvSchema,
  contextProfileSchema,
  contextSchema,
  digestSchema,
  executorResultSchema,
  idSchema,
  inputSchema,
  MAX_ROUTE_ALTERNATIVES,
  STAGES,
  stageSchema,
} from "./contracts.js";

export const taskClassSchema = z.enum([
  "security",
  "bugfix",
  "refactor",
  "test",
  "docs",
  "feature",
  "maintenance",
]);
export type TaskClass = z.infer<typeof taskClassSchema>;
export const routeIdentitySchema = z
  .object({
    stage: stageSchema,
    taskClass: taskClassSchema,
    persona: idSchema,
    profiles: z
      .array(idSchema)
      .min(1)
      .max(256)
      .refine((ids) => [...new Set(ids)].sort().join() === ids.join()),
    contextProfile: contextProfileSchema,
    catalogDigest: digestSchema,
  })
  .strict();
export type RouteIdentity = z.infer<typeof routeIdentitySchema>;
export const routeCandidateSchema = routeIdentitySchema.extend({
  baseScore: z.number().finite(),
  adjustment: z.number().min(-0.3).max(0.3),
  score: z.number().finite(),
  samples: z.number().int().nonnegative(),
  reasons: z.array(z.string()),
});
export const routeSchema = routeCandidateSchema.extend({
  alternatives: z.array(routeCandidateSchema).max(MAX_ROUTE_ALTERNATIVES),
});
export type Route = z.infer<typeof routeSchema>;
export const plannedStageSchema = z
  .object({
    stage: stageSchema,
    route: routeSchema,
    agent: agentSchema,
    context: contextSchema,
  })
  .strict();
export type PlannedStage = z.infer<typeof plannedStageSchema>;
export const executionPlanSchema = z
  .object({
    protocolVersion: z.literal("1.0"),
    root: z.string(),
    task: z.string(),
    catalogDigest: digestSchema,
    overview: contextSchema,
    stages: z.array(plannedStageSchema).length(STAGES.length),
  })
  .strict();
export type ExecutionPlan = z.infer<typeof executionPlanSchema>;
export const stageRecordSchema = plannedStageSchema.extend({
  status: z.enum(["passed", "failed"]),
  result: executorResultSchema.optional(),
  durationMs: z.number().nonnegative(),
  error: z.string().optional(),
  verification: z
    .object({
      status: z.enum(["passed", "failed"]),
      argv: argvSchema,
      durationMs: z.number().nonnegative(),
    })
    .strict()
    .optional(),
});
export type StageRecord = z.infer<typeof stageRecordSchema>;
export const runStateSchema = z
  .object({
    protocolVersion: z.literal("1.0"),
    stateVersion: z.literal(1),
    runId: z.string().uuid(),
    root: z.string(),
    workspace: z.string(),
    baseCommit: digestSchema.or(z.string().regex(/^[a-f0-9]{40}$/)),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    input: inputSchema,
    status: z.enum(["running", "blocked", "awaiting-approval", "approved"]),
    activeStage: stageSchema.optional(),
    plan: executionPlanSchema.optional(),
    stages: z.array(stageRecordSchema).max(STAGES.length),
    error: z.string().optional(),
    approval: z
      .object({
        confirmed: z.literal(true),
        operator: z.string().min(1),
        at: z.string().datetime(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type RunState = z.infer<typeof runStateSchema>;
