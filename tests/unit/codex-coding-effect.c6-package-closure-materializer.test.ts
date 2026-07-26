import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildC6PackageClosureAcquisitionDockerCreateCommand,
  buildC6PackageClosureOfflineDockerCreateCommand,
  buildC6PackageClosureOfflineIndex,
  inspectC6PackageClosureMaterializerTarball,
  materializeC6PackageClosure,
  reconstructC6MaterializerPackageLock,
  runC6PackageClosureMaterializerContainer,
  verifyC6PackageClosureMaterialization,
} from "../../scripts/codex-coding-effect/c6-package-closure-materializer";
import {
  buildC6AssetLock,
  loadC6AssetLock,
  serializeC6AssetLock,
} from "../../scripts/codex-coding-effect/c6-asset-lock";
import {
  C6_LINUX_NPM_CACHE_SEED_COMMAND,
  C6_LINUX_NPM_CI_COMMAND,
  C6_LINUX_PACKAGE_CLOSURE_PROTOCOL_SHA256,
  serializeC6LinuxPackageClosureReceipt,
} from "../../scripts/codex-coding-effect/c6-package-closure-linux";
import type {
  C6LinuxPackageClosureReceipt,
} from "../../scripts/codex-coding-effect/c6-package-closure-linux";
import type {
  C6PackageClosureExpectedIdentity,
} from "../../scripts/codex-coding-effect/c6-package-closure";

const IMAGE_SHA256 = "1".repeat(64);
const IMAGE_REFERENCE = `sha256:${IMAGE_SHA256}`;

describe("Codex coding-effect C6 package closure materializer", () => {
  it("pins the acquisition container to one credential-free network boundary", () => {
    const command =
      buildC6PackageClosureAcquisitionDockerCreateCommand({
        containerUser: "501:20",
        expectedImageSha256: IMAGE_SHA256,
        imageReference: IMAGE_REFERENCE,
        workRoot: "/tmp/c6-materializer",
      });

    expect(command).toContain("--pull=never");
    expect(command).toContain("--platform=linux/amd64");
    expect(command).toContain("--network=bridge");
    expect(command).toContain("--read-only");
    expect(command).toContain("--cap-drop=ALL");
    expect(command).toContain("--security-opt=no-new-privileges");
    expect(command).toContain(
      "--env=NPM_CONFIG_GLOBALCONFIG=/work/acquisition/empty-global-npmrc",
    );
    expect(command).toContain(
      "--env=NPM_CONFIG_USERCONFIG=/work/acquisition/empty-user-npmrc",
    );
    expect(command).toContain(
      "--mount=type=bind,src=/tmp/c6-materializer,dst=/work",
    );
    expect(command.some((part) => part.includes("/Users/"))).toBeFalse();
    expect(command.filter((part) => part.startsWith("--mount="))).toHaveLength(1);
    expect(command).toContain(
      `--label=org.goodmemory.c6.owner=${sha256("/tmp/c6-materializer")}`,
    );
    expect(command).toContain(
      "--label=org.goodmemory.c6.phase=acquisition",
    );
  });

  it("pins the production optional rebuild to network-none and an empty cache", () => {
    const command = buildC6PackageClosureOfflineDockerCreateCommand({
      containerUser: "501:20",
      expectedImageSha256: IMAGE_SHA256,
      imageReference: IMAGE_REFERENCE,
      workRoot: "/tmp/c6-materializer",
    });

    expect(command).toContain("--network=none");
    expect(command).toContain("--read-only");
    expect(command).toContain(
      "--mount=type=bind,src=/tmp/c6-materializer,dst=/work",
    );
    expect(command.at(-1)).toBe("/work/offline-build.sh");
    expect(() => buildC6PackageClosureOfflineDockerCreateCommand({
      containerUser: "501:20",
      expectedImageSha256: IMAGE_SHA256,
      imageReference: `sha256:${"2".repeat(64)}`,
      workRoot: "/tmp/c6-materializer",
    })).toThrow("image digest");
  });

  it("groups installed lock locations by frozen tarball and rejects SRI or URL mutation", () => {
    const tarball = Buffer.from("self-contained registry tarball");
    const integrity = sha512Integrity(tarball);
    const digestHex = sriHex(integrity);
    const packageLockBytes = Buffer.from(`${JSON.stringify({
      lockfileVersion: 3,
      name: "goodmemory-c6-runtime",
      packages: {
        "": {
          dependencies: {
            goodmemory: "file:../package/goodmemory-0.7.0.tgz",
          },
          name: "goodmemory-c6-runtime",
          version: "0.0.0",
        },
        "node_modules/goodmemory": {
          integrity: sha512Integrity(Buffer.from("goodmemory")),
          resolved: "file:../package/goodmemory-0.7.0.tgz",
          version: "0.7.0",
        },
        "node_modules/parent/node_modules/example": {
          integrity,
          resolved: "https://registry.example/example-1.0.0.tgz",
          version: "1.0.0",
        },
        "node_modules/example": {
          integrity,
          resolved: "https://registry.example/example-1.0.0.tgz",
          version: "1.0.0",
        },
      },
      requires: true,
      version: "0.0.0",
    }, null, 2)}\n`);
    const tarballs = new Map([[digestHex, tarball]]);

    const result = buildC6PackageClosureOfflineIndex({
      packageLockBytes,
      tarballsBySha512Hex: tarballs,
    });
    expect(result.index.entries).toEqual([
      {
        integrity,
        lockLocations: [
          "node_modules/example",
          "node_modules/parent/node_modules/example",
        ],
        name: "example",
        resolved: "https://registry.example/example-1.0.0.tgz",
        tarball: {
          bytes: tarball.byteLength,
          path: `offline/tarballs/${digestHex}.tgz`,
          sha256: sha256(tarball),
        },
        version: "1.0.0",
      },
    ]);

    expect(() => buildC6PackageClosureOfflineIndex({
      packageLockBytes,
      tarballsBySha512Hex: new Map([
        [digestHex, Buffer.from("mutated")],
      ]),
    })).toThrow("SRI");
    expect(() => buildC6PackageClosureOfflineIndex({
      packageLockBytes: Buffer.from(
        packageLockBytes.toString("utf8").replace(
          "https://registry.example/example-1.0.0.tgz",
          "https://token@registry.example/example-1.0.0.tgz",
        ),
      ),
      tarballsBySha512Hex: tarballs,
    })).toThrow("credential-bearing");
  });

  it("reconstructs the hidden install lock with one deterministic, directly tested function", () => {
    const sourcePackageLockBytes = Buffer.from(JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": {
          dependencies: {
            goodmemory: "file:../package/goodmemory-0.7.0.tgz",
          },
          name: "goodmemory-c6-runtime",
          version: "0.0.0",
        },
      },
      requires: true,
    }));
    const hiddenPackageLockBytes = Buffer.from(JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "node_modules/zod": {
          integrity: "sha512-ZmFrZQ==",
          resolved: "https://registry.example/zod.tgz",
          version: "4.3.6",
        },
        "node_modules/goodmemory": {
          resolved: "file:../package/goodmemory-0.7.0.tgz",
          version: "0.7.0",
        },
      },
      requires: true,
    }));
    const lock = reconstructC6MaterializerPackageLock({
      goodmemorySpecifier: "file:../package/goodmemory-0.7.0.tgz",
      hiddenPackageLockBytes,
      packageIntegrity: "sha512-Z29vZG1lbW9yeQ==",
      packageVersion: "0.7.0",
      sourcePackageLockBytes,
    });
    expect(JSON.parse(lock)).toMatchObject({
      lockfileVersion: 3,
      name: "goodmemory-c6-runtime",
      packages: {
        "node_modules/goodmemory": {
          integrity: "sha512-Z29vZG1lbW9yeQ==",
          resolved: "file:../package/goodmemory-0.7.0.tgz",
          version: "0.7.0",
        },
      },
      requires: true,
      version: "0.0.0",
    });
    expect(lock.indexOf("node_modules/goodmemory"))
      .toBeLessThan(lock.indexOf("node_modules/zod"));
    expect(() => reconstructC6MaterializerPackageLock({
      goodmemorySpecifier: "file:../package/goodmemory-0.7.0.tgz",
      hiddenPackageLockBytes: Buffer.from(
        hiddenPackageLockBytes.toString("utf8").replace(
          '"version":"0.7.0"',
          '"version":"9.9.9"',
        ),
      ),
      packageIntegrity: "sha512-Z29vZG1lbW9yeQ==",
      packageVersion: "0.7.0",
      sourcePackageLockBytes,
    })).toThrow("GoodMemory identity");
  });

  it("does not clean any predicted container name when Docker create fails", async () => {
    const root = await mkdtemp(join(
      await realpath(tmpdir()),
      "goodmemory-c6-materializer-docker-",
    ));
    try {
      const binRoot = join(root, "bin");
      const logPath = join(root, "docker.log");
      await mkdir(binRoot);
      const dockerPath = join(binRoot, "docker");
      await writeFile(
        dockerPath,
        `#!/bin/sh\nprintf '%s\\n' "$*" >> '${logPath}'\nexit 42\n`,
      );
      await chmod(dockerPath, 0o755);
      const command =
        buildC6PackageClosureAcquisitionDockerCreateCommand({
          containerUser: "501:20",
          expectedImageSha256: IMAGE_SHA256,
          imageReference: IMAGE_REFERENCE,
          workRoot: "/tmp/c6-materializer",
        });
      command[0] = dockerPath;

      await expect(runC6PackageClosureMaterializerContainer({
        command,
        imageId: IMAGE_REFERENCE,
        label: "create failure",
        networkMode: "bridge",
        phase: "acquisition",
        timeoutMs: 1_000,
        workRoot: "/tmp/c6-materializer",
      })).rejects.toThrow("failed with exit code 42");
      expect((await readFile(logPath, "utf8")).trim().split("\n"))
        .toHaveLength(1);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("does not enable cleanup until the created container ownership inspect passes", async () => {
    const root = await mkdtemp(join(
      await realpath(tmpdir()),
      "goodmemory-c6-materializer-owner-",
    ));
    try {
      const binRoot = join(root, "bin");
      const logPath = join(root, "docker.log");
      await mkdir(binRoot);
      const containerId = "a".repeat(64);
      const inspect = [{
        Config: {
          Env: [
            "HOME=/work/acquisition/home",
            "NPM_CONFIG_GLOBALCONFIG=/work/acquisition/empty-global-npmrc",
            "NPM_CONFIG_USERCONFIG=/work/acquisition/empty-user-npmrc",
            "npm_config_update_notifier=false",
          ],
          Labels: {
            "org.goodmemory.c6.owner": "wrong-owner",
            "org.goodmemory.c6.phase": "acquisition",
          },
        },
        HostConfig: {
          CapDrop: ["ALL"],
          NetworkMode: "bridge",
          ReadonlyRootfs: true,
          SecurityOpt: ["no-new-privileges"],
        },
        Image: IMAGE_REFERENCE,
        Mounts: [{
          Destination: "/work",
          RW: true,
          Source: "/tmp/c6-materializer",
          Type: "bind",
        }],
      }];
      const dockerPath = join(binRoot, "docker");
      await writeFile(
        dockerPath,
        [
          "#!/bin/sh",
          `printf '%s\\n' "$*" >> ${JSON.stringify(logPath)}`,
          "case \"$1\" in",
          `  create) printf '%s\\n' ${JSON.stringify(containerId)} ;;`,
          `  inspect) printf '%s\\n' ${
            JSON.stringify(JSON.stringify(inspect))
          } ;;`,
          "  *) exit 99 ;;",
          "esac",
          "",
        ].join("\n"),
      );
      await chmod(dockerPath, 0o755);
      const moduleUrl = new URL(
        "../../scripts/codex-coding-effect/c6-package-closure-materializer.ts",
        import.meta.url,
      ).href;
      const script = `
        import { runC6PackageClosureMaterializerContainer } from ${
          JSON.stringify(moduleUrl)
        };
        try {
          await runC6PackageClosureMaterializerContainer(${JSON.stringify({
            command: ["docker", "create"],
            imageId: IMAGE_REFERENCE,
            label: "ownership mutation",
            networkMode: "bridge",
            phase: "acquisition",
            timeoutMs: 1_000,
            workRoot: "/tmp/c6-materializer",
          })});
          throw new Error("materializer unexpectedly succeeded");
        } catch (error) {
          if (!(error instanceof Error) || !error.message.includes("isolation inspect failed")) {
            throw error;
          }
        }
      `;
      const child = Bun.spawn({
        cmd: [process.execPath, "-e", script],
        env: {
          ...process.env,
          PATH: `${binRoot}:${process.env.PATH ?? ""}`,
        },
        stderr: "pipe",
        stdout: "pipe",
      });
      const [exitCode, stderr] = await Promise.all([
        child.exited,
        new Response(child.stderr).text(),
      ]);
      if (exitCode !== 0) {
        throw new Error(stderr);
      }
      expect((await readFile(logPath, "utf8")).trim().split("\n"))
        .toHaveLength(2);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("accepts only an exact externally built GoodMemory tgz", async () => {
    const fixture = await packageFixture();
    try {
      const result = await inspectC6PackageClosureMaterializerTarball({
        expectedPackageSha256: fixture.sha256,
        packageTarballPath: fixture.tarballPath,
      });
      expect(result).toMatchObject({
        packageSha256: fixture.sha256,
        packageVersion: "0.7.0",
      });
      expect(result.packageIntegrity).toMatch(/^sha512-/u);

      await expect(inspectC6PackageClosureMaterializerTarball({
        expectedPackageSha256: "f".repeat(64),
        packageTarballPath: fixture.tarballPath,
      })).rejects.toThrow("hash");
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("never leaves a completed output or reservation on preflight failure", async () => {
    const fixture = await packageFixture();
    const outputRoot = join(fixture.root, "closure-output");
    const input = {
      expectedImageSha256: IMAGE_SHA256,
      expectedPackageSha256: "f".repeat(64),
      imageReference: IMAGE_REFERENCE,
      outputRoot,
      packageTarballPath: fixture.tarballPath,
      runtime: {
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
      },
    };
    try {
      await expect(materializeC6PackageClosure(input))
        .rejects.toThrow("hash");
      expect(await readdir(fixture.root)).not.toContain("closure-output");
      expect(
        (await readdir(fixture.root)).some((entry) =>
          entry.startsWith(".closure-output.") ||
          entry === "closure-output.materialize.lock"
        ),
      ).toBeFalse();

      await mkdir(outputRoot);
      await expect(materializeC6PackageClosure({
        ...input,
        expectedPackageSha256: fixture.sha256,
      })).rejects.toThrow("already exists");
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("never replaces a raced output child and removes the failed reservation", async () => {
    const fixture = await packageFixture();
    const outputRoot = join(fixture.root, "closure-output");
    try {
      const input = materializerInput(fixture, outputRoot);
      await expect(materializeC6PackageClosure(
        input,
        async (context) => {
          await writeFile(
            join(context.outputRoot, "expected-identity.json"),
            "raced output child\n",
            { flag: "wx" },
          );
          return prepareSyntheticMaterialization(
            context.stagingRoot,
            input,
          );
        },
      )).rejects.toThrow(
        "C6 materializer refuses to replace an output artifact",
      );
      expect(await readdir(fixture.root)).not.toContain("closure-output");
      expect(await readdir(fixture.root))
        .not.toContain("closure-output.materialize.lock");
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("publishes a root-locked completed result without replacing its claimed directory", async () => {
    const fixture = await packageFixture();
    const outputRoot = join(fixture.root, "closure-output");
    let claimedIdentity:
      | { dev: number; ino: number }
      | undefined;
    try {
      const input = materializerInput(fixture, outputRoot);
      const result = await materializeC6PackageClosure(
        input,
        async (context) => {
          const claimed = await lstat(context.outputRoot);
          claimedIdentity = { dev: claimed.dev, ino: claimed.ino };
          await expect(mkdir(context.outputRoot)).rejects.toMatchObject({
            code: "EEXIST",
          });
          return prepareSyntheticMaterialization(context.stagingRoot, input);
        },
      );
      const completed = await lstat(outputRoot);
      if (claimedIdentity === undefined) {
        throw new Error("test executor did not observe claimed output");
      }
      expect({
        dev: completed.dev,
        ino: completed.ino,
      }).toEqual(claimedIdentity);
      expect(await readdir(outputRoot)).toContain("asset-lock.json");
      expect(await readdir(outputRoot))
        .toContain("materialization-manifest.json");
      const rootLock = await loadC6AssetLock(outputRoot);
      const rootFiles = rootLock.assetLock.files.map((file) => file.path);
      expect(rootFiles).toEqual(
        expect.arrayContaining([
          "closure/asset-lock.json",
          "expected-identity.json",
          "linux-rebuild-receipt.json",
          "materialization-manifest.json",
          "runner-sources/c6-asset-lock.ts",
          "runner-sources/c6-package-closure-linux.ts",
          "runner-sources/c6-package-closure-materializer.ts",
          "runner-sources/c6-package-closure.ts",
          "runner-sources/c6-package.ts",
          "runner-sources/materialize-codex-coding-effect-c6-package-closure.ts",
        ]),
      );
      const manifest = JSON.parse(await readFile(
        result.materializationManifestPath,
        "utf8",
      )) as {
        closure: { assetLock: { sha256: string } };
        expectedIdentity: { sha256: string };
        linuxRebuildReceipt: { sha256: string };
        runnerSources: Record<string, { path: string; sha256: string }>;
      };
      expect(Object.keys(manifest.runnerSources).sort()).toEqual([
        "assetLock",
        "cli",
        "closureValidator",
        "linuxRebuild",
        "materializer",
        "packageInspector",
      ]);
      expect(manifest.expectedIdentity.sha256)
        .toBe(result.expectedIdentitySha256);
      expect(manifest.linuxRebuildReceipt.sha256)
        .toBe(result.linuxRebuildReceiptSha256);
      expect(manifest.closure.assetLock.sha256)
        .toBe(sha256(await readFile(
          join(outputRoot, "closure/asset-lock.json"),
        )));
      expect(result.rootAssetLockSha256)
        .toBe(rootLock.assetLockSha256);
      expect(result.rootAssetRootSha256)
        .toBe(rootLock.assetLock.assetRootSha256);
      expect(result.liveLinuxRebuildProven).toBeFalse();
      expect(result.linuxRebuildReceiptSha256)
        .toBe(sha256(await readFile(result.linuxRebuildReceiptPath)));
      expect(result.expectedIdentitySha256)
        .toBe(sha256(await readFile(result.expectedIdentityPath)));
      expect(result.materializationManifestSha256).toBe(
        sha256(await readFile(result.materializationManifestPath)),
      );

      const persisted = await verifyC6PackageClosureMaterialization({
        expectedLinuxRebuildReceiptSha256:
          result.linuxRebuildReceiptSha256,
        expectedMaterializationManifestSha256:
          result.materializationManifestSha256,
        expectedRootAssetLockSha256: result.rootAssetLockSha256,
        expectedRootAssetRootSha256: result.rootAssetRootSha256,
        outputRoot,
      });
      expect(persisted).toMatchObject({
        linuxRebuildProven: false,
        receiptValidation: "frozen-runner-receipt-structure-only",
      });
      for (const mutation of [
        {
          expectedRootAssetLockSha256: "f".repeat(64),
        },
        {
          expectedMaterializationManifestSha256: "f".repeat(64),
        },
        {
          expectedLinuxRebuildReceiptSha256: "f".repeat(64),
        },
      ]) {
        await expect(verifyC6PackageClosureMaterialization({
          expectedLinuxRebuildReceiptSha256:
            result.linuxRebuildReceiptSha256,
          expectedMaterializationManifestSha256:
            result.materializationManifestSha256,
          expectedRootAssetLockSha256: result.rootAssetLockSha256,
          expectedRootAssetRootSha256: result.rootAssetRootSha256,
          outputRoot,
          ...mutation,
        })).rejects.toThrow();
      }

      const replacedReceipt = JSON.parse(await readFile(
        result.linuxRebuildReceiptPath,
        "utf8",
      )) as C6LinuxPackageClosureReceipt;
      replacedReceipt.executor.dockerServerVersion =
        "synthetic-test-replaced";
      const replacedReceiptBytes =
        serializeC6LinuxPackageClosureReceipt(replacedReceipt);
      await writeFile(
        result.linuxRebuildReceiptPath,
        replacedReceiptBytes,
      );
      manifest.linuxRebuildReceipt.sha256 =
        sha256(replacedReceiptBytes);
      const replacedManifestBytes =
        `${JSON.stringify(manifest, null, 2)}\n`;
      await writeFile(
        result.materializationManifestPath,
        replacedManifestBytes,
      );
      const replacedRootLock = await buildC6AssetLock(outputRoot);
      const replacedRootLockBytes =
        serializeC6AssetLock(replacedRootLock);
      await writeFile(
        result.rootAssetLockPath,
        replacedRootLockBytes,
      );

      const selfConsistentReplacement =
        await verifyC6PackageClosureMaterialization({
          expectedLinuxRebuildReceiptSha256:
            sha256(replacedReceiptBytes),
          expectedMaterializationManifestSha256:
            sha256(replacedManifestBytes),
          expectedRootAssetLockSha256:
            sha256(replacedRootLockBytes),
          expectedRootAssetRootSha256:
            replacedRootLock.assetRootSha256,
          outputRoot,
        });
      expect(selfConsistentReplacement.linuxRebuildProven).toBeFalse();
      await expect(verifyC6PackageClosureMaterialization({
        expectedLinuxRebuildReceiptSha256:
          result.linuxRebuildReceiptSha256,
        expectedMaterializationManifestSha256:
          result.materializationManifestSha256,
        expectedRootAssetLockSha256: result.rootAssetLockSha256,
        expectedRootAssetRootSha256: result.rootAssetRootSha256,
        outputRoot,
      })).rejects.toThrow(
        "C6 materialization root asset lock does not match",
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });
});

function materializerInput(
  fixture: { sha256: string; tarballPath: string },
  outputRoot: string,
) {
  return {
    expectedImageSha256: IMAGE_SHA256,
    expectedPackageSha256: fixture.sha256,
    imageReference: IMAGE_REFERENCE,
    outputRoot,
    packageTarballPath: fixture.tarballPath,
    runtime: {
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
    },
  };
}

async function prepareSyntheticMaterialization(
  stagingRoot: string,
  input: ReturnType<typeof materializerInput>,
) {
  const closureRoot = join(stagingRoot, "closure");
  await mkdir(closureRoot);
  const closureManifestBytes = `${JSON.stringify({
    kind: "synthetic-c6-package-closure",
    schemaVersion: 1,
  }, null, 2)}\n`;
  await writeFile(join(closureRoot, "closure.json"), closureManifestBytes);
  await writeFile(join(closureRoot, "payload.txt"), "synthetic closure\n");
  const closureLock = await buildC6AssetLock(closureRoot);
  const closureLockBytes = serializeC6AssetLock(closureLock);
  await writeFile(join(closureRoot, "asset-lock.json"), closureLockBytes);
  const expected = {
    image: {
      architecture: "x64",
      operatingSystem: "linux",
      runtime: input.runtime,
      sha256: input.expectedImageSha256,
    },
    package: {
      dependencyClosure: {
        assetLockSha256: sha256(closureLockBytes),
        assetRootSha256: closureLock.assetRootSha256,
        installedTreeManifestSha256: "7".repeat(64),
        manifestSha256: sha256(closureManifestBytes),
      },
      name: "goodmemory",
      sha256: input.expectedPackageSha256,
      version: "0.7.0",
    },
  } as const satisfies C6PackageClosureExpectedIdentity;
  const expectedBytes = `${JSON.stringify(expected, null, 2)}\n`;
  await writeFile(
    join(stagingRoot, "expected-identity.json"),
    expectedBytes,
  );
  const receiptBytes = serializeC6LinuxPackageClosureReceipt(
    syntheticLinuxReceipt(expected),
  );
  await writeFile(
    join(stagingRoot, "linux-rebuild-receipt.json"),
    receiptBytes,
  );
  return {
    expected,
    linuxRebuildReceiptSha256: sha256(receiptBytes),
    persistedReceiptValidation:
      "frozen-runner-receipt-structure-only" as const,
  };
}

function syntheticLinuxReceipt(
  expected: C6PackageClosureExpectedIdentity,
): C6LinuxPackageClosureReceipt {
  return {
    executor: {
      allCapabilitiesDropped: true,
      cacheStartedEmpty: true,
      closureMountedReadOnly: true,
      containerArchitecture: "x86_64",
      containerOperatingSystem: "Linux",
      dockerServerVersion: "synthetic-test",
      environmentAllowlistEnforced: true,
      exitCode: 0,
      hostCredentialMountsAbsent: true,
      imageArchitecture: "amd64",
      imageId: `sha256:${expected.image.sha256}`,
      imageOperatingSystem: "linux",
      imageReference: `sha256:${expected.image.sha256}`,
      imageSha256: expected.image.sha256,
      kind: "docker",
      libc: { family: "glibc", version: "2.36" },
      networkMode: "none",
      noNewPrivileges: true,
      npmConfigFilesForcedEmpty: true,
      osReleaseSha256: "8".repeat(64),
      rootFilesystemReadOnly: true,
      sourceCheckoutMounted: false,
      workMountedReadWrite: true,
    },
    input: {
      assetLockSha256:
        expected.package.dependencyClosure.assetLockSha256,
      assetRootSha256:
        expected.package.dependencyClosure.assetRootSha256,
      closureManifestSha256:
        expected.package.dependencyClosure.manifestSha256,
      offlineTarballCount: 1,
      offlineTarballSetSha256: "9".repeat(64),
      packageLockSha256: "a".repeat(64),
      packageSha256: expected.package.sha256,
      packageVersion: expected.package.version,
    },
    install: {
      cacheSeedCommand: [...C6_LINUX_NPM_CACHE_SEED_COMMAND],
      cacheSeededTarballSetSha256: "9".repeat(64),
      command: [...C6_LINUX_NPM_CI_COMMAND],
      packageLockSha256After: "a".repeat(64),
      packageLockSha256Before: "a".repeat(64),
      seededOfflineTarballCount: 1,
    },
    kind: "c6-linux-x64-package-closure-rebuild",
    linuxRebuildProven: true,
    outcome: "passed",
    persistenceBoundary: {
      independentReplayRequired: true,
      rawExecutionWitnessIncluded: false,
    },
    result: {
      frozenTreeManifestSha256:
        expected.package.dependencyClosure.installedTreeManifestSha256,
      goodmemoryRuntimeHelpExitCode: 0,
      goodmemoryRuntimeHelpStdoutSha256: "b".repeat(64),
      goodmemoryVersionExitCode: 0,
      goodmemoryVersionOutput: `goodmemory ${expected.package.version}`,
      installedTreeManifestSha256:
        expected.package.dependencyClosure.installedTreeManifestSha256,
      installedTreeMatches: true,
      sqliteVssLinuxX64Present: true,
    },
    runnerProtocolSha256:
      C6_LINUX_PACKAGE_CLOSURE_PROTOCOL_SHA256,
    runtime: expected.image.runtime,
    schemaVersion: 1,
  };
}

async function packageFixture(): Promise<{
  root: string;
  sha256: string;
  tarballPath: string;
}> {
  const root = await mkdtemp(join(
    await realpath(tmpdir()),
    "goodmemory-c6-materializer-",
  ));
  const packageRoot = join(root, "package");
  const files = [
    "scripts/goodmemory-cli.js",
    "scripts/goodmemory-mcp.js",
    "dist/bin/goodmemory-cli.js",
    "dist/bin/goodmemory-mcp.js",
    "dist/host/index.js",
  ];
  for (const path of files) {
    await mkdir(join(packageRoot, path, ".."), { recursive: true });
    await writeFile(join(packageRoot, path), `// ${path}\n`);
  }
  await writeFile(join(packageRoot, "package.json"), `${JSON.stringify({
    dependencies: {
      zod: "^4.3.6",
    },
    name: "goodmemory",
    version: "0.7.0",
  }, null, 2)}\n`);
  const tarballPath = join(root, "goodmemory-0.7.0.tgz");
  const child = Bun.spawn({
    cmd: ["tar", "-czf", tarballPath, "-C", root, "package"],
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`test tar failed: ${stderr}`);
  }
  const bytes = new Uint8Array(await Bun.file(tarballPath).arrayBuffer());
  return {
    root,
    sha256: sha256(bytes),
    tarballPath,
  };
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha512Integrity(value: Uint8Array): string {
  return `sha512-${createHash("sha512").update(value).digest("base64")}`;
}

function sriHex(integrity: string): string {
  return Buffer.from(integrity.slice("sha512-".length), "base64")
    .toString("hex");
}
