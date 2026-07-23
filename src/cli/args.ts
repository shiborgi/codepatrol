import { CodepatrolError } from "../shared/errors.js";
import { RELATIONS, type Relation } from "../graph/service.js";

export type OutputFormat = "text" | "json";

export interface ParsedArgs {
	command: string;
	workspace?: string;
	format: OutputFormat;
	help: boolean;
	version: boolean;
	force?: boolean;
	path?: string;
	query?: string;
	exact?: boolean;
	symbol?: string;
	file?: string;
	relations: Relation[];
	files: string[];
	symbols: string[];
	sinceRef?: string;
	includeAmbiguous?: boolean;
	input?: string;
	id?: string;
	all?: boolean;
	asOf?: string;
}

const BOOLEAN_FLAGS = new Set(["help", "version", "force", "exact", "include-ambiguous", "all"]);
const REPEATABLE = new Set(["file", "symbol", "relation"]);
const KNOWN = new Set([
	"workspace", "format", "help", "version", "force", "path", "query", "exact", "symbol", "file",
	"relation", "since-ref", "include-ambiguous", "input", "id", "all", "as-of",
]);
const GLOBAL = new Set(["workspace", "format", "help", "version"]);
const COMMAND_OPTIONS = new Map<string, Set<string>>([
	["status", new Set(["all", "as-of"])],
	["graph.sync", new Set(["force"])],
	["graph.overview", new Set(["path"])],
	["graph.outline", new Set(["file"])],
	["graph.find", new Set(["query", "exact"])],
	["graph.neighbors", new Set(["symbol", "file", "relation"])],
	["graph.impact", new Set(["file", "symbol", "since-ref", "include-ambiguous"])],
	["wiki.status", new Set()],
	["wiki.validate", new Set()],
	["wiki.generate", new Set()],
	["wiki.record", new Set(["input"])],
	["change.start", new Set(["input"])],
	["change.inspect", new Set(["id"])],
	["change.transition", new Set(["id", "input"])],
	["change.session", new Set(["id", "input"])],
	["change.doctor", new Set(["id"])],
	["change.close", new Set(["id", "input"])],
]);

function fail(message: string): never {
	throw new CodepatrolError("INVALID_ARGUMENT", message, 2);
}

export function parseArgs(argv: string[]): ParsedArgs {
	const positionals: string[] = [];
	const values = new Map<string, string[]>();
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === "-h") {
			(values.get("help") ?? values.set("help", []).get("help")!).push("true");
			continue;
		}
		if (!arg.startsWith("--")) {
			positionals.push(arg);
			continue;
		}
		const equal = arg.indexOf("=");
		const name = arg.slice(2, equal === -1 ? undefined : equal);
		if (!KNOWN.has(name)) fail(`Unknown option: --${name}`);
		let value: string;
		if (BOOLEAN_FLAGS.has(name)) {
			if (equal !== -1) fail(`Boolean option does not take a value: --${name}`);
			value = "true";
		} else {
			value = equal === -1 ? argv[++index] : arg.slice(equal + 1);
			if (value === undefined || value.startsWith("--")) fail(`Missing value for --${name}`);
		}
		const list = values.get(name) ?? [];
		if (!REPEATABLE.has(name) && list.length > 0) fail(`Option may only be passed once: --${name}`);
		list.push(value);
		values.set(name, list);
	}

	const format = values.get("format")?.[0] ?? "text";
	if (format !== "text" && format !== "json") fail(`Unsupported format: ${format}`);
	const relations = values.get("relation") ?? [];
	for (const relation of relations) if (!RELATIONS.includes(relation as Relation)) fail(`Unsupported relation: ${relation}`);

	const command = positionals.slice(0, 2).join(".");
	if (positionals.length > 2) fail(`Unexpected argument: ${positionals[2]}`);
	const allowed = COMMAND_OPTIONS.get(command);
	if (allowed) {
		for (const name of values.keys()) {
			if (!GLOBAL.has(name) && !allowed.has(name)) fail(`Option --${name} is not valid for ${command}.`);
		}
	}
	return {
		command,
		workspace: values.get("workspace")?.[0],
		format,
		help: values.has("help"),
		version: values.has("version"),
		force: values.has("force"),
		path: values.get("path")?.[0],
		query: values.get("query")?.[0],
		exact: values.has("exact"),
		symbol: values.get("symbol")?.at(-1),
		file: values.get("file")?.at(-1),
		relations: relations as Relation[],
		files: values.get("file") ?? [],
		symbols: values.get("symbol") ?? [],
		sinceRef: values.get("since-ref")?.[0],
		includeAmbiguous: values.has("include-ambiguous"),
		input: values.get("input")?.[0],
		id: values.get("id")?.[0],
		all: values.has("all"),
		asOf: values.get("as-of")?.[0],
	};
}

export function requireValue(value: string | undefined, option: string): string {
	if (!value) fail(`Missing required option: --${option}`);
	return value;
}
