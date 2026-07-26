import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  parseC6PackageSourceRebuildCliOptions,
  runC6PackageSourceRebuildCommand,
} from "../../scripts/rebuild-codex-coding-effect-c6-package-source";

describe("Codex coding-effect C6 package source rebuild CLI", () => {
  it("parses only exact source, image, package, runtime, and output pins", () => {
    expect(parseC6PackageSourceRebuildCliOptions(requiredArgs())).toEqual({
      containerUser: "501:20",
      dependencyClosureExpected: {
        assetLockSha256: "5".repeat(64),
        assetRootSha256: "6".repeat(64),
        cacheArchiveSha256: "7".repeat(64),
        cacheContentRootSha256: "8".repeat(64),
        cacheManifestSha256: "9".repeat(64),
      },
      dependencyClosureRoot: "/closure",
      dockerCliMode: 0o755,
      dockerCliPath: "/opt/c6/bin/docker",
      dockerCliSha256: "a".repeat(64),
      dockerSocketPath: "/opt/c6/run/docker.sock",
      expectedCommitSha: "1".repeat(40),
      expectedImageSha256: "2".repeat(64),
      expectedPackageSha256: "3".repeat(64),
      expectedTreeSha: "4".repeat(40),
      outputRoot: "reports/c6-source-rebuild",
      repositoryRoot: "/repo",
      runtimeIdentityPath: "protocol/runtime.json",
      runtimeIdentitySha256: "b".repeat(64),
    });
  });

  it("rejects duplicate, missing, padded, and unknown options", () => {
    expect(() => parseC6PackageSourceRebuildCliOptions([
      ...requiredArgs(),
      "--output-root=other",
    ])).toThrow("cannot be specified more than once");
    expect(() => parseC6PackageSourceRebuildCliOptions(
      requiredArgs().filter((argument) =>
        !argument.startsWith("--expected-tree=")
      ),
    )).toThrow("--expected-tree is required");
    expect(() => parseC6PackageSourceRebuildCliOptions([
      ...requiredArgs(),
      "--unknown=value",
    ])).toThrow("unknown C6 package source rebuild option");
    expect(() => parseC6PackageSourceRebuildCliOptions([
      ...requiredArgs().filter((argument) =>
        !argument.startsWith("--repository-root=")
      ),
      "--repository-root= /repo",
    ])).toThrow("must not be empty or padded");
    expect(() => parseC6PackageSourceRebuildCliOptions(
      requiredArgs().filter((argument) =>
        !argument.startsWith("--dependency-cache-manifest-sha256=")
      ),
    )).toThrow("--dependency-cache-manifest-sha256 is required");
    expect(() => parseC6PackageSourceRebuildCliOptions(
      requiredArgs().map((argument) =>
        argument.startsWith("--docker-cli-mode=")
          ? "--docker-cli-mode=755"
          : argument
      ),
    )).toThrow("four octal digits");
  });

  it("loads runtime identity and dispatches exactly once", async () => {
    const root = await mkdtemp(join(
      await realpath(tmpdir()),
      "goodmemory-c6-source-cli-",
    ));
    try {
      const runtimeIdentityPath = join(root, "runtime.json");
      const runtime = {
        bun: {
          executableSha256: "5".repeat(64),
          version: "1.3.11",
        },
        node: {
          executableSha256: "6".repeat(64),
          version: "v22.14.0",
        },
        npm: {
          cliSha256: "7".repeat(64),
          launcherSha256: "8".repeat(64),
          version: "10.9.2",
        },
      };
      const runtimeBytes = `${JSON.stringify(runtime, null, 2)}\n`;
      const runtimeIdentitySha256 = sha256(runtimeBytes);
      await writeFile(runtimeIdentityPath, runtimeBytes);
      const args = requiredArgs().map((argument) => {
        if (argument.startsWith("--runtime-identity=")) {
          return `--runtime-identity=${runtimeIdentityPath}`;
        }
        if (argument.startsWith("--runtime-identity-sha256=")) {
          return `--runtime-identity-sha256=${runtimeIdentitySha256}`;
        }
        return argument;
      });
      const calls: unknown[] = [];
      const marker = {
        c6PackageOfflineClosureProven: false as const,
        evidenceScope: "local-offline-source-build-observation" as const,
        executorAuthority: "injected-test-seam" as const,
        executionMode: "offline-dependency-closure-source-build" as const,
        liveOfflineBuildCount: 0 as const,
        locallyExecutedLinuxBuild: false,
        networkDisabled: true as const,
        offlineDependencyClosureUsed: true as const,
        sourceBuildReproducible: false as const,
      };
      const result = await runC6PackageSourceRebuildCommand(
        args,
        async (input) => {
          calls.push(input);
          return marker;
        },
      );

      expect(result).toBe(marker);
      expect(calls).toEqual([{
        containerUser: "501:20",
        dependencyClosureExpected: {
          assetLockSha256: "5".repeat(64),
          assetRootSha256: "6".repeat(64),
          cacheArchiveSha256: "7".repeat(64),
          cacheContentRootSha256: "8".repeat(64),
          cacheManifestSha256: "9".repeat(64),
        },
        dependencyClosureRoot: "/closure",
        dockerAuthority: {
          cliMode: 0o755,
          cliPath: "/opt/c6/bin/docker",
          cliSha256: "a".repeat(64),
          socketPath: "/opt/c6/run/docker.sock",
        },
        expectedCommitSha: "1".repeat(40),
        expectedImageSha256: "2".repeat(64),
        expectedPackageSha256: "3".repeat(64),
        expectedTreeSha: "4".repeat(40),
        outputRoot: "reports/c6-source-rebuild",
        repositoryRoot: "/repo",
        runtime,
        runtimeIdentitySha256,
      }]);
      await expect(runC6PackageSourceRebuildCommand(
        args.map((argument) =>
          argument.startsWith("--runtime-identity-sha256=")
            ? `--runtime-identity-sha256=${"0".repeat(64)}`
            : argument
        ),
        async () => marker,
      )).rejects.toThrow("runtime identity hash does not match");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

function requiredArgs(): string[] {
  return [
    "--container-user=501:20",
    "--dependency-closure-root=/closure",
    `--dependency-asset-lock-sha256=${"5".repeat(64)}`,
    `--dependency-asset-root-sha256=${"6".repeat(64)}`,
    `--dependency-cache-archive-sha256=${"7".repeat(64)}`,
    `--dependency-cache-content-root-sha256=${"8".repeat(64)}`,
    `--dependency-cache-manifest-sha256=${"9".repeat(64)}`,
    "--docker-cli-mode=0755",
    "--docker-cli-path=/opt/c6/bin/docker",
    `--docker-cli-sha256=${"a".repeat(64)}`,
    "--docker-socket-path=/opt/c6/run/docker.sock",
    "--repository-root=/repo",
    `--expected-commit=${"1".repeat(40)}`,
    `--expected-tree=${"4".repeat(40)}`,
    `--image-sha256=${"2".repeat(64)}`,
    `--package-sha256=${"3".repeat(64)}`,
    "--runtime-identity=protocol/runtime.json",
    `--runtime-identity-sha256=${"b".repeat(64)}`,
    "--output-root=reports/c6-source-rebuild",
  ];
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
