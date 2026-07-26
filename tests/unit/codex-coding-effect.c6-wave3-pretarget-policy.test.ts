import { createHash } from "node:crypto";
import {
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
  buildC6Wave3PretargetPolicy,
  classifyC6Wave3Pretarget,
  materializeC6Wave3PretargetPolicy,
  parseC6Wave3PretargetPolicy,
  serializeC6Wave3PretargetPolicy,
} from "../../scripts/codex-coding-effect/c6-wave3-pretarget-policy";
import {
  parseC6Wave3PretargetPolicyCliOptions,
  runC6Wave3PretargetPolicySnapshotCommand,
} from "../../scripts/snapshot-codex-coding-effect-c6-wave3-pretarget-policy";

const SOURCE_POOL_ROOT = join(
  process.cwd(),
  "fixtures/codex-coding-effect/c6-source-pool",
);
const EVIDENCE_BASENAMES = {
  structuralUnion:
    "swe-bench-live-multilang-608f7ae9." +
    "neighbor-structural-union-v1.json",
  wave1MetadataQualification:
    "swe-bench-live-multilang-608f7ae9." +
    "neighbor-census-qualification-v2.json",
  wave1StructuralQualification:
    "swe-bench-live-multilang-608f7ae9." +
    "neighbor-structural-qualification-v1.json",
  wave2MetadataQualification:
    "swe-bench-live-multilang-608f7ae9." +
    "neighbor-census-qualification-v3.json",
  wave2StructuralQualification:
    "swe-bench-live-multilang-608f7ae9." +
    "neighbor-continuation-structural-qualification-v1.json",
} as const;
const temporaryRoots: string[] = [];

afterAll(async () => {
  await Promise.all(
    temporaryRoots.map((root) =>
      rm(root, { force: true, recursive: true })
    ),
  );
});

describe("Codex coding-effect C6 Wave3 pretarget policy", () => {
  it("binds the exploratory evidence without promoting it to a frozen selection", async () => {
    const result = await buildC6Wave3PretargetPolicy(evidencePaths());
    const { policy } = result;
    const serialized = serializeC6Wave3PretargetPolicy(policy);

    expect(policy.boundary).toEqual({
      acceptedEpisodeCount: 0,
      codexRunReady: false,
      commitAncestryProven: false,
      independentReview: false,
      preregisteredBeforeWave3Capture: false,
      selectionExecuted: false,
      status: "review-and-freeze-commit-required",
    });
    expect(policy.chronology).toEqual({
      applicablePopulation: "unseen-wave3-only",
      derivedAfterWave1AndWave2Inspection: true,
      evidenceUse: "retrospective-exploratory-only",
      wave1AndWave2BackselectionProhibited: true,
    });
    expect(policy.rule).toEqual({
      canonicalPullRequestNovelAgainst:
        "frozen-pre-wave3-anchor-exclusion-set",
      canonicalRepositoryNovelAgainst:
        "frozen-pre-wave3-repository-exclusion-set",
      maximumCommitTotalCount: 250,
      minimumReviewCount: 4,
      minimumReviewThreadCount: 2,
    });
    expect(policy.observedEvidence.waves.map((wave) => ({
      exact: wave.reviewThresholdObservation.exactStructuralCount,
      selected: wave.reviewThresholdObservation.metadataCount,
      sourceWave: wave.sourceWave,
    }))).toEqual([
      { exact: 29, selected: 96, sourceWave: "wave1" },
      { exact: 20, selected: 74, sourceWave: "wave2" },
    ]);
    expect(policy.observedEvidence.combined).toMatchObject({
      exactStructuralCount: 49,
      metadataCount: 170,
      scope:
        "review-count-and-thread-count-threshold-only-no-commit-count-observation",
    });
    expect(policy.observedEvidence.waves[0]!.metadataQualification)
      .toMatchObject({
        bytes: 912_748,
        canonicalPullProjectionSha256:
          "06b6ac9ac67447b72a492e5e118b41d1eb9195895421e94ae8eb832b69c402c8",
        deepCaptureTargetProjectionSha256:
          "f45d9ef61b55d73d2b94c8018d7874ae58887fa01133a4fd77883f0548701404",
        excludedAnchorProjectionSha256:
          "f33883edbbca727e49ab68d77e517a02323174c85b973fb3f40452d4a2ea9f5b",
        existingAnchorProjectionSha256:
          "2a144a3e31a2451c8a8076a2146d0c08bf76c23d77e7ee6c3a3d174f1cbe3aa8",
        metadataQuerySha256:
          "ad41b6656f21f35e45a592e3b39549a02a0ae9536d01ac6052c1f31b0ee635d3",
        qualificationPolicySha256:
          "a80ef0981b35dc5479d9d8b346d14a4187494dbb0c0591bd4dd412cb49acb025",
        sha256:
          "e51243ea3aa740a3a0812f8c1289ac2d3cf51436440ae0ecfea67a280743f1cc",
      });
    expect(policy.observedEvidence.waves[0]!.structuralQualification)
      .toMatchObject({
        pullAuthorOccurrenceProjectionSha256:
          "72b4f597546917d0140b07c516a6a8577849f4f54e8b8ef074177a47b4aeaffc",
        reviewerActorOccurrenceProjectionSha256:
          "881aafcfad9a9675e353adb8b2a3aaa8fd623ff0525c29ba34a3b08f29ee0c49",
        reviewerLoginProjectionSha256:
          "a26324b895357d9191a0d84baddbca968bea218859d968a743ebdd7b48f0aa34",
        structuralResultProjectionSha256:
          "f599d7ced72a3cebd4f175a059a604d2bb2c09b97d81e268dd18915cdd136081",
      });
    expect(policy.observedEvidence.structuralUnion).toMatchObject({
      bytes: 2_597_956,
      pullAuthorOccurrenceProjectionSha256:
        "a35fe54aafc61279b769774c4c8e176a4a95c634cfdeaabb0f664772deb68c2c",
      reviewerActorOccurrenceProjectionSha256:
        "d426b898d5bddb5da2a187e5927695b3df6fb850168dc755ba0fd3c8e96c9fc7",
      reviewerLoginProjectionSha256:
        "4c03e130ce0b6c945f2bf526c3cfa0c25e5c17f0734cc34eafb264ebb9d56a61",
      sha256:
        "3a438e999450b96c039dbea6eba7ae971bb03223c42c2b2ff502f85ed76ad208",
      structuralResultProjectionSha256:
        "796eb8477e750a76ab96ae0eeccec00f7ee6a5feb03603e469630a7432d8a975",
    });
    expect(policy.capacityPlanning).toEqual({
      assumptions: {
        actorSurvivalRate: 0.75,
        downstreamQualificationSurvivalRate: 0.25,
        preActorStructuralYieldRate: 0.15,
        repositoryCapSurvivalRate: 0.8,
      },
      derivedActorCappedStructuralYieldRate: 0.09,
      status: "planning-only-not-acceptance-evidence",
      targets: {
        acceptedRegistryCount: 470,
        finalCandidateManifestEpisodeCount: 391,
        minimumRawMetadataCount: 240_000,
        minimumSelectedPretargetCount: 20_000,
        reserveRawMetadataCount: 615_000,
        reserveSelectedPretargetCount: 51_000,
      },
    });
    expect(policy.inputPolicy.decisionInputs).toEqual([
      "commitTotalCount",
      "reviewCount",
      "reviewThreadCount",
    ]);
    expect(policy.inputPolicy.identityOnlyInputs).toEqual([
      {
        field: "canonicalAnchorId",
        permittedRoles: [
          "novelty-against-frozen-pre-wave3-exclusion",
          "deduplication",
        ],
      },
      {
        field: "canonicalRepository",
        permittedRoles: [
          "novelty-against-frozen-pre-wave3-exclusion",
          "deduplication",
          "repository-cap-grouping",
        ],
      },
      {
        field: "frozenPreWave3AnchorExclusions",
        permittedRoles: [
          "novelty-reference-set-only",
        ],
      },
      {
        field: "frozenPreWave3RepositoryExclusions",
        permittedRoles: [
          "novelty-reference-set-only",
        ],
      },
    ]);
    expect(policy.inputPolicy.defaultDeny).toBe(true);
    expect(policy.inputPolicy.strictDecisionInputSchema).toBe(
      "c6-wave3-pretarget-decision-input-v1",
    );
    expect(policy.inputPolicy.forbiddenSelectionInputs).toContain(
      "repositoryYield",
    );
    expect(policy.inputPolicy.forbiddenSelectionInputs).toContain(
      "languageYield",
    );
    expect(policy.inputPolicy.forbiddenSelectionInputs).toContain(
      "language",
    );
    expect(policy.inputPolicy.forbiddenSelectionInputs).toContain(
      "rank",
    );
    expect(parseC6Wave3PretargetPolicy(serialized)).toEqual(policy);
    expect(Buffer.byteLength(serialized)).toBe(9_105);
    expect(result.outputSha256).toBe(
      "eb3df63ff269b1d0166ed4b2faba682d60cdce3fb1ea64946e66f08e5eda9856",
    );
    expect(result.outputSha256).toBe(sha256(serialized));
  });

  it("rejects outcome, gold, repository-yield, language-yield, and threshold drift", async () => {
    const { policy } = await buildC6Wave3PretargetPolicy(
      evidencePaths(),
    );

    for (
      const injectedField of [
        "gold",
        "languageYield",
        "outcome",
        "repositoryYield",
      ]
    ) {
      const tainted = structuredClone(policy);
      Object.assign(tainted.rule, {
        [injectedField]: "forbidden",
      });
      expect(() =>
        serializeC6Wave3PretargetPolicy(tainted)
      ).toThrow();
    }

    const reviewThresholdDrift = structuredClone(policy);
    Object.assign(reviewThresholdDrift.rule, {
      minimumReviewCount: 3,
    });
    expect(() =>
      serializeC6Wave3PretargetPolicy(reviewThresholdDrift)
    ).toThrow();

    const threadThresholdDrift = structuredClone(policy);
    Object.assign(threadThresholdDrift.rule, {
      minimumReviewThreadCount: 1,
    });
    expect(() =>
      serializeC6Wave3PretargetPolicy(threadThresholdDrift)
    ).toThrow();

    const commitThresholdDrift = structuredClone(policy);
    Object.assign(commitThresholdDrift.rule, {
      maximumCommitTotalCount: 251,
    });
    expect(() =>
      serializeC6Wave3PretargetPolicy(commitThresholdDrift)
    ).toThrow();
  });

  it("enforces a strict selector DTO and role-scoped repository identity", () => {
    const decisionInput = {
      canonicalAnchorId: "novel/example#17",
      canonicalRepository: "novel/example",
      commitTotalCount: 200,
      reviewCount: 4,
      reviewThreadCount: 2,
    };
    const context = {
      frozenPreWave3AnchorExclusions: [
        "novel/example#1",
      ],
      frozenPreWave3RepositoryExclusions: [
        "prior/example",
      ],
    };

    expect(
      classifyC6Wave3Pretarget(decisionInput, context),
    ).toEqual({
      eligible: true,
      reasons: [],
    });
    expect(
      classifyC6Wave3Pretarget({
        ...decisionInput,
        canonicalAnchorId: "another/project#9",
        canonicalRepository: "another/project",
      }, context),
    ).toEqual({
      eligible: true,
      reasons: [],
    });
    expect(
      classifyC6Wave3Pretarget({
        ...decisionInput,
        canonicalAnchorId: "novel/example#1",
      }, context),
    ).toEqual({
      eligible: false,
      reasons: [
        "canonical-pull-request-not-novel",
      ],
    });
    expect(
      classifyC6Wave3Pretarget({
        ...decisionInput,
        canonicalAnchorId: "prior/example#17",
        canonicalRepository: "prior/example",
      }, context),
    ).toEqual({
      eligible: false,
      reasons: [
        "canonical-repository-not-novel",
      ],
    });
    expect(
      classifyC6Wave3Pretarget({
        ...decisionInput,
        commitTotalCount: 251,
      }, context).reasons,
    ).toEqual(["commit-total-count-above-maximum"]);
    expect(
      classifyC6Wave3Pretarget({
        ...decisionInput,
        reviewCount: 3,
      }, context).reasons,
    ).toEqual(["review-count-below-minimum"]);
    expect(
      classifyC6Wave3Pretarget({
        ...decisionInput,
        reviewThreadCount: 1,
      }, context).reasons,
    ).toEqual(["review-thread-count-below-minimum"]);

    for (
      const forbiddenField of [
        "deepCaptureOrder",
        "language",
        "observationRefs",
        "outcome",
        "pilotRank",
        "rank",
        "repositoryYield",
        "responseNodeRank",
        "status",
      ]
    ) {
      expect(() =>
        classifyC6Wave3Pretarget({
          ...decisionInput,
          [forbiddenField]: "forbidden",
        }, context)
      ).toThrow();
    }
    expect(() =>
      classifyC6Wave3Pretarget(decisionInput, {
        ...context,
        languageYield: 0.9,
      })
    ).toThrow();
    expect(() =>
      classifyC6Wave3Pretarget({
        ...decisionInput,
        canonicalAnchorId: "prior/example#999",
        canonicalRepository: "novel/example",
      }, context)
    ).toThrow(/repository identity/u);
  });

  it("requires canonical JSON and exact frozen input evidence", async () => {
    const { policy } = await buildC6Wave3PretargetPolicy(
      evidencePaths(),
    );
    expect(() =>
      parseC6Wave3PretargetPolicy(JSON.stringify(policy))
    ).toThrow(/canonical JSON/u);

    const fixture = await copyEvidenceFixture();
    await writeFile(
      fixture.wave1MetadataQualificationPath,
      `${await readFile(
        fixture.wave1MetadataQualificationPath,
        "utf8",
      )}\n`,
    );
    await expect(
      buildC6Wave3PretargetPolicy(fixture),
    ).rejects.toThrow(/hash mismatch/u);
  });

  it("detects terminal evidence drift", async () => {
    const fixture = await copyEvidenceFixture();
    let hookCalled = false;

    await expect(
      buildC6Wave3PretargetPolicy({
        ...fixture,
        testHooks: {
          beforeTerminalReplay: async () => {
            hookCalled = true;
            await writeFile(
              fixture.wave2StructuralQualificationPath,
              "{}\n",
            );
          },
        },
      }),
    ).rejects.toThrow(/hash mismatch|input closure changed/u);
    expect(hookCalled).toBe(true);
  });

  it("publishes without replacement and rolls back only its own inode", async () => {
    const parent = await temporaryRoot();
    const outputPath = join(parent, "wave3-policy.json");
    const first = await materializeC6Wave3PretargetPolicy({
      ...evidencePaths(),
      outputPath,
    });
    expect(parseC6Wave3PretargetPolicy(
      await readFile(outputPath),
    )).toEqual(first.policy);
    expect((await stat(outputPath)).mode & 0o777).toBe(0o644);

    await rm(outputPath);
    await writeFile(outputPath, "preexisting-sentinel\n", {
      mode: 0o600,
    });
    const sentinel = await stat(outputPath);
    let replacementError: unknown;
    try {
      await materializeC6Wave3PretargetPolicy({
        ...evidencePaths(),
        outputPath,
      });
    } catch (error) {
      replacementError = error;
    }
    expect(replacementError).toMatchObject({ code: "EEXIST" });
    expect(await readFile(outputPath, "utf8")).toBe(
      "preexisting-sentinel\n",
    );
    expect(await stat(outputPath)).toMatchObject({
      dev: sentinel.dev,
      ino: sentinel.ino,
      mode: sentinel.mode,
    });

    await rm(outputPath);
    await expect(
      materializeC6Wave3PretargetPolicy({
        ...evidencePaths(),
        outputPath,
        testHooks: {
          afterOutputPublication: async () => {
            await rm(outputPath);
            await writeFile(outputPath, "foreign-output\n");
            throw new Error("injected publication failure");
          },
        },
      }),
    ).rejects.toThrow(/injected publication failure/u);
    expect(await readFile(outputPath, "utf8")).toBe(
      "foreign-output\n",
    );

    await rm(outputPath);
    await expect(
      materializeC6Wave3PretargetPolicy({
        ...evidencePaths(),
        outputPath,
        testHooks: {
          afterOutputPublication: () => {
            throw new Error("injected owned-output failure");
          },
        },
      }),
    ).rejects.toThrow(/injected owned-output failure/u);
    expect(await readdir(parent)).toEqual([]);
  });

  it("keeps the snapshot CLI closed and emits only the policy receipt", async () => {
    const options = cliArguments("/tmp/wave3-policy.json");
    expect(
      parseC6Wave3PretargetPolicyCliOptions(options),
    ).toEqual({
      output: "/tmp/wave3-policy.json",
      structuralUnion:
        evidencePaths().structuralUnionPath,
      wave1MetadataQualification:
        evidencePaths().wave1MetadataQualificationPath,
      wave1StructuralQualification:
        evidencePaths().wave1StructuralQualificationPath,
      wave2MetadataQualification:
        evidencePaths().wave2MetadataQualificationPath,
      wave2StructuralQualification:
        evidencePaths().wave2StructuralQualificationPath,
    });
    expect(() =>
      parseC6Wave3PretargetPolicyCliOptions([
        ...options,
        "--repository-yield=0.5",
      ])
    ).toThrow(/unknown/u);
    expect(() =>
      parseC6Wave3PretargetPolicyCliOptions(options.slice(1))
    ).toThrow(/required/u);

    const parent = await temporaryRoot();
    const output = join(parent, "wave3-policy.json");
    const receipt =
      await runC6Wave3PretargetPolicySnapshotCommand(
        cliArguments(output),
      );
    expect(receipt).toEqual({
      artifactKind: "c6-wave3-pretarget-policy",
      output,
      outputSha256: sha256(await readFile(output)),
      schemaVersion: 1,
      status: "review-and-freeze-commit-required",
    });
  });
});

function evidencePaths() {
  return {
    structuralUnionPath: join(
      SOURCE_POOL_ROOT,
      EVIDENCE_BASENAMES.structuralUnion,
    ),
    wave1MetadataQualificationPath: join(
      SOURCE_POOL_ROOT,
      EVIDENCE_BASENAMES.wave1MetadataQualification,
    ),
    wave1StructuralQualificationPath: join(
      SOURCE_POOL_ROOT,
      EVIDENCE_BASENAMES.wave1StructuralQualification,
    ),
    wave2MetadataQualificationPath: join(
      SOURCE_POOL_ROOT,
      EVIDENCE_BASENAMES.wave2MetadataQualification,
    ),
    wave2StructuralQualificationPath: join(
      SOURCE_POOL_ROOT,
      EVIDENCE_BASENAMES.wave2StructuralQualification,
    ),
  };
}

function cliArguments(output: string): string[] {
  const paths = evidencePaths();
  return [
    `--output=${output}`,
    `--structural-union=${paths.structuralUnionPath}`,
    `--wave1-metadata-qualification=${paths.wave1MetadataQualificationPath}`,
    `--wave1-structural-qualification=${paths.wave1StructuralQualificationPath}`,
    `--wave2-metadata-qualification=${paths.wave2MetadataQualificationPath}`,
    `--wave2-structural-qualification=${paths.wave2StructuralQualificationPath}`,
  ];
}

async function copyEvidenceFixture() {
  const parent = await temporaryRoot();
  const paths = evidencePaths();
  const copied = {
    structuralUnionPath: join(
      parent,
      basename(paths.structuralUnionPath),
    ),
    wave1MetadataQualificationPath: join(
      parent,
      basename(paths.wave1MetadataQualificationPath),
    ),
    wave1StructuralQualificationPath: join(
      parent,
      basename(paths.wave1StructuralQualificationPath),
    ),
    wave2MetadataQualificationPath: join(
      parent,
      basename(paths.wave2MetadataQualificationPath),
    ),
    wave2StructuralQualificationPath: join(
      parent,
      basename(paths.wave2StructuralQualificationPath),
    ),
  };
  await Promise.all([
    copyFile(paths.structuralUnionPath, copied.structuralUnionPath),
    copyFile(
      paths.wave1MetadataQualificationPath,
      copied.wave1MetadataQualificationPath,
    ),
    copyFile(
      paths.wave1StructuralQualificationPath,
      copied.wave1StructuralQualificationPath,
    ),
    copyFile(
      paths.wave2MetadataQualificationPath,
      copied.wave2MetadataQualificationPath,
    ),
    copyFile(
      paths.wave2StructuralQualificationPath,
      copied.wave2StructuralQualificationPath,
    ),
  ]);
  return copied;
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(
    "/private/tmp/goodmemory-c6-wave3-policy-",
  );
  temporaryRoots.push(root);
  return root;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
