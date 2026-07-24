import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  LOCOMO_QA_CATEGORIES,
  locomoTokenF1,
  scoreLocomoAnswer,
} from "../src/eval/locomo";
import type { LocomoQaCategory } from "../src/eval/locomo";
import { extractFinalAnswer } from "../src/eval/protocol-reader/evidencePack";
import {
  assertCliPathSegmentValue,
  hasCliFlagStrict,
  parseCliPositiveIntegerFlagStrict,
  resolveCliFlagValueStrict,
  resolveCliPathSegmentFlagValueStrict,
} from "./cli-options";
import {
  LOCOMO_REANSWER_JOB_BUCKETS,
  LOCOMO_REANSWER_JOB_BUCKET_SET,
} from "./locomo-reanswer-contracts";
import type { LocomoReanswerJobBucket } from "./locomo-reanswer-contracts";
import {
  createUnionLiveAnswerGenerator,
  LOCOMO_UNION_LIVE_ANSWER_SYSTEM_ID,
} from "./measure-locomo-union-live";
import {
  assertLocomoReportHasCompleteLiveAnswers,
  assertLocomoReportQuestionCountMatchesCases,
} from "./locomo-report-compatibility";
import {
  buildLocomoEvidencePackContext,
  createLocomoLiveAnswerGenerator,
  loadLocomoCases,
  LOCOMO_LIVE_ANSWER_SYSTEM_ID,
  LOCOMO_LIVE_REQUEST_TIMEOUT_MS,
  LOCOMO_SMOKE_REPORT_FILE_NAME,
  overallLocomoEvidenceRecall,
  resolveLocomoQuestionIds,
  summarizeLocomoRetrieval,
  type LocomoAnswerGenerator,
  type LocomoSmokeReport,
} from "./run-phase-65-locomo-smoke";

const GENERATED_BY = "scripts/reanswer-phase-65-locomo-report.ts";
const DEFAULT_OUTPUT_DIR = join(
  process.cwd(),
  "reports",
  "eval",
  "research",
  "phase-65",
  "locomo",
);
const REANSWER_MAX_ATTEMPTS = 3;
const REANSWER_RETRY_DELAYS_MS = [1000, 4000] as const;
const LOCOMO_REANSWER_JOB_CATEGORY_SET: ReadonlySet<string> = new Set(
  LOCOMO_QA_CATEGORIES,
);

export type LocomoReanswerAnswerProfile = "temporal-bounded-v3";

export interface LocomoReanswerCliOptions {
  allowCommonsenseResolution: boolean;
  answerProfile?: LocomoReanswerAnswerProfile;
  chainOfNote?: boolean;
  concurrency?: number;
  goldEvidenceOnlyContext?: boolean;
  maxEvidenceTurns?: number;
  outputDir?: string;
  questionIdFile?: string;
  questionIds?: string[];
  reanswerJobBuckets?: LocomoReanswerJobBucket[];
  reanswerJobCategories?: LocomoQaCategory[];
  retainUnselected?: boolean;
  runId?: string;
  sourceReportPath: string;
  strictNoEvidenceAbstention: boolean;
}

function parseLocomoReanswerAnswerProfile(
  argv: readonly string[],
): LocomoReanswerAnswerProfile | undefined {
  const value = resolveCliFlagValueStrict(argv, "--answer-profile");
  if (value === undefined || value === "temporal-bounded-v3") {
    return value;
  }
  throw new Error(
    "--answer-profile must be temporal-bounded-v3 when provided.",
  );
}

export interface LocomoReanswerDependencies {
  answerGenerator?: LocomoAnswerGenerator;
  mkdir?: typeof mkdir;
  now?: () => Date;
  onProgress?: (progress: { completed: number; total: number }) => void;
  readFile?: (path: string) => Promise<string>;
  sleep?: (ms: number) => Promise<void>;
  writeFile?: (path: string, data: string) => Promise<void>;
}

function parseStringListFlag(
  argv: readonly string[],
  flagName: string,
): string[] | undefined {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== flagName) {
      continue;
    }
    const raw = argv[index + 1];
    if (!raw || raw.startsWith("--")) {
      throw new Error(`${flagName} requires a value.`);
    }
    const parts = raw.split(",");
    for (const value of parts) {
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        throw new Error(`${flagName} contains an empty value.`);
      }
      if (trimmed !== value) {
        throw new Error(
          `${flagName} contains a value with leading or trailing whitespace.`,
        );
      }
      values.push(trimmed);
    }
    index += 1;
  }
  return values.length === 0 ? undefined : values;
}

function parseReanswerJobBuckets(
  argv: readonly string[],
): LocomoReanswerJobBucket[] | undefined {
  const values = parseStringListFlag(argv, "--reanswer-job-bucket");
  if (values === undefined) {
    return undefined;
  }
  const buckets: LocomoReanswerJobBucket[] = [];
  const seen = new Set<LocomoReanswerJobBucket>();
  for (const value of values) {
    if (!LOCOMO_REANSWER_JOB_BUCKET_SET.has(value)) {
      throw new Error(
        "--reanswer-job-bucket must be one of: " +
          LOCOMO_REANSWER_JOB_BUCKETS.join(", "),
      );
    }
    const bucket = value as LocomoReanswerJobBucket;
    if (seen.has(bucket)) {
      throw new Error(`--reanswer-job-bucket contains duplicate value ${bucket}.`);
    }
    buckets.push(bucket);
    seen.add(bucket);
  }
  return buckets;
}

function parseReanswerJobCategories(
  argv: readonly string[],
): LocomoQaCategory[] | undefined {
  const values = parseStringListFlag(argv, "--reanswer-job-category");
  if (values === undefined) {
    return undefined;
  }
  const categories: LocomoQaCategory[] = [];
  const seen = new Set<LocomoQaCategory>();
  for (const value of values) {
    if (!LOCOMO_REANSWER_JOB_CATEGORY_SET.has(value)) {
      throw new Error(
        "--reanswer-job-category must be one of: " +
          LOCOMO_QA_CATEGORIES.join(", "),
      );
    }
    const category = value as LocomoQaCategory;
    if (seen.has(category)) {
      throw new Error(
        `--reanswer-job-category contains duplicate value ${category}.`,
      );
    }
    categories.push(category);
    seen.add(category);
  }
  return categories;
}

export function parseLocomoReanswerCliOptions(
  argv: readonly string[],
): LocomoReanswerCliOptions {
  const sourceReportPath = resolveCliFlagValueStrict(argv, "--source-report");
  if (sourceReportPath === undefined) {
    throw new Error("--source-report is required.");
  }
  const answerProfile = parseLocomoReanswerAnswerProfile(argv);
  const chainOfNote = hasCliFlagStrict(argv, "--chain-of-note");
  if (chainOfNote && answerProfile === "temporal-bounded-v3") {
    // The union profile's answer system is a frozen artifact; layering the
    // note protocol onto it would silently change what that profile measures.
    throw new Error(
      "--chain-of-note cannot be combined with --answer-profile temporal-bounded-v3.",
    );
  }
  const options: LocomoReanswerCliOptions = {
    allowCommonsenseResolution: hasCliFlagStrict(
      argv,
      "--allow-commonsense-resolution",
    ),
    chainOfNote,
    concurrency: parseCliPositiveIntegerFlagStrict(argv, "--concurrency") ?? 1,
    goldEvidenceOnlyContext: hasCliFlagStrict(
      argv,
      "--gold-evidence-only-context",
    ),
    maxEvidenceTurns: parseCliPositiveIntegerFlagStrict(
      argv,
      "--max-evidence-turns",
    ),
    outputDir: resolveCliFlagValueStrict(argv, "--output-dir"),
    questionIdFile: resolveCliFlagValueStrict(argv, "--question-id-file"),
    questionIds: parseStringListFlag(argv, "--question-id"),
    retainUnselected: hasCliFlagStrict(argv, "--retain-unselected"),
    runId: resolveCliPathSegmentFlagValueStrict(argv, "--run-id"),
    sourceReportPath,
    strictNoEvidenceAbstention: hasCliFlagStrict(
      argv,
      "--strict-no-evidence-abstention",
    ),
  };
  if (answerProfile !== undefined) {
    options.answerProfile = answerProfile;
  }
  const reanswerJobBuckets = parseReanswerJobBuckets(argv);
  if (reanswerJobBuckets !== undefined) {
    options.reanswerJobBuckets = reanswerJobBuckets;
  }
  const reanswerJobCategories = parseReanswerJobCategories(argv);
  if (reanswerJobCategories !== undefined) {
    options.reanswerJobCategories = reanswerJobCategories;
  }
  return options;
}

function assertLocomoSmokeReport(
  value: unknown,
  path: string,
): asserts value is LocomoSmokeReport {
  if (
    value === null ||
    typeof value !== "object" ||
    (value as { benchmark?: unknown }).benchmark !== "locomo" ||
    !Array.isArray((value as { cases?: unknown }).cases)
  ) {
    throw new Error(`Invalid LoCoMo smoke report: ${path}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function appendUnique<T extends string>(target: T[], value: T): void {
  if (!target.includes(value)) {
    target.push(value);
  }
}

function assertUniqueQuestionIds(input: {
  label: string;
  questionIds?: readonly string[];
}): void {
  if (input.questionIds === undefined) {
    return;
  }
  if (input.questionIds.length === 0) {
    throw new Error(
      `LoCoMo reanswer ${input.label} must contain at least one question id.`,
    );
  }
  const seen = new Set<string>();
  for (const questionId of input.questionIds) {
    if (questionId.trim().length === 0) {
      throw new Error(`LoCoMo reanswer ${input.label} contains empty question id.`);
    }
    if (questionId.trim() !== questionId) {
      throw new Error(
        `LoCoMo reanswer ${input.label} contains leading or ` +
          "trailing whitespace.",
      );
    }
    if (seen.has(questionId)) {
      throw new Error(
        `LoCoMo reanswer ${input.label} contains duplicate ` +
          `question id ${questionId}.`,
      );
    }
    seen.add(questionId);
  }
}

function assertLocomoReanswerRunIdShape(runId: string): void {
  if (runId.trim().length === 0) {
    throw new Error("LoCoMo reanswer runId must not be empty.");
  }
  if (runId.trim() !== runId) {
    throw new Error(
      "LoCoMo reanswer runId must not have leading or trailing whitespace.",
    );
  }
  assertCliPathSegmentValue({
    flag: "LoCoMo reanswer runId",
    value: runId,
  });
}

function resolveLocomoReanswerOutputReportPath(input: {
  outputDir?: string;
  runId: string;
}): string {
  return join(
    input.outputDir ?? DEFAULT_OUTPUT_DIR,
    input.runId,
    LOCOMO_SMOKE_REPORT_FILE_NAME,
  );
}

function assertLocomoReanswerOutputIsNotSourceReport(input: {
  outputReportPath: string;
  sourceReportPath: string;
}): void {
  if (resolve(input.outputReportPath) === resolve(input.sourceReportPath)) {
    throw new Error(
      `LoCoMo reanswer output smoke report path ${input.outputReportPath} ` +
        "must not resolve to the source report path.",
    );
  }
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function reanswerJobQuestionIds(input: {
  job: Record<string, unknown>;
  manifestPath: string;
}): string[] {
  if (!Array.isArray(input.job.questionIds)) {
    throw new Error(
      `LoCoMo reanswer manifest ${input.manifestPath} reanswer job ` +
        "questionIds must be an array.",
    );
  }
  const questionIds: string[] = [];
  const seenQuestionIds = new Set<string>();
  for (const [index, questionId] of input.job.questionIds.entries()) {
    if (typeof questionId !== "string") {
      throw new Error(
        `LoCoMo reanswer manifest ${input.manifestPath} reanswer job ` +
          `questionIds contains non-string value at index ${index}.`,
      );
    }
    const trimmedQuestionId = questionId.trim();
    if (trimmedQuestionId.length === 0) {
      throw new Error(
        `LoCoMo reanswer manifest ${input.manifestPath} reanswer job ` +
          `questionIds contains empty string at index ${index}.`,
      );
    }
    if (trimmedQuestionId !== questionId) {
      throw new Error(
        `LoCoMo reanswer manifest ${input.manifestPath} reanswer job ` +
          "questionIds contains leading or trailing whitespace at index " +
          `${index}.`,
      );
    }
    if (seenQuestionIds.has(questionId)) {
      throw new Error(
        `LoCoMo reanswer manifest ${input.manifestPath} reanswer job ` +
          `questionIds contains duplicate question id ${questionId}.`,
      );
    }
    questionIds.push(questionId);
    seenQuestionIds.add(questionId);
  }
  if (questionIds.length === 0) {
    throw new Error(
      `LoCoMo reanswer manifest ${input.manifestPath} reanswer job ` +
        "questionIds is empty.",
    );
  }
  return questionIds;
}

function reanswerJobMatchesCategories(
  job: Record<string, unknown>,
  selectedCategories: ReadonlySet<LocomoQaCategory> | null,
): boolean {
  if (selectedCategories === null) {
    return true;
  }
  const jobCategories = stringArray(job.categories);
  if (typeof job.category === "string") {
    appendUnique(jobCategories, job.category);
  }
  return jobCategories.some((category) =>
    selectedCategories.has(category as LocomoQaCategory),
  );
}

function reanswerJobMatchesBuckets(
  job: Record<string, unknown>,
  selectedBuckets: ReadonlySet<LocomoReanswerJobBucket> | null,
): boolean {
  if (selectedBuckets === null) {
    return true;
  }
  return (
    typeof job.bucket === "string" &&
    selectedBuckets.has(job.bucket as LocomoReanswerJobBucket)
  );
}

function assertReanswerJobSelectionFieldTypes(input: {
  job: Record<string, unknown>;
  manifestPath: string;
}): void {
  if (
    Object.prototype.hasOwnProperty.call(input.job, "bucket") &&
    typeof input.job.bucket !== "string"
  ) {
    throw new Error(
      `LoCoMo reanswer manifest ${input.manifestPath} reanswer job ` +
        "bucket must be a string.",
    );
  }
  if (
    typeof input.job.bucket === "string" &&
    !LOCOMO_REANSWER_JOB_BUCKET_SET.has(input.job.bucket)
  ) {
    throw new Error(
      `LoCoMo reanswer manifest ${input.manifestPath} reanswer job ` +
        `bucket ${input.job.bucket} is not recognized.`,
    );
  }
  if (
    Object.prototype.hasOwnProperty.call(input.job, "category") &&
    typeof input.job.category !== "string"
  ) {
    throw new Error(
      `LoCoMo reanswer manifest ${input.manifestPath} reanswer job ` +
        "category must be a string.",
    );
  }
  if (
    typeof input.job.category === "string" &&
    !LOCOMO_REANSWER_JOB_CATEGORY_SET.has(input.job.category)
  ) {
    throw new Error(
      `LoCoMo reanswer manifest ${input.manifestPath} reanswer job ` +
        `category ${input.job.category} is not recognized.`,
    );
  }
  if (
    Object.prototype.hasOwnProperty.call(input.job, "categories") &&
    !Array.isArray(input.job.categories)
  ) {
    throw new Error(
      `LoCoMo reanswer manifest ${input.manifestPath} reanswer job ` +
        "categories must be an array.",
    );
  }
  if (Array.isArray(input.job.categories)) {
    const seenCategories = new Set<string>();
    for (const [index, category] of input.job.categories.entries()) {
      if (typeof category !== "string") {
        throw new Error(
          `LoCoMo reanswer manifest ${input.manifestPath} reanswer job ` +
            `categories contains non-string value at index ${index}.`,
        );
      }
      if (!LOCOMO_REANSWER_JOB_CATEGORY_SET.has(category)) {
        throw new Error(
          `LoCoMo reanswer manifest ${input.manifestPath} reanswer job ` +
            `categories value ${category} at index ${index} is not recognized.`,
        );
      }
      if (seenCategories.has(category)) {
        throw new Error(
          `LoCoMo reanswer manifest ${input.manifestPath} reanswer job ` +
            `categories contains duplicate value ${category}.`,
        );
      }
      seenCategories.add(category);
    }
    if (
      typeof input.job.category === "string" &&
      (input.job.categories.length !== 1 ||
        input.job.categories[0] !== input.job.category)
    ) {
      throw new Error(
        `LoCoMo reanswer manifest ${input.manifestPath} reanswer job ` +
          `category ${input.job.category} does not match categories ` +
          `[${input.job.categories.join(", ")}].`,
      );
    }
  }
}

function assertReanswerJobSourceProvenanceFieldTypes(input: {
  job: Record<string, unknown>;
  manifestPath: string;
}): void {
  if (
    Object.prototype.hasOwnProperty.call(input.job, "sourceRunId") &&
    typeof input.job.sourceRunId !== "string"
  ) {
    throw new Error(
      `LoCoMo reanswer manifest ${input.manifestPath} reanswer job ` +
        "sourceRunId must be a string.",
    );
  }
  if (
    typeof input.job.sourceRunId === "string" &&
    input.job.sourceRunId.trim().length === 0
  ) {
    throw new Error(
      `LoCoMo reanswer manifest ${input.manifestPath} reanswer job ` +
        "sourceRunId must not be empty.",
    );
  }
  if (
    typeof input.job.sourceRunId === "string" &&
    input.job.sourceRunId.trim() !== input.job.sourceRunId
  ) {
    throw new Error(
      `LoCoMo reanswer manifest ${input.manifestPath} reanswer job ` +
        "sourceRunId must not have leading or trailing whitespace.",
    );
  }
  if (
    Object.prototype.hasOwnProperty.call(input.job, "sourceReportPath") &&
    typeof input.job.sourceReportPath !== "string"
  ) {
    throw new Error(
      `LoCoMo reanswer manifest ${input.manifestPath} reanswer job ` +
        "sourceReportPath must be a string.",
    );
  }
  if (
    typeof input.job.sourceReportPath === "string" &&
    input.job.sourceReportPath.trim().length === 0
  ) {
    throw new Error(
      `LoCoMo reanswer manifest ${input.manifestPath} reanswer job ` +
        "sourceReportPath must not be empty.",
    );
  }
  if (
    typeof input.job.sourceReportPath === "string" &&
    input.job.sourceReportPath.trim() !== input.job.sourceReportPath
  ) {
    throw new Error(
      `LoCoMo reanswer manifest ${input.manifestPath} reanswer job ` +
        "sourceReportPath must not have leading or trailing whitespace.",
    );
  }
}

interface ReanswerSourceFilter {
  reportPath: string;
  runId: string;
}

function reanswerJobMatchesSourceFilter(
  job: Record<string, unknown>,
  sourceFilter: ReanswerSourceFilter | null,
): boolean {
  if (sourceFilter === null) {
    return true;
  }
  const jobRunId =
    typeof job.sourceRunId === "string" ? job.sourceRunId : null;
  const jobReportPath =
    typeof job.sourceReportPath === "string" ? job.sourceReportPath : null;
  if (jobRunId === null && jobReportPath === null) {
    return true;
  }
  return (
    jobRunId === sourceFilter.runId ||
    (jobReportPath !== null &&
      normalizeSourceReportPath(jobReportPath) ===
        normalizeSourceReportPath(sourceFilter.reportPath))
  );
}

function selectedReanswerJobs(input: {
  buckets?: readonly LocomoReanswerJobBucket[];
  categories?: readonly LocomoQaCategory[];
  manifest: Record<string, unknown>;
  manifestPath?: string;
  sourceFilter?: ReanswerSourceFilter;
}): Record<string, unknown>[] {
  if (!Array.isArray(input.manifest.reanswerJobs)) {
    return [];
  }
  const selectedBuckets =
    input.buckets === undefined ? null : new Set(input.buckets);
  const selectedCategories =
    input.categories === undefined ? null : new Set(input.categories);
  const sourceFilter = input.sourceFilter ?? null;
  const selectedJobs: Record<string, unknown>[] = [];
  for (const [index, job] of input.manifest.reanswerJobs.entries()) {
    if (!isRecord(job)) {
      throw new Error(
        `LoCoMo reanswer manifest ${input.manifestPath ?? "(unknown)"} ` +
          `reanswerJobs entry at index ${index} must be an object.`,
      );
    }
    assertReanswerJobSelectionFieldTypes({
      job,
      manifestPath: input.manifestPath ?? "(unknown)",
    });
    assertReanswerJobSourceProvenanceFieldTypes({
      job,
      manifestPath: input.manifestPath ?? "(unknown)",
    });
    if (
      reanswerJobMatchesBuckets(job, selectedBuckets) &&
      reanswerJobMatchesCategories(job, selectedCategories) &&
      reanswerJobMatchesSourceFilter(job, sourceFilter)
    ) {
      selectedJobs.push(job);
    }
  }
  return selectedJobs;
}

function reanswerJobQuestionIdsForFilters(input: {
  buckets?: readonly LocomoReanswerJobBucket[];
  categories?: readonly LocomoQaCategory[];
  manifestContents: string;
  manifestPath: string;
  sourceFilter?: ReanswerSourceFilter;
}): string[] {
  const parsed = JSON.parse(input.manifestContents) as unknown;
  if (!isRecord(parsed) || !Array.isArray(parsed.reanswerJobs)) {
    throw new Error(
      `LoCoMo reanswer manifest ${input.manifestPath} did not contain reanswerJobs.`,
    );
  }
  const selectedQuestionIds: string[] = [];
  for (const job of selectedReanswerJobs({
    buckets: input.buckets,
    categories: input.categories,
    manifest: parsed,
    manifestPath: input.manifestPath,
    sourceFilter: input.sourceFilter,
  })) {
    for (const questionId of reanswerJobQuestionIds({
      job,
      manifestPath: input.manifestPath,
    })) {
      appendUnique(selectedQuestionIds, questionId);
    }
  }
  if (selectedQuestionIds.length === 0) {
    const selectedFilters = [
      input.buckets === undefined
        ? null
        : `bucket(s): ${input.buckets.join(", ")}`,
      input.categories === undefined
        ? null
        : `category(s): ${input.categories.join(", ")}`,
      input.sourceFilter === undefined
        ? null
        : `source report: ${input.sourceFilter.runId} ` +
          `(${input.sourceFilter.reportPath})`,
    ].filter((filter): filter is string => filter !== null);
    throw new Error(
      `LoCoMo reanswer manifest ${input.manifestPath} did not contain ` +
        `reanswerJobs for ${selectedFilters.join(" and ")}.`,
    );
  }
  return selectedQuestionIds;
}

function assertSelectedReanswerJobQuestionCounts(input: {
  buckets?: readonly LocomoReanswerJobBucket[];
  categories?: readonly LocomoQaCategory[];
  manifestContents: string;
  manifestPath: string;
  sourceFilter?: ReanswerSourceFilter;
}): void {
  const parsed = JSON.parse(input.manifestContents) as unknown;
  if (!isRecord(parsed) || !Array.isArray(parsed.reanswerJobs)) {
    return;
  }
  const selectedQuestionIds = new Set<string>();
  for (const job of selectedReanswerJobs({
    buckets: input.buckets,
    categories: input.categories,
    manifest: parsed,
    manifestPath: input.manifestPath,
    sourceFilter: input.sourceFilter,
  })) {
    const questionIds = reanswerJobQuestionIds({
      job,
      manifestPath: input.manifestPath,
    });
    if (
      typeof job.sourceRunId !== "string" &&
      typeof job.sourceReportPath !== "string"
    ) {
      throw new Error(
        `LoCoMo reanswer manifest ${input.manifestPath} selected reanswer ` +
          `job for ${questionIds.join(", ")} does not declare sourceRunId ` +
          "or sourceReportPath.",
      );
    }
    for (const questionId of questionIds) {
      if (selectedQuestionIds.has(questionId)) {
        throw new Error(
          `LoCoMo reanswer manifest ${input.manifestPath} selected duplicate ` +
            `question id ${questionId} across reanswerJobs.`,
        );
      }
      selectedQuestionIds.add(questionId);
    }
    if (job.questionCount === undefined) {
      continue;
    }
    if (
      typeof job.questionCount !== "number" ||
      !Number.isInteger(job.questionCount) ||
      job.questionCount < 0
    ) {
      throw new Error(
        `LoCoMo reanswer manifest ${input.manifestPath} has invalid ` +
          `reanswer job questionCount ${String(job.questionCount)}.`,
      );
    }
    if (job.questionCount !== questionIds.length) {
      throw new Error(
        `LoCoMo reanswer manifest ${input.manifestPath} reanswer job ` +
          `questionCount ${job.questionCount} does not match ` +
          `${questionIds.length} questionIds.`,
      );
    }
  }
}

function expectedReanswerSourceProvenance(input: {
  buckets?: readonly LocomoReanswerJobBucket[];
  categories?: readonly LocomoQaCategory[];
  manifestContents: string;
  manifestPath: string;
  sourceFilter?: ReanswerSourceFilter;
}): { reportPaths: string[]; runIds: string[] } {
  const parsed = JSON.parse(input.manifestContents) as unknown;
  if (!isRecord(parsed)) {
    return { reportPaths: [], runIds: [] };
  }
  const runIds: string[] = [];
  const reportPaths: string[] = [];
  const selectedJobs = selectedReanswerJobs({
    buckets: input.buckets,
    categories: input.categories,
    manifest: parsed,
    manifestPath: input.manifestPath,
    sourceFilter: input.sourceFilter,
  });
  for (const job of selectedJobs) {
    if (typeof job.sourceRunId === "string") {
      appendUnique(runIds, job.sourceRunId);
    }
    if (typeof job.sourceReportPath === "string") {
      appendUnique(reportPaths, job.sourceReportPath);
    }
  }
  if (
    Array.isArray(parsed.reanswerJobs) &&
    Object.prototype.hasOwnProperty.call(parsed, "sourceReports") &&
    !Array.isArray(parsed.sourceReports)
  ) {
    throw new Error(
      `LoCoMo reanswer manifest ${input.manifestPath} sourceReports ` +
        "must be an array.",
    );
  }
  if (Array.isArray(parsed.reanswerJobs) && Array.isArray(parsed.sourceReports)) {
    const selectedRunIds = new Set(runIds);
    const selectedReportPaths = new Set(reportPaths.map(normalizeSourceReportPath));
    const hasSelectedJobProvenance =
      selectedRunIds.size > 0 || selectedReportPaths.size > 0;
    const matchedSourceReportLineage = new Set<string>();
    for (const [index, sourceReport] of parsed.sourceReports.entries()) {
      if (!isRecord(sourceReport)) {
        throw new Error(
          `LoCoMo reanswer manifest ${input.manifestPath} sourceReports ` +
            `entry at index ${index} must be an object.`,
        );
      }
      const runId =
        typeof sourceReport.runId === "string" ? sourceReport.runId : null;
      if (
        Object.prototype.hasOwnProperty.call(sourceReport, "runId") &&
        runId === null
      ) {
        throw new Error(
          `LoCoMo reanswer manifest ${input.manifestPath} sourceReports ` +
            `entry at index ${index} runId must be a string.`,
        );
      }
      if (runId !== null && runId.trim().length === 0) {
        throw new Error(
          `LoCoMo reanswer manifest ${input.manifestPath} sourceReports ` +
            `entry at index ${index} runId must not be empty.`,
        );
      }
      if (runId !== null && runId.trim() !== runId) {
        throw new Error(
          `LoCoMo reanswer manifest ${input.manifestPath} sourceReports ` +
            `entry at index ${index} runId must not have leading or trailing whitespace.`,
        );
      }
      const reportPath =
        typeof sourceReport.path === "string" ? sourceReport.path : null;
      if (
        Object.prototype.hasOwnProperty.call(sourceReport, "path") &&
        reportPath === null
      ) {
        throw new Error(
          `LoCoMo reanswer manifest ${input.manifestPath} sourceReports ` +
            `entry at index ${index} path must be a string.`,
        );
      }
      if (reportPath !== null && reportPath.trim().length === 0) {
        throw new Error(
          `LoCoMo reanswer manifest ${input.manifestPath} sourceReports ` +
            `entry at index ${index} path must not be empty.`,
        );
      }
      if (reportPath !== null && reportPath.trim() !== reportPath) {
        throw new Error(
          `LoCoMo reanswer manifest ${input.manifestPath} sourceReports ` +
            `entry at index ${index} path must not have leading or trailing whitespace.`,
        );
      }
      if (runId === null && reportPath === null) {
        throw new Error(
          `LoCoMo reanswer manifest ${input.manifestPath} sourceReports ` +
            `entry at index ${index} must declare runId or path.`,
        );
      }
      const matchesSelectedJob =
        !hasSelectedJobProvenance ||
        (runId !== null && selectedRunIds.has(runId)) ||
        (reportPath !== null &&
          selectedReportPaths.has(normalizeSourceReportPath(reportPath)));
      if (!matchesSelectedJob) {
        continue;
      }
      const normalizedReportPath =
        reportPath === null ? null : normalizeSourceReportPath(reportPath);
      if (runId !== null || normalizedReportPath !== null) {
        const lineageKey = `${runId ?? ""}\u0000${normalizedReportPath ?? ""}`;
        if (matchedSourceReportLineage.has(lineageKey)) {
          const duplicateLabel =
            runId !== null ? `runId ${runId}` : `path ${reportPath}`;
          throw new Error(
            `LoCoMo reanswer manifest ${input.manifestPath} sourceReports ` +
              `contains duplicate ${duplicateLabel}.`,
          );
        }
        matchedSourceReportLineage.add(lineageKey);
      }
      if (runId !== null) {
        appendUnique(runIds, runId);
      }
      if (reportPath !== null) {
        appendUnique(reportPaths, reportPath);
      }
    }
  }
  if (
    Array.isArray(parsed.reanswerJobs) &&
    Object.prototype.hasOwnProperty.call(parsed, "candidateReport") &&
    !isRecord(parsed.candidateReport)
  ) {
    throw new Error(
      `LoCoMo reanswer manifest ${input.manifestPath} candidateReport ` +
        "must be an object.",
    );
  }
  if (Array.isArray(parsed.reanswerJobs) && isRecord(parsed.candidateReport)) {
    const candidateRunId = parsed.candidateReport.runId;
    if (
      Object.prototype.hasOwnProperty.call(parsed.candidateReport, "runId") &&
      typeof candidateRunId !== "string"
    ) {
      throw new Error(
        `LoCoMo reanswer manifest ${input.manifestPath} candidateReport.runId ` +
          "must be a string.",
      );
    }
    if (typeof candidateRunId === "string") {
      if (candidateRunId.trim().length === 0) {
        throw new Error(
          `LoCoMo reanswer manifest ${input.manifestPath} ` +
            "candidateReport.runId must not be empty.",
        );
      }
      if (candidateRunId.trim() !== candidateRunId) {
        throw new Error(
          `LoCoMo reanswer manifest ${input.manifestPath} ` +
            "candidateReport.runId must not have leading or trailing whitespace.",
        );
      }
      appendUnique(runIds, candidateRunId);
    }
    const candidatePath = parsed.candidateReport.path;
    if (
      Object.prototype.hasOwnProperty.call(parsed.candidateReport, "path") &&
      typeof candidatePath !== "string"
    ) {
      throw new Error(
        `LoCoMo reanswer manifest ${input.manifestPath} candidateReport.path ` +
          "must be a string.",
      );
    }
    if (typeof candidatePath === "string") {
      if (candidatePath.trim().length === 0) {
        throw new Error(
          `LoCoMo reanswer manifest ${input.manifestPath} ` +
            "candidateReport.path must not be empty.",
        );
      }
      if (candidatePath.trim() !== candidatePath) {
        throw new Error(
          `LoCoMo reanswer manifest ${input.manifestPath} ` +
            "candidateReport.path must not have leading or trailing whitespace.",
        );
      }
      appendUnique(reportPaths, candidatePath);
    }
    if (
      typeof candidateRunId !== "string" &&
      typeof candidatePath !== "string"
    ) {
      throw new Error(
        `LoCoMo reanswer manifest ${input.manifestPath} ` +
          "candidateReport must declare runId or path.",
      );
    }
  }
  return { reportPaths, runIds };
}

function normalizeSourceReportPath(path: string): string {
  return resolve(path);
}

function assertReanswerManifestMatchesSource(input: {
  buckets?: readonly LocomoReanswerJobBucket[];
  categories?: readonly LocomoQaCategory[];
  manifestContents: string;
  manifestPath: string;
  sourceFilter?: ReanswerSourceFilter;
  sourceReport: LocomoSmokeReport;
  sourceReportPath: string;
}): void {
  let expectedRunIds: string[];
  let expectedReportPaths: string[];
  try {
    const expected = expectedReanswerSourceProvenance({
      buckets: input.buckets,
      categories: input.categories,
      manifestContents: input.manifestContents,
      manifestPath: input.manifestPath,
      sourceFilter: input.sourceFilter,
    });
    expectedRunIds = expected.runIds;
    expectedReportPaths = expected.reportPaths;
  } catch (error: unknown) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
    return;
  }
  expectedRunIds = expectedRunIds.filter(
    (runId) => runId !== input.sourceReport.runId,
  );
  if (expectedRunIds.length > 0) {
    throw new Error(
      `LoCoMo reanswer manifest ${input.manifestPath} targets source run(s) ` +
        `${expectedRunIds.join(", ")} but --source-report is ` +
        `${input.sourceReport.runId} (${input.sourceReportPath}).`,
    );
  }

  const normalizedSourcePath = normalizeSourceReportPath(input.sourceReportPath);
  expectedReportPaths = expectedReportPaths.filter(
    (reportPath) => normalizeSourceReportPath(reportPath) !== normalizedSourcePath,
  );
  if (expectedReportPaths.length > 0) {
    throw new Error(
      `LoCoMo reanswer manifest ${input.manifestPath} targets source report path(s) ` +
        `${expectedReportPaths.join(", ")} but --source-report is ` +
        `${input.sourceReportPath}.`,
    );
  }
}

function selectedSourceResults(input: {
  questionIds?: readonly string[];
  sourceReport: LocomoSmokeReport;
}): LocomoSmokeReport["cases"] {
  if (input.questionIds === undefined || input.questionIds.length === 0) {
    return input.sourceReport.cases;
  }
  const requested = new Set(input.questionIds);
  const selected = input.sourceReport.cases.filter((result) =>
    requested.has(result.questionId),
  );
  const selectedQuestionCaseById = new Map<string, string>();
  for (const result of selected) {
    const firstCaseId = selectedQuestionCaseById.get(result.questionId);
    if (firstCaseId !== undefined) {
      throw new Error(
        `LoCoMo source report question id ${result.questionId} matched ` +
          `multiple cases: ${firstCaseId} and ${result.caseId}.`,
      );
    }
    selectedQuestionCaseById.set(result.questionId, result.caseId);
  }
  const found = new Set(selected.map((result) => result.questionId));
  const missing = input.questionIds.filter((questionId) => !found.has(questionId));
  if (missing.length > 0) {
    throw new Error(
      `LoCoMo source report question id(s) not found: ${missing.join(", ")}`,
    );
  }
  return selected;
}

function locomoQuestionKey(caseId: string, questionId: string): string {
  return `${caseId}::${questionId}`;
}

function selectedQuestionCategories(input: {
  reanswerJobCategories?: readonly LocomoQaCategory[];
  results: readonly LocomoSmokeReport["cases"][number][];
  sourceQuestionCategories: LocomoSmokeReport["questionCategories"];
}): LocomoSmokeReport["questionCategories"] {
  if (
    input.sourceQuestionCategories === null &&
    input.reanswerJobCategories === undefined
  ) {
    return null;
  }
  const categories: LocomoQaCategory[] = [];
  for (const result of input.results) {
    appendUnique(categories, result.category);
  }
  return categories.length === 0 ? null : categories;
}

function assertSelectedResultsMatchReanswerCategories(input: {
  reanswerJobCategories?: readonly LocomoQaCategory[];
  results: readonly LocomoSmokeReport["cases"][number][];
}): void {
  if (input.reanswerJobCategories === undefined) {
    return;
  }
  const allowedCategories = new Set(input.reanswerJobCategories);
  for (const result of input.results) {
    if (allowedCategories.has(result.category)) {
      continue;
    }
    throw new Error(
      `LoCoMo reanswer selected source row ${result.questionId} ` +
        `category ${result.category} does not match reanswer category ` +
        `filter ${input.reanswerJobCategories.join(", ")}.`,
    );
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function reanswerContextTurnIds(input: {
  goldEvidenceOnlyContext: boolean;
  maxEvidenceTurns?: number;
  retrievedTurnIds: readonly string[];
  evidenceTurnIds: readonly string[];
}): string[] {
  let selected: string[];
  if (input.goldEvidenceOnlyContext) {
    const retrieved = new Set(input.retrievedTurnIds);
    selected = input.evidenceTurnIds.filter((turnId) => retrieved.has(turnId));
  } else {
    selected = [...input.retrievedTurnIds];
  }
  return input.maxEvidenceTurns === undefined
    ? selected
    : selected.slice(0, input.maxEvidenceTurns);
}

export async function runLocomoReportReanswer(
  options: LocomoReanswerCliOptions,
  deps: LocomoReanswerDependencies = {},
): Promise<LocomoSmokeReport> {
  assertUniqueQuestionIds({
    label: "explicit question ids",
    questionIds: options.questionIds,
  });
  if (options.runId !== undefined) {
    assertLocomoReanswerRunIdShape(options.runId);
    assertLocomoReanswerOutputIsNotSourceReport({
      outputReportPath: resolveLocomoReanswerOutputReportPath({
        outputDir: options.outputDir,
        runId: options.runId,
      }),
      sourceReportPath: options.sourceReportPath,
    });
  }
  const readFileImpl = deps.readFile ?? ((path: string) => readFile(path, "utf8"));
  const writeFileImpl = deps.writeFile ?? writeFile;
  const mkdirImpl = deps.mkdir ?? mkdir;
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? defaultSleep;

  const rawReport = JSON.parse(await readFileImpl(options.sourceReportPath)) as unknown;
  assertLocomoSmokeReport(rawReport, options.sourceReportPath);
  if (rawReport.answerContextMode === "gold-evidence-only-pack") {
    throw new Error(
      `Source report ${options.sourceReportPath} answerContextMode ` +
        "gold-evidence-only-pack reports cannot be used as reanswer " +
        "source reports.",
    );
  }
  if (rawReport.generatedBy === GENERATED_BY) {
    throw new Error(
      `Source report ${options.sourceReportPath} was generated by ` +
        "the reanswer runner; reanswer-generated reports cannot be used " +
        "as reanswer source reports.",
    );
  }
  if (options.retainUnselected === true) {
    if (options.maxEvidenceTurns !== undefined) {
      throw new Error(
        "--retain-unselected cannot be combined with --max-evidence-turns.",
      );
    }
    if (options.goldEvidenceOnlyContext === true) {
      throw new Error(
        "--retain-unselected cannot be combined with --gold-evidence-only-context.",
      );
    }
    if (
      rawReport.answerContextMode !== "evidence-pack" &&
      rawReport.answerContextMode !== "packet-evidence-pack"
    ) {
      throw new Error(
        "--retain-unselected requires a source report with answerContextMode evidence-pack or packet-evidence-pack.",
      );
    }
    if (
      (rawReport.allowCommonsenseResolution ?? false) !==
      options.allowCommonsenseResolution
    ) {
      throw new Error(
        "--retain-unselected requires the source and reanswer commonsense policies to match.",
      );
    }
    if (
      (rawReport.strictNoEvidenceAbstention ?? false) !==
      options.strictNoEvidenceAbstention
    ) {
      throw new Error(
        "--retain-unselected requires the source and reanswer abstention policies to match.",
      );
    }
  }
  assertLocomoReportQuestionCountMatchesCases({
    path: options.sourceReportPath,
    report: rawReport,
  });
  if (rawReport.executionFailures > 0) {
    throw new Error(
      `Source report ${options.sourceReportPath} has ` +
        `${rawReport.executionFailures} execution failure(s).`,
    );
  }
  if (rawReport.mode === "live-answer") {
    assertLocomoReportHasCompleteLiveAnswers({
      path: options.sourceReportPath,
      report: rawReport,
    });
  }
  const generatedAt = now();
  if (new Date(rawReport.generatedAt).getTime() >= generatedAt.getTime()) {
    throw new Error(
      `Source report ${options.sourceReportPath} generatedAt ` +
        `${rawReport.generatedAt} is not earlier than reanswer generatedAt ` +
        `${generatedAt.toISOString()}.`,
    );
  }
  const runId = options.runId ?? `${rawReport.runId}-reanswer-current`;
  assertLocomoReanswerRunIdShape(runId);
  if (runId === rawReport.runId) {
    throw new Error(
      `LoCoMo reanswer runId ${runId} must not match source report runId.`,
    );
  }
  const outputDir = options.outputDir ?? DEFAULT_OUTPUT_DIR;
  const runDirectory = join(outputDir, runId);
  const outputReportPath = join(runDirectory, LOCOMO_SMOKE_REPORT_FILE_NAME);
  assertLocomoReanswerOutputIsNotSourceReport({
    outputReportPath,
    sourceReportPath: options.sourceReportPath,
  });
  if (
    options.questionIdFile !== undefined &&
    resolve(options.questionIdFile) === resolve(outputReportPath)
  ) {
    throw new Error(
      `LoCoMo reanswer questionIdFile ${options.questionIdFile} must not ` +
        "resolve to the output smoke report path.",
    );
  }
  if (
    options.questionIdFile !== undefined &&
    resolve(options.questionIdFile) === resolve(options.sourceReportPath)
  ) {
    throw new Error(
      `LoCoMo reanswer questionIdFile ${options.questionIdFile} must not ` +
        "resolve to the source report path.",
    );
  }
  const reanswerJobFiltersRequested =
    options.reanswerJobBuckets !== undefined ||
    options.reanswerJobCategories !== undefined;
  const sourceFilter =
    reanswerJobFiltersRequested
      ? {
          reportPath: options.sourceReportPath,
          runId: rawReport.runId,
        }
      : undefined;
  if (reanswerJobFiltersRequested && options.questionIdFile === undefined) {
    throw new Error(
      "--reanswer-job-bucket or --reanswer-job-category requires --question-id-file.",
    );
  }

  const questionIdFileContents =
    options.questionIdFile === undefined
      ? undefined
      : await readFileImpl(options.questionIdFile);
  if (
    options.questionIdFile !== undefined &&
    questionIdFileContents !== undefined
  ) {
    assertSelectedReanswerJobQuestionCounts({
      buckets: options.reanswerJobBuckets,
      categories: options.reanswerJobCategories,
      manifestContents: questionIdFileContents,
      manifestPath: options.questionIdFile,
      sourceFilter,
    });
    assertReanswerManifestMatchesSource({
      buckets: options.reanswerJobBuckets,
      categories: options.reanswerJobCategories,
      manifestContents: questionIdFileContents,
      manifestPath: options.questionIdFile,
      sourceFilter,
      sourceReport: rawReport,
      sourceReportPath: options.sourceReportPath,
    });
  }
  let questionIds: string[] | undefined;
  if (reanswerJobFiltersRequested) {
    const selectedQuestionIds = [...(options.questionIds ?? [])];
    const explicitQuestionIds = new Set(selectedQuestionIds);
    for (const questionId of reanswerJobQuestionIdsForFilters({
      buckets: options.reanswerJobBuckets,
      categories: options.reanswerJobCategories,
      manifestContents: questionIdFileContents ?? "",
      manifestPath: options.questionIdFile ?? "",
      sourceFilter,
    })) {
      if (explicitQuestionIds.has(questionId)) {
        throw new Error(
          "LoCoMo reanswer explicit question ids overlap filtered " +
            `reanswer job question id ${questionId}.`,
        );
      }
      appendUnique(selectedQuestionIds, questionId);
    }
    questionIds = selectedQuestionIds;
  } else {
    questionIds = await resolveLocomoQuestionIds({
      explicitQuestionIds: options.questionIds,
      preferManifestJobKeys: ["reanswerJobs"],
      questionIdFile: options.questionIdFile,
      questionIdFileContents,
      readFile: readFileImpl,
    });
  }
  const selected = selectedSourceResults({
    questionIds,
    sourceReport: rawReport,
  });
  assertSelectedResultsMatchReanswerCategories({
    reanswerJobCategories: options.reanswerJobCategories,
    results: selected,
  });
  const benchmarkRoot = rawReport.externalRoot ?? undefined;
  const { cases } = await loadLocomoCases({
    benchmarkRoot,
    readFile: readFileImpl,
  });
  const casesById = new Map(cases.map((testCase) => [testCase.caseId, testCase]));
  const sourceByKey = new Map(
    selected.map((result) => [
      locomoQuestionKey(result.caseId, result.questionId),
      result,
    ]),
  );
  const selectedCaseIds = new Set(selected.map((result) => result.caseId));
  const reportQuestionIds =
    questionIds === undefined || questionIds.length === 0
      ? rawReport.questionIds ?? null
      : questionIds;
  const reanswerSelectionExplicitQuestionIds =
    options.questionIds !== undefined
      ? [...options.questionIds]
      : options.questionIdFile === undefined &&
          !reanswerJobFiltersRequested &&
          Array.isArray(reportQuestionIds)
        ? [...reportQuestionIds]
        : null;
  const answerSystem =
    options.answerProfile === "temporal-bounded-v3"
      ? LOCOMO_UNION_LIVE_ANSWER_SYSTEM_ID
      : LOCOMO_LIVE_ANSWER_SYSTEM_ID;
  if (
    options.chainOfNote === true &&
    options.answerProfile === "temporal-bounded-v3"
  ) {
    throw new Error(
      "--chain-of-note cannot be combined with --answer-profile temporal-bounded-v3.",
    );
  }
  const answerGenerator =
    deps.answerGenerator ??
    (options.answerProfile === "temporal-bounded-v3"
      ? createUnionLiveAnswerGenerator(LOCOMO_LIVE_REQUEST_TIMEOUT_MS)
      : createLocomoLiveAnswerGenerator({
          allowCommonsenseResolution: options.allowCommonsenseResolution,
          chainOfNote: options.chainOfNote,
          strictNoEvidenceAbstention: options.strictNoEvidenceAbstention,
        }));
  const concurrency = options.concurrency ?? 1;
  const results: Array<LocomoSmokeReport["cases"][number] | undefined> =
    new Array(selected.length);
  let executionFailures = 0;

  const reanswer = async (
    sourceResult: LocomoSmokeReport["cases"][number],
  ): Promise<LocomoSmokeReport["cases"][number]> => {
    const testCase = casesById.get(sourceResult.caseId);
    const question = testCase?.questions.find(
      (candidate) => candidate.questionId === sourceResult.questionId,
    );
    if (testCase === undefined || question === undefined) {
      throw new Error(
        `Question ${sourceResult.caseId}::${sourceResult.questionId} not found in benchmark root.`,
      );
    }
    let generatedAnswer: string | null = null;
    const contextTurnIds = reanswerContextTurnIds({
      evidenceTurnIds: question.evidenceTurnIds,
      goldEvidenceOnlyContext: options.goldEvidenceOnlyContext ?? false,
      maxEvidenceTurns: options.maxEvidenceTurns,
      retrievedTurnIds: sourceResult.retrievedTurnIds,
    });
    for (let attempt = 0; attempt < REANSWER_MAX_ATTEMPTS; attempt += 1) {
      try {
        const candidateAnswer = await answerGenerator({
          memoryContext: buildLocomoEvidencePackContext({
            chainOfNote: options.chainOfNote,
            question,
            retrievedTurnIds: contextTurnIds,
            testCase,
          }),
          question,
          retrievedTurnIds: contextTurnIds,
          testCase,
        });
        // Chain-of-note responses carry working notes before the marked final
        // answer; score (and record) only the extracted answer.
        const finalAnswer =
          options.chainOfNote === true
            ? extractFinalAnswer(candidateAnswer)
            : candidateAnswer;
        if (finalAnswer.trim().length === 0) {
          throw new Error("empty generated answer");
        }
        generatedAnswer = finalAnswer;
        break;
      } catch {
        const delay = REANSWER_RETRY_DELAYS_MS[attempt];
        if (delay === undefined) {
          executionFailures += 1;
          break;
        }
        await sleep(delay);
      }
    }
    return {
      ...sourceResult,
      answerCorrect:
        generatedAnswer === null
          ? null
          : scoreLocomoAnswer({
              adversarialAnswer: question.adversarialAnswer,
              answer: generatedAnswer,
              goldAnswer: question.goldAnswer,
              matchMode: question.matchMode,
            }),
      answerTokenF1:
        generatedAnswer === null
          ? null
          : locomoTokenF1(generatedAnswer, question.goldAnswer),
      generatedAnswer,
    };
  };
  let cursor = 0;
  let completedCount = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const index = cursor;
      cursor += 1;
      const sourceResult = selected[index];
      if (sourceResult === undefined) {
        return;
      }
      results[index] = await reanswer(sourceResult);
      completedCount += 1;
      deps.onProgress?.({ completed: completedCount, total: selected.length });
      if (
        deps.onProgress === undefined &&
        selected.length >= 50 &&
        (completedCount % 50 === 0 || completedCount === selected.length)
      ) {
        process.stderr.write(
          `LoCoMo reanswer: ${completedCount}/${selected.length} answers completed.\n`,
        );
      }
    }
  };
  await Promise.all(
    Array.from(
      {
        length: Math.max(
          1,
          Math.min(concurrency, selected.length),
        ),
      },
      () => worker(),
    ),
  );
  const completedResults = results.map((result, index) => {
    if (result === undefined) {
      throw new Error(`LoCoMo reanswer result ${index} is missing.`);
    }
    return result;
  });
  const replacements = new Map(
    completedResults.map((result) => [
      locomoQuestionKey(result.caseId, result.questionId),
      result,
    ]),
  );
  const reportResults = options.retainUnselected === true
    ? rawReport.cases.map(
        (result) =>
          replacements.get(locomoQuestionKey(result.caseId, result.questionId)) ??
          result,
      )
    : completedResults;
  const reportCaseIds = options.retainUnselected === true
    ? [...rawReport.caseIds]
    : rawReport.caseIds.filter((caseId) => selectedCaseIds.has(caseId));
  const answeredResults = reportResults.filter(
    (result) => result.answerCorrect !== null,
  );

  const report: LocomoSmokeReport = {
    ...rawReport,
    allowCommonsenseResolution: options.allowCommonsenseResolution,
    strictNoEvidenceAbstention: options.strictNoEvidenceAbstention,
    answerAccuracyOverall:
      answeredResults.length === 0
        ? null
        : answeredResults.filter((result) => result.answerCorrect === true)
            .length / answeredResults.length,
    answerAttempts: REANSWER_MAX_ATTEMPTS,
    answerContextMode: options.goldEvidenceOnlyContext === true
      ? "gold-evidence-only-pack"
      : "evidence-pack",
    answerEvidenceTurnLimit: options.maxEvidenceTurns ?? null,
    chainOfNote: options.chainOfNote === true,
    answerEvaluation: "scored",
    answerSystem:
      deps.answerGenerator === undefined || options.answerProfile !== undefined
        ? answerSystem
        : null,
    answerTimeoutMs:
      deps.answerGenerator === undefined
        ? LOCOMO_LIVE_REQUEST_TIMEOUT_MS
        : null,
    caseCount:
      options.retainUnselected === true
        ? rawReport.caseCount
        : selectedCaseIds.size,
    caseIds: reportCaseIds,
    cases: reportResults,
    categories: summarizeLocomoRetrieval(reportResults),
    concurrency,
    evidenceRecallOverall: overallLocomoEvidenceRecall(reportResults),
    executionFailures,
    generatedAt: generatedAt.toISOString(),
    generatedBy: GENERATED_BY,
    mode: "live-answer",
    questionCategories:
      options.retainUnselected === true
        ? rawReport.questionCategories
        : selectedQuestionCategories({
            reanswerJobCategories: options.reanswerJobCategories,
            results: completedResults,
            sourceQuestionCategories: rawReport.questionCategories,
          }),
    questionCount: reportResults.length,
    questionIds:
      options.retainUnselected === true
        ? rawReport.questionIds ?? null
        : reportQuestionIds,
    questionSelection: undefined,
    reanswerSelection: {
      explicitQuestionIds: reanswerSelectionExplicitQuestionIds,
      questionIdFile: options.questionIdFile ?? null,
      reanswerJobBuckets:
        options.reanswerJobBuckets === undefined
          ? null
          : [...options.reanswerJobBuckets],
      reanswerJobCategories:
        options.reanswerJobCategories === undefined
          ? null
          : [...options.reanswerJobCategories],
    },
    resume: false,
    runDirectory,
    runId,
    sourceReport: {
      answerContextMode: rawReport.answerContextMode ?? null,
      generatedAt: rawReport.generatedAt,
      path: options.sourceReportPath,
      retrievalConfig: {
        bm25Ranking: rawReport.bm25Ranking,
        semanticCandidateEmbeddingSource: rawReport.semanticCandidateEmbeddingSource,
        semanticCandidates: { ...rawReport.semanticCandidates },
      },
      runId: rawReport.runId,
    },
  };

  for (const result of selected) {
    if (!sourceByKey.has(locomoQuestionKey(result.caseId, result.questionId))) {
      throw new Error("internal selected question mismatch");
    }
  }

  await mkdirImpl(runDirectory, { recursive: true });
  await writeFileImpl(
    join(runDirectory, LOCOMO_SMOKE_REPORT_FILE_NAME),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  return report;
}

if (import.meta.main) {
  let parsed: LocomoReanswerCliOptions;
  try {
    parsed = parseLocomoReanswerCliOptions(process.argv);
  } catch (error) {
    process.stderr.write(`LoCoMo reanswer failed: ${String(error)}\n`);
    process.exitCode = 1;
    parsed = undefined as never;
  }
  if (parsed !== undefined) {
    runLocomoReportReanswer(parsed)
      .then((report) => {
        process.stdout.write(
          `${JSON.stringify(
            {
              allowCommonsenseResolution: report.allowCommonsenseResolution,
              strictNoEvidenceAbstention: report.strictNoEvidenceAbstention,
              answerContextMode: report.answerContextMode,
              categories: report.categories,
              executionFailures: report.executionFailures,
              questionCount: report.questionCount,
              questionIds: report.questionIds,
              reanswerSelection: report.reanswerSelection,
              retainUnselected: parsed.retainUnselected ?? false,
              reportPath: join(report.runDirectory, LOCOMO_SMOKE_REPORT_FILE_NAME),
              runId: report.runId,
              sourceReportPath: parsed.sourceReportPath,
            },
            null,
            2,
          )}\n`,
        );
      })
      .catch((error: unknown) => {
        process.stderr.write(`LoCoMo reanswer failed: ${String(error)}\n`);
        process.exitCode = 1;
      });
  }
}
