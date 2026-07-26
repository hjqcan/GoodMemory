import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "bun:test";

import {
  buildC6Wave3RepositorySearchQueryV2,
  buildC6Wave3SourceUniverseV2,
  deriveC6Wave3TargetRoundV2,
  materializeC6Wave3SourceUniverseV2,
  parseC6Wave3SourceUniverseV2,
  partitionC6Wave3SearchIntervalV2,
  requireC6Wave3OfficialCaptureAuthorizationV2,
  serializeC6Wave3SourceUniverseV2,
} from "../../scripts/codex-coding-effect/c6-wave3-source-universe-v2";
import {
  parseC6Wave3SourceUniverseV2CliOptions,
  runC6Wave3SourceUniverseV2SnapshotCommand,
} from "../../scripts/snapshot-codex-coding-effect-c6-wave3-source-universe-v2";

const SOURCE_POOL_ROOT = join(
  process.cwd(),
  "fixtures/codex-coding-effect/c6-source-pool",
);
const BASENAMES = {
  pretargetPolicy:
    "swe-bench-live-multilang-608f7ae9." +
    "wave3-pretarget-policy-v1.json",
  priorFrame:
    "multi-source.reviewer-actor-qualified-screening-frame-v1.json",
  structuralUnion:
    "swe-bench-live-multilang-608f7ae9." +
    "neighbor-structural-union-v1.json",
} as const;
const temporaryRoots: string[] = [];

afterAll(async () => {
  await Promise.all(
    temporaryRoots.map((root) =>
      rm(root, { force: true, recursive: true })
    ),
  );
});

describe("Codex coding-effect C6 Wave3 source universe v2", () => {
  it("independently rebuilds the source frame without salt or activation order", async () => {
    const result = await buildC6Wave3SourceUniverseV2(
      inputPaths(),
    );
    const { sourceUniverse } = result;
    const serialized =
      serializeC6Wave3SourceUniverseV2(sourceUniverse);

    expect(sourceUniverse.artifactKind).toBe(
      "c6-wave3-source-universe",
    );
    expect(sourceUniverse.schemaVersion).toBe(2);
    expect(sourceUniverse.inputs).toEqual({
      pretargetPolicy: {
        artifactKind: "c6-wave3-pretarget-policy",
        bytes: 9_105,
        path: BASENAMES.pretargetPolicy,
        schemaVersion: 1,
        sha256:
          "eb3df63ff269b1d0166ed4b2faba682d60cdce3fb1ea64946e66f08e5eda9856",
      },
      priorFrame: {
        artifactKind:
          "c6-reviewer-actor-qualified-screening-frame",
        bytes: 88_335,
        candidateCount: 113,
        candidateProjectionSha256:
          "1d0c5689521aa906e7fb2bf015579bbcc7638b31093966edec5339724aec82af",
        path: BASENAMES.priorFrame,
        schemaVersion: 1,
        sha256:
          "6838de7f36875b3b3de104ffd896b9e30dcf95ad1eb285a87b465789800f4b0c",
      },
      structuralUnion: {
        artifactKind:
          "c6-live-multilang-neighbor-structural-union",
        bytes: 2_597_956,
        path: BASENAMES.structuralUnion,
        schemaVersion: 1,
        sha256:
          "3a438e999450b96c039dbea6eba7ae971bb03223c42c2b2ff502f85ed76ad208",
        targetCount: 1_334,
      },
    });
    expect(sourceUniverse.boundary).toEqual({
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      codexRunReady: false,
      commitAncestryProven: false,
      independentReview: false,
      officialWave3CapturePermitted: false,
      pretargetPolicyPromotionAccepted: false,
      priorRepositoryNodeIdExclusionComplete: false,
      selectionExecuted: false,
      sourceUniverseFrozen: false,
      sourceUniversePromotionAccepted: false,
      status:
        "source-review-commit-policy-promotion-and-prior-node-closure-required",
    });
    expect(sourceUniverse.exclusions.counts).toEqual({
      canonicalAnchorCount: 1_447,
      canonicalRepositoryCount: 178,
      priorFrameAnchorCount: 113,
      structuralUnionAnchorCount: 1_334,
    });
    expect(
      sourceUniverse.exclusions.canonicalAnchorProjectionSha256,
    ).toBe(
      "a8d40b7c4f786a918807bbb5dc17e0be18b1ab6e4858f1e8af0d8deaaa6c5ebd",
    );
    expect(
      sourceUniverse.exclusions
        .canonicalRepositoryProjectionSha256,
    ).toBe(
      "360da907fb4dd3c4e3e023c528b90e8f5401e5f52bc13b69fcce034b8b44ab01",
    );
    expect(sourceUniverse.exclusions.canonicalAnchors).toEqual(
      [...sourceUniverse.exclusions.canonicalAnchors].sort(),
    );
    expect(sourceUniverse.exclusions.canonicalRepositories)
      .toEqual(
        [...sourceUniverse.exclusions.canonicalRepositories].sort(),
      );

    expect(sourceUniverse.repositoryUniverse.rootWindowCount)
      .toBe(192);
    expect(sourceUniverse.repositoryUniverse.rootShardCount)
      .toBe(1_536);
    for (
      const language of
        sourceUniverse.repositoryUniverse.languageSplits
    ) {
      expect(language.rootShards).toHaveLength(192);
      expect(language.rootShards.map(
        ({ rootShardId }) => rootShardId,
      )).toEqual(
        language.rootShards.map(
          ({ rootShardId }) => rootShardId,
        ).sort(),
      );
      for (const shard of language.rootShards) {
        expect(shard.query).toBe(
          buildC6Wave3RepositorySearchQueryV2({
            createdFrom: shard.createdFrom,
            createdTo: shard.createdTo,
            language: language.language,
          }),
        );
        expect(Object.keys(shard)).toEqual([
          "createdFrom",
          "createdTo",
          "query",
          "rootShardId",
          "windowId",
        ]);
      }
    }
    expect(serialized).not.toContain("publicSalt");
    expect(serialized).not.toContain("activationKeySha256");
    expect(serialized).not.toContain("activationOrder");
    expect(serialized).not.toContain(
      "wave3-source-universe-v1",
    );
    expect(parseC6Wave3SourceUniverseV2(serialized))
      .toEqual(sourceUniverse);
    expect(result.outputSha256).toBe(sha256(serialized));
  });

  it("freezes only future activation-plan KDF and terminal quota rules", async () => {
    const { sourceUniverse } =
      await buildC6Wave3SourceUniverseV2(inputPaths());

    expect(sourceUniverse.activationPlanProtocol).toEqual({
      activationMaterialPresent: false,
      completeShardOnly: true,
      forbiddenSignals: [
        "acceptedEpisode",
        "actorDecision",
        "downstreamYield",
        "evaluatorDecision",
        "gold",
        "hiddenTest",
        "languageYield",
        "machineDecision",
        "outcome",
        "patch",
        "rank",
        "repositoryYield",
        "semanticDecision",
        "testOutcome",
      ],
      keyDerivationProtocol: {
        algorithm: "sha256",
        activationSalt: {
          actualInputValuesPresent: false,
          domain:
            "goodmemory:c6:wave3-activation-plan:v1:" +
            "activation-salt",
          evaluationId: {
            callerOverrideAccepted: false,
            frozenInSourceArtifact: false,
            requiredInC0CommitmentProfile: true,
          },
          formula:
            "sha256(domain NUL evaluationId NUL commitmentSha256 NUL roundDecimal NUL randomnessHex)",
          inputSource:
            "future-accepted-commitment-and-verified-fixed-round-receipt",
        },
        callerNonceAccepted: false,
        callerRoundOverrideAccepted: false,
        callerSaltAccepted: false,
        encoding:
          "utf8-null-delimited-lowercase-hex-canonical-base10-round",
        pullRequest: {
          domain:
            "goodmemory:c6:wave3-activation-plan:v1:" +
            "pull-request-order-key",
          formula:
            "sha256(domain NUL activationSaltHex NUL repositoryNodeId NUL pullRequestNodeId)",
        },
        repository: {
          domain:
            "goodmemory:c6:wave3-activation-plan:v1:" +
            "repository-order-key",
          formula:
            "sha256(domain NUL activationSaltHex NUL repositoryNodeId)",
        },
        rootShard: {
          domain:
            "goodmemory:c6:wave3-activation-plan:v1:" +
            "root-shard-order-key",
          formula:
            "sha256(domain NUL activationSaltHex NUL rootShardId)",
        },
      },
      metadataPretargetCapPerRepositoryNodeId: 4,
      metadataPretargetCapScope:
        "global-across-language-splits-by-repository-node-id",
      nextShardRule:
        "activate-complete-shard-until-terminal-raw-and-cap-retained-selected-quotas-are-both-met",
      order: {
        pullRequest:
          "per-repository-pullRequestKeySha256-then-pullRequestNodeId",
        repository:
          "per-language-repositoryKeySha256-then-repositoryNodeId",
        rootShard:
          "per-language-rootShardKeySha256-then-rootShardId",
      },
      quotaPerLanguage: {
        primaryMilestone: {
          rawMetadataCount: 30_000,
          selectedPretargetCountAfterCap: 2_500,
          successTerminal: false,
        },
        terminal: {
          rawMetadataCount: 76_875,
          selectedPretargetCountAfterCap: 6_375,
        },
      },
      runnerAcceptsQuotaTier: false,
    });
  });

  it("freezes a fixed-round externally witnessed anti-grinding protocol", async () => {
    const { antiGrindingProtocol } = (
      await buildC6Wave3SourceUniverseV2(inputPaths())
    ).sourceUniverse;

    expect(antiGrindingProtocol).toEqual({
      beacon: {
        beaconId: "quicknet",
        chainHash:
          "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
        genesisTimeUnixSeconds: 1_692_803_367,
        groupHash:
          "f477d5c89f21a17c863a7f937c6a6d15859414d2be09cd448d4279af331c5d3e",
        periodSeconds: 3,
        publicKey:
          "83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a",
        scheme: "bls-unchained-g1-rfc9380",
      },
      beaconCaptureInSourceArtifact: false,
      beaconResponseVerification: {
        exactChainInfoProfileMatchRequired: true,
        exactRequestedRoundRequired: true,
        randomnessFormula: "sha256(signatureBytes)",
        signatureVerificationRequired: true,
      },
      concreteWitnessProviderProfile: {
        commitmentBindingRequired: true,
        frozen: false,
        requiredBeforeCapture: true,
        requiredVerifierComponents: [
          "canonicalPayload",
          "endpoint",
          "enumeration",
          "inclusion",
          "namespace",
          "signature",
          "trustRoot",
        ],
        verifierImplemented: false,
      },
      fixedRoundFailure: "fail-closed-no-fallback-no-redraw",
      targetRound: {
        arithmetic: "exact-positive-integer-seconds",
        commitTimestampAccepted: false,
        formula:
          "1+ceilDiv(externallySignedWitnessUnixSeconds+frozenLeadSeconds-genesisTimeUnixSeconds,periodSeconds)",
        frozenLeadSeconds: 3_600,
        predecessorRule:
          "predecessorRoundTimestamp<witnessPlusFrozenLead",
        roundTimestampFormula:
          "genesisTimeUnixSeconds+(round-1)*periodSeconds",
        semantics:
          "earliest-round-timestamp-not-before-witness-plus-frozen-lead",
        targetRule:
          "targetRoundTimestamp>=witnessPlusFrozenLead",
        uniqueDerivationRequired: true,
        witnessBeforeGenesisAccepted: false,
      },
      witness: {
        appendOnly: true,
        enumerable: true,
        externalToRepository: true,
        externallySigned: true,
        mustBindCommitmentSha256: true,
        receiptRequired: true,
        timestampField:
          "externallySignedWitnessUnixSeconds",
      },
    });
  });

  it("derives the earliest Quicknet round not before witness plus lead", () => {
    const genesis = 1_692_803_367n;
    const period = 3n;
    const lead = 3_600n;
    const exactBoundaryRound =
      deriveC6Wave3TargetRoundV2(genesis);
    const nonBoundaryRound =
      deriveC6Wave3TargetRoundV2(genesis + 1n);
    const residueTwoRound =
      deriveC6Wave3TargetRoundV2(genesis + 2n);
    const largeWitness =
      genesis + 10_000_000_000_000_002n;
    const largeRound =
      deriveC6Wave3TargetRoundV2(largeWitness);

    expect(exactBoundaryRound).toBe(1_201n);
    expect(nonBoundaryRound).toBe(1_202n);
    expect(residueTwoRound).toBe(1_202n);
    for (
      const [witness, round] of [
        [genesis, exactBoundaryRound],
        [genesis + 1n, nonBoundaryRound],
        [genesis + 2n, residueTwoRound],
        [largeWitness, largeRound],
      ] as const
    ) {
      const threshold = witness + lead;
      const roundTimestamp =
        genesis + (round - 1n) * period;
      const predecessorTimestamp = roundTimestamp - period;
      expect(roundTimestamp >= threshold).toBe(true);
      expect(predecessorTimestamp < threshold).toBe(true);
    }
    expect(() =>
      deriveC6Wave3TargetRoundV2(-1n)
    ).toThrow("nonnegative");
    expect(() =>
      deriveC6Wave3TargetRoundV2(genesis - 1n)
    ).toThrow("before Quicknet genesis");
  });

  it("keeps repository search splitting and pull-request double-pass census fixed", async () => {
    const { searchProtocol } = (
      await buildC6Wave3SourceUniverseV2(inputPaths())
    ).sourceUniverse;
    expect(searchProtocol).toMatchObject({
      accessibleResultCap: 1_000,
      countProbe: { first: 1 },
      overflowPolicy: {
        boundaryUnit: "utc-second",
        leafAtOrBelowAccessibleCap: 1_000,
        midpointRule:
          "left=[lo,mid]-right=[mid+1-second,hi]",
        singleSecondAboveCap: "fail-closed",
      },
      pageSize: 100,
      pullRequestConnection: {
        doublePassMetadataProjectionEquality: true,
        doublePassNormalizedNodeIdSetEquality: true,
        endpoint: "GraphQL Repository.pullRequests",
        lowerBound: "2022-01-01T00:00:00Z",
        lowerBoundTermination:
          "strictly-older-createdAt-witness-or-connection-exhaustion",
        orderBy: {
          direction: "DESC",
          field: "CREATED_AT",
        },
        pageSize: 100,
        states: ["MERGED"],
        upperBound: "2025-12-31T23:59:59Z",
        upperBoundRows: "skip-but-retain-boundary-receipts",
      },
      repositorySearchEndpoint:
        "GraphQL Query.search(type: REPOSITORY)",
    });

    const observed: string[] = [];
    const counts = new Map([
      ["2022-01-01T00:00:00Z..2022-01-01T00:00:07Z", 2_001],
      ["2022-01-01T00:00:00Z..2022-01-01T00:00:03Z", 1_001],
      ["2022-01-01T00:00:00Z..2022-01-01T00:00:01Z", 600],
      ["2022-01-01T00:00:02Z..2022-01-01T00:00:03Z", 401],
      ["2022-01-01T00:00:04Z..2022-01-01T00:00:07Z", 1_000],
    ]);
    const leaves = await partitionC6Wave3SearchIntervalV2({
      countProbe: ({ createdFrom, createdTo }) => {
        const key = `${createdFrom}..${createdTo}`;
        observed.push(key);
        return counts.get(key)!;
      },
      createdFrom: "2022-01-01T00:00:00Z",
      createdTo: "2022-01-01T00:00:07Z",
    });
    expect(observed).toEqual([...counts.keys()]);
    expect(leaves.map(({ count }) => count)).toEqual([
      600,
      401,
      1_000,
    ]);
    await expect(partitionC6Wave3SearchIntervalV2({
      countProbe: () => 1_001,
      createdFrom: "2022-01-01T00:00:00Z",
      createdTo: "2022-01-01T00:00:00Z",
    })).rejects.toThrow("single UTC second");
  });

  it("strictly rejects noncanonical, drifted, and capture-authorizing inputs", async () => {
    const { sourceUniverse } =
      await buildC6Wave3SourceUniverseV2(inputPaths());
    expect(() =>
      requireC6Wave3OfficialCaptureAuthorizationV2(
        sourceUniverse,
      )
    ).toThrow("promotion receipt verifier is required");
    expect(() =>
      parseC6Wave3SourceUniverseV2(
        JSON.stringify(sourceUniverse),
      )
    ).toThrow("canonical JSON");
    expect(() =>
      serializeC6Wave3SourceUniverseV2({
        ...sourceUniverse,
        publicSaltHex: "0".repeat(64),
      } as never)
    ).toThrow();

    const changed = structuredClone(sourceUniverse);
    changed.repositoryUniverse.languageSplits[0]!
      .rootShards.reverse();
    expect(() =>
      serializeC6Wave3SourceUniverseV2(changed)
    ).toThrow("self-consistency");

    const root = await copyInputs();
    await writeFile(
      join(root, BASENAMES.pretargetPolicy),
      "{}\n",
    );
    await expect(buildC6Wave3SourceUniverseV2(
      inputPaths(root),
    )).rejects.toThrow("pretarget policy hash mismatch");
  });

  it("replays the complete input closure before publication", async () => {
    const root = await copyInputs();
    await expect(buildC6Wave3SourceUniverseV2({
      ...inputPaths(root),
      testHooks: {
        beforeTerminalReplay: async () => {
          await writeFile(
            join(root, BASENAMES.structuralUnion),
            "{}\n",
          );
        },
      },
    })).rejects.toThrow(/hash mismatch|closure changed/u);
  });

  it("publishes 0644 atomically without replacement", async () => {
    const root = await copyInputs();
    const output = join(root, "source-v2.json");
    const previousUmask = process.umask(0o077);
    try {
      const result = await materializeC6Wave3SourceUniverseV2({
        ...inputPaths(root),
        outputPath: output,
      });
      expect(
        parseC6Wave3SourceUniverseV2(await readFile(output)),
      ).toEqual(result.sourceUniverse);
    } finally {
      process.umask(previousUmask);
    }
    expect((await stat(output)).mode & 0o7777).toBe(0o644);
    await expect(materializeC6Wave3SourceUniverseV2({
      ...inputPaths(root),
      outputPath: output,
    })).rejects.toThrow();
  });

  it("rejects symlink/mode drift and preserves foreign inodes", async () => {
    const physicalRoot = await copyInputs();
    const aliasParent = await mkdtemp(
      "/private/tmp/goodmemory-c6-wave3-v2-alias-",
    );
    temporaryRoots.push(aliasParent);
    const alias = join(aliasParent, "root");
    await symlink(physicalRoot, alias);
    await expect(materializeC6Wave3SourceUniverseV2({
      ...inputPaths(physicalRoot),
      outputPath: join(alias, "output.json"),
    })).rejects.toThrow(/symlink/u);

    const modeRoot = await copyInputs();
    const modeOutput = join(modeRoot, "output.json");
    await expect(materializeC6Wave3SourceUniverseV2({
      ...inputPaths(modeRoot),
      outputPath: modeOutput,
      testHooks: {
        afterOutputPublication: async () => {
          await chmod(modeOutput, 0o600);
        },
      },
    })).rejects.toThrow(/ownership mismatch/u);
    await expect(readFile(modeOutput)).rejects.toThrow();

    const foreignRoot = await copyInputs();
    const foreignOutput = join(foreignRoot, "output.json");
    await expect(materializeC6Wave3SourceUniverseV2({
      ...inputPaths(foreignRoot),
      outputPath: foreignOutput,
      testHooks: {
        afterOutputPublication: async () => {
          await rm(foreignOutput);
          await writeFile(
            foreignOutput,
            "foreign-output\n",
            { mode: 0o644 },
          );
        },
      },
    })).rejects.toThrow(/ownership mismatch/u);
    expect(await readFile(foreignOutput, "utf8"))
      .toBe("foreign-output\n");
    expect((await readdir(foreignRoot)).some(
      (entry) => entry.includes(".incomplete-"),
    )).toBe(false);

    const foreignTemporaryRoot = await copyInputs();
    const foreignTemporaryOutput = join(
      foreignTemporaryRoot,
      "output.json",
    );
    let foreignTemporary = "";
    await expect(materializeC6Wave3SourceUniverseV2({
      ...inputPaths(foreignTemporaryRoot),
      outputPath: foreignTemporaryOutput,
      testHooks: {
        afterOutputPublication: async () => {
          foreignTemporary = (
            await readdir(foreignTemporaryRoot)
          ).find(
            (entry) => entry.includes(".incomplete-"),
          )!;
          await rm(join(foreignTemporaryRoot, foreignTemporary));
          await writeFile(
            join(foreignTemporaryRoot, foreignTemporary),
            "foreign-temporary\n",
            { mode: 0o644 },
          );
        },
      },
    })).rejects.toThrow(/ownership mismatch/u);
    expect(await readFile(
      join(foreignTemporaryRoot, foreignTemporary),
      "utf8",
    )).toBe("foreign-temporary\n");
    await expect(readFile(foreignTemporaryOutput))
      .rejects.toThrow();
  });

  it("provides a strict local-only CLI", async () => {
    expect(() =>
      parseC6Wave3SourceUniverseV2CliOptions([
        "--network=true",
      ])
    ).toThrow("unknown");
    expect(() =>
      parseC6Wave3SourceUniverseV2CliOptions([
        "--output=/tmp/a",
        "--output=/tmp/b",
      ])
    ).toThrow("more than once");

    const root = await copyInputs();
    const output = join(root, "cli-output.json");
    const result =
      await runC6Wave3SourceUniverseV2SnapshotCommand([
        `--output=${output}`,
        `--pretarget-policy=${join(
          root,
          BASENAMES.pretargetPolicy,
        )}`,
        `--prior-frame=${join(root, BASENAMES.priorFrame)}`,
        `--structural-union=${join(
          root,
          BASENAMES.structuralUnion,
        )}`,
      ]);
    expect(result).toMatchObject({
      artifactKind: "c6-wave3-source-universe",
      officialWave3CapturePermitted: false,
      output,
      schemaVersion: 2,
    });
    expect(
      parseC6Wave3SourceUniverseV2(await readFile(output))
        .boundary.officialWave3CapturePermitted,
    ).toBe(false);
  });
});

function inputPaths(root = SOURCE_POOL_ROOT): {
  pretargetPolicyPath: string;
  priorFramePath: string;
  structuralUnionPath: string;
} {
  return {
    pretargetPolicyPath: join(root, BASENAMES.pretargetPolicy),
    priorFramePath: join(root, BASENAMES.priorFrame),
    structuralUnionPath: join(root, BASENAMES.structuralUnion),
  };
}

async function copyInputs(): Promise<string> {
  const root = await mkdtemp(
    "/private/tmp/goodmemory-c6-wave3-source-v2-",
  );
  temporaryRoots.push(root);
  await Promise.all(
    Object.values(BASENAMES).map((basename) =>
      copyFile(
        join(SOURCE_POOL_ROOT, basename),
        join(root, basename),
      )
    ),
  );
  return root;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
