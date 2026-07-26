import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "bun:test";

import {
  C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_PATHS,
  C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_REQUIRED_CHECKS,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-prior-identity-replay-review";
import {
  parseC6SourceV3SimplePriorIdentityReplayReviewPreparationCliOptions,
  prepareC6SourceV3SimplePriorIdentityReplayReview,
} from "../../scripts/prepare-codex-coding-effect-c6-source-v3-simple-prior-identity-replay-review";
import {
  parseC6SourceV3SimplePriorIdentityReplayReviewProvenanceCliOptions,
  recordC6SourceV3SimplePriorIdentityReplayReviewProvenance,
} from "../../scripts/record-codex-coding-effect-c6-source-v3-simple-prior-identity-replay-review-provenance";

const AUTHOR = "/root";
const REVIEWER =
  "/root/c6_source_v3_simple_prior_identity_replay_review_v1";
const REVIEWED_AT = "2026-07-26T14:00:00.000Z";
const CAPTURE_A =
  "/private/tmp/goodmemory-c6-source-v3-simple-prior-identity-live-20260725-v1";
const CAPTURE_B =
  "/private/tmp/goodmemory-c6-source-v3-simple-prior-identity-live-20260725-v2";
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true })
    ),
  );
});

describe("C6 prior identity replay review materializers", () => {
  it("parses only the create-only preparation and provenance options", () => {
    const args = [
      `--author-task-name=${AUTHOR}`,
      `--capture-a=${CAPTURE_A}`,
      `--capture-b=${CAPTURE_B}`,
      "--output-root=/tmp/c6-prior-identity-replay-review",
      `--reviewer-agent-name=${REVIEWER}`,
    ];
    const expected = {
      authorTaskName: AUTHOR,
      captureA: CAPTURE_A,
      captureB: CAPTURE_B,
      outputRoot: "/tmp/c6-prior-identity-replay-review",
      reviewerAgentName: REVIEWER,
    };

    expect(
      parseC6SourceV3SimplePriorIdentityReplayReviewPreparationCliOptions(
        args,
      ),
    ).toEqual(expected);
    expect(
      parseC6SourceV3SimplePriorIdentityReplayReviewProvenanceCliOptions(
        args,
      ),
    ).toEqual(expected);
    expect(() =>
      parseC6SourceV3SimplePriorIdentityReplayReviewPreparationCliOptions([
        ...args,
        "--replace",
      ])
    ).toThrow("unknown");
    expect(() =>
      parseC6SourceV3SimplePriorIdentityReplayReviewProvenanceCliOptions([
        ...args,
        "--response=/tmp/forged.json",
      ])
    ).toThrow("unknown");
  });

  it("writes and rereads only input, request, and dispatch create-only", async () => {
    const outputRoot = await temporaryRoot();
    const input = {
      authorTaskName: AUTHOR,
      captureA: CAPTURE_A,
      captureB: CAPTURE_B,
      outputRoot,
      repositoryRoot: process.cwd(),
      reviewerAgentName: REVIEWER,
    };
    const result =
      await prepareC6SourceV3SimplePriorIdentityReplayReview(
        input,
      );
    const reviewRoot = join(
      outputRoot,
      "provenance/source-v3-simple/" +
        "prior-repository-identity/review",
    );
    const entries = (await readdir(reviewRoot)).sort();
    const [dispatchBytes, inputBytes, requestBytes] =
      await Promise.all([
        readFile(join(
          outputRoot,
          C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_PATHS.dispatch,
        )),
        readFile(join(
          outputRoot,
          C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_PATHS.input,
        )),
        readFile(join(
          outputRoot,
          C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_PATHS.request,
        )),
      ]);

    expect(entries).toEqual([
      "dispatch.json",
      "input.json",
      "request.json",
    ]);
    expect(result).toMatchObject({
      dispatchSha256: sha256(dispatchBytes),
      formalCensusPermitted: false,
      inputSha256: sha256(inputBytes),
      localReplayReviewAccepted: false,
      provenanceMaterialized: false,
      requestSha256: sha256(requestBytes),
      responseMaterialized: false,
      reviewRoot,
      sourceV3SimpleFrozen: false,
    });
    await expect(
      prepareC6SourceV3SimplePriorIdentityReplayReview(input),
    ).rejects.toThrow("already exists");
  });

  it("records one structural provenance receipt without creating or replacing the reviewer response", async () => {
    const outputRoot = await preparedRoot();
    const responseBytes = await writeAcceptedResponse(outputRoot);
    const result =
      await recordC6SourceV3SimplePriorIdentityReplayReviewProvenance({
        authorTaskName: AUTHOR,
        captureA: CAPTURE_A,
        captureB: CAPTURE_B,
        outputRoot,
        repositoryRoot: process.cwd(),
        reviewerAgentName: REVIEWER,
      });
    const provenanceBytes = await readFile(join(
      outputRoot,
      C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_PATHS.provenance,
    ));
    const provenance = JSON.parse(
      provenanceBytes.toString("utf8"),
    ) as {
      attestationScope: string;
      independenceVerified: boolean;
      reviewer: {
        orchestratorAttestation: {
          cryptographicReceipt: boolean;
        };
      };
    };

    expect(result).toMatchObject({
      cryptographicReceipt: false,
      independenceVerified: false,
      localReplayReviewAccepted: true,
      priorRepositoryNodeIdExclusionComplete: false,
      provenanceSha256: sha256(provenanceBytes),
      reviewReceiptStructureVerified: true,
      sourceV3SimpleFrozen: false,
    });
    expect(provenance).toMatchObject({
      attestationScope: "orchestrator-attestation-only",
      independenceVerified: false,
      reviewer: {
        orchestratorAttestation: {
          cryptographicReceipt: false,
        },
      },
    });
    expect(await readFile(join(
      outputRoot,
      C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_PATHS.response,
    ))).toEqual(Buffer.from(responseBytes));
    await expect(
      recordC6SourceV3SimplePriorIdentityReplayReviewProvenance({
        authorTaskName: AUTHOR,
        captureA: CAPTURE_A,
        captureB: CAPTURE_B,
        outputRoot,
        repositoryRoot: process.cwd(),
        reviewerAgentName: REVIEWER,
      }),
    ).rejects.toThrow();
  });

  it("does not publish provenance for a forged authority response", async () => {
    const outputRoot = await preparedRoot();
    const response = JSON.parse(
      await acceptedResponse(outputRoot),
    ) as {
      boundary: { liveNetworkExecutionProven: boolean };
    };
    response.boundary.liveNetworkExecutionProven = true;
    await writeFile(
      join(
        outputRoot,
        C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_PATHS.response,
      ),
      canonicalJson(response),
      { flag: "wx" },
    );

    await expect(
      recordC6SourceV3SimplePriorIdentityReplayReviewProvenance({
        authorTaskName: AUTHOR,
        captureA: CAPTURE_A,
        captureB: CAPTURE_B,
        outputRoot,
        repositoryRoot: process.cwd(),
        reviewerAgentName: REVIEWER,
      }),
    ).rejects.toThrow();
    await expect(stat(join(
      outputRoot,
      C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_PATHS.provenance,
    ))).rejects.toThrow();
  });
});

async function preparedRoot(): Promise<string> {
  const outputRoot = await temporaryRoot();
  await prepareC6SourceV3SimplePriorIdentityReplayReview({
    authorTaskName: AUTHOR,
    captureA: CAPTURE_A,
    captureB: CAPTURE_B,
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
    join(
      outputRoot,
      C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_PATHS.response,
    ),
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
        C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_PATHS.dispatch,
      )),
      readFile(join(
        outputRoot,
        C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_PATHS.input,
      )),
      readFile(join(
        outputRoot,
        C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_PATHS.request,
      )),
    ]);
  return canonicalJson({
    acceptedChecks:
      C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_REQUIRED_CHECKS,
    artifactKind:
      "c6-source-v3-simple-prior-identity-replay-review-response",
    blockingFindings: [],
    boundary: {
      candidateManifestFrozen: false,
      captureOriginIndependentlyVerified: false,
      codexRunReady: false,
      externalAuthenticityVerified: false,
      formalCensusPermitted: false,
      independentCaptureProcessProven: false,
      liveNetworkExecutionProven: false,
      priorRepositoryNodeIdExclusionComplete: false,
      sourceV3SimpleFrozen: false,
      status:
        "local-observation-replay-review-accepted-no-live-provenance-or-promotion-authority",
    },
    decision: "accepted-as-local-observation-replay-only",
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
      join(tmpdir(), "goodmemory-c6-prior-identity-review-"),
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
