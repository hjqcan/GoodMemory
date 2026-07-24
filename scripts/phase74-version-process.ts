import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  appendPhase74ModelUsageEventSync,
  appendPhase74ModelUsageIntentSync,
  type AttributedModelUsageAttempt,
  type AttributedModelUsageIntent,
} from "../src/eval/modelUsage";
import {
  resolvePhase74EmbeddingAdapterOptions,
  resolvePhase74ExecutorModels,
} from "../src/eval/phase74Live";
import {
  PHASE74_RELEASE_COMMIT,
  parsePhase74VersionWorkerInput,
  type Phase74VersionWorkerInput,
} from "../src/eval/phase74VersionBaseline";
import {
  createPhase74DurableCallBudget,
} from "./run-phase-74-generalization";
import {
  createPhase74VersionUsageBoundary,
  loadPhase74VersionCreateGoodMemory,
  preparePhase74VersionMemoryGroup,
  queryPhase74PersistedVersionMemoryGroup,
  type Phase74VersionWorkerResult,
} from "./phase74-version-worker";

interface Phase74VersionPrepareGroup {
  input: Phase74VersionWorkerInput;
  sqlitePath: string;
}

export interface Phase74VersionPreparedReceipt {
  ingestionLatencyMs: number;
  memoryGroupId: string;
  rawEvidenceSha256: string;
  sourceCommit: string;
  sqlitePath: string;
  sqliteSha256: string;
}

export type Phase74VersionProcessJob =
  | {
      action: "prepare";
      groups: Phase74VersionPrepareGroup[];
      schemaVersion: 1;
    }
  | {
      action: "query";
      input: Phase74VersionWorkerInput;
      prepared: Phase74VersionPreparedReceipt;
      schemaVersion: 1;
    };

export interface Phase74VersionProcessConfig {
  callBudget: {
    embeddingSpendLimitUsd: number;
    maxLanguageCalls: number;
    path: string;
  };
  preparationConcurrency: number;
  releaseSourceRoot: string;
  usage: {
    eventsPath: string;
    intentsPath: string;
  };
}

export type Phase74VersionProcessOutput =
  | {
      action: "prepare";
      groups: Phase74VersionPreparedReceipt[];
      pid: number;
      schemaVersion: 1;
    }
  | {
      action: "query";
      pid: number;
      result: Phase74VersionWorkerResult;
      schemaVersion: 1;
    };

export function parsePhase74VersionProcessOutput(
  value: unknown,
): Phase74VersionProcessOutput {
  const output = recordValue(value, "Phase 74 version process output");
  if (
    output.schemaVersion !== 1 ||
    !Number.isSafeInteger(output.pid) ||
    Number(output.pid) <= 0
  ) {
    throw new Error("Invalid Phase 74 version process output.");
  }
  if (output.action === "prepare") {
    exactFields(
      output,
      ["action", "groups", "pid", "schemaVersion"],
      "Phase 74 version process output",
    );
    if (!Array.isArray(output.groups)) {
      throw new Error("Invalid Phase 74 version process output.");
    }
    const groups = output.groups.map(preparedReceipt);
    return {
      action: "prepare",
      groups,
      pid: Number(output.pid),
      schemaVersion: 1,
    };
  }
  if (output.action === "query") {
    exactFields(
      output,
      ["action", "pid", "result", "schemaVersion"],
      "Phase 74 version process output",
    );
    const rawResult = recordValue(
      output.result,
      "Phase 74 version process query result",
    );
    exactFields(
      rawResult,
      [
        "arm",
        "caseId",
        "ingestionLatencyMs",
        "recallLatencyMs",
        "retrievedMemories",
        "schemaVersion",
        "sourceCommit",
        "storedMemories",
      ],
      "Phase 74 version process query result",
    );
    const parseMemories = (value: unknown) => {
      if (!Array.isArray(value)) {
        throw new Error("Invalid Phase 74 version process query result.");
      }
      return value.map((item) => {
        const memory = recordValue(
          item,
          "Phase 74 version process query memory",
        );
        exactFields(
          memory,
          ["content", "id", "sourceIds"],
          "Phase 74 version process query memory",
        );
        if (
          typeof memory.content !== "string" ||
          typeof memory.id !== "string" ||
          !Array.isArray(memory.sourceIds) ||
          !memory.sourceIds.every((sourceId) => typeof sourceId === "string")
        ) {
          throw new Error("Invalid Phase 74 version process query result.");
        }
        return {
          content: memory.content,
          id: memory.id,
          sourceIds: memory.sourceIds as string[],
        };
      });
    };
    const result: Phase74VersionWorkerResult = {
      arm: rawResult.arm as "release",
      caseId: nonEmptyString(
        rawResult.caseId,
        "Phase 74 version process query case",
      ),
      ingestionLatencyMs: nonNegativeNumber(
        rawResult.ingestionLatencyMs,
        "Phase 74 version process query ingestion latency",
      ),
      recallLatencyMs: nonNegativeNumber(
        rawResult.recallLatencyMs,
        "Phase 74 version process query result recall latency",
      ),
      retrievedMemories: parseMemories(rawResult.retrievedMemories),
      schemaVersion: rawResult.schemaVersion as 1,
      sourceCommit: rawResult.sourceCommit as string,
      storedMemories: parseMemories(rawResult.storedMemories),
    };
    if (
      result.schemaVersion !== 1 ||
      result.arm !== "release" ||
      result.sourceCommit !== PHASE74_RELEASE_COMMIT
    ) {
      throw new Error("Invalid Phase 74 version process query result.");
    }
    return {
      action: "query",
      pid: Number(output.pid),
      result,
      schemaVersion: 1,
    };
  }
  throw new Error("Invalid Phase 74 version process output.");
}

function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactFields(
  value: Record<string, unknown>,
  fields: readonly string[],
  label: string,
): void {
  const expected = new Set(fields);
  const unknown = Object.keys(value).find((field) => !expected.has(field));
  const missing = fields.find((field) => !(field in value));
  if (unknown !== undefined || missing !== undefined) {
    throw new Error(`Invalid ${label}.`);
  }
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function positiveNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be positive.`);
  }
  return value;
}

function nonNegativeNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be non-negative.`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  const parsed = positiveNumber(value, label);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${label} must be an integer.`);
  }
  return parsed;
}

function prepareGroup(value: unknown): Phase74VersionPrepareGroup {
  const group = recordValue(value, "Phase 74 version process group");
  exactFields(
    group,
    ["input", "sqlitePath"],
    "Phase 74 version process group",
  );
  return {
    input: parsePhase74VersionWorkerInput(group.input),
    sqlitePath: nonEmptyString(
      group.sqlitePath,
      "Phase 74 version process SQLite path",
    ),
  };
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha256RawEvidence(input: Phase74VersionWorkerInput): string {
  return sha256(JSON.stringify(input.rawEvidence));
}

function preparedReceipt(value: unknown): Phase74VersionPreparedReceipt {
  const receipt = recordValue(
    value,
    "Phase 74 version prepared receipt",
  );
  exactFields(
    receipt,
    [
      "ingestionLatencyMs",
      "memoryGroupId",
      "rawEvidenceSha256",
      "sourceCommit",
      "sqlitePath",
      "sqliteSha256",
    ],
    "Phase 74 version prepared receipt",
  );
  const exactSha256 = (candidate: unknown, label: string) => {
    const parsed = nonEmptyString(candidate, label);
    if (!/^[a-f0-9]{64}$/u.test(parsed)) {
      throw new Error(`${label} must be an exact SHA-256.`);
    }
    return parsed;
  };
  const sourceCommit = nonEmptyString(
    receipt.sourceCommit,
    "Phase 74 version prepared source",
  );
  if (sourceCommit !== PHASE74_RELEASE_COMMIT) {
    throw new Error("Phase 74 version prepared receipt source drifted.");
  }
  return {
    ingestionLatencyMs: nonNegativeNumber(
      receipt.ingestionLatencyMs,
      "Phase 74 version prepared ingestion latency",
    ),
    memoryGroupId: nonEmptyString(
      receipt.memoryGroupId,
      "Phase 74 version prepared memory group",
    ),
    rawEvidenceSha256: exactSha256(
      receipt.rawEvidenceSha256,
      "Phase 74 version prepared raw-evidence digest",
    ),
    sourceCommit,
    sqlitePath: nonEmptyString(
      receipt.sqlitePath,
      "Phase 74 version prepared SQLite path",
    ),
    sqliteSha256: exactSha256(
      receipt.sqliteSha256,
      "Phase 74 version prepared SQLite digest",
    ),
  };
}

export async function buildPhase74VersionPreparedReceipt(input: {
  ingestionLatencyMs: number;
  input: Phase74VersionWorkerInput;
  sqlitePath: string;
}): Promise<Phase74VersionPreparedReceipt> {
  const workerInput = parsePhase74VersionWorkerInput(input.input);
  return preparedReceipt({
    ingestionLatencyMs: input.ingestionLatencyMs,
    memoryGroupId: workerInput.memoryGroupId,
    rawEvidenceSha256: sha256RawEvidence(workerInput),
    sourceCommit: workerInput.sourceCommit,
    sqlitePath: input.sqlitePath,
    sqliteSha256: sha256(await readFile(input.sqlitePath)),
  });
}

export async function verifyPhase74VersionPreparedReceipt(input: {
  input: Phase74VersionWorkerInput;
  receipt: Phase74VersionPreparedReceipt;
}): Promise<Phase74VersionPreparedReceipt> {
  const workerInput = parsePhase74VersionWorkerInput(input.input);
  const receipt = preparedReceipt(input.receipt);
  if (
    receipt.memoryGroupId !== workerInput.memoryGroupId ||
    receipt.sourceCommit !== workerInput.sourceCommit ||
    receipt.rawEvidenceSha256 !== sha256RawEvidence(workerInput) ||
    receipt.sqliteSha256 !== sha256(await readFile(receipt.sqlitePath))
  ) {
    throw new Error("Phase 74 version prepared receipt drifted.");
  }
  return receipt;
}

export function parsePhase74VersionProcessJob(
  value: unknown,
): Phase74VersionProcessJob {
  const job = recordValue(value, "Phase 74 version process job");
  if (job.action === "prepare") {
    exactFields(
      job,
      ["action", "groups", "schemaVersion"],
      "Phase 74 version process job",
    );
    if (
      job.schemaVersion !== 1 ||
      !Array.isArray(job.groups) ||
      job.groups.length === 0
    ) {
      throw new Error("Invalid Phase 74 version process job.");
    }
    const groups = job.groups.map(prepareGroup);
    if (
      new Set(groups.map(({ input }) => input.memoryGroupId)).size !==
        groups.length
    ) {
      throw new Error("Phase 74 version process groups must be unique.");
    }
    return { action: "prepare", groups, schemaVersion: 1 };
  }
  if (job.action === "query") {
    exactFields(
      job,
      [
        "action",
        "input",
        "prepared",
        "schemaVersion",
      ],
      "Phase 74 version process job",
    );
    if (job.schemaVersion !== 1) {
      throw new Error("Invalid Phase 74 version process job.");
    }
    return {
      action: "query",
      input: parsePhase74VersionWorkerInput(job.input),
      prepared: preparedReceipt(job.prepared),
      schemaVersion: 1,
    };
  }
  throw new Error("Invalid Phase 74 version process job.");
}

export function parsePhase74VersionProcessConfig(
  value: unknown,
): Phase74VersionProcessConfig {
  const config = recordValue(value, "Phase 74 version process config");
  exactFields(
    config,
    [
      "callBudget",
      "preparationConcurrency",
      "releaseSourceRoot",
      "usage",
    ],
    "Phase 74 version process config",
  );
  const callBudget = recordValue(
    config.callBudget,
    "Phase 74 version process call budget",
  );
  exactFields(
    callBudget,
    ["embeddingSpendLimitUsd", "maxLanguageCalls", "path"],
    "Phase 74 version process call budget",
  );
  const usage = recordValue(config.usage, "Phase 74 version process usage");
  exactFields(
    usage,
    ["eventsPath", "intentsPath"],
    "Phase 74 version process usage",
  );
  return {
    callBudget: {
      embeddingSpendLimitUsd: positiveNumber(
        callBudget.embeddingSpendLimitUsd,
        "Phase 74 version process embedding budget",
      ),
      maxLanguageCalls: positiveInteger(
        callBudget.maxLanguageCalls,
        "Phase 74 version process language budget",
      ),
      path: nonEmptyString(
        callBudget.path,
        "Phase 74 version process call-budget path",
      ),
    },
    preparationConcurrency: positiveInteger(
      config.preparationConcurrency,
      "Phase 74 version process preparation concurrency",
    ),
    releaseSourceRoot: nonEmptyString(
      config.releaseSourceRoot,
      "Phase 74 version process release root",
    ),
    usage: {
      eventsPath: nonEmptyString(
        usage.eventsPath,
        "Phase 74 version process events path",
      ),
      intentsPath: nonEmptyString(
        usage.intentsPath,
        "Phase 74 version process intents path",
      ),
    },
  };
}

function childEnvironment(
  env: Readonly<Record<string, string | undefined>>,
  config?: Phase74VersionProcessConfig,
): Record<string, string> {
  const names = [
    "BUN_INSTALL_CACHE_DIR",
    "GOODMEMORY_EMBEDDING_API_KEY",
    "GOODMEMORY_EMBEDDING_BASE_URL",
    "GOODMEMORY_EMBEDDING_MODEL",
    "GOODMEMORY_EMBEDDING_PROVIDER",
    "GOODMEMORY_EVAL_API_KEY",
    "GOODMEMORY_EVAL_BASE_URL",
    "GOODMEMORY_EVAL_MODEL",
    "GOODMEMORY_EVAL_PROVIDER",
    "HOME",
    "PATH",
    "TMPDIR",
  ] as const;
  const picked = Object.fromEntries(names.flatMap((name) =>
    env[name] === undefined ? [] : [[name, env[name]!]]
  ));
  return config === undefined
    ? picked
    : {
        ...picked,
        GOODMEMORY_PHASE74_VERSION_PROCESS_CONFIG: JSON.stringify(config),
      };
}

export async function runPhase74VersionChildProcess(input: {
  config?: Phase74VersionProcessConfig;
  cwd: string;
  env: Readonly<Record<string, string | undefined>>;
  job: Phase74VersionProcessJob;
  script: string;
}): Promise<{
  pid: number;
  stderr: string;
  stdout: string;
}> {
  const job = parsePhase74VersionProcessJob(input.job);
  const child = Bun.spawn({
    cmd: [process.execPath, "--env-file=/dev/null", input.script],
    cwd: input.cwd,
    env: childEnvironment(input.env, input.config),
    stdin: Buffer.from(JSON.stringify(job)),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stderr, stdout] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `Phase 74 version child failed: ${stderr.trim() || `exit ${exitCode}`}`,
    );
  }
  return { pid: child.pid, stderr, stdout };
}

async function prepareAll(input: {
  concurrency: number;
  groups: readonly Phase74VersionPrepareGroup[];
  run(group: Phase74VersionPrepareGroup): Promise<
    Phase74VersionPreparedReceipt
  >;
}) {
  const results = new Array<Awaited<ReturnType<typeof input.run>>>(
    input.groups.length,
  );
  let next = 0;
  let failure: unknown;
  const worker = async () => {
    while (failure === undefined) {
      const index = next;
      next += 1;
      const group = input.groups[index];
      if (group === undefined) {
        return;
      }
      try {
        results[index] = await input.run(group);
      } catch (error) {
        failure ??= error;
      }
    }
  };
  await Promise.all(Array.from({
    length: Math.min(input.concurrency, input.groups.length),
  }, worker));
  if (failure !== undefined) {
    throw failure;
  }
  return results;
}

export async function runPhase74VersionProcessJob(input: {
  config: Phase74VersionProcessConfig;
  dependencies?: {
    loadCreateGoodMemory:
      typeof loadPhase74VersionCreateGoodMemory;
  };
  env?: Record<string, string | undefined>;
  fetch?: typeof globalThis.fetch;
  job: Phase74VersionProcessJob;
  pid?: number;
}): Promise<Phase74VersionProcessOutput> {
  const config = parsePhase74VersionProcessConfig(input.config);
  const job = parsePhase74VersionProcessJob(input.job);
  const env = input.env ?? process.env;
  const models = resolvePhase74ExecutorModels(env);
  await Promise.all([
    mkdir(dirname(config.callBudget.path), { recursive: true }),
    mkdir(dirname(config.usage.eventsPath), { recursive: true }),
    mkdir(dirname(config.usage.intentsPath), { recursive: true }),
    writeFile(config.usage.eventsPath, "", { encoding: "utf8", flag: "a" }),
    writeFile(config.usage.intentsPath, "", { encoding: "utf8", flag: "a" }),
  ]);
  const events: AttributedModelUsageAttempt[] = [];
  const intents: AttributedModelUsageIntent[] = [];
  const callBudget = createPhase74DurableCallBudget({
    embeddingSpendLimitUsd: config.callBudget.embeddingSpendLimitUsd,
    fetch: input.fetch ?? globalThis.fetch,
    maxLanguageCalls: config.callBudget.maxLanguageCalls,
    path: config.callBudget.path,
  });
  const routedFetch = resolvePhase74EmbeddingAdapterOptions(
    models.embedding,
    callBudget.fetch,
  ).fetch ?? callBudget.fetch;
  const usage = createPhase74VersionUsageBoundary({
    events,
    fetch: routedFetch,
    intents,
    onUsageEvent: (event) =>
      appendPhase74ModelUsageEventSync(config.usage.eventsPath, event),
    onUsageIntent: (intent) =>
      appendPhase74ModelUsageIntentSync(config.usage.intentsPath, intent),
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = usage.fetch as typeof globalThis.fetch;
  try {
    const createGoodMemory = await (
      input.dependencies?.loadCreateGoodMemory ??
        loadPhase74VersionCreateGoodMemory
    )(config.releaseSourceRoot);
    const pid = input.pid ?? process.pid;
    if (job.action === "prepare") {
      const groups = await prepareAll({
        concurrency: config.preparationConcurrency,
        groups: job.groups,
        run: async (group) => {
          const prepared = await usage.run({
            branch: "shadow",
            caseId: group.input.memoryGroupId,
            languageOperation: "assisted_extraction",
          }, () => preparePhase74VersionMemoryGroup({
            createGoodMemory,
            input: group.input,
            models: {
              embedding: models.embedding,
              extraction: models.assistedExtraction,
            },
            sqlitePath: group.sqlitePath,
          }));
          return buildPhase74VersionPreparedReceipt({
            ingestionLatencyMs: prepared.ingestionLatencyMs,
            input: group.input,
            sqlitePath: group.sqlitePath,
          });
        },
      });
      return { action: "prepare", groups, pid, schemaVersion: 1 };
    }
    const prepared = await verifyPhase74VersionPreparedReceipt({
      input: job.input,
      receipt: job.prepared,
    });
    const result = await usage.run({
      branch: "baseline",
      caseId: job.input.caseId,
      languageOperation: "recall_plan",
    }, () => queryPhase74PersistedVersionMemoryGroup({
      createGoodMemory,
      ingestionLatencyMs: prepared.ingestionLatencyMs,
      input: job.input,
      models: {
        embedding: models.embedding,
        extraction: models.assistedExtraction,
      },
      sqlitePath: prepared.sqlitePath,
    }));
    return { action: "query", pid, result, schemaVersion: 1 };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

if (import.meta.main) {
  const rawConfig = process.env.GOODMEMORY_PHASE74_VERSION_PROCESS_CONFIG;
  if (rawConfig === undefined) {
    throw new Error("GOODMEMORY_PHASE74_VERSION_PROCESS_CONFIG is required.");
  }
  const output = await runPhase74VersionProcessJob({
    config: parsePhase74VersionProcessConfig(JSON.parse(rawConfig)),
    job: parsePhase74VersionProcessJob(JSON.parse(await Bun.stdin.text())),
  });
  process.stdout.write(`${JSON.stringify(output)}\n`);
}
