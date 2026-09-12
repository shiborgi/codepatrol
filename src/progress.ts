import { STAGES, type Stage } from "./contracts.js";

export const PROGRESS_PREFIX = "CODEPATROL_EVENT ";

export type ProgressKind =
  | "run_started"
  | "stage_started"
  | "heartbeat"
  | "activity"
  | "model_delta"
  | "stage_decided"
  | "stage_finished"
  | "run_finished";

export type ProgressEvent = {
  protocolVersion: "1.0";
  time: string;
  runId: string;
  kind: ProgressKind;
  stage?: Stage;
  elapsedMs?: number;
  message?: string;
};

const MAX_MESSAGE = 4096;
const PROGRESS_KINDS = new Set<ProgressKind>([
  "run_started",
  "stage_started",
  "heartbeat",
  "activity",
  "model_delta",
  "stage_decided",
  "stage_finished",
  "run_finished",
]);
const EVENT_KEYS = new Set([
  "protocolVersion",
  "time",
  "runId",
  "kind",
  "stage",
  "elapsedMs",
  "message",
]);

function boundedMessage(message: string | undefined) {
  if (!message) return undefined;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Strip terminal control bytes from advisory output.
  const safe = message.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  return safe.length <= MAX_MESSAGE ? safe : `${safe.slice(0, MAX_MESSAGE - 1)}…`;
}

/** Progress is advisory stderr output; durable state and the final stdout JSON stay authoritative. */
export function emitProgress(
  event: Omit<ProgressEvent, "protocolVersion" | "time">,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const value: ProgressEvent = {
    protocolVersion: "1.0",
    time: new Date().toISOString(),
    ...event,
    ...(event.message ? { message: boundedMessage(event.message) } : {}),
  };
  if (environment.CODEPATROL_PROGRESS === "jsonl") {
    process.stderr.write(`${PROGRESS_PREFIX}${JSON.stringify(value)}\n`);
    return;
  }
  if (process.stderr.isTTY || environment.CODEPATROL_PROGRESS === "1") {
    const stage = value.stage ? ` ${value.stage}` : "";
    const elapsed =
      value.elapsedMs === undefined ? "" : ` ${Math.round(value.elapsedMs)}ms`;
    const message = value.message ? `: ${value.message}` : "";
    process.stderr.write(
      `${value.time} ${value.runId}${stage} ${value.kind}${elapsed}${message}\n`,
    );
  }
}

export function isProgressLine(line: string) {
  return line.startsWith(PROGRESS_PREFIX);
}

export function parseProgressLine(line: string): ProgressEvent | undefined {
  if (!isProgressLine(line)) return undefined;
  try {
    const value = JSON.parse(line.slice(PROGRESS_PREFIX.length)) as Record<
      string,
      unknown
    >;
    if (
      !value ||
      typeof value !== "object" ||
      Object.keys(value).some((key) => !EVENT_KEYS.has(key)) ||
      value.protocolVersion !== "1.0" ||
      typeof value.time !== "string" ||
      !Number.isFinite(Date.parse(value.time)) ||
      typeof value.runId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value.runId,
      ) ||
      typeof value.kind !== "string" ||
      !PROGRESS_KINDS.has(value.kind as ProgressKind) ||
      (value.stage !== undefined &&
        !STAGES.includes(value.stage as (typeof STAGES)[number])) ||
      (value.elapsedMs !== undefined &&
        (typeof value.elapsedMs !== "number" ||
          !Number.isFinite(value.elapsedMs) ||
          value.elapsedMs < 0)) ||
      (value.message !== undefined &&
        (typeof value.message !== "string" || value.message.length > MAX_MESSAGE))
    )
      return undefined;
    return value as ProgressEvent;
  } catch {
    return undefined;
  }
}
