import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "bun:test";

import {
  buildC6AssetLock,
  serializeC6AssetLock,
} from "../../scripts/codex-coding-effect/c6-asset-lock";
import {
  captureC6SourceV3SimplePriorRepositoryIdentityDraftEvidence,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-prior-repository-identity";
import {
  buildC6SourceV3SimplePriorRepositoryIdentityReplayReceipt,
  parseC6SourceV3SimplePriorRepositoryIdentityReplayReceipt,
  serializeC6SourceV3SimplePriorRepositoryIdentityReplayReceipt,
  verifyC6SourceV3SimplePriorRepositoryIdentityReplayReceipt,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-prior-repository-identity-replay";
import {
  materializeC6SourceV3SimplePriorRepositoryIdentityReplayReceipt,
  parseC6SourceV3SimplePriorRepositoryIdentityReplayCliOptions,
} from "../../scripts/record-codex-coding-effect-c6-source-v3-simple-prior-identity-replay";
import {
  buildC6SourceV3SimplePriorRepositoryIdentityStructure,
  C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_STRUCTURE_PATH,
  serializeC6SourceV3SimplePriorRepositoryIdentityStructure,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-prior-repository-identity-structure";
import {
  parseC6Wave3PriorRepositoryIdentityPlan,
} from "../../scripts/codex-coding-effect/c6-wave3-prior-repository-identity-plan";

const SOURCE_ROOT = join(
  process.cwd(),
  "fixtures/codex-coding-effect/c6-source-pool",
);
const PROTOCOL_PATH = join(
  SOURCE_ROOT,
  "swe-bench-live-multilang-608f7ae9." +
    "source-v3-simple-protocol-v1.json",
);
const PLAN_PATH = join(
  SOURCE_ROOT,
  "swe-bench-live-multilang-608f7ae9." +
    "wave3-prior-repository-identity-plan-v1.json",
);
const SOURCE_PATH = join(
  SOURCE_ROOT,
  "swe-bench-live-multilang-608f7ae9." +
    "wave3-source-universe-v2.json",
);
const TOKEN = "github_pat_C6_REPLAY_TEST_SENTINEL_947301";
const RESET_AT = "2026-07-25T13:00:00Z";
const RESET_EPOCH = String(Date.parse(RESET_AT) / 1_000);
const temporaryRoots: string[] = [];
const EVIDENCE_TEST_TIMEOUT_MILLISECONDS = 120_000;

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true })
    ),
  );
});

describe("C6 source-v3-simple prior identity observation replay receipt", () => {
  it("compares two distinct complete observation sets without authorizing census", async () => {
    const parent = await mkdtemp(
      join(await realpath(tmpdir()), "goodmemory-c6-source-v3-prior-replay-"),
    );
    temporaryRoots.push(parent);
    const [captureA, captureB] = await Promise.all([
      materializeBundle(join(parent, "capture-a"), "A"),
      materializeBundle(join(parent, "capture-b"), "B"),
    ]);

    const receipt =
      await buildC6SourceV3SimplePriorRepositoryIdentityReplayReceipt({
        captureA,
        captureB,
        planPath: PLAN_PATH,
        protocolPath: PROTOCOL_PATH,
        sourceUniversePath: SOURCE_PATH,
      });

    expect(receipt.boundary).toEqual({
      candidateManifestFrozen: false,
      captureOriginIndependentlyVerified: false,
      codexRunReady: false,
      externalAuthenticityVerified: false,
      formalCensusPermitted: false,
      independentCaptureProcessProven: false,
      liveNetworkExecutionProven: false,
      priorRepositoryNodeIdExclusionComplete: false,
      repositoryIdentityReplayAgreementObserved: true,
      sourceV3SimpleFrozen: false,
      status:
        "two-observation-set-structures-agree-awaiting-live-provenance-independent-review-and-freeze-ancestry",
    });
    expect(receipt.counts).toEqual({
      captureCount: 2,
      finalRequestIdCountPerCapture: 356,
      logicalLookupCountPerCapture: 356,
      totalNetworkAttemptCount: 712,
      uniqueNodeIdCount: 178,
    });
    expect(receipt.comparison).toMatchObject({
      finalRequestIdIntersectionCount: 0,
      nodeIdDedupProjectionEqual: true,
      repositoryIdentityProjectionEqual: true,
    });
    const bytes =
      serializeC6SourceV3SimplePriorRepositoryIdentityReplayReceipt(
        receipt,
      );
    expect(
      parseC6SourceV3SimplePriorRepositoryIdentityReplayReceipt(
        bytes,
      ),
    ).toEqual(receipt);
    await expect(
      verifyC6SourceV3SimplePriorRepositoryIdentityReplayReceipt(
        bytes,
        {
          captureA,
          captureB,
          planPath: PLAN_PATH,
          protocolPath: PROTOCOL_PATH,
          sourceUniversePath: SOURCE_PATH,
        },
      ),
    ).resolves.toEqual(receipt);

    const outputPath = join(parent, "receipt.json");
    const materialized =
      await materializeC6SourceV3SimplePriorRepositoryIdentityReplayReceipt({
        captureA,
        captureB,
        outputPath,
        planPath: PLAN_PATH,
        protocolPath: PROTOCOL_PATH,
        sourceUniversePath: SOURCE_PATH,
      });
    expect(materialized).toMatchObject({
      candidateManifestFrozen: false,
      codexRunReady: false,
      formalCensusPermitted: false,
      outputPath,
      priorRepositoryNodeIdExclusionComplete: false,
      repositoryIdentityReplayAgreementObserved: true,
      sourceV3SimpleFrozen: false,
    });
    const publishedBytes = await readFile(outputPath);
    expect(
      parseC6SourceV3SimplePriorRepositoryIdentityReplayReceipt(
        publishedBytes,
      ),
    ).toEqual(receipt);
    await expect(
      materializeC6SourceV3SimplePriorRepositoryIdentityReplayReceipt({
        captureA,
        captureB,
        outputPath,
        planPath: PLAN_PATH,
        protocolPath: PROTOCOL_PATH,
        sourceUniversePath: SOURCE_PATH,
      }),
    ).rejects.toThrow();
    expect(await readFile(outputPath)).toEqual(publishedBytes);

    await expect(
      buildC6SourceV3SimplePriorRepositoryIdentityReplayReceipt({
        captureA,
        captureB: captureA,
        planPath: PLAN_PATH,
        protocolPath: PROTOCOL_PATH,
        sourceUniversePath: SOURCE_PATH,
      }),
    ).rejects.toThrow("distinct observation sets");

    const forged = structuredClone(receipt) as {
      boundary: {
        priorRepositoryNodeIdExclusionComplete: boolean;
      };
    };
    forged.boundary.priorRepositoryNodeIdExclusionComplete =
      true;
    expect(() =>
      parseC6SourceV3SimplePriorRepositoryIdentityReplayReceipt(
        `${JSON.stringify(forged, null, 2)}\n`,
      )
    ).toThrow();
  }, EVIDENCE_TEST_TIMEOUT_MILLISECONDS);

  it("parses only the six required create-only materializer options", () => {
    expect(
      parseC6SourceV3SimplePriorRepositoryIdentityReplayCliOptions([
        "--capture-a=/tmp/capture-a",
        "--capture-b=/tmp/capture-b",
        "--output=/tmp/receipt.json",
        "--plan=/tmp/plan.json",
        "--protocol=/tmp/protocol.json",
        "--source-universe=/tmp/source.json",
      ]),
    ).toEqual({
      captureA: "/tmp/capture-a",
      captureB: "/tmp/capture-b",
      outputPath: "/tmp/receipt.json",
      planPath: "/tmp/plan.json",
      protocolPath: "/tmp/protocol.json",
      sourceUniversePath: "/tmp/source.json",
    });
    expect(() =>
      parseC6SourceV3SimplePriorRepositoryIdentityReplayCliOptions([
        "--capture-a=/tmp/capture-a",
      ])
    ).toThrow("--capture-b is required");
    expect(() =>
      parseC6SourceV3SimplePriorRepositoryIdentityReplayCliOptions([
        "--capture-a=/tmp/capture-a",
        "--capture-a=/tmp/capture-a-2",
      ])
    ).toThrow("--capture-a cannot be specified more than once");
    expect(() =>
      parseC6SourceV3SimplePriorRepositoryIdentityReplayCliOptions([
        "--unknown=value",
      ])
    ).toThrow("unknown C6 source-v3-simple prior identity replay option");
  });

  it("derives alias-deduplicated node counts from both captures", async () => {
    const parent = await mkdtemp(
      join(await realpath(tmpdir()), "goodmemory-c6-source-v3-prior-replay-alias-"),
    );
    temporaryRoots.push(parent);
    const [captureA, captureB] = await Promise.all([
      materializeBundle(
        join(parent, "capture-a"),
        "ALIASA",
        true,
      ),
      materializeBundle(
        join(parent, "capture-b"),
        "ALIASB",
        true,
      ),
    ]);

    const receipt =
      await buildC6SourceV3SimplePriorRepositoryIdentityReplayReceipt({
        captureA,
        captureB,
        planPath: PLAN_PATH,
        protocolPath: PROTOCOL_PATH,
        sourceUniversePath: SOURCE_PATH,
      });

    expect(receipt.counts.uniqueNodeIdCount).toBe(177);
    expect(
      receipt.captures.captureA.uniqueNodeIdCount,
    ).toBe(177);
    expect(
      receipt.captures.captureB.uniqueNodeIdCount,
    ).toBe(177);
  }, 30_000);
});

async function materializeBundle(
  bundleRoot: string,
  requestIdPrefix: string,
  aliasFirstTwo = false,
): Promise<string> {
  await mkdir(bundleRoot);
  const rawEvidenceRoot = join(
    bundleRoot,
    "raw-evidence",
  );
  let requestIndex = 0;
  const plan = parseC6Wave3PriorRepositoryIdentityPlan(
    await readFile(PLAN_PATH),
  );
  const aliasRequestedName =
    plan.targets[1]!.requestedNameWithOwner;
  const aliasResolution =
    plan.targets[0]!.requestedNameWithOwner;
  const draft =
    await captureC6SourceV3SimplePriorRepositoryIdentityDraftEvidence({
      authorizationToken: TOKEN,
      outputRoot: rawEvidenceRoot,
      planPath: PLAN_PATH,
      protocolPath: PROTOCOL_PATH,
      sleep: async () => undefined,
      sourceUniversePath: SOURCE_PATH,
      transport: async (request) => {
        requestIndex += 1;
        const body = await request.json() as {
          variables: {
            name: string;
            owner: string;
          };
        };
        const nameWithOwner =
          `${body.variables.owner}/${body.variables.name}`;
        const resolvedNameWithOwner =
          aliasFirstTwo &&
            nameWithOwner === aliasRequestedName
            ? aliasResolution
            : nameWithOwner;
        return successResponse({
          nameWithOwner: resolvedNameWithOwner,
          repositoryNodeId:
            `R_${resolvedNameWithOwner.replace("/", "_")}`,
          requestId:
            `${requestIdPrefix}${requestIndex}:1234`,
        });
      },
    });
  const structure =
    await buildC6SourceV3SimplePriorRepositoryIdentityStructure({
      assetRoot: rawEvidenceRoot,
      lookups: draft.lookups,
      plan,
      planPath: PLAN_PATH,
      protocolPath: PROTOCOL_PATH,
      sourceUniversePath: SOURCE_PATH,
    });
  await writeFile(
    join(
      bundleRoot,
      C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_STRUCTURE_PATH,
    ),
    serializeC6SourceV3SimplePriorRepositoryIdentityStructure(
      structure,
    ),
  );
  await writeFile(
    join(bundleRoot, "asset-lock.json"),
    serializeC6AssetLock(
      await buildC6AssetLock(bundleRoot),
    ),
  );
  return bundleRoot;
}

function successResponse(input: {
  nameWithOwner: string;
  repositoryNodeId: string;
  requestId: string;
}): Response {
  return new Response(JSON.stringify({
    data: {
      rateLimit: {
        cost: 1,
        limit: 5_000,
        remaining: 4_000,
        resetAt: RESET_AT,
        used: 1_000,
      },
      repository: {
        id: input.repositoryNodeId,
        nameWithOwner: input.nameWithOwner,
        url: `https://github.com/${input.nameWithOwner}`,
      },
    },
  }), {
    headers: {
      date: "Sat, 25 Jul 2026 12:00:00 GMT",
      "x-github-request-id": input.requestId,
      "x-ratelimit-limit": "5000",
      "x-ratelimit-remaining": "4000",
      "x-ratelimit-reset": RESET_EPOCH,
      "x-ratelimit-resource": "graphql",
      "x-ratelimit-used": "1000",
    },
    status: 200,
  });
}
