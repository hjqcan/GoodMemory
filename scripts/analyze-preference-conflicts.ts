import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { z } from "zod";

import { createDeterministicMemoryExtractor } from "../src";
import { behaviorScenarios } from "../tests/scenarios/behavior-fixtures";
import { resolveCliFlagValueStrict } from "./cli-options";
import { resolveRepoRootFromScriptUrl } from "./script-paths";

const SYNTHETIC_COHORT_PATH =
  "fixtures/research/preference-conflict-v1/synthetic-cohort.json";
const CENSUS_PREREGISTRATION_PATH =
  "fixtures/research/preference-conflict-v1/census-preregistration.json";
const AGGREGATE_REPORT_DIRECTORY =
  "reports/eval/research/preference-identity/fixture-census";
export const PREFERENCE_CONFLICT_AGGREGATE_REPORT_PATH =
  `${AGGREGATE_REPORT_DIRECTORY}/current/report.json`;
const execFileAsync = promisify(execFile);

const preferenceRecordSchema = z.object({
  context: z.string().min(1),
  id: z.string().min(1),
  legacyCategory: z.string().min(1),
  slot: z.string().min(1).nullable(),
  value: z.string().min(1),
});

const relationSchema = z.enum([
  "compound_partial_update",
  "contextual_coexistence",
  "explicit_update",
  "legacy_unkeyed",
  "same_category_different_dimension",
  "synonymous_repeat",
]);

const syntheticCohortSchema = z.object({
  cases: z.array(z.object({
    caseId: z.string().min(1),
    expected: z.object({
      active: z.array(z.enum(["incoming", "prior", "prior_companion"])),
      retainLineage: z.boolean(),
      warning: z.boolean(),
    }),
    incoming: preferenceRecordSchema,
    prior: preferenceRecordSchema,
    priorCompanion: preferenceRecordSchema.optional(),
    relation: relationSchema,
  })).length(30),
  incidenceUse: z.literal("excluded"),
  note: z.string().min(1),
  protocolId: z.literal("preference-conflict-policy-synthetic-v1"),
  schemaVersion: z.literal(1),
});

const censusPreregistrationSchema = z.object({
  corpus: z.object({
    behaviorScenarios: z.object({
      expectedScenarioCount: z.literal(6),
      expectedUserTurnCount: z.literal(16),
      module: z.literal("tests/scenarios/behavior-fixtures.ts"),
    }),
    evalScenarios: z.object({
      expectedFileCount: z.literal(46),
      expectedUserTurnCount: z.literal(335),
      glob: z.literal("fixtures/scenarios/eval/*.json"),
    }),
    exclusions: z.array(z.string().min(1)).min(1),
  }),
  decisionRules: z.object({
    adjudicationApiTrigger: z.string().min(1),
    minimumNaturalSameSlotChanges: z.literal(20),
    underpowered: z.string().min(1),
    unavailableIdentityMetrics: z.string().min(1),
  }),
  detector: z.object({
    identitySlotsAvailable: z.literal(false),
    mode: z.literal("current-rules-only"),
    note: z.string().min(1),
  }),
  metrics: z.array(z.string().min(1)).min(1),
  outputEvidence: z.object({
    aggregateReportPath: z.literal(PREFERENCE_CONFLICT_AGGREGATE_REPORT_PATH),
    gitProvenanceRequired: z.literal(true),
    rawCorpusTrackable: z.literal(false),
  }),
  productionIncidenceClaimed: z.literal(false),
  protocolId: z.literal("preference-conflict-fixture-census-v1"),
  schemaVersion: z.literal(1),
  syntheticCohort: z.literal(SYNTHETIC_COHORT_PATH),
}).passthrough();

export type PreferenceConflictSyntheticCohort = z.infer<
  typeof syntheticCohortSchema
>;
export type PreferenceConflictCensusPreregistration = z.infer<
  typeof censusPreregistrationSchema
>;
type PreferenceConflictRelation = z.infer<typeof relationSchema>;
type ActiveLabel = "incoming" | "prior" | "prior_companion";

export interface PreferenceFixtureCensus {
  corpus: {
    behaviorScenarioCount: number;
    behaviorUserTurnCount: number;
    fingerprint: string;
    scenarioFileCount: number;
    userTurnCount: number;
  };
  decision: {
    adjudicationApiAllowed: false;
    minimumNaturalSameSlotChanges: 20;
    observedLegacyCategoryValueChanges: number;
    reason: string;
    status: "underpowered_no_adjudication";
  };
  generatedAt: string;
  identityMetrics: {
    ambiguousConflictCount: null;
    ambiguousConflictRate: null;
    recencyAppropriateCount: null;
    recencyAppropriateRate: null;
    sameSlotChangeCount: null;
    unavailableReason: string;
  };
  preregistrationSha256: string;
  productionIncidenceClaimed: false;
  rulesOnly: {
    behaviorPreferenceCandidateCount: number;
    preferenceBearingScopeCount: number;
    preferenceCandidateCount: number;
    legacyCategoryValueChangeCount: number;
  };
  scope: "repository_fixture_census_only";
}

interface SimulatedPolicyResult {
  acceptanceCount: number;
  amnesiaCount: number;
  caseCount: number;
  expectedActiveInstructionAccuracy: number;
  expectedActiveInstructionExactMatchCount: number;
  falseConflictOrFreezeCount: number;
  falseConflictOrFreezeRate: number;
  generalFallbackAvailabilityRate: number;
  generalFallbackAvailableCount: number;
  lineageRecoverabilityRate: number;
  lineageRecoverableCount: number;
  silentDataLossCount: number;
  silentDataLossRate: number;
  unrecoverableWithExistingReviseOrForgetCount: number;
  unrecoverableWithExistingReviseOrForgetRate: number;
}

export interface PreferenceConflictPolicyReport {
  cohortCounts: Record<PreferenceConflictRelation, number>;
  cohortFingerprint: string;
  policies: {
    current_destructive: SimulatedPolicyResult;
    freeze: SimulatedPolicyResult;
    recency_lineage: SimulatedPolicyResult;
  };
  productionIncidenceClaimed: false;
  syntheticOnly: true;
}

export interface PreferenceConflictAnalysisReport {
  census: PreferenceFixtureCensus;
  generatedAt: string;
  git: {
    commit: string;
    dirty: boolean;
  };
  note: string;
  synthetic: PreferenceConflictPolicyReport;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeValue(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, " ");
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

async function resolveGitProvenance(repoRoot: string): Promise<{
  commit: string;
  dirty: boolean;
}> {
  const [{ stdout: commit }, { stdout: status }] = await Promise.all([
    execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoRoot }),
    execFileAsync("git", ["status", "--porcelain"], { cwd: repoRoot }),
  ]);
  return {
    commit: commit.trim(),
    dirty: status.trim().length > 0,
  };
}

export async function loadPreferenceConflictSyntheticCohort(
  repoRoot: string,
): Promise<PreferenceConflictSyntheticCohort> {
  return syntheticCohortSchema.parse(
    JSON.parse(
      await readFile(join(repoRoot, SYNTHETIC_COHORT_PATH), "utf8"),
    ),
  );
}

export async function loadPreferenceConflictCensusPreregistration(
  repoRoot: string,
): Promise<PreferenceConflictCensusPreregistration> {
  return censusPreregistrationSchema.parse(
    JSON.parse(
      await readFile(join(repoRoot, CENSUS_PREREGISTRATION_PATH), "utf8"),
    ),
  );
}

async function countPreferenceCandidates(input: {
  scopeId: string;
  turns: ReadonlyArray<{ content: string; role: string }>;
}): Promise<{
  candidateCount: number;
  categoryChanges: number;
  preferenceBearing: boolean;
}> {
  const extractor = createDeterministicMemoryExtractor();
  const latestByCategory = new Map<string, string>();
  let candidateCount = 0;
  let categoryChanges = 0;
  for (const turn of input.turns) {
    if (turn.role !== "user") {
      continue;
    }
    const extraction = await extractor.extract({
      extractionStrategy: "rules-only",
      messages: [{ content: turn.content, role: "user" }],
      scope: { userId: input.scopeId },
    });
    for (const candidate of extraction.candidates) {
      if (candidate.kindHint !== "preference") {
        continue;
      }
      candidateCount += 1;
      const category = candidate.metadata?.preferenceCategory ??
        "general_preference";
      const value = normalizeValue(
        candidate.metadata?.preferenceValue ?? candidate.content,
      );
      const previous = latestByCategory.get(category);
      if (previous !== undefined && previous !== value) {
        categoryChanges += 1;
      }
      latestByCategory.set(category, value);
    }
  }
  return {
    candidateCount,
    categoryChanges,
    preferenceBearing: candidateCount > 0,
  };
}

export async function runPreferenceFixtureCensus(
  repoRoot: string,
): Promise<PreferenceFixtureCensus> {
  const preregistrationRaw = await readFile(
    join(repoRoot, CENSUS_PREREGISTRATION_PATH),
    "utf8",
  );
  const preregistration = censusPreregistrationSchema.parse(
    JSON.parse(preregistrationRaw),
  );
  const scenarioDir = join(repoRoot, "fixtures/scenarios/eval");
  const scenarioFiles = (await readdir(scenarioDir))
    .filter((file) => file.endsWith(".json"))
    .sort();
  let userTurnCount = 0;
  let preferenceCandidateCount = 0;
  let legacyCategoryValueChangeCount = 0;
  let preferenceBearingScopeCount = 0;
  const fingerprintParts: string[] = [];

  for (const file of scenarioFiles) {
    const raw = await readFile(join(scenarioDir, file), "utf8");
    const scenario = JSON.parse(raw) as {
      scenario_id: string;
      sessions: Array<{
        turns: Array<{ content: string; role: string }>;
      }>;
    };
    const turns = scenario.sessions.flatMap(({ turns }) => turns);
    userTurnCount += turns.filter(({ role }) => role === "user").length;
    const counts = await countPreferenceCandidates({
      scopeId: scenario.scenario_id,
      turns,
    });
    preferenceCandidateCount += counts.candidateCount;
    legacyCategoryValueChangeCount += counts.categoryChanges;
    preferenceBearingScopeCount += counts.preferenceBearing ? 1 : 0;
    fingerprintParts.push(`${file}:${sha256(raw)}`);
  }

  let behaviorUserTurnCount = 0;
  let behaviorPreferenceCandidateCount = 0;
  for (const scenario of Object.values(behaviorScenarios)) {
    const turns = scenario.sessions.flatMap(({ turns }) => turns);
    behaviorUserTurnCount += turns.filter(({ role }) => role === "user").length;
    const counts = await countPreferenceCandidates({
      scopeId: scenario.id,
      turns,
    });
    behaviorPreferenceCandidateCount += counts.candidateCount;
    legacyCategoryValueChangeCount += counts.categoryChanges;
    preferenceBearingScopeCount += counts.preferenceBearing ? 1 : 0;
  }
  fingerprintParts.push(
    `behavior-scenarios:${sha256(JSON.stringify(behaviorScenarios))}`,
  );

  const behaviorScenarioCount = Object.keys(behaviorScenarios).length;
  const expectedEval = preregistration.corpus.evalScenarios;
  const expectedBehavior = preregistration.corpus.behaviorScenarios;
  if (
    scenarioFiles.length !== expectedEval.expectedFileCount ||
    userTurnCount !== expectedEval.expectedUserTurnCount ||
    behaviorScenarioCount !== expectedBehavior.expectedScenarioCount ||
    behaviorUserTurnCount !== expectedBehavior.expectedUserTurnCount
  ) {
    throw new Error(
      "Preference conflict census corpus no longer matches its preregistered file, scenario, and user-turn counts.",
    );
  }

  return {
    corpus: {
      behaviorScenarioCount,
      behaviorUserTurnCount,
      fingerprint: sha256(fingerprintParts.join("\n")),
      scenarioFileCount: scenarioFiles.length,
      userTurnCount,
    },
    decision: {
      adjudicationApiAllowed: false,
      minimumNaturalSameSlotChanges:
        preregistration.decisionRules.minimumNaturalSameSlotChanges,
      observedLegacyCategoryValueChanges: legacyCategoryValueChangeCount,
      reason:
        "Same-slot, recency-appropriateness, and ambiguity metrics are unavailable; the fixture corpus cannot admit an adjudication API.",
      status: "underpowered_no_adjudication",
    },
    generatedAt: new Date().toISOString(),
    identityMetrics: {
      ambiguousConflictCount: null,
      ambiguousConflictRate: null,
      recencyAppropriateCount: null,
      recencyAppropriateRate: null,
      sameSlotChangeCount: null,
      unavailableReason:
        "Current rules-only records expose legacy categories, not frozen identity slots.",
    },
    preregistrationSha256: sha256(preregistrationRaw),
    productionIncidenceClaimed: false,
    rulesOnly: {
      behaviorPreferenceCandidateCount,
      preferenceBearingScopeCount,
      preferenceCandidateCount,
      legacyCategoryValueChangeCount,
    },
    scope: "repository_fixture_census_only",
  };
}

function simulatedOutcome(input: {
  policy: "current_destructive" | "freeze" | "recency_lineage";
  relation: PreferenceConflictRelation;
}): {
  active: ActiveLabel[];
  frozen: boolean;
  generalFallbackAvailable: boolean;
  retainLineage: boolean;
  warning: boolean;
} {
  if (input.policy === "current_destructive") {
    return {
      active: ["incoming"],
      frozen: false,
      generalFallbackAvailable: true,
      retainLineage: false,
      warning: false,
    };
  }
  const coexistence =
    input.relation === "contextual_coexistence" ||
    input.relation === "same_category_different_dimension";
  if (coexistence) {
    return {
      active: ["prior", "incoming"],
      frozen: false,
      generalFallbackAvailable: true,
      retainLineage: true,
      warning: false,
    };
  }
  if (input.relation === "compound_partial_update") {
    if (input.policy === "freeze") {
      return {
        active: ["prior_companion"],
        frozen: true,
        generalFallbackAvailable: false,
        retainLineage: true,
        warning: true,
      };
    }
    return {
      active: ["prior_companion", "incoming"],
      frozen: false,
      generalFallbackAvailable: true,
      retainLineage: true,
      warning: false,
    };
  }
  if (input.relation === "legacy_unkeyed") {
    if (input.policy === "freeze") {
      return {
        active: ["incoming"],
        frozen: true,
        generalFallbackAvailable: false,
        retainLineage: true,
        warning: true,
      };
    }
    return {
      active: ["prior", "incoming"],
      frozen: false,
      generalFallbackAvailable: true,
      retainLineage: true,
      warning: true,
    };
  }
  if (input.policy === "freeze") {
    return {
      active: [],
      frozen: true,
      generalFallbackAvailable: false,
      retainLineage: true,
      warning: true,
    };
  }
  return {
    active: ["incoming"],
    frozen: false,
    generalFallbackAvailable: true,
    retainLineage: true,
    warning: false,
  };
}

function sameLabels(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

export function simulatePreferenceConflictPolicies(
  cohort: PreferenceConflictSyntheticCohort,
): PreferenceConflictPolicyReport {
  const policies = [
    "current_destructive",
    "recency_lineage",
    "freeze",
  ] as const;
  const results = Object.fromEntries(
    policies.map((policy) => {
      let acceptanceCount = 0;
      let amnesiaCount = 0;
      let expectedActiveInstructionExactMatchCount = 0;
      let falseConflictOrFreezeCount = 0;
      let generalFallbackAvailableCount = 0;
      let lineageRecoverableCount = 0;
      let silentDataLossCount = 0;
      let unrecoverableWithExistingReviseOrForgetCount = 0;
      for (const caseResult of cohort.cases) {
        const actual = simulatedOutcome({
          policy,
          relation: caseResult.relation,
        });
        const expected = caseResult.expected;
        const activeInstructionsMatch = sameLabels(
          actual.active,
          expected.active,
        );
        if (activeInstructionsMatch) {
          expectedActiveInstructionExactMatchCount += 1;
        }
        if (
          activeInstructionsMatch &&
          actual.retainLineage === expected.retainLineage &&
          actual.warning === expected.warning &&
          actual.generalFallbackAvailable
        ) {
          acceptanceCount += 1;
        }
        if (actual.active.length === 0 && expected.active.length > 0) {
          amnesiaCount += 1;
        }
        if ((actual.frozen || actual.warning) && !expected.warning) {
          falseConflictOrFreezeCount += 1;
        }
        if (actual.generalFallbackAvailable) {
          generalFallbackAvailableCount += 1;
        }
        if (actual.retainLineage) {
          lineageRecoverableCount += 1;
        }
        if (!actual.retainLineage && expected.retainLineage && !actual.warning) {
          silentDataLossCount += 1;
        }
        if (!actual.retainLineage && expected.retainLineage) {
          unrecoverableWithExistingReviseOrForgetCount += 1;
        }
      }
      const caseCount = cohort.cases.length;
      return [policy, {
        acceptanceCount,
        amnesiaCount,
        caseCount,
        expectedActiveInstructionAccuracy: ratio(
          expectedActiveInstructionExactMatchCount,
          caseCount,
        ),
        expectedActiveInstructionExactMatchCount,
        falseConflictOrFreezeCount,
        falseConflictOrFreezeRate: ratio(
          falseConflictOrFreezeCount,
          caseCount,
        ),
        generalFallbackAvailabilityRate: ratio(
          generalFallbackAvailableCount,
          caseCount,
        ),
        generalFallbackAvailableCount,
        lineageRecoverabilityRate: ratio(
          lineageRecoverableCount,
          caseCount,
        ),
        lineageRecoverableCount,
        silentDataLossCount,
        silentDataLossRate: ratio(silentDataLossCount, caseCount),
        unrecoverableWithExistingReviseOrForgetCount,
        unrecoverableWithExistingReviseOrForgetRate: ratio(
          unrecoverableWithExistingReviseOrForgetCount,
          caseCount,
        ),
      }];
    }),
  ) as PreferenceConflictPolicyReport["policies"];

  const cohortCounts = Object.fromEntries(
    relationSchema.options.map((relation) => [
      relation,
      cohort.cases.filter((caseResult) => caseResult.relation === relation).length,
    ]),
  ) as Record<PreferenceConflictRelation, number>;
  return {
    cohortCounts,
    cohortFingerprint: sha256(JSON.stringify(cohort)),
    policies: results,
    productionIncidenceClaimed: false,
    syntheticOnly: true,
  };
}

interface PreferenceConflictCliOptions {
  outputDir?: string;
  runId?: string;
}

function parsePreferenceConflictCliOptions(
  argv: readonly string[],
): PreferenceConflictCliOptions {
  return {
    outputDir: resolveCliFlagValueStrict(argv, "--output-dir"),
    runId: resolveCliFlagValueStrict(argv, "--run-id"),
  };
}

export async function runPreferenceConflictAnalysisCli(
  options: PreferenceConflictCliOptions = {},
): Promise<PreferenceConflictAnalysisReport> {
  const repoRoot = resolveRepoRootFromScriptUrl(import.meta.url);
  if (
    options.outputDir !== undefined &&
    options.outputDir !== AGGREGATE_REPORT_DIRECTORY &&
    options.outputDir !== join(repoRoot, AGGREGATE_REPORT_DIRECTORY)
  ) {
    throw new Error(
      `Preference conflict analysis writes only to the fixed aggregate report path ${PREFERENCE_CONFLICT_AGGREGATE_REPORT_PATH}.`,
    );
  }
  if (
    options.runId !== undefined &&
    options.runId !== "current"
  ) {
    throw new Error(
      `Preference conflict analysis writes only to the fixed aggregate report path ${PREFERENCE_CONFLICT_AGGREGATE_REPORT_PATH}.`,
    );
  }
  const [census, cohort, git] = await Promise.all([
    runPreferenceFixtureCensus(repoRoot),
    loadPreferenceConflictSyntheticCohort(repoRoot),
    resolveGitProvenance(repoRoot),
  ]);
  const synthetic = simulatePreferenceConflictPolicies(cohort);
  const report = {
    census,
    generatedAt: new Date().toISOString(),
    git,
    note: "The fixture census and synthetic policy challenge have separate denominators. Neither is a production incidence estimate.",
    synthetic,
  };
  if (options.outputDir) {
    const reportPath = join(
      repoRoot,
      PREFERENCE_CONFLICT_AGGREGATE_REPORT_PATH,
    );
    await mkdir(join(repoRoot, AGGREGATE_REPORT_DIRECTORY, "current"), {
      recursive: true,
    });
    await writeFile(
      reportPath,
      `${JSON.stringify(report, null, 2)}\n`,
    );
  }
  return report;
}

if (import.meta.main) {
  const report = await runPreferenceConflictAnalysisCli(
    parsePreferenceConflictCliOptions(process.argv),
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
