import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodepatrolError } from "./errors.js";
import { withWorkspaceLock } from "./lock.js";
import { resolveInside, resolveWorkspace } from "./workspace.js";

test("workspace resolution follows explicit, environment, then cwd", () => {
	const first = mkdtempSync(join(tmpdir(), "codepatrol-first-"));
	const second = mkdtempSync(join(tmpdir(), "codepatrol-second-"));
	try {
		assert.equal(resolveWorkspace(first, { CODEPATROL_WORKSPACE: second }, second), realpathSync(first));
		assert.equal(resolveWorkspace(undefined, { CODEPATROL_WORKSPACE: first }, second), realpathSync(first));
		assert.equal(resolveWorkspace(undefined, {}, second), realpathSync(second));
	} finally { rmSync(first, { recursive: true, force: true }); rmSync(second, { recursive: true, force: true }); }
});

test("resolveInside rejects traversal and symlinks outside the workspace", () => {
	const root = mkdtempSync(join(tmpdir(), "codepatrol-root-"));
	const outside = mkdtempSync(join(tmpdir(), "codepatrol-outside-"));
	try {
		assert.throws(() => resolveInside(root, "../outside"), (error: unknown) => error instanceof CodepatrolError);
		symlinkSync(outside, join(root, "escape"));
		assert.throws(() => resolveInside(root, "escape/file.ts"), (error: unknown) => error instanceof CodepatrolError);
	} finally { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});

test("workspace lock times out with an actionable error", async () => {
	const root = mkdtempSync(join(tmpdir(), "codepatrol-lock-"));
	try {
		await withWorkspaceLock(root, "test", "outer", async () => {
			await assert.rejects(
				withWorkspaceLock(root, "test", "inner", async () => undefined, { timeoutMs: 20 }),
				(error: unknown) => error instanceof CodepatrolError && error.code === "LOCK_TIMEOUT" && /outer/.test(error.message),
			);
		});
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("workspace lock honors cancellation while waiting", async () => {
	const root = mkdtempSync(join(tmpdir(), "codepatrol-lock-cancel-"));
	try {
		await withWorkspaceLock(root, "test", "outer", async () => {
			const controller = new AbortController();
			const waiting = withWorkspaceLock(root, "test", "inner", async () => undefined, {
				timeoutMs: 2_000,
				signal: controller.signal,
			});
			controller.abort();
			await assert.rejects(
				waiting,
				(error: unknown) => error instanceof CodepatrolError && error.code === "CANCELLED" && error.exitCode === 130,
			);
		});
	} finally { rmSync(root, { recursive: true, force: true }); }
});
