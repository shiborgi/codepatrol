import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";

const MAX_COMMAND_OUTPUT_BYTES = 64 * 1_048_576 + 65_536;
const packagedCli = fileURLToPath(
  new URL("../../bin/codepatrol.js", import.meta.url),
);

const acceptance = Type.Object(
  {
    key: Type.String({ minLength: 1, maxLength: 64 }),
    status: Type.Union([Type.Literal("passed"), Type.Literal("failed")]),
    summary: Type.String({ minLength: 1, maxLength: 100000 }),
  },
  { additionalProperties: false },
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
  { env = process.env, cliPath = packagedCli } = {},
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
    child.stderr.on("data", collect(stderr));
    child.on("error", fail);
    child.on("close", (exitCode) => {
      if (settled) return;
      settled = true;
      const output = Buffer.concat(stdout).toString("utf8");
      const diagnostics = Buffer.concat(stderr).toString("utf8").trim();
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
      try {
        const request = featureRequest(ctx.cwd, args);
        ctx.ui.notify("CodePatrol workflow started", "info");
        const { state } = await runFeature(request.root, request.task);
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
      }
    },
  });
}

function registerStageResultTool(pi, stage) {
  pi.registerTool({
    name: "codepatrol_result",
    label: "CodePatrol Result",
    description: `Submit the one final Patrol Protocol 1.0 result for the ${stage} stage after completing the requested work.`,
    promptSnippet: "Submit the final validated result for the active CodePatrol stage",
    promptGuidelines: [
      "Call codepatrol_result exactly once, only after the active CodePatrol stage is complete.",
      "Never claim files, approval, acceptance, usage, or verification without direct evidence.",
    ],
    parameters: Type.Object(
      {
        protocolVersion: Type.Literal("1.0"),
        status: Type.Union([Type.Literal("passed"), Type.Literal("failed")]),
        summary: Type.String({ minLength: 1, maxLength: 100000 }),
        artifacts: Type.Array(Type.String({ maxLength: 4096 }), {
          maxItems: 1024,
        }),
        approved: Type.Optional(Type.Boolean()),
        acceptance: Type.Optional(Type.Array(acceptance, { maxItems: 100 })),
        memories: Type.Optional(Type.Array(memory, { maxItems: 10 })),
      },
      { additionalProperties: false },
    ),
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
