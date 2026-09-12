import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { StringDecoder } from "node:string_decoder";
import { Type } from "typebox";

const MAX_COMMAND_OUTPUT_BYTES = 64 * 1_048_576 + 65_536;
const PROGRESS_PREFIX = "CODEPATROL_EVENT ";
const PROGRESS_KINDS = new Set([
  "run_started",
  "stage_started",
  "heartbeat",
  "activity",
  "model_delta",
  "stage_decided",
  "stage_finished",
  "run_finished",
]);
const packagedCli = fileURLToPath(
  new URL("../../bin/codepatrol.js", import.meta.url),
);

const memory = Type.Object(
  {
    content: Type.String({ minLength: 1, maxLength: 8000 }),
    category: Type.Optional(
      Type.Union([
        Type.Literal("preference"),
        Type.Literal("decision"),
        Type.Literal("fact"),
        Type.Literal("insight"),
        Type.Literal("context"),
        Type.Literal("general"),
      ]),
    ),
    importance: Type.Optional(Type.Integer({ minimum: 1, maximum: 5 })),
    tags: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 128 }))),
    entities: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 128 })),
    ),
  },
  { additionalProperties: false },
);

export function featureRequest(root, task) {
  const normalized = task.trim();
  if (!normalized) throw new Error("Usage: /patrol <feature description>");
  return { protocolVersion: "1.0", root, task: normalized };
}

export function runFeature(
  root,
  task,
  { env = process.env, cliPath = packagedCli, onProgress } = {},
) {
  const request = featureRequest(root, task);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, "run", "--input", "-"], {
      cwd: root,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    const stderrDecoder = new StringDecoder("utf8");
    let stderrLines = "";
    let size = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(error);
    };
    const collect = (target) => (chunk) => {
      size += chunk.length;
      if (size > MAX_COMMAND_OUTPUT_BYTES) {
        fail(new Error("CodePatrol command output exceeded the 64 MiB state bound"));
        return;
      }
      target.push(chunk);
    };
    child.stdout.on("data", collect(stdout));
    const progressLine = (line) => {
      if (!line.startsWith(PROGRESS_PREFIX)) return;
      try {
        const event = JSON.parse(line.slice(PROGRESS_PREFIX.length));
        if (
          event?.protocolVersion === "1.0" &&
          typeof event.runId === "string" &&
          typeof event.kind === "string" &&
          PROGRESS_KINDS.has(event.kind) &&
          (event.message === undefined ||
            (typeof event.message === "string" && event.message.length <= 4096))
        )
          onProgress?.(event);
      } catch {
        /* Malformed child diagnostics remain ordinary stderr. */
      }
    };
    child.stderr.on("data", (chunk) => {
      collect(stderr)(chunk);
      stderrLines += stderrDecoder.write(chunk);
      let newline = stderrLines.indexOf("\n");
      while (newline >= 0) {
        progressLine(stderrLines.slice(0, newline).replace(/\r$/, ""));
        stderrLines = stderrLines.slice(newline + 1);
        newline = stderrLines.indexOf("\n");
      }
    });
    child.on("error", fail);
    child.on("close", (exitCode) => {
      if (settled) return;
      settled = true;
      stderrLines += stderrDecoder.end();
      if (stderrLines) progressLine(stderrLines.replace(/\r$/, ""));
      const output = Buffer.concat(stdout).toString("utf8");
      const diagnostics = Buffer.concat(stderr)
        .toString("utf8")
        .split("\n")
        .filter((line) => !line.startsWith(PROGRESS_PREFIX))
        .join("\n")
        .trim();
      let state;
      try {
        state = JSON.parse(output);
      } catch {
        reject(
          new Error(
            diagnostics ||
              `CodePatrol exited with ${exitCode ?? "unknown"} and no valid state`,
          ),
        );
        return;
      }
      resolve({ exitCode, diagnostics, state });
    });
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}

function registerInteractiveCommand(pi) {
  pi.registerCommand("patrol", {
    description: "Run a complete CodePatrol feature workflow in this repository",
    handler: async (args, ctx) => {
      const decisions = [];
      try {
        const request = featureRequest(ctx.cwd, args);
        ctx.ui.notify("CodePatrol workflow started", "info");
        ctx.ui.setStatus("codepatrol", "CodePatrol: preparing workflow");
        const { state } = await runFeature(request.root, request.task, {
          env: { ...process.env, CODEPATROL_PROGRESS: "jsonl" },
          onProgress: (event) => {
            const stage = event.stage ? ` ${event.stage}` : "";
            const elapsed = Number.isFinite(event.elapsedMs)
              ? ` (${Math.round(event.elapsedMs / 1000)}s)`
              : "";
            ctx.ui.setStatus(
              "codepatrol",
              `CodePatrol:${stage} ${event.kind}${elapsed}`,
            );
            if (event.kind === "stage_decided" && event.message) {
              decisions.push(`${event.stage}: ${event.message}`);
              if (decisions.length > 6) decisions.shift();
              ctx.ui.setWidget("codepatrol", decisions);
            }
            if (event.kind === "stage_finished")
              ctx.ui.notify(
                `${event.stage} ${event.message ?? "finished"}`,
                event.message === "passed" ? "info" : "warning",
              );
          },
        });
        const run = state?.runId ? ` (${state.runId})` : "";
        const status = state?.status ?? "unknown";
        ctx.ui.notify(
          `CodePatrol ${status}${run}. Inspect .codepatrol/v1 for the durable state.`,
          status === "awaiting-approval" || status === "approved"
            ? "info"
            : "warning",
        );
      } catch (error) {
        ctx.ui.notify(
          error instanceof Error ? error.message : "CodePatrol failed",
          "error",
        );
      } finally {
        ctx.ui.setStatus("codepatrol", undefined);
        ctx.ui.setWidget("codepatrol", undefined);
      }
    },
  });
}

function acceptanceKeys(environment) {
  if (!environment.CODEPATROL_ACCEPTANCE_KEYS) return [];
  const value = JSON.parse(environment.CODEPATROL_ACCEPTANCE_KEYS);
  if (
    !Array.isArray(value) ||
    value.length > 100 ||
    value.some(
      (key) =>
        typeof key !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(key),
    ) ||
    new Set(value).size !== value.length
  )
    throw new Error("Invalid CodePatrol acceptance keys");
  return value;
}

function registerStageResultTool(pi, stage, environment = process.env) {
  const keys = stage === "build-review" ? acceptanceKeys(environment) : [];
  const approved = stage.endsWith("-review") || stage === "ship";
  const properties = {
    protocolVersion: Type.Literal("1.0"),
    status: Type.Union([Type.Literal("passed"), Type.Literal("failed")]),
    summary: Type.String({ minLength: 1, maxLength: 100000 }),
    artifacts: Type.Array(Type.String({ maxLength: 4096 }), { maxItems: 1024 }),
    ...(approved ? { approved: Type.Boolean() } : {}),
    ...(keys.length
      ? {
          acceptance: Type.Array(
            Type.Object(
              {
                key:
                  keys.length === 1
                    ? Type.Literal(keys[0])
                    : Type.Union(keys.map((key) => Type.Literal(key))),
                status: Type.Union([
                  Type.Literal("passed"),
                  Type.Literal("failed"),
                ]),
                summary: Type.String({ minLength: 1, maxLength: 100000 }),
              },
              { additionalProperties: false },
            ),
            { minItems: keys.length, maxItems: keys.length },
          ),
        }
      : {}),
    memories: Type.Optional(Type.Array(memory, { maxItems: 10 })),
  };
  pi.registerTool({
    name: "codepatrol_result",
    label: "CodePatrol Result",
    description: `Submit the one final Patrol Protocol 1.0 result for the ${stage} stage after completing the requested work.`,
    promptSnippet: "Submit the final validated result for the active CodePatrol stage",
    promptGuidelines: [
      "Call codepatrol_result exactly once, only after the active CodePatrol stage is complete.",
      "Never claim files, approval, acceptance, usage, or verification without direct evidence.",
    ],
    parameters: Type.Object(properties, { additionalProperties: false }),
    async execute(_toolCallId, result) {
      return {
        content: [{ type: "text", text: "CodePatrol result accepted." }],
        details: { stage, result },
      };
    },
  });
}

/** Interactive command or completion boundary, selected by executor context. */
export default function codepatrolPiExtension(pi) {
  const stage = process.env.CODEPATROL_STAGE;
  if (stage) registerStageResultTool(pi, stage);
  else registerInteractiveCommand(pi);
}
