import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "codepatrol-installed-v1-"));
function invoke(argv, cwd = process.cwd()) {
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd,
    encoding: "utf8",
    timeout: 180_000,
    maxBuffer: 16_777_216,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}
try {
  const [artifact] = JSON.parse(
    invoke([
      "npm",
      "pack",
      "--json",
      "--ignore-scripts",
      "--pack-destination",
      directory,
    ]),
  );
  assert.equal(artifact.version, "1.0.0");
  assert.ok(artifact.files.some((file) => file.path === "dist/src/index.d.ts"));
  assert.ok(
    !artifact.files.some(
      (file) =>
        file.path.startsWith("dist/test/") || file.path.startsWith("contracts/"),
    ),
  );
  invoke([
    "npm",
    "install",
    "--prefix",
    directory,
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    join(directory, artifact.filename),
  ]);
  const installed = join(directory, "node_modules/codepatrol");
  const exportsCheck = invoke(
    [
      process.execPath,
      "--input-type=module",
      "-e",
      "import {VERSION, plan} from 'codepatrol'; if(VERSION !== '1.0.0' || typeof plan !== 'function') process.exit(1)",
    ],
    directory,
  );
  assert.equal(exportsCheck, "");
  process.stdout.write(
    invoke([
      process.execPath,
      resolve("scripts/smoke.mjs"),
      join(installed, "bin/codepatrol.js"),
      join(installed, "dist/src/index.js"),
    ]),
  );
  assert.match(
    invoke([join(directory, "node_modules/.bin/codepatrol"), "--version"]),
    /1\.0\.0/,
  );
  process.stdout.write(
    "Installed package smoke: exports, declarations, npm binary, full lifecycle passed\n",
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
