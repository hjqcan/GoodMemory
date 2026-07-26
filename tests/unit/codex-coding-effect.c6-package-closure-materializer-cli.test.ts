import { describe, expect, it } from "bun:test";
import {
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  parseC6PackageClosureMaterializerCliOptions,
  runC6PackageClosureMaterializerCommand,
} from "../../scripts/materialize-codex-coding-effect-c6-package-closure";

describe("Codex coding-effect C6 package closure materializer CLI", () => {
  it("parses only caller-pinned package, image, runtime, and output inputs", () => {
    expect(parseC6PackageClosureMaterializerCliOptions(requiredArgs())).toEqual({
      expectedImageSha256: "1".repeat(64),
      expectedPackageSha256: "2".repeat(64),
      imageReference: `sha256:${"1".repeat(64)}`,
      outputRoot: "reports/c6-package-closure",
      packageTarballPath: "dist/goodmemory-0.7.0.tgz",
      runtimeIdentityPath: "protocol/linux-runtime.json",
    });
  });

  it("rejects duplicate, missing, padded, or unknown inputs", () => {
    expect(() => parseC6PackageClosureMaterializerCliOptions([
      ...requiredArgs(),
      "--output-root=other",
    ])).toThrow("cannot be specified more than once");
    expect(() => parseC6PackageClosureMaterializerCliOptions(
      requiredArgs().filter((argument) =>
        !argument.startsWith("--runtime-identity=")
      ),
    )).toThrow("--runtime-identity is required");
    expect(() => parseC6PackageClosureMaterializerCliOptions([
      ...requiredArgs(),
      "--unknown=value",
    ])).toThrow("unknown C6 package closure materializer option");
    expect(() => parseC6PackageClosureMaterializerCliOptions([
      ...requiredArgs().filter((argument) =>
        !argument.startsWith("--output-root=")
      ),
      "--output-root= padded",
    ])).toThrow("must not be empty or padded");
  });

  it("loads the pinned runtime identity and dispatches once", async () => {
    const root = await realpath(await mkdtemp(
      join(tmpdir(), "goodmemory-c6-materializer-cli-"),
    ));
    try {
      const runtimeIdentityPath = join(root, "runtime.json");
      const args = requiredArgs().map((argument) =>
        argument.startsWith("--runtime-identity=")
          ? `--runtime-identity=${runtimeIdentityPath}`
          : argument
      );
      const runtime = {
        bun: {
          executableSha256: "3".repeat(64),
          version: "1.3.11",
        },
        node: {
          executableSha256: "4".repeat(64),
          version: "v22.14.0",
        },
        npm: {
          cliSha256: "5".repeat(64),
          launcherSha256: "6".repeat(64),
          version: "10.9.2",
        },
      };
      await writeFile(
        runtimeIdentityPath,
        `${JSON.stringify(runtime, null, 2)}\n`,
      );
      const calls: unknown[] = [];
      const marker = {
        liveLinuxRebuildProven: true as const,
        outputRoot: "reports/c6-package-closure",
      };
      const result = await runC6PackageClosureMaterializerCommand(
        args,
        async (input) => {
          calls.push(input);
          return marker;
        },
      );

      expect(result).toBe(marker);
      expect(calls).toEqual([{
        expectedImageSha256: "1".repeat(64),
        expectedPackageSha256: "2".repeat(64),
        imageReference: `sha256:${"1".repeat(64)}`,
        outputRoot: "reports/c6-package-closure",
        packageTarballPath: "dist/goodmemory-0.7.0.tgz",
        runtime,
      }]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

function requiredArgs(): string[] {
  return [
    "--package-tarball=dist/goodmemory-0.7.0.tgz",
    `--package-sha256=${"2".repeat(64)}`,
    `--image-reference=sha256:${"1".repeat(64)}`,
    `--image-sha256=${"1".repeat(64)}`,
    "--runtime-identity=protocol/linux-runtime.json",
    "--output-root=reports/c6-package-closure",
  ];
}
