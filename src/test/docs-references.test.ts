import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { isWaveId, isWorkId } from "../core/identifiers.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function markdownFiles(): string[] {
  const files = ["README.md"];
  const walk = (relative: string): void => {
    for (const entry of readdirSync(join(repoRoot, relative), { withFileTypes: true })) {
      const child = join(relative, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (entry.name.endsWith(".md")) files.push(child);
    }
  };
  walk("docs");
  walk("skills");
  return files;
}

/**
 * Citations that look like repository paths. A bare filename such as
 * `SKILL.md` names a convention rather than a location, and absolute or
 * remote references are not repository paths at all.
 */
function citedPaths(markdown: string): { line: number; path: string }[] {
  const cited: { line: number; path: string }[] = [];
  markdown.split("\n").forEach((raw, index) => {
    for (const match of raw.matchAll(/`([^`\n]+)`/g)) {
      const value = (match[1] as string).trim();
      if (!value.includes("/")) continue;
      if (value.startsWith("/") || value.startsWith("http") || value.startsWith("refs/")) continue;
      // `.codepatrol/` names the tree inside the state ref, never a path in the
      // checkout: it exists only while a working copy of that ref is expanded.
      if (value.startsWith(".codepatrol/")) continue;
      if (!/^[A-Za-z0-9_./-]+$/.test(value)) continue;
      cited.push({ line: index + 1, path: value.replace(/\/$/, "") });
    }
  });
  return cited;
}

/** Source paths are cited relative to the repository root or to `src/`. */
function resolves(cited: string): boolean {
  return existsSync(join(repoRoot, cited)) || existsSync(join(repoRoot, "src", cited));
}

function danglingReferences(markdown: string, source: string): string[] {
  return citedPaths(markdown)
    .filter((cited) => !resolves(cited.path))
    .map((cited) => `${source}:${cited.line}: ${cited.path} does not exist`);
}

function duplicateHeadings(markdown: string, source: string): string[] {
  const seen = new Map<string, number>();
  const duplicates: string[] = [];
  let fenced = false;
  markdown.split("\n").forEach((raw, index) => {
    if (raw.trim().startsWith("```")) {
      fenced = !fenced;
      return;
    }
    if (fenced) return;
    const match = /^(#{1,6})\s+(.*)$/.exec(raw);
    if (match === null) return;
    const key = `${(match[1] as string).length}|${(match[2] as string).trim()}`;
    const first = seen.get(key);
    if (first !== undefined) duplicates.push(`${source}:${index + 1}: heading repeats line ${first}`);
    else seen.set(key, index + 1);
  });
  return duplicates;
}

for (const relative of markdownFiles()) {
  test(`${relative} cites only paths that exist`, () => {
    const markdown = readFileSync(join(repoRoot, relative), "utf8");
    assert.deepEqual(danglingReferences(markdown, relative), []);
  });

  test(`${relative} has no repeated heading at the same level`, () => {
    const markdown = readFileSync(join(repoRoot, relative), "utf8");
    assert.deepEqual(duplicateHeadings(markdown, relative), []);
  });
}

test("the evolution loop's directories exist and declare their format", () => {
  for (const relative of ["docs/problems", "docs/evaluations"]) {
    const absolute = join(repoRoot, relative);
    assert.ok(existsSync(absolute) && statSync(absolute).isDirectory(), `${relative} exists`);
    const readme = readFileSync(join(absolute, "README.md"), "utf8");
    assert.match(readme, /## Record format/, `${relative}/README.md declares the record format`);
  }
});

/**
 * Identifiers written in prose are a contract too: a document showing the
 * grammar of a previous design teaches every reader the wrong one.
 */
function identifierViolations(markdown: string, source: string): string[] {
  const violations: string[] = [];
  markdown.split("\n").forEach((raw, index) => {
    // A two-component INIT id is the superseded Work grammar.
    for (const match of raw.matchAll(/\bINIT-(?:\d+|<[a-z]+>)\.(?:\d+|<[a-z]+>)/g)) {
      violations.push(`${source}:${index + 1}: ${match[0]} is not a Work id`);
    }
    for (const match of raw.matchAll(/\bWORK-[\w.<>-]+/g)) {
      const id = match[0].replace(/[.,)]+$/, "");
      if (id.includes("<")) continue;
      if (!isWorkId(id)) violations.push(`${source}:${index + 1}: ${id} is not a canonical Work id`);
    }
    for (const match of raw.matchAll(/\bWAVE-[\w.<>-]+/g)) {
      const id = match[0].replace(/[.,)]+$/, "");
      if (id.includes("<")) continue;
      if (!isWaveId(id)) violations.push(`${source}:${index + 1}: ${id} is not a canonical Wave id`);
    }
  });
  return violations;
}

for (const relative of markdownFiles()) {
  test(`${relative} writes identifiers in the canonical grammar`, () => {
    const markdown = readFileSync(join(repoRoot, relative), "utf8");
    assert.deepEqual(identifierViolations(markdown, relative), []);
  });
}

test("the superseded identifier grammar is reported wherever it appears", () => {
  const stale = ["Work ids look like `INIT-1.1`.", "Wave WAVE-1 groups them.", "Work WORK-01.1.1 is fine?"].join("\n");
  const violations = identifierViolations(stale, "synthetic.md");
  assert.equal(violations.length, 3, "the two-component id, the short Wave id and the padded Work id are all caught");
});

test("the Evolution Review procedure has the twelve steps architecture.md claims", () => {
  const architecture = readFileSync(join(repoRoot, "docs", "architecture.md"), "utf8");
  const claim = /Runs the (\d+)-step procedure defined in `skills\/codepatrol-spec\/SKILL\.md`/.exec(architecture);
  assert.ok(claim !== null, "architecture.md states how many steps the procedure has");
  const declared = Number(claim[1]);

  const skill = readFileSync(join(repoRoot, "skills", "codepatrol-spec", "SKILL.md"), "utf8");
  const section = skill.slice(skill.indexOf("## Evolution Review"));
  const steps = section.split("\n").filter((line) => /^\d+\. /.test(line));
  assert.equal(steps.length, declared, `the procedure has ${declared} steps`);

  // Line wrapping must not decide whether a keyword is present.
  const flattened = section.replace(/\s+/g, " ");
  const capabilities = readFileSync(join(repoRoot, "docs", "capabilities.md"), "utf8");
  const trigger = capabilities.slice(capabilities.indexOf("## Evolution Review trigger")).replace(/\s+/g, " ");
  const keywords = (trigger.match(/"[^"]+"/g) ?? []).map((k) => k.replace(/["]/g, "").replace(/,$/, "").trim());
  assert.ok(keywords.length > 0, "capabilities.md lists trigger keywords");
  for (const keyword of keywords) {
    assert.ok(flattened.includes(keyword), `the skill lists the trigger keyword ${JSON.stringify(keyword)}`);
  }
});

test("a dangling citation and a repeated heading are both reported", () => {
  const broken = ["# Title", "See `docs/nowhere/thing.md` for details.", "# Title"].join("\n");
  assert.deepEqual(danglingReferences(broken, "synthetic.md"), [
    "synthetic.md:2: docs/nowhere/thing.md does not exist",
  ]);
  assert.deepEqual(duplicateHeadings(broken, "synthetic.md"), ["synthetic.md:3: heading repeats line 1"]);
});
