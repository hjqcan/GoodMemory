import type {
  ExportMemoryInput,
  ExportMemoryResult,
  GoodMemory,
} from "../api/contracts";
import { readGoodMemoryEvalSupport } from "../api/evalSupport";
import {
  readGoodMemoryIntegrationSupport,
} from "../api/integrationSupport";
import {
  createFeedbackMemory,
} from "../domain/records";
import type { MemoryCandidate } from "../domain/memoryCandidate";
import type {
  ArtifactSpillRecord,
  FeedbackMemory,
  ReferenceMemory,
  SessionJournal,
  WorkingMemorySnapshot,
} from "../domain/records";
import { createMemorySource } from "../domain/provenance";
import { assertStorageSafeExternalValue } from "../domain/semanticText";
import {
  createExperienceRecord,
  EXPERIENCES_COLLECTION,
} from "../evolution/contracts";
import { createLanguageService } from "../language";
import type {
  LanguageRenderKey,
  LanguageService,
  ResolvedLanguageContext,
} from "../language";
import {
  evaluateShouldRemember,
  redactPolicyCandidate,
  resolvePolicyConflict,
  toPolicyMemoryRecord,
} from "../policy/hooks";
import type {
  CreateHostAdapterInput,
  HostActionAssessmentResult,
  HostActionIntent,
  HostAdapter,
  HostArtifact,
  HostArtifactType,
  HostReadArtifactsResult,
  HostRollbackGuidance,
  HostStructuredDelta,
  HostWriteArtifactInput,
  HostWriteArtifactResult,
  HostWriteDiagnostics,
  HostWriteVerificationInput,
} from "./contracts";
import {
  HostAdapterWriteError,
} from "./contracts";
import { validateHostActionIntent } from "./actionIntents";
import { createHostBehavioralTraceRecorder } from "./behavioralTraceRecorder";
import { attachHostEvalSupport } from "./evalSupport";
import {
  assessHostAction,
  buildHostPlannedActionSummary,
} from "./preActionPolicy";
import { recordBehavioralTrace as recordHostBehavioralTrace } from "./behavioralTraceBridge";

export type {
  CreateHostAdapterInput,
  HostActionAssessmentResult,
  HostActionIntent,
  HostActionDecision,
  HostAdapter,
  HostAdapterCapabilities,
  HostActionKind,
  HostAdapterMode,
  HostArtifact,
  HostArtifactType,
  HostKind,
  HostPlannedAction,
  HostReadArtifactsResult,
  HostRecommendedFirstStep,
  HostRollbackGuidance,
  HostStructuredDelta,
  HostWriteArtifactInput,
  HostWriteArtifactResult,
  HostWriteDiagnostics,
  HostWriteVerificationInput,
  HostWriteVerificationOutcome,
  HostWriteVerificationResult,
} from "./contracts";
export { HostAdapterWriteError } from "./contracts";

const DEFAULT_READABLE_ARTIFACT_TYPES = [
  "memory_index",
  "user_memory",
  "session_memory",
] as const satisfies readonly HostArtifactType[];

const DEFAULT_SUPPORTED_READABLE_ARTIFACT_TYPES = [
  ...DEFAULT_READABLE_ARTIFACT_TYPES,
  "archive_recap",
  "playbook",
  "topic_page",
] as const satisfies readonly HostArtifactType[];

function sanitizeMarkdownInline(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\t/g, "\\t")
    .replace(/\r\n?/g, "\n")
    .replace(/\n/g, "\\n");
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

function renderDocument(title: string, sections: string[]): string {
  return [`# ${sanitizeMarkdownInline(title)}`, ...sections.flatMap((section) => ["", section])].join(
    "\n",
  );
}

function renderHostLabel(
  language: LanguageService,
  languageContext: ResolvedLanguageContext,
  key: LanguageRenderKey,
  values?: Record<string, number | string>,
): string {
  return language.render(
    { key, ...(values ? { values } : {}) },
    languageContext,
  );
}

function renderHostSection(
  language: LanguageService,
  languageContext: ResolvedLanguageContext,
  key: LanguageRenderKey,
  lines: string[],
): string {
  return renderSection(
    renderHostLabel(language, languageContext, key),
    lines,
    renderHostLabel(language, languageContext, "none"),
  );
}

function uniqueArtifactTypes(
  artifactTypes: readonly HostArtifactType[] | undefined,
  fallback: readonly HostArtifactType[],
): HostArtifactType[] {
  const resolved = artifactTypes ?? fallback;
  const deduped: HostArtifactType[] = [];

  for (const artifactType of resolved) {
    if (!deduped.includes(artifactType)) {
      deduped.push(artifactType);
    }
  }

  return deduped;
}

function freezeArtifactTypes(
  artifactTypes: readonly HostArtifactType[],
): readonly HostArtifactType[] {
  return Object.freeze([...artifactTypes]);
}

function resolveHostArtifactType(input: {
  kind: HostArtifact["kind"];
  relativePath: string;
}): HostArtifactType | null {
  if (input.kind === "archive" || input.relativePath.startsWith("archive/")) {
    return "archive_recap";
  }

  if (input.relativePath.startsWith("playbooks/")) {
    return "playbook";
  }

  if (input.kind === "topic" || input.relativePath.startsWith("topics/")) {
    return "topic_page";
  }

  if (input.relativePath === "MEMORY.md" || input.kind === "memory") {
    return "memory_index";
  }

  if (input.relativePath === "user.md" || input.kind === "user") {
    return "user_memory";
  }

  if (input.kind === "session" || input.relativePath === "session.md") {
    return "session_memory";
  }

  return null;
}

function assertReadableNegotiation(input: {
  readableArtifactTypes: readonly HostArtifactType[];
  supportedReadableArtifactTypes: readonly HostArtifactType[];
}): void {
  const unsupportedArtifactTypes = input.readableArtifactTypes.filter(
    (artifactType) => !input.supportedReadableArtifactTypes.includes(artifactType),
  );

  if (unsupportedArtifactTypes.length === 0) {
    return;
  }

  throw new Error(
    `readable artifact types must be supported by the configured export surface: ${unsupportedArtifactTypes.join(", ")}`,
  );
}

function assertWritableNegotiation(input: {
  documentStorePresent: boolean;
  mode: CreateHostAdapterInput["mode"];
  readableArtifactTypes: readonly HostArtifactType[];
  writableArtifactTypes: readonly HostArtifactType[];
}): void {
  if (input.mode !== "file-authoritative" && input.writableArtifactTypes.length > 0) {
    throw new Error("file-assisted adapters cannot declare writable artifact types");
  }

  if (input.writableArtifactTypes.length > 0 && !input.documentStorePresent) {
    throw new Error(
      "file-authoritative adapters require documentStore when writable artifact types are enabled",
    );
  }

  for (const artifactType of input.writableArtifactTypes) {
    if (!input.readableArtifactTypes.includes(artifactType)) {
      throw new Error(
        "writable artifact types must be a subset of readable artifact types",
      );
    }
  }
}

function hasBehavioralOutcomeRecorder(
  memory: CreateHostAdapterInput["memory"],
): memory is GoodMemory {
  return Boolean(readGoodMemoryEvalSupport(memory as GoodMemory)?.recordBehavioralOutcome);
}

function hasHostActionAssessmentRecorder(
  memory: CreateHostAdapterInput["memory"],
): memory is GoodMemory {
  return Boolean(
    readGoodMemoryIntegrationSupport(memory as GoodMemory)?.recordHostActionAssessment,
  );
}

function summarizeRecommendedFirstStep(
  step: HostActionAssessmentResult["recommendedFirstStep"],
): string | undefined {
  if (!step) {
    return undefined;
  }

  switch (step.kind) {
    case "warning":
      return step.message;
    case "command":
      return step.command;
    case "tool_call":
      return step.toolName;
    case "file_edit":
      return `${step.operation} ${step.relativePath}`;
  }
}

function bindIntentToAdapterHostKind(
  intent: HostActionIntent,
  adapterHostKind: HostAdapter["hostKind"],
): HostActionIntent {
  if (intent.hostKind !== adapterHostKind) {
    throw new Error(
      `host action intent hostKind ${intent.hostKind} does not match adapter hostKind ${adapterHostKind}`,
    );
  }

  return {
    ...intent,
    hostKind: adapterHostKind,
  };
}

async function maybeRecordActionAssessment(input: {
  assessment: HostActionAssessmentResult;
  intent: HostActionIntent;
  memory: CreateHostAdapterInput["memory"];
}): Promise<{
  assessmentExperienceId?: string;
  auditRecorded: boolean;
}> {
  if (!hasHostActionAssessmentRecorder(input.memory)) {
    return {
      auditRecorded: false,
    };
  }

  const result = await readGoodMemoryIntegrationSupport(
    input.memory as GoodMemory,
  )!.recordHostActionAssessment({
    assessment: {
      actionId: input.intent.actionId,
      actionKind: input.intent.action.kind,
      actionSummary: buildHostPlannedActionSummary(input.intent.action),
      attemptId: input.intent.attemptId,
      decision: input.assessment.decision,
      guidance: input.assessment.guidance,
      hostKind: input.intent.hostKind,
      matchedEvidenceIds: input.assessment.matchedEvidenceIds,
      matchedMemoryIds: input.assessment.matchedMemoryIds,
      occurredAt: input.intent.occurredAt,
      policyApplied: input.assessment.policyApplied,
      reason: input.assessment.reason,
      recommendedFirstStepSummary: summarizeRecommendedFirstStep(
        input.assessment.recommendedFirstStep,
      ),
      requiredPreconditions: input.assessment.requiredPreconditions,
      runId: input.intent.runId,
      scope: input.intent.scope,
      turnId: input.intent.turnId,
    },
  });

  return {
    assessmentExperienceId: result.experienceId,
    auditRecorded: result.recorded,
  };
}

function renderSessionScopeLines(exported: ExportMemoryResult, sessionId: string): string[] {
  return [
    `- userId: ${sanitizeMarkdownInline(exported.scope.userId)}`,
    exported.scope.workspaceId
      ? `- workspaceId: ${sanitizeMarkdownInline(exported.scope.workspaceId)}`
      : undefined,
    exported.scope.agentId
      ? `- agentId: ${sanitizeMarkdownInline(exported.scope.agentId)}`
      : undefined,
    `- sessionId: ${sanitizeMarkdownInline(sessionId)}`,
  ].filter((line): line is string => Boolean(line));
}

function renderWorkingMemoryLines(workingMemory: WorkingMemorySnapshot | null): {
  constraints: string[];
  currentGoal: string[];
  openLoops: string[];
  recentDecisions: string[];
} {
  if (!workingMemory) {
    return {
      constraints: [],
      currentGoal: [],
      openLoops: [],
      recentDecisions: [],
    };
  }

  return {
    currentGoal: workingMemory.currentGoal
      ? [`- ${sanitizeMarkdownInline(workingMemory.currentGoal)}`]
      : [],
    openLoops: workingMemory.openLoops.map(
      (loop) => `- ${sanitizeMarkdownInline(loop)}`,
    ),
    recentDecisions: (workingMemory.temporaryDecisions ?? []).map(
      (decision) => `- ${sanitizeMarkdownInline(decision)}`,
    ),
    constraints: (workingMemory.constraints ?? []).map(
      (constraint) => `- ${sanitizeMarkdownInline(constraint)}`,
    ),
  };
}

function renderJournalStateLines(journal: SessionJournal | null): {
  currentState: string[];
  keyFiles: string[];
  workflow: string[];
} {
  if (!journal) {
    return {
      currentState: [],
      keyFiles: [],
      workflow: [],
    };
  }

  return {
    currentState: journal.currentState
      ? [`- ${sanitizeMarkdownInline(journal.currentState)}`]
      : [],
    keyFiles: (journal.filesAndFunctions ?? []).map(
      (entry) => `- ${sanitizeMarkdownInline(entry)}`,
    ),
    workflow: (journal.workflow ?? []).map(
      (entry) => `- ${sanitizeMarkdownInline(entry)}`,
    ),
  };
}

function renderReferenceLines(references: ReferenceMemory[]): string[] {
  return references.map((reference) => {
    const title = sanitizeMarkdownInline(reference.title);
    const pointer = sanitizeMarkdownInline(reference.pointer);

    return `- ${title}: ${pointer}`;
  });
}

function renderFeedbackLines(feedback: FeedbackMemory[]): string[] {
  return feedback.map((entry) => `- [${entry.kind}] ${sanitizeMarkdownInline(entry.rule)}`);
}

function renderSpillLines(spills: ArtifactSpillRecord[]): string[] {
  return spills.map((spill) => `- ${sanitizeMarkdownInline(spill.preview)}`);
}

function uniqueLines(lines: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const line of lines) {
    if (seen.has(line)) {
      continue;
    }

    seen.add(line);
    deduped.push(line);
  }

  return deduped;
}

function isActiveLifecycleRecord<TRecord extends { lifecycle?: string }>(
  record: TRecord,
): boolean {
  return (record.lifecycle ?? "active") === "active";
}

function buildSessionArtifactRelativePath(sessionId: string): string {
  return `session-memory/${encodeURIComponent(sessionId)}.md`;
}

function buildSessionHandoffContent(
  exported: ExportMemoryResult,
  sessionId: string,
  language: LanguageService,
  languageContext: ResolvedLanguageContext,
): string {
  const workingMemory =
    exported.runtime?.workingMemory?.sessionId === sessionId
      ? exported.runtime.workingMemory
      : null;
  const journal =
    exported.runtime?.journal?.sessionId === sessionId ? exported.runtime.journal : null;
  const references = exported.durable.references.filter(
    (reference) => reference.sessionId === sessionId && isActiveLifecycleRecord(reference),
  );
  const feedback = exported.durable.feedback.filter(
    (entry) => entry.sessionId === sessionId && isActiveLifecycleRecord(entry),
  );
  const spills = (exported.runtime?.spills ?? []).filter(
    (spill) => spill.scope.sessionId === sessionId,
  );
  const workingMemoryLines = renderWorkingMemoryLines(workingMemory);
  const journalLines = renderJournalStateLines(journal);

  return renderDocument(
    renderHostLabel(language, languageContext, "session_handoff", { sessionId }),
    [
    renderHostSection(
      language,
      languageContext,
      "scope",
      renderSessionScopeLines(exported, sessionId),
    ),
    renderHostSection(
      language,
      languageContext,
      "current_goal",
      workingMemoryLines.currentGoal,
    ),
    renderHostSection(
      language,
      languageContext,
      "open_loops",
      workingMemoryLines.openLoops,
    ),
    renderHostSection(
      language,
      languageContext,
      "recent_decisions",
      workingMemoryLines.recentDecisions,
    ),
    renderHostSection(
      language,
      languageContext,
      "constraints",
      workingMemoryLines.constraints,
    ),
    renderHostSection(
      language,
      languageContext,
      "current_state",
      journalLines.currentState,
    ),
    renderHostSection(
      language,
      languageContext,
      "key_files",
      uniqueLines([...journalLines.keyFiles, ...renderReferenceLines(references)]),
    ),
    renderHostSection(
      language,
      languageContext,
      "workflow",
      journalLines.workflow,
    ),
    renderHostSection(
      language,
      languageContext,
      "procedural_memory",
      renderFeedbackLines(feedback),
    ),
    renderHostSection(
      language,
      languageContext,
      "artifact_spills",
      renderSpillLines(spills),
    ),
  ]);
}

function toHostArtifact(
  exported: ExportMemoryResult,
  file: ExportMemoryResult["artifacts"]["files"][number],
  artifactType: HostArtifactType,
  language: LanguageService,
  languageContext: ResolvedLanguageContext,
): HostArtifact {
  if (artifactType === "session_memory" && file.sessionId) {
    return {
      ...file,
      artifactType,
      relativePath: buildSessionArtifactRelativePath(file.sessionId),
      content: buildSessionHandoffContent(
        exported,
        file.sessionId,
        language,
        languageContext,
      ),
      writable: false,
    };
  }

  return {
    ...file,
    artifactType,
    writable: false,
  };
}

function collectExportLanguageText(exported: ExportMemoryResult): string {
  const profile = exported.durable.profile;
  const workingMemory = exported.runtime?.workingMemory;
  const journal = exported.runtime?.journal;
  return [
    ...(exported.durable.sourceMessages ?? []).map(({ content }) => content),
    profile?.identity.name,
    profile?.identity.role,
    profile?.identity.organization,
    profile?.identity.location,
    profile?.identity.languagePreference,
    ...exported.durable.facts.map(({ content }) => content),
    ...exported.durable.references.flatMap(({ pointer, title }) => [title, pointer]),
    ...exported.durable.feedback.map(({ rule }) => rule),
    ...exported.durable.episodes.map(({ summary }) => summary),
    ...exported.durable.archives.map(({ summary }) => summary),
    ...exported.durable.evidence.map(({ excerpt }) => excerpt),
    ...exported.durable.experiences.map(({ summary }) => summary),
    ...exported.durable.proposals.map(({ summary }) => summary),
    ...exported.durable.promotions.map(({ summary }) => summary),
    workingMemory?.currentGoal,
    ...(workingMemory?.openLoops ?? []),
    ...(workingMemory?.temporaryDecisions ?? []),
    ...(workingMemory?.constraints ?? []),
    journal?.currentState,
    ...(journal?.worklog ?? []),
    ...(journal?.filesAndFunctions ?? []),
    ...(journal?.workflow ?? []),
  ].filter((text): text is string => Boolean(text)).join("\n");
}

async function readArtifacts(
  memory: CreateHostAdapterInput["memory"],
  readableArtifactTypes: readonly HostArtifactType[],
  input: ExportMemoryInput,
  language: LanguageService,
): Promise<HostReadArtifactsResult> {
  const exported = await memory.exportMemory(input);
  const languageContext = language.resolveFromText({
    ...(input.locale ? { locale: input.locale } : {}),
    text: collectExportLanguageText(exported),
  });
  const artifacts = exported.artifacts.files.flatMap((file): HostArtifact[] => {
    const artifactType = resolveHostArtifactType(file);

    if (!artifactType || !readableArtifactTypes.includes(artifactType)) {
      return [];
    }

    return [
      toHostArtifact(
        exported,
        file,
        artifactType,
        language,
        languageContext,
      ),
    ];
  });

  return {
    artifacts,
    exportedAt: exported.exportedAt,
    rootPath: exported.artifacts.rootPath,
    scope: exported.scope,
  };
}

function createRollbackGuidance(performed = false): HostRollbackGuidance {
  return {
    mode: "file-assisted",
    hint:
      "Recreate the host adapter in file-assisted mode and inspect compiled artifacts before retrying writable operations.",
    performed,
  };
}

function createDiagnostics(input: {
  adapterId: string;
  artifactType: HostArtifactType;
  canonicalMemoryId?: string;
  failureReasons?: string[];
  hostKind: HostAdapter["hostKind"];
  mode: HostAdapter["capabilities"]["mode"];
  policyApplied?: string[];
  relativePath: string;
  risky?: boolean;
  rollbackPerformed?: boolean;
  structuredDelta?: HostStructuredDelta[];
  verificationOutcome?: HostWriteDiagnostics["verificationOutcome"];
  wroteAt: string;
}): HostWriteDiagnostics {
  return {
    adapterId: input.adapterId,
    artifactType: input.artifactType,
    canonicalMemoryId: input.canonicalMemoryId,
    failureReasons: input.failureReasons ?? [],
    hostKind: input.hostKind,
    mode: input.mode,
    policyApplied: input.policyApplied ?? [],
    provenance: {
      adapterId: input.adapterId,
      hostKind: input.hostKind,
      origin: "host_adapter",
      wroteAt: input.wroteAt,
    },
    relativePath: input.relativePath,
    risky: input.risky ?? false,
    rollback: createRollbackGuidance(input.rollbackPerformed ?? false),
    structuredDelta: input.structuredDelta ?? [],
    verificationOutcome: input.verificationOutcome ?? "not_run",
  };
}

function createWriteError(
  message: string,
  diagnostics: HostWriteDiagnostics,
): HostAdapterWriteError {
  return new HostAdapterWriteError(message, diagnostics);
}

function parseListItems(lines: string[]): string[] {
  return lines
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim());
}

function parseKeyValueSection(lines: string[]): Record<string, string> {
  const entries = parseListItems(lines);
  const result: Record<string, string> = {};

  for (const entry of entries) {
    const delimiter = entry.indexOf(":");
    if (delimiter < 0) {
      continue;
    }

    const key = entry.slice(0, delimiter).trim();
    const value = entry.slice(delimiter + 1).trim();

    result[key] = value;
  }

  return result;
}

function parseSections(content: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let currentSection: string | null = null;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trimEnd();

    if (line.startsWith("## ")) {
      currentSection = line.slice(3).trim();
      sections.set(currentSection, []);
      continue;
    }

    if (currentSection) {
      sections.get(currentSection)?.push(line);
    }
  }

  return sections;
}

function parseSectionListItems(content: string, sectionTitle: string): string[] {
  const sections = parseSections(content);

  return parseListItems(sections.get(sectionTitle) ?? []);
}

function isLegacyEmptyWhyPlaceholder(items: string[]): boolean {
  return items.length === 1 && items[0] === "none";
}

interface PlaybookSectionLabels {
  canonicalPattern: string;
  guidance: string;
  why: string;
}

function resolvePlaybookSectionLabels(
  language: LanguageService,
  languageContext: ResolvedLanguageContext,
): PlaybookSectionLabels {
  return {
    canonicalPattern: renderHostLabel(
      language,
      languageContext,
      "canonical_pattern",
    ),
    guidance: renderHostLabel(language, languageContext, "guidance"),
    why: renderHostLabel(language, languageContext, "why"),
  };
}

function parsePlaybookWriteInput(
  input: HostWriteArtifactInput,
  labels: PlaybookSectionLabels,
): {
  appliesTo?: string;
  canonicalMemoryId: string;
  rule: string;
  why?: string;
} {
  const sections = parseSections(input.content);
  const canonicalSection = parseKeyValueSection(
    sections.get(labels.canonicalPattern) ?? [],
  );
  const guidanceItems = parseListItems(sections.get(labels.guidance) ?? []);
  const whyItems = parseListItems(sections.get(labels.why) ?? []);

  if (!canonicalSection.canonicalMemoryId) {
    throw createWriteError(
      "Malformed playbook file.",
      createDiagnostics({
        adapterId: "unknown",
        artifactType: input.artifactType,
        failureReasons: [
          "Playbook writeback requires canonicalMemoryId in the Canonical Pattern section.",
        ],
        hostKind: "generic",
        mode: "file-authoritative",
        relativePath: input.relativePath,
        wroteAt: new Date(0).toISOString(),
      }),
    );
  }

  if (guidanceItems.length === 0) {
    throw createWriteError(
      "Malformed playbook file.",
      createDiagnostics({
        adapterId: "unknown",
        artifactType: input.artifactType,
        failureReasons: [
          "Playbook writeback requires one guidance bullet in the Guidance section.",
        ],
        hostKind: "generic",
        mode: "file-authoritative",
        relativePath: input.relativePath,
        wroteAt: new Date(0).toISOString(),
      }),
    );
  }

  if (guidanceItems.length > 1) {
    throw createWriteError(
      "Malformed playbook file.",
      createDiagnostics({
        adapterId: "unknown",
        artifactType: input.artifactType,
        failureReasons: [
          "Playbook writeback only supports a single guidance bullet in the Guidance section.",
        ],
        hostKind: "generic",
        mode: "file-authoritative",
        relativePath: input.relativePath,
        wroteAt: new Date(0).toISOString(),
      }),
    );
  }

  if (whyItems.length > 1) {
    throw createWriteError(
      "Malformed playbook file.",
      createDiagnostics({
        adapterId: "unknown",
        artifactType: input.artifactType,
        failureReasons: [
          "Playbook writeback only supports zero or one Why bullet in the Why section.",
        ],
        hostKind: "generic",
        mode: "file-authoritative",
        relativePath: input.relativePath,
        wroteAt: new Date(0).toISOString(),
      }),
    );
  }

  return {
    appliesTo: canonicalSection.appliesTo,
    canonicalMemoryId: canonicalSection.canonicalMemoryId,
    rule: guidanceItems[0]!,
    why: whyItems[0],
  };
}

function parsePlaybookCanonicalMemoryId(
  content: string,
  labels: PlaybookSectionLabels,
): string | null {
  const sections = parseSections(content);
  const canonicalSection = parseKeyValueSection(
    sections.get(labels.canonicalPattern) ?? [],
  );
  const canonicalMemoryId = canonicalSection.canonicalMemoryId?.trim();

  return canonicalMemoryId ? canonicalMemoryId : null;
}

function createPolicyCandidate(input: {
  appliesTo?: string;
  rule: string;
}): MemoryCandidate {
  return {
    id: "host-write-candidate",
    kindHint: "feedback",
    explicitness: "explicit",
    content: input.rule,
    sourceMessageIndex: 0,
    sourceRole: "assistant",
    metadata: {
      appliesTo: input.appliesTo,
      feedbackKind: "validated_pattern",
    },
  };
}

function matchesWritableScope(
  record: FeedbackMemory,
  scope: HostWriteArtifactInput["scope"],
): boolean {
  if (record.userId !== scope.userId) {
    return false;
  }

  if (scope.tenantId !== undefined && record.tenantId !== scope.tenantId) {
    return false;
  }

  if (scope.workspaceId !== undefined && record.workspaceId !== scope.workspaceId) {
    return false;
  }

  if (scope.agentId !== undefined && record.agentId !== scope.agentId) {
    return false;
  }

  return true;
}

function buildStructuredDelta(input: {
  nextAppliesTo?: string;
  nextRule: string;
  nextWhy?: string;
  previous: FeedbackMemory;
}): HostStructuredDelta[] {
  const delta: HostStructuredDelta[] = [];

  if (input.previous.appliesTo !== input.nextAppliesTo) {
    delta.push({
      op: "set",
      target: "appliesTo",
      value: input.nextAppliesTo,
    });
  }

  if (input.previous.rule !== input.nextRule) {
    delta.push({
      op: "set",
      target: "rule",
      value: input.nextRule,
    });
  }

  if (input.previous.why !== input.nextWhy) {
    delta.push({
      op: "set",
      target: "why",
      value: input.nextWhy,
    });
  }

  return delta;
}

function buildVerificationInput(input: {
  artifactType: HostArtifactType;
  canonicalMemoryId?: string;
  currentContent: string;
  nextContent: string;
  relativePath: string;
  risky: boolean;
  scope: HostWriteArtifactInput["scope"];
  structuredDelta: HostStructuredDelta[];
}): HostWriteVerificationInput {
  return {
    artifactType: input.artifactType,
    canonicalMemoryId: input.canonicalMemoryId,
    currentContent: input.currentContent,
    nextContent: input.nextContent,
    relativePath: input.relativePath,
    risky: input.risky,
    scope: input.scope,
    structuredDelta: input.structuredDelta,
  };
}

async function readArtifactMap(
  memory: CreateHostAdapterInput["memory"],
  scope: HostWriteArtifactInput["scope"],
  language: LanguageService,
): Promise<Map<string, HostArtifact>> {
  const exported = await readArtifacts(
    memory,
    DEFAULT_SUPPORTED_READABLE_ARTIFACT_TYPES,
    {
      scope,
      includeRuntime: true,
    },
    language,
  );

  return new Map(exported.artifacts.map((artifact) => [artifact.relativePath, artifact]));
}

async function applyPlaybookWrite(input: {
  adapterId: string;
  documentStore: NonNullable<CreateHostAdapterInput["documentStore"]>;
  hostKind: HostAdapter["hostKind"];
  language: LanguageService;
  memory: CreateHostAdapterInput["memory"];
  mode: HostAdapter["capabilities"]["mode"];
  now: () => string;
  policy: CreateHostAdapterInput["policy"];
  verifyWrite: CreateHostAdapterInput["verifyWrite"];
  writeInput: HostWriteArtifactInput;
  createId: () => string;
}): Promise<HostWriteArtifactResult> {
  const wroteAt = input.now();
  const writableDiagnostics = (
    overrides: Partial<HostWriteDiagnostics> & {
      rollbackPerformed?: boolean;
    },
  ): HostWriteDiagnostics =>
    createDiagnostics({
      adapterId: input.adapterId,
      artifactType: input.writeInput.artifactType,
      canonicalMemoryId: overrides.canonicalMemoryId,
      failureReasons: overrides.failureReasons,
      hostKind: input.hostKind,
      mode: input.mode,
      policyApplied: overrides.policyApplied,
      relativePath: overrides.relativePath ?? input.writeInput.relativePath,
      risky: overrides.risky,
      rollbackPerformed: overrides.rollbackPerformed,
      structuredDelta: overrides.structuredDelta,
      verificationOutcome: overrides.verificationOutcome,
      wroteAt,
    });

  if (
    !input.writeInput.relativePath.startsWith("playbooks/") ||
    input.writeInput.relativePath.endsWith(".prompt.md") ||
    input.writeInput.relativePath.endsWith(".skill.md")
  ) {
    throw createWriteError(
      `Host adapter does not allow writes for artifact path ${input.writeInput.relativePath}`,
      writableDiagnostics({
        failureReasons: [
          "Structured delta writeback only supports canonical playbook markdown files.",
        ],
      }),
    );
  }

  const currentArtifacts = await readArtifactMap(
    input.memory,
    input.writeInput.scope,
    input.language,
  );
  const currentArtifact = currentArtifacts.get(input.writeInput.relativePath);

  if (!currentArtifact) {
    throw createWriteError(
      `Host adapter cannot locate the current artifact ${input.writeInput.relativePath}`,
      writableDiagnostics({
        failureReasons: [
          "The requested artifact path does not exist in the current exported host surface.",
        ],
      }),
    );
  }

  const currentLanguageContext = input.language.resolveFromText({
    text: currentArtifact.content,
  });
  const playbookLabels = resolvePlaybookSectionLabels(
    input.language,
    currentLanguageContext,
  );
  const boundCanonicalMemoryId = parsePlaybookCanonicalMemoryId(
    currentArtifact.content,
    playbookLabels,
  );

  if (input.writeInput.content === currentArtifact.content) {
    return {
      diagnostics: writableDiagnostics({
        canonicalMemoryId: boundCanonicalMemoryId ?? undefined,
        policyApplied: [],
        risky: false,
        structuredDelta: [],
      }),
      status: "noop",
      updatedArtifact: currentArtifact,
    };
  }

  let parsed;

  try {
    parsed = parsePlaybookWriteInput(input.writeInput, playbookLabels);
  } catch (error) {
    if (error instanceof HostAdapterWriteError) {
      throw createWriteError(
        error.message,
        writableDiagnostics({
          ...error.diagnostics,
          adapterId: input.adapterId,
          hostKind: input.hostKind,
          mode: input.mode,
          relativePath: input.writeInput.relativePath,
          provenance: {
            adapterId: input.adapterId,
            hostKind: input.hostKind,
            origin: "host_adapter",
            wroteAt,
          },
        }),
      );
    }

    throw error;
  }

  if (!boundCanonicalMemoryId) {
    throw createWriteError(
      `Host adapter cannot verify canonical binding for ${input.writeInput.relativePath}`,
      writableDiagnostics({
        failureReasons: [
          "The current exported playbook is missing canonicalMemoryId and cannot be used for authoritative writeback.",
        ],
      }),
    );
  }

  if (parsed.canonicalMemoryId !== boundCanonicalMemoryId) {
    throw createWriteError(
      "Host adapter write targets a different canonical record than the current playbook path.",
      writableDiagnostics({
        canonicalMemoryId: boundCanonicalMemoryId,
        failureReasons: [
          "Edited playbook canonicalMemoryId must match the current artifact bound to this path.",
        ],
      }),
    );
  }

  const existing = await input.documentStore.get<FeedbackMemory>(
    "feedback",
    boundCanonicalMemoryId,
  );

  if (
    !existing ||
    existing.kind !== "validated_pattern" ||
    existing.lifecycle !== "active" ||
    !matchesWritableScope(existing, input.writeInput.scope)
  ) {
    throw createWriteError(
      `Host adapter cannot find writable validated pattern ${boundCanonicalMemoryId}`,
      writableDiagnostics({
        canonicalMemoryId: boundCanonicalMemoryId,
        failureReasons: [
          "Structured delta writeback only supports the active validated pattern currently bound to this playbook path.",
        ],
      }),
    );
  }

  let candidate = createPolicyCandidate({
    appliesTo: parsed.appliesTo,
    rule: parsed.rule,
  });
  const policyApplied: string[] = [];
  const existingLanguageContext = input.language.resolveFromText({
    ...(existing.source.locale ? { locale: existing.source.locale } : {}),
    text: existing.rule,
  });
  const policyContext = {
    locale: existingLanguageContext.locale,
    localeSource:
      existing.source.localeSource ?? existingLanguageContext.localeSource,
    phase: "remember" as const,
    scope: input.writeInput.scope,
  };

  if (input.policy?.redact) {
    const redacted = await redactPolicyCandidate(
      input.policy,
      candidate,
      policyContext,
    );

    if (redacted.kindHint !== candidate.kindHint) {
      throw createWriteError(
        "Policy moved structured host writeback outside the validated-pattern lane.",
        writableDiagnostics({
          canonicalMemoryId: existing.id,
          failureReasons: [
            "Structured playbook writeback cannot change the canonical memory lane.",
          ],
          policyApplied: ["custom_redact"],
        }),
      );
    }

    if (
      redacted.content !== candidate.content ||
      redacted.metadata?.appliesTo !== candidate.metadata?.appliesTo
    ) {
      policyApplied.push("custom_redact");
    }

    candidate = {
      ...candidate,
      content: redacted.content,
      explicitness: redacted.explicitness,
      metadata: redacted.metadata,
    };
  }

  assertStorageSafeExternalValue(candidate, "candidate");

  if (!(await evaluateShouldRemember(input.policy, candidate, policyContext))) {
    policyApplied.push("custom_shouldRemember");

    throw createWriteError(
      "Host adapter write was blocked by policy.",
      writableDiagnostics({
        canonicalMemoryId: existing.id,
        failureReasons: ["Policy rejected the adapter-authored change."],
        policyApplied,
      }),
    );
  }

  const risky = existing.rule !== candidate.content;
  const currentWhyItems = parseSectionListItems(
    currentArtifact.content,
    playbookLabels.why,
  );
  const nextWhyItems = parseSectionListItems(
    input.writeInput.content,
    playbookLabels.why,
  );
  const nextWhy =
    existing.why === undefined &&
    isLegacyEmptyWhyPlaceholder(nextWhyItems) &&
    (currentWhyItems.length === 0 || isLegacyEmptyWhyPlaceholder(currentWhyItems))
      ? undefined
      : parsed.why;
  const structuredDelta = buildStructuredDelta({
    nextAppliesTo: candidate.metadata?.appliesTo,
    nextRule: candidate.content,
    nextWhy,
    previous: existing,
  });

  if (structuredDelta.length === 0) {
    return {
      diagnostics: writableDiagnostics({
        canonicalMemoryId: existing.id,
        policyApplied,
        risky,
        structuredDelta,
      }),
      status: "noop",
      updatedArtifact: currentArtifact,
    };
  }

  if (input.policy?.resolveConflict) {
    const resolution = await resolvePolicyConflict(
      input.policy,
      toPolicyMemoryRecord(existing, "feedback"),
      candidate,
      policyContext,
    );

    if (resolution?.action === "keep_existing") {
      policyApplied.push("custom_resolveConflict");

      throw createWriteError(
        "Host adapter write was blocked by conflict policy.",
        writableDiagnostics({
          canonicalMemoryId: existing.id,
          failureReasons: [
            resolution.reason ?? "Conflict policy kept the existing canonical memory.",
          ],
          policyApplied,
          risky,
          structuredDelta,
        }),
      );
    }
  }

  let verificationOutcome: HostWriteDiagnostics["verificationOutcome"] = "not_run";
  let verificationReason: string | undefined;

  if (risky) {
    if (!input.verifyWrite) {
      verificationOutcome = "review_required";
      verificationReason =
        "Risky adapter writes require verification before they can be applied.";
    } else {
      const verification = await input.verifyWrite(
        buildVerificationInput({
          artifactType: input.writeInput.artifactType,
          canonicalMemoryId: existing.id,
          currentContent: currentArtifact.content,
          nextContent: input.writeInput.content,
          relativePath: input.writeInput.relativePath,
          risky,
          scope: input.writeInput.scope,
          structuredDelta,
        }),
      );

      verificationOutcome = verification.outcome;
      verificationReason = verification.reason;
    }

    if (verificationOutcome !== "passed") {
      throw createWriteError(
        "Host adapter write requires verification.",
        writableDiagnostics({
          canonicalMemoryId: existing.id,
          failureReasons: [
            verificationReason ??
              "Risky adapter writes require verification before they can be applied.",
          ],
          policyApplied,
          risky,
          structuredDelta,
          verificationOutcome,
        }),
      );
    }
  }

  const updatedRecord = createFeedbackMemory({
    ...existing,
    appliesTo: candidate.metadata?.appliesTo,
    rule: candidate.content,
    source: createMemorySource(existing.source),
    updatedAt: wroteAt,
    why: nextWhy,
  });
  const linkedExperienceId = input.createId();
  const experience = createExperienceRecord({
    id: linkedExperienceId,
    userId: existing.userId,
    tenantId: existing.tenantId,
    workspaceId: existing.workspaceId,
    agentId: existing.agentId,
    sessionId: input.writeInput.scope.sessionId,
    kind: "feedback",
    traceId: `host-write-${linkedExperienceId}`,
    trigger: "governance",
    modelInfluence: "none",
    summary: `Host adapter ${input.adapterId} updated validated pattern ${existing.id}.`,
    policyApplied,
    linkedMemoryIds: [existing.id],
    metrics: {},
    createdAt: wroteAt,
  });
  let rollbackPerformed = false;

  try {
    await input.documentStore.set("feedback", existing.id, updatedRecord);
    await input.documentStore.set(
      EXPERIENCES_COLLECTION,
      linkedExperienceId,
      experience,
    );
    const nextArtifacts = await readArtifactMap(
      input.memory,
      input.writeInput.scope,
      input.language,
    );
    const updatedArtifact =
      [...nextArtifacts.values()].find(
        (artifact) =>
          artifact.artifactType === "playbook" &&
          artifact.relativePath.endsWith(".md") &&
          !artifact.relativePath.endsWith(".prompt.md") &&
          !artifact.relativePath.endsWith(".skill.md") &&
          artifact.content.includes(`canonicalMemoryId: ${existing.id}`),
      ) ?? currentArtifact;

    return {
      diagnostics: writableDiagnostics({
        canonicalMemoryId: existing.id,
        policyApplied,
        risky,
        structuredDelta,
        verificationOutcome,
      }),
      linkedExperienceId,
      status: "applied",
      updatedArtifact,
    };
  } catch (error) {
    rollbackPerformed = true;

    try {
      await input.documentStore.set("feedback", existing.id, existing);
      await input.documentStore.delete(EXPERIENCES_COLLECTION, linkedExperienceId);
    } catch {
      rollbackPerformed = false;
    }

    throw createWriteError(
      "Host adapter write failed.",
      writableDiagnostics({
        canonicalMemoryId: existing.id,
        failureReasons: [error instanceof Error ? error.message : String(error)],
        policyApplied,
        risky,
        rollbackPerformed,
        structuredDelta,
        verificationOutcome,
      }),
    );
  }
}

function writeUnsupported(
  writableArtifactTypes: readonly HostArtifactType[],
  input: HostWriteArtifactInput,
  diagnostics: HostWriteDiagnostics,
): HostWriteArtifactResult {
  if (!writableArtifactTypes.includes(input.artifactType)) {
    throw createWriteError(
      `Host adapter does not allow writes for artifact type ${input.artifactType}`,
      diagnostics,
    );
  }

  throw createWriteError(
    `Structured delta writeback is not implemented yet for artifact type ${input.artifactType}`,
    diagnostics,
  );
}

export function createHostAdapter(input: CreateHostAdapterInput): HostAdapter {
  const readableArtifactTypes = uniqueArtifactTypes(
    input.readableArtifactTypes,
    DEFAULT_READABLE_ARTIFACT_TYPES,
  );
  const supportedReadableArtifactTypes = uniqueArtifactTypes(
    input.supportedReadableArtifactTypes,
    DEFAULT_SUPPORTED_READABLE_ARTIFACT_TYPES,
  );
  const writableArtifactTypes = uniqueArtifactTypes(input.writableArtifactTypes, []);
  const mode = input.mode ?? "file-assisted";
  const now = input.now ?? (() => new Date().toISOString());
  const createId = input.createId ?? (() => crypto.randomUUID());
  const language =
    readGoodMemoryIntegrationSupport(input.memory as GoodMemory)?.language ??
    createLanguageService();

  if (input.id.trim().length === 0) {
    throw new Error("host adapter id must not be empty");
  }

  assertReadableNegotiation({
    readableArtifactTypes,
    supportedReadableArtifactTypes,
  });
  assertWritableNegotiation({
    documentStorePresent: Boolean(input.documentStore),
    mode,
    readableArtifactTypes,
    writableArtifactTypes,
  });

  const readableArtifactTypesSnapshot = freezeArtifactTypes(readableArtifactTypes);
  const writableArtifactTypesSnapshot = freezeArtifactTypes(writableArtifactTypes);
  const capabilities = Object.freeze({
    mode,
    readableArtifactTypes: readableArtifactTypesSnapshot,
    writableArtifactTypes: writableArtifactTypesSnapshot,
  });
  const hostKind = input.hostKind ?? "generic";

  const adapter = {
    id: input.id,
    hostKind,
    capabilities,
    async assessAction(actionInput: HostActionIntent) {
      const intent = bindIntentToAdapterHostKind(
        validateHostActionIntent(actionInput),
        hostKind,
      );
      const exported = await input.memory.exportMemory({
        scope: intent.scope,
        includeRuntime: Boolean(intent.scope.sessionId),
      });
      const assessment = assessHostAction({
        exported,
        intent,
        language,
      });
      const audit = await maybeRecordActionAssessment({
        assessment,
        intent,
        memory: input.memory,
      });

      return {
        ...assessment,
        ...audit,
      };
    },
    async readArtifacts(exportInput: ExportMemoryInput) {
      const result = await readArtifacts(
        input.memory,
        readableArtifactTypesSnapshot,
        exportInput,
        language,
      );

      return {
        ...result,
        artifacts: result.artifacts.map((artifact) => ({
          ...artifact,
          writable: writableArtifactTypesSnapshot.includes(artifact.artifactType),
        })),
      };
    },
    async writeArtifact(writeInput: HostWriteArtifactInput) {
      assertStorageSafeExternalValue(writeInput, "writeInput");
      const diagnostics = createDiagnostics({
        adapterId: input.id,
        artifactType: writeInput.artifactType,
        hostKind,
        mode,
        relativePath: writeInput.relativePath,
        wroteAt: now(),
      });

      if (
        writeInput.artifactType === "playbook" &&
        writableArtifactTypesSnapshot.includes("playbook")
      ) {
        return applyPlaybookWrite({
          adapterId: input.id,
          createId,
          documentStore: input.documentStore!,
          hostKind,
          language,
          memory: input.memory,
          mode,
          now,
          policy: input.policy,
          verifyWrite: input.verifyWrite,
          writeInput,
        });
      }

      return writeUnsupported(writableArtifactTypesSnapshot, writeInput, diagnostics);
    },
  } satisfies HostAdapter;

  if (hostKind === "codex") {
    const behavioralMemory = hasBehavioralOutcomeRecorder(input.memory)
      ? input.memory
      : undefined;

    attachHostEvalSupport(adapter, {
      createBehavioralTraceRecorder: ({ cue, scope, traceId }) =>
        createHostBehavioralTraceRecorder({
          cue,
          hostKind: "codex",
          traceId: traceId ?? `host-trace-${createId()}`,
          onClose: async (trace) => {
            if (!behavioralMemory) {
              return {
                recorded: false,
              };
            }

            const result = await recordHostBehavioralTrace({
              memory: behavioralMemory,
              scope,
              trace,
            });

            return {
              recorded: result.recorded,
            };
          },
        }),
      ...(behavioralMemory
        ? {
            recordBehavioralTrace: async ({ scope, trace }) => {
              const result = await recordHostBehavioralTrace({
                memory: behavioralMemory,
                scope,
                trace,
              });

              return {
                recorded: result.recorded,
              };
            },
          }
        : {}),
    });
  }

  return Object.freeze(adapter);
}
