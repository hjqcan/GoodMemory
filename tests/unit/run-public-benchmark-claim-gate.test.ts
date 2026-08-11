import { createHash } from "node:crypto";

import { describe, expect, it } from "bun:test";

import type { BenchmarkClaimReport } from "../../scripts/run-public-benchmark-claim-gate";
import {
  buildClaimGateReport,
  checkClaimEvidenceArtifacts,
  checkReadmeHistoricalEvidenceTables,
  checkReadmeClaimTables,
  collectClaimNotes,
  evaluateClaimBoundary,
  extractPublicClaimsTableRows,
  extractHistoricalEvidenceTableRows,
  parsePublicBenchmarkClaimGateCliOptions,
  README_CLAIMS_TABLE_END,
  README_CLAIMS_TABLE_START,
  README_HISTORICAL_EVIDENCE_TABLE_END,
  README_HISTORICAL_EVIDENCE_TABLE_START,
  validateClaimReport,
} from "../../scripts/run-public-benchmark-claim-gate";

const FULL_COMMIT = "0123456789abcdef0123456789abcdef01234567";
const SOURCE_SHA256 = "a".repeat(64);

function historicalProjection(
  overrides: Record<string, unknown> = {},
  benchmark = "LongMemEval",
): Record<string, unknown> {
  return {
    artifactKind: "tracked-historical-evidence-projection",
    benchmark,
    generatedBy: "scripts/project-historical-evidence.ts",
    runIdentity: {
      commit: FULL_COMMIT,
      runId: "run-longmemeval-full500",
    },
    schemaVersion: 1,
    sourceArtifacts: [
      {
        bytes: 610477,
        path: "reports/eval/longmemeval/report.json",
        sha256: SOURCE_SHA256,
      },
    ],
    ...overrides,
  };
}

function historicalProjectionAssertions(benchmark = "LongMemEval") {
  return [
    { equals: "tracked-historical-evidence-projection", path: ["artifactKind"] },
    { equals: benchmark, path: ["benchmark"] },
    { equals: "scripts/project-historical-evidence.ts", path: ["generatedBy"] },
    { equals: 1, path: ["schemaVersion"] },
    { equals: 610477, path: ["sourceArtifacts", 0, "bytes"] },
    {
      equals: "reports/eval/longmemeval/report.json",
      path: ["sourceArtifacts", 0, "path"],
    },
    { equals: SOURCE_SHA256, path: ["sourceArtifacts", 0, "sha256"] },
    { equals: FULL_COMMIT, path: ["runIdentity", "commit"] },
    { equals: "run-longmemeval-full500", path: ["runIdentity", "runId"] },
  ];
}

function cleanReport(overrides: Partial<BenchmarkClaimReport> = {}): BenchmarkClaimReport {
  return {
    benchmark: "Example",
    claimBoundary: { publicClaimAllowed: true, reason: "all rules satisfied" },
    comparison: {
      asOf: "2026-07-09",
      availability: "production-default",
      notes: ["Same benchmark protocol and disclosed model stack."],
      runtimeProfile: "generalized-default",
      source: "https://example.com/reference",
    },
    coverage: { complete: true },
    dataset: { license: "MIT", source: "https://example.com/bench", vendored: false },
    evidence: {
      artifacts: [
        {
          assertions: [{ equals: true, path: ["ok"] }],
          description: "example report",
          path: "reports/example-report.json",
        },
      ],
    },
    metrics: {
      baseline: 0.5,
      metricDirection: "higher-is-better",
      primary: "accuracy",
      score: 0.8,
    },
    model: { answerModel: "model-a", judgeModel: null, sameModelJudge: false },
    publicClaim: {
      readmeDisclosureFragments: ["disclosed"],
      readmeRequiredFragments: ["x"],
    },
    run: {
      command: "eval:example",
      commit: FULL_COMMIT,
      executionFailures: 0,
      packageVersion: "0.3.5",
    },
    status: "candidate_public_claim",
    ...overrides,
  };
}

function candidateWithHistoricalProjection(): BenchmarkClaimReport {
  return {
    ...cleanReport({
      benchmark: "LoCoMo",
      evidence: {
        artifacts: [
          {
            assertions: [{ equals: true, path: ["ok"] }],
            description: "current v0.7.3 evidence",
            path: "reports/current-locomo.json",
          },
          {
            assertions: historicalProjectionAssertions("LoCoMo"),
            description: "tracked v0.6.0 projection",
            path: "benchmark-claims/evidence/locomo-v0.6.0-historical.json",
          },
        ],
      },
      publicClaim: {
        readmeDisclosureFragments: ["current-disclosure"],
        readmeRequiredFragments: ["current-0.9000"],
      },
    }),
    historicalPresentation: {
      readmeDisclosureFragments: ["historical-disclosure"],
      readmeRequiredFragments: ["0.6300", "0.8700", "0.6100"],
    },
  } as BenchmarkClaimReport;
}

function locomoHistoricalProjection(): Record<string, unknown> {
  return historicalProjection({
    claim: {
      officialScore: 0.87,
      openDomainScore: 0.61,
      strictScore: 0.63,
    },
  }, "LoCoMo");
}

describe("claim boundary rule engine", () => {
  it("allows a public claim only when no rule fires", () => {
    const verdict = evaluateClaimBoundary(cleanReport());
    expect(verdict.publicClaimAllowed).toBe(true);
    expect(verdict.blockers).toEqual([]);
  });

  it("derives and blocks a same-model judge even when the declaration denies it", () => {
    const verdict = evaluateClaimBoundary(
      cleanReport({ model: { answerModel: "gpt-5.5", judgeModel: "gpt-5.5", sameModelJudge: false } }),
    );
    expect(verdict.publicClaimAllowed).toBe(false);
    expect(verdict.blockers.join(" ")).toContain("same-model judge");
  });

  it("uses provider-qualified model identity without trusting gateway spelling", () => {
    const verdict = evaluateClaimBoundary(
      cleanReport({
        model: {
          answerGateway: "https://gateway.example/v1/",
          answerModel: "openai/gpt-5.5",
          answerProvider: "OpenAI",
          judgeGateway: "https://gateway.example/v1",
          judgeModel: "gpt-5.5",
          judgeProvider: "openai",
          sameModelJudge: false,
        },
      }),
    );
    expect(verdict.publicClaimAllowed).toBe(false);
    expect(verdict.blockers.join(" ")).toContain("same-model judge");
  });

  it("requires a full commit and a directionally better score", () => {
    const shortCommit = evaluateClaimBoundary(
      cleanReport({ run: { ...cleanReport().run, commit: "abc1234" } }),
    );
    expect(shortCommit.publicClaimAllowed).toBe(false);
    expect(shortCommit.blockers.join(" ")).toContain("40-character hexadecimal");

    const regressedAccuracy = evaluateClaimBoundary(
      cleanReport({
        metrics: {
          baseline: 0.8,
          metricDirection: "higher-is-better",
          primary: "accuracy",
          score: 0.79,
        },
      }),
    );
    expect(regressedAccuracy.publicClaimAllowed).toBe(false);
    expect(regressedAccuracy.blockers.join(" ")).toContain("must be greater than baseline");

    const regressedLatency = evaluateClaimBoundary(
      cleanReport({
        metrics: {
          baseline: 100,
          metricDirection: "lower-is-better",
          primary: "p95 latency",
          score: 101,
        },
      }),
    );
    expect(regressedLatency.publicClaimAllowed).toBe(false);
    expect(regressedLatency.blockers.join(" ")).toContain("must be less than baseline");
    expect(
      evaluateClaimBoundary(
        cleanReport({
          metrics: {
            baseline: 100,
            metricDirection: "lower-is-better",
            primary: "p95 latency",
            score: 99,
          },
        }),
      ).publicClaimAllowed,
    ).toBe(true);
  });

  it("blocks profiles that users cannot run from the public package", () => {
    const verdict = evaluateClaimBoundary(
      cleanReport({
        comparison: {
          ...cleanReport().comparison,
          availability: "repo-eval-only",
        },
      }),
    );

    expect(verdict.publicClaimAllowed).toBe(false);
    expect(verdict.blockers.join(" ")).toContain("repo-eval-only");
  });

  it("blocks non-candidate statuses and results measured on another package version", () => {
    const historical = evaluateClaimBoundary(
      cleanReport({ status: "internal_evidence" }),
    );
    expect(historical.publicClaimAllowed).toBe(false);
    expect(historical.blockers.join(" ")).toContain("internal_evidence");

    const staleVersion = evaluateClaimBoundary(cleanReport(), {
      currentPackageVersion: "0.6.0",
    });
    expect(staleVersion.publicClaimAllowed).toBe(false);
    expect(staleVersion.blockers.join(" ")).toContain(
      "measured package version 0.3.5 does not match current package version 0.6.0",
    );
  });

  it("blocks on execution failures, missing baseline, broken provenance, and incomplete coverage", () => {
    expect(
      evaluateClaimBoundary(cleanReport({ run: { ...cleanReport().run, executionFailures: 1 } }))
        .publicClaimAllowed,
    ).toBe(false);
    expect(
      evaluateClaimBoundary(cleanReport({
        metrics: {
          baseline: null,
          metricDirection: "higher-is-better",
          primary: "accuracy",
          score: 0.8,
        },
      }))
        .publicClaimAllowed,
    ).toBe(false);
    expect(
      evaluateClaimBoundary(cleanReport({ dataset: { license: null, source: "x", vendored: false } }))
        .publicClaimAllowed,
    ).toBe(false);
    expect(
      evaluateClaimBoundary(cleanReport({ coverage: { complete: false, note: "TTL/LRU unfinished" } }))
        .publicClaimAllowed,
    ).toBe(false);
    expect(
      evaluateClaimBoundary(cleanReport({ evidence: { artifacts: [] } })).publicClaimAllowed,
    ).toBe(false);
  });
});

describe("claim report schema validation", () => {
  it("accepts a well-formed report and rejects a malformed one", () => {
    expect(validateClaimReport(cleanReport()).valid).toBe(true);
    const bad = validateClaimReport({ benchmark: "X" });
    expect(bad.valid).toBe(false);
    expect(bad.errors.length).toBeGreaterThan(0);
  });

  it("requires historical claims to depend on tracked evidence projections", () => {
    const report = cleanReport({
      claimBoundary: { publicClaimAllowed: false, reason: "historical only" },
      comparison: {
        ...cleanReport().comparison,
        availability: "historical",
      },
      status: "internal_evidence",
    });
    const invalid = validateClaimReport(report);
    expect(invalid.valid).toBe(false);
    expect(invalid.errors).toContain(
      "historical evidence artifacts must live under benchmark-claims/evidence",
    );

    expect(validateClaimReport({
      ...report,
      evidence: {
        artifacts: [{
          assertions: historicalProjectionAssertions("Example"),
          description: "tracked projection",
          path: "benchmark-claims/evidence/example.json",
        }],
      },
    }).valid).toBe(true);
  });

  it("requires current comparison provenance and profile availability", () => {
    const missing = validateClaimReport({
      ...cleanReport(),
      comparison: undefined,
    });
    expect(missing.valid).toBe(false);
    expect(missing.errors.join(" ")).toContain("comparison");

    const malformed = validateClaimReport({
      ...cleanReport(),
      comparison: {
        asOf: "July 9",
        availability: "private",
        notes: [],
        runtimeProfile: " fitted ",
        source: "",
      },
    });
    expect(malformed.valid).toBe(false);
    expect(malformed.errors.join(" ")).toContain("comparison.asOf");
    expect(malformed.errors.join(" ")).toContain("comparison.availability");
  });

  it("rejects malformed typed declaration fields before rule evaluation", () => {
    const malformed = validateClaimReport({
      ...cleanReport(),
      coverage: { complete: "true", note: " full coverage " },
      dataset: { license: " MIT", source: "", vendored: "false" },
      metrics: {
        baseline: "0.5",
        metricDirection: "sideways",
        primary: " accuracy ",
        score: Number.NaN,
      },
      model: {
        answerGateway: " gateway ",
        answerModel: "",
        answerProvider: " provider ",
        judgeModel: " gpt-judge ",
        sameModelJudge: "false",
      },
      run: { command: "", commit: " abc1234", executionFailures: 1.5, packageVersion: null },
    });
    expect(malformed.valid).toBe(false);
    expect(malformed.errors).toContain("coverage.complete must be a boolean");
    expect(malformed.errors).toContain(
      "coverage.note must be a non-empty unpadded string when present",
    );
    expect(malformed.errors).toContain("dataset.source must be a non-empty unpadded string");
    expect(malformed.errors).toContain("dataset.license must be a non-empty unpadded string");
    expect(malformed.errors).toContain("dataset.vendored must be a boolean");
    expect(malformed.errors).toContain("run.command must be a non-empty unpadded string");
    expect(malformed.errors).toContain("run.commit must be a non-empty unpadded string");
    expect(malformed.errors).toContain(
      "run.executionFailures must be a non-negative safe integer",
    );
    expect(malformed.errors).toContain("run.packageVersion must be a non-empty unpadded string");
    expect(malformed.errors).toContain("model.answerModel must be a non-empty unpadded string");
    expect(malformed.errors).toContain(
      "model.judgeModel must be null or a non-empty unpadded string",
    );
    expect(malformed.errors).toContain("model.sameModelJudge must be a boolean");
    expect(malformed.errors).toContain(
      "metrics.baseline and score must be finite numbers, primary must be a non-empty unpadded string, and metricDirection must be higher-is-better or lower-is-better",
    );
    expect(malformed.errors).toContain(
      "model.answerProvider must be a non-empty unpadded string when present",
    );
    expect(malformed.errors).toContain(
      "model.answerGateway must be a non-empty unpadded string when present",
    );
  });

  it("requires a complete 40-character hexadecimal commit", () => {
    const invalid = validateClaimReport(
      cleanReport({ run: { ...cleanReport().run, commit: "abc1234" } }),
    );
    expect(invalid.valid).toBe(false);
    expect(invalid.errors).toContain(
      "run.commit must be a complete 40-character hexadecimal commit",
    );
  });

  it("requires coverage to be declared explicitly", () => {
    const missingCoverage = validateClaimReport(cleanReport({ coverage: undefined }));
    expect(missingCoverage.valid).toBe(false);
    expect(missingCoverage.errors).toContain("coverage must be an object");
  });

  it("requires public declarations to define README display and disclosure fragments", () => {
    const missingPublicClaim = validateClaimReport(
      cleanReport({
        publicClaim: undefined,
      }),
    );
    expect(missingPublicClaim.valid).toBe(false);
    expect(missingPublicClaim.errors).toContain(
      "publicClaim must be an object for public claim declarations",
    );

    const malformedFragments = validateClaimReport(
      cleanReport({
        publicClaim: {
          readmeDisclosureFragments: ["disclosed", " disclosed ", "disclosed"],
          readmeRequiredFragments: ["0.8", " 0.5 ", "0.8"],
        },
      }),
    );
    expect(malformedFragments.valid).toBe(false);
    expect(malformedFragments.errors).toContain(
      "publicClaim.readmeRequiredFragments[1] must be a non-empty unpadded string",
    );
    expect(malformedFragments.errors).toContain(
      "publicClaim.readmeRequiredFragments[2] duplicates fragment 0.8",
    );
    expect(malformedFragments.errors).toContain(
      "publicClaim.readmeDisclosureFragments[1] must be a non-empty unpadded string",
    );
    expect(malformedFragments.errors).toContain(
      "publicClaim.readmeDisclosureFragments[2] duplicates fragment disclosed",
    );
  });

  it("rejects malformed evidence assertions before artifact checks", () => {
    const malformedEvidence = {
      artifacts: [
        {
          assertions: [
            { equals: 0, path: [] },
            { equals: { nested: true }, path: ["summary"] },
          ],
          description: "bad assertions",
          path: "reports/example-report.json",
        },
      ],
    } as unknown as BenchmarkClaimReport["evidence"];
    const bad = validateClaimReport(
      cleanReport({
        evidence: malformedEvidence,
      }),
    );
    expect(bad.valid).toBe(false);
    expect(bad.errors.join(" ")).toContain("path must be a non-empty array");
    expect(bad.errors.join(" ")).toContain("equals must be a JSON scalar");
  });

  it("requires JSON evidence artifacts to carry assertions", () => {
    const missingAssertions = validateClaimReport(
      cleanReport({
        evidence: {
          artifacts: [{ description: "json without assertions", path: "reports/example.json" }],
        },
      }),
    );
    expect(missingAssertions.valid).toBe(false);
    expect(missingAssertions.errors).toContain(
      "evidence.artifacts[0].assertions must be a non-empty array for JSON artifacts",
    );

    const emptyAssertions = validateClaimReport(
      cleanReport({
        evidence: {
          artifacts: [
            {
              assertions: [],
              description: "json with empty assertions",
              path: "reports/example.json",
            },
          ],
        },
      }),
    );
    expect(emptyAssertions.valid).toBe(false);
    expect(emptyAssertions.errors).toContain(
      "evidence.artifacts[0].assertions must be a non-empty array for JSON artifacts",
    );
  });

  it("rejects historical declarations whose assertions do not bind projection provenance", () => {
    const report = cleanReport({
      claimBoundary: { publicClaimAllowed: false, reason: "historical only" },
      comparison: { ...cleanReport().comparison, availability: "historical" },
      evidence: {
        artifacts: [{
          assertions: [{ equals: true, path: ["ok"] }],
          description: "unbound projection",
          path: "benchmark-claims/evidence/example.json",
        }],
      },
      status: "internal_evidence",
    });
    const invalid = validateClaimReport(report);
    expect(invalid.valid).toBe(false);
    expect(invalid.errors.join(" ")).toContain(
      "historical projection assertions must bind artifactKind, benchmark, generatedBy, schemaVersion, sourceArtifacts path/bytes/sha256, and runIdentity or scorerIdentity",
    );
  });
});

describe("claim gate report", () => {
  it("rejects duplicate CLI mode and source flags before claim evaluation", () => {
    expect(() =>
      parsePublicBenchmarkClaimGateCliOptions([
        "bun",
        "run",
        "scripts/run-public-benchmark-claim-gate.ts",
        "--strict",
        "--strict",
      ]),
    ).toThrow("--strict cannot be specified more than once.");

    expect(() =>
      parsePublicBenchmarkClaimGateCliOptions([
        "bun",
        "run",
        "scripts/run-public-benchmark-claim-gate.ts",
        "--claims-dir",
        "/tmp/claims-a",
        "--claims-dir",
        "/tmp/claims-b",
      ]),
    ).toThrow("--claims-dir cannot be specified more than once.");
  });

  it("flags over-claiming (declared public when rules forbid)", () => {
    const overClaim = cleanReport({
      benchmark: "OverClaimer",
      model: { answerModel: "gpt-5.5", judgeModel: "gpt-5.5", sameModelJudge: true },
      claimBoundary: { publicClaimAllowed: true, reason: "wishful" },
    });
    const report = buildClaimGateReport(
      [{ file: "overclaimer.json", value: overClaim }],
      "2026-06-24T00:00:00Z",
    );
    expect(report.summary.overClaiming).toBe(1);
    expect(report.entries[0]?.consistent).toBe(false);
    expect(report.allConsistent).toBe(false);
    expect(report.publicClaimable).toEqual([]);
  });

  it("treats an honest blocked declaration as consistent and lists a clean one as claimable", () => {
    const blockedHonest = cleanReport({
      benchmark: "HonestBlocked",
      model: { answerModel: "gpt-5.5", judgeModel: "gpt-5.5", sameModelJudge: true },
      claimBoundary: { publicClaimAllowed: false, reason: "same-model judge" },
    });
    const clean = cleanReport({ benchmark: "Clean" });
    const report = buildClaimGateReport(
      [
        { file: "honestblocked.json", value: blockedHonest },
        { file: "clean.json", value: clean },
      ],
      "2026-06-24T00:00:00Z",
    );
    expect(report.allConsistent).toBe(true);
    expect(report.summary.overClaiming).toBe(0);
    expect(report.publicClaimable).toEqual(["Clean"]);
  });

  it("marks a schema-invalid declaration inconsistent", () => {
    const report = buildClaimGateReport([{ file: "broken.json", value: { benchmark: "Broken" } }], "t");
    expect(report.entries[0]?.schemaErrors.length).toBeGreaterThan(0);
    expect(report.allConsistent).toBe(false);
  });

  it("requires declaration filenames to match benchmark names", () => {
    const report = buildClaimGateReport(
      [{ file: "wrong-file.json", value: cleanReport({ benchmark: "LongMemEval" }) }],
      "t",
    );
    expect(report.entries[0]?.schemaErrors).toEqual([
      "claim declaration filename must be longmemeval.json for benchmark LongMemEval",
    ]);
    expect(report.entries[0]?.consistent).toBe(false);
    expect(report.summary.overClaiming).toBe(1);
    expect(report.publicClaimable).toEqual([]);
  });

  it("blocks a vendored dataset", () => {
    const verdict = evaluateClaimBoundary(
      cleanReport({ dataset: { license: "MIT", source: "https://example.com", vendored: true } }),
    );
    expect(verdict.publicClaimAllowed).toBe(false);
    expect(verdict.blockers.join(" ")).toContain("vendored");
  });

  it("notes a non-commercial license without blocking it", () => {
    const nc = cleanReport({
      dataset: { license: "CC BY-NC 4.0", source: "https://example.com", vendored: false },
    });
    expect(evaluateClaimBoundary(nc).publicClaimAllowed).toBe(true);
    expect(collectClaimNotes(nc).join(" ")).toContain("non-commercial");
    expect(collectClaimNotes(cleanReport())).toEqual([]);
  });

  it("treats unreadable declared evidence artifacts as claim blockers", () => {
    const report = buildClaimGateReport(
      [{ file: "evidencebacked.json", value: cleanReport({ benchmark: "EvidenceBacked" }) }],
      "t",
      [],
      new Map([
        ["evidencebacked.json", ["evidence artifact reports/missing.json cannot be read"]],
      ]),
    );
    expect(report.entries[0]?.computedPublicClaimAllowed).toBe(false);
    expect(report.entries[0]?.consistent).toBe(false);
    expect(report.entries[0]?.blockers.join(" ")).toContain("evidence artifact");
    expect(report.publicClaimable).toEqual([]);
  });

  it("fails consistency for broken evidence artifacts even when a declaration is already blocked", () => {
    const blocked = cleanReport({
      benchmark: "BlockedWithBrokenEvidence",
      claimBoundary: { publicClaimAllowed: false, reason: "same-model judge" },
      model: { answerModel: "gpt-5.5", judgeModel: "gpt-5.5", sameModelJudge: true },
    });
    const report = buildClaimGateReport(
      [{ file: "blockedwithbrokenevidence.json", value: blocked }],
      "t",
      [],
      new Map([
        [
          "blockedwithbrokenevidence.json",
          ["evidence artifact reports/missing.json cannot be read"],
        ],
      ]),
    );
    expect(report.entries[0]?.computedPublicClaimAllowed).toBe(false);
    expect(report.entries[0]?.consistent).toBe(false);
    expect(report.allConsistent).toBe(false);
  });

  it("checks declared evidence artifact paths without trusting claim prose", async () => {
    const ok = await checkClaimEvidenceArtifacts({
      file: "clean.json",
      readFile: async () => "{\"ok\":true}",
      repoRoot: "/repo",
      report: cleanReport(),
    });
    expect(ok).toEqual([]);

    const unsafe = await checkClaimEvidenceArtifacts({
      file: "unsafe.json",
      readFile: async () => "{\"ok\":true}",
      repoRoot: "/repo",
      report: cleanReport({
        evidence: { artifacts: [{ description: "unsafe", path: "../outside.json" }] },
      }),
    });
    expect(unsafe.join(" ")).toContain("must be a repo-relative path");

    const missing = await checkClaimEvidenceArtifacts({
      file: "missing.json",
      readFile: async () => {
        throw new Error("not found");
      },
      repoRoot: "/repo",
      report: cleanReport(),
    });
    expect(missing.join(" ")).toContain("cannot be read");

    const empty = await checkClaimEvidenceArtifacts({
      file: "empty.json",
      readFile: async () => "   ",
      repoRoot: "/repo",
      report: cleanReport(),
    });
    expect(empty.join(" ")).toContain("is empty");

    const malformedJson = await checkClaimEvidenceArtifacts({
      file: "malformed.json",
      readFile: async () => "{not-json",
      repoRoot: "/repo",
      report: cleanReport(),
    });
    expect(malformedJson.join(" ")).toContain("is not valid JSON");

    const mismatch = await checkClaimEvidenceArtifacts({
      file: "mismatch.json",
      readFile: async () => "{\"summary\":{\"executionFailures\":1}}",
      repoRoot: "/repo",
      report: cleanReport({
        evidence: {
          artifacts: [
            {
              assertions: [{ equals: 0, path: ["summary", "executionFailures"] }],
              description: "example report",
              path: "reports/example-report.json",
            },
          ],
        },
      }),
    });
    expect(mismatch.join(" ")).toContain("expected 0 but found 1");

    const missingPath = await checkClaimEvidenceArtifacts({
      file: "missing-path.json",
      readFile: async () => "{\"summary\":{}}",
      repoRoot: "/repo",
      report: cleanReport({
        evidence: {
          artifacts: [
            {
              assertions: [{ equals: 0, path: ["summary", "executionFailures"] }],
              description: "example report",
              path: "reports/example-report.json",
            },
          ],
        },
      }),
    });
    expect(missingPath.join(" ")).toContain("path summary.executionFailures was not found");
  });

  it("validates historical projections and rejects arbitrary ok JSON", async () => {
    const sourcePath =
      "reports/quality-gates/phase-72/run-20260716-final/phase-72-release-gate.json";
    const source = JSON.stringify({
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
    });
    const sourceBytes = new TextEncoder().encode(source).byteLength;
    const sourceSha256 = createHash("sha256").update(source).digest("hex");
    const projection = historicalProjection({
      claim: {
        executionFailures: 0,
        officialJudgeFailures: 0,
        officialScore: 0.87,
        openDomainScore: 0.61,
        packageVersion: "0.6.0",
        strictScore: 0.63,
      },
      sourceArtifacts: [{
        bytes: sourceBytes,
        path: sourcePath,
        sha256: sourceSha256,
      }],
    }, "LoCoMo");
    const assertions = historicalProjectionAssertions("LoCoMo").map((assertion) => {
      const path = assertion.path.join(".");
      if (path === "sourceArtifacts.0.bytes") {
        return { ...assertion, equals: sourceBytes };
      }
      if (path === "sourceArtifacts.0.path") {
        return { ...assertion, equals: sourcePath };
      }
      if (path === "sourceArtifacts.0.sha256") {
        return { ...assertion, equals: sourceSha256 };
      }
      return assertion;
    });
    const report = cleanReport({
      benchmark: "LoCoMo",
      claimBoundary: { publicClaimAllowed: false, reason: "historical only" },
      comparison: { ...cleanReport().comparison, availability: "historical" },
      evidence: {
        artifacts: [{
          assertions,
          description: "tracked projection",
          path: "benchmark-claims/evidence/locomo-v0.6.0-historical.json",
        }],
      },
      publicClaim: {
        readmeDisclosureFragments: ["historical"],
        readmeRequiredFragments: ["0.6300", "0.8700", "0.6100"],
      },
      status: "internal_evidence",
    });
    const valid = await checkClaimEvidenceArtifacts({
      file: "locomo.json",
      readFile: async (path) => {
        if (path.endsWith("locomo-v0.6.0-historical.json")) {
          return JSON.stringify(projection);
        }
        throw new Error("claim gate must not read ignored historical sources");
      },
      repoRoot: "/repo",
      report,
    });
    expect(valid).toEqual([]);

    const selfAttested = await checkClaimEvidenceArtifacts({
      file: "locomo.json",
      readFile: async () => JSON.stringify(projection),
      repoRoot: "/repo",
      report: {
        ...report,
        publicClaim: {
          ...report.publicClaim!,
          readmeRequiredFragments: ["0.9999", "0.8700", "0.6100"],
        },
      },
    });
    expect(selfAttested.join(" ")).toContain(
      "source-derived README fragment 0.6300",
    );

    const arbitrary = await checkClaimEvidenceArtifacts({
      file: "locomo.json",
      readFile: async () => JSON.stringify({ ok: true }),
      repoRoot: "/repo",
      report,
    });
    expect(arbitrary.join(" ")).toContain(
      "historical projection artifactKind must be tracked-historical-evidence-projection",
    );
    expect(arbitrary.join(" ")).toContain("historical projection generatedBy");
    expect(arbitrary.join(" ")).toContain("historical projection sourceArtifacts");
    expect(arbitrary.join(" ")).toContain("historical projection requires runIdentity or scorerIdentity");
  });

  it("requires historical source bytes and identity fields to be assertion-bound", async () => {
    const report = cleanReport({
      benchmark: "LongMemEval",
      claimBoundary: { publicClaimAllowed: false, reason: "historical only" },
      comparison: { ...cleanReport().comparison, availability: "historical" },
      evidence: {
        artifacts: [{
          assertions: historicalProjectionAssertions().filter(
            ({ path }) => path.join(".") !== "sourceArtifacts.0.bytes",
          ),
          description: "tracked projection",
          path: "benchmark-claims/evidence/longmemeval-historical.json",
        }],
      },
      status: "internal_evidence",
    });
    const errors = await checkClaimEvidenceArtifacts({
      file: "longmemeval.json",
      readFile: async () => JSON.stringify(historicalProjection()),
      repoRoot: "/repo",
      report,
    });
    expect(errors.join(" ")).toContain(
      "historical projection field sourceArtifacts[0].bytes must be bound by an evidence assertion",
    );
  });
});

function readmeWithRows(rows: string[]): string {
  return [
    "# Title",
    "",
    README_CLAIMS_TABLE_START,
    "| Benchmark | Result | Claim declaration |",
    "|---|---:|---|",
    ...rows,
    README_CLAIMS_TABLE_END,
    "",
    "disclosed",
    "",
  ].join("\n");
}

function historicalReadmeWithRows(rows: string[]): string {
  return [
    "# Title",
    "",
    README_HISTORICAL_EVIDENCE_TABLE_START,
    "| Benchmark | Result | Claim declaration |",
    "|---|---:|---|",
    ...rows,
    README_HISTORICAL_EVIDENCE_TABLE_END,
    "",
    "disclosed",
    "",
  ].join("\n");
}

describe("README public-claims table check", () => {
  it("extracts rows between the markers, skipping header and separator", () => {
    const parsed = extractPublicClaimsTableRows(
      readmeWithRows([
        "| LongMemEval full 500 | **0.720** | [x](./benchmark-claims/longmemeval.json) |",
        "| MemoryAgentBench (CR, TTL) | **CR 0.959** | [x](./benchmark-claims/memoryagentbench.json) |",
      ]),
    );
    expect(parsed.markersFound).toBe(true);
    expect(parsed.rows).toEqual(["LongMemEval full 500", "MemoryAgentBench (CR, TTL)"]);
  });

  it("reports missing markers", () => {
    expect(extractPublicClaimsTableRows("# no table here").markersFound).toBe(false);
  });

  it("passes when public rows map to claimable declarations and flags forbidden/unknown rows", () => {
    const entries = buildClaimGateReport(
      [
        { file: "longmemeval.json", value: cleanReport({ benchmark: "LongMemEval" }) },
        {
          file: "beam.json",
          value: cleanReport({
            benchmark: "BEAM",
            model: { answerModel: "gpt-5.5", judgeModel: "gpt-5.5", sameModelJudge: true },
            claimBoundary: { publicClaimAllowed: false, reason: "same-model judge" },
          }),
        },
      ],
      "t",
    ).entries;

    const ok = checkReadmeClaimTables(
      [
        {
          content: readmeWithRows([
            "| LongMemEval full 500 | x | [longmemeval.json](./benchmark-claims/longmemeval.json) |",
          ]),
          file: "README.md",
        },
      ],
      entries,
    )[0];
    expect(ok?.consistent).toBe(true);

    const forbidden = checkReadmeClaimTables(
      [{ content: readmeWithRows(["| BEAM (100K) | x | y |"]), file: "README.md" }],
      entries,
    )[0];
    expect(forbidden?.consistent).toBe(false);
    expect(forbidden?.forbiddenRows).toEqual(["BEAM (100K)"]);

    const unknown = checkReadmeClaimTables(
      [{ content: readmeWithRows(["| MysteryBench | x | y |"]), file: "README.md" }],
      entries,
    )[0];
    expect(unknown?.consistent).toBe(false);
    expect(unknown?.unmatchedRows).toEqual(["MysteryBench"]);

    const missingMarkers = checkReadmeClaimTables(
      [{ content: "# stripped", file: "README.zh-CN.md" }],
      entries,
    )[0];
    expect(missingMarkers?.consistent).toBe(false);
  });

  it("requires public claim rows to link to their declaration files", () => {
    const entries = buildClaimGateReport(
      [{ file: "longmemeval.json", value: cleanReport({ benchmark: "LongMemEval" }) }],
      "t",
    ).entries;
    const missingLink = checkReadmeClaimTables(
      [{ content: readmeWithRows(["| LongMemEval full 500 | x | no link |"]), file: "README.md" }],
      entries,
    )[0];
    expect(missingLink?.consistent).toBe(false);
    expect(missingLink?.declarationLinkErrors).toEqual([
      "LongMemEval full 500 must link to benchmark-claims/longmemeval.json",
    ]);

    const wrongLink = checkReadmeClaimTables(
      [
        {
          content: readmeWithRows([
            "| LongMemEval full 500 | x | [beam.json](./benchmark-claims/beam.json) |",
          ]),
          file: "README.md",
        },
      ],
      entries,
    )[0];
    expect(wrongLink?.consistent).toBe(false);
    expect(wrongLink?.declarationLinkErrors).toEqual([
      "LongMemEval full 500 must link to benchmark-claims/longmemeval.json",
    ]);
  });

  it("requires public claim rows to include declaration-controlled result fragments", () => {
    const entries = buildClaimGateReport(
      [
        {
          file: "longmemeval.json",
          value: cleanReport({
            benchmark: "LongMemEval",
            publicClaim: {
              readmeDisclosureFragments: ["disclosed"],
              readmeRequiredFragments: ["0.720", "360/500", "0.068"],
            },
          }),
        },
      ],
      "t",
    ).entries;
    const ok = checkReadmeClaimTables(
      [
        {
          content: readmeWithRows([
            "| LongMemEval full 500 | **0.720** (360/500) vs 0.068 | [longmemeval.json](./benchmark-claims/longmemeval.json) |",
          ]),
          file: "README.md",
        },
      ],
      entries,
    )[0];
    expect(ok?.consistent).toBe(true);

    const drifted = checkReadmeClaimTables(
      [
        {
          content: readmeWithRows([
            "| LongMemEval full 500 | **0.999** (360/500) vs 0.068 | [longmemeval.json](./benchmark-claims/longmemeval.json) |",
          ]),
          file: "README.md",
        },
      ],
      entries,
    )[0];
    expect(drifted?.consistent).toBe(false);
    expect(drifted?.claimContentErrors).toEqual([
      'LongMemEval full 500 must include declaration fragment "0.720"',
    ]);
  });

  it("requires promoted README prose to include declaration-controlled disclosure fragments", () => {
    const entries = buildClaimGateReport(
      [
        {
          file: "beam.json",
          value: cleanReport({
            benchmark: "BEAM",
            publicClaim: {
              readmeDisclosureFragments: ["gpt-5.4", "0.9621", "0.6822"],
              readmeRequiredFragments: ["0.802"],
            },
          }),
        },
      ],
      "t",
    ).entries;
    const ok = checkReadmeClaimTables(
      [
        {
          content: `${readmeWithRows([
            "| BEAM 100K | **0.802** | [beam.json](./benchmark-claims/beam.json) |",
          ])}\nBEAM uses gpt-5.4 and reports fitted 0.9621 with generalization 0.6822.\n`,
          file: "README.md",
        },
      ],
      entries,
    )[0];
    expect(ok?.consistent).toBe(true);

    const missingDisclosure = checkReadmeClaimTables(
      [
        {
          content: readmeWithRows([
            "| BEAM 100K | **0.802** | [beam.json](./benchmark-claims/beam.json) |",
          ]),
          file: "README.md",
        },
      ],
      entries,
    )[0];
    expect(missingDisclosure?.consistent).toBe(false);
    expect(missingDisclosure?.disclosureErrors).toEqual([
      'BEAM 100K README disclosure must include declaration fragment "gpt-5.4"',
      'BEAM 100K README disclosure must include declaration fragment "0.9621"',
      'BEAM 100K README disclosure must include declaration fragment "0.6822"',
    ]);
  });

  it("requires claimable benchmarks to stay promoted in the public claims table", () => {
    const entries = buildClaimGateReport(
      [{ file: "longmemeval.json", value: cleanReport({ benchmark: "LongMemEval" }) }],
      "t",
    ).entries;
    const check = checkReadmeClaimTables(
      [{ content: readmeWithRows([]), file: "README.md" }],
      entries,
    )[0];
    expect(check?.consistent).toBe(false);
    expect(check?.missingClaimableBenchmarks).toEqual(["LongMemEval"]);
  });

  it("feeds readme consistency into the gate report", () => {
    const declarations = [
      { file: "longmemeval.json", value: cleanReport({ benchmark: "LongMemEval" }) },
    ];
    const good = buildClaimGateReport(declarations, "t", [
      {
        content: readmeWithRows([
          "| LongMemEval full 500 | x | [longmemeval.json](./benchmark-claims/longmemeval.json) |",
        ]),
        file: "README.md",
      },
    ]);
    expect(good.readmeConsistent).toBe(true);
    const missingRow = buildClaimGateReport(declarations, "t", [
      { content: readmeWithRows([]), file: "README.md" },
    ]);
    expect(missingRow.readmeConsistent).toBe(false);
    const bad = buildClaimGateReport(declarations, "t", [
      { content: "# no markers", file: "README.md" },
    ]);
    expect(bad.readmeConsistent).toBe(false);
  });
});

describe("README historical-evidence table check", () => {
  const historical = cleanReport({
    benchmark: "LongMemEval",
    claimBoundary: {
      publicClaimAllowed: false,
      reason: "retained as versioned historical evidence",
    },
    comparison: {
      ...cleanReport().comparison,
      availability: "historical",
    },
    evidence: {
      artifacts: [{
        assertions: historicalProjectionAssertions(),
        description: "tracked projection",
        path: "benchmark-claims/evidence/longmemeval-historical.json",
      }],
    },
    status: "internal_evidence",
  });

  it("extracts and validates versioned evidence without promoting it", () => {
    const markdown = historicalReadmeWithRows([
      "| LongMemEval full 500 | x | [longmemeval.json](./benchmark-claims/longmemeval.json) |",
    ]);
    expect(extractHistoricalEvidenceTableRows(markdown).rows).toEqual([
      "LongMemEval full 500",
    ]);

    const report = buildClaimGateReport(
      [{ file: "longmemeval.json", value: historical }],
      "t",
      [],
      new Map(),
      "0.5.1",
    );
    expect(report.publicClaimable).toEqual([]);
    expect(report.historicalEvidence).toEqual(["LongMemEval"]);
    const check = checkReadmeHistoricalEvidenceTables(
      [{ content: markdown, file: "README.md" }],
      report.entries,
    )[0];
    expect(check?.consistent).toBe(true);
  });

  it("does not accept historical evidence in the current-claims table", () => {
    const entries = buildClaimGateReport(
      [{ file: "longmemeval.json", value: historical }],
      "t",
      [],
      new Map(),
      "0.5.1",
    ).entries;
    const check = checkReadmeClaimTables(
      [
        {
          content: readmeWithRows([
            "| LongMemEval full 500 | x | [longmemeval.json](./benchmark-claims/longmemeval.json) |",
          ]),
          file: "README.md",
        },
      ],
      entries,
    )[0];
    expect(check?.consistent).toBe(false);
    expect(check?.forbiddenRows).toEqual(["LongMemEval full 500"]);
  });

  it("keeps verified candidate history separate from its current public presentation", async () => {
    const candidate = candidateWithHistoricalProjection();
    expect(validateClaimReport(candidate).valid).toBe(true);
    expect(await checkClaimEvidenceArtifacts({
      file: "locomo.json",
      readFile: async (path) => path.endsWith("locomo-v0.6.0-historical.json")
        ? JSON.stringify(locomoHistoricalProjection())
        : JSON.stringify({ ok: true }),
      repoRoot: "/repo",
      report: candidate,
    })).toEqual([]);

    const report = buildClaimGateReport(
      [{ file: "locomo.json", value: candidate }],
      "t",
    );
    expect(report.publicClaimable).toEqual(["LoCoMo"]);
    expect(report.historicalEvidence).toEqual(["LoCoMo"]);

    const current = checkReadmeClaimTables(
      [{
        content: `${readmeWithRows([
          "| LoCoMo current | current-0.9000 | [locomo.json](./benchmark-claims/locomo.json) |",
        ])}\ncurrent-disclosure`,
        file: "README.md",
      }],
      report.entries,
    )[0];
    const historicalCheck = checkReadmeHistoricalEvidenceTables(
      [{
        content: `${historicalReadmeWithRows([
          "| LoCoMo v0.6.0 | 0.6300 / 0.8700 / 0.6100 | [locomo.json](./benchmark-claims/locomo.json) |",
        ])}\nhistorical-disclosure`,
        file: "README.md",
      }],
      report.entries,
    )[0];
    expect(current?.consistent).toBe(true);
    expect(historicalCheck?.consistent).toBe(true);

    const crossed = checkReadmeHistoricalEvidenceTables(
      [{
        content: `${historicalReadmeWithRows([
          "| LoCoMo v0.6.0 | current-0.9000 | [locomo.json](./benchmark-claims/locomo.json) |",
        ])}\ncurrent-disclosure`,
        file: "README.md",
      }],
      report.entries,
    )[0];
    expect(crossed?.consistent).toBe(false);
    expect(crossed?.claimContentErrors.join(" ")).toContain("0.6300");
    expect(crossed?.disclosureErrors.join(" ")).toContain("historical-disclosure");
  });

  it("forbids candidate history without a verified projection or after tampering", async () => {
    const fieldOnly = {
      ...cleanReport({ benchmark: "LoCoMo" }),
      historicalEvidence: true,
    } as BenchmarkClaimReport;
    const fieldOnlyReport = buildClaimGateReport(
      [{ file: "locomo.json", value: fieldOnly }],
      "t",
    );
    expect(fieldOnlyReport.historicalEvidence).toEqual([]);

    const presentationOnly = {
      ...cleanReport({ benchmark: "LoCoMo" }),
      historicalPresentation: {
        readmeDisclosureFragments: ["historical-disclosure"],
        readmeRequiredFragments: ["0.6300"],
      },
    } as BenchmarkClaimReport;
    expect(validateClaimReport(presentationOnly).errors.join(" ")).toContain(
      "historicalPresentation requires a tracked historical projection",
    );

    const assertionTampered = candidateWithHistoricalProjection();
    assertionTampered.evidence.artifacts[1]!.assertions =
      assertionTampered.evidence.artifacts[1]!.assertions!.filter(
        ({ path }) => path.join(".") !== "sourceArtifacts.0.bytes",
      );
    const assertionReport = buildClaimGateReport(
      [{ file: "locomo.json", value: assertionTampered }],
      "t",
    );
    expect(assertionReport.historicalEvidence).toEqual([]);
    expect(assertionReport.entries[0]?.schemaErrors.join(" ")).toContain(
      "historicalPresentation requires a tracked historical projection",
    );

    const artifactTampered = candidateWithHistoricalProjection();
    const evidenceErrors = await checkClaimEvidenceArtifacts({
      file: "locomo.json",
      readFile: async (path) => path.endsWith("locomo-v0.6.0-historical.json")
        ? JSON.stringify({ ...locomoHistoricalProjection(), artifactKind: "arbitrary-json" })
        : JSON.stringify({ ok: true }),
      repoRoot: "/repo",
      report: artifactTampered,
    });
    expect(evidenceErrors.join(" ")).toContain(
      "historical projection artifactKind must be tracked-historical-evidence-projection",
    );
    const tamperedReport = buildClaimGateReport(
      [{ file: "locomo.json", value: artifactTampered }],
      "t",
      [],
      new Map([["locomo.json", evidenceErrors]]),
    );
    expect(tamperedReport.historicalEvidence).toEqual([]);
    const forbidden = checkReadmeHistoricalEvidenceTables(
      [{
        content: historicalReadmeWithRows([
          "| LoCoMo v0.6.0 | 0.6300 | [locomo.json](./benchmark-claims/locomo.json) |",
        ]),
        file: "README.md",
      }],
      tamperedReport.entries,
    )[0];
    expect(forbidden?.forbiddenRows).toEqual(["LoCoMo v0.6.0"]);
  });
});
