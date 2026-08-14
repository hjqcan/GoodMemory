import type { FeedbackKind, FeedbackMemory } from "../domain/records";
import {
  buildFeedbackIdentityKey,
  createFeedbackMemory,
  normalizeFeedbackAppliesTo,
} from "../domain/records";
import { createMemorySource } from "../domain/provenance";
import { hasPersistableSemanticText } from "../domain/semanticText";
import type { LanguageService } from "../language";
import type { GovernanceRepositoryPort } from "../storage/ports";
import type {
  FeedbackInput,
  FeedbackResult,
} from "./contracts";
import type {
  AgentEventCorrectionResult,
  AgentEventPromotionReceipt,
  AgentEventProposalReceipt,
} from "./integrationSupport";

interface EvolutionFeedbackRuntime {
  handleFeedback(input: {
    result: FeedbackResult;
    scope: FeedbackInput["scope"];
    strict?: boolean;
    traceId?: string;
  }): Promise<FeedbackReceipts>;
}

interface EvolutionCorrectionRuntime {
  handleAgentCorrection(input: {
    appliesTo: string;
    evidenceIds?: string[];
    kind: Exclude<FeedbackKind, "validated_pattern">;
    scope: FeedbackInput["scope"];
    signal: string;
    strict?: boolean;
    traceId?: string;
  }): Promise<FeedbackReceipts>;
}

interface FeedbackReceipts {
  promotionReceipts: AgentEventPromotionReceipt[];
  proposalReceipts: AgentEventProposalReceipt[];
}

function resolveFeedbackSignalMetadata(input: {
  appliesTo?: string;
  language: LanguageService;
  locale?: string;
  signal: string;
}) {
  const resolvedLanguage = input.language.resolveFromText({
    locale: input.locale,
    text: input.signal,
  });
  const derivedKind = input.language.deriveFeedbackKind(
    input.signal,
    resolvedLanguage,
  );
  const kind: Exclude<FeedbackKind, "validated_pattern"> =
    derivedKind === "validated_pattern" ? "do" : derivedKind;
  const normalizedRule = input.language.normalizeForEquality(
    input.signal,
    resolvedLanguage,
  );

  return {
    appliesTo: normalizeFeedbackAppliesTo(input.appliesTo),
    kind,
    normalizedRule,
    resolvedLanguage,
  };
}

async function resolveFeedbackSignalState(input: {
  appliesTo?: string;
  feedbackRepository: GovernanceRepositoryPort["feedback"];
  language: LanguageService;
  locale?: string;
  scope: FeedbackInput["scope"];
  signal: string;
}) {
  const metadata = resolveFeedbackSignalMetadata(input);
  const existing = await input.feedbackRepository.listByScope(input.scope);
  const nextIdentityKey = buildFeedbackIdentityKey(metadata);
  const duplicate = existing.find((record) => {
    const recordLanguage = input.language.resolveFromText({
      locale: record.source.locale,
      text: record.rule,
    });
    return record.lifecycle === "active" &&
      buildFeedbackIdentityKey({
        kind: record.kind,
        normalizedRule: input.language.normalizeForEquality(
          record.rule,
          recordLanguage,
        ),
        appliesTo: record.appliesTo,
      }) === nextIdentityKey;
  });
  const superseded = existing.find(
    (record) =>
      record.lifecycle === "active" &&
      record.kind === metadata.kind &&
      normalizeFeedbackAppliesTo(record.appliesTo) === metadata.appliesTo,
  );

  return { duplicate, superseded, ...metadata };
}

async function recordFeedbackEvolution(input: {
  evolutionRuntime: EvolutionFeedbackRuntime;
  result: FeedbackResult;
  scope: FeedbackInput["scope"];
  strictExperience?: boolean;
  traceId?: string;
}): Promise<FeedbackReceipts> {
  return input.evolutionRuntime.handleFeedback({
    scope: input.scope,
    result: input.result,
    ...(input.traceId ? { traceId: input.traceId } : {}),
    ...(input.strictExperience ? { strict: true } : {}),
  });
}

export async function writeFeedbackSignal(input: {
  appliesTo?: string;
  evolutionRuntime: EvolutionFeedbackRuntime;
  feedbackRepository: GovernanceRepositoryPort["feedback"];
  language: LanguageService;
  locale?: string;
  scope: FeedbackInput["scope"];
  signal: string;
  evidenceIds?: string[];
  strictExperience?: boolean;
  traceId?: string;
}): Promise<{ receipts: FeedbackReceipts; result: FeedbackResult }> {
  if (!hasPersistableSemanticText(input.signal)) {
    return {
      receipts: { promotionReceipts: [], proposalReceipts: [] },
      result: { accepted: false },
    };
  }

  const { duplicate, kind, resolvedLanguage, superseded } =
    await resolveFeedbackSignalState(input);
  let result: FeedbackResult;

  if (duplicate) {
    result = {
      accepted: true,
      ...(input.evidenceIds ? { evidenceIds: input.evidenceIds } : {}),
      outcome: "merged",
      memoryId: duplicate.id,
      kind,
      metadata: {
        locale: resolvedLanguage.locale,
        localeSource: resolvedLanguage.localeSource,
        languagePackId: resolvedLanguage.languagePackId,
        languagePackVersion: resolvedLanguage.languagePackVersion,
        analysisMode: resolvedLanguage.analysisMode,
      },
    };
  } else {
    const timestamp = new Date().toISOString();
    const nextRecord = createFeedbackMemory({
      id: crypto.randomUUID(),
      userId: input.scope.userId,
      tenantId: input.scope.tenantId,
      workspaceId: input.scope.workspaceId,
      agentId: input.scope.agentId,
      sessionId: input.scope.sessionId,
      rule: input.signal,
      kind,
      appliesTo: input.appliesTo ?? "general_response",
      source: createMemorySource({
        method: "explicit",
        extractedAt: timestamp,
        sessionId: input.scope.sessionId,
        locale: resolvedLanguage.locale,
        localeSource: resolvedLanguage.localeSource,
        languagePackId: resolvedLanguage.languagePackId,
        languagePackVersion: resolvedLanguage.languagePackVersion,
      }),
      updatedAt: timestamp,
    });

    if (superseded) {
      await input.feedbackRepository.upsert(createFeedbackMemory({
        ...superseded,
        lifecycle: "superseded",
        supersededBy: nextRecord.id,
        updatedAt: timestamp,
      }));
    }
    await input.feedbackRepository.upsert(nextRecord);
    result = {
      accepted: true,
      ...(input.evidenceIds ? { evidenceIds: input.evidenceIds } : {}),
      outcome: superseded ? "superseded" : "written",
      memoryId: nextRecord.id,
      kind,
      metadata: {
        locale: resolvedLanguage.locale,
        localeSource: resolvedLanguage.localeSource,
        languagePackId: resolvedLanguage.languagePackId,
        languagePackVersion: resolvedLanguage.languagePackVersion,
        analysisMode: resolvedLanguage.analysisMode,
      },
    };
  }

  return {
    receipts: await recordFeedbackEvolution({
      evolutionRuntime: input.evolutionRuntime,
      result,
      scope: input.scope,
      strictExperience: input.strictExperience,
      traceId: input.traceId,
    }),
    result,
  };
}

export function withFeedbackReceipts(
  result: FeedbackResult,
  receipts: FeedbackReceipts,
): FeedbackResult {
  return {
    ...result,
    ...(receipts.proposalReceipts.length > 0
      ? { proposalReceipts: receipts.proposalReceipts }
      : {}),
    ...(receipts.promotionReceipts.length > 0
      ? { promotionReceipts: receipts.promotionReceipts }
      : {}),
  };
}

export async function submitAgentEventCorrection(input: {
  appliesTo?: string;
  evolutionRuntime: EvolutionCorrectionRuntime;
  language: LanguageService;
  locale?: string;
  scope: FeedbackInput["scope"];
  signal: string;
  evidenceIds?: string[];
  strictExperience?: boolean;
  traceId?: string;
}): Promise<AgentEventCorrectionResult> {
  const { appliesTo, kind, resolvedLanguage } =
    resolveFeedbackSignalMetadata(input);
  const receipts = await input.evolutionRuntime.handleAgentCorrection({
    appliesTo,
    kind,
    scope: input.scope,
    signal: input.signal,
    ...(input.evidenceIds ? { evidenceIds: input.evidenceIds } : {}),
    ...(input.strictExperience ? { strict: true } : {}),
    ...(input.traceId ? { traceId: input.traceId } : {}),
  });
  return {
    accepted: true,
    ...(input.evidenceIds ? { evidenceIds: input.evidenceIds } : {}),
    kind,
    metadata: {
      locale: resolvedLanguage.locale,
      localeSource: resolvedLanguage.localeSource,
      languagePackId: resolvedLanguage.languagePackId,
      languagePackVersion: resolvedLanguage.languagePackVersion,
      analysisMode: resolvedLanguage.analysisMode,
    },
    ...(receipts.proposalReceipts.length > 0
      ? { proposalReceipts: receipts.proposalReceipts }
      : {}),
    ...(receipts.promotionReceipts.length > 0
      ? { promotionReceipts: receipts.promotionReceipts }
      : {}),
  };
}
