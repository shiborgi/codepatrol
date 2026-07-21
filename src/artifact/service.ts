import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { atomicWriteFile } from "../shared/atomic-store.js";
import { CodepatrolError } from "../shared/errors.js";
import { withWorkspaceLock } from "../shared/lock.js";
import { resolveInside } from "../shared/workspace.js";
import { checkPlanPackage } from "./plan-check.js";
import { checkReviewPackage } from "./review-check.js";
import { ARTIFACT_STATUSES, ARTIFACT_STEP_NAMES, type ArtifactFile, type ArtifactManifestV1, type ArtifactPackageSummary, type ArtifactStage, type ArtifactStepName, type ArtifactValidationResult, isApprovingVerdict, DEPRECATED_APPROVING_VERDICT, APPROVING_VERDICT } from "./types.js";

const WORK_ID = /^[a-z0-9][a-z0-9-]{2,79}$/;
const SHA256 = /^[a-f0-9]{64}$/;

function artifactError(message: string, details?: unknown): CodepatrolError {
	return new CodepatrolError("ARTIFACT_INVALID", message, 4, false, details);
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalManifest(workspace: string, manifestPath: string): { absolute: string; relative: string; workId: string } {
	const canonicalWorkspace = realpathSync(workspace);
	const absolute = resolveInside(canonicalWorkspace, manifestPath);
	const workspaceRelative = relative(canonicalWorkspace, absolute).split("\\").join("/");
	const match = /^\.codepatrol\/work\/([^/]+)\/handoff\.yaml$/.exec(workspaceRelative);
	if (!match || !WORK_ID.test(match[1])) {
		throw artifactError("Manifest must be .codepatrol/work/<work-id>/handoff.yaml with a portable work id.");
	}
	if (!existsSync(absolute) || !statSync(absolute).isFile()) throw artifactError(`Artifact manifest does not exist: ${workspaceRelative}`);
	return { absolute, relative: workspaceRelative, workId: match[1] };
}

function portablePath(path: string): boolean {
	if (!path || isAbsolute(path) || path.startsWith("/") || path.includes("\\") || path.includes(":")) return false;
	return path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function validateEntry(value: unknown, label: string, errors: string[], paths: Set<string>): void {
	if (!isObject(value) || typeof value.path !== "string") {
		errors.push(`${label} must contain a relative path.`);
		return;
	}
	if (!portablePath(value.path)) errors.push(`${label} path must stay inside the package and use portable separators: ${value.path}`);
	if (paths.has(value.path)) errors.push(`Artifact path is declared more than once: ${value.path}`);
	paths.add(value.path);
	if (value.sha256 !== undefined && (typeof value.sha256 !== "string" || !SHA256.test(value.sha256))) {
		errors.push(`${label} sha256 must be a lowercase 64-character digest when present.`);
	}
}

function isIsoTimestamp(value: unknown): value is string {
	return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) && !Number.isNaN(Date.parse(value));
}

function validateSteps(value: unknown, errors: string[]): void {
	if (value === undefined) return;
	if (!isObject(value)) {
		errors.push("steps must be a mapping when present.");
		return;
	}
	for (const [step, stamp] of Object.entries(value)) {
		if (!ARTIFACT_STEP_NAMES.includes(step as ArtifactStepName)) {
			errors.push(`steps.${step} is not a recognized step.`);
			continue;
		}
		if (!isObject(stamp) || typeof stamp.harness !== "string" || !stamp.harness.trim()) errors.push(`steps.${step}.harness must be a non-empty string.`);
		if (isObject(stamp) && stamp.model !== undefined && typeof stamp.model !== "string") errors.push(`steps.${step}.model must be a string when present.`);
		if (!isObject(stamp) || !isIsoTimestamp(stamp.completed_at)) errors.push(`steps.${step}.completed_at must be an ISO timestamp.`);
	}
}

function validateStepShape(value: unknown): boolean {
	const errors: string[] = [];
	validateSteps(value, errors);
	return errors.length === 0;
}

function validateShape(value: unknown, expectedWorkId: string): string[] {
	const errors: string[] = [];
	if (!isObject(value)) return ["Manifest root must be a YAML mapping."];
	if (value.schema_version !== 1) errors.push("schema_version must be 1.");
	if (typeof value.work_id !== "string" || !WORK_ID.test(value.work_id)) errors.push("work_id must be a portable lowercase identifier.");
	else if (value.work_id !== expectedWorkId) errors.push(`work_id must match its package directory (${expectedWorkId}).`);
	if (!ARTIFACT_STATUSES.includes(value.status as never)) errors.push(`status must be one of: ${ARTIFACT_STATUSES.join(", ")}.`);
	if (!Number.isInteger(value.revision) || (value.revision as number) < 1) errors.push("revision must be a positive integer.");
	if (value.workflow_id !== undefined && (typeof value.workflow_id !== "string" || !value.workflow_id.trim())) errors.push("workflow_id must be a non-empty string when present.");

	if (!isObject(value.origin)) {
		errors.push("origin must identify the producer skill and mode.");
	} else {
		const skill = value.origin.skill;
		const mode = value.origin.mode;
		if (skill !== "propose-codebase" && skill !== "improve-codebase") errors.push("origin.skill must be propose-codebase or improve-codebase.");
		const allowed = skill === "propose-codebase" ? ["project", "feature"] : skill === "improve-codebase" ? ["architecture", "bug"] : [];
		if (!allowed.includes(mode as string)) errors.push(`origin.mode is not valid for ${String(skill)}.`);
	}

	const paths = new Set<string>();
	if (!isObject(value.artifacts)) {
		errors.push("artifacts must declare spec and plan.");
	} else {
		validateEntry(value.artifacts.spec, "artifacts.spec", errors, paths);
		validateEntry(value.artifacts.plan, "artifacts.plan", errors, paths);
		if (isObject(value.artifacts.spec) && value.artifacts.spec.path !== "spec.md") errors.push("artifacts.spec path must be spec.md.");
		if (isObject(value.artifacts.plan) && value.artifacts.plan.path !== "plan.md") errors.push("artifacts.plan path must be plan.md.");
		if (value.artifacts.review !== undefined) validateEntry(value.artifacts.review, "artifacts.review", errors, paths);
		if (value.artifacts.implementation !== undefined) validateEntry(value.artifacts.implementation, "artifacts.implementation", errors, paths);
		if (isObject(value.artifacts.review) && value.artifacts.review.path !== "review.md") errors.push("artifacts.review path must be review.md.");
		if (isObject(value.artifacts.implementation) && value.artifacts.implementation.path !== "implementation.md") errors.push("artifacts.implementation path must be implementation.md.");
		if (value.artifacts.verification !== undefined) validateEntry(value.artifacts.verification, "artifacts.verification", errors, paths);
		if (isObject(value.artifacts.verification) && value.artifacts.verification.path !== "verification.md") errors.push("artifacts.verification path must be verification.md.");
		if (value.artifacts.evidence !== undefined) {
			if (!Array.isArray(value.artifacts.evidence)) errors.push("artifacts.evidence must be a list when present.");
			else value.artifacts.evidence.forEach((entry, index) => {
				validateEntry(entry, `artifacts.evidence[${index}]`, errors, paths);
				if (isObject(entry) && (typeof entry.path !== "string" || !entry.path.startsWith("evidence/"))) errors.push(`artifacts.evidence[${index}] path must be under evidence/.`);
			});
		}
	}

	if (value.approval !== undefined) {
		if (!isObject(value.approval)) errors.push("approval must be a mapping when present.");
		else {
			if (!["approve", "merge", "fix-first", "rework"].includes(value.approval.verdict as string)) errors.push("approval.verdict must be approve, fix-first, or rework.");
			if (!Number.isInteger(value.approval.reviewed_revision) || (value.approval.reviewed_revision as number) < 1) errors.push("approval.reviewed_revision must be a positive integer.");
			if (value.approval.reviewed_at !== undefined && (typeof value.approval.reviewed_at !== "string" || Number.isNaN(Date.parse(value.approval.reviewed_at)))) errors.push("approval.reviewed_at must be an ISO timestamp when present.");
		}
	}

	if (value.verification !== undefined) {
		if (!isObject(value.verification)) errors.push("verification must be a mapping when present.");
		else {
			if (!["commit", "improve"].includes(value.verification.verdict as string)) errors.push("verification.verdict must be commit or improve.");
			if (!Number.isInteger(value.verification.verified_revision) || (value.verification.verified_revision as number) < 1) errors.push("verification.verified_revision must be a positive integer.");
			if (value.verification.verified_at !== undefined && (typeof value.verification.verified_at !== "string" || Number.isNaN(Date.parse(value.verification.verified_at)))) errors.push("verification.verified_at must be an ISO timestamp when present.");
		}
	}

	validateSteps(value.steps, errors);

	if (value.status === "verified") {
		const verification = isObject(value.verification) ? value.verification : undefined;
		if (!verification) errors.push("A verified package must record its verification verdict.");
		else {
			if (verification.verdict !== "commit") errors.push("A verified package requires verification verdict commit.");
			if (verification.verified_revision !== value.revision) errors.push("verification.verified_revision must equal the current revision.");
		}
	}
	return errors;
}

function parseManifest(raw: string): unknown {
	try { return parseYaml(raw); }
	catch (cause) { throw artifactError("Manifest is not valid YAML.", cause instanceof Error ? cause.message : String(cause)); }
}

function manifestEntries(manifest: ArtifactManifestV1): Array<{ label: string; file: ArtifactFile }> {
	return [
		{ label: "spec", file: manifest.artifacts.spec },
		{ label: "plan", file: manifest.artifacts.plan },
		...(manifest.artifacts.review ? [{ label: "review", file: manifest.artifacts.review }] : []),
		...(manifest.artifacts.implementation ? [{ label: "implementation", file: manifest.artifacts.implementation }] : []),
		...(manifest.artifacts.verification ? [{ label: "verification", file: manifest.artifacts.verification }] : []),
		...(manifest.artifacts.evidence ?? []).map((file, index) => ({ label: `evidence[${index}]`, file })),
	];
}

function filePath(packageDirectory: string, entry: ArtifactFile): string {
	if (!portablePath(entry.path)) throw artifactError(`Artifact path escapes its package: ${entry.path}`);
	const absolute = resolveInside(packageDirectory, entry.path);
	if (!existsSync(absolute)) throw artifactError(`Declared artifact does not exist: ${entry.path}`);
	const canonical = realpathSync(absolute);
	const rel = relative(realpathSync(packageDirectory), canonical);
	if (rel.startsWith("..") || isAbsolute(rel)) throw artifactError(`Artifact resolves outside its package: ${entry.path}`);
	if (!statSync(canonical).isFile()) throw artifactError(`Declared artifact is not a file: ${entry.path}`);
	return canonical;
}

function hash(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function load(workspace: string, manifestPath: string): { manifest: ArtifactManifestV1; absolute: string; relative: string; packageDirectory: string } {
	const canonical = canonicalManifest(workspace, manifestPath);
	const value = parseManifest(readFileSync(canonical.absolute, "utf8"));
	const errors = validateShape(value, canonical.workId);
	if (errors.length) throw artifactError("Artifact manifest is structurally invalid.", errors);
	return { manifest: value as ArtifactManifestV1, absolute: canonical.absolute, relative: canonical.relative, packageDirectory: dirname(canonical.absolute) };
}

export function listArtifactPackages(workspace: string): { packages: ArtifactPackageSummary[]; warnings: string[] } {
	const canonicalWorkspace = realpathSync(workspace);
	const root = resolveInside(canonicalWorkspace, ".codepatrol/work");
	const packages: ArtifactPackageSummary[] = [];
	const warnings: string[] = [];
	if (!existsSync(root) || !statSync(root).isDirectory()) return { packages, warnings };
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const portable = `.codepatrol/work/${entry.name}/handoff.yaml`;
		const absolute = join(root, entry.name, "handoff.yaml");
		if (!existsSync(absolute) || !statSync(absolute).isFile()) continue;
		try {
			const value: unknown = parseYaml(readFileSync(absolute, "utf8"));
			const record = isObject(value) ? value : {};
			packages.push({
				workId: typeof record.work_id === "string" && record.work_id.trim() ? record.work_id : entry.name,
				path: portable,
				...(typeof record.status === "string" ? { status: record.status } : {}),
				...(Number.isInteger(record.revision) ? { revision: record.revision as number } : {}),
				...(typeof record.workflow_id === "string" && record.workflow_id.trim() ? { workflowId: record.workflow_id } : {}),
				...(typeof record.updated_at === "string" ? { updatedAt: record.updated_at } : {}),
				...(isObject(record.steps) && validateStepShape(record.steps) ? { steps: record.steps } : {}),
			});
		} catch (cause) {
			warnings.push(`Skipped malformed artifact manifest: ${portable} (${cause instanceof Error ? cause.message : String(cause)})`);
		}
	}
	packages.sort((left, right) => left.workId.localeCompare(right.workId));
	return { packages, warnings };
}

export async function recordArtifactPackage(workspace: string, manifestPath: string, signal?: AbortSignal): Promise<ArtifactManifestV1> {	return withWorkspaceLock(workspace, "artifact", "artifact.record", () => {
		const { manifest, absolute, packageDirectory } = load(workspace, manifestPath);
		for (const { file } of manifestEntries(manifest)) file.sha256 = hash(filePath(packageDirectory, file));
		manifest.updated_at = new Date().toISOString();
		atomicWriteFile(absolute, stringifyYaml(manifest));
		return manifest;
	}, { signal });
}

export function validateArtifactPackage(workspace: string, manifestPath: string, stage: ArtifactStage): ArtifactValidationResult {
	let loaded: ReturnType<typeof load>;
	try {
		loaded = load(workspace, manifestPath);
	} catch (cause) {
		if (!(cause instanceof CodepatrolError) || cause.code !== "ARTIFACT_INVALID") throw cause;
		const errors = Array.isArray(cause.details) ? cause.details.map(String) : [cause.message];
		return { valid: false, stage, manifestPath, errors, warnings: [], text: `Artifact package is invalid:\n${errors.map((error) => `- ${error}`).join("\n")}` };
	}
	const { manifest, relative: relativeManifest, packageDirectory } = loaded;
	const errors: string[] = [];
	const warnings: string[] = [];
	for (const { label, file } of manifestEntries(manifest)) {
		try {
			const actual = hash(filePath(packageDirectory, file));
			if (!file.sha256) errors.push(`Missing recorded hash for ${label}.`);
			else if (file.sha256 !== actual) errors.push(`Hash mismatch for ${label} (${file.path}).`);
		} catch (cause) {
			errors.push(cause instanceof Error ? cause.message : String(cause));
		}
	}

	if (manifest.approval?.verdict === DEPRECATED_APPROVING_VERDICT) {
		warnings.push(`approval.verdict "${DEPRECATED_APPROVING_VERDICT}" is deprecated; re-record it as "${APPROVING_VERDICT}".`);
	}

	if (stage === "plan") {
		let specText: string | undefined;
		let planText: string | undefined;
		try { specText = readFileSync(filePath(packageDirectory, manifest.artifacts.spec), "utf8"); }
		catch { /* The declared-entry loop above already reports an unavailable spec. */ }
		try { planText = readFileSync(filePath(packageDirectory, manifest.artifacts.plan), "utf8"); }
		catch { /* The declared-entry loop above already reports an unavailable plan. */ }
		if (specText !== undefined && planText !== undefined) {
			errors.push(...checkPlanPackage({ workspace, packageDirectory, specText, planText }));
		}
	} else if (stage === "review") {
		if (manifest.status !== "ready-for-review" && manifest.status !== "changes-requested") errors.push("Review requires status ready-for-review or changes-requested.");
	} else if (stage === "implementation") {
		if (!["approved", "implementing", "blocked"].includes(manifest.status)) errors.push("Implementation requires status approved, implementing, or blocked.");
		if (!manifest.artifacts.review) errors.push("Implementation requires review.md in the manifest.");
		if (!manifest.approval) errors.push("Implementation requires approval metadata.");
		else {
			if (!isApprovingVerdict(manifest.approval.verdict)) errors.push("Implementation requires an approving approval verdict.");
			if (manifest.approval.reviewed_revision !== manifest.revision) errors.push("approval.reviewed_revision must equal the current revision.");
		}

		if (manifest.artifacts.review) {
			let specText: string | undefined;
			let reviewText: string | undefined;
			try { specText = readFileSync(filePath(packageDirectory, manifest.artifacts.spec), "utf8"); }
			catch { /* declared-entry loop above already reports an unavailable spec */ }
			try { reviewText = readFileSync(filePath(packageDirectory, manifest.artifacts.review), "utf8"); }
			catch { /* declared-entry loop above already reports an unavailable review */ }
			if (specText !== undefined && reviewText !== undefined) {
				const evidencePaths = manifest.artifacts.evidence?.map((entry) => entry.path) ?? [];
				errors.push(...checkReviewPackage({
					workspace,
					packageDirectory,
					specText,
					reviewText,
					manifestVerdict: manifest.approval?.verdict,
					manifestRevision: manifest.revision,
					evidencePaths,
				}));
			}
		}
	} else {
		if (manifest.status !== "implemented") errors.push("Verification requires status implemented.");
		if (!manifest.artifacts.implementation) errors.push("Verification requires implementation.md in the manifest.");
		if (!manifest.approval) errors.push("Verification requires approval metadata.");
		else {
			if (!isApprovingVerdict(manifest.approval.verdict)) errors.push("Verification requires an approving approval verdict.");
			if (manifest.approval.reviewed_revision !== manifest.revision) errors.push("approval.reviewed_revision must equal the current revision.");
		}
	}
	const valid = errors.length === 0;
	return {
		valid,
		stage,
		manifestPath: relativeManifest,
		workId: manifest.work_id,
		status: manifest.status,
		revision: manifest.revision,
		errors,
		warnings,
		text: valid ? `Artifact package ${manifest.work_id} is valid for ${stage}.` : `Artifact package is invalid for ${stage}:\n${errors.map((error) => `- ${error}`).join("\n")}`,
	};
}
