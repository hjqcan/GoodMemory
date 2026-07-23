import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "bun:test";

import {
  assertPhase74CanonicalProtectionPlanIdentities,
  parsePhase74ProtectionEvidenceCliOptions,
  runPhase74ProtectionEvidenceGeneration,
} from "../../scripts/build-phase-74-protection-evidence";
import {
  PHASE74_BEAM_FULL_100K_DATASET_ID,
  PHASE74_BEAM_SAFETY_METRICS,
  PHASE74_BEAM_SAFETY_SUITE,
  PHASE74_BEAM_SAFETY_VERIFIER_ID,
} from "../../src/eval/phase74BeamSafetyProtection";
import {
  PHASE74_BEAM_FULL_100K_DATASET_PROVENANCE,
} from "../../src/eval/phase74BeamSafetyLive";
import {
  PHASE74_HALUMEM_E4_METRIC,
  PHASE74_HALUMEM_E4_PROTECTION_VERIFIER_ID,
  PHASE74_HALUMEM_E4_SUITE,
  PHASE74_HALUMEM_PRIVACY_PROTECTION_VERIFIER_ID,
  PHASE74_HALUMEM_PRIVACY_SUITE,
  PHASE74_HALUMEM_UPDATE_PROTECTION_VERIFIER_ID,
  PHASE74_HALUMEM_UPDATE_SUITE,
} from "../../src/eval/phase74HaluMemProtectionVerifier";
import {
  PHASE74_MAB_PROTECTION_DATASET_ID,
  PHASE74_MAB_PROTECTION_DATASET_SHA256,
  PHASE74_MAB_PROTECTION_METRICS,
  PHASE74_MAB_PROTECTION_SUITE,
  PHASE74_MAB_PROTECTION_VERIFIER_ID,
} from "../../src/eval/phase74MemoryAgentBenchProtectionVerifier";
import {
  hashPhase74ProtectionCaseIds,
} from "../../src/eval/phase74ProtectionContracts";
import type {
  Phase74ProtectionIdentityDescriptor,
  Phase74ProtectionRunIdentity,
} from "../../src/eval/phase74ProtectionContracts";
import {
  buildPhase74ProtectionPlan,
  describePhase74ProtectionCallBudget,
  loadPhase74ProtectionPlan,
} from "../../src/eval/phase74ProtectionPlan";
import type {
  Phase74ProtectionPlan,
  Phase74ProtectionPlanAdmissionClass,
  Phase74ProtectionPlanControls,
} from "../../src/eval/phase74ProtectionPlan";
import type {
  Phase74ProtectionRunIdentityInput,
  Phase74ProtectionSuiteBranchScores,
  Phase74ProtectionSuiteKind,
} from "../../src/eval/phase74ProtectionRun";
import {
  hashPhase74ProtectionValue,
  loadPhase74FrozenProtectionSuiteRunArtifact,
  runPhase74ProtectionSuiteCases,
} from "../../src/eval/phase74ProtectionRun";
import {
  buildPhase74FrozenProtectionSuiteEvidence,
  hashPhase74ProtectionSuiteIdentity,
  isPhase74FrozenProtectionSuiteEvidencePromotionAdmissible,
  loadPhase74ProtectionBlueprintDescriptor,
  loadPhase74FrozenProtectionSuiteEvidence,
  PHASE74_BEAM_LIVE_CLOSURE_VERIFIER_ID,
  PHASE74_HALUMEM_LIVE_CLOSURE_VERIFIER_ID,
  phase74ProtectionSuiteMetricName,
} from "../../src/eval/phase74ProtectionSuiteEvidence";
import type {
  Phase74ProtectionFileReference,
  Phase74ProtectionLiveClosureVerifier,
  Phase74ProtectionSuiteManifest,
} from "../../src/eval/phase74ProtectionSuiteEvidence";
import type {
  Phase74ProtectionSuiteVerifier,
} from "../../src/eval/phase74ProtectionVerifier";
import {
  PHASE74_HALUMEM_MEDIUM_DATASET_ID,
  PHASE74_HALUMEM_MEDIUM_SHA256,
} from "../../scripts/run-phase-74-halumem-live-protection";

const FORMATS = [
  "prose",
  "chronology",
  "compact_json",
  "json_locale_note",
] as const;
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, {
    force: true,
    recursive: true,
  })));
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "phase74-suite-evidence-"));
  roots.push(root);
  return root;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function descriptor(id: string): Phase74ProtectionIdentityDescriptor {
  return { id, sha256: sha256(id) };
}

function canonicalVerifierDescriptor(
  id: string,
): Phase74ProtectionIdentityDescriptor {
  return { id, sha256: hashPhase74ProtectionValue({ id }) };
}

function identity(
  suiteId: string,
  populationId: string,
  dataset: { id: string; sha256: string },
): Phase74ProtectionRunIdentityInput {
  return {
    dataset,
    judge: descriptor(`${suiteId}-judge`),
    model: descriptor(`${suiteId}-model`),
    pipeline: descriptor(`${suiteId}-pipeline`),
    populationId,
    prompt: descriptor(`${suiteId}-prompt`),
    source: descriptor("git:trusted-source"),
  };
}

function protectionScores(value: number): Phase74ProtectionSuiteBranchScores {
  return {
    protections: {
      evidence_recall: value,
      stale_avoidance: value + 0.1,
    },
  };
}

function e4Scores(value: number): Phase74ProtectionSuiteBranchScores {
  return {
    e4: {
      chronology: { answer_quality: value },
      compact_json: { answer_quality: value },
      json_locale_note: { answer_quality: value },
      prose: { answer_quality: value },
    },
  };
}

function safetyScores(input: {
  abstentionAccuracy: number;
  hallucinationRate: number;
  privacyPassRate: number;
  updateCorrectness: number;
}): Phase74ProtectionSuiteBranchScores {
  return { safety: input };
}

interface SuiteFixture {
  dataset: {
    id: string;
    path: string;
    sha256: string;
  };
  identity: Phase74ProtectionRunIdentityInput;
  kind: Phase74ProtectionSuiteKind;
  paths: string[];
  requiredMetrics: string[];
  suiteId: string;
  verifierId: string;
}

async function createSuite(input: {
  baseline: Phase74ProtectionSuiteBranchScores;
  candidate: Phase74ProtectionSuiteBranchScores;
  caseCount: number;
  kind: Phase74ProtectionSuiteKind;
  requiredMetrics: string[];
  root: string;
  suiteId: string;
}): Promise<SuiteFixture> {
  await mkdir(input.root, { recursive: true });
  const datasetPath = join(input.root, `${input.suiteId}-dataset.json`);
  const datasetText = `${JSON.stringify({ suiteId: input.suiteId })}\n`;
  await writeFile(datasetPath, datasetText, "utf8");
  const dataset = {
    id: `${input.suiteId}-dataset`,
    path: datasetPath,
    sha256: sha256(datasetText),
  };
  const suiteIdentity = identity(
    input.suiteId,
    `${input.suiteId}-population`,
    { id: dataset.id, sha256: dataset.sha256 },
  );
  const paths: string[] = [];
  for (const replicate of [1, 2, 3] as const) {
    const directory = join(input.root, `${input.suiteId}-r${replicate}`);
    const result = await runPhase74ProtectionSuiteCases({
      artifactPath: join(directory, "run.json"),
      cases: Array.from({ length: input.caseCount }, (_, index) => ({
        caseId: `${input.suiteId}:case-${index + 1}`,
        input: { index },
      })),
      evaluate: async ({ branch }) => ({
        rawOutput: { branch },
        scores: branch === "baseline" ? input.baseline : input.candidate,
      }),
      identity: suiteIdentity,
      rawArtifactPath: join(directory, "raw.json"),
      replicate,
      runId: `${input.suiteId}-r${replicate}`,
      suite: { id: input.suiteId, kind: input.kind },
    });
    paths.push(result.artifactPath);
  }
  return {
    dataset,
    identity: suiteIdentity,
    kind: input.kind,
    paths,
    requiredMetrics: input.requiredMetrics,
    suiteId: input.suiteId,
    verifierId: `${input.suiteId}-test-verifier-v1`,
  };
}

function fixtureVerifier(
  suite: SuiteFixture,
  onVerify?: () => void,
): Phase74ProtectionSuiteVerifier {
  return {
    id: suite.verifierId,
    kind: suite.kind,
    requiredMetrics: suite.requiredMetrics,
    suiteId: suite.suiteId,
    verify: async ({ datasetBytes, run }) => {
      onVerify?.();
      const dataset = JSON.parse(Buffer.from(datasetBytes).toString("utf8"));
      if (dataset.suiteId !== run.suite.id) {
        throw new Error("test verifier dataset drifted");
      }
    },
  };
}

async function writeManifest(
  root: string,
  suites: readonly SuiteFixture[],
): Promise<string> {
  const manifestPath = join(root, "manifest.json");
  const manifest: Phase74ProtectionSuiteManifest = {
    admission: "canonical-verifier-bound-v1",
    artifactKind: "phase74-protection-suite-manifest",
    schemaVersion: 2,
    suites: await Promise.all(suites.map(async (suite) => {
      const run = JSON.parse(await readFile(suite.paths[0]!, "utf8"));
      return {
        dataset: suite.dataset,
        id: suite.suiteId,
        identityHash: hashPhase74ProtectionSuiteIdentity(run.identity),
        kind: suite.kind,
        requiredMetrics: suite.requiredMetrics,
        verifierId: suite.verifierId,
      };
    })),
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifestPath;
}

async function createCompleteFixture(root: string) {
  const protection = await createSuite({
    baseline: protectionScores(0.4),
    candidate: protectionScores(0.45),
    caseCount: 2,
    kind: "benchmark-protection",
    requiredMetrics: ["evidence_recall", "stale_avoidance"],
    root,
    suiteId: "mab",
  });
  const e4 = await createSuite({
    baseline: e4Scores(0.5),
    candidate: e4Scores(0.52),
    caseCount: 1,
    kind: "e4",
    requiredMetrics: ["answer_quality"],
    root,
    suiteId: "e4-reader",
  });
  const safetyPrimary = await createSuite({
    baseline: safetyScores({
      abstentionAccuracy: 0.8,
      hallucinationRate: 0.1,
      privacyPassRate: 0.9,
      updateCorrectness: 0.8,
    }),
    candidate: safetyScores({
      abstentionAccuracy: 0.82,
      hallucinationRate: 0.11,
      privacyPassRate: 0.93,
      updateCorrectness: 0.84,
    }),
    caseCount: 2,
    kind: "safety",
    requiredMetrics: [
      "abstentionAccuracy",
      "hallucinationRate",
      "privacyPassRate",
      "updateCorrectness",
    ],
    root,
    suiteId: "safety-primary",
  });
  const safetySecondary = await createSuite({
    baseline: safetyScores({
      abstentionAccuracy: 0.8,
      hallucinationRate: 0.1,
      privacyPassRate: 0.9,
      updateCorrectness: 0.8,
    }),
    candidate: safetyScores({
      abstentionAccuracy: 0.79,
      hallucinationRate: 0.08,
      privacyPassRate: 0.91,
      updateCorrectness: 0.8,
    }),
    caseCount: 3,
    kind: "safety",
    requiredMetrics: [
      "abstentionAccuracy",
      "hallucinationRate",
      "privacyPassRate",
      "updateCorrectness",
    ],
    root,
    suiteId: "safety-secondary",
  });
  const suites = [protection, e4, safetyPrimary, safetySecondary];
  return {
    manifestPath: await writeManifest(root, suites),
    paths: suites.flatMap(({ paths }) => paths),
    suites,
    verifiers: suites.map((suite) => fixtureVerifier(suite)),
  };
}

interface PlannedSuiteDefinition {
  kind: Phase74ProtectionSuiteKind;
  requiredMetrics: readonly string[];
  scores: Phase74ProtectionSuiteBranchScores;
  suiteId: string;
  verifierId: string;
}

const PLANNED_SUITE_DEFINITIONS = [
  {
    kind: PHASE74_MAB_PROTECTION_SUITE.kind,
    requiredMetrics: PHASE74_MAB_PROTECTION_METRICS,
    scores: {
      protections: Object.fromEntries(
        PHASE74_MAB_PROTECTION_METRICS.map((metric) => [metric, 0.5]),
      ),
    },
    suiteId: PHASE74_MAB_PROTECTION_SUITE.id,
    verifierId: PHASE74_MAB_PROTECTION_VERIFIER_ID,
  },
  {
    kind: PHASE74_HALUMEM_E4_SUITE.kind,
    requiredMetrics: [PHASE74_HALUMEM_E4_METRIC],
    scores: {
      e4: {
        chronology: { [PHASE74_HALUMEM_E4_METRIC]: 0.5 },
        compact_json: { [PHASE74_HALUMEM_E4_METRIC]: 0.5 },
        json_locale_note: { [PHASE74_HALUMEM_E4_METRIC]: 0.5 },
        prose: { [PHASE74_HALUMEM_E4_METRIC]: 0.5 },
      },
    },
    suiteId: PHASE74_HALUMEM_E4_SUITE.id,
    verifierId: PHASE74_HALUMEM_E4_PROTECTION_VERIFIER_ID,
  },
  {
    kind: PHASE74_HALUMEM_UPDATE_SUITE.kind,
    requiredMetrics: ["updateCorrectness"],
    scores: { safety: { updateCorrectness: 0.5 } },
    suiteId: PHASE74_HALUMEM_UPDATE_SUITE.id,
    verifierId: PHASE74_HALUMEM_UPDATE_PROTECTION_VERIFIER_ID,
  },
  {
    kind: PHASE74_HALUMEM_PRIVACY_SUITE.kind,
    requiredMetrics: ["privacyPassRate"],
    scores: { safety: { privacyPassRate: 0.5 } },
    suiteId: PHASE74_HALUMEM_PRIVACY_SUITE.id,
    verifierId: PHASE74_HALUMEM_PRIVACY_PROTECTION_VERIFIER_ID,
  },
  {
    kind: PHASE74_BEAM_SAFETY_SUITE.kind,
    requiredMetrics: PHASE74_BEAM_SAFETY_METRICS,
    scores: {
      safety: {
        abstentionAccuracy: 0.5,
        hallucinationRate: 0.1,
      },
    },
    suiteId: PHASE74_BEAM_SAFETY_SUITE.id,
    verifierId: PHASE74_BEAM_SAFETY_VERIFIER_ID,
  },
] as const satisfies readonly PlannedSuiteDefinition[];

function plannedControls(
  definition: PlannedSuiteDefinition,
): Phase74ProtectionPlanControls {
  return {
    callBudget: definition.suiteId === PHASE74_MAB_PROTECTION_SUITE.id
      ? describePhase74ProtectionCallBudget("no-live-model-calls-v1")
      : describePhase74ProtectionCallBudget({
        embeddingSpendLimitUsd: 0.25,
        maxLanguageCalls: 1_000,
      }),
    caseConcurrency: 2,
    renderedContextTokens: 6_000,
  };
}

function runIdentity(
  input: Phase74ProtectionRunIdentityInput,
  caseIds: readonly string[],
): Phase74ProtectionRunIdentity {
  return {
    dataset: input.dataset,
    judge: input.judge,
    model: input.model,
    pipeline: input.pipeline,
    population: {
      caseCount: caseIds.length,
      caseIdsSha256: hashPhase74ProtectionCaseIds(caseIds),
      id: input.populationId,
    },
    prompt: input.prompt,
    source: input.source,
  };
}

async function createPlannedFixture(
  root: string,
  admissionClass: Phase74ProtectionPlanAdmissionClass =
    "promotion-admissible",
) {
  const definitions = await Promise.all(
    PLANNED_SUITE_DEFINITIONS.map(async (definition) => {
      const directory = join(root, definition.suiteId);
      await mkdir(directory, { recursive: true });
      const datasetPath = join(directory, "dataset.json");
      const datasetText = `${JSON.stringify({
        suiteId: definition.suiteId,
      })}\n`;
      await writeFile(datasetPath, datasetText, "utf8");
      const dataset = {
        id: `${definition.suiteId}-dataset`,
        path: datasetPath,
        sha256: sha256(datasetText),
      };
      const caseIds = [`${definition.suiteId}:case-1`];
      const suiteIdentity = identity(
        definition.suiteId,
        `${definition.suiteId}-population`,
        { id: dataset.id, sha256: dataset.sha256 },
      );
      return {
        ...definition,
        caseIds,
        controls: plannedControls(definition),
        dataset,
        identity: suiteIdentity,
        runIdentity: runIdentity(suiteIdentity, caseIds),
        suite: {
          id: definition.suiteId,
          kind: definition.kind,
        },
        verifier: canonicalVerifierDescriptor(definition.verifierId),
      };
    }),
  );
  const manifestPath = join(root, "planned-manifest.json");
  const manifest: Phase74ProtectionSuiteManifest = {
    admission: "canonical-verifier-bound-v1",
    artifactKind: "phase74-protection-suite-manifest",
    schemaVersion: 2,
    suites: definitions.map((definition) => ({
      dataset: definition.dataset,
      id: definition.suiteId,
      identityHash: hashPhase74ProtectionSuiteIdentity(
        definition.runIdentity,
      ),
      kind: definition.kind,
      requiredMetrics: [...definition.requiredMetrics],
      verifierId: definition.verifierId,
    })),
  };
  await writeFile(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  const protectionBlueprint = await loadPhase74ProtectionBlueprintDescriptor(
    manifestPath,
  );
  const plan = buildPhase74ProtectionPlan({
    admissionClass,
    evaluatorSource: descriptor("git:trusted-source"),
    protectionBlueprint,
    runs: definitions.flatMap((definition) =>
      ([1, 2, 3] as const).map((replicate) => ({
        caseIds: definition.caseIds,
        controls: definition.controls,
        identity: definition.runIdentity,
        protectionBlueprint,
        replicate,
        runId: `${definition.suiteId}-r${replicate}`,
        suite: definition.suite,
        verifier: definition.verifier,
      }))
    ),
  });
  const planPath = join(root, "protection-plan.json");
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  const loadedPlan = await loadPhase74ProtectionPlan(planPath);
  const paths: string[] = [];
  const suites: SuiteFixture[] = [];
  for (const definition of definitions) {
    const suitePaths: string[] = [];
    for (const replicate of [1, 2, 3] as const) {
      const directory = join(
        root,
        definition.suiteId,
        `replicate-${replicate}`,
      );
      const result = await runPhase74ProtectionSuiteCases({
        artifactPath: join(directory, "run.json"),
        cases: definition.caseIds.map((caseId) => ({
          caseId,
          input: { caseId },
        })),
        evaluate: async ({ branch }) => ({
          rawOutput: { branch },
          scores: definition.scores,
        }),
        identity: definition.identity,
        plan: {
          controls: definition.controls,
          loadedPlan,
          protectionBlueprint,
          verifier: definition.verifier,
        },
        rawArtifactPath: join(directory, "raw.json"),
        replicate,
        runId: `${definition.suiteId}-r${replicate}`,
        suite: definition.suite,
      });
      paths.push(result.artifactPath);
      suitePaths.push(result.artifactPath);
    }
    suites.push({
      dataset: definition.dataset,
      identity: definition.identity,
      kind: definition.kind,
      paths: suitePaths,
      requiredMetrics: [...definition.requiredMetrics],
      suiteId: definition.suiteId,
      verifierId: definition.verifierId,
    });
  }
  return {
    loadedPlan,
    manifestPath,
    paths,
    planPath,
    suites,
    verifiers: suites.map((suite) => fixtureVerifier(suite)),
  };
}

const CANONICAL_HALUMEM_POPULATIONS = {
  [PHASE74_HALUMEM_E4_SUITE.id]: {
    caseCount: 3_303,
    caseIdsSha256:
      "826364d831dcf57635c21129ab1af0ff1490c36a8084ba1cbdb7ccc1f45be0a3",
    id:
      "HaluMem-Medium:2d8cf791abdd767e4dcdbb2a6a7116d82cef08d366f30ea93151ac30fc73c958:question-population-v1",
  },
  [PHASE74_HALUMEM_UPDATE_SUITE.id]: {
    caseCount: 2_980,
    caseIdsSha256:
      "32391c6d44eb2276d055d93f8a2b55aecbbe9d8dc52639204858f796b377d419",
    id:
      "HaluMem-Medium:2d8cf791abdd767e4dcdbb2a6a7116d82cef08d366f30ea93151ac30fc73c958:update-population-v1",
  },
  [PHASE74_HALUMEM_PRIVACY_SUITE.id]: {
    caseCount: 3_303,
    caseIdsSha256:
      "2b82668b32232e0cac11580924b62def4a595598369cd454efc8eb498ba77d92",
    id:
      "HaluMem-Medium:2d8cf791abdd767e4dcdbb2a6a7116d82cef08d366f30ea93151ac30fc73c958:cross-user-privacy-population-v1",
  },
} as const;

function canonicalizePlanIdentities(
  value: Phase74ProtectionPlan,
): {
  expected: Map<string, Phase74ProtectionRunIdentity>;
  plan: Phase74ProtectionPlan;
} {
  const plan = structuredClone(value);
  for (const run of plan.runs) {
    if (run.suite.id === PHASE74_MAB_PROTECTION_SUITE.id) {
      run.identity.dataset = {
        id: PHASE74_MAB_PROTECTION_DATASET_ID,
        sha256: PHASE74_MAB_PROTECTION_DATASET_SHA256,
      };
    } else if (run.suite.id === PHASE74_BEAM_SAFETY_SUITE.id) {
      run.identity.dataset = {
        id: PHASE74_BEAM_FULL_100K_DATASET_ID,
        sha256:
          PHASE74_BEAM_FULL_100K_DATASET_PROVENANCE.deterministicExport.sha256,
      };
    } else {
      run.identity.dataset = {
        id: PHASE74_HALUMEM_MEDIUM_DATASET_ID,
        sha256: PHASE74_HALUMEM_MEDIUM_SHA256,
      };
      run.identity.population =
        CANONICAL_HALUMEM_POPULATIONS[
          run.suite.id as keyof typeof CANONICAL_HALUMEM_POPULATIONS
        ];
    }
  }
  return {
    expected: new Map(PLANNED_SUITE_DEFINITIONS.map(({ suiteId }) => [
      suiteId,
      structuredClone(
        plan.runs.find(({ suite }) => suite.id === suiteId)!.identity,
      ),
    ])),
    plan,
  };
}

function createTestLiveClosureVerifier(
  root: string,
): Phase74ProtectionLiveClosureVerifier {
  const reference = async (
    path: string,
    value: unknown,
  ): Promise<Phase74ProtectionFileReference> => {
    const text = `${JSON.stringify(value)}\n`;
    await mkdir(dirname(path), { recursive: true });
    try {
      await writeFile(path, text, { encoding: "utf8", flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    }
    const persisted = await readFile(path, "utf8");
    return { path: resolve(path), sha256: sha256(persisted) };
  };
  return {
    async verify({ plan, runs }) {
      const receipts = [];
      for (const replicate of [1, 2, 3] as const) {
        for (const kind of ["beam", "halumem"] as const) {
          const selected = runs.filter(({ replicate: runReplicate, suite }) =>
            runReplicate === replicate &&
            (kind === "beam"
              ? suite.id === PHASE74_BEAM_SAFETY_SUITE.id
              : ([
                  PHASE74_HALUMEM_E4_SUITE.id,
                  PHASE74_HALUMEM_PRIVACY_SUITE.id,
                  PHASE74_HALUMEM_UPDATE_SUITE.id,
                ] as string[]).includes(suite.id))
          );
          const directory = join(root, "closure", kind, String(replicate));
          const callBudgetArtifact = await reference(
            join(directory, "call-budget.json"),
            {
              embeddingSpendLimitUsd: 0.25,
              maxLanguageCalls: 1_000,
              schemaVersion: 1,
            },
          );
          const closureArtifact = await reference(
            join(directory, "closure.json"),
            { kind, replicate },
          );
          const usageArtifact = await reference(
            join(directory, "usage.jsonl"),
            { kind, replicate },
          );
          receipts.push({
            callBudgetArtifact,
            closureArtifact,
            closureVerifier: canonicalVerifierDescriptor(
              kind === "beam"
                ? PHASE74_BEAM_LIVE_CLOSURE_VERIFIER_ID
                : PHASE74_HALUMEM_LIVE_CLOSURE_VERIFIER_ID,
            ),
            kind,
            planSha256: plan.sha256,
            plannedRunSha256s: selected.map((run) => {
              if (run.schemaVersion !== 2) {
                throw new Error("Expected planned protection run.");
              }
              return run.plannedRunSha256;
            }),
            replicate,
            runIds: selected.map(({ runId }) => runId),
            suiteIds: selected.map(({ suite }) => suite.id),
            usageArtifacts: [usageArtifact],
          });
        }
      }
      return receipts;
    },
  };
}

describe("Phase 74 protection suite evidence composer", () => {
  it("preflights a planned run before evaluation or artifact writes", async () => {
    const root = await createRoot();
    const cases = [
      { caseId: "case-1", input: {} },
      { caseId: "case-2", input: {} },
    ];
    const caseIds = cases.map(({ caseId }) => caseId);
    const suite = {
      id: "diagnostic-preflight-suite",
      kind: "benchmark-protection" as const,
    };
    const suiteIdentity = identity(
      suite.id,
      "diagnostic-preflight-population",
      descriptor("diagnostic-preflight-dataset"),
    );
    const protectionBlueprint = descriptor("diagnostic-blueprint");
    const verifier = descriptor("diagnostic-verifier");
    const controls = {
      callBudget: describePhase74ProtectionCallBudget(
        "no-live-model-calls-v1",
      ),
      caseConcurrency: 2,
      renderedContextTokens: 6_000,
    };
    const expectedRun = {
      caseIds,
      controls,
      identity: runIdentity(suiteIdentity, caseIds),
      protectionBlueprint,
      replicate: 1 as const,
      runId: "planned-run",
      suite,
      verifier,
    };
    const plan = buildPhase74ProtectionPlan({
      admissionClass: "diagnostic",
      evaluatorSource: suiteIdentity.source,
      protectionBlueprint,
      runs: [expectedRun],
    });
    const planPath = join(root, "preflight-plan.json");
    await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
    const loadedPlan = await loadPhase74ProtectionPlan(planPath);
    let evaluationCount = 0;
    const drifts: Array<{
      caseConcurrency?: number;
      cases?: typeof cases;
      controls?: Phase74ProtectionPlanControls;
      identity?: Phase74ProtectionRunIdentityInput;
      label: string;
      protectionBlueprint?: Phase74ProtectionIdentityDescriptor;
      replicate?: 1 | 2 | 3;
      runId?: string;
      suite?: { id: string; kind: Phase74ProtectionSuiteKind };
      verifier?: Phase74ProtectionIdentityDescriptor;
    }> = [
      { cases: [...cases].reverse(), label: "case-order" },
      {
        identity: {
          ...suiteIdentity,
          source: descriptor("drifted-source"),
        },
        label: "source",
      },
      {
        label: "blueprint",
        protectionBlueprint: descriptor("drifted-blueprint"),
      },
      {
        controls: {
          ...controls,
          renderedContextTokens: controls.renderedContextTokens + 1,
        },
        label: "controls",
      },
      {
        caseConcurrency: controls.caseConcurrency + 1,
        label: "runtime-concurrency",
      },
      { label: "suite", suite: { ...suite, kind: "safety" } },
      { label: "replicate", replicate: 2 },
      { label: "run-id", runId: "drifted-run" },
      { label: "verifier", verifier: descriptor("drifted-verifier") },
    ];
    for (const drift of drifts) {
      const artifactPath = join(root, drift.label, "run.json");
      const rawArtifactPath = join(root, drift.label, "raw.json");
      await expect(runPhase74ProtectionSuiteCases({
        artifactPath,
        caseConcurrency: drift.caseConcurrency ?? controls.caseConcurrency,
        cases: drift.cases ?? cases,
        evaluate: async () => {
          evaluationCount += 1;
          return {
            rawOutput: {},
            scores: protectionScores(0.5),
          };
        },
        identity: drift.identity ?? suiteIdentity,
        plan: {
          controls: drift.controls ?? controls,
          loadedPlan,
          protectionBlueprint: drift.protectionBlueprint ??
            protectionBlueprint,
          verifier: drift.verifier ?? verifier,
        },
        rawArtifactPath,
        replicate: drift.replicate ?? 1,
        runId: drift.runId ?? "planned-run",
        suite: drift.suite ?? suite,
      })).rejects.toThrow(/drift|plan/i);
      await expect(readFile(artifactPath, "utf8")).rejects.toThrow();
      await expect(readFile(rawArtifactPath, "utf8")).rejects.toThrow();
    }
    expect(evaluationCount).toBe(0);
  });

  it("binds the exact promotion plan but keeps injected closure evidence diagnostic", async () => {
    const root = await createRoot();
    const fixture = await createPlannedFixture(root);
    const firstRun = await loadPhase74FrozenProtectionSuiteRunArtifact(
      fixture.paths[0]!,
    );

    expect(firstRun).toMatchObject({
      planPath: resolve(fixture.planPath),
      planSha256: fixture.loadedPlan.sha256,
      schemaVersion: 2,
    });
    if (firstRun.schemaVersion !== 2) {
      throw new Error("Expected a schema-v2 planned run.");
    }
    expect(firstRun.plannedRunSha256).toMatch(/^[a-f0-9]{64}$/);

    const unclosed = await buildPhase74FrozenProtectionSuiteEvidence({
      manifestPath: fixture.manifestPath,
      planPath: fixture.planPath,
      runArtifactPaths: fixture.paths,
    }, { verifiers: fixture.verifiers });
    expect(unclosed).toMatchObject({
      admission: "diagnostic",
      schemaVersion: 2,
      source: { executionReceipts: [] },
    });
    expect(isPhase74FrozenProtectionSuiteEvidencePromotionAdmissible(unclosed))
      .toBe(false);

    const liveClosureVerifier = createTestLiveClosureVerifier(root);
    const verifierSourcePath = join(root, "beam-verifier-contract.json");
    await writeFile(verifierSourcePath, "{}\n", "utf8");
    const evidence = await buildPhase74FrozenProtectionSuiteEvidence({
      manifestPath: fixture.manifestPath,
      planPath: fixture.planPath,
      runArtifactPaths: fixture.paths,
    }, {
      beamContractSourceFiles: [verifierSourcePath],
      liveClosureVerifier,
      verifiers: fixture.verifiers,
    });

    expect(fixture.paths).toHaveLength(15);
    expect(evidence).toMatchObject({
      admission: "diagnostic",
      schemaVersion: 2,
      source: {
        plan: {
          path: resolve(fixture.planPath),
          sha256: fixture.loadedPlan.sha256,
        },
      },
    });
    expect(isPhase74FrozenProtectionSuiteEvidencePromotionAdmissible(evidence))
      .toBe(false);
    if (evidence.schemaVersion !== 2) {
      throw new Error("Expected planned protection evidence.");
    }
    expect(evidence.source.suites.flatMap(({ files }) => files)).toHaveLength(15);
    expect(evidence.source.executionReceipts).toHaveLength(6);
    expect(evidence.source.beamContractSources).toEqual([
      {
        path: resolve(verifierSourcePath),
        sha256: sha256("{}\n"),
      },
    ]);
    expect(new Set(evidence.source.suites.flatMap(({ files }) =>
      files.map(({ plannedRunSha256 }) => plannedRunSha256)
    )).size).toBe(15);
    const evidencePath = join(root, "planned-evidence.json");
    await writeFile(
      evidencePath,
      `${JSON.stringify(evidence, null, 2)}\n`,
      "utf8",
    );
    const reloaded = await loadPhase74FrozenProtectionSuiteEvidence(
      evidencePath,
      {
        beamContractSourceFiles: [verifierSourcePath],
        liveClosureVerifier,
        verifiers: fixture.verifiers,
      },
    );
    expect(reloaded.evidence).toEqual(evidence);
    expect(
      isPhase74FrozenProtectionSuiteEvidencePromotionAdmissible(
        reloaded.evidence,
      ),
    ).toBe(false);

    const injectedOutputPath = join(root, "injected-planned-evidence.json");
    const injected = await runPhase74ProtectionEvidenceGeneration({
      manifestPath: fixture.manifestPath,
      outputPath: injectedOutputPath,
      planPath: fixture.planPath,
      runArtifactPaths: fixture.paths,
    }, {
      liveClosureVerifier,
      verifiers: fixture.verifiers,
    });
    expect(injected).toMatchObject({
      admission: "diagnostic",
      schemaVersion: 2,
    });
    expect(
      isPhase74FrozenProtectionSuiteEvidencePromotionAdmissible(injected),
    ).toBe(false);

    const budgetPath =
      evidence.source.executionReceipts[0]!.callBudgetArtifact.path;
    await writeFile(
      budgetPath,
      `${JSON.stringify({
        embeddingSpendLimitUsd: 0.5,
        maxLanguageCalls: 1_000,
        schemaVersion: 1,
      })}\n`,
      "utf8",
    );
    await expect(loadPhase74FrozenProtectionSuiteEvidence(
      evidencePath,
      {
        beamContractSourceFiles: [verifierSourcePath],
        liveClosureVerifier,
        verifiers: fixture.verifiers,
      },
    )).rejects.toThrow("call budget drifted");
  });

  it("requires canonical datasets, all 19 HaluMem users, and full rebuilt identities before sealing promotion", async () => {
    const root = await createRoot();
    const fixture = await createPlannedFixture(root);
    const canonical = canonicalizePlanIdentities(fixture.loadedPlan.plan);

    expect(() =>
      assertPhase74CanonicalProtectionPlanIdentities(
        canonical.plan,
        canonical.expected,
      )
    ).not.toThrow();

    const reducedHaluMem = structuredClone(canonical.plan);
    for (const run of reducedHaluMem.runs.filter(({ suite }) =>
      suite.id === PHASE74_HALUMEM_E4_SUITE.id
    )) {
      run.identity.population = {
        caseCount: 2,
        caseIdsSha256: "a".repeat(64),
        id: "HaluMem-Medium:two-users:question-population-v1",
      };
    }
    expect(() =>
      assertPhase74CanonicalProtectionPlanIdentities(
        reducedHaluMem,
        canonical.expected,
      )
    ).toThrow(/19-user|population/i);

    const unpinnedBeam = structuredClone(canonical.plan);
    for (const run of unpinnedBeam.runs.filter(({ suite }) =>
      suite.id === PHASE74_BEAM_SAFETY_SUITE.id
    )) {
      run.identity.dataset.sha256 = "b".repeat(64);
    }
    expect(() =>
      assertPhase74CanonicalProtectionPlanIdentities(
        unpinnedBeam,
        canonical.expected,
      )
    ).toThrow(/BEAM.*dataset/i);

    for (const field of ["model", "pipeline", "prompt"] as const) {
      const drifted = structuredClone(canonical.plan);
      drifted.runs.find(({ suite }) =>
        suite.id === PHASE74_HALUMEM_UPDATE_SUITE.id
      )!.identity[field] = descriptor(`drifted-${field}`);
      expect(() =>
        assertPhase74CanonicalProtectionPlanIdentities(
          drifted,
          canonical.expected,
        )
      ).toThrow(/full canonical identity/i);
    }
  });

  it("keeps planned diagnostic and unplanned schema-v1 evidence closed to promotion", async () => {
    const diagnosticRoot = await createRoot();
    const diagnostic = await createPlannedFixture(
      diagnosticRoot,
      "diagnostic",
    );
    const plannedEvidence = await buildPhase74FrozenProtectionSuiteEvidence({
      manifestPath: diagnostic.manifestPath,
      planPath: diagnostic.planPath,
      runArtifactPaths: diagnostic.paths,
    }, { verifiers: diagnostic.verifiers });
    expect(plannedEvidence).toMatchObject({
      admission: "diagnostic",
      schemaVersion: 2,
    });
    expect(
      isPhase74FrozenProtectionSuiteEvidencePromotionAdmissible(
        plannedEvidence,
      ),
    ).toBe(false);

    const unplannedRoot = await createRoot();
    const unplanned = await createCompleteFixture(unplannedRoot);
    const unplannedEvidence = await buildPhase74FrozenProtectionSuiteEvidence({
      manifestPath: unplanned.manifestPath,
      runArtifactPaths: unplanned.paths,
    }, { verifiers: unplanned.verifiers });
    expect(unplannedEvidence.schemaVersion).toBe(1);
    expect(
      isPhase74FrozenProtectionSuiteEvidencePromotionAdmissible(
        unplannedEvidence,
      ),
    ).toBe(false);
  });

  it("rejects missing, extra, mixed, and cross-plan schema-v2 evidence inputs", async () => {
    const root = await createRoot();
    const fixture = await createPlannedFixture(root);
    const unplanned = await createSuite({
      baseline: protectionScores(0.4),
      candidate: protectionScores(0.4),
      caseCount: 1,
      kind: "benchmark-protection",
      requiredMetrics: ["evidence_recall", "stale_avoidance"],
      root: join(root, "unplanned"),
      suiteId: "unplanned",
    });
    const build = (runArtifactPaths: readonly string[]) =>
      buildPhase74FrozenProtectionSuiteEvidence({
        manifestPath: fixture.manifestPath,
        planPath: fixture.planPath,
        runArtifactPaths,
      }, { verifiers: fixture.verifiers });

    await expect(build(fixture.paths.slice(1))).rejects.toThrow(
      /exactly 15|missing|planned/i,
    );
    await expect(build([...fixture.paths, unplanned.paths[0]!]))
      .rejects.toThrow(/exactly 15|extra|planned/i);
    await expect(build([
      ...fixture.paths.slice(0, -1),
      unplanned.paths[0]!,
    ])).rejects.toThrow(/planned|schema-v2|mixed/i);

    const driftedPath = fixture.paths[0]!;
    const drifted = JSON.parse(await readFile(driftedPath, "utf8"));
    drifted.planSha256 = "f".repeat(64);
    await writeFile(
      driftedPath,
      `${JSON.stringify(drifted, null, 2)}\n`,
      "utf8",
    );
    await expect(build(fixture.paths)).rejects.toThrow(/plan.*SHA|plan/i);
  });

  it("bounds case concurrency without changing per-case or artifact order", async () => {
    const root = await createRoot();
    const cases = [1, 2, 3].map((index) => ({
      caseId: `case-${index}`,
      input: { index },
    }));
    const events: string[] = [];
    const completionOrder: string[] = [];
    let activeCases = 0;
    let maxActiveCases = 0;

    const result = await runPhase74ProtectionSuiteCases({
      artifactPath: join(root, "concurrent", "run.json"),
      caseConcurrency: 2,
      cases,
      evaluate: async ({ branch, caseId, input }) => {
        events.push(`${caseId}:${branch}:start`);
        if (branch === "baseline") {
          activeCases += 1;
          maxActiveCases = Math.max(maxActiveCases, activeCases);
        }
        await new Promise((resolvePromise) => setTimeout(
          resolvePromise,
          input.index === 1 ? 20 : 1,
        ));
        events.push(`${caseId}:${branch}:end`);
        if (branch === "candidate") {
          activeCases -= 1;
          completionOrder.push(caseId);
        }
        return {
          rawOutput: { branch, caseId },
          scores: protectionScores(input.index / 10),
        };
      },
      identity: identity(
        "concurrent-suite",
        "concurrent-population",
        descriptor("concurrent-dataset"),
      ),
      rawArtifactPath: join(root, "concurrent", "raw.json"),
      replicate: 1,
      runId: "concurrent-run",
      suite: { id: "concurrent-suite", kind: "benchmark-protection" },
    });

    expect(maxActiveCases).toBe(2);
    expect(completionOrder).toEqual(["case-2", "case-3", "case-1"]);
    for (const { caseId } of cases) {
      expect(events.indexOf(`${caseId}:baseline:start`)).toBeLessThan(
        events.indexOf(`${caseId}:baseline:end`),
      );
      expect(events.indexOf(`${caseId}:baseline:end`)).toBeLessThan(
        events.indexOf(`${caseId}:candidate:start`),
      );
      expect(events.indexOf(`${caseId}:candidate:start`)).toBeLessThan(
        events.indexOf(`${caseId}:candidate:end`),
      );
    }
    expect(result.artifact.rows.map(({ caseId }) => caseId)).toEqual(
      cases.map(({ caseId }) => caseId),
    );
    const raw = JSON.parse(await readFile(result.rawArtifactPath, "utf8"));
    expect(raw.rows.map((row: { caseId: string }) => row.caseId)).toEqual(
      cases.map(({ caseId }) => caseId),
    );
  });

  it("defaults protection case concurrency to one", async () => {
    const root = await createRoot();
    let activeCases = 0;
    let maxActiveCases = 0;
    await runPhase74ProtectionSuiteCases({
      artifactPath: join(root, "default-concurrency", "run.json"),
      cases: [1, 2].map((index) => ({
        caseId: `case-${index}`,
        input: { index },
      })),
      evaluate: async ({ branch }) => {
        if (branch === "baseline") {
          activeCases += 1;
          maxActiveCases = Math.max(maxActiveCases, activeCases);
        } else {
          activeCases -= 1;
        }
        return {
          rawOutput: { branch },
          scores: protectionScores(0.5),
        };
      },
      identity: identity(
        "default-concurrency-suite",
        "default-concurrency-population",
        descriptor("default-concurrency-dataset"),
      ),
      rawArtifactPath: join(root, "default-concurrency", "raw.json"),
      replicate: 1,
      runId: "default-concurrency-run",
      suite: {
        id: "default-concurrency-suite",
        kind: "benchmark-protection",
      },
    });

    expect(maxActiveCases).toBe(1);
  });

  it("keeps concurrent execution failures deterministic and composability closed", async () => {
    const root = await createRoot();
    const artifactPath = join(root, "failures", "run.json");
    const rawArtifactPath = join(root, "failures", "raw.json");
    const evaluationCalls: string[] = [];
    await expect(runPhase74ProtectionSuiteCases({
      artifactPath,
      caseConcurrency: 3,
      cases: [1, 2, 3].map((index) => ({
        caseId: `case-${index}`,
        input: { index },
      })),
      evaluate: async ({ branch, caseId, input }) => {
        evaluationCalls.push(`${caseId}:${branch}`);
        if (caseId === "case-1" && branch === "candidate") {
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
          throw new Error("candidate failed");
        }
        if (caseId === "case-2" && branch === "baseline") {
          throw new Error("baseline failed");
        }
        return {
          rawOutput: { branch, input },
          scores: protectionScores(0.5),
        };
      },
      identity: identity(
        "failure-suite",
        "failure-population",
        descriptor("failure-dataset"),
      ),
      rawArtifactPath,
      replicate: 1,
      runId: "failure-run",
      suite: { id: "failure-suite", kind: "benchmark-protection" },
    })).rejects.toThrow("recorded 2 execution failures");

    const raw = JSON.parse(await readFile(rawArtifactPath, "utf8"));
    const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
    expect(raw.executionFailures).toBe(2);
    expect(raw.failures.map((failure: {
      branch: string;
      caseId: string;
    }) => [failure.caseId, failure.branch])).toEqual([
      ["case-1", "candidate"],
      ["case-2", "baseline"],
    ]);
    expect(evaluationCalls).not.toContain("case-2:candidate");
    expect(raw.rows.map((row: { caseId: string }) => row.caseId))
      .toEqual(["case-3"]);
    expect(artifact.executionFailures).toBe(2);
    expect(artifact.rows.map((row: { caseId: string }) => row.caseId))
      .toEqual(["case-3"]);
  });

  it("rejects invalid case concurrency before evaluation or artifact writes", async () => {
    const root = await createRoot();
    for (const [index, caseConcurrency] of [0, -1, 1.5, Number.NaN].entries()) {
      const artifactPath = join(root, `invalid-${index}`, "run.json");
      const rawArtifactPath = join(root, `invalid-${index}`, "raw.json");
      let evaluationCount = 0;
      await expect(runPhase74ProtectionSuiteCases({
        artifactPath,
        caseConcurrency,
        cases: [{ caseId: "case-1", input: {} }],
        evaluate: async () => {
          evaluationCount += 1;
          return {
            rawOutput: {},
            scores: protectionScores(0.5),
          };
        },
        identity: identity(
          "invalid-suite",
          "invalid-population",
          descriptor("invalid-dataset"),
        ),
        rawArtifactPath,
        replicate: 1,
        runId: `invalid-run-${index}`,
        suite: { id: "invalid-suite", kind: "benchmark-protection" },
      })).rejects.toThrow("caseConcurrency must be a positive integer");
      expect(evaluationCount).toBe(0);
      await expect(readFile(artifactPath, "utf8")).rejects.toThrow();
      await expect(readFile(rawArtifactPath, "utf8")).rejects.toThrow();
    }
  });

  it("composes three replicates per suite across different populations", async () => {
    const root = await createRoot();
    const fixture = await createCompleteFixture(root);
    const evidence = await buildPhase74FrozenProtectionSuiteEvidence({
      manifestPath: fixture.manifestPath,
      runArtifactPaths: fixture.paths,
    }, { verifiers: fixture.verifiers });

    expect(evidence.promotion.protections).toEqual([
      {
        delta: 0.05,
        name: phase74ProtectionSuiteMetricName("mab", "evidence_recall"),
      },
      {
        delta: 0.05,
        name: phase74ProtectionSuiteMetricName("mab", "stale_avoidance"),
      },
    ]);
    expect(Object.keys(evidence.e4.formatDeltas).sort()).toEqual(
      [...FORMATS].sort(),
    );
    for (const format of FORMATS) {
      expect(evidence.e4.formatDeltas[format]).toEqual([{
        delta: 0.02,
        name: phase74ProtectionSuiteMetricName(
          "e4-reader",
          "answer_quality",
        ),
      }]);
    }
    expect(evidence.promotion.safety).toEqual({
      abstentionAccuracyDelta: -0.01,
      hallucinationRateDelta: 0.01,
      privacyPassRateDelta: 0.01,
      updateCorrectnessDelta: 0,
    });
    expect(evidence.source.suites.map(({ caseCountPerReplicate }) =>
      caseCountPerReplicate
    )).toEqual([1, 2, 2, 3]);
  });

  it("writes and reloads suite evidence from one manifest and every suite replicate", async () => {
    const root = await createRoot();
    const fixture = await createCompleteFixture(root);
    const outputPath = join(root, "frozen-suite-evidence.json");
    let replayCount = 0;
    const evidence = await runPhase74ProtectionEvidenceGeneration({
      manifestPath: fixture.manifestPath,
      outputPath,
      runArtifactPaths: fixture.paths,
    }, {
      verifiers: fixture.verifiers,
      loadEvidence: async (path) => {
        replayCount += 1;
        expect(path).toBe(outputPath);
        return loadPhase74FrozenProtectionSuiteEvidence(path, {
          verifiers: fixture.verifiers,
        });
      },
    });
    const loaded = await loadPhase74FrozenProtectionSuiteEvidence(outputPath, {
      verifiers: fixture.verifiers,
    });

    expect(replayCount).toBe(1);
    expect(loaded.evidence).toEqual(evidence);
    expect(evidence.derivation).toMatchObject({
      replicateCountPerSuite: 3,
      suiteCount: 4,
    });
    expect(evidence.source.suites.every(({ files }) => files.length === 3))
      .toBe(true);
  });

  it("creates suite evidence output exactly once without replacing existing bytes", async () => {
    const root = await createRoot();
    const fixture = await createCompleteFixture(root);
    const outputPath = join(root, "frozen-suite-evidence.json");
    await writeFile(outputPath, "existing evidence\n", "utf8");

    await expect(runPhase74ProtectionEvidenceGeneration({
      manifestPath: fixture.manifestPath,
      outputPath,
      runArtifactPaths: fixture.paths,
    }, { verifiers: fixture.verifiers })).rejects.toThrow();
    expect(await readFile(outputPath, "utf8")).toBe("existing evidence\n");
  });

  it("parses one manifest and unique run paths without hard-coding suite count", async () => {
    const root = await createRoot();
    const fixture = await createCompleteFixture(root);
    const outputPath = join(root, "frozen-suite-evidence.json");
    const planPath = join(root, "protection-plan.json");

    expect(parsePhase74ProtectionEvidenceCliOptions([
      "bun",
      "script.ts",
      "--manifest",
      fixture.manifestPath,
      "--protection-plan",
      planPath,
      "--run-artifact",
      fixture.paths[0]!,
      "--output",
      outputPath,
    ])).toEqual({
      manifestPath: fixture.manifestPath,
      outputPath,
      planPath,
      runArtifactPaths: [fixture.paths[0]],
    });
    expect(() => parsePhase74ProtectionEvidenceCliOptions([
      "--run-artifact",
      fixture.paths[0]!,
      "--output",
      outputPath,
    ])).toThrow("requires exactly one --manifest");
    expect(() => parsePhase74ProtectionEvidenceCliOptions([
      "--manifest",
      fixture.manifestPath,
      "--manifest",
      fixture.manifestPath,
      "--run-artifact",
      fixture.paths[0]!,
      "--output",
      outputPath,
    ])).toThrow("--manifest cannot be specified more than once");
    expect(() => parsePhase74ProtectionEvidenceCliOptions([
      "--manifest",
      fixture.manifestPath,
      "--output",
      outputPath,
    ])).toThrow("at least one --run-artifact");
    expect(() => parsePhase74ProtectionEvidenceCliOptions([
      "--manifest",
      fixture.manifestPath,
      "--run-artifact",
      fixture.paths[0]!,
      "--run-artifact",
      fixture.paths[0]!,
      "--output",
      outputPath,
    ])).toThrow("--run-artifact paths must be unique");
    expect(() => parsePhase74ProtectionEvidenceCliOptions([
      "--manifest",
      fixture.manifestPath,
      "--run-artifact",
      fixture.paths[0]!,
      "--output",
      outputPath,
      "--delta",
      "0.1",
    ])).toThrow("unknown option --delta");
  });

  it("refuses to overwrite the manifest, a run artifact, or a raw artifact", async () => {
    const root = await createRoot();
    const fixture = await createCompleteFixture(root);
    const runPath = fixture.paths[0]!;
    const run = JSON.parse(await readFile(runPath, "utf8"));
    const rawPath = resolve(dirname(runPath), run.rawArtifact.path);
    const base = {
      manifestPath: fixture.manifestPath,
      runArtifactPaths: fixture.paths,
    };

    await expect(runPhase74ProtectionEvidenceGeneration({
      ...base,
      outputPath: fixture.manifestPath,
    }, { verifiers: fixture.verifiers })).rejects.toThrow(
      "must not overwrite the suite manifest",
    );
    await expect(runPhase74ProtectionEvidenceGeneration({
      ...base,
      outputPath: runPath,
    }, { verifiers: fixture.verifiers })).rejects.toThrow(
      "must not overwrite a frozen run artifact",
    );
    await expect(runPhase74ProtectionEvidenceGeneration({
      ...base,
      outputPath: rawPath,
    }, { verifiers: fixture.verifiers })).rejects.toThrow(
      "must not overwrite a frozen raw artifact",
    );
  });

  it("rejects missing, unexpected, duplicate, and replicate-drifted suites", async () => {
    const root = await createRoot();
    const fixture = await createCompleteFixture(root);
    await expect(buildPhase74FrozenProtectionSuiteEvidence({
      manifestPath: fixture.manifestPath,
      runArtifactPaths: fixture.paths.slice(3),
    }, { verifiers: fixture.verifiers })).rejects.toThrow(
      "missing required suite mab",
    );

    const unexpected = await createSuite({
      baseline: protectionScores(0.4),
      candidate: protectionScores(0.4),
      caseCount: 1,
      kind: "benchmark-protection",
      requiredMetrics: ["evidence_recall", "stale_avoidance"],
      root,
      suiteId: "unexpected",
    });
    await expect(buildPhase74FrozenProtectionSuiteEvidence({
      manifestPath: fixture.manifestPath,
      runArtifactPaths: [...fixture.paths, ...unexpected.paths],
    }, { verifiers: fixture.verifiers })).rejects.toThrow(
      "unexpected suite unexpected",
    );
    await expect(buildPhase74FrozenProtectionSuiteEvidence({
      manifestPath: fixture.manifestPath,
      runArtifactPaths: [...fixture.paths, fixture.paths[0]!],
    }, { verifiers: fixture.verifiers })).rejects.toThrow(
      "duplicate run artifact path",
    );

    const duplicateManifest = JSON.parse(await readFile(
      fixture.manifestPath,
      "utf8",
    ));
    duplicateManifest.suites.push(duplicateManifest.suites[0]);
    const duplicateManifestPath = join(root, "duplicate-manifest.json");
    await writeFile(
      duplicateManifestPath,
      `${JSON.stringify(duplicateManifest, null, 2)}\n`,
      "utf8",
    );
    await expect(buildPhase74FrozenProtectionSuiteEvidence({
      manifestPath: duplicateManifestPath,
      runArtifactPaths: fixture.paths,
    }, { verifiers: fixture.verifiers })).rejects.toThrow(
      "duplicate suite IDs",
    );

    const duplicateReplicatePath = join(
      dirname(fixture.suites[0]!.paths[0]!),
      "duplicate-replicate.json",
    );
    const duplicateReplicate = JSON.parse(await readFile(
      fixture.suites[0]!.paths[0]!,
      "utf8",
    ));
    await writeFile(
      duplicateReplicatePath,
      `${JSON.stringify(duplicateReplicate, null, 2)}\n`,
      "utf8",
    );
    await expect(buildPhase74FrozenProtectionSuiteEvidence({
      manifestPath: fixture.manifestPath,
      runArtifactPaths: [
        duplicateReplicatePath,
        fixture.suites[0]!.paths[0]!,
        fixture.suites[0]!.paths[1]!,
        ...fixture.paths.slice(3),
      ],
    }, { verifiers: fixture.verifiers })).rejects.toThrow(
      "replicates 1, 2, and 3 exactly once",
    );
  });

  it("requires a verifier-bound canonical manifest instead of trusting frozen scores", async () => {
    const root = await createRoot();
    const fixture = await createCompleteFixture(root);
    const legacyManifest = JSON.parse(await readFile(
      fixture.manifestPath,
      "utf8",
    ));
    delete legacyManifest.admission;
    legacyManifest.schemaVersion = 1;
    for (const suite of legacyManifest.suites) {
      delete suite.dataset;
      delete suite.verifierId;
    }
    const legacyManifestPath = join(root, "legacy-manifest.json");
    await writeFile(
      legacyManifestPath,
      `${JSON.stringify(legacyManifest, null, 2)}\n`,
      "utf8",
    );

    await expect(buildPhase74FrozenProtectionSuiteEvidence({
      manifestPath: legacyManifestPath,
      runArtifactPaths: fixture.paths,
    }, { verifiers: fixture.verifiers })).rejects.toThrow(
      "canonical verifier-bound admission",
    );
  });

  it("invokes the declared adapter verifier for every suite replicate", async () => {
    const root = await createRoot();
    const fixture = await createCompleteFixture(root);
    let verifyCount = 0;
    await buildPhase74FrozenProtectionSuiteEvidence({
      manifestPath: fixture.manifestPath,
      runArtifactPaths: fixture.paths,
    }, {
      verifiers: fixture.suites.map((suite) =>
        fixtureVerifier(suite, () => {
          verifyCount += 1;
        })
      ),
    });

    expect(verifyCount).toBe(fixture.paths.length);
  });

  it("binds verifier, required metrics, and exact dataset bytes in the blueprint", async () => {
    const unknownVerifier = await createCompleteFixture(await createRoot());
    const unknownManifest = JSON.parse(await readFile(
      unknownVerifier.manifestPath,
      "utf8",
    ));
    unknownManifest.suites[0].verifierId = "unregistered-verifier";
    await writeFile(
      unknownVerifier.manifestPath,
      `${JSON.stringify(unknownManifest, null, 2)}\n`,
      "utf8",
    );
    await expect(buildPhase74FrozenProtectionSuiteEvidence({
      manifestPath: unknownVerifier.manifestPath,
      runArtifactPaths: unknownVerifier.paths,
    }, { verifiers: unknownVerifier.verifiers })).rejects.toThrow(
      "requires exactly one registered verifier",
    );

    const metricDrift = await createCompleteFixture(await createRoot());
    const metricManifest = JSON.parse(await readFile(
      metricDrift.manifestPath,
      "utf8",
    ));
    metricManifest.suites[0].requiredMetrics = ["evidence_recall"];
    await writeFile(
      metricDrift.manifestPath,
      `${JSON.stringify(metricManifest, null, 2)}\n`,
      "utf8",
    );
    await expect(buildPhase74FrozenProtectionSuiteEvidence({
      manifestPath: metricDrift.manifestPath,
      runArtifactPaths: metricDrift.paths,
    }, { verifiers: metricDrift.verifiers })).rejects.toThrow(
      "canonical verifier binding drifted",
    );

    const datasetDrift = await createCompleteFixture(await createRoot());
    await writeFile(
      datasetDrift.suites[0]!.dataset.path,
      "tampered dataset\n",
      "utf8",
    );
    await expect(buildPhase74FrozenProtectionSuiteEvidence({
      manifestPath: datasetDrift.manifestPath,
      runArtifactPaths: datasetDrift.paths,
    }, { verifiers: datasetDrift.verifiers })).rejects.toThrow(
      "dataset SHA-256 drifted",
    );
  });

  it("rejects evaluator source drift across otherwise valid protection suites", async () => {
    const root = await createRoot();
    const fixture = await createCompleteFixture(root);
    const manifest = JSON.parse(await readFile(fixture.manifestPath, "utf8"));
    const driftedSuite = fixture.suites[1]!;
    for (const path of driftedSuite.paths) {
      const run = JSON.parse(await readFile(path, "utf8"));
      run.identity.source = descriptor("git:other-source");
      await writeFile(path, `${JSON.stringify(run, null, 2)}\n`, "utf8");
    }
    const firstRun = JSON.parse(await readFile(driftedSuite.paths[0]!, "utf8"));
    const manifestEntry = manifest.suites.find(
      ({ id }: { id: string }) => id === driftedSuite.suiteId,
    );
    manifestEntry.identityHash = hashPhase74ProtectionSuiteIdentity(
      firstRun.identity,
    );
    await writeFile(
      fixture.manifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );

    await expect(buildPhase74FrozenProtectionSuiteEvidence({
      manifestPath: fixture.manifestPath,
      runArtifactPaths: fixture.paths,
    }, { verifiers: fixture.verifiers })).rejects.toThrow(
      "evaluator source drift across suites",
    );
  });

  it("rejects identity, population, metric, and frozen source drift", async () => {
    const root = await createRoot();
    const fixture = await createCompleteFixture(root);
    for (const path of fixture.suites[0]!.paths) {
      const run = JSON.parse(await readFile(path, "utf8"));
      run.identity.source = descriptor("git:tampered-source");
      await writeFile(path, `${JSON.stringify(run, null, 2)}\n`, "utf8");
    }
    await expect(buildPhase74FrozenProtectionSuiteEvidence({
      manifestPath: fixture.manifestPath,
      runArtifactPaths: fixture.paths,
    }, { verifiers: fixture.verifiers })).rejects.toThrow(
      "identity hash does not match manifest",
    );

    const clean = await createCompleteFixture(await createRoot());
    const metricRun = JSON.parse(await readFile(clean.suites[0]!.paths[2]!, "utf8"));
    for (const row of metricRun.rows) {
      row.baseline.protections.renamed = row.baseline.protections.evidence_recall;
      row.candidate.protections.renamed = row.candidate.protections.evidence_recall;
      delete row.baseline.protections.evidence_recall;
      delete row.candidate.protections.evidence_recall;
    }
    const rawPath = join(clean.suites[0]!.paths[2]!, "../raw.json");
    const raw = JSON.parse(await readFile(rawPath, "utf8"));
    for (const row of raw.rows) {
      row.baseline.scores.protections.renamed =
        row.baseline.scores.protections.evidence_recall;
      row.candidate.scores.protections.renamed =
        row.candidate.scores.protections.evidence_recall;
      delete row.baseline.scores.protections.evidence_recall;
      delete row.candidate.scores.protections.evidence_recall;
    }
    const rawText = `${JSON.stringify(raw, null, 2)}\n`;
    await writeFile(rawPath, rawText, "utf8");
    metricRun.rawArtifact.sha256 = sha256(rawText);
    await writeFile(
      clean.suites[0]!.paths[2]!,
      `${JSON.stringify(metricRun, null, 2)}\n`,
      "utf8",
    );
    await expect(buildPhase74FrozenProtectionSuiteEvidence({
      manifestPath: clean.manifestPath,
      runArtifactPaths: clean.paths,
    }, { verifiers: clean.verifiers })).rejects.toThrow(
      "required metric population",
    );

    const populationFixture = await createCompleteFixture(await createRoot());
    const driftedPopulation = await createSuite({
      baseline: protectionScores(0.4),
      candidate: protectionScores(0.45),
      caseCount: 1,
      kind: "benchmark-protection",
      requiredMetrics: ["evidence_recall", "stale_avoidance"],
      root: join(root, "population-drift"),
      suiteId: "mab",
    });
    await expect(buildPhase74FrozenProtectionSuiteEvidence({
      manifestPath: populationFixture.manifestPath,
      runArtifactPaths: [
        ...populationFixture.suites[0]!.paths.slice(0, 2),
        driftedPopulation.paths[2]!,
        ...populationFixture.paths.slice(3),
      ],
    }, { verifiers: populationFixture.verifiers })).rejects.toThrow(
      "identity or population drift across replicates",
    );
  });

  it("replays the frozen manifest and source files when loading evidence", async () => {
    const root = await createRoot();
    const fixture = await createCompleteFixture(root);
    const artifactPath = join(root, "suite-evidence.json");
    const evidence = await buildPhase74FrozenProtectionSuiteEvidence({
      manifestPath: fixture.manifestPath,
      runArtifactPaths: fixture.paths,
    }, { verifiers: fixture.verifiers });
    await writeFile(artifactPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    await expect(loadPhase74FrozenProtectionSuiteEvidence(artifactPath, {
      verifiers: fixture.verifiers,
    }))
      .resolves.toMatchObject({ evidence });

    const tampered = JSON.parse(await readFile(artifactPath, "utf8"));
    tampered.source.suites[0].files[0].artifactSha256 = "0".repeat(64);
    await writeFile(artifactPath, `${JSON.stringify(tampered, null, 2)}\n`, "utf8");
    await expect(loadPhase74FrozenProtectionSuiteEvidence(artifactPath, {
      verifiers: fixture.verifiers,
    }))
      .rejects.toThrow("does not match its manifest and source runs");
  });
});
