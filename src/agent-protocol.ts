export const EXACT_AGENT_VERSION =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*)|(?:\d*[A-Za-z-][0-9A-Za-z-]*))(?:\.(?:(?:0|[1-9]\d*)|(?:\d*[A-Za-z-][0-9A-Za-z-]*)))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
export const AGENT_REFERENCE = /^agentpatrol\/[a-z][a-z0-9-]*$/;

export function isExactAgentVersion(value: string): boolean {
  return EXACT_AGENT_VERSION.test(value);
}

export function isAgentReference(value: string): boolean {
  return AGENT_REFERENCE.test(value);
}
