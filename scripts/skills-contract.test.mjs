import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

const root = resolve(import.meta.dirname, "..", "skills");
const shared = join(root, "_shared");
const lifecycle = ["codepatrol-plan", "codepatrol-review", "codepatrol-apply", "codepatrol-verify", "codepatrol-finalize"];
const primaries = [...lifecycle, "codepatrol-status"];
const support = ["assess-change", "codebase-design", "codebase-wiki", "diagnose-bug", "domain-modeling", "execute-change", "grilling", "research-technology", "solution-simplification", "verification-strategy", "writing-plans"];
const catalog = parseYaml(readFileSync(join(root, "catalog.yaml"), "utf8"));
function skill(name) { return readFileSync(join(root, name, "SKILL.md"), "utf8"); }

test("catalog exposes five ordered lifecycle skills plus unordered Status", () => {
	const actual = Object.entries(catalog.skills).filter(([, value]) => value.role === "primary").map(([name]) => name).sort();
	assert.deepEqual(actual, [...primaries].sort());
	assert.deepEqual(Object.entries(catalog.skills).filter(([, value]) => value.role === "support").map(([name]) => name).sort(), [...support].sort());
	for (const [index, name] of lifecycle.entries()) assert.equal(catalog.skills[name].order, index + 1);
	assert.equal(catalog.skills["codepatrol-status"].order, undefined);
	assert.equal(catalog.skills["codepatrol-finalize"].mutation, "authorized");
});

test("Change and Stage Session are the only shared lifecycle contracts", () => {
	assert.ok(existsSync(join(shared, "CHANGE.md"))); assert.ok(existsSync(join(shared, "SESSION.md")));
	assert.equal(existsSync(join(shared, "ARTIFACTS.md")), false); assert.equal(existsSync(join(shared, "WORKFLOW.md")), false);
	const change = readFileSync(join(shared, "CHANGE.md"), "utf8");
	assert.match(change, /\.codepatrol\/changes\/<work-id>/); assert.match(change, /Plan → Review → Apply → Verify → Finalize/);
	assert.match(change, /measured|unavailable/); assert.match(change, /elapsed/i); assert.match(change, /never.*recency/is);
	const session = readFileSync(join(shared, "SESSION.md"), "utf8"); assert.match(session, /\.codepatrol\/runtime\/sessions/); assert.match(session, /never own lifecycle/i);
});

test("each lifecycle skill owns one stage, records metrics, checkpoints, and stops", () => {
	const owned = { "codepatrol-plan": "plan/", "codepatrol-review": "review/", "codepatrol-apply": "apply/", "codepatrol-verify": "verify/", "codepatrol-finalize": "finalize/" };
	for (const name of lifecycle) {
		const text = skill(name); assert.match(text, /change inspect --id <work-id>/); assert.match(text, new RegExp(owned[name].replace("/", "\\/")));
		assert.match(text, /elapsed/i); assert.match(text, /actual.*unavailable|measured.*unavailable/is);
		if (name !== "codepatrol-finalize") assert.match(text, /Do not invoke|never.*invoke/is);
		const metadata = parseYaml(readFileSync(join(root, name, "agents", "openai.yaml"), "utf8")); assert.match(metadata.interface.default_prompt, new RegExp(`\\$${name}\\b`));
	}
});

test("Finalize is authority-bound, recoverable, local-only, and clean", () => {
	const text = skill("codepatrol-finalize");
	assert.match(text, /explicit.*authority|authority.*explicit/is); assert.match(text, /commit.*rollback/is); assert.match(text, /tag.*precedes deletion/is);
	assert.match(text, /target tree byte-identical/i); assert.match(text, /clean/i); assert.match(text, /Never fetch, push, rebase, force/i);
});

test("Status delegates table generation to the deterministic script", () => {
	const text = skill("codepatrol-status"); assert.match(text, /scripts\/render-kanban\.mjs/); assert.match(text, /verbatim/i); assert.match(text, /Do not construct[\s\S]*table/i);
});

test("catalog dependencies are reciprocal, support-only and acyclic", () => {
	const names = Object.keys(catalog.skills); const visiting = new Set(); const visited = new Set();
	for (const [name, entry] of Object.entries(catalog.skills)) for (const target of entry.mayInvoke ?? []) {
		assert.equal(catalog.skills[target]?.role, "support", `${name} may invoke only support skill ${target}`); assert.ok(catalog.skills[target].invokedBy.includes(name));
	}
	function visit(name) { if (visiting.has(name)) assert.fail(`cycle at ${name}`); if (visited.has(name)) return; visiting.add(name); for (const target of catalog.skills[name].mayInvoke ?? []) visit(target); visiting.delete(name); visited.add(name); }
	for (const name of names) visit(name);
});

test("live skill contracts contain no v1 package, ledger, or ADR paths", () => {
	function files(directory) { return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]); }
	for (const path of files(root).filter((value) => value.endsWith(".md"))) {
		const text = readFileSync(path, "utf8"); assert.doesNotMatch(text, /\.codepatrol\/(packages|workflows|packagesflows|adr)\//, path); assert.doesNotMatch(text, /ARTIFACTS\.md|WORKFLOW\.md/, path);
	}
});

test("support skills retain simplification and external-evidence safety floors", () => {
	const simplify = skill("solution-simplification"); assert.match(simplify, /minimum new implementation/i); assert.match(simplify, /data loss/i); assert.match(simplify, /security/i);
	const research = skill("research-technology"); assert.match(research, /GitHub/i); assert.match(research, /facts?.*inferences?/is); assert.match(research, /must not.*dependenc|never.*dependenc/is);
});
