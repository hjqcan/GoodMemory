import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  join,
  relative,
} from "node:path";

import {
  describe,
  expect,
  it,
} from "bun:test";

import {
  buildProofFileRef,
} from "../../scripts/proof/files";
import {
  proofIdentity,
} from "../../scripts/proof/identity";
import {
  buildResearchChildEnvironment,
  runResearchCommand,
} from "../../scripts/research";
import {
  runSourceV4CaptureProtocol,
  SOURCE_V4_PROTOCOL_ID,
  verifySourceV4CaptureProtocol,
  verifySourceV4ProofBoundary,
} from "../../scripts/research/c6/source-v4-capture";
import {
  LONGMEMEVAL_V1_SOURCE_PAIRED_BASELINE,
  LONGMEMEVAL_V1_SOURCE_PAIRED_CANONICAL_ARTIFACTS,
  LONGMEMEVAL_V1_SOURCE_PAIRED_PROTOCOL_ID,
} from "../../scripts/research/longmemeval-v1/source-paired";
import type {
  LegacySourceV4Projection,
} from "../../scripts/research/c6/legacy-inputs/source-v4";
import {
  activeResearchProtocols,
  findActiveResearchProtocol,
  loadResearchProtocolRegistry,
} from "../../scripts/research/registry";

describe("research proof boundary", () => {
  it("keeps ambient Git and Bun preload controls out of proof children", () => {
    expect(buildResearchChildEnvironment({
      BUN_OPTIONS: "--preload=/mutable/preload.ts",
      GIT_DIR: "/mutable/git-dir",
      GOODMEMORY_TEST_ROOT: "/bound/root",
      PATH: "/usr/bin",
    })).toEqual({
      GOODMEMORY_TEST_ROOT: "/bound/root",
      PATH: "/usr/bin",
    });
  });

  it("loads a static active registry with exact gate entrypoints", async () => {
    const registry = await loadResearchProtocolRegistry();
    expect(registry.protocols).toHaveLength(2);
    const protocol = registry.protocols.find(
      ({ id }) => id === SOURCE_V4_PROTOCOL_ID,
    )!;
    expect(protocol.id).toBe(SOURCE_V4_PROTOCOL_ID);
    expect(protocol.status).toBe("active");
    expect(protocol.inputSourceIdentity).toEqual({
      commit: "05d39fcfb8bb6efe6b8065ec3ea8372c15b9c1b8",
      tree: "4f902b215c60f5bb6543e9b7c3ce501895b45725",
    });
    expect(protocol.historicalGateEntrypoints).toEqual([
      "./tests/quality-gates/phase-73/codex-coding-effect.c6-source-v4-bounded-snapshot.gate.ts",
      "./tests/quality-gates/phase-73/codex-coding-effect.c6-source-v4-bounded-review-activation.gate.ts",
    ]);
    expect(
      protocol.historicalGateEntrypoints.every(
        (path) => path.endsWith(".gate.ts") && !path.includes("*"),
      ),
    ).toBe(true);
    const longMemEval = registry.protocols.find(
      ({ id }) => id === LONGMEMEVAL_V1_SOURCE_PAIRED_PROTOCOL_ID,
    )!;
    expect(longMemEval.status).toBe("active");
    expect(longMemEval.inputSourceIdentity).toEqual(
      LONGMEMEVAL_V1_SOURCE_PAIRED_BASELINE,
    );
    expect(longMemEval.historicalGateEntrypoints).toEqual([]);
    expect(longMemEval.canonicalArtifacts).toEqual([
      ...LONGMEMEVAL_V1_SOURCE_PAIRED_CANONICAL_ARTIFACTS,
    ]);
  });

  it("lists protocols without importing or requiring external snapshots", async () => {
    const previous =
      process.env.GOODMEMORY_TEST_C6_SOURCE_V4_BOUNDED_SNAPSHOT_ROOT;
    const previousLongMemEval =
      process.env.GOODMEMORY_LONGMEMEVAL_V1_PAIRED_ROOT;
    delete process.env.GOODMEMORY_TEST_C6_SOURCE_V4_BOUNDED_SNAPSHOT_ROOT;
    delete process.env.GOODMEMORY_LONGMEMEVAL_V1_PAIRED_ROOT;
    try {
      await expect(runResearchCommand(["list"])).resolves.toEqual([
        {
          id: SOURCE_V4_PROTOCOL_ID,
          status: "active",
        },
        {
          id: LONGMEMEVAL_V1_SOURCE_PAIRED_PROTOCOL_ID,
          status: "active",
        },
      ]);
      await expect(
        runResearchCommand(["run", SOURCE_V4_PROTOCOL_ID]),
      ).resolves.toEqual({
        missingPrerequisites: [
          "GOODMEMORY_TEST_C6_SOURCE_V4_BOUNDED_SNAPSHOT_ROOT",
        ],
        protocolId: SOURCE_V4_PROTOCOL_ID,
        status: "preflight-blocked",
      });
      await expect(
        runResearchCommand(["run", LONGMEMEVAL_V1_SOURCE_PAIRED_PROTOCOL_ID]),
      ).resolves.toEqual({
        missingPrerequisites: ["GOODMEMORY_LONGMEMEVAL_V1_PAIRED_ROOT"],
        protocolId: LONGMEMEVAL_V1_SOURCE_PAIRED_PROTOCOL_ID,
        status: "preflight-blocked",
      });
    } finally {
      if (previous !== undefined) {
        process.env.GOODMEMORY_TEST_C6_SOURCE_V4_BOUNDED_SNAPSHOT_ROOT =
          previous;
      }
      if (previousLongMemEval !== undefined) {
        process.env.GOODMEMORY_LONGMEMEVAL_V1_PAIRED_ROOT =
          previousLongMemEval;
      }
    }
  });

  it("exits non-zero when verification is blocked before execution", async () => {
    const prerequisite =
      "GOODMEMORY_TEST_C6_SOURCE_V4_BOUNDED_SNAPSHOT_ROOT";
    const processResult = Bun.spawn([
      process.execPath,
      join(import.meta.dir, "../../scripts/research.ts"),
      "verify",
      SOURCE_V4_PROTOCOL_ID,
    ], {
      env: {
        ...process.env,
        [prerequisite]: "",
      },
      stderr: "pipe",
      stdout: "pipe",
    });
    const [exitCode, stderr, stdout] = await Promise.all([
      processResult.exited,
      new Response(processResult.stderr).text(),
      new Response(processResult.stdout).text(),
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      missingPrerequisites: [prerequisite],
      protocolId: SOURCE_V4_PROTOCOL_ID,
      status: "preflight-blocked",
    });
  });

  it("accepts all frozen statuses while selecting only active protocols", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-registry-status-"));
    try {
      const statuses = [
        "accepted-historical",
        "active",
        "diagnostic-frozen",
        "superseded",
        "terminal",
      ] as const;
      const protocolTemplate = {
        canonicalArtifacts: ["artifact.json"],
        externalPrerequisites: ["GOODMEMORY_TEST_ROOT"],
        historicalGateEntrypoints: [
          "./tests/quality-gates/example.gate.ts",
        ],
        runEntrypoint: "scripts/research/example.ts#run",
        inputSourceIdentity: {
          commit: "a".repeat(40),
          tree: "b".repeat(40),
        },
        verifyEntrypoint: "scripts/research/example.ts#verify",
      };
      const path = join(root, "protocols.json");
      await writeFile(path, JSON.stringify({
        protocols: statuses.map((status, index) => ({
          ...protocolTemplate,
          id: `protocol-${index}`,
          status,
        })),
        schemaVersion: 1,
      }));
      const registry = await loadResearchProtocolRegistry(path);
      expect(registry.protocols.map((protocol) => protocol.status)).toEqual(
        [...statuses],
      );
      expect(activeResearchProtocols(registry).map((protocol) => protocol.id))
        .toEqual(["protocol-1"]);
      expect(findActiveResearchProtocol(registry, "protocol-1").status).toBe(
        "active",
      );
      expect(() => findActiveResearchProtocol(registry, "protocol-0")).toThrow(
        "is not active",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("verifies the proof closure after a legacy projection and preserves its identity", async () => {
    await withFixture(async (root, legacy) => {
      const canonicalArtifacts = ["asset-lock.json", "contract.json"];
      expect(
        await runSourceV4CaptureProtocol(legacy, canonicalArtifacts),
      ).toMatchObject({
        assetBytes: legacy.assetBytes,
        captureIdentity: legacy.captureIdentity,
        protocolId: SOURCE_V4_PROTOCOL_ID,
      });
      const result = await verifySourceV4CaptureProtocol(
        root,
        legacy,
        canonicalArtifacts,
      );
      const assetLock = await buildProofFileRef(root, "asset-lock.json");
      const files = [...legacy.files, assetLock].sort((left, right) =>
        Buffer.compare(Buffer.from(left.path), Buffer.from(right.path))
      );
      expect(result).toEqual({
        assetBytes: legacy.assetBytes,
        captureIdentity: legacy.captureIdentity,
        proofClosure: {
          fileCount: 2,
          sha256: proofIdentity({
            files,
            protocolId: SOURCE_V4_PROTOCOL_ID,
          }).sha256,
        },
        protocolId: SOURCE_V4_PROTOCOL_ID,
        selectedRepositoryCount: legacy.selectedRepositoryCount,
      });

      await expect(
        verifySourceV4ProofBoundary(root, legacy, ["asset-lock.json"]),
      ).rejects.toThrow("canonical artifact set mismatch");
      await writeFile(join(root, "asset-lock.json"), "substituted-lock");
      await expect(
        verifySourceV4CaptureProtocol(
          root,
          legacy,
          canonicalArtifacts,
        ),
      ).rejects.toThrow("asset lock identity mismatch");
      await writeFile(join(root, "asset-lock.json"), "asset-lock");
      await writeFile(join(root, "contract.json"), "changed");
      await expect(
        verifySourceV4ProofBoundary(root, legacy, canonicalArtifacts),
      ).rejects.toThrow("byte identity mismatch");
    });
  });

  it("keeps historical C6 imports behind legacy-inputs", async () => {
    const root = join(process.cwd(), "scripts", "research", "c6");
    const files = await walk(root);
    for (const path of files) {
      const source = await readFile(path, "utf8");
      if (relative(root, path).startsWith("legacy-inputs/")) {
        continue;
      }
      expect(source).not.toContain("codex-coding-effect/");
    }
  });
});

async function withFixture(
  run: (
    root: string,
    projection: LegacySourceV4Projection,
  ) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "goodmemory-source-v4-proof-"));
  try {
    await writeFile(join(root, "asset-lock.json"), "asset-lock");
    await writeFile(join(root, "contract.json"), "contract");
    const assetLock = await buildProofFileRef(root, "asset-lock.json");
    const contract = await buildProofFileRef(root, "contract.json");
    const hash = "a".repeat(64);
    await run(root, {
      assetBytes: 18,
      captureIdentity: {
        assetLockSha256: assetLock.sha256,
        assetRootSha256: hash,
        pilotExclusionReceiptSha256: hash,
        prefixReceiptSha256: hash,
        selectedRepositoriesSha256: hash,
        selectionReceiptSha256: hash,
        v4ContractSha256: hash,
      },
      files: [contract],
      selectedRepositoryCount: 16_384,
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

async function walk(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(path));
    } else if (entry.isFile() && path.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files;
}
