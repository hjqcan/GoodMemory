import { createHash } from "node:crypto";

import { z } from "zod";

import { PHASE74_PROTECTION_BLUEPRINT_ID } from "./phase74ProtectionVerifier";

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const BENCHMARKS = ["locomo", "longmemeval"] as const;
const REPLICATES = [1, 2, 3] as const;
const STAGES = ["E1", "E2", "E3", "E4"] as const;

const sha256Schema = z.string().regex(SHA256_PATTERN);
const modelIdentitySchema = z.object({
  gateway: z.string().url(),
  model: z.string().min(1),
  provider: z.literal("openai"),
}).strict();
const answerModelSchema = modelIdentitySchema.extend({
  gateway: z.literal("https://ai.gurkiai.com/v1"),
  model: z.literal("gpt-5.6-terra"),
}).strict();
const judgeModelSchema = modelIdentitySchema.extend({
  gateway: z.literal("https://ai.gurkiai.com/v1"),
  model: z.literal("gpt-5.5"),
}).strict();
const embeddingSchema = modelIdentitySchema.extend({
  gateway: z.literal("https://openrouter.ai/api/v1"),
  model: z.enum(["text-embedding-3-small", "baai/bge-m3"]),
}).strict();
const rerankerSchema = answerModelSchema.extend({
  implementation: z.literal("provider-listwise-v1"),
  mode: z.literal("provider"),
}).strict();
const evaluatorSourceSchema = z.object({
  commit: z.string().regex(COMMIT_PATTERN),
  sha256: sha256Schema,
}).strict();
const protectionBlueprintSchema = z.object({
  id: z.literal(PHASE74_PROTECTION_BLUEPRINT_ID),
  sha256: sha256Schema,
}).strict();
const callBudgetSchema = z.object({
  embeddingSpendLimitUsd: z.number().positive().finite(),
  maxLanguageCalls: z.number().int().positive(),
}).strict();
const parentDatasetSchema = z.object({
  adaptedCasesSha256: sha256Schema,
  caseCount: z.number().int().positive(),
  datasetSha256: sha256Schema,
  memoryGroupCount: z.number().int().positive(),
  normalizedFingerprint: sha256Schema,
  selectedCaseIdsSha256: sha256Schema,
  sourceSha256: sha256Schema,
}).strict();
const populationCommitmentSchema = z.object({
  id: z.string().min(1),
  sha256: sha256Schema,
}).strict();
const populationSchema = z.object({
  authority: z.literal("presealed-full-population"),
  populationCommitment: populationCommitmentSchema,
  selectedCaseIdsSha256: sha256Schema,
  selectedCaseKeysSha256: sha256Schema,
  caseCount: z.number().int().positive(),
}).strict();
const populationInputSchema = populationSchema.omit({
  populationCommitment: true,
});
const familySchema = z.object({
  benchmark: z.enum(BENCHMARKS),
  parentDataset: parentDatasetSchema,
  population: populationSchema,
  seenCasesOnly: z.literal(true),
}).strict();
const familyInputSchema = familySchema.extend({
  population: populationInputSchema,
}).strict();
const executionPopulationSchema = z.object({
  authority: z.literal("presealed-full-population"),
  caseCount: z.number().int().positive(),
  mode: z.literal("all"),
  parentDatasetSha256: sha256Schema,
  populationCommitment: populationCommitmentSchema,
  selectedCaseIdsSha256: sha256Schema,
  selectedCaseKeysSha256: sha256Schema,
}).strict();
const plannedIdentitySchema = z.object({
  answerModel: answerModelSchema,
  benchmark: z.enum(BENCHMARKS),
  configuration: z.object({
    callBudget: callBudgetSchema,
    caseConcurrency: z.number().int().positive(),
    embedding: embeddingSchema,
    evaluatorSource: evaluatorSourceSchema,
    parentDataset: parentDatasetSchema,
    population: executionPopulationSchema,
    protectionBlueprint: protectionBlueprintSchema,
    renderedContextTokens: z.literal(6_000),
    reranker: rerankerSchema,
    seenCasesOnly: z.literal(true),
  }).strict(),
  judgeModel: judgeModelSchema,
}).strict();
const runSchema = z.object({
  benchmark: z.enum(BENCHMARKS),
  identity: plannedIdentitySchema,
  identitySha256: sha256Schema,
  replicate: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
  ]),
  runId: z.string().min(1),
  stage: z.enum(STAGES),
}).strict();
const planSchema = z.object({
  admission: z.object({
    class: z.literal("confirmatory-only"),
    protocol: z.literal("presealed-full-family-confirmatory-v1"),
  }).strict(),
  answerModel: answerModelSchema,
  artifactKind: z.literal("phase74-full-family-confirmatory-plan"),
  callBudget: callBudgetSchema,
  caseConcurrency: z.number().int().positive(),
  embedding: embeddingSchema,
  evaluatorSource: evaluatorSourceSchema,
  families: z.array(familySchema).length(2),
  judgeModel: judgeModelSchema,
  protectionBlueprint: protectionBlueprintSchema,
  renderedContextTokens: z.literal(6_000),
  reranker: rerankerSchema,
  runs: z.array(runSchema).length(24),
  schemaVersion: z.literal(2),
}).strict();

type ModelIdentity = z.infer<typeof modelIdentitySchema>;
type ParentDataset = z.infer<typeof parentDatasetSchema>;
type Family = z.infer<typeof familySchema>;
export type Phase74ConfirmatoryPlan = z.infer<typeof planSchema>;

export interface Phase74ConfirmatoryPlanInput {
  admissionClass: "confirmatory-only";
  answerModel: ModelIdentity;
  callBudget: {
    embeddingSpendLimitUsd: number;
    maxLanguageCalls: number;
  };
  caseConcurrency: number;
  embedding: ModelIdentity;
  evaluatorSource: {
    commit: string;
    sha256: string;
  };
  families: readonly {
    benchmark: (typeof BENCHMARKS)[number];
    population: {
      authority: "presealed-full-population";
      caseCount: number;
      selectedCaseIdsSha256: string;
      selectedCaseKeysSha256: string;
    };
    parentDataset: ParentDataset;
    seenCasesOnly: true;
  }[];
  judgeModel: ModelIdentity;
  protectionBlueprint: {
    id: string;
    sha256: string;
  };
  renderedContextTokens: number;
  reranker: ModelIdentity & {
    implementation: "provider-listwise-v1";
    mode: "provider";
  };
}

export interface Phase74ConfirmatoryObservedRunInput {
  answerModel: ModelIdentity;
  benchmark: (typeof BENCHMARKS)[number];
  callBudget: {
    embeddingSpendLimitUsd: number;
    maxLanguageCalls: number;
  };
  caseConcurrency: number;
  embedding: ModelIdentity;
  evaluatorSource: {
    commit: string;
    sha256: string;
  };
  judgeModel: ModelIdentity;
  parentDataset: ParentDataset;
  protectionBlueprint: {
    id: string;
    sha256: string;
  };
  renderedContextTokens: number;
  replicate: (typeof REPLICATES)[number];
  reranker: ModelIdentity & {
    implementation: "provider-listwise-v1";
    mode: "provider";
  };
  runId: string;
  population: {
    caseCount: number;
    mode: "all";
    selectedCaseIdsSha256: string;
    selectedCaseKeysSha256: string;
  };
  stage: (typeof STAGES)[number];
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
  return JSON.stringify(value);
}

function sha256(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function parseSchema<T>(
  schema: z.ZodType<T>,
  value: unknown,
  label: string,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Phase 74 presealed full-family confirmatory ${label} is invalid: ${
        parsed.error.issues[0]?.message ?? "invalid value"
      }.`,
    );
  }
  return parsed.data;
}

function canonicalFamilies(value: unknown): Family[] {
  const inputs = parseSchema(
    z.array(familyInputSchema).length(2),
    value,
    "families",
  );
  const families = inputs.map((family) => parseSchema(familySchema, {
    ...family,
    population: {
      ...family.population,
      populationCommitment: {
        id: `phase74-confirmatory-${family.benchmark}-population-v1`,
        sha256: sha256({
          benchmark: family.benchmark,
          population: family.population,
          parentDataset: family.parentDataset,
          seenCasesOnly: true,
        }),
      },
    },
  }, `${family.benchmark} family`)).sort(
    (left, right) => left.benchmark.localeCompare(right.benchmark),
  );
  if (
    families[0]?.benchmark !== "locomo" ||
    families[1]?.benchmark !== "longmemeval"
  ) {
    throw new Error(
      "Phase 74 presealed full-family confirmatory plan requires exactly the locomo and longmemeval families.",
    );
  }
  for (const family of families) {
    if (family.population.caseCount !== family.parentDataset.caseCount) {
      throw new Error(
        `Phase 74 confirmatory ${family.benchmark} population must cover its complete parent dataset.`,
      );
    }
    if (
      family.population.selectedCaseIdsSha256 !==
        family.parentDataset.selectedCaseIdsSha256
    ) {
      throw new Error(
        `Phase 74 confirmatory ${family.benchmark} must bind the complete parent population.`,
      );
    }
  }
  return families;
}

function buildPlan(input: Phase74ConfirmatoryPlanInput): Phase74ConfirmatoryPlan {
  if (input.admissionClass !== "confirmatory-only") {
    throw new Error(
      "Phase 74 full-family evaluation plan must be confirmatory-only.",
    );
  }
  const shared = {
    answerModel: parseSchema(answerModelSchema, input.answerModel, "answer model"),
    callBudget: parseSchema(callBudgetSchema, input.callBudget, "call budget"),
    caseConcurrency: parseSchema(
      z.number().int().positive(),
      input.caseConcurrency,
      "case concurrency",
    ),
    embedding: parseSchema(embeddingSchema, input.embedding, "embedding"),
    evaluatorSource: parseSchema(
      evaluatorSourceSchema,
      input.evaluatorSource,
      "evaluator source",
    ),
    judgeModel: parseSchema(judgeModelSchema, input.judgeModel, "judge model"),
    protectionBlueprint: parseSchema(
      protectionBlueprintSchema,
      input.protectionBlueprint,
      "protection blueprint",
    ),
    renderedContextTokens: parseSchema(
      z.literal(6_000),
      input.renderedContextTokens,
      "rendered context budget",
    ),
    reranker: parseSchema(rerankerSchema, input.reranker, "reranker"),
  };
  const families = canonicalFamilies(input.families);
  const runs = families.flatMap((family) =>
    REPLICATES.flatMap((replicate) =>
      STAGES.map((stage) => {
        const identity = {
          answerModel: shared.answerModel,
          benchmark: family.benchmark,
          configuration: {
            callBudget: shared.callBudget,
            caseConcurrency: shared.caseConcurrency,
            embedding: shared.embedding,
            evaluatorSource: shared.evaluatorSource,
            parentDataset: family.parentDataset,
            population: {
              authority: family.population.authority,
              caseCount: family.population.caseCount,
              mode: "all" as const,
              parentDatasetSha256: family.parentDataset.datasetSha256,
              populationCommitment:
                family.population.populationCommitment,
              selectedCaseIdsSha256:
                family.population.selectedCaseIdsSha256,
              selectedCaseKeysSha256:
                family.population.selectedCaseKeysSha256,
            },
            protectionBlueprint: shared.protectionBlueprint,
            renderedContextTokens: shared.renderedContextTokens,
            reranker: shared.reranker,
            seenCasesOnly: true as const,
          },
          judgeModel: shared.judgeModel,
        };
        return {
          benchmark: family.benchmark,
          identity,
          identitySha256: sha256(identity),
          replicate,
          runId: `phase74-confirmatory-${family.benchmark}-r${replicate}`,
          stage,
        };
      })
    )
  );
  return parseSchema(planSchema, {
    admission: {
      class: "confirmatory-only",
      protocol: "presealed-full-family-confirmatory-v1",
    },
    artifactKind: "phase74-full-family-confirmatory-plan",
    families,
    runs,
    schemaVersion: 2,
    ...shared,
  }, "plan");
}

export function buildPhase74ConfirmatoryPlan(
  input: Phase74ConfirmatoryPlanInput,
): Phase74ConfirmatoryPlan {
  return buildPlan(input);
}

export function parsePhase74ConfirmatoryPlan(
  value: unknown,
): Phase74ConfirmatoryPlan {
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Array.isArray((value as Record<string, unknown>).runs) &&
    (value as Record<string, unknown[]>).runs.length !== 24
  ) {
    throw new Error(
      "Phase 74 presealed full-family confirmatory plan exact matrix requires 24 runs.",
    );
  }
  const parsed = parseSchema(planSchema, value, "plan");
  const families = parsed.families.map((family) => {
    const {
      populationCommitment: _populationCommitment,
      ...population
    } = family.population;
    return { ...family, population };
  });
  const rebuilt = buildPlan({
    admissionClass: parsed.admission.class,
    answerModel: parsed.answerModel,
    callBudget: parsed.callBudget,
    caseConcurrency: parsed.caseConcurrency,
    embedding: parsed.embedding,
    evaluatorSource: parsed.evaluatorSource,
    families,
    judgeModel: parsed.judgeModel,
    protectionBlueprint: parsed.protectionBlueprint,
    renderedContextTokens: parsed.renderedContextTokens,
    reranker: parsed.reranker,
  });
  if (stableJson(parsed) !== stableJson(rebuilt)) {
    throw new Error(
      "Phase 74 presealed full-family confirmatory plan exact run matrix or planned identity drifted.",
    );
  }
  return parsed;
}

export function hashPhase74ConfirmatoryPlan(value: unknown): string {
  return sha256(parsePhase74ConfirmatoryPlan(value));
}

export function buildPhase74ConfirmatoryObservedRun(
  planValue: unknown,
  input: Phase74ConfirmatoryObservedRunInput,
): {
  identity: z.infer<typeof plannedIdentitySchema>;
  identitySha256: string;
  runId: string;
  stage: (typeof STAGES)[number];
} {
  const plan = parsePhase74ConfirmatoryPlan(planValue);
  const planned = plan.runs.find(
    (run) =>
      run.benchmark === input.benchmark &&
      run.replicate === input.replicate &&
      run.runId === input.runId &&
      run.stage === input.stage,
  );
  if (planned === undefined) {
    throw new Error("Phase 74 observed run does not match a planned run.");
  }
  const population = parseSchema(z.object({
    caseCount: z.number().int().positive(),
    mode: z.literal("all"),
    selectedCaseIdsSha256: sha256Schema,
    selectedCaseKeysSha256: sha256Schema,
  }).strict(), input.population, "observed full population");
  const plannedPopulation = planned.identity.configuration.population;
  if (
    population.caseCount !== plannedPopulation.caseCount ||
    population.selectedCaseIdsSha256 !==
      plannedPopulation.selectedCaseIdsSha256 ||
    population.selectedCaseKeysSha256 !==
      plannedPopulation.selectedCaseKeysSha256
  ) {
    throw new Error(
      "Phase 74 observed confirmatory population drifted from its plan.",
    );
  }
  const identity = parseSchema(plannedIdentitySchema, {
    answerModel: input.answerModel,
    benchmark: input.benchmark,
    configuration: {
      callBudget: input.callBudget,
      caseConcurrency: input.caseConcurrency,
      embedding: input.embedding,
      evaluatorSource: input.evaluatorSource,
      parentDataset: input.parentDataset,
      population: plannedPopulation,
      protectionBlueprint: input.protectionBlueprint,
      renderedContextTokens: input.renderedContextTokens,
      reranker: input.reranker,
      seenCasesOnly: true,
    },
    judgeModel: input.judgeModel,
  }, "observed runtime identity");
  const observed = {
    identity,
    identitySha256: sha256(identity),
    runId: input.runId,
    stage: input.stage,
  };
  verifyPhase74ConfirmatoryRun(plan, observed);
  return observed;
}

export function verifyPhase74ConfirmatoryRun(
  planValue: unknown,
  observedValue: unknown,
): {
  benchmark: (typeof BENCHMARKS)[number];
  confirmatoryOnly: true;
  replicate: (typeof REPLICATES)[number];
  runId: string;
  stage: (typeof STAGES)[number];
} {
  const plan = parsePhase74ConfirmatoryPlan(planValue);
  if (
    observedValue === null ||
    typeof observedValue !== "object" ||
    Array.isArray(observedValue)
  ) {
    throw new Error("Phase 74 observed confirmatory run is invalid.");
  }
  const allowed = new Set(["identity", "identitySha256", "runId", "stage"]);
  const unknownField = Object.keys(observedValue).find(
    (key) => !allowed.has(key),
  );
  if (unknownField !== undefined) {
    throw new Error(`Phase 74 observed run has unknown field ${unknownField}.`);
  }
  const observed = parseSchema(z.object({
    identity: z.unknown(),
    identitySha256: sha256Schema,
    runId: z.string().min(1),
    stage: z.enum(STAGES),
  }).strict(), observedValue, "observed run");
  if (sha256(observed.identity) !== observed.identitySha256) {
    throw new Error("Phase 74 observed run identity SHA-256 drifted.");
  }
  const planned = plan.runs.find(
    (run) => run.runId === observed.runId && run.stage === observed.stage,
  );
  if (planned === undefined) {
    throw new Error("Phase 74 observed run does not match a planned run.");
  }
  if (
    planned.identitySha256 !== observed.identitySha256 ||
    stableJson(planned.identity) !== stableJson(observed.identity)
  ) {
    throw new Error("Phase 74 observed run identity drifted from its plan.");
  }
  return {
    benchmark: planned.benchmark,
    confirmatoryOnly: true,
    replicate: planned.replicate,
    runId: planned.runId,
    stage: planned.stage,
  };
}
