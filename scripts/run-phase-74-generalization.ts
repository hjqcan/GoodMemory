import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  assertCliPathSegmentValue,
  resolveCliFlagValueStrict,
} from "./cli-options";

import {
  createInternalGoodMemory,
} from "../src/api/createGoodMemory";
import type {
  GoodMemory,
  RecallResult,
} from "../src/api/contracts";
import type { MemoryScope } from "../src/domain/scope";
import type {
  MemoryCandidate,
  MemoryExtractor,
} from "../src/remember/candidates";
import {
  buildPhase74LabelFreeCaseBoundary,
  runPhase74Generalization,
} from "../src/eval/phase74Generalization";
import type {
  Phase74GeneralizationCase,
  Phase74GeneralizationReport,
  Phase74RetrievalSnapshot,
} from "../src/eval/phase74Generalization";
import { createPhase74FileCheckpoint } from "../src/eval/phase74Checkpoint";
import {
  assertPhase74FrozenDataset,
  createPhase74LocomoDataset,
  createPhase74LongMemEvalDataset,
  createPhase74SelectedDatasetBundle,
} from "../src/eval/phase74Datasets";
import type {
  Phase74BenchmarkFamily,
  Phase74DatasetBundle,
  Phase74DatasetCase,
} from "../src/eval/phase74Datasets";
import {
  buildPhase74IngestionUsageAllocation,
  buildPhase74IngestionUsagePaths,
  createPhase74FullRetrievalRuntime,
  verifyPhase74IngestionUsageManifest,
} from "../src/eval/phase74FullRuntime";
import {
  buildPhase74FullRunIdentityConfiguration,
  PHASE74_CONTEXT_TOKEN_BUDGET,
  PHASE74_PRE_RANK_LIMIT,
  PHASE74_SELECTED_LIMIT,
} from "../src/eval/phase74ExperimentIdentity";
import { buildPhase74ReplicateComparison } from "../src/eval/phase74Replicates";
import { createPhase74ProtocolReader } from "../src/eval/phase74ProtocolReader";
import {
  buildPhase74ProtocolScoringIdentity,
  createPhase74ProtocolCompatibleAnswerAssessor,
} from "../src/eval/phase74ProtocolScoring";
import type {
  Phase74EmbeddingIdentity,
  Phase74LiveModels,
} from "../src/eval/phase74Live";
import {
  buildPhase74EmbeddingIdentity,
  createPhase74LiveJudge,
  createPhase74LiveReader,
  phase74LivePromptSha256s,
  resolvePhase74EvaluatorSource,
  resolvePhase74LiveModels,
  verifyPhase74EvaluatorSource,
} from "../src/eval/phase74Live";
import {
  appendPhase74ModelUsageEventSync,
  appendPhase74ModelUsageIntentSync,
  buildPhase74ModelUsageEvidence,
  loadPhase74ModelUsageLedger,
  reconcilePhase74PendingModelUsageSync,
} from "../src/eval/modelUsage";
import type {
  AttributedModelUsageAttempt,
  AttributedModelUsageIntent,
  Phase74IngestionUsageLedger,
} from "../src/eval/modelUsage";
import type { EvidenceLedgerFormat } from "../src/eval/evidenceLedgerFormats";
import type { GeneralizedFusionChannel } from "../src/recall/generalizedFusion";
import { validateLongMemEvalCases } from "../src/eval/longmemeval";
import type { LongMemEvalCase } from "../src/eval/longmemeval";
import {
  buildEvalRunIdentity,
  createOrMatchEvalRunIdentity,
  hashEvalExperimentIdentity,
} from "../src/eval/runIdentity";
import type { EvalRunJsonObject } from "../src/eval/runIdentity";
import {
  loadPhase74ProtectionBlueprintDescriptor,
} from "../src/eval/phase74ProtectionSuiteEvidence";

const DEFAULT_DATASET_PATH =
  "fixtures/external-benchmarks/longmemeval/longmemeval_s_smoke.json";
const DEFAULT_OUTPUT_DIR =
  "reports/eval/research/phase-74/generalization";
const CONTEXT_TOKEN_BUDGET = PHASE74_CONTEXT_TOKEN_BUDGET;
const DEFAULT_EMBEDDING_SPEND_LIMIT_USD = 1;
const DEFAULT_MAX_LANGUAGE_CALLS = 50_000;
const OPENROUTER_EMBEDDING_USD_PER_MILLION_INPUT_TOKENS = 0.02;
const PRE_RANK_LIMIT = PHASE74_PRE_RANK_LIMIT;
const SELECTED_LIMIT = PHASE74_SELECTED_LIMIT;

export const PHASE74_RUN_LOCK_FILENAME = ".phase74-run.lock";

function phase74RunLockOwner(raw: string): { pid: number; token: string } {
  const value = JSON.parse(raw) as { pid?: unknown; token?: unknown };
  if (
    !Number.isSafeInteger(value.pid) || Number(value.pid) <= 0 ||
    typeof value.token !== "string" || value.token.length === 0
  ) {
    throw new Error("Phase 74 run lock is invalid.");
  }
  return { pid: Number(value.pid), token: value.token };
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export async function acquirePhase74RunLock(
  runDirectory: string,
): Promise<() => Promise<void>> {
  const path = join(runDirectory, PHASE74_RUN_LOCK_FILENAME);
  const token = randomUUID();
  const content = `${JSON.stringify({ pid: process.pid, token })}\n`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await writeFile(path, content, { encoding: "utf8", flag: "wx" });
      return async () => {
        let ownerRaw: string;
        try {
          ownerRaw = await readFile(path, "utf8");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return;
          }
          throw error;
        }
        if (phase74RunLockOwner(ownerRaw).token !== token) {
          throw new Error("Phase 74 run lock ownership drifted.");
        }
        await rm(path);
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    }
    let ownerRaw: string;
    try {
      ownerRaw = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      throw error;
    }
    const owner = phase74RunLockOwner(ownerRaw);
    if (processIsAlive(owner.pid)) {
      throw new Error(
        `Phase 74 run is already active in process ${owner.pid}.`,
      );
    }
    const stalePath = `${path}.stale-${token}`;
    try {
      await rename(path, stalePath);
      await rm(stalePath, { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
  throw new Error("Phase 74 run lock could not be acquired.");
}

interface Phase74CallBudgetState {
  embeddingCalls: number;
  embeddingInputByteUpperBound: number;
  embeddingSpendLimitUsd: number;
  languageCalls: number;
  maxLanguageCalls: number;
  schemaVersion: 1;
}

interface Phase74DurableFileOperations {
  close(fd: number): void;
  fsync(fd: number): void;
  open(path: string, flags: "r" | "wx"): number;
  randomId(): string;
  remove(path: string): void;
  rename(source: string, destination: string): void;
  write(fd: number, value: string): void;
}

const DEFAULT_DURABLE_FILE_OPERATIONS: Phase74DurableFileOperations = {
  close: closeSync,
  fsync: fsyncSync,
  open: openSync,
  randomId: randomUUID,
  remove: (path) => rmSync(path, { force: true }),
  rename: renameSync,
  write: (fd, value) => writeFileSync(fd, value, "utf8"),
};

function writePhase74DurableFileSync(input: {
  fileOperations: Phase74DurableFileOperations;
  path: string;
  value: string;
}): void {
  const temporaryPath = `${input.path}.${input.fileOperations.randomId()}.tmp`;
  try {
    const file = input.fileOperations.open(temporaryPath, "wx");
    try {
      input.fileOperations.write(file, input.value);
      input.fileOperations.fsync(file);
    } finally {
      input.fileOperations.close(file);
    }
    input.fileOperations.rename(temporaryPath, input.path);
    const directory = input.fileOperations.open(dirname(input.path), "r");
    try {
      input.fileOperations.fsync(directory);
    } finally {
      input.fileOperations.close(directory);
    }
  } finally {
    input.fileOperations.remove(temporaryPath);
  }
}

interface RuntimeSnapshot extends Phase74RetrievalSnapshot {
}

export interface Phase74GeneralizationSmokeOptions {
  datasetPath?: string;
  generatedAt?: string;
  outputDir?: string;
  runId?: string;
}

export interface Phase74GeneralizationSmokeResult {
  report: Phase74GeneralizationReport;
  runDirectory: string;
}

export interface Phase74GeneralizationFullOptions {
  benchmark: Phase74BenchmarkFamily;
  benchmarkRoot: string;
  caseConcurrency?: number;
  caseSelectionSeed?: number;
  caseSelectionSize?: number;
  embeddingSpendLimitUsd: number;
  generatedAt?: string;
  maxLanguageCalls: number;
  outputDir: string;
  protectionBlueprintPath: string;
  replicate: 1 | 2 | 3;
  rerankerMode?: "deterministic" | "provider";
  runId: string;
  stage: "E1" | "E2" | "E3" | "E4";
}

export interface Phase74GeneralizationFullResult {
  dataset: Phase74DatasetBundle;
  report: Phase74GeneralizationReport;
  runDirectory: string;
}

export { buildPhase74FullRunIdentityConfiguration };

function phase74RequestUrl(request: RequestInfo | URL): string {
  if (typeof request === "string") {
    return request;
  }
  return request instanceof URL ? request.toString() : request.url;
}

function phase74EmbeddingRequestBytes(init: RequestInit | undefined): number {
  if (typeof init?.body !== "string") {
    throw new Error("Phase 74 embedding budget requires a JSON string body.");
  }
  const parsed = JSON.parse(init.body) as { input?: unknown };
  const values = Array.isArray(parsed.input) ? parsed.input : [parsed.input];
  if (!values.every((value) => typeof value === "string")) {
    throw new Error("Phase 74 embedding budget requires string inputs.");
  }
  return values.reduce(
    (total, value) => total + Buffer.byteLength(value as string),
    0,
  );
}

function parsePhase74CallBudgetState(
  raw: string,
  limits: Pick<
    Phase74CallBudgetState,
    "embeddingSpendLimitUsd" | "maxLanguageCalls"
  >,
): Phase74CallBudgetState {
  const value = JSON.parse(raw) as Partial<Phase74CallBudgetState>;
  if (
    value.schemaVersion !== 1 ||
    value.embeddingSpendLimitUsd !== limits.embeddingSpendLimitUsd ||
    value.maxLanguageCalls !== limits.maxLanguageCalls ||
    !Number.isSafeInteger(value.embeddingCalls) ||
    !Number.isSafeInteger(value.embeddingInputByteUpperBound) ||
    !Number.isSafeInteger(value.languageCalls) ||
    (value.embeddingCalls ?? -1) < 0 ||
    (value.embeddingInputByteUpperBound ?? -1) < 0 ||
    (value.languageCalls ?? -1) < 0
  ) {
    throw new Error("Phase 74 durable call budget is malformed or drifted.");
  }
  return value as Phase74CallBudgetState;
}

export function createPhase74DurableCallBudget(input: {
  embeddingSpendLimitUsd: number;
  fetch: typeof globalThis.fetch;
  fileOperations?: Phase74DurableFileOperations;
  maxLanguageCalls: number;
  path: string;
}): {
  fetch: typeof globalThis.fetch;
  snapshot: () => Phase74CallBudgetState;
} {
  const limits = {
    embeddingSpendLimitUsd: input.embeddingSpendLimitUsd,
    maxLanguageCalls: input.maxLanguageCalls,
  };
  let state = existsSync(input.path)
    ? parsePhase74CallBudgetState(readFileSync(input.path, "utf8"), limits)
    : {
        embeddingCalls: 0,
        embeddingInputByteUpperBound: 0,
        ...limits,
        languageCalls: 0,
        schemaVersion: 1 as const,
      };
  const fileOperations = input.fileOperations ?? DEFAULT_DURABLE_FILE_OPERATIONS;
  const persist = () => {
    writePhase74DurableFileSync({
      fileOperations,
      path: input.path,
      value: `${JSON.stringify(state, null, 2)}\n`,
    });
  };
  if (!existsSync(input.path)) {
    persist();
  }
  const fetch = (async (request, init) => {
    const pathname = new URL(phase74RequestUrl(request)).pathname;
    if (pathname.endsWith("/chat/completions")) {
      if (state.languageCalls + 1 > state.maxLanguageCalls) {
        throw new Error("Phase 74 language-call limit would be exceeded.");
      }
      state = { ...state, languageCalls: state.languageCalls + 1 };
      persist();
    } else if (pathname.endsWith("/embeddings")) {
      const requestBytes = phase74EmbeddingRequestBytes(init);
      const projectedBytes = state.embeddingInputByteUpperBound + requestBytes;
      const projectedUsd = projectedBytes *
        OPENROUTER_EMBEDDING_USD_PER_MILLION_INPUT_TOKENS / 1_000_000;
      if (projectedUsd > state.embeddingSpendLimitUsd) {
        throw new Error("Phase 74 embedding spend limit would be exceeded.");
      }
      state = {
        ...state,
        embeddingCalls: state.embeddingCalls + 1,
        embeddingInputByteUpperBound: projectedBytes,
      };
      persist();
    }
    return input.fetch(request, init);
  }) as typeof globalThis.fetch;
  return {
    fetch,
    snapshot: () => ({ ...state }),
  };
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function selectPhase74GeneralizationCases(input: {
  cases: readonly Phase74DatasetCase[];
  seed?: number;
  size?: number;
}): {
  cases: Phase74DatasetCase[];
  identity: EvalRunJsonObject;
} {
  if ((input.seed === undefined) !== (input.size === undefined)) {
    throw new Error(
      "Phase 74 case selection seed and size must be provided together.",
    );
  }
  const occurrences = new Map<string, number>();
  const casesWithKeys = input.cases.map((testCase) => {
    const baseKey = buildPhase74LabelFreeCaseBoundary({
      ...testCase,
      labelFreeCaseKey: undefined,
    }).caseKey;
    const occurrence = occurrences.get(baseKey) ?? 0;
    occurrences.set(baseKey, occurrence + 1);
    if (occurrence === 0) {
      return { ...testCase };
    }
    return {
      ...testCase,
      labelFreeCaseKey: `case-${sha256(JSON.stringify([baseKey, occurrence]))}`,
    };
  });
  const caseKeys = casesWithKeys.map(
    (testCase) => buildPhase74LabelFreeCaseBoundary(testCase).caseKey,
  );
  const populationContentSha256 = sha256(JSON.stringify(caseKeys));
  if (input.seed === undefined || input.size === undefined) {
    const cases = casesWithKeys;
    return {
      cases,
      identity: {
        mode: "all",
        populationContentSha256,
        populationSize: cases.length,
        selectedCaseIdsSha256: sha256(
          JSON.stringify(cases.map(({ caseId }) => caseId)),
        ),
        selectedCaseKeysSha256: sha256(JSON.stringify([...caseKeys].sort())),
        selectedSize: cases.length,
      },
    };
  }
  if (!Number.isSafeInteger(input.seed) || input.seed < 0) {
    throw new Error("Phase 74 case selection seed must be a non-negative integer.");
  }
  if (
    !Number.isSafeInteger(input.size) ||
    input.size <= 0 ||
    input.size > input.cases.length
  ) {
    throw new Error(
      `Phase 74 case selection size must be between 1 and ${input.cases.length}.`,
    );
  }
  const selectedIndexes = new Set(
    casesWithKeys
      .map((_, index) => ({
        index,
        rank: sha256(JSON.stringify([input.seed, caseKeys[index]])),
      }))
      .sort((left, right) =>
        left.rank.localeCompare(right.rank) ||
        left.index - right.index
      )
      .slice(0, input.size)
      .map(({ index }) => index),
  );
  const cases = casesWithKeys.filter((_, index) => selectedIndexes.has(index));
  const selectedCaseKeys = caseKeys.filter((_, index) => selectedIndexes.has(index));
  return {
    cases,
    identity: {
      mode: "deterministic-content-hash-v2",
      populationContentSha256,
      populationSize: input.cases.length,
      seed: input.seed,
      selectedCaseIdsSha256: sha256(
        JSON.stringify(cases.map(({ caseId }) => caseId)),
      ),
      selectedCaseKeysSha256: sha256(
        JSON.stringify([...selectedCaseKeys].sort()),
      ),
      selectedSize: cases.length,
    },
  };
}

function isoDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? new Date(0).toISOString()
    : parsed.toISOString();
}

function stableMessageId(input: {
  caseId: string;
  sessionId: string;
  turnIndex: number;
}): string {
  return `${input.caseId}/${input.sessionId}/turn-${input.turnIndex + 1}`;
}

function inferSubject(content: string, fallback: string): string {
  return content.match(/\b[A-Z][\p{L}\p{N}_-]*\b/u)?.[0] ?? fallback;
}

function inferPredicate(content: string): string {
  const normalized = content.toLowerCase();
  if (/\bprefer(?:s|red|ence)?\b|偏好/u.test(normalized)) {
    return "preference.value";
  }
  if (/\bdatabase\b|\bsqlite\b|\bpostgres\b|数据库/u.test(normalized)) {
    return "technology.database";
  }
  if (/\bdeployment region\b|部署区域/u.test(normalized)) {
    return "deployment.region";
  }
  return "memory.statement";
}

function createSmokeExtractor(input: {
  contextualDescriptor: boolean;
}): MemoryExtractor {
  return {
    async extract(payload) {
      const candidates: MemoryCandidate[] = payload.messages.map(
        (message, sourceMessageIndex) => {
          const subject = inferSubject(message.content, payload.scope.userId);
          return {
            content: message.content,
            explicitness: "explicit",
            id: message.id ?? `message-${sourceMessageIndex + 1}`,
            kindHint: "fact",
            metadata: {
              category: "external_benchmark",
              subject,
              ...(input.contextualDescriptor
                ? {
                    claim: {
                      modality: "asserted" as const,
                      objectText: message.content,
                      polarity: "positive" as const,
                      predicateKey: inferPredicate(message.content),
                    },
                    contextualDescriptor: [
                      payload.scope.sessionId
                        ? `session ${payload.scope.sessionId}`
                        : undefined,
                      message.observedAt
                        ? `observed ${message.observedAt}`
                        : undefined,
                    ].filter(Boolean).join(", "),
                  }
                : {}),
            },
            sourceMessageIndex,
            sourceMessageIndexes: [sourceMessageIndex],
            sourceRole: message.role,
          };
        },
      );
      return { candidates, ignoredMessageCount: 0 };
    },
  };
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function readBoolean(value: unknown): boolean {
  return value === true;
}

function readFusionChannels(
  value: unknown,
): GeneralizedFusionChannel[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const allowed = new Set<GeneralizedFusionChannel>([
    "dense",
    "entity",
    "lexical",
    "relation",
    "temporal",
  ]);
  return value.filter(
    (item): item is GeneralizedFusionChannel =>
      typeof item === "string" && allowed.has(item as GeneralizedFusionChannel),
  );
}

function createExecutionMemory(input: {
  configuration: Readonly<Record<string, unknown>>;
  now: string;
}): {
  extractionStrategy: "llm-assisted" | "rules-only";
  memory: GoodMemory;
} {
  const representation = readString(
    input.configuration.representation,
    "raw-only",
  );
  const retrieval = input.configuration.retrieval;
  const retrievalConfig = retrieval &&
      typeof retrieval === "object" &&
      !Array.isArray(retrieval)
    ? retrieval as Record<string, unknown>
    : {};
  const planner = input.configuration.planner;
  const plannerMode = planner && typeof planner === "object" &&
      !Array.isArray(planner)
    ? readString((planner as Record<string, unknown>).mode, "off")
    : "off";
  let nextId = 0;
  const assistedExtractor = representation === "raw-only"
    ? undefined
    : createSmokeExtractor({
        contextualDescriptor:
          representation === "atomic-contextual-raw-pointer",
      });
  const fusionChannels = readFusionChannels(
    retrievalConfig.generalizedFusionChannels,
  );
  const memory = createInternalGoodMemory(
    {
      adapters: {
        ...(assistedExtractor ? { assistedExtractor } : {}),
        ...(plannerMode === "assisted"
          ? {
              recallPlanner: {
                async plan() {
                  return {};
                },
              },
            }
          : {}),
      },
      retrieval: {
        ...(fusionChannels
          ? { generalizedFusionChannels: fusionChannels }
          : {}),
        preset: "recommended",
        recallPlanExecution: readBoolean(
          retrievalConfig.recallPlanExecution,
        ),
      },
      storage: { provider: "memory" },
      testing: {
        createId: () => `phase74-smoke-${++nextId}`,
        now: () => new Date(input.now),
      },
    },
    { environment: {} },
  );
  return {
    extractionStrategy: representation === "raw-only"
      ? "rules-only"
      : "llm-assisted",
    memory,
  };
}

function baseScope(testCase: LongMemEvalCase, runId: string): MemoryScope {
  return {
    userId: `phase74-${runId}-${testCase.questionId}`,
    workspaceId: "longmemeval-smoke",
  };
}

function buildGeneralizationCase(
  testCase: LongMemEvalCase,
): Phase74GeneralizationCase {
  return {
    caseId: testCase.questionId,
    expectedAnswer: testCase.answer,
    goldEvidenceIds: testCase.answerSessionIds,
    locale: "en",
    protocolMetadata: {
      questionType: testCase.questionType,
    },
    question: testCase.question,
    rawEvidence: testCase.haystackSessions.flatMap((session, sessionIndex) => {
      const sessionId = testCase.haystackSessionIds[sessionIndex] ??
        `session-${sessionIndex + 1}`;
      const date = testCase.haystackDates[sessionIndex] ?? "unknown-date";
      return session.map((turn, turnIndex) => ({
        content: `[${date}] ${turn.role}: ${turn.content}`,
        id: stableMessageId({
          caseId: testCase.questionId,
          sessionId,
          turnIndex,
        }),
        sourceIds: [sessionId],
      }));
    }),
  };
}

function sourceIdsForMemory(input: {
  evidence: RecallResult["evidence"];
  memoryId: string;
  sessionByMessageId: ReadonlyMap<string, string>;
}): string[] {
  return [...new Set(
    input.evidence
      .filter(
        (record) =>
          record.linkedMemoryIds.includes(input.memoryId) ||
          record.linkedArchiveIds.includes(input.memoryId),
      )
      .flatMap((record) => record.sourceMessageIds)
      .map((messageId) => input.sessionByMessageId.get(messageId))
      .filter((sessionId): sessionId is string => sessionId !== undefined),
  )];
}

function contextItems(input: {
  evidence: RecallResult["evidence"];
  records: readonly { content: string; id: string }[];
  sessionByMessageId: ReadonlyMap<string, string>;
}) {
  return input.records.map((record) => ({
    content: record.content,
    id: record.id,
    sourceIds: sourceIdsForMemory({
      evidence: input.evidence,
      memoryId: record.id,
      sessionByMessageId: input.sessionByMessageId,
    }),
  }));
}

async function executeLongMemEvalRetrieval(input: {
  arm: string;
  configuration: Readonly<Record<string, unknown>>;
  runId: string;
  stage: string;
  testCase: LongMemEvalCase;
}): Promise<RuntimeSnapshot> {
  const scope = baseScope(input.testCase, input.runId);
  const runtime = createExecutionMemory({
    configuration: input.configuration,
    now: isoDate(input.testCase.questionDate),
  });
  const sessionByMessageId = new Map<string, string>();
  for (const [sessionIndex, session] of input.testCase.haystackSessions.entries()) {
    const sessionId = input.testCase.haystackSessionIds[sessionIndex] ??
      `session-${sessionIndex + 1}`;
    const observedAt = isoDate(
      input.testCase.haystackDates[sessionIndex] ?? "1970-01-01",
    );
    const messages = session.map((turn, turnIndex) => {
      const id = stableMessageId({
        caseId: input.testCase.questionId,
        sessionId,
        turnIndex,
      });
      sessionByMessageId.set(id, sessionId);
      return {
        content: turn.content,
        id,
        observedAt,
        role: turn.role,
      };
    });
    await runtime.memory.remember({
      annotations: messages.map((_, messageIndex) => ({
        confirmed: true,
        kindHint: "fact" as const,
        messageIndex,
        metadataPatch: {
          attributes: {
            sourceDate: observedAt,
            sourceSessionId: sessionId,
          },
        },
        reason: "Preserve immutable raw source evidence for Phase 74 smoke.",
        remember: "always" as const,
        verified: true,
      })),
      extractionStrategy: runtime.extractionStrategy,
      messages,
      scope: { ...scope, sessionId },
    });
  }
  const recall = await runtime.memory.recall({
    includeEvidence: true,
    query: input.testCase.question,
    scope,
    strategy: "hybrid",
  });
  const exported = await runtime.memory.exportMemory({ scope });
  const storedEvidence = exported.durable.evidence;
  const storedMemories = contextItems({
    evidence: storedEvidence,
    records: exported.durable.facts.map(({ content, id }) => ({ content, id })),
    sessionByMessageId,
  });
  const retrievedMemories = contextItems({
    evidence: recall.evidence,
    records: recall.facts.map(({ content, id }) => ({ content, id })),
    sessionByMessageId,
  });
  const evidenceLedgers = Object.fromEntries(
    await Promise.all(
      ([
        "prose",
        "chronology",
        "compact_json",
        "json_locale_note",
      ] as const).map(async (format) => [
        format,
        (await runtime.memory.buildContext({
          evidenceLedgerFormat: format,
          maxTokens: CONTEXT_TOKEN_BUDGET,
          output: "markdown",
          recall,
        })).content,
      ]),
    ),
  ) as Record<EvidenceLedgerFormat, string>;
  const snapshotId = sha256(JSON.stringify({
    arm: input.arm,
    caseId: input.testCase.questionId,
    evidenceLedgers,
    retrievedMemories,
    stage: input.stage,
    storedMemories,
  }));
  return {
    evidenceLedgers,
    retrievedMemories,
    snapshotId,
    storedMemories,
  };
}

const STOPWORDS = new Set([
  "a",
  "an",
  "did",
  "does",
  "finally",
  "for",
  "is",
  "the",
  "to",
  "what",
  "which",
]);

function readerTokens(value: string): string[] {
  return (value.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [])
    .map((token) => token.replace(/(?:ing|ed|es|s)$/u, ""))
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

function deterministicGenericReader(input: {
  context: string;
  question: string;
}): string {
  if (!input.context.trim()) {
    return "No answer.";
  }
  const questionTokens = new Set(readerTokens(input.question));
  const lines = input.context.split("\n").filter((line) => line.trim());
  let bestLine = lines.at(-1) ?? "";
  let bestScore = -1;
  for (const line of lines) {
    const lineTokens = new Set(readerTokens(line));
    const score = [...questionTokens].filter((token) => lineTokens.has(token)).length;
    if (score >= bestScore) {
      bestLine = line;
      bestScore = score;
    }
  }
  if (/\bno one mentioned\b|\bnot mentioned\b|未提及/iu.test(bestLine)) {
    return "No answer.";
  }
  return bestLine.replace(/^\s*-\s*\[.*?\]\s*/u, "").trim();
}

function normalizeAnswer(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").replace(/[.。]+$/u, "").trim();
}

function deterministicJudge(input: {
  answer: string;
  expectedAnswer: string;
}): { correct: boolean } {
  const answer = normalizeAnswer(input.answer);
  const expected = normalizeAnswer(input.expectedAnswer);
  const abstentionExpected = expected === "no answer";
  return {
    correct: abstentionExpected
      ? /\bno answer\b|cannot determine|insufficient/u.test(answer)
      : answer === expected || answer.includes(expected),
  };
}

function modelSafeRunId(generatedAt: string): string {
  return `phase74-smoke-${generatedAt.replace(/[^0-9]/g, "").slice(0, 14)}`;
}

function jsonLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeJsonLines(path: string, values: readonly unknown[]): Promise<void> {
  await writeFile(path, values.map(jsonLine).join(""), "utf8");
}

function publicModelIdentity(model: Phase74LiveModels["answer"]) {
  return {
    gateway: model.baseURL ?? "",
    model: model.model,
    provider: model.provider,
  };
}

export async function loadPhase74PreparedDataset(input: {
  benchmark: Phase74BenchmarkFamily;
  benchmarkRoot: string;
}): Promise<Phase74DatasetBundle> {
  const dataFile = input.benchmark === "longmemeval"
    ? "longmemeval_s_cleaned.json"
    : "cases.json";
  const raw = await readFile(join(input.benchmarkRoot, dataFile), "utf8");
  const bundle = input.benchmark === "longmemeval"
    ? createPhase74LongMemEvalDataset({ raw })
    : createPhase74LocomoDataset({ normalizedRaw: raw });
  assertPhase74FrozenDataset(bundle);
  const persisted = JSON.parse(await readFile(
    join(input.benchmarkRoot, "dataset-manifest.json"),
    "utf8",
  ));
  for (const [key, value] of Object.entries(bundle.manifest)) {
    if (!isDeepStrictEqual(persisted[key], value)) {
      throw new Error(
        `Phase 74 ${input.benchmark} prepared manifest drifted at ${key}.`,
      );
    }
  }
  if (persisted.dataFile !== dataFile) {
    throw new Error(`Phase 74 ${input.benchmark} prepared data file drifted.`);
  }
  return bundle;
}

async function persistRunIdentity(input: {
  identity: Parameters<typeof createOrMatchEvalRunIdentity>[0]["identity"];
  runDirectory: string;
}) {
  const identityPath = join(input.runDirectory, "run-identity.json");
  await createOrMatchEvalRunIdentity({
    identity: input.identity,
    path: identityPath,
    persistence: {
      async create(path, content) {
        await writeFile(path, content, { encoding: "utf8", flag: "wx" });
      },
      async read(path) {
        try {
          return await readFile(path, "utf8");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return null;
          }
          throw error;
        }
      },
    },
  });
  return JSON.parse(await readFile(identityPath, "utf8"));
}

async function loadPhase74IngestionUsagePool(input: {
  keys: readonly string[];
  runDirectory: string;
}): Promise<Phase74IngestionUsageLedger[]> {
  return Promise.all(input.keys.map(async (key) => {
    const ledger = await loadPhase74ModelUsageLedger(
      buildPhase74IngestionUsagePaths(input.runDirectory, key),
    );
    await verifyPhase74IngestionUsageManifest({
      ingestionKey: key,
      ledger,
      runDirectory: input.runDirectory,
    });
    return { key, ledger };
  }));
}

export async function runPhase74GeneralizationFull(
  options: Phase74GeneralizationFullOptions,
  env: Record<string, string | undefined> = process.env,
): Promise<Phase74GeneralizationFullResult> {
  assertCliPathSegmentValue({ flag: "--run-id", value: options.runId });
  const preparedDataset = await loadPhase74PreparedDataset(options);
  const selection = selectPhase74GeneralizationCases({
    cases: preparedDataset.cases,
    seed: options.caseSelectionSeed,
    size: options.caseSelectionSize,
  });
  const selectedCases = selection.cases;
  const dataset = createPhase74SelectedDatasetBundle({
    bundle: preparedDataset,
    cases: selectedCases,
  });
  const models = resolvePhase74LiveModels(env);
  const rerankerMode = options.rerankerMode ?? "provider";
  const evaluatorSource = await verifyPhase74EvaluatorSource({
    declared: resolvePhase74EvaluatorSource(env),
    repoRoot: process.cwd(),
  });
  const promptSha256s = phase74LivePromptSha256s();
  const protectionBlueprint =
    await loadPhase74ProtectionBlueprintDescriptor(
      options.protectionBlueprintPath,
    );
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const runDirectory = join(resolve(options.outputDir), options.runId);
  await mkdir(runDirectory, { recursive: true });
  const releaseRunLock = await acquirePhase74RunLock(runDirectory);
  try {
  const selectedCaseIdsSha256 = sha256(
    JSON.stringify(selectedCases.map(({ caseId }) => caseId)),
  );
  const identity = buildEvalRunIdentity({
    answerModel: publicModelIdentity(models.answer),
    benchmark: `${options.benchmark}-full`,
    configuration: buildPhase74FullRunIdentityConfiguration({
      caseConcurrency: options.caseConcurrency ?? 1,
      callBudget: {
        embeddingSpendLimitUsd: options.embeddingSpendLimitUsd,
        maxLanguageCalls: options.maxLanguageCalls,
      },
      dataset: dataset.manifest as unknown as EvalRunJsonObject,
      embedding: buildPhase74EmbeddingIdentity(models.embedding),
      evaluatorSource,
      protectionBlueprint,
      replicate: options.replicate,
      reranker: rerankerMode === "deterministic"
        ? {
            implementation: "lexical-coverage-v1",
            mode: "deterministic",
          }
        : {
            ...publicModelIdentity(models.reranker),
            implementation: "provider-listwise-v1",
            mode: "provider",
          },
      scoring: buildPhase74ProtocolScoringIdentity(
        options.benchmark,
        publicModelIdentity(models.judge),
      ),
      selection: selection.identity,
      selectedCaseIdsSha256,
    }),
    datasetSha256: dataset.manifest.datasetSha256,
    generatedAt,
    generatedBy: "scripts/run-phase-74-generalization.ts",
    judgeModel: publicModelIdentity(models.judge),
    promptSha256s,
    runId: options.runId,
  });
  const prefix = options.stage.toLowerCase();
  await persistRunIdentity({ identity, runDirectory });
  const callBudget = createPhase74DurableCallBudget({
    embeddingSpendLimitUsd: options.embeddingSpendLimitUsd,
    fetch: globalThis.fetch,
    maxLanguageCalls: options.maxLanguageCalls,
    path: join(runDirectory, `${prefix}-call-budget.json`),
  });
  const usagePath = join(runDirectory, `${prefix}-model-usage.jsonl`);
  const usageIntentsPath = join(
    runDirectory,
    `${prefix}-model-usage-intents.jsonl`,
  );
  const directUsage = reconcilePhase74PendingModelUsageSync({
    eventsPath: usagePath,
    ledger: await loadPhase74ModelUsageLedger({
      eventsPath: usagePath,
      intentsPath: usageIntentsPath,
    }),
  });
  const events = directUsage.events;
  const intents = directUsage.intents;
  const ingestionUses: Array<{
    costTrace: NonNullable<Phase74RetrievalSnapshot["costTrace"]>;
  }> = [];
  const onUsageEvent = (event: AttributedModelUsageAttempt) => {
    appendPhase74ModelUsageEventSync(usagePath, event);
  };
  const onUsageIntent = (intent: AttributedModelUsageIntent) => {
    appendPhase74ModelUsageIntentSync(usageIntentsPath, intent);
  };
  const retrieval = createPhase74FullRetrievalRuntime({
    datasetSha256: dataset.manifest.datasetSha256,
    evaluatorSourceSha256: evaluatorSource.sha256,
    events,
    intents,
    models,
    onIngestionUse: (costTrace) => ingestionUses.push({ costTrace }),
    runDirectory,
    onUsageEvent,
    onUsageIntent,
    promptSha256s,
    rerankerMode,
  });
  const reader = createPhase74LiveReader({
    events,
    intents,
    model: models.answer,
    onUsageEvent,
    onUsageIntent,
  });
  const judge = createPhase74LiveJudge({
    events,
    intents,
    model: models.judge,
    onUsageEvent,
    onUsageIntent,
  });
  const protocolCompatibleAssessment = createPhase74ProtocolCompatibleAnswerAssessor({
    benchmark: options.benchmark,
    events,
    intents,
    model: models.judge,
    onUsageEvent,
    onUsageIntent,
  });
  const countRenderedTokens = (content: string) =>
    Buffer.byteLength(content, "utf8");
  const protocolReader = createPhase74ProtocolReader({
    contextTokenBudget: CONTEXT_TOKEN_BUDGET,
    countRenderedTokens,
    reader,
  });
  const snapshots: Phase74RetrievalSnapshot[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = callBudget.fetch;
  let report: Phase74GeneralizationReport;
  try {
    report = await runPhase74Generalization({
      assessAnswer: protocolCompatibleAssessment,
      caseConcurrency: options.caseConcurrency ?? 1,
      cases: selectedCases,
      checkpoint: createPhase74FileCheckpoint(join(runDirectory, "checkpoints")),
      contextTokenBudget: CONTEXT_TOKEN_BUDGET,
      countRenderedTokens,
      executeRetrieval: retrieval.execute,
      genericReader: reader,
      identity,
      includeOracle: options.stage === "E4",
      judge,
      onRetrievalSnapshot: (snapshot) => {
        snapshots.push(snapshot);
      },
      persistIdentity: (nextIdentity) => persistRunIdentity({
        identity: nextIdentity,
        runDirectory,
      }),
      protocolReader,
      renderEvidenceLedger: retrieval.render,
      serializeMemoryGroups: false,
      stages: [options.stage],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  const experimentIdentityHash = hashEvalExperimentIdentity(report.identity);
  const ingestionAllocation = options.stage === "E4"
    ? null
    : buildPhase74IngestionUsageAllocation([...snapshots, ...ingestionUses]);
  const modelUsage = options.stage === "E4"
    ? null
    : buildPhase74ModelUsageEvidence({
        direct: {
          events,
          intents,
          pendingIntents: [],
        },
        expected: {
          baselineCaseIds: selectedCases.map(
            (testCase) => buildPhase74LabelFreeCaseBoundary(testCase).caseKey,
          ),
          candidateCaseIds: selectedCases.map(
            (testCase) => buildPhase74LabelFreeCaseBoundary(testCase).caseKey,
          ),
        },
        ingestion: {
          baselineExclusive: await loadPhase74IngestionUsagePool({
            keys: ingestionAllocation!.baselineExclusive,
            runDirectory,
          }),
          candidateExclusive: await loadPhase74IngestionUsagePool({
            keys: ingestionAllocation!.candidateExclusive,
            runDirectory,
          }),
          shared: await loadPhase74IngestionUsagePool({
            keys: ingestionAllocation!.shared,
            runDirectory,
          }),
        },
      });
  const endToEndScores = Object.fromEntries(
    [...new Set(report.executions.map(({ arm }) => arm))].map((arm) => {
      const armCases = report.executions.filter((result) => result.arm === arm);
      const scored = armCases.filter(
        (result): result is typeof result & { correct: boolean; score: number } =>
          result.correct !== undefined && result.score !== undefined,
      );
      return [arm, {
        meanFamilyScore: scored.length === 0
          ? null
          : scored.reduce((sum, { score }) => sum + score, 0) / scored.length,
        semanticAccuracy: scored.length === 0
          ? null
          : scored.filter(({ correct }) => correct).length / scored.length,
        caseCount: armCases.length,
        scoredCaseCount: scored.length,
      }];
    }),
  );

  await Promise.all([
    writeJson(
      join(runDirectory, "dataset-manifest.json"),
      dataset.manifest,
    ),
    writeJsonLines(
      join(runDirectory, `${prefix}-progress.jsonl`),
      options.stage === "E4" ? report.e4.cases : report.executions,
    ),
    writeJsonLines(
      join(runDirectory, `${prefix}-retrieval-packets.jsonl`),
      snapshots,
    ),
    writeFile(usagePath, "", { encoding: "utf8", flag: "a" }),
    writeFile(usageIntentsPath, "", { encoding: "utf8", flag: "a" }),
    writeJson(
      join(runDirectory, `${prefix}-model-usage-summary.json`),
      modelUsage ?? {
        reason: "E4 has no frozen baseline/candidate product-cost pair.",
        status: "not_applicable",
      },
    ),
    writeJson(
      join(runDirectory, `${prefix}-report.json`),
      report,
    ),
    writeJson(
      join(runDirectory, `${prefix}-summary.json`),
      {
        ...report.summary,
        benchmark: options.benchmark,
        comparison: options.stage === "E4"
          ? null
          : buildPhase74ReplicateComparison({
              benchmark: options.benchmark,
              selectedCaseIdsSha256,
              stage: options.stage,
            }),
        endToEndScores,
        experimentIdentityHash,
        identityHash: report.identityHash,
        callBudget: callBudget.snapshot(),
        modelUsage,
        replicate: options.replicate,
        stage: options.stage,
        status: report.status,
      },
    ),
    ...(options.stage === "E4"
      ? [
          writeJsonLines(
            join(runDirectory, "oracle-matrix.jsonl"),
            report.oracle,
          ),
          writeJson(join(runDirectory, "promotion-gate.json"), {
            reason:
              "Full public datasets are seen-case diagnostics until sealed independent evidence exists.",
            seenCasesOnly: true,
            status: "not_evaluable",
          }),
        ]
      : []),
  ]);
  return { dataset, report, runDirectory };
  } finally {
    await releaseRunLock();
  }
}

export async function runPhase74GeneralizationSmoke(
  options: Phase74GeneralizationSmokeOptions = {},
): Promise<Phase74GeneralizationSmokeResult> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const runId = options.runId ?? modelSafeRunId(generatedAt);
  assertCliPathSegmentValue({ flag: "--run-id", value: runId });
  const datasetPath = resolve(options.datasetPath ?? DEFAULT_DATASET_PATH);
  const outputDir = resolve(options.outputDir ?? DEFAULT_OUTPUT_DIR);
  const runDirectory = join(outputDir, runId);
  await mkdir(runDirectory, { recursive: true });
  const rawDataset = await readFile(datasetPath, "utf8");
  const testCases = validateLongMemEvalCases(JSON.parse(rawDataset));
  const generalizationCases = testCases.map(buildGeneralizationCase);
  const casesByKey = new Map(generalizationCases.map((testCase, index) => [
    buildPhase74LabelFreeCaseBoundary(testCase).caseKey,
    testCases[index]!,
  ]));
  const selectedCaseIdsSha256 = sha256(
    JSON.stringify(testCases.map(({ questionId }) => questionId)),
  );
  const identity = buildEvalRunIdentity({
    answerModel: {
      gateway: "deterministic://phase74-generic-reader",
      model: "phase74-generic-extractive-reader-v1",
      provider: "deterministic",
    },
    benchmark: "longmemeval-smoke",
    configuration: {
      answer: { maxTokens: 512, temperature: 0 },
      context: {
        maxTokens: CONTEXT_TOKEN_BUDGET,
        tokenizer: "utf8-byte-upper-bound-v1",
      },
      modelUsageAccounting: "not-applicable-deterministic-smoke-v1",
      preRankLimit: PRE_RANK_LIMIT,
      reader: "generic-label-free-v1",
      replicate: 1,
      selectedCaseIdsSha256,
      selectedLimit: SELECTED_LIMIT,
      smoke: true,
    },
    datasetSha256: sha256(rawDataset),
    generatedAt,
    generatedBy: "scripts/run-phase-74-generalization.ts",
    judgeModel: {
      gateway: "deterministic://phase74-independent-judge",
      model: "phase74-independent-deterministic-judge-v1",
      provider: "deterministic",
    },
    promptSha256s: {
      genericReader: sha256(deterministicGenericReader.toString()),
      judge: sha256(deterministicJudge.toString()),
      protocolReader: sha256("phase74-smoke-protocol-reader-v1"),
    },
    runId,
  });
  const snapshots: RuntimeSnapshot[] = [];
  const report = await runPhase74Generalization({
    cases: generalizationCases,
    checkpoint: createPhase74FileCheckpoint(join(runDirectory, "checkpoints")),
    contextTokenBudget: CONTEXT_TOKEN_BUDGET,
    countRenderedTokens: (content) => Buffer.byteLength(content, "utf8"),
    executeRetrieval: async ({ arm, configuration, stage, testCase }) => {
      const benchmarkCase = casesByKey.get(testCase.caseId);
      if (!benchmarkCase) {
        throw new Error(`Unknown LongMemEval smoke case ${testCase.caseId}`);
      }
      const snapshot = await executeLongMemEvalRetrieval({
        arm,
        configuration,
        runId,
        stage,
        testCase: benchmarkCase,
      });
      return snapshot;
    },
    genericReader: async (input) => deterministicGenericReader(input),
    identity,
    judge: async (input) => deterministicJudge(input),
    onRetrievalSnapshot: (snapshot) => {
      snapshots.push(snapshot as RuntimeSnapshot);
    },
    persistIdentity: async (nextIdentity) => {
      const identityPath = join(runDirectory, "run-identity.json");
      await createOrMatchEvalRunIdentity({
        identity: nextIdentity,
        path: identityPath,
        persistence: {
          async create(path, content) {
            await writeFile(path, content, { encoding: "utf8", flag: "wx" });
          },
          async read(path) {
            try {
              return await readFile(path, "utf8");
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                return null;
              }
              throw error;
            }
          },
        },
      });
      return JSON.parse(await readFile(identityPath, "utf8"));
    },
    protocolReader: createPhase74ProtocolReader({
      contextTokenBudget: CONTEXT_TOKEN_BUDGET,
      countRenderedTokens: (content) => Buffer.byteLength(content, "utf8"),
      reader: async (input) => deterministicGenericReader(input),
    }),
    renderEvidenceLedger: async ({ format, snapshot }) => {
      const rendered = snapshot.evidenceLedgers?.[format];
      if (rendered === undefined) {
        throw new Error(
          `Phase 74 snapshot ${snapshot.snapshotId} has no ${format} evidence ledger.`,
        );
      }
      return rendered;
    },
  });

  const publicSnapshots = snapshots.map((snapshot) => ({
    retrievedMemories: snapshot.retrievedMemories,
    snapshotId: snapshot.snapshotId,
    storedMemories: snapshot.storedMemories,
  }));
  await Promise.all([
    writeJson(join(runDirectory, "snapshot-manifest.json"), {
      datasetSha256: identity.datasetSha256,
      replay: "content-hashed-file-checkpoints",
      schemaVersion: 1,
      selectedCaseIdsSha256,
      snapshotIds: publicSnapshots.map(({ snapshotId }) => snapshotId),
    }),
    writeJsonLines(join(runDirectory, "progress.jsonl"), report.executions),
    writeJsonLines(join(runDirectory, "cases.jsonl"), report.executions),
    writeJsonLines(
      join(runDirectory, "retrieval-packets.jsonl"),
      publicSnapshots,
    ),
    writeJsonLines(join(runDirectory, "oracle-matrix.jsonl"), report.oracle),
    writeJsonLines(join(runDirectory, "e4-formats.jsonl"), report.e4.cases),
    writeJson(join(runDirectory, "summary.json"), {
      ...report.summary,
      identityHash: report.identityHash,
      selectedEvidenceLedgerFormat: report.e4.selectedFormat,
      status: report.status,
    }),
    writeJson(join(runDirectory, "inference.json"), {
      reason: "A deterministic smoke run has no repeated-run inference.",
      status: "not_evaluable",
    }),
    writeJson(join(runDirectory, "promotion-gate.json"), {
      reason: report.reason,
      status: "not_evaluable",
    }),
    writeJsonLines(join(runDirectory, "model-usage.jsonl"), [{
      liveModelRequestCount: 0,
      reason: "Deterministic smoke; live usage evidence was not collected.",
      status: "not_applicable",
    }]),
    writeJson(join(runDirectory, "report.json"), report),
  ]);

  return { report, runDirectory };
}

export type Phase74GeneralizationCliOptions =
  | ({
      benchmark: "longmemeval";
      mode: "smoke";
    } & Phase74GeneralizationSmokeOptions)
  | {
      benchmark: "locomo" | "longmemeval";
      benchmarkRoot: string;
      caseSelectionSeed?: number;
      caseSelectionSize?: number;
      caseConcurrency?: number;
      embeddingSpendLimitUsd: number;
      maxLanguageCalls: number;
      mode: "full";
      outputDir: string;
      protectionBlueprintPath: string;
      replicate: 1 | 2 | 3;
      rerankerMode?: "deterministic" | "provider";
      runId: string;
      stage: "E1" | "E2" | "E3" | "E4";
    };

export function parsePhase74GeneralizationCliOptions(
  args: readonly string[],
): Phase74GeneralizationCliOptions {
  const readFlag = (name: string) => resolveCliFlagValueStrict(args, name);
  const mode = readFlag("--mode") ?? "smoke";
  const benchmark = readFlag("--benchmark") ?? "longmemeval";
  if (mode === "smoke") {
    if (benchmark !== "longmemeval") {
      throw new Error("Phase 74 smoke supports only --benchmark longmemeval.");
    }
    return {
      benchmark,
      ...(readFlag("--dataset-path") === undefined
        ? {}
        : { datasetPath: readFlag("--dataset-path") }),
      mode,
      ...(readFlag("--output-dir") === undefined
        ? {}
        : { outputDir: readFlag("--output-dir") }),
      ...(readFlag("--run-id") === undefined
        ? {}
        : { runId: readFlag("--run-id") }),
    };
  }
  if (mode !== "full") {
    throw new Error("--mode must be smoke or full.");
  }
  if (benchmark !== "longmemeval" && benchmark !== "locomo") {
    throw new Error("--benchmark must be longmemeval or locomo.");
  }
  const benchmarkRoot = readFlag("--benchmark-root");
  const outputDir = readFlag("--output-dir");
  const protectionBlueprintPath = readFlag("--protection-blueprint");
  const runId = readFlag("--run-id");
  const rawCaseSelectionSeed = readFlag("--case-selection-seed");
  const rawCaseSelectionSize = readFlag("--case-selection-size");
  const rawCaseConcurrency = readFlag("--case-concurrency");
  const rawEmbeddingSpendLimitUsd = readFlag("--embedding-spend-limit-usd") ??
    String(DEFAULT_EMBEDDING_SPEND_LIMIT_USD);
  const rawMaxLanguageCalls = readFlag("--max-language-calls") ??
    String(DEFAULT_MAX_LANGUAGE_CALLS);
  if (
    (rawCaseSelectionSeed === undefined) !==
      (rawCaseSelectionSize === undefined)
  ) {
    throw new Error(
      "--case-selection-seed and --case-selection-size must be provided together.",
    );
  }
  if (
    rawCaseSelectionSeed !== undefined &&
    (!/^\d+$/u.test(rawCaseSelectionSeed) ||
      !Number.isSafeInteger(Number(rawCaseSelectionSeed)))
  ) {
    throw new Error("--case-selection-seed must be a non-negative integer.");
  }
  if (
    rawCaseSelectionSize !== undefined &&
    (!/^[1-9]\d*$/u.test(rawCaseSelectionSize) ||
      !Number.isSafeInteger(Number(rawCaseSelectionSize)))
  ) {
    throw new Error("--case-selection-size must be a positive integer.");
  }
  if (
    rawCaseConcurrency !== undefined &&
    (!/^[1-9]\d*$/u.test(rawCaseConcurrency) ||
      !Number.isSafeInteger(Number(rawCaseConcurrency)))
  ) {
    throw new Error("--case-concurrency must be a positive integer.");
  }
  const embeddingSpendLimitUsd = Number(rawEmbeddingSpendLimitUsd);
  if (
    !Number.isFinite(embeddingSpendLimitUsd) ||
    embeddingSpendLimitUsd <= 0
  ) {
    throw new Error("--embedding-spend-limit-usd must be a positive number.");
  }
  if (
    !/^[1-9]\d*$/u.test(rawMaxLanguageCalls) ||
    !Number.isSafeInteger(Number(rawMaxLanguageCalls))
  ) {
    throw new Error("--max-language-calls must be a positive integer.");
  }
  const rawReplicate = readFlag("--replicate");
  if (rawReplicate !== "1" && rawReplicate !== "2" && rawReplicate !== "3") {
    throw new Error("--replicate must be 1, 2, or 3.");
  }
  const stage = readFlag("--stage");
  if (stage !== "E1" && stage !== "E2" && stage !== "E3" && stage !== "E4") {
    throw new Error("--stage must be E1, E2, E3, or E4.");
  }
  const rerankerMode = readFlag("--reranker-mode");
  if (
    rerankerMode !== undefined &&
    rerankerMode !== "deterministic" &&
    rerankerMode !== "provider"
  ) {
    throw new Error("--reranker-mode must be deterministic or provider.");
  }
  if (!benchmarkRoot || !outputDir || !protectionBlueprintPath || !runId) {
    throw new Error(
      "Phase 74 full mode requires --benchmark-root, --output-dir, --protection-blueprint, and --run-id.",
    );
  }
  assertCliPathSegmentValue({ flag: "--run-id", value: runId });
  return {
    benchmark,
    benchmarkRoot,
    ...(rawCaseConcurrency === undefined
      ? {}
      : { caseConcurrency: Number(rawCaseConcurrency) }),
    ...(rawCaseSelectionSeed === undefined
      ? {}
      : { caseSelectionSeed: Number(rawCaseSelectionSeed) }),
    ...(rawCaseSelectionSize === undefined
      ? {}
      : { caseSelectionSize: Number(rawCaseSelectionSize) }),
    embeddingSpendLimitUsd,
    maxLanguageCalls: Number(rawMaxLanguageCalls),
    mode,
    outputDir,
    protectionBlueprintPath: resolve(protectionBlueprintPath),
    replicate: Number(rawReplicate) as 1 | 2 | 3,
    ...(rerankerMode === undefined ? {} : { rerankerMode }),
    runId,
    stage,
  };
}

if (import.meta.main) {
  const options = parsePhase74GeneralizationCliOptions(process.argv);
  const result = options.mode === "smoke"
    ? await runPhase74GeneralizationSmoke({
        datasetPath: options.datasetPath,
        outputDir: options.outputDir,
        runId: options.runId,
      })
    : await runPhase74GeneralizationFull(options);
  console.log(JSON.stringify({
    runDirectory: result.runDirectory,
    status: result.report.status,
    summary: result.report.summary,
  }, null, 2));
}
