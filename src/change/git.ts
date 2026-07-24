import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { realpathSync } from "node:fs";
import { CodepatrolError } from "../shared/errors.js";

const execute = promisify(execFile);
export interface GitAdapter {
	assertTrusted(signal?: AbortSignal): Promise<void>;
	status(signal?: AbortSignal): Promise<string>;
	currentBranch(signal?: AbortSignal): Promise<string>;
	head(ref?: string, signal?: AbortSignal): Promise<string>;
	tree(ref?: string, signal?: AbortSignal): Promise<string>;
	branchExists(branch: string, signal?: AbortSignal): Promise<boolean>;
	createBranch(branch: string, start: string, signal?: AbortSignal): Promise<void>;
	checkout(ref: string, signal?: AbortSignal): Promise<void>;
	add(paths: string[], signal?: AbortSignal): Promise<void>;
	unstage(paths: string[], signal?: AbortSignal): Promise<void>;
	commit(message: string, allowEmpty?: boolean, signal?: AbortSignal): Promise<string>;
	tag(name: string, ref: string, signal?: AbortSignal): Promise<void>;
	deleteBranch(name: string, expected: string, signal?: AbortSignal): Promise<void>;
	mergeFf(ref: string, signal?: AbortSignal): Promise<void>;
	refs(prefix: string, signal?: AbortSignal): Promise<string[]>;
	show(ref: string, path: string, signal?: AbortSignal): Promise<string | undefined>;
	pathExists(ref: string, path: string, signal?: AbortSignal): Promise<boolean>;
	readFile(ref: string, path: string, signal?: AbortSignal): Promise<Buffer | undefined>;
	files(ref: string, prefix: string, signal?: AbortSignal): Promise<string[]>;
	changedPaths(from: string, to: string, signal?: AbortSignal): Promise<string[]>;
	isAncestor(ancestor: string, descendant: string, signal?: AbortSignal): Promise<boolean>;
	push(remote: string, branch: string, signal?: AbortSignal): Promise<string>;
}

export class NodeGitAdapter implements GitAdapter {
	constructor(readonly workspace: string) {}
	private async run(args: string[], signal?: AbortSignal, allowFailure = false): Promise<string> {
		try {
			const result = await execute("git", args, { cwd: this.workspace, encoding: "utf8", signal, maxBuffer: 8 * 1024 * 1024 });
			return result.stdout.trim();
		} catch (cause) {
			if (signal?.aborted) throw new CodepatrolError("CANCELLED", "Operation cancelled.", 130, true);
			if (allowFailure) return "";
			const error = cause as Error & { stderr?: string };
			throw new CodepatrolError("OPERATION_FAILED", error.stderr?.trim() || error.message, 5, true);
		}
	}
	private runBuffer(args: string[], signal?: AbortSignal, allowFailure = false): Promise<Buffer | undefined> {
		return new Promise((resolve, reject) => {
			execFile("git", args, { cwd: this.workspace, encoding: "buffer", signal, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
				if (!error) { resolve(stdout); return; }
				if (signal?.aborted) { reject(new CodepatrolError("CANCELLED", "Operation cancelled.", 130, true)); return; }
				if (allowFailure) { resolve(undefined); return; }
				reject(new CodepatrolError("OPERATION_FAILED", stderr.toString().trim() || error.message, 5, true));
			});
		});
	}
	async assertTrusted(signal?: AbortSignal): Promise<void> {
		const root = await this.run(["rev-parse", "--show-toplevel"], signal, true);
		if (!root || realpathSync(root) !== realpathSync(this.workspace)) throw new CodepatrolError("INVALID_WORKSPACE", "Git repository root must equal the Codepatrol workspace.", 3);
	}
	async status(signal?: AbortSignal): Promise<string> {
		try {
			const result = await execute("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: this.workspace, encoding: "utf8", signal, maxBuffer: 8 * 1024 * 1024 });
			return result.stdout;
		} catch (cause) {
			if (signal?.aborted) throw new CodepatrolError("CANCELLED", "Operation cancelled.", 130, true);
			if ((cause as { code?: string }).code === "ENOENT") return "";
			throw new CodepatrolError("OPERATION_FAILED", (cause as Error).message, 5, true);
		}
	}
	currentBranch(signal?: AbortSignal): Promise<string> { return this.run(["symbolic-ref", "--quiet", "--short", "HEAD"], signal); }
	head(ref = "HEAD", signal?: AbortSignal): Promise<string> { return this.run(["rev-parse", "--verify", `${ref}^{commit}`], signal); }
	tree(ref = "HEAD", signal?: AbortSignal): Promise<string> { return this.run(["rev-parse", "--verify", `${ref}^{tree}`], signal); }
	async branchExists(branch: string, signal?: AbortSignal): Promise<boolean> { return Boolean(await this.run(["show-ref", "--verify", `refs/heads/${branch}`], signal, true)); }
	async createBranch(branch: string, start: string, signal?: AbortSignal): Promise<void> { await this.run(["checkout", "-b", branch, start], signal); }
	async checkout(ref: string, signal?: AbortSignal): Promise<void> { await this.run(["checkout", ref], signal); }
	async add(paths: string[], signal?: AbortSignal): Promise<void> { if (paths.length) await this.run(["add", "--", ...paths], signal); }
	async unstage(paths: string[], signal?: AbortSignal): Promise<void> { if (paths.length) await this.run(["rm", "--cached", "--ignore-unmatch", "--", ...paths], signal); }
	async commit(message: string, allowEmpty = false, signal?: AbortSignal): Promise<string> {
		await this.run(["-c", "user.name=Codepatrol", "-c", "user.email=codepatrol@local", "commit", ...(allowEmpty ? ["--allow-empty"] : []), "-m", message], signal);
		return this.head("HEAD", signal);
	}
	async tag(name: string, ref: string, signal?: AbortSignal): Promise<void> { await this.run(["tag", name, ref], signal); }
	async deleteBranch(name: string, expected: string, signal?: AbortSignal): Promise<void> { await this.run(["update-ref", "-d", `refs/heads/${name}`, expected], signal); }
	async mergeFf(ref: string, signal?: AbortSignal): Promise<void> { await this.run(["merge", "--ff-only", ref], signal); }
	async refs(prefix: string, signal?: AbortSignal): Promise<string[]> {
		const output = await this.run(["for-each-ref", "--format=%(refname:short)", prefix], signal);
		return output ? output.split("\n").filter(Boolean).sort() : [];
	}
	async show(ref: string, path: string, signal?: AbortSignal): Promise<string | undefined> {
		const value = await this.run(["show", `${ref}:${path}`], signal, true); return value || undefined;
	}
	async pathExists(ref: string, path: string, signal?: AbortSignal): Promise<boolean> { return Boolean(await this.run(["ls-tree", ref, "--", path], signal, true)); }
	async readFile(ref: string, path: string, signal?: AbortSignal): Promise<Buffer | undefined> {
		const entry = await this.run(["ls-tree", ref, "--", path], signal, true); const mode = entry.split(/\s+/, 1)[0];
		if (mode !== "100644" && mode !== "100755") return undefined;
		return this.runBuffer(["show", `${ref}:${path}`], signal, true);
	}
	async files(ref: string, prefix: string, signal?: AbortSignal): Promise<string[]> {
		const output = await this.runBuffer(["ls-tree", "-r", "--name-only", "-z", ref, "--", prefix], signal); return output ? output.toString("utf8").split("\0").filter(Boolean).sort() : [];
	}
	async changedPaths(from: string, to: string, signal?: AbortSignal): Promise<string[]> {
		const output = await this.runBuffer(["diff", "--name-only", "-z", from, to, "--"], signal); return output ? output.toString("utf8").split("\0").filter(Boolean).sort() : [];
	}
	async isAncestor(ancestor: string, descendant: string, signal?: AbortSignal): Promise<boolean> {
		const expected = await this.head(ancestor, signal); return await this.run(["merge-base", ancestor, descendant], signal, true) === expected;
	}
	async push(remote: string, branch: string, signal?: AbortSignal): Promise<string> {
		try { return await this.run(["push", remote, branch], signal); }
		catch (cause) {
			const error = cause as Error & { stderr?: string };
			throw new CodepatrolError("PUSH_FAILED", error.stderr?.trim() || error.message, 5, true);
		}
	}
}
