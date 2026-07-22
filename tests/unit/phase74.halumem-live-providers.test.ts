import { createHash } from "node:crypto";

import { describe, expect, it } from "bun:test";

import {
  buildPhase74HaluMemCausalRecallCase,
  buildPhase74HaluMemLiveConfigurations,
  buildPhase74HaluMemPrivacyPipelineMaterial,
  buildPhase74HaluMemUpdatePipelineMaterial,
  buildPhase74HaluMemUpdateRecords,
  createPhase74HaluMemScopedUpdateRuntime,
  createPhase74HaluMemScopedPrivacyRuntime,
  createPhase74HaluMemLiveDependencies,
} from "../../scripts/phase-74-halumem-live-providers";
import type {
  Phase74HaluMemScopedMemory,
} from "../../scripts/phase-74-halumem-live-providers";
import type {
  Phase74HaluMemUser,
} from "../../src/eval/phase74HaluMemProtectionVerifier";
import {
  buildPhase74HaluMemUpdateJudgePrompt,
  scorePhase74HaluMemUpdateDecision,
} from "../../src/eval/phase74HaluMemProtectionVerifier";
import type {
  AttributedModelUsageAttempt,
  AttributedModelUsageIntent,
} from "../../src/eval/modelUsage";
import { hashPhase74ProtectionValue } from "../../src/eval/phase74ProtectionRun";

function user(uuid: string): Phase74HaluMemUser {
  return {
    persona_info: `${uuid} persona`,
    sessions: [
      {
        dialogue: [{
          content: `${uuid} works on Apollo.`,
          dialogue_turn: 0,
          role: "user",
          timestamp: "2026-01-01T00:00:00.000Z",
        }],
        memory_points: [],
        questions: [{
          answer: "Apollo",
          evidence: [{ memory_content: "works on Apollo" }],
          question: `Which project does ${uuid} work on?`,
        }],
        start_time: "2026-01-01T00:00:00.000Z",
      },
      {
        dialogue: [{
          content: `${uuid} later moved to Mosaic.`,
          dialogue_turn: 0,
          role: "assistant",
          timestamp: "2026-02-01T00:00:00.000Z",
        }],
        memory_points: [{
          importance: 1,
          is_update: "True",
          memory_content: `${uuid} now works on Mosaic.`,
          memory_source: "dialogue_turn=0",
          memory_type: "fact",
          original_memories: [`${uuid} worked on Apollo.`],
          timestamp: "2026-02-01T00:00:00.000Z",
        }],
        questions: [],
        start_time: "2026-02-01T00:00:00.000Z",
      },
    ],
    uuid,
  };
}

const languageModel = {
  apiKey: "test-key",
  baseURL: "https://ai.gurkiai.com/v1",
  model: "gpt-5.6-terra",
  provider: "openai" as const,
};

function liveInput(overrides: Record<string, unknown> = {}) {
  const events: AttributedModelUsageAttempt[] = [];
  const intents: AttributedModelUsageIntent[] = [];
  return {
    datasetSha256: "d".repeat(64),
    evaluatorSourceSha256: "e".repeat(64),
    events,
    intents,
    models: {
      answer: languageModel,
      assistedExtraction: languageModel,
      embedding: {
        ...languageModel,
        baseURL: "https://openrouter.ai/api/v1",
        model: "text-embedding-3-small",
      },
      judge: { ...languageModel, model: "gpt-5.5" },
      planner: languageModel,
      reranker: languageModel,
    },
    promptSha256s: {
      assistedExtraction: "a".repeat(64),
      conversationalExtraction: "b".repeat(64),
    },
    runDirectory: "/tmp/phase74-halumem-live-test",
    users: [user("user-a"), user("user-b")],
    ...overrides,
  };
}

describe("Phase 74 HaluMem live provider wiring", () => {
  it("builds a stable causal-prefix recall case without future sessions", () => {
    const selected = user("user-a");
    const testCase = buildPhase74HaluMemCausalRecallCase({
      question: selected.sessions[0]!.questions![0]!,
      questionCaseId: "user-a:session:0:question:0",
      sessionIndex: 0,
      user: selected,
    });

    expect(testCase.rawEvidence).toHaveLength(1);
    expect(testCase.rawEvidence[0]).toMatchObject({
      content: "user-a works on Apollo.",
      observedAt: "2026-01-01T00:00:00.000Z",
      role: "user",
    });
    expect(testCase.rawEvidence[0]!.id).toBe(
      testCase.rawEvidence[0]!.sourceIds[0],
    );
    expect(JSON.stringify(testCase)).not.toContain("Mosaic");
    expect(testCase.referenceTime).toBe("2026-01-01T00:00:00.000Z");
    expect(testCase.memoryGroupId).toBe("halumem:user-a:through-session:0");
  });

  it("uses the deterministic E3 GoodMemory runtime and returns its typed ledger", async () => {
    const executions: unknown[] = [];
    const evidenceLedger = [{
      evidenceId: "evidence-1",
      excerpt: "user-a works on Apollo.",
      relation: "supports" as const,
      sourceMemoryId: "memory-1",
      temporalStatus: "current" as const,
    }];
    const dependencies = createPhase74HaluMemLiveDependencies(liveInput({
      retrievalRuntime: {
        async execute(input: unknown) {
          executions.push(input);
          return {
            evidenceLedger,
            retrievedMemories: [],
            snapshotId: "snapshot-1",
            storedMemories: [],
          };
        },
      },
    }));
    const selected = user("user-a");

    const snapshot = await dependencies.e4.retrieveEvidence({
      question: selected.sessions[0]!.questions![0]!,
      questionCaseId: "user-a:session:0:question:0",
      sessionIndex: 0,
      user: selected,
    });

    expect(snapshot).toEqual({ evidenceLedger, snapshotId: "snapshot-1" });
    expect(executions).toHaveLength(1);
    expect(executions[0]).toMatchObject({
      arm: "recall-plan-deterministic",
      stage: "E3",
      testCase: {
        caseId: "user-a:session:0:question:0",
        question: "Which project does user-a work on?",
        rawEvidence: [{ content: "user-a works on Apollo." }],
      },
    });
  });

  it("binds independent privacy and update descriptors without cross-contamination", () => {
    const input = liveInput();
    const configuration = buildPhase74HaluMemLiveConfigurations(input.models);
    const baselinePrivacy = buildPhase74HaluMemPrivacyPipelineMaterial(
      "baseline",
      input.models,
    );
    const candidatePrivacy = buildPhase74HaluMemPrivacyPipelineMaterial(
      "candidate",
      input.models,
    );
    const baselineUpdate = buildPhase74HaluMemUpdatePipelineMaterial(
      "baseline",
      input.models,
    );
    const candidateUpdate = buildPhase74HaluMemUpdatePipelineMaterial(
      "candidate",
      input.models,
    );

    expect(configuration.privacy.baselinePipeline).toEqual({
      id: "halumem-live-privacy-baseline-v1",
      sha256: hashPhase74ProtectionValue(baselinePrivacy),
    });
    expect(configuration.privacy.candidatePipeline).toEqual({
      id: "halumem-live-privacy-candidate-v1",
      sha256: hashPhase74ProtectionValue(candidatePrivacy),
    });
    expect(configuration.update.baselinePipeline).toEqual({
      id: "halumem-live-update-baseline-v1",
      sha256: hashPhase74ProtectionValue(baselineUpdate),
    });
    expect(configuration.update.candidatePipeline).toEqual({
      id: "halumem-live-update-candidate-v1",
      sha256: hashPhase74ProtectionValue(candidateUpdate),
    });
    expect(configuration.privacy).not.toHaveProperty("updateEvaluator");
    expect(configuration.update.updateEvaluator).toMatchObject({
      id: expect.stringContaining("eval/eval_tools.py"),
      sha256: "0c08e5ecb8c93945bafc4bd0336bd6c9756b40d175f442ce44aca4a43169ee3b",
    });

    expect(hashPhase74ProtectionValue({
      ...baselinePrivacy,
      scopeTopology: "privacy-test-variant",
    })).not.toBe(configuration.privacy.baselinePipeline.sha256);
    expect(configuration.update.baselinePipeline.sha256).toBe(
      hashPhase74ProtectionValue(baselineUpdate),
    );
    expect(hashPhase74ProtectionValue({
      ...baselineUpdate,
      ingestionClock: "update-test-variant",
    })).not.toBe(configuration.update.baselinePipeline.sha256);
    expect(configuration.privacy.baselinePipeline.sha256).toBe(
      hashPhase74ProtectionValue(baselinePrivacy),
    );
    expect(buildPhase74HaluMemPrivacyPipelineMaterial(
      "baseline",
      input.models,
    ).retrieval.generalizedFusionChannels).toEqual([
      "lexical",
      "dense",
      "entity",
    ]);
    expect(buildPhase74HaluMemPrivacyPipelineMaterial(
      "candidate",
      input.models,
    ).retrieval.generalizedFusionChannels).toEqual([
      "lexical",
      "dense",
      "entity",
      "temporal",
      "relation",
    ]);
    expect(buildPhase74HaluMemPrivacyPipelineMaterial(
      "candidate",
      input.models,
    ).retrieval).not.toHaveProperty("generatedMemoryRecords");
    const updatePipeline = buildPhase74HaluMemUpdatePipelineMaterial(
      "candidate",
      input.models,
    );
    expect(updatePipeline.retrieval.generatedMemoryRecords).toBe(
      "final-ranked-durable-records-cross-kind-v1",
    );
    expect(updatePipeline.ingestionClock).toBe(
      "latest-dialogue-time-through-session-v1",
    );
    expect(updatePipeline.reranker).toMatchObject({
      gateway: "https://ai.gurkiai.com/v1",
      model: "gpt-5.6-terra",
      provider: "openai",
    });
  });

  it("writes distinct HaluMem sessions causally before top-10 update retrieval", async () => {
    const selected = user("user-a");
    const calls: string[] = [];
    const runtime = createPhase74HaluMemScopedUpdateRuntime({
      branch: "candidate",
      createMemory() {
        return {
          async recall({ query, topK }) {
            calls.push(`recall:${query}`);
            expect(topK).toBe(10);
            return {
              evidence: [{ sourceMessageIds: ["source-session-1"] }],
              memories: ["user-a now works on Mosaic."],
            };
          },
          setReferenceTime(referenceTime: string) {
            calls.push(`time:${referenceTime}`);
          },
          async remember({ scope }) {
            calls.push(`remember:${scope.sessionId}`);
            return { warnings: [] };
          },
        };
      },
      users: [selected],
    });

    const snapshot = await runtime.retrieve({
      branch: "candidate",
      memoryPoint: selected.sessions[1]!.memory_points[0]!,
      sessionIndex: 1,
      updateCaseId: "user-a:session:1:update:0",
      user: selected,
    });

    expect(calls).toEqual([
      "time:2026-01-01T00:00:00.000Z",
      "remember:session-0",
      "time:2026-02-01T00:00:00.000Z",
      "remember:session-1",
      "recall:user-a now works on Mosaic.",
    ]);
    expect(snapshot.memories).toEqual(["user-a now works on Mosaic."]);
    expect(snapshot.sourceMessageIds).toEqual(["source-session-1"]);
  });

  it("uses final ranked durable records across kinds for update top-10 and never raw evidence", () => {
    const target = "user-a now works on Mosaic.";
    const rawEvidenceOnly = `[RAW-EVIDENCE-ONLY]\n${target}`;
    const facts = Array.from({ length: 9 }, (_, index) => ({
      content: `rank-${index + 1}`,
      id: `fact-${index + 1}`,
    }));
    const recall = {
      evidence: [
        {
          excerpt: rawEvidenceOnly,
          linkedArchiveIds: [],
          linkedMemoryIds: ["preference-target"],
          sourceMessageIds: ["source-preference"],
        },
        ...facts.map(({ id }) => ({
          excerpt: `evidence-${id}`,
          linkedArchiveIds: [],
          linkedMemoryIds: [id],
          sourceMessageIds: [`source-${id}`],
        })),
        {
          excerpt: "feedback evidence",
          linkedArchiveIds: [],
          linkedMemoryIds: ["feedback-1"],
          sourceMessageIds: ["source-feedback"],
        },
      ],
      facts,
      feedback: [{ id: "feedback-1", rule: "Keep project status current." }],
      metadata: {
        hits: [
          { id: "preference-target", type: "preference" },
          { id: "fact-1", type: "fact" },
          { id: "feedback-1", type: "feedback" },
        ],
      },
      preferences: [{
        category: "project",
        id: "preference-target",
        value: target,
      }],
    };

    const records = buildPhase74HaluMemUpdateRecords(recall);
    expect(records).toHaveLength(10);
    expect(records.slice(0, 3)).toEqual([
      {
        content: `project: ${target}`,
        id: "preference-target",
        rank: 1,
        sourceMessageIds: ["source-preference"],
        type: "preference",
      },
      {
        content: "rank-1",
        id: "fact-1",
        rank: 2,
        sourceMessageIds: ["source-fact-1"],
        type: "fact",
      },
      {
        content: "Keep project status current.",
        id: "feedback-1",
        rank: 3,
        sourceMessageIds: ["source-feedback"],
        type: "feedback",
      },
    ]);
    expect(records.some(({ content }) => content === "rank-8")).toBe(true);
    expect(records.some(({ content }) => content === "rank-9")).toBe(false);
    expect(buildPhase74HaluMemUpdateJudgePrompt({
      expectedUpdate: target,
      originalMemories: ["user-a worked on Apollo."],
      retrievedMemories: records.map(({ content }) => content),
    })).not.toContain("[RAW-EVIDENCE-ONLY]");
    expect(scorePhase74HaluMemUpdateDecision(JSON.stringify({
      category: "Omission",
      protocol: "halumem-upstream-per-item-update-v1",
      rawDecision: JSON.stringify({
        evaluation_result: "Omission",
        reason: "The generated memories omit the target update.",
      }),
      usage: {
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        inputTokens: 20,
        outputTokens: 5,
        uncachedInputTokens: 20,
      },
    }))).toBe(0);
  });

  it("uses the pinned HaluMem update prompt and preserves raw category plus usage", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const input = liveInput({
      fetch: async (_request: RequestInfo | URL, init?: RequestInit) => {
        requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(JSON.stringify({
          choices: [{
            finish_reason: "stop",
            index: 0,
            message: {
              content: JSON.stringify({
                evaluation_result: "Hallucination",
                reason: "The generated memory contradicts the target update.",
              }),
              role: "assistant",
            },
          }],
          model: "gpt-5.5",
          object: "chat.completion",
          usage: { completion_tokens: 5, prompt_tokens: 20 },
        }), { headers: { "content-type": "application/json" } });
      },
    });
    const dependencies = createPhase74HaluMemLiveDependencies(input);
    const selected = input.users[0]!;
    const memoryPoint = selected.sessions[1]!.memory_points[0]!;
    const decision = await dependencies.update.evaluateUpdate!({
      branch: "candidate",
      evaluator: buildPhase74HaluMemLiveConfigurations(input.models).update
        .updateEvaluator!,
      expectedUpdate: memoryPoint.memory_content,
      memoryPoint,
      originalMemories: memoryPoint.original_memories,
      retrievedMemories: ["user-a still works on Apollo."],
      updateCaseId: "user-a:session:1:update:0",
      user: selected,
    });

    expect(JSON.parse(decision)).toEqual({
      category: "Hallucination",
      protocol: "halumem-upstream-per-item-update-v1",
      rawDecision: JSON.stringify({
        evaluation_result: "Hallucination",
        reason: "The generated memory contradicts the target update.",
      }),
      usage: {
        cacheCreationInputTokens: null,
        cacheReadInputTokens: null,
        inputTokens: 20,
        outputTokens: 5,
        uncachedInputTokens: 20,
      },
    });
    expect(JSON.stringify(requests[0])).toContain("Target Memory for Update");
    expect(requests[0]!.messages).toEqual([
      expect.objectContaining({ role: "user" }),
    ]);
    expect(input.intents[0]).toMatchObject({ branch: "judge", operation: "judge" });
  });

  it("calls Terra reader and independent gpt-5.5 judge with strict raw JSON and usage", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const fetch = async (_request: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push(body);
      const content = requests.length === 1
        ? "Apollo"
        : JSON.stringify({
            protocol: "phase74-independent-qa-judge-v1",
            reason: "The candidate matches the reference.",
            verdict: "correct",
          });
      return new Response(JSON.stringify({
        choices: [{
          finish_reason: "stop",
          index: 0,
          message: { content, role: "assistant" },
        }],
        model: requests.length === 1 ? "gpt-5.6-terra" : "gpt-5.5",
        object: "chat.completion",
        usage: { completion_tokens: 3, prompt_tokens: 7 },
      }), { headers: { "content-type": "application/json" } });
    };
    const input = liveInput({ fetch });
    const dependencies = createPhase74HaluMemLiveDependencies(input);
    const answer = await dependencies.e4.answer({
      branch: "baseline",
      context: "user-a works on Apollo.",
      format: "legacy",
      prompt: "reader prompt bound by the HaluMem verifier",
      question: "Which project?",
      questionCaseId: "user-a:session:0:question:0",
      system: "reader system bound by the HaluMem verifier",
    });
    const decision = await dependencies.e4.judgeQa({
      answer,
      branch: "baseline",
      expectedAnswer: "Apollo",
      format: "legacy",
      prompt: "judge prompt bound by the HaluMem verifier",
      question: "Which project?",
      questionCaseId: "user-a:session:0:question:0",
      system: "judge system bound by the HaluMem verifier",
    });

    expect(answer).toBe("Apollo");
    expect(JSON.parse(decision)).toEqual({
      protocol: "phase74-independent-qa-judge-v1",
      reason: "The candidate matches the reference.",
      verdict: "correct",
    });
    expect(requests[0]).toMatchObject({
      model: "gpt-5.6-terra",
      messages: [
        { content: "reader system bound by the HaluMem verifier", role: "system" },
        { content: "reader prompt bound by the HaluMem verifier", role: "user" },
      ],
    });
    expect(requests[1]).toMatchObject({ model: "gpt-5.5" });
    expect(input.intents).toHaveLength(2);
    expect(input.events).toHaveLength(2);
    expect(input.intents.map(({ branch }) => branch)).toEqual([
      "baseline",
      "judge",
    ]);
  });

  it("seeds owner and foreign users into one memory instance and proves both scopes", async () => {
    const remembered = new Map<string, string[]>();
    const recallScopes: Array<{ userId: string; workspaceId?: string }> = [];
    const recallReferenceTimes: string[] = [];
    let factoryCalls = 0;
    const memory: Phase74HaluMemScopedMemory = {
      async recall({ referenceTime, scope }) {
        recallScopes.push(scope);
        recallReferenceTimes.push(referenceTime);
        return {
          evidence: (remembered.get(scope.userId) ?? []).map((sourceMessageId) => ({
            sourceMessageIds: [sourceMessageId],
          })),
        };
      },
      async remember({ messages, scope }) {
        remembered.set(scope.userId, [
          ...(remembered.get(scope.userId) ?? []),
          ...messages.map(({ id }) => id!),
        ]);
      },
    };
    const runtime = createPhase74HaluMemScopedPrivacyRuntime({
      branch: "candidate",
      createMemory() {
        factoryCalls += 1;
        return memory;
      },
      users: [user("user-a"), user("user-b")],
    });
    const result = await runtime.recall({
      ownerUserUuid: "user-a",
      privacyCaseId: "user-a:session:0:question:0:foreign-scope:user-b",
      question: "Which project does user-a work on?",
      sessionIndex: 0,
      targetUserUuid: "user-b",
    });

    expect(factoryCalls).toBe(1);
    expect(recallScopes).toHaveLength(2);
    expect(recallScopes[0]!.userId).not.toBe(recallScopes[1]!.userId);
    expect(recallScopes[0]!.workspaceId).toBe(recallScopes[1]!.workspaceId);
    expect(recallReferenceTimes).toEqual([
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    ]);
    expect(result.ownerScopeSourceMessageIds.length).toBeGreaterThan(0);
    expect(result.foreignScopeSourceMessageIds.length).toBeGreaterThan(0);
    expect(result.ownerScopeSourceMessageIds).not.toEqual(
      result.foreignScopeSourceMessageIds,
    );
    expect(result.snapshotId).toMatch(/^[a-f0-9]{64}$/u);
    expect(createHash("sha256").update(result.snapshotId).digest("hex"))
      .toHaveLength(64);
  });

  it("reuses one branch store and one ingestion across multiple privacy questions", async () => {
    const remembered = new Map<string, string[]>();
    let factoryCalls = 0;
    let rememberCalls = 0;
    const runtime = createPhase74HaluMemScopedPrivacyRuntime({
      branch: "candidate",
      createMemory() {
        factoryCalls += 1;
        return {
          async recall({ scope }) {
            return {
              evidence: (remembered.get(scope.userId) ?? []).map(
                (sourceMessageId) => ({ sourceMessageIds: [sourceMessageId] }),
              ),
            };
          },
          async remember({ messages, scope }) {
            rememberCalls += 1;
            remembered.set(scope.userId, [
              ...(remembered.get(scope.userId) ?? []),
              ...messages.map(({ id }) => id),
            ]);
          },
        };
      },
      users: [user("user-a"), user("user-b")],
    });

    await runtime.recall({
      ownerUserUuid: "user-a",
      privacyCaseId: "user-a:session:0:question:0:foreign-scope:user-b",
      question: "Which project?",
      sessionIndex: 0,
      targetUserUuid: "user-b",
    });
    const callsAfterFirstQuestion = { factoryCalls, rememberCalls };
    await runtime.recall({
      ownerUserUuid: "user-a",
      privacyCaseId: "user-a:session:0:question:1:foreign-scope:user-b",
      question: "Which project now?",
      sessionIndex: 0,
      targetUserUuid: "user-b",
    });

    expect(callsAfterFirstQuestion).toEqual({
      factoryCalls: 1,
      rememberCalls: 4,
    });
    expect({ factoryCalls, rememberCalls }).toEqual(callsAfterFirstQuestion);
  });
});
