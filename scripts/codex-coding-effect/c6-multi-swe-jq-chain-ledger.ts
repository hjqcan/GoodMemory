import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { z } from "zod";

import {
  assertC6SourcePoolArtifact,
} from "./c6-source-pool";
import type {
  C6MultiSWEJqSourcePoolRow,
  C6MultiSWEJqSourcePoolSnapshot,
} from "./c6-multi-swe-jq-source-pool";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const commitSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const pullReceiptSchema = z.object({
  base: z.object({
    sha: commitSchema,
  }).passthrough(),
  body: z.string(),
  html_url: z.string().url(),
  merge_commit_sha: commitSchema,
  merged: z.literal(true),
  merged_at: z.string().datetime(),
  number: z.number().int().positive(),
  state: z.literal("closed"),
  title: z.string(),
}).passthrough();
const compareReceiptSchema = z.object({
  ahead_by: z.number().int().positive(),
  base_commit: z.object({
    sha: commitSchema,
  }).passthrough(),
  behind_by: z.literal(0),
  commits: z.array(z.object({
    sha: commitSchema,
  }).passthrough()).min(1),
  merge_base_commit: z.object({
    sha: commitSchema,
  }).passthrough(),
  status: z.literal("ahead"),
  total_commits: z.number().int().positive(),
}).passthrough();

const RECEIPT_PINS = {
  compare2824To2839: {
    bytes: 80_056,
    sha256:
      "57e246de3ab255f0589e2b57c6bb52ac427cd9adc5bd02b3386cade30578f4c1",
  },
  compare2839To2840: {
    bytes: 15_940,
    sha256:
      "3d13bdb94f4e7efa849003dbcd9a1e8f9f1839c32b67e184a158902cae99b417",
  },
  pull2824: {
    bytes: 20_913,
    sha256:
      "78b9a77e6867fad67375ef6362ec96c883f28f2fc4171f2b91b57008eb5bc583",
  },
  pull2839: {
    bytes: 20_599,
    sha256:
      "f44fb13fc42bfe706ec57430c4a28678beec18f8e6d83c8d4c32b3ffbed21c4e",
  },
  pull2840: {
    bytes: 20_763,
    sha256:
      "5bc322bd608638e10d12b4dbc182a82c7a8eec1a94d9785c3cc0eaf0ca763dce",
  },
} as const;
const PROJECT_LICENSE_PIN = {
  baseCommit: "f94a9d463ffb3422861a0da140470dbf5ce76632",
  bytes: 6_026,
  sha256:
    "10e974638a41fadfd72357f2f3a4325e20b856c563365128f72feaa406f8c92d",
  sourceUrl:
    "https://raw.githubusercontent.com/jqlang/jq/f94a9d463ffb3422861a0da140470dbf5ce76632/COPYING",
} as const;

export interface C6MultiSWEJqAncestryObservation {
  compareReceiptSha256: string;
  fromMergeCommit: string;
  fromMergedAt: string;
  fromPrNumber: number;
  fromPullReceiptSha256: string;
  toBaseCommit: string;
  toMergedAt: string;
  toPrNumber: number;
  toPullReceiptSha256: string;
}

export interface C6MultiSWEJqProjectLicenseCapture {
  baseCommit: string;
  bytes: number;
  coverage: "single-base-capture-only";
  reviewVerified: false;
  sha256: string;
  sourceUrl: string;
}

export interface C6MultiSWEJqPairDecision {
  ancestry: {
    direction: {
      fromPrNumber: number;
      toPrNumber: number;
    } | null;
    receipt: {
      compareReceiptSha256: string;
      fromPullReceiptSha256: string;
      toPullReceiptSha256: string;
    } | null;
    status:
      | "local-capture-verified-no-independent-authentication"
      | "not-observed";
  };
  blockers: string[];
  memberPrNumbers: [number, number];
  memberSourceUnitIds: [string, string];
  pairId: string;
  semanticDependency: {
    receiptSha256: null;
    status: "not-reviewed";
  };
}

export interface C6MultiSWEJqChainDecision {
  blockers: string[];
  chainId: string;
  decision: "blocked";
  memberPrNumbers: [number, number, number];
  memberSourceUnitIds: [string, string, string];
  orderedSourceUnitIds: null;
  pairDecisionIds: [string, string, string];
}

export interface C6MultiSWEJqChainDecisionLedger {
  boundary: {
    acceptedEpisodeCount: 0;
    candidateManifestFrozen: false;
    intakeSelectionClosureComplete: false;
    status: "complete-combinatorial-universe-all-chains-blocked";
  };
  chainDecisions: C6MultiSWEJqChainDecision[];
  counts: {
    ancestryObservedPairs: number;
    chainUniverse: 680;
    pairUniverse: 136;
    rowUniverse: 17;
  };
  evidenceBoundary: {
    ancestryCaptureAuthentication:
      "unauthenticated-public-github-api-no-platform-signature";
    independentAncestryAuthenticationVerified: false;
    independentSemanticReviewVerified: false;
    linuxReplayVerified: false;
    projectLicenseCapture: C6MultiSWEJqProjectLicenseCapture;
    projectLicenseReviewVerified: false;
  };
  pairDecisions: C6MultiSWEJqPairDecision[];
  populationSha256: string;
  schemaVersion: 1;
  universe: {
    allCombinationsEnumerated: true;
    chainCombination: "17-choose-3";
    memberSerializationOrder: "ascending-pull-number-not-chronology";
    orderingPolicy:
      "unordered-until-ancestry-and-semantic-dependency-are-both-verified";
    pairCombination: "17-choose-2";
  };
}

export async function loadC6MultiSWEJqAncestryObservations(
  input: {
    compare2824To2839: string;
    compare2839To2840: string;
    pull2824: string;
    pull2839: string;
    pull2840: string;
  },
  sourcePool: C6MultiSWEJqSourcePoolSnapshot,
): Promise<C6MultiSWEJqAncestryObservation[]> {
  const paths = [
    input.pull2824,
    input.pull2839,
    input.pull2840,
    input.compare2824To2839,
    input.compare2839To2840,
  ] as const;
  const values = await Promise.all(paths.map((path) => readFile(path)));
  const [
    pull2824Bytes,
    pull2839Bytes,
    pull2840Bytes,
    compare2824To2839Bytes,
    compare2839To2840Bytes,
  ] = values;
  const receiptBytes = {
    compare2824To2839: compare2824To2839Bytes,
    compare2839To2840: compare2839To2840Bytes,
    pull2824: pull2824Bytes,
    pull2839: pull2839Bytes,
    pull2840: pull2840Bytes,
  };
  for (const name of Object.keys(RECEIPT_PINS) as Array<
    keyof typeof RECEIPT_PINS
  >) {
    assertC6SourcePoolArtifact(
      receiptBytes[name],
      RECEIPT_PINS[name],
      `C6 jq ancestry receipt ${name}`,
    );
  }
  const pulls = new Map([
    [2824, parsePullReceipt(pull2824Bytes, 2824, sourcePool)],
    [2839, parsePullReceipt(pull2839Bytes, 2839, sourcePool)],
    [2840, parsePullReceipt(pull2840Bytes, 2840, sourcePool)],
  ]);
  return [
    buildObservation({
      compareBytes: compare2824To2839Bytes,
      compareValue: compareReceiptSchema.parse(
        JSON.parse(compare2824To2839Bytes.toString("utf8")),
      ),
      from: requiredPull(pulls, 2824),
      fromPullSha256: RECEIPT_PINS.pull2824.sha256,
      to: requiredPull(pulls, 2839),
      toPullSha256: RECEIPT_PINS.pull2839.sha256,
    }),
    buildObservation({
      compareBytes: compare2839To2840Bytes,
      compareValue: compareReceiptSchema.parse(
        JSON.parse(compare2839To2840Bytes.toString("utf8")),
      ),
      from: requiredPull(pulls, 2839),
      fromPullSha256: RECEIPT_PINS.pull2839.sha256,
      to: requiredPull(pulls, 2840),
      toPullSha256: RECEIPT_PINS.pull2840.sha256,
    }),
  ];
}

export async function loadC6MultiSWEJqProjectLicenseCapture(
  path: string,
): Promise<C6MultiSWEJqProjectLicenseCapture> {
  const bytes = await readFile(path);
  assertC6SourcePoolArtifact(
    bytes,
    PROJECT_LICENSE_PIN,
    "C6 jq project license capture",
  );
  return {
    baseCommit: PROJECT_LICENSE_PIN.baseCommit,
    bytes: PROJECT_LICENSE_PIN.bytes,
    coverage: "single-base-capture-only",
    reviewVerified: false,
    sha256: PROJECT_LICENSE_PIN.sha256,
    sourceUrl: PROJECT_LICENSE_PIN.sourceUrl,
  };
}

export function buildC6MultiSWEJqChainDecisionLedger(
  sourcePool: C6MultiSWEJqSourcePoolSnapshot,
  ancestryObservations: readonly C6MultiSWEJqAncestryObservation[],
  projectLicenseCapture: C6MultiSWEJqProjectLicenseCapture,
): C6MultiSWEJqChainDecisionLedger {
  if (sourcePool.rows.length !== 17) {
    throw new Error(
      `C6 jq chain ledger requires exactly 17 source rows; received ${sourcePool.rows.length}`,
    );
  }
  if (
    sourcePool.boundary.acceptedEpisodeCount !== 0 ||
    sourcePool.boundary.candidateManifestFrozen
  ) {
    throw new Error("C6 jq chain ledger requires an unfrozen zero-accept source pool");
  }
  validateProjectLicenseCapture(projectLicenseCapture, sourcePool);
  const rows = [...sourcePool.rows].sort((left, right) =>
    left.upstreamPullNumber - right.upstreamPullNumber
  );
  const rowsByPullNumber = new Map<number, C6MultiSWEJqSourcePoolRow>();
  for (const row of rows) {
    if (rowsByPullNumber.has(row.upstreamPullNumber)) {
      throw new Error(
        `C6 jq chain ledger contains duplicate pull number ${row.upstreamPullNumber}`,
      );
    }
    rowsByPullNumber.set(row.upstreamPullNumber, row);
  }

  const observationsByPairId = new Map<
    string,
    C6MultiSWEJqAncestryObservation
  >();
  for (const observation of ancestryObservations) {
    validateObservation(observation, rowsByPullNumber);
    const pairId = buildPairId(
      observation.fromPrNumber,
      observation.toPrNumber,
    );
    if (observationsByPairId.has(pairId)) {
      throw new Error(`C6 jq chain ledger contains duplicate ancestry ${pairId}`);
    }
    observationsByPairId.set(pairId, observation);
  }

  const pairDecisions: C6MultiSWEJqPairDecision[] = [];
  for (const [leftIndex, left] of rows.entries()) {
    for (const right of rows.slice(leftIndex + 1)) {
      const pairId = buildPairId(
        left.upstreamPullNumber,
        right.upstreamPullNumber,
      );
      const observation = observationsByPairId.get(pairId);
      pairDecisions.push(buildPairDecision(left, right, pairId, observation));
    }
  }
  if (pairDecisions.length !== 136) {
    throw new Error(
      `C6 jq chain ledger pair universe must equal 136; received ${pairDecisions.length}`,
    );
  }
  const pairIds = new Set(pairDecisions.map((value) => value.pairId));
  if (pairIds.size !== pairDecisions.length) {
    throw new Error("C6 jq chain ledger pair universe is not unique");
  }

  const chainDecisions: C6MultiSWEJqChainDecision[] = [];
  for (const [leftIndex, left] of rows.entries()) {
    for (const [middleOffset, middle] of rows.slice(leftIndex + 1).entries()) {
      const middleIndex = leftIndex + middleOffset + 1;
      for (const right of rows.slice(middleIndex + 1)) {
        chainDecisions.push(buildChainDecision(left, middle, right));
      }
    }
  }
  if (chainDecisions.length !== 680) {
    throw new Error(
      `C6 jq chain ledger chain universe must equal 680; received ${chainDecisions.length}`,
    );
  }
  const chainIds = new Set(chainDecisions.map((value) => value.chainId));
  if (chainIds.size !== chainDecisions.length) {
    throw new Error("C6 jq chain ledger chain universe is not unique");
  }
  return {
    boundary: {
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      intakeSelectionClosureComplete: false,
      status: "complete-combinatorial-universe-all-chains-blocked",
    },
    chainDecisions,
    counts: {
      ancestryObservedPairs: observationsByPairId.size,
      chainUniverse: 680,
      pairUniverse: 136,
      rowUniverse: 17,
    },
    evidenceBoundary: {
      ancestryCaptureAuthentication:
        "unauthenticated-public-github-api-no-platform-signature",
      independentAncestryAuthenticationVerified: false,
      independentSemanticReviewVerified: false,
      linuxReplayVerified: false,
      projectLicenseCapture,
      projectLicenseReviewVerified: false,
    },
    pairDecisions,
    populationSha256: sha256(
      `${JSON.stringify(sourcePool, null, 2)}\n`,
    ),
    schemaVersion: 1,
    universe: {
      allCombinationsEnumerated: true,
      chainCombination: "17-choose-3",
      memberSerializationOrder: "ascending-pull-number-not-chronology",
      orderingPolicy:
        "unordered-until-ancestry-and-semantic-dependency-are-both-verified",
      pairCombination: "17-choose-2",
    },
  };
}

export function serializeC6MultiSWEJqChainDecisionLedger(
  ledger: C6MultiSWEJqChainDecisionLedger,
): string {
  return `${JSON.stringify(ledger, null, 2)}\n`;
}

function validateProjectLicenseCapture(
  capture: C6MultiSWEJqProjectLicenseCapture,
  sourcePool: C6MultiSWEJqSourcePoolSnapshot,
): void {
  commitSchema.parse(capture.baseCommit);
  sha256Schema.parse(capture.sha256);
  if (!Number.isInteger(capture.bytes) || capture.bytes < 1) {
    throw new Error("C6 jq project license capture bytes must be positive");
  }
  const sourceRow = sourcePool.rows.find((row) =>
    row.baseCommit === capture.baseCommit
  );
  if (
    sourceRow === undefined ||
    capture.baseCommit !== sourceRow.baseCommit ||
    capture.sourceUrl !==
      `https://raw.githubusercontent.com/jqlang/jq/${capture.baseCommit}/COPYING`
  ) {
    throw new Error(
      "C6 jq project license capture does not match a source base",
    );
  }
  if (
    capture.coverage !== "single-base-capture-only" ||
    capture.reviewVerified
  ) {
    throw new Error(
      "C6 jq project license capture cannot claim complete review",
    );
  }
}

function parsePullReceipt(
  bytes: Uint8Array,
  expectedNumber: number,
  sourcePool: C6MultiSWEJqSourcePoolSnapshot,
) {
  const receipt = pullReceiptSchema.parse(
    JSON.parse(Buffer.from(bytes).toString("utf8")),
  );
  if (
    receipt.number !== expectedNumber ||
    receipt.html_url !== `https://github.com/jqlang/jq/pull/${expectedNumber}`
  ) {
    throw new Error(
      `C6 jq pull receipt ${expectedNumber} has the wrong upstream identity`,
    );
  }
  const sourceRow = sourcePool.rows.find((row) =>
    row.upstreamPullNumber === expectedNumber
  );
  if (sourceRow === undefined) {
    throw new Error(
      `C6 jq pull receipt ${expectedNumber} has no source-pool row`,
    );
  }
  if (receipt.base.sha !== sourceRow.baseCommit) {
    throw new Error(
      `C6 jq pull receipt ${expectedNumber} base does not match its source row`,
    );
  }
  if (
    sha256(receipt.title) !== sourceRow.pullTitleSha256 ||
    sha256(receipt.body) !== sourceRow.pullBodySha256
  ) {
    throw new Error(
      `C6 jq pull receipt ${expectedNumber} request bytes do not match its source row`,
    );
  }
  return receipt;
}

function buildObservation(input: {
  compareBytes: Uint8Array;
  compareValue: z.infer<typeof compareReceiptSchema>;
  from: z.infer<typeof pullReceiptSchema>;
  fromPullSha256: string;
  to: z.infer<typeof pullReceiptSchema>;
  toPullSha256: string;
}): C6MultiSWEJqAncestryObservation {
  const {
    compareBytes,
    compareValue,
    from,
    fromPullSha256,
    to,
    toPullSha256,
  } = input;
  if (
    compareValue.base_commit.sha !== from.merge_commit_sha ||
    compareValue.merge_base_commit.sha !== from.merge_commit_sha ||
    compareValue.commits.at(-1)?.sha !== to.base.sha ||
    compareValue.ahead_by !== compareValue.total_commits
  ) {
    throw new Error(
      `C6 jq compare receipt ${from.number}->${to.number} does not prove the expected ancestry`,
    );
  }
  return {
    compareReceiptSha256: sha256(compareBytes),
    fromMergeCommit: from.merge_commit_sha,
    fromMergedAt: from.merged_at,
    fromPrNumber: from.number,
    fromPullReceiptSha256: fromPullSha256,
    toBaseCommit: to.base.sha,
    toMergedAt: to.merged_at,
    toPrNumber: to.number,
    toPullReceiptSha256: toPullSha256,
  };
}

function requiredPull(
  pulls: ReadonlyMap<number, z.infer<typeof pullReceiptSchema>>,
  number: number,
) {
  const receipt = pulls.get(number);
  if (receipt === undefined) {
    throw new Error(`C6 jq pull receipt ${number} is missing`);
  }
  return receipt;
}

function validateObservation(
  observation: C6MultiSWEJqAncestryObservation,
  rowsByPullNumber: ReadonlyMap<number, C6MultiSWEJqSourcePoolRow>,
): void {
  sha256Schema.parse(observation.compareReceiptSha256);
  sha256Schema.parse(observation.fromPullReceiptSha256);
  sha256Schema.parse(observation.toPullReceiptSha256);
  commitSchema.parse(observation.fromMergeCommit);
  commitSchema.parse(observation.toBaseCommit);
  if (observation.fromPrNumber === observation.toPrNumber) {
    throw new Error("C6 jq ancestry observation cannot be a self pair");
  }
  const fromRow = rowsByPullNumber.get(observation.fromPrNumber);
  const toRow = rowsByPullNumber.get(observation.toPrNumber);
  if (fromRow === undefined || toRow === undefined) {
    throw new Error("C6 jq ancestry observation is outside the source population");
  }
  if (toRow.baseCommit !== observation.toBaseCommit) {
    throw new Error(
      `C6 jq ancestry ${observation.fromPrNumber}->${observation.toPrNumber} does not match the destination source row`,
    );
  }
  const fromTime = Date.parse(observation.fromMergedAt);
  const toTime = Date.parse(observation.toMergedAt);
  if (
    !Number.isFinite(fromTime) ||
    !Number.isFinite(toTime) ||
    fromTime >= toTime
  ) {
    throw new Error(
      `C6 jq ancestry ${observation.fromPrNumber}->${observation.toPrNumber} violates merged-at chronology`,
    );
  }
}

function buildPairDecision(
  left: C6MultiSWEJqSourcePoolRow,
  right: C6MultiSWEJqSourcePoolRow,
  pairId: string,
  observation?: C6MultiSWEJqAncestryObservation,
): C6MultiSWEJqPairDecision {
  return {
    ancestry: observation === undefined
      ? {
        direction: null,
        receipt: null,
        status: "not-observed",
      }
      : {
        direction: {
          fromPrNumber: observation.fromPrNumber,
          toPrNumber: observation.toPrNumber,
        },
        receipt: {
          compareReceiptSha256: observation.compareReceiptSha256,
          fromPullReceiptSha256: observation.fromPullReceiptSha256,
          toPullReceiptSha256: observation.toPullReceiptSha256,
        },
        status: "local-capture-verified-no-independent-authentication",
      },
    blockers: [
      observation === undefined
        ? "commit-ancestry-not-observed"
        : "commit-ancestry-not-independently-authenticated",
      "semantic-dependency-not-reviewed",
      "task-origin-not-independently-authenticated",
      "linux-replay-not-run",
      "historical-project-license-not-reviewed",
      "cross-source-duplicate-review-not-run",
    ],
    memberPrNumbers: [
      left.upstreamPullNumber,
      right.upstreamPullNumber,
    ],
    memberSourceUnitIds: [
      left.sourceUnitId,
      right.sourceUnitId,
    ],
    pairId,
    semanticDependency: {
      receiptSha256: null,
      status: "not-reviewed",
    },
  };
}

function buildChainDecision(
  left: C6MultiSWEJqSourcePoolRow,
  middle: C6MultiSWEJqSourcePoolRow,
  right: C6MultiSWEJqSourcePoolRow,
): C6MultiSWEJqChainDecision {
  const memberPrNumbers: [number, number, number] = [
    left.upstreamPullNumber,
    middle.upstreamPullNumber,
    right.upstreamPullNumber,
  ];
  return {
    blockers: [
      "ordered-stage-relation-not-established",
      "complete-two-edge-ancestry-not-independently-verified",
      "semantic-dependency-not-reviewed",
      "task-origin-not-independently-authenticated",
      "linux-replay-not-run",
      "historical-project-license-not-reviewed",
      "cross-source-duplicate-review-not-run",
      "deterministic-prehistory-not-materialized",
    ],
    chainId: `jq-chain-${memberPrNumbers.join("-")}`,
    decision: "blocked",
    memberPrNumbers,
    memberSourceUnitIds: [
      left.sourceUnitId,
      middle.sourceUnitId,
      right.sourceUnitId,
    ],
    orderedSourceUnitIds: null,
    pairDecisionIds: [
      buildPairId(left.upstreamPullNumber, middle.upstreamPullNumber),
      buildPairId(left.upstreamPullNumber, right.upstreamPullNumber),
      buildPairId(middle.upstreamPullNumber, right.upstreamPullNumber),
    ],
  };
}

function buildPairId(left: number, right: number): string {
  const [first, second] = [left, right].sort((a, b) => a - b);
  return `jq-pair-${first}-${second}`;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
