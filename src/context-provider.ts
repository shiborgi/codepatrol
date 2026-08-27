import { z } from "zod";
import type { Config } from "./config.js";
import { CodePatrolError, ERROR_CODES } from "./errors.js";
import { invokeJsonResponse } from "./resolver-rpc.js";
import { type RunContext, systemRunContext } from "./run-context.js";
import { LIMITS, sha256, sha256Schema, stableJson } from "./shared.js";

const facetOrder = ["structure", "symbols", "relations", "source", "changes", "tests"];
export const contextProfileUnavailableReasons = [
  "CONTEXT_PROFILE_NOT_FOUND",
  "CONTEXT_PROVIDER_DIGEST_MISMATCH",
  "CONTEXT_PROVIDER_FAILED",
  "CONTEXT_PROVIDER_INVALID_RESPONSE",
  "CONTEXT_PROVIDER_MISMATCH",
  "CONTEXT_PROVIDER_NOT_CONFIGURED",
  "CONTEXT_PROVIDER_RESPONSE_TOO_LARGE",
  "CONTEXT_PROVIDER_TIMEOUT",
  "CONTEXT_PROVIDER_UNAVAILABLE",
] as const;
type ContextProfileUnavailableReason =
  (typeof contextProfileUnavailableReasons)[number];
const responseSchema = z
  .object({
    schemaVersion: z.literal(1),
    provider: z
      .object({ name: z.literal("contextpatrol"), version: z.literal("1.0.0") })
      .strict(),
    requestDigest: sha256Schema,
    reportDigest: sha256Schema,
    target: z
      .object({
        kind: z.enum(["working-tree", "commit"]),
        commit: z.string().min(1),
        dirtyDigest: sha256Schema,
        contentDigest: sha256Schema,
      })
      .strict(),
    budget: z
      .object({
        maxOutputBytes: z.number().int().positive(),
        outputBytes: z.number().int().positive(),
        limited: z.boolean(),
      })
      .strict(),
  })
  .passthrough();

export type ContextSnapshot = {
  profile: string;
  reportDigest: string;
  requestDigest: string;
  report: Record<string, unknown>;
};

export type ContextSnapshotAudit = {
  profile: string;
  reportDigest: string;
  requestDigest: string;
  outputBytes: number;
  limited: boolean;
  omittedFiles: number;
  omittedRelations: number;
  omittedSnippets: number;
  omittedSymbols: number;
};

export type ContextProfileArtifact = {
  schemaVersion: 1;
  profile: string;
  requestDigest: string | null;
  reportDigest: string | null;
  coverage: {
    limited: boolean;
    outputBytes: number;
    omittedFiles: number;
    omittedRelations: number;
    omittedSnippets: number;
    omittedSymbols: number;
  };
  evidenceRefs: string[];
  availability:
    | { status: "available" }
    | { status: "unavailable"; reason: ContextProfileUnavailableReason };
};

export function contextProfileArtifact(
  snapshot: ContextSnapshot,
): ContextProfileArtifact {
  const audit = auditContextSnapshot(snapshot);
  const evidence = snapshot.report.evidence;
  const refs = Array.isArray(evidence)
    ? evidence
        .map((item) =>
          typeof item === "string"
            ? item
            : typeof item === "object" && item !== null && typeof item.ref === "string"
              ? item.ref
              : undefined,
        )
        .filter((ref): ref is string => ref !== undefined)
    : [];
  return {
    schemaVersion: 1,
    profile: snapshot.profile,
    requestDigest: snapshot.requestDigest,
    reportDigest: snapshot.reportDigest,
    coverage: {
      limited: audit.limited,
      outputBytes: audit.outputBytes,
      omittedFiles: audit.omittedFiles,
      omittedRelations: audit.omittedRelations,
      omittedSnippets: audit.omittedSnippets,
      omittedSymbols: audit.omittedSymbols,
    },
    evidenceRefs: [...new Set(refs)].sort((left, right) => left.localeCompare(right)),
    availability: { status: "available" },
  };
}

export function unavailableContextProfileArtifact(
  profile: string,
  reason: string,
): ContextProfileArtifact {
  return {
    schemaVersion: 1,
    profile,
    requestDigest: null,
    reportDigest: null,
    coverage: {
      limited: false,
      outputBytes: 0,
      omittedFiles: 0,
      omittedRelations: 0,
      omittedSnippets: 0,
      omittedSymbols: 0,
    },
    evidenceRefs: [],
    availability: {
      status: "unavailable",
      reason: contextProfileUnavailableReasons.includes(
        reason as ContextProfileUnavailableReason,
      )
        ? (reason as ContextProfileUnavailableReason)
        : "CONTEXT_PROVIDER_FAILED",
    },
  };
}

export function auditContextSnapshot(snapshot: ContextSnapshot): ContextSnapshotAudit {
  const budget = snapshot.report.budget as
    | { outputBytes?: unknown; limited?: unknown }
    | undefined;
  const coverage = snapshot.report.coverage as
    | {
        omittedFiles?: unknown;
        omittedRelations?: unknown;
        omittedSnippets?: unknown;
        omittedSymbols?: unknown;
      }
    | undefined;
  return {
    profile: snapshot.profile,
    reportDigest: snapshot.reportDigest,
    requestDigest: snapshot.requestDigest,
    outputBytes: typeof budget?.outputBytes === "number" ? budget.outputBytes : 0,
    limited: budget?.limited === true,
    omittedFiles:
      typeof coverage?.omittedFiles === "number" ? coverage.omittedFiles : 0,
    omittedRelations:
      typeof coverage?.omittedRelations === "number" ? coverage.omittedRelations : 0,
    omittedSnippets:
      typeof coverage?.omittedSnippets === "number" ? coverage.omittedSnippets : 0,
    omittedSymbols:
      typeof coverage?.omittedSymbols === "number" ? coverage.omittedSymbols : 0,
  };
}

export type ContextTarget = { kind: "working-tree" } | { kind: "commit"; oid: string };

export async function resolveContext(
  provider: NonNullable<Config["contextPatrol"]> | undefined,
  profile: string,
  workspace: string,
  query: string,
  target: ContextTarget,
  baseline: { oid: string } | undefined,
  ctx: RunContext = systemRunContext(),
): Promise<ContextSnapshot> {
  if (!provider)
    throw new CodePatrolError(
      ERROR_CODES.CONTEXT_PROVIDER_NOT_CONFIGURED,
      "context profile requires contextPatrol configuration",
      2,
    );
  const definition = provider.profiles[profile];
  if (!definition)
    throw new CodePatrolError(
      ERROR_CODES.CONTEXT_PROFILE_NOT_FOUND,
      `unknown context profile: ${profile}`,
      2,
    );
  const request = {
    schemaVersion: 1,
    workspace,
    query,
    facets: [...definition.facets].sort(
      (left, right) => facetOrder.indexOf(left) - facetOrder.indexOf(right),
    ),
    maxOutputBytes: definition.maxOutputBytes,
    target,
    ...(baseline ? { baseline } : {}),
    ...(definition.includePaths ? { includePaths: definition.includePaths } : {}),
    ...(definition.excludePaths ? { excludePaths: definition.excludePaths } : {}),
  };
  const [command, ...args] = provider.argv;
  if (!command)
    throw new CodePatrolError(
      ERROR_CODES.CONTEXT_PROVIDER_NOT_CONFIGURED,
      "context argv is empty",
      2,
    );
  ctx.log.debug(`resolving context profile ${profile} via ${command}`);
  const validated = await invokeJsonResponse(
    command,
    args,
    request,
    {
      cwd: workspace,
      timeoutMs: provider.timeoutMs,
      maxOutputBytes: LIMITS.contextResponseBytes,
      maxErrorBytes: LIMITS.subprocessErrorBytes,
      unavailableCode: ERROR_CODES.CONTEXT_PROVIDER_UNAVAILABLE,
      failedCode: ERROR_CODES.CONTEXT_PROVIDER_FAILED,
      timeoutCode: ERROR_CODES.CONTEXT_PROVIDER_TIMEOUT,
      tooLargeCode: ERROR_CODES.CONTEXT_PROVIDER_RESPONSE_TOO_LARGE,
      unavailableMessage: (message) => `cannot start context provider: ${message}`,
      failedMessage: (stderr, status) =>
        stderr || `context provider exited with status ${status ?? "unknown"}`,
      timeoutMessage: (timeout) => `context provider exceeded ${timeout}ms`,
      tooLargeMessage: (bytes) => `context provider response exceeds ${bytes} bytes`,
      error: (code, message) =>
        new CodePatrolError(
          code as (typeof ERROR_CODES)[keyof typeof ERROR_CODES],
          message,
        ),
    },
    responseSchema,
    ERROR_CODES.CONTEXT_PROVIDER_INVALID_RESPONSE,
  );
  if (validated.budget.maxOutputBytes !== definition.maxOutputBytes)
    throw new CodePatrolError(
      ERROR_CODES.CONTEXT_PROVIDER_MISMATCH,
      "context provider returned a different budget",
    );
  const expected = `sha256:${sha256(stableJson(request))}`;
  if (validated.requestDigest !== expected)
    throw new CodePatrolError(
      ERROR_CODES.CONTEXT_PROVIDER_MISMATCH,
      "context provider returned a different request digest",
    );
  const report = validated as Record<string, unknown>;
  const withoutDigest = { ...report };
  delete withoutDigest.reportDigest;
  if (`sha256:${sha256(stableJson(withoutDigest))}` !== validated.reportDigest)
    throw new CodePatrolError(
      ERROR_CODES.CONTEXT_PROVIDER_DIGEST_MISMATCH,
      "context report digest does not match its content",
    );
  ctx.log.debug(`resolved context profile ${profile}`);
  return {
    profile,
    reportDigest: validated.reportDigest,
    requestDigest: validated.requestDigest,
    report,
  };
}
