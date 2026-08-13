import { describe, expect, it } from "bun:test";

import type {
  BenchmarkClaimReport,
  ClaimGateEntry,
} from "../../scripts/run-public-benchmark-claim-gate";
import {
  buildClaimGateReport,
  checkReadmeClaimTables,
  checkReadmeHistoricalEvidenceTables,
  CLAIM_PROMOTION_UNAVAILABLE_ERROR,
  evaluateClaimBoundary,
  evaluateHistoricalEvidenceBoundary,
  extractHistoricalEvidenceTableRows,
  extractPublicClaimsTableRows,
  parsePublicBenchmarkClaimGateCliOptions,
  README_CLAIMS_TABLE_END,
  README_CLAIMS_TABLE_START,
  README_HISTORICAL_EVIDENCE_TABLE_END,
  README_HISTORICAL_EVIDENCE_TABLE_START,
  renderClaimGateSummary,
  validateClaimReport,
} from "../../scripts/run-public-benchmark-claim-gate";

const PACKAGE_VERSION = "0.7.4";
const FULL_COMMIT = "0123456789abcdef0123456789abcdef01234567";
const FULL_TREE = "89abcdef0123456789abcdef0123456789abcdef";

function makeClaimReport(overrides: Partial<BenchmarkClaimReport> = {}): BenchmarkClaimReport {
  return {
    benchmark: "Example",
    claimBoundary: {
      publicClaimAllowed: false,
      reason: "Internal diagnostic only.",
    },
    comparison: {
      asOf: "2026-08-13",
      availability: "repo-eval-only",
      notes: [],
      runtimeProfile: "diagnostic",
      source: "Official benchmark protocol",
    },
    coverage: { complete: true },
    dataset: {
      license: "CC-BY-4.0",
      source: "https://example.test/benchmark",
      vendored: false,
    },
    evidence: { artifacts: [] },
    metrics: {
      baseline: 0.5,
      metricDirection: "higher-is-better",
      primary: "accuracy",
      score: 0.8,
    },
    model: {
      answerModel: "answer-model",
      answerProvider: "generator-provider",
      judgeModel: "judge-model",
      judgeProvider: "judge-provider",
      sameModelJudge: false,
    },
    run: {
      command: "bun run benchmark:example",
      commit: FULL_COMMIT,
      executionFailures: 0,
      packageVersion: PACKAGE_VERSION,
      runId: "example-full",
      tree: FULL_TREE,
    },
    status: "paused_boundary",
    ...overrides,
  };
}

function promotionCandidate(): BenchmarkClaimReport {
  return makeClaimReport({
    claimBoundary: {
      publicClaimAllowed: true,
      reason: "Requested public promotion.",
    },
    comparison: {
      ...makeClaimReport().comparison,
      availability: "production-default",
      runtimeProfile: "public-default",
    },
    status: "candidate_public_claim",
  });
}

function historicalCandidate(): BenchmarkClaimReport {
  return makeClaimReport({
    comparison: {
      ...makeClaimReport().comparison,
      availability: "historical",
      runtimeProfile: "retired-v0.7.3",
    },
    status: "internal_evidence",
  });
}

function emptyReadme(file: string): { content: string; file: string } {
  return {
    content: [
      README_CLAIMS_TABLE_START,
      "No current benchmark claims.",
      README_CLAIMS_TABLE_END,
      README_HISTORICAL_EVIDENCE_TABLE_START,
      "No versioned historical evidence.",
      README_HISTORICAL_EVIDENCE_TABLE_END,
    ].join("\n"),
    file,
  };
}

describe("public benchmark claim gate", () => {
  it("validates paused diagnostic declarations", () => {
    expect(validateClaimReport(makeClaimReport())).toEqual({
      errors: [],
      valid: true,
    });
  });

  it("rejects declaration-owned README presentation fields", () => {
    const forged = {
      ...makeClaimReport(),
      publicClaim: {
        readmeDisclosureFragments: [],
        readmeRequiredFragments: [],
      },
    };

    expect(validateClaimReport(forged).errors).toContain(
      "claim declarations cannot provide README presentation fragments",
    );
  });

  it("keeps current promotion unavailable even when measurement fields look valid", () => {
    const verdict = evaluateClaimBoundary(promotionCandidate(), {
      currentPackageVersion: PACKAGE_VERSION,
    });

    expect(verdict.publicClaimAllowed).toBe(false);
    expect(verdict.blockers).toContain(CLAIM_PROMOTION_UNAVAILABLE_ERROR);
  });

  it("keeps historical promotion unavailable under the same measurement boundary", () => {
    const verdict = evaluateHistoricalEvidenceBoundary(historicalCandidate());

    expect(verdict.historicalEvidenceAllowed).toBe(false);
    expect(verdict.blockers).toContain(CLAIM_PROMOTION_UNAVAILABLE_ERROR);
  });

  it("retains measurement blockers in addition to the empty allowlist", () => {
    const report = promotionCandidate();
    report.run.executionFailures = 2;
    report.coverage = { complete: false };
    report.model = {
      answerModel: "same-model",
      judgeModel: "same-model",
      sameModelJudge: true,
    };

    const blockers = evaluateClaimBoundary(report, {
      currentPackageVersion: PACKAGE_VERSION,
    }).blockers;

    expect(blockers).toContain("executionFailures must be 0 (got 2)");
    expect(blockers).toContain("benchmark coverage must be complete");
    expect(blockers).toContain("same-model judge requires an independent evaluator");
    expect(blockers).toContain(CLAIM_PROMOTION_UNAVAILABLE_ERROR);
  });

  it("accepts the repository's paused shape without checking diagnostic artifacts", () => {
    const report = buildClaimGateReport(
      [{ file: "example.json", value: makeClaimReport() }],
      "2026-08-13T12:00:00.000Z",
      [emptyReadme("README.md"), emptyReadme("README.zh-CN.md")],
      PACKAGE_VERSION,
    );

    expect(report.allConsistent).toBe(true);
    expect(report.publicClaimable).toEqual([]);
    expect(report.historicalEvidence).toEqual([]);
    expect(report.readmeConsistent).toBe(true);
    expect(report.historicalReadmeConsistent).toBe(true);
  });

  it("cannot promote current or historical claims through injected evidence state", () => {
    const report = buildClaimGateReport(
      [
        { file: "example.json", value: promotionCandidate() },
        {
          file: "archive.json",
          value: { ...historicalCandidate(), benchmark: "Archive" },
        },
      ],
      "2026-08-13T12:00:00.000Z",
      [emptyReadme("README.md")],
      PACKAGE_VERSION,
    );

    expect(report.publicClaimable).toEqual([]);
    expect(report.historicalEvidence).toEqual([]);
    expect(report.allConsistent).toBe(false);
    expect(report.entries.every(({ blockers }) =>
      blockers.includes(CLAIM_PROMOTION_UNAVAILABLE_ERROR)
    )).toBe(true);
  });

  it("requires declaration filenames to match normalized benchmark names", () => {
    const report = buildClaimGateReport(
      [{ file: "wrong.json", value: makeClaimReport() }],
      "2026-08-13T12:00:00.000Z",
      [emptyReadme("README.md")],
      PACKAGE_VERSION,
    );

    expect(report.entries[0]?.schemaErrors).toEqual([
      "claim declaration filename must be example.json",
    ]);
  });

  it("allows only empty current and historical README tables", () => {
    const entry: ClaimGateEntry = {
      benchmark: "Example",
      blockers: [],
      computedPublicClaimAllowed: false,
      consistent: true,
      declaredPublicClaimAllowed: false,
      file: "example.json",
      historicalEvidenceEligible: false,
      notes: [],
      schemaErrors: [],
      status: "paused_boundary",
    };
    const readmes = [emptyReadme("README.md")];

    expect(checkReadmeClaimTables(readmes, [entry])[0]?.consistent).toBe(true);
    expect(
      checkReadmeHistoricalEvidenceTables(readmes, [entry])[0]?.consistent,
    ).toBe(true);

    const forged = [{
      file: "README.md",
      content: emptyReadme("README.md").content.replace(
        "No current benchmark claims.",
        "| [Example](./benchmark-claims/example.json) | 0.80 |",
      ),
    }];
    expect(checkReadmeClaimTables(forged, [entry])[0]).toMatchObject({
      consistent: false,
      forbiddenRows: ["Example"],
    });
  });

  it("extracts only rows inside the canonical table markers", () => {
    const markdown = [
      "| Outside | 1.0 |",
      README_CLAIMS_TABLE_START,
      "| Benchmark | Score |",
      "|---|---|",
      "| Example | 0.8 |",
      README_CLAIMS_TABLE_END,
      README_HISTORICAL_EVIDENCE_TABLE_START,
      "| Archive | 0.7 |",
      README_HISTORICAL_EVIDENCE_TABLE_END,
    ].join("\n");

    expect(extractPublicClaimsTableRows(markdown).rows).toEqual(["Example"]);
    expect(extractHistoricalEvidenceTableRows(markdown).rows).toEqual(["Archive"]);
  });

  it("parses strict CLI flags and rejects duplicate scalar flags", () => {
    expect(parsePublicBenchmarkClaimGateCliOptions([
      "--strict",
      "--claims-dir",
      "benchmark-claims",
    ])).toEqual({ claimsDir: "benchmark-claims", strict: true });

    expect(() => parsePublicBenchmarkClaimGateCliOptions([
      "--claims-dir",
      "a",
      "--claims-dir",
      "b",
    ])).toThrow("--claims-dir");
  });

  it("renders the unavailable promotion boundary in the summary", () => {
    const report = buildClaimGateReport(
      [{ file: "example.json", value: makeClaimReport() }],
      "2026-08-13T12:00:00.000Z",
      [emptyReadme("README.md")],
      PACKAGE_VERSION,
    );

    expect(renderClaimGateSummary(report)).toContain(
      "Promotion is unavailable until an end-to-end runner and verifier are implemented together.",
    );
  });
});
