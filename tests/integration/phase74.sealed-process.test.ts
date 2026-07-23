import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  buildPhase74SealedBundles,
  parsePhase74SealedExecutionBundle,
  runPhase74SealedProcessPair,
  verifyPhase74SealedScoreReceipt,
} from "../../src/eval/phase74SealedExecution";

const GOLD_SENTINEL = "PHASE74-GOLD-SENTINEL";

describe("Phase 74 sealed process boundary", () => {
  it("keeps labels out of the executor and starts scoring only after executor exit", async () => {
    const directory = await mkdtemp(join(tmpdir(), "phase74-sealed-"));
    try {
      const bundles = buildPhase74SealedBundles({
        cases: [{
          caseId: "upstream-case-1",
          expectedAnswer: GOLD_SENTINEL,
          family: "longmemeval",
          goldEvidenceIds: ["session-a:turn-1"],
          protocolMetadata: { questionType: GOLD_SENTINEL },
          question: "Which database is current?",
          rawEvidence: [{
            content: "Postgres is current.",
            id: "turn-1",
            sourceIds: ["session-a:turn-1"],
          }],
        }],
        runId: "sealed-test-run",
      });

      expect(JSON.stringify(bundles.execution)).not.toContain(GOLD_SENTINEL);
      expect(JSON.stringify(bundles.execution)).not.toContain("upstream-case-1");
      expect(() => parsePhase74SealedExecutionBundle({
        ...bundles.execution,
        expectedAnswer: GOLD_SENTINEL,
      })).toThrow("sealed execution bundle");

      const result = await runPhase74SealedProcessPair({
        cwd: resolve("."),
        execution: bundles.execution,
        escrow: bundles.escrow,
        executorEnv: {
          HOME: process.env.HOME,
          PATH: process.env.PATH,
        },
        executorScript: resolve("tests/fixtures/phase74-sealed-executor.ts"),
        scorerEnv: {
          HOME: process.env.HOME,
          PATH: process.env.PATH,
        },
        scorerScript: resolve("tests/fixtures/phase74-sealed-scorer.ts"),
        transcriptPath: join(directory, "process-transcript.json"),
      });

      expect(result.executor.pid).not.toBe(process.pid);
      expect(result.scorer.pid).not.toBe(process.pid);
      expect(result.executor.pid).not.toBe(result.scorer.pid);
      expect(result.events.map(({ event }) => event)).toEqual([
        "seal",
        "executor_exit",
        "scorer_start",
        "scorer_exit",
      ]);
      expect(result.executor.stdin).not.toContain(GOLD_SENTINEL);
      expect(result.executor.stdout).not.toContain(GOLD_SENTINEL);
      expect(result.executor.stderr).not.toContain(GOLD_SENTINEL);
      expect(result.executor.stdout).not.toContain("upstream-case-1");
      expect(result.executor.output.rows).toHaveLength(1);
      expect(result.scorer.receipt.rows[0]?.score).toBe(0);
      expect(() => verifyPhase74SealedScoreReceipt({
        execution: bundles.execution,
        executorOutput: result.executor.output,
        escrow: bundles.escrow,
        receipt: result.scorer.receipt,
      })).not.toThrow();
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
