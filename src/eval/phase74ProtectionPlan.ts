import {
  PHASE74_BEAM_SAFETY_SUITE,
  PHASE74_BEAM_SAFETY_VERIFIER_ID,
} from "./phase74BeamSafetyProtection";
import {
  PHASE74_HALUMEM_E4_PROTECTION_VERIFIER_ID,
  PHASE74_HALUMEM_E4_SUITE,
  PHASE74_HALUMEM_PRIVACY_PROTECTION_VERIFIER_ID,
  PHASE74_HALUMEM_PRIVACY_SUITE,
  PHASE74_HALUMEM_UPDATE_PROTECTION_VERIFIER_ID,
  PHASE74_HALUMEM_UPDATE_SUITE,
} from "./phase74HaluMemProtectionVerifier";
import {
  PHASE74_MAB_PROTECTION_SUITE,
  PHASE74_MAB_PROTECTION_VERIFIER_ID,
} from "./phase74MemoryAgentBenchProtectionVerifier";
import {
  hashPhase74ProtectionCaseIds,
  parsePhase74ProtectionRunIdentity,
} from "./phase74ProtectionContracts";
import type {
  Phase74ProtectionIdentityDescriptor,
  Phase74ProtectionReplicate,
  Phase74ProtectionRunIdentity,
} from "./phase74ProtectionContracts";
import {
  hashPhase74ProtectionValue,
} from "./phase74ProtectionRun";
import type {
  Phase74ProtectionSuite,
  Phase74ProtectionSuiteKind,
} from "./phase74ProtectionRun";

export const PHASE74_PROMOTION_PROTECTION_SUITE_IDS = [
  PHASE74_MAB_PROTECTION_SUITE.id,
  PHASE74_HALUMEM_E4_SUITE.id,
  PHASE74_HALUMEM_UPDATE_SUITE.id,
  PHASE74_HALUMEM_PRIVACY_SUITE.id,
  PHASE74_BEAM_SAFETY_SUITE.id,
] as const;

const PROMOTION_BINDINGS = new Map([
  [PHASE74_MAB_PROTECTION_SUITE.id, {
    kind: PHASE74_MAB_PROTECTION_SUITE.kind,
    verifierId: PHASE74_MAB_PROTECTION_VERIFIER_ID,
  }],
  [PHASE74_HALUMEM_E4_SUITE.id, {
    kind: PHASE74_HALUMEM_E4_SUITE.kind,
    verifierId: PHASE74_HALUMEM_E4_PROTECTION_VERIFIER_ID,
  }],
  [PHASE74_HALUMEM_UPDATE_SUITE.id, {
    kind: PHASE74_HALUMEM_UPDATE_SUITE.kind,
    verifierId: PHASE74_HALUMEM_UPDATE_PROTECTION_VERIFIER_ID,
  }],
  [PHASE74_HALUMEM_PRIVACY_SUITE.id, {
    kind: PHASE74_HALUMEM_PRIVACY_SUITE.kind,
    verifierId: PHASE74_HALUMEM_PRIVACY_PROTECTION_VERIFIER_ID,
  }],
  [PHASE74_BEAM_SAFETY_SUITE.id, {
    kind: PHASE74_BEAM_SAFETY_SUITE.kind,
    verifierId: PHASE74_BEAM_SAFETY_VERIFIER_ID,
  }],
] as const);

const PLAN_PROTOCOL = "pre-execution-canonical-planner-v1" as const;
const PLAN_CLASSES = [
  "diagnostic",
  "promotion-admissible",
] as const;
const SUITE_KINDS = [
  "benchmark-protection",
  "e4",
  "safety",
] as const satisfies readonly Phase74ProtectionSuiteKind[];

export type Phase74ProtectionPlanAdmissionClass =
  (typeof PLAN_CLASSES)[number];

export interface Phase74ProtectionPlanBudget {
  maxModelCallsPerCase: number;
  renderedContextTokens: number;
}

export interface Phase74ProtectionPlanRunInput {
  budget: Phase74ProtectionPlanBudget;
  caseConcurrency: number;
  caseIds: readonly string[];
  identity: Phase74ProtectionRunIdentity;
  replicate: Phase74ProtectionReplicate;
  runId: string;
  suite: Phase74ProtectionSuite;
  verifier: Phase74ProtectionIdentityDescriptor;
}

export interface Phase74ProtectionPlannedRun {
  budget: Phase74ProtectionPlanBudget;
  caseConcurrency: number;
  identity: Phase74ProtectionRunIdentity;
  orderedCaseIdsSha256: string;
  replicate: Phase74ProtectionReplicate;
  runId: string;
  suite: Phase74ProtectionSuite;
  verifier: Phase74ProtectionIdentityDescriptor;
}

export interface Phase74ProtectionPlan {
  admission: {
    class: Phase74ProtectionPlanAdmissionClass;
    protocol: typeof PLAN_PROTOCOL;
  };
  artifactKind: "phase74-protection-plan";
  evaluatorSource: Phase74ProtectionIdentityDescriptor;
  runs: Phase74ProtectionPlannedRun[];
  schemaVersion: 3;
}

export interface Phase74ProtectionPlanInput {
  admissionClass: Phase74ProtectionPlanAdmissionClass;
  evaluatorSource: Phase74ProtectionIdentityDescriptor;
  runs: readonly Phase74ProtectionPlanRunInput[];
}

function recordValue(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Phase 74 ${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  if (
    Object.keys(value).sort().join("\0") !== [...expected].sort().join("\0")
  ) {
    throw new Error(
      `Phase 74 ${label} must contain exactly: ${[...expected].sort().join(", ")}.`,
    );
  }
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || value === "" || value.trim() !== value) {
    throw new Error(`Phase 74 ${label} must be a non-empty trimmed string.`);
  }
  return value;
}

function sha256Value(value: unknown, label: string): string {
  const result = stringValue(value, label);
  if (!/^[a-f0-9]{64}$/u.test(result)) {
    throw new Error(`Phase 74 ${label} must be a lowercase SHA-256.`);
  }
  return result;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new Error(`Phase 74 ${label} must be a positive integer.`);
  }
  return Number(value);
}

function descriptor(
  value: unknown,
  label: string,
): Phase74ProtectionIdentityDescriptor {
  const record = recordValue(value, label);
  assertExactKeys(record, ["id", "sha256"], label);
  return {
    id: stringValue(record.id, `${label}.id`),
    sha256: sha256Value(record.sha256, `${label}.sha256`),
  };
}

function budget(
  value: unknown,
  label: string,
): Phase74ProtectionPlanBudget {
  const record = recordValue(value, label);
  assertExactKeys(
    record,
    ["maxModelCallsPerCase", "renderedContextTokens"],
    label,
  );
  return {
    maxModelCallsPerCase: positiveInteger(
      record.maxModelCallsPerCase,
      `${label}.maxModelCallsPerCase`,
    ),
    renderedContextTokens: positiveInteger(
      record.renderedContextTokens,
      `${label}.renderedContextTokens`,
    ),
  };
}

function suite(value: unknown, label: string): Phase74ProtectionSuite {
  const record = recordValue(value, label);
  assertExactKeys(record, ["id", "kind"], label);
  if (!SUITE_KINDS.includes(record.kind as Phase74ProtectionSuiteKind)) {
    throw new Error(`Phase 74 ${label}.kind is invalid.`);
  }
  return {
    id: stringValue(record.id, `${label}.id`),
    kind: record.kind as Phase74ProtectionSuiteKind,
  };
}

function replicateValue(
  value: unknown,
  label: string,
): Phase74ProtectionReplicate {
  if (value !== 1 && value !== 2 && value !== 3) {
    throw new Error(`Phase 74 ${label} must be 1, 2, or 3.`);
  }
  return value;
}

function parsePlannedRun(
  value: unknown,
  label: string,
): Phase74ProtectionPlannedRun {
  const record = recordValue(value, label);
  assertExactKeys(record, [
    "budget",
    "caseConcurrency",
    "identity",
    "orderedCaseIdsSha256",
    "replicate",
    "runId",
    "suite",
    "verifier",
  ], label);
  return {
    budget: budget(record.budget, `${label}.budget`),
    caseConcurrency: positiveInteger(
      record.caseConcurrency,
      `${label}.caseConcurrency`,
    ),
    identity: parsePhase74ProtectionRunIdentity(
      record.identity,
      `${label}.identity`,
    ),
    orderedCaseIdsSha256: sha256Value(
      record.orderedCaseIdsSha256,
      `${label}.orderedCaseIdsSha256`,
    ),
    replicate: replicateValue(record.replicate, `${label}.replicate`),
    runId: stringValue(record.runId, `${label}.runId`),
    suite: suite(record.suite, `${label}.suite`),
    verifier: descriptor(record.verifier, `${label}.verifier`),
  };
}

function validateCaseIds(caseIds: readonly string[]): string[] {
  if (caseIds.length === 0) {
    throw new Error("Phase 74 protection plan run requires at least one case.");
  }
  const validated = caseIds.map((caseId, index) =>
    stringValue(caseId, `protection plan run caseIds[${index}]`)
  );
  if (new Set(validated).size !== validated.length) {
    throw new Error("Phase 74 protection plan run contains duplicate case IDs.");
  }
  return validated;
}

function plannedRun(
  input: Phase74ProtectionPlanRunInput,
): Phase74ProtectionPlannedRun {
  const caseIds = validateCaseIds(input.caseIds);
  const identity = parsePhase74ProtectionRunIdentity(
    input.identity,
    "protection plan run identity",
  );
  if (
    identity.population.caseCount !== caseIds.length ||
    identity.population.caseIdsSha256 !==
      hashPhase74ProtectionCaseIds(caseIds)
  ) {
    throw new Error(
      "Phase 74 protection plan run population identity drifted.",
    );
  }
  return parsePlannedRun({
    budget: input.budget,
    caseConcurrency: input.caseConcurrency,
    identity,
    orderedCaseIdsSha256: hashPhase74ProtectionValue(caseIds),
    replicate: input.replicate,
    runId: input.runId,
    suite: input.suite,
    verifier: input.verifier,
  }, "protection plan run");
}

function compareRuns(
  left: Phase74ProtectionPlannedRun,
  right: Phase74ProtectionPlannedRun,
): number {
  return left.suite.id.localeCompare(right.suite.id) ||
    left.replicate - right.replicate ||
    left.runId.localeCompare(right.runId);
}

function assertUniqueRuns(runs: readonly Phase74ProtectionPlannedRun[]): void {
  if (runs.length === 0) {
    throw new Error("Phase 74 protection plan requires at least one run.");
  }
  const suiteReplicates = runs.map(({ replicate, suite }) =>
    `${suite.id}\0${replicate}`
  );
  if (new Set(suiteReplicates).size !== suiteReplicates.length) {
    throw new Error(
      "Phase 74 protection plan contains a duplicate suite replicate.",
    );
  }
  const runIds = runs.map(({ runId }) => runId);
  if (new Set(runIds).size !== runIds.length) {
    throw new Error("Phase 74 protection plan contains a duplicate run ID.");
  }
}

function assertPromotionMatrix(
  runs: readonly Phase74ProtectionPlannedRun[],
): void {
  const expectedSuiteIds = [...PHASE74_PROMOTION_PROTECTION_SUITE_IDS].sort();
  const actualSuiteIds = [...new Set(runs.map(({ suite }) => suite.id))].sort();
  const hasExactSuites =
    actualSuiteIds.join("\0") === expectedSuiteIds.join("\0");
  const hasExactReplicates = expectedSuiteIds.every((suiteId) => {
    const replicates = runs
      .filter(({ suite }) => suite.id === suiteId)
      .map(({ replicate }) => replicate)
      .sort();
    return replicates.join("\0") === [1, 2, 3].join("\0");
  });
  if (!hasExactSuites || !hasExactReplicates || runs.length !== 15) {
    throw new Error(
      "Phase 74 promotion requires the exact five-suite, three-replicate matrix.",
    );
  }
  for (const suiteId of expectedSuiteIds) {
    const suiteRuns = runs.filter(({ suite }) => suite.id === suiteId);
    const binding = PROMOTION_BINDINGS.get(suiteId)!;
    if (suiteRuns.some(({ suite, verifier }) =>
      suite.kind !== binding.kind || verifier.id !== binding.verifierId
    )) {
      throw new Error(
        `Phase 74 promotion suite ${suiteId} canonical binding drifted.`,
      );
    }
    const replicateIdentity = ({ replicate: _replicate, runId: _runId, ...run }:
      Phase74ProtectionPlannedRun) => run;
    const expectedIdentity = hashPhase74ProtectionValue(
      replicateIdentity(suiteRuns[0]!),
    );
    if (suiteRuns.some((run) =>
      hashPhase74ProtectionValue(replicateIdentity(run)) !== expectedIdentity
    )) {
      throw new Error(
        `Phase 74 promotion suite ${suiteId} replicate configuration drifted.`,
      );
    }
  }
}

function assertPlanConsistency(plan: Phase74ProtectionPlan): void {
  assertUniqueRuns(plan.runs);
  for (const run of plan.runs) {
    if (
      hashPhase74ProtectionValue(run.identity.source) !==
        hashPhase74ProtectionValue(plan.evaluatorSource)
    ) {
      throw new Error(
        "Phase 74 protection plan evaluator source identity drifted.",
      );
    }
  }
  if (plan.admission.class === "promotion-admissible") {
    assertPromotionMatrix(plan.runs);
  }
}

export function parsePhase74ProtectionPlan(
  value: unknown,
): Phase74ProtectionPlan {
  const record = recordValue(value, "protection plan");
  assertExactKeys(record, [
    "admission",
    "artifactKind",
    "evaluatorSource",
    "runs",
    "schemaVersion",
  ], "protection plan");
  if (
    record.artifactKind !== "phase74-protection-plan" ||
    record.schemaVersion !== 3
  ) {
    throw new Error(
      "Phase 74 protection plan kind or schemaVersion is invalid.",
    );
  }
  const admission = recordValue(record.admission, "protection plan admission");
  assertExactKeys(
    admission,
    ["class", "protocol"],
    "protection plan admission",
  );
  if (
    !PLAN_CLASSES.includes(
      admission.class as Phase74ProtectionPlanAdmissionClass,
    ) ||
    admission.protocol !== PLAN_PROTOCOL
  ) {
    throw new Error("Phase 74 protection plan admission is invalid.");
  }
  if (!Array.isArray(record.runs)) {
    throw new Error("Phase 74 protection plan runs must be an array.");
  }
  const plan: Phase74ProtectionPlan = {
    admission: {
      class: admission.class as Phase74ProtectionPlanAdmissionClass,
      protocol: PLAN_PROTOCOL,
    },
    artifactKind: "phase74-protection-plan",
    evaluatorSource: descriptor(
      record.evaluatorSource,
      "protection plan evaluatorSource",
    ),
    runs: record.runs.map((run, index) =>
      parsePlannedRun(run, `protection plan runs[${index}]`)
    ).sort(compareRuns),
    schemaVersion: 3,
  };
  assertPlanConsistency(plan);
  return plan;
}

export function buildPhase74ProtectionPlan(
  input: Phase74ProtectionPlanInput,
): Phase74ProtectionPlan {
  return parsePhase74ProtectionPlan({
    admission: {
      class: input.admissionClass,
      protocol: PLAN_PROTOCOL,
    },
    artifactKind: "phase74-protection-plan",
    evaluatorSource: input.evaluatorSource,
    runs: input.runs.map(plannedRun),
    schemaVersion: 3,
  });
}

export function isPhase74ProtectionPlanPromotionAdmissible(
  plan: Phase74ProtectionPlan,
): boolean {
  return parsePhase74ProtectionPlan(plan).admission.class ===
    "promotion-admissible";
}

export function verifyPhase74ProtectionPlanRun(
  plan: Phase74ProtectionPlan,
  input: Phase74ProtectionPlanRunInput,
): void {
  const trustedPlan = parsePhase74ProtectionPlan(plan);
  const actual = plannedRun(input);
  const suiteRuns = trustedPlan.runs.filter(
    ({ suite }) => suite.id === actual.suite.id,
  );
  const expected = suiteRuns.find(
    ({ replicate }) => replicate === actual.replicate,
  ) ?? (suiteRuns.length === 1 ? suiteRuns[0] : undefined);
  if (
    expected === undefined ||
    hashPhase74ProtectionValue(actual) !==
      hashPhase74ProtectionValue(expected)
  ) {
    throw new Error(
      "Phase 74 protection run drifted from its pre-execution plan.",
    );
  }
}
