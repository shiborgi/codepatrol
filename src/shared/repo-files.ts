/**
 * Repo file enumeration shared by the graph and wiki core: which files
 * count as source, which directories are vendor noise, what makes a file a
 * test, and the content hash used for incremental sync.
 *
 * Enumeration prefers `git ls-files` (respects .gitignore, includes untracked
 * files) and falls back to a bounded walk for non-git directories.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, join } from "node:path";
import { isAbsolute, relative } from "node:path";

export const SOURCE_EXTENSIONS = new Set([
	".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs",
	".py", ".go", ".java", ".rs",
]);

export const SKIP_DIRS = new Set([
	"node_modules", ".git", ".pi", ".codepatrol", ".hg", ".svn",
	"dist", "build", "out", "coverage", "vendor", "target",
	"__pycache__", ".venv", "venv", ".next", ".turbo", ".cache",
]);

const MAX_FILES = 20_000;

function extensionOf(path: string): string {
	const base = basename(path);
	const dot = base.lastIndexOf(".");
	return dot === -1 ? "" : base.slice(dot).toLowerCase();
}

export function isSourceFile(path: string): boolean {
	return SOURCE_EXTENSIONS.has(extensionOf(path));
}

function inSkippedDir(path: string): boolean {
	return path.split("/").some((segment) => SKIP_DIRS.has(segment));
}

/** Repo-relative source files under `root`, using / separators. */
export function listFiles(root: string): string[] {
	const fromGit = listGitFiles(root);
	if (fromGit) return fromGit.filter((f) => isSourceFile(f) && !inSkippedDir(f) && isSafeFile(root, f));
	return walk(root);
}

function isSafeFile(root: string, path: string): boolean {
	try {
		const canonicalRoot = realpathSync(root);
		const canonicalFile = realpathSync(join(canonicalRoot, path));
		const rel = relative(canonicalRoot, canonicalFile);
		return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
	} catch {
		return false;
	}
}

function listGitFiles(root: string): string[] | null {
	try {
		const stdout = execFileSync(
			"git",
			["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
			{ cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
		);
		return stdout.split("\0").filter(Boolean);
	} catch {
		return null; // not a git repo, or git unavailable
	}
}

function walk(root: string): string[] {
	const files: string[] = [];
	const stack: string[] = [""];
	while (stack.length > 0 && files.length < MAX_FILES) {
		const rel = stack.pop()!;
		let entries;
		try {
			entries = readdirSync(join(root, rel), { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const childRel = rel ? `${rel}/${entry.name}` : entry.name;
			if (entry.isDirectory()) {
				if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) stack.push(childRel);
			} else if (entry.isFile() && isSourceFile(childRel)) {
				files.push(childRel);
			}
		}
	}
	return files;
}

const TEST_PATH_SEGMENTS = /(^|\/)(__tests__|tests?)\//;

export function isTestFile(path: string): boolean {
	const base = basename(path);
	if (/\.(test|spec)\.[^.]+$/.test(base)) return true;
	if (/^test_.*\.py$/.test(base)) return true;
	if (/_test\.(go|py|rs|java)$/.test(base)) return true;
	return TEST_PATH_SEGMENTS.test(path);
}

export function hashContent(content: string): string {
	return createHash("sha1").update(content).digest("hex");
}

export function hashFile(path: string): string {
	return hashContent(readFileSync(path, "utf8"));
}
