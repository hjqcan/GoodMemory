import { mkdir } from "node:fs/promises";
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

export type Phase74VersionProcessJob =
  | {
      action: "prepare";
      groups: Phase74VersionPrepareGroup[];
      schemaVersion: 1;
    }
  | {
      action: "query";
      ingestionLatencyMs: number;
      input: Phase74VersionWorkerInput;
      schemaVersion: 1;
      sqlitePath: string;
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
      groups: Array<{
        ingestionLatencyMs: number;
        memoryGroupId: string;
        sqlitePath: string;
      }>;
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
    const groups = output.groups.map((value) => {
      const group = recordValue(value, "Phase 74 version process output group");
      exactFields(
        group,
        ["ingestionLatencyMs", "memoryGroupId", "sqlitePath"],
        "Phase 74 version process output group",
      );
      return {
        ingestionLatencyMs: positiveNumber(
          group.ingestionLatencyMs,
          "Phase 74 version process output ingestion latency",
        ),
        memoryGroupId: nonEmptyString(
          group.memoryGroupId,
          "Phase 74 version process output memory group",
        ),
        sqlitePath: nonEmptyString(
          group.sqlitePath,
          "Phase 74 version process output SQLite path",
        ),
      };
    });
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
    const result = recordValue(
      output.result,
      "Phase 74 version process query result",
    ) as unknown as Phase74VersionWorkerResult;
    if (
      result.schemaVersion !== 1 ||
      result.arm !== "release" ||
      typeof result.caseId !== "string" ||
      !Array.isArray(result.retrievedMemories)
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
        "ingestionLatencyMs",
        "input",
        "schemaVersion",
        "sqlitePath",
      ],
      "Phase 74 version process job",
    );
    if (job.schemaVersion !== 1) {
      throw new Error("Invalid Phase 74 version process job.");
    }
    return {
      action: "query",
      ingestionLatencyMs: positiveNumber(
        job.ingestionLatencyMs,
        "Phase 74 version process ingestion latency",
      ),
      input: parsePhase74VersionWorkerInput(job.input),
      schemaVersion: 1,
      sqlitePath: nonEmptyString(
        job.sqlitePath,
        "Phase 74 version process SQLite path",
      ),
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
  run(group: Phase74VersionPrepareGroup): Promise<{
    ingestionLatencyMs: number;
    memoryGroupId: string;
    sqlitePath: string;
  }>;
}) {
  const results = new Array<Awaited<ReturnType<typeof input.run>>>(
    input.groups.length,
  );
  let next = 0;
  const worker = async () => {
    while (true) {
      const index = next;
      next += 1;
      const group = input.groups[index];
      if (group === undefined) {
        return;
      }
      results[index] = await input.run(group);
    }
  };
  await Promise.all(Array.from({
    length: Math.min(input.concurrency, input.groups.length),
  }, worker));
  return results;
}

export async function runPhase74VersionProcessJob(input: {
  config: Phase74VersionProcessConfig;
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
  const createGoodMemory = await loadPhase74VersionCreateGoodMemory(
    config.releaseSourceRoot,
  );
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
        return {
          ingestionLatencyMs: prepared.ingestionLatencyMs,
          memoryGroupId: group.input.memoryGroupId,
          sqlitePath: group.sqlitePath,
        };
      },
    });
    return { action: "prepare", groups, pid, schemaVersion: 1 };
  }
  const result = await usage.run({
    branch: "baseline",
    caseId: job.input.caseId,
    languageOperation: "recall_plan",
  }, () => queryPhase74PersistedVersionMemoryGroup({
    createGoodMemory,
    ingestionLatencyMs: job.ingestionLatencyMs,
    input: job.input,
    models: {
      embedding: models.embedding,
      extraction: models.assistedExtraction,
    },
    sqlitePath: job.sqlitePath,
  }));
  return { action: "query", pid, result, schemaVersion: 1 };
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
