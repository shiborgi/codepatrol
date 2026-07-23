#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseInstallerArgs, verify } from "./install-lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
try {
	const options = parseInstallerArgs(process.argv.slice(2));
	const result = verify({ root, harnesses: options.harnesses });
	for (const line of result.output) process.stdout.write(`${line}\n`);
	if (!result.ok) process.exitCode = 1;
} catch (error) {
	process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
	process.exitCode = 1;
}
