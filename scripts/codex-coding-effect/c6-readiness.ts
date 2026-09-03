import { createHash } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";

import { z } from "zod";

import {
  loadC6AssetLock,
  readC6StableRegularFile as readRegularFile,
  verifyC6AssetClosure,
} from "./c6-asset-lock";
import type {
  C6AssetLock,
} from "./c6-asset-lock";
import {
  buildC6CandidatePlan,
  serializeC6CandidatePlan,
} from "./c6-candidate-plan";
import type {
  C6CandidatePlan,
  C6TaskOriginStageEvidence,
} from "./c6-candidate-plan";
import {
  inspectC6PackageTarball,
} from "./c6-package";
import {
  loadC6DatasetLineage,
} from "./c6-dataset-lineage";
import {
  parseC6GatePolicy,
} from "./c6-gate-policy";
import {
  loadC6RepositoryDesignEvidence,
} from "./c6-repository-design-evidence";
import {
  C6_FLAT_SUMMARY_CORPUS_STATUS,
  C6_FLAT_SUMMARY_GENERATION_POLICY,
  C6_FLAT_SUMMARY_INJECTION_COMPOSITION,
  C6_INJECTION_TOKEN_COUNTER_ID,
  C6_INJECTION_TOKEN_COUNTER_SHA256,
  C6_NO_HISTORY_CONTROL,
  computeC6FlatSummaryGenerationKey,
  verifyC6FlatSummaryCorpusCompleteness,
} from "./c6-flat-summary";
import type {
  C6FlatSummaryCorpus,
  C6FlatSummaryCorpusExpectation,
} from "./c6-flat-summary";
import {
  auditC6CandidateStaticLeakage,
} from "./c6-leakage";
import {
  validateC6TaskOriginReviewProvenance,
} from "./c6-task-origin-review";
import {
  assertC6TaskRelationshipEdgeCoverage,
  listC6TaskRelationshipArtifactReferences,
  validateC6TaskRelationshipReceipt,
} from "./c6-task-relationship-receipt";
import type {
  C6TaskRelationshipEvidence,
} from "./c6-task-relationship-receipt";
import {
  parseCodexCodingEffectDataset,
} from "./dataset";
import type {
  CodexCodingEffectDatasetV3,
} from "./dataset";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const gitObjectSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const trimmedStringSchema = z.string().min(1).refine(
  (value) => value.trim() === value,
  "value cannot be whitespace-padded",
);
const localRelativePathSchema = trimmedStringSchema.refine(
  (value) =>
    !value.startsWith("/") &&
    !value.split(/[\\/]/u).includes(".."),
  "value must be a contained relative path",
);
const acceptedPilotBoundary = z.literal(
  "internal-native-longitudinal-pilot-only",
);
const acceptedPilotClass = z.literal("native-longitudinal-pilot");
const ACCEPTED_C5_V16 = {
  artifacts: {
    gate:
      "16a7864adbf5c496d004f8b484ece89242cbe92438a84dfee2e0c06ab806380c",
    independentReview:
      "bd19614ab8b8034c4cd3fe0db97073765153199a4e0511b0c01b76addef7e5d8",
    provenance:
      "0099cffd09defd0204602a4d1d96d693aa6913cbe20ae517e0aa9539d81c0d66",
    report:
      "5985be5969750286ef2d2af623741e12051d3830f96bd4b8e0907b849b1eab0b",
    verification:
      "de8aea82bb832d406256877d902f068037c6e9fb3e1a3530ae24480744d28af8",
  },
  runId: "run-c5-pilot-v16-20260721T150112Z",
} as const;

const gateSchema = z.object({
  claimBoundary: acceptedPilotBoundary,
  decision: z.literal("accepted"),
  evidenceClass: acceptedPilotClass,
  independentReviewSha256: sha256Schema,
  planSha256: sha256Schema,
  projectionManifestSha256: sha256Schema,
  publicClaimEligible: z.literal(false),
  publicCodingEffectProof: z.literal(false),
  reasons: z.tuple([]),
  reviewProvenanceSha256: sha256Schema,
  runId: z.string().min(1),
  schemaVersion: z.literal(1),
  verificationSha256: sha256Schema,
}).strict();

const verificationSchema = z.object({
  checks: z.object({
    actualFileHashesVerified: z.literal(true),
    exactPlanTopologyVerified: z.literal(true),
    hostPreflightVerified: z.literal(true),
    noInfrastructureFailure: z.boolean(),
    noLeakageRejection: z.literal(true),
    noMemoryChannelFailure: z.boolean(),
    noSilentFallback: z.literal(true),
    reportRecomputed: z.literal(true),
  }),
  claimBoundary: acceptedPilotBoundary,
  counts: z.object({
    pairs: z.number().int().positive(),
    stageExecutions: z.number().int().positive(),
  }),
  decision: z.literal("accepted"),
  evidenceClass: acceptedPilotClass,
  externalAuthenticityVerified: z.literal(false),
  planSha256: sha256Schema,
  projectionManifestSha256: sha256Schema,
  publicClaimEligible: z.literal(false),
  runId: z.string().min(1),
  schemaVersion: z.literal(1),
});

const reportSchema = z.object({
  acceptance: z.object({
    everyAttemptAccountedFor: z.literal(true),
    failureTaxonomyProduced: z.literal(true),
    noSilentFallback: z.literal(true),
    powerAnalysisProduced: z.literal(true),
    status: z.literal("accepted"),
  }),
  attempts: z.object({
    accountedCount: z.number().int().nonnegative(),
    infrastructureFailureCount: z.number().int().nonnegative(),
    memoryChannelFailureCount: z.number().int().nonnegative(),
    scheduledCount: z.number().int().positive(),
  }),
  claimBoundary: acceptedPilotBoundary,
  effect: z.object({
    comparablePairs: z.number().int().nonnegative(),
  }),
  evidenceClass: acceptedPilotClass,
  fullSetBudget: z.object({
    arms: z.number().int().positive(),
    codexCalls: z.number().int().positive(),
    episodes: z.number().int().positive(),
    repositories: z.number().int().positive(),
    scoredStages: z.number().int().positive(),
    seeds: z.number().int().positive(),
  }),
  pairs: z.object({
    comparableCount: z.number().int().nonnegative(),
    incomparableCount: z.number().int().nonnegative(),
    scheduledCount: z.number().int().positive(),
  }),
  planSha256: sha256Schema,
  powerAnalysis: z.object({
    designEffect: z.number().positive(),
    materialEffectRate: z.number().positive(),
    observedWithinEpisodeCorrelation: z.number().min(0).max(1),
    pairedObservationsBeforeClustering: z.number().int().positive(),
    power: z.number().positive().max(1),
    requiredEpisodes: z.number().int().positive(),
    seeds: z.number().int().positive(),
    stagesPerEpisode: z.number().int().positive(),
  }),
  publicClaimEligible: z.literal(false),
  publicCodingEffectProof: z.literal(false),
  readmeRowAllowed: z.literal(false),
  runId: z.string().min(1),
  schemaVersion: z.literal(1),
});

const reviewSchema = z.object({
  assertions: z.object({
    claimBoundary: z.literal(true),
    everyAttemptAccounted: z.literal(true),
    failureTaxonomyReviewed: z.literal(true),
    noSilentFallback: z.literal(true),
    powerAnalysis: z.literal(true),
  }),
  claimBoundary: acceptedPilotBoundary,
  decision: z.literal("accepted"),
  inputBundleSha256: sha256Schema,
  projectionManifestSha256: sha256Schema,
  publicClaimEligible: z.literal(false),
  publicCodingEffectProof: z.literal(false),
  readmeRowAllowed: z.literal(false),
  reportSha256: sha256Schema,
  runId: z.string().min(1),
  schemaVersion: z.literal(1),
  verificationSha256: sha256Schema,
});

const provenanceSchema = z.object({
  inputBundle: z.object({
    sha256: sha256Schema,
  }),
  response: z.object({
    byteLength: z.number().int().positive(),
    sha256: sha256Schema,
  }),
  reviewDecision: z.literal("accepted"),
  runId: z.string().min(1),
  schemaVersion: z.literal(1),
});

const artifactReferenceSchema = z.object({
  bytes: z.number().int().positive(),
  path: localRelativePathSchema,
  sha256: sha256Schema,
}).strict();

const codexEnvironmentSchema = z.object({
  cliPackage: z.object({
    name: z.literal("@openai/codex"),
    packageJson: artifactReferenceSchema,
    version: trimmedStringSchema,
  }).strict(),
  launcher: artifactReferenceSchema,
  model: trimmedStringSchema,
  nativeBinary: artifactReferenceSchema,
  platformPackage: z.object({
    dependencyAlias: z.literal("@openai/codex-linux-x64"),
    packageJson: artifactReferenceSchema,
    version: trimmedStringSchema,
  }).strict(),
  reasoningEffort: trimmedStringSchema,
  version: trimmedStringSchema,
}).strict().superRefine((codex, context) => {
  if (codex.launcher.sha256 === codex.nativeBinary.sha256) {
    context.addIssue({
      code: "custom",
      message: "Codex launcher and native binary identities must be distinct",
      path: ["nativeBinary"],
    });
  }
  if (
    codex.cliPackage.version !== codex.version ||
    codex.platformPackage.version !== `${codex.version}-linux-x64`
  ) {
    context.addIssue({
      code: "custom",
      message: "Codex CLI and Linux x64 package versions must match",
      path: ["version"],
    });
  }
});

const environmentManifestSchema = z.object({
  architecture: z.literal("x64"),
  codex: codexEnvironmentSchema,
  execution: z.object({
    maxConcurrency: z.number().int().positive(),
    stageTimeoutMs: z.number().int().positive(),
    testTimeoutMs: z.number().int().positive(),
  }).strict(),
  goodMemoryInstallSource: z.literal("package-tarball-only"),
  image: z.object({
    sha256: sha256Schema,
  }).strict(),
  networkAccess: z.literal(false),
  operatingSystem: z.literal("linux"),
  package: z.object({
    sha256: sha256Schema,
    version: trimmedStringSchema,
  }).strict(),
  runnerSource: z.object({
    commit: gitObjectSchema,
    tree: gitObjectSchema,
  }).strict(),
  schemaVersion: z.literal(3),
}).strict();

type C6CodexEnvironment = z.infer<typeof codexEnvironmentSchema>;

const codexCliPackageJsonSchema = z.object({
  bin: z.object({
    codex: z.literal("bin/codex.js"),
  }),
  name: z.literal("@openai/codex"),
  optionalDependencies: z.record(z.string(), z.string()),
  version: trimmedStringSchema,
});

const codexPlatformPackageJsonSchema = z.object({
  cpu: z.tuple([z.literal("x64")]),
  files: z.array(z.string()).refine(
    (files) => files.includes("vendor"),
    "files must include vendor",
  ),
  name: z.literal("@openai/codex"),
  os: z.tuple([z.literal("linux")]),
  version: trimmedStringSchema,
});

const summaryProtocolSchema = z.object({
  generationPolicy: z.literal(
    C6_FLAT_SUMMARY_GENERATION_POLICY,
  ),
  historySource: z.literal("same-stage-sealed-prefix-as-goodmemory"),
  injectionComposition: z.literal(
    C6_FLAT_SUMMARY_INJECTION_COMPOSITION,
  ),
  leakageAuditRequired: z.literal(true),
  maxInjectedTokens: z.number().int().positive(),
  model: trimmedStringSchema,
  noHistoryControl: z.object({
    flatSummaryProviderCall: z.literal(
      C6_NO_HISTORY_CONTROL.flatSummaryProviderCall,
    ),
    historySourceSha256: z.literal(
      C6_NO_HISTORY_CONTROL.historySourceSha256,
    ),
    injectedContentSha256: z.literal(
      C6_NO_HISTORY_CONTROL.injectedContentSha256,
    ),
    injectedTokenCount: z.literal(
      C6_NO_HISTORY_CONTROL.injectedTokenCount,
    ),
    injectionMode: z.literal(C6_NO_HISTORY_CONTROL.injectionMode),
    zeroInjectionArms: z.tuple([
      z.literal(C6_NO_HISTORY_CONTROL.zeroInjectionArms[0]),
      z.literal(C6_NO_HISTORY_CONTROL.zeroInjectionArms[1]),
    ]),
    zeroInjectionComposition: z.literal(
      C6_NO_HISTORY_CONTROL.zeroInjectionComposition,
    ),
    zeroInjectionCompositionSha256: z.literal(
      C6_NO_HISTORY_CONTROL.zeroInjectionCompositionSha256,
    ),
  }).strict(),
  pricingSnapshot: z.object({
    path: localRelativePathSchema,
    sha256: sha256Schema,
  }).strict(),
  prompt: z.object({
    path: localRelativePathSchema,
    sha256: sha256Schema,
  }).strict(),
  provider: trimmedStringSchema,
  rawGoldAccess: z.literal(false),
  schemaVersion: z.literal(3),
  seedReusePolicy: z.literal(
    "one-output-hash-reused-across-all-three-seeds",
  ),
  tokenCounter: z.object({
    id: z.literal(C6_INJECTION_TOKEN_COUNTER_ID),
    sha256: z.literal(C6_INJECTION_TOKEN_COUNTER_SHA256),
  }).strict(),
}).strict();

function parseC6SummaryProtocol(
  value: unknown,
): z.infer<typeof summaryProtocolSchema> {
  const parsed = summaryProtocolSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`invalid C6 summary protocol: ${parsed.error.message}`);
  }
  return parsed.data;
}

const pricingSnapshotSchema = z.object({
  cachedInputUsdPerMillionTokens: z.number().nonnegative(),
  currency: z.literal("USD"),
  effectiveAt: z.iso.datetime(),
  inputUsdPerMillionTokens: z.number().nonnegative(),
  model: trimmedStringSchema,
  observedAt: z.iso.datetime(),
  outputUsdPerMillionTokens: z.number().nonnegative(),
  provider: trimmedStringSchema,
  schemaVersion: z.literal(1),
  source: z.object({
    locator: z.url().refine(
      (value) => value.startsWith("https://"),
      "pricing source locator must use https",
    ),
    receipt: z.object({
      path: localRelativePathSchema,
      sha256: sha256Schema,
    }).strict(),
    type: z.literal("provider-published-pricing"),
  }).strict(),
}).strict().superRefine((snapshot, context) => {
  if (Date.parse(snapshot.effectiveAt) > Date.parse(snapshot.observedAt)) {
    context.addIssue({
      code: "custom",
      message: "pricing effectiveAt cannot be after observedAt",
      path: ["effectiveAt"],
    });
  }
});

const taskOriginReceiptSchema = z.object({
  episodeId: trimmedStringSchema,
  schemaVersion: z.literal(5),
  sourceRecord: z.object({
    path: localRelativePathSchema.refine(
      (value) => value.startsWith("provenance/task-origin/source-records/"),
      "task-origin source record must stay under provenance/task-origin/source-records/",
    ),
    sha256: sha256Schema,
  }).strict(),
  sourceType: z.enum(["external-benchmark", "real-history"]),
}).strict();

const taskOriginStageSchema = z.object({
  originalRequest: trimmedStringSchema,
  originalRequestSha256: sha256Schema,
  originReceipt: z.object({
    bytes: z.number().int().positive(),
    format: z.literal("github-issue-api-json-v2"),
    path: localRelativePathSchema.refine(
      (value) =>
        value.startsWith("provenance/task-origin/upstream-receipts/"),
      "task-origin upstream receipt must stay under provenance/task-origin/upstream-receipts/",
    ),
    sha256: sha256Schema,
  }).strict(),
  source: z.object({
    kind: z.enum(["issue", "pull-request", "commit", "task-log"]),
    locator: z.url().refine(
      (value) => value.startsWith("https://"),
      "task-origin source locator must use https",
    ),
    revision: z.union([gitObjectSchema, sha256Schema]),
  }).strict(),
  stageId: trimmedStringSchema,
}).strict().superRefine((stage, context) => {
  if (sha256(stage.originalRequest) !== stage.originalRequestSha256) {
    context.addIssue({
      code: "custom",
      message: "task-origin original request hash does not match",
      path: ["originalRequestSha256"],
    });
  }
});

const taskOriginSourceRecordSchema = z.object({
  candidateTaskContentSha256: sha256Schema,
  episodeId: trimmedStringSchema,
  repository: z.object({
    baseCommit: z.union([gitObjectSchema, sha256Schema]),
    url: z.url().refine(
      (value) => value.startsWith("https://"),
      "task-origin repository URL must use https",
    ),
  }).strict(),
  relationships: z.array(z.object({
    bytes: z.number().int().positive(),
    path: localRelativePathSchema.refine(
      (value) =>
        value.startsWith("provenance/task-origin/relationships/") &&
        value.endsWith(".json"),
      "task-origin relationship receipt must stay under provenance/task-origin/relationships/",
    ),
    sha256: sha256Schema,
  }).strict()),
  schemaVersion: z.literal(5),
  sourceType: z.enum(["external-benchmark", "real-history"]),
  stages: z.array(taskOriginStageSchema).min(1),
}).strict().superRefine((record, context) => {
  if (new Set(record.stages.map((stage) => stage.stageId)).size !==
    record.stages.length) {
    context.addIssue({
      code: "custom",
      message: "task-origin source record contains duplicate stage IDs",
      path: ["stages"],
    });
  }
  if (new Set(record.stages.map((stage) => stage.originReceipt.path)).size !==
    record.stages.length) {
    context.addIssue({
      code: "custom",
      message: "task-origin source record reuses an upstream receipt",
      path: ["stages"],
    });
  }
  if (record.relationships.length !== record.stages.length - 1) {
    context.addIssue({
      code: "custom",
      message: "task-origin source record must cover every adjacent stage edge",
      path: ["relationships"],
    });
  }
  if (
    new Set(record.relationships.map((relationship) => relationship.path))
      .size !== record.relationships.length
  ) {
    context.addIssue({
      code: "custom",
      message: "task-origin source record reuses a relationship receipt",
      path: ["relationships"],
    });
  }
});
type C6TaskOriginSourceRecord = z.infer<typeof taskOriginSourceRecordSchema>;

interface C6TaskOriginRelationshipEvidence
  extends C6TaskRelationshipEvidence {
  relationshipReceiptBytes: number;
  relationshipReceiptPath: string;
}

const githubIssueReceiptSchema = z.object({
  body: z.string().min(1),
  created_at: z.iso.datetime(),
  html_url: z.url(),
  node_id: trimmedStringSchema,
  number: z.number().int().positive(),
  repository_url: z.url(),
  updated_at: z.iso.datetime(),
});

export interface C6C5Prerequisite {
  c5ReportedRequiredEpisodes: number;
  externalAuthenticityVerified: false;
  gateSha256: string;
  headlineDesignEffect: number;
  headlineMinimumPosition: 2;
  headlineObservationsPerEpisode: number;
  incomparablePairs: number;
  independentReviewSha256: string;
  infrastructureFailureCount: number;
  planningMaterialEffectRate: number;
  provenanceSha256: string;
  reportSha256: string;
  requiredEpisodes: number;
  requiredRepositories: number;
  requiredScoredStages: number;
  runId: string;
  verificationSha256: string;
}

export interface C6CandidateReadinessInput {
  c5EvidenceRoot: string;
  datasetRoot: string;
  environmentManifestPath: string;
  gatePolicyPath: string;
  packageTarballPath: string;
  repositoryDesignEvidence?: {
    expectedDesignPowerArtifactSha256: string;
    expectedPowerInputArtifactSha256: string;
    expectedRepositoryLineageArtifactSha256: string;
    expectedReviewReceiptSha256: string;
  };
  seeds: readonly number[];
  summaryCorpus?: C6FlatSummaryCorpus;
  summaryProtocolPath: string;
  testHooks?: {
    beforeTerminalExternalClosure?: () => Promise<void> | void;
  };
}

export interface C6CandidateReadinessResult {
  codexRunReady: false;
  plan: C6CandidatePlan;
  planBytes: string;
  planSha256: string;
  readinessStage: "preflight-accepted-freeze-prerequisites-required";
  summaryArtifacts: {
    authenticatedGenerationReceipts: 0;
    providerAuthenticityVerified: false;
    requiredGenerationReceipts: number;
    requiredStageBindings: number;
    schemaVersion: 1;
    status: typeof C6_FLAT_SUMMARY_CORPUS_STATUS;
    structurallyVerifiedGenerationReceipts: number;
    structurallyVerifiedStageBindings: number;
  };
}

async function loadC6CandidateDataset(datasetRoot: string): Promise<{
  dataset: CodexCodingEffectDatasetV3;
  manifestSha256: string;
}> {
  const bytes = await readRegularFile(
    join(datasetRoot, "manifest.json"),
    "C6 dataset manifest",
  );
  const raw = bytes.toString("utf8");
  const value: unknown = JSON.parse(raw);
  if (
    typeof value !== "object" ||
    value === null ||
    !("schemaVersion" in value) ||
    value.schemaVersion !== 3
  ) {
    throw new Error("C6 candidate requires dataset schema version 3");
  }
  const dataset = parseCodexCodingEffectDataset(value);
  if (dataset.schemaVersion !== 3) {
    throw new Error("C6 candidate requires dataset schema version 3");
  }
  return {
    dataset,
    manifestSha256: sha256(raw),
  };
}

interface C6CodexArtifactIdentity {
  cliPackageJsonSha256: string;
  launcherSha256: string;
  nativeBinarySha256: string;
  platformPackageJsonSha256: string;
}

export async function loadC6CandidateReadiness(
  input: C6CandidateReadinessInput,
): Promise<C6CandidateReadinessResult> {
  const c5EvidenceRoot = resolve(input.c5EvidenceRoot);
  const datasetRoot = resolve(input.datasetRoot);
  const environmentManifestPath = resolve(input.environmentManifestPath);
  const gatePolicyPath = resolve(input.gatePolicyPath);
  const packageTarballPath = resolve(input.packageTarballPath);
  const summaryProtocolPath = resolve(input.summaryProtocolPath);
  const assetLock = await loadC6AssetLock(datasetRoot);
  const [
    loaded,
    c5Evidence,
    environmentBytes,
    gatePolicyBytes,
    packageBytes,
    summaryProtocolBytes,
  ] = await Promise.all([
    loadC6CandidateDataset(datasetRoot),
    loadC6C5Prerequisite(c5EvidenceRoot),
    readRegularFile(environmentManifestPath, "environment manifest").then(
      (bytes) => bytes.toString("utf8"),
    ),
    readRegularFile(gatePolicyPath, "gate policy").then(
      (bytes) => bytes.toString("utf8"),
    ),
    readRegularFile(packageTarballPath, "package tarball"),
    readRegularFile(summaryProtocolPath, "summary protocol").then(
      (bytes) => bytes.toString("utf8"),
    ),
  ]);
  const environment = environmentManifestSchema.parse(
    JSON.parse(environmentBytes) as unknown,
  );
  const codexIdentity = await inspectC6CodexArtifacts(
    dirname(environmentManifestPath),
    environment.codex,
  );
  const gatePolicy = parseC6GatePolicy(
    JSON.parse(gatePolicyBytes) as unknown,
  );
  const summaryProtocol = parseC6SummaryProtocol(
    JSON.parse(summaryProtocolBytes) as unknown,
  );
  const packageIdentity = await inspectC6PackageTarball({
    expectedSha256: environment.package.sha256,
    expectedVersion: environment.package.version,
    path: packageTarballPath,
  });
  const protocolRoot = dirname(summaryProtocolPath);
  const pricingSnapshotPath = resolve(
    protocolRoot,
    summaryProtocol.pricingSnapshot.path,
  );
  const summaryPromptPath = resolve(
    protocolRoot,
    summaryProtocol.prompt.path,
  );
  const [summaryPromptBytes, pricingSnapshotBytes] = await Promise.all([
    readRegularFile(
      summaryPromptPath,
      "summary prompt",
    ).then((bytes) => bytes.toString("utf8")),
    readRegularFile(
      pricingSnapshotPath,
      "pricing snapshot",
    ).then((bytes) => bytes.toString("utf8")),
  ]);
  const pricing = pricingSnapshotSchema.parse(
    JSON.parse(pricingSnapshotBytes) as unknown,
  );
  const pricingReceiptPath = resolve(
    dirname(pricingSnapshotPath),
    pricing.source.receipt.path,
  );
  const pricingReceiptBytes = await readRegularFile(
    pricingReceiptPath,
    "pricing receipt",
  );
  if (loaded.dataset.schemaVersion !== 3) {
    throw new Error("C6 candidate requires dataset schema version 3");
  }
  const dataset = loaded.dataset;

  if (sha256(packageBytes) !== packageIdentity.sha256) {
    throw new Error("C6 package tarball drifted during readiness");
  }
  if (
    sha256(summaryPromptBytes) !== summaryProtocol.prompt.sha256 ||
    sha256(pricingSnapshotBytes) !== summaryProtocol.pricingSnapshot.sha256
  ) {
    throw new Error("C6 flat-summary protocol file hash does not match");
  }
  if (
    pricing.model !== summaryProtocol.model ||
    pricing.provider !== summaryProtocol.provider
  ) {
    throw new Error("C6 pricing snapshot does not match the summary model");
  }
  if (sha256(pricingReceiptBytes) !== pricing.source.receipt.sha256) {
    throw new Error("C6 pricing receipt hash does not match");
  }
  const contentBindings = await validateCandidateAssetBindings({
    assetLock: assetLock.assetLock,
    dataset,
    datasetRoot,
    manifestSha256: loaded.manifestSha256,
  });
  const [datasetLineage, taskOriginReviewEvidence] = await Promise.all([
    loadC6DatasetLineage({
      assetLock: assetLock.assetLock,
      dataset,
      datasetRoot,
      taskContentSha256ByEpisodeId:
        contentBindings.taskContentSha256ByEpisodeId,
      taskOriginEvidenceByEpisodeId:
        contentBindings.taskOriginEvidenceByEpisodeId,
    }),
    validateC6TaskOriginReviewProvenance({
      assetLock: assetLock.assetLock,
      dataset,
      datasetRoot,
      taskContentSha256ByEpisodeId:
        contentBindings.taskContentSha256ByEpisodeId,
      taskOriginEvidenceByEpisodeId:
        contentBindings.taskOriginEvidenceByEpisodeId,
    }),
  ]);
  const staticLeakage = await auditC6CandidateStaticLeakage({
    assetRootSha256: assetLock.assetLock.assetRootSha256,
    dataset,
    datasetManifestSha256: loaded.manifestSha256,
    datasetRoot,
    summaryPrompt: summaryPromptBytes,
    summaryPromptSha256: summaryProtocol.prompt.sha256,
  });
  const repositoryDesignEvidence =
    input.repositoryDesignEvidence === undefined
      ? undefined
      : await loadC6RepositoryDesignEvidence({
        assetRoot: datasetRoot,
        dataset,
        datasetSha256: loaded.manifestSha256,
        expectedAssetLockSha256: assetLock.assetLockSha256,
        expectedAssetRootSha256:
          assetLock.assetLock.assetRootSha256,
        ...input.repositoryDesignEvidence,
      });

  const plan = buildC6CandidatePlan({
    assetLockSha256: assetLock.assetLockSha256,
    assetRootSha256: assetLock.assetLock.assetRootSha256,
    c5Evidence,
    codex: {
      cliPackageJsonSha256: codexIdentity.cliPackageJsonSha256,
      launcherSha256: codexIdentity.launcherSha256,
      model: environment.codex.model,
      nativeBinarySha256: codexIdentity.nativeBinarySha256,
      platformPackageJsonSha256:
        codexIdentity.platformPackageJsonSha256,
      reasoningEffort: environment.codex.reasoningEffort,
      version: environment.codex.version,
    },
    dataset,
    datasetLineage,
    flatSummary: {
      maxInjectedTokens: summaryProtocol.maxInjectedTokens,
      model: summaryProtocol.model,
      promptSha256: summaryProtocol.prompt.sha256,
      protocolSha256: sha256(summaryProtocolBytes),
      provider: summaryProtocol.provider,
      tokenCounterSha256: summaryProtocol.tokenCounter.sha256,
    },
    gatePolicy,
    gatePolicySha256: sha256(gatePolicyBytes),
    manifestSha256: loaded.manifestSha256,
    maxConcurrency: environment.execution.maxConcurrency,
    package: {
      fileCount: packageIdentity.fileCount,
      filesManifestSha256: packageIdentity.filesManifestSha256,
      sha256: packageIdentity.sha256,
      version: packageIdentity.version,
    },
    platform: {
      architecture: environment.architecture,
      environmentManifestSha256: sha256(environmentBytes),
      imageSha256: environment.image.sha256,
      operatingSystem: environment.operatingSystem,
    },
    pricingSnapshotSha256: summaryProtocol.pricingSnapshot.sha256,
    pricingReceiptSha256: pricing.source.receipt.sha256,
    repositoryDesignEvidence,
    repositoryContentSha256ByAssetPath:
      contentBindings.repositoryContentSha256ByAssetPath,
    runnerSource: environment.runnerSource,
    seeds: input.seeds,
    stageTimeoutMs: environment.execution.stageTimeoutMs,
    staticLeakageAuditSha256: staticLeakage.auditSha256,
    taskContentSha256ByEpisodeId:
      contentBindings.taskContentSha256ByEpisodeId,
    taskOriginEvidenceByEpisodeId:
      contentBindings.taskOriginEvidenceByEpisodeId,
    taskOriginReviewEvidence,
    testTimeoutMs: environment.execution.testTimeoutMs,
  });
  const summaryCorpusVerification = input.summaryCorpus === undefined
    ? undefined
    : verifyC6FlatSummaryCorpusCompleteness(
      input.summaryCorpus,
      buildC6FlatSummaryCorpusExpectation(plan),
    );
  const planBytes = serializeC6CandidatePlan(plan);
  await input.testHooks?.beforeTerminalExternalClosure?.();
  await verifyC6ExternalInputClosure([
    {
      label: "package tarball",
      path: packageTarballPath,
      sha256: sha256(packageBytes),
    },
    {
      label: "gate policy",
      path: gatePolicyPath,
      sha256: sha256(gatePolicyBytes),
    },
    {
      label: "summary protocol",
      path: summaryProtocolPath,
      sha256: sha256(summaryProtocolBytes),
    },
    {
      label: "summary prompt",
      path: summaryPromptPath,
      sha256: sha256(summaryPromptBytes),
    },
    {
      label: "pricing snapshot",
      path: pricingSnapshotPath,
      sha256: sha256(pricingSnapshotBytes),
    },
    {
      label: "pricing receipt",
      path: pricingReceiptPath,
      sha256: sha256(pricingReceiptBytes),
    },
    {
      label: "C5 gate",
      path: join(c5EvidenceRoot, "c5-gate.json"),
      sha256: c5Evidence.gateSha256,
    },
    {
      label: "C5 verification",
      path: join(c5EvidenceRoot, "c5-verification.json"),
      sha256: c5Evidence.verificationSha256,
    },
    {
      label: "C5 report",
      path: join(c5EvidenceRoot, "report.json"),
      sha256: c5Evidence.reportSha256,
    },
    {
      label: "C5 independent review",
      path: join(c5EvidenceRoot, "independent-review.json"),
      sha256: c5Evidence.independentReviewSha256,
    },
    {
      label: "C5 provenance",
      path: join(c5EvidenceRoot, "provenance.json"),
      sha256: c5Evidence.provenanceSha256,
    },
  ]);
  await verifyC6CodexArtifactsUnchanged(
    dirname(environmentManifestPath),
    environment.codex,
    codexIdentity,
  );
  if (
    sha256(await readRegularFile(
      environmentManifestPath,
      "environment manifest",
    )) !== sha256(environmentBytes)
  ) {
    throw new Error("C6 environment manifest changed during readiness");
  }
  await verifyC6AssetClosure(datasetRoot, assetLock);
  return {
    codexRunReady: false,
    plan,
    planBytes,
    planSha256: sha256(planBytes),
    readinessStage: "preflight-accepted-freeze-prerequisites-required",
    summaryArtifacts: {
      authenticatedGenerationReceipts: 0,
      providerAuthenticityVerified: false,
      requiredGenerationReceipts: plan.counts.summaryGenerationCalls,
      requiredStageBindings:
        plan.counts.summaryStageArtifactBindings * plan.seeds.length,
      schemaVersion: 1,
      status: C6_FLAT_SUMMARY_CORPUS_STATUS,
      structurallyVerifiedGenerationReceipts:
        summaryCorpusVerification?.generationReceipts
          .structurallyVerified ?? 0,
      structurallyVerifiedStageBindings:
        summaryCorpusVerification?.stageBindingReceipts
          .structurallyVerified ?? 0,
    },
  };
}

export function buildC6FlatSummaryCorpusExpectation(
  plan: C6CandidatePlan,
): C6FlatSummaryCorpusExpectation {
  const generationHistoryByKey = new Map<string, string>();
  const noHistoryStageBindings: C6FlatSummaryCorpusExpectation[
    "noHistoryStageBindings"
  ] = [];
  const stageBindings: C6FlatSummaryCorpusExpectation[
    "stageBindings"
  ] = [];
  for (const episode of plan.episodeBindings) {
    for (const stage of episode.stageBindings) {
      const treatment = stage.treatment.flatSummary;
      if (treatment.providerCall === "prohibited") {
        noHistoryStageBindings.push({
          episodeId: episode.episodeId,
          stageId: stage.stageId,
        });
        continue;
      }
      const generationKey = computeC6FlatSummaryGenerationKey(
        stage.sourceLineage.history,
      );
      const existingHistory = generationHistoryByKey.get(
        generationKey,
      );
      if (
        existingHistory !== undefined &&
        existingHistory !== stage.historySourceSha256
      ) {
        throw new Error(
          "C6 flat-summary generation key maps to different histories",
        );
      }
      generationHistoryByKey.set(
        generationKey,
        stage.historySourceSha256,
      );
      stageBindings.push({
        episodeId: episode.episodeId,
        generationKey,
        stageId: stage.stageId,
      });
    }
  }
  return {
    generationBindings: [...generationHistoryByKey].map(
      ([generationKey, historySourceSha256]) => ({
        generationKey,
        historySourceSha256,
      }),
    ),
    noHistoryStageBindings,
    seeds: [...plan.seeds],
    stageBindings,
  };
}

async function verifyC6ExternalInputClosure(
  inputs: ReadonlyArray<{
    label: string;
    path: string;
    sha256: string;
  }>,
): Promise<void> {
  await Promise.all(inputs.map(async (input) => {
    try {
      const bytes = await readRegularFile(input.path, input.label);
      if (sha256(bytes) !== input.sha256) {
        throw new Error("bytes changed");
      }
    } catch {
      throw new Error(
        `C6 external input closure changed during preflight: ${input.label}`,
      );
    }
  }));
}

async function inspectC6CodexArtifacts(
  root: string,
  codex: C6CodexEnvironment,
): Promise<C6CodexArtifactIdentity> {
  const [
    cliPackageJson,
    launcher,
    nativeBinary,
    platformPackageJson,
  ] = await Promise.all([
    readArtifactReference(root, codex.cliPackage.packageJson, "Codex CLI package.json"),
    readArtifactReference(root, codex.launcher, "Codex launcher"),
    readArtifactReference(root, codex.nativeBinary, "Codex native binary"),
    readArtifactReference(
      root,
      codex.platformPackage.packageJson,
      "Codex Linux x64 package.json",
    ),
  ]);
  const cliPackage = codexCliPackageJsonSchema.safeParse(
    parseJson(cliPackageJson.bytes, "C6 Codex CLI package metadata is invalid"),
  );
  if (!cliPackage.success) {
    throw new Error("C6 Codex CLI package metadata is invalid");
  }
  const platformPackage = codexPlatformPackageJsonSchema.safeParse(
    parseJson(
      platformPackageJson.bytes,
      "C6 Codex Linux x64 package metadata is invalid",
    ),
  );
  if (!platformPackage.success) {
    throw new Error("C6 Codex Linux x64 package metadata is invalid");
  }
  const expectedPlatformVersion = `${codex.version}-linux-x64`;
  const expectedPlatformSpecifier =
    `npm:@openai/codex@${expectedPlatformVersion}`;
  if (
    cliPackage.data.version !== codex.version ||
    cliPackage.data.version !== codex.cliPackage.version ||
    platformPackage.data.version !== expectedPlatformVersion ||
    platformPackage.data.version !== codex.platformPackage.version ||
    cliPackage.data.optionalDependencies[
      codex.platformPackage.dependencyAlias
    ] !== expectedPlatformSpecifier
  ) {
    throw new Error(
      "C6 Codex CLI and Linux x64 package bytes do not match the declared version",
    );
  }
  if (
    relative(
      dirname(cliPackageJson.path),
      launcher.path,
    ).split("\\").join("/") !== cliPackage.data.bin.codex
  ) {
    throw new Error(
      "C6 Codex launcher path does not match the CLI package bin entry",
    );
  }
  if (
    relative(
      dirname(platformPackageJson.path),
      nativeBinary.path,
    ).split("\\").join("/") !==
      "vendor/x86_64-unknown-linux-musl/bin/codex"
  ) {
    throw new Error(
      "C6 Codex native binary path does not match the Linux x64 package",
    );
  }
  if (!isElf64LittleEndianX86_64(nativeBinary.bytes)) {
    throw new Error(
      "C6 Codex native binary must be ELF64 little-endian x86-64",
    );
  }
  if (launcher.sha256 === nativeBinary.sha256) {
    throw new Error(
      "C6 Codex launcher and native binary identities must be distinct",
    );
  }
  return {
    cliPackageJsonSha256: cliPackageJson.sha256,
    launcherSha256: launcher.sha256,
    nativeBinarySha256: nativeBinary.sha256,
    platformPackageJsonSha256: platformPackageJson.sha256,
  };
}

async function verifyC6CodexArtifactsUnchanged(
  root: string,
  codex: C6CodexEnvironment,
  expected: C6CodexArtifactIdentity,
): Promise<void> {
  const current = await inspectC6CodexArtifacts(root, codex);
  if (
    current.cliPackageJsonSha256 !== expected.cliPackageJsonSha256 ||
    current.launcherSha256 !== expected.launcherSha256 ||
    current.nativeBinarySha256 !== expected.nativeBinarySha256 ||
    current.platformPackageJsonSha256 !==
      expected.platformPackageJsonSha256
  ) {
    throw new Error("C6 Codex artifact closure changed during readiness");
  }
}

async function readArtifactReference(
  root: string,
  reference: z.infer<typeof artifactReferenceSchema>,
  label: string,
): Promise<{
  bytes: Buffer;
  path: string;
  sha256: string;
}> {
  const path = resolve(root, reference.path);
  const relativePath = relative(resolve(root), path);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
  ) {
    throw new Error(`C6 ${label} path escapes its environment root`);
  }
  const bytes = await readRegularFile(path, label);
  if (bytes.byteLength !== reference.bytes) {
    throw new Error(`C6 ${label} byte length does not match`);
  }
  const actualSha256 = sha256(bytes);
  if (actualSha256 !== reference.sha256) {
    throw new Error(`C6 ${label} SHA-256 does not match`);
  }
  return {
    bytes,
    path,
    sha256: actualSha256,
  };
}

function parseJson(bytes: Buffer, message: string): unknown {
  try {
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new Error(message);
  }
}

function isElf64LittleEndianX86_64(bytes: Buffer): boolean {
  return (
    bytes.byteLength >= 20 &&
    bytes[0] === 0x7f &&
    bytes[1] === 0x45 &&
    bytes[2] === 0x4c &&
    bytes[3] === 0x46 &&
    bytes[4] === 2 &&
    bytes[5] === 1 &&
    bytes[6] === 1 &&
    bytes.readUInt16LE(18) === 0x3e
  );
}

export async function loadC6C5Prerequisite(
  evidenceRoot: string,
): Promise<C6C5Prerequisite> {
  try {
    return await loadC6C5PrerequisiteUnchecked(resolve(evidenceRoot));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`C6 C5 prerequisite rejected: ${message}`);
  }
}

async function loadC6C5PrerequisiteUnchecked(
  evidenceRoot: string,
): Promise<C6C5Prerequisite> {
  const [
    gateBytes,
    verificationBytes,
    reportBytes,
    reviewBytes,
    provenanceBytes,
  ] = await Promise.all([
    readRegularFile(join(evidenceRoot, "c5-gate.json"), "C5 gate").then(
      (bytes) => bytes.toString("utf8"),
    ),
    readRegularFile(
      join(evidenceRoot, "c5-verification.json"),
      "C5 verification",
    ).then((bytes) => bytes.toString("utf8")),
    readRegularFile(join(evidenceRoot, "report.json"), "C5 report").then(
      (bytes) => bytes.toString("utf8"),
    ),
    readRegularFile(
      join(evidenceRoot, "independent-review.json"),
      "C5 independent review",
    ).then((bytes) => bytes.toString("utf8")),
    readRegularFile(
      join(evidenceRoot, "provenance.json"),
      "C5 provenance",
    ).then((bytes) => bytes.toString("utf8")),
  ]);
  const gate = gateSchema.parse(JSON.parse(gateBytes) as unknown);
  const verification = verificationSchema.parse(
    JSON.parse(verificationBytes) as unknown,
  );
  const report = reportSchema.parse(JSON.parse(reportBytes) as unknown);
  const review = reviewSchema.parse(JSON.parse(reviewBytes) as unknown);
  const provenance = provenanceSchema.parse(
    JSON.parse(provenanceBytes) as unknown,
  );
  const verificationSha256 = sha256(verificationBytes);
  const reportSha256 = sha256(reportBytes);
  const independentReviewSha256 = sha256(reviewBytes);
  const provenanceSha256 = sha256(provenanceBytes);
  const gateSha256 = sha256(gateBytes);

  for (const [label, actual, expected] of [
    ["gate", gateSha256, ACCEPTED_C5_V16.artifacts.gate],
    [
      "verification",
      verificationSha256,
      ACCEPTED_C5_V16.artifacts.verification,
    ],
    ["report", reportSha256, ACCEPTED_C5_V16.artifacts.report],
    [
      "independent review",
      independentReviewSha256,
      ACCEPTED_C5_V16.artifacts.independentReview,
    ],
    ["provenance", provenanceSha256, ACCEPTED_C5_V16.artifacts.provenance],
  ] as const) {
    if (actual !== expected) {
      throw new Error(`accepted tracked C5 v16 ${label} hash does not match`);
    }
  }
  assertEqual(gate.runId, ACCEPTED_C5_V16.runId, "accepted tracked C5 v16 run");

  assertEqual(gate.verificationSha256, verificationSha256, "verification hash");
  assertEqual(
    gate.independentReviewSha256,
    independentReviewSha256,
    "independent-review hash",
  );
  assertEqual(
    gate.reviewProvenanceSha256,
    provenanceSha256,
    "review-provenance hash",
  );
  assertEqual(review.verificationSha256, verificationSha256, "review verification");
  assertEqual(review.reportSha256, reportSha256, "review report");
  assertEqual(provenance.response.sha256, independentReviewSha256, "review response");
  assertEqual(
    provenance.response.byteLength,
    Buffer.byteLength(reviewBytes),
    "review response byte length",
  );
  assertEqual(
    provenance.inputBundle.sha256,
    review.inputBundleSha256,
    "review input bundle",
  );

  for (const candidate of [
    verification.runId,
    report.runId,
    review.runId,
    provenance.runId,
  ]) {
    assertEqual(candidate, gate.runId, "run identity");
  }
  assertEqual(verification.planSha256, gate.planSha256, "verification plan");
  assertEqual(report.planSha256, gate.planSha256, "report plan");
  assertEqual(
    verification.projectionManifestSha256,
    gate.projectionManifestSha256,
    "verification projection",
  );
  assertEqual(
    review.projectionManifestSha256,
    gate.projectionManifestSha256,
    "review projection",
  );

  assertEqual(report.attempts.accountedCount, report.attempts.scheduledCount, "attempt accounting");
  assertEqual(report.attempts.scheduledCount, verification.counts.stageExecutions, "stage count");
  assertEqual(report.pairs.scheduledCount, verification.counts.pairs, "pair count");
  assertEqual(
    report.pairs.comparableCount + report.pairs.incomparableCount,
    report.pairs.scheduledCount,
    "pair accounting",
  );
  assertEqual(report.effect.comparablePairs, report.pairs.comparableCount, "comparable pairs");
  assertEqual(
    verification.checks.noInfrastructureFailure,
    report.attempts.infrastructureFailureCount === 0,
    "infrastructure-failure status",
  );
  assertEqual(
    verification.checks.noMemoryChannelFailure,
    report.attempts.memoryChannelFailureCount === 0,
    "memory-channel status",
  );

  const budget = report.fullSetBudget;
  const power = report.powerAnalysis;
  assertEqual(budget.arms, 2, "pilot arm count");
  assertEqual(budget.episodes, power.requiredEpisodes, "powered episode count");
  assertEqual(budget.seeds, power.seeds, "seed count");
  assertEqual(
    budget.scoredStages,
    budget.episodes * power.stagesPerEpisode,
    "scored-stage count",
  );
  assertEqual(
    budget.codexCalls,
    budget.arms * budget.scoredStages * budget.seeds,
    "Codex call budget",
  );
  assertEqual(power.materialEffectRate, 0.1, "planning material effect");
  assertEqual(power.power, 0.8, "planning power");
  if (
    budget.episodes < 30 ||
    budget.repositories < 6 ||
    power.seeds !== 3 ||
    power.stagesPerEpisode < 3
  ) {
    throw new Error("C5 powered budget is below the C6 minimum");
  }
  const headlineMinimumPosition = 2 as const;
  const headlineStageCount = power.stagesPerEpisode -
    headlineMinimumPosition + 1;
  const headlineObservationsPerEpisode = headlineStageCount * power.seeds;
  const headlineDesignEffect = headlineObservationsPerEpisode;
  const requiredEpisodes = Math.ceil(
    power.pairedObservationsBeforeClustering * headlineDesignEffect /
      headlineObservationsPerEpisode,
  );
  if (requiredEpisodes !== 391 || headlineStageCount !== 2) {
    throw new Error("C6 headline power correction is below the frozen minimum");
  }

  return {
    c5ReportedRequiredEpisodes: budget.episodes,
    externalAuthenticityVerified: false,
    gateSha256,
    headlineDesignEffect,
    headlineMinimumPosition,
    headlineObservationsPerEpisode,
    incomparablePairs: report.pairs.incomparableCount,
    independentReviewSha256,
    infrastructureFailureCount: report.attempts.infrastructureFailureCount,
    planningMaterialEffectRate: power.materialEffectRate,
    provenanceSha256,
    reportSha256,
    requiredEpisodes,
    requiredRepositories: budget.repositories,
    requiredScoredStages: requiredEpisodes * power.stagesPerEpisode,
    runId: gate.runId,
    verificationSha256,
  };
}

async function validateCandidateAssetBindings(input: {
  assetLock: C6AssetLock;
  dataset: CodexCodingEffectDatasetV3;
  datasetRoot: string;
  manifestSha256: string;
}): Promise<{
  repositoryContentSha256ByAssetPath: Record<string, string>;
  taskContentSha256ByEpisodeId: Record<string, string>;
  taskOriginEvidenceByEpisodeId: Record<string, {
    candidateTaskContentSha256: string;
    relationshipEdges: C6TaskOriginRelationshipEvidence[];
    receiptSha256: string;
    sourceRecordSha256: string;
    stageOrigins: C6TaskOriginStageEvidence[];
  }>;
}> {
  const filesByPath = new Map(
    input.assetLock.files.map((file) => [file.path, file]),
  );
  assertAssetHash(filesByPath, "manifest.json", input.manifestSha256);
  const assetHashes = new Set(
    input.assetLock.files.map((file) => file.sha256),
  );
  const taskOriginEvidenceByEpisodeId: Record<string, {
    candidateTaskContentSha256: string;
    relationshipEdges: C6TaskOriginRelationshipEvidence[];
    receiptSha256: string;
    sourceRecordSha256: string;
    stageOrigins: C6TaskOriginStageEvidence[];
  }> = {};
  const taskOriginSourceRecords = new Map<string, {
    relationshipEdges: C6TaskOriginRelationshipEvidence[];
    receipt: z.infer<typeof taskOriginReceiptSchema>;
    record: C6TaskOriginSourceRecord;
    receiptSha256: string;
  }>();
  for (const episode of input.dataset.episodes) {
    if (episode.repository.assetPath === undefined) {
      throw new Error(
        `C6 dataset episode ${episode.id} requires repository.assetPath`,
      );
    }
    if (episode.sourceType !== "controlled-mutation") {
      const reference = episode.taskOriginReceipt;
      if (reference === undefined) {
        throw new Error(
          `C6 ${episode.sourceType} episode ${episode.id} requires task-origin evidence`,
        );
      }
      assertAssetHash(filesByPath, reference.path, reference.sha256);
      const receiptBytes = await readRegularFile(
        resolve(input.datasetRoot, reference.path),
        "task-origin receipt",
      );
      if (sha256(receiptBytes) !== reference.sha256) {
        throw new Error(
          `C6 task-origin receipt for ${episode.id} does not match the asset lock`,
        );
      }
      const receipt = taskOriginReceiptSchema.parse(
        JSON.parse(receiptBytes.toString("utf8")) as unknown,
      );
      if (receipt.episodeId !== episode.id) {
        throw new Error(
          `C6 task-origin receipt does not match episode ${episode.id}`,
        );
      }
      if (receipt.sourceType !== episode.sourceType) {
        throw new Error(
          `C6 task-origin receipt source type does not match episode ${episode.id}`,
        );
      }
      assertAssetHash(
        filesByPath,
        receipt.sourceRecord.path,
        receipt.sourceRecord.sha256,
      );
      const sourceRecordBytes = await readRegularFile(
        resolve(input.datasetRoot, receipt.sourceRecord.path),
        "task-origin source record",
      );
      if (sha256(sourceRecordBytes) !== receipt.sourceRecord.sha256) {
        throw new Error(
          `C6 task-origin source record for ${episode.id} does not match the asset lock`,
        );
      }
      const sourceRecord = taskOriginSourceRecordSchema.parse(
        JSON.parse(sourceRecordBytes.toString("utf8")) as unknown,
      );
      if (sourceRecord.episodeId !== episode.id) {
        throw new Error(
          `C6 task-origin source record does not match episode ${episode.id}`,
        );
      }
      if (sourceRecord.sourceType !== episode.sourceType) {
        throw new Error(
          `C6 task-origin source record type does not match episode ${episode.id}`,
        );
      }
      if (
        sourceRecord.repository.url !== episode.repository.url ||
        sourceRecord.repository.baseCommit !== episode.repository.baseCommit
      ) {
        throw new Error(
          `C6 task-origin source record does not match repository ${episode.id}`,
        );
      }
      for (const stageOrigin of sourceRecord.stages) {
        try {
          const upstreamReference = stageOrigin.originReceipt;
          assertAssetHash(
            filesByPath,
            upstreamReference.path,
            upstreamReference.sha256,
          );
          const lockedUpstreamReceipt = filesByPath.get(
            upstreamReference.path,
          );
          const upstreamReceiptBytes = await readRegularFile(
            resolve(input.datasetRoot, upstreamReference.path),
            "task-origin upstream receipt",
          );
          if (
            lockedUpstreamReceipt?.bytes !== upstreamReference.bytes ||
            upstreamReceiptBytes.byteLength !== upstreamReference.bytes ||
            sha256(upstreamReceiptBytes) !== upstreamReference.sha256
          ) {
            throw new Error("upstream receipt identity does not match");
          }
          const derivedOrigin = deriveGitHubIssueOrigin(
            upstreamReceiptBytes,
          );
          if (
            derivedOrigin.originalRequest !== stageOrigin.originalRequest ||
            derivedOrigin.originalRequestSha256 !==
              stageOrigin.originalRequestSha256 ||
            derivedOrigin.repositoryUrl !== sourceRecord.repository.url ||
            derivedOrigin.sourceKind !== stageOrigin.source.kind ||
            derivedOrigin.sourceLocator !== stageOrigin.source.locator ||
            derivedOrigin.upstreamItemRevision !==
              stageOrigin.source.revision
          ) {
            throw new Error("upstream receipt content does not match");
          }
        } catch {
          throw new Error(
            `C6 task-origin upstream receipt for ${episode.id}:${stageOrigin.stageId} does not match the source record`,
          );
        }
      }
      const repositoryLocator = episode.repository.url.replace(/\.git$/u, "");
      if (
        sourceRecord.stages.length !== episode.stages.length ||
        sourceRecord.stages.some((stageOrigin, index) =>
          stageOrigin.stageId !== episode.stages[index]?.id ||
          !stageOrigin.source.locator.startsWith(`${repositoryLocator}/`)
        )
      ) {
        throw new Error(
          `C6 task-origin source record does not bind every repository stage ${episode.id}`,
        );
      }
      const relationshipEdges = await Promise.all(
        sourceRecord.relationships.map(async (relationship, index) => {
          const priorOrigin = sourceRecord.stages[index]!;
          const laterOrigin = sourceRecord.stages[index + 1]!;
          const laterStage = episode.stages[index + 1]!;
          if (
            !relationship.path.startsWith(
              `provenance/task-origin/relationships/${episode.id}/`,
            )
          ) {
            throw new Error(
              `C6 task relationship receipt path does not match episode ${episode.id}`,
            );
          }
          assertAssetHash(
            filesByPath,
            relationship.path,
            relationship.sha256,
          );
          const lockedRelationship = filesByPath.get(relationship.path);
          const relationshipBytes = await readRegularFile(
            resolve(input.datasetRoot, relationship.path),
            "task relationship receipt",
          );
          if (
            lockedRelationship?.bytes !== relationship.bytes ||
            relationshipBytes.byteLength !== relationship.bytes ||
            sha256(relationshipBytes) !== relationship.sha256
          ) {
            throw new Error(
              `C6 task relationship receipt does not match the asset lock ${episode.id}`,
            );
          }
          const referencedArtifacts = await Promise.all(
            listC6TaskRelationshipArtifactReferences(
              relationshipBytes,
            ).map(async (artifact) => {
              assertAssetHash(
                filesByPath,
                artifact.path,
                artifact.sha256,
              );
              const lockedArtifact = filesByPath.get(artifact.path);
              const bytes = await readRegularFile(
                resolve(input.datasetRoot, artifact.path),
                "task relationship source artifact",
              );
              if (
                lockedArtifact?.bytes !== artifact.bytes ||
                bytes.byteLength !== artifact.bytes ||
                sha256(bytes) !== artifact.sha256
              ) {
                throw new Error(
                  `C6 task relationship source artifact does not match the asset lock ${artifact.path}`,
                );
              }
              return [artifact.path, bytes] as const;
            }),
          );
          const evidence = validateC6TaskRelationshipReceipt({
            artifactsByPath: new Map(referencedArtifacts),
            episodeId: episode.id,
            laterBaseCommit: laterStage.snapshot,
            laterStageId: laterOrigin.stageId,
            laterStageOrigin: laterOrigin.originReceipt,
            priorStageId: priorOrigin.stageId,
            priorStageOrigin: priorOrigin.originReceipt,
            receiptBytes: relationshipBytes,
            repositoryUrl: sourceRecord.repository.url,
          });
          return {
            ...evidence,
            relationshipReceiptBytes: relationship.bytes,
            relationshipReceiptPath: relationship.path,
          };
        }),
      );
      assertC6TaskRelationshipEdgeCoverage({
        edges: relationshipEdges,
        episodeId: episode.id,
        stageIds: sourceRecord.stages.map((stage) => stage.stageId),
      });
      taskOriginSourceRecords.set(episode.id, {
        relationshipEdges,
        receipt,
        receiptSha256: reference.sha256,
        record: sourceRecord,
      });
    }
    for (const forbiddenSha256 of [
      ...episode.forbiddenLeakage.fileSha256,
      ...episode.stages.flatMap((stage) =>
        stage.history.forbiddenLeakageSha256
      ),
    ]) {
      if (!assetHashes.has(forbiddenSha256)) {
        throw new Error(
          `C6 dataset forbidden artifact ${forbiddenSha256} is outside the asset lock`,
        );
      }
    }
    for (const stage of episode.stages) {
      assertAssetHash(filesByPath, stage.history.path, stage.history.sha256);
      assertAssetPath(filesByPath, stage.promptPath, "prompt");
      assertAssetHash(
        filesByPath,
        stage.goldPatch.path,
        stage.goldPatch.sha256,
      );
    }
  }
  const repositoryContentSha256ByAssetPath = Object.fromEntries(
    [...new Set(input.dataset.episodes.map((episode) =>
      episode.repository.assetPath!
    ))].map((assetPath) => {
      const prefix = `${assetPath}/`;
      const files = input.assetLock.files
        .filter((file) => file.path.startsWith(prefix))
        .map((file) => ({
          bytes: file.bytes,
          mode: file.mode,
          path: file.path.slice(prefix.length),
          sha256: file.sha256,
        }))
        .filter((file) =>
          file.path !== ".git" && !file.path.startsWith(".git/")
        )
        .sort((left, right) => left.path.localeCompare(right.path));
      if (files.length === 0) {
        throw new Error(
          `C6 dataset repository ${assetPath} has no locked working-tree files`,
        );
      }
      return [assetPath, sha256(JSON.stringify(files))];
    }),
  );
  const taskContentSha256ByEpisodeId = Object.fromEntries(
    input.dataset.episodes.map((episode) => [
      episode.id,
      computeC6AgentVisibleTaskContentSha256({
        episode,
        promptSha256ByPath: Object.fromEntries(
          episode.stages.map((stage) => [
            stage.promptPath,
            filesByPath.get(stage.promptPath)!.sha256,
          ]),
        ),
      }),
    ]),
  );
  for (const episode of input.dataset.episodes) {
    if (episode.sourceType === "controlled-mutation") {
      continue;
    }
    const origin = taskOriginSourceRecords.get(episode.id)!;
    if (
      origin.record.candidateTaskContentSha256 !==
        taskContentSha256ByEpisodeId[episode.id]
    ) {
      throw new Error(
        `C6 task-origin source record for ${episode.id} does not bind candidate task content`,
      );
    }
    taskOriginEvidenceByEpisodeId[episode.id] = {
      candidateTaskContentSha256:
        origin.record.candidateTaskContentSha256,
      relationshipEdges: origin.relationshipEdges,
      receiptSha256: origin.receiptSha256,
      sourceRecordSha256: origin.receipt.sourceRecord.sha256,
      stageOrigins: origin.record.stages.map((stage) => ({
        originalRequestSha256: stage.originalRequestSha256,
        originReceiptBytes: stage.originReceipt.bytes,
        originReceiptPath: stage.originReceipt.path,
        originReceiptSha256: stage.originReceipt.sha256,
        sourceLocator: stage.source.locator,
        stageId: stage.stageId,
        upstreamItemRevision: stage.source.revision,
      })),
    };
  }
  return {
    repositoryContentSha256ByAssetPath,
    taskContentSha256ByEpisodeId,
    taskOriginEvidenceByEpisodeId,
  };
}

export function computeC6AgentVisibleTaskContentSha256(input: {
  episode: CodexCodingEffectDatasetV3["episodes"][number];
  promptSha256ByPath: Readonly<Record<string, string>>;
}): string {
  const stages = input.episode.stages.map((stage) => {
    const promptSha256 = input.promptSha256ByPath[stage.promptPath];
    assertLowercaseSha256(
      promptSha256,
      `prompt ${stage.promptPath}`,
    );
    return {
      allowedFeedback: stage.allowedFeedback,
      historySha256: stage.history.sha256,
      promptSha256,
    };
  });
  return sha256(JSON.stringify({ stages }));
}

function assertLowercaseSha256(
  value: string | undefined,
  label: string,
): asserts value is string {
  if (value === undefined || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(
      `C6 agent-visible task ${label} must bind a lowercase SHA-256`,
    );
  }
}

function assertAssetPath(
  filesByPath: ReadonlyMap<string, unknown>,
  path: string,
  label: string,
): void {
  if (!filesByPath.has(path)) {
    throw new Error(`C6 dataset ${label} ${path} is outside the asset lock`);
  }
}

function assertAssetHash(
  filesByPath: ReadonlyMap<string, { sha256: string }>,
  path: string,
  expectedSha256: string,
): void {
  if (filesByPath.get(path)?.sha256 !== expectedSha256) {
    throw new Error(`C6 dataset asset ${path} does not match the asset lock`);
  }
}

function deriveGitHubIssueOrigin(bytes: Buffer): {
  originalRequest: string;
  originalRequestSha256: string;
  repositoryUrl: string;
  sourceKind: "issue";
  sourceLocator: string;
  upstreamItemRevision: string;
} {
  const parsed = githubIssueReceiptSchema.safeParse(
    parseJson(bytes, "invalid GitHub issue receipt"),
  );
  if (!parsed.success) {
    throw new Error("invalid GitHub issue receipt");
  }
  const locator = new URL(parsed.data.html_url);
  const repositoryApiUrl = new URL(parsed.data.repository_url);
  const locatorParts = locator.pathname.split("/").filter(Boolean);
  const repositoryParts = repositoryApiUrl.pathname
    .split("/")
    .filter(Boolean);
  if (
    locator.protocol !== "https:" ||
    locator.hostname !== "github.com" ||
    locator.username.length > 0 ||
    locator.password.length > 0 ||
    locator.search.length > 0 ||
    locator.hash.length > 0 ||
    locatorParts.length !== 4 ||
    locatorParts[2] !== "issues" ||
    Number(locatorParts[3]) !== parsed.data.number ||
    repositoryApiUrl.protocol !== "https:" ||
    repositoryApiUrl.hostname !== "api.github.com" ||
    repositoryApiUrl.username.length > 0 ||
    repositoryApiUrl.password.length > 0 ||
    repositoryApiUrl.search.length > 0 ||
    repositoryApiUrl.hash.length > 0 ||
    repositoryParts.length !== 3 ||
    repositoryParts[0] !== "repos" ||
    repositoryParts[1] !== locatorParts[0] ||
    repositoryParts[2] !== locatorParts[1]
  ) {
    throw new Error("GitHub issue receipt locator is invalid");
  }
  const originalRequest = parsed.data.body.trim();
  if (originalRequest.length === 0) {
    throw new Error("GitHub issue receipt request is empty");
  }
  return {
    originalRequest,
    originalRequestSha256: sha256(originalRequest),
    repositoryUrl:
      `https://github.com/${locatorParts[0]}/${locatorParts[1]}.git`,
    sourceKind: "issue",
    sourceLocator: parsed.data.html_url,
    upstreamItemRevision: sha256(bytes),
  };
}

function assertEqual(
  actual: boolean | number | string,
  expected: boolean | number | string,
  label: string,
): void {
  if (actual !== expected) {
    throw new Error(`${label} does not match`);
  }
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
