import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncGraph, openSnapshot, graphPath } from "./store.js";
import { graphSync } from "./service.js";

function fixtureRepo(): string {
	const root = mkdtempSync(join(tmpdir(), "pi-arch-store-"));
	writeFileSync(
		join(root, "tsconfig.json"),
		JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@app/*": ["src/*"] } } }),
	);
	mkdirSync(join(root, "src"));
	writeFileSync(
		join(root, "src", "util.ts"),
		`export function helper() {\n\tinternal();\n}\nfunction internal() {}\nexport function dupe() {}\n`,
	);
	writeFileSync(join(root, "src", "extra.ts"), `export function thing() {}\nexport function dupe() {}\n`);
	writeFileSync(
		join(root, "src", "order.ts"),
		`import { helper } from "./util";\nimport { thing } from "@app/extra";\n\nexport function process() {\n\thelper();\n\tthing();\n\tdupe();\n}\n`,
	);
	writeFileSync(
		join(root, "src", "order.test.ts"),
		`import { process } from "./order";\n\nfunction run() {\n\tprocess();\n}\n`,
	);
	mkdirSync(join(root, "py"));
	writeFileSync(join(root, "py", "b.py"), `def x():\n    pass\n`);
	writeFileSync(join(root, "py", "a.py"), `from .b import x\n\ndef use():\n    x()\n`);
	return root;
}

test("first sync builds the document and resolves imports (relative, tsconfig paths, python dots)", async () => {
	const root = fixtureRepo();
	try {
		const { report, snapshot } = await syncGraph(root);
		assert.equal(report.extracted, 6);
		assert.equal(report.removed, 0);
		assert.ok(existsSync(graphPath(root)));

		const doc = JSON.parse(readFileSync(graphPath(root), "utf8"));
		assert.equal(doc.version, 1);
		assert.ok(doc.files["src/order.ts"].hash);

		assert.deepEqual(snapshot.importsOf("src/order.ts").sort(), ["src/extra.ts", "src/util.ts"]);
		assert.deepEqual(snapshot.importersOf("src/order.ts"), ["src/order.test.ts"]);
		assert.deepEqual(snapshot.importsOf("py/a.py"), ["py/b.py"]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("second sync re-extracts nothing; touching one file re-extracts exactly that file", async () => {
	const root = fixtureRepo();
	try {
		await syncGraph(root);
		const second = await syncGraph(root);
		assert.equal(second.report.extracted, 0);
		assert.equal(second.report.unchanged, 6);

		writeFileSync(join(root, "src", "extra.ts"), `export function thing() {}\nexport function dupe() {}\nexport function added() {}\n`);
		const third = await syncGraph(root);
		assert.equal(third.report.extracted, 1);
		assert.ok(third.snapshot.symbolsByName("added").length === 1);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("mtime-only touch does not re-extract (hash is the key)", async () => {
	const root = fixtureRepo();
	try {
		await syncGraph(root);
		const when = new Date();
		utimesSync(join(root, "src", "util.ts"), when, when);
		const { report } = await syncGraph(root);
		assert.equal(report.extracted, 0);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("deleted files are pruned from the document", async () => {
	const root = fixtureRepo();
	try {
		await syncGraph(root);
		rmSync(join(root, "py", "b.py"));
		const { report, snapshot } = await syncGraph(root);
		assert.equal(report.removed, 1);
		assert.equal(snapshot.fileNode("py/b.py"), undefined);
		assert.deepEqual(snapshot.importsOf("py/a.py"), []);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("corrupt graph.json triggers a clean full rebuild", async () => {
	const root = fixtureRepo();
	try {
		await syncGraph(root);
		writeFileSync(graphPath(root), "{ not json !!");
		const { report } = await syncGraph(root);
		assert.equal(report.extracted, 6);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("call edges carry the confidence matrix: same-file, unique-import, ambiguous", async () => {
	const root = fixtureRepo();
	try {
		const { snapshot } = await syncGraph(root);

		// same file: helper() -> internal() is extracted
		const helper = snapshot.symbolsByName("helper")[0];
		const sameFile = snapshot.outEdges(helper.id, ["calls"]);
		assert.equal(sameFile.length, 1);
		assert.equal(sameFile[0].confidence, "extracted");

		// unique target across imported files: process() -> helper() is inferred
		const processSym = snapshot.symbolsByName("process").find((s) => s.file === "src/order.ts")!;
		const calls = snapshot.outEdges(processSym.id, ["calls"]);
		const toHelper = calls.filter((e) => snapshot.node(e.to)?.name === "helper");
		assert.equal(toHelper.length, 1);
		assert.equal(toHelper[0].confidence, "inferred");

		// dupe() defined in two imported files: ambiguous edge to each candidate
		const toDupe = calls.filter((e) => snapshot.node(e.to)?.name === "dupe");
		assert.equal(toDupe.length, 2);
		assert.ok(toDupe.every((e) => e.confidence === "ambiguous"));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("test files produce tests edges toward the code they exercise", async () => {
	const root = fixtureRepo();
	try {
		const { snapshot } = await syncGraph(root);
		const testEdges = snapshot.outEdges("file:src/order.test.ts", ["tests"]);
		assert.ok(testEdges.some((e) => e.to === "file:src/order.ts"));
		const testers = snapshot.inEdges("file:src/order.ts", ["tests"]).map((e) => e.from);
		assert.deepEqual(testers, ["file:src/order.test.ts"]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("openSnapshot loads without extraction and returns undefined when absent", async () => {
	const root = fixtureRepo();
	try {
		assert.equal(await openSnapshot(root), undefined);
		await syncGraph(root);
		const snapshot = await openSnapshot(root);
		assert.ok(snapshot);
		assert.ok(snapshot!.files().includes("src/order.ts"));
		const stats = snapshot!.stats();
		assert.equal(stats.files, 6);
		assert.ok(stats.edgesByKind.imports >= 4);
		assert.ok(stats.edgesByConfidence.ambiguous >= 2);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("legacy .pi graph is readable and migrates idempotently on sync", async () => {
	const root = fixtureRepo();
	try {
		await syncGraph(root);
		const current = graphPath(root);
		const legacy = join(root, ".pi", "code-graph", "graph.json");
		mkdirSync(join(root, ".pi", "code-graph"), { recursive: true });
		writeFileSync(legacy, readFileSync(current));
		rmSync(join(root, ".codepatrol"), { recursive: true, force: true });
		assert.ok((await openSnapshot(root))?.files().includes("src/order.ts"));
		const migrated = await syncGraph(root);
		assert.equal(migrated.report.extracted, 0);
		assert.ok(existsSync(current));
		assert.ok(existsSync(legacy), "legacy state is read-only and remains in place");
		const repeat = await syncGraph(root);
		assert.equal(repeat.report.extracted, 0);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("cancelled sync leaves the previous graph unchanged", async () => {
	const root = fixtureRepo();
	try {
		await syncGraph(root);
		const before = readFileSync(graphPath(root), "utf8");
		writeFileSync(join(root, "src", "extra.ts"), "export const changed = true;\n");
		const controller = new AbortController();
		await assert.rejects(
			syncGraph(root, {
				signal: controller.signal,
				onProgress: () => controller.abort(),
			}),
			(error: unknown) => error instanceof Error && error.name === "AbortError",
		);
		assert.equal(readFileSync(graphPath(root), "utf8"), before);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("concurrent graph writers serialize without corrupting state", async () => {
	const root = fixtureRepo();
	try {
		await graphSync(root);
		writeFileSync(join(root, "src", "extra.ts"), "export const concurrent = true;\n");
		const results = await Promise.all([graphSync(root), graphSync(root)]);
		assert.deepEqual(results.map((result) => result.report.extracted).sort(), [0, 1]);
		const document = JSON.parse(readFileSync(graphPath(root), "utf8"));
		assert.equal(document.version, 1);
		assert.ok(document.files["src/extra.ts"]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
