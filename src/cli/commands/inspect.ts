import { ImproveService } from "../../application/improve-service.js";
import { fail } from "../../core/errors.js";
import { parseWorkId } from "../../core/identifiers.js";
import { initiativeStatus, requireRecord, requireText } from "../../core/initiative.js";
import { canonicalJson, prettyJson } from "../../core/json.js";
import { projectNextStepOf, projectStatusOf } from "../../core/projection.js";
import { parseVerdict, type Wave } from "../../core/wave.js";
import { compareWorkIdsCanonically, waveExecutionLayers } from "../../core/wave-execution.js";
import { recordWaveVerdict, waveStatusOf, worksOfWave } from "../../core/wave-status.js";
import { optionalFlag, type ParsedArgs, repeatedFlag, requireFlag } from "../args.js";
import { bestEffortSync, type Context, readJson, snapshot, workService } from "../context.js";
import { renderImprovementReport, summarizeWork } from "../render.js";

export async function initiativeCommand(sub: string | undefined, rest: string[], ctx: Context): Promise<number> {
  const state = await snapshot(ctx);
  if (sub === "list") {
    const initiatives = [...state.initiatives.values()].sort((a, b) => a.id.localeCompare(b.id));
    const works = [...state.works.values()];
    ctx.io.out(
      prettyJson({
        initiatives: initiatives.map((initiative) => ({
          id: initiative.id,
          title: initiative.definitionState === "defined" ? initiative.title : undefined,
          status: initiativeStatus(initiative, works),
          definitionState: initiative.definitionState,
          currentSpecRevision: initiative.currentSpecRevision,
          works: works.filter((work) => work.initiative === initiative.id).length,
        })),
      }),
    );
    return 0;
  }
  if (sub === "show") {
    const id = rest[0];
    if (id === undefined) fail("USAGE", "initiative show requires an id");
    const initiative = state.initiatives.get(id);
    if (initiative === undefined) fail("NOT_FOUND", `initiative ${id} does not exist`);
    const works = [...state.works.values()]
      .filter((work) => work.initiative === id)
      .sort((a, b) => compareWorkIdsCanonically(a.id, b.id));
    ctx.io.out(
      prettyJson({
        initiative: { ...initiative, status: initiativeStatus(initiative, works) },
        works: works.map(summarizeWork),
      }),
    );
    return 0;
  }
  fail("USAGE", `unknown initiative subcommand ${JSON.stringify(sub)}`);
}

export async function waveCommand(
  sub: string | undefined,
  rest: string[],
  ctx: Context,
  args: ParsedArgs,
): Promise<number> {
  if (sub === "list") {
    const snapshot = await ctx.store.read();
    const initiativeId = optionalFlag(args, "initiative");
    const waves = [...snapshot.waves.values()]
      .filter((wave) => initiativeId === undefined || wave.initiative === initiativeId)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((wave) => waveStatusOf(wave, snapshot.works.values()));
    ctx.io.out(prettyJson({ waves }));
    return 0;
  }

  if (sub === "show") {
    const id = rest[0];
    if (id === undefined) fail("USAGE", "wave show requires <id>");
    const snapshot = await ctx.store.read();
    const wave = snapshot.waves.get(id);
    if (wave === undefined) fail("NOT_FOUND", `wave ${id} does not exist`);
    const works = worksOfWave(id, snapshot.works.values()).map((work) => ({
      id: work.id,
      title: work.title,
      state: work.workflow.state,
      stage: work.workflow.stage,
      status: projectStatusOf(work),
      nextStep: projectNextStepOf(work),
      outcome: work.completion?.outcome ?? null,
    }));
    // Layering can refuse (an unaccepted blocker outside the Wave); showing a
    // Wave must never fail because of it, so the reason is reported instead.
    let layers: string[][] | undefined;
    let layerRefusal: string | undefined;
    try {
      layers = waveExecutionLayers(id, snapshot.works.values()).map((layer) => layer.map((work) => work.id));
    } catch (error) {
      layerRefusal = error instanceof Error ? error.message : String(error);
    }
    ctx.io.out(
      prettyJson({
        wave: { ...wave, ...waveStatusOf(wave, snapshot.works.values()) },
        works,
        ...(layers !== undefined ? { layers } : { layers: [], layersUnavailable: layerRefusal }),
      }),
    );
    return 0;
  }

  if (sub === "verdict") {
    const id = requireFlag(args, "wave");
    const file = requireFlag(args, "result");
    const parsed = parseVerdict(
      { ...((await readJson(file)) as Record<string, unknown>), finalizedAt: ctx.now() },
      "verdict",
    );
    let recorded: Wave | undefined;
    await ctx.store.transact((snapshot) => {
      const wave = snapshot.waves.get(id);
      if (wave === undefined) fail("NOT_FOUND", `wave ${id} does not exist`);
      recorded = recordWaveVerdict(wave, snapshot.works.values(), parsed, ctx.now());
      if (recorded === wave) return { message: "codepatrol: wave verdict noop" };
      const waves = new Map<string, Wave>();
      waves.set(id, recorded);
      return { message: `codepatrol: wave verdict ${id} ${parsed.outcome}`, waves };
    });
    ctx.io.out(prettyJson({ wave: id, verdict: (recorded as Wave).verdict }));
    return 0;
  }

  fail("USAGE", `unknown wave subcommand ${JSON.stringify(sub)}; use list|show|verdict`);
}

export async function workCommand(
  sub: string | undefined,
  rest: string[],
  ctx: Context,
  args: ParsedArgs,
): Promise<number> {
  const service = workService(ctx);
  if (sub === "list") {
    const works = await service.listWorks();
    ctx.io.out(prettyJson({ works: works.map(summarizeWork) }));
    return 0;
  }
  if (sub === "show") {
    const id = rest[0];
    if (id === undefined) fail("USAGE", "work show requires an id");
    const view = await service.showWork(id);
    ctx.io.out(prettyJson(view));
    return 0;
  }
  if (sub === "graph") {
    const works = await service.listWorks();
    ctx.io.out(
      prettyJson({
        works: works.map((work) => ({
          id: work.id,
          state: work.workflow.state,
          stage: work.workflow.stage,
          blockedBy: work.blockedBy,
        })),
      }),
    );
    return 0;
  }
  if (sub === "reblock") {
    const id = optionalFlag(args, "work");
    if (id === undefined) fail("USAGE", "work reblock requires --work <id>");
    const blockedBy = repeatedFlag(args, "blocked-by").map((entry) => parseWorkId(entry, "--blocked-by"));
    const reasonFile = requireFlag(args, "reason");
    const reason = requireRecord(await readJson(reasonFile), "reason");
    const summary = requireText(reason.summary, "reason.summary");
    const authority = requireText(reason.authority, "reason.authority");
    const work = await service.reblock(id, blockedBy, { summary, authority });
    ctx.io.out(prettyJson({ work: summarizeWork(work), dependencyRevisions: work.dependencyRevisions }));
    await bestEffortSync(ctx, { workId: id });
    return 0;
  }
  if (sub === "evidence") {
    const id = rest[0];
    if (id === undefined) fail("USAGE", "work evidence requires an id");
    const view = await service.showWork(id);
    const head = await ctx.git.exec(["rev-parse", "HEAD"], { allowFailure: true });
    const currentHead = head.code === 0 ? head.stdout.trim() : null;
    const entries: Record<string, unknown>[] = [];
    for (const attempt of view.work.attempts) {
      const commits = {
        baseCommit: attempt.evidence?.baseCommit,
        candidateCommit: attempt.evidence?.candidateCommit,
        finalCommit: attempt.evidence?.finalCommit,
      };
      for (const [kind, commit] of Object.entries(commits)) {
        if (commit === undefined) continue;
        const exists = await ctx.git.exec(["cat-file", "-e", `${commit}^{commit}`], { allowFailure: true });
        entries.push({
          stage: attempt.stage,
          attempt: attempt.attempt,
          kind,
          commit,
          available: exists.code === 0,
          isHead: currentHead === commit,
          // A Change anchored on a base the branch has moved past is stale:
          // with wave-parallel builds this is the normal consequence of a
          // sibling shipping first, and it must be visible before Ship refuses.
          ...(kind === "baseCommit" ? { baseStale: currentHead !== null && currentHead !== commit } : {}),
        });
      }
    }
    ctx.io.out(prettyJson({ work: id, evidence: entries }));
    return 0;
  }
  fail("USAGE", `unknown work subcommand ${JSON.stringify(sub)}`);
}

export async function improveCommand(sub: string | undefined, args: ParsedArgs, ctx: Context): Promise<number> {
  if (sub !== "inspect") {
    fail("USAGE", `unknown improve subcommand ${JSON.stringify(sub)}; use inspect`);
  }
  const service = new ImproveService(ctx.store, ctx.now);
  const initiative = optionalFlag(args, "initiative");
  const since = optionalFlag(args, "since");
  const format = optionalFlag(args, "format");

  const report = await service.inspect({
    ...(initiative !== undefined ? { initiative } : {}),
    ...(since !== undefined ? { since } : {}),
  });

  if (format === "json") {
    ctx.io.out(canonicalJson(report));
  } else {
    ctx.io.out(renderImprovementReport(report as unknown as Record<string, unknown>));
  }
  return 0;
}
