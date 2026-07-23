/**
 * Lazy tree-sitter runtime — internal to the graph module. @vscode/tree-sitter-wasm bundles
 * the runtime and the grammar wasm files together, so they are always
 * ABI-compatible.
 *
 * Trees are parsed on demand and discarded by the caller (the file-hash cache
 * in the store makes re-parses rare); no tree cache lives here.
 */
import { createRequire } from "node:module";
import { dirname, extname, join } from "node:path";

const require = createRequire(import.meta.url);

export type LanguageId = "typescript" | "tsx" | "javascript" | "python" | "go" | "java" | "rust";

// Minimal typed view of the web-tree-sitter surface this module uses.
export interface TSPoint {
	row: number;
	column: number;
}
export interface TSNode {
	type: string;
	text: string;
	parent: TSNode | null;
	startPosition: TSPoint;
	endPosition: TSPoint;
	childForFieldName(field: string): TSNode | null;
}
export interface TSQueryCapture {
	name: string;
	node: TSNode;
}
export interface TSQueryMatch {
	pattern: number;
	captures: TSQueryCapture[];
}
export interface TSQuery {
	matches(node: TSNode): TSQueryMatch[];
}
export interface TSTree {
	rootNode: TSNode;
}
interface TSParser {
	setLanguage(language: unknown): void;
	parse(source: string): TSTree | null;
}
interface TreeSitterModule {
	Parser: { init(): Promise<void>; new (): TSParser };
	Language: { load(path: string): Promise<unknown> };
	Query: new (language: unknown, source: string) => TSQuery;
}

const EXTENSION_LANGUAGE: Record<string, LanguageId> = {
	".ts": "typescript",
	".mts": "typescript",
	".cts": "typescript",
	".tsx": "tsx",
	".js": "javascript",
	".mjs": "javascript",
	".cjs": "javascript",
	".jsx": "tsx", // the tsx grammar parses jsx fine
	".py": "python",
	".go": "go",
	".java": "java",
	".rs": "rust",
};

const WASM_FILE: Record<LanguageId, string> = {
	typescript: "tree-sitter-typescript.wasm",
	tsx: "tree-sitter-tsx.wasm",
	javascript: "tree-sitter-javascript.wasm",
	python: "tree-sitter-python.wasm",
	go: "tree-sitter-go.wasm",
	java: "tree-sitter-java.wasm",
	rust: "tree-sitter-rust.wasm",
};

export function languageForFile(path: string): LanguageId | undefined {
	return EXTENSION_LANGUAGE[extname(path).toLowerCase()];
}

let ts: TreeSitterModule | undefined;
let wasmDir: string | undefined;
let initPromise: Promise<void> | undefined;
const languages = new Map<LanguageId, unknown>();
const parsers = new Map<LanguageId, TSParser>();

async function ensureInit(): Promise<void> {
	initPromise ??= (async () => {
		ts = require("@vscode/tree-sitter-wasm") as TreeSitterModule;
		wasmDir = dirname(require.resolve("@vscode/tree-sitter-wasm"));
		await ts.Parser.init();
	})();
	await initPromise;
}

async function getLanguage(id: LanguageId): Promise<unknown> {
	await ensureInit();
	let language = languages.get(id);
	if (!language) {
		language = await ts!.Language.load(join(wasmDir!, WASM_FILE[id]));
		languages.set(id, language);
	}
	return language;
}

/** Compile a query; returns undefined on grammar/query drift so callers degrade. */
export async function createQuery(id: LanguageId, source: string): Promise<TSQuery | undefined> {
	const language = await getLanguage(id);
	try {
		return new ts!.Query(language, source);
	} catch {
		return undefined;
	}
}

export async function parseSource(source: string, id: LanguageId): Promise<TSTree | undefined> {
	await ensureInit();
	let parser = parsers.get(id);
	if (!parser) {
		parser = new ts!.Parser();
		parser.setLanguage(await getLanguage(id));
		parsers.set(id, parser);
	}
	return parser.parse(source) ?? undefined;
}
