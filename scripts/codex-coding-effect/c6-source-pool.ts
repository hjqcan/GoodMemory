import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import type { AsyncBuffer } from "hyparquet";
import { parquetReadObjects } from "hyparquet";
import { z } from "zod";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const sourceRowSchema = z.object({
  base_commit: z.string(),
  created_at: z.string(),
  FAIL_TO_PASS: z.array(z.string()),
  hints_text: z.string(),
  instance_id: z.string().min(1),
  PASS_TO_PASS: z.array(z.string()),
  patch: z.string(),
  problem_statement: z.string(),
  repo: z.string(),
  test_patch: z.string(),
  version: z.string(),
}).strict();

export const C6_SWE_BENCH_MULTILINGUAL_SOURCE = {
  artifact: {
    bytes: 1_165_968,
    path: "data/test-00000-of-00001.parquet",
    sha256:
      "28b7f874e48496399077d276f9f2b163a077ddf0a70dc507c148d58da826baa9",
    url:
      "https://huggingface.co/datasets/SWE-bench/SWE-bench_Multilingual/resolve/e5c585e008e2cb5eecc7c64192d855c53279d788/data/test-00000-of-00001.parquet",
  },
  datasetId: "SWE-bench/SWE-bench_Multilingual",
  datasetCardLicense: "MIT",
  datasetCardLicenseEvidence: {
    bytes: 729,
    path: "README.md",
    sha256:
      "05d5096b015147c8cd7de51579965aacc5a184b1c5c90e5ccdb2109fb1f11dc1",
    url:
      "https://huggingface.co/datasets/SWE-bench/SWE-bench_Multilingual/resolve/e5c585e008e2cb5eecc7c64192d855c53279d788/README.md",
  },
  format: "parquet",
  revision: "e5c585e008e2cb5eecc7c64192d855c53279d788",
  split: "test",
  webpage:
    "https://huggingface.co/datasets/SWE-bench/SWE-bench_Multilingual",
} as const;

const REQUIRED_NEXT_EVIDENCE = [
  "original-issue-or-pr-response",
  "repository-commit-reachability-and-tree",
  "historical-project-license",
  "base-gold-protection-linux-replay",
  "chronological-memory-dependency-review",
  "independent-semantic-duplicate-review",
] as const;

export type C6SourcePoolRejectionReason =
  | "blank-gold-patch"
  | "blank-problem-statement"
  | "blank-test-patch"
  | "invalid-base-commit"
  | "invalid-created-at"
  | "invalid-repository"
  | "missing-fail-to-pass"
  | "missing-pass-to-pass";

export interface C6SourcePoolSnapshotRow {
  agentVisibleRequestSha256: string;
  baseCommit: string;
  createdAt: string;
  decision:
    | "queued-for-origin-and-relationship-review"
    | "rejected-before-origin-review";
  evaluatorOnlySha256: string;
  failToPassSha256: string;
  goldPatchSha256: string;
  hintsSha256: string;
  instanceId: string;
  normalizedRowSha256: string;
  passToPassSha256: string;
  rejectionReasons: C6SourcePoolRejectionReason[];
  repository: string;
  rowIndex: number;
  testPatchSha256: string;
  version: string;
}

export interface C6SourcePoolSnapshot {
  boundary: {
    acceptedEpisodeCount: 0;
    candidateManifestFrozen: false;
    status: "source-pool-only-origin-and-relationship-review-required";
  };
  counts: {
    observedRows: number;
    queuedForOriginAndRelationshipReview: number;
    rejectedBeforeOriginReview: number;
    repositories: number;
  };
  requiredNextEvidence: typeof REQUIRED_NEXT_EVIDENCE;
  rows: C6SourcePoolSnapshotRow[];
  schemaVersion: 1;
  source: typeof C6_SWE_BENCH_MULTILINGUAL_SOURCE;
}

export async function loadC6SWEbenchMultilingualSourcePool(input: {
  parquetFile: string;
  readmeFile: string;
}): Promise<C6SourcePoolSnapshot> {
  const [parquetBytes, readmeBytes] = await Promise.all([
    readFile(input.parquetFile),
    readFile(input.readmeFile),
  ]);
  assertC6SourcePoolArtifact(
    parquetBytes,
    C6_SWE_BENCH_MULTILINGUAL_SOURCE.artifact,
    "C6 SWE-bench Multilingual parquet",
  );
  assertC6SourcePoolArtifact(
    readmeBytes,
    C6_SWE_BENCH_MULTILINGUAL_SOURCE.datasetCardLicenseEvidence,
    "C6 SWE-bench Multilingual license evidence",
  );
  const rows = await parquetReadObjects({
    file: asyncBufferFromBytes(parquetBytes),
  });
  return buildC6SWEbenchMultilingualSourcePoolSnapshot(rows);
}

export function buildC6SWEbenchMultilingualSourcePoolSnapshot(
  values: readonly unknown[],
): C6SourcePoolSnapshot {
  if (values.length !== 300) {
    throw new Error(
      `C6 SWE-bench Multilingual source pool requires exactly 300 rows; received ${values.length}`,
    );
  }
  const rows = values.map((value) => sourceRowSchema.parse(value));
  const seenInstanceIds = new Set<string>();
  const commitments = rows.map((row, rowIndex) => {
    if (seenInstanceIds.has(row.instance_id)) {
      throw new Error(
        `C6 SWE-bench Multilingual source pool contains duplicate instance_id ${row.instance_id}`,
      );
    }
    seenInstanceIds.add(row.instance_id);
    return commitSourceRow(row, rowIndex);
  });
  const queuedForOriginAndRelationshipReview = commitments.filter((row) =>
    row.decision === "queued-for-origin-and-relationship-review"
  ).length;
  return {
    boundary: {
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      status: "source-pool-only-origin-and-relationship-review-required",
    },
    counts: {
      observedRows: commitments.length,
      queuedForOriginAndRelationshipReview,
      rejectedBeforeOriginReview:
        commitments.length - queuedForOriginAndRelationshipReview,
      repositories: new Set(rows.map((row) => row.repo)).size,
    },
    requiredNextEvidence: REQUIRED_NEXT_EVIDENCE,
    rows: commitments,
    schemaVersion: 1,
    source: C6_SWE_BENCH_MULTILINGUAL_SOURCE,
  };
}

export function serializeC6SourcePoolSnapshot(
  snapshot: C6SourcePoolSnapshot,
): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

export function assertC6SourcePoolArtifact(
  bytes: Uint8Array,
  pin: {
    bytes: number;
    sha256: string;
  },
  label: string,
): void {
  if (bytes.byteLength !== pin.bytes) {
    throw new Error(`${label} does not match its frozen byte length`);
  }
  sha256Schema.parse(pin.sha256);
  if (sha256(bytes) !== pin.sha256) {
    throw new Error(`${label} does not match its frozen bytes`);
  }
}

function commitSourceRow(
  row: z.infer<typeof sourceRowSchema>,
  rowIndex: number,
): C6SourcePoolSnapshotRow {
  const rejectionReasons = sourceRowRejectionReasons(row);
  const failToPassSha256 = sha256(JSON.stringify(row.FAIL_TO_PASS));
  const goldPatchSha256 = sha256(row.patch);
  const passToPassSha256 = sha256(JSON.stringify(row.PASS_TO_PASS));
  const testPatchSha256 = sha256(row.test_patch);
  return {
    agentVisibleRequestSha256: sha256(row.problem_statement),
    baseCommit: row.base_commit,
    createdAt: row.created_at,
    decision: rejectionReasons.length === 0
      ? "queued-for-origin-and-relationship-review"
      : "rejected-before-origin-review",
    evaluatorOnlySha256: sha256(JSON.stringify({
      failToPassSha256,
      goldPatchSha256,
      passToPassSha256,
      testPatchSha256,
    })),
    failToPassSha256,
    goldPatchSha256,
    hintsSha256: sha256(row.hints_text),
    instanceId: row.instance_id,
    normalizedRowSha256: sha256(JSON.stringify(row)),
    passToPassSha256,
    rejectionReasons,
    repository: row.repo,
    rowIndex,
    testPatchSha256,
    version: row.version,
  };
}

function sourceRowRejectionReasons(
  row: z.infer<typeof sourceRowSchema>,
): C6SourcePoolRejectionReason[] {
  const reasons: C6SourcePoolRejectionReason[] = [];
  if (!/^[^/\s]+\/[^/\s]+$/u.test(row.repo)) {
    reasons.push("invalid-repository");
  }
  if (!/^[a-f0-9]{40}$/u.test(row.base_commit)) {
    reasons.push("invalid-base-commit");
  }
  if (
    !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(row.created_at)
  ) {
    reasons.push("invalid-created-at");
  }
  if (row.problem_statement.trim().length === 0) {
    reasons.push("blank-problem-statement");
  }
  if (row.patch.trim().length === 0) {
    reasons.push("blank-gold-patch");
  }
  if (row.test_patch.trim().length === 0) {
    reasons.push("blank-test-patch");
  }
  if (!row.FAIL_TO_PASS.some((value) => value.trim().length > 0)) {
    reasons.push("missing-fail-to-pass");
  }
  if (!row.PASS_TO_PASS.some((value) => value.trim().length > 0)) {
    reasons.push("missing-pass-to-pass");
  }
  return reasons;
}

function asyncBufferFromBytes(bytes: Uint8Array): AsyncBuffer {
  return {
    byteLength: bytes.byteLength,
    slice(start, end = bytes.byteLength) {
      return Uint8Array.from(bytes.subarray(start, end)).buffer;
    },
  };
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
