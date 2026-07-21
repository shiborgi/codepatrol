import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { CodepatrolError } from "../shared/errors.js";
import { resolveInside } from "../shared/workspace.js";
import { APPROVING_VERDICT, DEPRECATED_APPROVING_VERDICT } from "./types.js";

export interface ReviewCheckInput {
	workspace: string;
	packageDirectory: string;
	specText: string;
	reviewText: string;
	manifestVerdict?: string;
	manifestRevision: number;
	evidencePaths: string[];
}

const REQUIRED_SECTIONS = [
	"## Scope and evidence",
	"## Findings",
	"## Artifact adjustments",
	"## Acceptance coverage",
	"## Simplicity axis",
	"## Executability audit",
	"## Verdict",
] as const;

const HEADER_FIELDS = [
	"Package:",
	"Reviewed revision:",
	"Reviewer:",
	"Evidence date:",
] as const;

const ACCEPTANCE_REFERENCE = /\b(AC-\d+)\b/g;
const SPEC_ACCEPTANCE_DECLARATION = /^-\s*(AC-\d+):/gm;
const SPEC_RECORD = /^-\s*(Governing constraints|Substrate state)\s*:\s*(.*)$/m;
const PERMITTED_OUTCOMES = ["not required", "required and sufficient", "required and missing"] as const;

function hasSection(text: string, heading: string): boolean {
	const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`^${escaped}\\s*$`, "m").test(text);
}

function sectionBody(text: string, heading: string): string {
	const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = new RegExp(`^${escaped}\\s*$`, "m").exec(text);
	if (!match) return "";
	const start = match.index + match[0].length;
	const rest = text.slice(start);
	const nextHeading = /^##\s+/m.exec(rest);
	return nextHeading ? rest.slice(0, nextHeading.index) : rest;
}

function matches(text: string, pattern: RegExp): string[] {
	return [...text.matchAll(pattern)].map((m) => m[1]);
}

export function checkReviewPackage(input: ReviewCheckInput): string[] {
	const errors: string[] = [];

	for (const heading of REQUIRED_SECTIONS) {
		if (!hasSection(input.reviewText, heading)) {
			errors.push(`review.md is missing the required section: ${heading}.`);
		}
	}

	const verdictSection = sectionBody(input.reviewText, "## Verdict");
	const verdictsFound: string[] = [];
	for (const verdict of [APPROVING_VERDICT, DEPRECATED_APPROVING_VERDICT, "fix-first", "rework"]) {
		const pattern = new RegExp(`\\b${verdict}\\b`);
		if (pattern.test(verdictSection)) verdictsFound.push(verdict);
	}
	if (verdictsFound.length === 0) {
		errors.push("review.md Verdict section names no canonical verdict.");
	} else if (verdictsFound.length > 1) {
		errors.push("review.md Verdict section names more than one verdict.");
	} else if (input.manifestVerdict !== undefined) {
		const normalizedReviewVerdict = verdictsFound[0] === DEPRECATED_APPROVING_VERDICT ? APPROVING_VERDICT : verdictsFound[0];
		const normalizedManifestVerdict = input.manifestVerdict === DEPRECATED_APPROVING_VERDICT ? APPROVING_VERDICT : input.manifestVerdict;
		if (normalizedReviewVerdict !== normalizedManifestVerdict) {
			errors.push(`review.md records verdict ${verdictsFound[0]} but the manifest records ${input.manifestVerdict}.`);
		}
	}

	if (hasSection(input.reviewText, "## Acceptance coverage")) {
		const declared = new Set(matches(input.specText, SPEC_ACCEPTANCE_DECLARATION));
		const acSection = sectionBody(input.reviewText, "## Acceptance coverage");
		const referenced = new Set(matches(acSection, ACCEPTANCE_REFERENCE));
		for (const criterion of declared) {
			if (!referenced.has(criterion)) {
				errors.push(`Acceptance criterion ${criterion} is absent from the review acceptance coverage.`);
			}
		}
	}

	for (const field of HEADER_FIELDS) {
		const pattern = new RegExp(`^(?:-\\s*)?${field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "m");
		if (!pattern.test(input.reviewText)) {
			errors.push(`review.md is missing the header field: ${field.replace(/:$/, "")}.`);
		}
	}
	const reviewedRevisionMatch = /^(?:-\s*)?Reviewed revision:\s*(\d+)/m.exec(input.reviewText);
	if (reviewedRevisionMatch) {
		const reviewed = parseInt(reviewedRevisionMatch[1], 10);
		if (reviewed !== input.manifestRevision) {
			errors.push(`review.md records reviewed revision ${reviewed} but the manifest revision is ${input.manifestRevision}.`);
		}
	}

	for (const path of input.evidencePaths) {
		let absolute: string;
		try {
			absolute = resolveInside(input.packageDirectory, path);
		} catch (cause) {
			if (!(cause instanceof CodepatrolError)) throw cause;
			errors.push(`Declared evidence ${path} escapes the package directory.`);
			continue;
		}
		if (!existsSync(absolute)) {
			errors.push(`Declared evidence ${path} is missing.`);
			continue;
		}
		const stat = statSync(absolute);
		if (stat.size === 0) {
			errors.push(`Declared evidence ${path} is empty.`);
		}
	}

	const specLines = input.specText.split(/\r?\n/);
	const specRecords = new Map<string, string>();
	for (const line of specLines) {
		const match = SPEC_RECORD.exec(line);
		if (match) specRecords.set(match[1], match[2]);
	}
	if (!specRecords.get("Governing constraints") || specRecords.get("Governing constraints")!.trim() === "") {
		errors.push("spec.md is missing a non-empty Governing constraints record.");
	}
	if (!specRecords.get("Substrate state") || specRecords.get("Substrate state")!.trim() === "") {
		errors.push("spec.md is missing a non-empty Substrate state record.");
	}

	if (hasSection(input.reviewText, "## External evidence sufficiency")) {
		const extSection = sectionBody(input.reviewText, "## External evidence sufficiency");
		const lower = extSection.toLowerCase();
		const ok = PERMITTED_OUTCOMES.some((outcome) => lower.includes(outcome));
		if (!ok) {
			errors.push("review.md External evidence sufficiency names no permitted outcome.");
		}
	} else {
		errors.push("review.md is missing a non-empty External evidence sufficiency record.");
	}

	return errors;
}
