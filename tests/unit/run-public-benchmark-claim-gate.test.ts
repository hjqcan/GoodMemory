import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import type {
  BenchmarkClaimReport,
  ClaimEvidenceRepositoryVerifier,
} from "../../scripts/run-public-benchmark-claim-gate";
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
const FULL_TREE = "89abcdef0123456789abcdef0123456789abcdef";
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

function currentClaimProjection(
  benchmark = "LoCoMo",
  packageVersion = "0.3.5",
): Record<string, unknown> {
  return {
    artifactKind: "tracked-current-claim-projection",
    benchmark,
    claim: { officialScore: 0.8, packageVersion },
    generatedBy: "scripts/run-current-claim.ts",
    runIdentity: { commit: FULL_COMMIT },
    schemaVersion: 1,
    sourceArtifacts: [{
      bytes: 610477,
      path: "reports/eval/current/report.json",
      sha256: SOURCE_SHA256,
    }],
  };
}

function currentClaimProjectionAssertions(
  benchmark = "LoCoMo",
  packageVersion = "0.3.5",
) {
  return [
    { equals: "tracked-current-claim-projection", path: ["artifactKind"] },
    { equals: benchmark, path: ["benchmark"] },
    { equals: "scripts/run-current-claim.ts", path: ["generatedBy"] },
    { equals: 1, path: ["schemaVersion"] },
    { equals: FULL_COMMIT, path: ["runIdentity", "commit"] },
    { equals: packageVersion, path: ["claim", "packageVersion"] },
    { equals: 0.8, path: ["claim", "officialScore"] },
  ];
}

function verifiedProjection(input: {
  baseline?: number;
  benchmark?: string;
  commit?: string;
  coverageActual?: number;
  coverageExpected?: number;
  executionFailures?: number;
  packageVersion?: string;
  presentation?: "current" | "historical";
  score?: number;
  source: string;
  sourceArtifactPath?: string;
}): Record<string, unknown> {
  const sourceArtifactPath = input.sourceArtifactPath ?? "reports/example-source.json";
  const benchmark = input.benchmark ?? "Example";
  const presentation = input.presentation ?? "current";
  const metrics = benchmark === "LoCoMo"
    ? {
        baseline: input.baseline ?? 0.5,
        openDomainCorrect: 61,
        openDomainScore: 0.61,
        openDomainTotal: 100,
        score: input.score ?? 0.8,
        strictScore: 0.63,
      }
    : {
        baseline: input.baseline ?? 0.5,
        score: input.score ?? 0.8,
      };
  return {
    artifactKind: "verified-benchmark-claim-projection",
    benchmark,
    bindings: [
      {
        projectionPath: ["run", "commit"],
        sourceArtifactPath,
        sourceJsonPath: ["run", "commit"],
      },
      {
        projectionPath: ["run", "packageVersion"],
        sourceArtifactPath,
        sourceJsonPath: ["run", "packageVersion"],
      },
      {
        projectionPath: ["run", "tree"],
        sourceArtifactPath,
        sourceJsonPath: ["run", "tree"],
      },
      {
        projectionPath: ["run", "runId"],
        sourceArtifactPath,
        sourceJsonPath: ["run", "runId"],
      },
      {
        projectionPath: ["run", "executionFailureCounts", 0],
        sourceArtifactPath,
        sourceJsonPath: ["run", "executionFailures"],
      },
      {
        projectionPath: ["run", "executionFailures"],
        sourceArtifactPath,
        sourceJsonPath: ["run", "executionFailures"],
      },
      {
        projectionPath: ["coverage", "complete"],
        sourceArtifactPath,
        sourceJsonPath: ["coverage", "complete"],
      },
      {
        projectionPath: ["coverage", "segments", 0, "name"],
        sourceArtifactPath,
        sourceJsonPath: ["coverage", "name"],
      },
      {
        projectionPath: ["coverage", "segments", 0, "actual"],
        sourceArtifactPath,
        sourceJsonPath: ["coverage", "actual"],
      },
      {
        projectionPath: ["coverage", "segments", 0, "expected"],
        sourceArtifactPath,
        sourceJsonPath: ["coverage", "expected"],
      },
      ...Object.keys(metrics).map((metric) => ({
        projectionPath: ["metrics", metric],
        sourceArtifactPath,
        sourceJsonPath: ["metrics", metric],
      })),
    ],
    coverage: {
      complete: true,
      segments: [{
        actual: input.coverageActual ?? 10,
        expected: input.coverageExpected ?? 10,
        name: "all cases",
      }],
    },
    generatedBy: "release-curation:verified-projection-v2",
    metrics,
    presentation,
    run: {
      commit: input.commit ?? FULL_COMMIT,
      executionFailureCounts: [input.executionFailures ?? 0],
      executionFailures: input.executionFailures ?? 0,
      packageVersion: input.packageVersion ?? "0.3.5",
      runId: "run-example",
      tree: FULL_TREE,
    },
    schemaVersion: 3,
    sourceArtifacts: [{
      bytes: new TextEncoder().encode(input.source).byteLength,
      path: sourceArtifactPath,
      sha256: createHash("sha256").update(input.source).digest("hex"),
    }],
  };
}

function verifiedProjectionAssertions(
  presentation: "current" | "historical" = "current",
  input: {
    baseline?: number;
    benchmark?: string;
    commit?: string;
    packageVersion?: string;
    score?: number;
  } = {},
) {
  return [
    { equals: "verified-benchmark-claim-projection", path: ["artifactKind"] },
    { equals: input.benchmark ?? "Example", path: ["benchmark"] },
    { equals: 3, path: ["schemaVersion"] },
    { equals: presentation, path: ["presentation"] },
    { equals: input.commit ?? FULL_COMMIT, path: ["run", "commit"] },
    { equals: input.packageVersion ?? "0.3.5", path: ["run", "packageVersion"] },
    { equals: FULL_TREE, path: ["run", "tree"] },
    { equals: "run-example", path: ["run", "runId"] },
    { equals: 0, path: ["run", "executionFailures"] },
    { equals: true, path: ["coverage", "complete"] },
    { equals: input.score ?? 0.8, path: ["metrics", "score"] },
    { equals: input.baseline ?? 0.5, path: ["metrics", "baseline"] },
  ];
}

function bindIndependentExecutionReceipt(input: {
  canonicalResultExtra?: Record<string, unknown>;
  includeResult?: boolean;
  includeResultEvidence?: boolean;
  includeSecondCanonicalResult?: boolean;
  packageVersion?: string;
  projection: Record<string, unknown>;
  receiptExtra?: Record<string, unknown>;
  receiptResult?: Record<string, unknown>;
  receiptPath?: string;
  receiptSourceSha256?: string;
  resultEvidenceSourceArtifactPath?: string;
  source: string;
  sourceRunId?: string;
}): {
  readSource: (path: string) => Promise<string>;
  repository: ClaimEvidenceRepositoryVerifier;
  source: string;
} {
  const projection = input.projection;
  const run = projection.run as Record<string, unknown>;
  const sourceManifest = projection.sourceArtifacts as Array<Record<string, unknown>>;
  const sourcePath = sourceManifest[0]?.path as string;
  const parsedSource = JSON.parse(input.source) as Record<string, unknown>;
  const sourceRun = parsedSource.run as Record<string, unknown>;
  const sourceCoverage = parsedSource.coverage as Record<string, unknown>;
  const sourceMetrics = parsedSource.metrics as Record<string, unknown>;
  sourceRun.runId = input.sourceRunId ?? run.runId;
  sourceRun.tree = run.tree;
  const source = JSON.stringify(parsedSource);
  const sourceArtifact = {
    bytes: new TextEncoder().encode(source).byteLength,
    path: sourcePath,
    sha256: createHash("sha256").update(source).digest("hex"),
  };
  const receiptPath = input.receiptPath ??
    "benchmark-claims/evidence/example-execution-receipt.json";
  const resultPath = receiptPath.replace(/\.json$/u, "-result.json");
  const result = input.receiptResult ?? {
    coverage: {
      complete: sourceCoverage.actual === sourceCoverage.expected,
      segments: [{
        actual: sourceCoverage.actual,
        expected: sourceCoverage.expected,
        name: "all cases",
      }],
    },
    failures: {
      counts: [sourceRun.executionFailures],
      total: sourceRun.executionFailures,
    },
    metrics: sourceMetrics,
  };
  const runIdentity = {
    commit: run.commit,
    packageVersion: run.packageVersion,
    runId: run.runId,
    tree: run.tree,
  };
  const canonicalResult = {
    artifactKind: "benchmark-execution-result",
    benchmark: projection.benchmark,
    result,
    runIdentity,
    schemaVersion: 1,
    ...input.canonicalResultExtra,
  };
  const canonicalResultContent = JSON.stringify(canonicalResult);
  const canonicalResultArtifact = {
    bytes: new TextEncoder().encode(canonicalResultContent).byteLength,
    path: resultPath,
    sha256: createHash("sha256").update(canonicalResultContent).digest("hex"),
  };
  const secondResultPath = receiptPath.replace(/\.json$/u, "-second-result.json");
  const secondCanonicalResultArtifact = {
    ...canonicalResultArtifact,
    path: secondResultPath,
  };
  const includeResultEvidence = input.includeResultEvidence !== false;
  const receipt = {
    artifactKind: "benchmark-execution-receipt",
    benchmark: projection.benchmark,
    runEvidence: {
      runIdPath: ["run", "runId"],
      sourceArtifactPath: sourcePath,
    },
    ...(includeResultEvidence
      ? {
          resultEvidence: {
            sourceArtifactPath:
              input.resultEvidenceSourceArtifactPath ?? resultPath,
          },
        }
      : {}),
    runIdentity,
    ...(input.includeResult === false
      ? {}
      : { result }),
    schemaVersion: 1,
    sourceArtifacts: [
      ...(includeResultEvidence ? [canonicalResultArtifact] : []),
      ...(input.includeSecondCanonicalResult
        ? [secondCanonicalResultArtifact]
        : []),
      {
        ...sourceArtifact,
        sha256: input.receiptSourceSha256 ?? sourceArtifact.sha256,
      },
    ],
    ...input.receiptExtra,
  };
  const receiptContent = JSON.stringify(receipt);
  const receiptArtifact = {
    bytes: new TextEncoder().encode(receiptContent).byteLength,
    path: receiptPath,
    sha256: createHash("sha256").update(receiptContent).digest("hex"),
  };
  projection.sourceArtifacts = [
    receiptArtifact,
    ...(includeResultEvidence ? [canonicalResultArtifact] : []),
    ...(input.includeSecondCanonicalResult
      ? [secondCanonicalResultArtifact]
      : []),
    sourceArtifact,
  ];
  const bindings = projection.bindings as Array<Record<string, unknown>>;
  for (const binding of bindings) {
    const projectionPath = binding.projectionPath as Array<string | number>;
    const identityField = projectionPath.length === 2 && projectionPath[0] === "run"
      ? projectionPath[1]
      : undefined;
    if (["commit", "packageVersion", "runId", "tree"].includes(String(identityField))) {
      binding.sourceArtifactPath = receiptPath;
      binding.sourceJsonPath = ["runIdentity", identityField as string];
    } else if (projectionPath.join(".") === "run.executionFailures") {
      binding.sourceArtifactPath = receiptPath;
      binding.sourceJsonPath = ["result", "failures", "total"];
    } else if (
      projectionPath[0] === "run" &&
      projectionPath[1] === "executionFailureCounts"
    ) {
      binding.sourceArtifactPath = receiptPath;
      binding.sourceJsonPath = [
        "result",
        "failures",
        "counts",
        projectionPath[2] as number,
      ];
    } else if (projectionPath.join(".") === "coverage.complete") {
      binding.sourceArtifactPath = receiptPath;
      binding.sourceJsonPath = ["result", "coverage", "complete"];
    } else if (
      projectionPath[0] === "coverage" &&
      projectionPath[1] === "segments"
    ) {
      binding.sourceArtifactPath = receiptPath;
      binding.sourceJsonPath = [
        "result",
        "coverage",
        "segments",
        projectionPath[2] as number,
        projectionPath[3] as string,
      ];
    } else if (projectionPath[0] === "metrics") {
      binding.sourceArtifactPath = receiptPath;
      binding.sourceJsonPath = ["result", "metrics", projectionPath[1] as string];
    }
  }
  const files = new Map([
    [receiptPath, receiptContent],
    ...(includeResultEvidence
      ? [[resultPath, canonicalResultContent] as const]
      : []),
    ...(input.includeSecondCanonicalResult
      ? [[secondResultPath, canonicalResultContent] as const]
      : []),
    [sourcePath, source],
  ]);
  const readSource = async (path: string) => {
    const relative = path.replace(/^\/repo\//u, "");
    const content = files.get(relative);
    if (content === undefined) {
      throw new Error(`missing ${relative}`);
    }
    return content;
  };
  return {
    readSource,
    repository: {
      readCommittedFile: readSource,
      readFileAtCommit: async () =>
        JSON.stringify({ version: input.packageVersion ?? run.packageVersion }),
      resolveCommitTree: async () => String(run.tree),
    },
    source,
  };
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
      runId: "run-example",
      tree: FULL_TREE,
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
            assertions: currentClaimProjectionAssertions(),
            description: "tracked current evidence",
            path: "benchmark-claims/evidence/locomo-current.json",
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
        readmeRequiredFragments: [
          "0.6300",
          "0.8000",
          "0.6100",
          "61/100",
          "0.5000",
        ],
      },
    }),
    historicalPresentation: {
      readmeDisclosureFragments: ["historical-disclosure"],
      readmeRequiredFragments: [
        "0.6300",
        "0.8700",
        "0.6100",
        "61/100",
        "0.5000",
      ],
    },
  } as BenchmarkClaimReport;
}

function forgedLocomoCurrentPresentation(): {
  projection: Record<string, unknown>;
  readSource: (path: string) => Promise<string>;
  report: BenchmarkClaimReport;
  repository: ClaimEvidenceRepositoryVerifier;
  source: string;
} {
  const sourcePath = "reports/eval/current/locomo.json";
  const source = JSON.stringify({
    benchmark: "LoCoMo",
    coverage: { actual: 10, complete: true, expected: 10 },
    metrics: {
      baseline: 0.5,
      openDomainCorrect: 61,
      openDomainScore: 0.61,
      openDomainTotal: 100,
      score: 0.8,
      strictScore: 0.63,
    },
    run: {
      commit: FULL_COMMIT,
      executionFailures: 0,
      packageVersion: "0.7.3",
    },
  });
  const projection = verifiedProjection({
    benchmark: "LoCoMo",
    packageVersion: "0.7.3",
    source,
    sourceArtifactPath: sourcePath,
  });
  const execution = bindIndependentExecutionReceipt({
    packageVersion: "0.7.3",
    projection,
    source,
  });
  return {
    projection,
    readSource: execution.readSource,
    report: cleanReport({
      benchmark: "LoCoMo",
      evidence: {
        artifacts: [{
          assertions: verifiedProjectionAssertions("current", {
            benchmark: "LoCoMo",
            packageVersion: "0.7.3",
          }),
          description: "verified current projection",
          path: "benchmark-claims/evidence/locomo-current-verified.json",
        }],
      },
      publicClaim: {
        readmeDisclosureFragments: ["FORGED-DISCLOSURE"],
        readmeRequiredFragments: ["999.999", "888/1"],
      },
      run: {
        ...cleanReport().run,
        packageVersion: "0.7.3",
      },
    }),
    repository: execution.repository,
    source: execution.source,
  };
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
          assertions: verifiedProjectionAssertions("historical"),
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
      "historical evidence requires a schema-3 verified projection assertion contract",
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

  it("does not grandfather earlier-package history without an execution receipt", () => {
    const candidate = candidateWithHistoricalProjection();
    const historical = buildClaimGateReport(
      [{ file: "locomo.json", value: candidate }],
      "2026-08-12T00:00:00Z",
      [],
      new Map([["locomo.json", []]]),
      "0.7.4",
    );
    expect(historical.entries[0]?.consistent).toBe(false);
    expect(historical.entries[0]?.schemaErrors.join(" ")).toContain(
      "historicalPresentation requires a tracked historical projection",
    );
    expect(historical.historicalEvidence).toEqual([]);
  });

  it("rejects versioned candidate history whose artifact identifies a different benchmark and version", async () => {
    const forged = cleanReport({
      benchmark: "ForgedBench",
      evidence: {
        artifacts: [{
          assertions: [
            { equals: "tracked-current-claim-projection", path: ["artifactKind"] },
            { equals: "LoCoMo", path: ["benchmark"] },
            { equals: "scripts/run-current-claim.ts", path: ["generatedBy"] },
            { equals: 1, path: ["schemaVersion"] },
            { equals: FULL_COMMIT, path: ["runIdentity", "commit"] },
            { equals: "0.7.3", path: ["claim", "packageVersion"] },
          ],
          description: "LoCoMo v0.7.3 evidence relabeled as ForgedBench",
          path: "benchmark-claims/evidence/locomo-v0.7.3-current.json",
        }],
      },
      run: {
        ...cleanReport().run,
        packageVersion: "0.7.2",
      },
    });
    const underlyingArtifact = currentClaimProjection("LoCoMo", "0.7.3");
    const evidenceErrors = await checkClaimEvidenceArtifacts({
      currentPackageVersion: "0.7.4",
      file: "forgedbench.json",
      readFile: async () => JSON.stringify(underlyingArtifact),
      repoRoot: "/repo",
      report: forged,
    });
    const report = buildClaimGateReport(
      [{ file: "forgedbench.json", value: forged }],
      "2026-08-12T00:00:00Z",
      [],
      new Map([["forgedbench.json", evidenceErrors]]),
      "0.7.4",
    );

    expect(evidenceErrors.length).toBeGreaterThan(0);
    expect(report.allConsistent).toBe(false);
    expect(report.historicalEvidence).toEqual([]);
    expect(report.summary.overClaiming).toBe(1);

    const forgedCommit = "f".repeat(40);
    const fullyRelabeled = {
      ...forged,
      evidence: {
        artifacts: [{
          ...forged.evidence.artifacts[0]!,
          assertions: currentClaimProjectionAssertions("ForgedBench", "0.7.2")
            .map((assertion) =>
              assertion.path.join(".") === "runIdentity.commit"
                ? { ...assertion, equals: forgedCommit }
                : assertion
            ),
        }],
      },
      run: { ...forged.run, commit: forgedCommit },
    };
    const unchecked = buildClaimGateReport(
      [{ file: "forgedbench.json", value: fullyRelabeled }],
      "2026-08-12T00:00:00Z",
      [],
      new Map(),
      "0.7.4",
    );
    expect(unchecked.allConsistent).toBe(false);
    expect(unchecked.historicalEvidence).toEqual([]);
    expect(unchecked.entries[0]?.blockers).toContain(
      "versioned candidate history requires a schema-3 verified projection and independent " +
        "execution receipt that bind benchmark, commit, tree, package, run, and source closure",
    );

    const relabeledErrors = await checkClaimEvidenceArtifacts({
      currentPackageVersion: "0.7.4",
      file: "forgedbench.json",
      readFile: async () => JSON.stringify(underlyingArtifact),
      repoRoot: "/repo",
      report: fullyRelabeled,
    });
    expect(relabeledErrors.join(" ")).toContain(
      "current-claim projection benchmark must equal ForgedBench",
    );
    expect(relabeledErrors.join(" ")).toContain(
      "current-claim projection packageVersion must equal 0.7.2",
    );
    expect(relabeledErrors.join(" ")).toContain(
      `current-claim projection run commit must equal ${forgedCommit}`,
    );
    expect(buildClaimGateReport(
      [{ file: "forgedbench.json", value: fullyRelabeled }],
      "2026-08-12T00:00:00Z",
      [],
      new Map([["forgedbench.json", relabeledErrors]]),
      "0.7.4",
    ).historicalEvidence).toEqual([]);
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
      report: cleanReport({ status: "paused_boundary" }),
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

  it("requires every candidate public claim to be backed by a projection artifact", async () => {
    const report = cleanReport();
    const errors = await checkClaimEvidenceArtifacts({
      currentPackageVersion: "0.3.5",
      file: "example.json",
      readFile: async () => JSON.stringify({ ok: true }),
      repoRoot: "/repo",
      report,
    });

    expect(errors.join(" ")).toContain(
      "candidate public claim requires a schema-3 verified projection and independent execution receipt",
    );
    expect(buildClaimGateReport(
      [{ file: "example.json", value: report }],
      "2026-08-12T00:00:00Z",
      [],
      new Map([["example.json", errors]]),
      "0.3.5",
    ).publicClaimable).toEqual([]);
  });

  it("binds current projection score and baseline to its verified source closure", async () => {
    const sourcePath = "reports/eval/current/report.json";
    const source = JSON.stringify({
      benchmark: "Example",
      coverage: { actual: 10, complete: true, expected: 10 },
      metrics: { baseline: 0.5, score: 0.8 },
      run: {
        commit: FULL_COMMIT,
        executionFailures: 0,
        packageVersion: "0.3.5",
      },
    });
    const projection = verifiedProjection({ source, sourceArtifactPath: sourcePath });
    const execution = bindIndependentExecutionReceipt({ projection, source });
    const report = cleanReport({
      evidence: {
        artifacts: [{
          assertions: verifiedProjectionAssertions(),
          description: "verified current projection",
          path: "benchmark-claims/evidence/example-verified.json",
        }],
      },
      publicClaim: {
        readmeDisclosureFragments: ["disclosed"],
        readmeRequiredFragments: ["0.8000", "0.5000"],
      },
    });
    const readArtifact = async (path: string) =>
      path.endsWith("example-verified.json")
        ? JSON.stringify(projection)
        : execution.readSource(path);

    expect(await checkClaimEvidenceArtifacts({
      currentPackageVersion: "0.3.5",
      file: "example.json",
      readFile: readArtifact,
      repoRoot: "/repo",
      repository: execution.repository,
      report,
    })).toEqual([]);

    const unboundScoreReport = {
      ...report,
      evidence: {
        artifacts: report.evidence.artifacts.map((artifact) => ({
          ...artifact,
          assertions: artifact.assertions?.filter(
            ({ path }) => path.join(".") !== "metrics.score",
          ),
        })),
      },
    };
    const unboundScoreErrors = await checkClaimEvidenceArtifacts({
      currentPackageVersion: "0.3.5",
      file: "example.json",
      readFile: readArtifact,
      repoRoot: "/repo",
      repository: execution.repository,
      report: unboundScoreReport,
    });
    expect(unboundScoreErrors.join(" ")).toContain(
      "verified projection field metrics.score must be bound by a declaration assertion",
    );

    const scoreForged = {
      ...projection,
      metrics: { baseline: 0.5, score: 0.81 },
    };
    const scoreErrors = await checkClaimEvidenceArtifacts({
      currentPackageVersion: "0.3.5",
      file: "example.json",
      readFile: async (path) =>
        path.endsWith("example-verified.json")
          ? JSON.stringify(scoreForged)
          : execution.readSource(path),
      repoRoot: "/repo",
      repository: execution.repository,
      report,
    });
    expect(scoreErrors.join(" ")).toContain(
      "verified projection score must equal declaration metrics.score 0.8",
    );

    const baselineForged = JSON.stringify({
      benchmark: "Example",
      coverage: { actual: 10, complete: true, expected: 10 },
      metrics: { baseline: 0.4, score: 0.8 },
      run: {
        commit: FULL_COMMIT,
        executionFailures: 0,
        packageVersion: "0.3.5",
      },
    });
    const baselineProjection = verifiedProjection({
      source: baselineForged,
      sourceArtifactPath: sourcePath,
    });
    const baselineExecution = bindIndependentExecutionReceipt({
      projection: baselineProjection,
      source: baselineForged,
    });
    const baselineErrors = await checkClaimEvidenceArtifacts({
      currentPackageVersion: "0.3.5",
      file: "example.json",
      readFile: async (path) =>
        path.endsWith("example-verified.json")
          ? JSON.stringify(baselineProjection)
          : baselineExecution.readSource(path),
      repoRoot: "/repo",
      repository: baselineExecution.repository,
      report,
    });
    expect(baselineErrors.join(" ")).toContain(
      "source binding metrics.baseline expected 0.5 but source contained 0.4",
    );

    const identityFreeShell = JSON.stringify({
      metrics: { baseline: 0.5, score: 0.8 },
    });
    const shellProjection = {
      ...projection,
      sourceArtifacts: [{
        bytes: new TextEncoder().encode(identityFreeShell).byteLength,
        path: sourcePath,
        sha256: createHash("sha256").update(identityFreeShell).digest("hex"),
      }],
    };
    const shellErrors = await checkClaimEvidenceArtifacts({
      currentPackageVersion: "0.3.5",
      file: "example.json",
      readFile: async (path) => path.endsWith("example-verified.json")
        ? JSON.stringify(shellProjection)
        : identityFreeShell,
      repoRoot: "/repo",
      report,
    });
    expect(shellErrors.join(" ")).toContain(
      "verified projection requires exactly one independent execution receipt",
    );
  });

  it("rejects projection bindings that cherry-pick a passing sibling from a failed run", async () => {
    const sourcePath = "reports/eval/current/report.json";
    const source = JSON.stringify({
      benchmark: "Example",
      coverage: { actual: 3, expected: 10 },
      metrics: { baseline: 0.5, score: 0.2 },
      passingSibling: {
        coverage: { actual: 10, expected: 10 },
        metrics: { baseline: 0.5, score: 0.8 },
        run: { executionFailures: 0 },
      },
      run: { executionFailures: 7 },
    });
    const projection = verifiedProjection({ source, sourceArtifactPath: sourcePath });
    const execution = bindIndependentExecutionReceipt({ projection, source });
    const bindings = projection.bindings as Array<Record<string, unknown>>;
    for (const binding of bindings) {
      const projectionPath = binding.projectionPath as Array<number | string>;
      if (projectionPath[0] === "metrics") {
        binding.sourceJsonPath = ["passingSibling", ...projectionPath];
      } else if (projectionPath[0] === "coverage") {
        binding.sourceJsonPath = [
          "passingSibling",
          "coverage",
          projectionPath.at(-1) as string,
        ];
      } else if (projectionPath.join(".") === "run.executionFailureCounts.0") {
        binding.sourceJsonPath = ["passingSibling", "run", "executionFailures"];
      }
    }
    const report = cleanReport({
      evidence: {
        artifacts: [{
          assertions: verifiedProjectionAssertions(),
          description: "cherry-picked projection",
          path: "benchmark-claims/evidence/example-verified.json",
        }],
      },
      publicClaim: {
        readmeDisclosureFragments: ["disclosed"],
        readmeRequiredFragments: ["0.8000", "0.5000"],
      },
    });
    const evidenceErrors = await checkClaimEvidenceArtifacts({
      currentPackageVersion: "0.3.5",
      file: "example.json",
      readFile: async (path) => path.endsWith("example-verified.json")
        ? JSON.stringify(projection)
        : execution.readSource(path),
      repoRoot: "/repo",
      repository: execution.repository,
      report,
    });
    const gate = buildClaimGateReport(
      [{ file: "example.json", value: report }],
      "2026-08-13T00:00:00Z",
      [],
      new Map([["example.json", evidenceErrors]]),
      "0.3.5",
    );

    expect(evidenceErrors.join(" ")).toContain("canonical execution receipt result");
    expect(gate.publicClaimable).toEqual([]);
  });

  it("rejects a receipt that self-attests success over a failed raw source", async () => {
    const sourcePath = "reports/eval/current/failed-run.json";
    const source = JSON.stringify({
      benchmark: "Example",
      coverage: { actual: 1, complete: false, expected: 100 },
      metrics: { baseline: 0.5, score: 0.01 },
      run: {
        commit: "f".repeat(40),
        executionFailures: 9,
        packageVersion: "0.1.0",
      },
      terminalStatus: "failed",
    });
    const projection = verifiedProjection({ source, sourceArtifactPath: sourcePath });
    const execution = bindIndependentExecutionReceipt({
      includeResultEvidence: false,
      projection,
      receiptResult: {
        coverage: {
          complete: true,
          segments: [{ actual: 10, expected: 10, name: "all cases" }],
        },
        failures: { counts: [0], total: 0 },
        metrics: { baseline: 0.5, score: 0.8 },
      },
      source,
    });
    const report = cleanReport({
      evidence: {
        artifacts: [{
          assertions: verifiedProjectionAssertions(),
          description: "self-attested receipt over failed raw source",
          path: "benchmark-claims/evidence/example-verified.json",
        }],
      },
      publicClaim: {
        readmeDisclosureFragments: ["disclosed"],
        readmeRequiredFragments: ["0.8000", "0.5000"],
      },
    });
    const evidenceErrors = await checkClaimEvidenceArtifacts({
      currentPackageVersion: "0.3.5",
      file: "example.json",
      readFile: async (path) => path.endsWith("example-verified.json")
        ? JSON.stringify(projection)
        : execution.readSource(path),
      repoRoot: "/repo",
      repository: execution.repository,
      report,
    });
    const gate = buildClaimGateReport(
      [{ file: "example.json", value: report }],
      "2026-08-13T00:00:00Z",
      [],
      new Map([["example.json", evidenceErrors]]),
      "0.3.5",
    );

    expect(evidenceErrors.join(" ")).toContain(
      "resultEvidence must bind exactly one canonical execution result",
    );
    expect(gate.publicClaimable).toEqual([]);
  });

  it("requires one exact canonical result instead of arbitrary or sibling JSON", async () => {
    const source = JSON.stringify({
      benchmark: "Example",
      coverage: { actual: 10, complete: true, expected: 10 },
      metrics: { baseline: 0.5, score: 0.8 },
      run: {
        commit: FULL_COMMIT,
        executionFailures: 0,
        packageVersion: "0.3.5",
      },
    });
    const errorsFor = async (
      options: Omit<
        Parameters<typeof bindIndependentExecutionReceipt>[0],
        "projection" | "source"
      >,
    ): Promise<string[]> => {
      const projection = verifiedProjection({ source });
      const execution = bindIndependentExecutionReceipt({
        ...options,
        projection,
        source,
      });
      return checkClaimEvidenceArtifacts({
        currentPackageVersion: "0.3.5",
        file: "example.json",
        readFile: async (path) => path.endsWith("example-verified.json")
          ? JSON.stringify(projection)
          : execution.readSource(path),
        repoRoot: "/repo",
        repository: execution.repository,
        report: cleanReport({
          evidence: {
            artifacts: [{
              assertions: verifiedProjectionAssertions(),
              description: "canonical execution result fixture",
              path: "benchmark-claims/evidence/example-verified.json",
            }],
          },
          publicClaim: {
            readmeDisclosureFragments: ["disclosed"],
            readmeRequiredFragments: ["0.8000", "0.5000"],
          },
        }),
      });
    };

    expect((await errorsFor({
      resultEvidenceSourceArtifactPath: "reports/example-source.json",
    })).join(" ")).toContain(
      "resultEvidence must bind exactly one canonical execution result",
    );
    expect((await errorsFor({
      canonicalResultExtra: {
        passingSibling: {
          result: {
            coverage: {
              complete: true,
              segments: [{ actual: 10, expected: 10, name: "all cases" }],
            },
            failures: { counts: [0], total: 0 },
            metrics: { baseline: 0.5, score: 0.8 },
          },
        },
        result: {
          coverage: {
            complete: false,
            segments: [{ actual: 1, expected: 10, name: "all cases" }],
          },
          failures: { counts: [7], total: 7 },
          metrics: { baseline: 0.5, score: 0.1 },
        },
      },
    })).join(" ")).toContain(
      "canonical execution result must contain only",
    );
    expect((await errorsFor({
      receiptExtra: {
        passingSibling: { result: { score: 1 } },
      },
    })).join(" ")).toContain(
      "must contain only the canonical receipt fields",
    );
    expect((await errorsFor({
      canonicalResultExtra: {
        runIdentity: {
          commit: "f".repeat(40),
          packageVersion: "0.1.0",
          runId: "run-example",
          tree: FULL_TREE,
        },
      },
    })).join(" ")).toContain(
      "runIdentity must exactly equal the execution receipt",
    );
    expect((await errorsFor({
      canonicalResultExtra: {
        result: {
          coverage: {
            complete: false,
            segments: [{ actual: 1, expected: 10, name: "all cases" }],
          },
          failures: { counts: [7], total: 7 },
          metrics: { baseline: 0.5, score: 0.1 },
        },
      },
    })).join(" ")).toContain(
      "result must exactly equal the execution receipt result",
    );
    expect((await errorsFor({
      receiptResult: {
        coverage: {
          complete: true,
          segments: [{ actual: 10, expected: 10, name: "all cases" }],
        },
        failures: { counts: [0], total: 0 },
        metrics: { baseline: 0.5, score: 0.8 },
        passingSibling: { score: 1 },
      },
    })).join(" ")).toContain(
      "using only canonical fields",
    );
    expect((await errorsFor({
      includeSecondCanonicalResult: true,
    })).join(" ")).toContain(
      "resultEvidence must bind exactly one canonical execution result",
    );
  });

  it("rejects an identity-only execution receipt without structured run results", async () => {
    const source = JSON.stringify({
      benchmark: "Example",
      coverage: { actual: 10, expected: 10 },
      metrics: { baseline: 0.5, score: 0.8 },
      run: { executionFailures: 0 },
    });
    const projection = verifiedProjection({ source });
    const execution = bindIndependentExecutionReceipt({
      includeResult: false,
      projection,
      source,
    });
    const report = cleanReport({
      evidence: {
        artifacts: [{
          assertions: verifiedProjectionAssertions(),
          description: "identity-only execution receipt",
          path: "benchmark-claims/evidence/example-verified.json",
        }],
      },
      publicClaim: {
        readmeDisclosureFragments: ["disclosed"],
        readmeRequiredFragments: ["0.8000", "0.5000"],
      },
    });

    const errors = await checkClaimEvidenceArtifacts({
      currentPackageVersion: "0.3.5",
      file: "example.json",
      readFile: async (path) => path.endsWith("example-verified.json")
        ? JSON.stringify(projection)
        : execution.readSource(path),
      repoRoot: "/repo",
      repository: execution.repository,
      report,
    });

    expect(errors.join(" ")).toContain(
      "execution receipt result must define failures, coverage, and metrics",
    );
  });

  it("rejects current README result fragments that are not derived from verified metrics", async () => {
    const { projection, readSource, report, repository } =
      forgedLocomoCurrentPresentation();
    const evidenceErrors = await checkClaimEvidenceArtifacts({
      currentPackageVersion: "0.7.3",
      file: "locomo.json",
      readFile: async (path) => path.endsWith("locomo-current-verified.json")
        ? JSON.stringify(projection)
        : readSource(path),
      repoRoot: "/repo",
      repository,
      report,
    });

    expect(evidenceErrors.join(" ")).toContain(
      "source-derived README fragment 0.6300 is missing from publicClaim.readmeRequiredFragments",
    );
    expect(evidenceErrors.join(" ")).not.toContain("readmeDisclosureFragments");
    const gate = buildClaimGateReport(
      [{ file: "locomo.json", value: report }],
      "2026-08-12T00:00:00Z",
      [],
      new Map([["locomo.json", evidenceErrors]]),
      "0.7.3",
    );
    expect(gate.publicClaimable).toEqual([]);
    expect(gate.allConsistent).toBe(false);
  });

  it("rejects forged current fragments when the same v2 projection becomes versioned history", async () => {
    const { projection, readSource, report, repository } =
      forgedLocomoCurrentPresentation();
    const evidenceErrors = await checkClaimEvidenceArtifacts({
      currentPackageVersion: "0.7.4",
      file: "locomo.json",
      readFile: async (path) => path.endsWith("locomo-current-verified.json")
        ? JSON.stringify(projection)
        : readSource(path),
      repoRoot: "/repo",
      repository,
      report,
    });

    expect(evidenceErrors.join(" ")).toContain(
      "source-derived README fragment 0.6300 is missing from publicClaim.readmeRequiredFragments",
    );
    expect(evidenceErrors.join(" ")).not.toContain("readmeDisclosureFragments");
    const gate = buildClaimGateReport(
      [{ file: "locomo.json", value: report }],
      "2026-08-12T00:00:00Z",
      [],
      new Map([["locomo.json", evidenceErrors]]),
      "0.7.4",
    );
    expect(gate.historicalEvidence).toEqual([]);
    expect(gate.allConsistent).toBe(false);
  });

  it("rejects a verified projection whose source contradicts run and coverage identity", async () => {
    const source = JSON.stringify({
      benchmark: "Example",
      coverage: { actual: 7, complete: true, expected: 10 },
      metrics: { baseline: 0.5, score: 0.8 },
      run: {
        commit: "f".repeat(40),
        executionFailures: 7,
        packageVersion: "0.1.0",
      },
    });
    const projection = verifiedProjection({ source });
    const report = cleanReport({
      evidence: {
        artifacts: [{
          assertions: verifiedProjectionAssertions(),
          description: "verified current projection",
          path: "benchmark-claims/evidence/example-verified.json",
        }],
      },
    });

    const errors = await checkClaimEvidenceArtifacts({
      currentPackageVersion: "0.3.5",
      file: "example.json",
      readFile: async (path) => path.endsWith("example-verified.json")
        ? JSON.stringify(projection)
        : source,
      repoRoot: "/repo",
      report,
    });

    expect(errors.join(" ")).toContain("source binding run.commit");
    expect(errors.join(" ")).toContain("source binding run.packageVersion");
    expect(errors.join(" ")).toContain("source binding run.executionFailureCounts");
    expect(errors.join(" ")).toContain("source binding coverage.segments");
  });

  it("rejects candidate historical presentation backed by a non-result source", async () => {
    const source = JSON.stringify({
      coverage: { actual: 10, complete: true, expected: 10 },
      metrics: { baseline: 0.5, score: 0.8 },
      run: {
        commit: FULL_COMMIT,
        executionFailures: 0,
        packageVersion: "0.3.5",
      },
      text: "not benchmark results",
    });
    const projection = verifiedProjection({
      presentation: "historical",
      source,
    });
    const report = cleanReport({
      evidence: {
        artifacts: [{
          assertions: verifiedProjectionAssertions("historical"),
          description: "verified historical projection",
          path: "benchmark-claims/evidence/example-historical-verified.json",
        }],
      },
      historicalPresentation: {
        readmeDisclosureFragments: ["historical"],
        readmeRequiredFragments: ["0.8000"],
      },
    });

    const errors = await checkClaimEvidenceArtifacts({
      currentPackageVersion: "0.3.5",
      file: "example.json",
      readFile: async (path) => path.endsWith("example-historical-verified.json")
        ? JSON.stringify(projection)
        : source,
      repoRoot: "/repo",
      report,
    });

    expect(errors.join(" ")).toContain("source benchmark identity");
    expect(errors.join(" ")).toContain(
      "historical evidence requires a schema-3 verified projection and independent execution receipt",
    );
  });

  it("rejects a compact identity shell that is not an execution receipt", async () => {
    const sourcePath = "reports/example-source.json";
    const source = JSON.stringify({
      benchmark: "Example",
      coverage: { actual: 10, complete: true, expected: 10 },
      metrics: { baseline: 0.5, score: 0.8 },
      run: { executionFailures: 0 },
    });
    const sourceArtifact = {
      bytes: new TextEncoder().encode(source).byteLength,
      path: sourcePath,
      sha256: createHash("sha256").update(source).digest("hex"),
    };
    const identityPath = "benchmark-claims/evidence/example-identity-shell.json";
    const identityShell = historicalProjection({
      benchmark: "Example",
      claim: { packageVersion: "0.3.5" },
      sourceArtifacts: [sourceArtifact],
    }, "Example");
    const identityContent = JSON.stringify(identityShell);
    const projection = verifiedProjection({ source });
    projection.sourceArtifacts = [
      {
        bytes: new TextEncoder().encode(identityContent).byteLength,
        path: identityPath,
        sha256: createHash("sha256").update(identityContent).digest("hex"),
      },
      sourceArtifact,
    ];
    const bindings = projection.bindings as Array<Record<string, unknown>>;
    for (const binding of bindings.slice(0, 2)) {
      binding.sourceArtifactPath = identityPath;
      binding.sourceJsonPath = binding.projectionPath?.toString() === "run,commit"
        ? ["runIdentity", "commit"]
        : ["claim", "packageVersion"];
    }
    const report = cleanReport({
      evidence: {
        artifacts: [{
          assertions: verifiedProjectionAssertions(),
          description: "identity-shell projection",
          path: "benchmark-claims/evidence/example-verified.json",
        }],
      },
    });

    const errors = await checkClaimEvidenceArtifacts({
      currentPackageVersion: "0.3.5",
      file: "example.json",
      readFile: async (path) => {
        if (path.endsWith("example-verified.json")) {
          return JSON.stringify(projection);
        }
        if (path.endsWith("example-identity-shell.json")) {
          return identityContent;
        }
        return source;
      },
      repoRoot: "/repo",
      report,
    });

    expect(errors.join(" ")).toContain(
      "verified projection requires exactly one independent execution receipt",
    );
    expect(errors.join(" ")).toContain(
      "source binding run.commit must use the canonical execution receipt result path",
    );
  });

  it("rejects a current-claim shell whose claimed execution receipt does not exist", async () => {
    const sourcePath = "reports/example-source.json";
    const source = JSON.stringify({
      benchmark: "Example",
      coverage: { actual: 10, expected: 10 },
      metrics: { baseline: 0.5, score: 0.8 },
      run: { executionFailures: 0 },
    });
    const sourceArtifact = {
      bytes: new TextEncoder().encode(source).byteLength,
      path: sourcePath,
      sha256: createHash("sha256").update(source).digest("hex"),
    };
    const missingExecution = "reports/example-execution-receipt.json";
    const identityShell = currentClaimProjection("Example", "0.3.5");
    identityShell.sourceArtifacts = [
      sourceArtifact,
      {
        bytes: 123,
        path: missingExecution,
        sha256: "e".repeat(64),
      },
    ];
    const identityPath = "benchmark-claims/evidence/example-current.json";
    const identityContent = JSON.stringify(identityShell);
    const projection = verifiedProjection({ source });
    projection.sourceArtifacts = [
      {
        bytes: new TextEncoder().encode(identityContent).byteLength,
        path: identityPath,
        sha256: createHash("sha256").update(identityContent).digest("hex"),
      },
      sourceArtifact,
    ];
    const bindings = projection.bindings as Array<Record<string, unknown>>;
    bindings[0] = {
      projectionPath: ["run", "commit"],
      sourceArtifactPath: identityPath,
      sourceJsonPath: ["runIdentity", "commit"],
    };
    bindings[1] = {
      projectionPath: ["run", "packageVersion"],
      sourceArtifactPath: identityPath,
      sourceJsonPath: ["claim", "packageVersion"],
    };
    const report = cleanReport({
      evidence: {
        artifacts: [{
          assertions: verifiedProjectionAssertions(),
          description: "self-proving current projection",
          path: "benchmark-claims/evidence/example-verified.json",
        }],
      },
      publicClaim: {
        readmeDisclosureFragments: ["disclosed"],
        readmeRequiredFragments: ["0.8000", "0.5000"],
      },
    });
    const evidenceErrors = await checkClaimEvidenceArtifacts({
      currentPackageVersion: "0.3.5",
      file: "example.json",
      readFile: async (path) => {
        if (path.endsWith("example-verified.json")) {
          return JSON.stringify(projection);
        }
        if (path.endsWith("example-current.json")) {
          return identityContent;
        }
        if (path.endsWith("example-source.json")) {
          return source;
        }
        throw new Error(`missing ${path}`);
      },
      repoRoot: "/repo",
      report,
    });
    const gate = buildClaimGateReport(
      [{ file: "example.json", value: report }],
      "2026-08-13T00:00:00Z",
      [],
      new Map([["example.json", evidenceErrors]]),
      "0.3.5",
    );

    expect(evidenceErrors.join(" ")).toContain(missingExecution);
    expect(gate.publicClaimable).toEqual([]);
  });

  it("rejects a metric source whose bytes do not match its execution receipt", async () => {
    const source = JSON.stringify({
      benchmark: "Example",
      coverage: { actual: 10, complete: true, expected: 10 },
      metrics: { baseline: 0.5, score: 0.8 },
      run: { executionFailures: 0 },
    });
    const projection = verifiedProjection({ source });
    const execution = bindIndependentExecutionReceipt({
      projection,
      receiptSourceSha256: "f".repeat(64),
      source,
    });
    const report = cleanReport({
      evidence: {
        artifacts: [{
          assertions: verifiedProjectionAssertions(),
          description: "verified current projection",
          path: "benchmark-claims/evidence/example-verified.json",
        }],
      },
    });

    const errors = await checkClaimEvidenceArtifacts({
      currentPackageVersion: "0.3.5",
      file: "example.json",
      readFile: async (path) => {
        if (path.endsWith("example-verified.json")) {
          return JSON.stringify(projection);
        }
        return execution.readSource(path);
      },
      repoRoot: "/repo",
      repository: execution.repository,
      report,
    });

    expect(errors.join(" ")).toContain(
      "does not bind exact projection source reports/example-source.json",
    );
  });

  it("verifies committed receipt closure and exact tree, package, and run identity", async () => {
    const sourcePath = "reports/example-source.json";
    const receiptPath = "benchmark-claims/evidence/example-execution-receipt.json";
    const source = JSON.stringify({
      benchmark: "Example",
      coverage: { actual: 10, complete: true, expected: 10 },
      metrics: { baseline: 0.5, score: 0.8 },
      run: { executionFailures: 0 },
    });
    const projection = verifiedProjection({ source, sourceArtifactPath: sourcePath });
    const execution = bindIndependentExecutionReceipt({
      projection,
      receiptPath,
      source,
    });
    const report = cleanReport({
      evidence: {
        artifacts: [{
          assertions: verifiedProjectionAssertions(),
          description: "verified current projection",
          path: "benchmark-claims/evidence/example-verified.json",
        }],
      },
    });
    const check = (repository: ClaimEvidenceRepositoryVerifier) =>
      checkClaimEvidenceArtifacts({
        currentPackageVersion: "0.3.5",
        file: "example.json",
        readFile: async (path) => path.endsWith("example-verified.json")
          ? JSON.stringify(projection)
          : execution.readSource(path),
        repoRoot: "/repo",
        repository,
        report,
      });

    const uncommittedReceipt = await check({
      ...execution.repository,
      readCommittedFile: async (path) => {
        if (path === receiptPath) {
          throw new Error("not in HEAD");
        }
        return execution.repository.readCommittedFile(path);
      },
    });
    expect(uncommittedReceipt.join(" ")).toContain(
      `execution source artifact ${receiptPath} is not tracked and committed`,
    );

    const uncommittedSource = await check({
      ...execution.repository,
      readCommittedFile: async (path) => {
        if (path === sourcePath) {
          throw new Error("not in HEAD");
        }
        return execution.repository.readCommittedFile(path);
      },
    });
    expect(uncommittedSource.join(" ")).toContain(
      `execution source artifact ${sourcePath} is not tracked and committed`,
    );

    const committedDrift = await check({
      ...execution.repository,
      readCommittedFile: async (path) => path === sourcePath
        ? "committed drift"
        : execution.repository.readCommittedFile(path),
    });
    expect(committedDrift.join(" ")).toContain(
      `execution source artifact ${sourcePath} does not match committed Git bytes`,
    );

    const treeDrift = await check({
      ...execution.repository,
      resolveCommitTree: async () => "f".repeat(40),
    });
    expect(treeDrift.join(" ")).toContain("does not match commit");

    const packageDrift = await check({
      ...execution.repository,
      readFileAtCommit: async () => JSON.stringify({ version: "9.9.9" }),
    });
    expect(packageDrift.join(" ")).toContain(
      "packageVersion 0.3.5 does not match package.json",
    );

    const runProjection = verifiedProjection({ source, sourceArtifactPath: sourcePath });
    const runExecution = bindIndependentExecutionReceipt({
      projection: runProjection,
      receiptPath,
      source,
      sourceRunId: "different-run",
    });
    const runErrors = await checkClaimEvidenceArtifacts({
      currentPackageVersion: "0.3.5",
      file: "example.json",
      readFile: async (path) => path.endsWith("example-verified.json")
        ? JSON.stringify(runProjection)
        : runExecution.readSource(path),
      repoRoot: "/repo",
      repository: runExecution.repository,
      report,
    });
    expect(runErrors.join(" ")).toContain(
      "runIdentity.runId is not bound by reports/example-source.json:run.runId",
    );
  });

  it("verifies every projection source artifact byte count and sha256", async () => {
    const sourcePath = "reports/eval/longmemeval/report.json";
    const source = JSON.stringify({ metrics: { score: 0.8 } });
    const projection = historicalProjection({
      sourceArtifacts: [{
        bytes: new TextEncoder().encode(source).byteLength,
        path: sourcePath,
        sha256: createHash("sha256").update(source).digest("hex"),
      }],
    });
    const report = cleanReport({
      benchmark: "LongMemEval",
      claimBoundary: { publicClaimAllowed: false, reason: "historical only" },
      comparison: { ...cleanReport().comparison, availability: "historical" },
      evidence: {
        artifacts: [{
          assertions: historicalProjectionAssertions(),
          description: "tracked projection",
          path: "benchmark-claims/evidence/longmemeval-historical.json",
        }],
      },
      status: "internal_evidence",
    });
    const errors = await checkClaimEvidenceArtifacts({
      file: "longmemeval.json",
      readFile: async (path) =>
        path.endsWith("longmemeval-historical.json")
          ? JSON.stringify(projection)
          : `${source}tampered`,
      repoRoot: "/repo",
      report,
    });

    expect(errors.join(" ")).toContain(
      `projection source artifact ${sourcePath} byte count`,
    );
    expect(errors.join(" ")).toContain(
      `projection source artifact ${sourcePath} sha256`,
    );
  });

  it("validates historical projections and rejects arbitrary ok JSON", async () => {
    const sourcePath =
      "reports/quality-gates/phase-72/run-20260716-final/phase-72-release-gate.json";
    const source = JSON.stringify({
      benchmark: "LoCoMo",
      coverage: { actual: 10, complete: true, expected: 10 },
      metrics: {
        baseline: 0.5,
        openDomainCorrect: 61,
        openDomainScore: 0.61,
        openDomainTotal: 100,
        score: 0.87,
        strictScore: 0.63,
      },
      run: {
        commit: "f".repeat(40),
        executionFailures: 0,
        packageVersion: "0.6.0",
      },
    });
    const projection = {
      ...verifiedProjection({
        benchmark: "LoCoMo",
        commit: "f".repeat(40),
        packageVersion: "0.6.0",
        presentation: "historical",
        score: 0.87,
        source,
        sourceArtifactPath: sourcePath,
      }),
      claim: {
        executionFailures: 0,
        officialJudgeFailures: 0,
        officialScore: 0.87,
        openDomainScore: 0.61,
        packageVersion: "0.6.0",
        strictScore: 0.63,
      },
    };
    const execution = bindIndependentExecutionReceipt({
      packageVersion: "0.6.0",
      projection,
      receiptPath: "benchmark-claims/evidence/locomo-v0.6.0-execution.json",
      source,
    });
    const assertions = verifiedProjectionAssertions("historical", {
      benchmark: "LoCoMo",
      commit: "f".repeat(40),
      packageVersion: "0.6.0",
      score: 0.87,
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
        readmeRequiredFragments: [
          "0.6300",
          "0.8700",
          "0.6100",
          "61/100",
          "0.5000",
        ],
      },
      metrics: {
        baseline: 0.5,
        metricDirection: "higher-is-better",
        primary: "official score",
        score: 0.87,
      },
      run: {
        ...cleanReport().run,
        commit: "f".repeat(40),
        packageVersion: "0.6.0",
      },
      status: "internal_evidence",
    });
    const valid = await checkClaimEvidenceArtifacts({
      file: "locomo.json",
      readFile: async (path) => {
        if (path.endsWith("locomo-v0.6.0-historical.json")) {
          return JSON.stringify(projection);
        }
        return execution.readSource(path);
      },
      repoRoot: "/repo",
      repository: execution.repository,
      report,
    });
    expect(valid).toEqual([]);

    const selfAttested = await checkClaimEvidenceArtifacts({
      file: "locomo.json",
      readFile: async (path) => path.endsWith("locomo-v0.6.0-historical.json")
        ? JSON.stringify(projection)
        : execution.readSource(path),
      repoRoot: "/repo",
      repository: execution.repository,
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
      "historical evidence requires a schema-3 verified projection and independent execution receipt",
    );
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

  it("does not grant historical eligibility to checked repo-eval-only JSON", async () => {
    const report = cleanReport({
      claimBoundary: { publicClaimAllowed: false, reason: "repo evaluation only" },
      comparison: {
        ...cleanReport().comparison,
        availability: "repo-eval-only",
      },
      evidence: {
        artifacts: [{
          assertions: [{ equals: true, path: ["ok"] }],
          description: "repo-only smoke result",
          path: "reports/eval/repo-only.json",
        }],
      },
      publicClaim: undefined,
      status: "internal_evidence",
    });
    const evidenceErrors = await checkClaimEvidenceArtifacts({
      file: "example.json",
      readFile: async () => JSON.stringify({ ok: true }),
      repoRoot: "/repo",
      report,
    });
    const gate = buildClaimGateReport(
      [{ file: "example.json", value: report }],
      "2026-08-13T00:00:00Z",
      [],
      new Map([["example.json", evidenceErrors]]),
      "0.3.5",
    );

    expect(evidenceErrors).toEqual([]);
    expect(gate.entries[0]?.historicalEvidenceEligible).toBe(false);
    expect(gate.historicalEvidence).toEqual([]);
  });

  it("rejects traversal before assigning evidence-subtree trust", async () => {
    const source = JSON.stringify({
      benchmark: "Example",
      coverage: { actual: 10, expected: 10 },
      metrics: { baseline: 0.5, score: 0.8 },
      run: { executionFailures: 0 },
    });
    const projection = verifiedProjection({ source });
    const execution = bindIndependentExecutionReceipt({ projection, source });
    const report = cleanReport({
      evidence: {
        artifacts: [{
          assertions: verifiedProjectionAssertions(),
          description: "traversal projection",
          path: "benchmark-claims/evidence/../example-verified.json",
        }],
      },
      publicClaim: {
        readmeDisclosureFragments: ["disclosed"],
        readmeRequiredFragments: ["0.8000", "0.5000"],
      },
    });

    const errors = await checkClaimEvidenceArtifacts({
      currentPackageVersion: "0.3.5",
      file: "example.json",
      readFile: async (path) => path.endsWith("example-verified.json")
        ? JSON.stringify(projection)
        : execution.readSource(path),
      repoRoot: "/repo",
      repository: execution.repository,
      report,
    });

    expect(errors.join(" ")).toContain(
      "must use canonical forward-slash repo-relative form",
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
        assertions: verifiedProjectionAssertions("historical", {
          benchmark: "LongMemEval",
        }),
        description: "receipt-checked historical projection",
        path: "benchmark-claims/evidence/longmemeval-historical.json",
      }],
    },
    status: "internal_evidence",
  });

  it("extracts and validates receipt-checked versioned evidence without promoting it", () => {
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
      new Map([["longmemeval.json", []]]),
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
    const currentSourcePath = "reports/eval/current/report.json";
    const currentSource = JSON.stringify({
      benchmark: "LoCoMo",
      coverage: { actual: 10, complete: true, expected: 10 },
      metrics: {
        baseline: 0.5,
        openDomainCorrect: 61,
        openDomainScore: 0.61,
        openDomainTotal: 100,
        score: 0.8,
        strictScore: 0.63,
      },
      run: {
        commit: FULL_COMMIT,
        executionFailures: 0,
        packageVersion: "0.3.5",
      },
    });
    const currentProjection = {
      ...verifiedProjection({
        benchmark: "LoCoMo",
        source: currentSource,
        sourceArtifactPath: currentSourcePath,
      }),
      claim: { officialScore: 0.8, packageVersion: "0.3.5" },
    };
    const currentExecution = bindIndependentExecutionReceipt({
      projection: currentProjection,
      receiptPath: "benchmark-claims/evidence/locomo-current-execution.json",
      source: currentSource,
    });
    const historicalSourcePath = "reports/eval/historical/locomo.json";
    const historicalSource = JSON.stringify({
      benchmark: "LoCoMo",
      coverage: { actual: 10, complete: true, expected: 10 },
      metrics: {
        baseline: 0.5,
        openDomainCorrect: 61,
        openDomainScore: 0.61,
        openDomainTotal: 100,
        score: 0.87,
        strictScore: 0.63,
      },
      run: {
        commit: "f".repeat(40),
        executionFailures: 0,
        packageVersion: "0.6.0",
      },
    });
    const historicalProjection = {
      ...verifiedProjection({
        benchmark: "LoCoMo",
        commit: "f".repeat(40),
        packageVersion: "0.6.0",
        presentation: "historical",
        score: 0.87,
        source: historicalSource,
        sourceArtifactPath: historicalSourcePath,
      }),
      claim: {
        officialScore: 0.87,
        openDomainScore: 0.61,
        packageVersion: "0.6.0",
        strictScore: 0.63,
      },
    };
    const historicalExecution = bindIndependentExecutionReceipt({
      packageVersion: "0.6.0",
      projection: historicalProjection,
      receiptPath: "benchmark-claims/evidence/locomo-historical-execution.json",
      source: historicalSource,
    });
    candidate.evidence.artifacts = [
      {
        assertions: verifiedProjectionAssertions("current", { benchmark: "LoCoMo" }),
        description: "verified current projection",
        path: "benchmark-claims/evidence/locomo-current-verified.json",
      },
      {
        assertions: verifiedProjectionAssertions("historical", {
          benchmark: "LoCoMo",
          commit: "f".repeat(40),
          packageVersion: "0.6.0",
          score: 0.87,
        }),
        description: "verified historical projection",
        path: "benchmark-claims/evidence/locomo-historical-verified.json",
      },
    ];
    expect(validateClaimReport(candidate).valid).toBe(true);
    const evidenceErrors = await checkClaimEvidenceArtifacts({
      file: "locomo.json",
      readFile: async (path) => {
        if (path.endsWith("locomo-historical-verified.json")) {
          return JSON.stringify(historicalProjection);
        }
        if (path.endsWith("locomo-current-verified.json")) {
          return JSON.stringify(currentProjection);
        }
        if (
          path.endsWith(currentSourcePath) ||
          path.includes("locomo-current-execution")
        ) {
          return currentExecution.readSource(path);
        }
        return historicalExecution.readSource(path);
      },
      repoRoot: "/repo",
      repository: {
        readCommittedFile: async (path) => {
          if (path.includes("current")) {
            return currentExecution.repository.readCommittedFile(path);
          }
          return historicalExecution.repository.readCommittedFile(path);
        },
        readFileAtCommit: (commit, path) => commit === FULL_COMMIT
          ? currentExecution.repository.readFileAtCommit(commit, path)
          : historicalExecution.repository.readFileAtCommit(commit, path),
        resolveCommitTree: currentExecution.repository.resolveCommitTree,
      },
      report: candidate,
    });
    expect(evidenceErrors).toEqual([]);

    const report = buildClaimGateReport(
      [{ file: "locomo.json", value: candidate }],
      "t",
      [],
      new Map([["locomo.json", evidenceErrors]]),
    );
    expect(report.publicClaimable).toEqual(["LoCoMo"]);
    expect(report.historicalEvidence).toEqual(["LoCoMo"]);

    const current = checkReadmeClaimTables(
      [{
        content: `${readmeWithRows([
          "| LoCoMo current | 0.6300 / 0.8000 / 0.6100 / 61/100 / baseline 0.5000 | [locomo.json](./benchmark-claims/locomo.json) |",
        ])}\ncurrent-disclosure`,
        file: "README.md",
      }],
      report.entries,
    )[0];
    const historicalCheck = checkReadmeHistoricalEvidenceTables(
      [{
        content: `${historicalReadmeWithRows([
          "| LoCoMo v0.6.0 | 0.6300 / 0.8700 / 0.6100 / 61/100 / baseline 0.5000 | [locomo.json](./benchmark-claims/locomo.json) |",
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
          "| LoCoMo v0.6.0 | 0.6300 / 0.8000 / 0.6100 / 61/100 / baseline 0.5000 | [locomo.json](./benchmark-claims/locomo.json) |",
        ])}\ncurrent-disclosure`,
        file: "README.md",
      }],
      report.entries,
    )[0];
    expect(crossed?.consistent).toBe(false);
    expect(crossed?.claimContentErrors.join(" ")).toContain("0.8700");
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
        : JSON.stringify(currentClaimProjection()),
      repoRoot: "/repo",
      report: artifactTampered,
    });
    expect(evidenceErrors.join(" ")).toContain(
      "historical evidence requires a schema-3 verified projection and independent execution receipt",
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

  it("keeps paused declarations independent of ignored local benchmark reports", async () => {
    for (const file of ["implicitmembench.json", "longmemeval.json"]) {
      const report = JSON.parse(
        await readFile(
          join(import.meta.dir, "../../benchmark-claims", file),
          "utf8",
        ),
      ) as BenchmarkClaimReport;

      expect(report.status).toBe("paused_boundary");
      expect(report.evidence.artifacts).toEqual([]);
      expect(
        await checkClaimEvidenceArtifacts({
          file,
          readFile: async () => {
            throw new Error("clean checkout has no ignored benchmark reports");
          },
          repoRoot: "/clean-checkout",
          report,
        }),
      ).toEqual([]);
    }
  });
});
