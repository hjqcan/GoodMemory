import type {
  EpisodeMemory,
  FactMemory,
  FeedbackMemory,
  PreferenceMemory,
  ReferenceMemory,
} from "../domain/records";
import type { SessionArchive } from "../domain/evolutionRecords";
import type { MemoryScope } from "../domain/scope";
import type { RecallRepositoryPort } from "../storage/ports";
import type {
  EpisodeSpanTurn,
  MemoryPacketInput,
} from "./contextBuilder";
import type {
  LoadedRecallContent,
  RecallEngineConfig,
  RecallRequestContext,
} from "./contracts";
import type { GeneralizedFusionCandidate } from "./generalizedFusion";
import { filterRecordsByDefaultRecallScope } from "./policy";
import type { RecallIndexDocument } from "./projections/contracts";

const EPISODE_SPAN_HYDRATION_EPISODE_LIMIT = 2;
const EPISODE_SPAN_HYDRATION_TURN_LIMIT = 6;

export function createEmptyRecallContent(
  policyApplied: readonly string[],
): LoadedRecallContent {
  return {
    archives: [],
    episodes: [],
    evidence: [],
    facts: [],
    feedback: [],
    journal: null,
    policyApplied,
    preferences: [],
    profile: null,
    projected: false,
    references: [],
    workingMemory: null,
  };
}

export function usesProjectedContentLoading(
  config: RecallEngineConfig,
  context: RecallRequestContext,
): boolean {
  return Boolean(
    context.generalizedFusionConfig &&
      config.projectionIndex &&
      context.input.strategy !== "rules-only" &&
      config.repositories.facts.get &&
      config.repositories.references.get &&
      config.repositories.episodes.get &&
      config.repositories.archives.get &&
      config.repositories.preferences.get &&
      config.repositories.feedback.get,
  );
}

export async function loadRecallContent(
  config: RecallEngineConfig,
  context: RecallRequestContext,
): Promise<LoadedRecallContent> {
  const projected = usesProjectedContentLoading(config, context);
  const policyApplied = new Set(context.policyApplied);
  const { input } = context;
  const [
    profile,
    preferences,
    references,
    facts,
    feedback,
    archives,
    evidence,
    episodes,
    workingMemory,
    journal,
  ] = await Promise.all([
    config.repositories.profiles.get(input.scope.userId),
    projected
      ? Promise.resolve<PreferenceMemory[]>([])
      : config.repositories.preferences.listByScope(input.scope),
    projected
      ? Promise.resolve<ReferenceMemory[]>([])
      : config.repositories.references.listByScope(input.scope),
    projected
      ? Promise.resolve<FactMemory[]>([])
      : config.repositories.facts.listByScope(input.scope),
    projected
      ? Promise.resolve<FeedbackMemory[]>([])
      : config.repositories.feedback.listByScope(input.scope),
    projected
      ? Promise.resolve<SessionArchive[]>([])
      : config.repositories.archives.listByScope(input.scope),
    projected && input.includeEvidence !== true
      ? Promise.resolve([])
      : config.repositories.evidence.listByScope(input.scope),
    projected
      ? Promise.resolve<EpisodeMemory[]>([])
      : config.repositories.episodes.listByScope(input.scope),
    input.scope.sessionId
      ? config.runtime.getWorkingMemory(input.scope)
      : Promise.resolve(null),
    input.scope.sessionId
      ? config.runtime.getJournal(input.scope)
      : Promise.resolve(null),
  ]);

  const visiblePreferences = filterRecordsByDefaultRecallScope(
    preferences,
    input.scope,
    policyApplied,
  );
  const visibleReferences = filterRecordsByDefaultRecallScope(
    references,
    input.scope,
    policyApplied,
  );
  const visibleFacts = filterRecordsByDefaultRecallScope(
    facts,
    input.scope,
    policyApplied,
  );
  const visibleFeedback = filterRecordsByDefaultRecallScope(
    feedback,
    input.scope,
    policyApplied,
  );
  const visibleArchives = filterRecordsByDefaultRecallScope(
    archives,
    input.scope,
    policyApplied,
  );
  const visibleEvidence = filterRecordsByDefaultRecallScope(
    evidence,
    input.scope,
    policyApplied,
  );
  const visibleEpisodes = filterRecordsByDefaultRecallScope(
    episodes,
    input.scope,
    policyApplied,
  );

  return {
    archives: visibleArchives,
    episodes: visibleEpisodes,
    evidence: visibleEvidence,
    facts: visibleFacts,
    feedback: visibleFeedback,
    journal,
    policyApplied: [...policyApplied],
    preferences: visiblePreferences,
    profile,
    projected,
    references: visibleReferences,
    workingMemory,
  };
}

export async function loadProjectedRecallContent(input: {
  candidates: readonly GeneralizedFusionCandidate[];
  config: RecallEngineConfig;
  content: LoadedRecallContent;
  context: RecallRequestContext;
  documents: readonly RecallIndexDocument[];
}): Promise<LoadedRecallContent> {
  if (!input.content.projected) {
    return input.content;
  }
  const policyApplied = new Set(input.content.policyApplied);
  const sources = [...input.candidates, ...input.documents];
  const sourceIds = (
    collection: GeneralizedFusionCandidate["sourceCollection"],
  ) => [...new Set(
    sources
      .filter((candidate) => candidate.sourceCollection === collection)
      .map(({ sourceMemoryId }) => sourceMemoryId),
  )];
  const factGet = input.config.repositories.facts.get!.bind(
    input.config.repositories.facts,
  );
  const referenceGet = input.config.repositories.references.get!.bind(
    input.config.repositories.references,
  );
  const episodeGet = input.config.repositories.episodes.get!.bind(
    input.config.repositories.episodes,
  );
  const archiveGet = input.config.repositories.archives.get!.bind(
    input.config.repositories.archives,
  );
  const preferenceGet = input.config.repositories.preferences.get!.bind(
    input.config.repositories.preferences,
  );
  const feedbackGet = input.config.repositories.feedback.get!.bind(
    input.config.repositories.feedback,
  );
  const [facts, references, episodes, archives, preferences, feedback] =
    await Promise.all([
      Promise.all(sourceIds("facts").map((id) => factGet(id))),
      Promise.all(sourceIds("references").map((id) => referenceGet(id))),
      Promise.all(sourceIds("episodes").map((id) => episodeGet(id))),
      Promise.all(sourceIds("session_archives").map((id) => archiveGet(id))),
      Promise.all(sourceIds("preferences").map((id) => preferenceGet(id))),
      Promise.all(sourceIds("feedback").map((id) => feedbackGet(id))),
    ]);
  const scope = input.context.input.scope;
  const visibleFacts = filterRecordsByDefaultRecallScope(
    facts.filter((record): record is FactMemory => record !== null),
    scope,
    policyApplied,
  );
  const visibleReferences = filterRecordsByDefaultRecallScope(
    references.filter((record): record is ReferenceMemory => record !== null),
    scope,
    policyApplied,
  );
  const visibleEpisodes = filterRecordsByDefaultRecallScope(
    episodes.filter((record): record is EpisodeMemory => record !== null),
    scope,
    policyApplied,
  );
  const visibleArchives = filterRecordsByDefaultRecallScope(
    archives.filter((record): record is SessionArchive => record !== null),
    scope,
    policyApplied,
  );
  const visiblePreferences = filterRecordsByDefaultRecallScope(
    preferences.filter((record): record is PreferenceMemory => record !== null),
    scope,
    policyApplied,
  );
  const visibleFeedback = filterRecordsByDefaultRecallScope(
    feedback.filter((record): record is FeedbackMemory => record !== null),
    scope,
    policyApplied,
  );

  return {
    ...input.content,
    archives: visibleArchives,
    episodes: visibleEpisodes,
    facts: visibleFacts,
    feedback: visibleFeedback,
    policyApplied: [...policyApplied],
    preferences: visiblePreferences,
    references: visibleReferences,
  };
}

export async function loadFullRecallContent(input: {
  config: RecallEngineConfig;
  content: LoadedRecallContent;
  context: RecallRequestContext;
}): Promise<LoadedRecallContent> {
  const scope = input.context.input.scope;
  const policyApplied = new Set(input.content.policyApplied);
  const [facts, references, episodes, archives, preferences, feedback, evidence] =
    await Promise.all([
      input.config.repositories.facts.listByScope(scope),
      input.config.repositories.references.listByScope(scope),
      input.config.repositories.episodes.listByScope(scope),
      input.config.repositories.archives.listByScope(scope),
      input.config.repositories.preferences.listByScope(scope),
      input.config.repositories.feedback.listByScope(scope),
      input.config.repositories.evidence.listByScope(scope),
    ]);
  const visibleFacts = filterRecordsByDefaultRecallScope(
    facts,
    scope,
    policyApplied,
  );
  const visibleReferences = filterRecordsByDefaultRecallScope(
    references,
    scope,
    policyApplied,
  );
  const visibleEpisodes = filterRecordsByDefaultRecallScope(
    episodes,
    scope,
    policyApplied,
  );
  const visibleArchives = filterRecordsByDefaultRecallScope(
    archives,
    scope,
    policyApplied,
  );
  const visiblePreferences = filterRecordsByDefaultRecallScope(
    preferences,
    scope,
    policyApplied,
  );
  const visibleFeedback = filterRecordsByDefaultRecallScope(
    feedback,
    scope,
    policyApplied,
  );
  const visibleEvidence = filterRecordsByDefaultRecallScope(
    evidence,
    scope,
    policyApplied,
  );

  return {
    ...input.content,
    archives: visibleArchives,
    episodes: visibleEpisodes,
    evidence: visibleEvidence,
    facts: visibleFacts,
    feedback: visibleFeedback,
    policyApplied: [...policyApplied],
    preferences: visiblePreferences,
    projected: false,
    references: visibleReferences,
  };
}

// Resolve admitted episodes' sourceMessageIds to stored source messages so the
// packet can quote the dialogue span. Additive: the port is optional and any
// lookup failure degrades that episode to the historical summary-only line.
export async function hydrateEpisodeSpans(input: {
  episodes: readonly EpisodeMemory[];
  scope: MemoryScope;
  sourceMessages: RecallRepositoryPort["sourceMessages"];
}): Promise<MemoryPacketInput["episodeSpans"]> {
  const port = input.sourceMessages;
  if (!port) {
    return undefined;
  }
  const targets = input.episodes
    .slice(0, EPISODE_SPAN_HYDRATION_EPISODE_LIMIT)
    .filter((episode) => (episode.sourceMessageIds?.length ?? 0) > 0);
  if (targets.length === 0) {
    return undefined;
  }
  const spans: Record<string, EpisodeSpanTurn[]> = {};
  for (const episode of targets) {
    const ids = (episode.sourceMessageIds ?? []).slice(
      0,
      EPISODE_SPAN_HYDRATION_TURN_LIMIT,
    );
    try {
      const records = await port.getByIds({ ids, scope: input.scope });
      if (records.length > 0) {
        spans[episode.id] = records.map((record) => ({
          content: record.content,
          role: record.role,
          ...(record.observedAt !== undefined
            ? { observedAt: record.observedAt }
            : {}),
        }));
      }
    } catch (error) {
      console.error(
        "[goodmemory:episode-span] source message lookup failed; rendering summary only",
        error,
      );
    }
  }
  return Object.keys(spans).length > 0 ? spans : undefined;
}
