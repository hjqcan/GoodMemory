import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  buildPhase74SealedBundles,
  buildPhase74SealedExecutorOutput,
  buildPhase74SealedScoreReceipt,
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
      const executorObservation = JSON.parse(
        result.executor.output.rows[0]!.answer ?? "null",
      ) as { argv: string[]; env: Record<string, string>; pid: number };
      expect(executorObservation.pid).toBe(result.executor.pid);
      expect(JSON.stringify(executorObservation.argv)).not.toContain(GOLD_SENTINEL);
      expect(JSON.stringify(executorObservation.env)).not.toContain(GOLD_SENTINEL);
      expect(JSON.stringify(executorObservation.env)).not.toContain(
        "benchmark-root",
      );
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

  it("binds every multi-arm result by a unique row key", () => {
    const bundles = buildPhase74SealedBundles({
      cases: [
        {
          caseId: "upstream-case-1",
          expectedAnswer: "Postgres",
          goldEvidenceIds: [],
          question: "Which database is current?",
          rawEvidence: [{
            content: "Postgres is current.",
            id: "turn-1",
            sourceIds: ["session-a:turn-1"],
          }],
        },
        {
          caseId: "upstream-case-2",
          expectedAnswer: "SQLite",
          goldEvidenceIds: [],
          question: "Which database was used before?",
          rawEvidence: [{
            content: "SQLite was used before Postgres.",
            id: "turn-2",
            sourceIds: ["session-b:turn-2"],
          }],
        },
      ],
      runId: "sealed-multi-arm-run",
    });
    const [firstCase, secondCase] = bundles.execution.cases;
    const executorOutput = buildPhase74SealedExecutorOutput({
      execution: bundles.execution,
      executorPid: 100,
      rows: [
        {
          answer: "Postgres",
          caseKey: firstCase!.caseKey,
          rowKey: `${firstCase!.caseKey}:fact-only`,
          snapshotId: "snapshot-a",
        },
        {
          answer: "Postgres",
          caseKey: firstCase!.caseKey,
          rowKey: `${firstCase!.caseKey}:candidate`,
          snapshotId: "snapshot-b",
        },
        {
          answer: "SQLite",
          caseKey: secondCase!.caseKey,
          rowKey: `${secondCase!.caseKey}:fact-only`,
          snapshotId: "snapshot-c",
        },
        {
          answer: "SQLite",
          caseKey: secondCase!.caseKey,
          rowKey: `${secondCase!.caseKey}:candidate`,
          snapshotId: "snapshot-d",
        },
      ],
    });
    const scoreRows = executorOutput.rows.map(({ caseKey, rowKey }) => ({
      caseKey,
      correct: true,
      rowKey,
      score: 1,
    }));
    const receipt = buildPhase74SealedScoreReceipt({
      escrow: bundles.escrow,
      executorOutput,
      rows: scoreRows,
      scorerPid: 101,
    });

    expect(() => verifyPhase74SealedScoreReceipt({
      execution: bundles.execution,
      executorOutput,
      escrow: bundles.escrow,
      receipt,
    })).not.toThrow();

    const reorderedReceipt = buildPhase74SealedScoreReceipt({
      escrow: bundles.escrow,
      executorOutput,
      rows: [...scoreRows].reverse(),
      scorerPid: 101,
    });
    expect(() => verifyPhase74SealedScoreReceipt({
      execution: bundles.execution,
      executorOutput,
      escrow: bundles.escrow,
      receipt: reorderedReceipt,
    })).toThrow("receipt chain is invalid");

    const missingCaseOutput = buildPhase74SealedExecutorOutput({
      execution: bundles.execution,
      executorPid: 100,
      rows: executorOutput.rows.slice(0, 2),
    });
    const missingCaseReceipt = buildPhase74SealedScoreReceipt({
      escrow: bundles.escrow,
      executorOutput: missingCaseOutput,
      rows: scoreRows.slice(0, 2),
      scorerPid: 101,
    });
    expect(() => verifyPhase74SealedScoreReceipt({
      execution: bundles.execution,
      executorOutput: missingCaseOutput,
      escrow: bundles.escrow,
      receipt: missingCaseReceipt,
    })).toThrow("receipt chain is invalid");
  });
});
