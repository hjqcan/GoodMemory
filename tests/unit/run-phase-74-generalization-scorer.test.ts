import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import {
  runPhase74SealedScorer,
} from "../../scripts/run-phase-74-generalization-scorer";
import { buildPhase74SealedBundles } from "../../src/eval/phase74SealedExecution";
import {
  runPhase74UnscoredExecution,
} from "../../src/eval/phase74UnscoredExecution";
import type {
  Phase74UnscoredRetrievalRow,
} from "../../src/eval/phase74UnscoredExecution";

const testCase = {
  caseId: "official-locomo-case",
  expectedAnswer: "Postgres",
  family: "locomo" as const,
  goldEvidenceIds: ["session-a:turn-1"],
  protocolMetadata: { category: "single_hop" },
  question: "Which database is current?",
  rawEvidence: [{
    content: "Postgres is current.",
    id: "turn-1",
    sourceIds: ["session-a:turn-1"],
  }],
};

describe("Phase 74 sealed scorer entrypoint", () => {
  it("builds, writes, and binds the E4 oracle artifact without embeddings", async () => {
    const directory = await mkdtemp(join(tmpdir(), "phase74-scorer-"));
    try {
      const e3Bundles = buildPhase74SealedBundles({
        cases: [testCase],
        runId: "sealed-scorer-e4",
        stage: "E3",
      });
      const e3 = await runPhase74UnscoredExecution({
        baseConfiguration: {},
        countRenderedTokens: (content) => content.length,
        executeRetrieval: async ({ arm }) => ({
          retrievedMemories: [{
            content: "Postgres is current.",
            id: `retrieved-${arm}`,
            sourceIds: ["session-a:turn-1"],
          }],
          snapshotId: `snapshot-${arm}`,
          storedMemories: [{
            content: "Postgres is current.",
            id: `stored-${arm}`,
            sourceIds: ["session-a:turn-1"],
          }],
        }),
        execution: e3Bundles.execution,
        executorPid: 601,
        genericReader: async () => "Postgres",
        prepareRetrieval: async () => {},
        renderEvidenceLedger: async () => "unused",
      });
      const deterministic = e3.artifact.rows.find(
        (row): row is Phase74UnscoredRetrievalRow =>
          row.kind === "retrieval" &&
          row.unit === "recall-plan-deterministic",
      )!;
      const e4Bundles = buildPhase74SealedBundles({
        cases: [testCase],
        runId: "sealed-scorer-e4",
        stage: "E4",
      });
      const e4 = await runPhase74UnscoredExecution({
        baseConfiguration: {},
        countRenderedTokens: (content) => content.length,
        executeRetrieval: async () => {
          throw new Error("E4 must not retrieve again");
        },
        execution: e4Bundles.execution,
        executorPid: 602,
        genericReader: async () => "Postgres",
        loadDeterministicSnapshot: async () => deterministic.snapshot,
        renderEvidenceLedger: async ({ format }) => `${format}: Postgres`,
      });
      const e3Raw = JSON.stringify(e3.artifact);
      const e3ArtifactPath = join(directory, "e3-artifact.json");
      const oracleArtifactPath = join(directory, "oracle-artifact.json");
      await writeFile(e3ArtifactPath, e3Raw);

      const fetch = (async (_request, init) => {
        const body = JSON.parse(String(init?.body)) as {
          response_format?: unknown;
        };
        if (body.response_format !== undefined) {
          return new Response(JSON.stringify({
            choices: [{
              finish_reason: "stop",
              index: 0,
              message: {
                content: JSON.stringify({
                  correct: true,
                  reasoning: "Equivalent.",
                }),
                role: "assistant",
              },
            }],
            usage: { completion_tokens: 3, prompt_tokens: 15 },
          }), { headers: { "content-type": "application/json" } });
        }
        return new Response([
          'data: {"choices":[{"delta":{"content":"Postgres"},"index":0}]}',
          'data: {"choices":[],"usage":{"prompt_tokens":20,"completion_tokens":2}}',
          "data: [DONE]",
          "",
        ].join("\n\n"), {
          headers: { "content-type": "text/event-stream" },
          status: 200,
        });
      }) as typeof globalThis.fetch;
      const scorerInput = {
        config: {
          benchmark: "locomo",
          callBudget: {
            embeddingSpendLimitUsd: 1,
            maxLanguageCalls: 100,
            path: join(directory, "call-budget.json"),
          },
          e3ArtifactPath,
          e3ArtifactSha256: createHash("sha256").update(e3Raw).digest("hex"),
          oracleArtifactPath,
          usage: {
            eventsPath: join(directory, "usage.jsonl"),
            intentsPath: join(directory, "intents.jsonl"),
          },
        },
        env: {
          GOODMEMORY_EVAL_API_KEY: "reader-only",
          GOODMEMORY_EVAL_BASE_URL: "https://ai.gurkiai.com/v1",
          GOODMEMORY_EVAL_MODEL: "gpt-5.6-terra",
          GOODMEMORY_EVAL_PROVIDER: "openai",
          GOODMEMORY_JUDGE_API_KEY: "judge-only",
          GOODMEMORY_JUDGE_BASE_URL: "https://ai.gurkiai.com/v1",
          GOODMEMORY_JUDGE_MODEL: "gpt-5.5",
          GOODMEMORY_JUDGE_PROVIDER: "openai",
        },
        fetch,
        raw: {
          artifact: e4.artifact,
          escrow: e4Bundles.escrow,
          execution: e4Bundles.execution,
          executorOutput: e4.executorOutput,
        },
        scorerPid: 603,
      } as const;
      const receipt = await runPhase74SealedScorer(scorerInput);
      const oracleRaw = await readFile(oracleArtifactPath, "utf8");
      expect(receipt.oracleSha256).toBe(
        createHash("sha256").update(oracleRaw).digest("hex"),
      );
      expect(JSON.parse(oracleRaw).rows).toHaveLength(6);
      await expect(runPhase74SealedScorer(scorerInput)).resolves.toEqual(
        receipt,
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
