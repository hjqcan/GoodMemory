import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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
  describePhase74ProtectionCallBudget,
  isPhase74ProtectionPlanPromotionAdmissible,
  loadPhase74ProtectionPlan,
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

function descriptor(
  id: string,
  material: unknown = { id },
): Phase74ProtectionIdentityDescriptor {
  return {
    id,
    sha256: hashPhase74ProtectionValue(material),
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

const EVALUATOR_SOURCE = descriptor(
  "phase74-protection-evaluator-source-v1",
);
const PROTECTION_BLUEPRINT = descriptor(
  "phase74-protection-blueprint-v1",
  "exact protection blueprint bytes",
);
const LIVE_CALL_BUDGET = {
  embeddingSpendLimitUsd: 0.25,
  maxLanguageCalls: 1_000,
} as const;

function callBudgetFor(binding: SuiteBinding) {
  return binding.suite.id === PHASE74_MAB_PROTECTION_SUITE.id
    ? describePhase74ProtectionCallBudget("no-live-model-calls-v1")
    : describePhase74ProtectionCallBudget(LIVE_CALL_BUDGET);
}

function plannedRun(
  binding: SuiteBinding,
  replicate: Phase74ProtectionReplicate = 1,
  caseIds = caseIdsFor(binding.suite.id),
) {
  return {
    caseIds,
    controls: {
      callBudget: callBudgetFor(binding),
      caseConcurrency: 8,
      renderedContextTokens: 6_000,
    },
    identity: identity(binding.suite.id, caseIds),
    protectionBlueprint: PROTECTION_BLUEPRINT,
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

function planInput(
  runs = promotionRuns(),
  admissionClass: "diagnostic" | "promotion-admissible" =
    "promotion-admissible",
) {
  return {
    admissionClass,
    evaluatorSource: EVALUATOR_SOURCE,
    protectionBlueprint: PROTECTION_BLUEPRINT,
    runs,
  } as const;
}

describe("Phase 74 pre-execution protection plan", () => {
  it("builds and parses one deterministic canonical schema-v4 plan", () => {
    const input = planInput();
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
      protectionBlueprint: PROTECTION_BLUEPRINT,
      schemaVersion: 4,
    });
    expect(plan.runs[0]?.controls).toEqual({
      callBudget: expect.objectContaining({
        id: expect.any(String),
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
      caseConcurrency: 8,
      renderedContextTokens: 6_000,
    });
    expect(parsePhase74ProtectionPlan(
      JSON.parse(JSON.stringify(plan)),
    )).toEqual(plan);
    expect(JSON.stringify(rebuilt)).toBe(JSON.stringify(plan));
  });

  it("derives honest no-live and exact live call-budget descriptors", () => {
    expect(describePhase74ProtectionCallBudget(
      "no-live-model-calls-v1",
    )).toEqual({
      id: "no-live-model-calls-v1",
      sha256: hashPhase74ProtectionValue("no-live-model-calls-v1"),
    });
    expect(describePhase74ProtectionCallBudget(LIVE_CALL_BUDGET)).toEqual({
      id: "embedding-language-call-budget-v1",
      sha256: hashPhase74ProtectionValue(LIVE_CALL_BUDGET),
    });
    expect(() => describePhase74ProtectionCallBudget({
      embeddingSpendLimitUsd: 0,
      maxLanguageCalls: 1_000,
    })).toThrow(/call budget/i);
    expect(() => describePhase74ProtectionCallBudget({
      embeddingSpendLimitUsd: 0.25,
      maxLanguageCalls: 0,
    })).toThrow(/call budget/i);
  });

  it("loads and binds the exact plan bytes and absolute path", async () => {
    const directory = await mkdtemp(join(tmpdir(), "phase74-plan-"));
    const path = join(directory, "protection-plan.json");
    const plan = buildPhase74ProtectionPlan(
      planInput([plannedRun(PROMOTION_SUITES[0])], "diagnostic"),
    );
    const bytes = Buffer.from(` ${JSON.stringify(plan, null, 2)}\n`, "utf8");
    await writeFile(path, bytes);

    try {
      const loaded = await loadPhase74ProtectionPlan(path);
      expect(loaded).toEqual({
        path: resolve(path),
        plan,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("preserves case order in the planned population hash", () => {
    const binding = PROMOTION_SUITES[0];
    const ordered = caseIdsFor(binding.suite.id);
    const reversed = [...ordered].reverse();
    const first = buildPhase74ProtectionPlan(
      planInput([plannedRun(binding, 1, ordered)], "diagnostic"),
    );
    const second = buildPhase74ProtectionPlan(
      planInput([plannedRun(binding, 1, reversed)], "diagnostic"),
    );

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

    const plan = buildPhase74ProtectionPlan(planInput());
    expect(isPhase74ProtectionPlanPromotionAdmissible(plan)).toBe(true);

    const withoutBeam = promotionRuns().filter(
      ({ suite }) => suite.id !== PHASE74_BEAM_SAFETY_SUITE.id,
    );
    expect(() => buildPhase74ProtectionPlan(
      planInput(withoutBeam),
    )).toThrow(/exact five-suite|promotion/i);

    expect(() => buildPhase74ProtectionPlan(planInput([
      ...promotionRuns(),
      {
        ...plannedRun(PROMOTION_SUITES[0]),
        runId: "unexpected-suite:replicate-1",
        suite: {
          id: "unexpected-suite",
          kind: "safety" as const,
        },
      },
    ]))).toThrow(/unexpected-suite|promotion/i);

    const wrongBinding = promotionRuns();
    wrongBinding[0] = {
      ...wrongBinding[0]!,
      suite: { ...wrongBinding[0]!.suite, kind: "safety" },
    };
    expect(() => buildPhase74ProtectionPlan(
      planInput(wrongBinding),
    )).toThrow(/binding|promotion/i);

    const forgedVerifier = promotionRuns().map((run) =>
      run.suite.id === PROMOTION_SUITES[0].suite.id
        ? {
            ...run,
            verifier: descriptor(
              run.verifier.id,
              "different verifier implementation",
            ),
          }
        : run
    );
    expect(() => buildPhase74ProtectionPlan(
      planInput(forgedVerifier),
    )).toThrow(/verifier|binding|promotion/i);

    const inconsistentReplicate = promotionRuns();
    inconsistentReplicate[1] = {
      ...inconsistentReplicate[1]!,
      controls: {
        ...inconsistentReplicate[1]!.controls,
        renderedContextTokens:
          inconsistentReplicate[1]!.controls.renderedContextTokens + 1,
      },
    };
    expect(() => buildPhase74ProtectionPlan(
      planInput(inconsistentReplicate),
    )).toThrow(/replicate|promotion/i);

    const liveMab = promotionRuns();
    liveMab[0] = {
      ...liveMab[0]!,
      controls: {
        ...liveMab[0]!.controls,
        callBudget: describePhase74ProtectionCallBudget(LIVE_CALL_BUDGET),
      },
    };
    expect(() => buildPhase74ProtectionPlan(planInput(liveMab))).toThrow(
      /MemoryAgentBench|no-live-model-calls-v1|promotion/i,
    );

    const noLiveHaluMem = promotionRuns();
    noLiveHaluMem[3] = {
      ...noLiveHaluMem[3]!,
      controls: {
        ...noLiveHaluMem[3]!.controls,
        callBudget: describePhase74ProtectionCallBudget(
          "no-live-model-calls-v1",
        ),
      },
    };
    expect(() => buildPhase74ProtectionPlan(planInput(noLiveHaluMem))).toThrow(
      /live call budget|promotion/i,
    );
  });

  it("keeps diagnostic plans structurally incapable of authorizing promotion", () => {
    const plan = buildPhase74ProtectionPlan(
      planInput([plannedRun(PROMOTION_SUITES[0])], "diagnostic"),
    );

    expect(plan.admission.class).toBe("diagnostic");
    expect(isPhase74ProtectionPlanPromotionAdmissible(plan)).toBe(false);
    expect(isPhase74ProtectionPlanPromotionAdmissible(
      parsePhase74ProtectionPlan(JSON.parse(JSON.stringify(plan))),
    )).toBe(false);

    const tampered = {
      ...plan,
      admission: {
        ...plan.admission,
        class: "promotion-admissible",
      },
    };
    expect(() => parsePhase74ProtectionPlan(tampered)).toThrow(/promotion/i);
  });

  it("rejects top-level blueprint drift before execution", () => {
    const run = {
      ...plannedRun(PROMOTION_SUITES[0]),
      protectionBlueprint: descriptor(
        "different-blueprint",
        "different blueprint bytes",
      ),
    };
    expect(() => buildPhase74ProtectionPlan(
      planInput([run], "diagnostic"),
    )).toThrow(/blueprint.*drift/i);
  });

  it("returns an artifact binding and rejects every planned-run drift", async () => {
    const directory = await mkdtemp(join(tmpdir(), "phase74-plan-binding-"));
    const path = join(directory, "protection-plan.json");
    const expected = plannedRun(PROMOTION_SUITES[0]);
    const plan = buildPhase74ProtectionPlan(
      planInput([expected], "diagnostic"),
    );
    await writeFile(path, `${JSON.stringify(plan, null, 2)}\n`);

    try {
      const loaded = await loadPhase74ProtectionPlan(path);
      const binding = verifyPhase74ProtectionPlanRun(loaded, expected);
      expect(binding).toEqual({
        planPath: resolve(path),
        planSha256: loaded.sha256,
        plannedRunSha256: hashPhase74ProtectionValue(plan.runs[0]),
      });

      const drifts = [
        { ...expected, suite: { ...expected.suite, kind: "safety" as const } },
        { ...expected, replicate: 2 as const },
        { ...expected, runId: "drifted-run-id" },
        { ...expected, caseIds: [...expected.caseIds].reverse() },
        {
          ...expected,
          identity: {
            ...expected.identity,
            source: descriptor("drifted-source"),
          },
        },
        {
          ...expected,
          protectionBlueprint: descriptor(
            "drifted-blueprint",
            "different blueprint bytes",
          ),
        },
        {
          ...expected,
          controls: {
            ...expected.controls,
            caseConcurrency: expected.controls.caseConcurrency + 1,
          },
        },
        {
          ...expected,
          controls: {
            ...expected.controls,
            renderedContextTokens:
              expected.controls.renderedContextTokens + 1,
          },
        },
        {
          ...expected,
          controls: {
            ...expected.controls,
            callBudget: descriptor("drifted-call-budget"),
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
        expect(() => verifyPhase74ProtectionPlanRun(loaded, drift)).toThrow(
          /drift|planned|plan/i,
        );
      }
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
