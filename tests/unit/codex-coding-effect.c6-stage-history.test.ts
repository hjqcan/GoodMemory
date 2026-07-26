import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";

import {
  bindC6StageHistoryPrefixes,
} from "../../scripts/codex-coding-effect/c6-stage-history";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);
const SHA_D = "d".repeat(64);
const SHA_E = "e".repeat(64);
const SHA_F = "f".repeat(64);

describe("Codex coding-effect C6 stage history", () => {
  it("retains deterministic lineage and materialization closure for zero-unit history", () => {
    const emptyArtifactSha256 = sha256("");
    const result = bindC6StageHistoryPrefixes({
      episodeId: "episode-empty",
      sourceId: "source-empty",
      stages: [
        stage("stage-1", emptyArtifactSha256, [], [], "target-1"),
        stage("stage-2", emptyArtifactSha256, [], [], "target-2"),
      ],
    });

    expect(result.stages).toEqual([
      {
        historyArtifactSha256: emptyArtifactSha256,
        historyMaterializationSha256: sha256(JSON.stringify({
          historyArtifactSha256: emptyArtifactSha256,
          sourceId: "source-empty",
          sourceUnitRecordSha256: [],
        })),
        historySourceUnitCount: 0,
        historySourceUnitIdsSha256: sha256(JSON.stringify([])),
        stageId: "stage-1",
        stagePosition: 1,
      },
      {
        historyArtifactSha256: emptyArtifactSha256,
        historyMaterializationSha256: sha256(JSON.stringify({
          historyArtifactSha256: emptyArtifactSha256,
          sourceId: "source-empty",
          sourceUnitRecordSha256: [],
        })),
        historySourceUnitCount: 0,
        historySourceUnitIdsSha256: sha256(JSON.stringify([])),
        stageId: "stage-2",
        stagePosition: 2,
      },
    ]);
    expect(result.stageHistoryClosureSha256).toBe(
      sha256(JSON.stringify(result.stages)),
    );
  });

  it("binds deterministic monotone sealed prefixes per stage", () => {
    const result = bindC6StageHistoryPrefixes({
      episodeId: "episode-001",
      sourceId: "source-001",
      stages: [
        stage("stage-1", SHA_A, ["history-1"], [SHA_D], "target-1"),
        stage(
          "stage-2",
          SHA_B,
          ["history-1", "history-2"],
          [SHA_D, SHA_E],
          "target-2",
        ),
        stage(
          "stage-3",
          SHA_C,
          ["history-1", "history-2", "history-3"],
          [SHA_D, SHA_E, SHA_F],
          "target-3",
        ),
      ],
    });

    expect(result.historyPolicy).toBe("stage-scoped-sealed-prefix-v1");
    expect(result.stages.map((stageBinding) => ({
      historySourceUnitCount: stageBinding.historySourceUnitCount,
      stageId: stageBinding.stageId,
    }))).toEqual([
      { historySourceUnitCount: 1, stageId: "stage-1" },
      { historySourceUnitCount: 2, stageId: "stage-2" },
      { historySourceUnitCount: 3, stageId: "stage-3" },
    ]);
    expect(result.stages[1]?.historyMaterializationSha256).toBe(
      sha256(JSON.stringify({
        historyArtifactSha256: SHA_B,
        sourceId: "source-001",
        sourceUnitRecordSha256: [SHA_D, SHA_E],
      })),
    );
    expect(result.stageHistoryClosureSha256).toBe(
      sha256(JSON.stringify(result.stages)),
    );
  });

  it("rejects reordered, removed, or duplicated prefix units", () => {
    const reordered = validInput();
    reordered.stages[1]!.historySourceUnitIds = [
      "history-2",
      "history-1",
    ];
    reordered.stages[1]!.historySourceUnitRecordSha256 = [SHA_E, SHA_D];
    expect(() => bindC6StageHistoryPrefixes(reordered)).toThrow(
      "must extend the previous prefix",
    );

    const removed = validInput();
    removed.stages[1]!.historySourceUnitIds = [];
    removed.stages[1]!.historySourceUnitRecordSha256 = [];
    expect(() => bindC6StageHistoryPrefixes(removed)).toThrow(
      "must extend the previous prefix",
    );

    const duplicated = validInput();
    duplicated.stages[1]!.historySourceUnitIds = [
      "history-1",
      "history-1",
    ];
    expect(() => bindC6StageHistoryPrefixes(duplicated)).toThrow(
      "duplicate history source unit",
    );
  });

  it("rejects any current or future target unit from every history prefix", () => {
    const input = validInput();
    input.stages[0]!.historySourceUnitIds = ["target-2"];

    expect(() => bindC6StageHistoryPrefixes(input)).toThrow(
      "target source unit in stage history",
    );
  });

  it("rejects detached record hashes and duplicate stage ids", () => {
    const detached = validInput();
    detached.stages[1]!.historySourceUnitRecordSha256 = [SHA_D];
    expect(() => bindC6StageHistoryPrefixes(detached)).toThrow(
      "history unit/hash closure",
    );

    const duplicateStage = validInput();
    duplicateStage.stages[1]!.stageId = "stage-1";
    expect(() => bindC6StageHistoryPrefixes(duplicateStage)).toThrow(
      "duplicate stage",
    );
  });
});

function validInput() {
  return {
    episodeId: "episode-001",
    sourceId: "source-001",
    stages: [
      stage("stage-1", SHA_A, ["history-1"], [SHA_D], "target-1"),
      stage(
        "stage-2",
        SHA_B,
        ["history-1", "history-2"],
        [SHA_D, SHA_E],
        "target-2",
      ),
    ],
  };
}

function stage(
  stageId: string,
  historyArtifactSha256: string,
  historySourceUnitIds: string[],
  historySourceUnitRecordSha256: string[],
  targetSourceUnitId: string,
) {
  return {
    historyArtifactSha256,
    historySourceUnitIds,
    historySourceUnitRecordSha256,
    stageId,
    targetSourceUnitId,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
