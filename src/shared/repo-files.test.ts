import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { listFiles, isTestFile, hashFile, hashContent } from "./repo-files.js";

function scratchRepo(): string {
	const root = mkdtempSync(join(tmpdir(), "pi-arch-repo-"));
	writeFileSync(join(root, "a.ts"), "export const a = 1;\n");
	mkdirSync(join(root, "src"));
	writeFileSync(join(root, "src", "b.py"), "def b():\n    pass\n");
	writeFileSync(join(root, "src", "b.test.ts"), "import {} from './b';\n");
	mkdirSync(join(root, "node_modules", "dep"), { recursive: true });
	writeFileSync(join(root, "node_modules", "dep", "index.js"), "module.exports = 1;\n");
	mkdirSync(join(root, ".pi"));
	writeFileSync(join(root, ".pi", "state.json"), "{}\n");
	writeFileSync(join(root, "image.png"), "not really a png");
	return root;
}

test("listFiles walks the tree, skipping vendor dirs and non-source files", () => {
	const root = scratchRepo();
	try {
		const files = listFiles(root).sort();
		assert.deepEqual(files, ["a.ts", "src/b.py", "src/b.test.ts"]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("listFiles prefers git ls-files when the repo is git-tracked", () => {
	const root = scratchRepo();
	try {
		execSync("git init -q && git add a.ts src/b.py", { cwd: root });
		// b.test.ts is untracked; git mode should still include untracked non-ignored files
		const files = listFiles(root).sort();
		assert.ok(files.includes("a.ts"));
		assert.ok(files.includes("src/b.py"));
		assert.ok(files.includes("src/b.test.ts"));
		assert.ok(!files.some((f) => f.startsWith("node_modules/")));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("listFiles excludes tracked source symlinks that escape the workspace", () => {
	const root = scratchRepo();
	const outside = mkdtempSync(join(tmpdir(), "codepatrol-repo-outside-"));
	try {
		writeFileSync(join(outside, "secret.ts"), "export const secret = true;\n");
		symlinkSync(join(outside, "secret.ts"), join(root, "escaped.ts"));
		execSync("git init -q && git add escaped.ts", { cwd: root });
		assert.equal(listFiles(root).includes("escaped.ts"), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
		rmSync(outside, { recursive: true, force: true });
	}
});

test("isTestFile recognizes common test naming conventions", () => {
	assert.equal(isTestFile("src/b.test.ts"), true);
	assert.equal(isTestFile("src/b.spec.tsx"), true);
	assert.equal(isTestFile("tests/test_thing.py"), true);
	assert.equal(isTestFile("pkg/thing_test.go"), true);
	assert.equal(isTestFile("src/__tests__/b.ts"), true);
	assert.equal(isTestFile("src/main.ts"), false);
	assert.equal(isTestFile("src/latest.ts"), false);
	assert.equal(isTestFile("src/contest.py"), false);
});

test("hashFile matches hashContent and is stable", () => {
	const root = mkdtempSync(join(tmpdir(), "pi-arch-hash-"));
	try {
		const file = join(root, "x.ts");
		writeFileSync(file, "const x = 1;\n");
		assert.equal(hashFile(file), hashContent("const x = 1;\n"));
		assert.notEqual(hashContent("a"), hashContent("b"));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
