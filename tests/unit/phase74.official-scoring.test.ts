import { describe, expect, it } from "bun:test";

import {
  buildPhase74ProtocolScoringIdentity,
  createPhase74ProtocolCompatibleAnswerAssessor,
} from "../../src/eval/phase74ProtocolScoring";
import type {
  AttributedModelUsageAttempt,
  AttributedModelUsageIntent,
} from "../../src/eval/modelUsage";

const judgeModel = {
  apiKey: "judge-key",
  baseURL: "https://ai.gurkiai.com/v1",
  model: "gpt-5.5",
  provider: "openai" as const,
};

const officialGpt4oJudge = {
  gateway: "https://api.openai.com/v1",
  model: "gpt-4o-2024-08-06",
  provider: "openai",
};

describe("Phase 74 protocol-compatible scoring", () => {
  it("publishes benchmark-specific scoring and comparability identities", () => {
    expect(buildPhase74ProtocolScoringIdentity("longmemeval", {
      gateway: judgeModel.baseURL,
      model: judgeModel.model,
      provider: judgeModel.provider,
    }))
      .toMatchObject({
      binaryCorrectRule: "yes-substring",
      comparability: "official-prompt-compatible-only",
      evaluator: {
        gateway: "https://ai.gurkiai.com/v1",
        model: "gpt-5.5",
        provider: "openai",
      },
      evaluatorAlias: null,
      primaryMetric: "paired-accuracy",
      publishedScoreComparable: false,
      scorer: "longmemeval-pinned-prompt-compatible-qa-accuracy-v2",
    });
    expect(buildPhase74ProtocolScoringIdentity("longmemeval", officialGpt4oJudge))
      .toMatchObject({
      comparability: "pinned-upstream-evaluator-identity",
      evaluator: officialGpt4oJudge,
      evaluatorAlias: "gpt-4o",
      publishedScoreComparable: true,
    });
    expect(buildPhase74ProtocolScoringIdentity("longmemeval", {
      gateway: "https://gateway.example/v1",
      model: "gpt-4o",
      provider: "openai",
    })).toMatchObject({
      comparability: "official-prompt-compatible-only",
      publishedScoreComparable: false,
    });
    expect(buildPhase74ProtocolScoringIdentity("locomo", officialGpt4oJudge))
      .toMatchObject({
      binaryCorrectRule: "score-equals-one",
      primaryMetric: "macro-mean-category-aware-f1",
      scorer: expect.stringContaining("snap-research/locomo@"),
    });
  });

  it("scores LoCoMo locally with the pinned category-aware scorer", async () => {
    const events: AttributedModelUsageAttempt[] = [];
    const intents: AttributedModelUsageIntent[] = [];
    const assess = createPhase74ProtocolCompatibleAnswerAssessor({
      benchmark: "locomo",
      events,
      intents,
      model: judgeModel,
    });

    const result = await assess({
      answer: "running clubs",
      purpose: "final:candidate:E2:claim-temporal-on",
      testCase: {
        caseId: "locomo/q1",
        expectedAnswer: "run club",
        goldEvidenceIds: [],
        protocolMetadata: { category: "single_hop" },
        question: "What club?",
        rawEvidence: [],
      },
    });

    expect(result).toEqual({ correct: true, score: 1 });
    expect(events).toEqual([]);
    expect(intents).toEqual([]);
  });

  it("judges LongMemEval with the pinned per-question-type prompt", async () => {
    const events: AttributedModelUsageAttempt[] = [];
    const intents: AttributedModelUsageIntent[] = [];
    const usageOrder: string[] = [];
    let requestBody = "";
    const assess = createPhase74ProtocolCompatibleAnswerAssessor({
      benchmark: "longmemeval",
      events,
      fetch: async (_url, init) => {
        usageOrder.push("provider");
        requestBody = String(init?.body);
        return new Response([
          'data: {"choices":[{"delta":{"content":"Yes"},"index":0}]}',
          'data: {"choices":[],"usage":{"prompt_tokens":30,"completion_tokens":1}}',
          "data: [DONE]",
          "",
        ].join("\n\n"), {
          headers: { "content-type": "text/event-stream" },
          status: 200,
        });
      },
      intents,
      model: judgeModel,
      onUsageEvent: () => usageOrder.push("terminal"),
      onUsageIntent: () => usageOrder.push("intent"),
    });

    expect(await assess({
      answer: "19 days",
      purpose: "final:candidate:E2:claim-temporal-on",
      testCase: {
        caseId: "lme/q1",
        expectedAnswer: "18 days",
        goldEvidenceIds: [],
        protocolMetadata: { questionType: "temporal-reasoning" },
        question: "How long?",
        rawEvidence: [],
      },
    })).toEqual({ correct: true, score: 1 });
    expect(requestBody).toContain("do not penalize off-by-one errors");
    expect(JSON.parse(requestBody)).toMatchObject({
      max_tokens: 10,
      model: "gpt-5.5",
      reasoning_effort: "medium",
      temperature: 0,
    });
    expect(usageOrder).toEqual(["intent", "provider", "terminal"]);
    expect(intents).toEqual([
      expect.objectContaining({
        branch: "judge",
        caseId: "lme/q1",
        operation: "judge",
      }),
    ]);
    expect(intents[0]?.requestId).toBe(events[0]?.requestId);
    expect(events).toEqual([
      expect.objectContaining({
        branch: "judge",
        caseId: "lme/q1",
        completeness: "complete",
        operation: "judge",
      }),
    ]);
  });

  it("attributes judge usage to an opaque case id without changing the official protocol id", async () => {
    const events: AttributedModelUsageAttempt[] = [];
    const intents: AttributedModelUsageIntent[] = [];
    let requestBody = "";
    const assess = createPhase74ProtocolCompatibleAnswerAssessor({
      benchmark: "longmemeval",
      events,
      fetch: async (_url, init) => {
        requestBody = String(init?.body);
        return new Response([
          'data: {"choices":[{"delta":{"content":"Yes"},"index":0}]}',
          'data: {"choices":[],"usage":{"prompt_tokens":30,"completion_tokens":1}}',
          "data: [DONE]",
          "",
        ].join("\n\n"), {
          headers: { "content-type": "text/event-stream" },
          status: 200,
        });
      },
      intents,
      model: judgeModel,
    });

    await expect(assess({
      answer: "The evidence is insufficient.",
      purpose: "final:candidate:E2:claim-temporal-on",
      testCase: {
        caseId: "longmemeval_abs/official-case-1",
        expectedAnswer: "The requested detail was not mentioned.",
        goldEvidenceIds: [],
        protocolMetadata: { questionType: "single-session-user" },
        question: "What was not mentioned?",
        rawEvidence: [],
      },
      usageCaseId: "opaque-case-4e94",
    })).resolves.toEqual({ correct: true, score: 1 });
    expect(requestBody).toContain("unanswerable question");
    expect(events[0]?.caseId).toBe("opaque-case-4e94");
    expect(intents[0]?.caseId).toBe("opaque-case-4e94");
    expect(JSON.stringify({ events, intents })).not.toContain(
      "longmemeval_abs/official-case-1",
    );
  });

  it("fails closed when required protocol metadata is missing", async () => {
    const assess = createPhase74ProtocolCompatibleAnswerAssessor({
      benchmark: "locomo",
      events: [],
      intents: [],
      model: judgeModel,
    });
    await expect(assess({
      answer: "answer",
      purpose: "final:baseline:E1:fact-only",
      testCase: {
        caseId: "locomo/q1",
        expectedAnswer: "gold",
        goldEvidenceIds: [],
        question: "question",
        rawEvidence: [],
      },
      usageCaseId: "opaque-case-1",
    })).rejects.toThrow("locomo/q1");
  });
});
