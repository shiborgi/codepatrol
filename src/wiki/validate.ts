import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, extname, isAbsolute, join, posix, relative, resolve } from "node:path";
import { fromMarkdown } from "mdast-util-from-markdown";
import { parse as parseYaml } from "yaml";
import { wikiRoot } from "../shared/state.js";
import type { WikiConcept, WikiIssue, WikiValidation } from "./types.js";

interface FrontmatterResult {
	data?: Record<string, unknown>;
	body: string;
	error?: string;
	hasFrontmatter: boolean;
}

function normalize(path: string): string {
	return path.split("\\").join("/");
}

function markdownFiles(root: string): string[] {
	if (!existsSync(root)) return [];
	const result: string[] = [];
	const stack = [root];
	while (stack.length) {
		const directory = stack.pop()!;
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) stack.push(path);
			else if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") result.push(normalize(relative(root, path)));
		}
	}
	return result.sort();
}

function frontmatter(content: string): FrontmatterResult {
	if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
		return { body: content, hasFrontmatter: false };
	}
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
	if (!match) return { body: content, hasFrontmatter: true, error: "Frontmatter is not closed." };
	try {
		const data = parseYaml(match[1]);
		if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("frontmatter must be a mapping");
		return { data: data as Record<string, unknown>, body: content.slice(match[0].length), hasFrontmatter: true };
	} catch (error) {
		return { body: content.slice(match[0].length), hasFrontmatter: true, error: error instanceof Error ? error.message : String(error) };
	}
}

function visit(node: any, type: string, result: any[]): void {
	if (node?.type === type) result.push(node);
	for (const child of node?.children ?? []) visit(child, type, result);
}

function textOf(node: any): string {
	if (typeof node?.value === "string") return node.value;
	return (node?.children ?? []).map(textOf).join("");
}

function push(list: WikiIssue[], path: string, code: string, message: string, line?: number): void {
	list.push({ path, code, message, ...(line ? { line } : {}) });
}

function validateIndex(path: string, parsed: FrontmatterResult, errors: WikiIssue[]): any {
	if (path === "index.md") {
		if (!parsed.hasFrontmatter || parsed.error || parsed.data?.okf_version !== "0.1") {
			push(errors, path, "INDEX_VERSION", "Root index.md must declare only okf_version: \"0.1\" in YAML frontmatter.");
		} else if (Object.keys(parsed.data).some((key) => key !== "okf_version")) {
			push(errors, path, "INDEX_FRONTMATTER", "Root index.md frontmatter may contain only okf_version.");
		}
	} else if (parsed.hasFrontmatter) {
		push(errors, path, "INDEX_FRONTMATTER", "Only the bundle-root index.md may contain frontmatter.");
	}
	let tree: any;
	try { tree = fromMarkdown(parsed.body); } catch (error) {
		push(errors, path, "MARKDOWN_INVALID", error instanceof Error ? error.message : String(error));
		return undefined;
	}
	const headings: any[] = [];
	const lists: any[] = [];
	visit(tree, "heading", headings);
	visit(tree, "list", lists);
	if (!headings.length || !lists.length) push(errors, path, "INDEX_STRUCTURE", "Index must contain a heading and a Markdown list.");
	return tree;
}

function validateLog(path: string, parsed: FrontmatterResult, errors: WikiIssue[]): any {
	if (parsed.hasFrontmatter) push(errors, path, "LOG_FRONTMATTER", "log.md must not contain frontmatter.");
	let tree: any;
	try { tree = fromMarkdown(parsed.body); } catch (error) {
		push(errors, path, "MARKDOWN_INVALID", error instanceof Error ? error.message : String(error));
		return undefined;
	}
	const headings: any[] = [];
	visit(tree, "heading", headings);
	const dates = headings.filter((heading) => heading.depth === 2).map(textOf);
	if (!dates.length || dates.some((date) => !/^\d{4}-\d{2}-\d{2}$/.test(date))) {
		push(errors, path, "LOG_DATES", "log.md must use level-two ISO date headings (YYYY-MM-DD).");
	} else if (dates.some((date, index) => index > 0 && date > dates[index - 1])) {
		push(errors, path, "LOG_ORDER", "log.md date headings must be newest first.");
	}
	return tree;
}

function validateLinks(root: string, path: string, tree: any, warnings: WikiIssue[]): void {
	if (!tree) return;
	const links: any[] = [];
	visit(tree, "link", links);
	for (const link of links) {
		const url = String(link.url ?? "");
		if (!url || /^(https?:|mailto:|#)/i.test(url)) continue;
		const clean = url.split(/[?#]/, 1)[0];
		let target = clean.startsWith("/") ? clean.slice(1) : posix.normalize(posix.join(posix.dirname(path), clean));
		if (target.endsWith("/")) target += "index.md";
		const canonicalRoot = realpathSync(root);
		const absolute = resolve(canonicalRoot, target);
		const rel = relative(canonicalRoot, absolute);
		if (rel.startsWith("..") || isAbsolute(rel)) {
			push(warnings, path, "LINK_OUTSIDE_BUNDLE", `Link leaves the bundle: ${url}`);
		} else if (!existsSync(absolute)) {
			push(warnings, path, "BROKEN_LINK", `Link target does not exist: ${url}`);
		} else {
			const canonicalTarget = realpathSync(absolute);
			const canonicalRel = relative(canonicalRoot, canonicalTarget);
			if (canonicalRel.startsWith("..") || isAbsolute(canonicalRel)) {
				push(warnings, path, "LINK_OUTSIDE_BUNDLE", `Link resolves outside the bundle: ${url}`);
			}
		}
	}
}

export function validateBundle(root: string): WikiValidation {
	const errors: WikiIssue[] = [];
	const warnings: WikiIssue[] = [];
	const concepts: WikiConcept[] = [];
	const files = markdownFiles(root);
	if (!files.includes("index.md")) push(errors, "index.md", "INDEX_MISSING", "Bundle root index.md is required by Codepatrol.");

	for (const path of files) {
		const content = readFileSync(join(root, path), "utf8");
		const parsed = frontmatter(content);
		let tree: any;
		const name = posix.basename(path);
		if (name === "index.md") {
			tree = validateIndex(path, parsed, errors);
		} else if (name === "log.md") {
			tree = validateLog(path, parsed, errors);
		} else {
			if (!parsed.hasFrontmatter) push(errors, path, "FRONTMATTER_MISSING", "Concept document requires YAML frontmatter.");
			else if (parsed.error) push(errors, path, "FRONTMATTER_INVALID", parsed.error);
			const type = parsed.data?.type;
			if (typeof type !== "string" || !type.trim()) push(errors, path, "TYPE_MISSING", "Concept frontmatter requires a non-empty type.");
			if (parsed.data && typeof type === "string" && type.trim()) {
				const id = path.slice(0, -3);
				concepts.push({
					id, path, type: type.trim(),
					title: typeof parsed.data.title === "string" ? parsed.data.title : undefined,
					description: typeof parsed.data.description === "string" ? parsed.data.description : undefined,
					fields: parsed.data,
				});
				if (typeof parsed.data.title !== "string") push(warnings, path, "TITLE_RECOMMENDED", "Concept should include title.");
				if (typeof parsed.data.description !== "string") push(warnings, path, "DESCRIPTION_RECOMMENDED", "Concept should include description.");
				if (parsed.data.tags !== undefined && (!Array.isArray(parsed.data.tags) || parsed.data.tags.some((tag) => typeof tag !== "string"))) {
					push(errors, path, "TAGS_INVALID", "tags must be a YAML list of strings.");
				}
				if (parsed.data.timestamp !== undefined && (typeof parsed.data.timestamp !== "string" || Number.isNaN(Date.parse(parsed.data.timestamp)))) {
					push(errors, path, "TIMESTAMP_INVALID", "timestamp must be an ISO 8601 datetime string.");
				}
			}
			try { tree = fromMarkdown(parsed.body); } catch (error) { push(errors, path, "MARKDOWN_INVALID", error instanceof Error ? error.message : String(error)); }
			const citationHeading = /^# Citations\s*$/m.test(parsed.body);
			if (citationHeading) {
				const after = parsed.body.split(/^# Citations\s*$/m)[1] ?? "";
				for (const line of after.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
					if (!/^\[\d+\]\s+(?:\[[^\]]+\]\([^)]+\)|`[^`]+:\d+`)$/.test(line)) {
						push(warnings, path, "CITATION_FORMAT", `Citation must be a numbered Markdown link or workspace path:line: ${line}`);
					}
				}
			}
		}
		validateLinks(root, path, tree, warnings);
	}
	const valid = errors.length === 0;
	const text = [
		`Wiki validation: ${valid ? "valid" : "invalid"} — ${concepts.length} concept(s), ${errors.length} error(s), ${warnings.length} warning(s)`,
		...errors.map((issue) => `ERROR ${issue.path}: ${issue.message}`),
		...warnings.map((issue) => `WARNING ${issue.path}: ${issue.message}`),
	].join("\n");
	return { valid, errors, warnings, concepts, text };
}

export async function validateWiki(workspace: string): Promise<WikiValidation> {
	return validateBundle(wikiRoot(workspace));
}
