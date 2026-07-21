export const APPROVING_VERDICT = "approve";
export const DEPRECATED_APPROVING_VERDICT = "merge";
export type ApprovalVerdict = "approve" | "merge" | "fix-first" | "rework";

export function isApprovingVerdict(verdict: string | undefined): boolean {
	return verdict === APPROVING_VERDICT || verdict === DEPRECATED_APPROVING_VERDICT;
}

export const ARTIFACT_STATUSES = [
	"draft",
	"ready-for-review",
	"changes-requested",
	"approved",
	"implementing",
	"blocked",
	"implemented",
	"verified",
] as const;

export type ArtifactStatus = typeof ARTIFACT_STATUSES[number];
export type ArtifactStage = "plan" | "review" | "implementation" | "verification";
export type ArtifactOriginSkill = "propose-codebase" | "improve-codebase";
export type ArtifactOriginMode = "project" | "feature" | "architecture" | "bug";
export const ARTIFACT_STEP_NAMES = ["plan", "review", "apply", "verify"] as const;
export type ArtifactStepName = typeof ARTIFACT_STEP_NAMES[number];

export interface ArtifactStepStamp {
	harness: string;
	model?: string;
	completed_at: string;
}
export interface ArtifactFile {
	path: string;
	sha256?: string;
}

export interface ArtifactManifestV1 {
	schema_version: 1;
	work_id: string;
	origin: {
		skill: ArtifactOriginSkill;
		mode: ArtifactOriginMode;
	};
	workflow_id?: string;
	status: ArtifactStatus;
	revision: number;
	updated_at?: string;
	artifacts: {
		spec: ArtifactFile;
		plan: ArtifactFile;
		review?: ArtifactFile;
		implementation?: ArtifactFile;
		verification?: ArtifactFile;
		evidence?: ArtifactFile[];
	};
	approval?: {
		verdict: ApprovalVerdict;
		reviewed_revision: number;
		reviewer?: string;
		reviewed_at?: string;
	};
	verification?: {
		verdict: "commit" | "improve";
		verified_revision: number;
		verifier?: string;
		verified_at?: string;
	};
	implementation?: {
		base_ref?: string;
		target?: string;
	};
	steps?: Partial<Record<ArtifactStepName, ArtifactStepStamp>>;
	[key: string]: unknown;
}

export interface ArtifactPackageSummary {
	workId: string;
	path: string;
	status?: string;
	revision?: number;
	workflowId?: string;
	updatedAt?: string;
	steps?: Partial<Record<ArtifactStepName, ArtifactStepStamp>>;
}

export interface ArtifactValidationResult {
	valid: boolean;
	stage: ArtifactStage;
	manifestPath: string;
	workId?: string;
	status?: ArtifactStatus;
	revision?: number;
	errors: string[];
	warnings: string[];
	text: string;
}
