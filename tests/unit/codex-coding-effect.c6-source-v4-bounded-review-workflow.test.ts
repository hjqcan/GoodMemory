import {
  describe,
  expect,
  it,
} from "bun:test";

import {
  parseC6SourceV4BoundedReviewPreparationCliOptions,
} from "../../scripts/prepare-codex-coding-effect-c6-source-v4-bounded-review";
import {
  parseC6SourceV4BoundedReviewProvenanceCliOptions,
} from "../../scripts/record-codex-coding-effect-c6-source-v4-bounded-review-provenance";

const AUTHOR = "/root";
const REVIEWER =
  "/root/c6_source_v4_bounded_review_v1";
const SNAPSHOT_ROOT = "/tmp/c6-v4-snapshot";

describe("C6 source-v4 bounded review workflow", () => {
  it("parses only exact create-only preparation and recorder options", () => {
    const options = [
      `--author-task-name=${AUTHOR}`,
      "--output-root=/tmp/c6-v4-review",
      `--reviewer-agent-name=${REVIEWER}`,
      `--snapshot-root=${SNAPSHOT_ROOT}`,
    ];
    expect(
      parseC6SourceV4BoundedReviewPreparationCliOptions(
        options,
      ),
    ).toEqual({
      authorTaskName: AUTHOR,
      outputRoot: "/tmp/c6-v4-review",
      reviewerAgentName: REVIEWER,
      snapshotRoot: SNAPSHOT_ROOT,
    });
    expect(
      parseC6SourceV4BoundedReviewProvenanceCliOptions(
        options.slice(0, 3),
      ),
    ).toEqual({
      authorTaskName: AUTHOR,
      outputRoot: "/tmp/c6-v4-review",
      reviewerAgentName: REVIEWER,
    });
    expect(() =>
      parseC6SourceV4BoundedReviewPreparationCliOptions([
        ...options,
        "--replace",
      ])
    ).toThrow("unknown");
  });
});
