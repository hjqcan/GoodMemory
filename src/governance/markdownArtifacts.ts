import {
  type ArtifactSpillRecord,
  type EpisodeMemory,
  type FactMemory,
  type FeedbackMemory,
  type PreferenceMemory,
  type ReferenceMemory,
  type SessionJournal,
  type UserProfile,
  type WorkingMemorySnapshot,
  resolveMemoryLifecycle,
} from "../domain/records";
import type { MemoryScope } from "../domain/scope";
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
  kind: "archive" | "memory" | "playbook" | "session" | "user";
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
        "active_context",
        renderActiveContextLines(input, input.durable.profile),
      ),
      renderLocalizedSection(
        input,
        "preference",
        renderPreferenceLines(input.durable.preferences),
      ),
      renderLocalizedSection(
        input,
        "feedback",
        renderFeedbackLines(input.durable.feedback),
      ),
    ]),
  };
}

function buildMemoryArtifact(input: MarkdownArtifactInput): MarkdownArtifactFile {
  return {
    kind: "memory",
    relativePath: "MEMORY.md",
    content: renderDocument(renderLabel(input, "memory_index"), [
      renderLocalizedSection(input, "scope", renderScopeLines(input.scope)),
      renderLocalizedSection(
        input,
        "profile",
        renderProfileLines(input, input.durable.profile),
      ),
      renderLocalizedSection(
        input,
        "preference",
        renderPreferenceLines(input.durable.preferences),
      ),
      renderLocalizedSection(
        input,
        "feedback",
        renderFeedbackLines(input.durable.feedback),
      ),
      renderLocalizedSection(
        input,
        "reference",
        renderReferenceLines(input.durable.references),
      ),
      renderLocalizedSection(input, "fact", renderFactLines(input.durable.facts)),
      renderLocalizedSection(
        input,
        "episode",
        renderEpisodeLines(input.durable.episodes),
      ),
      renderLocalizedSection(
        input,
        "archive",
        renderArchiveLines(input, input.durable.archives),
      ),
      renderLocalizedSection(
        input,
        "evidence",
        renderEvidenceLines(input.durable.evidence),
      ),
      renderLocalizedSection(
        input,
        "experiences",
        renderExperienceLines(input.durable.experiences),
      ),
      renderLocalizedSection(
        input,
        "learning_proposals",
        renderProposalLines(input.durable.proposals),
      ),
      renderLocalizedSection(
        input,
        "promotions",
        renderPromotionLines(input.durable.promotions),
      ),
      renderLocalizedSection(
        input,
        "working_memory",
        renderWorkingMemoryLines(input, input.runtime?.workingMemory ?? null),
      ),
      renderLocalizedSection(
        input,
        "journal",
        renderJournalLines(input, input.runtime?.journal ?? null),
      ),
      renderLocalizedSection(
        input,
        "artifact_spills",
        renderSpillLines(input.runtime?.spills ?? []),
      ),
    ]),
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
  const files: MarkdownArtifactFile[] = [
    buildUserArtifact(input),
    buildMemoryArtifact(input),
    ...collectActiveSessionIds(input).map((sessionId) =>
      buildSessionArtifact(input, sessionId),
    ),
    ...buildArchiveArtifacts(input),
    ...buildPlaybookArtifacts(input),
  ];

  return {
    rootPath: buildRootPath(input.scope),
    files,
  };
}
