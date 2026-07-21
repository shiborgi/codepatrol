#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "skills");
const failures = [];
const banned = ["subagent({", "spawn_agent(", "tools.Agent(", "use_mcp_tool", "permission.task", ".opencode/", "disable-model-invocation:"];
const primaryWorkflows = ["codepatrol-plan", "codepatrol-review", "codepatrol-apply", "codepatrol-verify", "codepatrol-status"];
const executionProtocolSkills = new Set([...primaryWorkflows, "codebase-wiki", "diagnose-bug", "execute-change"]);
const allowedRoles = new Set(["primary", "support"]);
const allowedMutations = new Set(["never", "artifacts", "authorized"]);

const protocolPath = join(root, "_shared", "EXECUTION.md");
const protocol = readFileSync(protocolPath, "utf8");
const protocolRequirements = [
	[/independent/i, "independence criterion"],
	[/sequential/i, "sequential fallback"],
	[/barrier/i, "barrier before synthesis"],
	[/evidence/i, "evidence contract"],
	[/Never let workers update the same file or module concurrently/i, "write ownership rule"],
];
for (const [pattern, label] of protocolRequirements) if (!pattern.test(protocol)) failures.push(`_shared/EXECUTION.md: missing ${label}`);

function allMarkdown(directory) {
	const result = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) result.push(...allMarkdown(path));
		else if (entry.isFile() && entry.name.endsWith(".md")) result.push(path);
	}
	return result;
}

for (const path of allMarkdown(root)) {
	const content = readFileSync(path, "utf8");
	const rel = path.slice(root.length + 1);
	for (const token of banned) if (content.includes(token)) failures.push(`${rel}: harness-specific token ${token}`);
	if (/codepatrol graph [a-z]+\(/.test(content)) failures.push(`${rel}: tool-call syntax used instead of CLI flags`);
	const linkContent = content.replace(/```[\s\S]*?```/g, "");
	for (const match of linkContent.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
		const target = match[1].split("#")[0];
		if (!target || /^(https?:|mailto:|\/)/.test(target)) continue;
		if (!existsSync(resolve(dirname(path), target))) failures.push(`${rel}: broken relative link ${match[1]}`);
	}
}

let catalog;
try { catalog = parseYaml(readFileSync(join(root, "catalog.yaml"), "utf8")); }
catch (error) { failures.push(`catalog.yaml: invalid or missing: ${error.message}`); catalog = { skills: {} }; }
if (catalog?.version !== 1 || !catalog.skills || typeof catalog.skills !== "object") failures.push("catalog.yaml: expected version 1 with a skills map");
const catalogSkills = catalog?.skills && typeof catalog.skills === "object" ? catalog.skills : {};
const catalogNames = Object.keys(catalogSkills);
const skillDirectories = readdirSync(root, { withFileTypes: true })
	.filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, "SKILL.md")))
	.map((entry) => entry.name);

for (const name of catalogNames) {
	const entry = catalogSkills[name];
	const skillPath = join(root, name, "SKILL.md");
	if (!existsSync(skillPath)) { failures.push(`${name}: catalog entry has no SKILL.md`); continue; }
	const content = readFileSync(skillPath, "utf8");
	const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
	if (!match) { failures.push(`${name}/SKILL.md: missing frontmatter`); continue; }
	let frontmatter;
	try { frontmatter = parseYaml(match[1]); }
	catch (error) { failures.push(`${name}/SKILL.md: invalid YAML: ${error.message}`); continue; }
	if (frontmatter?.name !== name) failures.push(`${name}/SKILL.md: name must match directory`);
	if (typeof frontmatter?.description !== "string" || !frontmatter.description.trim()) failures.push(`${name}/SKILL.md: missing description`);
	const keys = Object.keys(frontmatter ?? {}).sort();
	if (keys.join(",") !== "description,name") failures.push(`${name}/SKILL.md: frontmatter may contain only name and description`);
	if (!allowedRoles.has(entry?.role)) failures.push(`${name}: role must be primary or support`);
	if (!allowedMutations.has(entry?.mutation)) failures.push(`${name}: unsupported mutation policy ${entry?.mutation}`);
	for (const field of ["invokedBy", "mayInvoke", "consumes", "produces"]) if (!Array.isArray(entry?.[field])) failures.push(`${name}: ${field} must be an array`);
	if (executionProtocolSkills.has(name) && !content.includes("EXECUTION.md")) failures.push(`${name}/SKILL.md: portable execution protocol not referenced`);
}

for (const name of skillDirectories) if (!catalogNames.includes(name)) failures.push(`${name}: skill missing from catalog.yaml`);
for (const name of catalogNames) {
	for (const dependency of catalogSkills[name]?.mayInvoke ?? []) {
		if (!catalogSkills[dependency]) failures.push(`${name}: mayInvoke references missing ${dependency}`);
		else if (!(catalogSkills[dependency].invokedBy ?? []).includes(name)) failures.push(`${name} -> ${dependency}: invokedBy is not reciprocal`);
	}
}

const visiting = new Set();
const visited = new Set();
function visit(name) {
	if (visiting.has(name)) { failures.push(`catalog.yaml: dependency cycle at ${name}`); return; }
	if (visited.has(name)) return;
	visiting.add(name);
	for (const dependency of catalogSkills[name]?.mayInvoke ?? []) if (catalogSkills[dependency]) visit(dependency);
	visiting.delete(name);
	visited.add(name);
}
for (const name of catalogNames) visit(name);

const declaredPrimaries = catalogNames.filter((name) => catalogSkills[name]?.role === "primary").sort();
if (declaredPrimaries.join(",") !== [...primaryWorkflows].sort().join(",")) failures.push(`catalog.yaml: primaries must be exactly ${primaryWorkflows.join(", ")}`);
for (const legacy of ["propose-codebase", "improve-codebase", "review-codebase", "implement-codebase", "review-change"]) {
	if (existsSync(join(root, legacy))) failures.push(`${legacy}: legacy public workflow directory must be absent`);
}
if (existsSync(join(root, "test-driven-development", "SKILL.md"))) failures.push("test-driven-development: verification-strategy must absorb the legacy skill");

if (failures.length) {
	for (const failure of [...new Set(failures)]) process.stderr.write(`${failure}\n`);
	process.exitCode = 1;
} else {
	process.stdout.write("Skill catalog, frontmatter, dependencies, portability, and relative links are valid.\n");
}
