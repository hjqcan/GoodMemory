import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  PHASE74_BEAM_FULL_100K_DATASET_ID,
  PHASE74_BEAM_SAFETY_VERIFIER_ID,
} from "../../src/eval/phase74BeamSafetyProtection";
import {
  buildPhase74BeamSafetyLiveSpec,
  createPhase74BeamGroundednessJudge,
  createPhase74BeamProtocolReader,
  createPhase74BeamSafetyLiveDependencies,
  PHASE74_BEAM_FULL_100K_DATASET_PROVENANCE,
  PHASE74_BEAM_PROTOCOL_READER_SYSTEM_PROMPT,
} from "../../src/eval/phase74BeamSafetyLive";
import type {
  Phase74BeamSafetyLiveRetrievalRuntime,
} from "../../src/eval/phase74BeamSafetyLive";
import type {
  AttributedModelUsageAttempt,
  AttributedModelUsageIntent,
} from "../../src/eval/modelUsage";
import { buildPhase74EmbeddingIdentity } from "../../src/eval/phase74Live";
import type { Phase74LiveModels } from "../../src/eval/phase74Live";
import {
  buildPhase74IngestionUsageFingerprint,
} from "../../src/eval/phase74FullRuntime";
import {
  parsePhase74ProtectionEvidenceCliOptions,
} from "../../scripts/build-phase-74-protection-evidence";
import {
  assertPhase74BeamSafetyLiveRunClosure,
  loadPhase74BeamModelUsage,
  parsePhase74BeamSafetyProtectionCliOptions,
  runPhase74BeamSafetyProtectionCli,
  verifyPhase74BeamSafetyLiveRun,
} from "../../scripts/run-phase-74-beam-safety-protection";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { force: true, recursive: true })
  ));
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "phase74-beam-live-"));
  roots.push(root);
  return root;
}

function model(model: string): Phase74LiveModels["answer"] {
  return {
    apiKey: "test-key",
    baseURL: "https://ai.gurkiai.com/v1",
    model,
    provider: "openai",
  };
}

function models(): Phase74LiveModels {
  const answer = model("gpt-5.6-terra");
  const judge = model("gpt-5.5");
  return {
    answer,
    assistedExtraction: answer,
    embedding: {
      apiKey: "embedding-key",
      baseURL: "https://openrouter.ai/api/v1",
      model: "text-embedding-3-small",
      provider: "openai",
    },
    judge,
    planner: answer,
    reranker: answer,
  };
}

function sourceMessages() {
  return [{
    content: "The user discussed a project timeline.",
    id: 1,
    role: "user",
    timeAnchor: "2026-01-01T00:00:00.000Z",
  }];
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function fullDataset(): Uint8Array {
  const rows = Array.from({ length: 20 }, (_, conversationIndex) => ({
    chat: [[{
      content: `Conversation ${conversationIndex + 1} source.`,
      id: conversationIndex + 1,
      index: "1",
      question_type: "knowledge_update",
      role: "user",
      time_anchor: "2026-01-01T00:00:00.000Z",
    }]],
    conversation_id: `conversation-${conversationIndex + 1}`,
    conversation_plan: "Fixture plan.",
    conversation_seed: {
      category: "fixture",
      id: conversationIndex + 1,
      subtopics: [],
      theme: "fixture",
      title: "Fixture",
    },
    narratives: "Fixture narrative.",
    probing_questions: {
      abstention: Array.from({ length: 2 }, (_, questionIndex) => ({
        answer: "No answer",
        answerable: false,
        evidence_chat_ids: [],
        question: `Unknown detail ${conversationIndex + 1}-${questionIndex + 1}?`,
        question_id: `abstention-${conversationIndex + 1}-${questionIndex + 1}`,
        question_type: "abstention",
      })),
      knowledge_update: Array.from({ length: 18 }, (_, questionIndex) => ({
        answer: "Fixture answer",
        answerable: true,
        evidence_chat_ids: [conversationIndex + 1],
        question: `Known detail ${conversationIndex + 1}-${questionIndex + 1}?`,
        question_id: `known-${conversationIndex + 1}-${questionIndex + 1}`,
        question_type: "knowledge_update",
      })),
    },
    user_profile: {
      user_info: "Fixture user.",
      user_relationships: "No fixture relationships.",
    },
    user_questions: [],
  }));
  return Buffer.from(`${JSON.stringify(rows)}\n`);
}

function jsonResponse(content: unknown): Response {
  return new Response(JSON.stringify({
    choices: [{ message: { content: typeof content === "string"
      ? content
      : JSON.stringify(content) } }],
    usage: { completion_tokens: 2, prompt_tokens: 8 },
  }), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}

function liveRunClosure() {
  const callBudget = {
    embeddingCalls: 1,
    embeddingInputByteUpperBound: 200,
    embeddingSpendLimitUsd: 1,
    languageCalls: 4,
    maxLanguageCalls: 10,
    schemaVersion: 1,
  };
  const rawArtifact = {
    path: "/tmp/run/raw.json",
    sha256: "a".repeat(64),
  };
  return {
    callBudget,
    callBudgetSha256: "b".repeat(64),
    identity: {
      callBudget: {
        embeddingSpendLimitUsd: 1,
        maxLanguageCalls: 10,
      },
      caseConcurrency: 16,
      embedding: buildPhase74EmbeddingIdentity(models().embedding),
      replicate: 1,
      runId: "beam-r1",
    },
    protectionArtifact: {
      artifactKind: "phase74-frozen-protection-suite-run",
      executionFailures: 0,
      rawArtifact: { ...rawArtifact },
      replicate: 1,
      runId: "beam-r1",
      schemaVersion: 1,
    },
    summary: {
      artifactKind: "phase74-beam-safety-live-run-summary",
      callBudget,
      callBudgetArtifact: {
        path: "/tmp/run/call-budget.json",
        sha256: "b".repeat(64),
      },
      caseConcurrency: 16,
      executionFailures: 0,
      modelUsage: {
        completeRequestCount: 4,
        embeddingIntentCount: 1,
        eventCount: 5,
        missingRequestCount: 0,
        partialRequestCount: 1,
        pendingRequestCount: 0,
        intentCount: 5,
        languageIntentCount: 4,
      },
      rawArtifact,
      schemaVersion: 1,
      verifierId: PHASE74_BEAM_SAFETY_VERIFIER_ID,
    },
    usage: {
      completeRequestCount: 4,
      embeddingIntentCount: 1,
      eventCount: 5,
      intentCount: 5,
      languageIntentCount: 4,
      missingRequestCount: 0,
      partialRequestCount: 1,
      pendingRequestCount: 0,
    },
    verifiedRawArtifact: { ...rawArtifact },
  };
}

describe("Phase 74 BEAM safety live wiring", () => {
  it("uses one eval-only protocol reader whose insufficient-evidence answer is official-score replayable", async () => {
    const events: AttributedModelUsageAttempt[] = [];
    const intents: AttributedModelUsageIntent[] = [];
    const requestBodies: Array<Record<string, unknown>> = [];
    const reader = createPhase74BeamProtocolReader({
      events,
      fetch: async (_request, init) => {
        requestBodies.push(JSON.parse(String(init?.body)));
        return jsonResponse("No answer.");
      },
      intents,
      model: models().answer,
    });

    const baseline = await reader({
      attributionKey: "opaque-case",
      branch: "baseline",
      context: "Evidence one.",
      query: "What was decided?",
    });
    const candidate = await reader({
      attributionKey: "opaque-case",
      branch: "candidate",
      context: "Evidence one.",
      query: "What was decided?",
    });

    expect(baseline).toBe("No answer.");
    expect(candidate).toBe("No answer.");
    expect(PHASE74_BEAM_PROTOCOL_READER_SYSTEM_PROMPT).toContain("No answer");
    expect(requestBodies[0]!.messages).toEqual(requestBodies[1]!.messages);
    expect(events.map(({ branch }) => branch)).toEqual([
      "baseline",
      "candidate",
    ]);
    expect(intents).toHaveLength(2);
  });

  it("maps exact pipeline descriptors to E3 off vs deterministic without exposing labels", async () => {
    const liveModels = models();
    const spec = buildPhase74BeamSafetyLiveSpec({
      dataset: {
        id: PHASE74_BEAM_FULL_100K_DATASET_ID,
        sha256:
          PHASE74_BEAM_FULL_100K_DATASET_PROVENANCE.deterministicExport.sha256,
      },
      models: liveModels,
      source: { id: `git:${"b".repeat(40)}`, sha256: "c".repeat(64) },
    });
    const executions: unknown[] = [];
    const readerInputs: unknown[] = [];
    const runtime: Phase74BeamSafetyLiveRetrievalRuntime = {
      execute: async (input) => {
        executions.push(input);
        return {
          retrievedMemories: [{
            content: "Retrieved source message.",
            id: "memory-1",
            sourceIds: ["1"],
          }],
          snapshotId: "d".repeat(64),
          storedMemories: [],
        };
      },
    };
    const dependencies = createPhase74BeamSafetyLiveDependencies({
      groundednessJudge: async () => ({
        rationale: "The answer makes no unsupported claim.",
        schemaVersion: 1,
        verdict: "grounded",
      }),
      protocolReader: async (input) => {
        readerInputs.push(input);
        return "No answer.";
      },
      retrievalRuntime: runtime,
      spec,
    });
    const request = {
      answerModel: spec.contract.answerModel,
      answerPrompt: spec.contract.answerPrompt,
      attributionKey: "opaque-case",
      query: "What was decided?",
      reader: spec.contract.reader,
      renderedContextTokenLimit: 6_000,
      sourceMessages: sourceMessages(),
    };

    await dependencies.createPipeline(spec.contract.baselinePipeline).run({
      ...request,
      pipeline: spec.contract.baselinePipeline,
    });
    await dependencies.createPipeline(spec.contract.candidatePipeline).run({
      ...request,
      pipeline: spec.contract.candidatePipeline,
    });

    expect(executions).toHaveLength(2);
    expect(executions[0]).toMatchObject({
      arm: "recall-plan-off",
      stage: "E3",
      testCase: {
        caseId: "opaque-case",
        question: "What was decided?",
      },
    });
    expect(executions[1]).toMatchObject({
      arm: "recall-plan-deterministic",
      stage: "E3",
    });
    expect(JSON.stringify(executions)).not.toMatch(
      /answerable|questionType|expectedAnswer|goldEvidence/u,
    );
    expect(readerInputs).toHaveLength(2);
    expect(JSON.stringify(readerInputs)).not.toMatch(
      /answerable|questionType|expectedAnswer|goldEvidence/u,
    );
  });

  it("uses an independent strict groundedness object judge with durable usage attribution", async () => {
    const events: AttributedModelUsageAttempt[] = [];
    const intents: AttributedModelUsageIntent[] = [];
    const bodies: Array<Record<string, unknown>> = [];
    const judge = createPhase74BeamGroundednessJudge({
      events,
      fetch: async (_request, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return jsonResponse({
          rationale: "No factual claim was added.",
          schemaVersion: 1,
          verdict: "grounded",
        });
      },
      intents,
      model: models().judge,
    });

    await expect(judge({
      attributionKey: "opaque-case",
      branch: "baseline",
      groundednessJudgeModel: { id: "judge", sha256: "e".repeat(64) },
      groundednessPrompt: { id: "prompt", sha256: "f".repeat(64) },
      query: "What was decided?",
      rawAnswer: "No answer.",
      reader: { id: "reader", sha256: "a".repeat(64) },
      retrievedEvidence: sourceMessages(),
    })).resolves.toEqual({
      rationale: "No factual claim was added.",
      schemaVersion: 1,
      verdict: "grounded",
    });
    expect(intents).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      branch: "judge",
      caseId: "baseline:opaque-case",
      modelId: "gpt-5.5",
      operation: "judge",
    });
    expect(JSON.stringify(bodies)).not.toMatch(
      /answerable|questionType|expectedAnswer|goldEvidence/u,
    );
  });

  it("requires strict live-run and trusted-contract CLI inputs", async () => {
    const root = await createRoot();
    const contractPath = join(root, "contract.json");
    await writeFile(contractPath, "{}\n");

    expect(parsePhase74BeamSafetyProtectionCliOptions([
      "bun",
      "script",
      "--dataset-path",
      join(root, "100K.json"),
      "--manifest",
      join(root, "manifest.json"),
      "--output-dir",
      join(root, "out"),
      "--run-id",
      "beam-r1",
      "--replicate",
      "1",
      "--max-language-calls",
      "1000",
      "--embedding-spend-limit-usd",
      "1",
      "--case-concurrency",
      "24",
    ])).toMatchObject({
      caseConcurrency: 24,
      mode: "live",
      replicate: 1,
      runId: "beam-r1",
    });
    expect(parsePhase74BeamSafetyProtectionCliOptions([
      "bun",
      "script",
      "--preflight-only",
      "--dataset-path",
      join(root, "100K.json"),
      "--output-dir",
      join(root, "preflight"),
      "--run-id",
      "beam-preflight",
    ])).toMatchObject({
      mode: "preflight",
      runId: "beam-preflight",
    });
    expect(parsePhase74BeamSafetyProtectionCliOptions([
      "bun",
      "script",
      "--verify-only",
      "--run-directory",
      join(root, "run"),
      "--manifest",
      join(root, "manifest.json"),
    ])).toEqual({
      manifestPath: join(root, "manifest.json"),
      mode: "verify",
      runDirectory: join(root, "run"),
    });
    expect(() => parsePhase74BeamSafetyProtectionCliOptions([
      "bun",
      "script",
      "--verify-only",
      "--run-directory",
      join(root, "run"),
    ])).toThrow("--manifest");
    expect(() => parsePhase74BeamSafetyProtectionCliOptions([
      "bun",
      "script",
      "--run-id",
      "../escape",
    ])).toThrow();

    expect(parsePhase74ProtectionEvidenceCliOptions([
      "bun",
      "script",
      "--manifest",
      join(root, "manifest.json"),
      "--output",
      join(root, "evidence.json"),
      "--run-artifact",
      join(root, "run.json"),
      "--beam-contract",
      contractPath,
    ])).toMatchObject({ beamContractPath: contractPath });
    expect(() => parsePhase74ProtectionEvidenceCliOptions([
      "bun",
      "script",
      "--manifest",
      join(root, "manifest.json"),
      "--output",
      join(root, "evidence.json"),
      "--run-artifact",
      join(root, "run.json"),
      "--beam-contract",
      contractPath,
      "--beam-contract",
      contractPath,
    ])).toThrow("--beam-contract cannot be specified more than once");

    expect(await readFile(contractPath, "utf8")).toBe("{}\n");
  });

  it("pins the official HF revision, parquet LFS object, and deterministic export", () => {
    expect(PHASE74_BEAM_FULL_100K_DATASET_PROVENANCE).toEqual({
      deterministicExport: {
        format: "hf-datasets-server-rows-array-pretty-json-v1",
        sha256:
          "23a7b6bd1e69f775989df7a82f4f8441ce79e233fe88b858b451c1f23e71c162",
      },
      huggingFace: {
        parquetLfsSha256:
          "c0519be25907005ba873c927c50877471d550873039d96c041554d0075a78ace",
        parquetPath: "data/100K-00000-of-00001.parquet",
        repository: "Mohammadta/BEAM",
        revision: "3205395e897e7318c7b094ef4e6047b9b82dbb03",
      },
      schemaVersion: 1,
    });
    expect(() => buildPhase74BeamSafetyLiveSpec({
      dataset: {
        id: PHASE74_BEAM_FULL_100K_DATASET_ID,
        sha256: sha256(fullDataset()),
      },
      models: models(),
      source: { id: `git:${"b".repeat(40)}`, sha256: "c".repeat(64) },
    })).toThrow("official deterministic export SHA-256");
  });

  it("closes run, replicate, concurrency, budget, usage, and raw-artifact identity", () => {
    const valid = liveRunClosure();
    expect(() => assertPhase74BeamSafetyLiveRunClosure(valid)).not.toThrow();

    const mutations: Array<[string, (value: ReturnType<typeof liveRunClosure>) => void]> = [
      ["runId", (value) => {
        value.protectionArtifact.runId = "other-run";
      }],
      ["replicate", (value) => {
        value.protectionArtifact.replicate = 2;
      }],
      ["caseConcurrency", (value) => {
        value.summary.caseConcurrency = 8;
      }],
      ["call budget", (value) => {
        value.summary.callBudget.maxLanguageCalls = 11;
      }],
      ["call budget", (value) => {
        value.callBudget.languageCalls = 11;
        value.summary.callBudget.languageCalls = 11;
      }],
      ["call budget usage", (value) => {
        value.callBudget.languageCalls = 3;
        value.summary.callBudget.languageCalls = 3;
      }],
      ["call budget usage", (value) => {
        value.callBudget.embeddingCalls = 0;
        value.summary.callBudget.embeddingCalls = 0;
      }],
      ["call budget", (value) => {
        value.summary.callBudgetArtifact.sha256 = "c".repeat(64);
      }],
      ["summary identity", (value) => {
        value.summary.artifactKind = "wrong-summary-kind";
      }],
      ["executionFailures", (value) => {
        value.summary.executionFailures = 1;
      }],
      ["model usage", (value) => {
        value.summary.modelUsage.eventCount = 6;
      }],
      ["raw artifact", (value) => {
        value.summary.rawArtifact.path = "/tmp/run/other-raw.json";
      }],
    ];
    for (const [message, mutate] of mutations) {
      const value = structuredClone(valid);
      mutate(value);
      expect(() => assertPhase74BeamSafetyLiveRunClosure(value)).toThrow(message);
    }
  });

  it("prices embedding spend from the verifier-bound run identity", () => {
    const bge = liveRunClosure();
    bge.identity.embedding = buildPhase74EmbeddingIdentity({
      ...models().embedding,
      model: "baai/bge-m3",
    });
    bge.identity.callBudget.embeddingSpendLimitUsd = 0.15;
    bge.callBudget.embeddingInputByteUpperBound = 10_000_000;
    bge.callBudget.embeddingSpendLimitUsd = 0.15;
    bge.summary.callBudget.embeddingInputByteUpperBound = 10_000_000;
    bge.summary.callBudget.embeddingSpendLimitUsd = 0.15;
    expect(() => assertPhase74BeamSafetyLiveRunClosure(bge)).not.toThrow();

    const textSmall = structuredClone(bge);
    textSmall.identity.embedding = buildPhase74EmbeddingIdentity(
      models().embedding,
    );
    expect(() => assertPhase74BeamSafetyLiveRunClosure(textSmall)).toThrow(
      "call budget",
    );

    const unknown = liveRunClosure();
    unknown.identity.embedding.model = "unknown-embedding-model";
    expect(() => assertPhase74BeamSafetyLiveRunClosure(unknown)).toThrow(
      "Unsupported Phase 74 embedding model",
    );
  });

  it("replays every ingestion usage key and rejects a missing usage directory", async () => {
    const root = await createRoot();
    const key = "d".repeat(64);
    const eventsPath = join(root, "model-usage.jsonl");
    const intentsPath = join(root, "model-usage-intents.jsonl");
    const ingestionDirectory = join(root, "ingestion", key);
    const usageDirectory = join(root, "ingestion-usage", key);
    await Promise.all([
      mkdir(ingestionDirectory, { recursive: true }),
      mkdir(usageDirectory, { recursive: true }),
      writeFile(eventsPath, ""),
      writeFile(intentsPath, ""),
    ]);
    await Promise.all([
      writeFile(join(usageDirectory, "events.jsonl"), ""),
      writeFile(join(usageDirectory, "intents.jsonl"), ""),
      writeFile(join(ingestionDirectory, "manifest.json"), `${JSON.stringify({
        key,
        schemaVersion: 8,
        usage: buildPhase74IngestionUsageFingerprint({
          events: [],
          intents: [],
          pendingIntents: [],
        }),
      })}\n`),
    ]);

    await expect(loadPhase74BeamModelUsage({
      eventsPath,
      intentsPath,
      runDirectory: root,
    })).resolves.toMatchObject({
      ingestionKeyCount: 1,
      pendingIntents: [],
    });
    await rm(usageDirectory, { force: true, recursive: true });
    await expect(loadPhase74BeamModelUsage({
      eventsPath,
      intentsPath,
      runDirectory: root,
    })).rejects.toThrow("ingestion/ingestion-usage key sets drifted");
  });

  it("rejects a shape-correct synthetic preflight before models, fetch, or providers", async () => {
    const root = await createRoot();
    const datasetPath = join(root, "100K.json");
    const outputDir = join(root, "out");
    const datasetBytes = fullDataset();
    await writeFile(datasetPath, datasetBytes);
    const calls = { capture: 0, fetch: 0, providers: 0, resolveModels: 0 };

    await expect(runPhase74BeamSafetyProtectionCli({
      datasetPath,
      mode: "preflight",
      outputDir,
      runId: "beam-preflight",
    }, {
      captureEvaluatorSource: async () => {
        calls.capture += 1;
        throw new Error("source capture must happen only after dataset provenance");
      },
      createLiveDependencies: () => {
        calls.providers += 1;
        throw new Error("preflight must not create providers");
      },
      fetch: Object.assign(async () => {
        calls.fetch += 1;
        throw new Error("preflight must not fetch");
      }, { preconnect() {} }),
      resolveModels: () => {
        calls.resolveModels += 1;
        throw new Error("preflight must not resolve models");
      },
    })).rejects.toThrow("official deterministic export SHA-256");
    await expect(runPhase74BeamSafetyProtectionCli({
      caseConcurrency: 16,
      datasetPath,
      embeddingSpendLimitUsd: 1,
      manifestPath: join(root, "manifest.json"),
      maxLanguageCalls: 1_000,
      mode: "live",
      outputDir,
      replicate: 1,
      runId: "beam-live",
    }, {
      captureEvaluatorSource: async () => {
        calls.capture += 1;
        throw new Error("source capture must happen only after dataset provenance");
      },
      createLiveDependencies: () => {
        calls.providers += 1;
        throw new Error("live run must reject synthetic data before providers");
      },
      fetch: Object.assign(async () => {
        calls.fetch += 1;
        throw new Error("live run must reject synthetic data before fetch");
      }, { preconnect() {} }),
      resolveModels: () => {
        calls.resolveModels += 1;
        throw new Error("live run must reject synthetic data before models");
      },
    })).rejects.toThrow("official deterministic export SHA-256");
    expect(calls).toEqual({
      capture: 0,
      fetch: 0,
      providers: 0,
      resolveModels: 0,
    });
  });

  it("verify-only rejects forged provenance offline without resolving providers", async () => {
    const root = await createRoot();
    const runDirectory = join(root, "run");
    const datasetPath = join(root, "100K.json");
    await mkdir(runDirectory);
    await writeFile(datasetPath, fullDataset());
    await writeFile(join(runDirectory, "run-identity.json"), `${JSON.stringify({
      artifactKind: "phase74-beam-safety-live-run-identity",
      dataset: {
        id: PHASE74_BEAM_FULL_100K_DATASET_ID,
        path: datasetPath,
        provenance: PHASE74_BEAM_FULL_100K_DATASET_PROVENANCE,
        sha256:
          PHASE74_BEAM_FULL_100K_DATASET_PROVENANCE.deterministicExport.sha256,
      },
      schemaVersion: 1,
    })}\n`);
    const calls = { capture: 0, fetch: 0, providers: 0, resolveModels: 0 };

    await expect(runPhase74BeamSafetyProtectionCli({
      manifestPath: join(root, "manifest.json"),
      mode: "verify",
      runDirectory,
    }, {
      captureEvaluatorSource: async () => {
        calls.capture += 1;
        throw new Error("verify-only must not capture source");
      },
      createLiveDependencies: () => {
        calls.providers += 1;
        throw new Error("verify-only must not create providers");
      },
      fetch: Object.assign(async () => {
        calls.fetch += 1;
        throw new Error("verify-only must not fetch");
      }, { preconnect() {} }),
      resolveModels: () => {
        calls.resolveModels += 1;
        throw new Error("verify-only must not resolve models");
      },
    })).rejects.toThrow("official deterministic export SHA-256");
    expect(calls).toEqual({
      capture: 0,
      fetch: 0,
      providers: 0,
      resolveModels: 0,
    });
    await expect(verifyPhase74BeamSafetyLiveRun({
      manifestPath: join(root, "manifest.json"),
      runDirectory,
    })).rejects.toThrow("official deterministic export SHA-256");
  });
});
