import { z } from "zod";
import {
  boundedJson,
  type Config,
  digestSchema,
  idSchema,
  type MemoryCandidate,
  validateDigest,
} from "./contracts.js";
import { rpc } from "./rpc.js";

const insightSchema = z
  .object({
    id: z.string().uuid(),
    content: z.string().min(1).max(8000),
    category: z.enum([
      "preference",
      "decision",
      "fact",
      "insight",
      "context",
      "general",
      "gotcha",
      "procedure",
    ]),
    importance: z.number().int().min(1).max(5),
    tags: z.array(z.string().min(1).max(128)).max(20),
    entities: z.array(z.string().min(1).max(128)).max(50),
    source: z.enum(["user", "agent", "external"]),
    score: z.number().finite(),
    intent: z.enum(["why", "when", "entity", "general"]),
    matchedVia: z.string().min(1).max(256),
    confidence: z.enum(["high", "medium", "low"]),
    signals: z
      .object({
        keyword: z.number().finite(),
        entity: z.number().finite(),
        graph: z.number().finite(),
      })
      .strict(),
  })
  .strict();
export const memoryRecallSchema = z
  .object({
    protocolVersion: z.literal("1.0"),
    store: idSchema,
    intent: z.enum(["why", "when", "entity", "general"]),
    insights: z.array(insightSchema).max(100),
    diagnostics: z.array(z.string().max(4096)).max(100),
    stats: z
      .object({
        activeInsights: z.number().int().nonnegative(),
        selectedInsights: z.number().int().nonnegative(),
        truncated: z.boolean(),
      })
      .strict(),
    digest: digestSchema,
  })
  .strict();
export type MemoryRecall = z.infer<typeof memoryRecallSchema>;

const memoryRememberSchema = z
  .object({
    protocolVersion: z.literal("1.0"),
    store: idSchema,
    id: z.string().uuid(),
    action: z.enum(["added", "replaced", "skipped"]),
    replacedId: z.string().uuid().optional(),
    edgesCreated: z
      .object({
        temporal: z.number().int().nonnegative(),
        entity: z.number().int().nonnegative(),
        causal: z.number().int().nonnegative(),
        semantic: z.number().int().nonnegative(),
      })
      .strict(),
    candidates: z.array(z.unknown()).max(10),
    autoPrunedIds: z.array(z.string().uuid()).max(10),
    effectiveImportance: z.number().finite(),
    digest: digestSchema,
  })
  .strict();

function integration(config: Config) {
  const memory = config.memorypatrol;
  if (!memory) throw new Error("MemoryPatrol is not configured");
  return memory;
}

/** Recall is stage-scoped and never enters durable CodePatrol state. */
export async function recallMemory(
  config: Config,
  root: string,
  task: string,
): Promise<MemoryRecall | undefined> {
  if (!config.memorypatrol) return undefined;
  const memory = integration(config);
  const request = {
    protocolVersion: "1.0" as const,
    root,
    task,
    store: memory.store,
    budget: memory.budget,
  };
  boundedJson(request, config.limits.maxOutputBytes, "MemoryPatrol recall request");
  return validateDigest(
    await rpc(memory.recall, request, memoryRecallSchema, {
      cwd: root,
      limits: config.limits,
    }),
  );
}

/** Store only executor-selected insights after the complete stage has passed. */
export async function rememberMemory(
  config: Config,
  root: string,
  candidates: MemoryCandidate[] | undefined,
): Promise<void> {
  if (!candidates?.length || !config.memorypatrol) return;
  const memory = integration(config);
  for (const candidate of candidates) {
    const request = {
      protocolVersion: "1.0" as const,
      root,
      store: memory.store,
      content: candidate.content,
      category: candidate.category ?? "insight",
      importance: candidate.importance ?? 3,
      source: "agent" as const,
      tags: [...new Set(candidate.tags ?? [])].sort(),
      entities: [...new Set(candidate.entities ?? [])].sort(),
    };
    boundedJson(request, config.limits.maxOutputBytes, "MemoryPatrol remember request");
    validateDigest(
      await rpc(memory.remember, request, memoryRememberSchema, {
        cwd: root,
        limits: config.limits,
      }),
    );
  }
}

export const memoryHandoffSchema = z
  .object({
    protocolVersion: z.literal("1.0"),
    store: idSchema,
    id: z.string().uuid(),
    stage: z.string().min(1).max(64),
    path: z.string().min(1).max(1024),
    digest: digestSchema,
  })
  .strict();
export type MemoryHandoff = z.infer<typeof memoryHandoffSchema>;

/** Record a structured stage handoff into MemoryPatrol wiki outside durable run state. */
export async function recordHandoffMemory(
  config: Config,
  root: string,
  record: {
    stage: string;
    previousStage?: string | undefined;
    runId?: string | undefined;
    summary: string;
    decisionsMade?: string[] | undefined;
    gotchasEncountered?: string[] | undefined;
    pendingQuestions?: string[] | undefined;
    artifacts?: string[] | undefined;
    nextActor?: string | undefined;
  },
): Promise<MemoryHandoff | undefined> {
  if (!config.memorypatrol) return undefined;
  const memory = integration(config);
  const request = {
    protocolVersion: "1.0" as const,
    root,
    store: memory.store,
    stage: record.stage,
    ...(record.previousStage ? { previousStage: record.previousStage } : {}),
    ...(record.runId ? { runId: record.runId } : {}),
    summary: record.summary,
    decisionsMade: [...new Set(record.decisionsMade ?? [])].sort(),
    gotchasEncountered: [...new Set(record.gotchasEncountered ?? [])].sort(),
    pendingQuestions: [...new Set(record.pendingQuestions ?? [])].sort(),
    artifacts: [...new Set(record.artifacts ?? [])].sort(),
    ...(record.nextActor ? { nextActor: record.nextActor } : {}),
  };
  boundedJson(request, config.limits.maxOutputBytes, "MemoryPatrol handoff request");
  return validateDigest(
    await rpc(memory.handoff, request, memoryHandoffSchema, {
      cwd: root,
      limits: config.limits,
    }),
  );
}
