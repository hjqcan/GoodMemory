import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import {
  loadVerifiedPhase74E3Stage,
} from "../../scripts/run-phase-74-generalization";
import {
  buildPhase74SealedBundles,
} from "../../src/eval/phase74SealedExecution";
import {
  materializePhase74SealedReport,
  materializePhase74SealedRetrievalSnapshots,
  scorePhase74UnscoredExecution,
} from "../../src/eval/phase74SealedScoring";
import {
  runPhase74UnscoredExecution,
} from "../../src/eval/phase74UnscoredExecution";
import { buildEvalRunIdentity } from "../../src/eval/runIdentity";

const testCase = {
  caseId: "official-case",
  expectedAnswer: "Postgres",
  goldEvidenceIds: ["session-a:turn-1"],
  question: "Which database is current?",
  rawEvidence: [{
    content: "Postgres is current.",
    id: "turn-1",
    sourceIds: ["session-a:turn-1"],
  }],
};

describe("Phase 74 verified E3 stage loader", () => {
  it("accepts only scored packets bound to the sealed E3 chain", async () => {
    const runDirectory = await mkdtemp(join(tmpdir(), "phase74-e3-stage-"));
    try {
      const bundles = buildPhase74SealedBundles({
        cases: [testCase],
        runId: "e3-chain",
        stage: "E3",
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
        executorPid: 701,
        genericReader: async () => "Postgres",
        prepareRetrieval: async () => {},
        renderEvidenceLedger: async () => "unused",
      });
      const scored = await scorePhase74UnscoredExecution({
        artifact: unscored.artifact,
        assess: async () => ({ correct: true, score: 1 }),
        escrow: bundles.escrow,
        execution: bundles.execution,
        executorOutput: unscored.executorOutput,
        scorerPid: 702,
      });
      const report = materializePhase74SealedReport({
        artifact: unscored.artifact,
        escrow: bundles.escrow,
        execution: bundles.execution,
        executorOutput: unscored.executorOutput,
        identity: buildEvalRunIdentity({
          answerModel: { gateway: "g", model: "m", provider: "openai" },
          benchmark: "longmemeval-full",
          configuration: {},
          datasetSha256: "d".repeat(64),
          generatedAt: "2026-07-22T00:00:00.000Z",
          generatedBy: "test",
          judgeModel: { gateway: "g", model: "j", provider: "openai" },
          promptSha256s: { reader: "e".repeat(64) },
          runId: bundles.execution.runId,
        }),
        receipt: scored.receipt,
      });
      const packets = materializePhase74SealedRetrievalSnapshots({
        artifact: unscored.artifact,
        report,
      });
      const evidenceDirectory = join(runDirectory, "sealed-evidence", "e3");
      await mkdir(evidenceDirectory, { recursive: true });
      await Promise.all([
        writeFile(
          join(runDirectory, "e3-executor-artifact.json"),
          JSON.stringify(unscored.artifact),
        ),
        writeFile(
          join(runDirectory, "e3-retrieval-packets.jsonl"),
          packets.map((packet) => `${JSON.stringify(packet)}\n`).join(""),
        ),
        writeFile(
          join(evidenceDirectory, "execution.json"),
          JSON.stringify(bundles.execution),
        ),
        writeFile(
          join(evidenceDirectory, "escrow.json"),
          JSON.stringify(bundles.escrow),
        ),
        writeFile(
          join(evidenceDirectory, "executor-output.json"),
          JSON.stringify(unscored.executorOutput),
        ),
        writeFile(
          join(evidenceDirectory, "score-receipt.json"),
          JSON.stringify(scored.receipt),
        ),
      ]);
      const e4 = buildPhase74SealedBundles({
        cases: [testCase],
        runId: "e3-chain",
        stage: "E4",
      });
      const verified = await loadVerifiedPhase74E3Stage({
        e4Execution: e4.execution,
        runDirectory,
      });
      expect(verified.deterministicSnapshots).toHaveLength(1);
      expect(verified.deterministicSnapshots[0]?.evaluation?.score).toBe(1);

      await writeFile(
        join(runDirectory, "e3-retrieval-packets.jsonl"),
        packets.map(({ evaluation: _evaluation, ...packet }) =>
          `${JSON.stringify(packet)}\n`
        ).join(""),
      );
      await expect(loadVerifiedPhase74E3Stage({
        e4Execution: e4.execution,
        runDirectory,
      })).rejects.toThrow("evaluated retrieval packets");
    } finally {
      await rm(runDirectory, { force: true, recursive: true });
    }
  });
});
