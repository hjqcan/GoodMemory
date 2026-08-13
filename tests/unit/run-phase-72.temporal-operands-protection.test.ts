import { createHash } from "node:crypto";
import { describe, expect, it } from "bun:test";

import {
  runPhase72TemporalOperandsProtection,
} from "../../scripts/run-phase-72-temporal-operands-protection";
import { loadLocomoCases } from "../../scripts/run-phase-65-locomo-smoke";
import type {
  GoodMemory,
  RecallInput,
} from "../../src/api/contracts";
import { createLanguageService } from "../../src/language";

const CURRENT_ENGLISH_ANALYZER_VERSION = createLanguageService()
  .analyzerVersion("en-US");

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function fakeRecall(input: {
  contentSuffix?: string;
  ids: readonly string[];
  query: string;
  subQueries: readonly string[];
}) {
  return {
    archives: [],
    episodes: [],
    evidence: [],
    facts: input.ids.map((id) => ({
      attributes: id.startsWith("D") ? { diaId: id } : { chatId: Number(id) },
      content: id.startsWith("D")
        ? `[LOCOMO dia_id=${id}] recalled${input.contentSuffix ?? ""}`
        : `[BEAM chat_id=${id}] recalled${input.contentSuffix ?? ""}`,
      id: `fact-${id}`,
    })),
    feedback: [],
    journal: null,
    metadata: {
      candidateTraces: [],
      hits: [],
      latencyMs: 0,
      policyApplied: [],
      retrievalTrace: {
        plan: {},
        queryExecutions: [input.query, ...input.subQueries].map(
          (query, index) => ({
            hops: [{ bridgeEntities: [], factCount: 1, hop: 1, query }],
            query,
            role: index === 0 ? "primary" : "subquery",
            stopReason: "single_pass_complete",
            ...(index === 0 ? {} : { subQueryIndex: index - 1 }),
          }),
        ),
        schemaVersion: 2,
        stopReason: input.subQueries.length > 0
          ? "decomposition_complete"
          : "single_pass_complete",
        subQueries: [...input.subQueries],
      },
      routingDecision: {},
      tokenCount: 0,
      verificationHints: [],
    },
    packet: { factSummary: input.ids.join(",") },
    preferences: [],
    profile: null,
    references: [],
    workingMemory: null,
  };
}

function createFakeMemory(input: {
  calls: Array<{ decompose: boolean; query: string }>;
  driftNegative?: boolean;
  extraNoiseCount?: number;
  loseGold?: boolean;
  treatment: boolean;
}): GoodMemory {
  return {
    async remember() {
      return { accepted: [], ignoredMessageCount: 0 };
    },
    async recall(recallInput: RecallInput) {
      const decompose = recallInput.decompose === true;
      input.calls.push({ decompose, query: recallInput.query });
      const isLocomo = recallInput.query.includes("Alpha") ||
        recallInput.query.includes("database");
      const temporal = recallInput.query.includes("between");
      const primaryId = isLocomo ? "D1:1" : "1";
      const secondaryId = isLocomo ? "D2:1" : "2";
      const noiseIds = Array.from(
        { length: input.extraNoiseCount ?? 0 },
        (_, index) => isLocomo ? `D${index + 3}:1` : String(index + 3),
      );
      const ids = temporal && decompose
        ? input.loseGold
          ? [secondaryId]
          : [primaryId, secondaryId, ...noiseIds]
        : [primaryId];
      const subQueries = decompose
        ? isLocomo
          ? ["Alpha", "Beta"]
          : ["the first deployment", "the second deployment"]
        : [];
      return fakeRecall({
        contentSuffix:
          input.treatment && input.driftNegative && !temporal
            ? " changed"
            : undefined,
        ids,
        query: recallInput.query,
        subQueries,
      });
    },
  } as unknown as GoodMemory;
}

async function fixture() {
  const locomo = {
    cases: [
      {
        caseId: "locomo-1",
        questions: [
          {
            adversarialAnswer: null,
            category: "temporal",
            evidenceTurnIds: ["D1:1", "D2:1"],
            goldAnswer: "two weeks",
            matchMode: "f1_token_overlap",
            question: "How many weeks passed between Alpha and Beta?",
            questionId: "locomo-temporal",
          },
          {
            adversarialAnswer: null,
            category: "multi_hop",
            evidenceTurnIds: ["D1:1"],
            goldAnswer: "PostgreSQL",
            matchMode: "f1_token_overlap",
            question: "Which database is in production?",
            questionId: "locomo-negative",
          },
        ],
        sourceConversation: "conversation-1",
        speakers: ["A", "B"],
        turns: [
          { content: "Alpha happened.", date: "2026-01-01", diaId: "D1:1", speaker: "A" },
          { content: "Beta happened.", date: "2026-01-15", diaId: "D2:1", speaker: "B" },
        ],
      },
    ],
  };
  const locomoRaw = JSON.stringify(locomo);
  const loaded = await loadLocomoCases({
    benchmarkRoot: "/locomo",
    questionCategories: ["temporal", "multi_hop"],
    readFile: async () => locomoRaw,
  });
  const beam = [
    {
      chat: [[
        {
          content: "The first deployment happened.",
          id: 1,
          index: "1,1",
          question_type: "deployment",
          role: "user",
          time_anchor: "January 1, 2026",
        },
        {
          content: "The second deployment happened.",
          id: 2,
          index: "1,2",
          question_type: "deployment",
          role: "assistant",
          time_anchor: "January 8, 2026",
        },
      ]],
      conversation_id: "beam-1",
      conversation_plan: "plan",
      conversation_seed: {
        category: "deployment",
        id: 1,
        subtopics: ["release"],
        theme: "release",
        title: "release",
      },
      narratives: "release",
      probing_questions: {
        temporal_reasoning: [
          {
            answer: "one week",
            evidence_chat_ids: [1, 2],
            question: "How many days passed between the first deployment and the second deployment?",
            question_id: "beam-temporal",
            question_type: "temporal_reasoning",
          },
        ],
        multi_session_reasoning: [
          {
            answer: "the first deployment",
            evidence_chat_ids: [1],
            question: "Which deployment used the release checklist?",
            question_id: "beam-negative",
            question_type: "multi_session_reasoning",
          },
        ],
      },
      user_profile: { user_info: "profile", user_relationships: "none" },
      user_questions: [],
    },
  ];
  const beamRaw = JSON.stringify(beam);
  const profile = {
    budgetProvenance: "fixture development budget",
    budgets: {
      maxAddedNoiseEvidenceIdsPerAddedGoldEndpoint: 1,
      maxQueriesPerCase: 3,
      maxTriggeredContextTokenIncreaseRatio: 2,
      maxTriggeredRecallRecordIncreaseRatio: 1,
    },
    beam: {
      activationQuestionType: "temporal_reasoning",
      datasetParsedSha256: sha256(JSON.stringify(JSON.parse(beamRaw))),
      datasetRawSha256: sha256(beamRaw),
      memoryGroupCount: 1,
      negativeControlQuestionType: "multi_session_reasoning",
      orderedSelectionSha256: sha256(JSON.stringify([
        { conversationId: "beam-1", questionId: "beam-temporal" },
        { conversationId: "beam-1", questionId: "beam-negative" },
      ])),
      questionCount: 2,
      questionTypeCounts: {
        multi_session_reasoning: 1,
        temporal_reasoning: 1,
      },
      scale: "100K",
      temporalTriggerCount: 1,
    },
    frozenBeforeRetrievalExecution: true,
    locomo: {
      activationCategory: "temporal",
      benchmarkFingerprint: loaded.benchmarkFingerprint,
      datasetRawSha256: sha256(locomoRaw),
      memoryGroupCount: 1,
      negativeControlCategory: "multi_hop",
      orderedSelectionSha256: sha256(JSON.stringify([
        { caseId: "locomo-1", questionId: "locomo-temporal" },
        { caseId: "locomo-1", questionId: "locomo-negative" },
      ])),
      questionCategoryCounts: { multi_hop: 1, temporal: 1 },
      questionCount: 2,
      temporalTriggerCount: 1,
    },
    protocol: "phase72_temporal_operands_cross_benchmark_retrieval_protection_v1",
    schemaVersion: 1,
    selectionMethod: "complete activation and negative-control categories",
  };
  const profileRaw = JSON.stringify(profile);
  return { beamRaw, locomoRaw, profile, profileRaw };
}

describe("Phase 72 temporal operand cross-benchmark protection", () => {
  it("rejects the current English analyzer before file I/O canonically", async () => {
    await expect(runPhase72TemporalOperandsProtection({
      beamRoot: "/beam",
      locomoRoot: "/locomo",
      outputDir: "/reports",
      runId: "analyzer-version-fixture",
      selectionFile: "/selection.json",
    })).rejects.toThrow(
      `English analyzer 13 is required; found ${CURRENT_ENGLISH_ANALYZER_VERSION}`,
    );
  });

  it("runs every control before temporal-only treatment and preserves negative controls", async () => {
    const input = await fixture();
    const calls: Array<{ decompose: boolean; query: string }> = [];
    let factoryCalls = 0;
    const createMemory = () => {
      factoryCalls += 1;
      return createFakeMemory({ calls, treatment: factoryCalls > 4 });
    };
    const writes = new Map<string, string>();

    const report = await runPhase72TemporalOperandsProtection({
      beamRoot: "/beam",
      locomoRoot: "/locomo",
      outputDir: "/reports",
      runId: "protection-fixture",
      selectionFile: "/selection.json",
    }, {
      bunVersion: "1.3.14",
      createBeamMemory: createMemory,
      createLocomoMemory: createMemory,
      expectedSelectionSha256: sha256(input.profileRaw),
      async mkdir() {},
      now: () => new Date("2026-07-31T12:00:00.000Z"),
      async readFile(path) {
        if (path === "/locomo/cases.json") return input.locomoRaw;
        if (path === "/beam/100K.json") return input.beamRaw;
        if (path === "/selection.json") return input.profileRaw;
        if (path === "/script.ts") return "fixture script";
        throw new Error(`unexpected read: ${path}`);
      },
      scriptPath: "/script.ts",
      sourceState: {
        commit: "0123456789abcdef0123456789abcdef01234567",
        dirty: false,
        worktreeFingerprint: "a".repeat(64),
      },
      async writeFile(path, value, options) {
        expect(options).toEqual({ flag: "wx" });
        writes.set(path, value);
      },
    });

    expect(factoryCalls).toBe(8);
    expect(calls.map((call) => call.decompose)).toEqual([
      false,
      false,
      false,
      false,
      true,
      false,
      true,
      false,
    ]);
    expect(report.summary).toMatchObject({
      answerConversionAuthorized: false,
      improvedCaseCount: 2,
      lostGoldEndpointCount: 0,
      negativeControlCount: 2,
      negativeControlDriftCount: 0,
      protectionCriteriaPassed: true,
      protectionGatePassed: false,
      questionCount: 4,
      temporalTriggerCount: 2,
    });
    expect(report.cases.filter((result) => result.temporalOperands.length === 0))
      .toSatisfy((results) => results.every((result) =>
        JSON.stringify(result.control) === JSON.stringify(result.treatment)
      ));
    expect(report.source.canonicalDependencies).toBe(false);
    expect(report.source.englishAnalyzerVersion).toBe(
      CURRENT_ENGLISH_ANALYZER_VERSION,
    );
    expect(report.configuration.memoryIsolation).toBe(
      "fresh_seeded_memory_per_question_per_arm",
    );
    expect([...writes.keys()]).toEqual([
      "/reports/protection-fixture/report.json",
    ]);
  });

  it("keeps the protection gate closed when a triggered treatment loses gold", async () => {
    const input = await fixture();
    const calls: Array<{ decompose: boolean; query: string }> = [];
    let factoryCalls = 0;
    const report = await runPhase72TemporalOperandsProtection({
      beamRoot: "/beam",
      locomoRoot: "/locomo",
      outputDir: "/reports",
      runId: "protection-loss-fixture",
      selectionFile: "/selection.json",
    }, {
      bunVersion: "1.3.14",
      createBeamMemory: () => {
        factoryCalls += 1;
        return createFakeMemory({
          calls,
          loseGold: factoryCalls > 4,
          treatment: factoryCalls > 4,
        });
      },
      createLocomoMemory: () => {
        factoryCalls += 1;
        return createFakeMemory({
          calls,
          loseGold: factoryCalls > 4,
          treatment: factoryCalls > 4,
        });
      },
      expectedSelectionSha256: sha256(input.profileRaw),
      async mkdir() {},
      async readFile(path) {
        if (path === "/locomo/cases.json") return input.locomoRaw;
        if (path === "/beam/100K.json") return input.beamRaw;
        if (path === "/selection.json") return input.profileRaw;
        if (path === "/script.ts") return "fixture script";
        throw new Error(`unexpected read: ${path}`);
      },
      scriptPath: "/script.ts",
      sourceState: {
        commit: "0123456789abcdef0123456789abcdef01234567",
        dirty: false,
        worktreeFingerprint: "a".repeat(64),
      },
      async writeFile() {},
    });

    expect(report.summary).toMatchObject({
      lostGoldEndpointCount: 2,
      protectionCriteriaPassed: false,
      protectionGatePassed: false,
      regressedCaseCount: 2,
    });
  });

  it("fails closed when a non-trigger treatment changes recalled record content", async () => {
    const input = await fixture();
    const calls: Array<{ decompose: boolean; query: string }> = [];
    let factoryCalls = 0;
    const createMemory = () => {
      factoryCalls += 1;
      return createFakeMemory({
        calls,
        driftNegative: factoryCalls > 4,
        treatment: factoryCalls > 4,
      });
    };

    await expect(runPhase72TemporalOperandsProtection({
      beamRoot: "/beam",
      locomoRoot: "/locomo",
      outputDir: "/reports",
      runId: "protection-drift-fixture",
      selectionFile: "/selection.json",
    }, {
      bunVersion: "1.3.14",
      createBeamMemory: createMemory,
      createLocomoMemory: createMemory,
      expectedSelectionSha256: sha256(input.profileRaw),
      async mkdir() {},
      async readFile(path) {
        if (path === "/locomo/cases.json") return input.locomoRaw;
        if (path === "/beam/100K.json") return input.beamRaw;
        if (path === "/selection.json") return input.profileRaw;
        if (path === "/script.ts") return "fixture script";
        throw new Error(`unexpected read: ${path}`);
      },
      scriptPath: "/script.ts",
      sourceState: {
        commit: "0123456789abcdef0123456789abcdef01234567",
        dirty: false,
        worktreeFingerprint: "a".repeat(64),
      },
      async writeFile() {},
    })).rejects.toThrow("Non-temporal treatment drift");
  });

  it("applies the frozen noise ratio independently to each benchmark", async () => {
    const input = await fixture();
    const profile = {
      ...input.profile,
      budgets: {
        ...input.profile.budgets,
        maxTriggeredRecallRecordIncreaseRatio: 10,
      },
    };
    const profileRaw = JSON.stringify(profile);
    const calls: Array<{ decompose: boolean; query: string }> = [];
    let factoryCalls = 0;
    const createMemory = () => {
      factoryCalls += 1;
      return createFakeMemory({
        calls,
        extraNoiseCount: factoryCalls > 4 ? 2 : 0,
        treatment: factoryCalls > 4,
      });
    };
    const report = await runPhase72TemporalOperandsProtection({
      beamRoot: "/beam",
      locomoRoot: "/locomo",
      outputDir: "/reports",
      runId: "protection-noise-fixture",
      selectionFile: "/selection.json",
    }, {
      bunVersion: "1.3.14",
      createBeamMemory: createMemory,
      createLocomoMemory: createMemory,
      expectedSelectionSha256: sha256(profileRaw),
      async mkdir() {},
      async readFile(path) {
        if (path === "/locomo/cases.json") return input.locomoRaw;
        if (path === "/beam/100K.json") return input.beamRaw;
        if (path === "/selection.json") return profileRaw;
        if (path === "/script.ts") return "fixture script";
        throw new Error(`unexpected read: ${path}`);
      },
      scriptPath: "/script.ts",
      sourceState: {
        commit: "0123456789abcdef0123456789abcdef01234567",
        dirty: false,
        worktreeFingerprint: "a".repeat(64),
      },
      async writeFile() {},
    });

    expect(report.summary).toMatchObject({
      addedGoldEndpointCount: 2,
      addedNoiseEvidenceCount: 4,
      addedNoiseEvidenceIdsPerAddedGoldEndpoint: 2,
      protectionCriteriaPassed: false,
      protectionGatePassed: false,
    });
    expect(report.summary.benchmarks.locomo.protectionCriteriaPassed).toBe(false);
    expect(report.summary.benchmarks.beam.protectionCriteriaPassed).toBe(false);
  });

  it("executes the shipped deterministic memories with the same bounded routing", async () => {
    const input = await fixture();
    const report = await runPhase72TemporalOperandsProtection({
      beamRoot: "/beam",
      locomoRoot: "/locomo",
      outputDir: "/reports",
      runId: "protection-real-memory-fixture",
      selectionFile: "/selection.json",
    }, {
      bunVersion: "1.3.14",
      expectedSelectionSha256: sha256(input.profileRaw),
      async mkdir() {},
      async readFile(path) {
        if (path === "/locomo/cases.json") return input.locomoRaw;
        if (path === "/beam/100K.json") return input.beamRaw;
        if (path === "/selection.json") return input.profileRaw;
        if (path === "/script.ts") return "fixture script";
        throw new Error(`unexpected read: ${path}`);
      },
      scriptPath: "/script.ts",
      sourceState: {
        commit: "0123456789abcdef0123456789abcdef01234567",
        dirty: false,
        worktreeFingerprint: "a".repeat(64),
      },
      async writeFile() {},
    });

    expect(report.summary).toMatchObject({
      controlQueryCalls: 4,
      negativeControlCount: 2,
      negativeControlDriftCount: 0,
      questionCount: 4,
      temporalTriggerCount: 2,
      treatmentQueryCalls: 8,
    });
  });
});
