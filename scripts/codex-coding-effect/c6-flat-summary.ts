import { createHash } from "node:crypto";

import { estimateTextTokens } from "../../src/tokenEstimator";
import {
  assertFlatSummaryControlComparable,
  EMPTY_FROZEN_PREHISTORY_SHA256,
} from "./frozen-prehistory";
import type {
  NormalizedCodexUsage,
} from "./codex-events";
import {
  auditC6FlatSummaryOutputLeakage,
} from "./c6-leakage";
import type {
  C6LeakageContext,
} from "./c6-leakage";

export const C6_INJECTION_TOKEN_COUNTER_ID =
  "goodmemory-estimate-text-tokens-v1";
export const C6_INJECTION_TOKEN_COUNTER_SHA256 =
  "53627b6b61ecd56dff9511dab714e1610d9c899a2a7c388d9baa13a62ae5bc5b";
export const C6_FLAT_SUMMARY_INJECTION_COMPOSITION =
  "verbatim-summary-output-no-wrapper-v1";
export const C6_FLAT_SUMMARY_INJECTION_COMPOSITION_SHA256 =
  "7d8a54b0b45117987971e83eee6dd75b79840af879d51f5d4f9fa31e15ac5bdd";
export const C6_GOODMEMORY_INJECTION_COMPOSITION =
  "goodmemory-installed-host-additional-context-v1";
export const C6_GOODMEMORY_INJECTION_COMPOSITION_SHA256 =
  "e9992090351619476a54fb45fda79c63b91b8dc6673086f1deed6c3fc8d1a5ef";
export const C6_NO_HISTORY_ZERO_INJECTION_COMPOSITION =
  "no-history-zero-additional-context-v1";
export const C6_NO_HISTORY_ZERO_INJECTION_COMPOSITION_SHA256 =
  "e96467a6c9c3a32662035bea1449a22d64438262fec7c150bbce02446d404dc3";
export const C6_FLAT_SUMMARY_GENERATION_POLICY =
  "once-per-nonempty-stage-history-before-arm-execution";
export const C6_FLAT_SUMMARY_CORPUS_STATUS =
  "structural-preflight-only";
export const C6_NO_HISTORY_CONTROL = {
  flatSummaryProviderCall: "prohibited",
  historySourceSha256: EMPTY_FROZEN_PREHISTORY_SHA256,
  injectedContentSha256: EMPTY_FROZEN_PREHISTORY_SHA256,
  injectedTokenCount: 0,
  injectionMode: "no-history-zero-injection",
  zeroInjectionArms: [
    "flat-summary",
    "goodmemory-installed",
  ],
  zeroInjectionComposition:
    C6_NO_HISTORY_ZERO_INJECTION_COMPOSITION,
  zeroInjectionCompositionSha256:
    C6_NO_HISTORY_ZERO_INJECTION_COMPOSITION_SHA256,
} as const;

export type C6InjectionArm = "flat-summary" | "goodmemory-installed";
export type C6InjectionMode =
  | "content-injection"
  | "no-history-zero-injection";

export interface C6InjectionBudgetReceipt {
  arm: C6InjectionArm;
  compositionSha256: string;
  contentSha256: string;
  historySourceSha256: string;
  injectedTokenCount: number;
  injectionMode: C6InjectionMode;
  maxInjectedTokens: number;
  schemaVersion: 2;
  tokenCounterId: typeof C6_INJECTION_TOKEN_COUNTER_ID;
  tokenCounterSha256: typeof C6_INJECTION_TOKEN_COUNTER_SHA256;
}

export interface C6FlatSummaryArtifact {
  assetRootSha256: string;
  datasetManifestSha256: string;
  episodeId: string;
  estimatedCostUsd: number;
  generationPolicy: typeof C6_FLAT_SUMMARY_GENERATION_POLICY;
  historySourceSha256: string;
  injectionCompositionSha256: string;
  injectedTokenCount: number;
  leakageAuditSha256: string;
  leakageStatus: "accepted";
  maxInjectedTokens: number;
  model: string;
  output: string;
  outputSha256: string;
  outputTokens: number;
  pricingSnapshotSha256: string;
  promptSha256: string;
  provider: string;
  schemaVersion: 3;
  stageId: string;
  tokenCounterSha256: string;
  usage: NormalizedCodexUsage;
}

export interface C6FlatSummaryProtocol {
  generationPolicy: typeof C6_FLAT_SUMMARY_GENERATION_POLICY;
  maxInjectedTokens: number;
  model: string;
  noHistoryControl: typeof C6_NO_HISTORY_CONTROL;
  pricing: C6TokenPricing;
  pricingSnapshotSha256: string;
  promptSha256: string;
  provider: string;
  schemaVersion: 3;
  tokenCounterSha256: string;
}

export interface C6FlatSummaryExpectedBinding {
  assetRootSha256: string;
  datasetManifestSha256: string;
  episodeId: string;
  historySourceSha256: string;
  stageId: string;
}

export interface C6FlatSummaryCorpus {
  generationReceipts: C6FlatSummaryGenerationReceipt[];
  providerAuthenticityVerified: false;
  schemaVersion: 1;
  stageBindingReceipts: C6FlatSummaryStageBindingReceipt[];
  status: typeof C6_FLAT_SUMMARY_CORPUS_STATUS;
}

export interface C6FlatSummaryCorpusExpectation {
  generationBindings: Array<{
    generationKey: string;
    historySourceSha256: string;
  }>;
  noHistoryStageBindings: Array<{
    episodeId: string;
    stageId: string;
  }>;
  seeds: readonly number[];
  stageBindings: Array<{
    episodeId: string;
    generationKey: string;
    stageId: string;
  }>;
}

export interface C6FlatSummaryCorpusVerification {
  codexRunReady: false;
  generationReceipts: {
    required: number;
    structurallyVerified: number;
  };
  providerAuthenticityVerified: false;
  schemaVersion: 1;
  stageBindingReceipts: {
    required: number;
    structurallyVerified: number;
  };
  status: typeof C6_FLAT_SUMMARY_CORPUS_STATUS;
}

export interface C6FlatSummaryGenerationReceipt {
  generationKey: string;
  historySourceSha256: string;
  outputSha256: string;
  providerArtifactSha256: string;
}

export interface C6FlatSummaryStageBindingReceipt {
  episodeId: string;
  generationKey: string;
  outputSha256: string;
  seed: number;
  stageId: string;
}

export interface C6TokenPricing {
  cachedInputUsdPerMillionTokens: number;
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
}

export async function buildC6FlatSummaryArtifact(input: {
  episodeId: string;
  goodMemoryHistorySourceSha256: string;
  goodMemoryMaxInjectedTokens: number;
  leakageContext: C6LeakageContext;
  model: string;
  output: string;
  outputTokens: number;
  pricing: C6TokenPricing;
  pricingSnapshotSha256: string;
  promptSha256: string;
  provider: string;
  stageId: string;
  summaryHistorySourceSha256: string;
  summaryMaxInjectedTokens: number;
  tokenCounterSha256: string;
  usage: NormalizedCodexUsage;
}): Promise<C6FlatSummaryArtifact> {
  assertFlatSummaryControlComparable({
    goodMemory: {
      historySourceSha256: input.goodMemoryHistorySourceSha256,
      maxInjectedTokens: input.goodMemoryMaxInjectedTokens,
    },
    summary: {
      historySourceSha256: input.summaryHistorySourceSha256,
      maxInjectedTokens: input.summaryMaxInjectedTokens,
    },
  });
  assertSha256(input.summaryHistorySourceSha256);
  if (
    input.summaryHistorySourceSha256 ===
      EMPTY_FROZEN_PREHISTORY_SHA256
  ) {
    throw new Error(
      "C6 no-history control forbids a flat-summary provider artifact",
    );
  }
  assertSha256(input.pricingSnapshotSha256);
  assertSha256(input.promptSha256);
  assertSha256(input.tokenCounterSha256);
  let injectionReceipt: C6InjectionBudgetReceipt;
  try {
    injectionReceipt = buildC6InjectionBudgetReceipt({
      arm: "flat-summary",
      compositionSha256: C6_FLAT_SUMMARY_INJECTION_COMPOSITION_SHA256,
      historySourceSha256: input.summaryHistorySourceSha256,
      injectedText: input.output,
      injectionMode: "content-injection",
      maxInjectedTokens: input.summaryMaxInjectedTokens,
    });
  } catch {
    throw new Error("C6 flat summary exceeds its injected token budget");
  }
  const injectedTokenCount = injectionReceipt.injectedTokenCount;
  if (
    !Number.isSafeInteger(input.outputTokens) ||
    input.outputTokens <= 0 ||
    injectedTokenCount <= 0 ||
    injectedTokenCount > input.summaryMaxInjectedTokens
  ) {
    throw new Error("C6 flat summary exceeds its injected token budget");
  }
  if (input.tokenCounterSha256 !== C6_INJECTION_TOKEN_COUNTER_SHA256) {
    throw new Error("C6 flat summary token counter is not frozen");
  }
  if (!validPricing(input.pricing)) {
    throw new Error("C6 flat summary pricing is invalid");
  }
  if (
    input.output.length === 0 ||
    input.output.trim() !== input.output ||
    input.usage.outputTokens !== input.outputTokens ||
    !validUsage(input.usage)
  ) {
    throw new Error("C6 flat summary output and usage are invalid");
  }
  for (const value of [
    input.episodeId,
    input.model,
    input.provider,
    input.stageId,
  ]) {
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      value.trim() !== value
    ) {
      throw new Error("C6 flat summary identity values must be non-empty");
    }
  }
  const leakageAudit = await auditC6FlatSummaryOutputLeakage({
    ...input.leakageContext,
    episodeId: input.episodeId,
    output: input.output,
    stageId: input.stageId,
  });
  if (
    leakageAudit.historySourceSha256 !==
      input.summaryHistorySourceSha256 ||
    leakageAudit.stageId !== input.stageId ||
    leakageAudit.summaryPromptSha256 !== input.promptSha256
  ) {
    throw new Error("C6 flat summary leakage audit binding does not match");
  }

  return {
    assetRootSha256: leakageAudit.assetRootSha256,
    datasetManifestSha256: leakageAudit.datasetManifestSha256,
    episodeId: input.episodeId,
    estimatedCostUsd: calculateC6FlatSummaryCost(
      input.usage,
      input.pricing,
    ),
    generationPolicy: C6_FLAT_SUMMARY_GENERATION_POLICY,
    historySourceSha256: input.summaryHistorySourceSha256,
    injectionCompositionSha256: injectionReceipt.compositionSha256,
    injectedTokenCount,
    leakageAuditSha256: leakageAudit.auditSha256,
    leakageStatus: "accepted",
    maxInjectedTokens: input.summaryMaxInjectedTokens,
    model: input.model,
    output: input.output,
    outputSha256: sha256(input.output),
    outputTokens: input.outputTokens,
    pricingSnapshotSha256: input.pricingSnapshotSha256,
    promptSha256: input.promptSha256,
    provider: input.provider,
    schemaVersion: 3,
    stageId: input.stageId,
    tokenCounterSha256: input.tokenCounterSha256,
    usage: { ...input.usage },
  };
}

export async function validateC6FlatSummaryArtifact(
  artifact: C6FlatSummaryArtifact,
  protocol: C6FlatSummaryProtocol,
  expected: C6FlatSummaryExpectedBinding,
  leakageContext: C6LeakageContext,
): Promise<void> {
  if (
    artifact.historySourceSha256 ===
      EMPTY_FROZEN_PREHISTORY_SHA256
  ) {
    throw new Error(
      "C6 no-history control forbids a flat-summary provider artifact",
    );
  }
  if (
    !isSha256(artifact.assetRootSha256) ||
    !isSha256(artifact.datasetManifestSha256) ||
    !isSha256(artifact.historySourceSha256) ||
    !isSha256(artifact.injectionCompositionSha256) ||
    !isSha256(artifact.leakageAuditSha256) ||
    !isSha256(artifact.outputSha256) ||
    !isSha256(artifact.pricingSnapshotSha256) ||
    !isSha256(artifact.promptSha256) ||
    !isSha256(artifact.tokenCounterSha256) ||
    artifact.leakageStatus !== "accepted" ||
    [
      artifact.episodeId,
      artifact.model,
      artifact.provider,
      artifact.stageId,
    ].some((value) => value.length === 0 || value.trim() !== value) ||
    artifact.output.length === 0 ||
    artifact.output.trim() !== artifact.output ||
    artifact.outputSha256 !== sha256(artifact.output) ||
    !Number.isSafeInteger(artifact.outputTokens) ||
    artifact.outputTokens <= 0 ||
    !Number.isSafeInteger(artifact.injectedTokenCount) ||
    artifact.injectedTokenCount <= 0 ||
    artifact.injectedTokenCount !== countC6InjectedTokens(artifact.output) ||
    artifact.injectedTokenCount > artifact.maxInjectedTokens ||
    artifact.usage.outputTokens !== artifact.outputTokens ||
    !validUsage(artifact.usage) ||
    !Number.isFinite(artifact.estimatedCostUsd) ||
    artifact.estimatedCostUsd < 0 ||
    !validPricing(protocol.pricing) ||
    artifact.estimatedCostUsd !==
      calculateC6FlatSummaryCost(artifact.usage, protocol.pricing)
  ) {
    throw new Error("C6 flat summary artifact is invalid");
  }
  if (
    artifact.schemaVersion !== 3 ||
    artifact.generationPolicy !==
      C6_FLAT_SUMMARY_GENERATION_POLICY ||
    artifact.injectionCompositionSha256 !==
      C6_FLAT_SUMMARY_INJECTION_COMPOSITION_SHA256 ||
    artifact.maxInjectedTokens !== protocol.maxInjectedTokens ||
    artifact.model !== protocol.model ||
    artifact.pricingSnapshotSha256 !== protocol.pricingSnapshotSha256 ||
    artifact.promptSha256 !== protocol.promptSha256 ||
    artifact.provider !== protocol.provider ||
    artifact.tokenCounterSha256 !== protocol.tokenCounterSha256 ||
    protocol.tokenCounterSha256 !== C6_INJECTION_TOKEN_COUNTER_SHA256 ||
    protocol.schemaVersion !== 3 ||
    protocol.generationPolicy !== C6_FLAT_SUMMARY_GENERATION_POLICY ||
    JSON.stringify(protocol.noHistoryControl) !==
      JSON.stringify(C6_NO_HISTORY_CONTROL)
  ) {
    throw new Error("C6 flat summary does not match the frozen protocol");
  }
  if (
    !isSha256(expected.assetRootSha256) ||
    !isSha256(expected.datasetManifestSha256) ||
    artifact.assetRootSha256 !== expected.assetRootSha256 ||
    artifact.datasetManifestSha256 !== expected.datasetManifestSha256
  ) {
    throw new Error(
      "C6 flat summary does not match the candidate asset bindings",
    );
  }
  if (artifact.episodeId !== expected.episodeId) {
    throw new Error("C6 flat summary does not match its candidate episode");
  }
  if (
    artifact.stageId !== expected.stageId ||
    artifact.historySourceSha256 !== expected.historySourceSha256
  ) {
    throw new Error("C6 flat summary does not match its candidate stage");
  }
  const leakageAudit = await auditC6FlatSummaryOutputLeakage({
    ...leakageContext,
    episodeId: artifact.episodeId,
    output: artifact.output,
    stageId: artifact.stageId,
  });
  if (
    artifact.assetRootSha256 !== leakageAudit.assetRootSha256 ||
    artifact.datasetManifestSha256 !==
      leakageAudit.datasetManifestSha256 ||
    artifact.leakageAuditSha256 !== leakageAudit.auditSha256 ||
    artifact.historySourceSha256 !== leakageAudit.historySourceSha256 ||
    artifact.promptSha256 !== leakageAudit.summaryPromptSha256 ||
    artifact.stageId !== leakageAudit.stageId
  ) {
    throw new Error("C6 flat summary leakage audit does not match");
  }
}

export function computeC6FlatSummaryGenerationKey(input: {
  artifactSha256: string;
  materializationSha256: string;
  sourceUnitCount: number;
  sourceUnitIdsSha256: string;
}): string {
  if (
    !isSha256(input.artifactSha256) ||
    !isSha256(input.materializationSha256) ||
    !Number.isSafeInteger(input.sourceUnitCount) ||
    input.sourceUnitCount <= 0 ||
    !isSha256(input.sourceUnitIdsSha256)
  ) {
    throw new Error("C6 flat-summary generation binding is invalid");
  }
  return sha256(JSON.stringify({
    artifactSha256: input.artifactSha256,
    materializationSha256: input.materializationSha256,
    sourceUnitCount: input.sourceUnitCount,
    sourceUnitIdsSha256: input.sourceUnitIdsSha256,
  }));
}

export function verifyC6FlatSummaryCorpusCompleteness(
  corpus: C6FlatSummaryCorpus,
  expectation: C6FlatSummaryCorpusExpectation,
): C6FlatSummaryCorpusVerification {
  if (
    corpus.schemaVersion !== 1 ||
    corpus.status !== C6_FLAT_SUMMARY_CORPUS_STATUS ||
    corpus.providerAuthenticityVerified !== false ||
    !Array.isArray(corpus.generationReceipts) ||
    !Array.isArray(corpus.stageBindingReceipts)
  ) {
    throw new Error(
      "C6 flat-summary corpus is structural preflight only",
    );
  }
  const expectedGenerationByKey = new Map<string, string>();
  for (const binding of expectation.generationBindings) {
    if (
      !isSha256(binding.generationKey) ||
      !isSha256(binding.historySourceSha256) ||
      binding.historySourceSha256 === EMPTY_FROZEN_PREHISTORY_SHA256 ||
      expectedGenerationByKey.has(binding.generationKey)
    ) {
      throw new Error("C6 flat-summary corpus expectation is invalid");
    }
    expectedGenerationByKey.set(
      binding.generationKey,
      binding.historySourceSha256,
    );
  }
  if (
    expectation.seeds.length !== 3 ||
    new Set(expectation.seeds).size !== 3 ||
    expectation.seeds.some((seed) =>
      !Number.isSafeInteger(seed) || seed <= 0
    )
  ) {
    throw new Error("C6 flat-summary corpus expectation is invalid");
  }

  const noHistoryStageKeys = new Set<string>();
  for (const binding of expectation.noHistoryStageBindings) {
    const key = stageKey(binding.episodeId, binding.stageId);
    if (
      !validIdentity(binding.episodeId) ||
      !validIdentity(binding.stageId) ||
      noHistoryStageKeys.has(key)
    ) {
      throw new Error("C6 flat-summary corpus expectation is invalid");
    }
    noHistoryStageKeys.add(key);
  }
  const expectedStageByKey = new Map<string, string>();
  const referencedGenerationKeys = new Set<string>();
  for (const binding of expectation.stageBindings) {
    const key = stageKey(binding.episodeId, binding.stageId);
    if (
      !validIdentity(binding.episodeId) ||
      !validIdentity(binding.stageId) ||
      !expectedGenerationByKey.has(binding.generationKey) ||
      noHistoryStageKeys.has(key) ||
      expectedStageByKey.has(key)
    ) {
      throw new Error("C6 flat-summary corpus expectation is invalid");
    }
    expectedStageByKey.set(key, binding.generationKey);
    referencedGenerationKeys.add(binding.generationKey);
  }
  if (
    referencedGenerationKeys.size !== expectedGenerationByKey.size ||
    [...expectedGenerationByKey.keys()].some((key) =>
      !referencedGenerationKeys.has(key)
    )
  ) {
    throw new Error("C6 flat-summary corpus expectation is invalid");
  }

  const generationReceiptByKey =
    new Map<string, C6FlatSummaryGenerationReceipt>();
  for (const receipt of corpus.generationReceipts) {
    if (
      !isSha256(receipt.generationKey) ||
      !isSha256(receipt.historySourceSha256) ||
      !isSha256(receipt.outputSha256) ||
      !isSha256(receipt.providerArtifactSha256)
    ) {
      throw new Error("C6 flat-summary generation receipt is invalid");
    }
    if (
      receipt.historySourceSha256 === EMPTY_FROZEN_PREHISTORY_SHA256
    ) {
      throw new Error(
        "C6 no-history control forbids a flat-summary generation receipt",
      );
    }
    if (generationReceiptByKey.has(receipt.generationKey)) {
      throw new Error(
        "C6 flat-summary generation receipt duplicates a generation key",
      );
    }
    generationReceiptByKey.set(receipt.generationKey, receipt);
  }
  assertExactKeys(
    generationReceiptByKey.keys(),
    expectedGenerationByKey.keys(),
    "C6 flat-summary generation receipt exact set does not match",
  );
  for (const [generationKey, receipt] of generationReceiptByKey) {
    if (
      receipt.historySourceSha256 !==
        expectedGenerationByKey.get(generationKey)
    ) {
      throw new Error(
        "C6 flat-summary generation receipt does not match its history",
      );
    }
  }

  const expectedSeedStageByKey = new Map<string, string>();
  for (const [baseStageKey, generationKey] of expectedStageByKey) {
    const [episodeId, stageId] = parseStageKey(baseStageKey);
    for (const seed of expectation.seeds) {
      expectedSeedStageByKey.set(
        seedStageKey(episodeId, stageId, seed),
        generationKey,
      );
    }
  }
  const stageReceiptByKey =
    new Map<string, C6FlatSummaryStageBindingReceipt>();
  for (const receipt of corpus.stageBindingReceipts) {
    if (
      !validIdentity(receipt.episodeId) ||
      !validIdentity(receipt.stageId) ||
      !Number.isSafeInteger(receipt.seed) ||
      receipt.seed <= 0 ||
      !isSha256(receipt.generationKey) ||
      !isSha256(receipt.outputSha256)
    ) {
      throw new Error("C6 flat-summary stage-binding receipt is invalid");
    }
    if (noHistoryStageKeys.has(stageKey(receipt.episodeId, receipt.stageId))) {
      throw new Error(
        "C6 no-history control forbids a flat-summary stage binding",
      );
    }
    const key = seedStageKey(
      receipt.episodeId,
      receipt.stageId,
      receipt.seed,
    );
    if (stageReceiptByKey.has(key)) {
      throw new Error(
        "C6 flat-summary stage-binding receipt duplicates a stage and seed",
      );
    }
    stageReceiptByKey.set(key, receipt);
  }
  assertExactKeys(
    stageReceiptByKey.keys(),
    expectedSeedStageByKey.keys(),
    "C6 flat-summary stage-binding receipt exact set does not match",
  );
  for (const [key, receipt] of stageReceiptByKey) {
    if (receipt.generationKey !== expectedSeedStageByKey.get(key)) {
      throw new Error(
        "C6 flat-summary stage binding does not match its generation key",
      );
    }
    if (
      generationReceiptByKey.get(receipt.generationKey)?.outputSha256 !==
        receipt.outputSha256
    ) {
      throw new Error(
        "C6 flat-summary stage bindings must reuse the generation output hash",
      );
    }
  }

  return {
    codexRunReady: false,
    generationReceipts: {
      required: expectedGenerationByKey.size,
      structurallyVerified: generationReceiptByKey.size,
    },
    providerAuthenticityVerified: false,
    schemaVersion: 1,
    stageBindingReceipts: {
      required: expectedSeedStageByKey.size,
      structurallyVerified: stageReceiptByKey.size,
    },
    status: C6_FLAT_SUMMARY_CORPUS_STATUS,
  };
}

export function countC6InjectedTokens(value: string): number {
  return estimateTextTokens(value);
}

export function buildC6InjectionBudgetReceipt(input: {
  arm: C6InjectionArm;
  compositionSha256: string;
  historySourceSha256: string;
  injectedText: string;
  injectionMode: C6InjectionMode;
  maxInjectedTokens: number;
}): C6InjectionBudgetReceipt {
  const injectedTokenCount = countC6InjectedTokens(input.injectedText);
  const isZeroInjection =
    input.injectionMode === "no-history-zero-injection";
  const validZeroInjection =
    isZeroInjection &&
    input.compositionSha256 ===
      C6_NO_HISTORY_ZERO_INJECTION_COMPOSITION_SHA256 &&
    input.historySourceSha256 ===
      EMPTY_FROZEN_PREHISTORY_SHA256 &&
    input.injectedText === "" &&
    injectedTokenCount === 0;
  const validContentInjection =
    input.injectionMode === "content-injection" &&
    input.compositionSha256 === expectedCompositionSha256(input.arm) &&
    input.historySourceSha256 !==
      EMPTY_FROZEN_PREHISTORY_SHA256 &&
    input.injectedText.length > 0 &&
    injectedTokenCount > 0;
  if (
    !isSha256(input.historySourceSha256) ||
    !Number.isSafeInteger(input.maxInjectedTokens) ||
    input.maxInjectedTokens <= 0 ||
    (!validZeroInjection && !validContentInjection) ||
    injectedTokenCount > input.maxInjectedTokens
  ) {
    throw new Error("C6 final injected text exceeds its token budget");
  }
  return {
    arm: input.arm,
    compositionSha256: input.compositionSha256,
    contentSha256: sha256(input.injectedText),
    historySourceSha256: input.historySourceSha256,
    injectedTokenCount,
    injectionMode: input.injectionMode,
    maxInjectedTokens: input.maxInjectedTokens,
    schemaVersion: 2,
    tokenCounterId: C6_INJECTION_TOKEN_COUNTER_ID,
    tokenCounterSha256: C6_INJECTION_TOKEN_COUNTER_SHA256,
  };
}

export function validateC6InjectionBudgetReceipt(
  receipt: C6InjectionBudgetReceipt,
  expected: {
    arm: C6InjectionArm;
    compositionSha256: string;
    historySourceSha256: string;
    injectedText: string;
    injectionMode: C6InjectionMode;
    maxInjectedTokens: number;
  },
): void {
  let rebuilt: C6InjectionBudgetReceipt;
  try {
    rebuilt = buildC6InjectionBudgetReceipt(expected);
  } catch {
    throw new Error("C6 injection budget receipt is invalid");
  }
  if (JSON.stringify(receipt) !== JSON.stringify(rebuilt)) {
    throw new Error("C6 injection budget receipt is invalid");
  }
}

function expectedCompositionSha256(arm: C6InjectionArm): string {
  return arm === "flat-summary"
    ? C6_FLAT_SUMMARY_INJECTION_COMPOSITION_SHA256
    : C6_GOODMEMORY_INJECTION_COMPOSITION_SHA256;
}

function validUsage(usage: NormalizedCodexUsage): boolean {
  return usage.cachedInputTokens <= usage.inputTokens && [
    usage.cachedInputTokens,
    usage.inputTokens,
    usage.outputTokens,
  ].every((value) => Number.isSafeInteger(value) && value >= 0);
}

function validPricing(pricing: C6TokenPricing): boolean {
  return [
    pricing.cachedInputUsdPerMillionTokens,
    pricing.inputUsdPerMillionTokens,
    pricing.outputUsdPerMillionTokens,
  ].every((value) => Number.isFinite(value) && value >= 0);
}

function calculateC6FlatSummaryCost(
  usage: NormalizedCodexUsage,
  pricing: C6TokenPricing,
): number {
  const uncachedInputTokens =
    usage.inputTokens - usage.cachedInputTokens;
  return (
    uncachedInputTokens * pricing.inputUsdPerMillionTokens +
    usage.cachedInputTokens * pricing.cachedInputUsdPerMillionTokens +
    usage.outputTokens * pricing.outputUsdPerMillionTokens
  ) / 1_000_000;
}

function assertExactKeys(
  actual: Iterable<string>,
  expected: Iterable<string>,
  message: string,
): void {
  const actualKeys = new Set(actual);
  const expectedKeys = new Set(expected);
  if (
    actualKeys.size !== expectedKeys.size ||
    [...expectedKeys].some((key) => !actualKeys.has(key))
  ) {
    throw new Error(message);
  }
}

function assertSha256(value: string): void {
  if (!isSha256(value)) {
    throw new Error("C6 flat summary bindings must be SHA-256 digests");
  }
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/u.test(value);
}

function parseStageKey(value: string): [string, string] {
  const separator = value.indexOf("\0");
  return [
    value.slice(0, separator),
    value.slice(separator + 1),
  ];
}

function seedStageKey(
  episodeId: string,
  stageId: string,
  seed: number,
): string {
  return `${stageKey(episodeId, stageId)}\0${seed}`;
}

function stageKey(episodeId: string, stageId: string): string {
  return `${episodeId}\0${stageId}`;
}

function validIdentity(value: string): boolean {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.trim() === value &&
    !value.includes("\0")
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
