import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { contentDigest, digestSchema, usageSchema } from "./contracts.js";
import { type RouteIdentity, routeIdentitySchema, type StageRecord } from "./domain.js";
import { ensureStateDirectory } from "./state.js";

export const MIN_SAMPLES = 3;
export const MAX_HISTORY = 2000;
const MAX_BYTES = 1_048_576;
export const telemetryEventSchema = z
  .object({
    schemaVersion: z.literal(1),
    type: z.literal("stage"),
    runId: z.string().uuid(),
    at: z.string().datetime(),
    route: routeIdentitySchema,
    status: z.enum(["passed", "failed"]),
    feedback: z.enum(["success", "failure", "unknown"]),
    durationMs: z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER),
    agentDigest: digestSchema,
    contextDigest: digestSchema,
    snapshot: digestSchema,
    usage: usageSchema.optional(),
  })
  .strict()
  .refine(
    (event) => event.feedback !== "success" || event.status === "passed",
    "Failed stages cannot be positive evidence",
  );
export type TelemetryEvent = z.infer<typeof telemetryEventSchema>;
export function routeIdentity(route: RouteIdentity): RouteIdentity {
  return {
    stage: route.stage,
    taskClass: route.taskClass,
    persona: route.persona,
    profiles: [...route.profiles],
    contextProfile: route.contextProfile,
    catalogDigest: route.catalogDigest,
  };
}
export function routeKey(route: RouteIdentity): string {
  return contentDigest(routeIdentity(route));
}
export async function readTelemetry(
  root: string,
  enabled = true,
): Promise<TelemetryEvent[]> {
  if (!enabled) return [];
  try {
    await ensureStateDirectory(root);
    const path = join(root, ".codepatrol/v1/telemetry.jsonl");
    if (!(await lstat(path)).isFile()) return [];
    const file = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    let text: string;
    try {
      const info = await file.stat();
      if (!info.isFile()) return [];
      const size = info.size;
      const start = Math.max(0, size - MAX_BYTES);
      const buffer = Buffer.alloc(Math.min(size, MAX_BYTES));
      const { bytesRead } = await file.read(buffer, 0, buffer.length, start);
      text = buffer.subarray(0, bytesRead).toString("utf8");
      if (start) text = text.slice(text.indexOf("\n") + 1);
    } finally {
      await file.close();
    }
    const events: TelemetryEvent[] = [];
    const seen = new Set<string>();
    for (const line of text.split("\n").slice(-MAX_HISTORY - 1)) {
      try {
        const parsed = telemetryEventSchema.safeParse(JSON.parse(line));
        if (!parsed.success) continue;
        const key = `${parsed.data.runId}:${parsed.data.route.stage}`;
        if (seen.has(key)) continue;
        seen.add(key);
        events.push(parsed.data);
      } catch {
        /* Corrupt lines are not observations. */
      }
    }
    return events.slice(-MAX_HISTORY);
  } catch {
    return [];
  }
}

export function historicalAdjustment(route: RouteIdentity, history: TelemetryEvent[]) {
  // Approval and rejection are not externally adjudicated reviewer-quality evidence.
  if (route.stage.endsWith("-review")) return { samples: 0, adjustment: 0 };
  const key = routeKey(route);
  const seen = new Set<string>();
  const observations = history
    .slice(-MAX_HISTORY)
    .filter((item) => {
      const event = telemetryEventSchema.safeParse(item);
      if (
        !event.success ||
        event.data.feedback === "unknown" ||
        routeKey(event.data.route) !== key ||
        seen.has(event.data.runId)
      )
        return false;
      seen.add(event.data.runId);
      return true;
    })
    .slice(-100);
  const samples = observations.length;
  const successes = observations.filter((event) => event.feedback === "success").length;
  const adjustment =
    samples < MIN_SAMPLES
      ? 0
      : Math.max(-0.3, Math.min(0.3, ((successes + 1) / (samples + 2) - 0.5) * 0.6));
  return { samples, adjustment };
}

export async function recordTelemetry(
  root: string,
  enabled: boolean,
  runId: string,
  record: StageRecord,
  feedback: TelemetryEvent["feedback"],
): Promise<void> {
  if (!enabled) return;
  const directory = join(root, ".codepatrol/v1");
  const lockPath = join(directory, "telemetry.lock");
  let lock: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const event = telemetryEventSchema.parse({
      schemaVersion: 1,
      type: "stage",
      runId,
      at: new Date().toISOString(),
      route: routeIdentity(record.route),
      status: record.status,
      feedback: record.stage.endsWith("-review") ? "unknown" : feedback,
      durationMs: record.durationMs,
      agentDigest: record.agent.digest,
      contextDigest: record.context.digest,
      snapshot: record.context.snapshot,
      ...(record.result?.usage ? { usage: record.result.usage } : {}),
    });
    await ensureStateDirectory(root, true);
    lock = await open(lockPath, "wx", 0o600);
    const path = join(directory, "telemetry.jsonl");
    const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return undefined;
    });
    if (info && !info.isFile()) return;
    const size = info?.size ?? 0;
    if (size > MAX_BYTES) {
      const history = (await readTelemetry(root)).slice(-500);
      const temp = join(directory, `telemetry.${randomUUID()}.tmp`);
      const file = await open(temp, "wx", 0o600);
      try {
        try {
          await file.writeFile(
            `${history.map((item) => JSON.stringify(item)).join("\n")}\n`,
          );
        } finally {
          await file.close();
        }
        await rename(temp, path);
      } finally {
        await unlink(temp).catch(() => {});
      }
    }
    const file = await open(
      path,
      constants.O_WRONLY |
        constants.O_APPEND |
        constants.O_CREAT |
        constants.O_NOFOLLOW |
        constants.O_NONBLOCK,
      0o600,
    );
    try {
      if ((await file.stat()).isFile())
        await file.writeFile(`${JSON.stringify(event)}\n`);
    } finally {
      await file.close();
    }
  } catch {
    /* Telemetry is optional, never authoritative execution state. */
  } finally {
    if (lock) {
      await lock.close().catch(() => {});
      await unlink(lockPath).catch(() => {});
    }
  }
}

export async function telemetrySummary(root: string, enabled = true) {
  const events = await readTelemetry(root, enabled);
  const groups = new Map<string, { route: RouteIdentity; events: TelemetryEvent[] }>();
  for (const event of events) {
    const key = routeKey(event.route);
    const group = groups.get(key) ?? { route: event.route, events: [] };
    group.events.push(event);
    groups.set(key, group);
  }
  return {
    protocolVersion: "1.0" as const,
    enabled,
    events: events.length,
    minimumSamples: MIN_SAMPLES,
    routes: [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, { route, events: items }]) => ({
        route,
        ...historicalAdjustment(route, items),
        passed: items.filter((item) => item.status === "passed").length,
        failed: items.filter((item) => item.status === "failed").length,
        meanDurationMs:
          items.reduce((sum, item) => sum + item.durationMs, 0) / items.length,
        reportedUsageSamples: items.filter((item) => item.usage !== undefined).length,
      })),
  };
}
