import { readdir } from "node:fs/promises";
import { join } from "node:path";

const INTEGRATION_TEST_DIR = "tests/integration";
const EXCLUDED_INTEGRATION_COVERAGE_FILES = new Set([
  "codex-coding-effect.c6-protocol-readiness.test.ts",
  "python-http-bridge.test.ts",
]);
const EXCLUDED_COVERAGE_TEST_NAMES = [
  "anchors generated Codex exports",
  "generated Codex pre-tool-use hook",
  "generated Codex action gate",
  "keeps bm25 hybrid recall over 5k sqlite facts within the hook budget",
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
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

if (import.meta.main) {
  await main();
}
