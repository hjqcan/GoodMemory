import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertC6LinuxPackageLockCredentialSurface,
  buildC6InstalledTreeManifestFromDirectory,
  buildC6LinuxGoodMemorySmokeDockerCreateCommand,
  buildC6LinuxPackageClosureDockerCreateCommand,
  C6_LINUX_NPM_CACHE_SEED_COMMAND,
  C6_LINUX_NPM_CI_COMMAND,
  C6_LINUX_PACKAGE_CLOSURE_PROTOCOL_SHA256,
  parseC6DockerCreatedContainerId,
  serializeC6LinuxPackageClosureReceipt,
  verifyC6LinuxPackageClosureReceipt,
} from "../../scripts/codex-coding-effect/c6-package-closure-linux";
import type {
  C6LinuxPackageClosureReceipt,
} from "../../scripts/codex-coding-effect/c6-package-closure-linux";
import type {
  C6PackageClosureExpectedIdentity,
} from "../../scripts/codex-coding-effect/c6-package-closure";

const IMAGE_SHA256 = "1".repeat(64);
const EXPECTED = {
  image: {
    architecture: "x64",
    operatingSystem: "linux",
    runtime: {
      bun: {
        executableSha256: "2".repeat(64),
        version: "1.3.0",
      },
      node: {
        executableSha256: "3".repeat(64),
        version: "v22.17.0",
      },
      npm: {
        cliSha256: "4".repeat(64),
        launcherSha256: "5".repeat(64),
        version: "11.4.2",
      },
    },
    sha256: IMAGE_SHA256,
  },
  package: {
    dependencyClosure: {
      assetLockSha256: "6".repeat(64),
      assetRootSha256: "7".repeat(64),
      installedTreeManifestSha256: "8".repeat(64),
      manifestSha256: "9".repeat(64),
    },
    name: "goodmemory",
    sha256: "a".repeat(64),
    version: "0.7.0",
  },
} as const satisfies C6PackageClosureExpectedIdentity;
const IMAGE_REFERENCE =
  `registry.example/goodmemory-c6@sha256:${IMAGE_SHA256}`;

describe("Codex coding-effect C6 Linux package closure rebuild", () => {
  it("builds only a digest-pinned Linux x64, network-none Docker create command", () => {
    const command = buildC6LinuxPackageClosureDockerCreateCommand({
      closureRoot: "/tmp/c6-closure",
      containerUser: "501:20",
      expectedImageSha256: IMAGE_SHA256,
      imageReference: IMAGE_REFERENCE,
      workRoot: "/tmp/c6-work",
    });

    expect(command.slice(0, 2)).toEqual(["docker", "create"]);
    expect(command).toContain("--pull=never");
    expect(command).toContain("--platform=linux/amd64");
    expect(command).toContain("--network=none");
    expect(command).toContain("--read-only");
    expect(command).toContain("--cap-drop=ALL");
    expect(command).toContain("--security-opt=no-new-privileges");
    expect(command).toContain(
      "--env=NPM_CONFIG_GLOBALCONFIG=/work/empty-global-npmrc",
    );
    expect(command).toContain(
      "--env=NPM_CONFIG_USERCONFIG=/work/empty-user-npmrc",
    );
    expect(command).toContain("--env=npm_config_update_notifier=false");
    expect(command).toContain(
      "--mount=type=bind,src=/tmp/c6-closure,dst=/closure,readonly",
    );
    expect(command).toContain(
      "--mount=type=bind,src=/tmp/c6-work,dst=/work",
    );
    expect(command).toContain(IMAGE_REFERENCE);
    expect(command).toContain(
      `--label=org.goodmemory.c6.owner=${sha256("/tmp/c6-work")}`,
    );
    expect(command).toContain(
      "--label=org.goodmemory.c6.phase=linux-install",
    );

    expect(() => buildC6LinuxPackageClosureDockerCreateCommand({
      closureRoot: "/tmp/c6-closure",
      containerUser: "501:20",
      expectedImageSha256: IMAGE_SHA256,
      imageReference: "registry.example/goodmemory-c6:latest",
      workRoot: "/tmp/c6-work",
    })).toThrow("digest-pinned");
    expect(() => buildC6LinuxPackageClosureDockerCreateCommand({
      closureRoot: "/tmp/c6-closure",
      containerUser: "501:20",
      expectedImageSha256: IMAGE_SHA256,
      imageReference:
        `registry.example/goodmemory-c6@sha256:${"b".repeat(64)}`,
      workRoot: "/tmp/c6-work",
    })).toThrow("image digest");
    expect(() => buildC6LinuxPackageClosureDockerCreateCommand({
      closureRoot: "/tmp/c6-closure",
      containerUser: "501:20",
      expectedImageSha256: IMAGE_SHA256,
      imageReference:
        `--network=host@sha256:${IMAGE_SHA256}`,
      workRoot: "/tmp/c6-work",
    })).toThrow("digest-pinned");
  });

  it("builds the GoodMemory smoke as a separate read-only container", () => {
    const command = buildC6LinuxGoodMemorySmokeDockerCreateCommand({
      argument: "--version",
      bunPath: "/usr/local/bin/bun",
      containerUser: "501:20",
      expectedImageSha256: IMAGE_SHA256,
      imageReference: IMAGE_REFERENCE,
      workRoot: "/tmp/c6-work",
    });

    expect(command).toContain("--network=none");
    expect(command).toContain("--read-only");
    expect(command).toContain("--cap-drop=ALL");
    expect(command).toContain("--security-opt=no-new-privileges");
    expect(command).toContain(
      "--mount=type=bind,src=/tmp/c6-work,dst=/runtime,readonly",
    );
    expect(command.some((part) => part.includes("dst=/closure"))).toBeFalse();
    expect(command).toContain(
      "--entrypoint=/runtime/consumer/node_modules/.bin/goodmemory",
    );
    expect(command.at(-1)).toBe("--version");
    expect(command).toContain(
      `--label=org.goodmemory.c6.owner=${sha256("/tmp/c6-work")}`,
    );
    expect(command).toContain(
      "--label=org.goodmemory.c6.phase=linux-smoke-version",
    );
  });

  it("does not yield any cleanup target until Docker returns a valid created id", () => {
    expect(parseC6DockerCreatedContainerId(
      "a".repeat(64),
      "Linux install",
    )).toBe("a".repeat(64));
    for (
      const invalid of [
        "",
        "container-name",
        "a".repeat(11),
        "a".repeat(12),
      ]
    ) {
      expect(() => parseC6DockerCreatedContainerId(
        invalid,
        "Linux install",
      )).toThrow("invalid container id");
    }
  });

  it("does not remove a predicted smoke name when Docker create itself fails", async () => {
    const root = await createTempDirectory(
      "goodmemory-c6-linux-create-failure-",
    );
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
      const moduleUrl = new URL(
        "../../scripts/codex-coding-effect/c6-package-closure-linux.ts",
        import.meta.url,
      ).href;
      const script = `
        import { runC6LinuxGoodMemorySmoke } from ${JSON.stringify(moduleUrl)};
        try {
          await runC6LinuxGoodMemorySmoke(${JSON.stringify({
            argument: "--version",
            bunPath: "/usr/local/bin/bun",
            containerUser: "501:20",
            expectedImageSha256: IMAGE_SHA256,
            imageId: `sha256:${IMAGE_SHA256}`,
            imageReference: IMAGE_REFERENCE,
            workRoot: "/tmp/c6-work",
          })});
          throw new Error("smoke unexpectedly succeeded");
        } catch (error) {
          if (!(error instanceof Error) || !error.message.includes("exit code 42")) {
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
      expect(exitCode).toBe(0);
      expect((await readFile(logPath, "utf8")).trim().split("\n"))
        .toHaveLength(1);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("does not enable smoke cleanup until the ownership inspect passes", async () => {
    const root = await createTempDirectory(
      "goodmemory-c6-linux-owner-",
    );
    try {
      const binRoot = join(root, "bin");
      const logPath = join(root, "docker.log");
      await mkdir(binRoot);
      const containerId = "a".repeat(64);
      const inspect = [{
        Config: {
          Env: [
            "GOODMEMORY_BUN_BINARY=/usr/local/bin/bun",
            "HOME=/tmp/home",
          ],
          Labels: {
            "org.goodmemory.c6.owner": "wrong-owner",
            "org.goodmemory.c6.phase": "linux-smoke-version",
          },
        },
        HostConfig: {
          CapDrop: ["ALL"],
          NetworkMode: "none",
          ReadonlyRootfs: true,
          SecurityOpt: ["no-new-privileges"],
        },
        Image: `sha256:${IMAGE_SHA256}`,
        Mounts: [{
          Destination: "/runtime",
          RW: false,
          Source: "/tmp/c6-work",
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
        "../../scripts/codex-coding-effect/c6-package-closure-linux.ts",
        import.meta.url,
      ).href;
      const script = `
        import { runC6LinuxGoodMemorySmoke } from ${JSON.stringify(moduleUrl)};
        try {
          await runC6LinuxGoodMemorySmoke(${JSON.stringify({
            argument: "--version",
            bunPath: "/usr/local/bin/bun",
            containerUser: "501:20",
            expectedImageSha256: IMAGE_SHA256,
            imageId: `sha256:${IMAGE_SHA256}`,
            imageReference: IMAGE_REFERENCE,
            workRoot: "/tmp/c6-work",
          })});
          throw new Error("smoke unexpectedly succeeded");
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

  it("rejects credential-bearing HTTPS URLs in the frozen package-lock", () => {
    const packageLock = (resolved: string) => Buffer.from(JSON.stringify({
      packages: {
        "": {},
        "node_modules/example": {
          resolved,
        },
      },
    }));

    expect(() => assertC6LinuxPackageLockCredentialSurface(
      packageLock("https://registry.example/example.tgz"),
    )).not.toThrow();
    for (const resolved of [
      "https://token@registry.example/example.tgz",
      "HTTPS://token@registry.example/example.tgz",
      "https://registry.example/example.tgz?token=secret",
      "https://registry.example/example.tgz#secret",
    ]) {
      expect(() => assertC6LinuxPackageLockCredentialSurface(
        packageLock(resolved),
      )).toThrow("credential-bearing registry URL");
    }
  });

  it("rebuilds the canonical manifest from real filesystem bytes and rejects symlink escape", async () => {
    const root = await createTempDirectory("goodmemory-c6-linux-tree-");
    const nodeModules = join(root, "node_modules");
    try {
      await mkdir(join(nodeModules, ".bin"), { recursive: true });
      await mkdir(join(nodeModules, "goodmemory"), { recursive: true });
      const packageJson = join(nodeModules, "goodmemory", "package.json");
      await writeFile(packageJson, '{"name":"goodmemory"}\n');
      await chmod(packageJson, 0o644);
      await symlink(
        "../goodmemory/package.json",
        join(nodeModules, ".bin", "goodmemory"),
      );

      const manifest = await buildC6InstalledTreeManifestFromDirectory(
        nodeModules,
      );
      expect(manifest).toContain(
        '"path":"node_modules/.bin/goodmemory"',
      );
      expect(manifest).toContain(
        `"sha256":"${sha256('{"name":"goodmemory"}\n')}"`,
      );

      await rm(join(nodeModules, ".bin", "goodmemory"));
      await symlink(
        "../../../outside",
        join(nodeModules, ".bin", "goodmemory"),
      );
      await expect(
        buildC6InstalledTreeManifestFromDirectory(nodeModules),
      ).rejects.toThrow("symlink escapes");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("does not promote a forged but structurally valid receipt to execution proof", async () => {
    const root = await createTempDirectory("goodmemory-c6-linux-receipt-");
    try {
      const receipt = validReceipt();
      const bytes = serializeC6LinuxPackageClosureReceipt(receipt);
      const path = join(root, "receipt.json");
      await writeFile(path, bytes);

      const result = await verifyC6LinuxPackageClosureReceipt({
        expected: EXPECTED,
        expectedReceiptSha256: sha256(bytes),
        path,
      });
      expect(result).toEqual({
        linuxRebuildProven: false,
        receiptSha256: sha256(bytes),
        receiptValidation: "frozen-runner-receipt-structure-only",
        recordedLinuxRebuildProven: true,
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects self-consistent receipt network, runtime, and tree drift", async () => {
    const mutations: C6LinuxPackageClosureReceipt[] = [
      {
        ...validReceipt(),
        executor: {
          ...validReceipt().executor,
          networkMode: "bridge",
        },
      },
      {
        ...validReceipt(),
        executor: {
          ...validReceipt().executor,
          cacheStartedEmpty: false,
        },
      },
      {
        ...validReceipt(),
        executor: {
          ...validReceipt().executor,
          environmentAllowlistEnforced: false,
        },
      },
      {
        ...validReceipt(),
        executor: {
          ...validReceipt().executor,
          hostCredentialMountsAbsent: false,
        },
      },
      {
        ...validReceipt(),
        executor: {
          ...validReceipt().executor,
          npmConfigFilesForcedEmpty: false,
        },
      },
      {
        ...validReceipt(),
        runtime: {
          ...validReceipt().runtime,
          node: {
            ...validReceipt().runtime.node,
            executableSha256: "b".repeat(64),
          },
        },
      },
      {
        ...validReceipt(),
        install: {
          ...validReceipt().install,
          cacheSeedCommand: [
            "npm",
            "cache",
            "add",
            "<incomplete-set>",
          ],
        },
      },
      {
        ...validReceipt(),
        install: {
          ...validReceipt().install,
          cacheSeededTarballSetSha256: "0".repeat(64),
        },
      },
      {
        ...validReceipt(),
        result: {
          ...validReceipt().result,
          installedTreeManifestSha256: "c".repeat(64),
        },
      },
    ];
    for (const [index, receipt] of mutations.entries()) {
      const root = await createTempDirectory(
        `goodmemory-c6-linux-receipt-${index}-`,
      );
      try {
        const bytes = `${JSON.stringify(receipt, null, 2)}\n`;
        const path = join(root, "receipt.json");
        await writeFile(path, bytes);
        await expect(verifyC6LinuxPackageClosureReceipt({
          expected: EXPECTED,
          expectedReceiptSha256: sha256(bytes),
          path,
        })).rejects.toThrow("C6 Linux rebuild receipt");
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    }
  });
});

function validReceipt(): C6LinuxPackageClosureReceipt {
  return {
    executor: {
      allCapabilitiesDropped: true,
      cacheStartedEmpty: true,
      closureMountedReadOnly: true,
      containerArchitecture: "x86_64",
      containerOperatingSystem: "Linux",
      dockerServerVersion: "28.0.0",
      environmentAllowlistEnforced: true,
      exitCode: 0,
      hostCredentialMountsAbsent: true,
      imageArchitecture: "amd64",
      imageId: `sha256:${IMAGE_SHA256}`,
      imageOperatingSystem: "linux",
      imageReference: IMAGE_REFERENCE,
      imageSha256: IMAGE_SHA256,
      kind: "docker",
      libc: {
        family: "glibc",
        version: "2.36",
      },
      networkMode: "none",
      noNewPrivileges: true,
      npmConfigFilesForcedEmpty: true,
      osReleaseSha256: "0".repeat(64),
      rootFilesystemReadOnly: true,
      sourceCheckoutMounted: false,
      workMountedReadWrite: true,
    },
    input: {
      assetLockSha256:
        EXPECTED.package.dependencyClosure.assetLockSha256,
      assetRootSha256:
        EXPECTED.package.dependencyClosure.assetRootSha256,
      closureManifestSha256:
        EXPECTED.package.dependencyClosure.manifestSha256,
      offlineTarballCount: 2,
      offlineTarballSetSha256: "d".repeat(64),
      packageLockSha256: "e".repeat(64),
      packageSha256: EXPECTED.package.sha256,
      packageVersion: EXPECTED.package.version,
    },
    install: {
      cacheSeedCommand: [...C6_LINUX_NPM_CACHE_SEED_COMMAND],
      cacheSeededTarballSetSha256: "d".repeat(64),
      command: [...C6_LINUX_NPM_CI_COMMAND],
      packageLockSha256After: "e".repeat(64),
      packageLockSha256Before: "e".repeat(64),
      seededOfflineTarballCount: 2,
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
        EXPECTED.package.dependencyClosure.installedTreeManifestSha256,
      goodmemoryRuntimeHelpExitCode: 0,
      goodmemoryRuntimeHelpStdoutSha256: "f".repeat(64),
      goodmemoryVersionExitCode: 0,
      goodmemoryVersionOutput: "goodmemory 0.7.0",
      installedTreeManifestSha256:
        EXPECTED.package.dependencyClosure.installedTreeManifestSha256,
      installedTreeMatches: true,
      sqliteVssLinuxX64Present: true,
    },
    runnerProtocolSha256:
      C6_LINUX_PACKAGE_CLOSURE_PROTOCOL_SHA256,
    runtime: EXPECTED.image.runtime,
    schemaVersion: 1,
  };
}

async function createTempDirectory(prefix: string): Promise<string> {
  return mkdtemp(join(await realpath(tmpdir()), prefix));
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
