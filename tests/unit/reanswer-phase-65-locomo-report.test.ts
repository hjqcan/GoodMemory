import { describe, expect, it } from "bun:test";
import {
  parseLocomoReanswerCliOptions,
  runLocomoReportReanswer,
} from "../../scripts/reanswer-phase-65-locomo-report";
import type { LocomoCase } from "../../src/eval/locomo";
import type { LocomoSmokeReport } from "../../scripts/run-phase-65-locomo-smoke";

const testCase: LocomoCase = {
  caseId: "locomo-conv-test",
  questions: [
    {
      adversarialAnswer: "pepperoni",
      category: "adversarial",
      evidenceTurnIds: ["D1:1"],
      goldAnswer: "No information available",
      matchMode: "adversarial_abstention",
      question: "Which pizza did Mira recommend?",
      questionId: "conv-test:q1",
    },
    {
      adversarialAnswer: null,
      category: "open_domain",
      evidenceTurnIds: ["D1:2"],
      goldAnswer: "Connecticut",
      matchMode: "f1_token_overlap",
      question: "Which state is Hartford in?",
      questionId: "conv-test:q2",
    },
  ],
  sourceConversation: "conversation-test",
  speakers: ["Mira", "Noah"],
  turns: [
    {
      content: "Mira said they never discussed pizza recommendations.",
      diaId: "D1:1",
      speaker: "Mira",
    },
    {
      content: "Noah said Hartford came up during trip planning.",
      diaId: "D1:2",
      speaker: "Noah",
    },
  ],
};

function sourceReport(): LocomoSmokeReport {
  return {
    allowCommonsenseResolution: false,
    answerContextMode: "evidence-pack",
    answerEvaluation: "scored",
    benchmark: "locomo",
    benchmarkSource: "/tmp/LOCOMO/cases.json",
    bm25Ranking: false,
    caseCount: 1,
    caseIds: [testCase.caseId],
    cases: [
      {
        answerCorrect: false,
        caseId: testCase.caseId,
        category: "adversarial",
        evidenceRecall: 1,
        evidenceTurnIds: ["D1:1"],
        generatedAnswer: "pepperoni",
        goldEvidenceFullyRetrieved: true,
        missingEvidenceTurnIds: [],
        noiseTurnCount: 0,
        noiseTurnIds: [],
        questionId: "conv-test:q1",
        retrievedTurnIds: ["D1:1"],
      },
      {
        answerCorrect: false,
        caseId: testCase.caseId,
        category: "open_domain",
        evidenceRecall: 1,
        evidenceTurnIds: ["D1:2"],
        generatedAnswer: "I do not know",
        goldEvidenceFullyRetrieved: true,
        missingEvidenceTurnIds: [],
        noiseTurnCount: 0,
        noiseTurnIds: [],
        questionId: "conv-test:q2",
        retrievedTurnIds: ["D1:2"],
      },
    ],
    categories: [],
    executionFailures: 0,
    externalRoot: "/tmp/LOCOMO",
    generatedAt: "2026-07-03T00:00:00.000Z",
    generatedBy: "scripts/run-phase-65-locomo-smoke.ts",
    ingestMode: "raw-turns",
    license: "CC BY-NC 4.0",
    mode: "live-answer",
    phase: "phase-65",
    profilesCompared: ["goodmemory-rules-only"],
    questionCategories: null,
    questionCount: 2,
    questionIds: null,
    resume: false,
    runDirectory: "/reports/source",
    runId: "source-report",
    semanticCandidateEmbeddingSource: "provider",
    semanticCandidates: {
      enabled: true,
      maxAdditions: 4,
      minRelativeScore: null,
      minSimilarity: null,
      topK: 16,
    },
    upstreamAnswerMetricByCategory: {
      adversarial: "adversarial_abstention",
      open_domain: "f1_token_overlap",
    },
    upstreamSource: "https://github.com/snap-research/locomo",
  };
}

describe("phase-65 LoCoMo report reanswer runner", () => {
  it("parses source report, question id, commonsense, and output flags", () => {
    expect(
      parseLocomoReanswerCliOptions([
        "bun",
        "run",
        "scripts/reanswer-phase-65-locomo-report.ts",
        "--source-report",
        "/reports/source.json",
        "--question-id",
        "q1,q2",
        "--question-id",
        "q3",
        "--question-id-file",
        "/reports/slice.json",
        "--reanswer-job-bucket",
        "answerRegressions,answerTokenF1NearMiss,topUnconvertedRetrievalGains",
        "--reanswer-job-category",
        "open_domain,multi_hop",
        "--reanswer-job-category",
        "temporal",
        "--gold-evidence-only-context",
        "--allow-commonsense-resolution",
        "--strict-no-evidence-abstention",
        "--retain-unselected",
        "--answer-profile",
        "temporal-bounded-v3",
        "--concurrency",
        "3",
        "--max-evidence-turns",
        "6",
        "--output-dir",
        "/reports/out",
        "--run-id",
        "reanswer-run",
      ]),
    ).toEqual({
      allowCommonsenseResolution: true,
      answerProfile: "temporal-bounded-v3",
      chainOfNote: false,
      evidenceProvenance: false,
      concurrency: 3,
      maxEvidenceTurns: 6,
      outputDir: "/reports/out",
      goldEvidenceOnlyContext: true,
      questionIdFile: "/reports/slice.json",
      questionIds: ["q1", "q2", "q3"],
      reanswerJobBuckets: [
        "answerRegressions",
        "answerTokenF1NearMiss",
        "topUnconvertedRetrievalGains",
      ],
      reanswerJobCategories: ["open_domain", "multi_hop", "temporal"],
      retainUnselected: true,
      runId: "reanswer-run",
      sourceReportPath: "/reports/source.json",
      strictNoEvidenceAbstention: true,
    });
  });

  it("rejects unknown answer profiles before loading source reports", () => {
    expect(() =>
      parseLocomoReanswerCliOptions([
        "bun",
        "run",
        "scripts/reanswer-phase-65-locomo-report.ts",
        "--source-report",
        "/reports/source.json",
        "--answer-profile",
        "benchmark-fitted-magic",
      ]),
    ).toThrow(
      "--answer-profile must be temporal-bounded-v3 when provided.",
    );
  });

  it("parses the chain-of-note reading flag", () => {
    expect(
      parseLocomoReanswerCliOptions([
        "bun",
        "run",
        "scripts/reanswer-phase-65-locomo-report.ts",
        "--source-report",
        "/reports/source.json",
        "--chain-of-note",
      ]).chainOfNote,
    ).toBe(true);
  });

  it("rejects chain-of-note combined with the frozen union answer profile", () => {
    expect(() =>
      parseLocomoReanswerCliOptions([
        "bun",
        "run",
        "scripts/reanswer-phase-65-locomo-report.ts",
        "--source-report",
        "/reports/source.json",
        "--chain-of-note",
        "--answer-profile",
        "temporal-bounded-v3",
      ]),
    ).toThrow(
      "--chain-of-note cannot be combined with --answer-profile temporal-bounded-v3.",
    );
  });

  it("threads chain-of-note into the evidence pack and scores only the extracted final answer", async () => {
    const seenContexts: string[] = [];
    const report = await runLocomoReportReanswer(
      {
        allowCommonsenseResolution: false,
        chainOfNote: true,
        outputDir: "/reports/out",
        questionIds: ["conv-test:q2"],
        runId: "reanswer-chain-of-note",
        sourceReportPath: "/reports/source/smoke-report.json",
        strictNoEvidenceAbstention: false,
      },
      {
        answerGenerator: async ({ memoryContext }) => {
          seenContexts.push(memoryContext);
          return [
            "- #D1:2: states where Hartford came up, relevant.",
            "Final answer: Connecticut",
          ].join("\n");
        },
        mkdir: async () => undefined,
        readFile: async (path) => {
          if (path === "/reports/source/smoke-report.json") {
            return JSON.stringify(sourceReport());
          }
          if (path === "/tmp/LOCOMO/cases.json") {
            return JSON.stringify({ cases: [testCase] });
          }
          throw new Error(`unexpected read: ${path}`);
        },
        writeFile: async () => undefined,
      },
    );

    expect(seenContexts).toHaveLength(1);
    expect(seenContexts[0]).toContain("one brief note per evidence entry");
    expect(seenContexts[0]).toContain('"Final answer:"');
    const result = report.cases.find(
      (candidate) => candidate.questionId === "conv-test:q2",
    );
    // The working notes are stripped before scoring; only the extracted final
    // answer is recorded and scored.
    expect(result?.generatedAnswer).toBe("Connecticut");
    expect(result?.answerCorrect).toBe(true);
    expect(result?.answerTokenF1).toBe(1);
    expect(report.chainOfNote).toBe(true);
  });

  it("keeps the default reading mode free of the chain-of-note protocol", async () => {
    const seenContexts: string[] = [];
    const report = await runLocomoReportReanswer(
      {
        allowCommonsenseResolution: false,
        outputDir: "/reports/out",
        questionIds: ["conv-test:q2"],
        runId: "reanswer-default-mode",
        sourceReportPath: "/reports/source/smoke-report.json",
        strictNoEvidenceAbstention: false,
      },
      {
        answerGenerator: async ({ memoryContext }) => {
          seenContexts.push(memoryContext);
          return "Connecticut";
        },
        mkdir: async () => undefined,
        readFile: async (path) => {
          if (path === "/reports/source/smoke-report.json") {
            return JSON.stringify(sourceReport());
          }
          if (path === "/tmp/LOCOMO/cases.json") {
            return JSON.stringify({ cases: [testCase] });
          }
          throw new Error(`unexpected read: ${path}`);
        },
        writeFile: async () => undefined,
      },
    );

    expect(seenContexts).toHaveLength(1);
    expect(seenContexts[0]).not.toContain("Final answer");
    expect(report.chainOfNote).toBe(false);
  });

  it("rejects empty targeted list entries before replay selection", () => {
    expect(() =>
      parseLocomoReanswerCliOptions([
        "bun",
        "run",
        "scripts/reanswer-phase-65-locomo-report.ts",
        "--source-report",
        "/reports/source.json",
        "--question-id",
        "q1,,q2",
      ]),
    ).toThrow("--question-id contains an empty value.");

    expect(() =>
      parseLocomoReanswerCliOptions([
        "bun",
        "run",
        "scripts/reanswer-phase-65-locomo-report.ts",
        "--source-report",
        "/reports/source.json",
        "--reanswer-job-bucket",
        "answerRegressions,",
      ]),
    ).toThrow("--reanswer-job-bucket contains an empty value.");

    expect(() =>
      parseLocomoReanswerCliOptions([
        "bun",
        "run",
        "scripts/reanswer-phase-65-locomo-report.ts",
        "--source-report",
        "/reports/source.json",
        "--reanswer-job-category",
        ",open_domain",
      ]),
    ).toThrow("--reanswer-job-category contains an empty value.");
  });

  it("rejects whitespace-padded targeted list entries before replay selection", () => {
    expect(() =>
      parseLocomoReanswerCliOptions([
        "bun",
        "run",
        "scripts/reanswer-phase-65-locomo-report.ts",
        "--source-report",
        "/reports/source.json",
        "--question-id",
        "conv-test:q1, conv-test:q2",
      ]),
    ).toThrow(
      "--question-id contains a value with leading or trailing whitespace.",
    );

    expect(() =>
      parseLocomoReanswerCliOptions([
        "bun",
        "run",
        "scripts/reanswer-phase-65-locomo-report.ts",
        "--source-report",
        "/reports/source.json",
        "--reanswer-job-bucket",
        " answerRegressions",
      ]),
    ).toThrow(
      "--reanswer-job-bucket contains a value with leading or trailing whitespace.",
    );

    expect(() =>
      parseLocomoReanswerCliOptions([
        "bun",
        "run",
        "scripts/reanswer-phase-65-locomo-report.ts",
        "--source-report",
        "/reports/source.json",
        "--reanswer-job-category",
        "open_domain ",
      ]),
    ).toThrow(
      "--reanswer-job-category contains a value with leading or trailing whitespace.",
    );
  });

  it("rejects empty explicit question-id selections before replay", async () => {
    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIds: [],
          runId: "reanswer-empty-explicit-selection",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          answerGenerator: async () => "No information available",
          mkdir: async () => undefined,
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            if (path === "/tmp/LOCOMO/cases.json") {
              return JSON.stringify({ cases: [testCase] });
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow(
      "LoCoMo reanswer explicit question ids must contain at least one question id.",
    );
  });

  it("rejects duplicate reanswer job filters before replay selection", () => {
    expect(() =>
      parseLocomoReanswerCliOptions([
        "bun",
        "run",
        "scripts/reanswer-phase-65-locomo-report.ts",
        "--source-report",
        "/reports/source.json",
        "--reanswer-job-bucket",
        "answerRegressions,answerRegressions",
      ]),
    ).toThrow(
      "--reanswer-job-bucket contains duplicate value answerRegressions.",
    );

    expect(() =>
      parseLocomoReanswerCliOptions([
        "bun",
        "run",
        "scripts/reanswer-phase-65-locomo-report.ts",
        "--source-report",
        "/reports/source.json",
        "--reanswer-job-category",
        "multi_hop",
        "--reanswer-job-category",
        "multi_hop",
      ]),
    ).toThrow("--reanswer-job-category contains duplicate value multi_hop.");
  });

  it("rejects duplicate boolean replay flags before report generation", () => {
    expect(() =>
      parseLocomoReanswerCliOptions([
        "bun",
        "run",
        "scripts/reanswer-phase-65-locomo-report.ts",
        "--source-report",
        "/reports/source.json",
        "--gold-evidence-only-context",
        "--gold-evidence-only-context",
      ]),
    ).toThrow("--gold-evidence-only-context cannot be specified more than once.");

    expect(() =>
      parseLocomoReanswerCliOptions([
        "bun",
        "run",
        "scripts/reanswer-phase-65-locomo-report.ts",
        "--source-report",
        "/reports/source.json",
        "--allow-commonsense-resolution",
        "--allow-commonsense-resolution",
      ]),
    ).toThrow(
      "--allow-commonsense-resolution cannot be specified more than once.",
    );
  });

  it("rejects missing string flag values before replay selection", () => {
    expect(() =>
      parseLocomoReanswerCliOptions([
        "bun",
        "run",
        "scripts/reanswer-phase-65-locomo-report.ts",
        "--source-report",
        "--run-id",
        "reanswer-run",
      ]),
    ).toThrow("--source-report requires a value.");

    expect(() =>
      parseLocomoReanswerCliOptions([
        "bun",
        "run",
        "scripts/reanswer-phase-65-locomo-report.ts",
        "--source-report",
        "/reports/source.json",
        "--question-id-file",
        "--run-id",
        "reanswer-run",
      ]),
    ).toThrow("--question-id-file requires a value.");

    expect(() =>
      parseLocomoReanswerCliOptions([
        "bun",
        "run",
        "scripts/reanswer-phase-65-locomo-report.ts",
        "--source-report",
        "/reports/source.json",
        "--output-dir",
        "--run-id",
        "reanswer-run",
      ]),
    ).toThrow("--output-dir requires a value.");

    expect(() =>
      parseLocomoReanswerCliOptions([
        "bun",
        "run",
        "scripts/reanswer-phase-65-locomo-report.ts",
        "--source-report",
        "/reports/source.json",
        "--run-id",
        "--gold-evidence-only-context",
      ]),
    ).toThrow("--run-id requires a value.");

    expect(() =>
      parseLocomoReanswerCliOptions([
        "bun",
        "run",
        "scripts/reanswer-phase-65-locomo-report.ts",
        "--source-report",
        "/reports/source.json",
        "--run-id",
        "../outside-reanswer",
      ]),
    ).toThrow("--run-id must be a single path segment.");
  });

  it("rejects output run ids that escape the report directory before reading sources", async () => {
    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          runId: "../outside-reanswer",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async () => {
            throw new Error("source should not be read");
          },
        },
      ),
    ).rejects.toThrow("LoCoMo reanswer runId must be a single path segment.");
  });

  it("reanswers selected questions from a manifest file without manual id copying", async () => {
    const report = await runLocomoReportReanswer(
      {
        allowCommonsenseResolution: false,
        outputDir: "/reports/out",
        questionIdFile: "/reports/answer-policy-slice.json",
        questionIds: ["conv-test:q1"],
        runId: "reanswer-manifest",
        sourceReportPath: "/reports/source/smoke-report.json",
        strictNoEvidenceAbstention: false,
      },
      {
        answerGenerator: async ({ question }) =>
          question.questionId === "conv-test:q1" ? "I do not know" : "Connecticut",
        mkdir: async () => undefined,
        readFile: async (path) => {
          if (path === "/reports/source/smoke-report.json") {
            return JSON.stringify(sourceReport());
          }
          if (path === "/reports/answer-policy-slice.json") {
            return JSON.stringify({
              categories: {
                open_domain: { questionIds: ["conv-test:q3"] },
              },
              repairJobs: [
                {
                  questionIds: ["conv-test:q3"],
                },
              ],
              reanswerJobs: [
                {
                  questionIds: ["conv-test:q2"],
                  sourceReportPath: "/reports/source/smoke-report.json",
                  sourceRunId: "source-report",
                },
              ],
            });
          }
          if (path === "/tmp/LOCOMO/cases.json") {
            return JSON.stringify({ cases: [testCase] });
          }
          throw new Error(`unexpected read: ${path}`);
        },
        writeFile: async () => undefined,
      },
    );

    expect(report.executionFailures).toBe(0);
    expect(report.questionCount).toBe(2);
    expect(report.questionIds).toEqual(["conv-test:q1", "conv-test:q2"]);
    expect(report.cases.map((result) => result.questionId)).toEqual([
      "conv-test:q1",
      "conv-test:q2",
    ]);
    expect(report.reanswerSelection).toEqual({
      explicitQuestionIds: ["conv-test:q1"],
      questionIdFile: "/reports/answer-policy-slice.json",
      reanswerJobBuckets: null,
      reanswerJobCategories: null,
    });
  });

  it("can replay only a selected manifest reanswer job bucket", async () => {
    const answeredQuestionIds: string[] = [];
    const report = await runLocomoReportReanswer(
      {
        allowCommonsenseResolution: false,
        outputDir: "/reports/out",
        questionIdFile: "/reports/live-delta.json",
        reanswerJobBuckets: ["topUnconvertedRetrievalGains"],
        runId: "reanswer-top-unconverted",
        sourceReportPath: "/reports/source/smoke-report.json",
        strictNoEvidenceAbstention: false,
      },
      {
        answerGenerator: async ({ question }) => {
          answeredQuestionIds.push(question.questionId);
          return question.questionId === "conv-test:q2"
            ? "Connecticut"
            : "I do not know";
        },
        mkdir: async () => undefined,
        readFile: async (path) => {
          if (path === "/reports/source/smoke-report.json") {
            return JSON.stringify(sourceReport());
          }
          if (path === "/reports/live-delta.json") {
            return JSON.stringify({
              candidateReport: {
                path: "/reports/source/smoke-report.json",
                runId: "source-report",
              },
              reanswerJobs: [
                {
                  bucket: "answerRegressions",
                  questionIds: ["conv-test:q1"],
                  sourceReportPath: "/reports/source/smoke-report.json",
                  sourceRunId: "source-report",
                },
                {
                  bucket: "topUnconvertedRetrievalGains",
                  questionIds: ["conv-test:q2"],
                  sourceReportPath: "/reports/source/smoke-report.json",
                  sourceRunId: "source-report",
                },
              ],
            });
          }
          if (path === "/tmp/LOCOMO/cases.json") {
            return JSON.stringify({ cases: [testCase] });
          }
          throw new Error(`unexpected read: ${path}`);
        },
        writeFile: async () => undefined,
      },
    );

    expect(answeredQuestionIds).toEqual(["conv-test:q2"]);
    expect(report.questionCount).toBe(1);
    expect(report.questionIds).toEqual(["conv-test:q2"]);
    expect(report.reanswerSelection).toEqual({
      explicitQuestionIds: null,
      questionIdFile: "/reports/live-delta.json",
      reanswerJobBuckets: ["topUnconvertedRetrievalGains"],
      reanswerJobCategories: null,
    });
  });

  it("can replay only a selected manifest reanswer job category", async () => {
    const answeredQuestionIds: string[] = [];
    const report = await runLocomoReportReanswer(
      {
        allowCommonsenseResolution: false,
        outputDir: "/reports/out",
        questionIdFile: "/reports/live-delta.json",
        reanswerJobBuckets: ["answerRegressions"],
        reanswerJobCategories: ["open_domain"],
        runId: "reanswer-open-domain-regressions",
        sourceReportPath: "/reports/source/smoke-report.json",
        strictNoEvidenceAbstention: false,
      },
      {
        answerGenerator: async ({ question }) => {
          answeredQuestionIds.push(question.questionId);
          return question.questionId === "conv-test:q2"
            ? "Connecticut"
            : "I do not know";
        },
        mkdir: async () => undefined,
        readFile: async (path) => {
          if (path === "/reports/source/smoke-report.json") {
            return JSON.stringify(sourceReport());
          }
          if (path === "/reports/live-delta.json") {
            return JSON.stringify({
              candidateReport: {
                path: "/reports/source/smoke-report.json",
                runId: "source-report",
              },
              reanswerJobs: [
                {
                  bucket: "answerRegressions",
                  categories: ["adversarial"],
                  category: "adversarial",
                  questionIds: ["conv-test:q1"],
                  sourceReportPath: "/reports/source/smoke-report.json",
                  sourceRunId: "source-report",
                },
                {
                  bucket: "answerRegressions",
                  categories: ["open_domain"],
                  category: "open_domain",
                  questionIds: ["conv-test:q2"],
                  sourceReportPath: "/reports/source/smoke-report.json",
                  sourceRunId: "source-report",
                },
              ],
            });
          }
          if (path === "/tmp/LOCOMO/cases.json") {
            return JSON.stringify({ cases: [testCase] });
          }
          throw new Error(`unexpected read: ${path}`);
        },
        writeFile: async () => undefined,
      },
    );

    expect(answeredQuestionIds).toEqual(["conv-test:q2"]);
    expect(report.questionCount).toBe(1);
    expect(report.questionIds).toEqual(["conv-test:q2"]);
    expect(report.reanswerSelection).toEqual({
      explicitQuestionIds: null,
      questionIdFile: "/reports/live-delta.json",
      reanswerJobBuckets: ["answerRegressions"],
      reanswerJobCategories: ["open_domain"],
    });
  });

  it("can replay a bucketless answer-policy reanswer job by category", async () => {
    const answeredQuestionIds: string[] = [];
    const report = await runLocomoReportReanswer(
      {
        allowCommonsenseResolution: false,
        outputDir: "/reports/out",
        questionIdFile: "/reports/answer-policy-slice.json",
        reanswerJobCategories: ["open_domain"],
        runId: "reanswer-open-domain-answer-policy",
        sourceReportPath: "/reports/source/smoke-report.json",
        strictNoEvidenceAbstention: false,
      },
      {
        answerGenerator: async ({ question }) => {
          answeredQuestionIds.push(question.questionId);
          return question.questionId === "conv-test:q2"
            ? "Connecticut"
            : "I do not know";
        },
        mkdir: async () => undefined,
        readFile: async (path) => {
          if (path === "/reports/source/smoke-report.json") {
            return JSON.stringify(sourceReport());
          }
          if (path === "/reports/answer-policy-slice.json") {
            return JSON.stringify({
              reanswerJobs: [
                {
                  category: "adversarial",
                  questionIds: ["conv-test:q1"],
                  sourceReportPath: "/reports/adversarial/smoke-report.json",
                  sourceRunId: "adversarial-source-report",
                },
                {
                  category: "open_domain",
                  questionIds: ["conv-test:q2"],
                  sourceReportPath: "/reports/source/smoke-report.json",
                  sourceRunId: "source-report",
                },
              ],
              sourceReports: [
                {
                  path: "/reports/adversarial/smoke-report.json",
                  runId: "adversarial-source-report",
                },
                {
                  path: "/reports/source/smoke-report.json",
                  runId: "source-report",
                },
              ],
            });
          }
          if (path === "/tmp/LOCOMO/cases.json") {
            return JSON.stringify({ cases: [testCase] });
          }
          throw new Error(`unexpected read: ${path}`);
        },
        writeFile: async () => undefined,
      },
    );

    expect(answeredQuestionIds).toEqual(["conv-test:q2"]);
    expect(report.questionCount).toBe(1);
    expect(report.questionIds).toEqual(["conv-test:q2"]);
    expect(report.reanswerSelection).toEqual({
      explicitQuestionIds: null,
      questionIdFile: "/reports/answer-policy-slice.json",
      reanswerJobBuckets: null,
      reanswerJobCategories: ["open_domain"],
    });
  });

  it("can replay a bucketed answer-policy reanswer job by bucket and category", async () => {
    const answeredQuestionIds: string[] = [];
    const report = await runLocomoReportReanswer(
      {
        allowCommonsenseResolution: false,
        outputDir: "/reports/out",
        questionIdFile: "/reports/answer-policy-slice.json",
        reanswerJobBuckets: ["wrongFullRecallNoisy"],
        reanswerJobCategories: ["open_domain"],
        runId: "reanswer-open-domain-wrong-full-recall-noisy",
        sourceReportPath: "/reports/source/smoke-report.json",
        strictNoEvidenceAbstention: false,
      },
      {
        answerGenerator: async ({ question }) => {
          answeredQuestionIds.push(question.questionId);
          return question.questionId === "conv-test:q2"
            ? "Connecticut"
            : "I do not know";
        },
        mkdir: async () => undefined,
        readFile: async (path) => {
          if (path === "/reports/source/smoke-report.json") {
            return JSON.stringify(sourceReport());
          }
          if (path === "/reports/answer-policy-slice.json") {
            return JSON.stringify({
              reanswerJobs: [
                {
                  bucket: "baselineCorrectHighNoise",
                  category: "open_domain",
                  questionIds: ["conv-test:q1"],
                  sourceReportPath: "/reports/source/smoke-report.json",
                  sourceRunId: "source-report",
                },
                {
                  bucket: "wrongFullRecallNoisy",
                  category: "open_domain",
                  questionIds: ["conv-test:q2"],
                  sourceReportPath: "/reports/source/smoke-report.json",
                  sourceRunId: "source-report",
                },
              ],
              sourceReports: [
                {
                  path: "/reports/source/smoke-report.json",
                  runId: "source-report",
                },
              ],
            });
          }
          if (path === "/tmp/LOCOMO/cases.json") {
            return JSON.stringify({ cases: [testCase] });
          }
          throw new Error(`unexpected read: ${path}`);
        },
        writeFile: async () => undefined,
      },
    );

    expect(answeredQuestionIds).toEqual(["conv-test:q2"]);
    expect(report.questionCount).toBe(1);
    expect(report.questionIds).toEqual(["conv-test:q2"]);
    expect(report.reanswerSelection).toEqual({
      explicitQuestionIds: null,
      questionIdFile: "/reports/answer-policy-slice.json",
      reanswerJobBuckets: ["wrongFullRecallNoisy"],
      reanswerJobCategories: ["open_domain"],
    });
  });

  it("rejects unfiltered reanswer jobs without source provenance", async () => {
    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIdFile: "/reports/answer-policy-slice.json",
          runId: "reanswer-unfiltered-missing-job-provenance",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            if (path === "/reports/answer-policy-slice.json") {
              return JSON.stringify({
                reanswerJobs: [
                  {
                    questionIds: ["conv-test:q2"],
                  },
                ],
              });
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow(
      "selected reanswer job for conv-test:q2 does not declare sourceRunId or sourceReportPath",
    );
  });

  it("rejects filtered reanswer jobs without source provenance", async () => {
    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIdFile: "/reports/answer-policy-slice.json",
          reanswerJobCategories: ["open_domain"],
          runId: "reanswer-missing-job-provenance",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            if (path === "/reports/answer-policy-slice.json") {
              return JSON.stringify({
                reanswerJobs: [
                  {
                    category: "open_domain",
                    questionIds: ["conv-test:q2"],
                  },
                ],
              });
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow(
      "selected reanswer job for conv-test:q2 does not declare sourceRunId or sourceReportPath",
    );
  });

  it("rejects filtered reanswer manifests with non-object job entries", async () => {
    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIdFile: "/reports/answer-policy-slice.json",
          reanswerJobCategories: ["open_domain"],
          runId: "reanswer-non-object-job",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            if (path === "/reports/answer-policy-slice.json") {
              return JSON.stringify({
                reanswerJobs: [
                  null,
                  {
                    category: "open_domain",
                    questionIds: ["conv-test:q2"],
                    sourceReportPath: "/reports/source/smoke-report.json",
                    sourceRunId: "source-report",
                  },
                ],
              });
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow("reanswerJobs entry at index 0 must be an object");
  });

  it("rejects reanswer jobs whose bucket is not a string", async () => {
    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIdFile: "/reports/live-delta.json",
          reanswerJobBuckets: ["answerRegressions"],
          runId: "reanswer-malformed-job-bucket",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            if (path === "/reports/live-delta.json") {
              return JSON.stringify({
                reanswerJobs: [
                  {
                    bucket: 42,
                    questionIds: ["conv-test:q1"],
                    sourceReportPath: "/reports/source/smoke-report.json",
                    sourceRunId: "source-report",
                  },
                  {
                    bucket: "answerRegressions",
                    questionIds: ["conv-test:q2"],
                    sourceReportPath: "/reports/source/smoke-report.json",
                    sourceRunId: "source-report",
                  },
                ],
              });
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow("reanswer job bucket must be a string");
  });

  it("rejects reanswer jobs whose category is not a string", async () => {
    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIdFile: "/reports/answer-policy-slice.json",
          reanswerJobCategories: ["open_domain"],
          runId: "reanswer-malformed-job-category",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            if (path === "/reports/answer-policy-slice.json") {
              return JSON.stringify({
                reanswerJobs: [
                  {
                    category: 42,
                    questionIds: ["conv-test:q1"],
                    sourceReportPath: "/reports/source/smoke-report.json",
                    sourceRunId: "source-report",
                  },
                  {
                    category: "open_domain",
                    questionIds: ["conv-test:q2"],
                    sourceReportPath: "/reports/source/smoke-report.json",
                    sourceRunId: "source-report",
                  },
                ],
              });
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow("reanswer job category must be a string");
  });

  it("rejects reanswer jobs whose categories is not an array", async () => {
    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIdFile: "/reports/answer-policy-slice.json",
          reanswerJobCategories: ["open_domain"],
          runId: "reanswer-malformed-job-categories",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            if (path === "/reports/answer-policy-slice.json") {
              return JSON.stringify({
                reanswerJobs: [
                  {
                    categories: "open_domain",
                    questionIds: ["conv-test:q1"],
                    sourceReportPath: "/reports/source/smoke-report.json",
                    sourceRunId: "source-report",
                  },
                  {
                    category: "open_domain",
                    questionIds: ["conv-test:q2"],
                    sourceReportPath: "/reports/source/smoke-report.json",
                    sourceRunId: "source-report",
                  },
                ],
              });
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow("reanswer job categories must be an array");
  });

  it("rejects reanswer jobs whose categories contain non-string values", async () => {
    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIdFile: "/reports/answer-policy-slice.json",
          reanswerJobCategories: ["open_domain"],
          runId: "reanswer-malformed-job-categories-entry",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            if (path === "/reports/answer-policy-slice.json") {
              return JSON.stringify({
                reanswerJobs: [
                  {
                    categories: ["open_domain", 42],
                    questionIds: ["conv-test:q1"],
                    sourceReportPath: "/reports/source/smoke-report.json",
                    sourceRunId: "source-report",
                  },
                  {
                    category: "open_domain",
                    questionIds: ["conv-test:q2"],
                    sourceReportPath: "/reports/source/smoke-report.json",
                    sourceRunId: "source-report",
                  },
                ],
              });
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow(
      "reanswer job categories contains non-string value at index 1",
    );
  });

  it("rejects reanswer jobs whose bucket is not recognized", async () => {
    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIdFile: "/reports/live-delta.json",
          reanswerJobBuckets: ["answerRegressions"],
          runId: "reanswer-unknown-job-bucket",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            if (path === "/reports/live-delta.json") {
              return JSON.stringify({
                reanswerJobs: [
                  {
                    bucket: "typoBucket",
                    questionIds: ["conv-test:q1"],
                    sourceReportPath: "/reports/source/smoke-report.json",
                    sourceRunId: "source-report",
                  },
                  {
                    bucket: "answerRegressions",
                    questionIds: ["conv-test:q2"],
                    sourceReportPath: "/reports/source/smoke-report.json",
                    sourceRunId: "source-report",
                  },
                ],
              });
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow("reanswer job bucket typoBucket is not recognized");
  });

  it("rejects reanswer jobs whose category is not recognized", async () => {
    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIdFile: "/reports/answer-policy-slice.json",
          reanswerJobCategories: ["open_domain"],
          runId: "reanswer-unknown-job-category",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            if (path === "/reports/answer-policy-slice.json") {
              return JSON.stringify({
                reanswerJobs: [
                  {
                    category: "typo_category",
                    questionIds: ["conv-test:q1"],
                    sourceReportPath: "/reports/source/smoke-report.json",
                    sourceRunId: "source-report",
                  },
                  {
                    category: "open_domain",
                    questionIds: ["conv-test:q2"],
                    sourceReportPath: "/reports/source/smoke-report.json",
                    sourceRunId: "source-report",
                  },
                ],
              });
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow(
      "reanswer job category typo_category is not recognized",
    );
  });

  it("rejects reanswer jobs whose categories contain unknown values", async () => {
    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIdFile: "/reports/answer-policy-slice.json",
          reanswerJobCategories: ["open_domain"],
          runId: "reanswer-unknown-job-categories-entry",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            if (path === "/reports/answer-policy-slice.json") {
              return JSON.stringify({
                reanswerJobs: [
                  {
                    categories: ["open_domain", "typo_category"],
                    questionIds: ["conv-test:q1"],
                    sourceReportPath: "/reports/source/smoke-report.json",
                    sourceRunId: "source-report",
                  },
                  {
                    category: "open_domain",
                    questionIds: ["conv-test:q2"],
                    sourceReportPath: "/reports/source/smoke-report.json",
                    sourceRunId: "source-report",
                  },
                ],
              });
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow(
      "reanswer job categories value typo_category at index 1 is not recognized",
    );
  });

  it("rejects reanswer jobs whose categories contain duplicate values", async () => {
    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIdFile: "/reports/answer-policy-slice.json",
          reanswerJobCategories: ["open_domain"],
          runId: "reanswer-duplicate-job-categories-entry",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            if (path === "/reports/answer-policy-slice.json") {
              return JSON.stringify({
                reanswerJobs: [
                  {
                    categories: ["open_domain", "open_domain"],
                    questionIds: ["conv-test:q1"],
                    sourceReportPath: "/reports/source/smoke-report.json",
                    sourceRunId: "source-report",
                  },
                ],
              });
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow(
      "reanswer job categories contains duplicate value open_domain",
    );
  });

  it("rejects reanswer jobs whose category disagrees with categories", async () => {
    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIdFile: "/reports/answer-policy-slice.json",
          reanswerJobCategories: ["open_domain"],
          runId: "reanswer-conflicting-job-categories",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            if (path === "/reports/answer-policy-slice.json") {
              return JSON.stringify({
                reanswerJobs: [
                  {
                    categories: ["adversarial"],
                    category: "open_domain",
                    questionIds: ["conv-test:q2"],
                    sourceReportPath: "/reports/source/smoke-report.json",
                    sourceRunId: "source-report",
                  },
                ],
              });
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow(
      "reanswer job category open_domain does not match categories [adversarial]",
    );
  });

  it("rejects reanswer jobs whose categories add extra category filters", async () => {
    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIdFile: "/reports/answer-policy-slice.json",
          reanswerJobCategories: ["adversarial"],
          runId: "reanswer-extra-job-category",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            if (path === "/reports/answer-policy-slice.json") {
              return JSON.stringify({
                reanswerJobs: [
                  {
                    categories: ["open_domain", "adversarial"],
                    category: "open_domain",
                    questionIds: ["conv-test:q2"],
                    sourceReportPath: "/reports/source/smoke-report.json",
                    sourceRunId: "source-report",
                  },
                ],
              });
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow(
      "reanswer job category open_domain does not match categories [open_domain, adversarial]",
    );
  });

  it("rejects duplicate explicit question ids before replay", async () => {
    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIds: ["conv-test:q1", "conv-test:q1"],
          runId: "reanswer-duplicate-explicit-question",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async () => {
            throw new Error("source report should not be read");
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow(
      "explicit question ids contains duplicate question id conv-test:q1",
    );
  });

  it("rejects whitespace-padded explicit question ids before replay", async () => {
    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIds: [" conv-test:q1"],
          runId: "reanswer-padded-explicit-question",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async () => {
            throw new Error("source report should not be read");
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow(
      "explicit question ids contains leading or trailing whitespace",
    );
  });

  it("rejects explicit question ids that overlap unfiltered manifest jobs", async () => {
    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIdFile: "/reports/answer-policy-slice.json",
          questionIds: ["conv-test:q2"],
          runId: "reanswer-overlapping-unfiltered-manifest-question",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            if (path === "/reports/answer-policy-slice.json") {
              return JSON.stringify({
                reanswerJobs: [
                  {
                    questionIds: ["conv-test:q2"],
                    sourceReportPath: "/reports/source/smoke-report.json",
                    sourceRunId: "source-report",
                  },
                ],
              });
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow(
      "explicit question ids overlap question-id-file question id conv-test:q2",
    );
  });

  it("rejects explicit question ids that overlap filtered reanswer jobs", async () => {
    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIdFile: "/reports/live-delta.json",
          questionIds: ["conv-test:q2"],
          reanswerJobBuckets: ["topUnconvertedRetrievalGains"],
          runId: "reanswer-overlapping-explicit-and-job-question",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            if (path === "/reports/live-delta.json") {
              return JSON.stringify({
                reanswerJobs: [
                  {
                    bucket: "topUnconvertedRetrievalGains",
                    questionIds: ["conv-test:q2"],
                    sourceReportPath: "/reports/source/smoke-report.json",
                    sourceRunId: "source-report",
                  },
                ],
              });
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow(
      "explicit question ids overlap filtered reanswer job question id conv-test:q2",
    );
  });

  it("can replay one source from a same-category multi-source answer-policy manifest", async () => {
    const answeredQuestionIds: string[] = [];
    const report = await runLocomoReportReanswer(
      {
        allowCommonsenseResolution: false,
        outputDir: "/reports/out",
        questionIdFile: "/reports/answer-policy-slice.json",
        reanswerJobCategories: ["open_domain"],
        runId: "reanswer-open-domain-one-source",
        sourceReportPath: "/reports/source/smoke-report.json",
        strictNoEvidenceAbstention: false,
      },
      {
        answerGenerator: async ({ question }) => {
          answeredQuestionIds.push(question.questionId);
          return question.questionId === "conv-test:q2"
            ? "Connecticut"
            : "I do not know";
        },
        mkdir: async () => undefined,
        readFile: async (path) => {
          if (path === "/reports/source/smoke-report.json") {
            return JSON.stringify(sourceReport());
          }
          if (path === "/reports/answer-policy-slice.json") {
            return JSON.stringify({
              reanswerJobs: [
                {
                  category: "open_domain",
                  questionIds: ["conv-test:q2"],
                  sourceReportPath: "/reports/source/smoke-report.json",
                  sourceRunId: "source-report",
                },
                {
                  category: "open_domain",
                  questionIds: ["conv-other:q9"],
                  sourceReportPath: "/reports/other/smoke-report.json",
                  sourceRunId: "other-source-report",
                },
              ],
              sourceReports: [
                {
                  path: "/reports/source/smoke-report.json",
                  runId: "source-report",
                },
                {
                  path: "/reports/other/smoke-report.json",
                  runId: "other-source-report",
                },
              ],
            });
          }
          if (path === "/tmp/LOCOMO/cases.json") {
            return JSON.stringify({ cases: [testCase] });
          }
          throw new Error(`unexpected read: ${path}`);
        },
        writeFile: async () => undefined,
      },
    );

    expect(answeredQuestionIds).toEqual(["conv-test:q2"]);
    expect(report.questionCount).toBe(1);
    expect(report.questionIds).toEqual(["conv-test:q2"]);
    expect(report.reanswerSelection).toEqual({
      explicitQuestionIds: null,
      questionIdFile: "/reports/answer-policy-slice.json",
      reanswerJobBuckets: null,
      reanswerJobCategories: ["open_domain"],
    });
  });

  it("rejects category-filtered jobs whose source rows use another category", async () => {
    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIdFile: "/reports/answer-policy-slice.json",
          reanswerJobCategories: ["open_domain"],
          runId: "reanswer-job-source-category-mismatch",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          answerGenerator: async () => "No information available",
          mkdir: async () => undefined,
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            if (path === "/reports/answer-policy-slice.json") {
              return JSON.stringify({
                reanswerJobs: [
                  {
                    category: "open_domain",
                    questionIds: ["conv-test:q1"],
                    sourceReportPath: "/reports/source/smoke-report.json",
                    sourceRunId: "source-report",
                  },
                ],
              });
            }
            if (path === "/tmp/LOCOMO/cases.json") {
              return JSON.stringify({ cases: [testCase] });
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow(
      "selected source row conv-test:q1 category adversarial does not match reanswer category filter open_domain",
    );
  });

  it("rejects a manifest whose reanswer jobs target a different source run", async () => {
    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIdFile: "/reports/candidate-admission-slice.json",
          runId: "reanswer-wrong-source",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            if (path === "/reports/candidate-admission-slice.json") {
              return JSON.stringify({
                reanswerJobs: [
                  {
                    questionIds: ["conv-test:q2"],
                    sourceRunId: "candidate-report",
                  },
                ],
              });
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow(
      "targets source run(s) candidate-report but --source-report is source-report",
    );
  });

  it("rejects selected reanswer jobs whose questionCount mismatches questionIds", async () => {
    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIdFile: "/reports/live-delta.json",
          runId: "reanswer-mismatched-count",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            if (path === "/reports/live-delta.json") {
              return JSON.stringify({
                reanswerJobs: [
                  {
                    bucket: "answerRegressions",
                    questionCount: 2,
                    questionIds: ["conv-test:q1"],
                    sourceReportPath: "/reports/source/smoke-report.json",
                    sourceRunId: "source-report",
                  },
                ],
              });
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow(
      "reanswer job questionCount 2 does not match 1 questionIds",
    );
  });

  it("rejects selected reanswer jobs whose questionIds are not all strings", async () => {
    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIdFile: "/reports/live-delta.json",
          runId: "reanswer-non-string-question-id",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            if (path === "/reports/live-delta.json") {
              return JSON.stringify({
                reanswerJobs: [
                  {
                    bucket: "answerRegressions",
                    questionCount: 1,
                    questionIds: ["conv-test:q1", 42],
                    sourceReportPath: "/reports/source/smoke-report.json",
                    sourceRunId: "source-report",
                  },
                ],
              });
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow(
      "reanswer job questionIds contains non-string value at index 1",
    );
  });

  it("rejects selected reanswer jobs with empty question ids", async () => {
    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIdFile: "/reports/live-delta.json",
          runId: "reanswer-empty-job-question",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            if (path === "/reports/live-delta.json") {
              return JSON.stringify({
                reanswerJobs: [
                  {
                    bucket: "answerRegressions",
                    questionCount: 1,
                    questionIds: [""],
                    sourceReportPath: "/reports/source/smoke-report.json",
                    sourceRunId: "source-report",
                  },
                ],
              });
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow(
      "reanswer job questionIds contains empty string at index 0",
    );
  });

  it("rejects selected reanswer jobs with whitespace-padded question ids", async () => {
    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIdFile: "/reports/live-delta.json",
          runId: "reanswer-whitespace-job-question",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            if (path === "/reports/live-delta.json") {
              return JSON.stringify({
                reanswerJobs: [
                  {
                    bucket: "answerRegressions",
                    questionCount: 1,
                    questionIds: ["conv-test:q1 "],
                    sourceReportPath: "/reports/source/smoke-report.json",
                    sourceRunId: "source-report",
                  },
                ],
              });
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow(
      "reanswer job questionIds contains leading or trailing whitespace at index 0",
    );
  });

  it("rejects selected reanswer jobs with duplicate question ids inside one job", async () => {
    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIdFile: "/reports/live-delta.json",
          runId: "reanswer-duplicate-question-inside-job",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            if (path === "/reports/live-delta.json") {
              return JSON.stringify({
                reanswerJobs: [
                  {
                    bucket: "answerRegressions",
                    questionCount: 2,
                    questionIds: ["conv-test:q1", "conv-test:q1"],
                    sourceReportPath: "/reports/source/smoke-report.json",
                    sourceRunId: "source-report",
                  },
                ],
              });
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow(
      "reanswer job questionIds contains duplicate question id conv-test:q1",
    );
  });

  it("rejects selected reanswer jobs with duplicate question ids", async () => {
    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIdFile: "/reports/live-delta.json",
          runId: "reanswer-duplicate-job-question",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            if (path === "/reports/live-delta.json") {
              return JSON.stringify({
                reanswerJobs: [
                  {
                    bucket: "answerRegressions",
                    questionCount: 1,
                    questionIds: ["conv-test:q1"],
                    sourceReportPath: "/reports/source/smoke-report.json",
                    sourceRunId: "source-report",
                  },
                  {
                    bucket: "topUnconvertedRetrievalGains",
                    questionCount: 1,
                    questionIds: ["conv-test:q1"],
                    sourceReportPath: "/reports/source/smoke-report.json",
                    sourceRunId: "source-report",
                  },
                ],
              });
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow(
      "selected duplicate question id conv-test:q1 across reanswerJobs",
    );
  });

  it("rejects mixed-source reanswer manifests instead of partially accepting them", async () => {
    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIdFile: "/reports/live-delta.json",
          runId: "reanswer-mixed-source",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            if (path === "/reports/live-delta.json") {
              return JSON.stringify({
                candidateReport: { runId: "source-report" },
                reanswerJobs: [
                  {
                    bucket: "answerRegressions",
                    questionIds: ["conv-test:q1"],
                    sourceRunId: "source-report",
                  },
                  {
                    bucket: "residualLiveAnswerChanges",
                    questionIds: ["conv-test:q2"],
                    sourceRunId: "other-source-report",
                  },
                ],
              });
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow(
      "targets source run(s) other-source-report but --source-report is source-report",
    );
  });

  it("rejects a reanswer manifest with a matching run id but different source report path", async () => {
    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIdFile: "/reports/live-delta.json",
          runId: "reanswer-wrong-source-path",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            if (path === "/reports/live-delta.json") {
              return JSON.stringify({
                reanswerJobs: [
                  {
                    bucket: "answerRegressions",
                    questionIds: ["conv-test:q1"],
                    sourceReportPath: "/reports/other/smoke-report.json",
                    sourceRunId: "source-report",
                  },
                ],
              });
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow(
      "targets source report path(s) /reports/other/smoke-report.json but --source-report is /reports/source/smoke-report.json",
    );
  });

  it("rejects reanswer jobs whose sourceRunId is not a string", async () => {
    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIdFile: "/reports/live-delta.json",
          runId: "reanswer-malformed-job-run-id",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            if (path === "/reports/live-delta.json") {
              return JSON.stringify({
                reanswerJobs: [
                  {
                    bucket: "answerRegressions",
                    questionIds: ["conv-test:q1"],
                    sourceRunId: 42,
                  },
                ],
              });
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow("reanswer job sourceRunId must be a string");
  });

  it("rejects reanswer jobs whose sourceReportPath is not a string", async () => {
    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIdFile: "/reports/live-delta.json",
          runId: "reanswer-malformed-job-report-path",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            if (path === "/reports/live-delta.json") {
              return JSON.stringify({
                reanswerJobs: [
                  {
                    bucket: "answerRegressions",
                    questionIds: ["conv-test:q1"],
                    sourceReportPath: 42,
                  },
                ],
              });
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow("reanswer job sourceReportPath must be a string");
  });

  it("rejects reanswer jobs whose source provenance is empty", async () => {
    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIdFile: "/reports/answer-policy-slice.json",
          reanswerJobCategories: ["open_domain"],
          runId: "reanswer-empty-job-source-provenance",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            if (path === "/reports/answer-policy-slice.json") {
              return JSON.stringify({
                reanswerJobs: [
                  {
                    category: "open_domain",
                    questionIds: ["conv-test:q1"],
                    sourceRunId: "",
                  },
                  {
                    category: "open_domain",
                    questionIds: ["conv-test:q2"],
                    sourceReportPath: " ",
                  },
                ],
              });
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow("reanswer job sourceRunId must not be empty");

    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIdFile: "/reports/answer-policy-slice.json",
          reanswerJobCategories: ["open_domain"],
          runId: "reanswer-empty-job-source-path",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            if (path === "/reports/answer-policy-slice.json") {
              return JSON.stringify({
                reanswerJobs: [
                  {
                    category: "open_domain",
                    questionIds: ["conv-test:q1"],
                    sourceReportPath: " ",
                  },
                ],
              });
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow("reanswer job sourceReportPath must not be empty");
  });

  it("rejects reanswer jobs whose source provenance is whitespace-padded", async () => {
    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIdFile: "/reports/answer-policy-slice.json",
          reanswerJobCategories: ["open_domain"],
          runId: "reanswer-padded-job-source-run-id",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            if (path === "/reports/answer-policy-slice.json") {
              return JSON.stringify({
                reanswerJobs: [
                  {
                    category: "open_domain",
                    questionIds: ["conv-test:q1"],
                    sourceRunId: "source-report ",
                  },
                ],
              });
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow(
      "reanswer job sourceRunId must not have leading or trailing whitespace",
    );

    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIdFile: "/reports/answer-policy-slice.json",
          reanswerJobCategories: ["open_domain"],
          runId: "reanswer-padded-job-source-path",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            if (path === "/reports/answer-policy-slice.json") {
              return JSON.stringify({
                reanswerJobs: [
                  {
                    category: "open_domain",
                    questionIds: ["conv-test:q1"],
                    sourceReportPath: " /reports/source/smoke-report.json",
                  },
                ],
              });
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow(
      "reanswer job sourceReportPath must not have leading or trailing whitespace",
    );
  });

  it("rejects reanswer manifests whose candidate report conflicts with job provenance", async () => {
    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIdFile: "/reports/live-delta.json",
          runId: "reanswer-conflicting-provenance",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            if (path === "/reports/live-delta.json") {
              return JSON.stringify({
                candidateReport: {
                  path: "/reports/other/smoke-report.json",
                  runId: "other-source-report",
                },
                reanswerJobs: [
                  {
                    bucket: "answerRegressions",
                    questionIds: ["conv-test:q1"],
                    sourceReportPath: "/reports/source/smoke-report.json",
                    sourceRunId: "source-report",
                  },
                ],
              });
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow(
      "targets source run(s) other-source-report but --source-report is source-report",
    );
  });

  it("rejects reanswer manifests whose candidateReport lineage is not an object", async () => {
    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIdFile: "/reports/live-delta.json",
          runId: "reanswer-malformed-candidate-report",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            if (path === "/reports/live-delta.json") {
              return JSON.stringify({
                candidateReport: "source-report",
                reanswerJobs: [
                  {
                    bucket: "answerRegressions",
                    questionIds: ["conv-test:q1"],
                    sourceReportPath: "/reports/source/smoke-report.json",
                    sourceRunId: "source-report",
                  },
                ],
              });
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow("candidateReport must be an object");
  });

  it("rejects reanswer manifests whose candidateReport lineage fields are not strings", async () => {
    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIdFile: "/reports/live-delta.json",
          runId: "reanswer-malformed-candidate-report-field",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            if (path === "/reports/live-delta.json") {
              return JSON.stringify({
                candidateReport: {
                  path: 42,
                  runId: "source-report",
                },
                reanswerJobs: [
                  {
                    bucket: "answerRegressions",
                    questionIds: ["conv-test:q1"],
                    sourceReportPath: "/reports/source/smoke-report.json",
                    sourceRunId: "source-report",
                  },
                ],
              });
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow("candidateReport.path must be a string");
  });

  it("rejects reanswer manifests whose report lineage lacks an identity", async () => {
    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIdFile: "/reports/live-delta.json",
          runId: "reanswer-unidentified-candidate-report",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            if (path === "/reports/live-delta.json") {
              return JSON.stringify({
                candidateReport: {},
                reanswerJobs: [
                  {
                    bucket: "answerRegressions",
                    questionIds: ["conv-test:q1"],
                    sourceReportPath: "/reports/source/smoke-report.json",
                    sourceRunId: "source-report",
                  },
                ],
              });
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow("candidateReport must declare runId or path");

    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIdFile: "/reports/answer-policy-slice.json",
          runId: "reanswer-unidentified-source-report",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            if (path === "/reports/answer-policy-slice.json") {
              return JSON.stringify({
                reanswerJobs: [
                  {
                    questionIds: ["conv-test:q1"],
                    sourceReportPath: "/reports/source/smoke-report.json",
                    sourceRunId: "source-report",
                  },
                ],
                sourceReports: [{}],
              });
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow(
      "sourceReports entry at index 0 must declare runId or path",
    );
  });

  it("rejects reanswer manifests whose sourceReports conflict with selected job provenance", async () => {
    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIdFile: "/reports/answer-policy-slice.json",
          reanswerJobCategories: ["open_domain"],
          runId: "reanswer-conflicting-source-reports",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            if (path === "/reports/answer-policy-slice.json") {
              return JSON.stringify({
                reanswerJobs: [
                  {
                    category: "open_domain",
                    questionIds: ["conv-test:q2"],
                    sourceReportPath: "/reports/source/smoke-report.json",
                    sourceRunId: "source-report",
                  },
                ],
                sourceReports: [
                  {
                    path: "/reports/source/smoke-report.json",
                    runId: "source-report",
                  },
                  {
                    path: "/reports/other/smoke-report.json",
                    runId: "source-report",
                  },
                ],
              });
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow(
      "targets source report path(s) /reports/other/smoke-report.json but --source-report is /reports/source/smoke-report.json",
    );
  });

  it("rejects reanswer manifests with duplicate selected sourceReports lineage", async () => {
    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIdFile: "/reports/answer-policy-slice.json",
          reanswerJobCategories: ["open_domain"],
          runId: "reanswer-duplicate-source-reports",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            if (path === "/reports/answer-policy-slice.json") {
              return JSON.stringify({
                reanswerJobs: [
                  {
                    category: "open_domain",
                    questionIds: ["conv-test:q2"],
                    sourceReportPath: "/reports/source/smoke-report.json",
                    sourceRunId: "source-report",
                  },
                ],
                sourceReports: [
                  {
                    path: "/reports/source/smoke-report.json",
                    runId: "source-report",
                  },
                  {
                    path: "/reports/source/smoke-report.json",
                    runId: "source-report",
                  },
                ],
              });
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow("sourceReports contains duplicate runId source-report");
  });

  it("rejects reanswer manifests with non-object sourceReports entries", async () => {
    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIdFile: "/reports/answer-policy-slice.json",
          runId: "reanswer-malformed-source-report-lineage",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            if (path === "/reports/answer-policy-slice.json") {
              return JSON.stringify({
                reanswerJobs: [
                  {
                    questionIds: ["conv-test:q1"],
                    sourceReportPath: "/reports/source/smoke-report.json",
                    sourceRunId: "source-report",
                  },
                ],
                sourceReports: [null],
              });
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow("sourceReports entry at index 0 must be an object");
  });

  it("rejects reanswer manifests whose sourceReports lineage fields are not strings", async () => {
    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIdFile: "/reports/answer-policy-slice.json",
          runId: "reanswer-malformed-source-report-field",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            if (path === "/reports/answer-policy-slice.json") {
              return JSON.stringify({
                reanswerJobs: [
                  {
                    questionIds: ["conv-test:q1"],
                    sourceReportPath: "/reports/source/smoke-report.json",
                    sourceRunId: "source-report",
                  },
                ],
                sourceReports: [
                  {
                    path: "/reports/source/smoke-report.json",
                    runId: 42,
                  },
                ],
              });
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow("sourceReports entry at index 0 runId must be a string");
  });

  it("rejects reanswer manifests whose report lineage fields are empty", async () => {
    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIdFile: "/reports/live-delta.json",
          runId: "reanswer-empty-candidate-report-run-id",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            if (path === "/reports/live-delta.json") {
              return JSON.stringify({
                candidateReport: {
                  path: "/reports/source/smoke-report.json",
                  runId: "",
                },
                reanswerJobs: [
                  {
                    bucket: "answerRegressions",
                    questionIds: ["conv-test:q1"],
                    sourceReportPath: "/reports/source/smoke-report.json",
                    sourceRunId: "source-report",
                  },
                ],
              });
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow("candidateReport.runId must not be empty");

    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIdFile: "/reports/live-delta.json",
          runId: "reanswer-empty-candidate-report-path",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            if (path === "/reports/live-delta.json") {
              return JSON.stringify({
                candidateReport: {
                  path: " ",
                  runId: "source-report",
                },
                reanswerJobs: [
                  {
                    bucket: "answerRegressions",
                    questionIds: ["conv-test:q1"],
                    sourceReportPath: "/reports/source/smoke-report.json",
                    sourceRunId: "source-report",
                  },
                ],
              });
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow("candidateReport.path must not be empty");

    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIdFile: "/reports/answer-policy-slice.json",
          runId: "reanswer-empty-source-report-run-id",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            if (path === "/reports/answer-policy-slice.json") {
              return JSON.stringify({
                reanswerJobs: [
                  {
                    questionIds: ["conv-test:q1"],
                    sourceReportPath: "/reports/source/smoke-report.json",
                    sourceRunId: "source-report",
                  },
                ],
                sourceReports: [
                  {
                    path: "/reports/source/smoke-report.json",
                    runId: "",
                  },
                ],
              });
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow("sourceReports entry at index 0 runId must not be empty");

    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIdFile: "/reports/answer-policy-slice.json",
          runId: "reanswer-empty-source-report-path",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            if (path === "/reports/answer-policy-slice.json") {
              return JSON.stringify({
                reanswerJobs: [
                  {
                    questionIds: ["conv-test:q1"],
                    sourceReportPath: "/reports/source/smoke-report.json",
                    sourceRunId: "source-report",
                  },
                ],
                sourceReports: [
                  {
                    path: " ",
                    runId: "source-report",
                  },
                ],
              });
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow("sourceReports entry at index 0 path must not be empty");
  });

  it("rejects reanswer manifests whose report lineage fields are whitespace-padded", async () => {
    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIdFile: "/reports/live-delta.json",
          runId: "reanswer-padded-candidate-report-run-id",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            if (path === "/reports/live-delta.json") {
              return JSON.stringify({
                candidateReport: {
                  path: "/reports/source/smoke-report.json",
                  runId: "source-report ",
                },
                reanswerJobs: [
                  {
                    bucket: "answerRegressions",
                    questionIds: ["conv-test:q1"],
                    sourceReportPath: "/reports/source/smoke-report.json",
                    sourceRunId: "source-report",
                  },
                ],
              });
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow(
      "candidateReport.runId must not have leading or trailing whitespace",
    );

    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIdFile: "/reports/live-delta.json",
          runId: "reanswer-padded-candidate-report-path",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            if (path === "/reports/live-delta.json") {
              return JSON.stringify({
                candidateReport: {
                  path: " /reports/source/smoke-report.json",
                  runId: "source-report",
                },
                reanswerJobs: [
                  {
                    bucket: "answerRegressions",
                    questionIds: ["conv-test:q1"],
                    sourceReportPath: "/reports/source/smoke-report.json",
                    sourceRunId: "source-report",
                  },
                ],
              });
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow(
      "candidateReport.path must not have leading or trailing whitespace",
    );

    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIdFile: "/reports/answer-policy-slice.json",
          runId: "reanswer-padded-source-report-run-id",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            if (path === "/reports/answer-policy-slice.json") {
              return JSON.stringify({
                reanswerJobs: [
                  {
                    questionIds: ["conv-test:q1"],
                    sourceReportPath: "/reports/source/smoke-report.json",
                    sourceRunId: "source-report",
                  },
                ],
                sourceReports: [
                  {
                    path: "/reports/source/smoke-report.json",
                    runId: " source-report",
                  },
                ],
              });
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow(
      "sourceReports entry at index 0 runId must not have leading or trailing whitespace",
    );

    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIdFile: "/reports/answer-policy-slice.json",
          runId: "reanswer-padded-source-report-path",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            if (path === "/reports/answer-policy-slice.json") {
              return JSON.stringify({
                reanswerJobs: [
                  {
                    questionIds: ["conv-test:q1"],
                    sourceReportPath: "/reports/source/smoke-report.json",
                    sourceRunId: "source-report",
                  },
                ],
                sourceReports: [
                  {
                    path: "/reports/source/smoke-report.json ",
                    runId: "source-report",
                  },
                ],
              });
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow(
      "sourceReports entry at index 0 path must not have leading or trailing whitespace",
    );
  });

  it("rejects reanswer manifests whose sourceReports lineage is not an array", async () => {
    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIdFile: "/reports/answer-policy-slice.json",
          runId: "reanswer-malformed-source-reports-container",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            if (path === "/reports/answer-policy-slice.json") {
              return JSON.stringify({
                reanswerJobs: [
                  {
                    questionIds: ["conv-test:q1"],
                    sourceReportPath: "/reports/source/smoke-report.json",
                    sourceRunId: "source-report",
                  },
                ],
                sourceReports: {
                  path: "/reports/source/smoke-report.json",
                  runId: "source-report",
                },
              });
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow("sourceReports must be an array");
  });

  it("reanswers selected questions from a source report without rerunning retrieval", async () => {
    const writes = new Map<string, string>();
    const report = await runLocomoReportReanswer(
      {
        allowCommonsenseResolution: true,
        outputDir: "/reports/out",
        questionIds: ["conv-test:q1"],
        runId: "reanswer-run",
        sourceReportPath: "/reports/source/smoke-report.json",
        strictNoEvidenceAbstention: true,
      },
      {
        answerGenerator: async ({ memoryContext }) => {
          expect(memoryContext).toContain("D1:1");
          expect(memoryContext).not.toContain("D1:2");
          return "I do not know";
        },
        mkdir: async () => undefined,
        readFile: async (path) => {
          if (path === "/reports/source/smoke-report.json") {
            return JSON.stringify({
              ...sourceReport(),
              questionIds: ["conv-test:q1", "conv-test:q2"],
              questionSelection: {
                explicitQuestionIds: ["conv-test:q1", "conv-test:q2"],
                questionIdFile: null,
                repairJobDiagnoses: null,
                repairJobRetrievalBuckets: null,
              },
            });
          }
          if (path === "/tmp/LOCOMO/cases.json") {
            return JSON.stringify({ cases: [testCase] });
          }
          throw new Error(`unexpected read: ${path}`);
        },
        writeFile: async (path, data) => {
          writes.set(path, data);
        },
      },
    );

    expect(report.allowCommonsenseResolution).toBe(true);
    expect(report.strictNoEvidenceAbstention).toBe(true);
    expect(report.answerContextMode).toBe("evidence-pack");
    expect(report.sourceReport).toEqual({
      answerContextMode: "evidence-pack",
      generatedAt: "2026-07-03T00:00:00.000Z",
      path: "/reports/source/smoke-report.json",
      retrievalConfig: {
        bm25Ranking: false,
        semanticCandidateEmbeddingSource: "provider",
        semanticCandidates: {
          enabled: true,
          maxAdditions: 4,
          minRelativeScore: null,
          minSimilarity: null,
          topK: 16,
        },
      },
      runId: "source-report",
    });
    expect(report.executionFailures).toBe(0);
    expect(report.questionSelection).toBeUndefined();
    expect(report.questionCount).toBe(1);
    expect(report.questionIds).toEqual(["conv-test:q1"]);
    expect(report.cases[0]).toMatchObject({
      answerCorrect: true,
      answerTokenF1: 0,
      generatedAnswer: "I do not know",
      retrievedTurnIds: ["D1:1"],
    });
    expect(writes.get("/reports/out/reanswer-run/smoke-report.json")).toContain(
      "\"runId\": \"reanswer-run\"",
    );
    expect(writes.get("/reports/out/reanswer-run/smoke-report.json")).toContain(
      "\"sourceReport\"",
    );
    expect(writes.get("/reports/out/reanswer-run/smoke-report.json")).toContain(
      "\"answerTokenF1\": 0",
    );
  });

  it("can bound answer evidence without changing source retrieval evidence", async () => {
    const noisySource = sourceReport();
    noisySource.cases[1] = {
      ...noisySource.cases[1]!,
      noiseTurnCount: 1,
      noiseTurnIds: ["D1:1"],
      retrievedTurnIds: ["D1:2", "D1:1"],
    };

    const report = await runLocomoReportReanswer(
      {
        allowCommonsenseResolution: false,
        maxEvidenceTurns: 1,
        outputDir: "/reports/out",
        questionIds: ["conv-test:q2"],
        runId: "reanswer-bounded-evidence",
        sourceReportPath: "/reports/source/smoke-report.json",
        strictNoEvidenceAbstention: false,
      },
      {
        answerGenerator: async ({ memoryContext, retrievedTurnIds }) => {
          expect(retrievedTurnIds).toEqual(["D1:2"]);
          expect(memoryContext).toContain("D1:2");
          expect(memoryContext).not.toContain("D1:1");
          return "Connecticut";
        },
        mkdir: async () => undefined,
        readFile: async (path) => {
          if (path === "/reports/source/smoke-report.json") {
            return JSON.stringify(noisySource);
          }
          if (path === "/tmp/LOCOMO/cases.json") {
            return JSON.stringify({ cases: [testCase] });
          }
          throw new Error(`unexpected read: ${path}`);
        },
        writeFile: async () => undefined,
      },
    );

    expect(report.answerEvidenceTurnLimit).toBe(1);
    expect(report.cases[0]).toMatchObject({
      answerCorrect: true,
      noiseTurnIds: ["D1:1"],
      retrievedTurnIds: ["D1:2", "D1:1"],
    });
  });

  it("can retain unselected source answers in a full report", async () => {
    const staleSourceLineage = {
      ...sourceReport(),
      answerAccuracyOverall: 0,
      answerAttempts: 1,
      answerSystem: "stale-source-answer-system",
      answerTimeoutMs: 60_000,
      concurrency: 1,
      evidenceRecallOverall: 0,
    };
    const report = await runLocomoReportReanswer(
      {
        allowCommonsenseResolution: false,
        concurrency: 2,
        outputDir: "/reports/out",
        questionIds: ["conv-test:q1"],
        retainUnselected: true,
        runId: "full-reanswer-run",
        sourceReportPath: "/reports/source/smoke-report.json",
        strictNoEvidenceAbstention: false,
      },
      {
        answerGenerator: async () => "No information available",
        mkdir: async () => undefined,
        readFile: async (path) => {
          if (path === "/reports/source/smoke-report.json") {
            return JSON.stringify(staleSourceLineage);
          }
          if (path === "/tmp/LOCOMO/cases.json") {
            return JSON.stringify({ cases: [testCase] });
          }
          throw new Error(`unexpected read: ${path}`);
        },
        writeFile: async () => undefined,
      },
    );

    expect(report.caseCount).toBe(1);
    expect(report.caseIds).toEqual([testCase.caseId]);
    expect(report.questionCount).toBe(2);
    expect(report.questionIds).toBeNull();
    expect(report.cases).toHaveLength(2);
    expect(report.cases[0]).toMatchObject({
      answerCorrect: true,
      generatedAnswer: "No information available",
      questionId: "conv-test:q1",
    });
    expect(report.cases[1]).toMatchObject({
      answerCorrect: false,
      generatedAnswer: "I do not know",
      questionId: "conv-test:q2",
    });
    expect(report.reanswerSelection?.explicitQuestionIds).toEqual([
      "conv-test:q1",
    ]);
    expect(report).toMatchObject({
      answerAccuracyOverall: 0.5,
      answerAttempts: 3,
      answerSystem: null,
      answerTimeoutMs: null,
      concurrency: 2,
      evidenceRecallOverall: 1,
    });
  });

  it("can retain unselected source answers from a packet evidence report", async () => {
    const packetSource = {
      ...sourceReport(),
      answerContextMode: "packet-evidence-pack" as const,
    };
    const report = await runLocomoReportReanswer(
      {
        allowCommonsenseResolution: false,
        outputDir: "/reports/out",
        questionIds: ["conv-test:q1"],
        retainUnselected: true,
        runId: "packet-full-reanswer-run",
        sourceReportPath: "/reports/source/smoke-report.json",
        strictNoEvidenceAbstention: false,
      },
      {
        answerGenerator: async () => "No information available",
        mkdir: async () => undefined,
        readFile: async (path) => {
          if (path === "/reports/source/smoke-report.json") {
            return JSON.stringify(packetSource);
          }
          if (path === "/tmp/LOCOMO/cases.json") {
            return JSON.stringify({ cases: [testCase] });
          }
          throw new Error(`unexpected read: ${path}`);
        },
        writeFile: async () => undefined,
      },
    );

    expect(report.questionCount).toBe(2);
    expect(report.cases[0]).toMatchObject({
      generatedAnswer: "No information available",
      questionId: "conv-test:q1",
    });
    expect(report.cases[1]).toMatchObject({
      generatedAnswer: "I do not know",
      questionId: "conv-test:q2",
    });
    expect(report.sourceReport?.answerContextMode).toBe(
      "packet-evidence-pack",
    );
  });

  it("accepts a generalized recommended retrieval report as a reanswer source", async () => {
    const recommendedSource = sourceReport();
    recommendedSource.answerContextMode = "raw-turns";
    recommendedSource.answerEvaluation = "deferred-to-live-mode";
    recommendedSource.mode = "retrieval-only";
    recommendedSource.profilesCompared = ["goodmemory-recommended"];
    recommendedSource.cases = recommendedSource.cases.map((result) => ({
      ...result,
      answerCorrect: null,
      generatedAnswer: null,
    }));

    const report = await runLocomoReportReanswer(
      {
        allowCommonsenseResolution: true,
        answerProfile: "temporal-bounded-v3",
        outputDir: "/reports/out",
        questionIds: ["conv-test:q2"],
        runId: "recommended-reanswer-run",
        sourceReportPath: "/reports/source/smoke-report.json",
        strictNoEvidenceAbstention: false,
      },
      {
        answerGenerator: async () => "Connecticut",
        mkdir: async () => undefined,
        readFile: async (path) => {
          if (path === "/reports/source/smoke-report.json") {
            return JSON.stringify(recommendedSource);
          }
          if (path === "/tmp/LOCOMO/cases.json") {
            return JSON.stringify({ cases: [testCase] });
          }
          throw new Error(`unexpected read: ${path}`);
        },
        writeFile: async () => undefined,
      },
    );

    expect(report.profilesCompared).toEqual(["goodmemory-recommended"]);
    expect(report.answerSystem).toBe(
      "union-live-category-aware-temporal-bounded-v3",
    );
    expect(report.cases[0]).toMatchObject({
      answerCorrect: true,
      generatedAnswer: "Connecticut",
      questionId: "conv-test:q2",
    });
  });

  it("runs independent answer calls concurrently while preserving source order", async () => {
    let active = 0;
    let maxActive = 0;
    const progress: number[] = [];
    const report = await runLocomoReportReanswer(
      {
        allowCommonsenseResolution: true,
        concurrency: 2,
        outputDir: "/reports/out",
        runId: "concurrent-reanswer-run",
        sourceReportPath: "/reports/source/smoke-report.json",
        strictNoEvidenceAbstention: false,
      },
      {
        answerGenerator: async ({ question }) => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await Bun.sleep(5);
          active -= 1;
          return question.category === "adversarial"
            ? "No information available"
            : "Connecticut";
        },
        mkdir: async () => undefined,
        onProgress: ({ completed }) => {
          progress.push(completed);
        },
        readFile: async (path) => {
          if (path === "/reports/source/smoke-report.json") {
            return JSON.stringify(sourceReport());
          }
          if (path === "/tmp/LOCOMO/cases.json") {
            return JSON.stringify({ cases: [testCase] });
          }
          throw new Error(`unexpected read: ${path}`);
        },
        writeFile: async () => undefined,
      },
    );

    expect(maxActive).toBe(2);
    expect(progress).toEqual([1, 2]);
    expect(report.cases.map(({ questionId }) => questionId)).toEqual([
      "conv-test:q1",
      "conv-test:q2",
    ]);
  });

  it("narrows inherited question category headers to the reanswered rows", async () => {
    const categoryScopedSource = sourceReport();
    categoryScopedSource.questionCategories = ["adversarial", "open_domain"];
    const writes = new Map<string, string>();
    const report = await runLocomoReportReanswer(
      {
        allowCommonsenseResolution: false,
        outputDir: "/reports/out",
        questionIds: ["conv-test:q2"],
        runId: "reanswer-category-scoped-source",
        sourceReportPath: "/reports/source/smoke-report.json",
        strictNoEvidenceAbstention: false,
      },
      {
        answerGenerator: async () => "Connecticut",
        mkdir: async () => undefined,
        readFile: async (path) => {
          if (path === "/reports/source/smoke-report.json") {
            return JSON.stringify(categoryScopedSource);
          }
          if (path === "/tmp/LOCOMO/cases.json") {
            return JSON.stringify({ cases: [testCase] });
          }
          throw new Error(`unexpected read: ${path}`);
        },
        writeFile: async (path, data) => {
          writes.set(path, data);
        },
      },
    );

    expect(report.questionIds).toEqual(["conv-test:q2"]);
    expect(report.questionCategories).toEqual(["open_domain"]);
    const writtenReport = JSON.parse(
      writes.get(
        "/reports/out/reanswer-category-scoped-source/smoke-report.json",
      ) ?? "{}",
    ) as LocomoSmokeReport;
    expect(writtenReport.questionCategories).toEqual(["open_domain"]);
  });

  it("can isolate answer noise by packing only retrieved gold evidence turns", async () => {
    const noisySource = sourceReport();
    noisySource.cases[1] = {
      ...noisySource.cases[1]!,
      noiseTurnCount: 1,
      noiseTurnIds: ["D1:1"],
      retrievedTurnIds: ["D1:2", "D1:1"],
    };

    const report = await runLocomoReportReanswer(
      {
        allowCommonsenseResolution: false,
        goldEvidenceOnlyContext: true,
        outputDir: "/reports/out",
        questionIds: ["conv-test:q2"],
        runId: "reanswer-gold-only",
        sourceReportPath: "/reports/source/smoke-report.json",
        strictNoEvidenceAbstention: false,
      },
      {
        answerGenerator: async ({ memoryContext, retrievedTurnIds }) => {
          expect(retrievedTurnIds).toEqual(["D1:2"]);
          expect(memoryContext).toContain("D1:2");
          expect(memoryContext).not.toContain("D1:1");
          return "Connecticut";
        },
        mkdir: async () => undefined,
        readFile: async (path) => {
          if (path === "/reports/source/smoke-report.json") {
            return JSON.stringify(noisySource);
          }
          if (path === "/tmp/LOCOMO/cases.json") {
            return JSON.stringify({ cases: [testCase] });
          }
          throw new Error(`unexpected read: ${path}`);
        },
        writeFile: async () => undefined,
      },
    );

    expect(report.answerContextMode).toBe("gold-evidence-only-pack");
    expect(report.cases[0]).toMatchObject({
      answerCorrect: true,
      noiseTurnIds: ["D1:1"],
      retrievedTurnIds: ["D1:2", "D1:1"],
    });
  });

  it("rejects gold-evidence-only source reports before generating nested replay lineage", async () => {
    const goldOnlySource: LocomoSmokeReport = {
      ...sourceReport(),
      answerContextMode: "gold-evidence-only-pack",
      generatedBy: "scripts/reanswer-phase-65-locomo-report.ts",
      questionIds: ["conv-test:q1", "conv-test:q2"],
      reanswerSelection: {
        explicitQuestionIds: ["conv-test:q1", "conv-test:q2"],
        questionIdFile: null,
        reanswerJobBuckets: null,
        reanswerJobCategories: null,
      },
      runId: "gold-only-source-report",
      sourceReport: {
        answerContextMode: "evidence-pack",
        generatedAt: "2026-07-03T00:00:00.000Z",
        path: "/reports/original/smoke-report.json",
        retrievalConfig: {
          bm25Ranking: false,
          semanticCandidateEmbeddingSource: "provider",
          semanticCandidates: {
            enabled: true,
            maxAdditions: 4,
            minRelativeScore: null,
            minSimilarity: null,
            topK: 16,
          },
        },
        runId: "original-source-report",
      },
    };

    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIds: ["conv-test:q2"],
          runId: "reanswer-from-gold-only-source",
          sourceReportPath: "/reports/gold-only/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            if (path === "/reports/gold-only/smoke-report.json") {
              return JSON.stringify(goldOnlySource);
            }
            if (path === "/tmp/LOCOMO/cases.json") {
              return JSON.stringify({ cases: [testCase] });
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow(
      "gold-evidence-only-pack reports cannot be used as reanswer source reports",
    );
  });

  it("rejects reanswer-generated source reports before flattening replay lineage", async () => {
    const reanswerSource: LocomoSmokeReport = {
      ...sourceReport(),
      generatedBy: "scripts/reanswer-phase-65-locomo-report.ts",
      questionIds: ["conv-test:q1", "conv-test:q2"],
      reanswerSelection: {
        explicitQuestionIds: ["conv-test:q1", "conv-test:q2"],
        questionIdFile: null,
        reanswerJobBuckets: null,
        reanswerJobCategories: null,
      },
      runId: "first-reanswer-source",
      sourceReport: {
        answerContextMode: "evidence-pack",
        generatedAt: "2026-07-03T00:00:00.000Z",
        path: "/reports/original/smoke-report.json",
        retrievalConfig: {
          bm25Ranking: false,
          semanticCandidateEmbeddingSource: "provider",
          semanticCandidates: {
            enabled: true,
            maxAdditions: 4,
            minRelativeScore: null,
            minSimilarity: null,
            topK: 16,
          },
        },
        runId: "original-source-report",
      },
    };

    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIds: ["conv-test:q2"],
          runId: "second-reanswer",
          sourceReportPath: "/reports/reanswer-source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          answerGenerator: async () => "Connecticut",
          mkdir: async () => undefined,
          readFile: async (path) => {
            if (path === "/reports/reanswer-source/smoke-report.json") {
              return JSON.stringify(reanswerSource);
            }
            if (path === "/tmp/LOCOMO/cases.json") {
              return JSON.stringify({ cases: [testCase] });
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow(
      "reanswer-generated reports cannot be used as reanswer source reports",
    );
  });

  it("rejects failed source reports before checking incomplete live rows", async () => {
    const baseSource = sourceReport();
    const failedIncompleteSource: LocomoSmokeReport = {
      ...baseSource,
      cases: [
        {
          ...baseSource.cases[0]!,
          answerCorrect: null,
          generatedAnswer: null,
        },
        baseSource.cases[1]!,
      ],
      executionFailures: 1,
    };

    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIds: ["conv-test:q1"],
          runId: "reanswer-failed-incomplete-source",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(failedIncompleteSource);
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow(
      "Source report /reports/source/smoke-report.json has 1 execution failure(s).",
    );
  });

  it("rejects incomplete live source reports even when executionFailures is zero", async () => {
    const baseSource = sourceReport();
    const incompleteLiveSource: LocomoSmokeReport = {
      ...baseSource,
      cases: [
        {
          ...baseSource.cases[0]!,
          answerCorrect: null,
          generatedAnswer: null,
        },
        baseSource.cases[1]!,
      ],
    };

    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIds: ["conv-test:q1"],
          runId: "reanswer-incomplete-live-source",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(incompleteLiveSource);
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow(
      "zero-failure live-answer row locomo-conv-test::conv-test:q1 is missing scored answer fields",
    );
  });

  it("rejects source reports dated after the reanswer report timestamp", async () => {
    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIds: ["conv-test:q1"],
          runId: "reanswer-future-source",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          now: () => new Date("2026-07-02T00:00:00.000Z"),
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow(
      "Source report /reports/source/smoke-report.json generatedAt " +
        "2026-07-03T00:00:00.000Z is not earlier than reanswer generatedAt " +
        "2026-07-02T00:00:00.000Z.",
    );
  });

  it("rejects source reports dated at the reanswer report timestamp", async () => {
    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIds: ["conv-test:q1"],
          runId: "reanswer-same-time-source",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          now: () => new Date("2026-07-03T00:00:00.000Z"),
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow(
      "Source report /reports/source/smoke-report.json generatedAt " +
        "2026-07-03T00:00:00.000Z is not earlier than reanswer generatedAt " +
        "2026-07-03T00:00:00.000Z.",
    );
  });

  it("rejects question-id files that resolve to the output report path", async () => {
    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIdFile: "/reports/out/reanswer-self-manifest/smoke-report.json",
          reanswerJobBuckets: ["answerRegressions"],
          runId: "reanswer-self-manifest",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow(
      "must not resolve to the output smoke report path",
    );
  });

  it("rejects question-id files that resolve to the source report path", async () => {
    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIdFile: "/reports/source/smoke-report.json",
          reanswerJobBuckets: ["answerRegressions"],
          runId: "reanswer-source-as-manifest",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow(
      "must not resolve to the source report path",
    );
  });

  it("rejects output reports that resolve to the source report path", async () => {
    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports",
          questionIds: ["conv-test:q1"],
          runId: "source",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            throw new Error(`should not read source report: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow(
      "output smoke report path /reports/source/smoke-report.json must not resolve to the source report path",
    );
  });

  it("rejects output reports whose run id matches the source report run id", async () => {
    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIds: ["conv-test:q1"],
          runId: "source-report",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          answerGenerator: async () => "No information available",
          mkdir: async () => undefined,
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            if (path === "/tmp/LOCOMO/cases.json") {
              return JSON.stringify({ cases: [testCase] });
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow(
      "LoCoMo reanswer runId source-report must not match source report runId.",
    );
  });

  it("rejects blank output run ids before writing replay evidence", async () => {
    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIds: ["conv-test:q1"],
          runId: " ",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow("LoCoMo reanswer runId must not be empty.");
  });

  it("rejects whitespace-padded output run ids before writing replay evidence", async () => {
    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIds: ["conv-test:q1"],
          runId: " reanswer-padded-run",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          answerGenerator: async () => "No information available",
          mkdir: async () => undefined,
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(sourceReport());
            }
            if (path === "/tmp/LOCOMO/cases.json") {
              return JSON.stringify({ cases: [testCase] });
            }
            throw new Error(`unexpected read: ${path}`);
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow(
      "LoCoMo reanswer runId must not have leading or trailing whitespace.",
    );
  });

  it("retries transient answer failures before counting an execution failure", async () => {
    let attempts = 0;
    const retryDelays: number[] = [];
    const report = await runLocomoReportReanswer(
      {
        allowCommonsenseResolution: false,
        outputDir: "/reports/out",
        questionIds: ["conv-test:q1"],
        runId: "reanswer-retry",
        sourceReportPath: "/reports/source/smoke-report.json",
        strictNoEvidenceAbstention: false,
      },
      {
        answerGenerator: async () => {
          attempts += 1;
          if (attempts === 1) {
            throw new Error("transient provider failure");
          }
          return "I do not know";
        },
        mkdir: async () => undefined,
        readFile: async (path) => {
          if (path === "/reports/source/smoke-report.json") {
            return JSON.stringify(sourceReport());
          }
          if (path === "/tmp/LOCOMO/cases.json") {
            return JSON.stringify({ cases: [testCase] });
          }
          throw new Error(`unexpected read: ${path}`);
        },
        sleep: async (ms) => {
          retryDelays.push(ms);
        },
        writeFile: async () => undefined,
      },
    );

    expect(attempts).toBe(2);
    expect(retryDelays).toEqual([1000]);
    expect(report.executionFailures).toBe(0);
    expect(report.questionCount).toBe(1);
    expect(report.cases[0]?.answerCorrect).toBe(true);
  });

  it("retains selected rows when all reanswer attempts fail", async () => {
    let attempts = 0;
    const report = await runLocomoReportReanswer(
      {
        allowCommonsenseResolution: false,
        outputDir: "/reports/out",
        questionIds: ["conv-test:q1"],
        runId: "reanswer-hard-failure",
        sourceReportPath: "/reports/source/smoke-report.json",
        strictNoEvidenceAbstention: false,
      },
      {
        answerGenerator: async () => {
          attempts += 1;
          throw new Error("provider unavailable");
        },
        mkdir: async () => undefined,
        readFile: async (path) => {
          if (path === "/reports/source/smoke-report.json") {
            return JSON.stringify(sourceReport());
          }
          if (path === "/tmp/LOCOMO/cases.json") {
            return JSON.stringify({ cases: [testCase] });
          }
          throw new Error(`unexpected read: ${path}`);
        },
        sleep: async () => undefined,
        writeFile: async () => undefined,
      },
    );

    expect(attempts).toBe(3);
    expect(report.executionFailures).toBe(1);
    expect(report.questionCount).toBe(1);
    expect(report.cases).toHaveLength(1);
    expect(report.cases[0]).toMatchObject({
      answerCorrect: null,
      generatedAnswer: null,
      questionId: "conv-test:q1",
      retrievedTurnIds: ["D1:1"],
    });
  });

  it("treats empty generated answers as failed reanswer attempts", async () => {
    let attempts = 0;
    const report = await runLocomoReportReanswer(
      {
        allowCommonsenseResolution: false,
        outputDir: "/reports/out",
        questionIds: ["conv-test:q1"],
        runId: "reanswer-empty-generated-answer",
        sourceReportPath: "/reports/source/smoke-report.json",
        strictNoEvidenceAbstention: false,
      },
      {
        answerGenerator: async () => {
          attempts += 1;
          return " ";
        },
        mkdir: async () => undefined,
        readFile: async (path) => {
          if (path === "/reports/source/smoke-report.json") {
            return JSON.stringify(sourceReport());
          }
          if (path === "/tmp/LOCOMO/cases.json") {
            return JSON.stringify({ cases: [testCase] });
          }
          throw new Error(`unexpected read: ${path}`);
        },
        sleep: async () => undefined,
        writeFile: async () => undefined,
      },
    );

    expect(attempts).toBe(3);
    expect(report.executionFailures).toBe(1);
    expect(report.cases[0]).toMatchObject({
      answerCorrect: null,
      generatedAnswer: null,
      questionId: "conv-test:q1",
    });
  });

  it("rejects source reports where one question id matches multiple cases", async () => {
    const baseReport = sourceReport();
    const duplicateQuestionReport: LocomoSmokeReport = {
      ...baseReport,
      caseCount: 2,
      caseIds: [testCase.caseId, "locomo-conv-other"],
      cases: [
        ...baseReport.cases,
        {
          ...baseReport.cases[0]!,
          caseId: "locomo-conv-other",
        },
      ],
      questionCount: 3,
    };

    await expect(
      runLocomoReportReanswer(
        {
          allowCommonsenseResolution: false,
          outputDir: "/reports/out",
          questionIds: ["conv-test:q1"],
          runId: "reanswer-ambiguous-question",
          sourceReportPath: "/reports/source/smoke-report.json",
          strictNoEvidenceAbstention: false,
        },
        {
          answerGenerator: async () => {
            throw new Error("should not reanswer ambiguous source rows");
          },
          mkdir: async () => undefined,
          readFile: async (path) => {
            if (path === "/reports/source/smoke-report.json") {
              return JSON.stringify(duplicateQuestionReport);
            }
            throw new Error("should not load benchmark root");
          },
          writeFile: async () => undefined,
        },
      ),
    ).rejects.toThrow(
      "LoCoMo source report question id conv-test:q1 matched multiple cases",
    );
  });

  it("preserves whole-report question identity when no question filter is provided", async () => {
    const report = await runLocomoReportReanswer(
      {
        allowCommonsenseResolution: false,
        outputDir: "/reports/out",
        runId: "reanswer-all",
        sourceReportPath: "/reports/source/smoke-report.json",
        strictNoEvidenceAbstention: false,
      },
      {
        answerGenerator: async ({ question }) =>
          question.category === "adversarial" ? "I do not know" : "Connecticut",
        mkdir: async () => undefined,
        readFile: async (path) => {
          if (path === "/reports/source/smoke-report.json") {
            return JSON.stringify(sourceReport());
          }
          if (path === "/tmp/LOCOMO/cases.json") {
            return JSON.stringify({ cases: [testCase] });
          }
          throw new Error(`unexpected read: ${path}`);
        },
        writeFile: async () => undefined,
      },
    );

    expect(report.questionCount).toBe(2);
    expect(report.questionIds).toBeNull();
  });

  it("records inherited source question ids as explicit replay lineage", async () => {
    const targetedSource: LocomoSmokeReport = {
      ...sourceReport(),
      questionIds: ["conv-test:q1", "conv-test:q2"],
    };

    const report = await runLocomoReportReanswer(
      {
        allowCommonsenseResolution: false,
        outputDir: "/reports/out",
        runId: "reanswer-targeted-source-all",
        sourceReportPath: "/reports/source/smoke-report.json",
        strictNoEvidenceAbstention: false,
      },
      {
        answerGenerator: async ({ question }) =>
          question.category === "adversarial" ? "I do not know" : "Connecticut",
        mkdir: async () => undefined,
        readFile: async (path) => {
          if (path === "/reports/source/smoke-report.json") {
            return JSON.stringify(targetedSource);
          }
          if (path === "/tmp/LOCOMO/cases.json") {
            return JSON.stringify({ cases: [testCase] });
          }
          throw new Error(`unexpected read: ${path}`);
        },
        writeFile: async () => undefined,
      },
    );

    expect(report.questionIds).toEqual(["conv-test:q1", "conv-test:q2"]);
    expect(report.reanswerSelection).toEqual({
      explicitQuestionIds: ["conv-test:q1", "conv-test:q2"],
      questionIdFile: null,
      reanswerJobBuckets: null,
      reanswerJobCategories: null,
    });
  });
});
