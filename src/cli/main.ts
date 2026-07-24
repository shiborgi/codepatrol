import { parseArgs } from "./args.js";
import { executeCommand } from "./commands.js";
import { errorEnvelope, HELP, successEnvelope } from "./output.js";
import { CodepatrolError, operationalError } from "../shared/errors.js";
import { resolveWorkspace } from "../shared/workspace.js";
import { VERSION } from "../version.js";
import { pathToFileURL } from "node:url";
import * as trace from "../change/trace.js";

function redactedArgs(args: Record<string, unknown>): Record<string, unknown> {
	const safe: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(args)) {
		if (k === "input" || k === "asOf") continue;
		safe[k] = v;
	}
	return safe;
}

function traceableWorkId(command: string, args: Record<string, unknown>): string | undefined {
	if (typeof args.id === "string" && args.id) return args.id;
	if (command === "change.start" && typeof args.input === "string" && args.input !== "-") {
		try {
			const { readFileSync } = require("node:fs") as typeof import("node:fs");
			const { resolveInside } = require("../shared/workspace.js") as typeof import("../shared/workspace.js");
			const raw = readFileSync(resolveInside(String((args as { workspace?: string }).workspace ?? "."), args.input, true), "utf8");
			const payload = JSON.parse(raw) as { workId?: string };
			if (typeof payload.workId === "string" && payload.workId) return payload.workId;
		} catch { /* best effort */ }
	}
	return undefined;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
	let command = "unknown";
	let format: "text" | "json" = argv.includes("--format=json") || argv.some((arg, index) => arg === "--format" && argv[index + 1] === "json") ? "json" : "text";
	let parsedArgs: ReturnType<typeof parseArgs> | undefined;
	let resolvedWorkspace: string | undefined;
	try {
		parsedArgs = parseArgs(argv);
		const args = parsedArgs;
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
		resolvedWorkspace = workspace;
		const controller = new AbortController();
		const abort = () => controller.abort();
		process.once("SIGINT", abort);
		process.once("SIGTERM", abort);
		const traceWorkId = traceableWorkId(command, args as unknown as Record<string, unknown>);
		if (traceWorkId) trace.append(workspace, traceWorkId, { kind: "command", at: new Date().toISOString(), command, args: redactedArgs(args as unknown as Record<string, unknown>) });
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
		if (cause instanceof CodepatrolError && parsedArgs && resolvedWorkspace) {
			const wid = traceableWorkId(command, parsedArgs as unknown as Record<string, unknown>);
			if (wid) trace.append(resolvedWorkspace, wid, { kind: "error", at: new Date().toISOString(), command, code: cause.code, message: cause.message });
		}
		const error = operationalError(cause);
		if (format === "json") process.stdout.write(`${JSON.stringify(errorEnvelope(command, error))}\n`);
		else process.stderr.write(`${error.code}: ${error.message}\n`);
		return error.exitCode;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exitCode = await main();
}
