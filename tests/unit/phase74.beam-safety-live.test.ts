import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  PHASE74_BEAM_FULL_100K_DATASET_ID,
  PHASE74_BEAM_SAFETY_METRICS,
  PHASE74_BEAM_SAFETY_SUITE,
  PHASE74_BEAM_SAFETY_VERIFIER_ID,
} from "../../src/eval/phase74BeamSafetyProtection";
import {
  buildPhase74BeamSafetyLiveRunIdentity,
  buildPhase74BeamSafetyLiveSpec,
  createPhase74BeamGroundednessJudge,
  createPhase74BeamProtocolReader,
  createPhase74BeamSafetyLiveDependencies,
  PHASE74_BEAM_PROTOCOL_READER_SYSTEM_PROMPT,
} from "../../src/eval/phase74BeamSafetyLive";
import type {
  Phase74BeamSafetyLiveRetrievalRuntime,
} from "../../src/eval/phase74BeamSafetyLive";
import type {
  AttributedModelUsageAttempt,
  AttributedModelUsageIntent,
} from "../../src/eval/modelUsage";
import type { Phase74LiveModels } from "../../src/eval/phase74Live";
import {
  hashPhase74ProtectionSuiteIdentity,
} from "../../src/eval/phase74ProtectionSuiteEvidence";
import {
  parsePhase74ProtectionEvidenceCliOptions,
} from "../../scripts/build-phase-74-protection-evidence";
import {
  parsePhase74BeamSafetyProtectionCliOptions,
  runPhase74BeamSafetyProtectionCli,
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

function manifest(input: {
  datasetPath: string;
  datasetSha256: string;
  identityHash: string;
}) {
  const dataset = {
    id: PHASE74_BEAM_FULL_100K_DATASET_ID,
    path: input.datasetPath,
    sha256: input.datasetSha256,
  };
  const placeholder = (id: string, kind: string, metrics: string[]) => ({
    dataset,
    id,
    identityHash: "1".repeat(64),
    kind,
    requiredMetrics: metrics,
    verifierId: `${id}-verifier`,
  });
  return {
    admission: "canonical-verifier-bound-v1",
    artifactKind: "phase74-protection-suite-manifest",
    schemaVersion: 2,
    suites: [
      {
        dataset,
        id: PHASE74_BEAM_SAFETY_SUITE.id,
        identityHash: input.identityHash,
        kind: PHASE74_BEAM_SAFETY_SUITE.kind,
        requiredMetrics: [...PHASE74_BEAM_SAFETY_METRICS],
        verifierId: PHASE74_BEAM_SAFETY_VERIFIER_ID,
      },
      placeholder("mab", "benchmark-protection", ["retrieval"]),
      placeholder("halumem-e4", "e4", ["qa"]),
      placeholder("halumem-update", "safety", ["updateCorrectness"]),
      placeholder("halumem-privacy", "safety", ["privacyPassRate"]),
    ],
  };
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
        sha256: "a".repeat(64),
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
      replicate: 1,
      runId: "beam-r1",
    });
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

  it("matches the pre-bound manifest and writes identity before live providers are created", async () => {
    const root = await createRoot();
    const datasetPath = join(root, "100K.json");
    const manifestPath = join(root, "manifest.json");
    const outputDir = join(root, "out");
    const datasetBytes = fullDataset();
    await writeFile(datasetPath, datasetBytes);
    const evaluatorSource = {
      commit: "b".repeat(40),
      sha256: "c".repeat(64),
    };
    const spec = buildPhase74BeamSafetyLiveSpec({
      dataset: {
        id: PHASE74_BEAM_FULL_100K_DATASET_ID,
        sha256: sha256(datasetBytes),
      },
      models: models(),
      source: {
        id: `git:${evaluatorSource.commit}`,
        sha256: evaluatorSource.sha256,
      },
    });
    const identityHash = hashPhase74ProtectionSuiteIdentity(
      buildPhase74BeamSafetyLiveRunIdentity({ datasetBytes, spec }),
    );
    await writeFile(manifestPath, `${JSON.stringify(manifest({
      datasetPath,
      datasetSha256: sha256(datasetBytes),
      identityHash,
    }), null, 2)}\n`);
    let identityExistedBeforeProviderFactory = false;
    let providerCalls = 0;
    const result = await runPhase74BeamSafetyProtectionCli({
      caseConcurrency: 16,
      datasetPath,
      embeddingSpendLimitUsd: 1,
      manifestPath,
      maxLanguageCalls: 1000,
      outputDir,
      replicate: 1,
      runId: "beam-live-r1",
    }, {
      captureEvaluatorSource: async () => evaluatorSource,
      createLiveDependencies: ({ runDirectory }) => {
        identityExistedBeforeProviderFactory = existsSync(
          join(runDirectory, "run-identity.json"),
        );
        return {
          createPipeline: () => ({
            run: async () => {
              providerCalls += 1;
              return { rawAnswer: "No answer.", retrievedEvidenceIds: [] };
            },
          }),
          judgeGroundedness: async () => {
            providerCalls += 1;
            return {
              rationale: "The answer abstains.",
              schemaVersion: 1,
              verdict: "grounded",
            };
          },
        };
      },
      resolveModels: models,
    });

    expect(identityExistedBeforeProviderFactory).toBe(true);
    expect(providerCalls).toBe(160);
    expect(result.result.artifact.executionFailures).toBe(0);
    expect(existsSync(result.contractPath)).toBe(true);
    expect(existsSync(result.summaryPath)).toBe(true);
    const runIdentity = JSON.parse(await readFile(result.identityPath, "utf8"));
    expect(runIdentity.caseConcurrency).toBe(16);
    expect(runIdentity.protectionIdentityHash).toBe(identityHash);

    const tamperedManifestPath = join(root, "tampered-manifest.json");
    await writeFile(tamperedManifestPath, `${JSON.stringify(manifest({
      datasetPath,
      datasetSha256: sha256(datasetBytes),
      identityHash: "f".repeat(64),
    }), null, 2)}\n`);
    let tamperedFactoryCalls = 0;
    await expect(runPhase74BeamSafetyProtectionCli({
      caseConcurrency: 16,
      datasetPath,
      embeddingSpendLimitUsd: 1,
      manifestPath: tamperedManifestPath,
      maxLanguageCalls: 1000,
      outputDir,
      replicate: 2,
      runId: "beam-live-r2",
    }, {
      captureEvaluatorSource: async () => evaluatorSource,
      createLiveDependencies: () => {
        tamperedFactoryCalls += 1;
        throw new Error("must not create providers");
      },
      resolveModels: models,
    })).rejects.toThrow("does not match the pre-bound manifest");
    expect(tamperedFactoryCalls).toBe(0);
  });
});
