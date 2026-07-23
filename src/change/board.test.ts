import test from "node:test";
import assert from "node:assert/strict";
import { projectKanban, renderKanbanMarkdown } from "./board.js";
import type { ChangeView } from "./types.js";

test("Kanban columns and ordering are deterministic", () => {
	const markdown = renderKanbanMarkdown({ generatedAsOf: null, rows: [] });
	assert.equal(markdown, "| Work | Branch | Plan | Review | Apply | Verify | Close | Total |\n|---|---|---|---|---|---|---|---|\n");
});

test("Kanban is locale independent and reports partial token coverage", () => {
	const view: ChangeView = {
		identity: { work_id: "2026-07-22-b", title: "B", created_at: "2026-07-22T00:00:00Z", branch: "codepatrol/2026-07-22-b", target_branch: "main", base_commit: "a".repeat(40) },
		stage: "plan", attempt: 1, state: "active", nextAction: "codepatrol-plan 2026-07-22-b", revision: 1,
		attempts: {
			plan: [{ attempt: 1, status: "active", artifacts: [], runs: [{ id: "r", started_at: "2026-07-22T00:00:00Z", finished_at: "2026-07-22T00:00:01Z", elapsed_ms: 1000, tokens: { status: "unavailable", reason: "no hook" } }] }],
			review: [], apply: [], verify: [], close: [],
		},
		usage: { activeMs: 1000, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0, measuredRuns: 0, totalRuns: 1, coverage: "0/1", complete: false } },
	};
	const output = renderKanbanMarkdown(projectKanban([view]));
	assert.match(output, /0~t 0\/1/); assert.match(output, /codepatrol\/2026-07-22-b/);
	assert.match(output, /next: codepatrol-plan 2026-07-22-b/);
	assert.match(renderKanbanMarkdown(projectKanban([view], { asOf: "2026-07-22T00:01:00Z" })), /cycle 1m00s/);
});
