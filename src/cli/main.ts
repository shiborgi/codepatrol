import { parseArgs } from "./args.js";
import { executeCommand } from "./commands.js";
import { errorEnvelope, HELP, successEnvelope } from "./output.js";
import { operationalError } from "../shared/errors.js";
import { resolveWorkspace } from "../shared/workspace.js";
import { VERSION } from "../version.js";
import { pathToFileURL } from "node:url";

export async function main(argv = process.argv.slice(2)): Promise<number> {
	let command = "unknown";
	let format: "text" | "json" = argv.includes("--format=json") || argv.some((arg, index) => arg === "--format" && argv[index + 1] === "json") ? "json" : "text";
	try {
		const args = parseArgs(argv);
		command = args.command;
		format = args.format;
		if (args.version) {
			process.stdout.write(`${VERSION}\n`);
			return 0;
		}
		if (args.help || !args.command) {
			process.stdout.write(`${HELP}\n`);
			return args.help ? 0 : 2;
		}
		const workspace = resolveWorkspace(args.workspace);
		const controller = new AbortController();
		const abort = () => controller.abort();
		process.once("SIGINT", abort);
		process.once("SIGTERM", abort);
		try {
			const result = await executeCommand(args, workspace, controller.signal);
			if (format === "json") {
				process.stdout.write(`${JSON.stringify(successEnvelope(command, workspace, result.data, result.warnings))}\n`);
			} else {
				process.stdout.write(`${result.text}\n`);
				for (const warning of result.warnings ?? []) process.stderr.write(`warning: ${warning}\n`);
			}
			return result.exitCode ?? 0;
		} finally {
			process.off("SIGINT", abort);
			process.off("SIGTERM", abort);
		}
	} catch (cause) {
		const error = operationalError(cause);
		if (format === "json") process.stdout.write(`${JSON.stringify(errorEnvelope(command, error))}\n`);
		else process.stderr.write(`${error.code}: ${error.message}\n`);
		return error.exitCode;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exitCode = await main();
}
