import { createHash } from "node:crypto";

export function canonicalJson(value: unknown): string {
  return `${stringify(value)}\n`;
}

function stringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stringify(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  const body = keys.map((key) => `${JSON.stringify(key)}:${stringify(record[key])}`).join(",");
  return `{${body}}`;
}

export function prettyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
