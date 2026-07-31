#!/usr/bin/env node
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const BUN_BINARY = process.env.GOODMEMORY_BUN_BINARY ?? "bun";
const MCP_ENTRYPOINT = resolve(SCRIPT_DIR, "../dist/bin/goodmemory-mcp.js");

const signalHandlers = new Map();
let child;

function removeSignalHandlers() {
  for (const [signal, handler] of signalHandlers) {
    process.off(signal, handler);
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  const handler = () => {
    child?.kill(signal);
  };
  signalHandlers.set(signal, handler);
  process.on(signal, handler);
}

child = spawn(
  BUN_BINARY,
  ["run", MCP_ENTRYPOINT, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

child.on("error", (error) => {
  removeSignalHandlers();
  if ("code" in error && error.code === "ENOENT") {
    console.error(
      [
        "GoodMemory MCP currently requires Bun.",
        "Install Bun or set GOODMEMORY_BUN_BINARY to a Bun executable before running `goodmemory-mcp`.",
      ].join(" "),
    );
    process.exit(1);
  }

  throw error;
});

child.on("exit", (code, signal) => {
  removeSignalHandlers();
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
