#!/usr/bin/env node

let source;
let boardModule;
try {
	source = await import("../dist/src/change/orchestrator.js");
	boardModule = await import("../dist/src/change/board.js");
} catch {
	source = await import("../src/change/orchestrator.ts");
	boardModule = await import("../src/change/board.ts");
}

export function parseKanbanArgs(argv) {
	const result = { workspace: process.cwd(), format: "markdown", all: false };
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === "--all") result.all = true;
		else if (arg === "--workspace") result.workspace = argv[++index];
		else if (arg === "--format") result.format = argv[++index];
		else if (arg === "--as-of") result.asOf = argv[++index];
		else throw new Error(`Unknown option: ${arg}`);
	}
	if (!result.workspace || !["markdown", "json"].includes(result.format)) throw new Error("Use --workspace PATH --format markdown|json [--all] [--as-of ISO].");
	if (result.asOf && !Number.isFinite(Date.parse(result.asOf))) throw new Error("--as-of must be an ISO timestamp.");
	return result;
}

export async function renderKanban(argv) {
	const args = parseKanbanArgs(argv);
	const changes = await source.inspectChanges(args.workspace, { all: args.all });
	const board = boardModule.projectKanban(changes, { all: args.all, ...(args.asOf ? { asOf: args.asOf } : {}) });
	return args.format === "json" ? `${JSON.stringify(board, null, 2)}\n` : boardModule.renderKanbanMarkdown(board);
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
	try { process.stdout.write(await renderKanban(process.argv.slice(2))); }
	catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 2; }
}
