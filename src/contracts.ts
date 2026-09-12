import { createHash } from "node:crypto";
import { isAbsolute, win32 } from "node:path";
import { z } from "zod";

export const PROTOCOL_VERSION = "1.0" as const;
export const VERSION = "1.0.0";
export const STAGES = [
  "spec",
  "spec-review",
  "plan",
  "plan-review",
  "build",
  "build-review",
  "ship",
] as const;
export const stageSchema = z.enum(STAGES);
export type Stage = z.infer<typeof stageSchema>;
export const contextProfileSchema = z.enum([
  "overview",
  "architecture",
  "implementation",
  "review",
]);
export type ContextProfile = z.infer<typeof contextProfileSchema>;
const version = z.literal(PROTOCOL_VERSION);
const text = z
  .string()
  .min(1)
  .max(100_000)
  .refine((value) => value.trim().length > 0, "Expected nonempty text");
export const idSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,99}$/);
export const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const unique = (items: string[]) => new Set(items).size === items.length;
const keySchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const titleSchema = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => value.trim().length > 0);
export const acceptanceCriterionSchema = z
  .object({ key: keySchema, text: z.string().min(1).max(2048) })
  .strict();
export const trackingSchema = z
  .object({
    init: z
      .object({
        key: keySchema,
        title: titleSchema,
        brief: z.string().min(1).max(8192),
      })
      .strict(),
    wave: z
      .object({
        key: keySchema,
        title: titleSchema,
        dueOn: z.string().date().optional(),
      })
      .strict(),
    work: z
      .object({
        key: keySchema,
        title: titleSchema,
        acceptance: z
          .array(acceptanceCriterionSchema)
          .max(100)
          .refine(
            (items) => unique(items.map((item) => item.key)),
            "Acceptance keys must be unique",
          ),
      })
      .strict(),
  })
  .strict();
const ids = z.array(idSchema).max(256).refine(unique, "IDs must be unique");
// biome-ignore lint/suspicious/noControlCharactersInRegex: Match ContextPatrol's path boundary.
const controlCharacters = /[\x00-\x1f\x7f]/;
export const taskSchema = z
  .string()
  .min(1)
  .max(8192)
  .refine((value) => value.trim().length > 0);
export const relativePathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (value) =>
      !isAbsolute(value) &&
      !win32.isAbsolute(value) &&
      !/[\\:*?[\]{}]/.test(value) &&
      !controlCharacters.test(value) &&
      value.split("/").every((part) => part !== ".." && part !== "." && part !== ""),
    "Expected a repository-relative path without traversal",
  );
export const argvSchema = z
  .array(
    z
      .string()
      .max(32_768)
      .refine((s) => !s.includes("\0")),
  )
  .min(1)
  .max(128)
  .refine((argv) => Boolean(argv[0]?.trim()), "Missing executable");
export const limitsSchema = z
  .object({
    timeoutMs: z.number().int().min(10).max(3_600_000).default(120_000),
    maxOutputBytes: z.number().int().min(1024).max(16_777_216).default(1_048_576),
  })
  .strict();
export const configSchema = z
  .object({
    protocolVersion: version,
    progress: z
      .object({ detail: z.enum(["safe", "verbose"]).default("safe") })
      .strict()
      .default({}),
    providers: z
      .object({
        agents: z
          .object({
            catalog: argvSchema.default(["agentpatrol", "catalog"]),
            resolve: argvSchema.default(["agentpatrol", "resolve"]),
          })
          .strict()
          .default({}),
        context: argvSchema.default(["contextpatrol", "query"]),
      })
      .strict()
      .default({}),
    executor: argvSchema.optional(),
    memorypatrol: z
      .object({
        recall: argvSchema.default(["memorypatrol", "recall"]),
        remember: argvSchema.default(["memorypatrol", "remember"]),
        handoff: argvSchema.default(["memorypatrol", "handoff"]),
        store: idSchema.default("codepatrol"),
        budget: z
          .object({
            maxResults: z.number().int().min(1).max(100).default(10),
            maxBytes: z.number().int().min(1024).max(1_048_576).default(24_000),
            maxVisited: z.number().int().min(1).max(5000).default(500),
          })
          .strict()
          .default({}),
      })
      .strict()
      .optional(),
    modelpatrol: z
      .object({
        baseUrl: z
          .string()
          .url()
          .refine((value) => {
            const url = new URL(value);
            return (
              (url.protocol === "https:" ||
                (url.protocol === "http:" &&
                  ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) &&
              !url.username &&
              !url.password &&
              !url.search &&
              !url.hash
            );
          }, "ModelPatrol requires HTTPS or loopback HTTP"),
        model: z
          .string()
          .regex(/^[A-Za-z0-9_.:/-]{1,160}$/)
          .default("auto"),
        apiKeyEnv: z
          .string()
          .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
          .default("MODELPATROL_API_KEY"),
        harness: z.enum(["opencode", "pi"]),
        api: z.enum(["chat", "responses", "messages"]).default("chat"),
        project: z.string().regex(/^[A-Za-z0-9_.:/-]{1,160}$/),
      })
      .strict()
      .optional(),
    verification: argvSchema.optional(),
    limits: limitsSchema.default({}),
    telemetry: z
      .object({ enabled: z.boolean().default(true) })
      .strict()
      .default({}),
    remote: z
      .object({
        github: z
          .object({
            repository: z
              .string()
              .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)
              .optional(),
            gitRemote: z.string().min(1).max(256).default("origin"),
            tokenEnv: z
              .string()
              .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
              .default("GITHUB_TOKEN"),
            sync: z.enum(["manual", "run-end"]).default("manual"),
          })
          .strict(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((config, ctx) => {
    if (
      config.memorypatrol &&
      config.memorypatrol.budget.maxBytes > config.limits.maxOutputBytes
    )
      ctx.addIssue({
        code: "custom",
        path: ["memorypatrol", "budget", "maxBytes"],
        message: "MemoryPatrol recall budget exceeds process output limit",
      });
  });
export type Config = z.infer<typeof configSchema>;
export const inputSchema = z
  .object({
    protocolVersion: version,
    root: z
      .string()
      .min(1)
      .max(4096)
      .refine(
        (value) => isAbsolute(value) && !controlCharacters.test(value),
        "root must be an absolute path without control characters",
      ),
    task: taskSchema,
    paths: z
      .array(relativePathSchema)
      .max(100)
      .refine(unique, "Seed paths must be unique")
      .default([]),
    config: text.optional(),
    tracking: trackingSchema.optional(),
  })
  .strict();
export type TaskInput = z.infer<typeof inputSchema>;
export const catalogSchema = z
  .object({
    protocolVersion: version,
    catalogVersion: text,
    contentDigest: digestSchema,
    personas: z
      .array(
        z
          .object({
            id: idSchema,
            description: text,
            stages: z.array(stageSchema).min(1).refine(unique),
            skills: ids,
          })
          .strict(),
      )
      .min(1)
      .max(256),
    profiles: z
      .array(
        z
          .object({
            id: idSchema,
            description: text,
            signals: z.array(text).max(256),
            skills: ids,
          })
          .strict(),
      )
      .min(1)
      .max(256),
  })
  .strict()
  .superRefine((catalog, ctx) => {
    for (const items of [catalog.personas, catalog.profiles]) {
      if (!unique(items.map((item) => item.id)))
        ctx.addIssue({ code: "custom", message: "Duplicate catalog IDs" });
    }
    const required: Record<string, Stage[]> = {
      architect: ["spec", "plan"],
      developer: ["build"],
      qa: ["spec-review", "plan-review", "build-review"],
      release: ["ship"],
    };
    for (const [id, stages] of Object.entries(required)) {
      if (
        !stages.every((stage) =>
          catalog.personas.find((p) => p.id === id)?.stages.includes(stage),
        )
      ) {
        ctx.addIssue({
          code: "custom",
          message: `Missing required persona eligibility: ${id}`,
        });
      }
    }
    for (const id of ["general", "react", "python", "mcp"]) {
      if (!catalog.profiles.some((p) => p.id === id))
        ctx.addIssue({ code: "custom", message: `Missing profile: ${id}` });
    }
  });
export type Catalog = z.infer<typeof catalogSchema>;
export const agentSchema = z
  .object({
    protocolVersion: version,
    catalogVersion: text,
    catalogDigest: digestSchema,
    persona: idSchema,
    profiles: ids,
    skills: z
      .array(z.object({ id: idSchema, instructions: text }).strict())
      .max(1024)
      .refine((skills) => unique(skills.map((skill) => skill.id))),
    instructions: text,
    digest: digestSchema,
  })
  .strict();
export type ResolvedAgent = z.infer<typeof agentSchema>;
export const contextSchema = z
  .object({
    protocolVersion: version,
    profile: contextProfileSchema,
    snapshot: digestSchema,
    signals: z
      .array(idSchema)
      .max(256)
      .refine((s) => unique(s) && [...s].sort().join() === s.join()),
    files: z
      .array(
        z
          .object({
            path: relativePathSchema,
            language: text,
            score: z.number().finite(),
            reasons: z.array(text).max(256),
            excerpt: z.string().optional(),
          })
          .strict(),
      )
      .max(10_000)
      .refine((files) => unique(files.map((file) => file.path))),
    graph: z
      .object({
        nodes: z.array(relativePathSchema).max(20_000).refine(unique),
        edges: z
          .array(
            z
              .object({
                from: relativePathSchema,
                to: relativePathSchema,
                kind: z.literal("imports"),
              })
              .strict(),
          )
          .max(100_000),
        cycles: z.array(z.array(relativePathSchema).max(20_000)).max(20_000),
        impacted: z.array(relativePathSchema).max(20_000).refine(unique),
      })
      .strict(),
    diagnostics: z.array(text).max(10_000),
    stats: z
      .object({
        scannedFiles: z.number().int().nonnegative(),
        selectedFiles: z.number().int().nonnegative(),
        truncated: z.boolean(),
      })
      .strict(),
    digest: digestSchema,
  })
  .strict()
  .superRefine((context, ctx) => {
    const nodes = new Set(context.graph.nodes);
    if (
      context.stats.selectedFiles !== context.files.length ||
      context.stats.scannedFiles < context.files.length ||
      context.graph.edges.some(
        (edge) => !nodes.has(edge.from) || !nodes.has(edge.to),
      ) ||
      [...context.graph.impacted, ...context.graph.cycles.flat()].some(
        (path) => !nodes.has(path),
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Inconsistent context graph or statistics",
      });
    }
  });
export type Context = z.infer<typeof contextSchema>;
export const usageSchema = z
  .object({
    inputTokens: z.number().finite().nonnegative().optional(),
    outputTokens: z.number().finite().nonnegative().optional(),
    costUsd: z.number().finite().nonnegative().optional(),
  })
  .strict();
export const memoryCandidateSchema = z
  .object({
    content: z
      .string()
      .min(1)
      .max(8000)
      .refine((value) => value.trim().length > 0),
    category: z
      .enum([
        "preference",
        "decision",
        "fact",
        "insight",
        "context",
        "general",
        "gotcha",
        "procedure",
      ])
      .default("insight"),
    importance: z.number().int().min(1).max(5).default(3),
    tags: z.array(z.string().min(1).max(128)).max(20).default([]),
    entities: z.array(z.string().min(1).max(128)).max(50).default([]),
  })
  .strict();
export type MemoryCandidate = z.input<typeof memoryCandidateSchema>;
export const executorResultSchema = z
  .object({
    protocolVersion: version,
    status: z.enum(["passed", "failed"]),
    summary: text,
    artifacts: z.array(z.string().max(4096)).max(1024),
    approved: z.boolean().optional(),
    acceptance: z
      .array(
        z
          .object({
            key: keySchema,
            status: z.enum(["passed", "failed"]),
            summary: text,
          })
          .strict(),
      )
      .max(100)
      .refine(
        (items) => unique(items.map((item) => item.key)),
        "Acceptance keys must be unique",
      )
      .optional(),
    usage: usageSchema.optional(),
  })
  .strict();
export type ExecutorResult = z.infer<typeof executorResultSchema>;

export const MAX_PLAN_BYTES = 8 * 1_048_576;
export const MAX_STATE_BYTES = 64 * 1_048_576;
export const MAX_ROUTE_ALTERNATIVES = 16;
export class PayloadLimitError extends Error {}
/** Use the exact compact representation for capacity checks and durable publication. */
export function boundedJson(value: unknown, maxBytes: number, label: string): string {
  const json = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(json) > maxBytes)
    throw new PayloadLimitError(`${label} exceeds ${maxBytes} byte limit`);
  return json;
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Not a JSON value");
  return encoded;
}
export function contentDigest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
export function validateDigest<T extends { digest: string }>(value: T): T {
  const { digest, ...payload } = value;
  if (digest !== contentDigest(payload)) throw new Error("Provider digest mismatch");
  return value;
}
