import { describe, expect, it } from "bun:test";

import {
  buildPhase74SealedBundles,
  verifyPhase74SealedScoreReceipt,
} from "../../src/eval/phase74SealedExecution";
import {
  scorePhase74UnscoredExecution,
} from "../../src/eval/phase74SealedScoring";
import {
  runPhase74UnscoredExecution,
} from "../../src/eval/phase74UnscoredExecution";

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
      runId: "sealed-scoring",
      stage: "E2",
    });
    let readerCall = 0;
    const unscored = await runPhase74UnscoredExecution({
      baseConfiguration: {},
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
    const scored = await scorePhase74UnscoredExecution({
      artifact: unscored.artifact,
      assess: async (input) => {
        observedOfficialIds.push(input.originalCaseId);
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
});
