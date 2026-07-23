import { createHash } from "node:crypto";

import { describe, expect, it } from "bun:test";

import {
  buildPhase74ConfirmatoryObservedRun,
  buildPhase74ConfirmatoryPlan,
  parsePhase74ConfirmatoryPlan,
  verifyPhase74ConfirmatoryRun,
} from "../../src/eval/phase74ConfirmatoryPlan";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);
const SHA_D = "d".repeat(64);
const SHA_E = "e".repeat(64);
const SHA_F = "f".repeat(64);
const SHA_1 = "1".repeat(64);
const SHA_2 = "2".repeat(64);
const SHA_3 = "3".repeat(64);
const SHA_4 = "4".repeat(64);
const SHA_5 = "5".repeat(64);

const ANSWER_MODEL = {
  gateway: "https://ai.gurkiai.com/v1",
  model: "gpt-5.6-terra",
  provider: "openai",
} as const;
const JUDGE_MODEL = {
  gateway: "https://ai.gurkiai.com/v1",
  model: "gpt-5.5",
  provider: "openai",
} as const;
const EMBEDDING = {
  gateway: "https://openrouter.ai/api/v1",
  model: "baai/bge-m3",
  provider: "openai",
} as const;
const RERANKER = {
  gateway: "https://ai.gurkiai.com/v1",
  implementation: "provider-listwise-v1",
  mode: "provider",
  model: "gpt-5.6-terra",
  provider: "openai",
} as const;
const EVALUATOR_SOURCE = {
  commit: "7".repeat(40),
  sha256: SHA_A,
} as const;
const PROTECTION_BLUEPRINT = {
  id: "phase74-protection-suite-manifest-v2",
  sha256: SHA_B,
} as const;

const FAMILIES = [
  {
    benchmark: "locomo",
    population: {
      authority: "presealed-full-population",
      caseCount: 1_986,
      selectedCaseIdsSha256: SHA_4,
      selectedCaseKeysSha256: SHA_E,
    },
    parentDataset: {
      adaptedCasesSha256: SHA_1,
      caseCount: 1_986,
      datasetSha256: SHA_2,
      memoryGroupCount: 10,
      normalizedFingerprint: SHA_3,
      selectedCaseIdsSha256: SHA_4,
      sourceSha256: SHA_5,
    },
    seenCasesOnly: true,
  },
  {
    benchmark: "longmemeval",
    population: {
      authority: "presealed-full-population",
      caseCount: 500,
      selectedCaseIdsSha256: SHA_E,
      selectedCaseKeysSha256: SHA_A,
    },
    parentDataset: {
      adaptedCasesSha256: SHA_B,
      caseCount: 500,
      datasetSha256: SHA_C,
      memoryGroupCount: 500,
      normalizedFingerprint: SHA_D,
      selectedCaseIdsSha256: SHA_E,
      sourceSha256: SHA_F,
    },
    seenCasesOnly: true,
  },
] as const;

function confirmatoryPlanInput() {
  return {
    admissionClass: "confirmatory-only",
    answerModel: ANSWER_MODEL,
    callBudget: {
      embeddingSpendLimitUsd: 8,
      maxLanguageCalls: 100_000,
    },
    caseConcurrency: 40,
    embedding: EMBEDDING,
    evaluatorSource: EVALUATOR_SOURCE,
    families: FAMILIES,
    judgeModel: JUDGE_MODEL,
    protectionBlueprint: PROTECTION_BLUEPRINT,
    renderedContextTokens: 6_000,
    reranker: RERANKER,
  } as const;
}

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
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error("test value is not JSON");
  }
  return serialized;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function mutableRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function mutableArray(value: unknown): unknown[] {
  return value as unknown[];
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function replaceAtPath(
  value: unknown,
  path: readonly string[],
  replacement: unknown,
): unknown {
  const result = clone(value);
  let cursor = mutableRecord(result);
  for (const key of path.slice(0, -1)) {
    cursor = mutableRecord(cursor[key]);
  }
  cursor[path.at(-1)!] = replacement;
  return result;
}

describe("Phase 74 pre-sealed full-family confirmatory plan", () => {
  it("builds exactly two families by three replicates by E1-E4", () => {
    const plan = buildPhase74ConfirmatoryPlan(confirmatoryPlanInput());
    const rebuilt = buildPhase74ConfirmatoryPlan({
      ...confirmatoryPlanInput(),
      families: [...FAMILIES].reverse(),
    });
    const expectedMatrix = FAMILIES.flatMap(({ benchmark }) =>
      ([1, 2, 3] as const).flatMap((replicate) =>
        (["E1", "E2", "E3", "E4"] as const).map((stage) =>
          `${benchmark}:${replicate}:${stage}`
        )
      )
    ).sort();

    expect(plan).toEqual(rebuilt);
    expect(plan).toMatchObject({
      admission: {
        class: "confirmatory-only",
        protocol: "presealed-full-family-confirmatory-v1",
      },
      artifactKind: "phase74-full-family-confirmatory-plan",
      schemaVersion: 2,
    });
    expect(plan.runs).toHaveLength(24);
    expect(plan.runs.map((run) =>
      `${run.benchmark}:${run.replicate}:${run.stage}`
    ).sort()).toEqual(expectedMatrix);
    expect([...new Set(plan.runs.map(({ runId }) => runId))].sort()).toEqual([
      "phase74-confirmatory-locomo-r1",
      "phase74-confirmatory-locomo-r2",
      "phase74-confirmatory-locomo-r3",
      "phase74-confirmatory-longmemeval-r1",
      "phase74-confirmatory-longmemeval-r2",
      "phase74-confirmatory-longmemeval-r3",
    ]);
    expect(parsePhase74ConfirmatoryPlan(
      JSON.parse(JSON.stringify(plan)),
    )).toEqual(plan);

    const incomplete = clone(plan);
    mutableArray(incomplete.runs).pop();
    expect(() => parsePhase74ConfirmatoryPlan(incomplete)).toThrow(
      /exact.*matrix|24.*run/i,
    );

    const duplicate = clone(plan);
    mutableArray(duplicate.runs).push(clone(duplicate.runs[0]));
    expect(() => parsePhase74ConfirmatoryPlan(duplicate)).toThrow(
      /exact.*matrix|24.*run|duplicate/i,
    );
  });

  it("binds each full execution population to its parent and commitment", () => {
    const plan = buildPhase74ConfirmatoryPlan(confirmatoryPlanInput());

    for (const family of FAMILIES) {
      const plannedFamily = plan.families.find(
        ({ benchmark }) => benchmark === family.benchmark,
      );
      expect(plannedFamily).toMatchObject(family);
      expect(plannedFamily?.population.populationCommitment).toEqual({
        id: `phase74-confirmatory-${family.benchmark}-population-v1`,
        sha256: sha256({
          benchmark: family.benchmark,
          population: family.population,
          parentDataset: family.parentDataset,
          seenCasesOnly: true,
        }),
      });

      const runs = plan.runs.filter(
        ({ benchmark }) => benchmark === family.benchmark,
      );
      expect(runs).toHaveLength(12);
      for (const run of runs) {
        expect(run.identity).toMatchObject({
          answerModel: ANSWER_MODEL,
          benchmark: family.benchmark,
          configuration: {
            callBudget: confirmatoryPlanInput().callBudget,
            caseConcurrency: 40,
            embedding: EMBEDDING,
            evaluatorSource: EVALUATOR_SOURCE,
            parentDataset: family.parentDataset,
            protectionBlueprint: PROTECTION_BLUEPRINT,
            renderedContextTokens: 6_000,
            reranker: RERANKER,
            population: {
              authority: "presealed-full-population",
              caseCount: family.population.caseCount,
              mode: "all",
              parentDatasetSha256: family.parentDataset.datasetSha256,
              populationCommitment:
                plannedFamily?.population.populationCommitment,
              selectedCaseIdsSha256:
                family.population.selectedCaseIdsSha256,
              selectedCaseKeysSha256:
                family.population.selectedCaseKeysSha256,
            },
            seenCasesOnly: true,
          },
          judgeModel: JUDGE_MODEL,
        });
        expect(run.identitySha256).toBe(sha256(run.identity));
      }
    }
    expect(JSON.stringify(plan)).not.toMatch(
      /heldout|holdout|preRegistration|promotion/i,
    );
  });

  it("rejects diagnostic, injected, post-hoc, unseen-case, and subset authority", () => {
    const plan = buildPhase74ConfirmatoryPlan(confirmatoryPlanInput());
    const cases = [
      {
        label: "diagnostic",
        path: ["admission", "class"],
        value: "diagnostic",
      },
      {
        label: "legacy artifact",
        path: ["artifactKind"],
        value: "phase74-confirmatory-plan",
      },
      {
        label: "injected",
        path: ["families", "0", "population", "authority"],
        value: "injected",
      },
      {
        label: "post-hoc",
        path: ["families", "0", "population", "authority"],
        value: "post-hoc-subset",
      },
      {
        label: "unseen-case",
        path: ["families", "0", "seenCasesOnly"],
        value: false,
      },
      {
        label: "subset",
        path: ["runs", "0", "identity", "configuration", "population", "mode"],
        value: "subset",
      },
    ] as const;

    for (const testCase of cases) {
      const mutated = replaceAtPath(plan, testCase.path, testCase.value);
      expect(
        () => parsePhase74ConfirmatoryPlan(mutated),
        testCase.label,
      ).toThrow(/confirmatory|pre.?seal|population|seen|matrix/i);
    }

    expect(() => buildPhase74ConfirmatoryPlan({
      ...confirmatoryPlanInput(),
      families: FAMILIES.map((family) =>
        family.benchmark === "locomo"
          ? {
              ...family,
              population: { ...family.population, caseCount: 300 },
            }
          : family
      ),
    })).toThrow(/complete parent dataset/i);
    expect(() => buildPhase74ConfirmatoryPlan({
      ...confirmatoryPlanInput(),
      families: FAMILIES.map((family) =>
        family.benchmark === "locomo"
          ? {
              ...family,
              population: {
                ...family.population,
                selectedCaseIdsSha256: SHA_D,
              },
            }
          : family
      ),
    })).toThrow(/complete parent population/i);
  });

  it("verifies every observed frozen binding, not merely the run id", () => {
    const plan = buildPhase74ConfirmatoryPlan(confirmatoryPlanInput());
    const run = plan.runs[0]!;
    const observed = {
      identity: run.identity,
      identitySha256: run.identitySha256,
      runId: run.runId,
      stage: run.stage,
    };

    expect(verifyPhase74ConfirmatoryRun(plan, observed)).toMatchObject({
      benchmark: run.benchmark,
      confirmatoryOnly: true,
      replicate: run.replicate,
      runId: run.runId,
      stage: run.stage,
    });

    const drifts = [
      ["answerModel", "model"],
      ["judgeModel", "model"],
      ["configuration", "callBudget", "maxLanguageCalls"],
      ["configuration", "caseConcurrency"],
      ["configuration", "embedding", "model"],
      ["configuration", "evaluatorSource", "sha256"],
      ["configuration", "parentDataset", "adaptedCasesSha256"],
      ["configuration", "parentDataset", "datasetSha256"],
      ["configuration", "protectionBlueprint", "sha256"],
      ["configuration", "reranker", "model"],
      ["configuration", "population", "populationCommitment", "sha256"],
      ["configuration", "population", "selectedCaseIdsSha256"],
      ["configuration", "population", "selectedCaseKeysSha256"],
    ] as const;

    for (const path of drifts) {
      const identity = replaceAtPath(
        run.identity,
        path,
        "9".repeat(64),
      );
      expect(
        () => verifyPhase74ConfirmatoryRun(plan, {
          identity,
          identitySha256: sha256(identity),
          runId: run.runId,
          stage: run.stage,
        }),
        path.join("."),
      ).toThrow(/drift|identity|planned|match/i);
    }

    expect(() => verifyPhase74ConfirmatoryRun(plan, {
      ...observed,
      identitySha256: "0".repeat(64),
    })).toThrow(/hash|sha-?256|identity/i);
  });

  it("projects the actual runtime profile before verifying the planned run", () => {
    const plan = buildPhase74ConfirmatoryPlan(confirmatoryPlanInput());
    const run = plan.runs.find(
      ({ benchmark, replicate, stage }) =>
        benchmark === "locomo" && replicate === 2 && stage === "E3",
    )!;
    const configuration = run.identity.configuration;
    const observed = buildPhase74ConfirmatoryObservedRun(plan, {
      answerModel: run.identity.answerModel,
      benchmark: run.benchmark,
      callBudget: configuration.callBudget,
      caseConcurrency: configuration.caseConcurrency,
      embedding: configuration.embedding,
      evaluatorSource: configuration.evaluatorSource,
      judgeModel: run.identity.judgeModel,
      parentDataset: configuration.parentDataset,
      protectionBlueprint: configuration.protectionBlueprint,
      renderedContextTokens: configuration.renderedContextTokens,
      replicate: run.replicate,
      reranker: configuration.reranker,
      runId: run.runId,
      population: {
        caseCount: configuration.population.caseCount,
        mode: "all",
        selectedCaseIdsSha256:
          configuration.population.selectedCaseIdsSha256,
        selectedCaseKeysSha256:
          configuration.population.selectedCaseKeysSha256,
      },
      stage: run.stage,
    });

    expect(verifyPhase74ConfirmatoryRun(plan, observed)).toMatchObject({
      benchmark: "locomo",
      replicate: 2,
      stage: "E3",
    });
    expect(() => buildPhase74ConfirmatoryObservedRun(plan, {
      ...observed.identity,
      benchmark: run.benchmark,
      callBudget: configuration.callBudget,
      caseConcurrency: configuration.caseConcurrency,
      embedding: {
        ...configuration.embedding,
        model: "text-embedding-3-small",
      },
      evaluatorSource: configuration.evaluatorSource,
      parentDataset: configuration.parentDataset,
      protectionBlueprint: configuration.protectionBlueprint,
      renderedContextTokens: configuration.renderedContextTokens,
      replicate: run.replicate,
      reranker: configuration.reranker,
      runId: run.runId,
      population: {
        caseCount: configuration.population.caseCount,
        mode: "all",
        selectedCaseIdsSha256:
          configuration.population.selectedCaseIdsSha256,
        selectedCaseKeysSha256:
          configuration.population.selectedCaseKeysSha256,
      },
      stage: run.stage,
    })).toThrow(/identity.*drift|plan/i);
  });

  it("keeps question and gold material outside the observed-run verifier DTO", () => {
    const plan = buildPhase74ConfirmatoryPlan(confirmatoryPlanInput());
    const run = plan.runs[0]!;
    const observed = {
      identity: run.identity,
      identitySha256: run.identitySha256,
      runId: run.runId,
      stage: run.stage,
    };
    const forbidden = [
      ["question", "What is the expected answer?"],
      ["expectedAnswer", "gold"],
      ["goldEvidenceIds", ["gold-1"]],
      ["protocolMetadata", { questionType: "single-session-user" }],
    ] as const;

    for (const [field, value] of forbidden) {
      expect(() => verifyPhase74ConfirmatoryRun(plan, {
        ...observed,
        [field]: value,
      })).toThrow(`unknown field ${field}`);
    }
  });
});
