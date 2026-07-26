import { describe, expect, it } from "bun:test";

import {
  assertC6RelationshipReviewDecisionCoverage,
  validateC6TaskOriginReviewProvenance,
} from "../../scripts/codex-coding-effect/c6-task-origin-review";
import type {
  CodexCodingEffectDatasetV2,
  CodexCodingEffectDatasetV3,
} from "../../scripts/codex-coding-effect/dataset";

describe("Codex coding-effect C6 task-origin review", () => {
  it("rejects the legacy dataset protocol before reading review artifacts", async () => {
    const legacyDataset = {
      datasetId: "legacy-dataset",
      episodes: [],
      schemaVersion: 2,
    } as unknown as CodexCodingEffectDatasetV2;

    await expect(validateC6TaskOriginReviewProvenance({
      assetLock: {
        assetRootSha256: "a".repeat(64),
        files: [],
        schemaVersion: 1,
      },
      dataset:
        legacyDataset as unknown as CodexCodingEffectDatasetV3,
      datasetRoot: "/does/not-matter",
      taskContentSha256ByEpisodeId: {},
      taskOriginEvidenceByEpisodeId: {},
    })).rejects.toThrow("C6 task-origin review requires dataset schema version 3");
  });

  it("rejects missing, duplicate, extra, reordered, or hash-drifted edge decisions", () => {
    const first = {
      edgeId: "episode-1/stage-1->stage-2",
      episodeId: "episode-1",
      relationshipReceiptSha256: "a".repeat(64),
    };
    const second = {
      edgeId: "episode-1/stage-2->stage-3",
      episodeId: "episode-1",
      relationshipReceiptSha256: "b".repeat(64),
    };
    const expected = [first, second];
    expect(() =>
      assertC6RelationshipReviewDecisionCoverage(expected, expected)
    ).not.toThrow();
    for (const actual of [
      [first],
      [first, first],
      [first, second, {
        ...second,
        edgeId: "episode-1/stage-3->stage-4",
      }],
      [second, first],
      [first, {
        ...second,
        relationshipReceiptSha256: "c".repeat(64),
      }],
    ]) {
      expect(() =>
        assertC6RelationshipReviewDecisionCoverage(expected, actual)
      ).toThrow("relationship decisions do not cover the exact edge set");
    }
  });
});
