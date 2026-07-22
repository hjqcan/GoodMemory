import type {
  EpisodeMemory,
  FactKind,
  FactMemory,
  FeedbackMemory,
  PreferenceMemory,
  ReferenceMemory,
  SessionJournal,
  UserProfile,
  WorkingMemorySnapshot,
} from "../domain/records";
import type { EvidenceRecord } from "../evidence/contracts";
import { createLanguageService } from "../language";
import type {
  LanguageRenderKey,
  LanguageService,
  ResolvedLanguageContext,
} from "../language";
import { isSteeringOnlyBehavioralPolicy } from "../evolution/behavioralPolicy";
import type { SessionArchive } from "../domain/evolutionRecords";
import {
  estimateTextTokens,
  truncateTextToEstimatedTokens,
} from "../tokenEstimator";
import { FEEDBACK_RECALL_LIMIT } from "./budgets";
import type { RetrievalProfile, RoutingDecision } from "./router";

const FACT_SUMMARY_LIMIT = 6;

const CONTEXT_RENDER_KEYS = [
  "active_context",
  "additional_project_state",
  "archive",
  "correction",
  "current_goal",
  "current_projects",
  "current_state",
  "deferred_follow_up",
  "developer_memory_notes",
  "durable_memory",
  "episode",
  "episode_item",
  "evidence",
  "fact",
  "fact_item",
  "feedback",
  "file_evidence",
  "goals",
  "immediate_next_steps",
  "journal",
  "key_decisions",
  "open_loops",
  "omitted_sections",
  "preference",
  "procedural_memory",
  "profile",
  "recent_worklog",
  "reference",
  "reference_item",
  "session_archive_item",
  "tool_result",
  "verification",
  "user_memory_context",
  "working_memory",
] as const satisfies readonly LanguageRenderKey[];

type MemoryPacketRenderKey = (typeof CONTEXT_RENDER_KEYS)[number];
type MemoryPacketRenderLabels = Record<MemoryPacketRenderKey, string>;

function buildRenderLabels(
  language: LanguageService,
  locale?: string,
  languageContext?: ResolvedLanguageContext,
): { labels: MemoryPacketRenderLabels; languagePackId: string; locale: string } {
  const context = languageContext ?? language.resolveFromText({
    ...(locale ? { locale } : {}),
    text: "",
  });
  return {
    labels: Object.fromEntries(
      CONTEXT_RENDER_KEYS.map((key) => [key, language.render({ key }, context)]),
    ) as MemoryPacketRenderLabels,
    languagePackId: context.languagePackId,
    locale: locale ?? context.locale,
  };
}

export interface MemoryPacket {
  locale?: string;
  languagePackId?: string;
  renderLabels?: MemoryPacketRenderLabels;
  profileSummary?: string;
  activeContextSummary?: string;
  durableMemorySummary?: string;
  preferenceSummary?: string;
  referenceSummary?: string;
  factSummary?: string;
  feedbackSummary?: string;
  episodeSummary?: string;
  archiveSummary?: string;
  evidenceSummary?: string;
  workingMemorySummary?: string;
  journalSummary?: string;
  renderingProfile?: RetrievalProfile;
  renderBudget?: {
    maxTokens: number;
  };
  debug?: {
    omittedSections: string[];
    estimatedTokens: number;
  };
}

export interface MemoryPacketInput {
  profile: UserProfile | null;
  preferences: PreferenceMemory[];
  references: ReferenceMemory[];
  facts: FactMemory[];
  feedback: FeedbackMemory[];
  episodes: EpisodeMemory[];
  archives: SessionArchive[];
  evidence: EvidenceRecord[];
  workingMemory: WorkingMemorySnapshot | null;
  journal: SessionJournal | null;
  durableCandidateOrder?: string[];
  maxRenderedTokens?: number;
  locale?: string;
  language?: LanguageService;
  languageContext?: ResolvedLanguageContext;
  languagePackId?: string;
  renderLabels?: MemoryPacketRenderLabels;
  routingDecision?: RoutingDecision;
}

function resolvePacketLanguage(input: MemoryPacketInput): {
  labels: MemoryPacketRenderLabels;
  language: LanguageService;
  languagePackId: string;
  locale: string;
} {
  const language = input.language ?? createLanguageService();
  const rendered = buildRenderLabels(
    language,
    input.locale,
    input.languageContext,
  );
  return {
    labels: input.renderLabels ?? rendered.labels,
    language,
    languagePackId: input.languagePackId ?? rendered.languagePackId,
    locale: rendered.locale,
  };
}

const EVIDENCE_EXCERPT_SUMMARY_LENGTH = 120;

function tokenCountUpperBound(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function clipToTokenUpperBound(value: string, maxTokens: number): string {
  if (tokenCountUpperBound(value) <= maxTokens) return value;
  const characters: string[] = [];
  let bytes = 0;
  for (const character of value) {
    const nextBytes = new TextEncoder().encode(character).byteLength;
    if (bytes + nextBytes > maxTokens) break;
    characters.push(character);
    bytes += nextBytes;
  }
  return characters.join("");
}

function summarizeProfile(profile: UserProfile | null): string | undefined {
  if (!profile) {
    return undefined;
  }

  const segments = [
    profile.identity.name,
    profile.identity.role,
    profile.identity.organization,
    profile.identity.location,
    profile.identity.timezone,
    profile.identity.languagePreference,
  ].filter(Boolean);
  return segments.length > 0 ? segments.join(" - ") : undefined;
}

function summarizeActiveContext(
  profile: UserProfile | null,
  labels: MemoryPacketRenderLabels,
): string | undefined {
  if (!profile) {
    return undefined;
  }

  const segments = [
    profile.activeContext.currentProjects.length > 0
      ? `${labels.current_projects}: ${profile.activeContext.currentProjects.join(", ")}`
      : undefined,
    profile.activeContext.goals.length > 0
      ? `${labels.goals}: ${profile.activeContext.goals.join(", ")}`
      : undefined,
  ].filter(Boolean);

  return segments.length > 0 ? segments.join("\n") : undefined;
}

function inferFactKindForSummary(
  fact: FactMemory,
  language: LanguageService,
  locale: string,
): FactKind | undefined {
  if (fact.factKind) {
    return fact.factKind;
  }

  const context = language.resolveFromText({
    locale: fact.source.locale ?? locale,
    text: fact.content,
  });
  const analysis = language.analyzeContent(fact.content, context);
  if (analysis.blockerFact) {
    return "blocker";
  }
  if (analysis.openLoopFact) {
    return "open_loop";
  }
  if (analysis.focusFact) {
    return "focus_update";
  }
  if (analysis.projectStateFact) {
    return "project_state";
  }

  return undefined;
}

function shouldGroupProjectStateSupport(routingDecision?: RoutingDecision): boolean {
  if (!routingDecision) {
    return false;
  }

  return (
    routingDecision.supportSlots.includes("project_state_support") &&
    !routingDecision.requestedSlots.includes("blocker") &&
    !routingDecision.requestedSlots.includes("open_loop")
  );
}

function summarizeFacts(
  facts: FactMemory[],
  labels: MemoryPacketRenderLabels,
  language: LanguageService,
  locale: string,
  routingDecision?: RoutingDecision,
): string | undefined {
  const activeFacts = facts
    .filter((fact) => fact.lifecycle === "active")
    .slice(0, FACT_SUMMARY_LIMIT);
  if (activeFacts.length === 0) {
    return undefined;
  }

  if (!shouldGroupProjectStateSupport(routingDecision)) {
    return activeFacts.map((fact) => `- ${fact.content}`).join("\n");
  }

  const immediate: string[] = [];
  const deferred: string[] = [];
  const additional: string[] = [];
  for (const fact of activeFacts) {
    const factKind = inferFactKindForSummary(fact, language, locale);

    if (factKind === "blocker" || factKind === "project_state") {
      immediate.push(`- ${fact.content}`);
      continue;
    }
    if (factKind === "open_loop") {
      deferred.push(`- ${fact.content}`);
      continue;
    }

    additional.push(`- ${fact.content}`);
  }

  const segments: string[] = [];
  if (immediate.length > 0) {
    segments.push(`${labels.immediate_next_steps}:`, ...immediate);
  }
  if (deferred.length > 0) {
    segments.push(`${labels.deferred_follow_up}:`, ...deferred);
  }
  if (additional.length > 0) {
    segments.push(`${labels.additional_project_state}:`, ...additional);
  }

  if (segments.length === 0) {
    return undefined;
  }

  return segments.join("\n");
}

function summarizePreferences(preferences: PreferenceMemory[]): string | undefined {
  const activePreferences = preferences.filter(
    (preference) => (preference.lifecycle ?? "active") === "active",
  );
  if (activePreferences.length === 0) {
    return undefined;
  }

  return activePreferences
    .slice(0, 3)
    .map((preference) => `- ${preference.category}: ${String(preference.value)}`)
    .join("\n");
}

function summarizeReferences(references: ReferenceMemory[]): string | undefined {
  if (references.length === 0) {
    return undefined;
  }

  return references
    .slice(0, 3)
    .map((reference) => `- ${reference.title} (${reference.pointer})`)
    .join("\n");
}

function summarizeFeedback(feedback: FeedbackMemory[]): string | undefined {
  const activeFeedback = feedback
    .filter((item) =>
      item.lifecycle === "active" && !isSteeringOnlyBehavioralPolicy(item)
    )
    .slice(0, FEEDBACK_RECALL_LIMIT);
  if (activeFeedback.length === 0) {
    return undefined;
  }
  const seenRules = new Set<string>();
  const rendered: string[] = [];

  for (const item of activeFeedback) {
    const normalizedRule = item.rule.trim().toLowerCase();
    if (seenRules.has(normalizedRule)) {
      continue;
    }

    seenRules.add(normalizedRule);
    rendered.push(`- ${item.rule}`);
  }

  return rendered.join("\n");
}

function clipSummaryText(content: string, maxLength: number): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 3)}...`;
}

function summarizeEvidenceRecord(
  record: EvidenceRecord,
  labels: MemoryPacketRenderLabels,
): string {
  const excerpt = clipSummaryText(record.excerpt, EVIDENCE_EXCERPT_SUMMARY_LENGTH);

  if (record.kind === "correction_context") {
    return `${labels.correction}: ${excerpt}`;
  }
  if (record.kind === "verification_result") {
    return `${labels.verification}: ${excerpt}`;
  }
  if (record.kind === "tool_result_excerpt") {
    return `${labels.tool_result}: ${excerpt}`;
  }
  if (record.kind === "document_excerpt") {
    return `${labels.file_evidence}: ${excerpt}`;
  }

  return excerpt;
}

function summarizeEpisodes(episodes: EpisodeMemory[]): string | undefined {
  if (episodes.length === 0) {
    return undefined;
  }

  return episodes
    .slice(0, 2)
    .map((episode) => `- ${episode.summary}`)
    .join("\n");
}

function renderArchiveSummary(
  archive: SessionArchive,
  labels: MemoryPacketRenderLabels,
): string {
  const segments = [archive.summary];

  if (archive.unresolvedItems.length > 0) {
    segments.push(`${labels.open_loops}: ${archive.unresolvedItems.join(", ")}`);
  }
  if (archive.keyDecisions.length > 0) {
    segments.push(`${labels.key_decisions}: ${archive.keyDecisions.join(", ")}`);
  }

  return segments.join(" ").trim();
}

function summarizeArchives(
  archives: SessionArchive[],
  labels: MemoryPacketRenderLabels,
): string | undefined {
  if (archives.length === 0) {
    return undefined;
  }

  return archives
    .slice(0, 2)
    .map((archive) => `- ${renderArchiveSummary(archive, labels)}`)
    .join("\n");
}

function summarizeDurableMemory(input: {
  archives: SessionArchive[];
  candidateOrder?: string[];
  episodes: EpisodeMemory[];
  facts: FactMemory[];
  labels: MemoryPacketRenderLabels;
  references: ReferenceMemory[];
}): string | undefined {
  if (!input.candidateOrder || input.candidateOrder.length === 0) {
    return undefined;
  }

  const candidatesByKey = new Map<string, string>();
  const addCandidate = (key: string, summary: string) => {
    candidatesByKey.set(key, summary);
  };
  for (const fact of input.facts.filter((item) => item.lifecycle === "active")) {
    addCandidate(
      `facts:${fact.id}`,
      `${input.labels.fact_item}: ${fact.content}`,
    );
  }
  for (const reference of input.references) {
    addCandidate(
      `references:${reference.id}`,
      `${input.labels.reference_item}: ${reference.title} (${reference.pointer})`,
    );
  }
  for (const archive of input.archives) {
    addCandidate(
      `session_archives:${archive.id}`,
      `${input.labels.session_archive_item}: ${renderArchiveSummary(archive, input.labels)}`,
    );
  }
  for (const episode of input.episodes) {
    addCandidate(
      `episodes:${episode.id}`,
      `${input.labels.episode_item}: ${episode.summary}`,
    );
  }

  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const candidateId of input.candidateOrder) {
    const candidate = candidatesByKey.get(candidateId);
    if (!candidate || seen.has(candidateId)) {
      continue;
    }

    ordered.push(`- ${candidate}`);
    seen.add(candidateId);
  }

  for (const [candidateKey, candidate] of candidatesByKey) {
    if (seen.has(candidateKey)) {
      continue;
    }

    ordered.push(`- ${candidate}`);
  }

  return ordered.length > 0 ? ordered.join("\n") : undefined;
}

function summarizeEvidence(
  evidence: EvidenceRecord[],
  labels: MemoryPacketRenderLabels,
): string | undefined {
  if (evidence.length === 0) {
    return undefined;
  }

  return evidence
    .slice(0, 3)
    .map((record) => `- ${summarizeEvidenceRecord(record, labels)}`)
    .join("\n");
}

function summarizeWorkingMemory(
  workingMemory: WorkingMemorySnapshot | null,
  labels: MemoryPacketRenderLabels,
): string | undefined {
  if (!workingMemory) {
    return undefined;
  }

  const segments: string[] = [];
  if (workingMemory.currentGoal) {
    segments.push(`${labels.current_goal}: ${workingMemory.currentGoal}`);
  }
  if (workingMemory.openLoops.length > 0) {
    segments.push(`${labels.open_loops}: ${workingMemory.openLoops.join(", ")}`);
  }

  return segments.length > 0 ? segments.join("\n") : undefined;
}

function summarizeJournal(
  journal: SessionJournal | null,
  labels: MemoryPacketRenderLabels,
): string | undefined {
  if (!journal) {
    return undefined;
  }

  const segments = [
    journal.currentState
      ? `${labels.current_state}: ${journal.currentState}`
      : undefined,
    !journal.currentState && journal.worklog.length > 0
      ? `${labels.recent_worklog}: ${journal.worklog.slice(-1).join(" | ")}`
      : undefined,
  ].filter(Boolean);

  return segments.length > 0 ? segments.join("\n") : undefined;
}

export function buildMemoryPacket(input: MemoryPacketInput): MemoryPacket {
  const packetLanguage = resolvePacketLanguage(input);
  const { labels, language, languagePackId, locale } = packetLanguage;
  const packet: MemoryPacket = {
    locale,
    languagePackId,
    renderLabels: labels,
    profileSummary: summarizeProfile(input.profile),
    activeContextSummary: summarizeActiveContext(input.profile, labels),
    durableMemorySummary: summarizeDurableMemory({
      archives: input.archives,
      candidateOrder: input.durableCandidateOrder,
      episodes: input.episodes,
      facts: input.facts,
      labels,
      references: input.references,
    }),
    preferenceSummary: summarizePreferences(input.preferences),
    referenceSummary: summarizeReferences(input.references),
    factSummary: summarizeFacts(
      input.facts,
      labels,
      language,
      locale,
      input.routingDecision,
    ),
    feedbackSummary: summarizeFeedback(input.feedback),
    episodeSummary: summarizeEpisodes(input.episodes),
    archiveSummary: summarizeArchives(input.archives, labels),
    evidenceSummary: summarizeEvidence(input.evidence, labels),
    workingMemorySummary: summarizeWorkingMemory(input.workingMemory, labels),
    journalSummary: summarizeJournal(input.journal, labels),
    renderingProfile: input.routingDecision?.retrievalProfile,
    ...(input.maxRenderedTokens !== undefined
      ? { renderBudget: { maxTokens: input.maxRenderedTokens } }
      : {}),
  };

  packet.debug = {
    omittedSections: [],
    estimatedTokens: estimateTextTokens(JSON.stringify(packet)),
  };

  return packet;
}

export function rebuildMemoryPacket(
  source: MemoryPacket,
  input: Omit<MemoryPacketInput, "language" | "maxRenderedTokens"> & {
    language: LanguageService;
  },
): MemoryPacket {
  return buildMemoryPacket({
    ...input,
    languagePackId: source.languagePackId,
    maxRenderedTokens: source.renderBudget?.maxTokens,
    renderLabels: source.renderLabels,
  });
}

function trimSections(
  sections: Array<{ title: string; body: string }>,
  maxTokens?: number,
) {
  if (!maxTokens) {
    return {
      sections,
      omittedSections: [],
    };
  }

  const kept: typeof sections = [];
  const omittedSections: string[] = [];
  let tokens = 0;

  for (const section of sections) {
    const sectionText = `## ${section.title}\n${section.body}`;
    const nextTokens = tokens + estimateTextTokens(sectionText);

    if (nextTokens > maxTokens) {
      if (kept.length === 0) {
        const prefix = `## ${section.title}\n`;
        const clippedSection = truncateTextToEstimatedTokens(
          sectionText,
          maxTokens,
        );
        const body = clippedSection.startsWith(prefix)
          ? clippedSection.slice(prefix.length)
          : "";
        if (body.length > 0) {
          kept.push({ ...section, body });
        } else {
          omittedSections.push(section.title);
        }
        tokens = estimateTextTokens(clippedSection);
        continue;
      }
      omittedSections.push(section.title);
      continue;
    }

    kept.push(section);
    tokens = nextTokens;
  }

  return {
    sections: kept,
    omittedSections,
  };
}

function buildRenderableSections(
  packet: MemoryPacket,
  renderingProfileOverride?: RetrievalProfile,
) {
  const labels = packet.renderLabels ?? buildRenderLabels(
    createLanguageService(),
    packet.locale,
  ).labels;
  const durableMemorySections = packet.durableMemorySummary
    ? [
        {
          key: "durableMemorySummary" as const,
          title: labels.durable_memory,
          body: packet.durableMemorySummary,
        },
      ]
    : [
        {
          key: "factSummary" as const,
          title: labels.fact,
          body: packet.factSummary,
        },
        {
          key: "referenceSummary" as const,
          title: labels.reference,
          body: packet.referenceSummary,
        },
        {
          key: "episodeSummary" as const,
          title: labels.episode,
          body: packet.episodeSummary,
        },
        {
          key: "archiveSummary" as const,
          title: labels.archive,
          body: packet.archiveSummary,
        },
      ];

  const renderingProfile = renderingProfileOverride ?? packet.renderingProfile;

  if (renderingProfile === "coding_agent") {
    return [
      {
        key: "feedbackSummary" as const,
        title: labels.procedural_memory,
        body: packet.feedbackSummary,
      },
      {
        key: "workingMemorySummary" as const,
        title: labels.working_memory,
        body: packet.workingMemorySummary,
      },
      {
        key: "journalSummary" as const,
        title: labels.journal,
        body: packet.journalSummary,
      },
      {
        key: "evidenceSummary" as const,
        title: labels.evidence,
        body: packet.evidenceSummary,
      },
      ...durableMemorySections,
      {
        key: "profileSummary" as const,
        title: labels.profile,
        body: packet.profileSummary,
      },
      {
        key: "activeContextSummary" as const,
        title: labels.active_context,
        body: packet.activeContextSummary,
      },
      {
        key: "preferenceSummary" as const,
        title: labels.preference,
        body: packet.preferenceSummary,
      },
    ].filter(
      (
        section,
      ): section is {
        key:
          | "profileSummary"
          | "activeContextSummary"
          | "durableMemorySummary"
          | "feedbackSummary"
          | "preferenceSummary"
          | "referenceSummary"
          | "factSummary"
          | "episodeSummary"
          | "archiveSummary"
          | "evidenceSummary"
          | "workingMemorySummary"
          | "journalSummary";
        title: string;
        body: string;
      } => Boolean(section.body),
    );
  }

  return [
    {
      key: "profileSummary" as const,
      title: labels.profile,
      body: packet.profileSummary,
    },
    {
      key: "activeContextSummary" as const,
      title: labels.active_context,
      body: packet.activeContextSummary,
    },
    ...durableMemorySections,
    {
      key: "feedbackSummary" as const,
      title: labels.procedural_memory,
      body: packet.feedbackSummary,
    },
    {
      key: "preferenceSummary" as const,
      title: labels.preference,
      body: packet.preferenceSummary,
    },
    {
      key: "workingMemorySummary" as const,
      title: labels.working_memory,
      body: packet.workingMemorySummary,
    },
    {
      key: "journalSummary" as const,
      title: labels.journal,
      body: packet.journalSummary,
    },
    {
      key: "evidenceSummary" as const,
      title: labels.evidence,
      body: packet.evidenceSummary,
    },
  ].filter(
    (
      section,
    ): section is {
      key:
        | "profileSummary"
        | "activeContextSummary"
        | "durableMemorySummary"
        | "feedbackSummary"
        | "preferenceSummary"
        | "referenceSummary"
        | "factSummary"
        | "episodeSummary"
        | "archiveSummary"
        | "evidenceSummary"
        | "workingMemorySummary"
        | "journalSummary";
      title: string;
      body: string;
    } => Boolean(section.body),
  );
}

// Opt-in (off by default so benchmark rendering is byte-identical): drop
// evidence bullet lines whose text is already shown verbatim under Facts. This
// only fires for verbatim (rules-only) writes where a fact and its provenance
// evidence carry identical content; distilled evidence (different text) is
// preserved. Operates on the structured section bodies before flattening.
function suppressEvidenceDuplicatingFacts<
  T extends { key: string; body: string },
>(sections: T[]): T[] {
  const facts = sections.find((section) => section.key === "factSummary");
  if (!facts?.body) {
    return sections;
  }
  const factLines = new Set(
    facts.body
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  );
  return sections.flatMap((section) => {
    if (section.key !== "evidenceSummary" || !section.body) {
      return [section];
    }
    const kept = section.body
      .split("\n")
      .filter((line) => !factLines.has(line.trim()));
    if (kept.length === 0) {
      return [];
    }
    return [{ ...section, body: kept.join("\n") }];
  });
}

export function renderMemoryPacket(
  packet: MemoryPacket,
  output: "json" | "markdown" | "system_prompt_fragment" | "developer_prompt_fragment",
  maxTokens?: number,
  renderingProfileOverride?: RetrievalProfile,
  options?: { suppressDuplicateEvidence?: boolean },
): { content: string; estimatedTokens: number; omittedSections: string[] } {
  const labels = packet.renderLabels ?? buildRenderLabels(
    createLanguageService(),
    packet.locale,
  ).labels;
  const packetMaxTokens = packet.renderBudget?.maxTokens;
  const effectiveMaxTokens = packetMaxTokens && maxTokens
    ? Math.min(packetMaxTokens, maxTokens)
    : packetMaxTokens ?? maxTokens;
  const hardByteLimit = packetMaxTokens === undefined
    ? undefined
    : maxTokens === undefined
    ? packetMaxTokens
    : Math.min(packetMaxTokens, maxTokens * 4);
  const exceedsBudget = (content: string): boolean =>
    effectiveMaxTokens !== undefined && (
      hardByteLimit !== undefined
        ? tokenCountUpperBound(content) > hardByteLimit
        : estimateTextTokens(content) > effectiveMaxTokens
    );
  const enforceTextBudget = (content: string): string =>
    effectiveMaxTokens && exceedsBudget(content)
      ? hardByteLimit !== undefined
        ? clipToTokenUpperBound(content, hardByteLimit)
        : truncateTextToEstimatedTokens(content, effectiveMaxTokens)
      : content;
  const sections = options?.suppressDuplicateEvidence
    ? suppressEvidenceDuplicatingFacts(
        buildRenderableSections(packet, renderingProfileOverride),
      )
    : buildRenderableSections(packet, renderingProfileOverride);
  const { sections: kept, omittedSections } = trimSections(
    sections.map(({ title, body }) => ({ title, body })),
    effectiveMaxTokens,
  );

  if (output === "json") {
    const keptTitles = new Set(kept.map((section) => section.title));
    const trimmedPacket: MemoryPacket = {
      ...(packet.locale ? { locale: packet.locale } : {}),
      ...(packet.languagePackId
        ? { languagePackId: packet.languagePackId }
        : {}),
      renderingProfile: renderingProfileOverride ?? packet.renderingProfile,
      ...(packet.renderBudget ? { renderBudget: packet.renderBudget } : {}),
      debug: {
        omittedSections,
        estimatedTokens: 0,
      },
    };

    for (const section of sections) {
      if (!keptTitles.has(section.title)) {
        continue;
      }

      trimmedPacket[section.key] = section.body;
    }

    if (packetMaxTokens === undefined) {
      const content = JSON.stringify(trimmedPacket);
      trimmedPacket.debug = {
        omittedSections,
        estimatedTokens: estimateTextTokens(content),
      };
      return {
        content: JSON.stringify(trimmedPacket),
        estimatedTokens: trimmedPacket.debug.estimatedTokens,
        omittedSections,
      };
    }

    const serialize = (): string => {
      trimmedPacket.debug = {
        omittedSections: [...new Set(omittedSections)],
        estimatedTokens: 0,
      };
      const draft = JSON.stringify(trimmedPacket);
      trimmedPacket.debug.estimatedTokens = estimateTextTokens(draft);
      return JSON.stringify(trimmedPacket);
    };
    let content = serialize();
    const keptEntries = sections.filter((section) =>
      keptTitles.has(section.title)
    );
    while (
      effectiveMaxTokens &&
      exceedsBudget(content) &&
      keptEntries.length > 0
    ) {
      const entry = keptEntries.at(-1)!;
      const body = trimmedPacket[entry.key];
      const excessChars = effectiveMaxTokens === undefined
        ? 0
        : content.length - (hardByteLimit ?? effectiveMaxTokens * 4);
      if (
        typeof body === "string" &&
        (packetMaxTokens !== undefined
          ? body.length > 1
          : body.length > excessChars + 4)
      ) {
        trimmedPacket[entry.key] = packetMaxTokens !== undefined
          ? body.slice(0, Math.floor(body.length / 2))
          : body.slice(0, Math.max(0, body.length - excessChars - 4));
      } else {
        delete trimmedPacket[entry.key];
        keptEntries.pop();
        omittedSections.push(entry.title);
      }
      content = serialize();
    }
    if (
      effectiveMaxTokens &&
      exceedsBudget(content)
    ) {
      content = "{}";
    }

    return {
      content,
      estimatedTokens: estimateTextTokens(content),
      omittedSections: [...new Set(omittedSections)],
    };
  }

  const markdownContent = kept
    .map((section) => `## ${section.title}\n${section.body}`)
    .join("\n\n");

  if (output === "markdown") {
    const content = enforceTextBudget(markdownContent);
    return {
      content,
      estimatedTokens: estimateTextTokens(content),
      omittedSections,
    };
  }

  if (output === "system_prompt_fragment") {
    const content = enforceTextBudget([
      labels.user_memory_context,
      ...kept.map((section) => `${section.title}: ${section.body.replace(/\n/g, " ")}`),
    ].join("\n"));

    return {
      content,
      estimatedTokens: estimateTextTokens(content),
      omittedSections,
    };
  }

  const content = enforceTextBudget([
    labels.developer_memory_notes,
    ...kept.map((section) => `${section.title}: ${section.body.replace(/\n/g, " ")}`),
    omittedSections.length > 0
      ? labels.omitted_sections.replace("{sections}", omittedSections.join(", "))
      : undefined,
  ]
    .filter(Boolean)
    .join("\n"));

  return {
    content,
    estimatedTokens: estimateTextTokens(content),
    omittedSections,
  };
}
