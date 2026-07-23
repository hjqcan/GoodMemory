import type { EvidenceLedgerFormat } from "./evidenceLedgerFormats";
import { buildPhase74StageConfigurations } from "./phase74Generalization";
import {
  buildPhase74ModelUsageEvidence,
  type Phase74IngestionUsageLedger,
  type Phase74ModelUsageLedger,
} from "./modelUsage";
import type { Phase74ModelUsageEvidence } from "./phase74PromotionGate";
import type { EvalRunJsonObject } from "./runIdentity";

export interface Phase74ProductIngestionUsageLedger
  extends Phase74IngestionUsageLedger {
  memoryGroupId: string;
}

function assertUniqueNonEmpty(
  values: readonly string[],
  label: string,
): void {
  if (
    values.length === 0 ||
    values.some((value) => value.length === 0) ||
    new Set(values).size !== values.length
  ) {
    throw new Error(`Phase 74 product ${label} must be unique and non-empty.`);
  }
}

function assertIngestionGroups(input: {
  entries: readonly Phase74ProductIngestionUsageLedger[];
  expectedMemoryGroupIds: readonly string[];
  label: "baseline" | "candidate";
}): void {
  const actual = input.entries.map(({ memoryGroupId }) => memoryGroupId).sort();
  const expected = [...input.expectedMemoryGroupIds].sort();
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    throw new Error(
      `Phase 74 product ${input.label} ingestion must cover every memory-group exactly once.`,
    );
  }
}

function assertCompleteUsage(evidence: Phase74ModelUsageEvidence): void {
  for (const [label, branch] of [
    ["baseline", evidence.baseline],
    ["candidate", evidence.candidate],
  ] as const) {
    if (
      branch.missingRequestCount !== 0 ||
      branch.partialRequestCount !== 0 ||
      branch.pendingRequestCount !== 0 ||
      branch.unobservedCaseIds.length !== 0 ||
      branch.answerGenerationCaseCount !== branch.logicalCaseCount
    ) {
      throw new Error(`Phase 74 product ${label} model usage is incomplete.`);
    }
  }
}

export function buildPhase74ProductModelUsageEvidence(input: {
  baselineIngestion: readonly Phase74ProductIngestionUsageLedger[];
  candidateIngestion: readonly Phase74ProductIngestionUsageLedger[];
  caseIds: readonly string[];
  direct: Phase74ModelUsageLedger;
  memoryGroupIds: readonly string[];
}): Phase74ModelUsageEvidence {
  assertUniqueNonEmpty(input.caseIds, "case IDs");
  assertUniqueNonEmpty(input.memoryGroupIds, "memory-group IDs");
  assertIngestionGroups({
    entries: input.baselineIngestion,
    expectedMemoryGroupIds: input.memoryGroupIds,
    label: "baseline",
  });
  assertIngestionGroups({
    entries: input.candidateIngestion,
    expectedMemoryGroupIds: input.memoryGroupIds,
    label: "candidate",
  });
  const evidence = buildPhase74ModelUsageEvidence({
    direct: input.direct,
    expected: {
      baselineCaseIds: input.caseIds,
      candidateCaseIds: input.caseIds,
    },
    ingestion: {
      baselineExclusive: input.baselineIngestion,
      candidateExclusive: input.candidateIngestion,
      shared: [],
    },
  });
  assertCompleteUsage(evidence);
  return evidence;
}

export function buildPhase74ProductCandidateConfiguration(input: {
  base: EvalRunJsonObject;
  selectedEvidenceLedgerFormat: EvidenceLedgerFormat;
}): EvalRunJsonObject {
  const configurations = buildPhase74StageConfigurations(input.base, "E4");
  const configuration = configurations[input.selectedEvidenceLedgerFormat];
  if (configuration === undefined) {
    throw new Error(
      `Phase 74 product evidence-ledger format ${input.selectedEvidenceLedgerFormat} is invalid.`,
    );
  }
  return configuration;
}
