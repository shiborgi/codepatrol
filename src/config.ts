import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { AGENT_REFERENCE, EXACT_AGENT_VERSION } from "./agent-protocol.js";
import { CodePatrolError, ERROR_CODES, zodIssues } from "./errors.js";
import { operations } from "./schemas.js";

const agentSelectionSchema = z
  .object({
    agent: z.string().regex(AGENT_REFERENCE),
    version: z.string().regex(EXACT_AGENT_VERSION),
  })
  .strict();

const agentDefaultsSchema = z
  .object({
    spec: agentSelectionSchema.optional(),
    plan: agentSelectionSchema.optional(),
    build: agentSelectionSchema.optional(),
    "spec-review": agentSelectionSchema.optional(),
    "plan-review": agentSelectionSchema.optional(),
    "build-review": agentSelectionSchema.optional(),
    ship: agentSelectionSchema.optional(),
  })
  .strict()
  .default({});

const rankingListSchema = z
  .array(z.string().min(1))
  .max(50)
  .superRefine((values, context) => {
    if (new Set(values).size !== values.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ranking entries must be unique",
      });
    }
    values.forEach((value, index) => {
      if (Buffer.byteLength(value, "utf8") > 128) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `ranking.${index} exceeds 128 UTF-8 bytes`,
        });
      }
    });
  });

const contextProfileSchema = z
  .object({
    facets: z
      .array(
        z.enum(["structure", "symbols", "relations", "source", "changes", "tests"]),
      )
      .min(1),
    maxOutputBytes: z.number().int().min(1_024).max(65_536),
    includePaths: z.array(z.string().min(1)).max(200).optional(),
    excludePaths: z.array(z.string().min(1)).max(200).optional(),
    sourceDepth: z.enum(["full", "signatures", "listing"]).optional(),
    ranking: z
      .object({
        boostIdents: rankingListSchema.optional(),
        boostPaths: rankingListSchema.optional(),
        dampenPaths: rankingListSchema.optional(),
      })
      .strict()
      .optional(),
    supportedOperations: z.array(z.enum(operations)).max(20).optional(),
    routingTags: z.array(z.string().min(1).max(32)).max(20).optional(),
  })
  .strict()
  .superRefine((profile, context) => {
    if (profile.routingTags) {
      const unique = new Set(profile.routingTags);
      if (unique.size !== profile.routingTags.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "routingTags must be unique",
        });
      }
    }
    if (profile.supportedOperations) {
      const unique = new Set(profile.supportedOperations);
      if (unique.size !== profile.supportedOperations.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "supportedOperations must be unique",
        });
      }
    }
  });

const contextDefaultsSchema = z
  .object({
    spec: z.string().min(1).optional(),
    "spec-review": z.string().min(1).optional(),
    plan: z.string().min(1).optional(),
    "plan-review": z.string().min(1).optional(),
    build: z.string().min(1).optional(),
    "build-review": z.string().min(1).optional(),
    ship: z.string().min(1).optional(),
  })
  .strict()
  .default({});

const configSchema = z
  .object({
    schemaVersion: z.literal(1),
    baseBranch: z.string().min(1).default("main"),
    verification: z
      .object({
        argv: z.array(z.string().min(1)).min(1),
        timeoutMs: z.number().int().positive().max(3_600_000).default(180_000),
        sharedPaths: z.array(z.string().min(1)).optional(),
      })
      .strict(),
    maxReviewReturns: z.number().int().positive().default(3),
    agentCatalog: z
      .object({
        argv: z.array(z.string().min(1)).min(1),
        timeoutMs: z.number().int().positive().max(60_000).default(10_000),
        defaults: agentDefaultsSchema,
      })
      .strict()
      .optional(),
    contextPatrol: z
      .object({
        argv: z.array(z.string().min(1)).min(1),
        timeoutMs: z.number().int().positive().max(300_000).default(60_000),
        profiles: z.record(z.string().min(1), contextProfileSchema),
        defaults: contextDefaultsSchema,
      })
      .strict()
      .superRefine((provider, context) => {
        for (const [operation, profile] of Object.entries(provider.defaults)) {
          if (!provider.profiles[profile]) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: `contextPatrol.defaults.${operation} references unknown profile ${profile}`,
            });
          }
        }
      })
      .optional(),
    remote: z
      .object({
        github: z
          .object({
            enabled: z.boolean().default(false),
            repo: z.string().min(3).optional(),
            gitRemote: z.string().min(1).default("origin"),
            tokenEnv: z.string().min(1).default("GITHUB_TOKEN"),
            wiki: z.boolean().default(true),
            milestones: z.boolean().default(true),
            issues: z.boolean().default(true),
            comments: z.boolean().optional().default(true),
            pushMain: z.boolean().default(false),
          })
          .strict(),
      })
      .strict()
      .optional(),
    orchestrator: z
      .object({
        policyVersion: z.string().min(1).max(16),
        uncertaintyThreshold: z.number().int().positive().max(1000),
        maxFanout: z.number().int().min(2).max(5),
        minObservations: z.number().int().min(0).max(10000),
        explorationInterval: z.number().int().positive().max(10000),
        coldStartPrior: z.number().int().min(0).max(100),
        maxObservations: z.number().int().positive().max(100000),
        maxAggregates: z.number().int().positive().max(10000),
      })
      .strict()
      .optional(),
  })
  .strict();

export type Config = z.infer<typeof configSchema>;

export function validateConfig(json: unknown): Config {
  const parsed = configSchema.safeParse(json);
  if (!parsed.success) {
    throw new CodePatrolError(ERROR_CODES.CONFIG_INVALID, zodIssues(parsed.error));
  }
  return parsed.data;
}

export function loadConfig(workspace: string): Config {
  const path = resolve(workspace, "codepatrol.json");
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new CodePatrolError(
        ERROR_CODES.CONFIG_INVALID,
        `missing configuration file ${path}: create codepatrol.json in the repository root describing verification and branches`,
        2,
      );
    }
    throw new CodePatrolError(
      ERROR_CODES.CONFIG_INVALID,
      `cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`,
      2,
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new CodePatrolError(
      ERROR_CODES.CONFIG_INVALID,
      `cannot parse valid JSON from ${path}`,
      2,
    );
  }
  return validateConfig(json);
}
