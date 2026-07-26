import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
} from "node:fs/promises";
import {
  dirname,
  join,
  resolve,
} from "node:path";

import { z } from "zod";

import {
  assertC6NoSymlinkPathComponents,
  buildC6AssetLock,
  loadC6AssetLock,
  readC6StableRegularFile,
  serializeC6AssetLock,
  verifyC6AssetClosure,
} from "./c6-asset-lock";
import {
  parseC6SourceV3SimpleProtocol,
} from "./c6-source-v3-simple";
import {
  buildC6SourceV3SimplePriorRepositoryIdentityStructure,
  C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_STRUCTURE_PATH,
  serializeC6SourceV3SimplePriorRepositoryIdentityStructure,
  verifyC6SourceV3SimplePriorRepositoryIdentityStructure,
} from "./c6-source-v3-simple-prior-repository-identity-structure";
import {
  parseC6Wave3SourceUniverseV2,
} from "./c6-wave3-source-universe-v2";
import type {
  C6Wave3PriorRepositoryIdentityArtifactPlanContext,
  C6Wave3PriorRepositoryIdentityCaptureLookup,
} from "./c6-wave3-prior-repository-identity-artifacts";
import type {
  C6Wave3PriorRepositoryIdentityPlan,
} from "./c6-wave3-prior-repository-identity-plan";

const PROTOCOL_BYTES = 3_992;
const PROTOCOL_SHA256 =
  "5f989ab640c684dac287142edc9d2f9d8ee46099c082f63bb20f2a9546205132";
const PLAN_BYTES = 76_257;
const PLAN_SHA256 =
  "70b202cd6da6c2c504a0c23168dc9bcb6a73e9697ff98884dcc83ca785cd4ee2";
const SOURCE_UNIVERSE_BYTES = 631_004;
const SOURCE_UNIVERSE_SHA256 =
  "822c458e792ee31f7738cae2526b05dfc3b63fcaac58e3f4f87dcd3803ccdba1";
const ENDPOINT = "https://api.github.com/graphql" as const;
const REQUEST_TIMEOUT_MILLISECONDS = 60_000;
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const RETRYABLE_HTTP_STATUSES = new Set([
  429,
  502,
  503,
  504,
]);
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
const QUERY =
  "query C6Wave3PriorRepositoryIdentity(" +
  "$owner: String!, $name: String!) {\n" +
  "  repository(owner: $owner, name: $name, " +
  "followRenames: true) {\n" +
  "    id\n" +
  "    nameWithOwner\n" +
  "    url\n" +
  "  }\n" +
  "  rateLimit {\n" +
  "    cost\n" +
  "    limit\n" +
  "    remaining\n" +
  "    resetAt\n" +
  "    used\n" +
  "  }\n" +
  "}\n";
const REQUEST_HEADERS = {
  accept: "application/vnd.github+json",
  "content-type": "application/json",
  "user-agent":
    "GoodMemory-C6-Wave3-Prior-Repository-Identity/1",
  "x-github-api-version": "2022-11-28",
} as const;
const PRODUCTION_FETCH = globalThis.fetch.bind(globalThis);
const SELECTED_RESPONSE_HEADERS = [
  "date",
  "retry-after",
  "x-github-request-id",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
  "x-ratelimit-resource",
  "x-ratelimit-used",
] as const;

const responseEnvelopeSchema = z.object({
  data: z.object({
    rateLimit: z.object({
      cost: z.number().int().nonnegative(),
      limit: z.number().int().nonnegative(),
      remaining: z.number().int().nonnegative(),
      resetAt: z.string().min(1),
      used: z.number().int().nonnegative(),
    }).strict(),
    repository: z.object({
      id: z.string().min(1),
      nameWithOwner: z.string().regex(
        /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u,
      ),
      url: z.url(),
    }).strict(),
  }).strict(),
}).strict();

type CaptureAttempt =
  C6Wave3PriorRepositoryIdentityCaptureLookup["attempts"][number];
type CaptureTarget =
  C6Wave3PriorRepositoryIdentityPlan["targets"][number];
type SelectedResponseHeaders =
  CaptureAttempt["selectedResponseHeaders"];

interface ArtifactReference {
  bytes: number;
  path: string;
  sha256: string;
}

export type C6SourceV3SimplePriorRepositoryIdentityTransport = (
  request: Request,
) => Promise<Response>;

export interface C6SourceV3SimplePriorRepositoryIdentityDraftResult {
  formalCensusPermitted: false;
  lookups: C6Wave3PriorRepositoryIdentityCaptureLookup[];
  networkAttemptCount: number;
  outputRoot: string;
  sourceV3SimpleFrozen: false;
}

export interface C6SourceV3SimplePriorRepositoryIdentityBundleEvidence {
  candidateManifestFrozen: false;
  captureOriginIndependentlyVerified: false;
  codexRunReady: false;
  formalCensusPermitted: false;
  legacySourceV2CaptureAuthorized: false;
  networkAttemptCount: number;
  outputRoot: string;
  priorRepositoryNodeIdExclusionComplete: false;
  priorRepositoryNodeIdExclusionStructureVerified: true;
  sourceV3SimpleFrozen: false;
  structureSha256: string;
  uniqueNodeIdCount: number;
}

export async function captureC6SourceV3SimplePriorRepositoryIdentityDraftEvidence(
  input: {
    authorizationToken: string;
    outputRoot: string;
    planPath: string;
    progress?: (message: string) => void;
    protocolPath: string;
    sleep?: (milliseconds: number) => Promise<void>;
    sourceUniversePath: string;
    transport: C6SourceV3SimplePriorRepositoryIdentityTransport;
  },
): Promise<C6SourceV3SimplePriorRepositoryIdentityDraftResult> {
  const token = requiredToken(input.authorizationToken);
  const [planModule, protocolPath, sourceUniversePath] =
    await Promise.all([
      import("./c6-wave3-prior-repository-identity-plan"),
      assertC6NoSymlinkPathComponents(
        input.protocolPath,
        "C6 source-v3-simple protocol",
      ),
      assertC6NoSymlinkPathComponents(
        input.sourceUniversePath,
        "C6 source-v3-simple source universe",
      ),
    ]);
  const planPath = await assertC6NoSymlinkPathComponents(
    input.planPath,
    "C6 source-v3-simple prior identity plan",
  );
  const [planBytes, protocolBytes, sourceUniverseBytes] =
    await Promise.all([
      readC6StableRegularFile(
        planPath,
        "source-v3-simple prior identity plan",
      ),
      readC6StableRegularFile(
        protocolPath,
        "source-v3-simple protocol",
      ),
      readC6StableRegularFile(
        sourceUniversePath,
        "source-v3-simple source universe",
      ),
    ]);
  assertExactInput(
    planBytes,
    PLAN_BYTES,
    PLAN_SHA256,
    "prior identity plan",
  );
  assertExactInput(
    protocolBytes,
    PROTOCOL_BYTES,
    PROTOCOL_SHA256,
    "protocol",
  );
  assertExactInput(
    sourceUniverseBytes,
    SOURCE_UNIVERSE_BYTES,
    SOURCE_UNIVERSE_SHA256,
    "source universe",
  );
  const plan =
    planModule.parseC6Wave3PriorRepositoryIdentityPlan(
      planBytes,
    );
  const protocol =
    parseC6SourceV3SimpleProtocol(protocolBytes);
  parseC6Wave3SourceUniverseV2(sourceUniverseBytes);
  if (
    plan.captureProtocol.query !== QUERY ||
    plan.captureProtocol.querySha256 !== sha256(QUERY) ||
    plan.inputs.sourceUniverse.sha256 !==
      SOURCE_UNIVERSE_SHA256 ||
    protocol.sourceFrame.sourceV2.sha256 !==
      SOURCE_UNIVERSE_SHA256 ||
    protocol.boundary.formalCensusPermitted !== false ||
    protocol.boundary.sourceV3SimpleFrozen !== false
  ) {
    throw new Error(
      "C6 source-v3-simple prior identity input contract mismatch",
    );
  }

  const outputRoot = resolve(input.outputRoot);
  await assertC6NoSymlinkPathComponents(
    dirname(outputRoot),
    "C6 source-v3-simple prior identity output parent",
  );
  await assertOutputMissing(outputRoot);
  await mkdir(outputRoot, { mode: DIRECTORY_MODE });
  const outputRootIdentity = await directoryIdentity(
    outputRoot,
  );
  const sleep = input.sleep ?? sleepMilliseconds;
  const progress = input.progress ?? (() => undefined);
  try {
    const lookups:
      C6Wave3PriorRepositoryIdentityCaptureLookup[] = [];
    for (const pass of ["A", "B"] as const) {
      for (const target of plan.targets) {
        const lookupOrder = pass === "A"
          ? target.passALookupOrder
          : target.passBLookupOrder;
        const lookup = await captureLookup({
          lookupOrder,
          outputRoot,
          pass,
          sleep,
          target,
          token,
          transport: input.transport,
        });
        lookups.push(lookup);
        progress(
          "C6 source-v3-simple prior identity " +
            `lookup=${lookupOrder}/356 pass=${pass} ` +
            `repository=${target.requestedNameWithOwner} ` +
            `attempts=${lookup.attempts.length}`,
        );
      }
    }
    await assertTokenAbsentFromTree(outputRoot, token);
    const assetLock = await buildC6AssetLock(outputRoot);
    await writeExclusiveFile(
      join(outputRoot, "asset-lock.json"),
      Buffer.from(serializeC6AssetLock(assetLock)),
    );
    await assertTokenAbsentFromTree(outputRoot, token);
    const artifactModule = await import(
      "./c6-wave3-prior-repository-identity-artifacts"
    );
    const planContext:
      C6Wave3PriorRepositoryIdentityArtifactPlanContext = {
        serialized: planBytes.toString("utf8"),
        targets: plan.targets,
      };
    await artifactModule
      .verifyC6Wave3PriorRepositoryIdentityDraftEvidenceArtifact({
        assetRoot: outputRoot,
        lookups,
        plan: planContext,
        planPath,
        sourceUniversePath,
      });
    await assertInputsUnchanged({
      planBytes,
      planPath,
      protocolBytes,
      protocolPath,
      sourceUniverseBytes,
      sourceUniversePath,
    });
    await assertTokenAbsentFromTree(outputRoot, token);
    if (
      !await hasDirectoryIdentity(
        outputRoot,
        outputRootIdentity,
      )
    ) {
      throw new Error(
        "C6 source-v3-simple prior identity draft root changed during terminal verification",
      );
    }
    return {
      formalCensusPermitted: false,
      lookups,
      networkAttemptCount: lookups.reduce(
        (count, lookup) => count + lookup.attempts.length,
        0,
      ),
      outputRoot,
      sourceV3SimpleFrozen: false,
    };
  } catch (error) {
    throw new Error(
      `${sanitizeError(error, token)}; ` +
        "incomplete draft evidence was retained",
    );
  }
}

export async function captureC6SourceV3SimplePriorRepositoryIdentity(
  input: {
    authorizationToken: string;
    outputRoot: string;
    planPath: string;
    progress?: (message: string) => void;
    protocolPath: string;
    sourceUniversePath: string;
  },
): Promise<C6SourceV3SimplePriorRepositoryIdentityBundleEvidence> {
  const token = requiredToken(input.authorizationToken);
  const outputRoot = resolve(input.outputRoot);
  await assertC6NoSymlinkPathComponents(
    dirname(outputRoot),
    "C6 source-v3-simple prior identity formal output parent",
  );
  await assertOutputMissing(outputRoot);
  await mkdir(outputRoot, { mode: DIRECTORY_MODE });
  const outputRootIdentity = await directoryIdentity(outputRoot);
  const progress = input.progress ??
    ((message: string) =>
      process.stderr.write(`${message}\n`));
  try {
    const rawEvidenceRoot = join(
      outputRoot,
      "raw-evidence",
    );
    const draft =
      await captureC6SourceV3SimplePriorRepositoryIdentityDraftEvidence({
        authorizationToken: token,
        outputRoot: rawEvidenceRoot,
        planPath: input.planPath,
        progress,
        protocolPath: input.protocolPath,
        sourceUniversePath: input.sourceUniversePath,
        transport: async (request) => {
          const response = await PRODUCTION_FETCH(request);
          if (response.url !== ENDPOINT) {
            throw new Error(
              "C6 source-v3-simple prior identity production response URL mismatch",
            );
          }
          return response;
        },
      });
    progress(
      "C6 source-v3-simple prior identity raw evidence complete",
    );
    const frozen = await loadFrozenInputs({
      planPath: input.planPath,
      protocolPath: input.protocolPath,
      sourceUniversePath: input.sourceUniversePath,
    });
    const structure =
      await buildC6SourceV3SimplePriorRepositoryIdentityStructure({
        assetRoot: rawEvidenceRoot,
        lookups: draft.lookups,
        plan: frozen.plan,
        planPath: frozen.planPath,
        protocolPath: frozen.protocolPath,
        sourceUniversePath: frozen.sourceUniversePath,
      });
    progress(
      "C6 source-v3-simple prior identity structure verified",
    );
    await writeRootArtifact(
      join(
        outputRoot,
        C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_STRUCTURE_PATH,
      ),
      Buffer.from(
        serializeC6SourceV3SimplePriorRepositoryIdentityStructure(
          structure,
        ),
      ),
    );
    const outerAssetLock = await buildC6AssetLock(
      outputRoot,
    );
    await writeRootArtifact(
      join(outputRoot, "asset-lock.json"),
      Buffer.from(serializeC6AssetLock(outerAssetLock)),
    );
    if (
      !await hasDirectoryIdentity(
        outputRoot,
        outputRootIdentity,
      )
    ) {
      throw new Error(
        "C6 source-v3-simple prior identity output root changed before terminal verification",
      );
    }
    await assertTokenAbsentFromTree(outputRoot, token);
    const evidence =
      await verifyC6SourceV3SimplePriorRepositoryIdentityBundle({
        outputRoot,
        planPath: input.planPath,
        protocolPath: input.protocolPath,
        sourceUniversePath: input.sourceUniversePath,
      });
    await assertTokenAbsentFromTree(outputRoot, token);
    if (
      !await hasDirectoryIdentity(
        outputRoot,
        outputRootIdentity,
      )
    ) {
      throw new Error(
        "C6 source-v3-simple prior identity output root changed during terminal verification",
      );
    }
    progress(
      "C6 source-v3-simple prior identity structure-only bundle verified",
    );
    return evidence;
  } catch (error) {
    throw new Error(
      `${sanitizeError(error, token)}; ` +
        "incomplete structure-only output was retained",
    );
  }
}

export async function verifyC6SourceV3SimplePriorRepositoryIdentityBundle(
  input: {
    outputRoot: string;
    planPath: string;
    protocolPath: string;
    sourceUniversePath: string;
  },
): Promise<C6SourceV3SimplePriorRepositoryIdentityBundleEvidence> {
  const outputRoot = await assertC6NoSymlinkPathComponents(
    input.outputRoot,
    "C6 source-v3-simple prior identity bundle",
  );
  const frozen = await loadFrozenInputs(input);
  const rawEvidenceRoot = join(
    outputRoot,
    "raw-evidence",
  );
  const [outerAssetLock, rawAssetLock] =
    await Promise.all([
      loadC6AssetLock(outputRoot),
      loadC6AssetLock(rawEvidenceRoot),
    ]);
  assertExactOuterAssetClosure(
    outerAssetLock.assetLock.files.map(
      (entry) => entry.path,
    ),
    rawAssetLock.assetLock.files.map(
      (entry) => entry.path,
    ),
  );
  const structureBytes = await readC6StableRegularFile(
    join(
      outputRoot,
      C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_STRUCTURE_PATH,
    ),
    "source-v3-simple prior identity structure",
  );
  const structure =
    await verifyC6SourceV3SimplePriorRepositoryIdentityStructure(
      structureBytes,
      {
        assetRoot: rawEvidenceRoot,
        plan: frozen.plan,
        planPath: frozen.planPath,
        protocolPath: frozen.protocolPath,
        sourceUniversePath: frozen.sourceUniversePath,
      },
    );
  await Promise.all([
    verifyC6AssetClosure(outputRoot, outerAssetLock),
    verifyC6AssetClosure(rawEvidenceRoot, rawAssetLock),
    assertInputsUnchanged({
      planBytes: frozen.planBytes,
      planPath: frozen.planPath,
      protocolBytes: frozen.protocolBytes,
      protocolPath: frozen.protocolPath,
      sourceUniverseBytes: frozen.sourceUniverseBytes,
      sourceUniversePath: frozen.sourceUniversePath,
    }),
  ]);
  return {
    candidateManifestFrozen: false,
    captureOriginIndependentlyVerified: false,
    codexRunReady: false,
    formalCensusPermitted: false,
    legacySourceV2CaptureAuthorized: false,
    networkAttemptCount:
      structure.counts.networkAttemptCount,
    outputRoot,
    priorRepositoryNodeIdExclusionComplete: false,
    priorRepositoryNodeIdExclusionStructureVerified: true,
    sourceV3SimpleFrozen: false,
    structureSha256: sha256(structureBytes),
    uniqueNodeIdCount: structure.counts.uniqueNodeIdCount,
  };
}

async function captureLookup(input: {
  lookupOrder: number;
  outputRoot: string;
  pass: "A" | "B";
  sleep: (milliseconds: number) => Promise<void>;
  target: CaptureTarget;
  token: string;
  transport: C6SourceV3SimplePriorRepositoryIdentityTransport;
}): Promise<C6Wave3PriorRepositoryIdentityCaptureLookup> {
  const attempts: CaptureAttempt[] = [];
  for (let attemptNumber = 1; attemptNumber <= 4; attemptNumber += 1) {
    const attemptRoot =
      `lookup-${String(input.lookupOrder).padStart(4, "0")}/` +
      `attempt-${String(attemptNumber).padStart(2, "0")}`;
    await mkdir(join(input.outputRoot, attemptRoot), {
      mode: DIRECTORY_MODE,
      recursive: true,
    });
    const requestBodyBytes = Buffer.from(JSON.stringify({
      query: QUERY,
      variables: {
        name: input.target.requestedName,
        owner: input.target.requestedOwner,
      },
    }));
    const requestBody = await writeArtifact({
      bytes: requestBodyBytes,
      outputRoot: input.outputRoot,
      path: `${attemptRoot}/request-body.raw`,
    });
    const requestProjection:
      CaptureAttempt["requestProjection"] = {
      endpoint: ENDPOINT,
      headers: {
        accept: REQUEST_HEADERS.accept,
        authorization: "Bearer <redacted>",
        "content-type": REQUEST_HEADERS["content-type"],
        "user-agent": REQUEST_HEADERS["user-agent"],
        "x-github-api-version":
          REQUEST_HEADERS["x-github-api-version"],
      },
      lookupOrder: input.lookupOrder,
      method: "POST" as const,
      redirect: "error" as const,
      timeoutMilliseconds: REQUEST_TIMEOUT_MILLISECONDS,
      variables: {
        name: input.target.requestedName,
        owner: input.target.requestedOwner,
      },
    };
    const request = await writeArtifact({
      bytes: canonicalBytes({
        attempt: attemptNumber,
        body: requestBody,
        ...requestProjection,
      }),
      outputRoot: input.outputRoot,
      path: `${attemptRoot}/request.json`,
    });
    const response = await executeTransport({
      requestBodyBytes,
      token: input.token,
      transport: input.transport,
    });
    const selectedResponseHeaders = selectResponseHeaders(
      response.headers,
    );
    assertExternalResponseDoesNotContainToken({
      bodyBytes: response.bodyBytes,
      selectedResponseHeaders,
      token: input.token,
      transportErrorCode:
        response.transportError?.code ?? null,
    });
    const responseHeaders = await writeArtifact({
      bytes: canonicalBytes(selectedResponseHeaders),
      outputRoot: input.outputRoot,
      path: `${attemptRoot}/response-headers.json`,
    });
    if (response.transportError !== null) {
      const transient = response.transportError.code !== null &&
        TRANSIENT_TRANSPORT_CODES.has(
          response.transportError.code,
        );
      const retry = transient && attemptNumber < 4;
      const delayMilliseconds = retry
        ? retryDelay(
          selectedResponseHeaders["retry-after"],
          attemptNumber,
        )
        : null;
      const recorded = await recordAttempt({
        attemptNumber,
        httpResponseExists: response.response !== null,
        httpStatus: response.response?.status ?? null,
        lookupOrder: input.lookupOrder,
        outcome: transient
          ? "transient-transport-failure"
          : "terminal-transport-failure",
        outputRoot: input.outputRoot,
        request,
        requestBody,
        requestProjection,
        responseBody: null,
        responseBodyReadCompleted: false,
        responseHeaders,
        retryDecision: {
          decision: retry ? "retry" : "abort",
          delayMilliseconds,
          reason: retry
            ? "transient-transport-code"
            : (
              transient
                ? "maximum-attempts-exhausted"
                : "terminal-transport-error"
            ),
          retryAfter:
            selectedResponseHeaders["retry-after"],
        },
        root: attemptRoot,
        selectedResponseHeaders,
        transportError: {
          code: response.transportError.code,
          message: sanitizeError(
            response.transportError.error,
            input.token,
          ),
          phase: response.transportError.phase,
          transient,
        },
      });
      attempts.push(recorded);
      if (retry) {
        await input.sleep(delayMilliseconds!);
        continue;
      }
      throw new Error(
        "C6 source-v3-simple prior identity transport failed",
      );
    }

    const responseBody = await writeArtifact({
      bytes: response.bodyBytes!,
      outputRoot: input.outputRoot,
      path: `${attemptRoot}/response-body.raw`,
    });
    if (
      response.response !== null &&
      RETRYABLE_HTTP_STATUSES.has(response.response.status)
    ) {
      const retry = attemptNumber < 4;
      const delayMilliseconds = retry
        ? retryDelay(
          selectedResponseHeaders["retry-after"],
          attemptNumber,
        )
        : null;
      const recorded = await recordAttempt({
        attemptNumber,
        httpResponseExists: true,
        httpStatus: response.response.status,
        lookupOrder: input.lookupOrder,
        outcome: "retryable-http-status",
        outputRoot: input.outputRoot,
        request,
        requestBody,
        requestProjection,
        responseBody,
        responseBodyReadCompleted: true,
        responseHeaders,
        retryDecision: {
          decision: retry ? "retry" : "abort",
          delayMilliseconds,
          reason: retry
            ? `retryable-http-${response.response.status}` as
              "retryable-http-429" |
              "retryable-http-502" |
              "retryable-http-503" |
              "retryable-http-504"
            : "maximum-attempts-exhausted",
          retryAfter:
            selectedResponseHeaders["retry-after"],
        },
        root: attemptRoot,
        selectedResponseHeaders,
        transportError: null,
      });
      attempts.push(recorded);
      if (retry) {
        await input.sleep(delayMilliseconds!);
        continue;
      }
      throw new Error(
        "C6 source-v3-simple prior identity retry attempts exhausted",
      );
    }
    if (
      response.response === null ||
      response.response.status !== 200
    ) {
      await recordAttempt({
        attemptNumber,
        httpResponseExists: response.response !== null,
        httpStatus: response.response?.status ?? null,
        lookupOrder: input.lookupOrder,
        outcome: "terminal-http-status",
        outputRoot: input.outputRoot,
        request,
        requestBody,
        requestProjection,
        responseBody,
        responseBodyReadCompleted: true,
        responseHeaders,
        retryDecision: {
          decision: "abort",
          delayMilliseconds: null,
          reason: "nonretryable-http-status",
          retryAfter:
            selectedResponseHeaders["retry-after"],
        },
        root: attemptRoot,
        selectedResponseHeaders,
        transportError: null,
      });
      throw new Error(
        "C6 source-v3-simple prior identity nonretryable HTTP status",
      );
    }
    const parsed = parseSuccessResponse(response.bodyBytes!);
    if (
      SELECTED_RESPONSE_HEADERS.some(
        (name) =>
          name !== "retry-after" &&
          selectedResponseHeaders[name] === null,
      ) ||
      selectedResponseHeaders["retry-after"] !== null
    ) {
      await recordAttempt({
        attemptNumber,
        httpResponseExists: true,
        httpStatus: 200,
        lookupOrder: input.lookupOrder,
        outcome: "graphql-http-200-invalid",
        outputRoot: input.outputRoot,
        request,
        requestBody,
        requestProjection,
        responseBody,
        responseBodyReadCompleted: true,
        responseHeaders,
        retryDecision: {
          decision: "abort",
          delayMilliseconds: null,
          reason: "missing-required-success-header",
          retryAfter:
            selectedResponseHeaders["retry-after"],
        },
        root: attemptRoot,
        selectedResponseHeaders,
        transportError: null,
      });
      throw new Error(
        "C6 source-v3-simple prior identity success headers are incomplete",
      );
    }
    const recorded = await recordAttempt({
      attemptNumber,
      httpResponseExists: true,
      httpStatus: 200,
      lookupOrder: input.lookupOrder,
      outcome: "complete-graphql-http-200",
      outputRoot: input.outputRoot,
      request,
      requestBody,
      requestProjection,
      responseBody,
      responseBodyReadCompleted: true,
      responseHeaders,
      retryDecision: {
        decision: "stop-success",
        delayMilliseconds: null,
        reason: "complete-graphql-response",
        retryAfter: null,
      },
      root: attemptRoot,
      selectedResponseHeaders,
      transportError: null,
    });
    attempts.push(recorded);
    return {
      attempts,
      finalAttempt: attemptNumber,
      lookupOrder: input.lookupOrder,
      pass: input.pass,
      repositoryNodeId: parsed.repository.id,
      repositoryOrder: input.target.repositoryOrder,
      requestedName: input.target.requestedName,
      requestedNameWithOwner:
        input.target.requestedNameWithOwner,
      requestedOwner: input.target.requestedOwner,
      requestedRepositorySha256:
        input.target.requestedRepositorySha256,
      resolvedNameWithOwner:
        parsed.repository.nameWithOwner,
      resolvedUrl: parsed.repository.url,
      response: parsed,
      success: true,
    };
  }
  throw new Error(
    "C6 source-v3-simple prior identity attempts exhausted",
  );
}

async function loadFrozenInputs(input: {
  planPath: string;
  protocolPath: string;
  sourceUniversePath: string;
}): Promise<{
  plan: C6Wave3PriorRepositoryIdentityPlan;
  planBytes: Buffer;
  planPath: string;
  protocolBytes: Buffer;
  protocolPath: string;
  sourceUniverseBytes: Buffer;
  sourceUniversePath: string;
}> {
  const [planPath, protocolPath, sourceUniversePath] =
    await Promise.all([
      assertC6NoSymlinkPathComponents(
        input.planPath,
        "C6 source-v3-simple prior identity plan",
      ),
      assertC6NoSymlinkPathComponents(
        input.protocolPath,
        "C6 source-v3-simple prior identity protocol",
      ),
      assertC6NoSymlinkPathComponents(
        input.sourceUniversePath,
        "C6 source-v3-simple prior identity source universe",
      ),
    ]);
  const [planBytes, protocolBytes, sourceUniverseBytes] =
    await Promise.all([
      readC6StableRegularFile(
        planPath,
        "source-v3-simple prior identity plan",
      ),
      readC6StableRegularFile(
        protocolPath,
        "source-v3-simple prior identity protocol",
      ),
      readC6StableRegularFile(
        sourceUniversePath,
        "source-v3-simple prior identity source universe",
      ),
    ]);
  assertExactInput(
    planBytes,
    PLAN_BYTES,
    PLAN_SHA256,
    "prior identity plan",
  );
  assertExactInput(
    protocolBytes,
    PROTOCOL_BYTES,
    PROTOCOL_SHA256,
    "protocol",
  );
  assertExactInput(
    sourceUniverseBytes,
    SOURCE_UNIVERSE_BYTES,
    SOURCE_UNIVERSE_SHA256,
    "source universe",
  );
  const planModule = await import(
    "./c6-wave3-prior-repository-identity-plan"
  );
  const plan =
    planModule.parseC6Wave3PriorRepositoryIdentityPlan(
      planBytes,
    );
  const protocol =
    parseC6SourceV3SimpleProtocol(protocolBytes);
  parseC6Wave3SourceUniverseV2(sourceUniverseBytes);
  if (
    plan.captureProtocol.query !== QUERY ||
    plan.captureProtocol.querySha256 !== sha256(QUERY) ||
    plan.inputs.sourceUniverse.sha256 !==
      SOURCE_UNIVERSE_SHA256 ||
    protocol.sourceFrame.sourceV2.sha256 !==
      SOURCE_UNIVERSE_SHA256 ||
    protocol.boundary.formalCensusPermitted !== false
  ) {
    throw new Error(
      "C6 source-v3-simple prior identity frozen input mismatch",
    );
  }
  return {
    plan,
    planBytes,
    planPath,
    protocolBytes,
    protocolPath,
    sourceUniverseBytes,
    sourceUniversePath,
  };
}

function assertExactOuterAssetClosure(
  outerPaths: readonly string[],
  rawPaths: readonly string[],
): void {
  const expected = [
    C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_STRUCTURE_PATH,
    "raw-evidence/asset-lock.json",
    ...rawPaths.map((path) => `raw-evidence/${path}`),
  ].sort();
  const actual = [...outerPaths].sort();
  if (
    new Set(actual).size !== actual.length ||
    JSON.stringify(actual) !== JSON.stringify(expected)
  ) {
    throw new Error(
      "C6 source-v3-simple prior identity outer asset closure mismatch",
    );
  }
}

async function writeRootArtifact(
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  await writeExclusiveFile(path, bytes);
}

async function hasDirectoryIdentity(
  path: string,
  expected: {
    dev: number;
    ino: number;
  },
): Promise<boolean> {
  try {
    const current = await lstat(path);
    return (
      current.isDirectory() &&
      !current.isSymbolicLink() &&
      current.dev === expected.dev &&
      current.ino === expected.ino
    );
  } catch {
    return false;
  }
}

async function directoryIdentity(path: string): Promise<{
  dev: number;
  ino: number;
}> {
  const current = await lstat(path);
  if (
    !current.isDirectory() ||
    current.isSymbolicLink()
  ) {
    throw new Error(
      "C6 source-v3-simple prior identity expected an owned directory",
    );
  }
  return {
    dev: current.dev,
    ino: current.ino,
  };
}

async function executeTransport(input: {
  requestBodyBytes: Buffer;
  token: string;
  transport: C6SourceV3SimplePriorRepositoryIdentityTransport;
}): Promise<{
  bodyBytes: Buffer | null;
  headers: Headers | null;
  response: Response | null;
  transportError: {
    code: string | null;
    error: unknown;
    phase: "body-read" | "fetch" | "timeout";
  } | null;
}> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MILLISECONDS);
  let response: Response;
  try {
    response = await input.transport(new Request(ENDPOINT, {
      body: input.requestBodyBytes.toString("utf8"),
      headers: {
        ...REQUEST_HEADERS,
        authorization: `Bearer ${input.token}`,
      },
      method: "POST",
      redirect: "error",
      signal: controller.signal,
    }));
  } catch (error) {
    clearTimeout(timeout);
    return {
      bodyBytes: null,
      headers: null,
      response: null,
      transportError: {
        code: errorCode(error),
        error,
        phase: timedOut ? "timeout" : "fetch",
      },
    };
  }
  try {
    const bodyBytes = Buffer.from(
      await response.arrayBuffer(),
    );
    clearTimeout(timeout);
    return {
      bodyBytes,
      headers: response.headers,
      response,
      transportError: null,
    };
  } catch (error) {
    clearTimeout(timeout);
    return {
      bodyBytes: null,
      headers: response.headers,
      response,
      transportError: {
        code: errorCode(error),
        error,
        phase: timedOut ? "timeout" : "body-read",
      },
    };
  }
}

async function recordAttempt(input: {
  attemptNumber: number;
  httpResponseExists: boolean;
  httpStatus: number | null;
  lookupOrder: number;
  outcome: CaptureAttempt["outcome"];
  outputRoot: string;
  request: ArtifactReference;
  requestBody: ArtifactReference;
  requestProjection: CaptureAttempt["requestProjection"];
  responseBody: ArtifactReference | null;
  responseBodyReadCompleted: boolean;
  responseHeaders: ArtifactReference;
  retryDecision: Omit<
    CaptureAttempt["retryDecision"],
    "artifact"
  >;
  root: string;
  selectedResponseHeaders: SelectedResponseHeaders;
  transportError: null | Omit<
    NonNullable<CaptureAttempt["transportError"]>,
    "artifact"
  >;
}): Promise<CaptureAttempt> {
  const retryDecisionArtifact = await writeArtifact({
    bytes: canonicalBytes(input.retryDecision),
    outputRoot: input.outputRoot,
    path: `${input.root}/retry-decision.json`,
  });
  const retryDecision = {
    artifact: retryDecisionArtifact,
    ...input.retryDecision,
  };
  let transportError: CaptureAttempt["transportError"] = null;
  if (input.transportError !== null) {
    const artifact = await writeArtifact({
      bytes: canonicalBytes(input.transportError),
      outputRoot: input.outputRoot,
      path: `${input.root}/transport-error.json`,
    });
    transportError = {
      artifact,
      ...input.transportError,
    };
  }
  const attemptReceipt = {
    attempt: input.attemptNumber,
    httpResponseExists: input.httpResponseExists,
    httpStatus: input.httpStatus,
    lookupOrder: input.lookupOrder,
    outcome: input.outcome,
    request: input.request,
    requestBody: input.requestBody,
    requestProjection: input.requestProjection,
    responseBody: input.responseBody,
    responseBodyReadCompleted:
      input.responseBodyReadCompleted,
    responseHeaders: input.responseHeaders,
    retryDecision,
    selectedResponseHeaders:
      input.selectedResponseHeaders,
    transportError,
  };
  const attemptArtifact = await writeArtifact({
    bytes: canonicalBytes(attemptReceipt),
    outputRoot: input.outputRoot,
    path: `${input.root}/attempt.json`,
  });
  return {
    attempt: input.attemptNumber,
    attemptArtifact,
    httpResponseExists: input.httpResponseExists,
    httpStatus: input.httpStatus,
    lookupOrder: input.lookupOrder,
    outcome: input.outcome,
    request: input.request,
    requestBody: input.requestBody,
    requestProjection: input.requestProjection,
    responseBody: input.responseBody,
    responseBodyReadCompleted:
      input.responseBodyReadCompleted,
    responseHeaders: input.responseHeaders,
    retryDecision,
    selectedResponseHeaders:
      input.selectedResponseHeaders,
    transportError,
  };
}

function parseSuccessResponse(
  bytes: Uint8Array,
): z.infer<typeof responseEnvelopeSchema>["data"] {
  let text: string;
  try {
    text = new TextDecoder("utf-8", {
      fatal: true,
    }).decode(bytes);
  } catch {
    throw new Error(
      "C6 source-v3-simple prior identity response is not UTF-8",
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new Error(
      "C6 source-v3-simple prior identity response is not JSON",
    );
  }
  return responseEnvelopeSchema.parse(raw).data;
}

function selectResponseHeaders(
  headers: Headers | null,
): SelectedResponseHeaders {
  return Object.fromEntries(
    SELECTED_RESPONSE_HEADERS.map((name) => [
      name,
      headers?.get(name) ?? null,
    ]),
  ) as SelectedResponseHeaders;
}

function assertExternalResponseDoesNotContainToken(
  input: {
    bodyBytes: Buffer | null;
    selectedResponseHeaders: SelectedResponseHeaders;
    token: string;
    transportErrorCode: string | null;
  },
): void {
  const tokenBytes = Buffer.from(input.token);
  if (
    input.bodyBytes?.includes(tokenBytes) === true ||
    Object.values(input.selectedResponseHeaders).some(
      (value) => value?.includes(input.token) === true,
    ) ||
    input.transportErrorCode?.includes(input.token) === true
  ) {
    throw new Error(
      "C6 source-v3-simple prior identity external response contains the authorization token",
    );
  }
}

async function writeArtifact(input: {
  bytes: Uint8Array;
  outputRoot: string;
  path: string;
}): Promise<ArtifactReference> {
  const absolutePath = join(input.outputRoot, input.path);
  await writeExclusiveFile(absolutePath, input.bytes);
  return {
    bytes: input.bytes.byteLength,
    path: input.path,
    sha256: sha256(input.bytes),
  };
}

async function writeExclusiveFile(
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  const handle = await open(
    path,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    FILE_MODE,
  );
  try {
    await handle.writeFile(bytes);
    await handle.chmod(FILE_MODE);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function retryDelay(
  retryAfter: string | null,
  attemptNumber: number,
): number {
  if (retryAfter === null) {
    return 1_000 * (2 ** (attemptNumber - 1));
  }
  if (!/^(0|[1-9][0-9]*)$/u.test(retryAfter)) {
    throw new Error(
      "C6 source-v3-simple prior identity retry-after is invalid",
    );
  }
  const seconds = Number(retryAfter);
  if (seconds > 60) {
    throw new Error(
      "C6 source-v3-simple prior identity retry-after exceeds maximum",
    );
  }
  return seconds * 1_000;
}

async function assertInputsUnchanged(input: {
  planBytes: Buffer;
  planPath: string;
  protocolBytes: Buffer;
  protocolPath: string;
  sourceUniverseBytes: Buffer;
  sourceUniversePath: string;
}): Promise<void> {
  const [plan, protocol, source] = await Promise.all([
    readC6StableRegularFile(
      input.planPath,
      "terminal source-v3-simple prior identity plan",
    ),
    readC6StableRegularFile(
      input.protocolPath,
      "terminal source-v3-simple protocol",
    ),
    readC6StableRegularFile(
      input.sourceUniversePath,
      "terminal source-v3-simple source universe",
    ),
  ]);
  if (
    !plan.equals(input.planBytes) ||
    !protocol.equals(input.protocolBytes) ||
    !source.equals(input.sourceUniverseBytes)
  ) {
    throw new Error(
      "C6 source-v3-simple prior identity input changed during capture",
    );
  }
}

async function assertTokenAbsentFromTree(
  root: string,
  token: string,
): Promise<void> {
  const tokenBytes = Buffer.from(token);
  for (const entry of await readdir(root, {
    withFileTypes: true,
  })) {
    const path = join(root, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(
        "C6 source-v3-simple prior identity evidence rejects symlinks",
      );
    }
    if (entry.isDirectory()) {
      await assertTokenAbsentFromTree(path, token);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(
        "C6 source-v3-simple prior identity evidence rejects non-files",
      );
    }
    const bytes = await readC6StableRegularFile(
      path,
      "source-v3-simple prior identity token scan",
    );
    if (bytes.includes(tokenBytes)) {
      throw new Error(
        "C6 source-v3-simple prior identity token persisted in evidence",
      );
    }
  }
}

async function assertOutputMissing(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) {
      return;
    }
    throw error;
  }
  throw new Error(
    "C6 source-v3-simple prior identity output already exists",
  );
}

function assertExactInput(
  bytes: Uint8Array,
  expectedBytes: number,
  expectedSha256: string,
  label: string,
): void {
  if (
    bytes.byteLength !== expectedBytes ||
    sha256(bytes) !== expectedSha256
  ) {
    throw new Error(
      `C6 source-v3-simple ${label} bytes mismatch`,
    );
  }
}

function requiredToken(value: string): string {
  if (
    value.length < 16 ||
    value.trim() !== value ||
    value.includes("\0")
  ) {
    throw new Error(
      "C6 source-v3-simple prior identity authorization token is invalid",
    );
  }
  return value;
}

function errorCode(error: unknown): string | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "cause" in error
  ) {
    return errorCode(error.cause);
  }
  return null;
}

function sanitizeError(
  error: unknown,
  token: string,
): string {
  const message = error instanceof Error
    ? error.message
    : String(error);
  return message.split(token).join("[REDACTED]");
}

function isErrorCode(
  error: unknown,
  code: string,
): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function sleepMilliseconds(
  milliseconds: number,
): Promise<void> {
  await new Promise<void>((resolveSleep) => {
    setTimeout(resolveSleep, milliseconds);
  });
}
