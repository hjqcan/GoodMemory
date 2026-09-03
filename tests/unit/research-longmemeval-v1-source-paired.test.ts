import {
  describe,
  expect,
  it,
} from "bun:test";

import {
  assertLongMemEvalV1SourceReplayClosure,
  buildLongMemEvalV1SourcePairedConfiguration,
  buildLongMemEvalV1SourceWorkerEnvironment,
  buildLongMemEvalV1SourceWorkerPayload,
  deriveLongMemEvalV1SourcePairedMetrics,
  validateLongMemEvalV1SourcePairedUsageClosure,
} from "../../scripts/research/longmemeval-v1/source-paired";
import type {
  LongMemEvalV1SourcePairedCaseResult,
} from "../../scripts/research/longmemeval-v1/source-paired";
import type {
  AttributedModelUsageAttempt,
  AttributedModelUsageIntent,
} from "../../src/eval/modelUsage";
import {
  parseLongMemEvalV1SourceWorkerInput,
  runLongMemEvalV1SourceWorker,
} from "../../scripts/research/longmemeval-v1/source-worker";
import type { LongMemEvalCase } from "../../src/eval/longmemeval";

const cases: LongMemEvalCase[] = [
  {
    answer: "Atlas",
    answerSessionIds: ["raw-session-2"],
    haystackDates: ["2026/07/01", "2026/07/09"],
    haystackSessionIds: ["raw-session-1", "raw-session-2"],
    haystackSessions: [
      [{ content: "I used to work on Beacon.", role: "user" }],
      [{ content: "I now work on Atlas.", role: "user" }],
    ],
    question: "What is my current project?",
    questionDate: "2026/07/10",
    questionId: "raw-question-id",
    questionType: "knowledge-update",
  },
];

describe("LongMemEval V1 source-paired research boundary", () => {
  it("builds one strict gold-blind worker payload for both source trees", () => {
    const raw = buildLongMemEvalV1SourceWorkerPayload({
      cases,
      datasetSha256: "d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442",
    });
    const parsed = parseLongMemEvalV1SourceWorkerInput(raw);

    expect(parsed.cases).toHaveLength(1);
    expect(parsed.cases[0]).toEqual({
      caseKey: expect.stringMatching(/^case-[a-f0-9]{24}$/u),
      question: "What is my current project?",
      questionDate: "2026/07/10",
      sessions: [
        {
          date: "2026/07/01",
          sessionId: "session-1",
          turns: [{ content: "I used to work on Beacon.", role: "user" }],
        },
        {
          date: "2026/07/09",
          sessionId: "session-2",
          turns: [{ content: "I now work on Atlas.", role: "user" }],
        },
      ],
    });
    expect(raw).not.toContain("raw-question-id");
    expect(raw).not.toContain("raw-session");
    expect(raw).not.toContain("knowledge-update");
    expect(raw).not.toContain("Atlas\"");
  });

  it("rejects gold, type, raw identity, and answer-label fields", () => {
    const base = JSON.parse(buildLongMemEvalV1SourceWorkerPayload({
      cases,
      datasetSha256: "d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442",
    })) as { cases: Array<Record<string, unknown>>; schemaVersion: number };

    for (const [key, value] of [
      ["answer", "Atlas"],
      ["answerSessionIds", ["session-2"]],
      ["questionId", "raw-question-id"],
      ["questionType", "knowledge-update"],
    ] as const) {
      const contaminated = structuredClone(base);
      contaminated.cases[0]![key] = value;
      expect(() => parseLongMemEvalV1SourceWorkerInput(
        JSON.stringify(contaminated),
      )).toThrow("Invalid LongMemEval V1 source-worker input");
    }

    const contaminatedTurn = structuredClone(base);
    const sessions = contaminatedTurn.cases[0]!.sessions as Array<{
      turns: Array<Record<string, unknown>>;
    }>;
    sessions[0]!.turns[0]!.hasAnswer = true;
    expect(() => parseLongMemEvalV1SourceWorkerInput(
      JSON.stringify(contaminatedTurn),
    )).toThrow("Invalid LongMemEval V1 source-worker input");
  });

  it("preserves legitimate empty benchmark turns in the gold-blind payload", () => {
    const withEmptyTurn = structuredClone(cases);
    withEmptyTurn[0]!.haystackSessions[0]![0]!.content = "";

    const parsed = parseLongMemEvalV1SourceWorkerInput(
      buildLongMemEvalV1SourceWorkerPayload({
        cases: withEmptyTurn,
        datasetSha256:
          "d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442",
      }),
    );

    expect(parsed.cases[0]?.sessions[0]?.turns[0]?.content).toBe("");
  });

  it("executes the anonymous payload through the real recommended context path", async () => {
    const input = parseLongMemEvalV1SourceWorkerInput(
      buildLongMemEvalV1SourceWorkerPayload({
        cases,
        datasetSha256: "d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442",
      }),
    );

    const output = await runLongMemEvalV1SourceWorker(input);
    const repeated = await runLongMemEvalV1SourceWorker(input);

    expect(output.schemaVersion).toBe(1);
    expect(output.cases).toHaveLength(1);
    expect(output.cases[0]?.caseKey).toBe(input.cases[0]?.caseKey);
    expect(typeof output.cases[0]?.context).toBe("string");
    expect(output.cases[0]?.retrievedSessionIds.every(
      (sessionId) => /^session-[12]$/u.test(sessionId),
    )).toBe(true);
    expect(repeated).toEqual(output);
  });

  it("runs source workers with a minimal gold- and credential-blind environment", () => {
    expect(buildLongMemEvalV1SourceWorkerEnvironment({
      GOODMEMORY_EVAL_API_KEY: "reader-secret",
      GOODMEMORY_JUDGE_API_KEY: "judge-secret",
      GOODMEMORY_LONGMEMEVAL_V1_PAIRED_ROOT: "/gold-dataset",
      HOME: "/private/home",
      LANG: "en_US.UTF-8",
      NODE_OPTIONS: "--require=/tmp/leak.cjs",
      OPENAI_API_KEY: "generic-secret",
      PATH: "/usr/bin:/bin",
      TMPDIR: "/tmp/worker",
      TZ: "UTC",
    })).toEqual({
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      NODE_ENV: "test",
      PATH: "/usr/bin:/bin",
      TMPDIR: "/tmp/worker",
      TZ: "UTC",
    });
  });

  it("declares the hermetic product-path configuration in the proof", () => {
    expect(buildLongMemEvalV1SourcePairedConfiguration({
      arch: "arm64",
      bunVersion: "1.3.14",
      platform: "darwin",
    })).toEqual({
      assistedExtractorAdapter: "configured-no-provider-empty",
      contextBuildConcurrencyPerArm: 2,
      contextMaxTokens: 4_000,
      deterministicClockAndIds:
        "case-namespaced-sequential-ids-and-utc-tick-clock",
      embeddingAdapter: "none",
      extractionStrategy: "rules-only",
      fusionMinRelativeStrength: 0.35,
      ingestMode: "label-free-raw",
      modelCallConcurrency: 2,
      profile: "goodmemory-recommended",
      projectionBulkBackfill: true,
      projectionWriteThrough: false,
      readerContext: "question-date-and-memory-context-envelope",
      runtime: {
        arch: "arm64",
        bunVersion: "1.3.14",
        platform: "darwin",
      },
      sourceArmConcurrency: 2,
      storageProvider: "memory",
    });
  });

  it("rejects a different verifier source or replayed source output", async () => {
    const input = parseLongMemEvalV1SourceWorkerInput(
      buildLongMemEvalV1SourceWorkerPayload({
        cases,
        datasetSha256:
          "d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442",
      }),
    );
    const output = await runLongMemEvalV1SourceWorker(input);
    const orchestrator = {
      commit: "a".repeat(40),
      tree: "b".repeat(40),
    };

    expect(() => assertLongMemEvalV1SourceReplayClosure({
      artifacts: { baseline: output, candidate: output },
      currentOrchestrator: orchestrator,
      replays: { baseline: output, candidate: output },
      reportedOrchestrator: orchestrator,
    })).not.toThrow();

    expect(() => assertLongMemEvalV1SourceReplayClosure({
      artifacts: { baseline: output, candidate: output },
      currentOrchestrator: {
        commit: "c".repeat(40),
        tree: "d".repeat(40),
      },
      replays: { baseline: output, candidate: output },
      reportedOrchestrator: orchestrator,
    })).toThrow("verifier source identity drifted");

    const replayDrift = structuredClone(output);
    replayDrift.cases[0]!.context += " drift";
    expect(() => assertLongMemEvalV1SourceReplayClosure({
      artifacts: { baseline: output, candidate: output },
      currentOrchestrator: orchestrator,
      replays: { baseline: output, candidate: replayDrift },
      reportedOrchestrator: orchestrator,
    })).toThrow("source replay drifted");
  });

  it("recomputes paired accuracy, strata, McNemar, and bootstrap evidence", () => {
    const paired = [
      pairedCase("case-000000000000000000000001", "knowledge-update", false, true),
      pairedCase("case-000000000000000000000002", "knowledge-update", true, true),
      pairedCase("case-000000000000000000000003", "temporal-reasoning", false, false),
    ];

    const metrics = deriveLongMemEvalV1SourcePairedMetrics(paired, {
      bootstrapSamples: 100,
      seed: 17,
    });
    expect(metrics.summary).toEqual({
      baselineAccuracy: 1 / 3,
      baselineCorrect: 1,
      byQuestionType: {
        "knowledge-update": {
          baselineAccuracy: 0.5,
          baselineCorrect: 1,
          candidateAccuracy: 1,
          candidateCorrect: 2,
          losses: 0,
          netWins: 1,
          ties: 1,
          totalCases: 2,
          wins: 1,
        },
        "temporal-reasoning": {
          baselineAccuracy: 0,
          baselineCorrect: 0,
          candidateAccuracy: 0,
          candidateCorrect: 0,
          losses: 0,
          netWins: 0,
          ties: 1,
          totalCases: 1,
          wins: 0,
        },
      },
      candidateAccuracy: 2 / 3,
      candidateCorrect: 2,
      losses: 0,
      netWins: 1,
      ties: 2,
      totalCases: 3,
      wins: 1,
    });
    expect(metrics.mcnemar).toMatchObject({
      baselineOnly: 0,
      candidateOnly: 1,
      caseCount: 3,
      discordantCount: 1,
      method: "mcnemar",
      pValue: 1,
    });
    expect(metrics.pairedBootstrap).toMatchObject({
      bootstrapSamples: 100,
      caseCount: 3,
      delta: 1 / 3,
      method: "paired-bootstrap",
      seed: 17,
    });
  });

  it("rejects divergent results when one shared context reused one model call", () => {
    const testCase = pairedCase(
      "case-000000000000000000000001",
      "knowledge-update",
      false,
      true,
    );
    testCase.candidate.contextSha256 = testCase.baseline.contextSha256;

    expect(() => deriveLongMemEvalV1SourcePairedMetrics([testCase])).toThrow(
      "shared context result drifted",
    );
  });

  it("requires one attributed successful reader and judge chain per logical call", () => {
    const testCase = pairedCase(
      "case-000000000000000000000001",
      "knowledge-update",
      true,
      true,
    );
    const reader = usagePair({
      branch: "protocol_reader",
      caseId: `${testCase.caseKey}:shared`,
      modelId: "gpt-5.6-terra",
      operation: "answer_generation",
      requestId: "reader-1",
    });
    const judge = usagePair({
      branch: "judge",
      caseId: `${testCase.caseKey}:shared`,
      modelId: "gpt-5.5",
      operation: "judge",
      requestId: "judge-1",
    });

    expect(validateLongMemEvalV1SourcePairedUsageClosure({
      cases: [testCase],
      events: [reader.event, judge.event],
      intents: [reader.intent, judge.intent],
    })).toEqual({ answerInvocations: 1, judgeInvocations: 1 });
    expect(() => validateLongMemEvalV1SourcePairedUsageClosure({
      cases: [testCase],
      events: [],
      intents: [],
    })).toThrow("usage closure drifted");

    const wrongBranch = {
      ...reader,
      event: { ...reader.event, branch: "shadow" as const },
      intent: { ...reader.intent, branch: "shadow" as const },
    };
    expect(() => validateLongMemEvalV1SourcePairedUsageClosure({
      cases: [testCase],
      events: [wrongBranch.event, judge.event],
      intents: [wrongBranch.intent, judge.intent],
    })).toThrow("usage closure drifted");
  });
});

function pairedCase(
  caseKey: string,
  questionType: "knowledge-update" | "temporal-reasoning",
  baselineCorrect: boolean,
  candidateCorrect: boolean,
): LongMemEvalV1SourcePairedCaseResult {
  const arm = (correct: boolean, contextSha256: string) => ({
    answer: correct ? "correct" : "wrong",
    contextSha256,
    contextTokens: 10,
    correct,
    retrievedSessionIds: ["session-1"],
    score: Number(correct),
  });
  return {
    armOrder: ["baseline", "candidate"],
    baseline: arm(baselineCorrect, "a".repeat(64)),
    candidate: arm(
      candidateCorrect,
      (baselineCorrect === candidateCorrect ? "a" : "b").repeat(64),
    ),
    caseKey,
    delta: (Number(candidateCorrect) - Number(baselineCorrect)) as -1 | 0 | 1,
    questionType,
  };
}

function usagePair(input: {
  branch: AttributedModelUsageIntent["branch"];
  caseId: string;
  modelId: string;
  operation: AttributedModelUsageIntent["operation"];
  requestId: string;
}): {
  event: AttributedModelUsageAttempt;
  intent: AttributedModelUsageIntent;
} {
  const intent: AttributedModelUsageIntent = {
    attempt: 1,
    branch: input.branch,
    caseId: input.caseId,
    modelId: input.modelId,
    operation: input.operation,
    providerId: "openai",
    requestId: input.requestId,
    schemaVersion: 1,
  };
  return {
    event: {
      ...intent,
      completeness: "missing",
      outcome: "succeeded",
      usage: {
        cacheCreationInputTokens: null,
        cacheReadInputTokens: null,
        inputTokens: null,
        outputTokens: null,
        uncachedInputTokens: null,
      },
    },
    intent,
  };
}
