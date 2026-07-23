import { describe, expect, it } from "bun:test";

import {
  PHASE74_BEAM_SAFETY_SUITE,
  PHASE74_BEAM_SAFETY_VERIFIER_ID,
} from "../../src/eval/phase74BeamSafetyProtection";
import {
  PHASE74_HALUMEM_E4_PROTECTION_VERIFIER_ID,
  PHASE74_HALUMEM_E4_SUITE,
  PHASE74_HALUMEM_PRIVACY_PROTECTION_VERIFIER_ID,
  PHASE74_HALUMEM_PRIVACY_SUITE,
  PHASE74_HALUMEM_UPDATE_PROTECTION_VERIFIER_ID,
  PHASE74_HALUMEM_UPDATE_SUITE,
} from "../../src/eval/phase74HaluMemProtectionVerifier";
import {
  PHASE74_MAB_PROTECTION_SUITE,
  PHASE74_MAB_PROTECTION_VERIFIER_ID,
} from "../../src/eval/phase74MemoryAgentBenchProtectionVerifier";
import {
  hashPhase74ProtectionCaseIds,
} from "../../src/eval/phase74ProtectionContracts";
import type {
  Phase74ProtectionIdentityDescriptor,
  Phase74ProtectionReplicate,
  Phase74ProtectionRunIdentity,
} from "../../src/eval/phase74ProtectionContracts";
import {
  buildPhase74ProtectionPlan,
  isPhase74ProtectionPlanPromotionAdmissible,
  parsePhase74ProtectionPlan,
  PHASE74_PROMOTION_PROTECTION_SUITE_IDS,
  verifyPhase74ProtectionPlanRun,
} from "../../src/eval/phase74ProtectionPlan";
import {
  hashPhase74ProtectionValue,
} from "../../src/eval/phase74ProtectionRun";
import type {
  Phase74ProtectionSuite,
} from "../../src/eval/phase74ProtectionRun";

interface SuiteBinding {
  suite: Phase74ProtectionSuite;
  verifierId: string;
}

const PROMOTION_SUITES = [
  {
    suite: PHASE74_MAB_PROTECTION_SUITE,
    verifierId: PHASE74_MAB_PROTECTION_VERIFIER_ID,
  },
  {
    suite: PHASE74_HALUMEM_E4_SUITE,
    verifierId: PHASE74_HALUMEM_E4_PROTECTION_VERIFIER_ID,
  },
  {
    suite: PHASE74_HALUMEM_UPDATE_SUITE,
    verifierId: PHASE74_HALUMEM_UPDATE_PROTECTION_VERIFIER_ID,
  },
  {
    suite: PHASE74_HALUMEM_PRIVACY_SUITE,
    verifierId: PHASE74_HALUMEM_PRIVACY_PROTECTION_VERIFIER_ID,
  },
  {
    suite: PHASE74_BEAM_SAFETY_SUITE,
    verifierId: PHASE74_BEAM_SAFETY_VERIFIER_ID,
  },
] as const satisfies readonly SuiteBinding[];

function descriptor(id: string): Phase74ProtectionIdentityDescriptor {
  return {
    id,
    sha256: hashPhase74ProtectionValue({ id }),
  };
}

function identity(
  suiteId: string,
  caseIds: readonly string[],
): Phase74ProtectionRunIdentity {
  return {
    dataset: descriptor(`${suiteId}:dataset`),
    judge: descriptor(`${suiteId}:judge`),
    model: descriptor(`${suiteId}:model`),
    pipeline: descriptor(`${suiteId}:pipeline`),
    population: {
      caseCount: caseIds.length,
      caseIdsSha256: hashPhase74ProtectionCaseIds(caseIds),
      id: `${suiteId}:population`,
    },
    prompt: descriptor(`${suiteId}:prompt`),
    source: descriptor("phase74-protection-evaluator-source-v1"),
  };
}

function caseIdsFor(suiteId: string): string[] {
  return [`${suiteId}:case-a`, `${suiteId}:case-b`];
}

function plannedRun(
  binding: SuiteBinding,
  replicate: Phase74ProtectionReplicate = 1,
  caseIds = caseIdsFor(binding.suite.id),
) {
  return {
    budget: {
      maxModelCallsPerCase: 4,
      renderedContextTokens: 6_000,
    },
    caseConcurrency: 8,
    caseIds,
    identity: identity(binding.suite.id, caseIds),
    replicate,
    runId: `${binding.suite.id}:replicate-${replicate}`,
    suite: binding.suite,
    verifier: descriptor(binding.verifierId),
  };
}

function promotionRuns() {
  return PROMOTION_SUITES.flatMap((binding) =>
    ([1, 2, 3] as const).map((replicate) =>
      plannedRun(binding, replicate)
    )
  );
}

const EVALUATOR_SOURCE = descriptor(
  "phase74-protection-evaluator-source-v1",
);

describe("Phase 74 pre-execution protection plan", () => {
  it("builds and parses one deterministic canonical schema-v3 plan", () => {
    const input = {
      admissionClass: "promotion-admissible" as const,
      evaluatorSource: EVALUATOR_SOURCE,
      runs: promotionRuns(),
    };

    const plan = buildPhase74ProtectionPlan(input);
    const rebuilt = buildPhase74ProtectionPlan({
      ...input,
      runs: [...input.runs].reverse(),
    });

    expect(plan).toEqual(rebuilt);
    expect(plan).toMatchObject({
      admission: {
        class: "promotion-admissible",
        protocol: "pre-execution-canonical-planner-v1",
      },
      artifactKind: "phase74-protection-plan",
      evaluatorSource: EVALUATOR_SOURCE,
      schemaVersion: 3,
    });
    expect(parsePhase74ProtectionPlan(
      JSON.parse(JSON.stringify(plan)),
    )).toEqual(plan);
    expect(JSON.stringify(rebuilt)).toBe(JSON.stringify(plan));
  });

  it("preserves case order in the planned population hash", () => {
    const binding = PROMOTION_SUITES[0];
    const ordered = caseIdsFor(binding.suite.id);
    const reversed = [...ordered].reverse();
    const first = buildPhase74ProtectionPlan({
      admissionClass: "diagnostic",
      evaluatorSource: EVALUATOR_SOURCE,
      runs: [plannedRun(binding, 1, ordered)],
    });
    const second = buildPhase74ProtectionPlan({
      admissionClass: "diagnostic",
      evaluatorSource: EVALUATOR_SOURCE,
      runs: [plannedRun(binding, 1, reversed)],
    });

    expect(first.runs[0]?.orderedCaseIdsSha256).not.toBe(
      second.runs[0]?.orderedCaseIdsSha256,
    );
    expect(first.runs[0]?.identity.population.caseIdsSha256).toBe(
      second.runs[0]?.identity.population.caseIdsSha256,
    );
  });

  it("admits promotion only for the exact five-suite, three-replicate matrix", () => {
    const expectedSuiteIds = PROMOTION_SUITES.map(({ suite }) => suite.id)
      .sort();
    expect([...PHASE74_PROMOTION_PROTECTION_SUITE_IDS].sort()).toEqual(
      expectedSuiteIds,
    );
    expect(PHASE74_PROMOTION_PROTECTION_SUITE_IDS).toHaveLength(5);

    const plan = buildPhase74ProtectionPlan({
      admissionClass: "promotion-admissible",
      evaluatorSource: EVALUATOR_SOURCE,
      runs: promotionRuns(),
    });
    expect(isPhase74ProtectionPlanPromotionAdmissible(plan)).toBe(true);

    const withoutBeam = promotionRuns().filter(
      ({ suite }) => suite.id !== PHASE74_BEAM_SAFETY_SUITE.id,
    );
    expect(() => buildPhase74ProtectionPlan({
      admissionClass: "promotion-admissible",
      evaluatorSource: EVALUATOR_SOURCE,
      runs: withoutBeam,
    })).toThrow(/exact five-suite|promotion/i);

    expect(() => buildPhase74ProtectionPlan({
      admissionClass: "promotion-admissible",
      evaluatorSource: EVALUATOR_SOURCE,
      runs: [
        ...promotionRuns(),
        {
          ...plannedRun(PROMOTION_SUITES[0]),
          runId: "unexpected-suite:replicate-1",
          suite: {
            id: "unexpected-suite",
            kind: "safety" as const,
          },
        },
      ],
    })).toThrow(/unexpected-suite|promotion/i);
  });

  it("keeps diagnostic plans structurally incapable of authorizing promotion", () => {
    const plan = buildPhase74ProtectionPlan({
      admissionClass: "diagnostic",
      evaluatorSource: EVALUATOR_SOURCE,
      runs: [plannedRun(PROMOTION_SUITES[0])],
    });

    expect(plan.admission.class).toBe("diagnostic");
    expect(isPhase74ProtectionPlanPromotionAdmissible(plan)).toBe(false);
    expect(isPhase74ProtectionPlanPromotionAdmissible(
      parsePhase74ProtectionPlan(JSON.parse(JSON.stringify(plan))),
    )).toBe(false);
  });

  it("rejects replicate, run ID, concurrency, budget, and identity drift", () => {
    const expected = plannedRun(PROMOTION_SUITES[0]);
    const plan = buildPhase74ProtectionPlan({
      admissionClass: "diagnostic",
      evaluatorSource: EVALUATOR_SOURCE,
      runs: [expected],
    });

    expect(() => verifyPhase74ProtectionPlanRun(plan, expected)).not.toThrow();

    const drifts = [
      { ...expected, replicate: 2 as const },
      { ...expected, runId: "drifted-run-id" },
      { ...expected, caseConcurrency: expected.caseConcurrency + 1 },
      {
        ...expected,
        budget: {
          ...expected.budget,
          renderedContextTokens:
            expected.budget.renderedContextTokens + 1,
        },
      },
      {
        ...expected,
        identity: {
          ...expected.identity,
          model: descriptor("drifted-model"),
        },
      },
    ];

    for (const drift of drifts) {
      expect(() => verifyPhase74ProtectionPlanRun(plan, drift)).toThrow(
        /drift|planned|plan/i,
      );
    }
  });
});
