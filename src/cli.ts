import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadConfig, readJsonFile } from "./config.js";
import { VERSION } from "./contracts.js";
import { syncRemote } from "./github-sync.js";
import { telemetrySummary } from "./telemetry.js";
import { approve, plan, run } from "./workflow.js";

const HELP = `CodePatrol ${VERSION}
Usage:
  codepatrol plan --input FILE|-
  codepatrol run --input FILE|-
  codepatrol approve --run ID --root PATH --confirm
  codepatrol remote sync --root PATH [--config FILE] [--dry-run]
  codepatrol telemetry summary --root PATH
  codepatrol --help | --version

Plan resolves real providers. Run requires trusted executor and verification argv.
Approval records operator consent only; CodePatrol never publishes, pushes or deploys.
`;
async function stdinJson(): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_048_576) throw new Error("Input exceeds byte limit");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export async function runCli(
  argv: string[] = process.argv,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  try {
    const args = argv.slice(2);
    if (args.length === 1 && (args[0] === "--help" || args[0] === "-h"))
      return { exitCode: 0, stdout: HELP, stderr: "" };
    if (args.length === 1 && args[0] === "--version")
      return { exitCode: 0, stdout: `${VERSION}\n`, stderr: "" };
    const command = args.shift();
    let result: unknown;
    let exitCode = 0;
    if (command === "plan" || command === "run") {
      const { values } = parseArgs({
        args,
        options: { input: { type: "string" } },
        strict: true,
      });
      if (!values.input) throw new Error("--input FILE|- is required");
      const input =
        values.input === "-"
          ? await stdinJson()
          : await readJsonFile(resolve(values.input));
      result = command === "plan" ? await plan(input) : await run(input);
      if (command === "run" && (result as { status: string }).status === "blocked")
        exitCode = 1;
    } else if (command === "approve") {
      const { values } = parseArgs({
        args,
        options: {
          run: { type: "string" },
          root: { type: "string" },
          confirm: { type: "boolean" },
        },
        strict: true,
      });
      if (!values.run || !values.root) throw new Error("--run and --root are required");
      result = await approve({
        runId: values.run,
        root: resolve(values.root),
        confirm: values.confirm === true,
      });
    } else if (command === "telemetry" && args.shift() === "summary") {
      const { values } = parseArgs({
        args,
        options: { root: { type: "string" } },
        strict: true,
      });
      if (!values.root) throw new Error("--root is required");
      const root = resolve(values.root);
      const config = await loadConfig({
        root,
      });
      result = await telemetrySummary(root, config.telemetry.enabled);
    } else if (command === "remote" && args.shift() === "sync") {
      const { values } = parseArgs({
        args,
        options: {
          root: { type: "string" },
          config: { type: "string" },
          "dry-run": { type: "boolean" },
        },
        strict: true,
      });
      if (!values.root) throw new Error("--root is required");
      result = await syncRemote({
        root: resolve(values.root),
        config: values.config,
        dryRun: values["dry-run"] === true,
      });
    } else throw new Error(HELP);
    return { exitCode, stdout: `${JSON.stringify(result, null, 2)}\n`, stderr: "" };
  } catch (error) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `${error instanceof Error ? error.message : "CodePatrol failed"}\n`,
    };
  }
}
