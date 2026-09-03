import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GoodMemory } from "../../src/api/contracts";
import {
  buildWritebackAuditEventId,
  buildWritebackScopeDigest,
  markWritebackAuditCommitted,
  markWritebackAuditPending,
  writeInstalledHostWritebackLedger,
} from "../../src/install/hostWritebackAuditLedger";
import {
  inspectInstalledHostWritebackAudit,
  forgetInstalledHostWritebackAuditEvent,
  recordInstalledHostWritebackRecallHits,
} from "../../src/install/hostWritebackAuditRuntime";
import {
  createInstalledHostMemory,
  resolveInstalledHostContext,
} from "../../src/install/hostExecutionContext";
import {
  enableHostWorkspace,
  installHost,
} from "../../src/install/hostInstall";
import { executeInstalledHostWriteback } from "../../src/install/hostWritebackRuntime";

async function createWorkspace(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

describe("installed host writeback audit integration", () => {
  it("inspects and forgets a writeback event through the installed-host memory path", async () => {
    const homeRoot = await createWorkspace("goodmemory-writeback-audit-home-");
    const workspaceRoot = await createWorkspace("goodmemory-writeback-audit-workspace-");
    const otherWorkspaceRoot = await createWorkspace(
      "goodmemory-writeback-audit-other-workspace-",
    );

    try {
      await installHost({
        homeRoot,
        host: "codex",
        userId: "phase371-user",
        writeback: {
          allowAssistantOutput: "confirmed_or_verified",
          dryRun: false,
          maxChars: 12000,
          maxMessages: 12,
          minConfidence: 0.7,
          mode: "selective",
          persistRawTranscript: false,
        },
      });
      await enableHostWorkspace({
        homeRoot,
        host: "codex",
        workspaceId: "phase371-workspace",
        workspaceRoot,
      });
      await enableHostWorkspace({
        homeRoot,
        host: "codex",
        workspaceId: "phase371-other-workspace",
        workspaceRoot: otherWorkspaceRoot,
      });

      const writeback = await executeInstalledHostWriteback({
        command: "session-end",
        homeRoot,
        host: "codex",
        payload: {
          cwd: workspaceRoot,
          messages: [
            {
              content: "Next step is to add Phase 37.1 audit undo.",
              role: "user",
            },
          ],
          session_id: "phase371-session-1",
        },
      });
      expect(writeback.reason).toBe("written");

      const inspected = await inspectInstalledHostWritebackAudit({
        cwd: workspaceRoot,
        homeRoot,
        host: "codex",
        limit: 10,
      });
      expect(inspected.events).toHaveLength(1);
      expect(inspected.legacyEventCount).toBe(1);
      expect(inspected.legacyUnscopedEventCount).toBe(0);
      expect(inspected.events[0]).toEqual(
        expect.objectContaining({
          contentPreview: expect.stringContaining("Phase 37.1 audit undo"),
          linkedRecordIds: expect.arrayContaining([
            expect.objectContaining({ type: "memory" }),
            expect.objectContaining({ type: "evidence" }),
          ]),
          memoryExistsCount: 1,
          status: "committed",
        }),
      );
      expect(inspected.events[0]?.memoryIds.length).toBeGreaterThan(0);
      const otherScopeInspection = await inspectInstalledHostWritebackAudit({
        cwd: otherWorkspaceRoot,
        homeRoot,
        host: "codex",
        limit: 10,
      });
      expect(otherScopeInspection.events).toEqual([]);
      expect(otherScopeInspection.legacyEventCount).toBe(0);
      expect(otherScopeInspection.legacyUnscopedEventCount).toBe(0);

      const forgotten = await forgetInstalledHostWritebackAuditEvent({
        cwd: workspaceRoot,
        eventId: inspected.events[0]!.eventId,
        homeRoot,
        host: "codex",
        review: {
          outcome: "false_write",
          reason: "api_key=sk-user-facing-undo-secret",
        },
      });
      expect(forgotten.review).toEqual({
        outcome: "false_write",
        reason: "[redacted secret-like content]",
      });
      expect(forgotten.forgottenLinkedRecordIds).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "memory" }),
          expect.objectContaining({ type: "evidence" }),
        ]),
      );
      expect(forgotten.forgottenMemoryIds.length).toBeGreaterThan(0);

      const after = await inspectInstalledHostWritebackAudit({
        cwd: workspaceRoot,
        homeRoot,
        host: "codex",
        limit: 10,
      });
      expect(after.events[0]).toEqual(
        expect.objectContaining({
          memoryExistsCount: 0,
          review: {
            outcome: "false_write",
            reason: "[redacted secret-like content]",
          },
          forgottenLinkedRecordIds: expect.arrayContaining([
            expect.objectContaining({ type: "memory" }),
            expect.objectContaining({ type: "evidence" }),
          ]),
          status: "forgotten",
        }),
      );

      const resolved = await resolveInstalledHostContext({
        cwd: workspaceRoot,
        homeRoot,
        host: "codex",
      });
      expect(resolved.status).toBe("ok");
      if (resolved.status !== "ok") {
        return;
      }
      const { sessionId: _sessionId, ...durableScope } = resolved.context.scope;
      const exported = await createInstalledHostMemory(resolved.context).exportMemory({
        scope: durableScope,
      });
      const durableText = JSON.stringify(exported.durable);
      expect(JSON.stringify({ after, forgotten })).not.toContain(
        "sk-user-facing-undo-secret",
      );
      const activeMemoryText = JSON.stringify({
        facts: exported.durable.facts,
        feedback: exported.durable.feedback,
        preferences: exported.durable.preferences,
        references: exported.durable.references,
      });
      expect(activeMemoryText).not.toContain("Phase 37.1 audit undo");
      expect(durableText).not.toContain("Phase 37.1 audit undo");
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
      await rm(otherWorkspaceRoot, { force: true, recursive: true });
    }
  });

  it("records observed candidates as dismissible audit events without blocking later selective writes", async () => {
    const homeRoot = await createWorkspace("goodmemory-writeback-observed-audit-home-");
    const workspaceRoot = await createWorkspace(
      "goodmemory-writeback-observed-audit-workspace-",
    );
    const payload = {
      cwd: workspaceRoot,
      messages: [
        {
          content: "Always run typecheck before closing Phase 38.",
          role: "user",
        },
      ],
      session_id: "phase38-observe-session",
    };

    try {
      await installHost({
        homeRoot,
        host: "codex",
        userId: "phase38-user",
        writeback: {
          allowAssistantOutput: "confirmed_or_verified",
          dryRun: false,
          maxChars: 12000,
          maxMessages: 12,
          minConfidence: 0.7,
          mode: "observe",
          persistRawTranscript: false,
        },
      });
      await enableHostWorkspace({
        homeRoot,
        host: "codex",
        workspaceId: "phase38-workspace",
        workspaceRoot,
      });

      const observed = await executeInstalledHostWriteback({
        command: "session-end",
        homeRoot,
        host: "codex",
        payload,
      });
      expect(observed.reason).toBe("observed");
      expect(observed.wrote).toBe(false);

      const inspectedObserved = await inspectInstalledHostWritebackAudit({
        cwd: workspaceRoot,
        homeRoot,
        host: "codex",
      });
      expect(inspectedObserved.legacyEventCount).toBe(0);
      expect(inspectedObserved.pendingCount).toBe(0);
      expect(inspectedObserved.events[0]).toEqual(
        expect.objectContaining({
          contentPreview: "Always run typecheck before closing Phase 38.",
          linkedRecordIds: [],
          memoryExistsCount: 0,
          memoryIds: [],
          mode: "observe",
          status: "observed",
        }),
      );
      const eventId = inspectedObserved.events[0]!.eventId;

      const dismissed = await forgetInstalledHostWritebackAuditEvent({
        cwd: workspaceRoot,
        eventId,
        homeRoot,
        host: "codex",
        review: {
          outcome: "false_write",
          reason: "reviewed as an observe-only false write",
        },
      });
      expect(dismissed).toEqual(
        expect.objectContaining({
          forgottenLinkedRecordIds: [],
          forgottenMemoryIds: [],
          status: "dismissed",
        }),
      );

      await enableHostWorkspace({
        homeRoot,
        host: "codex",
        workspaceId: "phase38-workspace",
        workspaceRoot,
        writebackMode: "selective",
      });
      const written = await executeInstalledHostWriteback({
        command: "session-end",
        homeRoot,
        host: "codex",
        payload,
      });
      expect(written.reason).toBe("written");
      expect(written.wrote).toBe(true);

      const inspectedWritten = await inspectInstalledHostWritebackAudit({
        cwd: workspaceRoot,
        homeRoot,
        host: "codex",
      });
      expect(inspectedWritten.legacyEventCount).toBe(1);
      expect(inspectedWritten.pendingCount).toBe(0);
      expect(inspectedWritten.events[0]).toEqual(
        expect.objectContaining({
          eventId,
          memoryExistsCount: 1,
          mode: "selective",
          status: "committed",
        }),
      );
      expect(inspectedWritten.events[0]?.review).toBeUndefined();
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("does not mark an audit event forgotten when linked records cannot all be deleted", async () => {
    const homeRoot = await createWorkspace("goodmemory-writeback-audit-partial-home-");
    const workspaceRoot = await createWorkspace(
      "goodmemory-writeback-audit-partial-workspace-",
    );

    try {
      await installHost({
        homeRoot,
        host: "codex",
        userId: "phase371-user",
        writeback: {
          allowAssistantOutput: "confirmed_or_verified",
          dryRun: false,
          maxChars: 12000,
          maxMessages: 12,
          minConfidence: 0.7,
          mode: "selective",
          persistRawTranscript: false,
        },
      });
      await enableHostWorkspace({
        homeRoot,
        host: "codex",
        workspaceId: "phase371-partial-workspace",
        workspaceRoot,
      });

      const resolved = await resolveInstalledHostContext({
        cwd: workspaceRoot,
        homeRoot,
        host: "codex",
      });
      expect(resolved.status).toBe("ok");
      if (resolved.status !== "ok") {
        return;
      }
      const { sessionId: _sessionId, ...durableScope } = resolved.context.scope;
      const scopeDigest = buildWritebackScopeDigest(durableScope);
      const eventId = buildWritebackAuditEventId({
        candidateKey: "candidate:missing-linked-record",
        scopeDigest,
      });
      const ledger = markWritebackAuditCommitted(
        markWritebackAuditPending(
          {
            auditEvents: [],
            events: [],
            pending: [],
            version: 3,
          },
          {
            candidateKey: "candidate:missing-linked-record",
            command: "session-end",
            content: "Next step is to test partial undo.",
            eventId,
            host: "codex",
            kind: "fact",
            mode: "selective",
            now: "2026-04-24T00:00:00.000Z",
            reason: "open_loop",
            scopeDigest,
            source: "user",
          },
        ),
        {
          candidateKey: "candidate:missing-linked-record",
          eventId,
          linkedRecordIds: [
            {
              id: "missing-fact-1",
              type: "memory",
            },
          ],
          memoryIds: ["missing-fact-1"],
          now: "2026-04-24T00:00:01.000Z",
        },
      );
      await writeInstalledHostWritebackLedger("codex", homeRoot, ledger);

      await expect(
        forgetInstalledHostWritebackAuditEvent({
          cwd: workspaceRoot,
          eventId,
          homeRoot,
          host: "codex",
        }),
      ).rejects.toThrow("Could not forget every linked writeback audit record");

      const inspected = await inspectInstalledHostWritebackAudit({
        cwd: workspaceRoot,
        homeRoot,
        host: "codex",
      });
      expect(inspected.events[0]?.status).toBe("committed");
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("refuses to forget audit events without linked durable records", async () => {
    const homeRoot = await createWorkspace("goodmemory-writeback-audit-empty-home-");
    const workspaceRoot = await createWorkspace(
      "goodmemory-writeback-audit-empty-workspace-",
    );

    try {
      await installHost({
        homeRoot,
        host: "codex",
        userId: "phase371-user",
        writeback: {
          allowAssistantOutput: "confirmed_or_verified",
          dryRun: false,
          maxChars: 12000,
          maxMessages: 12,
          minConfidence: 0.7,
          mode: "selective",
          persistRawTranscript: false,
        },
      });
      await enableHostWorkspace({
        homeRoot,
        host: "codex",
        workspaceId: "phase371-empty-workspace",
        workspaceRoot,
      });

      const resolved = await resolveInstalledHostContext({
        cwd: workspaceRoot,
        homeRoot,
        host: "codex",
      });
      expect(resolved.status).toBe("ok");
      if (resolved.status !== "ok") {
        return;
      }
      const { sessionId: _sessionId, ...durableScope } = resolved.context.scope;
      const scopeDigest = buildWritebackScopeDigest(durableScope);
      const eventId = buildWritebackAuditEventId({
        candidateKey: "candidate:empty-linked-records",
        scopeDigest,
      });
      const ledger = markWritebackAuditCommitted(
        markWritebackAuditPending(
          {
            auditEvents: [],
            events: [],
            pending: [],
            version: 3,
          },
          {
            candidateKey: "candidate:empty-linked-records",
            command: "session-end",
            content: "Next step is to test empty undo records.",
            eventId,
            host: "codex",
            kind: "fact",
            mode: "selective",
            now: "2026-04-24T00:00:00.000Z",
            reason: "open_loop",
            scopeDigest,
            source: "user",
          },
        ),
        {
          candidateKey: "candidate:empty-linked-records",
          eventId,
          linkedRecordIds: [],
          memoryIds: [],
          now: "2026-04-24T00:00:01.000Z",
        },
      );
      await writeInstalledHostWritebackLedger("codex", homeRoot, ledger);

      await expect(
        forgetInstalledHostWritebackAuditEvent({
          cwd: workspaceRoot,
          eventId,
          homeRoot,
          host: "codex",
        }),
      ).rejects.toThrow("has no linked records to forget");

      const inspected = await inspectInstalledHostWritebackAudit({
        cwd: workspaceRoot,
        homeRoot,
        host: "codex",
      });
      expect(inspected.events[0]).toEqual(
        expect.objectContaining({
          memoryExistsCount: 0,
          status: "committed",
        }),
      );
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("does not count evidence-only audit records as next-session writeback memory recall", async () => {
    const homeRoot = await createWorkspace("goodmemory-writeback-audit-evidence-home-");
    const workspaceRoot = await createWorkspace(
      "goodmemory-writeback-audit-evidence-workspace-",
    );

    try {
      await installHost({
        homeRoot,
        host: "codex",
        userId: "phase371-user",
        writeback: {
          allowAssistantOutput: "confirmed_or_verified",
          dryRun: false,
          maxChars: 12000,
          maxMessages: 12,
          minConfidence: 0.7,
          mode: "selective",
          persistRawTranscript: false,
        },
      });
      await enableHostWorkspace({
        homeRoot,
        host: "codex",
        workspaceId: "phase371-evidence-workspace",
        workspaceRoot,
      });

      const resolved = await resolveInstalledHostContext({
        cwd: workspaceRoot,
        homeRoot,
        host: "codex",
      });
      expect(resolved.status).toBe("ok");
      if (resolved.status !== "ok") {
        return;
      }
      const { sessionId: _sessionId, ...durableScope } = resolved.context.scope;
      const scopeDigest = buildWritebackScopeDigest(durableScope);
      const eventId = buildWritebackAuditEventId({
        candidateKey: "candidate:evidence-only",
        scopeDigest,
      });
      const ledger = markWritebackAuditCommitted(
        markWritebackAuditPending(
          {
            auditEvents: [],
            events: [],
            pending: [],
            version: 3,
          },
          {
            candidateKey: "candidate:evidence-only",
            command: "session-end",
            content: "Next step is to test evidence-only recall metrics.",
            eventId,
            host: "codex",
            kind: "fact",
            mode: "selective",
            now: "2026-04-24T00:00:00.000Z",
            reason: "open_loop",
            scopeDigest,
            sessionDigest: "write-session",
            source: "user",
          },
        ),
        {
          candidateKey: "candidate:evidence-only",
          eventId,
          linkedRecordIds: [
            {
              id: "evidence-1",
              type: "evidence",
            },
          ],
          memoryIds: [],
          now: "2026-04-24T00:00:01.000Z",
        },
      );
      await writeInstalledHostWritebackLedger("codex", homeRoot, ledger);

      const recalled = await recordInstalledHostWritebackRecallHits({
        homeRoot,
        host: "codex",
        recalledRecordIds: ["evidence-1"],
        scope: durableScope,
        sessionId: "recall-session",
      });
      const inspected = await inspectInstalledHostWritebackAudit({
        cwd: workspaceRoot,
        homeRoot,
        host: "codex",
      });

      expect(recalled.recalledEventIds).toEqual([]);
      expect(inspected.events[0]).toEqual(
        expect.objectContaining({
          memoryIds: [],
          recallHitCount: 0,
        }),
      );
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("does not count recall hits without write-session proof", async () => {
    const homeRoot = await createWorkspace("goodmemory-writeback-audit-no-session-home-");
    const workspaceRoot = await createWorkspace(
      "goodmemory-writeback-audit-no-session-workspace-",
    );

    try {
      await installHost({
        homeRoot,
        host: "codex",
        userId: "phase371-user",
        writeback: {
          allowAssistantOutput: "confirmed_or_verified",
          dryRun: false,
          maxChars: 12000,
          maxMessages: 12,
          minConfidence: 0.7,
          mode: "selective",
          persistRawTranscript: false,
        },
      });
      await enableHostWorkspace({
        homeRoot,
        host: "codex",
        workspaceId: "phase371-no-session-workspace",
        workspaceRoot,
      });

      const resolved = await resolveInstalledHostContext({
        cwd: workspaceRoot,
        homeRoot,
        host: "codex",
      });
      expect(resolved.status).toBe("ok");
      if (resolved.status !== "ok") {
        return;
      }
      const { sessionId: _sessionId, ...durableScope } = resolved.context.scope;
      const scopeDigest = buildWritebackScopeDigest(durableScope);
      const eventId = buildWritebackAuditEventId({
        candidateKey: "candidate:no-session",
        scopeDigest,
      });
      const ledger = markWritebackAuditCommitted(
        markWritebackAuditPending(
          {
            auditEvents: [],
            events: [],
            pending: [],
            version: 3,
          },
          {
            candidateKey: "candidate:no-session",
            command: "session-end",
            content: "Next step is to test missing write session recall metrics.",
            eventId,
            host: "codex",
            kind: "fact",
            mode: "selective",
            now: "2026-04-24T00:00:00.000Z",
            reason: "open_loop",
            scopeDigest,
            source: "user",
          },
        ),
        {
          candidateKey: "candidate:no-session",
          eventId,
          linkedRecordIds: [
            {
              id: "fact-1",
              type: "memory",
            },
          ],
          memoryIds: ["fact-1"],
          now: "2026-04-24T00:00:01.000Z",
        },
      );
      await writeInstalledHostWritebackLedger("codex", homeRoot, ledger);

      const recalled = await recordInstalledHostWritebackRecallHits({
        homeRoot,
        host: "codex",
        recalledRecordIds: ["fact-1"],
        scope: durableScope,
        sessionId: "recall-session",
      });
      const inspected = await inspectInstalledHostWritebackAudit({
        cwd: workspaceRoot,
        homeRoot,
        host: "codex",
      });

      expect(recalled.recalledEventIds).toEqual([]);
      expect(inspected.events[0]?.recallHitCount).toBe(0);
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("records partial forget failure when deletion fails after an earlier linked record was removed", async () => {
    const homeRoot = await createWorkspace("goodmemory-writeback-audit-flaky-home-");
    const workspaceRoot = await createWorkspace(
      "goodmemory-writeback-audit-flaky-workspace-",
    );

    try {
      await installHost({
        homeRoot,
        host: "codex",
        userId: "phase371-user",
        writeback: {
          allowAssistantOutput: "confirmed_or_verified",
          dryRun: false,
          maxChars: 12000,
          maxMessages: 12,
          minConfidence: 0.7,
          mode: "selective",
          persistRawTranscript: false,
        },
      });
      await enableHostWorkspace({
        homeRoot,
        host: "codex",
        workspaceId: "phase371-flaky-workspace",
        workspaceRoot,
      });

      const resolved = await resolveInstalledHostContext({
        cwd: workspaceRoot,
        homeRoot,
        host: "codex",
      });
      expect(resolved.status).toBe("ok");
      if (resolved.status !== "ok") {
        return;
      }
      const { sessionId: _sessionId, ...durableScope } = resolved.context.scope;
      const realMemory = createInstalledHostMemory(resolved.context);
      await executeInstalledHostWriteback({
        command: "session-end",
        homeRoot,
        host: "codex",
        payload: {
          cwd: workspaceRoot,
          messages: [
            {
              content: "Next step is to test partial audit undo record one.",
              role: "user",
            },
          ],
          session_id: "phase371-flaky-session-1",
        },
      });
      await executeInstalledHostWriteback({
        command: "session-end",
        homeRoot,
        host: "codex",
        payload: {
          cwd: workspaceRoot,
          messages: [
            {
              content: "Next step is to test partial audit undo record two.",
              role: "user",
            },
          ],
          session_id: "phase371-flaky-session-2",
        },
      });
      const exported = await realMemory.exportMemory({ scope: durableScope });
      const memoryIds = [
        ...exported.durable.facts,
        ...exported.durable.feedback,
        ...exported.durable.preferences,
        ...exported.durable.references,
        ...exported.durable.episodes,
      ].map((record) => record.id);
      expect(memoryIds.length).toBeGreaterThanOrEqual(2);

      const scopeDigest = buildWritebackScopeDigest(durableScope);
      const eventId = buildWritebackAuditEventId({
        candidateKey: "candidate:flaky-linked-records",
        scopeDigest,
      });
      const ledger = markWritebackAuditCommitted(
        markWritebackAuditPending(
          {
            auditEvents: [],
            events: [],
            pending: [],
            version: 3,
          },
          {
            candidateKey: "candidate:flaky-linked-records",
            command: "session-end",
            content: "Next step is to test flaky partial undo.",
            eventId,
            host: "codex",
            kind: "fact",
            mode: "selective",
            now: "2026-04-24T00:00:00.000Z",
            reason: "open_loop",
            scopeDigest,
            source: "user",
          },
        ),
        {
          candidateKey: "candidate:flaky-linked-records",
          eventId,
          linkedRecordIds: memoryIds.slice(0, 2).map((id) => ({
            id,
            type: "memory" as const,
          })),
          memoryIds: memoryIds.slice(0, 2),
          now: "2026-04-24T00:00:01.000Z",
        },
      );
      await writeInstalledHostWritebackLedger("codex", homeRoot, ledger);

      let forgetCallCount = 0;
      const flakyMemory: GoodMemory = {
        jobs: realMemory.jobs,
        runtime: realMemory.runtime,
        buildContext: (input) => realMemory.buildContext(input),
        deleteAllMemory: (input) => realMemory.deleteAllMemory(input),
        exportMemory: (input) => realMemory.exportMemory(input),
        importMemory: (input) => realMemory.importMemory(input),
        feedback: (input) => realMemory.feedback(input),
        forget: async (input) => {
          forgetCallCount += 1;
          return forgetCallCount === 2
            ? { forgotten: false }
            : realMemory.forget(input);
        },
        recall: (input) => realMemory.recall(input),
        remember: (input) => realMemory.remember(input),
        reviseMemory: (input) => realMemory.reviseMemory(input),
        runMaintenance: (input) => realMemory.runMaintenance(input),
      };
      await expect(
        forgetInstalledHostWritebackAuditEvent(
          {
            cwd: workspaceRoot,
            eventId,
            homeRoot,
            host: "codex",
          },
          {
            createMemory: () => flakyMemory,
          },
        ),
      ).rejects.toThrow("Could not forget every linked writeback audit record");

      const inspected = await inspectInstalledHostWritebackAudit({
        cwd: workspaceRoot,
        homeRoot,
        host: "codex",
      });
      expect(inspected.events[0]).toEqual(
        expect.objectContaining({
          errorCode: "forget_failed",
          linkedRecordExistsCount: 1,
          memoryExistsCount: 1,
          status: "failed",
        }),
      );
      expect(inspected.events[0]?.forgottenLinkedRecordIds).toEqual([
        expect.objectContaining({
          id: memoryIds[0],
          type: "memory",
        }),
      ]);
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });
});
