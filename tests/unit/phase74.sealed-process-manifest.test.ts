import { describe, expect, it } from "bun:test";

import {
  buildPhase74SealedBundles,
  buildPhase74SealedExecutorOutput,
  buildPhase74SealedProcessManifest,
  buildPhase74SealedScoreReceipt,
  parsePhase74SealedProcessManifest,
  verifyPhase74SealedProcessManifest,
} from "../../src/eval/phase74SealedExecution";

function createFixture() {
  const bundles = buildPhase74SealedBundles({
    cases: [{
      caseId: "official-case-1",
      expectedAnswer: "Postgres",
      goldEvidenceIds: ["session-a:turn-1"],
      question: "Which database is current?",
      rawEvidence: [{
        content: "Postgres is current.",
        id: "turn-1",
        sourceIds: ["session-a:turn-1"],
      }],
    }],
    executionConfiguration: { caseConcurrency: 1 },
    runId: "sealed-process-manifest",
    stage: "E2",
  });
  const executorOutput = buildPhase74SealedExecutorOutput({
    artifactSha256: "a".repeat(64),
    execution: bundles.execution,
    executorPid: 101,
    rows: bundles.execution.cases.flatMap(({ caseKey }) => [
      "claim-temporal-off",
      "claim-temporal-on",
    ].map((unit) => ({
      answer: "Postgres",
      caseKey,
      observedAnswer: "Postgres",
      rowKey: `${caseKey}:E2:${unit}`,
      snapshotId: `${unit}-snapshot`,
      sourceRowKey: `${caseKey}:E2:${unit}`,
    }))),
  });
  const receipt = buildPhase74SealedScoreReceipt({
    escrow: bundles.escrow,
    executorOutput,
    rows: executorOutput.rows.map(({ caseKey, rowKey }) => ({
      caseKey,
      correct: true,
      observedCorrect: true,
      observedScore: 1,
      rowKey,
      score: 1,
    })),
    scorerPid: 202,
  });
  const events = [
    { event: "seal" },
    { event: "executor_exit", pid: 101 },
    { event: "artifact_verified" },
    { event: "labels_committed" },
    { event: "scorer_start" },
    { event: "scorer_exit", pid: 202 },
  ] as const;
  return { ...bundles, events, executorOutput, receipt };
}

describe("Phase 74 sealed process manifest", () => {
  it("binds the fixed process order, process ids, evidence names, and hashes", () => {
    const fixture = createFixture();
    const manifest = buildPhase74SealedProcessManifest(fixture);

    expect(() => verifyPhase74SealedProcessManifest({
      execution: fixture.execution,
      executorOutput: fixture.executorOutput,
      manifest,
      receipt: fixture.receipt,
    })).not.toThrow();
    expect(parsePhase74SealedProcessManifest(manifest)).toEqual(manifest);
    expect(manifest.evidence).toEqual({
      escrow: "escrow.json",
      execution: "execution.json",
      executorOutput: "executor-output.json",
      scoreReceipt: "score-receipt.json",
    });
  });

  it("rejects reordered events, pid drift, digest drift, and renamed evidence", () => {
    const fixture = createFixture();
    const manifest = buildPhase74SealedProcessManifest(fixture);
    const verify = (candidate: unknown) => verifyPhase74SealedProcessManifest({
      execution: fixture.execution,
      executorOutput: fixture.executorOutput,
      manifest: candidate,
      receipt: fixture.receipt,
    });

    expect(() => verify({
      ...manifest,
      events: [manifest.events[1], manifest.events[0], ...manifest.events.slice(2)],
    })).toThrow("process manifest");
    expect(() => verify({
      ...manifest,
      events: manifest.events.map((event, index) =>
        index === 1 ? { ...event, pid: 999 } : event
      ),
    })).toThrow("process manifest");
    expect(() => verify({
      ...manifest,
      receiptSha256: "b".repeat(64),
    })).toThrow("process manifest");
    expect(() => verify({
      ...manifest,
      evidence: { ...manifest.evidence, execution: "labels.json" },
    })).toThrow("process manifest");
  });
});
