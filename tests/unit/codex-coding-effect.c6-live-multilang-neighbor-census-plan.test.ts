import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertC6LiveMultiLangNeighborCensusExactCaptureTree,
  buildC6LiveMultiLangNeighborCensusPlan,
  deriveC6LiveMultiLangNeighborCensusPlan,
} from "../../scripts/codex-coding-effect/c6-live-multilang-neighbor-census-plan";
import {
  parseC6LiveMultiLangNeighborCensusPlanCliOptions,
} from "../../scripts/snapshot-codex-coding-effect-c6-live-multilang-neighbor-census-plan";

describe("Codex coding-effect C6 Live/MultiLang neighbor census plan", () => {
  it("selects eight repositories per split in rotated rank order", () => {
    const input = fixture();
    const plan = deriveC6LiveMultiLangNeighborCensusPlan(input);
    const replay = deriveC6LiveMultiLangNeighborCensusPlan({
      ...input,
      observations: [...input.observations].reverse(),
    });

    expect(replay).toEqual(plan);
    expect(plan.boundary).toEqual({
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      censusCaptured: false,
      codexRunReady: false,
      machineQualifiedEpisodeCount: 0,
      semanticallyQualifiedEpisodeCount: 0,
      status: "repository-neighbor-census-plan-only",
    });
    expect(plan.counts).toEqual({
      canonicalRedirectCollapseCount: 1,
      canonicalRepositoryCount: 80,
      censusCandidateCeiling: 1024,
      currentFrameRepositoryCount: 9,
      eligibleRepositoryCount: 72,
      excludedCurrentFrameRepositoryCount: 8,
      selectedRepositoryCount: 64,
      sourceAnchorCount: 81,
      sourceRequestedRepositoryCount: 81,
    });
    expect(plan.splitCounts).toEqual({
      c: { eligible: 9, selected: 8 },
      cpp: { eligible: 9, selected: 8 },
      go: { eligible: 9, selected: 8 },
      js: { eligible: 9, selected: 8 },
      rust: { eligible: 9, selected: 8 },
      java: { eligible: 9, selected: 8 },
      ts: { eligible: 9, selected: 8 },
      cs: { eligible: 9, selected: 8 },
    });
    expect(
      plan.targets.slice(0, 10).map((target) => [
        target.pilotRank,
        target.sourceSplit,
        target.withinSplitRank,
        target.canonicalRepository,
      ]),
    ).toEqual([
      [1, "c", 1, "owner-c/repo-2"],
      [2, "cpp", 1, "owner-cpp/repo-2"],
      [3, "go", 1, "owner-go/repo-2"],
      [4, "js", 1, "owner-js/repo-2"],
      [5, "rust", 1, "owner-rust/repo-2"],
      [6, "java", 1, "owner-java/repo-2"],
      [7, "ts", 1, "owner-ts/repo-2"],
      [8, "cs", 1, "owner-cs/repo-2"],
      [9, "c", 2, "owner-c/repo-3"],
      [10, "cpp", 2, "owner-cpp/repo-3"],
    ]);
    expect(
      plan.targets.every(
        (target) =>
          target.censusCap === 16 &&
          !input.currentFrameRepositories.has(
            target.canonicalRepository,
          ),
      ),
    ).toBe(true);
    expect(
      plan.independenceBoundary.selectedRepositoryProjectionSha256,
    ).toBe(sha256(JSON.stringify(plan.targets.map((target) => ({
      pilotRank: target.pilotRank,
      sourceSplit: target.sourceSplit,
      withinSplitRank: target.withinSplitRank,
      canonicalRepository: target.canonicalRepository,
      seedCaptureOrder: target.seedCaptureOrder,
      seedAnchorId: target.seedAnchorId,
    })))));
  });

  it("fails closed on patch, test, gold, outcome, semantic, or machine fields", () => {
    const mutated = fixture();
    const first = mutated.observations[0]! as
      (typeof mutated.observations)[number] & Record<string, unknown>;
    first.patch = "hidden patch";
    first.test = "hidden tests";
    first.gold = "hidden gold";
    first.outcome = "PASS";
    first.semanticDecision = "accept";
    first.machineDecision = "pass";

    expect(() =>
      deriveC6LiveMultiLangNeighborCensusPlan(mutated)
    ).toThrow("forbidden selection input");
  });

  it("fails closed on redirect ambiguity and an undersupplied split", () => {
    const ambiguous = fixture();
    ambiguous.observations.push({
      canonicalAnchorId: "different/repository#1000",
      canonicalRepository: "different/repository",
      captureOrder: ambiguous.observations.length + 1,
      pullNumber: 1000,
      requestedAnchorId: "alias-c/repo-2#1000",
      requestedRepository: "alias-c/repo-2",
      sourceSplit: "c",
    });
    expect(() =>
      deriveC6LiveMultiLangNeighborCensusPlan(ambiguous)
    ).toThrow("redirect ambiguity");

    const undersupplied = fixture();
    undersupplied.currentFrameRepositories.add("owner-c/repo-2");
    undersupplied.currentFrameRepositories.add("owner-c/repo-3");
    expect(() =>
      deriveC6LiveMultiLangNeighborCensusPlan(undersupplied)
    ).toThrow("split c requires at least 8 eligible repositories");
  });

  it("fails closed on input hash drift and symlinked roots", async () => {
    const root = await realpath(
      await mkdtemp(
        join(tmpdir(), "goodmemory-c6-neighbor-plan-"),
      ),
    );
    try {
      const graphqlRoot = join(root, "graphql");
      await mkdir(graphqlRoot);
      await writeFile(join(graphqlRoot, "placeholder.json"), "{}\n");
      const planPath = join(root, "capture-plan.json");
      const framePath = join(root, "actor-frame.json");
      await Promise.all([
        writeFile(planPath, "{}\n"),
        writeFile(framePath, "{}\n"),
      ]);
      await expect(
        buildC6LiveMultiLangNeighborCensusPlan({
          actorFramePath: framePath,
          capturePlanPath: planPath,
          expectedActorFrameSha256: sha256("{}\n"),
          expectedCapturePlanSha256: "0".repeat(64),
          expectedGraphqlRootSha256: "0".repeat(64),
          graphqlRoot,
        }),
      ).rejects.toThrow("capture-plan hash mismatch");

      const link = join(root, "graphql-link");
      await symlink(graphqlRoot, link);
      await expect(
        buildC6LiveMultiLangNeighborCensusPlan({
          actorFramePath: framePath,
          capturePlanPath: planPath,
          expectedActorFrameSha256: sha256("{}\n"),
          expectedCapturePlanSha256: sha256("{}\n"),
          expectedGraphqlRootSha256: "0".repeat(64),
          graphqlRoot: link,
        }),
      ).rejects.toThrow("rejects symlink path component");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects root metadata, empty directories, and symlinked capture files on terminal replay", async () => {
    const root = await realpath(
      await mkdtemp(
        join(tmpdir(), "goodmemory-c6-neighbor-plan-tree-"),
      ),
    );
    const graphqlRoot = join(root, "graphql");
    const captureDirectory = join(graphqlRoot, "capture-1");
    const targets = [{ captureDirectory: "capture-1" }];
    try {
      await mkdir(captureDirectory, { recursive: true });
      await Promise.all([
        writeFile(join(captureDirectory, "capture.json"), "{}\n"),
        writeFile(join(captureDirectory, "request.json"), "{}\n"),
        writeFile(
          join(captureDirectory, "response-headers.json"),
          "{}\n",
        ),
        writeFile(join(captureDirectory, "response.json"), "{}\n"),
      ]);
      await expect(
        assertC6LiveMultiLangNeighborCensusExactCaptureTree(
          graphqlRoot,
          targets,
        ),
      ).resolves.toBeUndefined();

      const assetLockPath = join(graphqlRoot, "asset-lock.json");
      await writeFile(assetLockPath, "{}\n");
      await expect(
        assertC6LiveMultiLangNeighborCensusExactCaptureTree(
          graphqlRoot,
          targets,
        ),
      ).rejects.toThrow(
        "unexpected GraphQL root entry asset-lock.json",
      );
      await rm(assetLockPath);

      const emptyDirectory = join(graphqlRoot, "unexpected-empty");
      await mkdir(emptyDirectory);
      await expect(
        assertC6LiveMultiLangNeighborCensusExactCaptureTree(
          graphqlRoot,
          targets,
        ),
      ).rejects.toThrow(
        "unexpected GraphQL root entry unexpected-empty",
      );
      await rm(emptyDirectory, { recursive: true });

      const requestPath = join(captureDirectory, "request.json");
      const outsidePath = join(root, "outside.json");
      await writeFile(outsidePath, "{}\n");
      await rm(requestPath);
      await symlink(outsidePath, requestPath);
      await expect(
        assertC6LiveMultiLangNeighborCensusExactCaptureTree(
          graphqlRoot,
          targets,
        ),
      ).rejects.toThrow(
        "unexpected capture entry capture-1/request.json",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("parses every snapshot binding exactly once", () => {
    const hash = "a".repeat(64);
    expect(
      parseC6LiveMultiLangNeighborCensusPlanCliOptions([
        "--actor-frame=actor.json",
        `--expected-actor-frame-sha256=${hash}`,
        `--expected-capture-plan-sha256=${hash}`,
        `--expected-graphql-root-sha256=${hash}`,
        "--capture-plan=plan.json",
        "--graphql-root=/capture/root",
        "--output=plan-output.json",
      ]),
    ).toEqual({
      actorFrame: "actor.json",
      capturePlan: "plan.json",
      expectedActorFrameSha256: hash,
      expectedCapturePlanSha256: hash,
      expectedGraphqlRootSha256: hash,
      graphqlRoot: "/capture/root",
      output: "plan-output.json",
    });
    expect(() =>
      parseC6LiveMultiLangNeighborCensusPlanCliOptions([
        "--actor-frame=actor.json",
        `--expected-actor-frame-sha256=${hash}`,
        `--expected-capture-plan-sha256=${hash}`,
        `--expected-graphql-root-sha256=${hash}`,
        "--graphql-root=/capture/root",
        "--output=plan-output.json",
      ])
    ).toThrow("--capture-plan is required exactly once");
  });
});

const SPLITS = [
  "c",
  "cpp",
  "go",
  "js",
  "rust",
  "java",
  "ts",
  "cs",
] as const;

function fixture() {
  const observations = [];
  let captureOrder = 1;
  for (const split of SPLITS) {
    for (let rank = 1; rank <= 10; rank += 1) {
      const canonicalRepository = `owner-${split}/repo-${rank}`;
      observations.push({
        canonicalAnchorId: `${canonicalRepository}#${captureOrder}`,
        canonicalRepository,
        captureOrder,
        pullNumber: captureOrder,
        requestedAnchorId:
          `${canonicalRepository}#${captureOrder}`,
        requestedRepository: canonicalRepository,
        sourceSplit: split,
      });
      captureOrder += 1;
    }
  }
  observations.push({
    canonicalAnchorId: "owner-c/repo-2#999",
    canonicalRepository: "owner-c/repo-2",
    captureOrder,
    pullNumber: 999,
    requestedAnchorId: "alias-c/repo-2#999",
    requestedRepository: "alias-c/repo-2",
    sourceSplit: "c" as const,
  });
  return {
    currentFrameRepositories: new Set([
      ...SPLITS.map((split) => `owner-${split}/repo-1`),
      "frame-only/repository",
    ]),
    inputs: {
      actorFrame: reference("actor-frame.json"),
      actorFrameCandidateProjectionSha256: "b".repeat(64),
      capturePlan: reference("capture-plan.json"),
      capturePlanTargetProjectionSha256: "c".repeat(64),
      graphqlRootSha256: "d".repeat(64),
    },
    observations,
  };
}

function reference(path: string) {
  return {
    bytes: 1,
    path,
    sha256: "a".repeat(64),
  };
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
