import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildC6AssetLock,
  serializeC6AssetLock,
} from "../../scripts/codex-coding-effect/c6-asset-lock";
import {
  loadC6RepositoryDesignEvidence,
} from "../../scripts/codex-coding-effect/c6-repository-design-evidence";
import type {
  C6RepositoryDesignEvidenceInput,
} from "../../scripts/codex-coding-effect/c6-repository-design-evidence";

const CREATED_AT = "2026-07-24T12:00:00.000Z";
const REVIEWED_AT = "2026-07-24T13:00:00.000Z";

describe("C6 repository design evidence", () => {
  it("derives repository families from locked lineage and verifies the review receipt chain", async () => {
    const fixture = await createFixture();
    try {
      const evidence = await loadC6RepositoryDesignEvidence(fixture.input);

      expect(evidence).toEqual({
        actualRepositoryFamilies: 2,
        algorithm: "repository-mean-normal-power-and-precision-v1",
        alpha: 0.05,
        allocation: {
          allocationSha256: fixture.allocationSha256,
          episodeCountByFamily: {
            "family-alpha": 2,
            "family-beta": 2,
          },
          episodes: 4,
          repositoryFamilies: 2,
        },
        confidenceLevel: 0.95,
        createdAt: CREATED_AT,
        cryptographicAuthenticity: false,
        datasetSha256: fixture.datasetSha256,
        declaredOutcomeAccess: "prohibited",
        designPowerArtifactSha256: fixture.designSha256,
        effectiveRepositoryFamilies: 2,
        episodeFamilyBindingSha256: fixture.bindingSha256,
        groupingPolicy: "canonical-upstream-repository-family-v1",
        maximumHalfWidth: 0.029,
        minimumDetectableEffect: 0.03,
        minimumRepositoryFamilies: 2,
        planningRepositoryStandardDeviation: 0.015,
        power: 0.8,
        powerInputArtifactSha256: fixture.powerInputSha256,
        powerRequiredRepositoryFamilies: 2,
        precisionRequiredRepositoryFamilies: 2,
        repositoryFamilyByEpisodeId: {
          "episode-a": "family-alpha",
          "episode-b": "family-alpha",
          "episode-c": "family-beta",
          "episode-d": "family-beta",
        },
        repositoryLineageArtifactSha256: fixture.lineageSha256,
        requiredRepositoryFamilies: 2,
        reviewReceiptSha256: fixture.reviewReceiptSha256,
        reviewReceiptStatus: "review-receipt-structure-verified",
        reviewedAt: REVIEWED_AT,
      });

      type InputKeys = keyof C6RepositoryDesignEvidenceInput;
      const acceptsSelfDeclaredReview:
        "independentReviewAccepted" extends InputKeys ? true : false = false;
      const acceptsSelfDeclaredOutcomeBlind:
        "outcomeBlind" extends InputKeys ? true : false = false;
      expect(acceptsSelfDeclaredReview).toBeFalse();
      expect(acceptsSelfDeclaredOutcomeBlind).toBeFalse();
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("rejects external hash mismatch, evidence mutation, and symlinked paths", async () => {
    const hashMismatch = await createFixture();
    try {
      await expect(loadC6RepositoryDesignEvidence({
        ...hashMismatch.input,
        expectedDesignPowerArtifactSha256: "f".repeat(64),
      })).rejects.toThrow("design-power artifact SHA-256");

      await writeFile(
        join(hashMismatch.root, "provenance/repository-design/design-power.json"),
        "{}\n",
      );
      await expect(loadC6RepositoryDesignEvidence(hashMismatch.input))
        .rejects.toThrow("asset lock");
    } finally {
      await rm(hashMismatch.root, { force: true, recursive: true });
    }

    const symlinkFixture = await createFixture();
    const alias = `${symlinkFixture.root}-alias`;
    try {
      await symlink(symlinkFixture.root, alias);
      await expect(loadC6RepositoryDesignEvidence({
        ...symlinkFixture.input,
        assetRoot: alias,
      })).rejects.toThrow("symlink path component");
    } finally {
      await rm(alias, { force: true });
      await rm(symlinkFixture.root, { force: true, recursive: true });
    }
  });

  it("rejects a mutated or deleted locked power-input preimage", async () => {
    const mutated = await createFixture();
    try {
      await writeFile(
        join(mutated.root, "provenance/repository-design/power-input.json"),
        "{}\n",
      );
      await expect(loadC6RepositoryDesignEvidence(mutated.input))
        .rejects.toThrow("asset lock does not match current assets");
    } finally {
      await rm(mutated.root, { force: true, recursive: true });
    }

    const deleted = await createFixture();
    try {
      await rm(
        join(deleted.root, "provenance/repository-design/power-input.json"),
      );
      await expect(loadC6RepositoryDesignEvidence(deleted.input))
        .rejects.toThrow("asset lock does not match current assets");
    } finally {
      await rm(deleted.root, { force: true, recursive: true });
    }
  });

  it("rejects self-review and a receipt bound to the wrong design", async () => {
    for (const variation of [
      { reviewer: "author-agent" },
      { receiptDesignSha256: "e".repeat(64) },
    ]) {
      const fixture = await createFixture(variation);
      try {
        await expect(loadC6RepositoryDesignEvidence(fixture.input))
          .rejects.toThrow(
            variation.reviewer
              ? "reviewer must differ from author"
              : "receipt does not bind the design-power artifact",
          );
      } finally {
        await rm(fixture.root, { force: true, recursive: true });
      }
    }
  });

  it("rejects missing repository coverage, upstream-family splits, and conflicting aliases", async () => {
    const variations: Array<{
      expected: string;
      options: FixtureOptions;
    }> = [
      {
        expected: "does not cover dataset repository",
        options: { omitRawRepository: "https://github.com/example/beta" },
      },
      {
        expected: "upstream identity is split across families",
        options: { splitUpstreamAcrossFamilies: true },
      },
      {
        expected: "normalized raw repository alias is ambiguous",
        options: { conflictingAlias: true },
      },
    ];
    for (const variation of variations) {
      const fixture = await createFixture(variation.options);
      try {
        await expect(loadC6RepositoryDesignEvidence(fixture.input))
          .rejects.toThrow(variation.expected);
      } finally {
        await rm(fixture.root, { force: true, recursive: true });
      }
    }
  });

  it("requires an explicitly related lineage when raw and canonical URLs differ", async () => {
    const fixture = await createFixture({
      invalidDirectRelation: true,
    });
    try {
      await expect(loadC6RepositoryDesignEvidence(fixture.input))
        .rejects.toThrow(
          "direct relation requires matching normalized repository URLs",
        );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("recomputes the power design and rejects design-restated count mutations", async () => {
    for (const variation of [
      {
        expected: "power-required repository family count",
        options: { powerRequiredRepositoryFamilies: 3 },
      },
      {
        expected: "precision-required repository family count",
        options: { precisionRequiredRepositoryFamilies: 3 },
      },
      {
        expected: "required repository family count",
        options: { requiredRepositoryFamilies: 3 },
      },
      {
        expected: "does not bind the power-input artifact",
        options: { designPowerInputSha256: "f".repeat(64) },
      },
    ]) {
      const fixture = await createFixture(variation.options);
      try {
        await expect(loadC6RepositoryDesignEvidence(fixture.input))
          .rejects.toThrow(variation.expected);
      } finally {
        await rm(fixture.root, { force: true, recursive: true });
      }
    }
  });

  it("requires both raw and Kish-effective repository families to meet the computed requirement", async () => {
    for (const variation of [
      {
        expected: "has 1 raw repository families but design requires 2",
        options: { collapseToOneFamily: true },
      },
      {
        expected:
          "has 1.6 effective repository families but design requires 2",
        options: { extremeAllocationConcentration: true },
      },
    ]) {
      const fixture = await createFixture(variation.options);
      try {
        await expect(loadC6RepositoryDesignEvidence(fixture.input))
          .rejects.toThrow(variation.expected);
      } finally {
        await rm(fixture.root, { force: true, recursive: true });
      }
    }
  });

  it("rejects mutated review provenance bindings and non-canonical JSON", async () => {
    for (const variation of [
      {
        expected: "review response does not bind the request",
        options: { responseRequestSha256: "d".repeat(64) },
      },
      {
        expected: "must be canonical JSON",
        options: { nonCanonicalLineage: true },
      },
    ]) {
      const fixture = await createFixture(variation.options);
      try {
        await expect(loadC6RepositoryDesignEvidence(fixture.input))
          .rejects.toThrow(variation.expected);
      } finally {
        await rm(fixture.root, { force: true, recursive: true });
      }
    }
  });
});

interface FixtureOptions {
  collapseToOneFamily?: boolean;
  conflictingAlias?: boolean;
  designPowerInputSha256?: string;
  extremeAllocationConcentration?: boolean;
  invalidDirectRelation?: boolean;
  nonCanonicalLineage?: boolean;
  omitRawRepository?: string;
  powerRequiredRepositoryFamilies?: number;
  precisionRequiredRepositoryFamilies?: number;
  receiptDesignSha256?: string;
  requiredRepositoryFamilies?: number;
  responseRequestSha256?: string;
  reviewer?: string;
  splitUpstreamAcrossFamilies?: boolean;
}

async function createFixture(options: FixtureOptions = {}) {
  const root = await realpath(await mkdtemp(join(
    await realpath(tmpdir()),
    "goodmemory-c6-repository-design-",
  )));
  const evidenceRoot = join(root, "provenance/repository-design");
  const reviewRoot = join(evidenceRoot, "review");
  await mkdir(reviewRoot, { recursive: true });

  const dataset = {
    episodes: [
      {
        id: "episode-a",
        repository: {
          url: "https://GitHub.COM/example/alpha.git/",
        },
      },
      {
        id: "episode-b",
        repository: {
          url: "https://github.com/example/alpha",
        },
      },
      {
        id: "episode-c",
        repository: {
          url: "https://github.com/example/beta/",
        },
      },
      {
        id: "episode-d",
        repository: {
          url: options.extremeAllocationConcentration
            ? "https://github.com/example/alpha"
            : "https://github.com/example/beta",
        },
      },
    ],
  };
  const datasetSha256 = sha256(canonical(dataset));

  const repositories = [
    {
      canonicalUrl: "https://github.com/example/alpha",
      familyId: "family-alpha",
      rawUrl: "https://github.com/example/alpha/",
      relation: "direct",
      upstreamIdentity: "github:example/alpha",
    },
    {
      canonicalUrl: options.invalidDirectRelation
        ? "https://github.com/upstream/beta"
        : "https://github.com/example/beta",
      familyId: options.collapseToOneFamily
        ? "family-alpha"
        : options.splitUpstreamAcrossFamilies
        ? "family-beta-split"
        : "family-beta",
      rawUrl: "https://github.com/example/beta",
      relation: "direct",
      upstreamIdentity:
        options.splitUpstreamAcrossFamilies ||
          options.collapseToOneFamily
        ? "github:example/alpha"
        : "github:example/beta",
    },
  ].filter((repository) =>
    repository.rawUrl !== options.omitRawRepository
  );
  if (options.conflictingAlias) {
    repositories.push({
      canonicalUrl: "https://github.com/other/alpha",
      familyId: "family-conflict",
      rawUrl: "https://GITHUB.COM/example/alpha.git/",
      relation: "rename",
      upstreamIdentity: "github:other/alpha",
    });
  }
  const lineage = {
    datasetSha256,
    repositories,
    schemaVersion: 1,
  };
  const lineageBytes = canonical(lineage);
  await writeFile(
    join(evidenceRoot, "repository-lineage.json"),
    options.nonCanonicalLineage
      ? JSON.stringify(lineage)
      : lineageBytes,
  );
  const lineageSha256 = sha256(
    options.nonCanonicalLineage ? JSON.stringify(lineage) : lineageBytes,
  );

  const familyByEpisode = {
    "episode-a": "family-alpha",
    "episode-b": "family-alpha",
    "episode-c": options.collapseToOneFamily
      ? "family-alpha"
      : options.splitUpstreamAcrossFamilies
      ? "family-beta-split"
      : "family-beta",
    "episode-d":
      options.collapseToOneFamily ||
        options.extremeAllocationConcentration
        ? "family-alpha"
        : options.splitUpstreamAcrossFamilies
        ? "family-beta-split"
        : "family-beta",
  };
  const bindingSha256 = episodeFamilyBindingSha256(familyByEpisode);
  const allocationSha256 = familyAllocationSha256(familyByEpisode);
  const powerInput = {
    algorithm: "repository-mean-normal-power-and-precision-v1",
    alpha: 0.05,
    confidenceLevel: 0.95,
    maximumHalfWidth: 0.029,
    minimumDetectableEffect: 0.03,
    minimumRepositoryFamilies: 2,
    planningRepositoryStandardDeviation: 0.015,
    power: 0.8,
    schemaVersion: 1,
  };
  const powerInputBytes = canonical(powerInput);
  await writeFile(
    join(evidenceRoot, "power-input.json"),
    powerInputBytes,
  );
  const powerInputSha256 = sha256(powerInputBytes);
  const powerRequiredRepositoryFamilies =
    options.powerRequiredRepositoryFamilies ?? 2;
  const precisionRequiredRepositoryFamilies =
    options.precisionRequiredRepositoryFamilies ?? 2;
  const requiredRepositoryFamilies =
    options.requiredRepositoryFamilies ?? 2;
  const design = {
    createdAt: CREATED_AT,
    datasetEpisodeCount: dataset.episodes.length,
    datasetSha256,
    episodeFamilyBindingSha256: bindingSha256,
    groupingPolicy: "canonical-upstream-repository-family-v1",
    powerInputArtifactSha256:
      options.designPowerInputSha256 ?? powerInputSha256,
    powerRequiredRepositoryFamilies,
    precisionRequiredRepositoryFamilies,
    repositoryFamilyAllocationSha256: allocationSha256,
    requiredRepositoryFamilies,
    schemaVersion: 1,
    author: "author-agent",
  };
  const designBytes = canonical(design);
  await writeFile(join(evidenceRoot, "design-power.json"), designBytes);
  const designSha256 = sha256(designBytes);

  const reviewInput = {
    datasetSha256,
    designPowerArtifactSha256: designSha256,
    powerInputArtifactSha256: powerInputSha256,
    repositoryLineageArtifactSha256: lineageSha256,
    schemaVersion: 1,
  };
  const reviewInputBytes = canonical(reviewInput);
  await writeFile(join(reviewRoot, "input.json"), reviewInputBytes);
  const reviewInputSha256 = sha256(reviewInputBytes);

  const request = {
    declaredOutcomeAccess: "prohibited",
    inputSha256: reviewInputSha256,
    schemaVersion: 1,
    task: "repository-design-review",
  };
  const requestBytes = canonical(request);
  await writeFile(join(reviewRoot, "request.json"), requestBytes);
  const requestSha256 = sha256(requestBytes);

  const reviewer = options.reviewer ?? "reviewer-agent";
  const dispatch = {
    author: "author-agent",
    inputSha256: reviewInputSha256,
    requestSha256,
    reviewer,
    schemaVersion: 1,
  };
  const dispatchBytes = canonical(dispatch);
  await writeFile(join(reviewRoot, "dispatch.json"), dispatchBytes);
  const dispatchSha256 = sha256(dispatchBytes);

  const response = {
    decision: "accepted",
    designPowerArtifactSha256: designSha256,
    inputSha256: reviewInputSha256,
    requestSha256: options.responseRequestSha256 ?? requestSha256,
    reviewedAt: REVIEWED_AT,
    reviewer,
    schemaVersion: 1,
  };
  const responseBytes = canonical(response);
  await writeFile(join(reviewRoot, "response.json"), responseBytes);
  const responseSha256 = sha256(responseBytes);

  const reviewReceipt = {
    author: "author-agent",
    decision: "accepted",
    designPowerArtifactSha256:
      options.receiptDesignSha256 ?? designSha256,
    provenance: {
      dispatch: {
        path: "provenance/repository-design/review/dispatch.json",
        sha256: dispatchSha256,
      },
      input: {
        path: "provenance/repository-design/review/input.json",
        sha256: reviewInputSha256,
      },
      request: {
        path: "provenance/repository-design/review/request.json",
        sha256: requestSha256,
      },
      response: {
        path: "provenance/repository-design/review/response.json",
        sha256: responseSha256,
      },
    },
    powerInputArtifactSha256: powerInputSha256,
    repositoryLineageArtifactSha256: lineageSha256,
    reviewedAt: REVIEWED_AT,
    reviewer,
    schemaVersion: 1,
  };
  const reviewReceiptBytes = canonical(reviewReceipt);
  await writeFile(
    join(evidenceRoot, "review-receipt.json"),
    reviewReceiptBytes,
  );
  const reviewReceiptSha256 = sha256(reviewReceiptBytes);

  const assetLock = await buildC6AssetLock(root);
  const assetLockBytes = serializeC6AssetLock(assetLock);
  await writeFile(join(root, "asset-lock.json"), assetLockBytes);

  return {
    allocationSha256,
    bindingSha256,
    datasetSha256,
    designSha256,
    input: {
      assetRoot: root,
      dataset,
      datasetSha256,
      expectedAssetLockSha256: sha256(assetLockBytes),
      expectedAssetRootSha256: assetLock.assetRootSha256,
      expectedDesignPowerArtifactSha256: designSha256,
      expectedPowerInputArtifactSha256: powerInputSha256,
      expectedRepositoryLineageArtifactSha256: lineageSha256,
      expectedReviewReceiptSha256: reviewReceiptSha256,
    } satisfies C6RepositoryDesignEvidenceInput,
    lineageSha256,
    powerInputSha256,
    reviewReceiptSha256,
    root,
  };
}

function canonical(value: unknown): string {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJson(entry)]),
    );
  }
  return value;
}

function episodeFamilyBindingSha256(
  familyByEpisode: Record<string, string>,
): string {
  return sha256(canonical(
    Object.entries(familyByEpisode)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([episodeId, familyId]) => ({ episodeId, familyId })),
  ));
}

function familyAllocationSha256(
  familyByEpisode: Record<string, string>,
): string {
  const episodesByFamily = new Map<string, string[]>();
  for (const [episodeId, familyId] of Object.entries(familyByEpisode)) {
    const episodeIds = episodesByFamily.get(familyId) ?? [];
    episodeIds.push(episodeId);
    episodesByFamily.set(familyId, episodeIds);
  }
  return sha256(canonical(
    [...episodesByFamily.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([familyId, episodeIds]) => ({
        episodeIds: episodeIds.sort(),
        familyId,
      })),
  ));
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
