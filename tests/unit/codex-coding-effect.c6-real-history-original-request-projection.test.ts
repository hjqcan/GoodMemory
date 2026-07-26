import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";

import {
  createC6RealHistoryOriginalRequestProjection,
  validateC6RealHistoryOriginalRequestProjectionArtifact,
} from "../../scripts/codex-coding-effect/c6-real-history-original-request-projection";

const row = {
  body:
    "solution:\r\n- always unmount the old vnode and mount the new one.",
  instance_id: "vuejs__core-9213",
  number: 9213,
  org: "vuejs",
  repo: "core",
  resolved_issues: [
    {
      body: "The slot content does not toggle.",
      number: 7256,
      title: "Slot content is stale",
    },
  ],
  title: "fix(runtime-core): reveal the solution",
};
const rawRecord = `${JSON.stringify(row)}\n`;
const source = {
  fileBytes: Buffer.byteLength(rawRecord),
  fileSha256: sha256(rawRecord),
  path: "ts/vuejs__core_dataset.jsonl",
  rowIndex: 1,
  rowSha256: sha256(rawRecord),
};

describe("C6 real-history original-request projection", () => {
  it("materializes a clean exact prompt while retaining only hashes of excluded PR fields", () => {
    const projection =
      createC6RealHistoryOriginalRequestProjection({
        anchorId: "vuejs/core#9213",
        cappedPoolRank: 14,
        rawRecord,
        source,
      });

    expect(projection.originalRequest.value).toBe(
      "Issue #7256: Slot content is stale\n\n" +
      "The slot content does not toggle.",
    );
    expect(projection.originalRequest.value).not.toContain(
      "always unmount",
    );
    expect(projection.resolvedIssues).toEqual([{
      body: "The slot content does not toggle.",
      number: 7256,
      title: "Slot content is stale",
    }]);
    expect(projection.sourcePullExcluded).toEqual({
      bodySha256: sha256(row.body),
      titleSha256: sha256(row.title),
    });
    expect(projection.recording).toEqual({
      externalSourceCaptureAuthenticated: false,
      fullSourceFileRetained: false,
      fullSourceRowRetained: false,
      projectionProvesUpstreamAuthenticity: false,
    });
  });

  it("rejects source-row, candidate, and prompt drift", () => {
    expect(() =>
      createC6RealHistoryOriginalRequestProjection({
        anchorId: "vuejs/core#9213",
        cappedPoolRank: 14,
        rawRecord,
        source: {
          ...source,
          rowSha256: "a".repeat(64),
        },
      })
    ).toThrow();
    expect(() =>
      createC6RealHistoryOriginalRequestProjection({
        anchorId: "vuejs/core#9999",
        cappedPoolRank: 14,
        rawRecord,
        source,
      })
    ).toThrow();

    const projection =
      createC6RealHistoryOriginalRequestProjection({
        anchorId: "vuejs/core#9213",
        cappedPoolRank: 14,
        rawRecord,
        source,
      });
    const artifact = {
      artifactKind:
        "c6-real-history-original-request-projection",
      boundary: {
        acceptedEpisodeCount: 0,
        candidateManifestFrozen: false,
        codexRunReady: false,
        machineQualificationCandidateCount: 0,
      },
      policy: "resolved-issues-only-sorted-lf-trim-v1",
      projections: [projection],
      recording: {
        exactSourceFilesRequiredForReplay: true,
        externalSourceCaptureAuthenticated: false,
        independentReviewComplete: false,
      },
      schemaVersion: 1,
      source: {
        datasetId: "ByteDance-Seed/Multi-SWE-bench",
        inventorySha256: "b".repeat(64),
        revision:
          "56ff018c04a38e27ada1e9d0a6d5839a51f88f0d",
      },
    };
    const evidence =
      validateC6RealHistoryOriginalRequestProjectionArtifact({
        artifact,
        continuationCandidates: [{
          anchorId: "vuejs/core#9213",
          cappedPoolRank: 14,
          source: {
            path: source.path,
            rowIndex: source.rowIndex,
            rowSha256: source.rowSha256,
          },
        }],
      });
    expect(evidence).toEqual({
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      codexRunReady: false,
      machineQualificationCandidateCount: 0,
      materializedPromptCount: 1,
      promptDerivationVerified: true,
      stage1SemanticReviewPendingCount: 1,
      upstreamSourceAuthenticated: false,
    });

    const promptDrift = structuredClone(artifact);
    promptDrift.projections[0]!.originalRequest.value = "drift";
    expect(() =>
      validateC6RealHistoryOriginalRequestProjectionArtifact({
        artifact: promptDrift,
        continuationCandidates: [{
          anchorId: "vuejs/core#9213",
          cappedPoolRank: 14,
          source: {
            path: source.path,
            rowIndex: source.rowIndex,
            rowSha256: source.rowSha256,
          },
        }],
      })
    ).toThrow();

    const internallyConsistentRewrite = {
      ...artifact,
      projections: [{
        ...projection,
        originalRequest: {
          bytes: 7,
          sha256: sha256("rewrite"),
          value: "rewrite",
        },
      }],
    };
    expect(() =>
      validateC6RealHistoryOriginalRequestProjectionArtifact({
        artifact: internallyConsistentRewrite,
        continuationCandidates: [{
          anchorId: "vuejs/core#9213",
          cappedPoolRank: 14,
          source: {
            path: source.path,
            rowIndex: source.rowIndex,
            rowSha256: source.rowSha256,
          },
        }],
      })
    ).toThrow("prompt derivation does not match");

    const resolvedIssueDrift = {
      ...artifact,
      projections: [{
        ...projection,
        resolvedIssueRecordSha256: "c".repeat(64),
      }],
    };
    expect(() =>
      validateC6RealHistoryOriginalRequestProjectionArtifact({
        artifact: resolvedIssueDrift,
        continuationCandidates: [{
          anchorId: "vuejs/core#9213",
          cappedPoolRank: 14,
          source: {
            path: source.path,
            rowIndex: source.rowIndex,
            rowSha256: source.rowSha256,
          },
        }],
      })
    ).toThrow("prompt derivation does not match");
  });
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
