import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { Git, GitResult } from "../adapters/git.js";
import {
  classifyPushError,
  type PublicationEnvironment,
  type PublicationRecorder,
  publishShipOutcome,
  republishAcceptedWork,
} from "../application/publication.js";
import type { AttemptResult, RemotePublication, Work } from "../core/work.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function gitDouble(responses: Record<string, GitResult>): Git {
  return {
    exec: async (args: string[]) => {
      const key = args.join(" ");
      const response = responses[key];
      if (response === undefined) throw new Error(`unexpected git call: ${key}`);
      return response;
    },
  } as unknown as Git;
}

function result(code: number, stdout = "", stderr = ""): GitResult {
  return { code, stdout, stderr } as GitResult;
}

function recorderDouble(): PublicationRecorder & { recorded: RemotePublication[] } {
  const recorded: RemotePublication[] = [];
  return {
    recorded,
    async recordRemotePublication(_workId: string, _runId: string, publication: RemotePublication) {
      recorded.push(publication);
    },
  };
}

function environment(git: Git, hasRemote: boolean): PublicationEnvironment {
  let tick = 0;
  return {
    git,
    now: () => {
      tick += 1;
      return `2026-01-01T00:00:0${tick}.000Z`;
    },
    hasRemote: async () => hasRemote,
  };
}

const ACCEPT = { decision: "accept", summary: "s", todo: [] } as unknown as AttemptResult;
const ROLLBACK = { decision: "rollback", summary: "s", todo: [] } as unknown as AttemptResult;

test("a non-accepting ship records not-requested without touching the remote", async () => {
  const recorder = recorderDouble();
  const outcome = await publishShipOutcome(environment(gitDouble({}), true), recorder, {
    workId: "WORK-1.1.1",
    runId: "run-1",
    result: ROLLBACK,
    publishRequested: true,
  });
  assert.equal(outcome.publication.status, "not-requested");
  assert.deepEqual(
    recorder.recorded.map((p) => p.status),
    ["not-requested"],
  );
});

test("an accepted ship that did not ask to publish records not-requested", async () => {
  const recorder = recorderDouble();
  const outcome = await publishShipOutcome(environment(gitDouble({}), true), recorder, {
    workId: "WORK-1.1.1",
    runId: "run-1",
    result: ACCEPT,
    publishRequested: false,
  });
  assert.equal(outcome.publication.status, "not-requested");
  assert.equal(outcome.warning, undefined);
});

test("publishing without a remote fails the publication and warns, never throwing", async () => {
  const recorder = recorderDouble();
  const outcome = await publishShipOutcome(environment(gitDouble({}), false), recorder, {
    workId: "WORK-1.1.1",
    runId: "run-1",
    result: ACCEPT,
    publishRequested: true,
  });
  assert.equal(outcome.publication.status, "failed");
  assert.equal(outcome.publication.error, "no remote configured");
  assert.equal(outcome.warning, "publication requested but no remote configured");
});

test("a successful push is recorded pending then pushed, and reported without timestamps", async () => {
  const git = gitDouble({
    "push origin refs/heads/main:refs/heads/main": result(0),
    "rev-parse HEAD": result(0, "abc123\n"),
  });
  const recorder = recorderDouble();
  const outcome = await publishShipOutcome(environment(git, true), recorder, {
    workId: "WORK-1.1.1",
    runId: "run-1",
    result: ACCEPT,
    publishRequested: true,
  });
  assert.deepEqual(
    recorder.recorded.map((p) => p.status),
    ["pending", "pushed"],
  );
  assert.equal(outcome.publication.pushCommit, "abc123");
  assert.ok(outcome.publication.completedAt !== undefined, "the recorded publication carries a timestamp");
  assert.equal(outcome.report.completedAt, undefined, "the reported publication is timestamp-free");
});

test("a denied push is classified rather than reported as a generic failure", async () => {
  const git = gitDouble({
    "push origin refs/heads/main:refs/heads/main": result(1, "", "remote: Permission denied"),
  });
  const recorder = recorderDouble();
  const outcome = await publishShipOutcome(environment(git, true), recorder, {
    workId: "WORK-1.1.1",
    runId: "run-1",
    result: ACCEPT,
    publishRequested: true,
  });
  assert.equal(outcome.publication.status, "push-denied");
  assert.equal(classifyPushError(result(1, "", "fatal: 403")), "push-denied");
  assert.equal(classifyPushError(result(1, "", "network unreachable")), "failed");
});

function acceptedWork(publication?: RemotePublication): Work {
  return {
    id: "WORK-1.1.1",
    completion: { outcome: "accepted" },
    attempts: [
      {
        stage: "ship",
        status: "completed",
        runId: "run-ship",
        evidence: { finalCommit: "abc123", ...(publication !== undefined ? { remotePublication: publication } : {}) },
      },
    ],
  } as unknown as Work;
}

test("republishing a work already pushed returns the recorded publication untouched", async () => {
  const recorder = recorderDouble();
  const pushed: RemotePublication = { status: "pushed", pushCommit: "abc123", completedAt: "2026-01-01T00:00:00.000Z" };
  const outcome = await republishAcceptedWork(environment(gitDouble({}), true), recorder, acceptedWork(pushed));
  assert.deepEqual(outcome.publication, pushed);
  assert.deepEqual(recorder.recorded, [], "nothing is recorded for a work already published");
});

test("republishing refuses a work that is not accepted", async () => {
  const recorder = recorderDouble();
  const notTerminal = { id: "WORK-1.1.1", completion: null, attempts: [] } as unknown as Work;
  await assert.rejects(
    () => republishAcceptedWork(environment(gitDouble({}), true), recorder, notTerminal),
    /ship publish requires an accepted work/,
  );
});

test("republishing refuses when no remote exists", async () => {
  const recorder = recorderDouble();
  await assert.rejects(
    () => republishAcceptedWork(environment(gitDouble({}), false), recorder, acceptedWork()),
    /no origin remote configured/,
  );
});

test("the dispatcher only dispatches; commands, policy and rendering live elsewhere", () => {
  const runCli = readFileSync(join(repoRoot, "src", "cli", "run-cli.ts"), "utf8");
  assert.doesNotMatch(runCli, /attemptPublication|publishShipOutcome/, "the dispatcher performs no publication");
  assert.doesNotMatch(runCli, /prettyJson\(\{\s*wave/, "the dispatcher formats no command output");
  assert.doesNotMatch(runCli, /store\.transact/, "the dispatcher opens no transaction");
  assert.ok(runCli.split("\n").length < 200, "the dispatcher stays small enough to read at once");

  const stage = readFileSync(join(repoRoot, "src", "cli", "commands", "stage.ts"), "utf8");
  assert.match(stage, /publishShipOutcome/, "the stage command delegates publication to the application layer");

  const render = readFileSync(join(repoRoot, "src", "cli", "render.ts"), "utf8");
  assert.doesNotMatch(render, /from "\.\.\/(adapters|application)\//, "presentation depends on no service or adapter");
});
