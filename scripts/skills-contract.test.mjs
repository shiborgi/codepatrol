import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

const root = resolve(import.meta.dirname, "..", "skills");
const shared = resolve(root, "_shared");
const expected = ["codepatrol-plan", "codepatrol-review", "codepatrol-apply", "codepatrol-verify", "codepatrol-status"];
const expectedSupport = [
	"assess-change", "codebase-design", "codebase-wiki", "diagnose-bug", "domain-modeling",
	"execute-change", "grilling", "research-technology", "solution-simplification", "verification-strategy", "writing-plans",
];
const catalog = parseYaml(readFileSync(join(root, "catalog.yaml"), "utf8"));

function metadata(name) {
	const content = readFileSync(join(root, name, "SKILL.md"), "utf8");
	const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
	return { content, frontmatter: parseYaml(match?.[1] ?? "") };
}

test("skills expose exactly the five canonical primary workflows", () => {
	const primaries = Object.entries(catalog.skills)
		.filter(([, value]) => value.role === "primary")
		.map(([name]) => name)
		.sort();
	assert.deepEqual(primaries, [...expected].sort());
	const support = Object.entries(catalog.skills)
		.filter(([, value]) => value.role === "support")
		.map(([name]) => name)
		.sort();
	assert.deepEqual(support, [...expectedSupport].sort());
	for (const legacy of ["propose-codebase", "improve-codebase", "review-codebase", "implement-codebase", "review-change"]) {
		assert.equal(existsSync(join(root, legacy)), false, `legacy public workflow ${legacy} must be absent`);
	}
	assert.ok(existsSync(join(shared, "ARTIFACTS.md")), "shared contracts live at skills/_shared/");
	assert.equal(existsSync(join(root, "_shared", "SKILL.md")), false, "shared contracts must not be discovered as a skill");
	assert.equal(catalog.skills._shared, undefined, "_shared must not be a catalog skill");
	assert.equal(existsSync(join(root, "test-driven-development")), false, "verification-strategy must absorb the legacy TDD skill");
});

test("skill frontmatter is portable and catalog dependencies are complete and acyclic", () => {
	const names = Object.keys(catalog.skills);
	for (const name of names) {
		assert.ok(existsSync(join(root, name, "SKILL.md")), `${name} must have SKILL.md`);
		assert.deepEqual(Object.keys(metadata(name).frontmatter).sort(), ["description", "name"]);
		for (const dependency of catalog.skills[name].mayInvoke ?? []) assert.ok(names.includes(dependency), `${name} references missing ${dependency}`);
	}
	const visiting = new Set();
	const visited = new Set();
	function visit(name) {
		if (visiting.has(name)) assert.fail(`catalog dependency cycle at ${name}`);
		if (visited.has(name)) return;
		visiting.add(name);
		for (const dependency of catalog.skills[name].mayInvoke ?? []) visit(dependency);
		visiting.delete(name);
		visited.add(name);
	}
	for (const name of names) visit(name);
});

test("catalog mayInvoke is support-only and reciprocal, and links exempt primary handoffs", () => {
	const roleByName = Object.fromEntries(
		Object.entries(catalog.skills).map(([name, value]) => [name, value.role]),
	);
	for (const name of Object.keys(catalog.skills)) {
		const declared = new Set(catalog.skills[name].mayInvoke ?? []);
		const linkedAll = new Set([...metadata(name).content.matchAll(/\]\(\.\.\/([^/)]+)\/SKILL\.md\)/g)]
			.map((match) => match[1])
			.filter((dependency) => dependency !== "_shared"));
		const linkedSupport = new Set([...linkedAll].filter((target) => roleByName[target] === "support"));
		for (const dependency of declared) {
			assert.equal(roleByName[dependency], "support", `${name} mayInvoke entry ${dependency} must be a support role`);
			assert.ok(linkedSupport.has(dependency), `${name} mayInvoke entry ${dependency} lacks an explicit support invocation link`);
		}
		for (const dependency of linkedSupport) assert.ok(declared.has(dependency), `${name} support invocation link ${dependency} is absent from mayInvoke`);
		for (const dependency of linkedAll) {
			if (roleByName[dependency] === "primary") {
				assert.ok(!declared.has(dependency), `${name} primary-to-primary handoff link ${dependency} must not appear in mayInvoke`);
			}
		}
	}
	for (const [name, value] of Object.entries(catalog.skills)) {
		const declared = new Set(value.mayInvoke ?? []);
		const invoked = new Set(value.invokedBy ?? []);
		for (const dependency of declared) {
			const target = catalog.skills[dependency];
			if (target) assert.ok((target.invokedBy ?? []).includes(name), `${name} -> ${dependency} is not reciprocal in invokedBy`);
		}
		for (const dependency of invoked) {
			const target = catalog.skills[dependency];
			if (target) assert.ok((target.mayInvoke ?? []).includes(name), `${name} <- ${dependency} is not reciprocal in mayInvoke`);
		}
	}
	for (const name of expected) assert.match(metadata(name).content, /ROLES\.md/, `${name} must reference the shared persona contract`);
});

test("retired verify-rejection contradiction is absent from all skill files", () => {
	function skillFiles(directory) {
		return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
			const path = join(directory, entry.name);
			return entry.isDirectory() ? skillFiles(path) : [path];
		});
	}
	for (const path of skillFiles(root).filter((path) => path.endsWith(".md"))) {
		assert.doesNotMatch(readFileSync(path, "utf8"), /returning the state to `blocked` or `approved`|`blocked` or `approved` so that/i, `${path} retains the retired verify-rejection contradiction`);
	}
});
test("skill UI prompts invoke their own skill explicitly", () => {
	for (const name of expected) {
		const path = join(root, name, "agents", "openai.yaml");
		assert.ok(existsSync(path), `${name} must define Codex presentation metadata`);
		const agent = parseYaml(readFileSync(path, "utf8"));
		assert.match(agent.interface.default_prompt, new RegExp(`\\$${name}\\b`), `${name} default prompt must name the skill`);
	}
});

test("research-technology adapts reference concepts to the target project without integration", () => {
	const research = metadata("research-technology").content;
	assert.match(research, /GitHub/i);
	assert.match(research, /target project/i);
	assert.match(research, /facts?.*inferences?/is);
	assert.match(research, /Reference Concept Analysis/);
	assert.match(research, /must not.*dependenc|never.*dependenc/is);
	assert.match(research, /must not.*integrat|never.*integrat/is);
});

test("primary workflows state their functional modes and mutation gates", () => {
	const propose = metadata("codepatrol-plan").content;
	assert.match(propose, /project or feature/i);
	assert.match(propose, /does not implement|never implements/i);
	assert.match(propose, /architecture mode/i);
	assert.match(propose, /bug mode/i);
	assert.match(propose, /diagnose-bug/);

	const review = metadata("codepatrol-review").content;
	assert.match(review, /proposal.*plan.*diff.*branch/is);
	assert.match(review, /does not (edit|modify).*code|no code edits/i);
	assert.match(review, /approve.*fix-first.*rework/is);

	const implement = metadata("codepatrol-apply").content;
	assert.match(implement, /approved/i);
	assert.match(implement, /execute-change/);
	assert.match(implement, /does not redesign|must not redesign/i);
});

test("primary workflows exchange one canonical, revisioned artifact package", () => {
	const propose = metadata("codepatrol-plan").content;
	const review = metadata("codepatrol-review").content;
	const implement = metadata("codepatrol-apply").content;

	for (const producer of [propose]) {
		assert.match(producer, /docs\/codepatrol\/<work-id>/);
		assert.match(producer, /handoff\.yaml/);
		assert.match(producer, /spec\.md/);
		assert.match(producer, /plan\.md/);
		assert.match(producer, /ready-for-review/);
		assert.doesNotMatch(producer, /execute-change/);
	}
	assert.match(review, /artifact record/);
	assert.match(review, /revision/i);
	assert.match(review, /spec\.md.*plan\.md/is);
	assert.match(review, /review\.md/);
	assert.match(review, /approved/);
	assert.match(implement, /artifact validate.*implementation/is);
	assert.match(implement, /implementation\.md/);
	assert.match(implement, /reviewed_revision/);
});

test("solution-simplification chooses the minimum sufficient solution without weakening safety", () => {
	const simplicity = metadata("solution-simplification").content;
	assert.match(simplicity, /understand.*before.*simpl/is);
	const ladder = [
		/need to exist/i,
		/already exists?.*codebase/i,
		/standard library|language runtime/i,
		/native platform/i,
		/installed dependenc/i,
		/direct local change|single expression/i,
		/minimum new implementation/i,
	];
	let cursor = -1;
	for (const rung of ladder) {
		const match = rung.exec(simplicity.slice(cursor + 1));
		assert.ok(match, `missing or misordered simplification rung ${rung}`);
		cursor += 1 + match.index;
	}
	assert.match(simplicity, /trust.*validation|validation.*trust/is);
	assert.match(simplicity, /data loss/i);
	assert.match(simplicity, /security/i);
	assert.match(simplicity, /accessibility/i);
	assert.match(simplicity, /ceiling.*trigger.*upgrade/is);
	assert.match(simplicity, /must not.*savings|never.*savings/is);

	for (const caller of ["codepatrol-plan", "assess-change", "execute-change", "writing-plans"]) {
		assert.ok(catalog.skills[caller].mayInvoke.includes("solution-simplification"), `${caller} must use solution-simplification`);
	}
});

test("codepatrol-plan carries the ordered evidence and substrate contract", () => {
	const plan = metadata("codepatrol-plan").content;
	assert.match(plan, /domain-modeling.*term is new, contested, or contradicts `CONTEXT\.md`/i);
	assert.match(plan, /codebase-design.*whenever the change adds or moves a module, interface, or seam/i);
	assert.match(plan, /grilling.*load-bearing decision is still unsettled after step 6/i);
	assert.match(plan, /codepatrol graph impact --file <path>/);
	assert.match(plan, /codepatrol graph neighbors --file <path>/);
	assert.match(plan, /graph revision and wiki state as `present`, `stale`, or `absent`/i);
	assert.match(plan, /artifact validate --stage plan/);
});
test("portable artifacts carry simplicity proof, deferred triggers, and actual surface delta", () => {
	const spec = readFileSync(join(shared, "SPEC-FORMAT.md"), "utf8");
	const plan = readFileSync(join(root, "writing-plans", "PLAN-FORMAT.md"), "utf8");
	const review = readFileSync(join(root, "codepatrol-review", "REVIEW-FORMAT.md"), "utf8");
	const implementation = readFileSync(join(root, "codepatrol-apply", "IMPLEMENTATION-FORMAT.md"), "utf8");
	const implementSkill = metadata("codepatrol-apply").content;
	assert.match(spec, /Simplicity decision/i);
	assert.match(spec, /Deferred constraints/i);
	assert.match(spec, /ceiling.*trigger.*upgrade/is);
	assert.match(plan, /Simplicity proof/i);
	assert.match(plan, /surface delta/i);
	assert.match(review, /simplicity axis/i);
	assert.match(implementation, /surface delta/i);
	assert.match(implementSkill, /deferred.*workflow.*trigger.*upgrade/is);
});

test("codepatrol-review states the eleven-step evidence order and the external-evidence duties", () => {
	const review = metadata("codepatrol-review").content;
	assert.match(review, /artifact validate --stage plan/);
	assert.match(review, /codepatrol graph impact --file <path>/);
	assert.match(review, /codepatrol graph neighbors --file <path>/);
	assert.match(review, /artifact currency/i);
	assert.match(review, /external evidence sufficiency/i);
	assert.match(review, /not required.*required and sufficient.*required and missing/is);
	assert.match(review, /research-technology/);
	assert.match(review, /invariant cross-check/i);
	assert.match(review, /residual[- ]concerns/i);
});

test("review-format documents the renamed verdict, External evidence sufficiency, and Residual concerns sections", () => {
	const format = readFileSync(join(root, "codepatrol-review", "REVIEW-FORMAT.md"), "utf8");
	assert.match(format, /`approve` \| `fix-first` \| `rework`/);
	assert.match(format, /## External evidence sufficiency/);
	assert.match(format, /## Residual concerns and evidence gaps/);
	assert.match(format, /deprecated alias/);
});

test("tombstone: verdict-sense merge is absent from primary skill prose", () => {
	const review = metadata("codepatrol-review").content;
	const apply = metadata("codepatrol-apply").content;
	const assess = metadata("assess-change").content;
	const sharedArtifacts = readFileSync(join(shared, "ARTIFACTS.md"), "utf8");
	assert.doesNotMatch(review, /verdict is `merge`/);
	assert.doesNotMatch(apply, /verdict is `merge`/);
	assert.doesNotMatch(assess, /^- `merge`: /m);
	assert.doesNotMatch(sharedArtifacts, /verdict is `merge`/);
});

test("codepatrol-apply accepts the deprecated merge alias with a documented warning", () => {
	const apply = metadata("codepatrol-apply").content;
	assert.match(apply, /approve.*deprecated alias.*merge|merge.*alias/s);
});
