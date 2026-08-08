import { runCli } from "./run-cli.js";

const code = await runCli(process.argv.slice(2), {
  io: {
    out(text) {
      process.stdout.write(text);
    },
    err(text) {
      process.stderr.write(text);
    },
  },
});
process.exitCode = code;
