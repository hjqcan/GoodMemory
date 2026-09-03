import { describe, expect, it } from "bun:test";

import {
  parseCodexCodingEffectDataset,
  selectCodexCodingEffectEpisodes,
} from "../../scripts/codex-coding-effect/dataset";

const GIT_SHA = "a".repeat(40);
const SNAPSHOT_SHA = "b".repeat(40);
const SHA256 = "c".repeat(64);

function validDataset() {
  return {
    datasetId: "codex-coding-continuity-pilot-v1",
    episodes: [
      {
        author: "GoodMemory maintainers",
        claimEligibility: "pilot-only",
        ecosystem: "bun",
        forbiddenLeakage: {
          fileSha256: [SHA256],
          strings: ["hidden sentinel"],
        },
        goldPatchPath: "evaluator/gold/episode-001.patch",
        id: "episode-001",
        language: "typescript",
        preparation: {
          command: ["bun", "install", "--frozen-lockfile"],
          networkMode: "dependency-setup-only",
        },
        prehistory: {
          forbiddenLeakageSha256: [SHA256],
          path: "prehistory/episode-001.jsonl",
          sha256: SHA256,
          source: "frozen-artifact",
        },
        provenance: "Authored controlled mutation before paired execution.",
        repository: {
          baseCommit: GIT_SHA,
          license: "MIT",
          url: "https://example.invalid/goodmemory-codex-fixture.git",
        },
        sourceType: "controlled-mutation",
        stages: [
          {
            allowedFeedback: [],
            expectedMemoryDependencies: [],
            hiddenFailToPass: [
              "bun",
              "test",
              "{evaluatorRoot}/hidden/stage-1.test.ts",
            ],
            hiddenPassToPass: ["bun", "test", "tests/regression.test.ts"],
            id: "stage-1",
            position: 1,
            promptPath: "prompts/episode-001-stage-1.md",
            snapshot: SNAPSHOT_SHA,
            timeoutMs: 900_000,
            visibleTest: ["bun", "test", "tests/visible.test.ts"],
          },
          {
            allowedFeedback: ["The attempted parser shortcut failed."],
            expectedMemoryDependencies: [
              {
                category: "failure-avoidance",
                description: "Do not repeat the disproved parser shortcut.",
              },
            ],
            hiddenFailToPass: [
              "bun",
              "test",
              "{evaluatorRoot}/hidden/stage-2.test.ts",
            ],
            hiddenPassToPass: ["bun", "test", "tests/regression.test.ts"],
            id: "stage-2",
            position: 2,
            promptPath: "prompts/episode-001-stage-2.md",
            snapshot: SNAPSHOT_SHA,
            timeoutMs: 900_000,
          },
        ],
        stateMode: "canonical-snapshot",
        strata: ["failure-avoidance", "user-correction"],
      },
    ],
    schemaVersion: 1,
  } as const;
}

describe("Codex coding-effect dataset", () => {
  it("parses a controlled multi-stage pilot episode", () => {
    const dataset = parseCodexCodingEffectDataset(validDataset());

    expect(dataset.datasetId).toBe("codex-coding-continuity-pilot-v1");
    expect(dataset.episodes[0]?.stages.map((stage) => stage.id)).toEqual([
      "stage-1",
      "stage-2",
    ]);
  });

  it("rejects duplicate episode and stage ids", () => {
    const dataset = validDataset();
    expect(() => parseCodexCodingEffectDataset({
      ...dataset,
      episodes: [dataset.episodes[0], dataset.episodes[0]],
    })).toThrow("dataset contains duplicate episode id episode-001");

    const episode = dataset.episodes[0];
    expect(() => parseCodexCodingEffectDataset({
      ...dataset,
      episodes: [{
        ...episode,
        stages: [episode.stages[0], {
          ...episode.stages[1],
          id: "stage-1",
        }],
      }],
    })).toThrow("episode episode-001 contains duplicate stage id stage-1");
  });

  it("requires an immutable repository commit and declared license", () => {
    const dataset = validDataset();
    const episode = dataset.episodes[0];
    const { license: _license, ...withoutLicense } = episode.repository;
    expect(() => parseCodexCodingEffectDataset({
      ...dataset,
      episodes: [{ ...episode, repository: withoutLicense }],
    })).toThrow("repository.license");

    const { baseCommit: _baseCommit, ...withoutCommit } = episode.repository;
    expect(() => parseCodexCodingEffectDataset({
      ...dataset,
      episodes: [{ ...episode, repository: withoutCommit }],
    })).toThrow("repository.baseCommit");
  });

  it("requires both hidden fail-to-pass and pass-to-pass commands", () => {
    const dataset = validDataset();
    const episode = dataset.episodes[0];
    const stage = episode.stages[0];
    const { hiddenFailToPass: _hiddenFailToPass, ...withoutFailToPass } = stage;
    expect(() => parseCodexCodingEffectDataset({
      ...dataset,
      episodes: [{
        ...episode,
        stages: [withoutFailToPass, episode.stages[1]],
      }],
    })).toThrow("hiddenFailToPass");

    const { hiddenPassToPass: _hiddenPassToPass, ...withoutPassToPass } = stage;
    expect(() => parseCodexCodingEffectDataset({
      ...dataset,
      episodes: [{
        ...episode,
        stages: [withoutPassToPass, episode.stages[1]],
      }],
    })).toThrow("hiddenPassToPass");
  });

  it("rejects repository-state modes outside the frozen protocol", () => {
    const dataset = validDataset();
    expect(() => parseCodexCodingEffectDataset({
      ...dataset,
      episodes: [{
        ...dataset.episodes[0],
        stateMode: "shared-worktree",
      }],
    })).toThrow("stateMode");
  });

  it("blocks pilot-only episodes from a full claim-candidate selection", () => {
    const dataset = parseCodexCodingEffectDataset(validDataset());

    expect(() => selectCodexCodingEffectEpisodes(dataset, {
      episodeIds: [],
      evidenceClass: "codex-coding-effect-candidate",
    })).toThrow(
      "claim-candidate runs cannot select pilot-only episode episode-001",
    );
  });

  it("requires gold patches to stay in the evaluator-only namespace", () => {
    const dataset = validDataset();
    expect(() => parseCodexCodingEffectDataset({
      ...dataset,
      episodes: [{
        ...dataset.episodes[0],
        goldPatchPath: "workspace/gold.patch",
      }],
    })).toThrow("goldPatchPath must be under evaluator/");
  });

  it("parses schema v2 with stage-owned gold and memory truth", () => {
    const dataset = validDatasetV2();
    const parsed = parseCodexCodingEffectDataset(dataset);

    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.episodes[0]?.stages[1]).toMatchObject({
      goldPatch: {
        path: "evaluator/gold/episode-001-stage-2.patch",
        sha256: SHA256,
      },
      memoryExpectation: {
        mode: "required",
      },
    });
    expect(() => parseCodexCodingEffectDataset({
      ...dataset,
      episodes: [{
        ...dataset.episodes[0],
        stages: [{
          ...dataset.episodes[0].stages[0],
          goldPatch: {
            path: "workspace/stage-1.patch",
            sha256: SHA256,
          },
        }, dataset.episodes[0].stages[1]],
      }],
    })).toThrow("stage gold patch must be under evaluator/");
    expect(() => parseCodexCodingEffectDataset({
      ...dataset,
      episodes: [{
        ...dataset.episodes[0],
        stages: [{
          ...dataset.episodes[0].stages[0],
          expectedChangedFiles: ["src/../evaluator/hidden.ts"],
        }, dataset.episodes[0].stages[1]],
      }],
    })).toThrow("expectedChangedFiles");
    expect(() => parseCodexCodingEffectDataset({
      ...dataset,
      episodes: [{
        ...dataset.episodes[0],
        goldPatchPath: "evaluator/gold/legacy.patch",
      }],
    })).toThrow("goldPatchPath");
  });

  it("parses schema v3 with one sealed history binding per stage", () => {
    const dataset = validDatasetV3();
    const parsed = parseCodexCodingEffectDataset(dataset);

    expect(parsed.schemaVersion).toBe(3);
    expect(parsed.episodes[0]).toMatchObject({
      historyPolicy: "stage-scoped-sealed-prefix-v1",
      stages: [
        {
          history: {
            path: "prehistory/episode-001-stage-1.jsonl",
            source: "frozen-artifact",
          },
        },
        {
          history: {
            path: "prehistory/episode-001-stage-2.jsonl",
            source: "frozen-artifact",
          },
        },
      ],
    });
    expect(parsed.episodes[0]).not.toHaveProperty("prehistory");

    const episode = dataset.episodes[0];
    expect(() => parseCodexCodingEffectDataset({
      ...dataset,
      episodes: [{
        ...episode,
        prehistory: episode.stages[0].history,
      }],
    })).toThrow("prehistory");
    expect(() => parseCodexCodingEffectDataset({
      ...dataset,
      episodes: [{
        ...episode,
        stages: [{
          ...episode.stages[0],
          history: {
            ...episode.stages[0].history,
            path: "../future-history.jsonl",
          },
        }, episode.stages[1]],
      }],
    })).toThrow("history.path");
  });

  it("keeps C6 asset and provenance fields out of schema v1 and v2", () => {
    const legacy = validDataset();
    expect(() => parseCodexCodingEffectDataset({
      ...legacy,
      episodes: [{
        ...legacy.episodes[0],
        repository: {
          ...legacy.episodes[0].repository,
          assetPath: "repositories/episode-001",
        },
      }],
    })).toThrow("assetPath");

    const v2 = validDatasetV2();
    expect(() => parseCodexCodingEffectDataset({
      ...v2,
      episodes: [{
        ...v2.episodes[0],
        taskOriginReceipt: {
          path: "provenance/task-origin/reviews/episode-001.json",
          sha256: SHA256,
        },
      }],
    })).toThrow("taskOriginReceipt");
    expect(() => parseCodexCodingEffectDataset({
      ...v2,
      sourceLineage: {
        path: "provenance/dataset-lineage/lineage.json",
        sha256: SHA256,
      },
    })).toThrow("sourceLineage");
  });

  it("requires task-origin evidence for claim-eligible external benchmarks", () => {
    const dataset = validDatasetV3();
    const episode = dataset.episodes[0];

    expect(() => parseCodexCodingEffectDataset({
      ...dataset,
      episodes: [{
        ...episode,
        claimEligibility: "claim-eligible",
        sourceType: "external-benchmark",
      }],
    })).toThrow(
      "C6 external-benchmark episode episode-001 requires task-origin evidence",
    );
  });

  it("rejects unknown, duplicate, or undeclared memory strata", () => {
    const dataset = validDataset();
    expect(() => parseCodexCodingEffectDataset({
      ...dataset,
      episodes: [{
        ...dataset.episodes[0],
        strata: ["failure-avoidance", "password-recall"],
      }],
    })).toThrow("strata");

    expect(() => parseCodexCodingEffectDataset({
      ...dataset,
      episodes: [{
        ...dataset.episodes[0],
        strata: ["failure-avoidance", "failure-avoidance"],
      }],
    })).toThrow("episode episode-001 contains duplicate stratum failure-avoidance");

    expect(() => parseCodexCodingEffectDataset({
      ...dataset,
      episodes: [{
        ...dataset.episodes[0],
        strata: ["user-correction"],
      }],
    })).toThrow(
      "stage stage-2 uses undeclared memory stratum failure-avoidance",
    );
  });

  it("rejects traversal and non-contiguous stage positions", () => {
    const dataset = validDataset();
    expect(() => parseCodexCodingEffectDataset({
      ...dataset,
      episodes: [{
        ...dataset.episodes[0],
        goldPatchPath: "evaluator/../workspace/gold.patch",
      }],
    })).toThrow("goldPatchPath");

    expect(() => parseCodexCodingEffectDataset({
      ...dataset,
      episodes: [{
        ...dataset.episodes[0],
        stages: [dataset.episodes[0].stages[0], {
          ...dataset.episodes[0].stages[1],
          position: 3,
        }],
      }],
    })).toThrow("episode episode-001 stage positions must be contiguous from 1");
  });
});

function validDatasetV2() {
  const legacy = validDataset();
  const episode = legacy.episodes[0];
  const { goldPatchPath: _goldPatchPath, ...episodeWithoutGold } = episode;
  return {
    ...legacy,
    episodes: [{
      ...episodeWithoutGold,
      stages: episode.stages.map((stage, index) => {
        const { expectedMemoryDependencies: _dependencies, ...stageBase } = stage;
        return {
          ...stageBase,
          expectedChangedFiles: ["src/parser.ts"],
          goldPatch: {
            path: `evaluator/gold/episode-001-stage-${index + 1}.patch`,
            sha256: SHA256,
          },
          memoryExpectation: {
            dependencies: index === 0
              ? []
              : [{
                  category: "failure-avoidance" as const,
                  description: "Do not repeat the disproved parser shortcut.",
                }],
            mode: index === 0 ? "none" as const : "required" as const,
          },
        };
      }),
    }],
    schemaVersion: 2 as const,
  };
}

function validDatasetV3() {
  const legacy = validDatasetV2();
  const episode = legacy.episodes[0];
  const { prehistory: _prehistory, ...episodeWithoutPrehistory } = episode;
  return {
    ...legacy,
    episodes: [{
      ...episodeWithoutPrehistory,
      historyPolicy: "stage-scoped-sealed-prefix-v1" as const,
      stages: episode.stages.map((stage, index) => ({
        ...stage,
        history: {
          forbiddenLeakageSha256: [SHA256],
          path: `prehistory/episode-001-stage-${index + 1}.jsonl`,
          sha256: String(index + 1).repeat(64),
          source: "frozen-artifact" as const,
        },
      })),
    }],
    schemaVersion: 3 as const,
  };
}
