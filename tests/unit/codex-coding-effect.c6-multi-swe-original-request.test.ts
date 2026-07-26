import { describe, expect, it } from "bun:test";

import {
  constructC6MultiSWEOriginalRequest,
} from "../../scripts/codex-coding-effect/c6-multi-swe-original-request";

describe("C6 Multi-SWE original-request construction", () => {
  it("builds the agent-visible request only from resolved issues", () => {
    const result = constructC6MultiSWEOriginalRequest({
      body:
        "solution:\r\n- always unmount the old vnode and mount the new one.",
      resolved_issues: [
        {
          body: "The fallback content does not toggle correctly.\r\n",
          number: 7256,
          title: "Slot content does not update",
        },
      ],
      title: "fix(runtime-core): reveal the solution",
    });

    expect(result).toEqual({
      originalRequest:
        "Issue #7256: Slot content does not update\n\n" +
        "The fallback content does not toggle correctly.",
      originalRequestSha256:
        "177d6d29858c4cb77e12bb557547ac403d9fb3fb824bd58841c5be568e0c4ba1",
      policy:
        "resolved-issues-only-sorted-lf-trim-v1",
      resolvedIssueRecordSha256:
        "3a2939aa653f25d3667e3ce3ccb2105466799e7ecd43547d0d4da579179cb5be",
      resolvedIssues: [{
        body: "The fallback content does not toggle correctly.",
        number: 7256,
        title: "Slot content does not update",
      }],
      sourcePullTitleBodyExcluded: true,
    });
    expect(result.originalRequest).not.toContain("solution:");
    expect(result.originalRequest).not.toContain("always unmount");
    expect(result.originalRequest).not.toContain(
      "fix(runtime-core)",
    );
  });

  it("sorts multiple issues and normalizes line endings deterministically", () => {
    const left = constructC6MultiSWEOriginalRequest({
      body: "gold approach",
      resolved_issues: [
        {
          body: "Second\rbody",
          number: 20,
          title: " Second ",
        },
        {
          body: "\nFirst\n",
          number: 10,
          title: "First",
        },
      ],
      title: "solution pull",
    });
    const right = constructC6MultiSWEOriginalRequest({
      body: "different hidden solution",
      resolved_issues: [
        {
          body: "First",
          number: 10,
          title: "First",
        },
        {
          body: "Second\nbody",
          number: 20,
          title: "Second",
        },
      ],
      title: "different pull title",
    });

    expect(left).toEqual(right);
    expect(left.originalRequest).toBe(
      "Issue #10: First\n\nFirst\n\n---\n\n" +
      "Issue #20: Second\n\nSecond\nbody",
    );
  });

  it("rejects blank, missing, or duplicate resolved issues", () => {
    const invalidRows = [
      {
        body: "solution",
        resolved_issues: [],
        title: "pull",
      },
      {
        body: "solution",
        resolved_issues: [
          { body: "", number: 1, title: "Issue" },
        ],
        title: "pull",
      },
      {
        body: "solution",
        resolved_issues: [
          { body: "A", number: 1, title: "Issue A" },
          { body: "B", number: 1, title: "Issue B" },
        ],
        title: "pull",
      },
    ];

    for (const row of invalidRows) {
      expect(() =>
        constructC6MultiSWEOriginalRequest(row)
      ).toThrow();
    }
  });
});
