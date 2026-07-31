import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { constants } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  unlink,
} from "node:fs/promises";
import {
  basename,
  dirname,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import { z } from "zod";

import type {
  C6CandidatePlan,
} from "./c6-candidate-plan";
import {
  serializeC6CandidatePlan,
} from "./c6-candidate-plan";
import type {
  C6FlatSummaryCaptureEvidenceSink,
  C6FlatSummaryGenerationCapture,
  C6FlatSummaryGenerationMaterialization,
  C6FlatSummaryTransport,
  C6FlatSummaryValidatedGenerationInputs,
} from "./c6-flat-summary-generation-capture";
import {
  C6_FLAT_SUMMARY_MAX_RESPONSE_BYTES,
  C6_FLAT_SUMMARY_REQUEST_SEED,
  C6_FLAT_SUMMARY_TRANSPORT_TIMEOUT_MS,
  C6_FLAT_SUMMARY_TRANSIENT_HTTP_STATUSES,
  C6_GURKIAI_FLAT_SUMMARY_ENDPOINT,
  evaluateC6FlatSummaryProviderResponse,
  materializeC6FlatSummaryGenerationCapture,
  normalizeC6FlatSummaryProviderResponse,
  serializeC6FlatSummaryCanonicalJson,
  validateC6FlatSummaryApiToken,
  validateC6FlatSummaryGenerationInputs,
} from "./c6-flat-summary-generation-capture";
import type {
  C6FlatSummaryCorpus,
} from "./c6-flat-summary";
import {
  buildC6InjectionBudgetReceipt,
  C6_FLAT_SUMMARY_INJECTION_COMPOSITION_SHA256,
  verifyC6FlatSummaryCorpusCompleteness,
} from "./c6-flat-summary";
import {
  buildC6FlatSummaryCorpusExpectation,
} from "./c6-readiness";
import {
  assertC6NoSymlinkPathComponents,
  readC6StableRegularFile,
  serializeC6AssetLock,
} from "./c6-asset-lock";
import {
  buildC6FlatSummaryAssetLock,
  loadC6FlatSummaryAssetLock,
  verifyC6FlatSummaryAssetClosure,
} from "./c6-flat-summary-asset-lock";
import {
  canonicalExistingDirectory,
} from "./c6-package-source-artifact-publication";

const SUCCESS_STATUS =
  "local-transport-structural-capture-only" as const;
const FAILURE_STATUS =
  "rejected-provider-capture-evidence-retained" as const;
const ARTIFACT_KIND =
  "c6-flat-summary-generation-capture-publication" as const;
const CLAIM_KIND =
  "c6-flat-summary-generation-capture-claim" as const;
const SUCCESS_TERMINAL_KIND =
  "c6-flat-summary-generation-capture-terminal" as const;
const FAILURE_TERMINAL_KIND =
  "c6-flat-summary-generation-capture-failure-terminal" as const;
const FILE_MODE = 0o600;
const MAX_JSON_BYTES = 128 * 1_024 * 1_024;
const PROCESS_INTERRUPTION_DECISION =
  "rejected-process-interruption" as const;
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const isoTimestampSchema = z.iso.datetime();
const artifactReferenceSchema = z.object({
  bytes: z.number().int().nonnegative(),
  path: z.string().min(1),
  sha256: sha256Schema,
}).strict();
const usageSchema = z.object({
  cachedInputTokens: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().positive(),
}).strict();
const persistedDecisionSchema = z.enum([
  "accepted-success",
  "rejected-invalid-json",
  "rejected-invalid-response-shape",
  "rejected-invalid-usage",
  "rejected-model-mismatch",
  "rejected-non-retryable-status",
  "rejected-output-over-budget",
  "rejected-process-interruption",
  "rejected-retry-delay-error",
  "rejected-transient-status-exhausted",
  "rejected-transport-error",
  "retry-transient-status",
]);
const transportErrorSchema = z.object({
  sanitized: z.literal(true),
  type: z.enum([
    "authorization-material-detected",
    "invalid-response",
    "process-interruption",
    "request-timeout",
    "response-byte-limit-exceeded",
    "retry-delay-threw",
    "transport-threw",
  ]),
}).strict();
const attemptDecisionSchema = z.object({
  attempt: z.number().int().positive().max(3),
  completedAt: isoTimestampSchema.optional(),
  decision: persistedDecisionSchema,
  generationKey: sha256Schema,
  rawResponseSha256: sha256Schema.optional(),
  schemaVersion: z.literal(1),
  startedAt: isoTimestampSchema.optional(),
  status: z.number().int().min(100).max(599).optional(),
  transportError: transportErrorSchema.optional(),
}).strict();
const responseMarkerSchema = z.object({
  attempt: z.number().int().positive().max(3),
  completedAt: isoTimestampSchema,
  generationKey: sha256Schema,
  rawResponse: artifactReferenceSchema,
  schemaVersion: z.literal(1),
  startedAt: isoTimestampSchema,
  status: z.number().int().min(100).max(599),
}).strict();
const attemptManifestEntrySchema = z.object({
  attempt: z.number().int().positive().max(3),
  completedAt: isoTimestampSchema.optional(),
  decision: persistedDecisionSchema,
  rawResponseSha256: sha256Schema.optional(),
  startedAt: isoTimestampSchema.optional(),
  status: z.number().int().min(100).max(599).optional(),
  transportError: transportErrorSchema.optional(),
}).strict();
const attemptManifestSchema = z.object({
  attempts: z.array(attemptManifestEntrySchema).max(3),
  generationKey: sha256Schema,
  requestSha256: sha256Schema,
  schemaVersion: z.literal(1),
}).strict();
const providerArtifactSchema = z.object({
  attemptManifestSha256: sha256Schema,
  completedAt: isoTimestampSchema,
  generationKey: sha256Schema,
  historySourceSha256: sha256Schema,
  model: z.string().min(1),
  outputSha256: sha256Schema,
  planSha256: sha256Schema,
  provider: z.string().min(1),
  providerAuthenticityVerified: z.literal(false),
  providerEndpoint: z.literal(
    C6_GURKIAI_FLAT_SUMMARY_ENDPOINT,
  ),
  providerEndpointSha256: sha256Schema,
  providerRequestId: z.string().min(1),
  rawResponseSha256: sha256Schema,
  rawToNormalizedIndexSha256: sha256Schema,
  requestSha256: sha256Schema,
  schemaVersion: z.literal(1),
  startedAt: isoTimestampSchema,
  summaryPromptSha256: sha256Schema,
  summaryProtocolSha256: sha256Schema,
  usage: usageSchema,
}).strict();
const normalizationIndexSchema = z.object({
  model: z.object({
    path: z.literal("$.model"),
    value: z.string().min(1),
  }).strict(),
  output: z.object({
    path: z.literal("$.choices[0].message.content"),
    sha256: sha256Schema,
  }).strict(),
  providerRequestId: z.object({
    path: z.literal("$.id"),
  }).strict(),
  rawResponseSha256: sha256Schema,
  schemaVersion: z.literal(1),
  usage: z.object({
    cachedInputTokens: z.object({
      path: z.union([
        z.literal(
          "$.usage.prompt_tokens_details.cached_tokens",
        ),
        z.null(),
      ]),
      value: z.number().int().nonnegative(),
    }).strict(),
    inputTokens: z.object({
      path: z.literal("$.usage.prompt_tokens"),
      value: z.number().int().nonnegative(),
    }).strict(),
    outputTokens: z.object({
      path: z.literal("$.usage.completion_tokens"),
      value: z.number().int().positive(),
    }).strict(),
  }).strict(),
}).strict();
const redactedRequestSchema = z.object({
  body: z.object({
    max_tokens: z.number().int().positive(),
    messages: z.tuple([
      z.object({
        content: z.string().min(1),
        role: z.literal("system"),
      }).strict(),
      z.object({
        content: z.string().min(1),
        role: z.literal("user"),
      }).strict(),
    ]),
    model: z.string().min(1),
    n: z.literal(1),
    seed: z.literal(C6_FLAT_SUMMARY_REQUEST_SEED),
    stream: z.literal(false),
    temperature: z.literal(0),
  }).strict(),
  bodySha256: sha256Schema,
  headers: z.object({
    accept: z.literal("application/json"),
    authorization: z.literal("Bearer [REDACTED]"),
    "content-type": z.literal("application/json"),
  }).strict(),
  method: z.literal("POST"),
  url: z.literal(C6_GURKIAI_FLAT_SUMMARY_ENDPOINT),
}).strict();
const claimHistorySchema = z.object({
  generationKey: sha256Schema,
  history: artifactReferenceSchema,
  historySourceSha256: sha256Schema,
}).strict();
const claimSchema = z.object({
  artifactKind: z.literal(CLAIM_KIND),
  candidateManifestFrozen: z.literal(false),
  codexRunReady: z.literal(false),
  histories: z.array(claimHistorySchema),
  plan: artifactReferenceSchema,
  providerAuthenticityVerified: z.literal(false),
  providerEndpoint: z.literal(
    C6_GURKIAI_FLAT_SUMMARY_ENDPOINT,
  ),
  providerEndpointSha256: sha256Schema,
  schemaVersion: z.literal(1),
  startedAt: isoTimestampSchema,
  status: z.literal("claimed-unsealed-no-live-resume"),
  summaryPrompt: artifactReferenceSchema,
  summaryProtocol: artifactReferenceSchema,
  transportPolicy: z.object({
    maxResponseBytes: z.literal(
      C6_FLAT_SUMMARY_MAX_RESPONSE_BYTES,
    ),
    timeoutMs: z.literal(
      C6_FLAT_SUMMARY_TRANSPORT_TIMEOUT_MS,
    ),
  }).strict(),
}).strict();
const attemptIndexSchema = z.object({
  attempt: z.number().int().positive().max(3),
  decisionArtifact: artifactReferenceSchema,
  rawResponse: artifactReferenceSchema.nullable(),
  responseMarker: artifactReferenceSchema.nullable(),
}).strict();
const acceptedGenerationSchema = z.object({
  normalizedOutput: artifactReferenceSchema,
  providerArtifact: artifactReferenceSchema,
  rawToNormalizedIndex: artifactReferenceSchema,
}).strict();
const uncommittedGenerationSchema = z.object({
  normalizedOutput: artifactReferenceSchema.nullable(),
  rawToNormalizedIndex: artifactReferenceSchema,
}).strict();
const generationIndexEntrySchema = z.object({
  accepted: acceptedGenerationSchema.nullable(),
  attemptManifest: artifactReferenceSchema.nullable(),
  attempts: z.array(attemptIndexSchema).max(3),
  generationKey: sha256Schema,
  history: artifactReferenceSchema,
  historySourceSha256: sha256Schema,
  redactedRequest: artifactReferenceSchema,
  uncommitted: uncommittedGenerationSchema.nullable(),
}).strict();
const generationIndexSchema = z.object({
  generations: z.array(generationIndexEntrySchema),
  schemaVersion: z.literal(2),
}).strict();
const successTerminalSchema = z.object({
  artifactKind: z.literal(SUCCESS_TERMINAL_KIND),
  completedAt: isoTimestampSchema,
  corpus: artifactReferenceSchema,
  generationCount: z.number().int().nonnegative(),
  generationIndex: artifactReferenceSchema,
  schemaVersion: z.literal(1),
  stageBindingCount: z.number().int().nonnegative(),
  status: z.literal("capture-complete-asset-lock-pending"),
}).strict();
const failureTerminalSchema = z.object({
  artifactKind: z.literal(FAILURE_TERMINAL_KIND),
  attemptCount: z.number().int().nonnegative(),
  completedGenerationCount: z.number().int().nonnegative(),
  error: z.object({
    messageSha256: sha256Schema,
    name: z.enum([
      "C6FlatSummaryCaptureError",
      "Error",
      "UnknownError",
    ]),
  }).strict(),
  failedAt: isoTimestampSchema,
  generationIndex: artifactReferenceSchema,
  schemaVersion: z.literal(1),
  status: z.literal(
    "permanently-rejected-no-provider-resume",
  ),
  uncommittedCorpus: artifactReferenceSchema.nullable(),
}).strict();
const receiptSchema = z.object({
  artifactKind: z.literal(ARTIFACT_KIND),
  assetLock: z.object({
    assetRootSha256: sha256Schema,
    path: z.literal("artifacts/asset-lock.json"),
    sha256: sha256Schema,
  }).strict(),
  attemptCount: z.number().int().nonnegative(),
  candidateManifestFrozen: z.literal(false),
  codexRunReady: z.literal(false),
  corpus: artifactReferenceSchema.nullable(),
  generationCount: z.number().int().nonnegative(),
  generationIndex: artifactReferenceSchema,
  plan: artifactReferenceSchema,
  providerAuthenticityVerified: z.literal(false),
  providerEndpoint: z.literal(
    C6_GURKIAI_FLAT_SUMMARY_ENDPOINT,
  ),
  providerEndpointSha256: sha256Schema,
  schemaVersion: z.literal(2),
  stageBindingCount: z.number().int().nonnegative(),
  status: z.union([
    z.literal(SUCCESS_STATUS),
    z.literal(FAILURE_STATUS),
  ]),
  summaryPrompt: artifactReferenceSchema,
  summaryProtocol: artifactReferenceSchema,
  terminal: artifactReferenceSchema,
  terminalOutcome: z.enum(["failure", "success"]),
  transportPolicy: z.object({
    maxResponseBytes: z.literal(
      C6_FLAT_SUMMARY_MAX_RESPONSE_BYTES,
    ),
    timeoutMs: z.literal(
      C6_FLAT_SUMMARY_TRANSPORT_TIMEOUT_MS,
    ),
  }).strict(),
  uncommittedCorpus: artifactReferenceSchema.nullable(),
}).strict();

type ArtifactReference = z.infer<typeof artifactReferenceSchema>;
type AttemptDecision = z.infer<typeof attemptDecisionSchema>;
type AttemptIndex = z.infer<typeof attemptIndexSchema>;
type Claim = z.infer<typeof claimSchema>;
type FailureTerminal = z.infer<typeof failureTerminalSchema>;
type GenerationIndex = z.infer<typeof generationIndexSchema>;
type GenerationIndexEntry = z.infer<
  typeof generationIndexEntrySchema
>;
type Receipt = z.infer<typeof receiptSchema>;
type ResponseMarker = z.infer<typeof responseMarkerSchema>;
type SuccessTerminal = z.infer<typeof successTerminalSchema>;

interface PublicationContext {
  apiToken: string;
  artifactsRoot: string;
  claim: Claim;
  outputRoot: string;
  validated: C6FlatSummaryValidatedGenerationInputs;
}

export interface C6FlatSummaryGenerationPublication {
  assetLockSha256: string;
  assetRootSha256: string;
  attemptCount: number;
  candidateManifestFrozen: false;
  codexRunReady: false;
  generationCount: number;
  outputRoot: string;
  providerAuthenticityVerified: false;
  receiptPath: string;
  receiptSha256: string;
  stageBindingCount: number;
  status: typeof FAILURE_STATUS | typeof SUCCESS_STATUS;
}

export type C6FlatSummaryGenerationPublicationInput = {
  apiToken: string;
  endpoint: string;
  histories: ReadonlyArray<{
    bytes: Uint8Array;
    generationKey: string;
  }>;
  now?: () => Date;
  outputRoot: string;
  plan: C6CandidatePlan;
  planBytes: Uint8Array;
  planSha256: string;
  sleep?: (milliseconds: number) => Promise<void>;
  summaryPromptBytes: Uint8Array;
  summaryProtocolBytes: Uint8Array;
  transport: C6FlatSummaryTransport;
};

export type C6FlatSummaryGenerationFinalizationInput = {
  histories: C6FlatSummaryGenerationPublicationInput["histories"];
  outputRoot: string;
  planBytes: Uint8Array;
  planSha256: string;
  summaryPromptBytes: Uint8Array;
  summaryProtocolBytes: Uint8Array;
};

export class C6FlatSummaryGenerationPublicationError
  extends Error {
  readonly outputRoot: string;
  readonly receiptSha256: string;
  readonly status = FAILURE_STATUS;

  constructor(
    publication: C6FlatSummaryGenerationPublication,
    cause: unknown,
  ) {
    super(
      "C6 flat-summary provider capture was rejected with retained evidence",
      { cause },
    );
    this.outputRoot = publication.outputRoot;
    this.receiptSha256 = publication.receiptSha256;
  }
}

export async function materializeC6FlatSummaryGenerationCaptureToRoot(
  input: C6FlatSummaryGenerationPublicationInput,
): Promise<C6FlatSummaryGenerationPublication> {
  const validated = validateC6FlatSummaryGenerationInputs(input);
  if (
    validated.generationBindings.length > 0 ||
    input.apiToken.length > 0
  ) {
    validateC6FlatSummaryApiToken(input.apiToken);
  }
  if (input.apiToken.length > 0) {
    for (const bytes of [
      input.planBytes,
      input.summaryPromptBytes,
      input.summaryProtocolBytes,
      ...input.histories.map(({ bytes }) => bytes),
    ]) {
      assertNoApiToken(bytes, input.apiToken);
    }
  }
  const context = await claimCaptureRoot(input, validated);
  try {
    const materialization =
      await materializeC6FlatSummaryGenerationCapture({
        ...input,
        evidenceSink: createEvidenceSink(context),
      });
    return await publishSuccessfulCapture(
      context,
      materialization,
    );
  } catch (error) {
    if (
      await pathExists(
        join(context.artifactsRoot, "capture-terminal.json"),
      ) ||
      await pathExists(
        join(context.artifactsRoot, "asset-lock.json"),
      )
    ) {
      throw new Error(
        "C6 flat-summary capture reached finalization; use finalize-only without another provider call",
        { cause: error },
      );
    }
    const publication = await sealFailedCapture(
      context,
      error,
    );
    throw new C6FlatSummaryGenerationPublicationError(
      publication,
      error,
    );
  }
}

export async function finalizeC6FlatSummaryGenerationCaptureRoot(
  input: C6FlatSummaryGenerationFinalizationInput,
): Promise<C6FlatSummaryGenerationPublication> {
  const outputRoot = await canonicalExistingDirectory(
    input.outputRoot,
    "flat-summary capture output root",
  );
  await recoverPendingArtifacts(outputRoot);
  const artifactsRoot = await canonicalExistingDirectory(
    join(outputRoot, "artifacts"),
    "flat-summary artifacts root",
  );
  const plan = parsePlan(input.planBytes);
  const validated = validateC6FlatSummaryGenerationInputs({
    endpoint: C6_GURKIAI_FLAT_SUMMARY_ENDPOINT,
    histories: input.histories,
    plan,
    planBytes: input.planBytes,
    planSha256: input.planSha256,
    summaryPromptBytes: input.summaryPromptBytes,
    summaryProtocolBytes: input.summaryProtocolBytes,
  });
  const claim = await loadClaim(artifactsRoot);
  await verifyClaimAgainstExpectedInputs({
    artifactsRoot,
    claim,
    histories: input.histories,
    planBytes: input.planBytes,
    summaryPromptBytes: input.summaryPromptBytes,
    summaryProtocolBytes: input.summaryProtocolBytes,
    validated,
  });
  const context: PublicationContext = {
    apiToken: "",
    artifactsRoot,
    claim,
    outputRoot,
    validated,
  };
  const receiptPath = join(outputRoot, "receipt.json");
  if (await pathExists(receiptPath)) {
    const receiptBytes = await readC6StableRegularFile(
      receiptPath,
      "flat-summary capture receipt",
      4 * 1_024 * 1_024,
      true,
    );
    return await verifyC6FlatSummaryGenerationCaptureRoot({
      expectedReceiptSha256: sha256(receiptBytes),
      outputRoot,
    });
  }

  const successTerminalPath = join(
    artifactsRoot,
    "capture-terminal.json",
  );
  const failureTerminalPath = join(
    artifactsRoot,
    "capture-failure-terminal.json",
  );
  const [hasSuccessTerminal, hasFailureTerminal] =
    await Promise.all([
      pathExists(successTerminalPath),
      pathExists(failureTerminalPath),
    ]);
  if (hasSuccessTerminal && hasFailureTerminal) {
    throw new Error(
      "C6 flat-summary capture has conflicting terminal outcomes",
    );
  }
  if (!hasSuccessTerminal && !hasFailureTerminal) {
    if (
      await pathExists(join(artifactsRoot, "asset-lock.json"))
    ) {
      throw new Error(
        "C6 flat-summary asset lock exists without a terminal",
      );
    }
    return await sealFailedCapture(
      context,
      new Error("flat-summary process interruption"),
    );
  }
  return await sealTerminalReceipt(context);
}

export async function verifyC6FlatSummaryGenerationCaptureRoot(input: {
  expectedReceiptSha256: string;
  outputRoot: string;
  testHooks?: {
    beforeTerminalRevalidation?: () => Promise<void> | void;
  };
}): Promise<C6FlatSummaryGenerationPublication> {
  assertSha256(
    input.expectedReceiptSha256,
    "C6 flat-summary receipt hash is invalid",
  );
  const outputRoot = await canonicalExistingDirectory(
    input.outputRoot,
    "flat-summary capture output root",
  );
  await assertRootEntries(outputRoot);
  const receiptPath = join(outputRoot, "receipt.json");
  const receiptBytes = await readC6StableRegularFile(
    receiptPath,
    "flat-summary capture receipt",
    4 * 1_024 * 1_024,
    true,
  );
  const receiptSha256 = sha256(receiptBytes);
  if (receiptSha256 !== input.expectedReceiptSha256) {
    throw new Error("C6 flat-summary receipt hash does not match");
  }
  const receipt = parsePrettyExact(
    receiptBytes,
    receiptSchema,
    "C6 flat-summary receipt is invalid",
  );
  verifyReceiptCanonicalPaths(receipt);
  const artifactsRoot = await canonicalExistingDirectory(
    join(outputRoot, "artifacts"),
    "flat-summary artifacts root",
  );
  const loadedLock =
    await loadC6FlatSummaryAssetLock(artifactsRoot);
  if (
    receipt.assetLock.sha256 !== loadedLock.assetLockSha256 ||
    receipt.assetLock.assetRootSha256 !==
      loadedLock.assetLock.assetRootSha256
  ) {
    throw new Error(
      "C6 flat-summary asset closure identity does not match",
    );
  }

  const claimBytes = await readNamedReference(
    artifactsRoot,
    "capture-claim.json",
  );
  const claim = parseCompactExact(
    claimBytes,
    claimSchema,
    "C6 flat-summary capture claim is invalid",
  );
  const planBytes = await readReference(
    artifactsRoot,
    receipt.plan,
  );
  const promptBytes = await readReference(
    artifactsRoot,
    receipt.summaryPrompt,
  );
  const protocolBytes = await readReference(
    artifactsRoot,
    receipt.summaryProtocol,
  );
  const histories = await Promise.all(
    claim.histories.map(async (history) => ({
      bytes: await readReference(
        artifactsRoot,
        history.history,
      ),
      generationKey: history.generationKey,
    })),
  );
  const plan = parsePlan(planBytes);
  const validated = validateC6FlatSummaryGenerationInputs({
    endpoint: receipt.providerEndpoint,
    histories,
    plan,
    planBytes,
    planSha256: receipt.plan.sha256,
    summaryPromptBytes: promptBytes,
    summaryProtocolBytes: protocolBytes,
  });
  verifyReceiptClaimBindings({
    claim,
    receipt,
    validated,
  });
  const indexBytes = await readReference(
    artifactsRoot,
    receipt.generationIndex,
  );
  const index = parsePrettyExact(
    indexBytes,
    generationIndexSchema,
    "C6 flat-summary generation index is invalid",
  );
  const verifiedIndex = await verifyGenerationIndex({
    artifactsRoot,
    claim,
    index,
    validated,
  });
  const terminalBytes = await readReference(
    artifactsRoot,
    receipt.terminal,
  );
  let corpus: C6FlatSummaryCorpus | null = null;
  if (receipt.terminalOutcome === "success") {
    const terminal = parseCompactExact(
      terminalBytes,
      successTerminalSchema,
      "C6 flat-summary success terminal is invalid",
    );
    if (receipt.corpus === null) {
      throw new Error("C6 flat-summary success corpus is missing");
    }
    const corpusBytes = await readReference(
      artifactsRoot,
      receipt.corpus,
    );
    corpus = parsePrettyJson(
      corpusBytes,
      "C6 flat-summary corpus is invalid",
    ) as C6FlatSummaryCorpus;
    verifySuccessTerminal({
      corpus,
      corpusReference: receipt.corpus,
      indexReference: receipt.generationIndex,
      receipt,
      terminal,
      validated,
      verifiedIndex,
    });
    await verifySuccessfulGenerationSemantics({
      artifactsRoot,
      corpus,
      index,
      plan,
      promptBytes,
      protocolBytes,
      receipt,
      validated,
    });
  } else {
    const terminal = parseCompactExact(
      terminalBytes,
      failureTerminalSchema,
      "C6 flat-summary failure terminal is invalid",
    );
    verifyFailureTerminal({
      indexReference: receipt.generationIndex,
      receipt,
      terminal,
      verifiedIndex,
    });
    const uncommittedCorpus = receipt.uncommittedCorpus === null
      ? null
      : parsePrettyJson(
        await readReference(
          artifactsRoot,
          receipt.uncommittedCorpus,
        ),
        "C6 flat-summary uncommitted corpus is invalid",
      ) as C6FlatSummaryCorpus;
    await verifyRetainedGenerationSemantics({
      artifactsRoot,
      corpus: uncommittedCorpus,
      index,
      plan,
      promptBytes,
      protocolBytes,
      receipt,
      validated,
    });
  }

  const referencedPaths = collectReferencedPaths({
    claim,
    index,
    receipt,
  });
  const lockedPaths = new Set(
    loadedLock.assetLock.files.map(({ path }) => path),
  );
  if (
    referencedPaths.size !== lockedPaths.size ||
    [...referencedPaths].some((path) => !lockedPaths.has(path))
  ) {
    throw new Error(
      "C6 flat-summary indexed asset set does not match",
    );
  }
  await input.testHooks?.beforeTerminalRevalidation?.();
  const terminalReceiptBytes = await readC6StableRegularFile(
    receiptPath,
    "flat-summary capture receipt terminal replay",
    4 * 1_024 * 1_024,
    true,
  );
  if (
    !terminalReceiptBytes.equals(receiptBytes) ||
    sha256(terminalReceiptBytes) !== input.expectedReceiptSha256
  ) {
    throw new Error(
      "C6 flat-summary receipt changed during verification",
    );
  }
  await assertRootEntries(outputRoot);
  await verifyC6FlatSummaryAssetClosure(
    artifactsRoot,
    loadedLock,
  );
  return publicationResult({
    outputRoot,
    receipt,
    receiptPath,
    receiptSha256,
  });
}

async function claimCaptureRoot(
  input: C6FlatSummaryGenerationPublicationInput,
  validated: C6FlatSummaryValidatedGenerationInputs,
): Promise<PublicationContext> {
  const outputRoot = resolve(input.outputRoot);
  const parent = dirname(outputRoot);
  if (
    basename(outputRoot).length === 0 ||
    await realpath(parent) !== parent
  ) {
    throw new Error(
      "C6 flat-summary output root requires a canonical existing parent",
    );
  }
  try {
    await mkdir(outputRoot, { mode: 0o700 });
  } catch (error) {
    if (hasErrorCode(error, "EEXIST")) {
      throw new Error(
        "C6 flat-summary output root already exists",
      );
    }
    throw error;
  }
  const artifactsRoot = join(outputRoot, "artifacts");
  await mkdir(artifactsRoot, { mode: 0o700 });
  await mkdir(join(artifactsRoot, "inputs"), {
    mode: 0o700,
  });
  await mkdir(join(artifactsRoot, "inputs", "histories"), {
    mode: 0o700,
  });
  await mkdir(join(artifactsRoot, "generations"), {
    mode: 0o700,
  });
  for (const binding of validated.generationBindings) {
    const generationRoot = join(
      artifactsRoot,
      "generations",
      binding.generationKey,
    );
    await mkdir(generationRoot, { mode: 0o700 });
    await mkdir(join(generationRoot, "attempts"), {
      mode: 0o700,
    });
  }

  const plan = await commitArtifact({
    apiToken: input.apiToken,
    bytes: input.planBytes,
    outputRoot,
    path: "inputs/plan.json",
  });
  const summaryPrompt = await commitArtifact({
    apiToken: input.apiToken,
    bytes: input.summaryPromptBytes,
    outputRoot,
    path: "inputs/summary-prompt.md",
  });
  const summaryProtocol = await commitArtifact({
    apiToken: input.apiToken,
    bytes: input.summaryProtocolBytes,
    outputRoot,
    path: "inputs/summary-protocol.json",
  });
  if (
    plan.sha256 !== validated.planSha256 ||
    summaryPrompt.sha256 !== validated.summaryPromptSha256 ||
    summaryProtocol.sha256 !==
      validated.summaryProtocolSha256
  ) {
    throw new Error(
      "C6 flat-summary frozen input hash changed during claim",
    );
  }
  const histories = [];
  for (const binding of validated.generationBindings) {
    const bytes = validated.historyByGenerationKey.get(
      binding.generationKey,
    )!;
    const history = await commitArtifact({
      apiToken: input.apiToken,
      bytes,
      outputRoot,
      path:
        `inputs/histories/${binding.generationKey}.history`,
    });
    if (history.sha256 !== binding.historySourceSha256) {
      throw new Error(
        "C6 flat-summary history changed during claim",
      );
    }
    histories.push({
      generationKey: binding.generationKey,
      history,
      historySourceSha256: binding.historySourceSha256,
    });
  }
  const claim: Claim = {
    artifactKind: CLAIM_KIND,
    candidateManifestFrozen: false,
    codexRunReady: false,
    histories,
    plan,
    providerAuthenticityVerified: false,
    providerEndpoint: validated.endpoint,
    providerEndpointSha256:
      validated.providerEndpointSha256,
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    status: "claimed-unsealed-no-live-resume",
    summaryPrompt,
    summaryProtocol,
    transportPolicy: {
      maxResponseBytes:
        C6_FLAT_SUMMARY_MAX_RESPONSE_BYTES,
      timeoutMs: C6_FLAT_SUMMARY_TRANSPORT_TIMEOUT_MS,
    },
  };
  await commitArtifact({
    apiToken: input.apiToken,
    bytes: serializeC6FlatSummaryCanonicalJson(claim),
    outputRoot,
    path: "capture-claim.json",
  });
  return {
    apiToken: input.apiToken,
    artifactsRoot,
    claim,
    outputRoot,
    validated,
  };
}

function createEvidenceSink(
  context: PublicationContext,
): C6FlatSummaryCaptureEvidenceSink {
  return {
    onAttemptDecision: async ({ attempt, generationKey }) => {
      assertKnownGeneration(context.claim, generationKey);
      const decision = attemptDecisionSchema.parse({
        ...attempt,
        generationKey,
        schemaVersion: 1,
      });
      validateDecisionShape(decision);
      await commitArtifact({
        apiToken: context.apiToken,
        bytes: serializeC6FlatSummaryCanonicalJson(decision),
        outputRoot: context.outputRoot,
        path: attemptPath(
          generationKey,
          attempt.attempt,
          "decision.json",
        ),
      });
    },
    onGenerationAccepted: async ({ generation }) => {
      await commitAcceptedGeneration(context, generation);
    },
    onGenerationPrepared: async (prepared) => {
      const history = assertKnownGeneration(
        context.claim,
        prepared.generationKey,
      );
      if (
        history.historySourceSha256 !==
          prepared.historySourceSha256 ||
        history.history.sha256 !==
          sha256(prepared.historyBytes)
      ) {
        throw new Error(
          "C6 flat-summary prepared history does not match claim",
        );
      }
      const request = await commitArtifact({
        apiToken: context.apiToken,
        bytes: prepared.redactedRequestBytes,
        outputRoot: context.outputRoot,
        path:
          `generations/${prepared.generationKey}/request.redacted.json`,
      });
      if (request.sha256 !== prepared.requestSha256) {
        throw new Error(
          "C6 flat-summary prepared request hash changed",
        );
      }
    },
    onRawAttempt: async ({ attempt, generationKey }) => {
      assertKnownGeneration(context.claim, generationKey);
      const rawResponse = await commitArtifact({
        apiToken: context.apiToken,
        bytes: attempt.rawResponseBytes,
        outputRoot: context.outputRoot,
        path: attemptPath(
          generationKey,
          attempt.attempt,
          "response.raw",
        ),
      });
      if (rawResponse.sha256 !== attempt.rawResponseSha256) {
        throw new Error(
          "C6 flat-summary raw response hash changed",
        );
      }
      const marker: ResponseMarker = {
        attempt: attempt.attempt,
        completedAt: attempt.completedAt,
        generationKey,
        rawResponse,
        schemaVersion: 1,
        startedAt: attempt.startedAt,
        status: attempt.status,
      };
      await commitArtifact({
        apiToken: context.apiToken,
        bytes: serializeC6FlatSummaryCanonicalJson(marker),
        outputRoot: context.outputRoot,
        path: attemptPath(
          generationKey,
          attempt.attempt,
          "response.json",
        ),
      });
    },
  };
}

async function commitAcceptedGeneration(
  context: PublicationContext,
  generation: C6FlatSummaryGenerationCapture,
): Promise<void> {
  assertKnownGeneration(context.claim, generation.generationKey);
  const root = `generations/${generation.generationKey}`;
  const attemptManifest = await commitArtifact({
    apiToken: context.apiToken,
    bytes: generation.attemptManifestBytes,
    outputRoot: context.outputRoot,
    path: `${root}/attempt-manifest.json`,
  });
  const rawToNormalizedIndex = await commitArtifact({
    apiToken: context.apiToken,
    bytes: generation.rawToNormalizedIndexBytes,
    outputRoot: context.outputRoot,
    path: `${root}/normalization-index.json`,
  });
  const normalizedOutput = await commitArtifact({
    apiToken: context.apiToken,
    bytes: Buffer.from(generation.normalized.output),
    outputRoot: context.outputRoot,
    path: `${root}/output.txt`,
  });
  if (
    attemptManifest.sha256 !==
      generation.attemptManifestSha256 ||
    rawToNormalizedIndex.sha256 !==
      generation.rawToNormalizedIndexSha256 ||
    normalizedOutput.sha256 !==
      generation.normalized.outputSha256
  ) {
    throw new Error(
      "C6 flat-summary accepted generation hash changed",
    );
  }
  const providerArtifact = await commitArtifact({
    apiToken: context.apiToken,
    bytes: generation.artifactBytes,
    outputRoot: context.outputRoot,
    path: `${root}/provider-artifact.json`,
  });
  if (providerArtifact.sha256 !== generation.artifactSha256) {
    throw new Error(
      "C6 flat-summary provider artifact hash changed",
    );
  }
}

async function publishSuccessfulCapture(
  context: PublicationContext,
  materialization: C6FlatSummaryGenerationMaterialization,
): Promise<C6FlatSummaryGenerationPublication> {
  await recoverPendingArtifacts(context.outputRoot);
  const indexed = await buildGenerationIndex(context);
  if (
    indexed.index.generations.length !==
      context.claim.histories.length ||
    indexed.completedGenerationCount !==
      context.claim.histories.length
  ) {
    throw new Error(
      "C6 flat-summary success generation set is incomplete",
    );
  }
  const corpus = await commitArtifact({
    apiToken: context.apiToken,
    bytes: serializeJson(materialization.corpus),
    outputRoot: context.outputRoot,
    path: "corpus.json",
  });
  const generationIndex = await commitArtifact({
    apiToken: context.apiToken,
    bytes: serializeJson(indexed.index),
    outputRoot: context.outputRoot,
    path: "generation-index.json",
  });
  const terminal: SuccessTerminal = {
    artifactKind: SUCCESS_TERMINAL_KIND,
    completedAt: new Date().toISOString(),
    corpus,
    generationCount: indexed.completedGenerationCount,
    generationIndex,
    schemaVersion: 1,
    stageBindingCount:
      materialization.corpus.stageBindingReceipts.length,
    status: "capture-complete-asset-lock-pending",
  };
  await commitArtifact({
    apiToken: context.apiToken,
    bytes: serializeC6FlatSummaryCanonicalJson(terminal),
    outputRoot: context.outputRoot,
    path: "capture-terminal.json",
  });
  return await sealTerminalReceipt(context);
}

async function sealFailedCapture(
  context: PublicationContext,
  error: unknown,
): Promise<C6FlatSummaryGenerationPublication> {
  await recoverPendingArtifacts(context.outputRoot);
  await synthesizeInterruptedDecisions(context);
  await commitIncompleteAttemptManifests(context);
  const indexed = await buildGenerationIndex(context);
  const generationIndex = await commitOrVerifyArtifact({
    apiToken: context.apiToken,
    bytes: serializeJson(indexed.index),
    outputRoot: context.outputRoot,
    path: "generation-index.json",
  });
  const uncommittedCorpus = await optionalReference(
    context.artifactsRoot,
    "corpus.json",
    join(context.artifactsRoot, "corpus.json"),
  );
  const terminal: FailureTerminal = {
    artifactKind: FAILURE_TERMINAL_KIND,
    attemptCount: indexed.attemptCount,
    completedGenerationCount:
      indexed.completedGenerationCount,
    error: captureErrorIdentity(error),
    failedAt: new Date().toISOString(),
    generationIndex,
    schemaVersion: 1,
    status: "permanently-rejected-no-provider-resume",
    uncommittedCorpus,
  };
  await commitOrVerifyArtifact({
    apiToken: context.apiToken,
    bytes: serializeC6FlatSummaryCanonicalJson(terminal),
    outputRoot: context.outputRoot,
    path: "capture-failure-terminal.json",
  });
  return await sealTerminalReceipt(context);
}

async function sealTerminalReceipt(
  context: PublicationContext,
): Promise<C6FlatSummaryGenerationPublication> {
  await recoverPendingArtifacts(context.outputRoot);
  const successTerminalPath = join(
    context.artifactsRoot,
    "capture-terminal.json",
  );
  const failureTerminalPath = join(
    context.artifactsRoot,
    "capture-failure-terminal.json",
  );
  const [hasSuccessTerminal, hasFailureTerminal] =
    await Promise.all([
      pathExists(successTerminalPath),
      pathExists(failureTerminalPath),
    ]);
  if (hasSuccessTerminal === hasFailureTerminal) {
    throw new Error(
      "C6 flat-summary capture requires exactly one terminal",
    );
  }
  const terminalPath = hasSuccessTerminal
    ? "capture-terminal.json"
    : "capture-failure-terminal.json";
  const terminalBytes = await readNamedReference(
    context.artifactsRoot,
    terminalPath,
  );
  const terminal = hasSuccessTerminal
    ? parseCompactExact(
      terminalBytes,
      successTerminalSchema,
      "C6 flat-summary success terminal is invalid",
    )
    : parseCompactExact(
      terminalBytes,
      failureTerminalSchema,
      "C6 flat-summary failure terminal is invalid",
    );
  const terminalReference = referenceForBytes(
    terminalPath,
    terminalBytes,
  );
  const indexBytes = await readReference(
    context.artifactsRoot,
    terminal.generationIndex,
  );
  const index = parsePrettyExact(
    indexBytes,
    generationIndexSchema,
    "C6 flat-summary generation index is invalid",
  );
  const attemptCount = index.generations.reduce(
    (count, generation) =>
      count + generation.attempts.length,
    0,
  );
  const completedGenerationCount = index.generations.filter(
    ({ accepted }) => accepted !== null,
  ).length;
  const assetLockPath = join(
    context.artifactsRoot,
    "asset-lock.json",
  );
  if (!(await pathExists(assetLockPath))) {
    const assetLock = await buildC6FlatSummaryAssetLock(
      context.artifactsRoot,
    );
    await commitCreateOnlyBytes(
      context.outputRoot,
      "artifacts/asset-lock.json",
      Buffer.from(serializeC6AssetLock(assetLock)),
    );
  }
  const loadedLock = await loadC6FlatSummaryAssetLock(
    context.artifactsRoot,
  );
  const receipt: Receipt = {
    artifactKind: ARTIFACT_KIND,
    assetLock: {
      assetRootSha256:
        loadedLock.assetLock.assetRootSha256,
      path: "artifacts/asset-lock.json",
      sha256: loadedLock.assetLockSha256,
    },
    attemptCount,
    candidateManifestFrozen: false,
    codexRunReady: false,
    corpus: hasSuccessTerminal
      ? (terminal as SuccessTerminal).corpus
      : null,
    generationCount: completedGenerationCount,
    generationIndex: terminal.generationIndex,
    plan: context.claim.plan,
    providerAuthenticityVerified: false,
    providerEndpoint: context.claim.providerEndpoint,
    providerEndpointSha256:
      context.claim.providerEndpointSha256,
    schemaVersion: 2,
    stageBindingCount: hasSuccessTerminal
      ? (terminal as SuccessTerminal).stageBindingCount
      : 0,
    status: hasSuccessTerminal
      ? SUCCESS_STATUS
      : FAILURE_STATUS,
    summaryPrompt: context.claim.summaryPrompt,
    summaryProtocol: context.claim.summaryProtocol,
    terminal: terminalReference,
    terminalOutcome: hasSuccessTerminal
      ? "success"
      : "failure",
    transportPolicy: context.claim.transportPolicy,
    uncommittedCorpus: hasSuccessTerminal
      ? null
      : (terminal as FailureTerminal).uncommittedCorpus,
  };
  const receiptReference = await commitOrVerifyRootArtifact({
    bytes: serializeJson(receipt),
    outputRoot: context.outputRoot,
    path: "receipt.json",
  });
  return await verifyC6FlatSummaryGenerationCaptureRoot({
    expectedReceiptSha256: receiptReference.sha256,
    outputRoot: context.outputRoot,
  });
}

async function buildGenerationIndex(
  context: PublicationContext,
): Promise<{
  attemptCount: number;
  completedGenerationCount: number;
  index: GenerationIndex;
}> {
  await assertGenerationDirectories(context);
  const generations: GenerationIndexEntry[] = [];
  for (const claimed of context.claim.histories) {
    const root = `generations/${claimed.generationKey}`;
    const requestPath = join(
      context.artifactsRoot,
      root,
      "request.redacted.json",
    );
    const generationEntries = await readdir(
      join(context.artifactsRoot, root),
      { withFileTypes: true },
    );
    assertGenerationRootEntries(
      claimed.generationKey,
      generationEntries,
    );
    if (!(await pathExists(requestPath))) {
      const attemptEntries = await readdir(
        join(context.artifactsRoot, root, "attempts"),
      );
      if (
        attemptEntries.length !== 0 ||
        generationEntries.some(({ name }) =>
          name !== "attempts"
        )
      ) {
        throw new Error(
          "C6 flat-summary generation evidence exists without a request",
        );
      }
      continue;
    }
    const redactedRequest = referenceForBytes(
      `${root}/request.redacted.json`,
      await readC6StableRegularFile(
        requestPath,
        "flat-summary redacted request",
        MAX_JSON_BYTES,
        true,
      ),
    );
    const attempts = await buildAttemptIndex(
      context.artifactsRoot,
      claimed.generationKey,
    );
    const attemptManifestPath = join(
      context.artifactsRoot,
      root,
      "attempt-manifest.json",
    );
    const attemptManifest = await optionalReference(
      context.artifactsRoot,
      `${root}/attempt-manifest.json`,
      attemptManifestPath,
    );
    const providerArtifactPath = join(
      context.artifactsRoot,
      root,
      "provider-artifact.json",
    );
    const normalizedOutput = await optionalReference(
      context.artifactsRoot,
      `${root}/output.txt`,
      join(context.artifactsRoot, root, "output.txt"),
    );
    const rawToNormalizedIndex = await optionalReference(
      context.artifactsRoot,
      `${root}/normalization-index.json`,
      join(
        context.artifactsRoot,
        root,
        "normalization-index.json",
      ),
    );
    let accepted: GenerationIndexEntry["accepted"] = null;
    let uncommitted: GenerationIndexEntry["uncommitted"] = null;
    if (await pathExists(providerArtifactPath)) {
      if (
        attemptManifest === null ||
        normalizedOutput === null ||
        rawToNormalizedIndex === null
      ) {
        throw new Error(
          "C6 flat-summary accepted generation lacks committed prerequisites",
        );
      }
      accepted = {
        normalizedOutput,
        providerArtifact: await requiredReference(
          context.artifactsRoot,
          `${root}/provider-artifact.json`,
        ),
        rawToNormalizedIndex,
      };
    } else if (
      normalizedOutput !== null &&
      rawToNormalizedIndex === null
    ) {
      throw new Error(
        "C6 flat-summary output exists without its normalization index",
      );
    } else if (rawToNormalizedIndex !== null) {
      uncommitted = {
        normalizedOutput,
        rawToNormalizedIndex,
      };
    }
    generations.push({
      accepted,
      attemptManifest,
      attempts,
      generationKey: claimed.generationKey,
      history: claimed.history,
      historySourceSha256: claimed.historySourceSha256,
      redactedRequest,
      uncommitted,
    });
  }
  generations.sort((left, right) =>
    compareCodeUnits(left.generationKey, right.generationKey)
  );
  return {
    attemptCount: generations.reduce(
      (count, generation) =>
        count + generation.attempts.length,
      0,
    ),
    completedGenerationCount: generations.filter(
      ({ accepted }) => accepted !== null,
    ).length,
    index: {
      generations,
      schemaVersion: 2,
    },
  };
}

async function buildAttemptIndex(
  artifactsRoot: string,
  generationKey: string,
): Promise<AttemptIndex[]> {
  const root = `generations/${generationKey}/attempts`;
  const absoluteRoot = join(artifactsRoot, root);
  const entries = await readdir(absoluteRoot, {
    withFileTypes: true,
  });
  const ordinals = new Set<number>();
  for (const entry of entries) {
    if (
      !entry.isFile() ||
      entry.isSymbolicLink()
    ) {
      throw new Error(
        "C6 flat-summary attempts contain a non-file",
      );
    }
    const match =
      /^(\d{3})\.(decision\.json|response\.json|response\.raw)$/u
        .exec(entry.name);
    if (match === null) {
      throw new Error(
        "C6 flat-summary attempts contain an unexpected file",
      );
    }
    ordinals.add(Number(match[1]));
  }
  const sorted = [...ordinals].sort((left, right) =>
    left - right
  );
  if (sorted.some((ordinal, index) => ordinal !== index + 1)) {
    throw new Error(
      "C6 flat-summary attempt ordinals are not contiguous",
    );
  }
  const attempts = [];
  for (const attempt of sorted) {
    const prefix = `${String(attempt).padStart(3, "0")}.`;
    const decisionArtifact = await requiredReference(
      artifactsRoot,
      `${root}/${prefix}decision.json`,
    );
    const rawResponse = await optionalReference(
      artifactsRoot,
      `${root}/${prefix}response.raw`,
      join(absoluteRoot, `${prefix}response.raw`),
    );
    const responseMarker = await optionalReference(
      artifactsRoot,
      `${root}/${prefix}response.json`,
      join(absoluteRoot, `${prefix}response.json`),
    );
    attempts.push({
      attempt,
      decisionArtifact,
      rawResponse,
      responseMarker,
    });
  }
  return attempts;
}

async function synthesizeInterruptedDecisions(
  context: PublicationContext,
): Promise<void> {
  for (const claimed of context.claim.histories) {
    const root =
      `generations/${claimed.generationKey}/attempts`;
    const absoluteRoot = join(context.artifactsRoot, root);
    const entries = await readdir(absoluteRoot);
    const ordinals = new Set<number>();
    for (const entry of entries) {
      const match =
        /^(\d{3})\.(decision\.json|response\.json|response\.raw)$/u
          .exec(entry);
      if (match !== null) {
        ordinals.add(Number(match[1]));
      }
    }
    for (const attempt of [...ordinals].sort((left, right) =>
      left - right
    )) {
      const prefix = `${String(attempt).padStart(3, "0")}.`;
      const decisionPath = join(
        absoluteRoot,
        `${prefix}decision.json`,
      );
      if (await pathExists(decisionPath)) {
        continue;
      }
      const rawPath = join(
        absoluteRoot,
        `${prefix}response.raw`,
      );
      const markerPath = join(
        absoluteRoot,
        `${prefix}response.json`,
      );
      const hasRaw = await pathExists(rawPath);
      const hasMarker = await pathExists(markerPath);
      if (!hasRaw && !hasMarker) {
        continue;
      }
      if (hasMarker && !hasRaw) {
        throw new Error(
          "C6 flat-summary response marker lacks raw bytes",
        );
      }
      let marker: ResponseMarker | null = null;
      if (hasMarker) {
        marker = parseCompactExact(
          await readC6StableRegularFile(
            markerPath,
            "flat-summary response marker",
            MAX_JSON_BYTES,
            true,
          ),
          responseMarkerSchema,
          "C6 flat-summary response marker is invalid",
        );
      }
      const rawResponseSha256 = hasRaw
        ? sha256(await readC6StableRegularFile(
          rawPath,
          "flat-summary interrupted raw response",
          MAX_JSON_BYTES,
          true,
        ))
        : undefined;
      if (
        marker !== null &&
        marker.rawResponse.sha256 !== rawResponseSha256
      ) {
        throw new Error(
          "C6 flat-summary interrupted raw response changed",
        );
      }
      const decision: AttemptDecision = {
        attempt,
        ...(marker === null
          ? {}
          : {
            completedAt: marker.completedAt,
            startedAt: marker.startedAt,
            status: marker.status,
          }),
        decision: PROCESS_INTERRUPTION_DECISION,
        generationKey: claimed.generationKey,
        ...(rawResponseSha256 === undefined
          ? {}
          : { rawResponseSha256 }),
        schemaVersion: 1,
        transportError: {
          sanitized: true,
          type: "process-interruption",
        },
      };
      await commitArtifact({
        apiToken: context.apiToken,
        bytes: serializeC6FlatSummaryCanonicalJson(decision),
        outputRoot: context.outputRoot,
        path: `${root}/${prefix}decision.json`,
      });
    }
  }
}

async function commitIncompleteAttemptManifests(
  context: PublicationContext,
): Promise<void> {
  for (const claimed of context.claim.histories) {
    const root = `generations/${claimed.generationKey}`;
    const requestPath = join(
      context.artifactsRoot,
      root,
      "request.redacted.json",
    );
    const manifestPath = join(
      context.artifactsRoot,
      root,
      "attempt-manifest.json",
    );
    if (
      !(await pathExists(requestPath)) ||
      await pathExists(manifestPath)
    ) {
      continue;
    }
    const attempts = await loadDecisionArtifacts(
      context.artifactsRoot,
      claimed.generationKey,
    );
    if (attempts.length === 0) {
      continue;
    }
    const requestSha256 = sha256(
      await readC6StableRegularFile(
        requestPath,
        "flat-summary failed request",
        MAX_JSON_BYTES,
        true,
      ),
    );
    await commitArtifact({
      apiToken: context.apiToken,
      bytes: serializeC6FlatSummaryCanonicalJson({
        attempts: attempts.map(decisionManifestEntry),
        generationKey: claimed.generationKey,
        requestSha256,
        schemaVersion: 1,
      }),
      outputRoot: context.outputRoot,
      path: `${root}/attempt-manifest.json`,
    });
  }
}

interface VerifiedGenerationIndex {
  attemptCount: number;
  completedGenerationCount: number;
}

async function verifyGenerationIndex(input: {
  artifactsRoot: string;
  claim: Claim;
  index: GenerationIndex;
  validated: C6FlatSummaryValidatedGenerationInputs;
}): Promise<VerifiedGenerationIndex> {
  const claimedByKey = new Map(
    input.claim.histories.map((history) => [
      history.generationKey,
      history,
    ]),
  );
  const claimedKeys = input.claim.histories.map(
    ({ generationKey }) => generationKey,
  );
  const sortedKeys = input.index.generations.map(
    ({ generationKey }) => generationKey,
  );
  if (
    new Set(sortedKeys).size !== sortedKeys.length ||
    sortedKeys.some((key, index) =>
      key !== claimedKeys[index] ||
      !claimedByKey.has(key)
    ) ||
    input.index.generations.slice(0, -1).some(
      ({ accepted }) => accepted === null,
    )
  ) {
    throw new Error(
      "C6 flat-summary generation index is not a reachable claim prefix",
    );
  }
  for (const generation of input.index.generations) {
    const claimed = claimedByKey.get(
      generation.generationKey,
    )!;
    const root = `generations/${generation.generationKey}`;
    if (
      !sameJson(generation.history, claimed.history) ||
      generation.historySourceSha256 !==
        claimed.historySourceSha256 ||
      generation.history.sha256 !==
        generation.historySourceSha256 ||
      generation.redactedRequest.path !==
        `${root}/request.redacted.json` ||
      (
        generation.attemptManifest !== null &&
        generation.attemptManifest.path !==
          `${root}/attempt-manifest.json`
      )
    ) {
      throw new Error(
        "C6 flat-summary generation index binding changed",
      );
    }
    await Promise.all([
      readReference(input.artifactsRoot, generation.history),
      readReference(
        input.artifactsRoot,
        generation.redactedRequest,
      ),
    ]);
    const decisions = [];
    for (
      let index = 0;
      index < generation.attempts.length;
      index += 1
    ) {
      const attempt = generation.attempts[index]!;
      const prefix =
        `${root}/attempts/${String(index + 1).padStart(3, "0")}.`;
      if (
        attempt.attempt !== index + 1 ||
        attempt.decisionArtifact.path !==
          `${prefix}decision.json` ||
        (
          attempt.rawResponse !== null &&
          attempt.rawResponse.path !== `${prefix}response.raw`
        ) ||
        (
          attempt.responseMarker !== null &&
          attempt.responseMarker.path !==
            `${prefix}response.json`
        )
      ) {
        throw new Error(
          "C6 flat-summary attempt index path changed",
        );
      }
      const decision = parseCompactExact(
        await readReference(
          input.artifactsRoot,
          attempt.decisionArtifact,
        ),
        attemptDecisionSchema,
        "C6 flat-summary attempt decision is invalid",
      );
      if (
        decision.generationKey !==
          generation.generationKey ||
        decision.attempt !== attempt.attempt
      ) {
        throw new Error(
          "C6 flat-summary attempt decision identity changed",
        );
      }
      if (attempt.responseMarker === null) {
        if (
          attempt.rawResponse !== null &&
          decision.decision !==
            PROCESS_INTERRUPTION_DECISION
        ) {
          throw new Error(
            "C6 flat-summary raw response lacks its marker",
          );
        }
      } else {
        if (attempt.rawResponse === null) {
          throw new Error(
            "C6 flat-summary response marker lacks raw bytes",
          );
        }
        const marker = parseCompactExact(
          await readReference(
            input.artifactsRoot,
            attempt.responseMarker,
          ),
          responseMarkerSchema,
          "C6 flat-summary response marker is invalid",
        );
        if (
          marker.generationKey !==
            generation.generationKey ||
          marker.attempt !== attempt.attempt ||
          marker.status !== decision.status ||
          marker.startedAt !== decision.startedAt ||
          marker.completedAt !== decision.completedAt ||
          !sameJson(marker.rawResponse, attempt.rawResponse)
        ) {
          throw new Error(
            "C6 flat-summary response marker and decision differ",
          );
        }
      }
      if (attempt.rawResponse === null) {
        if (decision.rawResponseSha256 !== undefined) {
          throw new Error(
            "C6 flat-summary decision references missing raw bytes",
          );
        }
      } else {
        if (
          attempt.rawResponse.bytes >
            C6_FLAT_SUMMARY_MAX_RESPONSE_BYTES
        ) {
          throw new Error(
            "C6 flat-summary raw response exceeds the frozen byte limit",
          );
        }
        await readReference(
          input.artifactsRoot,
          attempt.rawResponse,
        );
        if (
          decision.rawResponseSha256 !==
            attempt.rawResponse.sha256
        ) {
          throw new Error(
            "C6 flat-summary decision raw hash differs",
          );
        }
      }
      validateDecisionShape(decision);
      decisions.push(decision);
    }
    if (generation.attemptManifest !== null) {
      if (generation.attempts.length === 0) {
        throw new Error(
          "C6 flat-summary empty attempt manifest is unreachable",
        );
      }
      const manifest = parseCompactExact(
        await readReference(
          input.artifactsRoot,
          generation.attemptManifest,
        ),
        attemptManifestSchema,
        "C6 flat-summary attempt manifest is invalid",
      );
      if (
        manifest.generationKey !==
          generation.generationKey ||
        manifest.requestSha256 !==
          generation.redactedRequest.sha256 ||
        !sameJson(
          manifest.attempts,
          decisions.map(decisionManifestEntry),
        )
      ) {
        throw new Error(
          "C6 flat-summary attempt manifest and journal differ",
        );
      }
    } else if (generation.attempts.length > 0) {
      throw new Error(
        "C6 flat-summary attempt manifest is missing",
      );
    }
    verifyAttemptSequenceReachability(
      decisions,
      generation,
    );
    if (generation.accepted !== null) {
      if (
        generation.uncommitted !== null ||
        generation.attemptManifest === null ||
        generation.accepted.normalizedOutput.path !==
          `${root}/output.txt` ||
        generation.accepted.providerArtifact.path !==
          `${root}/provider-artifact.json` ||
        generation.accepted.rawToNormalizedIndex.path !==
          `${root}/normalization-index.json`
      ) {
        throw new Error(
          "C6 flat-summary accepted generation path changed",
        );
      }
      await Promise.all([
        readReference(
          input.artifactsRoot,
          generation.accepted.normalizedOutput,
        ),
        readReference(
          input.artifactsRoot,
          generation.accepted.providerArtifact,
        ),
        readReference(
          input.artifactsRoot,
          generation.accepted.rawToNormalizedIndex,
        ),
      ]);
    } else if (generation.uncommitted !== null) {
      if (
        generation.attemptManifest === null ||
        generation.uncommitted.rawToNormalizedIndex.path !==
          `${root}/normalization-index.json` ||
        (
          generation.uncommitted.normalizedOutput !== null &&
          generation.uncommitted.normalizedOutput.path !==
            `${root}/output.txt`
        )
      ) {
        throw new Error(
          "C6 flat-summary uncommitted generation path changed",
        );
      }
      await Promise.all([
        readReference(
          input.artifactsRoot,
          generation.uncommitted.rawToNormalizedIndex,
        ),
        ...(generation.uncommitted.normalizedOutput === null
          ? []
          : [
            readReference(
              input.artifactsRoot,
              generation.uncommitted.normalizedOutput,
            ),
          ]),
      ]);
    }
  }
  return {
    attemptCount: input.index.generations.reduce(
      (count, generation) =>
        count + generation.attempts.length,
      0,
    ),
    completedGenerationCount:
      input.index.generations.filter(
        ({ accepted }) => accepted !== null,
      ).length,
  };
}

async function verifySuccessfulGenerationSemantics(input: {
  artifactsRoot: string;
  corpus: C6FlatSummaryCorpus;
  index: GenerationIndex;
  plan: C6CandidatePlan;
  promptBytes: Uint8Array;
  protocolBytes: Uint8Array;
  receipt: Receipt;
  validated: C6FlatSummaryValidatedGenerationInputs;
}): Promise<void> {
  const corpusVerification =
    await verifyRetainedGenerationSemantics(input);
  if (corpusVerification === null) {
    throw new Error(
      "C6 flat-summary success corpus verification is missing",
    );
  }
  if (
    input.receipt.generationCount !==
      corpusVerification.generationCount ||
    input.receipt.stageBindingCount !==
      corpusVerification.stageBindingCount
  ) {
    throw new Error(
      "C6 flat-summary receipt corpus counts differ",
    );
  }
}

async function verifyRetainedGenerationSemantics(input: {
  artifactsRoot: string;
  corpus: C6FlatSummaryCorpus | null;
  index: GenerationIndex;
  plan: C6CandidatePlan;
  promptBytes: Uint8Array;
  protocolBytes: Uint8Array;
  receipt: Receipt;
  validated: C6FlatSummaryValidatedGenerationInputs;
}): Promise<{
  generationCount: number;
  stageBindingCount: number;
} | null> {
  if (
    sha256(input.promptBytes) !==
      input.receipt.summaryPrompt.sha256 ||
    sha256(input.protocolBytes) !==
      input.receipt.summaryProtocol.sha256
  ) {
    throw new Error(
      "C6 flat-summary prompt or protocol hash changed",
    );
  }
  const expected = [...input.validated.generationBindings]
    .sort((left, right) =>
      compareCodeUnits(left.generationKey, right.generationKey)
    );
  let corpusVerification: ReturnType<
    typeof verifyC6FlatSummaryCorpusCompleteness
  > | null = null;
  if (input.corpus !== null) {
    if (
      input.index.generations.length !== expected.length ||
      input.index.generations.some((generation, index) =>
        generation.generationKey !==
          expected[index]!.generationKey ||
        generation.accepted === null ||
        generation.uncommitted !== null
      )
    ) {
      throw new Error(
        "C6 flat-summary corpus generation set does not match",
      );
    }
    corpusVerification =
      verifyC6FlatSummaryCorpusCompleteness(
        input.corpus,
        buildC6FlatSummaryCorpusExpectation(input.plan),
      );
  }
  const corpusByKey = new Map(
    input.corpus?.generationReceipts.map((receipt) => [
      receipt.generationKey,
      receipt,
    ]) ?? [],
  );
  const prompt = Buffer.from(input.promptBytes).toString("utf8");
  for (const generation of input.index.generations) {
    const historyBytes = await readReference(
      input.artifactsRoot,
      generation.history,
    );
    const history = historyBytes.toString("utf8");
    const expectedRequestBody = {
      max_tokens: input.validated.maxInjectedTokens,
      messages: [
        {
          content: prompt,
          role: "system",
        },
        {
          content: history,
          role: "user",
        },
      ],
      model: input.validated.model,
      n: 1,
      seed: C6_FLAT_SUMMARY_REQUEST_SEED,
      stream: false,
      temperature: 0,
    };
    const expectedRequest = {
      body: expectedRequestBody,
      bodySha256: sha256(
        serializeC6FlatSummaryCanonicalJson(
          expectedRequestBody,
        ),
      ),
      headers: {
        accept: "application/json",
        authorization: "Bearer [REDACTED]",
        "content-type": "application/json",
      },
      method: "POST",
      url: input.validated.endpoint,
    };
    const requestBytes = await readReference(
      input.artifactsRoot,
      generation.redactedRequest,
    );
    const request = parseCompactExact(
      requestBytes,
      redactedRequestSchema,
      "C6 flat-summary redacted request is invalid",
    );
    if (
      !requestBytes.equals(
        serializeC6FlatSummaryCanonicalJson(
          expectedRequest,
        ),
      ) ||
      !sameJson(request, expectedRequest)
    ) {
      throw new Error(
        "C6 flat-summary redacted request does not match frozen inputs",
      );
    }
    const decisions = await loadDecisionArtifacts(
      input.artifactsRoot,
      generation.generationKey,
    );
    for (let index = 0; index < decisions.length; index += 1) {
      const decision = decisions[index]!;
      const rawReference =
        generation.attempts[index]!.rawResponse;
      if (
        decision.status !== 200 ||
        decision.decision === PROCESS_INTERRUPTION_DECISION ||
        rawReference === null
      ) {
        continue;
      }
      const evaluation =
        evaluateC6FlatSummaryProviderResponse({
          expectedModel: input.validated.model,
          historySourceSha256:
            generation.historySourceSha256,
          maxInjectedTokens:
            input.validated.maxInjectedTokens,
          responseBytes: await readReference(
            input.artifactsRoot,
            rawReference,
          ),
        });
      if (evaluation.decision !== decision.decision) {
        throw new Error(
          "C6 flat-summary attempt decision does not derive from raw response",
        );
      }
    }
    const committed = generation.accepted;
    const uncommitted = generation.uncommitted;
    if (committed === null && uncommitted === null) {
      continue;
    }
    verifySuccessfulAttemptSequence(
      decisions,
      generation.attempts,
    );
    const finalAttempt = generation.attempts.at(-1)!;
    const finalDecision = decisions.at(-1)!;
    const rawResponse = await readReference(
      input.artifactsRoot,
      finalAttempt.rawResponse!,
    );
    const normalized =
      normalizeC6FlatSummaryProviderResponse(
        rawResponse,
        input.validated.model,
      );
    buildC6InjectionBudgetReceipt({
      arm: "flat-summary",
      compositionSha256:
        C6_FLAT_SUMMARY_INJECTION_COMPOSITION_SHA256,
      historySourceSha256:
        generation.historySourceSha256,
      injectedText: normalized.output,
      injectionMode: "content-injection",
      maxInjectedTokens:
        input.validated.maxInjectedTokens,
    });
    const normalizedOutput = committed?.normalizedOutput ??
      uncommitted?.normalizedOutput ??
      null;
    if (normalizedOutput !== null) {
      const outputBytes = await readReference(
        input.artifactsRoot,
        normalizedOutput,
      );
      if (
        !outputBytes.equals(Buffer.from(normalized.output))
      ) {
        throw new Error(
          "C6 flat-summary normalized output does not derive from raw response",
        );
      }
    }
    const rawToNormalizedIndex =
      committed?.rawToNormalizedIndex ??
      uncommitted!.rawToNormalizedIndex;
    const normalizationIndex = parseCompactExact(
      await readReference(
        input.artifactsRoot,
        rawToNormalizedIndex,
      ),
      normalizationIndexSchema,
      "C6 flat-summary normalization index is invalid",
    );
    const expectedNormalizationIndex = {
      model: {
        path: "$.model",
        value: normalized.model,
      },
      output: {
        path: "$.choices[0].message.content",
        sha256: sha256(normalized.output),
      },
      providerRequestId: {
        path: "$.id",
      },
      rawResponseSha256: sha256(rawResponse),
      schemaVersion: 1,
      usage: {
        cachedInputTokens: {
          path: normalized.cachedInputTokensPath,
          value: normalized.usage.cachedInputTokens,
        },
        inputTokens: {
          path: "$.usage.prompt_tokens",
          value: normalized.usage.inputTokens,
        },
        outputTokens: {
          path: "$.usage.completion_tokens",
          value: normalized.usage.outputTokens,
        },
      },
    };
    if (!sameJson(normalizationIndex, expectedNormalizationIndex)) {
      throw new Error(
        "C6 flat-summary raw-to-normalized index differs from raw response",
      );
    }
    if (committed === null) {
      continue;
    }
    const providerArtifact = parseCompactExact(
      await readReference(
        input.artifactsRoot,
        committed.providerArtifact,
      ),
      providerArtifactSchema,
      "C6 flat-summary provider artifact is invalid",
    );
    const expectedProviderArtifact = {
      attemptManifestSha256:
        generation.attemptManifest!.sha256,
      completedAt: finalDecision.completedAt,
      generationKey: generation.generationKey,
      historySourceSha256:
        generation.historySourceSha256,
      model: normalized.model,
      outputSha256: committed.normalizedOutput.sha256,
      planSha256: input.receipt.plan.sha256,
      provider: input.validated.provider,
      providerAuthenticityVerified: false,
      providerEndpoint: input.validated.endpoint,
      providerEndpointSha256:
        input.validated.providerEndpointSha256,
      providerRequestId: normalized.providerRequestId,
      rawResponseSha256: finalAttempt.rawResponse!.sha256,
      rawToNormalizedIndexSha256:
        committed.rawToNormalizedIndex.sha256,
      requestSha256: generation.redactedRequest.sha256,
      schemaVersion: 1,
      startedAt: decisions[0]!.startedAt,
      summaryPromptSha256:
        input.receipt.summaryPrompt.sha256,
      summaryProtocolSha256:
        input.receipt.summaryProtocol.sha256,
      usage: normalized.usage,
    };
    if (
      !sameJson(
        providerArtifact,
        expectedProviderArtifact,
      )
    ) {
      throw new Error(
        "C6 flat-summary provider artifact does not bind raw normalization",
      );
    }
    const corpusReceipt = corpusByKey.get(
      generation.generationKey,
    );
    if (
      input.corpus !== null &&
      (
        corpusReceipt === undefined ||
        corpusReceipt.historySourceSha256 !==
          generation.historySourceSha256 ||
        corpusReceipt.outputSha256 !==
          committed.normalizedOutput.sha256 ||
        corpusReceipt.providerArtifactSha256 !==
          committed.providerArtifact.sha256
      )
    ) {
      throw new Error(
        "C6 flat-summary corpus and generation semantics differ",
      );
    }
  }
  return corpusVerification === null
    ? null
    : {
      generationCount:
        corpusVerification.generationReceipts.structurallyVerified,
      stageBindingCount:
        corpusVerification.stageBindingReceipts.structurallyVerified,
    };
}

function verifySuccessfulAttemptSequence(
  decisions: readonly AttemptDecision[],
  attempts: readonly AttemptIndex[],
): void {
  if (
    decisions.length === 0 ||
    decisions.length !== attempts.length
  ) {
    throw new Error(
      "C6 flat-summary successful attempt sequence is empty",
    );
  }
  for (let index = 0; index < decisions.length; index += 1) {
    const decision = decisions[index]!;
    const attempt = attempts[index]!;
    if (
      decision.attempt !== index + 1 ||
      decision.startedAt === undefined ||
      decision.completedAt === undefined ||
      attempt.rawResponse === null ||
      attempt.responseMarker === null ||
      (
        index > 0 &&
        Date.parse(decision.startedAt) <
          Date.parse(decisions[index - 1]!.completedAt!)
      ) ||
      Date.parse(decision.completedAt) <
        Date.parse(decision.startedAt)
    ) {
      throw new Error(
        "C6 flat-summary successful attempt chronology is invalid",
      );
    }
    if (index === decisions.length - 1) {
      if (
        decision.decision !== "accepted-success" ||
        decision.status !== 200
      ) {
        throw new Error(
          "C6 flat-summary final attempt was not accepted",
        );
      }
      continue;
    }
    if (
      decision.decision !== "retry-transient-status" ||
      decision.status === undefined ||
      !C6_FLAT_SUMMARY_TRANSIENT_HTTP_STATUSES.includes(
        decision.status as
          typeof C6_FLAT_SUMMARY_TRANSIENT_HTTP_STATUSES[number],
      )
    ) {
      throw new Error(
        "C6 flat-summary pre-success attempt is not a frozen retry",
      );
    }
  }
}

function verifySuccessTerminal(input: {
  corpus: C6FlatSummaryCorpus;
  corpusReference: ArtifactReference;
  indexReference: ArtifactReference;
  receipt: Receipt;
  terminal: SuccessTerminal;
  validated: C6FlatSummaryValidatedGenerationInputs;
  verifiedIndex: VerifiedGenerationIndex;
}): void {
  if (
    input.receipt.status !== SUCCESS_STATUS ||
    input.receipt.terminalOutcome !== "success" ||
    input.receipt.corpus === null ||
    input.receipt.uncommittedCorpus !== null ||
    !sameJson(input.terminal.corpus, input.corpusReference) ||
    !sameJson(
      input.terminal.generationIndex,
      input.indexReference,
    ) ||
    input.terminal.generationCount !==
      input.verifiedIndex.completedGenerationCount ||
    input.receipt.generationCount !==
      input.terminal.generationCount ||
    input.receipt.attemptCount !==
      input.verifiedIndex.attemptCount ||
    input.receipt.stageBindingCount !==
      input.terminal.stageBindingCount ||
    input.terminal.generationCount !==
      input.validated.generationBindings.length ||
    input.corpus.providerAuthenticityVerified !== false
  ) {
    throw new Error(
      "C6 flat-summary success terminal or receipt differs",
    );
  }
}

function verifyFailureTerminal(input: {
  indexReference: ArtifactReference;
  receipt: Receipt;
  terminal: FailureTerminal;
  verifiedIndex: VerifiedGenerationIndex;
}): void {
  if (
    input.receipt.status !== FAILURE_STATUS ||
    input.receipt.terminalOutcome !== "failure" ||
    input.receipt.corpus !== null ||
    !sameJson(
      input.receipt.uncommittedCorpus,
      input.terminal.uncommittedCorpus,
    ) ||
    !sameJson(
      input.terminal.generationIndex,
      input.indexReference,
    ) ||
    input.terminal.attemptCount !==
      input.verifiedIndex.attemptCount ||
    input.terminal.completedGenerationCount !==
      input.verifiedIndex.completedGenerationCount ||
    input.receipt.attemptCount !==
      input.terminal.attemptCount ||
    input.receipt.generationCount !==
      input.terminal.completedGenerationCount ||
    input.receipt.stageBindingCount !== 0
  ) {
    throw new Error(
      "C6 flat-summary failure terminal or receipt differs",
    );
  }
}

function verifyReceiptCanonicalPaths(receipt: Receipt): void {
  const success = receipt.terminalOutcome === "success";
  if (
    receipt.generationIndex.path !== "generation-index.json" ||
    receipt.terminal.path !== (
      success
        ? "capture-terminal.json"
        : "capture-failure-terminal.json"
    ) ||
    (
      success
        ? (
          receipt.corpus?.path !== "corpus.json" ||
          receipt.uncommittedCorpus !== null
        )
        : (
          receipt.corpus !== null ||
          (
            receipt.uncommittedCorpus !== null &&
            receipt.uncommittedCorpus.path !== "corpus.json"
          )
        )
    )
  ) {
    throw new Error(
      "C6 flat-summary receipt artifact paths are not canonical",
    );
  }
}

function verifyReceiptClaimBindings(input: {
  claim: Claim;
  receipt: Receipt;
  validated: C6FlatSummaryValidatedGenerationInputs;
}): void {
  if (
    !sameJson(input.receipt.plan, input.claim.plan) ||
    !sameJson(
      input.receipt.summaryPrompt,
      input.claim.summaryPrompt,
    ) ||
    !sameJson(
      input.receipt.summaryProtocol,
      input.claim.summaryProtocol,
    ) ||
    input.receipt.providerEndpoint !==
      input.claim.providerEndpoint ||
    input.receipt.providerEndpointSha256 !==
      sha256(input.receipt.providerEndpoint) ||
    input.receipt.providerEndpointSha256 !==
      input.claim.providerEndpointSha256 ||
    !sameJson(
      input.receipt.transportPolicy,
      input.claim.transportPolicy,
    ) ||
    input.receipt.candidateManifestFrozen !== false ||
    input.receipt.codexRunReady !== false ||
    input.receipt.providerAuthenticityVerified !== false
  ) {
    throw new Error(
      "C6 flat-summary claim and receipt bindings differ",
    );
  }
  verifyClaimBindings(input.claim, input.validated);
}

function verifyClaimBindings(
  claim: Claim,
  validated: C6FlatSummaryValidatedGenerationInputs,
): void {
  if (
    claim.plan.path !== "inputs/plan.json" ||
    claim.summaryPrompt.path !== "inputs/summary-prompt.md" ||
    claim.summaryProtocol.path !==
      "inputs/summary-protocol.json" ||
    claim.providerEndpointSha256 !==
      validated.providerEndpointSha256 ||
    claim.plan.sha256 !== validated.planSha256 ||
    claim.summaryPrompt.sha256 !==
      validated.summaryPromptSha256 ||
    claim.summaryProtocol.sha256 !==
      validated.summaryProtocolSha256
  ) {
    throw new Error(
      "C6 flat-summary claim bindings differ from frozen inputs",
    );
  }
  const expectedHistories =
    validated.generationBindings.map((binding) => ({
      generationKey: binding.generationKey,
      historySourceSha256: binding.historySourceSha256,
    }));
  if (
    claim.histories.length !==
      expectedHistories.length ||
    claim.histories.some((history, index) =>
      history.generationKey !==
        expectedHistories[index]!.generationKey ||
      history.history.path !==
        `inputs/histories/${history.generationKey}.history` ||
      history.historySourceSha256 !==
        expectedHistories[index]!.historySourceSha256 ||
      history.history.sha256 !==
        history.historySourceSha256
    )
  ) {
    throw new Error(
      "C6 flat-summary claimed histories differ from plan",
    );
  }
}

function collectReferencedPaths(input: {
  claim: Claim;
  index: GenerationIndex;
  receipt: Receipt;
}): Set<string> {
  return new Set([
    "capture-claim.json",
    input.receipt.generationIndex.path,
    input.receipt.plan.path,
    input.receipt.summaryPrompt.path,
    input.receipt.summaryProtocol.path,
    input.receipt.terminal.path,
    ...(input.receipt.corpus === null
      ? []
      : [input.receipt.corpus.path]),
    ...(input.receipt.uncommittedCorpus === null
      ? []
      : [input.receipt.uncommittedCorpus.path]),
    ...input.claim.histories.map(({ history }) => history.path),
    ...input.index.generations.flatMap((generation) => [
      generation.redactedRequest.path,
      ...(generation.attemptManifest === null
        ? []
        : [generation.attemptManifest.path]),
      ...generation.attempts.flatMap((attempt) => [
        attempt.decisionArtifact.path,
        ...(attempt.rawResponse === null
          ? []
          : [attempt.rawResponse.path]),
        ...(attempt.responseMarker === null
          ? []
          : [attempt.responseMarker.path]),
      ]),
      ...(generation.accepted === null
        ? []
        : [
          generation.accepted.normalizedOutput.path,
          generation.accepted.providerArtifact.path,
          generation.accepted.rawToNormalizedIndex.path,
        ]),
      ...(generation.uncommitted === null
        ? []
        : [
          generation.uncommitted.rawToNormalizedIndex.path,
          ...(generation.uncommitted.normalizedOutput === null
            ? []
            : [generation.uncommitted.normalizedOutput.path]),
        ]),
    ]),
  ]);
}

async function loadClaim(
  artifactsRoot: string,
): Promise<Claim> {
  return parseCompactExact(
    await readNamedReference(
      artifactsRoot,
      "capture-claim.json",
    ),
    claimSchema,
    "C6 flat-summary capture claim is invalid",
  );
}

async function verifyClaimAgainstExpectedInputs(input: {
  artifactsRoot: string;
  claim: Claim;
  histories: C6FlatSummaryGenerationFinalizationInput[
    "histories"
  ];
  planBytes: Uint8Array;
  summaryPromptBytes: Uint8Array;
  summaryProtocolBytes: Uint8Array;
  validated: C6FlatSummaryValidatedGenerationInputs;
}): Promise<void> {
  const references = [
    [input.claim.plan, input.planBytes],
    [input.claim.summaryPrompt, input.summaryPromptBytes],
    [input.claim.summaryProtocol, input.summaryProtocolBytes],
  ] as const;
  for (const [reference, expectedBytes] of references) {
    const actual = await readReference(
      input.artifactsRoot,
      reference,
    );
    if (!actual.equals(Buffer.from(expectedBytes))) {
      throw new Error(
        "C6 flat-summary finalize-only input differs from claim",
      );
    }
  }
  const histories = new Map(
    input.histories.map((history) => [
      history.generationKey,
      Buffer.from(history.bytes),
    ]),
  );
  if (histories.size !== input.claim.histories.length) {
    throw new Error(
      "C6 flat-summary finalize-only history set differs",
    );
  }
  for (const claimed of input.claim.histories) {
    const expected = histories.get(claimed.generationKey);
    const actual = await readReference(
      input.artifactsRoot,
      claimed.history,
    );
    if (
      expected === undefined ||
      !actual.equals(expected) ||
      sha256(actual) !== claimed.historySourceSha256
    ) {
      throw new Error(
        "C6 flat-summary finalize-only history differs",
      );
    }
  }
  verifyClaimBindings(input.claim, input.validated);
}

async function loadDecisionArtifacts(
  artifactsRoot: string,
  generationKey: string,
): Promise<AttemptDecision[]> {
  const root = join(
    artifactsRoot,
    "generations",
    generationKey,
    "attempts",
  );
  const entries = (await readdir(root))
    .filter((entry) => /^\d{3}\.decision\.json$/u.test(entry))
    .sort(compareCodeUnits);
  const decisions = [];
  for (const [index, entry] of entries.entries()) {
    const decision = parseCompactExact(
      await readC6StableRegularFile(
        join(root, entry),
        "flat-summary attempt decision",
        MAX_JSON_BYTES,
        true,
      ),
      attemptDecisionSchema,
      "C6 flat-summary attempt decision is invalid",
    );
    if (
      decision.generationKey !== generationKey ||
      decision.attempt !== index + 1 ||
      entry !==
        `${String(index + 1).padStart(3, "0")}.decision.json`
    ) {
      throw new Error(
        "C6 flat-summary attempt decision sequence changed",
      );
    }
    validateDecisionShape(decision);
    decisions.push(decision);
  }
  return decisions;
}

function decisionManifestEntry(
  decision: AttemptDecision,
): z.infer<typeof attemptManifestEntrySchema> {
  return {
    attempt: decision.attempt,
    ...(decision.completedAt === undefined
      ? {}
      : { completedAt: decision.completedAt }),
    decision: decision.decision,
    ...(decision.rawResponseSha256 === undefined
      ? {}
      : {
        rawResponseSha256:
          decision.rawResponseSha256,
      }),
    ...(decision.startedAt === undefined
      ? {}
      : { startedAt: decision.startedAt }),
    ...(decision.status === undefined
      ? {}
      : { status: decision.status }),
    ...(decision.transportError === undefined
      ? {}
      : {
        transportError: {
          ...decision.transportError,
        },
      }),
  };
}

function validateDecisionShape(
  decision: AttemptDecision,
): void {
  if (decision.decision === PROCESS_INTERRUPTION_DECISION) {
    if (
      decision.rawResponseSha256 === undefined ||
      decision.transportError?.type !==
        "process-interruption" ||
      (
        decision.status === undefined
          ? (
            decision.startedAt !== undefined ||
            decision.completedAt !== undefined
          )
          : (
            decision.startedAt === undefined ||
            decision.completedAt === undefined
          )
      )
    ) {
      throw new Error(
        "C6 flat-summary interruption decision is invalid",
      );
    }
    return;
  }
  if (
    decision.startedAt === undefined ||
    decision.completedAt === undefined
  ) {
    throw new Error(
      "C6 flat-summary attempt timestamps are missing",
    );
  }
  if (
    Date.parse(decision.completedAt) <
      Date.parse(decision.startedAt)
  ) {
    throw new Error(
      "C6 flat-summary attempt clock moved backwards",
    );
  }
  const hasRaw = decision.rawResponseSha256 !== undefined;
  const transient = decision.status !== undefined &&
    C6_FLAT_SUMMARY_TRANSIENT_HTTP_STATUSES.includes(
      decision.status as
        typeof C6_FLAT_SUMMARY_TRANSIENT_HTTP_STATUSES[number],
    );
  switch (decision.decision) {
    case "accepted-success":
    case "rejected-invalid-json":
    case "rejected-invalid-response-shape":
    case "rejected-invalid-usage":
    case "rejected-model-mismatch":
    case "rejected-output-over-budget":
      if (
        decision.status !== 200 ||
        !hasRaw ||
        decision.transportError !== undefined
      ) {
        throw new Error(
          "C6 flat-summary HTTP 200 decision shape is invalid",
        );
      }
      return;
    case "retry-transient-status":
      if (
        !transient ||
        !hasRaw ||
        decision.attempt >= 3 ||
        decision.transportError !== undefined
      ) {
        throw new Error(
          "C6 flat-summary transient decision shape is invalid",
        );
      }
      return;
    case "rejected-transient-status-exhausted":
      if (
        !transient ||
        !hasRaw ||
        decision.attempt !== 3 ||
        decision.transportError !== undefined
      ) {
        throw new Error(
          "C6 flat-summary exhausted decision shape is invalid",
        );
      }
      return;
    case "rejected-retry-delay-error":
      if (
        !transient ||
        !hasRaw ||
        decision.attempt >= 3 ||
        decision.transportError?.type !== "retry-delay-threw"
      ) {
        throw new Error(
          "C6 flat-summary retry-delay decision shape is invalid",
        );
      }
      return;
    case "rejected-non-retryable-status":
      if (
        decision.status === undefined ||
        decision.status === 200 ||
        transient ||
        !hasRaw ||
        decision.transportError !== undefined
      ) {
        throw new Error(
          "C6 flat-summary terminal HTTP decision shape is invalid",
        );
      }
      return;
    case "rejected-transport-error":
      if (
        hasRaw ||
        decision.transportError === undefined ||
        [
          "process-interruption",
          "retry-delay-threw",
        ].includes(decision.transportError.type) ||
        (
          [
            "authorization-material-detected",
            "response-byte-limit-exceeded",
          ].includes(decision.transportError.type) &&
          decision.status === undefined
        ) ||
        (
          [
            "invalid-response",
            "request-timeout",
            "transport-threw",
          ].includes(decision.transportError.type) &&
          decision.status !== undefined
        )
      ) {
        throw new Error(
          "C6 flat-summary transport decision shape is invalid",
        );
      }
      return;
    default:
      throw new Error(
        "C6 flat-summary decision shape is unsupported",
      );
  }
}

function verifyAttemptSequenceReachability(
  decisions: readonly AttemptDecision[],
  generation: GenerationIndexEntry,
): void {
  if (decisions.length !== generation.attempts.length) {
    throw new Error(
      "C6 flat-summary attempt journal length changed",
    );
  }
  for (let index = 0; index < decisions.length; index += 1) {
    const decision = decisions[index]!;
    const previous = decisions[index - 1];
    if (
      (
        index < decisions.length - 1 &&
        decision.decision !== "retry-transient-status"
      ) ||
      (
        index === decisions.length - 1 &&
        decision.decision === "retry-transient-status" &&
        (
          generation.accepted !== null ||
          generation.uncommitted !== null ||
          decision.attempt >= 3
        )
      ) ||
      (
        previous?.completedAt !== undefined &&
        decision.startedAt !== undefined &&
        Date.parse(decision.startedAt) <
          Date.parse(previous.completedAt)
      )
    ) {
      throw new Error(
        "C6 flat-summary attempt sequence is unreachable",
      );
    }
  }
  if (
    (
      generation.accepted !== null ||
      generation.uncommitted !== null
    ) &&
    decisions.at(-1)?.decision !== "accepted-success"
  ) {
    throw new Error(
      "C6 flat-summary retained output lacks an accepted decision",
    );
  }
}

function assertKnownGeneration(
  claim: Claim,
  generationKey: string,
): Claim["histories"][number] {
  const history = claim.histories.find((candidate) =>
    candidate.generationKey === generationKey
  );
  if (history === undefined) {
    throw new Error(
      "C6 flat-summary evidence uses an unknown generation",
    );
  }
  return history;
}

async function assertGenerationDirectories(
  context: PublicationContext,
): Promise<void> {
  const root = join(context.artifactsRoot, "generations");
  const entries = await readdir(root, {
    withFileTypes: true,
  });
  entries.sort((left, right) =>
    compareCodeUnits(left.name, right.name)
  );
  const expected = context.claim.histories.map(
    ({ generationKey }) => generationKey,
  );
  if (
    entries.length !== expected.length ||
    entries.some((entry, index) =>
      entry.name !== expected[index] ||
      !entry.isDirectory() ||
      entry.isSymbolicLink()
    )
  ) {
    throw new Error(
      "C6 flat-summary generation directories differ from claim",
    );
  }
}

function assertGenerationRootEntries(
  generationKey: string,
  entries: Dirent<string>[],
): void {
  const allowed = new Set([
    "attempt-manifest.json",
    "attempts",
    "normalization-index.json",
    "output.txt",
    "provider-artifact.json",
    "request.redacted.json",
  ]);
  for (const entry of entries) {
    if (
      !allowed.has(entry.name) ||
      entry.isSymbolicLink() ||
      (
        entry.name === "attempts"
          ? !entry.isDirectory()
          : !entry.isFile()
      )
    ) {
      throw new Error(
        `C6 flat-summary generation ${generationKey} has an unexpected entry`,
      );
    }
  }
}

function captureErrorIdentity(
  error: unknown,
): FailureTerminal["error"] {
  const name = error instanceof Error
    ? (
      error.constructor.name === "C6FlatSummaryCaptureError"
        ? "C6FlatSummaryCaptureError" as const
        : "Error" as const
    )
    : "UnknownError" as const;
  const message = error instanceof Error
    ? error.message
    : String(error);
  return {
    messageSha256: sha256(message),
    name,
  };
}

async function commitArtifact(input: {
  apiToken: string;
  bytes: string | Uint8Array;
  outputRoot: string;
  path: string;
}): Promise<ArtifactReference> {
  const bytes = Buffer.from(input.bytes);
  assertNoApiToken(bytes, input.apiToken);
  await commitCreateOnlyBytes(
    input.outputRoot,
    `artifacts/${input.path}`,
    bytes,
  );
  return referenceForBytes(input.path, bytes);
}

async function commitOrVerifyArtifact(input: {
  apiToken: string;
  bytes: string | Uint8Array;
  outputRoot: string;
  path: string;
}): Promise<ArtifactReference> {
  const bytes = Buffer.from(input.bytes);
  assertNoApiToken(bytes, input.apiToken);
  try {
    return await commitArtifact(input);
  } catch (error) {
    if (!hasErrorCode(error, "EEXIST")) {
      throw error;
    }
  }
  const existing = await readC6StableRegularFile(
    join(input.outputRoot, "artifacts", input.path),
    `flat-summary existing artifact ${input.path}`,
    undefined,
    true,
  );
  if (!existing.equals(bytes)) {
    throw new Error(
      "C6 flat-summary existing artifact differs",
    );
  }
  return referenceForBytes(input.path, existing);
}

async function commitOrVerifyRootArtifact(input: {
  bytes: string | Uint8Array;
  outputRoot: string;
  path: "receipt.json";
}): Promise<ArtifactReference> {
  const bytes = Buffer.from(input.bytes);
  try {
    await commitCreateOnlyBytes(
      input.outputRoot,
      input.path,
      bytes,
    );
  } catch (error) {
    if (!hasErrorCode(error, "EEXIST")) {
      throw error;
    }
    const existing = await readC6StableRegularFile(
      join(input.outputRoot, input.path),
      "flat-summary existing receipt",
      4 * 1_024 * 1_024,
      true,
    );
    if (!existing.equals(bytes)) {
      throw new Error(
        "C6 flat-summary existing receipt differs",
      );
    }
  }
  return referenceForBytes(input.path, bytes);
}

async function commitCreateOnlyBytes(
  root: string,
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  if (!isKnownPublicationPath(path)) {
    throw new Error(
      "C6 flat-summary create-only path is invalid",
    );
  }
  const finalPath = join(root, path);
  const parent = dirname(finalPath);
  await assertC6NoSymlinkPathComponents(
    parent,
    "C6 flat-summary publication directory",
  );
  const pendingPath = join(
    parent,
    `.${basename(finalPath)}.${sha256(bytes)}.pending`,
  );
  const handle = await open(
    pendingPath,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    FILE_MODE,
  );
  let closed = false;
  let linked = false;
  try {
    await handle.writeFile(bytes);
    await handle.chmod(FILE_MODE);
    await handle.sync();
    await handle.close();
    closed = true;
    await link(pendingPath, finalPath);
    linked = true;
    await syncDirectory(parent);
    await unlink(pendingPath);
    await syncDirectory(parent);
  } catch (error) {
    if (!closed) {
      await handle.close().catch(() => undefined);
    }
    if (!linked) {
      await unlink(pendingPath).catch(() => undefined);
    }
    throw error;
  }
}

async function recoverPendingArtifacts(root: string): Promise<void> {
  const canonicalRoot = await canonicalExistingDirectory(
    root,
    "flat-summary pending-recovery root",
  );
  await recoverPendingDirectory(canonicalRoot, canonicalRoot);
}

async function recoverPendingDirectory(
  outputRoot: string,
  directory: string,
): Promise<void> {
  const entries = await readdir(directory, {
    withFileTypes: true,
  });
  entries.sort((left, right) =>
    compareCodeUnits(left.name, right.name)
  );
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(
        "C6 flat-summary pending recovery rejects symlinks",
      );
    }
    if (entry.isDirectory()) {
      await recoverPendingDirectory(outputRoot, path);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(
        "C6 flat-summary pending recovery rejects non-files",
      );
    }
    const match =
      /^\.([^/]+)\.([a-f0-9]{64})\.pending$/u
        .exec(entry.name);
    if (match === null) {
      if (entry.name.endsWith(".pending")) {
        throw new Error(
          "C6 flat-summary pending artifact is unknown",
        );
      }
      continue;
    }
    const finalPath = join(directory, match[1]!);
    const expectedSha256 = match[2]!;
    const relativePath = relative(outputRoot, finalPath)
      .split(sep)
      .join("/");
    if (!isKnownPublicationPath(relativePath)) {
      throw new Error(
        "C6 flat-summary pending artifact is unknown",
      );
    }
    const pendingStat = await lstat(path);
    const pendingBytes = await readC6StableRegularFile(
      path,
      "flat-summary pending artifact",
      undefined,
      false,
    );
    const finalStat = await lstat(finalPath).catch(
      (error: unknown) => {
        if (hasErrorCode(error, "ENOENT")) {
          return null;
        }
        throw error;
      },
    );
    if (
      !pendingStat.isFile() ||
      pendingStat.isSymbolicLink() ||
      (
        finalStat !== null &&
        (
          !finalStat.isFile() ||
          finalStat.isSymbolicLink() ||
          finalStat.dev !== pendingStat.dev ||
          finalStat.ino !== pendingStat.ino
        )
      )
    ) {
      throw new Error(
        "C6 flat-summary pending/final inode mismatch",
      );
    }
    if (sha256(pendingBytes) !== expectedSha256) {
      if (finalStat !== null) {
        throw new Error(
          "C6 flat-summary linked pending artifact is incomplete",
        );
      }
      if (relativePath.endsWith(".response.raw")) {
        await link(path, finalPath);
        await syncDirectory(directory);
      }
      await unlink(path);
      await syncDirectory(directory);
      continue;
    }
    if (finalStat === null) {
      await link(path, finalPath);
      await syncDirectory(directory);
    }
    await unlink(path);
    await syncDirectory(directory);
  }
}

function isKnownPublicationPath(path: string): boolean {
  return new Set([
    "artifacts/asset-lock.json",
    "artifacts/capture-claim.json",
    "artifacts/capture-failure-terminal.json",
    "artifacts/capture-terminal.json",
    "artifacts/corpus.json",
    "artifacts/generation-index.json",
    "artifacts/inputs/plan.json",
    "artifacts/inputs/summary-prompt.md",
    "artifacts/inputs/summary-protocol.json",
    "receipt.json",
  ]).has(path) ||
    /^artifacts\/inputs\/histories\/[a-f0-9]{64}\.history$/u
      .test(path) ||
    /^artifacts\/generations\/[a-f0-9]{64}\/(attempt-manifest\.json|normalization-index\.json|output\.txt|provider-artifact\.json|request\.redacted\.json)$/u
      .test(path) ||
    /^artifacts\/generations\/[a-f0-9]{64}\/attempts\/\d{3}\.(decision\.json|response\.json|response\.raw)$/u
      .test(path);
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function readReference(
  artifactsRoot: string,
  reference: ArtifactReference,
): Promise<Buffer> {
  const bytes = await readC6StableRegularFile(
    join(artifactsRoot, reference.path),
    `flat-summary artifact ${reference.path}`,
    undefined,
    true,
  );
  if (
    bytes.byteLength !== reference.bytes ||
    sha256(bytes) !== reference.sha256
  ) {
    throw new Error(
      `C6 flat-summary artifact hash changed ${reference.path}`,
    );
  }
  return bytes;
}

async function readNamedReference(
  artifactsRoot: string,
  path: string,
): Promise<Buffer> {
  return readC6StableRegularFile(
    join(artifactsRoot, path),
    `flat-summary artifact ${path}`,
    MAX_JSON_BYTES,
    true,
  );
}

async function requiredReference(
  artifactsRoot: string,
  path: string,
): Promise<ArtifactReference> {
  const bytes = await readNamedReference(artifactsRoot, path);
  return referenceForBytes(path, bytes);
}

async function optionalReference(
  artifactsRoot: string,
  path: string,
  absolutePath: string,
): Promise<ArtifactReference | null> {
  return await pathExists(absolutePath)
    ? requiredReference(artifactsRoot, path)
    : null;
}

function referenceForBytes(
  path: string,
  bytes: Uint8Array,
): ArtifactReference {
  return {
    bytes: bytes.byteLength,
    path,
    sha256: sha256(bytes),
  };
}

function parsePrettyExact<T>(
  bytes: Uint8Array,
  schema: z.ZodType<T>,
  message: string,
): T {
  const parsed = schema.safeParse(parsePrettyJson(bytes, message));
  if (
    !parsed.success ||
    serializeJson(parsed.data) !==
      Buffer.from(bytes).toString("utf8")
  ) {
    throw new Error(message);
  }
  return parsed.data;
}

function parseCompactExact<T>(
  bytes: Uint8Array,
  schema: z.ZodType<T>,
  message: string,
): T {
  const parsed = schema.safeParse(parsePrettyJson(bytes, message));
  if (
    !parsed.success ||
    !Buffer.from(bytes).equals(
      serializeC6FlatSummaryCanonicalJson(parsed.data),
    )
  ) {
    throw new Error(message);
  }
  return parsed.data;
}

function parsePrettyJson(
  bytes: Uint8Array,
  message: string,
): unknown {
  try {
    return JSON.parse(
      Buffer.from(bytes).toString("utf8"),
    ) as unknown;
  } catch {
    throw new Error(message);
  }
}

function parsePlan(bytes: Uint8Array): C6CandidatePlan {
  const value = parsePrettyJson(
    bytes,
    "C6 flat-summary plan is invalid",
  );
  const plan = value as C6CandidatePlan;
  if (
    serializeC6CandidatePlan(plan) !==
      Buffer.from(bytes).toString("utf8")
  ) {
    throw new Error(
      "C6 flat-summary plan is not canonical",
    );
  }
  return plan;
}

function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function assertRootEntries(
  outputRoot: string,
): Promise<void> {
  const entries = await readdir(outputRoot, {
    withFileTypes: true,
  });
  entries.sort((left, right) =>
    compareCodeUnits(left.name, right.name)
  );
  if (
    entries.length !== 2 ||
    entries[0]?.name !== "artifacts" ||
    !entries[0].isDirectory() ||
    entries[0].isSymbolicLink() ||
    entries[1]?.name !== "receipt.json" ||
    !entries[1].isFile() ||
    entries[1].isSymbolicLink()
  ) {
    throw new Error(
      "C6 flat-summary output root structure is invalid",
    );
  }
}

function publicationResult(input: {
  outputRoot: string;
  receipt: Receipt;
  receiptPath: string;
  receiptSha256: string;
}): C6FlatSummaryGenerationPublication {
  return {
    assetLockSha256: input.receipt.assetLock.sha256,
    assetRootSha256:
      input.receipt.assetLock.assetRootSha256,
    attemptCount: input.receipt.attemptCount,
    candidateManifestFrozen: false,
    codexRunReady: false,
    generationCount: input.receipt.generationCount,
    outputRoot: input.outputRoot,
    providerAuthenticityVerified: false,
    receiptPath: input.receiptPath,
    receiptSha256: input.receiptSha256,
    stageBindingCount: input.receipt.stageBindingCount,
    status: input.receipt.status,
  };
}

function attemptPath(
  generationKey: string,
  attempt: number,
  suffix: "decision.json" | "response.json" | "response.raw",
): string {
  return `generations/${generationKey}/attempts/${
    String(attempt).padStart(3, "0")
  }.${suffix}`;
}

function assertNoApiToken(
  bytes: Uint8Array,
  apiToken: string,
): void {
  if (
    apiToken.length > 0 &&
    Buffer.from(bytes).includes(Buffer.from(apiToken))
  ) {
    throw new Error(
      "C6 flat-summary publication contains authorization material",
    );
  }
}

function assertSha256(value: string, message: string): void {
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(message);
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(
        "C6 flat-summary expected path is not a regular file",
      );
    }
    return true;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
