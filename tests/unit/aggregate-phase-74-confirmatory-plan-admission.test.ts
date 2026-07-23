import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "bun:test";

import {
  buildPhase74ConfirmatoryPlan,
  hashPhase74ConfirmatoryPlan,
} from "../../src/eval/phase74ConfirmatoryPlan";

const roots: string[] = [];
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);
const SHA_D = "d".repeat(64);
const SHA_E = "e".repeat(64);
const SHA_F = "f".repeat(64);
const ANCHOR_COMMIT = "8".repeat(40);
const HEAD_COMMIT = "9".repeat(40);
const GIT_ANCHOR = {
  commit: ANCHOR_COMMIT,
  executionCommit: HEAD_COMMIT,
  path: "reports/quality-gates/phase-74/confirmatory-plan.json",
  remote: "origin" as const,
  remoteRef: "refs/heads/main" as const,
  remoteUrl: "https://github.com/hjqcan/GoodMemory.git" as const,
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, {
    force: true,
    recursive: true,
  })));
});

function buildPlan(embeddingModel: "baai/bge-m3" | "text-embedding-3-small" = "baai/bge-m3") {
  return buildPhase74ConfirmatoryPlan({
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
      model: embeddingModel,
      provider: "openai",
    },
    evaluatorSource: {
      commit: "7".repeat(40),
      sha256: SHA_A,
    },
    families: [
      {
        benchmark: "locomo",
        population: {
          authority: "presealed-full-population",
          caseCount: 1_000,
          selectedCaseIdsSha256: SHA_A,
          selectedCaseKeysSha256: SHA_C,
        },
        parentDataset: {
          adaptedCasesSha256: SHA_D,
          caseCount: 1_000,
          datasetSha256: SHA_E,
          memoryGroupCount: 100,
          normalizedFingerprint: SHA_F,
          selectedCaseIdsSha256: SHA_A,
          sourceSha256: SHA_B,
        },
        seenCasesOnly: true,
      },
      {
        benchmark: "longmemeval",
        population: {
          authority: "presealed-full-population",
          caseCount: 1_000,
          selectedCaseIdsSha256: SHA_B,
          selectedCaseKeysSha256: SHA_D,
        },
        parentDataset: {
          adaptedCasesSha256: SHA_E,
          caseCount: 1_000,
          datasetSha256: SHA_F,
          memoryGroupCount: 100,
          normalizedFingerprint: SHA_A,
          selectedCaseIdsSha256: SHA_B,
          sourceSha256: SHA_C,
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
      sha256: SHA_D,
    },
    renderedContextTokens: 6_000,
    reranker: {
      gateway: "https://ai.gurkiai.com/v1",
      implementation: "provider-listwise-v1",
      mode: "provider",
      model: "gpt-5.6-terra",
      provider: "openai",
    },
  });
}

async function createRunDirectory() {
  const root = await mkdtemp(join(tmpdir(), "goodmemory-phase74-confirmatory-plan-"));
  roots.push(root);
  return root;
}

async function writePlan(runDirectory: string, plan: unknown): Promise<void> {
  await writeFile(
    join(runDirectory, "confirmatory-plan.json"),
    `${JSON.stringify(plan, null, 2)}\n`,
    "utf8",
  );
}

type ConfirmatoryAggregateAdmission = (input: {
  identity: {
    configuration: {
      confirmatoryPlan: {
        artifactKind: "phase74-full-family-confirmatory-plan";
        gitAnchor: typeof GIT_ANCHOR;
        sha256: string;
      };
      seenCasesOnly: boolean;
    };
  };
  gitAnchorDependencies: {
    isAncestor(): Promise<boolean>;
    readGitBlob(): Promise<string>;
    resolveGitHead(): Promise<string>;
    resolvePlanCommit(): Promise<string>;
    resolveRemoteRef(): Promise<string>;
  };
  observedRun: {
    identity: unknown;
    identitySha256: string;
    runId: string;
    stage: "E1" | "E2" | "E3" | "E4";
  };
  repoRoot: string;
  runDirectory: string;
}) => Promise<void>;

async function assertConfirmatoryAdmission(
  input: Parameters<ConfirmatoryAggregateAdmission>[0],
): Promise<void> {
  const aggregate = await import(
    "../../scripts/aggregate-phase-74-generalization"
  ) as typeof import("../../scripts/aggregate-phase-74-generalization") & {
    assertPhase74ConfirmatoryAggregateAdmission?:
      ConfirmatoryAggregateAdmission;
  };
  return aggregate.assertPhase74ConfirmatoryAggregateAdmission!(input);
}

function admissionInput(input: {
  plan?: ReturnType<typeof buildPlan>;
  runDirectory: string;
  runOverride?: Partial<{
    identity: unknown;
    identitySha256: string;
    runId: string;
    stage: "E1" | "E2" | "E3" | "E4";
  }>;
  sha256?: string;
}) {
  const plan = input.plan ?? buildPlan();
  const run = plan.runs.find(
    ({ benchmark, replicate, stage }) =>
      benchmark === "locomo" && replicate === 2 && stage === "E3",
  )!;
  return {
    gitAnchorDependencies: {
      isAncestor: async () => true,
      readGitBlob: async () => readFile(
        join(input.runDirectory, "confirmatory-plan.json"),
        "utf8",
      ),
      resolveGitHead: async () => HEAD_COMMIT,
      resolvePlanCommit: async () => ANCHOR_COMMIT,
      resolveRemoteRef: async () => ANCHOR_COMMIT,
    },
    identity: {
      configuration: {
        confirmatoryPlan: {
          artifactKind: "phase74-full-family-confirmatory-plan" as const,
          gitAnchor: GIT_ANCHOR,
          sha256: input.sha256 ?? hashPhase74ConfirmatoryPlan(plan),
        },
        seenCasesOnly: true,
      },
    },
    observedRun: {
      identity: input.runOverride?.identity ?? run.identity,
      identitySha256: input.runOverride?.identitySha256 ?? run.identitySha256,
      runId: input.runOverride?.runId ?? run.runId,
      stage: input.runOverride?.stage ?? run.stage,
    },
    repoRoot: "/repo",
    runDirectory: input.runDirectory,
  };
}

describe("Phase 74 confirmatory-plan aggregation admission", () => {
  it("admits seen-case confirmatory evidence only after re-verifying its Git anchor", async () => {
    const runDirectory = await createRunDirectory();
    const plan = buildPlan();
    await writePlan(runDirectory, plan);
    const input = admissionInput({ plan, runDirectory });
    let readGitBlobCalls = 0;

    await expect(assertConfirmatoryAdmission({
      ...input,
      gitAnchorDependencies: {
        ...input.gitAnchorDependencies,
        readGitBlob: async () => {
          readGitBlobCalls += 1;
          return readFile(join(runDirectory, "confirmatory-plan.json"), "utf8");
        },
      },
    })).resolves.toBeUndefined();
    expect(readGitBlobCalls).toBe(2);
  });

  it("fails closed when a confirmatory run has no persisted plan", async () => {
    const runDirectory = await createRunDirectory();

    await expect(assertConfirmatoryAdmission(admissionInput({ runDirectory })))
      .rejects.toThrow(/confirmatory.*plan/i);
  });

  it("rejects a confirmatory plan forged as unseen evidence", async () => {
    const runDirectory = await createRunDirectory();
    const plan = buildPlan();
    await writePlan(runDirectory, plan);
    const input = admissionInput({ plan, runDirectory });

    await expect(assertConfirmatoryAdmission({
      ...input,
      identity: {
        configuration: {
          ...input.identity.configuration,
          seenCasesOnly: false,
        },
      },
    })).rejects.toThrow(/seenCasesOnly=true/i);
  });

  it("fails closed when the persisted plan hash differs from the run identity", async () => {
    const runDirectory = await createRunDirectory();
    const plan = buildPlan();
    await writePlan(runDirectory, plan);

    await expect(assertConfirmatoryAdmission(admissionInput({
      plan,
      runDirectory,
      sha256: SHA_F,
    }))).rejects.toThrow(/plan.*sha|sha.*plan|hash/i);
  });

  it("fails closed when a plan profile no longer matches the observed run identity", async () => {
    const runDirectory = await createRunDirectory();
    const plan = buildPlan();
    const drifted = buildPlan("text-embedding-3-small");
    await writePlan(runDirectory, drifted);

    await expect(assertConfirmatoryAdmission(admissionInput({
      plan,
      runDirectory,
      sha256: hashPhase74ConfirmatoryPlan(drifted),
    }))).rejects.toThrow(/identity.*drift|profile.*drift|plan/i);
  });

  it("fails closed when an observed stage or run ID is outside the presealed matrix", async () => {
    const runDirectory = await createRunDirectory();
    const plan = buildPlan();
    await writePlan(runDirectory, plan);

    await expect(assertConfirmatoryAdmission(admissionInput({
      plan,
      runDirectory,
      runOverride: {
        runId: "phase74-confirmatory-locomo-r99",
        stage: "E4",
      },
    }))).rejects.toThrow(/planned run|presealed|match/i);
  });

  it("fails closed when the Git anchor is missing or does not reproduce the plan bytes", async () => {
    const runDirectory = await createRunDirectory();
    const plan = buildPlan();
    await writePlan(runDirectory, plan);
    const input = admissionInput({ plan, runDirectory });

    const {
      gitAnchor: _gitAnchor,
      ...descriptorWithoutAnchor
    } = input.identity.configuration.confirmatoryPlan;
    await expect(assertConfirmatoryAdmission({
      ...input,
      identity: {
        configuration: {
          confirmatoryPlan: descriptorWithoutAnchor as
            typeof input.identity.configuration.confirmatoryPlan,
          seenCasesOnly: true,
        },
      },
    }))
      .rejects.toThrow(/descriptor|git anchor|exact keys/i);

    await expect(assertConfirmatoryAdmission({
      ...input,
      gitAnchorDependencies: {
        ...input.gitAnchorDependencies,
        readGitBlob: async () => "{}\n",
      },
    })).rejects.toThrow(/bytes|git|drift/i);
  });
});
