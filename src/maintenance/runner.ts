import {
  createEpisodeMemory,
  createFactMemory,
  isActiveMemoryLifecycle,
  isFactExpired,
  resolveEpisodeFreshnessTimestamp,
  resolveFactEffectiveTimestamp,
  resolveFactFreshnessTimestamp,
} from "../domain/records";
import type { EmbeddingAdapter } from "../embedding/contracts";
import {
  buildEpisodeEmbeddingWrite,
  buildFactEmbeddingWrite,
  buildReferenceEmbeddingWrite,
  upsertMemoryEmbeddings,
} from "../embedding/vectorWrites";
import {
  createExperienceRecord,
  createSessionArchive,
} from "../evolution/contracts";
import type {
  EpisodeMemory,
  FactMemory,
} from "../domain/records";
import type { MemoryScope } from "../domain/scope";
import type { SessionArchive } from "../evolution/contracts";
import { createLanguageService } from "../language";
import type {
  LanguageContentAnalysis,
  LanguageService,
} from "../language";
import {
  readMemoryQualityRepairSignal,
  readMemoryQualityReplacementMemoryId,
} from "./qualityRepairSignals";
import type {
  MaintenanceRepositoryPort,
  MaintenanceVectorPort,
} from "../storage/ports";

export type MaintenanceJobName =
  | "projectionMigration"
  | "projectionRepair"
  | "dedupe"
  | "contradiction"
  | "qualityRepair"
  | "consolidation"
  | "embeddingRepair"
  | "retrievalCues"
  | "observationSynthesis"
  | "ttlExpiry";

export interface MaintenanceRunnerConfig {
  embedding?: EmbeddingAdapter;
  language?: LanguageService;
  projectionRepair?: {
    repairPending(scope: MemoryScope): Promise<number>;
  };
  projectionMigration?: {
    ensureScopeIndexed(scope: MemoryScope): Promise<{
      complete: boolean;
      indexedSources: number;
    }>;
  };
  repositories: MaintenanceRepositoryPort & { vectorIndex?: MaintenanceVectorPort | null };
  // R9.4: the contradiction job additionally runs the claim-slot supersession
  // sweep (R4.1's batch form) when the projection runtime is wired. Absent
  // means the job keeps its fact-level polarity pass only.
  claimSlotSweep?: {
    sweepClaimSlots(scope: MemoryScope): Promise<number>;
  };
  // R9 opt-in synthesizer for the observationSynthesis job: one compact
  // observation per subject with enough active facts. Absent means the job
  // applies nothing.
  observationSynthesis?: {
    synthesize(input: {
      contents: readonly string[];
      subject: string;
    }): Promise<string | null>;
    maxSubjectsPerRun?: number;
    minFactsPerSubject?: number;
  };
  // Opt-in generator for the retrievalCues job. Absent means the job applies
  // nothing.
  retrievalCues?: {
    generate(input: {
      category: string;
      content: string;
      subject?: string;
    }): Promise<string[]>;
    maxFactsPerRun?: number;
  };
  vectorIndex?: MaintenanceVectorPort | null;
  now?: () => string;
}

export interface MaintenanceJobReport {
  name: MaintenanceJobName;
  applied: number;
}

export interface MaintenanceRunReport {
  scope: MemoryScope;
  ranAt: string;
  jobs: MaintenanceJobReport[];
}

function buildMaintenanceSummary(reports: MaintenanceJobReport[]): string {
  const segments = reports.map((report) => `${report.name}=${report.applied}`);
  return `Maintenance ran ${segments.join(", ")}.`;
}

async function persistMaintenanceExperienceRecord(
  repositories: MaintenanceRepositoryPort,
  scope: MemoryScope,
  reports: MaintenanceJobReport[],
  timestamp: string,
): Promise<void> {
  try {
    await repositories.experiences.add(
      createExperienceRecord({
        id: crypto.randomUUID(),
        userId: scope.userId,
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agentId: scope.agentId,
        sessionId: scope.sessionId,
        kind: "maintenance",
        traceId: crypto.randomUUID(),
        trigger: "maintenance",
        summary: buildMaintenanceSummary(reports),
        outcome: reports.some((job) => job.applied > 0) ? "success" : "skipped",
        createdAt: timestamp,
      }),
    );
  } catch (error) {
    console.error("Failed to persist maintenance experience record", error);
  }
}

function sortFactsForMaintenance(facts: FactMemory[]): FactMemory[] {
  return [...facts].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}

function sortEpisodesForMaintenance(episodes: EpisodeMemory[]): EpisodeMemory[] {
  return [...episodes].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
}

function factMaintenanceStrength(fact: FactMemory): number {
  return (
    (fact.source.method === "explicit" ? 2 : 0) +
    fact.confidence -
    Math.min(fact.verificationPressureCount ?? 0, 4) * 0.3
  );
}

function compareFactEffectiveTime(left: FactMemory, right: FactMemory): number {
  return Date.parse(resolveFactEffectiveTimestamp(left)) -
    Date.parse(resolveFactEffectiveTimestamp(right));
}

const STALE_ACTION_REPAIR_MIN_AGE_DAYS = 90;
const STALE_ACTION_REPAIR_MIN_VERIFICATION_PRESSURE = 2;
const STALE_ACTION_REPAIR_MAX_CONFIDENCE = 0.7;
const STALE_ACTION_REPAIR_MAX_IMPORTANCE = 0.55;

function daysBefore(referenceTime: string, timestamp: string): number {
  const delta = new Date(referenceTime).getTime() - new Date(timestamp).getTime();
  return Math.max(0, delta) / (1000 * 60 * 60 * 24);
}

type FactContentAnalyzer = (fact: FactMemory) => LanguageContentAnalysis;

function createFactContentAnalyzer(
  language: LanguageService,
): FactContentAnalyzer {
  const analyses = new Map<string, LanguageContentAnalysis>();

  return (fact) => {
    const existing = analyses.get(fact.id);
    if (existing) {
      return existing;
    }
    const context = language.resolveFromText({
      locale: fact.source.locale,
      text: fact.content,
    });
    const analysis = language.analyzeContent(fact.content, context);
    analyses.set(fact.id, analysis);
    return analysis;
  };
}

function isActionDrivingFact(
  fact: FactMemory,
  analyzeContent: FactContentAnalyzer,
): boolean {
  if (
    fact.factKind === "blocker" ||
    fact.factKind === "open_loop" ||
    fact.factKind === "project_state" ||
    fact.factKind === "focus_update"
  ) {
    return true;
  }
  if (fact.category !== "project" && fact.category !== "technical") {
    return false;
  }

  const analysis = analyzeContent(fact);
  return (
    analysis.blockerFact ||
    analysis.openLoopFact ||
    analysis.projectStateFact ||
    analysis.focusFact
  );
}

function shouldDemoteStaleActionFact(input: {
  activeFacts: FactMemory[];
  analyzeContent: FactContentAnalyzer;
  fact: FactMemory;
  timestamp: string;
}): boolean {
  const verificationPressure = input.fact.verificationPressureCount ?? 0;

  return (
    input.fact.source.method === "inferred" &&
    input.fact.confidence <= STALE_ACTION_REPAIR_MAX_CONFIDENCE &&
    input.fact.importance <= STALE_ACTION_REPAIR_MAX_IMPORTANCE &&
    verificationPressure >= STALE_ACTION_REPAIR_MIN_VERIFICATION_PRESSURE &&
    daysBefore(
      input.timestamp,
      resolveFactFreshnessTimestamp(input.fact),
    ) >=
      STALE_ACTION_REPAIR_MIN_AGE_DAYS &&
    isActionDrivingFact(input.fact, input.analyzeContent) &&
    hasActiveQualityReplacementFact(input)
  );
}

function resolveQualityRepairDemotionReason(input: {
  activeFacts: FactMemory[];
  analyzeContent: FactContentAnalyzer;
  fact: FactMemory;
  timestamp: string;
}): string | null {
  const qualitySignal = readMemoryQualityRepairSignal(input.fact);
  if (qualitySignal) {
    return qualitySignal.demotionReason;
  }

  if (shouldDemoteStaleActionFact(input)) {
    return "stale_action_quality_repair";
  }

  return null;
}

function hasActiveQualityReplacementFact(input: {
  activeFacts: FactMemory[];
  analyzeContent: FactContentAnalyzer;
  fact: FactMemory;
}): boolean {
  const replacementId = readMemoryQualityReplacementMemoryId(input.fact);
  if (!replacementId) {
    return false;
  }

  const replacement = input.activeFacts.find((fact) => fact.id === replacementId);
  return Boolean(
    replacement &&
      replacement.id !== input.fact.id &&
      replacement.lifecycle === "active" &&
      compareFactEffectiveTime(replacement, input.fact) > 0 &&
      replacement.confidence > input.fact.confidence &&
      isActionDrivingFact(replacement, input.analyzeContent),
  );
}

function mergeUniqueStrings(...groups: string[][]): string[] {
  return [...new Set(groups.flat())];
}

function mergeSummarySegments(...segments: Array<string | undefined>): string {
  return [...new Set(
    segments
      .map((segment) => segment?.trim())
      .filter((segment): segment is string => Boolean(segment)),
  )].join(" | ");
}

function buildScopeLineage(record: {
  tenantId?: string;
  workspaceId?: string;
  agentId?: string;
}): string[] {
  return [
    record.tenantId,
    record.workspaceId,
    record.agentId,
  ].filter((segment): segment is string => Boolean(segment));
}

function shareConsolidationScope(left: EpisodeMemory, right: EpisodeMemory): boolean {
  return (
    left.userId === right.userId &&
    left.tenantId === right.tenantId &&
    left.workspaceId === right.workspaceId &&
    left.agentId === right.agentId
  );
}

function isSameArchiveIdentity(
  archive: SessionArchive,
  episode: EpisodeMemory,
): boolean {
  return (
    archive.userId === episode.userId &&
    archive.tenantId === episode.tenantId &&
    archive.workspaceId === episode.workspaceId &&
    archive.agentId === episode.agentId &&
    archive.sessionId === episode.sessionId
  );
}

function createArchiveFromEpisode(
  episode: EpisodeMemory,
  timestamp: string,
  existingArchive?: SessionArchive,
): SessionArchive {
  const summary = mergeSummarySegments(existingArchive?.summary, episode.summary);
  const createdAt = existingArchive && existingArchive.createdAt.localeCompare(episode.createdAt) < 0
    ? existingArchive.createdAt
    : episode.createdAt;

  return createSessionArchive({
    id: existingArchive?.id ?? crypto.randomUUID(),
    userId: episode.userId,
    tenantId: episode.tenantId,
    workspaceId: episode.workspaceId,
    agentId: episode.agentId,
    sessionId: episode.sessionId!,
    sourceSessionIds: mergeUniqueStrings(
      existingArchive?.sourceSessionIds ?? [],
      [episode.sessionId!],
    ),
    summary,
    normalizedTranscript: existingArchive?.normalizedTranscript,
    keyDecisions: mergeUniqueStrings(
      existingArchive?.keyDecisions ?? [],
      episode.keyDecisions,
    ),
    unresolvedItems: mergeUniqueStrings(
      existingArchive?.unresolvedItems ?? [],
      episode.unresolvedItems,
    ),
    referencedArtifacts: mergeUniqueStrings(
      existingArchive?.referencedArtifacts ?? [],
      episode.topics,
    ),
    scopeLineage: buildScopeLineage(episode),
    locale: existingArchive?.locale ?? episode.locale,
    createdAt,
    archivedAt: timestamp,
  });
}

async function runDedupeCleanup(
  repositories: MaintenanceRepositoryPort,
  vectorIndex: MaintenanceVectorPort | null,
  language: LanguageService,
  scope: MemoryScope,
  timestamp: string,
): Promise<MaintenanceJobReport> {
  const facts = sortFactsForMaintenance(
    (await repositories.facts.listByScope(scope)).filter((fact) => fact.lifecycle === "active"),
  );
  const seen = new Map<string, FactMemory>();
  let applied = 0;

  for (const fact of facts) {
    const locale = language.resolveFromText({
      locale: fact.source.locale,
      text: fact.content,
    }).locale;
    const key = language.normalizeForEquality(fact.content, locale);
    const winner = seen.get(key);

    if (!winner) {
      seen.set(key, fact);
      continue;
    }

    await repositories.facts.add(
      createFactMemory({
        ...fact,
        lifecycle: "superseded",
        isActive: false,
        supersededBy: winner.id,
        updatedAt: timestamp,
      }),
    );
    await vectorIndex?.deleteFactEmbedding(fact.id);
    applied += 1;
  }

  return {
    name: "dedupe",
    applied,
  };
}

async function runContradictionRepair(
  repositories: MaintenanceRepositoryPort,
  vectorIndex: MaintenanceVectorPort | null,
  language: LanguageService,
  analyzeContent: FactContentAnalyzer,
  scope: MemoryScope,
  timestamp: string,
): Promise<MaintenanceJobReport> {
  const facts = sortFactsForMaintenance(
    (await repositories.facts.listByScope(scope)).filter((fact) => fact.lifecycle === "active"),
  );
  let applied = 0;

  for (let i = 0; i < facts.length; i += 1) {
    const left = facts[i]!;
    if (left.lifecycle !== "active") {
      continue;
    }

    for (let j = i + 1; j < facts.length; j += 1) {
      const right = facts[j]!;
      if (right.lifecycle !== "active") {
        continue;
      }

      const leftLocale = language.resolveFromText({
        locale: left.source.locale,
        text: left.content,
      }).locale;
      const rightLocale = language.resolveFromText({
        locale: right.source.locale,
        text: right.content,
      }).locale;
      if (!language.localesCompatible(leftLocale, rightLocale)) {
        continue;
      }

      const overlap = language.tokenOverlap(left.content, right.content, leftLocale, {
        excludeStopwords: true,
      });
      if (overlap < 0.3) {
        continue;
      }

      const leftPolarity = analyzeContent(left).factPolarity;
      const rightPolarity = analyzeContent(right).factPolarity;

      if (
        leftPolarity === "unknown" ||
        rightPolarity === "unknown" ||
        leftPolarity === rightPolarity
      ) {
        continue;
      }

      const leftStrength = factMaintenanceStrength(left);
      const rightStrength = factMaintenanceStrength(right);
      let weaker: FactMemory | undefined;

      if (leftStrength !== rightStrength) {
        weaker = leftStrength < rightStrength ? left : right;
      } else {
        const leftPressure = left.verificationPressureCount ?? 0;
        const rightPressure = right.verificationPressureCount ?? 0;
        const effectiveTimeComparison = compareFactEffectiveTime(left, right);

        if (leftPressure !== rightPressure) {
          weaker = leftPressure > rightPressure ? left : right;
        } else if (effectiveTimeComparison !== 0) {
          weaker = effectiveTimeComparison < 0
            ? left
            : right;
        }
      }

      if (!weaker) {
        continue;
      }

      await repositories.facts.add(
        createFactMemory({
          ...weaker,
          lifecycle: "inactive",
          isActive: false,
          demotedAt: timestamp,
          demotionReason: "contradicted_by_stronger_fact",
          updatedAt: timestamp,
        }),
      );
      await vectorIndex?.deleteFactEmbedding(weaker.id);
      applied += 1;
      break;
    }
  }

  return {
    name: "contradiction",
    applied,
  };
}

async function runQualityRepair(
  repositories: MaintenanceRepositoryPort,
  vectorIndex: MaintenanceVectorPort | null,
  analyzeContent: FactContentAnalyzer,
  scope: MemoryScope,
  timestamp: string,
): Promise<MaintenanceJobReport> {
  const facts = sortFactsForMaintenance(
    (await repositories.facts.listByScope(scope)).filter((fact) => fact.lifecycle === "active"),
  );
  const activeFactsById = new Map(facts.map((fact) => [fact.id, fact]));
  let applied = 0;

  for (const fact of facts) {
    if (!activeFactsById.has(fact.id)) {
      continue;
    }
    const demotionReason = resolveQualityRepairDemotionReason({
      activeFacts: [...activeFactsById.values()],
      analyzeContent,
      fact,
      timestamp,
    });
    if (!demotionReason) {
      continue;
    }

    await repositories.facts.add(
      createFactMemory({
        ...fact,
        lifecycle: "inactive",
        isActive: false,
        demotedAt: timestamp,
        demotionReason,
        updatedAt: timestamp,
      }),
    );
    await vectorIndex?.deleteFactEmbedding(fact.id);
    activeFactsById.delete(fact.id);
    applied += 1;
  }

  return {
    name: "qualityRepair",
    applied,
  };
}

// Demote facts whose bi-temporal validity window has closed (validUntil) or
// whose TTL has elapsed (expiresAt) to "inactive", so recall (which only
// surfaces active facts) stops returning stale entries -- the "memory bloat"
// failure mode where expired facts pollute top-k results. A no-op for facts
// without validUntil/expiresAt, so it only acts on memory that opted into TTL.
async function runTtlExpiry(
  repositories: MaintenanceRepositoryPort,
  vectorIndex: MaintenanceVectorPort | null,
  scope: MemoryScope,
  timestamp: string,
): Promise<MaintenanceJobReport> {
  const facts = (await repositories.facts.listByScope(scope)).filter(
    (fact) => fact.lifecycle === "active",
  );
  let applied = 0;

  for (const fact of facts) {
    if (!isFactExpired(fact, timestamp)) {
      continue;
    }
    await repositories.facts.add(
      createFactMemory({
        ...fact,
        lifecycle: "inactive",
        isActive: false,
        demotedAt: timestamp,
        demotionReason: "ttl_expired",
        updatedAt: timestamp,
      }),
    );
    await vectorIndex?.deleteFactEmbedding(fact.id);
    applied += 1;
  }

  return {
    name: "ttlExpiry",
    applied,
  };
}

async function runEpisodeConsolidation(
  repositories: MaintenanceRepositoryPort,
  vectorIndex: MaintenanceVectorPort | null,
  language: LanguageService,
  scope: MemoryScope,
  timestamp: string,
  embedding?: EmbeddingAdapter,
): Promise<MaintenanceJobReport> {
  const episodes = sortEpisodesForMaintenance(
    (await repositories.episodes.listByScope(scope)).filter((episode) => !episode.archivedAt),
  );
  const archives = await repositories.archives.listByScope(scope);

  for (let i = 0; i < episodes.length; i += 1) {
    const left = episodes[i]!;

    for (let j = i + 1; j < episodes.length; j += 1) {
      const right = episodes[j]!;
      if (!shareConsolidationScope(left, right)) {
        continue;
      }

      const leftLocale = language.resolveFromText({
        locale: left.locale,
        text: left.topics.join(" "),
      }).locale;
      const rightLocale = language.resolveFromText({
        locale: right.locale,
        text: right.topics.join(" "),
      }).locale;
      if (!language.localesCompatible(leftLocale, rightLocale)) {
        continue;
      }

      const topicScore = language.tokenOverlap(
        left.topics.join(" "),
        right.topics.join(" "),
        leftLocale,
        {
          excludeStopwords: true,
        },
      );

      if (topicScore < 0.3) {
        continue;
      }

      const consolidated = createEpisodeMemory({
        id: crypto.randomUUID(),
        userId: left.userId,
        tenantId: left.tenantId,
        workspaceId: left.workspaceId,
        agentId: left.agentId,
        sessionId: left.sessionId === right.sessionId ? left.sessionId : undefined,
        summary: `Consolidated: ${left.summary} | ${right.summary}`,
        keyDecisions: mergeUniqueStrings(left.keyDecisions, right.keyDecisions),
        unresolvedItems: mergeUniqueStrings(left.unresolvedItems, right.unresolvedItems),
        topics: mergeUniqueStrings(left.topics, right.topics),
        importance: Math.max(left.importance, right.importance),
        confidence: Math.max(left.confidence, right.confidence),
        locale: left.locale ?? right.locale,
        observedAt: [
          resolveEpisodeFreshnessTimestamp(left),
          resolveEpisodeFreshnessTimestamp(right),
        ].sort()[0],
        createdAt: timestamp,
      });

      await repositories.episodes.add(
        createEpisodeMemory({
          ...left,
          archivedAt: timestamp,
        }),
      );
      await repositories.episodes.add(
        createEpisodeMemory({
          ...right,
          archivedAt: timestamp,
        }),
      );
      for (const archivedEpisode of [left, right]) {
        if (!archivedEpisode.sessionId) {
          continue;
        }

        const archiveIndex = archives.findIndex((archive) =>
          isSameArchiveIdentity(archive, archivedEpisode),
        );
        const archive = createArchiveFromEpisode(
          archivedEpisode,
          timestamp,
          archiveIndex >= 0 ? archives[archiveIndex] : undefined,
        );

        await repositories.archives.add(archive);
        if (archiveIndex >= 0) {
          archives[archiveIndex] = archive;
        } else {
          archives.push(archive);
        }
      }
      await repositories.episodes.add(consolidated);
      if (embedding && vectorIndex) {
        await upsertMemoryEmbeddings(
          [buildEpisodeEmbeddingWrite(consolidated)],
          embedding,
          vectorIndex,
        );
      }
      await vectorIndex?.deleteEpisodeEmbedding(left.id);
      await vectorIndex?.deleteEpisodeEmbedding(right.id);

      return {
        name: "consolidation",
        applied: 1,
      };
    }
  }

  return {
    name: "consolidation",
    applied: 0,
  };
}

async function runEmbeddingRepair(
  repositories: MaintenanceRepositoryPort,
  vectorIndex: MaintenanceVectorPort | null,
  scope: MemoryScope,
  embedding?: EmbeddingAdapter,
): Promise<MaintenanceJobReport> {
  if (!embedding || !vectorIndex) {
    return {
      name: "embeddingRepair",
      applied: 0,
    };
  }

  const [facts, references, episodes] = await Promise.all([
    repositories.facts.listByScope(scope),
    repositories.references.listByScope(scope),
    repositories.episodes.listByScope(scope),
  ]);
  const writes = [
    ...facts
      .filter((fact) => fact.lifecycle === "active")
      .map((fact) => buildFactEmbeddingWrite(fact)),
    ...references
      .filter((reference) => isActiveMemoryLifecycle(reference))
      .map((reference) => buildReferenceEmbeddingWrite(reference)),
    ...episodes
      .filter((episode) => !episode.archivedAt)
      .map((episode) => buildEpisodeEmbeddingWrite(episode)),
  ];
  for (const fact of facts.filter((fact) => fact.lifecycle !== "active")) {
    await vectorIndex.deleteFactEmbedding(fact.id);
  }
  for (const reference of references.filter((reference) => !isActiveMemoryLifecycle(reference))) {
    await vectorIndex.deleteReferenceEmbedding(reference.id);
  }
  for (const episode of episodes.filter((episode) => Boolean(episode.archivedAt))) {
    await vectorIndex.deleteEpisodeEmbedding(episode.id);
  }
  const applied = await upsertMemoryEmbeddings(
    writes,
    embedding,
    vectorIndex,
  );

  return {
    name: "embeddingRepair",
    applied,
  };
}

const RETRIEVAL_CUES_ATTRIBUTE = "retrievalCues";
const RETRIEVAL_CUES_MAX_PER_FACT = 4;
const RETRIEVAL_CUES_MAX_CUE_CHARS = 160;
const RETRIEVAL_CUES_DEFAULT_MAX_FACTS_PER_RUN = 16;

// Backfill write-time question expansions ("retrieval cues") for active facts
// that lack them. Cues bridge the question-to-fact phrasing gap in the lexical
// channel: fact attributes already project as field-granularity recall
// documents, and the context builder never renders attributes, so cues are
// retrieval keys only. Generator failures skip the fact and never fail the
// run; facts that already carry cues are never re-generated, so repeated runs
// converge.
async function runRetrievalCueBackfill(
  repositories: MaintenanceRepositoryPort,
  generator: MaintenanceRunnerConfig["retrievalCues"],
  scope: MemoryScope,
  timestamp: string,
): Promise<MaintenanceJobReport> {
  if (!generator) {
    return { name: "retrievalCues", applied: 0 };
  }
  const maxFacts = Math.max(
    1,
    Math.floor(
      generator.maxFactsPerRun ?? RETRIEVAL_CUES_DEFAULT_MAX_FACTS_PER_RUN,
    ),
  );
  const facts = sortFactsForMaintenance(
    (await repositories.facts.listByScope(scope)).filter(
      (fact) =>
        fact.lifecycle === "active" &&
        typeof fact.attributes?.[RETRIEVAL_CUES_ATTRIBUTE] !== "string",
    ),
  ).slice(0, maxFacts);
  let applied = 0;

  for (const fact of facts) {
    let cues: string[];
    try {
      cues = await generator.generate({
        category: fact.category,
        content: fact.content,
        ...(fact.subject && fact.subject !== "unknown"
          ? { subject: fact.subject }
          : {}),
      });
    } catch (error) {
      console.error("[goodmemory:maintenance] retrieval-cue generation failed", {
        error: error instanceof Error ? error.message : String(error),
        factId: fact.id,
      });
      continue;
    }
    const sanitized = [
      ...new Set(
        cues
          .map((cue) => cue.trim().slice(0, RETRIEVAL_CUES_MAX_CUE_CHARS))
          .filter((cue) => cue.length > 0),
      ),
    ].slice(0, RETRIEVAL_CUES_MAX_PER_FACT);
    if (sanitized.length === 0) {
      continue;
    }
    await repositories.facts.add(
      createFactMemory({
        ...fact,
        attributes: {
          ...fact.attributes,
          [RETRIEVAL_CUES_ATTRIBUTE]: sanitized.join("\n"),
        },
        updatedAt: timestamp,
      }),
    );
    applied += 1;
  }

  return { name: "retrievalCues", applied };
}

const OBSERVATION_SYNTHESIS_DEFAULT_MIN_FACTS = 4;
const OBSERVATION_SYNTHESIS_DEFAULT_MAX_SUBJECTS_PER_RUN = 16;
const OBSERVATION_SYNTHESIS_MAX_CONTENT_CHARS = 800;
const OBSERVATION_OF_ATTRIBUTE = "observationOf";
const OBSERVATION_MEMBER_IDS_ATTRIBUTE = "observationMemberIds";

// R9: synthesize one compact observation memory per subject with enough
// active facts. The observation is a regular fact with inferred provenance
// and attribute pointers to its member fact ids, so it indexes into recall
// like any memory and stays auditable/forgettable through existing paths.
// Idempotent by member set: a stored observation whose member-id list still
// matches is skipped; when the set changes, the stale observation is
// replaced (demoted to inactive) and one fresh observation is written.
async function runObservationSynthesis(
  repositories: MaintenanceRepositoryPort,
  synthesizer: MaintenanceRunnerConfig["observationSynthesis"],
  vectorIndex: MaintenanceVectorPort | null,
  scope: MemoryScope,
  timestamp: string,
): Promise<MaintenanceJobReport> {
  if (!synthesizer) {
    return { name: "observationSynthesis", applied: 0 };
  }
  const minFacts = Math.max(
    2,
    Math.floor(
      synthesizer.minFactsPerSubject ?? OBSERVATION_SYNTHESIS_DEFAULT_MIN_FACTS,
    ),
  );
  const maxSubjects = Math.max(
    1,
    Math.floor(
      synthesizer.maxSubjectsPerRun ??
        OBSERVATION_SYNTHESIS_DEFAULT_MAX_SUBJECTS_PER_RUN,
    ),
  );
  const active = (await repositories.facts.listByScope(scope)).filter(
    (fact) => fact.lifecycle === "active" && fact.isActive !== false,
  );
  const observations = new Map<string, FactMemory>();
  for (const fact of active) {
    const subject = fact.attributes?.[OBSERVATION_OF_ATTRIBUTE];
    if (typeof subject === "string") {
      observations.set(subject, fact);
    }
  }
  const members = new Map<string, FactMemory[]>();
  for (const fact of sortFactsForMaintenance(active)) {
    if (typeof fact.attributes?.[OBSERVATION_OF_ATTRIBUTE] === "string") {
      continue;
    }
    const subject = fact.subject?.trim();
    if (!subject || subject === "unknown") {
      continue;
    }
    const bucket = members.get(subject);
    if (bucket) {
      bucket.push(fact);
    } else {
      members.set(subject, [fact]);
    }
  }
  let applied = 0;
  let processed = 0;
  for (const [subject, facts] of [...members.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (facts.length < minFacts) {
      continue;
    }
    const memberIds = facts.map((fact) => fact.id).sort().join("\n");
    const existing = observations.get(subject);
    if (
      existing &&
      existing.attributes?.[OBSERVATION_MEMBER_IDS_ATTRIBUTE] === memberIds
    ) {
      continue;
    }
    if (processed >= maxSubjects) {
      break;
    }
    processed += 1;
    let content: string | null;
    try {
      content = await synthesizer.synthesize({
        contents: facts.map((fact) => fact.content),
        subject,
      });
    } catch (error) {
      console.error(
        "[goodmemory:maintenance] observation synthesis failed",
        {
          error: error instanceof Error ? error.message : String(error),
          subject,
        },
      );
      continue;
    }
    const trimmed = content?.trim().slice(
      0,
      OBSERVATION_SYNTHESIS_MAX_CONTENT_CHARS,
    );
    if (!trimmed) {
      continue;
    }
    // Stable per-subject identity: replacement is a same-id overwrite, so a
    // stale observation can never coexist with its successor. A legacy
    // observation under a different id (if any) is demoted first.
    const observationId = `observation:${scopeKeyForObservation(scope)}:${subject}`;
    if (existing && existing.id !== observationId) {
      await repositories.facts.add(
        createFactMemory({
          ...existing,
          lifecycle: "inactive",
          isActive: false,
          demotedAt: timestamp,
          demotionReason: "superseded_observation",
          updatedAt: timestamp,
        }),
      );
      await vectorIndex?.deleteFactEmbedding(existing.id);
    }
    const template = facts[0]!;
    await repositories.facts.add(
      createFactMemory({
        id: observationId,
        userId: template.userId,
        tenantId: template.tenantId,
        workspaceId: template.workspaceId,
        agentId: template.agentId,
        category: template.category,
        content: trimmed,
        subject,
        confidence: 0.7,
        importance: 0.7,
        source: { method: "inferred", extractedAt: timestamp },
        attributes: {
          [OBSERVATION_OF_ATTRIBUTE]: subject,
          [OBSERVATION_MEMBER_IDS_ATTRIBUTE]: memberIds,
        },
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );
    applied += 1;
  }
  return { name: "observationSynthesis", applied };
}

function scopeKeyForObservation(scope: MemoryScope): string {
  return [scope.userId, scope.tenantId, scope.workspaceId, scope.agentId]
    .filter((segment): segment is string => Boolean(segment))
    .join(":");
}

export function createMaintenanceRunner(config: MaintenanceRunnerConfig) {
  const language = config.language ?? createLanguageService();
  const now = config.now ?? (() => new Date().toISOString());
  const vectorIndex =
    config.vectorIndex !== undefined
      ? config.vectorIndex ?? null
      : config.repositories.vectorIndex ?? null;

  return {
    async run(
      scope: MemoryScope,
      jobs: MaintenanceJobName[] = [
        // ttlExpiry runs first so later jobs (and the embedding rebuild) only
        // see facts that are still valid; it is a no-op for facts without
        // validUntil/expiresAt. qualityRepair stays opt-in: it demotes on
        // heuristics, while ttlExpiry only honors an explicit per-fact TTL.
        "ttlExpiry",
        "projectionRepair",
        "dedupe",
        "contradiction",
        "consolidation",
        "embeddingRepair",
      ],
    ): Promise<MaintenanceRunReport> {
      const timestamp = now();
      const reports: MaintenanceJobReport[] = [];
      const analyzeContent = createFactContentAnalyzer(language);

      for (const job of jobs) {
        if (job === "projectionMigration") {
          const migration = config.projectionMigration
            ? await config.projectionMigration.ensureScopeIndexed(scope)
            : { complete: false, indexedSources: 0 };
          reports.push({
            name: job,
            applied: migration.complete ? migration.indexedSources : 0,
          });
          continue;
        }

        if (job === "projectionRepair") {
          reports.push({
            name: job,
            applied: config.projectionRepair
              ? await config.projectionRepair.repairPending(scope)
              : 0,
          });
          continue;
        }

        if (job === "dedupe") {
          reports.push(
            await runDedupeCleanup(
              config.repositories,
              vectorIndex,
              language,
              scope,
              timestamp,
            ),
          );
          continue;
        }

        if (job === "consolidation") {
          reports.push(
            await runEpisodeConsolidation(
              config.repositories,
              vectorIndex,
              language,
              scope,
              timestamp,
              config.embedding,
            ),
          );
          continue;
        }

        if (job === "embeddingRepair") {
          reports.push(
            await runEmbeddingRepair(
              config.repositories,
              vectorIndex,
              scope,
              config.embedding,
            ),
          );
          continue;
        }

        if (job === "qualityRepair") {
          reports.push(
            await runQualityRepair(
              config.repositories,
              vectorIndex,
              analyzeContent,
              scope,
              timestamp,
            ),
          );
          continue;
        }

        if (job === "ttlExpiry") {
          reports.push(
            await runTtlExpiry(
              config.repositories,
              vectorIndex,
              scope,
              timestamp,
            ),
          );
          continue;
        }

        if (job === "retrievalCues") {
          reports.push(
            await runRetrievalCueBackfill(
              config.repositories,
              config.retrievalCues,
              scope,
              timestamp,
            ),
          );
          continue;
        }

        if (job === "observationSynthesis") {
          reports.push(
            await runObservationSynthesis(
              config.repositories,
              config.observationSynthesis,
              vectorIndex,
              scope,
              timestamp,
            ),
          );
          continue;
        }

        const contradiction = await runContradictionRepair(
          config.repositories,
          vectorIndex,
          language,
          analyzeContent,
          scope,
          timestamp,
        );
        // R9.4: the structural claim-slot sweep (R4.1's batch form) runs as
        // part of the contradiction job — same repair intent, structured
        // layer. Slot closures count into the job's applied total.
        const slotClosures = config.claimSlotSweep
          ? await config.claimSlotSweep.sweepClaimSlots(scope)
          : 0;
        reports.push({
          name: contradiction.name,
          applied: contradiction.applied + slotClosures,
        });
      }

      const report = {
        scope,
        ranAt: timestamp,
        jobs: reports,
      };
      await persistMaintenanceExperienceRecord(
        config.repositories,
        scope,
        reports,
        timestamp,
      );

      return report;
    },
  };
}
