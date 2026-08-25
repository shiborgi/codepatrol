import type { z } from "zod";
import { CodePatrolError, type ErrorCode, zodIssues } from "./errors.js";
import { invokeJsonProcess, type JsonProcessOptions } from "./process-rpc.js";

export async function invokeJsonResponse<T extends z.ZodTypeAny>(
  command: string,
  args: string[],
  request: unknown,
  options: JsonProcessOptions,
  responseSchema: T,
  invalidResponseCode: ErrorCode,
): Promise<z.infer<T>> {
  const raw = await invokeJsonProcess(command, args, request, options);
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new CodePatrolError(invalidResponseCode, "resolver stdout is not valid JSON");
  }
  const parsed = responseSchema.safeParse(json);
  if (!parsed.success) {
    throw new CodePatrolError(invalidResponseCode, zodIssues(parsed.error));
  }
  return parsed.data;
}
