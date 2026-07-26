import { createHash } from "node:crypto";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from "bun:test";

import {
  buildC6AssetLock,
  serializeC6AssetLock,
} from "../../scripts/codex-coding-effect/c6-asset-lock";
import {
  buildC6LiveMultiLangNeighborCommitCountEligibilityQualification,
  materializeC6LiveMultiLangNeighborCommitCountEligibilityQualification,
  parseC6LiveMultiLangNeighborCommitCountEligibilityQualification,
  serializeC6LiveMultiLangNeighborCommitCountEligibilityQualification,
} from "../../scripts/codex-coding-effect/c6-live-multilang-neighbor-commit-count-eligibility-qualification";
import {
  C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_COUNT_ELIGIBILITY_QUERY,
  deriveC6LiveMultiLangNeighborCommitCountEligibilityPlan,
  serializeC6LiveMultiLangNeighborCommitCountEligibilityPlan,
} from "../../scripts/codex-coding-effect/c6-live-multilang-neighbor-commit-count-eligibility-plan";

const DEEP_PLAN_PATH = resolve(
  "fixtures/codex-coding-effect/c6-source-pool/" +
    "swe-bench-live-multilang-608f7ae9." +
    "neighbor-deep-capture-plan-v2.json",
);
const CENSUS_QUALIFICATION_PATH = resolve(
  "fixtures/codex-coding-effect/c6-source-pool/" +
    "swe-bench-live-multilang-608f7ae9." +
    "neighbor-census-qualification-v3.json",
);
const temporaryRoots: string[] = [];
const perTestRoots: string[] = [];

interface BaseFixture {
  captureRoot: string;
  censusQualificationBytes: Buffer;
  deepPlan: {
    targets: Array<{
      canonicalAnchorId: string;
      captureDirectory: string;
      captureOrder: number;
      [key: string]: unknown;
    }>;
  };
  deepPlanBytes: Buffer;
  eligibilityPlanBytes: Buffer;
  eligibilityPlanPath: string;
  expected: {
    expectedCaptureAssetLockSha256: string;
    expectedCaptureAssetRootSha256: string;
    expectedCaptureCompletionSha256: string;
    expectedCensusQualificationSha256: string;
    expectedDeepCapturePlanSha256: string;
    expectedEligibilityPlanSha256: string;
  };
  root: string;
}

let fixture: BaseFixture;

beforeAll(async () => {
  fixture = await createBaseFixture();
}, 120_000);

afterAll(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true })
    ),
  );
}, 120_000);

afterEach(async () => {
  await Promise.all(
    perTestRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true })
    ),
  );
}, 120_000);

describe("C6 commit-count canonical eligibility qualification", () => {
  it("strictly replays all 643 targets and emits the stable 642/1 split", async () => {
    const result =
      await buildC6LiveMultiLangNeighborCommitCountEligibilityQualification(
        buildOptions(fixture.captureRoot),
      );
    const qualification = result.qualification;

    expect(qualification.artifactKind).toBe(
      "c6-live-multilang-neighbor-commit-count-eligibility-qualification",
    );
    expect(qualification.schemaVersion).toBe(1);
    expect(qualification.counts).toMatchObject({
      deepCaptureTargetCount: 642,
      eligibleTargetCount: 642,
      excludedTargetCount: 1,
      rawFinalSuccessResponseCount: 643,
      replacementCount: 0,
      resampledTargetCount: 0,
      resultCount: 643,
      sourceTargetCount: 643,
    });
    expect(qualification.boundary).toEqual({
      acceptedEpisodeCount: 0,
      actorCaptureExecuted: false,
      actorQualifiedEpisodeCount: 0,
      candidateManifestFrozen: false,
      codexRunReady: false,
      deepCaptureExecuted: false,
      machineQualifiedEpisodeCount: 0,
      semanticallyQualifiedEpisodeCount: 0,
      status:
        "commit-count-platform-eligibility-qualified-deep-plan-required",
    });
    expect(qualification.registrationBoundary).toEqual({
      exploratoryAllTargetCountDiagnosticObserved: true,
      frozenBeforeCanonicalCapture: true,
      initialPlanV2TransportFailureObserved: true,
      preregisteredBeforeExploratoryDiagnostic: false,
    });
    expect(qualification.independenceBoundary.diagnosticInput)
      .toBe(false);
    expect(qualification.results).toHaveLength(643);
    expect(
      qualification.results.map(
        (result) => result.sourceTarget.canonicalAnchorId,
      ),
    ).toEqual(
      fixture.deepPlan.targets.map(
        (target) => target.canonicalAnchorId,
      ),
    );
    const eligible = qualification.results.filter(
      (result) =>
        result.decision === "eligible-for-deep-capture",
    );
    expect(
      eligible.map((result) => result.deepCaptureOrder),
    ).toEqual(
      Array.from({ length: 642 }, (_, index) => index + 1),
    );
    expect(
      qualification.results.filter(
        (result) =>
          result.decision === "excluded-platform-commit-cap",
      ),
    ).toHaveLength(1);

    const serialized =
      serializeC6LiveMultiLangNeighborCommitCountEligibilityQualification(
        qualification,
      );
    expect(
      parseC6LiveMultiLangNeighborCommitCountEligibilityQualification(
        serialized,
      ),
    ).toEqual(qualification);
    expect(sha256(serialized)).toBe(result.outputSha256);
  }, 120_000);

  it("rejects rebound raw identity and completion/raw decision lies", async () => {
    const identityRoot = await cloneCaptureRoot();
    const identity = await mutateFirstRawResponse(
      identityRoot,
      (response) => {
        response.data.repository.nameWithOwner =
          "wrong/repository";
      },
    );
    await expect(
      buildC6LiveMultiLangNeighborCommitCountEligibilityQualification(
        buildOptions(identityRoot, identity),
      ),
    ).rejects.toThrow("raw response identity mismatch");

    const lieRoot = await cloneCaptureRoot();
    const completion = await readJson<MutableCompletion>(
      join(lieRoot, "completion.json"),
    );
    completion.captures[0]!.commitCount += 1;
    refreshCompletionProjection(completion);
    await writeFile(
      join(lieRoot, "completion.json"),
      canonicalBytes(completion),
      { mode: 0o600 },
    );
    const lie = await refreshCaptureExpected(lieRoot);
    await expect(
      buildC6LiveMultiLangNeighborCommitCountEligibilityQualification(
        buildOptions(lieRoot, lie),
      ),
    ).rejects.toThrow("raw/capture decision mismatch");
  }, 120_000);

  it("rejects commit counts swapped across canonical identities", async () => {
    const root = await cloneCaptureRoot();
    const expected = await swapEligibleAndExcludedRawCounts(root);

    await expect(
      buildC6LiveMultiLangNeighborCommitCountEligibilityQualification(
        buildOptions(root, expected),
      ),
    ).rejects.toThrow("raw/capture decision mismatch");
  }, 120_000);

  it("rejects retry status, GraphQL type, delay, Retry-After, and success-header lies", async () => {
    const cases: Array<{
      expectedError: string;
      mutate: RetryAttemptMutation;
      name: string;
    }> = [
      {
        expectedError: "non-retryable HTTP status",
        mutate: {
          delayMilliseconds: 1_000,
          responseHeaders: {},
          responseStatus: 400,
        },
        name: "HTTP status lie",
      },
      {
        expectedError: "non-transient GraphQL retry",
        mutate: {
          delayMilliseconds: 1_000,
          graphqlErrorType: "BAD_USER_INPUT",
          responseStatus: 200,
        },
        name: "GraphQL type lie",
      },
      {
        expectedError: "retry delay mismatch",
        mutate: {
          delayMilliseconds: 999,
          responseHeaders: {},
          responseStatus: 503,
        },
        name: "exponential delay lie",
      },
      {
        expectedError: "retry delay mismatch",
        mutate: {
          delayMilliseconds: 1_000,
          responseHeaders: {
            "retry-after": "2",
          },
          responseStatus: 503,
        },
        name: "Retry-After delay lie",
      },
      {
        expectedError: "missing success header date",
        mutate: {
          delayMilliseconds: 1_000,
          finalHeaderMutation: (headers) => {
            delete headers.date;
          },
          responseHeaders: {},
          responseStatus: 503,
        },
        name: "missing final success header",
      },
      {
        expectedError: "invalid success headers",
        mutate: {
          delayMilliseconds: 1_000,
          finalHeaderMutation: (headers) => {
            headers["x-ratelimit-used"] = "not-a-number";
          },
          responseHeaders: {},
          responseStatus: 503,
        },
        name: "drifted final success header",
      },
    ];

    for (const testCase of cases) {
      const root = await cloneCaptureRoot();
      const expected = await injectFirstResponseRetry(
        root,
        testCase.mutate,
      );
      await expect(
        buildC6LiveMultiLangNeighborCommitCountEligibilityQualification(
          buildOptions(root, expected),
        ),
        testCase.name,
      ).rejects.toThrow(testCase.expectedError);
    }
  }, 120_000);

  it("accepts only producer-exact bounded HTTP and transient GraphQL retries", async () => {
    const httpRoot = await cloneCaptureRoot();
    const httpExpected = await injectFirstResponseRetry(httpRoot, {
      delayMilliseconds: 60_000,
      responseHeaders: {
        "retry-after": "120",
      },
      responseStatus: 503,
    });
    const http =
      await buildC6LiveMultiLangNeighborCommitCountEligibilityQualification(
        buildOptions(httpRoot, httpExpected),
      );
    expect(http.qualification.counts.networkRequestCount).toBe(644);

    const graphqlRoot = await cloneCaptureRoot();
    const graphqlExpected = await injectFirstResponseRetry(
      graphqlRoot,
      {
        delayMilliseconds: 0,
        graphqlErrorType: "TIMEOUT",
        responseHeaders: {
          "retry-after": "0",
        },
        responseStatus: 200,
      },
    );
    const graphql =
      await buildC6LiveMultiLangNeighborCommitCountEligibilityQualification(
        buildOptions(graphqlRoot, graphqlExpected),
      );
    expect(graphql.qualification.counts.networkRequestCount)
      .toBe(644);
  }, 120_000);

  it("rejects a fifth network attempt", async () => {
    const root = await cloneCaptureRoot();
    const expected = await injectFifthNetworkAttempt(root);

    await expect(
      buildC6LiveMultiLangNeighborCommitCountEligibilityQualification(
        buildOptions(root, expected),
      ),
    ).rejects.toThrow("retry attempt limit exceeded");
  }, 120_000);

  it("rejects forged transport exponential backoff", async () => {
    const root = await cloneCaptureRoot();
    const expected = await injectFirstTransportRetry(root, {
      delayMilliseconds: 999,
      httpStatus: null,
      phase: "fetch",
      responseHeaders: {},
    });

    await expect(
      buildC6LiveMultiLangNeighborCommitCountEligibilityQualification(
        buildOptions(root, expected),
      ),
    ).rejects.toThrow("transport attempt mismatch");
  }, 120_000);

  it("accepts producer-valid fetch, body-read, and timeout provenance", async () => {
    const cases: Array<{
      mutation: TransportAttemptMutation;
      name: string;
    }> = [
      {
        mutation: {
          delayMilliseconds: 1_000,
          httpStatus: null,
          phase: "fetch",
          responseHeaders: {},
        },
        name: "fetch before response",
      },
      {
        mutation: {
          delayMilliseconds: 1_000,
          httpStatus: 502,
          phase: "body-read",
          responseHeaders: {
            "x-github-request-id": "TEST:BODY-READ",
          },
        },
        name: "body-read after response",
      },
      {
        mutation: {
          delayMilliseconds: 1_000,
          httpStatus: null,
          phase: "timeout",
          responseHeaders: {},
        },
        name: "timeout before response",
      },
      {
        mutation: {
          delayMilliseconds: 1_000,
          httpStatus: 200,
          phase: "timeout",
          responseHeaders: {
            "x-github-request-id": "TEST:TIMEOUT",
          },
        },
        name: "timeout after response",
      },
    ];

    for (const testCase of cases) {
      const root = await cloneCaptureRoot();
      const expected = await injectFirstTransportRetry(
        root,
        testCase.mutation,
      );
      const replay =
        await buildC6LiveMultiLangNeighborCommitCountEligibilityQualification(
          buildOptions(root, expected),
        );

      expect(
        replay.qualification.counts.networkRequestCount,
        testCase.name,
      ).toBe(644);
    }
  }, 120_000);

  it("rejects impossible transport phase and HTTP provenance", async () => {
    const root = await cloneCaptureRoot();
    const expected =
      await injectImpossibleFirstTransportRetry(root);

    await expect(
      buildC6LiveMultiLangNeighborCommitCountEligibilityQualification(
        buildOptions(root, expected),
      ),
    ).rejects.toThrow("transport provenance mismatch");
  }, 120_000);

  for (const mutation of [
    {
      apply: (completion: MutableCompletion) => {
        completion.captures.pop();
      },
      name: "omitted completion target",
    },
    {
      apply: (completion: MutableCompletion) => {
        completion.captures[1] =
          structuredClone(completion.captures[0]!);
      },
      name: "duplicate completion target",
    },
    {
      apply: (completion: MutableCompletion) => {
        [
          completion.captures[0],
          completion.captures[1],
        ] = [
          completion.captures[1]!,
          completion.captures[0]!,
        ];
      },
      name: "reordered completion targets",
    },
  ]) {
    it(`rejects ${mutation.name}`, async () => {
      const root = await cloneCaptureRoot();
      const completion = await readJson<MutableCompletion>(
        join(root, "completion.json"),
      );
      mutation.apply(completion);
      refreshCompletionProjection(completion);
      await writeFile(
        join(root, "completion.json"),
        canonicalBytes(completion),
        { mode: 0o600 },
      );
      const expected = await refreshCaptureExpected(root);
      await expect(
        buildC6LiveMultiLangNeighborCommitCountEligibilityQualification(
          buildOptions(root, expected),
        ),
      ).rejects.toThrow();
    }, 120_000);
  }

  for (const mutation of [
    {
      apply: async (root: string) => {
        await writeFile(join(root, "extra.json"), "{}\n", {
          mode: 0o600,
        });
      },
      name: "extra capture asset",
    },
    {
      apply: async (root: string) => {
        await symlink(
          join(root, "completion.json"),
          join(root, "completion-link.json"),
        );
      },
      name: "capture symlink",
    },
    {
      apply: async (root: string) => {
        await chmod(join(root, "completion.json"), 0o644);
      },
      name: "capture mode drift",
    },
  ]) {
    it(`rejects ${mutation.name}`, async () => {
      const root = await cloneCaptureRoot();
      await mutation.apply(root);
      await expect(
        buildC6LiveMultiLangNeighborCommitCountEligibilityQualification(
          buildOptions(root),
        ),
      ).rejects.toThrow();
    }, 120_000);
  }

  it("terminally rejects input drift", async () => {
    const root = await temporaryRoot(
      "goodmemory-c6-commit-count-input-drift-",
    );
    const eligibilityPlanPath = join(
      root,
      basename(fixture.eligibilityPlanPath),
    );
    await writeFile(
      eligibilityPlanPath,
      fixture.eligibilityPlanBytes,
      { mode: 0o644 },
    );
    await expect(
      buildC6LiveMultiLangNeighborCommitCountEligibilityQualification({
        ...buildOptions(fixture.captureRoot),
        eligibilityPlanPath,
        testHooks: {
          beforeTerminalVerification: async () => {
            await writeFile(eligibilityPlanPath, "{}\n");
          },
        },
      }),
    ).rejects.toThrow("input changed");
  }, 120_000);

  it("preserves a foreign replacement published during qualification replay", async () => {
    const root = await temporaryRoot(
      "goodmemory-c6-commit-count-foreign-output-",
    );
    const outputPath = join(root, "qualification.json");

    await expect(
      materializeC6LiveMultiLangNeighborCommitCountEligibilityQualification({
        ...buildOptions(fixture.captureRoot),
        outputPath,
        testHooks: {
          afterOutputPublication: async () => {
            await rm(outputPath);
            await writeFile(outputPath, "foreign\n");
          },
        },
      }),
    ).rejects.toThrow("output identity mismatch");
    expect(await readFile(outputPath, "utf8")).toBe("foreign\n");
    expect(
      (await readdir(root)).some((name) =>
        name.includes(".incomplete-")
      ),
    ).toBe(false);
  }, 120_000);

  it("rolls back an owned output whose mode changes after publication", async () => {
    const root = await temporaryRoot(
      "goodmemory-c6-commit-count-mode-output-",
    );
    const outputPath = join(root, "qualification.json");

    await expect(
      materializeC6LiveMultiLangNeighborCommitCountEligibilityQualification({
        ...buildOptions(fixture.captureRoot),
        outputPath,
        testHooks: {
          afterOutputPublication: async () => {
            await chmod(outputPath, 0o600);
          },
        },
      }),
    ).rejects.toThrow("output identity mismatch");
    await expect(lstat(outputPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await readdir(root)).toEqual([]);
  }, 120_000);

  it("rolls back its owned output when post-publication replay fails", async () => {
    const root = await temporaryRoot(
      "goodmemory-c6-commit-count-replay-output-",
    );
    const eligibilityPlanPath = join(
      root,
      basename(fixture.eligibilityPlanPath),
    );
    const outputPath = join(root, "qualification.json");
    await writeFile(
      eligibilityPlanPath,
      fixture.eligibilityPlanBytes,
      { mode: 0o644 },
    );

    await expect(
      materializeC6LiveMultiLangNeighborCommitCountEligibilityQualification({
        ...buildOptions(fixture.captureRoot),
        eligibilityPlanPath,
        outputPath,
        testHooks: {
          afterOutputPublication: async () => {
            await writeFile(eligibilityPlanPath, "{}\n");
          },
        },
      }),
    ).rejects.toThrow();
    await expect(lstat(outputPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(
      (await readdir(root)).some((name) =>
        name.includes(".incomplete-")
      ),
    ).toBe(false);
  }, 120_000);
});

function buildOptions(
  captureRoot: string,
  override: Partial<BaseFixture["expected"]> = {},
) {
  return {
    captureRoot,
    censusQualificationPath: CENSUS_QUALIFICATION_PATH,
    deepCapturePlanPath: DEEP_PLAN_PATH,
    eligibilityPlanPath: fixture.eligibilityPlanPath,
    ...fixture.expected,
    ...override,
  };
}

async function createBaseFixture(): Promise<BaseFixture> {
  const root = await persistentRoot(
    "goodmemory-c6-commit-count-qualification-",
  );
  const deepPlanBytes = await readFile(DEEP_PLAN_PATH);
  const censusQualificationBytes = await readFile(
    CENSUS_QUALIFICATION_PATH,
  );
  const deepPlan = JSON.parse(
    deepPlanBytes.toString("utf8"),
  ) as BaseFixture["deepPlan"];
  const eligibilityPlan =
    deriveC6LiveMultiLangNeighborCommitCountEligibilityPlan({
      sourcePlanBytes: deepPlanBytes,
      sourcePlanPath: DEEP_PLAN_PATH,
    });
  const eligibilityPlanBytes = Buffer.from(
    serializeC6LiveMultiLangNeighborCommitCountEligibilityPlan(
      eligibilityPlan,
    ),
  );
  const eligibilityPlanPath = join(
    root,
    "neighbor-commit-count-eligibility-plan-v1.json",
  );
  await writeFile(eligibilityPlanPath, eligibilityPlanBytes, {
    mode: 0o644,
  });
  const excludedAnchorId =
    deepPlan.targets[Math.floor(deepPlan.targets.length / 2)]!
      .canonicalAnchorId;
  const captureRoot = join(root, "canonical-capture");
  const capture = await createCanonicalCapture({
    captureRoot,
    eligibilityPlan,
    eligibilityPlanBytes,
    eligibilityPlanPath,
    excludedAnchorId,
  });
  const assetLockBytes = await readFile(
    join(captureRoot, "asset-lock.json"),
  );
  return {
    captureRoot,
    censusQualificationBytes,
    deepPlan,
    deepPlanBytes,
    eligibilityPlanBytes,
    eligibilityPlanPath,
    expected: {
      expectedCaptureAssetLockSha256: sha256(assetLockBytes),
      expectedCaptureAssetRootSha256: capture.assetRootSha256,
      expectedCaptureCompletionSha256: capture.completionSha256,
      expectedCensusQualificationSha256: sha256(
        censusQualificationBytes,
      ),
      expectedDeepCapturePlanSha256: sha256(deepPlanBytes),
      expectedEligibilityPlanSha256: sha256(
        eligibilityPlanBytes,
      ),
    },
    root,
  };
}

async function cloneCaptureRoot(): Promise<string> {
  const root = await temporaryRoot(
    "goodmemory-c6-commit-count-capture-clone-",
  );
  const captureRoot = join(root, "capture");
  const clone = Bun.spawn([
    "cp",
    "-cR",
    fixture.captureRoot,
    captureRoot,
  ]);
  if (await clone.exited !== 0) {
    await cp(fixture.captureRoot, captureRoot, {
      preserveTimestamps: true,
      recursive: true,
    });
  }
  await chmod(captureRoot, 0o700);
  return captureRoot;
}

async function mutateFirstRawResponse(
  root: string,
  mutate: (response: MutableResponse) => void,
): Promise<Partial<BaseFixture["expected"]>> {
  const completionPath = join(root, "completion.json");
  const completion = await readJson<MutableCompletion>(
    completionPath,
  );
  const completionCapture = completion.captures[0]!;
  const capturePath = join(
    root,
    completionCapture.captureManifest.path,
  );
  const capture = await readJson<MutableTargetCapture>(
    capturePath,
  );
  const finalAttempt = capture.attempts.at(-1)!;
  const finalResponse = finalAttempt.response!;
  const responsePath = join(root, finalResponse.path);
  const raw = await readJson<MutableResponse>(responsePath);
  mutate(raw);
  const responseBytes = Buffer.from(JSON.stringify(raw));
  await writeFile(responsePath, responseBytes, { mode: 0o600 });
  Object.assign(
    finalResponse,
    artifactReference(finalResponse.path, responseBytes),
  );
  const captureBytes = canonicalBytes(capture);
  await writeFile(capturePath, captureBytes, { mode: 0o600 });
  Object.assign(
    completionCapture.captureManifest,
    artifactReference(
      completionCapture.captureManifest.path,
      captureBytes,
    ),
  );
  await writeFile(
    completionPath,
    canonicalBytes(completion),
    { mode: 0o600 },
  );
  return refreshCaptureExpected(root);
}

async function swapEligibleAndExcludedRawCounts(
  root: string,
): Promise<Partial<BaseFixture["expected"]>> {
  const completionPath = join(root, "completion.json");
  const completion = await readJson<MutableCompletion>(
    completionPath,
  );
  const completionCaptures = [
    completion.captures.find((capture) =>
      capture.commitCount <= 250
    )!,
    completion.captures.find((capture) =>
      capture.commitCount > 250
    )!,
  ];
  const captures = await Promise.all(
    completionCaptures.map((completionCapture) =>
      readJson<MutableTargetCapture>(
        join(root, completionCapture.captureManifest.path),
      )
    ),
  );
  const responses = await Promise.all(
    captures.map((capture) => {
      const response = capture.attempts.at(-1)!.response!;
      return readJson<MutableResponse>(join(root, response.path));
    }),
  );
  const leftCount =
    responses[0]!.data.repository.pullRequest.commits.totalCount;
  responses[0]!.data.repository.pullRequest.commits.totalCount =
    responses[1]!.data.repository.pullRequest.commits.totalCount;
  responses[1]!.data.repository.pullRequest.commits.totalCount =
    leftCount;

  for (const [index, response] of responses.entries()) {
    const capture = captures[index]!;
    const completionCapture = completionCaptures[index]!;
    const finalResponse = capture.attempts.at(-1)!.response!;
    const responseBytes = Buffer.from(JSON.stringify(response));
    await writeFile(join(root, finalResponse.path), responseBytes, {
      mode: 0o600,
    });
    Object.assign(
      finalResponse,
      artifactReference(finalResponse.path, responseBytes),
    );
    const captureBytes = canonicalBytes(capture);
    await writeFile(
      join(root, completionCapture.captureManifest.path),
      captureBytes,
      { mode: 0o600 },
    );
    Object.assign(
      completionCapture.captureManifest,
      artifactReference(
        completionCapture.captureManifest.path,
        captureBytes,
      ),
    );
  }
  await writeFile(completionPath, canonicalBytes(completion), {
    mode: 0o600,
  });
  return refreshCaptureExpected(root);
}

interface RetryAttemptMutation {
  delayMilliseconds: number;
  finalHeaderMutation?: (
    headers: Record<string, string>,
  ) => void;
  graphqlErrorType?: string;
  responseHeaders?: Record<string, string>;
  responseStatus: number;
}

interface TransportAttemptMutation {
  delayMilliseconds: number;
  httpStatus: number | null;
  phase: "body-read" | "fetch" | "timeout";
  responseHeaders: Record<string, string>;
}

async function injectFirstResponseRetry(
  root: string,
  input: RetryAttemptMutation,
): Promise<Partial<BaseFixture["expected"]>> {
  const completionPath = join(root, "completion.json");
  const completion = await readJson<MutableCompletion>(
    completionPath,
  );
  const completionCapture = completion.captures[0]!;
  const capturePath = join(
    root,
    completionCapture.captureManifest.path,
  );
  const capture = await readJson<MutableTargetCapture>(
    capturePath,
  );
  const originalAttempt = capture.attempts[0]!;
  const originalResponse = originalAttempt.response!;
  const [
    request,
    finalResponseBytes,
    finalHeaders,
  ] = await Promise.all([
    readJson<{ attempt: number }>(
      join(root, originalAttempt.request.path),
    ),
    readFile(join(root, originalResponse.path)),
    readJson<Record<string, string>>(
      join(root, originalAttempt.responseHeaders.path),
    ),
  ]);
  input.finalHeaderMutation?.(finalHeaders);

  const attemptTwoDirectory =
    `${completionCapture.captureDirectory}/attempts/attempt-02`;
  await mkdir(join(root, attemptTwoDirectory), {
    mode: 0o700,
  });
  const finalRequestBytes = canonicalBytes({
    ...request,
    attempt: 2,
  });
  const finalHeaderBytes = canonicalBytes(finalHeaders);
  const finalPaths = {
    request: `${attemptTwoDirectory}/request.json`,
    response: `${attemptTwoDirectory}/response.json`,
    responseHeaders:
      `${attemptTwoDirectory}/response-headers.json`,
  };
  await Promise.all([
    writeFile(
      join(root, finalPaths.request),
      finalRequestBytes,
      { mode: 0o600 },
    ),
    writeFile(
      join(root, finalPaths.response),
      finalResponseBytes,
      { mode: 0o600 },
    ),
    writeFile(
      join(root, finalPaths.responseHeaders),
      finalHeaderBytes,
      { mode: 0o600 },
    ),
  ]);

  const retryHeaders = input.responseStatus === 200
    ? {
      ...finalHeaders,
      ...input.responseHeaders,
    }
    : { ...input.responseHeaders };
  const retryHeaderBytes = canonicalBytes(retryHeaders);
  const retryResponseBytes = canonicalBytes(
    input.responseStatus === 200
      ? {
        errors: [{
          extensions: {
            code: input.graphqlErrorType ?? "TIMEOUT",
          },
          message: "retry",
        }],
      }
      : { message: "retry" },
  );
  await Promise.all([
    writeFile(
      join(root, originalAttempt.responseHeaders.path),
      retryHeaderBytes,
      { mode: 0o600 },
    ),
    writeFile(
      join(root, originalResponse.path),
      retryResponseBytes,
      { mode: 0o600 },
    ),
  ]);
  capture.attempts = [{
    attempt: 1,
    request: originalAttempt.request,
    response: {
      ...artifactReference(
        originalResponse.path,
        retryResponseBytes,
      ),
      httpStatus: input.responseStatus,
    },
    responseHeaders: artifactReference(
      originalAttempt.responseHeaders.path,
      retryHeaderBytes,
    ),
    retryAfterMilliseconds: input.delayMilliseconds,
  }, {
    attempt: 2,
    request: artifactReference(
      finalPaths.request,
      finalRequestBytes,
    ),
    response: {
      ...artifactReference(
        finalPaths.response,
        finalResponseBytes,
      ),
      httpStatus: 200,
    },
    responseHeaders: artifactReference(
      finalPaths.responseHeaders,
      finalHeaderBytes,
    ),
  }];
  const captureBytes = canonicalBytes(capture);
  await writeFile(capturePath, captureBytes, { mode: 0o600 });
  Object.assign(
    completionCapture.captureManifest,
    artifactReference(
      completionCapture.captureManifest.path,
      captureBytes,
    ),
  );
  completion.counts.networkRequestCount += 1;
  await writeFile(completionPath, canonicalBytes(completion), {
    mode: 0o600,
  });
  return refreshCaptureExpected(root);
}

async function injectFifthNetworkAttempt(
  root: string,
): Promise<Partial<BaseFixture["expected"]>> {
  await injectFirstResponseRetry(root, {
    delayMilliseconds: 1_000,
    responseHeaders: {},
    responseStatus: 503,
  });
  const completionPath = join(root, "completion.json");
  const completion = await readJson<MutableCompletion>(
    completionPath,
  );
  const completionCapture = completion.captures[0]!;
  const capturePath = join(
    root,
    completionCapture.captureManifest.path,
  );
  const capture = await readJson<MutableTargetCapture>(
    capturePath,
  );
  const finalAttempt = capture.attempts[1]!;
  const [
    finalRequest,
    finalResponseBytes,
    finalHeaderBytes,
  ] = await Promise.all([
    readJson<Record<string, unknown>>(
      join(root, finalAttempt.request.path),
    ),
    readFile(join(root, finalAttempt.response!.path)),
    readFile(join(root, finalAttempt.responseHeaders.path)),
  ]);
  const retryResponseBytes = canonicalBytes({
    message: "retry",
  });
  const retryHeaderBytes = canonicalBytes({});
  const attempts = [capture.attempts[0]!];

  for (const attempt of [2, 3, 4]) {
    const attemptDirectory =
      `${completionCapture.captureDirectory}/attempts/attempt-${
        String(attempt).padStart(2, "0")
      }`;
    if (attempt > 2) {
      await mkdir(join(root, attemptDirectory), {
        mode: 0o700,
      });
    }
    const requestBytes = canonicalBytes({
      ...finalRequest,
      attempt,
    });
    const paths = {
      request: `${attemptDirectory}/request.json`,
      response: `${attemptDirectory}/response.json`,
      responseHeaders:
        `${attemptDirectory}/response-headers.json`,
    };
    await Promise.all([
      writeFile(join(root, paths.request), requestBytes, {
        mode: 0o600,
      }),
      writeFile(
        join(root, paths.response),
        retryResponseBytes,
        { mode: 0o600 },
      ),
      writeFile(
        join(root, paths.responseHeaders),
        retryHeaderBytes,
        { mode: 0o600 },
      ),
    ]);
    attempts.push({
      attempt,
      request: artifactReference(paths.request, requestBytes),
      response: {
        ...artifactReference(paths.response, retryResponseBytes),
        httpStatus: 503,
      },
      responseHeaders: artifactReference(
        paths.responseHeaders,
        retryHeaderBytes,
      ),
      retryAfterMilliseconds: 2 ** (attempt - 1) * 1_000,
    });
  }

  const finalAttemptNumber = 5;
  const finalAttemptDirectory =
    `${completionCapture.captureDirectory}/attempts/attempt-05`;
  await mkdir(join(root, finalAttemptDirectory), {
    mode: 0o700,
  });
  const finalRequestBytes = canonicalBytes({
    ...finalRequest,
    attempt: finalAttemptNumber,
  });
  const finalPaths = {
    request: `${finalAttemptDirectory}/request.json`,
    response: `${finalAttemptDirectory}/response.json`,
    responseHeaders:
      `${finalAttemptDirectory}/response-headers.json`,
  };
  await Promise.all([
    writeFile(join(root, finalPaths.request), finalRequestBytes, {
      mode: 0o600,
    }),
    writeFile(
      join(root, finalPaths.response),
      finalResponseBytes,
      { mode: 0o600 },
    ),
    writeFile(
      join(root, finalPaths.responseHeaders),
      finalHeaderBytes,
      { mode: 0o600 },
    ),
  ]);
  attempts.push({
    attempt: finalAttemptNumber,
    request: artifactReference(
      finalPaths.request,
      finalRequestBytes,
    ),
    response: {
      ...artifactReference(
        finalPaths.response,
        finalResponseBytes,
      ),
      httpStatus: 200,
    },
    responseHeaders: artifactReference(
      finalPaths.responseHeaders,
      finalHeaderBytes,
    ),
  });
  capture.attempts = attempts;
  const captureBytes = canonicalBytes(capture);
  await writeFile(capturePath, captureBytes, { mode: 0o600 });
  Object.assign(
    completionCapture.captureManifest,
    artifactReference(
      completionCapture.captureManifest.path,
      captureBytes,
    ),
  );
  completion.counts.networkRequestCount += 3;
  await writeFile(completionPath, canonicalBytes(completion), {
    mode: 0o600,
  });
  return refreshCaptureExpected(root);
}

async function injectFirstTransportRetry(
  root: string,
  input: TransportAttemptMutation,
): Promise<Partial<BaseFixture["expected"]>> {
  await injectFirstResponseRetry(root, {
    delayMilliseconds: input.delayMilliseconds,
    responseHeaders: input.responseHeaders,
    responseStatus: input.httpStatus ?? 503,
  });
  const completionPath = join(root, "completion.json");
  const completion = await readJson<MutableCompletion>(
    completionPath,
  );
  const completionCapture = completion.captures[0]!;
  const capturePath = join(
    root,
    completionCapture.captureManifest.path,
  );
  const capture = await readJson<MutableTargetCapture>(
    capturePath,
  );
  const firstAttempt = capture.attempts[0]!;
  const responsePath = firstAttempt.response!.path;
  await unlink(join(root, responsePath));
  delete firstAttempt.response;
  const errorPath =
    `${completionCapture.captureDirectory}/attempts/` +
    "attempt-01/transport-error.json";
  const errorBytes = canonicalBytes({
    artifactKind:
      "c6-live-multilang-neighbor-commit-count-transport-error",
    httpStatus: input.httpStatus,
    message: `${input.phase} failed`,
    phase: input.phase,
    retryScheduled: true,
    schemaVersion: 1,
  });
  await writeFile(join(root, errorPath), errorBytes, {
    mode: 0o600,
  });
  firstAttempt.transportError = {
    ...artifactReference(errorPath, errorBytes),
    phase: input.phase,
  };
  const captureBytes = canonicalBytes(capture);
  await writeFile(capturePath, captureBytes, { mode: 0o600 });
  Object.assign(
    completionCapture.captureManifest,
    artifactReference(
      completionCapture.captureManifest.path,
      captureBytes,
    ),
  );
  await writeFile(completionPath, canonicalBytes(completion), {
    mode: 0o600,
  });
  return refreshCaptureExpected(root);
}

async function injectImpossibleFirstTransportRetry(
  root: string,
): Promise<Partial<BaseFixture["expected"]>> {
  return injectFirstTransportRetry(root, {
    delayMilliseconds: 1_000,
    httpStatus: 503,
    phase: "fetch",
    responseHeaders: {},
  });
}

async function refreshCaptureExpected(
  root: string,
): Promise<Partial<BaseFixture["expected"]>> {
  const completionBytes = await readFile(
    join(root, "completion.json"),
  );
  const lock = await buildC6AssetLock(root);
  const lockBytes = Buffer.from(serializeC6AssetLock(lock));
  await writeFile(join(root, "asset-lock.json"), lockBytes, {
    mode: 0o600,
  });
  return {
    expectedCaptureAssetLockSha256: sha256(lockBytes),
    expectedCaptureAssetRootSha256: lock.assetRootSha256,
    expectedCaptureCompletionSha256: sha256(completionBytes),
  };
}

function refreshCompletionProjection(
  completion: MutableCompletion,
): void {
  completion.independenceBoundary.commitCountProjectionSha256 =
    sha256(JSON.stringify(
      completion.captures.map((capture) => ({
        canonicalAnchorId: capture.canonicalAnchorId,
        commitCount: capture.commitCount,
        status: capture.status,
      })),
    ));
}

async function createCanonicalCapture(input: {
  captureRoot: string;
  eligibilityPlan: ReturnType<
    typeof deriveC6LiveMultiLangNeighborCommitCountEligibilityPlan
  >;
  eligibilityPlanBytes: Buffer;
  eligibilityPlanPath: string;
  excludedAnchorId: string;
}): Promise<{
  assetRootSha256: string;
  completionSha256: string;
}> {
  await mkdir(input.captureRoot, { mode: 0o700 });
  const captures = new Array<MutableCompletion["captures"][number]>(
    input.eligibilityPlan.targets.length,
  );
  for (
    let offset = 0;
    offset < input.eligibilityPlan.targets.length;
    offset += 32
  ) {
    const batch = input.eligibilityPlan.targets.slice(
      offset,
      offset + 32,
    );
    await Promise.all(batch.map(async (target, batchIndex) => {
      const index = offset + batchIndex;
      const attemptDirectory =
        `${target.captureDirectory}/attempts/attempt-01`;
      const absoluteAttemptDirectory = join(
        input.captureRoot,
        ...attemptDirectory.split("/"),
      );
      await mkdir(absoluteAttemptDirectory, {
        mode: 0o700,
        recursive: true,
      });
      const variables = {
        name: target.repo,
        number: target.pullNumber,
        owner: target.owner,
      };
      const requestBytes = canonicalBytes({
        attempt: 1,
        endpoint: "https://api.github.com/graphql",
        headers: {
          accept: "application/vnd.github+json",
          authorization: "Bearer [REDACTED]",
          "content-type": "application/json",
          "user-agent":
            "GoodMemory-C6-Commit-Count-Eligibility/1",
          "x-github-api-version": "2022-11-28",
        },
        method: "POST",
        operationName: "C6NeighborCommitCountEligibility",
        query:
          C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_COUNT_ELIGIBILITY_QUERY,
        querySha256: sha256(
          C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_COUNT_ELIGIBILITY_QUERY,
        ),
        variables,
      });
      const responseHeadersBytes = canonicalBytes({
        "content-type": "application/json; charset=utf-8",
        date: "Sat, 26 Jul 2026 12:00:00 GMT",
        "x-github-request-id": `TEST:${index + 1}`,
        "x-ratelimit-limit": "5000",
        "x-ratelimit-remaining": "4999",
        "x-ratelimit-reset": "1785067200",
        "x-ratelimit-resource": "graphql",
        "x-ratelimit-used": "1",
      });
      const commitCount =
        target.canonicalAnchorId === input.excludedAnchorId
          ? 251
          : 250;
      const payload = responsePayload(variables, commitCount);
      const responseBytes = Buffer.from(JSON.stringify(payload));
      const requestPath = `${attemptDirectory}/request.json`;
      const responseHeadersPath =
        `${attemptDirectory}/response-headers.json`;
      const responsePath = `${attemptDirectory}/response.json`;
      await Promise.all([
        writeFile(
          join(input.captureRoot, ...requestPath.split("/")),
          requestBytes,
          { mode: 0o600 },
        ),
        writeFile(
          join(
            input.captureRoot,
            ...responseHeadersPath.split("/"),
          ),
          responseHeadersBytes,
          { mode: 0o600 },
        ),
        writeFile(
          join(input.captureRoot, ...responsePath.split("/")),
          responseBytes,
          { mode: 0o600 },
        ),
      ]);
      const status = commitCount <= 250
        ? "within-platform-cap"
        : "exceeds-platform-cap";
      const capture = {
        artifactKind:
          "c6-live-multilang-neighbor-commit-count-eligibility-target-capture",
        attempts: [{
          attempt: 1,
          request: artifactReference(requestPath, requestBytes),
          response: {
            ...artifactReference(responsePath, responseBytes),
            httpStatus: 200,
          },
          responseHeaders: artifactReference(
            responseHeadersPath,
            responseHeadersBytes,
          ),
        }],
        boundary: {
          acceptedEpisodeCount: 0,
          candidateManifestFrozen: false,
          codexRunReady: false,
          status: "commit-count-only",
        },
        observation: {
          commitCount,
          platformCommitCap: 250,
          pullRequestId:
            payload.data.repository.pullRequest.id,
          rateLimit: payload.data.rateLimit,
          repositoryId: payload.data.repository.id,
          status,
        },
        planTarget: target,
        querySha256: sha256(
          C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_COUNT_ELIGIBILITY_QUERY,
        ),
        schemaVersion: 1,
      };
      const captureBytes = canonicalBytes(capture);
      const capturePath =
        `${target.captureDirectory}/capture.json`;
      await writeFile(
        join(input.captureRoot, ...capturePath.split("/")),
        captureBytes,
        { mode: 0o600 },
      );
      captures[index] = {
        canonicalAnchorId: target.canonicalAnchorId,
        captureDirectory: target.captureDirectory,
        captureManifest: artifactReference(
          capturePath,
          captureBytes,
        ),
        commitCount,
        status,
      };
    }));
  }
  const completion = {
    artifactKind:
      "c6-live-multilang-neighbor-commit-count-eligibility-completion",
    boundary: {
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      codexRunReady: false,
      commitCountCaptureExecuted: true,
      machineQualifiedEpisodeCount: 0,
      semanticallyQualifiedEpisodeCount: 0,
      status: "commit-count-eligibility-capture-complete-only",
    },
    captures,
    counts: {
      capturedTargetCount: 643,
      eligibleTargetCount: 642,
      excludedTargetCount: 1,
      logicalRequestCount: 643,
      networkRequestCount: 643,
      plannedTargetCount: 643,
    },
    independenceBoundary: {
      commitCountProjectionSha256: "",
      goldInput: false,
      machineOutcomeInput: false,
      patchInput: false,
      semanticDecisionInput: false,
      targetOrderPreserved: true,
      testInput: false,
    },
    plan: {
      ...artifactReference(
        basename(input.eligibilityPlanPath),
        input.eligibilityPlanBytes,
      ),
      sourceTargetProjectionSha256:
        input.eligibilityPlan.independenceBoundary
          .sourceTargetProjectionSha256,
    },
    query: {
      endpoint: "https://api.github.com/graphql",
      platformCommitCap: 250,
      querySha256: sha256(
        C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_COUNT_ELIGIBILITY_QUERY,
      ),
    },
    registrationBoundary:
      input.eligibilityPlan.registrationBoundary,
    schemaVersion: 1,
  };
  refreshCompletionProjection(completion);
  const completionBytes = canonicalBytes(completion);
  await writeFile(
    join(input.captureRoot, "completion.json"),
    completionBytes,
    { mode: 0o600 },
  );
  const lock = await buildC6AssetLock(input.captureRoot);
  await writeFile(
    join(input.captureRoot, "asset-lock.json"),
    serializeC6AssetLock(lock),
    { mode: 0o600 },
  );
  return {
    assetRootSha256: lock.assetRootSha256,
    completionSha256: sha256(completionBytes),
  };
}

function responsePayload(
  variables: {
    name: string;
    number: number;
    owner: string;
  },
  totalCount: number,
) {
  return {
    data: {
      rateLimit: {
        cost: 1,
        remaining: 4_999,
        resetAt: "2026-07-26T12:00:00Z",
      },
      repository: {
        id: `repository-${variables.owner}-${variables.name}`,
        nameWithOwner: `${variables.owner}/${variables.name}`,
        pullRequest: {
          commits: { totalCount },
          id:
            `pull-${variables.owner}-${variables.name}-${variables.number}`,
          number: variables.number,
          url:
            `https://github.com/${variables.owner}/${variables.name}/pull/${variables.number}`,
        },
      },
    },
  };
}

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), prefix)),
  );
  perTestRoots.push(root);
  return root;
}

async function persistentRoot(prefix: string): Promise<string> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), prefix)),
  );
  temporaryRoots.push(root);
  return root;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function artifactReference(
  path: string,
  bytes: Uint8Array,
): {
  bytes: number;
  path: string;
  sha256: string;
} {
  return {
    bytes: bytes.byteLength,
    path,
    sha256: sha256(bytes),
  };
}

interface MutableCompletion {
  captures: Array<{
    canonicalAnchorId: string;
    captureDirectory: string;
    captureManifest: {
      bytes: number;
      path: string;
      sha256: string;
    };
    commitCount: number;
    status: string;
  }>;
  independenceBoundary: {
    commitCountProjectionSha256: string;
  };
  counts: {
    networkRequestCount: number;
  };
}

interface MutableTargetCapture {
  attempts: Array<{
    attempt: number;
    request: {
      bytes: number;
      path: string;
      sha256: string;
    };
    response?: {
      bytes: number;
      httpStatus: number;
      path: string;
      sha256: string;
    };
    responseHeaders: {
      bytes: number;
      path: string;
      sha256: string;
    };
    retryAfterMilliseconds?: number;
    transportError?: {
      bytes: number;
      path: string;
      phase: "body-read" | "fetch" | "timeout";
      sha256: string;
    };
  }>;
}

interface MutableResponse {
  data: {
    repository: {
      nameWithOwner: string;
      pullRequest: {
        commits: {
          totalCount: number;
        };
      };
    };
  };
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
