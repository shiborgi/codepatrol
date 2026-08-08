import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as api from "../index.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * The published surface, as data. Adding an export is a deliberate act that
 * updates this list; it can never happen by re-export drift.
 */
const PUBLISHED_VALUES = ["runCli", "CodepatrolError", "DOCUMENT_TYPE", "parseDocument"].concat([
  "initiativeIdOf",
  "isInitiativeId",
  "isWaveId",
  "isWorkId",
  "parseInitiativeId",
  "parseWaveId",
  "parseWorkId",
  "waveIdOf",
]);

const PUBLISHED_TYPES = [
  "CliIO",
  "RunCliOptions",
  "ErrorCode",
  "SpecDocument",
  "WorkDefinition",
  "AttemptResult",
  "Stage",
  "Work",
  "TodoItem",
  "ImprovementReport",
];

test("the runtime exports are exactly the published ones", () => {
  assert.deepEqual(Object.keys(api).sort(), [...PUBLISHED_VALUES].sort());
});

test("the type exports are exactly the published ones", () => {
  const source = readFileSync(join(repoRoot, "src", "index.ts"), "utf8");
  const exported = new Set<string>();
  for (const match of source.matchAll(/export type \{([^}]+)\}/g)) {
    for (const name of (match[1] as string).split(",")) {
      const clean = name.trim();
      if (clean !== "") exported.add(clean);
    }
  }
  assert.deepEqual([...exported].sort(), [...PUBLISHED_TYPES].sort());
});

test("the published parser and the published CLI come from the same package entry", async () => {
  assert.equal(typeof api.runCli, "function");
  assert.equal(typeof api.parseDocument, "function");
  assert.equal(api.DOCUMENT_TYPE, "codepatrol-initiative-document");
  assert.throws(() => api.parseDocument({}), api.CodepatrolError);
});

test("--version reports the manifest version, not a constant", async () => {
  const out: string[] = [];
  const code = await api.runCli(["--version"], {
    io: { out: (text) => out.push(text), err: () => {} },
    lock: false,
  });
  const manifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { version: string };
  assert.equal(code, 0);
  assert.equal(out.join("").trim(), manifest.version);
});

test("the packaged TypeScript consumer only imports published names", () => {
  const workflow = readFileSync(join(repoRoot, ".github", "workflows", "verify.yml"), "utf8");
  const consumer = workflow.slice(workflow.indexOf("Validate TypeScript consumer"));
  const imports = [...consumer.matchAll(/import \{([^}]+)\} from "codepatrol"/g)];
  assert.ok(imports.length > 0, "the workflow still validates a TypeScript consumer");
  const published = new Set([...PUBLISHED_VALUES, ...PUBLISHED_TYPES]);
  for (const match of imports) {
    for (const name of (match[1] as string).split(",")) {
      const clean = name.replace(/^\s*type\s+/, "").trim();
      if (clean === "") continue;
      assert.ok(published.has(clean), `the consumer imports ${clean}, which the package publishes`);
    }
  }
});
