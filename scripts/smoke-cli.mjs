#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
for (const legacy of ["artifact", "workflow", "status"]) {
	if (existsSync(join(root, "dist", "src", legacy))) throw new Error(`stale v1 build output survived: dist/src/${legacy}`);
}

const version = spawnSync(process.execPath, [join(root, "bin", "codepatrol.js"), "--version"], {
	cwd: root,
	encoding: "utf8",
});
assert.equal(version.status, 0, version.stderr);
assert.equal(version.stdout.trim(), packageJson.version);

const help = spawnSync(process.execPath, [join(root, "bin", "codepatrol.js"), "--help"], {
	cwd: root,
	encoding: "utf8",
});
assert.equal(help.status, 0, help.stderr);
assert.match(help.stdout, /graph outline --file <path>/);
assert.match(help.stdout, /change inspect --id <work-id>/);
assert.match(help.stdout, /change close --id <work-id>/);

process.stdout.write(`Compiled CLI smoke passed (${packageJson.version}).\n`);
