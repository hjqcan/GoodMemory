#!/usr/bin/env bun

import {
  runC6SourceV4BoundedActivationCli,
} from "./codex-coding-effect/c6-source-v4-bounded-activation";

await runC6SourceV4BoundedActivationCli().catch((error: unknown) => {
  const message = error instanceof Error
    ? error.message
    : "unknown C6 source-v4 bounded activation error";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
