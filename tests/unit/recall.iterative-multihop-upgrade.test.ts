import { describe, expect, it } from "bun:test";
import { createFactMemory, type FactMemory } from "../../src/domain/records";
import type { RecallResult } from "../../src/api/contracts";
import {
  extractBridgeEntities,
  iterativeRecall,
} from "../../src/recall/iterativeRecall";
import { createLanguageService } from "../../src/language";

const language = createLanguageService();

function analyzeBridgeText(text: string) {
  const context = language.resolveFromText({ text });
  return {
    entities: language.extractEntityMentions(text, context).map(
      (mention) => mention.surface,
    ),
    tokens: language.tokenize(text, context, { excludeStopwords: true }),
  };
}

function fact(id: string, content: string): FactMemory {
  return createFactMemory({
    id,
    userId: "u-1",
    workspaceId: "workspace-a",
    category: "project",
    content,
    source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
}

// Same deterministic recall stand-in as the base iterative test: a fact is
// retrieved when it shares a content word of length >= 4 with the query.
function lexicalRecall(
  corpus: readonly FactMemory[],
): (query: string) => Promise<RecallResult> {
  const significant = (text: string): Set<string> =>
    new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/u)
        .filter((token) => token.length >= 4),
    );
  return async (query: string) => {
    const queryWords = significant(query);
    const facts = corpus.filter((candidate) => {
      for (const word of significant(candidate.content)) {
        if (queryWords.has(word)) {
          return true;
        }
      }
      return false;
    });
    return { facts } as unknown as RecallResult;
  };
}

describe("iterativeRecall multi-hop upgrade", () => {
  // A two-bridge chain: query -> A (project) -> B (Brunhilde Vasquez) -> C (Tobias Quill).
  const start = fact("a-start", "The project lead is Brunhilde Vasquez.");
  const mid = fact("b-mid", "Brunhilde Vasquez mentors Tobias Quill.");
  const end = fact("c-end", "Tobias Quill won the Hawthorne Prize.");
  const distractor = fact("d", "The cafeteria menu changes weekly.");
  const corpus = [start, mid, end, distractor];
  const query = "Tell me about the project leadership";

  it("does not turn timestamps, contractions, or a query possessive into bridges", () => {
    const bridges = extractBridgeEntities({
      analyzeBridgeText,
      facts: [{
        content:
          "[2022-10-06T11:00:00.000Z] Joanna's book names Redemption as its central theme. I'm writing about it.",
      }],
      query: "What themes are explored in Joanna's book?",
    });

    expect(bridges).toContain("Redemption");
    expect(bridges).not.toContain("Joanna's");
    expect(bridges).not.toContain("I'm");
    expect(
      bridges.some((bridge) => /^(?:00|000Z|\d{4}-\d{2})/u.test(bridge)),
    ).toBe(false);
  });

  it("accepts LanguagePack analysis for Japanese bridge entities", () => {
    const language = createLanguageService({ defaultLocale: "ja-JP" });
    const context = language.resolveFromText({
      locale: "ja-JP",
      text: "田中さんは佐藤さんに報告します。",
    });

    const bridges = extractBridgeEntities({
      analyzeBridgeText(text) {
        return {
          entities: language.extractEntityMentions(text, context).map(
            (mention) => mention.surface,
          ),
          tokens: language.tokenize(text, context, { excludeStopwords: true }),
        };
      },
      facts: [{ content: "プロジェクト責任者は田中さんです。" }],
      query: "プロジェクト責任者は誰ですか？",
    });

    expect(bridges).toContain("田中さん");
  });

  it("default two passes reach the first bridge but not the second", async () => {
    const outcome = await iterativeRecall({
      query,
      recall: lexicalRecall(corpus),
      options: { analyzeBridgeText },
    });
    expect(outcome.hops).toBe(2);
    const ids = outcome.result.facts.map((entry) => entry.id);
    expect(ids).toContain("a-start");
    expect(ids).toContain("b-mid");
    expect(ids).not.toContain("c-end");
  });

  it("reaches the second bridge with maxHops: 3", async () => {
    const outcome = await iterativeRecall({
      query,
      recall: lexicalRecall(corpus),
      options: { analyzeBridgeText, maxHops: 3 },
    });
    expect(outcome.hops).toBe(3);
    const ids = outcome.result.facts.map((entry) => entry.id);
    expect(ids).toContain("c-end");
    expect(ids).not.toContain("d");
  });

  it("stops early once a hop surfaces nothing new, without burning all hops", async () => {
    // A short chain that exhausts at b-mid; a generous cap must not run forever.
    const a = fact("a", "The release owner is Ingrid Solberg.");
    const b = fact("b", "Ingrid Solberg approved the rollout.");
    const outcome = await iterativeRecall({
      query: "Who owns the release?",
      recall: lexicalRecall([a, b]),
      options: { analyzeBridgeText, maxHops: 5 },
    });
    expect(outcome.hops).toBeLessThan(5);
  });

  it("uses an injected follow-up decision and leaves lexical bridges empty", async () => {
    const queriesSeen: string[] = [];
    const outcome = await iterativeRecall({
      query,
      recall: (q) => {
        queriesSeen.push(q);
        return lexicalRecall(corpus)(q);
      },
      options: {
        maxHops: 3,
        // A stand-in "reasoning" strategy that walks the chain explicitly.
        decideNextHop: ({ hop }) =>
          hop === 1
            ? {
                missingSlots: ["Brunhilde Vasquez"],
                sufficient: false,
              }
            : hop === 2
              ? {
                  missingSlots: ["Tobias Quill"],
                  sufficient: false,
                }
              : {
                  missingSlots: [],
                  sufficient: true,
                },
      },
    });
    expect(outcome.hops).toBe(3);
    expect(outcome.bridgeEntities).toEqual([]);
    expect(outcome.result.facts.map((entry) => entry.id)).toContain("c-end");
    expect(queriesSeen).toEqual([query, "Brunhilde Vasquez", "Tobias Quill"]);
  });

  it("stops after one hop when the retrieved evidence is sufficient", async () => {
    const outcome = await iterativeRecall({
      query,
      recall: lexicalRecall(corpus),
      options: {
        maxHops: 4,
        decideNextHop: () => ({
          missingSlots: [],
          sufficient: true,
        }),
      },
    });

    expect(outcome.hops).toBe(1);
    expect(outcome.stopReason).toBe("evidence_sufficient");
    expect(outcome.steps[0]).toMatchObject({
      sufficiencyDecision: {
        missingSlots: [],
        sufficient: true,
      },
    });
  });

  it("does not retrieve again when the decision has no actionable missing slot", async () => {
    const queriesSeen: string[] = [];
    const outcome = await iterativeRecall({
      query,
      recall: async (activeQuery) => {
        queriesSeen.push(activeQuery);
        return lexicalRecall(corpus)(activeQuery);
      },
      options: {
        maxHops: 4,
        decideNextHop: () => ({
          missingSlots: [""],
          sufficient: false,
        }),
      },
    });

    expect(queriesSeen).toEqual([query]);
    expect(outcome.stopReason).toBe("missing_slots_unresolved");
  });

  it("passes cumulative unique evidence into later follow-up decisions", async () => {
    const evidenceByHop: string[][] = [];
    const factsByQuery = new Map([
      [query, [start]],
      ["Brunhilde Vasquez", [mid]],
      ["Tobias Quill", [end]],
    ]);
    const outcome = await iterativeRecall({
      query,
      recall: async (activeQuery) =>
        ({ facts: factsByQuery.get(activeQuery) ?? [] }) as RecallResult,
      options: {
        maxHops: 3,
        decideNextHop: ({ evidence, hop }) => {
          evidenceByHop.push(evidence.map((entry) => entry.content));
          return {
            missingSlots: [
              hop === 1 ? "Brunhilde Vasquez" : "Tobias Quill",
            ],
            sufficient: false,
          };
        },
      },
    });

    expect(outcome.hops).toBe(3);
    expect(evidenceByHop).toEqual([
      [start.content],
      [start.content, mid.content],
    ]);
  });

  it("treats distinct fact ids with identical content as new evidence", async () => {
    const decisions: number[] = [];
    const first = fact("same-content-1", "The status is unchanged.");
    const second = fact("same-content-2", "The status is unchanged.");
    let recallCount = 0;
    const outcome = await iterativeRecall({
      query: "What is the status?",
      recall: async () =>
        ({
          facts: recallCount++ === 0 ? [first] : [second],
        }) as RecallResult,
      options: {
        maxHops: 3,
        decideNextHop: ({ hop }) => {
          decisions.push(hop);
          return hop === 1
            ? {
                missingSlots: ["Retrieve the independently sourced status."],
                sufficient: false,
              }
            : {
                missingSlots: [],
                sufficient: true,
              };
        },
      },
    });

    expect(decisions).toEqual([1, 2]);
    expect(outcome.stopReason).toBe("evidence_sufficient");
  });
});
