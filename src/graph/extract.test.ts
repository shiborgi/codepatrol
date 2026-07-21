import { test } from "node:test";
import assert from "node:assert/strict";
import { extractSource } from "./extract.js";

const TS_FIXTURE = `import { helper } from "./util";
import fs from "node:fs";

export function top() {
	helper();
}

function hidden() {
	fs.readFileSync("x");
}

export class Order extends Base implements Sortable {
	process() {
		top();
	}
}

export interface Sortable {}
export type Id = string;
export const compute = (x: number) => hidden();
const SECRET = 1;
`;

test("typescript: symbols with kind, line span, and exported flag", async () => {
	const out = await extractSource(TS_FIXTURE, "typescript");
	const byName = new Map(out.symbols.map((s) => [s.name, s]));

	assert.equal(byName.get("top")?.kind, "function");
	assert.equal(byName.get("top")?.exported, true);
	assert.equal(byName.get("hidden")?.exported, false);
	assert.equal(byName.get("Order")?.kind, "class");
	assert.equal(byName.get("process")?.kind, "method");
	assert.equal(byName.get("Sortable")?.kind, "interface");
	assert.equal(byName.get("Id")?.kind, "type");
	assert.equal(byName.get("compute")?.kind, "function");
	assert.equal(byName.get("compute")?.exported, true);
	assert.equal(byName.get("SECRET")?.kind, "const");
	assert.equal(byName.get("SECRET")?.exported, false);

	const order = byName.get("Order")!;
	assert.equal(order.line, 12);
	assert.ok(order.endLine >= 16);
	assert.equal(out.lineCount, TS_FIXTURE.split("\n").length);
});

test("typescript: imports keep their raw specifiers", async () => {
	const out = await extractSource(TS_FIXTURE, "typescript");
	const specs = out.imports.map((i) => i.specifier).sort();
	assert.deepEqual(specs, ["./util", "node:fs"]);
});

test("typescript: calls carry their enclosing symbol", async () => {
	const out = await extractSource(TS_FIXTURE, "typescript");
	const caller = (callee: string) => {
		const call = out.calls.find((c) => c.callee === callee);
		return call && call.callerIndex !== null ? out.symbols[call.callerIndex].name : undefined;
	};
	assert.equal(caller("helper"), "top");
	assert.equal(caller("readFileSync"), "hidden");
	assert.equal(caller("top"), "process");
	assert.equal(caller("hidden"), "compute");
});

test("typescript: inheritance edges from extends and implements", async () => {
	const out = await extractSource(TS_FIXTURE, "typescript");
	const pairs = out.inherits.map((h) => `${out.symbols[h.symbolIndex].name}->${h.parent}`).sort();
	assert.deepEqual(pairs, ["Order->Base", "Order->Sortable"]);
});

test("python: defs, dotted imports, and dunder-privacy export rule", async () => {
	const out = await extractSource(
		`import os.path
from .sibling import thing

def _private():
    pass

def public():
    _private()

class Order(Base):
    def process(self):
        public()

LIMIT = 10
`,
		"python",
	);
	const byName = new Map(out.symbols.map((s) => [s.name, s]));
	assert.equal(byName.get("_private")?.exported, false);
	assert.equal(byName.get("public")?.exported, true);
	assert.equal(byName.get("Order")?.kind, "class");
	assert.equal(byName.get("LIMIT")?.kind, "const");
	assert.ok(out.imports.some((i) => i.specifier === "os.path"));
	assert.ok(out.imports.some((i) => i.specifier.startsWith(".")));
	const inh = out.inherits.map((h) => `${out.symbols[h.symbolIndex].name}->${h.parent}`);
	assert.deepEqual(inh, ["Order->Base"]);
	const call = out.calls.find((c) => c.callee === "public");
	assert.equal(call && call.callerIndex !== null ? out.symbols[call.callerIndex].name : "", "process");
});

test("go: uppercase names are exported, imports lose their quotes", async () => {
	const out = await extractSource(
		`package main

import "fmt"

func Public() {
	fmt.Println("x")
}

func private() {}
`,
		"go",
	);
	const byName = new Map(out.symbols.map((s) => [s.name, s]));
	assert.equal(byName.get("Public")?.exported, true);
	assert.equal(byName.get("private")?.exported, false);
	assert.deepEqual(out.imports.map((i) => i.specifier), ["fmt"]);
	assert.ok(out.calls.some((c) => c.callee === "Println"));
});

test("java: public modifier drives exported, superclass captured", async () => {
	const out = await extractSource(
		`import java.util.List;

public class Order extends Base {
	public void process() {
		helper();
	}
	void internal() {}
}
`,
		"java",
	);
	const byName = new Map(out.symbols.map((s) => [s.name, s]));
	assert.equal(byName.get("Order")?.exported, true);
	assert.equal(byName.get("process")?.kind, "method");
	assert.equal(byName.get("internal")?.exported, false);
	assert.deepEqual(out.imports.map((i) => i.specifier), ["java.util.List"]);
	const inh = out.inherits.map((h) => `${out.symbols[h.symbolIndex].name}->${h.parent}`);
	assert.deepEqual(inh, ["Order->Base"]);
});

test("rust: pub visibility drives exported", async () => {
	const out = await extractSource(
		`use crate::util::helper;

pub fn public_fn() {
    helper();
}

fn private_fn() {}

pub struct Order {}
`,
		"rust",
	);
	const byName = new Map(out.symbols.map((s) => [s.name, s]));
	assert.equal(byName.get("public_fn")?.exported, true);
	assert.equal(byName.get("private_fn")?.exported, false);
	assert.equal(byName.get("Order")?.kind, "class");
	assert.ok(out.imports.length >= 1);
	assert.ok(out.calls.some((c) => c.callee === "helper"));
});

test("degrades to an empty extract instead of throwing on broken input", async () => {
	const out = await extractSource("this is (((( not remotely parseable {{{{", "typescript");
	// tree-sitter always produces a tree (with ERROR nodes); the contract is: no throw, arrays present
	assert.ok(Array.isArray(out.symbols));
	assert.ok(Array.isArray(out.imports));
	assert.ok(Array.isArray(out.calls));
	assert.ok(Array.isArray(out.inherits));
});
