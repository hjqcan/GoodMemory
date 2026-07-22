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
  parsePhase74HaluMemJsonl,
  selectPhase74HaluMemUsers,
  verifyPhase74HaluMemE4ProtectionArtifact,
  verifyPhase74HaluMemPrivacyProtectionArtifact,
  verifyPhase74HaluMemUpdateProtectionArtifact,
} from "../src/eval/phase74HaluMemProtectionVerifier";
import type {
  Phase74HaluMemProtectionConfiguration,
} from "../src/eval/phase74HaluMemProtectionVerifier";
import {
  capturePhase74EvaluatorSource,
} from "../src/eval/phase74Live";
import type {
  Phase74EvaluatorSource,
} from "../src/eval/phase74Live";
import type {
  Phase74ProtectionReplicate,
} from "../src/eval/phase74ProtectionContracts";
import type {
  Phase74ProtectionSuiteRunResult,
} from "../src/eval/phase74ProtectionRun";

export const PHASE74_HALUMEM_UPDATE_NOT_EVALUABLE_REASON =
  "Pinned upstream HaluMem per-item update decisions are unavailable.";

export interface Phase74HaluMemProtectionCliOptions {
  caseConcurrency?: number;
  datasetId: string;
  datasetPath: string;
  e4Configuration: Phase74HaluMemProtectionConfiguration;
  outputDir: string;
  replicate: Phase74ProtectionReplicate;
  runId: string;
  safetyConfiguration: Phase74HaluMemProtectionConfiguration;
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
    outputDir: resolve(requiredFlag(args, "--output-dir")),
    replicate: parseReplicate(requiredFlag(args, "--replicate")),
    runId,
    safetyConfiguration: parseConfiguration(
      requiredFlag(args, "--safety-configuration-json"),
      "safety configuration",
    ),
    userUuids,
  };
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function runPhase74HaluMemProtectionCli(
  options: Phase74HaluMemProtectionCliOptions,
  dependencies: Phase74HaluMemProtectionCliDependencies,
): Promise<Phase74HaluMemProtectionCliResult> {
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
  const runDirectory = join(options.outputDir, options.runId);
  const e4 = await runPhase74HaluMemE4Protection({
    artifactPath: join(runDirectory, "e4", "protection-run.json"),
    caseConcurrency: options.caseConcurrency,
    configuration: options.e4Configuration,
    dataset,
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
    caseConcurrency: options.caseConcurrency,
    configuration: options.safetyConfiguration,
    dataset,
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
    configuration: options.safetyConfiguration,
    dataset,
    source,
    users,
  });

  if (
    options.safetyConfiguration.updateEvaluator === undefined ||
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
    caseConcurrency: options.caseConcurrency,
    configuration: options.safetyConfiguration,
    dataset,
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
    configuration: options.safetyConfiguration,
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
