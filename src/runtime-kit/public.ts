import { createHash } from "node:crypto";
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
  ProgressiveRecallService,
} from "../progressive/recall";
import type { MemoryScope } from "../domain/scope";
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
import { createProgressiveRecallService } from "../progressive/recall";
import { estimateTextTokens } from "../tokenEstimator";
import type { LanguageService } from "../language";
import { redactSensitiveCredentialText } from "../language/sensitive";

const DEFAULT_MAX_MEMORY_TOKENS = 160;
const DEFAULT_PROGRESSIVE_RECORD_LIMIT = 10;
const MAX_PREVIEW_CHARS = 240;

function normalizeText(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function extractTextFromMessages(messages: readonly { content: string; role: string }[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") {
      continue;
    }

    const text = normalizeText(message.content);
    if (text) {
      return text;
    }
  }

  return null;
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
  assistantText: string;
  locale?: string;
  scope: RememberInput["scope"];
  userText: string;
}): RememberInput {
  return {
    scope: input.scope,
    locale: input.locale,
    messages: [
      {
        role: "user",
        content: input.userText,
      },
      {
        role: "assistant",
        content: input.assistantText,
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
  const runtimeTracer = createGoodMemoryTracer(
    {
      scopeDigestSecret:
        input.scopeDigestSecret ?? input.progressive?.scopeDigestSecret,
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
        const runtimeState =
          callInput.includeRuntime === false
            ? null
            : await input.memory.runtime.getState({ scope: callInput.scope }).catch(
                () => null,
              );
        const exported = await input.memory.exportMemory({
          includeRuntime: callInput.includeRuntime,
          scope: callInput.scope,
        });
        const rawSurfaceFamily: RawBehavioralSurfaceFamily =
          (callInput.retrievalProfile ?? "general_chat") === "coding_agent"
            ? "host_action"
            : "text_response";
        const runtimeMessages =
          runtimeState?.state?.buffer?.messages
            ?.map((message) => ({
              content: message.content,
              role: message.role,
            }))
            .filter((message) => message.content.trim().length > 0) ?? [];
        const rawIndex = buildRawBehavioralPrototypeIndex({
          memoryExport: {
            durable: {
              archives: exported.durable.archives,
              episodes: exported.durable.episodes,
              experiences: exported.durable.experiences,
            },
            scope: exported.scope,
          },
          recallHints: {
            candidateTraces: recall.metadata.candidateTraces,
            hits: recall.metadata.hits,
          },
          runtimeMessages,
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

    return {
      context: applyBehavioralSteeringToFragment({
        builtContext,
        feedback: recall.feedback,
        query,
        rawCarryover,
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
        };
      }

      if (requestedMode === "progressive" && progressiveRecall) {
        const index = await progressiveRecall.searchRecallIndex({
          scope: callInput.scope,
          query,
          includeRuntime: callInput.includeRuntime,
          retrievalProfile: callInput.retrievalProfile,
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
        };
      }

      const fragment = await buildFragmentContext(callInput, query);
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
      };
    },

    async afterModelCall(
      callInput: RuntimeKitAfterModelCallInput,
    ): Promise<RuntimeKitAfterModelCallResult> {
      const writeback = callInput.writeback ?? { mode: "observe" };
      const mode = writeback.mode ?? "observe";
      const assistantText = normalizeText(callInput.assistantText);
      const userText = extractTextFromMessages(callInput.messages);
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
        userText
      ) {
        rememberResult = await input.memory.remember(toRememberInput({
          scope: callInput.scope,
          locale: callInput.locale,
          userText,
          assistantText,
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
