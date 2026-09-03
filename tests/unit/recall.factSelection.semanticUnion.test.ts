import { describe, expect, it } from "bun:test";
import { createFactMemory } from "../../src/domain/records";
import { createLanguageService } from "../../src/language";
import type { RecallCandidateTrace } from "../../src/recall/engine";
import { createSelectionDraft } from "../../src/recall/factSelection/draft";
import { selectSemanticUnionCandidates } from "../../src/recall/factSelection/semanticUnion";
import { buildFactCandidates, rankFactCandidates } from "../../src/recall/scoring";

const TIMESTAMP = "2026-01-10T00:00:00.000Z";
const SOURCE = {
  method: "explicit" as const,
  extractedAt: TIMESTAMP,
};

function buildRankedEntry(id: string) {
  const language = createLanguageService();
  const fact = createFactMemory({
    id,
    userId: "user-1",
    category: "project",
    content: `Semantic-only memory payload ${id}.`,
    source: SOURCE,
    updatedAt: TIMESTAMP,
  });
  return rankFactCandidates(
    buildFactCandidates([fact], "unrelated query text", language, "en", TIMESTAMP),
    "hybrid",
  )[0]!;
}

function buildTrace(memoryId: string): RecallCandidateTrace {
  return {
    memoryId,
    memoryType: "fact",
    slot: "generic",
    returned: false,
    whySuppressed: "not selected",
    intentScore: 0,
    lexicalScore: 0,
    freshnessScore: 0,
    explicitnessScore: 0,
    evidenceScore: 0,
    verificationPenaltyScore: 0,
    fallback: "none",
  };
}

describe("semantic union fact selection", () => {
  it("force-admits vector candidates after existing selections without reordering them", () => {
    const existing = buildRankedEntry("fact-existing");
    const semanticHit = buildRankedEntry("fact-semantic");
    const overflowHit = buildRankedEntry("fact-overflow");
    const traces = [existing, semanticHit, overflowHit].map((entry) =>
      buildTrace(entry.fact.id),
    );
    const draft = createSelectionDraft({ traces });

    draft.select(existing);
    selectSemanticUnionCandidates({
      compatible: [existing, semanticHit, overflowHit],
      draft,
      union: {
        candidates: [
          { id: semanticHit.fact.id, score: 0.91 },
          { id: overflowHit.fact.id, score: 0.9 },
        ],
        maxAdditions: 1,
      },
    });

    expect(draft.selected.map((entry) => entry.fact.id)).toEqual([
      "fact-existing",
      "fact-semantic",
    ]);
    expect(
      traces.find((trace) => trace.memoryId === "fact-semantic")?.fallback,
    ).toBe("semantic_union");
    expect(
      traces.find((trace) => trace.memoryId === "fact-overflow")?.returned,
    ).toBe(false);
  });

  it("skips duplicate and stale vector ids without spending the union budget", () => {
    const existing = buildRankedEntry("fact-existing");
    const semanticHit = buildRankedEntry("fact-semantic");
    const traces = [existing, semanticHit].map((entry) => buildTrace(entry.fact.id));
    const draft = createSelectionDraft({ traces });

    draft.select(existing);
    selectSemanticUnionCandidates({
      compatible: [existing, semanticHit],
      draft,
      union: {
        candidates: [
          { id: existing.fact.id, score: 0.99 },
          { id: "stale-vector-row", score: 0.98 },
          { id: semanticHit.fact.id, score: 0.97 },
        ],
        maxAdditions: 1,
      },
    });

    expect(draft.selected.map((entry) => entry.fact.id)).toEqual([
      "fact-existing",
      "fact-semantic",
    ]);
    expect(
      traces.find((trace) => trace.memoryId === "fact-semantic")?.fallback,
    ).toBe("semantic_union");
  });

  it("respects the raw similarity floor", () => {
    const semanticHit = buildRankedEntry("fact-semantic");
    const traces = [buildTrace(semanticHit.fact.id)];
    const draft = createSelectionDraft({ traces });

    selectSemanticUnionCandidates({
      compatible: [semanticHit],
      draft,
      union: {
        candidates: [{ id: semanticHit.fact.id, score: 0.49 }],
        maxAdditions: 1,
        minSimilarity: 0.5,
      },
    });

    expect(draft.selected).toEqual([]);
    expect(traces[0]?.returned).toBe(false);
  });

  it("respects a relative floor against the best raw semantic score", () => {
    const high = buildRankedEntry("fact-high");
    const near = buildRankedEntry("fact-near");
    const tail = buildRankedEntry("fact-tail");
    const traces = [high, near, tail].map((entry) => buildTrace(entry.fact.id));
    const draft = createSelectionDraft({ traces });

    selectSemanticUnionCandidates({
      compatible: [high, near, tail],
      draft,
      union: {
        candidates: [
          { id: high.fact.id, score: 0.9 },
          { id: near.fact.id, score: 0.72 },
          { id: tail.fact.id, score: 0.6 },
        ],
        maxAdditions: 3,
        minRelativeScore: 0.8,
      },
    });

    expect(draft.selected.map((entry) => entry.fact.id)).toEqual([
      "fact-high",
      "fact-near",
    ]);
    expect(
      traces.find((trace) => trace.memoryId === "fact-tail")?.returned,
    ).toBe(false);
  });
});
