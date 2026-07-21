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
	const timeoutMs = options.timeoutMs ?? 10_000;
	const deadline = Date.now() + timeoutMs;
	let acquired = false;

	while (!acquired) {
		if (options.signal?.aborted) throw new CodepatrolError("CANCELLED", "Operation cancelled.", 130, true);
		let descriptor: number | undefined;
		try {
			descriptor = openSync(path, "wx", 0o600);
			const record: LockRecord = { token, pid: process.pid, host: hostname(), command, createdAt: new Date().toISOString() };
			writeFileSync(descriptor, JSON.stringify(record), "utf8");
			closeSync(descriptor);
			acquired = true;
		} catch (error) {
			if (descriptor !== undefined) closeSync(descriptor);
			const code = (error as NodeJS.ErrnoException).code;
			if (code !== "EEXIST") throw error;
			const owner = readRecord(path);
			if (owner?.host === hostname() && !processExists(owner.pid)) {
				try { unlinkSync(path); } catch { /* another process won the race */ }
				continue;
			}
			if (Date.now() >= deadline) {
				const ownerText = owner ? `pid ${owner.pid} (${owner.command}, since ${owner.createdAt})` : "an unreadable lock";
				throw new CodepatrolError("LOCK_TIMEOUT", `Timed out waiting for ${name} lock held by ${ownerText}.`, 5, true);
			}
			await delay(50, undefined, { signal: options.signal }).catch(() => {
				throw new CodepatrolError("CANCELLED", "Operation cancelled.", 130, true);
			});
		}
	}

	try {
		return await fn();
	} finally {
		const current = readRecord(path);
		if (current?.token === token) {
			try { unlinkSync(path); } catch { /* best effort */ }
		}
	}
}
