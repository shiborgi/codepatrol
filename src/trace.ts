import type { State, Task } from "./core.js";

export type TimelineEntry = {
  subject: string;
  operation: string;
  kind: "opened" | "submitted" | "review-decision" | "verification" | "ship-decision";
  outcome: string;
  timestamp: string;
  failedAcceptanceIds?: string[];
  candidates?: Array<{ proposalId: string; status: string }>;
};

export type StateHistoryEntry = {
  event: { sequence: number; event: string; at: string };
  state: State;
};

const OPEN = /^(spec|plan|build|spec-review|plan-review|build-review) open (.+)$/;
const SUBMIT = /^(spec|plan|build|spec-review|plan-review|build-review) submit (.+)$/;
const PREPARED = /^build-review prepared (.+)$/;
const SHIP = /^ship (accept|rollback) (.+)$/;

export function failedAcceptanceIds(result: unknown): string[] {
  if (!result || typeof result !== "object") return [];
  const acceptance = (
    result as { acceptance?: Array<{ id?: string; status?: string }> }
  ).acceptance;
  if (!Array.isArray(acceptance)) return [];
  return acceptance
    .filter((entry) => entry.status === "failed" && typeof entry.id === "string")
    .map((entry) => entry.id as string);
}

export function doctorSignals(
  state: State,
  maxReviewReturns: number,
): {
  atRiskWaves: Array<{
    waveId: string;
    operation: "plan" | "build";
    reviewReturns: number;
  }>;
  recurringAcceptanceFailures: Array<{
    waveId: string;
    operation: "build";
    acceptanceId: string;
    rounds: number;
  }>;
} {
  const threshold = Math.max(0, maxReviewReturns - 1);
  const atRiskWaves = state.waves.flatMap((wave) =>
    (["plan", "build"] as const)
      .filter((operation) => wave.reviewReturns[operation] >= threshold)
      .map((operation) => ({
        waveId: wave.id,
        operation,
        reviewReturns: wave.reviewReturns[operation],
      })),
  );
  const seen = new Map<string, Set<number>>();
  for (const task of state.tasks) {
    if (task.operation !== "build-review" || task.status !== "submitted") continue;
    for (const acceptanceId of failedAcceptanceIds(task.result)) {
      const key = `${task.subjectId}\0${acceptanceId}`;
      const rounds = seen.get(key) ?? new Set<number>();
      rounds.add(task.round);
      seen.set(key, rounds);
    }
  }
  const recurringAcceptanceFailures = [...seen.entries()]
    .filter(([, rounds]) => rounds.size >= 2)
    .map(([key, rounds]) => {
      const [waveId, acceptanceId] = key.split("\0");
      return {
        waveId: waveId as string,
        operation: "build" as const,
        acceptanceId: acceptanceId as string,
        rounds: rounds.size,
      };
    });
  return { atRiskWaves, recurringAcceptanceFailures };
}

export function timelineFromHistory(
  history: StateHistoryEntry[],
  subjectId: string,
  kind: "init" | "wave",
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  for (const snapshot of history) {
    const eventSubject = subjectOf(snapshot.event.event);
    if (!eventSubject || !matchesSubject(kind, subjectId, eventSubject, snapshot.state))
      continue;
    entries.push(...entriesFor(snapshot, eventSubject));
  }
  return entries;
}

function subjectOf(event: string): string | null {
  return (
    event.match(OPEN)?.[2] ??
    event.match(SUBMIT)?.[2] ??
    event.match(PREPARED)?.[1] ??
    event.match(SHIP)?.[2] ??
    null
  );
}

function matchesSubject(
  kind: "init" | "wave",
  subjectId: string,
  eventSubject: string,
  state: State,
): boolean {
  if (eventSubject === subjectId) return true;
  if (kind === "wave") return false;
  return state.waves.some(
    (wave) => wave.id === eventSubject && wave.initId === subjectId,
  );
}

function entriesFor(snapshot: StateHistoryEntry, subject: string): TimelineEntry[] {
  const { event, state } = snapshot;
  const opened = event.event.match(OPEN);
  if (opened) {
    const operation = opened[1] as string;
    const task = latestTask(state, operation, subject);
    return [
      {
        subject,
        operation,
        kind: "opened",
        outcome: task?.status ?? "open",
        timestamp: task?.createdAt ?? event.at,
      },
    ];
  }
  const submitted = event.event.match(SUBMIT);
  if (submitted) {
    const operation = submitted[1] as string;
    const task = latestTask(state, operation, subject);
    const entries: TimelineEntry[] = [
      {
        subject,
        operation,
        kind: "submitted",
        outcome: task?.status ?? "submitted",
        timestamp: task?.finishedAt ?? event.at,
      },
    ];
    if (operation.endsWith("-review") && task?.result) {
      const result = task.result as {
        decision?: string;
        candidates?: Array<{ proposalId: string; status: string }>;
      };
      const failed = failedAcceptanceIds(result);
      entries.push({
        subject,
        operation,
        kind: "review-decision",
        outcome: result.decision ?? "unknown",
        timestamp: task.finishedAt ?? event.at,
        ...(result.candidates ? { candidates: result.candidates } : {}),
        ...(failed.length > 0 ? { failedAcceptanceIds: failed } : {}),
      });
    }
    return entries;
  }
  if (PREPARED.test(event.event)) {
    const task = latestTask(state, "build-review", subject);
    const failed = task?.verification.some((entry) => entry.status !== "passed");
    return [
      {
        subject,
        operation: "build-review",
        kind: "verification",
        outcome: failed ? "failed" : "passed",
        timestamp: event.at,
      },
    ];
  }
  const shipped = event.event.match(SHIP);
  if (shipped) {
    return [
      {
        subject,
        operation: "ship",
        kind: "ship-decision",
        outcome: shipped[1] as string,
        timestamp: event.at,
      },
    ];
  }
  return [];
}

function latestTask(
  state: State,
  operation: string,
  subjectId: string,
): Task | undefined {
  return [...state.tasks]
    .reverse()
    .find((task) => task.operation === operation && task.subjectId === subjectId);
}
