import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import {
  captureC6LiveMultiLangNeighborCensus,
  C6_LIVE_MULTILANG_NEIGHBOR_CENSUS_QUERY,
} from "../../scripts/codex-coding-effect/c6-live-multilang-neighbor-census-capture";
import {
  buildC6AssetLock,
} from "../../scripts/codex-coding-effect/c6-asset-lock";
import {
  parseC6LiveMultiLangNeighborCensusCaptureCliOptions,
  runC6LiveMultiLangNeighborCensusCaptureCommand,
} from "../../scripts/capture-codex-coding-effect-c6-live-multilang-neighbor-census";

const PLAN_FIXTURE =
  "fixtures/codex-coding-effect/c6-source-pool/" +
  "swe-bench-live-multilang-608f7ae9.neighbor-census-plan-v1.json";
const CONTINUATION_PLAN_FIXTURE =
  "fixtures/codex-coding-effect/c6-source-pool/" +
  "swe-bench-live-multilang-608f7ae9.neighbor-census-plan-v2.json";
const PRIOR_PLAN_SHA256 =
  "1b07d57ebc5601b9ab7f6742fdb5da91b9181784d7b2a33bf28ad318fa2e10f1";
const PRIOR_SELECTED_REPOSITORY_PROJECTION_SHA256 =
  "dee7643fa9693c4b43cb56f985d7cf7aded9ed4de3c8fc6c62c0def428a0fe0e";
const TOKEN = "neighbor-census-token-that-must-never-persist";

describe("Codex coding-effect C6 Live/MultiLang neighbor census capture", () => {
  it("captures 64 frozen targets in order with metadata-only requests", async () => {
    const workspace = await createWorkspace();
    try {
      const plan = JSON.parse(workspace.planBytes.toString("utf8")) as {
        targets: Array<{
          canonicalRepository: string;
          owner: string;
          pilotRank: number;
          repo: string;
        }>;
      };
      const observed: Array<{
        authorization: string;
        body: {
          query: string;
          variables: {
            limit: number;
            name: string;
            owner: string;
          };
        };
      }> = [];
      const rawResponses = new Map<string, Buffer>();
      const result = await captureC6LiveMultiLangNeighborCensus({
        expectedPlanSha256: sha256(workspace.planBytes),
        fetchImpl: async (_url, init) => {
          const body = JSON.parse(String(init.body)) as
            (typeof observed)[number]["body"];
          observed.push({
            authorization: (
              init.headers as Record<string, string>
            ).authorization,
            body,
          });
          const responseBytes = Buffer.from(JSON.stringify(
            buildResponse(body.variables.owner, body.variables.name),
          ));
          rawResponses.set(
            `${body.variables.owner}/${body.variables.name}`,
            responseBytes,
          );
          return graphqlResponse(responseBytes);
        },
        outputRoot: workspace.outputRoot,
        planPath: workspace.planPath,
        token: TOKEN,
      });

      expect(observed).toHaveLength(64);
      expect(observed.map(({ body }) => ({
        limit: body.variables.limit,
        repository:
          `${body.variables.owner}/${body.variables.name}`,
      }))).toEqual(plan.targets.map((target) => ({
        limit: 16,
        repository: target.canonicalRepository,
      })));
      expect(
        observed.every(({ authorization }) =>
          authorization === `Bearer ${TOKEN}`
        ),
      ).toBe(true);
      expect(C6_LIVE_MULTILANG_NEIGHBOR_CENSUS_QUERY).toContain(
        "pullRequests(first: $limit, states: [MERGED], orderBy: {field: CREATED_AT, direction: DESC})",
      );
      for (const forbidden of [
        "title",
        "body",
        "diff",
        "files",
        "checks",
        "test",
        "gold",
        "outcome",
      ]) {
        expect(
          C6_LIVE_MULTILANG_NEIGHBOR_CENSUS_QUERY.toLowerCase(),
        ).not.toContain(forbidden);
      }
      for (const required of [
        "nameWithOwner",
        "number",
        "url",
        "createdAt",
        "mergedAt",
        "baseRefOid",
        "mergeCommit",
        "author",
        "reviews",
        "reviewThreads",
        "comments",
        "totalCount",
      ]) {
        expect(C6_LIVE_MULTILANG_NEIGHBOR_CENSUS_QUERY).toContain(
          required,
        );
      }

      expect(result.completion.boundary).toEqual({
        acceptedEpisodeCount: 0,
        actorQualifiedEpisodeCount: 0,
        candidateManifestFrozen: false,
        codexRunReady: false,
        machineQualifiedEpisodeCount: 0,
        semanticallyQualifiedEpisodeCount: 0,
        status: "merged-pr-metadata-census-complete-raw-anchors-only",
      });
      expect(result.completion.counts).toEqual({
        capturedRawAnchorCount: 128,
        completedRepositoryCount: 64,
        maximumRawAnchorCount: 1024,
        truncatedRepositoryCount: 0,
      });
      expect(result.completionSha256).toBe(
        "64244221039bbab3e21b5a45f79264dac334ad0827c4e078d4205d1fdb0a97ea",
      );
      expect(result.assetRootSha256).toBe(
        (await buildC6AssetLock(workspace.outputRoot))
          .assetRootSha256,
      );
      const first = result.completion.captures[0]!;
      expect((await readFile(
        join(workspace.outputRoot, first.captureDirectory, "response.json"),
      )).toString("utf8")).toBe(
        rawResponses.get(first.canonicalRepository)!.toString("utf8"),
      );
      const persistedRequest = JSON.parse(await readFile(
        join(workspace.outputRoot, first.captureDirectory, "request.json"),
        "utf8",
      )) as Record<string, unknown>;
      expect(persistedRequest).toMatchObject({
        endpoint: "https://api.github.com/graphql",
        headers: {
          authorization: "Bearer [REDACTED]",
        },
        method: "POST",
      });
      expect(persistedRequest).not.toHaveProperty("token");
      for (const path of await listFiles(workspace.outputRoot)) {
        expect(await readFile(path, "utf8")).not.toContain(TOKEN);
      }
      expect(result.completion.captures.map((capture) =>
        capture.pilotRank
      )).toEqual(Array.from({ length: 64 }, (_, index) => index + 1));
      const firstCapture = JSON.parse(await readFile(
        join(workspace.outputRoot, first.captureDirectory, "capture.json"),
        "utf8",
      )) as Record<string, unknown>;
      expect(firstCapture.schemaVersion).toBe(1);
      expect(firstCapture).not.toHaveProperty("plan");
      expect(Object.keys(result.completion.plan).sort()).toEqual([
        "bytes",
        "path",
        "selectedRepositoryProjectionSha256",
        "sha256",
      ]);
    } finally {
      await workspace.remove();
    }
  });

  it("captures continuation plan schema v2 ranks 9 through 16 with explicit prior-plan bindings", async () => {
    const workspace = await createWorkspace(
      CONTINUATION_PLAN_FIXTURE,
    );
    try {
      const plan = JSON.parse(workspace.planBytes.toString("utf8")) as {
        independenceBoundary: {
          selectedRepositoryProjectionSha256: string;
        };
        targets: Array<{
          canonicalRepository: string;
          pilotRank: number;
          sourceSplit: string;
          withinSplitRank: number;
        }>;
      };
      let calls = 0;
      let publishedHookAssetRootSha256: string | undefined;
      const result = await captureC6LiveMultiLangNeighborCensus({
        expectedPlanSchemaVersion: 2,
        expectedPlanSha256: sha256(workspace.planBytes),
        expectedPriorPlanSha256: PRIOR_PLAN_SHA256,
        expectedPriorSelectedRepositoryProjectionSha256:
          PRIOR_SELECTED_REPOSITORY_PROJECTION_SHA256,
        fetchImpl: async (_url, init) => {
          calls += 1;
          const variables = requestVariables(init);
          return graphqlResponse(JSON.stringify(
            buildResponse(variables.owner, variables.name),
          ));
        },
        outputRoot: workspace.outputRoot,
        planPath: workspace.planPath,
        priorPlanPath: workspace.priorPlanPath,
        testHooks: {
          beforePublishedVerification: async (publishedRoot) => {
            publishedHookAssetRootSha256 = (
              await buildC6AssetLock(publishedRoot)
            ).assetRootSha256;
          },
        },
        token: TOKEN,
      });

      expect(calls).toBe(64);
      expect(plan.targets.map((target) => ({
        pilotRank: target.pilotRank,
        sourceSplit: target.sourceSplit,
        withinSplitRank: target.withinSplitRank,
      }))).toEqual(Array.from({ length: 64 }, (_, index) => ({
        pilotRank: index + 1,
        sourceSplit:
          ["c", "cpp", "go", "js", "rust", "java", "ts", "cs"][
            index % 8
          ],
        withinSplitRank: Math.floor(index / 8) + 9,
      })));
      expect(result.completion.schemaVersion).toBe(2);
      expect(result.assetRootSha256).toBe(
        (await buildC6AssetLock(workspace.outputRoot))
          .assetRootSha256,
      );
      expect(publishedHookAssetRootSha256).toBe(
        result.assetRootSha256,
      );
      expect(result.completion.counts).toEqual({
        capturedRawAnchorCount: 128,
        completedRepositoryCount: 64,
        maximumRawAnchorCount: 1024,
        truncatedRepositoryCount: 0,
      });
      expect(result.completion.plan).toMatchObject({
        artifactKind: "c6-live-multilang-neighbor-census-plan",
        priorPlan: {
          artifactKind:
            "c6-live-multilang-neighbor-census-plan",
          schemaVersion: 1,
          selectedRepositoryProjectionSha256:
            PRIOR_SELECTED_REPOSITORY_PROJECTION_SHA256,
          sha256: PRIOR_PLAN_SHA256,
        },
        schemaVersion: 2,
        selectedRepositoryProjectionSha256:
          plan.independenceBoundary
            .selectedRepositoryProjectionSha256,
        sha256: sha256(workspace.planBytes),
      });
      const first = result.completion.captures[0]!;
      const capture = JSON.parse(await readFile(
        join(workspace.outputRoot, first.captureDirectory, "capture.json"),
        "utf8",
      )) as Record<string, unknown>;
      expect(capture).toMatchObject({
        boundary: {
          acceptedEpisodeCount: 0,
          actorQualifiedEpisodeCount: 0,
          candidateManifestFrozen: false,
          codexRunReady: false,
          machineQualifiedEpisodeCount: 0,
          semanticallyQualifiedEpisodeCount: 0,
        },
        plan: {
          artifactKind:
            "c6-live-multilang-neighbor-census-plan",
          priorPlan: {
            schemaVersion: 1,
            sha256: PRIOR_PLAN_SHA256,
          },
          schemaVersion: 2,
          sha256: sha256(workspace.planBytes),
        },
        schemaVersion: 2,
      });
      for (const path of await listFiles(workspace.outputRoot)) {
        expect(await readFile(path, "utf8")).not.toContain(TOKEN);
      }
      expect((await stat(workspace.outputRoot)).mode & 0o777).toBe(
        0o700,
      );
      expect((await stat(join(
        workspace.outputRoot,
        first.captureDirectory,
        "response.json",
      ))).mode & 0o777).toBe(0o600);
      expect((await stat(join(
        workspace.outputRoot,
        "completion.json",
      ))).mode & 0o777).toBe(0o600);
      await expectNoCaptureResidue(
        workspace.root,
        workspace.outputRoot,
        true,
      );
    } finally {
      await workspace.remove();
    }
  });

  it("requires continuation plan schema and prior-plan bindings before any call", async () => {
    const workspace = await createWorkspace(
      CONTINUATION_PLAN_FIXTURE,
    );
    try {
      let calls = 0;
      await expect(captureC6LiveMultiLangNeighborCensus({
        expectedPlanSchemaVersion: 2,
        expectedPlanSha256: sha256(workspace.planBytes),
        expectedPriorPlanSha256: "f".repeat(64),
        expectedPriorSelectedRepositoryProjectionSha256:
          PRIOR_SELECTED_REPOSITORY_PROJECTION_SHA256,
        fetchImpl: async () => {
          calls += 1;
          return new Response();
        },
        outputRoot: workspace.outputRoot,
        planPath: workspace.planPath,
        priorPlanPath: workspace.priorPlanPath,
        token: TOKEN,
      })).rejects.toThrow("prior-plan hash mismatch");
      expect(calls).toBe(0);
    } finally {
      await workspace.remove();
    }
  });

  it("rejects continuation boundary, tranche ceiling, and rank drift before any call", async () => {
    await expectContinuationPlanFailure((plan) => {
      plan.boundary.actorQualifiedEpisodeCount = 1;
    });
    await expectContinuationPlanFailure((plan) => {
      plan.counts.trancheCensusCandidateCeiling = 1_023;
    });
    await expectContinuationPlanFailure((plan) => {
      plan.targets[0]!.withinSplitRank = 10;
    });
  });

  it("rejects forbidden and unknown continuation-plan keys recursively before any call", async () => {
    await expectContinuationPlanFailure(
      (plan) => {
        plan.gold = { hidden: true };
      },
      "forbidden selection input",
    );
    await expectContinuationPlanFailure(
      (plan) => {
        plan.inputs.priorNeighborPlan.gold = "hidden";
      },
      "forbidden selection input",
    );
    await expectContinuationPlanFailure(
      (plan) => {
        plan.counts.unexpectedNestedCount = 0;
      },
      "Unrecognized key",
    );
  });

  it("independently reads the prior plan and rejects tranche overlap and forged prior metadata", async () => {
    await expectContinuationPlanFailure(
      (plan, workspace) => {
        const priorPlan = JSON.parse(
          workspace.priorPlanBytes.toString("utf8"),
        ) as MutablePriorPlan;
        const priorTarget = priorPlan.targets[0]!;
        const target = plan.targets[0]!;
        target.canonicalRepository =
          priorTarget.canonicalRepository;
        target.owner = priorTarget.owner;
        target.repo = priorTarget.repo;
        plan.independenceBoundary
          .selectedRepositoryProjectionSha256 = sha256(
            JSON.stringify(plan.targets.map(
              selectedRepositoryProjection,
            )),
          );
      },
      "overlaps prior plan",
    );
    await expectContinuationPlanFailure(
      (plan) => {
        plan.inputs.priorNeighborPlan.bytes += 1;
      },
      "prior-plan byte-length mismatch",
    );
    await expectContinuationPlanFailure(
      (plan) => {
        plan.inputs.priorNeighborPlan.path = "forged-plan-v1.json";
      },
      "prior-plan path mismatch",
    );
  });

  it("rejects semantically hidden prior-plan fields after every hash is rebound", async () => {
    const forbiddenRootKeys = [
      "goldPatchSha256",
      "GOLDPATCHSHA256",
      "goldpatchsha256",
      "hiddenTests",
      "HIDDENTESTS",
      "hiddentests",
      "evaluatorMetadata",
      "EVALUATORMETADATA",
      "evaluatormetadata",
      "expectedChangedFiles",
      "FILES",
      "files",
      "GOLDINPUT",
      "goldinput",
      "MACHINEOUTCOMEINPUT",
      "machineoutcomeinput",
      "PATCHINPUT",
      "patchinput",
      "TESTINPUT",
      "testinput",
    ] as const;
    const forbiddenMutations: Array<readonly [
      string,
      (
        plan: MutablePriorPlan & Record<string, unknown>,
      ) => void,
    ]> = forbiddenRootKeys.map((key) => [
      `$.${key}`,
      (plan) => {
        plan[key] = "forbidden";
      },
    ]);
    forbiddenMutations.push(
      ["$.independenceBoundary.goldInput", (plan) => {
        plan.independenceBoundary.goldInput = true;
      }],
      ["$.independenceBoundary.goldInput", (plan) => {
        plan["independenceBoundary.goldInput"] = false;
      }],
    );
    for (const [forbiddenPath, mutate] of forbiddenMutations) {
      const workspace = await createWorkspace(
        CONTINUATION_PLAN_FIXTURE,
      );
      try {
        const priorPlan = JSON.parse(
          workspace.priorPlanBytes.toString("utf8"),
        ) as MutablePriorPlan & Record<string, unknown>;
        mutate(priorPlan);
        const priorPlanBytes = Buffer.from(
          `${JSON.stringify(priorPlan, null, 2)}\n`,
        );
        const priorPlanSha256 = sha256(priorPlanBytes);
        await writeFile(workspace.priorPlanPath, priorPlanBytes);

        const plan = JSON.parse(
          workspace.planBytes.toString("utf8"),
        ) as MutableContinuationPlan;
        plan.inputs.priorNeighborPlan.bytes =
          priorPlanBytes.byteLength;
        plan.inputs.priorNeighborPlan.sha256 =
          priorPlanSha256;
        plan.independenceBoundary.priorNeighborPlanSha256 =
          priorPlanSha256;
        const planBytes = Buffer.from(
          `${JSON.stringify(plan, null, 2)}\n`,
        );
        await writeFile(workspace.planPath, planBytes);
        let calls = 0;
        await expect(captureC6LiveMultiLangNeighborCensus({
          expectedPlanSchemaVersion: 2,
          expectedPlanSha256: sha256(planBytes),
          expectedPriorPlanSha256: priorPlanSha256,
          expectedPriorSelectedRepositoryProjectionSha256:
            PRIOR_SELECTED_REPOSITORY_PROJECTION_SHA256,
          fetchImpl: async () => {
            calls += 1;
            return new Response();
          },
          outputRoot: workspace.outputRoot,
          planPath: workspace.planPath,
          priorPlanPath: workspace.priorPlanPath,
          token: TOKEN,
        })).rejects.toThrow(
          "forbidden selection input prior plan " +
            forbiddenPath,
        );
        expect(calls).toBe(0);
        await expectNoCaptureResidue(
          workspace.root,
          workspace.outputRoot,
        );
      } finally {
        await workspace.remove();
      }
    }
  });

  it("strictly rejects arbitrary prior-plan keys without semantic false positives", async () => {
    const unknownMutations: Array<
      (plan: MutablePriorPlan & Record<string, unknown>) => void
    > = [
      (plan) => {
        plan.oracleData = { solution: "hidden" };
      },
      (plan) => {
        plan.counts.oracleData = { solution: "hidden" };
      },
      (plan) => {
        plan.latest = "stable";
        plan.dispatchMetadata = "stable";
        plan.checksum = "stable";
      },
    ];
    for (const mutate of unknownMutations) {
      const workspace = await createWorkspace(
        CONTINUATION_PLAN_FIXTURE,
      );
      try {
        const priorPlan = JSON.parse(
          workspace.priorPlanBytes.toString("utf8"),
        ) as MutablePriorPlan & Record<string, unknown>;
        mutate(priorPlan);
        const priorPlanBytes = Buffer.from(
          `${JSON.stringify(priorPlan, null, 2)}\n`,
        );
        const priorPlanSha256 = sha256(priorPlanBytes);
        await writeFile(workspace.priorPlanPath, priorPlanBytes);

        const plan = JSON.parse(
          workspace.planBytes.toString("utf8"),
        ) as MutableContinuationPlan;
        plan.inputs.priorNeighborPlan.bytes =
          priorPlanBytes.byteLength;
        plan.inputs.priorNeighborPlan.sha256 =
          priorPlanSha256;
        plan.independenceBoundary.priorNeighborPlanSha256 =
          priorPlanSha256;
        const planBytes = Buffer.from(
          `${JSON.stringify(plan, null, 2)}\n`,
        );
        await writeFile(workspace.planPath, planBytes);
        let calls = 0;
        let rejection: unknown;
        try {
          await captureC6LiveMultiLangNeighborCensus({
            expectedPlanSchemaVersion: 2,
            expectedPlanSha256: sha256(planBytes),
            expectedPriorPlanSha256: priorPlanSha256,
            expectedPriorSelectedRepositoryProjectionSha256:
              PRIOR_SELECTED_REPOSITORY_PROJECTION_SHA256,
            fetchImpl: async () => {
              calls += 1;
              return new Response();
            },
            outputRoot: workspace.outputRoot,
            planPath: workspace.planPath,
            priorPlanPath: workspace.priorPlanPath,
            token: TOKEN,
          });
        } catch (error) {
          rejection = error;
        }
        expect(rejection).toBeInstanceOf(Error);
        expect((rejection as Error).message).not.toContain(
          "forbidden selection input",
        );
        expect(calls).toBe(0);
        await expectNoCaptureResidue(
          workspace.root,
          workspace.outputRoot,
        );
      } finally {
        await workspace.remove();
      }
    }
  });

  it("rejects an independently read prior plan with invalid ranks before any call", async () => {
    const workspace = await createWorkspace(
      CONTINUATION_PLAN_FIXTURE,
    );
    try {
      const priorPlan = JSON.parse(
        workspace.priorPlanBytes.toString("utf8"),
      ) as MutablePriorPlan;
      priorPlan.targets[0]!.pilotRank = 2;
      priorPlan.independenceBoundary
        .selectedRepositoryProjectionSha256 = sha256(
          JSON.stringify(priorPlan.targets.map(
            selectedRepositoryProjection,
          )),
        );
      const priorPlanBytes = Buffer.from(
        `${JSON.stringify(priorPlan, null, 2)}\n`,
      );
      await writeFile(workspace.priorPlanPath, priorPlanBytes);

      const plan = JSON.parse(
        workspace.planBytes.toString("utf8"),
      ) as MutableContinuationPlan;
      const priorPlanSha256 = sha256(priorPlanBytes);
      const priorProjectionSha256 =
        priorPlan.independenceBoundary
          .selectedRepositoryProjectionSha256;
      plan.inputs.priorNeighborPlan.bytes =
        priorPlanBytes.byteLength;
      plan.inputs.priorNeighborPlan.sha256 = priorPlanSha256;
      plan.inputs.priorNeighborPlan
        .selectedRepositoryProjectionSha256 =
          priorProjectionSha256;
      plan.independenceBoundary.priorNeighborPlanSha256 =
        priorPlanSha256;
      plan.independenceBoundary
        .priorSelectedRepositoryProjectionSha256 =
          priorProjectionSha256;
      const planBytes = Buffer.from(
        `${JSON.stringify(plan, null, 2)}\n`,
      );
      await writeFile(workspace.planPath, planBytes);
      let calls = 0;
      await expect(captureC6LiveMultiLangNeighborCensus({
        expectedPlanSchemaVersion: 2,
        expectedPlanSha256: sha256(planBytes),
        expectedPriorPlanSha256: priorPlanSha256,
        expectedPriorSelectedRepositoryProjectionSha256:
          priorProjectionSha256,
        fetchImpl: async () => {
          calls += 1;
          return new Response();
        },
        outputRoot: workspace.outputRoot,
        planPath: workspace.planPath,
        priorPlanPath: workspace.priorPlanPath,
        token: TOKEN,
      })).rejects.toThrow("target order mismatch");
      expect(calls).toBe(0);
      await expectNoCaptureResidue(
        workspace.root,
        workspace.outputRoot,
      );
    } finally {
      await workspace.remove();
    }
  });

  it("fails closed on prepublication and postpublication tree mutation without residue", async () => {
    const cases: Array<{
      expected: string;
      inject: (root: string) => Promise<void>;
      stage: "postpublication" | "prepublication";
    }> = [{
      expected: "unexpected file asset-lock.json",
      inject: async (root) => {
        await writeFile(join(root, "asset-lock.json"), "{}\n");
      },
      stage: "prepublication",
    }, {
      expected: "content mismatch",
      inject: async (root) => {
        await writeFile(
          join(root, "001__rsyslog__rsyslog", "response.json"),
          "{}",
        );
      },
      stage: "postpublication",
    }, {
      expected: "mode mismatch",
      inject: async (root) => {
        await chmod(
          join(root, "001__rsyslog__rsyslog", "response.json"),
          0o644,
        );
      },
      stage: "prepublication",
    }, {
      expected: "unexpected directory terminal-extra",
      inject: async (root) => {
        await mkdir(join(root, "terminal-extra"));
      },
      stage: "postpublication",
    }, {
      expected: "rejects symlink",
      inject: async (root) => {
        await symlink(
          "response.json",
          join(
            root,
            "001__rsyslog__rsyslog",
            "terminal-response-link.json",
          ),
        );
      },
      stage: "postpublication",
    }];

    for (const testCase of cases) {
      const workspace = await createWorkspace(
        CONTINUATION_PLAN_FIXTURE,
      );
      try {
        await expect(captureC6LiveMultiLangNeighborCensus({
          expectedPlanSchemaVersion: 2,
          expectedPlanSha256: sha256(workspace.planBytes),
          expectedPriorPlanSha256: PRIOR_PLAN_SHA256,
          expectedPriorSelectedRepositoryProjectionSha256:
            PRIOR_SELECTED_REPOSITORY_PROJECTION_SHA256,
          fetchImpl: successfulFetch,
          outputRoot: workspace.outputRoot,
          planPath: workspace.planPath,
          priorPlanPath: workspace.priorPlanPath,
          testHooks: testCase.stage === "prepublication"
            ? {
              beforePrepublicationVerification: testCase.inject,
            }
            : {
              beforePublishedVerification: testCase.inject,
            },
          token: TOKEN,
        })).rejects.toThrow(testCase.expected);
        await expectNoCaptureResidue(
          workspace.root,
          workspace.outputRoot,
        );
      } finally {
        await workspace.remove();
      }
    }
  });

  it("rejects HTTP 201 provenance and removes every partial capture", async () => {
    const workspace = await createWorkspace(
      CONTINUATION_PLAN_FIXTURE,
    );
    try {
      let calls = 0;
      await expect(captureC6LiveMultiLangNeighborCensus({
        expectedPlanSchemaVersion: 2,
        expectedPlanSha256: sha256(workspace.planBytes),
        expectedPriorPlanSha256: PRIOR_PLAN_SHA256,
        expectedPriorSelectedRepositoryProjectionSha256:
          PRIOR_SELECTED_REPOSITORY_PROJECTION_SHA256,
        fetchImpl: async (_url, init) => {
          calls += 1;
          const variables = requestVariables(init);
          return graphqlResponse(JSON.stringify(
            buildResponse(variables.owner, variables.name),
          ), 201);
        },
        outputRoot: workspace.outputRoot,
        planPath: workspace.planPath,
        priorPlanPath: workspace.priorPlanPath,
        token: TOKEN,
      })).rejects.toThrow("unexpected HTTP status 201");
      expect(calls).toBe(1);
      await expectNoCaptureResidue(
        workspace.root,
        workspace.outputRoot,
      );
    } finally {
      await workspace.remove();
    }
  });

  it("terminally re-reads the prior plan and removes the failed capture", async () => {
    const workspace = await createWorkspace(
      CONTINUATION_PLAN_FIXTURE,
    );
    try {
      let calls = 0;
      await expect(captureC6LiveMultiLangNeighborCensus({
        expectedPlanSchemaVersion: 2,
        expectedPlanSha256: sha256(workspace.planBytes),
        expectedPriorPlanSha256: PRIOR_PLAN_SHA256,
        expectedPriorSelectedRepositoryProjectionSha256:
          PRIOR_SELECTED_REPOSITORY_PROJECTION_SHA256,
        fetchImpl: async (url, init) => {
          calls += 1;
          if (calls === 1) {
            await writeFile(
              workspace.priorPlanPath,
              Buffer.concat([
                workspace.priorPlanBytes,
                Buffer.from(" "),
              ]),
            );
          }
          return successfulFetch(url, init);
        },
        outputRoot: workspace.outputRoot,
        planPath: workspace.planPath,
        priorPlanPath: workspace.priorPlanPath,
        token: TOKEN,
      })).rejects.toThrow("prior plan changed during capture");
      expect(calls).toBe(64);
      await expectNoCaptureResidue(
        workspace.root,
        workspace.outputRoot,
      );
    } finally {
      await workspace.remove();
    }
  });

  it("fails on GraphQL errors and repository identity drift", async () => {
    await expectFailure(
      async () => graphqlResponse(JSON.stringify({
        data: null,
        errors: [{ message: "failed" }],
      })),
      "returned GraphQL errors",
    );
    await expectFailure(async (_url, init) => {
      const variables = requestVariables(init);
      return graphqlResponse(JSON.stringify(
        buildResponse("other-owner", variables.name),
      ));
    }, "repository identity mismatch");
  });

  it("fails on response order, duplicate PRs, and pagination boundary drift", async () => {
    await expectFailure(async (_url, init) => {
      const variables = requestVariables(init);
      const response = buildResponse(variables.owner, variables.name);
      response.data.repository.pullRequests.nodes.reverse();
      return graphqlResponse(JSON.stringify(response));
    }, "CREATED_AT DESC");
    await expectFailure(async (_url, init) => {
      const variables = requestVariables(init);
      const response = buildResponse(variables.owner, variables.name);
      response.data.repository.pullRequests.nodes[1] =
        response.data.repository.pullRequests.nodes[0]!;
      return graphqlResponse(JSON.stringify(response));
    }, "duplicate pull request");
    await expectFailure(async (_url, init) => {
      const variables = requestVariables(init);
      const response = buildResponse(variables.owner, variables.name);
      response.data.repository.pullRequests.totalCount = 17;
      return graphqlResponse(JSON.stringify(response));
    }, "pagination boundary mismatch");
  });

  it("accepts exactly 16 newest raw anchors when the merged history is truncated", async () => {
    const workspace = await createWorkspace();
    try {
      let calls = 0;
      const result = await captureC6LiveMultiLangNeighborCensus({
        expectedPlanSha256: sha256(workspace.planBytes),
        fetchImpl: async (_url, init) => {
          calls += 1;
          const variables = requestVariables(init);
          if (calls !== 1) {
            return graphqlResponse(JSON.stringify(
              buildResponse(variables.owner, variables.name),
            ));
          }
          const response = buildResponse(
            variables.owner,
            variables.name,
          );
          response.data.repository.pullRequests.nodes =
            Array.from({ length: 16 }, (_, index) =>
              pull(
                `${variables.owner}/${variables.name}`,
                100 - index,
                `2026-07-${String(25 - index).padStart(2, "0")}T12:00:00Z`,
                index % 2 === 0 ? "a" : "c",
              )
            );
          response.data.repository.pullRequests.totalCount = 17;
          response.data.repository.pullRequests.pageInfo = {
            endCursor: "cursor-85",
            hasNextPage: true,
          };
          return graphqlResponse(JSON.stringify(response));
        },
        outputRoot: workspace.outputRoot,
        planPath: workspace.planPath,
        token: TOKEN,
      });

      expect(result.completion.counts).toEqual({
        capturedRawAnchorCount: 142,
        completedRepositoryCount: 64,
        maximumRawAnchorCount: 1024,
        truncatedRepositoryCount: 1,
      });
      expect(result.completion.captures[0]).toMatchObject({
        hasNextPage: true,
        rawAnchorCount: 16,
      });
    } finally {
      await workspace.remove();
    }
  });

  it("refuses token reflection before persisting a repository response", async () => {
    await expectFailure(async (_url, init) => {
      const variables = requestVariables(init);
      return graphqlResponse(JSON.stringify({
        ...buildResponse(variables.owner, variables.name),
        reflectedToken: TOKEN,
      }));
    }, "refuses to persist the GitHub token");
  });

  it("detects plan drift after all network calls and omits completion", async () => {
    const workspace = await createWorkspace();
    try {
      let calls = 0;
      await expect(captureC6LiveMultiLangNeighborCensus({
        expectedPlanSha256: sha256(workspace.planBytes),
        fetchImpl: async (_url, init) => {
          calls += 1;
          if (calls === 1) {
            await writeFile(
              workspace.planPath,
              Buffer.concat([workspace.planBytes, Buffer.from(" ")]),
            );
          }
          const variables = requestVariables(init);
          return graphqlResponse(JSON.stringify(
            buildResponse(variables.owner, variables.name),
          ));
        },
        outputRoot: workspace.outputRoot,
        planPath: workspace.planPath,
        token: TOKEN,
      })).rejects.toThrow("plan changed during capture");
      expect(calls).toBe(64);
      await expect(
        readFile(join(workspace.outputRoot, "completion.json")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await workspace.remove();
    }
  });

  it("validates the exact frozen cap before any call and rejects symlinked output parents", async () => {
    const workspace = await createWorkspace();
    try {
      const mutated = JSON.parse(workspace.planBytes.toString("utf8")) as {
        targets: Array<{ censusCap: number }>;
      };
      mutated.targets[0]!.censusCap = 15;
      const mutatedBytes = Buffer.from(
        `${JSON.stringify(mutated, null, 2)}\n`,
      );
      await writeFile(workspace.planPath, mutatedBytes);
      let calls = 0;
      await expect(captureC6LiveMultiLangNeighborCensus({
        expectedPlanSha256: sha256(mutatedBytes),
        fetchImpl: async () => {
          calls += 1;
          return new Response();
        },
        outputRoot: workspace.outputRoot,
        planPath: workspace.planPath,
        token: TOKEN,
      })).rejects.toThrow("censusCap");
      expect(calls).toBe(0);

      const realOutputParent = join(workspace.root, "real-output");
      const linkedOutputParent = join(workspace.root, "linked-output");
      await mkdir(realOutputParent);
      await writeFile(join(realOutputParent, ".keep"), "");
      await symlink(realOutputParent, linkedOutputParent);
      await writeFile(workspace.planPath, workspace.planBytes);
      await expect(captureC6LiveMultiLangNeighborCensus({
        expectedPlanSha256: sha256(workspace.planBytes),
        fetchImpl: async () => new Response(),
        outputRoot: join(linkedOutputParent, "capture"),
        planPath: workspace.planPath,
        token: TOKEN,
      })).rejects.toThrow("rejects symlink path component");
    } finally {
      await workspace.remove();
    }
  });

  it("accepts tokens only through GITHUB_TOKEN at the CLI boundary", async () => {
    const hash = "a".repeat(64);
    expect(() =>
      parseC6LiveMultiLangNeighborCensusCaptureCliOptions([
        "--plan=plan.json",
        `--expected-plan-sha256=${hash}`,
        "--output-root=/evidence/census",
        "--token=forbidden",
      ])
    ).toThrow("unknown C6 neighbor census capture option --token");

    let calls = 0;
    await expect(
      runC6LiveMultiLangNeighborCensusCaptureCommand([
        "--plan=plan.json",
        `--expected-plan-sha256=${hash}`,
        "--output-root=/evidence/census",
      ], {
        env: {},
        fetchImpl: async () => {
          calls += 1;
          return new Response();
        },
      }),
    ).rejects.toThrow("GITHUB_TOKEN is required");
    expect(calls).toBe(0);
    expect(
      parseC6LiveMultiLangNeighborCensusCaptureCliOptions([
        "--plan=plan.json",
        `--expected-plan-sha256=${hash}`,
        "--output-root=/evidence/census",
      ]),
    ).toEqual({
      expectedPlanSha256: hash,
      outputRoot: "/evidence/census",
      plan: "plan.json",
    });

    expect(() =>
      parseC6LiveMultiLangNeighborCensusCaptureCliOptions([
        "--plan=plan-v2.json",
        `--expected-plan-sha256=${hash}`,
        "--expected-plan-schema-version=2",
        "--prior-plan=plan-v1.json",
        "--output-root=/evidence/census-v2",
      ])
    ).toThrow("--expected-prior-plan-sha256 is required");

    expect(() =>
      parseC6LiveMultiLangNeighborCensusCaptureCliOptions([
        "--plan=plan-v2.json",
        `--expected-plan-sha256=${hash}`,
        "--expected-plan-schema-version=2",
        `--expected-prior-plan-sha256=${PRIOR_PLAN_SHA256}`,
        `--expected-prior-selected-repository-projection-sha256=${PRIOR_SELECTED_REPOSITORY_PROJECTION_SHA256}`,
        "--output-root=/evidence/census-v2",
      ])
    ).toThrow("--prior-plan is required exactly once");

    const priorPlan =
      "swe-bench-live-multilang-608f7ae9.neighbor-census-plan-v1.json";
    expect(
      parseC6LiveMultiLangNeighborCensusCaptureCliOptions([
        "--plan=plan-v2.json",
        `--expected-plan-sha256=${hash}`,
        "--expected-plan-schema-version=2",
        `--expected-prior-plan-sha256=${PRIOR_PLAN_SHA256}`,
        `--expected-prior-selected-repository-projection-sha256=${PRIOR_SELECTED_REPOSITORY_PROJECTION_SHA256}`,
        `--prior-plan=${priorPlan}`,
        "--output-root=/evidence/census-v2",
      ]),
    ).toEqual({
      expectedPlanSchemaVersion: 2,
      expectedPlanSha256: hash,
      expectedPriorPlanSha256: PRIOR_PLAN_SHA256,
      expectedPriorSelectedRepositoryProjectionSha256:
        PRIOR_SELECTED_REPOSITORY_PROJECTION_SHA256,
      outputRoot: "/evidence/census-v2",
      plan: "plan-v2.json",
      priorPlan,
    });
  });

  it("returns the terminal asset root through the CLI runner", async () => {
    const workspace = await createWorkspace();
    try {
      const result =
        await runC6LiveMultiLangNeighborCensusCaptureCommand([
          `--plan=${workspace.planPath}`,
          `--expected-plan-sha256=${sha256(workspace.planBytes)}`,
          `--output-root=${workspace.outputRoot}`,
        ], {
          env: { GITHUB_TOKEN: TOKEN },
          fetchImpl: successfulFetch,
        });
      expect(result.assetRootSha256).toBe(
        (await buildC6AssetLock(workspace.outputRoot))
          .assetRootSha256,
      );
      expect(result.completionSha256).toBe(
        "64244221039bbab3e21b5a45f79264dac334ad0827c4e078d4205d1fdb0a97ea",
      );
    } finally {
      await workspace.remove();
    }
  });
});

async function expectFailure(
  fetchImpl: (
    url: string,
    init: RequestInit,
  ) => Promise<Response>,
  message: string,
): Promise<void> {
  const workspace = await createWorkspace();
  try {
    await expect(captureC6LiveMultiLangNeighborCensus({
      expectedPlanSha256: sha256(workspace.planBytes),
      fetchImpl,
      outputRoot: workspace.outputRoot,
      planPath: workspace.planPath,
      token: TOKEN,
    })).rejects.toThrow(message);
    await expect(
      readFile(join(workspace.outputRoot, "completion.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expectNoCaptureResidue(
      workspace.root,
      workspace.outputRoot,
    );
  } finally {
    await workspace.remove();
  }
}

interface MutableCensusTarget {
  canonicalRepository: string;
  censusCap: number;
  owner: string;
  pilotRank: number;
  repo: string;
  seedAnchorId: string;
  seedCaptureOrder: number;
  sourceSplit: string;
  withinSplitRank: number;
}

interface MutablePriorPlan {
  counts: Record<string, unknown>;
  independenceBoundary: {
    goldInput: boolean;
    selectedRepositoryProjectionSha256: string;
  };
  targets: MutableCensusTarget[];
}

interface MutableContinuationPlan {
  boundary: {
    actorQualifiedEpisodeCount: number;
  };
  counts: {
    trancheCensusCandidateCeiling: number;
    unexpectedNestedCount?: number;
  };
  gold?: unknown;
  independenceBoundary: {
    priorNeighborPlanSha256: string;
    priorSelectedRepositoryProjectionSha256: string;
    selectedRepositoryProjectionSha256: string;
  };
  inputs: {
    priorNeighborPlan: {
      bytes: number;
      gold?: unknown;
      path: string;
      selectedRepositoryProjectionSha256: string;
      sha256: string;
    };
  };
  targets: MutableCensusTarget[];
}

async function expectContinuationPlanFailure(
  mutate: (
    plan: MutableContinuationPlan,
    workspace: Awaited<ReturnType<typeof createWorkspace>>,
  ) => void,
  expectedMessage?: string,
): Promise<void> {
  const workspace = await createWorkspace(
    CONTINUATION_PLAN_FIXTURE,
  );
  try {
    const plan = JSON.parse(
      workspace.planBytes.toString("utf8"),
    ) as MutableContinuationPlan;
    mutate(plan, workspace);
    const mutatedPlanBytes = Buffer.from(
      `${JSON.stringify(plan, null, 2)}\n`,
    );
    await writeFile(workspace.planPath, mutatedPlanBytes);
    let calls = 0;
    const capture = captureC6LiveMultiLangNeighborCensus({
      expectedPlanSchemaVersion: 2,
      expectedPlanSha256: sha256(mutatedPlanBytes),
      expectedPriorPlanSha256: PRIOR_PLAN_SHA256,
      expectedPriorSelectedRepositoryProjectionSha256:
        PRIOR_SELECTED_REPOSITORY_PROJECTION_SHA256,
      fetchImpl: async () => {
        calls += 1;
        return new Response();
      },
      outputRoot: workspace.outputRoot,
      planPath: workspace.planPath,
      priorPlanPath: workspace.priorPlanPath,
      token: TOKEN,
    });
    if (expectedMessage === undefined) {
      await expect(capture).rejects.toThrow();
    } else {
      await expect(capture).rejects.toThrow(expectedMessage);
    }
    expect(calls).toBe(0);
    await expectNoCaptureResidue(
      workspace.root,
      workspace.outputRoot,
    );
  } finally {
    await workspace.remove();
  }
}

async function createWorkspace(planFixture = PLAN_FIXTURE) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "goodmemory-c6-neighbor-capture-")),
  );
  const [planBytes, priorPlanBytes] = await Promise.all([
    readFile(planFixture),
    readFile(PLAN_FIXTURE),
  ]);
  const planPath = join(root, "plan.json");
  const priorPlanPath = join(root, basename(PLAN_FIXTURE));
  await Promise.all([
    writeFile(planPath, planBytes),
    writeFile(priorPlanPath, priorPlanBytes),
  ]);
  return {
    outputRoot: join(root, "capture"),
    planBytes,
    planPath,
    priorPlanBytes,
    priorPlanPath,
    remove: () => rm(root, { force: true, recursive: true }),
    root,
  };
}

function buildResponse(owner: string, name: string) {
  const repository = `${owner}/${name}`;
  return {
    data: {
      rateLimit: {
        cost: 1,
        remaining: 4_999,
        resetAt: "2026-07-26T12:00:00Z",
      },
      repository: {
        nameWithOwner: repository,
        pullRequests: {
          nodes: [
            pull(repository, 11, "2026-07-25T12:00:00Z", "a"),
            pull(repository, 10, "2026-07-24T12:00:00Z", "c"),
          ],
          pageInfo: {
            endCursor: "cursor-10",
            hasNextPage: false,
          },
          totalCount: 2,
        },
      },
    },
  };
}

function pull(
  repository: string,
  number: number,
  createdAt: string,
  commitCharacter: string,
) {
  return {
    author: { login: `author-${number}` },
    baseRefOid: commitCharacter.repeat(40),
    comments: { totalCount: number },
    createdAt,
    mergeCommit: { oid: (commitCharacter === "a" ? "b" : "d").repeat(40) },
    mergedAt: createdAt,
    number,
    reviews: { totalCount: number + 1 },
    reviewThreads: { totalCount: number + 2 },
    url: `https://github.com/${repository}/pull/${number}`,
  };
}

function requestVariables(init: RequestInit): {
  limit: number;
  name: string;
  owner: string;
} {
  return (JSON.parse(String(init.body)) as {
    variables: {
      limit: number;
      name: string;
      owner: string;
    };
  }).variables;
}

function graphqlResponse(
  body: string | Uint8Array,
  status = 200,
): Response {
  return new Response(
    typeof body === "string"
      ? body
      : Buffer.from(body).toString("utf8"),
    {
      headers: {
        "content-type": "application/json; charset=utf-8",
        date: "Sun, 26 Jul 2026 12:00:00 GMT",
        etag: "\"neighbor-census-etag\"",
        "x-github-request-id": "neighbor-census-request-id",
        "x-ratelimit-limit": "5000",
        "x-ratelimit-remaining": "4999",
        "x-ratelimit-reset": "1785067200",
        "x-ratelimit-resource": "graphql",
        "x-ratelimit-used": "1",
      },
      status,
    },
  );
}

async function successfulFetch(
  _url: string,
  init: RequestInit,
): Promise<Response> {
  const variables = requestVariables(init);
  return graphqlResponse(JSON.stringify(
    buildResponse(variables.owner, variables.name),
  ));
}

function selectedRepositoryProjection(
  target: MutableCensusTarget,
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

async function expectNoCaptureResidue(
  root: string,
  outputRoot: string,
  published = false,
): Promise<void> {
  let outputExists = true;
  try {
    await lstat(outputRoot);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      outputExists = false;
    } else {
      throw error;
    }
  }
  expect(outputExists).toBe(published);
  const incompletePrefix = `${basename(outputRoot)}.incomplete-`;
  expect(
    (await readdir(root)).filter((entry) =>
      entry.startsWith(incompletePrefix)
    ),
  ).toEqual([]);
}

async function listFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(path));
    } else {
      files.push(path);
    }
  }
  return files;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
