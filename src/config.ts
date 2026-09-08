import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { type Config, configSchema } from "./contracts.js";

export interface ConfigLocation {
  root: string;
  config?: string;
}

export async function readJsonFile(
  path: string,
  maxBytes = 1_048_576,
): Promise<unknown> {
  const file = await open(path, "r");
  try {
    if ((await file.stat()).size > maxBytes)
      throw new Error("JSON file exceeds byte limit");
    const bytes = Buffer.alloc(maxBytes + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, null);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset > maxBytes) throw new Error("JSON file exceeds byte limit");
    return JSON.parse(bytes.subarray(0, offset).toString("utf8"));
  } finally {
    await file.close();
  }
}

export async function loadConfig(input: ConfigLocation): Promise<Config> {
  const path = resolve(input.root, input.config ?? "codepatrol.json");
  try {
    return configSchema.parse(await readJsonFile(path));
  } catch (error) {
    if (!input.config && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return configSchema.parse({ protocolVersion: "1.0" });
    }
    throw error;
  }
}
