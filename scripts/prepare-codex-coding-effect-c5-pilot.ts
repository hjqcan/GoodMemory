import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  C6_GURKIAI_FLAT_SUMMARY_ENDPOINT,
} from "./codex-coding-effect/c6-flat-summary-generation-capture";
import type { C5BaselineArm } from "./codex-coding-effect/c5-pilot-plan";

import {
  loadC5PilotReadiness,
} from "./codex-coding-effect/c5-readiness";
import type {
  C5PilotReadinessInput,
  C5PilotReadinessResult,
} from "./codex-coding-effect/c5-readiness";

const DEFAULT_DATASET_ROOT =
  "fixtures/codex-coding-effect/c4-controlled-pilot";
const DEFAULT_C4_READINESS_REPORT =
  "reports/quality-gates/phase-73/c4-controlled-pilot-readiness.json";
const DEFAULT_BASELINE_REPORT =
  "reports/quality-gates/phase-73/c4-baseline-ceiling-pilot/report.json";
const DEFAULT_C4_READINESS_CORE =
  "reports/quality-gates/phase-73/c4-controlled-pilot-core.json";
const DEFAULT_C4_REVIEW_ROOT =
  "fixtures/codex-coding-effect/c4-controlled-pilot/review";

export function parseC5ReadinessOptions(
  args: readonly string[],
): C5PilotReadinessInput {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null) {
      throw new Error(`invalid C5 readiness argument ${argument}`);
    }
    const [, name, value] = match;
    if (![
      "baseline-arm",
      "baseline-report",
      "baseline-raw-stage-evidence",
      "baseline-stage-evidence",
      "c4-readiness-core",
      "c4-readiness-report",
      "c4-readiness-workspace",
      "c4-review-dispatch",
      "c4-review-input-bundle",
      "c4-review-provenance",
      "c4-review-request",
      "c4-review-response",
      "dataset-root",
      "material-effect-pp",
      "order-seed",
      "summary-endpoint",
      "summary-model",
      "summary-prompt",
    ].includes(name)) {
      throw new Error(`unknown C5 readiness option --${name}`);
    }
    if (values.has(name)) {
      throw new Error(`duplicate C5 readiness option --${name}`);
    }
    if (value.length === 0) {
      throw new Error(`C5 readiness option --${name} must not be empty`);
    }
    values.set(name, value);
  }

  const orderSeedValue = values.get("order-seed");
  if (orderSeedValue === undefined) {
    throw new Error("C5 readiness requires --order-seed");
  }
  if (!/^[1-9][0-9]*$/u.test(orderSeedValue)) {
    throw new Error("--order-seed must be a canonical positive integer");
  }
  const orderSeed = Number(orderSeedValue);
  if (!Number.isSafeInteger(orderSeed)) {
    throw new Error("--order-seed must be a canonical positive integer");
  }

  const materialEffectValue = values.get("material-effect-pp");
  if (materialEffectValue === undefined) {
    throw new Error("C5 readiness requires --material-effect-pp");
  }
  if (!/^[1-9][0-9]*$/u.test(materialEffectValue)) {
    throw new Error(
      "--material-effect-pp must be a canonical integer from 1 to 50",
    );
  }
  const materialEffectPercentagePoints = Number(materialEffectValue);
  if (
    !Number.isSafeInteger(materialEffectPercentagePoints) ||
    materialEffectPercentagePoints > 50
  ) {
    throw new Error(
      "--material-effect-pp must be a canonical integer from 1 to 50",
    );
  }

  const baselineReportPath = values.get("baseline-report") ??
    DEFAULT_BASELINE_REPORT;
  const comparatorOptions = resolveReadinessComparatorOptions(values);
  return {
    ...comparatorOptions,
    baselineReportPath,
    baselineRawStageEvidenceRoot: values.get("baseline-raw-stage-evidence") ??
      join(dirname(baselineReportPath), "raw-stages"),
    baselineStageEvidenceRoot: values.get("baseline-stage-evidence") ??
      join(dirname(baselineReportPath), "stages"),
    c4ReadinessCorePath: values.get("c4-readiness-core") ??
      DEFAULT_C4_READINESS_CORE,
    c4ReadinessReportPath: values.get("c4-readiness-report") ??
      DEFAULT_C4_READINESS_REPORT,
    c4ReadinessWorkspaceRoot: values.get("c4-readiness-workspace") ??
      join(tmpdir(), `goodmemory-c5-readiness-${process.pid}`),
    c4ReviewDispatchPath: values.get("c4-review-dispatch") ??
      join(DEFAULT_C4_REVIEW_ROOT, "dispatch.json"),
    c4ReviewInputBundlePath: values.get("c4-review-input-bundle") ??
      join(DEFAULT_C4_REVIEW_ROOT, "input-bundle.json"),
    c4ReviewProvenancePath: values.get("c4-review-provenance") ??
      join(DEFAULT_C4_REVIEW_ROOT, "provenance.json"),
    c4ReviewRequestPath: values.get("c4-review-request") ??
      join(DEFAULT_C4_REVIEW_ROOT, "request.md"),
    c4ReviewResponsePath: values.get("c4-review-response") ??
      join(DEFAULT_C4_REVIEW_ROOT, "independent-review.json"),
    datasetRoot: values.get("dataset-root") ?? DEFAULT_DATASET_ROOT,
    materialEffectPercentagePoints,
    orderSeed,
  };
}

// Zero-write readiness mirrors the live CLI's comparator freeze: the plan it
// prints must hash the same summary protocol the live run will bind.
function resolveReadinessComparatorOptions(
  values: ReadonlyMap<string, string>,
): {
  baselineArm?: C5BaselineArm;
  comparator?: {
    summaryEndpointSha256: string;
    summaryModel: string;
    summaryPromptSha256: string;
  };
} {
  const baselineArmValue = values.get("baseline-arm");
  if (
    baselineArmValue !== undefined &&
    baselineArmValue !== "no-memory" &&
    baselineArmValue !== "flat-summary"
  ) {
    throw new Error("--baseline-arm must be no-memory or flat-summary");
  }
  const baselineArm = baselineArmValue as C5BaselineArm | undefined;
  const summaryModel = values.get("summary-model");
  const summaryPromptPath = values.get("summary-prompt");
  const summaryEndpoint = values.get("summary-endpoint") ??
    C6_GURKIAI_FLAT_SUMMARY_ENDPOINT;
  if (baselineArm !== "flat-summary") {
    if (
      summaryModel !== undefined ||
      summaryPromptPath !== undefined ||
      values.has("summary-endpoint")
    ) {
      throw new Error("summary flags require --baseline-arm flat-summary");
    }
    return baselineArm === undefined ? {} : { baselineArm };
  }
  if (summaryModel === undefined) {
    throw new Error("--summary-model is required for the flat-summary baseline");
  }
  if (summaryPromptPath === undefined) {
    throw new Error("--summary-prompt is required for the flat-summary baseline");
  }
  const summaryPrompt = readFileSync(summaryPromptPath, "utf8");
  if (summaryPrompt.trim().length === 0) {
    throw new Error("--summary-prompt must point to a non-empty prompt file");
  }
  const digest = (value: string) =>
    createHash("sha256").update(value).digest("hex");
  return {
    baselineArm,
    comparator: {
      summaryEndpointSha256: digest(summaryEndpoint),
      summaryModel,
      summaryPromptSha256: digest(summaryPrompt),
    },
  };
}

export function runC5ReadinessCommand(
  args: readonly string[],
  load: (
    input: C5PilotReadinessInput,
  ) => Promise<C5PilotReadinessResult> = loadC5PilotReadiness,
): Promise<C5PilotReadinessResult> {
  return load(parseC5ReadinessOptions(args));
}

if (import.meta.main) {
  try {
    const result = await runC5ReadinessCommand(process.argv.slice(2));
    process.stdout.write(result.planBytes);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
