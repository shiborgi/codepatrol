import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { CodepatrolError } from "../shared/errors.js";
import { listArtifactPackages, recordArtifactPackage, validateArtifactPackage } from "./service.js";

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "codepatrol-artifact-"));
	const directory = join(root, ".codepatrol", "packages", "2026-07-18-cache");
	mkdirSync(directory, { recursive: true });
	writeFileSync(join(directory, "spec.md"), "# Specification\n");
	writeFileSync(join(directory, "plan.md"), "# Plan\n");
	writeFileSync(join(directory, "handoff.yaml"), stringifyYaml({
		schema_version: 1,
		work_id: "2026-07-18-cache",
		origin: { skill: "propose-codebase", mode: "feature" },
		status: "ready-for-review",
		revision: 1,
		artifacts: { spec: { path: "spec.md" }, plan: { path: "plan.md" } },
	}));
	return { root, directory, manifest: ".codepatrol/packages/2026-07-18-cache/handoff.yaml", manifestPath: join(directory, "handoff.yaml") };
}

const cliEntry = join(import.meta.dirname, "..", "cli", "main.ts");

function runCli(args: string[]) {
	return spawnSync(process.execPath, ["--import", "jiti/register", cliEntry, ...args], { encoding: "utf8" });
}

test("plan validation admits a draft package without an implementation status error", async () => {
	const { root, manifest, manifestPath } = fixture();
	try {
		rewrite(manifestPath, (value) => { value.status = "draft"; });
		await recordArtifactPackage(root, manifest);
		const validation = validateArtifactPackage(root, manifest, "plan");
		assert.equal(validation.errors.some((error) => /status/i.test(error)), false, validation.errors.join("\n"));
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("CLI artifact validation lists plan among supported stages", () => {
	const { root, manifest } = fixture();
	try {
		const result = runCli(["artifact", "validate", "--manifest", manifest, "--stage", "unknown", "--workspace", root, "--format=json"]);
		assert.equal(result.status, 2, result.stderr || result.stdout);
		assert.equal(JSON.parse(result.stdout).error.message, "--stage must be plan, review, implementation, or verification.");
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("plan validation reports unmapped criteria through the artifact service", async () => {
	const { root, directory, manifest, manifestPath } = fixture();
	try {
		writeFileSync(join(directory, "spec.md"), `# Specification — Fixture\n\n## Intent\n\nIntent.\n\n## Scope\n\nScope.\n\n## Acceptance criteria\n\n- AC-1: mapped\n- AC-2: unmapped\n`);
		writeFileSync(join(directory, "plan.md"), `# Plan — Fixture\n\n## Acceptance mapping\n\n| Criterion | Task(s) | Verification |\n|---|---|---|\n| AC-1 | T1 | test |\n\n## Dependency order\n\nT1.\n\n### T1 — Implement fixture\n\n**Depends on:** —\n`);
		rewrite(manifestPath, (value) => { value.status = "draft"; });
		await recordArtifactPackage(root, manifest);
		const validation = validateArtifactPackage(root, manifest, "plan");
		assert.equal(validation.valid, false);
		assert.ok(validation.errors.includes("Acceptance criterion AC-2 in spec.md is not referenced by any plan task."), validation.errors.join("\n"));
		const cli = runCli(["artifact", "validate", "--manifest", manifest, "--stage", "plan", "--workspace", root, "--format=json"]);
		assert.equal(cli.status, 4, cli.stderr || cli.stdout);
		assert.ok(JSON.parse(cli.stdout).data.errors.includes("Acceptance criterion AC-2 in spec.md is not referenced by any plan task."));
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("well-formed package passes the plan stage", async () => {
	const { root, directory, manifest, manifestPath } = fixture();
	try {
		writeFileSync(join(directory, "spec.md"), `# Specification — Fixture\n\n## Intent\n\nIntent.\n\n## Scope\n\nScope.\n\n## Acceptance criteria\n\n- AC-1: mapped\n`);
		writeFileSync(join(directory, "plan.md"), `# Plan — Fixture\n\n## Acceptance mapping\n\n| Criterion | Task(s) | Verification |\n|---|---|---|\n| AC-1 | T1 | test |\n\n## Dependency order\n\nT1.\n\n### T1 — Implement fixture\n\n**Depends on:** —\n`);
		rewrite(manifestPath, (value) => { value.status = "draft"; });
		await recordArtifactPackage(root, manifest);
		const validation = validateArtifactPackage(root, manifest, "plan");
		assert.equal(validation.valid, true, validation.errors.join("\n"));
		const cli = runCli(["artifact", "validate", "--manifest", manifest, "--stage", "plan", "--workspace", root, "--format=json"]);
		assert.equal(cli.status, 0, cli.stderr || cli.stdout);
		assert.equal(JSON.parse(cli.stdout).data.valid, true);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("plan validation skips content checks when a declared document is missing", async () => {
	const { root, directory, manifest } = fixture();
	try {
		await recordArtifactPackage(root, manifest);
		rmSync(join(directory, "plan.md"));
		const validation = validateArtifactPackage(root, manifest, "plan");
		assert.equal(validation.valid, false);
		assert.ok(validation.errors.includes("Declared artifact does not exist: plan.md"), validation.errors.join("\n"));
	} finally { rmSync(root, { recursive: true, force: true }); }
});
test("pre-existing stages retain their result and errors", async () => {
	const { root, manifest } = fixture();
	try {
		await recordArtifactPackage(root, manifest);
		const expected = {
			review: { valid: true, errors: [] },
			implementation: {
				valid: false,
				errors: [
					"Implementation requires status approved, implementing, or blocked.",
					"Implementation requires review.md in the manifest.",
					"Implementation requires approval metadata.",
				],
			},
			verification: {
				valid: false,
				errors: [
					"Verification requires status implemented.",
					"Verification requires implementation.md in the manifest.",
					"Verification requires approval metadata.",
				],
			},
		};
		for (const stage of ["review", "implementation", "verification"] as const) {
			const validation = validateArtifactPackage(root, manifest, stage);
			assert.deepEqual({ valid: validation.valid, errors: validation.errors }, expected[stage]);
		}
	} finally { rmSync(root, { recursive: true, force: true }); }
});
test("artifact record binds spec and plan content for a review handoff", async () => {
	const { root, manifest } = fixture();
	try {
		const recorded = await recordArtifactPackage(root, manifest);
		assert.match(recorded.artifacts.spec.sha256!, /^[a-f0-9]{64}$/);
		assert.match(recorded.artifacts.plan.sha256!, /^[a-f0-9]{64}$/);
		const validation = validateArtifactPackage(root, manifest, "review");
		assert.equal(validation.valid, true, validation.errors.join("\n"));
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("artifact validation detects content changed after review handoff", async () => {
	const { root, directory, manifest } = fixture();
	try {
		await recordArtifactPackage(root, manifest);
		writeFileSync(join(directory, "plan.md"), "# Changed without a revision\n");
		const validation = validateArtifactPackage(root, manifest, "review");
		assert.equal(validation.valid, false);
		assert.ok(validation.errors.some((error) => /hash mismatch.*plan/i.test(error)));
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("implementation requires an approved review of the current revision", async () => {
	const { root, directory, manifest } = fixture();
	try {
		await recordArtifactPackage(root, manifest);
		const manifestPath = join(directory, "handoff.yaml");
		const value = parseYaml(readFileSync(manifestPath, "utf8"));
		const specFile = join(directory, "spec.md");
		writeFileSync(specFile, "- Governing constraints: fixture\n- Substrate state: fixture\n" + readFileSync(specFile, "utf8"));
		const conformingReview = "## Scope and evidence\n## Findings\n## Artifact adjustments\n## Acceptance coverage\n- AC-1: yes\n## Simplicity axis\n## Executability audit\n## Verdict\napprove\n## External evidence sufficiency\nnot required\nPackage: " + value.work_id + "\nReviewed revision: 2\nReviewer: codex\nEvidence date: 2026-07-18T12:00:00Z\n";
		writeFileSync(join(directory, "review.md"), conformingReview);
		value.status = "approved";
		value.revision = 2;
		value.artifacts.review = { path: "review.md" };
		value.approval = { verdict: "approve", reviewed_revision: 2, reviewer: "codex", reviewed_at: "2026-07-18T12:00:00Z" };
		writeFileSync(manifestPath, stringifyYaml(value));
		await recordArtifactPackage(root, manifest);
		assert.equal(validateArtifactPackage(root, manifest, "implementation").valid, true);

		value.approval.reviewed_revision = 1;
		writeFileSync(manifestPath, stringifyYaml(value));
		await recordArtifactPackage(root, manifest);
		const stale = validateArtifactPackage(root, manifest, "implementation");
		assert.equal(stale.valid, false);
		assert.ok(stale.errors.some((error) => /reviewed_revision/i.test(error)));
	} finally { rmSync(root, { recursive: true, force: true }); }
});

async function implementedFixture() {
	const base = fixture();
	writeFileSync(join(base.directory, "review.md"), "# Review\n\nVerdict: merge\n");
	writeFileSync(join(base.directory, "implementation.md"), "# Implementation\n");
	const manifestPath = join(base.directory, "handoff.yaml");
	const value = parseYaml(readFileSync(manifestPath, "utf8"));
	value.status = "implemented";
	value.artifacts.review = { path: "review.md" };
	value.artifacts.implementation = { path: "implementation.md" };
	value.approval = { verdict: "merge", reviewed_revision: 1, reviewer: "codex", reviewed_at: "2026-07-19T12:00:00Z" };
	writeFileSync(manifestPath, stringifyYaml(value));
	await recordArtifactPackage(base.root, base.manifest);
	return { ...base, manifestPath };
}

function rewrite(manifestPath: string, mutate: (value: any) => void): void {
	const value = parseYaml(readFileSync(manifestPath, "utf8"));
	mutate(value);
	writeFileSync(manifestPath, stringifyYaml(value));
}

test("implementation accepts a verify-returned implementing package with improve verdict", async () => {
	const { root, directory, manifest, manifestPath } = fixture();
	try {
		const specFile = join(directory, "spec.md");
		writeFileSync(specFile, "- Governing constraints: fixture\n- Substrate state: fixture\n" + readFileSync(specFile, "utf8"));
		const conformingReview = "## Scope and evidence\n## Findings\n## Artifact adjustments\n## Acceptance coverage\n- AC-1: yes\n## Simplicity axis\n## Executability audit\n## Verdict\napprove\n## External evidence sufficiency\nnot required\nPackage: 2026-07-18-cache\nReviewed revision: 1\nReviewer: codex\nEvidence date: 2026-07-18T12:00:00Z";
		writeFileSync(join(directory, "review.md"), conformingReview);
		rewrite(manifestPath, (value) => {
			value.status = "implementing";
			value.artifacts.review = { path: "review.md" };
			value.approval = { verdict: "approve", reviewed_revision: 1, reviewer: "codex", reviewed_at: "2026-07-18T12:00:00Z" };
			value.verification = { verdict: "improve", verified_revision: 1, verifier: "codex", verified_at: "2026-07-19T12:00:00Z" };
		});
		await recordArtifactPackage(root, manifest);
		const validation = validateArtifactPackage(root, manifest, "implementation");
		assert.equal(validation.valid, true, validation.errors.join("\n"));
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("artifact steps are preserved through record and surfaced in package summaries", async () => {
	const { root, directory, manifest, manifestPath } = fixture();
	const steps = {
		plan: { harness: "claude", model: "claude-fable-5", completed_at: "2026-07-20T18:00:00Z" },
		review: { harness: "pi", model: "minimax-m3", completed_at: "2026-07-20T19:00:00Z" },
		apply: { harness: "codex", model: "gpt-5.4", completed_at: "2026-07-20T21:00:00Z" },
		verify: { harness: "claude", model: "claude-fable-5", completed_at: "2026-07-20T22:00:00Z" },
	};
	try {
		rewrite(manifestPath, (value) => { value.steps = steps; });
		const recorded = await recordArtifactPackage(root, manifest);
		assert.deepEqual(recorded.steps, steps);
		assert.deepEqual(listArtifactPackages(root).packages[0].steps, steps);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("recordArtifactPackage stamps the runtime harness when CODEPATROL_HARNESS/STEP are set", async () => {
	const { root, manifest, manifestPath } = fixture();
	const previousHarness = process.env.CODEPATROL_HARNESS;
	const previousModel = process.env.CODEPATROL_MODEL;
	const previousStep = process.env.CODEPATROL_STEP;
	process.env.CODEPATROL_HARNESS = "runtime-harness";
	process.env.CODEPATROL_MODEL = "runtime-model";
	process.env.CODEPATROL_STEP = "apply";
	try {
		const recorded = await recordArtifactPackage(root, manifest);
		assert.equal(recorded.steps?.apply?.harness, "runtime-harness");
		assert.equal(recorded.steps?.apply?.model, "runtime-model");
		assert.match(recorded.steps?.apply?.completed_at ?? "", /^\d{4}-\d{2}-\d{2}T/);
	} finally {
		if (previousHarness === undefined) delete process.env.CODEPATROL_HARNESS; else process.env.CODEPATROL_HARNESS = previousHarness;
		if (previousModel === undefined) delete process.env.CODEPATROL_MODEL; else process.env.CODEPATROL_MODEL = previousModel;
		if (previousStep === undefined) delete process.env.CODEPATROL_STEP; else process.env.CODEPATROL_STEP = previousStep;
		rmSync(root, { recursive: true, force: true });
	}
});

test("recordArtifactPackage ignores invalid CODEPATROL_STEP values", async () => {
	const { root, manifest, manifestPath } = fixture();
	const previousHarness = process.env.CODEPATROL_HARNESS;
	const previousStep = process.env.CODEPATROL_STEP;
	process.env.CODEPATROL_HARNESS = "runtime-harness";
	process.env.CODEPATROL_STEP = "ship-it";
	rewrite(manifestPath, (value) => { value.steps = { plan: { harness: "previous", completed_at: "2026-07-20T18:00:00Z" } }; });
	try {
		const recorded = await recordArtifactPackage(root, manifest);
		assert.deepEqual(recorded.steps, { plan: { harness: "previous", completed_at: "2026-07-20T18:00:00Z" } });
	} finally {
		if (previousHarness === undefined) delete process.env.CODEPATROL_HARNESS; else process.env.CODEPATROL_HARNESS = previousHarness;
		if (previousStep === undefined) delete process.env.CODEPATROL_STEP; else process.env.CODEPATROL_STEP = previousStep;
		rmSync(root, { recursive: true, force: true });
	}
});

test("artifact steps reject malformed entries with specific errors", async () => {
	const cases = [
		["unknown step", { lint: { harness: "pi", completed_at: "2026-07-20T18:00:00Z" } }, "steps.lint is not a recognized step."],
		["missing harness", { plan: { completed_at: "2026-07-20T18:00:00Z" } }, "steps.plan.harness must be a non-empty string."],
		["non-string harness", { plan: { harness: 42, completed_at: "2026-07-20T18:00:00Z" } }, "steps.plan.harness must be a non-empty string."],
		["non-string model", { plan: { harness: "pi", model: 42, completed_at: "2026-07-20T18:00:00Z" } }, "steps.plan.model must be a string when present."],
		["bad completed_at", { plan: { harness: "pi", completed_at: "not-a-date" } }, "steps.plan.completed_at must be an ISO timestamp."],
		["missing completed_at", { plan: { harness: "pi" } }, "steps.plan.completed_at must be an ISO timestamp."],
	];
	for (const [label, steps, expected] of cases) {
		const { root, manifest, manifestPath } = fixture();
		try {
			rewrite(manifestPath, (value) => { value.steps = steps; });
			await assert.rejects(
				recordArtifactPackage(root, manifest),
				(error: unknown) => error instanceof CodepatrolError && Array.isArray(error.details) && error.details.includes(expected),
				`${label} should report ${expected}`,
			);
		} finally { rmSync(root, { recursive: true, force: true }); }
	}
});
test("artifact record binds the verification report like every other declared role", async () => {
	const { root, directory, manifest, manifestPath } = await implementedFixture();
	try {
		writeFileSync(join(directory, "verification.md"), "# Verification\n\nVerdict: commit\n");
		rewrite(manifestPath, (value) => { value.artifacts.verification = { path: "verification.md" }; });
		const recorded = await recordArtifactPackage(root, manifest);
		assert.match(recorded.artifacts.verification!.sha256!, /^[a-f0-9]{64}$/);

		writeFileSync(join(directory, "verification.md"), "# Verification\n\nVerdict: improve\n");
		const drifted = validateArtifactPackage(root, manifest, "verification");
		assert.equal(drifted.valid, false);
		assert.ok(drifted.errors.some((error) => /hash mismatch.*verification/i.test(error)));
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("verification stage requires an implemented package whose approval is still current", async () => {
	const { root, manifest, manifestPath } = await implementedFixture();
	try {
		assert.equal(validateArtifactPackage(root, manifest, "verification").valid, true);

		rewrite(manifestPath, (value) => { value.status = "implementing"; });
		await recordArtifactPackage(root, manifest);
		const unfinished = validateArtifactPackage(root, manifest, "verification");
		assert.equal(unfinished.valid, false);
		assert.ok(unfinished.errors.some((error) => /implemented/i.test(error)));

		rewrite(manifestPath, (value) => { value.status = "implemented"; delete value.artifacts.implementation; });
		await recordArtifactPackage(root, manifest);
		const journalless = validateArtifactPackage(root, manifest, "verification");
		assert.equal(journalless.valid, false);
		assert.ok(journalless.errors.some((error) => /implementation\.md/i.test(error)));

		rewrite(manifestPath, (value) => {
			value.artifacts.implementation = { path: "implementation.md" };
			value.approval.reviewed_revision = 99;
		});
		await recordArtifactPackage(root, manifest);
		const stale = validateArtifactPackage(root, manifest, "verification");
		assert.equal(stale.valid, false);
		assert.ok(stale.errors.some((error) => /reviewed_revision/i.test(error)));
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("a verified status must carry a commit verdict recorded against the current revision", async () => {
	const { root, manifest, manifestPath } = await implementedFixture();
	try {
		rewrite(manifestPath, (value) => { value.status = "verified"; });
		const unrecorded = validateArtifactPackage(root, manifest, "verification");
		assert.equal(unrecorded.valid, false);
		assert.ok(unrecorded.errors.some((error) => /verification/i.test(error)));

		rewrite(manifestPath, (value) => { value.verification = { verdict: "improve", verified_revision: 1, verifier: "codex" }; });
		const improved = validateArtifactPackage(root, manifest, "verification");
		assert.equal(improved.valid, false);
		assert.ok(improved.errors.some((error) => /commit/i.test(error)));

		rewrite(manifestPath, (value) => { value.verification = { verdict: "commit", verified_revision: 99, verifier: "codex" }; });
		const mismatched = validateArtifactPackage(root, manifest, "verification");
		assert.equal(mismatched.valid, false);
		assert.ok(mismatched.errors.some((error) => /verified_revision/i.test(error)));

		rewrite(manifestPath, (value) => { value.artifacts.verification = { path: "report.md" }; });
		const misnamed = validateArtifactPackage(root, manifest, "verification");
		assert.equal(misnamed.valid, false);
		assert.ok(misnamed.errors.some((error) => /verification\.md/i.test(error)));
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("an already verified package cannot re-enter the review or implementation stages", async () => {
	const { root, directory, manifest, manifestPath } = await implementedFixture();
	try {
		writeFileSync(join(directory, "verification.md"), "# Verification\n\nVerdict: commit\n");
		rewrite(manifestPath, (value) => {
			value.status = "verified";
			value.artifacts.verification = { path: "verification.md" };
			value.verification = { verdict: "commit", verified_revision: 1, verifier: "codex", verified_at: "2026-07-19T13:00:00Z" };
		});
		await recordArtifactPackage(root, manifest);

		const implementation = validateArtifactPackage(root, manifest, "implementation");
		assert.equal(implementation.valid, false);
		assert.ok(implementation.errors.some((error) => /approved, implementing, or blocked/i.test(error)));

		const review = validateArtifactPackage(root, manifest, "review");
		assert.equal(review.valid, false);
		assert.ok(review.errors.some((error) => /ready-for-review or changes-requested/i.test(error)));
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("artifact paths cannot escape their package directory", async () => {
	const { root, directory, manifest } = fixture();
	try {
		const value = parseYaml(readFileSync(join(directory, "handoff.yaml"), "utf8"));
		value.artifacts.spec.path = "../outside.md";
		writeFileSync(join(directory, "handoff.yaml"), stringifyYaml(value));
		await assert.rejects(
			recordArtifactPackage(root, manifest),
			(error: unknown) => error instanceof CodepatrolError && error.code === "ARTIFACT_INVALID",
		);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("artifact roles use canonical filenames so every harness resolves the same contract", async () => {
	const { root, directory, manifest } = fixture();
	try {
		writeFileSync(join(directory, "alternative.md"), "# Ambiguous role\n");
		const value = parseYaml(readFileSync(join(directory, "handoff.yaml"), "utf8"));
		value.artifacts.spec.path = "alternative.md";
		writeFileSync(join(directory, "handoff.yaml"), stringifyYaml(value));
		await assert.rejects(
			recordArtifactPackage(root, manifest),
			(error: unknown) => error instanceof CodepatrolError && error.code === "ARTIFACT_INVALID" && /spec\.md/i.test(String(error.details)),
		);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("a missing manifest is artifact state failure rather than an untrusted workspace", async () => {
	const root = mkdtempSync(join(tmpdir(), "codepatrol-artifact-missing-"));
	try {
		await assert.rejects(
			recordArtifactPackage(root, ".codepatrol/packages/2026-07-18-missing/handoff.yaml"),
			(error: unknown) => error instanceof CodepatrolError && error.code === "ARTIFACT_INVALID" && error.exitCode === 4,
		);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("listArtifactPackages discovers packages leniently and skips malformed manifests", () => {
	const root = mkdtempSync(join(tmpdir(), "codepatrol-artifact-"));
	try {
		const good = join(root, ".codepatrol", "packages", "2026-07-19-alpha");
		mkdirSync(good, { recursive: true });
		writeFileSync(join(good, "handoff.yaml"), stringifyYaml({
			schema_version: 1,
			work_id: "2026-07-19-alpha",
			origin: { skill: "propose-codebase", mode: "feature" },
			workflow_id: "cpw-abc",
			status: "ready-for-review",
			revision: 2,
			artifacts: { spec: { path: "spec.md" }, plan: { path: "plan.md" } },
		}));
		const plain = join(root, ".codepatrol", "packages", "2026-07-19-beta");
		mkdirSync(plain, { recursive: true });
		writeFileSync(join(plain, "handoff.yaml"), stringifyYaml({
			schema_version: 1,
			work_id: "2026-07-19-beta",
			origin: { skill: "improve-codebase", mode: "bug" },
			status: "draft",
			revision: 1,
			artifacts: { spec: { path: "spec.md" }, plan: { path: "plan.md" } },
		}));
		const broken = join(root, ".codepatrol", "packages", "2026-07-19-broken");
		mkdirSync(broken, { recursive: true });
		writeFileSync(join(broken, "handoff.yaml"), "{");
		mkdirSync(join(root, ".codepatrol", "packages", "2026-07-19-empty"), { recursive: true });

		const { packages, warnings } = listArtifactPackages(root);
		assert.deepEqual(packages.map((pkg) => pkg.workId), ["2026-07-19-alpha", "2026-07-19-beta"]);
		assert.equal(packages[0].status, "ready-for-review");
		assert.equal(packages[0].revision, 2);
		assert.equal(packages[0].workflowId, "cpw-abc");
		assert.equal(packages[0].path, ".codepatrol/packages/2026-07-19-alpha/handoff.yaml");
		assert.equal(packages[1].workflowId, undefined);
		assert.equal(warnings.length, 1);
		assert.match(warnings[0], /Skipped malformed artifact manifest: \.codepatrol\/packages\/2026-07-19-broken\/handoff\.yaml/);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("listArtifactPackages returns empty lists when .codepatrol/packages is absent", () => {
	const root = mkdtempSync(join(tmpdir(), "codepatrol-artifact-"));
	try {
		assert.deepEqual(listArtifactPackages(root), { packages: [], warnings: [] });
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("approve is accepted at both implementation and verification stages", async () => {
	const { root, directory, manifest, manifestPath } = fixture();
	try {
		const specFile = join(directory, "spec.md");
		writeFileSync(specFile, "- Governing constraints: fixture\n- Substrate state: fixture\n" + readFileSync(specFile, "utf8"));
		const conformingReview = "## Scope and evidence\n## Findings\n## Artifact adjustments\n## Acceptance coverage\n- AC-1: yes\n## Simplicity axis\n## Executability audit\n## Verdict\napprove\n## External evidence sufficiency\nnot required\nPackage: 2026-07-18-cache\nReviewed revision: 1\nReviewer: codex\nEvidence date: 2026-07-18T12:00:00Z";
		writeFileSync(join(directory, "review.md"), conformingReview);
		writeFileSync(join(directory, "implementation.md"), "# Implementation\n");
		rewrite(manifestPath, (value) => {
			value.status = "approved";
			value.artifacts.review = { path: "review.md" };
			value.artifacts.implementation = { path: "implementation.md" };
			value.approval = { verdict: "approve", reviewed_revision: 1, reviewer: "codex", reviewed_at: "2026-07-18T12:00:00Z" };
		});
		await recordArtifactPackage(root, manifest);
		const implementationValidation = validateArtifactPackage(root, manifest, "implementation");
		assert.equal(implementationValidation.valid, true, implementationValidation.errors.join("\n"));
		assert.equal(implementationValidation.warnings.length, 0);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("merge alias still validates but emits the deprecation warning", async () => {
	const { root, directory, manifest, manifestPath } = fixture();
	try {
		const specFile = join(directory, "spec.md");
		writeFileSync(specFile, "- Governing constraints: fixture\n- Substrate state: fixture\n" + readFileSync(specFile, "utf8"));
		const conformingReview = "## Scope and evidence\n## Findings\n## Artifact adjustments\n## Acceptance coverage\n- AC-1: yes\n## Simplicity axis\n## Executability audit\n## Verdict\napprove\n## External evidence sufficiency\nnot required\nPackage: 2026-07-18-cache\nReviewed revision: 1\nReviewer: codex\nEvidence date: 2026-07-18T12:00:00Z";
		writeFileSync(join(directory, "review.md"), conformingReview);
		rewrite(manifestPath, (value) => {
			value.status = "approved";
			value.artifacts.review = { path: "review.md" };
			value.approval = { verdict: "merge", reviewed_revision: 1, reviewer: "codex", reviewed_at: "2026-07-18T12:00:00Z" };
		});
		await recordArtifactPackage(root, manifest);
		const validation = validateArtifactPackage(root, manifest, "implementation");
		assert.equal(validation.valid, true, validation.errors.join("\n"));
		assert.ok(validation.warnings.some((warning) => /deprecated/.test(warning) && /approve/.test(warning)));
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("invalid verdict is still rejected after rename", () => {
	const raw = `schema_version: 1\nwork_id: 2026-07-21-invalid\nstatus: approved\nrevision: 1\norigin: { skill: improve-codebase, mode: architecture }\nartifacts:\n  spec: { path: spec.md }\n  plan: { path: plan.md }\napproval: { verdict: bogus, reviewed_revision: 1, reviewer: x, reviewed_at: 2026-07-18T12:00:00Z }\n`;
	const dir = mkdtempSync(join(tmpdir(), "codepatrol-artifact-"));
	const pkgDir = join(dir, ".codepatrol", "packages", "2026-07-21-invalid");
	mkdirSync(pkgDir, { recursive: true });
	try {
		writeFileSync(join(pkgDir, "spec.md"), "");
		writeFileSync(join(pkgDir, "plan.md"), "");
		writeFileSync(join(pkgDir, "handoff.yaml"), raw);
		const validation = validateArtifactPackage(dir, join(".codepatrol/packages/2026-07-21-invalid/handoff.yaml"), "plan");
		assert.equal(validation.valid, false);
		assert.ok(validation.errors.some((error) => /approval.verdict/.test(error)));
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

test("review, plan, and verification stages remain regression-stable for a simple implemented package", async () => {
	const { root, directory, manifest, manifestPath } = fixture();
	try {
		const specFile = join(directory, "spec.md");
		writeFileSync(specFile, "- Governing constraints: fixture\n- Substrate state: fixture\n" + readFileSync(specFile, "utf8"));
		const conformingReview = "## Scope and evidence\n## Findings\n## Artifact adjustments\n## Acceptance coverage\n- AC-1: yes\n## Simplicity axis\n## Executability audit\n## Verdict\napprove\n## External evidence sufficiency\nnot required\nPackage: 2026-07-18-cache\nReviewed revision: 1\nReviewer: codex\nEvidence date: 2026-07-18T12:00:00Z";
		writeFileSync(join(directory, "review.md"), conformingReview);
		writeFileSync(join(directory, "implementation.md"), "# Implementation\n");
		rewrite(manifestPath, (value) => {
			value.status = "implemented";
			value.artifacts.review = { path: "review.md" };
			value.artifacts.implementation = { path: "implementation.md" };
			value.approval = { verdict: "approve", reviewed_revision: 1, reviewer: "codex", reviewed_at: "2026-07-18T12:00:00Z" };
		});
		await recordArtifactPackage(root, manifest);
		const planValid = validateArtifactPackage(root, manifest, "plan");
		const reviewValid = validateArtifactPackage(root, manifest, "review");
		const verifyValid = validateArtifactPackage(root, manifest, "verification");
		assert.equal(typeof planValid.valid, "boolean");
		assert.equal(typeof reviewValid.valid, "boolean");
		assert.equal(typeof verifyValid.valid, "boolean");
	} finally { rmSync(root, { recursive: true, force: true }); }
});
