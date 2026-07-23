import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  buildPhase74SealedBundles,
  buildPhase74SealedExecutorOutput,
  buildPhase74SealedScoreReceipt,
  listPhase74SealedExpectedRows,
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
        evidenceDirectory: join(directory, "sealed-evidence"),
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
        "labels_committed",
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
      expect((await readdir(join(directory, "sealed-evidence"))).sort()).toEqual([
        "escrow.json",
        "execution.json",
        "executor-output.json",
        "score-receipt.json",
      ]);
      expect(await readFile(
        join(directory, "sealed-evidence", "execution.json"),
        "utf8",
      )).not.toContain(GOLD_SENTINEL);
      expect(await readFile(
        join(directory, "sealed-evidence", "escrow.json"),
        "utf8",
      )).toContain(GOLD_SENTINEL);
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

  it("verifies and commits the scorer-only E4 oracle artifact", async () => {
    const directory = await mkdtemp(join(tmpdir(), "phase74-sealed-e4-"));
    try {
      const bundles = buildPhase74SealedBundles({
        cases: [{
          caseId: "official-e4-case",
          expectedAnswer: GOLD_SENTINEL,
          goldEvidenceIds: ["session-a:turn-1"],
          question: "Which database is current?",
          rawEvidence: [{
            content: "Postgres is current.",
            id: "turn-1",
            sourceIds: ["session-a:turn-1"],
          }],
        }],
        runId: "sealed-e4-process",
        stage: "E4",
      });
      const oracleArtifactPath = join(directory, "oracle-artifact.json");
      const result = await runPhase74SealedProcessPair({
        cwd: directory,
        evidenceDirectory: join(directory, "sealed-evidence"),
        execution: bundles.execution,
        escrow: bundles.escrow,
        executorArtifactPath: join(directory, "executor-artifact.json"),
        expectedOracleE3ArtifactSha256: "0".repeat(64),
        executorEnv: {
          HOME: process.env.HOME,
          PATH: process.env.PATH,
          PHASE74_SEALED_ARTIFACT_PATH: join(
            directory,
            "executor-artifact.json",
          ),
        },
        executorScript: resolve("tests/fixtures/phase74-sealed-executor.ts"),
        scorerArtifactPath: oracleArtifactPath,
        scorerEnv: {
          HOME: process.env.HOME,
          PATH: process.env.PATH,
          PHASE74_SEALED_ORACLE_ARTIFACT_PATH: oracleArtifactPath,
        },
        scorerScript: resolve("tests/fixtures/phase74-sealed-scorer.ts"),
        transcriptPath: join(directory, "process-transcript.json"),
      });

      expect(result.scorer.receipt.oracleSha256).toBe(
        createHash("sha256").update(result.scorer.artifact!).digest("hex"),
      );
      expect(await readFile(
        join(directory, "sealed-evidence", "oracle-artifact.json"),
        "utf8",
      )).toBe(result.scorer.artifact!);
      expect((await readdir(join(directory, "sealed-evidence"))).sort()).toEqual([
        "escrow.json",
        "execution.json",
        "executor-output.json",
        "oracle-artifact.json",
        "score-receipt.json",
      ]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("resumes after scorer failure without rerunning the sealed executor", async () => {
    const directory = await mkdtemp(join(tmpdir(), "phase74-sealed-resume-"));
    try {
      const bundles = buildPhase74SealedBundles({
        cases: [{
          caseId: "resume-case",
          expectedAnswer: GOLD_SENTINEL,
          goldEvidenceIds: [],
          question: "Which database is current?",
          rawEvidence: [],
        }],
        runId: "sealed-resume",
        stage: "E2",
      });
      const artifactPath = join(directory, "executor-artifact.json");
      const common = {
        cwd: directory,
        evidenceDirectory: join(directory, "sealed-evidence"),
        execution: bundles.execution,
        escrow: bundles.escrow,
        executorArtifactPath: artifactPath,
        executorEnv: {
          HOME: process.env.HOME,
          PATH: process.env.PATH,
          PHASE74_SEALED_ARTIFACT_PATH: artifactPath,
        },
        scorerScript: resolve("tests/fixtures/phase74-sealed-scorer.ts"),
        transcriptPath: join(directory, "process-transcript.json"),
      };
      await expect(runPhase74SealedProcessPair({
        ...common,
        executorScript: resolve("tests/fixtures/phase74-sealed-executor.ts"),
        scorerEnv: {
          HOME: process.env.HOME,
          PATH: process.env.PATH,
          PHASE74_SEALED_SCORER_FAIL: "1",
        },
      })).rejects.toThrow("sealed scorer failed");

      const resumed = await runPhase74SealedProcessPair({
        ...common,
        executorScript: join(directory, "must-not-run.ts"),
        scorerEnv: {
          HOME: process.env.HOME,
          PATH: process.env.PATH,
        },
      });
      expect(resumed.events.map(({ event }) => event)).toContain(
        "executor_reused",
      );
      expect(resumed.scorer.receipt.rows).toHaveLength(2);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rejects an E4 receipt without a scorer-only oracle artifact", () => {
    const bundles = buildPhase74SealedBundles({
      cases: [{
        caseId: "official-e4-case",
        expectedAnswer: "Postgres",
        goldEvidenceIds: [],
        question: "Which database is current?",
        rawEvidence: [{
          content: "Postgres is current.",
          id: "turn-1",
          sourceIds: ["session-a:turn-1"],
        }],
      }],
      runId: "sealed-e4-oracle",
      stage: "E4",
    });
    const output = buildPhase74SealedExecutorOutput({
      artifactSha256: "d".repeat(64),
      execution: bundles.execution,
      executorPid: 401,
      rows: listPhase74SealedExpectedRows(bundles.execution).map(
        ({ caseKey, rowKey }) => ({
          answer: "Postgres",
          caseKey,
          observedAnswer: "Postgres",
          rowKey,
          snapshotId: "e3-snapshot",
          sourceRowKey: rowKey,
        }),
      ),
    });
    const receipt = buildPhase74SealedScoreReceipt({
      escrow: bundles.escrow,
      executorOutput: output,
      rows: output.rows.map(({ caseKey, rowKey }) => ({
        caseKey,
        correct: true,
        observedCorrect: true,
        observedScore: 1,
        rowKey,
        score: 1,
      })),
      scorerPid: 402,
    });
    expect(() => verifyPhase74SealedScoreReceipt({
      escrow: bundles.escrow,
      execution: bundles.execution,
      executorOutput: output,
      receipt,
    })).toThrow("receipt chain is invalid");
  });
});
