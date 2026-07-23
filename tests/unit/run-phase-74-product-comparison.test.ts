import { describe, expect, it } from "bun:test";

import {
  runPhase74ProductComparison,
  type Phase74ProductPreparedGroup,
} from "../../scripts/run-phase-74-product-comparison";

const CASES = [
  {
    caseId: "case-a",
    clusterId: "cluster-a",
    memoryGroupId: "group-a",
    question: "Question A?",
  },
  {
    caseId: "case-b",
    clusterId: "cluster-b",
    memoryGroupId: "group-b",
    question: "Question B?",
  },
] as const;

describe("Phase 74 cumulative product runner", () => {
  it("finishes every arm memory-group ingestion before the first query", async () => {
    const events: string[] = [];
    let preparedCount = 0;
    const result = await runPhase74ProductComparison({
      cases: CASES,
      async prepare({ arm, memoryGroupId }) {
        events.push(`prepare:${arm}:${memoryGroupId}`);
        preparedCount += 1;
        return {
          arm,
          ingestionKey: `${arm}/${memoryGroupId}`,
          memoryGroupId,
          async query(testCase) {
            expect(preparedCount).toBe(4);
            events.push(`query:${arm}:${testCase.caseId}`);
            return {
              context: `${arm} context for ${testCase.caseId}`,
              contextTokens: 12,
              queryPathLatencyMs: 20,
              recallLatencyMs: 7,
            };
          },
        } satisfies Phase74ProductPreparedGroup;
      },
      async read({ arm, caseId }) {
        events.push(`read:${arm}:${caseId}`);
        return { answer: `${arm} answer`, latencyMs: 5 };
      },
      async score({ arm, caseId }) {
        events.push(`score:${arm}:${caseId}`);
        return { correct: true, latencyMs: 11, score: 1 };
      },
      selectedEvidenceLedgerFormat: "compact_json",
    });

    expect(events.findIndex((event) => event.startsWith("query:"))).toBe(4);
    expect(result.rows).toHaveLength(4);
  });

  it("records one reader and scorer result per arm and case with judge latency separate", async () => {
    let readerCalls = 0;
    let scorerCalls = 0;
    const result = await runPhase74ProductComparison({
      cases: CASES,
      async prepare({ arm, memoryGroupId }) {
        return {
          arm,
          ingestionKey: `${arm}/${memoryGroupId}`,
          memoryGroupId,
          async query() {
            return {
              context: "evidence",
              contextTokens: 24,
              queryPathLatencyMs: 30,
              recallLatencyMs: 9,
            };
          },
        };
      },
      async read({ arm }) {
        readerCalls += 1;
        return { answer: `${arm} answer`, latencyMs: 6 };
      },
      async score() {
        scorerCalls += 1;
        return { correct: false, latencyMs: 13, score: 0.25 };
      },
      selectedEvidenceLedgerFormat: "compact_json",
    });

    expect(readerCalls).toBe(4);
    expect(scorerCalls).toBe(4);
    expect(result.rows.every((row) =>
      row.productLatencyMs === 36 &&
      row.judgeLatencyMs === 13 &&
      row.recallLatencyMs === 9
    )).toBeTrue();
    expect(result.rows.map(({ arm, caseId }) => `${arm}/${caseId}`).sort())
      .toEqual([
        "phase74-final/case-a",
        "phase74-final/case-b",
        "release-v0.6.0/case-a",
        "release-v0.6.0/case-b",
      ]);
    expect(result.selectedEvidenceLedgerFormat).toBe("compact_json");
  });
});
