import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { z } from "zod";

import {
  createPhase74DurableCallBudget,
} from "./run-phase-74-generalization";
import {
  createPhase74LiveJudge,
  createPhase74LiveReader,
  resolvePhase74ReaderModel,
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
  runPhase74SealedOracleMatrix,
  scorePhase74UnscoredExecution,
} from "../src/eval/phase74SealedScoring";
import {
  parsePhase74UnscoredArtifact,
} from "../src/eval/phase74UnscoredExecution";
import { createPhase74ProtocolReader } from "../src/eval/phase74ProtocolReader";

const scorerConfigSchema = z.object({
  benchmark: z.enum(["locomo", "longmemeval"]),
  callBudget: z.object({
    embeddingSpendLimitUsd: z.number().positive(),
    maxLanguageCalls: z.number().int().positive(),
    path: z.string().min(1),
  }).strict(),
  e3ArtifactPath: z.string().min(1).optional(),
  e3ArtifactSha256: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
  oracleArtifactPath: z.string().min(1).optional(),
  usage: z.object({
    eventsPath: z.string().min(1),
    intentsPath: z.string().min(1),
  }).strict(),
}).strict();

export type Phase74SealedScorerConfig = z.infer<typeof scorerConfigSchema>;

export function parsePhase74SealedScorerConfig(
  value: unknown,
): Phase74SealedScorerConfig {
  const parsed = scorerConfigSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("Invalid Phase 74 sealed scorer config.");
  }
  return parsed.data;
}

interface Phase74SealedScorerRawInput {
  artifact?: unknown;
  escrow?: unknown;
  execution?: unknown;
  executorOutput?: unknown;
}

export async function runPhase74SealedScorer(input: {
  config: Phase74SealedScorerConfig;
  env: Record<string, string | undefined>;
  fetch?: typeof globalThis.fetch;
  raw: Phase74SealedScorerRawInput;
  scorerPid: number;
}) {
  const config = parsePhase74SealedScorerConfig(input.config);
  const execution = parsePhase74SealedExecutionBundle(input.raw.execution);
  const escrow = parsePhase74SealedEscrowBundle(input.raw.escrow);
  const artifact = parsePhase74UnscoredArtifact(input.raw.artifact);
  const executorOutput = parsePhase74SealedExecutorOutput(
    input.raw.executorOutput,
  );
  const oracleConfigured = config.e3ArtifactPath !== undefined ||
    config.e3ArtifactSha256 !== undefined ||
    config.oracleArtifactPath !== undefined;
  if (
    execution.stage === "E4"
      ? config.e3ArtifactPath === undefined ||
        config.e3ArtifactSha256 === undefined ||
        config.oracleArtifactPath === undefined
      : oracleConfigured
  ) {
    throw new Error(
      "Phase 74 E4 scorer requires its E3 artifact and oracle output together.",
    );
  }

  const models = resolvePhase74ScorerModels(input.env);
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
  const callBudget = createPhase74DurableCallBudget({
    embeddingSpendLimitUsd: config.callBudget.embeddingSpendLimitUsd,
    fetch: input.fetch ?? globalThis.fetch,
    maxLanguageCalls: config.callBudget.maxLanguageCalls,
    path: config.callBudget.path,
  });
  const assessor = createPhase74ProtocolCompatibleAnswerAssessor({
    benchmark: config.benchmark,
    events: ledger.events,
    fetch: callBudget.fetch,
    intents: ledger.intents,
    model: models.judge,
    onUsageEvent,
    onUsageIntent,
  });

  let oracleSha256: string | undefined;
  if (execution.stage === "E4") {
    const e3Raw = await readFile(config.e3ArtifactPath!, "utf8");
    if (
      createHash("sha256").update(e3Raw).digest("hex") !==
        config.e3ArtifactSha256
    ) {
      throw new Error("Phase 74 E3 artifact digest drifted before scoring.");
    }
    const reader = createPhase74LiveReader({
      events: ledger.events,
      fetch: callBudget.fetch,
      intents: ledger.intents,
      model: resolvePhase74ReaderModel(input.env),
      onUsageEvent,
      onUsageIntent,
    });
    const oracle = await runPhase74SealedOracleMatrix({
      countRenderedTokens: (content) => Buffer.byteLength(content, "utf8"),
      e3Artifact: parsePhase74UnscoredArtifact(JSON.parse(e3Raw)),
      escrow,
      execution,
      genericReader: reader,
      judge: createPhase74LiveJudge({
        events: ledger.events,
        fetch: callBudget.fetch,
        intents: ledger.intents,
        model: models.judge,
        onUsageEvent,
        onUsageIntent,
      }),
      protocolReader: createPhase74ProtocolReader({
        countRenderedTokens: (content) => Buffer.byteLength(content, "utf8"),
        reader,
      }),
    });
    const rawOracle = JSON.stringify(oracle.artifact);
    await mkdir(dirname(config.oracleArtifactPath!), { recursive: true });
    await writeFile(config.oracleArtifactPath!, rawOracle, {
      encoding: "utf8",
      flag: "wx",
    });
    oracleSha256 = oracle.sha256;
  }

  const scored = await scorePhase74UnscoredExecution({
    artifact,
    assess: async (assessmentInput) => assessor({
      answer: assessmentInput.answer,
      purpose: assessmentInput.purpose,
      testCase: {
        caseId: assessmentInput.originalCaseId,
        expectedAnswer: assessmentInput.expectedAnswer,
        ...(assessmentInput.family === undefined
          ? {}
          : { family: assessmentInput.family }),
        goldEvidenceIds: assessmentInput.goldEvidenceIds,
        protocolMetadata: assessmentInput.protocolMetadata,
        question: assessmentInput.question,
        rawEvidence: [],
        unresolvedGoldEvidenceIds: assessmentInput.unresolvedGoldEvidenceIds,
      },
      usageCaseId: assessmentInput.opaqueCaseKey,
    }),
    escrow,
    execution,
    executorOutput,
    ...(oracleSha256 === undefined ? {} : { oracleSha256 }),
    scorerPid: input.scorerPid,
  });
  return scored.receipt;
}

export async function runPhase74SealedScorerCli(
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  const rawConfig = env.GOODMEMORY_PHASE74_SCORER_CONFIG;
  if (rawConfig === undefined) {
    throw new Error("GOODMEMORY_PHASE74_SCORER_CONFIG is required.");
  }
  const receipt = await runPhase74SealedScorer({
    config: parsePhase74SealedScorerConfig(JSON.parse(rawConfig)),
    env,
    raw: JSON.parse(await Bun.stdin.text()) as Phase74SealedScorerRawInput,
    scorerPid: process.pid,
  });
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

if (import.meta.main) {
  await runPhase74SealedScorerCli();
}
