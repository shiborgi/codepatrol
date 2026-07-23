import { existsSync, readFileSync } from "node:fs";
import { hashFile } from "../shared/repo-files.js";
import { wikiManifestPath } from "../shared/state.js";
import { resolveInside } from "../shared/workspace.js";
import type { WikiManifest, WikiPageRecord } from "./types.js";

export function loadManifest(workspace: string): WikiManifest | undefined {
	try {
		const parsed = JSON.parse(readFileSync(wikiManifestPath(workspace), "utf8")) as WikiManifest;
		if (parsed.version !== 1 || parsed.okfVersion !== "0.1" || !parsed.pages || typeof parsed.pages !== "object") return undefined;
		for (const [conceptId, record] of Object.entries(parsed.pages)) {
			if (!record || typeof record !== "object" || record.path !== `${conceptId}.md` || !record.sources || typeof record.sources !== "object") return undefined;
			resolveInside(workspace, `docs/wiki/${record.path}`);
			for (const source of Object.keys(record.sources)) resolveInside(workspace, source);
		}
		return parsed;
	} catch {
		return undefined;
	}
}

export type Freshness =
	| { state: "fresh" }
	| { state: "page-missing" }
	| { state: "stale"; changed: string[]; deleted: string[] };

export function pageFreshness(workspace: string, record: WikiPageRecord): Freshness {
	if (!existsSync(resolveInside(workspace, `docs/wiki/${record.path}`))) return { state: "page-missing" };
	const changed: string[] = [];
	const deleted: string[] = [];
	for (const [source, expected] of Object.entries(record.sources)) {
		try {
			if (hashFile(resolveInside(workspace, source, true)) !== expected) changed.push(source);
		} catch {
			deleted.push(source);
		}
	}
	return changed.length || deleted.length ? { state: "stale", changed, deleted } : { state: "fresh" };
}
