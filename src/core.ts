import { randomUUID } from "node:crypto";
import type { ProducerOperation, ReviewOperation, Round, State } from "./schemas.js";

export * from "./schemas.js";

export function createState(projectId: string): State {
  return {
    schemaVersion: 1,
    projectId,
    sequence: 0,
    nextInit: 1,
    inits: [],
    waves: [],
    works: [],
    tasks: [],
    proposals: [],
    routing: { schemaVersion: 1, decisions: [], observations: [], aggregates: [] },
  };
}

export function id(prefix: "TASK" | "PROP"): string {
  return `${prefix}-${randomUUID()}`;
}

export function reviewFor(operation: ProducerOperation): ReviewOperation {
  return `${operation}-review` as ReviewOperation;
}

export function producerFor(operation: ReviewOperation): ProducerOperation {
  return operation.replace("-review", "") as ProducerOperation;
}

export function newRound(operation: ProducerOperation, number: number): Round {
  return {
    number,
    operation,
    status: "open",
    proposalIds: [],
    reviewTaskId: null,
    selectedProposalId: null,
  };
}
