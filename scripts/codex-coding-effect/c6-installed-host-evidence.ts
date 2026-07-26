import { createHash } from "node:crypto";

import { z } from "zod";

import {
  readC6PackageSourceRunnerClosure,
} from "./c6-package-source-receipt-verifier";
import {
  countC6InjectedTokens,
  C6_INJECTION_TOKEN_COUNTER_ID,
  C6_INJECTION_TOKEN_COUNTER_SHA256,
} from "./c6-flat-summary";

export const C6_INSTALLED_HOST_INJECTION_EVENT_METADATA_POLICY =
  "ordered-native-hook-event-metadata-v1";
export const C6_INSTALLED_HOST_INJECTION_PLACEMENT =
  "hookSpecificOutput.additionalContext";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const hostIdentitySchema = z.object({
  codexHomeIdentitySha256: sha256Schema,
  homeIdentitySha256: sha256Schema,
}).strict();
const capturedHostIdentitySchema = hostIdentitySchema.extend({
  runnerIdentitySha256: sha256Schema,
}).strict();
const receiptReferencesSchema = z.object({
  codex: z.object({ sha256: sha256Schema }).strict(),
  package: z.object({ sha256: sha256Schema }).strict(),
  source: z.object({ sha256: sha256Schema }).strict(),
}).strict();
const capturedHookEventSchema = z.object({
  additionalContextSha256: sha256Schema,
  hookEventName: z.enum(["SessionStart", "UserPromptSubmit"]),
  hostIdentity: capturedHostIdentitySchema,
  injectedTokenCount: z.number().int().positive(),
  maxTokens: z.number().int().positive(),
  placement: z.literal(C6_INSTALLED_HOST_INJECTION_PLACEMENT),
  rawHookOutput: z.string().min(1),
  rawHookOutputSha256: sha256Schema,
  sequence: z.number().int().nonnegative(),
}).strict();
const installedHostEvidenceSchema = z.object({
  boundary: z.object({
    codexLinuxOfflineInstallProven: z.literal(false),
    codexRunReady: z.literal(false),
    executionAuthenticated: z.literal(false),
    externalIndependentAttestation: z.literal(false),
    installedHostProfileProven: z.literal(false),
    packageLinuxRebuildProven: z.literal(false),
    rawExecutionWitnessIncluded: z.literal(false),
    sourceBuildReproducible: z.literal(false),
  }).strict(),
  host: z.object({
    codex: z.object({
      linuxTarballSha256: sha256Schema,
      mainTarballSha256: sha256Schema,
      runtimeIdentitySha256: sha256Schema,
      version: z.string().min(1),
    }).strict(),
    config: z.object({
      maxTokens: z.number().int().positive(),
      sessionStartMaxTokens: z.number().int().positive(),
    }).strict(),
    goodmemory: z.object({
      packageSha256: sha256Schema,
      version: z.string().min(1),
    }).strict(),
    identity: hostIdentitySchema,
    declaredIsolation: z.object({
      codexHomeIsolated: z.literal(true),
      homeAndCodexHomeDistinct: z.literal(true),
      homeIsolated: z.literal(true),
    }).strict(),
    platform: z.object({
      architecture: z.literal("x86_64"),
      imageSha256: sha256Schema,
      operatingSystem: z.literal("linux"),
    }).strict(),
    receiptSetSha256: sha256Schema,
    runner: z.object({
      identitySha256: sha256Schema,
      sourceBytesSha256: sha256Schema,
    }).strict(),
  }).strict(),
  injection: z.object({
    eventMetadataPolicy: z.literal(
      C6_INSTALLED_HOST_INJECTION_EVENT_METADATA_POLICY,
    ),
    eventMetadataSha256: sha256Schema,
    events: z.array(capturedHookEventSchema).min(2),
    tokenCounterId: z.literal(C6_INJECTION_TOKEN_COUNTER_ID),
    tokenCounterSha256: z.literal(C6_INJECTION_TOKEN_COUNTER_SHA256),
  }).strict(),
  kind: z.literal("c6-installed-host-evidence"),
  receipts: receiptReferencesSchema,
  schemaVersion: z.literal(1),
}).strict();
const sourceReceiptSchema = z.object({
  evidenceScope: z.literal("source-build-only"),
  executor: z.object({
    imageArchitecture: z.literal("amd64"),
    imageOperatingSystem: z.literal("linux"),
    imageSha256: sha256Schema,
    networkMode: z.literal("bridge"),
  }).passthrough(),
  externalIndependentAttestation: z.literal(false),
  kind: z.literal("c6-package-source-reproducibility"),
  locallyExecutedLinuxBuild: z.literal(true),
  networkDisabled: z.literal(false),
  runnerSource: z.object({
    rootSha256: sha256Schema,
  }).passthrough(),
  runs: z.tuple([
    z.object({
      output: z.object({
        packageVersion: z.string().min(1),
        sha256: sha256Schema,
      }).passthrough(),
    }).passthrough(),
    z.object({
      output: z.object({
        packageVersion: z.string().min(1),
        sha256: sha256Schema,
      }).passthrough(),
    }).passthrough(),
  ]),
  schemaVersion: z.literal(2),
  source: z.object({
    archiveSha256: sha256Schema,
    commitSha: z.string().regex(/^[a-f0-9]{40}$/u),
    treeSha: z.string().regex(/^[a-f0-9]{40}$/u),
  }).passthrough(),
  sourceBuildReproducible: z.literal(false),
}).passthrough();
const packageReceiptSchema = z.object({
  executor: z.object({
    imageArchitecture: z.literal("amd64"),
    imageOperatingSystem: z.literal("linux"),
    imageSha256: sha256Schema,
  }).passthrough(),
  input: z.object({
    packageSha256: sha256Schema,
    packageVersion: z.string().min(1),
  }).passthrough(),
  kind: z.literal("c6-linux-x64-package-closure-rebuild"),
  linuxRebuildProven: z.literal(true),
  persistenceBoundary: z.object({
    independentReplayRequired: z.literal(true),
    rawExecutionWitnessIncluded: z.literal(false),
  }).strict(),
  schemaVersion: z.literal(1),
}).passthrough();
const codexReceiptSchema = z.object({
  boundary: z.object({
    codexRunReady: z.literal(false),
    persistedLinuxOfflineInstallProven: z.literal(false),
    persistedReceiptValidation: z.literal(
      "frozen-runner-receipt-structure-only",
    ),
  }).strict(),
  inputIdentity: z.object({
    imageSha256: sha256Schema,
    linuxTarballSha256: sha256Schema,
    mainTarballSha256: sha256Schema,
    runtimeIdentitySha256: sha256Schema,
    version: z.string().min(1),
  }).passthrough(),
  kind: z.literal("c6-codex-runtime-linux-receipt"),
  schemaVersion: z.literal(1),
}).passthrough();
const rawHookOutputSchema = z.object({
  hookSpecificOutput: z.object({
    additionalContext: z.string().min(1),
    hookEventName: z.enum(["SessionStart", "UserPromptSubmit"]),
  }).passthrough(),
}).passthrough();

export type C6InstalledHostEvidence = z.infer<
  typeof installedHostEvidenceSchema
>;
export type C6InstalledHostCapturedHookEvent = z.infer<
  typeof capturedHookEventSchema
>;

export interface C6InstalledHostReceiptBytes {
  codex: string | Uint8Array;
  package: string | Uint8Array;
  source: string | Uint8Array;
}

export interface C6InstalledHostEvidenceStructureVerification {
  codexLinuxOfflineInstallProven: false;
  codexRunReady: false;
  currentSourceRunnerBound: false;
  executionAuthenticated: false;
  externalIndependentAttestation: false;
  finalCompositionBytesBound: false;
  flatSummaryPlacementParityProven: false;
  hostIdentityDeclarationsStructurallyConsistent: true;
  injectionEventMetadataStructurallyBound: true;
  installedHostProfileProven: false;
  packageLinuxRebuildProven: false;
  rawExecutionWitnessIncluded: false;
  receiptSetSha256: string;
  receiptRelationshipsStructurallyConsistent: true;
  runnerReceiptRelationshipsStructurallyConsistent: true;
  sourceBuildReproducible: false;
}

export type C6InstalledHostEvidenceVerification = Omit<
  C6InstalledHostEvidenceStructureVerification,
  "currentSourceRunnerBound"
> & {
  currentSourceRunnerBound: true;
};

export function computeC6InstalledHostRunnerIdentitySha256(input: {
  codexHomeIdentitySha256: string;
  homeIdentitySha256: string;
  receiptSetSha256: string;
  runnerSourceBytesSha256: string;
}): string {
  const parsed = z.object({
    codexHomeIdentitySha256: sha256Schema,
    homeIdentitySha256: sha256Schema,
    receiptSetSha256: sha256Schema,
    runnerSourceBytesSha256: sha256Schema,
  }).strict().parse(input);
  return sha256(JSON.stringify(parsed));
}

export function computeC6InstalledHostInjectionEventMetadataSha256(input: {
  events: readonly C6InstalledHostCapturedHookEvent[];
  hostIdentity: z.infer<typeof capturedHostIdentitySchema>;
  tokenCounterId: typeof C6_INJECTION_TOKEN_COUNTER_ID;
  tokenCounterSha256: typeof C6_INJECTION_TOKEN_COUNTER_SHA256;
}): string {
  return sha256(JSON.stringify({
    events: input.events.map((event) => ({
      additionalContextSha256: event.additionalContextSha256,
      hookEventName: event.hookEventName,
      hostIdentity: event.hostIdentity,
      injectedTokenCount: event.injectedTokenCount,
      maxTokens: event.maxTokens,
      placement: event.placement,
      rawHookOutputSha256: event.rawHookOutputSha256,
      sequence: event.sequence,
    })),
    hostIdentity: input.hostIdentity,
    policy: C6_INSTALLED_HOST_INJECTION_EVENT_METADATA_POLICY,
    tokenCounterId: input.tokenCounterId,
    tokenCounterSha256: input.tokenCounterSha256,
  }));
}

interface C6InstalledHostEvidenceInput {
  evidence: unknown;
  receiptBytes: C6InstalledHostReceiptBytes;
  runnerSourceBytes: string | Uint8Array;
}

interface C6InstalledHostEvidenceStructureInternal {
  result: C6InstalledHostEvidenceStructureVerification;
  sourceRunnerRootSha256: string;
}

export function verifyC6InstalledHostEvidenceStructure(
  input: C6InstalledHostEvidenceInput,
): C6InstalledHostEvidenceStructureVerification {
  return verifyC6InstalledHostEvidenceStructureInternal(input).result;
}

export async function verifyC6InstalledHostEvidence(
  input: C6InstalledHostEvidenceInput,
): Promise<C6InstalledHostEvidenceVerification> {
  const verified =
    verifyC6InstalledHostEvidenceStructureInternal(input);
  const currentSourceRunnerRootSha256 =
    (await readC6PackageSourceRunnerClosure()).rootSha256;
  if (
    currentSourceRunnerRootSha256 !==
      verified.sourceRunnerRootSha256
  ) {
    throw new Error(
      "C6 installed-host current source runner closure does not match its receipt",
    );
  }
  return {
    ...verified.result,
    currentSourceRunnerBound: true,
  };
}

function verifyC6InstalledHostEvidenceStructureInternal(
  input: C6InstalledHostEvidenceInput,
): C6InstalledHostEvidenceStructureInternal {
  const evidence = installedHostEvidenceSchema.parse(input.evidence);
  const receiptBytes = {
    codex: toBuffer(input.receiptBytes.codex),
    package: toBuffer(input.receiptBytes.package),
    source: toBuffer(input.receiptBytes.source),
  };
  assertReceiptHash(
    receiptBytes.source,
    evidence.receipts.source.sha256,
    "source",
  );
  assertReceiptHash(
    receiptBytes.package,
    evidence.receipts.package.sha256,
    "package",
  );
  assertReceiptHash(
    receiptBytes.codex,
    evidence.receipts.codex.sha256,
    "Codex",
  );

  const sourceReceipt = parseJsonReceipt(
    receiptBytes.source,
    sourceReceiptSchema,
    "source",
  );
  const packageReceipt = parseJsonReceipt(
    receiptBytes.package,
    packageReceiptSchema,
    "package",
  );
  const codexReceipt = parseJsonReceipt(
    receiptBytes.codex,
    codexReceiptSchema,
    "Codex",
  );
  const receiptSetSha256 = computeReceiptSetSha256(evidence.receipts);
  if (evidence.host.receiptSetSha256 !== receiptSetSha256) {
    throw new Error("C6 installed-host receipt set identity is inconsistent");
  }

  const [firstSourceRun, secondSourceRun] = sourceReceipt.runs;
  if (
    firstSourceRun.output.sha256 !== secondSourceRun.output.sha256 ||
    firstSourceRun.output.packageVersion !==
      secondSourceRun.output.packageVersion ||
    firstSourceRun.output.sha256 !== packageReceipt.input.packageSha256 ||
    firstSourceRun.output.packageVersion !==
      packageReceipt.input.packageVersion ||
    firstSourceRun.output.sha256 !==
      evidence.host.goodmemory.packageSha256 ||
    firstSourceRun.output.packageVersion !==
      evidence.host.goodmemory.version
  ) {
    throw new Error("C6 installed-host package identity is inconsistent");
  }
  if (
    codexReceipt.inputIdentity.runtimeIdentitySha256 !==
      evidence.host.codex.runtimeIdentitySha256
  ) {
    throw new Error(
      "C6 installed-host Codex runtime identity is inconsistent",
    );
  }
  if (
    codexReceipt.inputIdentity.version !== evidence.host.codex.version ||
    codexReceipt.inputIdentity.mainTarballSha256 !==
      evidence.host.codex.mainTarballSha256 ||
    codexReceipt.inputIdentity.linuxTarballSha256 !==
      evidence.host.codex.linuxTarballSha256
  ) {
    throw new Error("C6 installed-host Codex package identity is inconsistent");
  }
  if (
    sourceReceipt.executor.imageSha256 !==
      packageReceipt.executor.imageSha256 ||
    sourceReceipt.executor.imageSha256 !==
      codexReceipt.inputIdentity.imageSha256 ||
    sourceReceipt.executor.imageSha256 !==
      evidence.host.platform.imageSha256
  ) {
    throw new Error("C6 installed-host Linux image identity is inconsistent");
  }

  if (
    evidence.host.identity.homeIdentitySha256 ===
      evidence.host.identity.codexHomeIdentitySha256
  ) {
    throw new Error(
      "C6 installed-host HOME and CODEX_HOME identities must be distinct",
    );
  }
  if (
    sha256(toBuffer(input.runnerSourceBytes)) !==
      evidence.host.runner.sourceBytesSha256
  ) {
    throw new Error(
      "C6 installed-host runner source bytes hash does not match",
    );
  }
  const expectedRunnerIdentitySha256 =
    computeC6InstalledHostRunnerIdentitySha256({
      ...evidence.host.identity,
      receiptSetSha256,
      runnerSourceBytesSha256:
        evidence.host.runner.sourceBytesSha256,
    });
  if (
    evidence.host.runner.identitySha256 !==
      expectedRunnerIdentitySha256
  ) {
    throw new Error("C6 installed-host runner identity is inconsistent");
  }

  verifyHookEvents(evidence);
  const eventMetadataSha256 =
    computeC6InstalledHostInjectionEventMetadataSha256({
      events: evidence.injection.events,
      hostIdentity: {
        ...evidence.host.identity,
        runnerIdentitySha256: evidence.host.runner.identitySha256,
      },
      tokenCounterId: evidence.injection.tokenCounterId,
      tokenCounterSha256: evidence.injection.tokenCounterSha256,
    });
  if (
    eventMetadataSha256 !==
      evidence.injection.eventMetadataSha256
  ) {
    throw new Error(
      "C6 installed-host injection event metadata identity is inconsistent",
    );
  }

  return {
    result: {
      codexLinuxOfflineInstallProven: false,
      codexRunReady: false,
      currentSourceRunnerBound: false,
      executionAuthenticated: false,
      externalIndependentAttestation: false,
      finalCompositionBytesBound: false,
      flatSummaryPlacementParityProven: false,
      hostIdentityDeclarationsStructurallyConsistent: true,
      injectionEventMetadataStructurallyBound: true,
      installedHostProfileProven: false,
      packageLinuxRebuildProven: false,
      rawExecutionWitnessIncluded: false,
      receiptRelationshipsStructurallyConsistent: true,
      receiptSetSha256,
      runnerReceiptRelationshipsStructurallyConsistent: true,
      sourceBuildReproducible: false,
    },
    sourceRunnerRootSha256: sourceReceipt.runnerSource.rootSha256,
  };
}

function verifyHookEvents(evidence: C6InstalledHostEvidence): void {
  const expectedHostIdentity = {
    ...evidence.host.identity,
    runnerIdentitySha256: evidence.host.runner.identitySha256,
  };
  for (const [index, event] of evidence.injection.events.entries()) {
    const expectedHookEventName = index === 0
      ? "SessionStart"
      : "UserPromptSubmit";
    if (
      event.sequence !== index ||
      event.hookEventName !== expectedHookEventName
    ) {
      throw new Error(
        "C6 installed-host hook events are not in raw capture order",
      );
    }
    if (JSON.stringify(event.hostIdentity) !==
      JSON.stringify(expectedHostIdentity)) {
      throw new Error(
        "C6 installed-host hook event identity is inconsistent",
      );
    }
    const expectedMaxTokens = event.hookEventName === "SessionStart"
      ? evidence.host.config.sessionStartMaxTokens
      : evidence.host.config.maxTokens;
    if (event.maxTokens !== expectedMaxTokens) {
      throw new Error(
        "C6 installed-host hook event token cap is inconsistent",
      );
    }
    if (sha256(event.rawHookOutput) !== event.rawHookOutputSha256) {
      throw new Error(
        "C6 installed-host raw hook output hash is inconsistent",
      );
    }
    const rawHookOutput = parseJsonReceipt(
      Buffer.from(event.rawHookOutput),
      rawHookOutputSchema,
      "hook output",
    ).hookSpecificOutput;
    if (rawHookOutput.hookEventName !== event.hookEventName) {
      throw new Error(
        "C6 installed-host raw hook event identity is inconsistent",
      );
    }
    const injectedTokenCount = countC6InjectedTokens(
      rawHookOutput.additionalContext,
    );
    if (
      sha256(rawHookOutput.additionalContext) !==
        event.additionalContextSha256 ||
      injectedTokenCount !== event.injectedTokenCount ||
      injectedTokenCount > event.maxTokens
    ) {
      throw new Error(
        "C6 installed-host hook context identity is inconsistent",
      );
    }
  }
}

function computeReceiptSetSha256(
  receipts: z.infer<typeof receiptReferencesSchema>,
): string {
  return sha256(JSON.stringify({
    codex: receipts.codex.sha256,
    package: receipts.package.sha256,
    source: receipts.source.sha256,
  }));
}

function assertReceiptHash(
  bytes: Uint8Array,
  expectedSha256: string,
  label: string,
): void {
  if (sha256(bytes) !== expectedSha256) {
    throw new Error(
      `C6 installed-host ${label} receipt hash does not match`,
    );
  }
}

function parseJsonReceipt<T>(
  bytes: Uint8Array,
  schema: z.ZodType<T>,
  label: string,
): T {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch {
    throw new Error(`C6 installed-host ${label} receipt is not valid JSON`);
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `C6 installed-host ${label} receipt failed schema validation`,
    );
  }
  return parsed.data;
}

function toBuffer(value: string | Uint8Array): Buffer {
  return Buffer.from(value);
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
