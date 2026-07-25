import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import type { GoodMemory } from "../../src/api/contracts";
import { inspectGoodMemoryRuntime } from "../../src/api/runtimeInfo";
import type { LocomoCase } from "../../src/eval/locomo";
import { assertLocomoReportQuestionCountMatchesCases } from "../../scripts/locomo-report-compatibility";
import {
  buildLocomoPrompt,
  buildLocomoRecalledContext,
  buildLocomoScope,
  buildLocomoSystemPrompt,
  collectLocomoRetrievedTurnIds,
  createLocomoSmokeMemory,
  locomoFactTurnOverlap,
  otherLocomoSpeaker,
  resolveSpeakerCoref,
  loadLocomoCases,
  LOCOMO_PROVIDER_EMBEDDING_RUN_TIMEOUT_MS_ENV,
  LOCOMO_PROVIDER_EMBEDDING_TIMEOUT_MS_ENV,
  LOCOMO_ROOT_ENV,
  LOCOMO_SMOKE_REPORT_FILE_NAME,
  locomoQuestionKey,
  parseLocomoSmokeCliOptions,
  readLocomoProgressRowsForSelection,
  parseLocomoQuestionIdsFile,
  resolveLocomoQuestionIds,
  runLocomoSmoke,
  scoreLocomoRetrieval,
  seedLocomoCase,
  seedLocomoCaseConversational,
  summarizeLocomoRetrieval,
  wrapMemoryExtractorWithJsonlCache,
  type LocomoQuestionRetrieval,
} from "../../scripts/run-phase-65-locomo-smoke";
import type { MemoryExtractor } from "../../src/remember/candidates";

function category(
  report: Awaited<ReturnType<typeof runLocomoSmoke>>,
  name: string,
) {
  const entry = report.categories.find((item) => item.category === name);
  if (!entry) {
    throw new Error(`category not found in report: ${name}`);
  }
  return entry;
}

function locomoProgressRow(
  overrides: Partial<LocomoQuestionRetrieval> = {},
): LocomoQuestionRetrieval {
  return {
    answerCorrect: null,
    caseId: "c1",
    category: "single_hop",
    evidenceRecall: 1,
    evidenceTurnIds: ["D1:1"],
    generatedAnswer: null,
    goldEvidenceFullyRetrieved: true,
    missingEvidenceTurnIds: [],
    noiseTurnCount: 0,
    noiseTurnIds: [],
    questionId: "q1",
    retrievedTurnIds: ["D1:1"],
    ...overrides,
  };
}

describe("phase-65 LoCoMo smoke adapter", () => {
  it("parses smoke cli flags and rejects a non-positive limit", () => {
    expect(
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--benchmark-root",
        "/tmp/LOCOMO",
        "--run-id",
        "run-locomo",
        "--output-dir",
        "/tmp/out",
        "--limit",
        "2",
        "--label-free-ingest",
      ]),
    ).toEqual({
      allowCommonsenseResolution: false,
      answerFromPacket: false,
      answerFromRecalled: false,
      benchmarkRoot: "/tmp/LOCOMO",
      bm25: false,
      generalizedFusion: false,
      labelFreeIngest: true,
      caseIds: undefined,
      concurrency: undefined,
      conversationalExtraction: false,
      corefNormalize: false,
      decompose: false,
      evidencePack: false,
      fusionMinRelativeStrength: undefined,
      limit: 2,
      live: false,
      multiHop: false,
        outputDir: "/tmp/out",
        providerEmbedding: false,
        providerEmbeddingRunTimeoutMs: undefined,
        providerEmbeddingTimeoutMs: undefined,
        providerReranking: false,
        providerRerankingTimeoutMs: undefined,
        questionIdFile: undefined,
        questionIds: undefined,
        questionCategories: undefined,
        repairJobDiagnoses: undefined,
        repairJobRetrievalBuckets: undefined,
        rerank: false,
        resume: false,
        retrievalCues: false,
        runId: "run-locomo",
        semanticCandidateMaxAdditions: undefined,
        semanticCandidateMinSimilarity: undefined,
        semanticCandidateMinRelativeScore: undefined,
        semanticCandidates: false,
        semanticCandidateTopK: undefined,
        smartFusion: false,
        strictNoEvidenceAbstention: false,
      });

    expect(
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--case-id",
        "locomo-conv-30, locomo-conv-41",
        "--case-id",
        "locomo-conv-42",
      ]).caseIds,
    ).toEqual(["locomo-conv-30", "locomo-conv-41", "locomo-conv-42"]);

    expect(
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--category",
        "adversarial, open_domain",
        "--category",
        "multi_hop",
      ]).questionCategories,
    ).toEqual(["adversarial", "open_domain", "multi_hop"]);

    expect(
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--question-id",
        "conv-42:q60, conv-43:q32",
        "--question-id",
        "conv-48:q75",
      ]).questionIds,
    ).toEqual(["conv-42:q60", "conv-43:q32", "conv-48:q75"]);

    expect(
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--question-id-file",
        "/tmp/candidate-admission-slice.json",
      ]).questionIdFile,
    ).toBe("/tmp/candidate-admission-slice.json");

    const repairJobSelection = parseLocomoSmokeCliOptions([
      "bun",
      "run",
      "scripts/run-phase-65-locomo-smoke.ts",
      "--question-id-file",
      "near-miss-label-analysis.json",
      "--repair-job-diagnosis",
      "rationale-bearing-gold-answer, balanced-partial-overlap",
      "--repair-job-retrieval-bucket",
      "full",
    ]);
    expect(repairJobSelection.repairJobDiagnoses).toEqual([
      "rationale-bearing-gold-answer",
      "balanced-partial-overlap",
    ]);
    expect(repairJobSelection.repairJobRetrievalBuckets).toEqual(["full"]);

    expect(() =>
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--benchmark-root",
        "--run-id",
        "locomo-run",
      ]),
    ).toThrow("--benchmark-root requires a value.");

    expect(() =>
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--question-id-file",
        "--run-id",
        "locomo-run",
      ]),
    ).toThrow("--question-id-file requires a value.");

    expect(() =>
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--repair-job-diagnosis",
        "rationale-bearing-gold-answer",
      ]),
    ).toThrow("--repair-job-diagnosis requires --question-id-file.");

    expect(() =>
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--question-id-file",
        "near-miss-label-analysis.json",
        "--repair-job-diagnosis",
        "typo",
      ]),
    ).toThrow(
      "--repair-job-diagnosis must be one of: balanced-partial-overlap, numeric-or-frequency-format, over-specified-answer, rationale-bearing-gold-answer, under-specified-answer, zero-token-overlap.",
    );

    expect(() =>
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--question-id-file",
        "near-miss-label-analysis.json",
        "--repair-job-retrieval-bucket",
        "missing",
      ]),
    ).toThrow("--repair-job-retrieval-bucket must be one of: full, partial, zero.");

    expect(() =>
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--output-dir",
        "--run-id",
        "locomo-run",
      ]),
    ).toThrow("--output-dir requires a value.");

    expect(() =>
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--run-id",
        "--bm25",
      ]),
    ).toThrow("--run-id requires a value.");

    expect(() =>
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--run-id",
        "../outside-locomo",
      ]),
    ).toThrow("--run-id must be a single path segment.");

    const originalRoot = process.env[LOCOMO_ROOT_ENV];
    try {
      process.env[LOCOMO_ROOT_ENV] = "/tmp/LOCOMO-env";
      expect(
        parseLocomoSmokeCliOptions([
          "bun",
          "run",
          "scripts/run-phase-65-locomo-smoke.ts",
        ]).benchmarkRoot,
      ).toBe("/tmp/LOCOMO-env");

      expect(
        parseLocomoSmokeCliOptions([
          "bun",
          "run",
          "scripts/run-phase-65-locomo-smoke.ts",
          "--benchmark-root",
          "/tmp/LOCOMO-cli",
        ]).benchmarkRoot,
      ).toBe("/tmp/LOCOMO-cli");

      process.env[LOCOMO_ROOT_ENV] = " /tmp/LOCOMO-env ";
      expect(() =>
        parseLocomoSmokeCliOptions([
          "bun",
          "run",
          "scripts/run-phase-65-locomo-smoke.ts",
        ]),
      ).toThrow("GOODMEMORY_LOCOMO_ROOT cannot be empty or whitespace-padded.");

      process.env[LOCOMO_ROOT_ENV] = "";
      expect(() =>
        parseLocomoSmokeCliOptions([
          "bun",
          "run",
          "scripts/run-phase-65-locomo-smoke.ts",
        ]),
      ).toThrow("GOODMEMORY_LOCOMO_ROOT cannot be empty or whitespace-padded.");
    } finally {
      if (originalRoot === undefined) {
        delete process.env[LOCOMO_ROOT_ENV];
      } else {
        process.env[LOCOMO_ROOT_ENV] = originalRoot;
      }
    }

    expect(
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--live",
        "--allow-commonsense-resolution",
      ]).allowCommonsenseResolution,
    ).toBe(true);

    expect(() =>
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--allow-commonsense-resolution",
      ]),
    ).toThrow("--allow-commonsense-resolution requires --live");

    expect(
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--live",
        "--strict-no-evidence-abstention",
      ]).strictNoEvidenceAbstention,
    ).toBe(true);

    expect(() =>
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--strict-no-evidence-abstention",
      ]),
    ).toThrow("--strict-no-evidence-abstention requires --live");

    expect(
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--live",
        "--answer-from-recalled",
      ]).answerFromRecalled,
    ).toBe(true);

    expect(() =>
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--answer-from-recalled",
      ]),
    ).toThrow("--answer-from-recalled requires --live");

    expect(
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--live",
        "--evidence-pack",
      ]).evidencePack,
    ).toBe(true);

    expect(() =>
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--evidence-pack",
      ]),
    ).toThrow("--evidence-pack requires --live");

    expect(
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--resume",
      ]).resume,
    ).toBe(true);

    expect(
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--conversational-extraction",
      ]).conversationalExtraction,
    ).toBe(true);

    expect(
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--bm25",
      ]).bm25,
    ).toBe(true);

    expect(
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--provider-embedding",
      ]).providerEmbedding,
    ).toBe(true);

    expect(
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--provider-reranking",
        "--provider-reranking-timeout-ms",
        "60000",
      ]),
    ).toMatchObject({
      providerReranking: true,
      providerRerankingTimeoutMs: 60000,
    });

    expect(() =>
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--provider-reranking-timeout-ms",
        "60000",
      ]),
    ).toThrow("--provider-reranking-timeout-ms requires --provider-reranking");

    expect(
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--provider-embedding",
        "--provider-embedding-run-timeout-ms",
        "60000",
      ]).providerEmbeddingRunTimeoutMs,
    ).toBe(60000);

    expect(() =>
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--provider-embedding-run-timeout-ms",
        "60000",
      ]),
    ).toThrow("--provider-embedding-run-timeout-ms requires --provider-embedding");

    expect(() =>
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--provider-embedding",
        "--provider-embedding-run-timeout-ms",
        "0",
      ]),
    ).toThrow("--provider-embedding-run-timeout-ms must be a positive integer");

    expect(
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--provider-embedding",
        "--provider-embedding-timeout-ms",
        "12000",
      ]).providerEmbeddingTimeoutMs,
    ).toBe(12000);

    expect(() =>
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--provider-embedding-timeout-ms",
        "12000",
      ]),
    ).toThrow("--provider-embedding-timeout-ms requires --provider-embedding");

    expect(() =>
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--provider-embedding",
        "--provider-embedding-timeout-ms",
        "0",
      ]),
    ).toThrow("--provider-embedding-timeout-ms must be a positive integer");

    const timeoutSnapshot =
      process.env[LOCOMO_PROVIDER_EMBEDDING_TIMEOUT_MS_ENV];
    const runTimeoutSnapshot =
      process.env[LOCOMO_PROVIDER_EMBEDDING_RUN_TIMEOUT_MS_ENV];
    process.env[LOCOMO_PROVIDER_EMBEDDING_TIMEOUT_MS_ENV] = "9000";
    process.env[LOCOMO_PROVIDER_EMBEDDING_RUN_TIMEOUT_MS_ENV] = "70000";
    try {
      expect(
        parseLocomoSmokeCliOptions([
          "bun",
          "run",
          "scripts/run-phase-65-locomo-smoke.ts",
        ]).providerEmbeddingTimeoutMs,
      ).toBeUndefined();
      expect(
        parseLocomoSmokeCliOptions([
          "bun",
          "run",
          "scripts/run-phase-65-locomo-smoke.ts",
        ]).providerEmbeddingRunTimeoutMs,
      ).toBeUndefined();
      expect(
        parseLocomoSmokeCliOptions([
          "bun",
          "run",
          "scripts/run-phase-65-locomo-smoke.ts",
          "--provider-embedding",
        ]).providerEmbeddingTimeoutMs,
      ).toBe(9000);
      expect(
        parseLocomoSmokeCliOptions([
          "bun",
          "run",
          "scripts/run-phase-65-locomo-smoke.ts",
          "--provider-embedding",
        ]).providerEmbeddingRunTimeoutMs,
      ).toBe(70000);
    } finally {
      if (timeoutSnapshot === undefined) {
        delete process.env[LOCOMO_PROVIDER_EMBEDDING_TIMEOUT_MS_ENV];
      } else {
        process.env[LOCOMO_PROVIDER_EMBEDDING_TIMEOUT_MS_ENV] =
          timeoutSnapshot;
      }
      if (runTimeoutSnapshot === undefined) {
        delete process.env[LOCOMO_PROVIDER_EMBEDDING_RUN_TIMEOUT_MS_ENV];
      } else {
        process.env[LOCOMO_PROVIDER_EMBEDDING_RUN_TIMEOUT_MS_ENV] =
          runTimeoutSnapshot;
      }
    }

    expect(
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--semantic-candidates",
        "--semantic-candidate-top-k",
        "8",
        "--semantic-candidate-max-additions",
        "2",
        "--semantic-candidate-min-similarity",
        "0.7",
        "--semantic-candidate-min-relative-score",
        "0.8",
      ]),
    ).toMatchObject({
      semanticCandidateMaxAdditions: 2,
      semanticCandidateMinSimilarity: 0.7,
      semanticCandidateMinRelativeScore: 0.8,
      semanticCandidates: true,
      semanticCandidateTopK: 8,
    });

    expect(() =>
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--semantic-candidate-top-k",
        "8",
      ]),
    ).toThrow("--semantic-candidate-top-k requires --semantic-candidates");

    expect(() =>
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--limit",
        "0",
      ]),
    ).toThrow("--limit must be a positive integer.");

    expect(() =>
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--limit",
        "1e2",
      ]),
    ).toThrow("--limit must be a positive integer.");

    expect(() =>
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--limit",
        "--bm25",
      ]),
    ).toThrow("--limit requires a value.");

    expect(() =>
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--limit",
        "10",
        "--limit",
        "20",
      ]),
    ).toThrow("--limit cannot be specified more than once.");

    expect(() =>
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--semantic-candidate-top-k",
        "1e2",
      ]),
    ).toThrow("--semantic-candidate-top-k must be a positive integer.");

    expect(() =>
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--semantic-candidate-top-k",
        "--semantic-candidates",
      ]),
    ).toThrow("--semantic-candidate-top-k requires a value.");

    expect(() =>
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--semantic-candidate-max-additions",
        "-1",
      ]),
    ).toThrow("--semantic-candidate-max-additions must be a non-negative integer.");

    expect(() =>
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--semantic-candidate-max-additions",
        "1e2",
      ]),
    ).toThrow("--semantic-candidate-max-additions must be a non-negative integer.");

    expect(() =>
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--semantic-candidate-min-similarity",
        "8e-1",
      ]),
    ).toThrow("--semantic-candidate-min-similarity must be a non-negative number.");

    expect(() =>
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--semantic-candidate-min-relative-score",
        "8e-1",
      ]),
    ).toThrow(
      "--semantic-candidate-min-relative-score must be greater than 0 and at most 1.",
    );

    expect(() =>
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--case-id",
        "locomo-conv-30,locomo-conv-30",
      ]),
    ).toThrow("--case-id contains duplicate value locomo-conv-30.");

    expect(() =>
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--category",
        "single_hop",
        "--category",
        "single_hop",
      ]),
    ).toThrow("--category contains duplicate value single_hop.");

    expect(() =>
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--live",
        "--live",
      ]),
    ).toThrow("--live cannot be specified more than once.");

    expect(() =>
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--semantic-candidates",
        "--semantic-candidates",
      ]),
    ).toThrow("--semantic-candidates cannot be specified more than once.");

    expect(() =>
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--case-id",
        "--bm25",
      ]),
    ).toThrow("--case-id requires a value.");

    expect(() =>
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--case-id",
        "locomo-conv-30,,locomo-conv-41",
      ]),
    ).toThrow("--case-id contains an empty value.");

    expect(() =>
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--question-id",
        "conv-42:q60,",
      ]),
    ).toThrow("--question-id contains an empty value.");

    expect(() =>
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--category",
        ",",
      ]),
    ).toThrow("--category contains an empty value.");

    expect(() =>
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--category",
        "unsupported",
      ]),
    ).toThrow(
      "--category must be one of: single_hop, multi_hop, temporal, open_domain, adversarial.",
    );

    expect(() =>
      parseLocomoSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-65-locomo-smoke.ts",
        "--category",
        "--bm25",
      ]),
    ).toThrow("--category requires a value.");
  });

  it("parses question-id files from text and Phase 65 manifest JSON", () => {
    expect(
      parseLocomoQuestionIdsFile("conv-42:q60\nconv-43:q32, conv-48:q75", "ids.txt"),
    ).toEqual(["conv-42:q60", "conv-43:q32", "conv-48:q75"]);

    expect(() =>
      parseLocomoQuestionIdsFile("conv-42:q60,,conv-43:q32", "ids.txt"),
    ).toThrow("text list contains empty question id entry");

    expect(
      parseLocomoQuestionIdsFile(
        JSON.stringify({
          categories: {
            open_domain: { questionIds: ["conv-42:q60", "conv-43:q32"] },
          },
          repairJobs: [
            {
              questionIds: ["conv-42:q60", "conv-48:q75"],
            },
          ],
          reanswerJobs: [
            {
              questionIds: ["conv-50:q7"],
            },
          ],
        }),
        "candidate-admission-slice.json",
      ),
    ).toEqual(["conv-42:q60", "conv-48:q75", "conv-50:q7", "conv-43:q32"]);

    expect(() =>
      parseLocomoQuestionIdsFile(JSON.stringify({ repairJobs: [] }), "empty.json"),
    ).toThrow("did not contain questionIds");
  });

  it("filters manifest repair jobs by diagnosis and retrieval bucket", () => {
    const manifest = JSON.stringify({
      questionIds: ["conv-26:q64", "conv-42:q60", "conv-26:q22", "conv-26:q30"],
      overall: {
        selectedQuestionCount: 4,
      },
      repairJobs: [
        {
          diagnosis: "rationale-bearing-gold-answer",
          questionCount: 3,
          questionIds: ["conv-26:q64", "conv-42:q60", "conv-26:q22"],
          retrievalBucket: "full",
        },
        {
          diagnosis: "balanced-partial-overlap",
          questionCount: 1,
          questionIds: ["conv-26:q30"],
          retrievalBucket: "full",
        },
        {
          diagnosis: "rationale-bearing-gold-answer",
          questionCount: 1,
          questionIds: ["conv-15:q12"],
          retrievalBucket: "partial",
        },
      ],
    });

    expect(
      parseLocomoQuestionIdsFile(
        manifest,
        "near-miss-label-analysis.json",
        {
          preferManifestJobKeys: ["repairJobs"],
          repairJobDiagnoses: ["rationale-bearing-gold-answer"],
          repairJobRetrievalBuckets: ["full"],
        },
      ),
    ).toEqual(["conv-26:q64", "conv-42:q60", "conv-26:q22"]);

    expect(
      parseLocomoQuestionIdsFile(
        manifest,
        "near-miss-label-analysis.json",
        {
          preferManifestJobKeys: ["repairJobs"],
          repairJobRetrievalBuckets: ["full"],
        },
      ),
    ).toEqual(["conv-26:q64", "conv-42:q60", "conv-26:q22", "conv-26:q30"]);
  });

  it("rejects malformed manifest selections before targeted smoke replay", () => {
    expect(() =>
      parseLocomoQuestionIdsFile(
        JSON.stringify(["conv-42:q60", 42]),
        "ids.json",
      ),
    ).toThrow("JSON array questionIds contains non-string value at index 1");

    expect(() =>
      parseLocomoQuestionIdsFile(
        JSON.stringify(["conv-42:q60", ""]),
        "ids.json",
      ),
    ).toThrow("JSON array questionIds contains empty string at index 1");

    expect(() =>
      parseLocomoQuestionIdsFile(
        JSON.stringify(["conv-42:q60 "]),
        "ids.json",
      ),
    ).toThrow(
      "JSON array questionIds contains leading or trailing whitespace at index 0",
    );

    expect(() =>
      parseLocomoQuestionIdsFile(
        JSON.stringify(["conv-42:q60", "conv-42:q60"]),
        "ids.json",
      ),
    ).toThrow("JSON array has duplicate question id conv-42:q60");

    expect(() =>
      parseLocomoQuestionIdsFile(
        JSON.stringify({
          questionIds: ["conv-42:q60", "conv-42:q60"],
        }),
        "ids.json",
      ),
    ).toThrow("top-level has duplicate question id conv-42:q60");

    expect(() =>
      parseLocomoQuestionIdsFile(
        JSON.stringify({
          questionIds: ["conv-42:q60", " "],
        }),
        "ids.json",
      ),
    ).toThrow("top-level questionIds contains empty string at index 1");

    expect(() =>
      parseLocomoQuestionIdsFile("conv-42:q60\nconv-42:q60", "ids.txt"),
    ).toThrow("text list has duplicate question id conv-42:q60");

    expect(() =>
      parseLocomoQuestionIdsFile(
        JSON.stringify({
          repairJobs: [
            {
              questionCount: 1,
              questionIds: ["conv-42:q60", 42],
            },
          ],
        }),
        "candidate-admission-slice.json",
      ),
    ).toThrow("repairJobs questionIds contains non-string value at index 1");

    expect(() =>
      parseLocomoQuestionIdsFile(
        JSON.stringify({
          questionIds: ["conv-40:q1"],
          repairJobs: {
            questionIds: ["conv-42:q60"],
          },
        }),
        "candidate-admission-slice.json",
      ),
    ).toThrow("repairJobs must be an array");

    expect(() =>
      parseLocomoQuestionIdsFile(
        JSON.stringify({
          questionIds: ["conv-40:q1"],
          reanswerJobs: {
            questionIds: ["conv-42:q60"],
          },
        }),
        "candidate-admission-slice.json",
      ),
    ).toThrow("reanswerJobs must be an array");

    expect(() =>
      parseLocomoQuestionIdsFile(
        JSON.stringify({
          repairJobs: [null],
        }),
        "candidate-admission-slice.json",
      ),
    ).toThrow("repairJobs entry at index 0 must be an object");

    expect(() =>
      parseLocomoQuestionIdsFile(
        JSON.stringify({
          reanswerJobs: ["conv-42:q60"],
        }),
        "candidate-admission-slice.json",
      ),
    ).toThrow("reanswerJobs entry at index 0 must be an object");

    expect(() =>
      parseLocomoQuestionIdsFile(
        JSON.stringify({
          repairJobs: [
            {
              questionCount: 2,
              questionIds: ["conv-42:q60"],
            },
          ],
        }),
        "candidate-admission-slice.json",
      ),
    ).toThrow("repairJobs questionCount 2 does not match 1 questionIds");

    expect(() =>
      parseLocomoQuestionIdsFile(
        JSON.stringify({
          repairJobs: [
            {
              questionCount: 2,
              questionIds: ["conv-42:q60", "conv-42:q60"],
            },
          ],
        }),
        "candidate-admission-slice.json",
      ),
    ).toThrow("repairJobs has duplicate question id conv-42:q60");

    expect(() =>
      parseLocomoQuestionIdsFile(
        JSON.stringify({
          repairJobs: [
            {
              questionCount: 1,
              questionIds: [" conv-42:q60"],
            },
          ],
        }),
        "candidate-admission-slice.json",
      ),
    ).toThrow(
      "repairJobs questionIds contains leading or trailing whitespace at index 0",
    );

    expect(() =>
      parseLocomoQuestionIdsFile(
        JSON.stringify({
          repairJobs: [
            {
              questionCount: 1,
              questionIds: ["conv-42:q60"],
            },
            {
              questionCount: 1,
              questionIds: ["conv-42:q60"],
            },
          ],
        }),
        "candidate-admission-slice.json",
      ),
    ).toThrow(
      "repairJobs selected duplicate question id conv-42:q60 across jobs",
    );

    expect(
      parseLocomoQuestionIdsFile(
        JSON.stringify({
          repairJobs: [
            {
              questionCount: 1,
              questionIds: ["conv-42:q60"],
            },
          ],
          reanswerJobs: [
            {
              questionCount: 1,
              questionIds: ["conv-42:q60"],
            },
          ],
        }),
        "candidate-admission-slice.json",
      ),
    ).toEqual(["conv-42:q60"]);

    expect(() =>
      parseLocomoQuestionIdsFile(
        JSON.stringify({
          categories: {
            open_domain: {
              questionCount: 2,
              questionIds: ["conv-42:q60"],
            },
          },
        }),
        "candidate-admission-slice.json",
      ),
    ).toThrow("category questionCount 2 does not match 1 questionIds");

    expect(() =>
      parseLocomoQuestionIdsFile(
        JSON.stringify({
          categories: [
            {
              questionIds: ["conv-42:q60"],
            },
          ],
          questionIds: ["conv-40:q1"],
        }),
        "candidate-admission-slice.json",
      ),
    ).toThrow("categories must be an object");

    expect(() =>
      parseLocomoQuestionIdsFile(
        JSON.stringify({
          categories: {
            open_domain: null,
          },
        }),
        "candidate-admission-slice.json",
      ),
    ).toThrow("category open_domain must be an object");

    expect(() =>
      parseLocomoQuestionIdsFile(
        JSON.stringify({
          categories: {
            typo_category: {
              questionIds: ["conv-42:q60"],
            },
          },
        }),
        "candidate-admission-slice.json",
      ),
    ).toThrow("category typo_category is not recognized");

    expect(() =>
      parseLocomoQuestionIdsFile(
        JSON.stringify({
          categories: {
            typo_category: {
              questionIds: ["conv-99:q1"],
            },
          },
          reanswerJobs: [
            {
              questionIds: ["conv-42:q60"],
            },
          ],
        }),
        "candidate-admission-slice.json",
        { preferManifestJobKeys: ["reanswerJobs"] },
      ),
    ).toThrow("category typo_category is not recognized");

    expect(() =>
      parseLocomoQuestionIdsFile(
        JSON.stringify({
          overall: [],
          questionIds: ["conv-42:q60"],
        }),
        "candidate-admission-slice.json",
      ),
    ).toThrow("overall must be an object");

    expect(() =>
      parseLocomoQuestionIdsFile(
        JSON.stringify({
          categories: {
            open_domain: {
              questionCount: 2,
              questionIds: ["conv-42:q60", "conv-42:q60"],
            },
          },
        }),
        "candidate-admission-slice.json",
      ),
    ).toThrow("category has duplicate question id conv-42:q60");

    expect(() =>
      parseLocomoQuestionIdsFile(
        JSON.stringify({
          categories: {
            multi_hop: {
              questionCount: 1,
              questionIds: ["conv-42:q60"],
            },
            open_domain: {
              questionCount: 1,
              questionIds: ["conv-42:q60"],
            },
          },
        }),
        "candidate-admission-slice.json",
      ),
    ).toThrow(
      "categories selected duplicate question id conv-42:q60 across categories",
    );

    expect(() =>
      parseLocomoQuestionIdsFile(
        JSON.stringify({
          categories: {
            open_domain: {
              questionCount: 1,
              questionIds: ["conv-42:q60"],
            },
          },
          overall: {
            selectedQuestionCount: 2,
          },
        }),
        "candidate-admission-slice.json",
      ),
    ).toThrow(
      "overall.selectedQuestionCount 2 does not match 1 category questionIds",
    );

    expect(
      parseLocomoQuestionIdsFile(
        JSON.stringify({
          categories: {
            open_domain: {
              questionCount: 1,
              questionIds: ["conv-42:q60"],
            },
          },
          overall: {
            selectedQuestionCount: 1,
          },
        }),
        "candidate-admission-slice.json",
      ),
    ).toEqual(["conv-42:q60"]);

    expect(
      parseLocomoQuestionIdsFile(
        JSON.stringify({
          categories: {
            open_domain: {
              questionCount: 1,
              questionIds: ["conv-42:q60"],
            },
          },
          overall: {
            selectedQuestionCount: 1,
          },
          repairJobs: [
            {
              questionIds: ["conv-42:q60", "conv-43:q32"],
            },
          ],
        }),
        "candidate-admission-slice.json",
      ),
    ).toEqual(["conv-42:q60", "conv-43:q32"]);

    expect(() =>
      parseLocomoQuestionIdsFile(
        JSON.stringify({
          categories: {
            open_domain: {
              questionCount: 1,
              questionIds: ["conv-42:q60"],
            },
          },
          questionIds: ["conv-43:q32"],
        }),
        "near-miss-label-analysis.json",
      ),
    ).toThrow(
      "top-level questionIds do not match category questionIds",
    );

    expect(() =>
      parseLocomoQuestionIdsFile(
        JSON.stringify({
          overall: {
            selectedQuestionCount: 2,
          },
          questionIds: ["conv-42:q60"],
        }),
        "near-miss-label-analysis.json",
      ),
    ).toThrow(
      "overall.selectedQuestionCount 2 does not match 1 top-level questionIds",
    );

    expect(() =>
      parseLocomoQuestionIdsFile(
        JSON.stringify({
          overall: {
            selectedQuestionCount: 2,
          },
          repairJobs: [
            {
              questionCount: 1,
              questionIds: ["conv-42:q60"],
            },
          ],
        }),
        "candidate-admission-slice.json",
      ),
    ).toThrow(
      "overall.selectedQuestionCount 2 does not match 1 repair/reanswer questionIds",
    );

    expect(() =>
      parseLocomoQuestionIdsFile(
        JSON.stringify({
          overall: {
            selectedQuestionCount: 1,
          },
          repairJobs: [],
        }),
        "candidate-admission-slice.json",
      ),
    ).toThrow(
      "overall.selectedQuestionCount 1 does not match 0 repair/reanswer questionIds",
    );

    expect(() =>
      parseLocomoQuestionIdsFile(
        JSON.stringify({
          overall: {
            selectedQuestionCount: 2,
          },
          reanswerJobs: [
            {
              questionIds: ["conv-42:q60"],
            },
          ],
        }),
        "live-delta.json",
        { preferManifestJobKeys: ["reanswerJobs"] },
      ),
    ).toThrow(
      "overall.selectedQuestionCount 2 does not match 1 preferred reanswerJobs questionIds",
    );

    expect(() =>
      parseLocomoQuestionIdsFile(
        JSON.stringify({
          overall: {
            selectedQuestionCount: 2,
          },
          questionIds: [],
          reanswerJobs: [
            {
              questionIds: ["conv-42:q60"],
            },
          ],
        }),
        "live-delta.json",
        { preferManifestJobKeys: ["reanswerJobs"] },
      ),
    ).toThrow(
      "overall.selectedQuestionCount 2 does not match 1 preferred reanswerJobs questionIds",
    );

    expect(() =>
      parseLocomoQuestionIdsFile(
        JSON.stringify({
          questionIds: [" conv-99:q1"],
          reanswerJobs: [
            {
              questionIds: ["conv-42:q60"],
            },
          ],
        }),
        "live-delta.json",
        { preferManifestJobKeys: ["reanswerJobs"] },
      ),
    ).toThrow(
      "top-level questionIds contains leading or trailing whitespace at index 0",
    );

    expect(() =>
      parseLocomoQuestionIdsFile(
        JSON.stringify({
          questionIds: [" conv-99:q1"],
          reanswerJobs: [],
        }),
        "live-delta.json",
        { preferManifestJobKeys: ["reanswerJobs"] },
      ),
    ).toThrow(
      "top-level questionIds contains leading or trailing whitespace at index 0",
    );

    expect(() =>
      parseLocomoQuestionIdsFile(
        JSON.stringify({
          categories: {
            open_domain: {
              questionIds: ["conv-43:q32"],
            },
          },
          questionIds: ["conv-99:q1"],
          reanswerJobs: [
            {
              questionIds: ["conv-42:q60"],
            },
          ],
        }),
        "live-delta.json",
        { preferManifestJobKeys: ["reanswerJobs"] },
      ),
    ).toThrow(
      "top-level questionIds do not match category questionIds",
    );

    expect(() =>
      parseLocomoQuestionIdsFile(
        JSON.stringify({
          categories: {
            open_domain: {
              questionIds: ["conv-99:q1"],
            },
          },
          overall: {
            selectedQuestionCount: 2,
          },
          questionIds: ["conv-99:q1"],
          reanswerJobs: [
            {
              questionIds: ["conv-42:q60"],
            },
          ],
        }),
        "live-delta.json",
        { preferManifestJobKeys: ["reanswerJobs"] },
      ),
    ).toThrow(
      "overall.selectedQuestionCount 2 does not match 1 top-level questionIds",
    );

    expect(() =>
      parseLocomoQuestionIdsFile(
        JSON.stringify({
          overall: {
            selectedQuestionCount: 1,
          },
          reanswerJobs: [],
        }),
        "live-delta.json",
        { preferManifestJobKeys: ["reanswerJobs"] },
      ),
    ).toThrow(
      "overall.selectedQuestionCount 1 does not match 0 preferred reanswerJobs questionIds",
    );
  });

  it("rejects malformed reanswer job selection metadata before targeted smoke replay", () => {
    expect(() =>
      parseLocomoQuestionIdsFile(
        JSON.stringify({
          reanswerJobs: [
            {
              bucket: 42,
              questionIds: ["conv-42:q60"],
            },
          ],
        }),
        "live-delta.json",
      ),
    ).toThrow("reanswerJobs bucket must be a string");

    expect(() =>
      parseLocomoQuestionIdsFile(
        JSON.stringify({
          reanswerJobs: [
            {
              bucket: "typoBucket",
              questionIds: ["conv-42:q60"],
            },
          ],
        }),
        "live-delta.json",
      ),
    ).toThrow("reanswerJobs bucket typoBucket is not recognized");

    expect(() =>
      parseLocomoQuestionIdsFile(
        JSON.stringify({
          reanswerJobs: [
            {
              categories: ["open_domain", 42],
              questionIds: ["conv-42:q60"],
            },
          ],
        }),
        "live-delta.json",
      ),
    ).toThrow(
      "reanswerJobs categories contains non-string value at index 1",
    );

    expect(() =>
      parseLocomoQuestionIdsFile(
        JSON.stringify({
          reanswerJobs: [
            {
              categories: ["open_domain", "typo_category"],
              questionIds: ["conv-42:q60"],
            },
          ],
        }),
        "live-delta.json",
      ),
    ).toThrow(
      "reanswerJobs categories value typo_category at index 1 is not recognized",
    );

    expect(() =>
      parseLocomoQuestionIdsFile(
        JSON.stringify({
          reanswerJobs: [
            {
              categories: ["open_domain", "open_domain"],
              questionIds: ["conv-42:q60"],
            },
          ],
        }),
        "live-delta.json",
      ),
    ).toThrow("reanswerJobs categories contains duplicate value open_domain");

    expect(() =>
      parseLocomoQuestionIdsFile(
        JSON.stringify({
          reanswerJobs: [
            {
              categories: ["adversarial"],
              category: "open_domain",
              questionIds: ["conv-42:q60"],
            },
          ],
        }),
        "live-delta.json",
      ),
    ).toThrow(
      "reanswerJobs category open_domain does not match categories [adversarial]",
    );

    expect(() =>
      parseLocomoQuestionIdsFile(
        JSON.stringify({
          reanswerJobs: [
            {
              categories: ["open_domain", "adversarial"],
              category: "open_domain",
              questionIds: ["conv-42:q60"],
            },
          ],
        }),
        "live-delta.json",
      ),
    ).toThrow(
      "reanswerJobs category open_domain does not match categories [open_domain, adversarial]",
    );
  });

  it("rejects malformed reanswer job source provenance before targeted smoke replay", () => {
    expect(() =>
      parseLocomoQuestionIdsFile(
        JSON.stringify({
          reanswerJobs: [
            {
              questionIds: ["conv-42:q60"],
              sourceRunId: 42,
            },
          ],
        }),
        "live-delta.json",
      ),
    ).toThrow("reanswerJobs sourceRunId must be a string");

    expect(() =>
      parseLocomoQuestionIdsFile(
        JSON.stringify({
          reanswerJobs: [
            {
              questionIds: ["conv-42:q60"],
              sourceReportPath: 42,
            },
          ],
        }),
        "live-delta.json",
      ),
    ).toThrow("reanswerJobs sourceReportPath must be a string");

    expect(() =>
      parseLocomoQuestionIdsFile(
        JSON.stringify({
          reanswerJobs: [
            {
              questionIds: ["conv-42:q60"],
              sourceRunId: "",
            },
          ],
        }),
        "live-delta.json",
      ),
    ).toThrow("reanswerJobs sourceRunId must not be empty");

    expect(() =>
      parseLocomoQuestionIdsFile(
        JSON.stringify({
          reanswerJobs: [
            {
              questionIds: ["conv-42:q60"],
              sourceRunId: " source-report",
            },
          ],
        }),
        "live-delta.json",
      ),
    ).toThrow(
      "reanswerJobs sourceRunId must not have leading or trailing whitespace",
    );

    expect(() =>
      parseLocomoQuestionIdsFile(
        JSON.stringify({
          reanswerJobs: [
            {
              questionIds: ["conv-42:q60"],
              sourceReportPath: " ",
            },
          ],
        }),
        "live-delta.json",
      ),
    ).toThrow("reanswerJobs sourceReportPath must not be empty");

    expect(() =>
      parseLocomoQuestionIdsFile(
        JSON.stringify({
          reanswerJobs: [
            {
              questionIds: ["conv-42:q60"],
              sourceReportPath: "/reports/source/smoke-report.json ",
            },
          ],
        }),
        "live-delta.json",
      ),
    ).toThrow(
      "reanswerJobs sourceReportPath must not have leading or trailing whitespace",
    );
  });

  it("can prefer manifest reanswer jobs without pulling repair queues", async () => {
    const questionIds = await resolveLocomoQuestionIds({
      explicitQuestionIds: ["conv-42:q60"],
      preferManifestJobKeys: ["reanswerJobs"],
      questionIdFile: "candidate-admission-slice.json",
      readFile: async () =>
        JSON.stringify({
          questionIds: ["conv-99:q1"],
          categories: {
            open_domain: { questionIds: ["conv-99:q1"] },
          },
          repairJobs: [
            {
              questionIds: ["conv-43:q32"],
            },
          ],
          reanswerJobs: [
            {
              questionIds: ["conv-48:q75"],
            },
          ],
        }),
    });

    expect(questionIds).toEqual(["conv-42:q60", "conv-48:q75"]);
  });

  it("rejects explicit question ids that overlap question-id-file selections", async () => {
    await expect(
      resolveLocomoQuestionIds({
        explicitQuestionIds: ["conv-42:q60"],
        preferManifestJobKeys: ["reanswerJobs"],
        questionIdFile: "candidate-admission-slice.json",
        readFile: async () =>
          JSON.stringify({
            reanswerJobs: [
              {
                questionIds: ["conv-48:q75", "conv-42:q60"],
              },
            ],
          }),
      }),
    ).rejects.toThrow(
      "explicit question ids overlap question-id-file question id conv-42:q60",
    );
  });

  it("does not fall back to broader queues when preferred manifest jobs are empty", async () => {
    await expect(
      resolveLocomoQuestionIds({
        preferManifestJobKeys: ["reanswerJobs"],
        questionIdFile: "candidate-admission-slice.json",
        readFile: async () =>
          JSON.stringify({
            questionIds: ["conv-99:q1"],
            categories: {
              open_domain: { questionIds: ["conv-99:q1"] },
            },
            repairJobs: [
              {
                questionIds: ["conv-43:q32"],
              },
            ],
            reanswerJobs: [],
          }),
      }),
    ).rejects.toThrow("did not contain questionIds");
  });

  it("rejects duplicate explicit question ids before targeted smoke resolution", async () => {
    await expect(
      resolveLocomoQuestionIds({
        explicitQuestionIds: ["conv-42:q60", "conv-42:q60"],
        readFile: async () => {
          throw new Error("question-id file should not be read");
        },
      }),
    ).rejects.toThrow(
      "explicit question ids has duplicate question id conv-42:q60",
    );
  });

  it("requires provider embedding mode before the LoCoMo semantic run can claim real embedding evidence", () => {
    const snapshot = {
      GOODMEMORY_EMBEDDING_API_KEY: process.env.GOODMEMORY_EMBEDDING_API_KEY,
      GOODMEMORY_EMBEDDING_BASE_URL: process.env.GOODMEMORY_EMBEDDING_BASE_URL,
      GOODMEMORY_EMBEDDING_MODEL: process.env.GOODMEMORY_EMBEDDING_MODEL,
      GOODMEMORY_EMBEDDING_PROVIDER: process.env.GOODMEMORY_EMBEDDING_PROVIDER,
    };
    delete process.env.GOODMEMORY_EMBEDDING_API_KEY;
    delete process.env.GOODMEMORY_EMBEDDING_BASE_URL;
    delete process.env.GOODMEMORY_EMBEDDING_MODEL;
    delete process.env.GOODMEMORY_EMBEDDING_PROVIDER;

    try {
      expect(() =>
        createLocomoSmokeMemory({
          providerEmbedding: true,
          semanticCandidates: true,
        }),
      ).toThrow("--provider-embedding requires GOODMEMORY_EMBEDDING_PROVIDER");
    } finally {
      for (const [key, value] of Object.entries(snapshot)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  it("uses provider embedding resolution instead of the smoke hash adapter when requested", () => {
    const memory = createLocomoSmokeMemory({
      providerEmbedding: true,
      providerEmbeddingConfig: {
        apiKey: "test-key",
        baseURL: "https://example.invalid/v1",
        model: "text-embedding-3-small",
        provider: "openai",
      },
      semanticCandidates: true,
    });

    expect(inspectGoodMemoryRuntime(memory)).toMatchObject({
      embeddingEnabled: true,
    });
  });

  it("uses provider-free recommended retrieval for generalized fusion", () => {
    const snapshot = {
      GOODMEMORY_EMBEDDING_API_KEY: process.env.GOODMEMORY_EMBEDDING_API_KEY,
      GOODMEMORY_EMBEDDING_BASE_URL: process.env.GOODMEMORY_EMBEDDING_BASE_URL,
      GOODMEMORY_EMBEDDING_MODEL: process.env.GOODMEMORY_EMBEDDING_MODEL,
      GOODMEMORY_EMBEDDING_PROVIDER: process.env.GOODMEMORY_EMBEDDING_PROVIDER,
    };
    process.env.GOODMEMORY_EMBEDDING_API_KEY = "should-not-be-read";
    process.env.GOODMEMORY_EMBEDDING_BASE_URL = "https://example.invalid/v1";
    process.env.GOODMEMORY_EMBEDDING_MODEL = "should-not-be-read";
    process.env.GOODMEMORY_EMBEDDING_PROVIDER = "openai";

    try {
      const memory = createLocomoSmokeMemory({ generalizedFusion: true });
      expect(inspectGoodMemoryRuntime(memory)).toMatchObject({
        embeddingEnabled: false,
        retrievalPreset: {
          active: true,
          requested: "recommended",
        },
      });
    } finally {
      for (const [key, value] of Object.entries(snapshot)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  it("uses the bounded provider embedding adapter when a timeout is configured", () => {
    const memory = createLocomoSmokeMemory({
      providerEmbedding: true,
      providerEmbeddingConfig: {
        apiKey: "test-key",
        baseURL: "https://example.invalid/v1",
        model: "text-embedding-3-small",
        provider: "openai",
      },
      providerEmbeddingTimeoutMs: 2500,
      semanticCandidates: true,
    });

    expect(inspectGoodMemoryRuntime(memory)).toMatchObject({
      embeddingEnabled: true,
    });

    expect(() =>
      createLocomoSmokeMemory({
        providerEmbeddingTimeoutMs: 2500,
      }),
    ).toThrow("--provider-embedding-timeout-ms requires --provider-embedding");
  });

  it("rejects semantic candidate generation under BM25-only retrieval", () => {
    expect(() =>
      createLocomoSmokeMemory({
        bm25: true,
        semanticCandidates: true,
      }),
    ).toThrow("--semantic-candidates cannot be combined with --bm25");

    expect(() =>
      createLocomoSmokeMemory({
        semanticCandidateTopK: 8,
      }),
    ).toThrow("--semantic-candidate-top-k requires --semantic-candidates");
  });

  it("keeps retrieval-only smoke isolated from unrelated assisted-extractor env", async () => {
    const snapshot = {
      GOODMEMORY_ASSISTED_EXTRACTOR_API_KEY:
        process.env.GOODMEMORY_ASSISTED_EXTRACTOR_API_KEY,
      GOODMEMORY_ASSISTED_EXTRACTOR_BASE_URL:
        process.env.GOODMEMORY_ASSISTED_EXTRACTOR_BASE_URL,
      GOODMEMORY_ASSISTED_EXTRACTOR_MODEL:
        process.env.GOODMEMORY_ASSISTED_EXTRACTOR_MODEL,
      GOODMEMORY_ASSISTED_EXTRACTOR_PROVIDER:
        process.env.GOODMEMORY_ASSISTED_EXTRACTOR_PROVIDER,
    };
    process.env.GOODMEMORY_ASSISTED_EXTRACTOR_API_KEY = "test-key";
    process.env.GOODMEMORY_ASSISTED_EXTRACTOR_MODEL = "gpt-test";
    delete process.env.GOODMEMORY_ASSISTED_EXTRACTOR_BASE_URL;
    delete process.env.GOODMEMORY_ASSISTED_EXTRACTOR_PROVIDER;

    try {
      const report = await runLocomoSmoke(
        {
          outputDir: "/tmp/locomo-out",
          runId: "run-locomo-env-isolated",
          semanticCandidates: true,
        },
        {
          mkdir: async () => undefined,
          writeFile: (async () => undefined) as never,
        },
      );

      expect(report.executionFailures).toBe(0);
      expect(report.semanticCandidateEmbeddingSource).toBe("smoke-hash");
    } finally {
      for (const [key, value] of Object.entries(snapshot)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  it("records the bounded provider embedding timeout in smoke reports", async () => {
    const report = await runLocomoSmoke(
      {
        outputDir: "/tmp/locomo-out",
        providerEmbedding: true,
        providerEmbeddingRunTimeoutMs: 60_000,
        providerEmbeddingTimeoutMs: 2500,
        runId: "run-locomo-provider-timeout",
        semanticCandidates: true,
      },
      {
        appendFile: async () => undefined,
        createMemory: () =>
          createLocomoSmokeMemory({
            semanticCandidates: true,
          }),
        mkdir: async () => undefined,
        writeFile: (async () => undefined) as never,
      },
    );

    expect(report.providerEmbeddingRunTimeoutMs).toBe(60_000);
    expect(report.providerEmbeddingTimeoutMs).toBe(2500);
    expect(report.semanticCandidateEmbeddingSource).toBe("provider");
  });

  it("retains failed rows when the provider run-level watchdog expires", async () => {
    const appended: string[] = [];
    let nowCallCount = 0;

    const report = await runLocomoSmoke(
      {
        outputDir: "/tmp/locomo-out",
        providerEmbedding: true,
        providerEmbeddingRunTimeoutMs: 10,
        runId: "run-locomo-provider-watchdog",
      },
      {
        appendFile: async (_path, data) => {
          appended.push(data);
        },
        createMemory: () => {
          throw new Error("provider watchdog should fire before seeding");
        },
        mkdir: async () => undefined,
        nowMs: () => {
          nowCallCount += 1;
          return nowCallCount === 1 ? 0 : 10;
        },
        writeFile: (async () => undefined) as never,
      },
    );

    expect(appended).toEqual([]);
    expect(report.executionFailures).toBe(report.questionCount);
    expect(report.cases.length).toBe(report.questionCount);
    expect(report.cases.every((entry) => entry.retrievedTurnIds.length === 0)).toBe(
      true,
    );
    expect(
      report.cases.every(
        (entry) => entry.executionFailureStage === "provider-run-timeout",
      ),
    ).toBe(true);
    expect(
      report.cases.every((entry) =>
        entry.executionFailureMessage?.includes(
          "LoCoMo provider embedding run timeout",
        ),
      ),
    ).toBe(true);
    expect(report.semanticCandidateEmbeddingSource).toBe("provider");
  });

  it("loads synthetic cases by default and normalized cases from an external root", async () => {
    const synthetic = await loadLocomoCases({
      readFile: async () => {
        throw new Error("must not read files for the synthetic default");
      },
    });
    expect(synthetic.benchmarkSource).toBe("synthetic-smoke");
    expect(synthetic.cases.length).toBeGreaterThan(0);

    const externalCase: LocomoCase = {
      caseId: "external-single-hop",
      sourceConversation: "external-conversation-1",
      speakers: ["Caroline", "Melanie"],
      turns: [
        { diaId: "D1:1", speaker: "Caroline", content: "The vault code is 7788." },
      ],
      questions: [
        {
          questionId: "external-single-hop:1",
          category: "single_hop",
          question: "What is the vault code?",
          goldAnswer: "7788",
          matchMode: "f1_token_overlap",
          evidenceTurnIds: ["D1:1"],
          adversarialAnswer: null,
        },
      ],
    };
    const externalTemporalCase: LocomoCase = {
      caseId: "external-temporal",
      sourceConversation: "external-conversation-2",
      speakers: ["Jon", "Gina"],
      turns: [
        { diaId: "D1:1", speaker: "Jon", content: "I moved in March." },
      ],
      questions: [
        {
          questionId: "external-temporal:1",
          category: "temporal",
          question: "When did Jon move?",
          goldAnswer: "March",
          matchMode: "f1_token_overlap",
          evidenceTurnIds: ["D1:1"],
          adversarialAnswer: null,
        },
        {
          questionId: "external-temporal:2",
          category: "single_hop",
          question: "Who moved?",
          goldAnswer: "Jon",
          matchMode: "f1_token_overlap",
          evidenceTurnIds: ["D1:1"],
          adversarialAnswer: null,
        },
      ],
    };
    const readExternalCases = async (path: string): Promise<string> => {
      expect(path).toBe(join("/tmp/LOCOMO", "cases.json"));
      return JSON.stringify({ cases: [externalCase, externalTemporalCase] });
    };
    const external = await loadLocomoCases({
      benchmarkRoot: "/tmp/LOCOMO",
      readFile: readExternalCases,
    });
    expect(external.benchmarkSource).toBe(join("/tmp/LOCOMO", "cases.json"));
    expect(external.cases).toEqual([externalCase, externalTemporalCase]);

    const filtered = await loadLocomoCases({
      benchmarkRoot: "/tmp/LOCOMO",
      caseIds: ["external-temporal"],
      readFile: readExternalCases,
    });
    expect(filtered.cases).toEqual([externalTemporalCase]);

    const temporalOnly = await loadLocomoCases({
      benchmarkRoot: "/tmp/LOCOMO",
      questionCategories: ["temporal"],
      readFile: readExternalCases,
    });
    expect(temporalOnly.cases).toEqual([
      {
        ...externalTemporalCase,
        questions: [externalTemporalCase.questions[0]!],
      },
    ]);

    const questionOnly = await loadLocomoCases({
      benchmarkRoot: "/tmp/LOCOMO",
      questionIds: [externalTemporalCase.questions[0]!.questionId],
      readFile: readExternalCases,
    });
    expect(questionOnly.cases).toEqual([
      {
        ...externalTemporalCase,
        questions: [externalTemporalCase.questions[0]!],
      },
    ]);

    const fileFilteredReport = await runLocomoSmoke(
      {
        benchmarkRoot: "/tmp/LOCOMO",
        outputDir: "/tmp/out",
        questionIdFile: "/tmp/candidate-admission-slice.json",
        repairJobDiagnoses: ["rationale-bearing-gold-answer"],
        repairJobRetrievalBuckets: ["full"],
        runId: "question-id-file-run",
      },
      {
        mkdir: async () => undefined,
        readFile: async (path: string) => {
          if (path === join("/tmp/LOCOMO", "cases.json")) {
            return JSON.stringify({ cases: [externalCase, externalTemporalCase] });
          }
          if (path === "/tmp/candidate-admission-slice.json") {
            return JSON.stringify({
              repairJobs: [
                {
                  diagnosis: "rationale-bearing-gold-answer",
                  questionIds: [
                    externalCase.questions[0]!.questionId,
                    externalTemporalCase.questions[0]!.questionId,
                  ],
                  retrievalBucket: "full",
                },
              ],
            });
          }
          throw new Error(`unexpected read: ${path}`);
        },
        writeFile: (async () => undefined) as never,
      },
    );
    expect(fileFilteredReport.questionIds).toEqual([
      externalCase.questions[0]!.questionId,
      externalTemporalCase.questions[0]!.questionId,
    ]);
    expect(fileFilteredReport.questionSelection).toEqual({
      explicitQuestionIds: null,
      questionIdFile: "/tmp/candidate-admission-slice.json",
      repairJobDiagnoses: ["rationale-bearing-gold-answer"],
      repairJobRetrievalBuckets: ["full"],
    });
    expect(fileFilteredReport.questionCount).toBe(2);
    expect(fileFilteredReport.caseIds).toEqual([
      "external-single-hop",
      "external-temporal",
    ]);
    expect(() =>
      assertLocomoReportQuestionCountMatchesCases({
        path: "/tmp/out/question-id-file-run/smoke-report.json",
        report: fileFilteredReport,
      }),
    ).not.toThrow();

    expect(() =>
      assertLocomoReportQuestionCountMatchesCases({
        path: "/tmp/out/question-id-file-run/smoke-report.json",
        report: {
          ...fileFilteredReport,
          questionSelection: {
            ...fileFilteredReport.questionSelection!,
            repairJobDiagnoses: ["typo"],
          },
        },
      }),
    ).toThrow(
      "questionSelection.repairJobDiagnoses contains unknown diagnosis typo",
    );

    await expect(
      loadLocomoCases({
        benchmarkRoot: "/tmp/LOCOMO",
        questionCategories: ["adversarial"],
        readFile: readExternalCases,
      }),
    ).rejects.toThrow(
      "LoCoMo category filter matched no questions in /tmp/LOCOMO/cases.json: adversarial",
    );

    await expect(
      loadLocomoCases({
        benchmarkRoot: "/tmp/LOCOMO",
        questionCategories: ["temporal", "adversarial"],
        readFile: readExternalCases,
      }),
    ).rejects.toThrow(
      "LoCoMo category id(s) not found in /tmp/LOCOMO/cases.json: adversarial",
    );

    await expect(
      loadLocomoCases({
        benchmarkRoot: "/tmp/LOCOMO",
        caseIds: ["external-temporal", "missing-case"],
        readFile: readExternalCases,
      }),
    ).rejects.toThrow(
      "LoCoMo case id(s) not found in /tmp/LOCOMO/cases.json: missing-case",
    );

    await expect(
      loadLocomoCases({
        benchmarkRoot: "/tmp/LOCOMO",
        questionIds: ["missing-question"],
        readFile: readExternalCases,
      }),
    ).rejects.toThrow(
      "LoCoMo question id(s) not found in /tmp/LOCOMO/cases.json: missing-question",
    );

    const duplicateQuestionCase: LocomoCase = {
      ...externalCase,
      caseId: "external-duplicate-question",
      sourceConversation: "external-conversation-duplicate",
      questions: [
        {
          ...externalCase.questions[0]!,
          question: "What code did Caroline mention again?",
        },
      ],
    };
    await expect(
      loadLocomoCases({
        benchmarkRoot: "/tmp/LOCOMO",
        questionIds: [externalCase.questions[0]!.questionId],
        readFile: async () =>
          JSON.stringify({ cases: [externalCase, duplicateQuestionCase] }),
      }),
    ).rejects.toThrow(
      "LoCoMo question id external-single-hop:1 matched multiple questions " +
        "in /tmp/LOCOMO/cases.json: external-single-hop and " +
        "external-duplicate-question.",
    );
  });

  it("keeps commonsense resolution explicit in the live-answer system prompt", () => {
    expect(buildLocomoSystemPrompt({})).not.toContain(
      "general world knowledge",
    );
    expect(
      buildLocomoSystemPrompt({ allowCommonsenseResolution: true }),
    ).toContain("general world knowledge");
    expect(
      buildLocomoSystemPrompt({
        allowCommonsenseResolution: true,
        questionCategory: "open_domain",
      }),
    ).toContain("general world knowledge");
    expect(
      buildLocomoSystemPrompt({
        allowCommonsenseResolution: true,
        questionCategory: "single_hop",
      }),
    ).not.toContain("general world knowledge");
    expect(
      buildLocomoSystemPrompt({
        allowCommonsenseResolution: true,
        questionCategory: "open_domain",
      }),
    ).toContain("full console, company, place, style, or category name");
  });

  it("keeps commonsense resolution aligned across system and user prompts", () => {
    expect(
      buildLocomoPrompt({
        memoryContext: "Nate is playing Xenoblade.",
        question: "What console does Nate own?",
      }),
    ).toContain("using only the dialog context");
    expect(
      buildLocomoPrompt({
        allowCommonsenseResolution: true,
        memoryContext: "Nate is playing Xenoblade.",
        question: "What console does Nate own?",
      }),
    ).toContain("bridge those dialog-supported entities");
    expect(
      buildLocomoPrompt({
        allowCommonsenseResolution: true,
        memoryContext: "Nate is playing Xenoblade.",
        question: "What console does Nate own?",
      }),
    ).not.toContain("using only the dialog context");
  });

  it("keeps strict no-evidence abstention explicit in the live-answer system prompt", () => {
    expect(buildLocomoSystemPrompt({})).not.toContain(
      "directly states the requested relationship",
    );
    expect(
      buildLocomoSystemPrompt({
        questionCategory: "adversarial",
        strictNoEvidenceAbstention: true,
      }),
    ).toContain("directly states the requested relationship");
    expect(
      buildLocomoSystemPrompt({
        questionCategory: "open_domain",
        strictNoEvidenceAbstention: true,
      }),
    ).not.toContain("directly states the requested relationship");
  });

  it("keeps count-frequency answer formatting explicit in the live-answer system prompt", () => {
    const prompt = buildLocomoSystemPrompt({});
    expect(prompt).toContain("count or frequency questions");
    expect(prompt).toContain("twice");
    expect(prompt).toContain("bare \"2\"");
  });

  it("rejects answer-policy flags on retrieval-only smoke runs", async () => {
    await expect(
      runLocomoSmoke(
        {
          allowCommonsenseResolution: true,
          outputDir: "/tmp/locomo-out",
          runId: "run-retrieval-only-answer-policy",
        },
        {
          mkdir: async () => undefined,
          writeFile: (async () => undefined) as never,
        },
      ),
    ).rejects.toThrow("--allow-commonsense-resolution requires --live");

    await expect(
      runLocomoSmoke(
        {
          outputDir: "/tmp/locomo-out",
          runId: "run-retrieval-only-strict-policy",
          strictNoEvidenceAbstention: true,
        },
        {
          mkdir: async () => undefined,
          writeFile: (async () => undefined) as never,
        },
      ),
    ).rejects.toThrow("--strict-no-evidence-abstention requires --live");
  });

  it("rejects answer-context flags on retrieval-only smoke runs", async () => {
    await expect(
      runLocomoSmoke(
        {
          answerFromRecalled: true,
          outputDir: "/tmp/locomo-out",
          runId: "run-retrieval-only-answer-from-recalled",
        },
        {
          mkdir: async () => undefined,
          writeFile: (async () => undefined) as never,
        },
      ),
    ).rejects.toThrow("--answer-from-recalled requires --live");

    await expect(
      runLocomoSmoke(
        {
          evidencePack: true,
          outputDir: "/tmp/locomo-out",
          runId: "run-retrieval-only-evidence-pack",
        },
        {
          mkdir: async () => undefined,
          writeFile: (async () => undefined) as never,
        },
      ),
    ).rejects.toThrow("--evidence-pack requires --live");
  });

  it("rejects an external root whose payload is not a normalized case array", async () => {
    await expect(
      loadLocomoCases({
        benchmarkRoot: "/tmp/LOCOMO",
        readFile: async () => JSON.stringify({ cases: [{ caseId: "broken" }] }),
      }),
    ).rejects.toThrow("is not a normalized case");
  });

  it("scores evidence recall, missing evidence, and noise from retrieved dia_ids", () => {
    const fullyRetrieved = scoreLocomoRetrieval({
      question: {
        questionId: "q1",
        category: "multi_hop",
        question: "which city?",
        goldAnswer: "Seattle",
        matchMode: "f1_token_overlap",
        evidenceTurnIds: ["D1:1", "D3:1"],
        adversarialAnswer: null,
      },
      retrievedTurnIds: ["D1:1", "D1:2", "D3:1"],
      testCase: { caseId: "c1" } as LocomoCase,
    });
    expect(fullyRetrieved.evidenceRecall).toBe(1);
    expect(fullyRetrieved.goldEvidenceFullyRetrieved).toBe(true);
    expect(fullyRetrieved.missingEvidenceTurnIds).toEqual([]);
    // Evidence turns D1:1/D3:1 are excluded from noise; only D1:2 is noise.
    expect(fullyRetrieved.noiseTurnCount).toBe(1);
    expect(fullyRetrieved.noiseTurnIds).toEqual(["D1:2"]);

    const partial = scoreLocomoRetrieval({
      question: {
        questionId: "q2",
        category: "multi_hop",
        question: "which city?",
        goldAnswer: "Seattle",
        matchMode: "f1_token_overlap",
        evidenceTurnIds: ["D1:1", "D3:1"],
        adversarialAnswer: null,
      },
      retrievedTurnIds: ["D1:1"],
      testCase: { caseId: "c1" } as LocomoCase,
    });
    expect(partial.evidenceRecall).toBe(0.5);
    expect(partial.goldEvidenceFullyRetrieved).toBe(false);
    expect(partial.missingEvidenceTurnIds).toEqual(["D3:1"]);
    expect(partial.noiseTurnCount).toBe(0);
    expect(partial.noiseTurnIds).toEqual([]);
  });

  it("summarizes per-category retrieval with multi-hop cross-session readiness", () => {
    const results: LocomoQuestionRetrieval[] = [
      {
        answerCorrect: null,
        caseId: "multi",
        category: "multi_hop",
        evidenceRecall: 1,
        evidenceTurnIds: ["D1:1", "D3:1"],
        generatedAnswer: null,
        goldEvidenceFullyRetrieved: true,
        missingEvidenceTurnIds: [],
        noiseTurnCount: 2,
        noiseTurnIds: ["D1:2", "D2:1"],
        questionId: "multi:1",
        retrievedTurnIds: ["D1:1", "D1:2", "D2:1", "D3:1"],
      },
    ];
    const summary = summarizeLocomoRetrieval(results);

    const multi = summary.find((entry) => entry.category === "multi_hop");
    expect(multi?.crossSessionChainReady).toBe(true);
    expect(multi?.answeredCount).toBe(0);
    expect(multi?.averageEvidenceRecall).toBe(1);
    expect(multi?.noiseTurnTotal).toBe(2);
    expect(multi?.answerAccuracy).toBeNull();

    // Non-multi-hop categories never report cross-session readiness.
    const single = summary.find((entry) => entry.category === "single_hop");
    expect(single?.crossSessionChainReady).toBeNull();
    // Empty buckets report 0, never NaN.
    expect(single?.questionCount).toBe(0);
    expect(single?.averageEvidenceRecall).toBe(0);
  });

  it("builds a stable scope per case", () => {
    expect(
      buildLocomoScope({ caseId: "single-hop-dog", runId: "run-locomo" }),
    ).toEqual({
      agentId: "phase-65-locomo-smoke",
      sessionId: "case-single-hop-dog",
      userId: "locomo:single-hop-dog",
      workspaceId: "phase-65-locomo:run-locomo",
    });
  });

  it("ignores non-array recall sections when collecting dia_ids", () => {
    expect(
      collectLocomoRetrievedTurnIds({
        facts: [
          {
            content: "[LOCOMO dia_id=D2:4 speaker=Caroline] hi",
            tags: ["dia_id:D2:4"],
          },
        ],
        preferences: "not-an-array",
      } as never),
    ).toEqual(["D2:4"]);
  });

  it("runs the synthetic smoke deterministically with full evidence recall", async () => {
    const writes: Array<{ contents: string; path: string }> = [];
    const report = await runLocomoSmoke(
      { runId: "run-locomo-smoke-test", outputDir: "/tmp/locomo-out" },
      {
        mkdir: async () => undefined,
        writeFile: (async (path: string, contents: string) => {
          writes.push({ contents, path });
        }) as never,
      },
    );

    expect(report.mode).toBe("retrieval-only");
    expect(report.answerEvaluation).toBe("deferred-to-live-mode");
    expect(report.benchmarkSource).toBe("synthetic-smoke");
    expect(report.executionFailures).toBe(0);
    expect(report.caseCount).toBe(5);
    expect(report.caseIds).toEqual([
      "synthetic-single-hop-dog",
      "synthetic-multi-hop-visit",
      "synthetic-temporal-promotion",
      "synthetic-open-domain-cuisine",
      "synthetic-adversarial-bowl",
    ]);
    expect(report.questionCount).toBe(5);
    expect(report.questionCategories).toBeNull();
    expect(report.cases.every((entry) => entry.answerTokenF1 === null)).toBe(
      true,
    );

    // Provenance/contract header fields.
    expect(report.phase).toBe("phase-65");
    expect(report.benchmark).toBe("locomo");
    expect(report.license).toBe("CC BY-NC 4.0");
    expect(report.externalRoot).toBeNull();
    expect(report.profilesCompared).toEqual(["goodmemory-rules-only"]);
    expect(report.upstreamSource).toContain("locomo");
    expect(report.upstreamAnswerMetricByCategory).toEqual({
      single_hop: "f1_token_overlap",
      multi_hop: "f1_token_overlap",
      temporal: "f1_token_overlap",
      open_domain: "f1_token_overlap",
      adversarial: "adversarial_abstention",
    });

    // The adapter surfaces the gold evidence for every QA category.
    for (const name of [
      "single_hop",
      "multi_hop",
      "temporal",
      "open_domain",
      "adversarial",
    ]) {
      const entry = category(report, name);
      expect(entry.averageEvidenceRecall).toBe(1);
      expect(entry.fullyRetrievedCount).toBe(1);
      expect(entry.questionCount).toBe(1);
    }

    // Multi-hop: both sessions' evidence is retrieved, so cross-session
    // composition is recall-ready (and other categories report null).
    expect(category(report, "multi_hop").crossSessionChainReady).toBe(true);
    expect(category(report, "single_hop").crossSessionChainReady).toBeNull();

    // Current retrieval-breadth (noise) baseline for the tiny synthetic cases.
    expect(category(report, "single_hop").noiseTurnTotal).toBe(1);
    expect(category(report, "multi_hop").noiseTurnTotal).toBe(0);
    expect(category(report, "temporal").noiseTurnTotal).toBe(0);
    expect(category(report, "open_domain").noiseTurnTotal).toBe(1);
    expect(category(report, "adversarial").noiseTurnTotal).toBe(2);

    // The report is written under the run directory.
    expect(writes.length).toBe(1);
    expect(writes[0]?.path).toBe(
      join(
        "/tmp/locomo-out",
        "run-locomo-smoke-test",
        LOCOMO_SMOKE_REPORT_FILE_NAME,
      ),
    );
    const writtenReport = JSON.parse(writes[0]?.contents ?? "{}") as {
      caseIds?: unknown;
      questionCategories?: unknown;
      runId?: unknown;
    };
    expect(writtenReport.runId).toBe(
      "run-locomo-smoke-test",
    );
    expect(writtenReport.caseIds).toEqual(report.caseIds);
    expect(writtenReport.questionCategories).toBeNull();
  });

  it("runs a targeted question-category slice without changing category summary shape", async () => {
    const writes: Array<{ contents: string; path: string }> = [];
    const report = await runLocomoSmoke(
      {
        outputDir: "/tmp/locomo-out",
        questionCategories: ["adversarial"],
        runId: "run-locomo-adversarial-slice",
      },
      {
        mkdir: async () => undefined,
        writeFile: (async (path: string, contents: string) => {
          writes.push({ contents, path });
        }) as never,
      },
    );

    expect(report.caseCount).toBe(1);
    expect(report.caseIds).toEqual(["synthetic-adversarial-bowl"]);
    expect(report.questionCount).toBe(1);
    expect(report.questionCategories).toEqual(["adversarial"]);
    expect(category(report, "adversarial").questionCount).toBe(1);
    expect(category(report, "single_hop").questionCount).toBe(0);
    expect(category(report, "multi_hop").crossSessionChainReady).toBe(false);

    const writtenReport = JSON.parse(writes[0]?.contents ?? "{}") as {
      questionCategories?: unknown;
    };
    expect(writtenReport.questionCategories).toEqual(["adversarial"]);
  });

  it("scores answer accuracy in live-answer mode and resists the adversarial bait", async () => {
    // A perfect generator answers every question with its gold value.
    const perfect = await runLocomoSmoke(
      { runId: "run-locomo-live", outputDir: "/tmp/locomo-out" },
      {
        answerGenerator: async ({ question }) => question.goldAnswer,
        appendFile: async () => undefined,
        mkdir: async () => undefined,
        writeFile: (async () => undefined) as never,
      },
    );

    expect(perfect.mode).toBe("live-answer");
    expect(perfect.answerEvaluation).toBe("scored");
    for (const name of [
      "single_hop",
      "multi_hop",
      "temporal",
      "open_domain",
      "adversarial",
    ]) {
      const entry = category(perfect, name);
      expect(entry.answeredCount).toBe(1);
      expect(entry.answerAccuracy).toBe(1);
    }
    const single = perfect.cases.find(
      (entry) => entry.category === "single_hop",
    );
    expect(single?.answerCorrect).toBe(true);
    expect(single?.answerTokenF1).toBe(1);
    expect(single?.generatedAnswer).toBe("Pepper");

    // A generator that takes the adversarial bait ("Yes") fails adversarial only.
    const baited = await runLocomoSmoke(
      { runId: "run-locomo-live-baited", outputDir: "/tmp/locomo-out" },
      {
        answerGenerator: async ({ question }) =>
          question.category === "adversarial"
            ? (question.adversarialAnswer ?? "Yes")
            : question.goldAnswer,
        appendFile: async () => undefined,
        mkdir: async () => undefined,
        writeFile: (async () => undefined) as never,
      },
    );
    expect(category(baited, "adversarial").answerAccuracy).toBe(0);
    expect(category(baited, "single_hop").answerAccuracy).toBe(1);
  });

  it("conversational ingest stores atomic facts that preserve source dia_id provenance", async () => {
    const testCase: LocomoCase = {
      caseId: "conv-ingest",
      sourceConversation: "conv-ingest",
      speakers: ["Melanie", "Caroline"],
      turns: [
        { diaId: "D1:1", speaker: "Melanie", content: "How did it go?" },
        { diaId: "D1:2", speaker: "Caroline", content: "I went there on Tuesday." },
      ],
      questions: [
        {
          questionId: "conv-ingest:q",
          category: "temporal",
          question: "When did Caroline go to the LGBTQ support group?",
          goldAnswer: "Tuesday",
          matchMode: "f1_token_overlap",
          evidenceTurnIds: ["D1:2"],
          adversarialAnswer: null,
        },
      ],
    };
    // The mock resolves the coreference ("I"/"there") into a self-contained,
    // question-matching claim anchored to the gold turn (sourceMessageIndex 1 -> D1:2).
    const extractor: MemoryExtractor = {
      async extract() {
        return {
          candidates: [
            {
              id: "fact-1",
              kindHint: "fact",
              explicitness: "explicit",
              content: "Caroline went to the LGBTQ support group on Tuesday.",
              sourceMessageIndex: 1,
              sourceRole: "user",
            },
          ],
          ignoredMessageCount: 1,
        };
      },
    };

    const memory = createLocomoSmokeMemory();
    await seedLocomoCaseConversational({ extractor, memory, runId: "t", testCase });

    const scope = buildLocomoScope({ caseId: "conv-ingest", runId: "t" });
    const recall = await memory.recall({
      query: testCase.questions[0]!.question,
      scope,
      strategy: "rules-only",
    });
    const retrievedTurnIds = collectLocomoRetrievedTurnIds(recall);

    // The normalized fact carries the gold turn's dia_id, so the SAME trusted
    // recall metric counts it as retrieved even though the raw turn ("I went
    // there on Tuesday") shares no entity vocabulary with the question.
    expect(retrievedTurnIds).toContain("D1:2");
    const score = scoreLocomoRetrieval({
      question: testCase.questions[0]!,
      retrievedTurnIds,
      testCase,
    });
    expect(score.evidenceRecall).toBe(1);
    expect(score.goldEvidenceFullyRetrieved).toBe(true);
  });

  it("extracts sessions concurrently but remembers them in source order", async () => {
    const testCase: LocomoCase = {
      caseId: "concurrent-ingest",
      sourceConversation: "concurrent-ingest",
      speakers: ["A", "B"],
      turns: [
        { diaId: "D1:1", speaker: "A", content: "First session." },
        { diaId: "D2:1", speaker: "B", content: "Second session." },
      ],
      questions: [],
    };
    let activeExtractions = 0;
    let maxActiveExtractions = 0;
    const extractor: MemoryExtractor = {
      async extract(input) {
        activeExtractions += 1;
        maxActiveExtractions = Math.max(maxActiveExtractions, activeExtractions);
        await new Promise((resolve) => setTimeout(resolve, 20));
        activeExtractions -= 1;
        return {
          candidates: [
            {
              content: input.messages[0]!.content,
              explicitness: "explicit",
              id: input.messages[0]!.content,
              kindHint: "fact",
              sourceMessageIndex: 0,
              sourceRole: "user",
            },
          ],
          ignoredMessageCount: 0,
        };
      },
    };
    const remembered: string[] = [];
    const memory = {
      async remember(input: Parameters<GoodMemory["remember"]>[0]) {
        remembered.push(input.messages[0]!.content);
        return {};
      },
    } as unknown as GoodMemory;

    await seedLocomoCaseConversational({
      extractor,
      maxConcurrency: 2,
      memory,
      runId: "concurrent",
      testCase,
    });

    expect(maxActiveExtractions).toBe(2);
    expect(remembered).toEqual([
      "[LOCOMO dia_id=D1:1 speaker=A] A: First session.",
      "[LOCOMO dia_id=D2:1 speaker=B] B: Second session.",
    ]);
  });

  it("runLocomoSmoke records the conversational ingest mode and surfaces normalized recall", async () => {
    // A deterministic extractor that emits one self-contained fact per session,
    // anchored to the session's first turn, lets the synthetic smoke run end to
    // end through the conversational path without any live model.
    let activeExtractions = 0;
    let maxActiveExtractions = 0;
    const extractor: MemoryExtractor = {
      async extract(input) {
        activeExtractions += 1;
        maxActiveExtractions = Math.max(maxActiveExtractions, activeExtractions);
        await new Promise((resolve) => setTimeout(resolve, 5));
        activeExtractions -= 1;
        return {
          candidates: input.messages.slice(0, 1).map((message, index) => ({
            id: `fact-${index}`,
            kindHint: "fact" as const,
            explicitness: "explicit" as const,
            content: message.content,
            sourceMessageIndex: index,
            sourceRole: "user",
          })),
          ignoredMessageCount: Math.max(0, input.messages.length - 1),
        };
      },
    };

    const report = await runLocomoSmoke(
      {
        concurrency: 2,
        conversationalExtraction: true,
        runId: "run-locomo-conv",
        outputDir: "/tmp/locomo-out",
      },
      {
        appendFile: async () => undefined,
        conversationalExtractor: extractor,
        mkdir: async () => undefined,
        writeFile: (async () => undefined) as never,
      },
    );

    expect(report.ingestMode).toBe("conversational-extraction");
    expect(maxActiveExtractions).toBe(2);
    expect(report.mode).toBe("retrieval-only");
    expect(report.executionFailures).toBe(0);
  });

  it("conversational ingest is additive: a turn the extractor drops stays retrievable from its raw form", async () => {
    const testCase: LocomoCase = {
      caseId: "additive",
      sourceConversation: "additive",
      speakers: ["Melanie", "Caroline"],
      turns: [
        { diaId: "D1:1", speaker: "Caroline", content: "I finally adopted a beagle." },
        {
          diaId: "D1:2",
          speaker: "Caroline",
          content: "The hiking trip to Mount Rainier was canceled by a storm.",
        },
      ],
      questions: [
        {
          questionId: "additive:q",
          category: "open_domain",
          question: "What happened with the Mount Rainier hiking trip?",
          goldAnswer: "canceled",
          matchMode: "f1_token_overlap",
          evidenceTurnIds: ["D1:2"],
          adversarialAnswer: null,
        },
      ],
    };
    // A lossy extractor: it emits a fact for turn 0 only and DROPS turn 1.
    const lossyExtractor: MemoryExtractor = {
      async extract() {
        return {
          candidates: [
            {
              id: "fact-0",
              kindHint: "fact",
              explicitness: "explicit",
              content: "Caroline adopted a beagle.",
              sourceMessageIndex: 0,
              sourceRole: "user",
            },
          ],
          ignoredMessageCount: 1,
        };
      },
    };

    const memory = createLocomoSmokeMemory();
    // Mirror the harness's additive seeding order: raw turns first, then facts.
    await seedLocomoCase({ memory, runId: "t", testCase });
    await seedLocomoCaseConversational({
      extractor: lossyExtractor,
      memory,
      runId: "t",
      testCase,
    });

    const scope = buildLocomoScope({ caseId: "additive", runId: "t" });
    const recall = await memory.recall({
      query: testCase.questions[0]!.question,
      scope,
      strategy: "rules-only",
    });

    // The dropped turn D1:2 is still retrievable because extraction is additive:
    // the raw turn was preserved, never destructively replaced (arXiv 2605.12978).
    expect(collectLocomoRetrievedTurnIds(recall)).toContain("D1:2");
  });

  it("runs the synthetic smoke under the BM25 lexical leg (embedding-free, no gateway)", async () => {
    const report = await runLocomoSmoke(
      { bm25: true, runId: "run-locomo-bm25", outputDir: "/tmp/locomo-out" },
      {
        mkdir: async () => undefined,
        writeFile: (async () => undefined) as never,
      },
    );

    expect(report.bm25Ranking).toBe(true);
    expect(report.mode).toBe("retrieval-only");
    // The BM25/hybrid recall path runs end to end with no execution failures and
    // still scores every QA category.
    expect(report.executionFailures).toBe(0);
    for (const name of [
      "single_hop",
      "multi_hop",
      "temporal",
      "open_domain",
      "adversarial",
    ]) {
      expect(category(report, name).questionCount).toBe(1);
    }
  });

  it("runs the synthetic smoke with opt-in semantic candidate generation", async () => {
    const report = await runLocomoSmoke(
      {
        outputDir: "/tmp/locomo-out",
        runId: "run-locomo-semantic-candidates",
        semanticCandidateMaxAdditions: 1,
        semanticCandidateMinRelativeScore: 0.8,
        semanticCandidateTopK: 2,
        semanticCandidates: true,
      },
      {
        mkdir: async () => undefined,
        writeFile: (async () => undefined) as never,
      },
    );

    expect(report.semanticCandidates).toEqual({
      enabled: true,
      maxAdditions: 1,
      minRelativeScore: 0.8,
      minSimilarity: null,
      topK: 2,
    });
    expect(report.executionFailures).toBe(0);
    expect(report.questionCount).toBeGreaterThan(0);
  });

  it("runs the synthetic smoke with provider-free generalized fusion", async () => {
    const report = await runLocomoSmoke(
      {
        generalizedFusion: true,
        outputDir: "/tmp/locomo-out",
        runId: "run-locomo-generalized-fusion",
      },
      {
        mkdir: async () => undefined,
        writeFile: (async () => undefined) as never,
      },
    );

    expect(report.generalizedFusion).toBe(true);
    // Config honesty: the bare recommended preset leaves the dynamic-budget
    // floor unset, so the engine runs 0 (no trimming) — the report must
    // record the wired value, not the library constant (0.35).
    expect(report.generalizedFusionConfig).toEqual({
      maxCandidates: 8,
      maxTotalFacts: 10,
      minRelativeStrength: 0,
      rrfK: 60,
    });
    expect(report.profilesCompared).toEqual(["goodmemory-recommended"]);
    expect(report.executionFailures).toBe(0);
  });

  it("wires and records --fusion-min-relative-strength", async () => {
    const options = parseLocomoSmokeCliOptions([
      "--generalized-fusion",
      "--fusion-min-relative-strength",
      "0.35",
    ]);
    expect(options.fusionMinRelativeStrength).toBe(0.35);
    const report = await runLocomoSmoke(
      {
        generalizedFusion: true,
        fusionMinRelativeStrength: 0.35,
        outputDir: "/tmp/locomo-out",
        runId: "run-locomo-fusion-floor",
      },
      {
        mkdir: async () => undefined,
        writeFile: (async () => undefined) as never,
      },
    );
    expect(report.generalizedFusionConfig?.minRelativeStrength).toBe(0.35);
    expect(report.executionFailures).toBe(0);
  });

  it("rejects --fusion-min-relative-strength without --generalized-fusion", () => {
    expect(() =>
      parseLocomoSmokeCliOptions(["--fusion-min-relative-strength", "0.35"]),
    ).toThrow(/--generalized-fusion/);
  });

  it("defaults bm25Ranking to false (rules-only floor)", async () => {
    const report = await runLocomoSmoke(
      { runId: "run-locomo-default-bm25", outputDir: "/tmp/locomo-out" },
      {
        mkdir: async () => undefined,
        writeFile: (async () => undefined) as never,
      },
    );
    expect(report.bm25Ranking).toBe(false);
    expect(report.generalizedFusion).toBe(false);
    expect(report.semanticCandidates.enabled).toBe(false);
  });

  it("buildLocomoRecalledContext answers from recalled records (normalized facts), ordered by dia_id", () => {
    const recall = {
      facts: [
        {
          content:
            "[LOCOMO dia_id=D2:5 speaker=Caroline date=9 June, 2023] Caroline started a dance studio after losing her banking job.",
        },
        {
          content:
            "[LOCOMO dia_id=D1:3 speaker=Gina] Gina's favorite dance style is contemporary.",
        },
      ],
    } as never;

    const ctx = buildLocomoRecalledContext({ recall });
    const lines = ctx.split("\n");

    // Ordered by source dia_id (D1:3 before D2:5) for chronological reasoning.
    expect(lines[0]).toContain("dia_id=D1:3");
    expect(lines[0]).toContain("Gina");
    expect(lines[0]).toContain("contemporary");
    expect(lines[1]).toContain("dia_id=D2:5");
    // The normalized, coreference-resolved claim is surfaced to the answer model
    // (a raw-turn reconstruction would not contain this phrasing).
    expect(ctx).toContain("losing her banking job");
    // The absolute session date is surfaced so relative dates can be resolved.
    expect(lines[1]).toContain("9 June, 2023");
    // A record without a date still renders cleanly (no stray "date=").
    expect(lines[0]).not.toContain("date=");
  });

  it("runs the full deterministic embedding-free stack (bm25+decompose+multihop+rerank, no gateway)", async () => {
    const report = await runLocomoSmoke(
      {
        bm25: true,
        decompose: true,
        multiHop: true,
        rerank: true,
        runId: "run-locomo-detstack",
        outputDir: "/tmp/locomo-out",
      },
      {
        mkdir: async () => undefined,
        writeFile: (async () => undefined) as never,
      },
    );

    expect(report.bm25Ranking).toBe(true);
    // The whole deterministic stack composes end to end with no execution
    // failures and still scores every QA category.
    expect(report.executionFailures).toBe(0);
    for (const name of [
      "single_hop",
      "multi_hop",
      "temporal",
      "open_domain",
      "adversarial",
    ]) {
      expect(category(report, name).questionCount).toBe(1);
    }
  });

  it("locomoFactTurnOverlap separates near-copy facts from genuinely normalized ones", () => {
    expect(
      locomoFactTurnOverlap(
        "Caroline went to the support group on Tuesday.",
        "Caroline went to the support group on Tuesday.",
      ),
    ).toBeGreaterThan(0.9);
    expect(
      locomoFactTurnOverlap(
        "Caroline attended the downtown LGBTQ support group.",
        "Melanie: yeah, dance is pretty much my whole escape honestly.",
      ),
    ).toBeLessThan(0.4);
  });

  it("resolveSpeakerCoref rewrites first/second-person pronouns to participant names", () => {
    expect(otherLocomoSpeaker({ speakers: ["Jon", "Gina"] } as never, "Jon")).toBe(
      "Gina",
    );

    // First-person -> speaker; the named participant now appears in the text, so
    // a question naming them can match a turn they spoke in the first person.
    const jon = resolveSpeakerCoref("I lost my job as a banker.", "Jon", "Gina");
    expect(jon).toBe("Jon lost Jon's job as a banker.");

    // Second-person -> the other speaker.
    const gina = resolveSpeakerCoref("How is your dance studio going?", "Gina", "Jon");
    expect(gina).toBe("How is Jon's dance studio going?");

    // Possessive of a name ending in s uses a bare apostrophe.
    expect(resolveSpeakerCoref("That is my call.", "Chris", "Gina")).toBe(
      "That is Chris' call.",
    );
  });

  it("coref normalization lets a name-based query match a first-person turn", async () => {
    // Two distinct first-person turns by different speakers; without coref the
    // speaker name appears in neither content, so a name-based query cannot
    // distinguish them. With coref, "I/my" become the speaker name.
    const testCase: LocomoCase = {
      caseId: "coref",
      sourceConversation: "coref",
      speakers: ["Jon", "Gina"],
      turns: [
        {
          diaId: "D1:1",
          speaker: "Gina",
          content: "I just adopted a rescue greyhound.",
        },
        {
          diaId: "D1:2",
          speaker: "Jon",
          content: "I opened my pottery studio downtown.",
        },
      ],
      questions: [],
    };
    const scope = buildLocomoScope({ caseId: "coref", runId: "t" });

    const normalized = createLocomoSmokeMemory();
    await seedLocomoCase({
      corefNormalize: true,
      memory: normalized,
      runId: "t",
      testCase,
    });
    // "What did Jon open?" now matches Jon's turn (coref injected "Jon" into the
    // content) and resolves to D1:2 rather than Gina's turn.
    const retrieved = collectLocomoRetrievedTurnIds(
      await normalized.recall({
        query: "What did Jon open downtown?",
        scope,
        strategy: "rules-only",
      }),
    );
    expect(retrieved).toContain("D1:2");
  });

  it("seeds label-free turns without the external-benchmark category", async () => {
    let rememberInput: Parameters<GoodMemory["remember"]>[0] | undefined;
    const memory = {
      async remember(input: Parameters<GoodMemory["remember"]>[0]) {
        rememberInput = input;
      },
    } as unknown as GoodMemory;
    const testCase = (
      await loadLocomoCases({ readFile: async () => "" })
    ).cases[0]!;
    await seedLocomoCase({
      labelFreeIngest: true,
      memory,
      runId: "label-free",
      testCase,
    });

    expect(rememberInput?.annotations).not.toBeUndefined();
    expect(
      rememberInput?.annotations?.every(
        (annotation) =>
          annotation.metadataPatch?.category !== "external_benchmark" &&
          !annotation.metadataPatch?.tags?.includes("locomo"),
      ),
    ).toBe(true);
  });

  it("smart fusion drops conversational facts that merely echo their raw turn", async () => {
    const testCase: LocomoCase = {
      caseId: "smart",
      sourceConversation: "smart",
      speakers: ["Caroline", "Melanie"],
      turns: [
        {
          diaId: "D1:1",
          speaker: "Caroline",
          content: "The vault access code is 7788 for the downtown lab.",
        },
        { diaId: "D1:2", speaker: "Caroline", content: "Yeah, I finally went." },
      ],
      questions: [],
    };
    const extractor: MemoryExtractor = {
      async extract() {
        return {
          candidates: [
            {
              id: "a",
              kindHint: "fact",
              explicitness: "explicit",
              // Near-verbatim echo of turn 0 -> dropped by smart fusion.
              content: "The vault access code is 7788 for the downtown lab.",
              sourceMessageIndex: 0,
              sourceRole: "user",
            },
            {
              id: "b",
              kindHint: "fact",
              explicitness: "explicit",
              // Genuinely normalized claim from turn 1 -> kept.
              content: "Caroline attended the contemporary dance workshop.",
              sourceMessageIndex: 1,
              sourceRole: "user",
            },
          ],
          ignoredMessageCount: 0,
        };
      },
    };

    const memory = createLocomoSmokeMemory();
    await seedLocomoCaseConversational({
      extractor,
      memory,
      runId: "t",
      smartFusion: true,
      testCase,
    });
    const scope = buildLocomoScope({ caseId: "smart", runId: "t" });

    // The near-copy fact (D1:1) was dropped, so the vault code is not retrievable
    // from a stored fact; the normalized fact (D1:2) was kept.
    const vault = await memory.recall({
      query: "What is the vault access code?",
      scope,
      strategy: "rules-only",
    });
    expect(collectLocomoRetrievedTurnIds(vault)).not.toContain("D1:1");
    const dance = await memory.recall({
      query: "What workshop did Caroline attend?",
      scope,
      strategy: "rules-only",
    });
    expect(collectLocomoRetrievedTurnIds(dance)).toContain("D1:2");
  });
});

describe("phase-65 LoCoMo resume checkpoint + extraction cache", () => {
  const outputDir = "/tmp/locomo-out";
  const runId = "run-locomo-resume";
  const progressPath = join(outputDir, runId, "live-progress.jsonl");

  // Checkpointing is active only for model-backed runs, so the tests inject a
  // deterministic answer generator to flip the runner into live-answer mode.
  const answerGenerator = async (): Promise<string> => "checkpoint-answer";

  async function firstRun(): Promise<{
    lines: string[];
    progress: string;
    report: Awaited<ReturnType<typeof runLocomoSmoke>>;
  }> {
    const lines: string[] = [];
    let progressSeed = "";
    const report = await runLocomoSmoke(
      { outputDir, runId },
      {
        answerGenerator,
        appendFile: async (_path, data) => {
          lines.push(data);
        },
        mkdir: async () => undefined,
        writeFile: (async (path: string, data: string) => {
          if (path === progressPath) {
            progressSeed = data;
          }
        }) as never,
      },
    );
    return { lines, progress: `${progressSeed}${lines.join("")}`, report };
  }

  it("stays checkpoint-free in retrieval-only mode", async () => {
    const appended: string[] = [];
    const writes: string[] = [];
    await runLocomoSmoke(
      { outputDir, runId: "run-locomo-retrieval-only" },
      {
        appendFile: async (_path, data) => {
          appended.push(data);
        },
        mkdir: async () => undefined,
        writeFile: (async (path: string) => {
          writes.push(path);
        }) as never,
      },
    );
    expect(appended).toEqual([]);
    expect(writes.length).toBe(1);
  });

  it("checkpoints provider-backed retrieval-only runs and resumes without reseeding completed cases", async () => {
    const providerRunId = "run-locomo-provider-retrieval-resume";
    const providerProgressPath = join(
      outputDir,
      providerRunId,
      "live-progress.jsonl",
    );
    const lines: string[] = [];
    let progressSeed = "";
    const report = await runLocomoSmoke(
      {
        outputDir,
        providerEmbedding: true,
        runId: providerRunId,
      },
      {
        appendFile: async (_path, data) => {
          lines.push(data);
        },
        createMemory: () => createLocomoSmokeMemory(),
        mkdir: async () => undefined,
        writeFile: (async (path: string, data: string) => {
          if (path === providerProgressPath) {
            progressSeed = data;
          }
        }) as never,
      },
    );

    expect(report.mode).toBe("retrieval-only");
    expect(report.semanticCandidateEmbeddingSource).toBe("provider");
    expect(lines.length).toBe(report.questionCount);
    expect(progressSeed).toContain("locomo-progress-config");

    let memoryCreations = 0;
    const resumed = await runLocomoSmoke(
      {
        outputDir,
        providerEmbedding: true,
        resume: true,
        runId: providerRunId,
      },
      {
        appendFile: async () => undefined,
        createMemory: () => {
          memoryCreations += 1;
          throw new Error("fully-checkpointed provider case must skip seeding");
        },
        mkdir: async () => undefined,
        readFile: async (path) => {
          if (path === providerProgressPath) {
            return `${progressSeed}${lines.join("")}`;
          }
          throw new Error(`unexpected read: ${path}`);
        },
        writeFile: (async () => undefined) as never,
      },
    );

    expect(memoryCreations).toBe(0);
    expect(resumed.resume).toBe(true);
    expect(resumed.mode).toBe("retrieval-only");
    expect(resumed.executionFailures).toBe(0);
    expect(resumed.questionCount).toBe(report.questionCount);
    expect(resumed.cases.map((entry) => entry.questionId).sort()).toEqual(
      report.cases.map((entry) => entry.questionId).sort(),
    );
  });

  it("retains failed seed rows in the report without checkpointing them", async () => {
    const failedRunId = "run-locomo-seed-failure-retention";
    const failedProgressPath = join(outputDir, failedRunId, "live-progress.jsonl");
    const appended: string[] = [];
    let progressSeed = "";
    const extractor: MemoryExtractor = {
      async extract() {
        throw new Error("synthetic extraction failure");
      },
    };

    const report = await runLocomoSmoke(
      {
        conversationalExtraction: true,
        outputDir,
        runId: failedRunId,
      },
      {
        appendFile: async (_path, data) => {
          appended.push(data);
        },
        conversationalExtractor: extractor,
        mkdir: async () => undefined,
        writeFile: (async (path: string, data: string) => {
          if (path === failedProgressPath) {
            progressSeed = data;
          }
        }) as never,
      },
    );

    expect(progressSeed).toContain("locomo-progress-config");
    expect(appended).toEqual([]);
    expect(report.executionFailures).toBe(report.questionCount);
    expect(report.cases.length).toBe(report.questionCount);
    expect(report.cases.every((entry) => entry.generatedAnswer === null)).toBe(
      true,
    );
    expect(report.cases.every((entry) => entry.retrievedTurnIds.length === 0)).toBe(
      true,
    );
    expect(
      report.cases.every((entry) => entry.executionFailureStage === "seed"),
    ).toBe(true);
    expect(
      report.cases.every((entry) =>
        entry.executionFailureMessage?.includes("synthetic extraction failure"),
      ),
    ).toBe(true);
  });

  it("retains failed answer rows with retrieval metrics without checkpointing them", async () => {
    const failedRunId = "run-locomo-answer-failure-retention";
    const failedProgressPath = join(outputDir, failedRunId, "live-progress.jsonl");
    const appended: string[] = [];
    let progressSeed = "";

    const report = await runLocomoSmoke(
      {
        outputDir,
        runId: failedRunId,
      },
      {
        answerGenerator: async () => {
          throw new Error("synthetic answer failure");
        },
        appendFile: async (_path, data) => {
          appended.push(data);
        },
        mkdir: async () => undefined,
        writeFile: (async (path: string, data: string) => {
          if (path === failedProgressPath) {
            progressSeed = data;
          }
        }) as never,
      },
    );

    expect(progressSeed).toContain("locomo-progress-config");
    expect(appended).toEqual([]);
    expect(report.executionFailures).toBe(report.questionCount);
    expect(report.cases.length).toBe(report.questionCount);
    expect(report.cases.some((entry) => entry.retrievedTurnIds.length > 0)).toBe(
      true,
    );
    expect(report.cases.every((entry) => entry.generatedAnswer === null)).toBe(
      true,
    );
    expect(report.cases.every((entry) => entry.answerCorrect === null)).toBe(true);
    expect(
      report.cases.every((entry) => entry.executionFailureStage === "answer"),
    ).toBe(true);
    expect(
      report.cases.every((entry) =>
        entry.executionFailureMessage?.includes("synthetic answer failure"),
      ),
    ).toBe(true);
    expect(() =>
      assertLocomoReportQuestionCountMatchesCases({
        path: join(outputDir, failedRunId, "smoke-report.json"),
        report: {
          ...report,
          executionFailures: report.executionFailures - 1,
        },
      }),
    ).toThrow(
      `executionFailures ${report.executionFailures - 1} does not match ` +
        `failed live-answer rows ${report.questionCount}`,
    );

    const firstFailedCase = report.cases[0];
    if (!firstFailedCase) {
      throw new Error("expected at least one failed LoCoMo case");
    }
    expect(() =>
      assertLocomoReportQuestionCountMatchesCases({
        path: join(outputDir, failedRunId, "smoke-report.json"),
        report: {
          ...report,
          cases: [
            {
              ...firstFailedCase,
              executionFailureMessage: "synthetic answer failure",
              executionFailureStage: "unknown-stage" as never,
            },
          ],
          questionCount: 1,
        },
      }),
    ).toThrow("executionFailureStage");
    expect(() =>
      assertLocomoReportQuestionCountMatchesCases({
        path: join(outputDir, failedRunId, "smoke-report.json"),
        report: {
          ...report,
          cases: [
            {
              ...firstFailedCase,
              executionFailureMessage: null,
            },
          ],
          questionCount: 1,
        },
      }),
    ).toThrow("must carry executionFailureStage and executionFailureMessage together");
    expect(() =>
      assertLocomoReportQuestionCountMatchesCases({
        path: join(outputDir, failedRunId, "smoke-report.json"),
        report: {
          ...report,
          cases: [
            {
              ...firstFailedCase,
              answerTokenF1: 0.5,
            },
          ],
          questionCount: 1,
        },
      }),
    ).toThrow(
      `unscored row ${firstFailedCase.caseId}::${firstFailedCase.questionId} ` +
        "carries answerTokenF1",
    );

    expect(() =>
      assertLocomoReportQuestionCountMatchesCases({
        path: join(outputDir, failedRunId, "smoke-report.json"),
        report: {
          ...report,
          answerEvaluation: "deferred-to-live-mode",
          cases: [
            {
              ...firstFailedCase,
              answerTokenF1: 0.75,
              executionFailureMessage: null,
              executionFailureStage: null,
            },
          ],
          executionFailures: 0,
          mode: "retrieval-only",
          questionCount: 1,
        },
      }),
    ).toThrow(
      `unscored row ${firstFailedCase.caseId}::${firstFailedCase.questionId} ` +
        "carries answerTokenF1",
    );
  });

  it("checkpoints one line per completed question and replays them on --resume without reseeding", async () => {
    const { lines, progress, report } = await firstRun();
    expect(report.resume).toBe(false);
    expect(report.questionCount).toBeGreaterThan(1);
    expect(lines.length).toBe(report.questionCount);

    let memoryCreations = 0;
    const resumed = await runLocomoSmoke(
      { outputDir, runId, resume: true },
      {
        answerGenerator,
        appendFile: async () => undefined,
        createMemory: () => {
          memoryCreations += 1;
          throw new Error("fully-checkpointed case must skip seeding");
        },
        mkdir: async () => undefined,
        readFile: async (path) => {
          if (path === progressPath) {
            return progress;
          }
          throw new Error(`unexpected read: ${path}`);
        },
        writeFile: (async () => undefined) as never,
      },
    );
    expect(memoryCreations).toBe(0);
    expect(resumed.resume).toBe(true);
    expect(resumed.executionFailures).toBe(0);
    expect(resumed.questionCount).toBe(report.questionCount);
    expect(resumed.cases.map((entry) => entry.questionId).sort()).toEqual(
      report.cases.map((entry) => entry.questionId).sort(),
    );
  });

  it("rejects --resume when the checkpoint belongs to a different experiment config", async () => {
    const { progress } = await firstRun();

    await expect(
      runLocomoSmoke(
        {
          outputDir,
          resume: true,
          runId,
          semanticCandidates: true,
          semanticCandidateTopK: 8,
        },
        {
          answerGenerator,
          appendFile: async () => undefined,
          mkdir: async () => undefined,
          readFile: async (path) => {
            if (path === progressPath) {
              return progress;
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: (async () => undefined) as never,
        },
      ),
    ).rejects.toThrow("LoCoMo progress config fingerprint mismatch");
  });

  it("rejects a checkpoint whose config or schema version was tampered with", async () => {
    const { progress } = await firstRun();
    const [headerLine, ...rowLines] = progress.trimEnd().split("\n");
    const header = JSON.parse(headerLine ?? "null") as Record<string, unknown>;
    const config = header.config as Record<string, unknown>;

    const tamperedConfigProgress = [
      JSON.stringify({
        ...header,
        config: {
          ...config,
          rerank: !config.rerank,
        },
      }),
      ...rowLines,
      "",
    ].join("\n");
    await expect(
      runLocomoSmoke(
        { outputDir, resume: true, runId },
        {
          answerGenerator,
          appendFile: async () => undefined,
          mkdir: async () => undefined,
          readFile: async (path) => {
            if (path === progressPath) {
              return tamperedConfigProgress;
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: (async () => undefined) as never,
        },
      ),
    ).rejects.toThrow("LoCoMo progress config fingerprint is invalid");

    const staleVersionProgress = [
      JSON.stringify({ ...header, version: 1 }),
      ...rowLines,
      "",
    ].join("\n");
    await expect(
      runLocomoSmoke(
        { outputDir, resume: true, runId },
        {
          answerGenerator,
          appendFile: async () => undefined,
          mkdir: async () => undefined,
          readFile: async (path) => {
            if (path === progressPath) {
              return staleVersionProgress;
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: (async () => undefined) as never,
        },
      ),
    ).rejects.toThrow("does not include a valid version 2 config header");
  });

  it("rejects duplicate or out-of-scope progress rows before resume replay", () => {
    const selectedQuestionKeys = new Set([locomoQuestionKey("case-1", "q1")]);
    const firstRow = {
      answerCorrect: true,
      caseId: "case-1",
      category: "single_hop",
      evidenceRecall: 1,
      evidenceTurnIds: ["D1:1"],
      generatedAnswer: "answer",
      goldEvidenceFullyRetrieved: true,
      missingEvidenceTurnIds: [],
      noiseTurnCount: 0,
      noiseTurnIds: [],
      questionId: "q1",
      retrievedTurnIds: ["D1:1"],
    };

    expect(() =>
      readLocomoProgressRowsForSelection({
        progressPath,
        raw: `${JSON.stringify(firstRow)}\n${JSON.stringify({
          ...firstRow,
          answerCorrect: false,
        })}\n`,
        selectedQuestionKeys,
      }),
    ).toThrow(
      `duplicate LoCoMo progress row for ${locomoQuestionKey("case-1", "q1")}`,
    );

    expect(() =>
      readLocomoProgressRowsForSelection({
        progressPath,
        raw: `${JSON.stringify({
          ...firstRow,
          caseId: "case-2",
        })}\n`,
        selectedQuestionKeys,
      }),
    ).toThrow(
      `LoCoMo progress row ${locomoQuestionKey("case-2", "q1")} is outside selected scope`,
    );
  });

  it("re-scores checkpointed live answers on resume with the current scorer", async () => {
    const testCase: LocomoCase = {
      caseId: "external-adversarial",
      sourceConversation: "external-adversarial",
      speakers: ["Audrey", "Andrew"],
      turns: [
        {
          diaId: "D1:1",
          speaker: "Audrey",
          content: "I never said what kind of flowers the tattoo shows.",
        },
      ],
      questions: [
        {
          adversarialAnswer: "sunflowers",
          category: "adversarial",
          evidenceTurnIds: ["D1:1"],
          goldAnswer: "No information available",
          matchMode: "adversarial_abstention",
          question: "What kind of flowers does Andrew have a tattoo of?",
          questionId: "external-adversarial:1",
        },
      ],
    };
    const staleCheckpoint: LocomoQuestionRetrieval = {
      answerCorrect: false,
      caseId: testCase.caseId,
      category: "adversarial",
      evidenceRecall: 1,
      evidenceTurnIds: ["D1:1"],
      generatedAnswer: "I do not know",
      goldEvidenceFullyRetrieved: true,
      missingEvidenceTurnIds: [],
      noiseTurnCount: 0,
      noiseTurnIds: [],
      questionId: "external-adversarial:1",
      retrievedTurnIds: ["D1:1"],
    };
    const resumedRunId = "run-locomo-resume-rescore";
    const resumedProgressPath = join(outputDir, resumedRunId, "live-progress.jsonl");
    let progressSeed = "";
    await runLocomoSmoke(
      {
        benchmarkRoot: "/tmp/LOCOMO",
        caseIds: [testCase.caseId],
        outputDir,
        runId: resumedRunId,
      },
      {
        answerGenerator,
        appendFile: async () => undefined,
        mkdir: async () => undefined,
        readFile: async (path) => {
          if (path === join("/tmp/LOCOMO", "cases.json")) {
            return JSON.stringify({ cases: [testCase] });
          }
          throw new Error(`unexpected read: ${path}`);
        },
        writeFile: (async (path: string, data: string) => {
          if (path === resumedProgressPath) {
            progressSeed = data;
          }
        }) as never,
      },
    );
    const resumed = await runLocomoSmoke(
      {
        benchmarkRoot: "/tmp/LOCOMO",
        caseIds: [testCase.caseId],
        outputDir,
        resume: true,
        runId: resumedRunId,
      },
      {
        answerGenerator,
        appendFile: async () => undefined,
        createMemory: () => {
          throw new Error("fully-checkpointed case must skip seeding");
        },
        mkdir: async () => undefined,
        readFile: async (path) => {
          if (path === join("/tmp/LOCOMO", "cases.json")) {
            return JSON.stringify({ cases: [testCase] });
          }
          if (path === resumedProgressPath) {
            return `${progressSeed}${JSON.stringify(staleCheckpoint)}\n`;
          }
          throw new Error(`unexpected read: ${path}`);
        },
        writeFile: (async () => undefined) as never,
      },
    );

    expect(resumed.questionCount).toBe(1);
    expect(resumed.cases[0]?.answerCorrect).toBe(true);
    expect(category(resumed, "adversarial").answerAccuracy).toBe(1);
  });

  it("recomputes only the questions missing from the checkpoint on --resume", async () => {
    const { lines, progress, report } = await firstRun();
    expect(lines.length).toBeGreaterThan(1);
    const partial = lines.slice(0, -1);
    const progressSeed = progress.slice(0, progress.length - lines.join("").length);
    const appended: string[] = [];
    const resumed = await runLocomoSmoke(
      { outputDir, runId, resume: true },
      {
        answerGenerator,
        appendFile: async (_path, data) => {
          appended.push(data);
        },
        mkdir: async () => undefined,
        readFile: async (path) => {
          if (path === progressPath) {
            return `${progressSeed}${partial.join("")}`;
          }
          throw new Error(`unexpected read: ${path}`);
        },
        writeFile: (async () => undefined) as never,
      },
    );
    expect(appended.length).toBe(1);
    expect(resumed.questionCount).toBe(report.questionCount);
    expect(resumed.executionFailures).toBe(0);
  });

  it("wraps the extractor in a content-addressed jsonl cache", async () => {
    const { parseLocomoExtractionCacheLines, wrapMemoryExtractorWithJsonlCache } =
      await import("../../scripts/run-phase-65-locomo-smoke");
    let calls = 0;
    const underlying: MemoryExtractor = {
      async extract(input) {
        calls += 1;
        return {
          candidates: [
            {
              content: `extracted from ${input.messages.length} messages`,
              explicitness: "explicit",
              id: "cand-1",
              kindHint: "fact",
              sourceMessageIndex: 0,
              sourceRole: "user",
            },
          ],
          ignoredMessageCount: 0,
        } as Awaited<ReturnType<MemoryExtractor["extract"]>>;
      },
    };
    const appendedLines: string[] = [];
    const wrapped = wrapMemoryExtractorWithJsonlCache(underlying, {
      appendFile: async (_path, data) => {
        appendedLines.push(data);
      },
      cachePath: "/tmp/locomo-out/cache.jsonl",
      configTag: "test-model",
      initialCache: new Map(),
    });
    const input = {
      messages: [{ content: "Jon: I lost my job", role: "user" as const }],
      scope: buildLocomoScope({ caseId: "c", runId: "r" }),
    };
    const first = await wrapped.extract(input);
    const second = await wrapped.extract(input);
    expect(calls).toBe(1);
    expect(second.candidates).toEqual(first.candidates);
    expect(appendedLines.length).toBe(1);

    const revived = wrapMemoryExtractorWithJsonlCache(underlying, {
      appendFile: async () => undefined,
      cachePath: "/tmp/locomo-out/cache.jsonl",
      configTag: "test-model",
      initialCache: parseLocomoExtractionCacheLines(appendedLines.join("")),
    });
    const third = await revived.extract(input);
    expect(calls).toBe(1);
    expect(third.candidates).toEqual(first.candidates);

    // A different config tag misses the cache.
    const otherTag = wrapMemoryExtractorWithJsonlCache(underlying, {
      appendFile: async () => undefined,
      cachePath: "/tmp/locomo-out/cache.jsonl",
      configTag: "other-model",
      initialCache: parseLocomoExtractionCacheLines(appendedLines.join("")),
    });
    await otherTag.extract(input);
    expect(calls).toBe(2);
  });

  it("serializes jsonl cache appends across concurrent extractions", async () => {
    const underlying: MemoryExtractor = {
      async extract(input) {
        return {
          candidates: [
            {
              content: input.messages[0]!.content,
              explicitness: "explicit",
              id: input.messages[0]!.content,
              kindHint: "fact",
              sourceMessageIndex: 0,
              sourceRole: "user",
            },
          ],
          ignoredMessageCount: 0,
        };
      },
    };
    let activeAppends = 0;
    let maxActiveAppends = 0;
    const wrapped = wrapMemoryExtractorWithJsonlCache(underlying, {
      appendFile: async () => {
        activeAppends += 1;
        maxActiveAppends = Math.max(maxActiveAppends, activeAppends);
        await new Promise((resolve) => setTimeout(resolve, 20));
        activeAppends -= 1;
      },
      cachePath: "/tmp/locomo-out/cache.jsonl",
      configTag: "test-model",
      initialCache: new Map(),
    });
    const scope = buildLocomoScope({ caseId: "c", runId: "r" });

    await Promise.all([
      wrapped.extract({
        messages: [{ content: "first", role: "user" }],
        scope,
      }),
      wrapped.extract({
        messages: [{ content: "second", role: "user" }],
        scope,
      }),
    ]);

    expect(maxActiveAppends).toBe(1);
  });

  it("skips broken checkpoint tail lines", async () => {
    const { parseLocomoProgressLines } = await import(
      "../../scripts/run-phase-65-locomo-smoke"
    );
    const good = locomoProgressRow();
    const parsed = parseLocomoProgressLines(
      `${JSON.stringify(good)}\n{"caseId":"c1","questionId":"q2","evi`,
    );
    expect(parsed.length).toBe(1);
    expect(parsed[0]?.questionId).toBe("q1");
  });

  it("rejects broken checkpoint lines before the tail", async () => {
    const { parseLocomoProgressLines } = await import(
      "../../scripts/run-phase-65-locomo-smoke"
    );
    const good = locomoProgressRow();
    expect(() =>
      parseLocomoProgressLines(
        `${JSON.stringify(good)}\n{"caseId":"c1","questionId":"q2","evi\n${JSON.stringify({
          ...good,
          questionId: "q3",
        })}\n`,
      ),
    ).toThrow("malformed LoCoMo progress line 2");
  });

  it("rejects malformed checkpoint objects but still skips the config header", async () => {
    const { parseLocomoProgressLines } = await import(
      "../../scripts/run-phase-65-locomo-smoke"
    );
    const { progress } = await firstRun();
    const header = JSON.parse(progress.split("\n")[0] ?? "null") as unknown;
    const good = locomoProgressRow();

    const parsed = parseLocomoProgressLines(
      `${JSON.stringify(header)}\n${JSON.stringify(good)}\n`,
    );
    expect(parsed.length).toBe(1);
    expect(parsed[0]?.caseId).toBe("c1");
    expect(parsed[0]?.questionId).toBe("q1");

    expect(() =>
      parseLocomoProgressLines(
        `${JSON.stringify(header)}\n{}\n${JSON.stringify(good)}\n`,
      ),
    ).toThrow("malformed LoCoMo progress line 2");

    expect(() =>
      parseLocomoProgressLines(
        `${JSON.stringify(header)}\n${JSON.stringify({
          ...good,
          evidenceTurnIds: undefined,
        })}\n`,
      ),
    ).toThrow("malformed LoCoMo progress line 2");
  });
});
