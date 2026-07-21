/**
 * File → FileExtract. The only module that touches tree-sitter output; the
 * rest of the graph consumes plain records. Everything here is per-file and
 * syntactic — cross-file resolution lives in link.ts.
 *
 * Trees are parsed and discarded per call; the store's content-hash cache is
 * what makes repeat extraction rare.
 */
import { readFileSync, statSync } from "node:fs";
import type { LanguageId, TSNode } from "./languages.js";
import { languageForFile, parseSource } from "./languages.js";
import { query } from "./queries.js";

export type SymbolKind = "function" | "method" | "class" | "interface" | "type" | "const";

export interface SymbolRecord {
	name: string;
	kind: SymbolKind;
	line: number;
	endLine: number;
	exported: boolean;
}

export interface ImportRecord {
	specifier: string;
	line: number;
}

export interface CallRecord {
	/** Index into `symbols` of the innermost enclosing definition, or null at module level. */
	callerIndex: number | null;
	callee: string;
	line: number;
}

export interface InheritRecord {
	symbolIndex: number;
	parent: string;
	line: number;
}

export interface FileExtract {
	language: LanguageId;
	lineCount: number;
	symbols: SymbolRecord[];
	imports: ImportRecord[];
	calls: CallRecord[];
	inherits: InheritRecord[];
}

const MAX_FILE_BYTES = 1_500_000;

export async function extractFile(absPath: string): Promise<FileExtract | undefined> {
	const language = languageForFile(absPath);
	if (!language) return undefined;
	try {
		const stat = statSync(absPath);
		if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return undefined;
	} catch {
		return undefined;
	}
	let source: string;
	try {
		source = readFileSync(absPath, "utf8");
	} catch {
		return undefined;
	}
	return extractSource(source, language);
}

export async function extractSource(source: string, language: LanguageId): Promise<FileExtract> {
	const empty: FileExtract = {
		language,
		lineCount: source.length === 0 ? 0 : source.split("\n").length,
		symbols: [],
		imports: [],
		calls: [],
		inherits: [],
	};
	const tree = await parseSource(source, language);
	if (!tree) return empty;
	const root = tree.rootNode;

	empty.symbols = await collectSymbols(root, language);
	empty.imports = await collectImports(root, language);
	empty.calls = await collectCalls(root, language, empty.symbols);
	empty.inherits = await collectInherits(root, language, empty.symbols);
	return empty;
}

async function collectSymbols(root: TSNode, language: LanguageId): Promise<SymbolRecord[]> {
	const defs = await query(language, "defs");
	if (!defs) return [];
	// A declarator can match two patterns (arrow-function const is both a
	// "function" and a "const"); keep one record per name@line, preferring the
	// more specific non-const kind.
	const byPosition = new Map<string, SymbolRecord>();
	for (const match of defs.matches(root)) {
		const defNode = match.captures.find((c) => c.name === "def")?.node;
		const nameCapture = match.captures.find((c) => c.name.startsWith("name."));
		if (!defNode || !nameCapture) continue;
		const kind = nameCapture.name.slice("name.".length) as SymbolKind;
		const name = nameCapture.node.text;
		const line = nameCapture.node.startPosition.row + 1;
		const key = `${name}@${line}`;
		const existing = byPosition.get(key);
		if (existing) {
			if (existing.kind === "const" && kind !== "const") existing.kind = kind;
			continue;
		}
		byPosition.set(key, {
			name,
			kind,
			line,
			endLine: defNode.endPosition.row + 1,
			exported: isExported(language, defNode, name),
		});
	}
	return [...byPosition.values()].sort((a, b) => a.line - b.line || a.name.localeCompare(b.name));
}

function isExported(language: LanguageId, defNode: TSNode, name: string): boolean {
	switch (language) {
		case "typescript":
		case "tsx":
		case "javascript": {
			// export_statement wraps the declaration; for methods, an exported
			// enclosing class makes the method reachable, so walk a few levels.
			let node: TSNode | null = defNode;
			for (let hops = 0; node && hops < 4; hops++) {
				if (node.type === "export_statement") return true;
				node = node.parent;
			}
			return false;
		}
		case "python":
			return !name.startsWith("_");
		case "go":
			return /^[A-Z]/.test(name);
		case "java":
			return /^\s*(?:@[\w.()"' ]+\s+)*public\b/.test(defNode.text);
		case "rust":
			return defNode.text.trimStart().startsWith("pub");
	}
}

function stripQuotes(text: string): string {
	const first = text[0];
	if ((first === '"' || first === "'" || first === "`") && text.endsWith(first)) {
		return text.slice(1, -1);
	}
	return text;
}

async function collectImports(root: TSNode, language: LanguageId): Promise<ImportRecord[]> {
	const imports = await query(language, "imports");
	if (!imports) return [];
	const seen = new Set<string>();
	const records: ImportRecord[] = [];
	for (const match of imports.matches(root)) {
		for (const capture of match.captures) {
			if (capture.name !== "source") continue;
			const specifier = stripQuotes(capture.node.text);
			const line = capture.node.startPosition.row + 1;
			const key = `${specifier}@${line}`;
			if (specifier && !seen.has(key)) {
				seen.add(key);
				records.push({ specifier, line });
			}
		}
	}
	return records;
}

/** Innermost symbol whose line span contains `line`, or null. */
function enclosingSymbol(symbols: SymbolRecord[], line: number): number | null {
	let best: number | null = null;
	let bestSpan = Number.POSITIVE_INFINITY;
	for (let i = 0; i < symbols.length; i++) {
		const s = symbols[i];
		const span = s.endLine - s.line;
		if (s.line <= line && line <= s.endLine && span < bestSpan) {
			best = i;
			bestSpan = span;
		}
	}
	return best;
}

async function collectCalls(root: TSNode, language: LanguageId, symbols: SymbolRecord[]): Promise<CallRecord[]> {
	const calls = await query(language, "calls");
	if (!calls) return [];
	const records: CallRecord[] = [];
	for (const match of calls.matches(root)) {
		const callee = match.captures.find((c) => c.name === "callee")?.node;
		if (!callee) continue;
		const line = callee.startPosition.row + 1;
		records.push({ callerIndex: enclosingSymbol(symbols, line), callee: callee.text, line });
	}
	return records;
}

async function collectInherits(root: TSNode, language: LanguageId, symbols: SymbolRecord[]): Promise<InheritRecord[]> {
	const inherits = await query(language, "inherits");
	if (!inherits) return [];
	const records: InheritRecord[] = [];
	for (const match of inherits.matches(root)) {
		const parent = match.captures.find((c) => c.name === "parent")?.node;
		if (!parent) continue;
		const line = parent.startPosition.row + 1;
		const symbolIndex = enclosingSymbol(symbols, line);
		if (symbolIndex === null) continue;
		records.push({ symbolIndex, parent: parent.text, line });
	}
	return records;
}
