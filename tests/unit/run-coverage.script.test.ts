import { describe, expect, it } from "bun:test";

import {
  buildCoverageCommand,
  POST_COVERAGE_TEST_TARGETS,
  selectIntegrationCoverageFiles,
} from "../../scripts/run-coverage";
import {
  buildCiPostCoverageCommand,
} from "../../scripts/run-ci-post-coverage-tests";

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
    expect(command.at(-1)).toContain(
      "captures the exact 356-lookups in two complete passes without authorizing census",
    );
    expect(command.at(-1)).toContain(
      "forwards SIGTERM through the published CLI wrapper",
    );
    expect(POST_COVERAGE_TEST_TARGETS).toContain(
      "tests/unit/codex-coding-effect.c6-source-v3-simple-prior-identity-portable-evidence.test.ts",
    );
    expect(POST_COVERAGE_TEST_TARGETS).toContain(
      "tests/integration/host-mcp-server.standalone.test.ts",
    );
  });

  it("builds a post-coverage command from the shared exclusion targets", () => {
    const command = buildCiPostCoverageCommand();

    expect(command.slice(0, 3)).toEqual([
      "bun",
      "test",
      "--timeout=300000",
    ]);
    expect(command).toContain(
      "tests/integration/codex-coding-effect.c6-protocol-readiness.test.ts",
    );
    expect(command).toContain("tests/integration/host-mcp-server.standalone.test.ts");
    expect(command).toContain(
      "tests/unit/codex-coding-effect.c6-source-v3-simple-prior-identity-draft.test.ts",
    );
    expect(command).toContain("tests/release");
  });
});
