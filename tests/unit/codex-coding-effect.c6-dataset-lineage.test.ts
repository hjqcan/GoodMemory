import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { C6AssetLock } from "../../scripts/codex-coding-effect/c6-asset-lock";
import {
  loadC6DatasetLineage,
} from "../../scripts/codex-coding-effect/c6-dataset-lineage";
import type {
  CodexCodingEffectDatasetV3,
} from "../../scripts/codex-coding-effect/dataset";

const BASE_COMMIT = "1".repeat(40);
const SOURCE_REVISION = "2".repeat(40);
const STAGE_ONE_REVISION = "3".repeat(40);
const STAGE_TWO_REVISION = "4".repeat(40);
const SHA_A = "a".repeat(64);
const REPOSITORY_URL = "https://example.com/repository.git";

describe("Codex coding-effect C6 stage-scoped dataset lineage", () => {
  it("binds ordered stage history and target evidence with closure hashes", async () => {
    const fixture = await createFixture();
    try {
      const evidence = await loadC6DatasetLineage(fixture.input);
      const episode = evidence.episodeById["episode-one"]!;

      expect(episode.stages.map((stage) => ({
        historyCount: stage.history.sourceUnitCount,
        stageId: stage.stageId,
        targetId: stage.target.sourceUnitId,
      }))).toEqual([
        {
          historyCount: 1,
          stageId: "stage-one",
          targetId: "target-one",
        },
        {
          historyCount: 2,
          stageId: "stage-two",
          targetId: "target-two",
        },
      ]);
      expect(episode.stages.every(
        (stage) => /^[a-f0-9]{64}$/u.test(stage.stageLineageSha256),
      )).toBe(true);
      expect(episode.stages[0]!.stageLineageSha256).toBe(
        sha256(JSON.stringify({
          history: episode.stages[0]!.history,
          stageId: episode.stages[0]!.stageId,
          target: episode.stages[0]!.target,
        })),
      );
      expect(episode.stageHistoryClosureSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(episode.episodeStageClosureSha256).toBe(
        sha256(JSON.stringify({
          agentVisibleTaskSha256: episode.agentVisibleTaskSha256,
          episodeId: "episode-one",
          relationshipClosureSha256:
            episode.relationshipClosureSha256,
          relationships: episode.relationships,
          sourceId: episode.sourceId,
          stages: episode.stages,
        })),
      );
      expect(episode.relationshipClosureSha256).toBe(
        sha256(JSON.stringify({
          episodeId: "episode-one",
          relationships: episode.relationships,
        })),
      );
      expect(evidence.targetSourceUnitCount).toBe(2);
      expect(evidence.uniqueTargetRecordFingerprints).toBe(2);
    } finally {
      await fixture.cleanup();
    }
  });

  it("binds canonical empty artifacts and zero source units for no-history controls", async () => {
    const fixture = await createFixture({ noHistory: true });
    try {
      const evidence = await loadC6DatasetLineage(fixture.input);
      const stages = evidence.episodeById["episode-one"]!.stages;

      expect(stages.map((stage) => ({
        artifactSha256: stage.history.artifactSha256,
        sourceUnitCount: stage.history.sourceUnitCount,
        sourceUnitIdsSha256: stage.history.sourceUnitIdsSha256,
      }))).toEqual([
        {
          artifactSha256: sha256(""),
          sourceUnitCount: 0,
          sourceUnitIdsSha256: sha256(JSON.stringify([])),
        },
        {
          artifactSha256: sha256(""),
          sourceUnitCount: 0,
          sourceUnitIdsSha256: sha256(JSON.stringify([])),
        },
      ]);
      expect(evidence.targetSourceUnitCount).toBe(2);
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects nonempty artifacts or source units for no-history controls", async () => {
    await expectRejected(
      {
        noHistory: true,
        mutateLineage: (lineage, context) => {
          lineage.episodes[0]!.stages[0]!.historySourceUnitIds = [
            "history-one",
          ];
          refreshMaterialization(lineage, context, 0);
        },
      },
      "no-history-negative-control requires canonical empty history and zero source units",
    );
    await expectRejected(
      {
        noHistory: true,
        mutateHistoryBytes: (history) => {
          history.set("stage-one", `${historyLine("user", "Prior one")}\n`);
          history.set("stage-two", [
            historyLine("user", "Prior one"),
            historyLine("assistant", "Prior two"),
            "",
          ].join("\n"));
        },
        mutateLineage: (lineage, context) => {
          const historyIds = [
            ["history-one"],
            ["history-one", "history-two"],
          ];
          for (const [index, stage] of
            lineage.episodes[0]!.stages.entries()) {
            stage.historySourceUnitIds = historyIds[index]!;
            refreshMaterialization(lineage, context, index);
          }
        },
      },
      "no-history-negative-control requires canonical empty history and zero source units",
    );
  });

  it("rejects empty artifacts and zero source units outside no-history controls", async () => {
    await expectRejected(
      {
        mutateHistoryBytes: (history) => {
          history.set("stage-one", "");
          history.set("stage-two", "");
        },
        mutateLineage: (lineage, context) => {
          for (const [index, stage] of
            lineage.episodes[0]!.stages.entries()) {
            stage.historySourceUnitIds = [];
            refreshMaterialization(lineage, context, index);
          }
        },
      },
      "frozen prehistory must contain at least one record",
    );
  });

  it("rejects target identity, record-hash, and locator aliases in history", async () => {
    await expectRejected(
      {
        mutateLineage: (lineage, context) => {
          lineage.episodes[0]!.stages[0]!.historySourceUnitIds = [
            "target-two",
          ];
          refreshMaterialization(lineage, context, 0);
        },
      },
      "target source unit in stage history",
    );
    await expectRejected(
      {
        mutatePopulation: (population, context) => {
          population.units[0]!.recordSha256 =
            context.recordSha256ById.get("target-one")!;
        },
      },
      "source record does not match unit",
    );
    await expectRejected(
      {
        mutateRecords: (records) => {
          records[0]!.locator = records[1]!.locator;
        },
      },
      "duplicate locator",
    );
  });

  it("rejects history prefix reorder and removal", async () => {
    await expectRejected(
      {
        mutateLineage: (lineage, context) => {
          lineage.episodes[0]!.stages[1]!.historySourceUnitIds = [
            "history-two",
            "history-one",
          ];
          refreshMaterialization(lineage, context, 1);
        },
      },
      "history message does not match source unit",
    );
    await expectRejected(
      {
        mutateLineage: (lineage, context) => {
          lineage.episodes[0]!.stages[1]!.historySourceUnitIds = [
            "history-two",
            "history-three",
          ];
          refreshMaterialization(lineage, context, 1);
        },
      },
      "history message does not match source unit",
    );
  });

  it("rejects drift in the actual frozen-history record prefix", async () => {
    await expectRejected(
      {
        mutateHistoryBytes: (history) => {
          history.set("stage-two", [
            historyLine("user", "Substituted prior one"),
            historyLine("assistant", "Prior two"),
            "",
          ].join("\n"));
        },
      },
      "frozen history must extend the previous record prefix",
    );
  });

  it("rejects a self-consistent history artifact detached from its source units", async () => {
    await expectRejected(
      {
        mutateHistoryBytes: (history) => {
          history.set(
            "stage-one",
            `${historyLine("user", "Unbound prior one")}\n`,
          );
          history.set("stage-two", [
            historyLine("user", "Unbound prior one"),
            historyLine("assistant", "Prior two"),
            "",
          ].join("\n"));
        },
      },
      "history message does not match source unit",
    );
  });

  it("rejects detached stage history artifacts and materializations", async () => {
    await expectRejected(
      {
        mutateLineage: (lineage) => {
          lineage.episodes[0]!.stages[0]!.historyArtifactSha256 = SHA_A;
        },
      },
      "history artifact does not match",
    );
    await expectRejected(
      {
        mutateLineage: (lineage) => {
          lineage.episodes[0]!.stages[0]!
            .historyMaterializationSha256 = SHA_A;
        },
      },
      "history materialization does not match",
    );
  });

  it("rejects incomplete lineage coverage and unknown source units", async () => {
    await expectRejected(
      {
        mutateLineage: (lineage) => {
          lineage.episodes[0]!.episodeId = "unknown-episode";
        },
      },
      "missing episode episode-one",
    );
    await expectRejected(
      {
        mutateLineage: (lineage) => {
          lineage.episodes[0]!.stages[0]!.targetSourceUnitId =
            "unknown-target";
        },
      },
      "target unit is unknown",
    );
    await expectRejected(
      {
        mutateLineage: (lineage, context) => {
          lineage.episodes[0]!.stages[0]!.historySourceUnitIds = [
            "unknown-history",
          ];
          lineage.episodes[0]!.stages[0]!
            .historyMaterializationSha256 = context.sha256("unknown");
        },
      },
      "history unit is unknown",
    );
  });

  it("rejects the superseded lineage schema v1", async () => {
    await expectRejected(
      {
        mutateLineage: (lineage) => {
          const versioned: { schemaVersion: number } = lineage;
          versioned.schemaVersion = 1;
        },
      },
      "expected 2",
    );
  });

  it("retains task, origin, repository, prompt, and snapshot bindings", async () => {
    await expectRejected(
      {
        mutateTaskContent: (taskContent) => {
          taskContent["episode-one"] = SHA_A;
        },
      },
      "agent-visible task does not match",
    );
    await expectRejected(
      {
        mutateOrigins: (origins) => {
          origins["episode-one"]!.stageOrigins[0]!.sourceLocator =
            "https://example.com/different-origin";
        },
      },
      "stage origin does not match",
    );
    await expectRejected(
      {
        mutateRecords: (records) => {
          records[1]!.repository.baseCommit = "5".repeat(40);
        },
      },
      "source record repository does not match",
    );
    await expectRejected(
      {
        mutateRecords: (records) => {
          records[1]!.agentVisiblePromptSha256 = SHA_A;
        },
      },
      "target prompt does not match",
    );
    await expectRejected(
      {
        mutateRecords: (records) => {
          records[1]!.stageSnapshot = "5".repeat(40);
        },
      },
      "target snapshot does not match",
    );
  });

  it("rejects missing or reversed relationships and binds receipt drift into the episode closure", async () => {
    await expectRejected(
      {
        mutateOrigins: (origins) => {
          origins["episode-one"]!.relationshipEdges = [];
        },
      },
      "relationship edges do not cover adjacent stages",
    );
    await expectRejected(
      {
        mutateOrigins: (origins) => {
          const edge =
            origins["episode-one"]!.relationshipEdges[0]!;
          edge.edgeId = "episode-one/stage-two->stage-one";
          edge.laterStageId = "stage-one";
          edge.priorStageId = "stage-two";
        },
      },
      "relationship edges do not cover adjacent stages",
    );

    const baseline = await createFixture();
    const drifted = await createFixture({
      mutateOrigins: (origins) => {
        origins["episode-one"]!.relationshipEdges[0]!
          .relationshipReceiptSha256 = sha256("drifted-relationship");
      },
    });
    try {
      const baselineEvidence = await loadC6DatasetLineage(baseline.input);
      const driftedEvidence = await loadC6DatasetLineage(drifted.input);
      expect(
        driftedEvidence.episodeById["episode-one"]!
          .episodeStageClosureSha256,
      ).not.toBe(
        baselineEvidence.episodeById["episode-one"]!
          .episodeStageClosureSha256,
      );
    } finally {
      await baseline.cleanup();
      await drifted.cleanup();
    }
  });
});

interface MutableSourceUnitRecord {
  agentVisiblePromptSha256?: string;
  historyMessage?: {
    role: "assistant" | "user";
    text: string;
  };
  id: string;
  locator: string;
  promptDerivation?: "verbatim-source-request-v1";
  repository: {
    baseCommit: string;
    url: string;
  };
  role: "prehistory" | "target";
  schemaVersion: 1;
  sourceRequest: string;
  sourceRequestSha256: string;
  sourceSnapshotRevision: string;
  sourceType: "real-history";
  stageSnapshot?: string;
  upstreamItemRevision: string;
}

interface MutableLineageStage {
  historyArtifactSha256: string;
  historyMaterializationSha256: string;
  historySourceUnitIds: string[];
  stageId: string;
  targetSourceUnitId: string;
}

interface MutableLineage {
  datasetId: string;
  episodes: Array<{
    agentVisibleTaskSha256: string;
    episodeId: string;
    sourceId: string;
    stages: MutableLineageStage[];
  }>;
  schemaVersion: 2;
  sources: Array<{
    id: string;
    licenseEvidence: ArtifactReference;
    locator: string;
    populationManifest: ArtifactReference;
    revision: string;
    sourceType: "real-history";
  }>;
}

interface MutablePopulation {
  recordsArtifact: ArtifactReference;
  revision: string;
  schemaVersion: 1;
  sourceId: string;
  sourceType: "real-history";
  units: Array<{
    id: string;
    recordIndex: number;
    recordSha256: string;
  }>;
}

interface ArtifactReference {
  path: string;
  sha256: string;
}

interface FixtureContext {
  historyArtifactSha256ByStageId: ReadonlyMap<string, string>;
  recordSha256ById: ReadonlyMap<string, string>;
  sha256: typeof sha256;
  sourceId: string;
}

interface FixtureOptions {
  mutateHistoryBytes?: (
    historyBytesByStageId: Map<string, string>,
  ) => void;
  mutateLineage?: (
    lineage: MutableLineage,
    context: FixtureContext,
  ) => void;
  mutateOrigins?: (
    origins: TaskOrigins,
  ) => void;
  mutatePopulation?: (
    population: MutablePopulation,
    context: FixtureContext,
  ) => void;
  mutateRecords?: (
    records: MutableSourceUnitRecord[],
  ) => void;
  mutateTaskContent?: (
    taskContent: Record<string, string>,
  ) => void;
  noHistory?: boolean;
}

interface TaskOrigins {
  [episodeId: string]: {
    relationshipEdges: Array<{
      commitPathSha256: string;
      edgeId: string;
      episodeId: string;
      laterBaseCommit: string;
      laterRequestAt: string;
      laterStageId: string;
      priorCompletionAt: string;
      priorMergeCommit: string;
      priorStageId: string;
      relationshipReceiptBytes: number;
      relationshipReceiptPath: string;
      relationshipReceiptSha256: string;
    }>;
    stageOrigins: Array<{
      originalRequestSha256: string;
      sourceLocator: string;
      stageId: string;
      upstreamItemRevision: string;
    }>;
  };
}

async function expectRejected(
  options: FixtureOptions,
  message: string,
): Promise<void> {
  const fixture = await createFixture(options);
  try {
    await expect(loadC6DatasetLineage(fixture.input)).rejects.toThrow(message);
  } finally {
    await fixture.cleanup();
  }
}

async function createFixture(options: FixtureOptions = {}) {
  const root = await mkdtemp(
    join(await realpath(tmpdir()), "goodmemory-c6-lineage-"),
  );
  const sourceId = "source-one";
  const promptByStageId = new Map([
    ["stage-one", "Fix stage one"],
    ["stage-two", "Fix stage two"],
  ]);
  const historyBytesByStageId = options.noHistory === true
    ? new Map([
      ["stage-one", ""],
      ["stage-two", ""],
    ])
    : new Map([
      ["stage-one", `${historyLine("user", "Prior one")}\n`],
      [
        "stage-two",
        [
          historyLine("user", "Prior one"),
          historyLine("assistant", "Prior two"),
          "",
        ].join("\n"),
      ],
    ]);
  options.mutateHistoryBytes?.(historyBytesByStageId);
  const historyArtifactSha256ByStageId = new Map(
    [...historyBytesByStageId].map(([stageId, bytes]) => [
      stageId,
      sha256(bytes),
    ]),
  );
  const records = [
    prehistoryRecord("history-one", "prior/one", "Prior one", "user"),
    targetRecord(
      "target-one",
      "target/one",
      promptByStageId.get("stage-one")!,
      STAGE_ONE_REVISION,
    ),
    prehistoryRecord("history-two", "prior/two", "Prior two", "assistant"),
    targetRecord(
      "target-two",
      "target/two",
      promptByStageId.get("stage-two")!,
      STAGE_TWO_REVISION,
    ),
    prehistoryRecord("history-three", "prior/three", "Prior three", "user"),
  ];
  options.mutateRecords?.(records);
  const recordLines = records.map((record) => JSON.stringify(record));
  const recordsBytes = `${recordLines.join("\n")}\n`;
  const recordSha256ById = new Map(
    records.map((record, index) => [
      record.id,
      sha256(`${recordLines[index]}\n`),
    ]),
  );
  const recordsArtifact = {
    path: "provenance/dataset-lineage/records/source-one.jsonl",
    sha256: sha256(recordsBytes),
  };
  const population: MutablePopulation = {
    recordsArtifact,
    revision: SOURCE_REVISION,
    schemaVersion: 1,
    sourceId,
    sourceType: "real-history",
    units: records.map((record, index) => ({
      id: record.id,
      recordIndex: index + 1,
      recordSha256: recordSha256ById.get(record.id)!,
    })),
  };
  const context: FixtureContext = {
    historyArtifactSha256ByStageId,
    recordSha256ById,
    sha256,
    sourceId,
  };
  options.mutatePopulation?.(population, context);
  const populationBytes = `${JSON.stringify(population, null, 2)}\n`;
  const populationReference = {
    path: "provenance/dataset-lineage/populations/source-one.json",
    sha256: sha256(populationBytes),
  };
  const license = {
    decision: "accepted",
    license: "MIT",
    reviewedAt: "2026-07-25T00:00:00.000Z",
    reviewer: "independent-reviewer",
    schemaVersion: 1,
    sourceId,
    sourceRevision: SOURCE_REVISION,
  };
  const licenseBytes = `${JSON.stringify(license, null, 2)}\n`;
  const licenseReference = {
    path: "provenance/dataset-lineage/licenses/source-one.json",
    sha256: sha256(licenseBytes),
  };
  const historyIds = options.noHistory === true
    ? [[], []]
    : [["history-one"], ["history-one", "history-two"]];
  const lineage: MutableLineage = {
    datasetId: "dataset-one",
    episodes: [{
      agentVisibleTaskSha256: sha256("visible-task"),
      episodeId: "episode-one",
      sourceId,
      stages: [
        lineageStage("stage-one", "target-one", historyIds[0]!, context),
        lineageStage("stage-two", "target-two", historyIds[1]!, context),
      ],
    }],
    schemaVersion: 2,
    sources: [{
      id: sourceId,
      licenseEvidence: licenseReference,
      locator: "https://example.com/source",
      populationManifest: populationReference,
      revision: SOURCE_REVISION,
      sourceType: "real-history",
    }],
  };
  options.mutateLineage?.(lineage, context);
  const lineageBytes = `${JSON.stringify(lineage, null, 2)}\n`;
  const lineageReference = {
    path: "provenance/dataset-lineage/lineage.json" as const,
    sha256: sha256(lineageBytes),
  };
  const files = new Map<string, string>([
    [lineageReference.path, lineageBytes],
    [populationReference.path, populationBytes],
    [recordsArtifact.path, recordsBytes],
    [licenseReference.path, licenseBytes],
    ["prompts/stage-one.md", promptByStageId.get("stage-one")!],
    ["prompts/stage-two.md", promptByStageId.get("stage-two")!],
    ["history/stage-one.json", historyBytesByStageId.get("stage-one")!],
    ["history/stage-two.json", historyBytesByStageId.get("stage-two")!],
  ]);
  await Promise.all([...files].map(async ([path, bytes]) => {
    const absolutePath = join(root, path);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, bytes);
  }));
  const dataset = buildDataset(
    lineageReference,
    historyArtifactSha256ByStageId,
    options.noHistory === true,
  );
  const assetLock: C6AssetLock = {
    assetRootSha256: SHA_A,
    files: [...files].map(([path, bytes]) => ({
      bytes: Buffer.byteLength(bytes),
      mode: 0o644,
      path,
      sha256: sha256(bytes),
    })),
    schemaVersion: 1,
  };
  const taskContentSha256ByEpisodeId = {
    "episode-one": sha256("visible-task"),
  };
  options.mutateTaskContent?.(taskContentSha256ByEpisodeId);
  const taskOriginEvidenceByEpisodeId: TaskOrigins = {
    "episode-one": {
      relationshipEdges: [{
        commitPathSha256: sha256("commit-path"),
        edgeId: "episode-one/stage-one->stage-two",
        episodeId: "episode-one",
        laterBaseCommit: STAGE_TWO_REVISION,
        laterRequestAt: "2026-02-01T00:00:00.000Z",
        laterStageId: "stage-two",
        priorCompletionAt: "2026-01-15T00:00:00.000Z",
        priorMergeCommit: "5".repeat(40),
        priorStageId: "stage-one",
        relationshipReceiptBytes: 128,
        relationshipReceiptPath:
          "provenance/task-origin/relationships/episode-one/stage-one-to-stage-two.json",
        relationshipReceiptSha256: sha256("relationship-receipt"),
      }],
      stageOrigins: [
        originFor(records[1]!, "stage-one"),
        originFor(records[3]!, "stage-two"),
      ],
    },
  };
  options.mutateOrigins?.(taskOriginEvidenceByEpisodeId);

  return {
    cleanup: () => rm(root, { force: true, recursive: true }),
    input: {
      assetLock,
      dataset,
      datasetRoot: root,
      taskContentSha256ByEpisodeId,
      taskOriginEvidenceByEpisodeId,
    },
  };
}

function buildDataset(
  sourceLineage: {
    path: "provenance/dataset-lineage/lineage.json";
    sha256: string;
  },
  historyArtifactSha256ByStageId: ReadonlyMap<string, string>,
  noHistory: boolean,
): CodexCodingEffectDatasetV3 {
  const stratum = noHistory
    ? "no-history-negative-control"
    : "validated-approach";
  return {
    datasetId: "dataset-one",
    episodes: [{
      author: "author",
      claimEligibility: "claim-eligible",
      ecosystem: "typescript",
      forbiddenLeakage: {
        fileSha256: [],
        strings: ["hidden-value"],
      },
      historyPolicy: "stage-scoped-sealed-prefix-v1",
      id: "episode-one",
      language: "typescript",
      preparation: {
        command: ["bun", "install"],
        networkMode: "disabled",
      },
      provenance: "frozen-upstream",
      repository: {
        baseCommit: BASE_COMMIT,
        license: "MIT",
        url: REPOSITORY_URL,
      },
      sourceType: "real-history",
      stages: [
        datasetStage(
          "stage-one",
          1,
          STAGE_ONE_REVISION,
          historyArtifactSha256ByStageId.get("stage-one")!,
          stratum,
          noHistory,
        ),
        datasetStage(
          "stage-two",
          2,
          STAGE_TWO_REVISION,
          historyArtifactSha256ByStageId.get("stage-two")!,
          stratum,
          noHistory,
        ),
      ],
      stateMode: "canonical-snapshot",
      strata: [stratum],
    }],
    schemaVersion: 3,
    sourceLineage,
  };
}

function datasetStage(
  stageId: string,
  position: number,
  snapshot: string,
  historySha256: string,
  stratum: "no-history-negative-control" | "validated-approach",
  noHistory: boolean,
): CodexCodingEffectDatasetV3["episodes"][number]["stages"][number] {
  return {
    allowedFeedback: [],
    expectedChangedFiles: [`src/${stageId}.ts`],
    goldPatch: {
      path: `evaluator/${stageId}.patch`,
      sha256: SHA_A,
    },
    hiddenFailToPass: ["bun", "test", stageId],
    hiddenPassToPass: ["bun", "test"],
    history: {
      forbiddenLeakageSha256: [],
      path: `history/${stageId}.json`,
      sha256: historySha256,
      source: "frozen-artifact",
    },
    id: stageId,
    memoryExpectation: noHistory
      ? { dependencies: [], mode: "none" }
      : {
        dependencies: [{
          category: stratum,
          description: "prior review history",
        }],
        mode: "required",
      },
    position,
    promptPath: `prompts/${stageId}.md`,
    snapshot,
    timeoutMs: 1_000,
  };
}

function prehistoryRecord(
  id: string,
  locatorSuffix: string,
  sourceRequest: string,
  historyRole: "assistant" | "user",
): MutableSourceUnitRecord {
  return {
    id,
    locator: `https://example.com/${locatorSuffix}`,
    repository: {
      baseCommit: BASE_COMMIT,
      url: REPOSITORY_URL,
    },
    schemaVersion: 1,
    sourceRequest,
    sourceRequestSha256: sha256(sourceRequest),
    sourceSnapshotRevision: SOURCE_REVISION,
    sourceType: "real-history",
    upstreamItemRevision: SOURCE_REVISION,
    historyMessage: {
      role: historyRole,
      text: sourceRequest,
    },
    role: "prehistory",
  };
}

function targetRecord(
  id: string,
  locatorSuffix: string,
  sourceRequest: string,
  stageSnapshot: string,
): MutableSourceUnitRecord {
  return {
    id,
    locator: `https://example.com/${locatorSuffix}`,
    repository: {
      baseCommit: BASE_COMMIT,
      url: REPOSITORY_URL,
    },
    schemaVersion: 1,
    sourceRequest,
    sourceRequestSha256: sha256(sourceRequest),
    sourceSnapshotRevision: SOURCE_REVISION,
    sourceType: "real-history",
    upstreamItemRevision: stageSnapshot,
    agentVisiblePromptSha256: sha256(sourceRequest),
    promptDerivation: "verbatim-source-request-v1",
    role: "target",
    stageSnapshot,
  };
}

function originFor(
  record: MutableSourceUnitRecord,
  stageId: string,
) {
  return {
    originalRequestSha256: sha256(record.sourceRequest.trim()),
    sourceLocator: record.locator,
    stageId,
    upstreamItemRevision: record.upstreamItemRevision,
  };
}

function historyLine(
  role: "assistant" | "user",
  text: string,
): string {
  return JSON.stringify({
    payload: {
      content: [{
        text,
        type: role === "user" ? "input_text" : "output_text",
      }],
      role,
      type: "message",
    },
    type: "response_item",
  });
}

function lineageStage(
  stageId: string,
  targetSourceUnitId: string,
  historySourceUnitIds: string[],
  context: FixtureContext,
): MutableLineageStage {
  const historyArtifactSha256 =
    context.historyArtifactSha256ByStageId.get(stageId)!;
  return {
    historyArtifactSha256,
    historyMaterializationSha256: materializationSha256(
      context.sourceId,
      historyArtifactSha256,
      historySourceUnitIds,
      context.recordSha256ById,
    ),
    historySourceUnitIds,
    stageId,
    targetSourceUnitId,
  };
}

function refreshMaterialization(
  lineage: MutableLineage,
  context: FixtureContext,
  stageIndex: number,
): void {
  const stage = lineage.episodes[0]!.stages[stageIndex]!;
  stage.historyMaterializationSha256 = materializationSha256(
    context.sourceId,
    stage.historyArtifactSha256,
    stage.historySourceUnitIds,
    context.recordSha256ById,
  );
}

function materializationSha256(
  sourceId: string,
  historyArtifactSha256: string,
  historySourceUnitIds: readonly string[],
  recordSha256ById: ReadonlyMap<string, string>,
): string {
  return sha256(JSON.stringify({
    historyArtifactSha256,
    sourceId,
    sourceUnitRecordSha256: historySourceUnitIds.map(
      (unitId) => recordSha256ById.get(unitId) ?? SHA_A,
    ),
  }));
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
