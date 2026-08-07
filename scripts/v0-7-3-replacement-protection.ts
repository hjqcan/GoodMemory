const BASELINE_COMMIT = "456edd106f29118b3455bf21c43d7b3107b48213";
const MAX_REGRESSION = 0.01;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;

export interface V073ProtectionSmokeCase {
  caseId: string;
  category: string;
  evidenceRecall: number;
  questionId: string;
}

export interface V073ProtectionSmokeReport {
  cases: V073ProtectionSmokeCase[];
  executionFailures: number;
  questionCount: number;
}

export interface V073ProviderReplaySession {
  coalesced: number;
  hits: number;
  liveRequests: number;
  misses: number;
  mode: "prefetch" | "replay";
  non2xxResponses: number;
  requestFingerprintMultisetSha256: string;
  requestSequenceSha256: string;
  requests: number;
  sequenceMismatches: number;
  targetCounts: Record<string, number>;
  tapeSha256: string;
}

export interface V073ReplacementProtectionInput {
  baselineCommit: string;
  candidateCommit: string;
  candidatePromptSha256: string;
  deterministicArms: Array<{
    baseline: V073ProtectionSmokeReport;
    candidate: V073ProtectionSmokeReport;
    concurrency: number;
  }>;
  providerReplay: {
    baselineExecutionFailures: number;
    baselineJudgeFailures: number;
    candidateExecutionFailures: number;
    candidateJudgeFailures: number;
    concurrency: 1;
    discovery: {
      baseline: V073ProviderReplaySession;
      candidate: V073ProviderReplaySession;
    };
    formal: {
      baseline: V073ProviderReplaySession;
      candidate: V073ProviderReplaySession;
    };
    pointDeltas?: {
      evidenceRecall: number;
      officialScore: number;
      strictAnswerScore: number;
    };
    tapeEntryCount: number;
    tapeSha256: string;
    tapeTargetCounts: Record<string, number>;
  };
  questionTransitions: {
    improved: number;
    regressed: number;
    total: number;
  };
  scenarioReplay: {
    failures: number;
    passed: number;
  };
}

interface MetricDelta {
  baseline: number;
  candidate: number;
  delta: number;
}

interface EvidenceMetrics {
  categories: Record<string, MetricDelta>;
  conversations: Record<string, MetricDelta>;
  overall: MetricDelta;
}

export interface ExactSignTestResult {
  alpha: 0.05;
  discordant: number;
  improved: number;
  pValue: number;
  regressed: number;
  significant: boolean;
  test: "exact_two_sided_sign_test";
}

export interface V073ReplacementProtectionReport {
  baselineCommit: string;
  blockers: string[];
  candidateCommit: string;
  candidatePromptSha256: string;
  claimBoundary: string;
  fullClaimRerunRequired: true;
  generatedAt: string;
  generatedBy: "scripts/run-v0-7-3-replacement-protection-gate.ts";
  hardGate: {
    providerFree: Array<EvidenceMetrics & { concurrency: number }>;
    scenarioReplay: {
      failures: number;
      passed: number;
    };
  };
  liveDiagnostic: {
    signTest: ExactSignTestResult;
    totalQuestions: number;
  };
  providerReplay: V073ReplacementProtectionInput["providerReplay"];
  releaseAllowed: boolean;
  researchRecordRequired: boolean;
  schemaVersion: 4;
}

function logAdd(left: number, right: number): number {
  if (left === Number.NEGATIVE_INFINITY) {
    return right;
  }
  const high = Math.max(left, right);
  const low = Math.min(left, right);
  return high + Math.log1p(Math.exp(low - high));
}

export function exactTwoSidedSignTest(input: {
  improved: number;
  regressed: number;
}): ExactSignTestResult {
  const { improved, regressed } = input;
  if (
    !Number.isSafeInteger(improved) ||
    !Number.isSafeInteger(regressed) ||
    improved < 0 ||
    regressed < 0
  ) {
    throw new Error("sign-test transition counts must be non-negative integers");
  }
  const discordant = improved + regressed;
  const tail = Math.min(improved, regressed);
  let logProbability = -discordant * Math.log(2);
  let logTail = Number.NEGATIVE_INFINITY;
  for (let count = 0; count <= tail; count += 1) {
    logTail = logAdd(logTail, logProbability);
    logProbability +=
      Math.log(discordant - count) - Math.log(count + 1);
  }
  const pValue = discordant === 0
    ? 1
    : Math.min(1, 2 * Math.exp(logTail));
  return {
    alpha: 0.05,
    discordant,
    improved,
    pValue,
    regressed,
    significant: pValue < 0.05,
    test: "exact_two_sided_sign_test",
  };
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function metricDelta(
  baselineRows: readonly V073ProtectionSmokeCase[],
  candidateRows: readonly V073ProtectionSmokeCase[],
): MetricDelta {
  const baseline = mean(baselineRows.map((row) => row.evidenceRecall));
  const candidate = mean(candidateRows.map((row) => row.evidenceRecall));
  return { baseline, candidate, delta: candidate - baseline };
}

function identity(report: V073ProtectionSmokeReport): unknown {
  return report.cases.map(({ caseId, category, questionId }) => ({
    caseId,
    category,
    questionId,
  }));
}

function assertSmokePair(input: {
  baseline: V073ProtectionSmokeReport;
  candidate: V073ProtectionSmokeReport;
  concurrency: number;
}): void {
  for (const [label, report] of [
    ["baseline", input.baseline],
    ["candidate", input.candidate],
  ] as const) {
    if (
      report.questionCount <= 0 ||
      report.questionCount !== report.cases.length
    ) {
      throw new Error(
        `provider-free concurrency ${input.concurrency} ${label} question count is invalid`,
      );
    }
    if (report.cases.some((row) =>
      !Number.isFinite(row.evidenceRecall) ||
      row.evidenceRecall < 0 ||
      row.evidenceRecall > 1
    )) {
      throw new Error("provider-free evidenceRecall values must be in [0, 1]");
    }
  }
  if (JSON.stringify(identity(input.baseline)) !== JSON.stringify(identity(input.candidate))) {
    throw new Error(
      `provider-free concurrency ${input.concurrency} question identities must match`,
    );
  }
}

function evidenceMetrics(input: {
  baseline: V073ProtectionSmokeReport;
  candidate: V073ProtectionSmokeReport;
}): EvidenceMetrics {
  const categories = [...new Set(input.baseline.cases.map((row) => row.category))];
  const conversations = [...new Set(input.baseline.cases.map((row) => row.caseId))];
  const rows = (
    report: V073ProtectionSmokeReport,
    field: "caseId" | "category",
    value: string,
  ) => report.cases.filter((row) => row[field] === value);
  return {
    categories: Object.fromEntries(categories.map((category) => [
      category,
      metricDelta(
        rows(input.baseline, "category", category),
        rows(input.candidate, "category", category),
      ),
    ])),
    conversations: Object.fromEntries(conversations.map((conversation) => [
      conversation,
      metricDelta(
        rows(input.baseline, "caseId", conversation),
        rows(input.candidate, "caseId", conversation),
      ),
    ])),
    overall: metricDelta(input.baseline.cases, input.candidate.cases),
  };
}

function metricEntries(
  arm: EvidenceMetrics & { concurrency: number },
): Array<{ label: string; metric: MetricDelta }> {
  return [
    {
      label: `provider-free concurrency ${arm.concurrency} overall evidenceRecall`,
      metric: arm.overall,
    },
    ...Object.entries(arm.categories).map(([category, metric]) => ({
      label:
        `provider-free concurrency ${arm.concurrency} category ${category} evidenceRecall`,
      metric,
    })),
    ...Object.entries(arm.conversations).map(([conversation, metric]) => ({
      label:
        `provider-free concurrency ${arm.concurrency} conversation ${conversation} evidenceRecall`,
      metric,
    })),
  ];
}

function assertReplaySession(
  session: V073ProviderReplaySession,
  expectedMode: "prefetch" | "replay",
): void {
  if (session.mode !== expectedMode) {
    throw new Error(`provider replay session must use ${expectedMode} mode`);
  }
  for (const value of [
    session.coalesced,
    session.hits,
    session.liveRequests,
    session.misses,
    session.non2xxResponses,
    session.requests,
    session.sequenceMismatches,
  ]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error("provider replay counts must be non-negative integers");
    }
  }
  if (!SHA256_PATTERN.test(session.tapeSha256)) {
    throw new Error("provider replay tape fingerprint must be SHA-256");
  }
  if (!SHA256_PATTERN.test(session.requestFingerprintMultisetSha256)) {
    throw new Error("provider replay request multiset must be SHA-256");
  }
  if (!SHA256_PATTERN.test(session.requestSequenceSha256)) {
    throw new Error("provider replay request sequence must be SHA-256");
  }
  if (
    session.requests <= 0 ||
    session.hits + session.misses + session.coalesced +
        session.sequenceMismatches !== session.requests ||
    JSON.stringify(Object.keys(session.targetCounts).sort()) !==
      JSON.stringify(["embedding", "eval", "judge"]) ||
    Object.values(session.targetCounts).some(
      (count) => !Number.isSafeInteger(count) || count <= 0,
    ) ||
    Object.values(session.targetCounts).reduce((sum, count) => sum + count, 0) !==
      session.requests
  ) {
    throw new Error("provider replay session request census is invalid");
  }
  if (expectedMode === "prefetch" && session.liveRequests !== session.misses) {
    throw new Error("provider prefetch misses must equal live requests");
  }
  if (expectedMode === "prefetch" && session.non2xxResponses !== 0) {
    throw new Error("provider discovery must contain only successful responses");
  }
  if (expectedMode === "prefetch" && session.sequenceMismatches !== 0) {
    throw new Error("provider discovery cannot have input sequence mismatches");
  }
}

export function evaluateV073ReplacementProtection(
  input: V073ReplacementProtectionInput,
): V073ReplacementProtectionReport {
  if (input.baselineCommit !== BASELINE_COMMIT) {
    throw new Error(`baseline commit must be ${BASELINE_COMMIT}`);
  }
  if (
    !COMMIT_PATTERN.test(input.candidateCommit) ||
    input.candidateCommit === input.baselineCommit
  ) {
    throw new Error("candidate commit must be a distinct full SHA");
  }
  if (!SHA256_PATTERN.test(input.candidatePromptSha256)) {
    throw new Error("candidate prompt fingerprint must be SHA-256");
  }
  const concurrency = input.deterministicArms
    .map((arm) => arm.concurrency)
    .sort((left, right) => left - right);
  if (JSON.stringify(concurrency) !== JSON.stringify([1, 40])) {
    throw new Error("provider-free hard gate requires concurrency 1 and 40 arms");
  }
  const providerFree = [...input.deterministicArms]
    .sort((left, right) => left.concurrency - right.concurrency)
    .map((arm) => {
      assertSmokePair(arm);
      return { concurrency: arm.concurrency, ...evidenceMetrics(arm) };
    });
  if (input.providerReplay.concurrency !== 1) {
    throw new Error("provider replay diagnostic must use concurrency 1");
  }
  for (const session of [
    input.providerReplay.discovery.baseline,
    input.providerReplay.discovery.candidate,
  ]) {
    assertReplaySession(session, "prefetch");
  }
  for (const session of [
    input.providerReplay.formal.baseline,
    input.providerReplay.formal.candidate,
  ]) {
    assertReplaySession(session, "replay");
    if (session.tapeSha256 !== input.providerReplay.tapeSha256) {
      throw new Error(
        "formal provider replay sessions must use the frozen tape fingerprint",
      );
    }
  }
  for (const side of ["baseline", "candidate"] as const) {
    const discovery = input.providerReplay.discovery[side];
    const formal = input.providerReplay.formal[side];
    if (
      formal.sequenceMismatches !== 0 ||
      discovery.requestSequenceSha256 !== formal.requestSequenceSha256 ||
      discovery.requestFingerprintMultisetSha256 !==
        formal.requestFingerprintMultisetSha256 ||
      JSON.stringify(discovery.targetCounts) !== JSON.stringify(formal.targetCounts)
    ) {
      throw new Error(
        `${side} formal provider replay input sequence must match discovery`,
      );
    }
  }
  if (
    !SHA256_PATTERN.test(input.providerReplay.tapeSha256) ||
    !Number.isSafeInteger(input.providerReplay.tapeEntryCount) ||
    input.providerReplay.tapeEntryCount <= 0 ||
    JSON.stringify(Object.keys(input.providerReplay.tapeTargetCounts).sort()) !==
      JSON.stringify(["embedding", "eval", "judge"]) ||
    Object.values(input.providerReplay.tapeTargetCounts).some(
      (count) => !Number.isSafeInteger(count) || count <= 0,
    )
  ) {
    throw new Error(
      "frozen provider tape must contain only non-empty embedding, eval, and judge lanes",
    );
  }
  if (
    Object.values(input.providerReplay.tapeTargetCounts).reduce(
      (sum, count) => sum + count,
      0,
    ) !== input.providerReplay.tapeEntryCount
  ) {
    throw new Error("frozen provider tape identity is invalid");
  }
  const signTest = exactTwoSidedSignTest(input.questionTransitions);
  if (
    !Number.isSafeInteger(input.questionTransitions.total) ||
    input.questionTransitions.total < signTest.discordant
  ) {
    throw new Error("question transition total is invalid");
  }

  const blockers = providerFree
    .flatMap(metricEntries)
    .filter(({ metric }) => metric.delta < -MAX_REGRESSION - Number.EPSILON)
    .map(({ label }) => `${label} regressed by more than 1.00pt`);
  for (const arm of input.deterministicArms) {
    if (arm.baseline.executionFailures !== 0 || arm.candidate.executionFailures !== 0) {
      blockers.push(
        `provider-free concurrency ${arm.concurrency} must have zero execution failures`,
      );
    }
  }
  if (input.scenarioReplay.failures !== 0 || input.scenarioReplay.passed < 1) {
    blockers.push("scenario replay must pass with zero failures");
  }
  for (const [label, session] of [
    ["baseline", input.providerReplay.formal.baseline],
    ["candidate", input.providerReplay.formal.candidate],
  ] as const) {
    if (
      session.hits !== session.requests ||
      session.misses !== 0 ||
      session.liveRequests !== 0 ||
      session.non2xxResponses !== 0 ||
      session.coalesced !== 0 ||
      session.sequenceMismatches !== 0
    ) {
      blockers.push(
        `${label} formal provider replay must be non-empty and fully tape-backed`,
      );
    }
  }
  if (
    input.providerReplay.baselineExecutionFailures !== 0 ||
    input.providerReplay.candidateExecutionFailures !== 0 ||
    input.providerReplay.baselineJudgeFailures !== 0 ||
    input.providerReplay.candidateJudgeFailures !== 0
  ) {
    blockers.push("formal provider replay must have zero execution and judge failures");
  }

  const deterministicMoved = providerFree
    .flatMap(metricEntries)
    .some(({ metric }) => Math.abs(metric.delta) > MAX_REGRESSION + Number.EPSILON);
  const providerMoved = input.providerReplay.pointDeltas === undefined
    ? false
    : Object.values(input.providerReplay.pointDeltas).some(
      (delta) => Math.abs(delta) > MAX_REGRESSION + Number.EPSILON,
    );
  return {
    baselineCommit: input.baselineCommit,
    blockers,
    candidateCommit: input.candidateCommit,
    candidatePromptSha256: input.candidatePromptSha256,
    claimBoundary:
      "The hard 1.00pt protection decision is carried by provider-free paired retrieval at concurrency 1 and 40 plus deterministic scenario replay. The provider diagnostic runs at concurrency 1: ordered provider inputs and responses are frozen during discovery, and both formal arms require exact input-sequence replay with network-on-miss disabled. Provider point deltas and the exact paired sign test are diagnostic only; they cannot override the deterministic hard gate. The full 1540-question claim must be rerun at the release commit with frozen replay evidence or an explicit provider-variance spread.",
    fullClaimRerunRequired: true,
    generatedAt: new Date().toISOString(),
    generatedBy: "scripts/run-v0-7-3-replacement-protection-gate.ts",
    hardGate: {
      providerFree,
      scenarioReplay: { ...input.scenarioReplay },
    },
    liveDiagnostic: {
      signTest,
      totalQuestions: input.questionTransitions.total,
    },
    providerReplay: input.providerReplay,
    releaseAllowed: blockers.length === 0,
    researchRecordRequired: deterministicMoved || providerMoved,
    schemaVersion: 4,
  };
}
