import { createHash } from "node:crypto";
import { z } from "zod";

export const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const STATE_REF = "refs/codepatrol/v1/state";

export const LIMITS = {
  agentInstructionsBytes: 256 * 1024,
  agentResponseBytes: 512 * 1024,
  contextResponseBytes: 2 * 1024 * 1024,
  subprocessErrorBytes: 64 * 1024,
  verificationOutputBytes: 64 * 1024,
} as const;

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function digest(value: string | object): string {
  return sha256(typeof value === "string" ? value : stableJson(value));
}

export function parseSchema<T extends z.ZodTypeAny>(
  schema: T,
  value: unknown,
): z.infer<T> | undefined {
  const result = schema.safeParse(value);
  return result.success ? result.data : undefined;
}
