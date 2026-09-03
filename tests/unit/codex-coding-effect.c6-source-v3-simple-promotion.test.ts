import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  dirname,
  join,
  resolve,
} from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "bun:test";

import {
  buildC6SourceV3SimplePromotionReceipt as buildFromWorkspace,
  C6_SOURCE_V3_SIMPLE_CENSUS_ACTIVATION_SOURCE,
  C6_SOURCE_V3_SIMPLE_CENSUS_IMPLEMENTATION_PATH,
  C6_SOURCE_V3_SIMPLE_PROMOTION_CLI_PATH,
  C6_SOURCE_V3_SIMPLE_PROMOTION_FROZEN_PATHS,
  C6_SOURCE_V3_SIMPLE_PROMOTION_VERIFIER_PATH,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-promotion";
import {
  parseC6SourceV3SimplePromotionCliOptions,
} from "../../scripts/promote-codex-coding-effect-c6-source-v3-simple";

const execFileAsync = promisify(execFile);
const workspaceRoot = process.cwd();
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, {
        force: true,
        recursive: true,
      })
    ),
  );
});

describe("C6 source-v3-simple promotion gate", () => {
  it("keeps the repository census activation byte-exact", async () => {
    const activationPath = resolve(
      workspaceRoot,
      C6_SOURCE_V3_SIMPLE_CENSUS_IMPLEMENTATION_PATH,
    );
    expect(await readFile(activationPath, "utf8")).toBe(
      C6_SOURCE_V3_SIMPLE_CENSUS_ACTIVATION_SOURCE,
    );
    const activation = await loadCensusActivation(workspaceRoot);
    expect(
      activation.C6_SOURCE_V3_SIMPLE_CENSUS_ACTIVATION_VERSION,
    ).toBe(1);
    expect(
      activation.requireC6SourceV3SimpleCensusAuthorization,
    ).toBeFunction();
  });

  it("promotes only an exact one-parent freeze followed by a strict census implementation descendant", async () => {
    const repository = await createPromotionRepository();
    const outputPath = join(repository.root, "promotion.json");
    const cli = await loadPromotionCli(repository.root);
    const promotion = await loadPromotionModule(repository.root);
    const result =
      await cli.materializeC6SourceV3SimplePromotionReceipt({
        censusImplementationCommitSha:
          repository.censusImplementationCommitSha,
        freezeCommitSha: repository.freezeCommitSha,
        outputPath,
        repositoryRoot: repository.root,
      });
    const publishedBytes = await readFile(outputPath);
    const censusActivation = await loadCensusActivation(
      repository.root,
    );
    const censusAuthorization =
      await censusActivation
        .requireC6SourceV3SimpleCensusAuthorization({
          promotionInput: {
            censusImplementationCommitSha:
              repository.censusImplementationCommitSha,
            freezeCommitSha: repository.freezeCommitSha,
            promotionBaseCommitSha:
              repository.censusImplementationCommitSha,
            repositoryRoot: repository.root,
          },
          promotionReceiptBytes: publishedBytes,
        });
    expect(censusAuthorization).toEqual({
      candidateManifestFrozen: false,
      candidateSelectionPermitted: false,
      codexRunReady: false,
      evaluationId:
        "goodmemory-c6-codex-coding-effect-source-v3-simple-v1",
      formalCensusPermitted: true,
      priorRepositoryNodeIdExclusionComplete: true,
      sourceV3SimpleFrozen: true,
    });
    const receipt = JSON.parse(
      publishedBytes.toString("utf8"),
    ) as {
      artifactKind: string;
      boundary: Record<string, boolean | string>;
      censusImplementation: {
        activationPath: string;
        commitSha: string;
        treeSha: string;
      };
      freeze: {
        commitSha: string;
        parentCommitSha: string;
        treeSha: string;
      };
      promotionBase: {
        commitSha: string;
        treeSha: string;
      };
      frozenArtifacts: Array<{
        bytes: number;
        path: string;
        sha256: string;
      }>;
      reviewIdentities: {
        priorRepositoryIdentity: {
          authorTaskName: string;
          cryptographicReviewIndependence: false;
          reviewerAgentName: string;
        };
        protocol: {
          authorTaskName: string;
          cryptographicReviewIndependence: false;
          reviewerAgentName: string;
        };
      };
      status: string;
    };

    expect(result).toMatchObject({
      candidateManifestFrozen: false,
      codexRunReady: false,
      formalCensusPermitted: true,
      priorRepositoryNodeIdExclusionComplete: true,
      sourceV3SimpleFrozen: true,
    });
    expect(result.receiptSha256).toBe(
      sha256(publishedBytes),
    );
    expect(receipt).toMatchObject({
      artifactKind: "c6-source-v3-simple-promotion-receipt",
      boundary: {
        candidateManifestFrozen: false,
        candidateSelectionPermitted: false,
        captureOriginIndependentlyVerified: false,
        codexRunReady: false,
        cryptographicReviewIndependence: false,
        externalAuthenticityVerified: false,
        formalCensusPermitted: true,
        independentCaptureProcessProven: false,
        liveNetworkExecutionProven: false,
        priorRepositoryNodeIdExclusionComplete: true,
        sourceV3SimpleFrozen: true,
      },
      censusImplementation: {
        commitSha:
          repository.censusImplementationCommitSha,
        activationPath:
          C6_SOURCE_V3_SIMPLE_CENSUS_IMPLEMENTATION_PATH,
      },
      freeze: {
        commitSha: repository.freezeCommitSha,
      },
      promotionBase: {
        commitSha:
          repository.censusImplementationCommitSha,
      },
      status:
        "formal-source-row-census-only-no-candidate-allocation-manifest-or-codex-run-authority",
    });
    expect(
      receipt.freeze.parentCommitSha,
    ).toMatch(/^[a-f0-9]{40}$/u);
    expect(receipt.freeze.treeSha).toMatch(/^[a-f0-9]{40}$/u);
    expect(receipt.censusImplementation.treeSha).toMatch(
      /^[a-f0-9]{40}$/u,
    );
    expect(
      receipt.frozenArtifacts.map(({ path }) => path),
    ).toEqual([
      ...C6_SOURCE_V3_SIMPLE_PROMOTION_FROZEN_PATHS,
    ]);
    expect(
      C6_SOURCE_V3_SIMPLE_PROMOTION_FROZEN_PATHS,
    ).toContain("package.json");
    expect(
      C6_SOURCE_V3_SIMPLE_PROMOTION_FROZEN_PATHS,
    ).toContain("bun.lock");
    expect(
      receipt.reviewIdentities.protocol.authorTaskName,
    ).not.toBe(
      receipt.reviewIdentities.protocol.reviewerAgentName,
    );
    expect(
      receipt.reviewIdentities.priorRepositoryIdentity
        .authorTaskName,
    ).not.toBe(
      receipt.reviewIdentities.priorRepositoryIdentity
        .reviewerAgentName,
    );

    const verified =
      await promotion.verifyC6SourceV3SimplePromotionReceipt(
        publishedBytes,
        {
          censusImplementationCommitSha:
            repository.censusImplementationCommitSha,
          freezeCommitSha: repository.freezeCommitSha,
          promotionBaseCommitSha:
            repository.censusImplementationCommitSha,
          repositoryRoot: repository.root,
        },
      );
    expect(
      promotion.serializeC6SourceV3SimplePromotionReceipt(verified),
    ).toBe(publishedBytes.toString("utf8"));
    await expect(
      promotion.verifyC6SourceV3SimplePromotionReceipt(
        publishedBytes.toString("utf8").trimEnd(),
        {
          censusImplementationCommitSha:
            repository.censusImplementationCommitSha,
          freezeCommitSha: repository.freezeCommitSha,
          promotionBaseCommitSha:
            repository.censusImplementationCommitSha,
          repositoryRoot: repository.root,
        },
      ),
    ).rejects.toThrow("not canonical JSON");
    await expect(
      cli.materializeC6SourceV3SimplePromotionReceipt({
        censusImplementationCommitSha:
          repository.censusImplementationCommitSha,
        freezeCommitSha: repository.freezeCommitSha,
        outputPath,
        repositoryRoot: repository.root,
      }),
    ).rejects.toThrow();

    const forged = structuredClone(receipt);
    forged.boundary.codexRunReady = true;
    await expect(
      promotion.verifyC6SourceV3SimplePromotionReceipt(
        `${JSON.stringify(forged, null, 2)}\n`,
        {
          censusImplementationCommitSha:
            repository.censusImplementationCommitSha,
          freezeCommitSha: repository.freezeCommitSha,
          promotionBaseCommitSha:
            repository.censusImplementationCommitSha,
          repositoryRoot: repository.root,
        },
      ),
    ).rejects.toThrow();

    await git(repository.root, ["add", "promotion.json"]);
    await git(repository.root, [
      "commit",
      "-m",
      "retain promotion receipt",
    ]);
    await expect(
      promotion.verifyC6SourceV3SimplePromotionReceipt(
        publishedBytes,
        {
          censusImplementationCommitSha:
            repository.censusImplementationCommitSha,
          freezeCommitSha: repository.freezeCommitSha,
          promotionBaseCommitSha:
            repository.censusImplementationCommitSha,
          repositoryRoot: repository.root,
        },
      ),
    ).resolves.toEqual(verified);
  }, 180_000);

  it("parses only the four exact create-only CLI inputs", () => {
    expect(
      parseC6SourceV3SimplePromotionCliOptions([
        "--repository-root=/tmp/repository",
        `--freeze-commit-sha=${"1".repeat(40)}`,
        `--census-implementation-commit-sha=${"2".repeat(40)}`,
        "--output=/tmp/promotion.json",
      ]),
    ).toEqual({
      censusImplementationCommitSha: "2".repeat(40),
      freezeCommitSha: "1".repeat(40),
      outputPath: "/tmp/promotion.json",
      repositoryRoot: "/tmp/repository",
    });
    expect(() =>
      parseC6SourceV3SimplePromotionCliOptions([
        "--repository-root=/tmp/repository",
      ])
    ).toThrow("--freeze-commit-sha is required");
    expect(() =>
      parseC6SourceV3SimplePromotionCliOptions([
        "--repository-root=/tmp/repository",
        "--repository-root=/tmp/other",
      ])
    ).toThrow(
      "--repository-root cannot be specified more than once",
    );
    expect(() =>
      parseC6SourceV3SimplePromotionCliOptions([
        "--repository-root=/tmp/repository",
        "--unknown=value",
      ])
    ).toThrow("unknown C6 source-v3-simple promotion option");
  });

  it("rejects equal commits, non-ancestry, multi-parent freezes, and a marker already present at freeze", async () => {
    const equal = await createPromotionRepository();
    await expect(
      build(
        equal.root,
        "A".repeat(40),
        equal.censusImplementationCommitSha,
      ),
    ).rejects.toThrow();
    await expect(
      build(equal.root, equal.freezeCommitSha, equal.freezeCommitSha),
    ).rejects.toThrow("strict descendant");

    const nonAncestor = await createPromotionRepository();
    await git(nonAncestor.root, [
      "checkout",
      "--detach",
      nonAncestor.freezeParentCommitSha,
    ]);
    await copyFrozenPaths(nonAncestor.root);
    await materializeMarker(nonAncestor.root);
    await git(nonAncestor.root, ["add", "."]);
    await git(nonAncestor.root, [
      "commit",
      "-m",
      "sibling census implementation",
    ]);
    const siblingCommitSha = await gitOutput(nonAncestor.root, [
      "rev-parse",
      "HEAD",
    ]);
    await expect(
      build(
        nonAncestor.root,
        nonAncestor.freezeCommitSha,
        siblingCommitSha,
      ),
    ).rejects.toThrow("strict descendant");

    const multiParent = await createMultiParentFreezeRepository();
    await expect(
      build(
        multiParent.root,
        multiParent.freezeCommitSha,
        multiParent.censusImplementationCommitSha,
      ),
    ).rejects.toThrow("exactly one parent");

    const markerAtFreeze = await createPromotionRepository({
      beforeFreeze: materializeMarker,
      afterFreeze: async (root) => {
        await writeFile(
          join(
            root,
            C6_SOURCE_V3_SIMPLE_CENSUS_IMPLEMENTATION_PATH,
          ),
          "export const censusImplementationVersion = 2;\n",
        );
      },
    });
    await expect(
      build(
        markerAtFreeze.root,
        markerAtFreeze.freezeCommitSha,
        markerAtFreeze.censusImplementationCommitSha,
      ),
    ).rejects.toThrow(
      "activation entrypoint must be absent from the freeze commit",
    );
  }, 120_000);

  it("rejects frozen artifact drift and promotion verifier drift in the census implementation commit", async () => {
    const artifactDrift = await createPromotionRepository({
      afterFreeze: async (root) => {
        const path = C6_SOURCE_V3_SIMPLE_PROMOTION_FROZEN_PATHS.find(
          (entry) => entry.endsWith("/review/request.json"),
        );
        if (path === undefined) {
          throw new Error("protocol review request path missing");
        }
        await writeFile(
          join(root, path),
          `${await readFile(join(root, path), "utf8")} `,
        );
        await materializeMarker(root);
      },
    });
    await expect(
      build(
        artifactDrift.root,
        artifactDrift.freezeCommitSha,
        artifactDrift.censusImplementationCommitSha,
      ),
    ).rejects.toThrow("changed after the freeze commit");

    const verifierDrift = await createPromotionRepository({
      afterFreeze: async (root) => {
        await writeFile(
          join(root, C6_SOURCE_V3_SIMPLE_PROMOTION_VERIFIER_PATH),
          "\n",
          { flag: "a" },
        );
        await materializeMarker(root);
      },
    });
    await expect(
      build(
        verifierDrift.root,
        verifierDrift.freezeCommitSha,
        verifierDrift.censusImplementationCommitSha,
      ),
    ).rejects.toThrow("promotion verifier changed");

    const dependencyDrift = await createPromotionRepository({
      afterFreeze: async (root) => {
        await writeFile(
          join(root, "bun.lock"),
          "\n",
          { flag: "a" },
        );
        await materializeMarker(root);
      },
    });
    await expect(
      build(
        dependencyDrift.root,
        dependencyDrift.freezeCommitSha,
        dependencyDrift.censusImplementationCommitSha,
      ),
    ).rejects.toThrow(
      "frozen artifact bun.lock changed after the freeze commit",
    );
  }, 120_000);

  it("rejects self-review, review authority mutation, and corrupted portable archives even when frozen", async () => {
    const selfReview = await createPromotionRepository({
      beforeFreeze: mutateProtocolReviewToSelfReview,
    });
    await expect(
      build(
        selfReview.root,
        selfReview.freezeCommitSha,
        selfReview.censusImplementationCommitSha,
      ),
    ).rejects.toThrow("reviewer must be separate from the author");

    const authority = await createPromotionRepository({
      beforeFreeze: mutateProtocolReviewAuthority,
    });
    await expect(
      build(
        authority.root,
        authority.freezeCommitSha,
        authority.censusImplementationCommitSha,
      ),
    ).rejects.toThrow();

    const archive = await createPromotionRepository({
      beforeFreeze: async (root) => {
        const archivePath = C6_SOURCE_V3_SIMPLE_PROMOTION_FROZEN_PATHS
          .find((path) => path.endsWith("/capture-a.tar.gz"));
        if (archivePath === undefined) {
          throw new Error("capture archive path missing");
        }
        const bytes = await readFile(join(root, archivePath));
        bytes[20] = bytes[20]! ^ 0xff;
        await writeFile(join(root, archivePath), bytes);
      },
    });
    await expect(
      build(
        archive.root,
        archive.freezeCommitSha,
        archive.censusImplementationCommitSha,
      ),
    ).rejects.toThrow("archive reference mismatch");

    const detachedReplay = await createPromotionRepository({
      beforeFreeze: mutateEmbeddedPortableReplayReceipt,
    });
    await expect(
      build(
        detachedReplay.root,
        detachedReplay.freezeCommitSha,
        detachedReplay.censusImplementationCommitSha,
      ),
    ).rejects.toThrow(
      "embedded replay receipt does not equal the standalone committed replay receipt",
    );
  }, 120_000);

  it("rejects a promotion history disconnected from the running repository", async () => {
    const disconnected = await createPromotionRepository();

    await expect(
      buildFromWorkspace({
        censusImplementationCommitSha:
          disconnected.censusImplementationCommitSha,
        freezeCommitSha: disconnected.freezeCommitSha,
        promotionBaseCommitSha:
          disconnected.censusImplementationCommitSha,
        repositoryRoot: disconnected.root,
      }),
    ).rejects.toThrow(
      "promotion repository must be the running repository",
    );
  }, 120_000);

  it("rejects a dummy census marker that does not implement the frozen activation contract", async () => {
    const dummy = await createPromotionRepository({
      afterFreeze: materializeDummyMarker,
    });

    await expect(
      build(
        dummy.root,
        dummy.freezeCommitSha,
        dummy.censusImplementationCommitSha,
      ),
    ).rejects.toThrow(
      "census implementation does not equal the frozen activation contract",
    );
  }, 120_000);

  it("binds a descendant promotion HEAD and rejects bases before the census implementation or different from HEAD", async () => {
    const descendant = await createPromotionRepository();
    await writeFile(join(descendant.root, "after-census.txt"), "bound\n");
    await git(descendant.root, ["add", "after-census.txt"]);
    await git(descendant.root, [
      "commit",
      "-m",
      "promotion base descendant",
    ]);
    const descendantBaseCommitSha = await gitOutput(
      descendant.root,
      ["rev-parse", "HEAD"],
    );
    const receipt = await build(
      descendant.root,
      descendant.freezeCommitSha,
      descendant.censusImplementationCommitSha,
    );
    expect(receipt.promotionBase.commitSha).toBe(
      descendantBaseCommitSha,
    );

    const beforeImplementation = await createPromotionRepository();
    await git(beforeImplementation.root, [
      "checkout",
      "--detach",
      beforeImplementation.freezeCommitSha,
    ]);
    await expect(
      build(
        beforeImplementation.root,
        beforeImplementation.freezeCommitSha,
        beforeImplementation.censusImplementationCommitSha,
      ),
    ).rejects.toThrow(
      "census implementation commit must be an ancestor of or equal to the promotion base",
    );

    const wrongBase = await createPromotionRepository();
    const promotion = await loadPromotionModule(wrongBase.root);
    await expect(
      promotion.buildC6SourceV3SimplePromotionReceipt({
        censusImplementationCommitSha:
          wrongBase.censusImplementationCommitSha,
        freezeCommitSha: wrongBase.freezeCommitSha,
        promotionBaseCommitSha: wrongBase.freezeCommitSha,
        repositoryRoot: wrongBase.root,
      }),
    ).rejects.toThrow(
      "promotion base must equal the running repository HEAD",
    );
  }, 120_000);

  it("does not confuse an unreadable freeze blob with an absent census activation path", async () => {
    const repository = await createPromotionRepository({
      beforeFreeze: materializeDummyMarker,
    });
    const oldBlobSha = await gitOutput(repository.root, [
      "rev-parse",
      `${repository.freezeCommitSha}:` +
        C6_SOURCE_V3_SIMPLE_CENSUS_IMPLEMENTATION_PATH,
    ]);
    const looseObjectPath = await gitOutput(repository.root, [
      "rev-parse",
      "--git-path",
      `objects/${oldBlobSha.slice(0, 2)}/${oldBlobSha.slice(2)}`,
    ]);
    await rm(resolve(repository.root, looseObjectPath));

    await expect(
      build(
        repository.root,
        repository.freezeCommitSha,
        repository.censusImplementationCommitSha,
      ),
    ).rejects.toThrow(
      "census activation entrypoint must be absent from the freeze commit",
    );
  }, 120_000);

  it("uses the raw repository object view despite replace refs and inherited Git environment", async () => {
    const replaced = await createPromotionRepository();
    await git(replaced.root, [
      "replace",
      "--graft",
      replaced.freezeCommitSha,
    ]);
    const replacedReceipt = await build(
      replaced.root,
      replaced.freezeCommitSha,
      replaced.censusImplementationCommitSha,
    );
    expect(replacedReceipt.freeze.parentCommitSha).toBe(
      replaced.freezeParentCommitSha,
    );

    const repository = await createPromotionRepository();
    const decoy = await createPromotionRepository();
    const promotion = await loadPromotionModule(repository.root);
    const previousGitDir = process.env.GIT_DIR;
    process.env.GIT_DIR = join(decoy.root, ".git");
    try {
      const receipt =
        await promotion.buildC6SourceV3SimplePromotionReceipt({
          censusImplementationCommitSha:
            repository.censusImplementationCommitSha,
          freezeCommitSha: repository.freezeCommitSha,
          promotionBaseCommitSha:
            repository.censusImplementationCommitSha,
          repositoryRoot: repository.root,
        });
      expect(receipt.promotionBase.commitSha).toBe(
        repository.censusImplementationCommitSha,
      );
    } finally {
      if (previousGitDir === undefined) {
        delete process.env.GIT_DIR;
      } else {
        process.env.GIT_DIR = previousGitDir;
      }
    }

    const grafted = await createPromotionRepository();
    await writeFile(
      join(grafted.root, ".git", "info", "grafts"),
      `${grafted.freezeCommitSha}\n`,
    );
    await expect(
      build(
        grafted.root,
        grafted.freezeCommitSha,
        grafted.censusImplementationCommitSha,
      ),
    ).rejects.toThrow("rejects legacy Git grafts");
  }, 120_000);
});

interface PromotionRepository {
  censusImplementationCommitSha: string;
  freezeCommitSha: string;
  freezeParentCommitSha: string;
  root: string;
}

async function createPromotionRepository(
  hooks: {
    afterFreeze?: (root: string) => Promise<void>;
    beforeFreeze?: (root: string) => Promise<void>;
  } = {},
): Promise<PromotionRepository> {
  const root = await temporaryRoot("promotion-git");
  await initializeGitRepository(root);
  const freezeParentCommitSha = await gitOutput(root, [
    "rev-parse",
    "HEAD",
  ]);
  await copyFrozenPaths(root);
  await hooks.beforeFreeze?.(root);
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "freeze source v3 simple"]);
  const freezeCommitSha = await gitOutput(root, [
    "rev-parse",
    "HEAD",
  ]);
  if (hooks.afterFreeze === undefined) {
    await materializeMarker(root);
  } else {
    await hooks.afterFreeze(root);
  }
  await git(root, ["add", "."]);
  await git(root, [
    "commit",
    "--allow-empty",
    "-m",
    "implement formal census",
  ]);
  return {
    censusImplementationCommitSha: await gitOutput(root, [
      "rev-parse",
      "HEAD",
    ]),
    freezeCommitSha,
    freezeParentCommitSha,
    root,
  };
}

async function createMultiParentFreezeRepository():
Promise<PromotionRepository> {
  const root = await temporaryRoot("promotion-merge");
  await initializeGitRepository(root);
  const freezeParentCommitSha = await gitOutput(root, [
    "rev-parse",
    "HEAD",
  ]);
  await copyFrozenPaths(root);
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "freeze content"]);
  const contentCommit = await gitOutput(root, [
    "rev-parse",
    "HEAD",
  ]);
  await git(root, ["checkout", "-b", "side"]);
  await writeFile(join(root, "side.txt"), "side\n");
  await git(root, ["add", "side.txt"]);
  await git(root, ["commit", "-m", "side"]);
  await git(root, ["checkout", "-b", "main-line", contentCommit]);
  await writeFile(join(root, "main.txt"), "main\n");
  await git(root, ["add", "main.txt"]);
  await git(root, ["commit", "-m", "main"]);
  await git(root, [
    "merge",
    "--no-ff",
    "--no-edit",
    "side",
  ]);
  const freezeCommitSha = await gitOutput(root, [
    "rev-parse",
    "HEAD",
  ]);
  await materializeMarker(root);
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "implement formal census"]);
  return {
    censusImplementationCommitSha: await gitOutput(root, [
      "rev-parse",
      "HEAD",
    ]),
    freezeCommitSha,
    freezeParentCommitSha,
    root,
  };
}

async function initializeGitRepository(root: string): Promise<void> {
  await git(root, ["init", "-q"]);
  await git(root, ["config", "user.email", "c6@example.invalid"]);
  await git(root, ["config", "user.name", "C6 Test"]);
  await writeFile(join(root, "base.txt"), "base\n");
  await git(root, ["add", "base.txt"]);
  await git(root, ["commit", "-m", "base"]);
}

async function copyFrozenPaths(root: string): Promise<void> {
  for (const path of C6_SOURCE_V3_SIMPLE_PROMOTION_FROZEN_PATHS) {
    const destination = join(root, path);
    await mkdir(dirname(destination), {
      recursive: true,
    });
    await copyFile(join(workspaceRoot, path), destination);
  }
}

async function materializeMarker(root: string): Promise<void> {
  const path = join(
    root,
    C6_SOURCE_V3_SIMPLE_CENSUS_IMPLEMENTATION_PATH,
  );
  await mkdir(dirname(path), {
    recursive: true,
  });
  await writeFile(
    path,
    C6_SOURCE_V3_SIMPLE_CENSUS_ACTIVATION_SOURCE,
  );
}

async function materializeDummyMarker(root: string): Promise<void> {
  const path = join(
    root,
    C6_SOURCE_V3_SIMPLE_CENSUS_IMPLEMENTATION_PATH,
  );
  await mkdir(dirname(path), {
    recursive: true,
  });
  await writeFile(
    path,
    "export const censusImplementationVersion = 1;\n",
  );
}

async function mutateProtocolReviewToSelfReview(
  root: string,
): Promise<void> {
  const reviewRoot = join(
    root,
    "fixtures/codex-coding-effect/c6-source-pool/provenance/" +
      "source-v3-simple/review",
  );
  const dispatchPath = join(reviewRoot, "dispatch.json");
  const responsePath = join(reviewRoot, "response.json");
  const provenancePath = join(reviewRoot, "provenance.json");
  const dispatch = JSON.parse(
    await readFile(dispatchPath, "utf8"),
  ) as {
    authorTaskName: string;
    reviewerAgentName: string;
  };
  dispatch.reviewerAgentName = dispatch.authorTaskName;
  const dispatchBytes = canonicalJson(dispatch);
  await writeFile(dispatchPath, dispatchBytes);

  const response = JSON.parse(
    await readFile(responsePath, "utf8"),
  ) as {
    dispatchSha256: string;
    reviewerAgentName: string;
  };
  response.dispatchSha256 = sha256(dispatchBytes);
  response.reviewerAgentName = dispatch.authorTaskName;
  const responseBytes = canonicalJson(response);
  await writeFile(responsePath, responseBytes);

  const provenance = JSON.parse(
    await readFile(provenancePath, "utf8"),
  ) as {
    dispatch: ArtifactReference;
    response: ArtifactReference;
    reviewer: { agentName: string };
  };
  provenance.dispatch = artifactReference(
    provenance.dispatch.path,
    dispatchBytes,
  );
  provenance.response = artifactReference(
    provenance.response.path,
    responseBytes,
  );
  provenance.reviewer.agentName = dispatch.authorTaskName;
  await writeFile(provenancePath, canonicalJson(provenance));
}

async function mutateProtocolReviewAuthority(
  root: string,
): Promise<void> {
  const responsePath = join(
    root,
    "fixtures/codex-coding-effect/c6-source-pool/provenance/" +
      "source-v3-simple/review/response.json",
  );
  const response = JSON.parse(
    await readFile(responsePath, "utf8"),
  ) as {
    boundary: { formalCensusPermitted: boolean };
  };
  response.boundary.formalCensusPermitted = true;
  await writeFile(responsePath, canonicalJson(response));
}

async function mutateEmbeddedPortableReplayReceipt(
  root: string,
): Promise<void> {
  const manifestPath = join(
    root,
    "fixtures/codex-coding-effect/c6-source-pool/provenance/" +
      "source-v3-simple/prior-repository-identity/" +
      "portable-evidence-v1/portable-evidence.json",
  );
  const manifest = JSON.parse(
    await readFile(manifestPath, "utf8"),
  ) as {
    replayReceipt: {
      bytes: number;
      canonicalJson: string;
      sha256: string;
    };
  };
  manifest.replayReceipt.canonicalJson =
    manifest.replayReceipt.canonicalJson.replace(
      '"totalNetworkAttemptCount": 712',
      '"totalNetworkAttemptCount": 713',
    );
  manifest.replayReceipt.bytes = Buffer.byteLength(
    manifest.replayReceipt.canonicalJson,
  );
  manifest.replayReceipt.sha256 = sha256(
    manifest.replayReceipt.canonicalJson,
  );
  await writeFile(manifestPath, canonicalJson(manifest));
}

async function build(
  repositoryRoot: string,
  freezeCommitSha: string,
  censusImplementationCommitSha: string,
) {
  const promotion = await loadPromotionModule(repositoryRoot);
  return promotion.buildC6SourceV3SimplePromotionReceipt({
    censusImplementationCommitSha,
    freezeCommitSha,
    promotionBaseCommitSha: await gitOutput(
      repositoryRoot,
      ["rev-parse", "HEAD"],
    ),
    repositoryRoot,
  });
}

type PromotionModule = typeof import(
  "../../scripts/codex-coding-effect/c6-source-v3-simple-promotion"
);

type PromotionCliModule = typeof import(
  "../../scripts/promote-codex-coding-effect-c6-source-v3-simple"
);

interface CensusActivationModule {
  C6_SOURCE_V3_SIMPLE_CENSUS_ACTIVATION_VERSION: 1;
  requireC6SourceV3SimpleCensusAuthorization(input: {
    promotionInput: {
      censusImplementationCommitSha: string;
      freezeCommitSha: string;
      promotionBaseCommitSha: string;
      repositoryRoot: string;
    };
    promotionReceiptBytes: string | Uint8Array;
  }): Promise<{
    candidateManifestFrozen: false;
    candidateSelectionPermitted: false;
    codexRunReady: false;
    evaluationId: string;
    formalCensusPermitted: true;
    priorRepositoryNodeIdExclusionComplete: true;
    sourceV3SimpleFrozen: true;
  }>;
}

async function loadPromotionModule(
  repositoryRoot: string,
): Promise<PromotionModule> {
  return import(
    pathToFileURL(join(
      repositoryRoot,
      C6_SOURCE_V3_SIMPLE_PROMOTION_VERIFIER_PATH,
    )).href
  ) as Promise<PromotionModule>;
}

async function loadPromotionCli(
  repositoryRoot: string,
): Promise<PromotionCliModule> {
  return import(
    pathToFileURL(join(
      repositoryRoot,
      C6_SOURCE_V3_SIMPLE_PROMOTION_CLI_PATH,
    )).href
  ) as Promise<PromotionCliModule>;
}

async function loadCensusActivation(
  repositoryRoot: string,
): Promise<CensusActivationModule> {
  return import(
    pathToFileURL(join(
      repositoryRoot,
      C6_SOURCE_V3_SIMPLE_CENSUS_IMPLEMENTATION_PATH,
    )).href
  ) as Promise<CensusActivationModule>;
}

interface ArtifactReference {
  byteLength: number;
  path: string;
  sha256: string;
}

function artifactReference(
  path: string,
  value: string | Uint8Array,
): ArtifactReference {
  const bytes = Buffer.from(value);
  return {
    byteLength: bytes.byteLength,
    path,
    sha256: sha256(bytes),
  };
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function temporaryRoot(label: string): Promise<string> {
  const root = await mkdtemp(join(
    workspaceRoot,
    `.c6-${label}-`,
  ));
  temporaryRoots.push(root);
  return root;
}

async function git(
  root: string,
  args: readonly string[],
): Promise<void> {
  await execFileAsync("git", args, {
    cwd: root,
    maxBuffer: 10 * 1_024 * 1_024,
  });
}

async function gitOutput(
  root: string,
  args: readonly string[],
): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 10 * 1_024 * 1_024,
  });
  return stdout.trim();
}
