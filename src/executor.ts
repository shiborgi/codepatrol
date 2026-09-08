import { z } from "zod";
import {
  agentSchema,
  type Config,
  contextSchema,
  executorResultSchema,
  type MemoryCandidate,
  memoryCandidateSchema,
  stageSchema,
  taskSchema,
  trackingSchema,
} from "./contracts.js";
import { stageRecordSchema } from "./domain.js";
import { memoryRecallSchema } from "./memorypatrol.js";
import { modelpatrolEnvironment } from "./modelpatrol.js";
import { rpc, runProcess } from "./rpc.js";

export const executorRequestSchema = z
  .object({
    protocolVersion: z.literal("1.0"),
    runId: z.string().uuid(),
    stage: stageSchema,
    task: taskSchema,
    workspace: z.string().min(1),
    agent: agentSchema,
    context: contextSchema,
    memory: memoryRecallSchema.optional(),
    previous: z.array(stageRecordSchema),
    tracking: trackingSchema.optional(),
  })
  .strict();
export type ExecutorRequest = z.infer<typeof executorRequestSchema>;
const executorResponseSchema = executorResultSchema
  .extend({
    memories: z.array(memoryCandidateSchema).max(10).optional(),
  })
  .strict();
export type StageExecution = {
  result: z.infer<typeof executorResultSchema>;
  memories?: MemoryCandidate[];
};
export async function executeStage(config: Config, request: ExecutorRequest) {
  if (!config.executor)
    throw new Error("run requires an explicit trusted executor command");
  executorRequestSchema.parse(request);
  const response = await rpc(config.executor, request, executorResponseSchema, {
    cwd: request.workspace,
    limits: config.limits,
    env: modelpatrolEnvironment(config, request),
  });
  const { memories, ...result } = response;
  if (request.stage.endsWith("-review") && result.approved === undefined)
    throw new Error("Review response requires approved boolean");
  const criteria = request.tracking?.work.acceptance;
  if (!criteria && result.acceptance !== undefined)
    throw new Error("Acceptance results require tracked task input");
  if (request.stage === "build-review" && criteria) {
    const expected = criteria.map((item) => item.key).sort();
    const actual = result.acceptance?.map((item) => item.key).sort();
    if (!actual || actual.join("\0") !== expected.join("\0"))
      throw new Error(
        "Build review acceptance results must exactly match tracked criteria",
      );
    if (
      result.approved !== true ||
      result.acceptance?.some((item) => item.status !== "passed")
    )
      throw new Error(
        "Build review must approve and pass every tracked acceptance criterion",
      );
  } else if (result.acceptance !== undefined) {
    throw new Error("Acceptance results are only valid for tracked build-review");
  }
  return { result, memories } satisfies StageExecution;
}
export async function verifyBuild(config: Config, workspace: string) {
  if (!config.verification)
    throw new Error("run requires an explicit verification command");
  await runProcess(config.verification, { cwd: workspace, limits: config.limits });
}
