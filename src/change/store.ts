import { existsSync, readFileSync, readdirSync } from "node:fs";
import { relative } from "node:path";
import { parse, stringify } from "yaml";
import { atomicWriteFile } from "../shared/atomic-store.js";
import { CodepatrolError } from "../shared/errors.js";
import { withWorkspaceLock } from "../shared/lock.js";
import { resolveInside } from "../shared/workspace.js";
import { assertChangeRecord, foldChange } from "./model.js";
import type { ChangeEvent, ChangeRecordV2, OperationOptions } from "./types.js";

export function changeDirectory(workspace: string, workId: string): string { return resolveInside(workspace, `.codepatrol/changes/${workId}`); }
export function changeRecordPath(workspace: string, workId: string): string { return resolveInside(workspace, `.codepatrol/changes/${workId}/change.yaml`); }
export function readChangeRecord(workspace: string, workId: string): ChangeRecordV2 {
	const path = changeRecordPath(workspace, workId);
	if (!existsSync(path)) throw new CodepatrolError("CHANGE_NOT_FOUND", `Change not found: ${workId}.`, 4);
	let record: any;
	try { record = parse(readFileSync(path, "utf8")); } catch { throw new CodepatrolError("CHANGE_INVALID", `Cannot parse ${relative(workspace, path)}.`, 4); }
	if (record && Array.isArray(record.events)) {
		for (const event of record.events) {
			if (event.run && "tokens" in event.run) {
				event.run.characters = event.run.tokens;
				delete event.run.tokens;
			}
		}
	}
	assertChangeRecord(record as ChangeRecordV2); foldChange(record as ChangeRecordV2); return record as ChangeRecordV2;
}
export function writeChangeRecord(workspace: string, record: ChangeRecordV2): void {
	assertChangeRecord(record); foldChange(record); atomicWriteFile(changeRecordPath(workspace, record.identity.work_id), stringify(record, { lineWidth: 0 }));
}
export async function appendChangeEvent(workspace: string, workId: string, event: ChangeEvent, options: OperationOptions = {}): Promise<ChangeRecordV2> {
	return withWorkspaceLock(workspace, `change-${workId}`, "change.append", () => {
		if (options.signal?.aborted) throw new CodepatrolError("CANCELLED", "Operation cancelled.", 130, true);
		const proposed = structuredClone(readChangeRecord(workspace, workId)); proposed.events.push(event); foldChange(proposed); writeChangeRecord(workspace, proposed); return proposed;
	}, { signal: options.signal });
}
export function listWorkingTreeChangeIds(workspace: string): string[] {
	const root = resolveInside(workspace, ".codepatrol/changes"); if (!existsSync(root)) return [];
	return readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory() && existsSync(resolveInside(workspace, `.codepatrol/changes/${entry.name}/change.yaml`))).map((entry) => entry.name).sort();
}
