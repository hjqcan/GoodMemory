import {
  chmod,
  mkdtemp,
  readFile,
  realpath,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { afterAll, describe, expect, it } from "bun:test";

import {
  buildC6LiveMultiLangNeighborActorPlanV2,
  deriveC6LiveMultiLangNeighborActorPlanV2,
  materializeC6LiveMultiLangNeighborActorPlanV2,
  parseC6LiveMultiLangNeighborActorPlanV2,
  serializeC6LiveMultiLangNeighborActorPlanV2,
} from "../../scripts/codex-coding-effect/c6-live-multilang-neighbor-actor-plan-v2";
import {
  buildC6LiveMultiLangNeighborStructuralUnion,
  serializeC6LiveMultiLangNeighborStructuralUnion,
} from "../../scripts/codex-coding-effect/c6-live-multilang-neighbor-structural-union";
import {
  parseC6LiveMultiLangNeighborActorPlanV2CliOptions,
} from "../../scripts/snapshot-codex-coding-effect-c6-live-multilang-neighbor-actor-plan-v2";

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
const UNION_BASENAME =
  "swe-bench-live-multilang-608f7ae9." +
  "neighbor-structural-union-v1.json";
const temporaryRoots: string[] = [];

afterAll(async () => {
  await Promise.all(
    temporaryRoots.map((root) =>
      rm(root, { force: true, recursive: true })
    ),
  );
});

describe("C6 live multilingual neighbor actor plan v2", () => {
  it("derives one stable outcome-blind target per union reviewer login", async () => {
    const union = await buildUnion();
    const plan = deriveC6LiveMultiLangNeighborActorPlanV2(union);
    const serialized =
      serializeC6LiveMultiLangNeighborActorPlanV2(plan);

    expect(plan.counts).toEqual({
      sourceReviewReferenceCount: 5_886,
      sourceTargetCount: 1_334,
      uniqueActorCount: 507,
    });
    expect(plan.boundary).toEqual({
      acceptedEpisodeCount: 0,
      actorCaptureExecuted: false,
      actorQualifiedEpisodeCount: 0,
      candidateManifestFrozen: false,
      codexRunReady: false,
      evaluatorQualifiedEpisodeCount: 0,
      machineQualifiedEpisodeCount: 0,
      semanticallyQualifiedEpisodeCount: 0,
      status: "reviewer-actor-identity-capture-required",
    });
    expect(plan.inputs.structuralUnion).toEqual({
      artifactKind:
        "c6-live-multilang-neighbor-structural-union",
      bytes: 2_597_956,
      path: UNION_BASENAME,
      reviewerLoginProjectionSha256:
        "4c03e130ce0b6c945f2bf526c3cfa0c25e5c17f0734cc34eafb264ebb9d56a61",
      schemaVersion: 1,
      sha256:
        "3a438e999450b96c039dbea6eba7ae971bb03223c42c2b2ff502f85ed76ad208",
    });
    expect("policy" in plan).toBe(false);
    expect(
      plan.independenceBoundary.actorEligibilityDecisionInput,
    ).toBe(false);
    expect(plan.targets).toHaveLength(507);
    expect(plan.targets[0]).toEqual({
      captureDirectory:
        "actor-07334386287751ba02a4588c1a0875dbd074a61bd9e6ab7c48d244eacd0c99e0",
      captureOrder: 1,
      login: "0101",
    });
    expect(plan.targets.at(-1)).toEqual({
      captureDirectory:
        "actor-223559079c6f0af6e5cc35df565408339684891c719b2d5768b7a183934c423b",
      captureOrder: 507,
      login: "zwick",
    });
    expect(plan.independenceBoundary.targetProjectionSha256).toBe(
      "68ac8d1823039f7375dc6903676ed146b3704511c4bb79bd077a15d38bc5b53c",
    );
    expect(parseC6LiveMultiLangNeighborActorPlanV2(serialized))
      .toEqual(plan);
  });

  it("rejects extra fields in the union and serialized plan", async () => {
    const union = await buildUnion();
    const taintedUnion = Object.assign(structuredClone(union), {
      selectedEpisodeCount: 56,
    });
    expect(() =>
      deriveC6LiveMultiLangNeighborActorPlanV2(taintedUnion)
    ).toThrow();

    const plan = deriveC6LiveMultiLangNeighborActorPlanV2(union);
    const taintedPlan = Object.assign(structuredClone(plan), {
      actorSelectionOutcome: "accepted",
    });
    expect(() =>
      serializeC6LiveMultiLangNeighborActorPlanV2(taintedPlan)
    ).toThrow();
    const policyTaintedPlan = Object.assign(structuredClone(plan), {
      policy: {
        policyId: "reviewer-platform-actor-eligibility-v2",
      },
    });
    expect(() =>
      serializeC6LiveMultiLangNeighborActorPlanV2(
        policyTaintedPlan,
      )
    ).toThrow();
  });

  it("rejects duplicate, missing, and out-of-order reviewer logins", async () => {
    const union = await buildUnion();
    const duplicate = structuredClone(union);
    duplicate.reviewerLogins[1] = duplicate.reviewerLogins[0]!;
    expect(() =>
      deriveC6LiveMultiLangNeighborActorPlanV2(duplicate)
    ).toThrow(/reviewer login closure mismatch/u);

    const missing = structuredClone(union);
    missing.reviewerLogins.pop();
    expect(() =>
      deriveC6LiveMultiLangNeighborActorPlanV2(missing)
    ).toThrow(/reviewer login closure mismatch/u);

    const outOfOrder = structuredClone(union);
    [
      outOfOrder.reviewerLogins[0],
      outOfOrder.reviewerLogins[1],
    ] = [
      outOfOrder.reviewerLogins[1]!,
      outOfOrder.reviewerLogins[0]!,
    ];
    expect(() =>
      deriveC6LiveMultiLangNeighborActorPlanV2(outOfOrder)
    ).toThrow(/reviewer login closure mismatch/u);
  });

  it("rejects union provenance and frozen-file hash drift", async () => {
    const union = await buildUnion();
    const provenanceDrift = structuredClone(union);
    Object.assign(provenanceDrift.inputs.wave1.qualification, {
      sha256: "f".repeat(64),
    });
    expect(() =>
      deriveC6LiveMultiLangNeighborActorPlanV2(provenanceDrift)
    ).toThrow();

    const { path } = await writeUnionFixture();
    await writeFile(path, `${await readFile(path, "utf8")}\n`);
    await expect(
      buildC6LiveMultiLangNeighborActorPlanV2({
        structuralUnionPath: path,
      }),
    ).rejects.toThrow(/hash mismatch/u);
  });

  it("rejects terminal structural-union drift", async () => {
    const { path } = await writeUnionFixture();
    let hookCalled = false;

    await expect(
      buildC6LiveMultiLangNeighborActorPlanV2({
        structuralUnionPath: path,
        testHooks: {
          beforeTerminalReplay: async () => {
            hookCalled = true;
            await writeFile(path, "{}\n");
          },
        },
      }),
    ).rejects.toThrow(/hash mismatch|input closure changed/u);
    expect(hookCalled).toBe(true);
  });

  it("publishes canonically without replacing an existing output", async () => {
    const { parent, path } = await writeUnionFixture();
    const outputPath = join(parent, "actor-plan-v2.json");
    const result =
      await materializeC6LiveMultiLangNeighborActorPlanV2({
        outputPath,
        structuralUnionPath: path,
      });
    const publishedBytes = await readFile(outputPath);

    expect(parseC6LiveMultiLangNeighborActorPlanV2(
      publishedBytes,
    )).toEqual(result.plan);
    expect((await stat(outputPath)).mode & 0o777).toBe(0o644);

    await rm(outputPath);
    await writeFile(outputPath, "preexisting-sentinel\n", {
      mode: 0o600,
    });
    const sentinel = await stat(outputPath);
    let noReplaceError: unknown;
    try {
      await materializeC6LiveMultiLangNeighborActorPlanV2({
        outputPath,
        structuralUnionPath: path,
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
  });

  it("preserves foreign publication identities during rollback", async () => {
    const outputFixture = await writeUnionFixture();
    const outputPath = join(
      outputFixture.parent,
      "actor-plan-v2.json",
    );
    await expect(
      materializeC6LiveMultiLangNeighborActorPlanV2({
        outputPath,
        structuralUnionPath: outputFixture.path,
        testHooks: {
          afterOutputPublication: async () => {
            await rm(outputPath);
            await writeFile(outputPath, "foreign-output\n", {
              mode: 0o644,
            });
            throw new Error("injected foreign output");
          },
        },
      }),
    ).rejects.toThrow(/injected foreign output/u);
    expect(await readFile(outputPath, "utf8")).toBe(
      "foreign-output\n",
    );

    const temporaryFixture = await writeUnionFixture();
    const temporaryOutputPath = join(
      temporaryFixture.parent,
      "actor-plan-v2.json",
    );
    let foreignTemporaryPath: string | null = null;
    await expect(
      materializeC6LiveMultiLangNeighborActorPlanV2({
        outputPath: temporaryOutputPath,
        structuralUnionPath: temporaryFixture.path,
        testHooks: {
          afterOutputPublication: async () => {
            const temporaryName = (
              await readdir(temporaryFixture.parent)
            ).find((name) => name.includes(".incomplete-"));
            if (temporaryName === undefined) {
              throw new Error("actor plan temporary link missing");
            }
            foreignTemporaryPath = join(
              temporaryFixture.parent,
              temporaryName,
            );
            await rm(foreignTemporaryPath);
            await writeFile(
              foreignTemporaryPath,
              "foreign-temporary\n",
              { mode: 0o644 },
            );
            await writeFile(temporaryFixture.path, "{}\n");
          },
        },
      }),
    ).rejects.toThrow(/hash mismatch/u);
    expect(await readFile(foreignTemporaryPath!, "utf8")).toBe(
      "foreign-temporary\n",
    );
    expect(await readdir(temporaryFixture.parent)).not.toContain(
      basename(temporaryOutputPath),
    );
  });

  it("removes an owned output after terminal mode mutation", async () => {
    const { parent, path } = await writeUnionFixture();
    const outputPath = join(parent, "actor-plan-v2.json");

    await expect(
      materializeC6LiveMultiLangNeighborActorPlanV2({
        outputPath,
        structuralUnionPath: path,
        testHooks: {
          afterOutputPublication: async () => {
            await chmod(outputPath, 0o600);
          },
        },
      }),
    ).rejects.toThrow(/published output ownership mismatch/u);
    expect(await readdir(parent)).toEqual([UNION_BASENAME]);
  });

  it("propagates rollback path-access errors instead of treating them as missing", async () => {
    const { parent, path } = await writeUnionFixture();
    const outputPath = join(parent, "actor-plan-v2.json");
    let caught: unknown;

    try {
      await materializeC6LiveMultiLangNeighborActorPlanV2({
        outputPath,
        structuralUnionPath: path,
        testHooks: {
          afterOutputPublication: async () => {
            await chmod(parent, 0o000);
            throw new Error("injected rollback");
          },
        },
      });
    } catch (error) {
      caught = error;
    } finally {
      await chmod(parent, 0o700);
    }

    expect(caught).toMatchObject({ code: "EACCES" });
  });

  it("uses an exact CLI surface and rejects unknown options", () => {
    expect(
      parseC6LiveMultiLangNeighborActorPlanV2CliOptions([
        "--structural-union=/union.json",
        "--output=/actor-plan-v2.json",
      ]),
    ).toEqual({
      output: "/actor-plan-v2.json",
      structuralUnion: "/union.json",
    });
    expect(() =>
      parseC6LiveMultiLangNeighborActorPlanV2CliOptions([
        "--structural-union=/union.json",
        "--output=/actor-plan-v2.json",
        "--selected-sequences=/forbidden.json",
      ])
    ).toThrow(/unknown/u);
  });
});

async function buildUnion() {
  return (
    await buildC6LiveMultiLangNeighborStructuralUnion({
      wave1QualificationPath: WAVE1_PATH,
      wave2QualificationPath: WAVE2_PATH,
    })
  ).union;
}

async function writeUnionFixture(): Promise<{
  parent: string;
  path: string;
}> {
  const parent = await mkdtemp(
    join(await realpath(tmpdir()), "goodmemory-c6-actor-plan-v2-"),
  );
  temporaryRoots.push(parent);
  const path = join(parent, UNION_BASENAME);
  await writeFile(
    path,
    serializeC6LiveMultiLangNeighborStructuralUnion(
      await buildUnion(),
    ),
    { mode: 0o644 },
  );
  return { parent, path };
}
