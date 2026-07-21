import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const project = resolve(import.meta.dirname, "..", "..");
const entry = join(project, "src", "cli", "main.ts");

function workspace(): string {
	const root = mkdtempSync(join(tmpdir(), "codepatrol cli space "));
	mkdirSync(join(root, "src"));
	writeFileSync(join(root, "src", "main.ts"), "export function main() { return 42; }\n");
	writeFileSync(join(root, "src", "main.test.ts"), "import { main } from './main';\nmain();\n");
	return root;
}

function run(args: string[], input?: string) {
	return spawnSync(process.execPath, ["--import", "jiti/register", entry, ...args], {
		cwd: project,
		encoding: "utf8",
		input,
	});
}

test("CLI graph commands return stable JSON envelopes in a workspace with spaces", () => {
	const root = workspace();
	try {
		const sync = run(["graph", "sync", "--workspace", root, "--format", "json"]);
		assert.equal(sync.status, 0, sync.stderr);
		const envelope = JSON.parse(sync.stdout);
		assert.equal(envelope.ok, true);
		assert.equal(envelope.command, "graph.sync");
		assert.equal(envelope.workspace, realpathSync(root));
		assert.equal(envelope.data.report.scanned, 2);
		assert.deepEqual(envelope.warnings, []);

		const outline = run(["graph", "outline", "--file", "src/main.ts", "--workspace", root, "--format=json"]);
		assert.equal(outline.status, 0, outline.stderr);
		assert.equal(JSON.parse(outline.stdout).data[0].exported[0].name, "main");
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("CLI emits machine-readable errors and stable exit codes", () => {
	const root = workspace();
	try {
		const missing = run(["graph", "overview", "--workspace", root, "--format", "json"]);
		assert.equal(missing.status, 4);
		assert.equal(missing.stderr, "");
		assert.equal(JSON.parse(missing.stdout).error.code, "GRAPH_NOT_FOUND");

		const invalid = run(["graph", "find", "--workspace", root, "--format=json"]);
		assert.equal(invalid.status, 2);
		assert.equal(JSON.parse(invalid.stdout).error.code, "INVALID_ARGUMENT");

		const irrelevant = run(["wiki", "status", "--query", "unused", "--workspace", root, "--format=json"]);
		assert.equal(irrelevant.status, 2);
		assert.match(JSON.parse(irrelevant.stdout).error.message, /not valid for wiki\.status/);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("CLI wiki validate returns exit 4 for a structurally invalid bundle", () => {
	const root = workspace();
	try {
		mkdirSync(join(root, "docs", "wiki"), { recursive: true });
		writeFileSync(join(root, "docs", "wiki", "index.md"), "# Missing OKF metadata\n\n- item\n");
		const validate = run(["wiki", "validate", "--workspace", root, "--format=json"]);
		assert.equal(validate.status, 4);
		const result = JSON.parse(validate.stdout);
		assert.equal(result.ok, true);
		assert.equal(result.data.valid, false);
		assert.ok(result.data.errors.length > 0);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("CLI wiki record accepts stdin payload and validate is read-only", () => {
	const root = workspace();
	try {
		const payload = JSON.stringify({
			version: 1, mode: "rewrite", files: [
				{ path: "index.md", content: `---\nokf_version: "0.1"\n---\n\n# Wiki\n\n- [Architecture](architecture.md) - map.\n` },
				{ path: "architecture.md", content: `---\ntype: Software Architecture\ntitle: Architecture\ndescription: System map.\n---\n\n# Architecture\n`, sources: ["src/main.ts"] },
			],
		});
		const record = run(["wiki", "record", "--input", "-", "--workspace", root, "--format=json"], payload);
		assert.equal(record.status, 0, record.stderr);
		assert.equal(JSON.parse(record.stdout).data.mode, "rewrite");
		const validate = run(["wiki", "validate", "--workspace", root, "--format=json"]);
		assert.equal(validate.status, 0, validate.stderr);
		assert.equal(JSON.parse(validate.stdout).data.valid, true);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("CLI wiki generate requires a graph and commits a valid graph-backed bundle", () => {
	const root = workspace();
	try {
		const missing = run(["wiki", "generate", "--workspace", root, "--format=json"]);
		assert.equal(missing.status, 4);
		assert.equal(JSON.parse(missing.stdout).error.code, "GRAPH_NOT_FOUND");

		assert.equal(run(["graph", "sync", "--workspace", root, "--format=json"]).status, 0);
		const generated = run(["wiki", "generate", "--workspace", root, "--format=json"]);
		assert.equal(generated.status, 0, generated.stderr || generated.stdout);
		const envelope = JSON.parse(generated.stdout);
		assert.equal(envelope.command, "wiki.generate");
		assert.equal(envelope.data.mode, "rewrite");
		assert.ok(envelope.data.written.includes("architecture.md"));
		assert.equal(run(["wiki", "validate", "--workspace", root, "--format=json"]).status, 0);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("CLI workflow commands persist, claim, close, and resume native memory", () => {
	const root = workspace();
	try {
		const created = run(
			["workflow", "create", "--input", "-", "--workspace", root, "--format=json"],
			JSON.stringify({ kind: "workflow", title: "Build target project" }),
		);
		assert.equal(created.status, 0, created.stderr || created.stdout);
		const workflow = JSON.parse(created.stdout).data;

		const taskCreated = run(
			["workflow", "create", "--input", "-", "--workspace", root, "--format=json"],
			JSON.stringify({ kind: "task", workflowId: workflow.id, title: "Implement memory", nextAction: "Write the ledger." }),
		);
		assert.equal(taskCreated.status, 0, taskCreated.stderr || taskCreated.stdout);
		const task = JSON.parse(taskCreated.stdout).data;

		const updated = run(
			["workflow", "update", "--id", task.id, "--input", "-", "--workspace", root, "--format=json"],
			JSON.stringify({ nextAction: "Write and verify the ledger." }),
		);
		assert.equal(updated.status, 0, updated.stderr || updated.stdout);
		const shown = run(["workflow", "show", "--id", task.id, "--workspace", root, "--format=json"]);
		assert.equal(JSON.parse(shown.stdout).data.nextAction, "Write and verify the ledger.");
		const listed = run(["workflow", "list", "--workflow-id", workflow.id, "--status", "open", "--workspace", root, "--format=json"]);
		assert.ok(JSON.parse(listed.stdout).data.some((item: { id: string }) => item.id === task.id));

		const remembered = run(
			["workflow", "remember", "--input", "-", "--workspace", root, "--format=json"],
			JSON.stringify({ workflowId: workflow.id, scope: "project", title: "Native concepts", summary: "Adapt references to the target project." }),
		);
		assert.equal(remembered.status, 0, remembered.stderr || remembered.stdout);

		const ready = run(["workflow", "ready", "--workflow-id", workflow.id, "--workspace", root, "--format=json"]);
		assert.equal(ready.status, 0, ready.stderr || ready.stdout);
		assert.deepEqual(JSON.parse(ready.stdout).data.map((item: { id: string }) => item.id), [task.id]);

		const claim = run(["workflow", "claim", "--id", task.id, "--actor", "codex", "--workspace", root, "--format=json"]);
		assert.equal(claim.status, 0, claim.stderr || claim.stdout);
		assert.equal(JSON.parse(claim.stdout).data.claim.actor, "codex");

		const closed = run(
			["workflow", "close", "--id", task.id, "--result", "-", "--workspace", root, "--format=json"],
			JSON.stringify({ summary: "Native memory implemented.", artifacts: ["src/workflow/service.ts"] }),
		);
		assert.equal(closed.status, 0, closed.stderr || closed.stdout);

		const prime = run(["workflow", "prime", "--workflow-id", workflow.id, "--budget", "256", "--workspace", root, "--format=json"]);
		assert.equal(prime.status, 0, prime.stderr || prime.stdout);
		assert.match(JSON.parse(prime.stdout).data.context, /Native memory implemented/);
		assert.match(JSON.parse(prime.stdout).data.context, /Adapt references to the target project/);

		const compact = run(["workflow", "compact", "--workflow-id", workflow.id, "--workspace", root, "--format=json"]);
		assert.equal(compact.status, 0, compact.stderr || compact.stdout);
		assert.deepEqual(JSON.parse(compact.stdout).data.compacted, []);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("CLI workflow prime warns when multiple active workflows exist", () => {
	const root = workspace();
	try {
		for (const title of ["First active", "Second active"]) {
			const created = run(
				["workflow", "create", "--input", "-", "--workspace", root, "--format=json"],
				JSON.stringify({ kind: "workflow", title }),
			);
			assert.equal(created.status, 0, created.stderr || created.stdout);
		}
		const prime = run(["workflow", "prime", "--workspace", root, "--format=json"]);
		assert.equal(prime.status, 0, prime.stderr || prime.stdout);
		const envelope = JSON.parse(prime.stdout);
		assert.match(envelope.warnings[0], /Multiple active workflows: cpw-[a-f0-9]{12}\. Resumed most recent: cpw-[a-f0-9]{12}\. Pass --workflow-id to select another\./);
		assert.ok(Array.isArray(envelope.data.otherActiveWorkflows));
		assert.equal(envelope.data.otherActiveWorkflows.length, 1);

		const explicit = run(["workflow", "prime", "--workflow-id", envelope.data.otherActiveWorkflows[0].id, "--workspace", root, "--format=json"]);
		assert.equal(explicit.status, 0, explicit.stderr || explicit.stdout);
		assert.deepEqual(JSON.parse(explicit.stdout).warnings, []);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("CLI status summarizes open work and validates its options", () => {
	const root = workspace();
	try {
		const empty = run(["status", "--workspace", root, "--format=json"]);
		assert.equal(empty.status, 0, empty.stderr || empty.stdout);
		assert.deepEqual(JSON.parse(empty.stdout).data, { workflows: [], packages: [], warnings: [] });

		const created = run(
			["workflow", "create", "--input", "-", "--workspace", root, "--format=json"],
			JSON.stringify({ kind: "workflow", title: "Summarize me" }),
		);
		assert.equal(created.status, 0, created.stderr || created.stdout);
		const workflow = JSON.parse(created.stdout).data;

		// Ledger-only workflow (no physical package) is intentionally hidden from the default board (AC-6).
		assert.deepEqual(JSON.parse(run(["status", "--workspace", root, "--format=json"]).stdout).data.workflows, []);
		const allWithoutPackage = run(["status", "--all", "--workspace", root, "--format=json"]);
		assert.deepEqual(JSON.parse(allWithoutPackage.stdout).data.workflows.map((item: { id: string }) => item.id), [workflow.id]);

		// Once a physical package ties to the workflow, the default board surfaces it.
		const packageDir = join(root, ".codepatrol", "packages", "summarize-me");
		mkdirSync(packageDir, { recursive: true });
		writeFileSync(join(packageDir, "handoff.yaml"), [
			"schema_version: 1",
			"work_id: summarize-me",
			"origin:",
			"  skill: propose-codebase",
			"  mode: feature",
			"status: ready-for-review",
			"revision: 1",
			`workflow_id: ${workflow.id}`,
			"artifacts:",
			"  spec:",
			"    path: spec.md",
			"  plan:",
			"    path: plan.md",
			"",
		].join("\n"));

		const summary = run(["status", "--workspace", root, "--format=json"]);
		assert.equal(summary.status, 0, summary.stderr || summary.stdout);
		const envelope = JSON.parse(summary.stdout);
		assert.equal(envelope.command, "status");
		assert.deepEqual(envelope.data.workflows.map((item: { id: string }) => item.id), [workflow.id]);
		assert.equal(envelope.data.workflows[0].packageWorkId, "summarize-me");

		const closed = run(
			["workflow", "close", "--id", workflow.id, "--result", "-", "--workspace", root, "--format=json"],
			JSON.stringify({ summary: "done" }),
		);
		assert.equal(closed.status, 0, closed.stderr || closed.stdout);
		assert.deepEqual(JSON.parse(run(["status", "--workspace", root, "--format=json"]).stdout).data.workflows, []);
		const all = run(["status", "--all", "--workspace", root, "--format=json"]);
		assert.equal(all.status, 0, all.stderr || all.stdout);
		assert.deepEqual(JSON.parse(all.stdout).data.workflows.map((item: { id: string }) => item.id), [workflow.id]);

		const bogus = run(["status", "--bogus", "--workspace", root, "--format=json"]);
		assert.equal(bogus.status, 2);
		assert.equal(JSON.parse(bogus.stdout).error.code, "INVALID_ARGUMENT");
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("CLI records and validates a portable artifact handoff", () => {
	const root = workspace();
	try {
		const directory = join(root, ".codepatrol", "packages", "2026-07-18-cache");
		mkdirSync(directory, { recursive: true });
		writeFileSync(join(directory, "spec.md"), "# Cache specification\n");
		writeFileSync(join(directory, "plan.md"), "# Cache plan\n");
		writeFileSync(join(directory, "handoff.yaml"), [
			"schema_version: 1",
			"work_id: 2026-07-18-cache",
			"origin:",
			"  skill: propose-codebase",
			"  mode: feature",
			"status: ready-for-review",
			"revision: 1",
			"artifacts:",
			"  spec:",
			"    path: spec.md",
			"  plan:",
			"    path: plan.md",
			"",
		].join("\n"));

		const recorded = run(["artifact", "record", "--manifest", ".codepatrol/packages/2026-07-18-cache/handoff.yaml", "--workspace", root, "--format=json"]);
		assert.equal(recorded.status, 0, recorded.stderr || recorded.stdout);
		assert.match(JSON.parse(recorded.stdout).data.artifacts.spec.sha256, /^[a-f0-9]{64}$/);

		const validated = run(["artifact", "validate", "--manifest", ".codepatrol/packages/2026-07-18-cache/handoff.yaml", "--stage", "review", "--workspace", root, "--format=json"]);
		assert.equal(validated.status, 0, validated.stderr || validated.stdout);
		assert.equal(JSON.parse(validated.stdout).data.valid, true);
	} finally { rmSync(root, { recursive: true, force: true }); }
});
