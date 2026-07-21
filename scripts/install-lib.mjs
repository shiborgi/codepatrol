import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, readdirSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { parse as parseYaml } from "yaml";

export const HARNESSES = ["pi", "claude", "codex", "kiro-ide", "opencode"];
const SHARED = new Set(["codex", "opencode"]);

/**
 * Resolve the symlink type for a source. Files use `"file"`, directories use
 * `"dir"`, anything else is rejected. The result is the single value passed
 * to every create/relink/uninstall/rollback path so file-kind symlinks (for
 * example `.opencode/commands/*.md`) and directory-kind symlinks (skill
 * directories) round-trip identically.
 */
function linkTypeFor(source) {
	const stat = lstatSync(source);
	if (stat.isDirectory()) return "dir";
	if (stat.isFile()) return "file";
	throw new Error(`Refusing to symlink unsupported source type: ${source}`);
}

export function parseInstallerArgs(argv) {
	let harness = "all";
	let dryRun = false;
	let withAgentProfiles = false;
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === "--dry-run") dryRun = true;
		else if (arg === "--with-agent-profiles") withAgentProfiles = true;
		else if (arg === "--harness") harness = argv[++index];
		else throw new Error(`Unknown argument: ${arg}`);
	}
	if (harness === "claude-code") harness = "claude";
	if (harness === "kiro") harness = "kiro-ide";
	if (harness !== "all" && !HARNESSES.includes(harness)) throw new Error(`Unsupported harness: ${harness}`);
	if (withAgentProfiles) throw new Error("Agent profiles are not included in Codepatrol v1.");
	return { harnesses: harness === "all" ? [...HARNESSES] : [harness], dryRun };
}

export function skillSources(root) {
	const skills = join(root, "skills");
	return readdirSync(skills, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && existsSync(join(skills, entry.name, "SKILL.md")))
		.map((entry) => ({ name: entry.name, source: join(skills, entry.name) }))
		.sort((a, b) => a.name.localeCompare(b.name));
}

// The catalog's primary workflows are the only user-facing entry points. Support skills
// stay in the tree and are reached by the primaries through relative references;
// linking them into flat discovery directories only pollutes them and collides
// with generically named skills from other sources. When no catalog is present
// (test fixtures), fall back to linking everything.
function primarySkillNames(root) {
	try {
		const catalog = parseYaml(readFileSync(join(root, "skills", "catalog.yaml"), "utf8"));
		const names = Object.entries(catalog?.skills ?? {}).filter(([, value]) => value?.role === "primary").map(([name]) => name);
		return names.length ? new Set(names) : null;
	} catch { return null; }
}

export function installableSkills(root) {
	const primary = primarySkillNames(root);
	return primary ? skillSources(root).filter((skill) => primary.has(skill.name)) : skillSources(root);
}

// OpenCode surfaces skills through a slash menu, but skills are not enumerated
// there on their own. The install links thin command templates from .opencode/
// commands/ into the user's OpenCode command directory so `/codepatrol-*`
// appears alongside other slash commands and loads the matching skill.
function opencodeCommandDir(home) {
	const configHome = process.env.XDG_CONFIG_HOME || join(home, ".config");
	return join(configHome, "opencode", "commands");
}

// Only catalog primary workflows get slash-command entry points, mirroring the
// skill link policy. When no catalog is present (test fixtures without .opencode/
// commands/), nothing is linked here.
function commandSources(root) {
	const dir = join(root, ".opencode", "commands");
	if (!existsSync(dir)) return [];
	const primary = primarySkillNames(root);
	return readdirSync(dir, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name.startsWith("codepatrol-"))
		.map((entry) => ({ name: entry.name, source: join(dir, entry.name) }))
		.filter((entry) => !primary || primary.has(entry.name.replace(/\.md$/, "")))
		.sort((a, b) => a.name.localeCompare(b.name));
}

export function destinations(home, harnesses) {
	const result = new Map();
	if (harnesses.some((harness) => SHARED.has(harness))) result.set("shared", join(home, ".agents", "skills"));
	if (harnesses.includes("claude")) result.set("claude", join(home, ".claude", "skills"));
	if (harnesses.includes("kiro-ide")) result.set("kiro-ide", join(home, ".kiro", "skills"));
	if (harnesses.includes("opencode")) result.set("opencode-commands", opencodeCommandDir(home));
	return result;
}

function lstat(path) {
	try { return lstatSync(path); } catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
}

function canonicalLinkTarget(path) {
	return resolve(dirname(path), readlinkSync(path));
}

function registryPath(home) {
	return join(home, ".codepatrol", "install.json");
}

function loadRegistry(home) {
	try {
		const value = JSON.parse(readFileSync(registryPath(home), "utf8"));
		return value?.version === 1 && value.sources ? value : { version: 1, sources: {} };
	} catch { return { version: 1, sources: {} }; }
}

function saveRegistry(home, registry) {
	const path = registryPath(home);
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
	renameSync(temporary, path);
}

function rootKey(root) {
	return createHash("sha256").update(root).digest("hex").slice(0, 16);
}

// Every checkout Codepatrol has ever installed from, plus the current one. A link
// is Codepatrol-owned when it targets anything under one of these roots, which lets
// a re-install heal links left stale by an in-repo rename (e.g. plugins/ -> skills/).
function ownedRoots(home, root) {
	const registered = Object.values(loadRegistry(home).sources).map((entry) => resolve(entry.root));
	return [...new Set([resolve(root), ...registered])];
}

function isUnderRoots(path, roots) {
	return roots.some((root) => path === root || path.startsWith(root + sep));
}

function diagnosticError(error, output) {
	const result = error instanceof Error ? error : new Error(String(error));
	result.installOutput = [...output];
	return result;
}

// Returns a create/relink/no-op plan, or a { conflict } marker for a path we do
// not own. Markers are collected so install can report every conflict at once
// (especially under --dry-run) instead of aborting at the first.
function preflightLink(source, target, roots) {
	const current = lstat(target);
	if (!current) return { source, target, linkType: linkTypeFor(source), create: true };
	if (current.isSymbolicLink()) {
		const link = canonicalLinkTarget(target);
		if (link === source) return { source, target, linkType: linkTypeFor(source), create: false };
		if (isUnderRoots(link, roots)) return { source, target, linkType: linkTypeFor(source), create: true, relink: true };
		return { source, target, conflict: `currently -> ${link}` };
	}
	return { source, target, conflict: "exists and is not a symlink" };
}

function linkablesFor(root, home, harnesses, key, destination) {
	if (key === "opencode-commands") return commandSources(root).map((command) => ({ source: command.source, target: join(destination, command.name) }));
	return installableSkills(root).map((skill) => ({ source: skill.source, target: join(destination, skill.name) }));
}

function linkPlan(root, home, harnesses) {
	const roots = ownedRoots(home, root);
	const result = [];
	for (const [key, destination] of destinations(home, harnesses)) {
		for (const linkable of linkablesFor(root, home, harnesses, key, destination)) result.push(preflightLink(linkable.source, linkable.target, roots));
	}
	return result;
}

function applyLinkPlan(plan, dryRun, output) {
	const created = [];
	try {
		for (const operation of plan) {
			if (!operation.create) {
				output.push(`ok ${operation.target}`);
				continue;
			}
			const verb = operation.relink ? "relink" : "link";
			output.push(`${dryRun ? `would ${verb}` : `${verb}ed`} ${operation.target} -> ${operation.source}`);
			if (!dryRun) {
				if (operation.relink) unlinkSync(operation.target);
				mkdirSync(dirname(operation.target), { recursive: true });
				symlinkSync(operation.source, operation.target, operation.linkType);
				created.push(operation);
			}
		}
		return created;
	} catch (error) {
		rollbackLinks(created, output);
		throw diagnosticError(error, output);
	}
}

function rollbackLinks(created, output) {
	for (const operation of [...created].reverse()) {
		const current = lstat(operation.target);
		if (current?.isSymbolicLink() && canonicalLinkTarget(operation.target) === operation.source) {
			unlinkSync(operation.target);
			output.push(`rolled back ${operation.target}`);
		}
	}
}

function preflightRemoval(source, target, roots) {
	const current = lstat(target);
	if (!current) return { source, target, remove: false, reason: "absent" };
	if (current.isSymbolicLink()) {
		const link = canonicalLinkTarget(target);
		if (link === source || isUnderRoots(link, roots)) return { source, target, linkType: linkTypeFor(source), remove: true };
	}
	return { source, target, remove: false, reason: "non-owned" };
}

function applyRemovalPlan(plan, dryRun, output) {
	const removed = [];
	try {
		for (const operation of plan) {
			if (!operation.remove) {
				if (operation.reason === "non-owned") output.push(`skipped non-owned ${operation.target}`);
				continue;
			}
			output.push(`${dryRun ? "would remove" : "removed"} ${operation.target}`);
			if (!dryRun) {
				unlinkSync(operation.target);
				removed.push(operation);
			}
		}
		return removed;
	} catch (error) {
		rollbackRemovals(removed, output);
		throw diagnosticError(error, output);
	}
}

function rollbackRemovals(removed, output) {
	for (const operation of [...removed].reverse()) {
		if (lstat(operation.target)) {
			output.push(`could not restore occupied path ${operation.target}`);
			continue;
		}
		mkdirSync(dirname(operation.target), { recursive: true });
		const restoreType = operation.linkType ?? linkTypeFor(operation.source);
		symlinkSync(operation.source, operation.target, restoreType);
		output.push(`restored ${operation.target}`);
	}
}

function runPi(action, root, dryRun, output) {
	const command = [action, root];
	output.push(`${dryRun ? "would run" : "running"} pi ${command.join(" ")}`);
	if (dryRun) return;
	const result = spawnSync("pi", command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	if (result.error?.code === "ENOENT") throw new Error("Pi executable not found; installation was rolled back.");
	if (result.status !== 0) throw new Error(`pi ${action} failed: ${(result.stderr || result.stdout).trim()}`);
}

export function install({ root, home = homedir(), harnesses, dryRun = false }) {
	root = resolve(root);
	const output = [];
	const registry = loadRegistry(home);
	const key = rootKey(root);
	const previous = new Set(registry.sources[key]?.harnesses ?? []);
	const next = new Set([...previous, ...harnesses]);
	const plan = linkPlan(root, home, harnesses); // Complete preflight: no writes before every target is safe.
	const conflicts = plan.filter((operation) => operation.conflict);
	for (const operation of conflicts) output.push(`conflict ${operation.target} (${operation.conflict})`);
	if (conflicts.length && !dryRun) {
		throw diagnosticError(new Error(`Refusing to overwrite ${conflicts.length} non-Codepatrol path(s); run --dry-run to list them`), output);
	}
	const created = applyLinkPlan(plan.filter((operation) => !operation.conflict), dryRun, output);
	let piInstalled = false;
	try {
		if (harnesses.includes("pi")) {
			runPi("install", root, dryRun, output);
			piInstalled = !dryRun;
		}
		if (!dryRun) {
			registry.sources[key] = { root, harnesses: [...next].sort(), updatedAt: new Date().toISOString() };
			saveRegistry(home, registry);
		}
	} catch (error) {
		if (piInstalled) {
			try { runPi("remove", root, false, output); }
			catch (rollbackError) { output.push(`failed Pi rollback: ${rollbackError.message}`); }
		}
		if (!dryRun) rollbackLinks(created, output);
		throw diagnosticError(error, output);
	}
	return output;
}

export function uninstall({ root, home = homedir(), harnesses, dryRun = false }) {
	root = resolve(root);
	const output = [];
	const registry = loadRegistry(home);
	const key = rootKey(root);
	const previous = new Set(registry.sources[key]?.harnesses ?? (harnesses.length === HARNESSES.length ? HARNESSES : harnesses));
	for (const harness of harnesses) previous.delete(harness);
	const skills = installableSkills(root);
	const shouldRemoveShared = ![...previous].some((harness) => SHARED.has(harness));
	const targets = [];
	if (shouldRemoveShared && harnesses.some((harness) => SHARED.has(harness))) {
		for (const skill of skills) targets.push([skill.source, join(home, ".agents", "skills", skill.name)]);
	}
	if (harnesses.includes("claude") && !previous.has("claude")) {
		for (const skill of skills) targets.push([skill.source, join(home, ".claude", "skills", skill.name)]);
	}
	if (harnesses.includes("kiro-ide") && !previous.has("kiro-ide")) {
		for (const skill of skills) targets.push([skill.source, join(home, ".kiro", "skills", skill.name)]);
	}
	if (harnesses.includes("opencode")) {
		for (const command of commandSources(root)) targets.push([command.source, join(opencodeCommandDir(home), command.name)]);
	}
	const roots = ownedRoots(home, root);
	const plan = targets.map(([source, target]) => preflightRemoval(source, target, roots));
	let piRemoved = false;
	let removed = [];
	try {
		if (harnesses.includes("pi")) {
			runPi("remove", root, dryRun, output);
			piRemoved = !dryRun;
		}
		removed = applyRemovalPlan(plan, dryRun, output);
		if (!dryRun) {
			if (previous.size) registry.sources[key] = { root, harnesses: [...previous].sort(), updatedAt: new Date().toISOString() };
			else delete registry.sources[key];
			saveRegistry(home, registry);
		}
	} catch (error) {
		if (!dryRun) rollbackRemovals(removed, output);
		if (piRemoved) {
			try { runPi("install", root, false, output); }
			catch (rollbackError) { output.push(`failed Pi restore: ${rollbackError.message}`); }
		}
		throw diagnosticError(error, output);
	}
	return output;
}

export function verify({ root, home = homedir(), harnesses }) {
	root = resolve(root);
	const output = [];
	let ok = true;
	const byKey = destinations(home, harnesses);
	for (const [key, destination] of byKey) {
		const linkables = key === "opencode-commands" ? commandSources(root) : installableSkills(root);
		for (const linkable of linkables) {
			const target = join(destination, linkable.name);
			const current = lstat(target);
			const matches = current?.isSymbolicLink() && canonicalLinkTarget(target) === linkable.source;
			output.push(`${matches ? "ok" : "missing"} ${target}`);
			ok &&= Boolean(matches);
		}
	}
	const cli = spawnSync("codepatrol", ["--version"], { encoding: "utf8" });
	const cliOk = cli.status === 0;
	output.push(cliOk ? "ok codepatrol CLI on PATH" : "missing codepatrol CLI on PATH (run `npm link` in the checkout)");
	ok &&= cliOk;
	if (harnesses.includes("pi")) {
		const listed = spawnSync("pi", ["list"], { encoding: "utf8" });
		const piOk = listed.status === 0 && listed.stdout.includes(root);
		output.push(`${piOk ? "ok" : "missing"} Pi local package ${root}`);
		ok &&= piOk;
	}
	return { ok, output };
}

// Exported for unit tests; not part of the public installer surface.
export const __internal = { linkTypeFor, preflightLink, rollbackLinks, rollbackRemovals, runPi, diagnosticError };
