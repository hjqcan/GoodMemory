import { createHash, randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  readdir,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { z } from "zod";

import {
  assertC6NoSymlinkPathComponents,
  buildC6AssetLock,
  readC6StableRegularFile,
  serializeC6AssetLock,
} from "./c6-asset-lock";
import {
  C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_COUNT_ELIGIBILITY_QUERY,
  C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_COUNT_ELIGIBILITY_QUERY_POLICY,
  C6_LIVE_MULTILANG_NEIGHBOR_PLATFORM_COMMIT_CAP,
  parseC6LiveMultiLangNeighborCommitCountEligibilityPlan,
  type C6LiveMultiLangNeighborCommitCountEligibilityTarget,
} from "./c6-live-multilang-neighbor-commit-count-eligibility-plan";

const ENDPOINT = "https://api.github.com/graphql";
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const TRANSPORT_CONTRACT =
  C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_COUNT_ELIGIBILITY_QUERY_POLICY
    .transportContract;
const DEFAULT_REQUEST_TIMEOUT_MILLISECONDS =
  TRANSPORT_CONTRACT.defaultRequestTimeoutMilliseconds;
const MAXIMUM_REQUEST_TIMEOUT_MILLISECONDS =
  TRANSPORT_CONTRACT.maximumRequestTimeoutMilliseconds;
const MAXIMUM_RETRY_AFTER_MILLISECONDS =
  TRANSPORT_CONTRACT.maximumRetryAfterMilliseconds;
const MAX_RETRIES =
  TRANSPORT_CONTRACT.maximumNetworkAttemptsPerTarget - 1;
const RETRYABLE_HTTP_STATUSES = new Set<number>(
  TRANSPORT_CONTRACT.retryableHttpStatuses,
);
const TRANSIENT_GRAPHQL_TYPES = new Set<string>(
  TRANSPORT_CONTRACT.transientGraphqlTypes,
);
const REQUEST_HEADERS = {
  accept: "application/vnd.github+json",
  "content-type": "application/json",
  "user-agent": "GoodMemory-C6-Commit-Count-Eligibility/1",
  "x-github-api-version": "2022-11-28",
} as const;
const SELECTED_RESPONSE_HEADERS = [
  "content-type",
  "date",
  "etag",
  "retry-after",
  "x-github-request-id",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
  "x-ratelimit-resource",
  "x-ratelimit-used",
] as const;
const REQUIRED_RESPONSE_HEADERS = [
  "content-type",
  "date",
  "x-github-request-id",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
  "x-ratelimit-resource",
  "x-ratelimit-used",
] as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const rateLimitSchema = z.object({
  cost: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
  resetAt: z.iso.datetime(),
}).strict();
const responseSchema = z.object({
  data: z.object({
    rateLimit: rateLimitSchema,
    repository: z.object({
      id: z.string().min(1),
      nameWithOwner: z.string().min(1),
      pullRequest: z.object({
        commits: z.object({
          totalCount: z.number().int().nonnegative(),
        }).strict(),
        id: z.string().min(1),
        number: z.number().int().positive(),
        url: z.url(),
      }).strict(),
    }).strict(),
  }).strict(),
}).strict();

type EligibilityStatus =
  | "within-platform-cap"
  | "exceeds-platform-cap";

interface ArtifactReference {
  bytes: number;
  path: string;
  sha256: string;
}

interface AttemptRecord {
  attempt: number;
  request: ArtifactReference;
  response?: ArtifactReference & { httpStatus: number };
  responseHeaders: ArtifactReference;
  retryAfterMilliseconds?: number;
  transportError?: ArtifactReference & {
    phase: "body-read" | "fetch" | "timeout";
  };
}

interface OwnedPathIdentity {
  dev: number;
  ino: number;
  kind: "directory" | "file";
  relativePath: string;
}

interface OwnedTreeLedger {
  entries: Map<string, OwnedPathIdentity>;
  root: OwnedPathIdentity;
}

interface ExecutedRequest {
  attempts: AttemptRecord[];
  networkRequestCount: number;
  raw: unknown;
  references: ArtifactReference[];
  responseHeaders: Record<string, string>;
}

interface TransportSuccess {
  response: Response;
  responseBytes: Buffer;
  success: true;
}

interface TransportFailure {
  error: unknown;
  phase: "body-read" | "fetch" | "timeout";
  response: Response | null;
  success: false;
}

export type C6LiveMultiLangNeighborCommitCountEligibilityFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface C6LiveMultiLangNeighborCommitCountEligibilityCaptureResult {
  assetRootSha256: string;
  capturedTargetCount: number;
  completionSha256: string;
  eligibleTargetCount: number;
  excludedTargetCount: number;
  logicalRequestCount: number;
  networkRequestCount: number;
  outputRoot: string;
}

export function classifyC6LiveMultiLangNeighborCommitCountEligibility(
  commitCount: number,
): EligibilityStatus {
  const count = z.number().int().nonnegative().parse(commitCount);
  return count <= C6_LIVE_MULTILANG_NEIGHBOR_PLATFORM_COMMIT_CAP
    ? "within-platform-cap"
    : "exceeds-platform-cap";
}

export async function captureC6LiveMultiLangNeighborCommitCountEligibility(
  input: {
    authorizationToken: string;
    expectedPlanSha256: string;
    expectedQuerySha256: string;
    expectedSourceTargetProjectionSha256: string;
    expectedTargetCount: number;
    fetchImpl?: C6LiveMultiLangNeighborCommitCountEligibilityFetch;
    outputRoot: string;
    planPath: string;
    progress?: (message: string) => void;
    requestTimeoutMilliseconds?: number;
    sleep?: (milliseconds: number) => Promise<void>;
    testHooks?: {
      beforePrepublicationVerification?: (
        temporaryRoot: string,
      ) => Promise<void> | void;
      beforePublishedVerification?: (
        publishedRoot: string,
      ) => Promise<void> | void;
      beforeTerminalPlanVerification?: () => Promise<void> | void;
    };
  },
): Promise<C6LiveMultiLangNeighborCommitCountEligibilityCaptureResult> {
  const token = requiredUnpadded(
    input.authorizationToken,
    "authorization token",
  );
  const expectedPlanSha256 = sha256Schema.parse(
    input.expectedPlanSha256,
  );
  const expectedQuerySha256 = sha256Schema.parse(
    input.expectedQuerySha256,
  );
  const expectedSourceTargetProjectionSha256 = sha256Schema.parse(
    input.expectedSourceTargetProjectionSha256,
  );
  const expectedTargetCount = z.number().int().positive().parse(
    input.expectedTargetCount,
  );
  const requestTimeoutMilliseconds = z.number().int().positive().max(
    MAXIMUM_REQUEST_TIMEOUT_MILLISECONDS,
  ).parse(
    input.requestTimeoutMilliseconds ??
      DEFAULT_REQUEST_TIMEOUT_MILLISECONDS,
  );
  const actualQuerySha256 = sha256(
    C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_COUNT_ELIGIBILITY_QUERY,
  );
  if (
    expectedQuerySha256 !== actualQuerySha256
  ) {
    throw new Error(
      "C6 commit-count eligibility capture query hash mismatch",
    );
  }

  const planPath = await assertC6NoSymlinkPathComponents(
    input.planPath,
    "C6 commit-count eligibility capture plan",
  );
  const planBytes = await readC6StableRegularFile(
    planPath,
    "commit-count eligibility capture plan",
  );
  if (sha256(planBytes) !== expectedPlanSha256) {
    throw new Error(
      "C6 commit-count eligibility capture plan hash mismatch",
    );
  }
  const plan =
    parseC6LiveMultiLangNeighborCommitCountEligibilityPlan(
      planBytes,
    );
  if (
    plan.queryContract.querySha256 !== actualQuerySha256 ||
    plan.queryContract.endpoint !== ENDPOINT
  ) {
    throw new Error(
      "C6 commit-count eligibility capture plan query mismatch",
    );
  }
  if (
    expectedTargetCount !== plan.targets.length ||
    expectedTargetCount !== plan.counts.expectedRequestCount
  ) {
    throw new Error(
      "C6 commit-count eligibility capture target count mismatch",
    );
  }
  if (
    expectedSourceTargetProjectionSha256 !==
      plan.independenceBoundary.sourceTargetProjectionSha256
  ) {
    throw new Error(
      "C6 commit-count eligibility capture source target projection hash mismatch",
    );
  }

  const outputRoot = resolve(
    requiredUnpadded(input.outputRoot, "output root"),
  );
  await assertC6NoSymlinkPathComponents(
    dirname(outputRoot),
    "C6 commit-count eligibility capture output parent",
  );
  await assertOutputMissing(outputRoot);
  const temporaryRoot = `${outputRoot}.incomplete-${randomUUID()}`;
  await mkdir(temporaryRoot, { mode: DIRECTORY_MODE });
  const temporaryLedger = await createOwnedTreeLedger(
    temporaryRoot,
  );
  const fetchImpl = input.fetchImpl ??
    ((request, init) => fetch(request, init));
  const progress = input.progress ??
    ((message: string) => process.stderr.write(`${message}\n`));
  const sleep = input.sleep ?? sleepMilliseconds;
  let outputLedger: OwnedTreeLedger | null = null;

  try {
    const captures = [];
    const references: ArtifactReference[] = [];
    let eligibleTargetCount = 0;
    let excludedTargetCount = 0;
    let networkRequestCount = 0;
    for (const [index, target] of plan.targets.entries()) {
      const captured = await captureTarget({
        fetchImpl,
        progress,
        requestTimeoutMilliseconds,
        sleep,
        target,
        targetIndex: index + 1,
        temporaryLedger,
        temporaryRoot,
        token,
        totalTargets: plan.targets.length,
      });
      captures.push(captured.completionEntry);
      references.push(...captured.references);
      networkRequestCount += captured.networkRequestCount;
      if (captured.completionEntry.status === "within-platform-cap") {
        eligibleTargetCount += 1;
      } else {
        excludedTargetCount += 1;
      }
    }

    await input.testHooks?.beforeTerminalPlanVerification?.();
    await assertPlanUnchanged(
      planPath,
      planBytes,
      expectedPlanSha256,
    );

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
        capturedTargetCount: captures.length,
        eligibleTargetCount,
        excludedTargetCount,
        logicalRequestCount: captures.length,
        networkRequestCount,
        plannedTargetCount: plan.targets.length,
      },
      independenceBoundary: {
        commitCountProjectionSha256: sha256(JSON.stringify(
          captures.map((capture) => ({
            canonicalAnchorId: capture.canonicalAnchorId,
            commitCount: capture.commitCount,
            status: capture.status,
          })),
        )),
        goldInput: false,
        machineOutcomeInput: false,
        patchInput: false,
        semanticDecisionInput: false,
        targetOrderPreserved: true,
        testInput: false,
      },
      plan: {
        ...artifactReference(basename(planPath), planBytes),
        sourceTargetProjectionSha256:
          expectedSourceTargetProjectionSha256,
      },
      query: {
        endpoint: ENDPOINT,
        platformCommitCap:
          C6_LIVE_MULTILANG_NEIGHBOR_PLATFORM_COMMIT_CAP,
        querySha256: actualQuerySha256,
      },
      registrationBoundary: plan.registrationBoundary,
      schemaVersion: 1,
    };
    const completionBytes = canonicalBytes(completion);
    assertTokenAbsent(token, completionBytes, "completion");
    references.push(await writePrivateArtifact(
      temporaryRoot,
      "completion.json",
      completionBytes,
      temporaryLedger,
    ));

    await input.testHooks?.beforePrepublicationVerification?.(
      temporaryRoot,
    );
    await assertExactCaptureTree(temporaryRoot, references);
    await assertOwnedTreeIdentity(
      temporaryRoot,
      temporaryLedger,
      references,
    );
    const assetLock = await buildC6AssetLock(temporaryRoot);
    const assetLockBytes = Buffer.from(serializeC6AssetLock(assetLock));
    assertTokenAbsent(token, assetLockBytes, "asset lock");
    references.push(await writePrivateArtifact(
      temporaryRoot,
      "asset-lock.json",
      assetLockBytes,
      temporaryLedger,
    ));
    await assertExactCaptureTree(temporaryRoot, references);
    await assertOwnedTreeIdentity(
      temporaryRoot,
      temporaryLedger,
      references,
    );
    await assertAssetLockMatches(temporaryRoot, assetLock);

    await assertPlanUnchanged(
      planPath,
      planBytes,
      expectedPlanSha256,
    );
    await assertC6NoSymlinkPathComponents(
      dirname(outputRoot),
      "C6 commit-count eligibility capture output parent",
    );
    await assertOutputMissing(outputRoot);
    try {
      await mkdir(outputRoot, { mode: DIRECTORY_MODE });
      outputLedger = await createOwnedTreeLedger(outputRoot);
    } catch (error) {
      if (isErrorCode(error, "EEXIST")) {
        throw new Error(
          "C6 commit-count eligibility capture output already exists",
        );
      }
      throw error;
    }
    for (const entry of (await readdir(temporaryRoot)).sort(
      terminalFilesLast,
    )) {
      await publishNoReplace(
        join(temporaryRoot, entry),
        join(outputRoot, entry),
        entry,
        temporaryLedger,
        outputLedger,
      );
    }
    await assertOwnedTreeIdentity(
      temporaryRoot,
      temporaryLedger,
      references,
    );
    await assertOwnedTreeIdentity(
      outputRoot,
      outputLedger,
      references,
    );
    await assertExactCaptureTree(outputRoot, references);
    await assertAssetLockMatches(outputRoot, assetLock);

    await input.testHooks?.beforePublishedVerification?.(outputRoot);
    await assertOwnedTreeIdentity(
      temporaryRoot,
      temporaryLedger,
      references,
    );
    await assertOwnedTreeIdentity(
      outputRoot,
      outputLedger,
      references,
    );
    await assertExactCaptureTree(outputRoot, references);
    await assertAssetLockMatches(outputRoot, assetLock);
    await assertPlanUnchanged(
      planPath,
      planBytes,
      expectedPlanSha256,
    );

    if (!await removeOwnedTree(temporaryRoot, temporaryLedger)) {
      throw new Error(
        "C6 commit-count eligibility temporary ownership cleanup mismatch",
      );
    }
    return {
      assetRootSha256: assetLock.assetRootSha256,
      capturedTargetCount: captures.length,
      completionSha256: sha256(completionBytes),
      eligibleTargetCount,
      excludedTargetCount,
      logicalRequestCount: captures.length,
      networkRequestCount,
      outputRoot,
    };
  } catch (error) {
    if (outputLedger !== null) {
      await removeOwnedTree(outputRoot, outputLedger);
    }
    await removeOwnedTree(temporaryRoot, temporaryLedger);
    throw sanitizeThrownError(error, token);
  }
}

async function captureTarget(input: {
  fetchImpl: C6LiveMultiLangNeighborCommitCountEligibilityFetch;
  progress: (message: string) => void;
  requestTimeoutMilliseconds: number;
  sleep: (milliseconds: number) => Promise<void>;
  target: C6LiveMultiLangNeighborCommitCountEligibilityTarget;
  targetIndex: number;
  temporaryLedger: OwnedTreeLedger;
  temporaryRoot: string;
  token: string;
  totalTargets: number;
}): Promise<{
  completionEntry: {
    canonicalAnchorId: string;
    captureDirectory: string;
    captureManifest: ArtifactReference;
    commitCount: number;
    status: EligibilityStatus;
  };
  networkRequestCount: number;
  references: ArtifactReference[];
}> {
  const targetRoot = join(
    input.temporaryRoot,
    input.target.captureDirectory,
  );
  await mkdir(targetRoot, { mode: DIRECTORY_MODE });
  await recordOwnedPath({
    absolutePath: targetRoot,
    kind: "directory",
    ledger: input.temporaryLedger,
    relativePath: input.target.captureDirectory,
  });
  const attemptsRoot = join(targetRoot, "attempts");
  await mkdir(attemptsRoot, { mode: DIRECTORY_MODE });
  await recordOwnedPath({
    absolutePath: attemptsRoot,
    kind: "directory",
    ledger: input.temporaryLedger,
    relativePath: `${input.target.captureDirectory}/attempts`,
  });
  const variables = {
    name: input.target.repo,
    number: input.target.pullNumber,
    owner: input.target.owner,
  };
  const executed = await executeRequest({
    fetchImpl: input.fetchImpl,
    progress: input.progress,
    requestTimeoutMilliseconds:
      input.requestTimeoutMilliseconds,
    sleep: input.sleep,
    target: input.target,
    targetIndex: input.targetIndex,
    temporaryLedger: input.temporaryLedger,
    targetRoot,
    token: input.token,
    totalTargets: input.totalTargets,
    variables,
  });
  const parsed = responseSchema.parse(executed.raw);
  const repository = parsed.data.repository;
  const pull = repository.pullRequest;
  if (
    repository.nameWithOwner.toLowerCase() !==
      input.target.canonicalRepository ||
    pull.number !== input.target.pullNumber ||
    normalizeUrl(pull.url) !== normalizeUrl(input.target.url)
  ) {
    throw new Error(
      `C6 commit-count eligibility capture response identity mismatch ${
        input.target.canonicalAnchorId
      }`,
    );
  }
  const commitCount = pull.commits.totalCount;
  const status =
    classifyC6LiveMultiLangNeighborCommitCountEligibility(
      commitCount,
    );
  const capture = {
    artifactKind:
      "c6-live-multilang-neighbor-commit-count-eligibility-target-capture",
    attempts: executed.attempts,
    boundary: {
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      codexRunReady: false,
      status: "commit-count-only",
    },
    observation: {
      commitCount,
      platformCommitCap:
        C6_LIVE_MULTILANG_NEIGHBOR_PLATFORM_COMMIT_CAP,
      pullRequestId: pull.id,
      rateLimit: parsed.data.rateLimit,
      repositoryId: repository.id,
      status,
    },
    planTarget: input.target,
    querySha256: sha256(
      C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_COUNT_ELIGIBILITY_QUERY,
    ),
    schemaVersion: 1,
  };
  const captureBytes = canonicalBytes(capture);
  assertTokenAbsent(input.token, captureBytes, "target capture");
  const captureReference = await writePrivateArtifact(
    input.temporaryRoot,
    `${input.target.captureDirectory}/capture.json`,
    captureBytes,
    input.temporaryLedger,
  );
  return {
    completionEntry: {
      canonicalAnchorId: input.target.canonicalAnchorId,
      captureDirectory: input.target.captureDirectory,
      captureManifest: captureReference,
      commitCount,
      status,
    },
    networkRequestCount: executed.networkRequestCount,
    references: [...executed.references, captureReference],
  };
}

async function executeRequest(input: {
  fetchImpl: C6LiveMultiLangNeighborCommitCountEligibilityFetch;
  progress: (message: string) => void;
  requestTimeoutMilliseconds: number;
  sleep: (milliseconds: number) => Promise<void>;
  target: C6LiveMultiLangNeighborCommitCountEligibilityTarget;
  targetIndex: number;
  targetRoot: string;
  temporaryLedger: OwnedTreeLedger;
  token: string;
  totalTargets: number;
  variables: {
    name: string;
    number: number;
    owner: string;
  };
}): Promise<ExecutedRequest> {
  const attempts: AttemptRecord[] = [];
  const references: ArtifactReference[] = [];
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt += 1) {
    const attemptRelative =
      `${input.target.captureDirectory}/attempts/attempt-${
        String(attempt).padStart(2, "0")
      }`;
    const attemptRoot = join(
      input.targetRoot,
      "attempts",
      `attempt-${String(attempt).padStart(2, "0")}`,
    );
    await mkdir(attemptRoot, { mode: DIRECTORY_MODE });
    await recordOwnedPath({
      absolutePath: attemptRoot,
      kind: "directory",
      ledger: input.temporaryLedger,
      relativePath: attemptRelative,
    });
    const receipt = {
      attempt,
      endpoint: ENDPOINT,
      headers: {
        ...REQUEST_HEADERS,
        authorization: "Bearer [REDACTED]",
      },
      method: "POST",
      operationName: "C6NeighborCommitCountEligibility",
      query:
        C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_COUNT_ELIGIBILITY_QUERY,
      querySha256: sha256(
        C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_COUNT_ELIGIBILITY_QUERY,
      ),
      variables: input.variables,
    };
    const requestBytes = canonicalBytes(receipt);
    assertTokenAbsent(input.token, requestBytes, "request receipt");
    const requestReference = await writePrivateArtifact(
      dirname(input.targetRoot),
      `${attemptRelative}/request.json`,
      requestBytes,
      input.temporaryLedger,
    );
    references.push(requestReference);
    const attemptRecord: AttemptRecord = {
      attempt,
      request: requestReference,
      responseHeaders: {
        bytes: 0,
        path: `${attemptRelative}/response-headers.json`,
        sha256: sha256(Buffer.alloc(0)),
      },
    };
    attempts.push(attemptRecord);

    const transport = await executeTransportAttempt({
      fetchImpl: input.fetchImpl,
      requestTimeoutMilliseconds:
        input.requestTimeoutMilliseconds,
      token: input.token,
      variables: input.variables,
    });
    if (!transport.success) {
      const selectedHeaders = transport.response === null
        ? {}
        : selectResponseHeaders(
          transport.response.headers,
          false,
        );
      const headerBytes = canonicalBytes(selectedHeaders);
      const errorBytes = canonicalBytes({
        artifactKind:
          "c6-live-multilang-neighbor-commit-count-transport-error",
        httpStatus: transport.response?.status ?? null,
        message: sanitizedError(transport.error, input.token),
        phase: transport.phase,
        retryScheduled: attempt <= MAX_RETRIES,
        schemaVersion: 1,
      });
      assertTokenAbsent(
        input.token,
        headerBytes,
        "transport response headers",
      );
      assertTokenAbsent(
        input.token,
        errorBytes,
        "transport error",
      );
      const headerReference = await writePrivateArtifact(
        dirname(input.targetRoot),
        `${attemptRelative}/response-headers.json`,
        headerBytes,
        input.temporaryLedger,
      );
      const errorReference = await writePrivateArtifact(
        dirname(input.targetRoot),
        `${attemptRelative}/transport-error.json`,
        errorBytes,
        input.temporaryLedger,
      );
      references.push(headerReference, errorReference);
      attemptRecord.responseHeaders = headerReference;
      attemptRecord.transportError = {
        ...errorReference,
        phase: transport.phase,
      };
      if (attempt <= MAX_RETRIES) {
        const delay = exponentialRetryDelay(attempt);
        attemptRecord.retryAfterMilliseconds = delay;
        input.progress(progressLine(
          input,
          attempt,
          `transport=${transport.phase} retryAfterMs=${delay}`,
        ));
        await input.sleep(delay);
        continue;
      }
      throw new Error(
        `C6 commit-count eligibility transport failed after ${attempt} attempts: ${
          sanitizedError(transport.error, input.token)
        }`,
      );
    }

    assertTokenAbsent(
      input.token,
      transport.responseBytes,
      "raw response",
    );
    const responseHeaders = selectResponseHeaders(
      transport.response.headers,
      transport.response.status === 200,
    );
    const responseHeaderBytes = canonicalBytes(responseHeaders);
    assertTokenAbsent(
      input.token,
      responseHeaderBytes,
      "response headers",
    );
    const headerReference = await writePrivateArtifact(
      dirname(input.targetRoot),
      `${attemptRelative}/response-headers.json`,
      responseHeaderBytes,
      input.temporaryLedger,
    );
    const responseReference = await writePrivateArtifact(
      dirname(input.targetRoot),
      `${attemptRelative}/response.json`,
      transport.responseBytes,
      input.temporaryLedger,
    );
    references.push(headerReference, responseReference);
    attemptRecord.responseHeaders = headerReference;
    attemptRecord.response = {
      ...responseReference,
      httpStatus: transport.response.status,
    };

    if (transport.response.status === 200) {
      const raw = parseJson(
        transport.responseBytes,
        "GraphQL response",
      );
      const errors = graphqlErrors(raw);
      if (errors.length === 0) {
        input.progress(progressLine(
          input,
          attempt,
          `complete rateRemaining=${
            responseHeaders["x-ratelimit-remaining"]
          }`,
        ));
        return {
          attempts,
          networkRequestCount: attempt,
          raw,
          references,
          responseHeaders,
        };
      }
      if (
        attempt <= MAX_RETRIES &&
        errors.every(isTransientGraphqlError)
      ) {
        const delay = retryDelay(
          responseHeaders,
          attempt,
        );
        attemptRecord.retryAfterMilliseconds = delay;
        input.progress(progressLine(
          input,
          attempt,
          `graphql=transient retryAfterMs=${delay}`,
        ));
        await input.sleep(delay);
        continue;
      }
      throw new Error(
        "C6 commit-count eligibility capture returned GraphQL errors",
      );
    }

    if (
      RETRYABLE_HTTP_STATUSES.has(transport.response.status) &&
      attempt <= MAX_RETRIES
    ) {
      const delay = retryDelay(responseHeaders, attempt);
      attemptRecord.retryAfterMilliseconds = delay;
      input.progress(progressLine(
        input,
        attempt,
        `status=${transport.response.status} retryAfterMs=${delay}`,
      ));
      await input.sleep(delay);
      continue;
    }
    throw new Error(
      "C6 commit-count eligibility capture unexpected HTTP status " +
        transport.response.status,
    );
  }
  throw new Error(
    "C6 commit-count eligibility capture retry loop exhausted",
  );
}

async function executeTransportAttempt(input: {
  fetchImpl: C6LiveMultiLangNeighborCommitCountEligibilityFetch;
  requestTimeoutMilliseconds: number;
  token: string;
  variables: Record<string, unknown>;
}): Promise<TransportFailure | TransportSuccess> {
  const controller = new AbortController();
  let phase: "body-read" | "fetch" = "fetch";
  let response: Response | null = null;
  let timedOut = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new Error("request timeout"));
    }, input.requestTimeoutMilliseconds);
  });
  try {
    response = await Promise.race([
      input.fetchImpl(ENDPOINT, {
        body: JSON.stringify({
          query:
            C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_COUNT_ELIGIBILITY_QUERY,
          variables: input.variables,
        }),
        headers: {
          ...REQUEST_HEADERS,
          authorization: `Bearer ${input.token}`,
        },
        method: "POST",
        redirect: "error",
        signal: controller.signal,
      }),
      timeout,
    ]);
    phase = "body-read";
    const responseBytes = Buffer.from(await Promise.race([
      response.arrayBuffer(),
      timeout,
    ]));
    return { response, responseBytes, success: true };
  } catch (error) {
    return {
      error,
      phase: timedOut ? "timeout" : phase,
      response,
      success: false,
    };
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  }
}

function selectResponseHeaders(
  headers: Headers,
  requireSuccessProvenance: boolean,
): Record<string, string> {
  if (requireSuccessProvenance) {
    for (const name of REQUIRED_RESPONSE_HEADERS) {
      const value = headers.get(name);
      if (value === null || value.length === 0) {
        throw new Error(
          `C6 commit-count eligibility capture requires response header ${name}`,
        );
      }
    }
  }
  const selected: Record<string, string> = {};
  for (const name of SELECTED_RESPONSE_HEADERS) {
    const value = headers.get(name);
    if (value !== null) {
      selected[name] = value;
    }
  }
  if (
    requireSuccessProvenance &&
    (
      selected["content-type"]?.split(";", 1)[0]!.trim()
        .toLowerCase() !== "application/json" ||
      selected["x-ratelimit-resource"] !== "graphql"
    )
  ) {
    throw new Error(
      "C6 commit-count eligibility capture provenance header mismatch",
    );
  }
  return selected;
}

function graphqlErrors(raw: unknown): unknown[] {
  if (
    typeof raw === "object" &&
    raw !== null &&
    "errors" in raw &&
    Array.isArray(raw.errors)
  ) {
    return raw.errors;
  }
  return [];
}

function isTransientGraphqlError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const extensions = "extensions" in error &&
      typeof error.extensions === "object" &&
      error.extensions !== null
    ? error.extensions
    : null;
  if (extensions === null) {
    return false;
  }
  for (const key of ["type", "code"]) {
    if (
      key in extensions &&
      typeof extensions[key as keyof typeof extensions] === "string" &&
      TRANSIENT_GRAPHQL_TYPES.has(
        String(extensions[key as keyof typeof extensions])
          .toUpperCase(),
      )
    ) {
      return true;
    }
  }
  return false;
}

function retryDelay(
  headers: Record<string, string>,
  attempt: number,
): number {
  const retryAfter = headers["retry-after"];
  if (
    retryAfter !== undefined &&
    /^\d+$/u.test(retryAfter)
  ) {
    return Math.min(
      Number(retryAfter) * 1_000,
      MAXIMUM_RETRY_AFTER_MILLISECONDS,
    );
  }
  return exponentialRetryDelay(attempt);
}

function exponentialRetryDelay(attempt: number): number {
  const delay =
    TRANSPORT_CONTRACT.exponentialBackoffMilliseconds[attempt - 1];
  if (delay === undefined) {
    throw new Error(
      "C6 commit-count eligibility retry contract exhausted",
    );
  }
  return delay;
}

function progressLine(
  input: {
    target: C6LiveMultiLangNeighborCommitCountEligibilityTarget;
    targetIndex: number;
    totalTargets: number;
  },
  attempt: number,
  detail: string,
): string {
  return (
    `commit-count target=${input.targetIndex}/${input.totalTargets} ` +
    `anchor=${input.target.canonicalAnchorId} attempt=${attempt} ${detail}`
  );
}

async function assertPlanUnchanged(
  planPath: string,
  planBytes: Buffer,
  expectedPlanSha256: string,
): Promise<void> {
  const terminalPlanBytes = await readC6StableRegularFile(
    planPath,
    "commit-count eligibility capture terminal plan",
  );
  if (
    !terminalPlanBytes.equals(planBytes) ||
    sha256(terminalPlanBytes) !== expectedPlanSha256
  ) {
    throw new Error(
      "C6 commit-count eligibility capture plan changed during capture",
    );
  }
}

async function writePrivateArtifact(
  root: string,
  relativePath: string,
  bytes: Uint8Array,
  ledger: OwnedTreeLedger,
): Promise<ArtifactReference> {
  const path = join(root, ...relativePath.split("/"));
  await writeFile(path, bytes, { flag: "wx", mode: FILE_MODE });
  await recordOwnedPath({
    absolutePath: path,
    kind: "file",
    ledger,
    relativePath,
  });
  return artifactReference(relativePath, bytes);
}

function artifactReference(
  path: string,
  bytes: Uint8Array,
): ArtifactReference {
  return {
    bytes: bytes.byteLength,
    path,
    sha256: sha256(bytes),
  };
}

async function assertExactCaptureTree(
  root: string,
  references: readonly ArtifactReference[],
): Promise<void> {
  await assertC6NoSymlinkPathComponents(
    root,
    "C6 commit-count eligibility capture exact tree root",
  );
  await assertMode(root, DIRECTORY_MODE, "root");
  const expectedFiles = new Map<string, ArtifactReference>();
  const expectedDirectories = new Set<string>();
  for (const reference of references) {
    const components = reference.path.split("/");
    if (
      components.some((component) =>
        component.length === 0 ||
        component === "." ||
        component === ".." ||
        component.includes("\\")
      ) ||
      expectedFiles.has(reference.path)
    ) {
      throw new Error(
        "C6 commit-count eligibility capture invalid closure path " +
          reference.path,
      );
    }
    expectedFiles.set(reference.path, reference);
    for (let length = 1; length < components.length; length += 1) {
      expectedDirectories.add(components.slice(0, length).join("/"));
    }
  }
  const remainingFiles = new Map(expectedFiles);
  const remainingDirectories = new Set(expectedDirectories);
  await walkExactTree(
    root,
    "",
    remainingFiles,
    remainingDirectories,
  );
  if (
    remainingFiles.size > 0 ||
    remainingDirectories.size > 0
  ) {
    throw new Error(
      "C6 commit-count eligibility capture exact tree missing " +
        [...remainingFiles.keys(), ...remainingDirectories].sort()[0],
    );
  }
}

async function walkExactTree(
  root: string,
  relativeDirectory: string,
  remainingFiles: Map<string, ArtifactReference>,
  remainingDirectories: Set<string>,
): Promise<void> {
  const directory = relativeDirectory.length === 0
    ? root
    : join(root, ...relativeDirectory.split("/"));
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const relativePath = relativeDirectory.length === 0
      ? entry.name
      : `${relativeDirectory}/${entry.name}`;
    const absolutePath = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(
        "C6 commit-count eligibility capture exact tree rejects symlink " +
          relativePath,
      );
    }
    if (entry.isDirectory()) {
      if (!remainingDirectories.delete(relativePath)) {
        throw new Error(
          "C6 commit-count eligibility capture exact tree unexpected directory " +
            relativePath,
        );
      }
      await assertMode(absolutePath, DIRECTORY_MODE, relativePath);
      await walkExactTree(
        root,
        relativePath,
        remainingFiles,
        remainingDirectories,
      );
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(
        "C6 commit-count eligibility capture exact tree rejects non-file " +
          relativePath,
      );
    }
    const expected = remainingFiles.get(relativePath);
    if (expected === undefined) {
      throw new Error(
        "C6 commit-count eligibility capture exact tree unexpected file " +
          relativePath,
      );
    }
    await assertMode(absolutePath, FILE_MODE, relativePath);
    const bytes = await readC6StableRegularFile(
      absolutePath,
      "commit-count eligibility capture exact tree file",
    );
    if (
      bytes.byteLength !== expected.bytes ||
      sha256(bytes) !== expected.sha256
    ) {
      throw new Error(
        "C6 commit-count eligibility capture exact tree content mismatch " +
          relativePath,
      );
    }
    remainingFiles.delete(relativePath);
  }
}

async function assertAssetLockMatches(
  root: string,
  expected: Awaited<ReturnType<typeof buildC6AssetLock>>,
): Promise<void> {
  const lockBytes = await readC6StableRegularFile(
    join(root, "asset-lock.json"),
    "commit-count eligibility capture asset lock",
  );
  if (
    lockBytes.toString("utf8") !== serializeC6AssetLock(expected) ||
    serializeC6AssetLock(await buildC6AssetLock(root)) !==
      serializeC6AssetLock(expected)
  ) {
    throw new Error(
      "C6 commit-count eligibility capture asset closure mismatch",
    );
  }
}

async function assertMode(
  path: string,
  expectedMode: number,
  label: string,
): Promise<void> {
  const mode = (await lstat(path)).mode & 0o777;
  if (mode !== expectedMode) {
    throw new Error(
      "C6 commit-count eligibility capture mode mismatch " +
        `${label}: expected ${expectedMode.toString(8)}, ` +
        `received ${mode.toString(8)}`,
    );
  }
}

async function publishNoReplace(
  sourcePath: string,
  destinationPath: string,
  relativePath: string,
  sourceLedger: OwnedTreeLedger,
  destinationLedger: OwnedTreeLedger,
): Promise<void> {
  const source = await lstat(sourcePath);
  const sourceIdentity = sourceLedger.entries.get(relativePath);
  if (
    sourceIdentity === undefined ||
    source.isSymbolicLink() ||
    source.dev !== sourceIdentity.dev ||
    source.ino !== sourceIdentity.ino
  ) {
    throw new Error(
      "C6 commit-count eligibility capture source ownership mismatch " +
        relativePath,
    );
  }
  if (source.isDirectory()) {
    if (sourceIdentity.kind !== "directory") {
      throw new Error(
        "C6 commit-count eligibility capture source kind mismatch " +
          relativePath,
      );
    }
    await mkdir(destinationPath, { mode: DIRECTORY_MODE });
    await recordOwnedPath({
      absolutePath: destinationPath,
      kind: "directory",
      ledger: destinationLedger,
      relativePath,
    });
    for (const entry of (await readdir(sourcePath)).sort()) {
      await publishNoReplace(
        join(sourcePath, entry),
        join(destinationPath, entry),
        `${relativePath}/${entry}`,
        sourceLedger,
        destinationLedger,
      );
    }
    return;
  }
  if (
    !source.isFile() ||
    sourceIdentity.kind !== "file"
  ) {
    throw new Error(
      "C6 commit-count eligibility capture refuses non-file source",
    );
  }
  await link(sourcePath, destinationPath);
  const destinationIdentity = await readOwnedIdentity(
    destinationPath,
    relativePath,
    "file",
  );
  if (
    destinationIdentity.dev !== sourceIdentity.dev ||
    destinationIdentity.ino !== sourceIdentity.ino
  ) {
    throw new Error(
      "C6 commit-count eligibility capture hardlink ownership mismatch " +
        relativePath,
    );
  }
  if (destinationLedger.entries.has(relativePath)) {
    throw new Error(
      "C6 commit-count eligibility capture duplicate owned path " +
        relativePath,
    );
  }
  destinationLedger.entries.set(relativePath, destinationIdentity);
}

function terminalFilesLast(left: string, right: string): number {
  const rank = (name: string): number =>
    name === "asset-lock.json"
      ? 2
      : name === "completion.json"
      ? 1
      : 0;
  return rank(left) - rank(right) || left.localeCompare(right);
}

async function createOwnedTreeLedger(
  root: string,
): Promise<OwnedTreeLedger> {
  return {
    entries: new Map(),
    root: await readOwnedIdentity(root, "", "directory"),
  };
}

async function recordOwnedPath(input: {
  absolutePath: string;
  kind: OwnedPathIdentity["kind"];
  ledger: OwnedTreeLedger;
  relativePath: string;
}): Promise<void> {
  if (input.ledger.entries.has(input.relativePath)) {
    throw new Error(
      "C6 commit-count eligibility capture duplicate owned path " +
        input.relativePath,
    );
  }
  input.ledger.entries.set(
    input.relativePath,
    await readOwnedIdentity(
      input.absolutePath,
      input.relativePath,
      input.kind,
    ),
  );
}

async function readOwnedIdentity(
  path: string,
  relativePath: string,
  kind: OwnedPathIdentity["kind"],
): Promise<OwnedPathIdentity> {
  const stat = await lstat(path);
  if (
    stat.isSymbolicLink() ||
    (
      kind === "directory"
        ? !stat.isDirectory()
        : !stat.isFile()
    )
  ) {
    throw new Error(
      "C6 commit-count eligibility capture owned path identity mismatch " +
        relativePath,
    );
  }
  return {
    dev: stat.dev,
    ino: stat.ino,
    kind,
    relativePath,
  };
}

async function assertOwnedTreeIdentity(
  root: string,
  ledger: OwnedTreeLedger,
  references: readonly ArtifactReference[],
): Promise<void> {
  const expectedDirectories = expectedCaptureDirectories(references);
  if (
    ledger.entries.size !==
      expectedDirectories.size + references.length
  ) {
    throw new Error(
      "C6 commit-count eligibility capture ownership ledger mismatch",
    );
  }
  await assertOwnedPathIdentity(root, ledger.root);
  for (const directory of expectedDirectories) {
    const identity = ledger.entries.get(directory);
    if (identity?.kind !== "directory") {
      throw new Error(
        "C6 commit-count eligibility capture ownership ledger mismatch " +
          directory,
      );
    }
    await assertOwnedPathIdentity(
      joinRelative(root, directory),
      identity,
    );
  }
  for (const reference of references) {
    const identity = ledger.entries.get(reference.path);
    if (identity?.kind !== "file") {
      throw new Error(
        "C6 commit-count eligibility capture ownership ledger mismatch " +
          reference.path,
      );
    }
    await assertOwnedPathIdentity(
      joinRelative(root, reference.path),
      identity,
    );
  }
}

function expectedCaptureDirectories(
  references: readonly ArtifactReference[],
): Set<string> {
  const directories = new Set<string>();
  for (const reference of references) {
    const components = reference.path.split("/");
    for (let length = 1; length < components.length; length += 1) {
      directories.add(components.slice(0, length).join("/"));
    }
  }
  return directories;
}

async function assertOwnedPathIdentity(
  path: string,
  expected: OwnedPathIdentity,
): Promise<void> {
  const actual = await readOwnedIdentity(
    path,
    expected.relativePath,
    expected.kind,
  );
  if (
    actual.dev !== expected.dev ||
    actual.ino !== expected.ino
  ) {
    throw new Error(
      "C6 commit-count eligibility capture owned path identity changed " +
        expected.relativePath,
    );
  }
}

async function removeOwnedTree(
  root: string,
  ledger: OwnedTreeLedger,
): Promise<boolean> {
  if (!await matchesOwnedPath(root, ledger.root)) {
    return false;
  }
  const identities = [...ledger.entries.values()].sort(
    (left, right) => {
      const depth =
        right.relativePath.split("/").length -
        left.relativePath.split("/").length;
      if (depth !== 0) {
        return depth;
      }
      if (left.kind !== right.kind) {
        return left.kind === "file" ? -1 : 1;
      }
      return right.relativePath.localeCompare(left.relativePath);
    },
  );
  for (const identity of identities) {
    if (!await matchesOwnedChain(root, identity, ledger)) {
      continue;
    }
    const path = joinRelative(root, identity.relativePath);
    if (identity.kind === "file") {
      await rm(path, { force: true });
      continue;
    }
    try {
      await rmdir(path);
    } catch (error) {
      if (
        isErrorCode(error, "ENOENT") ||
        isErrorCode(error, "ENOTEMPTY") ||
        isErrorCode(error, "EEXIST")
      ) {
        continue;
      }
      throw error;
    }
  }
  if (!await matchesOwnedPath(root, ledger.root)) {
    return !await pathExists(root);
  }
  try {
    await rmdir(root);
    return true;
  } catch (error) {
    if (
      isErrorCode(error, "ENOENT") ||
      isErrorCode(error, "ENOTEMPTY") ||
      isErrorCode(error, "EEXIST")
    ) {
      return isErrorCode(error, "ENOENT");
    }
    throw error;
  }
}

async function matchesOwnedChain(
  root: string,
  identity: OwnedPathIdentity,
  ledger: OwnedTreeLedger,
): Promise<boolean> {
  if (!await matchesOwnedPath(root, ledger.root)) {
    return false;
  }
  const components = identity.relativePath.split("/");
  for (let length = 1; length < components.length; length += 1) {
    const relativePath = components.slice(0, length).join("/");
    const parentIdentity = ledger.entries.get(relativePath);
    if (
      parentIdentity?.kind !== "directory" ||
      !await matchesOwnedPath(
        joinRelative(root, relativePath),
        parentIdentity,
      )
    ) {
      return false;
    }
  }
  return matchesOwnedPath(
    joinRelative(root, identity.relativePath),
    identity,
  );
}

async function matchesOwnedPath(
  path: string,
  identity: OwnedPathIdentity,
): Promise<boolean> {
  try {
    const stat = await lstat(path);
    return (
      !stat.isSymbolicLink() &&
      (
        identity.kind === "directory"
          ? stat.isDirectory()
          : stat.isFile()
      ) &&
      stat.dev === identity.dev &&
      stat.ino === identity.ino
    );
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
}

function joinRelative(root: string, relativePath: string): string {
  return join(root, ...relativePath.split("/"));
}

async function assertOutputMissing(path: string): Promise<void> {
  try {
    await lstat(path);
    throw new Error(
      "C6 commit-count eligibility capture output already exists",
    );
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) {
      return;
    }
    throw error;
  }
}

function normalizeUrl(value: string): string {
  const url = new URL(value);
  url.hostname = url.hostname.toLowerCase();
  url.pathname = url.pathname.toLowerCase().replace(/\/+$/u, "");
  return url.toString();
}

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch {
    throw new Error(
      `C6 commit-count eligibility capture invalid ${label} JSON`,
    );
  }
}

function assertTokenAbsent(
  token: string,
  bytes: Uint8Array,
  label: string,
): void {
  if (Buffer.from(bytes).includes(Buffer.from(token))) {
    throw new Error(
      `C6 commit-count eligibility authorization token appeared in ${label}`,
    );
  }
}

function sanitizedError(error: unknown, token: string): string {
  const message = error instanceof Error
    ? error.message
    : String(error);
  return message.split(token).join("[REDACTED]");
}

function sanitizeThrownError(error: unknown, token: string): Error {
  if (error instanceof Error) {
    const message = sanitizedError(error, token);
    return message === error.message ? error : new Error(message);
  }
  return new Error(sanitizedError(error, token));
}

function requiredUnpadded(value: string, label: string): string {
  if (value.length === 0 || value.trim() !== value) {
    throw new Error(
      `C6 commit-count eligibility capture ${label} is invalid`,
    );
  }
  return value;
}

function isErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function sleepMilliseconds(milliseconds: number): Promise<void> {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, milliseconds);
  });
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
