import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildC6AssetLock,
  serializeC6AssetLock,
} from "../../scripts/codex-coding-effect/c6-asset-lock";
import {
  deriveC6ControlledMutationFamilyId,
  loadC6ControlledMutationSupply,
} from "../../scripts/codex-coding-effect/c6-controlled-mutation-supply";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("C6 controlled-mutation supply", () => {
  it("binds real-repository inputs and collapses cosmetic variants into one cell", async () => {
    const fixture = await createFixture();

    const evidence = await loadC6ControlledMutationSupply(fixture.input);

    expect(evidence).toEqual({
      assetLockSha256: fixture.assetLockSha256,
      assetRootSha256: fixture.assetRootSha256,
      baseRepositoryCount: 1,
      candidateManifestFrozen: false,
      codexRunReady: false,
      controlledMutationCellByEpisodeId: {
        "defu-array-precedence": fixture.arrayCellId,
        "defu-unsafe-key-filter": fixture.unsafeCellId,
        "defu-unsafe-key-filter-cosmetic": fixture.unsafeCellId,
      },
      evidenceScope:
        "controlled-mutation-supply-structure-plus-mechanical-lower-bounds",
      exactOutcomeCloneLowerBoundVerified: true,
      mutationFamilyCount: 2,
      promptLeakageLowerBoundVerified: true,
      qualifiedReserveRepresentativeCount: 0,
      representativeCellCount: 2,
      selectedRepresentativeCount: 2,
      semanticEquivalenceReviewVerified: false,
      semanticDuplicateCount: 1,
      supplySha256: fixture.supplySha256,
      totalDerivationCount: 3,
    });
  });

  it("derives family ids from the structured semantic contract", () => {
    const contract = semanticContract(
      "caller-array-precedes-default-array",
      "Caller-provided array entries precede default entries.",
    );

    expect(deriveC6ControlledMutationFamilyId(contract)).toBe(
      `mutation-family-${sha256(JSON.stringify(contract))}`,
    );
  });

  it("rejects a family id detached from its semantic contract", async () => {
    const fixture = await createFixture((supply) => {
      supply.mutationFamilies[0]!.mutationFamilyId =
        `mutation-family-${"f".repeat(64)}`;
      supply.derivations[0]!.mutationFamilyId =
        supply.mutationFamilies[0]!.mutationFamilyId;
    });

    await expect(loadC6ControlledMutationSupply(fixture.input)).rejects.toThrow(
      "mutation family id is not derived from its semantic contract",
    );
  });

  it("rejects exact evaluator and gold outcomes split into a new semantic family", async () => {
    const fixture = await createFixture((supply) => {
      const cloneContract = semanticContract(
        "constructor-and-prototype-keys-are-not-merged",
        "Constructor and prototype-shaped caller keys do not enter output.",
      );
      const cloneFamilyId = deriveFamilyId(cloneContract);
      supply.mutationFamilies.push({
        ...structuredClone(supply.mutationFamilies[1]!),
        mutationFamilyId: cloneFamilyId,
        semanticContract: cloneContract,
      });
      supply.derivations[2] = {
        ...structuredClone(supply.derivations[2]!),
        decision: "selected",
        mutationFamilyId: cloneFamilyId,
        representativeEpisodeId: "defu-unsafe-key-filter-cosmetic",
      };
    });

    await expect(loadC6ControlledMutationSupply(fixture.input)).rejects.toThrow(
      "exact evaluator and gold outcome clone",
    );
  });

  it("rejects gold and hidden evaluator fragments copied into a prompt", async () => {
    const fixture = await createFixture((supply, files) => {
      const promptPath =
        "provenance/controlled-mutation/prompts/unsafe-key.md";
      files.set(
        promptPath,
        [
          "Apply this exact fix and satisfy these exact hidden cases.",
          files.get(
            "provenance/controlled-mutation/patches/unsafe-gold.patch",
          )!,
          files.get(
            "provenance/controlled-mutation/evaluators/unsafe-f2p.json",
          )!,
        ].join("\n"),
      );
      supply.derivations[1]!.stages[0]!.prompt.sha256 = sha256(
        files.get(promptPath)!,
      );
    });

    await expect(loadC6ControlledMutationSupply(fixture.input)).rejects.toThrow(
      "agent-visible prompt leaks hidden artifact",
    );
  });

  it("checks each prompt against other families and base-health evaluators", async () => {
    const fixture = await createFixture((supply, files) => {
      const promptPath =
        "provenance/controlled-mutation/prompts/unsafe-key.md";
      files.set(
        promptPath,
        [
          "Use these unrelated hidden inputs.",
          files.get(
            "provenance/controlled-mutation/patches/array-gold.patch",
          )!,
          files.get(
            "provenance/controlled-mutation/evaluators/base-health.json",
          )!,
        ].join("\n"),
      );
      supply.derivations[1]!.stages[0]!.prompt.sha256 = sha256(
        files.get(promptPath)!,
      );
    });

    await expect(loadC6ControlledMutationSupply(fixture.input)).rejects.toThrow(
      "agent-visible prompt leaks hidden artifact",
    );
  });

  it("allows only the cell representative to be selected or reserve", async () => {
    const duplicateSelected = await createFixture((supply) => {
      supply.derivations[2]!.decision = "selected";
    });
    await expect(
      loadC6ControlledMutationSupply(duplicateSelected.input),
    ).rejects.toThrow("non-representative derivation must be semantic-duplicate");

    const representativeDuplicate = await createFixture((supply) => {
      supply.derivations[1]!.decision = "semantic-duplicate";
    });
    await expect(
      loadC6ControlledMutationSupply(representativeDuplicate.input),
    ).rejects.toThrow(
      "cell representative must be selected or qualified-reserve",
    );
  });

  it("rejects a representative split inside one repository-family mutation cell", async () => {
    const fixture = await createFixture((supply) => {
      supply.derivations[2]!.representativeEpisodeId =
        "defu-unsafe-key-filter-cosmetic";
    });

    await expect(loadC6ControlledMutationSupply(fixture.input)).rejects.toThrow(
      "controlled-mutation cell declares multiple representatives",
    );
  });

  it("keeps hidden evaluator artifacts outside agent-visible paths", async () => {
    const fixture = await createFixture((supply) => {
      supply.derivations[0]!.stages[0]!.evaluators.failToPass.path =
        "prompts/array-precedence.md";
      supply.derivations[0]!.stages[0]!.evaluators.failToPass.sha256 =
        supply.derivations[0]!.stages[0]!.prompt.sha256;
    });

    await expect(loadC6ControlledMutationSupply(fixture.input)).rejects.toThrow(
      "hidden evaluator artifacts must stay under provenance/controlled-mutation/evaluators",
    );
  });

  it("fails closed when a locked supply asset changes", async () => {
    const fixture = await createFixture();
    await writeFile(
      join(
        fixture.root,
        "provenance/controlled-mutation/prompts/array-precedence.md",
      ),
      "mutated\n",
    );

    await expect(loadC6ControlledMutationSupply(fixture.input)).rejects.toThrow(
      "asset lock does not match current assets",
    );
  });
});

interface ArtifactReference {
  path: string;
  sha256: string;
}

interface SemanticContract {
  behaviorId: string;
  changedSurface: string[];
  expectedBehavior: string;
  preservedBehavior: string[];
  schemaVersion: 1;
  targetExport: string;
}

interface SupplyFixture {
  baseRepositories: Array<{
    baseHealth: {
      evaluatorFactoryId: "bun-typescript-module-cases-v1";
      spec: ArtifactReference;
    };
    agentVisibleProjection: ArtifactReference;
    baseRepositoryId: string;
    canonicalUrl: string;
    ecosystem: string;
    language: string;
    license: {
      evidence: ArtifactReference;
      spdx: string;
    };
    repositoryFamilyId: string;
    sourceBundle: ArtifactReference;
    upstreamCommit: string;
    upstreamTree: string;
  }>;
  derivations: Array<{
    baseRepositoryId: string;
    decision: "qualified-reserve" | "selected" | "semantic-duplicate";
    episodeId: string;
    mutationFamilyId: string;
    representativeEpisodeId: string;
    stages: Array<{
      evaluators: {
        failToPass: ArtifactReference;
        passToPass: ArtifactReference;
      };
      goldPatch: ArtifactReference;
      goldTreeSha256: string;
      mutationPatch: ArtifactReference;
      preparedTreeSha256: string;
      prompt: ArtifactReference;
      stageId: string;
    }>;
    variantId: string;
  }>;
  mutationFamilies: Array<{
    evaluatorFactory: {
      id: "bun-typescript-module-cases-v1";
      source: ArtifactReference;
    };
    mutationFamilyId: string;
    primaryStratum: "failure-avoidance" | "project-convention";
    semanticContract: SemanticContract;
    stageCount: number;
  }>;
  schemaVersion: 1;
}

async function createFixture(
  mutate?: (
    supply: SupplyFixture,
    files: Map<string, string>,
  ) => void,
): Promise<{
  arrayCellId: string;
  assetLockSha256: string;
  assetRootSha256: string;
  input: Parameters<typeof loadC6ControlledMutationSupply>[0];
  root: string;
  supplySha256: string;
  unsafeCellId: string;
}> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "goodmemory-c6-mutation-supply-")),
  );
  roots.push(root);

  const files = new Map<string, string>([
    [
      "provenance/controlled-mutation/sources/defu.bundle",
      "fake-git-bundle\n",
    ],
    [
      "provenance/controlled-mutation/licenses/defu-mit.txt",
      "MIT License\n",
    ],
    [
      "provenance/controlled-mutation/evaluator-factories/bun-typescript-module-cases-v1.ts",
      "export const evaluatorFactory = true;\n",
    ],
    [
      "provenance/controlled-mutation/projections/defu-source-only.json",
      '{"projection":"source-only"}\n',
    ],
    [
      "provenance/controlled-mutation/evaluators/base-health.json",
      '{"cases":[]}\n',
    ],
    [
      "provenance/controlled-mutation/evaluators/array-f2p.json",
      '{"cases":["array-f2p"]}\n',
    ],
    [
      "provenance/controlled-mutation/evaluators/array-p2p.json",
      '{"cases":["array-p2p"]}\n',
    ],
    [
      "provenance/controlled-mutation/evaluators/unsafe-f2p.json",
      '{"cases":["unsafe-f2p"]}\n',
    ],
    [
      "provenance/controlled-mutation/evaluators/unsafe-p2p.json",
      '{"cases":["unsafe-p2p"]}\n',
    ],
    [
      "provenance/controlled-mutation/prompts/array-precedence.md",
      "Keep caller array entries before defaults.\n",
    ],
    [
      "provenance/controlled-mutation/prompts/unsafe-key.md",
      "Ignore unsafe object keys.\n",
    ],
    [
      "provenance/controlled-mutation/prompts/unsafe-key-cosmetic.md",
      "Do not merge unsafe keys from caller input.\n",
    ],
    [
      "provenance/controlled-mutation/patches/array-mutation.patch",
      "array mutation\n",
    ],
    [
      "provenance/controlled-mutation/patches/array-gold.patch",
      "array gold\n",
    ],
    [
      "provenance/controlled-mutation/patches/unsafe-mutation.patch",
      "unsafe mutation\n",
    ],
    [
      "provenance/controlled-mutation/patches/unsafe-mutation-cosmetic.patch",
      "unsafe mutation cosmetic\n",
    ],
    [
      "provenance/controlled-mutation/patches/unsafe-gold.patch",
      "unsafe gold\n",
    ],
  ]);

  const reference = (path: string): ArtifactReference => ({
    path,
    sha256: sha256(files.get(path)!),
  });
  const factorySource = reference(
    "provenance/controlled-mutation/evaluator-factories/bun-typescript-module-cases-v1.ts",
  );
  const arrayContract = semanticContract(
    "caller-array-precedes-default-array",
    "Caller-provided array entries precede default entries.",
  );
  const unsafeContract = semanticContract(
    "unsafe-object-keys-are-ignored",
    "Caller-provided constructor and __proto__ keys are ignored.",
  );
  const arrayFamilyId = deriveFamilyId(arrayContract);
  const unsafeFamilyId = deriveFamilyId(unsafeContract);
  const stage = (
    prefix: "array" | "unsafe",
    prompt: string,
    mutationPatch: string,
  ) => ({
    evaluators: {
      failToPass: reference(
        `provenance/controlled-mutation/evaluators/${prefix}-f2p.json`,
      ),
      passToPass: reference(
        `provenance/controlled-mutation/evaluators/${prefix}-p2p.json`,
      ),
    },
    goldPatch: reference(
      `provenance/controlled-mutation/patches/${prefix}-gold.patch`,
    ),
    goldTreeSha256: sha256(`${prefix}-gold-tree`),
    mutationPatch: reference(
      `provenance/controlled-mutation/patches/${mutationPatch}`,
    ),
    preparedTreeSha256: sha256(`${mutationPatch}-prepared-tree`),
    prompt: reference(
      `provenance/controlled-mutation/prompts/${prompt}`,
    ),
    stageId: "stage-1",
  });
  const supply: SupplyFixture = {
    baseRepositories: [
      {
        baseHealth: {
          evaluatorFactoryId: "bun-typescript-module-cases-v1",
          spec: reference(
            "provenance/controlled-mutation/evaluators/base-health.json",
          ),
        },
        agentVisibleProjection: reference(
          "provenance/controlled-mutation/projections/defu-source-only.json",
        ),
        baseRepositoryId: "defu-82632b6",
        canonicalUrl: "https://github.com/unjs/defu",
        ecosystem: "npm",
        language: "TypeScript",
        license: {
          evidence: reference(
            "provenance/controlled-mutation/licenses/defu-mit.txt",
          ),
          spdx: "MIT",
        },
        repositoryFamilyId: "repository-family-defu",
        sourceBundle: reference(
          "provenance/controlled-mutation/sources/defu.bundle",
        ),
        upstreamCommit: "8".repeat(40),
        upstreamTree: "9".repeat(40),
      },
    ],
    derivations: [
      {
        baseRepositoryId: "defu-82632b6",
        decision: "selected",
        episodeId: "defu-array-precedence",
        mutationFamilyId: arrayFamilyId,
        representativeEpisodeId: "defu-array-precedence",
        stages: [
          stage(
            "array",
            "array-precedence.md",
            "array-mutation.patch",
          ),
        ],
        variantId: "canonical",
      },
      {
        baseRepositoryId: "defu-82632b6",
        decision: "selected",
        episodeId: "defu-unsafe-key-filter",
        mutationFamilyId: unsafeFamilyId,
        representativeEpisodeId: "defu-unsafe-key-filter",
        stages: [
          stage(
            "unsafe",
            "unsafe-key.md",
            "unsafe-mutation.patch",
          ),
        ],
        variantId: "canonical",
      },
      {
        baseRepositoryId: "defu-82632b6",
        decision: "semantic-duplicate",
        episodeId: "defu-unsafe-key-filter-cosmetic",
        mutationFamilyId: unsafeFamilyId,
        representativeEpisodeId: "defu-unsafe-key-filter",
        stages: [
          stage(
            "unsafe",
            "unsafe-key-cosmetic.md",
            "unsafe-mutation-cosmetic.patch",
          ),
        ],
        variantId: "cosmetic-prompt-and-condition",
      },
    ],
    mutationFamilies: [
      {
        evaluatorFactory: {
          id: "bun-typescript-module-cases-v1",
          source: factorySource,
        },
        mutationFamilyId: arrayFamilyId,
        primaryStratum: "project-convention",
        semanticContract: arrayContract,
        stageCount: 1,
      },
      {
        evaluatorFactory: {
          id: "bun-typescript-module-cases-v1",
          source: factorySource,
        },
        mutationFamilyId: unsafeFamilyId,
        primaryStratum: "failure-avoidance",
        semanticContract: unsafeContract,
        stageCount: 1,
      },
    ],
    schemaVersion: 1,
  };
  mutate?.(supply, files);

  for (const [path, content] of files) {
    const absolutePath = join(root, path);
    await mkdir(join(absolutePath, ".."), { recursive: true });
    await writeFile(absolutePath, content);
  }
  const supplyPath =
    "provenance/controlled-mutation/supply.json";
  const supplyBytes = `${JSON.stringify(supply, null, 2)}\n`;
  await writeFile(join(root, supplyPath), supplyBytes);
  const assetLock = await buildC6AssetLock(root);
  const assetLockBytes = serializeC6AssetLock(assetLock);
  await writeFile(join(root, "asset-lock.json"), assetLockBytes);

  return {
    arrayCellId: deriveCellId(
      "repository-family-defu",
      arrayFamilyId,
    ),
    assetLockSha256: sha256(assetLockBytes),
    assetRootSha256: assetLock.assetRootSha256,
    input: {
      assetRoot: root,
      expectedAssetLockSha256: sha256(assetLockBytes),
      expectedAssetRootSha256: assetLock.assetRootSha256,
      expectedSupplySha256: sha256(supplyBytes),
    },
    root,
    supplySha256: sha256(supplyBytes),
    unsafeCellId: deriveCellId(
      "repository-family-defu",
      unsafeFamilyId,
    ),
  };
}

function semanticContract(
  behaviorId: string,
  expectedBehavior: string,
): SemanticContract {
  return {
    behaviorId,
    changedSurface: ["src/defu.ts"],
    expectedBehavior,
    preservedBehavior: ["all-unrelated-defu-merge-behavior"],
    schemaVersion: 1,
    targetExport: "defu",
  };
}

function deriveFamilyId(contract: SemanticContract): string {
  return `mutation-family-${sha256(JSON.stringify(contract))}`;
}

function deriveCellId(
  repositoryFamilyId: string,
  mutationFamilyId: string,
): string {
  return `controlled-cell-${sha256(JSON.stringify([
    repositoryFamilyId,
    mutationFamilyId,
  ]))}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
