import { fail } from "./errors.js";

export interface CapabilityRef {
  id: string;
  version: number;
  digest: string;
}

export interface ExecutionIdentity<M extends string = string> {
  role: M;
  harness: string;
  model?: string;
  profile?: string;
  capabilities?: CapabilityRef[];
  compositionDigest?: string;
}

export function assertCompositionConsistency(execution: ExecutionIdentity, context: string): void {
  const hasProfile = execution.profile !== undefined;
  const hasCapabilities = execution.capabilities !== undefined;
  const hasDigest = execution.compositionDigest !== undefined;
  if (hasProfile || hasCapabilities || hasDigest) {
    if (!hasProfile || !hasCapabilities || !hasDigest) {
      fail(
        "STATE_CORRUPT",
        `${context}: composition fields (profile, capabilities, compositionDigest) must be all present or all absent`,
      );
    }
  }
}

export interface TodoItem {
  id: string;
  title: string;
}

export interface TodoResult {
  id: string;
  status: "done" | "dropped";
  note?: string;
}
