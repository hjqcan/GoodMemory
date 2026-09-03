import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  createLongMemEvalGoodMemoryContextBuilder,
  normalizeLongMemEvalProfileList,
  runLongMemEvalSuite,
} from "../src/eval/longmemeval";
import type {
  LongMemEvalAnswerGenerator,
  LongMemEvalAnswerJudge,
  LongMemEvalAnswerJudgeInput,
  LongMemEvalRecallRunConfiguration,
  LongMemEvalReport,
  LongMemEvalSupplementalEvidenceAugmenter,
  RunLongMemEvalOptions,
} from "../src/eval/longmemeval";
import {
  createGoodMemory,
  createInternalGoodMemory,
} from "../src/api/createGoodMemory";
import type { GoodMemory, GoodMemoryConfig } from "../src/api/contracts";
import type { PersonaSpec, ScenarioFixture } from "../src/eval/dataset";
import {
  beginEvalPostgresRun,
  withEvalPostgresRunRetention,
} from "../src/eval/postgresRetention";
import type { EvalPostgresRunLease } from "../src/eval/postgresRetention";
import {
  createProviderEmbeddingAdapter,
  createProviderMemoryExtractor,
  createProviderTextGenerator,
} from "../src/eval/provider-harness";
import type { AISDKModelConfig } from "../src/provider/ai-sdk-runtime";
import {
  DEFAULT_AISDK_REQUEST_TIMEOUT_MS,
  requestOpenAICompatibleObject,
  resolveAISDKModel,
  withAISDKRetries,
} from "../src/provider/ai-sdk-runtime";
import {
  createPostgresDocumentStore,
  createPostgresSessionStore,
  createPostgresVectorStore,
} from "../src/storage/postgres";
import {
  resolveLiveModelConfig,
  resolveProviderBackedModelConfig,
} from "./run-eval";
import { assertCliPathSegmentValue } from "./cli-options";
import {
  assertPhase62Readiness,
  checkPhase62Readiness,
  parsePhase62CliOptions,
  resolvePhase62BenchmarkRoot,
  resolvePhase62OutputDir,
  resolvePhase62RepoRoot,
} from "./run-phase-62-shared";
import type { Phase62CliOptions } from "./run-phase-62-shared";
import { generateObject } from "ai";
import { z } from "zod";

export const PHASE62_CANONICAL_RUN_ID = "run-phase62-longmemeval-smoke-current";
export const PHASE62_LIVE_REQUEST_TIMEOUT_ENV =
  "GOODMEMORY_PHASE62_LIVE_REQUEST_TIMEOUT_MS";
export const PHASE62_STAGE_TIMEOUT_ENV =
  "GOODMEMORY_PHASE62_STAGE_TIMEOUT_MS";

const GENERATED_BY = "scripts/run-phase-62-eval.ts";

export interface Phase62EvalDependencies {
  beginPostgresRun?: (input: {
    benchmark: string;
    runId: string;
    url: string;
  }) => Promise<EvalPostgresRunLease>;
  createMemory?: typeof createGoodMemory;
  runConfiguration?: LongMemEvalRecallRunConfiguration;
  runSuite?: typeof runLongMemEvalSuite;
  supplementalEvidenceAugmenter?: LongMemEvalSupplementalEvidenceAugmenter;
  verifyReport?: (report: LongMemEvalReport) => Promise<void>;
}

const LONGMEMEVAL_PERSONA: PersonaSpec = {
  age_range: "unknown",
  background: "External LongMemEval benchmark persona.",
  communication_preferences: [],
  current_projects: [],
  domain_specific_preferences: [],
  domains: ["external-benchmark"],
  drift_events: [],
  expertise: [],
  growth_path: [],
  known_relationships: [],
  lifecycle_bucket: "medium",
  locale: "en",
  long_term_goals: [],
  memory_risks: [],
  name: "LongMemEval",
  negative_personalization_risks: [],
  persona_id: "longmemeval",
  profession: "benchmark",
  scenario_ids: ["longmemeval"],
  stable_preferences: [],
  work_style_preferences: [],
};

const LONGMEMEVAL_SCENARIO: ScenarioFixture = {
  domain: "external-benchmark",
  evaluation: {
    expected_history_signals: [],
    expected_identity_signals: [],
    expected_non_transfer_signals: [],
    expected_stale_suppression: [],
    expected_transfer_signals: [],
    expected_update_wins: [],
    improvement_hypothesis: "External LongMemEval answer generation.",
    prompt: "",
    rubric_focus: ["history_open_loop"],
    user_satisfaction_hypothesis: "Answers use only provided context.",
    wrong_personalization_signals: [],
  },
  evaluation_setting: "single_domain",
  lifecycle_bucket: "medium",
  memory_source_domains: ["external-benchmark"],
  persona_id: "longmemeval",
  required_phenomena: ["historical_task_continuation"],
  scenario_id: "longmemeval",
  sessions: [],
  task_family: "preference_continuation",
};

const NO_PROVIDER_EMBEDDING_ADAPTER = {
  embed: async (texts: string[]) => texts.map(() => [0]),
} satisfies NonNullable<GoodMemoryConfig["adapters"]>["embeddingAdapter"];

const NO_PROVIDER_ASSISTED_EXTRACTOR = {
  extract: async (input) => ({
    candidates: [],
    ignoredMessageCount: input.messages.length,
  }),
} satisfies NonNullable<GoodMemoryConfig["adapters"]>["assistedExtractor"];

const LONGMEMEVAL_REMEMBER_CONFIG = {
  profiles: [
    {
      assistantOutputs: { mode: "verified_only" },
      id: "phase-62-longmemeval",
    },
  ],
} satisfies GoodMemoryConfig["remember"];

async function verifyLongMemEvalReportArtifact(
  report: LongMemEvalReport,
): Promise<void> {
  const raw = await readFile(`${report.runDirectory}/report.json`, "utf8");
  const expected = `${JSON.stringify(report, null, 2)}\n`;
  if (raw !== expected) {
    throw new Error(
      `LongMemEval report artifact does not match the completed run: ${report.runId}`,
    );
  }
}

export function createHermeticLongMemEvalMemory(
  config: GoodMemoryConfig,
): GoodMemory {
  return createInternalGoodMemory(config, {
    environment: {},
    projectionBulkBackfill: true,
    projectionWriteThrough: false,
  });
}

const longMemEvalAnswerJudgeSchema = z.object({
  correct: z.boolean(),
  reasoning: z.string().min(1),
});

export function resolvePhase62LiveRequestTimeoutMs(
  env: Record<string, string | undefined> = process.env,
): number {
  const value = env[PHASE62_LIVE_REQUEST_TIMEOUT_ENV];
  if (!value) {
    return DEFAULT_AISDK_REQUEST_TIMEOUT_MS;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${PHASE62_LIVE_REQUEST_TIMEOUT_ENV} must be a positive integer`);
  }

  return parsed;
}

export function resolvePhase62StageTimeoutMs(
  requestTimeoutMs: number,
  env: Record<string, string | undefined> = process.env,
): number {
  const value = env[PHASE62_STAGE_TIMEOUT_ENV];
  if (!value) {
    return Math.max(requestTimeoutMs * 6, 30_000);
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${PHASE62_STAGE_TIMEOUT_ENV} must be a positive integer`);
  }

  return parsed;
}

export function buildLongMemEvalPrompt(input: {
  memoryContext?: string;
  prompt: string;
  questionDate?: string;
  transcript: string;
}): string {
  return [
    input.transcript ? `Visible conversation history:\n${input.transcript}` : undefined,
    input.memoryContext ? `Memory context:\n${input.memoryContext}` : undefined,
    input.questionDate ? `Question date:\n${input.questionDate}` : undefined,
    `Question:\n${input.prompt}`,
    "For recommendation-style questions, answer with the user's remembered preference or constraints that should guide recommendations; do not list generic recommendations.",
    "For advice or suggestion questions, turn remembered facts into an actionable preference/constraint for this request; do not merely restate the user's background.",
    "When memory context contains assistant follow-up recommendation topics or concrete suggestion names, include those concrete topics in the short answer instead of only summarizing the user constraint.",
    "When multiple remembered interests or constraints are visible for the same advice question, preserve each distinct one in the short answer.",
    "When an advice question has multiple concrete remembered issue areas, name each issue area briefly instead of expanding only one and dropping the others.",
    "For recommendation-style questions about a requested object category, include that category in the answer, such as resources, accessories, publications, conferences, or gear.",
    "For count questions, count distinct matching evidence items only. Include both past and current matches when the question asks for both; ignore related facts that do not satisfy the wording.",
    "For numeric comparison questions, compare visible numbers, percentages, amounts, dates, or durations directly and answer the requested relation, such as yes/no or the larger value.",
    "For total, sum, or page-count questions, add the visible matching numeric values and return the resulting total. Deduplicate repeated descriptions of the same transaction or event before adding; do not answer No answer when all operands are visible.",
    "For list or set questions, include every distinct item in the relevant grouped evidence, especially lines that use includes, list, or numbered-item wording.",
    "For temporal interval questions, compute elapsed days from the dated evidence and the question date when available; do not answer No answer when both dated endpoints are visible.",
    "For temporal order questions, sort matching dated evidence chronologically. Include every relevant event for event-order questions; when the question asks for an ordered entity category such as airlines or transport modes, return distinct entities in first-observed order and do not repeat the same entity unless the question explicitly asks for repeated events.",
    "For who/from-whom questions, return the visible person or source tied to the referenced item or event.",
    "For artist, item, or entity questions, if the evidence gives a descriptive entity rather than a proper name, return that description.",
    "Treat Selected Session Evidence as answer-bearing evidence; when it contains a matching fact, value, person, date, title, or entity, answer from that evidence instead of No answer.",
    "For first-person count questions, treat User-authored Source Evidence as the primary record of what the user actually did, used, bought, attended, or completed. Do not count assistant suggestions as completed user actions.",
    "Treat Selected Evidence Synthesis as computed answer-bearing evidence; when it directly gives the requested comparison, count, total, elapsed duration, or descriptive entity, return that synthesized answer instead of No answer.",
    "Return only the short answer. If the answer is not present in the visible history or memory context, return exactly: No answer.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function createLongMemEvalAnswerGenerator(
  requestTimeoutMs = resolvePhase62LiveRequestTimeoutMs(),
): LongMemEvalAnswerGenerator {
  const model = resolveLiveModelConfig("GOODMEMORY_EVAL");
  const system =
    "You answer LongMemEval questions using only the supplied conversation history or GoodMemory context. Do not invent missing details.";

  return async (input) => {
    const generator = createProviderTextGenerator({
      model,
      requestTimeoutMs,
      system,
      promptBuilder: (payload) =>
        buildLongMemEvalPrompt({
          memoryContext: payload.memoryContext,
          prompt: payload.prompt,
          questionDate: input.testCase.questionDate,
          transcript: payload.transcript,
        }),
    });
    const output = await generator({
      memoryContext: input.memoryContext,
      persona: LONGMEMEVAL_PERSONA,
      prompt: input.prompt,
      scenario: LONGMEMEVAL_SCENARIO,
      transcript: input.transcript,
    });
    return output.content;
  };
}

function buildLongMemEvalJudgePrompt(input: LongMemEvalAnswerJudgeInput): string {
  return [
    "You are judging LongMemEval answer correctness.",
    "Return strict JSON with keys: correct (boolean), reasoning (string).",
    "Mark correct when the candidate answer is semantically equivalent to the expected answer for the question.",
    "Accept concise numeric, entity, date, duration, or preference answers when they preserve the expected answer's core content.",
    "For recommendation-style questions, require the candidate to preserve the remembered user preference or constraint; do not require identical wording.",
    "Reject answers that are generic, contradict the expected answer, say no answer when the expected answer is present, or omit the core answer.",
    `Question id: ${input.questionId}`,
    `Question type: ${input.questionType}`,
    `Question: ${input.question}`,
    `Expected answer: ${input.expectedAnswer}`,
    `Candidate answer: ${input.actualAnswer}`,
  ].join("\n\n");
}

async function runLongMemEvalLiveAnswerJudge(
  model: AISDKModelConfig,
  input: LongMemEvalAnswerJudgeInput,
  requestTimeoutMs = resolvePhase62LiveRequestTimeoutMs(),
): Promise<Awaited<ReturnType<LongMemEvalAnswerJudge>>> {
  const prompt = buildLongMemEvalJudgePrompt(input);
  const system =
    "You are a strict benchmark judge. Return only valid JSON matching the requested shape.";

  if (model.provider === "openai" && model.baseURL) {
    return withAISDKRetries(() =>
      requestOpenAICompatibleObject({
        model,
        prompt,
        schema: longMemEvalAnswerJudgeSchema,
        system,
        timeoutMs: requestTimeoutMs,
      }),
    );
  }

  const { object } = await withAISDKRetries(async () =>
    generateObject({
      maxRetries: 0,
      model: resolveAISDKModel(model),
      prompt,
      schema: longMemEvalAnswerJudgeSchema,
      system,
      timeout: requestTimeoutMs,
    }),
  );
  return object;
}

export function createLongMemEvalAnswerJudge(
  requestTimeoutMs = resolvePhase62LiveRequestTimeoutMs(),
): LongMemEvalAnswerJudge {
  const model = resolveLiveModelConfig("GOODMEMORY_JUDGE");

  return (input) => runLongMemEvalLiveAnswerJudge(model, input, requestTimeoutMs);
}

export function createLongMemEvalMemoryFactory(
  createMemory: typeof createGoodMemory,
  options: {
    // Generalized-fusion dynamic-budget floor for fusion-capable profiles;
    // undefined keeps the preset default (no trimming).
    fusionMinRelativeStrength?: number;
    // Phase 75 arm: retrieval.longRecordAdmission on every profile.
    longRecordAdmission?: boolean;
    postgresSchema?: string;
    requestTimeoutMs?: number;
    // R6: injected cue adapter for the retrievalCues maintenance job; the
    // runner mutates the handler between record and replay rounds.
    retrievalCueAdapter?: {
      generate(input: {
        category: string;
        content: string;
        subject?: string;
      }): Promise<string[]>;
      maxFactsPerRun?: number;
    };
    runNamespace?: string;
  } = {},
): (
  profile:
    | "goodmemory-hybrid"
    | "goodmemory-recommended"
    | "goodmemory-rules-only",
) => GoodMemory {
  const namespace = createHash("sha256")
    .update(options.runNamespace ?? "longmemeval")
    .digest("hex")
    .slice(0, 12);
  let memoryCounter = 0;

  return (profile) => {
    memoryCounter += 1;
    let idCounter = 0;
    let clockTick = 0;
    const testing = {
      createId: () => {
        idCounter += 1;
        return `longmemeval-${namespace}-${memoryCounter}-${idCounter}`;
      },
      now: () => {
        clockTick += 1;
        return new Date(Date.UTC(2026, 0, 1, 0, 0, 0, clockTick));
      },
    };
    if (profile === "goodmemory-rules-only") {
      return createMemory({
        adapters: {
          assistedExtractor: NO_PROVIDER_ASSISTED_EXTRACTOR,
          embeddingAdapter: NO_PROVIDER_EMBEDDING_ADAPTER,
          ...(options.retrievalCueAdapter
            ? { retrievalCueGenerator: options.retrievalCueAdapter }
            : {}),
        },
        remember: LONGMEMEVAL_REMEMBER_CONFIG,
        ...(options.longRecordAdmission ? { retrieval: { longRecordAdmission: true } } : {}),
        storage: {
          provider: "memory",
        },
        testing,
      });
    }

    if (profile === "goodmemory-recommended") {
      return createMemory({
        adapters: {
          assistedExtractor: NO_PROVIDER_ASSISTED_EXTRACTOR,
          ...(options.retrievalCueAdapter
            ? { retrievalCueGenerator: options.retrievalCueAdapter }
            : {}),
        },
        remember: LONGMEMEVAL_REMEMBER_CONFIG,
        retrieval: {
          ...(options.fusionMinRelativeStrength !== undefined
            ? {
                generalizedFusionMinRelativeStrength:
                  options.fusionMinRelativeStrength,
              }
            : {}),
          ...(options.longRecordAdmission ? { longRecordAdmission: true } : {}),
          preset: "recommended",
        },
        storage: {
          provider: "memory",
        },
        testing,
      });
    }

    if (!process.env.GOODMEMORY_TEST_POSTGRES_URL) {
      throw new Error(
        "LongMemEval goodmemory-hybrid full mode requires GOODMEMORY_TEST_POSTGRES_URL.",
      );
    }

    const embeddingModel = resolveProviderBackedModelConfig("GOODMEMORY_EMBEDDING");
    const extractorModel = resolveProviderBackedModelConfig(
      "GOODMEMORY_ASSISTED_EXTRACTOR",
    );

    const postgresUrl = process.env.GOODMEMORY_TEST_POSTGRES_URL;
    const postgresStorage = options.postgresSchema
      ? {
          documentStore: createPostgresDocumentStore({
            schema: options.postgresSchema,
            url: postgresUrl,
          }),
          sessionStore: createPostgresSessionStore({
            schema: options.postgresSchema,
            url: postgresUrl,
          }),
          vectorStore: createPostgresVectorStore({
            schema: options.postgresSchema,
            url: postgresUrl,
          }),
        }
      : {};

    return createMemory({
      adapters: {
        assistedExtractor: createProviderMemoryExtractor({
          model: extractorModel,
          requestTimeoutMs: options.requestTimeoutMs,
        }),
        embeddingAdapter: createProviderEmbeddingAdapter({
          model: embeddingModel,
          requestTimeoutMs: options.requestTimeoutMs,
        }),
        ...postgresStorage,
      },
      remember: LONGMEMEVAL_REMEMBER_CONFIG,
      ...(options.longRecordAdmission ? { retrieval: { longRecordAdmission: true } } : {}),
      storage: {
        provider: "postgres",
        url: postgresUrl,
      },
      testing,
    });
  };
}

function buildRunOptions(
  root: string,
  options: Phase62CliOptions,
): RunLongMemEvalOptions {
  const smoke = options.mode === "smoke";
  const runId = options.runId ?? PHASE62_CANONICAL_RUN_ID;
  assertCliPathSegmentValue({ flag: "--run-id", value: runId });
  return {
    benchmarkRoot:
      options.benchmarkRoot ?? resolvePhase62BenchmarkRoot(root, smoke),
    caseIds: options.caseIds,
    generatedBy: GENERATED_BY,
    limit: options.limit,
    maxConcurrency: options.maxConcurrency,
    mode: options.mode,
    offset: options.offset,
    outputDir: options.outputDir ?? resolvePhase62OutputDir(root),
    profiles: options.profiles,
    questionTypes: options.questionTypes,
    runId,
  };
}

export async function runPhase62LongMemEval(
  options: Partial<Phase62CliOptions> = {},
  dependencies: Phase62EvalDependencies = {},
): Promise<LongMemEvalReport> {
  const root = resolvePhase62RepoRoot();
  const runSuite = dependencies.runSuite ?? runLongMemEvalSuite;
  const runOptions = buildRunOptions(root, {
    mode: "smoke",
    ...options,
  });
  const configuredRunOptions = dependencies.runConfiguration
    ? { ...runOptions, runConfiguration: dependencies.runConfiguration }
    : runOptions;
  let liveExecution:
    | { requestTimeoutMs: number; stageTimeoutMs: number }
    | undefined;

  if (configuredRunOptions.mode === "full" && !dependencies.runSuite) {
    const requestTimeoutMs = resolvePhase62LiveRequestTimeoutMs();
    liveExecution = {
      requestTimeoutMs,
      stageTimeoutMs: resolvePhase62StageTimeoutMs(requestTimeoutMs),
    };
    assertPhase62Readiness(
      checkPhase62Readiness({
        benchmarkRoot: configuredRunOptions.benchmarkRoot,
        mode: configuredRunOptions.mode,
        profiles: configuredRunOptions.profiles,
      }),
    );

  }

  const execute = (postgresSchema?: string): Promise<LongMemEvalReport> => {
    if (configuredRunOptions.mode !== "full" || dependencies.runSuite) {
      return runSuite(configuredRunOptions);
    }
    return runSuite({
      ...configuredRunOptions,
      stageTimeoutMs: liveExecution!.stageTimeoutMs,
    }, {
      answerGenerator: createLongMemEvalAnswerGenerator(
        liveExecution!.requestTimeoutMs,
      ),
      answerJudge: createLongMemEvalAnswerJudge(
        liveExecution!.requestTimeoutMs,
      ),
      memoryContextBuilder: createLongMemEvalGoodMemoryContextBuilder({
        createMemory: createLongMemEvalMemoryFactory(
          dependencies.createMemory ?? createHermeticLongMemEvalMemory,
          {
            postgresSchema,
            requestTimeoutMs: liveExecution!.requestTimeoutMs,
            runNamespace: configuredRunOptions.runId,
          },
        ),
        extractionStrategy:
          configuredRunOptions.runConfiguration?.extractionStrategy,
        runId: configuredRunOptions.runId,
        supplementalEvidenceAugmenter:
          dependencies.supplementalEvidenceAugmenter,
        supplementalEvidenceLimit:
          configuredRunOptions.runConfiguration?.evidencePack
            ?.supplementalEvidenceLimit,
        supplementalEvidencePerSessionLimit:
          configuredRunOptions.runConfiguration?.evidencePack
            ?.supplementalEvidencePerSessionLimit,
      }),
    });
  };

  const usesProviderPostgres =
    configuredRunOptions.mode === "full" &&
    normalizeLongMemEvalProfileList(configuredRunOptions.profiles).includes(
      "goodmemory-hybrid",
    );
  if (!usesProviderPostgres) {
    return execute();
  }

  const postgresUrl = process.env.GOODMEMORY_TEST_POSTGRES_URL?.trim();
  if (!postgresUrl) {
    throw new Error(
      "LongMemEval provider-backed retention requires GOODMEMORY_TEST_POSTGRES_URL",
    );
  }
  const lease = await (
    dependencies.beginPostgresRun ?? beginEvalPostgresRun
  )({
    benchmark: "longmemeval",
    runId: configuredRunOptions.runId ?? PHASE62_CANONICAL_RUN_ID,
    url: postgresUrl,
  });
  return withEvalPostgresRunRetention({
    lease,
    retain: process.env.GOODMEMORY_EVAL_RETAIN_POSTGRES === "1",
    run: () => execute(lease.schema),
    verify: dependencies.verifyReport ?? verifyLongMemEvalReportArtifact,
  });
}

if (import.meta.main) {
  const report = await runPhase62LongMemEval(
    parsePhase62CliOptions(Bun.argv),
  );
  console.log(JSON.stringify(report, null, 2));
}
