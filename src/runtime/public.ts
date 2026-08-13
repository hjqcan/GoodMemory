import type {
  SessionBuffer,
  SessionJournal,
  SessionMessage,
  WorkingMemorySnapshot,
} from "../domain/records";
import type { MemoryScope } from "../domain/scope";
import { assertStorageSafeExternalValue } from "../domain/semanticText";
import type { LanguageService } from "../language";
import type {
  DocumentStore,
  SessionStore,
} from "../storage/contracts";
import { SESSION_ARCHIVES_COLLECTION } from "../domain/evolutionRecords";
import {
  createRuntimeContextService as createInternalRuntimeContextService,
} from "./contextService";
import type {
  RuntimeArchiveStore,
  RuntimeContextState,
  RuntimeEndSessionOptions as InternalRuntimeEndSessionOptions,
  RuntimeRecallSnapshot,
  SessionJournalPatch,
  SessionSummaryInput,
  WorkingMemoryPatch,
} from "./contextService";

export type {
  RuntimeArchiveStore,
  RuntimeContextState,
  RuntimeRecallSnapshot,
  SessionJournalPatch,
  SessionSummaryInput,
  WorkingMemoryPatch,
} from "./contextService";

export interface RuntimeArchiveStoreConfig {
  documentStore: DocumentStore;
}

export interface RuntimeContextServiceConfig {
  sessionStore: SessionStore;
  archiveStore?: RuntimeArchiveStore;
  language?: LanguageService;
  now?: () => string;
  createMessageId?: () => string;
  createArchiveId?: () => string;
  maxBufferedMessages?: number;
}

export interface RuntimeEndSessionArchiveOptions {
  mode: "summary_only";
  includeNormalizedTranscript?: false;
}

export interface RuntimeEndSessionOptions {
  archive?: "off" | RuntimeEndSessionArchiveOptions;
}

export interface RuntimeContextService {
  startSession(scope: MemoryScope): Promise<RuntimeContextState>;
  getRuntimeState(scope: MemoryScope): Promise<RuntimeContextState>;
  appendToSession(
    scope: MemoryScope,
    message: SessionMessage,
  ): Promise<SessionBuffer>;
  setSessionSummary(
    scope: MemoryScope,
    input: SessionSummaryInput,
  ): Promise<SessionBuffer>;
  updateWorkingMemory(
    scope: MemoryScope,
    patch: WorkingMemoryPatch,
  ): Promise<WorkingMemorySnapshot>;
  updateSessionJournal(
    scope: MemoryScope,
    patch: SessionJournalPatch,
  ): Promise<SessionJournal>;
  getRuntimeRecall(
    scope: MemoryScope,
    profile: "general_chat" | "coding_agent",
  ): Promise<RuntimeRecallSnapshot>;
  endSession(
    scope: MemoryScope,
    options?: RuntimeEndSessionOptions,
  ): Promise<RuntimeContextState>;
}

export function createRuntimeArchiveStore(
  config: RuntimeArchiveStoreConfig,
): RuntimeArchiveStore {
  return {
    async add(archive) {
      assertStorageSafeExternalValue(archive, "archive");
      await config.documentStore.set(
        SESSION_ARCHIVES_COLLECTION,
        archive.id,
        archive,
      );
    },
  };
}

function resolvePublicEndSessionOptions(
  options?: RuntimeEndSessionOptions,
): InternalRuntimeEndSessionOptions {
  if (options?.archive === "off") {
    return { archive: "off" };
  }

  return {
    archive: {
      mode: "summary_only",
      includeNormalizedTranscript: false,
    },
  };
}

export function createRuntimeContextService(
  config: RuntimeContextServiceConfig,
): RuntimeContextService {
  const publicConfig = {
    sessionStore: config.sessionStore,
    archiveStore: config.archiveStore,
    language: config.language,
    now: config.now,
    createMessageId: config.createMessageId,
    createArchiveId: config.createArchiveId,
    maxBufferedMessages: config.maxBufferedMessages,
  };
  const runtime = createInternalRuntimeContextService(publicConfig);

  return {
    startSession(scope) {
      return runtime.startSession(scope);
    },
    getRuntimeState(scope) {
      return runtime.getRuntimeState(scope);
    },
    appendToSession(scope, message) {
      return runtime.appendToSession(scope, message);
    },
    setSessionSummary(scope, input) {
      return runtime.setSessionSummary(scope, input);
    },
    updateWorkingMemory(scope, patch) {
      return runtime.updateWorkingMemory(scope, patch);
    },
    updateSessionJournal(scope, patch) {
      return runtime.updateSessionJournal(scope, patch);
    },
    getRuntimeRecall(scope, profile) {
      return runtime.getRuntimeRecall(scope, profile);
    },
    endSession(scope, options) {
      return runtime.endSession(scope, resolvePublicEndSessionOptions(options));
    },
  };
}
