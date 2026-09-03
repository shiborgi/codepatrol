import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { type AgentResolution, resolveAgent } from "./agent-catalog.js";
import type { CliResult } from "./cli.js";
import type { loadConfig } from "./config.js";
import {
  type ContextSnapshot,
  type ContextTarget,
  contextProfileArtifact,
  resolveContext,
  unavailableContextProfileArtifact,
} from "./context-provider.js";
import type {
  Operation,
  ProducerOperation,
  ReviewOperation,
  Source,
  State,
} from "./core.js";
import { usage } from "./errors.js";
import { type ExecutionDescriptor, executionDescriptorSchema } from "./execution.js";
import { type Repository, STATE_REF } from "./git.js";
import {
  deriveTaskClass,
  emptyMemory,
  isOrchestratorEnabled,
  loadAgentInventory,
  makeRouteKey,
  policyDigest,
  rankRoutes,
  selectRoutesForFanout,
  taskFeatureDigest,
} from "./orchestrator.js";
import { syncGitHub } from "./remote.js";
import {
  attemptIsTerminal,
  attemptsAgree,
  isValidStoredAttempt,
} from "./review-orchestration.js";
import type { RunContext } from "./run-context.js";
import { getInit, getWave, getWork } from "./selectors.js";
import type { CodePatrolService } from "./service.js";
import { digest, stableJson } from "./shared.js";
import { doctorSignals, problemsFromHistory, timelineFromHistory } from "./trace.js";

export type DispatchContext = {
  command: string;
  action?: string;
  options: Map<string, string>;
  repo: Repository;
  config: ReturnType<typeof loadConfig>;
  service: CodePatrolService;
  ctx: RunContext;
};
export type DispatchHandler = (
  context: DispatchContext,
) => Promise<CliResult> | CliResult;
export type Handler =
  | "setup"
  | "init"
  | "wave"
  | "work"
  | "producer"
  | "review"
  | "task"
  | "ship"
  | "remote"
  | "doctor"
  | "trace"
  | "cleanup";

function required(options: Map<string, string>, name: string): string {
  return options.get(name) ?? usage(`${name} is required`);
}

function ok(value: unknown): CliResult {
  return { exitCode: 0, stdout: `${JSON.stringify(value, null, 2)}\n`, stderr: "" };
}

export const handlers: Record<Handler, DispatchHandler> = {
  init: ({ action, options, service }) =>
    ok(
      action === "create"
        ? service.createInit(required(options, "--title"), options.get("--brief") ?? "")
        : action === "list"
          ? service.list("init")
          : action === "show"
            ? service.show("init", required(options, "--init"))
            : service.resumeInit(required(options, "--init")),
    ),
  wave: ({ action, options, service }) => {
    if (action === "list") return ok(service.list("wave"));
    if (action === "show") return ok(service.show("wave", required(options, "--wave")));
    const operation = required(options, "--operation");
    if (operation !== "plan" && operation !== "build")
      usage("--operation must be plan or build");
    return ok(service.resumeWave(required(options, "--wave"), operation));
  },
  work: ({ action, options, service }) =>
    ok(
      action === "list"
        ? service.list("work")
        : service.show("work", required(options, "--work")),
    ),
  producer: async ({ command, options, repo, config, service, ctx }) => {
    const operation = command as ProducerOperation;
    if (options.has("--executions")) {
      const batch = await executionsBatch(config, operation, options, repo, ctx);
      return ok(
        service.openProducers(
          operation,
          required(options, operation === "spec" ? "--init" : "--wave"),
          batch.selections,
          options.get("--from"),
          undefined,
          batch.descriptors,
        ),
      );
    }
    const subjectId = required(options, operation === "spec" ? "--init" : "--wave");
    const state = repo.readState().state;
    const subjectText =
      operation === "spec"
        ? `${getInit(state, subjectId).title} ${getInit(state, subjectId).brief}`
        : getWave(state, subjectId)
            .workIds.map((w) => getWork(state, w).description)
            .join(" ");
    if (
      isOrchestratorEnabled(config) &&
      !options.has("--agents") &&
      !options.has("--context-profile")
    ) {
      const inventory = await loadAgentInventory(config.agentCatalog, ctx);
      const profiles = config.contextPatrol?.profiles ?? {};
      const profileMetas: Record<string, any> = {};
      for (const [k, v] of Object.entries(profiles))
        profileMetas[k] = {
          supportedOperations: (v as any).supportedOperations,
          routingTags: (v as any).routingTags,
        };
      const taskClass = deriveTaskClass(subjectText, inventory, profileMetas);
      // build eligible routes from inventory + defaults or all profiles that match op
      const orch = config.orchestrator!;
      const eligible: Array<{
        key: string;
        agent: { reference: string; version: string };
        contextProfile: string | null;
        tags: string[];
        isDefault?: boolean;
      }> = [];
      const defaultAgent = config.agentCatalog?.defaults?.[operation];
      const candidateAgents = inventory.filter((a) => a.operations.includes(operation));
      const candidateProfiles = Object.entries(profiles).filter(([_, p]: any) => {
        const ops = p.supportedOperations as string[] | undefined;
        if (ops && ops.length) return ops.includes(operation);
        // legacy: only if default for op
        return config.contextPatrol?.defaults?.[operation] === _;
      });
      if (defaultAgent && operation !== "build") {
        // use default agent + compatible profiles
        const ag = { reference: defaultAgent.agent, version: defaultAgent.version };
        if (candidateProfiles.length === 0) {
          eligible.push({
            key: makeRouteKey({
              agentRef: ag.reference,
              agentVersion: ag.version,
              contextProfile: null,
            }),
            agent: ag,
            contextProfile: null,
            tags: [],
          });
        } else {
          for (const [pname, pmeta] of candidateProfiles) {
            const tags = (pmeta as any).routingTags || [];
            eligible.push({
              key: makeRouteKey({
                agentRef: ag.reference,
                agentVersion: ag.version,
                contextProfile: pname,
              }),
              agent: ag,
              contextProfile: pname,
              tags,
            });
          }
        }
      } else {
        const routeAgents = [...candidateAgents];
        if (
          operation === "build" &&
          defaultAgent &&
          !routeAgents.some(
            (a) =>
              a.reference === defaultAgent.agent && a.version === defaultAgent.version,
          )
        ) {
          routeAgents.push({
            reference: defaultAgent.agent,
            version: defaultAgent.version,
            capabilities: [],
            operations: ["build"],
          });
        }
        for (const a of routeAgents) {
          const ag = { reference: a.reference, version: a.version };
          for (const [pname, pmeta] of candidateProfiles) {
            const tags = [...a.capabilities, ...((pmeta as any).routingTags || [])];
            eligible.push({
              key: makeRouteKey({
                agentRef: ag.reference,
                agentVersion: ag.version,
                contextProfile: pname,
              }),
              agent: ag,
              contextProfile: pname,
              tags,
              isDefault:
                !!defaultAgent &&
                ag.reference === defaultAgent.agent &&
                ag.version === defaultAgent.version,
            });
          }
          if (candidateProfiles.length === 0) {
            eligible.push({
              key: makeRouteKey({
                agentRef: ag.reference,
                agentVersion: ag.version,
                contextProfile: null,
              }),
              agent: ag,
              contextProfile: null,
              tags: a.capabilities,
              isDefault:
                !!defaultAgent &&
                ag.reference === defaultAgent.agent &&
                ag.version === defaultAgent.version,
            });
          }
        }
      }
      const mem = (state as any).routing || emptyMemory();
      const { ranked, confidence, memoryDigest } = rankRoutes(
        eligible,
        taskClass,
        mem,
        orch,
        mem.decisions.length,
      );
      const uncertain = confidence < orch.uncertaintyThreshold;
      const { selected, reason } = selectRoutesForFanout(
        ranked,
        uncertain,
        orch.maxFanout,
        false,
      );
      const taskDigest = taskFeatureDigest(subjectText, taskClass);
      const routeConfigDigest = `sha256:${digest(
        stableJson({
          orchestrator: orch,
          routes: eligible.map(({ key, agent, contextProfile, tags, isDefault }) => ({
            key,
            agent,
            contextProfile,
            tags,
            isDefault: !!isDefault,
          })),
        }),
      )}`;
      const routingDecision = {
        operation,
        policyVersion: orch.policyVersion,
        policyDigest: policyDigest(orch.policyVersion, routeConfigDigest),
        taskFeatureDigest: taskDigest,
        taskClass,
        memoryDigest,
        eligibleRoutes: ranked.map((route) => route.key),
        scoreComponents: ranked[0]?.components ?? [],
        selectedRoutes: selected.map((route) => route.key),
        uncertainty: confidence,
        fanoutReason: reason,
        overrideMode: "none" as const,
      };
      // now resolve each
      const harness = required(options, "--harness");
      const model = options.get("--model") ?? null;
      const selections: any[] = [];
      for (const sel of selected) {
        const resolvedAgent = await resolveAgent(
          config.agentCatalog!,
          { reference: sel.agent.reference, version: sel.agent.version },
          ctx,
        );
        let ctxSnap: ContextSnapshot | undefined;
        if (sel.contextProfile) {
          ctxSnap = await resolveContext(
            config.contextPatrol!,
            sel.contextProfile,
            repo.root,
            contextQuery(operation, options, repo),
            contextAnchor(operation, options, repo, config).target,
            contextAnchor(operation, options, repo, config).baseline,
            ctx,
          );
        }
        selections.push({
          source: {
            harness,
            model,
            agent: resolvedAgent.agent.reference,
            agentVersion: resolvedAgent.agent.version,
            agentDigest: resolvedAgent.agent.digest,
            agentInstructionsDigest: resolvedAgent.instructionsDigest,
          },
          agentInstructions: resolvedAgent.instructions,
          contextSnapshot: ctxSnap,
        });
      }
      return ok(
        service.openProducers(
          operation,
          subjectId,
          selections,
          options.get("--from"),
          undefined,
          undefined,
          routingDecision,
        ),
      );
    }
    const agents = await producerAgents(config, operation, options, ctx);
    const contexts = await taskContexts(config, operation, options, repo, ctx);
    const selections = agents.flatMap((selection) =>
      contexts.map((contextSnapshot) => ({ ...selection, contextSnapshot })),
    );
    return ok(
      service.openProducers(operation, subjectId, selections, options.get("--from")),
    );
  },
  review: async ({ command, options, repo, config, service, ctx }) => {
    const operation = command as ReviewOperation;
    const subjectId = required(
      options,
      operation === "spec-review" ? "--init" : "--wave",
    );
    const live = repo.readState().state;
    const latestRound =
      operation === "spec-review"
        ? getInit(live, subjectId).specRounds.at(-1)
        : operation === "plan-review"
          ? getWave(live, subjectId).planRounds.at(-1)
          : getWave(live, subjectId).buildRounds.at(-1);
    if (
      latestRound?.status === "reviewing" &&
      (latestRound.reviewAttemptIds ?? []).length > 0 &&
      !latestRound.reviewTaskId
    ) {
      const attempts = live.tasks.filter((task) =>
        (latestRound.reviewAttemptIds ?? []).includes(task.id),
      );
      const arbOpen = live.tasks.some(
        (task) =>
          task.id === latestRound.arbitrationTaskId &&
          ["preparing", "open", "blocked"].includes(task.status),
      );
      if (attempts.every(attemptIsTerminal) && !arbOpen) {
        const valid = attempts.filter((task) => isValidStoredAttempt(live, task));
        const minValid = config.orchestrator?.minValidAttempts ?? 1;
        if (valid.length >= minValid && !attemptsAgree(valid)) {
          const retry = await reviewAgent(config, operation, options, ctx);
          return ok(
            service.openArbitration(
              operation,
              subjectId,
              retry.source,
              retry.instructions,
            ),
          );
        }
      }
    }
    let selection = await reviewAgent(config, operation, options, ctx);
    let usedProfiles = contextProfiles(config, operation, options);
    if (
      isOrchestratorEnabled(config) &&
      !options.has("--agents") &&
      !options.has("--context-profile")
    ) {
      // for 14.1 keep singular review if confident; compute one
      const state = repo.readState().state;
      const subjectText = operation.startsWith("spec")
        ? getInit(state, subjectId).title + " " + getInit(state, subjectId).brief
        : getWave(state, subjectId)
            .workIds.map((w: string) => getWork(state, w).description)
            .join(" ");
      const inventory = await loadAgentInventory(config.agentCatalog, ctx);
      const profiles = config.contextPatrol?.profiles ?? {};
      const profileMetas: Record<string, any> = {};
      for (const [k, v] of Object.entries(profiles))
        profileMetas[k] = {
          supportedOperations: (v as any).supportedOperations,
          routingTags: (v as any).routingTags,
        };
      const taskClass = deriveTaskClass(subjectText, inventory, profileMetas);
      const orch = config.orchestrator!;
      const eligible: any[] = [];
      const defaultsAny = (config.agentCatalog?.defaults as any) || {};
      const defaultAgent = defaultsAny[operation];
      const candidateAgents = inventory.filter((a) =>
        a.operations.includes(operation as any),
      );
      const candidateProfiles = Object.entries(profiles).filter(([_, p]: any) => {
        const ops = p.supportedOperations as string[] | undefined;
        return !ops || ops.includes(operation as any);
      });
      if (defaultAgent) {
        const ag = { reference: defaultAgent.agent, version: defaultAgent.version };
        for (const [pname] of candidateProfiles.length
          ? candidateProfiles
          : [["", null]]) {
          eligible.push({
            key: makeRouteKey({
              agentRef: ag.reference,
              agentVersion: ag.version,
              contextProfile: pname || null,
            }),
            agent: ag,
            contextProfile: pname || null,
            tags: [],
          });
        }
      } else if (candidateAgents.length) {
        const first = candidateAgents[0]!;
        const ag = { reference: first.reference, version: first.version };
        eligible.push({
          key: makeRouteKey({
            agentRef: ag.reference,
            agentVersion: ag.version,
            contextProfile: null,
          }),
          agent: ag,
          contextProfile: null,
          tags: [],
        });
      }
      const mem = (state as any).routing || emptyMemory();
      const { ranked, confidence } = rankRoutes(
        eligible.length
          ? eligible
          : [
              {
                key: "default",
                agent: { reference: "agentpatrol/developer", version: "1.0.0" },
                contextProfile: null,
                tags: [],
              },
            ],
        taskClass,
        mem,
        orch,
        mem.decisions.length,
      );
      const uncertain = confidence < orch.uncertaintyThreshold && ranked.length >= 2;
      if (uncertain) {
        const { selected } = selectRoutesForFanout(ranked, true, orch.maxFanout, false);
        const harness = required(options, "--harness");
        const model = options.get("--model") ?? null;
        const query = contextQuery(operation, options, repo);
        const fanout: Array<{
          source: Source;
          agentInstructions?: string;
          contextSnapshot?: ContextSnapshot;
          contextProfileArtifacts?: ReturnType<typeof contextProfileArtifact>[];
        }> = [];
        for (const sel of selected) {
          const resolved = await resolveAgent(
            config.agentCatalog!,
            { reference: sel.agent.reference, version: sel.agent.version },
            ctx,
          );
          const source: Source = {
            harness,
            model,
            agent: resolved.agent.reference,
            agentVersion: resolved.agent.version,
            agentDigest: resolved.agent.digest,
            agentInstructionsDigest: resolved.instructionsDigest,
          };
          let contextSnapshot: ContextSnapshot | undefined;
          let contextProfileArtifacts:
            | ReturnType<typeof contextProfileArtifact>[]
            | undefined;
          if (sel.contextProfile && operation === "build-review") {
            contextProfileArtifacts = await proposalContextArtifacts(
              config,
              options,
              repo,
              ctx,
              sel.contextProfile,
              query,
            );
          } else if (sel.contextProfile) {
            const anchor = contextAnchor(operation, options, repo, config);
            contextSnapshot = await resolveContext(
              config.contextPatrol,
              sel.contextProfile,
              repo.root,
              query,
              anchor.target,
              anchor.baseline,
              ctx,
            );
          }
          fanout.push({
            source,
            agentInstructions: resolved.instructions,
            contextSnapshot,
            contextProfileArtifacts,
          });
        }
        return ok(service.openReviewAttempts(operation, subjectId, fanout));
      }
      const chosen = ranked[0];
      if (chosen) {
        const resolved = await resolveAgent(
          config.agentCatalog!,
          { reference: chosen.agent.reference, version: chosen.agent.version },
          ctx,
        );
        selection = {
          source: {
            harness: required(options, "--harness"),
            model: options.get("--model") ?? null,
            agent: resolved.agent.reference,
            agentVersion: resolved.agent.version,
            agentDigest: resolved.agent.digest,
            agentInstructionsDigest: resolved.instructionsDigest,
          },
          instructions: resolved.instructions,
        };
        if (chosen.contextProfile) {
          usedProfiles = [chosen.contextProfile];
        }
      }
    }
    const anchor = contextAnchor(operation, options, repo, config);
    const query = contextQuery(operation, options, repo);
    const snapshots = await Promise.all(
      usedProfiles.map(async (profile) => {
        if (profile === undefined) return undefined;
        try {
          return await resolveContext(
            config.contextPatrol,
            profile,
            repo.root,
            query,
            anchor.target,
            anchor.baseline,
            ctx,
          );
        } catch (error) {
          return { profile, error };
        }
      }),
    );
    const resolved = snapshots.filter(
      (snapshot): snapshot is ContextSnapshot =>
        snapshot !== undefined && !("error" in snapshot),
    );
    const contextSnapshot = resolved.length === 1 ? resolved[0] : undefined;
    const contextSnapshots = resolved.length > 1 ? resolved : undefined;
    const contextProfileArtifacts =
      usedProfiles.length > 1
        ? snapshots
            .filter((snapshot) => snapshot !== undefined)
            .map((snapshot) =>
              "error" in snapshot
                ? unavailableContextProfileArtifact(
                    snapshot.profile as string,
                    snapshot.error instanceof Error && "code" in snapshot.error
                      ? String(snapshot.error.code)
                      : "CONTEXT_PROVIDER_FAILED",
                  )
                : contextProfileArtifact(snapshot),
            )
        : undefined;
    return ok(
      service.openReview(
        operation,
        subjectId,
        selection.source,
        selection.instructions,
        contextSnapshot,
        contextSnapshots,
        contextProfileArtifacts,
      ),
    );
  },
  task: async ({ action, options, service, ctx }) => {
    if (action === "list") return ok(service.list("task"));
    const taskId = required(options, "--task");
    if (action === "show") return ok(service.showTask(taskId));
    if (action === "submit")
      return ok(
        service.submitTask(taskId, await readJson(ctx, required(options, "--result"))),
      );
    if (action === "cancel") return ok(service.cancelTask(taskId));
    if (action === "fail")
      return ok(service.failTask(taskId, required(options, "--reason")));
    return ok(service.retryTask(taskId));
  },
  ship: async ({ action, options, repo, config, service, ctx }) => {
    const waveId = required(options, "--wave");
    if (action === "show") {
      const resolution = await shipAgent(config, ctx);
      return ok(
        service.composeShipStatus(
          waveId,
          resolution,
          await taskContext(config, "ship", options, repo, ctx),
        ),
      );
    }
    const confirmation = required(options, "--confirm");
    if (confirmation !== action) usage(`Ship ${action} requires --confirm ${action}`);
    const durable =
      action === "accept" ? service.shipAccept(waveId) : service.shipRollback(waveId);
    const pushed = await pushMainAfterShip(repo, config, ctx);
    return {
      ...ok({ ...(durable as Record<string, unknown>), pushMain: pushed.outcome }),
      stderr: pushed.warning ? `${pushed.warning}\n` : "",
    };
  },
  remote: async ({ repo, config, ctx }) => ok(await syncGitHub(repo, config, ctx)),
  trace: ({ options, repo }) => {
    const initId = options.get("--init");
    const waveId = options.get("--wave");
    if (!initId && !waveId) usage("trace requires --init or --wave");
    if (initId && waveId) usage("trace accepts only one of --init or --wave");
    const state = repo.readState().state;
    if (initId) getInit(state, initId);
    else getWave(state, waveId as string);
    const subject = (initId ?? waveId) as string;
    const history = repo.readStateHistory();
    return ok({
      subject,
      entries: timelineFromHistory(history, subject, initId ? "init" : "wave"),
      problems: problemsFromHistory(history, subject, initId ? "init" : "wave"),
      routing: routingTrace(state, subject),
    });
  },
  doctor: ({ repo, config }) => {
    const state = repo.readState();
    return ok({
      ok: true,
      repository: repo.root,
      projectId: repo.projectId,
      stateRef: STATE_REF,
      stateInitialized: Boolean(state.oid),
      sequence: state.state.sequence,
      legacyStatePresent: Boolean(repo.resolveRef("refs/codepatrol/state")),
      managedWorktrees: repo.listManagedWorktrees(),
      shipRecoveryPending: repo.shipRecoveryPending(),
      remoteEnabled: config.remote?.github.enabled ?? false,
      ...doctorSignals(state.state, config.maxReviewReturns),
    });
  },
  cleanup: ({ service }) => ok(service.cleanup()),
  setup: () => usage("setup must be dispatched before configuration loading"),
};

async function executionsBatch(
  config: ReturnType<typeof loadConfig>,
  operation: ProducerOperation,
  options: Map<string, string>,
  repo: Repository,
  ctx: RunContext,
): Promise<{
  selections: Array<{
    source: Source;
    agentInstructions: string;
    contextSnapshot?: ContextSnapshot;
  }>;
  descriptors: ExecutionDescriptor[];
}> {
  for (const flag of ["--harness", "--model", "--context-profile", "--agents"]) {
    if (options.has(flag)) usage(`--executions is mutually exclusive with ${flag}`);
  }
  const raw = options.get("--executions");
  if (!raw) usage("--executions requires a JSON array");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    usage("--executions must be a JSON array");
  }
  if (!Array.isArray(parsed) || parsed.length < 2)
    usage("--executions must be a JSON array of at least two descriptors");
  const descriptors = parsed.map((entry) => {
    const result = executionDescriptorSchema.safeParse(entry);
    if (!result.success) usage("--executions contains an invalid descriptor");
    return result.data;
  });
  const seen = new Set<string>();
  for (const descriptor of descriptors) {
    const key = JSON.stringify(descriptor);
    if (seen.has(key)) usage("--executions contains duplicate descriptors");
    seen.add(key);
  }
  const anchor = contextAnchor(operation, options, repo, config);
  const query = contextQuery(operation, options, repo);
  const selections: Array<{
    source: Source;
    agentInstructions: string;
    contextSnapshot?: ContextSnapshot;
  }> = [];
  for (const descriptor of descriptors) {
    const source: Source = {
      harness: descriptor.harness,
      model: descriptor.model,
      agent: descriptor.agentProfile?.reference ?? null,
      ...(descriptor.agentProfile
        ? {
            agentVersion: descriptor.agentProfile.version,
          }
        : {}),
    };
    let agentInstructions = "";
    if (descriptor.agentProfile) {
      const resolved = await resolveAgent(
        config.agentCatalog,
        descriptor.agentProfile,
        ctx,
      );
      source.agent = resolved.agent.reference;
      source.agentVersion = resolved.agent.version;
      source.agentDigest = resolved.agent.digest;
      source.agentInstructionsDigest = resolved.instructionsDigest;
      agentInstructions = resolved.instructions;
    }
    let contextSnapshot: ContextSnapshot | undefined;
    if (descriptor.contextProfile) {
      contextSnapshot = await resolveContext(
        config.contextPatrol,
        descriptor.contextProfile,
        repo.root,
        query,
        anchor.target,
        anchor.baseline,
        ctx,
      );
    }
    selections.push({ source, agentInstructions, contextSnapshot });
  }
  return { selections, descriptors };
}

async function producerAgents(
  config: ReturnType<typeof loadConfig>,
  operation: ProducerOperation,
  options: Map<string, string>,
  ctx: RunContext,
): Promise<Array<{ source: Source; agentInstructions: string }>> {
  const configured = config.agentCatalog?.defaults[operation];
  const requested =
    options
      .get("--agents")
      ?.split(",")
      .map((entry) => {
        const at = entry.lastIndexOf("@");
        if (at <= 0 || at === entry.length - 1)
          usage("--agents entries must be reference@version");
        return { reference: entry.slice(0, at), version: entry.slice(at + 1) };
      }) ??
    (configured
      ? [{ reference: configured.agent, version: configured.version }]
      : null);
  if (!requested)
    usage("--agents is required when no agentCatalog default is configured");
  const harness = required(options, "--harness");
  const resolved: AgentResolution[] = [];
  for (const request of requested)
    resolved.push(await resolveAgent(config.agentCatalog, request, ctx));
  return resolved.map((entry) => ({
    source: {
      harness,
      model: options.get("--model") ?? null,
      agent: entry.agent.reference,
      agentVersion: entry.agent.version,
      agentDigest: entry.agent.digest,
      agentInstructionsDigest: entry.instructionsDigest,
    },
    agentInstructions: entry.instructions,
  }));
}

async function reviewAgent(
  config: ReturnType<typeof loadConfig>,
  operation: ReviewOperation,
  options: Map<string, string>,
  ctx: RunContext,
): Promise<{ source: Source; instructions?: string }> {
  const base: Source = {
    harness: required(options, "--harness"),
    model: options.get("--model") ?? null,
    agent: null,
  };
  const requested = config.agentCatalog?.defaults[operation];
  if (!requested) return { source: base };
  const resolved = await resolveAgent(
    config.agentCatalog,
    {
      reference: requested.agent,
      version: requested.version,
    },
    ctx,
  );
  return {
    source: {
      ...base,
      agent: resolved.agent.reference,
      agentVersion: resolved.agent.version,
      agentDigest: resolved.agent.digest,
      agentInstructionsDigest: resolved.instructionsDigest,
    },
    instructions: resolved.instructions,
  };
}

async function shipAgent(
  config: ReturnType<typeof loadConfig>,
  ctx: RunContext,
): Promise<AgentResolution | undefined> {
  const requested = config.agentCatalog?.defaults.ship;
  if (!requested) return undefined;
  return resolveAgent(
    config.agentCatalog,
    {
      reference: requested.agent,
      version: requested.version,
    },
    ctx,
  );
}

async function taskContext(
  config: ReturnType<typeof loadConfig>,
  operation: Operation | "ship",
  options: Map<string, string>,
  repo: Repository,
  ctx: RunContext,
): Promise<ContextSnapshot | undefined> {
  const profiles = contextProfiles(config, operation, options);
  if (profiles.length > 1) usage("--context-profile accepts one profile here");
  const profile = profiles[0];
  if (!profile) return undefined;
  const anchor = contextAnchor(operation, options, repo, config);
  return resolveContext(
    config.contextPatrol,
    profile,
    repo.root,
    contextQuery(operation, options, repo),
    anchor.target,
    anchor.baseline,
    ctx,
  );
}

async function taskContexts(
  config: ReturnType<typeof loadConfig>,
  operation: Operation | "ship",
  options: Map<string, string>,
  repo: Repository,
  ctx: RunContext,
): Promise<Array<ContextSnapshot | undefined>> {
  const profiles = contextProfiles(config, operation, options);
  const anchor = contextAnchor(operation, options, repo, config);
  const query = contextQuery(operation, options, repo);
  return Promise.all(
    profiles.map((profile) =>
      profile === undefined
        ? undefined
        : resolveContext(
            config.contextPatrol,
            profile,
            repo.root,
            query,
            anchor.target,
            anchor.baseline,
            ctx,
          ),
    ),
  );
}

const CONTEXT_QUERY_BYTES = 16 * 1024;

function contextQuery(
  operation: Operation | "ship",
  options: Map<string, string>,
  repo: Repository,
): string {
  const state = repo.readState().state;
  const sections: string[] = [];
  if (operation === "spec" || operation === "spec-review") {
    const init = getInit(state, required(options, "--init"));
    sections.push(init.title, init.brief);
  } else {
    const wave = getWave(state, required(options, "--wave"));
    if (operation === "build-review" || operation === "ship") {
      const proposalId =
        operation === "ship"
          ? wave.selectedBuildId
          : wave.buildRounds.at(-1)?.proposalIds[0];
      const candidate = state.proposals.find(
        (proposal) => proposal.id === proposalId,
      )?.candidate;
      if (candidate) sections.push(...candidate.changedPaths);
    }
    for (const workId of wave.workIds) {
      const work = getWork(state, workId);
      sections.push(work.description, ...work.acceptance.map((entry) => entry.text));
    }
  }
  const body = sections
    .map((section) => section.trim())
    .filter((section) => section.length > 0)
    .join("\n");
  const query = `Analyze the relevant code structure, dependencies, source boundaries, changes, and test signals for the requested change.\n${body}`;
  return truncateUtf8(query, CONTEXT_QUERY_BYTES);
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  let end = value.length;
  while (end > 0 && Buffer.byteLength(value.slice(0, end), "utf8") > maxBytes) {
    end -= 1;
  }
  return value.slice(0, end);
}

function contextAnchor(
  operation: Operation | "ship",
  options: Map<string, string>,
  repo: Repository,
  config: ReturnType<typeof loadConfig>,
): { target: ContextTarget; baseline: { oid: string } | undefined } {
  const head: ContextTarget = {
    kind: "commit",
    oid: repo.currentCommit(config.baseBranch),
  };
  if (operation !== "build-review" && operation !== "ship")
    return { target: head, baseline: undefined };
  const state = repo.readState().state;
  const wave = getWave(state, required(options, "--wave"));
  const proposalId =
    operation === "ship"
      ? wave.selectedBuildId
      : wave.buildRounds.at(-1)?.proposalIds[0];
  const candidate = state.proposals.find(
    (proposal) => proposal.id === proposalId,
  )?.candidate;
  if (!candidate) return { target: head, baseline: undefined };
  return {
    target: { kind: "commit", oid: candidate.commit },
    baseline: { oid: candidate.baseCommit },
  };
}

async function proposalContextArtifacts(
  config: ReturnType<typeof loadConfig>,
  options: Map<string, string>,
  repo: Repository,
  ctx: RunContext,
  profile: string,
  query: string,
): Promise<ReturnType<typeof contextProfileArtifact>[]> {
  const state = repo.readState().state;
  const wave = getWave(state, required(options, "--wave"));
  const proposalIds = wave.buildRounds.at(-1)?.proposalIds ?? [];
  const artifacts: ReturnType<typeof contextProfileArtifact>[] = [];
  for (const proposalId of proposalIds) {
    const candidate = state.proposals.find(
      (proposal) => proposal.id === proposalId,
    )?.candidate;
    if (!candidate) continue;
    try {
      const snapshot = await resolveContext(
        config.contextPatrol,
        profile,
        repo.root,
        query,
        { kind: "commit", oid: candidate.commit },
        { oid: candidate.baseCommit },
        ctx,
      );
      artifacts.push({ ...contextProfileArtifact(snapshot), proposalId });
    } catch (error) {
      artifacts.push({
        ...unavailableContextProfileArtifact(
          profile,
          error instanceof Error && "code" in error
            ? String(error.code)
            : "CONTEXT_PROVIDER_FAILED",
        ),
        proposalId,
      });
    }
  }
  return artifacts.sort(
    (left, right) =>
      compareLexical(left.proposalId ?? "", right.proposalId ?? "") ||
      compareLexical(left.profile, right.profile),
  );
}

function contextProfiles(
  config: ReturnType<typeof loadConfig>,
  operation: Operation | "ship",
  options: Map<string, string>,
): Array<string | undefined> {
  const explicit = options.get("--context-profile");
  if (options.has("--context-profile") && !explicit)
    usage("--context-profile must not be empty");
  const profiles = explicit
    ? explicit.split(",").map((profile) => profile.trim())
    : [config.contextPatrol?.defaults[operation]];
  if (explicit && profiles.some((profile) => !profile))
    usage("--context-profile entries must not be empty");
  return profiles
    .map((profile) => (profile === "none" ? undefined : profile))
    .sort((left, right) => compareLexical(left ?? "", right ?? ""));
}

function compareLexical(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function routingTrace(state: State, subject: string): unknown {
  const tasks = state.tasks.filter((task) => task.subjectId === subject);
  const attempts = tasks
    .filter((task) => task.reviewRole === "attempt")
    .map((task) => ({
      taskId: task.id,
      operation: task.operation,
      status: task.status,
      route: `${task.source.agent ?? "none"}:${task.contextSnapshot?.profile ?? "none"}`,
      selected:
        state.tasks.some(
          (other) =>
            other.reviewRole === "arbitration" &&
            other.result &&
            (other.result as { selectedAttemptId?: string }).selectedAttemptId ===
              task.id,
        ) ||
        (task.reviewRole === "attempt" &&
          operationRound(state, task)?.reviewTaskId === task.id),
    }));
  const arbitration = tasks
    .filter((task) => task.reviewRole === "arbitration")
    .map((task) => ({
      taskId: task.id,
      status: task.status,
      selectedAttemptId:
        (task.result as { selectedAttemptId?: string } | null)?.selectedAttemptId ??
        null,
    }));
  const aggregates = (state.routing?.aggregates ?? []).map((entry) => ({
    routeKey: entry.routeKey,
    observationCount: entry.observationCount,
    selectedCount: entry.selectedCount,
    effectivePassCount: entry.effectivePassCount,
  }));
  return { attempts, arbitration, aggregates };
}

function operationRound(
  state: State,
  task: { operation: string; subjectId: string; round: number },
) {
  if (task.operation === "spec-review")
    return getInit(state, task.subjectId).specRounds.find(
      (round) => round.number === task.round,
    );
  const wave = getWave(state, task.subjectId);
  const rounds = task.operation === "plan-review" ? wave.planRounds : wave.buildRounds;
  return rounds.find((round) => round.number === task.round);
}

async function readJson(ctx: RunContext, location: string): Promise<unknown> {
  let raw: string;
  if (location === "-") {
    raw = await ctx.readStdin();
  } else {
    try {
      raw = readFileSync(location, "utf8");
    } catch {
      usage(`cannot read ${location}`);
    }
  }
  try {
    return JSON.parse(raw);
  } catch {
    usage("result is not valid JSON");
  }
}

async function pushMainAfterShip(
  repo: Repository,
  config: ReturnType<typeof loadConfig>,
  ctx: RunContext,
): Promise<{
  outcome:
    | { status: "disabled" }
    | { status: "pushed"; reconciliation: unknown }
    | { status: "failed"; reason: string };
  warning?: string;
}> {
  const github = config.remote?.github;
  if (!(github?.enabled && github.pushMain)) return { outcome: { status: "disabled" } };
  const token = ctx.env(github.tokenEnv) ?? ctx.env("GH_TOKEN");
  if (!token) return failedPush(ctx, `${github.tokenEnv} or GH_TOKEN is required`);
  const temporary = mkdtempSync(resolve(tmpdir(), "codepatrol-push-"));
  try {
    const askpass = resolve(temporary, "askpass.sh");
    writeFileSync(
      askpass,
      '#!/bin/sh\ncase "$1" in *Username*) printf "%s" "x-access-token" ;; *) printf "%s" "$CODEPATROL_GITHUB_TOKEN" ;; esac\n',
    );
    chmodSync(askpass, 0o700);
    const result = spawnSync(
      "git",
      [
        "push",
        "--quiet",
        github.gitRemote,
        `${config.baseBranch}:${config.baseBranch}`,
      ],
      {
        cwd: repo.root,
        encoding: "utf8",
        env: {
          ...ctx.envAll(),
          GIT_ASKPASS: askpass,
          GIT_TERMINAL_PROMPT: "0",
          CODEPATROL_GITHUB_TOKEN: token,
        },
      },
    );
    if (result.status !== 0)
      return failedPush(ctx, result.stderr?.trim() || "git push failed");
    try {
      const reconciliation = await syncGitHub(repo, config, ctx);
      return { outcome: { status: "pushed", reconciliation } };
    } catch (error) {
      return failedPush(
        ctx,
        `post-push reconciliation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function failedPush(
  ctx: RunContext,
  reason: string,
): {
  outcome: { status: "failed"; reason: string };
  warning: string;
} {
  const warning = `ship completed; main push warning: ${reason}`;
  ctx.log.warn(warning);
  return {
    outcome: { status: "failed", reason },
    warning,
  };
}
