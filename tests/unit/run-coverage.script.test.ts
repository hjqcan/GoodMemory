import { describe, expect, it } from "bun:test";

import {
  buildCoverageCommand,
  selectIntegrationCoverageFiles,
} from "../../scripts/run-coverage";

describe("run-coverage script", () => {
  it("discovers integration coverage files while excluding child-process and slow evidence tests", () => {
    expect(
      selectIntegrationCoverageFiles([
        "codex-coding-effect.c6-protocol-readiness.test.ts",
        "python-http-bridge.test.ts",
        "storage.postgres.test.ts",
        "api.auto-storage.test.ts",
        "api.postgres.test.ts",
        "helper.ts",
      ]),
    ).toEqual([
      "tests/integration/api.auto-storage.test.ts",
      "tests/integration/api.postgres.test.ts",
      "tests/integration/storage.postgres.test.ts",
    ]);
  });

  it("builds one canonical coverage command with the child-process-sensitive CLI tests filtered by name", () => {
    const command = buildCoverageCommand([
      "tests/integration/api.auto-storage.test.ts",
      "tests/integration/storage.postgres.test.ts",
    ]);

    expect(command).toContain("--coverage-dir=coverage");
    expect(command).toContain("--timeout=30000");
    expect(command).toContain("tests/unit");
    expect(command).toContain("tests/cli");
    expect(command).toContain("tests/integration/api.auto-storage.test.ts");
    expect(command).toContain("tests/integration/storage.postgres.test.ts");
    expect(command).toContain("--test-name-pattern");
    expect(command.at(-1)).toContain("generated Codex action gate");
    expect(command.at(-1)).toContain(
      "keeps bm25 hybrid recall over 5k sqlite facts within the hook budget",
    );
  });
});
