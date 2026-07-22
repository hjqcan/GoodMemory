import { describe, expect, it } from "bun:test";
import { createInMemoryDocumentStore, createInMemorySessionStore } from "../../src/storage/memory";
import {
  createRuntimeContextService,
  type RuntimeExtractionHooks,
  type RuntimeSalvageHooks,
} from "../../src/runtime/contextService";
import { createExtractionCursorStore } from "../../src/remember/extractionCursor";
import type { ExtractionCursorStore } from "../../src/remember/extractionCursor";
import {
  createMemoryRepositories,
} from "../../src/storage/repositories";
import type { SessionStore } from "../../src/storage/contracts";
import {
  DeterministicClock,
  createDeterministicIdGenerator,
} from "../../src/testing/utils";
import {
  createLanguageService,
  type LanguageService,
} from "../../src/language";

function createService(
  maxBufferedMessages = 3,
  input?: {
    extraction?: RuntimeExtractionHooks;
    language?: LanguageService;
    salvageHooks?: RuntimeSalvageHooks;
    sessionStore?: SessionStore;
  },
) {
  const clock = new DeterministicClock("2026-01-01T00:00:00.000Z");
  const documentStore = createInMemoryDocumentStore();
  const sessionStore = input?.sessionStore ?? createInMemorySessionStore();
  const repositories = createMemoryRepositories({
    documentStore,
    sessionStore,
  });
  const service = createRuntimeContextService({
    sessionStore,
    archiveStore: repositories.archives,
    extraction: input?.extraction,
    language: input?.language,
    salvageHooks: input?.salvageHooks,
    now: () => clock.now().toISOString(),
    createMessageId: createDeterministicIdGenerator("msg"),
    createArchiveId: createDeterministicIdGenerator("archive"),
    maxBufferedMessages,
  });

  return {
    clock,
    repositories,
    sessionStore,
    service,
  };
}

describe("runtime context service", () => {
  it("persists the resolved session locale on archives", async () => {
    const { repositories, service } = createService(3, {
      language: createLanguageService({ defaultLocale: "ja-JP" }),
    });
    const scope = { userId: "u-ja-archive", sessionId: "s-ja-archive" };
    await service.startSession(scope);
    await service.appendToSession(scope, {
      role: "user",
      content: "現在のブロッカーは承認待ちです。",
    });

    await service.endSession(scope);

    const archives = await repositories.archives.listByScope(scope);
    expect(archives[0]?.locale).toBe("ja-JP");
  });

  for (const testCase of [
    {
      content: "請保留部署決策與待辦。",
      currentGoal: "完成部署",
      decision: "保留回滾方案",
      expectedLabels: ["當前目標", "關鍵決策", "待辦"],
      locale: "zh-Hant",
      openLoop: "確認監控",
    },
    {
      content: "デプロイの決定事項と未完了事項を保持してください。",
      currentGoal: "デプロイを完了する",
      decision: "ロールバック案を維持する",
      expectedLabels: ["現在の目標", "重要な決定", "未完了事項"],
      locale: "ja-JP",
      openLoop: "監視を確認する",
    },
  ]) {
    it(`renders ${testCase.locale} archive labels through its language pack`, async () => {
      const { repositories, service } = createService(3, {
        language: createLanguageService(),
      });
      const scope = {
        userId: `u-${testCase.locale}`,
        sessionId: `s-${testCase.locale}`,
      };
      await service.startSession(scope);
      await service.appendToSession(scope, {
        role: "user",
        content: testCase.content,
      });
      await service.updateWorkingMemory(scope, {
        currentGoal: testCase.currentGoal,
        openLoops: [testCase.openLoop],
        temporaryDecisions: [testCase.decision],
      });

      await service.endSession(scope);

      const archive = (await repositories.archives.listByScope(scope))[0]!;
      expect(archive.locale).toBe(testCase.locale);
      for (const label of testCase.expectedLabels) {
        expect(archive.summary).toContain(label);
      }
      expect(archive.summary).not.toContain("Goal:");
      expect(archive.summary).not.toContain("Key decisions:");
      expect(archive.summary).not.toContain("Open loops:");
    });
  }

  it("starts isolated sessions and enforces lifecycle boundaries", async () => {
    const { clock, service } = createService();
    const sessionOne = { userId: "u-1", sessionId: "s-1" };
    const sessionTwo = { userId: "u-1", sessionId: "s-2" };

    const started = await service.startSession(sessionOne);
    expect(started.buffer.messages).toEqual([]);
    expect(started.workingMemory.openLoops).toEqual([]);
    expect(started.journal.worklog).toEqual([]);

    await service.appendToSession(sessionOne, {
      role: "user",
      content: "Remember the runtime plan.",
    });

    clock.advanceMs(1000);
    await service.startSession(sessionTwo);
    await service.appendToSession(sessionTwo, {
      role: "user",
      content: "This is another session.",
    });

    expect((await service.getRuntimeState(sessionOne)).buffer.messages).toHaveLength(1);
    expect((await service.getRuntimeState(sessionTwo)).buffer.messages).toHaveLength(1);

    await service.endSession(sessionOne);

    await expect(
      service.appendToSession(sessionOne, {
        role: "assistant",
        content: "This should be rejected.",
      }),
    ).rejects.toThrow("ended");

    const restarted = await service.startSession(sessionOne);
    expect(restarted.buffer.messages).toEqual([]);
  });

  it("maintains a sliding session buffer and summary placeholder", async () => {
    const { clock, service } = createService(2);
    const scope = { userId: "u-1", sessionId: "s-1" };

    await service.startSession(scope);
    await service.appendToSession(scope, { role: "user", content: "m1" });
    clock.advanceMs(1000);
    await service.appendToSession(scope, { role: "assistant", content: "m2" });
    clock.advanceMs(1000);
    await service.appendToSession(scope, { role: "user", content: "m3" });

    let state = await service.getRuntimeState(scope);
    expect(state.buffer.messages.map((message) => message.content)).toEqual(["m2", "m3"]);
    expect(state.buffer.summary).toBe("Earlier messages compacted.");
    expect(state.buffer.summaryUpToIndex).toBe(1);

    clock.advanceMs(1000);
    await service.setSessionSummary(scope, {
      summary: "User confirmed runtime architecture.",
      summaryUpToIndex: 2,
    });

    state = await service.getRuntimeState(scope);
    expect(state.buffer.summary).toBe("User confirmed runtime architecture.");
    expect(state.buffer.summaryUpToIndex).toBe(2);
  });

  for (const testCase of [
    {
      locale: "zh-Hant",
      messages: ["請保留第一則訊息。", "這是第二則。", "這是第三則。"],
      summary: "較早的訊息已壓縮。",
    },
    {
      locale: "ja-JP",
      messages: ["最初のメッセージを保持します。", "二番目です。", "三番目です。"],
      summary: "以前のメッセージは圧縮されました。",
    },
  ] as const) {
    it(`renders the ${testCase.locale} compaction placeholder through its pack`, async () => {
      const { service } = createService(2, {
        language: createLanguageService(),
      });
      const scope = {
        userId: `u-compact-${testCase.locale}`,
        sessionId: `s-compact-${testCase.locale}`,
      };
      await service.startSession(scope);
      for (const content of testCase.messages) {
        await service.appendToSession(scope, { role: "user", content });
      }

      const state = await service.getRuntimeState(scope);
      expect(state.buffer.summary).toBe(testCase.summary);
    });
  }

  it("invokes pre-compact salvage hooks before trimming buffered messages", async () => {
    const preCompactCalls: Array<{
      evictedMessages: string[];
      nextMessage: string;
      nextMessages: string[];
      overflowCount: number;
      openLoops: string[];
    }> = [];
    const { clock, service } = createService(2, {
      salvageHooks: {
        async onPreCompact({
          evictedMessages,
          nextMessage,
          nextMessages,
          overflowCount,
          runtimeState,
        }) {
          preCompactCalls.push({
            evictedMessages: evictedMessages.map((message) => message.content),
            nextMessage: nextMessage.content,
            nextMessages: nextMessages.map((message) => message.content),
            overflowCount,
            openLoops: runtimeState.workingMemory.openLoops,
          });
        },
      },
    });
    const scope = { userId: "u-1", sessionId: "s-1" };

    await service.startSession(scope);
    await service.updateWorkingMemory(scope, {
      openLoops: ["preserve unresolved runtime handoff"],
    });
    await service.appendToSession(scope, { role: "user", content: "m1" });
    clock.advanceMs(1000);
    await service.appendToSession(scope, { role: "assistant", content: "m2" });
    clock.advanceMs(1000);
    await service.appendToSession(scope, { role: "user", content: "m3" });

    expect(preCompactCalls).toEqual([
      {
        evictedMessages: ["m1"],
        nextMessage: "m3",
        nextMessages: ["m1", "m2", "m3"],
        overflowCount: 1,
        openLoops: ["preserve unresolved runtime handoff"],
      },
    ]);
  });

  it("retains evicted raw messages while enforcing the live limit when salvage fails", async () => {
    const errors: unknown[][] = [];
    const originalConsoleError = console.error;
    console.error = (...args) => {
      errors.push(args);
    };

    try {
      const { clock, service } = createService(2, {
        salvageHooks: {
          async onPreCompact() {
            throw new Error("proposal repository temporarily unavailable");
          },
        },
      });
      const scope = { userId: "u-1", sessionId: "s-1" };

      await service.startSession(scope);
      await service.appendToSession(scope, { role: "user", content: "m1" });
      clock.advanceMs(1000);
      await service.appendToSession(scope, { role: "assistant", content: "m2" });
      clock.advanceMs(1000);
      await service.appendToSession(scope, { role: "user", content: "m3" });

      let buffer = (await service.getRuntimeState(scope)).buffer;
      expect(buffer.messages.map((message) => message.content)).toEqual(["m2", "m3"]);
      expect(buffer.compactedMessages?.map((message) => message.content)).toEqual([
        "m1",
      ]);

      expect(errors).toHaveLength(1);
      expect(String(errors[0]?.[0])).toContain("Runtime salvage hook failed");

      clock.advanceMs(1000);
      await service.appendToSession(scope, { role: "assistant", content: "m4" });

      buffer = (await service.getRuntimeState(scope)).buffer;
      expect(buffer.messages.map((message) => message.content)).toEqual(["m3", "m4"]);
      expect(buffer.compactedMessages?.map((message) => message.content)).toEqual([
        "m1",
        "m2",
      ]);
      expect(errors).toHaveLength(2);
    } finally {
      console.error = originalConsoleError;
    }
  });

  it("retries failed compacted-message extraction from the durable cursor", async () => {
    const cursorDocuments = createInMemoryDocumentStore();
    const cursorStore = createExtractionCursorStore({
      documentStore: cursorDocuments,
      now: () => "2026-01-01T00:00:00.000Z",
    });
    const sessionStore = createInMemorySessionStore();
    const extracted: string[][] = [];
    let attempt = 0;
    const extraction: RuntimeExtractionHooks = {
      cursorStore,
      async extract({ messages }) {
        extracted.push(messages.map(({ content }) => content));
        attempt += 1;
        return attempt === 1 ? "failed" : "committed";
      },
    };
    const first = createService(2, { extraction, sessionStore });
    const scope = { userId: "u-cursor", sessionId: "s-cursor" };

    await first.service.startSession(scope);
    await first.service.appendToSession(scope, { role: "user", content: "m1" });
    await first.service.appendToSession(scope, { role: "assistant", content: "m2" });
    await first.service.appendToSession(scope, { role: "user", content: "m3" });

    const reconstructed = createService(2, { extraction, sessionStore });
    await reconstructed.service.appendToSession(scope, {
      role: "assistant",
      content: "m4",
    });

    expect(extracted).toEqual([["m1"], ["m1", "m2"]]);
    expect(
      await cursorDocuments.query("extraction_cursors_v1"),
    ).toEqual([
      expect.objectContaining({
        committedThrough: 2,
        lastAttempt: expect.objectContaining({ outcome: "committed", through: 2 }),
      }),
    ]);
  });

  it("keeps the exact session replay source until end-session extraction succeeds", async () => {
    const cursorDocuments = createInMemoryDocumentStore();
    const cursorStore = createExtractionCursorStore({
      documentStore: cursorDocuments,
      now: () => "2026-01-01T00:00:00.000Z",
    });
    const sessionStore = createInMemorySessionStore();
    let outcome: "committed" | "failed" = "failed";
    const extracted: string[][] = [];
    const extraction: RuntimeExtractionHooks = {
      cursorStore,
      async extract({ messages }) {
        extracted.push(messages.map(({ content }) => content));
        return outcome;
      },
    };
    const first = createService(3, { extraction, sessionStore });
    const scope = { userId: "u-end-cursor", sessionId: "s-end-cursor" };

    await first.service.startSession(scope);
    await first.service.appendToSession(scope, { role: "user", content: "m1" });
    await first.service.appendToSession(scope, { role: "assistant", content: "m2" });
    await expect(first.service.endSession(scope)).rejects.toThrow(
      "pending memory extraction",
    );
    expect((await sessionStore.getBuffer(scope))?.messages).toHaveLength(2);

    outcome = "committed";
    await first.service.endSession(scope);

    expect(extracted).toEqual([["m1", "m2"], ["m1", "m2"]]);
    expect(await sessionStore.getBuffer(scope)).toBeNull();
  });

  it("does not delete a session until the durable cursor confirms its snapshot", async () => {
    const sessionStore = createInMemorySessionStore();
    const cursorStore: ExtractionCursorStore = {
      async get() {
        return null;
      },
      async record({ outcome, sourceId, through }) {
        return {
          committedThrough: 0,
          id: "cursor-1",
          lastAttempt: {
            attempts: 1,
            outcome,
            through,
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
          schemaVersion: 1,
          scopeKey: "user:u-cursor-confirmation",
          sourceId,
        };
      },
    };
    const { service } = createService(3, {
      extraction: {
        cursorStore,
        async extract() {
          return "committed";
        },
      },
      sessionStore,
    });
    const scope = {
      userId: "u-cursor-confirmation",
      sessionId: "s-cursor-confirmation",
    };

    await service.startSession(scope);
    await service.appendToSession(scope, { role: "user", content: "m1" });

    await expect(service.endSession(scope)).rejects.toThrow(
      "pending memory extraction",
    );
    expect((await sessionStore.getBuffer(scope))?.messages).toHaveLength(1);
  });

  it("serializes session close against an append to protect the extracted snapshot", async () => {
    const cursorStore = createExtractionCursorStore({
      documentStore: createInMemoryDocumentStore(),
      now: () => "2026-01-01T00:00:00.000Z",
    });
    let extractionStarted: (() => void) | undefined;
    let releaseExtraction: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      extractionStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseExtraction = resolve;
    });
    const { service } = createService(3, {
      extraction: {
        cursorStore,
        async extract() {
          extractionStarted?.();
          await release;
          return "committed";
        },
      },
    });
    const scope = { userId: "u-close-race", sessionId: "s-close-race" };
    await service.startSession(scope);
    await service.appendToSession(scope, { role: "user", content: "m1" });

    const closing = service.endSession(scope);
    await started;
    const appending = service.appendToSession(scope, {
      role: "assistant",
      content: "m2",
    });
    releaseExtraction?.();

    await closing;
    await expect(appending).rejects.toThrow("ended");
  });

  it("rejects a cross-runtime close when the persisted buffer changed", async () => {
    const sessionStore = createInMemorySessionStore();
    const cursorStore = createExtractionCursorStore({
      documentStore: createInMemoryDocumentStore(),
      now: () => "2026-01-01T00:00:00.000Z",
    });
    let extractionStarted: (() => void) | undefined;
    let releaseExtraction: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      extractionStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseExtraction = resolve;
    });
    const extraction: RuntimeExtractionHooks = {
      cursorStore,
      async extract() {
        extractionStarted?.();
        await release;
        return "committed";
      },
    };
    const first = createService(3, { extraction, sessionStore });
    const second = createService(3, { extraction, sessionStore });
    const scope = { userId: "u-cross-close", sessionId: "s-cross-close" };
    await first.service.startSession(scope);
    await first.service.appendToSession(scope, { role: "user", content: "m1" });

    const closing = first.service.endSession(scope);
    await started;
    await second.service.appendToSession(scope, {
      role: "assistant",
      content: "m2",
    });
    releaseExtraction?.();

    await expect(closing).rejects.toThrow("changed during close");
    expect(
      (await sessionStore.getBuffer(scope))?.messages.map(({ content }) => content),
    ).toEqual(["m1", "m2"]);
  });

  it("preserves exact replay when a late cross-runtime trim follows a completed compaction", async () => {
    const inner = createInMemorySessionStore();
    let markLateTrimStarted: (() => void) | undefined;
    let releaseLateTrim: (() => void) | undefined;
    const lateTrimStarted = new Promise<void>((resolve) => {
      markLateTrimStarted = resolve;
    });
    const lateTrimRelease = new Promise<void>((resolve) => {
      releaseLateTrim = resolve;
    });
    let shouldPauseLateTrim = true;
    const sessionStore: SessionStore = {
      ...inner,
      async saveBuffer(scope, buffer) {
        const liveContents = buffer.messages.map(({ content }) => content);
        const compactedContents = (buffer.compactedMessages ?? [])
          .map(({ content }) => content);
        if (
          shouldPauseLateTrim &&
          liveContents.join(",") === "m2,m3" &&
          compactedContents.join(",") === "m1"
        ) {
          shouldPauseLateTrim = false;
          markLateTrimStarted?.();
          await lateTrimRelease;
        }
        await inner.saveBuffer(scope, buffer);
      },
    };
    const first = createService(2, { sessionStore });
    const second = createService(2, { sessionStore });
    const scope = { userId: "u-cross-trim", sessionId: "s-cross-trim" };
    await first.service.startSession(scope);
    await first.service.appendToSession(scope, {
      id: "m1",
      role: "user",
      content: "m1",
    });
    await first.service.appendToSession(scope, {
      id: "m2",
      role: "assistant",
      content: "m2",
    });

    const lateTrim = first.service.appendToSession(scope, {
      id: "m3",
      role: "user",
      content: "m3",
    });
    await lateTrimStarted;
    await second.service.appendToSession(scope, {
      id: "m4",
      role: "assistant",
      content: "m4",
    });
    releaseLateTrim?.();
    await lateTrim;

    const verifier = createService(2, { sessionStore });
    await verifier.service.endSession(scope);
    const archives = await verifier.repositories.archives.listByScope(scope);
    expect(archives[0]?.normalizedTranscript).toBe(
      "user: m1\nassistant: m2\nuser: m3\nassistant: m4",
    );
  });

  it("reconstructs the exact compacted transcript in the session archive", async () => {
    const { repositories, service } = createService(2, {
      salvageHooks: {
        async onPreCompact() {
          throw new Error("salvage unavailable");
        },
      },
    });
    const scope = { userId: "u-archive", sessionId: "s-archive" };
    const originalConsoleError = console.error;
    console.error = () => undefined;
    try {
      await service.startSession(scope);
      for (let index = 1; index <= 6; index += 1) {
        await service.appendToSession(scope, {
          role: index % 2 === 0 ? "assistant" : "user",
          content: `m${index}`,
        });
      }
      expect((await service.getRuntimeState(scope)).buffer.messages).toHaveLength(2);

      await service.endSession(scope);
      const archives = await repositories.archives.listByScope(scope);
      expect(archives[0]?.normalizedTranscript).toBe(
        "user: m1\nassistant: m2\nuser: m3\nassistant: m4\nuser: m5\nassistant: m6",
      );
    } finally {
      console.error = originalConsoleError;
    }
  });

  it("rejects an append when the bounded buffer cannot be persisted", async () => {
    const inner = createInMemorySessionStore();
    let failTrim = true;
    const sessionStore: SessionStore = {
      ...inner,
      async saveBuffer(scope, buffer) {
        if (
          failTrim &&
          buffer.messages.map(({ content }) => content).join(",") === "m2,m3"
        ) {
          failTrim = false;
          throw new Error("trim persistence unavailable");
        }
        await inner.saveBuffer(scope, buffer);
      },
    };
    const { service } = createService(2, { sessionStore });
    const scope = { userId: "u-transactional", sessionId: "s-transactional" };
    await service.startSession(scope);
    await service.appendToSession(scope, { role: "user", content: "m1" });
    await service.appendToSession(scope, { role: "assistant", content: "m2" });

    await expect(
      service.appendToSession(scope, {
        role: "user",
        content: "m3",
      }),
    ).rejects.toThrow("trim persistence unavailable");

    const pending = await inner.getBuffer(scope);
    expect(pending?.messages.map(({ content }) => content)).toEqual([
      "m1",
      "m2",
      "m3",
    ]);
    expect(pending?.compactedMessages?.map(({ content }) => content)).toEqual([
      "m1",
    ]);

    const retried = await service.appendToSession(scope, {
      role: "assistant",
      content: "m4",
    });
    expect(retried.messages.map(({ content }) => content)).toEqual(["m3", "m4"]);
    expect(retried.compactedMessages?.map(({ content }) => content)).toEqual([
      "m1",
      "m2",
    ]);
  });

  it("archives a pending full buffer exactly once when live trimming fails", async () => {
    const inner = createInMemorySessionStore();
    const sessionStore: SessionStore = {
      ...inner,
      async saveBuffer(scope, buffer) {
        if (buffer.messages.map(({ content }) => content).join(",") === "m2,m3") {
          throw new Error("trim persistence unavailable");
        }
        await inner.saveBuffer(scope, buffer);
      },
    };
    const { repositories, service } = createService(2, { sessionStore });
    const scope = { userId: "u-replay", sessionId: "s-replay" };
    await service.startSession(scope);
    await service.appendToSession(scope, { role: "user", content: "m1" });
    await service.appendToSession(scope, { role: "assistant", content: "m2" });
    await expect(service.appendToSession(scope, {
      role: "user",
      content: "m3",
    })).rejects.toThrow("trim persistence unavailable");

    await service.endSession(scope);
    const archives = await repositories.archives.listByScope(scope);
    expect(archives[0]?.normalizedTranscript).toBe(
      "user: m1\nassistant: m2\nuser: m3",
    );
  });

  it("updates working memory without leaking into durable memory semantics", async () => {
    const { clock, service } = createService();
    const scope = { userId: "u-1", sessionId: "s-1" };

    await service.startSession(scope);

    let snapshot = await service.updateWorkingMemory(scope, {
      currentGoal: "Implement runtime context engine",
      openLoops: ["wire runtime recall", "keep journal updated"],
      temporaryDecisions: ["start with in-memory store"],
    });

    expect(snapshot.currentGoal).toBe("Implement runtime context engine");
    expect(snapshot.openLoops).toEqual([
      "wire runtime recall",
      "keep journal updated",
    ]);
    expect(snapshot.temporaryDecisions).toEqual(["start with in-memory store"]);

    clock.advanceMs(1000);
    snapshot = await service.updateWorkingMemory(scope, {
      openLoops: ["wire runtime recall", "add spillover scaffolding"],
      resolvedOpenLoops: ["keep journal updated"],
      temporaryDecisions: ["keep runtime state internal"],
    });

    expect(snapshot.openLoops).toEqual([
      "wire runtime recall",
      "add spillover scaffolding",
    ]);
    expect(snapshot.temporaryDecisions).toEqual(["keep runtime state internal"]);

    clock.advanceMs(1000);
    snapshot = await service.updateWorkingMemory(scope, {
      currentGoal: null,
      temporaryDecisions: null,
    });

    expect(snapshot.currentGoal).toBeUndefined();
    expect(snapshot.temporaryDecisions).toBeUndefined();
  });

  it("creates and updates a structurally valid session journal", async () => {
    const { service } = createService();
    const scope = { userId: "u-1", sessionId: "s-1" };

    await service.startSession(scope);

    let journal = await service.updateSessionJournal(scope, {
      title: "Runtime context rollout",
      currentState: "storage complete, runtime in progress",
      filesAndFunctions: ["src/runtime/contextService.ts"],
      appendWorklog: ["Phase 3 storage completed."],
      lastSummarizedMessageId: "msg-0002",
    });

    expect(journal.filesAndFunctions).toEqual(["src/runtime/contextService.ts"]);
    expect(journal.workflow).toEqual([]);
    expect(journal.worklog).toEqual(["Phase 3 storage completed."]);
    expect(journal.lastSummarizedMessageId).toBe("msg-0002");

    journal = await service.updateSessionJournal(scope, {
      learnings: ["Shared storage contracts reduce adapter drift."],
      appendWorklog: ["Phase 4 runtime service added."],
    });

    expect(journal.learnings).toEqual([
      "Shared storage contracts reduce adapter drift.",
    ]);
    expect(journal.worklog).toEqual([
      "Phase 3 storage completed.",
      "Phase 4 runtime service added.",
    ]);
  });

  it("builds runtime recall differently for general chat and coding agent profiles", async () => {
    const { service } = createService();
    const scope = { userId: "u-1", sessionId: "s-1" };

    await service.startSession(scope);
    await service.appendToSession(scope, {
      role: "user",
      content: "Keep the refactor aligned with the PRD.",
    });
    await service.updateWorkingMemory(scope, {
      currentGoal: "Finish runtime context engine",
      openLoops: ["wire runtime recall"],
    });
    await service.updateSessionJournal(scope, {
      currentState: "Phase 4 in progress",
      appendWorklog: ["Runtime skeleton implemented."],
    });

    const generalChat = await service.getRuntimeRecall(scope, "general_chat");
    expect(generalChat.workingMemory?.currentGoal).toBe("Finish runtime context engine");
    expect(generalChat.journal).toBeNull();

    const codingAgent = await service.getRuntimeRecall(scope, "coding_agent");
    expect(codingAgent.workingMemory?.openLoops).toEqual(["wire runtime recall"]);
    expect(codingAgent.journal?.currentState).toBe("Phase 4 in progress");
  });

  it("persists a session archive on endSession when the session has continuity signal", async () => {
    const { clock, repositories, service } = createService();
    const scope = {
      userId: "u-1",
      tenantId: "tenant-a",
      workspaceId: "workspace-a",
      agentId: "agent-a",
      sessionId: "s-1",
    };

    await service.startSession(scope);
    await service.appendToSession(scope, {
      role: "user",
      content: "Please keep the rollback plan ready for Friday night.",
    });
    await service.updateWorkingMemory(scope, {
      currentGoal: "Finish archive write path",
      openLoops: ["wire archive recall"],
      temporaryDecisions: ["Keep runtime archive writes deterministic."],
    });
    await service.updateSessionJournal(scope, {
      currentState: "Phase 14.2 in progress",
      filesAndFunctions: ["src/runtime/contextService.ts"],
      appendWorklog: ["Archive write path drafted."],
      keyResults: ["Session archive persistence is the next checkpoint."],
    });

    clock.advanceMs(1000);
    await service.endSession(scope);

    const archives = await repositories.archives.listByScope(scope);
    expect(archives).toHaveLength(1);

    const archive = archives[0]!;
    expect(archive.id).toBe("archive-0001");
    expect(archive.summary).toContain("Phase 14.2 in progress");
    expect(archive.keyDecisions).toEqual([
      "Keep runtime archive writes deterministic.",
      "Session archive persistence is the next checkpoint.",
    ]);
    expect(archive.unresolvedItems).toEqual(["wire archive recall"]);
    expect(archive.referencedArtifacts).toEqual(["src/runtime/contextService.ts"]);
    expect(archive.scopeLineage).toEqual(["tenant-a", "workspace-a", "agent-a"]);
    expect(archive.normalizedTranscript).toContain("rollback plan ready");
    expect(archive.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(archive.archivedAt).toBe("2026-01-01T00:00:01.000Z");
  });

  it("invokes session-end salvage hooks with the created archive", async () => {
    const sessionEndCalls: Array<{ archiveId: string; unresolvedItems: string[] }> = [];
    const { clock, service } = createService(3, {
      salvageHooks: {
        async onSessionEnd({ archive }) {
          sessionEndCalls.push({
            archiveId: archive.id,
            unresolvedItems: archive.unresolvedItems,
          });
        },
      },
    });
    const scope = { userId: "u-1", sessionId: "s-1" };

    await service.startSession(scope);
    await service.updateWorkingMemory(scope, {
      currentGoal: "Finish salvage hook wiring",
      openLoops: ["keep unresolved loop visible"],
    });
    clock.advanceMs(1000);
    await service.endSession(scope);

    expect(sessionEndCalls).toEqual([
      {
        archiveId: "archive-0001",
        unresolvedItems: ["keep unresolved loop visible"],
      },
    ]);
  });

  it("keeps session close committed when session-end salvage fails", async () => {
    const errors: unknown[][] = [];
    const originalConsoleError = console.error;
    console.error = (...args) => {
      errors.push(args);
    };

    try {
      const { clock, repositories, service } = createService(3, {
        salvageHooks: {
          async onSessionEnd() {
            throw new Error("proposal creation failed");
          },
        },
      });
      const scope = { userId: "u-1", sessionId: "s-1" };

      await service.startSession(scope);
      await service.updateWorkingMemory(scope, {
        currentGoal: "Finish salvage isolation",
        openLoops: ["carry unresolved handoff into archive"],
      });
      clock.advanceMs(1000);
      await expect(service.endSession(scope)).resolves.toBeDefined();

      expect(await repositories.archives.listByScope(scope)).toHaveLength(1);
      await expect(
        service.appendToSession(scope, {
          role: "assistant",
          content: "should be blocked because the session already ended",
        }),
      ).rejects.toThrow("ended");

      expect(errors).toHaveLength(1);
      expect(String(errors[0]?.[0])).toContain("Runtime salvage hook failed");
    } finally {
      console.error = originalConsoleError;
    }
  });

  it("clears runtime state after session end so future exports rotate to archive views", async () => {
    const { clock, service, sessionStore } = createService();
    const scope = {
      userId: "u-1",
      workspaceId: "workspace-a",
      sessionId: "s-archive",
    };

    await service.startSession(scope);
    await service.appendToSession(scope, {
      role: "user",
      content: "Keep the rollout handoff concise.",
    });
    await service.updateWorkingMemory(scope, {
      currentGoal: "Finish archive rotation",
      openLoops: ["publish archive recap"],
    });
    await service.updateSessionJournal(scope, {
      currentState: "Session closing",
      appendWorklog: ["Archive recap prepared."],
    });

    clock.advanceMs(1000);
    await service.endSession(scope);

    expect(await sessionStore.getBuffer(scope)).toBeNull();
    expect(await sessionStore.getWorkingMemory(scope)).toBeNull();
    expect(await sessionStore.getJournal(scope)).toBeNull();
  });

  it("does not persist an archive when ending an untouched empty session", async () => {
    const { repositories, service } = createService();
    const scope = { userId: "u-1", sessionId: "s-empty" };

    await service.startSession(scope);
    await service.endSession(scope);

    expect(await repositories.archives.listByUser("u-1")).toHaveLength(0);
  });
});
