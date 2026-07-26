import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildC6AssetLock } from "../../scripts/codex-coding-effect/c6-asset-lock";
import {
  validateC6EpisodeIntakeReview,
} from "../../scripts/codex-coding-effect/c6-episode-intake-review";
import type {
  C6EpisodeIntakeCandidate,
} from "../../scripts/codex-coding-effect/c6-episode-intake-review";

const REVIEW_ROOT = "provenance/episode-intake-review";
const INPUT_PATH = `${REVIEW_ROOT}/input.json`;
const REQUEST_PATH = `${REVIEW_ROOT}/request.json`;
const DISPATCH_PATH = `${REVIEW_ROOT}/dispatch.json`;
const RESPONSE_PATH = `${REVIEW_ROOT}/response.json`;
const PROVENANCE_PATH = `${REVIEW_ROOT}/provenance.json`;
const SOURCE_CLOSURE_PATH = "source-intake/closure.json";
const SOURCE_PROJECTION_PATH = "source-intake/projection.json";
const REQUIRED_CHECKS = [
  "complete-constructed-candidate-universe",
  "canonical-origin-anchor",
  "semantic-family-partition",
  "same-origin-anchor-same-family",
  "same-coding-task-surface-same-family",
  "deterministic-family-representative",
  "representative-selected-or-qualified-reserve",
  "non-representative-semantic-duplicate",
  "selected-and-qualified-reserve-sets-complete",
  "selected-set-matches-final-dataset",
] as const;

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { force: true, recursive: true })
  ));
});

describe("C6 episode-intake semantic review", () => {
  it("accepts a complete, independently reviewed semantic-family partition", async () => {
    const fixture = await materializeFixture();

    const evidence = await validateC6EpisodeIntakeReview({
      assetLock: fixture.assetLock,
      datasetRoot: fixture.root,
      expectedCandidates: fixture.candidates,
      finalDatasetEpisodeIds: fixture.selectedCandidateIds,
    });

    expect(evidence).toEqual({
      candidateCount: 4,
      cryptographicReceipt: false,
      dispatchSha256: fixture.hashes.dispatch,
      familyCount: 2,
      inputSha256: fixture.hashes.input,
      provenanceSha256: fixture.hashes.provenance,
      qualifiedReserveCandidateCount: 1,
      requestSha256: fixture.hashes.request,
      responseSha256: fixture.hashes.response,
      reviewerAgentName: "/root/c6_episode_intake_review_v2",
      selectedCandidateCount: 1,
      selectionClosureRebuilt: false,
      semanticDuplicateCount: 2,
      sourceIntakeClosureRebuilt: false,
    });
  });

  it("requires the review input to equal the caller-reconstructed universe", async () => {
    const fixture = await materializeFixture({
      input: (value) => {
        value.candidates = value.candidates.slice(0, -1);
      },
    });

    await expectValidationFailure(
      fixture,
      "does not equal the externally reconstructed candidate universe",
    );
  });

  it("rejects a forged origin-anchor digest", async () => {
    const fixture = await materializeFixture({
      input: (value) => {
        value.candidates[0]!.originAnchor.sha256 = "f".repeat(64);
      },
    });
    fixture.candidates[0]!.originAnchor.sha256 = "f".repeat(64);

    await expectValidationFailure(fixture, "origin anchor is not canonical");
  });

  it("requires a complete, non-overlapping family partition", async () => {
    const missing = await materializeFixture({
      response: (value) => {
        const family = value.families.find((candidateFamily) =>
          candidateFamily.members.length > 1
        )!;
        family.members.pop();
        family.familyId = deriveFamilyId(family.members);
        family.representativeCandidateId = deterministicRepresentative(
          family.members,
        );
        value.families.sort((left, right) =>
          compareCanonicalString(left.familyId, right.familyId)
        );
      },
    });
    await expectValidationFailure(
      missing,
      "families do not partition the candidate universe",
    );

    const duplicate = await materializeFixture({
      response: (value) => {
        const source = value.families.find((family) =>
          family.members.length > 1
        )!;
        const target = value.families.find((family) =>
          family.members.length === 1
        )!;
        target.members.push({ ...source.members[0]! });
        target.members.sort((left, right) =>
          compareCanonicalString(left.candidateId, right.candidateId)
        );
        target.familyId = deriveFamilyId(target.members);
        target.representativeCandidateId = deterministicRepresentative(
          target.members,
        );
        value.families.sort((left, right) =>
          compareCanonicalString(left.familyId, right.familyId)
        );
      },
    });
    await expectValidationFailure(
      duplicate,
      "families do not partition the candidate universe",
    );
  });

  it("derives every family id from its sorted member bindings", async () => {
    const fixture = await materializeFixture({
      response: (value) => {
        value.families[0]!.familyId =
          `semantic-family-${"f".repeat(64)}`;
        value.families.sort((left, right) =>
          compareCanonicalString(left.familyId, right.familyId)
        );
      },
    });

    await expectValidationFailure(fixture, "family id is not derived");
  });

  it("does not let a review split a shared anchor or coding surface", async () => {
    const anchorSplit = await materializeFixture({
      response: splitFirstFamilyAfter(1),
    });
    await expectValidationFailure(
      anchorSplit,
      "same origin anchor must share one semantic family",
    );

    const codingSurfaceSplit = await materializeFixture({
      response: splitFirstFamilyAfter(2),
    });
    await expectValidationFailure(
      codingSurfaceSplit,
      "same coding task surface must share one semantic family",
    );
  });

  it("requires the deterministic minimum-rank representative", async () => {
    const fixture = await materializeFixture({
      response: (value) => {
        const family = value.families[0]!;
        family.representativeCandidateId = "candidate-a";
        const selected = value.candidateReviews.find((review) =>
          review.candidateId === "candidate-c"
        )!;
        selected.decision = "semantic-duplicate";
        selected.representativeCandidateId = "candidate-a";
        const replacement = value.candidateReviews.find((review) =>
          review.candidateId === "candidate-a"
        )!;
        replacement.decision = "selected";
        replacement.representativeCandidateId = "candidate-a";
        value.selectedCandidateIds = ["candidate-a"];
        value.selectedCandidateIdsSha256 = sha256(
          JSON.stringify(value.selectedCandidateIds),
        );
      },
    });

    await expectValidationFailure(
      fixture,
      "family representative is not deterministic",
      ["candidate-a"],
    );
  });

  it("rejects non-representative selected or reserve decisions and detached duplicate decisions", async () => {
    const nonRepresentativeSelected = await materializeFixture({
      response: (value) => {
        const review = value.candidateReviews.find((candidate) =>
          candidate.candidateId === "candidate-a"
        )!;
        review.decision = "selected";
        review.representativeCandidateId = "candidate-a";
        value.selectedCandidateIds = [
          "candidate-a",
          "candidate-c",
        ];
        value.selectedCandidateIdsSha256 = sha256(
          JSON.stringify(value.selectedCandidateIds),
        );
      },
    });
    await expectValidationFailure(
      nonRepresentativeSelected,
      "detached from its semantic family representative",
      ["candidate-a", "candidate-c"],
    );

    const nonRepresentativeReserve = await materializeFixture({
      response: (value) => {
        const review = value.candidateReviews.find((candidate) =>
          candidate.candidateId === "candidate-a"
        )!;
        review.decision = "qualified-reserve";
        review.representativeCandidateId = "candidate-a";
        value.qualifiedReserveCandidateIds = [
          "candidate-a",
          "candidate-d",
        ];
        value.qualifiedReserveCandidateIdsSha256 = sha256(
          JSON.stringify(value.qualifiedReserveCandidateIds),
        );
        value.qualifiedReserveCandidateCount =
          value.qualifiedReserveCandidateIds.length;
      },
    });
    await expectValidationFailure(
      nonRepresentativeReserve,
      "detached from its semantic family representative",
    );

    const detachedDuplicate = await materializeFixture({
      response: (value) => {
        const review = value.candidateReviews.find((candidate) =>
          candidate.candidateId === "candidate-a"
        )!;
        review.familyId = value.families[1]!.familyId;
        review.representativeCandidateId = "candidate-d";
      },
    });
    await expectValidationFailure(
      detachedDuplicate,
      "candidate review is detached from its semantic family",
    );

    const duplicateRepresentative = await materializeFixture({
      response: (value) => {
        const selected = value.candidateReviews.find((candidate) =>
          candidate.candidateId === "candidate-c"
        )!;
        selected.decision = "semantic-duplicate";
        const reserve = value.candidateReviews.find((candidate) =>
          candidate.candidateId === "candidate-d"
        )!;
        reserve.decision = "selected";
        value.selectedCandidateIds = ["candidate-d"];
        value.selectedCandidateIdsSha256 = sha256(
          JSON.stringify(value.selectedCandidateIds),
        );
        value.qualifiedReserveCandidateIds = [];
        value.qualifiedReserveCandidateIdsSha256 = sha256(JSON.stringify([]));
        value.qualifiedReserveCandidateCount = 0;
      },
    });
    await expectValidationFailure(
      duplicateRepresentative,
      "detached from its semantic family representative",
      ["candidate-d"],
    );
  });

  it("binds the selected set to review decisions and final dataset episode ids", async () => {
    const reviewMismatch = await materializeFixture({
      response: (value) => {
        value.selectedCandidateIds = ["candidate-d"];
        value.selectedCandidateIdsSha256 = sha256(
          JSON.stringify(value.selectedCandidateIds),
        );
      },
    });
    await expectValidationFailure(
      reviewMismatch,
      "selected candidate ids do not match candidate review decisions",
      ["candidate-d"],
    );

    const callerMismatch = await materializeFixture();
    await expectValidationFailure(
      callerMismatch,
      "selected candidate ids do not equal final dataset episode ids",
      ["candidate-d"],
    );
  });

  it("requires a complete and counted qualified-reserve set", async () => {
    const missingReserve = await materializeFixture({
      response: (value) => {
        value.qualifiedReserveCandidateIds = [];
        value.qualifiedReserveCandidateIdsSha256 = sha256(JSON.stringify([]));
        value.qualifiedReserveCandidateCount = 0;
      },
    });
    await expectValidationFailure(
      missingReserve,
      "qualified-reserve candidate ids do not match candidate review decisions",
    );

    const wrongCount = await materializeFixture({
      response: (value) => {
        value.qualifiedReserveCandidateCount = 0;
      },
    });
    await expectValidationFailure(
      wrongCount,
      "qualified-reserve candidate count does not match",
    );

    const wrongDigest = await materializeFixture({
      response: (value) => {
        value.qualifiedReserveCandidateIdsSha256 = "f".repeat(64);
      },
    });
    await expectValidationFailure(
      wrongDigest,
      "qualified-reserve candidate ids digest does not match",
    );
  });

  it("fails closed on legacy v1 review artifacts", async () => {
    const fixture = await materializeFixture({
      input: (value) => {
        (value as { schemaVersion: number }).schemaVersion = 1;
      },
    });

    await expectValidationFailure(
      fixture,
      "invalid C6 episode intake input",
    );
  });

  it("rejects forbidden reviewer evidence and non-independent provenance", async () => {
    const forbidden = await materializeFixture({
      request: (value) => {
        value.goldAccess = false;
      },
    });
    await expectValidationFailure(forbidden, "invalid C6 episode intake request");

    const selfReview = await materializeFixture({
      provenance: (value) => {
        value.reviewer.agentName = "/root/candidate-author-a";
      },
    });
    await expectValidationFailure(
      selfReview,
      "episode intake review provenance is not independent",
    );
  });

  it("verifies source intake references against the asset lock without claiming closure reconstruction", async () => {
    const fixture = await materializeFixture({
      input: (value) => {
        value.sourceIntakeClosure.sha256 = "f".repeat(64);
      },
    });

    await expectValidationFailure(
      fixture,
      "source intake closure does not match the asset lock",
    );
  });

  it("requires canonical bytes for all five review provenance artifacts", async () => {
    for (const [field, label] of [
      ["inputBytes", "input"],
      ["requestBytes", "request"],
      ["dispatchBytes", "dispatch"],
      ["responseBytes", "response"],
      ["provenanceBytes", "provenance"],
    ] as const) {
      const fixture = await materializeFixture({
        [field]: makeNonCanonical,
      });
      await expectValidationFailure(
        fixture,
        `invalid C6 episode intake ${label}`,
      );
    }
  });
});

interface ArtifactReference {
  byteLength: number;
  path: string;
  sha256: string;
}

interface FamilyMember {
  candidateId: string;
  codingTaskSurfaceSha256: string;
  fullAgentVisibleInputSha256: string;
  originAnchorSha256: string;
}

interface ReviewFamily {
  familyId: string;
  members: FamilyMember[];
  representativeCandidateId: string;
}

interface CandidateReview {
  candidateId: string;
  decision: "qualified-reserve" | "selected" | "semantic-duplicate";
  familyId: string;
  representativeCandidateId: string;
}

interface ReviewInput {
  candidates: C6EpisodeIntakeCandidate[];
  schemaVersion: 2;
  sourceIntakeClosure: ArtifactReference;
  sourceIntakeProjection: ArtifactReference;
}

interface ReviewRequest {
  hiddenEvaluatorAccess: false;
  input: ArtifactReference;
  outcomeAccess: false;
  rawGoldAccess: false;
  requiredChecks: typeof REQUIRED_CHECKS;
  schemaVersion: 2;
  task: "independent-c6-episode-intake-review-v2";
  [key: string]: unknown;
}

interface ReviewDispatch {
  authorTaskName: string;
  contextPolicy: "fork-turns-none";
  input: ArtifactReference;
  request: ArtifactReference;
  requestedTaskName: "c6_episode_intake_review_v2";
  responsePath: typeof RESPONSE_PATH;
  reviewerAgentName: string;
  schemaVersion: 2;
}

interface ReviewResponse {
  blockingFindings: string[];
  candidateReviews: CandidateReview[];
  candidateUniverseSha256: string;
  decision: "accepted";
  families: ReviewFamily[];
  familyCount: number;
  inputSha256: string;
  qualifiedReserveCandidateCount: number;
  qualifiedReserveCandidateIds: string[];
  qualifiedReserveCandidateIdsSha256: string;
  requestSha256: string;
  reviewedAt: string;
  reviewedCandidateCount: number;
  reviewerAgentName: string;
  schemaVersion: 2;
  selectedCandidateIds: string[];
  selectedCandidateIdsSha256: string;
}

interface ReviewProvenance {
  authorTaskName: string;
  dispatch: ArtifactReference;
  input: ArtifactReference;
  recordedAt: string;
  request: ArtifactReference;
  response: ArtifactReference;
  reviewer: {
    agentName: string;
    contextPolicy: "fork-turns-none";
    orchestratorAttestation: {
      attestedByTaskName: string;
      basis: "orchestrator-observed-dispatch-no-cryptographic-receipt";
      cryptographicReceipt: false;
    };
    requestedTaskName: "c6_episode_intake_review_v2";
    type: "independent-ai-agent";
  };
  schemaVersion: 2;
}

interface FixtureMutations {
  dispatch?: (value: ReviewDispatch) => void;
  dispatchBytes?: (value: string) => string;
  input?: (value: ReviewInput) => void;
  inputBytes?: (value: string) => string;
  provenance?: (value: ReviewProvenance) => void;
  provenanceBytes?: (value: string) => string;
  request?: (value: ReviewRequest) => void;
  requestBytes?: (value: string) => string;
  response?: (value: ReviewResponse) => void;
  responseBytes?: (value: string) => string;
}

async function materializeFixture(mutations: FixtureMutations = {}) {
  const root = await mkdtemp(
    join(await realpath(tmpdir()), "goodmemory-c6-intake-review-"),
  );
  roots.push(root);
  const candidates = buildCandidates();
  const selectedCandidateIds = ["candidate-c"];
  const qualifiedReserveCandidateIds = ["candidate-d"];
  const sourceClosureBytes = canonical({
    candidateCount: candidates.length,
    kind: "externally-reconstructed-source-intake-closure",
    schemaVersion: 1,
  });
  const sourceProjectionBytes = canonical({
    candidateIds: candidates.map((candidate) => candidate.candidateId),
    kind: "source-intake-projection",
    schemaVersion: 1,
  });
  await writeArtifact(root, SOURCE_CLOSURE_PATH, sourceClosureBytes);
  await writeArtifact(root, SOURCE_PROJECTION_PATH, sourceProjectionBytes);

  const reviewInput: ReviewInput = {
    candidates: structuredClone(candidates),
    schemaVersion: 2,
    sourceIntakeClosure: reference(SOURCE_CLOSURE_PATH, sourceClosureBytes),
    sourceIntakeProjection: reference(
      SOURCE_PROJECTION_PATH,
      sourceProjectionBytes,
    ),
  };
  mutations.input?.(reviewInput);
  const canonicalInputBytes = canonical(reviewInput);
  const inputBytes = mutations.inputBytes?.(canonicalInputBytes) ??
    canonicalInputBytes;

  const request: ReviewRequest = {
    hiddenEvaluatorAccess: false,
    input: reference(INPUT_PATH, inputBytes),
    outcomeAccess: false,
    rawGoldAccess: false,
    requiredChecks: REQUIRED_CHECKS,
    schemaVersion: 2,
    task: "independent-c6-episode-intake-review-v2",
  };
  mutations.request?.(request);
  const canonicalRequestBytes = canonical(request);
  const requestBytes = mutations.requestBytes?.(canonicalRequestBytes) ??
    canonicalRequestBytes;

  const dispatch: ReviewDispatch = {
    authorTaskName: "/root",
    contextPolicy: "fork-turns-none",
    input: reference(INPUT_PATH, inputBytes),
    request: reference(REQUEST_PATH, requestBytes),
    requestedTaskName: "c6_episode_intake_review_v2",
    responsePath: RESPONSE_PATH,
    reviewerAgentName: "/root/c6_episode_intake_review_v2",
    schemaVersion: 2,
  };
  mutations.dispatch?.(dispatch);
  const canonicalDispatchBytes = canonical(dispatch);
  const dispatchBytes = mutations.dispatchBytes?.(canonicalDispatchBytes) ??
    canonicalDispatchBytes;

  const families = buildFamilies(candidates);
  const candidateReviews = candidates.map((candidate): CandidateReview => {
    const family = families.find((value) =>
      value.members.some((member) =>
        member.candidateId === candidate.candidateId
      )
    )!;
    return {
      candidateId: candidate.candidateId,
      decision: family.representativeCandidateId === candidate.candidateId
        ? selectedCandidateIds.includes(candidate.candidateId)
          ? "selected"
          : "qualified-reserve"
        : "semantic-duplicate",
      familyId: family.familyId,
      representativeCandidateId: family.representativeCandidateId,
    };
  });
  const response: ReviewResponse = {
    blockingFindings: [],
    candidateReviews,
    candidateUniverseSha256: sha256(JSON.stringify(candidates)),
    decision: "accepted",
    families,
    familyCount: families.length,
    inputSha256: sha256(inputBytes),
    qualifiedReserveCandidateCount: qualifiedReserveCandidateIds.length,
    qualifiedReserveCandidateIds: [...qualifiedReserveCandidateIds],
    qualifiedReserveCandidateIdsSha256: sha256(
      JSON.stringify(qualifiedReserveCandidateIds),
    ),
    requestSha256: sha256(requestBytes),
    reviewedAt: "2026-07-25T12:00:00.000Z",
    reviewedCandidateCount: candidates.length,
    reviewerAgentName: "/root/c6_episode_intake_review_v2",
    schemaVersion: 2,
    selectedCandidateIds: [...selectedCandidateIds],
    selectedCandidateIdsSha256: sha256(
      JSON.stringify(selectedCandidateIds),
    ),
  };
  mutations.response?.(response);
  const canonicalResponseBytes = canonical(response);
  const responseBytes = mutations.responseBytes?.(canonicalResponseBytes) ??
    canonicalResponseBytes;

  const provenance: ReviewProvenance = {
    authorTaskName: "/root",
    dispatch: reference(DISPATCH_PATH, dispatchBytes),
    input: reference(INPUT_PATH, inputBytes),
    recordedAt: "2026-07-25T12:01:00.000Z",
    request: reference(REQUEST_PATH, requestBytes),
    response: reference(RESPONSE_PATH, responseBytes),
    reviewer: {
      agentName: "/root/c6_episode_intake_review_v2",
      contextPolicy: "fork-turns-none",
      orchestratorAttestation: {
        attestedByTaskName: "/root",
        basis: "orchestrator-observed-dispatch-no-cryptographic-receipt",
        cryptographicReceipt: false,
      },
      requestedTaskName: "c6_episode_intake_review_v2",
      type: "independent-ai-agent",
    },
    schemaVersion: 2,
  };
  mutations.provenance?.(provenance);
  const canonicalProvenanceBytes = canonical(provenance);
  const provenanceBytes =
    mutations.provenanceBytes?.(canonicalProvenanceBytes) ??
      canonicalProvenanceBytes;

  await Promise.all([
    writeArtifact(root, INPUT_PATH, inputBytes),
    writeArtifact(root, REQUEST_PATH, requestBytes),
    writeArtifact(root, DISPATCH_PATH, dispatchBytes),
    writeArtifact(root, RESPONSE_PATH, responseBytes),
    writeArtifact(root, PROVENANCE_PATH, provenanceBytes),
  ]);

  return {
    assetLock: await buildC6AssetLock(root),
    candidates,
    hashes: {
      dispatch: sha256(dispatchBytes),
      input: sha256(inputBytes),
      provenance: sha256(provenanceBytes),
      request: sha256(requestBytes),
      response: sha256(responseBytes),
    },
    selectedCandidateIds,
    root,
  };
}

function buildCandidates(): C6EpisodeIntakeCandidate[] {
  const anchorA = buildAnchor("https://github.com/example/repository-a", [
    {
      locator: "pull/10#review-1",
      stageId: "stage-1",
      upstreamItemRevision: "revision-a",
    },
  ]);
  const anchorB = buildAnchor("https://github.com/example/repository-b", [
    {
      locator: "pull/20#review-1",
      stageId: "stage-1",
      upstreamItemRevision: "revision-b",
    },
  ]);
  const anchorC = buildAnchor("https://github.com/example/repository-c", [
    {
      locator: "pull/30#review-1",
      stageId: "stage-1",
      upstreamItemRevision: "revision-c",
    },
  ]);
  return [
    {
      author: "/root/candidate-author-a",
      candidateId: "candidate-a",
      codingTaskSurfaceSha256: "a".repeat(64),
      fullAgentVisibleInputSha256: "1".repeat(64),
      originAnchor: anchorA,
      selectionRankSha256: "1".repeat(64),
    },
    {
      author: "/root/candidate-author-b",
      candidateId: "candidate-b",
      codingTaskSurfaceSha256: "b".repeat(64),
      fullAgentVisibleInputSha256: "2".repeat(64),
      originAnchor: structuredClone(anchorA),
      selectionRankSha256: "2".repeat(64),
    },
    {
      author: "/root/candidate-author-c",
      candidateId: "candidate-c",
      codingTaskSurfaceSha256: "b".repeat(64),
      fullAgentVisibleInputSha256: "3".repeat(64),
      originAnchor: anchorC,
      selectionRankSha256: "0".repeat(64),
    },
    {
      author: "/root/candidate-author-d",
      candidateId: "candidate-d",
      codingTaskSurfaceSha256: "d".repeat(64),
      fullAgentVisibleInputSha256: "4".repeat(64),
      originAnchor: anchorB,
      selectionRankSha256: "3".repeat(64),
    },
  ];
}

function buildAnchor(
  repositoryUrl: string,
  orderedTargets: Array<{
    locator: string;
    stageId: string;
    upstreamItemRevision: string;
  }>,
) {
  return {
    algorithm: "repository-and-ordered-origin-items-v1" as const,
    orderedTargets,
    repositoryUrl,
    sha256: sha256(JSON.stringify({ repositoryUrl, orderedTargets })),
  };
}

function buildFamilies(
  candidates: readonly C6EpisodeIntakeCandidate[],
): ReviewFamily[] {
  const memberGroups = [
    candidates.slice(0, 3).map(toFamilyMember),
    candidates.slice(3).map(toFamilyMember),
  ];
  return memberGroups.map((members) => {
    members.sort((left, right) =>
      compareCanonicalString(left.candidateId, right.candidateId)
    );
    const representativeCandidateId = members
      .map((member) =>
        candidates.find((candidate) =>
          candidate.candidateId === member.candidateId
        )!
      )
      .sort(compareCandidateRank)[0]!.candidateId;
    return {
      familyId: deriveFamilyId(members),
      members,
      representativeCandidateId,
    };
  }).sort((left, right) =>
    compareCanonicalString(left.familyId, right.familyId)
  );
}

function toFamilyMember(
  candidate: C6EpisodeIntakeCandidate,
): FamilyMember {
  return {
    candidateId: candidate.candidateId,
    codingTaskSurfaceSha256: candidate.codingTaskSurfaceSha256,
    fullAgentVisibleInputSha256: candidate.fullAgentVisibleInputSha256,
    originAnchorSha256: candidate.originAnchor.sha256,
  };
}

function deriveFamilyId(members: readonly FamilyMember[]): string {
  const sorted = [...members].sort((left, right) =>
    compareCanonicalString(left.candidateId, right.candidateId)
  );
  return `semantic-family-${sha256(JSON.stringify(sorted))}`;
}

function compareCandidateRank(
  left: C6EpisodeIntakeCandidate,
  right: C6EpisodeIntakeCandidate,
): number {
  return compareCanonicalString(
    left.selectionRankSha256,
    right.selectionRankSha256,
  ) || compareCanonicalString(left.candidateId, right.candidateId);
}

function splitFirstFamilyAfter(
  memberCount: number,
): (value: ReviewResponse) => void {
  return (value) => {
    const first = value.families.find((family) =>
      family.members.length > memberCount
    )!;
    const retained = first.members.slice(0, memberCount);
    const moved = first.members.slice(memberCount);
    first.members = retained;
    first.familyId = deriveFamilyId(retained);
    first.representativeCandidateId = deterministicRepresentative(retained);
    const extra: ReviewFamily = {
      familyId: deriveFamilyId(moved),
      members: moved,
      representativeCandidateId: deterministicRepresentative(moved),
    };
    value.families.push(extra);
    value.families.sort((left, right) =>
      compareCanonicalString(left.familyId, right.familyId)
    );
    value.familyCount = value.families.length;
    for (const review of value.candidateReviews) {
      const family = value.families.find((candidateFamily) =>
        candidateFamily.members.some((member) =>
          member.candidateId === review.candidateId
        )
      )!;
      review.familyId = family.familyId;
      review.representativeCandidateId = family.representativeCandidateId;
      review.decision = review.candidateId === family.representativeCandidateId
        ? value.selectedCandidateIds.includes(review.candidateId)
          ? "selected"
          : "qualified-reserve"
        : "semantic-duplicate";
    }
    value.selectedCandidateIds = value.candidateReviews
      .filter((review) => review.decision === "selected")
      .map((review) => review.candidateId);
    value.selectedCandidateIdsSha256 = sha256(
      JSON.stringify(value.selectedCandidateIds),
    );
    value.qualifiedReserveCandidateIds = value.candidateReviews
      .filter((review) => review.decision === "qualified-reserve")
      .map((review) => review.candidateId);
    value.qualifiedReserveCandidateIdsSha256 = sha256(
      JSON.stringify(value.qualifiedReserveCandidateIds),
    );
    value.qualifiedReserveCandidateCount =
      value.qualifiedReserveCandidateIds.length;
  };
}

function deterministicRepresentative(
  members: readonly FamilyMember[],
): string {
  const rankByCandidateId: Record<string, string> = {
    "candidate-a": "1",
    "candidate-b": "2",
    "candidate-c": "0",
    "candidate-d": "3",
  };
  return [...members].sort((left, right) =>
    compareCanonicalString(
      rankByCandidateId[left.candidateId]!,
      rankByCandidateId[right.candidateId]!,
    ) || compareCanonicalString(left.candidateId, right.candidateId)
  )[0]!.candidateId;
}

function compareCanonicalString(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function makeNonCanonical(value: string): string {
  return value.replace(/\n$/u, " \n");
}

async function expectValidationFailure(
  fixture: Awaited<ReturnType<typeof materializeFixture>>,
  message: string,
  finalDatasetEpisodeIds = fixture.selectedCandidateIds,
): Promise<void> {
  await expect(validateC6EpisodeIntakeReview({
    assetLock: fixture.assetLock,
    datasetRoot: fixture.root,
    expectedCandidates: fixture.candidates,
    finalDatasetEpisodeIds,
  })).rejects.toThrow(message);
}

function reference(path: string, bytes: string): ArtifactReference {
  return {
    byteLength: Buffer.byteLength(bytes),
    path,
    sha256: sha256(bytes),
  };
}

async function writeArtifact(
  root: string,
  path: string,
  bytes: string,
): Promise<void> {
  const absolutePath = join(root, path);
  await mkdir(join(absolutePath, ".."), { recursive: true });
  await writeFile(absolutePath, bytes);
}

function canonical(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
