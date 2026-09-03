import { describe, expect, it } from "bun:test";
import type {
  BuildContextInput,
  GoodMemory,
  GoodMemoryRuntimeStateResult,
  RecallInput,
  RecallResult,
  RememberInput,
} from "../../src";
import {
  createFeedbackMemory,
} from "../../src/domain/records";
import { createMemorySource } from "../../src/domain/provenance";
import { attachBehavioralPolicyAttributes } from "../../src/evolution/behavioralPolicy";
import { buildBehavioralOutcomeExperienceRecord } from "../../src/evolution/behavioralTelemetry";
import type {
  HostActionAssessmentResult,
  HostActionIntent,
  HostKind,
} from "../../src/host";
import type {
  ProgressiveRecallIndex,
  ProgressiveRecallService,
  SearchRecallIndexInput,
} from "../../src/progressive/recall";
import {
  buildProgressiveScopeDigest,
  encodeGoodMemoryRecordRef,
} from "../../src/progressive/recall";
import { createGoodMemoryRuntimeKit } from "../../src/runtime-kit";
import { buildPageArtifacts } from "../../src/governance/pageArtifacts";

const scope = {
  userId: "runtime-kit-user",
  workspaceId: "runtime-kit-workspace",
  agentId: "codex",
  sessionId: "runtime-kit-session",
};

const emptyRuntimeState: GoodMemoryRuntimeStateResult = {
  state: {
    buffer: {
      sessionId: scope.sessionId,
      userId: scope.userId,
      messages: [],
      summary: null,
      summaryUpToIndex: -1,
      createdAt: "2026-04-26T00:00:00.000Z",
      lastActiveAt: "2026-04-26T00:00:00.000Z",
    },
    workingMemory: {
      sessionId: scope.sessionId,
      userId: scope.userId,
      constraints: [],
      openLoops: [],
      temporaryDecisions: [],
      toolState: {},
      state: {},
      updatedAt: "2026-04-26T00:00:00.000Z",
    },
    journal: {
      sessionId: scope.sessionId,
      userId: scope.userId,
      filesAndFunctions: [],
      workflow: [],
      errorsAndCorrections: [],
      systemDocumentation: [],
      learnings: [],
      keyResults: [],
      worklog: [],
      updatedAt: "2026-04-26T00:00:00.000Z",
    },
  },
  traceId: "runtime-trace-1",
};

function createRecallResult(): RecallResult {
  return {
    profile: null,
    preferences: [],
    references: [],
    notes: [],
    facts: [],
    feedback: [],
    archives: [],
    evidence: [],
    episodes: [],
    workingMemory: null,
    journal: null,
    packet: {},
    metadata: {
      routingDecision: {
        strategy: "rules-only",
        retrievalProfile: "general_chat",
        intent: "general_assistance",
        strategyExplanation: {
          requestedStrategy: "rules-only",
          resolvedStrategy: "rules-only",
          summary: "test",
          hardFloor: "lexical_runtime_procedural_priors",
          semanticTieBreaking: false,
          llmRefinement: false,
        },
        sourcePriorities: [],
        requestedSlots: [],
        supportSlots: [],
        actionDriving: false,
        referenceSeeking: false,
        continuation: false,
      },
      tokenCount: 0,
      latencyMs: 0,
      hits: [],
      candidateTraces: [],
      verificationHints: [],
      policyApplied: [],
    },
  };
}

function createMemoryStub(overrides: Partial<GoodMemory> = {}): GoodMemory {
  const memory: GoodMemory = {
    runtime: {
      async startSession() {
        return emptyRuntimeState;
      },
      async getState() {
        return emptyRuntimeState;
      },
      async appendMessage() {
        return { buffer: emptyRuntimeState.state.buffer };
      },
      async setSessionSummary() {
        return { buffer: emptyRuntimeState.state.buffer };
      },
      async updateWorkingMemory() {
        return { workingMemory: emptyRuntimeState.state.workingMemory };
      },
      async updateSessionJournal() {
        return { journal: emptyRuntimeState.state.journal };
      },
      async getRecallSnapshot() {
        return {
          snapshot: {
            buffer: emptyRuntimeState.state.buffer,
            workingMemory: emptyRuntimeState.state.workingMemory,
            journal: emptyRuntimeState.state.journal,
          },
        };
      },
      async endSession() {
        return emptyRuntimeState;
      },
    },
    jobs: {
      async enqueueRemember(input) {
        return {
          jobId: "job-1",
          idempotencyKey: input.idempotencyKey,
          operation: "remember",
          status: "queued",
          attempts: 0,
          createdAt: "2026-04-26T00:00:00.000Z",
          updatedAt: "2026-04-26T00:00:00.000Z",
          linkedTraceIds: [],
          linkedMemoryIds: [],
          linkedEvidenceIds: [],
        };
      },
      async getJob() {
        return null;
      },
      async retryJob() {
        return null;
      },
      async drain() {
        return { processed: 0, jobs: [] };
      },
    },
    async recall() {
      return createRecallResult();
    },
    async buildContext() {
      return {
        output: "system_prompt_fragment",
        content: "Remembered context fragment.",
        estimatedTokens: 6,
        omittedSections: [],
      };
    },
    async remember() {
      return {
        accepted: 1,
        rejected: 0,
        events: [],
      };
    },
    async reviseMemory() {
      return {
        accepted: false,
        outcome: "unsupported",
        policyApplied: [],
      };
    },
    async forget() {
      return { forgotten: false };
    },
    async importMemory() {
      throw new Error("importMemory is not implemented by this fake.");
    },
    async exportMemory() {
      return {
        pages: buildPageArtifacts({ notes: [] }),
        artifacts: { rootPath: "", files: [] },
        scope,
        exportedAt: "2026-04-26T00:00:00.000Z",
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
      };
    },
    async deleteAllMemory() {
      return {
        scope,
        deleted: {
          profiles: 0,
          preferences: 0,
          references: 0,
          notes: 0,
          facts: 0,
          feedback: 0,
          episodes: 0,
          archives: 0,
          evidence: 0,
          experiences: 0,
          proposals: 0,
          promotions: 0,
          workingMemory: 0,
          journal: 0,
          artifactSpills: 0,
        },
      };
    },
    async feedback() {
      return { accepted: false };
    },
    async runMaintenance() {
      return {
        ran: false,
        reason: "threshold",
        compiledCount: 0,
        maintenance: null,
        proposalCount: 0,
        promotionDecisionCounts: {},
      };
    },
  };

  return {
    ...memory,
    ...overrides,
    runtime: {
      ...memory.runtime,
      ...overrides.runtime,
    },
    jobs: {
      ...memory.jobs,
      ...overrides.jobs,
    },
  };
}

function createProgressiveService(): ProgressiveRecallService {
  const index: ProgressiveRecallIndex = {
    generatedAt: "2026-04-26T00:00:00.000Z",
    query: "runtime kit",
    scopeDigest: "scope_runtimekit",
    totalRecordCount: 1,
    records: [
      {
        recordRef: "gmrec:v1:scope_runtimekit:fact:fact-1",
        recordKind: "fact",
        title: "Runtime kit fact",
        summary: "Runtime kit should reuse ProgressiveRecallService.",
        score: 1,
        estimatedDetailTokens: 12,
        estimatedIndexTokens: 8,
        source: "durable",
      },
    ],
  };

  return {
    async searchRecallIndex() {
      return index;
    },
    async buildRecallTimeline() {
      return {
        buckets: [{ label: "undated", records: index.records }],
        scopeDigest: index.scopeDigest,
        totalRecordCount: index.totalRecordCount,
      };
    },
    async getProgressiveRecords() {
      return {
        scopeDigest: index.scopeDigest,
        records: [],
      };
    },
    renderProgressiveContext() {
      return {
        content: "Progressive GoodMemory Recall\nref: gmrec:v1:scope_runtimekit:fact:fact-1",
        estimatedTokens: 16,
        omittedRecordCount: 0,
      };
    },
  };
}

describe("runtime-kit", () => {
  it("renders fragment context through existing recall and buildContext APIs", async () => {
    const calls: string[] = [];
    const memory = createMemoryStub({
      async recall(input) {
        calls.push(`recall:${input.query}`);
        return createRecallResult();
      },
      async buildContext(input) {
        calls.push(`build:${input.maxTokens}`);
        return {
          output: "system_prompt_fragment",
          content: "Fragment recall content.",
          estimatedTokens: 5,
          omittedSections: [],
        };
      },
    });
    const runtimeKit = createGoodMemoryRuntimeKit({ memory });

    const result = await runtimeKit.beforeModelCall({
      scope,
      query: "What should I remember?",
      maxMemoryTokens: 80,
    });

    expect(result.context.mode).toBe("fragment");
    expect(result.context.content).toBe("Fragment recall content.");
    expect(result.events[0]).toMatchObject({
      phase: "beforeModelCall",
      status: "applied",
      contextMode: "fragment",
    });
    expect(calls).toEqual(["recall:What should I remember?", "build:80"]);
  });

  it("forwards the turn reference time and timezone to fragment recall", async () => {
    const recallInputs: RecallInput[] = [];
    const runtimeKit = createGoodMemoryRuntimeKit({
      memory: createMemoryStub({
        async recall(input) {
          recallInputs.push(input);
          return createRecallResult();
        },
      }),
    });

    const before = await runtimeKit.beforeModelCall({
      scope,
      query: "What happened yesterday?",
      referenceTime: "2026-11-01T05:30:00.000Z",
      timezone: "America/New_York",
    });

    expect(before).toMatchObject({
      referenceTime: "2026-11-01T05:30:00.000Z",
      timezone: "America/New_York",
    });
    expect(recallInputs[0]).toMatchObject({
      referenceTime: "2026-11-01T05:30:00.000Z",
      timezone: "America/New_York",
    });
  });

  it("does not implicitly associate an after call with a scope-only turn anchor", async () => {
    const rememberInputs: RememberInput[] = [];
    const runtimeKit = createGoodMemoryRuntimeKit({
      memory: createMemoryStub({
        async remember(input) {
          rememberInputs.push(input);
          return { accepted: 1, rejected: 0, events: [] };
        },
      }),
    });

    const before = await runtimeKit.beforeModelCall({
      scope,
      query: "Current turn",
      referenceTime: "2026-11-01T05:30:00.000Z",
      timezone: "America/New_York",
    });
    await runtimeKit.beforeModelCall({
      scope,
      query: "Concurrent turn",
      referenceTime: "2026-11-01T05:31:00.000Z",
      timezone: "Europe/Paris",
    });
    await runtimeKit.afterModelCall({
      scope,
      messages: [{ role: "user", content: "Current turn" }],
      assistantText: "Current answer",
      writeback: {
        mode: "selective",
        annotation: "durable_candidate",
        policy: "allow",
      },
    });

    expect(before.referenceTime).toBe("2026-11-01T05:30:00.000Z");
    expect(rememberInputs[0]).not.toHaveProperty("timezone");
    expect(rememberInputs[0]?.messages[0]).not.toHaveProperty("observedAt");
    expect(rememberInputs[0]?.messages[1]).not.toHaveProperty("observedAt");
  });

  it("opts into typed ledger recall and rendering only for an enabled runtime profile", async () => {
    const recallInputs: RecallInput[] = [];
    const buildInputs: BuildContextInput[] = [];
    const memory = createMemoryStub({
      async recall(input) {
        recallInputs.push(input);
        return createRecallResult();
      },
      async buildContext(input) {
        buildInputs.push(input);
        return {
          output: "system_prompt_fragment",
          content: "Ledger context.",
          estimatedTokens: 4,
          omittedSections: [],
        };
      },
    });

    const defaultRuntime = createGoodMemoryRuntimeKit({ memory });
    await defaultRuntime.beforeModelCall({
      query: "What is current?",
      scope,
    });

    const ledgerRuntime = createGoodMemoryRuntimeKit({
      evidenceLedgerFormat: "chronology",
      memory,
    });
    await ledgerRuntime.beforeModelCall({
      query: "What is current?",
      scope,
    });

    expect(recallInputs[0]).not.toHaveProperty("includeEvidence");
    expect(buildInputs[0]).not.toHaveProperty("evidenceLedgerFormat");
    expect(recallInputs[1]).toMatchObject({ includeEvidence: true });
    expect(buildInputs[1]).toMatchObject({
      evidenceLedgerFormat: "chronology",
    });
  });

  it("adds hidden behavioral steering without exposing remembered-note phrasing", async () => {
    const memory = createMemoryStub({
      async recall() {
        const recall = createRecallResult();
        return {
          ...recall,
          feedback: [
            createFeedbackMemory({
              id: "feedback-1",
              userId: scope.userId,
              workspaceId: scope.workspaceId,
              agentId: scope.agentId,
              sessionId: scope.sessionId,
              kind: "validated_pattern",
              rule:
                "Always start the response with \"Subject: [Internal]\" and end with \"Regards,\".",
              attributes: attachBehavioralPolicyAttributes(undefined, {
                behavioralKind: "format_contract",
                enactmentSurface: "text_response",
                applicability: {
                  appliesTo: "general_response",
                  exactFragments: {
                    prefixes: ["Subject: [Internal]"],
                    suffixes: ["Regards,"],
                  },
                },
                transferMode: "general",
              }),
              source: createMemorySource({
                method: "confirmed",
                extractedAt: "2026-04-30T00:00:00.000Z",
                sessionId: scope.sessionId,
              }),
              updatedAt: "2026-04-30T00:00:00.000Z",
            }),
          ],
        };
      },
      async buildContext() {
        return {
          output: "system_prompt_fragment",
          content: "Fragment recall content.",
          estimatedTokens: 5,
          omittedSections: [],
        };
      },
    });
    const runtimeKit = createGoodMemoryRuntimeKit({ memory });

    const result = await runtimeKit.beforeModelCall({
      scope,
      query: "Draft the internal handoff email.",
    });

    expect(result.context.content).toContain("Fragment recall content.");
    expect(result.context.content).toContain("Structured response control:");
    expect(result.context.content).toContain(
      "Do not mention memory, earlier notes, or learned rules unless the user directly asks.",
    );
    expect(result.context.content).toContain(
      "rewrite_output_slot prefix: Subject: [Internal]",
    );
    expect(result.context.content).not.toContain("Developer memory notes");
  });

  it("does not add hidden behavioral steering from durable raw feedback without a typed policy payload", async () => {
    const memory = createMemoryStub({
      async recall() {
        const recall = createRecallResult();
        return {
          ...recall,
          feedback: [
            createFeedbackMemory({
              id: "feedback-raw-1",
              userId: scope.userId,
              workspaceId: scope.workspaceId,
              agentId: scope.agentId,
              sessionId: scope.sessionId,
              kind: "prefer",
              rule: "Prefer https URLs or warn instead of producing http URLs.",
              source: createMemorySource({
                method: "explicit",
                extractedAt: "2026-04-30T00:00:00.000Z",
                sessionId: scope.sessionId,
              }),
              updatedAt: "2026-04-30T00:00:00.000Z",
            }),
          ],
        };
      },
      async buildContext() {
        return {
          output: "system_prompt_fragment",
          content: "Fragment recall content.",
          estimatedTokens: 5,
          omittedSections: [],
        };
      },
    });
    const runtimeKit = createGoodMemoryRuntimeKit({ memory });

    const result = await runtimeKit.beforeModelCall({
      scope,
      query: "Draft the installer URL.",
    });

    expect(result.context.content).toBe("Fragment recall content.");
    expect(result.context.content).not.toContain("Behavioral steering:");
  });

  it("does not derive behavioral carryover from legacy episodes", async () => {
    const memory = createMemoryStub({
      async importMemory() {
        throw new Error("importMemory is not implemented by this fake.");
      },
      async exportMemory() {
        return {
          pages: buildPageArtifacts({ notes: [] }),
          artifacts: { files: [], rootPath: "" },
          durable: {
            archives: [],
            episodes: [
              {
                id: "episode-1",
                userId: scope.userId,
                workspaceId: scope.workspaceId,
                summary: "Use https://example.com/dashboard for the dashboard link.",
                keyDecisions: ["Use https://example.com/dashboard."],
                unresolvedItems: [],
                topics: [],
                importance: 1,
                confidence: 1,
                createdAt: "2026-05-03T00:00:00.000Z",
              },
              {
                id: "episode-2",
                userId: scope.userId,
                workspaceId: scope.workspaceId,
                summary: "Use https://example.com/dashboard for the dashboard link.",
                keyDecisions: ["Use https://example.com/dashboard."],
                unresolvedItems: [],
                topics: [],
                importance: 1,
                confidence: 1,
                createdAt: "2026-05-03T00:01:00.000Z",
              },
            ],
            evidence: [],
            experiences: [],
            facts: [],
            feedback: [],
            preferences: [],
            profile: null,
            promotions: [],
            proposals: [],
            references: [],
          },
          exportedAt: "2026-05-03T00:02:00.000Z",
          scope,
        };
      },
      async buildContext() {
        return {
          output: "system_prompt_fragment",
          content: "Fragment recall content.",
          estimatedTokens: 5,
          omittedSections: [],
        };
      },
    });
    const runtimeKit = createGoodMemoryRuntimeKit({ memory });

    const result = await runtimeKit.beforeModelCall({
      scope,
      query: "Generate the dashboard URL.",
    });

    expect(result.context.content).toBe("Fragment recall content.");
    expect(result.context.content).not.toContain("example.com/dashboard");
    expect(result.context.recordRefs).toBeUndefined();
  });

  it("does not reintroduce future behavioral episodes across a historical reference time", async () => {
    const memory = createMemoryStub({
      async importMemory() {
        throw new Error("importMemory is not implemented by this fake.");
      },
      async exportMemory() {
        return {
          pages: buildPageArtifacts({ notes: [] }),
          artifacts: { files: [], rootPath: "" },
          durable: {
            archives: [],
            episodes: [
              {
                id: "future-episode-1",
                userId: scope.userId,
                workspaceId: scope.workspaceId,
                summary: "Use https://future.example/dashboard for the dashboard link.",
                keyDecisions: ["Use https://future.example/dashboard."],
                unresolvedItems: [],
                topics: [],
                importance: 1,
                confidence: 1,
                createdAt: "2026-05-03T00:00:00.000Z",
              },
              {
                id: "future-episode-2",
                userId: scope.userId,
                workspaceId: scope.workspaceId,
                summary: "Use https://future.example/dashboard for the dashboard link.",
                keyDecisions: ["Use https://future.example/dashboard."],
                unresolvedItems: [],
                topics: [],
                importance: 1,
                confidence: 1,
                createdAt: "2026-05-03T00:01:00.000Z",
              },
            ],
            evidence: [],
            experiences: [],
            facts: [],
            feedback: [],
            preferences: [],
            profile: null,
            promotions: [],
            proposals: [],
            references: [],
          },
          exportedAt: "2026-05-03T00:02:00.000Z",
          scope,
        };
      },
      async buildContext() {
        return {
          output: "system_prompt_fragment",
          content: "Historical fragment.",
          estimatedTokens: 4,
          omittedSections: [],
        };
      },
    });
    const runtimeKit = createGoodMemoryRuntimeKit({ memory });

    const result = await runtimeKit.beforeModelCall({
      scope,
      query: "Generate the dashboard URL.",
      referenceTime: "2026-05-02T00:00:00.000Z",
    });

    expect(result.context.content).toBe("Historical fragment.");
    expect(result.context.content).not.toContain("future.example");
  });

  it("applies the historical boundary to typed outcomes and ignores archives", async () => {
    const futureExperience = buildBehavioralOutcomeExperienceRecord({
      createdAt: "2026-05-03T00:00:00.000Z",
      createId: () => "future-experience",
      result: {
        cue: "Copy the report into backup.",
        failureClass: "arg_order",
        firstAction: {
          kind: "tool_call",
          name: "copy_file",
          raw: "copy_file(old)",
        },
        saferAlternative: {
          kind: "tool_call",
          name: "copy_file",
          raw: "copy_file(future_safe)",
        },
        modelInfluence: "rules-only",
        outcome: "failure",
        retrievalProfile: "coding_agent",
      },
      scope,
      traceId: "future-trace",
    });
    const futureArchive = {
      id: "future-archive",
      userId: scope.userId,
      workspaceId: scope.workspaceId,
      sessionId: "future-session",
      sourceSessionIds: ["future-session"],
      summary: "Generate the dashboard URL.",
      normalizedTranscript: [
        "user: Generate the dashboard URL.",
        "assistant: Use https://future.example/archive-dashboard.",
      ].join("\n"),
      keyDecisions: ["Use https://future.example/archive-dashboard."],
      unresolvedItems: [],
      referencedArtifacts: [],
      scopeLineage: [],
      createdAt: "2026-05-03T00:00:00.000Z",
      archivedAt: "2026-05-03T00:01:00.000Z",
    };
    const baseDurable = {
      evidence: [],
      facts: [],
      feedback: [],
      preferences: [],
      profile: null,
      promotions: [],
      proposals: [],
      references: [],
    };
    const archiveRuntime = createGoodMemoryRuntimeKit({
      memory: createMemoryStub({
        async importMemory() {
          throw new Error("importMemory is not implemented by this fake.");
        },
        async exportMemory() {
          return {
            pages: buildPageArtifacts({ notes: [] }),
            artifacts: { files: [], rootPath: "" },
            durable: {
              ...baseDurable,
              archives: [futureArchive],
              episodes: [],
              experiences: [],
            },
            exportedAt: "2026-05-03T00:02:00.000Z",
            scope,
          };
        },
        async buildContext() {
          return {
            output: "system_prompt_fragment",
            content: "Historical archive fragment.",
            estimatedTokens: 4,
            omittedSections: [],
          };
        },
      }),
    });
    const experienceRuntime = createGoodMemoryRuntimeKit({
      memory: createMemoryStub({
        async importMemory() {
          throw new Error("importMemory is not implemented by this fake.");
        },
        async exportMemory() {
          return {
            pages: buildPageArtifacts({ notes: [] }),
            artifacts: { files: [], rootPath: "" },
            durable: {
              ...baseDurable,
              archives: [],
              episodes: [],
              experiences: [futureExperience],
            },
            exportedAt: "2026-05-03T00:02:00.000Z",
            scope,
          };
        },
        async buildContext() {
          return {
            output: "system_prompt_fragment",
            content: "Historical experience fragment.",
            estimatedTokens: 4,
            omittedSections: [],
          };
        },
      }),
    });

    const currentArchive = await archiveRuntime.beforeModelCall({
      scope,
      query: "Generate the dashboard URL.",
      referenceTime: "2026-05-04T00:00:00.000Z",
    });
    const currentExperience = await experienceRuntime.beforeModelCall({
      scope,
      query: "Copy the report into backup.",
      referenceTime: "2026-05-04T00:00:00.000Z",
      retrievalProfile: "coding_agent",
    });
    const archive = await archiveRuntime.beforeModelCall({
      scope,
      query: "Generate the dashboard URL.",
      referenceTime: "2026-05-02T00:00:00.000Z",
    });
    const experience = await experienceRuntime.beforeModelCall({
      scope,
      query: "Copy the report into backup.",
      referenceTime: "2026-05-02T00:00:00.000Z",
      retrievalProfile: "coding_agent",
    });

    expect(currentArchive.context.content).toBe("Historical archive fragment.");
    expect(currentArchive.context.content).not.toContain("archive-dashboard");
    expect(currentExperience.context.content).toContain("copy_file(future_safe)");
    expect(archive.context.content).toBe("Historical archive fragment.");
    expect(archive.context.content).not.toContain("archive-dashboard");
    expect(experience.context.content).toBe("Historical experience fragment.");
    expect(experience.context.content).not.toContain("copy_file(future_safe)");
  });

  it("returns exact experience record refs when raw carryover independently builds a fragment", async () => {
    const scopeDigestSecret = "runtime-kit-test-secret";
    const experience = buildBehavioralOutcomeExperienceRecord({
      createdAt: "2026-05-04T00:00:00.000Z",
      createId: () => "tool-outcome-experience",
      result: {
        cue: "Copy the report into backup.",
        failureClass: "arg_order",
        firstAction: {
          kind: "tool_call",
          name: "copy_file",
          raw: "copy_file(old)",
        },
        modelInfluence: "rules-only",
        retrievalProfile: "coding_agent",
        saferAlternative: {
          kind: "tool_call",
          name: "copy_file",
          raw: "copy_file(safe)",
        },
      },
      scope,
      traceId: "tool-outcome-trace",
    });
    const unrelatedExperience = buildBehavioralOutcomeExperienceRecord({
      createdAt: "2026-05-04T00:00:00.000Z",
      createId: () => "unrelated-tool-outcome-experience",
      result: {
        cue: "Deploy the database schema.",
        failureClass: "precondition",
        firstAction: {
          kind: "tool_call",
          name: "deploy_schema",
          raw: "deploy_schema(unsafe)",
        },
        modelInfluence: "rules-only",
        retrievalProfile: "coding_agent",
        saferAlternative: {
          kind: "tool_call",
          name: "verify_then_deploy_schema",
          raw: "verify_then_deploy_schema(safe)",
        },
      },
      scope,
      traceId: "unrelated-tool-outcome-trace",
    });
    const runtimeKit = createGoodMemoryRuntimeKit({
      memory: createMemoryStub({
        async importMemory() {
          throw new Error("importMemory is not implemented by this fake.");
        },
        async exportMemory() {
          return {
            pages: buildPageArtifacts({ notes: [] }),
            artifacts: { files: [], rootPath: "" },
            durable: {
              archives: [],
              episodes: [],
              evidence: [],
              experiences: [experience, unrelatedExperience],
              facts: [],
              feedback: [],
              preferences: [],
              profile: null,
              promotions: [],
              proposals: [],
              references: [],
            },
            exportedAt: "2026-05-04T00:00:00.000Z",
            scope,
          };
        },
        async buildContext() {
          return {
            output: "system_prompt_fragment",
            content: "",
            estimatedTokens: 0,
            omittedSections: [],
          };
        },
      }),
      scopeDigestSecret,
    });

    const result = await runtimeKit.beforeModelCall({
      scope,
      query: "Copy the report into backup.",
      retrievalProfile: "coding_agent",
    });
    const scopeDigest = buildProgressiveScopeDigest({
      scope,
      secret: scopeDigestSecret,
    });

    expect(result.context.content).toContain("copy_file(safe)");
    expect(result.context.content).not.toContain("verify_then_deploy_schema");
    expect(result.context.recordRefs).toEqual([
      encodeGoodMemoryRecordRef({
        id: experience.id,
        recordKind: "experience",
        scopeDigest,
      }),
    ]);
    expect(result.recall?.metadata.hits).toEqual([]);
  });

  it("fails closed on a malformed persisted experience timestamp during historical replay", async () => {
    const experience = buildBehavioralOutcomeExperienceRecord({
      createdAt: "0",
      createId: () => "malformed-time-tool-outcome",
      result: {
        cue: "Copy the report into backup.",
        failureClass: "arg_order",
        firstAction: {
          kind: "tool_call",
          name: "copy_file",
          raw: "copy_file(old)",
        },
        modelInfluence: "rules-only",
        retrievalProfile: "coding_agent",
        saferAlternative: {
          kind: "tool_call",
          name: "copy_file",
          raw: "copy_file(safe)",
        },
      },
      scope,
      traceId: "malformed-time-trace",
    });
    const runtimeKit = createGoodMemoryRuntimeKit({
      memory: createMemoryStub({
        async importMemory() {
          throw new Error("importMemory is not implemented by this fake.");
        },
        async exportMemory() {
          return {
            pages: buildPageArtifacts({ notes: [] }),
            artifacts: { files: [], rootPath: "" },
            durable: {
              archives: [],
              episodes: [],
              evidence: [],
              experiences: [experience],
              facts: [],
              feedback: [],
              preferences: [],
              profile: null,
              promotions: [],
              proposals: [],
              references: [],
            },
            exportedAt: "2026-05-04T00:00:00.000Z",
            scope,
          };
        },
        async buildContext() {
          return {
            output: "system_prompt_fragment",
            content: "Historical fragment.",
            estimatedTokens: 2,
            omittedSections: [],
          };
        },
      }),
    });

    const result = await runtimeKit.beforeModelCall({
      scope,
      query: "Copy the report into backup.",
      referenceTime: "2026-05-04T00:00:00.000Z",
      retrievalProfile: "coding_agent",
    });

    expect(result.context.content).toBe("Historical fragment.");
    expect(result.context.content).not.toContain("copy_file(safe)");
    expect(result.context.recordRefs).toBeUndefined();
  });

  it("does not derive behavioral carryover from runtime buffers", async () => {
    const runtimeState: GoodMemoryRuntimeStateResult = {
      ...emptyRuntimeState,
      state: {
        ...emptyRuntimeState.state,
        buffer: {
          ...emptyRuntimeState.state.buffer,
          lastActiveAt: "2026-05-03T00:00:00.000Z",
          messages: [
            { role: "user", content: "Generate the dashboard URL." },
            {
              role: "assistant",
              content: "Use https://runtime.example/dashboard.",
            },
          ],
        },
      },
    };
    const runtimeKit = createGoodMemoryRuntimeKit({
      memory: createMemoryStub({
        runtime: {
          ...createMemoryStub().runtime,
          async getState() {
            return runtimeState;
          },
        },
        async buildContext() {
          return {
            output: "system_prompt_fragment",
            content: "Runtime fragment.",
            estimatedTokens: 3,
            omittedSections: [],
          };
        },
      }),
    });

    const current = await runtimeKit.beforeModelCall({
      scope,
      query: "Generate the dashboard URL.",
      referenceTime: "2026-05-04T00:00:00.000Z",
    });
    const historical = await runtimeKit.beforeModelCall({
      scope,
      query: "Generate the dashboard URL.",
      referenceTime: "2026-05-02T00:00:00.000Z",
    });

    expect(current.context.content).toBe("Runtime fragment.");
    expect(current.context.content).not.toContain("runtime.example");
    expect(historical.context.content).toBe("Runtime fragment.");
    expect(historical.context.content).not.toContain("runtime.example");
  });

  it("uses progressive recall service when progressive context is available", async () => {
    const runtimeKit = createGoodMemoryRuntimeKit({
      memory: createMemoryStub(),
      defaultContextMode: "progressive",
      progressiveRecall: createProgressiveService(),
    });

    const result = await runtimeKit.beforeModelCall({
      scope,
      query: "runtime kit",
    });

    expect(result.context.mode).toBe("progressive");
    expect(result.context.recordRefs).toEqual([
      "gmrec:v1:scope_runtimekit:fact:fact-1",
    ]);
    expect(result.context.content).toContain("Progressive GoodMemory Recall");
  });

  it("forwards the turn reference time and timezone to progressive recall", async () => {
    const progressiveInputs: SearchRecallIndexInput[] = [];
    const progressiveRecall = createProgressiveService();
    const runtimeKit = createGoodMemoryRuntimeKit({
      memory: createMemoryStub(),
      defaultContextMode: "progressive",
      progressiveRecall: {
        ...progressiveRecall,
        async searchRecallIndex(input) {
          progressiveInputs.push(input);
          return progressiveRecall.searchRecallIndex(input);
        },
      },
    });

    await runtimeKit.beforeModelCall({
      scope,
      query: "What happened yesterday?",
      referenceTime: "2026-11-01T05:30:00.000Z",
      timezone: "America/New_York",
    });

    expect(progressiveInputs[0]).toMatchObject({
      referenceTime: "2026-11-01T05:30:00.000Z",
      timezone: "America/New_York",
    });
  });

  it("falls back to fragment context when progressive transport is not configured", async () => {
    const runtimeKit = createGoodMemoryRuntimeKit({
      memory: createMemoryStub(),
      defaultContextMode: "progressive",
    });

    const result = await runtimeKit.beforeModelCall({
      scope,
      query: "runtime kit",
    });

    expect(result.context.mode).toBe("fragment");
    expect(result.events[0]).toMatchObject({
      fallbackReason: "progressive_unavailable",
    });
  });

  it("does not durable-write afterModelCall in off or observe modes", async () => {
    const rememberInputs: RememberInput[] = [];
    const runtimeKit = createGoodMemoryRuntimeKit({
      memory: createMemoryStub({
        async remember(input) {
          rememberInputs.push(input);
          return {
            accepted: 1,
            rejected: 0,
            events: [],
          };
        },
      }),
    });

    const off = await runtimeKit.afterModelCall({
      scope,
      messages: [{ role: "user", content: "My email is me@example.com." }],
      assistantText: "Use token sk-live-secret for deploy.",
      writeback: { mode: "off" },
    });
    const observe = await runtimeKit.afterModelCall({
      scope,
      messages: [{ role: "user", content: "My email is me@example.com." }],
      assistantText: "Use token sk-live-secret for deploy.",
      writeback: { mode: "observe" },
    });

    expect(rememberInputs).toEqual([]);
    expect(off.candidates).toEqual([]);
    expect(observe.candidates).toHaveLength(1);
    expect(observe.candidates[0]?.preview).not.toContain("me@example.com");
    expect(observe.candidates[0]?.preview).not.toContain("sk-live-secret");
    expect(observe.events[0]?.scopeDigest.userIdHash).toStartWith("hmac-sha256:");
    expect(observe.trace.rawTranscriptPersisted).toBe(false);
    expect(JSON.stringify(observe)).not.toContain("messages");
    expect(JSON.stringify(observe)).not.toContain(scope.userId);
    expect(JSON.stringify(observe)).not.toContain(scope.workspaceId);
    expect(JSON.stringify(observe)).not.toContain(scope.sessionId);
  });

  it("rejects invalid temporal context before every skip path", async () => {
    const runtimeKit = createGoodMemoryRuntimeKit({ memory: createMemoryStub() });

    await expect(runtimeKit.beforeModelCall({
      ignoreMemory: true,
      referenceTime: "not-a-time",
      scope,
    })).rejects.toThrow("Invalid referenceTime");
    await expect(runtimeKit.beforeModelCall({
      query: "",
      scope,
      timezone: "Mars/Olympus",
    })).rejects.toThrow("Invalid timezone");
    await expect(runtimeKit.afterModelCall({
      assistantText: "Ignored",
      messages: [{
        content: "Bad message time",
        observedAt: "not-a-time",
        role: "user",
      }],
      scope,
      writeback: { mode: "off" },
    })).rejects.toThrow("Invalid messages[0].observedAt");
  });

  it("redacts localized credential assignments from bounded previews", async () => {
    const runtimeKit = createGoodMemoryRuntimeKit({
      memory: createMemoryStub(),
    });

    for (const content of [
      "密碼：bridge-credential",
      "パスワード: bridge-credential",
      "비밀번호: bridge-credential",
      "mot de passe : bridge-credential",
      "contraseña: bridge-credential",
    ]) {
      const result = await runtimeKit.afterModelCall({
        scope,
        messages: [{ role: "user", content }],
        assistantText: "Acknowledged.",
        writeback: { mode: "observe" },
      });

      expect(JSON.stringify(result)).not.toContain("bridge-credential");
      expect(result.candidates[0]?.preview).toContain("[redacted-secret]");
    }
  });

  it("uses stable content digests for bounded afterModelCall job ids", async () => {
    const runtimeKit = createGoodMemoryRuntimeKit({
      memory: createMemoryStub(),
    });
    const first = await runtimeKit.afterModelCall({
      scope,
      messages: [{ role: "user", content: "Remember alpha queue item." }],
      assistantText: "Alpha bounded preview.",
      writeback: { mode: "observe" },
    });
    const second = await runtimeKit.afterModelCall({
      scope,
      messages: [{ role: "user", content: "Remember beta queue item!" }],
      assistantText: "Beta bounded preview..",
      writeback: { mode: "observe" },
    });

    expect(first.boundedJobs[0]?.jobId).toStartWith("runtime-kit-candidate-");
    expect(second.boundedJobs[0]?.jobId).toStartWith("runtime-kit-candidate-");
    expect(first.boundedJobs[0]?.jobId).not.toBe(second.boundedJobs[0]?.jobId);
  });

  it("only calls public remember under selective writeback with annotation and policy approval", async () => {
    const rememberInputs: RememberInput[] = [];
    const runtimeKit = createGoodMemoryRuntimeKit({
      memory: createMemoryStub({
        async remember(input) {
          rememberInputs.push(input);
          return {
            accepted: 1,
            rejected: 0,
            events: [],
          };
        },
      }),
    });

    await runtimeKit.afterModelCall({
      scope,
      messages: [{ role: "user", content: "Remember my review cadence." }],
      assistantText: "Weekly review cadence is confirmed.",
      writeback: {
        mode: "selective",
        annotation: "durable_candidate",
        policy: "deny",
      },
    });
    const accepted = await runtimeKit.afterModelCall({
      scope,
      messages: [{ role: "user", content: "Remember my review cadence." }],
      assistantText: "Weekly review cadence is confirmed.",
      writeback: {
        mode: "selective",
        annotation: "durable_candidate",
        policy: "allow",
      },
    });

    expect(rememberInputs).toHaveLength(1);
    expect(rememberInputs[0]?.messages).toEqual([
      { role: "user", content: "Remember my review cadence." },
      { role: "assistant", content: "Weekly review cadence is confirmed." },
    ]);
    expect(accepted.rememberResult).toMatchObject({
      accepted: 1,
      rejected: 0,
    });
  });

  it("preserves current-turn message provenance during selective writeback", async () => {
    const rememberInputs: RememberInput[] = [];
    const runtimeKit = createGoodMemoryRuntimeKit({
      memory: createMemoryStub({
        async remember(input) {
          rememberInputs.push(input);
          return { accepted: 1, rejected: 0, events: [] };
        },
      }),
    });

    await runtimeKit.afterModelCall({
      scope,
      referenceTime: "2026-11-01T05:30:00.000Z",
      timezone: "America/New_York",
      assistantObservedAt: "2026-11-01T05:30:03.000Z",
      messages: [
        {
          id: "historical-user",
          role: "user",
          content: "Earlier turn",
        },
        {
          id: "current-user",
          role: "user",
          content: "Remember my review cadence.",
          timezone: "Europe/Paris",
        },
      ],
      assistantText: "Weekly review cadence is confirmed.",
      writeback: {
        mode: "selective",
        annotation: "durable_candidate",
        policy: "allow",
      },
    });

    expect(rememberInputs).toEqual([
      {
        scope,
        timezone: "America/New_York",
        locale: undefined,
        messages: [
          {
            id: "current-user",
            role: "user",
            content: "Remember my review cadence.",
            observedAt: "2026-11-01T05:30:00.000Z",
            timezone: "Europe/Paris",
          },
          {
            role: "assistant",
            content: "Weekly review cadence is confirmed.",
            observedAt: "2026-11-01T05:30:03.000Z",
            timezone: "America/New_York",
          },
        ],
        annotations: [
          expect.objectContaining({ messageIndex: 1 }),
        ],
      },
    ]);
  });

  it("rejects explicit invalid temporal strings before writeback", async () => {
    const rememberInputs: RememberInput[] = [];
    const runtimeKit = createGoodMemoryRuntimeKit({
      memory: createMemoryStub({
        async remember(input) {
          rememberInputs.push(input);
          return { accepted: 0, rejected: 0, events: [] };
        },
      }),
    });

    await expect(runtimeKit.afterModelCall({
      scope,
      assistantObservedAt: "",
      assistantTimezone: "",
      messages: [{
        role: "user",
        content: "Remember this.",
        observedAt: "",
        timezone: "",
      }],
      assistantText: "Acknowledged.",
      timezone: "",
      writeback: {
        mode: "selective",
        annotation: "durable_candidate",
        policy: "allow",
      },
    })).rejects.toThrow("Invalid timezone");
    expect(rememberInputs).toEqual([]);
  });

  it("does not backfill the turn timestamp onto an earlier text user", async () => {
    let rememberCalls = 0;
    const runtimeKit = createGoodMemoryRuntimeKit({
      memory: createMemoryStub({
        async remember() {
          rememberCalls += 1;
          return { accepted: 1, rejected: 0, events: [] };
        },
      }),
    });

    await runtimeKit.afterModelCall({
      scope,
      referenceTime: "2026-11-01T05:30:00.000Z",
      messages: [
        { role: "user", content: "Historical text turn" },
        { role: "user", content: " " },
      ],
      assistantText: "Current multimodal answer.",
      writeback: {
        mode: "selective",
        annotation: "durable_candidate",
        policy: "allow",
      },
    });

    expect(rememberCalls).toBe(0);
  });

  it("preAction reuses host action assessment and execution-plan contracts", async () => {
    const intent: HostActionIntent = {
      actionId: "action-1",
      runId: "run-1",
      turnId: "turn-1",
      sequence: 1,
      occurredAt: "2026-04-26T00:00:00.000Z",
      hostKind: "codex",
      scope,
      action: {
        kind: "command",
        command: "deploy production",
      },
    };
    const assessment: HostActionAssessmentResult = {
      actionId: intent.actionId,
      auditRecorded: true,
      decision: "review_required",
      guidance: ["Run verification first."],
      matchedEvidenceIds: [],
      matchedMemoryIds: [],
      policyApplied: ["runtime-kit-test"],
      reason: "deployment requires verification",
      recommendedFirstStep: {
        kind: "command",
        command: "bun test",
      },
      requiredPreconditions: ["tests pass"],
    };
    const runtimeKit = createGoodMemoryRuntimeKit({
      memory: createMemoryStub(),
      hostAdapter: {
        async assessAction(input) {
          expect(input).toEqual(intent);
          return assessment;
        },
      },
    });

    const result = await runtimeKit.preAction({ intent });

    expect(result.assessment).toBe(assessment);
    expect(result.executionPlan).toMatchObject({
      actionId: intent.actionId,
      decision: "review_required",
      executeOriginalActionNow: false,
      rewritten: true,
    });
  });

  it("keeps default preAction behavior deterministic across Codex and Claude host kinds", async () => {
    const runtimeKit = createGoodMemoryRuntimeKit({
      memory: createMemoryStub(),
      scopeDigestSecret: "runtime-kit-host-parity",
    });
    const hostKinds: HostKind[] = ["codex", "claude"];

    const results = [];
    for (const hostKind of hostKinds) {
      results.push(await runtimeKit.preAction({
        intent: {
          actionId: `action-${hostKind}`,
          runId: `run-${hostKind}`,
          turnId: `turn-${hostKind}`,
          sequence: 1,
          occurredAt: "2026-04-26T00:00:00.000Z",
          hostKind,
          scope,
          action: {
            kind: "command",
            command: "bun test tests/unit/runtime-kit.test.ts",
          },
        },
      }));
    }

    expect(results.map((result) => result.executionPlan.decision)).toEqual([
      "allow",
      "allow",
    ]);
    expect(results.map((result) => result.events[0]?.phase)).toEqual([
      "preAction",
      "preAction",
    ]);
    expect(JSON.stringify(results)).not.toContain(scope.userId);
    expect(JSON.stringify(results)).not.toContain(scope.workspaceId);
    expect(JSON.stringify(results)).not.toContain(scope.sessionId);
  });
});
