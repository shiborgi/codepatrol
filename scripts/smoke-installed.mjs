import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
      "--cache",
      join(directory, "cache"),
    ]),
  );
  assert.equal(artifact.version, "1.0.0");
  assert.ok(artifact.files.some((file) => file.path === "dist/src/index.d.ts"));
  for (const path of [
    "bin/codepatrol-pi-executor.js",
    "dist/src/executors/pi.js",
    "integrations/pi/index.mjs",
  ])
    assert.ok(
      artifact.files.some((file) => file.path === path),
      `${path} missing`,
    );
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
    "--cache",
    join(directory, "cache"),
    join(directory, artifact.filename),
  ]);
  const installed = join(directory, "node_modules/codepatrol");
  const installedManifest = JSON.parse(
    await readFile(join(installed, "package.json"), "utf8"),
  );
  assert.deepEqual(installedManifest.pi?.extensions, ["./integrations/pi/index.mjs"]);
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
  assert.equal(
    invoke(
      [
        process.execPath,
        "--input-type=module",
        "-e",
        "import extension from 'codepatrol/pi'; const commands=[]; const tools=[]; extension({registerCommand:(name)=>commands.push(name),registerTool:(tool)=>tools.push(tool.name)}); if(JSON.stringify({commands,tools}) !== JSON.stringify({commands:['patrol'],tools:[]})) process.exit(1)",
      ],
      directory,
    ),
    "",
  );
  process.stdout.write(
    "Installed package smoke: exports, declarations, npm binary, full lifecycle passed\n",
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
