import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const project = resolve(import.meta.dirname, "..", "..");
const entry = join(project, "src", "cli", "main.ts");
function git(root: string, args: string[]): string { return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim(); }
function workspace(): string {
	const root = mkdtempSync(join(tmpdir(), "codepatrol cli space "));
	mkdirSync(join(root, "src"));
	writeFileSync(join(root, "src", "main.ts"), "export function main() { return 42; }\n");
	writeFileSync(join(root, "src", "main.test.ts"), "import { main } from './main';\nmain();\n");
	writeFileSync(join(root, ".gitignore"), ".codepatrol/runtime/\n");
	git(root, ["init", "-b", "main"]); git(root, ["add", "."]); git(root, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "baseline"]);
	return root;
}
function run(args: string[], input?: string) { return spawnSync(process.execPath, ["--import", "jiti/register", entry, ...args], { cwd: project, encoding: "utf8", input }); }

test("CLI graph commands retain stable JSON envelopes under runtime storage", () => {
	const root = workspace();
	try {
		const sync = run(["graph", "sync", "--workspace", root, "--format", "json"]); assert.equal(sync.status, 0, sync.stderr);
		const envelope = JSON.parse(sync.stdout); assert.equal(envelope.ok, true); assert.equal(envelope.command, "graph.sync"); assert.equal(envelope.workspace, realpathSync(root)); assert.equal(envelope.data.report.scanned, 2);
		const outline = run(["graph", "outline", "--file", "src/main.ts", "--workspace", root, "--format=json"]); assert.equal(outline.status, 0, outline.stderr); assert.equal(JSON.parse(outline.stdout).data[0].exported[0].name, "main");
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("CLI exposes only explicit Change lifecycle commands and deterministic status", () => {
	const root = workspace();
	try {
		const id = "2026-07-22-cli";
		const started = run(["change", "start", "--input", "-", "--workspace", root, "--format=json"], JSON.stringify({ workId: id, title: "CLI contract", targetBranch: "main", actor: "codex" }));
		assert.equal(started.status, 0, started.stderr || started.stdout); const startData = JSON.parse(started.stdout).data; assert.equal(startData.stage, "plan"); assert.equal(git(root, ["branch", "--show-current"]), `codepatrol/${id}`);
		const inspected = run(["change", "inspect", "--id", id, "--workspace", root, "--format=json"]); assert.equal(inspected.status, 0, inspected.stderr); assert.equal(JSON.parse(inspected.stdout).data.identity.work_id, id);
		const status = run(["status", "--workspace", root, "--format=json"]); assert.equal(status.status, 0, status.stderr); assert.equal(JSON.parse(status.stdout).data.rows[0].workId, id);
		const missingId = run(["change", "inspect", "--workspace", root, "--format=json"]); assert.equal(missingId.status, 2); assert.match(JSON.parse(missingId.stdout).error.message, /--id/);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("CLI errors and Kanban clock input are stable", () => {
	const root = workspace();
	try {
		const invalid = run(["graph", "find", "--workspace", root, "--format=json"]); assert.equal(invalid.status, 2); assert.equal(JSON.parse(invalid.stdout).error.code, "INVALID_ARGUMENT");
		const clock = run(["status", "--as-of", "tomorrow", "--workspace", root, "--format=json"]); assert.equal(clock.status, 2); assert.match(JSON.parse(clock.stdout).error.message, /ISO/);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("CLI wiki record remains recoverable beneath runtime state", () => {
	const root = workspace();
	try {
		const payload = JSON.stringify({ version: 1, mode: "rewrite", files: [
			{ path: "index.md", content: `---\nokf_version: "0.1"\n---\n\n# Wiki\n\n- [Architecture](architecture.md) - map.\n` },
			{ path: "architecture.md", content: `---\ntype: Software Architecture\ntitle: Architecture\ndescription: System map.\n---\n\n# Architecture\n`, sources: ["src/main.ts"] },
		] });
		const recorded = run(["wiki", "record", "--input", "-", "--workspace", root, "--format=json"], payload); assert.equal(recorded.status, 0, recorded.stderr || recorded.stdout);
		assert.equal(run(["wiki", "validate", "--workspace", root, "--format=json"]).status, 0);
	} finally { rmSync(root, { recursive: true, force: true }); }
});
