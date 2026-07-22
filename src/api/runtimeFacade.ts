import type { GoodMemoryTracer } from "../observability/tracer";
import type { MemoryScope } from "../domain/scope";
import {
  createRuntimeContextService,
  type RuntimeExtractionHooks,
} from "../runtime/contextService";
import { createRuntimeArchiveStore } from "../runtime/public";
import type { MemoryExtractionStrategy } from "../remember/candidates";
import type { LanguageService } from "../language";
import { createExtractionCursorStore } from "../remember/extractionCursor";
import type {
  DocumentStore,
  SessionStore,
} from "../storage/contracts";
import { isProjectionCapableDocumentStore } from "../storage/contracts";
import type { ScopeDeletionCoordinator } from "../storage/scopeDeletion";
import type {
  GoodMemoryRuntimeAppendMessageInput,
  GoodMemoryRuntimeBufferResult,
  GoodMemoryRuntimeEndSessionInput,
  GoodMemoryRuntimeFacade,
  GoodMemoryRuntimeGetRecallSnapshotInput,
  GoodMemoryRuntimeRecallSnapshotResult,
  GoodMemoryRuntimeSetSessionSummaryInput,
  GoodMemoryRuntimeStartSessionInput,
  GoodMemoryRuntimeStateResult,
  GoodMemoryRuntimeUpdateSessionJournalInput,
  GoodMemoryRuntimeUpdateWorkingMemoryInput,
  GoodMemoryRuntimeSessionJournalResult,
  GoodMemoryRuntimeWorkingMemoryResult,
  RememberInput,
  RememberResult,
} from "./contracts";

export interface GoodMemoryRuntimeFacadeConfig {
  documentStore: DocumentStore;
  language?: LanguageService;
  scopeDeletion?: ScopeDeletionCoordinator;
  sessionStore: SessionStore;
  now: () => Date;
  runtimeCompactionExtraction?: {
    extractionStrategy: MemoryExtractionStrategy;
    remember(input: RememberInput): Promise<RememberResult>;
  };
  tracer: GoodMemoryTracer;
}

function createRuntimeExtractionHooks(
  config: GoodMemoryRuntimeFacadeConfig,
): RuntimeExtractionHooks | undefined {
  const runtimeExtraction = config.runtimeCompactionExtraction;
  if (!runtimeExtraction) {
    return undefined;
  }
  if (!isProjectionCapableDocumentStore(config.documentStore)) {
    throw new Error(
      "Runtime compaction extraction requires an atomic document store.",
    );
  }
  return {
    cursorStore: createExtractionCursorStore({
      documentStore: config.documentStore,
      now: () => config.now().toISOString(),
    }),
    async extract({ messages, scope }) {
      const result = await runtimeExtraction.remember({
        extractionStrategy: runtimeExtraction.extractionStrategy,
        messages,
        scope,
      });
      return result.outcome ?? "failed";
    },
  };
}

function resolveEndSessionArchiveOptions(
  input: GoodMemoryRuntimeEndSessionInput,
): Parameters<ReturnType<typeof createRuntimeContextService>["endSession"]>[1] {
  if (input.archive === undefined || input.archive === "off") {
    return { archive: "off" };
  }

  return {
    archive: {
      mode: "summary_only",
      includeNormalizedTranscript: false,
    },
  };
}

export function createGoodMemoryRuntimeFacade(
  config: GoodMemoryRuntimeFacadeConfig,
): GoodMemoryRuntimeFacade {
  const runtime = createRuntimeContextService({
    sessionStore: config.sessionStore,
    archiveStore: createRuntimeArchiveStore({
      documentStore: config.documentStore,
    }),
    extraction: createRuntimeExtractionHooks(config),
    language: config.language,
    now: () => config.now().toISOString(),
  });
  const runMutation = <T>(
    scope: MemoryScope,
    operation: () => Promise<T>,
  ): Promise<T> => config.scopeDeletion
    ? config.scopeDeletion.runMutation(scope, operation)
    : operation();

  return {
    async startSession(
      input: GoodMemoryRuntimeStartSessionInput,
    ): Promise<GoodMemoryRuntimeStateResult> {
      return runMutation(input.scope, async () => {
        const trace = await config.tracer.start({
          name: "runtime.session.start",
          scope: input.scope,
          attributes: {
            hasSessionId: Boolean(input.scope.sessionId),
          },
        });

        try {
          const state = await runtime.startSession(input.scope);
          await trace.succeeded({
            attributes: {
              bufferedMessageCount: state.buffer.messages.length,
            },
          });

          return {
            state,
            ...(trace.traceId ? { traceId: trace.traceId } : {}),
          };
        } catch (error) {
          await trace.failed({ error });
          throw error;
        }
      });
    },

    async getState(
      input: GoodMemoryRuntimeStartSessionInput,
    ): Promise<GoodMemoryRuntimeStateResult> {
      return runMutation(input.scope, async () => ({
        state: await runtime.getRuntimeState(input.scope),
      }));
    },

    async appendMessage(
      input: GoodMemoryRuntimeAppendMessageInput,
    ): Promise<GoodMemoryRuntimeBufferResult> {
      return runMutation(input.scope, async () => ({
        buffer: await runtime.appendToSession(input.scope, input.message),
      }));
    },

    async setSessionSummary(
      input: GoodMemoryRuntimeSetSessionSummaryInput,
    ): Promise<GoodMemoryRuntimeBufferResult> {
      return runMutation(input.scope, async () => ({
        buffer: await runtime.setSessionSummary(input.scope, {
          summary: input.summary,
          summaryUpToIndex: input.summaryUpToIndex,
        }),
      }));
    },

    async updateWorkingMemory(
      input: GoodMemoryRuntimeUpdateWorkingMemoryInput,
    ): Promise<GoodMemoryRuntimeWorkingMemoryResult> {
      return runMutation(input.scope, async () => ({
        workingMemory: await runtime.updateWorkingMemory(input.scope, input.patch),
      }));
    },

    async updateSessionJournal(
      input: GoodMemoryRuntimeUpdateSessionJournalInput,
    ): Promise<GoodMemoryRuntimeSessionJournalResult> {
      return runMutation(input.scope, async () => ({
        journal: await runtime.updateSessionJournal(input.scope, input.patch),
      }));
    },

    async getRecallSnapshot(
      input: GoodMemoryRuntimeGetRecallSnapshotInput,
    ): Promise<GoodMemoryRuntimeRecallSnapshotResult> {
      return runMutation(input.scope, async () => ({
        snapshot: await runtime.getRuntimeRecall(
          input.scope,
          input.retrievalProfile ?? "general_chat",
        ),
      }));
    },

    async endSession(
      input: GoodMemoryRuntimeEndSessionInput,
    ): Promise<GoodMemoryRuntimeStateResult> {
      return runMutation(input.scope, async () => {
        const archiveOptions = resolveEndSessionArchiveOptions(input);
        const archive = archiveOptions?.archive;
        const archiveMode =
          archive === "off"
            ? "off"
            : archive === "auto"
              ? "auto"
            : archive?.mode ?? "off";
        const trace = await config.tracer.start({
          name: "runtime.session.end",
          scope: input.scope,
          attributes: {
            archiveMode,
            includeNormalizedTranscript: false,
          },
        });

        try {
          const state = await runtime.endSession(input.scope, archiveOptions);
          await trace.succeeded({
            attributes: {
              archiveMode,
              bufferedMessageCount: state.buffer.messages.length,
              includeNormalizedTranscript: false,
            },
          });

          return {
            state,
            ...(trace.traceId ? { traceId: trace.traceId } : {}),
          };
        } catch (error) {
          await trace.failed({ error });
          throw error;
        }
      });
    },
  };
}
