import type { AgentInputEvent, HostAgentEvent } from "../agentEvents";
import { hasPersistableSemanticText } from "../domain/semanticText";
import type { MemoryCandidate } from "../remember/candidates";
import type { GoodMemoryPolicyHooks, PolicyContext } from "../policy/hooks";
import type { DocumentStore } from "../storage/contracts";
import { createMemorySource } from "../domain/provenance";
import {
  createEvidenceRecord,
  EVIDENCE_COLLECTION,
  type EvidenceKind,
  type EvidenceRecord,
} from "../evidence/contracts";
import {
  createExperienceRecord,
  EXPERIENCES_COLLECTION,
  type ExperienceRecord,
} from "../evolution/contracts";
import type {
  LanguageService,
  ResolvedLanguageContext,
} from "../language";
import { scopeToKey, type MemoryScope } from "../domain/scope";
import type {
  AgentEventCorrectionResult,
  AgentEventIngestResult,
} from "./integrationSupport";

type ExternalAgentEvent = AgentInputEvent | HostAgentEvent;

interface PersistedAgentEventInput {
  evidence?: EvidenceRecord;
  experience?: ExperienceRecord;
  scope: MemoryScope;
}

export interface CreateAgentEventIngestorInput {
  documentStore: DocumentStore;
  submitCorrection(
    input: {
      appliesTo?: string;
      evidenceIds?: string[];
      locale?: string;
      scope: MemoryScope;
      signal: string;
      traceId?: string;
    },
  ): Promise<AgentEventCorrectionResult>;
  language: LanguageService;
  now: () => Date;
  persist(input: PersistedAgentEventInput): Promise<void>;
  policy?: GoodMemoryPolicyHooks;
}

const AGENT_EVENT_EXCERPT_MAX_CHARS = 280;
const AGENT_EVENT_POLICY_PREFIX = "agent_event";

function createAgentEventId(
  prefix: "evidence" | "experience",
  event: ExternalAgentEvent,
): string {
  return `${AGENT_EVENT_POLICY_PREFIX}.${prefix}.${createAgentEventKey(event)}`;
}

function encodeAgentEventKeySegment(value: string): string {
  return encodeURIComponent(value);
}

function createAgentEventKey(event: ExternalAgentEvent): string {
  return [
    `scope=${encodeAgentEventKeySegment(scopeToKey(event.scope))}`,
    `surface=${encodeAgentEventKeySegment(event.surface)}`,
    `event=${encodeAgentEventKeySegment(event.eventId)}`,
    `run=${encodeAgentEventKeySegment(event.runId ?? "")}`,
    `attempt=${encodeAgentEventKeySegment(event.attemptId ?? "")}`,
    `turn=${encodeAgentEventKeySegment(event.turnId)}`,
    `sequence=${event.sequence}`,
    `occurredAt=${encodeAgentEventKeySegment(event.occurredAt)}`,
    ...(event.parentEventId
      ? [`parent=${encodeAgentEventKeySegment(event.parentEventId)}`]
      : []),
  ].join("|");
}

function buildAgentEventTag(key: string, value: string): string {
  return `${AGENT_EVENT_POLICY_PREFIX}.${key}=${value}`;
}

function clipExcerpt(value: string): string {
  return value.length <= AGENT_EVENT_EXCERPT_MAX_CHARS
    ? value
    : `${value.slice(0, AGENT_EVENT_EXCERPT_MAX_CHARS - 3)}...`;
}

function resolvePayloadSummary(payload: unknown): string | null {
  if (payload === undefined) {
    return null;
  }

  const serialized = JSON.stringify(payload);
  return serialized.trim().length > 0 ? serialized : null;
}

function resolveAgentEventText(event: ExternalAgentEvent): string | null {
  switch (event.kind) {
    case "tool_call":
      return event.raw?.trim() ??
        resolvePayloadSummary(event.payload) ??
        (event.toolName.trim().length > 0 ? event.toolName.trim() : null);
    case "tool_result":
      return event.excerpt?.trim() ??
        `${event.toolName} ${event.outcome}`.trim() ??
        null;
    case "file_edit":
      return event.summary?.trim() ??
        `${event.operation} ${event.relativePath}`.trim() ??
        null;
    case "verify_result":
      return event.summary?.trim() ??
        `${event.checkName} ${event.outcome}`.trim() ??
        null;
    case "task_transition":
      return event.summary?.trim() ??
        [
          event.previousState ? `${event.previousState} ->` : undefined,
          event.nextState,
        ].filter(Boolean).join(" ").trim() ??
        null;
    case "user_correction":
      return event.correction.trim() || null;
  }
}

function resolveCandidateKindHint(
  event: ExternalAgentEvent,
): MemoryCandidate["kindHint"] {
  if (event.kind === "user_correction") {
    return "feedback";
  }

  return "episode";
}

function resolveEvidenceKind(event: ExternalAgentEvent): EvidenceKind | null {
  switch (event.kind) {
    case "tool_result":
      return "tool_result_excerpt";
    case "file_edit":
      return "document_excerpt";
    case "verify_result":
      return "verification_result";
    case "user_correction":
      return "correction_context";
    case "task_transition":
      return "conversation_excerpt";
    case "tool_call":
      return null;
  }
}

function buildExperienceSummary(event: ExternalAgentEvent, text: string): string {
  switch (event.kind) {
    case "tool_call":
      return clipExcerpt(`Host ${event.surface} invoked ${event.toolName}: ${text}`);
    case "tool_result":
      return clipExcerpt(
        `Host ${event.surface} tool ${event.toolName} returned ${event.outcome}: ${text}`,
      );
    case "file_edit":
      return clipExcerpt(
        `Host ${event.surface} file ${event.operation} on ${event.relativePath}: ${text}`,
      );
    case "verify_result":
      return clipExcerpt(
        `Host ${event.surface} verification ${event.checkName} ${event.outcome}: ${text}`,
      );
    case "task_transition":
      return clipExcerpt(
        `Host ${event.surface} task transition to ${event.nextState}: ${text}`,
      );
    case "user_correction":
      return clipExcerpt(`User correction observed on host ${event.surface}: ${text}`);
  }
}

function buildExperienceOutcome(
  event: ExternalAgentEvent,
): ExperienceRecord["outcome"] {
  switch (event.kind) {
    case "tool_call":
    case "file_edit":
    case "task_transition":
      return "success";
    case "tool_result":
      return event.outcome === "success"
        ? "success"
        : event.outcome === "blocked"
          ? "skipped"
          : "failure";
    case "verify_result":
      return event.outcome === "passed"
        ? "success"
        : event.outcome === "blocked"
          ? "skipped"
          : "failure";
    case "user_correction":
      return "success";
  }
}

function buildExperienceKind(
  event: ExternalAgentEvent,
): ExperienceRecord["kind"] | null {
  switch (event.kind) {
    case "verify_result":
      return "verify";
    case "user_correction":
      return null;
    case "tool_call":
    case "tool_result":
    case "file_edit":
    case "task_transition":
      return "maintenance";
  }
}

function buildPolicyApplied(
  event: ExternalAgentEvent,
  redacted: boolean,
): string[] {
  return [
    AGENT_EVENT_POLICY_PREFIX,
    buildAgentEventTag("surface", event.surface),
    buildAgentEventTag("kind", event.kind),
    buildAgentEventTag("host_kind", event.hostKind),
    ...(redacted ? [`${AGENT_EVENT_POLICY_PREFIX}.redacted`] : []),
    `${AGENT_EVENT_POLICY_PREFIX}.conflict_policy=not_applicable`,
    ...(event.parentEventId
      ? [buildAgentEventTag("parent_event_id", event.parentEventId)]
      : []),
  ];
}

function buildCandidate(
  event: ExternalAgentEvent,
  content: string,
): MemoryCandidate {
  return {
    id: `agent-event-candidate.${createAgentEventKey(event)}`,
    kindHint: resolveCandidateKindHint(event),
    explicitness: "explicit",
    content,
    sourceMessageIndex: 0,
    sourceRole: `host:${event.hostKind}`,
  };
}

async function applyAgentEventPolicy(input: {
  event: ExternalAgentEvent;
  language: LanguageService;
  policy?: GoodMemoryPolicyHooks;
  text: string;
}): Promise<{
  content: string;
  language: ResolvedLanguageContext;
  policyApplied: string[];
  shouldPersist: boolean;
}> {
  const resolvedLanguage = input.language.resolveFromText({
    text: input.text,
  });
  const context: PolicyContext = {
    scope: input.event.scope,
    phase: "remember",
    locale: resolvedLanguage.locale,
    localeSource: resolvedLanguage.localeSource,
    ...(input.event.kind === "user_correction" && input.event.retrievalProfile
      ? { retrievalProfile: input.event.retrievalProfile }
      : {}),
  };
  let candidate = buildCandidate(input.event, input.text);
  let redacted = false;

  if (input.policy?.redact) {
    const nextCandidate = await input.policy.redact(candidate, context);
    if (nextCandidate.content !== candidate.content) {
      redacted = true;
    }
    candidate = {
      ...candidate,
      kindHint: nextCandidate.kindHint,
      explicitness: nextCandidate.explicitness,
      content: nextCandidate.content.trim(),
      metadata: nextCandidate.metadata,
    };
  }

  if (!hasPersistableSemanticText(candidate.content)) {
    return {
      content: "",
      language: resolvedLanguage,
      policyApplied: buildPolicyApplied(input.event, redacted),
      shouldPersist: false,
    };
  }

  if (
    input.policy?.shouldRemember &&
    !(await input.policy.shouldRemember(candidate, context))
  ) {
    return {
      content: candidate.content,
      language: resolvedLanguage,
      policyApplied: buildPolicyApplied(input.event, redacted),
      shouldPersist: false,
    };
  }

  return {
    content: candidate.content,
    language: resolvedLanguage,
    policyApplied: buildPolicyApplied(input.event, redacted),
    shouldPersist: true,
  };
}

async function readPersistedEventArtifacts(
  documentStore: DocumentStore,
  input: {
    evidence?: EvidenceRecord;
    experience?: ExperienceRecord;
  },
): Promise<{
  evidencePersisted: boolean;
  experiencePersisted: boolean;
}> {
  const [evidence, experience] = await Promise.all([
    input.evidence
      ? documentStore.get(EVIDENCE_COLLECTION, input.evidence.id)
      : Promise.resolve(null),
    input.experience
      ? documentStore.get(EXPERIENCES_COLLECTION, input.experience.id)
      : Promise.resolve(null),
  ]);

  return {
    evidencePersisted: Boolean(evidence),
    experiencePersisted: Boolean(experience),
  };
}

async function readUserCorrectionFeedbackReceipt(
  documentStore: DocumentStore,
  event: ExternalAgentEvent,
): Promise<ExperienceRecord | null> {
  if (event.kind !== "user_correction") {
    return null;
  }

  const matches = await documentStore.query<ExperienceRecord>(EXPERIENCES_COLLECTION, {
    kind: "feedback",
    traceId: event.eventId,
    userId: event.scope.userId,
    ...(event.scope.tenantId ? { tenantId: event.scope.tenantId } : {}),
    ...(event.scope.workspaceId ? { workspaceId: event.scope.workspaceId } : {}),
    ...(event.scope.agentId ? { agentId: event.scope.agentId } : {}),
    ...(event.scope.sessionId ? { sessionId: event.scope.sessionId } : {}),
  });

  return matches[0] ?? null;
}

function resolveUserCorrectionAppliesTo(
  event: ExternalAgentEvent,
): string | undefined {
  if (event.kind !== "user_correction") {
    return undefined;
  }

  if (event.retrievalProfile === "coding_agent") {
    return "coding_agent";
  }

  if (event.retrievalProfile === "general_chat") {
    return "general_response";
  }

  return undefined;
}

function buildEvidence(input: {
  event: ExternalAgentEvent;
  excerpt: string;
  language: ResolvedLanguageContext;
  now: string;
}): EvidenceRecord | undefined {
  const kind = resolveEvidenceKind(input.event);
  if (!kind) {
    return undefined;
  }

  return createEvidenceRecord({
    id: createAgentEventId("evidence", input.event),
    userId: input.event.scope.userId,
    tenantId: input.event.scope.tenantId,
    workspaceId: input.event.scope.workspaceId,
    agentId: input.event.scope.agentId,
    sessionId: input.event.scope.sessionId,
    kind,
    excerpt: clipExcerpt(input.excerpt),
    source: createMemorySource({
      method: "explicit",
      extractedAt: input.now,
      sessionId: input.event.scope.sessionId,
      locale: input.language.locale,
      localeSource: input.language.localeSource,
      languagePackId: input.language.languagePackId,
      languagePackVersion: input.language.languagePackVersion,
    }),
    ...(input.event.kind === "file_edit"
      ? { sourceUri: input.event.relativePath }
      : {}),
    sourceMessageIds: [input.event.eventId],
  });
}

function buildExperience(input: {
  event: ExternalAgentEvent;
  evidenceId?: string;
  now: string;
  policyApplied: string[];
  summaryText: string;
}): ExperienceRecord | undefined {
  const kind = buildExperienceKind(input.event);
  if (!kind) {
    return undefined;
  }

  return createExperienceRecord({
    id: createAgentEventId("experience", input.event),
    userId: input.event.scope.userId,
    tenantId: input.event.scope.tenantId,
    workspaceId: input.event.scope.workspaceId,
    agentId: input.event.scope.agentId,
    sessionId: input.event.scope.sessionId,
    kind,
    traceId: input.event.eventId,
    sourceTraceIds: [
      input.event.eventId,
      ...(input.event.parentEventId ? [input.event.parentEventId] : []),
    ],
    trigger: "api",
    modelInfluence: "none",
    summary: buildExperienceSummary(input.event, input.summaryText),
    outcome: buildExperienceOutcome(input.event),
    policyApplied: input.policyApplied,
    linkedEvidenceIds: input.evidenceId ? [input.evidenceId] : [],
    createdAt: input.now,
  });
}

export function createAgentEventIngestor(
  input: CreateAgentEventIngestorInput,
) {
  return {
    async ingest(event: ExternalAgentEvent): Promise<AgentEventIngestResult> {
      const rawText = resolveAgentEventText(event);
      if (!rawText || !hasPersistableSemanticText(rawText)) {
        return {
          recorded: false,
          skippedReason: "empty_excerpt",
        };
      }

      const policyResult = await applyAgentEventPolicy({
        event,
        language: input.language,
        policy: input.policy,
        text: rawText,
      });

      if (!hasPersistableSemanticText(policyResult.content)) {
        return {
          recorded: false,
          skippedReason: "empty_excerpt",
        };
      }

      if (!policyResult.shouldPersist) {
        return {
          recorded: false,
          skippedReason: "policy_blocked",
        };
      }

      const timestamp = input.now().toISOString();
      const evidence = buildEvidence({
        event,
        excerpt: policyResult.content,
        language: policyResult.language,
        now: timestamp,
      });
      const persistedArtifacts = await readPersistedEventArtifacts(input.documentStore, {
        evidence,
      });

      if (event.kind === "user_correction") {
        const feedbackReceipt = await readUserCorrectionFeedbackReceipt(
          input.documentStore,
          event,
        );

        if (persistedArtifacts.evidencePersisted && feedbackReceipt) {
          return {
            recorded: false,
            skippedReason: "duplicate_event",
          };
        }

        if (evidence && !persistedArtifacts.evidencePersisted) {
          await input.persist({
            scope: event.scope,
            evidence,
          });
        }

        const correctionResult = feedbackReceipt
          ? undefined
          : await input.submitCorrection({
              appliesTo: resolveUserCorrectionAppliesTo(event),
              scope: event.scope,
              signal: policyResult.content,
              locale: policyResult.language.locale,
              ...(evidence ? { evidenceIds: [evidence.id] } : {}),
              traceId: event.eventId,
            });

        return {
          recorded: true,
          ...(evidence ? { evidenceId: evidence.id } : {}),
          ...(correctionResult?.proposalReceipts
            ? { proposalReceipts: correctionResult.proposalReceipts }
            : {}),
          ...(correctionResult?.promotionReceipts
            ? { promotionReceipts: correctionResult.promotionReceipts }
            : {}),
        };
      }

      const experience = buildExperience({
        event,
        evidenceId: evidence?.id,
        now: timestamp,
        policyApplied: policyResult.policyApplied,
        summaryText: policyResult.content,
      });
      const completePersistedArtifacts = await readPersistedEventArtifacts(
        input.documentStore,
        {
          evidence,
          experience,
        },
      );

      if (!evidence && !experience) {
        return {
          recorded: false,
          skippedReason: "empty_excerpt",
        };
      }

      if (
        (!evidence || completePersistedArtifacts.evidencePersisted) &&
        (!experience || completePersistedArtifacts.experiencePersisted)
      ) {
        return {
          recorded: false,
          skippedReason: "duplicate_event",
        };
      }

      await input.persist({
        scope: event.scope,
        ...(
          evidence && !completePersistedArtifacts.evidencePersisted
            ? { evidence }
            : {}
        ),
        ...(
          experience && !completePersistedArtifacts.experiencePersisted
            ? { experience }
            : {}
        ),
      });

      return {
        recorded: true,
        ...(evidence ? { evidenceId: evidence.id } : {}),
        ...(experience ? { experienceId: experience.id } : {}),
      };
    },
  };
}
