import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  captureC6LiveMultiLangNeighborDeep,
} from "../../scripts/codex-coding-effect/c6-live-multilang-neighbor-deep-capture";
import {
  buildC6LiveMultiLangNeighborDeepCapturePlan,
  C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_PARENTS_PAGE_QUERY,
  C6_LIVE_MULTILANG_NEIGHBOR_COMMITS_PAGE_QUERY,
  C6_LIVE_MULTILANG_NEIGHBOR_DEEP_INITIAL_QUERY,
  C6_LIVE_MULTILANG_NEIGHBOR_REVIEW_THREAD_COMMENTS_PAGE_QUERY,
  C6_LIVE_MULTILANG_NEIGHBOR_REVIEW_THREADS_PAGE_QUERY,
  C6_LIVE_MULTILANG_NEIGHBOR_REVIEWS_PAGE_QUERY,
  deriveC6LiveMultiLangNeighborDeepCapturePlan,
  materializeC6LiveMultiLangNeighborDeepCapturePlan,
  serializeC6LiveMultiLangNeighborDeepCapturePlan,
} from "../../scripts/codex-coding-effect/c6-live-multilang-neighbor-deep-capture-plan";
import {
  parseC6LiveMultiLangNeighborDeepCapturePlanCliOptions,
} from "../../scripts/snapshot-codex-coding-effect-c6-live-multilang-neighbor-deep-capture-plan";

describe("Codex coding-effect C6 Live/MultiLang neighbor deep-capture plan", () => {
  it("derives ordered targets and binds every query and policy hash", () => {
    const qualificationBytes = fixtureQualificationBytes();
    const plan = deriveC6LiveMultiLangNeighborDeepCapturePlan({
      expectedTargetCount: 2,
      qualificationBytes,
      qualificationPath: "/frozen/qualification.json",
    });

    expect(plan.boundary).toEqual({
      acceptedEpisodeCount: 0,
      actorCaptureExecuted: false,
      actorQualifiedEpisodeCount: 0,
      candidateManifestFrozen: false,
      captureCompletenessProven: false,
      codexRunReady: false,
      deepCaptureExecuted: false,
      machineQualifiedEpisodeCount: 0,
      semanticallyQualifiedEpisodeCount: 0,
      status: "neighbor-review-surface-deep-capture-plan-only",
    });
    expect(plan.counts).toEqual({
      expectedRequestLowerBound: 2,
      repositoryCount: 2,
      targetCount: 2,
    });
    expect(plan.requestBoundary).toEqual({
      initialRequestPerTarget: 1,
      paginationSupplementRequestCountKnown: false,
      surfaceCompletenessClaimed: false,
    });
    expect(plan.sampleBoundary).toEqual({
      adaptiveRepositoryExclusion: true,
      mergedPullRequestsOnly: true,
      newestPerRepositoryCap: 16,
      postMergeStructuralMetadataInput: true,
      populationRepresentativenessProven: false,
      repositorySampleRandom: false,
      reviewSurfaceEnrichmentApplied: true,
      reviewSurfacePretargetSelectionOnly: true,
    });
    expect(plan.inputs.qualification).toEqual({
      artifactKind:
        "c6-live-multilang-neighbor-census-qualification",
      bytes: qualificationBytes.byteLength,
      deepCaptureTargetProjectionSha256:
        fixtureQualification().independenceBoundary
          .deepCaptureTargetProjectionSha256,
      path: "qualification.json",
      schemaVersion: 2,
      sha256: sha256(qualificationBytes),
    });
    expect(plan.targets).toEqual([
      {
        authorLogin: "alice",
        baseRefOid: "a".repeat(40),
        canonicalAnchorId: "example/alpha#11",
        canonicalRepository: "example/alpha",
        captureDirectory: "example__alpha__11",
        captureOrder: 1,
        createdAt: "2026-07-01T00:00:00Z",
        mergeCommitOid: "b".repeat(40),
        mergedAt: "2026-07-02T00:00:00Z",
        observedReviewCount: 1,
        observedReviewThreadCount: 0,
        owner: "example",
        pilotRank: 1,
        pullNumber: 11,
        repo: "alpha",
        responseNodeRank: 1,
        sourceSplit: "c",
        url: "https://github.com/example/alpha/pull/11",
      },
      {
        authorLogin: "bob",
        baseRefOid: "c".repeat(40),
        canonicalAnchorId: "sample/beta#22",
        canonicalRepository: "sample/beta",
        captureDirectory: "sample__beta__22",
        captureOrder: 2,
        createdAt: "2026-07-03T00:00:00Z",
        mergeCommitOid: "d".repeat(40),
        mergedAt: "2026-07-04T00:00:00Z",
        observedReviewCount: 0,
        observedReviewThreadCount: 2,
        owner: "sample",
        pilotRank: 2,
        pullNumber: 22,
        repo: "beta",
        responseNodeRank: 3,
        sourceSplit: "cpp",
        url: "https://github.com/sample/beta/pull/22",
      },
    ]);
    expect(plan.queryContract.initial.sha256).toBe(
      sha256(C6_LIVE_MULTILANG_NEIGHBOR_DEEP_INITIAL_QUERY),
    );
    expect(plan.queryContract.supplements).toEqual({
      commitParents: {
        operationName: "C6NeighborDeepCommitParentsPage",
        sha256: sha256(
          C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_PARENTS_PAGE_QUERY,
        ),
      },
      commits: {
        operationName: "C6NeighborDeepCommitsPage",
        sha256: sha256(
          C6_LIVE_MULTILANG_NEIGHBOR_COMMITS_PAGE_QUERY,
        ),
      },
      reviewThreadComments: {
        operationName: "C6NeighborDeepReviewThreadCommentsPage",
        sha256: sha256(
          C6_LIVE_MULTILANG_NEIGHBOR_REVIEW_THREAD_COMMENTS_PAGE_QUERY,
        ),
      },
      reviewThreads: {
        operationName: "C6NeighborDeepReviewThreadsPage",
        sha256: sha256(
          C6_LIVE_MULTILANG_NEIGHBOR_REVIEW_THREADS_PAGE_QUERY,
        ),
      },
      reviews: {
        operationName: "C6NeighborDeepReviewsPage",
        sha256: sha256(
          C6_LIVE_MULTILANG_NEIGHBOR_REVIEWS_PAGE_QUERY,
        ),
      },
    });
    expect(plan.queryContract.capturePolicySha256)
      .toBe(
        "cb1b8b0522a6580b52519dd8d89aac7d061df3bfc28005bca4441be3d9170dc8",
      );
    expect(plan.queryContract.structuralReviewPolicySha256)
      .toBe(
        "b51613368026c09ad1aab3e4d08fe19197ddc1beea9499c9d8e068830527703a",
      );
    expect(plan.queryContract.initial.sha256).toBe(
      "30bfa86be9be1ff432a1705dda96d18b3ba92b0165088ef6875eae741e510e10",
    );
    expect(plan.queryContract.supplements).toMatchObject({
      commitParents: {
        sha256:
          "8ce02fbc969ba9c51675964529bab80b63c671ae4009ab3e7a0fdb7e6eb92d1c",
      },
      commits: {
        sha256:
          "a5994a48a0694b5861c9ae6e0a1f889a1e9877fdcc326548e5d62162f0ec24ee",
      },
      reviewThreadComments: {
        sha256:
          "907d7dae24e3f9845cb95499ee0bbd154dbdd6dbe18bd3a2f96b2455beef33cf",
      },
      reviewThreads: {
        sha256:
          "00a742de325aad55b1e883518ac74d8b73aad1661e1b9d234b6865809afb0b2f",
      },
      reviews: {
        sha256:
          "2383101d7fc493a17660b4fef43027e211a47c66deb8856e15500d4c30e1e666",
      },
    });
  });

  it("fails closed on projection, order, count, and hidden-field drift", () => {
    const projectionDrift = fixtureQualification();
    projectionDrift.independenceBoundary
      .deepCaptureTargetProjectionSha256 = "0".repeat(64);
    expect(() =>
      deriveC6LiveMultiLangNeighborDeepCapturePlan({
        expectedTargetCount: 2,
        qualificationBytes: bytes(projectionDrift),
        qualificationPath: "qualification.json",
      })
    ).toThrow("deep-target projection mismatch");

    const orderDrift = fixtureQualification();
    const deepTargets = orderDrift.results.filter(
      (result) =>
        result.status ===
          "novel-review-surface-deep-capture-target",
    );
    deepTargets[1]!.deepCaptureOrder = 3;
    refreshDeepProjection(orderDrift);
    expect(() =>
      deriveC6LiveMultiLangNeighborDeepCapturePlan({
        expectedTargetCount: 2,
        qualificationBytes: bytes(orderDrift),
        qualificationPath: "qualification.json",
      })
    ).toThrow("deep-capture order must be contiguous");

    expect(() =>
      deriveC6LiveMultiLangNeighborDeepCapturePlan({
        expectedTargetCount: 3,
        qualificationBytes: fixtureQualificationBytes(),
        qualificationPath: "qualification.json",
      })
    ).toThrow("requires exactly 3 deep-capture targets");

    const contaminated = fixtureQualification();
    (
      contaminated.results[0] as
        (typeof contaminated.results)[number] &
        Record<string, unknown>
    ).title = "hidden title";
    expect(() =>
      deriveC6LiveMultiLangNeighborDeepCapturePlan({
        expectedTargetCount: 2,
        qualificationBytes: bytes(contaminated),
        qualificationPath: "qualification.json",
      })
    ).toThrow();
  });

  it("recursively rejects case-insensitive selection and evaluator contamination", () => {
    for (const key of [
      "PaTcH",
      "TEST",
      "gold",
      "OuTcOmE",
      "semanticDECISION",
      "MachineDecision",
    ]) {
      const qualification = fixtureQualification() as unknown as
        Record<string, unknown>;
      qualification.provenance = {
        nested: {
          [key]: "hidden",
        },
      };
      expect(() =>
        deriveC6LiveMultiLangNeighborDeepCapturePlan({
          expectedTargetCount: 2,
          qualificationBytes: bytes(qualification),
          qualificationPath: "qualification.json",
        })
      ).toThrow(
        `forbidden qualification input $.provenance.nested.${key}`,
      );
    }
  });

  it("rejects root-level gold after the contaminated qualification SHA is rebound", async () => {
    const root = await realpath(
      await mkdtemp(join(
        tmpdir(),
        "goodmemory-c6-neighbor-deep-plan-contamination-",
      )),
    );
    try {
      const qualificationPath = join(root, "qualification.json");
      const qualification = fixtureQualification() as unknown as
        Record<string, unknown>;
      qualification.gold = {
        evaluatorOnly: true,
      };
      const qualificationBytes = bytes(qualification);
      await writeFile(qualificationPath, qualificationBytes);

      await expect(
        buildC6LiveMultiLangNeighborDeepCapturePlan({
          expectedDeepCaptureTargetProjectionSha256:
            (
              qualification.independenceBoundary as {
                deepCaptureTargetProjectionSha256: string;
              }
            ).deepCaptureTargetProjectionSha256,
          expectedQualificationSha256:
            sha256(qualificationBytes),
          expectedTargetCount: 2,
          qualificationPath,
        }),
      ).rejects.toThrow(
        "forbidden qualification input $.gold",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects rebound goldPatchSha256 evaluator metadata", async () => {
    await expectReboundQualificationContaminationRejected(
      (qualification) => {
        qualification.goldPatchSha256 = "a".repeat(64);
      },
      "$.goldPatchSha256",
    );
  });

  it("rejects rebound nested hiddenTests evaluator metadata", async () => {
    await expectReboundQualificationContaminationRejected(
      (qualification) => {
        qualification.provenance = {
          hiddenTests: ["tests/hidden.test.ts"],
        };
      },
      "$.provenance.hiddenTests",
    );
  });

  it("rejects rebound nested expectedChangedFiles evaluator metadata", async () => {
    await expectReboundQualificationContaminationRejected(
      (qualification) => {
        qualification.selection = {
          expectedChangedFiles: ["src/expected.ts"],
        };
      },
      "$.selection.expectedChangedFiles",
    );
  });

  it("rejects rebound evaluatorMetadata", async () => {
    await expectReboundQualificationContaminationRejected(
      (qualification) => {
        qualification.evaluatorMetadata = {
          source: "hidden evaluator",
        };
      },
      "$.evaluatorMetadata",
    );
  });

  it("rejects combined rebound evaluator keys across case and separators", async () => {
    await expectReboundQualificationContaminationRejected(
      (qualification) => {
        qualification.provenance = {
          "Evaluator-Metadata": {
            "EXPECTED_CHANGED-FILES": ["src/expected.ts"],
            "GoLd_PaTcH-Sha256": "a".repeat(64),
            "HIDDEN-TESTS": ["tests/hidden.test.ts"],
          },
        };
      },
      "$.provenance.Evaluator-Metadata",
    );
  });

  it("rejects rebound unseparated gold-patch keys in lower and upper case", async () => {
    for (const key of [
      "goldpatchsha256",
      "GOLDPATCHSHA256",
    ]) {
      await expectReboundQualificationContaminationRejected(
        (qualification) => {
          qualification[key] = "a".repeat(64);
        },
        `$.${key}`,
      );
    }
  });

  it("rejects rebound unseparated hidden-test keys in lower and upper case", async () => {
    for (const key of ["hiddentests", "HIDDENTESTS"]) {
      await expectReboundQualificationContaminationRejected(
        (qualification) => {
          qualification[key] = ["tests/hidden.test.ts"];
        },
        `$.${key}`,
      );
    }
  });

  it("rejects rebound unseparated evaluator keys in lower and upper case", async () => {
    for (const key of [
      "evaluatormetadata",
      "EVALUATORMETADATA",
    ]) {
      await expectReboundQualificationContaminationRejected(
        (qualification) => {
          qualification[key] = {
            source: "hidden evaluator",
          };
        },
        `$.${key}`,
      );
    }
  });

  it("rejects rebound bare files keys in lower and upper case", async () => {
    for (const key of ["files", "FILES"]) {
      await expectReboundQualificationContaminationRejected(
        (qualification) => {
          qualification[key] = ["src/expected.ts"];
        },
        `$.${key}`,
      );
    }
  });

  it("rejects combined rebound unseparated semantic keys", async () => {
    await expectReboundQualificationContaminationRejected(
      (qualification) => {
        qualification.audit = {
          EVALUATORMETADATA: {
            FILES: ["src/expected.ts"],
            GOLDPATCHSHA256: "a".repeat(64),
            hiddentests: ["tests/hidden.test.ts"],
          },
        };
      },
      "$.audit.EVALUATORMETADATA",
    );
  });

  it("rejects arbitrary rebound root metadata outside the qualification schema", async () => {
    await expectReboundQualificationRejected(
      (qualification) => {
        qualification.oracleData = {
          accepted: true,
        };
      },
      "Unrecognized key",
    );
  });

  it("rejects arbitrary rebound nested metadata outside the qualification schema", async () => {
    await expectReboundQualificationRejected(
      (qualification) => {
        (
          qualification.boundary as Record<string, unknown>
        ).oracleData = {
          accepted: true,
        };
      },
      "Unrecognized key",
    );
  });

  it("does not semantically misclassify ordinary unknown key names", async () => {
    for (const key of [
      "checksum",
      "dispatchMetadata",
      "latest",
    ]) {
      await expectReboundQualificationRejected(
        (qualification) => {
          qualification[key] = true;
        },
        "Unrecognized key",
      );
    }
  });

  it("exempts only known false independence declarations and does not scan string values", () => {
    const ordinaryText = fixtureQualification() as unknown as
      Record<string, unknown>;
    (
      (
        ordinaryText.inputs as Record<string, unknown>
      ).actorFrame as Record<string, unknown>
    ).path =
      "latest-dispatchMetadata-checksum-body-gold-patch-hidden-evaluator-outcome-test.json";
    expect(() =>
      deriveC6LiveMultiLangNeighborDeepCapturePlan({
        expectedTargetCount: 2,
        qualificationBytes: bytes(ordinaryText),
        qualificationPath: "qualification.json",
      })
    ).not.toThrow();

    const wrongPath = fixtureQualification() as unknown as
      Record<string, unknown>;
    wrongPath.provenance = {
      goldInput: false,
    };
    expect(() =>
      deriveC6LiveMultiLangNeighborDeepCapturePlan({
        expectedTargetCount: 2,
        qualificationBytes: bytes(wrongPath),
        qualificationPath: "qualification.json",
      })
    ).toThrow(
      "forbidden qualification input $.provenance.goldInput",
    );

    const nonFalseBoundary = fixtureQualification() as unknown as {
      independenceBoundary: Record<string, unknown>;
    };
    nonFalseBoundary.independenceBoundary.goldInput = true;
    expect(() =>
      deriveC6LiveMultiLangNeighborDeepCapturePlan({
        expectedTargetCount: 2,
        qualificationBytes: bytes(nonFalseBoundary),
        qualificationPath: "qualification.json",
      })
    ).toThrow(
      "forbidden qualification input $.independenceBoundary.goldInput",
    );
  });

  it("uses only structural-review bodies and excludes forbidden query surfaces", () => {
    const queries = [
      C6_LIVE_MULTILANG_NEIGHBOR_DEEP_INITIAL_QUERY,
      C6_LIVE_MULTILANG_NEIGHBOR_COMMITS_PAGE_QUERY,
      C6_LIVE_MULTILANG_NEIGHBOR_REVIEWS_PAGE_QUERY,
      C6_LIVE_MULTILANG_NEIGHBOR_REVIEW_THREADS_PAGE_QUERY,
      C6_LIVE_MULTILANG_NEIGHBOR_REVIEW_THREAD_COMMENTS_PAGE_QUERY,
      C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_PARENTS_PAGE_QUERY,
    ];
    const corpus = queries.join("\n");
    for (const field of [
      "title",
      "titleHTML",
      "closingIssuesReferences",
      "issue",
      "issues",
      "files",
      "diff",
      "patch",
      "test",
      "gold",
      "checks",
      "checkSuites",
      "checkRuns",
      "outcome",
      "message",
      "messageHeadline",
      "messageBody",
      "bodyHTML",
      "bodyText",
    ]) {
      expect(corpus).not.toMatch(
        new RegExp(`\\b${field}\\b`, "iu"),
      );
    }
    expect(corpus.match(/^\s+body\s*$/gmu)).toHaveLength(5);
    expect(corpus.match(/^\s+comments\(/gmu)).toHaveLength(3);
  });

  it("terminally rereads frozen input, rejects symlinks, and writes output with wx", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "goodmemory-c6-neighbor-deep-plan-")),
    );
    try {
      const qualificationPath = join(root, "qualification.json");
      const outputPath = join(root, "plan.json");
      const qualification = fixtureQualification();
      const qualificationBytes = bytes(qualification);
      const qualificationSha256 = sha256(qualificationBytes);
      const deepTargetProjectionSha256 =
        qualification.independenceBoundary
          .deepCaptureTargetProjectionSha256;
      await writeFile(qualificationPath, qualificationBytes);

      const materialized =
        await materializeC6LiveMultiLangNeighborDeepCapturePlan({
          expectedDeepCaptureTargetProjectionSha256:
            deepTargetProjectionSha256,
          expectedQualificationSha256:
            qualificationSha256,
          expectedTargetCount: 2,
          outputPath,
          qualificationPath,
        });
      expect(sha256(await readFile(outputPath))).toBe(
        materialized.outputSha256,
      );
      await expect(
        materializeC6LiveMultiLangNeighborDeepCapturePlan({
          expectedDeepCaptureTargetProjectionSha256:
            deepTargetProjectionSha256,
          expectedQualificationSha256:
            qualificationSha256,
          expectedTargetCount: 2,
          outputPath,
          qualificationPath,
        }),
      ).rejects.toThrow();

      const linkPath = join(root, "qualification-link.json");
      await symlink(qualificationPath, linkPath);
      await expect(
        buildC6LiveMultiLangNeighborDeepCapturePlan({
          expectedDeepCaptureTargetProjectionSha256:
            deepTargetProjectionSha256,
          expectedQualificationSha256:
            qualificationSha256,
          expectedTargetCount: 2,
          qualificationPath: linkPath,
        }),
      ).rejects.toThrow("rejects symlink path component");

      const mutablePath = join(root, "mutable-qualification.json");
      await writeFile(mutablePath, qualificationBytes);
      await expect(
        buildC6LiveMultiLangNeighborDeepCapturePlan({
          expectedDeepCaptureTargetProjectionSha256:
            deepTargetProjectionSha256,
          expectedQualificationSha256:
            qualificationSha256,
          expectedTargetCount: 2,
          qualificationPath: mutablePath,
          testHooks: {
            beforeTerminalVerification: async () => {
              await writeFile(mutablePath, "{}\n");
            },
          },
        }),
      ).rejects.toThrow(
        "qualification changed during projection",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("revalidates qualification after publication and rolls back without replacing an existing output", async () => {
    const root = await realpath(
      await mkdtemp(join(
        tmpdir(),
        "goodmemory-c6-neighbor-deep-plan-publication-",
      )),
    );
    try {
      const qualificationPath = join(root, "qualification.json");
      const outputPath = join(root, "plan.json");
      const qualification = fixtureQualification();
      const qualificationBytes = bytes(qualification);
      const input = {
        expectedDeepCaptureTargetProjectionSha256:
          qualification.independenceBoundary
            .deepCaptureTargetProjectionSha256,
        expectedQualificationSha256:
          sha256(qualificationBytes),
        expectedTargetCount: 2,
        outputPath,
        qualificationPath,
      };
      await writeFile(qualificationPath, qualificationBytes);

      let hookCalled = false;
      await expect(
        materializeC6LiveMultiLangNeighborDeepCapturePlan({
          ...input,
          testHooks: {
            afterOutputPublication: async () => {
              hookCalled = true;
              await writeFile(qualificationPath, "{}\n");
            },
          },
        }),
      ).rejects.toThrow();
      expect(hookCalled).toBe(true);
      await expect(readFile(outputPath)).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(
        (await readdir(root)).some((entry) =>
          entry.includes(".plan.json.incomplete-")
        ),
      ).toBe(false);

      await writeFile(qualificationPath, qualificationBytes);
      await expect(
        materializeC6LiveMultiLangNeighborDeepCapturePlan({
          ...input,
          testHooks: {
            afterOutputPublication: async () => {
              await rm(outputPath);
              await writeFile(
                outputPath,
                "foreign-agent-output\n",
                { mode: 0o644 },
              );
            },
          },
        }),
      ).rejects.toThrow();
      expect(await readFile(outputPath, "utf8")).toBe(
        "foreign-agent-output\n",
      );
      expect(
        (await readdir(root)).some((entry) =>
          entry.includes(".plan.json.incomplete-")
        ),
      ).toBe(false);
      await rm(outputPath);

      await expect(
        materializeC6LiveMultiLangNeighborDeepCapturePlan({
          ...input,
          testHooks: {
            afterOutputPublication: async () => {
              await chmod(outputPath, 0o600);
            },
          },
        }),
      ).rejects.toThrow();
      await expect(readFile(outputPath)).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(
        (await readdir(root)).some((entry) =>
          entry.includes(".plan.json.incomplete-")
        ),
      ).toBe(false);

      await writeFile(qualificationPath, qualificationBytes);
      await expect(
        materializeC6LiveMultiLangNeighborDeepCapturePlan({
          ...input,
          testHooks: {
            afterOutputPublication: async () => {
              const temporaryName = (await readdir(root)).find(
                (entry) => entry.includes(
                  ".plan.json.incomplete-",
                ),
              );
              expect(temporaryName).toBeDefined();
              await rm(join(root, temporaryName!));
              await writeFile(qualificationPath, "{}\n");
            },
          },
        }),
      ).rejects.toThrow();
      await expect(readFile(outputPath)).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(
        (await readdir(root)).some((entry) =>
          entry.includes(".plan.json.incomplete-")
        ),
      ).toBe(false);

      await writeFile(qualificationPath, qualificationBytes);
      let foreignTemporaryPath = "";
      await expect(
        materializeC6LiveMultiLangNeighborDeepCapturePlan({
          ...input,
          testHooks: {
            afterOutputPublication: async () => {
              const temporaryName = (await readdir(root)).find(
                (entry) => entry.includes(
                  ".plan.json.incomplete-",
                ),
              );
              expect(temporaryName).toBeDefined();
              foreignTemporaryPath = join(root, temporaryName!);
              await rm(foreignTemporaryPath);
              await writeFile(
                foreignTemporaryPath,
                "foreign-agent-temp\n",
                { mode: 0o644 },
              );
              await writeFile(qualificationPath, "{}\n");
            },
          },
        }),
      ).rejects.toThrow();
      await expect(readFile(outputPath)).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(await readFile(foreignTemporaryPath, "utf8")).toBe(
        "foreign-agent-temp\n",
      );
      await rm(foreignTemporaryPath);

      await writeFile(qualificationPath, qualificationBytes);
      await writeFile(outputPath, "existing\n", { mode: 0o644 });
      await expect(
        materializeC6LiveMultiLangNeighborDeepCapturePlan(input),
      ).rejects.toMatchObject({ code: "EEXIST" });
      expect(await readFile(outputPath, "utf8")).toBe("existing\n");
      expect((await lstat(outputPath)).mode & 0o777).toBe(0o644);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("accepts only the strict tranche-two qualification shape and remains runner-compatible", async () => {
    const root = await realpath(
      await mkdtemp(join(
        tmpdir(),
        "goodmemory-c6-neighbor-deep-plan-tranche-two-",
      )),
    );
    try {
      const qualification = fixtureContinuationQualification();
      const qualificationBytes = bytes(qualification);
      const plan = deriveC6LiveMultiLangNeighborDeepCapturePlan({
        expectedTargetCount: 2,
        qualificationBytes,
        qualificationPath: "/frozen/qualification-v3.json",
      });

      expect(plan.schemaVersion).toBe(1);
      expect(plan.inputs.qualification.schemaVersion).toBe(3);
      expect(plan.inputs.qualification).toMatchObject({
        deepCaptureTargetProjectionSha256:
          qualification.independenceBoundary
            .deepCaptureTargetProjectionSha256,
        schemaVersion: 3,
      });

      const planBytes = Buffer.from(
        serializeC6LiveMultiLangNeighborDeepCapturePlan(plan),
      );
      const planPath = join(root, "plan.json");
      const existingOutputRoot = join(root, "existing-output");
      await writeFile(planPath, planBytes);
      await writeFile(existingOutputRoot, "occupied\n");

      await expect(
        captureC6LiveMultiLangNeighborDeep({
          authorizationToken: "runner-schema-compatibility-token",
          expectedDeepCaptureTargetProjectionSha256:
            qualification.independenceBoundary
              .deepCaptureTargetProjectionSha256,
          expectedPlanSha256: sha256(planBytes),
          expectedQueryHashes: {
            commitParents:
              plan.queryContract.supplements.commitParents.sha256,
            commits: plan.queryContract.supplements.commits.sha256,
            initial: plan.queryContract.initial.sha256,
            reviewThreadComments:
              plan.queryContract.supplements
                .reviewThreadComments.sha256,
            reviewThreads:
              plan.queryContract.supplements.reviewThreads.sha256,
            reviews:
              plan.queryContract.supplements.reviews.sha256,
          },
          expectedTargetCount: 2,
          outputRoot: existingOutputRoot,
          planPath,
        }),
      ).rejects.toThrow(
        "neighbor deep-capture output root already exists",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects schema mixing and tranche-two independence drift", () => {
    const cases: Array<{
      mutate: (qualification: Record<string, unknown>) => void;
      name: string;
    }> = [
      {
        mutate: (qualification) => {
          qualification.schemaVersion = 2;
        },
        name: "schema-two with tranche-two fields",
      },
      {
        mutate: (qualification) => {
          delete (
            qualification.independenceBoundary as
              Record<string, unknown>
          ).priorTrancheOutcomeInput;
        },
        name: "missing prior-tranche declaration",
      },
      {
        mutate: (qualification) => {
          (
            qualification.independenceBoundary as
              Record<string, unknown>
          ).priorTrancheOutcomeInput = true;
        },
        name: "prior-tranche outcome input enabled",
      },
      {
        mutate: (qualification) => {
          (
            qualification.sampleBoundary as Record<string, unknown>
          ).censusTranche = 1;
        },
        name: "wrong census tranche",
      },
      {
        mutate: (qualification) => {
          (
            (
              qualification.inputs as Record<string, unknown>
            ).priorNeighborPlan as Record<string, unknown>
          ).schemaVersion = 2;
        },
        name: "wrong prior-plan schema",
      },
      {
        mutate: (qualification) => {
          delete (
            qualification.inputs as Record<string, unknown>
          ).priorNeighborPlan;
        },
        name: "missing prior-plan reference",
      },
      {
        mutate: (qualification) => {
          (
            (
              qualification.inputs as Record<string, unknown>
            ).priorNeighborPlan as Record<string, unknown>
          ).checksum = "ordinary-but-unrecognized";
        },
        name: "non-strict prior-plan reference",
      },
    ];

    for (const testCase of cases) {
      const qualification =
        fixtureContinuationQualification() as unknown as
          Record<string, unknown>;
      testCase.mutate(qualification);
      expect(
        () =>
          deriveC6LiveMultiLangNeighborDeepCapturePlan({
            expectedTargetCount: 2,
            qualificationBytes: bytes(qualification),
            qualificationPath: "qualification-v3.json",
          }),
        testCase.name,
      ).toThrow();
    }
  });

  it("rejects hidden metadata nested in the tranche-two prior-plan reference", () => {
    const qualification =
      fixtureContinuationQualification() as unknown as
        Record<string, unknown>;
    (
      (
        qualification.inputs as Record<string, unknown>
      ).priorNeighborPlan as Record<string, unknown>
    ).provenance = {
      evaluatorMetadata: {
        hiddenTests: ["tests/private.test.ts"],
      },
    };

    expect(() =>
      deriveC6LiveMultiLangNeighborDeepCapturePlan({
        expectedTargetCount: 2,
        qualificationBytes: bytes(qualification),
        qualificationPath: "qualification-v3.json",
      })
    ).toThrow(
      "forbidden qualification input $.inputs.priorNeighborPlan.provenance.evaluatorMetadata",
    );
  });

  it("terminally rejects tranche-two qualification drift", async () => {
    const root = await realpath(
      await mkdtemp(join(
        tmpdir(),
        "goodmemory-c6-neighbor-deep-plan-v3-drift-",
      )),
    );
    try {
      const qualificationPath = join(
        root,
        "qualification-v3.json",
      );
      const qualification = fixtureContinuationQualification();
      const qualificationBytes = bytes(qualification);
      await writeFile(qualificationPath, qualificationBytes);

      await expect(
        buildC6LiveMultiLangNeighborDeepCapturePlan({
          expectedDeepCaptureTargetProjectionSha256:
            qualification.independenceBoundary
              .deepCaptureTargetProjectionSha256,
          expectedQualificationSha256: sha256(qualificationBytes),
          expectedTargetCount: 2,
          qualificationPath,
          testHooks: {
            beforeTerminalVerification: async () => {
              await writeFile(qualificationPath, "{}\n");
            },
          },
        }),
      ).rejects.toThrow(
        "qualification changed during projection",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("derives the exact tracked wave-two plan without materializing it", async () => {
    const qualificationPath = join(
      process.cwd(),
      "fixtures/codex-coding-effect/c6-source-pool/swe-bench-live-multilang-608f7ae9.neighbor-census-qualification-v3.json",
    );
    const qualificationBytes = await readFile(qualificationPath);
    expect(sha256(qualificationBytes)).toBe(
      "011c264e496fb849a1f14baee1289cb815e90bd81adfa4f6bec44d08b11030ef",
    );

    const plan = deriveC6LiveMultiLangNeighborDeepCapturePlan({
      expectedTargetCount: 643,
      qualificationBytes,
      qualificationPath,
    });
    expect(plan.counts).toEqual({
      expectedRequestLowerBound: 643,
      repositoryCount: 60,
      targetCount: 643,
    });
    expect(plan.inputs.qualification).toMatchObject({
      deepCaptureTargetProjectionSha256:
        "d4aefe655c93875656c48e789af96801ba02a98edb423d6da8303ef8ddc1dbe6",
      schemaVersion: 3,
      sha256:
        "011c264e496fb849a1f14baee1289cb815e90bd81adfa4f6bec44d08b11030ef",
    });
    expect(plan.independenceBoundary.targetProjectionSha256).toBe(
      "9b1249a93f2878c41d258cdb2212facf26e4c810f2ed7322d1fcd23fe867eacf",
    );
    expect(sha256(
      serializeC6LiveMultiLangNeighborDeepCapturePlan(plan),
    )).toBe(
      "9af58b2033aa67d8bb1d056ff0f56fe8db9c1b0c7a75f73ed1a6a784ad0f4472",
    );
  });

  it("stably filters the canonical commit-count qualification to a 642-target plan", async () => {
    const deepPlanPath = join(
      process.cwd(),
      "fixtures/codex-coding-effect/c6-source-pool/" +
        "swe-bench-live-multilang-608f7ae9." +
        "neighbor-deep-capture-plan-v2.json",
    );
    const deepPlanBytes = await readFile(deepPlanPath);
    const sourcePlan = JSON.parse(
      deepPlanBytes.toString("utf8"),
    ) as CommitCountSourcePlanFixture;
    const fixture = fixtureCommitCountQualification(
      sourcePlan,
      deepPlanBytes,
    );

    const plan = deriveC6LiveMultiLangNeighborDeepCapturePlan({
      expectedTargetCount: 642,
      qualificationBytes: fixture.qualificationBytes,
      qualificationPath:
        "/frozen/commit-count-qualification.json",
    });
    const expectedTargets = sourcePlan.targets
      .filter((_, index) => index !== fixture.excludedIndex)
      .map((target, index) => ({
        ...target,
        captureOrder: index + 1,
      }));

    expect(plan.artifactKind).toBe(
      "c6-live-multilang-neighbor-deep-capture-plan",
    );
    expect(plan.schemaVersion).toBe(1);
    expect(plan.counts).toEqual({
      expectedRequestLowerBound: 642,
      repositoryCount: new Set(
        expectedTargets.map(
          (target) => target.canonicalRepository,
        ),
      ).size,
      targetCount: 642,
    });
    expect(plan.inputs.qualification).toEqual({
      artifactKind:
        "c6-live-multilang-neighbor-commit-count-eligibility-qualification",
      bytes: fixture.qualificationBytes.byteLength,
      deepCaptureTargetProjectionSha256:
        fixture.deepCaptureTargetProjectionSha256,
      deepPlanTargetProjectionSha256:
        fixture.deepPlanTargetProjectionSha256,
      path: "commit-count-qualification.json",
      schemaVersion: 1,
      sha256: sha256(fixture.qualificationBytes),
    });
    expect(JSON.stringify(plan.targets)).toBe(
      JSON.stringify(expectedTargets),
    );
    expect(plan.independenceBoundary.targetProjectionSha256)
      .toBe(fixture.deepPlanTargetProjectionSha256);
    expect(
      plan.targets.some(
        (target) =>
          target.canonicalAnchorId ===
            sourcePlan.targets[fixture.excludedIndex]!
              .canonicalAnchorId,
      ),
    ).toBe(false);
  });

  it("rejects noncanonical commit-count result order, split, and projection", async () => {
    const deepPlanPath = join(
      process.cwd(),
      "fixtures/codex-coding-effect/c6-source-pool/" +
        "swe-bench-live-multilang-608f7ae9." +
        "neighbor-deep-capture-plan-v2.json",
    );
    const deepPlanBytes = await readFile(deepPlanPath);
    const sourcePlan = JSON.parse(
      deepPlanBytes.toString("utf8"),
    ) as CommitCountSourcePlanFixture;
    const fixture = fixtureCommitCountQualification(
      sourcePlan,
      deepPlanBytes,
    );
    const cases = [
      {
        mutate: (
          qualification:
            ReturnType<typeof fixtureCommitCountQualification>[
              "qualification"
            ],
        ) => {
          [
            qualification.results[0],
            qualification.results[1],
          ] = [
            qualification.results[1]!,
            qualification.results[0]!,
          ];
        },
        name: "result reorder",
      },
      {
        mutate: (
          qualification:
            ReturnType<typeof fixtureCommitCountQualification>[
              "qualification"
            ],
        ) => {
          qualification.counts.replacementCount = 1;
        },
        name: "replacement",
      },
      {
        mutate: (
          qualification:
            ReturnType<typeof fixtureCommitCountQualification>[
              "qualification"
            ],
        ) => {
          qualification.independenceBoundary
            .deepPlanTargetProjectionSha256 = "f".repeat(64);
        },
        name: "deep-plan projection drift",
      },
    ];

    for (const testCase of cases) {
      const qualification = structuredClone(
        fixture.qualification,
      );
      testCase.mutate(qualification);
      expect(
        () =>
          deriveC6LiveMultiLangNeighborDeepCapturePlan({
            expectedTargetCount: 642,
            qualificationBytes: bytes(qualification),
            qualificationPath:
              "/frozen/commit-count-qualification.json",
          }),
        testCase.name,
      ).toThrow();
    }
  });

  it("preserves the exact frozen wave-one plan serialization", async () => {
    const fixtureRoot = join(
      process.cwd(),
      "fixtures/codex-coding-effect/c6-source-pool",
    );
    const qualificationPath = join(
      fixtureRoot,
      "swe-bench-live-multilang-608f7ae9.neighbor-census-qualification-v2.json",
    );
    const frozenPlanPath = join(
      fixtureRoot,
      "swe-bench-live-multilang-608f7ae9.neighbor-deep-capture-plan-v1.json",
    );
    const qualificationBytes = await readFile(qualificationPath);
    const plan = deriveC6LiveMultiLangNeighborDeepCapturePlan({
      expectedTargetCount: 692,
      qualificationBytes,
      qualificationPath,
    });
    const serialized =
      serializeC6LiveMultiLangNeighborDeepCapturePlan(plan);

    expect(serialized).toBe(await readFile(frozenPlanPath, "utf8"));
    expect(sha256(serialized)).toBe(
      "9c1ebdafd700a274cffc4dba807a2425013079d1bfe74a1e99f1144399da492a",
    );
  });

  it("parses the frozen snapshot tuple exactly once", () => {
    expect(
      parseC6LiveMultiLangNeighborDeepCapturePlanCliOptions([
        "--qualification=qualification.json",
        `--expected-qualification-sha256=${"a".repeat(64)}`,
        `--expected-deep-target-projection-sha256=${"b".repeat(64)}`,
        "--expected-target-count=2",
        "--output=deep-capture-plan.json",
      ]),
    ).toEqual({
      expectedDeepCaptureTargetProjectionSha256:
        "b".repeat(64),
      expectedQualificationSha256:
        "a".repeat(64),
      expectedTargetCount: 2,
      output: "deep-capture-plan.json",
      qualification: "qualification.json",
    });
    expect(() =>
      parseC6LiveMultiLangNeighborDeepCapturePlanCliOptions([
        "--qualification=qualification.json",
      ])
    ).toThrow(
      "--expected-qualification-sha256 is required exactly once",
    );
  });
});

interface CommitCountSourceTargetFixture {
  [key: string]: unknown;
  canonicalAnchorId: string;
  canonicalRepository: string;
  captureDirectory: string;
  captureOrder: number;
  pilotRank: number;
  responseNodeRank: number;
  sourceSplit: string;
}

interface CommitCountSourcePlanFixture {
  independenceBoundary: {
    qualificationDeepTargetProjectionSha256: string;
    targetProjectionSha256: string;
  };
  sampleBoundary: Record<string, unknown>;
  sourceDataset: Record<string, unknown>;
  targets: CommitCountSourceTargetFixture[];
}

function fixtureCommitCountQualification(
  sourcePlan: CommitCountSourcePlanFixture,
  sourcePlanBytes: Uint8Array,
) {
  const excludedIndex = Math.floor(sourcePlan.targets.length / 2);
  let deepCaptureOrder = 0;
  const results = sourcePlan.targets.map((sourceTarget, index) => {
    const eligible = index !== excludedIndex;
    if (eligible) {
      deepCaptureOrder += 1;
    }
    return {
      commitCount: eligible ? 250 : 251,
      decision: eligible
        ? "eligible-for-deep-capture"
        : "excluded-platform-commit-cap",
      deepCaptureOrder: eligible ? deepCaptureOrder : null,
      evidence: {
        captureManifest: {
          bytes: 1,
          path: `${sourceTarget.captureDirectory}/capture.json`,
          sha256: "1".repeat(64),
        },
        finalResponse: {
          bytes: 1,
          path:
            `${sourceTarget.captureDirectory}/attempts/` +
            "attempt-01/response.json",
          sha256: "2".repeat(64),
          httpStatus: 200,
        },
      },
      sourceTarget,
    };
  });
  const eligible = results.filter(
    (result) => result.decision === "eligible-for-deep-capture",
  );
  const excluded = results.filter(
    (result) => result.decision ===
      "excluded-platform-commit-cap",
  );
  const deepCaptureTargetProjection = eligible.map((result) => ({
    canonicalAnchorId: result.sourceTarget.canonicalAnchorId,
    canonicalRepository: result.sourceTarget.canonicalRepository,
    deepCaptureOrder: result.deepCaptureOrder,
    pilotRank: result.sourceTarget.pilotRank,
    responseNodeRank: result.sourceTarget.responseNodeRank,
    sourceSplit: result.sourceTarget.sourceSplit,
  }));
  const deepPlanTargets = eligible.map((result) => ({
    ...result.sourceTarget,
    captureOrder: result.deepCaptureOrder!,
  }));
  const deepCaptureTargetProjectionSha256 = sha256(
    JSON.stringify(deepCaptureTargetProjection),
  );
  const deepPlanTargetProjectionSha256 = sha256(
    JSON.stringify(deepPlanTargets),
  );
  const qualification = {
    artifactKind:
      "c6-live-multilang-neighbor-commit-count-eligibility-qualification",
    boundary: {
      acceptedEpisodeCount: 0,
      actorCaptureExecuted: false,
      actorQualifiedEpisodeCount: 0,
      candidateManifestFrozen: false,
      codexRunReady: false,
      deepCaptureExecuted: false,
      machineQualifiedEpisodeCount: 0,
      semanticallyQualifiedEpisodeCount: 0,
      status:
        "commit-count-platform-eligibility-qualified-deep-plan-required",
    },
    counts: {
      deepCaptureTargetCount: 642,
      eligibleTargetCount: 642,
      excludedTargetCount: 1,
      logicalRequestCount: 643,
      networkRequestCount: 643,
      rawFinalSuccessResponseCount: 643,
      replacementCount: 0,
      resampledTargetCount: 0,
      resultCount: 643,
      sourceTargetCount: 643,
    },
    independenceBoundary: {
      deepCaptureTargetProjectionSha256,
      deepPlanTargetProjectionSha256,
      diagnosticInput: false,
      eligibleSourceTargetProjectionSha256: sha256(
        JSON.stringify(
          eligible.map((result) => result.sourceTarget),
        ),
      ),
      excludedSourceTargetProjectionSha256: sha256(
        JSON.stringify(
          excluded.map((result) => result.sourceTarget),
        ),
      ),
      goldInput: false,
      machineOutcomeInput: false,
      patchInput: false,
      rawCommitCountProjectionSha256: sha256(JSON.stringify(
        results.map((result) => ({
          canonicalAnchorId:
            result.sourceTarget.canonicalAnchorId,
          commitCount: result.commitCount,
        })),
      )),
      resultProjectionSha256: sha256(JSON.stringify(results)),
      semanticDecisionInput: false,
      sourceTargetProjectionSha256: sha256(
        JSON.stringify(
          results.map((result) => result.sourceTarget),
        ),
      ),
      testInput: false,
    },
    inputs: {
      canonicalCapture: {
        assetLock: fixtureReference("asset-lock.json", "3"),
        assetRootSha256: "4".repeat(64),
        completion: fixtureReference("completion.json", "5"),
      },
      censusQualification: {
        ...fixtureReference("census-qualification-v3.json", "6"),
        artifactKind:
          "c6-live-multilang-neighbor-census-qualification",
        deepCaptureTargetProjectionSha256:
          sourcePlan.independenceBoundary
            .qualificationDeepTargetProjectionSha256,
        schemaVersion: 3,
      },
      deepCapturePlan: {
        bytes: sourcePlanBytes.byteLength,
        path: "neighbor-deep-capture-plan-v2.json",
        sha256: sha256(sourcePlanBytes),
        artifactKind:
          "c6-live-multilang-neighbor-deep-capture-plan",
        schemaVersion: 1,
        targetProjectionSha256:
          sourcePlan.independenceBoundary.targetProjectionSha256,
      },
      eligibilityPlan: {
        ...fixtureReference(
          "commit-count-eligibility-plan-v1.json",
          "7",
        ),
        artifactKind:
          "c6-live-multilang-neighbor-commit-count-eligibility-plan",
        schemaVersion: 1,
        sourceTargetProjectionSha256:
          sourcePlan.independenceBoundary.targetProjectionSha256,
      },
    },
    registrationBoundary: {
      exploratoryAllTargetCountDiagnosticObserved: true,
      frozenBeforeCanonicalCapture: true,
      initialPlanV2TransportFailureObserved: true,
      preregisteredBeforeExploratoryDiagnostic: false,
    },
    results,
    rule: {
      classification:
        "commitCount-less-than-or-equal-platform-cap",
      forbiddenSelectionInputs: [
        "diagnostic",
        "gold",
        "machineOutcome",
        "patch",
        "semanticDecision",
        "test",
      ],
      noReplacementOrResampling: true,
      platformCommitCap: 250,
      rawFinalSuccessResponseRequired: true,
      resultOrder: "frozen-deep-plan-v2-target-order",
      stableEligibilityFilter: true,
    },
    sampleBoundary: sourcePlan.sampleBoundary,
    schemaVersion: 1,
    sourceDataset: sourcePlan.sourceDataset,
  };
  return {
    deepCaptureTargetProjectionSha256,
    deepPlanTargetProjectionSha256,
    excludedIndex,
    qualification,
    qualificationBytes: bytes(qualification),
  };
}

function fixtureQualificationBytes(): Buffer {
  return bytes(fixtureQualification());
}

function fixtureQualification() {
  const results = [
    result({
      authorLogin: "alice",
      baseRefOid: "a".repeat(40),
      canonicalAnchorId: "example/alpha#11",
      createdAt: "2026-07-01T00:00:00Z",
      deepCaptureOrder: 1,
      mergeCommitOid: "b".repeat(40),
      mergedAt: "2026-07-02T00:00:00Z",
      pilotRank: 1,
      responseNodeRank: 1,
      reviewCount: 1,
      reviewThreadCount: 0,
      sourceSplit: "c",
    }),
    result({
      authorLogin: "nobody",
      baseRefOid: "e".repeat(40),
      canonicalAnchorId: "example/no-review#12",
      createdAt: "2026-07-01T00:00:00Z",
      mergeCommitOid: "f".repeat(40),
      mergedAt: "2026-07-02T00:00:00Z",
      pilotRank: 1,
      responseNodeRank: 2,
      reviewCount: 0,
      reviewThreadCount: 0,
      sourceSplit: "c",
      status: "novel-no-review-surface",
    }),
    result({
      authorLogin: "bob",
      baseRefOid: "c".repeat(40),
      canonicalAnchorId: "sample/beta#22",
      createdAt: "2026-07-03T00:00:00Z",
      deepCaptureOrder: 2,
      mergeCommitOid: "d".repeat(40),
      mergedAt: "2026-07-04T00:00:00Z",
      pilotRank: 2,
      responseNodeRank: 3,
      reviewCount: 0,
      reviewThreadCount: 2,
      sourceSplit: "cpp",
    }),
  ];
  const qualification = {
    artifactKind:
      "c6-live-multilang-neighbor-census-qualification",
    boundary: {
      acceptedEpisodeCount: 0,
      actorCaptureExecuted: false,
      actorQualifiedEpisodeCount: 0,
      candidateManifestFrozen: false,
      canonicalPullDeduplicationComplete: true,
      codexRunReady: false,
      deepCaptureExecuted: false,
      existingAnchorExclusionComplete: true,
      machineQualifiedEpisodeCount: 0,
      populationRepresentativenessProven: false,
      semanticallyQualifiedEpisodeCount: 0,
      status:
        "novel-review-surface-pretargets-deep-capture-required",
    },
    counts: {
      capturedRepositoryCount: 2,
      deepCaptureTargetCount: 2,
      duplicateObservationCount: 0,
      existingAnchorOverlapCount: 0,
      novelCanonicalPullCount: 3,
      novelWithReviewSurfaceCount: 2,
      novelWithoutReviewSurfaceCount: 1,
      rawObservationCount: 3,
      sourceCanonicalAnchorCount: 743,
      truncatedRepositoryCount: 0,
      uniqueCanonicalPullCount: 3,
    },
    independenceBoundary: {
      canonicalPullProjectionSha256: "1".repeat(64),
      deepCaptureTargetProjectionSha256: "",
      excludedAnchorProjectionSha256: "2".repeat(64),
      existingAnchorProjectionSha256: "3".repeat(64),
      goldInput: false,
      machineOutcomeInput: false,
      metadataQuerySha256: "4".repeat(64),
      patchInput: false,
      postMergeStructuralMetadataInput: true,
      qualificationPolicySha256: "5".repeat(64),
      semanticDecisionInput: false,
      testInput: false,
    },
    inputs: {
      actorFrame: fixtureReference("actor-frame.json", "6"),
      actorFrameCandidateProjectionSha256: "7".repeat(64),
      neighborCompletion: fixtureReference(
        "completion.json",
        "8",
      ),
      neighborPlan: fixtureReference("neighbor-plan.json", "9"),
      neighborRootSha256: "a".repeat(64),
      sourceCapturePlan: fixtureReference(
        "source-plan.json",
        "b",
      ),
      sourceGraphqlRootSha256: "c".repeat(64),
      sourcePool: fixtureReference("source-pool.json", "d"),
    },
    repositoryCounts: [{
      canonicalRepository: "example/alpha",
      deepCaptureTargetCount: 1,
      existingAnchorOverlapCount: 0,
      novelCanonicalPullCount: 2,
      rawObservationCount: 2,
      uniqueCanonicalPullCount: 2,
    }, {
      canonicalRepository: "sample/beta",
      deepCaptureTargetCount: 1,
      existingAnchorOverlapCount: 0,
      novelCanonicalPullCount: 1,
      rawObservationCount: 1,
      uniqueCanonicalPullCount: 1,
    }],
    results,
    rule: {
      canonicalIdentity:
        "lowercase-resolved-repository-plus-pull-number",
      classification:
        "reviewCount-positive-or-reviewThreadCount-positive",
      deduplication:
        "canonicalize-then-group-before-existing-anchor-exclusion",
      existingAnchorExclusion:
        "exclude-all-743-reconstructed-canonical-source-anchors",
      forbiddenSelectionInputs: [
        "body",
        "diff",
        "files",
        "gold",
        "machineDecision",
        "outcome",
        "patch",
        "semanticDecision",
        "test",
      ],
      noRepositoryCapOrResampling: true,
      resultOrder: "pilotRank-then-responseNodeRank",
      schemaVersion: 1,
    },
    sampleBoundary: {
      adaptiveRepositoryExclusion: true,
      mergedPullRequestsOnly: true,
      newestPerRepositoryCap: 16,
      postMergeStructuralMetadataInput: true,
      repositorySampleRandom: false,
      reviewSurfaceEnrichmentApplied: true,
    },
    schemaVersion: 2,
    sourceDataset: {
      datasetId: "SWE-bench-Live/MultiLang",
      revision: "608f7ae9ab8ea1f9f0d030fe04562cf6bd1a0c8b",
    },
    splitCounts: {
      c: fixtureBreakdown({
        deepCaptureTargetCount: 1,
        novelCanonicalPullCount: 2,
        rawObservationCount: 2,
        uniqueCanonicalPullCount: 2,
      }),
      cpp: fixtureBreakdown({
        deepCaptureTargetCount: 1,
        novelCanonicalPullCount: 1,
        rawObservationCount: 1,
        uniqueCanonicalPullCount: 1,
      }),
      go: fixtureBreakdown(),
      js: fixtureBreakdown(),
      rust: fixtureBreakdown(),
      java: fixtureBreakdown(),
      ts: fixtureBreakdown(),
      cs: fixtureBreakdown(),
    },
  };
  refreshDeepProjection(qualification);
  return qualification;
}

function fixtureContinuationQualification() {
  const qualification = fixtureQualification();
  return {
    ...qualification,
    independenceBoundary: {
      ...qualification.independenceBoundary,
      priorTrancheOutcomeInput: false,
    },
    inputs: {
      ...qualification.inputs,
      priorNeighborPlan: {
        ...fixtureReference("neighbor-plan-v1.json", "e"),
        artifactKind:
          "c6-live-multilang-neighbor-census-plan",
        schemaVersion: 1,
        selectedRepositoryProjectionSha256: "f".repeat(64),
      },
    },
    sampleBoundary: {
      ...qualification.sampleBoundary,
      censusTranche: 2,
    },
    schemaVersion: 3,
  };
}

function fixtureBreakdown(
  input: Partial<{
    deepCaptureTargetCount: number;
    existingAnchorOverlapCount: number;
    novelCanonicalPullCount: number;
    rawObservationCount: number;
    uniqueCanonicalPullCount: number;
  }> = {},
) {
  return {
    deepCaptureTargetCount: 0,
    existingAnchorOverlapCount: 0,
    novelCanonicalPullCount: 0,
    rawObservationCount: 0,
    uniqueCanonicalPullCount: 0,
    ...input,
  };
}

function fixtureReference(path: string, fill: string) {
  return {
    bytes: 1,
    path,
    sha256: fill.repeat(64),
  };
}

function result(input: {
  authorLogin: string;
  baseRefOid: string;
  canonicalAnchorId: string;
  createdAt: string;
  deepCaptureOrder?: number;
  mergeCommitOid: string;
  mergedAt: string;
  pilotRank: number;
  responseNodeRank: number;
  reviewCount: number;
  reviewThreadCount: number;
  sourceSplit: "c" | "cpp";
  status?:
    | "novel-no-review-surface"
    | "novel-review-surface-deep-capture-target";
}) {
  const [canonicalRepository] = input.canonicalAnchorId.split("#");
  return {
    authorLogin: input.authorLogin,
    baseRefOid: input.baseRefOid,
    canonicalAnchorId: input.canonicalAnchorId,
    canonicalRepository: canonicalRepository!,
    commentCount: 0,
    createdAt: input.createdAt,
    ...(input.deepCaptureOrder === undefined
      ? {}
      : { deepCaptureOrder: input.deepCaptureOrder }),
    mergeCommitOid: input.mergeCommitOid,
    mergedAt: input.mergedAt,
    observationRefs: [{
      captureDirectory: `${input.pilotRank}__capture`,
      pilotRank: input.pilotRank,
      responseNodeRank: input.responseNodeRank,
      sourceSplit: input.sourceSplit,
    }],
    pilotRank: input.pilotRank,
    responseNodeRank: input.responseNodeRank,
    reviewCount: input.reviewCount,
    reviewThreadCount: input.reviewThreadCount,
    sourceSplit: input.sourceSplit,
    status: input.status ??
      "novel-review-surface-deep-capture-target",
    url:
      `https://github.com/${canonicalRepository}/pull/${
        input.canonicalAnchorId.split("#")[1]
      }`,
  };
}

function refreshDeepProjection(
  qualification: ReturnType<typeof fixtureQualification>,
): void {
  const projection = qualification.results
    .filter((value) =>
      value.status ===
        "novel-review-surface-deep-capture-target"
    )
    .map((value) => ({
      canonicalAnchorId: value.canonicalAnchorId,
      canonicalRepository: value.canonicalRepository,
      deepCaptureOrder: value.deepCaptureOrder,
      pilotRank: value.pilotRank,
      responseNodeRank: value.responseNodeRank,
      sourceSplit: value.sourceSplit,
    }));
  qualification.independenceBoundary
    .deepCaptureTargetProjectionSha256 =
      sha256(JSON.stringify(projection));
}

function bytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

async function expectReboundQualificationContaminationRejected(
  mutate: (qualification: Record<string, unknown>) => void,
  expectedPath: string,
): Promise<void> {
  await expectReboundQualificationRejected(
    mutate,
    `forbidden qualification input ${expectedPath}`,
  );
}

async function expectReboundQualificationRejected(
  mutate: (qualification: Record<string, unknown>) => void,
  expectedError: string,
): Promise<void> {
  const root = await realpath(
    await mkdtemp(join(
      tmpdir(),
      "goodmemory-c6-neighbor-deep-plan-rebound-",
    )),
  );
  try {
    const qualificationPath = join(root, "qualification.json");
    const qualification = fixtureQualification() as unknown as
      Record<string, unknown>;
    mutate(qualification);
    const qualificationBytes = bytes(qualification);
    await writeFile(qualificationPath, qualificationBytes);
    const independenceBoundary =
      qualification.independenceBoundary as {
        deepCaptureTargetProjectionSha256: string;
      };

    await expect(
      buildC6LiveMultiLangNeighborDeepCapturePlan({
        expectedDeepCaptureTargetProjectionSha256:
          independenceBoundary.deepCaptureTargetProjectionSha256,
        expectedQualificationSha256: sha256(qualificationBytes),
        expectedTargetCount: 2,
        qualificationPath,
      }),
    ).rejects.toThrow(expectedError);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
