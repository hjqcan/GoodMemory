import { describe, expect, it } from "bun:test";

import {
  buildPhase74SealedBundles,
  verifyPhase74SealedScoreReceipt,
} from "../../src/eval/phase74SealedExecution";
import {
  materializePhase74SealedReport,
  runPhase74SealedOracleMatrix,
  scorePhase74UnscoredExecution,
} from "../../src/eval/phase74SealedScoring";
import {
  runPhase74UnscoredExecution,
} from "../../src/eval/phase74UnscoredExecution";
import { buildEvalRunIdentity } from "../../src/eval/runIdentity";

const scoredCase = {
  caseId: "official-private-id",
  expectedAnswer: "Postgres",
  family: "longmemeval" as const,
  goldEvidenceIds: ["session-a:turn-1"],
  protocolMetadata: { questionType: "single-session-user" },
  question: "Which database is current?",
  rawEvidence: [{
    content: "Postgres is current.",
    id: "turn-1",
    sourceIds: ["session-a:turn-1"],
  }],
};

describe("Phase 74 sealed scoring", () => {
  it("scores only after the unscored artifact is sealed and preserves reuse attribution", async () => {
    const bundles = buildPhase74SealedBundles({
      cases: [scoredCase],
      executionConfiguration: { caseConcurrency: 2 },
      runId: "sealed-scoring",
      stage: "E2",
    });
    let readerCall = 0;
    const unscored = await runPhase74UnscoredExecution({
      baseConfiguration: { caseConcurrency: 2 },
      countRenderedTokens: (content) => content.length,
      executeRetrieval: async ({ arm }) => ({
        retrievedMemories: [{
          content: "Postgres is current.",
          id: "retrieved-shared",
          sourceIds: ["session-1:source-1"],
        }],
        snapshotId: `snapshot-${arm}`,
        storedMemories: [],
      }),
      execution: bundles.execution,
      executorPid: 301,
      genericReader: async () => readerCall++ === 0 ? "Postgres" : "wrong",
      renderEvidenceLedger: async () => "unused",
    });
    expect(unscored.executorOutput.rows[1]?.answer).toBe("Postgres");
    expect(unscored.executorOutput.rows[1]?.observedAnswer).toBe("wrong");
    expect(unscored.executorOutput.rows[1]?.sourceRowKey).toBe(
      unscored.executorOutput.rows[0]?.rowKey,
    );

    const observedOfficialIds: string[] = [];
    let activeAssessments = 0;
    let maximumActiveAssessments = 0;
    const scored = await scorePhase74UnscoredExecution({
      artifact: unscored.artifact,
      assess: async (input) => {
        observedOfficialIds.push(input.originalCaseId);
        activeAssessments += 1;
        maximumActiveAssessments = Math.max(
          maximumActiveAssessments,
          activeAssessments,
        );
        await new Promise((resolve) => setTimeout(resolve, 5));
        activeAssessments -= 1;
        expect(input.expectedAnswer).toBe("Postgres");
        expect(input.opaqueCaseKey).not.toBe(input.originalCaseId);
        return {
          correct: input.answer === input.expectedAnswer,
          score: Number(input.answer === input.expectedAnswer),
        };
      },
      escrow: bundles.escrow,
      execution: bundles.execution,
      executorOutput: unscored.executorOutput,
      scorerPid: 302,
    });

    expect(observedOfficialIds).toEqual([
      "official-private-id",
      "official-private-id",
    ]);
    expect(maximumActiveAssessments).toBe(2);
    expect(scored.receipt.rows).toEqual([
      expect.objectContaining({
        correct: true,
        observedCorrect: true,
        observedScore: 1,
        score: 1,
      }),
      expect.objectContaining({
        correct: true,
        observedCorrect: false,
        observedScore: 0,
        score: 1,
      }),
    ]);
    expect(scored.rows[1]).toEqual(expect.objectContaining({
      answer: "Postgres",
      correct: true,
      observedAnswer: "wrong",
      observedCorrect: false,
      score: 1,
    }));
    expect(() => verifyPhase74SealedScoreReceipt({
      escrow: bundles.escrow,
      execution: bundles.execution,
      executorOutput: unscored.executorOutput,
      receipt: scored.receipt,
    })).not.toThrow();

    const report = materializePhase74SealedReport({
      artifact: unscored.artifact,
      escrow: bundles.escrow,
      execution: bundles.execution,
      executorOutput: unscored.executorOutput,
      identity: buildEvalRunIdentity({
        answerModel: { gateway: "executor", model: "reader", provider: "openai" },
        benchmark: "longmemeval-full",
        configuration: {},
        datasetSha256: "d".repeat(64),
        generatedAt: "2026-07-22T00:00:00.000Z",
        generatedBy: "sealed-test",
        judgeModel: { gateway: "scorer", model: "judge", provider: "openai" },
        promptSha256s: { reader: "e".repeat(64) },
        runId: bundles.execution.runId,
      }),
      receipt: scored.receipt,
    });
    expect(report.executions).toHaveLength(2);
    expect(report.executions[0]).toEqual(expect.objectContaining({
      arm: "claim-temporal-off",
      caseId: "official-private-id",
      correct: true,
      score: 1,
      stage: "E2",
    }));
    expect(report.executions[1]?.evaluationAttribution).toEqual(
      expect.objectContaining({
        observedAnswer: "wrong",
        observedCorrect: false,
        reused: true,
        sourceArm: "claim-temporal-off",
      }),
    );
    expect(report.summary).toEqual(expect.objectContaining({
      caseCount: 1,
      executionFailures: 0,
    }));
  });

  it("rejects a tampered unscored artifact before assessment", async () => {
    const bundles = buildPhase74SealedBundles({
      cases: [scoredCase],
      runId: "sealed-scoring-tamper",
      stage: "E2",
    });
    const unscored = await runPhase74UnscoredExecution({
      baseConfiguration: {},
      countRenderedTokens: (content) => content.length,
      executeRetrieval: async ({ arm }) => ({
        retrievedMemories: [],
        snapshotId: `snapshot-${arm}`,
        storedMemories: [],
      }),
      execution: bundles.execution,
      executorPid: 303,
      genericReader: async () => "Postgres",
      renderEvidenceLedger: async () => "unused",
    });
    unscored.artifact.rows[0]!.answer = "tampered";
    let assessmentCalls = 0;
    await expect(scorePhase74UnscoredExecution({
      artifact: unscored.artifact,
      assess: async () => {
        assessmentCalls += 1;
        return { correct: true, score: 1 };
      },
      escrow: bundles.escrow,
      execution: bundles.execution,
      executorOutput: unscored.executorOutput,
      scorerPid: 304,
    })).rejects.toThrow("artifact digest");
    expect(assessmentCalls).toBe(0);
  });

  it("builds all six oracle arms only inside the sealed scorer", async () => {
    const e3Bundles = buildPhase74SealedBundles({
      cases: [scoredCase],
      runId: "sealed-oracle",
      stage: "E3",
    });
    const e3 = await runPhase74UnscoredExecution({
      baseConfiguration: {},
      countRenderedTokens: (content) => content.length,
      executeRetrieval: async ({ arm }) => ({
        retrievedMemories: [{
          content: "Postgres is current.",
          id: `retrieved-${arm}`,
          sourceIds: ["session-1:source-1"],
        }],
        snapshotId: `snapshot-${arm}`,
        storedMemories: [{
          content: "Postgres is current.",
          id: `stored-${arm}`,
          sourceIds: ["session-1:source-1"],
        }],
      }),
      execution: e3Bundles.execution,
      executorPid: 501,
      genericReader: async () => "Postgres",
      renderEvidenceLedger: async () => "unused",
    });
    const e4Bundles = buildPhase74SealedBundles({
      cases: [scoredCase],
      runId: "sealed-oracle",
      stage: "E4",
    });
    const oracle = await runPhase74SealedOracleMatrix({
      countRenderedTokens: (content) => content.length,
      e3Artifact: e3.artifact,
      escrow: e4Bundles.escrow,
      execution: e4Bundles.execution,
      genericReader: async () => "Postgres",
      judge: async () => ({ correct: true }),
      protocolReader: async () => "Postgres",
    });

    expect(oracle.artifact.rows).toHaveLength(6);
    expect(new Set(oracle.artifact.rows.map(({ arm }) => arm))).toHaveLength(6);
    expect(oracle.artifact.rows.every(({ caseId }) =>
      caseId === "official-private-id"
    )).toBe(true);
    expect(oracle.sha256).toMatch(/^[a-f0-9]{64}$/u);
  });
});
