import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInternalGoodMemory } from "../src/api/createGoodMemory";
import type { GoodMemory } from "../src/api/contracts";
import type { RecallResult } from "../src/api/contracts";
import type { EmbeddingAdapter } from "../src/embedding/contracts";
import type { FactSelector } from "../src/recall/generalizedSelection";
import {
  BEAM_FULL_DATA_FILES,
  normalizeBeamProfileList,
  validateBeamRows,
  type BeamCase,
  type BeamCaseResult,
  type BeamProfile,
  type BeamProfileReport,
  type BeamProfileSummary,
  type BeamReport,
  type BeamRow,
} from "../src/eval/beam";
import {
  beginNarrowGateHitAuditForInternalEval,
  endNarrowGateHitAuditForInternalEval,
  readNarrowGateHitAuditForInternalEval,
  setNarrowGateAuditCaseForInternalEval,
} from "./eval-profiles/legacy-fitted/recall/narrowGates";
import { createDeterministicMemoryExtractor } from "../src/remember/deterministicExtractor";
import {
  assertCliPathSegmentValue,
  hasCliFlagStrict,
  resolveCliFlagValueStrict,
  resolveCliPathSegmentFlagValueStrict,
} from "./cli-options";
import {
  assertPhase63Readiness,
  checkPhase63Readiness,
  resolvePhase63BeamRootEnv,
  resolvePhase63OutputDir,
  resolvePhase63RepoRoot,
} from "./run-phase-63-shared";
import {
  createLegacyFittedEvalFactSelector,
} from "./eval-profiles/legacy-fitted/activate";

export const PHASE63_RECALL_DIAGNOSTIC_RUN_ID =
  "run-phase63-beam-100k-recall-diagnostic-current";

const GENERATED_BY = "scripts/run-phase-63-beam-recall-diagnostic.ts";

export interface Phase63BeamRecallDiagnosticCliOptions {
  benchmarkRoot?: string;
  collectNarrowGateHits?: boolean;
  limit?: number;
  outputDir?: string;
  profiles?: readonly string[];
  runId?: string;
  scale?: BeamCase["scale"];
}

export interface Phase63BeamRecallDiagnosticDependencies {
  createMemory?: () => GoodMemory;
  factSelector?: FactSelector;
  mkdir?: typeof mkdir;
  now?: () => Date;
  readFile?: (path: string) => Promise<string>;
  writeFile?: (path: string, value: string) => Promise<void>;
}

interface BeamRecallDiagnosticCase extends BeamCase {
  row: BeamRow;
}

function parseLimit(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("--limit must be a positive integer");
  }
  return parsed;
}

function parseScale(value: string | undefined): BeamCase["scale"] | undefined {
  if (!value) {
    return undefined;
  }
  if (
    value === "100K" ||
    value === "500K" ||
    value === "1M" ||
    value === "10M" ||
    value === "unknown"
  ) {
    return value;
  }
  throw new Error("--scale must be 100K, 500K, 1M, 10M, or unknown");
}

function parseRepeatedFlag(
  argv: readonly string[],
  flagName: string,
): string[] | undefined {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === flagName) {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`${flagName} requires a value`);
      }
      values.push(value);
    }
  }
  return values.length === 0 ? undefined : values;
}

export function parsePhase63BeamRecallDiagnosticCliOptions(
  argv: readonly string[],
): Phase63BeamRecallDiagnosticCliOptions {
  return {
    benchmarkRoot:
      resolveCliFlagValueStrict(argv, "--benchmark-root") ??
      resolvePhase63BeamRootEnv(),
    ...(hasCliFlagStrict(argv, "--collect-narrow-gate-hits")
      ? { collectNarrowGateHits: true }
      : {}),
    limit: parseLimit(resolveCliFlagValueStrict(argv, "--limit")),
    outputDir: resolveCliFlagValueStrict(argv, "--output-dir"),
    profiles: parseRepeatedFlag(argv, "--profile"),
    runId: resolveCliPathSegmentFlagValueStrict(argv, "--run-id"),
    scale: parseScale(resolveCliFlagValueStrict(argv, "--scale")),
  };
}

export async function readPhase63BeamRows(input: {
  benchmarkRoot: string;
  readFile: (path: string) => Promise<string>;
}): Promise<BeamRow[]> {
  const errors: string[] = [];
  for (const fileName of BEAM_FULL_DATA_FILES) {
    const path = join(input.benchmarkRoot, fileName);
    try {
      return validateBeamRows(JSON.parse(await input.readFile(path)));
    } catch (error) {
      errors.push(
        `${path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  throw new Error(`Could not read BEAM data for recall diagnostic:\n${errors.join("\n")}`);
}

export function flattenPhase63BeamCases(
  rows: readonly BeamRow[],
  scale: BeamCase["scale"],
): BeamRecallDiagnosticCase[] {
  return rows.flatMap((row) =>
    row.probingQuestions.map((question) => ({
      answer: question.answer,
      answerable: question.answerable,
      chat: row.chat,
      conversationId: row.conversationId,
      evidenceChatIds: question.evidenceChatIds,
      question: question.question,
      questionId: question.questionId,
      questionType: question.questionType,
      row,
      scale,
    })),
  );
}

export function buildPhase63BeamScope(input: {
  conversationId: string;
  runId: string;
}): { agentId: string; userId: string; workspaceId: string } {
  return {
    agentId: "phase-63-beam-recall-diagnostic",
    userId: `beam:${input.conversationId}`,
    workspaceId: `phase-63-beam:${input.runId}`,
  };
}

function formatTurnForMemory(input: {
  content: string;
  id: number;
  role: string;
  timeAnchor: string;
}): { content: string; role: string } {
  return {
    content: `[BEAM chat_id=${input.id} role=${input.role} time=${input.timeAnchor}] ${input.content}`,
    role: "user",
  };
}

export async function seedPhase63BeamConversation(input: {
  memory: GoodMemory;
  row: BeamRow;
  runId: string;
}): Promise<void> {
  const turns = input.row.chat.flat();
  await input.memory.remember({
    annotations: turns.map((turn, messageIndex) => ({
      confirmed: true,
      kindHint: "fact" as const,
      messageIndex,
      metadataPatch: {
        attributes: {
          chatId: turn.id,
          originalRole: turn.role,
        },
        category: "external_benchmark",
        tags: ["beam", `chat_id:${turn.id}`],
      },
      reason: "BEAM recall diagnostic preserves every chat turn as retrievable evidence.",
      remember: "always" as const,
      verified: true,
    })),
    extractionStrategy: "rules-only",
    messages: turns.map((turn) =>
      formatTurnForMemory({
        content: turn.content,
        id: turn.id,
        role: turn.role,
        timeAnchor: turn.timeAnchor,
      }),
    ),
    scope: {
      ...buildPhase63BeamScope({
        conversationId: input.row.conversationId,
        runId: input.runId,
      }),
      sessionId: `conversation-${input.row.conversationId}`,
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function collectPhase63BeamChatIdsFromRecord(record: unknown): number[] {
  if (!isRecord(record)) {
    return [];
  }
  const ids: number[] = [];
  const collectNumber = (value: unknown): void => {
    const parsed = typeof value === "number" ? value : Number(value);
    if (Number.isInteger(parsed)) {
      ids.push(parsed);
    }
  };
  const collectFromText = (value: unknown): void => {
    if (typeof value !== "string") {
      return;
    }
    for (const match of value.matchAll(/\bchat_id[:=](\d+)/gu)) {
      collectNumber(match[1]);
    }
  };

  collectFromText(record.content);
  if (Array.isArray(record.tags)) {
    for (const tag of record.tags) {
      collectFromText(tag);
    }
  }
  if (isRecord(record.attributes)) {
    collectNumber(record.attributes.chatId);
    collectNumber(record.attributes.chat_id);
  }
  return ids;
}

export function collectPhase63BeamRetrievedChatIds(recall: RecallResult): number[] {
  const recallRecord = recall as unknown as Record<string, unknown>;
  const ids = new Set<number>();
  for (const key of [
    "preferences",
    "references",
    "facts",
    "feedback",
    "archives",
    "evidence",
    "episodes",
  ]) {
    const records = recallRecord[key];
    if (!Array.isArray(records)) {
      continue;
    }
    for (const record of records) {
      for (const id of collectPhase63BeamChatIdsFromRecord(record)) {
        ids.add(id);
      }
    }
  }
  return [...ids];
}

function scoreRecallCase(input: {
  profile: BeamProfile;
  retrievedChatIds: number[];
  testCase: BeamRecallDiagnosticCase;
}): BeamCaseResult {
  const evidenceChatRecall =
    input.testCase.evidenceChatIds.length === 0
      ? null
      : input.testCase.evidenceChatIds.filter((id) =>
          input.retrievedChatIds.includes(id),
        ).length / input.testCase.evidenceChatIds.length;

  return {
    answerScore: {
      correct: false,
      method: "mismatch",
      reasoning:
        "Recall diagnostic does not generate answers; correctness is evaluated in live answer runs.",
    },
    answerable: input.testCase.answerable,
    correct: false,
    evidenceChatIds: input.testCase.evidenceChatIds,
    evidenceChatRecall,
    hypothesis: "Recall diagnostic only.",
    questionId: input.testCase.questionId,
    questionType: input.testCase.questionType,
    retrievedChatIds: input.retrievedChatIds,
  };
}

function summarizeCases(cases: readonly BeamCaseResult[]): BeamProfileSummary {
  const evidenceCases = cases.filter((testCase) => testCase.evidenceChatRecall !== null);
  const evidenceChatRecall =
    evidenceCases.length === 0
      ? null
      : evidenceCases.reduce(
          (sum, testCase) => sum + (testCase.evidenceChatRecall ?? 0),
          0,
        ) / evidenceCases.length;

  return {
    accuracy: 0,
    abstentionCorrectCases: 0,
    correctCases: 0,
    evidenceCaseCount: evidenceCases.length,
    evidenceChatRecall,
    missedRecallCases: evidenceCases.filter(
      (testCase) => (testCase.evidenceChatRecall ?? 0) < 1,
    ).length,
    totalCases: cases.length,
    wrongAnswerCases: cases.length,
    wrongRecallCases: cases.filter((testCase) => {
      if (testCase.evidenceChatIds.length === 0) {
        return testCase.retrievedChatIds.length > 0;
      }
      return testCase.retrievedChatIds.some(
        (id) => !testCase.evidenceChatIds.includes(id),
      );
    }).length,
  };
}

function summarizeQuestionTypes(cases: readonly BeamRecallDiagnosticCase[]): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const testCase of cases) {
    summary[testCase.questionType] = (summary[testCase.questionType] ?? 0) + 1;
  }
  return summary;
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function createDiagnosticEmbeddingAdapter(): EmbeddingAdapter {
  return {
    async embed(texts: string[]): Promise<number[][]> {
      return texts.map((text) => {
        const hash = hashString(text);
        return [hash % 997, (hash >> 3) % 997, (hash >> 7) % 997];
      });
    },
  };
}

export function createPhase63BeamDiagnosticMemory(
  factSelector?: FactSelector,
): GoodMemory {
  // Deterministic id and clock seams: ranking tie-breaks fall back to
  // fact-id and timestamp comparisons, so random UUIDs and wall-clock
  // timestamps made repeated diagnostic runs diverge on equal-scored
  // candidates. Every conversation gets a fresh memory from this factory,
  // so the counters reset per conversation and runs are reproducible.
  let idCounter = 0;
  let clockTick = 0;
  return createInternalGoodMemory({
    adapters: {
      assistedExtractor: createDeterministicMemoryExtractor(),
      embeddingAdapter: createDiagnosticEmbeddingAdapter(),
    },
    storage: {
      provider: "memory",
    },
    testing: {
      createId: () => {
        idCounter += 1;
        return `beam-diagnostic-${String(idCounter).padStart(6, "0")}`;
      },
      now: () => {
        clockTick += 1;
        return new Date(Date.UTC(2026, 0, 1, 0, 0, 0, clockTick));
      },
    },
  }, factSelector ? { factSelector } : undefined);
}

export async function runPhase63BeamRecallDiagnostic(
  options: Phase63BeamRecallDiagnosticCliOptions = {},
  dependencies: Phase63BeamRecallDiagnosticDependencies = {},
): Promise<BeamReport> {
  const root = resolvePhase63RepoRoot();
  const benchmarkRoot = options.benchmarkRoot ?? resolvePhase63BeamRootEnv();
  if (!benchmarkRoot) {
    throw new Error(
      "Phase 63 BEAM recall diagnostic requires --benchmark-root or GOODMEMORY_BEAM_ROOT.",
    );
  }
  const profiles = normalizeBeamProfileList(options.profiles).filter(
    (profile) =>
      profile === "goodmemory-rules-only" || profile === "goodmemory-hybrid",
  );
  if (profiles.length === 0) {
    throw new Error(
      "Phase 63 BEAM recall diagnostic supports --profile goodmemory-rules-only and --profile goodmemory-hybrid.",
    );
  }

  if (!dependencies.readFile) {
    assertPhase63Readiness(
      checkPhase63Readiness({
        benchmarkRoot,
        mode: "full",
        profiles,
      }),
    );
  }

  const readFileImpl =
    dependencies.readFile ?? ((path: string) => readFile(path, "utf8"));
  const writeFileImpl = dependencies.writeFile ?? writeFile;
  const mkdirImpl = dependencies.mkdir ?? mkdir;
  const now = dependencies.now ?? (() => new Date());
  const runId = options.runId ?? PHASE63_RECALL_DIAGNOSTIC_RUN_ID;
  assertCliPathSegmentValue({ flag: "--run-id", value: runId });
  const outputDir = options.outputDir ?? resolvePhase63OutputDir(root);
  const runDirectory = join(outputDir, runId);
  const rows = await readPhase63BeamRows({
    benchmarkRoot,
    readFile: readFileImpl,
  });
  const cases = flattenPhase63BeamCases(rows, options.scale ?? "100K").slice(
    0,
    options.limit,
  );
  const casesByConversation = new Map<string, BeamRecallDiagnosticCase[]>();
  for (const testCase of cases) {
    const group = casesByConversation.get(testCase.conversationId) ?? [];
    group.push(testCase);
    casesByConversation.set(testCase.conversationId, group);
  }
  const profileReports: Partial<Record<BeamProfile, BeamProfileReport>> = {};
  let narrowGateHits: ReturnType<typeof readNarrowGateHitAuditForInternalEval> = [];

  if (options.collectNarrowGateHits) {
    beginNarrowGateHitAuditForInternalEval();
  }

  try {
    for (const profile of profiles) {
      const caseResults: BeamCaseResult[] = [];
      for (const conversationCases of casesByConversation.values()) {
        const row = conversationCases[0]?.row;
        if (!row) {
          continue;
        }
        const memory = dependencies.createMemory?.() ??
          createPhase63BeamDiagnosticMemory(dependencies.factSelector);
        await seedPhase63BeamConversation({
          memory,
          row,
          runId,
        });
        const scope = buildPhase63BeamScope({
          conversationId: row.conversationId,
          runId,
        });
        for (const testCase of conversationCases) {
          if (options.collectNarrowGateHits) {
            setNarrowGateAuditCaseForInternalEval(testCase.questionId);
          }
          const recall = await memory.recall({
            query: testCase.question,
            scope,
            strategy: profile === "goodmemory-rules-only" ? "rules-only" : "hybrid",
          });
          caseResults.push(
            scoreRecallCase({
              profile,
              retrievedChatIds: collectPhase63BeamRetrievedChatIds(recall),
              testCase,
            }),
          );
        }
      }
      profileReports[profile] = {
        cases: caseResults,
        summary: summarizeCases(caseResults),
      };
    }
  } finally {
    if (options.collectNarrowGateHits) {
      narrowGateHits = readNarrowGateHitAuditForInternalEval();
      endNarrowGateHitAuditForInternalEval();
    }
  }

  const report: BeamReport = {
    benchmarkRoot,
    generatedAt: now().toISOString(),
    generatedBy: GENERATED_BY,
    mode: "full",
    outputDir,
    phase: "phase-63",
    profiles: profileReports,
    runDirectory,
    runId,
    source: {
      benchmark: "BEAM",
      license: "cc-by-sa-4.0 dataset; paper external",
      url: "https://huggingface.co/datasets/Mohammadta/BEAM",
    },
    summary: {
      caseCountsByQuestionType: summarizeQuestionTypes(cases),
      executionFailures: 0,
      profilesCompared: profiles,
      scale: options.scale ?? "100K",
      totalCases: cases.length,
    },
  };

  await mkdirImpl(runDirectory, { recursive: true });
  await writeFileImpl(
    join(runDirectory, "recall-diagnostic.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  if (options.collectNarrowGateHits) {
    await writeFileImpl(
      join(runDirectory, "narrow-gate-hit-audit.json"),
      `${JSON.stringify(
        {
          generatedBy: GENERATED_BY,
          profile: "legacy-fitted",
          runId,
          totalCases: cases.length,
          verdicts: narrowGateHits.map((entry) => ({
            ...entry,
            hitCount: entry.caseIds.length,
            status:
              entry.caseIds.length === 0
                ? "unobserved"
                : entry.caseIds.length === 1
                  ? "case_fitted"
                  : "multi_case",
          })),
        },
        null,
        2,
      )}\n`,
    );
  }
  return report;
}

function buildCliSummary(report: BeamReport): {
  phase: "phase-63";
  profileSummaries: Partial<Record<BeamProfile, BeamProfileSummary>>;
  runDirectory: string;
  runId: string;
  summary: BeamReport["summary"];
} {
  const profileSummaries: Partial<Record<BeamProfile, BeamProfileSummary>> = {};
  for (const profile of report.summary.profilesCompared) {
    const profileReport = report.profiles[profile];
    if (profileReport) {
      profileSummaries[profile] = profileReport.summary;
    }
  }
  return {
    phase: report.phase,
    profileSummaries,
    runDirectory: report.runDirectory,
    runId: report.runId,
    summary: report.summary,
  };
}

if (import.meta.main) {
  const legacyFittedProfileCount = Bun.argv.filter(
    (value) => value === "--legacy-fitted-profile",
  ).length;
  if (legacyFittedProfileCount > 1) {
    throw new Error("--legacy-fitted-profile may be provided at most once");
  }
  const collectNarrowGateHits = Bun.argv.includes("--collect-narrow-gate-hits");
  if (collectNarrowGateHits && legacyFittedProfileCount !== 1) {
    throw new Error(
      "--collect-narrow-gate-hits requires --legacy-fitted-profile",
    );
  }
  const factSelector = legacyFittedProfileCount === 1
    ? createLegacyFittedEvalFactSelector()
    : undefined;
  const report = await runPhase63BeamRecallDiagnostic(
    parsePhase63BeamRecallDiagnosticCliOptions(Bun.argv),
    factSelector ? { factSelector } : {},
  );
  console.log(JSON.stringify(buildCliSummary(report), null, 2));
}
