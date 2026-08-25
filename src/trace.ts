import type { State, Task } from "./core.js";

export type TimelineEntry = {
  subject: string;
  operation: string;
  kind:
    | "opened"
    | "submitted"
    | "review-decision"
    | "verification"
    | "ship-decision"
    | "cancel"
    | "fail";
  outcome: string;
  timestamp: string;
  failedAcceptanceIds?: string[];
  candidates?: Array<{ proposalId: string; status: string }>;
  taskId?: string;
};

export type Problem = {
  kind: "duplicate-producer" | "abandoned-producer" | "review-dwell";
  subject: string;
  operation: string;
  message: string;
  taskId?: string;
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
  openTasks: Array<{
    id: string;
    operation: string;
    subjectId: string;
    status: string;
    createdAt: string;
    nextCommand: string;
  }>;
} {
  const threshold = Math.max(0, maxReviewReturns - 1);
  const activeWaves = state.waves.filter(
    (wave) => !["accepted", "rolled-back"].includes(wave.status),
  );
  const atRiskWaves = activeWaves.flatMap((wave) =>
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
    const wave = state.waves.find((candidate) => candidate.id === task.subjectId);
    if (wave && ["accepted", "rolled-back"].includes(wave.status)) continue;
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
  const openTasks = state.tasks
    .filter((task) => ["preparing", "open", "blocked"].includes(task.status))
    .map((task) => ({
      id: task.id,
      operation: task.operation,
      subjectId: task.subjectId,
      status: task.status,
      createdAt: task.createdAt,
      nextCommand: `task submit --task ${task.id}`,
    }));
  return { atRiskWaves, recurringAcceptanceFailures, openTasks };
}

export function timelineFromHistory(
  history: StateHistoryEntry[],
  subjectId: string,
  kind: "init" | "wave",
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  for (const snapshot of history) {
    const eventSubject = subjectOf(snapshot.event.event) ?? taskSubject(snapshot);
    if (!eventSubject || !matchesSubject(kind, subjectId, eventSubject, snapshot.state))
      continue;
    entries.push(...entriesFor(snapshot, eventSubject));
  }
  return entries;
}

export function problemsFromHistory(
  history: StateHistoryEntry[],
  subjectId: string,
  kind: "init" | "wave",
): Problem[] {
  const problems: Problem[] = [];
  const opened = new Map<
    string,
    { subject: string; operation: string; round: number }[]
  >();
  const submitted = new Set<string>();
  const reviews = new Map<
    string,
    { subject: string; operation: string; taskId: string }
  >();
  for (let index = 0; index < history.length; index += 1) {
    const snapshot = history[index];
    if (!snapshot) continue;
    const event = snapshot.event.event;
    const eventSubject = subjectOf(event) ?? taskSubject(snapshot);
    if (eventSubject && !matchesSubject(kind, subjectId, eventSubject, snapshot.state))
      continue;
    const open = event.match(OPEN);
    if (open) {
      const operation = open[1] as string;
      const task = latestTask(snapshot.state, operation, open[2] as string);
      if (!task) continue;
      const key = `${task.subjectId}\0${operation}\0${task.round}`;
      const tasks = opened.get(key) ?? [];
      tasks.push({ subject: task.subjectId, operation, round: task.round });
      opened.set(key, tasks);
      if (tasks.length === 2 && ["spec", "plan", "build"].includes(operation)) {
        problems.push({
          kind: "duplicate-producer",
          subject: task.subjectId,
          operation,
          message: `multiple ${operation} producers opened for round ${task.round}`,
        });
      }
      if (operation.endsWith("-review")) {
        reviews.set(task.id, { subject: task.subjectId, operation, taskId: task.id });
      }
      continue;
    }
    const submit = event.match(SUBMIT);
    if (submit) {
      const task = latestTask(snapshot.state, submit[1] as string, submit[2] as string);
      if (task) submitted.add(task.id);
      reviews.delete(task?.id ?? "");
      continue;
    }
    const terminal = event.match(/^task (cancel|fail) (TASK-.+)$/);
    if (terminal) {
      const task = snapshot.state.tasks.find(
        (candidate) => candidate.id === terminal[2],
      );
      if (
        task &&
        !submitted.has(task.id) &&
        ["spec", "plan", "build"].includes(task.operation)
      ) {
        problems.push({
          kind: "abandoned-producer",
          subject: task.subjectId,
          operation: task.operation,
          taskId: task.id,
          message: `${task.operation} producer was ${terminal[1]} before submission`,
        });
      }
      continue;
    }
    if (index > 0 && reviews.size > 0) {
      for (const review of reviews.values()) {
        if (review.subject === subjectId || kind === "init") {
          problems.push({
            kind: "review-dwell",
            subject: review.subject,
            operation: review.operation,
            taskId: review.taskId,
            message: `${review.operation} remained open across a later state event`,
          });
        }
      }
      reviews.clear();
    }
  }
  return problems;
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

function taskSubject(snapshot: StateHistoryEntry): string | null {
  const taskId = snapshot.event.event.match(/^task (?:cancel|fail) (TASK-.+)$/)?.[1];
  return snapshot.state.tasks.find((task) => task.id === taskId)?.subjectId ?? null;
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
  const terminal = event.event.match(/^task (cancel|fail) (TASK-.+)$/);
  if (terminal) {
    const task = snapshot.state.tasks.find((candidate) => candidate.id === terminal[2]);
    if (!task) return [];
    return [
      {
        subject: task.subjectId,
        operation: task.operation,
        kind: terminal[1] as "cancel" | "fail",
        outcome: task.status,
        timestamp: task.finishedAt ?? event.at,
        taskId: task.id,
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
