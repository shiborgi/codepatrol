import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodepatrolError } from "./errors.js";
import { acquireLock, type LockIo, withWorkspaceLock } from "./lock.js";
import { resolveInside, resolveWorkspace } from "./workspace.js";
import { lockPath } from "./state.js";

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

test("acquireLock removes the orphan lock when writeRecord fails after openNew", async () => {
	const root = mkdtempSync(join(tmpdir(), "codepatrol-lock-orphan-"));
	try {
		const path = lockPath(root, "acquire");
		mkdirSync(join(root, ".codepatrol", "runtime", "locks"), { recursive: true });
		let unlinkCalls = 0;
		const failingIo: LockIo = {
			openNew: (target) => openSync(target, "wx", 0o600),
			writeRecord: () => { throw new Error("forced post-open failure"); },
			close: () => undefined,
			unlink: (target) => { unlinkCalls += 1; rmSync(target, { force: true }); },
		};
		await assert.rejects(
			acquireLock(path, "orphan-token", "test.acquire", { io: failingIo, timeoutMs: 100 }),
			(error: unknown) => error instanceof Error && /forced post-open failure/.test(error.message),
		);
		assert.equal(existsSync(path), false, "acquireLock must not leave the lock file behind on a post-open failure");
		assert.equal(unlinkCalls, 1, "cleanup must unlink the current attempt's lock path");
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("acquireLock never unlinks a lock owned by another attempt", async () => {
	const root = mkdtempSync(join(tmpdir(), "codepatrol-lock-foreign-"));
	try {
		const path = lockPath(root, "foreign");
		mkdirSync(join(root, ".codepatrol", "runtime", "locks"), { recursive: true });
		const otherToken = "other-attempt-token";
		const otherRecord = { token: otherToken, pid: 9_999_999, host: "foreign-host", command: "foreign.command", createdAt: "2026-01-01T00:00:00.000Z" };
		writeFileSync(path, JSON.stringify(otherRecord), "utf8");
		let unlinkCalls = 0;
		const observabilityIo: LockIo = {
			openNew: () => {
				const error = new Error("synthetic EEXIST") as Error & { code: string };
				error.code = "EEXIST";
				throw error;
			},
			writeRecord: () => { throw new Error("unreachable: lock not created"); },
			close: () => undefined,
			unlink: (target) => {
				unlinkCalls += 1;
				if (existsSync(target)) {
					const record = JSON.parse(readFileSync(target, "utf8")) as { token: string };
					if (record.token === otherToken) throw new Error("acquireLock must not unlink a foreign lock on the timeout path");
					rmSync(target, { force: true });
				}
			},
		};
		await assert.rejects(
			acquireLock(path, "self-token", "test.foreign", { io: observabilityIo, timeoutMs: 20 }),
			(error: unknown) => error instanceof CodepatrolError && error.code === "LOCK_TIMEOUT",
		);
		assert.equal(existsSync(path), true, "a foreign lock must remain on disk after a timeout");
		assert.equal(unlinkCalls, 0, "acquireLock must never call unlink on the timeout path");
		const preserved = JSON.parse(readFileSync(path, "utf8")) as { token: string };
		assert.equal(preserved.token, otherToken);
	} finally { rmSync(root, { recursive: true, force: true }); }
});
