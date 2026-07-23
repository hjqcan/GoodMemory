import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  buildPhase74SealedBundles,
  runPhase74SealedProcessPair,
} from "../../src/eval/phase74SealedExecution";
import {
  createPhase74UnscoredFileCheckpoint,
  runPhase74UnscoredExecution,
} from "../../src/eval/phase74UnscoredExecution";

describe("Phase 74 sealed live process entrypoints", () => {
  it("runs the production executor and scorer with disjoint model capabilities", async () => {
    const directory = await mkdtemp(join(tmpdir(), "phase74-live-process-"));
    try {
      const runDirectory = join(directory, "run");
      const checkpointDirectory = join(runDirectory, "unscored-checkpoints");
      const artifactPath = join(runDirectory, "executor-artifact.json");
      const bundles = buildPhase74SealedBundles({
        cases: [{
          caseId: "official-locomo-id",
          expectedAnswer: "Postgres",
          family: "locomo",
          goldEvidenceIds: ["session-a:turn-1"],
          protocolMetadata: { category: "single_hop" },
          question: "Which database is current?",
          rawEvidence: [{
            content: "Postgres is current.",
            id: "turn-1",
            sourceIds: ["session-a:turn-1"],
          }],
        }],
        runId: "sealed-live-process",
        stage: "E2",
      });
      await runPhase74UnscoredExecution({
        baseConfiguration: {},
        checkpoint: createPhase74UnscoredFileCheckpoint({
          directory: checkpointDirectory,
          execution: bundles.execution,
        }),
        countRenderedTokens: (content) => content.length,
        executeRetrieval: async ({ arm }) => ({
          retrievedMemories: [{
            content: "Postgres is current.",
            id: `retrieved-${arm}`,
            sourceIds: ["session-1:source-1"],
          }],
          snapshotId: `snapshot-${arm}`,
          storedMemories: [],
        }),
        execution: bundles.execution,
        executorPid: process.pid,
        genericReader: async () => "Postgres",
        renderEvidenceLedger: async () => "unused",
      });

      const executorConfig = JSON.stringify({
        artifactPath,
        baseConfiguration: {},
        callBudget: {
          embeddingSpendLimitUsd: 1,
          maxLanguageCalls: 100,
          path: join(runDirectory, "executor-call-budget.json"),
        },
        checkpointDirectory,
        datasetSha256: "1".repeat(64),
        evaluatorSourceSha256: "2".repeat(64),
        rerankerMode: "deterministic",
        runDirectory,
        usage: {
          eventsPath: join(runDirectory, "executor-usage.jsonl"),
          intentsPath: join(runDirectory, "executor-intents.jsonl"),
        },
      });
      const scorerConfig = JSON.stringify({
        benchmark: "locomo",
        usage: {
          eventsPath: join(runDirectory, "scorer-usage.jsonl"),
          intentsPath: join(runDirectory, "scorer-intents.jsonl"),
        },
      });
      const result = await runPhase74SealedProcessPair({
        cwd: directory,
        execution: bundles.execution,
        escrow: bundles.escrow,
        executorArtifactPath: artifactPath,
        executorEnv: {
          GOODMEMORY_EMBEDDING_API_KEY: "embedding-only",
          GOODMEMORY_EMBEDDING_BASE_URL: "https://openrouter.ai/api/v1",
          GOODMEMORY_EMBEDDING_MODEL: "text-embedding-3-small",
          GOODMEMORY_EMBEDDING_PROVIDER: "openai",
          GOODMEMORY_EVAL_API_KEY: "executor-only",
          GOODMEMORY_EVAL_BASE_URL: "https://ai.gurkiai.com/v1",
          GOODMEMORY_EVAL_MODEL: "gpt-5.6-terra",
          GOODMEMORY_EVAL_PROVIDER: "openai",
          GOODMEMORY_PHASE74_EXECUTOR_CONFIG: executorConfig,
          HOME: process.env.HOME,
          PATH: process.env.PATH,
        },
        executorScript: resolve(
          "scripts/run-phase-74-generalization-executor.ts",
        ),
        scorerEnv: {
          GOODMEMORY_JUDGE_API_KEY: "judge-only",
          GOODMEMORY_JUDGE_BASE_URL: "https://ai.gurkiai.com/v1",
          GOODMEMORY_JUDGE_MODEL: "gpt-5.5",
          GOODMEMORY_JUDGE_PROVIDER: "openai",
          GOODMEMORY_PHASE74_SCORER_CONFIG: scorerConfig,
          HOME: process.env.HOME,
          PATH: process.env.PATH,
        },
        scorerScript: resolve(
          "scripts/run-phase-74-generalization-scorer.ts",
        ),
        transcriptPath: join(runDirectory, "process-transcript.json"),
      });

      expect(result.executor.output.rows).toHaveLength(2);
      expect(result.scorer.receipt.rows).toHaveLength(2);
      expect(result.scorer.receipt.rows.every(({ score }) => score === 1)).toBe(
        true,
      );
      expect(result.executor.artifact).not.toContain("official-locomo-id");
      expect(result.executor.artifact).not.toContain("single_hop");
      expect(result.executor.artifact).not.toContain("judge-only");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
