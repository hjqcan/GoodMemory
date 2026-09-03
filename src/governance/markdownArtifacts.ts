import {
  type ArtifactSpillRecord,
  type EpisodeMemory,
  type FactMemory,
  type FeedbackMemory,
  type PreferenceMemory,
  type NoteMemory,
  type ReferenceMemory,
  type SessionJournal,
  type UserProfile,
  type WorkingMemorySnapshot,
  resolveMemoryLifecycle,
} from "../domain/records";
import type { MemoryScope } from "../domain/scope";
import type { MemoryLifecycleState } from "../domain/provenance";
import type { EvidenceRecord } from "../evidence/contracts";
import type {
  ExperienceRecord,
  LearningProposal,
  PromotionRecord,
  SessionArchive,
} from "../evolution/contracts";
import type {
  LanguageRenderKey,
  LanguageService,
  ResolvedLanguageContext,
} from "../language";

export interface MarkdownArtifactFile {
  content: string;
  kind: "archive" | "memory" | "playbook" | "session" | "topic" | "user";
  relativePath: string;
  sessionId?: string;
}

export interface MarkdownArtifactBundle {
  files: MarkdownArtifactFile[];
  rootPath: string;
}

interface MarkdownArtifactInput {
  language: LanguageService;
  languageContext: ResolvedLanguageContext;
  scope: MemoryScope;
  durable: {
    profile: UserProfile | null;
    preferences: PreferenceMemory[];
    references: ReferenceMemory[];
    notes?: NoteMemory[];
    facts: FactMemory[];
    feedback: FeedbackMemory[];
    episodes: EpisodeMemory[];
    archives: SessionArchive[];
    evidence: EvidenceRecord[];
    experiences: ExperienceRecord[];
    proposals: LearningProposal[];
    promotions: PromotionRecord[];
  };
  runtime?: {
    workingMemory: WorkingMemorySnapshot | null;
    journal: SessionJournal | null;
    spills: ArtifactSpillRecord[];
  };
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

function sanitizeMarkdownInline(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\t/g, "\\t")
    .replace(/\r\n?/g, "\n")
    .replace(/\n/g, "\\n");
}

function buildRootPath(scope: MemoryScope): string {
  const segments = [".goodmemory", "users", encodeURIComponent(scope.userId)];

  if (scope.tenantId) {
    segments.push("tenants", encodeURIComponent(scope.tenantId));
  }
  if (scope.workspaceId) {
    segments.push("workspaces", encodeURIComponent(scope.workspaceId));
  }
  if (scope.agentId) {
    segments.push("agents", encodeURIComponent(scope.agentId));
  }
  if (scope.sessionId) {
    segments.push("sessions", encodeURIComponent(scope.sessionId));
  }

  return segments.join("/");
}

function renderSection(
  title: string,
  lines: string[],
  emptyLabel = "none",
): string {
  return [
    `## ${sanitizeMarkdownInline(title)}`,
    ...(lines.length > 0 ? lines : [`- ${sanitizeMarkdownInline(emptyLabel)}`]),
  ].join("\n");
}

function renderLabel(
  input: MarkdownArtifactInput,
  key: LanguageRenderKey,
  values?: Record<string, number | string>,
): string {
  return input.language.render(
    { key, ...(values ? { values } : {}) },
    input.languageContext,
  );
}

function renderLocalizedSection(
  input: MarkdownArtifactInput,
  key: LanguageRenderKey,
  lines: string[],
): string {
  return renderSection(
    renderLabel(input, key),
    lines,
    renderLabel(input, "none"),
  );
}

function renderOptionalPlaybookSection(
  input: MarkdownArtifactInput,
  key: LanguageRenderKey,
  lines: string[],
): string {
  return [
    `## ${sanitizeMarkdownInline(renderLabel(input, key))}`,
    ...(lines.length > 0 ? lines : ["<!-- intentionally empty -->"]),
  ].join("\n");
}

function renderDocument(title: string, sections: string[]): string {
  const kept = sections.filter((section) => section.trim().length > 0);

  return [`# ${sanitizeMarkdownInline(title)}`, ...kept.flatMap((section) => ["", section])].join("\n");
}

function renderProfileLines(
  input: MarkdownArtifactInput,
  profile: UserProfile | null,
): string[] {
  if (!profile) {
    return [];
  }

  return [
    profile.identity.name
      ? `- ${renderLabel(input, "name")}: ${sanitizeMarkdownInline(profile.identity.name)}`
      : undefined,
    profile.identity.role
      ? `- ${renderLabel(input, "role_label")}: ${sanitizeMarkdownInline(profile.identity.role)}`
      : undefined,
    profile.identity.organization
      ? `- ${renderLabel(input, "organization")}: ${sanitizeMarkdownInline(profile.identity.organization)}`
      : undefined,
    profile.identity.location
      ? `- ${renderLabel(input, "location")}: ${sanitizeMarkdownInline(profile.identity.location)}`
      : undefined,
    profile.identity.timezone
      ? `- ${renderLabel(input, "timezone")}: ${sanitizeMarkdownInline(profile.identity.timezone)}`
      : undefined,
    profile.identity.languagePreference
      ? `- ${renderLabel(input, "language_label")}: ${sanitizeMarkdownInline(profile.identity.languagePreference)}`
      : undefined,
  ].filter((line): line is string => Boolean(line));
}

function renderActiveContextLines(
  input: MarkdownArtifactInput,
  profile: UserProfile | null,
): string[] {
  if (!profile) {
    return [];
  }

  return [
    ...profile.activeContext.currentProjects.map(
      (project) =>
        `- ${renderLabel(input, "current_projects")}: ${sanitizeMarkdownInline(project)}`,
    ),
    ...profile.activeContext.goals.map(
      (goal) => `- ${renderLabel(input, "goals")}: ${sanitizeMarkdownInline(goal)}`,
    ),
  ];
}

function sortPreferences(preferences: PreferenceMemory[]): PreferenceMemory[] {
  return [...preferences].sort((left, right) => {
    const leftLifecycle = resolveMemoryLifecycle(left);
    const rightLifecycle = resolveMemoryLifecycle(right);
    if (leftLifecycle !== rightLifecycle) {
      return leftLifecycle === "active" ? -1 : 1;
    }

    const updated = right.updatedAt.localeCompare(left.updatedAt);
    if (updated !== 0) {
      return updated;
    }

    return compareStrings(left.category, right.category);
  });
}

function sortFacts(facts: FactMemory[]): FactMemory[] {
  return [...facts].sort((left, right) => {
    const leftLifecycle = resolveMemoryLifecycle(left);
    const rightLifecycle = resolveMemoryLifecycle(right);
    if (leftLifecycle !== rightLifecycle) {
      return leftLifecycle === "active" ? -1 : 1;
    }

    const updated = right.updatedAt.localeCompare(left.updatedAt);
    if (updated !== 0) {
      return updated;
    }

    return compareStrings(left.content, right.content);
  });
}

function sortReferences(references: ReferenceMemory[]): ReferenceMemory[] {
  return [...references].sort((left, right) => {
    const leftLifecycle = resolveMemoryLifecycle(left);
    const rightLifecycle = resolveMemoryLifecycle(right);
    if (leftLifecycle !== rightLifecycle) {
      return leftLifecycle === "active" ? -1 : 1;
    }

    const updated = right.updatedAt.localeCompare(left.updatedAt);
    if (updated !== 0) {
      return updated;
    }

    return compareStrings(left.pointer, right.pointer);
  });
}

function sortFeedback(feedback: FeedbackMemory[]): FeedbackMemory[] {
  return [...feedback].sort((left, right) => {
    const leftLifecycle = resolveMemoryLifecycle(left);
    const rightLifecycle = resolveMemoryLifecycle(right);
    if (leftLifecycle !== rightLifecycle) {
      return leftLifecycle === "active" ? -1 : 1;
    }

    const updated = right.updatedAt.localeCompare(left.updatedAt);
    if (updated !== 0) {
      return updated;
    }

    return compareStrings(left.rule, right.rule);
  });
}

function sortEpisodes(episodes: EpisodeMemory[]): EpisodeMemory[] {
  return [...episodes].sort((left, right) => {
    const created = right.createdAt.localeCompare(left.createdAt);
    if (created !== 0) {
      return created;
    }

    return compareStrings(left.summary, right.summary);
  });
}

function sortArchives(archives: SessionArchive[]): SessionArchive[] {
  return [...archives].sort((left, right) => {
    const archived = right.archivedAt.localeCompare(left.archivedAt);
    if (archived !== 0) {
      return archived;
    }

    return compareStrings(left.sessionId, right.sessionId);
  });
}

function sortEvidence(evidence: EvidenceRecord[]): EvidenceRecord[] {
  return [...evidence].sort((left, right) => {
    const created = right.createdAt.localeCompare(left.createdAt);
    if (created !== 0) {
      return created;
    }

    return compareStrings(left.id, right.id);
  });
}

function sortExperiences(experiences: ExperienceRecord[]): ExperienceRecord[] {
  return [...experiences].sort((left, right) => {
    const created = right.createdAt.localeCompare(left.createdAt);
    if (created !== 0) {
      return created;
    }

    return compareStrings(left.id, right.id);
  });
}

function sortSpills(spills: ArtifactSpillRecord[]): ArtifactSpillRecord[] {
  return [...spills].sort((left, right) => {
    const created = right.createdAt.localeCompare(left.createdAt);
    if (created !== 0) {
      return created;
    }

    return compareStrings(left.id, right.id);
  });
}

function sortProposals(proposals: LearningProposal[]): LearningProposal[] {
  return [...proposals].sort((left, right) => {
    const updated = right.updatedAt.localeCompare(left.updatedAt);
    if (updated !== 0) {
      return updated;
    }

    return compareStrings(left.summary, right.summary);
  });
}

function sortPromotions(promotions: PromotionRecord[]): PromotionRecord[] {
  return [...promotions].sort((left, right) => {
    const decided = right.decidedAt.localeCompare(left.decidedAt);
    if (decided !== 0) {
      return decided;
    }

    return compareStrings(left.summary, right.summary);
  });
}

function renderDomainMetadataSuffix(record: {
  tags?: string[];
  attributes?: Record<string, string | number | boolean | null>;
}): string {
  const parts = [
    record.tags && record.tags.length > 0
      ? `tags: ${[...record.tags]
          .sort(compareStrings)
          .map(sanitizeMarkdownInline)
          .join(", ")}`
      : undefined,
    record.attributes && Object.keys(record.attributes).length > 0
      ? `attributes: ${Object.entries(record.attributes)
          .sort(([left], [right]) => compareStrings(left, right))
          .map(([key, value]) =>
            `${sanitizeMarkdownInline(key)}=${sanitizeMarkdownInline(String(value))}`,
          )
          .join(", ")}`
      : undefined,
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? ` {${parts.join("; ")}}` : "";
}

function renderPreferenceLines(preferences: PreferenceMemory[]): string[] {
  return sortPreferences(preferences).map(
    (preference) => {
      const lifecycle = preference.lifecycle ?? "active";
      const lifecyclePrefix = lifecycle === "active" ? "" : `[${lifecycle}] `;
      return `- ${lifecyclePrefix}${sanitizeMarkdownInline(preference.category)}: ${sanitizeMarkdownInline(String(preference.value))}${renderDomainMetadataSuffix(preference)}`;
    },
  );
}

function renderFactLines(facts: FactMemory[]): string[] {
  return sortFacts(facts).map(
    (fact) => {
      const occurrence = fact.occurrence
        ? ` [occurrence: ${fact.occurrence.start}..${fact.occurrence.endExclusive}; precision=${fact.occurrence.precision}; timezone=${fact.occurrence.timezone}]`
        : "";
      return `- [${fact.lifecycle}] ${sanitizeMarkdownInline(fact.content)}${occurrence}${renderDomainMetadataSuffix(fact)}`;
    },
  );
}

function renderNoteLines(notes: NoteMemory[]): string[] {
  return [...notes]
    .sort((left, right) =>
      left.title.localeCompare(right.title) || left.id.localeCompare(right.id)
    )
    .map(
      (note) =>
        `- [${note.lifecycle}] ${sanitizeMarkdownInline(note.title)}${renderDomainMetadataSuffix(note)}`,
    );
}

function renderReferenceLines(references: ReferenceMemory[]): string[] {
  return sortReferences(references).map(
    (reference) =>
      `- [${reference.lifecycle ?? "active"}] ${sanitizeMarkdownInline(reference.title)} (${sanitizeMarkdownInline(reference.pointer)})${renderDomainMetadataSuffix(reference)}`,
  );
}

function renderFeedbackLines(feedback: FeedbackMemory[]): string[] {
  return sortFeedback(feedback).map(
    (entry) =>
      `- [${entry.kind}] ${sanitizeMarkdownInline(entry.rule)}${renderDomainMetadataSuffix(entry)}`,
  );
}

function renderEpisodeLines(episodes: EpisodeMemory[]): string[] {
  return sortEpisodes(episodes).map(
    (episode) => `- ${sanitizeMarkdownInline(episode.summary)}`,
  );
}

function renderArchiveLines(
  input: MarkdownArtifactInput,
  archives: SessionArchive[],
): string[] {
  return sortArchives(archives).map((archive) => {
    const suffix =
      archive.unresolvedItems.length > 0
        ? ` ${renderLabel(input, "open_loops")}: ${sanitizeMarkdownInline(archive.unresolvedItems.join(", "))}`
        : "";

    return `- ${sanitizeMarkdownInline(archive.summary)}${suffix}`;
  });
}

function renderEvidenceLines(evidence: EvidenceRecord[]): string[] {
  return sortEvidence(evidence).map(
    (record) => `- ${sanitizeMarkdownInline(record.excerpt)}`,
  );
}

function renderExperienceLines(experiences: ExperienceRecord[]): string[] {
  return sortExperiences(experiences).map(
    (experience) => `- [${experience.kind}] ${sanitizeMarkdownInline(experience.summary)}`,
  );
}

function renderProposalLines(proposals: LearningProposal[]): string[] {
  return sortProposals(proposals).map(
    (proposal) =>
      `- [${sanitizeMarkdownInline(proposal.status)}] [${sanitizeMarkdownInline(proposal.proposalType)}] ${sanitizeMarkdownInline(proposal.summary)}`,
  );
}

function renderPromotionLines(promotions: PromotionRecord[]): string[] {
  return sortPromotions(promotions).map(
    (promotion) =>
      `- [${sanitizeMarkdownInline(promotion.decision)}] ${sanitizeMarkdownInline(promotion.summary)} (proposal: ${sanitizeMarkdownInline(promotion.proposalId)}; policy=${sanitizeMarkdownInline(promotion.policyOutcome)}; verification=${sanitizeMarkdownInline(promotion.verificationOutcome)}; eval=${sanitizeMarkdownInline(promotion.evalOutcome)})`,
  );
}

function slugifySegment(value: string): string {
  const ascii = value.normalize("NFKD").replace(/[^\x00-\x7F]/g, "");
  const slug = ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug.length > 0 ? slug : "playbook";
}

function renderWorkingMemoryLines(
  input: MarkdownArtifactInput,
  workingMemory: WorkingMemorySnapshot | null,
): string[] {
  if (!workingMemory) {
    return [];
  }

  return [
    workingMemory.currentGoal
      ? `- ${renderLabel(input, "current_goal")}: ${sanitizeMarkdownInline(workingMemory.currentGoal)}`
      : undefined,
    ...workingMemory.openLoops.map(
      (loop) => `- ${renderLabel(input, "open_loops")}: ${sanitizeMarkdownInline(loop)}`,
    ),
    ...(workingMemory.temporaryDecisions ?? []).map(
      (decision) =>
        `- ${renderLabel(input, "temporary_decision")}: ${sanitizeMarkdownInline(decision)}`,
    ),
  ].filter((line): line is string => Boolean(line));
}

function renderJournalLines(
  input: MarkdownArtifactInput,
  journal: SessionJournal | null,
): string[] {
  if (!journal) {
    return [];
  }

  return [
    journal.currentState
      ? `- ${renderLabel(input, "current_state")}: ${sanitizeMarkdownInline(journal.currentState)}`
      : undefined,
    ...journal.worklog.map(
      (entry) =>
        `- ${renderLabel(input, "recent_worklog")}: ${sanitizeMarkdownInline(entry)}`,
    ),
    ...(journal.filesAndFunctions ?? []).map(
      (entry) =>
        `- ${renderLabel(input, "file_or_function")}: ${sanitizeMarkdownInline(entry)}`,
    ),
  ].filter((line): line is string => Boolean(line));
}

function renderSpillLines(spills: ArtifactSpillRecord[]): string[] {
  return sortSpills(spills).map(
    (spill) =>
      `- [${spill.kind}] ${sanitizeMarkdownInline(spill.sourceId)}: ${sanitizeMarkdownInline(spill.preview)}`,
  );
}

function renderScopeLines(scope: MemoryScope): string[] {
  return [
    `- userId: ${sanitizeMarkdownInline(scope.userId)}`,
    scope.tenantId ? `- tenantId: ${sanitizeMarkdownInline(scope.tenantId)}` : undefined,
    scope.workspaceId
      ? `- workspaceId: ${sanitizeMarkdownInline(scope.workspaceId)}`
      : undefined,
    scope.agentId ? `- agentId: ${sanitizeMarkdownInline(scope.agentId)}` : undefined,
    scope.sessionId
      ? `- scoped sessionId: ${sanitizeMarkdownInline(scope.sessionId)}`
      : undefined,
  ].filter((line): line is string => Boolean(line));
}

function buildSessionArtifactRelativePath(
  scope: MemoryScope,
  sessionId: string,
): string {
  if (scope.sessionId === sessionId) {
    return "session.md";
  }

  return `sessions/${encodeURIComponent(sessionId)}.md`;
}

function collectActiveSessionIds(input: MarkdownArtifactInput): string[] {
  const sessionIds = new Set<string>();

  if (input.runtime?.workingMemory?.sessionId) {
    sessionIds.add(input.runtime.workingMemory.sessionId);
  }
  if (input.runtime?.journal?.sessionId) {
    sessionIds.add(input.runtime.journal.sessionId);
  }

  return [...sessionIds].sort(compareStrings);
}

function buildArchiveArtifactRelativePath(archive: SessionArchive): string {
  const archivedAt = new Date(archive.archivedAt);
  const year = Number.isNaN(archivedAt.getTime())
    ? "unknown"
    : String(archivedAt.getUTCFullYear()).padStart(4, "0");
  const month = Number.isNaN(archivedAt.getTime())
    ? "00"
    : String(archivedAt.getUTCMonth() + 1).padStart(2, "0");

  return `archive/${year}/${month}/${encodeURIComponent(archive.sessionId)}.md`;
}

// MEMORY.md is an index, not a dump (layering design §6.1): one line per
// record with kind, id, date, and a clipped head, bounded in lines and bytes.
// Detail lives in the topic pages.
const INDEX_MAX_LINES = 200;
const INDEX_MAX_BYTES = 25_000;
const INDEX_HEAD_MAX_CHARS = 120;

function clipInline(value: string, maxChars = INDEX_HEAD_MAX_CHARS): string {
  const inline = sanitizeMarkdownInline(value);
  return inline.length > maxChars
    ? `${inline.slice(0, maxChars - 3).trimEnd()}...`
    : inline;
}

function isoDate(...timestamps: Array<string | undefined>): string {
  for (const timestamp of timestamps) {
    if (timestamp && Number.isFinite(Date.parse(timestamp))) {
      return timestamp.slice(0, 10);
    }
  }
  return "unknown";
}

function renderIndexLine(
  kind: string,
  id: string,
  date: string,
  head: string,
  suffix = "",
): string {
  return `- [${kind}] ${sanitizeMarkdownInline(id)} ${date} ${clipInline(head)}${suffix}`;
}

function buildEvidenceCounts(evidence: EvidenceRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const record of evidence) {
    for (const memoryId of record.linkedMemoryIds) {
      counts.set(memoryId, (counts.get(memoryId) ?? 0) + 1);
    }
  }
  return counts;
}

function evidenceSuffix(counts: Map<string, number>, memoryId: string): string {
  const count = counts.get(memoryId) ?? 0;
  return count > 0 ? ` [evidence: ${count}]` : "";
}

function partitionByLifecycle<T extends { lifecycle?: MemoryLifecycleState }>(
  records: readonly T[],
): { active: T[]; archived: T[]; superseded: T[] } {
  const active: T[] = [];
  const superseded: T[] = [];
  const archived: T[] = [];
  for (const record of records) {
    const lifecycle = resolveMemoryLifecycle(record);
    if (lifecycle === "active") {
      active.push(record);
    } else if (lifecycle === "superseded") {
      superseded.push(record);
    } else {
      archived.push(record);
    }
  }
  return { active, archived, superseded };
}

function renderTopicDocument(
  input: MarkdownArtifactInput,
  titleKey: LanguageRenderKey,
  partitions: { active: string[]; archived: string[]; superseded: string[] },
): string {
  return renderDocument(renderLabel(input, titleKey), [
    renderLocalizedSection(input, "topic_active", partitions.active),
    ...(partitions.superseded.length > 0
      ? [renderLocalizedSection(input, "topic_superseded", partitions.superseded)]
      : []),
    ...(partitions.archived.length > 0
      ? [renderLocalizedSection(input, "topic_archived", partitions.archived)]
      : []),
  ]);
}

function renderNoteTopicLines(notes: NoteMemory[]): string[] {
  return [...notes]
    .sort((left, right) =>
      left.title.localeCompare(right.title) || left.id.localeCompare(right.id)
    )
    .flatMap((note) => [
      `### ${sanitizeMarkdownInline(note.title)}`,
      `<!-- id: ${sanitizeMarkdownInline(note.id)}; updated: ${isoDate(note.updatedAt)}${renderDomainMetadataSuffix(note)} -->`,
      // The body is the page: verbatim, never inlined or escaped.
      note.body,
      "",
    ]);
}

function episodeMonth(episode: EpisodeMemory): string {
  const date = new Date(episode.observedAt ?? episode.createdAt);
  return Number.isNaN(date.getTime())
    ? "unknown"
    : `${String(date.getUTCFullYear()).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function buildTopicArtifacts(input: MarkdownArtifactInput): MarkdownArtifactFile[] {
  const durable = input.durable;
  const files: MarkdownArtifactFile[] = [];
  const topic = (relativePath: string, content: string): MarkdownArtifactFile => ({
    kind: "topic",
    relativePath,
    content,
  });
  const preferences = partitionByLifecycle(durable.preferences);
  files.push(topic("topics/preferences.md", renderTopicDocument(input, "preference", {
    active: renderPreferenceLines(preferences.active),
    archived: renderPreferenceLines(preferences.archived),
    superseded: renderPreferenceLines(preferences.superseded),
  })));
  const feedback = partitionByLifecycle(durable.feedback);
  files.push(topic("topics/feedback.md", renderTopicDocument(input, "feedback", {
    active: renderFeedbackLines(feedback.active),
    archived: renderFeedbackLines(feedback.archived),
    superseded: renderFeedbackLines(feedback.superseded),
  })));
  const references = partitionByLifecycle(durable.references);
  files.push(topic("topics/references.md", renderTopicDocument(input, "reference", {
    active: renderReferenceLines(references.active),
    archived: renderReferenceLines(references.archived),
    superseded: renderReferenceLines(references.superseded),
  })));
  const facts = partitionByLifecycle(durable.facts);
  files.push(topic("topics/facts.md", renderTopicDocument(input, "fact", {
    active: renderFactLines(facts.active),
    archived: renderFactLines(facts.archived),
    superseded: renderFactLines(facts.superseded),
  })));
  if (durable.notes && durable.notes.length > 0) {
    const notes = partitionByLifecycle(durable.notes);
    files.push(topic("topics/notes.md", renderTopicDocument(input, "note", {
      active: renderNoteTopicLines(notes.active),
      archived: renderNoteTopicLines(notes.archived),
      superseded: renderNoteTopicLines(notes.superseded),
    })));
  }
  const months = new Map<string, EpisodeMemory[]>();
  for (const episode of sortEpisodes(durable.episodes)) {
    const month = episodeMonth(episode);
    months.set(month, [...(months.get(month) ?? []), episode]);
  }
  for (const [month, episodes] of [...months.entries()].sort(([left], [right]) =>
    compareStrings(left, right)
  )) {
    files.push(topic(`topics/episodes/${month}.md`, renderDocument(
      `${renderLabel(input, "episode")}: ${month}`,
      [
        renderLocalizedSection(
          input,
          "topic_active",
          renderEpisodeLines(episodes.filter((episode) => episode.archivedAt === undefined)),
        ),
        ...(episodes.some((episode) => episode.archivedAt !== undefined)
          ? [renderLocalizedSection(
              input,
              "topic_archived",
              renderEpisodeLines(episodes.filter((episode) => episode.archivedAt !== undefined)),
            )]
          : []),
      ],
    )));
  }
  return files;
}

function renderExpertiseLines(
  input: MarkdownArtifactInput,
  profile: UserProfile | null,
): string[] {
  if (!profile) {
    return [];
  }
  return [
    profile.expertise.level
      ? `- ${renderLabel(input, "expertise")}: ${sanitizeMarkdownInline(profile.expertise.level)}`
      : undefined,
    ...profile.expertise.primarySkills.map(
      (skill) => `- ${sanitizeMarkdownInline(skill)}`,
    ),
    ...profile.expertise.domains.map(
      (domain) => `- ${sanitizeMarkdownInline(domain)}`,
    ),
  ].filter((line): line is string => Boolean(line));
}

function renderProvenanceLines(input: MarkdownArtifactInput): string[] {
  const durable = input.durable;
  const timestamps = [
    durable.profile?.updatedAt,
    ...durable.preferences.map(({ updatedAt }) => updatedAt),
    ...durable.feedback.map(({ updatedAt }) => updatedAt),
    ...durable.references.map(({ updatedAt }) => updatedAt),
    ...durable.facts.map(({ updatedAt }) => updatedAt),
    ...(durable.notes ?? []).map(({ updatedAt }) => updatedAt),
  ].filter((value): value is string => Boolean(value) && Number.isFinite(Date.parse(value as string)));
  const latest = timestamps.length > 0
    ? new Date(Math.max(...timestamps.map((value) => Date.parse(value)))).toISOString()
    : undefined;
  return [
    latest ? `- lastUpdated: ${latest}` : undefined,
    `- records: preferences=${durable.preferences.length}, feedback=${durable.feedback.length}, references=${durable.references.length}, facts=${durable.facts.length}, notes=${durable.notes?.length ?? 0}`,
  ].filter((line): line is string => Boolean(line));
}

function buildUserArtifact(input: MarkdownArtifactInput): MarkdownArtifactFile {
  return {
    kind: "user",
    relativePath: "user.md",
    content: renderDocument(renderLabel(input, "user_memory"), [
      renderLocalizedSection(
        input,
        "profile",
        renderProfileLines(input, input.durable.profile),
      ),
      renderLocalizedSection(
        input,
        "expertise",
        renderExpertiseLines(input, input.durable.profile),
      ),
      renderLocalizedSection(
        input,
        "current_projects_and_goals",
        renderActiveContextLines(input, input.durable.profile),
      ),
      renderLocalizedSection(
        input,
        "collaboration_preferences",
        renderPreferenceLines(
          input.durable.preferences.filter((record) => resolveMemoryLifecycle(record) === "active"),
        ),
      ),
      renderLocalizedSection(
        input,
        "stable_procedural_guidance",
        renderFeedbackLines(
          input.durable.feedback.filter((record) => resolveMemoryLifecycle(record) === "active"),
        ),
      ),
      renderLocalizedSection(input, "provenance_summary", renderProvenanceLines(input)),
    ]),
  };
}

function buildMemoryArtifact(
  input: MarkdownArtifactInput,
  indexedPaths: readonly string[] = [],
): MarkdownArtifactFile {
  const durable = input.durable;
  const evidenceCounts = buildEvidenceCounts(durable.evidence);
  const sections: Array<{ key: LanguageRenderKey; lines: string[] }> = [
    { key: "scope", lines: renderScopeLines(input.scope) },
    { key: "files", lines: indexedPaths.map((path) => `- ${sanitizeMarkdownInline(path)}`) },
    { key: "profile", lines: renderProfileLines(input, durable.profile) },
    {
      key: "preference",
      lines: sortPreferences(durable.preferences).map((record) =>
        renderIndexLine(
          "preference",
          record.id,
          isoDate(record.updatedAt),
          `${record.category}: ${String(record.value)}`,
          evidenceSuffix(evidenceCounts, record.id),
        )
      ),
    },
    {
      key: "feedback",
      lines: sortFeedback(durable.feedback).map((record) =>
        renderIndexLine(
          "feedback",
          record.id,
          isoDate(record.updatedAt),
          `[${record.kind}] ${record.rule}`,
          evidenceSuffix(evidenceCounts, record.id),
        )
      ),
    },
    {
      key: "reference",
      lines: sortReferences(durable.references).map((record) =>
        renderIndexLine(
          "reference",
          record.id,
          isoDate(record.updatedAt),
          `${record.title} (${record.pointer})`,
          evidenceSuffix(evidenceCounts, record.id),
        )
      ),
    },
    ...(durable.notes && durable.notes.length > 0
      ? [{
          key: "note" as const,
          lines: [...durable.notes]
            .sort((left, right) =>
              left.title.localeCompare(right.title) || left.id.localeCompare(right.id)
            )
            .map((record) =>
              renderIndexLine(
                "note",
                record.id,
                isoDate(record.observedAt, record.updatedAt),
                `[${record.lifecycle}] ${record.title}`,
                evidenceSuffix(evidenceCounts, record.id),
              )
            ),
        }]
      : []),
    {
      key: "fact",
      lines: sortFacts(durable.facts).map((record) =>
        renderIndexLine(
          "fact",
          record.id,
          isoDate(record.observedAt, record.updatedAt),
          record.lifecycle === "active" ? record.content : `[${record.lifecycle}] ${record.content}`,
          evidenceSuffix(evidenceCounts, record.id),
        )
      ),
    },
    {
      key: "episode",
      lines: sortEpisodes(durable.episodes).map((record) =>
        renderIndexLine(
          "episode",
          record.id,
          isoDate(record.observedAt, record.createdAt),
          record.summary,
        )
      ),
    },
    {
      key: "archive",
      lines: sortArchives(durable.archives).map((record) =>
        renderIndexLine("archive", record.id, isoDate(record.archivedAt), record.summary)
      ),
    },
    {
      key: "evidence",
      lines: sortEvidence(durable.evidence).map((record) =>
        renderIndexLine("evidence", record.id, isoDate(record.createdAt), record.excerpt)
      ),
    },
    {
      key: "experiences",
      lines: sortExperiences(durable.experiences).map((record) =>
        renderIndexLine(
          "experience",
          record.id,
          isoDate(record.createdAt),
          `[${record.kind}] ${record.summary}`,
        )
      ),
    },
    {
      key: "learning_proposals",
      lines: sortProposals(durable.proposals).map((record) =>
        renderIndexLine(
          "proposal",
          record.id,
          isoDate(record.updatedAt),
          `[${record.status}] [${record.proposalType}] ${record.summary}`,
        )
      ),
    },
    {
      key: "promotions",
      lines: sortPromotions(durable.promotions).map((record) =>
        renderIndexLine(
          "promotion",
          record.id,
          isoDate(record.decidedAt),
          `[${record.decision}] ${record.summary}`,
        )
      ),
    },
    {
      key: "working_memory",
      lines: renderWorkingMemoryLines(input, input.runtime?.workingMemory ?? null),
    },
    { key: "journal", lines: renderJournalLines(input, input.runtime?.journal ?? null) },
    { key: "artifact_spills", lines: renderSpillLines(input.runtime?.spills ?? []) },
  ];

  const render = (omitted: number): string => {
    const body = sections.map(({ key, lines }) =>
      renderLocalizedSection(input, key, lines)
    );
    const document = renderDocument(renderLabel(input, "memory_index"), body);
    return omitted > 0
      ? `${document}\n\n- ${sanitizeMarkdownInline(renderLabel(input, "omitted_records", { count: omitted }))}`
      : document;
  };
  const withinBudget = (document: string): boolean =>
    document.split("\n").length <= INDEX_MAX_LINES &&
    Buffer.byteLength(document, "utf8") <= INDEX_MAX_BYTES;

  let omitted = 0;
  let content = render(omitted);
  // Trim record lines from the longest section first until the index fits;
  // headings and the files section always stay.
  while (!withinBudget(content)) {
    const trimmable = sections
      .filter(({ key, lines }) => key !== "scope" && key !== "files" && lines.length > 0)
      .sort((left, right) => right.lines.length - left.lines.length)[0];
    if (!trimmable) {
      break;
    }
    trimmable.lines.pop();
    omitted += 1;
    content = render(omitted);
  }

  return {
    kind: "memory",
    relativePath: "MEMORY.md",
    content,
  };
}

function buildSessionArtifact(
  input: MarkdownArtifactInput,
  sessionId: string,
): MarkdownArtifactFile {
  const workingMemory =
    input.runtime?.workingMemory?.sessionId === sessionId
      ? input.runtime.workingMemory
      : null;
  const journal =
    input.runtime?.journal?.sessionId === sessionId ? input.runtime.journal : null;
  const spills = (input.runtime?.spills ?? []).filter(
    (spill) => spill.scope.sessionId === sessionId,
  );

  return {
    kind: "session",
    relativePath: buildSessionArtifactRelativePath(input.scope, sessionId),
    sessionId,
    content: renderDocument(
      renderLabel(input, "session_memory", { sessionId }),
      [
      renderLocalizedSection(input, "scope", [
        ...renderScopeLines(input.scope),
        `- sessionId: ${sanitizeMarkdownInline(sessionId)}`,
      ]),
      renderLocalizedSection(
        input,
        "preference",
        renderPreferenceLines(
          input.durable.preferences.filter((record) => record.sessionId === sessionId),
        ),
      ),
      renderLocalizedSection(
        input,
        "reference",
        renderReferenceLines(
          input.durable.references.filter((record) => record.sessionId === sessionId),
        ),
      ),
      renderLocalizedSection(
        input,
        "fact",
        renderFactLines(
          input.durable.facts.filter((record) => record.sessionId === sessionId),
        ),
      ),
      renderLocalizedSection(
        input,
        "feedback",
        renderFeedbackLines(
          input.durable.feedback.filter((record) => record.sessionId === sessionId),
        ),
      ),
      renderLocalizedSection(
        input,
        "episode",
        renderEpisodeLines(
          input.durable.episodes.filter((record) => record.sessionId === sessionId),
        ),
      ),
      renderLocalizedSection(
        input,
        "archive",
        renderArchiveLines(
          input,
          input.durable.archives.filter((record) => record.sessionId === sessionId),
        ),
      ),
      renderLocalizedSection(
        input,
        "evidence",
        renderEvidenceLines(
          input.durable.evidence.filter((record) => record.sessionId === sessionId),
        ),
      ),
      renderLocalizedSection(
        input,
        "experiences",
        renderExperienceLines(
          input.durable.experiences.filter((record) => record.sessionId === sessionId),
        ),
      ),
      renderLocalizedSection(
        input,
        "learning_proposals",
        renderProposalLines(
          input.durable.proposals.filter((record) => record.sessionId === sessionId),
        ),
      ),
      renderLocalizedSection(
        input,
        "promotions",
        renderPromotionLines(
          input.durable.promotions.filter((record) => record.sessionId === sessionId),
        ),
      ),
      renderLocalizedSection(
        input,
        "working_memory",
        renderWorkingMemoryLines(input, workingMemory),
      ),
      renderLocalizedSection(input, "journal", renderJournalLines(input, journal)),
      renderLocalizedSection(input, "artifact_spills", renderSpillLines(spills)),
    ]),
  };
}

function buildPlaybookArtifacts(input: MarkdownArtifactInput): MarkdownArtifactFile[] {
  const usedRelativePaths = new Set<string>();
  const validatedPatterns = sortFeedback(input.durable.feedback).filter(
    (entry) => entry.kind === "validated_pattern" && entry.lifecycle === "active",
  );

  return validatedPatterns.map((pattern) => {
    const baseSlug = slugifySegment(pattern.rule);
    let relativePath = `playbooks/${baseSlug}.md`;

    if (usedRelativePaths.has(relativePath)) {
      relativePath = `playbooks/${baseSlug}-${slugifySegment(pattern.id)}.md`;
    }

    usedRelativePaths.add(relativePath);
    const derivedBasePath = relativePath.slice(0, -".md".length);

    const lineageLines = [
      `- sourceMethod: ${sanitizeMarkdownInline(pattern.source.method)}`,
      pattern.source.sessionId
        ? `- sourceSessionId: ${sanitizeMarkdownInline(pattern.source.sessionId)}`
        : undefined,
      pattern.evidence && pattern.evidence.length > 0
        ? `- evidenceIds: ${sanitizeMarkdownInline(pattern.evidence.join(", "))}`
        : undefined,
    ].filter((line): line is string => Boolean(line));
    const canonicalPatternLines = [
      `- canonicalMemoryId: ${sanitizeMarkdownInline(pattern.id)}`,
      `- lifecycle: ${sanitizeMarkdownInline(pattern.lifecycle)}`,
      pattern.appliesTo
        ? `- appliesTo: ${sanitizeMarkdownInline(pattern.appliesTo)}`
        : undefined,
      pattern.workspaceId
        ? `- workspaceId: ${sanitizeMarkdownInline(pattern.workspaceId)}`
        : undefined,
      pattern.agentId
        ? `- agentId: ${sanitizeMarkdownInline(pattern.agentId)}`
        : undefined,
    ].filter((line): line is string => Boolean(line));

    return [
      {
        kind: "playbook" as const,
        relativePath,
        content: renderDocument(
          renderLabel(input, "playbook_title", { rule: pattern.rule }),
          [
            renderLocalizedSection(
              input,
              "canonical_pattern",
              canonicalPatternLines,
            ),
            renderLocalizedSection(input, "guidance", [
              `- ${sanitizeMarkdownInline(pattern.rule)}`,
            ]),
            renderOptionalPlaybookSection(
              input,
              "why",
              pattern.why ? [`- ${sanitizeMarkdownInline(pattern.why)}`] : [],
            ),
            renderLocalizedSection(input, "lineage", lineageLines),
          ],
        ),
      },
      {
        kind: "playbook" as const,
        relativePath: `${derivedBasePath}.prompt.md`,
        content: renderDocument(
          renderLabel(input, "prompt_snippet_title", { rule: pattern.rule }),
          [
            renderLocalizedSection(input, "use_when", [
              pattern.appliesTo
                ? `- appliesTo: ${sanitizeMarkdownInline(pattern.appliesTo)}`
                : "- appliesTo: general",
            ]),
            renderLocalizedSection(input, "instruction", [
              `- ${sanitizeMarkdownInline(pattern.rule)}`,
            ]),
            renderLocalizedSection(input, "lineage", lineageLines),
          ],
        ),
      },
      {
        kind: "playbook" as const,
        relativePath: `${derivedBasePath}.skill.md`,
        content: renderDocument(
          renderLabel(input, "skill_snippet_title", { rule: pattern.rule }),
          [
            renderLocalizedSection(input, "metadata", canonicalPatternLines),
            renderLocalizedSection(input, "procedure", [
              `- ${sanitizeMarkdownInline(pattern.rule)}`,
            ]),
            renderOptionalPlaybookSection(
              input,
              "why",
              pattern.why ? [`- ${sanitizeMarkdownInline(pattern.why)}`] : [],
            ),
          ],
        ),
      },
    ];
  }).flat();
}

function buildArchiveArtifacts(input: MarkdownArtifactInput): MarkdownArtifactFile[] {
  return sortArchives(input.durable.archives).map((archive) => ({
    kind: "archive",
    relativePath: buildArchiveArtifactRelativePath(archive),
    sessionId: archive.sessionId,
    content: renderDocument(
      renderLabel(input, "archive_recap", { sessionId: archive.sessionId }),
      [
      renderLocalizedSection(
        input,
        "summary",
        [`- ${sanitizeMarkdownInline(archive.summary)}`],
      ),
      renderLocalizedSection(
        input,
        "key_decisions",
        archive.keyDecisions.map((decision) => `- ${sanitizeMarkdownInline(decision)}`),
      ),
      renderLocalizedSection(
        input,
        "open_loops",
        archive.unresolvedItems.map((item) => `- ${sanitizeMarkdownInline(item)}`),
      ),
      renderLocalizedSection(
        input,
        "referenced_artifacts",
        archive.referencedArtifacts.map(
          (artifact) => `- ${sanitizeMarkdownInline(artifact)}`,
        ),
      ),
      renderLocalizedSection(
        input,
        "lineage",
        [
          `- archiveId: ${sanitizeMarkdownInline(archive.id)}`,
          `- sourceSessionIds: ${sanitizeMarkdownInline(archive.sourceSessionIds.join(", "))}`,
          archive.scopeLineage.length > 0
            ? `- scopeLineage: ${sanitizeMarkdownInline(archive.scopeLineage.join(", "))}`
            : undefined,
        ].filter((line): line is string => Boolean(line)),
      ),
    ]),
  }));
}

export function buildMarkdownArtifacts(
  input: MarkdownArtifactInput,
): MarkdownArtifactBundle {
  const topics = buildTopicArtifacts(input);
  const sessions = collectActiveSessionIds(input).map((sessionId) =>
    buildSessionArtifact(input, sessionId),
  );
  const archives = buildArchiveArtifacts(input);
  const playbooks = buildPlaybookArtifacts(input);
  const user = buildUserArtifact(input);
  const files: MarkdownArtifactFile[] = [
    user,
    buildMemoryArtifact(
      input,
      [user, ...topics, ...sessions, ...archives, ...playbooks].map(
        ({ relativePath }) => relativePath,
      ),
    ),
    ...topics,
    ...sessions,
    ...archives,
    ...playbooks,
  ];

  return {
    rootPath: buildRootPath(input.scope),
    files,
  };
}
