import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const project = resolve(import.meta.dirname, "..", "..");
const entry = join(project, "src", "cli", "main.ts");
function git(root: string, args: string[]): string { return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim(); }
function workspace(): string {
	const root = mkdtempSync(join(tmpdir(), "codepatrol-cli-trace-"));
	mkdirSync(join(root, "src"));
	writeFileSync(join(root, ".gitignore"), ".codepatrol/runtime/\n");
	git(root, ["init", "-b", "main"]);
	git(root, ["add", "."]);
	git(root, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "baseline"]);
	return root;
}
function run(args: string[], input?: string) {
	return spawnSync(process.execPath, ["--import", "jiti/register", entry, ...args], { cwd: project, encoding: "utf8", input });
}

describe("main CLI trace hook", () => {
	test("records a `command` entry on a successful change transition", () => {
		const root = workspace();
		try {
			const id = "2026-07-24-cli-trace";
			const started = run(
				["change", "start", "--input", "-", "--workspace", root, "--format=json"],
				JSON.stringify({ workId: id, title: "trace", targetBranch: "main", actor: "trace-test" }),
			);
			assert.equal(started.status, 0, started.stderr || started.stdout);
			const trans = run(
				["change", "transition", "--id", id, "--input", "-", "--workspace", root, "--format=json"],
				JSON.stringify({ type: "usage", actor: "trace-test", stage: "plan", run: { id: "r1", started_at: "2026-07-24T00:00:00.000Z", finished_at: "2026-07-24T00:00:01.000Z", elapsed_ms: 1000, characters: { status: "unavailable", reason: "test" } } }),
			);
			assert.equal(trans.status, 0, trans.stderr || trans.stdout);
			const tracePath = join(root, ".codepatrol", "runtime", "traces", `${id}.jsonl`);
			assert.equal(existsSync(tracePath), true, "trace file should exist");
			const content = readFileSync(tracePath, "utf8");
			assert.match(content, /"kind":"command"/);
			assert.match(content, /"command":"change\.transition"/);
		} finally { rmSync(root, { recursive: true, force: true }); }
	});

	test("records an `error` entry when the action throws a CodepatrolError", () => {
		const root = workspace();
		try {
			const trans = run(
				["change", "transition", "--id", "2026-07-24-missing", "--input", "-", "--workspace", root, "--format=json"],
				JSON.stringify({ type: "usage", actor: "trace-test", stage: "plan", run: { id: "r1", started_at: "2026-07-24T00:00:00.000Z", finished_at: "2026-07-24T00:00:01.000Z", elapsed_ms: 1000, characters: { status: "unavailable", reason: "test" } } }),
			);
			assert.notEqual(trans.status, 0, "transition should fail");
			const tracePath = join(root, ".codepatrol", "runtime", "traces", "2026-07-24-missing.jsonl");
			assert.equal(existsSync(tracePath), true, "trace file should exist for the failed command's work-id");
			const content = readFileSync(tracePath, "utf8");
			assert.match(content, /"kind":"command"/);
			assert.match(content, /"kind":"error"/);
		} finally { rmSync(root, { recursive: true, force: true }); }
	});
});
