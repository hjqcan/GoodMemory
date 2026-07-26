import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

import {
  buildC6AssetLock,
  serializeC6AssetLock,
} from "../../scripts/codex-coding-effect/c6-asset-lock";
import {
  computeC6DependencySpecSha256,
  computeC6OfflineTarballSetSha256,
  serializeC6InstalledTreeManifest,
  validateC6PackageClosure,
} from "../../scripts/codex-coding-effect/c6-package-closure";
import type {
  C6InstalledTreeEntry,
  C6PackageClosureExpectedIdentity,
} from "../../scripts/codex-coding-effect/c6-package-closure";

const RUNTIME_IDENTITY = {
  bun: {
    executableSha256: "1".repeat(64),
    version: "1.3.0",
  },
  node: {
    executableSha256: "2".repeat(64),
    version: "v22.17.0",
  },
  npm: {
    cliSha256: "3".repeat(64),
    launcherSha256: "4".repeat(64),
    version: "11.4.2",
  },
} as const;
const IMAGE_SHA256 = "5".repeat(64);

describe("Codex coding-effect C6 frozen package closure", () => {
  it("cross-validates asset-locked package, lock, offline tarballs, installed tree, and Linux receipt structure", async () => {
    const fixture = await packageClosureFixture();
    try {
      const result = await validateC6PackageClosure({
        closureRoot: fixture.root,
        expected: fixture.expected,
      });

      expect(result).toMatchObject({
        buildReceiptValidation: "declared-profile-structure-only",
        installedTreeEntryCount: 5,
        linuxRebuildProven: false,
        offlineTarballCount: 2,
        package: {
          name: "goodmemory",
          sha256: fixture.expected.package.sha256,
          version: "0.7.0",
        },
      });
      expect(result.assetLockSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(result.closureManifestSha256).toMatch(/^[a-f0-9]{64}$/u);
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("rejects an extra consumer root dependency even when all direct hashes are rebuilt", async () => {
    const fixture = await packageClosureFixture({
      extraRootDependency: true,
    });
    try {
      await expect(validateC6PackageClosure({
        closureRoot: fixture.root,
        expected: fixture.expected,
      })).rejects.toThrow("consumer package.json");
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("rejects missing integrity and non-HTTPS registry resolution", async () => {
    for (const lockMutation of ["missing-integrity", "http"] as const) {
      const fixture = await packageClosureFixture({ lockMutation });
      try {
        await expect(validateC6PackageClosure({
          closureRoot: fixture.root,
          expected: fixture.expected,
        })).rejects.toThrow(
          lockMutation === "missing-integrity" ? "integrity" : "HTTPS",
        );
      } finally {
        await rm(fixture.root, { force: true, recursive: true });
      }
    }
  });

  it("rejects a tarball whose SHA-256 references were rebuilt but whose lock SRI no longer matches", async () => {
    const fixture = await packageClosureFixture({
      replaceZodTarballWithoutUpdatingSri: true,
    });
    try {
      await expect(validateC6PackageClosure({
        closureRoot: fixture.root,
        expected: fixture.expected,
      })).rejects.toThrow("SRI");
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("rejects an installed-tree symlink that escapes node_modules", async () => {
    const fixture = await packageClosureFixture({
      escapingInstalledSymlink: true,
    });
    try {
      await expect(validateC6PackageClosure({
        closureRoot: fixture.root,
        expected: fixture.expected,
      })).rejects.toThrow("symlink escapes");
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("rejects a self-consistent offline tarball with an escaping entry", async () => {
    const fixture = await packageClosureFixture({
      unsafeOfflineTarEntry: true,
    });
    try {
      await expect(validateC6PackageClosure({
        closureRoot: fixture.root,
        expected: fixture.expected,
      })).rejects.toThrow("canonical relative path");
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("rejects a rebuilt installed tree that omits a locked package", async () => {
    const fixture = await packageClosureFixture({
      omitInstalledZod: true,
    });
    try {
      await expect(validateC6PackageClosure({
        closureRoot: fixture.root,
        expected: fixture.expected,
      })).rejects.toThrow(
        "installed tree archive is missing regular file node_modules/zod/package.json",
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("rejects a closure whose self-consistent lock is not externally frozen", async () => {
    const fixture = await packageClosureFixture();
    try {
      await expect(validateC6PackageClosure({
        closureRoot: fixture.root,
        expected: {
          ...fixture.expected,
          package: {
            ...fixture.expected.package,
            dependencyClosure: {
              ...fixture.expected.package.dependencyClosure,
              assetRootSha256: "9".repeat(64),
            },
          },
        },
      })).rejects.toThrow("frozen package closure asset identity");
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("rejects Linux profile OS, architecture, image, and runtime drift", async () => {
    const mutations = [
      { architecture: "arm64" },
      { imageSha256: "6".repeat(64) },
      { operatingSystem: "darwin" },
      {
        runtime: {
          ...RUNTIME_IDENTITY,
          node: {
            ...RUNTIME_IDENTITY.node,
            executableSha256: "7".repeat(64),
          },
        },
      },
    ] as const;
    for (const profileMutation of mutations) {
      const fixture = await packageClosureFixture({ profileMutation });
      try {
        await expect(validateC6PackageClosure({
          closureRoot: fixture.root,
          expected: fixture.expected,
        })).rejects.toThrow("build profile");
      } finally {
        await rm(fixture.root, { force: true, recursive: true });
      }
    }
  });
});

interface FixtureOptions {
  escapingInstalledSymlink?: boolean;
  extraRootDependency?: boolean;
  lockMutation?: "http" | "missing-integrity";
  omitInstalledZod?: boolean;
  profileMutation?: {
    architecture?: string;
    imageSha256?: string;
    operatingSystem?: string;
    runtime?: typeof RUNTIME_IDENTITY;
  };
  replaceZodTarballWithoutUpdatingSri?: boolean;
  unsafeOfflineTarEntry?: boolean;
}

async function packageClosureFixture(
  options: FixtureOptions = {},
): Promise<{
  expected: C6PackageClosureExpectedIdentity;
  root: string;
}> {
  const root = await mkdtemp(join(
    await realpath(tmpdir()),
    "goodmemory-c6-closure-",
  ));
  for (const directory of [
    "consumer",
    "installed",
    "offline/tarballs",
    "package",
    "profiles",
  ]) {
    await mkdir(join(root, directory), { recursive: true });
  }

  const packageJson = `${JSON.stringify({
    dependencies: {
      zod: "^4.3.6",
    },
    name: "goodmemory",
    optionalDependencies: {
      "sqlite-vss-linux-x64": "0.1.2",
    },
    version: "0.7.0",
  }, null, 2)}\n`;
  const packageTarball = gzipSync(createTar([
    regularTarEntry("package/package.json", packageJson),
    regularTarEntry(
      "package/scripts/goodmemory-cli.js",
      "#!/usr/bin/env node\n",
    ),
    regularTarEntry(
      "package/scripts/goodmemory-mcp.js",
      "#!/usr/bin/env node\n",
    ),
    regularTarEntry("package/dist/bin/goodmemory-cli.js", "export {};\n"),
    regularTarEntry("package/dist/bin/goodmemory-mcp.js", "export {};\n"),
    regularTarEntry("package/dist/host/index.js", "export {};\n"),
  ]));
  const packagePath = "package/goodmemory-0.7.0.tgz";
  await writeFile(join(root, packagePath), packageTarball);

  const packageIntegrity = sha512Integrity(packageTarball);
  const goodmemorySpecifier = "file:../package/goodmemory-0.7.0.tgz";
  const consumerDependencies: Record<string, string> = {
    goodmemory: goodmemorySpecifier,
  };
  if (options.extraRootDependency) {
    consumerDependencies.zod = "4.3.6";
  }
  const consumerPackageJson = `${JSON.stringify({
    dependencies: consumerDependencies,
    name: "goodmemory-c6-runtime",
    private: true,
    version: "0.0.0",
  }, null, 2)}\n`;
  await writeFile(join(root, "consumer/package.json"), consumerPackageJson);

  const registryPackages = [
    registryPackage("zod", "4.3.6"),
    registryPackage("sqlite-vss-linux-x64", "0.1.2"),
  ];
  const zodPackage = registryPackages[0];
  if (options.replaceZodTarballWithoutUpdatingSri) {
    zodPackage.tarball = gzipSync(createTar([
      regularTarEntry(
        "package/package.json",
        `${JSON.stringify({
          name: "zod",
          tampered: true,
          version: "4.3.6",
        })}\n`,
      ),
    ]));
  }
  if (options.unsafeOfflineTarEntry) {
    zodPackage.tarball = gzipSync(createTar([
      regularTarEntry("package/package.json", zodPackage.packageJson),
      regularTarEntry("../escape", "unsafe\n"),
    ]));
    zodPackage.integrity = sha512Integrity(zodPackage.tarball);
  }

  const lockPackages: Record<string, Record<string, unknown>> = {
    "": {
      dependencies: consumerDependencies,
      name: "goodmemory-c6-runtime",
      version: "0.0.0",
    },
    "node_modules/goodmemory": {
      dependencies: {
        zod: "^4.3.6",
      },
      integrity: packageIntegrity,
      optionalDependencies: {
        "sqlite-vss-linux-x64": "0.1.2",
      },
      resolved: goodmemorySpecifier,
      version: "0.7.0",
    },
  };
  for (const registry of registryPackages) {
    const entry: Record<string, unknown> = {
      integrity: registry.integrity,
      resolved: registry.resolved,
      version: registry.version,
    };
    if (
      options.lockMutation === "missing-integrity" &&
      registry.name === "zod"
    ) {
      delete entry.integrity;
    }
    if (options.lockMutation === "http" && registry.name === "zod") {
      entry.resolved = registry.resolved.replace("https://", "http://");
    }
    lockPackages[`node_modules/${registry.name}`] = entry;
  }
  const packageLock = `${JSON.stringify({
    lockfileVersion: 3,
    name: "goodmemory-c6-runtime",
    packages: lockPackages,
    requires: true,
    version: "0.0.0",
  }, null, 2)}\n`;
  await writeFile(join(root, "consumer/package-lock.json"), packageLock);

  const offlineEntries = [];
  for (const registry of registryPackages) {
    const sriHex = sriDigestHex(registry.integrity);
    const path = `offline/tarballs/${sriHex}.tgz`;
    await writeFile(join(root, path), registry.tarball);
    offlineEntries.push({
      integrity: registry.integrity,
      lockLocations: [`node_modules/${registry.name}`],
      name: registry.name,
      resolved: registry.resolved,
      tarball: {
        bytes: registry.tarball.byteLength,
        path,
        sha256: sha256(registry.tarball),
      },
      version: registry.version,
    });
  }
  offlineEntries.sort((left, right) => left.name.localeCompare(right.name));
  const offlineIndex = {
    entries: offlineEntries,
    packageLockSha256: sha256(packageLock),
    schemaVersion: 1,
  };
  const offlineIndexBytes = `${JSON.stringify(offlineIndex, null, 2)}\n`;
  await writeFile(join(root, "offline/index.json"), offlineIndexBytes);

  const symlinkTarget = options.escapingInstalledSymlink
    ? "../../../outside"
    : "../goodmemory/scripts/goodmemory-cli.js";
  const installedEntries = [
    symlinkTarEntry("node_modules/.bin/goodmemory", symlinkTarget),
    regularTarEntry("node_modules/goodmemory/package.json", packageJson),
    regularTarEntry(
      "node_modules/goodmemory/scripts/goodmemory-cli.js",
      "#!/usr/bin/env node\n",
    ),
    regularTarEntry(
      "node_modules/sqlite-vss-linux-x64/package.json",
      registryPackages[1].packageJson,
    ),
    regularTarEntry(
      "node_modules/zod/package.json",
      registryPackages[0].packageJson,
    ),
  ].filter((entry) =>
    !options.omitInstalledZod ||
    entry.path !== "node_modules/zod/package.json"
  );
  const installedArchive = createTar(installedEntries);
  await writeFile(
    join(root, "installed/node_modules.tar"),
    installedArchive,
  );
  const treeEntries: C6InstalledTreeEntry[] = installedEntries.map((entry) =>
    entry.type === "2"
      ? {
          mode: entry.mode,
          path: entry.path,
          target: entry.linkName,
          type: "symlink",
        }
      : {
          mode: entry.mode,
          path: entry.path,
          sha256: sha256(entry.bytes),
          size: entry.bytes.byteLength,
          type: "file",
        }
  );
  const treeManifest = serializeC6InstalledTreeManifest(treeEntries);
  await writeFile(join(root, "installed/tree.jsonl"), treeManifest);

  const profile = {
    architecture: options.profileMutation?.architecture ?? "x64",
    bun: options.profileMutation?.runtime?.bun ?? RUNTIME_IDENTITY.bun,
    imageSha256: options.profileMutation?.imageSha256 ?? IMAGE_SHA256,
    install: {
      cacheStartedEmpty: true,
      command: [
        "npm",
        "ci",
        "--offline",
        "--ignore-scripts",
        "--omit=dev",
        "--include=optional",
        "--install-strategy=hoisted",
        "--no-audit",
        "--no-fund",
        "--cache",
        "<empty-ephemeral-cache>",
      ],
      credentialsPresent: false,
      exitCode: 0,
      networkIsolation: "container-network-none",
      packageLockSha256After: sha256(packageLock),
      packageLockSha256Before: sha256(packageLock),
      sourceCheckoutMounted: false,
    },
    installedTreeManifestSha256: sha256(treeManifest),
    libc: {
      family: "glibc",
      version: "2.39",
    },
    node: options.profileMutation?.runtime?.node ?? RUNTIME_IDENTITY.node,
    npm: options.profileMutation?.runtime?.npm ?? RUNTIME_IDENTITY.npm,
    operatingSystem:
      options.profileMutation?.operatingSystem ?? "linux",
    osReleaseSha256: "8".repeat(64),
    schemaVersion: 1,
    smoke: {
      goodmemoryHostCommandExitCode: 0,
      goodmemoryVersion: "0.7.0",
      goodmemoryVersionExitCode: 0,
      sqliteVssLinuxX64Present: true,
    },
  };
  const profileBytes = `${JSON.stringify(profile, null, 2)}\n`;
  await writeFile(join(root, "profiles/linux-x64-build.json"), profileBytes);

  const closure = {
    buildProfile: {
      path: "profiles/linux-x64-build.json",
      sha256: sha256(profileBytes),
    },
    consumer: {
      goodmemorySpecifier,
      packageJson: {
        path: "consumer/package.json",
        sha256: sha256(consumerPackageJson),
      },
      packageLock: {
        lockfileVersion: 3,
        path: "consumer/package-lock.json",
        sha256: sha256(packageLock),
      },
      productionOnly: true,
    },
    installedTree: {
      archive: {
        bytes: installedArchive.byteLength,
        path: "installed/node_modules.tar",
        sha256: sha256(installedArchive),
      },
      manifest: {
        entryCount: treeEntries.length,
        path: "installed/tree.jsonl",
        sha256: sha256(treeManifest),
      },
    },
    kind: "c6-goodmemory-package-closure",
    offline: {
      index: {
        path: "offline/index.json",
        sha256: sha256(offlineIndexBytes),
      },
      tarballCount: offlineEntries.length,
      tarballSetSha256:
        computeC6OfflineTarballSetSha256(offlineEntries),
    },
    package: {
      packageJson: {
        bundledDependencyCount: 0,
        dependencySpecSha256:
          computeC6DependencySpecSha256(JSON.parse(packageJson) as unknown),
        name: "goodmemory",
        sha256: sha256(packageJson),
        version: "0.7.0",
      },
      tarball: {
        bytes: packageTarball.byteLength,
        integrity: packageIntegrity,
        path: packagePath,
        sha256: sha256(packageTarball),
      },
    },
    schemaVersion: 1,
    target: {
      architecture: "x64",
      operatingSystem: "linux",
    },
  };
  await writeFile(
    join(root, "closure.json"),
    `${JSON.stringify(closure, null, 2)}\n`,
  );
  const assetLock = await buildC6AssetLock(root);
  const assetLockBytes = serializeC6AssetLock(assetLock);
  await writeFile(join(root, "asset-lock.json"), assetLockBytes);

  return {
    expected: {
      image: {
        architecture: "x64",
        operatingSystem: "linux",
        runtime: RUNTIME_IDENTITY,
        sha256: IMAGE_SHA256,
      },
      package: {
        dependencyClosure: {
          assetLockSha256: sha256(assetLockBytes),
          assetRootSha256: assetLock.assetRootSha256,
          installedTreeManifestSha256: sha256(treeManifest),
          manifestSha256: sha256(
            `${JSON.stringify(closure, null, 2)}\n`,
          ),
        },
        name: "goodmemory",
        sha256: sha256(packageTarball),
        version: "0.7.0",
      },
    },
    root,
  };
}

function registryPackage(name: string, version: string): {
  integrity: string;
  name: string;
  packageJson: string;
  resolved: string;
  tarball: Buffer;
  version: string;
} {
  const packageJson = `${JSON.stringify({ name, version }, null, 2)}\n`;
  const tarball = gzipSync(createTar([
    regularTarEntry("package/package.json", packageJson),
  ]));
  return {
    integrity: sha512Integrity(tarball),
    name,
    packageJson,
    resolved: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`,
    tarball,
    version,
  };
}

interface TestTarEntry {
  bytes: Buffer;
  linkName: string;
  mode: number;
  path: string;
  type: "0" | "2";
}

function regularTarEntry(
  path: string,
  value: string,
  mode = 0o644,
): TestTarEntry {
  return {
    bytes: Buffer.from(value),
    linkName: "",
    mode,
    path,
    type: "0",
  };
}

function symlinkTarEntry(path: string, target: string): TestTarEntry {
  return {
    bytes: Buffer.alloc(0),
    linkName: target,
    mode: 0o777,
    path,
    type: "2",
  };
}

function createTar(entries: readonly TestTarEntry[]): Buffer {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    const header = Buffer.alloc(512);
    writeTarText(header, 0, 100, entry.path);
    writeTarOctal(header, 100, 8, entry.mode);
    writeTarOctal(header, 108, 8, 0);
    writeTarOctal(header, 116, 8, 0);
    writeTarOctal(header, 124, 12, entry.bytes.byteLength);
    writeTarOctal(header, 136, 12, 0);
    header.fill(0x20, 148, 156);
    writeTarText(header, 156, 1, entry.type);
    writeTarText(header, 157, 100, entry.linkName);
    writeTarText(header, 257, 6, "ustar");
    writeTarText(header, 263, 2, "00");
    let checksum = 0;
    for (const byte of header) {
      checksum += byte;
    }
    const checksumText = checksum.toString(8).padStart(6, "0");
    writeTarText(header, 148, 6, checksumText);
    header[154] = 0;
    header[155] = 0x20;
    chunks.push(header, entry.bytes);
    const padding = (512 - (entry.bytes.byteLength % 512)) % 512;
    if (padding > 0) {
      chunks.push(Buffer.alloc(padding));
    }
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

function writeTarOctal(
  target: Buffer,
  offset: number,
  length: number,
  value: number,
): void {
  writeTarText(
    target,
    offset,
    length,
    `${value.toString(8).padStart(length - 1, "0")}\0`,
  );
}

function writeTarText(
  target: Buffer,
  offset: number,
  length: number,
  value: string,
): void {
  const bytes = Buffer.from(value);
  if (bytes.byteLength > length) {
    throw new Error(`test tar field exceeds ${length} bytes`);
  }
  bytes.copy(target, offset);
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha512Integrity(value: Uint8Array): string {
  return `sha512-${createHash("sha512").update(value).digest("base64")}`;
}

function sriDigestHex(integrity: string): string {
  return Buffer.from(integrity.slice("sha512-".length), "base64")
    .toString("hex");
}
