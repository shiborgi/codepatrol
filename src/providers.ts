import {
  agentSchema,
  boundedJson,
  type Catalog,
  type Config,
  type ContextProfile,
  catalogSchema,
  contextSchema,
  type Stage,
  type TaskInput,
  validateDigest,
} from "./contracts.js";
import { rpc } from "./rpc.js";

export async function getCatalog(config: Config, cwd: string): Promise<Catalog> {
  return rpc(
    config.providers.agents.catalog,
    { protocolVersion: "1.0" },
    catalogSchema,
    { cwd, limits: config.limits },
  );
}

export function contextRequestFor(stage: Stage, profile: ContextProfile) {
  void stage;
  const budget =
    profile === "overview"
      ? { maxFiles: 30, maxBytes: 24_000, maxDepth: 1 }
      : profile === "architecture"
        ? { maxFiles: 30, maxBytes: 32_000, maxDepth: 3 }
        : profile === "implementation"
          ? { maxFiles: 20, maxBytes: 64_000, maxDepth: 2 }
          : { maxFiles: 20, maxBytes: 48_000, maxDepth: 3 };
  return budget;
}

export async function getContext(
  config: Config,
  input: TaskInput,
  stage: Stage,
  profile: ContextProfile,
) {
  const request = {
    protocolVersion: "1.0",
    root: input.root,
    task: input.task,
    profile,
    paths: input.paths,
    budget: contextRequestFor(stage, profile),
  };
  boundedJson(request, 65_536, "Context request");
  const context = validateDigest(
    await rpc(config.providers.context, request, contextSchema, {
      cwd: input.root,
      limits: config.limits,
    }),
  );
  if (context.profile !== profile) throw new Error("Context profile mismatch");
  return context;
}

export async function resolveAgent(
  config: Config,
  cwd: string,
  catalog: Catalog,
  persona: string,
  profiles: string[],
) {
  profiles = [...new Set(profiles)].sort();
  if (
    !catalog.personas.some((item) => item.id === persona) ||
    profiles.some((id) => !catalog.profiles.some((item) => item.id === id))
  ) {
    throw new Error("Unknown catalog persona or profiles");
  }
  const agent = validateDigest(
    await rpc(
      config.providers.agents.resolve,
      { protocolVersion: "1.0", persona, profiles },
      agentSchema,
      { cwd, limits: config.limits },
    ),
  );
  const expected = new Set([
    ...(catalog.personas.find((item) => item.id === persona)?.skills ?? []),
    ...profiles.flatMap(
      (id) => catalog.profiles.find((item) => item.id === id)?.skills ?? [],
    ),
  ]);
  if (
    agent.catalogVersion !== catalog.catalogVersion ||
    agent.catalogDigest !== catalog.contentDigest ||
    agent.persona !== persona ||
    agent.profiles.join() !== [...profiles].sort().join() ||
    agent.skills.length !== expected.size ||
    agent.skills.some((skill) => !expected.has(skill.id))
  ) {
    throw new Error("Resolved agent does not match catalog route");
  }
  return agent;
}
