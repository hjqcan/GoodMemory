import {
  mkdtemp,
  realpath,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function withC6GateTemporaryRoot<T>(
  prefix: string,
  run: (root: string) => Promise<T>,
): Promise<T> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), prefix)),
  );
  try {
    return await run(root);
  } finally {
    await rm(root, {
      force: true,
      recursive: true,
    });
  }
}
