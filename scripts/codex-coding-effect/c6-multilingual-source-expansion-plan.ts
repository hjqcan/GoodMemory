import { createHash } from "node:crypto";
import { basename } from "node:path";

import { z } from "zod";

const ARTIFACT_KIND = "c6-multilingual-source-expansion-plan";
const DATASET_ID = "SWE-bench/SWE-bench_Multilingual";
const SOURCE_REVISION = "e5c585e008e2cb5eecc7c64192d855c53279d788";
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const repositorySchema = z.string().regex(/^[^/\s]+\/[^/\s]+$/u);
const sourcePoolSchema = z.object({
  counts: z.object({
    observedRows: z.number().int().positive(),
    repositories: z.number().int().positive(),
  }).passthrough(),
  rows: z.array(z.object({
    agentVisibleRequestSha256: sha256Schema,
    instanceId: z.string().min(1),
    repository: repositorySchema,
    rowIndex: z.number().int().nonnegative(),
    version: z.string().regex(/^[1-9]\d*$/u),
  }).passthrough()).length(300),
  schemaVersion: z.literal(1),
  source: z.object({
    datasetId: z.literal(DATASET_ID),
    revision: z.literal(SOURCE_REVISION),
  }).passthrough(),
}).passthrough();

export interface C6MultilingualSourceExpansionTarget {
  agentVisibleRequestSha256: string;
  captureDirectory: string;
  captureOrder: number;
  instanceId: string;
  owner: string;
  pullNumber: number;
  repo: string;
  requestedAnchorId: string;
  rowIndex: number;
}

export interface C6MultilingualSourceExpansionPlan {
  artifactKind: typeof ARTIFACT_KIND;
  boundary: {
    acceptedEpisodeCount: 0;
    adaptiveProspective: true;
    candidateManifestFrozen: false;
    codexRunReady: false;
    status: "multilingual-graphql-capture-plan-only";
  };
  counts: {
    repositoryCount: number;
    sourceRowCount: number;
    targetCount: number;
  };
  independenceBoundary: {
    canonicalDeduplicationDeferredToPostCapture: true;
    machineOutcomeInput: false;
    selectionUsesEvaluatorFields: false;
    semanticLedgerInput: false;
    targetProjectionSha256: string;
  };
  rule: {
    captureOrder: "source-rowIndex-ascending";
    forbiddenSelectionInputs: readonly [
      "decision",
      "baseCommit",
      "evaluatorOnlySha256",
      "failToPassSha256",
      "goldPatchSha256",
      "hintsSha256",
      "normalizedRowSha256",
      "passToPassSha256",
      "testPatchSha256",
      "semanticScreeningDecision",
      "machineQualificationDecision",
      "outcome",
    ];
    selection: "all-frozen-source-rows";
  };
  schemaVersion: 1;
  sourcePool: {
    bytes: number;
    datasetId: typeof DATASET_ID;
    path: string;
    revision: typeof SOURCE_REVISION;
    sha256: string;
  };
  targets: C6MultilingualSourceExpansionTarget[];
}

export function projectC6MultilingualSourceExpansionPlan(input: {
  sourcePoolBytes: Uint8Array;
  sourcePoolPath: string;
}): C6MultilingualSourceExpansionPlan {
  const bytes = Buffer.from(input.sourcePoolBytes);
  const sourcePool = sourcePoolSchema.parse(parseJson(bytes));
  if (
    sourcePool.counts.observedRows !== sourcePool.rows.length ||
    sourcePool.counts.repositories !==
      new Set(sourcePool.rows.map((row) => row.repository)).size
  ) {
    throw new Error("C6 multilingual source-pool count mismatch");
  }
  const targets = [...sourcePool.rows]
    .sort((left, right) => left.rowIndex - right.rowIndex)
    .map((row, index) => {
      if (row.rowIndex !== index) {
        throw new Error(
          "C6 multilingual source rows must be a contiguous rank prefix",
        );
      }
      const [owner, repo] = row.repository.split("/");
      const pullNumber = Number(row.version);
      const expectedInstanceId =
        `${owner}__${repo}-${row.version}`;
      if (
        row.instanceId !== expectedInstanceId ||
        !Number.isSafeInteger(pullNumber)
      ) {
        throw new Error(
          `C6 multilingual source identity mismatch ${row.instanceId}`,
        );
      }
      return {
        agentVisibleRequestSha256: row.agentVisibleRequestSha256,
        captureDirectory: `${owner}__${repo}__${pullNumber}`,
        captureOrder: index + 1,
        instanceId: row.instanceId,
        owner,
        pullNumber,
        repo,
        requestedAnchorId: `${row.repository}#${pullNumber}`,
        rowIndex: row.rowIndex,
      };
    });
  if (
    new Set(targets.map((target) => target.requestedAnchorId)).size !==
      targets.length
  ) {
    throw new Error("C6 multilingual capture targets must be unique");
  }
  return {
    artifactKind: ARTIFACT_KIND,
    boundary: {
      acceptedEpisodeCount: 0,
      adaptiveProspective: true,
      candidateManifestFrozen: false,
      codexRunReady: false,
      status: "multilingual-graphql-capture-plan-only",
    },
    counts: {
      repositoryCount: sourcePool.counts.repositories,
      sourceRowCount: sourcePool.rows.length,
      targetCount: targets.length,
    },
    independenceBoundary: {
      canonicalDeduplicationDeferredToPostCapture: true,
      machineOutcomeInput: false,
      selectionUsesEvaluatorFields: false,
      semanticLedgerInput: false,
      targetProjectionSha256: sha256(JSON.stringify(targets)),
    },
    rule: {
      captureOrder: "source-rowIndex-ascending",
      forbiddenSelectionInputs: [
        "decision",
        "baseCommit",
        "evaluatorOnlySha256",
        "failToPassSha256",
        "goldPatchSha256",
        "hintsSha256",
        "normalizedRowSha256",
        "passToPassSha256",
        "testPatchSha256",
        "semanticScreeningDecision",
        "machineQualificationDecision",
        "outcome",
      ],
      selection: "all-frozen-source-rows",
    },
    schemaVersion: 1,
    sourcePool: {
      bytes: bytes.byteLength,
      datasetId: DATASET_ID,
      path: basename(input.sourcePoolPath),
      revision: SOURCE_REVISION,
      sha256: sha256(bytes),
    },
    targets,
  };
}

export function serializeC6MultilingualSourceExpansionPlan(
  plan: C6MultilingualSourceExpansionPlan,
): string {
  return `${JSON.stringify(plan, null, 2)}\n`;
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch {
    throw new Error("C6 multilingual source pool is not valid JSON");
  }
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
