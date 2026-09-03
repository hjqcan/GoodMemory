import { describe, expect, it } from "bun:test";

import { createFactMemory } from "../../src/domain/records";
import { createSelectionDraft } from "../../src/recall/factSelection/draft";
import { selectGeneralizedFusionCandidates } from "../../src/recall/factSelection/generalizedFusionUnion";
import type { RecallCandidateTrace } from "../../src/recall/engine";
import type { RankedFactCandidate } from "../../src/recall/scoring";

function rankedFact(id: string): RankedFactCandidate {
  return {
    fact: createFactMemory({
      id,
      userId: "user-1",
      category: "personal",
      content: `Generalized fact ${id}`,
      source: {
        extractedAt: "2026-07-10T00:00:00.000Z",
        method: "explicit",
      },
    }),
    categoryBoost: 0,
    evidenceScore: 0,
    explicitnessScore: 0,
    freshnessScore: 0,
    intentScore: 0,
    lexicalScore: 0,
    locale: "en",
    score: 0,
    semanticScore: 0,
    subject: "unknown",
    subjectScore: 0,
    verificationPenaltyScore: 0,
  };
}

function trace(memoryId: string): RecallCandidateTrace {
  return {
    explicitnessScore: 0,
    fallback: "none",
    freshnessScore: 0,
    intentScore: 0,
    lexicalScore: 0,
    memoryId,
    memoryType: "fact",
    returned: false,
    slot: "generic",
    whySuppressed: "not selected",
  };
}

describe("generalized fact admission budget", () => {
  it("caps baseline plus generalized facts at the configured total", () => {
    const baseline = Array.from({ length: 6 }, (_, index) =>
      rankedFact(`baseline-${index}`),
    );
    const additions = Array.from({ length: 8 }, (_, index) =>
      rankedFact(`addition-${index}`),
    );
    const compatible = [...baseline, ...additions];
    const draft = createSelectionDraft({
      traces: compatible.map(({ fact }) => trace(fact.id)),
    });
    for (const candidate of baseline) {
      draft.select(candidate);
    }

    selectGeneralizedFusionCandidates({
      compatible,
      draft,
      union: {
        candidates: additions.map(({ fact }, index) => ({
          id: fact.id,
          score: additions.length - index,
        })),
        maxAdditions: 8,
        maxTotalFacts: 10,
      },
    });

    expect(draft.selected.map(({ fact }) => fact.id)).toEqual([
      ...baseline.map(({ fact }) => fact.id),
      ...additions.slice(0, 4).map(({ fact }) => fact.id),
    ]);
  });

  it("keeps the full additive budget when baseline selection is empty", () => {
    const additions = Array.from({ length: 8 }, (_, index) =>
      rankedFact(`addition-${index}`),
    );
    const draft = createSelectionDraft({
      traces: additions.map(({ fact }) => trace(fact.id)),
    });

    selectGeneralizedFusionCandidates({
      compatible: additions,
      draft,
      union: {
        candidates: additions.map(({ fact }, index) => ({
          id: fact.id,
          score: additions.length - index,
        })),
        maxAdditions: 8,
        maxTotalFacts: 10,
      },
    });

    expect(draft.selected).toHaveLength(8);
  });
});
