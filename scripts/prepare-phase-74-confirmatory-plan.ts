#!/usr/bin/env bun
import {
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type {
  Phase74BenchmarkFamily,
  Phase74DatasetBundle,
} from "../src/eval/phase74Datasets";
import {
  capturePhase74EvaluatorSource,
  resolvePhase74LiveModels,
} from "../src/eval/phase74Live";
import type {
  Phase74EvaluatorSource,
  Phase74LiveModels,
} from "../src/eval/phase74Live";
import {
  buildPhase74ConfirmatoryPlan,
  hashPhase74ConfirmatoryPlan,
  parsePhase74ConfirmatoryPlan,
} from "../src/eval/phase74ConfirmatoryPlan";
import type {
  Phase74ConfirmatoryPlan,
} from "../src/eval/phase74ConfirmatoryPlan";
import {
  loadPhase74ProtectionBlueprintDescriptor,
} from "../src/eval/phase74ProtectionSuiteEvidence";
import {
  loadPhase74PreparedDataset,
  selectPhase74GeneralizationCases,
} from "./run-phase-74-generalization";
import { resolveRepoRootFromScriptUrl } from "./script-paths";

const FLAGS = [
  "--case-concurrency",
  "--embedding-spend-limit-usd",
  "--locomo-benchmark-root",
  "--locomo-case-count",
  "--longmemeval-benchmark-root",
  "--longmemeval-case-count",
  "--max-language-calls",
  "--output",
  "--protection-blueprint",
] as const;

type Flag = (typeof FLAGS)[number];

export interface Phase74ConfirmatoryPlanBuilderCliOptions {
  caseConcurrency: number;
  embeddingSpendLimitUsd: number;
  locomoBenchmarkRoot: string;
  locomoCaseCount: number;
  longMemEvalBenchmarkRoot: string;
  longMemEvalCaseCount: number;
  maxLanguageCalls: number;
  outputPath: string;
  protectionBlueprintPath: string;
}

export interface Phase74ConfirmatoryPlanBuilderDependencies {
  captureEvaluatorSource?(): Promise<Phase74EvaluatorSource>;
  loadDataset?(input: {
    benchmark: Phase74BenchmarkFamily;
    benchmarkRoot: string;
  }): Promise<Phase74DatasetBundle>;
  protectionBlueprint?: {
    id: "phase74-protection-suite-manifest-v2";
    sha256: string;
  };
  resolveModels?(
    env: Record<string, string | undefined>,
  ): Pick<
    Phase74LiveModels,
    "answer" | "embedding" | "judge" | "reranker"
  >;
}

function parseFlags(args: readonly string[]): Map<Flag, string> {
  const allowed = new Set<string>(FLAGS);
  const values = new Map<Flag, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    if (flag === undefined || !allowed.has(flag)) {
      throw new Error(
        `Phase 74 confirmatory plan builder received unknown option ${flag ?? ""}.`,
      );
    }
    if (values.has(flag as Flag)) {
      throw new Error(`${flag} cannot be specified more than once.`);
    }
    const value = args[index + 1];
    if (
      value === undefined ||
      value.startsWith("--") ||
      value === "" ||
      value.trim() !== value
    ) {
      throw new Error(`${flag} requires a non-empty trimmed value.`);
    }
    values.set(flag as Flag, value);
  }
  return values;
}

function required(values: ReadonlyMap<Flag, string>, flag: Flag): string {
  const value = values.get(flag);
  if (value === undefined) {
    throw new Error(`Phase 74 confirmatory plan builder requires ${flag}.`);
  }
  return value;
}

function positiveInteger(value: string, flag: Flag): number {
  if (!/^[1-9]\d*$/u.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return Number(value);
}

function positiveNumber(value: string, flag: Flag): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive number.`);
  }
  return parsed;
}

function openAiProvider(value: string): "openai" {
  if (value !== "openai") {
    throw new Error("Phase 74 confirmatory evaluation requires the OpenAI-compatible provider.");
  }
  return value;
}

export function parsePhase74ConfirmatoryPlanBuilderCliOptions(
  args: readonly string[],
): Phase74ConfirmatoryPlanBuilderCliOptions {
  const values = parseFlags(args);
  return {
    caseConcurrency: positiveInteger(
      required(values, "--case-concurrency"),
      "--case-concurrency",
    ),
    embeddingSpendLimitUsd: positiveNumber(
      required(values, "--embedding-spend-limit-usd"),
      "--embedding-spend-limit-usd",
    ),
    locomoBenchmarkRoot: resolve(
      required(values, "--locomo-benchmark-root"),
    ),
    locomoCaseCount: positiveInteger(
      required(values, "--locomo-case-count"),
      "--locomo-case-count",
    ),
    longMemEvalBenchmarkRoot: resolve(
      required(values, "--longmemeval-benchmark-root"),
    ),
    longMemEvalCaseCount: positiveInteger(
      required(values, "--longmemeval-case-count"),
      "--longmemeval-case-count",
    ),
    maxLanguageCalls: positiveInteger(
      required(values, "--max-language-calls"),
      "--max-language-calls",
    ),
    outputPath: resolve(required(values, "--output")),
    protectionBlueprintPath: resolve(
      required(values, "--protection-blueprint"),
    ),
  };
}

function assertExistingPlanControls(
  plan: Phase74ConfirmatoryPlan,
  options: Phase74ConfirmatoryPlanBuilderCliOptions,
): void {
  const locomo = plan.families.find(({ benchmark }) => benchmark === "locomo")!;
  const longMemEval = plan.families.find(
    ({ benchmark }) => benchmark === "longmemeval",
  )!;
  if (
    plan.caseConcurrency !== options.caseConcurrency ||
    plan.callBudget.embeddingSpendLimitUsd !==
      options.embeddingSpendLimitUsd ||
    plan.callBudget.maxLanguageCalls !== options.maxLanguageCalls ||
    locomo.population.caseCount !== options.locomoCaseCount ||
    longMemEval.population.caseCount !== options.longMemEvalCaseCount
  ) {
    throw new Error(
      "Phase 74 confirmatory plan already exists and does not exactly match the requested controls.",
    );
  }
}

async function loadExistingPlan(
  options: Phase74ConfirmatoryPlanBuilderCliOptions,
): Promise<Phase74ConfirmatoryPlan | null> {
  let raw: string;
  try {
    raw = await readFile(options.outputPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
  let plan: Phase74ConfirmatoryPlan;
  try {
    plan = parsePhase74ConfirmatoryPlan(JSON.parse(raw));
  } catch (error) {
    throw new Error(
      "Phase 74 confirmatory plan already exists but is not an exact match.",
      { cause: error },
    );
  }
  if (raw !== `${JSON.stringify(plan, null, 2)}\n`) {
    throw new Error(
      "Phase 74 confirmatory plan already exists but is not a byte-exact canonical match.",
    );
  }
  assertExistingPlanControls(plan, options);
  return plan;
}

function parentDataset(bundle: Phase74DatasetBundle) {
  return {
    adaptedCasesSha256: bundle.manifest.adaptedCasesSha256,
    caseCount: bundle.manifest.caseCount,
    datasetSha256: bundle.manifest.datasetSha256,
    memoryGroupCount: new Set(bundle.cases.map(
      ({ caseId, memoryGroupId }) => memoryGroupId ?? caseId,
    )).size,
    normalizedFingerprint: bundle.manifest.normalizedFingerprint,
    selectedCaseIdsSha256: bundle.manifest.selectedCaseIdsSha256,
    sourceSha256: bundle.manifest.source.sourceSha256,
  };
}

function family(input: {
  benchmark: Phase74BenchmarkFamily;
  bundle: Phase74DatasetBundle;
  caseCount: number;
}) {
  const selection = selectPhase74GeneralizationCases({
    cases: input.bundle.cases,
  }).identity;
  if (
    selection.mode !== "all" ||
    selection.populationSize !== input.caseCount ||
    selection.selectedSize !== input.caseCount ||
    input.bundle.manifest.caseCount !== input.caseCount ||
    typeof selection.selectedCaseIdsSha256 !== "string" ||
    typeof selection.selectedCaseKeysSha256 !== "string"
  ) {
    throw new Error(
      `Phase 74 ${input.benchmark} case count must equal the complete family population.`,
    );
  }
  return {
    benchmark: input.benchmark,
    population: {
      authority: "presealed-full-population" as const,
      caseCount: input.caseCount,
      selectedCaseIdsSha256: selection.selectedCaseIdsSha256,
      selectedCaseKeysSha256: selection.selectedCaseKeysSha256,
    },
    parentDataset: parentDataset(input.bundle),
    seenCasesOnly: true as const,
  };
}

export async function preparePhase74ConfirmatoryPlan(
  options: Phase74ConfirmatoryPlanBuilderCliOptions,
  dependencies: Phase74ConfirmatoryPlanBuilderDependencies = {},
  env: Record<string, string | undefined> = process.env,
): Promise<{
  plan: Phase74ConfirmatoryPlan;
  sha256: string;
}> {
  const existing = await loadExistingPlan(options);
  if (existing !== null) {
    return {
      plan: existing,
      sha256: hashPhase74ConfirmatoryPlan(existing),
    };
  }
  const loadDataset = dependencies.loadDataset ?? loadPhase74PreparedDataset;
  const [locomo, longMemEval, evaluatorSource, protectionBlueprint] =
    await Promise.all([
      loadDataset({
        benchmark: "locomo",
        benchmarkRoot: options.locomoBenchmarkRoot,
      }),
      loadDataset({
        benchmark: "longmemeval",
        benchmarkRoot: options.longMemEvalBenchmarkRoot,
      }),
      dependencies.captureEvaluatorSource?.() ??
        capturePhase74EvaluatorSource({
          repoRoot: resolveRepoRootFromScriptUrl(import.meta.url),
        }),
      dependencies.protectionBlueprint === undefined
        ? loadPhase74ProtectionBlueprintDescriptor(
            options.protectionBlueprintPath,
          )
        : Promise.resolve(dependencies.protectionBlueprint),
    ]);
  const models = (dependencies.resolveModels ?? resolvePhase74LiveModels)(env);
  const plan = buildPhase74ConfirmatoryPlan({
    admissionClass: "confirmatory-only",
    answerModel: {
      gateway: models.answer.baseURL ?? "",
      model: models.answer.model,
      provider: openAiProvider(models.answer.provider),
    },
    callBudget: {
      embeddingSpendLimitUsd: options.embeddingSpendLimitUsd,
      maxLanguageCalls: options.maxLanguageCalls,
    },
    caseConcurrency: options.caseConcurrency,
    embedding: {
      gateway: models.embedding.baseURL ?? "",
      model: models.embedding.model,
      provider: openAiProvider(models.embedding.provider),
    },
    evaluatorSource,
    families: [
      family({
        benchmark: "locomo",
        bundle: locomo,
        caseCount: options.locomoCaseCount,
      }),
      family({
        benchmark: "longmemeval",
        bundle: longMemEval,
        caseCount: options.longMemEvalCaseCount,
      }),
    ],
    judgeModel: {
      gateway: models.judge.baseURL ?? "",
      model: models.judge.model,
      provider: openAiProvider(models.judge.provider),
    },
    protectionBlueprint,
    renderedContextTokens: 6_000,
    reranker: {
      gateway: models.reranker.baseURL ?? "",
      implementation: "provider-listwise-v1",
      mode: "provider",
      model: models.reranker.model,
      provider: openAiProvider(models.reranker.provider),
    },
  });
  const content = `${JSON.stringify(plan, null, 2)}\n`;
  await mkdir(dirname(options.outputPath), { recursive: true });
  try {
    await writeFile(options.outputPath, content, {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code !== "EEXIST" ||
      await readFile(options.outputPath, "utf8") !== content
    ) {
      throw new Error(
        "Phase 74 confirmatory plan already exists and is not an exact match.",
        { cause: error },
      );
    }
  }
  return {
    plan,
    sha256: hashPhase74ConfirmatoryPlan(plan),
  };
}

if (import.meta.main) {
  const prepared = await preparePhase74ConfirmatoryPlan(
    parsePhase74ConfirmatoryPlanBuilderCliOptions(
      process.argv.slice(2),
    ),
  );
  console.log(JSON.stringify({
    artifactKind: prepared.plan.artifactKind,
    families: prepared.plan.families.map(({
      benchmark,
      parentDataset,
      population,
    }) => ({
      benchmark,
      parentCaseCount: parentDataset.caseCount,
      populationCaseCount: population.caseCount,
    })),
    runCount: prepared.plan.runs.length,
    sha256: prepared.sha256,
  }, null, 2));
}
