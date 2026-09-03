import { createHash } from "node:crypto";

import { z } from "zod";

import { buildC3HostConfigurationEvidence } from "./c3-host-configuration";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

const installedProfileSchema = z.object({
  activationMode: z.literal("global"),
  hookRegistered: z.literal(true),
  mcpRegistered: z.literal(true),
  persistRawTranscript: z.literal(false),
  retrievalProfile: z.literal("coding_agent"),
  workspaceStatus: z.literal("ok"),
  writebackMode: z.literal("selective"),
}).strict();

const normalizedConfigurationFileSchema = z.object({
  normalizedText: z.string(),
  sourceSha256: sha256Schema,
}).strict();

const normalizedArmHostConfigurationSchema = z.object({
  codexConfig: normalizedConfigurationFileSchema,
  environment: z.record(z.string(), z.string()),
  goodmemoryConfig: normalizedConfigurationFileSchema.nullable(),
  hooksConfig: normalizedConfigurationFileSchema.nullable(),
  profile: installedProfileSchema.nullable(),
}).strict();

const configurationDiffEntrySchema = z.object({
  goodmemoryInstalled: z.unknown(),
  noMemory: z.unknown(),
  path: z.string().min(1),
}).strict();

const hostConfigurationsSchema = z.object({
  arms: z.object({
    goodmemoryInstalled: normalizedArmHostConfigurationSchema,
    noMemory: normalizedArmHostConfigurationSchema,
  }).strict(),
  normalizedDiff: z.array(configurationDiffEntrySchema).min(1),
  schemaVersion: z.literal(1),
}).strict();

const featureEvidenceSchema = z.object({
  hooks: z.object({
    enabled: z.boolean(),
    maturity: z.string().min(1),
  }).strict(),
  memories: z.object({
    enabled: z.boolean(),
    maturity: z.string().min(1),
  }).strict(),
  outputSha256: sha256Schema,
  rawOutput: z.string().min(1),
}).strict();

const toolEvidenceSchema = z.object({
  sha256: sha256Schema,
  version: z.string().min(1),
}).strict();

const hostEnvironmentSchema = z.object({
  // Absent means the historical no-memory baseline; "flat-summary" marks the
  // comparator baseline, whose hooks.json and enabled hooks are expected.
  baselineArm: z.enum(["flat-summary", "no-memory"]).optional(),
  codexFeatures: z.object({
    goodmemoryInstalled: featureEvidenceSchema,
    noMemory: featureEvidenceSchema,
  }).strict(),
  configurations: hostConfigurationsSchema,
  goodmemory: z.object({
    configSha256: sha256Schema,
    executableSha256: sha256Schema,
    hooksSha256: sha256Schema,
    mcpExecutableSha256: sha256Schema,
    packageSha256: sha256Schema,
  }).strict(),
  platform: z.object({
    arch: z.string().min(1),
    cpuCount: z.number().int().positive(),
    name: z.string().min(1),
    totalMemoryBytes: z.number().int().positive(),
  }).strict(),
  repositoryPolicy: z.object({
    dirtyStatePolicy: z.literal("reject"),
    workspaceIsolation: z.literal("fresh-isolated-clone-per-stage"),
  }).strict(),
  toolchain: z.object({
    bun: toolEvidenceSchema,
    git: toolEvidenceSchema,
    node: toolEvidenceSchema,
    npm: toolEvidenceSchema,
    python: toolEvidenceSchema,
  }).strict(),
}).strict();

export type C5HostEnvironment = z.infer<typeof hostEnvironmentSchema>;
type C5HostArmConfiguration =
  C5HostEnvironment["configurations"]["arms"]["goodmemoryInstalled"];
type C5HostConfigurationFile = C5HostArmConfiguration["codexConfig"];

export function parseC5HostEnvironment(
  value: unknown,
  options: { expectedBaselineHooksSha256?: string } = {},
): C5HostEnvironment {
  const environment = hostEnvironmentSchema.parse(value);
  const installed = environment.configurations.arms.goodmemoryInstalled;
  const noMemory = environment.configurations.arms.noMemory;
  const flatSummaryBaseline = environment.baselineArm === "flat-summary";
  if (
    installed.goodmemoryConfig === null ||
    installed.hooksConfig === null ||
    installed.profile === null ||
    noMemory.goodmemoryConfig !== null ||
    (flatSummaryBaseline
      ? noMemory.hooksConfig === null ||
        (options.expectedBaselineHooksSha256 !== undefined &&
          noMemory.hooksConfig.sourceSha256 !==
            options.expectedBaselineHooksSha256)
      : noMemory.hooksConfig !== null) ||
    noMemory.profile !== null ||
    environment.goodmemory.configSha256 !==
      installed.goodmemoryConfig.sourceSha256 ||
    environment.goodmemory.hooksSha256 !== installed.hooksConfig.sourceSha256
  ) {
    throw new Error("C5 host configuration receipts are not cross-bound");
  }
  const installedFeatures = environment.codexFeatures.goodmemoryInstalled;
  const noMemoryFeatures = environment.codexFeatures.noMemory;
  if (
    !installedFeatures.hooks.enabled ||
    installedFeatures.hooks.maturity !== "stable" ||
    installedFeatures.memories.enabled ||
    noMemoryFeatures.hooks.enabled !== flatSummaryBaseline ||
    noMemoryFeatures.hooks.maturity !== "stable" ||
    noMemoryFeatures.memories.enabled ||
    installedFeatures.outputSha256 !== sha256(installedFeatures.rawOutput) ||
    noMemoryFeatures.outputSha256 !== sha256(noMemoryFeatures.rawOutput)
  ) {
    throw new Error("C5 Codex feature evidence is inconsistent");
  }
  const recomputed = buildC3HostConfigurationEvidence({
    goodmemoryInstalled: installed,
    noMemory,
  });
  if (
    JSON.stringify(recomputed.normalizedDiff) !==
      JSON.stringify(environment.configurations.normalizedDiff)
  ) {
    throw new Error("C5 normalized host configuration diff is inconsistent");
  }
  return environment;
}

export function projectC5ComparableHostEnvironment(
  environment: C5HostEnvironment,
) {
  const projectConfigurationFile = (
    file: C5HostConfigurationFile | null,
  ) => file === null ? null : { normalizedText: file.normalizedText };
  const projectArm = (arm: C5HostArmConfiguration) => ({
    codexConfig: projectConfigurationFile(arm.codexConfig),
    environment: Object.fromEntries(
      Object.entries(arm.environment).sort(([first], [second]) =>
        first.localeCompare(second)
      ),
    ),
    goodmemoryConfig: projectConfigurationFile(arm.goodmemoryConfig),
    hooksConfig: projectConfigurationFile(arm.hooksConfig),
    profile: arm.profile,
  });

  return {
    ...(environment.baselineArm === undefined
      ? {}
      : { baselineArm: environment.baselineArm }),
    codexFeatures: environment.codexFeatures,
    configurations: {
      arms: {
        goodmemoryInstalled: projectArm(
          environment.configurations.arms.goodmemoryInstalled,
        ),
        noMemory: projectArm(environment.configurations.arms.noMemory),
      },
      normalizedDiff: environment.configurations.normalizedDiff.filter(
        (entry) => !entry.path.endsWith(".sourceSha256"),
      ),
      schemaVersion: 1,
    },
    goodmemory: {
      executableSha256: environment.goodmemory.executableSha256,
      mcpExecutableSha256: environment.goodmemory.mcpExecutableSha256,
      packageSha256: environment.goodmemory.packageSha256,
    },
    platform: environment.platform,
    repositoryPolicy: environment.repositoryPolicy,
    schemaVersion: 1,
    toolchain: environment.toolchain,
  };
}

export function hashC5ComparableHostEnvironment(
  environment: C5HostEnvironment,
): string {
  return sha256(
    JSON.stringify(projectC5ComparableHostEnvironment(environment)),
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
