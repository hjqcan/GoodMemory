import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { z } from "zod";

import {
  createDeterministicMemoryExtractor,
  createLanguageService,
} from "../src";
import type { LanguageAnalyzerManifest } from "../src";
import type { ModelUsageAttempt } from "../src";
import {
  requestOpenAICompatibleTextResult,
  stripThinkingBlocks,
} from "../src/provider/ai-sdk-runtime";
import {
  MEMORY_EXTRACTION_SYSTEM_PROMPT,
  memoryExtractionResultSchema,
  normalizeMemoryExtractionPayload,
} from "../src/provider/memory-extractor";
import {
  normalizeAISDKLanguageModelUsage,
  runWithModelUsageAttempt,
} from "../src/provider/model-usage";
import type { MemoryExtractionResult } from "../src/remember/candidates";
import {
  hasCliFlagStrict,
  parseCliPositiveIntegerFlagStrict,
  resolveCliFlagValueStrict,
  resolveCliPathSegmentFlagValueStrict,
} from "./cli-options";
import { resolveProviderBackedModelConfig } from "./run-eval";
import { resolveRepoRootFromScriptUrl } from "./script-paths";

const MANIFEST_PATH = "fixtures/research/preference-identity-v1/manifest.json";
const PREREGISTRATION_PATH =
  "fixtures/research/preference-identity-v1/preregistration.json";
const PROTECTION_COHORT_PATH =
  "fixtures/research/preference-identity-v1/protection-cohort.json";
const RAW_CALLS_DIRECTORY = "raw-calls";
const execFileAsync = promisify(execFile);

const atomSchema = z.object({
  slot: z.string().min(1),
  value: z.string().min(1),
});

const variantSchema = z.object({
  context: z.enum(["general", "personal_study", "work"]),
  locale: z.enum(["en-US", "zh-CN"]),
  text: z.string().min(1),
  variantId: z.string().min(1),
});

const manifestSchema = z.object({
  groups: z.array(z.object({
    expectedAtoms: z.array(atomSchema).min(1).max(3),
    groupId: z.string().min(1),
    kind: z.enum(["atomic", "compound"]),
    variants: z.array(variantSchema).length(6),
  })).length(30),
  protocolId: z.literal("preference-identity-independent-arms-v1"),
  schemaVersion: z.literal(2),
});

const protectionCohortSchema = z.object({
  protocolId: z.literal("preference-identity-protection-independent-arms-v1"),
  schemaVersion: z.literal(2),
  selectionRule: z.string().min(1),
  variantIds: z.array(z.string().min(1)).length(90),
});

const thresholdSchema = z.object({ min: z.number().min(0).max(1) });
const effectivePromptArmSchema = z.object({
  customPromptSource: z.string().min(1),
  customPromptsSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  outputProtocol: z.literal("canonical-v1"),
  responseFormat: z.literal("json_object"),
  schemaSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  schemaSource: z.string().min(1),
  system: z.string().min(1),
  systemSha256: z.string().regex(/^[a-f0-9]{64}$/u),
});
const preregistrationSchema = z.object({
  comparisonMode: z.literal("independent-prompt-arms"),
  closedVocabulary: z.array(z.string().min(1)).min(2),
  contextVocabulary: z.array(z.string().min(1)).length(3),
  gates: z.object({
    atomicizationPrecision: thresholdSchema,
    atomicizationRecall: thresholdSchema,
    compoundAtomicizationPrecision: thresholdSchema,
    compoundAtomicizationRecall: thresholdSchema,
    contextAgreement: thresholdSchema,
    executionFailureCount: z.object({ max: z.literal(0) }),
    paraphraseExactKeySetAgreement: thresholdSchema,
    parseOrMissingKeyCount: z.object({ max: z.literal(0) }),
    preferenceCaptureRate: thresholdSchema,
    repeatConsistency: thresholdSchema,
    unintendedCrossDimensionCollisionCount: z.object({ max: z.literal(0) }),
  }),
  goldUsage: z.object({
    expectedAtoms: z.literal("offline-scoring-only"),
    promptValueVocabularyExposed: z.literal(false),
    providerInputFingerprintsExcludeExpectedAtoms: z.literal(true),
  }),
  manifest: z.object({
    compoundAtomCountRange: z.tuple([z.literal(2), z.literal(3)]),
    groupCount: z.literal(30),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    variantCount: z.literal(180),
  }),
  model: z.object({
    environmentPrefix: z.literal("GOODMEMORY_ASSISTED_EXTRACTOR"),
    expectedModel: z.string().min(1),
    expectedProvider: z.literal("openai"),
    requiresBaseUrl: z.literal(true),
    role: z.literal("non-judge-assisted-extractor"),
    retryLimit: z.literal(0),
    temperature: z.literal(0),
  }),
  otherConflictMatchable: z.literal(false),
  otherStorageSemantics: z.object({
    conflictMatchable: z.literal(false),
    rejectWrite: z.literal(false),
    storedAndFlagged: z.literal(true),
  }),
  outputEvidence: z.object({
    fixedRunId: z.literal("preference-independent-arms-v1"),
    fixedRunPath: z.literal(
      "reports/eval/research/preference-identity/preference-independent-arms-v1",
    ),
    liveRequiresCleanGit: z.literal(true),
    trackableArtifacts: z.tuple([
      z.literal("report.json"),
      z.literal("raw-fingerprints.json"),
    ]),
    rulesOnlyRowsPersisted: z.literal(false),
    perCallRawPersistence: z.literal("immediate-wx"),
    untrackedPerCallRawDirectory: z.literal("raw-calls"),
    untrackedRawPayload: z.literal("raw-results.jsonl"),
    untrackedRawPayloadPersisted: z.literal(true),
    requiredFingerprints: z.tuple([
      z.literal("manifestSha256"),
      z.literal("preregistrationSha256"),
      z.literal("effectivePromptSha256"),
      z.literal("promptSha256"),
      z.literal("inputPlanAggregateSha256"),
      z.literal("inputFingerprint"),
      z.literal("rawFingerprint"),
    ]),
  }).passthrough(),
  effectivePrompt: z.object({
    aggregateSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    arms: z.object({
      closedKey: effectivePromptArmSchema,
      openKey: effectivePromptArmSchema,
    }),
    customPromptsSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  }),
  inputPlan: z.object({
    aggregateSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    callCount: z.literal(720),
    goldExpectedAtomsIncluded: z.literal(false),
  }),
  plannedTotalCalls: z.literal(720),
  plannedProviderAttempts: z.literal(720),
  protectionCohort: z.object({
    decisionBasis: z.literal("protection-only"),
    path: z.literal(PROTECTION_COHORT_PATH),
    plannedCallsPerArm: z.literal(180),
    plannedTotalCalls: z.literal(360),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    variantCount: z.literal(90),
  }),
  protocolId: z.literal("preference-identity-independent-arms-v1"),
  repetitions: z.literal(2),
  schemaVersion: z.literal(2),
  valueVocabulary: z.array(z.string().min(1)).length(20),
}).passthrough();

export type PreferenceIdentityManifest = z.infer<typeof manifestSchema>;
export type PreferenceIdentityProtectionCohort = z.infer<
  typeof protectionCohortSchema
>;
export type PreferenceIdentityPreregistration = z.infer<
  typeof preregistrationSchema
>;
export type PreferenceIdentityKeyMode = "closed-key" | "open-key";
export type PreferenceIdentityCohort = "development" | "protection";

export interface PreferenceIdentityCandidateResult {
  context: string;
  key: string;
  value: string;
}

export interface PreferenceIdentityCallPlanRow {
  arm: PreferenceIdentityKeyMode;
  callId: string;
  cohort: PreferenceIdentityCohort;
  context: string;
  expectedAtoms: Array<{ slot: string; value: string }>;
  groupId: string;
  groupKind: "atomic" | "compound";
  inputFingerprint: string;
  locale: "en-US" | "zh-CN";
  repetition: 1 | 2;
  text: string;
  variantId: string;
}

export interface PreferenceIdentityExperimentRow
  extends PreferenceIdentityCallPlanRow {
  candidates: PreferenceIdentityCandidateResult[];
  error?: string;
  executionStatus: "failed" | "succeeded";
  missingKeyCount?: number;
  parseFailureCount?: number;
  rawOutputAvailable: boolean;
  rawFingerprint: string;
  rawPayload?: unknown;
}

export interface PreferenceIdentityMetrics {
  atomicizationPrecision: number;
  atomicizationRecall: number;
  compoundAtomicizationPrecision: number;
  compoundAtomicizationRecall: number;
  contextAgreement: number;
  executionFailureCount: number;
  paraphraseExactKeySetAgreement: number;
  parseOrMissingKeyCount: number;
  preferenceCaptureRate: number;
  repeatConsistency: number;
  unintendedCrossDimensionCollisionCount: number;
}

export interface PreferenceIdentityMetricSummary {
  metrics: PreferenceIdentityMetrics;
  otherDistribution: {
    candidateCount: number;
    contexts: Record<string, number>;
    groupIds: string[];
    rate: number;
  };
}

export interface PreferenceIdentityDecisionSummary
  extends PreferenceIdentityMetricSummary {
  decision: "accepted" | "blocked";
  failedGates: string[];
}

export interface PreferenceIdentityComparisonSummary {
  decisionBasis: "protection";
  development: {
    closedKey: PreferenceIdentityMetricSummary;
    openKey: PreferenceIdentityMetricSummary;
  };
  overall: {
    closedKey: PreferenceIdentityMetricSummary;
    openKey: PreferenceIdentityMetricSummary;
  };
  protection: {
    closedKey: PreferenceIdentityDecisionSummary;
    openKey: PreferenceIdentityDecisionSummary;
  };
  recommendation: "closed-key" | "no-api" | "open-key";
}

export interface PreferenceIdentityRulesOnlyBaseline {
  rows: Array<{
    candidates: Array<{
      category: string;
      context: string | null;
      slot: string | null;
      value: string;
    }>;
    cohort: PreferenceIdentityCohort;
    context: string;
    expectedAtoms: Array<{ slot: string; value: string }>;
    groupId: string;
    groupKind: "atomic" | "compound";
    variantId: string;
  }>;
  summary: {
    analyzerManifest: LanguageAnalyzerManifest;
    categoryDistribution: Record<string, number>;
    development: PreferenceIdentityRulesOnlyMetrics;
    overall: PreferenceIdentityRulesOnlyMetrics;
    protection: PreferenceIdentityRulesOnlyMetrics;
    rowFingerprint: string;
  };
}

export interface PreferenceIdentityRulesOnlyMetrics {
  atomicizationPrecision: number;
  atomicizationRecall: number;
  compoundAtomicizationPrecision: number;
  compoundAtomicizationRecall: number;
  preferenceCandidateCount: number;
  preferenceCaptureRate: number;
  variantCount: number;
}

export interface PreferenceIdentityFingerprintArtifact {
  aggregateSha256: string;
  count: number;
  inputAggregateSha256: string;
  inputCount: number;
  rows: Array<{
    arm: PreferenceIdentityKeyMode;
    callId: string;
    rawFingerprint: string;
  }>;
}

export interface PreferenceIdentityInputPlanIdentity {
  aggregateSha256: string;
  count: number;
}

export interface PreferenceIdentityEffectivePromptArmIdentity {
  customPromptsSha256: string;
  customPromptSource: string;
  outputProtocol: "canonical-v1";
  responseFormat: "json_object";
  schemaSha256: string;
  schemaSource: string;
  system: string;
  systemSha256: string;
}

export interface PreferenceIdentityEffectivePromptIdentity {
  aggregateSha256: string;
  arms: {
    closedKey: PreferenceIdentityEffectivePromptArmIdentity;
    openKey: PreferenceIdentityEffectivePromptArmIdentity;
  };
  customPromptsSha256: string;
}

export interface PreferenceIdentityRawResultRecord {
  arm: PreferenceIdentityKeyMode;
  callId: string;
  executionStatus: "failed" | "succeeded";
  missingKeyCount: number;
  parseFailureCount: number;
  rawOutputAvailable: boolean;
  rawFingerprint: string;
  rawPayload: unknown;
}

interface PreferenceIdentityCliOptions {
  live: boolean;
  maxConcurrency: number;
  outputDir?: string;
  runId?: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
}

function fingerprint(value: unknown): string {
  return sha256(JSON.stringify(stableValue(value)));
}

export function fingerprintPreferenceIdentityRawPayload(
  rawPayload: unknown,
): string {
  return fingerprint(rawPayload);
}

function normalizeContext(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/gu, "_");
}

function normalizeValue(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

async function resolveGitProvenance(repoRoot: string): Promise<{
  commit: string;
  dirty: boolean;
}> {
  const [{ stdout: commit }, { stdout: status }] = await Promise.all([
    execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoRoot }),
    execFileAsync("git", ["status", "--porcelain"], { cwd: repoRoot }),
  ]);
  return {
    commit: commit.trim(),
    dirty: status.trim().length > 0,
  };
}

function summarizeModelUsage(attempts: readonly ModelUsageAttempt[]): {
  attemptCount: number;
  completeAttemptCount: number;
  inputTokens: number | null;
  outputTokens: number | null;
} {
  const inputTokens = attempts.map(({ usage }) => usage.inputTokens);
  const outputTokens = attempts.map(({ usage }) => usage.outputTokens);
  return {
    attemptCount: attempts.length,
    completeAttemptCount: attempts.filter(
      ({ completeness }) => completeness === "complete",
    ).length,
    inputTokens: inputTokens.some((value) => value === null)
      ? null
      : inputTokens.reduce<number>((sum, value) => sum + (value ?? 0), 0),
    outputTokens: outputTokens.some((value) => value === null)
      ? null
      : outputTokens.reduce<number>((sum, value) => sum + (value ?? 0), 0),
  };
}

async function loadJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function loadPreferenceIdentityManifest(
  repoRoot: string,
): Promise<PreferenceIdentityManifest> {
  return manifestSchema.parse(await loadJson(join(repoRoot, MANIFEST_PATH)));
}

export async function loadPreferenceIdentityPreregistration(
  repoRoot: string,
): Promise<PreferenceIdentityPreregistration> {
  return preregistrationSchema.parse(
    await loadJson(join(repoRoot, PREREGISTRATION_PATH)),
  );
}

function validateProtectionCohort(input: {
  manifest: PreferenceIdentityManifest;
  protectionCohort: PreferenceIdentityProtectionCohort;
}): void {
  const selected = new Set(input.protectionCohort.variantIds);
  if (selected.size !== input.protectionCohort.variantIds.length) {
    throw new Error("Preference identity protection cohort contains duplicate IDs.");
  }
  const expected = input.manifest.groups.flatMap((group, groupIndex) =>
    group.variants
      .filter((variant) =>
        groupIndex % 2 === 0
          ? (variant.locale === "en-US" && variant.context === "general") ||
            (variant.locale === "zh-CN" && variant.context !== "general")
          : (variant.locale === "zh-CN" && variant.context === "general") ||
            (variant.locale === "en-US" && variant.context !== "general")
      )
      .map(({ variantId }) => variantId)
  );
  if (
    JSON.stringify([...selected].sort()) !== JSON.stringify(expected.sort())
  ) {
    throw new Error(
      "Preference identity protection cohort does not match the frozen balanced selection rule.",
    );
  }
}

export async function loadPreferenceIdentityProtectionCohort(
  repoRoot: string,
): Promise<PreferenceIdentityProtectionCohort> {
  const [manifestRaw, preregistrationRaw, protectionRaw] = await Promise.all([
    readFile(join(repoRoot, MANIFEST_PATH), "utf8"),
    readFile(join(repoRoot, PREREGISTRATION_PATH), "utf8"),
    readFile(join(repoRoot, PROTECTION_COHORT_PATH), "utf8"),
  ]);
  const manifest = manifestSchema.parse(JSON.parse(manifestRaw));
  const preregistration = preregistrationSchema.parse(
    JSON.parse(preregistrationRaw),
  );
  const protectionCohort = protectionCohortSchema.parse(
    JSON.parse(protectionRaw),
  );
  if (sha256(manifestRaw) !== preregistration.manifest.sha256) {
    throw new Error(
      "Preference identity manifest fingerprint does not match preregistration.",
    );
  }
  if (sha256(protectionRaw) !== preregistration.protectionCohort.sha256) {
    throw new Error(
      "Preference identity protection cohort fingerprint does not match preregistration.",
    );
  }
  validateProtectionCohort({ manifest, protectionCohort });
  return protectionCohort;
}

type PreferenceIdentityCallInput = Pick<
  PreferenceIdentityCallPlanRow,
  | "arm"
  | "cohort"
  | "context"
  | "groupId"
  | "groupKind"
  | "locale"
  | "repetition"
  | "text"
  | "variantId"
>;

function preferenceIdentityCallInput(
  call: PreferenceIdentityCallInput | PreferenceIdentityCallPlanRow,
): PreferenceIdentityCallInput {
  return {
    arm: call.arm,
    cohort: call.cohort,
    context: call.context,
    groupId: call.groupId,
    groupKind: call.groupKind,
    locale: call.locale,
    repetition: call.repetition,
    text: call.text,
    variantId: call.variantId,
  };
}

export function fingerprintPreferenceIdentityCallInput(
  call: PreferenceIdentityCallInput | PreferenceIdentityCallPlanRow,
): string {
  return fingerprint(preferenceIdentityCallInput(call));
}

export function buildPreferenceIdentityInputPlanIdentity(
  calls: readonly PreferenceIdentityCallPlanRow[],
): PreferenceIdentityInputPlanIdentity {
  const compactCalls = calls.map((call) => {
    const expectedFingerprint = fingerprintPreferenceIdentityCallInput(call);
    if (call.inputFingerprint !== expectedFingerprint) {
      throw new Error(
        `Preference identity input fingerprint mismatch for ${call.callId}.`,
      );
    }
    return {
      callId: call.callId,
      inputFingerprint: call.inputFingerprint,
    };
  });
  return {
    aggregateSha256: fingerprint(compactCalls),
    count: compactCalls.length,
  };
}

export function buildPreferenceIdentityEffectivePromptIdentity(input: {
  calls: readonly PreferenceIdentityCallPlanRow[];
  preregistration: PreferenceIdentityPreregistration;
  promptBuilder?: typeof buildPreferenceIdentityPrompt;
  schemaJson?: unknown;
  system?: string;
}): PreferenceIdentityEffectivePromptIdentity {
  const promptBuilder = input.promptBuilder ?? buildPreferenceIdentityPrompt;
  const system = input.system ?? MEMORY_EXTRACTION_SYSTEM_PROMPT;
  const baseSchema = stableValue(
    input.schemaJson ?? z.toJSONSchema(memoryExtractionResultSchema),
  );
  const buildArm = (
    arm: PreferenceIdentityKeyMode,
  ): PreferenceIdentityEffectivePromptArmIdentity => {
    const schema = stableValue({
      canonicalExtractionSchema: baseSchema,
      requiredExperimentalAttribute: arm === "open-key"
        ? "experimentalOpenPreferenceKey"
        : "experimentalClosedPreferenceKey",
    });
    const customPrompts = input.calls
      .filter(({ arm: callArm }) => callArm === arm)
      .map(({ callId, text }) => ({
        callId,
        prompt: arm === "open-key"
          ? promptBuilder({ arm, text })
          : promptBuilder({
            arm,
            closedVocabulary: input.preregistration.closedVocabulary,
            text,
          }),
      }));
    return {
      customPromptSource: `buildPreferenceIdentityPrompt:${arm}:360-call-plan`,
      customPromptsSha256: fingerprint(customPrompts),
      outputProtocol: "canonical-v1",
      responseFormat: "json_object",
      schemaSha256: fingerprint(schema),
      schemaSource: `memoryExtractionResultSchema+${arm}-attribute`,
      system,
      systemSha256: fingerprint(system),
    };
  };
  const arms = {
    closedKey: buildArm("closed-key"),
    openKey: buildArm("open-key"),
  };
  return {
    aggregateSha256: fingerprint(arms),
    arms,
    customPromptsSha256: fingerprint({
      closedKey: arms.closedKey.customPromptsSha256,
      openKey: arms.openKey.customPromptsSha256,
    }),
  };
}

export function assertPreferenceIdentityProviderAttemptCount(input: {
  actual: number;
  planned: number;
}): void {
  if (input.actual !== input.planned) {
    throw new Error(
      `Preference identity protocol expected exactly ${input.planned} provider attempts; received ${input.actual}.`,
    );
  }
}

export function buildPreferenceIdentityCallPlan(input: {
  manifest: PreferenceIdentityManifest;
  protectionCohort: PreferenceIdentityProtectionCohort;
  repetitions: number;
}): PreferenceIdentityCallPlanRow[] {
  if (input.repetitions !== 2) {
    throw new Error("Preference identity v1 requires exactly two repetitions.");
  }
  validateProtectionCohort(input);
  const protectedVariantIds = new Set(input.protectionCohort.variantIds);
  const calls: PreferenceIdentityCallPlanRow[] = [];
  for (const arm of ["open-key", "closed-key"] as const) {
    for (const group of input.manifest.groups) {
      for (const variant of group.variants) {
        for (const repetition of [1, 2] as const) {
          const call = {
            arm,
            cohort: protectedVariantIds.has(variant.variantId)
              ? "protection" as const
              : "development" as const,
            context: variant.context,
            expectedAtoms: group.expectedAtoms,
            groupId: group.groupId,
            groupKind: group.kind,
            locale: variant.locale,
            repetition,
            text: variant.text,
            variantId: variant.variantId,
          };
          calls.push({
            ...call,
            callId: `${arm}:${variant.variantId}:r${repetition}`,
            inputFingerprint: fingerprintPreferenceIdentityCallInput(call),
          });
        }
      }
    }
  }
  return calls;
}

export async function runPreferenceIdentityRulesOnlyBaseline(input: {
  manifest: PreferenceIdentityManifest;
  protectionCohort: PreferenceIdentityProtectionCohort;
}): Promise<PreferenceIdentityRulesOnlyBaseline> {
  validateProtectionCohort(input);
  const extractor = createDeterministicMemoryExtractor();
  const rows: PreferenceIdentityRulesOnlyBaseline["rows"] = [];
  const categoryDistribution: Record<string, number> = {};
  const protectedVariantIds = new Set(input.protectionCohort.variantIds);
  for (const group of input.manifest.groups) {
    for (const variant of group.variants) {
      const extraction = await extractor.extract({
        extractionStrategy: "rules-only",
        locale: variant.locale,
        messages: [{ content: variant.text, role: "user" }],
        scope: { userId: `preference-rules-${variant.variantId}` },
      });
      const candidates = extraction.candidates.flatMap((candidate) => {
        if (candidate.kindHint !== "preference") {
          return [];
        }
        const category = candidate.metadata?.preferenceCategory ??
          "general_preference";
        const closedKey =
          candidate.metadata?.attributes?.experimentalClosedPreferenceKey;
        categoryDistribution[category] =
          (categoryDistribution[category] ?? 0) + 1;
        return [{
          category,
          context: candidate.metadata?.appliesTo ?? null,
          slot: typeof closedKey === "string" ? closedKey : null,
          value: candidate.metadata?.preferenceValue ?? candidate.content,
        }];
      });
      rows.push({
        candidates,
        cohort: protectedVariantIds.has(variant.variantId)
          ? "protection"
          : "development",
        context: variant.context,
        expectedAtoms: group.expectedAtoms,
        groupId: group.groupId,
        groupKind: group.kind,
        variantId: variant.variantId,
      });
    }
  }
  return {
    rows,
    summary: {
      analyzerManifest: createLanguageService().getAnalyzerManifest(),
      categoryDistribution,
      development: summarizeRulesOnlyRows(
        rows.filter(({ cohort }) => cohort === "development"),
      ),
      overall: summarizeRulesOnlyRows(rows),
      protection: summarizeRulesOnlyRows(
        rows.filter(({ cohort }) => cohort === "protection"),
      ),
      rowFingerprint: fingerprint(rows),
    },
  };
}

function summarizeRulesOnlyRows(
  rows: PreferenceIdentityRulesOnlyBaseline["rows"],
): PreferenceIdentityRulesOnlyMetrics {
  const countMatches = (
    selectedRows: PreferenceIdentityRulesOnlyBaseline["rows"],
  ): number => selectedRows.reduce((total, row) => {
    const matchedCandidateIndexes = new Set<number>();
    for (const atom of row.expectedAtoms) {
      const candidateIndex = row.candidates.findIndex(
        (candidate, index) =>
          !matchedCandidateIndexes.has(index) &&
          candidate.slot !== null &&
          candidate.context !== null &&
          candidate.slot === atom.slot &&
          normalizeValue(candidate.value).toLowerCase() ===
            normalizeValue(atom.value).toLowerCase() &&
          normalizeContext(candidate.context) === normalizeContext(row.context),
      );
      if (candidateIndex >= 0) {
        matchedCandidateIndexes.add(candidateIndex);
      }
    }
    return total + matchedCandidateIndexes.size;
  }, 0);
  const expectedAtomCount = rows.reduce(
    (count, row) => count + row.expectedAtoms.length,
    0,
  );
  const actualAtomCount = rows.reduce(
    (count, row) => count + row.candidates.length,
    0,
  );
  const matchedAtomCount = countMatches(rows);
  const compoundRows = rows.filter(({ groupKind }) => groupKind === "compound");
  const compoundExpected = compoundRows.reduce(
    (count, row) => count + row.expectedAtoms.length,
    0,
  );
  const compoundActual = compoundRows.reduce(
    (count, row) => count + row.candidates.length,
    0,
  );
  const compoundMatched = countMatches(compoundRows);
  return {
    atomicizationPrecision: ratio(matchedAtomCount, actualAtomCount),
    atomicizationRecall: ratio(matchedAtomCount, expectedAtomCount),
    compoundAtomicizationPrecision: ratio(compoundMatched, compoundActual),
    compoundAtomicizationRecall: ratio(compoundMatched, compoundExpected),
    preferenceCandidateCount: actualAtomCount,
    preferenceCaptureRate: ratio(
      rows.filter(({ candidates }) => candidates.length > 0).length,
      rows.length,
    ),
    variantCount: rows.length,
  };
}

function candidateSignature(
  candidates: readonly PreferenceIdentityCandidateResult[],
): string {
  return candidates
    .map((candidate) =>
      JSON.stringify([
        candidate.key,
        normalizeContext(candidate.context),
        normalizeValue(candidate.value).toLowerCase(),
      ])
    )
    .sort()
    .join("\n");
}

function expectedClosedKey(
  slot: string,
  preregistration: PreferenceIdentityPreregistration,
): string {
  return preregistration.closedVocabulary.includes(slot)
    ? slot
    : "other";
}

function candidateMatchesExpectedAtom(input: {
  atom: { slot: string; value: string };
  candidate: PreferenceIdentityCandidateResult;
  expectedContext: string;
  keyMode: PreferenceIdentityKeyMode;
  preregistration: PreferenceIdentityPreregistration;
}): boolean {
  const expectedKey = input.keyMode === "open-key"
    ? input.atom.slot
    : expectedClosedKey(input.atom.slot, input.preregistration);
  return candidateKey(input.candidate) === expectedKey &&
    normalizeValue(input.candidate.value).toLowerCase() ===
      normalizeValue(input.atom.value).toLowerCase() &&
    normalizeContext(input.candidate.context) ===
      normalizeContext(input.expectedContext);
}

function matchExpectedAtoms(input: {
  candidates: readonly PreferenceIdentityCandidateResult[];
  expectedContext: string;
  expectedAtoms: ReadonlyArray<{ slot: string; value: string }>;
  keyMode: PreferenceIdentityKeyMode;
  preregistration: PreferenceIdentityPreregistration;
}): {
  matchedCandidateIndexes: Set<number>;
  matchedCount: number;
} {
  const matchedCandidateIndexes = new Set<number>();
  let matchedCount = 0;
  for (const atom of input.expectedAtoms) {
    const candidateIndex = input.candidates.findIndex(
      (candidate, index) =>
        !matchedCandidateIndexes.has(index) &&
        candidateMatchesExpectedAtom({
          atom,
          candidate,
          expectedContext: input.expectedContext,
          keyMode: input.keyMode,
          preregistration: input.preregistration,
        }),
    );
    if (candidateIndex >= 0) {
      matchedCandidateIndexes.add(candidateIndex);
      matchedCount += 1;
    }
  }
  return { matchedCandidateIndexes, matchedCount };
}

function candidateKey(
  candidate: PreferenceIdentityCandidateResult,
): string {
  return candidate.key;
}

function countUnintendedCrossDimensionCollisions(
  rows: readonly PreferenceIdentityExperimentRow[],
  keyMode: PreferenceIdentityKeyMode,
  manifest: PreferenceIdentityManifest,
): number {
  const slotsByValue = new Map<string, Set<string>>();
  for (const { expectedAtoms } of manifest.groups) {
    for (const atom of expectedAtoms) {
      const value = normalizeValue(atom.value).toLowerCase();
      const slots = slotsByValue.get(value) ?? new Set<string>();
      slots.add(atom.slot);
      slotsByValue.set(value, slots);
    }
  }
  const slotsByKey = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.executionStatus !== "succeeded") {
      continue;
    }
    for (const candidate of row.candidates) {
      const semanticSlots = slotsByValue.get(
        normalizeValue(candidate.value).toLowerCase(),
      );
      if (semanticSlots === undefined) {
        continue;
      }
      const key = candidateKey(candidate);
      if (keyMode === "closed-key" && key === "other") {
        continue;
      }
      const observedSlots = slotsByKey.get(key) ?? new Set<string>();
      for (const slot of semanticSlots) {
        observedSlots.add(slot);
      }
      slotsByKey.set(key, observedSlots);
    }
  }
  return [...slotsByKey.values()].filter((slots) => slots.size > 1).length;
}

function summarizePreferenceIdentityKeyMode(input: {
  keyMode: PreferenceIdentityKeyMode;
  manifest: PreferenceIdentityManifest;
  preregistration: PreferenceIdentityPreregistration;
  rows: PreferenceIdentityExperimentRow[];
}): PreferenceIdentityMetricSummary {
  const expectedAtomsByGroup = new Map(
    input.manifest.groups.map(({ expectedAtoms, groupId }) => [
      groupId,
      expectedAtoms,
    ]),
  );
  const rows = input.rows.map((row) => ({
    ...row,
    expectedAtoms: expectedAtomsByGroup.get(row.groupId) ?? [],
  }));
  const closedVocabulary = new Set(
    input.preregistration.closedVocabulary,
  );
  const succeeded = rows.filter(
    ({ executionStatus }) => executionStatus === "succeeded",
  );
  const expectedAtomCount = rows.reduce(
    (count, row) => count + row.expectedAtoms.length,
    0,
  );
  const actualAtomCount = succeeded.reduce(
    (count, row) => count + row.candidates.length,
    0,
  );
  const matchedAtomCount = succeeded.reduce((count, row) =>
    count + matchExpectedAtoms({
      candidates: row.candidates,
      expectedContext: row.context,
      expectedAtoms: row.expectedAtoms,
      keyMode: input.keyMode,
      preregistration: input.preregistration,
    }).matchedCount, 0);
  const candidateContexts = succeeded.flatMap((row) =>
    row.candidates.map((candidate) => ({
      actual: normalizeContext(candidate.context),
      expected: row.context,
    }))
  );
  const contextMatches = candidateContexts.filter(
    ({ actual, expected }) => actual === expected,
  ).length;

  const repeatGroups = new Map<string, PreferenceIdentityExperimentRow[]>();
  for (const row of rows) {
    const pair = repeatGroups.get(row.variantId) ?? [];
    pair.push(row);
    repeatGroups.set(row.variantId, pair);
  }
  const completeRepeatPairs = [...repeatGroups.values()].filter(
    (rows) =>
      rows.length === 2 &&
      rows.every(({ executionStatus }) => executionStatus === "succeeded"),
  );
  const repeatMatches = completeRepeatPairs.filter(
    ([left, right]) =>
      candidateSignature(left!.candidates) ===
        candidateSignature(right!.candidates),
  ).length;

  const compoundRows = succeeded.filter(
    ({ groupKind }) => groupKind === "compound",
  );
  const compoundExpectedAtomCount = rows
    .filter(({ groupKind }) => groupKind === "compound")
    .reduce((count, row) => count + row.expectedAtoms.length, 0);
  const compoundActualAtomCount = compoundRows.reduce(
    (count, row) => count + row.candidates.length,
    0,
  );
  const compoundMatchedAtomCount = compoundRows.reduce((count, row) =>
    count + matchExpectedAtoms({
      candidates: row.candidates,
      expectedContext: row.context,
      expectedAtoms: row.expectedAtoms,
      keyMode: input.keyMode,
      preregistration: input.preregistration,
    }).matchedCount, 0);
  const exactKeySetMatches = succeeded.filter((row) => {
    const expected = row.expectedAtoms
      .map(({ slot }) => {
        if (input.keyMode === "closed-key") {
          return expectedClosedKey(slot, input.preregistration);
        }
        return slot;
      })
      .sort();
    const actual = row.candidates
      .map((candidate) => candidateKey(candidate))
      .sort();
    return JSON.stringify(expected) === JSON.stringify(actual);
  }).length;
  const invalidClosedKeyCount = input.keyMode === "closed-key"
    ? succeeded.reduce(
      (count, row) =>
        count + row.candidates.filter(
          ({ key }) => !closedVocabulary.has(key),
        ).length,
      0,
    )
    : 0;
  const parseOrMissingKeyCount = rows.reduce(
    (count, row) =>
      count + (row.parseFailureCount ?? 0) + (row.missingKeyCount ?? 0),
    0,
  ) + invalidClosedKeyCount;
  const otherCandidates = succeeded.flatMap((row) =>
    row.candidates.flatMap((candidate) =>
      candidateKey(candidate) === "other"
        ? [{ candidate, row }]
        : []
    )
  );
  const otherContexts: Record<string, number> = {};
  for (const { candidate } of otherCandidates) {
    const context = normalizeContext(candidate.context);
    otherContexts[context] = (otherContexts[context] ?? 0) + 1;
  }

  const metrics: PreferenceIdentityMetrics = {
    atomicizationPrecision: ratio(matchedAtomCount, actualAtomCount),
    atomicizationRecall: ratio(matchedAtomCount, expectedAtomCount),
    compoundAtomicizationPrecision: ratio(
      compoundMatchedAtomCount,
      compoundActualAtomCount,
    ),
    compoundAtomicizationRecall: ratio(
      compoundMatchedAtomCount,
      compoundExpectedAtomCount,
    ),
    contextAgreement: ratio(contextMatches, candidateContexts.length),
    executionFailureCount:
      rows.length - succeeded.length,
    paraphraseExactKeySetAgreement: ratio(
      exactKeySetMatches,
      rows.length,
    ),
    parseOrMissingKeyCount,
    preferenceCaptureRate: ratio(
      succeeded.filter(({ candidates }) => candidates.length > 0).length,
      input.rows.length,
    ),
    repeatConsistency: ratio(repeatMatches, repeatGroups.size),
    unintendedCrossDimensionCollisionCount:
      countUnintendedCrossDimensionCollisions(
        rows,
        input.keyMode,
        input.manifest,
      ),
  };

  return {
    metrics,
    otherDistribution: {
      candidateCount: otherCandidates.length,
      contexts: otherContexts,
      groupIds: [...new Set(otherCandidates.map(({ row }) => row.groupId))]
        .sort(),
      rate: ratio(otherCandidates.length, actualAtomCount),
    },
  };
}

function applyPreferenceIdentityGates(input: {
  preregistration: PreferenceIdentityPreregistration;
  summary: PreferenceIdentityMetricSummary;
}): PreferenceIdentityDecisionSummary {
  const failedGates = Object.entries(input.preregistration.gates).flatMap(
    ([name, threshold]) => {
      const value = input.summary.metrics[
        name as keyof PreferenceIdentityMetrics
      ];
      if ("min" in threshold) {
        return value < threshold.min ? [name] : [];
      }
      return value > threshold.max ? [name] : [];
    },
  );
  return {
    ...input.summary,
    decision: failedGates.length === 0 ? "accepted" : "blocked",
    failedGates,
  };
}

export function summarizePreferenceIdentityRows(input: {
  manifest: PreferenceIdentityManifest;
  preregistration: PreferenceIdentityPreregistration;
  rows: PreferenceIdentityExperimentRow[];
}): PreferenceIdentityComparisonSummary {
  const summarizeScope = (rows: PreferenceIdentityExperimentRow[]) => ({
    closedKey: summarizePreferenceIdentityKeyMode({
      ...input,
      keyMode: "closed-key" as const,
      rows: rows.filter(({ arm }) => arm === "closed-key"),
    }),
    openKey: summarizePreferenceIdentityKeyMode({
      ...input,
      keyMode: "open-key" as const,
      rows: rows.filter(({ arm }) => arm === "open-key"),
    }),
  });
  const development = summarizeScope(
    input.rows.filter(({ cohort }) => cohort === "development"),
  );
  const overall = summarizeScope(input.rows);
  const protectionMetrics = summarizeScope(
    input.rows.filter(({ cohort }) => cohort === "protection"),
  );
  const protection = {
    closedKey: applyPreferenceIdentityGates({
      preregistration: input.preregistration,
      summary: protectionMetrics.closedKey,
    }),
    openKey: applyPreferenceIdentityGates({
      preregistration: input.preregistration,
      summary: protectionMetrics.openKey,
    }),
  };
  return {
    decisionBasis: "protection",
    development,
    overall,
    protection,
    recommendation: protection.openKey.decision === "accepted"
      ? "open-key"
      : protection.closedKey.decision === "accepted"
      ? "closed-key"
      : "no-api",
  };
}

export function buildPreferenceIdentityFingerprintArtifact(
  rows: readonly PreferenceIdentityExperimentRow[],
): PreferenceIdentityFingerprintArtifact {
  const inputPlan = buildPreferenceIdentityInputPlanIdentity(rows);
  const compactRows = rows.map(({ arm, callId, rawFingerprint }) => ({
    arm,
    callId,
    rawFingerprint,
  }));
  return {
    aggregateSha256: fingerprint(compactRows),
    count: compactRows.length,
    inputAggregateSha256: inputPlan.aggregateSha256,
    inputCount: inputPlan.count,
    rows: compactRows,
  };
}

function buildPreferenceIdentityRawResultRecord(
  row: PreferenceIdentityExperimentRow,
): PreferenceIdentityRawResultRecord {
  if (row.rawPayload === undefined) {
    throw new Error(`Missing raw payload for ${row.callId}.`);
  }
  const rawPayload = stableValue(row.rawPayload);
  const rawFingerprint = fingerprintPreferenceIdentityRawPayload(rawPayload);
  if (rawFingerprint !== row.rawFingerprint) {
    throw new Error(`Raw payload fingerprint mismatch for ${row.callId}.`);
  }
  return {
    arm: row.arm,
    callId: row.callId,
    executionStatus: row.executionStatus,
    missingKeyCount: row.missingKeyCount ?? 0,
    parseFailureCount: row.parseFailureCount ?? 0,
    rawOutputAvailable: row.rawOutputAvailable,
    rawFingerprint,
    rawPayload,
  };
}

export async function writePreferenceIdentityRawCall(input: {
  row: PreferenceIdentityExperimentRow;
  runDirectory: string;
}): Promise<{ relativePath: string }> {
  const safeCallId = input.row.callId.replace(/[^a-zA-Z0-9._-]/gu, "_");
  const relativePath = join(
    RAW_CALLS_DIRECTORY,
    `${safeCallId}-${sha256(input.row.callId).slice(0, 12)}.json`,
  );
  const record = buildPreferenceIdentityRawResultRecord(input.row);
  await writeFile(
    join(input.runDirectory, relativePath),
    `${JSON.stringify(record, null, 2)}\n`,
    { flag: "wx" },
  );
  return { relativePath };
}

export async function writePreferenceIdentityRawResults(input: {
  outputPath: string;
  rows: readonly PreferenceIdentityExperimentRow[];
}): Promise<{ count: number }> {
  const records = input.rows.map(buildPreferenceIdentityRawResultRecord);
  await writeFile(
    input.outputPath,
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
    { flag: "wx" },
  );
  return { count: records.length };
}

export async function reservePreferenceIdentityRunDirectory(
  runDirectory: string,
): Promise<void> {
  await mkdir(dirname(runDirectory), { recursive: true });
  await mkdir(runDirectory);
  await mkdir(join(runDirectory, RAW_CALLS_DIRECTORY));
}

export function buildPreferenceIdentityCostDisclosure(): {
  estimatedUsd: null;
  providerBilledUsd: null;
  reason: string;
} {
  return {
    estimatedUsd: null,
    providerBilledUsd: null,
    reason:
      "No frozen verifiable gpt-5.6-terra/Gurki tariff is registered; token usage is reported without inventing a price.",
  };
}

export function buildPreferenceIdentityPrompt(input:
  | { arm: "closed-key"; closedVocabulary: readonly string[]; text: string }
  | { arm: "open-key"; text: string }
): string {
  const keyInstruction = input.arm === "open-key"
    ? "For every candidate, emit experimentalOpenPreferenceKey as a stable lowercase dot-separated conflict-slot key. It names the dimension, never its value or context; paraphrases and opposite values in one dimension must use the same key."
    : `For every candidate, emit experimentalClosedPreferenceKey as exactly one of: ${input.closedVocabulary.join(", ")}. Use other only when no named key fits.`;
  const attributeInstruction = input.arm === "open-key"
    ? "Put experimentalOpenPreferenceKey in metadata.attributes."
    : "Put experimentalClosedPreferenceKey in metadata.attributes.";
  return [
    "Extract only explicit durable user preferences from the single user message.",
    "Split compound preferences into one candidate per independent preference atom.",
    keyInstruction,
    "Set preferenceValue to the explicit preference value stated by the user without inventing a value.",
    "Set kindHint=preference, explicitness=explicit, sourceMessageIndex=0, sourceRole=user.",
    `Set metadata.appliesTo to exactly general, work, or personal_study. ${attributeInstruction}`,
    "Return the canonical extraction JSON object with candidates and ignoredMessageCount. Do not add commentary.",
    `User message: ${JSON.stringify(input.text)}`,
  ].join("\n");
}

function extractPreferenceIdentityJsonObject(text: string): string {
  const normalized = stripThinkingBlocks(text);
  const start = normalized.indexOf("{");
  const end = normalized.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      "Preference identity raw completion did not contain a JSON object.",
    );
  }
  return normalized.slice(start, end + 1);
}

export function parsePreferenceIdentityRawCompletion(input: {
  arm: PreferenceIdentityKeyMode;
  text: string;
}): MemoryExtractionResult {
  let payload: unknown;
  try {
    payload = JSON.parse(extractPreferenceIdentityJsonObject(input.text));
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("did not contain a JSON object")
    ) {
      throw error;
    }
    throw new Error(
      `Preference identity raw completion was not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const parsed = memoryExtractionResultSchema.safeParse(
    normalizeMemoryExtractionPayload(payload),
  );
  if (!parsed.success) {
    throw new Error(
      `Preference identity raw completion schema validation failed: ${
        parsed.error.issues[0]?.message ?? "invalid value"
      }`,
    );
  }
  const oppositeAttribute = input.arm === "open-key"
    ? "experimentalClosedPreferenceKey"
    : "experimentalOpenPreferenceKey";
  if (
    parsed.data.candidates.some((candidate) =>
      candidate.metadata?.attributes?.[oppositeAttribute] !== undefined
    )
  ) {
    throw new Error(
      `Preference identity ${input.arm} raw completion exposed opposite-arm key ${oppositeAttribute}.`,
    );
  }
  return parsed.data;
}

function mapProviderResult(
  result: MemoryExtractionResult,
  arm: PreferenceIdentityKeyMode,
): {
  candidates: PreferenceIdentityCandidateResult[];
  missingKeyCount: number;
} {
  let missingKeyCount = 0;
  const attribute = arm === "open-key"
    ? "experimentalOpenPreferenceKey"
    : "experimentalClosedPreferenceKey";
  const candidates = result.candidates.flatMap((candidate) => {
    if (candidate.kindHint !== "preference") {
      return [];
    }
    const key = candidate.metadata?.attributes?.[attribute];
    if (typeof key !== "string" || key.trim().length === 0) {
      missingKeyCount += 1;
      return [];
    }
    return [{
      context: candidate.metadata?.appliesTo ?? "",
      key,
      value: candidate.metadata?.preferenceValue ?? candidate.content,
    }];
  });
  return { candidates, missingKeyCount };
}

async function mapWithConcurrency<TInput, TOutput>(input: {
  concurrency: number;
  items: readonly TInput[];
  run: (item: TInput) => Promise<TOutput>;
}): Promise<TOutput[]> {
  const results = new Array<TOutput>(input.items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(input.concurrency, input.items.length) },
    async () => {
      while (nextIndex < input.items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await input.run(input.items[index]!);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

export function parsePreferenceIdentityCliOptions(
  argv: readonly string[],
): PreferenceIdentityCliOptions {
  if (argv.some((value) => value === "--arm" || value.startsWith("--arm="))) {
    throw new Error(
      "--arm is not supported: the frozen protocol executes both complete independent arms.",
    );
  }
  return {
    live: hasCliFlagStrict(argv, "--live"),
    maxConcurrency:
      parseCliPositiveIntegerFlagStrict(argv, "--max-concurrency") ?? 4,
    outputDir: resolveCliFlagValueStrict(argv, "--output-dir"),
    runId: resolveCliPathSegmentFlagValueStrict(argv, "--run-id"),
  };
}

export async function runPreferenceIdentityCli(
  options: PreferenceIdentityCliOptions,
): Promise<unknown> {
  const repoRoot = resolveRepoRootFromScriptUrl(import.meta.url);
  const manifestRaw = await readFile(join(repoRoot, MANIFEST_PATH), "utf8");
  const preregistrationRaw = await readFile(
    join(repoRoot, PREREGISTRATION_PATH),
    "utf8",
  );
  const protectionRaw = await readFile(
    join(repoRoot, PROTECTION_COHORT_PATH),
    "utf8",
  );
  const manifest = manifestSchema.parse(JSON.parse(manifestRaw));
  const preregistration = preregistrationSchema.parse(
    JSON.parse(preregistrationRaw),
  );
  const protectionCohort = protectionCohortSchema.parse(
    JSON.parse(protectionRaw),
  );
  if (sha256(manifestRaw) !== preregistration.manifest.sha256) {
    throw new Error("Preference identity manifest fingerprint does not match preregistration.");
  }
  if (sha256(protectionRaw) !== preregistration.protectionCohort.sha256) {
    throw new Error(
      "Preference identity protection cohort fingerprint does not match preregistration.",
    );
  }
  validateProtectionCohort({ manifest, protectionCohort });
  const calls = buildPreferenceIdentityCallPlan({
    manifest,
    protectionCohort,
    repetitions: preregistration.repetitions,
  });
  const inputPlan = buildPreferenceIdentityInputPlanIdentity(calls);
  if (
    inputPlan.count !== preregistration.inputPlan.callCount ||
    inputPlan.aggregateSha256 !== preregistration.inputPlan.aggregateSha256
  ) {
    throw new Error(
      "Preference identity input plan does not match preregistration.",
    );
  }
  const effectivePrompt = buildPreferenceIdentityEffectivePromptIdentity({
    calls,
    preregistration,
  });
  if (
    JSON.stringify(effectivePrompt) !==
      JSON.stringify(preregistration.effectivePrompt)
  ) {
    throw new Error(
      "Preference identity effective prompt does not match preregistration.",
    );
  }
  const promptSha256 = effectivePrompt.customPromptsSha256;
  const git = await resolveGitProvenance(repoRoot);
  const rulesOnlyBaseline = await runPreferenceIdentityRulesOnlyBaseline({
    manifest,
    protectionCohort,
  });
  if (!options.live) {
    return {
      comparisonMode: preregistration.comparisonMode,
      git,
      liveRunPending: true,
      manifestSha256: sha256(manifestRaw),
      effectivePrompt,
      inputPlan,
      plannedCalls: calls.length,
      plannedProviderAttempts: preregistration.plannedProviderAttempts,
      preregistrationSha256: sha256(preregistrationRaw),
      promptSha256,
      protectionCohort: {
        developmentCalls: calls.filter(({ cohort }) => cohort === "development")
          .length,
        protectionCalls: calls.filter(({ cohort }) => cohort === "protection")
          .length,
        sha256: sha256(protectionRaw),
      },
      rulesOnlyBaseline: rulesOnlyBaseline.summary,
    };
  }

  if (git.dirty) {
    throw new Error(
      "Preference identity live protocol requires a clean independent research commit.",
    );
  }
  if (options.outputDir !== undefined) {
    throw new Error(
      "Preference identity live protocol writes only to its preregistered fixed run path.",
    );
  }
  const runId = options.runId ?? preregistration.outputEvidence.fixedRunId;
  if (runId !== preregistration.outputEvidence.fixedRunId) {
    throw new Error(
      `Preference identity live protocol requires --run-id ${preregistration.outputEvidence.fixedRunId}.`,
    );
  }

  const model = resolveProviderBackedModelConfig(
    "GOODMEMORY_ASSISTED_EXTRACTOR",
  );
  if (model.model !== preregistration.model.expectedModel) {
    throw new Error(
      `Preference identity v1 requires ${preregistration.model.expectedModel}; received ${model.model}.`,
    );
  }
  if (
    model.provider !== preregistration.model.expectedProvider ||
    !model.baseURL
  ) {
    throw new Error(
      "Preference identity live protocol requires the pinned OpenAI-compatible provider and base URL.",
    );
  }
  const runDirectory = join(
    repoRoot,
    preregistration.outputEvidence.fixedRunPath,
  );
  await reservePreferenceIdentityRunDirectory(runDirectory);
  const modelUsageAttempts: ModelUsageAttempt[] = [];
  const modelUsageSink = {
    emit(event: ModelUsageAttempt) {
      modelUsageAttempts.push(event);
    },
  };
  const rows = await mapWithConcurrency({
    concurrency: options.maxConcurrency,
    items: calls,
    run: async (call): Promise<PreferenceIdentityExperimentRow> => {
      let rawCompletionText: string | undefined;
      let row: PreferenceIdentityExperimentRow;
      try {
        const rawExtraction = await runWithModelUsageAttempt({
          attempt: 1,
          modelId: model.model,
          operation: "assisted_extraction",
          providerId: model.provider,
          sink: modelUsageSink,
          run: async (reportUsage) => {
            const response = await requestOpenAICompatibleTextResult({
              model,
              prompt: call.arm === "open-key"
                ? buildPreferenceIdentityPrompt({
                  arm: call.arm,
                  text: call.text,
                })
                : buildPreferenceIdentityPrompt({
                  arm: call.arm,
                  closedVocabulary: preregistration.closedVocabulary,
                  text: call.text,
                }),
              responseFormat: { type: "json_object" },
              system: call.arm === "open-key"
                ? effectivePrompt.arms.openKey.system
                : effectivePrompt.arms.closedKey.system,
              temperature: preregistration.model.temperature,
            });
            rawCompletionText = response.text;
            reportUsage(
              response.usage ?? normalizeAISDKLanguageModelUsage(undefined),
            );
            return parsePreferenceIdentityRawCompletion({
              arm: call.arm,
              text: response.text,
            });
          },
        });
        const mapped = mapProviderResult(rawExtraction, call.arm);
        const rawPayload = rawCompletionText!;
        row = {
          ...call,
          candidates: mapped.candidates,
          executionStatus: "succeeded",
          missingKeyCount: mapped.missingKeyCount,
          parseFailureCount: 0,
          rawOutputAvailable: true,
          rawFingerprint: fingerprintPreferenceIdentityRawPayload(rawPayload),
          rawPayload,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const rawOutputAvailable = rawCompletionText !== undefined;
        const rawPayload = rawCompletionText ?? {
          errorName: error instanceof Error ? error.name : "UnknownError",
          status: "transport-failed",
        };
        row = {
          ...call,
          candidates: [],
          error: message,
          executionStatus: "failed",
          missingKeyCount: 0,
          parseFailureCount: rawOutputAvailable ? 1 : 0,
          rawOutputAvailable,
          rawFingerprint: fingerprintPreferenceIdentityRawPayload(rawPayload),
          rawPayload,
        };
      }
      await writePreferenceIdentityRawCall({ row, runDirectory });
      return row;
    },
  });
  assertPreferenceIdentityProviderAttemptCount({
    actual: modelUsageAttempts.length,
    planned: preregistration.plannedProviderAttempts,
  });
  const summary = summarizePreferenceIdentityRows({
    manifest,
    preregistration,
    rows,
  });
  const generatedAt = new Date().toISOString();
  const rawFingerprints = buildPreferenceIdentityFingerprintArtifact(rows);
  const executionFailureCount = rows.filter(
    ({ executionStatus }) => executionStatus === "failed",
  ).length;
  const report = {
    calls: {
      executed: rows.length,
      failed: executionFailureCount,
      planned: calls.length,
      providerAttempts: modelUsageAttempts.length,
      succeeded: rows.length - executionFailureCount,
    },
    comparisonMode: preregistration.comparisonMode,
    cost: buildPreferenceIdentityCostDisclosure(),
    generatedAt,
    git,
    effectivePromptSha256: effectivePrompt.aggregateSha256,
    inputFingerprints: {
      aggregateSha256: inputPlan.aggregateSha256,
      count: inputPlan.count,
    },
    manifestSha256: sha256(manifestRaw),
    model: {
      gateway: model.baseURL ?? null,
      model: model.model,
      provider: model.provider,
      retryLimit: preregistration.model.retryLimit,
      role: preregistration.model.role,
      temperature: preregistration.model.temperature,
    },
    preregistrationSha256: sha256(preregistrationRaw),
    promptSha256,
    protectionCohortSha256: sha256(protectionRaw),
    protocolId: preregistration.protocolId,
    rawFingerprints: {
      aggregateSha256: rawFingerprints.aggregateSha256,
      count: rawFingerprints.count,
      inputAggregateSha256: rawFingerprints.inputAggregateSha256,
      inputCount: rawFingerprints.inputCount,
    },
    rawPersistence: {
      finalJsonl: preregistration.outputEvidence.untrackedRawPayload,
      perCallDirectory:
        preregistration.outputEvidence.untrackedPerCallRawDirectory,
      perCallFileCount: rows.length,
      perCallWriteMode: preregistration.outputEvidence.perCallRawPersistence,
    },
    rulesOnlyBaseline: rulesOnlyBaseline.summary,
    runId,
    summaries: summary,
    tokenUsage: summarizeModelUsage(modelUsageAttempts),
  };
  await writePreferenceIdentityRawResults({
    outputPath: join(runDirectory, "raw-results.jsonl"),
    rows,
  });
  await writeFile(
    join(runDirectory, "raw-fingerprints.json"),
    `${JSON.stringify(rawFingerprints, null, 2)}\n`,
    { flag: "wx" },
  );
  await writeFile(
    join(runDirectory, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    { flag: "wx" },
  );
  return report;
}

if (import.meta.main) {
  const result = await runPreferenceIdentityCli(
    parsePreferenceIdentityCliOptions(process.argv),
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
