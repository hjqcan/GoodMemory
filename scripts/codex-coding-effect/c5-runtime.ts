import { createHash } from "node:crypto";
import { COPYFILE_EXCL } from "node:constants";
import {
  chmod,
  copyFile,
  lstat,
  readFile,
} from "node:fs/promises";
import { join } from "node:path";

import type {
  C3BaselineArmRuntime,
  C3InstalledArmRuntime,
} from "./c3-runtime";

export async function restoreC5ArmModelCredential(input: {
  authFile: string;
  runtime: C3InstalledArmRuntime | C3BaselineArmRuntime;
}): Promise<{ authSha256: string }> {
  const source = await lstat(input.authFile);
  if (!source.isFile() || source.isSymbolicLink()) {
    throw new Error("C5 Codex auth source must be a regular file");
  }
  const destination = join(input.runtime.plan.paths.codexHome, "auth.json");
  try {
    await lstat(destination);
    throw new Error("C5 copied model credential already exists");
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
      throw error;
    }
  }
  await copyFile(input.authFile, destination, COPYFILE_EXCL);
  await chmod(destination, 0o600);
  const [sourceBytes, copiedBytes] = await Promise.all([
    readFile(input.authFile),
    readFile(destination),
  ]);
  const authSha256 = sha256(sourceBytes);
  if (sha256(copiedBytes) !== authSha256) {
    throw new Error("C5 copied model credential hash mismatch");
  }
  return { authSha256 };
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
