import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import type { CodexCodingEffectEvidenceClass } from "./contracts";

const identifierSchema = z.string()
  .min(1)
  .regex(/^[a-z0-9][a-z0-9._-]*$/u);
const trimmedStringSchema = z.string().min(1).refine(
  (value) => value.trim() === value,
  "value cannot be whitespace-padded",
);
const gitCommitSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const commandSchema = z.array(trimmedStringSchema).min(1);

export const CODEX_CODING_EFFECT_MEMORY_STRATA = [
  "open-loop-handoff",
  "validated-approach",
  "failure-avoidance",
  "user-correction",
  "project-convention",
  "stale-update",
  "irrelevant-memory-negative-control",
  "no-history-negative-control",
] as const;

const memoryStratumSchema = z.enum(CODEX_CODING_EFFECT_MEMORY_STRATA);

const relativeManifestPathSchema = trimmedStringSchema.refine(
  isPortableRelativePath,
  "path must be a normalized relative POSIX path without traversal",
);

const expectedMemoryDependencySchema = z.object({
  category: memoryStratumSchema,
  description: trimmedStringSchema,
}).strict();

const stageBaseShape = {
  allowedFeedback: z.array(trimmedStringSchema),
  hiddenFailToPass: commandSchema,
  hiddenPassToPass: commandSchema,
  id: identifierSchema,
  position: z.number().int().positive(),
  promptPath: relativeManifestPathSchema,
  snapshot: gitCommitSchema,
  timeoutMs: z.number().int().positive(),
  visibleTest: commandSchema.optional(),
};

const stageV1Schema = z.object({
  ...stageBaseShape,
  expectedMemoryDependencies: z.array(expectedMemoryDependencySchema),
}).strict();

const goldPatchSchema = z.object({
  path: relativeManifestPathSchema.refine(
    (value) => value.startsWith("evaluator/"),
    "stage gold patch must be under evaluator/",
  ),
  sha256: sha256Schema,
}).strict();

const memoryExpectationSchema = z.object({
  dependencies: z.array(expectedMemoryDependencySchema),
  mode: z.enum(["none", "required", "irrelevant-control"]),
}).strict().superRefine((expectation, context) => {
  if (expectation.mode === "none" && expectation.dependencies.length > 0) {
    context.addIssue({
      code: "custom",
      message: "memory expectation mode none cannot declare dependencies",
      path: ["dependencies"],
    });
  }
  if (expectation.mode !== "none" && expectation.dependencies.length === 0) {
    context.addIssue({
      code: "custom",
      message: `memory expectation mode ${expectation.mode} requires dependencies`,
      path: ["dependencies"],
    });
  }
});

const stageV2Schema = z.object({
  ...stageBaseShape,
  expectedChangedFiles: z.array(relativeManifestPathSchema.refine(
    (value) => !value.startsWith("evaluator/"),
    "expected changed files must stay in the agent workspace",
  )).min(1),
  goldPatch: goldPatchSchema,
  memoryExpectation: memoryExpectationSchema,
}).strict().superRefine((stage, context) => {
  const files = new Set<string>();
  for (const [index, file] of stage.expectedChangedFiles.entries()) {
    if (files.has(file)) {
      context.addIssue({
        code: "custom",
        message: `stage ${stage.id} repeats expected changed file ${file}`,
        path: ["expectedChangedFiles", index],
      });
    }
    files.add(file);
  }
});

const frozenHistorySchema = z.object({
  forbiddenLeakageSha256: z.array(sha256Schema),
  path: relativeManifestPathSchema,
  sha256: sha256Schema,
  source: z.literal("frozen-artifact"),
}).strict();

const prehistorySchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("none"),
  }).strict(),
  frozenHistorySchema,
  z.object({
    source: z.literal("native-longitudinal"),
  }).strict(),
]);

const taskOriginReceiptSchema = z.object({
  path: relativeManifestPathSchema.refine(
    (value) => value.startsWith("provenance/task-origin/reviews/"),
    "task-origin receipt must stay under provenance/task-origin/reviews/",
  ),
  sha256: sha256Schema,
}).strict();

const taskOriginReviewProvenanceSchema = z.object({
  path: relativeManifestPathSchema.refine(
    (value) =>
      value === "provenance/task-origin/review/provenance.json",
    "task-origin review provenance must use the canonical path",
  ),
  sha256: sha256Schema,
}).strict();

const sourceLineageSchema = z.object({
  path: relativeManifestPathSchema.refine(
    (value) =>
      value === "provenance/dataset-lineage/lineage.json",
    "dataset source lineage must use the canonical path",
  ),
  sha256: sha256Schema,
}).strict();

const leakageScalarSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
const leakageRelationSchema = z.tuple([
  leakageScalarSchema,
  leakageScalarSchema,
]);

const episodeBaseShape = {
  allowedPublicLeakageRelations: z.array(leakageRelationSchema).optional(),
  allowedPublicLeakageValues: z.array(leakageScalarSchema).optional(),
  author: trimmedStringSchema,
  claimEligibility: z.enum(["pilot-only", "claim-eligible"]),
  ecosystem: trimmedStringSchema,
  forbiddenLeakage: z.object({
    fileSha256: z.array(sha256Schema),
    strings: z.array(trimmedStringSchema),
  }).strict(),
  id: identifierSchema,
  language: trimmedStringSchema,
  preparation: z.object({
    command: commandSchema,
    networkMode: z.enum([
      "disabled",
      "dependency-setup-only",
      "allowlisted",
    ]),
  }).strict(),
  provenance: trimmedStringSchema,
  repository: z.object({
    assetPath: relativeManifestPathSchema.refine(
      (value) => value.startsWith("repositories/"),
      "repository asset path must stay under repositories/",
    ).optional(),
    baseCommit: gitCommitSchema,
    license: trimmedStringSchema,
    redistributionAllowed: z.boolean().optional(),
    redistributionReviewed: z.boolean().optional(),
    url: z.url().refine(
      (value) => value.startsWith("https://") || value.startsWith("http://"),
      "repository.url must use http or https",
    ),
  }).strict(),
  sourceType: z.enum([
    "controlled-mutation",
    "real-history",
    "external-benchmark",
  ]),
  stateMode: z.enum(["canonical-snapshot", "persistent-branch"]),
  strata: z.array(memoryStratumSchema).min(1),
  taskOriginReceipt: taskOriginReceiptSchema.optional(),
};

const episodeV1Schema = z.object({
  ...episodeBaseShape,
  goldPatchPath: relativeManifestPathSchema.refine(
    (value) => value.startsWith("evaluator/"),
    "goldPatchPath must be under evaluator/",
  ),
  prehistory: prehistorySchema,
  stages: z.array(stageV1Schema).min(1),
}).strict().superRefine((episode, context) => {
  validateEpisodeStructure(
    episode.id,
    episode.strata,
    episode.stages.map((stage) => ({
      dependencies: stage.expectedMemoryDependencies,
      id: stage.id,
      position: stage.position,
    })),
    (message, path) => context.addIssue({ code: "custom", message, path }),
  );
});

const episodeV2Schema = z.object({
  ...episodeBaseShape,
  prehistory: prehistorySchema,
  primaryStratum: memoryStratumSchema.optional(),
  stages: z.array(stageV2Schema).min(1),
}).strict().superRefine((episode, context) => {
  validateEpisodeStructure(
    episode.id,
    episode.strata,
    episode.stages.map((stage) => ({
      dependencies: stage.memoryExpectation.dependencies,
      id: stage.id,
      position: stage.position,
    })),
    (message, path) => context.addIssue({ code: "custom", message, path }),
  );
});

const stageV3Schema = stageV2Schema.safeExtend({
  history: frozenHistorySchema,
});

const episodeV3Schema = z.object({
  ...episodeBaseShape,
  historyPolicy: z.literal("stage-scoped-sealed-prefix-v1"),
  primaryStratum: memoryStratumSchema.optional(),
  stages: z.array(stageV3Schema).min(1),
}).strict().superRefine((episode, context) => {
  if (
    episode.claimEligibility === "claim-eligible" &&
    episode.sourceType !== "controlled-mutation" &&
    episode.taskOriginReceipt === undefined
  ) {
    context.addIssue({
      code: "custom",
      message:
        `C6 ${episode.sourceType} episode ${episode.id} requires task-origin evidence`,
      path: ["taskOriginReceipt"],
    });
  }
  validateEpisodeStructure(
    episode.id,
    episode.strata,
    episode.stages.map((stage) => ({
      dependencies: stage.memoryExpectation.dependencies,
      id: stage.id,
      position: stage.position,
    })),
    (message, path) => context.addIssue({ code: "custom", message, path }),
  );
});

const datasetV1Schema = z.object({
  datasetId: identifierSchema,
  episodes: z.array(episodeV1Schema).min(1),
  schemaVersion: z.literal(1),
}).strict().superRefine((dataset, context) => {
  validateDatasetEpisodeIds(
    dataset.episodes,
    (message, path) => context.addIssue({ code: "custom", message, path }),
  );
});

const datasetV2Schema = z.object({
  datasetId: identifierSchema,
  episodes: z.array(episodeV2Schema).min(1),
  schemaVersion: z.literal(2),
  sourceLineage: sourceLineageSchema.optional(),
  taskOriginReviewProvenance: taskOriginReviewProvenanceSchema.optional(),
}).strict().superRefine((dataset, context) => {
  validateDatasetEpisodeIds(
    dataset.episodes,
    (message, path) => context.addIssue({ code: "custom", message, path }),
  );
});

const datasetV3Schema = z.object({
  datasetId: identifierSchema,
  episodes: z.array(episodeV3Schema).min(1),
  schemaVersion: z.literal(3),
  sourceLineage: sourceLineageSchema.optional(),
  taskOriginReviewProvenance: taskOriginReviewProvenanceSchema.optional(),
}).strict().superRefine((dataset, context) => {
  validateDatasetEpisodeIds(
    dataset.episodes,
    (message, path) => context.addIssue({ code: "custom", message, path }),
  );
});

const datasetSchema = z.discriminatedUnion("schemaVersion", [
  datasetV1Schema,
  datasetV2Schema,
  datasetV3Schema,
]);

export type CodexCodingEffectDatasetV1 = z.infer<typeof datasetV1Schema>;
export type CodexCodingEffectDatasetV2 = z.infer<typeof datasetV2Schema>;
export type CodexCodingEffectDatasetV3 = z.infer<typeof datasetV3Schema>;
export type CodexCodingEffectDataset = z.infer<typeof datasetSchema>;
export type CodexCodingEffectEpisode = CodexCodingEffectDataset["episodes"][number];

export interface LoadedCodexCodingEffectDataset {
  dataset: CodexCodingEffectDataset;
  manifestPath: string;
  manifestSha256: string;
}

export function parseCodexCodingEffectDataset(
  value: unknown,
): CodexCodingEffectDataset {
  const result = datasetSchema.safeParse(value);
  if (result.success) {
    return result.data;
  }

  const details = result.error.issues.map((issue) => {
    const path = issue.path.join(".");
    return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
  });
  throw new Error(`invalid Codex coding-effect dataset: ${details.join("; ")}`);
}

export function selectCodexCodingEffectEpisodes(
  dataset: CodexCodingEffectDataset,
  input: {
    episodeIds: readonly string[];
    evidenceClass: CodexCodingEffectEvidenceClass;
  },
): CodexCodingEffectEpisode[] {
  const requestedIds = new Set(input.episodeIds);
  const knownIds = new Set(dataset.episodes.map((episode) => episode.id));
  for (const episodeId of requestedIds) {
    if (!knownIds.has(episodeId)) {
      throw new Error(`dataset does not contain selected episode ${episodeId}`);
    }
  }

  const selected = input.episodeIds.length === 0
    ? [...dataset.episodes]
    : dataset.episodes.filter((episode) => requestedIds.has(episode.id));

  if (input.evidenceClass === "codex-coding-effect-candidate") {
    const pilotOnly = selected.find(
      (episode) => episode.claimEligibility === "pilot-only",
    );
    if (pilotOnly) {
      throw new Error(
        `claim-candidate runs cannot select pilot-only episode ${pilotOnly.id}`,
      );
    }
  }

  return selected;
}

export async function loadCodexCodingEffectDataset(
  datasetRoot: string,
): Promise<LoadedCodexCodingEffectDataset> {
  const manifestPath = join(datasetRoot, "manifest.json");
  const raw = await readFile(manifestPath, "utf8");
  const value: unknown = JSON.parse(raw);

  return {
    dataset: parseCodexCodingEffectDataset(value),
    manifestPath,
    manifestSha256: createHash("sha256").update(raw).digest("hex"),
  };
}

function validateEpisodeStructure(
  episodeId: string,
  declaredStrata: readonly string[],
  stages: readonly {
    dependencies: readonly { category: string }[];
    id: string;
    position: number;
  }[],
  addIssue: (message: string, path: (string | number)[]) => void,
): void {
  const strata = new Set<string>();
  for (const stratum of declaredStrata) {
    if (strata.has(stratum)) {
      addIssue(
        `episode ${episodeId} contains duplicate stratum ${stratum}`,
        ["strata"],
      );
    }
    strata.add(stratum);
  }

  const stageIds = new Set<string>();
  for (const [index, stage] of stages.entries()) {
    if (stageIds.has(stage.id)) {
      addIssue(
        `episode ${episodeId} contains duplicate stage id ${stage.id}`,
        ["stages", index, "id"],
      );
    }
    stageIds.add(stage.id);

    if (stage.position !== index + 1) {
      addIssue(
        `episode ${episodeId} stage positions must be contiguous from 1`,
        ["stages", index, "position"],
      );
    }

    for (const dependency of stage.dependencies) {
      if (!strata.has(dependency.category)) {
        addIssue(
          `stage ${stage.id} uses undeclared memory stratum ${dependency.category}`,
          ["stages", index, "memoryDependencies"],
        );
      }
    }
  }
}

function validateDatasetEpisodeIds(
  episodes: readonly { id: string }[],
  addIssue: (message: string, path: (string | number)[]) => void,
): void {
  const episodeIds = new Set<string>();
  for (const [index, episode] of episodes.entries()) {
    if (episodeIds.has(episode.id)) {
      addIssue(
        `dataset contains duplicate episode id ${episode.id}`,
        ["episodes", index, "id"],
      );
    }
    episodeIds.add(episode.id);
  }
}

function isPortableRelativePath(value: string): boolean {
  if (value.startsWith("/") || value.includes("\\")) {
    return false;
  }

  const segments = value.split("/");
  return segments.every(
    (segment) => segment.length > 0 && segment !== "." && segment !== "..",
  );
}
