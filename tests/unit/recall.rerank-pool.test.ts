import { describe, expect, it } from "bun:test";

import {
  createFactMemory,
  createReferenceMemory,
} from "../../src/domain/records";
import {
  getRecallRerankPool,
  mergeRecallRerankPools,
  recallRerankCandidateKey,
  setRecallRerankPool,
  type RecallRerankCandidate,
  type RecallRerankPool,
} from "../../src/recall/rerankPool";

const scope = { userId: "user-1", workspaceId: "workspace-1" };
const timestamp = "2026-07-01T00:00:00.000Z";

function factCandidate(id: string, firstStageSelected: boolean): RecallRerankCandidate {
  return {
    collection: "facts",
    firstStageSelected,
    key: recallRerankCandidateKey("facts", id),
    record: createFactMemory({
      id,
      ...scope,
      category: "project",
      content: id,
      source: { method: "explicit", extractedAt: timestamp },
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
  };
}

function pool(candidates: RecallRerankCandidate[]): RecallRerankPool {
  return {
    candidates,
    claims: [],
    evidence: [],
    explicitEvidenceIds: [],
    includeEvidence: false,
    laneCaps: {
      episodes: 2,
      facts: 12,
      references: 1,
      session_archives: 1,
    },
    referenceTime: timestamp,
  };
}

describe("recall rerank pool", () => {
  it("reserves the selected head of every durable collection across repeated facets", () => {
    const primaryCandidates = Array.from(
      { length: 12 },
      (_, index) => factCandidate(`primary-${index + 1}`, true),
    );
    primaryCandidates.push({
      collection: "references",
      firstStageSelected: true,
      key: recallRerankCandidateKey("references", "primary-reference"),
      record: createReferenceMemory({
        id: "primary-reference",
        ...scope,
        title: "Primary guide",
        pointer: "docs/primary.md",
        source: { method: "explicit", extractedAt: timestamp },
      }),
    });
    const primary = setRecallRerankPool({}, pool(primaryCandidates));
    const repeatedFacetCandidates = Array.from(
      { length: 40 },
      (_, index) => factCandidate(`facet-${index + 1}`, false),
    );
    const facets = Array.from(
      { length: 3 },
      () => setRecallRerankPool({}, pool(repeatedFacetCandidates)),
    );
    const target = mergeRecallRerankPools({
      preRankLimit: 32,
      primaryReserveLimit: 12,
      results: [primary, ...facets],
      target: {},
    });

    expect(getRecallRerankPool(target)?.candidates).toHaveLength(32);
    expect(
      getRecallRerankPool(target)?.candidates.map(({ key }) => key),
    ).toContain("references:primary-reference");
  });
});
