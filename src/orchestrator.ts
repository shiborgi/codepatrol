import { createHash } from "node:crypto";
import { z } from "zod";
import { type AgentRequest, resolveAgent } from "./agent-catalog.js";
import type { Config } from "./config.js";
import { CodePatrolError, ERROR_CODES } from "./errors.js";
import { invokeJsonResponse } from "./resolver-rpc.js";
import type { RunContext } from "./run-context.js";
import type { Operation, ProducerOperation, ReviewOperation } from "./schemas.js";
import { digest, LIMITS, stableJson } from "./shared.js";

export interface AgentInventoryEntry {
  reference: string;
  version: string;
  capabilities: string[];
  operations: Operation[];
}

export interface ContextProfileRouting {
  supportedOperations?: Operation[];
  routingTags?: string[];
}

export interface OrchestratorConfig {
  policyVersion: string;
  uncertaintyThreshold: number;
  maxFanout: number;
  minObservations: number;
  explorationInterval: number;
  coldStartPrior: number;
  maxObservations: number;
  maxAggregates: number;
}

export interface RouteKey {
  agentRef: string;
  agentVersion: string;
  contextProfile: string | null; // "none" for disabled
}

export function makeRouteKey(r: RouteKey): string {
  const p = r.contextProfile ?? "none";
  return `${r.agentRef}@${r.agentVersion}:${p}`;
}

export interface ScoreComponent {
  name: string;
  value: number;
}

export interface RoutingDecision {
  decisionId: string;
  operation: Operation;
  policyVersion: string;
  policyDigest: string;
  taskFeatureDigest: string;
  taskClass: string;
  memoryDigest: string;
  eligibleRoutes: string[];
  scoreComponents: ScoreComponent[]; // for the selected? per route later
  selectedRoutes: string[];
  uncertainty: number;
  fanoutReason: "confident" | "uncertain" | "exploration" | "explicit";
  overrideMode: "none" | "agents" | "profiles" | "both" | "executions";
  createdAt: string;
}

export interface RoutingObservation {
  observationKey: string;
  decisionId: string;
  routeKey: string;
  taskId: string;
  proposalId: string | null;
  outcome: string;
  hostEffectivePass?: boolean;
  hostRank?: number;
  hostSelected?: boolean;
  hostVerified?: boolean;
  hostReviewScore?: number;
  hostReturnCount?: number;
  durationMs?: number;
  createdAt: string;
}

export interface RoutingAggregate {
  routeKey: string;
  operation: Operation;
  taskClass: string;
  observationCount: number;
  effectivePassCount: number;
  selectedCount: number;
  verifiedCount: number;
  reviewScoreTotal: number;
  returnCount: number;
  lastUpdated: string;
}

export interface RoutingMemory {
  schemaVersion: 1;
  decisions: RoutingDecision[];
  observations: RoutingObservation[];
  aggregates: RoutingAggregate[];
}

export function emptyMemory(): RoutingMemory {
  return { schemaVersion: 1, decisions: [], observations: [], aggregates: [] };
}

export function isOrchestratorEnabled(config: Config): boolean {
  return !!config.orchestrator;
}

export function getOrchestratorConfig(config: Config): OrchestratorConfig | undefined {
  return config.orchestrator;
}

const inventoryResponseSchema = z.object({
  schemaVersion: z.literal(1),
  agents: z.array(
    z.object({
      reference: z.string(),
      name: z.string(),
      version: z.string(),
      capabilities: z.array(z.string()).default([]),
      operations: z.array(z.string()).default([]),
    }),
  ),
});

export async function loadAgentInventory(
  catalog: NonNullable<Config["agentCatalog"]> | undefined,
  ctx: RunContext,
): Promise<AgentInventoryEntry[]> {
  if (!catalog) return [];
  const [command] = catalog.argv;
  if (!command) return [];
  try {
    const parsed = await invokeJsonResponse(
      command,
      ["list", "--json"],
      { schemaVersion: 1 },
      {
        timeoutMs: catalog.timeoutMs || 10000,
        maxOutputBytes: 256 * 1024,
        maxErrorBytes: 16 * 1024,
        unavailableCode: ERROR_CODES.AGENT_RESOLVER_UNAVAILABLE,
        failedCode: ERROR_CODES.AGENT_RESOLVER_FAILED,
        timeoutCode: ERROR_CODES.AGENT_RESOLVER_TIMEOUT,
        tooLargeCode: ERROR_CODES.AGENT_RESOLVER_RESPONSE_TOO_LARGE,
        unavailableMessage: (m) => `inventory unavailable: ${m}`,
        failedMessage: (s, st) => s || `list failed ${st}`,
        timeoutMessage: (t) => `list timeout ${t}`,
        tooLargeMessage: (b) => `list too large`,
        error: (c, m) => new CodePatrolError(c as keyof typeof ERROR_CODES, m),
      },
      inventoryResponseSchema,
      ERROR_CODES.AGENT_RESOLVER_INVALID_RESPONSE,
    );
    return parsed.agents.map((a: any) => ({
      reference: a.reference,
      version: a.version,
      capabilities: a.capabilities || [],
      operations: (a.operations || []) as Operation[],
    }));
  } catch (e) {
    ctx.log.warn(
      `agent inventory load failed, orchestration may be limited: ${String(e)}`,
    );
    return [];
  }
}

export function deriveTaskClass(
  subjectText: string,
  inventory: AgentInventoryEntry[],
  profiles: Record<string, ContextProfileRouting>,
): string {
  const tokens = (subjectText.toLowerCase().match(/[a-z0-9_.-]{2,}/g) || []).slice(
    0,
    100,
  );
  const candidates: string[] = [];
  for (const inv of inventory) {
    for (const cap of inv.capabilities) {
      if (tokens.includes(cap.toLowerCase())) candidates.push(cap.toLowerCase());
    }
    for (const op of inv.operations) {
      if (tokens.includes(String(op).toLowerCase()))
        candidates.push(String(op).toLowerCase());
    }
  }
  for (const [name, meta] of Object.entries(profiles)) {
    if (meta.routingTags) {
      for (const tag of meta.routingTags) {
        if (tokens.includes(tag.toLowerCase())) candidates.push(tag.toLowerCase());
      }
    }
  }
  if (candidates.length === 0) return "general";
  candidates.sort();
  return candidates[0]!;
}

export function taskFeatureDigest(subjectText: string, taskClass: string): string {
  // hash the rest of subject, but keep only class separate
  const norm = subjectText.replace(/\s+/g, " ").trim().slice(0, 2048);
  return `sha256:${digest(stableJson({ taskClass, subject: norm }))}`;
}

export function policyDigest(policyVersion: string, configDigest: string): string {
  return `sha256:${digest(stableJson({ policyVersion, configDigest }))}`;
}

export interface RouteCandidate {
  key: string;
  agent: { reference: string; version: string };
  contextProfile: string | null;
  score: number;
  components: ScoreComponent[];
  observationCount: number;
}

export function computeConfidence(scores: number[], threshold: number): number {
  if (scores.length < 2) return threshold;
  const sorted = [...scores].sort((a, b) => b - a);
  return (sorted[0] ?? 0) - (sorted[1] ?? 0);
}

export function isUncertain(confidence: number, threshold: number): boolean {
  return confidence < threshold;
}

export function rankRoutes(
  eligible: Array<{
    key: string;
    agent: { reference: string; version: string };
    contextProfile: string | null;
    tags: string[];
  }>,
  taskClass: string,
  memory: RoutingMemory,
  orch: OrchestratorConfig,
  decisionCount: number,
): { ranked: RouteCandidate[]; confidence: number; memoryDigest: string } {
  const memByKey = new Map<string, RoutingAggregate>();
  for (const a of memory.aggregates) memByKey.set(a.routeKey, a);

  const memDigest = `sha256:${digest(stableJson(memory.aggregates.map((a) => ({ k: a.routeKey, c: a.observationCount })).sort((x, y) => x.k.localeCompare(y.k))))}`;

  const scored: RouteCandidate[] = eligible.map((e) => {
    const agg = memByKey.get(e.key);
    const obsCount = agg?.observationCount ?? 0;
    let capFit = 0;
    if (taskClass !== "general" && e.tags.some((t) => t.toLowerCase() === taskClass))
      capFit = 10;
    let prior = 0;
    if (obsCount < orch.minObservations) prior = orch.coldStartPrior;
    let pass = 0,
      sel = 0,
      ver = 0;
    if (obsCount >= orch.minObservations && agg) {
      pass = agg.effectivePassCount;
      sel = agg.selectedCount;
      ver = agg.verifiedCount;
    }
    const total = capFit + prior + pass + sel + ver;
    const components: ScoreComponent[] = [
      { name: "capabilityFit", value: capFit },
      { name: "coldStartPrior", value: prior },
      { name: "effectivePassCount", value: pass },
      { name: "selectedCount", value: sel },
      { name: "verifiedCount", value: ver },
    ];
    return {
      key: e.key,
      agent: e.agent,
      contextProfile: e.contextProfile,
      score: total,
      components,
      observationCount: obsCount,
    };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // lexical tie break
    if (a.agent.reference !== b.agent.reference)
      return a.agent.reference.localeCompare(b.agent.reference);
    const pa = a.contextProfile ?? "none";
    const pb = b.contextProfile ?? "none";
    if (pa !== pb) return pa.localeCompare(pb);
    return a.key.localeCompare(b.key);
  });

  let conf = computeConfidence(
    scored.map((s) => s.score),
    orch.uncertaintyThreshold,
  );
  if (scored.length < 2) conf = orch.uncertaintyThreshold;

  // exploration
  let reason: "confident" | "uncertain" | "exploration" =
    conf < orch.uncertaintyThreshold ? "uncertain" : "confident";
  if (
    reason === "confident" &&
    decisionCount > 0 &&
    decisionCount % orch.explorationInterval === 0
  ) {
    // find first under sampled not in top
    const under = scored.findIndex((s) => s.observationCount < orch.minObservations);
    if (under > 0 && under < orch.maxFanout) {
      // move it into selection window? for now leave ranked, fanout will pick
      reason = "exploration";
    }
  }

  return { ranked: scored, confidence: conf, memoryDigest: memDigest };
}

export function selectRoutesForFanout(
  ranked: RouteCandidate[],
  uncertain: boolean,
  maxFanout: number,
  explicit: boolean,
): { selected: RouteCandidate[]; reason: RoutingDecision["fanoutReason"] } {
  if (explicit) {
    return { selected: ranked.slice(0, 1), reason: "explicit" };
  }
  if (!uncertain) {
    return { selected: ranked.slice(0, 1), reason: "confident" };
  }
  const n = Math.min(maxFanout, Math.max(2, ranked.length));
  return { selected: ranked.slice(0, n), reason: "uncertain" };
}

export function buildExecutionDescriptors(
  selected: RouteCandidate[],
  harness: string,
  model: string | null,
): Array<{
  agent: { reference: string; version: string };
  contextProfile: string | null;
}> {
  // caller will build full
  return selected.map((s) => ({ agent: s.agent, contextProfile: s.contextProfile }));
}

export function computeMemoryDigest(mem: RoutingMemory): string {
  const norm = {
    d: mem.decisions.length,
    o: mem.observations.length,
    a: mem.aggregates
      .map((a) => [a.routeKey, a.observationCount])
      .sort((x, y) => (x[0] as string).localeCompare(y[0] as string)),
  };
  return `sha256:${digest(stableJson(norm))}`;
}

export function compactMemory(
  mem: RoutingMemory,
  maxObs: number,
  maxAgg: number,
): RoutingMemory {
  let obs = [...mem.observations];
  if (obs.length > maxObs) {
    obs.sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) ||
        a.observationKey.localeCompare(b.observationKey),
    );
    obs = obs.slice(obs.length - maxObs);
  }
  let aggs = [...mem.aggregates];
  if (aggs.length > maxAgg) {
    aggs.sort(
      (a, b) =>
        a.observationCount - b.observationCount || a.routeKey.localeCompare(b.routeKey),
    );
    aggs = aggs.slice(aggs.length - maxAgg);
  }
  return { ...mem, observations: obs, aggregates: aggs };
}

export function upsertAggregate(
  mem: RoutingMemory,
  routeKey: string,
  operation: Operation,
  taskClass: string,
  delta: Partial<RoutingAggregate>,
): void {
  let agg = mem.aggregates.find(
    (a) =>
      a.routeKey === routeKey && a.operation === operation && a.taskClass === taskClass,
  );
  if (!agg) {
    agg = {
      routeKey,
      operation,
      taskClass,
      observationCount: 0,
      effectivePassCount: 0,
      selectedCount: 0,
      verifiedCount: 0,
      reviewScoreTotal: 0,
      returnCount: 0,
      lastUpdated: new Date().toISOString(),
    };
    mem.aggregates.push(agg);
  }
  if (delta.observationCount) agg.observationCount += delta.observationCount;
  if (delta.effectivePassCount) agg.effectivePassCount += delta.effectivePassCount;
  if (delta.selectedCount) agg.selectedCount += delta.selectedCount;
  if (delta.verifiedCount) agg.verifiedCount += delta.verifiedCount;
  if (delta.reviewScoreTotal) agg.reviewScoreTotal += delta.reviewScoreTotal;
  if (delta.returnCount) agg.returnCount += delta.returnCount;
  agg.lastUpdated = new Date().toISOString();
}

export function makeObservationKey(
  decisionId: string,
  routeKey: string,
  outcome: string,
  subjectId: string,
): string {
  return `${decisionId}:${routeKey}:${outcome}:${subjectId}`;
}
