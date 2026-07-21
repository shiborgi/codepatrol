import { test } from "node:test";
import assert from "node:assert/strict";
import type { GraphEdge, GraphNode } from "./model.js";
import { createSnapshot, fileId, symbolId } from "./model.js";
import { clusterFiles, entryPoints, impact, topFanIn } from "./analysis.js";

function fileNode(path: string, isTest = false): GraphNode {
	return { id: fileId(path), kind: "file", name: path.split("/").pop()!, file: path, isTest };
}

function imports(from: string, to: string): GraphEdge {
	return { from: fileId(from), to: fileId(to), kind: "imports", confidence: "extracted" };
}

test("impact: diamond closure with depths", () => {
	// a imports b and c; b and c import d. Change d → b,c at depth 1, a at depth 2.
	const snapshot = createSnapshot(
		[fileNode("a.ts"), fileNode("b.ts"), fileNode("c.ts"), fileNode("d.ts")],
		[imports("a.ts", "b.ts"), imports("a.ts", "c.ts"), imports("b.ts", "d.ts"), imports("c.ts", "d.ts")],
		0,
	);
	const result = impact(snapshot, { files: ["d.ts"] });
	assert.equal(result.affectedFiles.get("b.ts"), 1);
	assert.equal(result.affectedFiles.get("c.ts"), 1);
	assert.equal(result.affectedFiles.get("a.ts"), 2);
	assert.equal(result.affectedFiles.has("d.ts"), false); // seeds are not "affected"
});

test("impact: cycles terminate", () => {
	const snapshot = createSnapshot(
		[fileNode("x.ts"), fileNode("y.ts")],
		[imports("x.ts", "y.ts"), imports("y.ts", "x.ts")],
		0,
	);
	const result = impact(snapshot, { files: ["y.ts"] });
	assert.equal(result.affectedFiles.get("x.ts"), 1);
	assert.equal(result.affectedFiles.size, 1);
});

test("impact: symbol seeds traverse call edges up to callers", () => {
	const helper: GraphNode = {
		id: symbolId("util.ts", "helper", 1),
		kind: "function", name: "helper", file: "util.ts", line: 1, endLine: 3, exported: true,
	};
	const process: GraphNode = {
		id: symbolId("order.ts", "process", 1),
		kind: "function", name: "process", file: "order.ts", line: 1, endLine: 5, exported: true,
	};
	const snapshot = createSnapshot(
		[fileNode("util.ts"), fileNode("order.ts"), helper, process],
		[{ from: process.id, to: helper.id, kind: "calls", confidence: "inferred" }],
		0,
	);
	const result = impact(snapshot, { symbols: [helper.id] });
	assert.equal(result.affectedFiles.get("order.ts"), 1);
});

test("impact: ambiguous edges excluded by default, surfaced as possiblyAffected", () => {
	const snapshot = createSnapshot(
		[fileNode("a.ts"), fileNode("z.ts"), fileNode("seed.ts")],
		[
			imports("a.ts", "seed.ts"),
			{ from: fileId("z.ts"), to: fileId("seed.ts"), kind: "calls", confidence: "ambiguous" },
		],
		0,
	);
	const strict = impact(snapshot, { files: ["seed.ts"] });
	assert.equal(strict.affectedFiles.has("z.ts"), false);
	assert.deepEqual(strict.possiblyAffected, ["z.ts"]);

	const loose = impact(snapshot, { files: ["seed.ts"] }, { includeAmbiguous: true });
	assert.equal(loose.affectedFiles.get("z.ts"), 1);
	assert.deepEqual(loose.possiblyAffected, []);
});

test("impact: affected tests collected from tests edges and affected test files", () => {
	const snapshot = createSnapshot(
		[fileNode("core.ts"), fileNode("api.ts"), fileNode("core.test.ts", true), fileNode("api.test.ts", true)],
		[
			imports("api.ts", "core.ts"),
			{ from: fileId("core.test.ts"), to: fileId("core.ts"), kind: "tests", confidence: "extracted" },
			imports("core.test.ts", "core.ts"),
			{ from: fileId("api.test.ts"), to: fileId("api.ts"), kind: "tests", confidence: "extracted" },
			imports("api.test.ts", "api.ts"),
		],
		0,
	);
	const result = impact(snapshot, { files: ["core.ts"] });
	assert.deepEqual(result.affectedTests.sort(), ["api.test.ts", "core.test.ts"]);
});

test("clusterFiles: two densely connected groups with one weak link split into two clusters", () => {
	const nodes = ["a/one.ts", "a/two.ts", "a/three.ts", "b/one.ts", "b/two.ts", "b/three.ts"].map((f) => fileNode(f));
	const edges = [
		imports("a/one.ts", "a/two.ts"), imports("a/two.ts", "a/three.ts"), imports("a/three.ts", "a/one.ts"),
		imports("b/one.ts", "b/two.ts"), imports("b/two.ts", "b/three.ts"), imports("b/three.ts", "b/one.ts"),
		imports("a/one.ts", "b/one.ts"),
	];
	const snapshot = createSnapshot(nodes, edges, 0);
	const clusters = clusterFiles(snapshot);
	assert.equal(clusters.length, 2);
	const groups = clusters.map((c) => c.files.slice().sort());
	assert.ok(groups.some((g) => g.every((f) => f.startsWith("a/"))));
	assert.ok(groups.some((g) => g.every((f) => f.startsWith("b/"))));
	// deterministic: same input, same output
	assert.deepEqual(clusterFiles(snapshot), clusters);
});

test("entryPoints: zero fan-in plus name heuristics, tests excluded", () => {
	const snapshot = createSnapshot(
		[fileNode("src/cli.ts"), fileNode("src/lib.ts"), fileNode("src/lib.test.ts", true), fileNode("src/orphan.ts")],
		[imports("src/cli.ts", "src/lib.ts"), imports("src/lib.test.ts", "src/lib.ts")],
		0,
	);
	const entries = entryPoints(snapshot);
	const paths = entries.map((e) => e.file);
	assert.ok(paths.includes("src/cli.ts"));
	assert.ok(paths.includes("src/orphan.ts"));
	assert.ok(!paths.includes("src/lib.test.ts"));
	assert.ok(!paths.includes("src/lib.ts"));
	assert.match(entries.find((e) => e.file === "src/cli.ts")!.reason, /cli/i);
});

test("topFanIn ranks files by importer count", () => {
	const snapshot = createSnapshot(
		[fileNode("hub.ts"), fileNode("a.ts"), fileNode("b.ts")],
		[imports("a.ts", "hub.ts"), imports("b.ts", "hub.ts"), imports("a.ts", "b.ts")],
		0,
	);
	const top = topFanIn(snapshot, 2);
	assert.equal(top[0].file, "hub.ts");
	assert.equal(top[0].count, 2);
});
