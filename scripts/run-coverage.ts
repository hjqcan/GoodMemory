import { readdir } from "node:fs/promises";
import { join } from "node:path";

const INTEGRATION_TEST_DIR = "tests/integration";
const EXCLUDED_INTEGRATION_COVERAGE_FILES = new Set([
  "codex-coding-effect.c6-protocol-readiness.test.ts",
  "python-http-bridge.test.ts",
]);
export const POST_COVERAGE_TEST_TARGETS = [
  "tests/integration/codex-coding-effect.c6-protocol-readiness.test.ts",
  "tests/integration/host-mcp-server.standalone.test.ts",
  "tests/integration/python-http-bridge.test.ts",
  "tests/unit/codex-coding-effect.c6-source-v3-simple-prior-identity-draft.test.ts",
  "tests/unit/codex-coding-effect.c6-source-v3-simple-prior-identity-portable-evidence.test.ts",
  "tests/unit/codex-coding-effect.c6-source-v3-simple-prior-identity-replay.test.ts",
  "tests/unit/codex-coding-effect.c6-wave3-prior-repository-identity-plan.test.ts",
  "tests/unit/prepare-phase74-protection-plan.test.ts",
  "tests/cli",
  "tests/release",
] as const;
const EXCLUDED_COVERAGE_TEST_NAMES = [
  "anchors generated Codex exports",
  "generated Codex pre-tool-use hook",
  "generated Codex action gate",
  "keeps bm25 hybrid recall over 5k sqlite facts within the hook budget",
  "captures the exact 356-lookups in two complete passes without authorizing census",
  "derives alias-deduplicated node counts from both captures",
  "enforces successful GitHub header syntax and rate-limit projection",
  "forwards SIGTERM through the published CLI wrapper",
  "materializes create-only reproducible archives and replays without source roots",
  "rejects archive drift, extra assets, escape paths, links, receipt mutation, and authority claims",
  "rejects fake locks, reference drift, and incomplete asset closures",
  "writes and reloads one manifest-bound schema-v4 five-suite matrix",
] as const;

export function selectIntegrationCoverageFiles(fileNames: string[]): string[] {
  return fileNames
    .filter((fileName) => fileName.endsWith(".test.ts"))
    .filter((fileName) => !EXCLUDED_INTEGRATION_COVERAGE_FILES.has(fileName))
    .sort()
    .map((fileName) => `${INTEGRATION_TEST_DIR}/${fileName}`);
}

export async function discoverIntegrationCoverageFiles(
  root = process.cwd(),
): Promise<string[]> {
  const fileNames = await readdir(join(root, INTEGRATION_TEST_DIR));
  return selectIntegrationCoverageFiles(fileNames);
}

export function buildCoverageCommand(integrationFiles: string[]): string[] {
  return [
    "bun",
    "test",
    "--coverage",
    "--coverage-reporter=lcov",
    "--coverage-dir=coverage",
    "--max-concurrency=1",
    "--timeout=30000",
    "tests/unit",
    "tests/eval",
    "tests/scenarios",
    "tests/examples",
    "tests/cli",
    ...integrationFiles,
    "--test-name-pattern",
    `^(?!.*(${EXCLUDED_COVERAGE_TEST_NAMES.join("|")})).*$`,
  ];
}

async function main(): Promise<void> {
  const command = buildCoverageCommand(await discoverIntegrationCoverageFiles());
  const child = Bun.spawn({
    cmd: command,
    cwd: process.cwd(),
    env: process.env,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  process.exit(exitCode);
}

if (import.meta.main) {
  await main();
}
