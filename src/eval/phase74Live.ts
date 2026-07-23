import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { promisify } from "node:util";

import { z } from "zod";

import {
  createOpenRouterEmbeddingFetch,
  requestOpenAICompatibleObjectResult,
  requestOpenAICompatibleTextResult,
  stripThinkingBlocks,
  withAISDKRetries,
} from "../provider/ai-sdk-runtime";
import type {
  AISDKModelConfig,
  EmbeddingNormalization,
  FetchLike,
} from "../provider/ai-sdk-runtime";
import {
  COMPACT_CONVERSATIONAL_MEMORY_EXTRACTION_SYSTEM_PROMPT,
  MEMORY_EXTRACTION_SYSTEM_PROMPT,
} from "../provider/memory-extractor";
import {
  normalizeAISDKLanguageModelUsage,
  runWithModelUsageAttempt,
} from "../provider/model-usage";
import { RECALL_PLAN_ASSISTANT_SYSTEM_PROMPT } from "../provider/recall-plan-assistant";
import { POINTWISE_RERANKER_SYSTEM_PROMPT } from "../provider/reranker";
import { PHASE74_PROTOCOL_READER_SYSTEM_PROMPT } from "./phase74ProtocolReader";
import { createAttributedModelUsageSink } from "./modelUsage";
import type {
  AttributedModelUsageAttempt,
  AttributedModelUsageIntent,
  Phase74ModelUsageBranch,
} from "./modelUsage";
import type {
  OracleMatrixJudge,
  OracleMatrixReader,
} from "./oracleMatrix";
import {
  PHASE74_EMBEDDING_CALL_CONFIGURATION,
  PHASE74_PROVIDER_OBJECT_CALL_CONFIGURATION,
} from "./phase74ProviderConfiguration";

export const PHASE74_LANGUAGE_MODEL = "gpt-5.6-terra";
export const PHASE74_JUDGE_MODEL = "gpt-5.5";
export const PHASE74_GATEWAY = "https://ai.gurkiai.com/v1";
export const PHASE74_EMBEDDING_GATEWAY = "https://openrouter.ai/api/v1";
export const PHASE74_EMBEDDING_MODEL = "text-embedding-3-small";
export const PHASE74_BGE_M3_EMBEDDING_MODEL = "baai/bge-m3";

const PHASE74_EMBEDDING_PROFILES = {
  [PHASE74_EMBEDDING_MODEL]: {
    adapterVersion: "openai-compatible-embedding-v1",
    kind: "legacy",
  },
  [PHASE74_BGE_M3_EMBEDDING_MODEL]: {
    adapterVersion: "openai-compatible-embedding-v2",
    allowFallbacks: false,
    dimensions: 1_024,
    inputCostUsdPerMillionTokens: 0.01,
    kind: "bge-m3",
    normalization: "l2-v1",
    providerOrder: ["parasail"],
  },
} as const;

export const PHASE74_GENERIC_READER_SYSTEM_PROMPT = [
  "Answer the user's question using only the supplied memory evidence.",
  "Do not infer benchmark protocols or invent missing details.",
  "If the evidence is insufficient, say that the answer cannot be determined.",
].join(" ");

export const PHASE74_CORRECTNESS_JUDGE_SYSTEM_PROMPT = [
  "Judge whether the candidate answer is semantically correct for the question",
  "given the reference answer. Return strict JSON with correct and reasoning.",
].join(" ");

export const PHASE74_EVALUATOR_SOURCE_SNAPSHOT = {
  files: [
    "bun.lock",
    "package.json",
    "scripts/build-phase-74-protection-evidence.ts",
    "scripts/cli-options.ts",
    "scripts/aggregate-phase-74-generalization.ts",
    "scripts/phase-74-memory-agent-bench-protection.ts",
    "scripts/phase-74-halumem-live-providers.ts",
    "scripts/phase-74-halumem-protection.ts",
    "scripts/prepare-phase-65-locomo-data.ts",
    "scripts/prepare-phase-74-datasets.ts",
    "scripts/run-eval.ts",
    "scripts/run-phase-64-memory-agent-bench-smoke.ts",
    "scripts/run-phase-74-beam-safety-protection.ts",
    "scripts/run-phase-74-generalization-executor.ts",
    "scripts/run-phase-74-generalization-scorer.ts",
    "scripts/run-phase-74-generalization.ts",
    "scripts/run-phase-74-halumem-live-protection.ts",
    "scripts/run-phase-74-halumem-protection.ts",
    "scripts/run-phase-74-memory-agent-bench-protection.ts",
    "scripts/run-phase-74-storage-scale-gate.ts",
    "scripts/script-paths.ts",
  ],
  sourceExtensions: [".cts", ".mts", ".ts"],
  sourceTrees: ["src"],
  version: 6,
} as const;

export interface Phase74EvaluatorSource {
  readonly [key: string]: string;
  commit: string;
  sha256: string;
}

export interface Phase74EvaluatorSourceVerificationDependencies {
  hashSnapshot(repoRoot: string): Promise<string>;
  resolveGitHead(repoRoot: string): Promise<string>;
  resolveSourceStatus(repoRoot: string): Promise<string>;
}

const execFileAsync = promisify(execFile);

export function phase74LivePromptSha256s(): Record<string, string> {
  const hash = (value: string) =>
    createHash("sha256").update(value).digest("hex");
  return {
    assistedExtraction: hash(MEMORY_EXTRACTION_SYSTEM_PROMPT),
    conversationalExtraction: hash(
      COMPACT_CONVERSATIONAL_MEMORY_EXTRACTION_SYSTEM_PROMPT,
    ),
    genericReader: hash(PHASE74_GENERIC_READER_SYSTEM_PROMPT),
    judge: hash(PHASE74_CORRECTNESS_JUDGE_SYSTEM_PROMPT),
    planner: hash(RECALL_PLAN_ASSISTANT_SYSTEM_PROMPT),
    protocolReader: hash([
      PHASE74_PROTOCOL_READER_SYSTEM_PROMPT,
      PHASE74_GENERIC_READER_SYSTEM_PROMPT,
    ].join("\0")),
    reranker: hash(POINTWISE_RERANKER_SYSTEM_PROMPT),
  };
}

export interface Phase74ExecutorModels {
  answer: AISDKModelConfig;
  assistedExtraction: AISDKModelConfig;
  embedding: AISDKModelConfig;
  planner: AISDKModelConfig;
  reranker: AISDKModelConfig;
}

export interface Phase74ScorerModels {
  judge: AISDKModelConfig;
}

export interface Phase74LiveModels extends
  Phase74ExecutorModels,
  Phase74ScorerModels {}

export function resolvePhase74ReaderModel(
  env: Record<string, string | undefined>,
): AISDKModelConfig {
  const answer = modelFromEnv(env, "GOODMEMORY_EVAL");
  if (
    answer.provider !== "openai" ||
    answer.model !== PHASE74_LANGUAGE_MODEL ||
    answer.baseURL !== PHASE74_GATEWAY
  ) {
    throw new Error(
      `Phase 74 language calls require ${PHASE74_LANGUAGE_MODEL} through ${PHASE74_GATEWAY}.`,
    );
  }
  return answer;
}

export interface Phase74EmbeddingIdentity {
  readonly [key: string]: boolean | number | string;
  adapterVersion:
    | "openai-compatible-embedding-v1"
    | "openai-compatible-embedding-v2";
  batchMaxConcurrency: number;
  batchMaxInputs: number;
  batchMaxUtf8Bytes: number;
  gateway: string;
  model: string;
  provider: string;
  requestTimeoutMs: number;
  retryLimit: number;
}

export interface Phase74EmbeddingAdapterOptions {
  expectedDimensions?: number;
  fetch?: FetchLike;
  normalization?: EmbeddingNormalization;
}

function resolvePhase74EmbeddingProfile(model: AISDKModelConfig) {
  const profile =
    PHASE74_EMBEDDING_PROFILES[
      model.model as keyof typeof PHASE74_EMBEDDING_PROFILES
    ];
  if (!profile) {
    throw new Error(
      `Phase 74 embedding calls require a supported profile through ${PHASE74_EMBEDDING_GATEWAY}.`,
    );
  }
  if (
    model.provider !== "openai" ||
    model.baseURL !== PHASE74_EMBEDDING_GATEWAY
  ) {
    throw new Error(
      `Phase 74 embedding calls require ${model.model} through ${PHASE74_EMBEDDING_GATEWAY}.`,
    );
  }
  return profile;
}

export function resolvePhase74EmbeddingAdapterOptions(
  model: AISDKModelConfig,
  fetch?: FetchLike,
): Phase74EmbeddingAdapterOptions {
  const profile = resolvePhase74EmbeddingProfile(model);
  if (profile.kind === "legacy") {
    return {};
  }
  return {
    expectedDimensions: profile.dimensions,
    fetch: createOpenRouterEmbeddingFetch({
      allowFallbacks: profile.allowFallbacks,
      baseFetch: fetch,
      providerOrder: profile.providerOrder,
    }),
    normalization: profile.normalization,
  };
}

export function buildPhase74EmbeddingIdentity(
  model: AISDKModelConfig,
): Phase74EmbeddingIdentity {
  if (!model.baseURL) {
    throw new Error("Phase 74 embedding identity requires a base URL.");
  }
  const profile = resolvePhase74EmbeddingProfile(model);
  if (profile.kind === "bge-m3") {
    return {
      adapterVersion: profile.adapterVersion,
      allowFallbacks: profile.allowFallbacks,
      ...PHASE74_EMBEDDING_CALL_CONFIGURATION,
      dimensions: profile.dimensions,
      gateway: model.baseURL,
      inputCostUsdPerMillionTokens: profile.inputCostUsdPerMillionTokens,
      model: model.model,
      normalization: profile.normalization,
      provider: model.provider,
      providerOrder: profile.providerOrder.join(","),
    };
  }
  return {
    adapterVersion: profile.adapterVersion,
    ...PHASE74_EMBEDDING_CALL_CONFIGURATION,
    gateway: model.baseURL,
    model: model.model,
    provider: model.provider,
  };
}

export function resolvePhase74EvaluatorSource(
  env: Record<string, string | undefined>,
): Phase74EvaluatorSource {
  const commit = env.GOODMEMORY_PHASE74_SOURCE_COMMIT ?? "";
  const sha256 = env.GOODMEMORY_PHASE74_SOURCE_SHA256 ?? "";
  if (!/^[0-9a-f]{40}$/iu.test(commit) || !/^[0-9a-f]{64}$/iu.test(sha256)) {
    throw new Error(
      "Phase 74 evaluator source requires an exact 40-character commit and 64-character SHA-256.",
    );
  }
  return { commit: commit.toLowerCase(), sha256: sha256.toLowerCase() };
}

async function listSourceSnapshotFiles(
  repoRoot: string,
): Promise<string[]> {
  const paths: string[] = [...PHASE74_EVALUATOR_SOURCE_SNAPSHOT.files];
  const sourceExtensions = new Set<string>(
    PHASE74_EVALUATOR_SOURCE_SNAPSHOT.sourceExtensions,
  );

  async function visit(relativeDirectory: string): Promise<void> {
    const entries = await readdir(join(repoRoot, relativeDirectory), {
      withFileTypes: true,
    });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = join(relativeDirectory, entry.name);
      if (entry.isDirectory()) {
        await visit(relativePath);
      } else if (entry.isFile() && sourceExtensions.has(extname(entry.name))) {
        paths.push(relativePath);
      }
    }
  }

  for (const sourceTree of PHASE74_EVALUATOR_SOURCE_SNAPSHOT.sourceTrees) {
    await visit(sourceTree);
  }
  return paths.sort();
}

export async function hashPhase74EvaluatorSourceSnapshot(
  repoRoot: string,
): Promise<string> {
  const hash = createHash("sha256");
  hash.update(`phase74-evaluator-source-v${PHASE74_EVALUATOR_SOURCE_SNAPSHOT.version}\0`);
  for (const relativePath of await listSourceSnapshotFiles(repoRoot)) {
    const content = await readFile(join(repoRoot, relativePath));
    hash.update(`${Buffer.byteLength(relativePath)}:${relativePath}\0`);
    hash.update(`${content.byteLength}:`);
    hash.update(content);
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function resolvePhase74GitHead(repoRoot: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return stdout.trim();
}

async function resolvePhase74SourceStatus(repoRoot: string): Promise<string> {
  const [tracked, snapshot] = await Promise.all([
    execFileAsync(
      "git",
      ["status", "--porcelain=v1", "--untracked-files=no"],
      { cwd: repoRoot, encoding: "utf8" },
    ),
    execFileAsync(
      "git",
      [
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
        "--",
        ...PHASE74_EVALUATOR_SOURCE_SNAPSHOT.files,
        ...PHASE74_EVALUATOR_SOURCE_SNAPSHOT.sourceTrees,
      ],
      { cwd: repoRoot, encoding: "utf8" },
    ),
  ]);
  return `${tracked.stdout}${snapshot.stdout}`;
}

export async function capturePhase74EvaluatorSource(input: {
  dependencies?: Phase74EvaluatorSourceVerificationDependencies;
  repoRoot: string;
}): Promise<Phase74EvaluatorSource> {
  const dependencies = input.dependencies ?? {
    hashSnapshot: hashPhase74EvaluatorSourceSnapshot,
    resolveGitHead: resolvePhase74GitHead,
    resolveSourceStatus: resolvePhase74SourceStatus,
  };
  const statusBefore = await dependencies.resolveSourceStatus(input.repoRoot);
  const commitBefore = await dependencies.resolveGitHead(input.repoRoot);
  if (statusBefore.trim() !== "") {
    throw new Error(
      "Phase 74 tracked tree or evaluator source snapshot is dirty.",
    );
  }
  const sha256 = await dependencies.hashSnapshot(input.repoRoot);
  const commitAfter = await dependencies.resolveGitHead(input.repoRoot);
  const statusAfter = await dependencies.resolveSourceStatus(input.repoRoot);
  if (statusAfter.trim() !== "") {
    throw new Error(
      "Phase 74 tracked tree or evaluator source snapshot is dirty after hashing.",
    );
  }
  const source = {
    commit: commitAfter.trim().toLowerCase(),
    sha256: sha256.trim().toLowerCase(),
  };
  const initialCommit = commitBefore.trim().toLowerCase();
  if (
    !/^[0-9a-f]{40}$/u.test(initialCommit) ||
    !/^[0-9a-f]{40}$/u.test(source.commit) ||
    !/^[0-9a-f]{64}$/u.test(source.sha256)
  ) {
    throw new Error("Phase 74 checkout returned an invalid source identity.");
  }
  if (initialCommit !== source.commit) {
    throw new Error(
      "Phase 74 git HEAD changed while evaluator source was captured.",
    );
  }
  return source;
}

export async function verifyPhase74EvaluatorSource(input: {
  declared: Phase74EvaluatorSource;
  dependencies?: Phase74EvaluatorSourceVerificationDependencies;
  repoRoot: string;
}): Promise<Phase74EvaluatorSource> {
  const actual = await capturePhase74EvaluatorSource({
    dependencies: input.dependencies,
    repoRoot: input.repoRoot,
  });
  if (actual.commit !== input.declared.commit.toLowerCase()) {
    throw new Error(
      "Phase 74 evaluator source commit does not match git HEAD.",
    );
  }
  if (actual.sha256 !== input.declared.sha256.toLowerCase()) {
    throw new Error(
      "Phase 74 evaluator source snapshot SHA-256 does not match the checkout.",
    );
  }
  return actual;
}

function requiredEnv(
  env: Record<string, string | undefined>,
  name: string,
): string {
  const value = env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing required Phase 74 environment variable ${name}.`);
  }
  return value;
}

function modelFromEnv(
  env: Record<string, string | undefined>,
  prefix: string,
): AISDKModelConfig {
  return {
    apiKey: requiredEnv(env, `${prefix}_API_KEY`),
    baseURL: requiredEnv(env, `${prefix}_BASE_URL`),
    model: requiredEnv(env, `${prefix}_MODEL`),
    provider: requiredEnv(env, `${prefix}_PROVIDER`) as "openai",
  };
}

export function resolvePhase74ExecutorModels(
  env: Record<string, string | undefined>,
): Phase74ExecutorModels {
  const answer = resolvePhase74ReaderModel(env);
  const embedding = modelFromEnv(env, "GOODMEMORY_EMBEDDING");
  resolvePhase74EmbeddingProfile(embedding);
  return {
    answer,
    assistedExtraction: answer,
    embedding,
    planner: answer,
    reranker: answer,
  };
}

export function resolvePhase74ScorerModels(
  env: Record<string, string | undefined>,
): Phase74ScorerModels {
  const judge = modelFromEnv(env, "GOODMEMORY_JUDGE");
  if (
    judge.provider !== "openai" ||
    judge.model !== PHASE74_JUDGE_MODEL ||
    judge.baseURL !== PHASE74_GATEWAY
  ) {
    throw new Error(
      `Phase 74 judging requires independent ${PHASE74_JUDGE_MODEL} through ${PHASE74_GATEWAY}.`,
    );
  }
  return { judge };
}

export function resolvePhase74LiveModels(
  env: Record<string, string | undefined>,
): Phase74LiveModels {
  return {
    ...resolvePhase74ExecutorModels(env),
    ...resolvePhase74ScorerModels(env),
  };
}

function readerBranch(purpose: string | undefined): Phase74ModelUsageBranch {
  if (purpose?.startsWith("final:baseline:") === true) {
    return "baseline";
  }
  if (purpose?.startsWith("final:candidate:") === true) {
    return "candidate";
  }
  if (purpose?.startsWith("oracle:") === true) {
    return "oracle_reader";
  }
  if (purpose?.startsWith("protocol:") === true) {
    return "protocol_reader";
  }
  return "shadow";
}

export function createPhase74LiveReader(input: {
  events: AttributedModelUsageAttempt[];
  fetch?: FetchLike;
  intents: AttributedModelUsageIntent[];
  model: AISDKModelConfig;
  onUsageEvent?: (event: AttributedModelUsageAttempt) => void;
  onUsageIntent?: (intent: AttributedModelUsageIntent) => void;
}): OracleMatrixReader {
  const configuration = PHASE74_PROVIDER_OBJECT_CALL_CONFIGURATION.reader;
  return async (payload) => {
    const caseId = payload.caseId ?? "unattributed";
    const sink = createAttributedModelUsageSink({
      branch: readerBranch(payload.purpose),
      caseId,
      events: input.events,
      intents: input.intents,
      onEvent: input.onUsageEvent,
      onIntent: input.onUsageIntent,
    });
    let attempt = 0;
    return withAISDKRetries(async () => {
      attempt += 1;
      return runWithModelUsageAttempt({
        attempt,
        modelId: input.model.model,
        operation: "answer_generation",
        providerId: input.model.provider,
        sink,
        run: async (report) => {
          const result = await requestOpenAICompatibleTextResult({
            fetch: input.fetch,
            maxOutputTokens: configuration.maxOutputTokens,
            model: input.model,
            prompt: `Question:\n${payload.question}\n\nMemory evidence:\n${payload.context}`,
            reasoningEffort: configuration.reasoningEffort,
            system: PHASE74_GENERIC_READER_SYSTEM_PROMPT,
            temperature: configuration.temperature,
            timeoutMs: configuration.requestTimeoutMs,
          });
          report(result.usage ?? normalizeAISDKLanguageModelUsage(undefined));
          const answer = stripThinkingBlocks(result.text);
          if (answer === "") {
            throw new Error("Phase 74 generic reader returned an empty answer.");
          }
          return answer;
        },
      });
    }, { retryLimit: configuration.retryLimit });
  };
}

const correctnessSchema = z.object({
  correct: z.boolean(),
  reasoning: z.string(),
});

export function createPhase74LiveJudge(input: {
  events: AttributedModelUsageAttempt[];
  fetch?: FetchLike;
  intents: AttributedModelUsageIntent[];
  model: AISDKModelConfig;
  onUsageEvent?: (event: AttributedModelUsageAttempt) => void;
  onUsageIntent?: (intent: AttributedModelUsageIntent) => void;
}): OracleMatrixJudge {
  const configuration =
    PHASE74_PROVIDER_OBJECT_CALL_CONFIGURATION.judge.oracle;
  return async (payload) => {
    const sink = createAttributedModelUsageSink({
      branch: "judge",
      caseId: payload.caseId ?? "unattributed",
      events: input.events,
      intents: input.intents,
      onEvent: input.onUsageEvent,
      onIntent: input.onUsageIntent,
    });
    let attempt = 0;
    return withAISDKRetries(async () => {
      attempt += 1;
      return runWithModelUsageAttempt({
        attempt,
        modelId: input.model.model,
        operation: "judge",
        providerId: input.model.provider,
        sink,
        run: async (report) => {
          const result = await requestOpenAICompatibleObjectResult({
            fetch: input.fetch,
            maxOutputTokens: configuration.maxOutputTokens,
            model: input.model,
            prompt: [
              `Question: ${payload.question}`,
              `Reference answer: ${payload.expectedAnswer}`,
              `Candidate answer: ${payload.answer}`,
            ].join("\n"),
            schema: correctnessSchema,
            reasoningEffort: configuration.reasoningEffort,
            system: PHASE74_CORRECTNESS_JUDGE_SYSTEM_PROMPT,
            temperature: configuration.temperature,
            timeoutMs: configuration.requestTimeoutMs,
          });
          report(result.usage ?? normalizeAISDKLanguageModelUsage(undefined));
          return { correct: result.object.correct };
        },
      });
    }, { retryLimit: configuration.retryLimit });
  };
}
