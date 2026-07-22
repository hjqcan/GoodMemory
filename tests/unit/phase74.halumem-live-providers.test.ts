import { createHash } from "node:crypto";

import { describe, expect, it } from "bun:test";

import {
  buildPhase74HaluMemCausalRecallCase,
  buildPhase74HaluMemLiveConfigurations,
  buildPhase74HaluMemPrivacyPipelineMaterial,
  createPhase74HaluMemScopedPrivacyRuntime,
  createPhase74HaluMemLiveDependencies,
} from "../../scripts/phase-74-halumem-live-providers";
import type {
  Phase74HaluMemScopedMemory,
} from "../../scripts/phase-74-halumem-live-providers";
import type {
  Phase74HaluMemUser,
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
        memory_points: [],
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

  it("binds safety descriptors to the exact raw extractor, channels, plan, and store topology", () => {
    const input = liveInput();
    const configuration = buildPhase74HaluMemLiveConfigurations(input.models);

    expect(configuration.safety.baselinePipeline.sha256).toBe(
      hashPhase74ProtectionValue(
        buildPhase74HaluMemPrivacyPipelineMaterial("baseline", input.models),
      ),
    );
    expect(configuration.safety.candidatePipeline.sha256).toBe(
      hashPhase74ProtectionValue(
        buildPhase74HaluMemPrivacyPipelineMaterial("candidate", input.models),
      ),
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
