import { GitCheckout } from "../../adapters/checkout.js";
import { localGit } from "../../adapters/git.js";
import { StateStore } from "../../adapters/state-store.js";
import { type SpecDocument, SpecService } from "../../application/spec-service.js";
import { WorkService } from "../../application/work-service.js";
import type { AcceptanceResult, Attempt, AttemptResult, Stage, TodoItem, Work } from "../../core/work.js";

export interface TestApp {
  store: StateStore;
  spec: SpecService;
  works: WorkService;
  head(): Promise<string | null>;
  start(workId: string, stage: Stage, todo?: TodoItem[]): Promise<{ work: Work; attempt: Attempt; resumed: boolean }>;
  complete(
    workId: string,
    stage: Stage,
    decision: AttemptResult["decision"],
    extra?: Partial<AttemptResult>,
  ): Promise<Work>;
  runStage(
    workId: string,
    stage: Stage,
    decision: AttemptResult["decision"],
    extra?: Partial<AttemptResult>,
  ): Promise<Work>;
  specStart(initiativeId: string, todo?: TodoItem[]): Promise<{ initiative: string; runId: string }>;
  specComplete(
    initiativeId: string,
    runId: string,
    decision: "apply" | "discard",
    document?: SpecDocument,
  ): Promise<{ initiative: string }>;
}

export function createApp(repoPath: string, counterSeed: number = 0): TestApp {
  let clock = 1_700_000_000_000;
  let counter = counterSeed;
  const now = () => {
    clock += 1000;
    return new Date(clock).toISOString();
  };
  const uuid = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
  const git = localGit(repoPath);
  const head = async () => {
    const result = await git.exec(["rev-parse", "HEAD"], { allowFailure: true });
    return result.code === 0 ? result.stdout.trim() : null;
  };
  const store = new StateStore(git);
  const works = new WorkService(store, now, uuid, new GitCheckout(git));
  const app: TestApp = {
    store,
    spec: new SpecService(store, now, uuid),
    works,
    head,
    start(workId, stage, todo = TODO) {
      return works.start(workId, stage, { harness: "test", todo });
    },
    async complete(workId, stage, decision, extra = {}) {
      const snapshot = await store.read();
      const work = snapshot.works.get(workId);
      const live = work?.attempts.find((attempt) => attempt.status === "active");
      const runId = live?.runId ?? "unknown-run";
      return works.complete(workId, stage, runId, result(decision, stage, extra));
    },
    async runStage(workId, stage, decision, extra = {}) {
      const started = await app.start(workId, stage);
      return works.complete(workId, stage, started.attempt.runId, result(decision, stage, extra));
    },
    async specStart(initiativeId, todo = TODO) {
      const result = await app.spec.start({ initiativeId, todo, harness: "test" });
      return { initiative: result.initiative, runId: result.runId };
    },
    async specComplete(initiativeId, runId, decision, document) {
      const result = await app.spec.complete(
        initiativeId,
        runId,
        {
          decision,
          summary: `spec ${decision}`,
          todo: [
            { id: "t1", status: "done" },
            { id: "t2", status: "done" },
          ],
        },
        document,
      );
      return { initiative: result.initiative.id };
    },
  };
  return app;
}

export function documentOf(
  overrides: Partial<SpecDocument["initiative"]> & {
    works?: SpecDocument["works"];
    waves?: SpecDocument["waves"];
  } = {},
): SpecDocument {
  const { works, waves, ...initiative } = overrides;
  const id = initiative.id ?? "INIT-1";
  const number = id.slice("INIT-".length);
  const resolvedWorks = works ?? [
    {
      id: `WORK-${number}.1.1`,
      wave: `WAVE-${number}.1`,
      title: "First work",
      description: "Do the first thing",
      workType: "task" as const,
      priority: "p2" as const,
      delivery: "no-code" as const,
      acceptance: ["it works"],
      blockedBy: [],
    },
  ];
  return {
    schemaVersion: 1,
    type: "codepatrol-initiative-document",
    initiative: {
      id,
      title: initiative.title ?? "Test initiative",
      intent: initiative.intent ?? "Prove the harness",
    },
    waves: waves ?? wavesFor(resolvedWorks),
    works: resolvedWorks,
  };
}

/** Declares every Wave the given Works reference, so fixtures stay terse. */
export function wavesFor(works: SpecDocument["works"]): SpecDocument["waves"] {
  const ids = [...new Set(works.map((work) => work.wave))].sort();
  return ids.map((waveId) => ({ id: waveId, title: `Wave ${waveId}`, intent: `Deliver ${waveId}` }));
}

export const TODO: TodoItem[] = [
  { id: "t1", title: "do one" },
  { id: "t2", title: "do two" },
];

export function acceptanceOf(
  work: { acceptance: string[] },
  status: AcceptanceResult["status"] = "passed",
): AcceptanceResult[] {
  return work.acceptance.map((_, index) => ({ index, status, summary: `criterion ${index} observed` }));
}

export function result(
  decision: AttemptResult["decision"],
  stage?: Stage,
  extra: Partial<AttemptResult> = {},
): AttemptResult {
  const base: AttemptResult = {
    decision,
    summary: `summary for ${decision}`,
    todo: [
      { id: "t1", status: "done" },
      { id: "t2", status: "done" },
    ],
    ...extra,
  };
  if (stage === "verify" && base.acceptance === undefined) {
    base.acceptance = [{ index: 0, status: "passed", summary: "observed" }];
  }
  return base;
}
