import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { GoodMemory, GoodMemoryConfig } from "../../src/api/contracts";
import { inspectGoodMemoryRuntime } from "../../src/api/runtimeInfo";
import type {
  LongMemEvalRecallDiagnosticProfile,
  LongMemEvalRecallDiagnosticReport,
  LongMemEvalReport,
} from "../../src/eval/longmemeval";
import type { EvalPostgresRunLease } from "../../src/eval/postgresRetention";
import {
  buildLongMemEvalPrompt,
  createHermeticLongMemEvalMemory,
  createLongMemEvalMemoryFactory,
  PHASE62_CANONICAL_RUN_ID,
  resolvePhase62LiveRequestTimeoutMs,
  resolvePhase62StageTimeoutMs,
  runPhase62LongMemEval,
} from "../../scripts/run-phase-62-eval";
import {
  buildPhase62RecallDiagnosticOptions,
  PHASE62_RECALL_DIAGNOSTIC_RUN_ID,
  PHASE62_TYPE_BALANCED_CASE_IDS,
  runPhase62LongMemEvalRecallDiagnostic,
} from "../../scripts/run-phase-62-recall-diagnostic";
import {
  checkPhase62Readiness,
  parsePhase62CliOptions,
  resolvePhase62BenchmarkRoot,
  resolvePhase62OutputDir,
} from "../../scripts/run-phase-62-shared";

const TYPE_BALANCED_MANIFEST_PATH = join(
  import.meta.dir,
  "../../task-board/phase-62-longmemeval-sequential-hardening/02-type-balanced-sampling.txt",
);
const TYPE_BALANCED_CASE_IDS = [
  "e47becba",
  "118b2229",
  "51a45a95",
  "0a995998",
  "6d550036",
  "gpt4_59c863d7",
  "8a2466db",
  "06878be2",
  "75832dbd",
  "gpt4_59149c77",
  "gpt4_f49edff3",
  "71017276",
  "6a1eabeb",
  "6aeb4375",
  "830ce83f",
  "7161e7e2",
  "c4f10528",
  "89527b6b",
] as const;

function buildReport(input: {
  benchmarkRoot: string;
  generatedBy: string;
  mode: "smoke" | "full";
  outputDir: string;
  runId?: string;
}): LongMemEvalReport {
  const runId = input.runId ?? PHASE62_CANONICAL_RUN_ID;
  return {
    benchmarkRoot: input.benchmarkRoot,
    generatedAt: "2026-05-05T00:00:00.000Z",
    generatedBy: input.generatedBy,
    mode: input.mode,
    outputDir: input.outputDir,
    phase: "phase-62",
    profiles: {},
    runDirectory: `${input.outputDir}/${runId}`,
    runId,
    source: {
      benchmark: "LongMemEval",
      license: "MIT code; dataset external",
      url: "https://github.com/xiaowu0162/LongMemEval",
    },
    summary: {
      abstentionCases: 0,
      caseCountsByQuestionType: {},
      executionFailures: 0,
      profilesCompared: [],
      totalCases: 0,
    },
  };
}

function buildRecallDiagnosticReport(input: {
  benchmarkRoot: string;
  generatedBy: string;
  mode: "smoke" | "full";
  outputDir: string;
  profile: LongMemEvalRecallDiagnosticProfile;
  runId?: string;
}): LongMemEvalRecallDiagnosticReport {
  const runId = input.runId ?? PHASE62_RECALL_DIAGNOSTIC_RUN_ID;
  return {
    benchmarkRoot: input.benchmarkRoot,
    cases: [],
    caveat: "Recall-only diagnostic.",
    generatedAt: "2026-05-05T00:00:00.000Z",
    generatedBy: input.generatedBy,
    mode: "recall-only-diagnostic",
    outputDir: input.outputDir,
    phase: "phase-62",
    profile: input.profile,
    runDirectory: `${input.outputDir}/${runId}`,
    runId,
    source: {
      benchmark: "LongMemEval",
      license: "MIT code; dataset external",
      url: "https://github.com/xiaowu0162/LongMemEval",
    },
    summary: {
      byQuestionType: {},
      evidenceCaseCount: 0,
      evidenceSessionRecall: null,
      executionFailures: 0,
      missedRecallCases: 0,
      totalCases: 0,
      wrongRecallCases: 0,
    },
  };
}

describe("run-phase-62 LongMemEval script", () => {
  it("resolves default smoke fixture and output roots", () => {
    expect(resolvePhase62BenchmarkRoot("/tmp/goodmemory", true)).toBe(
      "/tmp/goodmemory/fixtures/external-benchmarks/longmemeval",
    );
    expect(resolvePhase62OutputDir("/tmp/goodmemory")).toBe(
      "/tmp/goodmemory/reports/eval/research/phase-62/longmemeval",
    );
  });

  it("parses phase-62 cli flags", () => {
    expect(
      parsePhase62CliOptions([
        "bun",
        "run",
        "scripts/run-phase-62-eval.ts",
        "--benchmark-root",
        "/tmp/longmemeval",
        "--mode",
        "full",
        "--case-id",
        "q-multi-1",
        "--case-id",
        "q-temporal-1",
        "--profile",
        "goodmemory-hybrid",
        "--limit",
        "10",
        "--max-concurrency",
        "2",
        "--offset",
        "70",
        "--output-dir",
        "/tmp/out",
        "--question-type",
        "multi-session",
        "--question-type",
        "temporal-reasoning",
        "--all-cases",
        "--label-free-ingest",
        "--resume",
        "--run-id",
        "run-longmemeval",
      ]),
    ).toEqual({
      allCases: true,
      benchmarkRoot: "/tmp/longmemeval",
      caseIds: ["q-multi-1", "q-temporal-1"],
      labelFreeIngest: true,
      limit: 10,
      maxConcurrency: 2,
      mode: "full",
      offset: 70,
      outputDir: "/tmp/out",
      profiles: ["goodmemory-hybrid"],
      questionTypes: ["multi-session", "temporal-reasoning"],
      resume: true,
      runId: "run-longmemeval",
    });
  });

  it("rejects empty or whitespace-padded LongMemEval root environment values", () => {
    const original = process.env.GOODMEMORY_LONGMEMEVAL_ROOT;
    try {
      process.env.GOODMEMORY_LONGMEMEVAL_ROOT = "/tmp/LongMemEval-env";
      expect(
        parsePhase62CliOptions([
          "bun",
          "run",
          "scripts/run-phase-62-eval.ts",
        ]).benchmarkRoot,
      ).toBe("/tmp/LongMemEval-env");
      expect(
        parsePhase62CliOptions([
          "bun",
          "run",
          "scripts/run-phase-62-eval.ts",
          "--benchmark-root",
          "/tmp/LongMemEval-cli",
        ]).benchmarkRoot,
      ).toBe("/tmp/LongMemEval-cli");
      expect(resolvePhase62BenchmarkRoot("/tmp/goodmemory", false)).toBe(
        "/tmp/LongMemEval-env",
      );
      expect(
        checkPhase62Readiness(
          { mode: "smoke" },
          { fileExists: () => true },
        ).benchmarkRoot,
      ).toBe("/tmp/LongMemEval-env");

      process.env.GOODMEMORY_LONGMEMEVAL_ROOT = " /tmp/LongMemEval-env ";
      expect(() =>
        parsePhase62CliOptions([
          "bun",
          "run",
          "scripts/run-phase-62-eval.ts",
        ]),
      ).toThrow(
        "GOODMEMORY_LONGMEMEVAL_ROOT cannot be empty or whitespace-padded.",
      );
      expect(() => resolvePhase62BenchmarkRoot("/tmp/goodmemory", false)).toThrow(
        "GOODMEMORY_LONGMEMEVAL_ROOT cannot be empty or whitespace-padded.",
      );
      expect(() =>
        checkPhase62Readiness(
          { mode: "smoke" },
          { fileExists: () => true },
        ),
      ).toThrow(
        "GOODMEMORY_LONGMEMEVAL_ROOT cannot be empty or whitespace-padded.",
      );

      process.env.GOODMEMORY_LONGMEMEVAL_ROOT = "";
      expect(() =>
        parsePhase62CliOptions([
          "bun",
          "run",
          "scripts/run-phase-62-eval.ts",
        ]),
      ).toThrow(
        "GOODMEMORY_LONGMEMEVAL_ROOT cannot be empty or whitespace-padded.",
      );
    } finally {
      if (original === undefined) {
        delete process.env.GOODMEMORY_LONGMEMEVAL_ROOT;
      } else {
        process.env.GOODMEMORY_LONGMEMEVAL_ROOT = original;
      }
    }
  });

  it("rejects duplicate all-cases mode flags before running phase-62 eval", () => {
    expect(() =>
      parsePhase62CliOptions([
        "bun",
        "run",
        "scripts/run-phase-62-eval.ts",
        "--all-cases",
        "--all-cases",
      ]),
    ).toThrow("--all-cases cannot be specified more than once.");
  });

  it("rejects duplicate scalar phase-62 eval flags before running", () => {
    for (const flag of [
      "--benchmark-root",
      "--limit",
      "--max-concurrency",
      "--mode",
      "--offset",
      "--output-dir",
      "--run-id",
    ]) {
      expect(() =>
        parsePhase62CliOptions([
          "bun",
          "run",
          "scripts/run-phase-62-eval.ts",
          flag,
          "first",
          flag,
          "second",
        ]),
      ).toThrow(`${flag} cannot be specified more than once.`);
    }
  });

  it("rejects output run ids that escape the phase-62 eval directory", async () => {
    expect(() =>
      parsePhase62CliOptions([
        "bun",
        "run",
        "scripts/run-phase-62-eval.ts",
        "--run-id",
        "../outside-longmemeval",
      ]),
    ).toThrow("--run-id must be a single path segment.");

    await expect(
      runPhase62LongMemEval(
        {
          runId: "../outside-longmemeval",
        },
        {
          runSuite: async (input) => buildReport(input),
        },
      ),
    ).rejects.toThrow("--run-id must be a single path segment.");

    await expect(
      runPhase62LongMemEvalRecallDiagnostic(
        {
          runId: "../outside-longmemeval",
        },
        {
          runDiagnostic: async (input) => buildRecallDiagnosticReport(input),
        },
      ),
    ).rejects.toThrow("--run-id must be a single path segment.");
  });

  it("keeps the type-balanced manifest aligned with the four-profile run contract", async () => {
    const manifest = await readFile(TYPE_BALANCED_MANIFEST_PATH, "utf8");
    const command = manifest.match(/bun run eval:phase-62[^\n]+/u)?.[0];
    const profileFlags =
      command === undefined
        ? []
        : Array.from(command.matchAll(/--profile\s+\S+/gu), ([match]) => match);
    const caseIdFlags =
      command === undefined
        ? []
        : Array.from(command.matchAll(/--case-id\s+\S+/gu), ([match]) => match);

    expect(command).toBeDefined();
    expect(profileFlags).toEqual([
      "--profile baseline-no-memory",
      "--profile baseline-full-context",
      "--profile goodmemory-rules-only",
      "--profile goodmemory-hybrid",
    ]);
    expect(caseIdFlags).toEqual(
      TYPE_BALANCED_CASE_IDS.map((caseId) => `--case-id ${caseId}`),
    );
  });

  it("builds recall diagnostics over the fixed type-balanced manifest by default", () => {
    const options = buildPhase62RecallDiagnosticOptions(
      "/tmp/goodmemory",
      {
        benchmarkRoot: "/tmp/LongMemEval",
        mode: "smoke",
      },
    );

    expect(options).toEqual({
      benchmarkRoot: "/tmp/LongMemEval",
      caseIds: PHASE62_TYPE_BALANCED_CASE_IDS,
      generatedBy: "scripts/run-phase-62-recall-diagnostic.ts",
      ingestMode: "historical-annotated",
      limit: undefined,
      maxConcurrency: 1,
      mode: "full",
      offset: undefined,
      outputDir: "/tmp/goodmemory/reports/eval/research/phase-62/longmemeval",
      profile: "goodmemory-rules-only",
      questionTypes: undefined,
      resume: undefined,
      runConfiguration: {
        contextMaxTokens: 4000,
        extractionStrategy: "rules-only",
        generalizedFusion: null,
        projection: {
          bulkBackfill: true,
          writeThrough: false,
        },
        providerEmbedding: false,
        recallStrategy: "rules-only",
      },
      runId: PHASE62_RECALL_DIAGNOSTIC_RUN_ID,
    });
  });

  it("builds recall diagnostics over every full-data case when requested", () => {
    const options = buildPhase62RecallDiagnosticOptions(
      "/tmp/goodmemory",
      {
        allCases: true,
        benchmarkRoot: "/tmp/LongMemEval",
        limit: 500,
        mode: "full",
      },
    );

    expect(options.caseIds).toBeUndefined();
    expect(options.limit).toBe(500);
  });

  it("accepts the provider-free recommended recall diagnostic profile", () => {
    const options = buildPhase62RecallDiagnosticOptions(
      "/tmp/goodmemory",
      {
        benchmarkRoot: "/tmp/LongMemEval",
        mode: "full",
        labelFreeIngest: true,
        profiles: ["goodmemory-recommended"],
        questionTypes: ["temporal-reasoning", "knowledge-update"],
      },
    );

    expect(options.profile).toBe("goodmemory-recommended");
    expect(options.ingestMode).toBe("label-free-raw");
    expect(options.questionTypes).toEqual([
      "temporal-reasoning",
      "knowledge-update",
    ]);
  });

  it("wires the recall diagnostic fusion floor honestly", () => {
    // Without the flag the recommended profile records the floor it actually
    // runs (0 — the preset default), not an aspirational constant.
    const unset = buildPhase62RecallDiagnosticOptions("/tmp/goodmemory", {
      benchmarkRoot: "/tmp/LongMemEval",
      mode: "full",
      profiles: ["goodmemory-recommended"],
    });
    expect(unset.runConfiguration?.generalizedFusion?.minRelativeStrength).toBe(
      0,
    );

    const swept = buildPhase62RecallDiagnosticOptions("/tmp/goodmemory", {
      benchmarkRoot: "/tmp/LongMemEval",
      fusionMinRelativeStrength: 0.35,
      mode: "full",
      profiles: ["goodmemory-recommended"],
    });
    expect(swept.runConfiguration?.generalizedFusion?.minRelativeStrength).toBe(
      0.35,
    );

    expect(() =>
      buildPhase62RecallDiagnosticOptions("/tmp/goodmemory", {
        benchmarkRoot: "/tmp/LongMemEval",
        fusionMinRelativeStrength: 0.35,
        mode: "full",
        profiles: ["goodmemory-rules-only"],
      }),
    ).toThrow(
      "--fusion-min-relative-strength requires a generalized-fusion profile",
    );
  });

  it("parses and validates the fusion floor flag", () => {
    expect(
      parsePhase62CliOptions([
        "bun",
        "script",
        "--fusion-min-relative-strength",
        "0.35",
      ]).fusionMinRelativeStrength,
    ).toBe(0.35);
    expect(
      parsePhase62CliOptions(["bun", "script"]).fusionMinRelativeStrength,
    ).toBeUndefined();
    for (const bad of ["1.5", "-0.1", "abc", " 0.35"]) {
      expect(() =>
        parsePhase62CliOptions([
          "bun",
          "script",
          "--fusion-min-relative-strength",
          bad,
        ]),
      ).toThrow();
    }
  });

  it("rejects recall diagnostics that combine all-cases with explicit case ids", () => {
    expect(() =>
      buildPhase62RecallDiagnosticOptions(
        "/tmp/goodmemory",
        {
          allCases: true,
          benchmarkRoot: "/tmp/LongMemEval",
          caseIds: ["q-1"],
          mode: "full",
        },
      ),
    ).toThrow("--all-cases cannot be combined with --case-id");
  });

  it("includes question date in the LongMemEval answer prompt", () => {
    expect(
      buildLongMemEvalPrompt({
        memoryContext: "On 2023/03/04, I received a crystal chandelier.",
        prompt: "How many weeks ago did I receive the crystal chandelier?",
        questionDate: "2023/04/01 (Sat) 08:09",
        transcript: "",
      }),
    ).toContain("Question date:\n2023/04/01 (Sat) 08:09");
  });

  it("instructs count answers to count only matching evidence", () => {
    const prompt = buildLongMemEvalPrompt({
      memoryContext:
        "I led the data analysis team.\nI am working on a research project.",
      prompt: "How many projects have I led or am currently leading?",
      transcript: "",
    });

    expect(prompt).toContain(
      "For count questions, count distinct matching evidence items only.",
    );
  });

  it("instructs numeric answers to compare and sum visible evidence", () => {
    const prompt = buildLongMemEvalPrompt({
      memoryContext:
        "HelloFresh gave me a 40% discount.\nUberEats gave me a 20% discount.\nThe first novel had 416 pages and the second had 440 pages.",
      prompt:
        "Did I receive a higher percentage discount from HelloFresh, and what was the total page count?",
      transcript: "",
    });

    expect(prompt).toContain(
      "For numeric comparison questions, compare visible numbers, percentages, amounts, dates, or durations directly",
    );
    expect(prompt).toContain(
      "For total, sum, or page-count questions, add the visible matching numeric values",
    );
    expect(prompt).toContain(
      "Deduplicate repeated descriptions of the same transaction or event",
    );
  });

  it("instructs list answers to preserve grouped evidence items", () => {
    expect(
      buildLongMemEvalPrompt({
        memoryContext:
          "Lake Charles Refinery includes: Atmospheric distillation; Fluid catalytic cracking (FCC); Alkylation; Hydrotreating.",
        prompt: "What processes are used at the Lake Charles Refinery?",
        transcript: "",
      }),
    ).toContain(
      "For list or set questions, include every distinct item in the relevant grouped evidence",
    );
  });

  it("instructs temporal interval answers to compute from dated evidence", () => {
    expect(
      buildLongMemEvalPrompt({
        memoryContext:
          "On 2022/12/28, I finished a discussion on The Seven Husbands of Evelyn Hugo.\nOn 2023/01/15, I attended a book reading event.",
        prompt: "How many days had passed between the two events?",
        questionDate: "2023/01/15 (Sun) 08:32",
        transcript: "",
      }),
    ).toContain(
      "For temporal interval questions, compute elapsed days from the dated evidence",
    );
  });

  it("instructs temporal order answers to sort and deduplicate entities", () => {
    expect(
      buildLongMemEvalPrompt({
        memoryContext:
          "On 2023/02/14, I flew with American Airlines.\nOn 2022/11/17, I flew with JetBlue.",
        prompt:
          "What is the order of airlines I flew with from earliest to latest before today?",
        transcript: "",
      }),
    ).toContain(
      "For temporal order questions, sort matching dated evidence chronologically",
    );
  });

  it("instructs from-whom answers to use selected evidence sources", () => {
    const prompt = buildLongMemEvalPrompt({
      memoryContext:
        "## Selected Session Evidence\n- On 2023/03/04, I got a crystal chandelier from my aunt.",
      prompt: "I received a piece of jewelry last Saturday from whom?",
      transcript: "",
    });

    expect(prompt).toContain(
      "Treat Selected Session Evidence as answer-bearing evidence",
    );
    expect(prompt).toContain(
      "For who/from-whom questions, return the visible person or source",
    );
  });

  it("instructs descriptive entity answers when no proper noun is visible", () => {
    expect(
      buildLongMemEvalPrompt({
        memoryContext:
          "On 2023/03/31, I recently discovered a bluegrass band that features a banjo player and started enjoying their music today.",
        prompt: "What is the artist that I started to listen to last Friday?",
        transcript: "",
      }),
    ).toContain(
      "For artist, item, or entity questions, if the evidence gives a descriptive entity rather than a proper name, return that description",
    );
  });

  it("instructs answer generation to use selected evidence synthesis", () => {
    expect(
      buildLongMemEvalPrompt({
        memoryContext:
          "## Selected Evidence Synthesis\n- Page counts found in recalled user evidence: 416 and 440; total page count is 856.",
        prompt: "What was the page count of the two novels I finished?",
        transcript: "",
      }),
    ).toContain(
      "Treat Selected Evidence Synthesis as computed answer-bearing evidence",
    );
  });

  it("instructs recommendation answers to retain the requested object category", () => {
    expect(
      buildLongMemEvalPrompt({
        memoryContext:
          "My current photography setup includes Sony A7R IV and Sony 24-70mm f/2.8 lens.",
        prompt:
          "Can you suggest some accessories that would complement my current photography setup?",
        transcript: "",
      }),
    ).toContain(
      "include that category in the answer, such as resources, accessories, publications, conferences, or gear.",
    );
  });

  it("instructs advice answers to convert remembered facts into constraints", () => {
    expect(
      buildLongMemEvalPrompt({
        memoryContext:
          "I recently figured out how to use the slow cooker and made a delicious beef stew.",
        prompt:
          "I've been struggling with my slow cooker recipes. Any advice on getting better results?",
        transcript: "",
      }),
    ).toContain(
      "turn remembered facts into an actionable preference/constraint",
    );
  });

  it("instructs advice answers to preserve multiple remembered interests", () => {
    expect(
      buildLongMemEvalPrompt({
        memoryContext:
          "I made a delicious beef stew.\nI was interested in recipes for making yogurt in a slow cooker.",
        prompt:
          "I've been struggling with my slow cooker recipes. Any advice on getting better results?",
        transcript: "",
      }),
    ).toContain(
      "preserve each distinct one in the short answer",
    );
  });

  it("instructs suggestion answers to include concrete assistant follow-up topics", () => {
    expect(
      buildLongMemEvalPrompt({
        memoryContext:
          'Assistant follow-up recommendation topics for "I want to socialize more with colleagues but want to keep working from home": Virtual Coffee Breaks; Online Team Activities; Interest-Based Groups.',
        prompt:
          "I still want to socialize with colleagues but keep working from home. Any suggestions?",
        transcript: "",
      }),
    ).toContain(
      "include those concrete topics in the short answer instead of only summarizing the user constraint",
    );
  });

  it("instructs advice answers to preserve multiple concrete issue areas", () => {
    expect(
      buildLongMemEvalPrompt({
        memoryContext:
          "I bought a new utensil holder to keep counters organized.\nThe kitchen sink area gets messy because the faucet leaks and the granite needs careful cleaning.",
        prompt: "My kitchen's becoming a bit of a mess again. Any tips?",
        transcript: "",
      }),
    ).toContain(
      "name each issue area briefly instead of expanding only one and dropping the others",
    );
  });

  it("resolves Phase 62 live request timeout from env", () => {
    expect(
      resolvePhase62LiveRequestTimeoutMs({
        GOODMEMORY_PHASE62_LIVE_REQUEST_TIMEOUT_MS: "1234",
      }),
    ).toBe(1234);
    expect(() =>
      resolvePhase62LiveRequestTimeoutMs({
        GOODMEMORY_PHASE62_LIVE_REQUEST_TIMEOUT_MS: "0",
      }),
    ).toThrow("GOODMEMORY_PHASE62_LIVE_REQUEST_TIMEOUT_MS");
    expect(resolvePhase62StageTimeoutMs(8000, {})).toBe(48000);
    expect(
      resolvePhase62StageTimeoutMs(8000, {
        GOODMEMORY_PHASE62_STAGE_TIMEOUT_MS: "12345",
      }),
    ).toBe(12345);
  });

  it("runs through the LongMemEval suite with canonical defaults", async () => {
    let received:
      | {
          benchmarkRoot: string;
          generatedBy: string;
          mode: "smoke" | "full";
          outputDir: string;
          runId?: string;
        }
      | undefined;

    const report = await runPhase62LongMemEval(
      {},
      {
        runSuite: async (input) => {
          received = input;
          return buildReport(input);
        },
      },
    );

    expect(received?.benchmarkRoot).toContain(
      "/fixtures/external-benchmarks/longmemeval",
    );
    expect(received?.generatedBy).toBe("scripts/run-phase-62-eval.ts");
    expect(received?.mode).toBe("smoke");
    expect(report.runId).toBe(PHASE62_CANONICAL_RUN_ID);
  });

  it("passes full mode through injected dependencies without resolving live env", async () => {
    let receivedMode: "smoke" | "full" | undefined;

    const report = await runPhase62LongMemEval(
      {
        mode: "full",
        profiles: ["baseline-no-memory"],
        runId: "run-full",
      },
      {
        runSuite: async (input) => {
          receivedMode = input.mode;
          return buildReport(input);
        },
      },
    );

    expect(receivedMode).toBe("full");
    expect(report.runId).toBe("run-full");
  });

  it("runs recall-only diagnostic through injected dependencies without live answer env", async () => {
    let received:
      | {
          generatedBy: string;
          mode: "smoke" | "full";
          profile: LongMemEvalRecallDiagnosticProfile;
          runId?: string;
        }
      | undefined;

    const report = await runPhase62LongMemEvalRecallDiagnostic(
      {
        mode: "full",
      },
      {
        runDiagnostic: async (input) => {
          received = input;
          return buildRecallDiagnosticReport(input);
        },
      },
    );

    expect(received?.generatedBy).toBe(
      "scripts/run-phase-62-recall-diagnostic.ts",
    );
    expect(received?.mode).toBe("full");
    expect(received?.profile).toBe("goodmemory-rules-only");
    expect(report.runId).toBe(PHASE62_RECALL_DIAGNOSTIC_RUN_ID);
  });

  it("rejects recall-only diagnostic profiles that do not build GoodMemory context", async () => {
    await expect(
      runPhase62LongMemEvalRecallDiagnostic(
        {
          profiles: ["baseline-full-context"],
        },
        {
          runDiagnostic: async (input) => buildRecallDiagnosticReport(input),
        },
      ),
    ).rejects.toThrow("goodmemory-rules-only, goodmemory-recommended, or goodmemory-hybrid");
  });

  it("reports missing full-mode data and provider requirements before live execution", () => {
    const report = checkPhase62Readiness(
      {
        benchmarkRoot: "/tmp/missing-longmemeval",
        mode: "full",
        profiles: ["goodmemory-hybrid"],
      },
      {
        env: {},
        fileExists: () => false,
      },
    );

    expect(report.ready).toBe(false);
    expect(report.mode).toBe("full");
    expect(report.checks.map((check) => check.key)).toContain(
      "longmemeval-data-file",
    );
    expect(report.missing).toContain("GOODMEMORY_EVAL_PROVIDER");
    expect(report.missing).toContain("GOODMEMORY_JUDGE_PROVIDER");
    expect(report.missing).toContain("GOODMEMORY_TEST_POSTGRES_URL");
    expect(report.missing).toContain("GOODMEMORY_EMBEDDING_PROVIDER");
    expect(report.missing).toContain("GOODMEMORY_ASSISTED_EXTRACTOR_API_KEY");
  });

  it("accepts a ready full-mode rules-only run without hybrid provider checks", () => {
    const report = checkPhase62Readiness(
      {
        benchmarkRoot: "/tmp/longmemeval",
        mode: "full",
        profiles: ["goodmemory-rules-only"],
      },
      {
        env: {
          GOODMEMORY_EVAL_API_KEY: "eval-key",
          GOODMEMORY_EVAL_MODEL: "gpt-5.4",
          GOODMEMORY_EVAL_PROVIDER: "openai",
          GOODMEMORY_JUDGE_API_KEY: "judge-key",
          GOODMEMORY_JUDGE_MODEL: "gpt-5.4",
          GOODMEMORY_JUDGE_PROVIDER: "openai",
        },
        fileExists: (path) => path.endsWith("longmemeval_s_cleaned.json"),
      },
    );

    expect(report.ready).toBe(true);
    expect(report.missing).toEqual([]);
    expect(report.profiles).toEqual(["goodmemory-rules-only"]);
  });

  it("keeps rules-only full mode isolated from provider-backed env adapters", async () => {
    let receivedConfig: GoodMemoryConfig | undefined;
    const factory = createLongMemEvalMemoryFactory((config) => {
      receivedConfig = config;
      return {} as GoodMemory;
    });

    factory("goodmemory-rules-only");

    expect(receivedConfig?.storage?.provider).toBe("memory");
    expect(receivedConfig?.adapters?.embeddingAdapter).toBeDefined();
    expect(receivedConfig?.adapters?.assistedExtractor).toBeDefined();
    await expect(
      receivedConfig?.adapters?.embeddingAdapter?.embed(["hello"]),
    ).resolves.toEqual([[0]]);
    await expect(
      receivedConfig?.adapters?.assistedExtractor?.extract({
        messages: [{ content: "hello", role: "user" }],
        scope: { userId: "u-1" },
      }),
    ).resolves.toEqual({
      candidates: [],
      ignoredMessageCount: 1,
    });
  });

  it("builds recommended diagnostics without provider adapters", () => {
    let receivedConfig: GoodMemoryConfig | undefined;
    const factory = createLongMemEvalMemoryFactory((config) => {
      receivedConfig = config;
      return {} as GoodMemory;
    });

    factory("goodmemory-recommended");

    expect(receivedConfig?.retrieval).toEqual({ preset: "recommended" });
    expect(receivedConfig?.storage?.provider).toBe("memory");
    expect(receivedConfig?.adapters?.embeddingAdapter).toBeUndefined();
    expect(receivedConfig?.adapters?.assistedExtractor).toBeDefined();
  });

  it("uses a stable per-memory id and clock sequence for benchmark tie-breaking", () => {
    const configs: GoodMemoryConfig[] = [];
    const createMemory = (config: GoodMemoryConfig) => {
      configs.push(config);
      return {} as GoodMemory;
    };
    createLongMemEvalMemoryFactory(createMemory, {
      runNamespace: "stable-run",
    })("goodmemory-recommended");
    createLongMemEvalMemoryFactory(createMemory, {
      runNamespace: "stable-run",
    })("goodmemory-recommended");

    const first = configs[0]!.testing!;
    const second = configs[1]!.testing!;
    expect([first.createId!(), first.createId!()]).toEqual([
      second.createId!(),
      second.createId!(),
    ]);
    expect([first.now!(), first.now!()]).toEqual([
      second.now!(),
      second.now!(),
    ]);
  });

  it("routes provider-backed LongMemEval storage into the leased eval schema", () => {
    const envNames = [
      "GOODMEMORY_ASSISTED_EXTRACTOR_API_KEY",
      "GOODMEMORY_ASSISTED_EXTRACTOR_MODEL",
      "GOODMEMORY_ASSISTED_EXTRACTOR_PROVIDER",
      "GOODMEMORY_EMBEDDING_API_KEY",
      "GOODMEMORY_EMBEDDING_MODEL",
      "GOODMEMORY_EMBEDDING_PROVIDER",
      "GOODMEMORY_TEST_POSTGRES_URL",
    ] as const;
    const snapshot = Object.fromEntries(
      envNames.map((name) => [name, process.env[name]]),
    );
    process.env.GOODMEMORY_ASSISTED_EXTRACTOR_API_KEY = "extract-key";
    process.env.GOODMEMORY_ASSISTED_EXTRACTOR_MODEL = "extract-model";
    process.env.GOODMEMORY_ASSISTED_EXTRACTOR_PROVIDER = "openai";
    process.env.GOODMEMORY_EMBEDDING_API_KEY = "embed-key";
    process.env.GOODMEMORY_EMBEDDING_MODEL = "embed-model";
    process.env.GOODMEMORY_EMBEDDING_PROVIDER = "openai";
    process.env.GOODMEMORY_TEST_POSTGRES_URL = "postgres://unused/eval";
    let receivedConfig: GoodMemoryConfig | undefined;

    try {
      createLongMemEvalMemoryFactory((config) => {
        receivedConfig = config;
        return {} as GoodMemory;
      }, {
        postgresSchema: "gm_eval_longmemeval_deadbeef",
        runNamespace: "schema-run",
      })("goodmemory-hybrid");

      expect(receivedConfig?.storage).toEqual({
        provider: "postgres",
        url: "postgres://unused/eval",
      });
      expect(receivedConfig?.adapters?.documentStore).toBeDefined();
      expect(receivedConfig?.adapters?.sessionStore).toBeDefined();
      expect(receivedConfig?.adapters?.vectorStore).toBeDefined();
    } finally {
      for (const name of envNames) {
        const value = snapshot[name];
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
    }
  });

  it("drops leased Postgres storage after a successful hybrid run", async () => {
    const events: string[] = [];
    const lease: EvalPostgresRunLease = {
      schema: "gm_eval_longmemeval_deadbeef",
      async drop() {
        events.push("drop");
      },
      async retain(status) {
        events.push(`retain:${status}`);
      },
    };
    const originalUrl = process.env.GOODMEMORY_TEST_POSTGRES_URL;
    process.env.GOODMEMORY_TEST_POSTGRES_URL = "postgres://unused/eval";

    try {
      await runPhase62LongMemEval(
        {
          benchmarkRoot: "/tmp/longmemeval",
          mode: "full",
          outputDir: "/tmp/out",
          profiles: ["goodmemory-hybrid"],
          runId: "managed-run",
        },
        {
          beginPostgresRun: async (input) => {
            events.push(`begin:${input.runId}`);
            return lease;
          },
          runSuite: async (input) => {
            events.push(`run:${input.runId}`);
            return buildReport(input);
          },
          verifyReport: async (report) => {
            events.push(`verify:${report.runId}`);
          },
        },
      );
    } finally {
      if (originalUrl === undefined) {
        delete process.env.GOODMEMORY_TEST_POSTGRES_URL;
      } else {
        process.env.GOODMEMORY_TEST_POSTGRES_URL = originalUrl;
      }
    }

    expect(events).toEqual([
      "begin:managed-run",
      "run:managed-run",
      "verify:managed-run",
      "drop",
    ]);
  });

  it("applies the same leased storage lifecycle to hybrid recall diagnostics", async () => {
    const events: string[] = [];
    const lease: EvalPostgresRunLease = {
      schema: "gm_eval_longmemeval_recall",
      async drop() {
        events.push("drop");
      },
      async retain(status) {
        events.push(`retain:${status}`);
      },
    };
    const originalUrl = process.env.GOODMEMORY_TEST_POSTGRES_URL;
    process.env.GOODMEMORY_TEST_POSTGRES_URL = "postgres://unused/eval";

    try {
      await runPhase62LongMemEvalRecallDiagnostic(
        {
          mode: "full",
          profiles: ["goodmemory-hybrid"],
          runId: "managed-recall",
        },
        {
          beginPostgresRun: async (input) => {
            events.push(`begin:${input.runId}`);
            return lease;
          },
          runDiagnostic: async (input) => {
            events.push(`run:${input.runId}`);
            return buildRecallDiagnosticReport(input);
          },
          verifyReport: async (report) => {
            events.push(`verify:${report.runId}`);
          },
        },
      );
    } finally {
      if (originalUrl === undefined) {
        delete process.env.GOODMEMORY_TEST_POSTGRES_URL;
      } else {
        process.env.GOODMEMORY_TEST_POSTGRES_URL = originalUrl;
      }
    }

    expect(events).toEqual([
      "begin:managed-recall",
      "run:managed-recall",
      "verify:managed-recall",
      "drop",
    ]);
  });

  it("keeps recommended diagnostics isolated from ambient provider env", () => {
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
      const factory = createLongMemEvalMemoryFactory(
        createHermeticLongMemEvalMemory,
      );
      const memory = factory("goodmemory-recommended");
      expect(inspectGoodMemoryRuntime(memory)?.embeddingEnabled).toBe(false);
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
});

// R6 second-family instrument: --retrieval-cues records in runConfiguration
// (record == wire) and only the recall-diagnostic path consumes it.
it("records the retrieval-cues arm in the recall run configuration", () => {
  const options = buildPhase62RecallDiagnosticOptions(
    "/tmp/goodmemory",
    {
      benchmarkRoot: "/tmp/LongMemEval",
      mode: "smoke",
      retrievalCues: true,
    },
  );
  expect(options.runConfiguration?.retrievalCues).toBe(true);

  const off = buildPhase62RecallDiagnosticOptions(
    "/tmp/goodmemory",
    {
      benchmarkRoot: "/tmp/LongMemEval",
      mode: "smoke",
    },
  );
  expect(off.runConfiguration?.retrievalCues).toBeUndefined();
});

it("parses --retrieval-cues", () => {
  expect(
    parsePhase62CliOptions([
      "bun",
      "run",
      "scripts/run-phase-62-recall-diagnostic.ts",
      "--retrieval-cues",
    ]).retrievalCues,
  ).toBe(true);
});
