import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildPhase74SealedBundles,
} from "../../src/eval/phase74SealedExecution";
import {
  createPhase74UnscoredFileCheckpoint,
  runPhase74UnscoredExecution,
  serializePhase74UnscoredArtifact,
  sha256Phase74UnscoredArtifact,
} from "../../src/eval/phase74UnscoredExecution";
import type { Phase74RetrievalSnapshot } from "../../src/eval/phase74Generalization";

const testCase = {
  caseId: "private-upstream-id",
  expectedAnswer: "PHASE74-GOLD-SENTINEL",
  goldEvidenceIds: ["session-a:turn-1"],
  protocolMetadata: { rubric: "PHASE74-GOLD-SENTINEL" },
  question: "Which database is current?",
  rawEvidence: [{
    content: "Postgres is current.",
    id: "turn-1",
    sourceIds: ["session-a:turn-1"],
  }],
};

function snapshot(id: string): Phase74RetrievalSnapshot {
  return {
    retrievedMemories: [{
      content: "Postgres is current.",
      id: `${id}-retrieved`,
      sourceIds: ["session-1:source-1"],
    }],
    snapshotId: id,
    storedMemories: [{
      content: "Postgres is current.",
      id: `${id}-stored`,
      sourceIds: ["session-1:source-1"],
    }],
  };
}

describe("Phase 74 unscored execution", () => {
  it("serializes the normalized artifact bytes used by the sealed digest", async () => {
    const bundles = buildPhase74SealedBundles({
      cases: [testCase],
      runId: "unscored-normalized-serialization",
      stage: "E2",
    });
    const result = await runPhase74UnscoredExecution({
      baseConfiguration: {},
      countRenderedTokens: (content) => Buffer.byteLength(content),
      executeRetrieval: async ({ arm }) => ({
        storedMemories: [],
        snapshotId: `snapshot-${arm}`,
        retrievedMemories: [],
      }),
      execution: bundles.execution,
      executorPid: 100,
      genericReader: async () => "Postgres",
      renderEvidenceLedger: async () => "unused",
    });

    const serialized = serializePhase74UnscoredArtifact(result.artifact);
    expect(Bun.SHA256.hash(serialized, "hex")).toBe(
      result.executorOutput.artifactSha256,
    );
    expect(serialized).not.toBe(JSON.stringify(result.artifact));
  });

  it("executes every sealed retrieval arm without labels or score fields", async () => {
    const bundles = buildPhase74SealedBundles({
      cases: [testCase],
      runId: "unscored-e2",
      stage: "E2",
    });
    let clock = 0;
    const result = await runPhase74UnscoredExecution({
      baseConfiguration: {},
      countRenderedTokens: (content) => Buffer.byteLength(content),
      executeRetrieval: async ({ arm, testCase: recallCase }) => {
        expect(JSON.stringify(recallCase)).not.toContain("PHASE74-GOLD-SENTINEL");
        return snapshot(`snapshot-${arm}`);
      },
      execution: bundles.execution,
      executorPid: 101,
      genericReader: async ({ context }) => `answer:${context}`,
      now: () => clock++,
      renderEvidenceLedger: async () => "unused",
    });

    expect(result.artifact.rows).toHaveLength(2);
    expect(result.executorOutput.rows).toHaveLength(2);
    expect(result.executorOutput.artifactSha256).toBe(
      sha256Phase74UnscoredArtifact(result.artifact),
    );
    expect(result.artifact.rows.every((row) => row.kind === "retrieval")).toBe(
      true,
    );
    expect(JSON.stringify(result.artifact)).not.toContain(
      "PHASE74-GOLD-SENTINEL",
    );
    expect(JSON.stringify(result.artifact)).not.toContain('"correct"');
    expect(JSON.stringify(result.artifact)).not.toContain('"score"');
    expect(JSON.stringify(result.artifact)).not.toContain("protocolMetadata");
    for (const row of result.artifact.rows) {
      if (row.kind === "retrieval") {
        expect(row.snapshot.evaluation).toBeUndefined();
      }
    }
  });

  it("rejects a retrieval snapshot contaminated by scored checkpoint state", async () => {
    const bundles = buildPhase74SealedBundles({
      cases: [testCase],
      runId: "unscored-contamination",
      stage: "E2",
    });
    await expect(runPhase74UnscoredExecution({
      baseConfiguration: {},
      countRenderedTokens: (content) => content.length,
      executeRetrieval: async () => ({
        ...snapshot("contaminated"),
        evaluation: {
          answer: "gold-derived",
          answerLatencyMs: 1,
          attribution: {
            inputSha256: "input",
            observedAnswer: "gold-derived",
            observedCorrect: true,
            observedScore: 1,
            reused: false,
            sourceArm: "claim-temporal-off",
            sourceSnapshotId: "contaminated",
          },
          contextTokens: 1,
          contextTokensBeforeTruncation: 1,
          contextTruncated: false,
          correct: true,
          productLatencyMs: 1,
          recallLatencyMs: 1,
          score: 1,
        },
      }),
      execution: bundles.execution,
      executorPid: 101,
      genericReader: async () => "unused",
      renderEvidenceLedger: async () => "unused",
    })).rejects.toThrow("scored retrieval state");
  });

  it("rejects execution configuration drift before retrieval", async () => {
    const bundles = buildPhase74SealedBundles({
      cases: [testCase],
      executionConfiguration: {
        retrieval: { preRankLimit: 32, selectedLimit: 12 },
      },
      runId: "unscored-config-drift",
      stage: "E2",
    });
    let retrievalCalls = 0;
    await expect(runPhase74UnscoredExecution({
      baseConfiguration: {},
      countRenderedTokens: (content) => content.length,
      executeRetrieval: async () => {
        retrievalCalls += 1;
        return snapshot("unused");
      },
      execution: bundles.execution,
      executorPid: 101,
      genericReader: async () => "unused",
      renderEvidenceLedger: async () => "unused",
    })).rejects.toThrow("configuration digest");
    expect(retrievalCalls).toBe(0);
  });

  it("binds all four E4 renderings to one unscored E3 snapshot", async () => {
    const bundles = buildPhase74SealedBundles({
      cases: [testCase],
      runId: "unscored-e4",
      stage: "E4",
    });
    const source = snapshot("deterministic-e3-snapshot");
    const result = await runPhase74UnscoredExecution({
      baseConfiguration: {},
      countRenderedTokens: (content) => Buffer.byteLength(content),
      executeRetrieval: async () => {
        throw new Error("E4 must not execute retrieval");
      },
      execution: bundles.execution,
      executorPid: 102,
      genericReader: async ({ context }) => context,
      loadDeterministicSnapshot: async () => source,
      renderEvidenceLedger: async ({ format }) => `ledger:${format}`,
    });

    expect(result.artifact.rows).toHaveLength(4);
    expect(result.artifact.rows.every((row) =>
      row.kind === "ledger" && row.sourceSnapshotId === source.snapshotId
    )).toBe(true);
    expect(new Set(result.artifact.rows.map((row) => row.renderedContextSha256)))
      .toHaveLength(4);
  });

  it("resumes only unscored units and rejects checkpoint tampering", async () => {
    const directory = await mkdtemp(join(tmpdir(), "phase74-unscored-"));
    try {
      const bundles = buildPhase74SealedBundles({
        cases: [testCase],
        runId: "unscored-resume",
        stage: "E2",
      });
      let retrievalCalls = 0;
      let readerCalls = 0;
      const first = await runPhase74UnscoredExecution({
        baseConfiguration: {},
        checkpoint: createPhase74UnscoredFileCheckpoint({
          directory,
          execution: bundles.execution,
        }),
        countRenderedTokens: (content) => content.length,
        executeRetrieval: async ({ arm }) => {
          retrievalCalls += 1;
          return snapshot(`resume-${arm}`);
        },
        execution: bundles.execution,
        executorPid: 201,
        genericReader: async () => {
          readerCalls += 1;
          return "Postgres";
        },
        renderEvidenceLedger: async () => "unused",
      });
      expect(retrievalCalls).toBe(2);
      expect(readerCalls).toBe(2);

      const resumed = await runPhase74UnscoredExecution({
        baseConfiguration: {},
        checkpoint: createPhase74UnscoredFileCheckpoint({
          directory,
          execution: bundles.execution,
        }),
        countRenderedTokens: (content) => content.length,
        executeRetrieval: async () => {
          throw new Error("retrieval must not rerun");
        },
        execution: bundles.execution,
        executorPid: 202,
        genericReader: async () => {
          throw new Error("reader must not rerun");
        },
        renderEvidenceLedger: async () => "unused",
      });
      expect(resumed.artifact.rows).toEqual(first.artifact.rows);

      const files = await readdir(directory);
      expect(files).toHaveLength(2);
      const raw = await readFile(join(directory, files[0]!), "utf8");
      for (const forbidden of [
        "expectedAnswer",
        "goldEvidenceIds",
        "protocolMetadata",
        '"correct"',
        '"score"',
        '"judge"',
      ]) {
        expect(raw).not.toContain(forbidden);
      }
      const tampered = JSON.parse(raw) as {
        row: { answer: string };
      };
      tampered.row.answer = "tampered";
      await writeFile(join(directory, files[0]!), JSON.stringify(tampered));
      await expect(runPhase74UnscoredExecution({
        baseConfiguration: {},
        checkpoint: createPhase74UnscoredFileCheckpoint({
          directory,
          execution: bundles.execution,
        }),
        countRenderedTokens: (content) => content.length,
        executeRetrieval: async () => snapshot("unused"),
        execution: bundles.execution,
        executorPid: 203,
        genericReader: async () => "unused",
        renderEvidenceLedger: async () => "unused",
      })).rejects.toThrow("checkpoint digest");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("executes cases concurrently while preserving canonical row order", async () => {
    const secondCase = {
      ...testCase,
      caseId: "private-upstream-id-2",
      question: "Which database was used before?",
      rawEvidence: [{
        content: "SQLite was used before Postgres.",
        id: "turn-2",
        sourceIds: ["session-b:turn-2"],
      }],
    };
    const executionConfiguration = { caseConcurrency: 2 };
    const bundles = buildPhase74SealedBundles({
      cases: [testCase, secondCase],
      executionConfiguration,
      runId: "unscored-concurrency",
      stage: "E2",
    });
    let active = 0;
    let maximumActive = 0;
    const result = await runPhase74UnscoredExecution({
      baseConfiguration: executionConfiguration,
      countRenderedTokens: (content) => content.length,
      executeRetrieval: async ({ arm, testCase: recallCase }) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return snapshot(`${recallCase.caseId}-${arm}`);
      },
      execution: bundles.execution,
      executorPid: 204,
      genericReader: async () => "Postgres",
      renderEvidenceLedger: async () => "unused",
    });

    expect(maximumActive).toBe(2);
    expect(result.artifact.rows.map(({ caseKey, unit }) => ({ caseKey, unit })))
      .toEqual(bundles.execution.cases.flatMap(({ caseKey }) => [
        { caseKey, unit: "claim-temporal-off" },
        { caseKey, unit: "claim-temporal-on" },
      ]));
  });
});
