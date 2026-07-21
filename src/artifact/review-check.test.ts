import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkReviewPackage } from "./review-check.js";

const conformingReview = `## Scope and evidence

## Findings

## Artifact adjustments

## Acceptance coverage
- AC-1: covered
- AC-2: covered

## Simplicity axis

## Executability audit

## Verdict

approve

## External evidence sufficiency

not required — pure internal contract change

- Package: 2026-07-21-fixture
- Reviewed revision: 1
- Reviewer: pi
- Evidence date: 2026-07-21T12:00:00Z
`;

const conformingSpec = `- Governing constraints: fixture.
- Substrate state: graph synced.
- AC-1: predicate live.
- AC-2: alias compatible.
`;

function workspace(): string {
	const dir = mkdtempSync(join(tmpdir(), "review-check-"));
	mkdirSync(join(dir, "evidence"), { recursive: true });
	writeFileSync(join(dir, "evidence", "analysis.md"), "analysis");
	return dir;
}

test("RV1 reports each missing required section", () => {
	const result = checkReviewPackage({
		workspace: workspace(),
		packageDirectory: "x",
		specText: conformingSpec,
		reviewText: "## Verdict\napprove\n",
		manifestVerdict: "approve",
		manifestRevision: 1,
		evidencePaths: [],
	});
	assert.ok(result.some((e) => e.includes("## Scope and evidence")));
	assert.ok(result.some((e) => e.includes("## Findings")));
	assert.ok(result.some((e) => e.includes("## Artifact adjustments")));
	assert.ok(result.some((e) => e.includes("## Acceptance coverage")));
	assert.ok(result.some((e) => e.includes("## Simplicity axis")));
	assert.ok(result.some((e) => e.includes("## Executability audit")));
});

test("RV1 ignores verdict words mentioned outside the Verdict section", () => {
	const reviewText = conformingReview
		.replace("## Verdict\n\napprove\n", "## Verdict\n\nfix-first\n")
		.replace("We chose approve", "We made a deliberate call");
	const result = checkReviewPackage({
		workspace: workspace(),
		packageDirectory: "x",
		specText: conformingSpec,
		reviewText,
		manifestVerdict: "fix-first",
		manifestRevision: 1,
		evidencePaths: [],
	});
	assert.equal(result.length, 0);
});

test("RV2 reports missing canonical verdict", () => {
	const reviewText = conformingReview.replace("## Verdict\n\napprove\n", "## Verdict\n\nno verdict word here\n");
	const result = checkReviewPackage({
		workspace: workspace(),
		packageDirectory: "x",
		specText: conformingSpec,
		reviewText,
		manifestVerdict: "approve",
		manifestRevision: 1,
		evidencePaths: [],
	});
	assert.ok(result.some((e) => /Verdict section names no canonical verdict/.test(e)));
});

test("RV2 reports more than one verdict", () => {
	const reviewText = conformingReview.replace("## Verdict\n\napprove\n", "## Verdict\n\napprove\nrework\n");
	const result = checkReviewPackage({
		workspace: workspace(),
		packageDirectory: "x",
		specText: conformingSpec,
		reviewText,
		manifestVerdict: "approve",
		manifestRevision: 1,
		evidencePaths: [],
	});
	assert.ok(result.some((e) => /more than one verdict/.test(e)));
});

test("RV3 checks manifest/artifact agreement", () => {
	const reviewText = conformingReview.replace("## Verdict\n\napprove\n", "## Verdict\n\nfix-first\n");
	const result = checkReviewPackage({
		workspace: workspace(),
		packageDirectory: "x",
		specText: conformingSpec,
		reviewText,
		manifestVerdict: "approve",
		manifestRevision: 1,
		evidencePaths: [],
	});
	assert.ok(result.some((e) => /fix-first.*approve/.test(e)));
});

test("RV3 treats approve and merge as equivalent verdicts", () => {
	const reviewText = conformingReview.replace("## Verdict\n\napprove\n", "## Verdict\n\nmerge\n");
	const result = checkReviewPackage({
		workspace: workspace(),
		packageDirectory: "x",
		specText: conformingSpec,
		reviewText,
		manifestVerdict: "approve",
		manifestRevision: 1,
		evidencePaths: [],
	});
	assert.equal(result.length, 0);
});

test("RV4 reports missing acceptance criteria from the coverage table", () => {
	const reviewText = conformingReview.replace("- AC-1: covered\n- AC-2: covered", "- AC-1: covered");
	const result = checkReviewPackage({
		workspace: workspace(),
		packageDirectory: "x",
		specText: conformingSpec,
		reviewText,
		manifestVerdict: "approve",
		manifestRevision: 1,
		evidencePaths: [],
	});
	assert.ok(result.some((e) => /AC-2.*absent/.test(e)));
});

test("RV5 requires header metadata and matching reviewed revision", () => {
	const reviewText = conformingReview
		.replace("- Reviewed revision: 1", "- Reviewed revision: 7")
		.replace("\n- Reviewer: pi", "");
	const result = checkReviewPackage({
		workspace: workspace(),
		packageDirectory: "x",
		specText: conformingSpec,
		reviewText,
		manifestVerdict: "approve",
		manifestRevision: 1,
		evidencePaths: [],
	});
	assert.ok(result.some((e) => /missing the header field: Reviewer/.test(e)));
	assert.ok(result.some((e) => /reviewed revision 7 but the manifest revision is 1/.test(e)));
});

// Real-package-directory fixture: builds an actual .codepatrol/work/<work-id>/evidence/ tree
// under a temporary workspace, set packageDirectory to that real directory, and assert
// RV6 resolution against the package base (not the workspace root).
function realPackageDirectory(): { workspace: string; packageDirectory: string } {
	const workspaceDir = mkdtempSync(join(tmpdir(), "review-check-"));
	const pkgDir = join(workspaceDir, "docs", "codepatrol", "2026-07-21-fixture");
	mkdirSync(join(pkgDir, "evidence"), { recursive: true });
	writeFileSync(join(pkgDir, "evidence", "analysis.md"), "analysis content");
	writeFileSync(join(pkgDir, "evidence", "empty.md"), "");
	return { workspace: workspaceDir, packageDirectory: pkgDir };
}

test("RV6 reports missing or empty evidence files relative to the package directory", () => {
	const { workspace: ws, packageDirectory: pkg } = realPackageDirectory();
	const result = checkReviewPackage({
		workspace: ws,
		packageDirectory: pkg,
		specText: conformingSpec,
		reviewText: conformingReview,
		manifestVerdict: "approve",
		manifestRevision: 1,
		evidencePaths: ["evidence/analysis.md", "evidence/empty.md", "evidence/missing.md"],
	});
	// analysis.md exists and is non-empty: no error
	assert.ok(!result.some((e) => /evidence\/analysis\.md/.test(e)));
	// empty.md exists but is zero bytes: empty error
	assert.ok(result.some((e) => /evidence\/empty\.md.*empty/.test(e)));
	// missing.md does not exist: missing error
	assert.ok(result.some((e) => /evidence\/missing\.md.*missing/.test(e)));
	rmSync(ws, { recursive: true, force: true });
});

test("RV6 rejects evidence paths escaping the package directory", () => {
	const { workspace: ws, packageDirectory: pkg } = realPackageDirectory();
	const result = checkReviewPackage({
		workspace: ws,
		packageDirectory: pkg,
		specText: conformingSpec,
		reviewText: conformingReview,
		manifestVerdict: "approve",
		manifestRevision: 1,
		evidencePaths: ["../outside.md"],
	});
	assert.ok(result.some((e) => /escapes the package directory/.test(e)));
	rmSync(ws, { recursive: true, force: true });
});

test("RV7 reports missing Governing constraints or Substrate state in spec", () => {
	const result = checkReviewPackage({
		workspace: workspace(),
		packageDirectory: "x",
		specText: "- Origin: architecture\n",
		reviewText: conformingReview,
		manifestVerdict: "approve",
		manifestRevision: 1,
		evidencePaths: [],
	});
	assert.ok(result.some((e) => /Governing constraints/.test(e)));
	assert.ok(result.some((e) => /Substrate state/.test(e)));
});

test("RV8 reports missing External evidence sufficiency record", () => {
	const reviewText = conformingReview.replace("## External evidence sufficiency\n\nnot required — pure internal contract change\n", "");
	const result = checkReviewPackage({
		workspace: workspace(),
		packageDirectory: "x",
		specText: conformingSpec,
		reviewText,
		manifestVerdict: "approve",
		manifestRevision: 1,
		evidencePaths: [],
	});
	assert.ok(result.some((e) => /External evidence sufficiency/.test(e)));
});

test("RV8 reports when External evidence sufficiency names no permitted outcome", () => {
	const reviewText = conformingReview.replace("not required — pure internal contract change", "we read some links");
	const result = checkReviewPackage({
		workspace: workspace(),
		packageDirectory: "x",
		specText: conformingSpec,
		reviewText,
		manifestVerdict: "approve",
		manifestRevision: 1,
		evidencePaths: [],
	});
	assert.ok(result.some((e) => /names no permitted outcome/.test(e)));
});

test("control fixture: the actual 2026-07-21-plan-step-hardening review.md trips RV1 and RV2", () => {
	const reviewText = `Resulting package is decision-complete and executable.
`;
	const result = checkReviewPackage({
		workspace: workspace(),
		packageDirectory: "x",
		specText: conformingSpec,
		reviewText,
		manifestVerdict: "merge",
		manifestRevision: 1,
		evidencePaths: [],
	});
	assert.ok(result.some((e) => /## Acceptance coverage/.test(e)));
	assert.ok(result.some((e) => /Verdict section names no canonical verdict/.test(e)));
});

test("well-formed review returns no errors", () => {
	const result = checkReviewPackage({
		workspace: workspace(),
		packageDirectory: "x",
		specText: conformingSpec,
		reviewText: conformingReview,
		manifestVerdict: "approve",
		manifestRevision: 1,
		evidencePaths: [],
	});
	assert.deepEqual(result, []);
});
