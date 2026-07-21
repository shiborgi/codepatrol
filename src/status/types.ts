import type { ArtifactPackageSummary } from "../artifact/types.js";
import type { WorkflowRootSummary } from "../workflow/types.js";

export interface StatusWorkflowEntry extends WorkflowRootSummary {
	packageWorkId?: string;
}

export type StatusPackageEntry = ArtifactPackageSummary;

export interface StatusSummary {
	workflows: StatusWorkflowEntry[];
	packages: StatusPackageEntry[];
	warnings: string[];
}
