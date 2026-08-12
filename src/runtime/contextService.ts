import {
  createSessionBuffer,
  createSessionJournal,
  createWorkingMemorySnapshot,
} from "../domain/records";
import type {
  SessionBuffer,
  SessionJournal,
  SessionMessage,
  WorkingMemorySnapshot,
} from "../domain/records";
import type { MemoryScope } from "../domain/scope";
import { assertTemporalMessageContext } from "../domain/temporal";
import { scopeToKey } from "../domain/scope";
import {
  createLanguageService,
  type LanguageService,
  type ResolvedLanguageContext,
} from "../language";
import type { ExtractionOutcome } from "../remember/contracts";
import type { ExtractionCursorStore } from "../remember/extractionCursor";
import {
  createSessionArchive,
} from "../domain/evolutionRecords";
import type { SessionArchive } from "../domain/evolutionRecords";
import type { SessionStore } from "../storage/contracts";

export interface RuntimeArchiveStore {
  add(archive: SessionArchive): Promise<void>;
}

export interface PreCompactSalvageInput {
  evictedMessages: SessionMessage[];
  nextMessage: SessionMessage;
  nextMessages: SessionMessage[];
  scope: MemoryScope;
  overflowCount: number;
  runtimeState: RuntimeContextState;
}

export interface SessionEndSalvageInput {
  scope: MemoryScope;
  archive: SessionArchive;
}

export interface RuntimeSalvageHooks {
  onPreCompact?(input: PreCompactSalvageInput): Promise<void>;
  onSessionEnd?(input: SessionEndSalvageInput): Promise<void>;
}

export interface RuntimeExtractionInput {
  from: number;
  messages: SessionMessage[];
  scope: MemoryScope;
  sourceId: string;
  through: number;
}

export interface RuntimeExtractionHooks {
  cursorStore: ExtractionCursorStore;
  extract(input: RuntimeExtractionInput): Promise<ExtractionOutcome>;
}

export interface RuntimeContextServiceConfig {
  sessionStore: SessionStore;
  archiveStore?: RuntimeArchiveStore;
  extraction?: RuntimeExtractionHooks;
  language?: LanguageService;
  salvageHooks?: RuntimeSalvageHooks;
  now?: () => string;
  createMessageId?: () => string;
  createArchiveId?: () => string;
  maxBufferedMessages?: number;
}

export interface RuntimeContextState {
  buffer: SessionBuffer;
  workingMemory: WorkingMemorySnapshot;
  journal: SessionJournal;
}

export interface WorkingMemoryPatch {
  currentGoal?: string | null;
  constraints?: string[] | null;
  openLoops?: string[];
  resolvedOpenLoops?: string[];
  temporaryDecisions?: string[] | null;
  toolState?: Record<string, unknown> | null;
  state?: Record<string, unknown> | null;
}

export interface SessionSummaryInput {
  summary: string;
  summaryUpToIndex: number;
}

export interface SessionJournalPatch {
  title?: string;
  currentState?: string;
  taskSpecification?: string;
  filesAndFunctions?: string[];
  workflow?: string[];
  errorsAndCorrections?: string[];
  systemDocumentation?: string[];
  learnings?: string[];
  keyResults?: string[];
  worklog?: string[];
  appendWorklog?: string[];
  lastSummarizedMessageId?: string;
}

export interface RuntimeRecallSnapshot {
  buffer: SessionBuffer | null;
  workingMemory: WorkingMemorySnapshot | null;
  journal: SessionJournal | null;
}

export interface RuntimeEndSessionArchiveOptions {
  mode: "summary_only";
  includeNormalizedTranscript?: boolean;
}

export interface RuntimeEndSessionOptions {
  archive?: "auto" | "off" | RuntimeEndSessionArchiveOptions;
}

type SessionLifecycleStatus = "active" | "ended";

function mergeUnique(existing: string[], next: string[]): string[] {
  return [...new Set([...existing, ...next])];
}

function shallowMergeRecord(
  current: Record<string, unknown> | undefined,
  patch: Record<string, unknown> | null | undefined,
): Record<string, unknown> | undefined {
  if (patch === null) {
    return undefined;
  }

  if (patch === undefined) {
    return current;
  }

  return {
    ...(current ?? {}),
    ...patch,
  };
}

function hasRuntimeSignal(snapshot: WorkingMemorySnapshot): boolean {
  return Boolean(
    snapshot.currentGoal ||
      (snapshot.constraints?.length ?? 0) > 0 ||
      snapshot.openLoops.length > 0 ||
      (snapshot.temporaryDecisions?.length ?? 0) > 0,
  );
}

function hasJournalSignal(journal: SessionJournal): boolean {
  return Boolean(
    journal.title ||
      journal.currentState ||
      journal.taskSpecification ||
      (journal.filesAndFunctions?.length ?? 0) > 0 ||
      (journal.workflow?.length ?? 0) > 0 ||
      (journal.errorsAndCorrections?.length ?? 0) > 0 ||
      (journal.systemDocumentation?.length ?? 0) > 0 ||
      (journal.learnings?.length ?? 0) > 0 ||
      (journal.keyResults?.length ?? 0) > 0 ||
      journal.worklog.length > 0,
  );
}

function hasArchiveSignal(state: RuntimeContextState): boolean {
  return Boolean(
    state.buffer.summary ||
      (state.buffer.compactedMessages?.length ?? 0) > 0 ||
      state.buffer.messages.length > 0 ||
      hasRuntimeSignal(state.workingMemory) ||
      hasJournalSignal(state.journal),
  );
}

function messagesForReplay(buffer: SessionBuffer): SessionMessage[] {
  const compactedMessages = buffer.compactedMessages ?? [];
  const compactedIds = new Set(
    compactedMessages.flatMap(({ id }) => id === undefined ? [] : [id]),
  );
  return [
    ...compactedMessages,
    ...buffer.messages.filter(({ id }) =>
      id === undefined || !compactedIds.has(id)
    ),
  ];
}

function bufferHasMessageId(buffer: SessionBuffer, messageId: string): boolean {
  return [
    ...(buffer.compactedMessages ?? []),
    ...buffer.messages,
  ].some(({ id }) => id === messageId);
}

function appendCompactedMessages(
  existing: readonly SessionMessage[],
  evicted: readonly SessionMessage[],
): SessionMessage[] {
  const existingIds = new Set(
    existing.flatMap(({ id }) => id === undefined ? [] : [id]),
  );
  return [
    ...existing,
    ...evicted.filter(({ id }) => id === undefined || !existingIds.has(id)),
  ];
}

function renderNormalizedTranscript(messages: SessionMessage[]): string | undefined {
  if (messages.length === 0) {
    return undefined;
  }

  return messages.map((message) => `${message.role}: ${message.content}`).join("\n");
}

function renderArchiveListSegment(
  label: string,
  values: string[],
): string | undefined {
  if (values.length === 0) {
    return undefined;
  }

  return `${label}: ${values.join("; ")}`;
}

function buildArchiveSummary(
  state: RuntimeContextState,
  language: LanguageService,
  languageContext: ResolvedLanguageContext,
): string {
  const keyDecisions = mergeUnique(
    state.workingMemory.temporaryDecisions ?? [],
    state.journal.keyResults ?? [],
  );
  const summarySegments = [
    state.buffer.summary ?? undefined,
    state.journal.currentState ?? undefined,
    state.workingMemory.currentGoal
      ? `${language.render({ key: "current_goal" }, languageContext)}: ${state.workingMemory.currentGoal}.`
      : undefined,
    renderArchiveListSegment(
      language.render({ key: "key_decisions" }, languageContext),
      keyDecisions,
    ),
    renderArchiveListSegment(
      language.render({ key: "open_loops" }, languageContext),
      state.workingMemory.openLoops,
    ),
    state.journal.worklog.at(-1),
  ].filter((segment): segment is string => Boolean(segment));

  return summarySegments.join(" ").trim() || language.render(
    { key: "session_ended_without_summary" },
    languageContext,
  );
}

function shouldArchiveSession(
  state: RuntimeContextState,
  options: RuntimeEndSessionOptions | undefined,
): boolean {
  return options?.archive !== "off" && hasArchiveSignal(state);
}

function shouldIncludeNormalizedTranscript(
  options: RuntimeEndSessionOptions | undefined,
): boolean {
  const archiveOptions = options?.archive ?? "auto";
  if (archiveOptions === "off") {
    return false;
  }
  if (archiveOptions === "auto") {
    return true;
  }

  return archiveOptions.includeNormalizedTranscript !== false;
}

async function runBestEffortSalvage(
  stage: "pre-compact" | "session-end",
  operation: () => Promise<void>,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    console.error(`Runtime salvage hook failed during ${stage}`, error);
  }
}

export function createRuntimeContextService(config: RuntimeContextServiceConfig) {
  const now = config.now ?? (() => new Date().toISOString());
  const language = config.language ?? createLanguageService();
  const createMessageId = config.createMessageId ?? (() => crypto.randomUUID());
  const createArchiveId = config.createArchiveId ?? (() => crypto.randomUUID());
  const maxBufferedMessages = Math.max(config.maxBufferedMessages ?? 24, 1);
  const lifecycle = new Map<string, SessionLifecycleStatus>();
  const sessionLocks = new Map<string, Promise<void>>();

  async function withSessionLock<TResult>(
    scope: MemoryScope,
    operation: () => Promise<TResult>,
  ): Promise<TResult> {
    const key = scopeToKey(scope);
    const previous = sessionLocks.get(key) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    sessionLocks.set(key, tail);
    await previous;

    try {
      return await operation();
    } finally {
      release();
      if (sessionLocks.get(key) === tail) {
        sessionLocks.delete(key);
      }
    }
  }

  async function extractDurableMessages(
    scope: MemoryScope,
    buffer: SessionBuffer,
    messages: SessionMessage[],
  ): Promise<ExtractionOutcome | undefined> {
    const extraction = config.extraction;
    if (!extraction) {
      return undefined;
    }
    const sourceId = `session:${buffer.sessionId}:${buffer.createdAt}`;
    let from: number;
    try {
      const cursor = await extraction.cursorStore.get(scope, sourceId);
      from = Math.min(cursor?.committedThrough ?? 0, messages.length);
    } catch (error) {
      console.error("[goodmemory:runtime-extraction] cursor read failed", {
        error: error instanceof Error ? error.message : "unknown error",
      });
      return "failed";
    }
    if (from >= messages.length) {
      return "committed";
    }

    let outcome: ExtractionOutcome;
    let errorCode: string | undefined;
    try {
      outcome = await extraction.extract({
        from,
        messages: messages.slice(from),
        scope,
        sourceId,
        through: messages.length,
      });
    } catch (error) {
      outcome = "failed";
      errorCode = "runtime_extraction_failed";
      console.error("[goodmemory:runtime-extraction] extraction failed", {
        error: error instanceof Error ? error.message : "unknown error",
        from,
        through: messages.length,
      });
    }

    try {
      const cursor = await extraction.cursorStore.record({
        ...(errorCode ? { errorCode } : {}),
        outcome,
        scope,
        sourceId,
        through: messages.length,
      });
      if (cursor.committedThrough < messages.length) {
        return "failed";
      }
    } catch (error) {
      console.error("[goodmemory:runtime-extraction] cursor commit failed", {
        error: error instanceof Error ? error.message : "unknown error",
        from,
        outcome,
        through: messages.length,
      });
      return "failed";
    }
    return outcome === "failed" ? "committed" : outcome;
  }

  function requireSessionScope(scope: MemoryScope): Required<
    Pick<MemoryScope, "sessionId" | "userId">
  > &
    MemoryScope {
    if (!scope.sessionId) {
      throw new Error("Runtime context requires scope.sessionId");
    }

    return {
      ...scope,
      sessionId: scope.sessionId,
    };
  }

  async function createFreshState(
    scope: Required<Pick<MemoryScope, "sessionId" | "userId">> & MemoryScope,
  ): Promise<RuntimeContextState> {
    const timestamp = now();
    const buffer = createSessionBuffer({
      sessionId: scope.sessionId,
      userId: scope.userId,
      createdAt: timestamp,
      lastActiveAt: timestamp,
    });
    const workingMemory = createWorkingMemorySnapshot({
      sessionId: scope.sessionId,
      userId: scope.userId,
      updatedAt: timestamp,
    });
    const journal = createSessionJournal({
      sessionId: scope.sessionId,
      userId: scope.userId,
      updatedAt: timestamp,
    });

    await config.sessionStore.saveBuffer(scope, buffer);
    await config.sessionStore.saveWorkingMemory(scope, workingMemory);
    await config.sessionStore.saveJournal(scope, journal);
    lifecycle.set(scopeToKey(scope), "active");

    return {
      buffer,
      workingMemory,
      journal,
    };
  }

  async function ensureActiveState(
    scope: Required<Pick<MemoryScope, "sessionId" | "userId">> & MemoryScope,
  ): Promise<RuntimeContextState> {
    const key = scopeToKey(scope);

    if (lifecycle.get(key) === "ended") {
      throw new Error(`Runtime session ${scope.sessionId} has ended`);
    }

    const [buffer, workingMemory, journal] = await Promise.all([
      config.sessionStore.getBuffer(scope),
      config.sessionStore.getWorkingMemory(scope),
      config.sessionStore.getJournal(scope),
    ]);

    if (!buffer || !workingMemory || !journal) {
      return createFreshState(scope);
    }

    lifecycle.set(key, "active");

    return {
      buffer,
      workingMemory,
      journal,
    };
  }

  const unlocked = {
    async startSession(scope: MemoryScope): Promise<RuntimeContextState> {
      const sessionScope = requireSessionScope(scope);
      if (config.extraction) {
        const pending = await config.sessionStore.getBuffer(sessionScope);
        if (pending) {
          const outcome = await extractDurableMessages(
            sessionScope,
            pending,
            messagesForReplay(pending),
          );
          if (outcome === "failed") {
            throw new Error("Runtime session has pending memory extraction.");
          }
        }
      }
      return createFreshState(sessionScope);
    },

    async getRuntimeState(scope: MemoryScope): Promise<RuntimeContextState> {
      return ensureActiveState(requireSessionScope(scope));
    },

    async appendToSession(
      scope: MemoryScope,
      message: SessionMessage,
    ): Promise<SessionBuffer> {
      assertTemporalMessageContext(message);
      const sessionScope = requireSessionScope(scope);
      const timestamp = now();
      const nextMessage = {
        id: message.id ?? createMessageId(),
        role: message.role,
        content: message.content,
        ...(message.observedAt !== undefined
          ? { observedAt: message.observedAt }
          : {}),
        ...(message.timezone !== undefined
          ? { timezone: message.timezone }
          : {}),
      };
      let state = await ensureActiveState(sessionScope);

      while (true) {
        if (bufferHasMessageId(state.buffer, nextMessage.id)) {
          return state.buffer;
        }

        const compactedMessages = state.buffer.compactedMessages ?? [];
        const compactedIds = new Set(
          compactedMessages.flatMap(({ id }) => id === undefined ? [] : [id]),
        );
        const liveMessages = state.buffer.messages.filter(({ id }) =>
          id === undefined || !compactedIds.has(id)
        );
        const nextMessages = [
          ...liveMessages,
          nextMessage,
        ];
        const pendingBuffer = createSessionBuffer({
          ...state.buffer,
          messages: nextMessages,
          compactedMessages,
          lastActiveAt: timestamp,
        });

        if (nextMessages.length <= maxBufferedMessages) {
          if (await config.sessionStore.saveBufferIfUnchanged(
            sessionScope,
            state.buffer,
            pendingBuffer,
          )) {
            return pendingBuffer;
          }

          const latestBuffer = await config.sessionStore.getBuffer(sessionScope);
          state = latestBuffer
            ? { ...state, buffer: latestBuffer }
            : await ensureActiveState(sessionScope);
          continue;
        }

        const overflow = nextMessages.length - maxBufferedMessages;
        const evictedMessages = nextMessages.slice(0, overflow);
        const durableCompactedMessages = appendCompactedMessages(
          compactedMessages,
          evictedMessages,
        );
        const compactionSummary = state.buffer.summary ?? language.render(
          { key: "earlier_messages_compacted" },
          language.resolveFromMessages({ messages: nextMessages }),
        );
        const durablePendingBuffer = createSessionBuffer({
          ...pendingBuffer,
          compactedMessages: durableCompactedMessages,
          summary: compactionSummary,
          summaryUpToIndex: state.buffer.summaryUpToIndex + overflow,
        });
        if (!(await config.sessionStore.saveBufferIfUnchanged(
          sessionScope,
          state.buffer,
          durablePendingBuffer,
        ))) {
          const latestBuffer = await config.sessionStore.getBuffer(sessionScope);
          state = latestBuffer
            ? { ...state, buffer: latestBuffer }
            : await ensureActiveState(sessionScope);
          continue;
        }

        await extractDurableMessages(
          sessionScope,
          durablePendingBuffer,
          durableCompactedMessages,
        );
        const onPreCompact = config.salvageHooks?.onPreCompact;
        if (onPreCompact) {
          await runBestEffortSalvage("pre-compact", async () => {
            await onPreCompact({
              evictedMessages,
              nextMessage,
              nextMessages,
              scope: sessionScope,
              overflowCount: overflow,
              runtimeState: state,
            });
          });
        }
        const buffer = createSessionBuffer({
          ...durablePendingBuffer,
          messages: nextMessages.slice(overflow),
        });
        if (await config.sessionStore.saveBufferIfUnchanged(
          sessionScope,
          durablePendingBuffer,
          buffer,
        )) {
          return buffer;
        }

        const latestBuffer = await config.sessionStore.getBuffer(sessionScope);
        state = latestBuffer
          ? { ...state, buffer: latestBuffer }
          : await ensureActiveState(sessionScope);
      }
    },

    async setSessionSummary(
      scope: MemoryScope,
      input: SessionSummaryInput,
    ): Promise<SessionBuffer> {
      const sessionScope = requireSessionScope(scope);
      const state = await ensureActiveState(sessionScope);
      const buffer = createSessionBuffer({
        ...state.buffer,
        summary: input.summary,
        summaryUpToIndex: Math.max(
          state.buffer.summaryUpToIndex,
          input.summaryUpToIndex,
        ),
        lastActiveAt: now(),
      });

      await config.sessionStore.saveBuffer(sessionScope, buffer);
      return buffer;
    },

    async updateWorkingMemory(
      scope: MemoryScope,
      patch: WorkingMemoryPatch,
    ): Promise<WorkingMemorySnapshot> {
      const sessionScope = requireSessionScope(scope);
      const state = await ensureActiveState(sessionScope);

      const openLoops = mergeUnique(state.workingMemory.openLoops, patch.openLoops ?? [])
        .filter((item) => !(patch.resolvedOpenLoops ?? []).includes(item));

      const workingMemory = createWorkingMemorySnapshot({
        ...state.workingMemory,
        currentGoal:
          patch.currentGoal === undefined
            ? state.workingMemory.currentGoal
            : patch.currentGoal ?? undefined,
        constraints:
          patch.constraints === undefined
            ? state.workingMemory.constraints
            : patch.constraints ?? undefined,
        openLoops,
        temporaryDecisions:
          patch.temporaryDecisions === undefined
            ? state.workingMemory.temporaryDecisions
            : patch.temporaryDecisions ?? undefined,
        toolState: shallowMergeRecord(state.workingMemory.toolState, patch.toolState),
        state: shallowMergeRecord(state.workingMemory.state, patch.state),
        updatedAt: now(),
      });

      await config.sessionStore.saveWorkingMemory(sessionScope, workingMemory);
      return workingMemory;
    },

    async updateSessionJournal(
      scope: MemoryScope,
      patch: SessionJournalPatch,
    ): Promise<SessionJournal> {
      const sessionScope = requireSessionScope(scope);
      const state = await ensureActiveState(sessionScope);
      const journal = createSessionJournal({
        ...state.journal,
        title: patch.title ?? state.journal.title,
        currentState: patch.currentState ?? state.journal.currentState,
        taskSpecification:
          patch.taskSpecification ?? state.journal.taskSpecification,
        filesAndFunctions:
          patch.filesAndFunctions ?? state.journal.filesAndFunctions,
        workflow: patch.workflow ?? state.journal.workflow,
        errorsAndCorrections:
          patch.errorsAndCorrections ?? state.journal.errorsAndCorrections,
        systemDocumentation:
          patch.systemDocumentation ?? state.journal.systemDocumentation,
        learnings: patch.learnings ?? state.journal.learnings,
        keyResults: patch.keyResults ?? state.journal.keyResults,
        worklog: patch.worklog ?? [
          ...state.journal.worklog,
          ...(patch.appendWorklog ?? []),
        ],
        lastSummarizedMessageId:
          patch.lastSummarizedMessageId ?? state.journal.lastSummarizedMessageId,
        updatedAt: now(),
      });

      await config.sessionStore.saveJournal(sessionScope, journal);
      return journal;
    },

    async getRuntimeRecall(
      scope: MemoryScope,
      profile: "general_chat" | "coding_agent",
    ): Promise<RuntimeRecallSnapshot> {
      const sessionScope = requireSessionScope(scope);
      const state = await ensureActiveState(sessionScope);

      return {
        buffer: state.buffer,
        workingMemory: hasRuntimeSignal(state.workingMemory)
          ? state.workingMemory
          : null,
        journal: profile === "coding_agent" ? state.journal : null,
      };
    },

    async endSession(
      scope: MemoryScope,
      options?: RuntimeEndSessionOptions,
    ): Promise<RuntimeContextState> {
      const sessionScope = requireSessionScope(scope);
      const state = await ensureActiveState(sessionScope);
      const archivedAt = now();
      const replayMessages = messagesForReplay(state.buffer);

      const extractionOutcome = await extractDurableMessages(
        sessionScope,
        state.buffer,
        replayMessages,
      );
      if (extractionOutcome === "failed") {
        throw new Error("Runtime session has pending memory extraction.");
      }

      let archive: SessionArchive | undefined;

      if (config.archiveStore && shouldArchiveSession(state, options)) {
        const archiveLanguage = language.resolveFromMessages({
          messages: replayMessages,
        });
        archive = createSessionArchive({
          id: createArchiveId(),
          userId: sessionScope.userId,
          tenantId: sessionScope.tenantId,
          workspaceId: sessionScope.workspaceId,
          agentId: sessionScope.agentId,
          sessionId: sessionScope.sessionId,
          sourceSessionIds: [sessionScope.sessionId],
          summary: buildArchiveSummary(state, language, archiveLanguage),
          normalizedTranscript: shouldIncludeNormalizedTranscript(options)
            ? renderNormalizedTranscript(replayMessages)
            : undefined,
          keyDecisions: mergeUnique(
            state.workingMemory.temporaryDecisions ?? [],
            state.journal.keyResults ?? [],
          ),
          unresolvedItems: state.workingMemory.openLoops,
          referencedArtifacts: mergeUnique(
            state.journal.filesAndFunctions ?? [],
            state.journal.systemDocumentation ?? [],
          ),
          scopeLineage: [
            sessionScope.tenantId,
            sessionScope.workspaceId,
            sessionScope.agentId,
          ].filter((segment): segment is string => Boolean(segment)),
          locale: archiveLanguage.locale,
          createdAt: state.buffer.createdAt,
          archivedAt,
        });

        await config.archiveStore.add(archive);
      }

      const onSessionEnd = config.salvageHooks?.onSessionEnd;

      if (archive && onSessionEnd) {
        await runBestEffortSalvage("session-end", async () => {
          await onSessionEnd({
            scope: sessionScope,
            archive,
          });
        });
      }

      const bufferDeleted = await config.sessionStore.deleteBufferIfUnchanged(
        sessionScope,
        state.buffer,
      );
      if (!bufferDeleted) {
        throw new Error("Runtime session changed during close.");
      }

      await Promise.all([
        config.sessionStore.deleteWorkingMemoryByScope(sessionScope),
        config.sessionStore.deleteJournalsByScope(sessionScope),
      ]);
      lifecycle.set(scopeToKey(sessionScope), "ended");

      return state;
    },
  };

  return {
    startSession(scope: MemoryScope) {
      return withSessionLock(scope, () => unlocked.startSession(scope));
    },
    getRuntimeState(scope: MemoryScope) {
      return withSessionLock(scope, () => unlocked.getRuntimeState(scope));
    },
    appendToSession(scope: MemoryScope, message: SessionMessage) {
      return withSessionLock(scope, () => unlocked.appendToSession(scope, message));
    },
    setSessionSummary(scope: MemoryScope, input: SessionSummaryInput) {
      return withSessionLock(scope, () => unlocked.setSessionSummary(scope, input));
    },
    updateWorkingMemory(scope: MemoryScope, patch: WorkingMemoryPatch) {
      return withSessionLock(scope, () => unlocked.updateWorkingMemory(scope, patch));
    },
    updateSessionJournal(scope: MemoryScope, patch: SessionJournalPatch) {
      return withSessionLock(scope, () => unlocked.updateSessionJournal(scope, patch));
    },
    getRuntimeRecall(
      scope: MemoryScope,
      profile: "general_chat" | "coding_agent",
    ) {
      return withSessionLock(scope, () => unlocked.getRuntimeRecall(scope, profile));
    },
    endSession(scope: MemoryScope, options?: RuntimeEndSessionOptions) {
      return withSessionLock(scope, () => unlocked.endSession(scope, options));
    },
  };
}
