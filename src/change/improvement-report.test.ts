import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as report from "./improvement-report.js";
import { stringify } from "yaml";
import * as trace from "./trace.js";

function seedChange(workspace: string, id: string): void {
	mkdirSync(join(workspace, ".codepatrol", "changes", id, "plan"), { recursive: true });
	mkdirSync(join(workspace, ".codepatrol", "changes", id, "review"), { recursive: true });
	mkdirSync(join(workspace, ".codepatrol", "changes", id, "close"), { recursive: true });
	const spec = "# Specification\n";
	const plan = "# Plan\n";
	const review = "# Review\n";
	const receipt = "# Receipt\n";
	writeFileSync(join(workspace, ".codepatrol", "changes", id, "plan", "spec.md"), spec);
	writeFileSync(join(workspace, ".codepatrol", "changes", id, "plan", "plan.md"), plan);
	writeFileSync(join(workspace, ".codepatrol", "changes", id, "review", "report.md"), review);
	writeFileSync(join(workspace, ".codepatrol", "changes", id, "close", "receipt.md"), receipt);
	const record = {
		schema_version: 2,
		identity: { work_id: id, title: "Test", created_at: "2026-07-24T00:00:00.000Z", branch: `codepatrol/${id}`, target_branch: "main", base_commit: "0".repeat(40) },
		events: [
			{ id: "1", type: "change-started", at: "2026-07-24T00:00:00.000Z", actor: "codex", stage: "plan", attempt: 1, next_action: "plan" },
			{ id: "2", type: "run-recorded", at: "2026-07-24T00:01:00.000Z", actor: "codex", stage: "plan", attempt: 1, run: { id: "p1", started_at: "2026-07-24T00:00:00.000Z", finished_at: "2026-07-24T00:01:00.000Z", elapsed_ms: 60000, characters: { status: "unavailable", reason: "test" } } },
			{ id: "3", type: "stage-checkpointed", at: "2026-07-24T00:01:01.000Z", actor: "codex", stage: "plan", attempt: 1, result: "ready", checkpoint: "a".repeat(40), tree: "b".repeat(40), artifacts: [], next_action: "review" },
			{ id: "4", type: "stage-returned", at: "2026-07-24T00:02:00.000Z", actor: "reviewer", stage: "review", attempt: 1, to_stage: "plan", reason: "minor defect", next_action: "plan" },
			{ id: "5", type: "stage-returned", at: "2026-07-24T00:03:00.000Z", actor: "reviewer", stage: "review", attempt: 1, to_stage: "plan", reason: "second defect", next_action: "plan" },
		],
	};
	writeFileSync(join(workspace, ".codepatrol", "changes", id, "change.yaml"), stringify(record));
}

describe("improvement-report", () => {
	test("generateImprovementReport returns the 7 required sections with non-empty values", () => {
		const workspace = mkdtempSync(join(tmpdir(), "codepatrol-report-"));
		try {
			const id = "2026-07-24-report";
			seedChange(workspace, id);
			trace.append(workspace, id, { kind: "command", at: "2026-07-24T00:00:00.000Z", command: "change transition", args: {} });
			trace.append(workspace, id, { kind: "event", at: "2026-07-24T00:00:01.000Z", stage: "plan", attempt: 1, type: "change-started" });
			trace.append(workspace, id, { kind: "event", at: "2026-07-24T00:01:00.000Z", stage: "plan", attempt: 1, type: "stage-checkpointed" });
			trace.append(workspace, id, { kind: "event", at: "2026-07-24T00:02:00.000Z", stage: "review", attempt: 1, type: "stage-returned" });
			trace.append(workspace, id, { kind: "error", at: "2026-07-24T00:02:30.000Z", command: "change transition", code: "CHANGE_CONFLICT", message: "Duplicate run id: p1." });
			const result = report.generateImprovementReport(workspace, id);
			assert.equal(typeof result.summary, "string");
			assert.ok(result.perStage.plan);
			assert.equal(result.perStage.plan.attemptCount, 1);
			assert.equal(result.perStage.review.attemptCount, 1);
			assert.equal(result.perStage.review.returnCount, 2);
			assert.equal(result.returns.length, 2);
			assert.equal(result.returns[0]?.reason, "minor defect");
			assert.ok(result.topErrors.length >= 1);
			assert.equal(result.topErrors[0]?.code, "CHANGE_CONFLICT");
			assert.ok(typeof result.elapsedPerStage.plan === "number");
			assert.ok(result.artifactStats.count >= 4);
			assert.ok(result.recommendations.length >= 1);
		} finally { rmSync(workspace, { recursive: true, force: true }); }
	});

	test("generateImprovementReport returns the empty-shape recommendations when no trace exists", () => {
		const workspace = mkdtempSync(join(tmpdir(), "codepatrol-report-"));
		try {
			const result = report.generateImprovementReport(workspace, "2026-07-24-missing");
			assert.equal(result.perStage.plan.attemptCount, 0);
			assert.deepEqual(result.returns, []);
			assert.deepEqual(result.topErrors, []);
			assert.equal(result.artifactStats.count, 0);
			assert.equal(result.recommendations.length, 1);
			assert.match(result.recommendations[0] ?? "", /No trace/);
		} finally { rmSync(workspace, { recursive: true, force: true }); }
	});

	test("writeImprovementReport writes the markdown report to the change close dir", () => {
		const workspace = mkdtempSync(join(tmpdir(), "codepatrol-report-"));
		try {
			const id = "2026-07-24-write";
			seedChange(workspace, id);
			trace.append(workspace, id, { kind: "command", at: "2026-07-24T00:00:00.000Z", command: "change transition", args: {} });
			const path = report.writeImprovementReport(workspace, id);
			assert.equal(path, `${workspace}/.codepatrol/changes/${id}/close/improvement-report.md`);
			assert.equal(existsSync(path), true);
			const content = readFileSync(path, "utf8");
			assert.match(content, /^# Improvement report/);
			assert.match(content, /## Summary/);
			assert.match(content, /## Per-stage attempts/);
			assert.match(content, /## Returns/);
			assert.match(content, /## Top errors/);
			assert.match(content, /## Elapsed per stage/);
			assert.match(content, /## Artifact stats/);
			assert.match(content, /## Recommendations/);
		} finally { rmSync(workspace, { recursive: true, force: true }); }
	});

	test("mirrorImprovementReport copies the report to the docs mirror directory", () => {
		const workspace = mkdtempSync(join(tmpdir(), "codepatrol-report-"));
		try {
			const id = "2026-07-24-mirror";
			seedChange(workspace, id);
			trace.append(workspace, id, { kind: "command", at: "2026-07-24T00:00:00.000Z", command: "change transition", args: {} });
			const source = report.writeImprovementReport(workspace, id);
			const mirror = report.mirrorImprovementReport(workspace, id, source);
			assert.equal(mirror, `${workspace}/docs/codepatrol/improvement-reports/${id}.md`);
			assert.equal(existsSync(mirror), true);
			assert.equal(readFileSync(mirror, "utf8"), readFileSync(source, "utf8"));
		} finally { rmSync(workspace, { recursive: true, force: true }); }
	});
});
