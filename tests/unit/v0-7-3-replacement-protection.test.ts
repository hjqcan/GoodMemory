import { describe, expect, it } from "bun:test";

import {
  evaluateV073ReplacementProtection,
  exactTwoSidedSignTest,
  type V073ReplacementProtectionInput,
} from "../../scripts/v0-7-3-replacement-protection";

const BASELINE_COMMIT = "456edd106f29118b3455bf21c43d7b3107b48213";
const CANDIDATE_COMMIT = "a".repeat(40);
const TAPE_SHA256 = "b".repeat(64);

function smokeReport(values: readonly number[]) {
  return {
    cases: values.map((evidenceRecall, index) => ({
      caseId: index % 2 === 0 ? "locomo-conv-26" : "locomo-conv-30",
      category: index % 2 === 0 ? "temporal" : "single_hop",
      evidenceRecall,
      questionId: `q${index}`,
    })),
    executionFailures: 0,
    questionCount: values.length,
  };
}

function replaySession(input: {
  coalesced?: number;
  hits?: number;
  liveRequests?: number;
  misses?: number;
  mode?: "prefetch" | "replay";
  non2xxResponses?: number;
  requestFingerprintMultisetSha256?: string;
  requestSequenceSha256?: string;
  requests?: number;
  sequenceMismatches?: number;
  targetCounts?: Record<string, number>;
  tapeSha256?: string;
  transportAttemptLedgerSha256?: string;
  transportAttempts?: number;
  transportErrors?: number;
} = {}) {
  const requests = input.requests ?? 12;
  const misses = input.misses ?? 0;
  const mode = input.mode ?? "replay";
  const liveRequests = input.liveRequests ?? misses;
  return {
    coalesced: input.coalesced ?? 0,
    hits: input.hits ?? requests - misses,
    liveRequests,
    misses,
    mode,
    non2xxResponses: input.non2xxResponses ?? 0,
    requestFingerprintMultisetSha256:
      input.requestFingerprintMultisetSha256 ?? "c".repeat(64),
    requestSequenceSha256: input.requestSequenceSha256 ?? "d".repeat(64),
    requests,
    sequenceMismatches: input.sequenceMismatches ?? 0,
    targetCounts: input.targetCounts ?? { embedding: 3, eval: 8, judge: 1 },
    tapeSha256: input.tapeSha256 ?? TAPE_SHA256,
    transportAttemptLedgerSha256:
      input.transportAttemptLedgerSha256 ?? (mode === "replay"
        ? "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
        : "e".repeat(64)),
    transportAttempts: input.transportAttempts ??
      (mode === "prefetch" ? liveRequests : 0),
    transportErrors: input.transportErrors ?? 0,
  };
}

function protectionInput(): V073ReplacementProtectionInput {
  return {
    baselineCommit: BASELINE_COMMIT,
    candidateCommit: CANDIDATE_COMMIT,
    candidatePromptSha256: "d".repeat(64),
    deterministicArms: [
      {
        baseline: smokeReport([0.4, 0.5, 0.6, 0.7]),
        candidate: smokeReport([0.4, 0.5, 0.6, 0.7]),
        concurrency: 1,
      },
      {
        baseline: smokeReport([0.4, 0.5, 0.6, 0.7]),
        candidate: smokeReport([0.4, 0.5, 0.6, 0.7]),
        concurrency: 40,
      },
    ],
    providerPreflight: {
      probeOrder: [
        "eval-listwise",
        "eval-listwise",
        "eval-listwise",
        "embedding",
        "judge",
      ],
      probes: [
        { attempt: 1, responseKind: "stream-object", status: 200, target: "eval-listwise" },
        { attempt: 2, responseKind: "stream-object", status: 200, target: "eval-listwise" },
        { attempt: 3, responseKind: "stream-object", status: 200, target: "eval-listwise" },
        { attempt: 1, responseKind: "embedding", status: 200, target: "embedding" },
        { attempt: 1, responseKind: "chat-json", status: 200, target: "judge" },
      ],
      totalRequests: 5,
    },
    providerReplay: {
      baselineExecutionFailures: 0,
      baselineJudgeFailures: 0,
      candidateExecutionFailures: 0,
      candidateJudgeFailures: 0,
      concurrency: 1,
      discovery: {
        baseline: replaySession({
          hits: 2,
          liveRequests: 10,
          misses: 10,
          mode: "prefetch",
        }),
        candidate: replaySession({
          hits: 9,
          liveRequests: 3,
          misses: 3,
          mode: "prefetch",
        }),
      },
      formal: {
        baseline: replaySession(),
        candidate: replaySession(),
      },
      tapeEntryCount: 13,
      tapeSha256: TAPE_SHA256,
      tapeTargetCounts: { embedding: 3, eval: 9, judge: 1 },
    },
    questionTransitions: {
      improved: 11,
      regressed: 15,
      total: 233,
    },
    scenarioReplay: {
      failures: 0,
      passed: 8,
    },
  };
}

describe("v0.7.3 replacement protection protocol", () => {
  it("computes the preregistered exact paired sign test", () => {
    expect(exactTwoSidedSignTest({ improved: 11, regressed: 15 })).toEqual({
      alpha: 0.05,
      discordant: 26,
      improved: 11,
      pValue: 0.5571970939636236,
      regressed: 15,
      significant: false,
      test: "exact_two_sided_sign_test",
    });
    expect(exactTwoSidedSignTest({ improved: 0, regressed: 0 }).pValue).toBe(1);
  });

  it("lets deterministic provider-free arms and scenario replay carry the hard gate", () => {
    const report = evaluateV073ReplacementProtection(protectionInput());

    expect(report.releaseAllowed).toBe(true);
    expect(report.blockers).toEqual([]);
    expect(report.hardGate.providerFree.map((arm) => arm.concurrency)).toEqual([
      1,
      40,
    ]);
    expect(report.providerReplay.discovery.candidate.misses).toBe(3);
    expect(report.providerReplay.formal.candidate.liveRequests).toBe(0);
    expect(report.liveDiagnostic.signTest.pValue).toBeCloseTo(0.5571970939636236, 14);
    expect(report.providerPreflight.totalRequests).toBe(5);
    expect(report.schemaVersion).toBe(8);
  });

  it("rejects a provider preflight with incomplete role coverage", () => {
    const input = protectionInput();
    input.providerPreflight.probes.pop();
    input.providerPreflight.totalRequests -= 1;

    expect(() => evaluateV073ReplacementProtection(input)).toThrow(
      "provider availability preflight must contain the five successful probes",
    );
  });

  it("blocks a deterministic regression beyond one point", () => {
    const input = protectionInput();
    input.deterministicArms[0] = {
      ...input.deterministicArms[0]!,
      candidate: smokeReport([0.35, 0.5, 0.6, 0.7]),
    };

    const report = evaluateV073ReplacementProtection(input);

    expect(report.releaseAllowed).toBe(false);
    expect(report.blockers).toContain(
      "provider-free concurrency 1 category temporal evidenceRecall regressed by more than 1.00pt",
    );
  });

  it("blocks scenario failures and any networked request in a formal replay arm", () => {
    const input = protectionInput();
    input.scenarioReplay.failures = 1;
    input.providerReplay.formal.candidate = replaySession({
      hits: 11,
      liveRequests: 1,
      misses: 1,
    });

    const report = evaluateV073ReplacementProtection(input);

    expect(report.releaseAllowed).toBe(false);
    expect(report.blockers).toContain("scenario replay must pass with zero failures");
    expect(report.blockers).toContain(
      "candidate formal provider replay must be non-empty and fully tape-backed",
    );
  });

  it("rejects an empty or partially observed formal replay", () => {
    const empty = protectionInput();
    empty.providerReplay.formal.baseline = replaySession({
      hits: 0,
      requests: 0,
      targetCounts: {},
    });
    expect(() => evaluateV073ReplacementProtection(empty)).toThrow(
      "provider replay session request census is invalid",
    );

    const partial = protectionInput();
    partial.providerReplay.formal.baseline = replaySession({
      coalesced: 1,
      hits: 11,
    });
    expect(evaluateV073ReplacementProtection(partial).blockers).toContain(
      "baseline formal provider replay must be non-empty and fully tape-backed",
    );
  });

  it("reports provider point movement and a non-significant sign test without turning either into a raw point blocker", () => {
    const input = protectionInput();
    input.providerReplay.pointDeltas = {
      evidenceRecall: -0.025,
      officialScore: -0.021,
      strictAnswerScore: -0.03,
    };

    const report = evaluateV073ReplacementProtection(input);

    expect(report.releaseAllowed).toBe(true);
    expect(report.providerReplay.pointDeltas?.strictAnswerScore).toBe(-0.03);
    expect(report.liveDiagnostic.signTest.significant).toBe(false);
  });

  it("rejects a replay session bound to a different tape", () => {
    const input = protectionInput();
    input.providerReplay.formal.baseline = replaySession({
      tapeSha256: "c".repeat(64),
    });

    expect(() => evaluateV073ReplacementProtection(input)).toThrow(
      "formal provider replay sessions must use the frozen tape fingerprint",
    );
  });

  it("accepts recovered discovery non-2xx responses when formal replay is exact", () => {
    const input = protectionInput();
    input.providerReplay.discovery.baseline = replaySession({
      hits: 1,
      liveRequests: 11,
      misses: 11,
      mode: "prefetch",
      non2xxResponses: 1,
    });

    expect(evaluateV073ReplacementProtection(input).releaseAllowed).toBe(true);
  });

  it("accepts recovered discovery transport errors when formal replay is exact", () => {
    const input = protectionInput();
    input.providerReplay.discovery.baseline = replaySession({
      hits: 2,
      liveRequests: 10,
      misses: 10,
      mode: "prefetch",
      transportAttempts: 10,
      transportErrors: 1,
    });

    expect(evaluateV073ReplacementProtection(input).releaseAllowed).toBe(true);
  });

  it("rejects any formal provider input sequence drift", () => {
    const input = protectionInput();
    input.providerReplay.formal.baseline = replaySession({
      hits: 11,
      requestSequenceSha256: "e".repeat(64),
      sequenceMismatches: 1,
    });

    expect(() => evaluateV073ReplacementProtection(input)).toThrow(
      "baseline formal provider replay input sequence must match discovery",
    );
  });

  it("requires the three provider lanes actually exercised by the claim chain", () => {
    const input = protectionInput();
    input.providerReplay.tapeTargetCounts = {
      assisted: 1,
      embedding: 3,
      eval: 8,
      judge: 1,
    };

    expect(() => evaluateV073ReplacementProtection(input)).toThrow(
      "frozen provider tape must contain only non-empty embedding, eval, and judge lanes",
    );
  });
});
