import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import { z } from "zod";

import {
  assertC6NoSymlinkPathComponents,
  readC6StableRegularFile,
} from "./c6-asset-lock";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const resultSchema = z.object({
  canonicalAnchorId: z.string().min(1),
  captureDirectory: z.string().min(1),
  captureOrder: z.number().int().positive(),
  requestedAnchorId: z.string().min(1),
  status: z.enum([
    "broad-structural-pretarget",
    "no-broad-structural-sequence",
    "prior-frame-overlap",
    "unsupported-pagination",
  ]),
}).passthrough();
const expansionSchema = z.object({
  artifactKind: z.literal(
    "c6-multilingual-review-trajectory-expansion",
  ),
  boundary: z.object({
    acceptedEpisodeCount: z.literal(0),
    candidateManifestFrozen: z.literal(false),
    codexRunReady: z.literal(false),
    machineQualifiedEpisodeCount: z.literal(0),
    pullAuthorQualified: z.literal(false),
  }).passthrough(),
  counts: z.object({
    broadStructuralPretargetCount: z.number().int().nonnegative(),
    freshBroadStructuralPretargetCount: z.number().int().nonnegative(),
    priorFrameOverlapCount: z.number().int().nonnegative(),
    sourceTargetCount: z.number().int().positive(),
  }).passthrough(),
  independenceBoundary: z.object({
    broadPretargetProjectionSha256: sha256Schema,
    evaluatorFieldInput: z.literal(false),
    machineOutcomeInput: z.literal(false),
    semanticLedgerInput: z.literal(false),
    sourceOrderChanged: z.literal(false),
  }).passthrough(),
  results: z.array(resultSchema).min(1),
  schemaVersion: z.literal(1),
}).passthrough();

export interface C6MultilingualRestIdentityPlan {
  artifactKind: "c6-rest-identity-supplement-plan";
  boundary: {
    acceptedEpisodeCount: 0;
    candidateManifestFrozen: false;
    captureExecuted: false;
    codexRunReady: false;
    status: "multilingual-pull-identity-capture-plan-only";
  };
  counts: {
    originalTargetCount: number;
    supplementRepositoryCount: number;
    supplementTargetCount: number;
  };
  independenceBoundary: {
    candidateOrderChanged: false;
    machineOutcomeInput: false;
    originalTargetProjectionSha256: string;
    retryTargetingDependsOnMissingClosure: false;
    semanticLedgerInput: false;
    supplementTargetProjectionSha256: string;
  };
  inputs: {
    expansion: {
      bytes: number;
      path: string;
      sha256: string;
    };
  };
  rule: {
    endpoint: "GET /repos/{owner}/{repo}/pulls/{pull_number}";
    order: "original-captureOrder-ascending";
    purpose:
      "pull-author-and-canonical-identity-only-no-comment-enumeration";
    selection:
      "all-broad-structural-pretargets-including-prior-frame-overlaps";
  };
  schemaVersion: 1;
  targets: Array<{
    anchorId: string;
    canonicalAnchorId: string;
    canonicalOwner: string;
    canonicalRepository: string;
    captureDirectory: string;
    originalCaptureOrder: number;
    pullNumber: number;
    supplementOrder: number;
  }>;
}

export function projectC6MultilingualRestIdentityPlan(input: {
  expansionBytes: Uint8Array;
  expansionPath: string;
}): C6MultilingualRestIdentityPlan {
  const expansionBytes = Buffer.from(input.expansionBytes);
  const rawExpansion = parseJson(expansionBytes, "expansion");
  const expansion = expansionSchema.parse(rawExpansion);
  const results = [...expansion.results].sort(
    (left, right) => left.captureOrder - right.captureOrder,
  );
  assertContiguousOrder(results.map((result) => result.captureOrder));
  const broad = results.filter((result) =>
    result.status === "broad-structural-pretarget" ||
    result.status === "prior-frame-overlap"
  );
  const freshCount = broad.filter(
    (result) => result.status === "broad-structural-pretarget",
  ).length;
  const overlapCount = broad.length - freshCount;
  if (
    results.length !== expansion.counts.sourceTargetCount ||
    broad.length !== expansion.counts.broadStructuralPretargetCount ||
    freshCount !== expansion.counts.freshBroadStructuralPretargetCount ||
    overlapCount !== expansion.counts.priorFrameOverlapCount
  ) {
    throw new Error(
      "C6 multilingual REST identity plan expansion count mismatch",
    );
  }
  const targets = broad.map((result, index) => {
    const requested = parseAnchor(result.requestedAnchorId);
    const canonical = parseAnchor(result.canonicalAnchorId);
    if (requested.pullNumber !== canonical.pullNumber) {
      throw new Error(
        `C6 multilingual REST identity plan pull mismatch ${
          result.requestedAnchorId
        }`,
      );
    }
    const [canonicalOwner, canonicalRepository] =
      canonical.repository.split("/");
    return {
      anchorId: result.requestedAnchorId,
      canonicalAnchorId:
        `${canonical.repository}#${canonical.pullNumber}`,
      canonicalOwner: canonicalOwner!,
      canonicalRepository: canonicalRepository!,
      captureDirectory: result.captureDirectory,
      originalCaptureOrder: result.captureOrder,
      pullNumber: canonical.pullNumber,
      supplementOrder: index + 1,
    };
  });
  const directories = new Set(
    targets.map((target) => target.captureDirectory),
  );
  if (directories.size !== targets.length) {
    throw new Error(
      "C6 multilingual REST identity plan duplicate capture directory",
    );
  }
  return {
    artifactKind: "c6-rest-identity-supplement-plan",
    boundary: {
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      captureExecuted: false,
      codexRunReady: false,
      status: "multilingual-pull-identity-capture-plan-only",
    },
    counts: {
      originalTargetCount: results.length,
      supplementRepositoryCount: new Set(
        targets.map((target) =>
          `${target.canonicalOwner}/${target.canonicalRepository}`
        ),
      ).size,
      supplementTargetCount: targets.length,
    },
    independenceBoundary: {
      candidateOrderChanged: false,
      machineOutcomeInput: false,
      originalTargetProjectionSha256:
        expansion.independenceBoundary.broadPretargetProjectionSha256,
      retryTargetingDependsOnMissingClosure: false,
      semanticLedgerInput: false,
      supplementTargetProjectionSha256:
        sha256(JSON.stringify(targets)),
    },
    inputs: {
      expansion: {
        bytes: expansionBytes.byteLength,
        path: basename(input.expansionPath),
        sha256: sha256(expansionBytes),
      },
    },
    rule: {
      endpoint: "GET /repos/{owner}/{repo}/pulls/{pull_number}",
      order: "original-captureOrder-ascending",
      purpose:
        "pull-author-and-canonical-identity-only-no-comment-enumeration",
      selection:
        "all-broad-structural-pretargets-including-prior-frame-overlaps",
    },
    schemaVersion: 1,
    targets,
  };
}

export function serializeC6MultilingualRestIdentityPlan(
  plan: C6MultilingualRestIdentityPlan,
): string {
  return `${JSON.stringify(plan, null, 2)}\n`;
}

export async function materializeC6MultilingualRestIdentityPlan(input: {
  expectedExpansionSha256: string;
  expansionPath: string;
  outputPath: string;
}): Promise<{
  outputSha256: string;
  plan: C6MultilingualRestIdentityPlan;
}> {
  const expectedExpansionSha256 = sha256Schema.parse(
    input.expectedExpansionSha256,
  );
  const expansionPath = await assertC6NoSymlinkPathComponents(
    input.expansionPath,
    "C6 multilingual REST identity expansion",
  );
  const expansionBytes = await readC6StableRegularFile(
    expansionPath,
    "multilingual REST identity expansion",
  );
  if (sha256(expansionBytes) !== expectedExpansionSha256) {
    throw new Error(
      "C6 multilingual REST identity expansion hash mismatch",
    );
  }
  const plan = projectC6MultilingualRestIdentityPlan({
    expansionBytes,
    expansionPath,
  });
  const terminalExpansionBytes = await readC6StableRegularFile(
    expansionPath,
    "multilingual REST identity terminal expansion",
  );
  if (!terminalExpansionBytes.equals(expansionBytes)) {
    throw new Error(
      "C6 multilingual REST identity expansion changed during projection",
    );
  }
  const serialized = serializeC6MultilingualRestIdentityPlan(plan);
  const outputPath = resolve(input.outputPath);
  await assertC6NoSymlinkPathComponents(
    dirname(outputPath),
    "C6 multilingual REST identity output parent",
  );
  const handle = await open(outputPath, "wx", 0o644);
  try {
    await handle.writeFile(serialized, "utf8");
  } finally {
    await handle.close();
  }
  return {
    outputSha256: sha256(serialized),
    plan,
  };
}

function assertContiguousOrder(values: readonly number[]): void {
  for (const [index, value] of values.entries()) {
    if (value !== index + 1) {
      throw new Error(
        "C6 multilingual REST identity capture order must be contiguous",
      );
    }
  }
}

function parseAnchor(value: string): {
  pullNumber: number;
  repository: string;
} {
  const match = /^([^/#\s]+\/[^/#\s]+)#([1-9]\d*)$/u.exec(
    value.toLowerCase(),
  );
  if (match === null) {
    throw new Error(
      `C6 multilingual REST identity invalid anchor ${value}`,
    );
  }
  return {
    pullNumber: Number(match[2]),
    repository: match[1]!,
  };
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch {
    throw new Error(
      `C6 multilingual REST identity invalid ${label} JSON`,
    );
  }
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
