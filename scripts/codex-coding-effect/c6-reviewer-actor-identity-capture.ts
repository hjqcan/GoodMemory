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

import type { C6AssetLock } from "./c6-asset-lock";
import {
  assertC6NoSymlinkPathComponents,
  buildC6AssetLock,
  readC6StableRegularFile,
  serializeC6AssetLock,
} from "./c6-asset-lock";
import {
  classifyC6ReviewerActor,
  C6_REVIEWER_ACTOR_POLICY_V1,
  serializeC6ReviewerActorPolicy,
} from "./c6-reviewer-actor-policy";
import type {
  C6ReviewerActorReason,
} from "./c6-reviewer-actor-policy";
import {
  parseC6LiveMultiLangNeighborActorPlan,
} from "./c6-live-multilang-neighbor-actor-plan";
import {
  parseC6LiveMultiLangNeighborActorPlanV2,
} from "./c6-live-multilang-neighbor-actor-plan-v2";

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const MAX_RETRIES = 3;
const MAX_RETRY_AFTER_MILLISECONDS = 60_000;
const DEFAULT_REQUEST_TIMEOUT_MILLISECONDS = 60_000;
const MAX_REQUEST_TIMEOUT_MILLISECONDS = 300_000;
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const TRANSIENT_TRANSPORT_CODES = new Set([
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETRESET",
  "ENETUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);
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
const REQUIRED_SUCCESS_HEADERS = [
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
const targetSchema = z.object({
  captureDirectory: z.string().regex(/^actor-[a-f0-9]{64}$/u),
  captureOrder: z.number().int().positive(),
  login: z.string().min(1).refine(
    (value) =>
      value.trim() === value &&
      value === value.toLowerCase() &&
      !/[/\s]/u.test(value),
    "actor login must be normalized",
  ),
}).strict();
const artifactReferenceSchema = z.object({
  bytes: z.number().int().positive(),
  path: z.string().min(1).refine(
    (value) => basename(value) === value,
    "artifact path must be a basename",
  ),
  sha256: sha256Schema,
}).strict();
const actorPolicySchema = z.object({
  actorEligibility: z.object({
    automationLoginRule: z.object({
      containsCaseInsensitive: z.tuple([
        z.literal("coderabbit"),
        z.literal("copilot"),
        z.literal("cursor"),
      ]),
      exactCaseInsensitive: z.tuple([
        z.literal("github-actions"),
        z.literal("github-advanced-security"),
      ]),
      suffixCaseInsensitive: z.literal("[bot]"),
    }).strict(),
    platformType: z.literal("User"),
    unresolvedStatus: z.literal(404),
  }).strict(),
  boundary: z.object({
    automationExclusionComplete: z.literal(false),
    eventTimeActorTypeProven: z.literal(false),
    humanReviewerIdentityProven: z.literal(false),
    platformActorTypeCaptured: z.literal(true),
  }).strict(),
  inputClosure: z.literal(
    "all-broad-target-review-authors-before-actor-filtering",
  ),
  policyId: z.literal("reviewer-platform-actor-eligibility-v1"),
  responseIdentity: z.literal(
    "case-insensitive-login-exact-match",
  ),
  schemaVersion: z.literal(1),
}).strict();
const legacyPlanSchema = z.object({
  artifactKind: z.literal("c6-reviewer-actor-identity-plan"),
  boundary: z.object({
    acceptedEpisodeCount: z.literal(0),
    actorCaptureExecuted: z.literal(false),
    candidateManifestFrozen: z.literal(false),
    codexRunReady: z.literal(false),
    status: z.literal(
      "reviewer-actor-identity-capture-required",
    ),
  }).strict(),
  counts: z.object({
    sourceReviewReferenceCount: z.number().int().positive(),
    sourceTargetCount: z.number().int().positive(),
    uniqueActorCount: z.number().int().positive(),
  }).strict(),
  independenceBoundary: z.object({
    goldInput: z.literal(false),
    machineOutcomeInput: z.literal(false),
    semanticLedgerInput: z.literal(false),
    selectedSequenceInput: z.literal(false),
    targetProjectionSha256: sha256Schema,
  }).strict(),
  inputs: z.object({
    graphqlRootSha256: sha256Schema,
    qualification: artifactReferenceSchema,
  }).strict(),
  policy: z.object({
    definition: actorPolicySchema,
    policyId: z.literal("reviewer-platform-actor-eligibility-v1"),
    schemaVersion: z.literal(1),
    sha256: sha256Schema,
  }).strict(),
  rule: z.object({
    actorSurface: z.literal(
      "all-non-null-whole-review-and-review-thread-comment-authors",
    ),
    captureOrder: z.literal(
      "normalized-login-code-unit-ascending",
    ),
    normalization: z.literal("case-insensitive-login"),
  }).strict(),
  schemaVersion: z.literal(1),
  targets: z.array(targetSchema).min(1),
}).strict();
const planDispatchSchema = z.object({
  artifactKind: z.literal("c6-reviewer-actor-identity-plan"),
  inputs: z.record(z.string(), z.unknown()),
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
}).passthrough();
const actorSchema = z.object({
  login: z.string().min(1),
  type: z.string().min(1),
}).passthrough();
const notFoundSchema = z.object({
  documentation_url: z.url().optional(),
  message: z.string().min(1),
  status: z.union([z.string(), z.number()]).optional(),
}).strict();

type CaptureTarget = z.infer<typeof targetSchema>;

interface CapturePlanCommon {
  counts: {
    sourceReviewReferenceCount: number;
    sourceTargetCount: number;
    uniqueActorCount: number;
  };
  independenceBoundary: {
    targetProjectionSha256: string;
  };
  targets: CaptureTarget[];
}

interface C6ReviewerActorIdentityCapturePlanV1
  extends CapturePlanCommon {
  schemaVersion: 1;
  policy: {
    bound: true;
    definition: unknown;
    policyId: typeof C6_REVIEWER_ACTOR_POLICY_V1.policyId;
    schemaVersion: 1;
    sha256: string;
  };
  inputs: {
    graphqlRootSha256: string;
    qualificationSha256: string;
    structuralUnionSha256?: never;
  };
}

interface C6ReviewerActorIdentityCapturePlanV2
  extends CapturePlanCommon {
  schemaVersion: 2;
  policy: {
    bound: false;
    definition?: never;
    policyId?: never;
    schemaVersion?: never;
    sha256?: never;
  };
  inputs: {
    graphqlRootSha256?: never;
    qualificationSha256?: never;
    structuralUnionSha256: string;
  };
}

export type C6ReviewerActorIdentityCapturePlan =
  | C6ReviewerActorIdentityCapturePlanV1
  | C6ReviewerActorIdentityCapturePlanV2;

interface ArtifactReference {
  bytes: number;
  path: string;
  sha256: string;
}

type TransportFailurePhase = "body-read" | "fetch" | "timeout";

type TransportResult =
  | {
    response: Response;
    responseBytes: Buffer;
    success: true;
  }
  | {
    error: unknown;
    phase: TransportFailurePhase;
    response: Response | null;
    success: false;
  };

interface AttemptRecord {
  attempt: number;
  request: ArtifactReference;
  response?: ArtifactReference & {
    httpStatus: number;
    redirected: boolean;
    responseUrl: string;
  };
  responseHeaders?: ArtifactReference;
  retryAfterMilliseconds?: number;
  transportError?: ArtifactReference & {
    phase: TransportFailurePhase;
  };
}

interface RawActorCapture {
  captureDirectory: string;
  captureOrder: number;
  finalAttempt: number;
  login: string;
  networkAttemptCount: number;
  platformType: string | null;
  responseLogin: string | null;
  status: 200 | 404;
}

interface ClassifiedActorCapture extends RawActorCapture {
  eligible: boolean;
  reason: C6ReviewerActorReason;
}

type ActorCapture = ClassifiedActorCapture | RawActorCapture;

interface CaptureRuntime {
  authorizationToken: string;
  fetchImpl: C6ReviewerActorIdentityFetch;
  ledger: OwnedTreeLedger;
  plan: C6ReviewerActorIdentityCapturePlan;
  progress: (message: string) => void;
  requestTimeoutMilliseconds: number;
  sleep: (milliseconds: number) => Promise<void>;
  target: CaptureTarget;
  temporaryRoot: string;
}

interface C6ReviewerActorIdentityCaptureResultCommon {
  assetRootSha256: string;
  capturedTargetCount: number;
  captureAttemptCompletenessProven: true;
  networkAttemptCount: number;
  outputRoot: string;
}

interface C6ReviewerActorIdentityCaptureResultV1
  extends C6ReviewerActorIdentityCaptureResultCommon {
  actorEligibilityDecisionApplied?: never;
  eligibleActorCount: number;
}

interface C6ReviewerActorIdentityCaptureResultV2
  extends C6ReviewerActorIdentityCaptureResultCommon {
  actorEligibilityDecisionApplied: false;
  eligibleActorCount?: never;
}

export type C6ReviewerActorIdentityCaptureResult =
  | C6ReviewerActorIdentityCaptureResultV1
  | C6ReviewerActorIdentityCaptureResultV2;

export type C6ReviewerActorIdentityFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

interface C6ReviewerActorIdentityCapturePaths {
  outputRoot: string;
  temporaryRoot: string;
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

export interface C6ReviewerActorIdentityCaptureInput {
  authorizationToken: string;
  expectedPlanSha256: string;
  fetchImpl?: C6ReviewerActorIdentityFetch;
  outputRoot: string;
  planPath: string;
  progress?: (message: string) => void;
  requestTimeoutMilliseconds?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  testHooks?: {
    afterOutputPublication?: (
      paths: C6ReviewerActorIdentityCapturePaths,
    ) => Promise<void> | void;
    afterOutputRootCreation?: (
      paths: C6ReviewerActorIdentityCapturePaths,
    ) => Promise<void> | void;
  };
}

export async function captureC6ReviewerActorIdentities(
  input: C6ReviewerActorIdentityCaptureInput,
): Promise<C6ReviewerActorIdentityCaptureResult> {
  try {
    return await captureC6ReviewerActorIdentitiesUnsafe(input);
  } catch (error) {
    throw new Error(
      sanitizedError(error, input.authorizationToken),
    );
  }
}

async function captureC6ReviewerActorIdentitiesUnsafe(
  input: C6ReviewerActorIdentityCaptureInput,
): Promise<C6ReviewerActorIdentityCaptureResult> {
  const expectedPlanSha256 = sha256Schema.parse(
    input.expectedPlanSha256,
  );
  const requestTimeoutMilliseconds = parseRequestTimeout(
    input.requestTimeoutMilliseconds,
  );
  if (
    input.authorizationToken.length === 0 ||
    input.authorizationToken.trim() !== input.authorizationToken
  ) {
    throw new Error(
      "C6 reviewer actor authorization token is invalid",
    );
  }
  const planPath = await assertC6NoSymlinkPathComponents(
    input.planPath,
    "C6 reviewer actor capture plan",
  );
  const planBytes = await readC6StableRegularFile(
    planPath,
    "reviewer actor capture plan",
  );
  if (sha256(planBytes) !== expectedPlanSha256) {
    throw new Error("C6 reviewer actor capture plan hash mismatch");
  }
  const plan = parseC6ReviewerActorIdentityCapturePlan(planBytes);

  const outputRoot = resolve(input.outputRoot);
  await assertC6NoSymlinkPathComponents(
    dirname(outputRoot),
    "C6 reviewer actor capture output parent",
  );
  await assertOutputRootMissing(outputRoot);
  const temporaryRoot = `${outputRoot}.incomplete-${randomUUID()}`;
  const fetchImpl: C6ReviewerActorIdentityFetch =
    input.fetchImpl ?? ((request, init) => fetch(request, init));
  const progress = input.progress ??
    ((message: string) => process.stderr.write(`${message}\n`));
  const sleep = input.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolveSleep) => {
        setTimeout(resolveSleep, milliseconds);
      }));
  let temporaryOwnership: OwnedTreeLedger | null = null;
  let outputOwnership: OwnedTreeLedger | null = null;
  try {
    await mkdir(temporaryRoot, { mode: DIRECTORY_MODE });
    const temporaryLedger =
      await createOwnedTreeLedger(temporaryRoot);
    temporaryOwnership = temporaryLedger;
    const captures: ActorCapture[] = [];
    for (const target of plan.targets) {
      await assertPlanUnchanged({
        expectedPlanSha256,
        planBytes,
        planPath,
      });
      captures.push(await captureActorTarget({
        authorizationToken: input.authorizationToken,
        fetchImpl,
        ledger: temporaryLedger,
        plan,
        progress,
        requestTimeoutMilliseconds,
        sleep,
        target,
        temporaryRoot,
      }));
    }
    await assertPlanUnchanged({
      expectedPlanSha256,
      planBytes,
      planPath,
    });
    const capturedTargetCount = captures.length;
    const eligibleActorCount = captures.filter(
      (capture) =>
        isClassifiedActorCapture(capture) && capture.eligible,
    ).length;
    const ineligibleActorCount = captures.filter(
      (capture) =>
        isClassifiedActorCapture(capture) && !capture.eligible,
    ).length;
    const networkAttemptCount = captures.reduce(
      (sum, capture) => sum + capture.networkAttemptCount,
      0,
    );
    const resolvedActorCount = captures.filter(
      (capture) => capture.status === 200,
    ).length;
    const retryCount = captures.reduce(
      (sum, capture) =>
        sum + capture.networkAttemptCount - 1,
      0,
    );
    const unresolvedActorCount = captures.filter(
      (capture) => capture.status === 404,
    ).length;
    const counts = plan.schemaVersion === 1
      ? {
        capturedTargetCount,
        eligibleActorCount,
        ineligibleActorCount,
        networkAttemptCount,
        plannedTargetCount: plan.targets.length,
        resolvedActorCount,
        retryCount,
        unresolvedActorCount,
      }
      : {
        capturedTargetCount,
        networkAttemptCount,
        plannedTargetCount: plan.targets.length,
        resolvedActorCount,
        retryCount,
        unresolvedActorCount,
      };
    const captureRoot = plan.schemaVersion === 1
      ? {
        artifactKind: "c6-reviewer-actor-identity-capture-root",
        boundary: {
          captureAttemptCompletenessProven: true,
          cryptographicPlatformReceipt: false,
          eventTimeActorTypeProven: false,
          humanReviewerIdentityProven: false,
          transportAttemptCompletenessProven: true,
        },
        captures,
        counts,
        plan: {
          bytes: planBytes.byteLength,
          path: basename(planPath),
          sha256: expectedPlanSha256,
          targetProjectionSha256:
            plan.independenceBoundary.targetProjectionSha256,
        },
        policy: {
          policyId: plan.policy.policyId,
          sha256: plan.policy.sha256,
        },
        schemaVersion: 2,
      }
      : {
        artifactKind: "c6-reviewer-actor-identity-capture-root",
        boundary: {
          acceptedEpisodeCount: 0,
          actorEligibilityDecisionApplied: false,
          captureAttemptCompletenessProven: true,
          cryptographicPlatformReceipt: false,
          eventTimeActorTypeProven: false,
          humanReviewerIdentityProven: false,
          selectionExecuted: false,
          transportAttemptCompletenessProven: true,
        },
        captures,
        counts,
        plan: {
          bytes: planBytes.byteLength,
          path: basename(planPath),
          schemaVersion: plan.schemaVersion,
          sha256: expectedPlanSha256,
          targetProjectionSha256:
            plan.independenceBoundary.targetProjectionSha256,
        },
        schemaVersion: 3,
      };
    const captureRootBytes = Buffer.from(
      `${JSON.stringify(captureRoot, null, 2)}\n`,
    );
    assertTokenAbsent(
      captureRootBytes,
      input.authorizationToken,
      "capture root manifest",
    );
    await writeFile(
      join(temporaryRoot, "capture.json"),
      captureRootBytes,
      { flag: "wx", mode: FILE_MODE },
    );
    await recordOwnedPath({
      absolutePath: join(temporaryRoot, "capture.json"),
      kind: "file",
      ledger: temporaryLedger,
      relativePath: "capture.json",
    });
    const prepublicationLock = await buildC6AssetLock(temporaryRoot);
    await verifyExactCaptureTree(
      temporaryRoot,
      prepublicationLock,
    );
    await assertOwnedTreeIdentity(
      temporaryRoot,
      temporaryLedger,
      prepublicationLock,
    );
    await assertC6NoSymlinkPathComponents(
      dirname(outputRoot),
      "C6 reviewer actor capture output parent",
    );
    await assertOutputRootMissing(outputRoot);
    try {
      await mkdir(outputRoot, { mode: DIRECTORY_MODE });
    } catch (error) {
      if (isErrorCode(error, "EEXIST")) {
        throw new Error(
          "C6 reviewer actor capture output root already exists",
        );
      }
      throw error;
    }
    const outputLedger = await createOwnedTreeLedger(outputRoot);
    outputOwnership = outputLedger;
    const hookPaths = { outputRoot, temporaryRoot };
    await input.testHooks?.afterOutputRootCreation?.(hookPaths);
    const entries = await readdir(temporaryRoot);
    entries.sort((left, right) => {
      if (left === "capture.json") {
        return 1;
      }
      if (right === "capture.json") {
        return -1;
      }
      return compareStrings(left, right);
    });
    for (const entry of entries) {
      await publishNoReplace(
        join(temporaryRoot, entry),
        join(outputRoot, entry),
        entry,
        temporaryLedger,
        outputRoot,
        outputLedger,
      );
    }
    await input.testHooks?.afterOutputPublication?.(hookPaths);
    await assertPlanUnchanged({
      expectedPlanSha256,
      planBytes,
      planPath,
    });
    const terminalTemporaryLock =
      await verifyExactCaptureTree(
        temporaryRoot,
        prepublicationLock,
      );
    await assertOwnedTreeIdentity(
      temporaryRoot,
      temporaryLedger,
      prepublicationLock,
    );
    const publishedLock = await verifyExactCaptureTree(
      outputRoot,
      prepublicationLock,
    );
    await assertOwnedTreeIdentity(
      outputRoot,
      outputLedger,
      prepublicationLock,
    );
    if (
      serializeC6AssetLock(terminalTemporaryLock) !==
        serializeC6AssetLock(publishedLock)
    ) {
      throw new Error(
        "C6 reviewer actor published asset closure mismatch",
      );
    }
    await assertPlanUnchanged({
      expectedPlanSha256,
      planBytes,
      planPath,
    });
    await assertOwnedTreeIdentity(
      temporaryRoot,
      temporaryLedger,
      prepublicationLock,
    );
    await assertOwnedTreeIdentity(
      outputRoot,
      outputLedger,
      prepublicationLock,
    );
    if (!await removeOwnedTree(temporaryRoot, temporaryLedger)) {
      throw new Error(
        "C6 reviewer actor temporary ownership cleanup mismatch",
      );
    }
    if (plan.schemaVersion === 1) {
      return {
        assetRootSha256: publishedLock.assetRootSha256,
        capturedTargetCount: captures.length,
        captureAttemptCompletenessProven: true,
        eligibleActorCount,
        networkAttemptCount: counts.networkAttemptCount,
        outputRoot,
      };
    }
    return {
      actorEligibilityDecisionApplied: false,
      assetRootSha256: publishedLock.assetRootSha256,
      capturedTargetCount: captures.length,
      captureAttemptCompletenessProven: true,
      networkAttemptCount: counts.networkAttemptCount,
      outputRoot,
    };
  } catch (error) {
    if (outputOwnership !== null) {
      await removeOwnedTree(outputRoot, outputOwnership);
    }
    if (temporaryOwnership !== null) {
      await removeOwnedTree(temporaryRoot, temporaryOwnership);
    }
    throw new Error(sanitizedError(error, input.authorizationToken));
  }
}

async function captureActorTarget(
  input: CaptureRuntime,
): Promise<ActorCapture> {
  const { target } = input;
  assertSafeComponent(target.captureDirectory);
  const targetRoot = join(
    input.temporaryRoot,
    target.captureDirectory,
  );
  await createOwnedDirectory({
    absolutePath: targetRoot,
    ledger: input.ledger,
    relativePath: target.captureDirectory,
  });
  const attempts: AttemptRecord[] = [];
  const url =
    `https://api.github.com/users/${encodeURIComponent(target.login)}`;

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt += 1) {
    const attemptName =
      `attempt-${String(attempt).padStart(2, "0")}`;
    const attemptRelativePath =
      `${target.captureDirectory}/${attemptName}`;
    const attemptRoot = join(targetRoot, attemptName);
    await createOwnedDirectory({
      absolutePath: attemptRoot,
      ledger: input.ledger,
      relativePath: attemptRelativePath,
    });
    const request = {
      attempt,
      headers: {
        accept: "application/vnd.github+json",
        apiVersion: "2022-11-28",
        authorization: "Bearer <redacted>",
        userAgent: "GoodMemory-C6-Reviewer-Actor-Identity",
      },
      method: "GET",
      requestTimeoutMilliseconds:
        input.requestTimeoutMilliseconds,
      url,
    };
    const requestBytes = canonicalBytes(request);
    assertTokenAbsent(
      requestBytes,
      input.authorizationToken,
      "request receipt",
    );
    await writeOwnedFile({
      absolutePath: join(attemptRoot, "request.json"),
      bytes: requestBytes,
      ledger: input.ledger,
      relativePath: `${attemptRelativePath}/request.json`,
    });
    const attemptRecord: AttemptRecord = {
      attempt,
      request: artifactReference(
        `${attemptName}/request.json`,
        requestBytes,
      ),
    };
    attempts.push(attemptRecord);

    const transport = await executeTransportAttempt({
      authorizationToken: input.authorizationToken,
      fetchImpl: input.fetchImpl,
      requestTimeoutMilliseconds:
        input.requestTimeoutMilliseconds,
      url,
    });
    const responseHeaders = transport.success
      ? selectResponseHeaders(transport.response.headers)
      : transport.response === null
      ? {}
      : selectResponseHeaders(transport.response.headers);
    const responseHeaderBytes = canonicalBytes(responseHeaders);
    assertTokenAbsent(
      responseHeaderBytes,
      input.authorizationToken,
      "response headers",
    );
    await writeOwnedFile({
      absolutePath: join(
        attemptRoot,
        "response-headers.json",
      ),
      bytes: responseHeaderBytes,
      ledger: input.ledger,
      relativePath:
        `${attemptRelativePath}/response-headers.json`,
    });
    attemptRecord.responseHeaders = artifactReference(
      `${attemptName}/response-headers.json`,
      responseHeaderBytes,
    );

    if (!transport.success) {
      const retryScheduled =
        attempt <= MAX_RETRIES &&
        isTransientTransportError(
          transport.error,
          transport.phase,
        );
      const transportErrorBytes = canonicalBytes({
        artifactKind:
          "c6-reviewer-actor-identity-transport-error",
        httpStatus: transport.response?.status ?? null,
        message: sanitizedError(
          transport.error,
          input.authorizationToken,
        ),
        phase: transport.phase,
        retryScheduled,
        schemaVersion: 1,
        transientTransportCode:
          recognizedTransientTransportCode(transport.error),
        transientTransportFailure:
          isTransientTransportError(
            transport.error,
            transport.phase,
          ),
      });
      assertTokenAbsent(
        transportErrorBytes,
        input.authorizationToken,
        "transport error",
      );
      await writeOwnedFile({
        absolutePath: join(
          attemptRoot,
          "transport-error.json",
        ),
        bytes: transportErrorBytes,
        ledger: input.ledger,
        relativePath:
          `${attemptRelativePath}/transport-error.json`,
      });
      attemptRecord.transportError = {
        ...artifactReference(
          `${attemptName}/transport-error.json`,
          transportErrorBytes,
        ),
        phase: transport.phase,
      };
      if (retryScheduled) {
        const retryAfterMilliseconds = retryDelay(
          responseHeaders["retry-after"],
          responseHeaders.date,
          attempt,
        );
        attemptRecord.retryAfterMilliseconds =
          retryAfterMilliseconds;
        input.progress(
          progressLine(
            target,
            attempt,
            `transport=${transport.phase}`,
            retryAfterMilliseconds,
          ),
        );
        await input.sleep(retryAfterMilliseconds);
        continue;
      }
      throw new Error(
        `C6 reviewer actor capture transport ${
          transport.phase
        } failed for ${target.login}: ${
          sanitizedError(
            transport.error,
            input.authorizationToken,
          )
        }`,
      );
    }

    const { response, responseBytes } = transport;
    assertTokenAbsent(
      responseBytes,
      input.authorizationToken,
      "actor response",
    );
    await writeOwnedFile({
      absolutePath: join(attemptRoot, "response.json"),
      bytes: responseBytes,
      ledger: input.ledger,
      relativePath: `${attemptRelativePath}/response.json`,
    });
    attemptRecord.response = {
      ...artifactReference(
        `${attemptName}/response.json`,
        responseBytes,
      ),
      httpStatus: response.status,
      redirected: response.redirected,
      responseUrl: response.url,
    };
    validateResponseIdentity(response, url);

    if (
      RETRYABLE_STATUS.has(response.status) &&
      attempt <= MAX_RETRIES
    ) {
      const retryAfterMilliseconds = retryDelay(
        responseHeaders["retry-after"],
        responseHeaders.date,
        attempt,
      );
      attemptRecord.retryAfterMilliseconds =
        retryAfterMilliseconds;
      input.progress(
        progressLine(
          target,
          attempt,
          `status=${response.status}`,
          retryAfterMilliseconds,
        ),
      );
      await input.sleep(retryAfterMilliseconds);
      continue;
    }
    if (response.status !== 200 && response.status !== 404) {
      throw new Error(
        "C6 reviewer actor capture unexpected HTTP status " +
          `${response.status} for ${target.login}`,
      );
    }
    validateSuccessHeaders(responseHeaders);
    const actor = response.status === 200
      ? actorSchema.parse(
        parseJson(responseBytes, "actor response"),
      )
      : null;
    if (response.status === 404) {
      notFoundSchema.parse(
        parseJson(responseBytes, "unresolved actor response"),
      );
    }
    const status = response.status as 200 | 404;
    const platformType = actor?.type ?? null;
    const responseLogin = actor?.login ?? null;
    let capture: ActorCapture;
    let progressOutcome: string;
    let manifest: unknown;
    if (input.plan.schemaVersion === 1) {
      const classification = classifyC6ReviewerActor({
        plannedLogin: target.login,
        platformType,
        responseLogin,
        status,
      });
      capture = {
        captureDirectory: target.captureDirectory,
        captureOrder: target.captureOrder,
        eligible: classification.eligible,
        finalAttempt: attempt,
        login: target.login,
        networkAttemptCount: attempts.length,
        platformType,
        reason: classification.reason,
        responseLogin,
        status,
      };
      progressOutcome = `eligible=${classification.eligible}`;
      manifest = {
        artifactKind: "c6-reviewer-actor-identity-capture",
        attempts,
        boundary: {
          cryptographicPlatformReceipt: false,
          eventTimeActorTypeProven: false,
          humanReviewerIdentityProven: false,
          transportAttemptCompletenessProven: true,
        },
        capture,
        policy: {
          policyId: input.plan.policy.policyId,
          sha256: input.plan.policy.sha256,
        },
        schemaVersion: 2,
      };
    } else {
      assertPolicyNeutralResponseIdentity({
        plannedLogin: target.login,
        responseLogin,
        status,
      });
      capture = {
        captureDirectory: target.captureDirectory,
        captureOrder: target.captureOrder,
        finalAttempt: attempt,
        login: target.login,
        networkAttemptCount: attempts.length,
        platformType,
        responseLogin,
        status,
      };
      progressOutcome = "actorEligibilityDecisionApplied=false";
      manifest = {
        artifactKind: "c6-reviewer-actor-identity-capture",
        attempts,
        boundary: {
          acceptedEpisodeCount: 0,
          actorEligibilityDecisionApplied: false,
          cryptographicPlatformReceipt: false,
          eventTimeActorTypeProven: false,
          humanReviewerIdentityProven: false,
          selectionExecuted: false,
          transportAttemptCompletenessProven: true,
        },
        capture,
        schemaVersion: 3,
      };
    }
    const manifestBytes = canonicalBytes(manifest);
    assertTokenAbsent(
      manifestBytes,
      input.authorizationToken,
      "capture manifest",
    );
    await writeOwnedFile({
      absolutePath: join(targetRoot, "manifest.json"),
      bytes: manifestBytes,
      ledger: input.ledger,
      relativePath:
        `${target.captureDirectory}/manifest.json`,
    });
    input.progress(
      `C6 reviewer actor ${target.captureOrder} ` +
        `login=${target.login} attempt=${attempt} ` +
        `status=${status} ${progressOutcome}`,
    );
    return capture;
  }
  throw new Error(
    `C6 reviewer actor capture retry loop exhausted ${target.login}`,
  );
}

export function parseC6ReviewerActorIdentityCapturePlan(
  input: string | Uint8Array,
): C6ReviewerActorIdentityCapturePlan {
  const bytes = typeof input === "string"
    ? Buffer.from(input)
    : Buffer.from(input);
  const raw = canonicalJson(bytes, "plan");
  const dispatch = planDispatchSchema.parse(raw);
  const inputKeys = Object.keys(dispatch.inputs).sort(compareStrings);

  if (dispatch.schemaVersion === 1) {
    let parsed:
      | ReturnType<
        typeof parseC6LiveMultiLangNeighborActorPlan
      >
      | z.infer<typeof legacyPlanSchema>;
    if (
      equalStringArrays(inputKeys, [
        "graphqlRootSha256",
        "qualification",
      ])
    ) {
      parsed = legacyPlanSchema.parse(raw);
    } else if (
      equalStringArrays(inputKeys, [
        "deepCapturePlan",
        "deepEvidence",
        "graphqlRootSha256",
        "qualification",
      ])
    ) {
      parsed = parseC6LiveMultiLangNeighborActorPlan(bytes);
    } else {
      throw unsupportedPlanDispatchError();
    }
    const plan: C6ReviewerActorIdentityCapturePlanV1 = {
      counts: {
        sourceReviewReferenceCount:
          parsed.counts.sourceReviewReferenceCount,
        sourceTargetCount: parsed.counts.sourceTargetCount,
        uniqueActorCount: parsed.counts.uniqueActorCount,
      },
      independenceBoundary: {
        targetProjectionSha256:
          parsed.independenceBoundary.targetProjectionSha256,
      },
      inputs: {
        graphqlRootSha256: parsed.inputs.graphqlRootSha256,
        qualificationSha256: parsed.inputs.qualification.sha256,
      },
      policy: {
        bound: true,
        definition: parsed.policy.definition,
        policyId: parsed.policy.policyId,
        schemaVersion: parsed.policy.schemaVersion,
        sha256: parsed.policy.sha256,
      },
      schemaVersion: 1,
      targets: parsed.targets.map((target) =>
        targetSchema.parse(target)
      ),
    };
    if (
      plan.targets.length !== plan.counts.uniqueActorCount ||
      sha256(JSON.stringify(plan.targets)) !==
        plan.independenceBoundary.targetProjectionSha256 ||
      plan.policy.policyId !==
        C6_REVIEWER_ACTOR_POLICY_V1.policyId ||
      plan.policy.schemaVersion !==
        C6_REVIEWER_ACTOR_POLICY_V1.schemaVersion ||
      JSON.stringify(plan.policy.definition) !==
        JSON.stringify(C6_REVIEWER_ACTOR_POLICY_V1) ||
      plan.policy.sha256 !==
        sha256(serializeC6ReviewerActorPolicy())
    ) {
      throw new Error(
        "C6 reviewer actor capture plan projection mismatch",
      );
    }
    assertTargetOrder(plan.targets);
    return plan;
  }

  if (!equalStringArrays(inputKeys, ["structuralUnion"])) {
    throw unsupportedPlanDispatchError();
  }
  const parsed =
    parseC6LiveMultiLangNeighborActorPlanV2(bytes);
  const plan: C6ReviewerActorIdentityCapturePlanV2 = {
    counts: {
      sourceReviewReferenceCount:
        parsed.counts.sourceReviewReferenceCount,
      sourceTargetCount: parsed.counts.sourceTargetCount,
      uniqueActorCount: parsed.counts.uniqueActorCount,
    },
    independenceBoundary: {
      targetProjectionSha256:
        parsed.independenceBoundary.targetProjectionSha256,
    },
    inputs: {
      structuralUnionSha256:
        parsed.inputs.structuralUnion.sha256,
    },
    policy: {
      bound: false,
    },
    schemaVersion: 2,
    targets: parsed.targets.map((target) =>
      targetSchema.parse(target)
    ),
  };
  if (
    plan.targets.length !== 507 ||
    plan.targets.length !== plan.counts.uniqueActorCount ||
    sha256(JSON.stringify(plan.targets)) !==
      plan.independenceBoundary.targetProjectionSha256
  ) {
    throw new Error(
      "C6 reviewer actor capture plan projection mismatch",
    );
  }
  assertTargetOrder(plan.targets);
  return plan;
}

function equalStringArrays(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function unsupportedPlanDispatchError(): Error {
  return new Error(
    "C6 reviewer actor capture unsupported plan schemaVersion/inputs",
  );
}

function isClassifiedActorCapture(
  capture: ActorCapture,
): capture is ClassifiedActorCapture {
  return "eligible" in capture;
}

function assertPolicyNeutralResponseIdentity(input: {
  plannedLogin: string;
  responseLogin: string | null;
  status: 200 | 404;
}): void {
  if (input.status === 404) {
    if (input.responseLogin !== null) {
      throw new Error(
        "C6 reviewer actor unresolved response contains an identity",
      );
    }
    return;
  }
  if (
    input.responseLogin === null ||
    input.responseLogin.trim() !== input.responseLogin ||
    /[/\s]/u.test(input.responseLogin) ||
    input.responseLogin.toLowerCase() !== input.plannedLogin
  ) {
    throw new Error("C6 reviewer actor identity mismatch");
  }
}

function parseRequestTimeout(value: number | undefined): number {
  const timeout = value ?? DEFAULT_REQUEST_TIMEOUT_MILLISECONDS;
  if (
    !Number.isSafeInteger(timeout) ||
    timeout <= 0 ||
    timeout > MAX_REQUEST_TIMEOUT_MILLISECONDS
  ) {
    throw new Error(
      "C6 reviewer actor request timeout must be 1..300000 milliseconds",
    );
  }
  return timeout;
}

async function executeTransportAttempt(input: {
  authorizationToken: string;
  fetchImpl: C6ReviewerActorIdentityFetch;
  requestTimeoutMilliseconds: number;
  url: string;
}): Promise<TransportResult> {
  const controller = new AbortController();
  let phase: Exclude<TransportFailurePhase, "timeout"> = "fetch";
  let response: Response | null = null;
  let timedOut = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(requestTimeoutError());
    }, input.requestTimeoutMilliseconds);
  });
  try {
    response = await Promise.race([
      input.fetchImpl(input.url, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${input.authorizationToken}`,
          "User-Agent":
            "GoodMemory-C6-Reviewer-Actor-Identity",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        method: "GET",
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
    return {
      response,
      responseBytes,
      success: true,
    };
  } catch (error) {
    return {
      error,
      phase: timedOut || isRequestTimeoutError(error)
        ? "timeout"
        : phase,
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
): Record<string, string> {
  const selected: Record<string, string> = {};
  for (const name of SELECTED_RESPONSE_HEADERS) {
    const value = headers.get(name);
    if (value !== null) {
      selected[name] = value;
    }
  }
  return selected;
}

function validateSuccessHeaders(
  headers: Readonly<Record<string, string>>,
): void {
  for (const name of REQUIRED_SUCCESS_HEADERS) {
    if (headers[name] === undefined) {
      throw new Error(
        `C6 reviewer actor capture missing response header ${name}`,
      );
    }
  }
  if (
    !headers["content-type"]!.toLowerCase().startsWith(
      "application/json",
    ) ||
    !Number.isFinite(Date.parse(headers.date!)) ||
    headers["x-github-request-id"]!.trim().length === 0 ||
    headers["x-ratelimit-resource"] !== "core" ||
    !/^\d+$/u.test(headers["x-ratelimit-limit"]!) ||
    !/^\d+$/u.test(headers["x-ratelimit-remaining"]!) ||
    !/^\d+$/u.test(headers["x-ratelimit-reset"]!) ||
    !/^\d+$/u.test(headers["x-ratelimit-used"]!)
  ) {
    throw new Error(
      "C6 reviewer actor capture invalid response headers",
    );
  }
}

function validateResponseIdentity(
  response: Response,
  expectedUrl: string,
): void {
  if (response.url !== expectedUrl || response.redirected) {
    throw new Error(
      "C6 reviewer actor capture response URL or redirect mismatch",
    );
  }
}

function retryDelay(
  retryAfter: string | undefined,
  responseDate: string | undefined,
  retryNumber: number,
): number {
  const parsed = parseRetryAfter(retryAfter, responseDate);
  return parsed ?? Math.min(
    1_000 * 2 ** (retryNumber - 1),
    MAX_RETRY_AFTER_MILLISECONDS,
  );
}

function parseRetryAfter(
  value: string | undefined,
  responseDate: string | undefined,
): number | null {
  if (value === undefined) {
    return null;
  }
  if (/^\d+(?:\.\d+)?$/u.test(value)) {
    return boundRetryDelay(Math.ceil(Number(value) * 1_000));
  }
  const timestamp = Date.parse(value);
  const responseTimestamp = responseDate === undefined
    ? Number.NaN
    : Date.parse(responseDate);
  return Number.isFinite(timestamp) &&
      Number.isFinite(responseTimestamp)
    ? boundRetryDelay(timestamp - responseTimestamp)
    : null;
}

function boundRetryDelay(milliseconds: number): number {
  return Math.min(
    Math.max(0, milliseconds),
    MAX_RETRY_AFTER_MILLISECONDS,
  );
}

function isTransientTransportError(
  error: unknown,
  phase: TransportFailurePhase,
): boolean {
  if (phase === "timeout") {
    return true;
  }
  return recognizedTransientTransportCode(error) !== null;
}

function recognizedTransientTransportCode(
  error: unknown,
): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 3; depth += 1) {
    if (
      typeof current !== "object" ||
      current === null
    ) {
      return null;
    }
    if (
      "code" in current &&
      typeof current.code === "string" &&
      TRANSIENT_TRANSPORT_CODES.has(current.code)
    ) {
      return current.code;
    }
    current = "cause" in current ? current.cause : null;
  }
  return null;
}

function requestTimeoutError(): Error & { code: string } {
  return Object.assign(
    new Error("request timed out"),
    { code: "C6_REQUEST_TIMEOUT" },
  );
}

function isRequestTimeoutError(error: unknown): boolean {
  return isErrorCode(error, "C6_REQUEST_TIMEOUT");
}

function progressLine(
  target: z.infer<typeof targetSchema>,
  attempt: number,
  outcome: string,
  retryAfterMilliseconds: number,
): string {
  return `C6 reviewer actor ${target.captureOrder} ` +
    `login=${target.login} attempt=${attempt} ${outcome} ` +
    `retryAfterMs=${retryAfterMilliseconds}`;
}

function artifactReference(
  path: string,
  bytes: Buffer,
): ArtifactReference {
  return {
    bytes: bytes.byteLength,
    path,
    sha256: sha256(bytes),
  };
}

async function createOwnedDirectory(input: {
  absolutePath: string;
  ledger: OwnedTreeLedger;
  relativePath: string;
}): Promise<void> {
  await mkdir(input.absolutePath, { mode: DIRECTORY_MODE });
  await recordOwnedPath({
    ...input,
    kind: "directory",
  });
}

async function writeOwnedFile(input: {
  absolutePath: string;
  bytes: Buffer;
  ledger: OwnedTreeLedger;
  relativePath: string;
}): Promise<void> {
  await writeFile(input.absolutePath, input.bytes, {
    flag: "wx",
    mode: FILE_MODE,
  });
  await recordOwnedPath({
    absolutePath: input.absolutePath,
    kind: "file",
    ledger: input.ledger,
    relativePath: input.relativePath,
  });
}

function assertTargetOrder(
  targets: readonly z.infer<typeof targetSchema>[],
): void {
  const directories = new Set<string>();
  const logins = new Set<string>();
  for (const [index, target] of targets.entries()) {
    if (
      target.captureOrder !== index + 1 ||
      target.login !== target.login.toLowerCase() ||
      target.captureDirectory !== `actor-${sha256(target.login)}` ||
      directories.has(target.captureDirectory) ||
      logins.has(target.login)
    ) {
      throw new Error(
        "C6 reviewer actor capture target order is invalid",
      );
    }
    directories.add(target.captureDirectory);
    logins.add(target.login);
  }
}

function assertSafeComponent(value: string): void {
  if (
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\")
  ) {
    throw new Error(
      `C6 reviewer actor capture unsafe directory ${value}`,
    );
  }
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch {
    throw new Error(`C6 reviewer actor capture invalid ${label} JSON`);
  }
}

function canonicalJson(
  bytes: Uint8Array,
  label: string,
): unknown {
  const raw = parseJson(bytes, label);
  if (
    Buffer.from(bytes).toString("utf8") !==
      `${JSON.stringify(raw, null, 2)}\n`
  ) {
    throw new Error(
      `C6 reviewer actor capture noncanonical ${label} JSON`,
    );
  }
  return raw;
}

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

async function assertOutputRootMissing(outputRoot: string): Promise<void> {
  try {
    await lstat(outputRoot);
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) {
      return;
    }
    throw error;
  }
  throw new Error(
    "C6 reviewer actor capture output root already exists",
  );
}

async function assertPlanUnchanged(input: {
  expectedPlanSha256: string;
  planBytes: Buffer;
  planPath: string;
}): Promise<void> {
  const terminalPlanBytes = await readC6StableRegularFile(
    input.planPath,
    "reviewer actor terminal plan",
  );
  if (
    !terminalPlanBytes.equals(input.planBytes) ||
    sha256(terminalPlanBytes) !== input.expectedPlanSha256
  ) {
    throw new Error(
      "C6 reviewer actor capture plan changed during capture",
    );
  }
}

async function createOwnedTreeLedger(
  root: string,
): Promise<OwnedTreeLedger> {
  const rootIdentity = await readOwnedIdentity(
    root,
    "",
    "directory",
  );
  return {
    entries: new Map(),
    root: rootIdentity,
  };
}

async function recordOwnedPath(input: {
  absolutePath: string;
  kind: OwnedPathIdentity["kind"];
  ledger: OwnedTreeLedger;
  relativePath: string;
}): Promise<OwnedPathIdentity> {
  if (input.ledger.entries.has(input.relativePath)) {
    throw new Error(
      "C6 reviewer actor capture duplicate owned path " +
        input.relativePath,
    );
  }
  const identity = await readOwnedIdentity(
    input.absolutePath,
    input.relativePath,
    input.kind,
  );
  input.ledger.entries.set(input.relativePath, identity);
  return identity;
}

async function readOwnedIdentity(
  path: string,
  relativePath: string,
  kind: OwnedPathIdentity["kind"],
): Promise<OwnedPathIdentity> {
  const stat = await lstat(path);
  if (
    stat.isSymbolicLink() ||
    (kind === "directory"
      ? !stat.isDirectory()
      : !stat.isFile())
  ) {
    throw new Error(
      "C6 reviewer actor capture owned path identity mismatch " +
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
  expectedLock: C6AssetLock,
): Promise<void> {
  const expectedDirectories =
    expectedCaptureDirectories(expectedLock);
  if (
    ledger.entries.size !==
      expectedDirectories.size + expectedLock.files.length
  ) {
    throw new Error(
      "C6 reviewer actor capture ownership ledger mismatch",
    );
  }
  await assertOwnedPathIdentity(root, ledger.root);
  for (const directory of expectedDirectories) {
    const identity = ledger.entries.get(directory);
    if (identity?.kind !== "directory") {
      throw new Error(
        "C6 reviewer actor capture ownership ledger mismatch " +
          directory,
      );
    }
    await assertOwnedPathIdentity(
      joinRelative(root, directory),
      identity,
    );
  }
  for (const file of expectedLock.files) {
    const identity = ledger.entries.get(file.path);
    if (identity?.kind !== "file") {
      throw new Error(
        "C6 reviewer actor capture ownership ledger mismatch " +
          file.path,
      );
    }
    await assertOwnedPathIdentity(
      joinRelative(root, file.path),
      identity,
    );
  }
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
      "C6 reviewer actor capture owned path identity changed " +
        expected.relativePath,
    );
  }
}

async function verifyExactCaptureTree(
  root: string,
  expectedLock: C6AssetLock,
): Promise<C6AssetLock> {
  await assertC6NoSymlinkPathComponents(
    root,
    "C6 reviewer actor capture exact tree root",
  );
  const remainingDirectories =
    expectedCaptureDirectories(expectedLock);
  const remainingFiles = new Set(
    expectedLock.files.map((file) => file.path),
  );
  await assertDirectoryTreeModes(
    root,
    "",
    remainingDirectories,
    remainingFiles,
  );
  if (
    remainingDirectories.size > 0 ||
    remainingFiles.size > 0
  ) {
    const missing = [
      ...remainingDirectories,
      ...remainingFiles,
    ].sort(compareStrings)[0];
    throw new Error(
      "C6 reviewer actor capture exact tree missing " + missing,
    );
  }
  const currentLock = await buildC6AssetLock(root);
  if (
    currentLock.files.some((file) => file.mode !== FILE_MODE)
  ) {
    throw new Error(
      "C6 reviewer actor capture exact tree file mode mismatch",
    );
  }
  if (
    serializeC6AssetLock(currentLock) !==
      serializeC6AssetLock(expectedLock)
  ) {
    throw new Error(
      "C6 reviewer actor capture exact tree asset closure mismatch",
    );
  }
  return currentLock;
}

async function assertDirectoryTreeModes(
  root: string,
  relativeDirectory: string,
  remainingDirectories: Set<string>,
  remainingFiles: Set<string>,
): Promise<void> {
  const directory = joinRelative(root, relativeDirectory);
  const stat = await lstat(directory);
  if (
    stat.isSymbolicLink() ||
    !stat.isDirectory() ||
    (stat.mode & 0o7777) !== DIRECTORY_MODE
  ) {
    throw new Error(
      "C6 reviewer actor capture exact tree directory mode mismatch " +
        (relativeDirectory || "root"),
    );
  }
  for (
    const entry of await readdir(directory, {
      withFileTypes: true,
    })
  ) {
    const relativePath = relativeDirectory.length === 0
      ? entry.name
      : `${relativeDirectory}/${entry.name}`;
    const entryStat = await lstat(join(directory, entry.name));
    if (entryStat.isSymbolicLink()) {
      throw new Error(
        "C6 reviewer actor capture exact tree rejects symlink " +
          relativePath,
      );
    }
    if (entryStat.isDirectory()) {
      if (!remainingDirectories.delete(relativePath)) {
        throw new Error(
          "C6 reviewer actor capture exact tree unexpected directory " +
            relativePath,
        );
      }
      await assertDirectoryTreeModes(
        root,
        relativePath,
        remainingDirectories,
        remainingFiles,
      );
    } else if (!entryStat.isFile()) {
      throw new Error(
        "C6 reviewer actor capture exact tree rejects non-file " +
          relativePath,
      );
    } else if ((entryStat.mode & 0o7777) !== FILE_MODE) {
      throw new Error(
        "C6 reviewer actor capture exact tree file mode mismatch " +
          relativePath,
      );
    } else if (!remainingFiles.delete(relativePath)) {
      throw new Error(
        "C6 reviewer actor capture exact tree unexpected file " +
          relativePath,
      );
    }
  }
}

function expectedCaptureDirectories(
  lock: C6AssetLock,
): Set<string> {
  const directories = new Set<string>();
  for (const file of lock.files) {
    const components = file.path.split("/");
    for (
      let length = 1;
      length < components.length;
      length += 1
    ) {
      directories.add(components.slice(0, length).join("/"));
    }
  }
  return directories;
}

async function publishNoReplace(
  sourcePath: string,
  destinationPath: string,
  relativePath: string,
  sourceLedger: OwnedTreeLedger,
  destinationRoot: string,
  destinationLedger: OwnedTreeLedger,
): Promise<void> {
  const stat = await lstat(sourcePath);
  const sourceIdentity = sourceLedger.entries.get(relativePath);
  if (
    sourceIdentity === undefined ||
    stat.isSymbolicLink() ||
    stat.dev !== sourceIdentity.dev ||
    stat.ino !== sourceIdentity.ino
  ) {
    throw new Error(
      "C6 reviewer actor capture source ownership mismatch " +
        relativePath,
    );
  }
  if (stat.isDirectory()) {
    if (sourceIdentity.kind !== "directory") {
      throw new Error(
        "C6 reviewer actor capture source kind mismatch " +
          relativePath,
      );
    }
    await assertDestinationOwnership(
      destinationRoot,
      relativePath,
      destinationLedger,
      false,
    );
    await mkdir(destinationPath, { mode: DIRECTORY_MODE });
    await recordOwnedPath({
      absolutePath: destinationPath,
      kind: "directory",
      ledger: destinationLedger,
      relativePath,
    });
    await assertDestinationOwnership(
      destinationRoot,
      relativePath,
      destinationLedger,
      true,
    );
    for (const entry of (await readdir(sourcePath)).sort(compareStrings)) {
      await publishNoReplace(
        join(sourcePath, entry),
        join(destinationPath, entry),
        `${relativePath}/${entry}`,
        sourceLedger,
        destinationRoot,
        destinationLedger,
      );
    }
    return;
  }
  if (!stat.isFile() || sourceIdentity.kind !== "file") {
    throw new Error(
      `C6 reviewer actor capture refuses non-file ${sourcePath}`,
    );
  }
  await assertDestinationOwnership(
    destinationRoot,
    relativePath,
    destinationLedger,
    false,
  );
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
      "C6 reviewer actor capture hardlink ownership mismatch " +
        relativePath,
    );
  }
  if (destinationLedger.entries.has(relativePath)) {
    throw new Error(
      "C6 reviewer actor capture duplicate owned path " +
        relativePath,
    );
  }
  destinationLedger.entries.set(
    relativePath,
    destinationIdentity,
  );
  await assertDestinationOwnership(
    destinationRoot,
    relativePath,
    destinationLedger,
    true,
  );
}

async function assertDestinationOwnership(
  destinationRoot: string,
  relativePath: string,
  ledger: OwnedTreeLedger,
  includeLeaf: boolean,
): Promise<void> {
  await assertOwnedPathIdentity(destinationRoot, ledger.root);
  const components = relativePath.split("/");
  const upperBound = includeLeaf
    ? components.length
    : components.length - 1;
  for (let length = 1; length <= upperBound; length += 1) {
    const parentPath = components.slice(0, length).join("/");
    const identity = ledger.entries.get(parentPath);
    if (identity === undefined) {
      throw new Error(
        "C6 reviewer actor capture destination ownership ledger " +
          `mismatch ${parentPath}`,
      );
    }
    await assertOwnedPathIdentity(
      joinRelative(destinationRoot, parentPath),
      identity,
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
      return compareStrings(
        right.relativePath,
        left.relativePath,
      );
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
  for (
    let length = 1;
    length < components.length;
    length += 1
  ) {
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
      (identity.kind === "directory"
        ? stat.isDirectory()
        : stat.isFile()) &&
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
  return relativePath.length === 0
    ? root
    : join(root, ...relativePath.split("/"));
}

function assertTokenAbsent(
  bytes: Uint8Array,
  token: string,
  label: string,
): void {
  if (Buffer.from(bytes).includes(Buffer.from(token))) {
    throw new Error(
      `C6 reviewer actor authorization token appeared in ${label}`,
    );
  }
}

function sanitizedError(error: unknown, token: string): string {
  const message = error instanceof Error
    ? error.message
    : String(error);
  return token.length === 0
    ? message
    : message.split(token).join("[REDACTED]");
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
