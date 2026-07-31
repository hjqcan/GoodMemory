import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import {
  lstat,
  readdir,
  rmdir,
} from "node:fs/promises";
import {
  dirname,
  join,
  relative,
} from "node:path";
import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import {
  assertC6NoSymlinkPathComponents,
  buildC6AssetLock,
  readC6StableRegularFile,
} from "./c6-asset-lock";
import {
  computeC6SourceV3SimpleLogicalRequestIdentitySha256,
  inspectC6SourceV3SimpleAttempt,
  readC6SourceV3SimpleLogicalRequestEvidence,
  replayC6SourceV3SimpleCommittedAttempt,
  verifyC6SourceV3SimpleProjectedResultForAttempt,
} from "./c6-source-v3-simple-census-ledger";
import type {
  C6SourceV3SimpleArtifactReference,
  C6SourceV3SimpleAttemptContext,
} from "./c6-source-v3-simple-census-ledger";
import type {
  C6SourceV3SimpleProjectedLogicalRequest,
} from "./c6-source-v3-simple-census-replay";
import {
  verifyC6SourceV3SimpleDurableGraphqlRequest,
} from "./c6-source-v3-simple-census-transport";
import type {
  C6SourceV3SimpleDurableGraphqlRequest,
} from "./c6-source-v3-simple-census-transport";

const ZERO_SHA256 = "0".repeat(64);
const sha256Schema = z.string().regex(
  /^[a-f0-9]{64}$/u,
);
const artifactReferenceSchema = z.object({
  bytes: z.number().int().nonnegative(),
  path: z.string().min(1),
  sha256: sha256Schema,
}).strict();
const requestCommittedSchema = z.object({
  artifactKind: z.literal(
    "c6-source-v3-simple-request-committed",
  ),
  attemptNumber: z.number().int().min(1).max(4),
  evaluationId: z.string().min(1),
  executionContractSha256: sha256Schema,
  frozenInputClosureSha256: sha256Schema,
  logicalRequestIdentitySha256: sha256Schema,
  logicalRequestOrdinal: z.number().int().positive(),
  pass: z.literal("A"),
  priorAttemptCommitSha256:
    sha256Schema.nullable(),
  priorLogicalRequestCompletionSha256: sha256Schema,
  request: artifactReferenceSchema,
  requestBody: artifactReferenceSchema,
  runtimeAuthorizationSha256: sha256Schema,
  schemaVersion: z.literal(1),
}).strict();
const attemptSchema = z.object({
  artifactKind: z.literal(
    "c6-source-v3-simple-attempt",
  ),
  attemptNumber: z.number().int().min(1).max(4),
  evaluationId: z.string().min(1),
  executionContractSha256: sha256Schema,
  frozenInputClosureSha256: sha256Schema,
  logicalRequestIdentitySha256: sha256Schema,
  logicalRequestOrdinal: z.number().int().positive(),
  outcome: z.enum([
    "retry",
    "stop-success",
    "stop-terminal",
  ]),
  pass: z.literal("A"),
  priorAttemptCommitSha256:
    sha256Schema.nullable(),
  requestCommitted: artifactReferenceSchema,
  responseComplete:
    artifactReferenceSchema.nullable(),
  responseStarted:
    artifactReferenceSchema.nullable(),
  retryDecision: artifactReferenceSchema,
  runtimeAuthorizationSha256: sha256Schema,
  schemaVersion: z.literal(1),
  transportError:
    artifactReferenceSchema.nullable(),
}).strict();
const logicalRequestCompleteSchema = z.object({
  artifactKind: z.literal(
    "c6-source-v3-simple-logical-request-complete",
  ),
  attempts: z.array(z.object({
    artifact: artifactReferenceSchema,
    attemptNumber:
      z.number().int().min(1).max(4),
  }).strict()).min(1).max(4),
  evaluationId: z.string().min(1),
  executionContractSha256: sha256Schema,
  frozenInputClosureSha256: sha256Schema,
  logicalRequestIdentitySha256: sha256Schema,
  logicalRequestOrdinal:
    z.number().int().positive(),
  operationName: z.enum([
    "C6SourceV3SimplePullRequestPage",
    "C6SourceV3SimpleRepositoryCount",
    "C6SourceV3SimpleRepositoryPage",
  ]),
  pass: z.literal("A"),
  priorLogicalRequestCompletionSha256:
    sha256Schema,
  projectedResult: artifactReferenceSchema,
  runtimeAuthorizationSha256: sha256Schema,
  schemaVersion: z.literal(1),
  successfulAttemptSha256: sha256Schema,
}).strict();

export interface C6SourceV4BoundedV3CommittedRequest {
  attemptNumber: number;
  logicalRequestOrdinal: number;
  request: C6SourceV3SimpleDurableGraphqlRequest;
  requestBodySha256: string;
  requestCommittedSha256: string;
  requestSha256: string;
}

export interface C6SourceV4BoundedFailureChainTip {
  bytes: number;
  path: string;
  sha256: string;
  state:
    | "attempt-retry"
    | "attempt-stop-success"
    | "attempt-stop-terminal"
    | "precommit-request"
    | "precommit-request-body"
    | "projected-result"
    | "request-committed"
    | "response-complete"
    | "response-started"
    | "retry-decision"
    | "transport-error";
}

export interface C6SourceV4BoundedFailureLedgerClosure {
  committedRequestAttemptCount: number;
  committedRequestClosureSha256: string;
  completedLogicalRequestCount: number;
  finalLogicalRequestCompletion:
    C6SourceV3SimpleArtifactReference | null;
  inProgressChainTip:
    C6SourceV4BoundedFailureChainTip | null;
  inProgressLogicalRequestOrdinal:
    number | null;
  logicalRequestDirectoryCount: number;
  passAssetRootSha256: string | null;
  passStructureSha256: string | null;
}

export async function scanC6SourceV4BoundedV3CommittedRequests(
  input: {
    evaluationId: string;
    executionContractSha256: string;
    frozenInputClosureSha256: string;
    passRoot: string;
    requireCompletePass?: boolean;
    requireFailureClosure?: boolean;
    runtimeAuthorizationSha256: string;
  },
): Promise<{
  completedLogicalRequestCount: number;
  committedRequestClosureSha256: string;
  entries: C6SourceV4BoundedV3CommittedRequest[];
  finalLogicalRequestCompletionSha256: string;
  inProgressChainTip:
    C6SourceV4BoundedFailureChainTip | null;
  inProgressLogicalRequestOrdinal:
    number | null;
  logicalRequestDirectoryCount: number;
  projectedRequests:
    C6SourceV3SimpleProjectedLogicalRequest[];
  requests: C6SourceV3SimpleDurableGraphqlRequest[];
  structureSha256: string;
}> {
  const passRoot =
    await assertC6NoSymlinkPathComponents(
      input.passRoot,
      "C6 source-v4 bounded v3 pass root",
    );
  if (!(await lstat(passRoot)).isDirectory()) {
    throw new Error(
      "C6 source-v4 bounded v3 pass root must be a directory",
    );
  }
  if (
    input.requireCompletePass === true &&
    input.requireFailureClosure === true
  ) {
    throw new Error(
      "C6 source-v4 bounded v3 scan mode is ambiguous",
    );
  }
  const initialStructureSha256 =
    await hashPassStructure(passRoot);
  const passEntries = await readdir(passRoot, {
    withFileTypes: true,
  });
  const passEntryNames = new Set(
    passEntries.map((entry) => entry.name),
  );
  if (
    input.requireCompletePass === true ||
    input.requireFailureClosure === true
  ) {
    for (const entry of passEntries) {
      const validDirectory =
        entry.isDirectory() &&
        /^logical-request-\d{8}$/u.test(
          entry.name,
        );
      const validFile =
        entry.isFile() &&
        /^logical-request-(complete|result)-\d{8}\.json$/u
          .test(entry.name);
      if (
        entry.isSymbolicLink() ||
        (!validDirectory && !validFile)
      ) {
        throw new Error(
          input.requireCompletePass === true
            ? "C6 source-v4 bounded success durable ledger exact pass-root entry set mismatch"
            : "C6 source-v4 bounded failure durable ledger exact pass-root entry set mismatch",
        );
      }
    }
  }
  const logicalDirectories =
    passEntries.filter((entry) => {
    if (entry.isSymbolicLink()) {
      throw new Error(
        "C6 source-v4 bounded v3 pass root rejects symlink",
      );
    }
    if (
      entry.isDirectory() &&
      !/^logical-request-\d{8}$/u.test(entry.name)
    ) {
      throw new Error(
        "C6 source-v4 bounded unexpected pass directory",
      );
    }
    return entry.isDirectory() &&
      /^logical-request-\d{8}$/u.test(entry.name);
  }).sort((left, right) =>
    Buffer.compare(
      Buffer.from(left.name),
      Buffer.from(right.name),
    )
  );
  const entries:
    C6SourceV4BoundedV3CommittedRequest[] = [];
  const projectedRequests:
    C6SourceV3SimpleProjectedLogicalRequest[] =
      [];
  const revalidation: Array<{
    bytes: number;
    path: string;
    sha256: string;
  }> = [];
  let priorLogicalRequestCompletionSha256 =
    ZERO_SHA256;
  let inProgressChainTip:
    C6SourceV4BoundedFailureChainTip | null =
      null;
  let inProgressSuccessfulAttempt:
    C6SourceV3SimpleArtifactReference | null =
      null;
  for (const [index, logicalDirectory] of
    logicalDirectories.entries()) {
    if (
      !logicalDirectory.isDirectory() ||
      logicalDirectory.isSymbolicLink()
    ) {
      throw new Error(
        "C6 source-v4 bounded logical request must be a directory",
      );
    }
    const ordinal = index + 1;
    if (
      logicalDirectory.name !==
        `logical-request-${
          String(ordinal).padStart(8, "0")
        }`
    ) {
      throw new Error(
        "C6 source-v4 bounded logical request ordinals are not contiguous",
      );
    }
    const logicalRoot = join(
      passRoot,
      logicalDirectory.name,
    );
    const attemptDirectories = (
      await readdir(logicalRoot, {
        withFileTypes: true,
      })
    ).filter((entry) => {
      if (
        entry.isSymbolicLink() ||
        !entry.isDirectory()
      ) {
        throw new Error(
          "C6 source-v4 bounded logical request contains non-attempt entry",
        );
      }
      if (!/^attempt-\d{2}$/u.test(entry.name)) {
        throw new Error(
          "C6 source-v4 bounded unexpected attempt directory",
        );
      }
      return true;
    }).sort((left, right) =>
      Buffer.compare(
        Buffer.from(left.name),
        Buffer.from(right.name),
      )
    );
    if (attemptDirectories.length === 0) {
      throw new Error(
        "C6 source-v4 bounded logical request has no attempt",
      );
    }
    let logicalRequestIdentitySha256:
      string | undefined;
    let logicalOperationName:
      C6SourceV3SimpleDurableGraphqlRequest[
        "persistedRequest"
      ]["operationName"] | undefined;
    let priorAttemptCommitSha256:
      string | null = null;
    let finalAttemptContext:
      C6SourceV3SimpleAttemptContext | null =
      null;
    let precommitChainTip:
      C6SourceV4BoundedFailureChainTip | null =
      null;
    const attemptMarkers: Array<{
      artifact: {
        bytes: number;
        path: string;
        sha256: string;
      };
      attemptNumber: number;
      outcome: z.infer<
        typeof attemptSchema
      >["outcome"];
    }> = [];
    for (const [attemptIndex, attemptDirectory] of
      attemptDirectories.entries()) {
      if (
        !attemptDirectory.isDirectory() ||
        attemptDirectory.isSymbolicLink()
      ) {
        throw new Error(
          "C6 source-v4 bounded attempt must be a directory",
        );
      }
      const attemptNumber = attemptIndex + 1;
      if (
        attemptDirectory.name !==
          `attempt-${
            String(attemptNumber).padStart(2, "0")
          }`
      ) {
        throw new Error(
          "C6 source-v4 bounded attempt ordinals are not contiguous",
        );
      }
      const attemptRoot = join(
        logicalRoot,
        attemptDirectory.name,
      );
      const attemptEntries = await readdir(
        attemptRoot,
        { withFileTypes: true },
      );
      const names = attemptEntries.map(
        (entry) => entry.name,
      );
      const allowedNames = new Set([
        "attempt.json",
        "request-body.raw",
        "request-committed.json",
        "request.json",
        "response-body.raw",
        "response-complete.json",
        "response-started.json",
        "retry-decision.json",
        "transport-error.json",
      ]);
      for (const entry of attemptEntries) {
        if (
          entry.isSymbolicLink() ||
          !entry.isFile() ||
          entry.name.endsWith(".pending") ||
          entry.name.endsWith(".ready")
        ) {
          throw new Error(
            "C6 source-v4 bounded v3 request contains non-regular or staged artifact",
          );
        }
        if (!allowedNames.has(entry.name)) {
          throw new Error(
            "C6 source-v4 bounded v3 request contains unknown artifact",
          );
        }
      }
      if (!names.includes("request-committed.json")) {
        if (names.some((name) =>
          name === "response-started.json" ||
          name === "response-complete.json" ||
          name === "attempt.json"
        )) {
          throw new Error(
            "C6 source-v4 bounded response evidence without request-committed",
          );
        }
        const completionSuffix =
          String(ordinal).padStart(8, "0");
        if (
          input.requireFailureClosure !== true ||
          index !==
            logicalDirectories.length - 1 ||
          attemptIndex !==
            attemptDirectories.length - 1 ||
          passEntryNames.has(
            `logical-request-complete-${completionSuffix}.json`,
          ) ||
          passEntryNames.has(
            `logical-request-result-${completionSuffix}.json`,
          )
        ) {
          throw new Error(
            "C6 source-v4 bounded attempt is not request-committed",
          );
        }
        const staged =
          await readPrecommitFailureChainTip({
            assetRoot: dirname(passRoot),
            attemptRoot,
            names,
          });
        precommitChainTip = staged.chainTip;
        revalidation.push(
          ...staged.revalidation,
        );
        continue;
      }
      const committedPath = join(
        attemptRoot,
        "request-committed.json",
      );
      const committedBytes =
        await readCanonicalJson(committedPath);
      const committed =
        requestCommittedSchema.parse(
          committedBytes.value,
        );
      if (
        committed.evaluationId !==
          input.evaluationId ||
        committed.executionContractSha256 !==
          input.executionContractSha256 ||
        committed.frozenInputClosureSha256 !==
          input.frozenInputClosureSha256 ||
        committed.runtimeAuthorizationSha256 !==
          input.runtimeAuthorizationSha256 ||
        committed.logicalRequestOrdinal !== ordinal ||
        committed.attemptNumber !== attemptNumber ||
        committed.priorAttemptCommitSha256 !==
          priorAttemptCommitSha256 ||
        (
          logicalRequestIdentitySha256 !== undefined &&
          committed.logicalRequestIdentitySha256 !==
            logicalRequestIdentitySha256
        ) ||
        committed.priorLogicalRequestCompletionSha256 !==
          priorLogicalRequestCompletionSha256
      ) {
        throw new Error(
          committed.priorLogicalRequestCompletionSha256 !==
              priorLogicalRequestCompletionSha256
            ? "C6 source-v4 bounded logical request completion chain mismatch"
            : committed.priorAttemptCommitSha256 !==
                priorAttemptCommitSha256 ||
                (
                  logicalRequestIdentitySha256 !==
                    undefined &&
                  committed.logicalRequestIdentitySha256 !==
                    logicalRequestIdentitySha256
                )
              ? "C6 source-v4 bounded attempt chain mismatch"
            : "C6 source-v4 bounded request-committed context mismatch",
        );
      }
      const requestBytes = await readReference(
        attemptRoot,
        committed.request,
        "request.json",
      );
      const requestBody = await readReference(
        attemptRoot,
        committed.requestBody,
        "request-body.raw",
      );
      const request =
        verifyC6SourceV3SimpleDurableGraphqlRequest({
          body: requestBody,
          persistedRequest:
            parseCanonicalJson(requestBytes),
        });
      const identity =
        computeC6SourceV3SimpleLogicalRequestIdentitySha256({
          evaluationId: input.evaluationId,
          executionContractSha256:
            input.executionContractSha256,
          frozenInputClosureSha256:
            input.frozenInputClosureSha256,
          logicalRequestOrdinal: ordinal,
          pass: "A",
          request,
          runtimeAuthorizationSha256:
            input.runtimeAuthorizationSha256,
        });
      if (
        committed.logicalRequestIdentitySha256 !==
          identity
      ) {
        throw new Error(
          "C6 source-v4 bounded logical request identity mismatch",
        );
      }
      logicalRequestIdentitySha256 ??=
        committed.logicalRequestIdentitySha256;
      logicalOperationName ??=
        request.persistedRequest.operationName;
      finalAttemptContext = {
        attemptNumber,
        attemptRoot,
        evaluationId: committed.evaluationId,
        executionContractSha256:
          committed.executionContractSha256,
        frozenInputClosureSha256:
          committed.frozenInputClosureSha256,
        logicalRequestIdentitySha256:
          committed.logicalRequestIdentitySha256,
        logicalRequestOrdinal:
          committed.logicalRequestOrdinal,
        pass: committed.pass,
        priorAttemptCommitSha256:
          committed.priorAttemptCommitSha256,
        priorLogicalRequestCompletionSha256:
          committed
            .priorLogicalRequestCompletionSha256,
        runtimeAuthorizationSha256:
          committed.runtimeAuthorizationSha256,
      };
      entries.push({
        attemptNumber,
        logicalRequestOrdinal: ordinal,
        request,
        requestBodySha256:
          committed.requestBody.sha256,
        requestCommittedSha256:
          sha256(committedBytes.bytes),
        requestSha256: committed.request.sha256,
      });
      revalidation.push(
        reference(
          committedPath,
          committedBytes.bytes,
        ),
        {
          ...committed.request,
          path: join(
            attemptRoot,
            committed.request.path,
          ),
        },
        {
          ...committed.requestBody,
          path: join(
            attemptRoot,
            committed.requestBody.path,
          ),
        },
      );
      if (names.includes("attempt.json")) {
        const attemptPath = join(
          attemptRoot,
          "attempt.json",
        );
        const attemptBytes =
          await readCanonicalJson(attemptPath);
        const attempt = attemptSchema.parse(
          attemptBytes.value,
        );
        if (
          attempt.attemptNumber !== attemptNumber ||
          attempt.evaluationId !== input.evaluationId ||
          attempt.executionContractSha256 !==
            input.executionContractSha256 ||
          attempt.frozenInputClosureSha256 !==
            input.frozenInputClosureSha256 ||
          attempt.logicalRequestIdentitySha256 !==
            committed.logicalRequestIdentitySha256 ||
          attempt.logicalRequestOrdinal !== ordinal ||
          attempt.priorAttemptCommitSha256 !==
            priorAttemptCommitSha256 ||
          attempt.requestCommitted.path !==
            "request-committed.json" ||
          attempt.requestCommitted.bytes !==
            committedBytes.bytes.length ||
          attempt.requestCommitted.sha256 !==
            sha256(committedBytes.bytes) ||
          attempt.runtimeAuthorizationSha256 !==
            input.runtimeAuthorizationSha256 ||
          (
            attemptIndex <
              attemptDirectories.length - 1 &&
            attempt.outcome !== "retry"
          )
        ) {
          throw new Error(
            "C6 source-v4 bounded attempt marker chain mismatch",
          );
        }
        priorAttemptCommitSha256 =
          sha256(attemptBytes.bytes);
        const attemptArtifact = {
          ...reference(
            attemptPath,
            attemptBytes.bytes,
          ),
          path: relative(
            dirname(passRoot),
            attemptPath,
          ).split("\\").join("/"),
        };
        await replayC6SourceV3SimpleCommittedAttempt(
          dirname(passRoot),
          attemptArtifact,
        );
        attemptMarkers.push({
          artifact: attemptArtifact,
          attemptNumber,
          outcome: attempt.outcome,
        });
        revalidation.push(
          reference(attemptPath, attemptBytes.bytes),
        );
      } else if (
        attemptIndex < attemptDirectories.length - 1
      ) {
        throw new Error(
          "C6 source-v4 bounded prior attempt marker is missing",
        );
      }
    }
    const completionName =
      `logical-request-complete-${
        String(ordinal).padStart(8, "0")
      }.json`;
    if (!passEntryNames.has(completionName)) {
      if (
        input.requireCompletePass === true ||
        ordinal < logicalDirectories.length
      ) {
        throw new Error(
          input.requireCompletePass === true
            ? "C6 source-v4 bounded complete durable ledger has an unfinished logical request"
            : "C6 source-v4 bounded prior logical request completion is missing",
        );
      }
      if (
        input.requireFailureClosure === true
      ) {
        if (precommitChainTip !== null) {
          inProgressChainTip =
            precommitChainTip;
        } else if (finalAttemptContext === null) {
          throw new Error(
            "C6 source-v4 bounded failure durable ledger has no chain tip context",
          );
        } else {
          inProgressChainTip =
            await readFailureChainTip(
              dirname(passRoot),
              finalAttemptContext,
            );
          const finalAttempt =
            attemptMarkers.at(-1);
          if (
            inProgressChainTip.state ===
              "attempt-stop-success" &&
            finalAttempt?.outcome ===
              "stop-success"
          ) {
            inProgressSuccessfulAttempt =
              finalAttempt.artifact;
          }
        }
      }
      continue;
    }
    const completionPath = join(
      passRoot,
      completionName,
    );
    const completionBytes =
      await readCanonicalJson(completionPath);
    const parsedCompletion =
      logicalRequestCompleteSchema.safeParse(
        completionBytes.value,
      );
    if (!parsedCompletion.success) {
      throw new Error(
        "C6 source-v4 bounded logical request completion is invalid",
        {
          cause: parsedCompletion.error,
        },
      );
    }
    const completion = parsedCompletion.data;
    const projectedResultPath = relative(
      dirname(passRoot),
      join(
        passRoot,
        `logical-request-result-${
          String(ordinal).padStart(8, "0")
        }.json`,
      ),
    ).split("\\").join("/");
    const attemptsMatch =
      completion.attempts.length ===
        attemptMarkers.length &&
      completion.attempts.every(
        (attempt, attemptIndex) => {
          const marker =
            attemptMarkers[attemptIndex];
          return marker !== undefined &&
            attempt.attemptNumber ===
              marker.attemptNumber &&
            attempt.artifact.bytes ===
              marker.artifact.bytes &&
            attempt.artifact.path ===
              marker.artifact.path &&
            attempt.artifact.sha256 ===
              marker.artifact.sha256;
        },
      );
    const successfulAttempt =
      attemptMarkers.at(-1);
    if (
      completion.evaluationId !==
        input.evaluationId ||
      completion.executionContractSha256 !==
        input.executionContractSha256 ||
      completion.frozenInputClosureSha256 !==
        input.frozenInputClosureSha256 ||
      completion.logicalRequestIdentitySha256 !==
        logicalRequestIdentitySha256 ||
      completion.logicalRequestOrdinal !== ordinal ||
      completion.operationName !==
        logicalOperationName ||
      completion.priorLogicalRequestCompletionSha256 !==
        priorLogicalRequestCompletionSha256 ||
      completion.projectedResult.path !==
        projectedResultPath ||
      completion.runtimeAuthorizationSha256 !==
        input.runtimeAuthorizationSha256 ||
      !attemptsMatch ||
      successfulAttempt?.outcome !==
        "stop-success" ||
      completion.successfulAttemptSha256 !==
        successfulAttempt.artifact.sha256
    ) {
      throw new Error(
        "C6 source-v4 bounded logical request completion chain mismatch",
      );
    }
    try {
      const evidence =
        await readC6SourceV3SimpleLogicalRequestEvidence(
          dirname(passRoot),
          {
            bytes:
              completionBytes.bytes.length,
            path: relative(
              dirname(passRoot),
              completionPath,
            ).split("\\").join("/"),
            sha256: sha256(
              completionBytes.bytes,
            ),
          },
        );
      projectedRequests.push(
        evidence.projectedRequest,
      );
    } catch (cause) {
      throw new Error(
        "C6 source-v4 bounded logical request completion evidence is invalid",
        { cause },
      );
    }
    priorLogicalRequestCompletionSha256 =
      sha256(completionBytes.bytes);
    revalidation.push(
      reference(
        completionPath,
        completionBytes.bytes,
      ),
    );
  }
  if (input.requireCompletePass === true) {
    const expectedPassEntries =
      new Set<string>();
    for (
      let ordinal = 1;
      ordinal <= logicalDirectories.length;
      ordinal += 1
    ) {
      const suffix =
        String(ordinal).padStart(8, "0");
      expectedPassEntries.add(
        `logical-request-${suffix}`,
      );
      expectedPassEntries.add(
        `logical-request-complete-${suffix}.json`,
      );
      expectedPassEntries.add(
        `logical-request-result-${suffix}.json`,
      );
    }
    if (
      expectedPassEntries.size !==
        passEntryNames.size ||
      [...expectedPassEntries].some(
        (name) => !passEntryNames.has(name),
      ) ||
      projectedRequests.length !==
        logicalDirectories.length
    ) {
      throw new Error(
        "C6 source-v4 bounded success durable ledger exact pass-root entry set mismatch",
      );
    }
  }
  if (input.requireFailureClosure === true) {
    const expectedPassEntries =
      new Set<string>();
    for (
      let ordinal = 1;
      ordinal <= projectedRequests.length;
      ordinal += 1
    ) {
      const suffix =
        String(ordinal).padStart(8, "0");
      expectedPassEntries.add(
        `logical-request-${suffix}`,
      );
      expectedPassEntries.add(
        `logical-request-complete-${suffix}.json`,
      );
      expectedPassEntries.add(
        `logical-request-result-${suffix}.json`,
      );
    }
    if (
      logicalDirectories.length >
        projectedRequests.length
    ) {
      const suffix = String(
        logicalDirectories.length,
      ).padStart(8, "0");
      expectedPassEntries.add(
        `logical-request-${suffix}`,
      );
      const resultName =
        `logical-request-result-${suffix}.json`;
      if (passEntryNames.has(resultName)) {
        if (
          inProgressChainTip?.state !==
            "attempt-stop-success"
        ) {
          throw new Error(
            "C6 source-v4 bounded incomplete result requires stop-success",
          );
        }
        if (
          inProgressSuccessfulAttempt ===
            null
        ) {
          throw new Error(
            "C6 source-v4 bounded incomplete result has no successful attempt",
          );
        }
        const resultPath = join(
          passRoot,
          resultName,
        );
        const resultBytes =
          await readC6StableRegularFile(
            resultPath,
            "source-v4 bounded incomplete projected result",
            undefined,
            true,
          );
        const projectedResult = {
          ...reference(
            resultPath,
            resultBytes,
          ),
          path: relative(
            dirname(passRoot),
            resultPath,
          ).split("\\").join("/"),
        };
        await verifyC6SourceV3SimpleProjectedResultForAttempt({
          assetRoot: dirname(passRoot),
          attempt:
            inProgressSuccessfulAttempt,
          projectedResult,
        });
        inProgressChainTip = {
          ...projectedResult,
          state: "projected-result",
        };
        revalidation.push(
          reference(
            resultPath,
            resultBytes,
          ),
        );
        expectedPassEntries.add(resultName);
      }
    }
    if (
      logicalDirectories.length <
        projectedRequests.length ||
      logicalDirectories.length >
        projectedRequests.length + 1 ||
      expectedPassEntries.size !==
        passEntryNames.size ||
      [...expectedPassEntries].some(
        (name) => !passEntryNames.has(name),
      ) ||
      (
        inProgressChainTip === null
      ) !==
        (
          logicalDirectories.length ===
            projectedRequests.length
        )
    ) {
      throw new Error(
        "C6 source-v4 bounded failure durable ledger exact pass-root entry set mismatch",
      );
    }
  }
  for (const expected of revalidation) {
    const bytes = await readC6StableRegularFile(
      expected.path,
      "source-v4 bounded v3 request revalidation",
      undefined,
      true,
    );
    if (
      bytes.length !== expected.bytes ||
      sha256(bytes) !== expected.sha256
    ) {
      throw new Error(
        "C6 source-v4 bounded v3 request closure changed during scan",
      );
    }
  }
  const terminalStructureSha256 =
    await hashPassStructure(passRoot);
  if (
    terminalStructureSha256 !==
      initialStructureSha256
  ) {
    throw new Error(
      "C6 source-v4 bounded v3 pass structure changed during scan",
    );
  }
  return {
    completedLogicalRequestCount:
      projectedRequests.length,
    committedRequestClosureSha256:
      hashCommittedRequestClosure(entries),
    entries,
    finalLogicalRequestCompletionSha256:
      priorLogicalRequestCompletionSha256,
    inProgressChainTip,
    inProgressLogicalRequestOrdinal:
      logicalDirectories.length >
        projectedRequests.length
        ? logicalDirectories.length
        : null,
    logicalRequestDirectoryCount:
      logicalDirectories.length,
    projectedRequests,
    requests: entries.map((entry) => entry.request),
    structureSha256: terminalStructureSha256,
  };
}

export async function buildC6SourceV4BoundedFailureLedgerClosure(
  input: {
    evaluationId: string;
    executionContractSha256: string;
    frozenInputClosureSha256: string;
    passRoot: string;
    runtimeAuthorizationSha256: string;
  },
): Promise<C6SourceV4BoundedFailureLedgerClosure> {
  try {
    await lstat(input.passRoot);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return {
        committedRequestAttemptCount: 0,
        committedRequestClosureSha256:
          hashCommittedRequestClosure([]),
        completedLogicalRequestCount: 0,
        finalLogicalRequestCompletion: null,
        inProgressChainTip: null,
        inProgressLogicalRequestOrdinal:
          null,
        logicalRequestDirectoryCount: 0,
        passAssetRootSha256: null,
        passStructureSha256: null,
      };
    }
    throw error;
  }
  const initialPassAssetLock =
    await buildC6AssetLock(input.passRoot);
  const scan =
    await scanC6SourceV4BoundedV3CommittedRequests({
      ...input,
      requireFailureClosure: true,
    });
  const passAssetLock =
    await buildC6AssetLock(input.passRoot);
  if (
    !isDeepStrictEqual(
      passAssetLock,
      initialPassAssetLock,
    ) ||
    await hashPassStructure(
      input.passRoot,
    ) !== scan.structureSha256
  ) {
    throw new Error(
      "C6 source-v4 bounded failure durable ledger changed during closure build",
    );
  }
  let finalLogicalRequestCompletion:
    C6SourceV3SimpleArtifactReference | null =
      null;
  if (scan.completedLogicalRequestCount > 0) {
    const path = join(
      input.passRoot,
      `logical-request-complete-${
        String(
          scan.completedLogicalRequestCount,
        ).padStart(8, "0")
      }.json`,
    );
    const bytes =
      await readC6StableRegularFile(
        path,
        "source-v4 bounded failure final logical request completion",
        4 * 1_024 * 1_024,
        true,
      );
    finalLogicalRequestCompletion = {
      ...reference(path, bytes),
      path: relative(
        dirname(input.passRoot),
        path,
      ).split("\\").join("/"),
    };
    if (
      finalLogicalRequestCompletion.sha256 !==
        scan
          .finalLogicalRequestCompletionSha256
    ) {
      throw new Error(
        "C6 source-v4 bounded failure final logical request completion mismatch",
      );
    }
  }
  return {
    committedRequestAttemptCount:
      scan.entries.length,
    committedRequestClosureSha256:
      scan.committedRequestClosureSha256,
    completedLogicalRequestCount:
      scan.completedLogicalRequestCount,
    finalLogicalRequestCompletion,
    inProgressChainTip:
      scan.inProgressChainTip,
    inProgressLogicalRequestOrdinal:
      scan.inProgressLogicalRequestOrdinal,
    logicalRequestDirectoryCount:
      scan.logicalRequestDirectoryCount,
    passAssetRootSha256:
      passAssetLock.assetRootSha256,
    passStructureSha256:
      scan.structureSha256,
  };
}

export async function removeC6SourceV4BoundedEmptyPrecommitTailDirectories(
  passRoot: string,
): Promise<void> {
  let passEntries: Dirent[];
  try {
    await assertC6NoSymlinkPathComponents(
      passRoot,
      "C6 source-v4 bounded empty precommit pass root",
    );
    const stats = await lstat(passRoot);
    if (!stats.isDirectory()) {
      throw new Error(
        "C6 source-v4 bounded empty precommit pass root must be a directory",
      );
    }
    passEntries = await readdir(passRoot, {
      withFileTypes: true,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return;
    }
    throw error;
  }
  const logicalDirectories =
    passEntries.filter((entry) =>
      entry.isDirectory() &&
      !entry.isSymbolicLink() &&
      /^logical-request-\d{8}$/u.test(
        entry.name,
      )
    ).sort((left, right) =>
      Buffer.compare(
        Buffer.from(left.name),
        Buffer.from(right.name),
      )
    );
  const logicalDirectory =
    logicalDirectories.at(-1);
  if (logicalDirectory !== undefined) {
    const logicalRoot = join(
      passRoot,
      logicalDirectory.name,
    );
    const logicalEntries = await readdir(
      logicalRoot,
      { withFileTypes: true },
    );
    const attemptDirectories =
      logicalEntries.filter((entry) =>
        entry.isDirectory() &&
        !entry.isSymbolicLink() &&
        /^attempt-\d{2}$/u.test(entry.name)
      ).sort((left, right) =>
        Buffer.compare(
          Buffer.from(left.name),
          Buffer.from(right.name),
        )
      );
    const attemptDirectory =
      attemptDirectories.at(-1);
    if (attemptDirectory !== undefined) {
      const attemptRoot = join(
        logicalRoot,
        attemptDirectory.name,
      );
      if (
        (await readdir(attemptRoot)).length === 0
      ) {
        await rmdir(attemptRoot);
      }
    }
    if (
      (await readdir(logicalRoot)).length === 0
    ) {
      await rmdir(logicalRoot);
    }
  }
  if ((await readdir(passRoot)).length === 0) {
    await rmdir(passRoot);
  }
}

async function readPrecommitFailureChainTip(
  input: {
    assetRoot: string;
    attemptRoot: string;
    names: readonly string[];
  },
): Promise<{
  chainTip:
    C6SourceV4BoundedFailureChainTip;
  revalidation: Array<{
    bytes: number;
    path: string;
    sha256: string;
  }>;
}> {
  const hasBody =
    input.names.includes("request-body.raw");
  const hasRequest =
    input.names.includes("request.json");
  if (
    !hasBody ||
    input.names.length !==
      (hasRequest ? 2 : 1)
  ) {
    throw new Error(
      "C6 source-v4 bounded precommit tail artifact order mismatch",
    );
  }
  const paths = [
    join(input.attemptRoot, "request-body.raw"),
    ...(hasRequest
      ? [join(input.attemptRoot, "request.json")]
      : []),
  ];
  const revalidation = [];
  for (const path of paths) {
    const bytes = await readC6StableRegularFile(
      path,
      "source-v4 bounded precommit tail",
      4 * 1_024 * 1_024,
      true,
    );
    revalidation.push(reference(path, bytes));
  }
  const tip = revalidation.at(-1)!;
  return {
    chainTip: {
      ...tip,
      path: relative(
        input.assetRoot,
        tip.path,
      ).split("\\").join("/"),
      state: hasRequest
        ? "precommit-request"
        : "precommit-request-body",
    },
    revalidation,
  };
}

async function readFailureChainTip(
  assetRoot: string,
  context: C6SourceV3SimpleAttemptContext,
): Promise<C6SourceV4BoundedFailureChainTip> {
  const state =
    await inspectC6SourceV3SimpleAttempt(
      context,
    );
  let reference:
    C6SourceV3SimpleArtifactReference;
  let stateName:
    C6SourceV4BoundedFailureChainTip[
      "state"
    ];
  switch (state.kind) {
    case "interrupted-before-response":
      reference = state.requestCommitted;
      stateName = "request-committed";
      break;
    case "terminal-partial-response":
      reference = state.responseStarted;
      stateName = "response-started";
      break;
    case "classify-local-response":
      reference = state.responseComplete;
      stateName = "response-complete";
      break;
    case "classify-local-transport-error":
      reference = state.transportError;
      stateName = "transport-error";
      break;
    case "finalize-attempt":
      reference = state.retryDecision;
      stateName = "retry-decision";
      break;
    case "committed":
      reference = state.attempt;
      stateName = `attempt-${state.outcome}`;
      break;
    case "not-started":
      throw new Error(
        "C6 source-v4 bounded failure durable ledger chain tip is not started",
      );
  }
  return {
    ...reference,
    path: relative(
      assetRoot,
      join(
        context.attemptRoot,
        reference.path,
      ),
    ).split("\\").join("/"),
    state: stateName,
  };
}

function hashCommittedRequestClosure(
  entries:
    readonly C6SourceV4BoundedV3CommittedRequest[],
): string {
  return sha256(Buffer.from(entries.map((entry) => [
    entry.logicalRequestOrdinal,
    entry.attemptNumber,
    entry.requestCommittedSha256,
    entry.requestSha256,
    entry.requestBodySha256,
  ].join("\u0000")).join("\n")));
}

async function hashPassStructure(
  passRoot: string,
): Promise<string> {
  const lines: string[] = [];
  const walk = async (root: string): Promise<void> => {
    const entries = await readdir(root, {
      withFileTypes: true,
    });
    entries.sort((left, right) =>
      Buffer.compare(
        Buffer.from(left.name),
        Buffer.from(right.name),
      )
    );
    for (const entry of entries) {
      const path = join(root, entry.name);
      const relativePath = relative(
        passRoot,
        path,
      ).split("\\").join("/");
      if (entry.isSymbolicLink()) {
        throw new Error(
          "C6 source-v4 bounded v3 pass structure rejects symlink",
        );
      }
      if (entry.isDirectory()) {
        lines.push(`d\u0000${relativePath}\n`);
        await walk(path);
      } else if (entry.isFile()) {
        lines.push(`f\u0000${relativePath}\n`);
      } else {
        throw new Error(
          "C6 source-v4 bounded v3 pass structure rejects non-file",
        );
      }
    }
  };
  await walk(passRoot);
  return sha256(Buffer.from(lines.join("")));
}

async function readCanonicalJson(path: string): Promise<{
  bytes: Buffer;
  value: unknown;
}> {
  const bytes = await readC6StableRegularFile(
    path,
    "source-v4 bounded v3 canonical JSON",
    undefined,
    true,
  );
  return {
    bytes,
    value: parseCanonicalJson(bytes),
  };
}

function parseCanonicalJson(bytes: Uint8Array): unknown {
  const text = new TextDecoder("utf-8", {
    fatal: true,
  }).decode(bytes);
  const value = JSON.parse(text) as unknown;
  if (text !== `${JSON.stringify(value, null, 2)}\n`) {
    throw new Error(
      "C6 source-v4 bounded v3 artifact is not canonical JSON",
    );
  }
  return value;
}

async function readReference(
  root: string,
  input: z.infer<typeof artifactReferenceSchema>,
  expectedPath: string,
): Promise<Buffer> {
  const value = artifactReferenceSchema.parse(input);
  if (value.path !== expectedPath) {
    throw new Error(
      "C6 source-v4 bounded v3 artifact path mismatch",
    );
  }
  const bytes = await readC6StableRegularFile(
    join(root, value.path),
    "source-v4 bounded v3 request artifact",
    undefined,
    true,
  );
  if (
    bytes.length !== value.bytes ||
    sha256(bytes) !== value.sha256
  ) {
    throw new Error(
      "C6 source-v4 bounded v3 artifact reference mismatch",
    );
  }
  return bytes;
}

function reference(
  path: string,
  bytes: Uint8Array,
) {
  return {
    bytes: bytes.length,
    path,
    sha256: sha256(bytes),
  };
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
