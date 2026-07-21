import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodepatrolError } from "../shared/errors.js";
import { workflowArchiveRoot, workflowLedgerPath } from "../shared/state.js";
import { readWorkflowLedger } from "./store.js";
import {
	claimWorkflowItem,
	closeWorkflowItem,
	compactWorkflow,
	createWorkflowItem,
	primeWorkflow,
	readyWorkflowItems,
	rememberWorkflow,
	showWorkflowItem,
	updateWorkflowItem,
} from "./service.js";

function workspace(): string {
	return mkdtempSync(join(tmpdir(), "codepatrol-workflow-"));
}

test("workflow dependencies expose only actionable ready items and reject cycles", async () => {
	const root = workspace();
	try {
		const workflow = await createWorkflowItem(root, { kind: "workflow", title: "Ship native memory", nextAction: "Coordinate the plan." });
		assert.match(workflow.id, /^cpw-[a-f0-9]{12}$/);
		assert.equal(workflow.workflowId, workflow.id);

		const design = await createWorkflowItem(root, {
			kind: "decision", workflowId: workflow.id, title: "Fix the ledger schema", nextAction: "Compare native layouts.",
		});
		const implementation = await createWorkflowItem(root, {
			kind: "task", workflowId: workflow.id, title: "Implement the ledger",
			nextAction: "Write the failing persistence test.",
			acceptance: ["all service tests pass"],
		});
		await updateWorkflowItem(root, design.id, {
			relations: [{ type: "blocks", targetId: implementation.id }],
		});

		assert.deepEqual((await readyWorkflowItems(root, workflow.id)).map((item) => item.id), [design.id]);
		await assert.rejects(
			updateWorkflowItem(root, implementation.id, {
				relations: [{ type: "blocks", targetId: design.id }],
			}),
			(error: unknown) => error instanceof CodepatrolError && error.code === "WORKFLOW_INVALID" && /cycle/i.test(error.message),
		);

		await closeWorkflowItem(root, design.id, { summary: "Schema accepted." });
		assert.deepEqual((await readyWorkflowItems(root, workflow.id)).map((item) => item.id), [implementation.id]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("workflow claims are atomic and only one actor wins", async () => {
	const root = workspace();
	try {
		const workflow = await createWorkflowItem(root, { kind: "workflow", title: "Concurrent execution", nextAction: "Plan execution." });
		const task = await createWorkflowItem(root, { kind: "task", workflowId: workflow.id, title: "Run one worker", nextAction: "Claim the task." });
		const attempts = await Promise.allSettled([
			claimWorkflowItem(root, task.id, "codex"),
			claimWorkflowItem(root, task.id, "pi"),
		]);
		assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
		const rejected = attempts.find((attempt) => attempt.status === "rejected") as PromiseRejectedResult;
		assert.ok(rejected.reason instanceof CodepatrolError);
		assert.equal(rejected.reason.code, "WORKFLOW_CONFLICT");
		assert.equal((await showWorkflowItem(root, task.id)).status, "in-progress");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("prime resumes a workflow with project memory inside the requested context budget", async () => {
	const root = workspace();
	try {
		const workflow = await createWorkflowItem(root, {
			kind: "workflow", title: "Reference-driven proposal", summary: "Design the target project, not Codepatrol.", nextAction: "Coordinate the proposal.",
		});
		await rememberWorkflow(root, {
			workflowId: workflow.id,
			scope: "project",
			title: "Reference policy",
			summary: "Extract concepts from GitHub references and adapt them to the project being built; never integrate automatically.",
			artifacts: ["docs/reference-concepts.md"],
		});
		await createWorkflowItem(root, {
			kind: "task", workflowId: workflow.id, title: "Write proposal", nextAction: "Compare two native designs.",
		});

		const primed = await primeWorkflow(root, { workflowId: workflow.id, budget: 128 });
		assert.equal(primed.workflowId, workflow.id);
		assert.ok(primed.context.length <= 128 * 4);
		assert.match(primed.context, /Reference-driven proposal/);
		assert.match(primed.context, /Reference policy/);
		assert.match(primed.context, /Write proposal/);
		assert.match(primed.context, /Compare two native designs/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("prime lists other active roots when resuming by recency", async () => {
	const root = workspace();
	try {
		const older = await createWorkflowItem(root, { kind: "workflow", title: "Older active", nextAction: "Old plan." }, { now: new Date("2026-01-01T00:00:00.000Z") });
		const newer = await createWorkflowItem(root, { kind: "workflow", title: "Newer active", nextAction: "New plan." });

		const primed = await primeWorkflow(root);
		assert.equal(primed.workflowId, newer.id);
		assert.deepEqual(primed.otherActiveWorkflows, [{ id: older.id, title: "Older active", status: "open", updatedAt: older.updatedAt }]);

		const explicit = await primeWorkflow(root, { workflowId: older.id });
		assert.equal(explicit.workflowId, older.id);
		assert.equal(explicit.otherActiveWorkflows, undefined);

		await closeWorkflowItem(root, older.id, { summary: "done" });
		const single = await primeWorkflow(root);
		assert.equal(single.workflowId, newer.id);
		assert.equal(single.otherActiveWorkflows, undefined);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("compaction archives old closed work while preserving decisions and references", async () => {
	const root = workspace();
	try {
		const january = new Date("2026-01-01T00:00:00.000Z");
		const workflow = await createWorkflowItem(root, { kind: "workflow", title: "Long work", nextAction: "Manage long work." }, { now: january });
		const task = await createWorkflowItem(root, {
			kind: "task", workflowId: workflow.id, title: "Old task", nextAction: "Plan the implementation.", summary: "x".repeat(800), artifacts: ["docs/plan.md"],
		}, { now: january });
		const decision = await createWorkflowItem(root, {
			kind: "decision", workflowId: workflow.id, title: "Keep this decision", nextAction: "Document the choice.", summary: "Use a native ledger.",
		}, { now: january });
		await claimWorkflowItem(root, task.id, "codex", { now: january });
		await closeWorkflowItem(root, task.id, { summary: "Completed with extensive implementation evidence. ".repeat(20) }, { now: january });
		await closeWorkflowItem(root, decision.id, { summary: "Use a native ledger." }, { now: january });

		const result = await compactWorkflow(root, { workflowId: workflow.id, olderThanDays: 30 }, { now: new Date("2026-03-01T00:00:00.000Z") });
		assert.deepEqual(result.compacted, [task.id]);
		const compacted = await showWorkflowItem(root, task.id);
		assert.ok(compacted.compacted);
		assert.deepEqual(compacted.artifacts, ["docs/plan.md"]);
		assert.equal((await showWorkflowItem(root, decision.id)).compacted, undefined);
		assert.ok(existsSync(join(workflowArchiveRoot(root), `${task.id}.json`)));
		assert.match(readFileSync(join(workflowArchiveRoot(root), `${task.id}.json`), "utf8"), /extensive implementation evidence/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("corrupt or incompatible workflow state fails explicitly", async () => {
	const root = workspace();
	try {
		mkdirSync(join(root, ".codepatrol", "workflows"), { recursive: true });
		writeFileSync(workflowLedgerPath(root), JSON.stringify({ version: 99, items: {} }));
		await assert.rejects(
			showWorkflowItem(root, "cpw-missing"),
			(error: unknown) => error instanceof CodepatrolError && error.code === "STATE_INCOMPATIBLE",
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("workflow state transitions cannot bypass claims or close results", async () => {
	const root = workspace();
	try {
		const workflow = await createWorkflowItem(root, { kind: "workflow", title: "Guard transitions", nextAction: "Guard the transitions." });
		await assert.rejects(
			createWorkflowItem(root, { kind: "task", workflowId: workflow.id, title: "Already running", status: "in-progress" }),
			(error: unknown) => error instanceof CodepatrolError && error.code === "WORKFLOW_INVALID" && /claim/i.test(error.message),
		);
		const task = await createWorkflowItem(root, { kind: "task", workflowId: workflow.id, title: "Guarded task", nextAction: "Implement guarded task." });
		await assert.rejects(
			updateWorkflowItem(root, task.id, { status: "in-progress" }),
			(error: unknown) => error instanceof CodepatrolError && error.code === "WORKFLOW_INVALID" && /claim/i.test(error.message),
		);
		await assert.rejects(
			updateWorkflowItem(root, task.id, { status: "closed" }),
			(error: unknown) => error instanceof CodepatrolError && error.code === "WORKFLOW_INVALID" && /workflow close/i.test(error.message),
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("workflow hierarchy rejects parent cycles", async () => {
	const root = workspace();
	try {
		const workflow = await createWorkflowItem(root, { kind: "workflow", title: "Hierarchy", nextAction: "Track hierarchy." });
		const parent = await createWorkflowItem(root, { kind: "task", workflowId: workflow.id, title: "Parent", nextAction: "Outline parent." });
		const child = await createWorkflowItem(root, { kind: "task", workflowId: workflow.id, title: "Child", nextAction: "Plan child work.", parentId: parent.id });
		await assert.rejects(
			updateWorkflowItem(root, parent.id, { parentId: child.id }),
			(error: unknown) => error instanceof CodepatrolError && error.code === "WORKFLOW_INVALID" && /parent.*cycle/i.test(error.message),
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("structurally corrupt workflow items fail before commands consume them", async () => {
	const root = workspace();
	try {
		mkdirSync(join(root, ".codepatrol", "workflows"), { recursive: true });
		writeFileSync(workflowLedgerPath(root), JSON.stringify({
			version: 1,
			updatedAt: "not-a-date",
			items: { broken: { schemaVersion: 1, id: "broken", kind: "task" } },
		}));
		await assert.rejects(
			showWorkflowItem(root, "broken"),
			(error: unknown) => error instanceof CodepatrolError && error.code === "WORKFLOW_INVALID" && /ledger/i.test(error.message),
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("task and workflow closure cannot bypass claims or unfinished children", async () => {
	const root = workspace();
	try {
		const workflow = await createWorkflowItem(root, { kind: "workflow", title: "Close safely", nextAction: "Close safely." });
		const task = await createWorkflowItem(root, { kind: "task", workflowId: workflow.id, title: "Must be claimed", nextAction: "Claim the task." });
		await assert.rejects(
			closeWorkflowItem(root, task.id, { summary: "Bypassed execution." }),
			(error: unknown) => error instanceof CodepatrolError && error.code === "WORKFLOW_CONFLICT" && /claim/i.test(error.message),
		);
		await assert.rejects(
			closeWorkflowItem(root, workflow.id, { summary: "Finished too early." }),
			(error: unknown) => error instanceof CodepatrolError && error.code === "WORKFLOW_CONFLICT" && /unfinished/i.test(error.message),
		);
		await claimWorkflowItem(root, task.id, "codex");
		await closeWorkflowItem(root, task.id, { summary: "Verified." });
		assert.equal((await closeWorkflowItem(root, workflow.id, { summary: "All accepted work is complete." })).status, "closed");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("workflow commands validate missing memory input and unknown ready roots", async () => {
	const root = workspace();
	try {
		await assert.rejects(
			rememberWorkflow(root, undefined as never),
			(error: unknown) => error instanceof CodepatrolError && error.code === "WORKFLOW_INVALID",
		);
		await assert.rejects(
			readyWorkflowItems(root, "cpw-doesnotexist"),
			(error: unknown) => error instanceof CodepatrolError && error.code === "WORKFLOW_NOT_FOUND",
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("creating an actionable item without nextAction is rejected", async () => {
	const root = workspace();
	try {
		await assert.rejects(
			createWorkflowItem(root, { kind: "workflow", title: "No next action" }),
			(error: unknown) => error instanceof CodepatrolError && error.code === "WORKFLOW_INVALID" && /nextAction/.test(error.message),
		);
		await assert.rejects(
			createWorkflowItem(root, { kind: "task", workflowId: "cpw-missing", title: "Orphan no next action" }),
			(error: unknown) => error instanceof CodepatrolError && /workflowId must reference a workflow root|nextAction/.test((error as Error).message),
		);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("updating a non-closed item with nextAction null is rejected", async () => {
	const root = workspace();
	try {
		const workflow = await createWorkflowItem(root, { kind: "workflow", title: "Strict root", nextAction: "Plan the rollout." });
		const task = await createWorkflowItem(root, { kind: "task", workflowId: workflow.id, title: "Strict task", nextAction: "Draft the test." });
		await assert.rejects(
			updateWorkflowItem(root, task.id, { nextAction: null }),
			(error: unknown) => error instanceof CodepatrolError && error.code === "WORKFLOW_INVALID" && /close/.test(error.message),
		);
		await assert.rejects(
			updateWorkflowItem(root, task.id, { nextAction: "" }),
			(error: unknown) => error instanceof CodepatrolError && error.code === "WORKFLOW_INVALID" && /nextAction must be a non-empty string/.test(error.message),
		);
		const replaced = await updateWorkflowItem(root, task.id, { nextAction: "Re-target the test." });
		assert.equal(replaced.nextAction, "Re-target the test.");
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("workflow close removes nextAction and closed records without it remain valid", async () => {
	const root = workspace();
	try {
		const workflow = await createWorkflowItem(root, { kind: "workflow", title: "Closed invariant", nextAction: "Plan the rollout." });
		const task = await createWorkflowItem(root, { kind: "task", workflowId: workflow.id, title: "Conclude the work", nextAction: "Run the focused regression test." });
		await claimWorkflowItem(root, task.id, "codex");
		const closed = await closeWorkflowItem(root, task.id, { summary: "All tests pass." });
		assert.equal(closed.status, "closed");
		assert.equal(closed.nextAction, undefined, "close removes nextAction from the record");
		const reloaded = await showWorkflowItem(root, task.id);
		assert.equal(reloaded.status, "closed");
		assert.equal(reloaded.nextAction, undefined);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("malformed ledger with a non-closed item missing nextAction is rejected on load", () => {
	const root = workspace();
	try {
		mkdirSync(join(root, ".codepatrol", "workflows"), { recursive: true });
		writeFileSync(workflowLedgerPath(root), JSON.stringify({
			version: 1,
			updatedAt: new Date().toISOString(),
			items: {
				"cpw-malformed": {
					schemaVersion: 1,
					id: "cpw-malformed",
					workflowId: "cpw-malformed",
					kind: "workflow",
					scope: "workflow",
					title: "Malformed root",
					summary: "",
					status: "open",
					priority: 2,
					relations: [],
					acceptance: [],
					artifacts: [],
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
				},
			},
		}));
		assert.throws(
			() => readWorkflowLedger(root),
			(error: unknown) => error instanceof CodepatrolError
				&& error.code === "WORKFLOW_INVALID"
				&& /cpw-malformed/.test((error as Error).message),
		);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("prime prioritizes actionable resume state over a large project-memory history", async () => {
	const root = workspace();
	try {
		const workflow = await createWorkflowItem(root, { kind: "workflow", title: "Bounded resume", nextAction: "Bound the resume." });
		const task = await createWorkflowItem(root, {
			kind: "task", workflowId: workflow.id, title: "Immediate task", nextAction: "Run the focused regression test.",
		});
		for (let index = 0; index < 5; index++) {
			await rememberWorkflow(root, {
				workflowId: workflow.id,
				title: `Historical memory ${index}`,
				summary: `Background ${index}: ${"long context ".repeat(30)}`,
			});
		}
		const primed = await primeWorkflow(root, { workflowId: workflow.id, budget: 128 });
		assert.match(primed.context, new RegExp(`Ready: ${task.title}`));
		assert.match(primed.context, /Run the focused regression test/);
		assert.ok(primed.context.length <= 128 * 4);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
