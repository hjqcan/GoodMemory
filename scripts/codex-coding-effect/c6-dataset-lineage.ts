import { createHash } from "node:crypto";
import { resolve } from "node:path";

import { z } from "zod";

import { readC6StableRegularFile } from "./c6-asset-lock";
import type { C6AssetLock } from "./c6-asset-lock";
import {
  bindC6StageHistoryPrefixes,
} from "./c6-stage-history";
import {
  assertC6TaskRelationshipEdgeCoverage,
} from "./c6-task-relationship-receipt";
import type {
  C6TaskRelationshipEvidence,
} from "./c6-task-relationship-receipt";
import type {
  CodexCodingEffectDatasetV3,
} from "./dataset";
import { loadFrozenPrehistory } from "./frozen-prehistory";

const identifierSchema = z.string()
  .min(1)
  .regex(/^[a-z0-9][a-z0-9._-]*$/u);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const revisionSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u);
const trimmedStringSchema = z.string().min(1).refine(
  (value) => value.trim() === value,
  "value cannot be whitespace-padded",
);
const relativePathSchema = trimmedStringSchema.refine(
  (value) =>
    !value.startsWith("/") &&
    !value.includes("\\") &&
    value.split("/").every((part) =>
      part.length > 0 && part !== "." && part !== ".."
    ),
  "path must be a normalized relative POSIX path without traversal",
);
const httpsUrlSchema = z.url()
  .refine(
    (value) => value.startsWith("https://"),
    "source locator must use https",
  )
  .refine((value) => {
    const url = new URL(value);
    return (
      url.username.length === 0 &&
      url.password.length === 0 &&
      url.search.length === 0 &&
      url.hash.length === 0
    );
  }, "source locator cannot use credentials, query, or fragment aliases");
const sourceTypeSchema = z.enum([
  "controlled-mutation",
  "external-benchmark",
  "real-history",
]);
const SOURCE_REQUEST_NORMALIZATION = "ecmascript-string-trim-v1" as const;

const artifactReferenceSchema = z.object({
  path: relativePathSchema,
  sha256: sha256Schema,
}).strict();

const sourceSchema = z.object({
  id: identifierSchema,
  licenseEvidence: artifactReferenceSchema.extend({
    path: relativePathSchema.refine(
      (value) =>
        value.startsWith("provenance/dataset-lineage/licenses/"),
      "source license evidence must stay under the canonical directory",
    ),
  }).strict(),
  locator: httpsUrlSchema,
  populationManifest: artifactReferenceSchema.extend({
    path: relativePathSchema.refine(
      (value) =>
        value.startsWith("provenance/dataset-lineage/populations/"),
      "source population must stay under the canonical directory",
    ),
  }).strict(),
  revision: revisionSchema,
  sourceType: sourceTypeSchema,
}).strict();

const episodeLineageStageSchema = z.object({
  historyArtifactSha256: sha256Schema,
  historyMaterializationSha256: sha256Schema,
  historySourceUnitIds: z.array(identifierSchema),
  stageId: identifierSchema,
  targetSourceUnitId: identifierSchema,
}).strict();

const episodeLineageSchema = z.object({
  agentVisibleTaskSha256: sha256Schema,
  episodeId: identifierSchema,
  sourceId: identifierSchema,
  stages: z.array(episodeLineageStageSchema).min(1),
}).strict();

const lineageSchema = z.object({
  datasetId: identifierSchema,
  episodes: z.array(episodeLineageSchema).min(1),
  schemaVersion: z.literal(2),
  sources: z.array(sourceSchema).min(1),
}).strict();

const populationSchema = z.object({
  recordsArtifact: artifactReferenceSchema.extend({
    path: relativePathSchema.refine(
      (value) =>
        value.startsWith("provenance/dataset-lineage/records/"),
      "source records must stay under the canonical directory",
    ),
  }).strict(),
  revision: revisionSchema,
  schemaVersion: z.literal(1),
  sourceId: identifierSchema,
  sourceType: sourceTypeSchema,
  units: z.array(z.object({
    id: identifierSchema,
    recordIndex: z.number().int().positive(),
    recordSha256: sha256Schema,
  }).strict()).min(1),
}).strict();

const sourceUnitRecordBaseShape = {
  id: identifierSchema,
  locator: httpsUrlSchema,
  repository: z.object({
    baseCommit: revisionSchema,
    url: httpsUrlSchema,
  }).strict(),
  schemaVersion: z.literal(1),
  sourceRequest: z.string().min(1),
  sourceRequestSha256: sha256Schema,
  sourceSnapshotRevision: revisionSchema,
  sourceType: sourceTypeSchema,
  upstreamItemRevision: revisionSchema,
};
const historyMessageSchema = z.object({
  role: z.enum(["assistant", "user"]),
  text: trimmedStringSchema,
}).strict();
const sourceUnitRecordSchema = z.discriminatedUnion("role", [
  z.object({
    ...sourceUnitRecordBaseShape,
    historyMessage: historyMessageSchema,
    role: z.literal("prehistory"),
  }).strict(),
  z.object({
    ...sourceUnitRecordBaseShape,
    agentVisiblePromptSha256: sha256Schema,
    promptDerivation: z.literal("verbatim-source-request-v1"),
    role: z.literal("target"),
    stageSnapshot: revisionSchema,
  }).strict(),
]).superRefine((record, context) => {
  if (sha256(record.sourceRequest) !== record.sourceRequestSha256) {
    context.addIssue({
      code: "custom",
      message: "source request hash does not match",
      path: ["sourceRequestSha256"],
    });
  }
});

const licenseEvidenceSchema = z.object({
  decision: z.literal("accepted"),
  license: trimmedStringSchema,
  reviewedAt: z.iso.datetime(),
  reviewer: trimmedStringSchema,
  schemaVersion: z.literal(1),
  sourceId: identifierSchema,
  sourceRevision: revisionSchema,
}).strict();

export interface C6DatasetLineageStageHistoryEvidence {
  artifactSha256: string;
  materializationSha256: string;
  sourceUnitCount: number;
  sourceUnitIdsSha256: string;
}

export interface C6DatasetLineageStageTargetEvidence {
  locator: string;
  normalizedSourceRequestSha256: string;
  recordSha256: string;
  sourceRequestSha256: string;
  sourceRequestNormalization: typeof SOURCE_REQUEST_NORMALIZATION;
  sourceUnitId: string;
  upstreamItemRevision: string;
}

export interface C6DatasetLineageStageEvidence {
  history: C6DatasetLineageStageHistoryEvidence;
  stageId: string;
  stageLineageSha256: string;
  target: C6DatasetLineageStageTargetEvidence;
}

export interface C6DatasetLineageEpisodeEvidence {
  agentVisibleTaskSha256: string;
  episodeStageClosureSha256: string;
  relationshipClosureSha256: string;
  relationships: C6DatasetLineageRelationshipEvidence[];
  sourceId: string;
  stageHistoryClosureSha256: string;
  stages: C6DatasetLineageStageEvidence[];
}

export interface C6DatasetLineageRelationshipEvidence
  extends C6TaskRelationshipEvidence {
  relationshipReceiptBytes: number;
  relationshipReceiptPath: string;
}

export interface C6DatasetLineageEvidence {
  episodeById: Record<string, C6DatasetLineageEpisodeEvidence>;
  licenseEvidenceSha256BySourceId: Record<string, string>;
  lineageSha256: string;
  sourcePopulationSha256BySourceId: Record<string, string>;
  sourceSnapshotCount: number;
  targetSourceUnitCount: number;
  uniqueTargetRecordFingerprints: number;
}

interface LoadedSourcePopulation {
  recordsByUnitId: Map<string, LoadedSourceUnitRecord>;
}

interface LoadedSourceUnitRecord {
  record: SourceUnitRecord;
  recordSha256: string;
}

type SourceUnitRecord = z.infer<typeof sourceUnitRecordSchema>;
type TargetSourceUnitRecord = Extract<
  SourceUnitRecord,
  { role: "target" }
>;

interface ResolvedStage {
  historyRecordSha256: string[];
  historySourceUnitIds: string[];
  lineage: z.infer<typeof episodeLineageStageSchema>;
  stage: CodexCodingEffectDatasetV3["episodes"][number]["stages"][number];
  target: {
    record: TargetSourceUnitRecord;
    recordSha256: string;
  };
}

export async function loadC6DatasetLineage(input: {
  assetLock: C6AssetLock;
  dataset: CodexCodingEffectDatasetV3;
  datasetRoot: string;
  taskContentSha256ByEpisodeId: Readonly<Record<string, string>>;
  taskOriginEvidenceByEpisodeId: Readonly<Record<string, {
    relationshipEdges: C6DatasetLineageRelationshipEvidence[];
    stageOrigins: Array<{
      originalRequestSha256: string;
      sourceLocator: string;
      stageId: string;
      upstreamItemRevision: string;
    }>;
  }>>;
}): Promise<C6DatasetLineageEvidence> {
  const reference = input.dataset.sourceLineage;
  if (reference === undefined) {
    throw new Error("C6 candidate dataset requires source lineage");
  }
  const filesByPath = new Map(
    input.assetLock.files.map((file) => [file.path, file]),
  );
  assertAssetHash(filesByPath, reference, "manifest");
  const lineageBytes = await readC6StableRegularFile(
    resolve(input.datasetRoot, reference.path),
    "dataset lineage manifest",
  );
  if (sha256(lineageBytes) !== reference.sha256) {
    throw new Error(
      "C6 dataset lineage manifest does not match the asset lock",
    );
  }
  const lineage = lineageSchema.parse(
    JSON.parse(lineageBytes.toString("utf8")) as unknown,
  );
  if (lineage.datasetId !== input.dataset.datasetId) {
    throw new Error("C6 dataset lineage does not match the dataset");
  }

  const sourcesById = uniqueMap(
    lineage.sources,
    (source) => source.id,
    "C6 dataset lineage contains duplicate source",
  );
  const populationsBySourceId = new Map<string, LoadedSourcePopulation>();
  const sourcePopulationSha256BySourceId: Record<string, string> = {};
  const licenseEvidenceSha256BySourceId: Record<string, string> = {};
  for (const source of lineage.sources) {
    const loaded = await loadSourcePopulation({
      datasetRoot: input.datasetRoot,
      filesByPath,
      source,
    });
    populationsBySourceId.set(source.id, loaded);
    sourcePopulationSha256BySourceId[source.id] =
      source.populationManifest.sha256;
    licenseEvidenceSha256BySourceId[source.id] =
      source.licenseEvidence.sha256;
  }

  const lineageEpisodesById = uniqueMap(
    lineage.episodes,
    (episode) => episode.episodeId,
    "C6 dataset lineage contains duplicate episode",
  );
  if (lineageEpisodesById.size !== input.dataset.episodes.length) {
    throw new Error("C6 dataset lineage must cover every candidate episode");
  }

  const episodeById: Record<string, C6DatasetLineageEpisodeEvidence> = {};
  const targetKeys = new Set<string>();
  const targetRecordHashes = new Set<string>();
  const targetLocators = new Set<string>();
  const historyKeys = new Set<string>();
  const historyRecordHashes = new Set<string>();
  const historyLocators = new Set<string>();
  for (const episode of input.dataset.episodes) {
    const episodeLineage = lineageEpisodesById.get(episode.id);
    if (episodeLineage === undefined) {
      throw new Error(
        `C6 dataset lineage is missing episode ${episode.id}`,
      );
    }
    const source = sourcesById.get(episodeLineage.sourceId);
    const population = populationsBySourceId.get(episodeLineage.sourceId);
    if (
      source === undefined ||
      population === undefined ||
      source.sourceType !== episode.sourceType
    ) {
      throw new Error(
        `C6 dataset lineage source does not match episode ${episode.id}`,
      );
    }
    if (
      episodeLineage.agentVisibleTaskSha256 !==
        input.taskContentSha256ByEpisodeId[episode.id]
    ) {
      throw new Error(
        `C6 dataset lineage agent-visible task does not match ${episode.id}`,
      );
    }
    if (episodeLineage.stages.length !== episode.stages.length) {
      throw new Error(
        `C6 dataset lineage stages do not match episode ${episode.id}`,
      );
    }
    const taskOriginEvidence =
      input.taskOriginEvidenceByEpisodeId[episode.id];
    const origins = taskOriginEvidence?.stageOrigins;
    if (
      episode.sourceType !== "controlled-mutation" &&
      origins?.length !== episode.stages.length
    ) {
      throw new Error(
        `C6 dataset lineage ${episode.sourceType} origins do not cover every stage ${episode.id}`,
      );
    }
    const relationships = (
      taskOriginEvidence?.relationshipEdges ?? []
    ).map((relationship) => ({
      commitPathSha256: relationship.commitPathSha256,
      edgeId: relationship.edgeId,
      episodeId: relationship.episodeId,
      laterBaseCommit: relationship.laterBaseCommit,
      laterRequestAt: relationship.laterRequestAt,
      laterStageId: relationship.laterStageId,
      priorCompletionAt: relationship.priorCompletionAt,
      priorMergeCommit: relationship.priorMergeCommit,
      priorStageId: relationship.priorStageId,
      relationshipReceiptBytes:
        relationship.relationshipReceiptBytes,
      relationshipReceiptPath:
        relationship.relationshipReceiptPath,
      relationshipReceiptSha256:
        relationship.relationshipReceiptSha256,
    }));
    if (episode.sourceType !== "controlled-mutation") {
      assertC6TaskRelationshipEdgeCoverage({
        edges: relationships,
        episodeId: episode.id,
        stageIds: episode.stages.map((stage) => stage.id),
      });
      if (
        relationships.some((relationship, index) =>
          relationship.episodeId !== episode.id ||
          relationship.laterBaseCommit !==
            episode.stages[index + 1]?.snapshot ||
          !relationship.relationshipReceiptPath.startsWith(
            `provenance/task-origin/relationships/${episode.id}/`,
          ) ||
          !Number.isSafeInteger(relationship.relationshipReceiptBytes) ||
          relationship.relationshipReceiptBytes <= 0 ||
          !/^[a-f0-9]{64}$/u.test(
            relationship.relationshipReceiptSha256,
          ) ||
          !/^[a-f0-9]{64}$/u.test(relationship.commitPathSha256)
        ) ||
        new Set(relationships.map((relationship) =>
          relationship.relationshipReceiptPath
        )).size !== relationships.length
      ) {
        throw new Error(
          `C6 dataset lineage relationship evidence does not bind every adjacent stage ${episode.id}`,
        );
      }
    } else if (relationships.length > 0) {
      throw new Error(
        `C6 dataset lineage controlled mutation cannot claim upstream relationship evidence ${episode.id}`,
      );
    }
    const noHistoryControl = episode.strata.includes(
      "no-history-negative-control",
    );
    const historyArtifacts = await Promise.all(
      episode.stages.map(async (stage) => {
        assertAssetHash(filesByPath, stage.history, "stage history");
        return loadFrozenPrehistory({
          allowEmpty: noHistoryControl,
          expectedSha256: stage.history.sha256,
          path: resolve(input.datasetRoot, stage.history.path),
        });
      }),
    );
    for (let index = 1; index < historyArtifacts.length; index += 1) {
      if (
        !historyArtifacts[index]!.sourceBytes.startsWith(
          historyArtifacts[index - 1]!.sourceBytes,
        )
      ) {
        throw new Error(
          `C6 dataset lineage frozen history must extend the previous record prefix ${episode.id}:${episode.stages[index]!.id}`,
        );
      }
    }

    const resolvedStages = episodeLineage.stages.map(
      (stageLineage, index): ResolvedStage => {
        const stage = episode.stages[index]!;
        if (stageLineage.stageId !== stage.id) {
          throw new Error(
            `C6 dataset lineage stage order does not match episode ${episode.id}`,
          );
        }
        if (stageLineage.historyArtifactSha256 !== stage.history.sha256) {
          throw new Error(
            `C6 dataset lineage history artifact does not match ${episode.id}:${stage.id}`,
          );
        }
        const historyArtifact = historyArtifacts[index]!;
        if (
          noHistoryControl &&
          (
            historyArtifact.sourceBytes.length !== 0 ||
            historyArtifact.records.length !== 0 ||
            stageLineage.historySourceUnitIds.length !== 0
          )
        ) {
          throw new Error(
            `C6 dataset lineage no-history-negative-control requires canonical empty history and zero source units ${episode.id}:${stage.id}`,
          );
        }
        if (
          !noHistoryControl &&
          (
            historyArtifact.sourceBytes.length === 0 ||
            historyArtifact.records.length === 0 ||
            stageLineage.historySourceUnitIds.length === 0
          )
        ) {
          throw new Error(
            `C6 dataset lineage non-control stage requires nonempty history and source units ${episode.id}:${stage.id}`,
          );
        }
        if (
          stageLineage.historySourceUnitIds.length !==
            historyArtifact.records.length
        ) {
          throw new Error(
            `C6 dataset lineage history source units do not cover artifact records ${episode.id}:${stage.id}`,
          );
        }
        const loadedTarget = population.recordsByUnitId.get(
          stageLineage.targetSourceUnitId,
        );
        if (loadedTarget === undefined) {
          throw new Error(
            `C6 dataset lineage target unit is unknown for ${episode.id}:${stage.id}`,
          );
        }
        const targetRecord = loadedTarget.record;
        if (targetRecord.role !== "target") {
          throw new Error(
            `C6 dataset lineage target record role does not match ${episode.id}:${stage.id}`,
          );
        }
        const target = {
          record: targetRecord,
          recordSha256: loadedTarget.recordSha256,
        };
        validateTargetRecord({
          episode,
          filesByPath,
          loadedTarget: target,
          origin: origins?.[index],
          stage,
        });
        registerUniqueTarget({
          loadedTarget: target,
          sourceId: source.id,
          targetKeys,
          targetLocators,
          targetRecordHashes,
        });

        const historyRecordSha256 = stageLineage.historySourceUnitIds.map(
          (sourceUnitId, historyIndex) => {
            const loadedHistory = population.recordsByUnitId.get(sourceUnitId);
            if (loadedHistory === undefined) {
              throw new Error(
                `C6 dataset lineage history unit is unknown for ${episode.id}:${stage.id}`,
              );
            }
            if (loadedHistory.record.role !== "prehistory") {
              throw new Error(
                "C6 dataset lineage rejects target source unit in stage history",
              );
            }
            assertRecordRepository(loadedHistory.record, episode);
            const artifactRecord = historyArtifact.records[historyIndex];
            if (
              artifactRecord === undefined ||
              artifactRecord.role !==
                loadedHistory.record.historyMessage.role ||
              artifactRecord.message !==
                loadedHistory.record.historyMessage.text
            ) {
              throw new Error(
                `C6 dataset lineage history message does not match source unit ${episode.id}:${stage.id}:${sourceUnitId}`,
              );
            }
            historyKeys.add(sourceUnitKey(source.id, sourceUnitId));
            historyRecordHashes.add(loadedHistory.recordSha256);
            historyLocators.add(loadedHistory.record.locator);
            return loadedHistory.recordSha256;
          },
        );
        return {
          historyRecordSha256,
          historySourceUnitIds: stageLineage.historySourceUnitIds,
          lineage: stageLineage,
          stage,
          target,
        };
      },
    );
    const historyClosure = bindC6StageHistoryPrefixes({
      episodeId: episode.id,
      sourceId: source.id,
      stages: resolvedStages.map((resolved) => ({
        historyArtifactSha256: resolved.lineage.historyArtifactSha256,
        historySourceUnitIds: resolved.historySourceUnitIds,
        historySourceUnitRecordSha256: resolved.historyRecordSha256,
        stageId: resolved.stage.id,
        targetSourceUnitId: resolved.target.record.id,
      })),
    });
    const stages = resolvedStages.map((resolved, index) => {
      const history = historyClosure.stages[index]!;
      if (
        history.stageId !== resolved.stage.id ||
        history.historyArtifactSha256 !==
          resolved.lineage.historyArtifactSha256 ||
        history.historyMaterializationSha256 !==
          resolved.lineage.historyMaterializationSha256
      ) {
        throw new Error(
          `C6 dataset lineage history materialization does not match ${episode.id}:${resolved.stage.id}`,
        );
      }
      return createStageEvidence(resolved, history);
    });
    const agentVisibleTaskSha256 =
      episodeLineage.agentVisibleTaskSha256;
    const relationshipClosureSha256 = sha256(JSON.stringify({
      episodeId: episode.id,
      relationships,
    }));
    episodeById[episode.id] = {
      agentVisibleTaskSha256,
      episodeStageClosureSha256: sha256(JSON.stringify({
        agentVisibleTaskSha256,
        episodeId: episode.id,
        relationshipClosureSha256,
        relationships,
        sourceId: source.id,
        stages,
      })),
      relationshipClosureSha256,
      relationships,
      sourceId: source.id,
      stageHistoryClosureSha256:
        historyClosure.stageHistoryClosureSha256,
      stages,
    };
  }

  assertTargetHistoryIsolation(
    targetKeys,
    historyKeys,
    "source unit",
  );
  assertTargetHistoryIsolation(
    targetRecordHashes,
    historyRecordHashes,
    "source record",
  );
  assertTargetHistoryIsolation(
    targetLocators,
    historyLocators,
    "source locator",
  );

  return {
    episodeById,
    licenseEvidenceSha256BySourceId,
    lineageSha256: reference.sha256,
    sourcePopulationSha256BySourceId,
    sourceSnapshotCount: lineage.sources.length,
    targetSourceUnitCount: targetKeys.size,
    uniqueTargetRecordFingerprints: targetRecordHashes.size,
  };
}

async function loadSourcePopulation(input: {
  datasetRoot: string;
  filesByPath: ReadonlyMap<string, { sha256: string }>;
  source: z.infer<typeof sourceSchema>;
}): Promise<LoadedSourcePopulation> {
  const { filesByPath, source } = input;
  assertAssetHash(
    filesByPath,
    source.populationManifest,
    "source population",
  );
  assertAssetHash(
    filesByPath,
    source.licenseEvidence,
    "source license evidence",
  );
  const [populationBytes, licenseBytes] = await Promise.all([
    readC6StableRegularFile(
      resolve(input.datasetRoot, source.populationManifest.path),
      "dataset lineage source population",
    ),
    readC6StableRegularFile(
      resolve(input.datasetRoot, source.licenseEvidence.path),
      "dataset lineage source license evidence",
    ),
  ]);
  if (sha256(populationBytes) !== source.populationManifest.sha256) {
    throw new Error(
      "C6 dataset lineage source population does not match the asset lock",
    );
  }
  if (sha256(licenseBytes) !== source.licenseEvidence.sha256) {
    throw new Error(
      "C6 dataset lineage source license evidence does not match the asset lock",
    );
  }
  const population = populationSchema.parse(
    JSON.parse(populationBytes.toString("utf8")) as unknown,
  );
  if (
    population.sourceId !== source.id ||
    population.sourceType !== source.sourceType ||
    population.revision !== source.revision
  ) {
    throw new Error(
      `C6 dataset lineage source population does not match ${source.id}`,
    );
  }
  const unitsById = uniqueMap(
    population.units,
    (unit) => unit.id,
    `C6 dataset lineage source population ${source.id} contains duplicate unit`,
  );
  uniqueMap(
    population.units,
    (unit) => String(unit.recordIndex),
    `C6 dataset lineage source population ${source.id} contains duplicate record index`,
  );
  assertAssetHash(filesByPath, population.recordsArtifact, "source records");
  const recordsBytes = await readC6StableRegularFile(
    resolve(input.datasetRoot, population.recordsArtifact.path),
    "dataset lineage source records",
  );
  if (sha256(recordsBytes) !== population.recordsArtifact.sha256) {
    throw new Error(
      "C6 dataset lineage source records do not match the asset lock",
    );
  }
  const records = parseSourceUnitRecords(recordsBytes, source.id);
  if (records.length !== population.units.length) {
    throw new Error(
      `C6 dataset lineage source records do not cover ${source.id}`,
    );
  }
  const recordsByUnitId = new Map<string, LoadedSourceUnitRecord>();
  for (const unit of population.units) {
    const loadedRecord = records[unit.recordIndex - 1];
    if (
      loadedRecord === undefined ||
      loadedRecord.record.id !== unit.id ||
      loadedRecord.recordSha256 !== unit.recordSha256 ||
      loadedRecord.record.sourceSnapshotRevision !== source.revision ||
      loadedRecord.record.sourceType !== source.sourceType
    ) {
      throw new Error(
        `C6 dataset lineage source record does not match unit ${source.id}:${unit.id}`,
      );
    }
    recordsByUnitId.set(unit.id, loadedRecord);
  }
  if (recordsByUnitId.size !== unitsById.size) {
    throw new Error(
      `C6 dataset lineage source records contain duplicate unit ${source.id}`,
    );
  }
  uniqueMap(
    [...recordsByUnitId.values()],
    (loaded) => loaded.record.locator,
    `C6 dataset lineage source records ${source.id} contain duplicate locator`,
  );
  const licenseEvidence = licenseEvidenceSchema.parse(
    JSON.parse(licenseBytes.toString("utf8")) as unknown,
  );
  if (
    licenseEvidence.sourceId !== source.id ||
    licenseEvidence.sourceRevision !== source.revision
  ) {
    throw new Error(
      `C6 dataset lineage source license evidence does not match ${source.id}`,
    );
  }
  return { recordsByUnitId };
}

function validateTargetRecord(input: {
  episode: CodexCodingEffectDatasetV3["episodes"][number];
  filesByPath: ReadonlyMap<string, { sha256: string }>;
  loadedTarget: {
    record: TargetSourceUnitRecord;
    recordSha256: string;
  };
  origin?: {
    originalRequestSha256: string;
    sourceLocator: string;
    stageId: string;
    upstreamItemRevision: string;
  };
  stage: CodexCodingEffectDatasetV3["episodes"][number]["stages"][number];
}): void {
  const { episode, filesByPath, loadedTarget, origin, stage } = input;
  const { record } = loadedTarget;
  assertRecordRepository(record, episode);
  if (
    record.agentVisiblePromptSha256 !==
      filesByPath.get(stage.promptPath)?.sha256
  ) {
    throw new Error(
      `C6 dataset lineage target prompt does not match ${episode.id}:${stage.id}`,
    );
  }
  if (record.sourceRequestSha256 !== record.agentVisiblePromptSha256) {
    throw new Error(
      `C6 dataset lineage target source request does not match ${episode.id}:${stage.id}`,
    );
  }
  if (record.stageSnapshot !== stage.snapshot) {
    throw new Error(
      `C6 dataset lineage target snapshot does not match ${episode.id}:${stage.id}`,
    );
  }
  if (episode.sourceType === "controlled-mutation") {
    return;
  }
  if (
    origin === undefined ||
    origin.stageId !== stage.id ||
    record.locator !== origin.sourceLocator
  ) {
    throw new Error(
      `C6 dataset lineage ${episode.sourceType} stage origin does not match ${episode.id}:${stage.id}`,
    );
  }
  if (sha256(record.sourceRequest.trim()) !== origin.originalRequestSha256) {
    throw new Error(
      `C6 dataset lineage ${episode.sourceType} request does not match ${episode.id}:${stage.id}`,
    );
  }
  if (record.upstreamItemRevision !== origin.upstreamItemRevision) {
    throw new Error(
      `C6 dataset lineage ${episode.sourceType} item revision does not match ${episode.id}:${stage.id}`,
    );
  }
}

function registerUniqueTarget(input: {
  loadedTarget: {
    record: TargetSourceUnitRecord;
    recordSha256: string;
  };
  sourceId: string;
  targetKeys: Set<string>;
  targetLocators: Set<string>;
  targetRecordHashes: Set<string>;
}): void {
  const key = sourceUnitKey(input.sourceId, input.loadedTarget.record.id);
  if (input.targetKeys.has(key)) {
    throw new Error(
      "C6 dataset lineage rejects reused target source unit",
    );
  }
  if (input.targetRecordHashes.has(input.loadedTarget.recordSha256)) {
    throw new Error(
      "C6 dataset lineage rejects reused target source record",
    );
  }
  if (input.targetLocators.has(input.loadedTarget.record.locator)) {
    throw new Error(
      "C6 dataset lineage rejects reused target source locator",
    );
  }
  input.targetKeys.add(key);
  input.targetRecordHashes.add(input.loadedTarget.recordSha256);
  input.targetLocators.add(input.loadedTarget.record.locator);
}

function createStageEvidence(
  resolved: ResolvedStage,
  history: ReturnType<
    typeof bindC6StageHistoryPrefixes
  >["stages"][number],
): C6DatasetLineageStageEvidence {
  const target = {
    locator: resolved.target.record.locator,
    normalizedSourceRequestSha256: sha256(
      resolved.target.record.sourceRequest.trim(),
    ),
    recordSha256: resolved.target.recordSha256,
    sourceRequestSha256: resolved.target.record.sourceRequestSha256,
    sourceRequestNormalization: SOURCE_REQUEST_NORMALIZATION,
    sourceUnitId: resolved.target.record.id,
    upstreamItemRevision: resolved.target.record.upstreamItemRevision,
  };
  const historyEvidence = {
    artifactSha256: history.historyArtifactSha256,
    materializationSha256: history.historyMaterializationSha256,
    sourceUnitCount: history.historySourceUnitCount,
    sourceUnitIdsSha256: history.historySourceUnitIdsSha256,
  };
  const stageId = resolved.stage.id;
  return {
    history: historyEvidence,
    stageId,
    stageLineageSha256: sha256(JSON.stringify({
      history: historyEvidence,
      stageId,
      target,
    })),
    target,
  };
}

function assertTargetHistoryIsolation(
  targets: ReadonlySet<string>,
  history: ReadonlySet<string>,
  label: string,
): void {
  for (const value of targets) {
    if (history.has(value)) {
      throw new Error(
        `C6 dataset lineage rejects target ${label} in stage history`,
      );
    }
  }
}

function parseSourceUnitRecords(
  bytes: Buffer,
  sourceId: string,
): LoadedSourceUnitRecord[] {
  const text = bytes.toString("utf8");
  if (!text.endsWith("\n")) {
    throw new Error(
      `C6 dataset lineage source records must end with newline ${sourceId}`,
    );
  }
  const lines = text.slice(0, -1).split("\n");
  if (lines.some((line) => line.length === 0)) {
    throw new Error(
      `C6 dataset lineage source records contain an empty row ${sourceId}`,
    );
  }
  return lines.map((line) => {
    const record = sourceUnitRecordSchema.parse(
      JSON.parse(line) as unknown,
    );
    if (JSON.stringify(record) !== line) {
      throw new Error(
        `C6 dataset lineage source record is not canonical ${sourceId}:${record.id}`,
      );
    }
    return {
      record,
      recordSha256: sha256(`${line}\n`),
    };
  });
}

function assertRecordRepository(
  record: z.infer<typeof sourceUnitRecordSchema>,
  episode: CodexCodingEffectDatasetV3["episodes"][number],
): void {
  if (
    record.repository.url !== episode.repository.url ||
    record.repository.baseCommit !== episode.repository.baseCommit
  ) {
    throw new Error(
      `C6 dataset lineage source record repository does not match ${episode.id}`,
    );
  }
}

function assertAssetHash(
  filesByPath: ReadonlyMap<string, { sha256: string }>,
  reference: { path: string; sha256: string },
  label: string,
): void {
  if (filesByPath.get(reference.path)?.sha256 !== reference.sha256) {
    throw new Error(
      `C6 dataset lineage ${label} does not match the asset lock`,
    );
  }
}

function uniqueMap<T>(
  values: readonly T[],
  keyOf: (value: T) => string,
  error: string,
): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    const key = keyOf(value);
    if (result.has(key)) {
      throw new Error(`${error} ${key}`);
    }
    result.set(key, value);
  }
  return result;
}

function sourceUnitKey(sourceId: string, sourceUnitId: string): string {
  return `${sourceId}:${sourceUnitId}`;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
