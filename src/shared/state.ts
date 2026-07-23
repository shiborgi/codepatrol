import { resolveInside } from "./workspace.js";

export const STATE_VERSION = 1;

export function stateRoot(workspace: string): string {
	return resolveInside(workspace, ".codepatrol/runtime");
}

export function graphStatePath(workspace: string): string {
	return resolveInside(workspace, ".codepatrol/runtime/graph/graph.json");
}

export function wikiManifestPath(workspace: string): string {
	return resolveInside(workspace, ".codepatrol/runtime/wiki/manifest.json");
}

export function wikiRoot(workspace: string): string {
	return resolveInside(workspace, "docs/wiki");
}

export function lockPath(workspace: string, name: string): string {
	return resolveInside(workspace, `.codepatrol/runtime/locks/${name}.lock`);
}

export function changeRoot(workspace: string): string {
	return resolveInside(workspace, ".codepatrol/changes");
}

export function stageSessionPath(workspace: string, workId: string, stage: string, attempt: number): string {
	return resolveInside(workspace, `.codepatrol/runtime/sessions/${workId}/${stage}/${attempt}.json`);
}
