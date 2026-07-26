import {
  mkdir,
  readFile,
  readdir,
} from "node:fs/promises";
import { join } from "node:path";

import {
  writeC6SourceV3SimplePassArtifactBundle,
} from "./c6-source-v3-simple-census-artifacts";
import type {
  C6SourceV3SimpleFrameDefinition,
} from "./c6-source-v3-simple-census-core";
import {
  executeC6SourceV3SimpleLogicalRequest,
} from "./c6-source-v3-simple-census-executor";
import type {
  C6SourceV3SimpleFetch,
} from "./c6-source-v3-simple-census-executor";
import type {
  C6SourceV3SimpleArtifactReference,
} from "./c6-source-v3-simple-census-ledger";
import {
  readC6SourceV3SimpleLogicalRequestEvidence,
  recoverC6SourceV3SimplePendingArtifactTree,
} from "./c6-source-v3-simple-census-ledger";
import {
  readVerifiedC6SourceV3SimplePassCompleteIfExists,
  writeC6SourceV3SimplePassComplete,
} from "./c6-source-v3-simple-census-publication";
import {
  collectC6SourceV3SimpleNormalizedPass,
} from "./c6-source-v3-simple-census-replay";
import {
  computeC6SourceV3SimpleProactiveNotBefore,
} from "./c6-source-v3-simple-census-transport";

export async function runC6SourceV3SimpleCensusPass(
  input: {
    assetRoot: string;
    authorizationTokenProvider:
      () => Promise<Uint8Array>;
    evaluationId: string;
    executionContractSha256: string;
    frozenInputClosureSha256: string;
    fetchImpl?: C6SourceV3SimpleFetch;
    frame: C6SourceV3SimpleFrameDefinition;
    genesisSha256: string;
    initialNotBefore?: number | null;
    now?: () => number;
    onLogicalRequestComplete?: (
      reference: C6SourceV3SimpleArtifactReference,
    ) => void;
    pass: "A" | "B";
    requestTimeoutMilliseconds?: number;
    runtimeAuthorizationSha256: string;
    waitUntil?: (notBefore: number) => Promise<void>;
  },
): Promise<{
  nextRequestNotBefore: number | null;
  passComplete: C6SourceV3SimpleArtifactReference;
}> {
  const passRoot = join(
    input.assetRoot,
    `pass-${input.pass.toLowerCase()}`,
  );
  const now = input.now ?? Date.now;
  const waitUntil = input.waitUntil ??
    waitUntilWallClock;
  await recoverC6SourceV3SimplePendingArtifactTree(
    input.assetRoot,
  );
  await mkdir(passRoot, {
    mode: 0o700,
    recursive: true,
  });
  const existingPass =
    await readVerifiedC6SourceV3SimplePassCompleteIfExists({
      assetRoot: input.assetRoot,
      evaluationId: input.evaluationId,
      executionContractSha256:
        input.executionContractSha256,
      frozenInputClosureSha256:
        input.frozenInputClosureSha256,
      frame: input.frame,
      genesisSha256: input.genesisSha256,
      pass: input.pass,
      runtimeAuthorizationSha256:
        input.runtimeAuthorizationSha256,
    });
  if (existingPass !== null) {
    input.onLogicalRequestComplete?.(
      existingPass.lastLogicalRequestCompletion,
    );
    await verifyC6SourceV3SimplePassFilesystemClosure({
      completionCount:
        existingPass.logicalRequestCount,
      passRoot,
    });
    const evidence =
      await readC6SourceV3SimpleLogicalRequestEvidence(
        input.assetRoot,
        existingPass.lastLogicalRequestCompletion,
      );
    return {
      nextRequestNotBefore:
        proactiveNotBefore(evidence.pacing),
      passComplete: existingPass.passComplete,
    };
  }
  const activePass =
    await verifyC6SourceV3SimpleActivePassFilesystemClosure({
      passRoot,
    });
  let localOnly = activePass.mustCompleteLocally;
  const logicalRequestCompletions: Array<{
    artifact: C6SourceV3SimpleArtifactReference;
    logicalRequestOrdinal: number;
  }> = [];
  let logicalRequestOrdinal = 1;
  let priorLogicalRequestCompletionSha256 =
    input.genesisSha256;
  let nextRequestNotBefore =
    input.initialNotBefore ?? null;
  const normalizedPass =
    await collectC6SourceV3SimpleNormalizedPass({
      executeRequest: async (request) => {
        if (
          nextRequestNotBefore !== null &&
          now() < nextRequestNotBefore
        ) {
          await waitUntil(nextRequestNotBefore);
        }
        const result =
          await executeC6SourceV3SimpleLogicalRequest({
            assetRoot: input.assetRoot,
            authorizationTokenProvider:
              input.authorizationTokenProvider,
            evaluationId: input.evaluationId,
            executionContractSha256:
              input.executionContractSha256,
            frozenInputClosureSha256:
              input.frozenInputClosureSha256,
            fetchImpl: input.fetchImpl,
            localOnly,
            logicalRequestOrdinal,
            now,
            pass: input.pass,
            passRoot,
            priorLogicalRequestCompletionSha256,
            request,
            requestTimeoutMilliseconds:
              input.requestTimeoutMilliseconds,
            runtimeAuthorizationSha256:
              input.runtimeAuthorizationSha256,
            waitUntil,
          });
        if (
          result.replayedExistingResult &&
          !activePass.hasStaticPassArtifacts
        ) {
          localOnly = false;
        }
        logicalRequestCompletions.push({
          artifact: result.completion,
          logicalRequestOrdinal,
        });
        priorLogicalRequestCompletionSha256 =
          result.completion.sha256;
        input.onLogicalRequestComplete?.(
          rebaseC6SourceV3SimplePassLogicalRequestCompletion(
            input.pass,
            result.completion,
          ),
        );
        logicalRequestOrdinal += 1;
        nextRequestNotBefore =
          proactiveNotBefore(result.pacing);
        return result.projectedRequest;
      },
      frame: input.frame,
    });
  const artifacts =
    await writeC6SourceV3SimplePassArtifactBundle({
      assetRoot: input.assetRoot,
      evaluationId: input.evaluationId,
      executionContractSha256:
        input.executionContractSha256,
      frozenInputClosureSha256:
        input.frozenInputClosureSha256,
      frame: input.frame,
      normalizedPass,
      pass: input.pass,
      passRoot,
      runtimeAuthorizationSha256:
        input.runtimeAuthorizationSha256,
    });
  const passComplete =
    await writeC6SourceV3SimplePassComplete({
      assetRoot: input.assetRoot,
      countTreeClosure:
        artifacts.countTreeClosure,
      evaluationId: input.evaluationId,
      executionContractSha256:
        input.executionContractSha256,
      frozenInputClosureSha256:
        input.frozenInputClosureSha256,
      frame: input.frame,
      genesisSha256: input.genesisSha256,
      logicalRequestCompletions,
      normalizedProjection:
        artifacts.normalizedProjection,
      normalizedProjectionSha256:
        artifacts.normalizedProjectionSha256,
      pass: input.pass,
      passRoot,
      pullRequestClosure:
        artifacts.pullRequestClosure,
      repositoryClosure:
        artifacts.repositoryClosure,
      runtimeAuthorizationSha256:
        input.runtimeAuthorizationSha256,
    });
  await verifyC6SourceV3SimplePassFilesystemClosure({
    completionCount:
      logicalRequestCompletions.length,
    passRoot,
  });
  return {
    nextRequestNotBefore,
    passComplete,
  };
}

export function rebaseC6SourceV3SimplePassLogicalRequestCompletion(
  pass: "A" | "B",
  reference: C6SourceV3SimpleArtifactReference,
): C6SourceV3SimpleArtifactReference {
  if (
    !/^logical-request-complete-\d{8}\.json$/u.test(
      reference.path,
    )
  ) {
    throw new Error(
      "C6 source-v3-simple pass completion reference path mismatch",
    );
  }
  return {
    ...reference,
    path:
      `pass-${pass.toLowerCase()}/${reference.path}`,
  };
}

function proactiveNotBefore(input: {
  receivedAt: string;
  remaining: number;
  resetUnixSeconds: number;
  responseDate: string;
}): number | null {
  const proactive =
    computeC6SourceV3SimpleProactiveNotBefore({
      receivedAtMilliseconds:
        Date.parse(input.receivedAt),
      remaining: input.remaining,
      resetUnixSeconds: input.resetUnixSeconds,
      responseDate: input.responseDate,
    });
  return proactive === null
    ? null
    : Date.parse(proactive);
}

export async function verifyC6SourceV3SimplePassFilesystemClosure(
  input: {
    completionCount: number;
    passRoot: string;
  },
): Promise<void> {
  const entries = await readdir(input.passRoot, {
    withFileTypes: true,
  });
  const allowedStaticFiles = new Set([
    "count-tree-closure.json",
    "normalized-pass.json",
    "normalized-projection.json",
    "pass-complete.json",
    "pull-request-closure.json",
    "repository-closure.json",
  ]);
  for (const entry of entries) {
    const isLogicalRequestDirectory =
      entry.isDirectory() &&
      /^logical-request-\d{8}$/u.test(entry.name);
    const isLogicalRequestArtifact =
      entry.isFile() &&
      /^logical-request-(?:complete|result)-\d{8}\.json$/u
        .test(entry.name);
    if (
      !isLogicalRequestDirectory &&
      !isLogicalRequestArtifact &&
      !(
        entry.isFile() &&
        allowedStaticFiles.has(entry.name)
      )
    ) {
      throw new Error(
        "C6 source-v3-simple pass filesystem closure mismatch",
      );
    }
  }
  const requestDirectories = entries
    .filter((entry) =>
      entry.isDirectory() &&
      /^logical-request-\d{8}$/u.test(entry.name)
    )
    .map((entry) => entry.name)
    .sort();
  const completions = entries
    .filter((entry) =>
      entry.isFile() &&
      /^logical-request-complete-\d{8}\.json$/u.test(
        entry.name,
      )
    )
    .map((entry) => entry.name)
    .sort();
  const results = entries
    .filter((entry) =>
      entry.isFile() &&
      /^logical-request-result-\d{8}\.json$/u.test(
        entry.name,
      )
    )
    .map((entry) => entry.name)
    .sort();
  for (
    let index = 1;
    index <= input.completionCount;
    index += 1
  ) {
    const ordinal = String(index).padStart(8, "0");
    if (
      requestDirectories[index - 1] !==
        `logical-request-${ordinal}` ||
      completions[index - 1] !==
        `logical-request-complete-${ordinal}.json` ||
      results[index - 1] !==
        `logical-request-result-${ordinal}.json`
    ) {
      throw new Error(
        "C6 source-v3-simple pass request directory closure mismatch",
      );
    }
  }
  if (
    requestDirectories.length !==
      input.completionCount ||
    completions.length !== input.completionCount ||
    results.length !== input.completionCount
  ) {
    throw new Error(
      "C6 source-v3-simple pass has trailing logical requests",
    );
  }
  for (
    const [index, directory] of
      requestDirectories.entries()
  ) {
    const attemptEntries = (
      await readdir(
        join(input.passRoot, directory),
        { withFileTypes: true },
      )
    );
    if (
      attemptEntries.some((entry) =>
        !entry.isDirectory() ||
        !/^attempt-\d{2}$/u.test(entry.name)
      )
    ) {
      throw new Error(
        "C6 source-v3-simple logical request filesystem closure mismatch",
      );
    }
    const completionBytes = await readFile(
      join(
        input.passRoot,
        completions[index]!,
      ),
    );
    const completion = JSON.parse(
      new TextDecoder("utf-8", {
        fatal: true,
      }).decode(completionBytes),
    ) as {
      attempts?: unknown;
    };
    if (
      !Array.isArray(completion.attempts) ||
      completion.attempts.length < 1 ||
      completion.attempts.length > 4
    ) {
      throw new Error(
        "C6 source-v3-simple pass completion attempt count mismatch",
      );
    }
    const expectedAttemptCount =
      completion.attempts.length;
    const expected = Array.from(
      { length: expectedAttemptCount },
      (_, attemptIndex) =>
        `attempt-${
          String(attemptIndex + 1).padStart(2, "0")
        }`,
    );
    if (
      JSON.stringify(
        attemptEntries.map((entry) => entry.name).sort(),
      ) !== JSON.stringify(expected)
    ) {
      throw new Error(
        "C6 source-v3-simple pass attempt directory closure mismatch",
      );
    }
    for (const attemptName of expected) {
      await assertAttemptFilesystemClosure(
        join(
          input.passRoot,
          directory,
          attemptName,
        ),
      );
    }
  }
}

export async function verifyC6SourceV3SimpleActivePassFilesystemClosure(
  input: {
    passRoot: string;
  },
): Promise<{
  hasStaticPassArtifacts: boolean;
  mustCompleteLocally: boolean;
}> {
  const entries = await readdir(input.passRoot, {
    withFileTypes: true,
  });
  const allowedStaticFiles = new Set([
    "count-tree-closure.json",
    "normalized-pass.json",
    "normalized-projection.json",
    "pass-complete.json",
    "pull-request-closure.json",
    "repository-closure.json",
  ]);
  const requestDirectories = new Map<number, string>();
  const completions = new Set<number>();
  const results = new Set<number>();
  let hasStaticPassArtifacts = false;
  for (const entry of entries) {
    const requestDirectory =
      entry.isDirectory()
        ? /^logical-request-(\d{8})$/u.exec(entry.name)
        : null;
    const completion =
      entry.isFile()
        ? /^logical-request-complete-(\d{8})\.json$/u
            .exec(entry.name)
        : null;
    const result =
      entry.isFile()
        ? /^logical-request-result-(\d{8})\.json$/u
            .exec(entry.name)
        : null;
    if (requestDirectory !== null) {
      requestDirectories.set(
        Number(requestDirectory[1]),
        entry.name,
      );
    } else if (completion !== null) {
      completions.add(Number(completion[1]));
    } else if (result !== null) {
      results.add(Number(result[1]));
    } else if (
      entry.isFile() &&
      allowedStaticFiles.has(entry.name)
    ) {
      hasStaticPassArtifacts = true;
    } else {
      throw new Error(
        "C6 source-v3-simple active pass filesystem closure mismatch",
      );
    }
  }
  const ordinals = [
    ...new Set([
      ...requestDirectories.keys(),
      ...completions,
      ...results,
    ]),
  ].sort((left, right) => left - right);
  for (const [index, ordinal] of ordinals.entries()) {
    const hasDirectory = requestDirectories.has(ordinal);
    const hasCompletion = completions.has(ordinal);
    const hasResult = results.has(ordinal);
    const isComplete =
      hasDirectory &&
      hasCompletion &&
      hasResult;
    const isLastInProgress =
      index === ordinals.length - 1 &&
      hasDirectory &&
      !hasCompletion;
    if (
      ordinal !== index + 1 ||
      (!isComplete && !isLastInProgress)
    ) {
      throw new Error(
        "C6 source-v3-simple active pass filesystem closure mismatch",
      );
    }
  }
  for (const directory of requestDirectories.values()) {
    await assertActiveLogicalRequestFilesystemClosure(
      join(input.passRoot, directory),
    );
  }
  return {
    hasStaticPassArtifacts,
    mustCompleteLocally:
      hasStaticPassArtifacts ||
      ordinals.some((ordinal) =>
        results.has(ordinal) &&
        !completions.has(ordinal)
      ),
  };
}

async function assertActiveLogicalRequestFilesystemClosure(
  logicalRequestRoot: string,
): Promise<void> {
  const entries = await readdir(logicalRequestRoot, {
    withFileTypes: true,
  });
  const attemptDirectories = entries
    .filter((entry) =>
      entry.isDirectory() &&
      /^attempt-\d{2}$/u.test(entry.name)
    )
    .map((entry) => entry.name)
    .sort();
  const expected = Array.from(
    { length: attemptDirectories.length },
    (_, index) =>
      `attempt-${String(index + 1).padStart(2, "0")}`,
  );
  if (
    entries.length > 4 ||
    attemptDirectories.length !== entries.length ||
    JSON.stringify(attemptDirectories) !==
      JSON.stringify(expected)
  ) {
    throw new Error(
      "C6 source-v3-simple active pass attempt directory closure mismatch",
    );
  }
  for (const directory of attemptDirectories) {
    await assertAttemptFilesystemClosure(
      join(logicalRequestRoot, directory),
    );
  }
}

async function assertAttemptFilesystemClosure(
  attemptRoot: string,
): Promise<void> {
  const allowed = new Set([
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
  const entries = await readdir(attemptRoot, {
    withFileTypes: true,
  });
  if (
    entries.some((entry) =>
      !entry.isFile() || !allowed.has(entry.name)
    )
  ) {
    throw new Error(
      "C6 source-v3-simple attempt filesystem closure mismatch",
    );
  }
}

async function waitUntilWallClock(
  notBefore: number,
): Promise<void> {
  while (Date.now() < notBefore) {
    await new Promise<void>((resolve) => {
      setTimeout(
        resolve,
        Math.min(60_000, notBefore - Date.now()),
      );
    });
  }
}
