import { createHash } from "node:crypto";

import { describe, expect, it } from "bun:test";

import {
  buildPhase74ConfirmatoryPlan,
} from "../../src/eval/phase74ConfirmatoryPlan";
import type {
  Phase74ConfirmatoryPlanInput,
} from "../../src/eval/phase74ConfirmatoryPlan";
import type {
  Phase74DatasetBundle,
  Phase74DatasetCase,
} from "../../src/eval/phase74Datasets";
import type { EvalRunJsonObject } from "../../src/eval/runIdentity";
import {
  buildPhase74LabelFreeCaseBoundary,
} from "../../src/eval/phase74Generalization";
import {
  buildPhase74FullRunIdentityConfiguration,
  resolvePhase74ConfirmatoryAdmission,
  selectPhase74GeneralizationCases,
} from "../../scripts/run-phase-74-generalization";

const DIAGNOSTIC_SEED = 74_101;
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);
const SHA_D = "d".repeat(64);
const SHA_E = "e".repeat(64);
const SHA_F = "f".repeat(64);
const GIT_ANCHOR = {
  commit: "8".repeat(40),
  executionCommit: "9".repeat(40),
  path: "reports/quality-gates/phase-74/confirmatory-plan.json",
  remote: "origin" as const,
  remoteRef: "refs/heads/main" as const,
  remoteUrl: "https://github.com/hjqcan/GoodMemory.git" as const,
};

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(record[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: unknown): string {
  return createHash("sha256").update(
    typeof value === "string" ? value : stableJson(value),
  ).digest("hex");
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function syntheticCases(): Phase74DatasetCase[] {
  return Array.from({ length: 4 }, (_, index) => ({
    caseId: `locomo-case-${index + 1}`,
    expectedAnswer: `gold-${index + 1}`,
    family: "locomo",
    goldEvidenceIds: [`dia-${index + 1}`],
    locale: "en",
    memoryGroupId: index < 2 ? "conversation-a" : "conversation-b",
    protocolMetadata: { category: index + 1 },
    question: `What fact number ${index + 1} was remembered?`,
    rawEvidence: [{
      content: `Synthetic fact number ${index + 1}.`,
      id: `dia-${index + 1}`,
      role: "user",
      sourceIds: [`conversation-${index + 1}`],
    }],
    referenceTime: "2026-07-23T00:00:00.000Z",
    unresolvedGoldEvidenceIds: [],
  }));
}

function syntheticBundle(): Phase74DatasetBundle {
  const cases = syntheticCases();
  return {
    cases,
    manifest: {
      adaptedCasesSha256: SHA_A,
      benchmark: "locomo",
      caseCount: cases.length,
      datasetSha256: SHA_B,
      normalizedFingerprint: SHA_C,
      schemaVersion: 2,
      selectedCaseIdsSha256: sha256(cases.map(({ caseId }) => caseId)),
      source: {
        commit: "synthetic-commit",
        license: "test-only",
        repository: "https://example.test/locomo",
        sourceSha256: SHA_D,
        sourceUrl: "https://example.test/locomo/cases.json",
      },
      unresolvedGoldEvidence: [],
      unresolvedGoldEvidenceCount: 0,
    },
  };
}

function fullPopulation(input: {
  cases: readonly Phase74DatasetCase[];
}): {
  cases: Phase74DatasetCase[];
  selectedCaseIdsSha256: string;
  selectedCaseKeysSha256: string;
} {
  const selected = input.cases.map((testCase) => ({
    key: buildPhase74LabelFreeCaseBoundary(testCase).caseKey,
    testCase,
  }));
  return {
    cases: selected.map(({ testCase }) => testCase),
    selectedCaseIdsSha256: sha256(
      selected.map(({ testCase }) => testCase.caseId),
    ),
    selectedCaseKeysSha256: sha256(
      selected.map(({ key }) => key).sort(),
    ),
  };
}

function parentDataset(bundle: Phase74DatasetBundle) {
  return {
    adaptedCasesSha256: bundle.manifest.adaptedCasesSha256,
    caseCount: bundle.manifest.caseCount,
    datasetSha256: bundle.manifest.datasetSha256,
    memoryGroupCount: new Set(bundle.cases.map(
      ({ caseId, memoryGroupId }) => memoryGroupId ?? caseId,
    )).size,
    normalizedFingerprint: bundle.manifest.normalizedFingerprint,
    selectedCaseIdsSha256: bundle.manifest.selectedCaseIdsSha256,
    sourceSha256: bundle.manifest.source.sourceSha256,
  };
}

function planInput(
  bundle: Phase74DatasetBundle,
  populationOverride: Partial<{
    selectedCaseIdsSha256: string;
    selectedCaseKeysSha256: string;
  }> = {},
): Phase74ConfirmatoryPlanInput {
  const population = fullPopulation({
    cases: bundle.cases,
  });
  return {
    admissionClass: "confirmatory-only",
    answerModel: {
      gateway: "https://ai.gurkiai.com/v1",
      model: "gpt-5.6-terra",
      provider: "openai",
    },
    callBudget: {
      embeddingSpendLimitUsd: 8,
      maxLanguageCalls: 100_000,
    },
    caseConcurrency: 40,
    embedding: {
      gateway: "https://openrouter.ai/api/v1",
      model: "baai/bge-m3",
      provider: "openai",
    },
    evaluatorSource: {
      commit: "7".repeat(40),
      sha256: SHA_E,
    },
    families: [
      {
        benchmark: "locomo",
        population: {
          authority: "presealed-full-population",
          caseCount: bundle.manifest.caseCount,
          selectedCaseIdsSha256:
            populationOverride.selectedCaseIdsSha256 ??
            population.selectedCaseIdsSha256,
          selectedCaseKeysSha256:
            populationOverride.selectedCaseKeysSha256 ??
            population.selectedCaseKeysSha256,
        },
        parentDataset: parentDataset(bundle),
        seenCasesOnly: true,
      },
      {
        benchmark: "longmemeval",
        population: {
          authority: "presealed-full-population",
          caseCount: 4,
          selectedCaseIdsSha256: SHA_F,
          selectedCaseKeysSha256: SHA_B,
        },
        parentDataset: {
          adaptedCasesSha256: SHA_C,
          caseCount: 4,
          datasetSha256: SHA_D,
          memoryGroupCount: 4,
          normalizedFingerprint: SHA_E,
          selectedCaseIdsSha256: SHA_F,
          sourceSha256: SHA_A,
        },
        seenCasesOnly: true,
      },
    ],
    judgeModel: {
      gateway: "https://ai.gurkiai.com/v1",
      model: "gpt-5.5",
      provider: "openai",
    },
    protectionBlueprint: {
      id: "phase74-protection-suite-manifest-v2",
      sha256: SHA_F,
    },
    renderedContextTokens: 6_000,
    reranker: {
      gateway: "https://ai.gurkiai.com/v1",
      implementation: "provider-listwise-v1",
      mode: "provider",
      model: "gpt-5.6-terra",
      provider: "openai",
    },
  };
}

function admissionInput(
  bundle = syntheticBundle(),
  plan = buildPhase74ConfirmatoryPlan(planInput(bundle)),
) {
  return {
    benchmark: "locomo" as const,
    dataset: bundle,
    gitAnchor: GIT_ANCHOR,
    plan,
    planSha256: sha256(plan),
    replicate: 2 as const,
    runId: "phase74-confirmatory-locomo-r2",
    stage: "E3" as const,
  };
}

describe("Phase 74 full-family confirmatory admission", () => {
  it("admits only the presealed complete population as seen-case evidence", () => {
    const input = admissionInput();
    const expected = fullPopulation({
      cases: input.dataset.cases,
    });

    const admitted = resolvePhase74ConfirmatoryAdmission(input);

    expect(admitted.dataset.cases.map(({ caseId }) => caseId)).toEqual(
      expected.cases.map(({ caseId }) => caseId),
    );
    expect(admitted.dataset.manifest).toMatchObject({
      benchmark: "locomo",
      caseCount: 4,
      datasetSha256: input.dataset.manifest.datasetSha256,
      normalizedFingerprint: input.dataset.manifest.normalizedFingerprint,
      selectedCaseIdsSha256: expected.selectedCaseIdsSha256,
      source: {
        sourceSha256: input.dataset.manifest.source.sourceSha256,
      },
    });
    expect(admitted.selection).toMatchObject({
      mode: "all",
      populationSize: 4,
      selectedCaseIdsSha256: expected.selectedCaseIdsSha256,
      selectedCaseKeysSha256: expected.selectedCaseKeysSha256,
      selectedSize: 4,
    });
    expect(admitted.seenCasesOnly).toBeTrue();
    expect(admitted.confirmatoryPlan).toEqual({
      artifactKind: "phase74-full-family-confirmatory-plan",
      gitAnchor: GIT_ANCHOR,
      sha256: input.planSha256,
    });
    expect(admitted.plannedRun).toEqual(
      input.plan.runs.find((run) =>
        run.benchmark === input.benchmark &&
        run.replicate === input.replicate &&
        run.runId === input.runId &&
        run.stage === input.stage
      )!,
    );
  });

  it("builds a seen-case identity only from the verified admission", () => {
    const input = admissionInput();
    const admitted = resolvePhase74ConfirmatoryAdmission(input);
    const family = input.plan.families.find(
      ({ benchmark }) => benchmark === input.benchmark,
    )!;
    const configuration = buildPhase74FullRunIdentityConfiguration({
      callBudget: input.plan.callBudget,
      dataset: admitted.dataset.manifest as unknown as EvalRunJsonObject,
      embedding: input.plan.embedding,
      evaluatorSource: input.plan.evaluatorSource,
      confirmatoryAdmission: {
        confirmatoryPlan: admitted.confirmatoryPlan,
        parentDataset: family.parentDataset,
      },
      protectionBlueprint: input.plan.protectionBlueprint,
      replicate: input.replicate,
      reranker: input.plan.reranker,
      scoring: { scorer: "test-only" },
      selection: admitted.selection,
      selectedCaseIdsSha256:
        admitted.dataset.manifest.selectedCaseIdsSha256,
    });

    expect(configuration).toMatchObject({
      confirmatoryPlan: admitted.confirmatoryPlan,
      parentDataset: family.parentDataset,
      selection: { mode: "all" },
      seenCasesOnly: true,
    });
  });

  for (const drift of [
    {
      label: "adapted cases",
      mutate(bundle: Phase74DatasetBundle) {
        bundle.manifest.adaptedCasesSha256 = SHA_F;
      },
    },
    {
      label: "dataset",
      mutate(bundle: Phase74DatasetBundle) {
        bundle.manifest.datasetSha256 = SHA_F;
      },
    },
    {
      label: "normalized",
      mutate(bundle: Phase74DatasetBundle) {
        bundle.manifest.normalizedFingerprint = SHA_F;
      },
    },
    {
      label: "full case ids",
      mutate(bundle: Phase74DatasetBundle) {
        bundle.manifest.selectedCaseIdsSha256 = SHA_F;
      },
    },
    {
      label: "source",
      mutate(bundle: Phase74DatasetBundle) {
        bundle.manifest.source.sourceSha256 = SHA_F;
      },
    },
    {
      label: "case count",
      mutate(bundle: Phase74DatasetBundle) {
        bundle.manifest.caseCount += 1;
      },
    },
    {
      label: "memory group count",
      mutate(bundle: Phase74DatasetBundle) {
        bundle.cases[2]!.memoryGroupId = "conversation-a";
        bundle.cases[3]!.memoryGroupId = "conversation-a";
      },
    },
  ]) {
    it(`rejects ${drift.label} parent-dataset drift`, () => {
      const input = admissionInput();
      const dataset = clone(input.dataset);
      drift.mutate(dataset);
      expect(() => resolvePhase74ConfirmatoryAdmission({
        ...input,
        dataset,
      })).toThrow(/parent dataset|drift|mismatch/i);
    });
  }

  it("rejects plan SHA, selected ID, selected key, and run-matrix drift", () => {
    const input = admissionInput();
    expect(() => resolvePhase74ConfirmatoryAdmission({
      ...input,
      planSha256: SHA_F,
    })).toThrow(/plan.*sha|sha.*plan|drift/i);

    expect(() => buildPhase74ConfirmatoryPlan(planInput(
      input.dataset,
      { selectedCaseIdsSha256: SHA_F },
    ))).toThrow(/complete parent population|selected.*id|drift/i);

    const wrongKeysPlan = buildPhase74ConfirmatoryPlan(planInput(
      input.dataset,
      { selectedCaseKeysSha256: SHA_F },
    ));
    expect(() => resolvePhase74ConfirmatoryAdmission({
      ...input,
      plan: wrongKeysPlan,
      planSha256: sha256(wrongKeysPlan),
    })).toThrow(/selected.*key|population|drift|mismatch/i);

    const driftedMatrix = clone(input.plan);
    driftedMatrix.runs[0]!.runId = "phase74-confirmatory-locomo-drifted";
    expect(() => resolvePhase74ConfirmatoryAdmission({
      ...input,
      plan: driftedMatrix,
      planSha256: sha256(driftedMatrix),
    })).toThrow(/matrix|planned|plan|drift/i);

    expect(() => resolvePhase74ConfirmatoryAdmission({
      ...input,
      runId: "diagnostic-locomo-r2",
    })).toThrow(/planned run|run.*plan|matrix|drift/i);
  });

  it("keeps diagnostic subset selection outside confirmatory admission", () => {
    const diagnostic = selectPhase74GeneralizationCases({
      cases: syntheticCases(),
      seed: DIAGNOSTIC_SEED,
      size: 2,
    });

    expect(diagnostic.identity).toMatchObject({
      mode: "deterministic-content-hash-v2",
      populationSize: 4,
      seed: DIAGNOSTIC_SEED,
      selectedSize: 2,
    });
    expect(diagnostic.identity).not.toHaveProperty("confirmatoryPlan");
    expect(diagnostic.identity).not.toHaveProperty("seenCasesOnly", false);
  });
});
