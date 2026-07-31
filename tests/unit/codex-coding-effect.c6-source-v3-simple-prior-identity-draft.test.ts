import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "bun:test";

import {
  captureC6SourceV3SimplePriorRepositoryIdentityDraftEvidence,
  verifyC6SourceV3SimplePriorRepositoryIdentityBundle,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-prior-repository-identity";
import {
  buildC6SourceV3SimplePriorRepositoryIdentityStructure,
  C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_STRUCTURE_PATH,
  serializeC6SourceV3SimplePriorRepositoryIdentityStructure,
  verifyC6SourceV3SimplePriorRepositoryIdentityStructure,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-prior-repository-identity-structure";
import {
  buildC6AssetLock,
  serializeC6AssetLock,
} from "../../scripts/codex-coding-effect/c6-asset-lock";
import {
  C6_WAVE3_PRIOR_REPOSITORY_IDENTITY_QUERY,
  parseC6Wave3PriorRepositoryIdentityPlan,
  verifyC6Wave3PriorRepositoryIdentityDraftEvidence,
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
const TOKEN = "github_pat_C6_SOURCE_V3_DRAFT_SENTINEL_947301";
const RESET_AT = "2026-07-25T13:00:00Z";
const RESET_EPOCH = String(Date.parse(RESET_AT) / 1_000);
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true })
    ),
  );
});

describe("C6 source-v3-simple prior identity draft capture", () => {
  it("captures the exact 356-lookups in two complete passes without authorizing census", async () => {
    const parent = await mkdtemp(
      join(await realpath(tmpdir()), "goodmemory-c6-source-v3-prior-draft-parent-"),
    );
    temporaryRoots.push(parent);
    const outputRoot = join(parent, "draft-evidence");
    const plan = parseC6Wave3PriorRepositoryIdentityPlan(
      await readFile(PLAN_PATH),
    );
    const requests: Array<{
      name: string;
      owner: string;
    }> = [];

    const result =
      await captureC6SourceV3SimplePriorRepositoryIdentityDraftEvidence({
        authorizationToken: TOKEN,
        outputRoot,
        planPath: PLAN_PATH,
        protocolPath: PROTOCOL_PATH,
        sleep: async () => undefined,
        sourceUniversePath: SOURCE_PATH,
        transport: async (request) => {
          expect(request.url).toBe(
            "https://api.github.com/graphql",
          );
          expect(request.method).toBe("POST");
          expect(request.headers.get("authorization")).toBe(
            `Bearer ${TOKEN}`,
          );
          const body = await request.json() as {
            query: string;
            variables: {
              name: string;
              owner: string;
            };
          };
          expect(body.query).toBe(
            C6_WAVE3_PRIOR_REPOSITORY_IDENTITY_QUERY,
          );
          requests.push(body.variables);
          const nameWithOwner =
            `${body.variables.owner}/${body.variables.name}`;
          return successResponse({
            nameWithOwner,
            repositoryNodeId:
              `R_${body.variables.owner}_${body.variables.name}`,
          });
        },
      });

    expect(requests).toEqual([
      ...plan.targets,
      ...plan.targets,
    ].map((target) => ({
      name: target.requestedName,
      owner: target.requestedOwner,
    })));
    expect(result).toMatchObject({
      formalCensusPermitted: false,
      networkAttemptCount: 356,
      outputRoot,
      sourceV3SimpleFrozen: false,
    });
    expect(result.lookups).toHaveLength(356);
    await expect(
      verifyC6Wave3PriorRepositoryIdentityDraftEvidence({
        assetRoot: outputRoot,
        lookups: result.lookups,
        plan,
        planPath: PLAN_PATH,
        sourceUniversePath: SOURCE_PATH,
      }),
    ).resolves.toBeUndefined();
    const structure =
      await buildC6SourceV3SimplePriorRepositoryIdentityStructure({
        assetRoot: outputRoot,
        lookups: result.lookups,
        plan,
        planPath: PLAN_PATH,
        protocolPath: PROTOCOL_PATH,
        sourceUniversePath: SOURCE_PATH,
      });
    expect(structure.boundary).toEqual({
      candidateManifestFrozen: false,
      captureOriginIndependentlyVerified: false,
      codexRunReady: false,
      formalCensusPermitted: false,
      legacySourceV2CaptureAuthorized: false,
      officialWave3SearchPermitted: false,
      priorRepositoryNodeIdExclusionComplete: false,
      priorRepositoryNodeIdExclusionStructureComplete: true,
      sourceV3SimpleFrozen: false,
      status:
        "source-v3-prior-identity-structure-only-awaiting-independent-live-origin-verification",
    });
    await expect(
      verifyC6SourceV3SimplePriorRepositoryIdentityStructure(
        serializeC6SourceV3SimplePriorRepositoryIdentityStructure(
          structure,
        ),
        {
          assetRoot: outputRoot,
          plan,
          planPath: PLAN_PATH,
          protocolPath: PROTOCOL_PATH,
          sourceUniversePath: SOURCE_PATH,
        },
      ),
    ).resolves.toEqual(structure);

    const bundleRoot = join(parent, "structure-bundle");
    const rawEvidenceRoot = join(
      bundleRoot,
      "raw-evidence",
    );
    await mkdir(bundleRoot);
    await rename(outputRoot, rawEvidenceRoot);
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
    await expect(
      verifyC6SourceV3SimplePriorRepositoryIdentityBundle({
        outputRoot: bundleRoot,
        planPath: PLAN_PATH,
        protocolPath: PROTOCOL_PATH,
        sourceUniversePath: SOURCE_PATH,
      }),
    ).resolves.toMatchObject({
      candidateManifestFrozen: false,
      captureOriginIndependentlyVerified: false,
      codexRunReady: false,
      formalCensusPermitted: false,
      legacySourceV2CaptureAuthorized: false,
      networkAttemptCount: 356,
      priorRepositoryNodeIdExclusionComplete: false,
      priorRepositoryNodeIdExclusionStructureVerified: true,
      sourceV3SimpleFrozen: false,
      uniqueNodeIdCount: 178,
    });
    expect((await readdir(bundleRoot)).sort()).toEqual([
      C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_STRUCTURE_PATH,
      "asset-lock.json",
      "raw-evidence",
    ].sort());

    const structurePath = join(
      bundleRoot,
      C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_STRUCTURE_PATH,
    );
    const forgedAuthority = structuredClone(structure) as {
      boundary: {
        priorRepositoryNodeIdExclusionComplete: boolean;
      };
    };
    forgedAuthority.boundary
      .priorRepositoryNodeIdExclusionComplete = true;
    await writeFile(
      structurePath,
      `${JSON.stringify(forgedAuthority, null, 2)}\n`,
    );
    await writeFile(
      join(bundleRoot, "asset-lock.json"),
      serializeC6AssetLock(
        await buildC6AssetLock(bundleRoot),
      ),
    );
    await expect(
      verifyC6SourceV3SimplePriorRepositoryIdentityBundle({
        outputRoot: bundleRoot,
        planPath: PLAN_PATH,
        protocolPath: PROTOCOL_PATH,
        sourceUniversePath: SOURCE_PATH,
      }),
    ).rejects.toThrow();

    await writeFile(
      structurePath,
      serializeC6SourceV3SimplePriorRepositoryIdentityStructure(
        structure,
      ),
    );
    await writeFile(
      join(bundleRoot, "unexpected.json"),
      "{}\n",
    );
    await writeFile(
      join(bundleRoot, "asset-lock.json"),
      serializeC6AssetLock(
        await buildC6AssetLock(bundleRoot),
      ),
    );
    await expect(
      verifyC6SourceV3SimplePriorRepositoryIdentityBundle({
        outputRoot: bundleRoot,
        planPath: PLAN_PATH,
        protocolPath: PROTOCOL_PATH,
        sourceUniversePath: SOURCE_PATH,
      }),
    ).rejects.toThrow("outer asset closure mismatch");
  }, 30_000);

  it("records frozen HTTP and transport retries without changing lookup order", async () => {
    const parent = await temporaryParent();
    const outputRoot = join(parent, "retry-evidence");
    const sleeps: number[] = [];
    let networkAttemptCount = 0;

    const result =
      await captureC6SourceV3SimplePriorRepositoryIdentityDraftEvidence({
        authorizationToken: TOKEN,
        outputRoot,
        planPath: PLAN_PATH,
        protocolPath: PROTOCOL_PATH,
        sleep: async (milliseconds) => {
          sleeps.push(milliseconds);
        },
        sourceUniversePath: SOURCE_PATH,
        transport: async (request) => {
          networkAttemptCount += 1;
          if (networkAttemptCount === 1) {
            return new Response('{"retry":true}', {
              headers: {
                "retry-after": "0",
              },
              status: 429,
            });
          }
          if (networkAttemptCount === 3) {
            throw Object.assign(
              new Error("transient reset"),
              { code: "ECONNRESET" },
            );
          }
          const variables = await requestVariables(request);
          return successResponse({
            nameWithOwner:
              `${variables.owner}/${variables.name}`,
            repositoryNodeId:
              `R_${variables.owner}_${variables.name}`,
          });
        },
      });

    expect(result.networkAttemptCount).toBe(358);
    expect(sleeps).toEqual([0, 1_000]);
    expect(result.lookups[0]!.attempts).toHaveLength(2);
    expect(result.lookups[0]!.attempts[0]).toMatchObject({
      httpStatus: 429,
      outcome: "retryable-http-status",
      retryDecision: {
        decision: "retry",
        delayMilliseconds: 0,
        reason: "retryable-http-429",
      },
    });
    expect(result.lookups[1]!.attempts[0]).toMatchObject({
      outcome: "transient-transport-failure",
      retryDecision: {
        decision: "retry",
        delayMilliseconds: 1_000,
        reason: "transient-transport-code",
      },
      transportError: {
        code: "ECONNRESET",
        transient: true,
      },
    });
  }, 30_000);

  it("fails closed and retains non-verifiable draft output on invalid retry or GraphQL data", async () => {
    const invalidRetryParent = await temporaryParent();
    const invalidRetryRoot = join(
      invalidRetryParent,
      "invalid-retry",
    );
    await expect(
      captureC6SourceV3SimplePriorRepositoryIdentityDraftEvidence({
        authorizationToken: TOKEN,
        outputRoot: invalidRetryRoot,
        planPath: PLAN_PATH,
        protocolPath: PROTOCOL_PATH,
        sleep: async () => undefined,
        sourceUniversePath: SOURCE_PATH,
        transport: async () =>
          new Response('{"retry":true}', {
            headers: {
              "retry-after":
                "Sat, 25 Jul 2026 12:00:00 GMT",
            },
            status: 429,
          }),
      }),
    ).rejects.toThrow("retry-after is invalid");
    expect((await stat(invalidRetryRoot)).isDirectory()).toBe(
      true,
    );
    await expect(
      stat(join(invalidRetryRoot, "asset-lock.json")),
    ).rejects.toThrow();

    const graphqlParent = await temporaryParent();
    const graphqlRoot = join(graphqlParent, "graphql-error");
    await expect(
      captureC6SourceV3SimplePriorRepositoryIdentityDraftEvidence({
        authorizationToken: TOKEN,
        outputRoot: graphqlRoot,
        planPath: PLAN_PATH,
        protocolPath: PROTOCOL_PATH,
        sleep: async () => undefined,
        sourceUniversePath: SOURCE_PATH,
        transport: async () =>
          new Response(JSON.stringify({
            data: {
              rateLimit: {
                cost: 1,
                limit: 5_000,
                remaining: 4_000,
                resetAt: RESET_AT,
                used: 1_000,
              },
              repository: null,
            },
            errors: [{ message: "not found" }],
          }), {
            status: 200,
          }),
      }),
    ).rejects.toThrow();
    expect((await stat(graphqlRoot)).isDirectory()).toBe(true);
    await expect(
      stat(join(graphqlRoot, "asset-lock.json")),
    ).rejects.toThrow();

    const tokenEchoParent = await temporaryParent();
    const tokenEchoRoot = join(
      tokenEchoParent,
      "token-echo",
    );
    await expect(
      captureC6SourceV3SimplePriorRepositoryIdentityDraftEvidence({
        authorizationToken: TOKEN,
        outputRoot: tokenEchoRoot,
        planPath: PLAN_PATH,
        protocolPath: PROTOCOL_PATH,
        sleep: async () => undefined,
        sourceUniversePath: SOURCE_PATH,
        transport: async () =>
          new Response(`{"echo":${JSON.stringify(TOKEN)}}`, {
            status: 200,
          }),
      }),
    ).rejects.toThrow(
      "external response contains the authorization token",
    );
    expect(await treeContains(tokenEchoRoot, TOKEN)).toBe(
      false,
    );
  });

  it("preserves a foreign directory that replaces the owned draft root", async () => {
    const parent = await temporaryParent();
    const outputRoot = join(parent, "owned-root");
    const movedOwnedRoot = join(parent, "moved-owned-root");
    const foreignMarker = join(outputRoot, "foreign.txt");

    await expect(
      captureC6SourceV3SimplePriorRepositoryIdentityDraftEvidence({
        authorizationToken: TOKEN,
        outputRoot,
        planPath: PLAN_PATH,
        protocolPath: PROTOCOL_PATH,
        sleep: async () => undefined,
        sourceUniversePath: SOURCE_PATH,
        transport: async () => {
          await rename(outputRoot, movedOwnedRoot);
          await mkdir(outputRoot);
          await writeFile(foreignMarker, "foreign\n");
          throw new Error("forced path replacement");
        },
      }),
    ).rejects.toThrow();
    expect(await readFile(foreignMarker, "utf8")).toBe(
      "foreign\n",
    );
  });

});

async function temporaryParent(): Promise<string> {
  const parent = await mkdtemp(
    join(await realpath(tmpdir()), "goodmemory-c6-source-v3-prior-draft-parent-"),
  );
  temporaryRoots.push(parent);
  return parent;
}

async function requestVariables(request: Request): Promise<{
  name: string;
  owner: string;
}> {
  const body = await request.json() as {
    variables: {
      name: string;
      owner: string;
    };
  };
  return body.variables;
}

function successResponse(input: {
  nameWithOwner: string;
  repositoryNodeId: string;
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
      "x-github-request-id": "C6TEST:1234",
      "x-ratelimit-limit": "5000",
      "x-ratelimit-remaining": "4000",
      "x-ratelimit-reset": RESET_EPOCH,
      "x-ratelimit-resource": "graphql",
      "x-ratelimit-used": "1000",
    },
    status: 200,
  });
}

async function treeContains(
  root: string,
  value: string,
): Promise<boolean> {
  for (
    const entry of await readdir(root, {
      withFileTypes: true,
    })
  ) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (await treeContains(path, value)) {
        return true;
      }
      continue;
    }
    if (
      entry.isFile() &&
      (await readFile(path)).includes(Buffer.from(value))
    ) {
      return true;
    }
  }
  return false;
}
