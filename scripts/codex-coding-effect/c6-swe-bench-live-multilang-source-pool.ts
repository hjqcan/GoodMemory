import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { AsyncBuffer } from "hyparquet";
import { parquetReadObjects } from "hyparquet";
import { z } from "zod";

const REVISION = "608f7ae9ab8ea1f9f0d030fe04562cf6bd1a0c8b";
const DATASET_ID = "SWE-bench-Live/MultiLang";
const SPLIT_COUNTS = {
  c: 37,
  cpp: 74,
  go: 138,
  js: 93,
  rust: 94,
  java: 109,
  ts: 111,
  cs: 87,
} as const;
const SPLIT_ORDER = Object.keys(SPLIT_COUNTS) as Array<
  keyof typeof SPLIT_COUNTS
>;
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const sourceRowSchema = z.object({
  all_hints_text: z.string(),
  base_commit: z.string().regex(/^[a-f0-9]{40}$/u),
  commit_url: z.string(),
  commit_urls: z.array(z.string()),
  created_at: z.iso.datetime(),
  docker_image: z.string(),
  FAIL_TO_PASS: z.array(z.string()),
  hints_text: z.string(),
  instance_id: z.string().min(1),
  issue_numbers: z.array(z.string()),
  log_parser: z.string(),
  PASS_TO_PASS: z.array(z.string()),
  patch: z.string(),
  print_cmds: z.array(z.string()),
  problem_statement: z.string(),
  pull_number: z.string().regex(/^[1-9]\d*$/u),
  rebuild_cmds: z.array(z.string()),
  repo: z.string().regex(/^[^/#\s]+\/[^/#\s]+$/u),
  test_cmds: z.array(z.string()),
  test_patch: z.string(),
}).strict();

export const C6_SWE_BENCH_LIVE_MULTILANG_SOURCE = {
  artifacts: [{
    bytes: 8_872_150,
    path: "data/c-00000-of-00001.parquet",
    sha256:
      "0d3b31cc38c807160e3fef132ed0f86b1e33890a842372894c2340ad08794674",
    split: "c",
  }, {
    bytes: 14_859_228,
    path: "data/cpp-00000-of-00001.parquet",
    sha256:
      "5afc7db10f28232cc9c13de316ecec146f2da4c76de3bb460b934f5e271b0ec0",
    split: "cpp",
  }, {
    bytes: 47_688_780,
    path: "data/go-00000-of-00001.parquet",
    sha256:
      "76d2b5dff0f3fac8303d30fa85495539e487d25974ad7c21cd21a545cb4756e2",
    split: "go",
  }, {
    bytes: 31_582_998,
    path: "data/js-00000-of-00001.parquet",
    sha256:
      "2b4d3e0707e141e1681e82e3385855a045cb0496b2b0455838c16bd364454387",
    split: "js",
  }, {
    bytes: 23_514_041,
    path: "data/rust-00000-of-00001.parquet",
    sha256:
      "ea90be54a621c0c0280b77d5e2dee9650bc1d4ae087f9b9b06af821bcd8662d7",
    split: "rust",
  }, {
    bytes: 56_428_398,
    path: "data/java-00000-of-00001.parquet",
    sha256:
      "cc04473f299dbdbbb6c4061da3c68367cd460e28e40c04234f4887e0fc234220",
    split: "java",
  }, {
    bytes: 31_013_117,
    path: "data/ts-00000-of-00001.parquet",
    sha256:
      "7e23783e27230c9cfab1035690035c25523043d6af635bc78da3fd2010c32714",
    split: "ts",
  }, {
    bytes: 52_506_516,
    path: "data/cs-00000-of-00001.parquet",
    sha256:
      "db9ce6a9f0e040577479763daacf0e8e0d3011253af925450b8a8a9f45d2128f",
    split: "cs",
  }] as const,
  datasetCardLicense: "MIT",
  datasetCardLicenseEvidence: {
    bytes: 2_546,
    path: "README.md",
    sha256:
      "d2f422af48ee9b0624510208aa8968dd18d4362dabb0b9cbf06c2e06e9b26adc",
  },
  datasetId: DATASET_ID,
  format: "parquet",
  revision: REVISION,
  splitOrder: SPLIT_ORDER,
  webpage:
    "https://huggingface.co/datasets/SWE-bench-Live/MultiLang",
} as const;

export interface C6SWEbenchLiveMultiLangSourceRow {
  agentVisibleRequestSha256: string;
  baseCommit: string;
  createdAt: string;
  evaluatorOnlySha256: string;
  instanceId: string;
  normalizedRowSha256: string;
  pullNumber: number;
  repository: string;
  rowIndex: number;
  sourceSplit: keyof typeof SPLIT_COUNTS;
  sourceSplitRowIndex: number;
}

export interface C6SWEbenchLiveMultiLangSourcePool {
  artifactKind: "c6-swe-bench-live-multilang-source-pool";
  boundary: {
    acceptedEpisodeCount: 0;
    candidateManifestFrozen: false;
    codexRunReady: false;
    status: "source-pool-only-graphql-capture-required";
  };
  counts: {
    observedRows: 743;
    repositories: number;
    splits: 8;
  };
  independenceBoundary: {
    captureTargetProjectionSha256: string;
    evaluatorFieldSelectionInput: false;
    machineOutcomeInput: false;
    selection: "all-frozen-source-rows";
    semanticLedgerInput: false;
  };
  rows: C6SWEbenchLiveMultiLangSourceRow[];
  schemaVersion: 1;
  source: typeof C6_SWE_BENCH_LIVE_MULTILANG_SOURCE;
}

export async function loadC6SWEbenchLiveMultiLangSourcePool(input: {
  sourceRoot: string;
}): Promise<C6SWEbenchLiveMultiLangSourcePool> {
  const readmeBytes = await readFile(join(input.sourceRoot, "README.md"));
  assertArtifact(
    readmeBytes,
    C6_SWE_BENCH_LIVE_MULTILANG_SOURCE.datasetCardLicenseEvidence,
    "C6 SWE-bench-Live MultiLang dataset card",
  );
  const rowsBySplit = {} as Record<
    keyof typeof SPLIT_COUNTS,
    unknown[]
  >;
  for (const artifact of C6_SWE_BENCH_LIVE_MULTILANG_SOURCE.artifacts) {
    const bytes = await readFile(join(input.sourceRoot, artifact.path));
    assertArtifact(
      bytes,
      artifact,
      `C6 SWE-bench-Live MultiLang ${artifact.split} parquet`,
    );
    rowsBySplit[artifact.split] = await parquetReadObjects({
      file: asyncBufferFromBytes(bytes),
    });
  }
  return buildC6SWEbenchLiveMultiLangSourcePoolSnapshot(rowsBySplit);
}

export function buildC6SWEbenchLiveMultiLangSourcePoolSnapshot(
  valuesBySplit: Readonly<Record<
    keyof typeof SPLIT_COUNTS,
    readonly unknown[]
  >>,
): C6SWEbenchLiveMultiLangSourcePool {
  const seenAnchors = new Set<string>();
  const seenInstances = new Set<string>();
  const rows: C6SWEbenchLiveMultiLangSourceRow[] = [];
  for (const split of SPLIT_ORDER) {
    const values = valuesBySplit[split];
    if (values.length !== SPLIT_COUNTS[split]) {
      throw new Error(
        `C6 SWE-bench-Live MultiLang ${split} requires ${
          SPLIT_COUNTS[split]
        } rows; received ${values.length}`,
      );
    }
    values.forEach((value, sourceSplitRowIndex) => {
      const row = sourceRowSchema.parse(value);
      const pullNumber = Number(row.pull_number);
      const anchor = `${row.repo}#${pullNumber}`.toLowerCase();
      const expectedInstanceId =
        `${row.repo.replace("/", "__")}-${row.pull_number}`;
      if (
        !Number.isSafeInteger(pullNumber) ||
        seenAnchors.has(anchor) ||
        seenInstances.has(row.instance_id) ||
        row.instance_id !== expectedInstanceId
      ) {
        throw new Error(
          `C6 SWE-bench-Live MultiLang duplicate source identity ${
            row.instance_id
          }`,
        );
      }
      seenAnchors.add(anchor);
      seenInstances.add(row.instance_id);
      rows.push(commitRow(
        row,
        rows.length,
        split,
        sourceSplitRowIndex,
      ));
    });
  }
  if (rows.length !== 743) {
    throw new Error(
      "C6 SWE-bench-Live MultiLang source population must be 743 rows",
    );
  }
  return {
    artifactKind: "c6-swe-bench-live-multilang-source-pool",
    boundary: {
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      codexRunReady: false,
      status: "source-pool-only-graphql-capture-required",
    },
    counts: {
      observedRows: 743,
      repositories: new Set(
        rows.map((row) => row.repository.toLowerCase()),
      ).size,
      splits: 8,
    },
    independenceBoundary: {
      captureTargetProjectionSha256: sha256(JSON.stringify(
        rows.map((row) => ({
          agentVisibleRequestSha256: row.agentVisibleRequestSha256,
          instanceId: row.instanceId,
          pullNumber: row.pullNumber,
          repository: row.repository,
          rowIndex: row.rowIndex,
          sourceSplit: row.sourceSplit,
          sourceSplitRowIndex: row.sourceSplitRowIndex,
        })),
      )),
      evaluatorFieldSelectionInput: false,
      machineOutcomeInput: false,
      selection: "all-frozen-source-rows",
      semanticLedgerInput: false,
    },
    rows,
    schemaVersion: 1,
    source: C6_SWE_BENCH_LIVE_MULTILANG_SOURCE,
  };
}

export function serializeC6SWEbenchLiveMultiLangSourcePool(
  snapshot: C6SWEbenchLiveMultiLangSourcePool,
): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

function commitRow(
  row: z.infer<typeof sourceRowSchema>,
  rowIndex: number,
  sourceSplit: keyof typeof SPLIT_COUNTS,
  sourceSplitRowIndex: number,
): C6SWEbenchLiveMultiLangSourceRow {
  return {
    agentVisibleRequestSha256: sha256(row.problem_statement),
    baseCommit: row.base_commit,
    createdAt: row.created_at,
    evaluatorOnlySha256: sha256(JSON.stringify({
      allHintsText: row.all_hints_text,
      failToPass: row.FAIL_TO_PASS,
      hintsText: row.hints_text,
      passToPass: row.PASS_TO_PASS,
      patch: row.patch,
      testPatch: row.test_patch,
    })),
    instanceId: row.instance_id,
    normalizedRowSha256: sha256(JSON.stringify(row)),
    pullNumber: Number(row.pull_number),
    repository: row.repo,
    rowIndex,
    sourceSplit,
    sourceSplitRowIndex,
  };
}

function assertArtifact(
  bytes: Uint8Array,
  artifact: { bytes: number; sha256: string },
  label: string,
): void {
  sha256Schema.parse(artifact.sha256);
  if (
    bytes.byteLength !== artifact.bytes ||
    sha256(bytes) !== artifact.sha256
  ) {
    throw new Error(`${label} does not match frozen bytes`);
  }
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
