import { existsSync, readFileSync } from "node:fs";

const packageUrl = new URL("../package.json", import.meta.url);
if (!existsSync(packageUrl))
  packageUrl.href = new URL("../../package.json", import.meta.url).href;
export const VERSION = (
  JSON.parse(readFileSync(packageUrl, "utf8")) as { version: string }
).version;
