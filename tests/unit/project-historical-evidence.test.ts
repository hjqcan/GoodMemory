import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";

import {
  assertHistoricalEvidenceProjectionCurrent,
  refreshHistoricalEvidenceProjection,
} from "../../scripts/project-historical-evidence";

describe("historical evidence projection", () => {
  it("derives tracked source bytes and hashes from the source artifacts", async () => {
    const source = new TextEncoder().encode("source report\n");
    const projection = {
      artifactKind: "tracked-historical-evidence-projection",
      benchmark: "Example",
      generatedBy: "manual",
      runIdentity: {
        commit: "0123456789abcdef0123456789abcdef01234567",
        runId: "run-example",
      },
      schemaVersion: 1,
      sourceArtifacts: [{
        bytes: 1,
        path: "reports/example.json",
        sha256: "0".repeat(64),
      }],
    };

    const refreshed = await refreshHistoricalEvidenceProjection({
      projection,
      readArtifact: async (path) => {
        expect(path).toBe("reports/example.json");
        return source;
      },
    });

    expect(refreshed).toMatchObject({
      generatedBy: "scripts/project-historical-evidence.ts",
      sourceArtifacts: [{
        bytes: source.byteLength,
        path: "reports/example.json",
        sha256: createHash("sha256").update(source).digest("hex"),
      }],
    });
    expect(() => assertHistoricalEvidenceProjectionCurrent({
      actual: projection,
      expected: refreshed,
    })).toThrow("source fingerprints drifted");
    expect(() => assertHistoricalEvidenceProjectionCurrent({
      actual: refreshed,
      expected: refreshed,
    })).not.toThrow();
  });

  it("derives LoCoMo claim values from the frozen source report", async () => {
    const path =
      "reports/quality-gates/phase-72/run-20260716-final/phase-72-release-gate.json";
    const source = new TextEncoder().encode(JSON.stringify({
      metrics: {
        locomo: {
          executionFailures: 0,
          officialJudgeFailures: 0,
          officialScore: 0.87,
          openDomainScore: 0.61,
          strictScore: 0.63,
        },
      },
      packageVersion: "0.6.0",
    }));
    const projection = {
      artifactKind: "tracked-historical-evidence-projection",
      benchmark: "LoCoMo",
      claim: {
        executionFailures: 0,
        officialJudgeFailures: 0,
        officialScore: 1,
        openDomainScore: 1,
        packageVersion: "0.6.0",
        strictScore: 1,
      },
      generatedBy: "scripts/project-historical-evidence.ts",
      schemaVersion: 1,
      sourceArtifacts: [{ path }],
    };

    const refreshed = await refreshHistoricalEvidenceProjection({
      projection,
      readArtifact: async () => source,
    });

    expect(refreshed.claim).toEqual({
      executionFailures: 0,
      officialJudgeFailures: 0,
      officialScore: 0.87,
      openDomainScore: 0.61,
      packageVersion: "0.6.0",
      strictScore: 0.63,
    });
    expect(() => assertHistoricalEvidenceProjectionCurrent({
      actual: projection,
      expected: refreshed,
    })).toThrow("claims or source fingerprints drifted");
  });
});
