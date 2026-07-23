/**
 * Cross-file resolution: turns a GraphDocument (per-file syntactic records)
 * into a linked GraphSnapshot. Pure with respect to the filesystem — import
 * probing resolves against the set of files in the document, so linking a
 * loaded document never touches disk (tsconfig aliases are read once by the
 * store and passed in).
 *
 * Confidence assignment:
 *   extracted — resolved relative/aliased import; call target defined in the
 *               same file
 *   inferred  — unique call/inherit target among imported files, or unique
 *               name repo-wide
 *   ambiguous — 2..MAX_CANDIDATES candidates; one edge per candidate. More
 *               than that is dropped and counted.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { posix } from "node:path";
import { isTestFile } from "../shared/repo-files.js";
import type { LanguageId } from "./languages.js";
import type { GraphDocument, GraphEdge, GraphNode, GraphSnapshot } from "./model.js";
import { createSnapshot, externalId, fileId, symbolId } from "./model.js";

const MAX_CANDIDATES = 5;
const TS_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

export interface TsPathAliases {
	baseUrl?: string;
	prefixes: Array<{ alias: string; target: string }>; // "@app/" → "src/"
}

export function loadTsPaths(root: string): TsPathAliases {
	const aliases: TsPathAliases = { prefixes: [] };
	try {
		const raw = readFileSync(join(root, "tsconfig.json"), "utf8").replace(/\/\/[^\n"]*$/gm, "");
		const config = JSON.parse(raw);
		const options = config?.compilerOptions ?? {};
		if (typeof options.baseUrl === "string") aliases.baseUrl = options.baseUrl;
		for (const [pattern, targets] of Object.entries(options.paths ?? {})) {
			if (!Array.isArray(targets) || typeof targets[0] !== "string") continue;
			if (pattern.endsWith("*") && targets[0].endsWith("*")) {
				aliases.prefixes.push({
					alias: pattern.slice(0, -1),
					target: posix.join(options.baseUrl ?? ".", targets[0].slice(0, -1)),
				});
			}
		}
	} catch {
		// no tsconfig or unparseable — fine
	}
	return aliases;
}

function normalize(path: string): string {
	const clean = posix.normalize(path);
	return clean.startsWith("./") ? clean.slice(2) : clean;
}

function probeTsFile(files: Set<string>, candidate: string): string | undefined {
	const base = normalize(candidate);
	const probes = [base];
	const remapped = base.replace(/\.([mc]?)js$/, ".$1ts");
	if (remapped !== base) probes.push(remapped, base.replace(/\.jsx?$/, ".tsx"));
	for (const ext of TS_EXTENSIONS) probes.push(base + ext);
	for (const ext of TS_EXTENSIONS) probes.push(`${base}/index${ext}`);
	for (const probe of probes) {
		if (files.has(probe)) return probe;
	}
	return undefined;
}

export function resolveImport(
	files: Set<string>,
	fromFile: string,
	specifier: string,
	language: LanguageId,
	tsPaths: TsPathAliases,
): string | undefined {
	if (language === "python") {
		const match = specifier.match(/^(\.+)(.*)$/);
		let baseDir: string;
		let modulePath: string;
		if (match) {
			baseDir = posix.dirname(fromFile);
			for (let i = 1; i < match[1].length; i++) baseDir = posix.dirname(baseDir);
			modulePath = match[2].replace(/^\./, "");
		} else {
			baseDir = "";
			modulePath = specifier;
		}
		const asPath = modulePath.replace(/\./g, "/");
		for (const candidate of [
			normalize(posix.join(baseDir, `${asPath}.py`)),
			normalize(posix.join(baseDir, asPath, "__init__.py")),
		]) {
			if (files.has(candidate)) return candidate;
		}
		return undefined;
	}
	if (language === "typescript" || language === "tsx" || language === "javascript") {
		if (specifier.startsWith(".")) {
			return probeTsFile(files, posix.join(posix.dirname(fromFile), specifier));
		}
		for (const { alias, target } of tsPaths.prefixes) {
			if (specifier.startsWith(alias)) return probeTsFile(files, posix.join(target, specifier.slice(alias.length)));
		}
		if (tsPaths.baseUrl) return probeTsFile(files, posix.join(tsPaths.baseUrl, specifier));
	}
	return undefined; // bare/external specifier (npm package, go/java/rust module)
}

export function link(document: GraphDocument, tsPaths: TsPathAliases = { prefixes: [] }): GraphSnapshot {
	const paths = new Set(Object.keys(document.files));
	const nodes: GraphNode[] = [];
	const edges: GraphEdge[] = [];
	const externals = new Set<string>();
	let droppedAmbiguousCalls = 0;

	// Nodes and the global symbol table.
	const symbolNodes = new Map<string, GraphNode[]>(); // file → symbol nodes (index-aligned)
	const byName = new Map<string, GraphNode[]>();
	for (const [path, record] of Object.entries(document.files)) {
		const testFile = isTestFile(path);
		nodes.push({ id: fileId(path), kind: "file", name: posix.basename(path), file: path, isTest: testFile });
		const inFile: GraphNode[] = [];
		for (const symbol of record.symbols) {
			const node: GraphNode = {
				id: symbolId(path, symbol.name, symbol.line),
				kind: symbol.kind,
				name: symbol.name,
				file: path,
				line: symbol.line,
				endLine: symbol.endLine,
				exported: symbol.exported,
				isTest: testFile,
			};
			inFile.push(node);
			nodes.push(node);
			const bucket = byName.get(symbol.name) ?? [];
			bucket.push(node);
			byName.set(symbol.name, bucket);
		}
		symbolNodes.set(path, inFile);
	}

	// Import edges (file level) + resolved-imports index used by call resolution.
	const resolvedImports = new Map<string, string[]>();
	for (const [path, record] of Object.entries(document.files)) {
		const resolved: string[] = [];
		for (const imp of record.imports) {
			const target = resolveImport(paths, path, imp.specifier, record.language, tsPaths);
			if (target && target !== path) {
				resolved.push(target);
				edges.push({ from: fileId(path), to: fileId(target), kind: "imports", confidence: "extracted", line: imp.line });
			} else if (!target) {
				const ext = externalId(imp.specifier);
				if (!externals.has(ext)) {
					externals.add(ext);
					nodes.push({ id: ext, kind: "external", name: imp.specifier });
				}
				edges.push({ from: fileId(path), to: ext, kind: "imports", confidence: "extracted", line: imp.line });
			}
		}
		resolvedImports.set(path, resolved);
	}

	// Call and inheritance edges, with the confidence matrix.
	const resolveName = (
		path: string,
		name: string,
		selfIndex: number | null,
	): { targets: GraphNode[]; confidence: "extracted" | "inferred" | "ambiguous" } | undefined => {
		const inFile = symbolNodes.get(path) ?? [];
		const sameFile = inFile.filter((s, i) => s.name === name && i !== selfIndex);
		if (sameFile.length > 0) return { targets: [sameFile[0]], confidence: "extracted" };

		const fromImports: GraphNode[] = [];
		for (const target of resolvedImports.get(path) ?? []) {
			for (const s of symbolNodes.get(target) ?? []) {
				if (s.name === name && s.exported) fromImports.push(s);
			}
		}
		if (fromImports.length === 1) return { targets: fromImports, confidence: "inferred" };
		if (fromImports.length > 1 && fromImports.length <= MAX_CANDIDATES) {
			return { targets: fromImports, confidence: "ambiguous" };
		}
		if (fromImports.length > MAX_CANDIDATES) return undefined;

		const global = (byName.get(name) ?? []).filter((s) => s.file !== path);
		if (global.length === 1) return { targets: global, confidence: "inferred" };
		if (global.length >= 2 && global.length <= MAX_CANDIDATES) return { targets: global, confidence: "ambiguous" };
		return undefined;
	};

	for (const [path, record] of Object.entries(document.files)) {
		const inFile = symbolNodes.get(path) ?? [];
		for (const call of record.calls) {
			const from = call.callerIndex !== null && inFile[call.callerIndex] ? inFile[call.callerIndex].id : fileId(path);
			const resolution = resolveName(path, call.callee, call.callerIndex);
			if (!resolution) {
				droppedAmbiguousCalls++;
				continue;
			}
			for (const target of resolution.targets) {
				edges.push({ from, to: target.id, kind: "calls", confidence: resolution.confidence, line: call.line });
			}
		}
		for (const inherit of record.inherits) {
			const from = inFile[inherit.symbolIndex];
			if (!from) continue;
			const resolution = resolveName(path, inherit.parent, inherit.symbolIndex);
			if (!resolution) continue;
			for (const target of resolution.targets) {
				edges.push({ from: from.id, to: target.id, kind: "inherits", confidence: resolution.confidence, line: inherit.line });
			}
		}
	}

	// Test-coverage edges: file-level, derived from import/call edges that
	// cross from a test file into non-test code.
	const nodeById = new Map(nodes.map((n) => [n.id, n]));
	const seenTests = new Set<string>();
	for (const edge of [...edges]) {
		if (edge.kind !== "imports" && edge.kind !== "calls") continue;
		const fromNode = nodeById.get(edge.from);
		const toNode = nodeById.get(edge.to);
		if (!fromNode?.isTest || !fromNode.file || !toNode?.file || toNode.isTest) continue;
		const key = `${fromNode.file}→${toNode.file}`;
		if (seenTests.has(key)) continue;
		seenTests.add(key);
		edges.push({ from: fileId(fromNode.file), to: fileId(toNode.file), kind: "tests", confidence: "extracted" });
	}

	return createSnapshot(nodes, edges, droppedAmbiguousCalls);
}
