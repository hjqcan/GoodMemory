import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";

import type {
  C6CandidatePlan,
} from "./c6-candidate-plan";
import {
  serializeC6CandidatePlan,
} from "./c6-candidate-plan";
import type {
  NormalizedCodexUsage,
} from "./codex-events";
import type {
  C6FlatSummaryCorpus,
  C6FlatSummaryCorpusExpectation,
} from "./c6-flat-summary";
import {
  buildC6InjectionBudgetReceipt,
  C6_FLAT_SUMMARY_CORPUS_STATUS,
  C6_FLAT_SUMMARY_GENERATION_POLICY,
  C6_FLAT_SUMMARY_INJECTION_COMPOSITION,
  C6_FLAT_SUMMARY_INJECTION_COMPOSITION_SHA256,
  C6_INJECTION_TOKEN_COUNTER_ID,
  C6_INJECTION_TOKEN_COUNTER_SHA256,
  C6_NO_HISTORY_CONTROL,
  C6_NO_HISTORY_ZERO_INJECTION_COMPOSITION_SHA256,
  verifyC6FlatSummaryCorpusCompleteness,
} from "./c6-flat-summary";
import {
  buildC6FlatSummaryCorpusExpectation,
} from "./c6-readiness";
import {
  EMPTY_FROZEN_PREHISTORY_SHA256,
} from "./frozen-prehistory";

export const C6_FLAT_SUMMARY_REQUEST_SEED = 6_002;
export const C6_GURKIAI_FLAT_SUMMARY_ENDPOINT =
  "https://ai.gurkiai.com/v1/chat/completions";
export const C6_FLAT_SUMMARY_TRANSIENT_HTTP_STATUSES = [
  408,
  429,
  500,
  502,
  503,
  504,
] as const;

const MAX_ATTEMPTS = 3;
const REQUIRED_PROVIDER_RECEIPT_FIELDS = [
  "providerRequestId",
  "requestSha256",
  "rawResponseSha256",
  "rawToNormalizedIndexSha256",
  "startedAt",
  "completedAt",
  "usage",
] as const;
const UTF8_DECODER = new TextDecoder("utf-8", {
  fatal: true,
});
const TRANSIENT_HTTP_STATUSES = new Set<number>(
  C6_FLAT_SUMMARY_TRANSIENT_HTTP_STATUSES,
);

export interface C6FlatSummaryTransportRequest {
  body: Uint8Array;
  headers: Readonly<Record<string, string>>;
  method: "POST";
  url: string;
}

export interface C6FlatSummaryTransportResponse {
  body: Uint8Array;
  status: number;
}

export type C6FlatSummaryTransport = (
  request: C6FlatSummaryTransportRequest,
) => Promise<C6FlatSummaryTransportResponse>;

export type C6FlatSummaryAttemptDecision =
  | "accepted-success"
  | "received-http-200"
  | "rejected-invalid-json"
  | "rejected-invalid-response-shape"
  | "rejected-invalid-usage"
  | "rejected-model-mismatch"
  | "rejected-non-retryable-status"
  | "rejected-output-over-budget"
  | "rejected-retry-delay-error"
  | "rejected-transient-status-exhausted"
  | "rejected-transport-error"
  | "retry-transient-status";

export interface C6FlatSummaryAttemptManifestEntry {
  attempt: number;
  completedAt: string;
  decision: C6FlatSummaryAttemptDecision;
  rawResponseSha256?: string;
  startedAt: string;
  status?: number;
  transportError?: {
    sanitized: true;
    type:
      | "authorization-material-detected"
      | "invalid-response"
      | "retry-delay-threw"
      | "transport-threw";
  };
}

export interface C6FlatSummaryAttemptCapture
  extends C6FlatSummaryAttemptManifestEntry {
  rawResponseBytes?: Uint8Array;
}

export interface C6FlatSummaryAttemptManifest {
  attempts: C6FlatSummaryAttemptManifestEntry[];
  generationKey: string;
  requestSha256: string;
  schemaVersion: 1;
}

export interface C6FlatSummaryProviderArtifact {
  attemptManifestSha256: string;
  completedAt: string;
  generationKey: string;
  historySourceSha256: string;
  model: string;
  outputSha256: string;
  planSha256: string;
  provider: string;
  providerAuthenticityVerified: false;
  providerEndpoint: typeof C6_GURKIAI_FLAT_SUMMARY_ENDPOINT;
  providerEndpointSha256: string;
  providerRequestId: string;
  rawResponseSha256: string;
  rawToNormalizedIndexSha256: string;
  requestSha256: string;
  schemaVersion: 1;
  startedAt: string;
  summaryPromptSha256: string;
  summaryProtocolSha256: string;
  usage: NormalizedCodexUsage;
}

export interface C6FlatSummaryNormalizationIndex {
  model: {
    path: "$.model";
    value: string;
  };
  output: {
    path: "$.choices[0].message.content";
    sha256: string;
  };
  providerRequestId: {
    path: "$.id";
  };
  rawResponseSha256: string;
  schemaVersion: 1;
  usage: {
    cachedInputTokens: {
      path:
        | "$.usage.prompt_tokens_details.cached_tokens"
        | null;
      value: number;
    };
    inputTokens: {
      path: "$.usage.prompt_tokens";
      value: number;
    };
    outputTokens: {
      path: "$.usage.completion_tokens";
      value: number;
    };
  };
}

export interface C6FlatSummaryGenerationCapture {
  artifact: C6FlatSummaryProviderArtifact;
  artifactBytes: Uint8Array;
  artifactSha256: string;
  attemptCount: number;
  attemptManifest: C6FlatSummaryAttemptManifest;
  attemptManifestBytes: Uint8Array;
  attemptManifestSha256: string;
  attempts: C6FlatSummaryAttemptCapture[];
  generationKey: string;
  historySourceSha256: string;
  normalizationIndex: C6FlatSummaryNormalizationIndex;
  normalized: {
    output: string;
    outputSha256: string;
    usage: NormalizedCodexUsage;
  };
  rawResponseBytes: Uint8Array;
  rawResponseSha256: string;
  rawToNormalizedIndexBytes: Uint8Array;
  rawToNormalizedIndexSha256: string;
  redactedRequestBytes: Uint8Array;
  requestSha256: string;
}

export interface C6FlatSummaryGenerationMaterialization {
  codexRunReady: false;
  corpus: C6FlatSummaryCorpus;
  generations: C6FlatSummaryGenerationCapture[];
  planSha256: string;
  providerAuthenticityVerified: false;
  providerEndpoint: typeof C6_GURKIAI_FLAT_SUMMARY_ENDPOINT;
  providerEndpointSha256: string;
  schemaVersion: 1;
  status: "local-transport-structural-capture-only";
  summaryPromptSha256: string;
  summaryProtocolSha256: string;
}

export class C6FlatSummaryCaptureError extends Error {
  readonly attemptManifest: C6FlatSummaryAttemptManifest | null;
  readonly attemptManifestBytes: Uint8Array | null;
  readonly attemptManifestSha256: string | null;
  readonly attempts: C6FlatSummaryAttemptCapture[];

  constructor(
    message: string,
    evidence?: {
      attemptManifest: C6FlatSummaryAttemptManifest;
      attemptManifestBytes: Uint8Array;
      attemptManifestSha256: string;
      attempts: C6FlatSummaryAttemptCapture[];
    },
  ) {
    super(message);
    this.attemptManifest = evidence?.attemptManifest ?? null;
    this.attemptManifestBytes = evidence === undefined
      ? null
      : Buffer.from(evidence.attemptManifestBytes);
    this.attemptManifestSha256 =
      evidence?.attemptManifestSha256 ?? null;
    this.attempts = evidence?.attempts.map(copyAttempt) ?? [];
  }
}

interface ParsedSummaryProtocol {
  generationPolicy: typeof C6_FLAT_SUMMARY_GENERATION_POLICY;
  historySource: "same-stage-sealed-prefix-as-goodmemory";
  injectionComposition:
    typeof C6_FLAT_SUMMARY_INJECTION_COMPOSITION;
  leakageAuditRequired: true;
  maxInjectedTokens: number;
  model: string;
  pricingSnapshot: {
    path: string;
    sha256: string;
  };
  prompt: {
    path: string;
    sha256: string;
  };
  provider: string;
  rawGoldAccess: false;
  schemaVersion: 3;
  seedReusePolicy:
    "one-output-hash-reused-across-all-three-seeds";
  tokenCounter: {
    id: typeof C6_INJECTION_TOKEN_COUNTER_ID;
    sha256: typeof C6_INJECTION_TOKEN_COUNTER_SHA256;
  };
}

interface NormalizedProviderResponse {
  cachedInputTokensPath:
    | "$.usage.prompt_tokens_details.cached_tokens"
    | null;
  model: string;
  output: string;
  providerRequestId: string;
  usage: NormalizedCodexUsage;
}

type C6FlatSummaryPostTransportRejection =
  | "rejected-invalid-json"
  | "rejected-invalid-response-shape"
  | "rejected-invalid-usage"
  | "rejected-model-mismatch"
  | "rejected-output-over-budget";

class C6FlatSummaryResponseValidationError extends Error {
  readonly decision: C6FlatSummaryPostTransportRejection;

  constructor(
    message: string,
    decision: C6FlatSummaryPostTransportRejection,
  ) {
    super(message);
    this.decision = decision;
  }
}

export async function materializeC6FlatSummaryGenerationCapture(input: {
  apiToken: string;
  endpoint: string;
  histories: ReadonlyArray<{
    bytes: Uint8Array;
    generationKey: string;
  }>;
  now?: () => Date;
  plan: C6CandidatePlan;
  planBytes: Uint8Array;
  planSha256: string;
  sleep?: (milliseconds: number) => Promise<void>;
  summaryPromptBytes: Uint8Array;
  summaryProtocolBytes: Uint8Array;
  transport: C6FlatSummaryTransport;
}): Promise<C6FlatSummaryGenerationMaterialization> {
  const planSha256 = validateFrozenPlan(
    input.plan,
    input.planBytes,
    input.planSha256,
  );
  const summaryProtocolSha256 = sha256(
    input.summaryProtocolBytes,
  );
  const protocol = parseSummaryProtocol(
    input.summaryProtocolBytes,
  );
  const summaryPromptSha256 = sha256(input.summaryPromptBytes);
  const prompt = decodeUtf8(
    input.summaryPromptBytes,
    "C6 flat-summary prompt is not UTF-8",
  );
  if (prompt.trim().length === 0) {
    throw new Error("C6 flat-summary prompt is empty");
  }
  validatePlanProtocolBindings({
    plan: input.plan,
    protocol,
    summaryPromptSha256,
    summaryProtocolSha256,
  });
  const endpoint = validateProviderEndpoint(
    input.endpoint,
    protocol.provider,
  );
  const providerEndpointSha256 = sha256(endpoint);
  const expectation = buildC6FlatSummaryCorpusExpectation(
    input.plan,
  );
  validateExpectation(input.plan, expectation);
  const historyByGenerationKey = validateHistories(
    input.histories,
    expectation,
  );
  const generationBindings = [...expectation.generationBindings]
    .sort((left, right) =>
      compareCodeUnits(left.generationKey, right.generationKey)
    );
  const apiToken = generationBindings.length === 0
    ? input.apiToken
    : validateApiToken(input.apiToken);
  const now = input.now ?? (() => new Date());
  const sleep = input.sleep ?? sleepMilliseconds;
  const generations: C6FlatSummaryGenerationCapture[] = [];

  for (const binding of generationBindings) {
    const historyBytes = historyByGenerationKey.get(
      binding.generationKey,
    )!;
    const history = decodeUtf8(
      historyBytes,
      "C6 flat-summary history is not UTF-8",
    );
    const requestBody = {
      max_tokens: protocol.maxInjectedTokens,
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
      model: protocol.model,
      n: 1,
      seed: C6_FLAT_SUMMARY_REQUEST_SEED,
      stream: false,
      temperature: 0,
    };
    const requestBodyBytes = canonicalBytes(requestBody);
    const redactedRequestBytes = canonicalBytes({
      body: requestBody,
      bodySha256: sha256(requestBodyBytes),
      headers: {
        accept: "application/json",
        authorization: "Bearer [REDACTED]",
        "content-type": "application/json",
      },
      method: "POST",
      url: endpoint,
    });
    assertNoAuthorizationMaterial(
      requestBodyBytes,
      apiToken,
      "C6 flat-summary request contains authorization material",
    );
    assertNoAuthorizationMaterial(
      redactedRequestBytes,
      apiToken,
      "C6 flat-summary request contains authorization material",
    );
    const requestSha256 = sha256(redactedRequestBytes);
    const {
      attempts: pendingAttempts,
      attemptCount,
      completedAt,
      responseBytes,
      startedAt,
    } = await callTransport({
      apiToken,
      endpoint,
      generationKey: binding.generationKey,
      now,
      requestBodyBytes,
      requestSha256,
      sleep,
      transport: input.transport,
    });
    const rawResponseSha256 = sha256(responseBytes);
    let normalized: NormalizedProviderResponse;
    try {
      normalized = normalizeProviderResponse(
        responseBytes,
        protocol.model,
      );
    } catch (error) {
      const rejection =
        error instanceof C6FlatSummaryResponseValidationError
          ? error
          : new C6FlatSummaryResponseValidationError(
            "C6 flat-summary provider response is invalid",
            "rejected-invalid-response-shape",
          );
      throwPostTransportRejection({
        attempts: pendingAttempts,
        decision: rejection.decision,
        generationKey: binding.generationKey,
        message: rejection.message,
        requestSha256,
      });
    }
    try {
      buildC6InjectionBudgetReceipt({
        arm: "flat-summary",
        compositionSha256:
          C6_FLAT_SUMMARY_INJECTION_COMPOSITION_SHA256,
        historySourceSha256: binding.historySourceSha256,
        injectedText: normalized.output,
        injectionMode: "content-injection",
        maxInjectedTokens: protocol.maxInjectedTokens,
      });
    } catch {
      throwPostTransportRejection({
        attempts: pendingAttempts,
        decision: "rejected-output-over-budget",
        generationKey: binding.generationKey,
        message:
          "C6 flat-summary normalized output exceeds its token budget",
        requestSha256,
      });
    }
    const attempts = finalizeHttp200Attempt(
      pendingAttempts,
      "accepted-success",
    );
    const {
      attemptManifest,
      attemptManifestBytes,
      attemptManifestSha256,
    } = buildAttemptEvidence(
      binding.generationKey,
      requestSha256,
      attempts,
    );
    const outputSha256 = sha256(normalized.output);
    const normalizationIndex: C6FlatSummaryNormalizationIndex = {
      model: {
        path: "$.model",
        value: normalized.model,
      },
      output: {
        path: "$.choices[0].message.content",
        sha256: outputSha256,
      },
      providerRequestId: {
        path: "$.id",
      },
      rawResponseSha256,
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
    const rawToNormalizedIndexBytes =
      canonicalBytes(normalizationIndex);
    const rawToNormalizedIndexSha256 = sha256(
      rawToNormalizedIndexBytes,
    );
    const artifact: C6FlatSummaryProviderArtifact = {
      attemptManifestSha256,
      completedAt,
      generationKey: binding.generationKey,
      historySourceSha256: binding.historySourceSha256,
      model: normalized.model,
      outputSha256,
      planSha256,
      provider: protocol.provider,
      providerAuthenticityVerified: false,
      providerEndpoint: endpoint,
      providerEndpointSha256,
      providerRequestId: normalized.providerRequestId,
      rawResponseSha256,
      rawToNormalizedIndexSha256,
      requestSha256,
      schemaVersion: 1,
      startedAt,
      summaryPromptSha256,
      summaryProtocolSha256,
      usage: { ...normalized.usage },
    };
    const artifactBytes = canonicalBytes(artifact);
    assertNoAuthorizationMaterial(
      artifactBytes,
      apiToken,
      "C6 flat-summary artifact contains authorization material",
    );
    generations.push({
      artifact,
      artifactBytes: Buffer.from(artifactBytes),
      artifactSha256: sha256(artifactBytes),
      attemptCount,
      attemptManifest,
      attemptManifestBytes: Buffer.from(attemptManifestBytes),
      attemptManifestSha256,
      attempts: attempts.map(copyAttempt),
      generationKey: binding.generationKey,
      historySourceSha256: binding.historySourceSha256,
      normalizationIndex,
      normalized: {
        output: normalized.output,
        outputSha256,
        usage: { ...normalized.usage },
      },
      rawResponseBytes: Buffer.from(responseBytes),
      rawResponseSha256,
      rawToNormalizedIndexBytes:
        Buffer.from(rawToNormalizedIndexBytes),
      rawToNormalizedIndexSha256,
      redactedRequestBytes: Buffer.from(redactedRequestBytes),
      requestSha256,
    });
  }

  const outputByGenerationKey = new Map(
    generations.map((generation) => [
      generation.generationKey,
      generation.normalized.outputSha256,
    ]),
  );
  const corpus: C6FlatSummaryCorpus = {
    generationReceipts: generations.map((generation) => ({
      generationKey: generation.generationKey,
      historySourceSha256: generation.historySourceSha256,
      outputSha256: generation.normalized.outputSha256,
      providerArtifactSha256: generation.artifactSha256,
    })),
    providerAuthenticityVerified: false,
    schemaVersion: 1,
    stageBindingReceipts: [...expectation.stageBindings]
      .sort(compareStageBindings)
      .flatMap((binding) =>
        [...expectation.seeds]
          .sort((left, right) => left - right)
          .map((seed) => ({
            episodeId: binding.episodeId,
            generationKey: binding.generationKey,
            outputSha256:
              outputByGenerationKey.get(binding.generationKey)!,
            seed,
            stageId: binding.stageId,
          }))
      ),
    status: C6_FLAT_SUMMARY_CORPUS_STATUS,
  };
  verifyC6FlatSummaryCorpusCompleteness(corpus, expectation);

  return {
    codexRunReady: false,
    corpus,
    generations,
    planSha256,
    providerAuthenticityVerified: false,
    providerEndpoint: endpoint,
    providerEndpointSha256,
    schemaVersion: 1,
    status: "local-transport-structural-capture-only",
    summaryPromptSha256,
    summaryProtocolSha256,
  };
}

function validateFrozenPlan(
  plan: C6CandidatePlan,
  planBytes: Uint8Array,
  expectedSha256: string,
): string {
  assertSha256(expectedSha256, "C6 flat-summary plan hash is invalid");
  const canonicalPlanBytes = Buffer.from(
    serializeC6CandidatePlan(plan),
  );
  if (!canonicalPlanBytes.equals(Buffer.from(planBytes))) {
    throw new Error(
      "C6 flat-summary frozen plan bytes are not canonical",
    );
  }
  const actualSha256 = sha256(planBytes);
  if (actualSha256 !== expectedSha256) {
    throw new Error("C6 flat-summary frozen plan hash does not match");
  }
  if (
    plan.codexRunReady !== false ||
    plan.candidateManifestFrozen !== false
  ) {
    throw new Error(
      "C6 flat-summary capture cannot claim run readiness",
    );
  }
  return actualSha256;
}

function parseSummaryProtocol(
  bytes: Uint8Array,
): ParsedSummaryProtocol {
  let raw: unknown;
  try {
    raw = JSON.parse(decodeUtf8(
      bytes,
      "invalid C6 flat-summary protocol",
    ));
  } catch {
    throw new Error("invalid C6 flat-summary protocol");
  }
  if (
    !isRecord(raw) ||
    !hasExactKeys(raw, [
      "generationPolicy",
      "historySource",
      "injectionComposition",
      "leakageAuditRequired",
      "maxInjectedTokens",
      "model",
      "noHistoryControl",
      "pricingSnapshot",
      "prompt",
      "provider",
      "rawGoldAccess",
      "schemaVersion",
      "seedReusePolicy",
      "tokenCounter",
    ]) ||
    raw.generationPolicy !== C6_FLAT_SUMMARY_GENERATION_POLICY ||
    raw.historySource !==
      "same-stage-sealed-prefix-as-goodmemory" ||
    raw.injectionComposition !==
      C6_FLAT_SUMMARY_INJECTION_COMPOSITION ||
    raw.leakageAuditRequired !== true ||
    !positiveSafeInteger(raw.maxInjectedTokens) ||
    !trimmedString(raw.model) ||
    canonicalJson(raw.noHistoryControl) !==
      canonicalJson(C6_NO_HISTORY_CONTROL) ||
    !isArtifactReference(raw.pricingSnapshot) ||
    !isArtifactReference(raw.prompt) ||
    !trimmedString(raw.provider) ||
    raw.rawGoldAccess !== false ||
    raw.schemaVersion !== 3 ||
    raw.seedReusePolicy !==
      "one-output-hash-reused-across-all-three-seeds" ||
    !isRecord(raw.tokenCounter) ||
    !hasExactKeys(raw.tokenCounter, ["id", "sha256"]) ||
    raw.tokenCounter.id !== C6_INJECTION_TOKEN_COUNTER_ID ||
    raw.tokenCounter.sha256 !== C6_INJECTION_TOKEN_COUNTER_SHA256
  ) {
    throw new Error("invalid C6 flat-summary protocol");
  }
  return raw as unknown as ParsedSummaryProtocol;
}

function validatePlanProtocolBindings(input: {
  plan: C6CandidatePlan;
  protocol: ParsedSummaryProtocol;
  summaryPromptSha256: string;
  summaryProtocolSha256: string;
}): void {
  const {
    plan,
    protocol,
  } = input;
  if (
    plan.bindings.summaryProtocolSha256 !==
      input.summaryProtocolSha256 ||
    plan.bindings.summaryPromptSha256 !==
      input.summaryPromptSha256 ||
    protocol.prompt.sha256 !== input.summaryPromptSha256 ||
    plan.bindings.pricingSnapshotSha256 !==
      protocol.pricingSnapshot.sha256 ||
    plan.bindings.injectionTokenCounterSha256 !==
      C6_INJECTION_TOKEN_COUNTER_SHA256 ||
    plan.flatSummary.generationPolicy !==
      protocol.generationPolicy ||
    plan.flatSummary.historySource !== protocol.historySource ||
    plan.flatSummary.injectionComposition !==
      protocol.injectionComposition ||
    plan.flatSummary.injectionCompositionSha256 !==
      C6_FLAT_SUMMARY_INJECTION_COMPOSITION_SHA256 ||
    plan.flatSummary.leakageAuditRequired !== true ||
    plan.flatSummary.maxInjectedTokens !==
      protocol.maxInjectedTokens ||
    plan.flatSummary.model !== protocol.model ||
    plan.flatSummary.provider !== protocol.provider ||
    plan.flatSummary.rawGoldAccess !== false ||
    plan.flatSummary.seedReusePolicy !==
      protocol.seedReusePolicy ||
    plan.flatSummary.tokenCounterId !==
      C6_INJECTION_TOKEN_COUNTER_ID ||
    plan.flatSummary.tokenCounterSha256 !==
      C6_INJECTION_TOKEN_COUNTER_SHA256 ||
    canonicalJson(plan.noHistoryControl) !==
      canonicalJson(C6_NO_HISTORY_CONTROL) ||
    plan.flatSummary.generationProvenance.requiredBefore !==
      "run-identity-and-codex-execution" ||
    canonicalJson(
      plan.flatSummary.generationProvenance.requiredReceiptFields,
    ) !== canonicalJson(REQUIRED_PROVIDER_RECEIPT_FIELDS) ||
    plan.flatSummary.generationProvenance.status !==
      "authenticated-provider-receipts-required"
  ) {
    throw new Error(
      "C6 flat-summary plan and protocol bindings do not match",
    );
  }
}

function validateExpectation(
  plan: C6CandidatePlan,
  expectation: C6FlatSummaryCorpusExpectation,
): void {
  if (
    expectation.generationBindings.length !==
      plan.counts.summaryGenerationCalls ||
    expectation.stageBindings.length !==
      plan.counts.summaryStageArtifactBindings ||
    expectation.seeds.length !== 3 ||
    new Set(expectation.seeds).size !== 3 ||
    expectation.seeds.some((seed) =>
      !positiveSafeInteger(seed)
    )
  ) {
    throw new Error(
      "C6 flat-summary plan generation counts are invalid",
    );
  }
  const generationKeys = new Set<string>();
  for (const binding of expectation.generationBindings) {
    if (
      !isSha256(binding.generationKey) ||
      !isSha256(binding.historySourceSha256) ||
      binding.historySourceSha256 ===
        EMPTY_FROZEN_PREHISTORY_SHA256 ||
      generationKeys.has(binding.generationKey)
    ) {
      throw new Error(
        "C6 flat-summary plan generation set is invalid",
      );
    }
    generationKeys.add(binding.generationKey);
  }
  const noHistoryStages = new Set<string>();
  for (const binding of expectation.noHistoryStageBindings) {
    const key = stageKey(binding.episodeId, binding.stageId);
    if (
      !trimmedString(binding.episodeId) ||
      !trimmedString(binding.stageId) ||
      noHistoryStages.has(key)
    ) {
      throw new Error(
        "C6 flat-summary plan no-history set is invalid",
      );
    }
    noHistoryStages.add(key);
  }
  const stageKeys = new Set<string>();
  const referencedGenerationKeys = new Set<string>();
  for (const binding of expectation.stageBindings) {
    const key = stageKey(binding.episodeId, binding.stageId);
    if (
      !trimmedString(binding.episodeId) ||
      !trimmedString(binding.stageId) ||
      !generationKeys.has(binding.generationKey) ||
      noHistoryStages.has(key) ||
      stageKeys.has(key)
    ) {
      throw new Error(
        "C6 flat-summary plan stage-binding set is invalid",
      );
    }
    stageKeys.add(key);
    referencedGenerationKeys.add(binding.generationKey);
  }
  if (
    referencedGenerationKeys.size !== generationKeys.size ||
    [...generationKeys].some((key) =>
      !referencedGenerationKeys.has(key)
    )
  ) {
    throw new Error(
      "C6 flat-summary plan generation set is invalid",
    );
  }
  validateStageTreatments(plan);
}

function validateStageTreatments(plan: C6CandidatePlan): void {
  for (const episode of plan.episodeBindings) {
    for (const stage of episode.stageBindings) {
      const treatment = stage.treatment.flatSummary;
      if (treatment.providerCall === "prohibited") {
        if (
          stage.historySourceSha256 !==
            EMPTY_FROZEN_PREHISTORY_SHA256 ||
          treatment.injectionMode !==
            "no-history-zero-injection" ||
          treatment.compositionSha256 !==
            C6_NO_HISTORY_ZERO_INJECTION_COMPOSITION_SHA256
        ) {
          throw new Error(
            "C6 flat-summary no-history treatment is invalid",
          );
        }
        continue;
      }
      if (
        treatment.providerCall !== "required" ||
        stage.historySourceSha256 ===
          EMPTY_FROZEN_PREHISTORY_SHA256 ||
        treatment.injectionMode !== "content-injection" ||
        treatment.compositionSha256 !==
          C6_FLAT_SUMMARY_INJECTION_COMPOSITION_SHA256
      ) {
        throw new Error(
          "C6 flat-summary provider treatment is invalid",
        );
      }
    }
  }
}

function validateHistories(
  histories: ReadonlyArray<{
    bytes: Uint8Array;
    generationKey: string;
  }>,
  expectation: C6FlatSummaryCorpusExpectation,
): Map<string, Uint8Array> {
  const historyByGenerationKey = new Map<string, Uint8Array>();
  for (const history of histories) {
    if (
      !isSha256(history.generationKey) ||
      !(history.bytes instanceof Uint8Array)
    ) {
      throw new Error(
        "C6 flat-summary history generation is invalid",
      );
    }
    if (historyByGenerationKey.has(history.generationKey)) {
      throw new Error(
        "C6 flat-summary history generation duplicates a generation key",
      );
    }
    historyByGenerationKey.set(
      history.generationKey,
      Buffer.from(history.bytes),
    );
  }
  const expectedByGenerationKey = new Map(
    expectation.generationBindings.map((binding) => [
      binding.generationKey,
      binding.historySourceSha256,
    ]),
  );
  if (
    historyByGenerationKey.size !== expectedByGenerationKey.size ||
    [...historyByGenerationKey.keys()].some((key) =>
      !expectedByGenerationKey.has(key)
    )
  ) {
    throw new Error(
      "C6 flat-summary history generation exact set does not match",
    );
  }
  for (const [generationKey, expectedHistorySha256] of
    expectedByGenerationKey) {
    const historyBytes = historyByGenerationKey.get(generationKey)!;
    if (
      historyBytes.byteLength === 0 ||
      sha256(historyBytes) !== expectedHistorySha256
    ) {
      throw new Error(
        "C6 flat-summary actual history bytes do not match",
      );
    }
  }
  return historyByGenerationKey;
}

async function callTransport(input: {
  apiToken: string;
  endpoint: string;
  generationKey: string;
  now: () => Date;
  requestBodyBytes: Uint8Array;
  requestSha256: string;
  sleep: (milliseconds: number) => Promise<void>;
  transport: C6FlatSummaryTransport;
}): Promise<{
  attemptCount: number;
  attempts: C6FlatSummaryAttemptCapture[];
  completedAt: string;
  responseBytes: Uint8Array;
  startedAt: string;
}> {
  const attempts: C6FlatSummaryAttemptCapture[] = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const startedAt = timestamp(input.now);
    let response: C6FlatSummaryTransportResponse;
    try {
      response = await input.transport({
        body: Buffer.from(input.requestBodyBytes),
        headers: {
          accept: "application/json",
          authorization: `Bearer ${input.apiToken}`,
          "content-type": "application/json",
        },
        method: "POST",
        url: input.endpoint,
      });
    } catch {
      const completedAt = timestamp(input.now);
      assertAttemptChronology(attempts, startedAt, completedAt);
      attempts.push({
        attempt,
        completedAt,
        decision: "rejected-transport-error",
        startedAt,
        transportError: {
          sanitized: true,
          type: "transport-threw",
        },
      });
      throw captureError(
        "C6 flat-summary transport failed",
        input,
        attempts,
      );
    }
    const completedAt = timestamp(input.now);
    assertAttemptChronology(attempts, startedAt, completedAt);
    if (
      !Number.isSafeInteger(response.status) ||
      response.status < 100 ||
      response.status > 599 ||
      !(response.body instanceof Uint8Array)
    ) {
      attempts.push({
        attempt,
        completedAt,
        decision: "rejected-transport-error",
        startedAt,
        transportError: {
          sanitized: true,
          type: "invalid-response",
        },
      });
      throw captureError(
        "C6 flat-summary transport response is invalid",
        input,
        attempts,
      );
    }
    const responseBytes = Buffer.from(response.body);
    if (containsAuthorizationMaterial(
      responseBytes,
      input.apiToken,
    )) {
      attempts.push({
        attempt,
        completedAt,
        decision: "rejected-transport-error",
        startedAt,
        status: response.status,
        transportError: {
          sanitized: true,
          type: "authorization-material-detected",
        },
      });
      throw captureError(
        "C6 flat-summary response contains authorization material",
        input,
        attempts,
      );
    }
    const rawResponseSha256 = sha256(responseBytes);
    if (response.status === 200) {
      attempts.push({
        attempt,
        completedAt,
        decision: "received-http-200",
        rawResponseBytes: responseBytes,
        rawResponseSha256,
        startedAt,
        status: response.status,
      });
      return {
        attemptCount: attempt,
        attempts: attempts.map(copyAttempt),
        completedAt,
        responseBytes,
        startedAt: attempts[0]!.startedAt,
      };
    }
    if (!TRANSIENT_HTTP_STATUSES.has(response.status)) {
      attempts.push({
        attempt,
        completedAt,
        decision: "rejected-non-retryable-status",
        rawResponseBytes: responseBytes,
        rawResponseSha256,
        startedAt,
        status: response.status,
      });
      throw captureError(
        `C6 flat-summary provider returned non-retryable status ${response.status}`,
        input,
        attempts,
      );
    }
    if (attempt === MAX_ATTEMPTS) {
      attempts.push({
        attempt,
        completedAt,
        decision: "rejected-transient-status-exhausted",
        rawResponseBytes: responseBytes,
        rawResponseSha256,
        startedAt,
        status: response.status,
      });
      throw captureError(
        `C6 flat-summary provider exhausted transient status ${response.status}`,
        input,
        attempts,
      );
    }
    attempts.push({
      attempt,
      completedAt,
      decision: "retry-transient-status",
      rawResponseBytes: responseBytes,
      rawResponseSha256,
      startedAt,
      status: response.status,
    });
    try {
      await input.sleep(attempt * 1_000);
    } catch {
      const latestAttempt = attempts.at(-1)!;
      latestAttempt.decision = "rejected-retry-delay-error";
      latestAttempt.transportError = {
        sanitized: true,
        type: "retry-delay-threw",
      };
      throw captureError(
        "C6 flat-summary retry delay failed",
        input,
        attempts,
      );
    }
  }
  throw new Error("C6 flat-summary transport failed");
}

function throwPostTransportRejection(input: {
  attempts: readonly C6FlatSummaryAttemptCapture[];
  decision: C6FlatSummaryPostTransportRejection;
  generationKey: string;
  message: string;
  requestSha256: string;
}): never {
  const attempts = finalizeHttp200Attempt(
    input.attempts,
    input.decision,
  );
  throw new C6FlatSummaryCaptureError(
    input.message,
    buildAttemptEvidence(
      input.generationKey,
      input.requestSha256,
      attempts,
    ),
  );
}

function finalizeHttp200Attempt(
  attempts: readonly C6FlatSummaryAttemptCapture[],
  decision:
    | "accepted-success"
    | C6FlatSummaryPostTransportRejection,
): C6FlatSummaryAttemptCapture[] {
  const finalized = attempts.map(copyAttempt);
  const finalAttempt = finalized.at(-1);
  if (
    finalAttempt === undefined ||
    finalAttempt.decision !== "received-http-200" ||
    finalAttempt.status !== 200 ||
    finalAttempt.rawResponseBytes === undefined ||
    finalAttempt.rawResponseSha256 === undefined
  ) {
    throw new Error(
      "C6 flat-summary HTTP 200 attempt state is invalid",
    );
  }
  finalAttempt.decision = decision;
  return finalized;
}

function captureError(
  message: string,
  input: {
    generationKey: string;
    requestSha256: string;
  },
  attempts: readonly C6FlatSummaryAttemptCapture[],
): C6FlatSummaryCaptureError {
  return new C6FlatSummaryCaptureError(
    message,
    buildAttemptEvidence(
      input.generationKey,
      input.requestSha256,
      attempts,
    ),
  );
}

function buildAttemptEvidence(
  generationKey: string,
  requestSha256: string,
  attempts: readonly C6FlatSummaryAttemptCapture[],
): {
  attemptManifest: C6FlatSummaryAttemptManifest;
  attemptManifestBytes: Uint8Array;
  attemptManifestSha256: string;
  attempts: C6FlatSummaryAttemptCapture[];
} {
  const attemptManifest: C6FlatSummaryAttemptManifest = {
    attempts: attempts.map(attemptManifestEntry),
    generationKey,
    requestSha256,
    schemaVersion: 1,
  };
  const attemptManifestBytes = canonicalBytes(attemptManifest);
  return {
    attemptManifest,
    attemptManifestBytes,
    attemptManifestSha256: sha256(attemptManifestBytes),
    attempts: attempts.map(copyAttempt),
  };
}

function attemptManifestEntry(
  attempt: C6FlatSummaryAttemptCapture,
): C6FlatSummaryAttemptManifestEntry {
  return {
    attempt: attempt.attempt,
    completedAt: attempt.completedAt,
    decision: attempt.decision,
    ...(attempt.rawResponseSha256 === undefined
      ? {}
      : { rawResponseSha256: attempt.rawResponseSha256 }),
    startedAt: attempt.startedAt,
    ...(attempt.status === undefined
      ? {}
      : { status: attempt.status }),
    ...(attempt.transportError === undefined
      ? {}
      : { transportError: { ...attempt.transportError } }),
  };
}

function copyAttempt(
  attempt: C6FlatSummaryAttemptCapture,
): C6FlatSummaryAttemptCapture {
  return {
    ...attemptManifestEntry(attempt),
    ...(attempt.rawResponseBytes === undefined
      ? {}
      : { rawResponseBytes: Buffer.from(attempt.rawResponseBytes) }),
  };
}

function assertAttemptChronology(
  attempts: readonly C6FlatSummaryAttemptCapture[],
  startedAt: string,
  completedAt: string,
): void {
  const previousCompletedAt = attempts.at(-1)?.completedAt;
  if (
    Date.parse(completedAt) < Date.parse(startedAt) ||
    (
      previousCompletedAt !== undefined &&
      Date.parse(startedAt) < Date.parse(previousCompletedAt)
    )
  ) {
    throw new Error("C6 flat-summary capture clock moved backwards");
  }
}

function normalizeProviderResponse(
  bytes: Uint8Array,
  expectedModel: string,
): NormalizedProviderResponse {
  let raw: unknown;
  try {
    raw = JSON.parse(decodeUtf8(
      bytes,
      "C6 flat-summary provider response is not UTF-8",
    ));
  } catch {
    throw new C6FlatSummaryResponseValidationError(
      "C6 flat-summary provider response is invalid JSON",
      "rejected-invalid-json",
    );
  }
  if (!isRecord(raw)) {
    throw new C6FlatSummaryResponseValidationError(
      "C6 flat-summary provider response shape is invalid",
      "rejected-invalid-response-shape",
    );
  }
  if (
    !trimmedString(raw.model) ||
    raw.model !== expectedModel
  ) {
    throw new C6FlatSummaryResponseValidationError(
      "C6 flat-summary provider response model does not match",
      "rejected-model-mismatch",
    );
  }
  if (
    !trimmedString(raw.id) ||
    !Array.isArray(raw.choices) ||
    raw.choices.length !== 1 ||
    !isRecord(raw.choices[0]) ||
    raw.choices[0].index !== 0 ||
    raw.choices[0].finish_reason !== "stop" ||
    !isRecord(raw.choices[0].message) ||
    raw.choices[0].message.role !== "assistant" ||
    !trimmedString(raw.choices[0].message.content) ||
    !isRecord(raw.usage)
  ) {
    throw new C6FlatSummaryResponseValidationError(
      "C6 flat-summary provider response shape is invalid",
      "rejected-invalid-response-shape",
    );
  }
  const inputTokens = raw.usage.prompt_tokens;
  const outputTokens = raw.usage.completion_tokens;
  const totalTokens = raw.usage.total_tokens;
  const promptTokenDetails = raw.usage.prompt_tokens_details;
  if (
    !nonnegativeSafeInteger(inputTokens) ||
    !positiveSafeInteger(outputTokens) ||
    !nonnegativeSafeInteger(totalTokens) ||
    totalTokens !== inputTokens + outputTokens ||
    (
      promptTokenDetails !== undefined &&
      !isRecord(promptTokenDetails)
    )
  ) {
    throw new C6FlatSummaryResponseValidationError(
      "C6 flat-summary provider usage is invalid",
      "rejected-invalid-usage",
    );
  }
  const cachedInputTokens = isRecord(promptTokenDetails)
    ? promptTokenDetails.cached_tokens
    : 0;
  if (
    !nonnegativeSafeInteger(cachedInputTokens) ||
    cachedInputTokens > inputTokens
  ) {
    throw new C6FlatSummaryResponseValidationError(
      "C6 flat-summary provider usage is invalid",
      "rejected-invalid-usage",
    );
  }
  return {
    cachedInputTokensPath: isRecord(promptTokenDetails)
      ? "$.usage.prompt_tokens_details.cached_tokens"
      : null,
    model: raw.model,
    output: raw.choices[0].message.content,
    providerRequestId: raw.id,
    usage: {
      cachedInputTokens,
      inputTokens,
      outputTokens,
    },
  };
}

function validateProviderEndpoint(
  value: string,
  provider: string,
): typeof C6_GURKIAI_FLAT_SUMMARY_ENDPOINT {
  if (
    provider !== "gurkiai-openai-compatible" ||
    value !== C6_GURKIAI_FLAT_SUMMARY_ENDPOINT
  ) {
    throw new Error(
      "C6 flat-summary provider endpoint does not match the frozen provider",
    );
  }
  return C6_GURKIAI_FLAT_SUMMARY_ENDPOINT;
}

function validateApiToken(value: string): string {
  if (
    value.length === 0 ||
    value.trim() !== value ||
    value.includes("\0")
  ) {
    throw new Error(
      "C6 flat-summary authorization token is invalid",
    );
  }
  return value;
}

function assertNoAuthorizationMaterial(
  bytes: Uint8Array,
  apiToken: string,
  message: string,
): void {
  if (containsAuthorizationMaterial(bytes, apiToken)) {
    throw new Error(message);
  }
}

function containsAuthorizationMaterial(
  bytes: Uint8Array,
  apiToken: string,
): boolean {
  return apiToken.length > 0 &&
    Buffer.from(bytes).includes(Buffer.from(apiToken));
}

function timestamp(now: () => Date): string {
  let value: Date;
  try {
    value = now();
  } catch {
    throw new Error("C6 flat-summary capture clock failed");
  }
  if (
    !(value instanceof Date) ||
    !Number.isFinite(value.getTime())
  ) {
    throw new Error("C6 flat-summary capture clock is invalid");
  }
  return value.toISOString();
}

function compareStageBindings(
  left: C6FlatSummaryCorpusExpectation["stageBindings"][number],
  right: C6FlatSummaryCorpusExpectation["stageBindings"][number],
): number {
  return compareCodeUnits(left.episodeId, right.episodeId) ||
    compareCodeUnits(left.stageId, right.stageId) ||
    compareCodeUnits(left.generationKey, right.generationKey);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isArtifactReference(value: unknown): value is {
  path: string;
  sha256: string;
} {
  return isRecord(value) &&
    hasExactKeys(value, ["path", "sha256"]) &&
    trimmedString(value.path) &&
    isSha256(value.sha256);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value).sort();
  const expectedKeys = [...expected].sort();
  return keys.length === expectedKeys.length &&
    keys.every((key, index) => key === expectedKeys[index]);
}

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(`${canonicalJson(value)}\n`);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function decodeUtf8(bytes: Uint8Array, message: string): string {
  try {
    return UTF8_DECODER.decode(bytes);
  } catch {
    throw new Error(message);
  }
}

function stageKey(episodeId: string, stageId: string): string {
  return `${episodeId}\0${stageId}`;
}

function trimmedString(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.trim() === value;
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function nonnegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function assertSha256(value: string, message: string): void {
  if (!isSha256(value)) {
    throw new Error(message);
  }
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" &&
    /^[a-f0-9]{64}$/u.test(value);
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value);
}

async function sleepMilliseconds(
  milliseconds: number,
): Promise<void> {
  await new Promise<void>((resolvePromise) => {
    setTimeout(resolvePromise, milliseconds);
  });
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
