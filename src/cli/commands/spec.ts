import { loadProfile } from "../../adapters/skill-catalog.js";
import { parseDocument, type SpecDocument } from "../../application/spec-service.js";
import { fail } from "../../core/errors.js";
import { optionalText, requireRecord, requireText } from "../../core/initiative.js";
import { prettyJson } from "../../core/json.js";
import { parseTodoList } from "../../core/work.js";
import { optionalFlag, type ParsedArgs, requireFlag } from "../args.js";
import { bestEffortSync, type Context, readJson, specService } from "../context.js";
import { summarizeWork } from "../render.js";

export async function specCommand(sub: string | undefined, args: ParsedArgs, ctx: Context): Promise<number> {
  const service = specService(ctx);

  if (sub === "start") {
    const initiativeId = requireFlag(args, "initiative");
    const todoFile = requireFlag(args, "todo");
    const todoDocument = (await readJson(todoFile)) as Record<string, unknown>;
    const todo = parseTodoList(todoDocument.todo, "todo");
    const harness = optionalFlag(args, "harness") ?? "none";
    const model = optionalFlag(args, "model");
    const profile = optionalFlag(args, "profile");
    const resolved = profile !== undefined ? loadProfile(ctx.cwd, "spec", profile) : undefined;
    const result = await service.start({
      initiativeId,
      todo,
      harness,
      ...(model !== undefined ? { model } : {}),
      ...(resolved !== undefined
        ? {
            profile: resolved.profile,
            capabilities: resolved.capabilities,
            compositionDigest: resolved.compositionDigest,
          }
        : {}),
    });
    ctx.io.out(prettyJson(result));
    return 0;
  }

  if (sub === "validate") {
    const initiativeId = requireFlag(args, "initiative");
    const runId = requireFlag(args, "run");
    const file = parseDocument(await readJson(requireFlag(args, "file")));
    const result = await service.validate(initiativeId, runId, file);
    ctx.io.out(prettyJson({ valid: result.valid, initiative: result.initiative, plan: result.plan }));
    return 0;
  }

  if (sub === "complete") {
    const initiativeId = requireFlag(args, "initiative");
    const runId = requireFlag(args, "run");
    const resultFile = requireFlag(args, "result");
    const result = parseSpecResult(await readJson(resultFile));
    const filePath = optionalFlag(args, "file");
    let file: SpecDocument | undefined;
    if (filePath !== undefined) {
      file = parseDocument(await readJson(filePath));
    }
    const outcome = await service.complete(initiativeId, runId, result, file);
    ctx.io.out(
      prettyJson({
        initiative: outcome.initiative.id,
        definitionState: outcome.initiative.definitionState,
        revision: outcome.revision?.revision,
        works: [...outcome.works.keys()],
      }),
    );
    if (result.decision === "apply" && outcome.initiative.definitionState === "defined") {
      await bestEffortSync(ctx, { initiativeId: outcome.initiative.id });
    }
    return 0;
  }

  if (sub === "show") {
    const initiativeId = requireFlag(args, "initiative");
    const revisionStr = optionalFlag(args, "revision");
    const revision = revisionStr !== undefined ? Number(revisionStr) : undefined;
    if (revisionStr !== undefined && (!Number.isInteger(revision!) || revision! < 1)) {
      fail("USAGE", "--revision must be a positive integer");
    }
    const shown = await service.show(initiativeId, revision);
    ctx.io.out(prettyJson({ initiative: shown.initiative, works: shown.works.map(summarizeWork) }));
    return 0;
  }

  if (sub === "history") {
    const initiativeId = requireFlag(args, "initiative");
    const history = await service.history(initiativeId);
    ctx.io.out(prettyJson(history));
    return 0;
  }

  fail("USAGE", `unknown spec subcommand ${JSON.stringify(sub)}; use start|validate|complete|show|history`);
}

export function parseSpecResult(value: unknown) {
  const record = requireRecord(value, "spec result");
  const decision = record.decision;
  if (decision !== "apply" && decision !== "discard") {
    fail("INVALID_INPUT", "spec result.decision must be apply|discard");
  }
  const todo = requireRecord(record, "spec result").todo;
  if (!Array.isArray(todo)) fail("INVALID_INPUT", "spec result.todo must be an array");
  return {
    decision: decision as "apply" | "discard",
    summary: requireText(record.summary, "spec result.summary"),
    todo: todo.map((entry, index) => {
      const rec = requireRecord(entry, `spec result.todo[${index}]`);
      const status = rec.status;
      if (status !== "done" && status !== "dropped")
        fail("INVALID_INPUT", `spec result.todo[${index}].status must be done|dropped`);
      const item: { id: string; status: "done" | "dropped"; note?: string } = {
        id: requireText(rec.id, `spec result.todo[${index}].id`),
        status: status as "done" | "dropped",
      };
      const note = optionalText(rec.note, `spec result.todo[${index}].note`);
      if (note !== undefined) item.note = note;
      return item;
    }),
  };
}
