import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const CLI_ROOT = new URL("../../src/cli.ts", import.meta.url);
const CLI_TEST_ROOT = new URL("./cli.test.ts", import.meta.url);

describe("CLI module boundaries", () => {
  test("keeps the root as an explicit thin router over four command families", async () => {
    const source = await readFile(CLI_ROOT, "utf8");
    const lineCount = source.trimEnd().split("\n").length;

    expect(lineCount).toBeLessThanOrEqual(300);
    expect(source).toContain('from "./cli/memory"');
    expect(source).toContain('from "./cli/host"');
    expect(source).toContain('from "./cli/eval"');
    expect(source).toContain('from "./cli/services"');
    expect(source).not.toContain("registerCommand");
    expect(source).not.toContain("commandRegistry");
  });

  test("keeps the historical CLI test path as a thin family-suite entry", async () => {
    const source = await readFile(CLI_TEST_ROOT, "utf8");

    expect(source.trimEnd().split("\n").length).toBeLessThanOrEqual(20);
    expect(source).toContain('import "./cli-eval.cases"');
    expect(source).toContain('import "./cli-host-bootstrap.cases"');
    expect(source).toContain('import "./cli-host.cases"');
    expect(source).toContain('import "./cli-memory.cases"');
    expect(source).toContain('import "./cli-routing.cases"');
  });
});
