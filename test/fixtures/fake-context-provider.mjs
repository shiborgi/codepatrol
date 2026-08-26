import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";

const [log] = process.argv.slice(2);
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
if (log) appendFileSync(log, `${JSON.stringify(request)}\n`);

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

const hash = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const empty = hash("");
const report = {
  schemaVersion: 1,
  provider: { name: "contextpatrol", version: "1.0.0" },
  requestDigest: hash(stableJson(request)),
  target: {
    kind: request.target?.kind ?? "commit",
    commit: request.target?.oid ?? "unknown",
    dirtyDigest: empty,
    contentDigest: empty,
  },
  budget: {
    maxOutputBytes: request.maxOutputBytes,
    outputBytes: 1,
    limited: false,
  },
};
const withDigest = { ...report, reportDigest: hash(stableJson(report)) };
process.stdout.write(JSON.stringify(withDigest));
