import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporary = mkdtempSync(resolve(tmpdir(), "codepatrol-installed-"));
const packed = JSON.parse(
  execFileSync("npm", ["pack", "--json", "--pack-destination", temporary], {
    cwd: root,
    encoding: "utf8",
  }),
)[0];
const archive = resolve(temporary, packed.filename);
const install = resolve(temporary, "install");
execFileSync("npm", ["install", "--prefix", install, archive], {
  cwd: root,
  stdio: "inherit",
});
execFileSync(process.execPath, [resolve(root, "scripts", "smoke.mjs")], {
  cwd: root,
  env: {
    ...process.env,
    CODEPATROL_BIN: resolve(install, "node_modules", ".bin", "codepatrol"),
  },
  stdio: "inherit",
});
