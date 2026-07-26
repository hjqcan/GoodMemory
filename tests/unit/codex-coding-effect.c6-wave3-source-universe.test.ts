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
  buildC6Wave3RepositorySearchQuery,
  buildC6Wave3SourceUniverse,
  deriveC6Wave3PullRequestOrderKey,
  deriveC6Wave3RepositoryOrderKey,
  materializeC6Wave3SourceUniverse,
  parseC6Wave3SourceUniverse,
  partitionC6Wave3SearchInterval,
  requireC6Wave3OfficialCaptureAuthorization,
  serializeC6Wave3SourceUniverse,
} from "../../scripts/codex-coding-effect/c6-wave3-source-universe";
import {
  parseC6Wave3SourceUniverseCliOptions,
  runC6Wave3SourceUniverseSnapshotCommand,
} from "../../scripts/snapshot-codex-coding-effect-c6-wave3-source-universe";

const SOURCE_POOL_ROOT = join(
  process.cwd(),
  "fixtures/codex-coding-effect/c6-source-pool",
);
const BASENAMES = {
  activationSalt:
    "swe-bench-live-multilang-608f7ae9." +
    "wave3-activation-salt-proposal-v1.json",
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

describe("Codex coding-effect C6 Wave3 source universe", () => {
  it("derives a bounded repo-only universe and frozen exclusions", async () => {
    const result = await buildC6Wave3SourceUniverse(inputPaths());
    const { sourceUniverse } = result;
    const serialized =
      serializeC6Wave3SourceUniverse(sourceUniverse);

    expect(sourceUniverse.boundary).toEqual({
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      codexRunReady: false,
      commitAncestryProven: false,
      independentReview: false,
      officialWave3CapturePermitted: false,
      pretargetPolicyPromotionAccepted: false,
      preregisteredBeforeWave3Capture: false,
      priorRepositoryNodeIdExclusionComplete: false,
      selectionExecuted: false,
      sourceUniversePromotionAccepted: false,
      sourceUniverseFrozen: false,
      status:
        "policy-and-source-promotion-plus-prior-node-id-closure-required",
    });
    expect(sourceUniverse.chronology).toEqual({
      unreceiptedExploratoryScaleProbes: {
        evidenceStatus:
          "unverified-design-note-not-gate-evidence",
        numericalObservationsRetained: false,
        occurred: true,
        permittedUse: "source-frame-design-only",
        receiptsBound: false,
      },
      sourceArtifactCommitCompleted: false,
      sourceArtifactIndependentReviewCompleted: false,
      sourceArtifactPreregistered: false,
    });
    expect(sourceUniverse.inputs).toEqual({
      activationSalt: {
        artifactKind: "c6-wave3-activation-salt-proposal",
        bytes: 491,
        firstAndOnlyDrawReviewAccepted: false,
        originReceiptAccepted: false,
        path: BASENAMES.activationSalt,
        schemaVersion: 1,
        sha256:
          "66793fb6426c5719feb6fca61f75fa38dd0d02ce2a927c61135f34cda4725e71",
      },
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

    expect(sourceUniverse.repositoryUniverse.representative).toBe(
      false,
    );
    expect(
      sourceUniverse.repositoryUniverse.languageSplits.map(
        ({ language, split }) => ({ language, split }),
      ),
    ).toEqual([
      { language: "C", split: "c" },
      { language: "C++", split: "cpp" },
      { language: "Go", split: "go" },
      { language: "JavaScript", split: "js" },
      { language: "Rust", split: "rust" },
      { language: "Java", split: "java" },
      { language: "TypeScript", split: "ts" },
      { language: "C#", split: "cs" },
    ]);
    expect(sourceUniverse.repositoryUniverse.rootWindowCount).toBe(
      192,
    );
    expect(sourceUniverse.repositoryUniverse.rootShardCount).toBe(
      1_536,
    );
    expect(
      sourceUniverse.repositoryUniverse.languageSplits.every(
        (language) => language.rootShards.length === 192,
      ),
    ).toBe(true);
    for (
      const language of
        sourceUniverse.repositoryUniverse.languageSplits
    ) {
      expect(language.rootShards.map(
        (shard) => shard.activationOrder,
      )).toEqual(Array.from({ length: 192 }, (_, index) =>
        index + 1
      ));
      expect(new Set(language.rootShards.map(
        (shard) => shard.rootShardId,
      )).size).toBe(192);
      for (const shard of language.rootShards) {
        expect(shard.query).toBe(
          buildC6Wave3RepositorySearchQuery({
            createdFrom: shard.createdFrom,
            createdTo: shard.createdTo,
            language: language.language,
          }),
        );
      }
    }
    expect(sourceUniverse.activation.publicSalt).toEqual({
      firstAndOnlyDrawReviewAccepted: false,
      hex:
        "de6c101137b6353d129105ca88c75a6050245f4ecb69fdd3b05c3e006a62cf20",
      origin:
        "source-artifact-literal-awaiting-external-origin-receipt",
      originReceiptAccepted: false,
      priorEvidenceContentInput: false,
    });
    expect(sourceUniverse.activation.keyDerivations).toEqual({
      pullRequest: {
        domain:
          "goodmemory:c6:wave3-source-universe:v1:" +
          "pull-request-order-key",
        formula:
          "sha256-domain-publicSalt-repositoryNodeId-pullRequestNodeId",
      },
      repository: {
        domain:
          "goodmemory:c6:wave3-source-universe:v1:" +
          "repository-order-key",
        formula:
          "sha256-domain-publicSalt-repositoryNodeId",
      },
      rootShard: {
        domain:
          "goodmemory:c6:wave3-source-universe:v1:" +
          "root-shard-activation-key",
        formula:
          "sha256-domain-publicSalt-rootShardId",
      },
    });
    expect(sourceUniverse.activation.quotaPerLanguage).toEqual({
      primaryMilestone: {
        successTerminal: false,
        rawMetadataCount: 30_000,
        selectedPretargetCountAfterCap: 2_500,
      },
      terminal: {
        rawMetadataCount: 76_875,
        selectedPretargetCountAfterCap: 6_375,
      },
    });
    expect(
      sourceUniverse.activation
        .metadataPretargetCapPerRepositoryNodeId,
    ).toBe(4);
    expect(sourceUniverse.activation.runnerAcceptsQuotaTier)
      .toBe(false);
    expect(sourceUniverse.activation.nextShardRule).toBe(
      "activate-complete-shard-until-terminal-raw-and-cap-retained-selected-quotas-are-both-met",
    );
    expect(sourceUniverse.activation.forbiddenSignals).toEqual([
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
    ]);
    expect(sourceUniverse.searchProtocol.accessibleResultCap)
      .toBe(1_000);
    expect(sourceUniverse.searchProtocol.pageSize).toBe(100);
    expect(sourceUniverse.searchProtocol.countProbe).toEqual({
      first: 1,
    });
    expect(sourceUniverse.searchProtocol.pullRequestConnection)
      .toEqual({
        doublePassMetadataProjectionEquality: true,
        doublePassNormalizedNodeIdSetEquality: true,
        endpoint: "GraphQL Repository.pullRequests",
        lowerBound:
          "2022-01-01T00:00:00Z",
        lowerBoundTermination:
          "strictly-older-createdAt-witness-or-connection-exhaustion",
        orderBy: {
          direction: "DESC",
          field: "CREATED_AT",
        },
        pageSize: 100,
        states: ["MERGED"],
        upperBound:
          "2025-12-31T23:59:59Z",
        upperBoundRows: "skip-but-retain-boundary-receipts",
      });
    expect(sourceUniverse.searchProtocol.overflowPolicy).toEqual({
      boundaryUnit: "utc-second",
      leafAtOrBelowAccessibleCap: 1_000,
      midpointRule:
        "left=[lo,mid]-right=[mid+1-second,hi]",
      singleSecondAboveCap: "fail-closed",
    });
    expect(sourceUniverse.searchProtocol.officialDocumentation)
      .toEqual({
        graphqlPagination:
          "https://docs.github.com/en/graphql/guides/using-pagination-in-the-graphql-api",
        graphqlSearch:
          "https://docs.github.com/en/graphql/reference/search",
        repositoryConnection:
          "https://docs.github.com/en/graphql/reference/repos",
        repositorySearch:
          "https://docs.github.com/en/search-github/searching-on-github/searching-for-repositories",
      });
    expect(sourceUniverse.inputPolicy.sourceFrameMembershipInputs)
      .toEqual([
        "createdAt",
        "isArchived",
        "isFork",
        "isMirror",
        "isTemplate",
        "language",
        "pushedAt",
        "visibility",
      ]);
    expect(sourceUniverse.inputPolicy.languageRole).toBe(
      "fixed-source-frame-stratification-only-not-within-stratum-order-or-pretarget-decision",
    );
    for (
      const forbidden of [
        "body",
        "gold",
        "languageYield",
        "outcome",
        "rank",
        "repositoryYield",
      ] as const
    ) {
      expect(sourceUniverse.inputPolicy.forbiddenInputs)
        .toContain(forbidden);
    }
    expect(parseC6Wave3SourceUniverse(serialized))
      .toEqual(sourceUniverse);
    expect(result.outputSha256).toBe(sha256(serialized));
  });

  it("builds only the frozen repository query and node-key orders", () => {
    expect(buildC6Wave3RepositorySearchQuery({
      createdFrom: "2016-01-01T00:00:00Z",
      createdTo: "2016-01-01T23:59:59Z",
      language: "C++",
    })).toBe(
      "language:C++ " +
      "created:2016-01-01T00:00:00Z.." +
      "2016-01-01T23:59:59Z " +
      "pushed:>=2024-01-01 " +
      "is:public archived:false " +
      "mirror:false template:false",
    );
    expect(deriveC6Wave3RepositoryOrderKey(
      "R_repo_node",
    )).toBe(
      sha256(
        "goodmemory:c6:wave3-source-universe:v1:" +
        "repository-order-key\0" +
        "de6c101137b6353d129105ca88c75a6050245f4ecb69fdd3b05c3e006a62cf20\0" +
        "R_repo_node",
      ),
    );
    expect(deriveC6Wave3PullRequestOrderKey({
      pullRequestNodeId: "PR_node",
      repositoryNodeId: "R_repo_node",
    })).toBe(
      sha256(
        "goodmemory:c6:wave3-source-universe:v1:" +
        "pull-request-order-key\0" +
        "de6c101137b6353d129105ca88c75a6050245f4ecb69fdd3b05c3e006a62cf20\0" +
        "R_repo_node\0PR_node",
      ),
    );
    expect(() =>
      buildC6Wave3RepositorySearchQuery({
        createdFrom: "2016-01-01T00:00:00Z",
        createdTo: "2016-01-01T23:59:59Z",
        language: "Python",
      })
    ).toThrow();
    expect(() =>
      buildC6Wave3RepositorySearchQuery({
        createdFrom: "2016-01-01T00:00:00Z",
        createdTo: "2016-01-01T23:59:59Z",
        language: "C",
        rank: 1,
      } as never)
    ).toThrow();
    expect(() => deriveC6Wave3RepositoryOrderKey(""))
      .toThrow();
    expect(() =>
      deriveC6Wave3PullRequestOrderKey({
        pullRequestNodeId: "PR_node",
        repositoryNodeId: "R\0repo",
      })
    ).toThrow();
  });

  it("cannot authorize capture from a proposal or arbitrary receipt hashes", async () => {
    const { sourceUniverse } =
      await buildC6Wave3SourceUniverse(inputPaths());
    expect(() =>
      requireC6Wave3OfficialCaptureAuthorization(
        sourceUniverse,
      )
    ).toThrow(
      "promotion receipt verifier is required",
    );
    expect(() =>
      requireC6Wave3OfficialCaptureAuthorization({
        ...sourceUniverse,
        arbitraryReceiptSha256: "0".repeat(64),
      })
    ).toThrow();
  });

  it("recursively bisects overflowing search intervals by UTC second", async () => {
    const observed: string[] = [];
    const counts = new Map([
      ["2022-01-01T00:00:00Z..2022-01-01T00:00:07Z", 2_001],
      ["2022-01-01T00:00:00Z..2022-01-01T00:00:03Z", 1_001],
      ["2022-01-01T00:00:00Z..2022-01-01T00:00:01Z", 600],
      ["2022-01-01T00:00:02Z..2022-01-01T00:00:03Z", 401],
      ["2022-01-01T00:00:04Z..2022-01-01T00:00:07Z", 1_000],
    ]);
    const leaves = await partitionC6Wave3SearchInterval({
      countProbe: ({ createdFrom, createdTo }) => {
        const key = `${createdFrom}..${createdTo}`;
        observed.push(key);
        const count = counts.get(key);
        if (count === undefined) {
          throw new Error(`unexpected interval ${key}`);
        }
        return count;
      },
      createdFrom: "2022-01-01T00:00:00Z",
      createdTo: "2022-01-01T00:00:07Z",
    });

    expect(observed).toEqual([
      "2022-01-01T00:00:00Z..2022-01-01T00:00:07Z",
      "2022-01-01T00:00:00Z..2022-01-01T00:00:03Z",
      "2022-01-01T00:00:00Z..2022-01-01T00:00:01Z",
      "2022-01-01T00:00:02Z..2022-01-01T00:00:03Z",
      "2022-01-01T00:00:04Z..2022-01-01T00:00:07Z",
    ]);
    expect(leaves).toEqual([
      {
        count: 600,
        createdFrom: "2022-01-01T00:00:00Z",
        createdTo: "2022-01-01T00:00:01Z",
      },
      {
        count: 401,
        createdFrom: "2022-01-01T00:00:02Z",
        createdTo: "2022-01-01T00:00:03Z",
      },
      {
        count: 1_000,
        createdFrom: "2022-01-01T00:00:04Z",
        createdTo: "2022-01-01T00:00:07Z",
      },
    ]);
    await expect(partitionC6Wave3SearchInterval({
      countProbe: () => 1_001,
      createdFrom: "2022-01-01T00:00:00Z",
      createdTo: "2022-01-01T00:00:00Z",
    })).rejects.toThrow("single UTC second");
  });

  it("rejects input drift and self-inconsistent artifacts", async () => {
    const root = await copyInputs();
    await writeFile(
      join(root, BASENAMES.pretargetPolicy),
      "{}\n",
      "utf8",
    );
    await expect(buildC6Wave3SourceUniverse(inputPaths(root)))
      .rejects.toThrow("pretarget policy hash mismatch");

    const { sourceUniverse } =
      await buildC6Wave3SourceUniverse(inputPaths());
    const tainted = structuredClone(sourceUniverse);
    tainted.repositoryUniverse.languageSplits[0]!
      .rootShards[0]!.query = "language:C outcome:success";
    expect(() =>
      serializeC6Wave3SourceUniverse(tainted)
    ).toThrow();

    const taintedSalt = structuredClone(sourceUniverse);
    (
      taintedSalt.activation.publicSalt as {
        hex: string;
      }
    ).hex = "0".repeat(64);
    expect(() =>
      serializeC6Wave3SourceUniverse(taintedSalt)
    ).toThrow();
  });

  it("publishes atomically without replacement and rolls back on replay drift", async () => {
    const root = await copyInputs();
    const output = join(root, "wave3-source-universe.json");
    const first = await materializeC6Wave3SourceUniverse({
      ...inputPaths(root),
      outputPath: output,
    });
    expect(
      parseC6Wave3SourceUniverse(await readFile(output)),
    ).toEqual(first.sourceUniverse);
    await expect(materializeC6Wave3SourceUniverse({
      ...inputPaths(root),
      outputPath: output,
    })).rejects.toThrow();

    const rollbackRoot = await copyInputs();
    const rollbackOutput = join(
      rollbackRoot,
      "wave3-source-universe.json",
    );
    await expect(materializeC6Wave3SourceUniverse({
      ...inputPaths(rollbackRoot),
      outputPath: rollbackOutput,
      testHooks: {
        afterOutputPublication: async () => {
          await writeFile(
            join(rollbackRoot, BASENAMES.structuralUnion),
            "{}\n",
            "utf8",
          );
        },
      },
    })).rejects.toThrow();
    expect(await readdir(rollbackRoot)).not.toContain(
      "wave3-source-universe.json",
    );
    expect((await readdir(rollbackRoot)).some(
      (entry) => entry.includes(".incomplete-"),
    )).toBe(false);
  });

  it("detects terminal input drift before publication", async () => {
    const root = await copyInputs();
    await expect(buildC6Wave3SourceUniverse({
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

  it("preserves foreign output and temporary inodes", async () => {
    const outputRoot = await copyInputs();
    const outputPath = join(
      outputRoot,
      "wave3-source-universe.json",
    );
    await expect(materializeC6Wave3SourceUniverse({
      ...inputPaths(outputRoot),
      outputPath,
      testHooks: {
        afterOutputPublication: async () => {
          await rm(outputPath);
          await writeFile(outputPath, "foreign-output\n", {
            mode: 0o644,
          });
        },
      },
    })).rejects.toThrow(/ownership mismatch/u);
    expect(await readFile(outputPath, "utf8")).toBe(
      "foreign-output\n",
    );

    const temporaryRoot = await copyInputs();
    const temporaryOutput = join(
      temporaryRoot,
      "wave3-source-universe.json",
    );
    let foreignTemporary = "";
    await expect(materializeC6Wave3SourceUniverse({
      ...inputPaths(temporaryRoot),
      outputPath: temporaryOutput,
      testHooks: {
        afterOutputPublication: async () => {
          foreignTemporary = (await readdir(temporaryRoot))
            .find((entry) => entry.includes(".incomplete-"))!;
          await rm(join(temporaryRoot, foreignTemporary));
          await writeFile(
            join(temporaryRoot, foreignTemporary),
            "foreign-temporary\n",
            { mode: 0o644 },
          );
        },
      },
    })).rejects.toThrow(/ownership mismatch/u);
    expect(await readFile(
      join(temporaryRoot, foreignTemporary),
      "utf8",
    )).toBe("foreign-temporary\n");
    await expect(readFile(temporaryOutput)).rejects.toThrow();
  });

  it("rejects output path symlinks and publication mode drift", async () => {
    const physicalRoot = await copyInputs();
    const aliasParent = await mkdtemp(
      "/private/tmp/goodmemory-c6-wave3-alias-",
    );
    temporaryRoots.push(aliasParent);
    const alias = join(aliasParent, "root");
    await symlink(physicalRoot, alias);
    await expect(materializeC6Wave3SourceUniverse({
      ...inputPaths(physicalRoot),
      outputPath: join(alias, "output.json"),
    })).rejects.toThrow(/symlink/u);

    const modeRoot = await copyInputs();
    const modeOutput = join(modeRoot, "output.json");
    await expect(materializeC6Wave3SourceUniverse({
      ...inputPaths(modeRoot),
      outputPath: modeOutput,
      testHooks: {
        afterOutputPublication: async () => {
          await chmod(modeOutput, 0o600);
        },
      },
    })).rejects.toThrow(/ownership mismatch/u);
    await expect(readFile(modeOutput)).rejects.toThrow();
    expect((await readdir(modeRoot)).some(
      (entry) => entry.includes(".incomplete-"),
    )).toBe(false);
  });

  it("publishes 0644 under a secure umask and propagates EACCES rollback", async () => {
    const umaskRoot = await copyInputs();
    const umaskOutput = join(umaskRoot, "output.json");
    const previousUmask = process.umask(0o077);
    try {
      await materializeC6Wave3SourceUniverse({
        ...inputPaths(umaskRoot),
        outputPath: umaskOutput,
      });
    } finally {
      process.umask(previousUmask);
    }
    expect((await stat(umaskOutput)).mode & 0o7777)
      .toBe(0o644);

    const deniedParent = await mkdtemp(
      "/private/tmp/goodmemory-c6-wave3-eacces-",
    );
    temporaryRoots.push(deniedParent);
    const deniedOutput = join(deniedParent, "output.json");
    let thrown: unknown;
    try {
      await materializeC6Wave3SourceUniverse({
        ...inputPaths(),
        outputPath: deniedOutput,
        testHooks: {
          afterOutputPublication: async () => {
            await chmod(deniedParent, 0o000);
          },
        },
      });
    } catch (error) {
      thrown = error;
    } finally {
      await chmod(deniedParent, 0o700);
    }
    expect(thrown).toMatchObject({ code: "EACCES" });
    expect(await readFile(deniedOutput)).not.toHaveLength(0);
  });

  it("provides a strict snapshot CLI without running it here", async () => {
    expect(parseC6Wave3SourceUniverseCliOptions([
      "--activation-salt=/tmp/salt.json",
      "--output=/tmp/output.json",
      "--pretarget-policy=/tmp/policy.json",
      "--prior-frame=/tmp/frame.json",
      "--structural-union=/tmp/union.json",
    ])).toEqual({
      activationSalt: "/tmp/salt.json",
      output: "/tmp/output.json",
      pretargetPolicy: "/tmp/policy.json",
      priorFrame: "/tmp/frame.json",
      structuralUnion: "/tmp/union.json",
    });
    expect(() =>
      parseC6Wave3SourceUniverseCliOptions([
        "--output=/tmp/output.json",
        "--output=/tmp/other.json",
      ])
    ).toThrow();
    expect(() =>
      parseC6Wave3SourceUniverseCliOptions([
        "--network=true",
      ])
    ).toThrow();

    const root = await copyInputs();
    const output = join(root, "cli-output.json");
    const result =
      await runC6Wave3SourceUniverseSnapshotCommand([
      `--output=${output}`,
      `--activation-salt=${join(
        root,
        BASENAMES.activationSalt,
      )}`,
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
      schemaVersion: 1,
    });
    expect(parseC6Wave3SourceUniverse(await readFile(output))
      .boundary.officialWave3CapturePermitted).toBe(false);
  });
});

function inputPaths(root = SOURCE_POOL_ROOT): {
  activationSaltPath: string;
  pretargetPolicyPath: string;
  priorFramePath: string;
  structuralUnionPath: string;
} {
  return {
    activationSaltPath: join(root, BASENAMES.activationSalt),
    pretargetPolicyPath: join(root, BASENAMES.pretargetPolicy),
    priorFramePath: join(root, BASENAMES.priorFrame),
    structuralUnionPath: join(root, BASENAMES.structuralUnion),
  };
}

async function copyInputs(): Promise<string> {
  const root = await mkdtemp(
    "/private/tmp/goodmemory-c6-wave3-source-",
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
