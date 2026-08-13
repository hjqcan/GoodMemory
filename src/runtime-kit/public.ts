import { createHash, randomUUID } from "node:crypto";
import type {
  BuildContextResult,
  GoodMemory,
  RecallResult,
  RememberInput,
} from "../api/contracts";
import { readGoodMemoryIntegrationSupport } from "../api/integrationSupport";
import type { HostKind } from "../host/contracts";
import type {
  CreateGoodMemoryRuntimeKitInput,
  GoodMemoryRuntimeKit,
  RuntimeKitAfterModelCallInput,
  RuntimeKitAfterModelCallResult,
  RuntimeKitBeforeModelCallInput,
  RuntimeKitBeforeModelCallResult,
  RuntimeKitBoundedJob,
  RuntimeKitContextMode,
  RuntimeKitEvent,
  RuntimeKitMemoryContext,
  RuntimeKitMessage,
  RuntimeKitObserveToolResultInput,
  RuntimeKitObserveToolResultResult,
  RuntimeKitPreActionInput,
  RuntimeKitPreActionResult,
  RuntimeKitSessionEndInput,
  RuntimeKitSessionResult,
  RuntimeKitSessionStartInput,
  RuntimeKitWritebackCandidate,
  RuntimeKitWritebackInput,
} from "./contracts";
import type {
  GoodMemoryRecordRef,
  ProgressiveRecallService,
} from "../progressive/recall";
import type { MemoryScope } from "../domain/scope";
import {
  assertTemporalMessageContext,
  isIanaTimezone,
  isRfc3339Instant,
} from "../domain/temporal";
import {
  buildStructuredTextResponseControlLines,
  buildBehavioralSteeringLines,
  resolveTextResponseEnactmentPlan,
  selectBehavioralPolicies,
} from "../evolution/behavioralPolicy";
import {
  buildRawBehavioralPrototypeIndex,
  resolveRawBehavioralCarryover,
  type RawCarryoverResolution,
  type RawBehavioralSurfaceFamily,
} from "../evolution/rawBehavioralExemplars";
import { createHostAdapter } from "../host/public";
import { resolveHostActionExecutionPlan } from "../host/actionExecution";
import { createGoodMemoryTracer } from "../observability/tracer";
import {
  buildProgressiveScopeDigest,
  createProgressiveRecallService,
  encodeGoodMemoryRecordRef,
} from "../progressive/recall";
import { estimateTextTokens } from "../tokenEstimator";
import type { LanguageService } from "../language";
import { redactSensitiveCredentialText } from "../language/sensitive";

function assertRuntimeKitTemporalContext(input: {
  assistantObservedAt?: string;
  assistantTimezone?: string;
  messages?: readonly RuntimeKitMessage[];
  referenceTime?: string;
  timezone?: string;
}): void {
  if (input.referenceTime !== undefined && !isRfc3339Instant(input.referenceTime)) {
    throw new TypeError(`Invalid referenceTime: ${input.referenceTime}`);
  }
  if (input.timezone !== undefined && !isIanaTimezone(input.timezone)) {
    throw new TypeError(`Invalid timezone: ${input.timezone}`);
  }
  input.messages?.forEach((message, index) => {
    assertTemporalMessageContext(message, `messages[${index}]`);
  });
  assertTemporalMessageContext({
    observedAt: input.assistantObservedAt,
    timezone: input.assistantTimezone,
  }, "assistant");
}

const DEFAULT_MAX_MEMORY_TOKENS = 160;
const DEFAULT_PROGRESSIVE_RECORD_LIMIT = 10;
const MAX_PREVIEW_CHARS = 240;

function normalizeText(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function findLatestUserMessage(
  messages: readonly RuntimeKitMessage[],
): RuntimeKitMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") {
      continue;
    }

    return message;
  }

  return null;
}

function extractTextFromMessages(messages: readonly RuntimeKitMessage[]): string | null {
  return normalizeText(findLatestUserMessage(messages)?.content);
}

function clipText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function redactRuntimeKitText(
  value: string,
  language?: LanguageService,
): string {
  return clipText(
    redactSensitiveCredentialText(
      value
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "[redacted-email]")
        .replace(/\bsk-[A-Za-z0-9_-]{6,}\b/gu, "[redacted-secret]"),
      language,
    )
      .replace(/\s+/gu, " ")
      .trim(),
    MAX_PREVIEW_CHARS,
  );
}

function buildCandidatePreview(input: {
  assistantText: string | null;
  language?: LanguageService;
  userText: string | null;
}): string | null {
  const segments = [
    input.userText ? `user: ${input.userText}` : undefined,
    input.assistantText ? `assistant: ${input.assistantText}` : undefined,
  ].filter((segment): segment is string => Boolean(segment));

  if (segments.length === 0) {
    return null;
  }

  return redactRuntimeKitText(segments.join(" | "), input.language);
}

function createCandidate(input: {
  preview: string;
  reason: RuntimeKitWritebackCandidate["reason"];
}): RuntimeKitWritebackCandidate {
  return {
    kind: "remember_candidate",
    preview: input.preview,
    rawTranscriptPersisted: false,
    reason: input.reason,
  };
}

function createBoundedJob(preview: string): RuntimeKitBoundedJob {
  const digest = createHash("sha256")
    .update(preview)
    .digest("hex")
    .slice(0, 16);
  return {
    jobId: `runtime-kit-candidate-${digest}`,
    operation: "remember",
    payloadPreview: preview,
    rawTranscriptPersisted: false,
    reason: "after_model_call",
    status: "candidate",
  };
}

function shouldDurableWrite(input: RuntimeKitWritebackInput | undefined): boolean {
  return (
    input?.mode === "selective" &&
    input.annotation === "durable_candidate" &&
    input.policy === "allow"
  );
}

function toRememberInput(input: {
  assistantObservedAt?: string;
  assistantText: string;
  assistantTimezone?: string;
  locale?: string;
  referenceTime?: string;
  scope: RememberInput["scope"];
  timezone?: string;
  userMessage: RuntimeKitMessage;
}): RememberInput {
  const userObservedAt = input.userMessage.observedAt ?? input.referenceTime;
  const userTimezone = input.userMessage.timezone ?? input.timezone;
  const assistantObservedAt = input.assistantObservedAt ?? input.referenceTime;
  const assistantTimezone = input.assistantTimezone ?? input.timezone;
  return {
    scope: input.scope,
    locale: input.locale,
    ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
    messages: [
      {
        role: "user",
        content: input.userMessage.content,
        ...(input.userMessage.id !== undefined ? { id: input.userMessage.id } : {}),
        ...(userObservedAt !== undefined ? { observedAt: userObservedAt } : {}),
        ...(userTimezone !== undefined ? { timezone: userTimezone } : {}),
      },
      {
        role: "assistant",
        content: input.assistantText,
        ...(assistantObservedAt !== undefined
          ? { observedAt: assistantObservedAt }
          : {}),
        ...(assistantTimezone !== undefined
          ? { timezone: assistantTimezone }
          : {}),
      },
    ],
    annotations: [
      {
        messageIndex: 1,
        remember: "always",
        confirmed: true,
        reason: "runtime-kit selective writeback approved by host annotation and policy",
      },
    ],
  };
}

function createEmptyContext(mode: RuntimeKitContextMode): RuntimeKitMemoryContext {
  return {
    mode,
    content: "",
    estimatedTokens: 0,
    omittedSections: [],
  };
}

function toFragmentContext(input: {
  builtContext: BuildContextResult;
}): RuntimeKitMemoryContext {
  return {
    mode: "fragment",
    content: input.builtContext.content,
    estimatedTokens: input.builtContext.estimatedTokens,
    omittedSections: [...input.builtContext.omittedSections],
  };
}

function applyBehavioralSteeringToFragment(input: {
  builtContext: BuildContextResult;
  feedback: RecallResult["feedback"];
  query: string;
  rawCarryover?: RawCarryoverResolution;
  rawRecordRefs: GoodMemoryRecordRef[];
  retrievalProfile: NonNullable<RuntimeKitBeforeModelCallInput["retrievalProfile"]>;
}): RuntimeKitMemoryContext {
  const selections = selectBehavioralPolicies({
    appliesTo:
      input.retrievalProfile === "coding_agent"
        ? "coding_agent"
        : "general_response",
    feedback: input.feedback,
    query: input.query,
    surface: "text_response",
  });
  const textResponsePlan = resolveTextResponseEnactmentPlan(selections);
  const structuredControlLines = [
    ...buildStructuredTextResponseControlLines(textResponsePlan),
    ...buildStructuredTextResponseControlLines(
      input.rawCarryover?.packet?.textResponsePlan,
    ),
  ];
  const steeringLines = buildBehavioralSteeringLines(
    selections.filter(
      ({ policy }) =>
        policy.enactmentSurface !== "text_response" ||
        !policy.applicability.textResponsePlan,
    ),
  );

  if (
    structuredControlLines.length === 0 &&
    steeringLines.length === 0 &&
    !input.rawCarryover?.packet?.promptPayload
  ) {
    return toFragmentContext({ builtContext: input.builtContext });
  }

  if (
    input.rawCarryover?.debug.mode === "exemplar_only" &&
    structuredControlLines.length === 0 &&
    steeringLines.length === 0 &&
    input.rawCarryover.packet?.promptPayload
  ) {
    return {
      mode: "fragment",
      content: input.rawCarryover.packet.promptPayload,
      estimatedTokens: estimateTextTokens(
        input.rawCarryover.packet.promptPayload,
      ),
      omittedSections: [],
      ...(input.rawRecordRefs.length > 0
        ? { recordRefs: input.rawRecordRefs }
        : {}),
    };
  }

  const content = [
    input.builtContext.content,
    input.rawCarryover?.packet?.promptPayload,
    structuredControlLines.length > 0
      ? [
          "Structured response control:",
          "Apply the following controls implicitly. Do not mention memory, earlier notes, or learned rules unless the user directly asks.",
          ...structuredControlLines,
        ].join("\n")
      : undefined,
    steeringLines.length > 0
      ? [
          "Behavioral steering:",
          "Apply the following guidance implicitly. Do not mention memory, earlier notes, or learned rules unless the user directly asks.",
          ...steeringLines,
        ].join("\n")
      : undefined,
  ]
    .filter(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0,
    )
    .join("\n");

  return {
    mode: "fragment",
    content,
    estimatedTokens: estimateTextTokens(content),
    omittedSections: [...input.builtContext.omittedSections],
    ...(input.rawRecordRefs.length > 0
      ? { recordRefs: input.rawRecordRefs }
      : {}),
  };
}

function resolveProgressiveRecallService(
  input: CreateGoodMemoryRuntimeKitInput,
): ProgressiveRecallService | null {
  if (input.progressiveRecall) {
    return input.progressiveRecall;
  }

  if (!input.progressive) {
    return null;
  }

  return createProgressiveRecallService({
    memory: input.memory,
    scopeDigestSecret: input.progressive.scopeDigestSecret,
    maxDetailPreviewChars: input.progressive.maxDetailPreviewChars,
  });
}

async function emitRuntimeEvent(
  callback: CreateGoodMemoryRuntimeKitInput["onRuntimeEvent"],
  event: RuntimeKitEvent,
): Promise<void> {
  if (!callback) {
    return;
  }

  try {
    await callback(event);
  } catch (error) {
    console.error("GoodMemory runtime-kit event callback failed.", error);
  }
}

function createDefaultHostAdapter(input: {
  hostKind: HostKind;
  memory: GoodMemory;
}) {
  return createHostAdapter({
    id: `${input.hostKind}-runtime-kit`,
    hostKind: input.hostKind,
    memory: input.memory,
  });
}

export function createGoodMemoryRuntimeKit(
  input: CreateGoodMemoryRuntimeKitInput,
): GoodMemoryRuntimeKit {
  const language = readGoodMemoryIntegrationSupport(input.memory)?.language;
  const progressiveRecall = resolveProgressiveRecallService(input);
  const defaultContextMode = input.defaultContextMode ?? "fragment";
  const defaultMaxMemoryTokens =
    input.defaultMaxMemoryTokens ?? DEFAULT_MAX_MEMORY_TOKENS;
  const scopeDigestSecret =
    input.scopeDigestSecret ?? input.progressive?.scopeDigestSecret ?? randomUUID();
  const runtimeTracer = createGoodMemoryTracer(
    {
      scopeDigestSecret,
    },
    () => new Date(),
  );

  async function recordEvent(event: RuntimeKitEvent): Promise<RuntimeKitEvent> {
    await emitRuntimeEvent(input.onRuntimeEvent, event);
    return event;
  }

  async function recordScopedEvent(
    scope: MemoryScope,
    event: Omit<RuntimeKitEvent, "scopeDigest">,
  ): Promise<RuntimeKitEvent> {
    return await recordEvent({
      ...event,
      scopeDigest: runtimeTracer.digestScope(scope),
    });
  }

  async function buildFragmentContext(
    callInput: RuntimeKitBeforeModelCallInput,
    query: string,
  ): Promise<{
    context: RuntimeKitMemoryContext;
    recall: RecallResult;
  }> {
    const recall = await input.memory.recall({
      scope: callInput.scope,
      query,
      locale: callInput.locale,
      retrievalProfile: callInput.retrievalProfile,
      ignoreMemory: false,
      referenceTime: callInput.referenceTime,
      timezone: callInput.timezone,
      ...(input.evidenceLedgerFormat ? { includeEvidence: true } : {}),
    });
    const builtContext = await input.memory.buildContext({
      recall,
      output: "system_prompt_fragment",
      maxTokens: callInput.maxMemoryTokens ?? defaultMaxMemoryTokens,
      ...(input.evidenceLedgerFormat
        ? { evidenceLedgerFormat: input.evidenceLedgerFormat }
        : {}),
    });
    const rawCarryover = await (async (): Promise<
      RawCarryoverResolution | undefined
    > => {
      try {
        const exported = await input.memory.exportMemory({
          includeRuntime: callInput.includeRuntime,
          scope: callInput.scope,
        });
        const rawSurfaceFamily: RawBehavioralSurfaceFamily =
          (callInput.retrievalProfile ?? "general_chat") === "coding_agent"
            ? "host_action"
            : "text_response";
        const referenceTime = callInput.referenceTime;
        const isAtOrBeforeReferenceTime = (value: string): boolean =>
          referenceTime === undefined ||
          (isRfc3339Instant(value) &&
            Date.parse(value) <= Date.parse(referenceTime));
        const rawIndex = buildRawBehavioralPrototypeIndex({
          memoryExport: {
            durable: {
              experiences: exported.durable.experiences.filter((experience) =>
                isAtOrBeforeReferenceTime(experience.createdAt),
              ),
            },
            scope: exported.scope,
          },
          recallHints: {
            candidateTraces: recall.metadata.candidateTraces,
            hits: recall.metadata.hits,
          },
          retrievalProfile: callInput.retrievalProfile ?? "general_chat",
          surfaceHint: rawSurfaceFamily,
        });

        return resolveRawBehavioralCarryover({
          index: rawIndex,
          maxExemplars: rawSurfaceFamily === "host_action" ? 4 : 3,
          query,
          surfaceFamily: rawSurfaceFamily,
        });
      } catch {
        return undefined;
      }
    })();
    const rawScopeDigest = buildProgressiveScopeDigest({
      scope: callInput.scope,
      secret: scopeDigestSecret,
    });
    const rawRecordRefs = [
      ...new Set(rawCarryover?.packet?.sourceExperienceIds ?? []),
    ].map((experienceId) => encodeGoodMemoryRecordRef({
      id: experienceId,
      recordKind: "experience",
      scopeDigest: rawScopeDigest,
    }));

    return {
      context: applyBehavioralSteeringToFragment({
        builtContext,
        feedback: recall.feedback,
        query,
        rawCarryover,
        rawRecordRefs,
        retrievalProfile: callInput.retrievalProfile ?? "general_chat",
      }),
      recall,
    };
  }

  return {
    async sessionStart(
      callInput: RuntimeKitSessionStartInput,
    ): Promise<RuntimeKitSessionResult> {
      const started = await input.memory.runtime.startSession({
        scope: callInput.scope,
      });
      const event = await recordScopedEvent(callInput.scope, {
        phase: "sessionStart",
        status: "succeeded",
        traceId: started.traceId,
      });

      return {
        state: started.state,
        traceId: started.traceId,
        events: [event],
      };
    },

    async beforeModelCall(
      callInput: RuntimeKitBeforeModelCallInput,
    ): Promise<RuntimeKitBeforeModelCallResult> {
      assertRuntimeKitTemporalContext(callInput);
      const temporalContext = {
        referenceTime: callInput.referenceTime ?? new Date().toISOString(),
        ...(callInput.timezone !== undefined
          ? { timezone: callInput.timezone }
          : {}),
      };
      const resolvedCallInput = {
        ...callInput,
        ...temporalContext,
      };
      const requestedMode = callInput.contextMode ?? defaultContextMode;
      if (callInput.ignoreMemory) {
        const event = await recordScopedEvent(callInput.scope, {
          phase: "beforeModelCall",
          status: "skipped",
          reason: "ignore_memory",
          contextMode: requestedMode,
        });
        return {
          context: createEmptyContext(requestedMode),
          events: [event],
          ...temporalContext,
        };
      }

      const query = normalizeText(callInput.query) ??
        extractTextFromMessages(callInput.messages ?? []);
      if (!query) {
        const event = await recordScopedEvent(callInput.scope, {
          phase: "beforeModelCall",
          status: "skipped",
          reason: "no_query",
          contextMode: requestedMode,
        });
        return {
          context: createEmptyContext(requestedMode),
          events: [event],
          ...temporalContext,
        };
      }

      if (requestedMode === "progressive" && progressiveRecall) {
        const index = await progressiveRecall.searchRecallIndex({
          scope: callInput.scope,
          query,
          referenceTime: resolvedCallInput.referenceTime,
          includeRuntime: callInput.includeRuntime,
          retrievalProfile: callInput.retrievalProfile,
          timezone: resolvedCallInput.timezone,
        });
        const rendered = progressiveRecall.renderProgressiveContext({
          index,
          query,
          retrievalProfile: callInput.retrievalProfile,
          maxRecords:
            callInput.maxProgressiveRecords ?? DEFAULT_PROGRESSIVE_RECORD_LIMIT,
          maxTokens: callInput.maxMemoryTokens ?? defaultMaxMemoryTokens,
        });
        const event = await recordScopedEvent(callInput.scope, {
          phase: "beforeModelCall",
          status: rendered.content.trim() ? "applied" : "skipped",
          reason: rendered.content.trim() ? undefined : "empty_context",
          contextMode: "progressive",
        });

        return {
          context: {
            mode: "progressive",
            content: rendered.content,
            estimatedTokens: rendered.estimatedTokens,
            omittedSections: rendered.omittedRecordCount > 0
              ? [`records:${rendered.omittedRecordCount}`]
              : [],
            recordRefs: index.records.map((record) => record.recordRef),
          },
          events: [event],
          ...temporalContext,
        };
      }

      const fragment = await buildFragmentContext(resolvedCallInput, query);
      const event = await recordScopedEvent(callInput.scope, {
        phase: "beforeModelCall",
        status: fragment.context.content.trim() ? "applied" : "skipped",
        reason: fragment.context.content.trim() ? undefined : "empty_context",
        contextMode: "fragment",
        fallbackReason: requestedMode === "progressive"
          ? "progressive_unavailable"
          : undefined,
      });

      return {
        context: fragment.context,
        recall: fragment.recall,
        events: [event],
        ...temporalContext,
      };
    },

    async afterModelCall(
      callInput: RuntimeKitAfterModelCallInput,
    ): Promise<RuntimeKitAfterModelCallResult> {
      assertRuntimeKitTemporalContext(callInput);
      const referenceTime = callInput.referenceTime;
      const timezone = callInput.timezone;
      const writeback = callInput.writeback ?? { mode: "observe" };
      const mode = writeback.mode ?? "observe";
      const assistantText = normalizeText(callInput.assistantText);
      const latestUserMessage = findLatestUserMessage(callInput.messages);
      const userText = normalizeText(latestUserMessage?.content);
      const userMessage = latestUserMessage && userText
        ? { ...latestUserMessage, content: userText }
        : null;
      const preview = buildCandidatePreview({ assistantText, language, userText });
      const candidates: RuntimeKitWritebackCandidate[] = [];
      const boundedJobs: RuntimeKitBoundedJob[] = [];
      let rememberResult: RuntimeKitAfterModelCallResult["rememberResult"];

      if (mode === "observe" && preview) {
        candidates.push(createCandidate({ preview, reason: "observe" }));
        boundedJobs.push(createBoundedJob(preview));
      } else if (mode === "selective" && !shouldDurableWrite(writeback) && preview) {
        candidates.push(createCandidate({
          preview,
          reason: "selective_not_allowed",
        }));
        boundedJobs.push(createBoundedJob(preview));
      } else if (
        shouldDurableWrite(writeback) &&
        assistantText &&
        userMessage
      ) {
        rememberResult = await input.memory.remember(toRememberInput({
          scope: callInput.scope,
          locale: callInput.locale,
          referenceTime,
          timezone,
          userMessage,
          assistantText,
          assistantObservedAt: callInput.assistantObservedAt,
          assistantTimezone: callInput.assistantTimezone,
        }));
      }

      const event = await recordScopedEvent(callInput.scope, {
        phase: "afterModelCall",
        status: rememberResult || candidates.length > 0 ? "applied" : "skipped",
        reason:
          mode === "off"
            ? "writeback_off"
            : rememberResult || candidates.length > 0
              ? undefined
              : "no_candidate",
      });

      return {
        boundedJobs,
        candidates,
        events: [event],
        ...(rememberResult ? { rememberResult } : {}),
        trace: {
          candidateCount: candidates.length,
          rawTranscriptPersisted: false,
          rememberCalled: Boolean(rememberResult),
        },
      };
    },

    async sessionEnd(
      callInput: RuntimeKitSessionEndInput,
    ): Promise<RuntimeKitSessionResult> {
      const ended = await input.memory.runtime.endSession({
        scope: callInput.scope,
        archive: callInput.archive ?? "off",
      });
      const event = await recordScopedEvent(callInput.scope, {
        phase: "sessionEnd",
        status: "succeeded",
        traceId: ended.traceId,
      });

      return {
        state: ended.state,
        traceId: ended.traceId,
        events: [event],
      };
    },

    async preAction(
      callInput: RuntimeKitPreActionInput,
    ): Promise<RuntimeKitPreActionResult> {
      const adapter = input.hostAdapter ??
        createDefaultHostAdapter({
          hostKind: callInput.intent.hostKind,
          memory: input.memory,
        });
      const assessment = await adapter.assessAction(callInput.intent);
      const executionPlan = resolveHostActionExecutionPlan({
        assessment,
        intent: callInput.intent,
      });
      const event = await recordScopedEvent(callInput.intent.scope, {
        phase: "preAction",
        status: "applied",
        reason: assessment.decision,
      });

      return {
        assessment,
        executionPlan,
        events: [event],
      };
    },

    async observeToolResult(
      callInput: RuntimeKitObserveToolResultInput,
    ): Promise<RuntimeKitObserveToolResultResult> {
      const summary = redactRuntimeKitText(
        `${callInput.toolName}: ${callInput.summary}`,
        language,
      );
      const updated = await input.memory.runtime.updateSessionJournal({
        scope: callInput.scope,
        patch: {
          appendWorklog: [summary],
        },
      });
      const event = await recordScopedEvent(callInput.scope, {
        phase: "observeToolResult",
        status: "applied",
      });

      return {
        journal: updated.journal,
        events: [event],
      };
    },
  };
}
