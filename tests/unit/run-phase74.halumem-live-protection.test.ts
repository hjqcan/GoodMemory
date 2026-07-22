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
  buildPhase74HaluMemCausalRecallCase,
} from "../../scripts/phase-74-halumem-live-providers";
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
import {
  PHASE74_HALUMEM_EVIDENCE_LEDGER_FORMATS,
  buildPhase74HaluMemSourceMessageId,
  buildPhase74HaluMemUpdateSnapshotId,
  buildPhase74HaluMemUpdateSourceRecord,
} from "../../src/eval/phase74HaluMemProtectionVerifier";
import {
  buildPhase74IngestionDescriptor,
  buildPhase74IngestionUsageFingerprint,
} from "../../src/eval/phase74FullRuntime";
import { buildPhase74StageConfigurations } from "../../src/eval/phase74Generalization";
import { phase74LivePromptSha256s } from "../../src/eval/phase74Live";
import type {
  AttributedModelUsageAttempt,
  AttributedModelUsageIntent,
} from "../../src/eval/modelUsage";
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

function updateEvidenceLinks(
  memoryId: string,
  user: Phase74HaluMemUser,
  sessionIndex: number,
) {
  const sourceRecord = buildPhase74HaluMemUpdateSourceRecord({
    sessionIndex,
    turnIndex: 0,
    user,
  });
  const excerpt = user.sessions[sessionIndex]!.dialogue[0]!.content.trim();
  return [{
    evidenceId: `evidence:${sha256(memoryId)}`,
    excerpt,
    excerptSha256: sha256(excerpt),
    linkedArchiveIds: [],
    linkedMemoryIds: [memoryId],
    sourceMessageIds: [sourceRecord.sourceMessageId],
    sourceRecordIds: [sourceRecord.id],
    sourceRecords: [sourceRecord],
    sourceUri:
      `goodmemory://source-messages/${encodeURIComponent(sourceRecord.id)}`,
  }];
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
  const selectedUsers = users.filter(({ uuid }) =>
    options.userUuids.includes(uuid)
  );
  const completeUsage = {
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    inputTokens: 10,
    outputTokens: 5,
    uncachedInputTokens: 10,
  };
  for (const selectedUser of selectedUsers) {
    const testCase = buildPhase74HaluMemCausalRecallCase({
      question: selectedUser.sessions[0]!.questions![0]!,
      questionCaseId: `${selectedUser.uuid}:session:0:question:0`,
      sessionIndex: 0,
      user: selectedUser,
    });
    const ingestion = buildPhase74IngestionDescriptor({
      configuration: buildPhase74StageConfigurations(
        {},
        "E3",
      )["recall-plan-deterministic"]!,
      datasetSha256: sha256(await readFile(options.datasetPath)),
      evaluatorSourceSha256: "e".repeat(64),
      models,
      promptSha256s: phase74LivePromptSha256s(),
      testCase,
    });
    const intents = ([
      {
        modelId: "gpt-5.6-terra",
        operation: "assisted_extraction" as const,
        providerId: "openai",
      },
      {
        modelId: "text-embedding-3-small",
        operation: "embedding" as const,
        providerId: "openai",
      },
    ]).map((request, index) => ({
      ...request,
      attempt: 1,
      branch: "shadow" as const,
      caseId: ingestion.memoryGroupId,
      requestId: `ingestion-${selectedUser.uuid}-${index}`,
      schemaVersion: 1 as const,
    }));
    const events = intents.map((intent) => ({
      ...intent,
      completeness: "complete" as const,
      outcome: "succeeded" as const,
      usage: completeUsage,
    }));
    await Bun.write(
      join(runDirectory, "ingestion-usage", ingestion.key, "events.jsonl"),
      `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
    );
    await Bun.write(
      join(runDirectory, "ingestion-usage", ingestion.key, "intents.jsonl"),
      `${intents.map((intent) => JSON.stringify(intent)).join("\n")}\n`,
    );
    await Bun.write(
      join(runDirectory, "ingestion", ingestion.key, "manifest.json"),
      `${JSON.stringify({
        key: ingestion.key,
        memoryGroupId: ingestion.memoryGroupId,
        representation: ingestion.representation,
        schemaVersion: 8,
        sourceMessageCount: testCase.rawEvidence.length,
        usage: buildPhase74IngestionUsageFingerprint({
          events,
          intents,
          pendingIntents: [],
        }),
      })}\n`,
    );
  }
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
    configuration: options.privacyConfiguration,
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
    configuration: options.updateConfiguration,
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
    retrieveUpdateEvidence: async ({
      branch,
      memoryPoint,
      sessionIndex,
      updateCaseId,
      user,
    }) => {
      const contents = branch === "candidate"
        ? [memoryPoint.memory_content]
        : memoryPoint.original_memories;
      const sourceMessageIds = [buildPhase74HaluMemSourceMessageId({
        sessionIndex,
        turnIndex: 0,
        userUuid: user.uuid,
      })];
      const records = contents.map((content, index) => ({
        content,
        evidenceLinks: updateEvidenceLinks(
          `${branch}-fact-${index + 1}`,
          user,
          sessionIndex,
        ),
        id: `${branch}-fact-${index + 1}`,
        rank: index + 1,
        sourceMessageIds,
        type: "fact" as const,
      }));
      return {
        records,
        snapshotId: buildPhase74HaluMemUpdateSnapshotId({
          branch,
          caseId: updateCaseId,
          records,
          sessionIndex,
          sourceMessageIds,
        }),
        sourceMessageIds,
      };
    },
  });
  const directRequests: AttributedModelUsageIntent[] = [];
  const addDirectRequest = (input: Omit<
    AttributedModelUsageIntent,
    "attempt" | "requestId" | "schemaVersion"
  >) => {
    directRequests.push({
      ...input,
      attempt: 1,
      requestId: `direct-request-${directRequests.length + 1}`,
      schemaVersion: 1,
    });
  };
  for (const selectedUser of selectedUsers) {
    const questionCaseId = `${selectedUser.uuid}:session:0:question:0`;
    addDirectRequest({
      branch: "candidate",
      caseId: questionCaseId,
      modelId: "text-embedding-3-small",
      operation: "embedding",
      providerId: "openai",
    });
    for (const [branch, format] of [
      ["baseline", "legacy"],
      ...PHASE74_HALUMEM_EVIDENCE_LEDGER_FORMATS.map((format) =>
        ["candidate", format] as const
      ),
    ] as const) {
      const caseId = `${questionCaseId}:${format}`;
      addDirectRequest({
        branch,
        caseId,
        modelId: "gpt-5.6-terra",
        operation: "answer_generation",
        providerId: "openai",
      });
      addDirectRequest({
        branch: "judge",
        caseId,
        modelId: "gpt-5.5",
        operation: "judge",
        providerId: "openai",
      });
    }
    for (const branch of ["baseline", "candidate"] as const) {
      addDirectRequest({
        branch,
        caseId:
          `halumem-privacy:${selectedUser.uuid}:session:0:${branch}:ingest`,
        modelId: "text-embedding-3-small",
        operation: "embedding",
        providerId: "openai",
      });
      const privacyCaseId =
        `${questionCaseId}:foreign-scope:${
          selectedUsers[(selectedUsers.indexOf(selectedUser) + 1) %
            selectedUsers.length]!.uuid
        }`;
      for (const side of ["owner", "foreign"] as const) {
        addDirectRequest({
          branch,
          caseId: `${privacyCaseId}:${branch}:${side}`,
          modelId: "text-embedding-3-small",
          operation: "embedding",
          providerId: "openai",
        });
      }
      addDirectRequest({
        branch,
        caseId:
          `halumem-update:${selectedUser.uuid}:session:0:${branch}:ingest`,
        modelId: "gpt-5.6-terra",
        operation: "assisted_extraction",
        providerId: "openai",
      });
      addDirectRequest({
        branch,
        caseId:
          `halumem-update:${selectedUser.uuid}:session:0:${branch}:ingest`,
        modelId: "text-embedding-3-small",
        operation: "embedding",
        providerId: "openai",
      });
      const updateCaseId = `${selectedUser.uuid}:session:0:update:0`;
      addDirectRequest({
        branch,
        caseId: `${updateCaseId}:${branch}:retrieve`,
        modelId: "text-embedding-3-small",
        operation: "embedding",
        providerId: "openai",
      });
      addDirectRequest({
        branch: "judge",
        caseId: `${updateCaseId}:${branch}:update`,
        modelId: "gpt-5.5",
        operation: "judge",
        providerId: "openai",
      });
    }
  }
  const directEvents = directRequests.map((request) => ({
    ...request,
    completeness: "complete" as const,
    outcome: "succeeded" as const,
    usage: completeUsage,
  }));
  await writeFile(
    join(runDirectory, "model-usage-intents.jsonl"),
    `${directRequests.map((request) => JSON.stringify(request)).join("\n")}\n`,
    "utf8",
  );
  await writeFile(
    join(runDirectory, "model-usage.jsonl"),
    `${directEvents.map((event) => JSON.stringify(event)).join("\n")}\n`,
    "utf8",
  );
  const callBudgetPath = join(runDirectory, "call-budget.json");
  const callBudget = JSON.parse(await readFile(callBudgetPath, "utf8"));
  const allIntents = [
    ...directRequests,
    ...selectedUsers.flatMap((selectedUser) => ([
      { operation: "assisted_extraction" },
      { operation: "embedding" },
    ])),
  ];
  callBudget.embeddingCalls = allIntents.filter(
    ({ operation }) => operation === "embedding",
  ).length;
  callBudget.embeddingInputByteUpperBound = callBudget.embeddingCalls * 10;
  callBudget.languageCalls = allIntents.length - callBudget.embeddingCalls;
  await writeFile(
    callBudgetPath,
    `${JSON.stringify(callBudget, null, 2)}\n`,
    "utf8",
  );
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

async function rewriteUsageEvidence(input: {
  mutateBudget?: (budget: Record<string, number>) => void;
  mutateDirect?: (value: {
    events: AttributedModelUsageAttempt[];
    intents: AttributedModelUsageIntent[];
  }) => void;
  mutateIngestion?: (value: {
    events: AttributedModelUsageAttempt[];
    intents: AttributedModelUsageIntent[];
    key: string;
  }) => void;
  runDirectory: string;
}): Promise<void> {
  const directEventsPath = join(input.runDirectory, "model-usage.jsonl");
  const directIntentsPath = join(
    input.runDirectory,
    "model-usage-intents.jsonl",
  );
  const summaryPath = join(input.runDirectory, "model-usage-summary.json");
  const completionPath = join(input.runDirectory, "run-completion.json");
  const budgetPath = join(input.runDirectory, "call-budget.json");
  const parseJsonl = <T>(raw: string): T[] =>
    raw.split("\n").filter(Boolean).map((line) => JSON.parse(line) as T);
  const serializeJsonl = (values: readonly unknown[]) =>
    values.length === 0
      ? ""
      : `${values.map((value) => JSON.stringify(value)).join("\n")}\n`;
  const direct = {
    events: parseJsonl<AttributedModelUsageAttempt>(
      await readFile(directEventsPath, "utf8"),
    ),
    intents: parseJsonl<AttributedModelUsageIntent>(
      await readFile(directIntentsPath, "utf8"),
    ),
  };
  input.mutateDirect?.(direct);
  const summary = JSON.parse(await readFile(summaryPath, "utf8")) as {
    branches: Record<string, number>;
    eventCount: number;
    eventsSha256: string;
    ingestion: Array<{
      eventCount: number;
      eventsSha256: string;
      intentCount: number;
      intentsSha256: string;
      key: string;
    }>;
    ingestionKeyCount: number;
    intentCount: number;
    intentsSha256: string;
    pendingRequestCount: 0;
    schemaVersion: 1;
  };
  const ingestionLedgers = await Promise.all(summary.ingestion.map(
    async (entry, index) => {
      const eventsPath = join(
        input.runDirectory,
        "ingestion-usage",
        entry.key,
        "events.jsonl",
      );
      const intentsPath = join(
        input.runDirectory,
        "ingestion-usage",
        entry.key,
        "intents.jsonl",
      );
      const ledger = {
        events: parseJsonl<AttributedModelUsageAttempt>(
          await readFile(eventsPath, "utf8"),
        ),
        intents: parseJsonl<AttributedModelUsageIntent>(
          await readFile(intentsPath, "utf8"),
        ),
        key: entry.key,
      };
      if (index === 0) {
        input.mutateIngestion?.(ledger);
      }
      const eventText = serializeJsonl(ledger.events);
      const intentText = serializeJsonl(ledger.intents);
      await writeFile(eventsPath, eventText, "utf8");
      await writeFile(intentsPath, intentText, "utf8");
      const manifestPath = join(
        input.runDirectory,
        "ingestion",
        entry.key,
        "manifest.json",
      );
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      manifest.usage = buildPhase74IngestionUsageFingerprint({
        events: ledger.events,
        intents: ledger.intents,
        pendingIntents: [],
      });
      const manifestText = `${JSON.stringify(manifest)}\n`;
      await writeFile(manifestPath, manifestText, "utf8");
      return {
        artifacts: {
          [`ingestion-usage/${entry.key}/events.jsonl`]: sha256(eventText),
          [`ingestion-usage/${entry.key}/intents.jsonl`]: sha256(intentText),
          [`ingestion/${entry.key}/manifest.json`]: sha256(manifestText),
        },
        entry: {
          eventCount: ledger.events.length,
          eventsSha256: sha256(eventText),
          intentCount: ledger.intents.length,
          intentsSha256: sha256(intentText),
          key: entry.key,
        },
        intents: ledger.intents,
      };
    },
  ));
  const directEventText = serializeJsonl(direct.events);
  const directIntentText = serializeJsonl(direct.intents);
  await writeFile(directEventsPath, directEventText, "utf8");
  await writeFile(directIntentsPath, directIntentText, "utf8");
  summary.ingestion = ingestionLedgers.map(({ entry }) => entry);
  summary.eventCount = direct.events.length + summary.ingestion.reduce(
    (total, entry) => total + entry.eventCount,
    0,
  );
  summary.intentCount = direct.intents.length + summary.ingestion.reduce(
    (total, entry) => total + entry.intentCount,
    0,
  );
  summary.eventsSha256 = hashPhase74ProtectionValue([
    { key: "direct", sha256: sha256(directEventText) },
    ...summary.ingestion.map(({ eventsSha256, key }) => ({
      key,
      sha256: eventsSha256,
    })),
  ]);
  summary.intentsSha256 = hashPhase74ProtectionValue([
    { key: "direct", sha256: sha256(directIntentText) },
    ...summary.ingestion.map(({ intentsSha256, key }) => ({
      key,
      sha256: intentsSha256,
    })),
  ]);
  for (const branch of ["baseline", "candidate", "judge", "shadow"]) {
    summary.branches[branch] = direct.intents.filter(
      (intent) => intent.branch === branch,
    ).length + (branch === "shadow"
      ? ingestionLedgers.reduce(
          (total, ledger) => total + ledger.intents.length,
          0,
        )
      : 0);
  }
  const summaryText = `${JSON.stringify(summary, null, 2)}\n`;
  await writeFile(summaryPath, summaryText, "utf8");
  const budget = JSON.parse(await readFile(budgetPath, "utf8")) as Record<
    string,
    number
  >;
  const allIntents = [
    ...direct.intents,
    ...ingestionLedgers.flatMap(({ intents }) => intents),
  ];
  budget.embeddingCalls = allIntents.filter(
    ({ operation }) => operation === "embedding",
  ).length;
  budget.languageCalls = allIntents.length - budget.embeddingCalls;
  input.mutateBudget?.(budget);
  const budgetText = `${JSON.stringify(budget, null, 2)}\n`;
  await writeFile(budgetPath, budgetText, "utf8");
  const completion = JSON.parse(await readFile(completionPath, "utf8"));
  completion.usage = {
    eventCount: summary.eventCount,
    eventsSha256: summary.eventsSha256,
    ingestionKeyCount: summary.ingestionKeyCount,
    intentCount: summary.intentCount,
    intentsSha256: summary.intentsSha256,
    pendingRequestCount: 0,
  };
  completion.artifacts["model-usage.jsonl"] = sha256(directEventText);
  completion.artifacts["model-usage-intents.jsonl"] = sha256(directIntentText);
  completion.artifacts["model-usage-summary.json"] = sha256(summaryText);
  completion.artifacts["call-budget.json"] = sha256(budgetText);
  Object.assign(
    completion.artifacts,
    ...ingestionLedgers.map(({ artifacts }) => artifacts),
  );
  await writeFile(
    completionPath,
    `${JSON.stringify(completion, null, 2)}\n`,
    "utf8",
  );
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
      evidenceBoundary: "internal-causal-source-replay-v2",
      evaluatorSource: {
        id: expect.stringContaining("eval/eval_tools.py"),
        sha256: "0c08e5ecb8c93945bafc4bd0336bd6c9756b40d175f442ce44aca4a43169ee3b",
      },
      promotionRole: "gold-aware-safety-protection-only",
      promotionEligible: false,
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
    expect((await readFile(
      join(result.runDirectory, "model-usage-intents.jsonl"),
      "utf8",
    )).trim().split("\n")).toHaveLength(50);
    expect((await readFile(
      join(result.runDirectory, "model-usage.jsonl"),
      "utf8",
    )).trim().split("\n")).toHaveLength(50);
    const completion = await verifyPhase74HaluMemLiveRun(result.runDirectory);
    expect(completion.updateStatus).toBe("completed");
    expect(completion.usage.ingestionKeyCount).toBe(2);
    expect(Object.keys(completion.artifacts)).toContain("e4/raw.json");
    expect(Object.keys(completion.artifacts).some((path) =>
      /^ingestion-usage\/[a-f0-9]{64}\/events\.jsonl$/u.test(path)
    )).toBe(true);
    expect(Object.keys(completion.artifacts).some((path) =>
      /^ingestion\/[a-f0-9]{64}\/manifest\.json$/u.test(path)
    )).toBe(true);
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

  it("verify-only pins the upstream update evaluator in the update pipeline", async () => {
    const live = await frozenLiveRun();
    const identityPath = join(live.runDirectory, "run-identity.json");
    const completionPath = join(live.runDirectory, "run-completion.json");
    const identity = JSON.parse(await readFile(identityPath, "utf8"));
    identity.configuration.pipelines.update.updateEvaluator.sha256 =
      "0".repeat(64);
    const identityText = `${JSON.stringify(identity, null, 2)}\n`;
    await writeFile(identityPath, identityText, "utf8");
    const completion = JSON.parse(await readFile(completionPath, "utf8"));
    completion.identitySha256 = sha256(identityText);
    completion.artifacts["run-identity.json"] = sha256(identityText);
    await writeFile(completionPath, `${JSON.stringify(completion, null, 2)}\n`, "utf8");

    await expect(verifyPhase74HaluMemLiveRun(live.runDirectory)).rejects.toThrow(
      /pipeline.*trusted|update evaluator identity/iu,
    );
  });

  it("verify-only rejects the legacy combined safety pipeline identity", async () => {
    const live = await frozenLiveRun();
    const identityPath = join(live.runDirectory, "run-identity.json");
    const completionPath = join(live.runDirectory, "run-completion.json");
    const identity = JSON.parse(await readFile(identityPath, "utf8"));
    const { e4, privacy, update } = identity.configuration.pipelines;
    identity.configuration.pipelines = {
      e4,
      safety: { privacy, update },
    };
    const identityText = `${JSON.stringify(identity, null, 2)}\n`;
    await writeFile(identityPath, identityText, "utf8");
    const completion = JSON.parse(await readFile(completionPath, "utf8"));
    completion.identitySha256 = sha256(identityText);
    completion.artifacts["run-identity.json"] = sha256(identityText);
    await writeFile(completionPath, `${JSON.stringify(completion, null, 2)}\n`, "utf8");

    await expect(verifyPhase74HaluMemLiveRun(live.runDirectory)).rejects.toThrow(
      "pipeline identity is not split by suite",
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
    const usageSummary = JSON.parse(await readFile(
      join(live.runDirectory, "model-usage-summary.json"),
      "utf8",
    )) as { ingestion: Array<{ key: string }> };
    const key = usageSummary.ingestion[0]!.key;
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

  it("verify-only rejects a rehashed model-call identity that diverges from the frozen pipelines", async () => {
    const live = await frozenLiveRun();
    const identityPath = join(live.runDirectory, "run-identity.json");
    const completionPath = join(live.runDirectory, "run-completion.json");
    const identity = JSON.parse(await readFile(identityPath, "utf8"));
    identity.configuration.modelCalls.judge.gateway =
      "https://forged-judge.example/v1";
    const identityText = `${JSON.stringify(identity, null, 2)}\n`;
    await writeFile(identityPath, identityText, "utf8");
    const completion = JSON.parse(await readFile(completionPath, "utf8"));
    completion.identitySha256 = sha256(identityText);
    completion.artifacts["run-identity.json"] = sha256(identityText);
    await writeFile(
      completionPath,
      `${JSON.stringify(completion, null, 2)}\n`,
      "utf8",
    );

    await expect(verifyPhase74HaluMemLiveRun(live.runDirectory)).rejects.toThrow(
      /model.call|pipeline/iu,
    );
  });

  it("verify-only rejects a coherently rehashed run missing an expected E4 reader call", async () => {
    const live = await frozenLiveRun();
    await rewriteUsageEvidence({
      mutateDirect(direct) {
        const missing = direct.intents.find((intent) =>
          intent.branch === "baseline" &&
          intent.operation === "answer_generation" &&
          intent.caseId.endsWith(":legacy")
        )!;
        direct.intents = direct.intents.filter(
          ({ requestId }) => requestId !== missing.requestId,
        );
        direct.events = direct.events.filter(
          ({ requestId }) => requestId !== missing.requestId,
        );
      },
      runDirectory: live.runDirectory,
    });

    await expect(verifyPhase74HaluMemLiveRun(live.runDirectory)).rejects.toThrow(
      "usage population",
    );
  });

  it("verify-only rejects a coherently rehashed E4 call using the wrong model", async () => {
    const live = await frozenLiveRun();
    await rewriteUsageEvidence({
      mutateDirect(direct) {
        const intent = direct.intents.find((entry) =>
          entry.branch === "candidate" &&
          entry.operation === "answer_generation"
        )!;
        intent.modelId = "forged-reader";
        direct.events.find(({ requestId }) =>
          requestId === intent.requestId
        )!.modelId = intent.modelId;
      },
      runDirectory: live.runDirectory,
    });

    await expect(verifyPhase74HaluMemLiveRun(live.runDirectory)).rejects.toThrow(
      "usage model",
    );
  });

  it("verify-only rejects a coherently rehashed empty ingestion ledger", async () => {
    const live = await frozenLiveRun();
    await rewriteUsageEvidence({
      mutateIngestion(ingestion) {
        ingestion.events = [];
        ingestion.intents = [];
      },
      runDirectory: live.runDirectory,
    });

    await expect(verifyPhase74HaluMemLiveRun(live.runDirectory)).rejects.toThrow(
      "ingestion usage population",
    );
  });

  it("verify-only reconciles the durable call budget with every usage intent", async () => {
    const live = await frozenLiveRun();
    await rewriteUsageEvidence({
      mutateBudget(budget) {
        budget.languageCalls += 1;
      },
      runDirectory: live.runDirectory,
    });

    await expect(verifyPhase74HaluMemLiveRun(live.runDirectory)).rejects.toThrow(
      "call budget",
    );
  });

  it("verify-only rejects update decision usage that is not backed by its judge ledger event", async () => {
    const live = await frozenLiveRun();
    const raw = JSON.parse(await readFile(
      join(live.runDirectory, "update/raw.json"),
      "utf8",
    ));
    const decision = JSON.parse(raw.rows[0].candidate.rawOutput.decision);
    decision.usage.inputTokens += 1;
    raw.rows[0].candidate.rawOutput.decision = JSON.stringify(decision);
    await rewriteProtectionRaw({
      raw,
      runDirectory: live.runDirectory,
      suite: "update",
    });

    await expect(verifyPhase74HaluMemLiveRun(live.runDirectory)).rejects.toThrow(
      /judge.*usage|usage.*ledger/iu,
    );
  });

  it("verify-only rejects partial or unknown terminal usage", async () => {
    const live = await frozenLiveRun();
    const eventsPath = join(live.runDirectory, "model-usage.jsonl");
    const events = (await readFile(eventsPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    events[0].completeness = "partial";
    events[0].usage.outputTokens = null;
    await writeFile(
      eventsPath,
      `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
      "utf8",
    );

    await expect(verifyPhase74HaluMemLiveRun(live.runDirectory)).rejects.toThrow(
      /partial|unknown/iu,
    );
  });
});
