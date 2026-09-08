import type { Config } from "./contracts.js";
import type { ExecutorRequest } from "./executor.js";

/** Scoped to the stage process; credentials never enter executor JSON or durable state. */
export function modelpatrolEnvironment(
  config: Config,
  request: ExecutorRequest,
  environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv | undefined {
  const gateway = config.modelpatrol;
  if (!gateway) return undefined;
  if (!environment[gateway.apiKeyEnv])
    throw new Error("ModelPatrol gateway credential is missing");
  const headers = {
    "x-patrol-step": request.stage,
    "x-patrol-agent": request.agent.persona,
    "x-patrol-profile": request.agent.profiles.join(",") || "general",
    "x-patrol-harness": gateway.harness,
    "x-patrol-project": gateway.project,
    "x-patrol-run-id": request.runId,
    "x-patrol-session-id": request.runId,
    "x-patrol-trace-id": `${request.runId}:${request.stage}`,
  };
  for (const value of Object.values(headers)) {
    if (!/^[A-Za-z0-9_.:/, -]{1,256}$/.test(value))
      throw new Error("ModelPatrol metadata exceeds header contract");
  }
  return {
    ...environment,
    MODELPATROL_BASE_URL: gateway.baseUrl.replace(/\/$/, ""),
    MODELPATROL_MODEL: gateway.model,
    MODELPATROL_API: gateway.api,
    MODELPATROL_API_KEY_ENV: gateway.apiKeyEnv,
    MODELPATROL_HEADERS: JSON.stringify(headers),
  };
}
