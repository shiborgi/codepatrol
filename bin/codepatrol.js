#!/usr/bin/env node
import { runCli } from "../dist/src/cli.js";

const result = await runCli(process.argv);
if (result.stdout) {
  process.stdout.write(result.stdout);
}
if (result.stderr) {
  process.stderr.write(result.stderr);
}
process.exitCode = result.exitCode;
