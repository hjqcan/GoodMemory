import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readlink,
  rm,
  symlink,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

import type {
  AISDKModelConfig,
  FetchLike,
} from "../src/provider/ai-sdk-runtime";
import {
  createAttributedModelUsageSink,
  type AttributedModelUsageAttempt,
  type AttributedModelUsageIntent,
  type Phase74ModelUsageBranch,
} from "../src/eval/modelUsage";
import {
  modelUsageCompleteness,
  normalizeAISDKEmbeddingUsage,
  normalizeOpenAICompatibleUsage,
  type ModelUsageOperation,
  type ModelTokenUsage,
} from "../src/provider/model-usage";
import { buildPhase74LabelFreeScope } from "../src/eval/phase74FullRuntime";
import {
  parsePhase74VersionWorkerInput,
  type Phase74VersionWorkerInput,
} from "../src/eval/phase74VersionBaseline";

interface Phase74VersionEvidence {
  id: string;
  linkedMemoryIds: readonly string[];
  sourceMessageIds: readonly string[];
}

interface Phase74VersionFact {
  content: string;
  id: string;
}

interface Phase74VersionRememberInput {
  annotations: Array<{
    confirmed: boolean;
    kindHint: "fact";
    messageIndex: number;
    reason: string;
    remember: "always";
    verified: boolean;
  }>;
  extractionStrategy: "llm-assisted";
  messages: Array<{
    content: string;
    id: string;
    observedAt: string;
    role: "assistant" | "user";
  }>;
  scope: { sessionId?: string; userId: string; workspaceId?: string };
}

export interface Phase74VersionGoodMemory {
  exportMemory(input: {
    scope: { userId: string; workspaceId?: string };
  }): Promise<{
    durable: {
      evidence: Phase74VersionEvidence[];
      facts: Phase74VersionFact[];
    };
  }>;
  recall(input: {
    includeEvidence: true;
    locale?: string;
    query: string;
    referenceTime?: string;
    scope: { userId: string; workspaceId?: string };
    strategy: "hybrid";
  }): Promise<{
    evidence: Phase74VersionEvidence[];
    facts: Phase74VersionFact[];
    metadata: { latencyMs: number };
  }>;
  remember(input: Phase74VersionRememberInput): Promise<{
    accepted: number;
    rejected: number;
    warnings?: string[];
  }>;
}

export type Phase74VersionCreateGoodMemory = (
  config: unknown,
) => Phase74VersionGoodMemory;

export async function hashPhase74DependencyTree(
  nodeModulesPath: string,
): Promise<string> {
  const root = resolve(nodeModulesPath);
  const hash = createHash("sha256");
  hash.update("phase74-node-modules-v1\0");

  const updateField = (value: string) => {
    hash.update(`${Buffer.byteLength(value, "utf8")}:`);
    hash.update(value);
  };
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const relativePath = relative(root, path);
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      if (entry.isSymbolicLink()) {
        const target = await readlink(path);
        const resolvedTarget = resolve(dirname(path), target);
        if (
          resolvedTarget !== root &&
          !resolvedTarget.startsWith(`${root}${sep}`)
        ) {
          throw new Error(
            `Phase 74 dependency symlink escapes node_modules: ${relativePath}.`,
          );
        }
        updateField("symlink");
        updateField(relativePath);
        updateField(target);
        continue;
      }
      if (entry.isFile()) {
        const metadata = await lstat(path);
        updateField("file");
        updateField(relativePath);
        updateField(String(metadata.mode & 0o777));
        updateField(String(metadata.size));
        await new Promise<void>((resolveStream, rejectStream) => {
          const stream = createReadStream(path);
          stream.on("data", (chunk) => hash.update(chunk));
          stream.on("end", resolveStream);
          stream.on("error", rejectStream);
        });
      }
    }
  };

  await visit(root);
  return hash.digest("hex");
}

export async function materializePhase74VersionExecutionRoot(input: {
  archivePath: string;
  dependencyRoot: string;
  executionRoot: string;
}): Promise<string> {
  const executionRoot = resolve(input.executionRoot);
  const nodeModules = resolve(input.dependencyRoot, "node_modules");
  if (!(await lstat(nodeModules)).isDirectory()) {
    throw new Error("Phase 74 release dependency root has no node_modules directory.");
  }
  await mkdir(executionRoot);
  const extraction = Bun.spawn([
    "tar",
    "-xf",
    resolve(input.archivePath),
    "-C",
    executionRoot,
  ], {
    stderr: "pipe",
    stdout: "ignore",
  });
  if (await extraction.exited !== 0) {
    const error = await new Response(extraction.stderr).text();
    throw new Error(`Phase 74 release archive extraction failed: ${error.trim()}`);
  }
  await symlink(nodeModules, join(executionRoot, "node_modules"), "dir");
  return executionRoot;
}

export interface Phase74PreparedVersionMemoryGroup {
  createGoodMemory: Phase74VersionCreateGoodMemory;
  ingestionLatencyMs: number;
  input: Phase74VersionWorkerInput;
  memory: Phase74VersionGoodMemory;
  models: {
    embedding: AISDKModelConfig;
    extraction: AISDKModelConfig;
  };
  sqlitePath: string;
}

interface Phase74VersionUsageContext {
  branch: Phase74ModelUsageBranch;
  caseId: string;
  languageOperation: ModelUsageOperation;
}

function requestUrl(request: RequestInfo | URL): string {
  if (typeof request === "string") {
    return request;
  }
  return request instanceof URL ? request.toString() : request.url;
}

function requestModel(init: RequestInit | undefined): string {
  if (typeof init?.body !== "string") {
    return "unknown";
  }
  try {
    const value = JSON.parse(init.body) as { model?: unknown };
    return typeof value.model === "string" && value.model.length > 0
      ? value.model
      : "unknown";
  } catch {
    return "unknown";
  }
}

const MISSING_USAGE: ModelTokenUsage = {
  cacheCreationInputTokens: null,
  cacheReadInputTokens: null,
  inputTokens: null,
  outputTokens: null,
  uncachedInputTokens: null,
};

async function normalizePhase74VersionResponseUsage(
  response: Response,
): Promise<ModelTokenUsage> {
  if (
    response.headers.get("content-type")?.toLowerCase()
      .includes("text/event-stream")
  ) {
    let usage = MISSING_USAGE;
    for (const line of (await response.text()).split(/\r?\n/u)) {
      const data = line.startsWith("data:")
        ? line.slice("data:".length).trim()
        : "";
      if (data === "" || data === "[DONE]") {
        continue;
      }
      try {
        const normalized = normalizeOpenAICompatibleUsage(
          JSON.parse(data) as unknown,
        );
        if (modelUsageCompleteness(normalized) !== "missing") {
          usage = normalized;
        }
      } catch {
        continue;
      }
    }
    return usage;
  }
  try {
    return normalizeOpenAICompatibleUsage(await response.json());
  } catch {
    return MISSING_USAGE;
  }
}

async function bufferPhase74VersionResponse(response: Response): Promise<{
  consumer: Response;
  usage: Response;
}> {
  const body = await response.arrayBuffer();
  const init = {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  };
  return {
    consumer: new Response(body.byteLength === 0 ? null : body, init),
    usage: new Response(body.byteLength === 0 ? null : body.slice(0), init),
  };
}

export function createPhase74VersionUsageBoundary(input: {
  events: AttributedModelUsageAttempt[];
  fetch: FetchLike;
  intents: AttributedModelUsageIntent[];
  onUsageEvent?: (event: AttributedModelUsageAttempt) => void;
  onUsageIntent?: (intent: AttributedModelUsageIntent) => void;
}): {
  fetch: FetchLike;
  run<T>(
    context: Phase74VersionUsageContext,
    operation: () => Promise<T>,
  ): Promise<T>;
} {
  const storage = new AsyncLocalStorage<Phase74VersionUsageContext>();
  const wrappedFetch: FetchLike = async (request, init) => {
    const context = storage.getStore();
    const url = requestUrl(request);
    const operation = url.endsWith("/embeddings")
      ? "embedding"
      : url.endsWith("/chat/completions")
      ? context?.languageOperation
      : undefined;
    if (context === undefined || operation === undefined) {
      return input.fetch(request, init);
    }
    const modelId = requestModel(init);
    const sink = createAttributedModelUsageSink({
      branch: context.branch,
      caseId: context.caseId,
      events: input.events,
      intents: input.intents,
      onEvent: input.onUsageEvent,
      onIntent: input.onUsageIntent,
    });
    const report = sink.begin!({
      attempt: 1,
      modelId,
      operation,
      providerId: "openai",
      schemaVersion: 1,
    });
    let response: Response;
    let consumer: Response;
    let normalized: ModelTokenUsage;
    try {
      response = await input.fetch(request, init);
      const buffered = await bufferPhase74VersionResponse(response);
      consumer = buffered.consumer;
      normalized = await normalizePhase74VersionResponseUsage(buffered.usage);
    } catch (error) {
      report({
        attempt: 1,
        completeness: "missing",
        modelId,
        operation,
        outcome: "failed",
        providerId: "openai",
        schemaVersion: 1,
        usage: MISSING_USAGE,
      });
      throw error;
    }
    const usage = operation === "embedding"
      ? normalizeAISDKEmbeddingUsage({
        tokens: normalized.inputTokens ?? undefined,
      })
      : normalized;
    report({
      attempt: 1,
      completeness: modelUsageCompleteness(usage),
      modelId,
      operation,
      outcome: response.ok ? "succeeded" : "failed",
      providerId: "openai",
      schemaVersion: 1,
      usage,
    });
    return consumer;
  };
  return {
    fetch: wrappedFetch,
    run(context, operation) {
      return storage.run(context, operation);
    },
  };
}

export interface Phase74VersionWorkerResult {
  arm: Phase74VersionWorkerInput["arm"];
  caseId: string;
  ingestionLatencyMs: number;
  recallLatencyMs: number;
  retrievedMemories: Array<{
    content: string;
    id: string;
    sourceIds: string[];
  }>;
  schemaVersion: 1;
  sourceCommit: string;
  storedMemories: Array<{
    content: string;
    id: string;
    sourceIds: string[];
  }>;
}

function isoDate(value: string | undefined): string {
  const parsed = new Date(value ?? 0);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid Phase 74 version-worker time: ${value}.`);
  }
  return parsed.toISOString();
}

function sessionId(sourceId: string): string {
  return sourceId.match(/^([^:]+):/u)?.[1] ?? sourceId;
}

function contextItems(input: {
  evidence: readonly Phase74VersionEvidence[];
  facts: readonly Phase74VersionFact[];
  sourceIdsByMessageId: ReadonlyMap<string, readonly string[]>;
}): Phase74VersionWorkerResult["retrievedMemories"] {
  const sourceIdsByMemoryId = new Map<string, Set<string>>();
  for (const evidence of input.evidence) {
    const sourceIds = evidence.sourceMessageIds.flatMap(
      (messageId) => input.sourceIdsByMessageId.get(messageId) ?? [messageId],
    );
    for (const memoryId of evidence.linkedMemoryIds) {
      const existing = sourceIdsByMemoryId.get(memoryId) ?? new Set<string>();
      sourceIds.forEach((sourceId) => existing.add(sourceId));
      sourceIdsByMemoryId.set(memoryId, existing);
    }
  }
  return input.facts.map((fact) => ({
    content: fact.content,
    id: fact.id,
    sourceIds: [...(sourceIdsByMemoryId.get(fact.id) ?? [])],
  }));
}

export async function loadPhase74VersionCreateGoodMemory(
  sourceRoot: string,
): Promise<Phase74VersionCreateGoodMemory> {
  const module = await import(
    pathToFileURL(join(sourceRoot, "src", "index.ts")).href
  ) as { createGoodMemory?: unknown };
  if (typeof module.createGoodMemory !== "function") {
    throw new Error("Phase 74 version source has no createGoodMemory export.");
  }
  return module.createGoodMemory as Phase74VersionCreateGoodMemory;
}

function createVersionMemory(input: {
  createGoodMemory: Phase74VersionCreateGoodMemory;
  models: {
    embedding: AISDKModelConfig;
    extraction: AISDKModelConfig;
  };
  referenceTime?: string;
  sqlitePath: string;
}): Phase74VersionGoodMemory {
  return input.createGoodMemory({
    providers: {
      embedding: input.models.embedding,
      extraction: {
        ...input.models.extraction,
        contextualDescriptors: true,
        mode: "conversational",
      },
    },
    remember: {
      profiles: [{
        assistantOutputs: { mode: "confirmed_or_verified_only" },
        id: "external-evidence",
      }],
    },
    retrieval: { preset: "recommended" },
    storage: { provider: "sqlite", url: input.sqlitePath },
    testing: {
      now: () => new Date(isoDate(input.referenceTime)),
    },
  });
}

function assertSamePreparedGroup(input: {
  prepared: Phase74PreparedVersionMemoryGroup;
  query: Phase74VersionWorkerInput;
}): void {
  const prepared = input.prepared.input;
  if (
    prepared.arm !== input.query.arm ||
    prepared.memoryGroupId !== input.query.memoryGroupId ||
    prepared.sourceCommit !== input.query.sourceCommit ||
    JSON.stringify(prepared.rawEvidence) !== JSON.stringify(input.query.rawEvidence)
  ) {
    throw new Error("Phase 74 version query drifted from its prepared memory group.");
  }
}

export async function preparePhase74VersionMemoryGroup(input: {
  createGoodMemory: Phase74VersionCreateGoodMemory;
  input: Phase74VersionWorkerInput;
  models: {
    embedding: AISDKModelConfig;
    extraction: AISDKModelConfig;
  };
  now?: () => number;
  sqlitePath: string;
}): Promise<Phase74PreparedVersionMemoryGroup> {
  const workerInput = parsePhase74VersionWorkerInput(input.input);
  const now = input.now ?? (() => performance.now());
  const memory = createVersionMemory({
    createGoodMemory: input.createGoodMemory,
    models: input.models,
    referenceTime: workerInput.referenceTime,
    sqlitePath: input.sqlitePath,
  });
  const scope = buildPhase74LabelFreeScope(workerInput);
  const groups = new Map<string, typeof workerInput.rawEvidence>();
  for (const item of workerInput.rawEvidence) {
    const group = sessionId(item.sourceIds[0] ?? "source");
    groups.set(group, [...(groups.get(group) ?? []), item]);
  }
  const ingestionStartedAt = now();
  for (const [group, items] of groups) {
    const messages = items.map((item) => ({
      content: item.content,
      id: item.id,
      observedAt: isoDate(item.observedAt ?? workerInput.referenceTime),
      role: item.role === "assistant" ? "assistant" as const : "user" as const,
    }));
    const remembered = await memory.remember({
      annotations: messages.map((_, messageIndex) => ({
        confirmed: true,
        kindHint: "fact" as const,
        messageIndex,
        reason: "Preserve immutable external benchmark evidence.",
        remember: "always" as const,
        verified: true,
      })),
      extractionStrategy: "llm-assisted",
      messages,
      scope: { ...scope, sessionId: group },
    });
    if (remembered.warnings?.includes("assisted_extraction_failed")) {
      throw new Error("Phase 74 release assisted extraction failed.");
    }
  }
  const ingestionLatencyMs = Math.max(0, now() - ingestionStartedAt);
  return {
    createGoodMemory: input.createGoodMemory,
    ingestionLatencyMs,
    input: workerInput,
    memory,
    models: input.models,
    sqlitePath: input.sqlitePath,
  };
}

async function queryVersionMemory(input: {
  ingestionLatencyMs: number;
  memory: Phase74VersionGoodMemory;
  workerInput: Phase74VersionWorkerInput;
}): Promise<Phase74VersionWorkerResult> {
  const scope = buildPhase74LabelFreeScope(input.workerInput);
  const recalled = await input.memory.recall({
    includeEvidence: true,
    ...(input.workerInput.locale === undefined
      ? {}
      : { locale: input.workerInput.locale }),
    query: input.workerInput.question,
    ...(input.workerInput.referenceTime === undefined
      ? {}
      : { referenceTime: input.workerInput.referenceTime }),
    scope,
    strategy: "hybrid",
  });
  const exported = await input.memory.exportMemory({ scope });
  const sourceIdsByMessageId = new Map(
    input.workerInput.rawEvidence.map((item) => [item.id, item.sourceIds] as const),
  );
  return {
    arm: input.workerInput.arm,
    caseId: input.workerInput.caseId,
    ingestionLatencyMs: input.ingestionLatencyMs,
    recallLatencyMs: recalled.metadata.latencyMs,
    retrievedMemories: contextItems({
      evidence: recalled.evidence,
      facts: recalled.facts.slice(0, 12),
      sourceIdsByMessageId,
    }),
    schemaVersion: 1,
    sourceCommit: input.workerInput.sourceCommit,
    storedMemories: contextItems({
      evidence: exported.durable.evidence,
      facts: exported.durable.facts,
      sourceIdsByMessageId,
    }),
  };
}

export async function queryPhase74VersionMemoryGroup(input: {
  input: Phase74VersionWorkerInput;
  prepared: Phase74PreparedVersionMemoryGroup;
}): Promise<Phase74VersionWorkerResult> {
  const workerInput = parsePhase74VersionWorkerInput(input.input);
  assertSamePreparedGroup({ prepared: input.prepared, query: workerInput });
  return queryPhase74PersistedVersionMemoryGroup({
    createGoodMemory: input.prepared.createGoodMemory,
    ingestionLatencyMs: input.prepared.ingestionLatencyMs,
    input: workerInput,
    models: input.prepared.models,
    sqlitePath: input.prepared.sqlitePath,
  });
}

export async function queryPhase74PersistedVersionMemoryGroup(input: {
  createGoodMemory: Phase74VersionCreateGoodMemory;
  ingestionLatencyMs: number;
  input: Phase74VersionWorkerInput;
  models: {
    embedding: AISDKModelConfig;
    extraction: AISDKModelConfig;
  };
  sqlitePath: string;
}): Promise<Phase74VersionWorkerResult> {
  const workerInput = parsePhase74VersionWorkerInput(input.input);
  const queryDirectory = await mkdtemp(
    join(dirname(input.sqlitePath), ".phase74-version-query-"),
  );
  const sqlitePath = join(queryDirectory, "memory.sqlite");
  await copyFile(input.sqlitePath, sqlitePath);
  try {
    const memory = createVersionMemory({
      createGoodMemory: input.createGoodMemory,
      models: input.models,
      referenceTime: workerInput.referenceTime,
      sqlitePath,
    });
    return await queryVersionMemory({
      ingestionLatencyMs: input.ingestionLatencyMs,
      memory,
      workerInput,
    });
  } finally {
    await rm(queryDirectory, { force: true, recursive: true });
  }
}

export async function runPhase74VersionWorker(input: {
  createGoodMemory: Phase74VersionCreateGoodMemory;
  input: Phase74VersionWorkerInput;
  models: {
    embedding: AISDKModelConfig;
    extraction: AISDKModelConfig;
  };
  now?: () => number;
  sqlitePath: string;
}): Promise<Phase74VersionWorkerResult> {
  const prepared = await preparePhase74VersionMemoryGroup(input);
  return queryVersionMemory({
    ingestionLatencyMs: prepared.ingestionLatencyMs,
    memory: prepared.memory,
    workerInput: prepared.input,
  });
}
