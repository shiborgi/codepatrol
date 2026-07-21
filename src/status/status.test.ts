import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { closeWorkflowItem, createWorkflowItem } from "../workflow/service.js";
import { statusSummary } from "./service.js";

function workspace(): string {
	return mkdtempSync(join(tmpdir(), "codepatrol-status-"));
}

function writePackage(root: string, workId: string, fields: Record<string, unknown>): void {
	const directory = join(root, "docs", "codepatrol", workId);
	mkdirSync(directory, { recursive: true });
	writeFileSync(join(directory, "handoff.yaml"), stringifyYaml({
		schema_version: 1,
		work_id: workId,
		origin: { skill: "propose-codebase", mode: "feature" },
		revision: 1,
		artifacts: { spec: { path: "spec.md" }, plan: { path: "plan.md" } },
		...fields,
	}));
}

test("statusSummary treats implemented packages as open work awaiting verification", async () => {
	const root = workspace();
	try {
		const open = await createWorkflowItem(root, { kind: "workflow", title: "Active feature", nextAction: "Implement T3." });
		const closed = await createWorkflowItem(root, { kind: "workflow", title: "Old work" });
		await closeWorkflowItem(root, closed.id, { summary: "done" });
		writePackage(root, "2026-07-19-alpha", { status: "ready-for-review", workflow_id: open.id });
		writePackage(root, "2026-07-19-beta", { status: "implemented" });
		writePackage(root, "2026-07-19-gamma", { status: "verified" });

		const summary = statusSummary(root);
		assert.deepEqual(summary.workflows.map((workflow) => workflow.id), [open.id]);
		assert.equal(summary.workflows[0].title, "Active feature");
		assert.equal(summary.workflows[0].nextAction, "Implement T3.");
		assert.equal(summary.workflows[0].packageWorkId, "2026-07-19-alpha");
		assert.deepEqual(summary.packages.map((pkg) => pkg.workId), ["2026-07-19-alpha", "2026-07-19-beta"]);
		assert.equal(summary.packages[0].workflowId, open.id);
		assert.deepEqual(summary.warnings, []);

		const all = statusSummary(root, { all: true });
		assert.deepEqual(new Set(all.workflows.map((workflow) => workflow.id)), new Set([open.id, closed.id]));
		assert.deepEqual(all.packages.map((pkg) => pkg.workId), ["2026-07-19-alpha", "2026-07-19-beta", "2026-07-19-gamma"]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("statusSummary surfaces optional package step provenance", () => {
	const root = workspace();
	try {
		const steps = {
			plan: { harness: "claude", model: "claude-fable-5", completed_at: "2026-07-20T18:00:00Z" },
			review: { harness: "pi", completed_at: "2026-07-20T19:00:00Z" },
		};
		writePackage(root, "2026-07-20-with-steps", { status: "implementing", steps });
		writePackage(root, "2026-07-20-without-steps", { status: "draft" });
		const summary = statusSummary(root);
		assert.deepEqual(summary.packages[0].steps, steps);
		assert.equal(summary.packages[1].steps, undefined);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
test("statusSummary reports malformed manifests as warnings without failing", async () => {
	const root = workspace();
	try {
		writePackage(root, "2026-07-19-good", { status: "draft" });
		const broken = join(root, "docs", "codepatrol", "2026-07-19-broken");
		mkdirSync(broken, { recursive: true });
		writeFileSync(join(broken, "handoff.yaml"), "{");

		const summary = statusSummary(root);
		assert.deepEqual(summary.packages.map((pkg) => pkg.workId), ["2026-07-19-good"]);
		assert.equal(summary.warnings.length, 1);
		assert.match(summary.warnings[0], /Skipped malformed artifact manifest/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("statusSummary is empty and successful on a bare workspace", () => {
	const root = workspace();
	try {
		assert.deepEqual(statusSummary(root), { workflows: [], packages: [], warnings: [] });
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
