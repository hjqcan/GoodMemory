import { describe, expect, it } from "bun:test";
import type {
  ArtifactSpillRecord,
  ExportMemoryResult,
} from "../../src";
import {
  createGoodMemory,
  createInMemoryDocumentStore,
  createFeedbackMemory,
  createMemorySource,
  createReferenceMemory,
  createSessionJournal,
  createWorkingMemorySnapshot,
} from "../../src";
import { createInternalGoodMemory } from "../../src/api/createGoodMemory";
import { attachGoodMemoryEvalSupport } from "../../src/api/evalSupport";
import { createHostAdapter } from "../../src/host";
import type { HostArtifactType } from "../../src/host";
import { readHostEvalSupport } from "../../src/host/evalSupport";
import { buildPageArtifacts } from "../../src/governance/pageArtifacts";

function createExportResult(
  extraFiles: ExportMemoryResult["artifacts"]["files"] = [],
): ExportMemoryResult {
  return {
    pages: buildPageArtifacts({ notes: [] }),
    artifacts: {
      rootPath: ".goodmemory/users/u-1/workspaces/ws-1/sessions/s-1",
      files: [
        {
          kind: "memory",
          relativePath: "MEMORY.md",
          content: "# MEMORY",
        },
        {
          kind: "user",
          relativePath: "user.md",
          content: "# User Memory",
        },
        {
          kind: "session",
          relativePath: "session.md",
          sessionId: "s-1",
          content: "# Session Memory: s-1",
        },
        ...extraFiles,
      ],
    },
    scope: {
      userId: "u-1",
      workspaceId: "ws-1",
      sessionId: "s-1",
    },
    exportedAt: "2026-04-19T00:00:00.000Z",
    durable: {
      profile: null,
      preferences: [],
      references: [],
      facts: [],
      feedback: [],
      episodes: [],
      archives: [],
      evidence: [],
      experiences: [],
      proposals: [],
      promotions: [],
    },
    runtime: {
      workingMemory: null,
      journal: null,
      spills: [],
    },
  };
}

function createCodingAgentExportResult(currentGoal: string): ExportMemoryResult {
  const source = createMemorySource({
    method: "explicit",
    extractedAt: "2026-04-19T00:00:00.000Z",
    sessionId: "s-1",
  });
  const spill: ArtifactSpillRecord = {
    id: "spill-1",
    scope: {
      userId: "u-1",
      workspaceId: "ws-1",
      sessionId: "s-1",
    },
    kind: "tool_result",
    sourceId: "tool-1",
    preview: "Rollback checklist excerpt",
    replacementText: "[spill-1]",
    storageUri: "memory://spill-1",
    originalBytes: 256,
    createdAt: "2026-04-19T00:00:00.000Z",
  };

  return {
    ...createExportResult(),
    durable: {
      ...createExportResult().durable,
      references: [
        createReferenceMemory({
          id: "ref-1",
          userId: "u-1",
          workspaceId: "ws-1",
          sessionId: "s-1",
          title: "Runtime runbook",
          pointer: "docs/runtime-runbook.md",
          source,
          updatedAt: "2026-04-19T00:00:00.000Z",
          createdAt: "2026-04-19T00:00:00.000Z",
        }),
      ],
      feedback: [
        createFeedbackMemory({
          id: "feedback-1",
          userId: "u-1",
          workspaceId: "ws-1",
          sessionId: "s-1",
          rule: "Keep coding task updates concise and action-oriented.",
          kind: "validated_pattern",
          source,
          updatedAt: "2026-04-19T00:00:00.000Z",
        }),
      ],
    },
    runtime: {
      workingMemory: createWorkingMemorySnapshot({
        sessionId: "s-1",
        userId: "u-1",
        currentGoal,
        openLoops: ["wire buildContext output"],
        temporaryDecisions: ["Use the rollback checklist before deploy."],
        constraints: ["Keep context budget under control."],
        updatedAt: "2026-04-19T00:00:00.000Z",
      }),
      journal: createSessionJournal({
        sessionId: "s-1",
        userId: "u-1",
        currentState: "Recall router implemented.",
        filesAndFunctions: ["src/recall/engine.ts", "src/recall/contextBuilder.ts"],
        workflow: ["Verify the rollback checklist", "Wire buildContext output"],
        keyResults: ["Recall router implemented."],
        worklog: ["Checked the rollback checklist."],
        updatedAt: "2026-04-19T00:00:00.000Z",
      }),
      spills: [spill],
    },
  };
}

describe("host adapter contract", () => {
  it("declares explicit file-assisted capabilities and filters readable artifact types", async () => {
    const adapter = createHostAdapter({
      id: "codex-readonly",
      hostKind: "codex",
      memory: {
        async exportMemory() {
          return createExportResult();
        },
      },
      readableArtifactTypes: ["memory_index", "session_memory"],
    });

    expect(adapter.capabilities.mode).toBe("file-assisted");
    expect(adapter.capabilities.readableArtifactTypes).toEqual([
      "memory_index",
      "session_memory",
    ]);
    expect(adapter.capabilities.writableArtifactTypes).toEqual([]);

    const result = await adapter.readArtifacts({
      scope: {
        userId: "u-1",
        workspaceId: "ws-1",
        sessionId: "s-1",
      },
      includeRuntime: true,
    });

    expect(result.artifacts.map((artifact) => artifact.artifactType)).toEqual([
      "memory_index",
      "session_memory",
    ]);
    expect(result.artifacts.every((artifact) => artifact.writable === false)).toBeTrue();
  });

  it("freezes negotiated capabilities so hosts cannot widen file-assisted boundaries at runtime", async () => {
    const adapter = createHostAdapter({
      id: "codex-frozen",
      hostKind: "codex",
      memory: {
        async exportMemory() {
          return createExportResult();
        },
      },
      readableArtifactTypes: ["memory_index"],
    });

    expect(Object.isFrozen(adapter)).toBeTrue();
    expect(Object.isFrozen(adapter.capabilities)).toBeTrue();
    expect(Object.isFrozen(adapter.capabilities.readableArtifactTypes)).toBeTrue();
    expect(Object.isFrozen(adapter.capabilities.writableArtifactTypes)).toBeTrue();

    expect(() =>
      (adapter.capabilities.readableArtifactTypes as HostArtifactType[]).push(
        "user_memory",
      ),
    ).toThrow();

    const result = await adapter.readArtifacts({
      scope: {
        userId: "u-1",
        workspaceId: "ws-1",
        sessionId: "s-1",
      },
      includeRuntime: true,
    });

    expect(result.artifacts.map((artifact) => artifact.artifactType)).toEqual([
      "memory_index",
    ]);

    await expect(
      adapter.writeArtifact({
        scope: {
          userId: "u-1",
          workspaceId: "ws-1",
        },
        artifactType: "user_memory",
        relativePath: "user.md",
        content: "# User Memory",
      }),
    ).rejects.toThrow("does not allow writes for artifact type user_memory");
  });

  it("rejects invalid writable capability negotiation during adapter creation", () => {
    const documentStore = createInMemoryDocumentStore();

    expect(() =>
      createHostAdapter({
        id: "claude-invalid-mode",
        mode: "file-assisted",
        writableArtifactTypes: ["user_memory"],
        memory: {
          async exportMemory() {
            return createExportResult();
          },
        },
      }),
    ).toThrow("file-assisted adapters cannot declare writable artifact types");

    expect(() =>
      createHostAdapter({
        id: "claude-invalid-subset",
        mode: "file-authoritative",
        documentStore,
        readableArtifactTypes: ["memory_index"],
        writableArtifactTypes: ["user_memory"],
        memory: {
          async exportMemory() {
            return createExportResult();
          },
        },
      }),
    ).toThrow("writable artifact types must be a subset of readable artifact types");
  });

  it("rejects readable capability claims that the configured export surface cannot supply", () => {
    expect(() =>
      createHostAdapter({
        id: "codex-unsupported-playbook",
        readableArtifactTypes: ["playbook"],
        supportedReadableArtifactTypes: ["memory_index", "user_memory", "session_memory"],
        memory: {
          async exportMemory() {
            return createExportResult();
          },
        },
      }),
    ).toThrow(
      "readable artifact types must be supported by the configured export surface",
    );
  });

  it("allows future artifact types only when the export surface opts into them explicitly", async () => {
    const adapter = createHostAdapter({
      id: "codex-playbook",
      readableArtifactTypes: ["playbook"],
      supportedReadableArtifactTypes: ["memory_index", "user_memory", "session_memory", "playbook"],
      memory: {
        async exportMemory() {
          return createExportResult([
            {
              kind: "playbook",
              relativePath: "playbooks/incident.md",
              content: "# Incident Playbook",
            },
            {
              kind: "playbook",
              relativePath: "playbooks/incident.prompt.md",
              content: "# Prompt Snippet: Incident Playbook",
            },
            {
              kind: "playbook",
              relativePath: "playbooks/incident.skill.md",
              content: "# Skill Snippet: Incident Playbook",
            },
          ]);
        },
      },
    });

    const result = await adapter.readArtifacts({
      scope: {
        userId: "u-1",
        workspaceId: "ws-1",
        sessionId: "s-1",
      },
      includeRuntime: true,
    });

    expect(result.artifacts.map((artifact) => artifact.artifactType)).toEqual([
      "playbook",
      "playbook",
      "playbook",
    ]);
    expect(result.artifacts.map((artifact) => artifact.relativePath)).toEqual([
      "playbooks/incident.md",
      "playbooks/incident.prompt.md",
      "playbooks/incident.skill.md",
    ]);
  });

  it("supports playbook artifacts through the default file-assisted readable surface", async () => {
    const adapter = createHostAdapter({
      id: "codex-playbook-default-surface",
      readableArtifactTypes: ["playbook"],
      memory: {
        async exportMemory() {
          return createExportResult([
            {
              kind: "playbook",
              relativePath: "playbooks/incident.md",
              content: "# Incident Playbook",
            },
          ]);
        },
      },
    });

    const result = await adapter.readArtifacts({
      scope: {
        userId: "u-1",
        workspaceId: "ws-1",
        sessionId: "s-1",
      },
      includeRuntime: true,
    });

    expect(result.artifacts.map((artifact) => artifact.artifactType)).toEqual(["playbook"]);
    expect(result.artifacts[0]?.relativePath).toBe("playbooks/incident.md");
  });

  it("exposes archive recap artifacts through the host read path", async () => {
    const adapter = createHostAdapter({
      id: "codex-archive",
      readableArtifactTypes: ["archive_recap"],
      memory: {
        async exportMemory() {
          return createExportResult([
            {
              kind: "archive",
              relativePath: "archive/2026/04/s-1.md",
              sessionId: "s-1",
              content: "# Archive Recap: s-1",
            },
          ]);
        },
      },
    });

    const result = await adapter.readArtifacts({
      scope: {
        userId: "u-1",
        workspaceId: "ws-1",
      },
    });

    expect(result.artifacts.map((artifact) => artifact.artifactType)).toEqual([
      "archive_recap",
    ]);
    expect(result.artifacts[0]?.relativePath).toBe("archive/2026/04/s-1.md");
  });

  it("maps session artifacts into handoff files and refreshes them from runtime state", async () => {
    let currentGoal = "Finish recall engine";

    const adapter = createHostAdapter({
      id: "codex-session-handoff",
      hostKind: "codex",
      readableArtifactTypes: ["session_memory"],
      memory: {
        async exportMemory() {
          return createCodingAgentExportResult(currentGoal);
        },
      },
    });

    const first = await adapter.readArtifacts({
      scope: {
        userId: "u-1",
        workspaceId: "ws-1",
        sessionId: "s-1",
      },
      includeRuntime: true,
    });

    expect(first.artifacts).toHaveLength(1);
    expect(first.artifacts[0]?.relativePath).toBe("session-memory/s-1.md");
    expect(first.artifacts[0]?.content).toContain("# Session Handoff: s-1");
    expect(first.artifacts[0]?.content).toContain("## Current goal");
    expect(first.artifacts[0]?.content).toContain("Finish recall engine");
    expect(first.artifacts[0]?.content).toContain("## Open loops");
    expect(first.artifacts[0]?.content).toContain("wire buildContext output");
    expect(first.artifacts[0]?.content).toContain("## Recent Decisions");
    expect(first.artifacts[0]?.content).toContain("Use the rollback checklist before deploy.");
    expect(first.artifacts[0]?.content).toContain("## Key Files");
    expect(first.artifacts[0]?.content).toContain("src/recall/engine.ts");
    expect(first.artifacts[0]?.content).toContain("docs/runtime-runbook.md");
    expect(first.artifacts[0]?.content).toContain("## Procedural Memory");
    expect(first.artifacts[0]?.content).toContain(
      "Keep coding task updates concise and action-oriented.",
    );
    expect(first.artifacts[0]?.content).toContain("## Artifact Spills");
    expect(first.artifacts[0]?.content).toContain("Rollback checklist excerpt");

    currentGoal = "Ship host adapter";

    const second = await adapter.readArtifacts({
      scope: {
        userId: "u-1",
        workspaceId: "ws-1",
        sessionId: "s-1",
      },
      includeRuntime: true,
    });

    expect(second.artifacts[0]?.content).toContain("Ship host adapter");
    expect(second.artifacts[0]?.content).not.toContain("Finish recall engine");
  });

  it("renders Japanese session handoff labels through the configured language pack", async () => {
    const adapter = createHostAdapter({
      id: "codex-japanese-session-handoff",
      hostKind: "codex",
      readableArtifactTypes: ["session_memory"],
      memory: {
        async exportMemory() {
          return createCodingAgentExportResult("リコールエンジンを完成する");
        },
      },
    });

    const result = await adapter.readArtifacts({
      scope: {
        userId: "u-1",
        workspaceId: "ws-1",
        sessionId: "s-1",
      },
      includeRuntime: true,
      locale: "ja-JP",
    });
    const content = result.artifacts[0]?.content;

    expect(content).toContain("# セッション引き継ぎ: s-1");
    expect(content).toContain("## 現在の目標");
    expect(content).toContain("## 未完了事項");
    expect(content).toContain("## 最近の決定");
    expect(content).toContain("## 主要ファイル");
    expect(content).toContain("## 手順メモリ");
  });

  it("keeps session handoff projections limited to active references and procedural memory", async () => {
    const source = createMemorySource({
      method: "explicit",
      extractedAt: "2026-04-19T00:00:00.000Z",
      sessionId: "s-1",
    });
    const adapter = createHostAdapter({
      id: "codex-session-handoff-active-only",
      hostKind: "codex",
      readableArtifactTypes: ["session_memory"],
      memory: {
        async exportMemory() {
          return {
            ...createExportResult(),
            durable: {
              ...createExportResult().durable,
              references: [
                createReferenceMemory({
                  id: "ref-active",
                  userId: "u-1",
                  workspaceId: "ws-1",
                  sessionId: "s-1",
                  title: "Runtime runbook",
                  pointer: "docs/runtime-runbook.md",
                  source,
                  updatedAt: "2026-04-19T00:00:00.000Z",
                  createdAt: "2026-04-19T00:00:00.000Z",
                }),
                createReferenceMemory({
                  id: "ref-superseded",
                  userId: "u-1",
                  workspaceId: "ws-1",
                  sessionId: "s-1",
                  title: "Old runtime runbook",
                  pointer: "docs/runtime-runbook-v1.md",
                  source,
                  lifecycle: "superseded",
                  updatedAt: "2026-04-19T00:00:00.000Z",
                  createdAt: "2026-04-19T00:00:00.000Z",
                }),
              ],
              feedback: [
                createFeedbackMemory({
                  id: "feedback-active",
                  userId: "u-1",
                  workspaceId: "ws-1",
                  sessionId: "s-1",
                  rule: "Use pnpm.",
                  kind: "validated_pattern",
                  source,
                  updatedAt: "2026-04-19T00:00:00.000Z",
                }),
                createFeedbackMemory({
                  id: "feedback-superseded",
                  userId: "u-1",
                  workspaceId: "ws-1",
                  sessionId: "s-1",
                  rule: "Use npm.",
                  kind: "validated_pattern",
                  source,
                  lifecycle: "superseded",
                  supersededBy: "feedback-active",
                  updatedAt: "2026-04-19T00:00:00.000Z",
                }),
                createFeedbackMemory({
                  id: "feedback-inactive",
                  userId: "u-1",
                  workspaceId: "ws-1",
                  sessionId: "s-1",
                  rule: "Use yarn.",
                  kind: "validated_pattern",
                  source,
                  lifecycle: "inactive",
                  updatedAt: "2026-04-19T00:00:00.000Z",
                }),
              ],
            },
          };
        },
      },
    });

    const result = await adapter.readArtifacts({
      scope: {
        userId: "u-1",
        workspaceId: "ws-1",
        sessionId: "s-1",
      },
      includeRuntime: true,
    });

    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]?.content).toContain("Use pnpm.");
    expect(result.artifacts[0]?.content).not.toContain("Use npm.");
    expect(result.artifacts[0]?.content).not.toContain("Use yarn.");
    expect(result.artifacts[0]?.content).toContain("docs/runtime-runbook.md");
    expect(result.artifacts[0]?.content).not.toContain("docs/runtime-runbook-v1.md");
  });

  it("exposes an internal trace-recording helper on the accepted Codex host path", async () => {
    const memory = createInternalGoodMemory(
      {
        storage: { provider: "memory" },
        testing: {
          now: () => new Date("2026-04-21T00:00:00.000Z"),
        },
      },
      {
        behavioralOutcomeRecorder: true,
      },
    );
    const adapter = createHostAdapter({
      id: "codex-trace-helper",
      hostKind: "codex",
      readableArtifactTypes: ["session_memory"],
      memory,
    });
    const support = readHostEvalSupport(adapter);

    expect(support?.createBehavioralTraceRecorder).toBeDefined();
    expect(support?.recordBehavioralTrace).toBeDefined();

    const result = await support!.recordBehavioralTrace!({
      scope: {
        userId: "u-1",
        workspaceId: "ws-1",
      },
      trace: {
        cue: "detailed analysis",
        hostKind: "codex",
        traceId: "codex-trace-1",
        events: [
          {
            stepIndex: 0,
            actionKind: "tool_call",
            actionName: "DeepAnalyzer",
            raw: "DeepAnalyzer --detailed",
            evidenceExcerpt: "DeepAnalyzer timed out on detailed analysis.",
            outcome: "timeout",
          },
          {
            stepIndex: 1,
            actionKind: "tool_call",
            actionName: "QuickCheck",
            raw: "QuickCheck --network",
            correctionOfStepIndex: 0,
            outcome: "success",
          },
        ],
      },
    });

    expect(result.recorded).toBe(true);

    const exported = await memory.exportMemory({
      scope: {
        userId: "u-1",
        workspaceId: "ws-1",
      },
    });
    expect(
      exported.durable.experiences.some(
        (experience) => experience.kind === "tool_outcome",
      ),
    ).toBeTrue();
  });

  it("captures runtime Codex behavioral traces incrementally and records telemetry on close", async () => {
    const memory = createInternalGoodMemory(
      {
        storage: { provider: "memory" },
        testing: {
          now: () => new Date("2026-04-21T00:00:00.000Z"),
        },
      },
      {
        behavioralOutcomeRecorder: true,
      },
    );
    const adapter = createHostAdapter({
      createId: (() => {
        let counter = 0;
        return () => `trace-id-${++counter}`;
      })(),
      id: "codex-runtime-trace-helper",
      hostKind: "codex",
      readableArtifactTypes: ["session_memory"],
      memory,
    });
    const support = readHostEvalSupport(adapter);
    const recorder = support?.createBehavioralTraceRecorder?.({
      cue: "detailed analysis",
      scope: {
        userId: "u-1",
        workspaceId: "ws-1",
      },
    });

    expect(recorder).toBeDefined();

    recorder!.appendEvent({
      actionKind: "tool_call",
      actionName: "DeepAnalyzer",
      raw: "DeepAnalyzer --detailed",
      evidenceExcerpt: "DeepAnalyzer timed out on detailed analysis.",
      outcome: "timeout",
    });
    recorder!.appendEvent({
      actionKind: "tool_call",
      actionName: "QuickCheck",
      raw: "QuickCheck --network",
      correctionOfStepIndex: 0,
      outcome: "success",
    });

    const result = await recorder!.close();

    expect(result.recorded).toBe(true);
    expect(result.trace?.traceId).toBe("host-trace-trace-id-1");
    expect(result.trace?.events[0]?.stepIndex).toBe(0);
    expect(result.trace?.events[1]?.stepIndex).toBe(1);

    const exported = await memory.exportMemory({
      scope: {
        userId: "u-1",
        workspaceId: "ws-1",
      },
    });
    expect(
      exported.durable.experiences.some(
        (experience) => experience.kind === "tool_outcome",
      ),
    ).toBeTrue();
  });

  it("promotes repeated runtime Codex trace failures through the same validated-pattern path", async () => {
    const memory = createInternalGoodMemory(
      {
        storage: { provider: "memory" },
        testing: {
          now: () => new Date("2026-04-21T00:00:00.000Z"),
        },
      },
      {
        behavioralOutcomeRecorder: true,
      },
    );
    const adapter = createHostAdapter({
      id: "codex-runtime-trace-promotion",
      hostKind: "codex",
      readableArtifactTypes: ["session_memory"],
      memory,
    });
    const support = readHostEvalSupport(adapter);

    for (const traceId of ["runtime-trace-1", "runtime-trace-2"]) {
      const recorder = support!.createBehavioralTraceRecorder!({
        cue: "detailed analysis",
        scope: {
          userId: "u-1",
          workspaceId: "ws-1",
        },
        traceId,
      });

      recorder.appendEvent({
        actionKind: "tool_call",
        actionName: "DeepAnalyzer",
        raw: "DeepAnalyzer --detailed",
        evidenceExcerpt: "DeepAnalyzer timed out on detailed analysis.",
        outcome: "timeout",
      });
      recorder.appendEvent({
        actionKind: "tool_call",
        actionName: "QuickCheck",
        raw: "QuickCheck --network",
        correctionOfStepIndex: 0,
        outcome: "success",
      });

      const result = await recorder.close();
      expect(result.recorded).toBe(true);
    }

    const exported = await memory.exportMemory({
      scope: {
        userId: "u-1",
        workspaceId: "ws-1",
      },
    });
    expect(
      exported.durable.feedback.some(
        (feedback) =>
          feedback.kind === "validated_pattern" && feedback.lifecycle === "active",
      ),
    ).toBeTrue();
  });

  it("still exposes a Codex trace helper when the memory instance cannot record behavioral outcomes", () => {
    const adapter = createHostAdapter({
      id: "codex-trace-helper-missing-recorder",
      hostKind: "codex",
      readableArtifactTypes: ["session_memory"],
      memory: createGoodMemory({
        storage: { provider: "memory" },
      }),
    });
    const support = readHostEvalSupport(adapter);

    expect(support?.createBehavioralTraceRecorder).toBeDefined();
    expect(support?.recordBehavioralTrace).toBeUndefined();
  });

  it("still emits a Codex runtime trace when behavioral telemetry recording is unavailable", async () => {
    const memory = createGoodMemory({
      storage: { provider: "memory" },
    });
    const adapter = createHostAdapter({
      id: "codex-runtime-trace-no-recorder",
      hostKind: "codex",
      readableArtifactTypes: ["session_memory"],
      memory,
    });
    const support = readHostEvalSupport(adapter);
    const recorder = support?.createBehavioralTraceRecorder?.({
      cue: "production deploy",
      scope: {
        userId: "u-1",
        workspaceId: "ws-1",
      },
      traceId: "codex-trace-no-recorder",
    });

    recorder!.appendEvent({
      actionKind: "warning",
      actionName: "approval_required",
      raw: "Warning: request production approval before deploy --prod 512.",
      outcome: "success",
    });

    const result = await recorder!.close();

    expect(result.recorded).toBe(false);
    expect(result.trace?.traceId).toBe("codex-trace-no-recorder");
    expect(result.trace?.events[0]?.actionKind).toBe("warning");
  });

  it("does not let Codex runtime trace close fail when telemetry recording throws", async () => {
    const memory = attachGoodMemoryEvalSupport(
      createGoodMemory({
        storage: { provider: "memory" },
      }),
      {
        recordBehavioralOutcome: async () => {
          throw new Error("telemetry backend unavailable");
        },
      },
    );
    const adapter = createHostAdapter({
      id: "codex-runtime-trace-recording-failure",
      hostKind: "codex",
      readableArtifactTypes: ["session_memory"],
      memory,
    });
    const support = readHostEvalSupport(adapter);
    const recorder = support?.createBehavioralTraceRecorder?.({
      cue: "production deploy",
      scope: {
        userId: "u-1",
        workspaceId: "ws-1",
      },
      traceId: "codex-trace-recording-failure",
    });

    recorder!.appendEvent({
      actionKind: "tool_call",
      actionName: "DeployProd",
      raw: "DeployProd --prod",
      evidenceExcerpt: "DeployProd timed out waiting for production approval.",
      outcome: "timeout",
    });

    const result = await recorder!.close();

    expect(result.recorded).toBe(false);
    expect(result.trace?.traceId).toBe("codex-trace-recording-failure");
    expect(result.error?.message).toBe("telemetry backend unavailable");
  });

  it("fails fast on unsupported or not-yet-implemented writes", async () => {
    const documentStore = createInMemoryDocumentStore();
    const adapter = createHostAdapter({
      id: "claude-authoritative",
      hostKind: "claude",
      mode: "file-authoritative",
      documentStore,
      readableArtifactTypes: ["user_memory"],
      writableArtifactTypes: ["user_memory"],
      memory: {
        async exportMemory() {
          return createExportResult();
        },
      },
    });

    await expect(
      adapter.writeArtifact({
        scope: {
          userId: "u-1",
          workspaceId: "ws-1",
        },
        artifactType: "playbook",
        relativePath: "playbooks/incident.md",
        content: "# Incident Playbook",
      }),
    ).rejects.toThrow("does not allow writes for artifact type playbook");

    await expect(
      adapter.writeArtifact({
        scope: {
          userId: "u-1",
          workspaceId: "ws-1",
        },
        artifactType: "user_memory",
        relativePath: "user.md",
        content: "# User Memory",
      }),
    ).rejects.toThrow("Structured delta writeback is not implemented yet");
  });
});
