import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkPlanPackage } from "./plan-check.js";

const baseSpec = `# Specification — Fixture

## Intent

Intent.

## Scope

Scope.

## Deferred constraints

| ID | Chosen simplification | Known ceiling | Observable trigger | Upgrade path |
|---|---|---|---|---|
| DC-1 | Keep fixture small | Different Markdown is ignored | C8 fires | Add the escaping fixture |

## Acceptance criteria

- AC-1: WHEN the fixture is checked, THE result is valid.
`;

const basePlan = `# Plan — Fixture

## Acceptance mapping

| Criterion | Task(s) | Verification |
|---|---|---|
| AC-1 | T1 | focused test |

## Dependency order

T1 only.

### T1 — Implement fixture

**Depends on:** —

**Files:**

**Purpose:** Satisfies AC-1.
`;

function fixture(specText = baseSpec, planText = basePlan) {
	const workspace = mkdtempSync(join(tmpdir(), "codepatrol-plan-check-"));
	const packageDirectory = join(workspace, "docs", "codepatrol", "2026-07-21-fixture");
	mkdirSync(packageDirectory, { recursive: true });
	return {
		workspace,
		packageDirectory,
		input: { workspace, packageDirectory, specText, planText },
	};
}

function run(specText = baseSpec, planText = basePlan): string[] {
	const context = fixture(specText, planText);
	try { return checkPlanPackage(context.input); }
	finally { rmSync(context.workspace, { recursive: true, force: true }); }
}

test("C1 reports a spec criterion absent from the plan", () => {
	const errors = run(baseSpec.replace("- AC-1:", "- AC-1:\n- AC-3:"));
	assert.ok(errors.includes("Acceptance criterion AC-3 in spec.md is not referenced by any plan task."), errors.join("\n"));
});

test("C2 reports a plan criterion absent from the spec", () => {
	const errors = run(baseSpec, basePlan.replace("| AC-1 |", "| AC-1, AC-9 |"));
	assert.ok(errors.includes("Plan references AC-9, which spec.md does not declare."), errors.join("\n"));
});

test("C3 reports dangling dependencies", () => {
	const errors = run(baseSpec, basePlan.replace("**Depends on:** —", "**Depends on:** T9"));
	assert.ok(errors.includes("Task T1 depends on T9, which does not exist."), errors.join("\n"));
});

test("C3 reports dependency cycles", () => {
	const plan = `${basePlan.replace("**Depends on:** —", "**Depends on:** T2")}\n### T2 — Second task\n\n**Depends on:** T1\n`;
	const errors = run(baseSpec, plan);
	assert.ok(errors.includes("Task dependency cycle at T1."), errors.join("\n"));
});

test("C4 reports missing Modify targets", () => {
	const errors = run(baseSpec, basePlan.replace("**Files:**", "**Files:**\n\n- Modify: `src/missing.ts`"));
	assert.ok(errors.includes("Task T1 declares Modify on src/missing.ts, which does not exist in the workspace."), errors.join("\n"));
});

test("C4 reports pre-existing Create targets", () => {
	const context = fixture(baseSpec, basePlan.replace("**Files:**", "**Files:**\n\n- Create: `src/existing.ts`"));
	try {
		mkdirSync(join(context.workspace, "src"), { recursive: true });
		writeFileSync(join(context.workspace, "src", "existing.ts"), "export {};\n");
		const errors = checkPlanPackage(context.input);
		assert.ok(errors.includes("Task T1 declares Create on src/existing.ts, which already exists in the workspace."), errors.join("\n"));
	} finally { rmSync(context.workspace, { recursive: true, force: true }); }
});

test("C4 rejects paths escaping the workspace without following them", () => {
	const errors = run(baseSpec, basePlan.replace("**Files:**", "**Files:**\n\n- Modify: `../outside.ts`"));
	assert.ok(errors.includes("Task T1 declares Modify on ../outside.ts, which escapes the workspace."), errors.join("\n"));
});

test("C5 reports a bare placeholder marker", () => {
	const errors = run(baseSpec, `${basePlan}\nTODO decide later.\n`);
	assert.ok(errors.includes("Placeholder marker TODO in plan.md."), errors.join("\n"));
});

test("C5 ignores marker names inside inline and fenced code", () => {
	const plan = `${basePlan}\nDocument \`TODO\` and \`???\`.\n\n\`\`\`text\nFIXME and <placeholder>\n\`\`\`\n`;
	assert.deepEqual(run(baseSpec, plan), []);
});

test("C6 reports each empty deferred-constraint field", () => {
	const fields = [
		["| DC-1 |  | Different Markdown is ignored | C8 fires | Add the escaping fixture |", "chosen simplification"],
		["| DC-1 | Keep fixture small |  | C8 fires | Add the escaping fixture |", "known ceiling"],
		["| DC-1 | Keep fixture small | Different Markdown is ignored |  | Add the escaping fixture |", "observable trigger"],
		["| DC-1 | Keep fixture small | Different Markdown is ignored | C8 fires |  |", "upgrade path"],
	] as const;
	for (const [row, label] of fields) {
		const spec = baseSpec.replace("| DC-1 | Keep fixture small | Different Markdown is ignored | C8 fires | Add the escaping fixture |", row);
		assert.ok(run(spec).includes(`Deferred constraint DC-1 is missing its ${label}.`), label);
	}
});

test("C7 reports missing required sections", () => {
	const errors = run(baseSpec.replace("## Acceptance criteria", "## Outcomes"));
	assert.ok(errors.includes("spec.md is missing the required section: ## Acceptance criteria."), errors.join("\n"));
});

test("C8 reports structures from which no criteria or tasks are parsed", () => {
	const errors = run(baseSpec.replace("- AC-1:", "Criterion 1:"), basePlan.replace("### T1 —", "### Task one —"));
	assert.ok(errors.includes("No acceptance criteria were parsed from spec.md."), errors.join("\n"));
	assert.ok(errors.includes("No tasks were parsed from plan.md."), errors.join("\n"));
});

test("a well-formed package passes every plan check", () => {
	assert.deepEqual(run(), []);
});
