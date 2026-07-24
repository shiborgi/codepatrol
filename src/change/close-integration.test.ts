import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { advanceThroughVerify } from "./git.test-helper.js";
import { closeChange } from "./orchestrator.js";
import * as trace from "./trace.js";

function git(workspace: string, args: string[]): string { return execFileSync("git", args, { cwd: workspace, encoding: "utf8" }).trim(); }
function at(second: number) { return { now: new Date(`2026-07-24T10:00:${String(second).padStart(2, "0")}.000Z`) }; }

describe("close integration: improvement report", () => {
	test("close writes the durable report, mirrors it, and deletes the trace", async () => {
		const workspace = mkdtempSync(join(tmpdir(), "codepatrol-close-report-"));
		try {
			writeFileSync(join(workspace, ".gitignore"), ".codepatrol/runtime/\ndocs/codepatrol/improvement-reports/\n");
			git(workspace, ["init", "-b", "main"]); writeFileSync(join(workspace, "README.md"), "baseline\n"); git(workspace, ["add", "."]); git(workspace, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "baseline"]);
			const id = "2026-07-24-close-report";
			await advanceThroughVerify(workspace, id);
			trace.append(workspace, id, { kind: "command", at: "2026-07-22T10:00:00.000Z", command: "change transition", args: {} });
			const { transitionChange } = await import("./orchestrator.js");
			await transitionChange(workspace, id, { type: "begin", actor: "trace-test", stage: "close", nextAction: "close" }, at(15));
			await transitionChange(workspace, id, { type: "usage", actor: "trace-test", stage: "close", run: { id: "close-usage", started_at: "2026-07-22T10:00:16Z", finished_at: "2026-07-22T10:00:17Z", elapsed_ms: 1000, characters: { status: "unavailable", reason: "test" } } }, at(17));
			const result = await closeChange(workspace, id, { outcome: "commit", actor: "trace-test", authority: "test" }, at(20));
			assert.equal(result.outcome, "committed");
			const reportPath = join(workspace, ".codepatrol", "changes", id, "close", "improvement-report.md");
			const mirrorPath = join(workspace, "docs", "codepatrol", "improvement-reports", `${id}.md`);
			assert.equal(existsSync(reportPath), true, "durable report should exist");
			assert.equal(existsSync(mirrorPath), true, "mirror should exist");
			const tracePath = join(workspace, ".codepatrol", "runtime", "traces", `${id}.jsonl`);
			assert.equal(existsSync(tracePath), false, "trace file should be deleted after Close");
		} finally { rmSync(workspace, { recursive: true, force: true }); }
	});
});
