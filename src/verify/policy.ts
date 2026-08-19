import type {
  EpisodeMemory,
  FactMemory,
  ReferenceMemory,
} from "../domain/records";
import {
  resolveEpisodeFreshnessTimestamp,
  resolveFactFreshnessTimestamp,
} from "../domain/records";
import { createLanguageService } from "../language";
import type { LanguageQueryAnalysis, LanguageService } from "../language";

export interface VerificationHint {
  memoryId: string;
  memoryType: "fact" | "reference" | "episode";
  reason: string;
  evidenceIds?: string[];
}

export interface VerificationPolicyInput {
  query: string;
  referenceTime: string;
  evidenceIdsByMemoryId?: Record<string, string[]>;
  facts: FactMemory[];
  references?: ReferenceMemory[];
  episodes?: EpisodeMemory[];
  locale?: string;
  language?: LanguageService;
  queryAnalysis?: LanguageQueryAnalysis;
}

const DEFAULT_LANGUAGE = createLanguageService();

export interface FactVerificationAssessment {
  actionDriving: boolean;
  factAgeDays: number;
  inferred: boolean;
  shouldHint: boolean;
  stale: boolean;
}

function daysBetween(left: string, right: string): number {
  const ms = Math.max(
    0,
    new Date(left).getTime() - new Date(right).getTime(),
  );
  return ms / (1000 * 60 * 60 * 24);
}

function resolveVerificationContext(input: {
  query: string;
  locale?: string;
  language?: LanguageService;
  queryAnalysis?: LanguageQueryAnalysis;
}): {
  actionDriving: boolean;
  language: LanguageService;
  locale: string;
} {
  const language = input.language ?? DEFAULT_LANGUAGE;
  const locale =
    input.locale ??
    language.resolveFromText({
      text: input.query,
    }).locale;

  return {
    actionDriving:
      input.queryAnalysis?.actionDriving ??
      language.analyzeQuery(input.query, locale).actionDriving,
    language,
    locale,
  };
}

function assessFactVerificationNeed(input: {
  fact: FactMemory;
  query: string;
  referenceTime: string;
  locale?: string;
  language?: LanguageService;
  actionDriving?: boolean;
  queryAnalysis?: LanguageQueryAnalysis;
}): FactVerificationAssessment {
  const actionDriving = input.actionDriving ??
    resolveVerificationContext(input).actionDriving;
  const factAgeDays = daysBetween(
    input.referenceTime,
    resolveFactFreshnessTimestamp(input.fact),
  );
  const stale = factAgeDays >= 30;
  const inferred = input.fact.source.method === "inferred";

  return {
    actionDriving,
    factAgeDays,
    inferred,
    shouldHint: stale || (actionDriving && inferred),
    stale,
  };
}

export function factVerificationAdvisoryPenalty(input: {
  fact: FactMemory;
  query: string;
  referenceTime: string;
  locale?: string;
  language?: LanguageService;
  queryAnalysis?: LanguageQueryAnalysis;
}): number {
  const assessment = assessFactVerificationNeed(input);
  if (!assessment.shouldHint) {
    return 0;
  }

  let penalty = 0;

  if (assessment.stale) {
    if (assessment.actionDriving) {
      penalty += assessment.factAgeDays >= 90 ? 0.22 : 0.18;
    } else {
      penalty += assessment.factAgeDays >= 90 ? 0.08 : 0.05;
    }
  }

  if (assessment.actionDriving && assessment.inferred) {
    penalty += 0.12;
  }

  return penalty;
}

export function evaluateVerificationHints(
  input: VerificationPolicyInput,
): VerificationHint[] {
  const hints: VerificationHint[] = [];
  const context = resolveVerificationContext(input);

  for (const fact of input.facts) {
    const assessment = assessFactVerificationNeed({
      fact,
      query: input.query,
      referenceTime: input.referenceTime,
      locale: context.locale,
      language: context.language,
      actionDriving: context.actionDriving,
    });
    if (!assessment.shouldHint) {
      continue;
    }

    if (assessment.stale) {
      hints.push({
        memoryId: fact.id,
        memoryType: "fact",
        reason: `stale fact (${Math.floor(assessment.factAgeDays)} days old) should be verified before action`,
        evidenceIds: input.evidenceIdsByMemoryId?.[fact.id],
      });
      continue;
    }

    if (assessment.actionDriving && assessment.inferred) {
      hints.push({
        memoryId: fact.id,
        memoryType: "fact",
        reason: "inferred fact should be verified before driving action",
        evidenceIds: input.evidenceIdsByMemoryId?.[fact.id],
      });
    }
  }

  if (context.actionDriving) {
    for (const reference of input.references ?? []) {
      const referenceAgeDays = daysBetween(input.referenceTime, reference.createdAt);
      if (referenceAgeDays < 30) {
        continue;
      }

      hints.push({
        memoryId: reference.id,
        memoryType: "reference",
        reason: `stale reference (${Math.floor(referenceAgeDays)} days old) should be re-checked before action`,
        evidenceIds: input.evidenceIdsByMemoryId?.[reference.id],
      });
    }

    for (const episode of input.episodes ?? []) {
      const episodeAgeDays = daysBetween(
        input.referenceTime,
        resolveEpisodeFreshnessTimestamp(episode),
      );
      if (episodeAgeDays < 30) {
        continue;
      }

      hints.push({
        memoryId: episode.id,
        memoryType: "episode",
        reason: `stale episode (${Math.floor(episodeAgeDays)} days old) should be re-validated before action`,
        evidenceIds: input.evidenceIdsByMemoryId?.[episode.id],
      });
    }
  }

  return hints;
}
