import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import {
  freezeC6PackageSourceDependencyClosure,
  loadC6PackageSourceDependencyClosure,
  materializeC6PackageSourceDependencyCache,
  verifyC6PackageSourceDependencyCache,
  verifyC6PackageSourceDependencyCachePair,
  verifyC6PackageSourceDependencyClosure,
} from "../../scripts/codex-coding-effect/c6-package-source-dependency-closure";
import type {
  C6PackageSourceDependencyClosureExpectedIdentity,
  C6PackageSourceDependencyClosureFreezeResult,
} from "../../scripts/codex-coding-effect/c6-package-source-dependency-closure";

describe("Codex coding-effect C6 package source dependency closure", () => {
  it("freezes a deterministic symlink-free closure and materializes independent caches", async () => {
    const root = await createTempDirectory("goodmemory-c6-source-deps-");
    try {
      const acquisitionRoot = join(root, "acquisition-cache");
      const firstClosureRoot = join(root, "closure-1");
      const secondClosureRoot = join(root, "closure-2");
      const firstCacheRoot = join(root, "cache-1");
      const secondCacheRoot = join(root, "cache-2");
      await createAcquisitionCache(acquisitionRoot, root);

      const first = await freezeC6PackageSourceDependencyClosure({
        acquisitionCacheRoot: acquisitionRoot,
        outputRoot: firstClosureRoot,
      });
      const second = await freezeC6PackageSourceDependencyClosure({
        acquisitionCacheRoot: acquisitionRoot,
        outputRoot: secondClosureRoot,
      });
      const expected = expectedIdentity(first);

      expect(expectedIdentity(second)).toEqual(expected);
      expect((await readdir(firstClosureRoot)).sort()).toEqual([
        "asset-lock.json",
        "bun-cache.tar",
        "cache-tree.jsonl",
        "closure.json",
      ]);
      await assertFrozenClosureHasOnlyIndependentRegularFiles(
        firstClosureRoot,
      );
      expect(
        await readFile(join(firstClosureRoot, "bun-cache.tar")),
      ).toEqual(await readFile(join(secondClosureRoot, "bun-cache.tar")));

      const loaded = await loadC6PackageSourceDependencyClosure({
        closureRoot: firstClosureRoot,
        expected,
      });
      expect(loaded).toMatchObject({
        cacheContentRootSha256: expected.cacheContentRootSha256,
        closureRoot: firstClosureRoot,
      });
      expect(loaded.cacheDirectoryCount).toBeGreaterThan(0);
      expect(loaded.cacheFileCount).toBeGreaterThan(0);
      await expect(verifyC6PackageSourceDependencyClosure({
        closureRoot: firstClosureRoot,
        expected,
      })).resolves.toMatchObject({
        artifactClosureVerified: true,
        cacheArchiveSha256: expected.cacheArchiveSha256,
        cacheContentRootSha256: expected.cacheContentRootSha256,
      });

      await Promise.all([
        mkdir(firstCacheRoot),
        mkdir(secondCacheRoot),
      ]);
      const firstMaterialized =
        await materializeC6PackageSourceDependencyCache({
          closureRoot: firstClosureRoot,
          expected,
          outputRoot: firstCacheRoot,
        });
      const secondMaterialized =
        await materializeC6PackageSourceDependencyCache({
          closureRoot: firstClosureRoot,
          expected,
          outputRoot: secondCacheRoot,
        });
      const pairProgress: Array<{
        phase: string;
        rootIndex: number;
        status: string;
      }> = [];
      await expect(verifyC6PackageSourceDependencyCachePair({
        expectedContentRootSha256: expected.cacheContentRootSha256,
        roots: [firstCacheRoot, secondCacheRoot],
      }, {
        onProgress: (progress) => {
          pairProgress.push(progress);
        },
      })).resolves.toMatchObject({
        pairVerified: true,
      });
      expect(pairProgress.filter((progress) =>
        progress.status === "start"
      ).map((progress) => [
        progress.phase,
        progress.rootIndex,
      ])).toEqual([
        ["initial", 1],
        ["initial", 2],
        ["terminal", 1],
        ["terminal", 2],
        ["terminal-stats", 1],
        ["terminal-stats", 2],
      ]);

      expect(firstMaterialized.cacheContentRootSha256).toBe(
        expected.cacheContentRootSha256,
      );
      expect(secondMaterialized.cacheContentRootSha256).toBe(
        expected.cacheContentRootSha256,
      );
      await assertMaterializedCache(firstCacheRoot);
      await assertMaterializedCache(secondCacheRoot);
      expect(
        (await lstat(join(firstCacheRoot, "pkg", "tool.sh"))).mode & 0o777,
      ).toBe(0o755);
      expect(
        (await lstat(join(firstCacheRoot, "pkg", "package.json"))).mode &
          0o777,
      ).toBe(0o644);
      expect(
        (await lstat(join(firstCacheRoot, "pkg", "empty"))).mode & 0o777,
      ).toBe(0o755);
      expect(
        await readFile(join(firstCacheRoot, "alias-cache", "package.json")),
      ).toEqual(
        await readFile(join(firstCacheRoot, "pkg", "package.json")),
      );
      expect(
        await readFile(
          join(firstCacheRoot, "alias-dependency-cache", "package.json"),
        ),
      ).toEqual(
        await readFile(join(firstCacheRoot, "pkg", "package.json")),
      );
      expect(
        (await lstat(join(firstCacheRoot, "pkg", "package.json"))).ino,
      ).not.toBe(
        (await lstat(join(firstCacheRoot, "alias-cache", "package.json"))).ino,
      );
      expect(
        (await lstat(join(firstCacheRoot, "pkg", "package.json"))).ino,
      ).not.toBe(
        (await lstat(join(secondCacheRoot, "pkg", "package.json"))).ino,
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("requires every externally supplied identity pin", async () => {
    const root = await createTempDirectory("goodmemory-c6-source-pins-");
    try {
      const acquisitionRoot = join(root, "acquisition-cache");
      const closureRoot = join(root, "closure");
      await createAcquisitionCache(acquisitionRoot, root);
      const frozen = await freezeC6PackageSourceDependencyClosure({
        acquisitionCacheRoot: acquisitionRoot,
        outputRoot: closureRoot,
      });
      const expected = expectedIdentity(frozen);
      const keys = [
        "assetLockSha256",
        "assetRootSha256",
        "cacheArchiveSha256",
        "cacheManifestSha256",
        "cacheContentRootSha256",
      ] as const;

      for (const key of keys) {
        await expect(loadC6PackageSourceDependencyClosure({
          closureRoot,
          expected: {
            ...expected,
            [key]: "f".repeat(64),
          },
        })).rejects.toThrow("identity");
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects a self-consistent whole-closure substitution", async () => {
    const root = await createTempDirectory(
      "goodmemory-c6-source-substitution-",
    );
    try {
      const firstAcquisitionRoot = join(root, "acquisition-1");
      const secondAcquisitionRoot = join(root, "acquisition-2");
      await Promise.all([
        mkdir(firstAcquisitionRoot),
        mkdir(secondAcquisitionRoot),
      ]);
      await writeFile(join(firstAcquisitionRoot, "dependency"), "first\n");
      await writeFile(join(secondAcquisitionRoot, "dependency"), "second\n");
      const first = await freezeC6PackageSourceDependencyClosure({
        acquisitionCacheRoot: firstAcquisitionRoot,
        outputRoot: join(root, "closure-1"),
      });
      await freezeC6PackageSourceDependencyClosure({
        acquisitionCacheRoot: secondAcquisitionRoot,
        outputRoot: join(root, "closure-2"),
      });

      await expect(loadC6PackageSourceDependencyClosure({
        closureRoot: join(root, "closure-2"),
        expected: expectedIdentity(first),
      })).rejects.toThrow("identity");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects unsafe, chained, missing, cyclic, and special acquisition entries", async () => {
    const root = await createTempDirectory(
      "goodmemory-c6-source-unsafe-cache-",
    );
    try {
      await expectRejectedAcquisition(root, "escape", async (cacheRoot) => {
        await symlink("/work/cache/../outside", join(cacheRoot, "escape"));
      });
      await expectRejectedAcquisition(root, "missing", async (cacheRoot) => {
        await symlink("/work/cache/missing", join(cacheRoot, "missing"));
      });
      await expectRejectedAcquisition(root, "chain", async (cacheRoot) => {
        await mkdir(join(cacheRoot, "real"));
        await symlink("/work/cache/real", join(cacheRoot, "target-link"));
        await symlink("/work/cache/target-link", join(cacheRoot, "chain"));
      });
      await expectRejectedAcquisition(
        root,
        "intermediate-chain",
        async (cacheRoot) => {
          await mkdir(join(cacheRoot, "real"));
          await writeFile(join(cacheRoot, "real", "file"), "bytes\n");
          await symlink(
            "/work/cache/real",
            join(cacheRoot, "target-link"),
          );
          await symlink(
            "/work/cache/target-link/file",
            join(cacheRoot, "chain"),
          );
        },
        "symlink chain",
      );
      await expectRejectedAcquisition(root, "cycle", async (cacheRoot) => {
        await mkdir(join(cacheRoot, "loop"));
        await symlink("/work/cache/loop", join(cacheRoot, "loop", "back"));
      });
      await expectRejectedAcquisition(root, "special", async (cacheRoot) => {
        const process = Bun.spawn(["mkfifo", join(cacheRoot, "pipe")], {
          stderr: "pipe",
          stdout: "pipe",
        });
        expect(await process.exited).toBe(0);
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects symlinked acquisition roots, existing closure outputs, and non-empty materialization roots", async () => {
    const root = await createTempDirectory("goodmemory-c6-source-roots-");
    try {
      const acquisitionRoot = join(root, "acquisition");
      const acquisitionAlias = join(root, "acquisition-alias");
      await mkdir(acquisitionRoot);
      await writeFile(join(acquisitionRoot, "dependency"), "bytes\n");
      await symlink(acquisitionRoot, acquisitionAlias);

      await expect(freezeC6PackageSourceDependencyClosure({
        acquisitionCacheRoot: acquisitionAlias,
        outputRoot: join(root, "alias-output"),
      })).rejects.toThrow("symlink");

      const existingOutput = join(root, "existing-output");
      await mkdir(existingOutput);
      await expect(freezeC6PackageSourceDependencyClosure({
        acquisitionCacheRoot: acquisitionRoot,
        outputRoot: existingOutput,
      })).rejects.toThrow("already exists");

      const closureRoot = join(root, "closure");
      const frozen = await freezeC6PackageSourceDependencyClosure({
        acquisitionCacheRoot: acquisitionRoot,
        outputRoot: closureRoot,
      });
      const materializedRoot = join(root, "materialized");
      await mkdir(materializedRoot);
      await writeFile(join(materializedRoot, "unexpected"), "bytes\n");
      await expect(materializeC6PackageSourceDependencyCache({
        closureRoot,
        expected: expectedIdentity(frozen),
        outputRoot: materializedRoot,
      })).rejects.toThrow("empty");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects post-materialization content, mode, symlink, and hardlink drift", async () => {
    const root = await createTempDirectory(
      "goodmemory-c6-source-cache-drift-",
    );
    try {
      const acquisitionRoot = join(root, "acquisition");
      const closureRoot = join(root, "closure");
      await createAcquisitionCache(acquisitionRoot, root);
      const frozen = await freezeC6PackageSourceDependencyClosure({
        acquisitionCacheRoot: acquisitionRoot,
        outputRoot: closureRoot,
      });
      const expected = expectedIdentity(frozen);
      const mutations = [
        async (cacheRoot: string) => {
          await writeFile(
            join(cacheRoot, "pkg", "package.json"),
            "{\"name\":\"drifted\"}\n",
          );
        },
        async (cacheRoot: string) => {
          await chmod(join(cacheRoot, "pkg", "tool.sh"), 0o644);
        },
        async (cacheRoot: string) => {
          const path = join(cacheRoot, "pkg", "package.json");
          await rm(path);
          await symlink("../hardlinked", path);
        },
        async (cacheRoot: string) => {
          await link(
            join(cacheRoot, "pkg", "package.json"),
            join(root, `external-hardlink-${basename(cacheRoot)}`),
          );
        },
      ];

      for (const [index, mutate] of mutations.entries()) {
        const cacheRoot = join(root, `cache-${index}`);
        await mkdir(cacheRoot);
        await materializeC6PackageSourceDependencyCache({
          closureRoot,
          expected,
          outputRoot: cacheRoot,
        });
        await expect(verifyC6PackageSourceDependencyCache({
          expectedContentRootSha256: expected.cacheContentRootSha256,
          outputRoot: cacheRoot,
        })).resolves.toMatchObject({
          cacheContentRootSha256: expected.cacheContentRootSha256,
          treeVerified: true,
        });

        await mutate(cacheRoot);
        await expect(verifyC6PackageSourceDependencyCache({
          expectedContentRootSha256: expected.cacheContentRootSha256,
          outputRoot: cacheRoot,
        })).rejects.toThrow();
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects content and hardlink races after the first verification scan", async () => {
    const root = await createTempDirectory(
      "goodmemory-c6-source-cache-race-",
    );
    try {
      const acquisitionRoot = join(root, "acquisition");
      const closureRoot = join(root, "closure");
      await createAcquisitionCache(acquisitionRoot, root);
      const frozen = await freezeC6PackageSourceDependencyClosure({
        acquisitionCacheRoot: acquisitionRoot,
        outputRoot: closureRoot,
      });
      const expected = expectedIdentity(frozen);

      const contentCacheRoot = join(root, "content-cache");
      await mkdir(contentCacheRoot);
      await materializeC6PackageSourceDependencyCache({
        closureRoot,
        expected,
        outputRoot: contentCacheRoot,
      });
      await expect(verifyC6PackageSourceDependencyCache({
        expectedContentRootSha256: expected.cacheContentRootSha256,
        outputRoot: contentCacheRoot,
      }, {
        onFirstScanComplete: async () => {
          await writeFile(
            join(contentCacheRoot, "pkg", "package.json"),
            "{\"name\":\"raced\"}\n",
          );
        },
      })).rejects.toThrow("changed during verification");

      const hardlinkCacheRoot = join(root, "hardlink-cache");
      await mkdir(hardlinkCacheRoot);
      await materializeC6PackageSourceDependencyCache({
        closureRoot,
        expected,
        outputRoot: hardlinkCacheRoot,
      });
      await expect(verifyC6PackageSourceDependencyCache({
        expectedContentRootSha256: expected.cacheContentRootSha256,
        outputRoot: hardlinkCacheRoot,
      }, {
        onFirstScanComplete: async () => {
          await link(
            join(hardlinkCacheRoot, "pkg", "package.json"),
            join(root, "raced-hardlink"),
          );
        },
      })).rejects.toThrow();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects a mutation between paired initial and terminal scans", async () => {
    const root = await createTempDirectory(
      "goodmemory-c6-source-cache-pair-race-",
    );
    try {
      const acquisitionRoot = join(root, "acquisition");
      const closureRoot = join(root, "closure");
      const firstCacheRoot = join(root, "cache-1");
      const secondCacheRoot = join(root, "cache-2");
      await createAcquisitionCache(acquisitionRoot, root);
      const frozen = await freezeC6PackageSourceDependencyClosure({
        acquisitionCacheRoot: acquisitionRoot,
        outputRoot: closureRoot,
      });
      const expected = expectedIdentity(frozen);
      await Promise.all([
        mkdir(firstCacheRoot),
        mkdir(secondCacheRoot),
      ]);
      await materializeC6PackageSourceDependencyCache({
        closureRoot,
        expected,
        outputRoot: firstCacheRoot,
      });
      await materializeC6PackageSourceDependencyCache({
        closureRoot,
        expected,
        outputRoot: secondCacheRoot,
      });

      await expect(verifyC6PackageSourceDependencyCachePair({
        expectedContentRootSha256: expected.cacheContentRootSha256,
        roots: [firstCacheRoot, secondCacheRoot],
      }, {
        betweenScans: async () => {
          await writeFile(
            join(firstCacheRoot, "pkg", "package.json"),
            "{\"name\":\"pair-raced\"}\n",
          );
        },
      })).rejects.toThrow("changed during verification");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("scans thousands of files without asynchronous FileHandle operations", async () => {
    const root = await createTempDirectory(
      "goodmemory-c6-source-cache-heartbeat-",
    );
    try {
      const acquisitionRoot = join(root, "acquisition");
      const closureRoot = join(root, "closure");
      const firstCacheRoot = join(root, "cache-1");
      const secondCacheRoot = join(root, "cache-2");
      await mkdir(acquisitionRoot);
      for (let offset = 0; offset < 2_050; offset += 128) {
        await Promise.all(
          Array.from(
            { length: Math.min(128, 2_050 - offset) },
            (_value, index) => writeFile(
              join(
                acquisitionRoot,
                `entry-${String(offset + index).padStart(4, "0")}`,
              ),
              "x",
            ),
          ),
        );
      }
      const frozen = await freezeC6PackageSourceDependencyClosure({
        acquisitionCacheRoot: acquisitionRoot,
        outputRoot: closureRoot,
      });
      const expected = expectedIdentity(frozen);
      await Promise.all([
        mkdir(firstCacheRoot),
        mkdir(secondCacheRoot),
      ]);
      await materializeC6PackageSourceDependencyCache({
        closureRoot,
        expected,
        outputRoot: firstCacheRoot,
      });
      await materializeC6PackageSourceDependencyCache({
        closureRoot,
        expected,
        outputRoot: secondCacheRoot,
      });
      const heartbeats: string[] = [];
      const probe = await open(join(firstCacheRoot, "entry-0000"), "r");
      const fileHandlePrototype = Object.getPrototypeOf(probe) as {
        close: FileHandle["close"];
        read: FileHandle["read"];
        readFile: FileHandle["readFile"];
        stat: FileHandle["stat"];
      };
      await probe.close();
      const originalClose = fileHandlePrototype.close;
      const originalRead = fileHandlePrototype.read;
      const originalReadFile = fileHandlePrototype.readFile;
      const originalStat = fileHandlePrototype.stat;
      fileHandlePrototype.close = (() => {
        throw new Error("FileHandle.close is forbidden during cache scan");
      }) as FileHandle["close"];
      fileHandlePrototype.read = (() => {
        throw new Error("FileHandle.read is forbidden during cache scan");
      }) as FileHandle["read"];
      fileHandlePrototype.readFile = (() => {
        throw new Error("FileHandle.readFile is forbidden during cache scan");
      }) as FileHandle["readFile"];
      fileHandlePrototype.stat = (() => {
        throw new Error("FileHandle.stat is forbidden during cache scan");
      }) as FileHandle["stat"];
      try {
        await verifyC6PackageSourceDependencyCachePair({
          expectedContentRootSha256: expected.cacheContentRootSha256,
          roots: [firstCacheRoot, secondCacheRoot],
        }, {
          onProgress: (progress) => {
            if (progress.status === "heartbeat") {
              heartbeats.push(
                `${progress.phase}:${progress.rootIndex}:${
                  progress.entriesScanned
                }`,
              );
            }
          },
        });
      } finally {
        fileHandlePrototype.close = originalClose;
        fileHandlePrototype.read = originalRead;
        fileHandlePrototype.readFile = originalReadFile;
        fileHandlePrototype.stat = originalStat;
      }
      expect(heartbeats).toEqual([
        "initial:1:2048",
        "initial:2:2048",
        "terminal:1:2048",
        "terminal:2:2048",
        "terminal-stats:1:2048",
        "terminal-stats:2:2048",
      ]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 120_000);

  it("enforces scan deadlines from the synchronous scan loop", async () => {
    const root = await createTempDirectory(
      "goodmemory-c6-source-cache-deadline-",
    );
    try {
      const acquisitionRoot = join(root, "acquisition");
      const closureRoot = join(root, "closure");
      const cacheRoot = join(root, "cache");
      await createAcquisitionCache(acquisitionRoot, root);
      const frozen = await freezeC6PackageSourceDependencyClosure({
        acquisitionCacheRoot: acquisitionRoot,
        outputRoot: closureRoot,
      });
      await mkdir(cacheRoot);
      let clockReadCount = 0;
      const dependencies = {
        monotonicNowMs: () => clockReadCount++ === 0 ? 0 : 11,
        scanTimeoutMs: 10,
      };

      await expect(materializeC6PackageSourceDependencyCache({
        closureRoot,
        expected: expectedIdentity(frozen),
        outputRoot: cacheRoot,
      }, dependencies)).rejects.toThrow(
        "C6 source dependency cache scan timed out",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects a file changed after the terminal content scan passed it", async () => {
    const root = await createTempDirectory(
      "goodmemory-c6-source-cache-terminal-race-",
    );
    try {
      const cacheRoot = join(root, "cache");
      const earlyPath = join(cacheRoot, "a");
      const latePath = join(cacheRoot, "z");
      const largeFileBytes = 256 * 1024 * 1024;
      const earlyBytes = Buffer.from("before\n");
      await mkdir(cacheRoot);
      await writeFile(earlyPath, earlyBytes);
      await writeFile(latePath, "");
      await truncate(latePath, largeFileBytes);
      await Promise.all([
        chmod(earlyPath, 0o644),
        chmod(latePath, 0o644),
      ]);
      const manifest = [
        {
          bytes: earlyBytes.byteLength,
          mode: 0o644,
          path: "a",
          sha256: sha256(earlyBytes),
          type: "file",
        },
        {
          bytes: largeFileBytes,
          mode: 0o644,
          path: "z",
          sha256: sha256ZeroBytes(largeFileBytes),
          type: "file",
        },
      ].map((entry) => JSON.stringify(entry)).join("\n") + "\n";
      const expectedContentRootSha256 = sha256(Buffer.concat([
        Buffer.from("c6-package-source-dependency-cache-content-v1\n"),
        Buffer.from(manifest),
      ]));
      let finishMutation = () => {};
      const mutationDone = new Promise<void>((resolve) => {
        finishMutation = resolve;
      });
      const verification =
        verifyC6PackageSourceDependencyCache({
          expectedContentRootSha256,
          outputRoot: cacheRoot,
        }, {
          onFirstScanComplete: () => {
            setTimeout(() => {
              void writeFile(earlyPath, "after!\n").finally(finishMutation);
            }, 30);
          },
        }).then(
          () => "resolved",
          () => "rejected",
        );

      const [outcome] = await Promise.all([verification, mutationDone]);
      expect(outcome).toBe("rejected");
      expect(await readFile(earlyPath, "utf8")).toBe("after!\n");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

function expectedIdentity(
  frozen: C6PackageSourceDependencyClosureFreezeResult,
): C6PackageSourceDependencyClosureExpectedIdentity {
  return {
    assetLockSha256: frozen.assetLockSha256,
    assetRootSha256: frozen.assetRootSha256,
    cacheArchiveSha256: frozen.cacheArchiveSha256,
    cacheContentRootSha256: frozen.cacheContentRootSha256,
    cacheManifestSha256: frozen.cacheManifestSha256,
  };
}

async function createAcquisitionCache(
  acquisitionRoot: string,
  parentRoot: string,
): Promise<void> {
  const packageRoot = join(acquisitionRoot, "pkg");
  await mkdir(join(packageRoot, "empty"), { recursive: true });
  await writeFile(
    join(packageRoot, "package.json"),
    "{\"name\":\"fixture\"}\n",
  );
  await chmod(join(packageRoot, "package.json"), 0o600);
  await writeFile(join(packageRoot, "tool.sh"), "#!/bin/sh\nexit 0\n");
  await chmod(join(packageRoot, "tool.sh"), 0o711);
  const backingPath = join(parentRoot, "hardlink-backing");
  await writeFile(backingPath, "hardlinked acquisition bytes\n");
  await link(backingPath, join(acquisitionRoot, "hardlinked"));
  await Promise.all([
    symlink("/work/cache/pkg", join(acquisitionRoot, "alias-cache")),
    symlink(
      "/work/dependency-cache/pkg",
      join(acquisitionRoot, "alias-dependency-cache"),
    ),
  ]);
}

async function expectRejectedAcquisition(
  parentRoot: string,
  label: string,
  prepare: (cacheRoot: string) => Promise<void>,
  expectedMessage?: string,
): Promise<void> {
  const cacheRoot = join(parentRoot, label);
  await mkdir(cacheRoot);
  await prepare(cacheRoot);
  const expectation = expect(freezeC6PackageSourceDependencyClosure({
    acquisitionCacheRoot: cacheRoot,
    outputRoot: join(parentRoot, `${label}-output`),
  })).rejects;
  if (expectedMessage === undefined) {
    await expectation.toThrow();
  } else {
    await expectation.toThrow(expectedMessage);
  }
}

async function assertFrozenClosureHasOnlyIndependentRegularFiles(
  root: string,
): Promise<void> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    expect(entry.isFile()).toBe(true);
    expect(entry.isSymbolicLink()).toBe(false);
    expect((await lstat(join(root, entry.name))).nlink).toBe(1);
  }
}

async function assertMaterializedCache(root: string): Promise<void> {
  const seen = new Set<string>();
  await walkMaterialized(root, seen);
}

async function walkMaterialized(
  root: string,
  seen: Set<string>,
): Promise<void> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const absolutePath = join(root, entry.name);
    expect(entry.isSymbolicLink()).toBe(false);
    if (entry.isDirectory()) {
      expect((await lstat(absolutePath)).mode & 0o777).toBe(0o755);
      await walkMaterialized(absolutePath, seen);
      continue;
    }
    expect(entry.isFile()).toBe(true);
    const stat = await lstat(absolutePath);
    expect(stat.nlink).toBe(1);
    const identity = `${stat.dev}:${stat.ino}`;
    expect(seen.has(identity)).toBe(false);
    seen.add(identity);
  }
}

async function createTempDirectory(prefix: string): Promise<string> {
  return mkdtemp(join(await realpath(tmpdir()), prefix));
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha256ZeroBytes(bytes: number): string {
  const hash = createHash("sha256");
  const chunk = Buffer.alloc(1024 * 1024);
  for (let written = 0; written < bytes; written += chunk.byteLength) {
    hash.update(chunk.subarray(
      0,
      Math.min(chunk.byteLength, bytes - written),
    ));
  }
  return hash.digest("hex");
}
