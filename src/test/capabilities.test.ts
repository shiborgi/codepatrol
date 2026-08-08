import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadProfile } from "../adapters/skill-catalog.js";
import { createApp, documentOf } from "./support/app.js";
import { createRepo } from "./support/repo.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const METHOD_STAGES = ["spec", "plan", "review", "build", "verify", "ship"] as const;
const HARNESS_DIRS = [
  [".opencode", "commands"],
  [".pi", "prompts"],
  [".claude", "commands"],
] as const;

// ── ROADMAP phase 1: the shipped foundation ──

test("the shared constitution exists and binds every clause the roadmap requires", () => {
  const text = readFileSync(join(repoRoot, "skills", "capabilities", "CONSTITUTION.md"), "utf8");
  for (const clause of [
    "Never own lifecycle state",
    "Never start or complete stages",
    "Never broaden Work scope",
    "Distinguish observation from inference",
    "Evidence before decision-impacting claims",
    "read/write boundaries",
    "local-first",
    "Never make remote projections authoritative",
  ]) {
    assert.ok(text.includes(clause), `constitution declares: ${clause}`);
  }
});

test("every catalogued capability is exactly capability.json plus SKILL.md", () => {
  const catalog = JSON.parse(readFileSync(join(repoRoot, "skills", "catalog.json"), "utf8")) as {
    capabilities: { id: string }[];
  };
  assert.ok(catalog.capabilities.length > 0, "the catalog carries at least one approved capability");
  for (const { id } of catalog.capabilities) {
    const dir = join(repoRoot, "skills", "capabilities", id);
    const entries = readdirSync(dir).sort();
    // Phase 0.3 content policy: no scripts/, references/, MCPs or downloads.
    assert.deepEqual(entries, ["SKILL.md", "capability.json"].sort(), `${id} carries only the two allowed files`);
  }
});

test("every catalogued capability declares the writing convention", () => {
  const catalog = JSON.parse(readFileSync(join(repoRoot, "skills", "catalog.json"), "utf8")) as {
    capabilities: { id: string }[];
  };
  for (const { id } of catalog.capabilities) {
    const text = readFileSync(join(repoRoot, "skills", "capabilities", id, "SKILL.md"), "utf8");
    for (const section of [
      "## Purpose",
      "## Applicable methods",
      "## Observable inputs",
      "## Procedure",
      "## Evidence format",
      "## Limits and prohibitions",
      "## When evidence is insufficient",
    ]) {
      assert.ok(text.includes(section), `${id} declares ${section}`);
    }
    assert.ok(text.includes("CONSTITUTION.md"), `${id} references the constitution`);
  }
});

test("the shipped profile resolves exactly what it declares, per method", () => {
  const declared = JSON.parse(readFileSync(join(repoRoot, "skills", "profiles", "core.json"), "utf8")) as {
    methods: Record<string, string[]>;
  };
  for (const [method, ids] of Object.entries(declared.methods)) {
    const resolved = loadProfile(repoRoot, method, "core");
    assert.deepEqual(
      resolved.capabilities.map((c) => c.id),
      [...ids].sort(),
      `${method} resolves exactly its declared capabilities, canonically sorted`,
    );
  }
  // Isolation: a method that declares none resolves none, and its composition
  // digest therefore differs from a method that declares some.
  const withNone = loadProfile(repoRoot, "ship", "core");
  const withSome = loadProfile(repoRoot, "verify", "core");
  assert.deepEqual(withNone.capabilities, [], "a capability of another method is not loaded");
  assert.ok(withSome.capabilities.length > 0, "verify carries the capabilities it declares");
  assert.notEqual(withSome.compositionDigest, withNone.compositionDigest, "each method has its own composition");
});

// ── ROADMAP phase 1: rejection rules (loadProfile already enforces them) ──

function scratchRepo(): { root: string; cleanup(): void } {
  const root = mkdtempSync(join(tmpdir(), "codepatrol-cap-"));
  mkdirSync(join(root, "skills", "profiles"), { recursive: true });
  mkdirSync(join(root, "skills", "capabilities"), { recursive: true });
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function writeCapability(root: string, id: string, manifest: unknown, instructions = "# skill\n"): void {
  const dir = join(root, "skills", "capabilities", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "capability.json"), JSON.stringify(manifest));
  writeFileSync(join(dir, "SKILL.md"), instructions);
}

function writeCatalogAndProfile(root: string, ids: string[], method = "verify"): void {
  writeFileSync(
    join(root, "skills", "catalog.json"),
    JSON.stringify({
      schemaVersion: 1,
      primaryMethods: [],
      capabilities: ids.map((id) => ({ id })),
    }),
  );
  writeFileSync(
    join(root, "skills", "profiles", "p.json"),
    JSON.stringify({
      schemaVersion: 1,
      id: "p",
      methods: { spec: [], plan: [], review: [], build: [], verify: [], ship: [], [method]: ids },
    }),
  );
}

test("a capability absent from the catalog is rejected", () => {
  const scratch = scratchRepo();
  try {
    writeCapability(scratch.root, "ghost", { schemaVersion: 1, id: "ghost", version: 1 });
    writeCatalogAndProfile(scratch.root, []);
    writeFileSync(
      join(scratch.root, "skills", "profiles", "p.json"),
      JSON.stringify({
        schemaVersion: 1,
        id: "p",
        methods: { spec: [], plan: [], review: [], build: [], verify: ["ghost"], ship: [] },
      }),
    );
    assert.throws(() => loadProfile(scratch.root, "verify", "p"), /not found in catalog/);
  } finally {
    scratch.cleanup();
  }
});

test("a manifest id that disagrees with its directory is rejected", () => {
  const scratch = scratchRepo();
  try {
    writeCapability(scratch.root, "declared", { schemaVersion: 1, id: "something-else", version: 1 });
    writeCatalogAndProfile(scratch.root, ["declared"]);
    assert.throws(() => loadProfile(scratch.root, "verify", "p"), /id mismatch/);
  } finally {
    scratch.cleanup();
  }
});

test("an invalid capability version is rejected", () => {
  const scratch = scratchRepo();
  try {
    writeCapability(scratch.root, "bad-version", { schemaVersion: 1, id: "bad-version", version: 0 });
    writeCatalogAndProfile(scratch.root, ["bad-version"]);
    assert.throws(() => loadProfile(scratch.root, "verify", "p"), /version must be a positive integer/);
  } finally {
    scratch.cleanup();
  }
});

test("editing SKILL.md or capability.json changes the composition digest", () => {
  const scratch = scratchRepo();
  try {
    writeCapability(scratch.root, "c", { schemaVersion: 1, id: "c", version: 1 }, "# one\n");
    writeCatalogAndProfile(scratch.root, ["c"]);
    const first = loadProfile(scratch.root, "verify", "p").compositionDigest;

    writeCapability(scratch.root, "c", { schemaVersion: 1, id: "c", version: 1 }, "# two\n");
    const afterSkill = loadProfile(scratch.root, "verify", "p").compositionDigest;
    assert.notEqual(afterSkill, first, "SKILL.md content is part of the digest");

    writeCapability(scratch.root, "c", { schemaVersion: 1, id: "c", version: 2 }, "# two\n");
    const afterManifest = loadProfile(scratch.root, "verify", "p").compositionDigest;
    assert.notEqual(afterManifest, afterSkill, "the manifest is part of the digest");
  } finally {
    scratch.cleanup();
  }
});

test("resolution is deterministic and independent of declaration order", () => {
  const scratch = scratchRepo();
  try {
    writeCapability(scratch.root, "a", { schemaVersion: 1, id: "a", version: 1 });
    writeCapability(scratch.root, "b", { schemaVersion: 1, id: "b", version: 1 });
    writeCatalogAndProfile(scratch.root, ["a", "b"]);
    const forward = loadProfile(scratch.root, "verify", "p");
    writeCatalogAndProfile(scratch.root, ["b", "a"]);
    const reversed = loadProfile(scratch.root, "verify", "p");
    assert.equal(reversed.compositionDigest, forward.compositionDigest, "order does not change the digest");
    assert.deepEqual(
      reversed.capabilities.map((c) => c.id),
      ["a", "b"],
      "capabilities are canonically sorted",
    );
  } finally {
    scratch.cleanup();
  }
});

// ── ROADMAP phase 0: the loading contract in every harness ──

for (const [dir, sub] of HARNESS_DIRS) {
  test(`${dir}/${sub} templates declare the capability loading contract`, () => {
    for (const stage of METHOD_STAGES) {
      const path = join(repoRoot, dir, sub, `codepatrol-${stage}.md`);
      assert.ok(existsSync(path), `${path} exists`);
      const text = readFileSync(path, "utf8");
      assert.ok(text.includes("Capability contract"), `${stage}: declares the contract`);
      assert.ok(text.includes("takes precedence"), `${stage}: the primary method prevails`);
      assert.ok(text.includes("do not load capabilities for other methods"), `${stage}: other methods are excluded`);
      assert.ok(text.includes("--profile"), `${stage}: names the flag that triggers loading`);
    }
  });
}

test("a declared composition is recorded on the attempt and refuses a divergent resume", async () => {
  const repo = createRepo();
  try {
    const app = createApp(repo.path);
    const { runId } = await app.specStart("INIT-1");
    await app.specComplete("INIT-1", runId, "apply", documentOf());

    const composition = loadProfile(repoRoot, "plan", "core");
    const started = await app.works.start("WORK-1.1.1", "plan", {
      harness: "test",
      todo: [{ id: "t1", title: "do one" }],
      profile: composition.profile,
      capabilities: composition.capabilities,
      compositionDigest: composition.compositionDigest,
    });
    assert.equal(started.attempt.execution.profile, "core");
    assert.equal(started.attempt.execution.compositionDigest, composition.compositionDigest);

    // Same inputs resume the same attempt.
    const resumed = await app.works.start("WORK-1.1.1", "plan", {
      harness: "test",
      todo: [{ id: "t1", title: "do one" }],
      profile: composition.profile,
      capabilities: composition.capabilities,
      compositionDigest: composition.compositionDigest,
    });
    assert.equal(resumed.resumed, true);
    assert.equal(resumed.attempt.runId, started.attempt.runId);

    // A different composition is refused rather than silently adopted.
    await assert.rejects(
      app.works.start("WORK-1.1.1", "plan", {
        harness: "test",
        todo: [{ id: "t1", title: "do one" }],
        profile: composition.profile,
        capabilities: [{ id: "evidence-discipline", version: 1, digest: "f".repeat(64) }],
        compositionDigest: "e".repeat(64),
      }),
      /different execution contract; refusing resume/,
    );
  } finally {
    repo.cleanup();
  }
});

// ── Profile resolution rules, exercised against a scratch repository ──

test("a composition digest is stable across calls and is a full-length hash", () => {
  const first = loadProfile(repoRoot, "plan", "core");
  const second = loadProfile(repoRoot, "plan", "core");
  assert.equal(first.compositionDigest, second.compositionDigest, "resolution is a pure function of content");
  assert.match(first.compositionDigest, /^[0-9a-f]{64}$/, "the digest is a full-length hash");
});

test("a profile that declares the same capability twice is rejected", () => {
  const scratch = scratchRepo();
  try {
    writeCapability(scratch.root, "cap1", { schemaVersion: 1, id: "cap1", version: 1 });
    writeCatalogAndProfile(scratch.root, ["cap1", "cap1"], "plan");
    assert.throws(() => loadProfile(scratch.root, "plan", "p"), /duplicate capability cap1/);
  } finally {
    scratch.cleanup();
  }
});

test("a method the profile does not define is rejected rather than resolved as empty", () => {
  const scratch = scratchRepo();
  try {
    writeCapability(scratch.root, "cap1", { schemaVersion: 1, id: "cap1", version: 1 });
    writeCatalogAndProfile(scratch.root, ["cap1"], "plan");
    assert.throws(() => loadProfile(scratch.root, "unknown" as never, "p"), /does not define method unknown/);
  } finally {
    scratch.cleanup();
  }
});

test("a profile carrying a key that is not a method is rejected", () => {
  const scratch = scratchRepo();
  try {
    writeCapability(scratch.root, "cap1", { schemaVersion: 1, id: "cap1", version: 1 });
    writeFileSync(
      join(scratch.root, "skills", "catalog.json"),
      JSON.stringify({ schemaVersion: 1, primaryMethods: [], capabilities: [{ id: "cap1" }] }),
    );
    for (const badKey of ["improve", "Plan", "planning"]) {
      writeFileSync(
        join(scratch.root, "skills", "profiles", "p.json"),
        JSON.stringify({
          schemaVersion: 1,
          id: "p",
          methods: { spec: [], plan: ["cap1"], review: [], build: [], verify: [], ship: [], [badKey]: [] },
        }),
      );
      assert.throws(
        () => loadProfile(scratch.root, "plan", "p"),
        new RegExp(`unknown method ${JSON.stringify(badKey)}`),
        `rejects ${badKey}`,
      );
    }
  } finally {
    scratch.cleanup();
  }
});

test("the resolved capability version comes from its manifest", () => {
  const scratch = scratchRepo();
  try {
    writeCapability(scratch.root, "cap1", { schemaVersion: 1, id: "cap1", version: 5 });
    writeCatalogAndProfile(scratch.root, ["cap1"], "plan");
    const resolved = loadProfile(scratch.root, "plan", "p");
    assert.equal(resolved.capabilities[0]?.version, 5);
  } finally {
    scratch.cleanup();
  }
});
