import { z } from "zod";
import { AGENT_REFERENCE, EXACT_AGENT_VERSION } from "./agent-protocol.js";
import type { ProducerOperation, Source, Task } from "./core.js";
import { digest, sha256Schema, stableJson } from "./shared.js";

export const EXECUTION_CONFIGURATION_DOMAIN = "codepatrol.execution-configuration.v1";
export const PRODUCER_ARTIFACT_DOMAIN = "codepatrol.producer-artifact";

export const agentProfileSchema = z
  .object({
    reference: z.string().regex(AGENT_REFERENCE),
    version: z.string().regex(EXACT_AGENT_VERSION),
  })
  .strict();

export const executionDescriptorSchema = z
  .object({
    schemaVersion: z.literal(1),
    harness: z.string().min(1),
    model: z.string().min(1).nullable(),
    contextProfile: z.string().min(1).nullable(),
    agentProfile: agentProfileSchema.nullable(),
  })
  .strict();

export type ExecutionDescriptor = z.infer<typeof executionDescriptorSchema>;

export const executionBatchSchema = z
  .object({
    id: z.string().min(1),
    ordinal: z.number().int().positive(),
    total: z.number().int().positive(),
  })
  .strict();

export const executionRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    descriptor: executionDescriptorSchema,
    configurationDigest: sha256Schema,
    batch: executionBatchSchema,
  })
  .strict();

export type ExecutionRecord = z.infer<typeof executionRecordSchema>;

export const contextSectionDigestSchema = z
  .object({
    section: z.string().min(1),
    digest: sha256Schema,
  })
  .strict();

export const fingerprintSchema = z
  .object({
    configurationDigest: sha256Schema,
    artifactDigest: sha256Schema.optional(),
    agentDigest: sha256Schema.optional(),
    agentInstructionsDigest: sha256Schema.optional(),
    contextRequestDigest: sha256Schema.optional(),
    contextReportDigest: sha256Schema.optional(),
    contextSectionDigests: z.array(contextSectionDigestSchema).optional(),
    contextAvailability: z
      .enum(["context-supplied", "context-not-supplied", "sections-not-supplied"])
      .optional(),
    candidateCommit: z.string().optional(),
    candidateTree: z.string().optional(),
    verificationOutputDigest: z.string().optional(),
  })
  .strict();

export type Fingerprint = z.infer<typeof fingerprintSchema>;

const CONTEXT_METADATA_KEYS = new Set([
  "schemaVersion",
  "provider",
  "requestDigest",
  "reportDigest",
  "target",
  "budget",
]);

export function descriptorFromSource(
  source: Source,
  contextProfile: string | null,
): ExecutionDescriptor {
  return {
    schemaVersion: 1,
    harness: source.harness,
    model: source.model,
    contextProfile,
    agentProfile:
      source.agent && source.agentVersion
        ? { reference: source.agent, version: source.agentVersion }
        : null,
  };
}

export function configurationDigest(descriptor: ExecutionDescriptor): string {
  return `sha256:${digest({
    domain: EXECUTION_CONFIGURATION_DOMAIN,
    value: descriptor,
  })}`;
}

export function producerArtifactDigest(
  operation: ProducerOperation,
  document: unknown,
): string {
  return `sha256:${digest({
    domain: `${PRODUCER_ARTIFACT_DOMAIN}.${operation}.v1`,
    value: document,
  })}`;
}

export function contextSectionDigests(
  report: Record<string, unknown>,
): Array<{ section: string; digest: string }> {
  return Object.entries(report)
    .filter(([key]) => !CONTEXT_METADATA_KEYS.has(key))
    .map(([section, value]) => ({
      section,
      digest: `sha256:${digest(stableJson(value))}`,
    }))
    .sort((left, right) => left.section.localeCompare(right.section));
}

export function computeFingerprint(
  task: Task,
  extras: {
    artifactDigest?: string;
    candidate?: { commit: string; tree: string };
    verificationOutputDigest?: string;
  } = {},
): Fingerprint | undefined {
  if (!task.execution) return undefined;
  const source = task.source;
  const context = task.contextSnapshot;
  const sections = context ? contextSectionDigests(context.report) : [];
  const contextAvailability = !context
    ? "context-not-supplied"
    : sections.length === 0
      ? "sections-not-supplied"
      : "context-supplied";
  return {
    configurationDigest: task.execution.configurationDigest,
    ...(extras.artifactDigest ? { artifactDigest: extras.artifactDigest } : {}),
    ...(source.agentDigest ? { agentDigest: source.agentDigest } : {}),
    ...(source.agentInstructionsDigest
      ? { agentInstructionsDigest: source.agentInstructionsDigest }
      : {}),
    ...(context?.requestDigest ? { contextRequestDigest: context.requestDigest } : {}),
    ...(context?.reportDigest ? { contextReportDigest: context.reportDigest } : {}),
    ...(sections.length > 0 ? { contextSectionDigests: sections } : {}),
    ...(contextAvailability ? { contextAvailability } : {}),
    ...(extras.candidate
      ? {
          candidateCommit: extras.candidate.commit,
          candidateTree: extras.candidate.tree,
        }
      : {}),
    ...(extras.verificationOutputDigest
      ? { verificationOutputDigest: extras.verificationOutputDigest }
      : {}),
  };
}
