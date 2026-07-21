import { describe, expect, it } from "bun:test";

import {
  buildPhase74LabelFreeCaseBoundary,
  buildPhase74StageConfigurations,
  runPhase74Generalization,
  type Phase74GeneralizationCase,
  type Phase74RetrievalSnapshot,
} from "../../src/eval/phase74Generalization";
import {
  buildEvalRunIdentity,
  hashEvalExperimentIdentity,
} from "../../src/eval/runIdentity";

const cases: Phase74GeneralizationCase[] = [
  {
    caseId: "case-1",
    expectedAnswer: "Postgres",
    goldEvidenceIds: ["session-2"],
    locale: "en",
    protocolMetadata: { questionType: "knowledge-update" },
    question: "Which database is current?",
    rawEvidence: [
      {
        content: "The database changed to Postgres.",
        id: "raw-2",
        sourceIds: ["session-2"],
      },
    ],
  },
];

function identity() {
  return buildEvalRunIdentity({
    answerModel: {
      gateway: "deterministic://reader",
      model: "generic-reader-v1",
      provider: "deterministic",
    },
    benchmark: "longmemeval-smoke",
    configuration: {
      answer: { maxTokens: 512, temperature: 0 },
      context: { maxTokens: 6_000, tokenizer: "test-counter-v1" },
      reader: "generic-v1",
      retrieval: {
        preRankLimit: 32,
        selectedLimit: 12,
      },
    },
    datasetSha256: "dataset-sha",
    generatedAt: "2026-07-18T00:00:00.000Z",
    generatedBy: "phase74.generalization-runner.test.ts",
    judgeModel: {
      gateway: "deterministic://judge",
      model: "independent-judge-v1",
      provider: "deterministic",
    },
    promptSha256s: {
      genericReader: "reader-prompt-sha",
      judge: "judge-prompt-sha",
      protocolReader: "protocol-prompt-sha",
    },
    runId: "phase74-smoke-test",
  });
}

describe("Phase 74 generalization runner", () => {
  it("freezes deterministic planning across E2 and reserves the true off switch for E3", () => {
    const e2 = buildPhase74StageConfigurations(
      identity().configuration,
      "E2",
    );
    const e3 = buildPhase74StageConfigurations(
      identity().configuration,
      "E3",
    );

    expect(e2["claim-temporal-off"]?.retrieval).toMatchObject({
      recallPlanExecution: true,
    });
    expect(e2["claim-temporal-on"]?.retrieval).toMatchObject({
      recallPlanExecution: true,
    });
    expect(e3["recall-plan-off"]?.retrieval).toMatchObject({
      recallPlanExecution: false,
    });
    expect(e3["recall-plan-deterministic"]?.retrieval).toMatchObject({
      recallPlanExecution: true,
    });
  });

  it("runs independent memory groups concurrently while preserving group serialization and output order", async () => {
    const concurrentCases: Phase74GeneralizationCase[] = [
      {
        ...cases[0]!,
        caseId: "group-a-question-1",
        memoryGroupId: "group-a",
        question: "Question A1?",
      },
      {
        ...cases[0]!,
        caseId: "group-b-question-1",
        memoryGroupId: "group-b",
        question: "Question B1?",
      },
      {
        ...cases[0]!,
        caseId: "group-a-question-2",
        memoryGroupId: "group-a",
        question: "Question A2?",
      },
    ];
    const activeByGroup = new Map<string, number>();
    let maxActive = 0;
    let active = 0;
    let sameGroupOverlap = false;

    const report = await runPhase74Generalization({
      caseConcurrency: 2,
      cases: concurrentCases,
      countRenderedTokens: (content) => content.length,
      executeRetrieval: async ({ arm, stage, testCase }) => {
        const group = testCase.question.includes("A") ? "group-a" : "group-b";
        const groupActive = (activeByGroup.get(group) ?? 0) + 1;
        activeByGroup.set(group, groupActive);
        sameGroupOverlap ||= groupActive > 1;
        active += 1;
        maxActive = Math.max(maxActive, active);
        await Bun.sleep(5);
        active -= 1;
        activeByGroup.set(group, groupActive - 1);
        return {
          retrievedMemories: [],
          snapshotId: `${testCase.caseId}:${stage}:${arm}`,
          storedMemories: [],
        };
      },
      genericReader: async () => "Postgres",
      identity: identity(),
      includeOracle: false,
      judge: async () => ({ correct: true }),
      persistIdentity: async () => undefined,
      protocolReader: async () => "Postgres",
      renderEvidenceLedger: async () => "Postgres",
      stages: ["E2"],
    });

    expect(maxActive).toBe(2);
    expect(sameGroupOverlap).toBe(false);
    expect(report.executions.map(({ caseId }) => caseId)).toEqual([
      "group-a-question-1",
      "group-a-question-1",
      "group-b-question-1",
      "group-b-question-1",
      "group-a-question-2",
      "group-a-question-2",
    ]);
  });

  it("round-robins memory groups when serialization is disabled while preserving output order", async () => {
    const concurrentCases: Phase74GeneralizationCase[] = [
      {
        ...cases[0]!,
        caseId: "group-a-question-1",
        memoryGroupId: "group-a",
        question: "Question A1?",
      },
      {
        ...cases[0]!,
        caseId: "group-a-question-2",
        memoryGroupId: "group-a",
        question: "Question A2?",
      },
      {
        ...cases[0]!,
        caseId: "group-b-question-1",
        memoryGroupId: "group-b",
        question: "Question B1?",
      },
    ];
    const activeByGroup = new Map<string, number>();
    const startOrder: string[] = [];
    let active = 0;
    let maxActive = 0;
    let releaseFirstA!: () => void;
    const firstAReleased = new Promise<void>((resolve) => {
      releaseFirstA = resolve;
    });
    let sameGroupOverlap = false;

    const report = await runPhase74Generalization({
      caseConcurrency: 2,
      cases: concurrentCases,
      countRenderedTokens: (content) => content.length,
      executeRetrieval: async ({ arm, stage, testCase }) => {
        const group = testCase.question.includes("A") ? "group-a" : "group-b";
        const groupActive = (activeByGroup.get(group) ?? 0) + 1;
        activeByGroup.set(group, groupActive);
        active += 1;
        maxActive = Math.max(maxActive, active);
        sameGroupOverlap ||= groupActive > 1;
        if (arm === "claim-temporal-off") {
          startOrder.push(testCase.question);
        }
        if (
          arm === "claim-temporal-off" &&
          testCase.question === "Question A1?"
        ) {
          await firstAReleased;
        }
        if (
          arm === "claim-temporal-off" &&
          testCase.question === "Question A2?"
        ) {
          releaseFirstA();
        }
        active -= 1;
        activeByGroup.set(group, groupActive - 1);
        return {
          retrievedMemories: [],
          snapshotId: `${testCase.caseId}:${stage}:${arm}`,
          storedMemories: [],
        };
      },
      genericReader: async () => "Postgres",
      identity: identity(),
      includeOracle: false,
      judge: async () => ({ correct: true }),
      persistIdentity: async () => undefined,
      protocolReader: async () => "Postgres",
      renderEvidenceLedger: async () => "Postgres",
      serializeMemoryGroups: false,
      stages: ["E2"],
    });

    expect(startOrder).toEqual([
      "Question A1?",
      "Question B1?",
      "Question A2?",
    ]);
    expect(maxActive).toBe(2);
    expect(sameGroupOverlap).toBe(true);
    expect(report.executions.map(({ caseId }) => caseId)).toEqual([
      "group-a-question-1",
      "group-a-question-1",
      "group-a-question-2",
      "group-a-question-2",
      "group-b-question-1",
      "group-b-question-1",
    ]);
  });

  it("honors case concurrency for E4 and oracle work while preserving case order", async () => {
    const concurrentCases: Phase74GeneralizationCase[] = [
      {
        ...cases[0]!,
        caseId: "case-a",
        memoryGroupId: "group-a",
        question: "Question A?",
      },
      {
        ...cases[0]!,
        caseId: "case-b",
        memoryGroupId: "group-b",
        question: "Question B?",
      },
    ];
    const active = { e4: 0, oracle: 0 };
    const maximum = { e4: 0, oracle: 0 };
    const started = { e4: new Set<string>(), oracle: new Set<string>() };
    let releaseE4!: () => void;
    let releaseOracle!: () => void;
    const gates = {
      e4: new Promise<void>((resolve) => {
        releaseE4 = resolve;
      }),
      oracle: new Promise<void>((resolve) => {
        releaseOracle = resolve;
      }),
    };
    const trackReader = async (input: {
      purpose?: string;
      question: string;
    }) => {
      const phase = input.purpose?.startsWith("e4:") === true
        ? "e4"
        : input.purpose?.startsWith("oracle:") === true
        ? "oracle"
        : null;
      if (phase === null) {
        return input.question;
      }
      active[phase] += 1;
      maximum[phase] = Math.max(maximum[phase], active[phase]);
      started[phase].add(input.question);
      if (started[phase].size === 2) {
        phase === "e4" ? releaseE4() : releaseOracle();
      }
      await gates[phase];
      active[phase] -= 1;
      return input.question;
    };

    const report = await runPhase74Generalization({
      caseConcurrency: 2,
      cases: concurrentCases,
      countRenderedTokens: (content) => content.length,
      e4ProtectionDeltas: {
        prose: 0,
        chronology: 0,
        compact_json: 0,
        json_locale_note: 0,
      },
      executeRetrieval: async ({ arm, stage, testCase }) => ({
        retrievedMemories: [],
        snapshotId: `${testCase.caseId}:${stage}:${arm}`,
        storedMemories: [],
      }),
      genericReader: trackReader,
      identity: identity(),
      judge: async () => ({ correct: true }),
      persistIdentity: async () => undefined,
      protocolReader: trackReader,
      renderEvidenceLedger: async () => "Postgres",
      stages: ["E3", "E4"],
    });

    expect(maximum).toEqual({ e4: 2, oracle: 2 });
    expect(report.e4.cases.map(({ caseId }) => caseId)).toEqual([
      ...Array(4).fill("case-a"),
      ...Array(4).fill("case-b"),
    ]);
    expect(report.oracle.map(({ answer }) => answer)).toEqual([
      ...Array(6).fill("Question A?"),
      ...Array(6).fill("Question B?"),
    ]);
  });

  it("hides LoCoMo source names without flattening session topology", () => {
    const boundary = buildPhase74LabelFreeCaseBoundary({
      caseId: "locomo/conversation-1/q1",
      expectedAnswer: "answer",
      goldEvidenceIds: ["D1:1"],
      question: "question",
      rawEvidence: [
        { content: "first", id: "raw-1", sourceIds: ["D1:1"] },
        { content: "second", id: "raw-2", sourceIds: ["D1:2"] },
        { content: "third", id: "raw-3", sourceIds: ["D2:1"] },
      ],
    });
    const sourceIds = boundary.recallCase.rawEvidence.map(
      (evidence) => evidence.sourceIds[0],
    );

    expect(sourceIds[0]?.split(":")[0]).toBe(sourceIds[1]?.split(":")[0]);
    expect(sourceIds[2]?.split(":")[0]).not.toBe(sourceIds[0]?.split(":")[0]);
    expect(JSON.stringify(boundary.recallCase)).not.toContain("D1");
    expect(JSON.stringify(boundary.recallCase)).not.toContain("D2");
  });

  it("uses one family assessment as the source of both score and correctness", async () => {
    const purposes: string[] = [];
    let legacyJudgeCalls = 0;
    const report = await runPhase74Generalization({
      assessAnswer: async ({ purpose, testCase }) => {
        purposes.push(purpose);
        expect(testCase.protocolMetadata?.questionType).toBe("knowledge-update");
        return { correct: false, score: 0.25 };
      },
      cases,
      countRenderedTokens: (content) => content.length,
      executeRetrieval: async ({ arm, stage }) => ({
        retrievedMemories: [],
        snapshotId: `${stage}:${arm}`,
        storedMemories: [],
      }),
      genericReader: async () => "candidate",
      identity: identity(),
      includeOracle: false,
      judge: async () => {
        legacyJudgeCalls += 1;
        return { correct: true };
      },
      persistIdentity: async () => undefined,
      protocolReader: async () => "unused",
      renderEvidenceLedger: async () => "unused",
      stages: ["E2"],
    });

    expect(legacyJudgeCalls).toBe(0);
    expect(purposes).toEqual([
      "final:baseline:E2:claim-temporal-off",
      "final:candidate:E2:claim-temporal-on",
    ]);
    expect(report.executions.map(({ correct, score }) => ({ correct, score })))
      .toEqual([
        { correct: false, score: 0.25 },
        { correct: false, score: 0.25 },
      ]);
  });

  it("binds identical reader inputs to one assessment without hiding actual model calls", async () => {
    let readerCalls = 0;
    let assessmentCalls = 0;
    const report = await runPhase74Generalization({
      assessAnswer: async ({ answer }) => {
        assessmentCalls += 1;
        return {
          correct: answer === "answer-1",
          score: answer === "answer-1" ? 1 : 0,
        };
      },
      cases,
      countRenderedTokens: (content) => content.length,
      executeRetrieval: async ({ arm, stage }) => ({
        retrievedMemories: [{
          content: "Current database is Postgres.",
          id: "fact-postgres",
          sourceIds: ["opaque-source"],
        }],
        snapshotId: `${stage}:${arm}`,
        storedMemories: [],
      }),
      genericReader: async () => {
        readerCalls += 1;
        return `answer-${readerCalls}`;
      },
      identity: identity(),
      includeOracle: false,
      judge: async () => ({ correct: true }),
      persistIdentity: async () => undefined,
      protocolReader: async () => "unused",
      renderEvidenceLedger: async () => "unused",
      stages: ["E2"],
    });

    expect(readerCalls).toBe(2);
    expect(assessmentCalls).toBe(2);
    expect(report.executions.map(({ answer, correct, score }) => ({
      answer,
      correct,
      score,
    }))).toEqual([
      { answer: "answer-1", correct: true, score: 1 },
      { answer: "answer-1", correct: true, score: 1 },
    ]);
    expect(report.executions.map(({ evaluationAttribution }) =>
      evaluationAttribution
    )).toEqual([
      expect.objectContaining({
        observedAnswer: "answer-1",
        observedScore: 1,
        reused: false,
        sourceArm: "claim-temporal-off",
      }),
      expect.objectContaining({
        observedAnswer: "answer-2",
        observedScore: 0,
        reused: true,
        sourceArm: "claim-temporal-off",
      }),
    ]);
  });

  it("excludes one-time ingestion from comparable query-path latency", async () => {
    let clock = 0;
    const report = await runPhase74Generalization({
      assessAnswer: async () => ({ correct: true, score: 1 }),
      cases,
      countRenderedTokens: (content) => content.length,
      executeRetrieval: async ({ arm, stage }) => {
        clock += 1_000;
        return {
          recallMetadata: {
            latencyMs: 8,
            queryPathLatencyMs: 10,
          } as Phase74RetrievalSnapshot["recallMetadata"] & {
            queryPathLatencyMs: number;
          },
          retrievedMemories: [],
          snapshotId: `${stage}:${arm}`,
          storedMemories: [],
        };
      },
      genericReader: async () => {
        clock += 20;
        return "Postgres";
      },
      identity: identity(),
      includeOracle: false,
      judge: async () => ({ correct: true }),
      now: () => clock,
      persistIdentity: async () => undefined,
      protocolReader: async () => "unused",
      renderEvidenceLedger: async () => "unused",
      stages: ["E2"],
    });

    expect(report.executions.map((execution) => ({
      answer: execution.answerLatencyMs,
      product: execution.productLatencyMs,
      recall: execution.recallLatencyMs,
    }))).toEqual([
      { answer: 20, product: 30, recall: 8 },
      { answer: 20, product: 30, recall: 8 },
    ]);
  });

  it("persists identity first, isolates E1-E4, and reuses one E3 packet for every E4 format", async () => {
    const events: string[] = [];
    const executions: string[] = [];
    const renderedSnapshots: Phase74RetrievalSnapshot[] = [];
    const report = await runPhase74Generalization({
      cases,
      countRenderedTokens: (content) => content.length,
      executeRetrieval: async ({ arm, testCase, stage }) => {
        events.push(`execute:${stage}:${arm}`);
        executions.push(`${stage}:${arm}`);
        return {
          retrievedMemories: [
            {
              content: "Current database is Postgres.",
              id: `retrieved-${stage}-${arm}`,
              sourceIds: ["session-2"],
            },
          ],
          snapshotId: `${testCase.caseId}:${stage}:${arm}`,
          storedMemories: [
            {
              content: "Current database is Postgres.",
              id: `stored-${stage}-${arm}`,
              sourceIds: ["session-2"],
            },
          ],
        };
      },
      genericReader: async ({ context }) => {
        events.push("generic-reader");
        return context.includes("Postgres") ? "Postgres" : "No answer";
      },
      identity: identity(),
      judge: async ({ answer, expectedAnswer }) => ({
        correct: answer === expectedAnswer || answer === "No answer",
      }),
      e4ProtectionDeltas: {
        prose: 0,
        chronology: 0,
        compact_json: 0,
        json_locale_note: 0,
      },
      persistIdentity: async () => {
        events.push("identity");
      },
      protocolReader: async ({ context }) => {
        events.push("protocol-reader");
        return context.includes("Postgres") ? "Postgres" : "No answer";
      },
      renderEvidenceLedger: async ({ format, snapshot }) => {
        renderedSnapshots.push(snapshot);
        const padding = {
          prose: "..........",
          chronology: "........",
          compact_json: "......",
          json_locale_note: "............",
        }[format];
        return `${padding} Postgres`;
      },
    });

    expect(events[0]).toBe("identity");
    expect(executions).toEqual([
      "E1:fact-only",
      "E1:raw-only",
      "E1:atomic-contextual-raw-pointer",
      "E2:claim-temporal-off",
      "E2:claim-temporal-on",
      "E3:recall-plan-off",
      "E3:recall-plan-deterministic",
      "E3:recall-plan-assisted",
    ]);
    expect(renderedSnapshots).toHaveLength(4);
    const renderedSnapshotIds = [...new Set(
      renderedSnapshots.map(({ snapshotId }) => snapshotId),
    )];
    expect(renderedSnapshotIds).toHaveLength(1);
    expect(renderedSnapshotIds[0]).toMatch(
      /^case-[a-f0-9]{64}:E3:recall-plan-deterministic$/u,
    );
    expect(report.e4.selectedFormat).toBe("compact_json");
    expect(report.e4.cases.every(({ score }) => score === 1)).toBe(true);
    expect(report.oracle).toHaveLength(6);
    expect(report.executions.every((execution) =>
      execution.productLatencyMs !== undefined &&
      execution.productLatencyMs >= execution.recallLatencyMs! &&
      execution.answerLatencyMs! >= 0
    )).toBe(true);
    expect(report.experimentIdentityHash).toBe(
      hashEvalExperimentIdentity(report.identity),
    );
    expect(report.status).toBe("not_evaluable");
    expect(report.summary.executionFailures).toBe(0);
    expect(report.summary.renderedContextMaxTokens).toBeGreaterThan(0);
  });

  it("keeps E4 not evaluable without protection evidence instead of assuming zero delta", async () => {
    const report = await runPhase74Generalization({
      cases,
      countRenderedTokens: (content) => content.length,
      executeRetrieval: async ({ arm, stage }) => ({
        retrievedMemories: [],
        snapshotId: `${stage}:${arm}`,
        storedMemories: [],
      }),
      genericReader: async () => "Postgres",
      identity: identity(),
      includeOracle: false,
      judge: async () => ({ correct: true }),
      persistIdentity: async () => undefined,
      protocolReader: async () => "Postgres",
      renderEvidenceLedger: async () => "Postgres",
    });

    expect(report.e4.selectedFormat).toBe("not_evaluable");
    expect(report.e4.formatResults.every(({ protectionDelta }) =>
      protectionDelta === null
    )).toBe(true);
  });

  it("uses supplied protection deltas and rejects formats beyond the one-point gate", async () => {
    const report = await runPhase74Generalization({
      cases,
      countRenderedTokens: (content) => content.length,
      e4ProtectionDeltas: {
        prose: -0.02,
        chronology: 0,
        compact_json: -0.005,
        json_locale_note: -0.02,
      },
      executeRetrieval: async ({ arm, stage }) => ({
        retrievedMemories: [],
        snapshotId: `${stage}:${arm}`,
        storedMemories: [],
      }),
      genericReader: async ({ purpose }) =>
        purpose === "e4:prose" ? "Postgres" : "wrong",
      identity: identity(),
      includeOracle: false,
      judge: async ({ answer }) => ({ correct: answer === "Postgres" }),
      persistIdentity: async () => undefined,
      protocolReader: async () => "Postgres",
      renderEvidenceLedger: async ({ format }) =>
        format === "compact_json" ? "x" : "x".repeat(20),
    });

    expect(report.e4.formatResults).toContainEqual(
      expect.objectContaining({ format: "prose", protectionDelta: -0.02 }),
    );
    expect(report.e4.selectedFormat).toBe("compact_json");
  });

  it("keeps E4 not evaluable when every measured format fails protection", async () => {
    const report = await runPhase74Generalization({
      cases,
      countRenderedTokens: (content) => content.length,
      e4ProtectionDeltas: {
        prose: -0.02,
        chronology: -0.02,
        compact_json: -0.02,
        json_locale_note: -0.02,
      },
      executeRetrieval: async ({ arm, stage }) => ({
        retrievedMemories: [],
        snapshotId: `${stage}:${arm}`,
        storedMemories: [],
      }),
      genericReader: async () => "Postgres",
      identity: identity(),
      includeOracle: false,
      judge: async () => ({ correct: true }),
      persistIdentity: async () => undefined,
      protocolReader: async () => "Postgres",
      renderEvidenceLedger: async () => "Postgres",
    });

    expect(report.e4.selectedFormat).toBe("not_evaluable");
  });

  it("enforces the rendered-context budget on every E4 reader call", async () => {
    const contexts: string[] = [];
    const report = await runPhase74Generalization({
      cases,
      contextTokenBudget: 40,
      countRenderedTokens: (content) => content.length,
      executeRetrieval: async ({ arm, stage }) => ({
        retrievedMemories: [],
        snapshotId: `${stage}:${arm}`,
        storedMemories: [],
      }),
      genericReader: async ({ context, purpose }) => {
        if (purpose?.startsWith("e4:") === true) {
          contexts.push(context);
        }
        return "Postgres";
      },
      identity: identity(),
      includeOracle: false,
      judge: async () => ({ correct: true }),
      persistIdentity: async () => undefined,
      protocolReader: async () => "Postgres",
      renderEvidenceLedger: async () => "evidence ".repeat(100),
    });

    expect(contexts).toHaveLength(4);
    expect(contexts.every((context) => context.length <= 40)).toBe(true);
    expect(report.e4.cases.every(({ contextTokens, contextTruncated }) =>
      contextTokens <= 40 && contextTruncated
    )).toBe(true);
    expect(report.e4.cases.every(({ contextTokensBeforeTruncation }) =>
      contextTokensBeforeTruncation > 40
    )).toBe(true);
  });

  it("retains failures as artifacts and never upgrades a smoke run to promotion evidence", async () => {
    const report = await runPhase74Generalization({
      cases,
      countRenderedTokens: (content) => content.length,
      executeRetrieval: async ({ arm, stage }) => {
        if (stage === "E2" && arm === "claim-temporal-on") {
          throw new Error("projection unavailable");
        }
        return {
          retrievedMemories: [],
          snapshotId: `${stage}:${arm}`,
          storedMemories: [],
        };
      },
      genericReader: async () => "No answer",
      identity: identity(),
      judge: async () => ({ correct: false }),
      persistIdentity: async () => undefined,
      protocolReader: async () => "No answer",
      renderEvidenceLedger: async () => "",
    });

    expect(report.status).toBe("not_evaluable");
    expect(report.summary.executionFailures).toBe(1);
    expect(report.executions).toContainEqual(
      expect.objectContaining({
        arm: "claim-temporal-on",
        executionError: "projection unavailable",
        stage: "E2",
      }),
    );
  });

  it("keeps benchmark labels out of retrieval and resumes every expensive unit from serializable checkpoints", async () => {
    const retrieval = new Map<string, string>();
    const e4 = new Map<string, string>();
    const oracle = new Map<string, string>();
    let retrievalCalls = 0;
    let readerCalls = 0;
    let judgeCalls = 0;
    let identityCalls = 0;
    const productCaseIds: string[] = [];
    const checkpoint = {
      async loadE4(key: string) {
        const value = e4.get(key);
        return value === undefined ? null : JSON.parse(value);
      },
      async loadOracle(key: string) {
        const value = oracle.get(key);
        return value === undefined ? null : JSON.parse(value);
      },
      async loadRetrieval(key: string) {
        const value = retrieval.get(key);
        return value === undefined ? null : JSON.parse(value);
      },
      async saveE4(key: string, value: unknown) {
        e4.set(key, JSON.stringify(value));
      },
      async saveOracle(key: string, value: unknown) {
        oracle.set(key, JSON.stringify(value));
      },
      async saveRetrieval(key: string, value: unknown) {
        retrieval.set(key, JSON.stringify(value));
      },
    };
    const run = () => runPhase74Generalization({
      cases,
      checkpoint,
      countRenderedTokens: (content) => content.length,
      executeRetrieval: async ({ arm, stage, testCase }) => {
        retrievalCalls += 1;
        expect(testCase).not.toHaveProperty("expectedAnswer");
        expect(testCase).not.toHaveProperty("goldEvidenceIds");
        expect(testCase).not.toHaveProperty("protocolMetadata");
        expect(testCase).not.toHaveProperty("family");
        expect(JSON.stringify(testCase)).not.toContain("case-1");
        expect(JSON.stringify(testCase)).not.toContain("session-2");
        productCaseIds.push(testCase.caseId);
        return {
          evidenceLedgers: {
            prose: "Postgres",
            chronology: "Postgres",
            compact_json: "Postgres",
            json_locale_note: "Postgres",
          },
          retrievedMemories: [{
            content: "Postgres",
            id: "memory-1",
            sourceIds: testCase.rawEvidence[0]?.sourceIds ?? [],
          }],
          snapshotId: `${stage}:${arm}`,
          storedMemories: [{
            content: "Postgres",
            id: "memory-1",
            sourceIds: testCase.rawEvidence[0]?.sourceIds ?? [],
          }],
        };
      },
      genericReader: async ({ caseId, context }) => {
        readerCalls += 1;
        expect(caseId).not.toBe("case-1");
        expect(caseId).not.toContain("_abs");
        return context.includes("Postgres") ? "Postgres" : "No answer";
      },
      identity: identity(),
      judge: async ({ answer }) => {
        judgeCalls += 1;
        return { correct: answer === "Postgres" };
      },
      persistIdentity: async () => {
        identityCalls += 1;
      },
      protocolReader: async ({ context }) => {
        readerCalls += 1;
        return context.includes("Postgres") ? "Postgres" : "No answer";
      },
      renderEvidenceLedger: async ({ format, snapshot }) =>
        snapshot.evidenceLedgers?.[format] ?? "",
    });

    const first = await run();
    const firstCounts = { judgeCalls, readerCalls, retrievalCalls };
    const resumed = await run();

    expect(firstCounts.retrievalCalls).toBe(8);
    expect(new Set(productCaseIds).size).toBe(1);
    expect(productCaseIds[0]).toMatch(/^case-[a-f0-9]{64}$/u);
    expect({ judgeCalls, readerCalls, retrievalCalls }).toEqual(firstCounts);
    expect(identityCalls).toBe(2);
    expect(resumed.executions).toEqual(first.executions);
    expect(resumed.e4).toEqual(first.e4);
    expect(resumed.oracle).toEqual(first.oracle);
  });

  it("runs one retrieval stage at a time for full ablations", async () => {
    const calls: string[] = [];
    const report = await runPhase74Generalization({
      cases,
      countRenderedTokens: (content) => content.length,
      executeRetrieval: async ({ arm, stage }) => {
        calls.push(`${stage}:${arm}`);
        return {
          retrievedMemories: [],
          snapshotId: `${stage}:${arm}`,
          storedMemories: [],
        };
      },
      genericReader: async () => "No answer",
      identity: identity(),
      includeOracle: false,
      judge: async () => ({ correct: false }),
      persistIdentity: async () => undefined,
      protocolReader: async () => "No answer",
      renderEvidenceLedger: async () => "",
      stages: ["E2"],
    });

    expect(calls).toEqual([
      "E2:claim-temporal-off",
      "E2:claim-temporal-on",
    ]);
    expect(report.executions).toHaveLength(2);
    expect(report.e4.cases).toEqual([]);
    expect(report.e4.formatResults.every(({ averageTokens }) =>
      averageTokens === null
    )).toBe(true);
    expect(report.oracle).toEqual([]);
  });

  it("refuses E4 when the frozen deterministic E3 packet is missing", async () => {
    await expect(runPhase74Generalization({
      cases,
      checkpoint: {
        loadE4: async () => null,
        loadOracle: async () => null,
        loadRetrieval: async () => null,
        saveE4: async () => undefined,
        saveOracle: async () => undefined,
        saveRetrieval: async () => undefined,
      },
      countRenderedTokens: (content) => content.length,
      executeRetrieval: async () => {
        throw new Error("E4 must not retrieve");
      },
      genericReader: async () => "No answer",
      identity: identity(),
      judge: async () => ({ correct: false }),
      persistIdentity: async () => undefined,
      protocolReader: async () => "No answer",
      renderEvidenceLedger: async () => "",
      stages: ["E4"],
    })).rejects.toThrow(
      "Phase 74 E4 requires a committed deterministic E3 snapshot for case-1",
    );
  });
});
