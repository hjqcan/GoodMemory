import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { z } from "zod";

import {
  createPhase74DurableCallBudget,
} from "./run-phase-74-generalization";
import {
  createPhase74FullRetrievalRuntime,
} from "../src/eval/phase74FullRuntime";
import {
  createPhase74LiveReader,
  phase74LivePromptSha256s,
  resolvePhase74ExecutorModels,
} from "../src/eval/phase74Live";
import {
  appendPhase74ModelUsageEventSync,
  appendPhase74ModelUsageIntentSync,
  loadPhase74ModelUsageLedger,
  reconcilePhase74PendingModelUsageSync,
} from "../src/eval/modelUsage";
import {
  parsePhase74SealedExecutionBundle,
} from "../src/eval/phase74SealedExecution";
import {
  createPhase74UnscoredFileCheckpoint,
  parsePhase74UnscoredArtifact,
  runPhase74UnscoredExecution,
  sha256Phase74UnscoredArtifact,
} from "../src/eval/phase74UnscoredExecution";
import type { Phase74RetrievalSnapshot } from "../src/eval/phase74Generalization";
import type { EvalRunJsonObject } from "../src/eval/runIdentity";

const callBudgetSchema = z.object({
  embeddingSpendLimitUsd: z.number().positive(),
  maxLanguageCalls: z.number().int().positive(),
  path: z.string().min(1),
}).strict();

const usageSchema = z.object({
  eventsPath: z.string().min(1),
  intentsPath: z.string().min(1),
}).strict();

const executorConfigSchema = z.object({
  artifactPath: z.string().min(1),
  baseConfiguration: z.record(z.string(), z.unknown()),
  callBudget: callBudgetSchema,
  checkpointDirectory: z.string().min(1),
  datasetSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  e3ArtifactPath: z.string().min(1).optional(),
  e3ArtifactSha256: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
  evaluatorSourceSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  rerankerMode: z.enum(["deterministic", "provider"]),
  runDirectory: z.string().min(1),
  usage: usageSchema,
}).strict();

export type Phase74SealedExecutorConfig = z.infer<
  typeof executorConfigSchema
>;

export function parsePhase74SealedExecutorConfig(
  value: unknown,
): Phase74SealedExecutorConfig {
  const parsed = executorConfigSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Invalid Phase 74 sealed executor config: ${parsed.error.issues[0]?.message ?? "invalid"}.`,
    );
  }
  return parsed.data;
}

async function writeExactOrMatch(path: string, content: string): Promise<void> {
  try {
    await writeFile(path, content, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code !== "EEXIST" ||
      await readFile(path, "utf8") !== content
    ) {
      throw error;
    }
  }
}

async function loadE3Snapshots(input: {
  path?: string;
  sha256?: string;
}): Promise<ReadonlyMap<string, Phase74RetrievalSnapshot>> {
  if (input.path === undefined && input.sha256 === undefined) {
    return new Map();
  }
  if (input.path === undefined || input.sha256 === undefined) {
    throw new Error("Phase 74 E3 artifact path and digest must be provided together.");
  }
  const raw = await readFile(input.path, "utf8");
  if (createHash("sha256").update(raw).digest("hex") !== input.sha256) {
    throw new Error("Phase 74 E3 artifact digest drifted.");
  }
  const artifact = parsePhase74UnscoredArtifact(JSON.parse(raw));
  if (artifact.stage !== "E3" || sha256Phase74UnscoredArtifact(artifact) !== input.sha256) {
    throw new Error("Phase 74 E4 requires a sealed E3 artifact.");
  }
  return new Map(artifact.rows.flatMap((row) =>
    row.kind === "retrieval" && row.unit === "recall-plan-deterministic"
      ? [[row.caseKey, row.snapshot] as const]
      : []
  ));
}

export async function runPhase74SealedExecutorCli(
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  const rawConfig = env.GOODMEMORY_PHASE74_EXECUTOR_CONFIG;
  if (rawConfig === undefined) {
    throw new Error("GOODMEMORY_PHASE74_EXECUTOR_CONFIG is required.");
  }
  const config = parsePhase74SealedExecutorConfig(JSON.parse(rawConfig));
  const execution = parsePhase74SealedExecutionBundle(
    JSON.parse(await Bun.stdin.text()),
  );
  const models = resolvePhase74ExecutorModels(env);
  await Promise.all([
    mkdir(config.runDirectory, { recursive: true }),
    mkdir(dirname(config.usage.eventsPath), { recursive: true }),
    mkdir(dirname(config.usage.intentsPath), { recursive: true }),
  ]);
  const ledger = reconcilePhase74PendingModelUsageSync({
    eventsPath: config.usage.eventsPath,
    ledger: await loadPhase74ModelUsageLedger({
      eventsPath: config.usage.eventsPath,
      intentsPath: config.usage.intentsPath,
    }),
  });
  const onUsageEvent = (event: (typeof ledger.events)[number]) => {
    appendPhase74ModelUsageEventSync(config.usage.eventsPath, event);
  };
  const onUsageIntent = (intent: (typeof ledger.intents)[number]) => {
    appendPhase74ModelUsageIntentSync(config.usage.intentsPath, intent);
  };
  const runtime = createPhase74FullRetrievalRuntime({
    datasetSha256: config.datasetSha256,
    evaluatorSourceSha256: config.evaluatorSourceSha256,
    events: ledger.events,
    intents: ledger.intents,
    models,
    onUsageEvent,
    onUsageIntent,
    promptSha256s: phase74LivePromptSha256s(),
    rerankerMode: config.rerankerMode,
    runDirectory: config.runDirectory,
  });
  const reader = createPhase74LiveReader({
    events: ledger.events,
    intents: ledger.intents,
    model: models.answer,
    onUsageEvent,
    onUsageIntent,
  });
  const e3Snapshots = await loadE3Snapshots({
    path: config.e3ArtifactPath,
    sha256: config.e3ArtifactSha256,
  });
  const callBudget = createPhase74DurableCallBudget({
    embeddingSpendLimitUsd: config.callBudget.embeddingSpendLimitUsd,
    fetch: globalThis.fetch,
    maxLanguageCalls: config.callBudget.maxLanguageCalls,
    path: config.callBudget.path,
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = callBudget.fetch;
  try {
    const result = await runPhase74UnscoredExecution({
      baseConfiguration: config.baseConfiguration as EvalRunJsonObject,
      checkpoint: createPhase74UnscoredFileCheckpoint({
        directory: config.checkpointDirectory,
        execution,
      }),
      countRenderedTokens: (content) => Buffer.byteLength(content, "utf8"),
      executeRetrieval: runtime.execute,
      execution,
      executorPid: process.pid,
      genericReader: reader,
      loadDeterministicSnapshot: async (caseKey) =>
        e3Snapshots.get(caseKey) ?? null,
      renderEvidenceLedger: runtime.render,
    });
    const artifact = JSON.stringify(result.artifact);
    if (createHash("sha256").update(artifact).digest("hex") !==
      result.executorOutput.artifactSha256) {
      throw new Error("Phase 74 executor artifact serialization drifted.");
    }
    await mkdir(dirname(config.artifactPath), { recursive: true });
    await writeExactOrMatch(config.artifactPath, artifact);
    process.stdout.write(`${JSON.stringify(result.executorOutput)}\n`);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

if (import.meta.main) {
  await runPhase74SealedExecutorCli();
}
