import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, join } from "node:path";

import { afterAll, describe, expect, it } from "bun:test";

import {
  parseC6LiveMultiLangNeighborStructuralQualification,
} from "../../scripts/codex-coding-effect/c6-live-multilang-neighbor-structural-qualification";
import {
  buildC6LiveMultiLangNeighborStructuralUnion,
  deriveC6LiveMultiLangNeighborStructuralUnion,
  materializeC6LiveMultiLangNeighborStructuralUnion,
  parseC6LiveMultiLangNeighborStructuralUnion,
  serializeC6LiveMultiLangNeighborStructuralUnion,
} from "../../scripts/codex-coding-effect/c6-live-multilang-neighbor-structural-union";
import {
  parseC6LiveMultiLangNeighborStructuralUnionCliOptions,
} from "../../scripts/snapshot-codex-coding-effect-c6-live-multilang-neighbor-structural-union";

const SOURCE_POOL_ROOT = join(
  process.cwd(),
  "fixtures/codex-coding-effect/c6-source-pool",
);
const WAVE1_PATH = join(
  SOURCE_POOL_ROOT,
  "swe-bench-live-multilang-608f7ae9." +
    "neighbor-structural-qualification-v1.json",
);
const WAVE2_PATH = join(
  SOURCE_POOL_ROOT,
  "swe-bench-live-multilang-608f7ae9." +
    "neighbor-continuation-structural-qualification-v1.json",
);
const EXPECTED_COUNTS = {
  exactStructuralCandidateCount: 56,
  exactStructuralRepositoryCount: 31,
  noExactStructuralSequenceCount: 1_278,
  projectedStructuralEventCount: 1_479,
  pullAuthorOccurrenceCount: 1_334,
  repositoryCappedStructuralCeiling: 52,
  reviewerActorOccurrenceCount: 5_886,
  reviewerUniqueLoginCount: 507,
  targetCount: 1_334,
} as const;
const temporaryRoots: string[] = [];

afterAll(async () => {
  await Promise.all(
    temporaryRoots.map((root) =>
      rm(root, { force: true, recursive: true })
    ),
  );
});

describe("C6 live multilingual neighbor structural union", () => {
  it("combines both frozen qualifications in wave order with strict provenance", async () => {
    const union = deriveC6LiveMultiLangNeighborStructuralUnion({
      wave1: await readQualification(WAVE1_PATH),
      wave2: await readQualification(WAVE2_PATH),
    });
    const serialized =
      serializeC6LiveMultiLangNeighborStructuralUnion(union);

    expect(union.counts).toEqual(EXPECTED_COUNTS);
    expect(union.boundary).toEqual({
      acceptedEpisodeCount: 0,
      actorCaptureExecuted: false,
      actorQualifiedEpisodeCount: 0,
      candidateManifestFrozen: false,
      codexRunReady: false,
      evaluatorQualifiedEpisodeCount: 0,
      machineQualifiedEpisodeCount: 0,
      semanticallyQualifiedEpisodeCount: 0,
      status: "pre-actor-structural-union-only",
    });
    expect(union.inputs.wave1.qualification).toEqual({
      artifactKind:
        "c6-live-multilang-neighbor-structural-qualification",
      bytes: 1_358_575,
      path:
        "swe-bench-live-multilang-608f7ae9.neighbor-structural-qualification-v1.json",
      schemaVersion: 1,
      sha256:
        "ae096d86f779cb04f1fb0bb336d6bb4e02ced04e72385d9332d4dba82a9c1210",
    });
    expect(union.inputs.wave2.qualification).toEqual({
      artifactKind:
        "c6-live-multilang-neighbor-structural-qualification",
      bytes: 1_159_147,
      path:
        "swe-bench-live-multilang-608f7ae9.neighbor-continuation-structural-qualification-v1.json",
      schemaVersion: 1,
      sha256:
        "9dc625cbfb5c1c0bc47f9b09511b9ce7c8df789bf4bcbaafa2d8d182dd88be91",
    });
    expect(union.results[0]).toMatchObject({
      sourceCaptureOrder: 1,
      sourceWave: "wave1",
      unionOrder: 1,
    });
    expect(union.results[691]).toMatchObject({
      sourceCaptureOrder: 692,
      sourceWave: "wave1",
      unionOrder: 692,
    });
    expect(union.results[692]).toMatchObject({
      sourceCaptureOrder: 1,
      sourceWave: "wave2",
      unionOrder: 693,
    });
    expect(union.results.at(-1)).toMatchObject({
      sourceCaptureOrder: 642,
      sourceWave: "wave2",
      unionOrder: 1_334,
    });
    expect(union.reviewerActorOccurrences).toHaveLength(5_886);
    expect(union.pullAuthorOccurrences).toHaveLength(1_334);
    expect(union.reviewerLogins).toHaveLength(507);
    expect(parseC6LiveMultiLangNeighborStructuralUnion(serialized))
      .toEqual(union);
    expect(() =>
      parseC6LiveMultiLangNeighborStructuralUnion(
        JSON.stringify(union),
      )
    ).toThrow(/canonical JSON/u);
    const tainted = Object.assign(structuredClone(union), {
      actorQualifiedEpisodeCount: 56,
    });
    expect(() =>
      serializeC6LiveMultiLangNeighborStructuralUnion(tainted)
    ).toThrow();
    const provenanceDrift = structuredClone(union);
    provenanceDrift.inputs.wave1.deepEvidence.assetRootSha256 =
      "f".repeat(64);
    expect(() =>
      serializeC6LiveMultiLangNeighborStructuralUnion(
        provenanceDrift,
      )
    ).toThrow(/frozen provenance mismatch/u);
  });

  it("rejects duplicate anchors, duplicate capture directories, and repository overlap", async () => {
    const wave1 = await readQualification(WAVE1_PATH);
    const wave2 = await readQualification(WAVE2_PATH);

    const duplicateAnchor = structuredClone(wave2);
    duplicateAnchor.results[0]!.canonicalAnchorId =
      wave1.results[0]!.canonicalAnchorId;
    expect(() =>
      deriveC6LiveMultiLangNeighborStructuralUnion({
        wave1,
        wave2: duplicateAnchor,
      })
    ).toThrow(/duplicate anchor/u);

    const duplicateDirectory = structuredClone(wave2);
    duplicateDirectory.results[0]!.captureDirectory =
      wave1.results[0]!.captureDirectory;
    expect(() =>
      deriveC6LiveMultiLangNeighborStructuralUnion({
        wave1,
        wave2: duplicateDirectory,
      })
    ).toThrow(/duplicate capture directory/u);

    const repositoryOverlap = structuredClone(wave2);
    repositoryOverlap.results[0]!.canonicalRepository =
      wave1.results[0]!.canonicalRepository;
    repositoryOverlap.results[0]!.canonicalAnchorId =
      `${wave1.results[0]!.canonicalRepository}#999999999`;
    expect(() =>
      deriveC6LiveMultiLangNeighborStructuralUnion({
        wave1,
        wave2: repositoryOverlap,
      })
    ).toThrow(/repository overlap/u);
  });

  it("rejects terminal child-artifact drift", async () => {
    const parent = await temporaryRoot("terminal");
    const wave1Path = join(parent, basename(WAVE1_PATH));
    await copyFile(WAVE1_PATH, wave1Path);
    let hookCalled = false;

    await expect(
      buildC6LiveMultiLangNeighborStructuralUnion({
        testHooks: {
          beforeTerminalReplay: async () => {
            hookCalled = true;
            await writeFile(wave1Path, "{}\n");
          },
        },
        wave1QualificationPath: wave1Path,
        wave2QualificationPath: WAVE2_PATH,
      }),
    ).rejects.toThrow(/hash mismatch|input closure changed/u);
    expect(hookCalled).toBe(true);
  });

  it("publishes canonically without replacing an existing output", async () => {
    const parent = await temporaryRoot("publish");
    const outputPath = join(parent, "union.json");
    const result =
      await materializeC6LiveMultiLangNeighborStructuralUnion({
        outputPath,
        wave1QualificationPath: WAVE1_PATH,
        wave2QualificationPath: WAVE2_PATH,
      });
    const publishedBytes = await readFile(outputPath);

    expect(sha256(publishedBytes)).toBe(result.outputSha256);
    expect(parseC6LiveMultiLangNeighborStructuralUnion(
      publishedBytes,
    )).toEqual(result.union);
    expect((await stat(outputPath)).mode & 0o777).toBe(0o644);

    await rm(outputPath);
    await writeFile(outputPath, "preexisting-sentinel\n", {
      mode: 0o600,
    });
    const sentinel = await stat(outputPath);
    let noReplaceError: unknown;
    try {
      await materializeC6LiveMultiLangNeighborStructuralUnion({
        outputPath,
        wave1QualificationPath: WAVE1_PATH,
        wave2QualificationPath: WAVE2_PATH,
      });
    } catch (error) {
      noReplaceError = error;
    }
    expect(noReplaceError).toMatchObject({ code: "EEXIST" });
    expect(await readFile(outputPath, "utf8")).toBe(
      "preexisting-sentinel\n",
    );
    expect(await stat(outputPath)).toMatchObject({
      dev: sentinel.dev,
      ino: sentinel.ino,
      mode: sentinel.mode,
    });
    expect(await readdir(parent)).toEqual(["union.json"]);
  });

  it("preserves a foreign output replacement during rollback", async () => {
    const parent = await temporaryRoot("foreign-output");
    const outputPath = join(parent, "union.json");
    let hookCalled = false;

    await expect(
      materializeC6LiveMultiLangNeighborStructuralUnion({
        outputPath,
        testHooks: {
          afterOutputPublication: async () => {
            hookCalled = true;
            await rm(outputPath);
            await writeFile(outputPath, "foreign-output\n", {
              mode: 0o644,
            });
            throw new Error("injected foreign output");
          },
        },
        wave1QualificationPath: WAVE1_PATH,
        wave2QualificationPath: WAVE2_PATH,
      }),
    ).rejects.toThrow(/injected foreign output/u);
    expect(hookCalled).toBe(true);
    expect(await readFile(outputPath, "utf8")).toBe(
      "foreign-output\n",
    );
    expect(await readdir(parent)).toEqual(["union.json"]);
  });

  it("uses the recorded inode when the temporary hard link is replaced", async () => {
    const parent = await temporaryRoot("foreign-temporary");
    const wave2Path = join(parent, basename(WAVE2_PATH));
    await copyFile(WAVE2_PATH, wave2Path);
    const outputPath = join(parent, "union.json");
    let foreignTemporaryPath: string | null = null;

    await expect(
      materializeC6LiveMultiLangNeighborStructuralUnion({
        outputPath,
        testHooks: {
          afterOutputPublication: async () => {
            const temporaryName = (await readdir(parent)).find(
              (name) => name.includes(".incomplete-"),
            );
            if (temporaryName === undefined) {
              throw new Error("union temporary hard link missing");
            }
            foreignTemporaryPath = join(parent, temporaryName);
            await rm(foreignTemporaryPath);
            await writeFile(
              foreignTemporaryPath,
              "foreign-temporary\n",
              { mode: 0o644 },
            );
            await writeFile(wave2Path, "{}\n");
          },
        },
        wave1QualificationPath: WAVE1_PATH,
        wave2QualificationPath: wave2Path,
      }),
    ).rejects.toThrow(/hash mismatch/u);
    expect(await readdir(parent)).toContain(
      basename(foreignTemporaryPath!),
    );
    expect(await readFile(foreignTemporaryPath!, "utf8")).toBe(
      "foreign-temporary\n",
    );
    expect(await readdir(parent)).not.toContain("union.json");
  });

  it("rejects terminal mode drift on an owned output", async () => {
    const parent = await temporaryRoot("mode");
    const outputPath = join(parent, "union.json");

    await expect(
      materializeC6LiveMultiLangNeighborStructuralUnion({
        outputPath,
        testHooks: {
          afterOutputPublication: async () => {
            await chmod(outputPath, 0o600);
          },
        },
        wave1QualificationPath: WAVE1_PATH,
        wave2QualificationPath: WAVE2_PATH,
      }),
    ).rejects.toThrow(/published output ownership mismatch/u);
    expect(await readdir(parent)).toEqual([]);
  });

  it("propagates rollback path-access errors instead of treating them as missing", async () => {
    const parent = await temporaryRoot("rollback-access");
    const outputPath = join(parent, "union.json");
    let caught: unknown;

    try {
      await materializeC6LiveMultiLangNeighborStructuralUnion({
        outputPath,
        testHooks: {
          afterOutputPublication: async () => {
            await chmod(parent, 0o000);
            throw new Error("injected rollback");
          },
        },
        wave1QualificationPath: WAVE1_PATH,
        wave2QualificationPath: WAVE2_PATH,
      });
    } catch (error) {
      caught = error;
    } finally {
      await chmod(parent, 0o700);
    }

    expect(caught).toMatchObject({ code: "EACCES" });
  });

  it("uses an exact and closed CLI option surface", () => {
    expect(
      parseC6LiveMultiLangNeighborStructuralUnionCliOptions([
        "--wave1-qualification=/wave1.json",
        "--wave2-qualification=/wave2.json",
        "--output=/union.json",
      ]),
    ).toEqual({
      output: "/union.json",
      wave1Qualification: "/wave1.json",
      wave2Qualification: "/wave2.json",
    });
    expect(() =>
      parseC6LiveMultiLangNeighborStructuralUnionCliOptions([
        "--wave1-qualification=/wave1.json",
        "--wave2-qualification=/wave2.json",
        "--output=/union.json",
        "--actor-qualified=true",
      ])
    ).toThrow(/unknown/u);
  });
});

async function readQualification(path: string) {
  return parseC6LiveMultiLangNeighborStructuralQualification(
    await readFile(path),
  );
}

async function temporaryRoot(label: string): Promise<string> {
  const root = await mkdtemp(
    `/private/tmp/goodmemory-c6-structural-union-${label}-`,
  );
  temporaryRoots.push(root);
  return root;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
