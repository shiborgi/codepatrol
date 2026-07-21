import { listArtifactPackages } from "../artifact/service.js";
import { listWorkflowRoots } from "../workflow/service.js";
import type { StatusSummary, StatusWorkflowEntry } from "./types.js";

export function statusSummary(workspace: string, options: { all?: boolean } = {}): StatusSummary {
	const workflows: StatusWorkflowEntry[] = listWorkflowRoots(workspace, { all: options.all });
	const { packages, warnings } = listArtifactPackages(workspace);
	const visible = options.all ? packages : packages.filter((pkg) => pkg.status !== "verified");
	const byWorkflowId = new Map(workflows.map((workflow) => [workflow.id, workflow]));
	for (const pkg of visible) {
		if (!pkg.workflowId) continue;
		const workflow = byWorkflowId.get(pkg.workflowId);
		if (workflow) workflow.packageWorkId = pkg.workId;
	}
	return { workflows, packages: visible, warnings };
}
