import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { afterAll, describe, expect, it } from "bun:test";

import { buildC6AssetLock } from "../../scripts/codex-coding-effect/c6-asset-lock";
import type {
  C6LiveMultiLangNeighborDeepEvidence,
} from "../../scripts/codex-coding-effect/c6-live-multilang-neighbor-deep-evidence";
import {
  replayC6LiveMultiLangNeighborDeepEvidence,
} from "../../scripts/codex-coding-effect/c6-live-multilang-neighbor-deep-evidence";

const DEEP_ROOT =
  "/private/tmp/goodmemory-c6-live-multilang-neighbor-deep-v1";
const PLAN_PATH = join(
  process.cwd(),
  "fixtures/codex-coding-effect/c6-source-pool/" +
    "swe-bench-live-multilang-608f7ae9." +
    "neighbor-deep-capture-plan-v1.json",
);
const EXPECTED = {
  expectedAssetRootSha256:
    "80c360d58b1959e5a47cbd70c5eb620276ed2105c49a595dccdb4aa178d1f83b",
  expectedCompletionSha256:
    "62ba6ada2d0ae54f4d43149e592ec06b70899e712a12f97dd503d8650ff2063d",
  expectedDirectoryCount: 2771,
  expectedFileCount: 2772,
  expectedPlanSha256:
    "9c1ebdafd700a274cffc4dba807a2425013079d1bfe74a1e99f1144399da492a",
  expectedTargetCount: 692,
} as const;

const temporaryRoots: string[] = [];
const realDeepEvidenceIt = existsSync(DEEP_ROOT) ? it : it.skip;
const responseMutationCases: Array<{
  mutate: (root: string) => Promise<DynamicExpected>;
  name: string;
}> = [
  {
    name: "missing response node",
    mutate: (root) => rewriteFirstResponse(root, (response) => {
      response.data.repository.pullRequest.commits.nodes.pop();
    }),
  },
  {
    name: "duplicate response node",
    mutate: (root) => rewriteFirstResponse(root, (response) => {
      const nodes =
        response.data.repository.pullRequest.commits.nodes;
      nodes.push(structuredClone(nodes[0]));
    }),
  },
  {
    name: "cursor drift",
    mutate: (root) => rewriteFirstResponse(root, (response) => {
      response.data.repository.pullRequest.reviews.pageInfo
        .hasNextPage = true;
    }),
  },
  {
    name: "identity drift",
    mutate: (root) => rewriteFirstResponse(root, (response) => {
      response.data.repository.id = "drifted-repository-id";
    }),
  },
  {
    name: "request variables drift",
    mutate: (root) => rewriteFirstRequest(root, (request) => {
      request.variables.number += 1;
    }),
  },
  {
    name: "successful retry schedules another attempt",
    mutate: (root) => rewriteFirstCapture(root, (capture) => {
      capture.requests[0].attempts[0]
        .retryAfterMilliseconds = 1_000;
    }),
  },
  {
    name: "unknown response metadata",
    mutate: (root) => rewriteFirstResponse(root, (response) => {
      response.oracleMetadata = { accepted: true };
    }),
  },
];
const treeMutationCases: Array<{
  mutate: (root: string) => Promise<void>;
  name: string;
}> = [
  {
    name: "extra file",
    mutate: async (root) => {
      await writeFile(join(root, "extra.json"), "{}\n", {
        mode: 0o600,
      });
    },
  },
  {
    name: "empty directory",
    mutate: async (root) => {
      await mkdir(join(root, "empty"), { mode: 0o700 });
    },
  },
  {
    name: "symlink",
    mutate: async (root) => {
      await symlink(
        join(root, "completion.json"),
        join(root, "completion-link.json"),
      );
    },
  },
  {
    name: "file mode",
    mutate: async (root) => {
      await chmod(join(root, "completion.json"), 0o644);
    },
  },
  {
    name: "setuid file mode",
    mutate: async (root) => {
      await setSpecialMode("4600", join(root, "completion.json"));
    },
  },
  {
    name: "directory mode",
    mutate: async (root) => {
      const captureDirectory =
        await firstCaptureDirectory(root);
      await chmod(join(root, captureDirectory), 0o755);
    },
  },
  {
    name: "sticky directory mode",
    mutate: async (root) => {
      const captureDirectory =
        await firstCaptureDirectory(root);
      await setSpecialMode(
        "1700",
        join(root, captureDirectory),
      );
    },
  },
];

afterAll(async () => {
  await Promise.all(
    temporaryRoots.map((root) =>
      rm(root, { force: true, recursive: true })
    ),
  );
}, 120_000);

describe("C6 live multilingual neighbor deep evidence replay", () => {
  realDeepEvidenceIt("independently replays the frozen 692-target, 2772-file capture", async () => {
    const evidence =
      await replayC6LiveMultiLangNeighborDeepEvidence({
        ...EXPECTED,
        deepCaptureRoot: DEEP_ROOT,
        planPath: PLAN_PATH,
      });

    expect(evidence.assetRootSha256).toBe(
      EXPECTED.expectedAssetRootSha256,
    );
    expect(evidence.completionSha256).toBe(
      EXPECTED.expectedCompletionSha256,
    );
    expect(evidence.fileCount).toBe(2772);
    expect(evidence.directoryCount).toBe(2771);
    expect(evidence.targets).toHaveLength(692);
    expect(evidence.logicalRequestCount).toBe(693);
    expect(evidence.networkRequestCount).toBe(693);
    expect(evidence.finalSuccessfulResponseCount).toBe(693);
    expect(normalizedEvidenceCounts(evidence)).toEqual({
      actorOccurrences: 3_877,
      commits: 2_009,
      parentEdges: 2_137,
      pullAuthors: 692,
      rawResponseReferences: 693,
      reviewActors: 1_848,
      reviewCommentActors: 1_337,
      reviewComments: 1_337,
      reviews: 1_848,
      reviewThreads: 834,
    });
    expect(sha256(JSON.stringify(evidence.targets))).toBe(
      "7286f92d0b211ab6830727969d2c40e691e73b1b55197fce221a271ef14edbcf",
    );
    expect(evidence.targets.every((target) =>
      target.rawResponseReferences.length >= 1 &&
      target.rawResponseReferences.every((response) =>
        response.reference.path.startsWith(
          `${target.captureDirectory}/`,
        )
      ) &&
      target.reviewSurfaceClosureSha256.length === 64
    )).toBe(true);
    expect(evidence.actorOccurrences.some((actor) =>
      actor.surface === "pull-author"
    )).toBe(true);
    expect(evidence.actorOccurrences.some((actor) =>
      actor.surface === "review"
    )).toBe(true);
    expect(evidence.actorOccurrences.some((actor) =>
      actor.surface === "review-thread-comment"
    )).toBe(true);
  }, 120_000);

  realDeepEvidenceIt("accepts qualification schema v3 in an otherwise valid plan closure", async () => {
    const variant = await buildPlanSchemaVersionVariant(3);
    const evidence =
      await replayC6LiveMultiLangNeighborDeepEvidence({
        ...EXPECTED,
        ...variant.expected,
        deepCaptureRoot: variant.root,
        planPath: variant.planPath,
      });

    expect(evidence.targets).toHaveLength(
      EXPECTED.expectedTargetCount,
    );
  }, 120_000);

  realDeepEvidenceIt("accepts commit-count eligibility qualification schema v1 in a valid plan closure", async () => {
    const variant = await buildPlanQualificationVariant({
      artifactKind:
        "c6-live-multilang-neighbor-commit-count-eligibility-qualification",
      schemaVersion: 1,
    });
    const evidence =
      await replayC6LiveMultiLangNeighborDeepEvidence({
        ...EXPECTED,
        ...variant.expected,
        deepCaptureRoot: variant.root,
        planPath: variant.planPath,
      });

    expect(evidence.targets).toHaveLength(
      EXPECTED.expectedTargetCount,
    );
  }, 120_000);

  realDeepEvidenceIt("rejects commit-count eligibility qualification schema v2", async () => {
    const variant = await buildPlanQualificationVariant({
      artifactKind:
        "c6-live-multilang-neighbor-commit-count-eligibility-qualification",
      schemaVersion: 2,
    });
    await expect(
      replayC6LiveMultiLangNeighborDeepEvidence({
        ...EXPECTED,
        ...variant.expected,
        deepCaptureRoot: variant.root,
        planPath: variant.planPath,
      }),
    ).rejects.toThrow();
  }, 120_000);

  realDeepEvidenceIt("rejects commit-count deep-plan projection drift", async () => {
    const variant = await buildPlanQualificationVariant({
      artifactKind:
        "c6-live-multilang-neighbor-commit-count-eligibility-qualification",
      deepPlanTargetProjectionSha256: "f".repeat(64),
      schemaVersion: 1,
    });
    await expect(
      replayC6LiveMultiLangNeighborDeepEvidence({
        ...EXPECTED,
        ...variant.expected,
        deepCaptureRoot: variant.root,
        planPath: variant.planPath,
      }),
    ).rejects.toThrow(
      "C6 deep-evidence plan projection mismatch",
    );
  }, 120_000);

  realDeepEvidenceIt("rejects qualification schema v4 in an otherwise valid plan closure", async () => {
    const variant = await buildPlanSchemaVersionVariant(4);
    await expect(
      replayC6LiveMultiLangNeighborDeepEvidence({
        ...EXPECTED,
        ...variant.expected,
        deepCaptureRoot: variant.root,
        planPath: variant.planPath,
      }),
    ).rejects.toThrow();
  }, 120_000);

  for (const testCase of responseMutationCases) {
    realDeepEvidenceIt(`rejects ${testCase.name}`, async () => {
      const root = await cloneDeepRoot();
      const dynamicExpected = await testCase.mutate(root);
      await expect(
        replayC6LiveMultiLangNeighborDeepEvidence({
          ...EXPECTED,
          ...dynamicExpected,
          deepCaptureRoot: root,
          planPath: PLAN_PATH,
        }),
        testCase.name,
      ).rejects.toThrow();
    }, 120_000);
  }

  for (const testCase of treeMutationCases) {
    realDeepEvidenceIt(`rejects ${testCase.name}`, async () => {
      const root = await cloneDeepRoot();
      await testCase.mutate(root);
      await expect(
        replayC6LiveMultiLangNeighborDeepEvidence({
          ...EXPECTED,
          deepCaptureRoot: root,
          planPath: PLAN_PATH,
        }),
        testCase.name,
      ).rejects.toThrow();
    }, 120_000);
  }

  realDeepEvidenceIt("rejects a forged non-retryable HTTP retry", async () => {
    const root = await cloneDeepRoot();
    const dynamicExpected = await insertFirstResponseRetry(root, {
      errorType: "FORBIDDEN",
      retryAfterMilliseconds: 123,
      status: 418,
    });
    await expect(
      replayC6LiveMultiLangNeighborDeepEvidence({
        ...EXPECTED,
        ...dynamicExpected,
        deepCaptureRoot: root,
        planPath: PLAN_PATH,
      }),
    ).rejects.toThrow(/non-retryable HTTP 418/u);
  }, 120_000);

  realDeepEvidenceIt("rejects a non-transient GraphQL retry", async () => {
    const root = await cloneDeepRoot();
    const dynamicExpected = await insertFirstResponseRetry(root, {
      errorType: "FORBIDDEN",
      retryAfterMilliseconds: 1_000,
      status: 200,
    });
    await expect(
      replayC6LiveMultiLangNeighborDeepEvidence({
        ...EXPECTED,
        ...dynamicExpected,
        deepCaptureRoot: root,
        planPath: PLAN_PATH,
      }),
    ).rejects.toThrow(/non-transient GraphQL retry/u);
  }, 120_000);

  realDeepEvidenceIt("accepts a policy-allowed transient GraphQL retry", async () => {
    const root = await cloneDeepRoot();
    const dynamicExpected = await insertFirstResponseRetry(root, {
      errorType: "INTERNAL",
      retryAfterMilliseconds: 1_000,
      status: 200,
    });
    const evidence =
      await replayC6LiveMultiLangNeighborDeepEvidence({
        ...EXPECTED,
        ...dynamicExpected,
        deepCaptureRoot: root,
        planPath: PLAN_PATH,
      });
    expect(evidence.networkRequestCount).toBe(694);
    expect(
      evidence.targets[0].rawResponseReferences.slice(0, 2)
        .map((response) => response.finalSuccessful),
    ).toEqual([false, true]);
  }, 120_000);

  realDeepEvidenceIt("rejects impossible fetch transport provenance", async () => {
    const root = await cloneDeepRoot();
    const dynamicExpected =
      await insertImpossibleFetchTransportRetry(root);
    await expect(
      replayC6LiveMultiLangNeighborDeepEvidence({
        ...EXPECTED,
        ...dynamicExpected,
        deepCaptureRoot: root,
        planPath: PLAN_PATH,
      }),
    ).rejects.toThrow(/impossible transport provenance/u);
  }, 120_000);

  realDeepEvidenceIt("retains a review actor with null submittedAt and ordinary body words", async () => {
    const root = await cloneDeepRoot();
    const dynamicExpected = await rewriteFirstResponse(
      root,
      (response) => {
        const review =
          response.data.repository.pullRequest.reviews.nodes[0];
        review.submittedAt = null;
        review.body =
          "This test outcome discusses a gold patch in ordinary prose.";
      },
    );

    const evidence =
      await replayC6LiveMultiLangNeighborDeepEvidence({
        ...EXPECTED,
        ...dynamicExpected,
        deepCaptureRoot: root,
        planPath: PLAN_PATH,
      });
    const target = evidence.targets[0];
    expect(target.reviews[0].submittedAt).toBeNull();
    expect(target.actorOccurrences).toContainEqual(
      expect.objectContaining({
        actorLogin: target.reviews[0].authorLogin,
        eventId: target.reviews[0].id,
        submittedAt: null,
        surface: "review",
      }),
    );
  }, 120_000);

  realDeepEvidenceIt("detects a terminal TOCTOU mutation", async () => {
    const root = await cloneDeepRoot();
    const captureDirectory = await firstCaptureDirectory(root);
    const responsePath = join(
      root,
      captureDirectory,
      "requests/0001__initial__page-001/attempt-01/response.json",
    );

    await expect(
      replayC6LiveMultiLangNeighborDeepEvidence({
        ...EXPECTED,
        deepCaptureRoot: root,
        planPath: PLAN_PATH,
        testHooks: {
          beforeTerminalVerification: async () => {
            await writeFile(responsePath, "{}\n", { mode: 0o600 });
          },
        },
      }),
    ).rejects.toThrow();
  }, 120_000);

  realDeepEvidenceIt("rejects a terminal ancestor-symlink swap", async () => {
    const root = await cloneDeepRoot();
    const parent = dirname(root);
    const movedParent = `${parent}-moved`;
    let swapped = false;
    try {
      await expect(
        replayC6LiveMultiLangNeighborDeepEvidence({
          ...EXPECTED,
          deepCaptureRoot: root,
          planPath: PLAN_PATH,
          testHooks: {
            beforeTerminalVerification: async () => {
              await rename(parent, movedParent);
              await symlink(movedParent, parent);
              swapped = true;
            },
          },
        }),
      ).rejects.toThrow(/symlink path component/u);
    } finally {
      if (swapped) {
        await unlink(parent);
        await rename(movedParent, parent);
      }
    }
  }, 120_000);
});

interface DynamicExpected {
  expectedAssetRootSha256: string;
  expectedCompletionSha256: string;
}

interface RetryDynamicExpected extends DynamicExpected {
  expectedDirectoryCount: number;
  expectedFileCount: number;
}

interface MutableArtifactReference {
  bytes: number;
  httpStatus?: number;
  path: string;
  sha256: string;
}

interface MutableAttempt {
  attempt: number;
  request: MutableArtifactReference;
  response?: MutableArtifactReference;
  responseHeaders: MutableArtifactReference;
  retryAfterMilliseconds?: number;
  transportError?: MutableArtifactReference & {
    phase: "body-read" | "fetch" | "timeout";
  };
}

interface MutableCapture {
  counts: {
    networkRequestCount: number;
  };
  requests: Array<{
    attempts: MutableAttempt[];
  }>;
}

interface MutableCompletion {
  captures: Array<{
    captureDirectory: string;
    captureManifest: MutableArtifactReference;
    networkRequestCount: number;
  }>;
  counts: {
    networkRequestCount: number;
  };
  independenceBoundary: {
    captureProjectionSha256: string;
  };
  plan: MutableArtifactReference & {
    deepCaptureTargetProjectionSha256: string;
    targetProjectionSha256: string;
  };
}

interface MutablePlan {
  independenceBoundary: {
    targetProjectionSha256: string;
  };
  inputs: {
    qualification: {
      artifactKind: string;
      deepPlanTargetProjectionSha256?: string;
      schemaVersion: number;
    };
  };
}

interface MutableInitialResponse {
  data: {
    repository: {
      id: string;
      pullRequest: {
        commits: {
          nodes: unknown[];
        };
        reviews: {
          nodes: Array<{
            author: {
              login: string;
            } | null;
            body: string;
            id: string;
            submittedAt: string | null;
          }>;
          pageInfo: {
            hasNextPage: boolean;
          };
        };
      };
    };
  };
  oracleMetadata?: {
    accepted: boolean;
  };
}

interface MutableRequestReceipt {
  attempt: number;
  variables: {
    [key: string]: unknown;
    number: number;
  };
}

async function cloneDeepRoot(): Promise<string> {
  const parent = await mkdtemp(
    "/private/tmp/goodmemory-c6-deep-evidence-",
  );
  temporaryRoots.push(parent);
  const root = join(parent, "capture");
  await cp(DEEP_ROOT, root, {
    preserveTimestamps: true,
    recursive: true,
  });
  await chmod(root, 0o700);
  return root;
}

async function buildPlanSchemaVersionVariant(
  schemaVersion: number,
): Promise<{
  expected: DynamicExpected & {
    expectedPlanSha256: string;
  };
  planPath: string;
  root: string;
}> {
  return buildPlanQualificationVariant({
    artifactKind:
      "c6-live-multilang-neighbor-census-qualification",
    schemaVersion,
  });
}

async function buildPlanQualificationVariant(input: {
  artifactKind: string;
  deepPlanTargetProjectionSha256?: string;
  schemaVersion: number;
}): Promise<{
  expected: DynamicExpected & {
    expectedPlanSha256: string;
  };
  planPath: string;
  root: string;
}> {
  const planParent = await mkdtemp(
    "/private/tmp/goodmemory-c6-deep-evidence-plan-",
  );
  temporaryRoots.push(planParent);
  const planPath = join(planParent, basename(PLAN_PATH));
  const plan = await readJson<MutablePlan>(PLAN_PATH);
  plan.inputs.qualification.artifactKind = input.artifactKind;
  plan.inputs.qualification.schemaVersion = input.schemaVersion;
  if (
    input.artifactKind ===
      "c6-live-multilang-neighbor-commit-count-eligibility-qualification"
  ) {
    plan.inputs.qualification.deepPlanTargetProjectionSha256 =
      input.deepPlanTargetProjectionSha256 ??
        plan.independenceBoundary.targetProjectionSha256;
  } else {
    delete plan.inputs.qualification
      .deepPlanTargetProjectionSha256;
  }
  const planBytes = canonicalBytes(plan);
  await writeFile(planPath, planBytes, { mode: 0o644 });

  const root = await cloneDeepRoot();
  const completionPath = join(root, "completion.json");
  const completion = await readJson<MutableCompletion>(
    completionPath,
  );
  Object.assign(
    completion.plan,
    artifactReference(basename(planPath), planBytes),
  );
  const completionBytes = canonicalBytes(completion);
  await writeFile(completionPath, completionBytes, {
    mode: 0o600,
  });
  const lock = await buildC6AssetLock(root);
  return {
    expected: {
      expectedAssetRootSha256: lock.assetRootSha256,
      expectedCompletionSha256: sha256(completionBytes),
      expectedPlanSha256: sha256(planBytes),
    },
    planPath,
    root,
  };
}

async function insertFirstResponseRetry(
  root: string,
  input: {
    errorType: string;
    retryAfterMilliseconds: number;
    status: number;
  },
): Promise<RetryDynamicExpected> {
  const completion = await readJson<MutableCompletion>(
    join(root, "completion.json"),
  );
  const captureDirectory = completion.captures[0].captureDirectory;
  const capturePath = join(root, captureDirectory, "capture.json");
  const capture = await readJson<MutableCapture>(capturePath);
  const firstAttempt = capture.requests[0].attempts[0];
  const firstResponse = requiredMutableResponse(firstAttempt);
  const firstRequestPath = join(
    root,
    captureDirectory,
    firstAttempt.request.path,
  );
  const firstResponsePath = join(
    root,
    captureDirectory,
    firstResponse.path,
  );
  const firstHeadersPath = join(
    root,
    captureDirectory,
    firstAttempt.responseHeaders.path,
  );
  const [
    originalRequest,
    originalResponseBytes,
    originalHeadersBytes,
  ] = await Promise.all([
    readJson<MutableRequestReceipt>(firstRequestPath),
    readFile(firstResponsePath),
    readFile(firstHeadersPath),
  ]);

  const secondRequestPath = firstAttempt.request.path.replace(
    "/attempt-01/",
    "/attempt-02/",
  );
  const secondResponsePath = firstResponse.path.replace(
    "/attempt-01/",
    "/attempt-02/",
  );
  const secondHeadersPath =
    firstAttempt.responseHeaders.path.replace(
      "/attempt-01/",
      "/attempt-02/",
    );
  const secondRequest = {
    ...originalRequest,
    attempt: 2,
  };
  const secondRequestBytes = canonicalBytes(secondRequest);
  await mkdir(
    dirname(join(root, captureDirectory, secondRequestPath)),
    { mode: 0o700 },
  );
  await Promise.all([
    writeFile(
      join(root, captureDirectory, secondRequestPath),
      secondRequestBytes,
      { mode: 0o600 },
    ),
    writeFile(
      join(root, captureDirectory, secondResponsePath),
      originalResponseBytes,
      { mode: 0o600 },
    ),
    writeFile(
      join(root, captureDirectory, secondHeadersPath),
      originalHeadersBytes,
      { mode: 0o600 },
    ),
  ]);

  const retryResponseBytes = canonicalBytes({
    errors: [{
      message: "synthetic retry mutation",
      type: input.errorType,
    }],
  });
  await writeFile(firstResponsePath, retryResponseBytes, {
    mode: 0o600,
  });
  Object.assign(
    firstResponse,
    artifactReference(
      firstResponse.path,
      retryResponseBytes,
    ),
    { httpStatus: input.status },
  );
  firstAttempt.retryAfterMilliseconds =
    input.retryAfterMilliseconds;
  capture.requests[0].attempts.push({
    attempt: 2,
    request: artifactReference(
      secondRequestPath,
      secondRequestBytes,
    ),
    response: {
      ...artifactReference(
        secondResponsePath,
        originalResponseBytes,
      ),
      httpStatus: 200,
    },
    responseHeaders: artifactReference(
      secondHeadersPath,
      originalHeadersBytes,
    ),
  });
  capture.counts.networkRequestCount += 1;
  completion.captures[0].networkRequestCount += 1;
  completion.counts.networkRequestCount += 1;
  const expected = await rewriteCaptureAndCompletion({
    capture,
    captureDirectory,
    capturePath,
    completion,
    root,
  });
  return {
    ...expected,
    expectedDirectoryCount:
      EXPECTED.expectedDirectoryCount + 1,
    expectedFileCount: EXPECTED.expectedFileCount + 3,
  };
}

async function insertImpossibleFetchTransportRetry(
  root: string,
): Promise<RetryDynamicExpected> {
  const counts = await insertFirstResponseRetry(root, {
    errorType: "INTERNAL",
    retryAfterMilliseconds: 1_000,
    status: 200,
  });
  const completion = await readJson<MutableCompletion>(
    join(root, "completion.json"),
  );
  const captureDirectory = completion.captures[0].captureDirectory;
  const capturePath = join(root, captureDirectory, "capture.json");
  const capture = await readJson<MutableCapture>(capturePath);
  const firstAttempt = capture.requests[0].attempts[0];
  const firstResponse = requiredMutableResponse(firstAttempt);
  const responsePath = join(
    root,
    captureDirectory,
    firstResponse.path,
  );
  const transportPath = firstResponse.path.replace(
    "/response.json",
    "/transport-error.json",
  );
  const transportBytes = canonicalBytes({
    artifactKind:
      "c6-live-multilang-neighbor-deep-transport-error",
    httpStatus: 200,
    message: "synthetic impossible fetch transport",
    phase: "fetch",
    retryScheduled: true,
    schemaVersion: 1,
  });
  await unlink(responsePath);
  await writeFile(
    join(root, captureDirectory, transportPath),
    transportBytes,
    { mode: 0o600 },
  );
  delete firstAttempt.response;
  firstAttempt.transportError = {
    ...artifactReference(transportPath, transportBytes),
    phase: "fetch",
  };
  const expected = await rewriteCaptureAndCompletion({
    capture,
    captureDirectory,
    capturePath,
    completion,
    root,
  });
  return {
    ...counts,
    ...expected,
  };
}

async function rewriteFirstResponse(
  root: string,
  mutate: (response: MutableInitialResponse) => void,
): Promise<DynamicExpected> {
  const completion = await readJson<MutableCompletion>(
    join(root, "completion.json"),
  );
  const captureDirectory = completion.captures[0].captureDirectory;
  const capturePath = join(root, captureDirectory, "capture.json");
  const capture = await readJson<MutableCapture>(capturePath);
  const responseReference = requiredMutableResponse(
    capture.requests[0].attempts[0],
  );
  const responsePath = join(
    root,
    captureDirectory,
    responseReference.path,
  );
  const response = await readJson<MutableInitialResponse>(
    responsePath,
  );
  mutate(response);
  const responseBytes = canonicalBytes(response);
  await writeFile(responsePath, responseBytes, { mode: 0o600 });
  Object.assign(
    responseReference,
    artifactReference(responseReference.path, responseBytes),
    { httpStatus: 200 },
  );
  return rewriteCaptureAndCompletion({
    capture,
    captureDirectory,
    capturePath,
    completion,
    root,
  });
}

async function rewriteFirstRequest(
  root: string,
  mutate: (request: MutableRequestReceipt) => void,
): Promise<DynamicExpected> {
  const completion = await readJson<MutableCompletion>(
    join(root, "completion.json"),
  );
  const captureDirectory = completion.captures[0].captureDirectory;
  const capturePath = join(root, captureDirectory, "capture.json");
  const capture = await readJson<MutableCapture>(capturePath);
  const requestReference = capture.requests[0].attempts[0].request;
  const requestPath = join(
    root,
    captureDirectory,
    requestReference.path,
  );
  const request = await readJson<MutableRequestReceipt>(
    requestPath,
  );
  mutate(request);
  const requestBytes = canonicalBytes(request);
  await writeFile(requestPath, requestBytes, { mode: 0o600 });
  Object.assign(
    requestReference,
    artifactReference(requestReference.path, requestBytes),
  );
  return rewriteCaptureAndCompletion({
    capture,
    captureDirectory,
    capturePath,
    completion,
    root,
  });
}

async function rewriteFirstCapture(
  root: string,
  mutate: (capture: MutableCapture) => void,
): Promise<DynamicExpected> {
  const completion = await readJson<MutableCompletion>(
    join(root, "completion.json"),
  );
  const captureDirectory = completion.captures[0].captureDirectory;
  const capturePath = join(root, captureDirectory, "capture.json");
  const capture = await readJson<MutableCapture>(capturePath);
  mutate(capture);
  return rewriteCaptureAndCompletion({
    capture,
    captureDirectory,
    capturePath,
    completion,
    root,
  });
}

async function rewriteCaptureAndCompletion(input: {
  capture: MutableCapture;
  captureDirectory: string;
  capturePath: string;
  completion: MutableCompletion;
  root: string;
}): Promise<DynamicExpected> {
  const captureBytes = canonicalBytes(input.capture);
  await writeFile(input.capturePath, captureBytes, { mode: 0o600 });
  Object.assign(
    input.completion.captures[0].captureManifest,
    artifactReference(
      `${input.captureDirectory}/capture.json`,
      captureBytes,
    ),
  );
  input.completion.independenceBoundary
    .captureProjectionSha256 = sha256(
      JSON.stringify(input.completion.captures),
    );
  const completionBytes = canonicalBytes(input.completion);
  await writeFile(
    join(input.root, "completion.json"),
    completionBytes,
    { mode: 0o600 },
  );
  const lock = await buildC6AssetLock(input.root);
  return {
    expectedAssetRootSha256: lock.assetRootSha256,
    expectedCompletionSha256: sha256(completionBytes),
  };
}

async function firstCaptureDirectory(root: string): Promise<string> {
  return (
    await readJson<MutableCompletion>(
      join(root, "completion.json"),
    )
  ).captures[0].captureDirectory;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function setSpecialMode(
  mode: string,
  path: string,
): Promise<void> {
  const child = Bun.spawn(["chmod", mode, path], {
    stderr: "pipe",
    stdout: "pipe",
  });
  if (await child.exited !== 0) {
    throw new Error("test chmod failed");
  }
}

function requiredMutableResponse(
  attempt: MutableAttempt,
): MutableArtifactReference {
  if (attempt.response === undefined) {
    throw new Error("test fixture attempt lacks response");
  }
  return attempt.response;
}

function normalizedEvidenceCounts(
  evidence: C6LiveMultiLangNeighborDeepEvidence,
) {
  return {
    actorOccurrences: evidence.actorOccurrences.length,
    commits: evidence.targets.reduce(
      (count, target) => count + target.commits.length,
      0,
    ),
    parentEdges: evidence.targets.reduce(
      (count, target) =>
        count +
        target.commits.reduce(
          (targetCount, commit) =>
            targetCount + commit.parentOids.length,
          0,
        ),
      0,
    ),
    pullAuthors: evidence.actorOccurrences.filter(
      (actor) => actor.surface === "pull-author",
    ).length,
    rawResponseReferences: evidence.targets.reduce(
      (count, target) =>
        count + target.rawResponseReferences.length,
      0,
    ),
    reviewActors: evidence.actorOccurrences.filter(
      (actor) => actor.surface === "review",
    ).length,
    reviewCommentActors: evidence.actorOccurrences.filter(
      (actor) => actor.surface === "review-thread-comment",
    ).length,
    reviewComments: evidence.targets.reduce(
      (count, target) =>
        count +
        target.reviewThreads.reduce(
          (targetCount, thread) =>
            targetCount + thread.comments.length,
          0,
        ),
      0,
    ),
    reviews: evidence.targets.reduce(
      (count, target) => count + target.reviews.length,
      0,
    ),
    reviewThreads: evidence.targets.reduce(
      (count, target) =>
        count + target.reviewThreads.length,
      0,
    ),
  };
}

function artifactReference(path: string, bytes: Buffer) {
  return {
    bytes: bytes.byteLength,
    path,
    sha256: sha256(bytes),
  };
}

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
