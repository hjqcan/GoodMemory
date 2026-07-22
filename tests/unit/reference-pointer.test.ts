import { describe, expect, it } from "bun:test";

import {
  extractReferencePointers,
} from "../../src/domain/referencePointer";

describe("reference pointer parsing", () => {
  it("keeps Unicode URL paths as one canonical pointer", () => {
    expect(
      extractReferencePointers(
        "Use https://example.com/文档/运行手册.md?rev=1#当前 as the source of truth.",
      ),
    ).toEqual([
      "https://example.com/文档/运行手册.md?rev=1#当前",
    ]);
  });

  it("keeps Unicode local paths while rejecting numeric versions and decimals", () => {
    expect(extractReferencePointers("请查看 文档/当前运行手册.md。"))
      .toEqual(["文档/当前运行手册.md"]);
    expect(extractReferencePointers("release v0.7.0 uses score 3.14"))
      .toEqual([]);
  });
});
