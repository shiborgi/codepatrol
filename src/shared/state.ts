import { resolveInside } from "./workspace.js";

export const STATE_VERSION = 1;

export function stateRoot(workspace: string): string {
	return resolveInside(workspace, ".codepatrol");
}

export function graphStatePath(workspace: string): string {
	return resolveInside(workspace, ".codepatrol/code-graph/graph.json");
}

export function legacyGraphPath(workspace: string): string {
	return resolveInside(workspace, ".pi/code-graph/graph.json");
}

export function wikiManifestPath(workspace: string): string {
	return resolveInside(workspace, ".codepatrol/wiki/manifest.json");
}

export function workflowLedgerPath(workspace: string): string {
	return resolveInside(workspace, ".codepatrol/workflows/ledger.json");
}

export function workflowArchiveRoot(workspace: string): string {
	return resolveInside(workspace, ".codepatrol/workflows/archive");
}

export function wikiRoot(workspace: string): string {
	return resolveInside(workspace, "docs/wiki");
}

export function lockPath(workspace: string, name: string): string {
	return resolveInside(workspace, `.codepatrol/locks/${name}.lock`);
}
