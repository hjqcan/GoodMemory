import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";

import {
  readC6StableRegularFile,
} from "./c6-asset-lock";

const execFileAsync = promisify(execFile);
const GIT_EXECUTABLE = "/usr/bin/git";
const GIT_EXECUTABLE_SHA256 =
  "7588ceab299393618d6f8861502ac0588d1594025f301d9a61a898215b5571d3";
const GIT_VERSION = "git version 2.50.1 (Apple Git-155)";
let verifiedRuntime:
  Promise<void> | undefined;

export async function runC6PinnedGit(
  repositoryRoot: string,
  args: readonly string[],
  maxBuffer: number,
): Promise<Buffer> {
  verifiedRuntime ??= verifyRuntime();
  await verifiedRuntime;
  const { stdout } = await execFileAsync(
    GIT_EXECUTABLE,
    [
      "-C",
      repositoryRoot,
      "--no-replace-objects",
      ...args,
    ],
    {
      encoding: "buffer",
      env: safeGitEnvironment(),
      maxBuffer,
    },
  );
  return Buffer.from(stdout);
}

async function verifyRuntime(): Promise<void> {
  if (
    await realpath(GIT_EXECUTABLE) !==
      GIT_EXECUTABLE
  ) {
    throw new Error(
      "C6 Git executable path mismatch",
    );
  }
  const executable =
    await readC6StableRegularFile(
      GIT_EXECUTABLE,
      "C6 pinned Git executable",
      32 * 1_024 * 1_024,
    );
  if (
    Bun.CryptoHasher.hash(
      "sha256",
      executable,
      "hex",
    ) !== GIT_EXECUTABLE_SHA256
  ) {
    throw new Error(
      "C6 Git executable SHA-256 mismatch",
    );
  }
  const { stdout } = await execFileAsync(
    GIT_EXECUTABLE,
    ["--version"],
    {
      encoding: "utf8",
      env: safeGitEnvironment(),
    },
  );
  if (stdout.trim() !== GIT_VERSION) {
    throw new Error(
      "C6 Git executable version mismatch",
    );
  }
}

function safeGitEnvironment():
  NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) =>
          !name.startsWith("GIT_"),
      ),
    ),
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_OPTIONAL_LOCKS: "0",
  };
}
