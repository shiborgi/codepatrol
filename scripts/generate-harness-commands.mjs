#!/usr/bin/env node
// Writes the harness command files from the single shared source in
// skills/harness/. Run with --check to report drift without writing.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { renderHarnessCommands } from "../dist/adapters/harness-templates.js";

const repoRoot = process.cwd();
const check = process.argv.includes("--check");
const rendered = renderHarnessCommands(repoRoot);

const drifted = [];
for (const [relative, content] of rendered) {
  const absolute = join(repoRoot, relative);
  let current = null;
  try {
    current = readFileSync(absolute, "utf8");
  } catch {
    current = null;
  }
  if (current === content) continue;
  drifted.push(relative);
  if (check) continue;
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

if (check && drifted.length > 0) {
  console.error(`harness commands differ from skills/harness/:\n${drifted.map((f) => `  ${f}`).join("\n")}`);
  process.exit(1);
}
console.log(
  check
    ? `harness commands in sync (${rendered.size} files)`
    : `wrote ${drifted.length} of ${rendered.size} harness command files`,
);
