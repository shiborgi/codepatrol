import { rmSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist");
if (dirname(output) !== root || basename(output) !== "dist") throw new Error(`Refusing to clean unexpected build path: ${output}`);
rmSync(output, { recursive: true, force: true });
