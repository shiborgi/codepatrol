#!/usr/bin/env node
import { runPiExecutorCli } from "../dist/src/executors/pi.js";

process.exitCode = await runPiExecutorCli();
