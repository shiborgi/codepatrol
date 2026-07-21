import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodepatrolError } from "../shared/errors.js";
import { graphSync } from "../graph/service.js";
import { wikiManifestPath } from "../shared/state.js";
import { generateWiki } from "./generate.js";
import { recoverWikiTransactions, wikiRecord, type WikiTransactionPhase } from "./record.js";
import { wikiStatus } from "./status.js";
import { validateBundle, validateWiki } from "./validate.js";

const INDEX = `---\nokf_version: "0.1"\n---\n\n# Project wiki\n\n- [Architecture](architecture.md) - System map.\n`;
const ARCHITECTURE = `---\ntype: Software Architecture\ntitle: Architecture\ndescription: System modules and relationships.\ncustom_field: preserved\n---\n\n# Architecture\n\nEntry point at \`src/main.ts:1\`.\n`;

function workspace(): string {
	const root = mkdtempSync(join(tmpdir(), "codepatrol wiki space "));
	mkdirSync(join(root, "src"));
	writeFileSync(join(root, "src", "main.ts"), "export const main = true;\n");
	return root;
}

function rewritePayload(content = ARCHITECTURE) {
	return {
		version: 1,
		mode: "rewrite",
		files: [
			{ path: "index.md", content: INDEX },
			{ path: "architecture.md", content, sources: ["src/main.ts"] },
		],
		updateAgentsPointer: true,
	};
}

test("OKF validator accepts unknown fields and reports broken links as warnings", () => {
	const root = mkdtempSync(join(tmpdir(), "codepatrol-okf-"));
	try {
		writeFileSync(join(root, "index.md"), INDEX.replace("architecture.md", "missing.md"));
		writeFileSync(join(root, "architecture.md"), ARCHITECTURE);
		const result = validateBundle(root);
		assert.equal(result.valid, true);
		assert.equal(result.concepts[0].fields.custom_field, "preserved");
		assert.ok(result.warnings.some((warning) => warning.code === "BROKEN_LINK"));
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("OKF validator rejects missing type, index metadata, and ascending logs", () => {
	const root = mkdtempSync(join(tmpdir(), "codepatrol-okf-invalid-"));
	try {
		writeFileSync(join(root, "index.md"), `---\nokf_version: "0.1"\nextra: no\n---\n\n# Wiki\n\n- [Bad](bad.md) - bad.\n`);
		writeFileSync(join(root, "bad.md"), `---\ntitle: Bad\n---\n\n# Bad\n`);
		writeFileSync(join(root, "log.md"), `# Log\n\n## 2026-01-01\n* Old\n\n## 2026-02-01\n* New\n`);
		const result = validateBundle(root);
		assert.equal(result.valid, false);
		assert.ok(result.errors.some((error) => error.code === "TYPE_MISSING"));
		assert.ok(result.errors.some((error) => error.code === "INDEX_FRONTMATTER"));
		assert.ok(result.errors.some((error) => error.code === "LOG_ORDER"));
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("OKF validator accepts numbered workspace path citations", () => {
	const root = mkdtempSync(join(tmpdir(), "codepatrol-okf-citations-"));
	try {
		writeFileSync(join(root, "index.md"), INDEX);
		writeFileSync(join(root, "architecture.md"), `${ARCHITECTURE}\n# Citations\n\n[1] \`src/main.ts:1\`\n`);
		const result = validateBundle(root);
		assert.equal(result.valid, true);
		assert.equal(result.warnings.some((warning) => warning.code === "CITATION_FORMAT"), false);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("graph-backed generation creates architectural concepts from a clean wiki workspace", async () => {
	const root = workspace();
	try {
		writeFileSync(join(root, "src", "main.test.ts"), "import { main } from './main';\nvoid main;\n");
		await graphSync(root);
		const result = await generateWiki(root, { now: new Date("2026-07-18T12:00:00.000Z") });

		assert.equal(result.mode, "rewrite");
		assert.equal((await validateWiki(root)).valid, true);
		assert.ok(result.written.includes("architecture.md"));
		assert.ok(result.written.includes("modules/index.md"));
		const modulePages = readdirSync(join(root, "docs", "wiki", "modules")).filter((name) => name !== "index.md");
		assert.equal(modulePages.length, 1, "one graph cluster should produce one module concept, not one page per file");

		const architecture = readFileSync(join(root, "docs", "wiki", "architecture.md"), "utf8");
		assert.match(architecture, /## Entry points/);
		assert.match(architecture, /## Entry points[\s\S]*`src\/main\.ts:1`/);
		assert.match(architecture, /## Architectural modules/);
		assert.match(architecture, /## Cross-module dependencies/);
		assert.match(architecture, /## Tests/);
		assert.match(architecture, /\[\d+\] `src\/main\.ts:1`/);

		const module = readFileSync(join(root, "docs", "wiki", "modules", modulePages[0]), "utf8");
		assert.match(module, /## Interfaces/);
		assert.match(module, /## Dependencies/);
		assert.match(module, /src\/main\.ts/);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("graph-backed module pages bound exported-symbol listings", async () => {
	const root = workspace();
	try {
		writeFileSync(join(root, "src", "main.ts"), Array.from({ length: 30 }, (_, index) => `export const item${index} = ${index};`).join("\n"));
		await graphSync(root);
		await generateWiki(root, { now: new Date("2026-07-18T12:00:00.000Z") });
		const moduleName = readdirSync(join(root, "docs", "wiki", "modules")).find((name) => name !== "index.md")!;
		const module = readFileSync(join(root, "docs", "wiki", "modules", moduleName), "utf8");
		assert.match(module, /5 additional exported symbols omitted/);
		assert.doesNotMatch(module, /`item29`/);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("rewrite commits a valid bundle, external manifest, freshness, and managed pointer", async () => {
	const root = workspace();
	try {
		mkdirSync(join(root, "docs", "wiki"), { recursive: true });
		writeFileSync(join(root, "docs", "wiki", "legacy.md"), "legacy content\n");
		const result = await wikiRecord(root, rewritePayload());
		assert.equal(result.mode, "rewrite");
		assert.deepEqual(result.removed, ["legacy.md"]);
		assert.ok(existsSync(join(root, "docs", "wiki", "index.md")));
		assert.equal(existsSync(join(root, "docs", "wiki", "legacy.md")), false);
		assert.ok(existsSync(wikiManifestPath(root)));
		assert.equal(existsSync(join(root, "docs", "wiki", "manifest.json")), false);
		assert.match(readFileSync(join(root, "AGENTS.md"), "utf8"), /codepatrol:wiki:begin/);
		assert.equal((await validateWiki(root)).valid, true);
		const status = await wikiStatus(root);
		assert.equal(status.rewriteRequired, false);
		assert.deepEqual(status.fresh, ["architecture"]);

		writeFileSync(join(root, "src", "main.ts"), "export const main = false;\n");
		const stale = await wikiStatus(root);
		assert.equal(stale.stale[0].conceptId, "architecture");
		assert.deepEqual(stale.stale[0].changed, ["src/main.ts"]);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("failed rewrite leaves the prior bundle and manifest untouched", async () => {
	const root = workspace();
	try {
		await wikiRecord(root, rewritePayload());
		const oldPage = readFileSync(join(root, "docs", "wiki", "architecture.md"), "utf8");
		const oldManifest = readFileSync(wikiManifestPath(root), "utf8");
		await assert.rejects(
			wikiRecord(root, rewritePayload(`---\ntitle: Broken\n---\n\n# Broken\n`)),
			(error: unknown) => error instanceof CodepatrolError && error.code === "WIKI_INVALID",
		);
		assert.equal(readFileSync(join(root, "docs", "wiki", "architecture.md"), "utf8"), oldPage);
		assert.equal(readFileSync(wikiManifestPath(root), "utf8"), oldManifest);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("incremental update preserves untouched concepts and removes explicit concepts", async () => {
	const root = workspace();
	try {
		const module = `---\ntype: Software Module\ntitle: Extra\ndescription: Extra module.\nunknown: keep\n---\n\n# Extra\n`;
		await wikiRecord(root, {
			version: 1, mode: "rewrite", files: [
				{ path: "index.md", content: INDEX.replace("\n", "\n").replace("System map.", "System map.\n- [Extra](modules/extra.md) - Extra module.") },
				{ path: "architecture.md", content: ARCHITECTURE, sources: ["src/main.ts"] },
				{ path: "modules/extra.md", content: module, sources: [] },
			],
		});
		const preserved = readFileSync(join(root, "docs", "wiki", "modules", "extra.md"), "utf8");
		await wikiRecord(root, {
			version: 1, mode: "incremental", files: [
				{ path: "architecture.md", content: ARCHITECTURE.replace("relationships", "dependencies"), sources: ["src/main.ts"] },
			],
		});
		assert.equal(readFileSync(join(root, "docs", "wiki", "modules", "extra.md"), "utf8"), preserved);
		await wikiRecord(root, {
			version: 1, mode: "incremental", files: [{ path: "index.md", content: INDEX }], remove: ["modules/extra.md"],
		});
		assert.equal(existsSync(join(root, "docs", "wiki", "modules", "extra.md")), false);
		assert.equal((await wikiStatus(root)).rewriteRequired, false);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("incremental mode rejects absent or incompatible state", async () => {
	const root = workspace();
	try {
		await assert.rejects(
			wikiRecord(root, { version: 1, mode: "incremental", files: [{ path: "index.md", content: INDEX }] }),
			(error: unknown) => error instanceof CodepatrolError && error.code === "STATE_INCOMPATIBLE",
		);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("recovery rolls back a crash between bundle promotion and manifest commit", async () => {
	const root = workspace();
	try {
		await wikiRecord(root, rewritePayload());
		const oldPage = readFileSync(join(root, "docs", "wiki", "architecture.md"), "utf8");
		const oldManifest = readFileSync(wikiManifestPath(root), "utf8");
		const transaction = join(root, ".codepatrol", "wiki", "transactions", "crash-fixture");
		mkdirSync(transaction, { recursive: true });
		renameSync(join(root, "docs", "wiki"), join(transaction, "backup"));
		mkdirSync(join(root, "docs", "wiki"), { recursive: true });
		writeFileSync(join(root, "docs", "wiki", "index.md"), "new but uncommitted");
		writeFileSync(join(transaction, "old-manifest.json"), oldManifest);
		writeFileSync(wikiManifestPath(root), "{\"new\":true}\n");
		writeFileSync(join(transaction, "transaction.json"), JSON.stringify({
			phase: "bundle-promoted", originalHadWiki: true, originalHadManifest: true,
		}));

		recoverWikiTransactions(root);
		assert.equal(readFileSync(join(root, "docs", "wiki", "architecture.md"), "utf8"), oldPage);
		assert.equal(readFileSync(wikiManifestPath(root), "utf8"), oldManifest);
		assert.equal(existsSync(transaction), false);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

for (const phase of ["staged", "old-moved", "bundle-promoted", "manifest-written"] satisfies WikiTransactionPhase[]) {
	test(`injected failure at ${phase} preserves the prior wiki transaction`, async () => {
		const root = workspace();
		try {
			await wikiRecord(root, rewritePayload());
			const oldPage = readFileSync(join(root, "docs", "wiki", "architecture.md"), "utf8");
			const oldManifest = readFileSync(wikiManifestPath(root), "utf8");
			await assert.rejects(
				wikiRecord(root, rewritePayload(ARCHITECTURE.replace("relationships", "dependencies")), undefined, {
					afterPhase(current) { if (current === phase) throw new Error(`failure at ${phase}`); },
				}),
				new RegExp(`failure at ${phase}`),
			);
			assert.equal(readFileSync(join(root, "docs", "wiki", "architecture.md"), "utf8"), oldPage);
			assert.equal(readFileSync(wikiManifestPath(root), "utf8"), oldManifest);
		} finally { rmSync(root, { recursive: true, force: true }); }
	});
}

test("cancelled record does not create a bundle or manifest", async () => {
	const root = workspace();
	try {
		const controller = new AbortController();
		controller.abort();
		await assert.rejects(
			wikiRecord(root, rewritePayload(), controller.signal),
			(error: unknown) => error instanceof CodepatrolError && error.code === "CANCELLED" && error.exitCode === 130,
		);
		assert.equal(existsSync(join(root, "docs", "wiki")), false);
		assert.equal(existsSync(wikiManifestPath(root)), false);
	} finally { rmSync(root, { recursive: true, force: true }); }
});
