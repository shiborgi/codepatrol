import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type TraceEntry =
	| { kind: "command"; at: string; command: string; args: Record<string, unknown> }
	| { kind: "event"; at: string; stage: string; attempt: number; type: string }
	| { kind: "error"; at: string; command: string; code: string; message: string };

const SECRET_KEYS = new Set(["apikey", "api_key", "authorization", "token", "password", "secret"]);
const MAX_TRACE_BYTES = 10 * 1024 * 1024;

export function path(workspace: string, workId: string): string {
	return join(workspace, ".codepatrol", "runtime", "traces", `${workId}.jsonl`);
}

function ensureDir(workspace: string, workId: string): void {
	mkdirSync(dirname(path(workspace, workId)), { recursive: true });
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function redact(input: unknown): unknown {
	if (Array.isArray(input)) return input.map(redact);
	if (!isRecord(input)) return input;
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(input)) {
		if (SECRET_KEYS.has(key.toLowerCase())) {
			out[key] = "[REDACTED]";
		} else if (key.toLowerCase() === "headers" && isRecord(value)) {
			const headers: Record<string, unknown> = {};
			for (const [h, v] of Object.entries(value)) headers[h] = SECRET_KEYS.has(h.toLowerCase()) ? "[REDACTED]" : v;
			out[key] = headers;
		} else {
			out[key] = redact(value);
		}
	}
	return out;
}

function redactedEntry(entry: TraceEntry): TraceEntry {
	if (entry.kind === "command") return { ...entry, args: (redact(entry.args) as Record<string, unknown>) };
	return entry;
}

export function open(workspace: string, workId: string): void {
	ensureDir(workspace, workId);
	const p = path(workspace, workId);
	if (!existsSync(p)) writeFileSync(p, "", "utf8");
}

export function append(workspace: string, workId: string, entry: TraceEntry): void {
	try {
		ensureDir(workspace, workId);
		const p = path(workspace, workId);
		const line = `${JSON.stringify(redactedEntry(entry))}\n`;
		if (existsSync(p)) {
			const size = readFileSync(p, "utf8").length;
			if (size + line.length > MAX_TRACE_BYTES) {
				const rotated = `${p}.1`;
				if (existsSync(rotated)) rmSync(rotated);
				renameSync(p, rotated);
			}
		}
		appendFileSync(p, line, "utf8");
	} catch (error) {
		process.stderr.write(`[trace] append failed: ${(error as Error).message}\n`);
	}
}

export function appendRaw(workspace: string, workId: string, rawLine: string): void {
	try {
		ensureDir(workspace, workId);
		appendFileSync(path(workspace, workId), `${rawLine}\n`, "utf8");
	} catch (error) {
		process.stderr.write(`[trace] appendRaw failed: ${(error as Error).message}\n`);
	}
}

export function read(workspace: string, workId: string): TraceEntry[] {
	const p = path(workspace, workId);
	if (!existsSync(p)) return [];
	const out: TraceEntry[] = [];
	for (const line of readFileSync(p, "utf8").split("\n")) {
		if (!line.trim()) continue;
		try {
			out.push(JSON.parse(line) as TraceEntry);
		} catch (error) {
			process.stderr.write(`[trace] skipping malformed line: ${(error as Error).message}\n`);
		}
	}
	return out;
}

export function close(workspace: string, workId: string): void {
	const p = path(workspace, workId);
	try { unlinkSync(p); } catch { /* missing file is fine */ }
	const rotated = `${p}.1`;
	try { unlinkSync(rotated); } catch { /* missing file is fine */ }
	for (const dir of [dirname(p), dirname(dirname(p)), dirname(dirname(dirname(p)))]) {
		try { if (readdirSync(dir).length === 0) rmdirSync(dir); else break; } catch { break; }
	}
}
