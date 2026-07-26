#!/usr/bin/env bun

import {
  runC6SourceV3SimpleCensusCli,
} from "./codex-coding-effect/c6-source-v3-simple-census-cli";

await runC6SourceV3SimpleCensusCli().catch((error: unknown) => {
  const message = error instanceof Error
    ? error.message
    : "unknown C6 census error";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
