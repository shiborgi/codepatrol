import { z } from "zod";
import {
  AGENT_REFERENCE,
  isAgentReference,
  isExactAgentVersion,
} from "./agent-protocol.js";
import type { Config } from "./config.js";
import { digest } from "./core.js";
import { CodePatrolError, ERROR_CODES } from "./errors.js";
import { invokeJsonResponse } from "./resolver-rpc.js";
import { type RunContext, systemRunContext } from "./run-context.js";
import { LIMITS, sha256Schema } from "./shared.js";

const responseSchema = z
  .object({
    schemaVersion: z.literal(1),
    agent: z
      .object({
        reference: z.string().regex(AGENT_REFERENCE),
        name: z.string().min(1),
        version: z.string().min(1),
        digest: sha256Schema,
      })
      .strict(),
    instructionsDigest: sha256Schema,
    instructions: z
      .string()
      .min(1)
      .max(256 * 1024),
  })
  .strict();

export interface AgentRequest {
  reference: string;
  version: string;
}

export type AgentResolution = z.infer<typeof responseSchema>;

export async function resolveAgent(
  catalog: NonNullable<Config["agentCatalog"]> | undefined,
  request: AgentRequest,
  ctx: RunContext = systemRunContext(),
): Promise<AgentResolution> {
  if (!isAgentReference(request.reference)) {
    throw new CodePatrolError(
      ERROR_CODES.AGENT_RESOLVER_MISMATCH,
      "agent reference must be agentpatrol/<id>",
      2,
    );
  }
  if (!isExactAgentVersion(request.version)) {
    throw new CodePatrolError(
      ERROR_CODES.AGENT_VERSION_NOT_EXACT,
      "agent version must be an exact semantic version",
      2,
    );
  }
  if (!catalog) {
    throw new CodePatrolError(
      ERROR_CODES.AGENT_RESOLVER_NOT_CONFIGURED,
      "exact agent resolution requires agentCatalog configuration",
      2,
    );
  }
  const [command, ...args] = catalog.argv;
  if (!command) {
    throw new CodePatrolError(
      ERROR_CODES.AGENT_RESOLVER_NOT_CONFIGURED,
      "agentCatalog argv is empty",
      2,
    );
  }
  ctx.log.debug(
    `resolving agent ${request.reference}@${request.version} via ${command}`,
  );
  const parsed = await invokeJsonResponse(
    command,
    args,
    {
      schemaVersion: 1,
      reference: request.reference,
      version: request.version,
    },
    {
      timeoutMs: catalog.timeoutMs,
      maxOutputBytes: LIMITS.agentResponseBytes,
      maxErrorBytes: LIMITS.subprocessErrorBytes,
      unavailableCode: ERROR_CODES.AGENT_RESOLVER_UNAVAILABLE,
      failedCode: ERROR_CODES.AGENT_RESOLVER_FAILED,
      timeoutCode: ERROR_CODES.AGENT_RESOLVER_TIMEOUT,
      tooLargeCode: ERROR_CODES.AGENT_RESOLVER_RESPONSE_TOO_LARGE,
      unavailableMessage: (message) => `cannot start agent resolver: ${message}`,
      failedMessage: (stderr, status) =>
        stderr || `agent resolver exited with status ${status ?? "unknown"}`,
      timeoutMessage: (timeout) => `agent resolver exceeded ${timeout}ms`,
      tooLargeMessage: (bytes) => `agent resolver response exceeds ${bytes} bytes`,
      error: (code, message) =>
        new CodePatrolError(
          code as (typeof ERROR_CODES)[keyof typeof ERROR_CODES],
          message,
        ),
    },
    responseSchema,
    ERROR_CODES.AGENT_RESOLVER_INVALID_RESPONSE,
  );
  if (
    parsed.agent.reference !== request.reference ||
    parsed.agent.version !== request.version
  ) {
    throw new CodePatrolError(
      ERROR_CODES.AGENT_RESOLVER_MISMATCH,
      "agent resolver returned a different reference or version",
    );
  }
  if (Buffer.byteLength(parsed.instructions, "utf8") > LIMITS.agentInstructionsBytes) {
    throw new CodePatrolError(
      ERROR_CODES.AGENT_RESOLVER_INVALID_RESPONSE,
      `agent resolver instructions exceed ${LIMITS.agentInstructionsBytes} bytes`,
    );
  }
  if (`sha256:${digest(parsed.instructions)}` !== parsed.instructionsDigest) {
    throw new CodePatrolError(
      ERROR_CODES.AGENT_RESOLVER_DIGEST_MISMATCH,
      "agent resolver instructions digest does not match the instructions",
    );
  }
  ctx.log.debug(`resolved agent ${parsed.agent.reference}@${parsed.agent.version}`);
  return parsed;
}
