import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
      await writeFile(
        join(directory, ".env"),
        "GOODMEMORY_JUDGE_API_KEY=PHASE74-AUTOLOAD-SENTINEL\n",
      );
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
        stage: "E2",
      });

      expect(JSON.stringify(bundles.execution)).not.toContain(GOLD_SENTINEL);
      expect(JSON.stringify(bundles.execution)).not.toContain("upstream-case-1");
      expect(() => parsePhase74SealedExecutionBundle({
        ...bundles.execution,
        expectedAnswer: GOLD_SENTINEL,
      })).toThrow("sealed execution bundle");

      const result = await runPhase74SealedProcessPair({
        cwd: directory,
        executorArtifactPath: join(directory, "executor-artifact.json"),
        execution: bundles.execution,
        escrow: bundles.escrow,
        executorEnv: {
          HOME: process.env.HOME,
          PATH: process.env.PATH,
          PHASE74_SEALED_ARTIFACT_PATH: join(
            directory,
            "executor-artifact.json",
          ),
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
        "artifact_verified",
        "scorer_start",
        "scorer_exit",
      ]);
      expect(result.executor.stdin).not.toContain(GOLD_SENTINEL);
      expect(result.executor.stdout).not.toContain(GOLD_SENTINEL);
      expect(result.executor.stderr).not.toContain(GOLD_SENTINEL);
      expect(result.executor.artifact).not.toContain(GOLD_SENTINEL);
      expect(result.executor.stdout).not.toContain("upstream-case-1");
      expect(result.executor.output.rows).toHaveLength(2);
      const executorObservation = JSON.parse(
        result.executor.output.rows[0]!.answer ?? "null",
      ) as { argv: string[]; env: Record<string, string>; pid: number };
      expect(executorObservation.pid).toBe(result.executor.pid);
      expect(JSON.stringify(executorObservation.argv)).not.toContain(GOLD_SENTINEL);
      expect(JSON.stringify(executorObservation.env)).not.toContain(GOLD_SENTINEL);
      expect(JSON.stringify(executorObservation.env)).not.toContain(
        "benchmark-root",
      );
      expect(JSON.stringify(executorObservation.env)).not.toContain(
        "PHASE74-AUTOLOAD-SENTINEL",
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
      stage: "E2",
    });
    const [firstCase, secondCase] = bundles.execution.cases;
    const executorOutput = buildPhase74SealedExecutorOutput({
      artifactSha256: "a".repeat(64),
      execution: bundles.execution,
      executorPid: 100,
      rows: [
        {
          answer: "Postgres",
          caseKey: firstCase!.caseKey,
          observedAnswer: "Postgres",
          rowKey: `${firstCase!.caseKey}:E2:claim-temporal-off`,
          snapshotId: "snapshot-a",
          sourceRowKey: `${firstCase!.caseKey}:E2:claim-temporal-off`,
        },
        {
          answer: "Postgres",
          caseKey: firstCase!.caseKey,
          observedAnswer: "Postgres",
          rowKey: `${firstCase!.caseKey}:E2:claim-temporal-on`,
          snapshotId: "snapshot-b",
          sourceRowKey: `${firstCase!.caseKey}:E2:claim-temporal-on`,
        },
        {
          answer: "SQLite",
          caseKey: secondCase!.caseKey,
          observedAnswer: "SQLite",
          rowKey: `${secondCase!.caseKey}:E2:claim-temporal-off`,
          snapshotId: "snapshot-c",
          sourceRowKey: `${secondCase!.caseKey}:E2:claim-temporal-off`,
        },
        {
          answer: "SQLite",
          caseKey: secondCase!.caseKey,
          observedAnswer: "SQLite",
          rowKey: `${secondCase!.caseKey}:E2:claim-temporal-on`,
          snapshotId: "snapshot-d",
          sourceRowKey: `${secondCase!.caseKey}:E2:claim-temporal-on`,
        },
      ],
    });
    const scoreRows = executorOutput.rows.map(({ caseKey, rowKey }) => ({
      caseKey,
      correct: true,
      observedCorrect: true,
      observedScore: 1,
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
      artifactSha256: "b".repeat(64),
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

    const missingArmOutput = buildPhase74SealedExecutorOutput({
      artifactSha256: "c".repeat(64),
      execution: bundles.execution,
      executorPid: 100,
      rows: executorOutput.rows.filter(({ rowKey }) =>
        rowKey !== `${firstCase!.caseKey}:E2:claim-temporal-on`
      ),
    });
    const missingArmReceipt = buildPhase74SealedScoreReceipt({
      escrow: bundles.escrow,
      executorOutput: missingArmOutput,
      rows: scoreRows.filter(({ rowKey }) =>
        rowKey !== `${firstCase!.caseKey}:E2:claim-temporal-on`
      ),
      scorerPid: 101,
    });
    expect(() => verifyPhase74SealedScoreReceipt({
      execution: bundles.execution,
      executorOutput: missingArmOutput,
      escrow: bundles.escrow,
      receipt: missingArmReceipt,
    })).toThrow("receipt chain is invalid");
  });
});
