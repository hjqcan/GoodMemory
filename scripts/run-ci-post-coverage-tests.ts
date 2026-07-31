import {
  POST_COVERAGE_TEST_TARGETS,
} from "./run-coverage";

export function buildCiPostCoverageCommand(): string[] {
  return [
    "bun",
    "test",
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
