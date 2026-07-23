import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

test("published package includes the CLI, native integrations, portable core, and local installers", () => {
	const files = new Set(manifest.files);
	for (const required of ["bin", "dist", "docs", "skills", "scripts/clean-dist.mjs", "scripts/install-lib.mjs", "scripts/install-local.mjs", "scripts/uninstall-local.mjs", "scripts/verify-install.mjs"]) {
		assert.ok(files.has(required), `package files must include ${required}`);
	}
	assert.equal(manifest.bin.codepatrol, "./bin/codepatrol.js");
	assert.deepEqual(manifest.pi.extensions, ["./dist/.pi/index.js"]);
	assert.deepEqual(manifest.pi.skills, ["./skills"]);
	assert.equal(manifest.repository.url, "git+https://github.com/shiborgi/codepatrol.git");
	assert.equal(manifest.homepage, "https://github.com/shiborgi/codepatrol#readme");
	assert.ok(existsSync(join(root, "skills", "catalog.yaml")), "the canonical skill tree lives at repository-root skills/");
	assert.match(manifest.scripts.build, /^node scripts\/clean-dist\.mjs && tsc /);
	assert.doesNotMatch(`${manifest.description} ${manifest.keywords.join(" ")}`, /artifact-handoff|workflow-memory/i);
});

test("agnostic core carries no harness-specific vocabulary or manifests", () => {
	assert.equal(existsSync(join(root, "plugins")), false, "the plugins/ wrapper must be gone; skills/ is canonical");
	for (const path of [join(root, "skills", ".codex-plugin"), join(root, "skills", ".claude-plugin"), join(root, ".agents"), join(root, ".claude-plugin"), join(root, "extensions")]) {
		assert.equal(existsSync(path), false, `marketplace/plugin/extension manifest must not exist: ${path}`);
	}
	assert.ok(existsSync(join(root, "skills", "_shared", "CHANGE.md")), "Change contract lives at skills/_shared/");
	assert.ok(existsSync(join(root, "skills", "_shared", "SESSION.md")), "Stage Session contract lives at skills/_shared/");
	assert.ok(existsSync(join(root, ".pi", "index.ts")), "the only harness-specific source is the Pi extension at .pi/");
});

test("GitHub CI is a least-privilege Node 20 verification gate", () => {
	const ci = readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf8");
	assert.match(ci, /pull_request:/);
	assert.match(ci, /push:/);
	assert.match(ci, /contents:\s*read/);
	assert.match(ci, /actions\/checkout@v4/);
	assert.match(ci, /actions\/setup-node@v4/);
	assert.match(ci, /node-version:\s*20/);
	assert.match(ci, /npm ci/);
	assert.match(ci, /npm run verify/);
	assert.doesNotMatch(ci, /publish|release|write/);
	assert.equal(existsSync(join(root, "CHANGELOG.md")), false);
});

test("project development uses branch-backed Changes and deterministic lifecycle state", () => {
	const readme = readFileSync(resolve(root, "README.md"), "utf8");
	const agents = readFileSync(resolve(root, "AGENTS.md"), "utf8");

	assert.equal(existsSync(resolve(root, "PROGRESS.md")), false, "root PROGRESS.md must remain absent");
	assert.equal(existsSync(resolve(root, "REPORT.md")), false, "provider comparison reports must not remain in the canonical project root");
	for (const policy of [readme, agents]) {
		assert.doesNotMatch(policy, /provider\/<harness>|freeze barrier|provider round|candidate implementation/i);
		assert.doesNotMatch(policy, /PROGRESS\.md/);
	}

	assert.match(agents, /must not.*(?:provider|harness).*worktree|do not.*(?:provider|harness).*worktree/is);
	assert.match(agents, /change inspect/is);
	assert.match(agents, /\.codepatrol\/changes\/<work-id>/);
	assert.match(readme, /codepatrol-plan.*plan\/spec\.md.*plan\/plan\.md/is);
	assert.match(readme, /codepatrol-review.*review\/report\.md/is);
	assert.match(readme, /codepatrol-apply.*apply\/journal\.md/is);
	assert.match(readme, /codepatrol-close/i);
	assert.match(readme, /\$codepatrol-plan/);
	assert.doesNotMatch(readme, /\/codepatrol:codepatrol-plan|marketplace/);
	assert.match(readme, /\$codepatrol-plan/);
});
