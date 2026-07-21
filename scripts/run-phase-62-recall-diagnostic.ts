import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type {
  LongMemEvalRecallDiagnosticProfile,
  LongMemEvalRecallDiagnosticReport,
  LongMemEvalRecallRunConfiguration,
  RunLongMemEvalRecallDiagnosticOptions,
} from "../src/eval/longmemeval";
import {
  createLongMemEvalGoodMemoryContextBuilder,
  LONGMEMEVAL_DEFAULT_CONTEXT_MAX_TOKENS,
  runLongMemEvalRecallDiagnostic,
} from "../src/eval/longmemeval";
import {
  beginEvalPostgresRun,
  withEvalPostgresRunRetention,
} from "../src/eval/postgresRetention";
import type { EvalPostgresRunLease } from "../src/eval/postgresRetention";
import { createGoodMemory } from "../src/api/createGoodMemory";
import type { GoodMemory } from "../src/api/contracts";
import {
  RECOMMENDED_GENERALIZED_FUSION_MAX_CANDIDATES,
  RECOMMENDED_GENERALIZED_FUSION_MAX_TOTAL_FACTS,
} from "../src/api/retrievalPreset";
import {
  DEFAULT_GENERALIZED_FUSION_MIN_RELATIVE_STRENGTH,
  DEFAULT_GENERALIZED_FUSION_RRF_K,
} from "../src/recall/generalizedFusion";
import { assertCliPathSegmentValue } from "./cli-options";
import {
  createHermeticLongMemEvalMemory,
  createLongMemEvalMemoryFactory,
} from "./run-phase-62-eval";
import type { Phase62CliOptions } from "./run-phase-62-shared";
import {
  parsePhase62CliOptions,
  resolvePhase62BenchmarkRoot,
  resolvePhase62DataFileCandidates,
  resolvePhase62OutputDir,
  resolvePhase62RepoRoot,
} from "./run-phase-62-shared";

export const PHASE62_RECALL_DIAGNOSTIC_RUN_ID =
  "run-phase62-longmemeval-recall-diagnostic-current";
export const PHASE62_TYPE_BALANCED_CASE_IDS = [
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

const GENERATED_BY = "scripts/run-phase-62-recall-diagnostic.ts";

export interface Phase62RecallDiagnosticDependencies {
  beginPostgresRun?: (input: {
    benchmark: string;
    runId: string;
    url: string;
  }) => Promise<EvalPostgresRunLease>;
  createMemory?: typeof createGoodMemory;
  fileExists?: (path: string) => boolean;
  runDiagnostic?: typeof runLongMemEvalRecallDiagnostic;
  verifyReport?: (report: LongMemEvalRecallDiagnosticReport) => Promise<void>;
}

async function verifyRecallDiagnosticReportArtifact(
  report: LongMemEvalRecallDiagnosticReport,
): Promise<void> {
  const raw = await readFile(
    `${report.runDirectory}/recall-diagnostic.json`,
    "utf8",
  );
  const expected = `${JSON.stringify(report, null, 2)}\n`;
  if (raw !== expected) {
    throw new Error(
      `LongMemEval recall report artifact does not match the completed run: ${report.runId}`,
    );
  }
}

function listMissingEnv(required: readonly string[]): string[] {
  return required.filter((name) => {
    const value = process.env[name];
    return typeof value !== "string" || value.trim().length === 0;
  });
}

function resolveRecallDiagnosticProfile(
  profiles?: readonly string[],
): LongMemEvalRecallDiagnosticProfile {
  if (!profiles || profiles.length === 0) {
    return "goodmemory-rules-only";
  }
  if (profiles.length !== 1) {
    throw new Error(
      "Phase 62 recall-only diagnostic accepts exactly one GoodMemory profile.",
    );
  }

  const profile = profiles[0];
  if (
    profile === "goodmemory-rules-only" ||
    profile === "goodmemory-hybrid" ||
    profile === "goodmemory-recommended"
  ) {
    return profile;
  }

  throw new Error(
    "Phase 62 recall-only diagnostic profile must be goodmemory-rules-only, goodmemory-recommended, or goodmemory-hybrid.",
  );
}

function buildRecallRunConfiguration(
  profile: LongMemEvalRecallDiagnosticProfile,
  fusionMinRelativeStrength?: number,
): LongMemEvalRecallRunConfiguration {
  return {
    contextMaxTokens: LONGMEMEVAL_DEFAULT_CONTEXT_MAX_TOKENS,
    extractionStrategy: "rules-only",
    // The recorded floor equals the wired floor. Earlier reports recorded the
    // 0.35 constant while the engine ignored the field and ran 0; sweep arms
    // pass --fusion-min-relative-strength explicitly (0.35 reproduces the
    // Phase 69 gate's expected configuration for real).
    generalizedFusion: profile === "goodmemory-recommended"
      ? {
          maxCandidates: RECOMMENDED_GENERALIZED_FUSION_MAX_CANDIDATES,
          maxTotalFacts: RECOMMENDED_GENERALIZED_FUSION_MAX_TOTAL_FACTS,
          minRelativeStrength: fusionMinRelativeStrength ?? 0,
          rrfK: DEFAULT_GENERALIZED_FUSION_RRF_K,
        }
      : null,
    projection: {
      bulkBackfill: true,
      writeThrough: false,
    },
    providerEmbedding: profile === "goodmemory-hybrid",
    recallStrategy: profile === "goodmemory-rules-only"
      ? "rules-only"
      : "hybrid",
  };
}

function assertRecallDiagnosticReadiness(input: {
  benchmarkRoot: string;
  fileExists: (path: string) => boolean;
  mode: "smoke" | "full";
  profile: LongMemEvalRecallDiagnosticProfile;
}): void {
  const candidateDataFiles = resolvePhase62DataFileCandidates({
    benchmarkRoot: input.benchmarkRoot,
    mode: input.mode,
  });
  if (!candidateDataFiles.some(input.fileExists)) {
    throw new Error(
      `Phase 62 recall-only diagnostic could not find LongMemEval data. Checked: ${candidateDataFiles.join(", ")}`,
    );
  }

  if (input.profile !== "goodmemory-hybrid") {
    return;
  }

  const missing = listMissingEnv([
    "GOODMEMORY_TEST_POSTGRES_URL",
    "GOODMEMORY_EMBEDDING_PROVIDER",
    "GOODMEMORY_EMBEDDING_MODEL",
    "GOODMEMORY_EMBEDDING_API_KEY",
    "GOODMEMORY_ASSISTED_EXTRACTOR_PROVIDER",
    "GOODMEMORY_ASSISTED_EXTRACTOR_MODEL",
    "GOODMEMORY_ASSISTED_EXTRACTOR_API_KEY",
  ]);
  if (missing.length > 0) {
    throw new Error(
      `Phase 62 goodmemory-hybrid recall-only diagnostic is missing provider env: ${missing.join(", ")}`,
    );
  }
}

export function buildPhase62RecallDiagnosticOptions(
  root: string,
  options: Phase62CliOptions,
): RunLongMemEvalRecallDiagnosticOptions {
  const profile = resolveRecallDiagnosticProfile(options.profiles);
  const runId = options.runId ?? PHASE62_RECALL_DIAGNOSTIC_RUN_ID;
  assertCliPathSegmentValue({ flag: "--run-id", value: runId });
  if (options.allCases && options.caseIds && options.caseIds.length > 0) {
    throw new Error("--all-cases cannot be combined with --case-id");
  }
  if (
    options.fusionMinRelativeStrength !== undefined &&
    profile !== "goodmemory-recommended"
  ) {
    throw new Error(
      "--fusion-min-relative-strength requires a generalized-fusion profile (goodmemory-recommended)",
    );
  }

  return {
    benchmarkRoot:
      options.benchmarkRoot ?? resolvePhase62BenchmarkRoot(root, false),
    caseIds: options.allCases
      ? undefined
      : (options.caseIds ?? PHASE62_TYPE_BALANCED_CASE_IDS),
    generatedBy: GENERATED_BY,
    ingestMode: options.labelFreeIngest
      ? "label-free-raw"
      : "historical-annotated",
    limit: options.limit,
    maxConcurrency: options.maxConcurrency ?? 1,
    mode: "full",
    offset: options.offset,
    outputDir: options.outputDir ?? resolvePhase62OutputDir(root),
    profile,
    questionTypes: options.questionTypes,
    resume: options.resume,
    runConfiguration: buildRecallRunConfiguration(
      profile,
      options.fusionMinRelativeStrength,
    ),
    runId,
  };
}

export async function runPhase62LongMemEvalRecallDiagnostic(
  options: Partial<Phase62CliOptions> = {},
  dependencies: Phase62RecallDiagnosticDependencies = {},
): Promise<LongMemEvalRecallDiagnosticReport> {
  const root = resolvePhase62RepoRoot();
  const runDiagnostic =
    dependencies.runDiagnostic ?? runLongMemEvalRecallDiagnostic;
  const runOptions = buildPhase62RecallDiagnosticOptions(root, {
    mode: "smoke",
    ...options,
  });
  const runId = runOptions.runId ?? PHASE62_RECALL_DIAGNOSTIC_RUN_ID;

  if (!dependencies.runDiagnostic) {
    assertRecallDiagnosticReadiness({
      benchmarkRoot: runOptions.benchmarkRoot,
      fileExists: dependencies.fileExists ?? existsSync,
      mode: runOptions.mode,
      profile: runOptions.profile,
    });

  }

  const execute = (postgresSchema?: string) => {
    if (dependencies.runDiagnostic) {
      return runDiagnostic(runOptions);
    }
    const createMemory =
      dependencies.createMemory ?? createHermeticLongMemEvalMemory;
    const wiredFusionFloor =
      runOptions.runConfiguration?.generalizedFusion?.minRelativeStrength;
    const createProfileMemory = createLongMemEvalMemoryFactory(
      createMemory,
      {
        ...(wiredFusionFloor !== undefined
          ? { fusionMinRelativeStrength: wiredFusionFloor }
          : {}),
        postgresSchema,
        runNamespace: runOptions.runId,
      },
    ) as (profile: LongMemEvalRecallDiagnosticProfile) => GoodMemory;
    return runDiagnostic(runOptions, {
      memoryContextBuilder: createLongMemEvalGoodMemoryContextBuilder({
        createMemory: createProfileMemory,
        ingestMode: runOptions.ingestMode,
        maxTokens: runOptions.runConfiguration?.contextMaxTokens,
        runId: runOptions.runId,
      }),
    });
  };

  if (runOptions.profile !== "goodmemory-hybrid") {
    return execute();
  }

  const postgresUrl = process.env.GOODMEMORY_TEST_POSTGRES_URL?.trim();
  if (!postgresUrl) {
    throw new Error(
      "LongMemEval recall retention requires GOODMEMORY_TEST_POSTGRES_URL",
    );
  }
  const lease = await (
    dependencies.beginPostgresRun ?? beginEvalPostgresRun
  )({
    benchmark: "longmemeval-recall",
    runId,
    url: postgresUrl,
  });
  return withEvalPostgresRunRetention({
    lease,
    retain: process.env.GOODMEMORY_EVAL_RETAIN_POSTGRES === "1",
    run: () => execute(lease.schema),
    verify:
      dependencies.verifyReport ?? verifyRecallDiagnosticReportArtifact,
  });
}

if (import.meta.main) {
  const report = await runPhase62LongMemEvalRecallDiagnostic(
    parsePhase62CliOptions(Bun.argv),
  );
  console.log(JSON.stringify(report, null, 2));
}
