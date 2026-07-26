import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { z } from "zod";

import {
  assertC6SourcePoolArtifact,
} from "./c6-source-pool";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const commitSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const testStateSchema = z.enum(["FAIL", "NONE", "PASS"]);
const testOutcomeSchema = z.object({
  fix: testStateSchema,
  run: testStateSchema,
  test: testStateSchema,
}).strict();
const testMapSchema = z.record(z.string(), testOutcomeSchema);
const runResultSchema = z.object({
  failed_count: z.number().int().nonnegative(),
  failed_tests: z.array(z.string()),
  passed_count: z.number().int().nonnegative(),
  passed_tests: z.array(z.string()),
  skipped_count: z.number().int().nonnegative(),
  skipped_tests: z.array(z.string()),
}).strict();
const sourceRowSchema = z.object({
  base: z.object({
    label: z.string(),
    ref: z.string(),
    sha: commitSchema,
  }).strict(),
  body: z.string(),
  f2p_tests: testMapSchema,
  fix_patch: z.string(),
  fix_patch_result: runResultSchema,
  fixed_tests: testMapSchema,
  hints: z.string(),
  instance_id: z.string().min(1),
  n2p_tests: testMapSchema,
  number: z.number().int().positive(),
  org: z.string(),
  p2p_tests: testMapSchema,
  repo: z.string(),
  resolved_issues: z.array(z.object({
    body: z.string(),
    number: z.number().int().positive(),
    title: z.string(),
  }).strict()),
  run_result: runResultSchema,
  s2p_tests: testMapSchema,
  state: z.string(),
  test_patch: z.string(),
  test_patch_result: runResultSchema,
  title: z.string(),
}).strict();

export const C6_MULTI_SWE_JQ_SOURCE = {
  artifact: {
    bytes: 148_809,
    gitBlobOid: "e5648629616c7ff5b319954202aa1db6d89fd7c5",
    path: "c/jqlang__jq_dataset.jsonl",
    sha256:
      "8be07a2281fa766b310037db9bc2abc3f8c7150c3d471ea56a964921d5609e8f",
    url:
      "https://huggingface.co/datasets/ByteDance-Seed/Multi-SWE-bench/resolve/56ff018c04a38e27ada1e9d0a6d5839a51f88f0d/c/jqlang__jq_dataset.jsonl",
  },
  datasetCard: {
    bytes: 11_283,
    gitBlobOid: "5f9e55e14d014e4ce253d49e7b2fea974744bccd",
    licenseMetadata: "other",
    licenseScope:
      "cc0-claim-subject-to-bytedance-rights-and-upstream-project-licenses",
    path: "README.md",
    sha256:
      "26638a5dc8d8c10e04de4578c904beecefb584d44e618cfe2c33fd350ca9810d",
    url:
      "https://huggingface.co/datasets/ByteDance-Seed/Multi-SWE-bench/resolve/56ff018c04a38e27ada1e9d0a6d5839a51f88f0d/README.md",
  },
  datasetId: "ByteDance-Seed/Multi-SWE-bench",
  format: "jsonl-with-lf-terminated-records",
  repository: "https://github.com/jqlang/jq",
  revision: "56ff018c04a38e27ada1e9d0a6d5839a51f88f0d",
} as const;

export const C6_EXISTING_SWE_BENCH_MULTILINGUAL_SOURCE_POOL = {
  artifactSha256:
    "15cf8d4a0a7ab0e3e7dee32555f266f1bccfd47ace7f5b31d8e474e064c37cf5",
  bytes: 333_573,
  sourceId: "swe-bench-multilingual-e5c585e",
} as const;

const REQUIRED_NEXT_EVIDENCE = [
  "original-issue-and-pull-request-receipt",
  "actual-solution-commit-to-next-base-ancestry",
  "historical-jq-project-license-review",
  "base-gold-protection-linux-replay",
  "gold-blind-semantic-dependency-review",
  "cross-source-canonical-task-deduplication-review",
  "deterministic-prehistory-materialization",
] as const;

export type C6MultiSWEJqSourcePoolBlocker =
  | "base-label-mismatch"
  | "base-ref-mismatch"
  | "blank-fix-patch"
  | "blank-original-issue"
  | "blank-pull-request-body"
  | "blank-pull-request-title"
  | "blank-test-patch"
  | "fix-result-has-failures"
  | "instance-id-mismatch"
  | "missing-fail-to-pass"
  | "missing-fixed-test"
  | "missing-pass-to-pass"
  | "repository-mismatch"
  | "run-result-has-failures"
  | "state-not-closed"
  | "test-patch-does-not-expose-failure";

export interface C6ExistingSourcePoolBinding {
  artifactSha256: string;
  rows: Array<{
    baseCommit: string;
    instanceId: string;
  }>;
  sourceId: string;
}

export interface C6MultiSWEJqSourcePoolRow {
  baseCommit: string;
  blockers: C6MultiSWEJqSourcePoolBlocker[];
  canonicalUpstreamIdentity: string;
  crossSourceAlias: {
    existingBaseCommit: string;
    existingSourceId: string;
    sameBaseCommit: boolean;
  } | null;
  decision:
    | "queued-for-origin-ancestry-semantic-and-replay-review"
    | "rejected-before-upstream-review";
  evaluatorOnlySha256: string;
  evaluatorTestsSha256: string;
  fixPatchSha256: string;
  hintsSha256: string;
  instanceId: string;
  lineNumber: number;
  pullBodySha256: string;
  pullTitleSha256: string;
  rawRecordBytes: number;
  rawRecordSha256: string;
  repository: "jqlang/jq";
  resolvedIssueRecordSha256: string;
  sourceUnitId: string;
  testPatchSha256: string;
  upstreamPullNumber: number;
}

export interface C6MultiSWEJqSourcePoolSnapshot {
  boundary: {
    acceptedEpisodeCount: 0;
    candidateChainUniverseComplete: false;
    candidateManifestFrozen: false;
    status:
      "source-pool-only-origin-ancestry-semantic-and-replay-review-required";
  };
  counts: {
    crossSourceAliases: number;
    newCanonicalUpstreamTasks: number;
    observedRows: number;
    queuedForReview: number;
    rejectedBeforeUpstreamReview: number;
    repositories: 1;
  };
  crossSourceIdentityPolicy: {
    canonicalIdentity: "github-repository-and-pull-number-v1";
    existingSourcePoolSha256: string;
    existingSourcePoolSourceId: string;
    samePullDifferentBaseCountsAsOneTask: true;
  };
  requiredNextEvidence: typeof REQUIRED_NEXT_EVIDENCE;
  rows: C6MultiSWEJqSourcePoolRow[];
  schemaVersion: 1;
  source: typeof C6_MULTI_SWE_JQ_SOURCE;
}

export async function loadC6MultiSWEJqSourcePool(input: {
  existingSourcePool: string;
  jsonlFile: string;
  readmeFile: string;
}): Promise<C6MultiSWEJqSourcePoolSnapshot> {
  const [jsonlBytes, readmeBytes, existingSourcePoolBytes] = await Promise.all([
    readFile(input.jsonlFile),
    readFile(input.readmeFile),
    readFile(input.existingSourcePool),
  ]);
  assertC6SourcePoolArtifact(
    jsonlBytes,
    C6_MULTI_SWE_JQ_SOURCE.artifact,
    "C6 Multi-SWE-bench jq JSONL",
  );
  assertC6SourcePoolArtifact(
    readmeBytes,
    C6_MULTI_SWE_JQ_SOURCE.datasetCard,
    "C6 Multi-SWE-bench dataset card",
  );
  assertC6SourcePoolArtifact(
    existingSourcePoolBytes,
    {
      bytes: C6_EXISTING_SWE_BENCH_MULTILINGUAL_SOURCE_POOL.bytes,
      sha256:
        C6_EXISTING_SWE_BENCH_MULTILINGUAL_SOURCE_POOL.artifactSha256,
    },
    "C6 existing SWE-bench Multilingual source pool",
  );
  const existingSourcePool = parseExistingSourcePool(existingSourcePoolBytes);
  const rawRecords = splitRawRecords(jsonlBytes);
  return buildC6MultiSWEJqSourcePoolSnapshot(
    rawRecords,
    existingSourcePool,
  );
}

export function buildC6MultiSWEJqSourcePoolSnapshot(
  rawRecords: readonly string[],
  existingSourcePool: C6ExistingSourcePoolBinding,
): C6MultiSWEJqSourcePoolSnapshot {
  if (rawRecords.length !== 17) {
    throw new Error(
      `C6 Multi-SWE-bench jq source pool requires exactly 17 records; received ${rawRecords.length}`,
    );
  }
  sha256Schema.parse(existingSourcePool.artifactSha256);
  const existingRowsByInstanceId = new Map<string, {
    baseCommit: string;
    instanceId: string;
  }>();
  for (const row of existingSourcePool.rows) {
    commitSchema.parse(row.baseCommit);
    if (existingRowsByInstanceId.has(row.instanceId)) {
      throw new Error(
        `C6 existing source pool contains duplicate instance ID ${row.instanceId}`,
      );
    }
    existingRowsByInstanceId.set(row.instanceId, row);
  }

  const seenInstanceIds = new Set<string>();
  const seenUpstreamIdentities = new Set<string>();
  const rows = rawRecords.map((rawRecord, index) => {
    const lineNumber = index + 1;
    if (!rawRecord.endsWith("\n") || rawRecord.slice(0, -1).includes("\n")) {
      throw new Error(
        `C6 Multi-SWE-bench jq raw record ${lineNumber} must include its terminating LF`,
      );
    }
    const parsed = sourceRowSchema.parse(
      JSON.parse(rawRecord.slice(0, -1)),
    );
    const canonicalUpstreamIdentity =
      `https://github.com/jqlang/jq/pull/${parsed.number}`;
    if (seenUpstreamIdentities.has(canonicalUpstreamIdentity)) {
      throw new Error(
        `C6 Multi-SWE-bench jq source pool contains duplicate canonical upstream identity ${canonicalUpstreamIdentity}`,
      );
    }
    if (seenInstanceIds.has(parsed.instance_id)) {
      throw new Error(
        `C6 Multi-SWE-bench jq source pool contains duplicate instance ID ${parsed.instance_id}`,
      );
    }
    seenUpstreamIdentities.add(canonicalUpstreamIdentity);
    seenInstanceIds.add(parsed.instance_id);
    return commitSourceRow({
      existingRow: existingRowsByInstanceId.get(parsed.instance_id),
      lineNumber,
      rawRecord,
      row: parsed,
      sourceId: existingSourcePool.sourceId,
    });
  });
  const queuedForReview = rows.filter((row) =>
    row.decision ===
      "queued-for-origin-ancestry-semantic-and-replay-review"
  ).length;
  const crossSourceAliases = rows.filter((row) =>
    row.crossSourceAlias !== null
  ).length;
  return {
    boundary: {
      acceptedEpisodeCount: 0,
      candidateChainUniverseComplete: false,
      candidateManifestFrozen: false,
      status:
        "source-pool-only-origin-ancestry-semantic-and-replay-review-required",
    },
    counts: {
      crossSourceAliases,
      newCanonicalUpstreamTasks: rows.length - crossSourceAliases,
      observedRows: rows.length,
      queuedForReview,
      rejectedBeforeUpstreamReview: rows.length - queuedForReview,
      repositories: 1,
    },
    crossSourceIdentityPolicy: {
      canonicalIdentity: "github-repository-and-pull-number-v1",
      existingSourcePoolSha256: existingSourcePool.artifactSha256,
      existingSourcePoolSourceId: existingSourcePool.sourceId,
      samePullDifferentBaseCountsAsOneTask: true,
    },
    requiredNextEvidence: REQUIRED_NEXT_EVIDENCE,
    rows,
    schemaVersion: 1,
    source: C6_MULTI_SWE_JQ_SOURCE,
  };
}

export function serializeC6MultiSWEJqSourcePoolSnapshot(
  snapshot: C6MultiSWEJqSourcePoolSnapshot,
): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

function splitRawRecords(bytes: Uint8Array): string[] {
  const text = Buffer.from(bytes).toString("utf8");
  if (!text.endsWith("\n")) {
    throw new Error("C6 Multi-SWE-bench jq JSONL must end with LF");
  }
  return text.slice(0, -1).split("\n").map((line) => `${line}\n`);
}

function parseExistingSourcePool(
  bytes: Uint8Array,
): C6ExistingSourcePoolBinding {
  const parsed = z.object({
    rows: z.array(z.object({
      baseCommit: commitSchema,
      instanceId: z.string().min(1),
    }).passthrough()),
    source: z.object({
      datasetId: z.literal("SWE-bench/SWE-bench_Multilingual"),
      revision: z.literal(
        "e5c585e008e2cb5eecc7c64192d855c53279d788",
      ),
    }).passthrough(),
  }).passthrough().parse(JSON.parse(Buffer.from(bytes).toString("utf8")));
  return {
    artifactSha256:
      C6_EXISTING_SWE_BENCH_MULTILINGUAL_SOURCE_POOL.artifactSha256,
    rows: parsed.rows.map((row) => ({
      baseCommit: row.baseCommit,
      instanceId: row.instanceId,
    })),
    sourceId: C6_EXISTING_SWE_BENCH_MULTILINGUAL_SOURCE_POOL.sourceId,
  };
}

function commitSourceRow(input: {
  existingRow?: {
    baseCommit: string;
    instanceId: string;
  };
  lineNumber: number;
  rawRecord: string;
  row: z.infer<typeof sourceRowSchema>;
  sourceId: string;
}): C6MultiSWEJqSourcePoolRow {
  const { existingRow, lineNumber, rawRecord, row, sourceId } = input;
  const blockers = sourceRowBlockers(row);
  const evaluatorTestsSha256 = sha256(JSON.stringify({
    f2pTests: row.f2p_tests,
    fixPatchResult: row.fix_patch_result,
    fixedTests: row.fixed_tests,
    n2pTests: row.n2p_tests,
    p2pTests: row.p2p_tests,
    runResult: row.run_result,
    s2pTests: row.s2p_tests,
    testPatchResult: row.test_patch_result,
  }));
  const fixPatchSha256 = sha256(row.fix_patch);
  const pullBodySha256 = sha256(row.body);
  const pullTitleSha256 = sha256(row.title);
  const testPatchSha256 = sha256(row.test_patch);
  return {
    baseCommit: row.base.sha,
    blockers,
    canonicalUpstreamIdentity:
      `https://github.com/jqlang/jq/pull/${row.number}`,
    crossSourceAlias: existingRow === undefined
      ? null
      : {
        existingBaseCommit: existingRow.baseCommit,
        existingSourceId: sourceId,
        sameBaseCommit: existingRow.baseCommit === row.base.sha,
      },
    decision: blockers.length === 0
      ? "queued-for-origin-ancestry-semantic-and-replay-review"
      : "rejected-before-upstream-review",
    evaluatorOnlySha256: sha256(JSON.stringify({
      evaluatorTestsSha256,
      fixPatchSha256,
      pullBodySha256,
      pullTitleSha256,
      testPatchSha256,
    })),
    evaluatorTestsSha256,
    fixPatchSha256,
    hintsSha256: sha256(row.hints),
    instanceId: row.instance_id,
    lineNumber,
    pullBodySha256,
    pullTitleSha256,
    rawRecordBytes: Buffer.byteLength(rawRecord),
    rawRecordSha256: sha256(rawRecord),
    repository: "jqlang/jq",
    resolvedIssueRecordSha256: sha256(JSON.stringify(row.resolved_issues)),
    sourceUnitId: `multi-swe-jq:line-${lineNumber}`,
    testPatchSha256,
    upstreamPullNumber: row.number,
  };
}

function sourceRowBlockers(
  row: z.infer<typeof sourceRowSchema>,
): C6MultiSWEJqSourcePoolBlocker[] {
  const blockers: C6MultiSWEJqSourcePoolBlocker[] = [];
  if (row.org !== "jqlang" || row.repo !== "jq") {
    blockers.push("repository-mismatch");
  }
  if (row.state !== "closed") {
    blockers.push("state-not-closed");
  }
  if (row.base.label !== "jqlang:master") {
    blockers.push("base-label-mismatch");
  }
  if (row.base.ref !== "master") {
    blockers.push("base-ref-mismatch");
  }
  if (row.instance_id !== `jqlang__jq-${row.number}`) {
    blockers.push("instance-id-mismatch");
  }
  if (row.title.trim().length === 0) {
    blockers.push("blank-pull-request-title");
  }
  if (row.body.trim().length === 0) {
    blockers.push("blank-pull-request-body");
  }
  if (
    row.resolved_issues.length === 0 ||
    row.resolved_issues.some((issue) =>
      issue.title.trim().length === 0 || issue.body.trim().length === 0
    )
  ) {
    blockers.push("blank-original-issue");
  }
  if (row.fix_patch.trim().length === 0) {
    blockers.push("blank-fix-patch");
  }
  if (row.test_patch.trim().length === 0) {
    blockers.push("blank-test-patch");
  }
  if (Object.keys(row.fixed_tests).length === 0) {
    blockers.push("missing-fixed-test");
  }
  if (Object.keys(row.f2p_tests).length === 0) {
    blockers.push("missing-fail-to-pass");
  }
  if (Object.keys(row.p2p_tests).length === 0) {
    blockers.push("missing-pass-to-pass");
  }
  if (row.run_result.failed_count !== 0) {
    blockers.push("run-result-has-failures");
  }
  if (row.test_patch_result.failed_count === 0) {
    blockers.push("test-patch-does-not-expose-failure");
  }
  if (row.fix_patch_result.failed_count !== 0) {
    blockers.push("fix-result-has-failures");
  }
  return blockers;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
