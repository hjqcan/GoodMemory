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
  buildPhase74BeamSafetyProtectionRunIdentity,
  createPhase74BeamSafetyProtectionVerifier,
  PHASE74_BEAM_FULL_100K_DATASET_ID,
  PHASE74_BEAM_SAFETY_BUDGET,
  PHASE74_BEAM_SAFETY_SUITE,
  PHASE74_BEAM_SAFETY_VERIFIER_ID,
  runPhase74BeamSafetyProtection,
  verifyPhase74BeamSafetyProtectionArtifact,
} from "../../src/eval/phase74BeamSafetyProtection";
import type {
  Phase74BeamGroundednessJudgeRequest,
  Phase74BeamPipelineRequest,
  Phase74BeamSafetyContract,
} from "../../src/eval/phase74BeamSafetyProtection";
import {
  buildPhase74ProtectionPlan,
  describePhase74ProtectionCallBudget,
  loadPhase74ProtectionPlan,
} from "../../src/eval/phase74ProtectionPlan";
import {
  hashPhase74ProtectionValue,
  loadPhase74FrozenProtectionSuiteRunArtifact,
} from "../../src/eval/phase74ProtectionRun";
import {
  PHASE74_PROTECTION_BLUEPRINT_ID,
} from "../../src/eval/phase74ProtectionVerifier";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, {
    force: true,
    recursive: true,
  })));
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "phase74-beam-safety-"));
  roots.push(root);
  return root;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function descriptor(id: string, material: unknown) {
  return { id, sha256: hashPhase74ProtectionValue(material) };
}

function createFull100kDataset(): Uint8Array {
  const rows = Array.from({ length: 20 }, (_, rowIndex) => {
    const firstChatId = rowIndex * 10 + 1;
    return {
      chat: [[
        {
          content: `User evidence ${rowIndex}`,
          id: firstChatId,
          index: "1",
          question_type: "profile",
          role: "user",
          time_anchor: "2026-01-01T00:00:00.000Z",
        },
        {
          content: `Assistant evidence ${rowIndex}`,
          id: firstChatId + 1,
          index: "2",
          question_type: "profile",
          role: "assistant",
          time_anchor: "2026-01-01T00:01:00.000Z",
        },
      ]],
      conversation_id: `conversation-${rowIndex + 1}`,
      conversation_plan: "A deterministic full-shape test fixture.",
      conversation_seed: {
        category: "test",
        id: rowIndex + 1,
        subtopics: ["memory"],
        theme: "safety",
        title: `Conversation ${rowIndex + 1}`,
      },
      narratives: "Fixture narrative.",
      probing_questions: {
        abstention: Array.from({ length: 2 }, (_, questionIndex) => ({
          answer: "No answer.",
          evidence_chat_ids: [],
          question:
            `What unsupported fact ${rowIndex + 1}-${questionIndex + 1} should be recalled?`,
          question_id: `${rowIndex + 1}:abstention:${questionIndex + 1}`,
          question_type: "abstention",
        })),
        knowledge_update: Array.from({ length: 18 }, (_, questionIndex) => ({
          answer: `Known answer ${rowIndex + 1}-${questionIndex + 1}`,
          evidence_chat_ids: [firstChatId],
          question: `Known question ${rowIndex + 1}-${questionIndex + 1}?`,
          question_id:
            `${rowIndex + 1}:knowledge_update:${questionIndex + 1}`,
          question_type: "knowledge_update",
        })),
      },
      user_profile: {
        user_info: "Fixture user.",
        user_relationships: "No fixture relationships.",
      },
      user_questions: [],
    };
  });
  return Buffer.from(`${JSON.stringify(rows)}\n`);
}

function createContract(datasetBytes: Uint8Array): Phase74BeamSafetyContract {
  return {
    answerModel: descriptor("answer-model-v1", { temperature: 0 }),
    answerPrompt: descriptor("query-only-reader-prompt-v1", "query+evidence"),
    baselinePipeline: descriptor("legacy-memory-pipeline-v1", "legacy"),
    candidatePipeline: descriptor("phase74-memory-pipeline-v1", "phase74"),
    dataset: {
      id: PHASE74_BEAM_FULL_100K_DATASET_ID,
      sha256: sha256(datasetBytes),
    },
    groundednessJudgeModel: descriptor("independent-judge-model-v1", {
      temperature: 0,
    }),
    groundednessPrompt: descriptor(
      "groundedness-structured-prompt-v1",
      "verdict+rationale",
    ),
    reader: descriptor("generic-query-only-reader-v1", "no benchmark labels"),
    source: descriptor("checkout-source-v1", "source bytes"),
  };
}

function createDependencies(input: {
  judgeCalls: Phase74BeamGroundednessJudgeRequest[];
  pipelineRequests: Phase74BeamPipelineRequest[];
}) {
  const pipelineFactoryCalls: string[] = [];
  return {
    dependencies: {
      createPipeline: (pipeline: { id: string; sha256: string }) => {
        pipelineFactoryCalls.push(pipeline.id);
        let localCallCount = 0;
        return {
          run: async (request: Phase74BeamPipelineRequest) => {
            localCallCount += 1;
            input.pipelineRequests.push(request);
            return {
              rawAnswer: pipeline.id.startsWith("legacy")
                ? "No answer."
                : "An unsupported answer.",
              retrievedEvidenceIds: [request.sourceMessages[0]!.id],
              runtimeCallIndex: localCallCount,
            };
          },
        };
      },
      judgeGroundedness: async (
        request: Phase74BeamGroundednessJudgeRequest,
      ) => {
        input.judgeCalls.push(request);
        return {
          rationale: "Deterministic fake groundedness judgment.",
          schemaVersion: 1,
          verdict: request.rawAnswer === "No answer."
            ? "grounded"
            : "hallucinated",
        };
      },
    },
    pipelineFactoryCalls,
  };
}

async function rewriteRawArtifact(input: {
  artifactPath: string;
  mutate: (raw: Record<string, unknown>) => void;
  rawArtifactPath: string;
}): Promise<void> {
  const raw = JSON.parse(
    await readFile(input.rawArtifactPath, "utf8"),
  ) as Record<string, unknown>;
  input.mutate(raw);
  const rawText = `${JSON.stringify(raw, null, 2)}\n`;
  await writeFile(input.rawArtifactPath, rawText, "utf8");
  const artifact = JSON.parse(
    await readFile(input.artifactPath, "utf8"),
  ) as { rawArtifact: { sha256: string } };
  artifact.rawArtifact.sha256 = sha256(rawText);
  await writeFile(
    input.artifactPath,
    `${JSON.stringify(artifact, null, 2)}\n`,
    "utf8",
  );
}

describe("Phase 74 BEAM full-100K safety protection adapter", () => {
  it("runs isolated paired pipelines with one query-only reader and 6k budget", async () => {
    const root = await createRoot();
    const datasetBytes = createFull100kDataset();
    const contract = createContract(datasetBytes);
    const pipelineRequests: Phase74BeamPipelineRequest[] = [];
    const judgeCalls: Phase74BeamGroundednessJudgeRequest[] = [];
    const { dependencies, pipelineFactoryCalls } = createDependencies({
      judgeCalls,
      pipelineRequests,
    });
    const result = await runPhase74BeamSafetyProtection({
      artifactPath: join(root, "run.json"),
      contract,
      datasetBytes,
      rawArtifactPath: join(root, "raw.json"),
      replicate: 1,
      runId: "beam-safety-r1",
    }, dependencies);

    expect(result.artifact.executionFailures).toBe(0);
    expect(result.artifact.rows).toHaveLength(40);
    expect(result.artifact.rows[0]!.baseline.safety).toEqual({
      abstentionAccuracy: 1,
      hallucinationRate: 0,
    });
    expect(result.artifact.rows[0]!.candidate.safety).toEqual({
      abstentionAccuracy: 0,
      hallucinationRate: 1,
    });
    expect(pipelineFactoryCalls).toEqual([
      contract.baselinePipeline.id,
      contract.candidatePipeline.id,
    ]);
    expect(pipelineRequests).toHaveLength(80);
    expect(judgeCalls).toHaveLength(80);

    for (let index = 0; index < pipelineRequests.length; index += 2) {
      const baseline = pipelineRequests[index]!;
      const candidate = pipelineRequests[index + 1]!;
      const { pipeline: baselinePipeline, ...baselineShared } = baseline;
      const { pipeline: candidatePipeline, ...candidateShared } = candidate;
      expect(baselineShared).toEqual(candidateShared);
      expect(baseline.query).toBe(candidate.query);
      expect(baseline.reader).toEqual(candidate.reader);
      expect(baseline.renderedContextTokenLimit).toBe(
        PHASE74_BEAM_SAFETY_BUDGET.renderedContextTokens,
      );
      expect(candidate.renderedContextTokenLimit).toBe(
        PHASE74_BEAM_SAFETY_BUDGET.renderedContextTokens,
      );
      expect(baseline.sourceMessages).toEqual(candidate.sourceMessages);
      expect(baseline.sourceMessages).not.toBe(candidate.sourceMessages);
      expect(baselinePipeline).toEqual(contract.baselinePipeline);
      expect(candidatePipeline).toEqual(contract.candidatePipeline);
      expect(baseline).not.toHaveProperty("answer");
      expect(baseline).not.toHaveProperty("answerable");
      expect(baseline).not.toHaveProperty("evidenceChatIds");
      expect(baseline).not.toHaveProperty("questionType");
    }

    const raw = JSON.parse(await readFile(result.rawArtifactPath, "utf8"));
    expect(raw.rows[0].baseline.rawOutput).toEqual({
      groundednessJudge: {
        rationale: "Deterministic fake groundedness judgment.",
        schemaVersion: 1,
        verdict: "grounded",
      },
      rawAnswer: "No answer.",
      retrievedEvidenceIds: [1],
    });
    expect(raw.rows[0].candidate.rawOutput.groundednessJudge.verdict).toBe(
      "hallucinated",
    );
  });

  it("passes bounded case concurrency through to the shared protection runner", async () => {
    const root = await createRoot();
    const datasetBytes = createFull100kDataset();
    const contract = createContract(datasetBytes);
    let active = 0;
    let maxActive = 0;

    await runPhase74BeamSafetyProtection({
      artifactPath: join(root, "concurrent-run.json"),
      caseConcurrency: 4,
      contract,
      datasetBytes,
      rawArtifactPath: join(root, "concurrent-raw.json"),
      replicate: 1,
      runId: "beam-safety-concurrent-r1",
    }, {
      createPipeline: () => ({
        run: async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 1));
          active -= 1;
          return { rawAnswer: "No answer.", retrievedEvidenceIds: [] };
        },
      }),
      judgeGroundedness: async () => ({
        rationale: "The answer abstains.",
        schemaVersion: 1,
        verdict: "grounded",
      }),
    });

    expect(maxActive).toBeGreaterThan(1);
    expect(maxActive).toBeLessThanOrEqual(4);
  });

  it("verifies actual live controls before providers and emits schema v2", async () => {
    const root = await createRoot();
    const datasetBytes = createFull100kDataset();
    const contract = createContract(datasetBytes);
    const identity = buildPhase74BeamSafetyProtectionRunIdentity({
      contract,
      datasetBytes,
    });
    const caseIds = Array.from({ length: 20 }, (_, conversationIndex) =>
      Array.from({ length: 2 }, (_, questionIndex) =>
        `${conversationIndex + 1}:abstention:${questionIndex + 1}`
      )
    ).flat();
    const exactBudget = {
      embeddingSpendLimitUsd: 0.25,
      maxLanguageCalls: 1_000,
    };
    const blueprint = descriptor(
      PHASE74_PROTECTION_BLUEPRINT_ID,
      "exact protection manifest bytes",
    );
    const buildPlan = async (input: {
      blueprintId?: string;
      caseConcurrency: number;
      liveCallBudget: typeof exactBudget;
      path: string;
    }) => {
      const planBlueprint = {
        ...blueprint,
        id: input.blueprintId ?? blueprint.id,
      };
      const plan = buildPhase74ProtectionPlan({
        admissionClass: "diagnostic",
        evaluatorSource: contract.source,
        protectionBlueprint: planBlueprint,
        runs: [{
          caseIds,
          controls: {
            callBudget: describePhase74ProtectionCallBudget(
              input.liveCallBudget,
            ),
            caseConcurrency: input.caseConcurrency,
            renderedContextTokens:
              PHASE74_BEAM_SAFETY_BUDGET.renderedContextTokens,
          },
          identity,
          protectionBlueprint: planBlueprint,
          replicate: 1,
          runId: "beam-planned-r1",
          suite: PHASE74_BEAM_SAFETY_SUITE,
          verifier: descriptor(PHASE74_BEAM_SAFETY_VERIFIER_ID, {
            id: PHASE74_BEAM_SAFETY_VERIFIER_ID,
          }),
        }],
      });
      await writeFile(input.path, `${JSON.stringify(plan, null, 2)}\n`);
      return loadPhase74ProtectionPlan(input.path);
    };

    const driftCases = [
      {
        caseConcurrency: 3,
        liveCallBudget: exactBudget,
        message: "drifted from its pre-execution plan",
        suffix: "concurrency",
      },
      {
        caseConcurrency: 4,
        liveCallBudget: {
          ...exactBudget,
          maxLanguageCalls: exactBudget.maxLanguageCalls + 1,
        },
        message: "drifted from its pre-execution plan",
        suffix: "call-budget",
      },
      {
        blueprintId: "not-the-canonical-protection-blueprint",
        caseConcurrency: 4,
        liveCallBudget: exactBudget,
        message: "canonical protection blueprint",
        suffix: "blueprint",
      },
    ] as const;
    for (const drift of driftCases) {
      const loadedPlan = await buildPlan({
        ...("blueprintId" in drift
          ? { blueprintId: drift.blueprintId }
          : {}),
        caseConcurrency: drift.caseConcurrency,
        liveCallBudget: drift.liveCallBudget,
        path: join(root, `${drift.suffix}-plan.json`),
      });
      const artifactPath = join(root, `${drift.suffix}-run.json`);
      const rawArtifactPath = join(root, `${drift.suffix}-raw.json`);
      let providerCalls = 0;
      await expect(runPhase74BeamSafetyProtection({
        artifactPath,
        caseConcurrency: 4,
        contract,
        datasetBytes,
        protectionPlan: {
          ...exactBudget,
          loadedPlan,
        },
        rawArtifactPath,
        replicate: 1,
        runId: "beam-planned-r1",
      }, {
        createPipeline: () => {
          providerCalls += 1;
          throw new Error("provider must not run");
        },
        judgeGroundedness: async () => {
          providerCalls += 1;
          throw new Error("judge must not run");
        },
      })).rejects.toThrow(drift.message);
      expect(providerCalls).toBe(0);
      expect(await Bun.file(artifactPath).exists()).toBe(false);
      expect(await Bun.file(rawArtifactPath).exists()).toBe(false);
    }

    const loadedPlan = await buildPlan({
      caseConcurrency: 4,
      liveCallBudget: exactBudget,
      path: join(root, "protection-plan.json"),
    });
    const pipelineRequests: Phase74BeamPipelineRequest[] = [];
    const judgeCalls: Phase74BeamGroundednessJudgeRequest[] = [];
    const { dependencies } = createDependencies({
      judgeCalls,
      pipelineRequests,
    });
    const result = await runPhase74BeamSafetyProtection({
      artifactPath: join(root, "planned-run.json"),
      caseConcurrency: 4,
      contract,
      datasetBytes,
      protectionPlan: {
        ...exactBudget,
        loadedPlan,
      },
      rawArtifactPath: join(root, "planned-raw.json"),
      replicate: 1,
      runId: "beam-planned-r1",
    }, dependencies);
    expect(result.artifact.schemaVersion).toBe(2);
    expect(result.artifact).toMatchObject({
      planPath: loadedPlan.path,
      planSha256: loadedPlan.sha256,
    });
  });

  it("rejects smoke, synthetic, and incomplete populations before providers run", async () => {
    const root = await createRoot();
    const fullBytes = createFull100kDataset();
    for (const datasetId of ["beam-100k-smoke", "beam-synthetic"] as const) {
      const contract = {
        ...createContract(fullBytes),
        dataset: { id: datasetId, sha256: sha256(fullBytes) },
      };
      await expect(runPhase74BeamSafetyProtection({
        artifactPath: join(root, `${datasetId}-run.json`),
        contract,
        datasetBytes: fullBytes,
        rawArtifactPath: join(root, `${datasetId}-raw.json`),
        replicate: 1,
        runId: `${datasetId}-r1`,
      }, {
        createPipeline: () => {
          throw new Error("provider must not run");
        },
        judgeGroundedness: async () => {
          throw new Error("judge must not run");
        },
      })).rejects.toThrow("pinned BEAM full-100K dataset");
    }

    const incomplete = Buffer.from("[]\n");
    const incompleteContract = createContract(incomplete);
    await expect(runPhase74BeamSafetyProtection({
      artifactPath: join(root, "incomplete-run.json"),
      contract: incompleteContract,
      datasetBytes: incomplete,
      rawArtifactPath: join(root, "incomplete-raw.json"),
      replicate: 1,
      runId: "incomplete-r1",
    }, {
      createPipeline: () => {
        throw new Error("provider must not run");
      },
      judgeGroundedness: async () => {
        throw new Error("judge must not run");
      },
    })).rejects.toThrow("20 conversations and 400 questions");

    const driftedBytes = Buffer.concat([fullBytes, Buffer.from(" \n")]);
    await expect(runPhase74BeamSafetyProtection({
      artifactPath: join(root, "sha-drift-run.json"),
      contract: createContract(fullBytes),
      datasetBytes: driftedBytes,
      rawArtifactPath: join(root, "sha-drift-raw.json"),
      replicate: 1,
      runId: "sha-drift-r1",
    }, {
      createPipeline: () => {
        throw new Error("provider must not run");
      },
      judgeGroundedness: async () => {
        throw new Error("judge must not run");
      },
    })).rejects.toThrow("pinned SHA-256");
  });

  it("rejects a shared baseline and candidate runtime", async () => {
    const root = await createRoot();
    const datasetBytes = createFull100kDataset();
    const sharedRuntime = {
      run: async () => ({
        rawAnswer: "No answer.",
        retrievedEvidenceIds: [],
      }),
    };
    await expect(runPhase74BeamSafetyProtection({
      artifactPath: join(root, "run.json"),
      contract: createContract(datasetBytes),
      datasetBytes,
      rawArtifactPath: join(root, "raw.json"),
      replicate: 1,
      runId: "shared-runtime-r1",
    }, {
      createPipeline: () => sharedRuntime,
      judgeGroundedness: async () => {
        throw new Error("judge must not run");
      },
    })).rejects.toThrow("isolated baseline and candidate pipeline runtimes");
  });

  it("recomputes safety metrics offline and detects raw answer tampering", async () => {
    const root = await createRoot();
    const datasetBytes = createFull100kDataset();
    const contract = createContract(datasetBytes);
    const pipelineRequests: Phase74BeamPipelineRequest[] = [];
    const judgeCalls: Phase74BeamGroundednessJudgeRequest[] = [];
    const { dependencies } = createDependencies({
      judgeCalls,
      pipelineRequests,
    });
    const result = await runPhase74BeamSafetyProtection({
      artifactPath: join(root, "run.json"),
      contract,
      datasetBytes,
      rawArtifactPath: join(root, "raw.json"),
      replicate: 1,
      runId: "beam-safety-exact-r1",
    }, dependencies);
    const providerCallCount = pipelineRequests.length + judgeCalls.length;

    await expect(verifyPhase74BeamSafetyProtectionArtifact({
      artifactPath: result.artifactPath,
      contract,
      datasetBytes,
    })).resolves.toMatchObject({ runId: "beam-safety-exact-r1" });
    expect(pipelineRequests.length + judgeCalls.length).toBe(providerCallCount);

    await rewriteRawArtifact({
      artifactPath: result.artifactPath,
      mutate: (raw) => {
        const rows = raw.rows as Array<{
          baseline: { rawOutput: { rawAnswer: string } };
        }>;
        rows[0]!.baseline.rawOutput.rawAnswer = "A fabricated answer.";
      },
      rawArtifactPath: result.rawArtifactPath,
    });
    await expect(verifyPhase74BeamSafetyProtectionArtifact({
      artifactPath: result.artifactPath,
      contract,
      datasetBytes,
    })).rejects.toThrow("safety score drifted");
    expect(pipelineRequests.length + judgeCalls.length).toBe(providerCallCount);
  });

  it("exposes a suite verifier only when bound to a trusted evaluator contract", async () => {
    const root = await createRoot();
    const datasetBytes = createFull100kDataset();
    const contract = createContract(datasetBytes);
    const pipelineRequests: Phase74BeamPipelineRequest[] = [];
    const judgeCalls: Phase74BeamGroundednessJudgeRequest[] = [];
    const { dependencies } = createDependencies({
      judgeCalls,
      pipelineRequests,
    });
    const result = await runPhase74BeamSafetyProtection({
      artifactPath: join(root, "run.json"),
      contract,
      datasetBytes,
      rawArtifactPath: join(root, "raw.json"),
      replicate: 1,
      runId: "beam-safety-wrapper-r1",
    }, dependencies);
    const run = await loadPhase74FrozenProtectionSuiteRunArtifact(
      result.artifactPath,
    );
    const providerCallCount = pipelineRequests.length + judgeCalls.length;
    const verifier = createPhase74BeamSafetyProtectionVerifier(contract);

    expect(verifier).toMatchObject({
      kind: "safety",
      requiredMetrics: ["abstentionAccuracy", "hallucinationRate"],
      suiteId: "beam-full-100k-abstention-groundedness-safety-v1",
    });
    await expect(verifier.verify({
      dataset: { ...contract.dataset, path: join(root, "100K.json") },
      datasetBytes,
      run,
    })).resolves.toBeUndefined();
    expect(pipelineRequests.length + judgeCalls.length).toBe(providerCallCount);

    await expect(verifier.verify({
      dataset: {
        ...contract.dataset,
        path: join(root, "100K.json"),
        sha256: "f".repeat(64),
      },
      datasetBytes,
      run,
    })).rejects.toThrow("trusted dataset identity drifted");
    expect(pipelineRequests.length + judgeCalls.length).toBe(providerCallCount);
  });

  it("fails closed when selection, source, model, prompt, or population identity drifts", async () => {
    const fields = ["judge", "pipeline", "source", "model", "prompt"] as const;
    for (const field of fields) {
      const root = await createRoot();
      const datasetBytes = createFull100kDataset();
      const contract = createContract(datasetBytes);
      const { dependencies } = createDependencies({
        judgeCalls: [],
        pipelineRequests: [],
      });
      const result = await runPhase74BeamSafetyProtection({
        artifactPath: join(root, "run.json"),
        contract,
        datasetBytes,
        rawArtifactPath: join(root, "raw.json"),
        replicate: 1,
        runId: `beam-safety-${field}-r1`,
      }, dependencies);
      const artifact = JSON.parse(await readFile(result.artifactPath, "utf8"));
      artifact.identity[field].sha256 = "f".repeat(64);
      await writeFile(
        result.artifactPath,
        `${JSON.stringify(artifact, null, 2)}\n`,
        "utf8",
      );
      await expect(verifyPhase74BeamSafetyProtectionArtifact({
        artifactPath: result.artifactPath,
        contract,
        datasetBytes,
      })).rejects.toThrow("evaluator identity drifted");
    }

    const root = await createRoot();
    const datasetBytes = createFull100kDataset();
    const contract = createContract(datasetBytes);
    const { dependencies } = createDependencies({
      judgeCalls: [],
      pipelineRequests: [],
    });
    const result = await runPhase74BeamSafetyProtection({
      artifactPath: join(root, "population-run.json"),
      contract,
      datasetBytes,
      rawArtifactPath: join(root, "population-raw.json"),
      replicate: 1,
      runId: "beam-safety-population-r1",
    }, dependencies);
    const artifact = JSON.parse(await readFile(result.artifactPath, "utf8"));
    artifact.identity.population.id = "different-population";
    await writeFile(
      result.artifactPath,
      `${JSON.stringify(artifact, null, 2)}\n`,
      "utf8",
    );
    await expect(verifyPhase74BeamSafetyProtectionArtifact({
      artifactPath: result.artifactPath,
      contract,
      datasetBytes,
    })).rejects.toThrow("population identity drifted");
  });
});
