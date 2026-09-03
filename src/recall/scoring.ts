import type {
  EpisodeMemory,
  FactKind,
  FactMemory,
  FeedbackMemory,
  MemoryScopeKind,
  PreferenceMemory,
  ReferenceKind,
  ReferenceMemory,
} from "../domain/records";
import {
  resolveEpisodeFreshnessTimestamp,
  resolveFactEffectiveTimestamp,
  resolveFactFreshnessTimestamp,
  resolveMemoryLifecycle,
} from "../domain/records";
import type { MemoryScope } from "../domain/scope";
import type { MemorySourceMethod } from "../domain/provenance";
import type { EmbeddingAdapter } from "../embedding/contracts";
import type { SessionArchive } from "../domain/evolutionRecords";
import type {
  LanguageContentAnalysis,
  LanguageQueryAnalysis,
  LanguageService,
} from "../language";
import type { RecallVectorSearchPort } from "../storage/ports";
import { factVerificationAdvisoryPenalty } from "../verify/policy";
import type { RecallRouterStrategy } from "./router";

// Overlap-token count above which a record is "long": its max-denominator
// lexical score can no longer reflect query coverage, so a second,
// query-side coverage signal is recorded for the opt-in long-record
// admission lane. Extracted facts and dialog turns stay well below it, so
// calibrated short-record behavior is untouched.
export const LONG_RECORD_OVERLAP_TOKEN_FLOOR = 32;

export interface RankedFactCandidate {
  fact: FactMemory;
  locale: string;
  factKind?: FactKind;
  scopeKind?: MemoryScopeKind;
  subject: string;
  semanticScore: number;
  lexicalScore: number;
  // Present only for long records: matched query tokens over query tokens.
  queryCoverageScore?: number;
  queryCoverageMatches?: number;
  subjectScore: number;
  intentScore: number;
  freshnessScore: number;
  explicitnessScore: number;
  evidenceScore: number;
  verificationPenaltyScore: number;
  categoryBoost: number;
  score: number;
}

export interface RankedReferenceCandidate {
  reference: ReferenceMemory;
  locale: string;
  referenceKind?: ReferenceKind;
  subject: string;
  semanticScore: number;
  lexicalScore: number;
  subjectScore: number;
  intentScore: number;
  freshnessScore: number;
  explicitnessScore: number;
  evidenceScore: number;
  score: number;
}

export interface RankedEpisodeCandidate {
  episode: EpisodeMemory;
  locale: string;
  semanticScore: number;
  lexicalScore: number;
  freshnessScore: number;
  score: number;
}

export interface RankedArchiveCandidate {
  archive: SessionArchive;
  locale: string;
  lexicalScore: number;
  freshnessScore: number;
  score: number;
}

export interface SemanticFactCandidate {
  id: string;
  // RAW vector-store score (dot/inner product depending on the store), captured
  // BEFORE normalizeSemanticScores rescales the map to max=1. Similarity
  // thresholds must apply to this value, never to the normalized map.
  score: number;
}

export interface SemanticSearchScores {
  facts: Map<string, number>;
  references: Map<string, number>;
  episodes: Map<string, number>;
  notes?: Map<string, number>;
  // Present ONLY when the embedding+vectorIndex branch ran with the
  // semantic-candidates union enabled. The BM25 branch must never set this: its
  // scores are lexical, and unioning them would readmit the very lexical floor
  // the union exists to bypass.
  semanticFactCandidates?: SemanticFactCandidate[];
}

const SEMANTIC_TIE_BREAK_EPSILON = 0.2;

// The semantic similarity score is promoted from a tie-break-only signal to a
// first-class ADDITIVE ranking term for hybrid/semantic strategies, while
// "rules-only" stays a pure lexical floor. The weight is intentionally
// sub-lexical (a perfect semantic match contributes less than a strong
// multi-term lexical match) and is the single tunable constant to validate on
// held-out retrieval suites once a real neural embedding endpoint populates
// non-zero semantic scores. Until such an endpoint
// exists every semanticScore is 0 (semantic search is gated on
// `strategy === "hybrid" && config.embedding && vectorIndex` in recall/engine),
// so this term is a guaranteed no-op and cannot regress the accepted
// rules-only/hybrid numbers. Without this promotion a perfect embedding could
// only reorder candidates inside the +/-0.2 tie-break band, capping the payoff
// of any embedding endpoint to near zero.
const SEMANTIC_ADDITIVE_WEIGHT = 0.6;

function effectiveRankingScore(
  score: number,
  semanticScore: number,
  strategy: RecallRouterStrategy,
): number {
  if (strategy === "rules-only") {
    return score;
  }
  return score + SEMANTIC_ADDITIVE_WEIGHT * semanticScore;
}

function categoryPriority(
  category: FactMemory["category"],
  queryAnalysis: LanguageQueryAnalysis,
): number {
  if (
    queryAnalysis.answerComposition ||
    queryAnalysis.factConfirmation ||
    queryAnalysis.projectState
  ) {
    if (category === "project" || category === "technical") {
      return 0.4;
    }
    if (category === "personal") {
      return -0.25;
    }
  }

  return 0;
}

function factIntentPriority(
  factAnalysis: LanguageContentAnalysis,
  queryAnalysis: LanguageQueryAnalysis,
): number {
  let score = 0;

  if (queryAnalysis.role && factAnalysis.roleFact) {
    score += 0.7;
  }

  if (queryAnalysis.focus && factAnalysis.focusFact) {
    score += 0.6;
  }

  if (queryAnalysis.openLoop && factAnalysis.openLoopFact) {
    score += 0.55;
  }

  if (queryAnalysis.blocker && factAnalysis.blockerFact) {
    score += 0.55;
  }

  return score;
}

function resolveFactLocale(
  fact: FactMemory,
  language: LanguageService,
): string {
  return (
    fact.source.locale ??
    language.resolveFromText({
      text: fact.content,
    }).locale
  );
}

function resolveReferenceLocale(
  reference: ReferenceMemory,
  language: LanguageService,
): string {
  return (
    reference.source.locale ??
    language.resolveFromText({
      text: [reference.title, reference.pointer, reference.description ?? ""]
        .filter(Boolean)
        .join(" "),
    }).locale
  );
}

function resolveEpisodeLocale(
  episode: EpisodeMemory,
  language: LanguageService,
): string {
  return (
    episode.locale ??
    language.resolveFromText({
      text: [episode.summary, episode.topics.join(" ")]
        .filter(Boolean)
        .join(" "),
    }).locale
  );
}

function resolveArchiveLocale(
  archive: SessionArchive,
  language: LanguageService,
): string {
  return (
    archive.locale ??
    language.resolveFromText({
      text: [
        archive.summary,
        archive.keyDecisions.join(" "),
        archive.unresolvedItems.join(" "),
        archive.normalizedTranscript ?? "",
        archive.referencedArtifacts.join(" "),
      ]
        .filter(Boolean)
        .join(" "),
    }).locale
  );
}

function buildVectorScopeFilter(scope: MemoryScope): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries({
      userId: scope.userId,
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agentId: scope.agentId,
    }).filter(([, value]) => value !== undefined),
  );
}

export function normalizeSemanticScores(
  results: Array<{ id: string; score: number }>,
): Map<string, number> {
  const highestScore = results.reduce(
    (currentMax, result) => Math.max(currentMax, result.score),
    0,
  );

  if (highestScore <= 0) {
    return new Map();
  }

  return new Map(
    results.map((result) => [result.id, result.score / highestScore] as const),
  );
}

export async function searchSemanticScores(input: {
  embedding: EmbeddingAdapter;
  query: string;
  scope: MemoryScope;
  vectorIndex: RecallVectorSearchPort;
  // When set, the fact search widens to max(8, topK) and the raw-scored top-K
  // fact hits are returned alongside the normalized additive map, feeding the
  // opt-in semantic candidate-generation union. One search call serves both:
  // the normalization denominator is the top-1 score, so widening the fetch
  // never changes the normalized values of the previous top-8.
  factCandidates?: { topK: number };
}): Promise<SemanticSearchScores> {
  const [queryEmbedding] = await input.embedding.embed([input.query]);
  const filter = buildVectorScopeFilter(input.scope);
  const factTopK = Math.max(8, Math.floor(input.factCandidates?.topK ?? 0));
  const [facts, references, episodes, notes] = await Promise.all([
    input.vectorIndex.searchFactEmbedding(queryEmbedding, {
      topK: factTopK,
      filter,
    }),
    input.vectorIndex.searchReferenceEmbedding(queryEmbedding, {
      topK: 8,
      filter,
    }),
    input.vectorIndex.searchEpisodeEmbedding(queryEmbedding, {
      topK: 6,
      filter,
    }),
    input.vectorIndex.searchNoteEmbedding(queryEmbedding, {
      topK: 4,
      filter,
    }),
  ]);

  return {
    facts: normalizeSemanticScores(facts),
    references: normalizeSemanticScores(references),
    episodes: normalizeSemanticScores(episodes),
    notes: normalizeSemanticScores(notes),
    ...(input.factCandidates
      ? {
          semanticFactCandidates: facts
            .slice(0, Math.max(1, Math.floor(input.factCandidates.topK)))
            .map(({ id, score }) => ({ id, score })),
        }
      : {}),
  };
}

function daysBetween(left: string, right: string): number {
  const ms = Math.max(
    0,
    new Date(left).getTime() - new Date(right).getTime(),
  );
  return ms / (1000 * 60 * 60 * 24);
}

export function freshnessScore(timestamp: string, referenceTime: string): number {
  const ageDays = daysBetween(referenceTime, timestamp);
  if (ageDays <= 7) {
    return 0.25;
  }
  if (ageDays <= 30) {
    return 0.15;
  }
  if (ageDays <= 90) {
    return 0.05;
  }

  return 0;
}

export function explicitnessScore(method: MemorySourceMethod): number {
  if (method === "explicit" || method === "confirmed") {
    return 0.15;
  }
  if (method === "import") {
    return 0.05;
  }

  return 0;
}

export function evidenceSupportScore(evidenceCount: number): number {
  if (evidenceCount <= 0) {
    return 0;
  }

  return Math.min(evidenceCount, 4) * 0.015;
}

function durableVerificationPressurePenalty(input: {
  referenceTime: string;
  verificationPressureCount?: number;
  lastVerificationHintAt?: string;
}): number {
  const count = input.verificationPressureCount ?? 0;
  if (count <= 0) {
    return 0;
  }

  if (!input.lastVerificationHintAt) {
    return Math.min(count, 4) * 0.02;
  }

  const ageDays = daysBetween(input.referenceTime, input.lastVerificationHintAt);
  if (ageDays > 30) {
    return Math.min(count, 4) * 0.008;
  }
  if (ageDays > 7) {
    return Math.min(count, 4) * 0.015;
  }

  return Math.min(count, 4) * 0.03;
}

function resolveFactKind(
  fact: FactMemory,
  analysis: LanguageContentAnalysis,
): FactKind | undefined {
  if (fact.factKind) {
    return fact.factKind;
  }
  if (analysis.roleFact) {
    return "role_update";
  }
  if (analysis.focusFact) {
    return "focus_update";
  }
  if (analysis.blockerFact) {
    return "blocker";
  }
  if (analysis.openLoopFact) {
    return "open_loop";
  }
  if (analysis.projectStateFact) {
    return "project_state";
  }
  if (fact.category === "project" || fact.category === "technical") {
    return "generic_project";
  }

  return undefined;
}

function resolveFactScopeKind(
  fact: FactMemory,
  factKind: FactKind | undefined,
): MemoryScopeKind | undefined {
  if (fact.scopeKind) {
    return fact.scopeKind;
  }
  if (factKind === "role_update") {
    return "identity";
  }
  if (
    factKind === "focus_update" ||
    factKind === "blocker" ||
    factKind === "open_loop" ||
    factKind === "project_state" ||
    factKind === "generic_project"
  ) {
    return "project";
  }
  if (
    fact.category === "personal" ||
    fact.category === "relationship" ||
    fact.category === "event"
  ) {
    return "identity";
  }
  if (fact.category === "project" || fact.category === "technical") {
    return "project";
  }

  return undefined;
}

function resolveReferenceKind(reference: ReferenceMemory): ReferenceKind | undefined {
  if (reference.referenceKind) {
    return reference.referenceKind;
  }

  const basename = reference.pointer.split("/").at(-1)?.toLowerCase() ?? "";
  if (basename.includes("runbook")) {
    return "runbook";
  }
  if (basename.includes("dashboard")) {
    return "dashboard";
  }
  if (basename.includes("tracker")) {
    return "tracker";
  }
  if (basename.length > 0) {
    return "doc";
  }

  return undefined;
}

export function buildFactCandidates(
  facts: FactMemory[],
  query: string,
  language: LanguageService,
  queryLocale: string,
  referenceTime: string,
  semanticScores?: Map<string, number>,
  evidenceCountsByMemoryId?: Map<string, number>,
  providedQueryAnalysis?: LanguageQueryAnalysis,
): RankedFactCandidate[] {
  const queryAnalysis = providedQueryAnalysis ??
    language.analyzeQuery(query, queryLocale);
  return sortFacts(facts).map((fact) => {
    const locale = resolveFactLocale(fact, language);
    const factAnalysis = language.analyzeContent(fact.content, locale);
    const factKind = resolveFactKind(fact, factAnalysis);
    const scopeKind = resolveFactScopeKind(fact, factKind);
    const subject = fact.subject ?? "unknown";
    const overlapDetail = language.tokenOverlapDetail(fact.content, query, queryLocale, {
      excludeStopwords: true,
    });
    const lexicalScore =
      overlapDetail.leftSize === 0 || overlapDetail.rightSize === 0
        ? 0
        : overlapDetail.intersection /
          Math.max(overlapDetail.leftSize, overlapDetail.rightSize);
    const longRecordCoverage =
      overlapDetail.leftSize > LONG_RECORD_OVERLAP_TOKEN_FLOOR &&
      overlapDetail.rightSize > 0
        ? {
            queryCoverageScore: overlapDetail.intersection / overlapDetail.rightSize,
            queryCoverageMatches: overlapDetail.intersection,
          }
        : {};
    const subjectScore =
      subject === "unknown"
        ? 0
        : language.tokenOverlap(subject, query, queryLocale, {
            excludeStopwords: true,
          });
    const intentScore = factIntentPriority(factAnalysis, queryAnalysis);
    const freshness = freshnessScore(
      resolveFactFreshnessTimestamp(fact),
      referenceTime,
    );
    const explicitness = explicitnessScore(fact.source.method);
    const evidenceScore = evidenceSupportScore(
      evidenceCountsByMemoryId?.get(fact.id) ?? 0,
    );
    const verificationPenaltyScore =
      factVerificationAdvisoryPenalty({
        fact,
        query,
        referenceTime,
        locale: queryLocale,
        language,
        queryAnalysis,
      }) +
      durableVerificationPressurePenalty({
        referenceTime,
        verificationPressureCount: fact.verificationPressureCount,
        lastVerificationHintAt: fact.lastVerificationHintAt,
      });
    const categoryBoost = categoryPriority(fact.category, queryAnalysis);
    const semanticScore = semanticScores?.get(fact.id) ?? 0;

    return {
      fact,
      locale,
      factKind,
      scopeKind,
      subject,
      semanticScore,
      lexicalScore,
      ...longRecordCoverage,
      subjectScore,
      intentScore,
      freshnessScore: freshness,
      explicitnessScore: explicitness,
      evidenceScore,
      verificationPenaltyScore,
      categoryBoost,
      score:
        lexicalScore +
        subjectScore +
        intentScore +
        freshness +
        explicitness +
        evidenceScore +
        categoryBoost -
        verificationPenaltyScore,
    };
  });
}

export function buildReferenceCandidates(
  references: ReferenceMemory[],
  query: string,
  language: LanguageService,
  queryLocale: string,
  referenceTime: string,
  semanticScores?: Map<string, number>,
  evidenceCountsByMemoryId?: Map<string, number>,
): RankedReferenceCandidate[] {
  return sortReferences(references).map((reference) => {
    const locale = resolveReferenceLocale(reference, language);
    const lexicalScore =
      language.tokenOverlap(reference.title, query, queryLocale, {
        excludeStopwords: true,
      }) +
      language.tokenOverlap(reference.pointer, query, queryLocale, {
        excludeStopwords: true,
      }) +
      language.tokenOverlap(reference.description ?? "", query, queryLocale, {
        excludeStopwords: true,
      });
    const subject = reference.subject ?? "unknown";
    const subjectScore =
      subject === "unknown"
        ? 0
        : language.tokenOverlap(subject, query, queryLocale, {
            excludeStopwords: true,
          });
    const freshness = freshnessScore(reference.createdAt, referenceTime);
    const explicitness = explicitnessScore(reference.source.method);
    const evidenceScore = evidenceSupportScore(
      evidenceCountsByMemoryId?.get(reference.id) ?? 0,
    );
    const semanticScore = semanticScores?.get(reference.id) ?? 0;

    return {
      reference,
      locale,
      referenceKind: resolveReferenceKind(reference),
      subject,
      semanticScore,
      lexicalScore,
      subjectScore,
      intentScore: 0.8,
      freshnessScore: freshness,
      explicitnessScore: explicitness,
      evidenceScore,
      score: lexicalScore + subjectScore + freshness + explicitness + evidenceScore + 0.8,
    };
  });
}

export function buildEpisodeCandidates(
  episodes: EpisodeMemory[],
  query: string,
  language: LanguageService,
  queryLocale: string,
  referenceTime: string,
  semanticScores?: Map<string, number>,
): RankedEpisodeCandidate[] {
  return sortEpisodes(episodes).map((episode) => {
    const locale = resolveEpisodeLocale(episode, language);
    const lexicalScore =
      language.tokenOverlap(episode.summary, query, queryLocale, {
        excludeStopwords: true,
      }) +
      language.tokenOverlap(episode.topics.join(" "), query, queryLocale, {
        excludeStopwords: true,
      });
    const freshness = freshnessScore(
      resolveEpisodeFreshnessTimestamp(episode),
      referenceTime,
    );
    const semanticScore = semanticScores?.get(episode.id) ?? 0;

    return {
      episode,
      locale,
      semanticScore,
      lexicalScore,
      freshnessScore: freshness,
      score: lexicalScore + freshness + episode.importance * 0.1,
    };
  });
}

export function buildArchiveCandidates(
  archives: SessionArchive[],
  query: string,
  language: LanguageService,
  queryLocale: string,
  referenceTime: string,
): RankedArchiveCandidate[] {
  return sortArchives(archives).map((archive) => {
    const locale = resolveArchiveLocale(archive, language);
    const summaryScore = language.tokenOverlap(archive.summary, query, queryLocale, {
      excludeStopwords: true,
    });
    const unresolvedScore = language.tokenOverlap(
      archive.unresolvedItems.join(" "),
      query,
      queryLocale,
      {
        excludeStopwords: true,
      },
    );
    const decisionScore = language.tokenOverlap(
      archive.keyDecisions.join(" "),
      query,
      queryLocale,
      {
        excludeStopwords: true,
      },
    );
    const transcriptScore = language.tokenOverlap(
      archive.normalizedTranscript ?? "",
      query,
      queryLocale,
      {
        excludeStopwords: true,
      },
    );
    const artifactScore = language.tokenOverlap(
      archive.referencedArtifacts.join(" "),
      query,
      queryLocale,
      {
        excludeStopwords: true,
      },
    );
    const lexicalScore =
      unresolvedScore * 1.4 +
      decisionScore * 1.2 +
      summaryScore +
      transcriptScore * 0.6 +
      artifactScore * 0.4;
    const freshness = freshnessScore(archive.archivedAt, referenceTime);

    return {
      archive,
      locale,
      lexicalScore,
      freshnessScore: freshness,
      score: lexicalScore + freshness + 0.2,
    };
  });
}

function compareFactCandidates(
  left: RankedFactCandidate,
  right: RankedFactCandidate,
  strategy: RecallRouterStrategy,
): number {
  const scoreDelta =
    effectiveRankingScore(right.score, right.semanticScore, strategy) -
    effectiveRankingScore(left.score, left.semanticScore, strategy);

  if (Math.abs(scoreDelta) > SEMANTIC_TIE_BREAK_EPSILON) {
    return scoreDelta;
  }
  if (strategy !== "rules-only" && right.semanticScore !== left.semanticScore) {
    return right.semanticScore - left.semanticScore;
  }
  if (scoreDelta !== 0) {
    return scoreDelta;
  }
  if (right.lexicalScore !== left.lexicalScore) {
    return right.lexicalScore - left.lexicalScore;
  }
  if (right.intentScore !== left.intentScore) {
    return right.intentScore - left.intentScore;
  }

  return left.fact.id.localeCompare(right.fact.id);
}

export function rankFactCandidates(
  entries: RankedFactCandidate[],
  strategy: RecallRouterStrategy,
): RankedFactCandidate[] {
  return [...entries].sort((left, right) =>
    compareFactCandidates(left, right, strategy),
  );
}

function compareReferenceCandidates(
  left: RankedReferenceCandidate,
  right: RankedReferenceCandidate,
  strategy: RecallRouterStrategy,
): number {
  const scoreDelta =
    effectiveRankingScore(right.score, right.semanticScore, strategy) -
    effectiveRankingScore(left.score, left.semanticScore, strategy);

  if (Math.abs(scoreDelta) > SEMANTIC_TIE_BREAK_EPSILON) {
    return scoreDelta;
  }
  if (strategy !== "rules-only" && right.semanticScore !== left.semanticScore) {
    return right.semanticScore - left.semanticScore;
  }
  if (scoreDelta !== 0) {
    return scoreDelta;
  }
  if (right.lexicalScore !== left.lexicalScore) {
    return right.lexicalScore - left.lexicalScore;
  }

  return left.reference.id.localeCompare(right.reference.id);
}

export function rankReferenceCandidates(
  entries: RankedReferenceCandidate[],
  strategy: RecallRouterStrategy,
): RankedReferenceCandidate[] {
  return [...entries].sort((left, right) =>
    compareReferenceCandidates(left, right, strategy),
  );
}

function compareEpisodeCandidates(
  left: RankedEpisodeCandidate,
  right: RankedEpisodeCandidate,
  strategy: RecallRouterStrategy,
): number {
  const scoreDelta =
    effectiveRankingScore(right.score, right.semanticScore, strategy) -
    effectiveRankingScore(left.score, left.semanticScore, strategy);

  if (Math.abs(scoreDelta) > SEMANTIC_TIE_BREAK_EPSILON) {
    return scoreDelta;
  }
  if (strategy !== "rules-only" && right.semanticScore !== left.semanticScore) {
    return right.semanticScore - left.semanticScore;
  }
  if (scoreDelta !== 0) {
    return scoreDelta;
  }
  if (right.lexicalScore !== left.lexicalScore) {
    return right.lexicalScore - left.lexicalScore;
  }

  return left.episode.id.localeCompare(right.episode.id);
}

export function rankEpisodeCandidates(
  entries: RankedEpisodeCandidate[],
  strategy: RecallRouterStrategy,
): RankedEpisodeCandidate[] {
  return [...entries].sort((left, right) =>
    compareEpisodeCandidates(left, right, strategy),
  );
}

export function rankArchiveCandidates(
  entries: RankedArchiveCandidate[],
): RankedArchiveCandidate[] {
  return [...entries].sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    if (right.lexicalScore !== left.lexicalScore) {
      return right.lexicalScore - left.lexicalScore;
    }
    if (right.freshnessScore !== left.freshnessScore) {
      return right.freshnessScore - left.freshnessScore;
    }

    return right.archive.archivedAt.localeCompare(left.archive.archivedAt);
  });
}

export function materializeFactCandidate(entry: RankedFactCandidate): FactMemory {
  if (
    entry.fact.factKind === entry.factKind &&
    entry.fact.scopeKind === entry.scopeKind &&
    entry.fact.subject === entry.subject
  ) {
    return entry.fact;
  }

  return {
    ...entry.fact,
    factKind: entry.fact.factKind ?? entry.factKind,
    scopeKind: entry.fact.scopeKind ?? entry.scopeKind,
    subject: entry.fact.subject ?? entry.subject,
  };
}

export function sortFacts(facts: FactMemory[]): FactMemory[] {
  return [...facts].sort((left, right) => {
    if (left.lifecycle !== right.lifecycle) {
      return left.lifecycle === "active" ? -1 : 1;
    }
    if (left.source.method !== right.source.method) {
      return left.source.method === "explicit" ? -1 : 1;
    }

    return resolveFactEffectiveTimestamp(right).localeCompare(
      resolveFactEffectiveTimestamp(left),
    );
  });
}

export function sortFeedback(feedback: FeedbackMemory[]): FeedbackMemory[] {
  return [...feedback].sort((left, right) => {
    if (left.lifecycle !== right.lifecycle) {
      return left.lifecycle === "active" ? -1 : 1;
    }
    if (left.kind !== right.kind) {
      if (left.kind === "validated_pattern") {
        return -1;
      }
      if (right.kind === "validated_pattern") {
        return 1;
      }
    }

    return right.updatedAt.localeCompare(left.updatedAt);
  });
}

export function sortPreferences(preferences: PreferenceMemory[]): PreferenceMemory[] {
  return [...preferences].sort((left, right) => {
    const leftLifecycle = left.lifecycle ?? "active";
    const rightLifecycle = right.lifecycle ?? "active";
    if (leftLifecycle !== rightLifecycle) {
      return leftLifecycle === "active" ? -1 : 1;
    }

    return right.updatedAt.localeCompare(left.updatedAt);
  });
}

export function sortReferences(references: ReferenceMemory[]): ReferenceMemory[] {
  return [...references].sort((left, right) => {
    const leftLifecycle = resolveMemoryLifecycle(left);
    const rightLifecycle = resolveMemoryLifecycle(right);
    if (leftLifecycle !== rightLifecycle) {
      return leftLifecycle === "active" ? -1 : 1;
    }

    return right.updatedAt.localeCompare(left.updatedAt);
  });
}

export function sortEpisodes(episodes: EpisodeMemory[]): EpisodeMemory[] {
  return [...episodes].sort((left, right) => {
    if (right.importance !== left.importance) {
      return right.importance - left.importance;
    }
    if (right.confidence !== left.confidence) {
      return right.confidence - left.confidence;
    }

    return right.createdAt.localeCompare(left.createdAt);
  });
}

export function sortArchives(archives: SessionArchive[]): SessionArchive[] {
  return [...archives].sort((left, right) =>
    right.archivedAt.localeCompare(left.archivedAt),
  );
}
