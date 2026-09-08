import {
  type Catalog,
  type ContextProfile,
  MAX_ROUTE_ALTERNATIVES,
  type Stage,
} from "./contracts.js";
import type { Route, TaskClass } from "./domain.js";
import { historicalAdjustment, MIN_SAMPLES, type TelemetryEvent } from "./telemetry.js";

export const CONTEXT_PROFILES: Record<Stage, ContextProfile> = {
  spec: "overview",
  "spec-review": "review",
  plan: "architecture",
  "plan-review": "review",
  build: "implementation",
  "build-review": "review",
  ship: "review",
};
export function classifyTask(task: string): TaskClass {
  for (const [kind, pattern] of [
    ["security", /\b(security|vulnerability|auth|xss|csrf)\b/i],
    ["bugfix", /\b(fix|repair|bug|broken|regression)\b/i],
    ["refactor", /\b(refactor|restructure|simplify)\b/i],
    ["test", /\b(test|tests|coverage)\b/i],
    ["docs", /\b(docs|documentation|readme)\b/i],
    ["feature", /\b(add|implement|create|feature|build)\b/i],
  ] as const)
    if (pattern.test(task)) return kind;
  return "maintenance";
}
export function contextProfileFor(
  stage: Stage,
  task: string,
  _signals: string[],
): { profile: ContextProfile; reasons: string[] } {
  const taskClass = classifyTask(task);
  const structuralTask =
    taskClass === "refactor" ||
    /\b(refactor|restructure|architecture|architectural|structural|module boundaries|dependency graph)\b/i.test(
      task,
    );
  if (structuralTask && stage === "spec") {
    return {
      profile: "architecture",
      reasons: [
        "Context architecture serves spec: structural/refactor task selects architecture context",
      ],
    };
  }
  if (
    stage === "plan" &&
    !structuralTask &&
    taskClass === "bugfix" &&
    /\b(form|function|method|handler|validation|component|single|localized|focused)\b/i.test(
      task,
    )
  ) {
    return {
      profile: "implementation",
      reasons: [
        "Context implementation serves plan: focused nonstructural bugfix selects implementation context",
      ],
    };
  }
  const profile = CONTEXT_PROFILES[stage];
  return {
    profile,
    reasons: [`Context ${profile} serves ${stage}: fixed stage profile`],
  };
}
function matches(text: string, signal: string): boolean {
  const escaped = signal.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i").test(text);
}
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
export function selectRoute(
  catalog: Catalog,
  stage: Stage,
  task: string,
  signals: string[],
  history: TelemetryEvent[] = [],
): Route {
  // Choose task-appropriate context first, so alternate profiles cannot evade learned failures.
  const context = contextProfileFor(stage, task, signals);
  const relevant = catalog.profiles
    .filter(
      (profile) =>
        profile.id !== "general" &&
        [profile.id, ...profile.signals].some(
          (signal) =>
            matches(task, signal) ||
            signals.some((tag) => tag.toLowerCase() === signal.toLowerCase()),
        ),
    )
    .sort((a, b) => compareIds(a.id, b.id));
  const choices = [
    ["general"],
    ...(relevant.length ? [relevant.map((profile) => profile.id)] : []),
  ];
  const catalogDigest = catalog.contentDigest;
  const candidates = catalog.personas
    .filter((persona) => persona.stages.includes(stage))
    .flatMap((persona) =>
      choices.map((profiles) => {
        const identity = {
          stage,
          taskClass: classifyTask(task),
          persona: persona.id,
          profiles,
          contextProfile: context.profile,
          catalogDigest,
        };
        const { samples, adjustment } = historicalAdjustment(identity, history);
        const specialized = profiles[0] !== "general";
        const baseScore = specialized ? 1.15 : 1;
        return {
          ...identity,
          baseScore,
          adjustment,
          score: baseScore + adjustment,
          samples,
          reasons: [
            `Persona ${persona.id} is eligible for ${stage}`,
            specialized
              ? `Task/stack signals match profiles: ${profiles.join(", ")}`
              : "General profile is an eligible baseline",
            ...context.reasons,
            samples < MIN_SAMPLES
              ? `History: ${samples}/${MIN_SAMPLES} minimum observations; no adjustment`
              : `History: ${samples} observations, bounded adjustment ${adjustment.toFixed(3)}`,
          ],
        };
      }),
    )
    .sort(
      (a, b) =>
        b.score - a.score ||
        compareIds(a.persona, b.persona) ||
        compareIds(a.profiles.join(), b.profiles.join()),
    );
  const selected = candidates[0];
  if (!selected) throw new Error(`No persona eligible for ${stage}`);
  return { ...selected, alternatives: candidates.slice(1, MAX_ROUTE_ALTERNATIVES + 1) };
}
