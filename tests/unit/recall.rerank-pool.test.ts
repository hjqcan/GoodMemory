import { describe, expect, it } from "bun:test";

import {
  createFactMemory,
  createReferenceMemory,
} from "../../src/domain/records";
import {
  getRecallRerankPool,
  matchesRecallRerankCandidateId,
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
  it("matches only exact collection-qualified candidate IDs", () => {
    expect(matchesRecallRerankCandidateId("facts:shared", "facts", "shared"))
      .toBe(true);
    expect(matchesRecallRerankCandidateId("shared", "facts", "shared"))
      .toBe(false);
    expect(
      matchesRecallRerankCandidateId(
        "references:shared",
        "facts",
        "references:shared",
      ),
    ).toBe(false);
  });

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

  it("optionally reserves one distinct selected head from every recall pass", () => {
    const shared = Array.from(
      { length: 40 },
      (_, index) => `shared-${String(index + 1).padStart(2, "0")}`,
    );
    const primary = setRecallRerankPool({}, pool(
      shared.map((id, index) => factCandidate(id, index < 12)),
    ));
    const supplementary = ["operand-one", "operand-two"].map((uniqueId) => {
      const candidates = shared.map(
        (id, index) => factCandidate(id, index < 11),
      );
      candidates.splice(11, 0, factCandidate(uniqueId, true));
      return setRecallRerankPool({}, pool(candidates));
    });

    const baseline = mergeRecallRerankPools({
      preRankLimit: 32,
      primaryReserveLimit: 12,
      results: [primary, ...supplementary],
      target: {},
    });
    const treatment = mergeRecallRerankPools({
      distinctPassHeadProtection: true,
      preRankLimit: 32,
      primaryReserveLimit: 12,
      results: [primary, ...supplementary],
      target: {},
    });
    const baselineKeys = getRecallRerankPool(baseline)!.candidates.map(
      ({ key }) => key,
    );
    const treatmentPool = getRecallRerankPool(treatment)!;
    const treatmentKeys = treatmentPool.candidates.map(({ key }) => key);

    expect(baselineKeys).not.toContain("facts:operand-one");
    expect(baselineKeys).not.toContain("facts:operand-two");
    expect(treatmentKeys).toHaveLength(32);
    expect(treatmentKeys).toContain("facts:operand-one");
    expect(treatmentKeys).toContain("facts:operand-two");
    expect(treatmentPool.protectedPassHeadKeys).toEqual([
      "facts:shared-01",
      "facts:operand-one",
      "facts:operand-two",
    ]);
  });
});
