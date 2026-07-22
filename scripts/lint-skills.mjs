#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const primaryWorkflows = ["codepatrol-plan", "codepatrol-review", "codepatrol-apply", "codepatrol-verify", "codepatrol-finalize", "codepatrol-status"];
const executionProtocolSkills = new Set([...primaryWorkflows, "codebase-wiki", "diagnose-bug", "execute-change"]);
const allowedRoles = new Set(["primary", "support"]);
const allowedMutations = new Set(["never", "artifacts", "authorized"]);
const PRIMARY_ORDER = { "codepatrol-plan": 1, "codepatrol-review": 2, "codepatrol-apply": 3, "codepatrol-verify": 4, "codepatrol-finalize": 5 };
const ALLOWED_TRIGGER_WHEN = new Set([
	"always-before-recommendation",
	"always-before-verdict",
	"always-before-task-mutation",
	"always-before-assessment",
	"when-artifact-refresh-required",
	"when-behavior-change",
	"when-bug-mode",
	"when-domain-term-settled",
	"when-external-evidence-required",
	"when-irreducible-seam",
	"when-load-bearing-decision-unsettled",
	"when-module-or-seam-change",
	"when-plan-correction-required",
	"when-seam-or-module-decision",
	"after-decision-tree",
	"after-root-cause",
	"after-spec-decision-complete",
	"after-task-change",
	"after-task-result",
	"when-wiki-refresh-required",
]);

function allMarkdown(directory) {
	const result = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) result.push(...allMarkdown(path));
		else if (entry.isFile() && entry.name.endsWith(".md")) result.push(path);
	}
	return result;
}

/**
 * Pure lint entry point. Returns the failure list so tests can assert on
 * it; the CLI wrapper below translates an empty list into the standard
 * "ok" message and a non-empty list into stderr + non-zero exit.
 */
export function lintSkillTree(skillsRoot, { opencodeCommandsRoot = join(skillsRoot, "..", ".opencode", "commands") } = {}) {
	const failures = [];
	const banned = ["subagent({", "spawn_agent(", "tools.Agent(", "use_mcp_tool", "permission.task", "disable-model-invocation:"];
	const protocolPath = join(skillsRoot, "_shared", "EXECUTION.md");
	if (!existsSync(protocolPath)) failures.push("_shared/EXECUTION.md: missing portable execution protocol");
	else {
		const protocol = readFileSync(protocolPath, "utf8");
		const protocolRequirements = [
			[/independent/i, "independence criterion"],
			[/sequential/i, "sequential fallback"],
			[/barrier/i, "barrier before synthesis"],
			[/evidence/i, "evidence contract"],
			[/Never let workers update the same file or module concurrently/i, "write ownership rule"],
		];
		for (const [pattern, label] of protocolRequirements) if (!pattern.test(protocol)) failures.push(`_shared/EXECUTION.md: missing ${label}`);
	}

	for (const path of allMarkdown(skillsRoot)) {
		const content = readFileSync(path, "utf8");
		const rel = path.slice(skillsRoot.length + 1);
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
	try { catalog = parseYaml(readFileSync(join(skillsRoot, "catalog.yaml"), "utf8")); }
	catch (error) { failures.push(`catalog.yaml: invalid or missing: ${error.message}`); catalog = { skills: {} }; }
	if (catalog?.version !== 1 || !catalog.skills || typeof catalog.skills !== "object") failures.push("catalog.yaml: expected version 1 with a skills map");
	const catalogSkills = catalog?.skills && typeof catalog.skills === "object" ? catalog.skills : {};
	const catalogNames = Object.keys(catalogSkills);
	const skillDirectories = readdirSync(skillsRoot, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && existsSync(join(skillsRoot, entry.name, "SKILL.md")))
		.map((entry) => entry.name);

	for (const name of catalogNames) {
		const entry = catalogSkills[name];
		const skillPath = join(skillsRoot, name, "SKILL.md");
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

		if (entry?.role === "primary" && name in PRIMARY_ORDER) {
			if (entry.order !== PRIMARY_ORDER[name]) failures.push(`${name}: order must be ${PRIMARY_ORDER[name]} (Plan<Review<Apply<Verify<Finalize)`);
		} else if (entry?.order !== undefined) {
			failures.push(`${name}: order is only valid for the five lifecycle primaries; codepatrol-status must not declare order`);
		}

		const triggers = entry?.triggers;
		if (triggers !== undefined) {
			if (!Array.isArray(triggers)) failures.push(`${name}: triggers must be an array of {target, when} objects`);
			else for (let index = 0; index < triggers.length; index++) {
				const trigger = triggers[index];
				if (!trigger || typeof trigger !== "object" || Array.isArray(trigger)) {
					failures.push(`${name}: triggers[${index}] must be an object`);
					continue;
				}
				if (typeof trigger.target !== "string" || trigger.target.length === 0) failures.push(`${name}: triggers[${index}].target must be a non-empty string`);
				else if (catalogSkills[trigger.target]?.role === "primary") failures.push(`${name}: triggers[${index}].target (${trigger.target}) must not be a primary skill`);
				else if (!(catalogSkills[trigger.target]?.invokedBy ?? []).includes(name)) failures.push(`${name}: triggers[${index}].target (${trigger.target}) is not declared in the target's invokedBy`);
				if (typeof trigger.when !== "string" || !ALLOWED_TRIGGER_WHEN.has(trigger.when)) {
					failures.push(`${name}: triggers[${index}].when must be one of the allowed trigger values`);
				}
			}
			// Cross-check: every mayInvoke target should have a corresponding trigger condition
			// when the caller is not invoking a primary.
			const triggersByTarget = new Map(triggers.map((trigger) => [trigger.target, trigger.when]));
			for (const target of entry?.mayInvoke ?? []) {
				if (catalogSkills[target]?.role === "primary") continue;
				if (!triggersByTarget.has(target)) failures.push(`${name}: mayInvoke target ${target} is missing a trigger entry`);
			}
		} else if ((entry?.mayInvoke ?? []).some((target) => catalogSkills[target]?.role === "support")) {
			failures.push(`${name}: skills with mayInvoke entries must declare triggers`);
		}

		if (executionProtocolSkills.has(name) && !readFileSync(skillPath, "utf8").includes("EXECUTION.md")) {
			failures.push(`${name}/SKILL.md: portable execution protocol not referenced`);
		}
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
		if (existsSync(join(skillsRoot, legacy))) failures.push(`${legacy}: legacy public workflow directory must be absent`);
	}
	if (existsSync(join(skillsRoot, "test-driven-development", "SKILL.md"))) failures.push("test-driven-development: verification-strategy must absorb the legacy skill");

	// OpenCode command templates must reference the matching skill, use canonical
	// package paths, and use the canonical verdict vocabulary.
	if (existsSync(opencodeCommandsRoot)) {
		const verdictWords = ["approve", "fix-first", "rework", "merge"];
		for (const entry of readdirSync(opencodeCommandsRoot, { withFileTypes: true })) {
			if (!entry.isFile() || !entry.name.startsWith("codepatrol-") || !entry.name.endsWith(".md")) continue;
			const target = entry.name.replace(/\.md$/, "");
			if (!primaryWorkflows.includes(target)) continue;
			const text = readFileSync(join(opencodeCommandsRoot, entry.name), "utf8");
			if (!text.includes(target)) failures.push(`${entry.name}: must reference its skill (${target})`);
			if (/docs\/codepatrol/.test(text)) failures.push(`${entry.name}: references legacy docs/codepatrol path`);
			if (/\bmerge\b/.test(text) && !/deprecated/.test(text)) {
				failures.push(`${entry.name}: uses 'merge' verdict (deprecated alias for 'approve')`);
			}
		}
	}

	return failures;
}

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "skills");
if (import.meta.url === `file://${process.argv[1]}`) {
	const failures = lintSkillTree(defaultRoot);
	if (failures.length) {
		for (const failure of [...new Set(failures)]) process.stderr.write(`${failure}\n`);
		process.exitCode = 1;
	} else {
		process.stdout.write("Skill catalog, frontmatter, dependencies, portability, and relative links are valid.\n");
	}
}
