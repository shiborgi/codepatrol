import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";

const [mode = "valid", log] = process.argv.slice(2);
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
if (log) appendFileSync(log, `${JSON.stringify(request)}\n`);

if (mode === "exit") process.exit(7);
if (mode === "sleep") await new Promise((resolve) => setTimeout(resolve, 1_000));
if (mode === "spawn-descendant") {
  spawn(process.execPath, ["-e", "setTimeout(() => {}, 1000)"], {
    stdio: ["ignore", process.stdout, process.stderr],
  });
  process.exit(0);
}
if (mode === "malformed") {
  process.stdout.write("not-json");
  process.exit(0);
}
if (mode === "oversized") {
  await new Promise((resolve) => process.stdout.write("x".repeat(600 * 1024), resolve));
  process.exit(0);
}

const reference = mode === "mismatch-reference" ? "other/agent" : request.reference;
const version = mode === "mismatch-version" ? "9.9.9" : request.version;
const instructions =
  mode === "empty-instructions"
    ? ""
    : mode === "multibyte-instructions"
      ? "😀".repeat(100_000)
      : `Instructions for ${request.reference}@${request.version}`;
const hash = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const response = {
  schemaVersion: 1,
  agent: {
    reference,
    name: reference.split("/").at(-1),
    version,
    digest:
      mode === "bad-plugin-digest" ? "invalid" : hash(`plugin:${reference}@${version}`),
  },
  instructionsDigest:
    mode === "bad-instructions-digest"
      ? `sha256:${"0".repeat(64)}`
      : hash(instructions),
  instructions,
};
process.stdout.write(JSON.stringify(response));
