import { createHash } from "node:crypto";

const identifierPattern = /^[a-z0-9][a-z0-9._-]*$/u;
const sha256Pattern = /^[a-f0-9]{64}$/u;

export interface C6StageHistoryPrefixInput {
  historyArtifactSha256: string;
  historySourceUnitIds: string[];
  historySourceUnitRecordSha256: string[];
  stageId: string;
  targetSourceUnitId: string;
}

export interface C6StageHistoryPrefixBinding {
  historyArtifactSha256: string;
  historyMaterializationSha256: string;
  historySourceUnitCount: number;
  historySourceUnitIdsSha256: string;
  stageId: string;
  stagePosition: number;
}

export interface C6StageHistoryPrefixClosure {
  episodeId: string;
  historyPolicy: "stage-scoped-sealed-prefix-v1";
  sourceId: string;
  stageHistoryClosureSha256: string;
  stages: C6StageHistoryPrefixBinding[];
}

export function bindC6StageHistoryPrefixes(input: {
  episodeId: string;
  sourceId: string;
  stages: C6StageHistoryPrefixInput[];
}): C6StageHistoryPrefixClosure {
  assertIdentifier(input.episodeId, "episode");
  assertIdentifier(input.sourceId, "source");
  if (input.stages.length === 0) {
    throw new Error("C6 stage history requires at least one stage");
  }

  const stageIds = new Set<string>();
  const targetIds = new Set<string>();
  for (const stage of input.stages) {
    assertIdentifier(stage.stageId, "stage");
    assertIdentifier(stage.targetSourceUnitId, "target source unit");
    if (stageIds.has(stage.stageId)) {
      throw new Error(`C6 stage history duplicate stage ${stage.stageId}`);
    }
    if (targetIds.has(stage.targetSourceUnitId)) {
      throw new Error(
        `C6 stage history duplicate target ${stage.targetSourceUnitId}`,
      );
    }
    stageIds.add(stage.stageId);
    targetIds.add(stage.targetSourceUnitId);
  }

  const recordHashByUnitId = new Map<string, string>();
  let previousUnitIds: string[] = [];
  let previousRecordHashes: string[] = [];
  const stages = input.stages.map((stage, index) => {
    assertSha256(stage.historyArtifactSha256, "history artifact");
    if (
      stage.historySourceUnitIds.length !==
        stage.historySourceUnitRecordSha256.length
    ) {
      throw new Error(
        `C6 stage history unit/hash closure does not match ${stage.stageId}`,
      );
    }
    const seenUnitIds = new Set<string>();
    for (const [unitIndex, unitId] of stage.historySourceUnitIds.entries()) {
      assertIdentifier(unitId, "history source unit");
      const recordSha256 =
        stage.historySourceUnitRecordSha256[unitIndex]!;
      assertSha256(recordSha256, "history source record");
      if (seenUnitIds.has(unitId)) {
        throw new Error(
          `C6 stage history duplicate history source unit ${unitId}`,
        );
      }
      if (targetIds.has(unitId)) {
        throw new Error(
          `C6 stage history rejects target source unit in stage history ${unitId}`,
        );
      }
      const priorRecordSha256 = recordHashByUnitId.get(unitId);
      if (
        priorRecordSha256 !== undefined &&
        priorRecordSha256 !== recordSha256
      ) {
        throw new Error(
          `C6 stage history source unit hash drifted ${unitId}`,
        );
      }
      seenUnitIds.add(unitId);
      recordHashByUnitId.set(unitId, recordSha256);
    }
    if (
      previousUnitIds.some((unitId, unitIndex) =>
        stage.historySourceUnitIds[unitIndex] !== unitId ||
        stage.historySourceUnitRecordSha256[unitIndex] !==
          previousRecordHashes[unitIndex]
      )
    ) {
      throw new Error(
        `C6 stage history ${stage.stageId} must extend the previous prefix`,
      );
    }
    previousUnitIds = [...stage.historySourceUnitIds];
    previousRecordHashes = [...stage.historySourceUnitRecordSha256];

    return {
      historyArtifactSha256: stage.historyArtifactSha256,
      historyMaterializationSha256: sha256(JSON.stringify({
        historyArtifactSha256: stage.historyArtifactSha256,
        sourceId: input.sourceId,
        sourceUnitRecordSha256: stage.historySourceUnitRecordSha256,
      })),
      historySourceUnitCount: stage.historySourceUnitIds.length,
      historySourceUnitIdsSha256: sha256(JSON.stringify(
        stage.historySourceUnitIds,
      )),
      stageId: stage.stageId,
      stagePosition: index + 1,
    };
  });

  return {
    episodeId: input.episodeId,
    historyPolicy: "stage-scoped-sealed-prefix-v1",
    sourceId: input.sourceId,
    stageHistoryClosureSha256: sha256(JSON.stringify(stages)),
    stages,
  };
}

function assertIdentifier(value: string, label: string): void {
  if (!identifierPattern.test(value)) {
    throw new Error(`C6 stage history invalid ${label}`);
  }
}

function assertSha256(value: string, label: string): void {
  if (!sha256Pattern.test(value)) {
    throw new Error(`C6 stage history invalid ${label} SHA-256`);
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
