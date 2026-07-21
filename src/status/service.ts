import { listArtifactPackages } from "../artifact/service.js";
import { listWorkflowRoots } from "../workflow/service.js";
import type { StatusSummary, StatusWorkflowEntry } from "./types.js";

export function statusSummary(workspace: string, options: { all?: boolean } = {}): StatusSummary {
	const workflows: StatusWorkflowEntry[] = listWorkflowRoots(workspace, { all: options.all });
	const { packages, warnings } = listArtifactPackages(workspace);
	const visiblePackages = options.all ? packages : packages.filter((pkg) => pkg.status !== "verified");
	const byWorkflowId = new Map(workflows.map((workflow) => [workflow.id, workflow]));

	// Correlate every package (not only the visible ones) with its workflow root, so a workflow
	// whose package reached `verified` still gets attributed when --all is requested.
	for (const pkg of packages) {
		if (!pkg.workflowId) continue;
		const workflow = byWorkflowId.get(pkg.workflowId);
		if (workflow) workflow.packageWorkId = pkg.workId;
	}

	// Hide ledger-only workflow roots that have no physical package behind them. The kanban should
	// not surface a "missing physical package" placeholder; only workflows that an actual package
	// (or a closed `all`-included state) ties to belong in the board.
	const visibleWorkflows = options.all
		? workflows
		: workflows.filter((workflow) => workflow.packageWorkId !== undefined);

	return { workflows: visibleWorkflows, packages: visiblePackages, warnings };
}
