import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  chmod,
  cp,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, join } from "node:path";

import { afterAll, describe, expect, it } from "bun:test";

import type {
  C6LiveMultiLangNeighborDeepEvidence,
} from "../../scripts/codex-coding-effect/c6-live-multilang-neighbor-deep-evidence";
import {
  C6_LIVE_MULTILANG_NEIGHBOR_WAVE1_STRUCTURAL_BASELINE,
  buildC6LiveMultiLangNeighborStructuralQualification,
  deriveC6LiveMultiLangNeighborStructuralQualification,
  materializeC6LiveMultiLangNeighborStructuralQualification,
  parseC6LiveMultiLangNeighborStructuralQualification,
  serializeC6LiveMultiLangNeighborStructuralQualification,
} from "../../scripts/codex-coding-effect/c6-live-multilang-neighbor-structural-qualification";
import {
  parseC6LiveMultiLangNeighborStructuralQualificationCliOptions,
} from "../../scripts/snapshot-codex-coding-effect-c6-live-multilang-neighbor-structural-qualification";

const DEEP_ROOT =
  "/private/tmp/goodmemory-c6-live-multilang-neighbor-deep-v1";
const PLAN_PATH = join(
  process.cwd(),
  "fixtures/codex-coding-effect/c6-source-pool/" +
    "swe-bench-live-multilang-608f7ae9." +
    "neighbor-deep-capture-plan-v1.json",
);
const temporaryRoots: string[] = [];
const realEvidenceIt =
  existsSync(DEEP_ROOT) && existsSync(PLAN_PATH) ? it : it.skip;

afterAll(async () => {
  await Promise.all(
    temporaryRoots.map((root) =>
      rm(root, { force: true, recursive: true })
    ),
  );
});

describe("C6 live multilingual neighbor structural qualification", () => {
  it("retains every reviewer actor while excluding null-timestamp reviews from events", () => {
    const evidence = syntheticEvidence();
    const qualification =
      deriveC6LiveMultiLangNeighborStructuralQualification({
        evidence,
        plan: {
          bytes: 123,
          path: "wave1-plan.json",
          sha256: hash("plan"),
        },
      });

    expect(qualification.counts).toMatchObject({
      exactStructuralCandidateCount: 1,
      noExactStructuralSequenceCount: 1,
      projectedStructuralEventCount: 2,
      pullAuthorOccurrenceCount: 2,
      reviewerActorOccurrenceCount: 5,
      reviewerUniqueLoginCount: 5,
      targetCount: 2,
    });
    expect(qualification.reviewerActorOccurrences).toContainEqual(
      expect.objectContaining({
        actorLogin: "null-reviewer",
        eventId: "review-null",
        submittedAt: null,
        surface: "review",
      }),
    );
    expect(qualification.reviewerActorOccurrences).toContainEqual(
      expect.objectContaining({
        actorLogin: "reviewer-later",
        eventId: "comment-later",
        surface: "review-thread-comment",
      }),
    );
    expect(
      qualification.results.find((result) =>
        result.canonicalAnchorId === "example/second#2"
      ),
    ).toMatchObject({
      status: "no-exact-structural-sequence",
      structuralEventCount: 0,
    });
    const exact = qualification.results.find((result) =>
      result.status === "exact-structural-candidate-pre-actor"
    );
    expect(exact).toMatchObject({
      exactSequence: {
        firstReview: {
          body:
            "This test outcome discusses a gold patch in ordinary prose.",
        },
        secondReview: { id: "comment-selected" },
      },
      structuralEventCount: 2,
    });
  });

  it("rejects semantic or evaluator metadata keys without scanning body values", () => {
    const evidence = syntheticEvidence();
    (
      evidence.targets[0] as unknown as Record<string, unknown>
    ).hiddenEvaluatorMetadata = { acceptedOutcome: true };
    expect(() =>
      deriveC6LiveMultiLangNeighborStructuralQualification({
        evidence,
        plan: {
          bytes: 123,
          path: "wave1-plan.json",
          sha256: hash("plan"),
        },
      })
    ).toThrow(/forbidden evidence metadata key/u);

    const clean = deriveC6LiveMultiLangNeighborStructuralQualification({
      evidence: syntheticEvidence(),
      plan: {
        bytes: 123,
        path: "wave1-plan.json",
        sha256: hash("plan"),
      },
    });
    const raw = JSON.parse(
      serializeC6LiveMultiLangNeighborStructuralQualification(clean),
    ) as Record<string, unknown>;
    raw.hiddenTests = true;
    expect(() =>
      parseC6LiveMultiLangNeighborStructuralQualification(
        `${JSON.stringify(raw, null, 2)}\n`,
      )
    ).toThrow();
  });

  it("parses only canonical, strict qualification artifacts", () => {
    const qualification =
      deriveC6LiveMultiLangNeighborStructuralQualification({
        evidence: syntheticEvidence(),
        plan: {
          bytes: 123,
          path: "wave1-plan.json",
          sha256: hash("plan"),
        },
      });
    const serialized =
      serializeC6LiveMultiLangNeighborStructuralQualification(
        qualification,
      );

    expect(
      parseC6LiveMultiLangNeighborStructuralQualification(serialized),
    ).toEqual(qualification);
    expect(() =>
      parseC6LiveMultiLangNeighborStructuralQualification(
        JSON.stringify(qualification),
      )
    ).toThrow(/canonical JSON/u);
  });

  realEvidenceIt("replays the frozen Wave1 closure and derives the exact baseline", async () => {
    const result =
      await buildC6LiveMultiLangNeighborStructuralQualification({
        deepCaptureRoot: DEEP_ROOT,
        planPath: PLAN_PATH,
        tranche: "wave1",
      });

    expect(result.qualification.counts).toEqual({
      exactStructuralCandidateCount: 34,
      exactStructuralRepositoryCount: 15,
      noExactStructuralSequenceCount: 658,
      projectedStructuralEventCount: 830,
      pullAuthorOccurrenceCount: 692,
      repositoryCappedStructuralCeiling: 30,
      reviewerActorOccurrenceCount: 3_185,
      reviewerUniqueLoginCount: 267,
      targetCount: 692,
    });
    expect(result.qualification.inputs.deepEvidence).toMatchObject({
      assetRootSha256:
        "80c360d58b1959e5a47cbd70c5eb620276ed2105c49a595dccdb4aa178d1f83b",
      completionSha256:
        "62ba6ada2d0ae54f4d43149e592ec06b70899e712a12f97dd503d8650ff2063d",
      targetProjectionSha256:
        "7286f92d0b211ab6830727969d2c40e691e73b1b55197fce221a271ef14edbcf",
    });
    expect(result.qualification.independenceBoundary).toMatchObject({
      pullAuthorOccurrenceProjectionSha256:
        "72b4f597546917d0140b07c516a6a8577849f4f54e8b8ef074177a47b4aeaffc",
      reviewerActorOccurrenceProjectionSha256:
        "881aafcfad9a9675e353adb8b2a3aaa8fd623ff0525c29ba34a3b08f29ee0c49",
      reviewerLoginProjectionSha256:
        "a26324b895357d9191a0d84baddbca968bea218859d968a743ebdd7b48f0aa34",
      structuralResultProjectionSha256:
        "f599d7ced72a3cebd4f175a059a604d2bb2c09b97d81e268dd18915cdd136081",
    });
    expect(result.outputSha256).toBe(
      "ae096d86f779cb04f1fb0bb336d6bb4e02ced04e72385d9332d4dba82a9c1210",
    );
    expect(result.qualification.boundary).toEqual({
      acceptedEpisodeCount: 0,
      actorCaptureExecuted: false,
      actorQualifiedEpisodeCount: 0,
      candidateManifestFrozen: false,
      codexRunReady: false,
      evaluatorQualifiedEpisodeCount: 0,
      machineQualifiedEpisodeCount: 0,
      semanticallyQualifiedEpisodeCount: 0,
      status: "pre-actor-structural-qualification-only",
    });
    expect(C6_LIVE_MULTILANG_NEIGHBOR_WAVE1_STRUCTURAL_BASELINE)
      .toMatchObject(result.qualification.counts);
  }, 120_000);

  realEvidenceIt("rejects terminal plan drift", async () => {
    const parent = await mkdtemp(
      "/private/tmp/goodmemory-c6-wave1-structural-plan-",
    );
    temporaryRoots.push(parent);
    const planPath = join(parent, basename(PLAN_PATH));
    await cp(PLAN_PATH, planPath);
    let hookCalled = false;

    await expect(
      buildC6LiveMultiLangNeighborStructuralQualification({
        deepCaptureRoot: DEEP_ROOT,
        planPath,
        tranche: "wave1",
        testHooks: {
          beforeTerminalReplay: async () => {
            hookCalled = true;
            await writeFile(planPath, "{}\n");
          },
        },
      }),
    ).rejects.toThrow();
    expect(hookCalled).toBe(true);
  }, 120_000);

  realEvidenceIt("rejects terminal root drift", async () => {
    const parent = await mkdtemp(
      "/private/tmp/goodmemory-c6-wave1-structural-root-",
    );
    temporaryRoots.push(parent);
    const root = join(parent, "capture");
    await cp(DEEP_ROOT, root, {
      preserveTimestamps: true,
      recursive: true,
    });
    await chmod(root, 0o700);
    let hookCalled = false;

    await expect(
      buildC6LiveMultiLangNeighborStructuralQualification({
        deepCaptureRoot: root,
        planPath: PLAN_PATH,
        tranche: "wave1",
        testHooks: {
          beforeTerminalReplay: async () => {
            hookCalled = true;
            await writeFile(
              join(root, "terminal-drift.json"),
              "{}\n",
              { mode: 0o600 },
            );
          },
        },
      }),
    ).rejects.toThrow();
    expect(hookCalled).toBe(true);
  }, 120_000);

  realEvidenceIt("rolls back when post-publication replay detects input drift", async () => {
    const parent = await mkdtemp(
      "/private/tmp/goodmemory-c6-wave1-structural-output-",
    );
    temporaryRoots.push(parent);
    const planPath = join(parent, basename(PLAN_PATH));
    await cp(PLAN_PATH, planPath);
    const outputPath = join(parent, "qualification.json");
    let hookCalled = false;

    await expect(
      materializeC6LiveMultiLangNeighborStructuralQualification({
        deepCaptureRoot: DEEP_ROOT,
        outputPath,
        planPath,
        tranche: "wave1",
        testHooks: {
          afterOutputPublication: async () => {
            hookCalled = true;
            await writeFile(planPath, "{}\n");
          },
        },
      }),
    ).rejects.toThrow(/plan hash mismatch/u);
    expect(hookCalled).toBe(true);
    expect(existsSync(outputPath)).toBe(false);
    expect(await readdir(parent)).toEqual([basename(PLAN_PATH)]);
  }, 120_000);

  realEvidenceIt("does not delete a foreign replacement during rollback", async () => {
    const parent = await mkdtemp(
      "/private/tmp/goodmemory-c6-wave1-structural-foreign-",
    );
    temporaryRoots.push(parent);
    const outputPath = join(parent, "qualification.json");
    let hookCalled = false;

    await expect(
      materializeC6LiveMultiLangNeighborStructuralQualification({
        deepCaptureRoot: DEEP_ROOT,
        outputPath,
        planPath: PLAN_PATH,
        tranche: "wave1",
        testHooks: {
          afterOutputPublication: async () => {
            hookCalled = true;
            await rm(outputPath);
            await writeFile(outputPath, "foreign-agent-output\n", {
              mode: 0o644,
            });
            throw new Error("injected foreign replacement");
          },
        },
      }),
    ).rejects.toThrow(/injected foreign replacement/u);
    expect(hookCalled).toBe(true);
    expect(await readFile(outputPath, "utf8")).toBe(
      "foreign-agent-output\n",
    );
    expect(await readdir(parent)).toEqual(["qualification.json"]);
  }, 120_000);

  realEvidenceIt("uses the recorded inode when the temporary link is replaced", async () => {
    const parent = await mkdtemp(
      "/private/tmp/goodmemory-c6-wave1-structural-temp-foreign-",
    );
    temporaryRoots.push(parent);
    const planPath = join(parent, basename(PLAN_PATH));
    await cp(PLAN_PATH, planPath);
    const outputPath = join(parent, "qualification.json");
    let foreignTemporaryPath: string | null = null;
    let hookCalled = false;

    await expect(
      materializeC6LiveMultiLangNeighborStructuralQualification({
        deepCaptureRoot: DEEP_ROOT,
        outputPath,
        planPath,
        tranche: "wave1",
        testHooks: {
          afterOutputPublication: async () => {
            hookCalled = true;
            const temporaryName = (await readdir(parent)).find(
              (name) => name.includes(".incomplete-"),
            );
            if (temporaryName === undefined) {
              throw new Error("test temporary hard-link missing");
            }
            foreignTemporaryPath = join(parent, temporaryName);
            await rm(foreignTemporaryPath);
            await writeFile(
              foreignTemporaryPath,
              "foreign-temporary-output\n",
              { mode: 0o644 },
            );
            await writeFile(planPath, "{}\n");
          },
        },
      }),
    ).rejects.toThrow(/plan hash mismatch/u);
    expect(hookCalled).toBe(true);
    expect(existsSync(outputPath)).toBe(false);
    expect(foreignTemporaryPath).not.toBeNull();
    expect(await readFile(foreignTemporaryPath!, "utf8")).toBe(
      "foreign-temporary-output\n",
    );
    expect((await readdir(parent)).sort()).toEqual([
      basename(PLAN_PATH),
      basename(foreignTemporaryPath!),
    ].sort());
  }, 120_000);

  realEvidenceIt("rejects and removes an owned output with terminal mode drift", async () => {
    const parent = await mkdtemp(
      "/private/tmp/goodmemory-c6-wave1-structural-mode-",
    );
    temporaryRoots.push(parent);
    const outputPath = join(parent, "qualification.json");
    let hookCalled = false;

    await expect(
      materializeC6LiveMultiLangNeighborStructuralQualification({
        deepCaptureRoot: DEEP_ROOT,
        outputPath,
        planPath: PLAN_PATH,
        tranche: "wave1",
        testHooks: {
          afterOutputPublication: async () => {
            hookCalled = true;
            await chmod(outputPath, 0o600);
          },
        },
      }),
    ).rejects.toThrow(/published output ownership mismatch/u);
    expect(hookCalled).toBe(true);
    expect(await readdir(parent)).toEqual([]);
  }, 120_000);

  realEvidenceIt("publishes canonically without replacing an existing output", async () => {
    const parent = await mkdtemp(
      "/private/tmp/goodmemory-c6-wave1-structural-publish-",
    );
    temporaryRoots.push(parent);
    const outputPath = join(parent, "qualification.json");
    const result =
      await materializeC6LiveMultiLangNeighborStructuralQualification({
        deepCaptureRoot: DEEP_ROOT,
        outputPath,
        planPath: PLAN_PATH,
        tranche: "wave1",
      });
    const publishedBytes = await readFile(outputPath);

    expect(hash(publishedBytes)).toBe(result.outputSha256);
    expect(
      parseC6LiveMultiLangNeighborStructuralQualification(
        publishedBytes,
      ),
    ).toEqual(result.qualification);
    expect((await stat(outputPath)).mode & 0o777).toBe(0o644);

    await rm(outputPath);
    await writeFile(outputPath, "preexisting-sentinel\n", {
      mode: 0o600,
    });
    const sentinelStat = await stat(outputPath);
    let noReplaceError: unknown;
    try {
      await materializeC6LiveMultiLangNeighborStructuralQualification({
        deepCaptureRoot: DEEP_ROOT,
        outputPath,
        planPath: PLAN_PATH,
        tranche: "wave1",
      });
    } catch (error) {
      noReplaceError = error;
    }
    expect(noReplaceError).toMatchObject({ code: "EEXIST" });
    expect(await readFile(outputPath, "utf8")).toBe(
      "preexisting-sentinel\n",
    );
    expect(await stat(outputPath)).toMatchObject({
      dev: sentinelStat.dev,
      ino: sentinelStat.ino,
      mode: sentinelStat.mode,
    });
    expect(await readdir(parent)).toEqual(["qualification.json"]);
  }, 120_000);

  it("uses an exact and closed CLI option surface", () => {
    expect(
      parseC6LiveMultiLangNeighborStructuralQualificationCliOptions([
        "--deep-root=/capture",
        "--plan=/plan.json",
        "--output=/qualification.json",
        "--tranche=wave1",
      ]),
    ).toEqual({
      deepRoot: "/capture",
      output: "/qualification.json",
      plan: "/plan.json",
      tranche: "wave1",
    });
    expect(() =>
      parseC6LiveMultiLangNeighborStructuralQualificationCliOptions([
        "--deep-root=/capture",
        "--plan=/plan.json",
        "--output=/qualification.json",
        "--tranche=wave1",
        "--hidden-tests=true",
      ])
    ).toThrow(/unknown/u);
    expect(() =>
      parseC6LiveMultiLangNeighborStructuralQualificationCliOptions([
        "--deep-root=/capture",
        "--plan=/plan.json",
        "--output=/qualification.json",
        "--tranche=wave3",
      ])
    ).toThrow(/tranche/u);
  });

  it("rejects an invalid programmatic tranche at runtime", async () => {
    await expect(
      buildC6LiveMultiLangNeighborStructuralQualification({
        deepCaptureRoot: DEEP_ROOT,
        planPath: PLAN_PATH,
        tranche: "wave3" as "wave1",
      }),
    ).rejects.toThrow(/tranche/u);
  });
});

function syntheticEvidence(): C6LiveMultiLangNeighborDeepEvidence {
  const first = target({
    anchor: "example/repository#1",
    author: "pull-author",
    captureDirectory: "example__repository__1",
    commits: [
      commit("a", "2026-01-01T00:00:00Z", []),
      commit("b", "2026-01-01T02:00:00Z", ["a"]),
      commit("c", "2026-01-01T04:00:00Z", ["b"]),
    ],
    reviews: [{
      authorLogin: "reviewer-one",
      body:
        "This test outcome discusses a gold patch in ordinary prose.",
      commitOid: oid("a"),
      id: "review-one",
      state: "CHANGES_REQUESTED",
      submittedAt: "2026-01-01T01:00:00Z",
    }, {
      authorLogin: "null-reviewer",
      body: "Null submitted review remains actor evidence.",
      commitOid: oid("a"),
      id: "review-null",
      state: "CHANGES_REQUESTED",
      submittedAt: null,
    }],
    threads: [{
      comments: [{
        authorLogin: "reviewer-two",
        body: "Second structural observation.",
        createdAt: "2026-01-01T03:00:00Z",
        id: "comment-selected",
        originalCommitOid: oid("b"),
      }, {
        authorLogin: "reviewer-later",
        body: "This later comment is not structurally selected.",
        createdAt: "2026-01-01T03:10:00Z",
        id: "comment-later",
        originalCommitOid: oid("b"),
      }],
      id: "thread-one",
    }],
  });
  const second = target({
    anchor: "example/second#2",
    author: "second-author",
    captureDirectory: "example__second__2",
    commits: [commit("d", "2026-01-01T00:00:00Z", [])],
    reviews: [],
    threads: [{
      comments: [{
        authorLogin: "lonely-reviewer",
        body: "One event cannot make a two-review sequence.",
        createdAt: "2026-01-01T01:00:00Z",
        id: "lonely-comment",
        originalCommitOid: null,
      }],
      id: "thread-two",
    }],
  });
  const targets = [first, second];
  return {
    actorOccurrences: targets.flatMap(
      (entry) => entry.actorOccurrences,
    ),
    assetRootSha256: hash("root"),
    completionSha256: hash("completion"),
    directoryCount: 2,
    fileCount: 3,
    finalSuccessfulResponseCount: 2,
    logicalRequestCount: 2,
    networkRequestCount: 2,
    planSha256: hash("plan"),
    targets,
  };
}

function target(input: {
  anchor: string;
  author: string;
  captureDirectory: string;
  commits: Array<{
    committedDate: string;
    id: string;
    oid: string;
    parentOids: string[];
  }>;
  reviews: Array<{
    authorLogin: string | null;
    body: string;
    commitOid: string | null;
    id: string;
    state: string;
    submittedAt: string | null;
  }>;
  threads: Array<{
    comments: Array<{
      authorLogin: string | null;
      body: string;
      createdAt: string;
      id: string;
      originalCommitOid: string | null;
    }>;
    id: string;
  }>;
}): C6LiveMultiLangNeighborDeepEvidence["targets"][number] {
  const pullNumber = Number(input.anchor.split("#")[1]);
  const repository = input.anchor.split("#")[0]!;
  const actorOccurrences = [{
    actorLogin: input.author,
    canonicalAnchorId: input.anchor,
    eventId: `pull-${pullNumber}`,
    surface: "pull-author" as const,
  }, ...input.reviews.flatMap((review) =>
    review.authorLogin === null
      ? []
      : [{
        actorLogin: review.authorLogin,
        canonicalAnchorId: input.anchor,
        eventId: review.id,
        submittedAt: review.submittedAt,
        surface: "review" as const,
      }]
  ), ...input.threads.flatMap((thread) =>
    thread.comments.flatMap((comment) =>
      comment.authorLogin === null
        ? []
        : [{
          actorLogin: comment.authorLogin,
          canonicalAnchorId: input.anchor,
          createdAt: comment.createdAt,
          eventId: comment.id,
          surface: "review-thread-comment" as const,
          threadId: thread.id,
        }]
    )
  )];
  return {
    actorOccurrences,
    canonicalAnchorId: input.anchor,
    captureDirectory: input.captureDirectory,
    commits: input.commits,
    identity: {
      authorLogin: input.author,
      baseRefOid: oid("0"),
      baseRepositoryId: `base-${repository}`,
      baseRepositoryNameWithOwner: repository,
      createdAt: "2025-12-31T00:00:00Z",
      mergeCommitOid: oid("f"),
      mergedAt: "2026-01-02T00:00:00Z",
      pullRequestId: `pull-${pullNumber}`,
      pullRequestNumber: pullNumber,
      pullRequestUrl: `https://github.com/${repository}/pull/${pullNumber}`,
      repositoryId: `repository-${repository}`,
      repositoryNameWithOwner: repository,
    },
    rawResponseReferences: [],
    reviews: input.reviews,
    reviewSurfaceClosureSha256: hash(input.anchor),
    reviewThreads: input.threads,
  };
}

function commit(
  value: string,
  committedDate: string,
  parents: string[],
) {
  return {
    committedDate,
    id: `commit-${value}`,
    oid: oid(value),
    parentOids: parents.map(oid),
  };
}

function oid(value: string): string {
  return value.repeat(40);
}

function hash(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
