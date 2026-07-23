import { existsSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { CodepatrolError } from "./errors.js";

function isWithin(root: string, candidate: string): boolean {
	const rel = relative(root, candidate);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function resolveWorkspace(explicit?: string, env = process.env, cwd = process.cwd()): string {
	const requested = explicit || env.CODEPATROL_WORKSPACE || cwd;
	try {
		const canonical = realpathSync(resolve(requested));
		if (!statSync(canonical).isDirectory()) throw new Error("not a directory");
		return canonical;
	} catch {
		throw new CodepatrolError(
			"INVALID_WORKSPACE",
			`Workspace is not an accessible directory: ${requested}`,
			3,
		);
	}
}

/** Resolve a user-controlled path and prove that existing symlink ancestors remain inside the workspace. */
export function resolveInside(workspace: string, relPath: string, mustExist = false): string {
	workspace = realpathSync(workspace);
	if (!relPath || isAbsolute(relPath)) {
		throw new CodepatrolError("INVALID_WORKSPACE", `Path must be workspace-relative: ${relPath}`, 3);
	}
	const candidate = resolve(workspace, relPath);
	if (!isWithin(workspace, candidate)) {
		throw new CodepatrolError("INVALID_WORKSPACE", `Path escapes the workspace: ${relPath}`, 3);
	}

	let ancestor = candidate;
	while (!existsSync(ancestor) && ancestor !== workspace) ancestor = dirname(ancestor);
	try {
		const canonicalAncestor = realpathSync(ancestor);
		if (!isWithin(workspace, canonicalAncestor)) {
			throw new CodepatrolError("INVALID_WORKSPACE", `Path crosses a symlink outside the workspace: ${relPath}`, 3);
		}
		if (existsSync(candidate)) {
			const canonical = realpathSync(candidate);
			if (!isWithin(workspace, canonical)) {
				throw new CodepatrolError("INVALID_WORKSPACE", `Path resolves outside the workspace: ${relPath}`, 3);
			}
		}
	} catch (error) {
		if (error instanceof CodepatrolError) throw error;
		throw new CodepatrolError("INVALID_WORKSPACE", `Cannot validate workspace path: ${relPath}`, 3);
	}
	if (mustExist && !existsSync(candidate)) {
		throw new CodepatrolError("INVALID_WORKSPACE", `Path does not exist in the workspace: ${relPath}`, 3);
	}
	return candidate;
}
