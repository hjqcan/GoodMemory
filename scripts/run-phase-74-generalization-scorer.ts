import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { z } from "zod";

import {
  createPhase74DurableCallBudget,
} from "./run-phase-74-generalization";
import {
  resolvePhase74ScorerModels,
} from "../src/eval/phase74Live";
import {
  appendPhase74ModelUsageEventSync,
  appendPhase74ModelUsageIntentSync,
  loadPhase74ModelUsageLedger,
  reconcilePhase74PendingModelUsageSync,
} from "../src/eval/modelUsage";
import {
  createPhase74ProtocolCompatibleAnswerAssessor,
} from "../src/eval/phase74ProtocolScoring";
import {
  parsePhase74SealedEscrowBundle,
  parsePhase74SealedExecutionBundle,
  parsePhase74SealedExecutorOutput,
} from "../src/eval/phase74SealedExecution";
import {
  scorePhase74UnscoredExecution,
} from "../src/eval/phase74SealedScoring";
import {
  parsePhase74UnscoredArtifact,
} from "../src/eval/phase74UnscoredExecution";

const scorerConfigSchema = z.object({
  benchmark: z.enum(["locomo", "longmemeval"]),
  callBudget: z.object({
    embeddingSpendLimitUsd: z.number().positive(),
    maxLanguageCalls: z.number().int().positive(),
    path: z.string().min(1),
  }).strict(),
  usage: z.object({
    eventsPath: z.string().min(1),
    intentsPath: z.string().min(1),
  }).strict(),
}).strict();

export async function runPhase74SealedScorerCli(
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  const rawConfig = env.GOODMEMORY_PHASE74_SCORER_CONFIG;
  if (rawConfig === undefined) {
    throw new Error("GOODMEMORY_PHASE74_SCORER_CONFIG is required.");
  }
  const parsedConfig = scorerConfigSchema.safeParse(JSON.parse(rawConfig));
  if (!parsedConfig.success) {
    throw new Error("Invalid Phase 74 sealed scorer config.");
  }
  const config = parsedConfig.data;
  const raw = JSON.parse(await Bun.stdin.text()) as {
    artifact?: unknown;
    escrow?: unknown;
    execution?: unknown;
    executorOutput?: unknown;
  };
  const models = resolvePhase74ScorerModels(env);
  await Promise.all([
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
  const assessor = createPhase74ProtocolCompatibleAnswerAssessor({
    benchmark: config.benchmark,
    events: ledger.events,
    intents: ledger.intents,
    model: models.judge,
    onUsageEvent,
    onUsageIntent,
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
    const scored = await scorePhase74UnscoredExecution({
      artifact: parsePhase74UnscoredArtifact(raw.artifact),
      assess: async (input) => assessor({
        answer: input.answer,
        purpose: input.purpose,
        testCase: {
          caseId: input.originalCaseId,
          expectedAnswer: input.expectedAnswer,
          ...(input.family === undefined ? {} : { family: input.family }),
          goldEvidenceIds: input.goldEvidenceIds,
          protocolMetadata: input.protocolMetadata,
          question: input.question,
          rawEvidence: [],
          unresolvedGoldEvidenceIds: input.unresolvedGoldEvidenceIds,
        },
        usageCaseId: input.opaqueCaseKey,
      }),
      escrow: parsePhase74SealedEscrowBundle(raw.escrow),
      execution: parsePhase74SealedExecutionBundle(raw.execution),
      executorOutput: parsePhase74SealedExecutorOutput(raw.executorOutput),
      scorerPid: process.pid,
    });
    process.stdout.write(`${JSON.stringify(scored.receipt)}\n`);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

if (import.meta.main) {
  await runPhase74SealedScorerCli();
}
