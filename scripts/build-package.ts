#!/usr/bin/env bun
import { mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const DIST_DIR = join(REPO_ROOT, "dist");

await rm(DIST_DIR, { recursive: true, force: true });
await mkdir(DIST_DIR, { recursive: true });

const inspectorBuild = Bun.spawn(
  ["bun", "run", "build"],
  {
    cwd: join(REPO_ROOT, "apps", "inspector-web"),
    stderr: "inherit",
    stdout: "inherit",
  },
);
if ((await inspectorBuild.exited) !== 0) {
  process.exit(1);
}

const result = await Bun.build({
  entrypoints: [
    join(REPO_ROOT, "src/index.ts"),
    join(REPO_ROOT, "src/ai-sdk/index.ts"),
    join(REPO_ROOT, "src/host/index.ts"),
    join(REPO_ROOT, "src/http/index.ts"),
    join(REPO_ROOT, "src/runtime-kit/index.ts"),
  ],
  external: ["bun", "bun:sqlite"],
  format: "esm",
  minify: true,
  naming: "[dir]/[name].js",
  outdir: DIST_DIR,
  splitting: true,
  target: "node",
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }

  process.exit(1);
}

const binResult = await Bun.build({
  entrypoints: [
    join(REPO_ROOT, "scripts/goodmemory-cli.ts"),
    join(REPO_ROOT, "scripts/goodmemory-http-bridge.ts"),
    join(REPO_ROOT, "scripts/goodmemory-mcp.ts"),
  ],
  external: ["bun", "bun:sqlite"],
  format: "esm",
  minify: true,
  naming: "[name].js",
  outdir: join(DIST_DIR, "bin"),
  packages: "external",
  splitting: true,
  target: "node",
});

if (!binResult.success) {
  for (const log of binResult.logs) {
    console.error(log);
  }

  process.exit(1);
}
