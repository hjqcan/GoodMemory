import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  cp,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  lstat,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  join,
  resolve,
} from "node:path";

import {
  buildC6LiveMultiLangNeighborCensusContinuationQualification,
  buildC6LiveMultiLangNeighborCensusQualification,
  deriveC6LiveMultiLangNeighborCensusContinuationQualification,
  materializeC6LiveMultiLangNeighborCensusContinuationQualification,
} from "../../scripts/codex-coding-effect/c6-live-multilang-neighbor-census-qualification";
import {
  buildC6AssetLock,
} from "../../scripts/codex-coding-effect/c6-asset-lock";
import {
  parseC6LiveMultiLangNeighborCensusContinuationQualificationCliOptions,
} from "../../scripts/snapshot-codex-coding-effect-c6-live-multilang-neighbor-census-continuation-qualification";

const FIXTURE_ROOT = resolve(
  import.meta.dir,
  "../../fixtures/codex-coding-effect/c6-source-pool",
);
const ACTOR_FRAME = join(
  FIXTURE_ROOT,
  "multi-source.reviewer-actor-qualified-screening-frame-v1.json",
);
const SOURCE_POOL = join(
  FIXTURE_ROOT,
  "swe-bench-live-multilang-608f7ae9.source-pool.json",
);
const SOURCE_PLAN = join(
  FIXTURE_ROOT,
  "swe-bench-live-multilang-608f7ae9.capture-plan-v1.json",
);
const PRIOR_PLAN = join(
  FIXTURE_ROOT,
  "swe-bench-live-multilang-608f7ae9.neighbor-census-plan-v1.json",
);
const CONTINUATION_PLAN = join(
  FIXTURE_ROOT,
  "swe-bench-live-multilang-608f7ae9.neighbor-census-plan-v2.json",
);
const WAVE2_ROOT =
  process.env
    .GOODMEMORY_TEST_C6_LIVE_MULTILANG_NEIGHBOR_CENSUS_V2_ROOT;
const WAVE1_ROOT =
  process.env
    .GOODMEMORY_TEST_C6_LIVE_MULTILANG_NEIGHBOR_CENSUS_V1_ROOT;
const SOURCE_ROOT =
  process.env
    .GOODMEMORY_TEST_C6_SWE_LIVE_MULTILANG_GRAPHQL_ROOT;
const realWave2It =
  WAVE2_ROOT !== undefined && SOURCE_ROOT !== undefined
    ? it
    : it.skip;
const realWave1It =
  WAVE1_ROOT !== undefined && SOURCE_ROOT !== undefined
    ? it
    : it.skip;

describe("Codex coding-effect C6 Live/MultiLang continuation qualification", () => {
  it("derives an independent tranche-2 schema-v3 qualification", () => {
    const input = fixture();
    const qualification =
      deriveC6LiveMultiLangNeighborCensusContinuationQualification(input);

    expect(qualification.artifactKind).toBe(
      "c6-live-multilang-neighbor-census-qualification",
    );
    expect(qualification.schemaVersion).toBe(3);
    expect(qualification.sampleBoundary.censusTranche).toBe(2);
    expect(
      qualification.independenceBoundary.priorTrancheOutcomeInput,
    ).toBe(false);
    expect(qualification.counts.rawObservationCount).toBe(1);
    expect(qualification.results).toHaveLength(1);
    expect(qualification.inputs.priorNeighborPlan).toMatchObject({
      artifactKind:
        "c6-live-multilang-neighbor-census-plan",
      schemaVersion: 1,
    });
  });

  it("requires every continuation materialization binding exactly once", () => {
    const hash = "a".repeat(64);
    expect(
      parseC6LiveMultiLangNeighborCensusContinuationQualificationCliOptions([
        "--actor-frame=actor-frame.json",
        `--expected-actor-frame-sha256=${hash}`,
        `--expected-neighbor-completion-sha256=${hash}`,
        `--expected-neighbor-plan-sha256=${hash}`,
        `--expected-neighbor-root-sha256=${hash}`,
        `--expected-prior-neighbor-plan-sha256=${hash}`,
        `--expected-prior-selected-repository-projection-sha256=${hash}`,
        `--expected-source-capture-plan-sha256=${hash}`,
        `--expected-source-graphql-root-sha256=${hash}`,
        `--expected-source-pool-sha256=${hash}`,
        "--neighbor-plan=neighbor-plan-v2.json",
        "--neighbor-root=/capture/neighbor-v2",
        "--prior-neighbor-plan=neighbor-plan-v1.json",
        "--source-capture-plan=source-plan.json",
        "--source-graphql-root=/capture/source",
        "--source-pool=source-pool.json",
        "--output=qualification-v3.json",
      ]),
    ).toEqual({
      actorFrame: "actor-frame.json",
      expectedActorFrameSha256: hash,
      expectedNeighborCompletionSha256: hash,
      expectedNeighborPlanSha256: hash,
      expectedNeighborRootSha256: hash,
      expectedPriorNeighborPlanSha256: hash,
      expectedPriorSelectedRepositoryProjectionSha256: hash,
      expectedSourceCapturePlanSha256: hash,
      expectedSourceGraphqlRootSha256: hash,
      expectedSourcePoolSha256: hash,
      neighborPlan: "neighbor-plan-v2.json",
      neighborRoot: "/capture/neighbor-v2",
      output: "qualification-v3.json",
      priorNeighborPlan: "neighbor-plan-v1.json",
      sourceCapturePlan: "source-plan.json",
      sourceGraphqlRoot: "/capture/source",
      sourcePool: "source-pool.json",
    });
    expect(() =>
      parseC6LiveMultiLangNeighborCensusContinuationQualificationCliOptions([
        "--actor-frame=one.json",
        "--actor-frame=two.json",
      ])
    ).toThrow("--actor-frame cannot be specified more than once");
    expect(() =>
      parseC6LiveMultiLangNeighborCensusContinuationQualificationCliOptions([
        "--unknown=value",
      ])
    ).toThrow("unknown C6 continuation qualification option");
    expect(() =>
      parseC6LiveMultiLangNeighborCensusContinuationQualificationCliOptions(
        [],
      )
    ).toThrow("--actor-frame is required exactly once");
  });

  realWave2It(
    "byte-rebuilds source, prior, and continuation plans from the real 257-file wave2 closure",
    async () => {
      const result =
        await buildC6LiveMultiLangNeighborCensusContinuationQualification(
          await realBuildInput({
            neighborPlanPath: CONTINUATION_PLAN,
            neighborRoot: WAVE2_ROOT!,
            priorNeighborPlanPath: PRIOR_PLAN,
          }),
        );

      expect(result.outputSha256).toBe(
        "011c264e496fb849a1f14baee1289cb815e90bd81adfa4f6bec44d08b11030ef",
      );
      expect(result.qualification).toMatchObject({
        counts: {
          capturedRepositoryCount: 64,
          rawObservationCount: 1_024,
          truncatedRepositoryCount: 64,
        },
        independenceBoundary: {
          priorTrancheOutcomeInput: false,
        },
        sampleBoundary: {
          censusTranche: 2,
        },
        schemaVersion: 3,
      });
    },
    30_000,
  );

  realWave2It(
    "rejects rebound prior, overlap, plan drift, contamination, and schema mixing",
    async () => {
      const mutations: Array<{
        mutate: (copy: RealClosureCopy) => Promise<void>;
        name: string;
      }> = [{
        name: "forged prior with every downstream hash rebound",
        mutate: forgeAndRebindPrior,
      }, {
        name: "prior/current tranche overlap with plan bindings rebound",
        mutate: forgeAndRebindOverlap,
      }, {
        name: "capture plan drift",
        mutate: async (copy) => {
          const first = await firstCapture(copy.neighborRoot);
          const capture = await readJson(join(first, "capture.json"));
          capture.plan.sha256 = "0".repeat(64);
          await writeCanonical(join(first, "capture.json"), capture);
          await rebindCompletionCapture(copy.neighborRoot, first);
        },
      }, {
        name: "completion plan drift",
        mutate: async (copy) => {
          const path = join(copy.neighborRoot, "completion.json");
          const completion = await readJson(path);
          completion.plan.selectedRepositoryProjectionSha256 =
            "0".repeat(64);
          await writeCanonical(path, completion);
        },
      }, {
        name: "nested evaluator metadata",
        mutate: async (copy) => {
          const first = await firstCapture(copy.neighborRoot);
          const responsePath = join(first, "response.json");
          const response = await readJson(responsePath);
          response.data.repository.pullRequests.evaluatorMetadata = {
            verdict: "hidden",
          };
          await writeCanonical(responsePath, response);
          await rebindResponseAndCompletion(
            copy.neighborRoot,
            first,
          );
        },
      }, {
        name: "capture schema mixing",
        mutate: async (copy) => {
          const first = await firstCapture(copy.neighborRoot);
          const capture = await readJson(join(first, "capture.json"));
          capture.schemaVersion = 1;
          await writeCanonical(join(first, "capture.json"), capture);
          await rebindCompletionCapture(copy.neighborRoot, first);
        },
      }, {
        name: "completion schema mixing",
        mutate: async (copy) => {
          const path = join(copy.neighborRoot, "completion.json");
          const completion = await readJson(path);
          completion.schemaVersion = 1;
          await writeCanonical(path, completion);
        },
      }];

      for (const mutation of mutations) {
        const copy = await copyRealClosure();
        try {
          await mutation.mutate(copy);
          await expect(
            buildC6LiveMultiLangNeighborCensusContinuationQualification(
              await realBuildInput(copy),
            ),
            mutation.name,
          ).rejects.toThrow();
        } finally {
          await rm(copy.temporaryRoot, {
            force: true,
            recursive: true,
          });
        }
      }
    },
    30_000,
  );

  realWave2It(
    "rereads the complete closure and rejects terminal tree, mode, content, and plan drift",
    async () => {
      const mutations: Array<{
        mutate: (copy: RealClosureCopy) => Promise<void>;
        name: string;
      }> = [{
        name: "extra file",
        mutate: async (copy) => {
          await writeFile(
            join(copy.neighborRoot, "unexpected.json"),
            "{}\n",
            { mode: 0o600 },
          );
        },
      }, {
        name: "symlink",
        mutate: async (copy) => {
          await symlink(
            "completion.json",
            join(copy.neighborRoot, "unexpected-link.json"),
          );
        },
      }, {
        name: "chmod",
        mutate: async (copy) => {
          const first = await firstCapture(copy.neighborRoot);
          await chmod(join(first, "response.json"), 0o644);
        },
      }, {
        name: "content",
        mutate: async (copy) => {
          const first = await firstCapture(copy.neighborRoot);
          await writeFile(
            join(first, "response.json"),
            "{}\n",
          );
        },
      }, {
        name: "continuation plan",
        mutate: async (copy) => {
          await writeFile(
            copy.neighborPlanPath,
            "{}\n",
          );
        },
      }];

      for (const mutation of mutations) {
        const copy = await copyRealClosure();
        try {
          const buildInput = await realBuildInput(copy);
          await expect(
            buildC6LiveMultiLangNeighborCensusContinuationQualification(
              {
                ...buildInput,
                testHooks: {
                  beforeTerminalVerification: async () => {
                    await mutation.mutate(copy);
                  },
                },
              },
            ),
            mutation.name,
          ).rejects.toThrow();
        } finally {
          await rm(copy.temporaryRoot, {
            force: true,
            recursive: true,
          });
        }
      }
    },
    30_000,
  );

  realWave2It(
    "pins source root, directory, and file modes and rejects terminal chmod drift",
    async () => {
      const mutations: Array<{
        mutate: (copy: RealClosureCopy) => Promise<void>;
        name: string;
      }> = [{
        name: "source root",
        mutate: async (copy) => {
          await chmod(copy.sourceGraphqlRoot, 0o755);
        },
      }, {
        name: "source capture directory",
        mutate: async (copy) => {
          await chmod(
            await firstCapture(copy.sourceGraphqlRoot),
            0o700,
          );
        },
      }, {
        name: "source capture file",
        mutate: async (copy) => {
          await chmod(
            join(
              await firstCapture(copy.sourceGraphqlRoot),
              "capture.json",
            ),
            0o600,
          );
        },
      }];
      for (const mutation of mutations) {
        const copy = await copyRealClosure({ copySource: true });
        try {
          const sourceCapture =
            await firstCapture(copy.sourceGraphqlRoot);
          expect(
            (await lstat(copy.sourceGraphqlRoot)).mode & 0o777,
            `${mutation.name} baseline root`,
          ).toBe(0o700);
          expect(
            (await lstat(sourceCapture)).mode & 0o777,
            `${mutation.name} baseline directory`,
          ).toBe(0o755);
          expect(
            (await lstat(join(sourceCapture, "capture.json"))).mode &
              0o777,
            `${mutation.name} baseline file`,
          ).toBe(0o644);
          const buildInput = await realBuildInput(copy);
          await expect(
            buildC6LiveMultiLangNeighborCensusContinuationQualification({
              ...buildInput,
              testHooks: {
                beforeTerminalVerification: async () => {
                  await mutation.mutate(copy);
                },
              },
            }),
            mutation.name,
          ).rejects.toThrow();
        } finally {
          await rm(copy.temporaryRoot, {
            force: true,
            recursive: true,
          });
        }
      }
    },
    60_000,
  );

  realWave2It(
    "rejects neighbor and source content changed after the first terminal snapshot",
    async () => {
      const mutations: Array<{
        copySource: boolean;
        mutate: (copy: RealClosureCopy) => Promise<void>;
        name: string;
      }> = [{
        copySource: false,
        name: "neighbor content",
        mutate: async (copy) => {
          const first = await firstCapture(copy.neighborRoot);
          await writeFile(join(first, "response.json"), "{}\n");
        },
      }, {
        copySource: true,
        name: "source content",
        mutate: async (copy) => {
          const first = await firstCapture(
            copy.sourceGraphqlRoot,
          );
          await writeFile(join(first, "response.json"), "{}\n");
        },
      }];
      for (const mutation of mutations) {
        const copy = await copyRealClosure({
          copySource: mutation.copySource,
        });
        try {
          const buildInput = await realBuildInput(copy);
          await expect(
            buildC6LiveMultiLangNeighborCensusContinuationQualification({
              ...buildInput,
              testHooks: {
                afterTerminalSnapshot: async () => {
                  await mutation.mutate(copy);
                },
              },
            }),
            mutation.name,
          ).rejects.toThrow();
        } finally {
          await rm(copy.temporaryRoot, {
            force: true,
            recursive: true,
          });
        }
      }
    },
    60_000,
  );

  for (const mutation of [{
    name: "actor frame",
    mutate: async (copy: RealClosureCopy) => {
      await writeFile(copy.actorFramePath, "{}\n");
    },
  }, {
    name: "source capture plan",
    mutate: async (copy: RealClosureCopy) => {
      await writeFile(copy.sourceCapturePlanPath, "{}\n");
    },
  }, {
    name: "source pool",
    mutate: async (copy: RealClosureCopy) => {
      await writeFile(copy.sourcePoolPath, "{}\n");
    },
  }, {
    name: "prior plan",
    mutate: async (copy: RealClosureCopy) => {
      await writeFile(copy.priorNeighborPlanPath, "{}\n");
    },
  }, {
    name: "continuation plan",
    mutate: async (copy: RealClosureCopy) => {
      await writeFile(copy.neighborPlanPath, "{}\n");
    },
  }, {
    name: "neighbor root",
    mutate: async (copy: RealClosureCopy) => {
      const first = await firstCapture(copy.neighborRoot);
      await writeFile(join(first, "response.json"), "{}\n");
    },
  }, {
    copySource: true,
    name: "source GraphQL root",
    mutate: async (copy: RealClosureCopy) => {
      const first = await firstCapture(copy.sourceGraphqlRoot);
      await writeFile(join(first, "response.json"), "{}\n");
    },
  }]) {
    realWave2It(
      `removes published output after ${mutation.name} drift`,
      async () => {
        const copy = await copyRealClosure({
          copySource: mutation.copySource,
          copyStaticInputs: true,
        });
        const outputPath = join(
          copy.temporaryRoot,
          "qualification-v3.json",
        );
        let caught: unknown;
        let hookCalled = false;
        try {
          const buildInput = await realBuildInput(copy);
          try {
            await materializeC6LiveMultiLangNeighborCensusContinuationQualification({
              ...buildInput,
              outputPath,
              testHooks: {
                afterOutputPublication: async () => {
                  hookCalled = true;
                  await mutation.mutate(copy);
                },
              },
            });
          } catch (error) {
            caught = error;
          }
          expect(hookCalled).toBe(true);
          expect(caught).toBeInstanceOf(Error);
          expect((caught as NodeJS.ErrnoException).code).not.toBe(
            "ENOENT",
          );
          await expect(lstat(outputPath)).rejects.toMatchObject({
            code: "ENOENT",
          });
          expect(
            (await readdir(copy.temporaryRoot)).some((entry) =>
              entry.includes("qualification-v3.json.incomplete-")
            ),
          ).toBe(false);
        } finally {
          await rm(copy.temporaryRoot, {
            force: true,
            recursive: true,
          });
        }
      },
      30_000,
    );
  }

  realWave2It(
    "publishes only after a stable post-publication closure replay",
    async () => {
      const copy = await copyRealClosure();
      const outputPath = join(
        copy.temporaryRoot,
        "qualification-v3.json",
      );
      try {
        const result =
          await materializeC6LiveMultiLangNeighborCensusContinuationQualification({
            ...await realBuildInput(copy),
            outputPath,
          });
        const outputBytes = await readFile(outputPath);
        expect(result.outputSha256).toBe(
          "011c264e496fb849a1f14baee1289cb815e90bd81adfa4f6bec44d08b11030ef",
        );
        expect(sha256(outputBytes)).toBe(result.outputSha256);
        expect((await lstat(outputPath)).mode & 0o777).toBe(0o644);
        expect(
          (await readdir(copy.temporaryRoot)).some((entry) =>
            entry.includes("qualification-v3.json.incomplete-")
          ),
        ).toBe(false);
      } finally {
        await rm(copy.temporaryRoot, {
          force: true,
          recursive: true,
        });
      }
    },
    30_000,
  );

  realWave2It(
    "publishes with no-replace semantics and preserves an existing output",
    async () => {
      const copy = await copyRealClosure();
      const outputPath = join(
        copy.temporaryRoot,
        "qualification-v3.json",
      );
      try {
        await writeFile(outputPath, "existing\n", { mode: 0o644 });
        await expect(
          materializeC6LiveMultiLangNeighborCensusContinuationQualification({
            ...await realBuildInput(copy),
            outputPath,
          }),
        ).rejects.toMatchObject({ code: "EEXIST" });
        expect(await readFile(outputPath, "utf8")).toBe("existing\n");
        expect(
          (await readdir(copy.temporaryRoot)).some((entry) =>
            entry.includes("qualification-v3.json.incomplete-")
          ),
        ).toBe(false);
      } finally {
        await rm(copy.temporaryRoot, {
          force: true,
          recursive: true,
        });
      }
    },
    30_000,
  );

  realWave1It(
    "keeps the frozen schema-v2 qualification byte output unchanged",
    async () => {
      const result =
        await buildC6LiveMultiLangNeighborCensusQualification({
          actorFramePath: ACTOR_FRAME,
          expectedActorFrameSha256:
            "6838de7f36875b3b3de104ffd896b9e30dcf95ad1eb285a87b465789800f4b0c",
          expectedNeighborCompletionSha256:
            "68727cb0aefb04a3f9b84f8e67a41f9aaba952665e2fef798f61110e36352b53",
          expectedNeighborPlanSha256:
            "1b07d57ebc5601b9ab7f6742fdb5da91b9181784d7b2a33bf28ad318fa2e10f1",
          expectedNeighborRootSha256:
            "79d7d23097ec1ee11082a7b01a8f36d59383b3e2cf5d536630b29fde7a9400c4",
          expectedSourceCapturePlanSha256:
            "3923d3de3fd1bc5906530b918e2ca4c38cf0e83e3f93d1c590447dce1f5d1f37",
          expectedSourceGraphqlRootSha256:
            "8b8ad4ac1b3b1f92b0d352cb808eef0953ac07cd1bf74eb9f61d592f4e481dcc",
          expectedSourcePoolSha256:
            "8c53bcb359a6cde71207a69ca5b8630d6ea299f3fdc7219db958f86cb499e4ec",
          neighborPlanPath: PRIOR_PLAN,
          neighborRoot: WAVE1_ROOT!,
          sourceCapturePlanPath: SOURCE_PLAN,
          sourceGraphqlRoot: SOURCE_ROOT!,
          sourcePoolPath: SOURCE_POOL,
        });

      expect(result.outputSha256).toBe(
        "e51243ea3aa740a3a0812f8c1289ac2d3cf51436440ae0ecfea67a280743f1cc",
      );
    },
    30_000,
  );
});

function fixture() {
  return {
    capturedRepositoryCount: 64,
    inputs: {
      actorFrame: reference("actor-frame.json", "1"),
      actorFrameCandidateProjectionSha256: "2".repeat(64),
      neighborCompletion: reference("completion.json", "3"),
      neighborPlan: reference("neighbor-plan-v2.json", "4"),
      neighborRootSha256: "5".repeat(64),
      priorNeighborPlan: {
        ...reference("neighbor-plan-v1.json", "6"),
        artifactKind:
          "c6-live-multilang-neighbor-census-plan" as const,
        schemaVersion: 1 as const,
        selectedRepositoryProjectionSha256: "7".repeat(64),
      },
      sourceCapturePlan: reference("source-plan.json", "8"),
      sourceGraphqlRootSha256: "9".repeat(64),
      sourcePool: reference("source-pool.json", "a"),
    },
    observations: [{
      authorLogin: "author",
      baseRefOid: "b".repeat(40),
      canonicalAnchorId: "example/neighbor#1",
      canonicalRepository: "example/neighbor",
      captureDirectory: "001__example__neighbor",
      commentCount: 0,
      createdAt: "2026-07-01T00:00:00Z",
      mergeCommitOid: "c".repeat(40),
      mergedAt: "2026-07-02T00:00:00Z",
      pilotRank: 1,
      responseNodeRank: 1,
      reviewCount: 1,
      reviewThreadCount: 0,
      sourceSplit: "c" as const,
      url: "https://github.com/example/neighbor/pull/1",
    }],
    sourceAnchors: Array.from({ length: 743 }, (_, index) => ({
      canonicalAnchorId: `source/repository#${index + 1}`,
      captureOrder: index + 1,
    })),
    truncatedRepositoryCount: 64,
  };
}

function reference(path: string, fill: string) {
  return {
    bytes: 1,
    path,
    sha256: fill.repeat(64),
  };
}

interface RealClosureCopy {
  actorFramePath: string;
  neighborPlanPath: string;
  neighborRoot: string;
  priorNeighborPlanPath: string;
  sourceCapturePlanPath: string;
  sourceGraphqlRoot: string;
  sourcePoolPath: string;
  temporaryRoot: string;
}

async function realBuildInput(input: {
  actorFramePath?: string;
  neighborPlanPath: string;
  neighborRoot: string;
  priorNeighborPlanPath: string;
  sourceCapturePlanPath?: string;
  sourceGraphqlRoot?: string;
  sourcePoolPath?: string;
}) {
  const actorFramePath = input.actorFramePath ?? ACTOR_FRAME;
  const sourceCapturePlanPath =
    input.sourceCapturePlanPath ?? SOURCE_PLAN;
  const sourceGraphqlRoot =
    input.sourceGraphqlRoot ?? SOURCE_ROOT!;
  const sourcePoolPath = input.sourcePoolPath ?? SOURCE_POOL;
  const [
    actorFrameBytes,
    completionBytes,
    neighborPlanBytes,
    neighborLock,
    priorPlan,
    priorPlanBytes,
    sourcePlanBytes,
    sourceLock,
    sourcePoolBytes,
  ] = await Promise.all([
    readFile(actorFramePath),
    readFile(join(input.neighborRoot, "completion.json")),
    readFile(input.neighborPlanPath),
    buildC6AssetLock(input.neighborRoot),
    readJson(input.priorNeighborPlanPath),
    readFile(input.priorNeighborPlanPath),
    readFile(sourceCapturePlanPath),
    buildC6AssetLock(sourceGraphqlRoot),
    readFile(sourcePoolPath),
  ]);
  return {
    actorFramePath,
    expectedActorFrameSha256: sha256(actorFrameBytes),
    expectedNeighborCompletionSha256: sha256(completionBytes),
    expectedNeighborPlanSha256: sha256(neighborPlanBytes),
    expectedNeighborRootSha256: neighborLock.assetRootSha256,
    expectedPriorNeighborPlanSha256: sha256(priorPlanBytes),
    expectedPriorSelectedRepositoryProjectionSha256:
      priorPlan.independenceBoundary
        .selectedRepositoryProjectionSha256 as string,
    expectedSourceCapturePlanSha256: sha256(sourcePlanBytes),
    expectedSourceGraphqlRootSha256: sourceLock.assetRootSha256,
    expectedSourcePoolSha256: sha256(sourcePoolBytes),
    neighborPlanPath: input.neighborPlanPath,
    neighborRoot: input.neighborRoot,
    priorNeighborPlanPath: input.priorNeighborPlanPath,
    sourceCapturePlanPath,
    sourceGraphqlRoot,
    sourcePoolPath,
  };
}

async function copyRealClosure(options?: {
  copySource?: boolean;
  copyStaticInputs?: boolean;
}): Promise<RealClosureCopy> {
  const temporaryRoot = await realpath(
    await mkdtemp(
      join(tmpdir(), "goodmemory-c6-continuation-qualification-"),
    ),
  );
  const neighborRoot = join(temporaryRoot, "neighbor");
  const neighborPlanPath = join(
    temporaryRoot,
    basename(CONTINUATION_PLAN),
  );
  const priorNeighborPlanPath = join(
    temporaryRoot,
    basename(PRIOR_PLAN),
  );
  const actorFramePath = options?.copyStaticInputs
    ? join(temporaryRoot, basename(ACTOR_FRAME))
    : ACTOR_FRAME;
  const sourceCapturePlanPath = options?.copyStaticInputs
    ? join(temporaryRoot, basename(SOURCE_PLAN))
    : SOURCE_PLAN;
  const sourcePoolPath = options?.copyStaticInputs
    ? join(temporaryRoot, basename(SOURCE_POOL))
    : SOURCE_POOL;
  const sourceGraphqlRoot = options?.copySource
    ? join(temporaryRoot, "source")
    : SOURCE_ROOT!;
  const copies = [
    cp(WAVE2_ROOT!, neighborRoot, {
      preserveTimestamps: true,
      recursive: true,
    }),
    copyFile(CONTINUATION_PLAN, neighborPlanPath),
    copyFile(PRIOR_PLAN, priorNeighborPlanPath),
  ];
  if (options?.copyStaticInputs) {
    copies.push(
      copyFile(ACTOR_FRAME, actorFramePath),
      copyFile(SOURCE_PLAN, sourceCapturePlanPath),
      copyFile(SOURCE_POOL, sourcePoolPath),
    );
  }
  if (options?.copySource) {
    copies.push(cp(SOURCE_ROOT!, sourceGraphqlRoot, {
      preserveTimestamps: true,
      recursive: true,
    }));
  }
  await Promise.all(copies);
  await Promise.all([
    chmod(neighborRoot, 0o700),
    ...(options?.copySource
      ? [chmod(sourceGraphqlRoot, 0o700)]
      : []),
  ]);
  return {
    actorFramePath,
    neighborPlanPath,
    neighborRoot,
    priorNeighborPlanPath,
    sourceCapturePlanPath,
    sourceGraphqlRoot,
    sourcePoolPath,
    temporaryRoot,
  };
}

async function forgeAndRebindPrior(
  copy: RealClosureCopy,
): Promise<void> {
  const prior = await readJson(copy.priorNeighborPlanPath);
  prior.targets[0] = {
    ...prior.targets[0],
    canonicalRepository: "forged/repository",
    owner: "forged",
    repo: "repository",
    seedAnchorId: "forged/repository#1",
  };
  const priorProjectionSha256 = sha256(JSON.stringify(
    prior.targets.map(selectedRepositoryProjection),
  ));
  prior.independenceBoundary.selectedRepositoryProjectionSha256 =
    priorProjectionSha256;
  await writeCanonical(copy.priorNeighborPlanPath, prior);
  const priorBytes = await readFile(copy.priorNeighborPlanPath);

  const continuation = await readJson(copy.neighborPlanPath);
  continuation.independenceBoundary.priorNeighborPlanSha256 =
    sha256(priorBytes);
  continuation.independenceBoundary
    .priorSelectedRepositoryProjectionSha256 =
      priorProjectionSha256;
  const actorFrame = await readJson(copy.actorFramePath);
  const combinedExclusions = new Set<string>([
    ...actorFrame.candidates.map(
      (candidate: Record<string, unknown>) =>
        String(candidate.canonicalRepository).toLowerCase(),
    ),
    ...prior.targets.map(
      (target: Record<string, unknown>) =>
        String(target.canonicalRepository).toLowerCase(),
    ),
  ]);
  continuation.independenceBoundary
    .combinedExclusionProjectionSha256 = sha256(
      JSON.stringify([...combinedExclusions].sort()),
    );
  continuation.inputs.priorNeighborPlan = {
    artifactKind:
      "c6-live-multilang-neighbor-census-plan",
    ...artifactReference(
      basename(copy.priorNeighborPlanPath),
      priorBytes,
    ),
    schemaVersion: 1,
    selectedRepositoryProjectionSha256:
      priorProjectionSha256,
  };
  await writeCanonical(copy.neighborPlanPath, continuation);
  await rebindAllPlanReferences(copy);
}

async function forgeAndRebindOverlap(
  copy: RealClosureCopy,
): Promise<void> {
  const [prior, continuation] = await Promise.all([
    readJson(copy.priorNeighborPlanPath),
    readJson(copy.neighborPlanPath),
  ]);
  const priorTarget = prior.targets[0];
  continuation.targets[0] = {
    ...continuation.targets[0],
    canonicalRepository: priorTarget.canonicalRepository,
    owner: priorTarget.owner,
    repo: priorTarget.repo,
    seedAnchorId: priorTarget.seedAnchorId,
    seedCaptureOrder: priorTarget.seedCaptureOrder,
    sourceSplit: priorTarget.sourceSplit,
    withinSplitRank: 9,
  };
  continuation.independenceBoundary
    .selectedRepositoryProjectionSha256 = sha256(JSON.stringify(
      continuation.targets.map(selectedRepositoryProjection),
    ));
  await writeCanonical(copy.neighborPlanPath, continuation);
  await rebindAllPlanReferences(copy);
}

async function rebindAllPlanReferences(
  copy: RealClosureCopy,
): Promise<void> {
  const [plan, planBytes, completion] = await Promise.all([
    readJson(copy.neighborPlanPath),
    readFile(copy.neighborPlanPath),
    readJson(join(copy.neighborRoot, "completion.json")),
  ]);
  const planBinding = {
    artifactKind:
      "c6-live-multilang-neighbor-census-plan",
    priorPlan: plan.inputs.priorNeighborPlan,
    schemaVersion: 2,
    selectedRepositoryProjectionSha256:
      plan.independenceBoundary
        .selectedRepositoryProjectionSha256,
    sha256: sha256(planBytes),
  };
  for (const [index, completionCapture] of
    completion.captures.entries()) {
    const directory = join(
      copy.neighborRoot,
      completionCapture.captureDirectory,
    );
    const capturePath = join(directory, "capture.json");
    const capture = await readJson(capturePath);
    capture.plan = planBinding;
    capture.planTarget = plan.targets[index];
    completionCapture.canonicalRepository =
      plan.targets[index].canonicalRepository;
    await writeCanonical(capturePath, capture);
    completionCapture.captureManifest = artifactReference(
      `${completionCapture.captureDirectory}/capture.json`,
      await readFile(capturePath),
    );
  }
  completion.plan = {
    ...artifactReference(
      basename(copy.neighborPlanPath),
      planBytes,
    ),
    artifactKind:
      "c6-live-multilang-neighbor-census-plan",
    priorPlan: plan.inputs.priorNeighborPlan,
    schemaVersion: 2,
    selectedRepositoryProjectionSha256:
      plan.independenceBoundary
        .selectedRepositoryProjectionSha256,
  };
  await writeCanonical(
    join(copy.neighborRoot, "completion.json"),
    completion,
  );
}

async function rebindResponseAndCompletion(
  neighborRoot: string,
  captureDirectory: string,
): Promise<void> {
  const capturePath = join(captureDirectory, "capture.json");
  const capture = await readJson(capturePath);
  capture.response.body = artifactReference(
    "response.json",
    await readFile(join(captureDirectory, "response.json")),
  );
  await writeCanonical(capturePath, capture);
  await rebindCompletionCapture(neighborRoot, captureDirectory);
}

async function rebindCompletionCapture(
  neighborRoot: string,
  captureDirectory: string,
): Promise<void> {
  const completionPath = join(neighborRoot, "completion.json");
  const completion = await readJson(completionPath);
  const directory = basename(captureDirectory);
  const completionCapture = completion.captures.find(
    (capture: Record<string, unknown>) =>
      capture.captureDirectory === directory,
  );
  if (completionCapture === undefined) {
    throw new Error(`missing completion capture ${directory}`);
  }
  completionCapture.captureManifest = artifactReference(
    `${directory}/capture.json`,
    await readFile(join(captureDirectory, "capture.json")),
  );
  await writeCanonical(completionPath, completion);
}

async function firstCapture(neighborRoot: string): Promise<string> {
  const entries = await readdir(neighborRoot, {
    withFileTypes: true,
  });
  const directory = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()[0];
  if (directory === undefined) {
    throw new Error("missing continuation capture directory");
  }
  return join(neighborRoot, directory);
}

function selectedRepositoryProjection(
  target: Record<string, unknown>,
): unknown {
  return {
    pilotRank: target.pilotRank,
    sourceSplit: target.sourceSplit,
    withinSplitRank: target.withinSplitRank,
    canonicalRepository: target.canonicalRepository,
    seedCaptureOrder: target.seedCaptureOrder,
    seedAnchorId: target.seedAnchorId,
  };
}

function artifactReference(path: string, bytes: Uint8Array) {
  return {
    bytes: bytes.byteLength,
    path,
    sha256: sha256(bytes),
  };
}

async function readJson(path: string): Promise<any> {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeCanonical(
  path: string,
  value: unknown,
): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
