import { readFileSync } from "node:fs";

import { describe, expect, it } from "bun:test";

import {
  assertV073ProviderStageCanContinue,
  assertV073SeedStageReport,
  assertV073ScenarioOutcome,
  buildV073ProviderFreeArgs,
  officialQuestionTransitions,
  parseV073ProviderFreeReport,
  parseV073ReplacementGateCliOptions,
  routeV073CommandChainThroughTape,
  V073_PROVIDER_STAGE_ORDER,
} from "../../scripts/run-v0-7-3-replacement-protection-gate";
import type { V073PairedCommandChain } from "../../scripts/run-v0-7-3-lifecycle-protection-gate";

function commandChain(): V073PairedCommandChain {
  const invocation = {
    args: ["run", "script.ts"],
    command: "bun" as const,
    cwd: "/worktree",
    environment: {
      GOODMEMORY_ASSISTED_EXTRACTOR_BASE_URL: "https://upstream.test/v1",
      GOODMEMORY_EMBEDDING_BASE_URL: "https://embedding.test/v1",
      GOODMEMORY_EVAL_BASE_URL: "https://upstream.test/v1",
      GOODMEMORY_EVAL_MODEL: "gpt-5.6-terra",
      GOODMEMORY_JUDGE_BASE_URL: "https://upstream.test/v1",
      GOODMEMORY_RERANKING_BASE_URL: "https://upstream.test/v1",
    },
  };
  return {
    officialRescore: { ...invocation, environment: { ...invocation.environment } },
    reanswer: { ...invocation, environment: { ...invocation.environment } },
    seedSmoke: { ...invocation, environment: { ...invocation.environment } },
  };
}

describe("v0.7.3 replacement protection gate runner", () => {
  it("stops a formal stage after the first command that has tape misses", () => {
    expect(() => assertV073ProviderStageCanContinue("replay", {
      coalesced: 0,
      hits: 10,
      liveRequests: 0,
      misses: 1,
      mode: "replay",
      name: "baseline-formal",
      requestFingerprintMultisetSha256: "a".repeat(64),
      requests: 11,
      tapeSha256: "b".repeat(64),
      targetCounts: { eval: 11 },
    })).toThrow("formal provider replay observed 1 tape miss");
  });

  it("rejects seed execution failures before downstream provider stages", () => {
    const raw = readFileSync(
      "reports/release/v0.7/blocked-6eb0f87d/attribution-controls/provider-free-c1-baseline.json",
      "utf8",
    );
    expect(() => assertV073SeedStageReport(raw)).not.toThrow();
    expect(() => assertV073SeedStageReport(JSON.stringify({
      ...JSON.parse(raw) as Record<string, unknown>,
      executionFailures: 1,
    }))).toThrow("provider seed report is incomplete");
  });

  it("derives the provider-free population from the four claim categories", () => {
    expect(buildV073ProviderFreeArgs({
      benchmarkRoot: "/tmp/locomo",
      concurrency: 1,
      outputDir: "/tmp/evidence",
      runId: "provider-free-c1",
    })).toEqual([
      "run",
      "scripts/run-phase-65-locomo-smoke.ts",
      "--",
      "--benchmark-root",
      "/tmp/locomo",
      "--case-id",
      "locomo-conv-26",
      "--case-id",
      "locomo-conv-30",
      "--category",
      "single_hop",
      "--category",
      "multi_hop",
      "--category",
      "temporal",
      "--category",
      "open_domain",
      "--label-free-ingest",
      "--generalized-fusion",
      "--concurrency",
      "1",
      "--output-dir",
      "/tmp/evidence",
      "--run-id",
      "provider-free-c1",
    ]);
  });

  it("computes paired transitions from official rows by question identity", () => {
    expect(officialQuestionTransitions(
      [
        { correct: false, questionId: "q1" },
        { correct: true, questionId: "q2" },
        { correct: true, questionId: "q3" },
      ],
      [
        { correct: true, questionId: "q3" },
        { correct: true, questionId: "q1" },
        { correct: false, questionId: "q2" },
      ],
    )).toEqual({ improved: 1, regressed: 1, total: 3 });
  });

  it("runs every provider stage in data-dependency order", () => {
    expect(V073_PROVIDER_STAGE_ORDER).toEqual([
      "seedSmoke",
      "reanswer",
      "officialRescore",
    ]);
  });

  it("routes only provider base URLs through their logical tape lanes", () => {
    const routed = routeV073CommandChainThroughTape(
      commandChain(),
      {
        assisted: "http://127.0.0.1:3000/assisted",
        embedding: "http://127.0.0.1:3000/embedding",
        eval: "http://127.0.0.1:3000/eval",
        judge: "http://127.0.0.1:3000/judge",
        reranking: "http://127.0.0.1:3000/reranking",
      },
      { replayCredentials: true },
    );

    expect(routed.seedSmoke.environment).toMatchObject({
      GOODMEMORY_ASSISTED_EXTRACTOR_BASE_URL:
        "http://127.0.0.1:3000/assisted",
      GOODMEMORY_EMBEDDING_BASE_URL: "http://127.0.0.1:3000/embedding",
      GOODMEMORY_EVAL_BASE_URL: "http://127.0.0.1:3000/eval",
      GOODMEMORY_EVAL_MODEL: "gpt-5.6-terra",
      GOODMEMORY_RERANKING_BASE_URL: "http://127.0.0.1:3000/reranking",
    });
    expect(routed.officialRescore.environment.GOODMEMORY_JUDGE_BASE_URL).toBe(
      "http://127.0.0.1:3000/judge",
    );
    expect(routed.officialRescore.environment).toMatchObject({
      GOODMEMORY_ASSISTED_EXTRACTOR_BASE_URL:
        "http://127.0.0.1:3000/assisted",
      GOODMEMORY_EMBEDDING_BASE_URL: "http://127.0.0.1:3000/embedding",
      GOODMEMORY_EVAL_BASE_URL: "http://127.0.0.1:3000/eval",
      GOODMEMORY_JUDGE_BASE_URL: "http://127.0.0.1:3000/judge",
      GOODMEMORY_RERANKING_BASE_URL: "http://127.0.0.1:3000/reranking",
    });
    expect(routed.officialRescore.environment.GOODMEMORY_JUDGE_API_KEY).toBe(
      "provider-response-tape-replay",
    );
    expect(commandChain().seedSmoke.environment.GOODMEMORY_EVAL_BASE_URL).toBe(
      "https://upstream.test/v1",
    );
  });

  it("parses only detached-checkout inputs and one fresh evidence root", () => {
    expect(parseV073ReplacementGateCliOptions([
      "--baseline-worktree",
      "/tmp/baseline",
      "--candidate-worktree",
      "/tmp/candidate",
      "--benchmark-root",
      "/tmp/locomo",
      "--output-dir",
      "/tmp/evidence",
    ])).toEqual({
      baselineWorktree: "/tmp/baseline",
      benchmarkRoot: "/tmp/locomo",
      candidateWorktree: "/tmp/candidate",
      outputDir: "/tmp/evidence",
    });
  });

  it("makes the package gate invoke the replacement runner", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts["gate:v0.7.3-lifecycle-protection"]).toBe(
      "bun run scripts/run-v0-7-3-replacement-protection-gate.ts",
    );
  });

  it("accepts only the preregistered provider-free population and transport-free mode", () => {
    const raw = readFileSync(
      "reports/release/v0.7/blocked-6eb0f87d/attribution-controls/provider-free-c1-baseline.json",
      "utf8",
    );
    const report = parseV073ProviderFreeReport({
      benchmarkRoot:
        "/Users/hjqcan/.cache/goodmemory-benchmarks/LoCoMo-captioned-full10-v1",
      concurrency: 1,
      raw,
    });
    expect(report.questionCount).toBe(233);

    expect(() => parseV073ProviderFreeReport({
      benchmarkRoot:
        "/Users/hjqcan/.cache/goodmemory-benchmarks/LoCoMo-captioned-full10-v1",
      concurrency: 1,
      raw: JSON.stringify({ ...report, providerReranking: true }),
    })).toThrow("provider-free report does not match the preregistered mode");

    const drifted = JSON.parse(raw) as { cases: Array<{ questionId: string }> };
    drifted.cases[0]!.questionId = "drifted-question";
    expect(() => parseV073ProviderFreeReport({
      benchmarkRoot:
        "/Users/hjqcan/.cache/goodmemory-benchmarks/LoCoMo-captioned-full10-v1",
      concurrency: 1,
      raw: JSON.stringify(drifted),
    })).toThrow("provider-free report does not match the frozen question selection");

    for (const mutate of [
      (row: Record<string, unknown>) => {
        row.evidenceRecall = row.evidenceRecall === 1 ? 0 : 1;
      },
      (row: Record<string, unknown>) => {
        row.goldEvidenceFullyRetrieved = !row.goldEvidenceFullyRetrieved;
      },
      (row: Record<string, unknown>) => {
        row.missingEvidenceTurnIds = ["D999:1"];
      },
      (row: Record<string, unknown>) => {
        row.noiseTurnCount = 0;
      },
      (row: Record<string, unknown>) => {
        row.noiseTurnIds = [];
      },
    ]) {
      const inconsistent = JSON.parse(raw) as {
        cases: Array<Record<string, unknown>>;
      };
      mutate(inconsistent.cases[0]!);
      expect(() => parseV073ProviderFreeReport({
        benchmarkRoot:
          "/Users/hjqcan/.cache/goodmemory-benchmarks/LoCoMo-captioned-full10-v1",
        concurrency: 1,
        raw: JSON.stringify(inconsistent),
      })).toThrow("provider-free retrieval metrics are inconsistent");
    }
  });

  it("rejects unsuccessful or unparseable scenario outcomes", () => {
    expect(() => assertV073ScenarioOutcome({
      exitCode: 1,
      failures: 0,
      passed: 8,
    })).toThrow("scenario replay exited with 1");
    expect(() => assertV073ScenarioOutcome({
      exitCode: 0,
      failures: -1,
      passed: 8,
    })).toThrow("scenario replay counts are invalid");
    expect(() => assertV073ScenarioOutcome({
      exitCode: 0,
      failures: 0,
      passed: 8,
    })).not.toThrow();
  });
});
