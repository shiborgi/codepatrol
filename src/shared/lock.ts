import { randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { CodepatrolError } from "./errors.js";
import { lockPath } from "./state.js";

interface LockRecord {
	token: string;
	pid: number;
	host: string;
	command: string;
	createdAt: string;
}

function processExists(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code !== "ESRCH";
	}
}

function readRecord(path: string): LockRecord | undefined {
	try { return JSON.parse(readFileSync(path, "utf8")) as LockRecord; } catch { return undefined; }
}

/**
 * Narrow filesystem interface used by {@link acquireLock}. The default
 * implementation delegates to the standard library; tests may inject a
 * stub that fails at a specific step.
 */
export interface LockIo {
	openNew: (path: string) => number;
	writeRecord: (descriptor: number, record: LockRecord) => void;
	close: (descriptor: number) => void;
	unlink: (path: string) => void;
}

const defaultLockIo: LockIo = {
	openNew: (path) => openSync(path, "wx", 0o600),
	writeRecord: (descriptor, record) => writeFileSync(descriptor, JSON.stringify(record), "utf8"),
	close: (descriptor) => closeSync(descriptor),
	unlink: (path) => unlinkSync(path),
};

/**
 * Attempt to acquire the workspace lock. Throws on EEXIST until the timeout
 * elapses, on cancellation, or on any non-EEXIST failure (which is cleaned
 * up so the current attempt never leaves an orphan lock behind). The
 * exported seam is internal: {@link withWorkspaceLock} is the supported
 * public entry point and forwards the default {@link LockIo}.
 */
export async function acquireLock(
	path: string,
	token: string,
	command: string,
	options: { timeoutMs?: number; signal?: AbortSignal; io?: LockIo } = {},
): Promise<void> {
	const io = options.io ?? defaultLockIo;
	const timeoutMs = options.timeoutMs ?? 10_000;
	const deadline = Date.now() + timeoutMs;
	let acquired = false;

	while (!acquired) {
		if (options.signal?.aborted) throw new CodepatrolError("CANCELLED", "Operation cancelled.", 130, true);
		let descriptor: number | undefined;
		try {
			descriptor = io.openNew(path);
			try {
				io.writeRecord(descriptor, { token, pid: process.pid, host: hostname(), command, createdAt: new Date().toISOString() });
			} finally {
				io.close(descriptor);
			}
			acquired = true;
		} catch (error) {
			if (descriptor !== undefined) {
				try { io.close(descriptor); } catch { /* best effort */ }
			}
			const code = (error as NodeJS.ErrnoException).code;
			if (code !== "EEXIST") {
				try { io.unlink(path); } catch { /* best effort: do not remove a lock owned by another process */ }
				throw error;
			}
			const owner = readRecord(path);
			if (owner?.host === hostname() && !processExists(owner.pid)) {
				try { io.unlink(path); } catch { /* another process won the race */ }
				continue;
			}
			if (Date.now() >= deadline) {
				const ownerText = owner ? `pid ${owner.pid} (${owner.command}, since ${owner.createdAt})` : "an unreadable lock";
				throw new CodepatrolError("LOCK_TIMEOUT", `Timed out waiting for lock held by ${ownerText}.`, 5, true);
			}
			await delay(50, undefined, { signal: options.signal }).catch(() => {
				throw new CodepatrolError("CANCELLED", "Operation cancelled.", 130, true);
			});
		}
	}
}

export async function withWorkspaceLock<T>(
	workspace: string,
	name: string,
	command: string,
	fn: () => Promise<T> | T,
	options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<T> {
	const path = lockPath(workspace, name);
	mkdirSync(dirname(path), { recursive: true });
	const token = randomUUID();
	await acquireLock(path, token, command, options);

	try {
		return await fn();
	} finally {
		const current = readRecord(path);
		if (current?.token === token) {
			try { unlinkSync(path); } catch { /* best effort */ }
		}
	}
}
