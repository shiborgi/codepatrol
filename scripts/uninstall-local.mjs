#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseInstallerArgs, uninstall } from "./install-lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
try {
	const options = parseInstallerArgs(process.argv.slice(2));
	for (const line of uninstall({ root, ...options })) process.stdout.write(`${line}\n`);
} catch (error) {
	for (const line of error?.installOutput ?? []) process.stdout.write(`${line}\n`);
	process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
	process.exitCode = 1;
}
