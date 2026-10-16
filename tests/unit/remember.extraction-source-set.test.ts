import { describe, expect, it } from "bun:test";
import { dedupeExtractionResult, mergeExtractionResults } from "../../src/remember/extraction";
import type { MemoryCandidate } from "../../src/remember/candidates";

const candidate = (id: string, indexes?: number[], primary = 0): MemoryCandidate => ({
  id, kindHint: "fact", explicitness: "explicit", content: "Launch depends on review.",
  sourceMessageIndex: primary, sourceRole: "user",
  ...(indexes === undefined ? {} : { sourceMessageIndexes: indexes }),
});
const result = (...candidates: MemoryCandidate[]) => ({ candidates, ignoredMessageCount: 0 });

describe("extraction source-set identity", () => {
  for (const reverse of [false, true]) {
    it(`keeps different source sets distinct, reverse=${reverse}`, () => {
      const pair = [candidate("same", [0]), candidate("same", [0, 1])];
      if (reverse) pair.reverse();
      const merged = mergeExtractionResults(result(pair[0]!), result(pair[1]!));
      expect(merged.candidates).toHaveLength(2);
      expect(merged.candidates.map((c) => c.sourceMessageIndexes)).toEqual(pair.map((c) => c.sourceMessageIndexes));
      expect(merged.candidates.map((c) => c.id)).toEqual(["same", "llm-same-1"]);
      expect(dedupeExtractionResult(result(...pair)).candidates).toHaveLength(2);
    });
  }
  it("merges equivalent permutations and repeats without mutating either source array", () => {
    const left = candidate("left", [10, 2, 2]);
    const right = candidate("right", [2, 0, 10, 0]);
    left.extractorIds = ["a"]; right.extractorIds = ["b"];
    left.ruleIds = ["r1"]; right.ruleIds = ["r2"];
    left.extractionSources = ["rules-only"]; right.extractionSources = ["llm-assisted"];
    right.annotation = { remember: "always" };
    right.profileId = "profile"; right.presetId = "preset";
    const before = structuredClone([left, right]);
    Object.freeze(left.sourceMessageIndexes); Object.freeze(right.sourceMessageIndexes);
    const merged = mergeExtractionResults(result(left), result(right));
    expect(merged.candidates).toHaveLength(1);
    expect(merged.candidates[0]).toMatchObject({ id: "left", sourceMessageIndexes: [10, 2, 2],
      extractorIds: ["a", "b"], ruleIds: ["r1", "r2"], extractionSources: ["rules-only", "llm-assisted"],
      annotation: { remember: "always" }, profileId: "profile", presetId: "preset" });
    expect([left, right]).toEqual(before);
  });
  for (const indexes of [undefined, [], [0], [0, 0]]) {
    it(`treats primary-only representation ${JSON.stringify(indexes)} as equivalent`, () => {
      expect(dedupeExtractionResult(result(candidate("a"), candidate("b", indexes))).candidates).toHaveLength(1);
    });
  }
  it("keeps the primary separately even when the complete set is equal", () => {
    expect(dedupeExtractionResult(result(candidate("a", [1], 0), candidate("b", [0], 1))).candidates).toHaveLength(2);
  });
});
