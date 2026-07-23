import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  assertCliPathSegmentValue,
  resolveCliFlagValueStrict,
} from "./cli-options";
import {
  runPhase74HaluMemE4Protection,
  runPhase74HaluMemPrivacyProtection,
  runPhase74HaluMemUpdateProtection,
} from "./phase-74-halumem-protection";
import type {
  Phase74HaluMemE4Dependencies,
  Phase74HaluMemPrivacyDependencies,
  Phase74HaluMemUpdateDependencies,
} from "./phase-74-halumem-protection";
import { resolveRepoRootFromScriptUrl } from "./script-paths";
import {
  assertPhase74HaluMemConfiguration,
  buildPhase74HaluMemE4RunIdentity,
  buildPhase74HaluMemPrivacyPopulation,
  buildPhase74HaluMemPrivacyRunIdentity,
  buildPhase74HaluMemQuestionPopulation,
  buildPhase74HaluMemUpdatePopulation,
  buildPhase74HaluMemUpdateRunIdentity,
  PHASE74_HALUMEM_CONTEXT_TOKEN_BUDGET,
  PHASE74_HALUMEM_E4_PROTECTION_VERIFIER_ID,
  PHASE74_HALUMEM_E4_SUITE,
  PHASE74_HALUMEM_PRIVACY_PROTECTION_VERIFIER_ID,
  PHASE74_HALUMEM_PRIVACY_SUITE,
  PHASE74_HALUMEM_UPDATE_PROTECTION_VERIFIER_ID,
  PHASE74_HALUMEM_UPDATE_SUITE,
  phase74HaluMemPrivacyPopulationId,
  phase74HaluMemQuestionPopulationId,
  phase74HaluMemUpdatePopulationId,
  parsePhase74HaluMemJsonl,
  selectPhase74HaluMemUsers,
  verifyPhase74HaluMemE4ProtectionArtifact,
  verifyPhase74HaluMemPrivacyProtectionArtifact,
  verifyPhase74HaluMemUpdateProtectionArtifact,
} from "../src/eval/phase74HaluMemProtectionVerifier";
import type {
  Phase74HaluMemProtectionConfiguration,
  Phase74HaluMemUser,
} from "../src/eval/phase74HaluMemProtectionVerifier";
import {
  capturePhase74EvaluatorSource,
} from "../src/eval/phase74Live";
import type {
  Phase74EvaluatorSource,
} from "../src/eval/phase74Live";
import type {
  Phase74ProtectionIdentityDescriptor,
  Phase74ProtectionReplicate,
  Phase74ProtectionRunIdentity,
} from "../src/eval/phase74ProtectionContracts";
import {
  hashPhase74ProtectionCaseIds,
} from "../src/eval/phase74ProtectionContracts";
import {
  describePhase74ProtectionCallBudget,
  loadPhase74ProtectionPlan,
  verifyPhase74ProtectionPlanRun,
} from "../src/eval/phase74ProtectionPlan";
import type {
  LoadedPhase74ProtectionPlan,
  Phase74ProtectionPlanControls,
} from "../src/eval/phase74ProtectionPlan";
import {
  PHASE74_PROTECTION_BLUEPRINT_ID,
} from "../src/eval/phase74ProtectionVerifier";
import {
  hashPhase74ProtectionValue,
} from "../src/eval/phase74ProtectionRun";
import type {
  Phase74ProtectionRunIdentityInput,
  Phase74ProtectionRunPlanInput,
  Phase74ProtectionSuite,
  Phase74ProtectionSuiteRunResult,
} from "../src/eval/phase74ProtectionRun";

export const PHASE74_HALUMEM_UPDATE_NOT_EVALUABLE_REASON =
  "Pinned upstream HaluMem per-item update decisions are unavailable.";

export interface Phase74HaluMemProtectionCliOptions {
  caseConcurrency?: number;
  datasetId: string;
  datasetPath: string;
  e4Configuration: Phase74HaluMemProtectionConfiguration;
  embeddingSpendLimitUsd?: number;
  maxLanguageCalls?: number;
  outputDir: string;
  privacyConfiguration: Phase74HaluMemProtectionConfiguration;
  protectionPlanPath?: string;
  replicate: Phase74ProtectionReplicate;
  runId: string;
  updateConfiguration: Phase74HaluMemProtectionConfiguration;
  userUuids: string[];
}

export interface Phase74HaluMemProtectionCliDependencies {
  captureEvaluatorSource?(input: {
    repoRoot: string;
  }): Promise<Phase74EvaluatorSource>;
  e4: Phase74HaluMemE4Dependencies;
  privacy: Phase74HaluMemPrivacyDependencies;
  readDataset?(path: string): Promise<Uint8Array>;
  update?: Phase74HaluMemUpdateDependencies;
  verifyE4?: typeof verifyPhase74HaluMemE4ProtectionArtifact;
  verifyPrivacy?: typeof verifyPhase74HaluMemPrivacyProtectionArtifact;
  verifyUpdate?: typeof verifyPhase74HaluMemUpdateProtectionArtifact;
}

export interface Phase74HaluMemProtectionCliResult {
  e4: Phase74ProtectionSuiteRunResult;
  privacy: Phase74ProtectionSuiteRunResult;
  update:
    | {
        result: Phase74ProtectionSuiteRunResult;
        status: "completed";
      }
    | {
        reason: typeof PHASE74_HALUMEM_UPDATE_NOT_EVALUABLE_REASON;
        status: "not_evaluable";
      };
}

function requiredFlag(args: readonly string[], flag: string): string {
  const value = resolveCliFlagValueStrict(args, flag);
  if (value === undefined || value === "" || value.trim() !== value) {
    throw new Error(`Phase 74 HaluMem protection requires ${flag}.`);
  }
  return value;
}

function parseReplicate(value: string): Phase74ProtectionReplicate {
  if (value !== "1" && value !== "2" && value !== "3") {
    throw new Error("--replicate must be 1, 2, or 3.");
  }
  return Number(value) as Phase74ProtectionReplicate;
}

function positiveNumber(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive number.`);
  }
  return parsed;
}

function positiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return parsed;
}

function parseConfiguration(
  value: string,
  label: string,
): Phase74HaluMemProtectionConfiguration {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch (error) {
    throw new Error(`Phase 74 HaluMem ${label} must be valid JSON.`, {
      cause: error,
    });
  }
  assertPhase74HaluMemConfiguration(
    parsed as Phase74HaluMemProtectionConfiguration,
  );
  return parsed as Phase74HaluMemProtectionConfiguration;
}

export function parsePhase74HaluMemProtectionCliOptions(
  args: readonly string[],
): Phase74HaluMemProtectionCliOptions {
  if (["--source-id", "--source-commit", "--source-sha256"].some((flag) =>
    args.includes(flag)
  )) {
    throw new Error(
      "Phase 74 HaluMem protection source identity is computed from the checkout.",
    );
  }
  const runId = requiredFlag(args, "--run-id");
  assertCliPathSegmentValue({ flag: "--run-id", value: runId });
  const protectionPlanPath = resolveCliFlagValueStrict(
    args,
    "--protection-plan",
  );
  const userUuids = requiredFlag(args, "--user-uuids")
    .split(",")
    .map((value) => value.trim());
  if (
    userUuids.length < 2 ||
    userUuids.some((value) => value === "") ||
    new Set(userUuids).size !== userUuids.length
  ) {
    throw new Error("--user-uuids must contain at least two unique UUIDs.");
  }
  return {
    ...(resolveCliFlagValueStrict(args, "--case-concurrency") === undefined
      ? {}
      : {
          caseConcurrency: (() => {
            const value = Number(requiredFlag(args, "--case-concurrency"));
            if (!Number.isSafeInteger(value) || value <= 0) {
              throw new Error("--case-concurrency must be a positive integer.");
            }
            return value;
          })(),
        }),
    datasetId: requiredFlag(args, "--dataset-id"),
    datasetPath: resolve(requiredFlag(args, "--dataset-path")),
    e4Configuration: parseConfiguration(
      requiredFlag(args, "--e4-configuration-json"),
      "E4 configuration",
    ),
    ...(protectionPlanPath === undefined
      ? {}
      : {
          embeddingSpendLimitUsd: positiveNumber(
            requiredFlag(args, "--embedding-spend-limit-usd"),
            "--embedding-spend-limit-usd",
          ),
          maxLanguageCalls: positiveInteger(
            requiredFlag(args, "--max-language-calls"),
            "--max-language-calls",
          ),
          protectionPlanPath: resolve(protectionPlanPath),
        }),
    outputDir: resolve(requiredFlag(args, "--output-dir")),
    privacyConfiguration: parseConfiguration(
      requiredFlag(args, "--privacy-configuration-json"),
      "privacy configuration",
    ),
    replicate: parseReplicate(requiredFlag(args, "--replicate")),
    runId,
    updateConfiguration: parseConfiguration(
      requiredFlag(args, "--update-configuration-json"),
      "update configuration",
    ),
    userUuids,
  };
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export interface Phase74HaluMemPreparedProtectionPlan {
  e4: Phase74ProtectionRunPlanInput;
  privacy: Phase74ProtectionRunPlanInput;
  update: Phase74ProtectionRunPlanInput;
}

function canonicalVerifier(
  id: string,
): Phase74ProtectionIdentityDescriptor {
  return {
    id,
    sha256: hashPhase74ProtectionValue({ id }),
  };
}

function completeIdentity(
  input: Phase74ProtectionRunIdentityInput,
  caseIds: readonly string[],
): Phase74ProtectionRunIdentity {
  const { populationId, ...identity } = input;
  return {
    ...identity,
    population: {
      caseCount: caseIds.length,
      caseIdsSha256: hashPhase74ProtectionCaseIds(caseIds),
      id: populationId,
    },
  };
}

function preparedRun(input: {
  caseIds: readonly string[];
  controls: Phase74ProtectionPlanControls;
  identity: Phase74ProtectionRunIdentityInput;
  loadedPlan: LoadedPhase74ProtectionPlan;
  replicate: Phase74ProtectionReplicate;
  runId: string;
  suite: Phase74ProtectionSuite;
  verifierId: string;
}): Phase74ProtectionRunPlanInput {
  const protectionBlueprint = input.loadedPlan.plan.protectionBlueprint;
  if (protectionBlueprint.id !== PHASE74_PROTECTION_BLUEPRINT_ID) {
    throw new Error(
      "Phase 74 HaluMem protection plan blueprint is not canonical.",
    );
  }
  const verifier = canonicalVerifier(input.verifierId);
  verifyPhase74ProtectionPlanRun(input.loadedPlan, {
    caseIds: input.caseIds,
    controls: input.controls,
    identity: completeIdentity(input.identity, input.caseIds),
    protectionBlueprint,
    replicate: input.replicate,
    runId: input.runId,
    suite: input.suite,
    verifier,
  });
  return {
    controls: input.controls,
    loadedPlan: input.loadedPlan,
    protectionBlueprint,
    verifier,
  };
}

export async function preparePhase74HaluMemProtectionPlan(input: {
  caseConcurrency: number;
  dataset: Phase74ProtectionIdentityDescriptor;
  e4Configuration: Phase74HaluMemProtectionConfiguration;
  embeddingSpendLimitUsd: number;
  maxLanguageCalls: number;
  planPath: string;
  privacyConfiguration: Phase74HaluMemProtectionConfiguration;
  replicate: Phase74ProtectionReplicate;
  runId: string;
  source: Phase74ProtectionIdentityDescriptor;
  updateConfiguration: Phase74HaluMemProtectionConfiguration;
  users: readonly Phase74HaluMemUser[];
}): Promise<Phase74HaluMemPreparedProtectionPlan> {
  if (
    !Number.isSafeInteger(input.caseConcurrency) ||
    input.caseConcurrency <= 0
  ) {
    throw new Error(
      "Phase 74 HaluMem planned caseConcurrency must be positive.",
    );
  }
  const loadedPlan = await loadPhase74ProtectionPlan(input.planPath);
  const controls = {
    callBudget: describePhase74ProtectionCallBudget({
      embeddingSpendLimitUsd: input.embeddingSpendLimitUsd,
      maxLanguageCalls: input.maxLanguageCalls,
    }),
    caseConcurrency: input.caseConcurrency,
    renderedContextTokens: PHASE74_HALUMEM_CONTEXT_TOKEN_BUDGET,
  };
  const e4Population = buildPhase74HaluMemQuestionPopulation(input.users);
  const updatePopulation = buildPhase74HaluMemUpdatePopulation(input.users);
  const privacyPopulation = buildPhase74HaluMemPrivacyPopulation(input.users);
  const prepare = (
    caseIds: string[],
    identity: Phase74ProtectionRunIdentityInput,
    suffix: "e4" | "privacy" | "update",
    suite: Phase74ProtectionSuite,
    verifierId: string,
  ) =>
    preparedRun({
      caseIds,
      controls,
      identity,
      loadedPlan,
      replicate: input.replicate,
      runId: `${input.runId}-${suffix}`,
      suite,
      verifierId,
    });
  return {
    e4: prepare(
      e4Population.cases.map(({ caseId }) => caseId),
      buildPhase74HaluMemE4RunIdentity({
        configuration: input.e4Configuration,
        dataset: input.dataset,
        populationId: phase74HaluMemQuestionPopulationId(
          input.dataset.id,
          input.users,
        ),
        source: input.source,
      }),
      "e4",
      PHASE74_HALUMEM_E4_SUITE,
      PHASE74_HALUMEM_E4_PROTECTION_VERIFIER_ID,
    ),
    privacy: prepare(
      privacyPopulation.cases.map(({ caseId }) => caseId),
      buildPhase74HaluMemPrivacyRunIdentity({
        configuration: input.privacyConfiguration,
        dataset: input.dataset,
        populationId: phase74HaluMemPrivacyPopulationId(
          input.dataset.id,
          input.users,
        ),
        source: input.source,
      }),
      "privacy",
      PHASE74_HALUMEM_PRIVACY_SUITE,
      PHASE74_HALUMEM_PRIVACY_PROTECTION_VERIFIER_ID,
    ),
    update: prepare(
      updatePopulation.cases.map(({ caseId }) => caseId),
      buildPhase74HaluMemUpdateRunIdentity({
        configuration: input.updateConfiguration,
        dataset: input.dataset,
        populationId: phase74HaluMemUpdatePopulationId(
          input.dataset.id,
          input.users,
        ),
        source: input.source,
      }),
      "update",
      PHASE74_HALUMEM_UPDATE_SUITE,
      PHASE74_HALUMEM_UPDATE_PROTECTION_VERIFIER_ID,
    ),
  };
}

export async function runPhase74HaluMemProtectionCli(
  options: Phase74HaluMemProtectionCliOptions,
  dependencies: Phase74HaluMemProtectionCliDependencies,
): Promise<Phase74HaluMemProtectionCliResult> {
  if (options.privacyConfiguration.updateEvaluator !== undefined) {
    throw new Error(
      "Phase 74 HaluMem privacy configuration cannot carry an update evaluator.",
    );
  }
  const datasetBytes = await (dependencies.readDataset ?? readFile)(
    options.datasetPath,
  );
  const allUsers = parsePhase74HaluMemJsonl(
    Buffer.from(datasetBytes).toString("utf8"),
    options.datasetPath,
  );
  const users = selectPhase74HaluMemUsers(allUsers, options.userUuids);
  const evaluatorSource = await (
    dependencies.captureEvaluatorSource ?? capturePhase74EvaluatorSource
  )({ repoRoot: resolveRepoRootFromScriptUrl(import.meta.url) });
  const dataset = {
    id: options.datasetId,
    sha256: sha256(datasetBytes),
  };
  const source = {
    id: `git:${evaluatorSource.commit}`,
    sha256: evaluatorSource.sha256,
  };
  const caseConcurrency = options.caseConcurrency ?? 1;
  let planned: Phase74HaluMemPreparedProtectionPlan | undefined;
  if (options.protectionPlanPath !== undefined) {
    if (
      options.embeddingSpendLimitUsd === undefined ||
      options.maxLanguageCalls === undefined
    ) {
      throw new Error(
        "Phase 74 planned HaluMem protection requires the actual embedding and language call budgets.",
      );
    }
    if (
      options.updateConfiguration.updateEvaluator === undefined ||
      dependencies.update?.evaluateUpdate === undefined
    ) {
      throw new Error(
        "Phase 74 planned HaluMem protection requires completed update evidence.",
      );
    }
    planned = await preparePhase74HaluMemProtectionPlan({
      caseConcurrency,
      dataset,
      e4Configuration: options.e4Configuration,
      embeddingSpendLimitUsd: options.embeddingSpendLimitUsd,
      maxLanguageCalls: options.maxLanguageCalls,
      planPath: options.protectionPlanPath,
      privacyConfiguration: options.privacyConfiguration,
      replicate: options.replicate,
      runId: options.runId,
      source,
      updateConfiguration: options.updateConfiguration,
      users,
    });
  }
  const runDirectory = join(options.outputDir, options.runId);
  const e4 = await runPhase74HaluMemE4Protection({
    artifactPath: join(runDirectory, "e4", "protection-run.json"),
    caseConcurrency,
    configuration: options.e4Configuration,
    dataset,
    plan: planned?.e4,
    rawArtifactPath: join(runDirectory, "e4", "raw.json"),
    replicate: options.replicate,
    runId: `${options.runId}-e4`,
    source,
    users,
  }, dependencies.e4);
  await (dependencies.verifyE4 ?? verifyPhase74HaluMemE4ProtectionArtifact)({
    artifactPath: e4.artifactPath,
    configuration: options.e4Configuration,
    dataset,
    source,
    users,
  });

  const privacy = await runPhase74HaluMemPrivacyProtection({
    artifactPath: join(runDirectory, "privacy", "protection-run.json"),
    caseConcurrency,
    configuration: options.privacyConfiguration,
    dataset,
    plan: planned?.privacy,
    rawArtifactPath: join(runDirectory, "privacy", "raw.json"),
    replicate: options.replicate,
    runId: `${options.runId}-privacy`,
    source,
    users,
  }, dependencies.privacy);
  await (
    dependencies.verifyPrivacy ?? verifyPhase74HaluMemPrivacyProtectionArtifact
  )({
    artifactPath: privacy.artifactPath,
    configuration: options.privacyConfiguration,
    dataset,
    source,
    users,
  });

  if (
    options.updateConfiguration.updateEvaluator === undefined ||
    dependencies.update?.evaluateUpdate === undefined
  ) {
    return {
      e4,
      privacy,
      update: {
        reason: PHASE74_HALUMEM_UPDATE_NOT_EVALUABLE_REASON,
        status: "not_evaluable",
      },
    };
  }

  const update = await runPhase74HaluMemUpdateProtection({
    artifactPath: join(runDirectory, "update", "protection-run.json"),
    caseConcurrency,
    configuration: options.updateConfiguration,
    dataset,
    plan: planned?.update,
    rawArtifactPath: join(runDirectory, "update", "raw.json"),
    replicate: options.replicate,
    runId: `${options.runId}-update`,
    source,
    users,
  }, dependencies.update);
  await (
    dependencies.verifyUpdate ?? verifyPhase74HaluMemUpdateProtectionArtifact
  )({
    artifactPath: update.artifactPath,
    configuration: options.updateConfiguration,
    dataset,
    source,
    users,
  });
  return { e4, privacy, update: { result: update, status: "completed" } };
}

if (import.meta.main) {
  process.stderr.write([
    "Phase 74 HaluMem protection requires injected retrieval, answer, and judge providers.",
    `Import ${join(dirname(import.meta.path), "run-phase-74-halumem-protection.ts")} and call runPhase74HaluMemProtectionCli with explicit dependencies.`,
    "No provider calls were made.",
  ].join("\n") + "\n");
  process.exitCode = 1;
}
