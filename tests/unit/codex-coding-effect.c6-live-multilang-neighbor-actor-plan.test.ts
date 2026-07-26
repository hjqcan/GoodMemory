import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  chmod,
  cp,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { basename, join } from "node:path";

import { afterAll, describe, expect, it } from "bun:test";

import {
  buildC6LiveMultiLangNeighborActorPlan,
  deriveC6LiveMultiLangNeighborActorPlan,
  materializeC6LiveMultiLangNeighborActorPlan,
  parseC6LiveMultiLangNeighborActorPlan,
  serializeC6LiveMultiLangNeighborActorPlan,
} from "../../scripts/codex-coding-effect/c6-live-multilang-neighbor-actor-plan";
import {
  parseC6LiveMultiLangNeighborActorPlanCliOptions,
} from "../../scripts/snapshot-codex-coding-effect-c6-live-multilang-neighbor-actor-plan";
import {
  parseC6LiveMultiLangNeighborStructuralQualification,
} from "../../scripts/codex-coding-effect/c6-live-multilang-neighbor-structural-qualification";

const STRUCTURAL_PATH = join(
  process.cwd(),
  "fixtures/codex-coding-effect/c6-source-pool/" +
    "swe-bench-live-multilang-608f7ae9." +
    "neighbor-structural-qualification-v1.json",
);
const STRUCTURAL_SHA256 =
  "ae096d86f779cb04f1fb0bb336d6bb4e02ced04e72385d9332d4dba82a9c1210";
const ACTOR_PLAN_SHA256 =
  "abb0a817611c7f5568c0f3390625598a46a1a56c687617815260ee98121a92d3";
const ACTOR_TARGET_PROJECTION_SHA256 =
  "8393f1a04a25b3288932b954ab5825ec8ceca37f57dd3d3da8dc9bdd7ac62205";
const temporaryRoots: string[] = [];

afterAll(async () => {
  await Promise.all(
    temporaryRoots.map((root) =>
      rm(root, { force: true, recursive: true })
    ),
  );
});

describe("C6 live multilingual neighbor Wave1 actor plan", () => {
  it("derives all 267 normalized actors from the complete occurrence closure", async () => {
    const structuralBytes = await readFile(STRUCTURAL_PATH);
    const qualification =
      parseC6LiveMultiLangNeighborStructuralQualification(
        structuralBytes,
      );
    const plan = deriveC6LiveMultiLangNeighborActorPlan({
      qualification,
      structuralArtifact: {
        bytes: structuralBytes.byteLength,
        path: basename(STRUCTURAL_PATH),
        sha256: hash(structuralBytes),
      },
    });

    expect(plan.counts).toEqual({
      sourceReviewReferenceCount: 3_185,
      sourceTargetCount: 692,
      uniqueActorCount: 267,
    });
    expect(plan.targets).toHaveLength(267);
    expect(plan.targets[0]).toEqual({
      captureDirectory: `actor-${hash("0101")}`,
      captureOrder: 1,
      login: "0101",
    });
    expect(plan.targets.at(-1)).toEqual({
      captureDirectory: `actor-${hash("yxmura")}`,
      captureOrder: 267,
      login: "yxmura",
    });
    expect(plan.targets.map((target) => target.login)).toEqual(
      [...qualification.reviewerLogins].sort(),
    );
    expect(new Set(plan.targets.map((target) => target.login)).size)
      .toBe(267);
    expect(plan.boundary).toEqual({
      acceptedEpisodeCount: 0,
      actorCaptureExecuted: false,
      candidateManifestFrozen: false,
      codexRunReady: false,
      status: "reviewer-actor-identity-capture-required",
    });
    expect(plan.inputs).toEqual({
      deepCapturePlan: {
        bytes: 518_443,
        path:
          "swe-bench-live-multilang-608f7ae9." +
          "neighbor-deep-capture-plan-v1.json",
        sha256:
          "9c1ebdafd700a274cffc4dba807a2425013079d1bfe74a1e99f1144399da492a",
      },
      deepEvidence: {
        assetRootSha256:
          "80c360d58b1959e5a47cbd70c5eb620276ed2105c49a595dccdb4aa178d1f83b",
        completionSha256:
          "62ba6ada2d0ae54f4d43149e592ec06b70899e712a12f97dd503d8650ff2063d",
        directoryCount: 2_771,
        fileCount: 2_772,
        finalSuccessfulResponseCount: 693,
        logicalRequestCount: 693,
        networkRequestCount: 693,
        targetProjectionSha256:
          "7286f92d0b211ab6830727969d2c40e691e73b1b55197fce221a271ef14edbcf",
      },
      graphqlRootSha256:
        "80c360d58b1959e5a47cbd70c5eb620276ed2105c49a595dccdb4aa178d1f83b",
      qualification: {
        bytes: 1_358_575,
        path:
          "swe-bench-live-multilang-608f7ae9." +
          "neighbor-structural-qualification-v1.json",
        sha256: STRUCTURAL_SHA256,
      },
    });
    expect(plan.independenceBoundary).toMatchObject({
      goldInput: false,
      machineOutcomeInput: false,
      patchInput: false,
      reviewerActorOccurrenceProjectionSha256:
        "881aafcfad9a9675e353adb8b2a3aaa8fd623ff0525c29ba34a3b08f29ee0c49",
      reviewerLoginProjectionSha256:
        "a26324b895357d9191a0d84baddbca968bea218859d968a743ebdd7b48f0aa34",
      semanticLedgerInput: false,
      selectedSequenceInput: false,
      testInput: false,
    });
    expect(plan.independenceBoundary.targetProjectionSha256).toBe(
      ACTOR_TARGET_PROJECTION_SHA256,
    );
    expect(hash(JSON.stringify(plan.targets))).toBe(
      ACTOR_TARGET_PROJECTION_SHA256,
    );
  });

  it("rejects any omitted or extra actor and forbidden metadata", async () => {
    const structuralBytes = await readFile(STRUCTURAL_PATH);
    const qualification =
      parseC6LiveMultiLangNeighborStructuralQualification(
        structuralBytes,
      );
    const omitted = structuredClone(qualification);
    omitted.reviewerLogins.pop();
    expect(() =>
      deriveC6LiveMultiLangNeighborActorPlan({
        qualification: omitted,
        structuralArtifact: {
          bytes: structuralBytes.byteLength,
          path: basename(STRUCTURAL_PATH),
          sha256: hash(structuralBytes),
        },
      })
    ).toThrow();
    const extra = structuredClone(qualification);
    extra.reviewerLogins.push("zz-unobserved-actor");
    expect(() =>
      deriveC6LiveMultiLangNeighborActorPlan({
        qualification: extra,
        structuralArtifact: {
          bytes: structuralBytes.byteLength,
          path: basename(STRUCTURAL_PATH),
          sha256: hash(structuralBytes),
        },
      })
    ).toThrow();

    const plan = deriveC6LiveMultiLangNeighborActorPlan({
      qualification,
      structuralArtifact: {
        bytes: structuralBytes.byteLength,
        path: basename(STRUCTURAL_PATH),
        sha256: hash(structuralBytes),
      },
    });
    const raw = JSON.parse(
      serializeC6LiveMultiLangNeighborActorPlan(plan),
    ) as Record<string, unknown>;
    raw.hiddenEvaluatorMetadata = {
      goldPatch: "forbidden",
      machineOutcome: "forbidden",
    };
    expect(() =>
      parseC6LiveMultiLangNeighborActorPlan(
        `${JSON.stringify(raw, null, 2)}\n`,
      )
    ).toThrow();
  });

  it("builds only from the exact tracked structural artifact and replays it terminally", async () => {
    const result = await buildC6LiveMultiLangNeighborActorPlan({
      structuralQualificationPath: STRUCTURAL_PATH,
    });

    expect(result.plan.counts.uniqueActorCount).toBe(267);
    expect(result.plan.inputs.qualification.sha256).toBe(
      STRUCTURAL_SHA256,
    );
    expect(result.outputSha256).toBe(ACTOR_PLAN_SHA256);

    const parent = await mkdtemp(
      "/private/tmp/goodmemory-c6-wave1-actor-plan-drift-",
    );
    temporaryRoots.push(parent);
    const structuralPath = join(parent, basename(STRUCTURAL_PATH));
    await cp(STRUCTURAL_PATH, structuralPath);
    let hookCalled = false;
    await expect(
      buildC6LiveMultiLangNeighborActorPlan({
        structuralQualificationPath: structuralPath,
        testHooks: {
          beforeTerminalReplay: async () => {
            hookCalled = true;
            await writeFile(structuralPath, "{}\n");
          },
        },
      }),
    ).rejects.toThrow(/changed|hash mismatch/u);
    expect(hookCalled).toBe(true);
  });

  it("rejects a symlinked structural input", async () => {
    const parent = await mkdtemp(
      "/private/tmp/goodmemory-c6-wave1-actor-plan-symlink-",
    );
    temporaryRoots.push(parent);
    const structuralPath = join(parent, basename(STRUCTURAL_PATH));
    await symlink(STRUCTURAL_PATH, structuralPath);

    await expect(
      buildC6LiveMultiLangNeighborActorPlan({
        structuralQualificationPath: structuralPath,
      }),
    ).rejects.toThrow(/symlink/u);
  });

  it("rolls back its owned output when post-publication replay sees input drift", async () => {
    const parent = await mkdtemp(
      "/private/tmp/goodmemory-c6-wave1-actor-plan-output-",
    );
    temporaryRoots.push(parent);
    const structuralPath = join(parent, basename(STRUCTURAL_PATH));
    await cp(STRUCTURAL_PATH, structuralPath);
    const outputPath = join(parent, "actor-plan.json");
    let hookCalled = false;

    await expect(
      materializeC6LiveMultiLangNeighborActorPlan({
        outputPath,
        structuralQualificationPath: structuralPath,
        testHooks: {
          afterOutputPublication: async () => {
            hookCalled = true;
            await writeFile(structuralPath, "{}\n");
          },
        },
      }),
    ).rejects.toThrow(/hash mismatch/u);
    expect(hookCalled).toBe(true);
    expect(existsSync(outputPath)).toBe(false);
    expect(await readdir(parent)).toEqual([basename(STRUCTURAL_PATH)]);
  });

  it("does not delete a foreign output replacement during rollback", async () => {
    const parent = await mkdtemp(
      "/private/tmp/goodmemory-c6-wave1-actor-plan-foreign-",
    );
    temporaryRoots.push(parent);
    const outputPath = join(parent, "actor-plan.json");
    let hookCalled = false;

    await expect(
      materializeC6LiveMultiLangNeighborActorPlan({
        outputPath,
        structuralQualificationPath: STRUCTURAL_PATH,
        testHooks: {
          afterOutputPublication: async () => {
            hookCalled = true;
            await rm(outputPath);
            await writeFile(outputPath, "foreign-agent-output\n", {
              mode: 0o644,
            });
            throw new Error("injected foreign replacement");
          },
        },
      }),
    ).rejects.toThrow(/injected foreign replacement/u);
    expect(hookCalled).toBe(true);
    expect(await readFile(outputPath, "utf8")).toBe(
      "foreign-agent-output\n",
    );
    expect(await readdir(parent)).toEqual(["actor-plan.json"]);
  });

  it("uses its recorded inode if the temporary hard link is replaced", async () => {
    const parent = await mkdtemp(
      "/private/tmp/goodmemory-c6-wave1-actor-plan-temp-",
    );
    temporaryRoots.push(parent);
    const structuralPath = join(parent, basename(STRUCTURAL_PATH));
    await cp(STRUCTURAL_PATH, structuralPath);
    const outputPath = join(parent, "actor-plan.json");
    let foreignTemporaryPath: string | null = null;

    await expect(
      materializeC6LiveMultiLangNeighborActorPlan({
        outputPath,
        structuralQualificationPath: structuralPath,
        testHooks: {
          afterOutputPublication: async () => {
            const temporaryName = (await readdir(parent)).find(
              (name) => name.includes(".incomplete-"),
            );
            if (temporaryName === undefined) {
              throw new Error("test temporary hard-link missing");
            }
            foreignTemporaryPath = join(parent, temporaryName);
            await rm(foreignTemporaryPath);
            await writeFile(
              foreignTemporaryPath,
              "foreign-temporary-output\n",
              { mode: 0o644 },
            );
            await writeFile(structuralPath, "{}\n");
          },
        },
      }),
    ).rejects.toThrow(/hash mismatch/u);
    expect(existsSync(outputPath)).toBe(false);
    expect(foreignTemporaryPath).not.toBeNull();
    expect(await readFile(foreignTemporaryPath!, "utf8")).toBe(
      "foreign-temporary-output\n",
    );
  });

  it("rejects terminal mode drift and removes only its owned links", async () => {
    const parent = await mkdtemp(
      "/private/tmp/goodmemory-c6-wave1-actor-plan-mode-",
    );
    temporaryRoots.push(parent);
    const outputPath = join(parent, "actor-plan.json");

    await expect(
      materializeC6LiveMultiLangNeighborActorPlan({
        outputPath,
        structuralQualificationPath: STRUCTURAL_PATH,
        testHooks: {
          afterOutputPublication: async () => {
            await chmod(outputPath, 0o600);
          },
        },
      }),
    ).rejects.toThrow(/published output ownership mismatch/u);
    expect(await readdir(parent)).toEqual([]);
  });

  it("publishes mode 0644 and refuses to replace an existing output", async () => {
    const parent = await mkdtemp(
      "/private/tmp/goodmemory-c6-wave1-actor-plan-publish-",
    );
    temporaryRoots.push(parent);
    const outputPath = join(parent, "actor-plan.json");
    const result = await materializeC6LiveMultiLangNeighborActorPlan({
      outputPath,
      structuralQualificationPath: STRUCTURAL_PATH,
    });
    const publishedBytes = await readFile(outputPath);

    expect(hash(publishedBytes)).toBe(result.outputSha256);
    expect(parseC6LiveMultiLangNeighborActorPlan(publishedBytes))
      .toEqual(result.plan);
    expect((await stat(outputPath)).mode & 0o777).toBe(0o644);

    await rm(outputPath);
    await writeFile(outputPath, "preexisting-sentinel\n", {
      mode: 0o600,
    });
    const sentinelStat = await stat(outputPath);
    let noReplaceError: unknown;
    try {
      await materializeC6LiveMultiLangNeighborActorPlan({
        outputPath,
        structuralQualificationPath: STRUCTURAL_PATH,
      });
    } catch (error) {
      noReplaceError = error;
    }
    expect(noReplaceError).toMatchObject({ code: "EEXIST" });
    expect(await readFile(outputPath, "utf8")).toBe(
      "preexisting-sentinel\n",
    );
    expect(await stat(outputPath)).toMatchObject({
      dev: sentinelStat.dev,
      ino: sentinelStat.ino,
      mode: sentinelStat.mode,
    });
    expect(await readdir(parent)).toEqual(["actor-plan.json"]);
  });

  it("uses an exact and closed CLI option surface", () => {
    expect(
      parseC6LiveMultiLangNeighborActorPlanCliOptions([
        "--structural-qualification=/structural.json",
        "--output=/actor-plan.json",
      ]),
    ).toEqual({
      output: "/actor-plan.json",
      structuralQualification: "/structural.json",
    });
    expect(() =>
      parseC6LiveMultiLangNeighborActorPlanCliOptions([
        "--structural-qualification=/structural.json",
        "--output=/actor-plan.json",
        "--machine-outcome=/forbidden.json",
      ])
    ).toThrow(/unknown/u);
  });
});

function hash(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
