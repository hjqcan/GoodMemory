import { createFeedbackMemory, type FeedbackMemory } from "../domain/records";
import { createMemorySource } from "../domain/provenance";
import type { MemoryScope } from "../domain/scope";
import type { LanguageService } from "../language";
import type { EvolutionRepositoryPort } from "../storage/ports";
import { readCompiledGuidance } from "./behavioralTelemetry";
import { attachBehavioralPolicyAttributes } from "./behavioralPolicy";

function resolveFeedbackLanguageSource(
  feedback: Pick<FeedbackMemory, "rule" | "source">,
  language: LanguageService,
) {
  const resolved = language.resolveFromText({
    ...(feedback.source.locale ? { locale: feedback.source.locale } : {}),
    text: feedback.rule,
  });
  return {
    locale: feedback.source.locale ?? resolved.locale,
    localeSource: feedback.source.localeSource ?? resolved.localeSource,
    languagePackId: feedback.source.languagePackId ?? resolved.languagePackId,
    languagePackVersion:
      feedback.source.languagePackVersion ?? resolved.languagePackVersion,
  };
}

function feedbackMatchesScope(
  feedback: FeedbackMemory,
  proposal: {
    userId: string;
    tenantId?: string;
    workspaceId?: string;
    agentId?: string;
    sessionId?: string;
  },
): boolean {
  return (
    feedback.userId === proposal.userId &&
    feedback.tenantId === proposal.tenantId &&
    feedback.workspaceId === proposal.workspaceId &&
    feedback.agentId === proposal.agentId
  );
}

function normalizeRule(
  feedback: Pick<FeedbackMemory, "rule" | "source">,
  language: LanguageService,
): string {
  const source = resolveFeedbackLanguageSource(feedback, language);
  return language.normalizeForEquality(feedback.rule, source.locale);
}

export interface ProceduralPatternCompilerConfig {
  createId?: () => string;
  language: LanguageService;
  now?: () => string;
  repositories: EvolutionRepositoryPort;
}

export interface ProceduralPatternCompilerResult {
  compiledCount: number;
}

export function createProceduralPatternCompiler(
  config: ProceduralPatternCompilerConfig,
) {
  const createId = config.createId ?? (() => crypto.randomUUID());
  const now = config.now ?? (() => new Date().toISOString());

  return {
    async compile(scope: MemoryScope): Promise<ProceduralPatternCompilerResult> {
      const [feedback, proposals, promotions] = await Promise.all([
        config.repositories.feedback.listByScope(scope),
        config.repositories.proposals.listByScope(scope),
        config.repositories.promotions.listByScope(scope),
      ]);
      const feedbackById = new Map(feedback.map((record) => [record.id, record] as const));
      const acceptedProposalIds = new Set(
        promotions
          .filter((promotion) => promotion.decision === "accepted")
          .map((promotion) => promotion.proposalId),
      );
      const acceptedProceduralProposals = proposals.filter(
        (proposal) =>
          proposal.proposalType === "procedural_pattern" &&
          proposal.status === "accepted" &&
          acceptedProposalIds.has(proposal.id),
      );
      let compiledCount = 0;

      for (const proposal of acceptedProceduralProposals) {
        const sourceFeedbackId = proposal.linkedMemoryIds[0];
        const sourceFeedback = sourceFeedbackId
          ? feedbackById.get(sourceFeedbackId)
          : undefined;
        const compiledGuidance = readCompiledGuidance(proposal);
        const feedbackSeed =
          sourceFeedback &&
          sourceFeedback.kind !== "validated_pattern" &&
          sourceFeedback.lifecycle === "active"
            ? sourceFeedback
            : compiledGuidance
              ? {
                  rule: compiledGuidance.rule,
                  source: createMemorySource({
                    method: "confirmed",
                    extractedAt: now(),
                    sessionId: proposal.sessionId,
                  }),
                }
              : undefined;

        if (!feedbackSeed) {
          continue;
        }

        const normalizedRule = normalizeRule(feedbackSeed, config.language);
        const existingValidatedPattern = feedback.find(
          (record) =>
            record.lifecycle === "active" &&
            record.kind === "validated_pattern" &&
            record.appliesTo === (sourceFeedback?.appliesTo ?? compiledGuidance?.appliesTo) &&
            feedbackMatchesScope(record, proposal) &&
            normalizeRule(record, config.language) === normalizedRule,
        );

        if (existingValidatedPattern) {
          if (sourceFeedback?.lifecycle === "active") {
            const supersededSource = createFeedbackMemory({
              ...sourceFeedback,
              lifecycle: "superseded",
              supersededBy: existingValidatedPattern.id,
              updatedAt: now(),
            });
            await config.repositories.feedback.upsert(supersededSource);
            feedbackById.set(supersededSource.id, supersededSource);
          }
          continue;
        }

        const timestamp = now();
        const compiledPattern = createFeedbackMemory({
          id: createId(),
          userId: proposal.userId,
          tenantId: proposal.tenantId,
          workspaceId: proposal.workspaceId,
          agentId: proposal.agentId,
          rule: feedbackSeed.rule,
          kind: "validated_pattern",
          appliesTo: sourceFeedback?.appliesTo ?? compiledGuidance?.appliesTo,
          why: compiledGuidance?.why ?? proposal.rationale,
          evidence: proposal.linkedEvidenceIds,
          confidence: sourceFeedback?.confidence ?? compiledGuidance?.confidence,
          attributes: compiledGuidance?.behavioralPolicy
            ? attachBehavioralPolicyAttributes(
                sourceFeedback?.attributes,
                compiledGuidance.behavioralPolicy,
              )
            : sourceFeedback?.attributes,
          source: createMemorySource({
            method: "confirmed",
            extractedAt: timestamp,
            sessionId: proposal.sessionId,
            ...resolveFeedbackLanguageSource(feedbackSeed, config.language),
          }),
          updatedAt: timestamp,
        });
        if (sourceFeedback) {
          const supersededSource = createFeedbackMemory({
            ...sourceFeedback,
            lifecycle: "superseded",
            supersededBy: compiledPattern.id,
            updatedAt: timestamp,
          });

          await config.repositories.feedback.upsert(supersededSource);
          feedback.push(supersededSource);
          feedbackById.set(supersededSource.id, supersededSource);
        }
        await config.repositories.feedback.upsert(compiledPattern);
        feedback.push(compiledPattern);
        feedbackById.set(compiledPattern.id, compiledPattern);
        compiledCount += 1;
      }

      return {
        compiledCount,
      };
    },
  };
}
