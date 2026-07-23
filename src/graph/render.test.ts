import { test } from "node:test";
import assert from "node:assert/strict";
import { formatTable, mermaidModuleMap } from "./render.js";

test("formatTable emits an aligned markdown table", () => {
	const table = formatTable(["file", "fan-in"], [["src/a.ts", "3"], ["b.ts", "12"]]);
	const lines = table.split("\n");
	assert.match(lines[0], /^\| file\s+\| fan-in\s+\|$/);
	assert.match(lines[1], /^\|[-\s|]+\|$/);
	assert.equal(lines.length, 4);
});

test("mermaidModuleMap renders one subgraph per cluster and inter-cluster arrows", () => {
	const map = mermaidModuleMap(
		[
			{ id: 0, label: "a", files: ["a/one.ts", "a/two.ts"] },
			{ id: 1, label: "b", files: ["b/one.ts"] },
		],
		[{ from: 0, to: 1, count: 3 }],
	);
	assert.match(map, /flowchart (LR|TD)/);
	assert.match(map, /subgraph .*a/);
	assert.match(map, /subgraph .*b/);
	assert.match(map, /c0 -->\|3\| c1|c0 -->.*c1/);
	assert.match(map, /```mermaid/);
});

test("mermaidModuleMap caps the node budget", () => {
	const clusters = Array.from({ length: 30 }, (_, i) => ({ id: i, label: `mod${i}`, files: [`m${i}/x.ts`] }));
	const map = mermaidModuleMap(clusters, []);
	const subgraphs = map.match(/subgraph/g) ?? [];
	assert.ok(subgraphs.length <= 12);
});
