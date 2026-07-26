import { createHash } from "node:crypto";
import {
  relative,
  resolve,
  sep,
} from "node:path";
import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import {
  readC6StableRegularFile,
} from "./c6-asset-lock";
import {
  rebaseC6SourceV3SimplePassArtifactBundle,
  verifyC6SourceV3SimplePassArtifactBundle,
} from "./c6-source-v3-simple-census-artifacts";
import type {
  C6SourceV3SimplePassArtifactBundle,
} from "./c6-source-v3-simple-census-artifacts";
import type {
  C6SourceV3SimpleFrameDefinition,
  C6SourceV3SimpleNormalizedPass,
} from "./c6-source-v3-simple-census-core";
import {
  C6SourceV3SimpleTwoPassMismatchError,
} from "./c6-source-v3-simple-census-errors";
import {
  assertC6SourceV3SimpleFrozenInputsCurrent,
  assertC6SourceV3SimpleTreeHasNoSecret,
  verifyC6SourceV3SimpleCensusAssetLock,
  verifyC6SourceV3SimpleFrozenInputClosure,
  verifyC6SourceV3SimpleFrozenInputClosureArtifact,
  verifyC6SourceV3SimpleFrozenInputMutationEvidence,
} from "./c6-source-v3-simple-census-finalization";
import type {
  C6SourceV3SimpleExpectedFrozenInputs,
} from "./c6-source-v3-simple-census-finalization";
import {
  commitC6SourceV3SimpleCreateOnlyCanonicalJson,
  readC6SourceV3SimpleLogicalRequestEvidence,
  verifyC6SourceV3SimpleFailureChainTipMarker,
} from "./c6-source-v3-simple-census-ledger";
import type {
  C6SourceV3SimpleArtifactReference,
} from "./c6-source-v3-simple-census-ledger";
import {
  replayC6SourceV3SimpleNormalizedPass,
} from "./c6-source-v3-simple-census-replay";
import type {
  C6SourceV3SimpleProjectedLogicalRequest,
} from "./c6-source-v3-simple-census-replay";
import {
  deriveC6SourceV3SimpleProactivePause,
} from "./c6-source-v3-simple-census-transport";

const ZERO_SHA256 = "0".repeat(64);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const artifactReferenceSchema = z.object({
  bytes: z.number().int().nonnegative(),
  path: z.string().min(1),
  sha256: sha256Schema,
}).strict();
const logicalRequestCompletionSchema = z.object({
  artifact: artifactReferenceSchema,
  logicalRequestOrdinal: z.number().int().positive(),
}).strict();
const passCompleteSchema = z.object({
  artifactKind: z.literal(
    "c6-source-v3-simple-pass-complete",
  ),
  attemptLedgerRootSha256: sha256Schema,
  countTreeClosure: artifactReferenceSchema,
  evaluationId: z.string().min(1),
  executionContractSha256: sha256Schema,
  frozenInputClosureSha256: sha256Schema,
  genesisSha256: sha256Schema,
  lastLogicalRequestCompletionSha256: sha256Schema,
  logicalRequestCompletionArtifacts:
    z.array(logicalRequestCompletionSchema).min(1),
  logicalRequestCount: z.number().int().positive(),
  normalizedProjection: artifactReferenceSchema,
  normalizedProjectionSha256: sha256Schema,
  pass: z.enum(["A", "B"]),
  pullRequestClosure: artifactReferenceSchema,
  repositoryClosure: artifactReferenceSchema,
  runtimeAuthorizationSha256: sha256Schema,
  schemaVersion: z.literal(1),
}).strict();
const twoPassEqualitySchema = z.object({
  artifactKind: z.literal(
    "c6-source-v3-simple-two-pass-equality",
  ),
  evaluationId: z.string().min(1),
  executionContractSha256: sha256Schema,
  frozenInputClosureSha256: sha256Schema,
  normalizedProjectionSha256: sha256Schema,
  passAComplete: artifactReferenceSchema,
  passBComplete: artifactReferenceSchema,
  runtimeAuthorizationSha256: sha256Schema,
  schemaVersion: z.literal(1),
}).strict();
const censusReceiptSchema = z.object({
  acceptedCandidateCount:
    z.number().int().nonnegative(),
  acceptedRepositoryCount:
    z.number().int().nonnegative(),
  artifactKind: z.literal(
    "c6-source-v3-simple-census-receipt",
  ),
  evaluationId: z.string().min(1),
  executionContractSha256: sha256Schema,
  frozenInputClosure: artifactReferenceSchema,
  frozenInputClosureSha256: sha256Schema,
  normalizedProjectionSha256: sha256Schema,
  passAComplete: artifactReferenceSchema,
  passALogicalRequestCount:
    z.number().int().positive(),
  passBComplete: artifactReferenceSchema,
  passBLogicalRequestCount:
    z.number().int().positive(),
  pullRequestCount: z.number().int().nonnegative(),
  repositoryCount: z.number().int().nonnegative(),
  runtimeAuthorizationSha256: sha256Schema,
  schemaVersion: z.literal(1),
  inputClosureSha256: sha256Schema,
  twoPassEqualityReceipt: artifactReferenceSchema,
}).strict();
const terminalCompleteSchema = z.object({
  assetLock: artifactReferenceSchema,
  censusReceipt: artifactReferenceSchema,
  evaluationId: z.string().min(1),
  executionContractSha256: sha256Schema,
  frozenInputClosure: artifactReferenceSchema,
  frozenInputClosureSha256: sha256Schema,
  outcome: z.literal("complete"),
  passAComplete: artifactReferenceSchema,
  passBComplete: artifactReferenceSchema,
  runtimeAuthorizationSha256: sha256Schema,
  schemaVersion: z.literal(1),
  inputClosureSha256: sha256Schema,
  twoPassEqualityReceipt: artifactReferenceSchema,
}).strict();
const failureCodeSchema = z.enum([
  "corrupt-ledger",
  "input-mutation",
  "maximum-attempts-exhausted",
  "partial-response",
  "publication-failure",
  "rate-limit-pause-exceeded",
  "response-terminal",
  "secret-leak",
  "single-writer-conflict",
  "transport-terminal",
  "two-pass-mismatch",
]);
export type C6SourceV3SimpleFailureCode =
  z.infer<typeof failureCodeSchema>;
const failureEvidenceSchema = z.object({
  artifactKind: z.literal(
    "c6-source-v3-simple-failure-evidence",
  ),
  chainTip: artifactReferenceSchema,
  evaluationId: z.string().min(1),
  executionContractSha256: sha256Schema,
  failureCode: failureCodeSchema,
  frozenInputClosureSha256: sha256Schema,
  runtimeAuthorizationSha256: sha256Schema,
  schemaVersion: z.literal(1),
}).strict();
const terminalFailedSchema = z.object({
  assetLock: artifactReferenceSchema,
  chainTip: artifactReferenceSchema,
  evaluationId: z.string().min(1),
  executionContractSha256: sha256Schema,
  failureCode: failureCodeSchema,
  failureEvidence: artifactReferenceSchema,
  frozenInputClosure: artifactReferenceSchema,
  frozenInputClosureSha256: sha256Schema,
  outcome: z.literal("failed"),
  runtimeAuthorizationSha256: sha256Schema,
  schemaVersion: z.literal(1),
  inputClosureSha256: sha256Schema,
}).strict();
const terminalSchema = z.discriminatedUnion("outcome", [
  terminalCompleteSchema,
  terminalFailedSchema,
]);

export type C6SourceV3SimpleTerminal = z.infer<
  typeof terminalSchema
>;

export function hashC6SourceV3SimpleAttemptLedgerRoot(
  input: readonly {
    logicalRequestOrdinal: number;
    sha256: string;
  }[],
): string {
  const hash = createHash("sha256");
  for (const [index, entry] of input.entries()) {
    if (
      entry.logicalRequestOrdinal !== index + 1 ||
      !sha256Schema.safeParse(entry.sha256).success
    ) {
      throw new Error(
        "C6 source-v3-simple attempt ledger is not contiguous",
      );
    }
    hash.update(
      `${entry.logicalRequestOrdinal}\u0000${entry.sha256}\n`,
    );
  }
  return hash.digest("hex");
}

export async function readVerifiedC6SourceV3SimplePassCompleteIfExists(
  input: {
    assetRoot: string;
    evaluationId: string;
    executionContractSha256: string;
    frame: C6SourceV3SimpleFrameDefinition;
    frozenInputClosureSha256: string;
    genesisSha256: string;
    pass: "A" | "B";
    runtimeAuthorizationSha256: string;
  },
): Promise<{
  lastLogicalRequestCompletion:
    C6SourceV3SimpleArtifactReference;
  logicalRequestCount: number;
  passComplete: C6SourceV3SimpleArtifactReference;
} | null> {
  const passComplete = await referenceIfExists(
    input.assetRoot,
    `pass-${input.pass.toLowerCase()}/pass-complete.json`,
  );
  if (passComplete === null) {
    return null;
  }
  const pass = await readPassComplete(
    input.assetRoot,
    passComplete,
    input.frame,
  );
  if (
    pass.evaluationId !== input.evaluationId ||
    pass.executionContractSha256 !==
      input.executionContractSha256 ||
    pass.frozenInputClosureSha256 !==
      input.frozenInputClosureSha256 ||
    pass.genesisSha256 !== input.genesisSha256 ||
    pass.pass !== input.pass ||
    pass.runtimeAuthorizationSha256 !==
      input.runtimeAuthorizationSha256
  ) {
    throw new Error(
      "C6 source-v3-simple pass completion context mismatch",
    );
  }
  return {
    lastLogicalRequestCompletion:
      pass.logicalRequestCompletionArtifacts.at(-1)!
        .artifact,
    logicalRequestCount: pass.logicalRequestCount,
    passComplete,
  };
}

export async function writeC6SourceV3SimplePassComplete(
  input: {
    assetRoot: string;
    countTreeClosure:
      C6SourceV3SimpleArtifactReference;
    evaluationId: string;
    executionContractSha256: string;
    frame: C6SourceV3SimpleFrameDefinition;
    frozenInputClosureSha256: string;
    genesisSha256: string;
    logicalRequestCompletions: readonly {
      artifact: C6SourceV3SimpleArtifactReference;
      logicalRequestOrdinal: number;
    }[];
    normalizedProjectionSha256: string;
    normalizedProjection:
      C6SourceV3SimpleArtifactReference;
    pass: "A" | "B";
    passRoot: string;
    pullRequestClosure:
      C6SourceV3SimpleArtifactReference;
    repositoryClosure:
      C6SourceV3SimpleArtifactReference;
    runtimeAuthorizationSha256: string;
  },
): Promise<C6SourceV3SimpleArtifactReference> {
  if (
    (
      input.pass === "A" &&
      input.genesisSha256 !== ZERO_SHA256
    ) ||
    (
      input.pass === "B" &&
      input.genesisSha256 === ZERO_SHA256
    )
  ) {
    throw new Error(
      "C6 source-v3-simple pass genesis mismatch",
    );
  }
  const closureReferences = [
    input.countTreeClosure,
    input.repositoryClosure,
    input.pullRequestClosure,
  ];
  for (const reference of closureReferences) {
    await verifyReference(input.passRoot, reference);
  }
  for (const completion of input.logicalRequestCompletions) {
    await verifyReference(
      input.passRoot,
      completion.artifact,
    );
  }
  const rebasedClosures = closureReferences.map(
    (reference) =>
      rebaseReference(
        input.assetRoot,
        input.passRoot,
        reference,
      ),
  );
  const rebasedCompletions =
    input.logicalRequestCompletions.map(
      (completion) => ({
        artifact: rebaseReference(
          input.assetRoot,
          input.passRoot,
          completion.artifact,
        ),
        logicalRequestOrdinal:
          completion.logicalRequestOrdinal,
      }),
    );
  const rebasedBundle =
    rebaseC6SourceV3SimplePassArtifactBundle(
      input.assetRoot,
      input.passRoot,
      {
        countTreeClosure: input.countTreeClosure,
        normalizedProjection:
          input.normalizedProjection,
        normalizedProjectionSha256:
          input.normalizedProjectionSha256,
        pullRequestClosure:
          input.pullRequestClosure,
        repositoryClosure:
          input.repositoryClosure,
      },
    );
  const artifactBundle =
    await verifyC6SourceV3SimplePassArtifactBundle({
    assetRoot: input.assetRoot,
    bundle: rebasedBundle,
    evaluationId: input.evaluationId,
    executionContractSha256:
      input.executionContractSha256,
    frame: input.frame,
    frozenInputClosureSha256:
      input.frozenInputClosureSha256,
    pass: input.pass,
    runtimeAuthorizationSha256:
      input.runtimeAuthorizationSha256,
  });
  const projectedRequests =
    await verifyLogicalRequestCompletionChain({
    assetRoot: input.assetRoot,
    evaluationId: input.evaluationId,
    executionContractSha256:
      input.executionContractSha256,
    frozenInputClosureSha256:
      input.frozenInputClosureSha256,
    genesisSha256: input.genesisSha256,
    pass: input.pass,
    completions: rebasedCompletions,
    runtimeAuthorizationSha256:
      input.runtimeAuthorizationSha256,
  });
  await assertC6SourceV3SimplePassCausalReplay({
    artifactPass: artifactBundle.normalizedPass,
    frame: input.frame,
    projectedRequests,
  });
  const attemptLedgerRootSha256 =
    hashC6SourceV3SimpleAttemptLedgerRoot(
      input.logicalRequestCompletions.map(
        (completion) => ({
          logicalRequestOrdinal:
            completion.logicalRequestOrdinal,
          sha256: completion.artifact.sha256,
        }),
      ),
    );
  const lastCompletion =
    input.logicalRequestCompletions.at(-1);
  if (lastCompletion === undefined) {
    throw new Error(
      "C6 source-v3-simple pass has no logical requests",
    );
  }
  const localReference =
    await commitC6SourceV3SimpleCreateOnlyCanonicalJson(
      input.passRoot,
      "pass-complete.json",
      passCompleteSchema.parse({
        artifactKind:
          "c6-source-v3-simple-pass-complete",
        attemptLedgerRootSha256,
        countTreeClosure: rebasedClosures[0],
        evaluationId: input.evaluationId,
        executionContractSha256:
          input.executionContractSha256,
        frozenInputClosureSha256:
          input.frozenInputClosureSha256,
        genesisSha256: input.genesisSha256,
        lastLogicalRequestCompletionSha256:
          lastCompletion.artifact.sha256,
        logicalRequestCompletionArtifacts:
          rebasedCompletions,
        logicalRequestCount:
          input.logicalRequestCompletions.length,
        normalizedProjection:
          rebasedBundle.normalizedProjection,
        normalizedProjectionSha256:
          input.normalizedProjectionSha256,
        pass: input.pass,
        pullRequestClosure:
          rebasedClosures[2],
        repositoryClosure:
          rebasedClosures[1],
        runtimeAuthorizationSha256:
          input.runtimeAuthorizationSha256,
        schemaVersion: 1,
      }),
    );
  return rebaseReference(
    input.assetRoot,
    input.passRoot,
    localReference,
  );
}

export async function writeC6SourceV3SimpleTwoPassEqualityReceipt(
  input: {
    assetRoot: string;
    authorizationTokenProvider:
      () => Promise<Uint8Array>;
    evaluationId: string;
    executionContractSha256: string;
    frame: C6SourceV3SimpleFrameDefinition;
    frozenInputClosureSha256: string;
    passAComplete:
      C6SourceV3SimpleArtifactReference;
    passBComplete:
      C6SourceV3SimpleArtifactReference;
    runtimeAuthorizationSha256: string;
  },
) {
  const passA = await readPassComplete(
    input.assetRoot,
    input.passAComplete,
    input.frame,
  );
  const passB = await readPassComplete(
    input.assetRoot,
    input.passBComplete,
    input.frame,
  );
  assertPassPair({
    evaluationId: input.evaluationId,
    executionContractSha256:
      input.executionContractSha256,
    frozenInputClosureSha256:
      input.frozenInputClosureSha256,
    passA,
    passAComplete: input.passAComplete,
    passB,
    passBComplete: input.passBComplete,
    runtimeAuthorizationSha256:
      input.runtimeAuthorizationSha256,
  });
  return await commitC6SourceV3SimpleTwoPassEqualityReceiptAfterPassValidation({
    assetRoot: input.assetRoot,
    authorizationTokenProvider:
      input.authorizationTokenProvider,
    evaluationId: input.evaluationId,
    executionContractSha256:
      input.executionContractSha256,
    frozenInputClosureSha256:
      input.frozenInputClosureSha256,
    normalizedProjectionSha256:
      passA.normalizedProjectionSha256,
    passAComplete: input.passAComplete,
    passBComplete: input.passBComplete,
    runtimeAuthorizationSha256:
      input.runtimeAuthorizationSha256,
  });
}

export async function commitC6SourceV3SimpleTwoPassEqualityReceiptAfterPassValidation(
  input: {
    assetRoot: string;
    authorizationTokenProvider:
      () => Promise<Uint8Array>;
    evaluationId: string;
    executionContractSha256: string;
    frozenInputClosureSha256: string;
    normalizedProjectionSha256: string;
    passAComplete:
      C6SourceV3SimpleArtifactReference;
    passBComplete:
      C6SourceV3SimpleArtifactReference;
    runtimeAuthorizationSha256: string;
  },
) {
  const receipt = twoPassEqualitySchema.parse({
    artifactKind:
      "c6-source-v3-simple-two-pass-equality",
    evaluationId: input.evaluationId,
    executionContractSha256:
      input.executionContractSha256,
    frozenInputClosureSha256:
      input.frozenInputClosureSha256,
    normalizedProjectionSha256:
      input.normalizedProjectionSha256,
    passAComplete: input.passAComplete,
    passBComplete: input.passBComplete,
    runtimeAuthorizationSha256:
      input.runtimeAuthorizationSha256,
    schemaVersion: 1,
  });
  const existing = await referenceIfExists(
    input.assetRoot,
    "two-pass-equality.json",
  );
  if (existing !== null) {
    const equality = await readTwoPassEquality(
      input.assetRoot,
      existing,
    );
    assertEqualityReceipt({
      equality,
      evaluationId: input.evaluationId,
      executionContractSha256:
        input.executionContractSha256,
      frozenInputClosureSha256:
        input.frozenInputClosureSha256,
      normalizedProjectionSha256:
        input.normalizedProjectionSha256,
      passAComplete: input.passAComplete,
      passBComplete: input.passBComplete,
      runtimeAuthorizationSha256:
        input.runtimeAuthorizationSha256,
    });
    return {
      authorizationToken:
        await input.authorizationTokenProvider(),
      equalityReceipt: existing,
    };
  }
  const authorizationToken =
    await input.authorizationTokenProvider();
  const equalityReceipt =
    await commitC6SourceV3SimpleCreateOnlyCanonicalJson(
      input.assetRoot,
      "two-pass-equality.json",
      receipt,
    );
  return {
    authorizationToken,
    equalityReceipt,
  };
}

export async function writeC6SourceV3SimpleCensusReceipt(
  input: {
    assetRoot: string;
    expectedFrozenInputs:
      C6SourceV3SimpleExpectedFrozenInputs;
    frozenInputClosure:
      C6SourceV3SimpleArtifactReference;
    passAComplete:
      C6SourceV3SimpleArtifactReference;
    passBComplete:
      C6SourceV3SimpleArtifactReference;
    repositoryRoot: string;
    twoPassEqualityReceipt:
      C6SourceV3SimpleArtifactReference;
  },
): Promise<C6SourceV3SimpleArtifactReference> {
  await verifyC6SourceV3SimpleFrozenInputClosure({
    assetRoot: input.assetRoot,
    expected: input.expectedFrozenInputs,
    reference: input.frozenInputClosure,
    repositoryRoot: input.repositoryRoot,
  });
  const passA = await readPassComplete(
    input.assetRoot,
    input.passAComplete,
    input.expectedFrozenInputs.frame,
  );
  const passB = await readPassComplete(
    input.assetRoot,
    input.passBComplete,
    input.expectedFrozenInputs.frame,
  );
  assertPassPair({
    evaluationId:
      input.expectedFrozenInputs.evaluationId,
    executionContractSha256:
      input.expectedFrozenInputs
        .executionContractSha256,
    frozenInputClosureSha256:
      input.frozenInputClosure.sha256,
    passA,
    passAComplete: input.passAComplete,
    passB,
    passBComplete: input.passBComplete,
    runtimeAuthorizationSha256:
      input.expectedFrozenInputs
        .runtimeAuthorizationSha256,
  });
  const equality = await readTwoPassEquality(
    input.assetRoot,
    input.twoPassEqualityReceipt,
  );
  assertEqualityReceipt({
    equality,
    evaluationId:
      input.expectedFrozenInputs.evaluationId,
    executionContractSha256:
      input.expectedFrozenInputs
        .executionContractSha256,
    frozenInputClosureSha256:
      input.frozenInputClosure.sha256,
    normalizedProjectionSha256:
      passA.normalizedProjectionSha256,
    passAComplete: input.passAComplete,
    passBComplete: input.passBComplete,
    runtimeAuthorizationSha256:
      input.expectedFrozenInputs
        .runtimeAuthorizationSha256,
  });
  const normalizedPass = (
    await verifyPassArtifactBundle(
      input.assetRoot,
      passA,
      input.expectedFrozenInputs.frame,
    )
  ).normalizedPass;
  return await commitC6SourceV3SimpleCreateOnlyCanonicalJson(
    input.assetRoot,
    "census-receipt.json",
    censusReceiptSchema.parse({
      acceptedCandidateCount:
        normalizedPass.metadataDecisions.filter(
          (decision) => decision.accepted,
        ).length,
      acceptedRepositoryCount:
        normalizedPass.repositoryDecisions.filter(
          (decision) => decision.accepted,
        ).length,
      artifactKind:
        "c6-source-v3-simple-census-receipt",
      evaluationId:
        input.expectedFrozenInputs.evaluationId,
      executionContractSha256:
        input.expectedFrozenInputs
          .executionContractSha256,
      frozenInputClosure:
        input.frozenInputClosure,
      frozenInputClosureSha256:
        input.frozenInputClosure.sha256,
      normalizedProjectionSha256:
        passA.normalizedProjectionSha256,
      passAComplete: input.passAComplete,
      passALogicalRequestCount:
        passA.logicalRequestCount,
      passBComplete: input.passBComplete,
      passBLogicalRequestCount:
        passB.logicalRequestCount,
      pullRequestCount:
        normalizedPass.pullRequests.length,
      repositoryCount:
        normalizedPass.repositories.length,
      runtimeAuthorizationSha256:
        input.expectedFrozenInputs
          .runtimeAuthorizationSha256,
      schemaVersion: 1,
      inputClosureSha256:
        input.expectedFrozenInputs
          .inputClosureSha256,
      twoPassEqualityReceipt:
        input.twoPassEqualityReceipt,
    }),
  );
}

export async function writeC6SourceV3SimpleFailureEvidence(
  input: {
    assetRoot: string;
    chainTip: C6SourceV3SimpleArtifactReference;
    expectedFrozenInputs:
      C6SourceV3SimpleExpectedFrozenInputs;
    failureCode: z.infer<typeof failureCodeSchema>;
    frozenInputClosure:
      C6SourceV3SimpleArtifactReference;
  },
): Promise<C6SourceV3SimpleArtifactReference> {
  await verifyFailureChainTip(input);
  return await commitC6SourceV3SimpleCreateOnlyCanonicalJson(
    input.assetRoot,
    "failure-evidence.json",
    failureEvidenceSchema.parse({
      artifactKind:
        "c6-source-v3-simple-failure-evidence",
      chainTip: input.chainTip,
      evaluationId:
        input.expectedFrozenInputs.evaluationId,
      executionContractSha256:
        input.expectedFrozenInputs
          .executionContractSha256,
      failureCode: input.failureCode,
      frozenInputClosureSha256:
        input.frozenInputClosure.sha256,
      runtimeAuthorizationSha256:
        input.expectedFrozenInputs
          .runtimeAuthorizationSha256,
      schemaVersion: 1,
    }),
  );
}

export async function verifyC6SourceV3SimplePublicationOutcome(
  input: {
    assetRoot: string;
    expectedFrozenInputs:
      C6SourceV3SimpleExpectedFrozenInputs;
  },
): Promise<
  | {
      chainTip: C6SourceV3SimpleArtifactReference;
      failureCode: z.infer<typeof failureCodeSchema>;
      failureEvidence:
        C6SourceV3SimpleArtifactReference;
      frozenInputClosure:
        C6SourceV3SimpleArtifactReference;
      outcome: "failed";
    }
  | {
      censusReceipt:
        C6SourceV3SimpleArtifactReference;
      frozenInputClosure:
        C6SourceV3SimpleArtifactReference;
      outcome: "complete";
      passAComplete:
        C6SourceV3SimpleArtifactReference;
      passBComplete:
        C6SourceV3SimpleArtifactReference;
      twoPassEqualityReceipt:
        C6SourceV3SimpleArtifactReference;
    }
> {
  const frozenInputClosure =
    await requiredExistingReference(
      input.assetRoot,
      "frozen-input-closure.json",
    );
  await verifyC6SourceV3SimpleFrozenInputClosureArtifact({
    assetRoot: input.assetRoot,
    expected: input.expectedFrozenInputs,
    reference: frozenInputClosure,
  });
  const failureEvidence =
    await referenceIfExists(
      input.assetRoot,
      "failure-evidence.json",
    );
  const censusReceipt =
    await referenceIfExists(
      input.assetRoot,
      "census-receipt.json",
    );
  if (
    (failureEvidence === null) ===
      (censusReceipt === null)
  ) {
    throw new Error(
      "C6 source-v3-simple publication outcome is ambiguous",
    );
  }
  if (failureEvidence !== null) {
    const evidence = await readFailureEvidence(
      input.assetRoot,
      failureEvidence,
    );
    if (
      evidence.evaluationId !==
        input.expectedFrozenInputs.evaluationId ||
      evidence.executionContractSha256 !==
        input.expectedFrozenInputs
          .executionContractSha256 ||
      evidence.frozenInputClosureSha256 !==
        frozenInputClosure.sha256 ||
      evidence.runtimeAuthorizationSha256 !==
        input.expectedFrozenInputs
          .runtimeAuthorizationSha256 ||
      [
        "asset-lock.json",
        "failure-evidence.json",
        "terminal.json",
        "writer-lock.json",
      ].includes(evidence.chainTip.path)
    ) {
      throw new Error(
        "C6 source-v3-simple failed publication context mismatch",
      );
    }
    await verifyReference(
      input.assetRoot,
      evidence.chainTip,
    );
    await verifyFailureChainTip({
      assetRoot: input.assetRoot,
      chainTip: evidence.chainTip,
      expectedFrozenInputs:
        input.expectedFrozenInputs,
      failureCode: evidence.failureCode,
      frozenInputClosure,
    });
    return {
      chainTip: evidence.chainTip,
      failureCode: evidence.failureCode,
      failureEvidence,
      frozenInputClosure,
      outcome: "failed",
    };
  }
  const passAComplete =
    await requiredExistingReference(
      input.assetRoot,
      "pass-a/pass-complete.json",
    );
  const passBComplete =
    await requiredExistingReference(
      input.assetRoot,
      "pass-b/pass-complete.json",
    );
  const twoPassEqualityReceipt =
    await requiredExistingReference(
      input.assetRoot,
      "two-pass-equality.json",
    );
  const passA = await readPassComplete(
    input.assetRoot,
    passAComplete,
    input.expectedFrozenInputs.frame,
  );
  const passB = await readPassComplete(
    input.assetRoot,
    passBComplete,
    input.expectedFrozenInputs.frame,
  );
  assertPassPair({
    evaluationId:
      input.expectedFrozenInputs.evaluationId,
    executionContractSha256:
      input.expectedFrozenInputs
        .executionContractSha256,
    frozenInputClosureSha256:
      frozenInputClosure.sha256,
    passA,
    passAComplete,
    passB,
    passBComplete,
    runtimeAuthorizationSha256:
      input.expectedFrozenInputs
        .runtimeAuthorizationSha256,
  });
  const equality = await readTwoPassEquality(
    input.assetRoot,
    twoPassEqualityReceipt,
  );
  assertEqualityReceipt({
    equality,
    evaluationId:
      input.expectedFrozenInputs.evaluationId,
    executionContractSha256:
      input.expectedFrozenInputs
        .executionContractSha256,
    frozenInputClosureSha256:
      frozenInputClosure.sha256,
    normalizedProjectionSha256:
      passA.normalizedProjectionSha256,
    passAComplete,
    passBComplete,
    runtimeAuthorizationSha256:
      input.expectedFrozenInputs
        .runtimeAuthorizationSha256,
  });
  const normalizedPass = (
    await verifyPassArtifactBundle(
      input.assetRoot,
      passA,
      input.expectedFrozenInputs.frame,
    )
  ).normalizedPass;
  const receipt = await readCensusReceipt(
    input.assetRoot,
    censusReceipt!,
  );
  assertCensusReceipt({
    expectedFrozenInputs:
      input.expectedFrozenInputs,
    frozenInputClosure,
    normalizedPass,
    passA,
    passAComplete,
    passB,
    passBComplete,
    receipt,
    twoPassEqualityReceipt,
  });
  return {
    censusReceipt: censusReceipt!,
    frozenInputClosure,
    outcome: "complete",
    passAComplete,
    passBComplete,
    twoPassEqualityReceipt,
  };
}

export async function writeC6SourceV3SimpleTerminal(
  input: {
    assetRoot: string;
    expectedFrozenInputs:
      C6SourceV3SimpleExpectedFrozenInputs;
    repositoryRoot: string;
    secret: Uint8Array;
    terminal:
      | Omit<
          z.input<typeof terminalCompleteSchema>,
          "schemaVersion"
        >
      | Omit<
          z.input<typeof terminalFailedSchema>,
          "schemaVersion"
        >;
  },
): Promise<C6SourceV3SimpleArtifactReference> {
  const terminal = terminalSchema.parse({
    ...input.terminal,
    schemaVersion: 1,
  });
  await verifyTerminalPayload({
    assetRoot: input.assetRoot,
    assertFrozenInputsCurrent: false,
    expectedFrozenInputs:
      input.expectedFrozenInputs,
    repositoryRoot: input.repositoryRoot,
    terminal,
  });
  await assertC6SourceV3SimpleTreeHasNoSecret({
    assetRoot: input.assetRoot,
    secret: input.secret,
  });
  const reference =
    await commitC6SourceV3SimpleCreateOnlyCanonicalJson(
    input.assetRoot,
    "terminal.json",
    terminal,
  );
  await verifyC6SourceV3SimpleTerminalClosure({
    assetRoot: input.assetRoot,
    expectedFrozenInputs:
      input.expectedFrozenInputs,
    repositoryRoot: input.repositoryRoot,
    secret: input.secret,
  });
  return reference;
}

export async function resumeC6SourceV3SimpleTerminalFromAssetLock(
  input: {
    assetRoot: string;
    expectedFrozenInputs:
      C6SourceV3SimpleExpectedFrozenInputs;
    repositoryRoot: string;
    secret: Uint8Array;
  },
): Promise<C6SourceV3SimpleArtifactReference> {
  const existingTerminal =
    await referenceIfExists(
      input.assetRoot,
      "terminal.json",
    );
  if (existingTerminal !== null) {
    await verifyC6SourceV3SimpleTerminalClosure(input);
    return existingTerminal;
  }
  const assetLock = await requiredExistingReference(
    input.assetRoot,
    "asset-lock.json",
  );
  const frozenInputClosure =
    await requiredExistingReference(
      input.assetRoot,
      "frozen-input-closure.json",
    );
  await verifyC6SourceV3SimpleCensusAssetLock({
    assetRoot: input.assetRoot,
    expectedFrozenInputs:
      input.expectedFrozenInputs,
    frozenInputClosureSha256:
      frozenInputClosure.sha256,
    reference: assetLock,
  });
  const outcome =
    await verifyC6SourceV3SimplePublicationOutcome({
      assetRoot: input.assetRoot,
      expectedFrozenInputs:
        input.expectedFrozenInputs,
    });
  if (outcome.outcome === "failed") {
    return await writeC6SourceV3SimpleTerminal({
      ...input,
      terminal: {
        assetLock,
        chainTip: outcome.chainTip,
        evaluationId:
          input.expectedFrozenInputs.evaluationId,
        executionContractSha256:
          input.expectedFrozenInputs
            .executionContractSha256,
        failureCode: outcome.failureCode,
        failureEvidence: outcome.failureEvidence,
        frozenInputClosure:
          outcome.frozenInputClosure,
        frozenInputClosureSha256:
          outcome.frozenInputClosure.sha256,
        outcome: "failed",
        runtimeAuthorizationSha256:
          input.expectedFrozenInputs
            .runtimeAuthorizationSha256,
        inputClosureSha256:
          input.expectedFrozenInputs
            .inputClosureSha256,
      },
    });
  }
  return await writeC6SourceV3SimpleTerminal({
    ...input,
    terminal: {
      assetLock,
      censusReceipt: outcome.censusReceipt,
      evaluationId:
        input.expectedFrozenInputs.evaluationId,
      executionContractSha256:
        input.expectedFrozenInputs
          .executionContractSha256,
      frozenInputClosure:
        outcome.frozenInputClosure,
      frozenInputClosureSha256:
        outcome.frozenInputClosure.sha256,
      outcome: "complete",
      passAComplete: outcome.passAComplete,
      passBComplete: outcome.passBComplete,
      runtimeAuthorizationSha256:
        input.expectedFrozenInputs
          .runtimeAuthorizationSha256,
      inputClosureSha256:
        input.expectedFrozenInputs
          .inputClosureSha256,
      twoPassEqualityReceipt:
        outcome.twoPassEqualityReceipt,
    },
  });
}

export async function verifyC6SourceV3SimpleTerminalFinalizationState(
  input: {
    assetRoot: string;
    expectedFrozenInputs:
      C6SourceV3SimpleExpectedFrozenInputs;
    repositoryRoot: string;
  },
): Promise<C6SourceV3SimpleArtifactReference | null> {
  const frozenInputClosure =
    await requiredExistingReference(
      input.assetRoot,
      "frozen-input-closure.json",
    );
  const assetLock = await requiredExistingReference(
    input.assetRoot,
    "asset-lock.json",
  );
  await verifyC6SourceV3SimpleCensusAssetLock({
    assetRoot: input.assetRoot,
    expectedFrozenInputs:
      input.expectedFrozenInputs,
    frozenInputClosureSha256:
      frozenInputClosure.sha256,
    reference: assetLock,
  });
  await verifyC6SourceV3SimplePublicationOutcome({
    assetRoot: input.assetRoot,
    expectedFrozenInputs:
      input.expectedFrozenInputs,
  });
  const terminal = await referenceIfExists(
    input.assetRoot,
    "terminal.json",
  );
  if (terminal !== null) {
    await verifyC6SourceV3SimpleTerminalClosure({
      ...input,
    });
  }
  return terminal;
}

export function parseC6SourceV3SimpleTerminal(
  input: string | Uint8Array,
): C6SourceV3SimpleTerminal {
  const bytes = Buffer.from(input);
  let text: string;
  try {
    text = new TextDecoder("utf-8", {
      fatal: true,
    }).decode(bytes);
  } catch {
    throw new Error(
      "C6 source-v3-simple terminal is not UTF-8",
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new Error(
      "C6 source-v3-simple terminal is not JSON",
    );
  }
  if (text !== `${JSON.stringify(raw, null, 2)}\n`) {
    throw new Error(
      "C6 source-v3-simple terminal is not canonical JSON",
    );
  }
  return terminalSchema.parse(raw);
}

export async function verifyC6SourceV3SimpleTerminalClosure(
  input: {
    assetRoot: string;
    expectedFrozenInputs:
      C6SourceV3SimpleExpectedFrozenInputs;
    repositoryRoot: string;
    secret?: Uint8Array;
  },
): Promise<C6SourceV3SimpleTerminal> {
  const bytes = await readC6StableRegularFile(
    resolve(input.assetRoot, "terminal.json"),
    "source-v3-simple terminal",
    undefined,
    true,
  );
  const terminal =
    parseC6SourceV3SimpleTerminal(bytes);
  await verifyTerminalPayload({
    assetRoot: input.assetRoot,
    assertFrozenInputsCurrent: false,
    expectedFrozenInputs:
      input.expectedFrozenInputs,
    repositoryRoot: input.repositoryRoot,
    terminal,
  });
  if (input.secret !== undefined) {
    await assertC6SourceV3SimpleTreeHasNoSecret({
      assetRoot: input.assetRoot,
      secret: input.secret,
    });
  }
  return terminal;
}

async function verifyTerminalPayload(
  input: {
    assetRoot: string;
    assertFrozenInputsCurrent: boolean;
    expectedFrozenInputs:
      C6SourceV3SimpleExpectedFrozenInputs;
    repositoryRoot: string;
    terminal: C6SourceV3SimpleTerminal;
  },
): Promise<void> {
  const terminal = input.terminal;
  if (
    terminal.evaluationId !==
      input.expectedFrozenInputs.evaluationId ||
    terminal.executionContractSha256 !==
      input.expectedFrozenInputs
        .executionContractSha256 ||
    terminal.inputClosureSha256 !==
      input.expectedFrozenInputs.inputClosureSha256 ||
    terminal.frozenInputClosureSha256 !==
      terminal.frozenInputClosure.sha256 ||
    terminal.runtimeAuthorizationSha256 !==
      input.expectedFrozenInputs
        .runtimeAuthorizationSha256 ||
    terminal.frozenInputClosure.path !==
      "frozen-input-closure.json" ||
    terminal.assetLock.path !== "asset-lock.json"
  ) {
    throw new Error(
      "C6 source-v3-simple terminal context mismatch",
    );
  }
  if (input.assertFrozenInputsCurrent) {
    await assertC6SourceV3SimpleFrozenInputsCurrent({
      expected: input.expectedFrozenInputs,
      repositoryRoot: input.repositoryRoot,
    });
  }
  await verifyC6SourceV3SimpleCensusAssetLock({
    assetRoot: input.assetRoot,
    expectedFrozenInputs:
      input.expectedFrozenInputs,
    frozenInputClosureSha256:
      terminal.frozenInputClosureSha256,
    reference: terminal.assetLock,
  });
  const outcome =
    await verifyC6SourceV3SimplePublicationOutcome({
      assetRoot: input.assetRoot,
      expectedFrozenInputs:
        input.expectedFrozenInputs,
    });
  if (
    terminal.outcome !== outcome.outcome ||
    !isReferenceEqual(
      terminal.frozenInputClosure,
      outcome.frozenInputClosure,
    ) ||
    (
      terminal.outcome === "failed" &&
      outcome.outcome === "failed" &&
      (
        terminal.failureCode !==
          outcome.failureCode ||
        !isReferenceEqual(
          terminal.failureEvidence,
          outcome.failureEvidence,
        ) ||
        !isReferenceEqual(
          terminal.chainTip,
          outcome.chainTip,
        )
      )
    ) ||
    (
      terminal.outcome === "complete" &&
      outcome.outcome === "complete" &&
      (
        !isReferenceEqual(
          terminal.censusReceipt,
          outcome.censusReceipt,
        ) ||
        !isReferenceEqual(
          terminal.passAComplete,
          outcome.passAComplete,
        ) ||
        !isReferenceEqual(
          terminal.passBComplete,
          outcome.passBComplete,
        ) ||
        !isReferenceEqual(
          terminal.twoPassEqualityReceipt,
          outcome.twoPassEqualityReceipt,
        )
      )
    )
  ) {
    throw new Error(
      "C6 source-v3-simple terminal outcome mismatch",
    );
  }
}

async function verifyFailureChainTip(input: {
  assetRoot: string;
  chainTip: C6SourceV3SimpleArtifactReference;
  expectedFrozenInputs:
    C6SourceV3SimpleExpectedFrozenInputs;
  failureCode: z.infer<typeof failureCodeSchema>;
  frozenInputClosure:
    C6SourceV3SimpleArtifactReference;
}): Promise<void> {
  await verifyC6SourceV3SimpleFrozenInputClosureArtifact({
    assetRoot: input.assetRoot,
    expected: input.expectedFrozenInputs,
    reference: input.frozenInputClosure,
  });
  const path = input.chainTip.path;
  if (input.failureCode === "input-mutation") {
    if (path !== "input-mutation-evidence.json") {
      throw new Error(
        "C6 source-v3-simple failure chain tip context mismatch",
      );
    }
    await verifyC6SourceV3SimpleFrozenInputMutationEvidence({
      assetRoot: input.assetRoot,
      expected: input.expectedFrozenInputs,
      frozenInputClosureSha256:
        input.frozenInputClosure.sha256,
      reference: input.chainTip,
    });
    return;
  }
  if (input.failureCode === "two-pass-mismatch") {
    await verifyTwoPassMismatchFailureChainTip(input);
    return;
  }
  if (
    input.failureCode ===
      "rate-limit-pause-exceeded"
  ) {
    await verifyRateLimitPauseExceededFailureChainTip(
      input,
    );
    return;
  }
  if (
    path === "input-mutation-evidence.json" ||
    (
      input.failureCode === "partial-response" &&
      !path.endsWith("/response-started.json")
    )
  ) {
    throw new Error(
      "C6 source-v3-simple failure chain tip context mismatch",
    );
  }
  if (path === "frozen-input-closure.json") {
    assertCommittedFailureChainTipCode(
      input.failureCode,
    );
    if (
      !isReferenceEqual(
        input.chainTip,
        input.frozenInputClosure,
      )
    ) {
      throw new Error(
        "C6 source-v3-simple failure chain tip context mismatch",
      );
    }
    return;
  }
  const markerPath =
    /^pass-([ab])\/logical-request-(\d{8})\/attempt-(\d{2})\/(attempt|response-started)\.json$/u
      .exec(path);
  if (markerPath !== null) {
    const marker =
      await verifyC6SourceV3SimpleFailureChainTipMarker(
      input.assetRoot,
      input.chainTip,
    );
    const pathPass = markerPath[1]!.toUpperCase();
    const pathOrdinal = Number(markerPath[2]);
    const pathAttempt = Number(markerPath[3]);
    const pathKind = markerPath[4] === "attempt"
      ? "c6-source-v3-simple-attempt"
      : "c6-source-v3-simple-response-started";
    if (
      marker.artifactKind !== pathKind ||
      marker.attemptNumber !== pathAttempt ||
      marker.evaluationId !==
        input.expectedFrozenInputs.evaluationId ||
      marker.executionContractSha256 !==
        input.expectedFrozenInputs
          .executionContractSha256 ||
      marker.frozenInputClosureSha256 !==
        input.frozenInputClosure.sha256 ||
      marker.logicalRequestOrdinal !== pathOrdinal ||
      marker.pass !== pathPass ||
      marker.runtimeAuthorizationSha256 !==
        input.expectedFrozenInputs
          .runtimeAuthorizationSha256 ||
      (
        marker.artifactKind ===
          "c6-source-v3-simple-response-started"
      ) !== (input.failureCode === "partial-response")
    ) {
      throw new Error(
        "C6 source-v3-simple failure chain tip context mismatch",
      );
    }
    if (
      marker.artifactKind ===
        "c6-source-v3-simple-attempt"
    ) {
      let expectedFailureCode:
        z.infer<typeof failureCodeSchema> =
          "response-terminal";
      if (
        marker.reason === "terminal-transport-error"
      ) {
        expectedFailureCode = "transport-terminal";
      } else if (
        marker.reason ===
          "maximum-attempts-exhausted"
      ) {
        expectedFailureCode =
          "maximum-attempts-exhausted";
      }
      if (
        marker.reason === null ||
        input.failureCode !== expectedFailureCode
      ) {
        throw new Error(
          "C6 source-v3-simple failure code or chain tip mismatch",
        );
      }
    }
    await verifyFailureLogicalRequestCompletionPrefix({
      assetRoot: input.assetRoot,
      completionCount: pathOrdinal - 1,
      evaluationId:
        input.expectedFrozenInputs.evaluationId,
      executionContractSha256:
        input.expectedFrozenInputs
          .executionContractSha256,
      expectedLastSha256:
        marker.priorLogicalRequestCompletionSha256,
      frame: input.expectedFrozenInputs.frame,
      frozenInputClosureSha256:
        input.frozenInputClosure.sha256,
      pass: marker.pass,
      runtimeAuthorizationSha256:
        input.expectedFrozenInputs
          .runtimeAuthorizationSha256,
    });
    return;
  }
  const completionPath =
    /^pass-([ab])\/logical-request-complete-(\d{8})\.json$/u
      .exec(path);
  if (completionPath !== null) {
    assertCommittedFailureChainTipCode(
      input.failureCode,
    );
    await verifyFailureLogicalRequestCompletionPrefix({
      assetRoot: input.assetRoot,
      completionCount: Number(completionPath[2]),
      evaluationId:
        input.expectedFrozenInputs.evaluationId,
      executionContractSha256:
        input.expectedFrozenInputs
          .executionContractSha256,
      expectedLastReference: input.chainTip,
      expectedLastSha256: input.chainTip.sha256,
      frame: input.expectedFrozenInputs.frame,
      frozenInputClosureSha256:
        input.frozenInputClosure.sha256,
      pass: completionPath[1]!.toUpperCase() as
        "A" | "B",
      runtimeAuthorizationSha256:
        input.expectedFrozenInputs
          .runtimeAuthorizationSha256,
    });
    return;
  }
  const passPath =
    /^pass-([ab])\/pass-complete\.json$/u.exec(path);
  if (passPath !== null) {
    assertCommittedFailureChainTipCode(
      input.failureCode,
    );
    const expectedPass =
      passPath[1]!.toUpperCase() as "A" | "B";
    if (expectedPass === "B") {
      const passAComplete =
        await requiredExistingReference(
          input.assetRoot,
          "pass-a/pass-complete.json",
        );
      const passBEnvelope =
        await readPassCompleteEnvelope(
          input.assetRoot,
          input.chainTip,
        );
      if (
        passBEnvelope.genesisSha256 !==
          passAComplete.sha256
      ) {
        throw new Error(
          "C6 source-v3-simple pass chain mismatch",
        );
      }
    }
    const expectedGenesisSha256 =
      await verifiedFailurePassGenesisSha256({
        assetRoot: input.assetRoot,
        evaluationId:
          input.expectedFrozenInputs.evaluationId,
        executionContractSha256:
          input.expectedFrozenInputs
            .executionContractSha256,
        frame: input.expectedFrozenInputs.frame,
        frozenInputClosureSha256:
          input.frozenInputClosure.sha256,
        pass: expectedPass,
        runtimeAuthorizationSha256:
          input.expectedFrozenInputs
            .runtimeAuthorizationSha256,
      });
    const pass = await readPassComplete(
      input.assetRoot,
      input.chainTip,
      input.expectedFrozenInputs.frame,
    );
    if (
      pass.evaluationId !==
        input.expectedFrozenInputs.evaluationId ||
      pass.executionContractSha256 !==
        input.expectedFrozenInputs
          .executionContractSha256 ||
      pass.frozenInputClosureSha256 !==
        input.frozenInputClosure.sha256 ||
      pass.genesisSha256 !==
        expectedGenesisSha256 ||
      pass.pass !== expectedPass ||
      pass.runtimeAuthorizationSha256 !==
        input.expectedFrozenInputs
          .runtimeAuthorizationSha256
    ) {
      throw new Error(
        "C6 source-v3-simple pass chain mismatch",
      );
    }
    return;
  }
  if (path === "two-pass-equality.json") {
    assertCommittedFailureChainTipCode(
      input.failureCode,
    );
    const equality = await readTwoPassEquality(
      input.assetRoot,
      input.chainTip,
    );
    const passA = await readPassComplete(
      input.assetRoot,
      equality.passAComplete,
      input.expectedFrozenInputs.frame,
    );
    const passB = await readPassComplete(
      input.assetRoot,
      equality.passBComplete,
      input.expectedFrozenInputs.frame,
    );
    assertPassPair({
      evaluationId:
        input.expectedFrozenInputs.evaluationId,
      executionContractSha256:
        input.expectedFrozenInputs
          .executionContractSha256,
      frozenInputClosureSha256:
        input.frozenInputClosure.sha256,
      passA,
      passAComplete: equality.passAComplete,
      passB,
      passBComplete: equality.passBComplete,
      runtimeAuthorizationSha256:
        input.expectedFrozenInputs
          .runtimeAuthorizationSha256,
    });
    assertEqualityReceipt({
      equality,
      evaluationId:
        input.expectedFrozenInputs.evaluationId,
      executionContractSha256:
        input.expectedFrozenInputs
          .executionContractSha256,
      frozenInputClosureSha256:
        input.frozenInputClosure.sha256,
      normalizedProjectionSha256:
        passA.normalizedProjectionSha256,
      passAComplete: equality.passAComplete,
      passBComplete: equality.passBComplete,
      runtimeAuthorizationSha256:
        input.expectedFrozenInputs
          .runtimeAuthorizationSha256,
    });
    return;
  }
  throw new Error(
    "C6 source-v3-simple failure chain tip path mismatch",
  );
}

function assertCommittedFailureChainTipCode(
  failureCode: z.infer<typeof failureCodeSchema>,
): void {
  if (
    failureCode === "input-mutation" ||
    failureCode === "maximum-attempts-exhausted" ||
    failureCode === "partial-response" ||
    failureCode === "rate-limit-pause-exceeded" ||
    failureCode === "response-terminal" ||
    failureCode === "transport-terminal" ||
    failureCode === "two-pass-mismatch"
  ) {
    throw new Error(
      "C6 source-v3-simple failure code or chain tip mismatch",
    );
  }
}

async function verifyRateLimitPauseExceededFailureChainTip(
  input: {
    assetRoot: string;
    chainTip: C6SourceV3SimpleArtifactReference;
    expectedFrozenInputs:
      C6SourceV3SimpleExpectedFrozenInputs;
    frozenInputClosure:
      C6SourceV3SimpleArtifactReference;
  },
): Promise<void> {
  const match =
    /^pass-([ab])\/logical-request-complete-(\d{8})\.json$/u
      .exec(input.chainTip.path);
  if (match === null) {
    throw new Error(
      "C6 source-v3-simple failure code or chain tip mismatch",
    );
  }
  const pass =
    match[1]!.toUpperCase() as "A" | "B";
  const completionCount = Number(match[2]);
  await verifyFailureLogicalRequestCompletionPrefix({
    allowLastProactivePauseOverflow: true,
    assetRoot: input.assetRoot,
    completionCount,
    evaluationId:
      input.expectedFrozenInputs.evaluationId,
    executionContractSha256:
      input.expectedFrozenInputs
        .executionContractSha256,
    expectedLastReference: input.chainTip,
    expectedLastSha256: input.chainTip.sha256,
    frame: input.expectedFrozenInputs.frame,
    frozenInputClosureSha256:
      input.frozenInputClosure.sha256,
    pass,
    runtimeAuthorizationSha256:
      input.expectedFrozenInputs
        .runtimeAuthorizationSha256,
  });
  const evidence =
    await readC6SourceV3SimpleLogicalRequestEvidence(
      input.assetRoot,
      input.chainTip,
    );
  const pause =
    deriveC6SourceV3SimpleProactivePause({
      receivedAtMilliseconds:
        Date.parse(evidence.pacing.receivedAt),
      remaining: evidence.pacing.remaining,
      resetUnixSeconds:
        evidence.pacing.resetUnixSeconds,
      responseDate: evidence.pacing.responseDate,
    });
  if (pause.exceedsMaximum) {
    return;
  }
  throw new Error(
    "C6 source-v3-simple failure code or chain tip mismatch",
  );
}

async function verifyTwoPassMismatchFailureChainTip(
  input: {
    assetRoot: string;
    chainTip: C6SourceV3SimpleArtifactReference;
    expectedFrozenInputs:
      C6SourceV3SimpleExpectedFrozenInputs;
    frozenInputClosure:
      C6SourceV3SimpleArtifactReference;
  },
): Promise<void> {
  if (
    input.chainTip.path !==
      "pass-b/pass-complete.json"
  ) {
    throw new Error(
      "C6 source-v3-simple failure code or chain tip mismatch",
    );
  }
  const passAComplete =
    await requiredExistingReference(
      input.assetRoot,
      "pass-a/pass-complete.json",
    );
  const passBComplete =
    await requiredExistingReference(
      input.assetRoot,
      "pass-b/pass-complete.json",
    );
  if (
    !isReferenceEqual(
      input.chainTip,
      passBComplete,
    )
  ) {
    throw new Error(
      "C6 source-v3-simple failure code or chain tip mismatch",
    );
  }
  const passAEnvelope =
    await readPassCompleteEnvelope(
      input.assetRoot,
      passAComplete,
    );
  const passBEnvelope =
    await readPassCompleteEnvelope(
      input.assetRoot,
      passBComplete,
    );
  assertPassPairContext({
    evaluationId:
      input.expectedFrozenInputs.evaluationId,
    executionContractSha256:
      input.expectedFrozenInputs
        .executionContractSha256,
    frozenInputClosureSha256:
      input.frozenInputClosure.sha256,
    passA: passAEnvelope,
    passAComplete,
    passB: passBEnvelope,
    runtimeAuthorizationSha256:
      input.expectedFrozenInputs
        .runtimeAuthorizationSha256,
  });
  const passA = await readPassComplete(
    input.assetRoot,
    passAComplete,
    input.expectedFrozenInputs.frame,
  );
  const passB = await readPassComplete(
    input.assetRoot,
    passBComplete,
    input.expectedFrozenInputs.frame,
  );
  assertPassPairContext({
    evaluationId:
      input.expectedFrozenInputs.evaluationId,
    executionContractSha256:
      input.expectedFrozenInputs
        .executionContractSha256,
    frozenInputClosureSha256:
      input.frozenInputClosure.sha256,
    passA,
    passAComplete,
    passB,
    runtimeAuthorizationSha256:
      input.expectedFrozenInputs
        .runtimeAuthorizationSha256,
  });
  assertC6SourceV3SimpleVerifiedPassProjectionMismatch({
    passANormalizedProjectionSha256:
      passA.normalizedProjectionSha256,
    passBNormalizedProjectionSha256:
      passB.normalizedProjectionSha256,
  });
}

async function verifyFailureLogicalRequestCompletionPrefix(
  input: {
    allowLastProactivePauseOverflow?: boolean;
    assetRoot: string;
    completionCount: number;
    evaluationId: string;
    executionContractSha256: string;
    expectedLastReference?:
      C6SourceV3SimpleArtifactReference;
    expectedLastSha256: string;
    frame: C6SourceV3SimpleFrameDefinition;
    frozenInputClosureSha256: string;
    pass: "A" | "B";
    runtimeAuthorizationSha256: string;
  },
): Promise<void> {
  try {
    if (
      !Number.isInteger(input.completionCount) ||
      input.completionCount < 0
    ) {
      throw new Error("invalid completion count");
    }
    const genesisSha256 =
      await verifiedFailurePassGenesisSha256(input);
    const completions: Array<{
      artifact: C6SourceV3SimpleArtifactReference;
      logicalRequestOrdinal: number;
    }> = [];
    for (
      let ordinal = 1;
      ordinal <= input.completionCount;
      ordinal += 1
    ) {
      completions.push({
        artifact: await requiredExistingReference(
          input.assetRoot,
          `pass-${input.pass.toLowerCase()}/` +
            `logical-request-complete-${
              String(ordinal).padStart(8, "0")
            }.json`,
        ),
        logicalRequestOrdinal: ordinal,
      });
    }
    await verifyLogicalRequestCompletionChain({
      allowLastProactivePauseOverflow:
        input.allowLastProactivePauseOverflow,
      assetRoot: input.assetRoot,
      completions,
      evaluationId: input.evaluationId,
      executionContractSha256:
        input.executionContractSha256,
      frozenInputClosureSha256:
        input.frozenInputClosureSha256,
      genesisSha256,
      pass: input.pass,
      runtimeAuthorizationSha256:
        input.runtimeAuthorizationSha256,
    });
    const lastReference =
      completions.at(-1)?.artifact ?? null;
    const lastSha256 =
      lastReference?.sha256 ?? genesisSha256;
    if (
      lastSha256 !== input.expectedLastSha256 ||
      (
        input.expectedLastReference !== undefined &&
        (
          lastReference === null ||
          !isReferenceEqual(
            lastReference,
            input.expectedLastReference,
          )
        )
      )
    ) {
      throw new Error("last completion mismatch");
    }
  } catch (error) {
    throw new Error(
      "C6 source-v3-simple logical request completion prefix mismatch",
      { cause: error },
    );
  }
}

async function verifiedFailurePassGenesisSha256(
  input: {
    assetRoot: string;
    evaluationId: string;
    executionContractSha256: string;
    frame: C6SourceV3SimpleFrameDefinition;
    frozenInputClosureSha256: string;
    pass: "A" | "B";
    runtimeAuthorizationSha256: string;
  },
): Promise<string> {
  if (input.pass === "A") {
    return ZERO_SHA256;
  }
  const passAComplete =
    await requiredExistingReference(
      input.assetRoot,
      "pass-a/pass-complete.json",
    );
  const passA = await readPassComplete(
    input.assetRoot,
    passAComplete,
    input.frame,
  );
  if (
    passA.evaluationId !== input.evaluationId ||
    passA.executionContractSha256 !==
      input.executionContractSha256 ||
    passA.frozenInputClosureSha256 !==
      input.frozenInputClosureSha256 ||
    passA.genesisSha256 !== ZERO_SHA256 ||
    passA.pass !== "A" ||
    passA.runtimeAuthorizationSha256 !==
      input.runtimeAuthorizationSha256
  ) {
    throw new Error(
      "C6 source-v3-simple pass chain mismatch",
    );
  }
  return passAComplete.sha256;
}

async function readPassCompleteEnvelope(
  root: string,
  reference: C6SourceV3SimpleArtifactReference,
): Promise<z.infer<typeof passCompleteSchema>> {
  const bytes = await readAndVerifyReference(
    root,
    reference,
  );
  const text = new TextDecoder("utf-8", {
    fatal: true,
  }).decode(bytes);
  const raw = JSON.parse(text) as unknown;
  if (text !== `${JSON.stringify(raw, null, 2)}\n`) {
    throw new Error(
      "C6 source-v3-simple pass completion is not canonical JSON",
    );
  }
  const pass = passCompleteSchema.parse(raw);
  const passDirectory = `pass-${
    pass.pass.toLowerCase()
  }`;
  if (
    reference.path !==
      `${passDirectory}/pass-complete.json`
  ) {
    throw new Error(
      "C6 source-v3-simple pass completion path mismatch",
    );
  }
  return pass;
}

async function readPassComplete(
  root: string,
  reference: C6SourceV3SimpleArtifactReference,
  frame: C6SourceV3SimpleFrameDefinition,
): Promise<z.infer<typeof passCompleteSchema>> {
  const pass = await readPassCompleteEnvelope(
    root,
    reference,
  );
  for (const reference of [
    pass.countTreeClosure,
    pass.repositoryClosure,
    pass.pullRequestClosure,
  ]) {
    await verifyReference(root, reference);
  }
  for (
    const [index, completion] of
      pass.logicalRequestCompletionArtifacts.entries()
  ) {
    if (completion.logicalRequestOrdinal !== index + 1) {
      throw new Error(
        "C6 source-v3-simple logical request completion order mismatch",
      );
    }
    await verifyReference(root, completion.artifact);
  }
  const projectedRequests =
    await verifyLogicalRequestCompletionChain({
    assetRoot: root,
    completions:
      pass.logicalRequestCompletionArtifacts,
    evaluationId: pass.evaluationId,
    executionContractSha256:
      pass.executionContractSha256,
    frozenInputClosureSha256:
      pass.frozenInputClosureSha256,
    genesisSha256: pass.genesisSha256,
    pass: pass.pass,
    runtimeAuthorizationSha256:
      pass.runtimeAuthorizationSha256,
  });
  const artifactBundle =
    await verifyPassArtifactBundle(root, pass, frame);
  await assertC6SourceV3SimplePassCausalReplay({
    artifactPass: artifactBundle.normalizedPass,
    frame,
    projectedRequests,
  });
  const ledgerRoot =
    hashC6SourceV3SimpleAttemptLedgerRoot(
      pass.logicalRequestCompletionArtifacts.map(
        (completion) => ({
          logicalRequestOrdinal:
            completion.logicalRequestOrdinal,
          sha256: completion.artifact.sha256,
        }),
      ),
    );
  if (
    pass.logicalRequestCount !==
      pass.logicalRequestCompletionArtifacts.length ||
    pass.lastLogicalRequestCompletionSha256 !==
      pass.logicalRequestCompletionArtifacts.at(-1)!
        .artifact.sha256 ||
    pass.attemptLedgerRootSha256 !== ledgerRoot
  ) {
    throw new Error(
      "C6 source-v3-simple pass completion closure mismatch",
    );
  }
  return pass;
}

async function readTwoPassEquality(
  root: string,
  reference: C6SourceV3SimpleArtifactReference,
): Promise<z.infer<typeof twoPassEqualitySchema>> {
  const bytes = await readAndVerifyReference(
    root,
    reference,
  );
  const text = new TextDecoder("utf-8", {
    fatal: true,
  }).decode(bytes);
  const raw = JSON.parse(text) as unknown;
  if (text !== `${JSON.stringify(raw, null, 2)}\n`) {
    throw new Error(
      "C6 source-v3-simple equality receipt is not canonical JSON",
    );
  }
  const equality = twoPassEqualitySchema.parse(raw);
  if (reference.path !== "two-pass-equality.json") {
    throw new Error(
      "C6 source-v3-simple equality receipt path mismatch",
    );
  }
  return equality;
}

async function readCensusReceipt(
  root: string,
  reference: C6SourceV3SimpleArtifactReference,
): Promise<z.infer<typeof censusReceiptSchema>> {
  const bytes = await readAndVerifyReference(
    root,
    reference,
  );
  const text = new TextDecoder("utf-8", {
    fatal: true,
  }).decode(bytes);
  const raw = JSON.parse(text) as unknown;
  if (text !== `${JSON.stringify(raw, null, 2)}\n`) {
    throw new Error(
      "C6 source-v3-simple census receipt is not canonical JSON",
    );
  }
  if (reference.path !== "census-receipt.json") {
    throw new Error(
      "C6 source-v3-simple census receipt path mismatch",
    );
  }
  return censusReceiptSchema.parse(raw);
}

async function readFailureEvidence(
  root: string,
  reference: C6SourceV3SimpleArtifactReference,
): Promise<z.infer<typeof failureEvidenceSchema>> {
  const bytes = await readAndVerifyReference(
    root,
    reference,
  );
  const text = new TextDecoder("utf-8", {
    fatal: true,
  }).decode(bytes);
  const raw = JSON.parse(text) as unknown;
  if (
    reference.path !== "failure-evidence.json" ||
    text !== `${JSON.stringify(raw, null, 2)}\n`
  ) {
    throw new Error(
      "C6 source-v3-simple failure evidence mismatch",
    );
  }
  return failureEvidenceSchema.parse(raw);
}

function assertPassPair(input: {
  evaluationId: string;
  executionContractSha256: string;
  frozenInputClosureSha256: string;
  passA: z.infer<typeof passCompleteSchema>;
  passAComplete: C6SourceV3SimpleArtifactReference;
  passB: z.infer<typeof passCompleteSchema>;
  passBComplete: C6SourceV3SimpleArtifactReference;
  runtimeAuthorizationSha256: string;
}): void {
  assertPassPairContext(input);
  assertC6SourceV3SimpleVerifiedPassProjectionEquality({
    passANormalizedProjectionSha256:
      input.passA.normalizedProjectionSha256,
    passBComplete: input.passBComplete,
    passBNormalizedProjectionSha256:
      input.passB.normalizedProjectionSha256,
  });
}

function assertPassPairContext(input: {
  evaluationId: string;
  executionContractSha256: string;
  frozenInputClosureSha256: string;
  passA: z.infer<typeof passCompleteSchema>;
  passAComplete: C6SourceV3SimpleArtifactReference;
  passB: z.infer<typeof passCompleteSchema>;
  runtimeAuthorizationSha256: string;
}): void {
  if (
    input.passA.pass !== "A" ||
    input.passA.genesisSha256 !== ZERO_SHA256 ||
    input.passB.pass !== "B" ||
    input.passB.genesisSha256 !==
      input.passAComplete.sha256 ||
    input.passA.evaluationId !== input.evaluationId ||
    input.passB.evaluationId !== input.evaluationId ||
    input.passA.executionContractSha256 !==
      input.executionContractSha256 ||
    input.passB.executionContractSha256 !==
      input.executionContractSha256 ||
    input.passA.frozenInputClosureSha256 !==
      input.frozenInputClosureSha256 ||
    input.passB.frozenInputClosureSha256 !==
      input.frozenInputClosureSha256 ||
    input.passA.runtimeAuthorizationSha256 !==
      input.runtimeAuthorizationSha256 ||
    input.passB.runtimeAuthorizationSha256 !==
      input.runtimeAuthorizationSha256
  ) {
    throw new Error(
      "C6 source-v3-simple pass chain mismatch",
    );
  }
}

export function assertC6SourceV3SimpleVerifiedPassProjectionEquality(
  input: {
    passANormalizedProjectionSha256: string;
    passBComplete:
      C6SourceV3SimpleArtifactReference;
    passBNormalizedProjectionSha256: string;
  },
): void {
  if (
    input.passANormalizedProjectionSha256 !==
    input.passBNormalizedProjectionSha256
  ) {
    throw new C6SourceV3SimpleTwoPassMismatchError(
      input.passBComplete,
    );
  }
}

export function assertC6SourceV3SimpleVerifiedPassProjectionMismatch(
  input: {
    passANormalizedProjectionSha256: string;
    passBNormalizedProjectionSha256: string;
  },
): void {
  if (
    input.passANormalizedProjectionSha256 ===
      input.passBNormalizedProjectionSha256
  ) {
    throw new Error(
      "C6 source-v3-simple pass projection equality cannot prove mismatch",
    );
  }
}

function assertEqualityReceipt(input: {
  equality: z.infer<typeof twoPassEqualitySchema>;
  evaluationId: string;
  executionContractSha256: string;
  frozenInputClosureSha256: string;
  normalizedProjectionSha256: string;
  passAComplete: C6SourceV3SimpleArtifactReference;
  passBComplete: C6SourceV3SimpleArtifactReference;
  runtimeAuthorizationSha256: string;
}): void {
  if (
    !isReferenceEqual(
      input.equality.passAComplete,
      input.passAComplete,
    ) ||
    !isReferenceEqual(
      input.equality.passBComplete,
      input.passBComplete,
    ) ||
    input.equality.evaluationId !==
      input.evaluationId ||
    input.equality.executionContractSha256 !==
      input.executionContractSha256 ||
    input.equality.frozenInputClosureSha256 !==
      input.frozenInputClosureSha256 ||
    input.equality.normalizedProjectionSha256 !==
      input.normalizedProjectionSha256 ||
    input.equality.runtimeAuthorizationSha256 !==
      input.runtimeAuthorizationSha256
  ) {
    throw new Error(
      "C6 source-v3-simple equality receipt mismatch",
    );
  }
}

function assertCensusReceipt(input: {
  expectedFrozenInputs:
    C6SourceV3SimpleExpectedFrozenInputs;
  frozenInputClosure:
    C6SourceV3SimpleArtifactReference;
  normalizedPass: C6SourceV3SimpleNormalizedPass;
  passA: z.infer<typeof passCompleteSchema>;
  passAComplete: C6SourceV3SimpleArtifactReference;
  passB: z.infer<typeof passCompleteSchema>;
  passBComplete: C6SourceV3SimpleArtifactReference;
  receipt: z.infer<typeof censusReceiptSchema>;
  twoPassEqualityReceipt:
    C6SourceV3SimpleArtifactReference;
}): void {
  const expected = {
    acceptedCandidateCount:
      input.normalizedPass.metadataDecisions.filter(
        (decision) => decision.accepted,
      ).length,
    acceptedRepositoryCount:
      input.normalizedPass.repositoryDecisions.filter(
        (decision) => decision.accepted,
      ).length,
    evaluationId:
      input.expectedFrozenInputs.evaluationId,
    executionContractSha256:
      input.expectedFrozenInputs
        .executionContractSha256,
    frozenInputClosureSha256:
      input.frozenInputClosure.sha256,
    normalizedProjectionSha256:
      input.passA.normalizedProjectionSha256,
    passALogicalRequestCount:
      input.passA.logicalRequestCount,
    passBLogicalRequestCount:
      input.passB.logicalRequestCount,
    pullRequestCount:
      input.normalizedPass.pullRequests.length,
    repositoryCount:
      input.normalizedPass.repositories.length,
    runtimeAuthorizationSha256:
      input.expectedFrozenInputs
        .runtimeAuthorizationSha256,
    inputClosureSha256:
      input.expectedFrozenInputs.inputClosureSha256,
  };
  if (
    Object.entries(expected).some(
      ([key, value]) =>
        input.receipt[
          key as keyof typeof expected
        ] !== value,
    ) ||
    !isReferenceEqual(
      input.receipt.frozenInputClosure,
      input.frozenInputClosure,
    ) ||
    !isReferenceEqual(
      input.receipt.passAComplete,
      input.passAComplete,
    ) ||
    !isReferenceEqual(
      input.receipt.passBComplete,
      input.passBComplete,
    ) ||
    !isReferenceEqual(
      input.receipt.twoPassEqualityReceipt,
      input.twoPassEqualityReceipt,
    )
  ) {
    throw new Error(
      "C6 source-v3-simple census receipt mismatch",
    );
  }
}

async function verifyPassArtifactBundle(
  root: string,
  pass: z.infer<typeof passCompleteSchema>,
  frame: C6SourceV3SimpleFrameDefinition,
): Promise<{
  normalizedPass: C6SourceV3SimpleNormalizedPass;
  normalizedProjectionSha256: string;
}> {
  const bundle: C6SourceV3SimplePassArtifactBundle = {
    countTreeClosure: pass.countTreeClosure,
    normalizedProjection:
      pass.normalizedProjection,
    normalizedProjectionSha256:
      pass.normalizedProjectionSha256,
    pullRequestClosure: pass.pullRequestClosure,
    repositoryClosure: pass.repositoryClosure,
  };
  return await verifyC6SourceV3SimplePassArtifactBundle({
    assetRoot: root,
    bundle,
    evaluationId: pass.evaluationId,
    executionContractSha256:
      pass.executionContractSha256,
    frame,
    frozenInputClosureSha256:
      pass.frozenInputClosureSha256,
    pass: pass.pass,
    runtimeAuthorizationSha256:
      pass.runtimeAuthorizationSha256,
  });
}

function isReferenceEqual(
  left: C6SourceV3SimpleArtifactReference,
  right: C6SourceV3SimpleArtifactReference,
): boolean {
  return left.bytes === right.bytes &&
    left.path === right.path &&
    left.sha256 === right.sha256;
}

async function verifyLogicalRequestCompletionChain(
  input: {
    allowLastProactivePauseOverflow?: boolean;
    assetRoot: string;
    completions: readonly {
      artifact: C6SourceV3SimpleArtifactReference;
      logicalRequestOrdinal: number;
    }[];
    evaluationId: string;
    executionContractSha256: string;
    frozenInputClosureSha256: string;
    genesisSha256: string;
    pass: "A" | "B";
    runtimeAuthorizationSha256: string;
  },
): Promise<C6SourceV3SimpleProjectedLogicalRequest[]> {
  let prior = input.genesisSha256;
  const projectedRequests:
    C6SourceV3SimpleProjectedLogicalRequest[] = [];
  for (
    const [index, completion] of
      input.completions.entries()
  ) {
    const evidence =
      await readC6SourceV3SimpleLogicalRequestEvidence(
        input.assetRoot,
        completion.artifact,
      );
    const value = evidence.completion;
    const ordinal = String(index + 1).padStart(
      8,
      "0",
    );
    const logicalRequestDirectory =
      `pass-${input.pass.toLowerCase()}/` +
      `logical-request-${ordinal}`;
    if (
      completion.logicalRequestOrdinal !== index + 1 ||
      completion.artifact.path !==
        `pass-${input.pass.toLowerCase()}/` +
          `logical-request-complete-${ordinal}.json` ||
      value.logicalRequestOrdinal !== index + 1 ||
      value.evaluationId !== input.evaluationId ||
      value.executionContractSha256 !==
        input.executionContractSha256 ||
      value.frozenInputClosureSha256 !==
        input.frozenInputClosureSha256 ||
      value.pass !== input.pass ||
      value.priorLogicalRequestCompletionSha256 !==
        prior ||
      value.runtimeAuthorizationSha256 !==
        input.runtimeAuthorizationSha256 ||
      value.projectedResult.path !==
        `pass-${input.pass.toLowerCase()}/` +
          `logical-request-result-${ordinal}.json` ||
      value.attempts.some(
        (attempt, attemptIndex) =>
          attempt.artifact.path !==
            `${logicalRequestDirectory}/attempt-${
              String(attemptIndex + 1).padStart(
                2,
                "0",
              )
            }/attempt.json`,
      )
    ) {
      throw new Error(
        "C6 source-v3-simple logical request completion chain mismatch",
      );
    }
    const proactivePause =
      deriveC6SourceV3SimpleProactivePause({
        receivedAtMilliseconds:
          Date.parse(evidence.pacing.receivedAt),
        remaining: evidence.pacing.remaining,
        resetUnixSeconds:
          evidence.pacing.resetUnixSeconds,
        responseDate: evidence.pacing.responseDate,
      });
    if (
      proactivePause.exceedsMaximum &&
      !(
        input.allowLastProactivePauseOverflow ===
          true &&
        index === input.completions.length - 1
      )
    ) {
      throw new Error(
        "C6 source-v3-simple logical request completion continued after terminal proactive pause",
      );
    }
    prior = completion.artifact.sha256;
    projectedRequests.push(
      evidence.projectedRequest,
    );
  }
  return projectedRequests;
}

async function assertC6SourceV3SimplePassCausalReplay(
  input: {
    artifactPass: C6SourceV3SimpleNormalizedPass;
    frame: C6SourceV3SimpleFrameDefinition;
    projectedRequests:
      readonly C6SourceV3SimpleProjectedLogicalRequest[];
  },
): Promise<void> {
  const replayed =
    await replayC6SourceV3SimpleNormalizedPass({
      frame: input.frame,
      requests: input.projectedRequests,
    });
  if (!isDeepStrictEqual(replayed, input.artifactPass)) {
    throw new Error(
      "C6 source-v3-simple projected request replay does not match pass artifacts",
    );
  }
}

async function verifyReference(
  root: string,
  reference: C6SourceV3SimpleArtifactReference,
): Promise<void> {
  await readAndVerifyReference(root, reference);
}

async function readAndVerifyReference(
  root: string,
  reference: C6SourceV3SimpleArtifactReference,
): Promise<Buffer> {
  artifactReferenceSchema.parse(reference);
  const rootPath = resolve(root);
  const path = resolve(rootPath, reference.path);
  const relativePath = relative(rootPath, path);
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    relativePath.length === 0
  ) {
    throw new Error(
      "C6 source-v3-simple artifact escapes its root",
    );
  }
  const bytes = await readC6StableRegularFile(
    path,
    "source-v3-simple publication artifact",
    undefined,
    true,
  );
  if (
    bytes.length !== reference.bytes ||
    sha256(bytes) !== reference.sha256
  ) {
    throw new Error(
      "C6 source-v3-simple publication artifact mismatch",
    );
  }
  return bytes;
}

async function requiredExistingReference(
  root: string,
  path: string,
): Promise<C6SourceV3SimpleArtifactReference> {
  const reference = await referenceIfExists(
    root,
    path,
  );
  if (reference === null) {
    throw new Error(
      `C6 source-v3-simple required artifact is missing: ${path}`,
    );
  }
  return reference;
}

async function referenceIfExists(
  root: string,
  path: string,
): Promise<C6SourceV3SimpleArtifactReference | null> {
  try {
    const bytes = await readC6StableRegularFile(
      resolve(root, path),
      `source-v3-simple publication ${path}`,
      undefined,
      true,
    );
    return {
      bytes: bytes.length,
      path,
      sha256: sha256(bytes),
    };
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

function rebaseReference(
  assetRoot: string,
  localRoot: string,
  reference: C6SourceV3SimpleArtifactReference,
): C6SourceV3SimpleArtifactReference {
  const path = relative(
    resolve(assetRoot),
    resolve(localRoot, reference.path),
  );
  if (
    path === ".." ||
    path.startsWith(`..${sep}`) ||
    path.length === 0
  ) {
    throw new Error(
      "C6 source-v3-simple pass root escapes asset root",
    );
  }
  return {
    ...reference,
    path,
  };
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
