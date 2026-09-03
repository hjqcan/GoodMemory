import { describe, expect, it } from "bun:test";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../..");
const pythonPath = [
  join(repoRoot, "clients/python"),
  join(repoRoot, "scripts/research/dynamicmem"),
].join(":");

describe("DynamicMem GoodMemory adapter", () => {
  it("passes its Python privacy and bridge contract tests", async () => {
    const process = Bun.spawn(
      [
        "python3",
        "-m",
        "unittest",
        "scripts/research/dynamicmem/tests/test_goodmemory_backend.py",
      ],
      {
        cwd: repoRoot,
        env: {
          ...Bun.env,
          PYTHONDONTWRITEBYTECODE: "1",
          PYTHONPATH: pythonPath,
        },
        stderr: "pipe",
        stdout: "pipe",
      },
    );
    const [exitCode, stderr, stdout] = await Promise.all([
      process.exited,
      new Response(process.stderr).text(),
      new Response(process.stdout).text(),
    ]);

    expect(exitCode, `${stdout}\n${stderr}`).toBe(0);
    expect(`${stdout}\n${stderr}`).toContain("Ran 11 tests");
    expect(`${stdout}\n${stderr}`).toContain("OK");
  });
});
