import { createEpisodeMemory } from "../domain/records";
import type { EpisodeMemory } from "../domain/records";
import type {
  LanguageContentAnalysis,
  LanguageService,
  ResolvedLanguageContext,
} from "../language";
import type {
  MemoryCandidate,
  MemoryExtractionInput,
} from "./candidates";
import type { RememberSourceLanguageAnalyses } from "./languageAnalysis";

const ASSISTANT_FOLLOW_THROUGH_OVERLAP_THRESHOLD = 0.14;

interface IndexedEpisodeMessage {
  content: string;
  sourceMessageIndex: number;
}

type ResolveMessageAnalysis = (
  messageIndex: number,
) => LanguageContentAnalysis | undefined;

function dedupeNonEmpty(values: string[]): string[] {
  const seen = new Set<string>();

  return values.filter((value) => {
    const trimmed = value.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) {
      return false;
    }

    seen.add(trimmed);
    return true;
  });
}

function describeEpisodeCandidate(candidate: MemoryCandidate): string {
  const content = candidate.content.trim();

  if (candidate.kindHint === "profile") {
    const profileField = candidate.metadata?.profileField;
    return profileField ? `${profileField}: ${content}` : content;
  }

  return content;
}

function selectSubstantiveAssistantMessages(
  messages: MemoryExtractionInput["messages"],
  analyzeMessage: ResolveMessageAnalysis,
): IndexedEpisodeMessage[] {
  return messages
    .map((message, sourceMessageIndex) => ({
      content: message.content.trim(),
      role: message.role,
      sourceMessageIndex,
    }))
    .filter((message) => message.role === "assistant")
    .filter(({ content }) => content.length > 0)
    .filter(({ content, sourceMessageIndex }) => {
      const analysis = analyzeMessage(sourceMessageIndex);
      return (
        !analysis?.assistantAcknowledgement ||
        analysis.assistantContinuity ||
        content.length >= 24
      );
    })
    .map(({ content, sourceMessageIndex }) => ({ content, sourceMessageIndex }));
}

function selectAssistantContinuityMessages(
  messages: IndexedEpisodeMessage[],
  analyzeMessage: ResolveMessageAnalysis,
): IndexedEpisodeMessage[] {
  return messages.filter(({ sourceMessageIndex }) =>
    analyzeMessage(sourceMessageIndex)?.assistantContinuity === true
  );
}

function buildCandidateGroundingText(candidate: MemoryCandidate): string {
  const hints: string[] = [];

  if (candidate.kindHint === "profile" && candidate.metadata?.profileField) {
    hints.push(candidate.metadata.profileField);
  }

  if (candidate.kindHint === "fact" && candidate.metadata?.factKind) {
    hints.push(candidate.metadata.factKind);
  }

  if (candidate.kindHint === "reference" && candidate.metadata?.referenceKind) {
    hints.push(candidate.metadata.referenceKind);
  }

  if (candidate.kindHint === "feedback" && candidate.metadata?.feedbackKind) {
    hints.push(candidate.metadata.feedbackKind);
  }

  return [describeEpisodeCandidate(candidate), ...hints]
    .filter((value) => value.trim().length > 0)
    .join(" ");
}

function selectFollowThroughHighlights(
  assistantMessages: IndexedEpisodeMessage[],
  candidates: MemoryCandidate[],
  language: LanguageService,
  context: ResolvedLanguageContext | string,
): string[] {
  const candidateDetails = candidates.map((candidate) => ({
    grounding: buildCandidateGroundingText(candidate),
    highlight: describeEpisodeCandidate(candidate),
  }));

  const matchedHighlights = assistantMessages.flatMap(({ content }) => {
    const matchingCandidates = candidateDetails.filter(
      (candidate) =>
        language.tokenOverlap(content, candidate.grounding, context, {
          excludeStopwords: true,
        }) >= ASSISTANT_FOLLOW_THROUGH_OVERLAP_THRESHOLD,
    );

    if (matchingCandidates.length !== 1) {
      return [];
    }

    return [matchingCandidates[0]!.highlight];
  });

  return dedupeNonEmpty(matchedHighlights).slice(0, 2);
}

function buildEpisodeKeyDecisions(
  candidateHighlights: string[],
  language: LanguageService,
  context: ResolvedLanguageContext | string,
): string[] {
  return candidateHighlights
    .map((highlight) =>
      language.render({
        key: "episode_assistant_follow_through_on",
        values: { highlight },
      }, context)
    )
    .slice(0, 2);
}

function extractEpisodeUnresolvedItems(
  candidates: MemoryCandidate[],
  analyzeMessage: ResolveMessageAnalysis,
): string[] {
  const unresolvedCandidates = candidates
    .filter((candidate) => {
      if (
        candidate.kindHint === "fact" &&
        (candidate.metadata?.factKind === "blocker" ||
          candidate.metadata?.factKind === "open_loop")
      ) {
        return true;
      }

      return false;
    })
    .map((candidate) => candidate.content.trim());

  const languageDetected = candidates
    .filter((candidate) =>
      analyzeMessage(candidate.sourceMessageIndex)?.unresolved === true
    )
    .map((candidate) => candidate.content.trim());

  return dedupeNonEmpty([...unresolvedCandidates, ...languageDetected])
    .slice(0, 2);
}

function buildEpisodeTopics(
  candidates: MemoryCandidate[],
  language: LanguageService,
  context: ResolvedLanguageContext | string,
): string[] {
  return dedupeNonEmpty(candidates.map((candidate) => describeEpisodeCandidate(candidate)))
    .filter((topic) => language.tokenize(topic, context).length > 0)
    .slice(0, 2);
}

const MAX_EPISODE_SOURCE_MESSAGE_IDS = 32;

// Contributing messages are the candidate sources plus the assistant messages
// that justified the episode; the earliest of their observed times is the
// episode's event time (transaction time stays on createdAt).
function resolveEpisodeProvenance(
  messages: MemoryExtractionInput["messages"],
  contributingIndexes: ReadonlySet<number>,
): { observedAt?: string; sourceMessageIds?: string[] } {
  const contributing = [...contributingIndexes]
    .sort((left, right) => left - right)
    .map((index) => messages[index])
    .filter((message) => message !== undefined);
  const observedTimes = contributing
    .map((message) => message.observedAt)
    .filter(
      (value): value is string =>
        typeof value === "string" && Number.isFinite(Date.parse(value)),
    )
    .sort((left, right) => Date.parse(left) - Date.parse(right));
  const sourceMessageIds = [
    ...new Set(
      contributing
        .map((message) => message.id)
        .filter(
          (value): value is string =>
            typeof value === "string" && value.trim().length > 0,
        ),
    ),
  ].slice(0, MAX_EPISODE_SOURCE_MESSAGE_IDS);
  return {
    ...(observedTimes.length > 0 ? { observedAt: observedTimes[0] } : {}),
    ...(sourceMessageIds.length > 0 ? { sourceMessageIds } : {}),
  };
}

export function maybeBuildEpisode(
  input: MemoryExtractionInput,
  candidates: MemoryCandidate[],
  id: string,
  timestamp: string,
  language: LanguageService,
  locale: string,
  sourceAnalyses?: RememberSourceLanguageAnalyses,
): EpisodeMemory | null {
  const analyses = new Map(sourceAnalyses ?? []);
  const primaryMessageIndex = input.messages.findIndex(
    ({ role }) => role === "user",
  );
  const context = analyses.get(
    primaryMessageIndex >= 0 ? primaryMessageIndex : 0,
  )?.context ?? locale;
  const analyzeMessage: ResolveMessageAnalysis = (messageIndex) => {
    const cached = analyses.get(messageIndex);
    if (cached) {
      return cached.analysis;
    }
    const message = input.messages[messageIndex];
    if (!message) {
      return undefined;
    }
    const context = language.resolveFromText({
      locale: input.locale,
      text: message.content,
    });
    const analysis = language.analyzeContent(message.content, context);
    analyses.set(messageIndex, { analysis, context });
    return analysis;
  };
  const assistantMessages = selectSubstantiveAssistantMessages(
    input.messages,
    analyzeMessage,
  );
  const assistantContinuityMessages = selectAssistantContinuityMessages(
    assistantMessages,
    analyzeMessage,
  );
  const candidateHighlights = dedupeNonEmpty(
    candidates.map((candidate) => describeEpisodeCandidate(candidate)),
  ).slice(0, 2);
  const followThroughHighlights = selectFollowThroughHighlights(
    assistantContinuityMessages,
    candidates,
    language,
    context,
  );
  const hasAssistantContribution =
    assistantContinuityMessages.length > 0 || followThroughHighlights.length > 0;

  if (candidateHighlights.length === 0 || !hasAssistantContribution) {
    return null;
  }

  const summarySegments = [...candidateHighlights];
  summarySegments.push(
    followThroughHighlights.length > 0
      ? language.render(
        { key: "episode_assistant_follow_through_captured" },
        context,
      )
      : language.render(
        { key: "episode_assistant_substantive_continuity_captured" },
        context,
      ),
  );

  const provenance = resolveEpisodeProvenance(
    input.messages,
    new Set([
      ...candidates.map((candidate) => candidate.sourceMessageIndex),
      ...assistantContinuityMessages.map(
        ({ sourceMessageIndex }) => sourceMessageIndex,
      ),
    ]),
  );

  return createEpisodeMemory({
    id,
    userId: input.scope.userId,
    tenantId: input.scope.tenantId,
    workspaceId: input.scope.workspaceId,
    agentId: input.scope.agentId,
    sessionId: input.scope.sessionId,
    ...provenance,
    summary: language.render({
      key: "episode_conversation_covered",
      values: { segments: summarySegments.join(" / ") },
    }, context),
    keyDecisions: buildEpisodeKeyDecisions(
      followThroughHighlights,
      language,
      context,
    ),
    unresolvedItems: extractEpisodeUnresolvedItems(
      candidates,
      analyzeMessage,
    ),
    topics: buildEpisodeTopics(candidates, language, context),
    importance: 0.7,
    confidence: 0.8,
    locale,
    createdAt: timestamp,
  });
}
