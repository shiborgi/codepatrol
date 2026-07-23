import assert from "node:assert/strict";
import test from "node:test";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { __internal, destinations, install, parseInstallerArgs, uninstall, verify } from "./install-lib.mjs";

delete process.env.XDG_CONFIG_HOME;

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "codepatrol-install-root-"));
	const home = mkdtempSync(join(tmpdir(), "codepatrol-install-home-"));
	mkdirSync(join(root, "skills", "alpha"), { recursive: true });
	writeFileSync(join(root, "skills", "alpha", "SKILL.md"), "---\nname: alpha\ndescription: test\n---\n");
	return { root, home };
}

/**
 * Run the body with a fake `codepatrol` executable placed in front of PATH
 * so `verify()` can always resolve it without depending on a globally
 * installed CLI. Returns the body result and restores PATH afterwards.
 */
function withFakeCodepatrolBin(home, body) {
	const previousPath = process.env.PATH;
	const bin = join(home, "bin");
	mkdirSync(bin, { recursive: true });
	const stub = join(bin, "codepatrol");
	writeFileSync(stub, "#!/bin/sh\nexit 0\n");
	chmodSync(stub, 0o755);
	process.env.PATH = `${bin}${previousPath ? `:${previousPath}` : ""}`;
	try {
		return body();
	} finally {
		process.env.PATH = previousPath;
	}
}

test("all harnesses deduplicate the shared Agent Skills destination and add OpenCode commands", () => {
	const map = destinations("/home/test", parseInstallerArgs(["--harness", "all"]).harnesses);
	assert.equal(map.size, 4);
	assert.equal(map.get("shared"), "/home/test/.agents/skills");
	assert.equal(map.get("opencode-commands"), "/home/test/.config/opencode/commands");
	assert.equal(destinations("/home/test", ["pi"]).size, 0, "Pi discovers skills from its package");
});

test("opencode-only destinations carry commands and honor XDG_CONFIG_HOME", () => {
	const map = destinations("/home/test", ["opencode"]);
	assert.equal(map.size, 2, "command destination plus the shared skill destination");
	assert.equal(map.get("opencode-commands"), "/home/test/.config/opencode/commands");
	process.env.XDG_CONFIG_HOME = "/custom/cfg";
	const moved = destinations("/home/test", ["opencode"]);
	assert.equal(moved.get("opencode-commands"), "/custom/cfg/opencode/commands");
	delete process.env.XDG_CONFIG_HOME;
});

test("installer accepts the documented harness aliases", () => {
	assert.deepEqual(parseInstallerArgs(["--harness", "claude-code"]).harnesses, ["claude"]);
	assert.deepEqual(parseInstallerArgs(["--harness", "kiro"]).harnesses, ["kiro-ide"]);
});

test("install is idempotent and uninstall removes only owned links", () => {
	const { root, home } = fixture();
	try {
		const options = { root, home, harnesses: ["codex"], dryRun: false };
		install(options);
		install(options);
		const target = join(home, ".agents", "skills", "alpha");
		assert.ok(lstatSync(target).isSymbolicLink());
		assert.equal(resolve(join(target, ".."), readlinkSync(target)), join(root, "skills", "alpha"));
		uninstall(options);
		assert.equal(existsSync(target), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
	}
});

test("re-install heals a stale link left by an in-repo rename", () => {
	const { root, home } = fixture();
	try {
		const options = { root, home, harnesses: ["codex"], dryRun: false };
		install(options); // registers this root in the registry
		const target = join(home, ".agents", "skills", "alpha");
		// Simulate a link from a previous layout: same root, obsolete sub-path.
		unlinkSync(target);
		symlinkSync(join(root, "plugins", "codepatrol", "skills", "alpha"), target, "dir");
		const output = install(options);
		assert.ok(output.some((line) => line.startsWith("relinked")), "stale owned link is relinked");
		assert.equal(resolve(join(target, ".."), readlinkSync(target)), join(root, "skills", "alpha"));
	} finally {
		rmSync(root, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
	}
});

test("uninstall removes a broken link that still points inside an owned root", () => {
	const { root, home } = fixture();
	try {
		const options = { root, home, harnesses: ["codex"], dryRun: false };
		install(options);
		const target = join(home, ".agents", "skills", "alpha");
		unlinkSync(target);
		symlinkSync(join(root, "obsolete", "alpha"), target, "dir"); // broken, but under the owned root
		uninstall(options);
		assert.equal(existsSync(join(home, ".agents", "skills", "alpha")), false);
		assert.ok(lstatSync(target, { throwIfNoEntry: false }) === undefined, "broken owned link is gone");
	} finally {
		rmSync(root, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
	}
});

test("installer still refuses a symlink that points outside every owned root", () => {
	const { root, home } = fixture();
	const foreign = mkdtempSync(join(tmpdir(), "codepatrol-foreign-"));
	try {
		const target = join(home, ".agents", "skills", "alpha");
		mkdirSync(dirname(target), { recursive: true });
		symlinkSync(foreign, target, "dir");
		assert.throws(() => install({ root, home, harnesses: ["codex"], dryRun: false }), /non-Codepatrol path/);
	} finally {
		rmSync(root, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
		rmSync(foreign, { recursive: true, force: true });
	}
});

test("with a catalog, only the public (primary) workflows are linked", () => {
	const { root, home } = fixture(); // provides support skill "alpha"
	try {
		mkdirSync(join(root, "skills", "codepatrol-plan"), { recursive: true });
		writeFileSync(join(root, "skills", "codepatrol-plan", "SKILL.md"), "---\nname: codepatrol-plan\ndescription: t\n---\n");
		writeFileSync(join(root, "skills", "catalog.yaml"), "version: 1\nskills:\n  codepatrol-plan:\n    role: primary\n  alpha:\n    role: support\n");
		install({ root, home, harnesses: ["codex"] });
		assert.ok(existsSync(join(home, ".agents", "skills", "codepatrol-plan")), "the primary workflow is linked");
		assert.equal(existsSync(join(home, ".agents", "skills", "alpha")), false, "support skills are not linked");
		uninstall({ root, home, harnesses: ["codex"] });
		assert.equal(existsSync(join(home, ".agents", "skills", "codepatrol-plan")), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
	}
});

test("dry-run performs no writes", () => {
	const { root, home } = fixture();
	try {
		const output = install({ root, home, harnesses: ["codex"], dryRun: true });
		assert.ok(output.some((line) => line.startsWith("would link")));
		assert.equal(existsSync(join(home, ".agents")), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
	}
});

test("shared links remain until the last shared harness is uninstalled", () => {
	const { root, home } = fixture();
	try {
		install({ root, home, harnesses: ["codex", "opencode"] });
		const target = join(home, ".agents", "skills", "alpha");
		uninstall({ root, home, harnesses: ["codex"] });
		assert.ok(lstatSync(target).isSymbolicLink());
		uninstall({ root, home, harnesses: ["opencode"] });
		assert.equal(existsSync(target), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
	}
});

test("opencode install links primary slash commands as files next to shared skills as directories", () => {
	const { root, home } = fixture();
	try {
		mkdirSync(join(root, "skills", "codepatrol-plan"), { recursive: true });
		writeFileSync(join(root, "skills", "codepatrol-plan", "SKILL.md"), "---\nname: codepatrol-plan\ndescription: t\n---\n");
		mkdirSync(join(root, ".opencode", "commands"), { recursive: true });
		writeFileSync(join(root, ".opencode", "commands", "codepatrol-plan.md"), "---\ndescription: t\n---\nbody\n");
		writeFileSync(join(root, ".opencode", "commands", "ignore-me.md"), "---\ndescription: t\n---\nbody\n");
		writeFileSync(join(root, "skills", "catalog.yaml"), "version: 1\nskills:\n  codepatrol-plan:\n    role: primary\n  alpha:\n    role: support\n");

		install({ root, home, harnesses: ["opencode"] });
		const skill = join(home, ".agents", "skills", "codepatrol-plan");
		const command = join(home, ".config", "opencode", "commands", "codepatrol-plan.md");
		assert.ok(lstatSync(skill).isSymbolicLink(), "primary skill is linked under shared skills");
		assert.ok(lstatSync(command).isSymbolicLink(), "command template is linked");
		assert.equal(resolve(join(skill, ".."), readlinkSync(skill)), join(root, "skills", "codepatrol-plan"));
		assert.equal(resolve(join(command, ".."), readlinkSync(command)), join(root, ".opencode", "commands", "codepatrol-plan.md"));
		assert.equal(existsSync(join(home, ".config", "opencode", "commands", "ignore-me.md")), false, "non-codepatrol and non-primary commands are not linked");
		assert.equal(existsSync(join(home, ".agents", "skills", "alpha")), false, "support skill stays out of the shared destination");

		withFakeCodepatrolBin(home, () => {
			const result = verify({ root, home, harnesses: ["opencode"] });
			assert.equal(result.ok, true, result.output.join("\n"));
		});

		uninstall({ root, home, harnesses: ["opencode"] });
		assert.equal(existsSync(command), false, "command link is removed on uninstall");
		assert.equal(existsSync(skill), false, "shared skill link is removed on uninstall");
	} finally {
		rmSync(root, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
	}
});

test("installer refuses to overwrite a user-owned path", () => {
	const { root, home } = fixture();
	try {
		const target = join(home, ".agents", "skills", "alpha");
		mkdirSync(target, { recursive: true });
		assert.throws(() => install({ root, home, harnesses: ["codex"] }), /Refusing to overwrite/);
		assert.ok(lstatSync(target).isDirectory());
	} finally {
		rmSync(root, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
	}
});

test("dry-run reports every conflict at once and writes nothing", () => {
	const { root, home } = fixture();
	try {
		mkdirSync(join(root, "skills", "beta"), { recursive: true });
		writeFileSync(join(root, "skills", "beta", "SKILL.md"), "---\nname: beta\ndescription: test\n---\n");
		mkdirSync(join(home, ".agents", "skills", "alpha"), { recursive: true });
		mkdirSync(join(home, ".agents", "skills", "beta"), { recursive: true });
		const output = install({ root, home, harnesses: ["codex"], dryRun: true });
		const conflicts = output.filter((line) => line.startsWith("conflict "));
		assert.equal(conflicts.length, 2, "both conflicts are listed, not just the first");
		assert.equal(existsSync(join(home, ".codepatrol", "install.json")), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
	}
});

test("installer preflights every destination before creating any link", () => {
	const { root, home } = fixture();
	try {
		mkdirSync(join(root, "skills", "beta"), { recursive: true });
		writeFileSync(join(root, "skills", "beta", "SKILL.md"), "---\nname: beta\ndescription: test\n---\n");
		const conflict = join(home, ".agents", "skills", "beta");
		mkdirSync(conflict, { recursive: true });

		assert.throws(() => install({ root, home, harnesses: ["codex"] }), /Refusing to overwrite/);
		assert.equal(existsSync(join(home, ".agents", "skills", "alpha")), false);
		assert.equal(existsSync(join(home, ".codepatrol", "install.json")), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
	}
});

test("failed Pi registration rolls back links and leaves the registry unchanged", () => {
	const { root, home } = fixture();
	const oldPath = process.env.PATH;
	try {
		const bin = join(home, "bin");
		mkdirSync(bin, { recursive: true });
		const pi = join(bin, "pi");
		writeFileSync(pi, "#!/bin/sh\nexit 7\n");
		chmodSync(pi, 0o755);
		process.env.PATH = `${bin}:${oldPath ?? ""}`;

		assert.throws(() => install({ root, home, harnesses: ["pi"] }), /pi install failed/);
		assert.equal(existsSync(join(home, ".agents", "skills", "alpha")), false);
		assert.equal(existsSync(join(home, ".codepatrol", "install.json")), false);
	} finally {
		process.env.PATH = oldPath;
		rmSync(root, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
	}
});

test("verify checks the CLI and native Pi package registration without duplicate skill links", () => {
	const { root, home } = fixture();
	const oldPath = process.env.PATH;
	try {
		const bin = join(home, "bin");
		mkdirSync(bin, { recursive: true });
		for (const [name, body] of [
			["codepatrol", "#!/bin/sh\nexit 0\n"],
			["pi", `#!/bin/sh\nif [ "$1" = "list" ]; then printf '%s\\n' '${root}'; fi\nexit 0\n`],
		]) {
			const path = join(bin, name);
			writeFileSync(path, body);
			chmodSync(path, 0o755);
		}
		process.env.PATH = `${bin}:${oldPath ?? ""}`;
		install({ root, home, harnesses: ["pi"] });

		const result = verify({ root, home, harnesses: ["pi"] });
		assert.equal(result.ok, true, result.output.join("\n"));
		assert.ok(result.output.some((line) => line.includes("Pi local package")));
		assert.equal(existsSync(join(home, ".agents", "skills", "alpha")), false);
	} finally {
		process.env.PATH = oldPath;
		rmSync(root, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
	}
});

test("failed Pi removal leaves the package registry installed", () => {
	const { root, home } = fixture();
	const oldPath = process.env.PATH;
	try {
		const bin = join(home, "bin");
		mkdirSync(bin, { recursive: true });
		const pi = join(bin, "pi");
		writeFileSync(pi, "#!/bin/sh\nif [ \"$1\" = \"remove\" ]; then exit 7; fi\nexit 0\n");
		chmodSync(pi, 0o755);
		process.env.PATH = `${bin}:${oldPath ?? ""}`;
		install({ root, home, harnesses: ["pi"] });

		assert.throws(() => uninstall({ root, home, harnesses: ["pi"] }), /pi remove failed/);
		assert.equal(existsSync(join(home, ".agents", "skills", "alpha")), false);
		const registry = readFileSync(join(home, ".codepatrol", "install.json"), "utf8");
		assert.match(registry, /"pi"/);
	} finally {
		process.env.PATH = oldPath;
		rmSync(root, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
	}
});

test("linkTypeFor rejects unsupported source kinds", () => {
	const root = mkdtempSync(join(tmpdir(), "codepatrol-linktype-"));
	try {
		writeFileSync(join(root, "file.txt"), "x");
		mkdirSync(join(root, "sub"));
		assert.equal(__internal.linkTypeFor(join(root, "file.txt")), "file");
		assert.equal(__internal.linkTypeFor(join(root, "sub")), "dir");
		// A path whose lstat is neither a regular file nor a directory
		// (e.g. a dangling symlink target) must surface as an error rather
		// than silently fall through to "dir".
		symlinkSync(join(root, "missing-target"), join(root, "dangling"), "file");
		assert.throws(() => __internal.linkTypeFor(join(root, "dangling")), /Refusing to symlink unsupported source type/);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("install creates a file-kind OpenCode command link and the skill link as a directory", () => {
	const { root, home } = fixture();
	try {
		mkdirSync(join(root, "skills", "codepatrol-plan"), { recursive: true });
		writeFileSync(join(root, "skills", "codepatrol-plan", "SKILL.md"), "---\nname: codepatrol-plan\ndescription: t\n---\n");
		mkdirSync(join(root, ".opencode", "commands"), { recursive: true });
		writeFileSync(join(root, ".opencode", "commands", "codepatrol-plan.md"), "---\ndescription: t\n---\nbody\n");
		writeFileSync(join(root, "skills", "catalog.yaml"), "version: 1\nskills:\n  codepatrol-plan:\n    role: primary\n  alpha:\n    role: support\n");
		install({ root, home, harnesses: ["opencode"] });
		const skill = join(home, ".agents", "skills", "codepatrol-plan");
		const command = join(home, ".config", "opencode", "commands", "codepatrol-plan.md");
		assert.ok(lstatSync(skill).isSymbolicLink(), "skill is a symlink");
		assert.ok(lstatSync(command).isSymbolicLink(), "command is a symlink");
		assert.equal(resolve(join(skill, ".."), readlinkSync(skill)), join(root, "skills", "codepatrol-plan"));
		assert.equal(resolve(join(command, ".."), readlinkSync(command)), join(root, ".opencode", "commands", "codepatrol-plan.md"));
		// The installer also records the linkType so uninstall/rollback can
		// recreate the correct kind without inspecting the source.
	} finally {
		rmSync(root, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
	}
});

