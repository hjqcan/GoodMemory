import { describe, expect, it } from "bun:test";
import {
  createLocalEmbeddingAdapter,
  embedTextLocally,
} from "../../src/embedding/localEmbeddingAdapter";

function dot(left: number[], right: number[]): number {
  let sum = 0;
  for (let index = 0; index < left.length; index += 1) {
    sum += left[index] * right[index];
  }
  return sum;
}

function l2(vector: number[]): number {
  return Math.sqrt(dot(vector, vector));
}

describe("local embedding adapter", () => {
  it("is deterministic and L2-normalized at the requested dimension", () => {
    const a = embedTextLocally("the rollback checklist owner is Theo", 256);
    const b = embedTextLocally("the rollback checklist owner is Theo", 256);
    expect(a).toEqual(b);
    expect(a).toHaveLength(256);
    expect(l2(a)).toBeCloseTo(1, 6);
  });

  it("scores lexically related text above unrelated text (cosine = dot)", async () => {
    const adapter = createLocalEmbeddingAdapter();
    const [query, related, unrelated] = await adapter.embed([
      "what sport is the goaltender associated with",
      "the goaltender plays the sport of pesapallo",
      "the quarterly budget spreadsheet was emailed on friday",
    ]);
    const relatedScore = dot(query, related);
    const unrelatedScore = dot(query, unrelated);
    expect(relatedScore).toBeGreaterThan(unrelatedScore);
    expect(relatedScore).toBeGreaterThan(0.1);
  });

  it("captures morphological overlap via character n-grams", () => {
    // No shared whole token except via subwords (run/running, quick/quickly).
    const a = embedTextLocally("running quickly");
    const b = embedTextLocally("runner quick");
    const c = embedTextLocally("oceanic turbulence");
    expect(dot(a, b)).toBeGreaterThan(dot(a, c));
  });

  it("preserves Unicode words across every built-in script family", () => {
    const samples = [
      "品質閘門",
      "リリース手順",
      "출시 차단기",
      "mémoire française",
      "memoria española",
    ];

    for (const sample of samples) {
      expect(l2(embedTextLocally(sample))).toBeCloseTo(1, 6);
    }

    const koreanQuery = embedTextLocally("출시 차단기는 무엇인가요");
    const koreanRelated = embedTextLocally("출시 차단기는 검토 승인입니다");
    const unrelated = embedTextLocally("presupuesto trimestral");
    expect(dot(koreanQuery, koreanRelated)).toBeGreaterThan(
      dot(koreanQuery, unrelated),
    );
  });

  it("returns a zero vector for empty/symbol-only text without throwing", () => {
    const vector = embedTextLocally("!!!  ---", 64);
    expect(vector).toHaveLength(64);
    expect(l2(vector)).toBe(0);
  });

  it("rejects a non-positive dimension", () => {
    expect(() => createLocalEmbeddingAdapter({ dimensions: 0 })).toThrow(
      "positive integer",
    );
  });
});
