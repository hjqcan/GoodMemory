import type { EvidenceLedgerFormat } from "../src/eval/evidenceLedgerFormats";

export const PHASE74_PRODUCT_ARMS = [
  "release-v0.6.0",
  "phase74-final",
] as const;

export type Phase74ProductArm = (typeof PHASE74_PRODUCT_ARMS)[number];

export interface Phase74ProductCase {
  caseId: string;
  clusterId: string;
  memoryGroupId: string;
  question: string;
}

export interface Phase74ProductQueryResult {
  context: string;
  contextTokens: number;
  queryPathLatencyMs: number;
  recallLatencyMs: number;
}

export interface Phase74ProductPreparedGroup {
  arm: Phase74ProductArm;
  ingestionKey: string;
  memoryGroupId: string;
  query(testCase: Phase74ProductCase): Promise<Phase74ProductQueryResult>;
}

export interface Phase74ProductComparisonRow {
  answer: string;
  answerLatencyMs: number;
  arm: Phase74ProductArm;
  caseId: string;
  clusterId: string;
  contextTokens: number;
  correct: boolean;
  ingestionKey: string;
  judgeLatencyMs: number;
  memoryGroupId: string;
  productLatencyMs: number;
  queryPathLatencyMs: number;
  recallLatencyMs: number;
  score: number;
}

function assertUniqueCases(cases: readonly Phase74ProductCase[]): void {
  if (
    cases.length === 0 ||
    new Set(cases.map(({ caseId }) => caseId)).size !== cases.length ||
    cases.some(({ caseId, clusterId, memoryGroupId, question }) =>
      caseId.length === 0 ||
      clusterId.length === 0 ||
      memoryGroupId.length === 0 ||
      question.length === 0
    )
  ) {
    throw new Error("Phase 74 product cases must be unique and non-empty.");
  }
}

function assertPreparedGroup(input: {
  arm: Phase74ProductArm;
  memoryGroupId: string;
  prepared: Phase74ProductPreparedGroup;
}): void {
  if (
    input.prepared.arm !== input.arm ||
    input.prepared.memoryGroupId !== input.memoryGroupId ||
    input.prepared.ingestionKey.length === 0
  ) {
    throw new Error("Phase 74 prepared product memory group drifted.");
  }
}

export async function runPhase74ProductComparison(input: {
  cases: readonly Phase74ProductCase[];
  prepare(value: {
    arm: Phase74ProductArm;
    cases: readonly Phase74ProductCase[];
    memoryGroupId: string;
  }): Promise<Phase74ProductPreparedGroup>;
  read(value: {
    arm: Phase74ProductArm;
    caseId: string;
    context: string;
    question: string;
    selectedEvidenceLedgerFormat: EvidenceLedgerFormat;
  }): Promise<{ answer: string; latencyMs: number }>;
  score(value: {
    answer: string;
    arm: Phase74ProductArm;
    caseId: string;
    testCase: Phase74ProductCase;
  }): Promise<{ correct: boolean; latencyMs: number; score: number }>;
  selectedEvidenceLedgerFormat: EvidenceLedgerFormat;
}): Promise<{
  rows: Phase74ProductComparisonRow[];
  selectedEvidenceLedgerFormat: EvidenceLedgerFormat;
}> {
  assertUniqueCases(input.cases);
  const grouped = new Map<string, Phase74ProductCase[]>();
  for (const testCase of input.cases) {
    grouped.set(testCase.memoryGroupId, [
      ...(grouped.get(testCase.memoryGroupId) ?? []),
      testCase,
    ]);
  }
  const prepared = new Map<string, Phase74ProductPreparedGroup>();

  await Promise.all(PHASE74_PRODUCT_ARMS.flatMap((arm) =>
    [...grouped].map(async ([memoryGroupId, cases]) => {
      const value = await input.prepare({ arm, cases, memoryGroupId });
      assertPreparedGroup({ arm, memoryGroupId, prepared: value });
      prepared.set(`${arm}/${memoryGroupId}`, value);
    })
  ));

  const rows: Phase74ProductComparisonRow[] = [];
  for (const testCase of input.cases) {
    for (const arm of PHASE74_PRODUCT_ARMS) {
      const group = prepared.get(`${arm}/${testCase.memoryGroupId}`)!;
      const query = await group.query(testCase);
      const reader = await input.read({
        arm,
        caseId: testCase.caseId,
        context: query.context,
        question: testCase.question,
        selectedEvidenceLedgerFormat: input.selectedEvidenceLedgerFormat,
      });
      const assessment = await input.score({
        answer: reader.answer,
        arm,
        caseId: testCase.caseId,
        testCase,
      });
      rows.push({
        answer: reader.answer,
        answerLatencyMs: reader.latencyMs,
        arm,
        caseId: testCase.caseId,
        clusterId: testCase.clusterId,
        contextTokens: query.contextTokens,
        correct: assessment.correct,
        ingestionKey: group.ingestionKey,
        judgeLatencyMs: assessment.latencyMs,
        memoryGroupId: testCase.memoryGroupId,
        productLatencyMs: query.queryPathLatencyMs + reader.latencyMs,
        queryPathLatencyMs: query.queryPathLatencyMs,
        recallLatencyMs: query.recallLatencyMs,
        score: assessment.score,
      });
    }
  }
  return {
    rows,
    selectedEvidenceLedgerFormat: input.selectedEvidenceLedgerFormat,
  };
}
