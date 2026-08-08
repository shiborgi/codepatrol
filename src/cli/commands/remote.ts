import { loadProjectConfig } from "../../adapters/config.js";
import { republishAcceptedWork } from "../../application/publication.js";
import { StateTransferService } from "../../application/state-transfer.js";
import { type ProjectConfig, SyncService } from "../../application/sync-service.js";
import { fail } from "../../core/errors.js";
import { prettyJson } from "../../core/json.js";
import { optionalFlag, type ParsedArgs, requireFlag } from "../args.js";
import { type Context, publicationEnvironment, resolveGitHub, workService } from "../context.js";

export async function syncCommand(args: ParsedArgs, ctx: Context): Promise<number> {
  const workId = optionalFlag(args, "work");
  const github = await resolveGitHub(ctx);
  if (github === null) {
    fail("GITHUB", "cannot resolve GitHub repository (no origin remote); cannot sync");
  }
  const service = new SyncService(ctx.store, github, loadProjectConfig(ctx.cwd));
  const report = await service.sync(workId !== undefined ? { workId } : {});
  ctx.io.out(prettyJson(report));
  return 0;
}

export async function projectCommand(sub: string | undefined, ctx: Context): Promise<number> {
  if (sub !== "prepare") {
    fail("USAGE", `unknown project subcommand ${JSON.stringify(sub)}; use prepare`);
  }
  const github = await resolveGitHub(ctx);
  if (github === null) {
    fail("GITHUB", "cannot resolve GitHub repository (no origin remote); cannot prepare a project");
  }
  // An unusable configuration is something to report, not something to crash
  // on: preparing is precisely the command asked to find out what is wrong.
  let config: ProjectConfig | undefined;
  let configError: string | undefined;
  try {
    config = loadProjectConfig(ctx.cwd);
  } catch (error) {
    configError = error instanceof Error ? error.message : String(error);
  }
  if (configError !== undefined) {
    ctx.io.out(
      prettyJson({ configured: false, ready: false, fields: [], missing: [configError], reason: "invalid config" }),
    );
    return 1;
  }
  const service = new SyncService(ctx.store, github, config);
  const preparation = await service.prepareProject();
  ctx.io.out(prettyJson(preparation));
  return preparation.ready ? 0 : 1;
}

export async function stateCommand(sub: string | undefined, args: ParsedArgs, ctx: Context): Promise<number> {
  const remote = optionalFlag(args, "remote") ?? "origin";
  const service = new StateTransferService(ctx.git, ctx.store);
  if (sub === "status") {
    ctx.io.out(prettyJson(await service.status(remote)));
    return 0;
  }
  if (sub === "fetch") {
    ctx.io.out(prettyJson(await service.fetch(remote)));
    return 0;
  }
  if (sub === "push") {
    ctx.io.out(prettyJson(await service.push(remote)));
    return 0;
  }
  fail("USAGE", `unknown state subcommand ${JSON.stringify(sub)}; use status|fetch|push`);
}

export async function shipPublishCommand(args: ParsedArgs, ctx: Context): Promise<number> {
  const workId = requireFlag(args, "work");
  const snapshot = await ctx.store.read();
  const work = snapshot.works.get(workId);
  if (work === undefined) fail("NOT_FOUND", `work ${workId} does not exist`);
  const outcome = await republishAcceptedWork(publicationEnvironment(ctx), workService(ctx), work);
  ctx.io.out(prettyJson({ workId, remotePublication: outcome.report }));
  return 0;
}
