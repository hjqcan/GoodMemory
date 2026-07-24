import { describe, expect, it } from "bun:test";

import {
  PHASE74_ALPHA_COMMIT,
  PHASE74_ALPHA_TREE,
  PHASE74_RELEASE_ARCHIVE_SHA256,
  PHASE74_RELEASE_COMMIT,
  PHASE74_RELEASE_LOCKFILE_SHA256,
  PHASE74_RELEASE_REF,
  PHASE74_RELEASE_TREE,
  assertPhase74VersionModelCallAllowance,
  assertPhase74VersionPair,
  buildPhase74VersionIngestionKey,
  createPhase74VersionSourceIdentity,
  parsePhase74VersionCandidateReranker,
  parsePhase74VersionCandidateSource,
  parsePhase74VersionWorkerInput,
} from "../../src/eval/phase74VersionBaseline";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);
const CANDIDATE_COMMIT = "1".repeat(40);
const CANDIDATE_TREE = "2".repeat(40);

function sourceIdentityInput(
  arm: "release" | "alpha" | "candidate",
  commit: string,
  tree: string,
) {
  return {
    archiveSha256: SHA_A,
    arm,
    commit,
    lockfileSha256: SHA_B,
    tree,
    workerSha256: SHA_C,
  } as const;
}

function workerInput(input: {
  arm: "release" | "alpha" | "candidate";
  sourceCommit: string;
}) {
  return {
    arm: input.arm,
    caseId: "conversation-1/q1",
    locale: "en",
    memoryGroupId: "conversation-1",
    question: "What is Caroline's dog's name?",
    rawEvidence: [{
      content: "Caroline adopted a dog named Pepper.",
      id: "conversation-1/D1:1",
      observedAt: "2023-05-08T00:00:00.000Z",
      role: "assistant",
      sourceIds: ["D1:1"],
    }],
    referenceTime: "2023-05-09T00:00:00.000Z",
    schemaVersion: 1,
    sourceCommit: input.sourceCommit,
  } as const;
}

describe("Phase 74 version baseline source identity", () => {
  it("pins the cumulative baseline to the pre-Phase-74 v0.6.0 release", () => {
    const identity = createPhase74VersionSourceIdentity({
      ...sourceIdentityInput("release", PHASE74_RELEASE_COMMIT, PHASE74_RELEASE_TREE),
      archiveSha256: PHASE74_RELEASE_ARCHIVE_SHA256,
      lockfileSha256: PHASE74_RELEASE_LOCKFILE_SHA256,
      ref: PHASE74_RELEASE_REF,
    });

    expect(identity).toEqual({
      archiveSha256: PHASE74_RELEASE_ARCHIVE_SHA256,
      arm: "release",
      commit: "6fdd63ecc316da725d2a1e19cb61f4eb3a9ee235",
      lockfileSha256: PHASE74_RELEASE_LOCKFILE_SHA256,
      ref: "v0.6.0",
      tree: "caad85c55d06431585d0405718f90bd4d2e76965",
      workerSha256: SHA_C,
    });
    expect(() => createPhase74VersionSourceIdentity({
      ...sourceIdentityInput("release", PHASE74_ALPHA_COMMIT, PHASE74_RELEASE_TREE),
      archiveSha256: PHASE74_RELEASE_ARCHIVE_SHA256,
      lockfileSha256: PHASE74_RELEASE_LOCKFILE_SHA256,
      ref: PHASE74_RELEASE_REF,
    })).toThrow("release commit");
    expect(() => createPhase74VersionSourceIdentity({
      ...sourceIdentityInput("release", PHASE74_RELEASE_COMMIT, PHASE74_ALPHA_TREE),
      archiveSha256: PHASE74_RELEASE_ARCHIVE_SHA256,
      lockfileSha256: PHASE74_RELEASE_LOCKFILE_SHA256,
      ref: PHASE74_RELEASE_REF,
    })).toThrow("release tree");
    expect(() => createPhase74VersionSourceIdentity({
      ...sourceIdentityInput("release", PHASE74_RELEASE_COMMIT, PHASE74_RELEASE_TREE),
      lockfileSha256: PHASE74_RELEASE_LOCKFILE_SHA256,
      ref: PHASE74_RELEASE_REF,
    })).toThrow("release archive");
    expect(() => createPhase74VersionSourceIdentity({
      ...sourceIdentityInput("release", PHASE74_RELEASE_COMMIT, PHASE74_RELEASE_TREE),
      archiveSha256: PHASE74_RELEASE_ARCHIVE_SHA256,
      ref: PHASE74_RELEASE_REF,
    })).toThrow("release lockfile");
  });

  it("pins 5d7639 to a separately named alpha diagnostic", () => {
    const identity = createPhase74VersionSourceIdentity({
      ...sourceIdentityInput("alpha", PHASE74_ALPHA_COMMIT, PHASE74_ALPHA_TREE),
      ref: PHASE74_ALPHA_COMMIT,
    });

    expect(identity.arm).toBe("alpha");
    expect(identity.commit).toBe(
      "5d7639a8fa164d86e0aa1ed10a8ea398b7912464",
    );
    expect(() => createPhase74VersionSourceIdentity({
      ...sourceIdentityInput("alpha", PHASE74_RELEASE_COMMIT, PHASE74_ALPHA_TREE),
      ref: PHASE74_RELEASE_COMMIT,
    })).toThrow("alpha commit");
  });

  it("requires an exact candidate commit and complete archive provenance", () => {
    const identity = createPhase74VersionSourceIdentity({
      ...sourceIdentityInput("candidate", CANDIDATE_COMMIT, CANDIDATE_TREE),
      ref: CANDIDATE_COMMIT,
    });

    expect(identity).toEqual({
      archiveSha256: SHA_A,
      arm: "candidate",
      commit: CANDIDATE_COMMIT,
      lockfileSha256: SHA_B,
      ref: CANDIDATE_COMMIT,
      tree: CANDIDATE_TREE,
      workerSha256: SHA_C,
    });
    expect(() => createPhase74VersionSourceIdentity({
      ...sourceIdentityInput("candidate", "HEAD", CANDIDATE_TREE),
      ref: "HEAD",
    })).toThrow("exact 40-character");
    expect(() => createPhase74VersionSourceIdentity({
      ...sourceIdentityInput("candidate", CANDIDATE_COMMIT, CANDIDATE_TREE),
      archiveSha256: "short",
      ref: CANDIDATE_COMMIT,
    })).toThrow("archiveSha256");
  });

  it("reads the exact candidate evaluator source recorded by the candidate run", () => {
    expect(parsePhase74VersionCandidateSource({
      commit: CANDIDATE_COMMIT,
      sha256: SHA_A,
    })).toEqual({ commit: CANDIDATE_COMMIT, sha256: SHA_A });
    expect(() => parsePhase74VersionCandidateSource({
      commit: "HEAD",
      sha256: SHA_A,
    })).toThrow("candidate commit");
    expect(() => parsePhase74VersionCandidateSource({
      commit: CANDIDATE_COMMIT,
      sha256: SHA_A,
      expectedAnswer: "forbidden",
    })).toThrow("unknown field expectedAnswer");
  });

  it("accepts only the frozen deterministic or Gurki listwise candidate reranker", () => {
    const deterministic = {
      implementation: "lexical-coverage-v1",
      mode: "deterministic",
    };
    const provider = {
      gateway: "https://ai.gurkiai.com/v1",
      implementation: "provider-listwise-v1",
      mode: "provider",
      model: "gpt-5.6-terra",
      provider: "openai",
    };

    expect(parsePhase74VersionCandidateReranker(deterministic)).toEqual(
      deterministic,
    );
    expect(parsePhase74VersionCandidateReranker(provider)).toEqual(provider);
    expect(() => parsePhase74VersionCandidateReranker({
      ...provider,
      implementation: "provider-pointwise-v1",
    })).toThrow("reranker");
    expect(() => parsePhase74VersionCandidateReranker({
      ...provider,
      gateway: "https://openrouter.ai/api/v1",
    })).toThrow("reranker");
    expect(() => parsePhase74VersionCandidateReranker({
      ...provider,
      fallback: "deterministic",
    })).toThrow("reranker");
  });
});

describe("Phase 74 version worker boundary", () => {
  it("accepts only label-free recall inputs", () => {
    expect(parsePhase74VersionWorkerInput(workerInput({
      arm: "release",
      sourceCommit: PHASE74_RELEASE_COMMIT,
    }))).toEqual(workerInput({
      arm: "release",
      sourceCommit: PHASE74_RELEASE_COMMIT,
    }));
  });

  for (const field of [
    "expectedAnswer",
    "goldEvidenceIds",
    "protocolMetadata",
    "benchmark",
  ] as const) {
    it(`rejects forbidden worker field ${field}`, () => {
      expect(() => parsePhase74VersionWorkerInput({
        ...workerInput({
          arm: "release",
          sourceCommit: PHASE74_RELEASE_COMMIT,
        }),
        [field]: field === "goldEvidenceIds" ? ["D1:1"] : "forbidden",
      })).toThrow(`unknown field ${field}`);
    });
  }
});

describe("Phase 74 version pairing", () => {
  it("requires byte-equivalent label-free payloads across paired arms", () => {
    const release = parsePhase74VersionWorkerInput(workerInput({
      arm: "release",
      sourceCommit: PHASE74_RELEASE_COMMIT,
    }));
    const candidate = parsePhase74VersionWorkerInput(workerInput({
      arm: "candidate",
      sourceCommit: CANDIDATE_COMMIT,
    }));

    expect(assertPhase74VersionPair({ baseline: release, candidate })).toEqual({
      caseId: release.caseId,
      memoryGroupId: release.memoryGroupId,
    });
    expect(() => assertPhase74VersionPair({
      baseline: release,
      candidate: { ...candidate, question: "A changed query" },
    })).toThrow("label-free payload drift");
    expect(() => assertPhase74VersionPair({
      baseline: release,
      candidate: { ...candidate, referenceTime: "2024-01-01T00:00:00.000Z" },
    })).toThrow("label-free payload drift");
    expect(() => assertPhase74VersionPair({
      baseline: release,
      candidate: {
        ...candidate,
        rawEvidence: [{ ...candidate.rawEvidence[0]!, content: "Changed evidence" }],
      },
    })).toThrow("label-free payload drift");
  });

  it("uses the same paired boundary for the alpha diagnostic", () => {
    const alpha = parsePhase74VersionWorkerInput(workerInput({
      arm: "alpha",
      sourceCommit: PHASE74_ALPHA_COMMIT,
    }));
    const candidate = parsePhase74VersionWorkerInput(workerInput({
      arm: "candidate",
      sourceCommit: CANDIDATE_COMMIT,
    }));

    expect(assertPhase74VersionPair({ baseline: alpha, candidate })).toEqual({
      caseId: alpha.caseId,
      memoryGroupId: alpha.memoryGroupId,
    });
  });

  it("builds branch-isolated ingestion keys containing the exact source commit", () => {
    const rawEvidence = workerInput({
      arm: "release",
      sourceCommit: PHASE74_RELEASE_COMMIT,
    }).rawEvidence;
    const releaseKey = buildPhase74VersionIngestionKey({
      configurationSha256: SHA_B,
      datasetSha256: SHA_A,
      memoryGroupId: "conversation-1",
      rawEvidence,
      sourceCommit: PHASE74_RELEASE_COMMIT,
    });
    const candidateKey = buildPhase74VersionIngestionKey({
      configurationSha256: SHA_B,
      datasetSha256: SHA_A,
      memoryGroupId: "conversation-1",
      rawEvidence,
      sourceCommit: CANDIDATE_COMMIT,
    });

    expect(releaseKey).toContain(PHASE74_RELEASE_COMMIT);
    expect(candidateKey).toContain(CANDIDATE_COMMIT);
    expect(releaseKey).not.toBe(candidateKey);
  });
});

describe("Phase 74 version model-call hard limit", () => {
  it("allows an exact reservation at the hard limit and returns zero remaining", () => {
    expect(assertPhase74VersionModelCallAllowance({
      completedCalls: 120,
      hardLimit: 200,
      requestedCalls: 80,
    })).toBe(0);
  });

  it("fails before a reservation can exceed the hard limit", () => {
    expect(() => assertPhase74VersionModelCallAllowance({
      completedCalls: 120,
      hardLimit: 200,
      requestedCalls: 81,
    })).toThrow("model-call hard limit");
    expect(() => assertPhase74VersionModelCallAllowance({
      completedCalls: 0,
      hardLimit: 0,
      requestedCalls: 0,
    })).toThrow("positive safe integer");
  });
});
