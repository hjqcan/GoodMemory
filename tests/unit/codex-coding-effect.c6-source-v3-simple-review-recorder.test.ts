import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "bun:test";

import {
  C6_SOURCE_V3_SIMPLE_REVIEW_PATHS,
  C6_SOURCE_V3_SIMPLE_REVIEW_REQUIRED_CHECKS,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-review";
import {
  parseC6SourceV3SimpleReviewProvenanceCliOptions,
  recordC6SourceV3SimpleReviewProvenance,
} from "../../scripts/record-codex-coding-effect-c6-source-v3-simple-review-provenance";
import {
  prepareC6SourceV3SimpleReview,
} from "../../scripts/prepare-codex-coding-effect-c6-source-v3-simple-review";

const AUTHOR = "/root";
const REVIEWER = "/root/c6_source_v3_simple_review_v1";
const REVIEWED_AT = "2026-07-25T12:34:56.000Z";
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true })
    ),
  );
});

describe("C6 source-v3-simple review provenance recorder", () => {
  it("parses only identity and output-root options", () => {
    expect(
      parseC6SourceV3SimpleReviewProvenanceCliOptions([
        `--author-task-name=${AUTHOR}`,
        "--output-root=/tmp/c6-source-v3-review",
        `--reviewer-agent-name=${REVIEWER}`,
      ]),
    ).toEqual({
      authorTaskName: AUTHOR,
      outputRoot: "/tmp/c6-source-v3-review",
      reviewerAgentName: REVIEWER,
    });
    expect(() =>
      parseC6SourceV3SimpleReviewProvenanceCliOptions([
        `--author-task-name=${AUTHOR}`,
        "--output-root=/tmp/c6-source-v3-review",
        "--recorded-at=2026-07-25T00:00:00.000Z",
        `--reviewer-agent-name=${REVIEWER}`,
      ])
    ).toThrow("unknown");
  });

  it("records one non-authorizing provenance receipt from the exact response", async () => {
    const outputRoot = await preparedReviewRoot();
    const responseBytes = await writeAcceptedResponse(outputRoot);
    const result = await recordC6SourceV3SimpleReviewProvenance({
      authorTaskName: AUTHOR,
      outputRoot,
      repositoryRoot: process.cwd(),
      reviewerAgentName: REVIEWER,
    });
    const provenanceBytes = await readFile(
      join(outputRoot, C6_SOURCE_V3_SIMPLE_REVIEW_PATHS.provenance),
    );
    const provenance = JSON.parse(
      provenanceBytes.toString("utf8"),
    ) as {
      recordedAt: string;
      reviewer: {
        agentName: string;
        orchestratorAttestation: {
          cryptographicReceipt: boolean;
        };
      };
    };

    expect(result).toEqual({
      independenceVerified: false,
      outputRoot,
      promotionReceiptComplete: false,
      provenanceSha256: sha256(provenanceBytes),
      reviewReceiptStructureVerified: true,
      sourceV3SimpleFrozen: false,
    });
    expect(provenance).toMatchObject({
      recordedAt: REVIEWED_AT,
      reviewer: {
        agentName: REVIEWER,
        orchestratorAttestation: {
          cryptographicReceipt: false,
        },
      },
    });
    expect(
      await readFile(
        join(outputRoot, C6_SOURCE_V3_SIMPLE_REVIEW_PATHS.response),
      ),
    ).toEqual(Buffer.from(responseBytes));
  });

  it("does not publish provenance for a forged authority response", async () => {
    const outputRoot = await preparedReviewRoot();
    const responseBytes = JSON.parse(
      await acceptedResponse(outputRoot),
    ) as Record<string, unknown>;
    responseBytes.promotionReceiptComplete = true;
    await writeFile(
      join(outputRoot, C6_SOURCE_V3_SIMPLE_REVIEW_PATHS.response),
      canonicalJson(responseBytes),
      { flag: "wx" },
    );

    await expect(
      recordC6SourceV3SimpleReviewProvenance({
        authorTaskName: AUTHOR,
        outputRoot,
        repositoryRoot: process.cwd(),
        reviewerAgentName: REVIEWER,
      }),
    ).rejects.toThrow();
    await expect(
      stat(join(
        outputRoot,
        C6_SOURCE_V3_SIMPLE_REVIEW_PATHS.provenance,
      )),
    ).rejects.toThrow();
  });
});

async function preparedReviewRoot(): Promise<string> {
  const outputRoot = await temporaryRoot();
  await prepareC6SourceV3SimpleReview({
    authorTaskName: AUTHOR,
    outputRoot,
    repositoryRoot: process.cwd(),
    reviewerAgentName: REVIEWER,
  });
  return outputRoot;
}

async function writeAcceptedResponse(
  outputRoot: string,
): Promise<string> {
  const responseBytes = await acceptedResponse(outputRoot);
  await writeFile(
    join(outputRoot, C6_SOURCE_V3_SIMPLE_REVIEW_PATHS.response),
    responseBytes,
    { flag: "wx" },
  );
  return responseBytes;
}

async function acceptedResponse(
  outputRoot: string,
): Promise<string> {
  const [dispatchBytes, inputBytes, requestBytes] =
    await Promise.all([
      readFile(join(
        outputRoot,
        C6_SOURCE_V3_SIMPLE_REVIEW_PATHS.dispatch,
      )),
      readFile(join(
        outputRoot,
        C6_SOURCE_V3_SIMPLE_REVIEW_PATHS.input,
      )),
      readFile(join(
        outputRoot,
        C6_SOURCE_V3_SIMPLE_REVIEW_PATHS.request,
      )),
    ]);
  return canonicalJson({
    acceptedChecks: C6_SOURCE_V3_SIMPLE_REVIEW_REQUIRED_CHECKS,
    artifactKind: "c6-source-v3-simple-review-response",
    blockingFindings: [],
    boundary: {
      candidateManifestFrozen: false,
      codexRunReady: false,
      formalCensusPermitted: false,
      sourceV3SimpleFrozen: false,
      status:
        "protocol-review-accepted-freeze-and-promotion-receipt-still-required",
    },
    decision: "accepted-for-freeze-preparation",
    dispatchSha256: sha256(dispatchBytes),
    inputSha256: sha256(inputBytes),
    requestSha256: sha256(requestBytes),
    reviewedAt: REVIEWED_AT,
    reviewerAgentName: REVIEWER,
    schemaVersion: 1,
  });
}

async function temporaryRoot(): Promise<string> {
  const root = await realpath(
    await mkdtemp(
      join(tmpdir(), "goodmemory-c6-source-v3-review-record-"),
    ),
  );
  temporaryRoots.push(root);
  return root;
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
