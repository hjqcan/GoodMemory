import { createHash } from "node:crypto";
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
  runPhase74HaluMemE4Protection,
  runPhase74HaluMemPrivacyProtection,
  runPhase74HaluMemUpdateProtection,
} from "../../scripts/phase-74-halumem-protection";
import {
  runPhase74HaluMemLiveProtection,
  verifyPhase74HaluMemLiveRun,
} from "../../scripts/run-phase-74-halumem-live-protection";
import type {
  Phase74HaluMemLiveRunnerDependencies,
  Phase74HaluMemLiveRunnerOptions,
} from "../../scripts/run-phase-74-halumem-live-protection";
import type {
  Phase74HaluMemProtectionCliResult,
} from "../../scripts/run-phase-74-halumem-protection";
import type {
  Phase74HaluMemUser,
} from "../../src/eval/phase74HaluMemProtectionVerifier";
import { buildPhase74IngestionUsageFingerprint } from "../../src/eval/phase74FullRuntime";
import { hashPhase74ProtectionValue } from "../../src/eval/phase74ProtectionRun";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { force: true, recursive: true })
  ));
});

async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "phase74-halumem-live-runner-"));
  roots.push(path);
  return path;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function user(uuid: string): Phase74HaluMemUser {
  return {
    persona_info: `${uuid} persona`,
    sessions: [{
      dialogue: [{
        content: `${uuid} works on Apollo.`,
        role: "user",
        timestamp: "2026-01-01T00:00:00.000Z",
      }],
      memory_points: [{
        importance: 1,
        is_update: "True",
        memory_content: `${uuid} now works on Mosaic.`,
        memory_source: "dialogue_turn=0",
        memory_type: "fact",
        original_memories: [`${uuid} worked on Apollo.`],
        timestamp: "2026-01-01T00:00:00.000Z",
      }],
      questions: [{
        answer: "Apollo",
        evidence: [{ memory_content: "works on Apollo" }],
        question: `Which project does ${uuid} work on?`,
      }],
      start_time: "2026-01-01T00:00:00.000Z",
    }],
    uuid,
  };
}

const users = [
  user("2f1f897e-d67f-dbc5-6a7b-b7634a9e294f"),
  user("10000000-0000-0000-0000-000000000001"),
  user("20000000-0000-0000-0000-000000000002"),
  user("30000000-0000-0000-0000-000000000003"),
];

function dataset(): string {
  return `${users.map((value) => JSON.stringify(value)).join("\n")}\n`;
}

const models = {
  answer: {
    apiKey: "answer-key",
    baseURL: "https://ai.gurkiai.com/v1",
    model: "gpt-5.6-terra",
    provider: "openai" as const,
  },
  assistedExtraction: {
    apiKey: "answer-key",
    baseURL: "https://ai.gurkiai.com/v1",
    model: "gpt-5.6-terra",
    provider: "openai" as const,
  },
  embedding: {
    apiKey: "embedding-key",
    baseURL: "https://openrouter.ai/api/v1",
    model: "text-embedding-3-small",
    provider: "openai" as const,
  },
  judge: {
    apiKey: "judge-key",
    baseURL: "https://ai.gurkiai.com/v1",
    model: "gpt-5.5",
    provider: "openai" as const,
  },
  planner: {
    apiKey: "answer-key",
    baseURL: "https://ai.gurkiai.com/v1",
    model: "gpt-5.6-terra",
    provider: "openai" as const,
  },
  reranker: {
    apiKey: "answer-key",
    baseURL: "https://ai.gurkiai.com/v1",
    model: "gpt-5.6-terra",
    provider: "openai" as const,
  },
};

async function fixtureOptions(
  mode: "live" | "preflight",
): Promise<Phase74HaluMemLiveRunnerOptions> {
  const directory = await root();
  const datasetPath = join(directory, "HaluMem-Medium.jsonl");
  const raw = dataset();
  await writeFile(datasetPath, raw, "utf8");
  return {
    datasetId: "HaluMem-Medium",
    datasetPath,
    embeddingSpendLimitUsd: 0.25,
    expectedDatasetSha256: sha256(raw),
    generatedAt: "2026-07-21T00:00:00.000Z",
    maxLanguageCalls: 1_000,
    mode,
    outputDir: join(directory, "runs"),
    replicate: 1,
    runId: `${mode}-run`,
    userCount: 2,
  };
}

function dependencies(
  counters: { createProviders: number; run: number },
): Phase74HaluMemLiveRunnerDependencies {
  return {
    async captureEvaluatorSource() {
      return { commit: "c".repeat(40), sha256: "e".repeat(64) };
    },
    createLiveDependencies() {
      counters.createProviders += 1;
      throw new Error("provider dependencies must not be created in preflight");
    },
    resolveModels() {
      return models;
    },
    async runProtection() {
      counters.run += 1;
      throw new Error("protection run must not execute in preflight");
    },
  };
}

async function frozenResult(
  runDirectory: string,
  options: Parameters<Phase74HaluMemLiveRunnerDependencies["runProtection"]>[0],
): Promise<Phase74HaluMemProtectionCliResult> {
  const ingestionKey = "a".repeat(64);
  await Bun.write(
    join(runDirectory, "ingestion-usage", ingestionKey, "events.jsonl"),
    "",
  );
  await Bun.write(
    join(runDirectory, "ingestion-usage", ingestionKey, "intents.jsonl"),
    "",
  );
  await Bun.write(
    join(runDirectory, "ingestion", ingestionKey, "manifest.json"),
    `${JSON.stringify({
      key: ingestionKey,
      schemaVersion: 8,
      usage: buildPhase74IngestionUsageFingerprint({
        events: [],
        intents: [],
        pendingIntents: [],
      }),
    })}\n`,
  );
  const selectedUsers = users.filter(({ uuid }) =>
    options.userUuids.includes(uuid)
  );
  const common = {
    dataset: {
      id: options.datasetId,
      sha256: sha256(await readFile(options.datasetPath)),
    },
    replicate: options.replicate,
    source: { id: `git:${"c".repeat(40)}`, sha256: "e".repeat(64) },
    users: selectedUsers,
  };
  const e4 = await runPhase74HaluMemE4Protection({
    ...common,
    artifactPath: join(runDirectory, "e4/protection-run.json"),
    configuration: options.e4Configuration,
    rawArtifactPath: join(runDirectory, "e4/raw.json"),
    runId: `${options.runId}-e4`,
  }, {
    answer: async ({ context }) => context.includes("Apollo")
      ? "Apollo"
      : "unknown",
    judgeQa: async ({ answer, expectedAnswer }) => JSON.stringify({
      protocol: "phase74-independent-qa-judge-v1",
      reason: "Frozen runner exact comparison.",
      verdict: answer === expectedAnswer ? "correct" : "incorrect",
    }),
    retrieveEvidence: async ({ questionCaseId }) => ({
      evidenceLedger: [{
        evidenceId: `evidence-${questionCaseId}`,
        excerpt: "Apollo",
        relation: "supports",
        sourceMemoryId: `memory-${questionCaseId}`,
        temporalStatus: "current",
      }],
      snapshotId: `snapshot-${questionCaseId}`,
    }),
  });
  const privacy = await runPhase74HaluMemPrivacyProtection({
    ...common,
    artifactPath: join(runDirectory, "privacy/protection-run.json"),
    configuration: options.safetyConfiguration,
    rawArtifactPath: join(runDirectory, "privacy/raw.json"),
    runId: `${options.runId}-privacy`,
  }, {
    recallScopes: async ({ branch, expectedOwnerSourceMessageIds }) => ({
      foreignScopeSourceMessageIds: [],
      ownerScopeSourceMessageIds: [expectedOwnerSourceMessageIds[0]!],
      snapshotId: `${branch}-${expectedOwnerSourceMessageIds[0]}`,
    }),
  });
  const update = await runPhase74HaluMemUpdateProtection({
    ...common,
    artifactPath: join(runDirectory, "update/protection-run.json"),
    configuration: options.safetyConfiguration,
    rawArtifactPath: join(runDirectory, "update/raw.json"),
    runId: `${options.runId}-update`,
  }, {
    evaluateUpdate: async ({ branch }) => {
      const category = branch === "candidate" ? "Correct" : "Omission";
      return JSON.stringify({
        category,
        protocol: "halumem-upstream-per-item-update-v1",
        rawDecision: JSON.stringify({
          evaluation_result: category,
          reason: "Frozen runner update decision.",
        }),
        usage: {
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          inputTokens: 10,
          outputTokens: 5,
          uncachedInputTokens: 10,
        },
      });
    },
    retrieveUpdateEvidence: async ({ branch, memoryPoint }) => ({
      memories: branch === "candidate"
        ? [memoryPoint.memory_content]
        : memoryPoint.original_memories,
      snapshotId: `${branch}-${memoryPoint.memory_content}`,
      sourceMessageIds: ["source-message-0"],
    }),
  });
  return {
    e4,
    privacy,
    update: { result: update, status: "completed" },
  };
}

async function frozenLiveRun() {
  const options = await fixtureOptions("live");
  return runPhase74HaluMemLiveProtection(options, {
    async captureEvaluatorSource() {
      return { commit: "c".repeat(40), sha256: "e".repeat(64) };
    },
    createLiveDependencies() {
      return { e4: {} as never, privacy: {} as never, update: {} as never };
    },
    resolveModels() {
      return models;
    },
    async runProtection(cliOptions) {
      return frozenResult(
        join(cliOptions.outputDir, cliOptions.runId),
        cliOptions,
      );
    },
  });
}

async function rewriteProtectionRaw(input: {
  raw: unknown;
  runDirectory: string;
  suite: "e4" | "privacy" | "update";
}): Promise<void> {
  const rawPath = join(input.runDirectory, input.suite, "raw.json");
  const artifactPath = join(
    input.runDirectory,
    input.suite,
    "protection-run.json",
  );
  const completionPath = join(input.runDirectory, "run-completion.json");
  const rawText = `${JSON.stringify(input.raw, null, 2)}\n`;
  await writeFile(rawPath, rawText, "utf8");
  const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
  artifact.rawArtifact.sha256 = sha256(rawText);
  const artifactText = `${JSON.stringify(artifact, null, 2)}\n`;
  await writeFile(artifactPath, artifactText, "utf8");
  const completion = JSON.parse(await readFile(completionPath, "utf8"));
  completion.artifacts[`${input.suite}/raw.json`] = sha256(rawText);
  completion.artifacts[`${input.suite}/protection-run.json`] =
    sha256(artifactText);
  await writeFile(completionPath, `${JSON.stringify(completion, null, 2)}\n`, "utf8");
}

describe("Phase 74 HaluMem live runner", () => {
  it("freezes an unseen structural selection and identity before a zero-provider preflight exits", async () => {
    const options = await fixtureOptions("preflight");
    const counters = { createProviders: 0, run: 0 };
    const result = await runPhase74HaluMemLiveProtection(
      options,
      dependencies(counters),
    );

    expect(result.status).toBe("preflight_complete");
    expect(counters).toEqual({ createProviders: 0, run: 0 });
    const selection = JSON.parse(await readFile(
      join(result.runDirectory, "selection-manifest.json"),
      "utf8",
    ));
    expect(selection.selectedUserUuids).toHaveLength(2);
    expect(selection.selectedUserUuids).not.toContain(
      "2f1f897e-d67f-dbc5-6a7b-b7634a9e294f",
    );
    const identityRaw = await readFile(
      join(result.runDirectory, "run-identity.json"),
      "utf8",
    );
    expect(identityRaw).not.toContain("answer-key");
    const identity = JSON.parse(identityRaw);
    expect(identity.configuration.caseConcurrency).toBe(16);
    expect(identity.configuration.update).toEqual({
      evaluatorSource: {
        id: expect.stringContaining("eval/eval_tools.py"),
        sha256: "0c08e5ecb8c93945bafc4bd0336bd6c9756b40d175f442ce44aca4a43169ee3b",
      },
      promotionRole: "gold-aware-safety-protection-only",
      sessionPolicy: "causal-session-write-then-update-retrieval-v1",
      status: "enabled",
      topK: 10,
    });
    expect(identity.promptSha256s.haluMemUpdateJudgeTemplate).toBe(
      "27115394bd6a98f22ae1378903e5763914e60d5fe09a1643cc59bf78c6a97229",
    );
    expect(Bun.file(join(result.runDirectory, "run-completion.json")).size)
      .toBe(0);

    await expect(runPhase74HaluMemLiveProtection(
      options,
      dependencies(counters),
    )).rejects.toThrow(/exist|create-only/iu);
    expect(counters).toEqual({ createProviders: 0, run: 0 });
  });

  it("creates providers only after identity, writes usage ledgers, and binds completion hashes", async () => {
    const options = await fixtureOptions("live");
    let identityExistedBeforeProviders = false;
    const result = await runPhase74HaluMemLiveProtection(options, {
      async captureEvaluatorSource() {
        return { commit: "c".repeat(40), sha256: "e".repeat(64) };
      },
      createLiveDependencies({ runDirectory }) {
        identityExistedBeforeProviders =
          Bun.file(join(runDirectory, "run-identity.json")).size > 0 &&
          Bun.file(join(runDirectory, "selection-manifest.json")).size > 0;
        return {
          e4: {} as never,
          privacy: {} as never,
          update: {} as never,
        };
      },
      resolveModels() {
        return models;
      },
      async runProtection(cliOptions, liveDependencies) {
        expect(liveDependencies.update).toBeDefined();
        return frozenResult(
          join(cliOptions.outputDir, cliOptions.runId),
          cliOptions,
        );
      },
    });

    expect(identityExistedBeforeProviders).toBe(true);
    expect(result.status).toBe("completed");
    expect(await readFile(
      join(result.runDirectory, "model-usage-intents.jsonl"),
      "utf8",
    )).toBe("");
    expect(await readFile(
      join(result.runDirectory, "model-usage.jsonl"),
      "utf8",
    )).toBe("");
    const completion = await verifyPhase74HaluMemLiveRun(result.runDirectory);
    expect(completion.updateStatus).toBe("completed");
    expect(completion.usage.ingestionKeyCount).toBe(1);
    expect(Object.keys(completion.artifacts)).toContain("e4/raw.json");
    expect(Object.keys(completion.artifacts)).toContain(
      `ingestion-usage/${"a".repeat(64)}/events.jsonl`,
    );
    expect(Object.keys(completion.artifacts)).toContain(
      `ingestion/${"a".repeat(64)}/manifest.json`,
    );
    expect(await readFile(
      join(result.runDirectory, "model-usage-summary.json"),
      "utf8",
    )).not.toContain(result.runDirectory);
    expect(Object.keys(completion.artifacts)).toContain("privacy/raw.json");
    expect(Object.keys(completion.artifacts)).toContain("update/raw.json");
    expect(Object.keys(completion.artifacts)).toContain("selected-users.jsonl");
  });

  it("verify-only replays hashes without resolving models or creating providers", async () => {
    const options = await fixtureOptions("live");
    const live = await runPhase74HaluMemLiveProtection(options, {
      async captureEvaluatorSource() {
        return { commit: "c".repeat(40), sha256: "e".repeat(64) };
      },
      createLiveDependencies() {
        return { e4: {} as never, privacy: {} as never, update: {} as never };
      },
      resolveModels() {
        return models;
      },
      async runProtection(cliOptions) {
        return frozenResult(
          join(cliOptions.outputDir, cliOptions.runId),
          cliOptions,
        );
      },
    });
    const result = await runPhase74HaluMemLiveProtection({
      mode: "verify",
      runDirectory: live.runDirectory,
    }, {
      async captureEvaluatorSource() {
        throw new Error("verify-only must not capture source");
      },
      createLiveDependencies() {
        throw new Error("verify-only must not create providers");
      },
      resolveModels() {
        throw new Error("verify-only must not resolve models");
      },
      async runProtection() {
        throw new Error("verify-only must not run protection");
      },
    });

    expect(result.status).toBe("verified");
  });

  it("verify-only rejects a rehashed raw update category that contradicts the judge output", async () => {
    const options = await fixtureOptions("live");
    const live = await runPhase74HaluMemLiveProtection(options, {
      async captureEvaluatorSource() {
        return { commit: "c".repeat(40), sha256: "e".repeat(64) };
      },
      createLiveDependencies() {
        return { e4: {} as never, privacy: {} as never, update: {} as never };
      },
      resolveModels() {
        return models;
      },
      async runProtection(cliOptions) {
        return frozenResult(
          join(cliOptions.outputDir, cliOptions.runId),
          cliOptions,
        );
      },
    });
    const rawPath = join(live.runDirectory, "update/raw.json");
    const artifactPath = join(live.runDirectory, "update/protection-run.json");
    const completionPath = join(live.runDirectory, "run-completion.json");
    const raw = JSON.parse(await readFile(rawPath, "utf8"));
    raw.rows[0].candidate.rawOutput.decision = JSON.stringify({
      category: "Correct",
      protocol: "halumem-upstream-per-item-update-v1",
      rawDecision: JSON.stringify({
        evaluation_result: "Hallucination",
        reason: "Contradictory raw decision.",
      }),
      usage: {
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        inputTokens: 10,
        outputTokens: 5,
        uncachedInputTokens: 10,
      },
    });
    const rawText = `${JSON.stringify(raw, null, 2)}\n`;
    await writeFile(rawPath, rawText, "utf8");
    const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
    artifact.rawArtifact.sha256 = sha256(rawText);
    const artifactText = `${JSON.stringify(artifact, null, 2)}\n`;
    await writeFile(artifactPath, artifactText, "utf8");
    const completion = JSON.parse(await readFile(completionPath, "utf8"));
    completion.artifacts["update/raw.json"] = sha256(rawText);
    completion.artifacts["update/protection-run.json"] = sha256(artifactText);
    await writeFile(completionPath, `${JSON.stringify(completion, null, 2)}\n`, "utf8");

    await expect(verifyPhase74HaluMemLiveRun(live.runDirectory)).rejects.toThrow(
      "category drifted",
    );
  });

  it("verify-only replays and rejects rehashed E4 and privacy raw artifacts", async () => {
    const e4Live = await frozenLiveRun();
    const e4Raw = JSON.parse(await readFile(
      join(e4Live.runDirectory, "e4/raw.json"),
      "utf8",
    ));
    e4Raw.rows[0].candidate.rawOutput.formats.prose.context =
      "forged rendered context";
    await rewriteProtectionRaw({
      raw: e4Raw,
      runDirectory: e4Live.runDirectory,
      suite: "e4",
    });
    await expect(verifyPhase74HaluMemLiveRun(e4Live.runDirectory)).rejects
      .toThrow("rendered context drifted");

    const privacyLive = await frozenLiveRun();
    const privacyRaw = JSON.parse(await readFile(
      join(privacyLive.runDirectory, "privacy/raw.json"),
      "utf8",
    ));
    privacyRaw.rows[0].candidate.rawOutput.foreignScopeSourceMessageIds = [
      ...privacyRaw.rows[0].candidate.rawOutput.ownerScopeSourceMessageIds,
    ];
    await rewriteProtectionRaw({
      raw: privacyRaw,
      runDirectory: privacyLive.runDirectory,
      suite: "privacy",
    });
    await expect(verifyPhase74HaluMemLiveRun(privacyLive.runDirectory)).rejects
      .toThrow("replayed score drifted");
  });

  it("verify-only rebuilds the selection manifest from selected users", async () => {
    const live = await frozenLiveRun();
    const selectionPath = join(live.runDirectory, "selection-manifest.json");
    const identityPath = join(live.runDirectory, "run-identity.json");
    const completionPath = join(live.runDirectory, "run-completion.json");
    const selection = JSON.parse(await readFile(selectionPath, "utf8"));
    selection.selectedSessions[0].questionCount += 1;
    const selectionText = `${JSON.stringify(selection, null, 2)}\n`;
    await writeFile(selectionPath, selectionText, "utf8");
    const identity = JSON.parse(await readFile(identityPath, "utf8"));
    identity.configuration.selection = selection;
    identity.configuration.selectionSha256 = hashPhase74ProtectionValue(selection);
    const identityText = `${JSON.stringify(identity, null, 2)}\n`;
    await writeFile(identityPath, identityText, "utf8");
    const completion = JSON.parse(await readFile(completionPath, "utf8"));
    completion.identitySha256 = sha256(identityText);
    completion.selectionSha256 = sha256(selectionText);
    completion.artifacts["run-identity.json"] = sha256(identityText);
    completion.artifacts["selection-manifest.json"] = sha256(selectionText);
    await writeFile(completionPath, `${JSON.stringify(completion, null, 2)}\n`, "utf8");

    await expect(verifyPhase74HaluMemLiveRun(live.runDirectory)).rejects.toThrow(
      "selection manifest drifted from selected users",
    );
  });

  it("verify-only pins the upstream update evaluator in the safety pipeline", async () => {
    const live = await frozenLiveRun();
    const identityPath = join(live.runDirectory, "run-identity.json");
    const completionPath = join(live.runDirectory, "run-completion.json");
    const identity = JSON.parse(await readFile(identityPath, "utf8"));
    identity.configuration.pipelines.safety.updateEvaluator.sha256 =
      "0".repeat(64);
    const identityText = `${JSON.stringify(identity, null, 2)}\n`;
    await writeFile(identityPath, identityText, "utf8");
    const completion = JSON.parse(await readFile(completionPath, "utf8"));
    completion.identitySha256 = sha256(identityText);
    completion.artifacts["run-identity.json"] = sha256(identityText);
    await writeFile(completionPath, `${JSON.stringify(completion, null, 2)}\n`, "utf8");

    await expect(verifyPhase74HaluMemLiveRun(live.runDirectory)).rejects.toThrow(
      "update evaluator identity",
    );
  });

  it("verify-only rejects a rehashed completion that omits a canonical artifact", async () => {
    const live = await frozenLiveRun();
    const completionPath = join(live.runDirectory, "run-completion.json");
    const completion = JSON.parse(await readFile(completionPath, "utf8"));
    delete completion.artifacts["model-usage.jsonl"];
    await writeFile(completionPath, `${JSON.stringify(completion, null, 2)}\n`, "utf8");

    await expect(verifyPhase74HaluMemLiveRun(live.runDirectory)).rejects.toThrow(
      "canonical artifact",
    );
  });

  it("verify-only rejects a rehashed pending direct model-usage intent", async () => {
    const live = await frozenLiveRun();
    const intentsPath = join(live.runDirectory, "model-usage-intents.jsonl");
    const completionPath = join(live.runDirectory, "run-completion.json");
    const pending = {
      attempt: 1,
      branch: "judge",
      caseId: "pending-update:candidate:update",
      modelId: "gpt-5.5",
      operation: "judge",
      providerId: "openai",
      requestId: "pending-request",
      schemaVersion: 1,
    };
    const intents = `${await readFile(intentsPath, "utf8")}${JSON.stringify(pending)}\n`;
    await writeFile(intentsPath, intents, "utf8");
    const completion = JSON.parse(await readFile(completionPath, "utf8"));
    completion.artifacts["model-usage-intents.jsonl"] = sha256(intents);
    await writeFile(completionPath, `${JSON.stringify(completion, null, 2)}\n`, "utf8");

    await expect(verifyPhase74HaluMemLiveRun(live.runDirectory)).rejects.toThrow(
      "pending",
    );
  });

  it("verify-only rejects a rehashed pending ingestion model-usage intent", async () => {
    const live = await frozenLiveRun();
    const key = "a".repeat(64);
    const intentsPath = join(
      live.runDirectory,
      "ingestion-usage",
      key,
      "intents.jsonl",
    );
    const completionPath = join(live.runDirectory, "run-completion.json");
    const pending = {
      attempt: 1,
      branch: "shadow",
      caseId: "pending-ingestion",
      modelId: "gpt-5.6-terra",
      operation: "embedding",
      providerId: "openai",
      requestId: "pending-ingestion-request",
      schemaVersion: 1,
    };
    const intents = `${await readFile(intentsPath, "utf8")}${JSON.stringify(pending)}\n`;
    await writeFile(intentsPath, intents, "utf8");
    const completion = JSON.parse(await readFile(completionPath, "utf8"));
    completion.artifacts[`ingestion-usage/${key}/intents.jsonl`] =
      sha256(intents);
    await writeFile(completionPath, `${JSON.stringify(completion, null, 2)}\n`, "utf8");

    await expect(verifyPhase74HaluMemLiveRun(live.runDirectory)).rejects.toThrow(
      "pending",
    );
  });

  it("verify-only rejects a rehashed update prompt identity", async () => {
    const live = await frozenLiveRun();
    const identityPath = join(live.runDirectory, "run-identity.json");
    const completionPath = join(live.runDirectory, "run-completion.json");
    const identity = JSON.parse(await readFile(identityPath, "utf8"));
    identity.promptSha256s.haluMemUpdateJudgeTemplate = "0".repeat(64);
    const identityText = `${JSON.stringify(identity, null, 2)}\n`;
    await writeFile(identityPath, identityText, "utf8");
    const completion = JSON.parse(await readFile(completionPath, "utf8"));
    completion.identitySha256 = sha256(identityText);
    completion.artifacts["run-identity.json"] = sha256(identityText);
    await writeFile(completionPath, `${JSON.stringify(completion, null, 2)}\n`, "utf8");

    await expect(verifyPhase74HaluMemLiveRun(live.runDirectory)).rejects.toThrow(
      "prompt identity",
    );
  });
});
