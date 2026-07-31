import {
  POST_COVERAGE_TEST_TARGETS,
} from "./run-coverage";

const POST_COVERAGE_TEST_TIMEOUT_MILLISECONDS = 300_000;

export function buildCiPostCoverageCommand(): string[] {
  return [
    "bun",
    "test",
    `--timeout=${POST_COVERAGE_TEST_TIMEOUT_MILLISECONDS}`,
    ...POST_COVERAGE_TEST_TARGETS,
  ];
}

async function main(): Promise<void> {
  const child = Bun.spawn({
    cmd: buildCiPostCoverageCommand(),
    cwd: process.cwd(),
    env: process.env,
    stderr: "inherit",
    stdout: "inherit",
  });
  const exitCode = await child.exited;
  process.exit(exitCode);
}

if (import.meta.main) {
  await main();
}
