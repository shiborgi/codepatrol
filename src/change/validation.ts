import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { relative } from "node:path";
import { CodepatrolError } from "../shared/errors.js";
import { resolveInside } from "../shared/workspace.js";
import type { ArtifactBinding, ChangeRecordV2, Stage } from "./types.js";

export interface ValidationResult { valid: boolean; errors: string[] }
export interface BaselineReader { exists(path: string): boolean }
export interface ArtifactReader { read(path: string): Buffer | null | undefined; files(prefix: string): string[] }
function shaBuffer(value: Buffer): string { return createHash("sha256").update(value).digest("hex"); }
function filesBelow(root: string): string[] {
	if (!existsSync(root)) return [];
	const result: string[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const path = `${root}/${entry.name}`;
		if (entry.isDirectory()) result.push(...filesBelow(path)); else result.push(path);
	}
	return result;
}

function validateWithReader(record: ChangeRecordV2, stage: Stage, bindings: ArtifactBinding[], reader: ArtifactReader, baseline?: BaselineReader): ValidationResult {
	const errors: string[] = [];
	const prefix = `.codepatrol/changes/${record.identity.work_id}/${stage}/`;
	const declared = new Set<string>();
	for (const binding of bindings) {
		if (!binding.path.startsWith(prefix) || binding.path.includes("..")) { errors.push(`Artifact is not owned by ${stage}: ${binding.path}`); continue; }
		declared.add(binding.path);
		const content = reader.read(binding.path);
		if (binding.intent === "delete") {
			if (content !== undefined) errors.push(`Deleted artifact still exists: ${binding.path}`);
		} else if (!Buffer.isBuffer(content)) errors.push(`Artifact is missing: ${binding.path}`);
		else if (shaBuffer(content) !== binding.sha256) errors.push(`Artifact hash drift: ${binding.path}`);
		if (baseline && binding.intent === "create" && baseline.exists(binding.path)) errors.push(`Create path existed at the recorded baseline: ${binding.path}`);
		if (baseline && binding.intent === "modify" && !baseline.exists(binding.path)) errors.push(`Modify path was absent at the recorded baseline: ${binding.path}`);
		if (baseline && binding.intent === "delete" && !baseline.exists(binding.path)) errors.push(`Delete path was absent at the recorded baseline: ${binding.path}`);
	}
	for (const path of reader.files(prefix)) if (!declared.has(path)) errors.push(`Undeclared durable artifact: ${path}`);
	return { valid: errors.length === 0, errors };
}

export function validateArtifactBindings(workspace: string, record: ChangeRecordV2, stage: Stage, bindings: ArtifactBinding[], baseline?: BaselineReader): ValidationResult {
	const prefix = `.codepatrol/changes/${record.identity.work_id}/${stage}/`;
	const reader: ArtifactReader = {
		read: (path) => { const absolute = resolveInside(workspace, path); if (!existsSync(absolute)) return undefined; if (!lstatSync(absolute).isFile()) return null; return readFileSync(absolute); },
		files: () => { const stageRoot = resolveInside(workspace, prefix.slice(0, -1)); return filesBelow(stageRoot).map((absolute) => relative(realpathSync(workspace), absolute).split("\\").join("/")); },
	};
	return validateWithReader(record, stage, bindings, reader, baseline);
}

export function validateArtifactBindingsFromReader(record: ChangeRecordV2, stage: Stage, bindings: ArtifactBinding[], reader: ArtifactReader, baseline: BaselineReader): ValidationResult { return validateWithReader(record, stage, bindings, reader, baseline); }

export function validateStageArtifactsFromReader(record: ChangeRecordV2, stage: Stage, bindings: ArtifactBinding[], reader: ArtifactReader, baseline: BaselineReader): ValidationResult {
	const result = validateArtifactBindingsFromReader(record, stage, bindings, reader, baseline);
	if (!result.valid) throw new CodepatrolError("CHANGE_DRIFT", result.errors.join("\n"), 4, false, result);
	return result;
}

export function validateStageArtifacts(workspace: string, record: ChangeRecordV2, stage: Stage, bindings: ArtifactBinding[], baseline?: BaselineReader): ValidationResult {
	const result = validateArtifactBindings(workspace, record, stage, bindings, baseline);
	if (!result.valid) throw new CodepatrolError("CHANGE_DRIFT", result.errors.join("\n"), 4, false, result);
	return result;
}
