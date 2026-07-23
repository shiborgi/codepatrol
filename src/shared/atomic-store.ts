import { randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync, renameSync, unlinkSync, writeFileSync, fsyncSync } from "node:fs";
import { dirname, join } from "node:path";

export function atomicWriteFile(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true });
	const temporary = join(dirname(path), `.${path.split(/[\\/]/).pop()}.${process.pid}.${randomUUID()}.tmp`);
	let descriptor: number | undefined;
	try {
		descriptor = openSync(temporary, "wx", 0o600);
		writeFileSync(descriptor, content, "utf8");
		fsyncSync(descriptor);
		closeSync(descriptor);
		descriptor = undefined;
		renameSync(temporary, path);
	} catch (error) {
		if (descriptor !== undefined) closeSync(descriptor);
		try { unlinkSync(temporary); } catch { /* best effort */ }
		throw error;
	}
}

export function atomicWriteJson(path: string, value: unknown): void {
	atomicWriteFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
