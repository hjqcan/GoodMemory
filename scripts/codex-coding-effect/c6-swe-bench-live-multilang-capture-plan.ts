import { createHash } from "node:crypto";
import { basename } from "node:path";

import { z } from "zod";

const DATASET_ID = "SWE-bench-Live/MultiLang";
const REVISION = "608f7ae9ab8ea1f9f0d030fe04562cf6bd1a0c8b";
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const sourceRowSchema = z.object({
  agentVisibleRequestSha256: sha256Schema,
  instanceId: z.string().min(1),
  pullNumber: z.number().int().positive(),
  repository: z.string().regex(/^[^/#\s]+\/[^/#\s]+$/u),
  rowIndex: z.number().int().nonnegative(),
  sourceSplit: z.enum([
    "c",
    "cpp",
    "go",
    "js",
    "rust",
    "java",
    "ts",
    "cs",
  ]),
  sourceSplitRowIndex: z.number().int().nonnegative(),
}).passthrough();
const sourcePoolSchema = z.object({
  artifactKind: z.literal(
    "c6-swe-bench-live-multilang-source-pool",
  ),
  counts: z.object({
    observedRows: z.literal(743),
    repositories: z.number().int().positive(),
    splits: z.literal(8),
  }).strict(),
  independenceBoundary: z.object({
    captureTargetProjectionSha256: sha256Schema,
    evaluatorFieldSelectionInput: z.literal(false),
    machineOutcomeInput: z.literal(false),
    selection: z.literal("all-frozen-source-rows"),
    semanticLedgerInput: z.literal(false),
  }).strict(),
  rows: z.array(sourceRowSchema).length(743),
  schemaVersion: z.literal(1),
  source: z.object({
    datasetId: z.literal(DATASET_ID),
    revision: z.literal(REVISION),
  }).passthrough(),
}).passthrough();

export interface C6SWEbenchLiveMultiLangCaptureTarget {
  agentVisibleRequestSha256: string;
  captureDirectory: string;
  captureOrder: number;
  instanceId: string;
  owner: string;
  pullNumber: number;
  repo: string;
  requestedAnchorId: string;
  rowIndex: number;
  sourceSplit: z.infer<typeof sourceRowSchema>["sourceSplit"];
  sourceSplitRowIndex: number;
}

export interface C6SWEbenchLiveMultiLangCapturePlan {
  artifactKind: "c6-swe-bench-live-multilang-capture-plan";
  boundary: {
    acceptedEpisodeCount: 0;
    candidateManifestFrozen: false;
    captureExecuted: false;
    codexRunReady: false;
    status: "graphql-capture-plan-only";
  };
  counts: {
    repositoryCount: number;
    sourceRowCount: 743;
    targetCount: 743;
  };
  independenceBoundary: {
    evaluatorFieldInput: false;
    machineOutcomeInput: false;
    selection: "all-frozen-source-rows";
    semanticLedgerInput: false;
    sourceCaptureTargetProjectionSha256: string;
    targetProjectionSha256: string;
  };
  rule: {
    captureOrder: "source-rowIndex-ascending";
    canonicalDeduplication: "deferred-until-captured-resolution";
    selection: "all-frozen-source-rows";
  };
  schemaVersion: 1;
  sourcePool: {
    bytes: number;
    datasetId: typeof DATASET_ID;
    path: string;
    revision: typeof REVISION;
    sha256: string;
  };
  targets: C6SWEbenchLiveMultiLangCaptureTarget[];
}

export function projectC6SWEbenchLiveMultiLangCapturePlan(input: {
  sourcePoolBytes: Uint8Array;
  sourcePoolPath: string;
}): C6SWEbenchLiveMultiLangCapturePlan {
  const sourcePoolBytes = Buffer.from(input.sourcePoolBytes);
  const sourcePool = sourcePoolSchema.parse(
    parseJson(sourcePoolBytes),
  );
  const sourceProjection = sourcePool.rows.map((row) => ({
    agentVisibleRequestSha256: row.agentVisibleRequestSha256,
    instanceId: row.instanceId,
    pullNumber: row.pullNumber,
    repository: row.repository,
    rowIndex: row.rowIndex,
    sourceSplit: row.sourceSplit,
    sourceSplitRowIndex: row.sourceSplitRowIndex,
  }));
  if (
    sha256(JSON.stringify(sourceProjection)) !==
      sourcePool.independenceBoundary
        .captureTargetProjectionSha256 ||
    new Set(
      sourcePool.rows.map((row) => row.repository.toLowerCase()),
    ).size !== sourcePool.counts.repositories
  ) {
    throw new Error(
      "C6 SWE-bench-Live MultiLang source target projection mismatch",
    );
  }
  const targets = [...sourcePool.rows]
    .sort((left, right) => left.rowIndex - right.rowIndex)
    .map((row, index) => {
      if (row.rowIndex !== index) {
        throw new Error(
          "C6 SWE-bench-Live MultiLang source order must be contiguous",
        );
      }
      const [owner, repo] = row.repository.split("/");
      if (
        owner === undefined ||
        repo === undefined ||
        !/^[A-Za-z0-9_.-]+$/u.test(owner) ||
        !/^[A-Za-z0-9_.-]+$/u.test(repo) ||
        row.instanceId !==
          `${owner}__${repo}-${row.pullNumber}`
      ) {
        throw new Error(
          `C6 SWE-bench-Live MultiLang source identity mismatch ${
            row.instanceId
          }`,
        );
      }
      return {
        agentVisibleRequestSha256: row.agentVisibleRequestSha256,
        captureDirectory: `${owner}__${repo}__${row.pullNumber}`,
        captureOrder: index + 1,
        instanceId: row.instanceId,
        owner,
        pullNumber: row.pullNumber,
        repo,
        requestedAnchorId:
          `${row.repository}#${row.pullNumber}`,
        rowIndex: row.rowIndex,
        sourceSplit: row.sourceSplit,
        sourceSplitRowIndex: row.sourceSplitRowIndex,
      };
    });
  if (
    new Set(
      targets.map((target) => target.requestedAnchorId.toLowerCase()),
    ).size !== targets.length ||
    new Set(
      targets.map((target) => target.captureDirectory),
    ).size !== targets.length
  ) {
    throw new Error(
      "C6 SWE-bench-Live MultiLang capture target collision",
    );
  }
  return {
    artifactKind: "c6-swe-bench-live-multilang-capture-plan",
    boundary: {
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      captureExecuted: false,
      codexRunReady: false,
      status: "graphql-capture-plan-only",
    },
    counts: {
      repositoryCount: sourcePool.counts.repositories,
      sourceRowCount: 743,
      targetCount: 743,
    },
    independenceBoundary: {
      evaluatorFieldInput: false,
      machineOutcomeInput: false,
      selection: "all-frozen-source-rows",
      semanticLedgerInput: false,
      sourceCaptureTargetProjectionSha256:
        sourcePool.independenceBoundary
          .captureTargetProjectionSha256,
      targetProjectionSha256: sha256(JSON.stringify(targets)),
    },
    rule: {
      captureOrder: "source-rowIndex-ascending",
      canonicalDeduplication: "deferred-until-captured-resolution",
      selection: "all-frozen-source-rows",
    },
    schemaVersion: 1,
    sourcePool: {
      bytes: sourcePoolBytes.byteLength,
      datasetId: DATASET_ID,
      path: basename(input.sourcePoolPath),
      revision: REVISION,
      sha256: sha256(sourcePoolBytes),
    },
    targets,
  };
}

export function serializeC6SWEbenchLiveMultiLangCapturePlan(
  plan: C6SWEbenchLiveMultiLangCapturePlan,
): string {
  return `${JSON.stringify(plan, null, 2)}\n`;
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch {
    throw new Error(
      "C6 SWE-bench-Live MultiLang source pool is not valid JSON",
    );
  }
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
