import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  cp,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  c4RepositoryIdForUrl,
} from "../../scripts/codex-coding-effect/c4-controlled-dataset";
import {
  validateC4ControlledPilotDataset,
} from "../../scripts/codex-coding-effect/c4-contracts";
import {
  buildC5StageLeakageInput,
} from "../../scripts/codex-coding-effect/c5-leakage-input";
import {
  auditC5LiveLeakageSurfaces,
} from "../../scripts/codex-coding-effect/c5-live-leakage";
import { loadCodexCodingEffectDataset } from "../../scripts/codex-coding-effect/dataset";

const DATASET_ROOT = "fixtures/codex-coding-effect/c4-controlled-pilot";

describe("Codex coding-effect C5 leakage input", () => {
  it("keeps empty prehistory fail-closed unless a C6 caller opts in", async () => {
    const root = await mkdtemp(
      join(await realpath(tmpdir()), "goodmemory-c5-empty-leakage-"),
    );
    try {
      await cp(DATASET_ROOT, root, { recursive: true });
      const loaded = await loadCodexCodingEffectDataset(root);
      const dataset = validateC4ControlledPilotDataset(loaded.dataset);
      const episode = dataset.episodes[0]!;
      const stage = episode.stages[0]!;
      const prehistory = episode.prehistory;
      if (prehistory.source !== "frozen-artifact") {
        throw new Error("fixture requires frozen prehistory");
      }
      await writeFile(join(root, prehistory.path), "");
      episode.prehistory = {
        ...prehistory,
        sha256: sha256(""),
      };
      const input = {
        datasetRoot: root,
        episode,
        repositoryRoot: join(
          root,
          "repositories",
          c4RepositoryIdForUrl(episode.repository.url),
        ),
        stage,
      };

      await expect(buildC5StageLeakageInput(input)).rejects.toThrow(
        "frozen prehistory must contain at least one record",
      );
      const auditInput = await buildC5StageLeakageInput({
        ...input,
        allowEmptyPrehistory: true,
      });
      expect(auditInput.staticSurfaces.find((surface) =>
        surface.id === "frozen-prehistory"
      )?.content).toBe("");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("honors asset-locked public relation proofs without exempting other relations", async () => {
    const loaded = await loadCodexCodingEffectDataset(DATASET_ROOT);
    const dataset = validateC4ControlledPilotDataset(loaded.dataset);
    const episode = dataset.episodes.find((candidate) =>
      candidate.id === "parse-result-correction"
    )!;
    const stage = episode.stages[0]!;

    const input = await buildC5StageLeakageInput({
      datasetRoot: DATASET_ROOT,
      episode,
      repositoryRoot: join(
        DATASET_ROOT,
        "repositories",
        c4RepositoryIdForUrl(episode.repository.url),
      ),
      stage,
    });
    const hidden = input.artifacts.find((artifact) =>
      artifact.id === "hidden-test-source"
    )!;
    const allowed = new Set((episode.allowedPublicLeakageRelations ?? [])
      .map((relation) => JSON.stringify(relation)));

    expect(hidden.hiddenValueRelations?.length).toBeGreaterThan(0);
    expect(hidden.hiddenValueRelations?.some((relation) =>
      allowed.has(JSON.stringify(relation))
    )).toBe(false);
  });

  it("reconstructs the frozen static surfaces and hidden artifacts for a live stage", async () => {
    const loaded = await loadCodexCodingEffectDataset(DATASET_ROOT);
    const dataset = validateC4ControlledPilotDataset(loaded.dataset);
    const episode = dataset.episodes.find((candidate) =>
      candidate.id === "delimiter-boundary-policy"
    )!;
    const stage = episode.stages[1]!;
    const input = await buildC5StageLeakageInput({
      datasetRoot: DATASET_ROOT,
      episode,
      repositoryRoot: join(
        DATASET_ROOT,
        "repositories",
        c4RepositoryIdForUrl(episode.repository.url),
      ),
      stage,
    });

    expect(input.staticSurfaces.map((surface) => surface.id).sort()).toEqual([
      "allowed-feedback",
      "frozen-prehistory",
      "repository-instructions",
      "stage-prompts",
      "visible-repository-files",
    ]);
    expect(input.artifacts.map((artifact) => artifact.id).sort()).toEqual([
      "expected-changed-files",
      "gold-patches",
      "hidden-test-source",
    ]);
    const clean = auditC5LiveLeakageSurfaces({
      ...input,
      liveSurfaces: [
        {
          content: "Apply the accepted public delimiter policy.",
          id: "effective-codex-input-after-seeding",
        },
        { content: "", id: "flat-summary-after-seeding" },
        { content: '{"memories":[]}', id: "goodmemory-export-after-seeding" },
        {
          content: "Apply the accepted public delimiter policy.",
          id: "goodmemory-hook-context-after-seeding",
        },
      ],
      trajectoryOrigins: [],
    });
    expect(clean.status).toBe("accepted");

    const hiddenSentinel = "C4_HIDDEN|delimiter-boundary-policy|stage-2";
    const leaked = auditC5LiveLeakageSurfaces({
      ...input,
      liveSurfaces: [
        { content: "public prompt", id: "effective-codex-input-after-seeding" },
        { content: "", id: "flat-summary-after-seeding" },
        { content: '{"memories":[]}', id: "goodmemory-export-after-seeding" },
        {
          content: hiddenSentinel,
          id: "goodmemory-hook-context-after-seeding",
        },
      ],
      trajectoryOrigins: [],
    });
    expect(leaked.status).toBe("rejected");
    expect(leaked.liveCells).toContainEqual(expect.objectContaining({
      artifactId: "hidden-test-source",
      status: "rejected",
      surfaceId: "goodmemory-hook-context-after-seeding",
    }));
  });
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
