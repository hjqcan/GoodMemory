import { resolve } from "node:path";

import { loadReleaseProfile } from "./release/profile";
import { runReleaseProfile } from "./release/runner";
import { resolveRepoRootFromScriptUrl } from "./script-paths";

export function parseReleaseCliArgs(
  argv: readonly string[],
  defaultRepoRoot: string,
): { outputDir: string; repoRoot: string } {
  if (argv[0] !== "prepare") {
    throw new Error(usage());
  }
  const seen = new Set<string>();
  let outputDir: string | undefined;
  let repoRoot = defaultRepoRoot;
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument !== "--output-dir" && argument !== "--repo-root") {
      throw new Error(`unknown release argument ${argument}`);
    }
    if (seen.has(argument)) {
      throw new Error(`duplicate release argument ${argument}`);
    }
    seen.add(argument);
    const value = argv[index + 1]?.trim();
    if (!value || value.startsWith("--")) {
      throw new Error(`${argument} requires a value`);
    }
    if (argument === "--output-dir") {
      outputDir = value;
    } else {
      repoRoot = value;
    }
    index += 1;
  }
  if (!outputDir) {
    throw new Error(`--output-dir is required\n${usage()}`);
  }
  return { outputDir, repoRoot };
}

function usage(): string {
  return [
    "Usage:",
    "  bun scripts/release.ts prepare --output-dir <dir>",
  ].join("\n");
}

export async function runReleaseCli(
  argv: readonly string[],
  defaultRepoRoot = resolveRepoRootFromScriptUrl(import.meta.url),
): Promise<{
  allRequiredPassed?: boolean;
  archivePath?: string;
  integrity?: string;
  manifestPath?: string;
  summaryPath?: string;
  tarballPath?: string;
}> {
  const options = parseReleaseCliArgs(argv, defaultRepoRoot);
  const repoRoot = resolve(options.repoRoot);
  const profile = await loadReleaseProfile(repoRoot);
  const result = await runReleaseProfile({
    outputDir: resolve(options.outputDir),
    profile,
    repoRoot,
  });
  const tarball = result.manifest.artifacts.find(
    (artifact) => artifact.id === "release-tarball",
  );
  return {
    allRequiredPassed: result.manifest.allRequiredPassed,
    archivePath: result.archivePath,
    integrity: tarball?.integrity,
    manifestPath: result.manifestPath,
    summaryPath: result.summaryPath,
    tarballPath: result.tarballPath,
  };
}

if (import.meta.main) {
  try {
    const result = await runReleaseCli(Bun.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.allRequiredPassed === false) {
      process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
