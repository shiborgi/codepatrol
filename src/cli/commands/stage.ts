import { loadProfile } from "../../adapters/skill-catalog.js";
import { publishShipOutcome } from "../../application/publication.js";
import type { WorkService } from "../../application/work-service.js";
import { fail } from "../../core/errors.js";
import { parseWaveId, parseWorkId } from "../../core/identifiers.js";
import { requireRecord, requireText } from "../../core/initiative.js";
import { prettyJson } from "../../core/json.js";
import { type AttemptResult, parseAttemptResult, parseTodoList, type Stage, type TodoItem } from "../../core/work.js";
import { optionalFlag, type ParsedArgs, requireFlag } from "../args.js";
import { bestEffortSync, type Context, publicationEnvironment, readJson, workService } from "../context.js";
import { summarizeWork } from "../render.js";

export async function stageCommand(
  stage: Stage,
  sub: string | undefined,
  args: ParsedArgs,
  ctx: Context,
): Promise<number> {
  if (stage === "ship" && optionalFlag(args, "wave") !== undefined) {
    fail("USAGE", "ship is only available for one work at a time");
  }
  if (optionalFlag(args, "wave") !== undefined) {
    return waveStageCommand(stage, sub, args, ctx);
  }
  const service = workService(ctx);
  const workId = requireFlag(args, "work");
  if (sub === "start") {
    const todoFile = requireFlag(args, "todo");
    const todoDocument = (await readJson(todoFile)) as Record<string, unknown>;
    const todo = parseTodoList(todoDocument.todo, "todo");
    const harness = optionalFlag(args, "harness") ?? "none";
    const model = optionalFlag(args, "model");
    const profile = optionalFlag(args, "profile");
    const resolved = profile !== undefined ? loadProfile(ctx.cwd, stage, profile) : undefined;
    const started = await service.start(workId, stage, {
      harness,
      todo,
      ...(model !== undefined ? { model } : {}),
      ...(resolved !== undefined
        ? {
            profile: resolved.profile,
            capabilities: resolved.capabilities,
            compositionDigest: resolved.compositionDigest,
          }
        : {}),
    });
    ctx.io.out(prettyJson({ work: summarizeWork(started.work), attempt: started.attempt, resumed: started.resumed }));
    await bestEffortSync(ctx, { workId });
    return 0;
  }
  if (sub === "complete") {
    const runId = requireFlag(args, "run");
    const resultFile = requireFlag(args, "result");
    const result = parseAttemptResult(await readJson(resultFile));
    const publishFlag = args.flags.get("publish");
    if (publishFlag !== undefined && publishFlag !== true) fail("USAGE", "--publish does not accept a value");
    const publish = publishFlag === true;
    const work = await service.complete(workId, stage, runId, result);
    ctx.io.out(prettyJson({ work: summarizeWork(work), completion: work.completion }));
    if (stage === "ship") {
      await handleRemotePublication(ctx, service, workId, runId, result, publish);
    }
    await bestEffortSync(ctx, { workId });
    return 0;
  }
  fail("USAGE", `unknown ${stage} subcommand ${JSON.stringify(sub)}; use start|complete`);
}

/**
 * Wave-scoped execution of a stage. The todo and result documents carry one
 * entry per Work, keyed by Work id, because the layer is the unit of work.
 */
export async function waveStageCommand(
  stage: Stage,
  sub: string | undefined,
  args: ParsedArgs,
  ctx: Context,
): Promise<number> {
  const service = workService(ctx);
  const waveId = parseWaveId(requireFlag(args, "wave"), "wave");
  if (sub === "start") {
    const document = requireRecord(await readJson(requireFlag(args, "todo")), "todo");
    const todoByWork = new Map<string, TodoItem[]>();
    for (const [workId, value] of Object.entries(requireRecord(document.works, "todo.works"))) {
      const entry = requireRecord(value, `todo.works.${workId}`);
      todoByWork.set(parseWorkId(workId, "todo.works key"), parseTodoList(entry.todo, `todo.works.${workId}.todo`));
    }
    const harness = optionalFlag(args, "harness") ?? "none";
    const model = optionalFlag(args, "model");
    const profile = optionalFlag(args, "profile");
    const resolved = profile !== undefined ? loadProfile(ctx.cwd, stage, profile) : undefined;
    const started = await service.startWave(waveId, stage, {
      harness,
      todoByWork,
      ...(model !== undefined ? { model } : {}),
      ...(resolved !== undefined
        ? {
            profile: resolved.profile,
            capabilities: resolved.capabilities,
            compositionDigest: resolved.compositionDigest,
          }
        : {}),
    });
    ctx.io.out(
      prettyJson({
        wave: started.wave,
        layer: started.layer,
        started: started.started.map((entry) => ({
          work: entry.work.id,
          runId: entry.attempt.runId,
          resumed: entry.resumed,
        })),
      }),
    );
    for (const entry of started.started) await bestEffortSync(ctx, { workId: entry.work.id });
    return 0;
  }
  if (sub === "complete") {
    const document = requireRecord(await readJson(requireFlag(args, "result")), "result");
    const entries = Object.entries(requireRecord(document.works, "result.works")).map(([workId, value]) => {
      const record = requireRecord(value, `result.works.${workId}`);
      // `run` binds the entry to its attempt; the rest is the ordinary
      // attempt result, parsed by the same strict parser as the single form.
      const { run, ...attemptResult } = record;
      return {
        workId: parseWorkId(workId, "result.works key"),
        runId: requireText(run, `result.works.${workId}.run`),
        result: parseAttemptResult(attemptResult),
      };
    });
    const outcome = await service.completeWave(waveId, stage, entries);
    ctx.io.out(
      prettyJson({
        wave: outcome.wave,
        completed: outcome.completed.map((work) => ({
          work: work.id,
          state: work.workflow.state,
          stage: work.workflow.stage,
          completion: work.completion,
        })),
      }),
    );
    for (const work of outcome.completed) await bestEffortSync(ctx, { workId: work.id });
    return 0;
  }
  fail("USAGE", `unknown ${stage} subcommand ${JSON.stringify(sub)}; use start|complete`);
}

export async function handleRemotePublication(
  ctx: Context,
  service: WorkService,
  workId: string,
  runId: string,
  result: AttemptResult,
  publish: boolean,
): Promise<void> {
  const outcome = await publishShipOutcome(publicationEnvironment(ctx), service, {
    workId,
    runId,
    result,
    publishRequested: publish,
  });
  if (outcome.warning !== undefined) ctx.io.err(prettyJson({ warning: outcome.warning }));
}
