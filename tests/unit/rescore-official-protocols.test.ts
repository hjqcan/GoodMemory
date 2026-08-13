import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertOfficialRescoreRunIdentityCompatible,
  assertOfficialRescoreSourceInputsOutsideOutputDir,
  assertOfficialRescoreSummaryValid,
  buildLongMemEvalRescorePrompt,
  buildOfficialRescoreRunIdentity,
  buildOfficialRescoreMetadata,
  buildOfficialRescoreScopeMetadata,
  buildOfficialRescoreSourceInputFingerprints,
  ensureOfficialRescoreRunIdentity,
  loadLongmemevalCases,
  parseOfficialRescoreCliOptions,
  parseOfficialRescoreProgressLine,
  parseOfficialRescoreRubricProgressLine,
  requireOfficialRescoreCompleteJudging,
  readOfficialRescoreProgressRows,
  readOfficialRescoreRubricProgressRows,
  requireOfficialRescoreProgressRowsWithinSelection,
  requireOfficialRescoreRubricProgressRowsWithinSelection,
  resolveOfficialRescoreJudgeEnvironment,
  resolveOfficialRescoreRequestTimeoutMs,
  serializeOfficialRescoreProgressRow,
  serializeOfficialRescoreRubricProgressRow,
  validateOfficialRescoreSummary,
} from "../../scripts/rescore-official-protocols";

function judgeIdentity(model: string) {
  return {
    judgeGateway: "https://judge.example/v1",
    judgeModel: model,
    judgeProvider: "openai",
  };
}

describe("official protocol rescore CLI", () => {
  it("parses a canonical benchmark rescore command", () => {
    expect(
      parseOfficialRescoreCliOptions([
        "bun",
        "scripts/rescore-official-protocols.ts",
        "--benchmark",
        "locomo",
        "--report",
        "/reports/locomo/smoke-report.json",
        "--root",
        "/private/tmp/LOCOMO-full/cases.json",
        "--run-id",
        "locomo-official-rescore-current",
        "--concurrency",
        "2",
        "--limit",
        "25",
      ]),
    ).toEqual({
      benchmark: "locomo",
      concurrency: 2,
      limit: 25,
      reportPath: "/reports/locomo/smoke-report.json",
      rootPath: "/private/tmp/LOCOMO-full/cases.json",
      runId: "locomo-official-rescore-current",
    });
  });

  it("rejects ambiguous or unsafe rescore selectors", () => {
    expect(() =>
      parseOfficialRescoreCliOptions([
        "bun",
        "scripts/rescore-official-protocols.ts",
        "--benchmark",
        "locomo",
        "--canonical-output",
        "benchmark-claims/evidence/locomo.json",
      ]),
    ).toThrow("stored-answer rescore cannot emit canonical claim artifacts");

    expect(() =>
      parseOfficialRescoreCliOptions([
        "bun",
        "scripts/rescore-official-protocols.ts",
        "--benchmark",
        "beam",
        "--benchmark",
        "locomo",
      ]),
    ).toThrow("--benchmark cannot be specified more than once.");

    expect(() =>
      parseOfficialRescoreCliOptions([
        "bun",
        "scripts/rescore-official-protocols.ts",
        "--benchmark",
        "beam",
        "--run-id",
        "../beam-official",
      ]),
    ).toThrow("--run-id must be a single path segment.");

    expect(() =>
      parseOfficialRescoreCliOptions([
        "bun",
        "scripts/rescore-official-protocols.ts",
        "--benchmark",
        "longmemeval",
        "--limit",
        "1.5",
      ]),
    ).toThrow("--limit must be a positive integer.");

    expect(() =>
      parseOfficialRescoreCliOptions([
        "bun",
        "scripts/rescore-official-protocols.ts",
        "--benchmark",
        "unknown",
      ]),
    ).toThrow("--benchmark must be longmemeval, locomo, or beam.");
  });

  it("rejects benchmark-incompatible source selectors", () => {
    expect(() =>
      parseOfficialRescoreCliOptions([
        "bun",
        "scripts/rescore-official-protocols.ts",
        "--benchmark",
        "locomo",
        "--reference",
        "/tmp/longmemeval.json",
      ]),
    ).toThrow("--reference is only valid with --benchmark longmemeval.");

    expect(() =>
      parseOfficialRescoreCliOptions([
        "bun",
        "scripts/rescore-official-protocols.ts",
        "--benchmark",
        "beam",
        "--root",
        "/tmp/locomo/cases.json",
      ]),
    ).toThrow("--root is only valid with --benchmark locomo.");

    expect(() =>
      parseOfficialRescoreCliOptions([
        "bun",
        "scripts/rescore-official-protocols.ts",
        "--benchmark",
        "longmemeval",
        "--rubrics",
        "/tmp/beam/rubrics-by-question-id.json",
      ]),
    ).toThrow("--rubrics is only valid with --benchmark beam.");

    expect(() =>
      parseOfficialRescoreCliOptions([
        "bun",
        "scripts/rescore-official-protocols.ts",
        "--benchmark",
        "locomo",
        "--profile",
        "goodmemory-recommended",
      ]),
    ).toThrow("--profile is only valid with --benchmark longmemeval.");
  });

  it("selects and records an explicit LongMemEval source profile", async () => {
    const root = await mkdtemp(join(tmpdir(), "gm-longmemeval-profile-"));
    try {
      const referencePath = join(root, "longmemeval_s_cleaned.json");
      const reportPath = join(root, "report.json");
      await writeFile(
        referencePath,
        JSON.stringify([
          {
            answer: "recommended answer",
            question: "What was remembered?",
            question_id: "q1",
            question_type: "single-session-user",
          },
        ]),
      );
      await writeFile(
        reportPath,
        JSON.stringify({
          profiles: {
            "goodmemory-recommended": {
              cases: [{ hypothesis: "recommended answer", questionId: "q1" }],
            },
            "goodmemory-rules-only": {
              cases: [{ hypothesis: "rules answer", questionId: "q1" }],
            },
          },
        }),
      );

      expect(
        parseOfficialRescoreCliOptions([
          "bun",
          "scripts/rescore-official-protocols.ts",
          "--benchmark",
          "longmemeval",
          "--profile",
          "goodmemory-recommended",
          "--run-id",
          "longmemeval-recommended-current",
        ]),
      ).toEqual({
        benchmark: "longmemeval",
        concurrency: 4,
        profile: "goodmemory-recommended",
        runId: "longmemeval-recommended-current",
      });
      const loaded = await loadLongmemevalCases({
        profile: "goodmemory-recommended",
        referencePath,
        reportPath,
      });
      expect(loaded.cases).toHaveLength(1);
      expect(loaded.cases[0]?.hypothesis).toBe("recommended answer");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects source inputs inside the official-rescore output run directory", () => {
    expect(() =>
      assertOfficialRescoreSourceInputsOutsideOutputDir({
        outputDir:
          "/repo/reports/eval/research/official-rescore/locomo-official-current",
        sourceInputs: {
          reportPath:
            "/repo/reports/eval/research/official-rescore/locomo-official-current/source-report.json",
          rootPath: "/private/tmp/LOCOMO-full/cases.json",
        },
      }),
    ).toThrow(
      "official rescore source input reportPath resolves inside output run directory",
    );

    expect(() =>
      assertOfficialRescoreSourceInputsOutsideOutputDir({
        outputDir:
          "/repo/reports/eval/research/official-rescore/beam-official-current",
        sourceInputs: {
          reportPath: "/repo/reports/eval/live/beam-report.json",
          rubricsPath:
            "/repo/reports/eval/research/official-rescore/beam-official-current",
        },
      }),
    ).toThrow(
      "official rescore source input rubricsPath resolves inside output run directory",
    );
  });

  it("requires canonical judge environment before rescore identity creation", () => {
    expect(() =>
      resolveOfficialRescoreJudgeEnvironment({
        GOODMEMORY_JUDGE_API_KEY: "key",
        GOODMEMORY_JUDGE_BASE_URL: "https://judge.example/v1",
      }),
    ).toThrow("GOODMEMORY_JUDGE_MODEL is required");

    expect(() =>
      resolveOfficialRescoreJudgeEnvironment({
        GOODMEMORY_JUDGE_API_KEY: "key",
        GOODMEMORY_JUDGE_BASE_URL: " https://judge.example/v1",
        GOODMEMORY_JUDGE_MODEL: "gpt-5.4-mini",
      }),
    ).toThrow("GOODMEMORY_JUDGE_BASE_URL must not have leading or trailing whitespace");

    expect(
      resolveOfficialRescoreJudgeEnvironment({
        GOODMEMORY_JUDGE_API_KEY: "key",
        GOODMEMORY_JUDGE_BASE_URL: "https://judge.example/v1",
        GOODMEMORY_JUDGE_MODEL: "gpt-5.4-mini",
      }),
    ).toEqual({
      apiKey: "key",
      baseURL: "https://judge.example/v1",
      model: "gpt-5.4-mini",
    });
  });

  it("bounds each official-rescore judge request", () => {
    expect(resolveOfficialRescoreRequestTimeoutMs({})).toBe(180_000);
    expect(
      resolveOfficialRescoreRequestTimeoutMs({
        GOODMEMORY_OFFICIAL_RESCORE_REQUEST_TIMEOUT_MS: "120000",
      }),
    ).toBe(120_000);
    expect(() =>
      resolveOfficialRescoreRequestTimeoutMs({
        GOODMEMORY_OFFICIAL_RESCORE_REQUEST_TIMEOUT_MS: "0",
      }),
    ).toThrow(
      "GOODMEMORY_OFFICIAL_RESCORE_REQUEST_TIMEOUT_MS must be a positive integer",
    );
  });

  it("rejects final official-rescore summaries when judge failures remain", () => {
    expect(() =>
      requireOfficialRescoreCompleteJudging({
        failureCount: 0,
        label: "locomo",
      }),
    ).not.toThrow();

    expect(() =>
      requireOfficialRescoreCompleteJudging({
        failureCount: 2,
        label: "beam",
      }),
    ).toThrow(
      "official rescore beam had 2 judge failure(s); rerun with the same run id to resume before writing a final summary.",
    );
  });

  it("builds auditable diagnostic metadata for stored-answer rescore reports", () => {
    expect(
      buildOfficialRescoreMetadata({
        benchmark: "beam",
        generatedAt: "2026-07-05T16:10:00.000Z",
        ...judgeIdentity("gpt-5.4-mini"),
        limit: 25,
        outputPath:
          "/repo/reports/eval/research/official-rescore/beam-current/rescore-summary.json",
        runId: "beam-current",
        sourceInputs: {
          reportPath: "/reports/beam/live-slice-report.json",
          rubricsPath: "/tmp/BEAM/rubrics-by-question-id.json",
        },
        sourceInputFingerprints: {
          reportPath: {
            bytes: 3,
            sha256: "report-sha",
          },
          rubricsPath: {
            bytes: 4,
            sha256: "rubrics-sha",
          },
        },
      }),
    ).toEqual({
      benchmark: "beam",
      claimBoundary:
        "Official/industry-prompt-compatible stored-answer rescore; numeric comparability is benchmark-specific and requires a matching pinned evaluator configuration; not answer regeneration or a public benchmark claim.",
      generatedAt: "2026-07-05T16:10:00.000Z",
      generatedBy: "scripts/rescore-official-protocols.ts",
      judgeGateway: "https://judge.example/v1",
      judgeModel: "gpt-5.4-mini",
      judgeProvider: "openai",
      limit: 25,
      limitUnit: "rubric-items",
      outputPath:
        "/repo/reports/eval/research/official-rescore/beam-current/rescore-summary.json",
      runId: "beam-current",
      scorerSource: null,
      sourceAnswersUnchanged: true,
      sourceInputFingerprints: {
        reportPath: {
          bytes: 3,
          sha256: "report-sha",
        },
        rubricsPath: {
          bytes: 4,
          sha256: "rubrics-sha",
        },
      },
      sourceInputs: {
        reportPath: "/reports/beam/live-slice-report.json",
        rubricsPath: "/tmp/BEAM/rubrics-by-question-id.json",
      },
    });

    expect(
      buildOfficialRescoreMetadata({
        benchmark: "locomo",
        generatedAt: "2026-07-05T16:20:00.000Z",
        ...judgeIdentity("gpt-5.4-mini"),
        outputPath:
          "/repo/reports/eval/research/official-rescore/locomo-current/rescore-summary.json",
        runId: "locomo-current",
        sourceInputs: {
          reportPath: "/reports/locomo/union-live-report.json",
          rootPath: "/tmp/LOCOMO/cases.json",
        },
        sourceInputFingerprints: {},
      }).limit,
    ).toBe(null);

    expect(
      buildOfficialRescoreMetadata({
        benchmark: "locomo",
        generatedAt: "2026-07-05T16:20:00.000Z",
        ...judgeIdentity("gpt-5.4-mini"),
        outputPath:
          "/repo/reports/eval/research/official-rescore/locomo-current/rescore-summary.json",
        runId: "locomo-current",
        sourceInputs: {
          reportPath: "/reports/locomo/union-live-report.json",
          rootPath: "/tmp/LOCOMO/cases.json",
        },
        sourceInputFingerprints: {},
      }).limitUnit,
    ).toBe("cases");

    expect(
      buildOfficialRescoreMetadata({
        benchmark: "longmemeval",
        generatedAt: "2026-07-13T22:00:00.000Z",
        ...judgeIdentity("gpt-5.4"),
        outputPath: "/reports/official/rescore-summary.json",
        runId: "longmemeval-recommended-current",
        sourceInputFingerprints: {},
        sourceInputs: {
          referencePath: "/data/longmemeval_s_cleaned.json",
          reportPath: "/reports/longmemeval/report.json",
        },
        sourceProfile: "goodmemory-recommended",
      }),
    ).toMatchObject({
      claimBoundary:
        "Pinned-prompt-compatible LongMemEval stored-answer rescore; evaluator openai/gpt-5.4 at https://judge.example/v1 does not match a pinned upstream evaluator identity, so the score is not directly comparable to published official scores; not answer regeneration or a public benchmark claim.",
      sourceProfile: "goodmemory-recommended",
    });
  });

  it("interpolates LongMemEval rescore prompts exactly once", () => {
    const prompt = buildLongMemEvalRescorePrompt(
      {
        category: "single-session-user",
        gold: "{q}",
        hypothesis: "{a}",
        question: "literal {a}",
        questionId: "case-1",
      },
      false,
    );

    expect(prompt).toContain("Question: literal {a}");
    expect(prompt).toContain("Correct Answer: {q}");
    expect(prompt).toContain("Model Response: {a}");
  });

  it("validates complete official-rescore case and BEAM summaries before writing", () => {
    const locomoSummary = {
      ...buildOfficialRescoreMetadata({
        benchmark: "locomo",
        generatedAt: "2026-07-06T02:48:27.294Z",
        ...judgeIdentity("gpt-5.4"),
        outputPath:
          "/repo/reports/eval/research/official-rescore/locomo-current/rescore-summary.json",
        runId: "locomo-current",
        sourceInputs: {
          reportPath: "/reports/locomo/union-live-report.json",
          rootPath: "/private/tmp/LOCOMO-full/cases.json",
        },
        sourceInputFingerprints: {
          reportPath: {
            bytes: 17,
            sha256: "a".repeat(64),
          },
          rootPath: {
            bytes: 23,
            sha256: "b".repeat(64),
          },
        },
      }),
      ...buildOfficialRescoreScopeMetadata({
        benchmark: "locomo",
        selectedCaseCount: 2,
        sourceCaseCount: 2,
      }),
      categories: {
        single_hop: {
          accuracy: 1,
          correct: 2,
          total: 2,
        },
      },
      judgeFailures: 0,
      judgedCases: 2,
      overallAccuracy: 1,
      overallCorrect: 2,
      protocol: "mem0ai/memory-benchmarks LoCoMo judge",
      totalCases: 2,
    };
    expect(validateOfficialRescoreSummary(locomoSummary)).toEqual([]);
    expect(() => assertOfficialRescoreSummaryValid(locomoSummary)).not.toThrow();

    const beamSummary = {
      ...buildOfficialRescoreMetadata({
        benchmark: "beam",
        generatedAt: "2026-07-06T02:48:36.219Z",
        ...judgeIdentity("gpt-5.4"),
        outputPath:
          "/repo/reports/eval/research/official-rescore/beam-current/rescore-summary.json",
        runId: "beam-current",
        sourceInputs: {
          reportPath: "/reports/beam/live-slice-report.json",
          rubricsPath: "/tmp/BEAM/rubrics-by-question-id.json",
        },
        sourceInputFingerprints: {
          reportPath: {
            bytes: 19,
            sha256: "c".repeat(64),
          },
          rubricsPath: {
            bytes: 29,
            sha256: "d".repeat(64),
          },
        },
      }),
      ...buildOfficialRescoreScopeMetadata({
        benchmark: "beam",
        selectedQuestionCount: 2,
        selectedRubricItemCount: 3,
        sourceQuestionCount: 2,
        sourceRubricItemCount: 3,
      }),
      categories: {
        contradiction_resolution: {
          meanScore: 0.75,
          questions: 2,
        },
      },
      judgeFailures: 0,
      overallMacroByCategory: 0.75,
      overallMicroByQuestion: 0.75,
      protocol: "official BEAM unified rubric judge",
      rubricItemsJudged: 3,
      scoredQuestions: 2,
      totalQuestions: 2,
      totalRubricItems: 3,
    };
    expect(validateOfficialRescoreSummary(beamSummary)).toEqual([]);
    expect(() => assertOfficialRescoreSummaryValid(beamSummary)).not.toThrow();
  });

  it("rejects stale or internally inconsistent official-rescore summaries", () => {
    const staleSummary = {
      benchmark: "longmemeval",
      categories: {
        "single-session-user": {
          accuracy: 1,
          correct: 1,
          total: 1,
        },
      },
      generatedBy: "scripts/rescore-official-protocols.ts",
      judgeFailures: 0,
      judgeModel: "gpt-5.4",
      judgedCases: 1,
      overallAccuracy: 1,
      overallCorrect: 1,
      protocol: "official LongMemEval evaluate_qa.py anscheck prompts",
      runId: "rescore-longmemeval-official-judge",
      sourceAnswersUnchanged: true,
      totalCases: 1,
    };
    const staleErrors = validateOfficialRescoreSummary(staleSummary);
    expect(staleErrors).toContain("claimBoundary must match benchmark and judge-model comparability");
    expect(staleErrors).toContain("sourceInputFingerprints must be canonical source fingerprints");
    expect(staleErrors).toContain("sourceInputs must be canonical source input paths");

    const mismatchedSummary = {
      ...buildOfficialRescoreMetadata({
        benchmark: "longmemeval",
        generatedAt: "2026-07-06T02:48:27.294Z",
        ...judgeIdentity("gpt-5.4"),
        outputPath:
          "/repo/reports/eval/research/official-rescore/longmemeval-current/rescore-summary.json",
        runId: "longmemeval-current",
        sourceInputs: {
          referencePath: "/tmp/longmemeval_s.json",
          reportPath: "/reports/longmemeval/report.json",
        },
        sourceInputFingerprints: {
          referencePath: {
            bytes: 31,
            sha256: "e".repeat(64),
          },
          reportPath: {
            bytes: 37,
            sha256: "f".repeat(64),
          },
        },
      }),
      ...buildOfficialRescoreScopeMetadata({
        benchmark: "longmemeval",
        selectedCaseCount: 5,
        sourceCaseCount: 5,
      }),
      categories: {
        "single-session-user": {
          accuracy: 1,
          correct: 4,
          total: 4,
        },
      },
      judgeFailures: 0,
      judgedCases: 4,
      overallAccuracy: 1,
      overallCorrect: 6,
      protocol: "official LongMemEval evaluate_qa.py anscheck prompts",
      totalCases: 5,
    };
    const mismatchErrors = validateOfficialRescoreSummary(mismatchedSummary);
    expect(mismatchErrors).toContain("judgedCases must equal selectedCases");
    expect(mismatchErrors).toContain("overallCorrect cannot exceed selectedCases");
    expect(mismatchErrors).toContain("case category totals must equal selectedCases");
    expect(mismatchErrors).toContain(
      "case category correct sum must equal overallCorrect",
    );
    expect(mismatchErrors).toContain(
      "overallAccuracy must equal overallCorrect / selectedCases",
    );

    const categoryAccuracyMismatch = {
      ...buildOfficialRescoreMetadata({
        benchmark: "locomo",
        generatedAt: "2026-07-06T02:48:27.294Z",
        ...judgeIdentity("gpt-5.4"),
        outputPath:
          "/repo/reports/eval/research/official-rescore/locomo-current/rescore-summary.json",
        runId: "locomo-current",
        sourceInputs: {
          reportPath: "/reports/locomo/union-live-report.json",
          rootPath: "/private/tmp/LOCOMO-full/cases.json",
        },
        sourceInputFingerprints: {
          reportPath: {
            bytes: 17,
            sha256: "a".repeat(64),
          },
          rootPath: {
            bytes: 23,
            sha256: "b".repeat(64),
          },
        },
      }),
      ...buildOfficialRescoreScopeMetadata({
        benchmark: "locomo",
        selectedCaseCount: 2,
        sourceCaseCount: 2,
      }),
      categories: {
        single_hop: {
          accuracy: 1,
          correct: 1,
          total: 2,
        },
      },
      judgeFailures: 0,
      judgedCases: 2,
      overallAccuracy: 0.5,
      overallCorrect: 1,
      protocol: "mem0ai/memory-benchmarks LoCoMo judge",
      totalCases: 2,
    };
    expect(validateOfficialRescoreSummary(categoryAccuracyMismatch)).toContain(
      "case category single_hop accuracy must equal correct / total",
    );

    const beamAggregateMismatch = {
      ...buildOfficialRescoreMetadata({
        benchmark: "beam",
        generatedAt: "2026-07-06T02:48:36.219Z",
        ...judgeIdentity("gpt-5.4"),
        outputPath:
          "/repo/reports/eval/research/official-rescore/beam-current/rescore-summary.json",
        runId: "beam-current",
        sourceInputs: {
          reportPath: "/reports/beam/live-slice-report.json",
          rubricsPath: "/tmp/BEAM/rubrics-by-question-id.json",
        },
        sourceInputFingerprints: {
          reportPath: {
            bytes: 19,
            sha256: "c".repeat(64),
          },
          rubricsPath: {
            bytes: 29,
            sha256: "d".repeat(64),
          },
        },
      }),
      ...buildOfficialRescoreScopeMetadata({
        benchmark: "beam",
        selectedQuestionCount: 3,
        selectedRubricItemCount: 3,
        sourceQuestionCount: 3,
        sourceRubricItemCount: 3,
      }),
      categories: {
        contradiction_resolution: {
          meanScore: 1,
          questions: 2,
        },
        temporal_order: {
          meanScore: 0,
          questions: 1,
        },
      },
      judgeFailures: 0,
      overallMacroByCategory: 0.25,
      overallMicroByQuestion: 0.5,
      protocol: "official BEAM unified rubric judge",
      rubricItemsJudged: 3,
      scoredQuestions: 3,
      totalQuestions: 3,
      totalRubricItems: 3,
    };
    const beamAggregateErrors = validateOfficialRescoreSummary(
      beamAggregateMismatch,
    );
    expect(beamAggregateErrors).toContain(
      "overallMacroByCategory must equal the mean of category meanScore values",
    );
    expect(beamAggregateErrors).toContain(
      "overallMicroByQuestion must equal the question-weighted mean of category meanScore values",
    );
  });

  it("builds stable source input content fingerprints", () => {
    expect(
      buildOfficialRescoreSourceInputFingerprints({
        contents: {
          reportPath: "abc",
        },
        sourceInputs: {
          reportPath: "/reports/source.json",
        },
      }),
    ).toEqual({
      reportPath: {
        bytes: 3,
        sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      },
    });
  });

  it("builds unambiguous source and selected scope metadata", () => {
    expect(
      buildOfficialRescoreScopeMetadata({
        benchmark: "beam",
        selectedQuestionCount: 9,
        selectedRubricItemCount: 25,
        sourceQuestionCount: 400,
        sourceRubricItemCount: 1051,
      }),
    ).toEqual({
      selectedQuestions: 9,
      selectedRubricItems: 25,
      sourceQuestions: 400,
      sourceRubricItems: 1051,
    });

    expect(
      buildOfficialRescoreScopeMetadata({
        benchmark: "locomo",
        selectedCaseCount: 25,
        sourceCaseCount: 1986,
      }),
    ).toEqual({
      selectedCases: 25,
      sourceCases: 1986,
    });
  });

  it("rejects rescore progress cache identity drift", () => {
    const identity = buildOfficialRescoreRunIdentity({
      benchmark: "locomo",
      ...judgeIdentity("gpt-5.4-mini"),
      limit: 25,
      runId: "locomo-official-rescore-current",
      sourceInputFingerprints: {
        reportPath: {
          bytes: 7,
          sha256: "old-report",
        },
        rootPath: {
          bytes: 6,
          sha256: "old-root",
        },
      },
      sourceInputs: {
        reportPath: "/reports/locomo/union-live-report.json",
        rootPath: "/private/tmp/LOCOMO-full10/cases.json",
      },
    });
    expect(identity.limit).toBe(25);

    expect(() =>
      assertOfficialRescoreRunIdentityCompatible(identity, {
        ...identity,
        judgeModel: "gemini-flash",
      }),
    ).toThrow("official rescore run identity changed: judgeModel");

    expect(() =>
      assertOfficialRescoreRunIdentityCompatible(identity, {
        ...identity,
        judgeGateway: "https://other-gateway.example/v1",
      }),
    ).toThrow("official rescore run identity changed: judgeGateway");

    expect(() =>
      assertOfficialRescoreRunIdentityCompatible(identity, {
        ...identity,
        benchmark: "beam",
      }),
    ).toThrow("official rescore run identity changed: benchmark");

    expect(() =>
      assertOfficialRescoreRunIdentityCompatible(identity, {
        ...identity,
        limit: 50,
      }),
    ).toThrow("official rescore run identity changed: limit");

    expect(() =>
      assertOfficialRescoreRunIdentityCompatible(identity, {
        ...identity,
        sourceInputFingerprints: {
          ...identity.sourceInputFingerprints,
          reportPath: {
            bytes: 8,
            sha256: "new-report",
          },
        },
      }),
    ).toThrow("official rescore run identity changed: sourceInputFingerprints");

    expect(() =>
      assertOfficialRescoreRunIdentityCompatible(identity, {
        ...identity,
        sourceInputs: {
          reportPath: "/reports/locomo/other-report.json",
          rootPath: "/private/tmp/LOCOMO-full10/cases.json",
        },
      }),
    ).toThrow("official rescore run identity changed: sourceInputs");

    const longMemEvalIdentity = buildOfficialRescoreRunIdentity({
      benchmark: "longmemeval",
      ...judgeIdentity("gpt-5.4"),
      runId: "longmemeval-recommended-current",
      sourceInputFingerprints: {},
      sourceInputs: {
        referencePath: "/data/longmemeval_s_cleaned.json",
        reportPath: "/reports/longmemeval/report.json",
      },
      sourceProfile: "goodmemory-recommended",
    });
    expect(() =>
      assertOfficialRescoreRunIdentityCompatible(longMemEvalIdentity, {
        ...longMemEvalIdentity,
        sourceProfile: "goodmemory-rules-only",
      }),
    ).toThrow("official rescore run identity changed: sourceProfile");
  });

  it("rejects malformed rescore progress rows", () => {
    expect(
      parseOfficialRescoreProgressLine(
        '{"questionId":"q1","correct":true}',
        "progress.jsonl:1",
      ),
    ).toEqual({
      correct: true,
      questionId: "q1",
    });

    expect(() =>
      parseOfficialRescoreProgressLine(
        '{"questionId":"q1","correct":"yes"}',
        "progress.jsonl:2",
      ),
    ).toThrow("malformed official rescore progress row at progress.jsonl:2");

    expect(() =>
      parseOfficialRescoreProgressLine(
        '{"questionId":"","correct":false}',
        "progress.jsonl:3",
      ),
    ).toThrow("malformed official rescore progress row at progress.jsonl:3");

    expect(() =>
      parseOfficialRescoreProgressLine(
        '{"questionId":"q1","correct":true,"ignored":1}',
        "progress.jsonl:4",
      ),
    ).toThrow("malformed official rescore progress row at progress.jsonl:4");

    expect(
      parseOfficialRescoreRubricProgressLine(
        '{"key":"q1#0","questionId":"q1","score":0.5}',
        "progress.jsonl:5",
      ),
    ).toEqual({
      key: "q1#0",
      questionId: "q1",
      score: 0.5,
    });

    expect(() =>
      parseOfficialRescoreRubricProgressLine(
        '{"key":"q1#0","questionId":"q1","score":0.25}',
        "progress.jsonl:6",
      ),
    ).toThrow("malformed official rescore rubric progress row at progress.jsonl:6");

    expect(() =>
      parseOfficialRescoreRubricProgressLine(
        '{"key":"q1#0","questionId":"q2","score":0.5}',
        "progress.jsonl:7",
      ),
    ).toThrow("malformed official rescore rubric progress row at progress.jsonl:7");

    expect(() =>
      parseOfficialRescoreRubricProgressLine(
        '{"key":"q1#0","questionId":"q1","score":1,"ignored":1}',
        "progress.jsonl:8",
      ),
    ).toThrow("malformed official rescore rubric progress row at progress.jsonl:8");
  });

  it("serializes progress rows in the same strict shape the cache parser accepts", () => {
    const questionRow = serializeOfficialRescoreProgressRow({
      correct: true,
      questionId: "q1",
    });
    expect(JSON.parse(questionRow)).toEqual({
      correct: true,
      questionId: "q1",
    });
    expect(parseOfficialRescoreProgressLine(questionRow, "progress.jsonl:1")).toEqual({
      correct: true,
      questionId: "q1",
    });

    const rubricRow = serializeOfficialRescoreRubricProgressRow({
      key: "q1#0",
      questionId: "q1",
      score: 0.5,
    });
    expect(JSON.parse(rubricRow)).toEqual({
      key: "q1#0",
      questionId: "q1",
      score: 0.5,
    });
    expect(parseOfficialRescoreRubricProgressLine(rubricRow, "progress.jsonl:2")).toEqual({
      key: "q1#0",
      questionId: "q1",
      score: 0.5,
    });
  });

  it("rejects duplicate rescore progress rows", () => {
    expect(() =>
      readOfficialRescoreProgressRows(
        [
          '{"questionId":"q1","correct":true}',
          '{"questionId":"q1","correct":false}',
        ].join("\n"),
        "progress.jsonl",
      ),
    ).toThrow("duplicate official rescore progress row for q1 at progress.jsonl:2");

    expect(() =>
      readOfficialRescoreRubricProgressRows(
        [
          '{"key":"q1#0","questionId":"q1","score":1}',
          '{"key":"q1#0","questionId":"q1","score":0}',
        ].join("\n"),
        "progress.jsonl",
      ),
    ).toThrow("duplicate official rescore rubric progress row for q1#0 at progress.jsonl:2");
  });

  it("skips only final torn-tail official rescore progress lines", () => {
    expect(
      readOfficialRescoreProgressRows(
        [
          '{"questionId":"q1","correct":true}',
          '{"questionId":"q2","correct"',
        ].join("\n"),
        "progress.jsonl",
      ),
    ).toEqual([{ correct: true, questionId: "q1" }]);

    expect(() =>
      readOfficialRescoreProgressRows(
        [
          '{"questionId":"q1","correct":true}',
          '{"questionId":"q2","correct"',
          '{"questionId":"q3","correct":false}',
        ].join("\n"),
        "progress.jsonl",
      ),
    ).toThrow(SyntaxError);

    expect(
      readOfficialRescoreRubricProgressRows(
        [
          '{"key":"q1#0","questionId":"q1","score":1}',
          '{"key":"q1#1","questionId"',
        ].join("\n"),
        "progress.jsonl",
      ),
    ).toEqual([{ key: "q1#0", questionId: "q1", score: 1 }]);

    expect(() =>
      readOfficialRescoreRubricProgressRows(
        [
          '{"key":"q1#0","questionId":"q1","score":1}',
          '{"key":"q1#1","questionId"',
          '{"key":"q1#2","questionId":"q1","score":0}',
        ].join("\n"),
        "progress.jsonl",
      ),
    ).toThrow(SyntaxError);
  });

  it("rejects cached progress rows outside the selected rescore scope", () => {
    expect(() =>
      requireOfficialRescoreProgressRowsWithinSelection(
        [
          { correct: true, questionId: "q1" },
          { correct: false, questionId: "q3" },
        ],
        new Set(["q1", "q2"]),
        "progress.jsonl",
      ),
    ).toThrow("official rescore progress row q3 is outside selected scope at progress.jsonl");

    expect(() =>
      requireOfficialRescoreRubricProgressRowsWithinSelection(
        [
          { key: "q1#0", questionId: "q1", score: 1 },
          { key: "q2#0", questionId: "q2", score: 0.5 },
        ],
        new Set(["q1#0", "q1#1"]),
        "progress.jsonl",
      ),
    ).toThrow("official rescore rubric progress row q2#0 is outside selected scope at progress.jsonl");
  });

  it("does not migrate legacy progress without an auditable run identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "gm-rescore-identity-"));
    try {
      const identityPath = join(root, "run-identity.json");
      const progressPath = join(root, "progress.jsonl");
      const identity = buildOfficialRescoreRunIdentity({
        benchmark: "locomo",
        ...judgeIdentity("gpt-5.4-mini"),
        runId: "locomo-official-rescore-current",
        sourceInputFingerprints: {
          reportPath: {
            bytes: 7,
            sha256: "a".repeat(64),
          },
          rootPath: {
            bytes: 6,
            sha256: "b".repeat(64),
          },
        },
        sourceInputs: {
          reportPath: "/reports/locomo/union-live-report.json",
          rootPath: "/private/tmp/LOCOMO-full10/cases.json",
        },
      });

      await writeFile(
        progressPath,
        '{"questionId":"q1","correct":true}\n',
      );

      await expect(
        ensureOfficialRescoreRunIdentity(identityPath, progressPath, identity),
      ).rejects.toThrow("progress cache exists without run-identity.json");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects malformed existing rescore run identity files", async () => {
    const root = await mkdtemp(join(tmpdir(), "gm-rescore-identity-"));
    try {
      const identityPath = join(root, "run-identity.json");
      const progressPath = join(root, "progress.jsonl");
      const identity = buildOfficialRescoreRunIdentity({
        benchmark: "locomo",
        ...judgeIdentity("gpt-5.4-mini"),
        runId: "locomo-official-rescore-current",
        sourceInputFingerprints: {
          reportPath: {
            bytes: 7,
            sha256: "a".repeat(64),
          },
          rootPath: {
            bytes: 6,
            sha256: "b".repeat(64),
          },
        },
        sourceInputs: {
          reportPath: "/reports/locomo/union-live-report.json",
          rootPath: "/private/tmp/LOCOMO-full10/cases.json",
        },
      });

      await writeFile(identityPath, "[]\n");

      await expect(
        ensureOfficialRescoreRunIdentity(identityPath, progressPath, identity),
      ).rejects.toThrow("malformed official rescore run identity at");

      await writeFile(
        identityPath,
        `${JSON.stringify({ ...identity, ignored: true })}\n`,
      );

      await expect(
        ensureOfficialRescoreRunIdentity(identityPath, progressPath, identity),
      ).rejects.toThrow("malformed official rescore run identity at");

      await writeFile(
        identityPath,
        `${JSON.stringify({
          ...identity,
          sourceInputs: {
            ...identity.sourceInputs,
            ignoredPath: "/tmp/other.json",
          },
        })}\n`,
      );

      await expect(
        ensureOfficialRescoreRunIdentity(identityPath, progressPath, identity),
      ).rejects.toThrow("malformed official rescore run identity at");

      await writeFile(
        identityPath,
        `${JSON.stringify({
          ...identity,
          sourceInputFingerprints: {
            ...identity.sourceInputFingerprints,
            ignoredPath: {
              bytes: 1,
              sha256: "c".repeat(64),
            },
          },
        })}\n`,
      );

      await expect(
        ensureOfficialRescoreRunIdentity(identityPath, progressPath, identity),
      ).rejects.toThrow("malformed official rescore run identity at");

      await writeFile(
        identityPath,
        `${JSON.stringify({
          ...identity,
          sourceInputFingerprints: {
            ...identity.sourceInputFingerprints,
            reportPath: {
              bytes: 7,
              sha256: "not-a-sha256",
            },
          },
        })}\n`,
      );

      await expect(
        ensureOfficialRescoreRunIdentity(identityPath, progressPath, identity),
      ).rejects.toThrow("malformed official rescore run identity at");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("initializes an auditable run identity for a fresh rescore run", async () => {
    const root = await mkdtemp(join(tmpdir(), "gm-rescore-identity-"));
    try {
      const identityPath = join(root, "run-identity.json");
      const progressPath = join(root, "progress.jsonl");
      const identity = buildOfficialRescoreRunIdentity({
        benchmark: "longmemeval",
        ...judgeIdentity("gpt-5.4-mini"),
        runId: "longmemeval-official-rescore-current",
        sourceInputFingerprints: {
          referencePath: {
            bytes: 4,
            sha256: "reference-sha",
          },
          reportPath: {
            bytes: 7,
            sha256: "report-sha",
          },
        },
        sourceInputs: {
          referencePath: "/tmp/longmemeval_s.json",
          reportPath: "/reports/longmemeval/report.json",
        },
      });

      await ensureOfficialRescoreRunIdentity(identityPath, progressPath, identity);
      expect(JSON.parse(await readFile(identityPath, "utf8"))).toEqual(identity);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
