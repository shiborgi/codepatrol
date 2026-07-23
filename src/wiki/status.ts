import { existsSync } from "node:fs";
import { languageForFile } from "../graph/languages.js";
import { graphStatePath, wikiManifestPath, wikiRoot } from "../shared/state.js";
import { listFiles } from "../shared/repo-files.js";
import { loadManifest, pageFreshness } from "./manifest.js";
import { validateBundle } from "./validate.js";

export interface WikiStatusData {
	exists: boolean;
	rewriteRequired: boolean;
	reasons: string[];
	manifestPath: string;
	graphExists: boolean;
	fresh: string[];
	stale: Array<{ conceptId: string; state: string; changed?: string[]; deleted?: string[] }>;
	uncoveredSources: string[];
	warnings: string[];
	text: string;
}

export async function wikiStatus(workspace: string): Promise<WikiStatusData> {
	const root = wikiRoot(workspace);
	const indexExists = existsSync(`${root}/index.md`);
	const treeExists = existsSync(root);
	const validation = validateBundle(root);
	const manifest = loadManifest(workspace);
	const reasons: string[] = [];
	if (treeExists && !indexExists) reasons.push("docs/wiki exists without a valid root index.md");
	if (indexExists && !validation.valid) reasons.push(...validation.errors.map((issue) => `${issue.path}: ${issue.message}`));
	if (indexExists && !manifest) reasons.push(".codepatrol/runtime/wiki/manifest.json is absent or incompatible");
	if (indexExists && manifest) {
		const concepts = new Set(validation.concepts.map((concept) => concept.id));
		const recorded = new Set(Object.keys(manifest.pages));
		if ([...concepts].some((id) => !recorded.has(id)) || [...recorded].some((id) => !concepts.has(id))) {
			reasons.push("wiki manifest concept set does not match the bundle");
		}
	}

	const fresh: string[] = [];
	const stale: WikiStatusData["stale"] = [];
	const covered = new Set<string>();
	if (manifest && reasons.length === 0) {
		for (const [conceptId, record] of Object.entries(manifest.pages)) {
			for (const source of Object.keys(record.sources)) covered.add(source);
			const state = pageFreshness(workspace, record);
			if (state.state === "fresh") fresh.push(conceptId);
			else stale.push({ conceptId, state: state.state, ...(state.state === "stale" ? { changed: state.changed, deleted: state.deleted } : {}) });
		}
	}
	const sources = listFiles(workspace).filter((file) => languageForFile(file) !== undefined);
	const uncoveredSources = sources.filter((source) => !covered.has(source));
	const warnings = validation.warnings.map((issue) => `${issue.path}: ${issue.message}`);
	const rewriteRequired = indexExists ? reasons.length > 0 : treeExists;
	const text = [
		`Wiki: ${indexExists ? "present" : "absent"}${rewriteRequired ? " — full rewrite required" : ""}`,
		`Graph: ${existsSync(graphStatePath(workspace)) ? "present" : "absent"}`,
		...(reasons.length ? ["Reasons:", ...reasons.map((reason) => `- ${reason}`)] : []),
		...(indexExists && !rewriteRequired ? [`Fresh concepts: ${fresh.length}`, `Stale concepts: ${stale.length}`, `Uncovered source files: ${uncoveredSources.length}`] : []),
	].join("\n");
	return {
		exists: indexExists,
		rewriteRequired,
		reasons,
		manifestPath: wikiManifestPath(workspace),
		graphExists: existsSync(graphStatePath(workspace)),
		fresh,
		stale,
		uncoveredSources,
		warnings,
		text,
	};
}
