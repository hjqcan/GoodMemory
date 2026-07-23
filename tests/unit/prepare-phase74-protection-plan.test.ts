import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "bun:test";

import { buildMemoryAgentBenchSmokeCases } from "../../src/eval/memoryAgentBench";
import {
  PHASE74_BEAM_FULL_100K_DATASET_ID,
  PHASE74_BEAM_SAFETY_SUITE,
} from "../../src/eval/phase74BeamSafetyProtection";
import {
  PHASE74_HALUMEM_E4_SUITE,
  PHASE74_HALUMEM_PRIVACY_SUITE,
  PHASE74_HALUMEM_UPDATE_SUITE,
} from "../../src/eval/phase74HaluMemProtectionVerifier";
import type { Phase74LiveModels } from "../../src/eval/phase74Live";
import {
  PHASE74_MAB_PROTECTION_DATASET_ID,
  PHASE74_MAB_PROTECTION_DATASET_PROVENANCE,
  PHASE74_MAB_PROTECTION_SUITE,
} from "../../src/eval/phase74MemoryAgentBenchProtectionVerifier";
import {
  hashPhase74ProtectionCaseIds,
} from "../../src/eval/phase74ProtectionContracts";
import {
  isPhase74ProtectionPlanPromotionAdmissible,
  loadPhase74ProtectionPlan,
} from "../../src/eval/phase74ProtectionPlan";
import {
  hashPhase74ProtectionValue,
} from "../../src/eval/phase74ProtectionRun";
import {
  PHASE74_PROTECTION_BLUEPRINT_ID,
} from "../../src/eval/phase74ProtectionVerifier";
import {
  hashPhase74ProtectionSuiteIdentity,
  loadPhase74ProtectionSuiteManifest,
} from "../../src/eval/phase74ProtectionSuiteEvidence";
import {
  parsePhase74ProtectionPlanBuilderCliOptions,
  preparePhase74ProtectionPlan,
} from "../../scripts/prepare-phase-74-protection-plan";
import {
  runPhase74MemoryAgentBenchProtection,
} from "../../scripts/phase-74-memory-agent-bench-protection";
import {
  PHASE74_HALUMEM_PROMOTION_USER_COUNT,
} from "../../scripts/run-phase-74-halumem-live-protection";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, {
    force: true,
    recursive: true,
  })));
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "phase74-plan-builder-"));
  roots.push(root);
  return root;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function descriptor(id: string, material: unknown = { id }) {
  return { id, sha256: hashPhase74ProtectionValue(material) };
}

function models(): Phase74LiveModels {
  const language = {
    apiKey: "test-key",
    baseURL: "https://ai.gurkiai.com/v1",
    model: "gpt-5.6-terra",
    provider: "openai" as const,
  };
  return {
    answer: language,
    assistedExtraction: language,
    embedding: {
      apiKey: "test-embedding-key",
      baseURL: "https://openrouter.ai/api/v1",
      model: "text-embedding-3-small",
      provider: "openai",
    },
    judge: {
      ...language,
      model: "gpt-5.5",
    },
    planner: language,
    reranker: language,
  };
}

function haluMemUser(uuid: string) {
  return {
    persona_info: `Persona ${uuid}`,
    sessions: [{
      dialogue: [{
        content: `Dialogue ${uuid}`,
        dialogue_turn: 1,
        role: "user",
        timestamp: "2026-01-01T00:00:00.000Z",
      }],
      memory_points: [{
        importance: 1,
        is_update: "True",
        memory_content: `Updated ${uuid}`,
        memory_source: "dialogue",
        memory_type: "fact",
        original_memories: [`Original ${uuid}`],
        timestamp: "2026-01-01T00:00:00.000Z",
      }],
      questions: [{
        answer: `Answer ${uuid}`,
        evidence: [{ memory_content: `Dialogue ${uuid}` }],
        question: `Question ${uuid}?`,
      }],
      start_time: "2026-01-01T00:00:00.000Z",
    }],
    uuid,
  };
}

async function fixtureOptions(root: string) {
  const benchmarkRoot = join(root, "mab");
  await mkdir(benchmarkRoot);
  await writeFile(
    join(benchmarkRoot, "cases.json"),
    `${JSON.stringify({ cases: buildMemoryAgentBenchSmokeCases() })}\n`,
    "utf8",
  );
  const haluMemDatasetPath = join(root, "halumem.jsonl");
  await writeFile(
    haluMemDatasetPath,
    Array.from(
      { length: PHASE74_HALUMEM_PROMOTION_USER_COUNT },
      (_, index) => JSON.stringify(haluMemUser(`user-${index + 1}`)),
    ).join("\n") + "\n",
    "utf8",
  );
  const beamDatasetPath = join(root, "beam.json");
  await writeFile(beamDatasetPath, "fixture beam bytes\n", "utf8");
  const protectionManifestPath = join(root, "protection-manifest.json");
  return {
    options: {
      beamCaseConcurrency: 7,
      beamDatasetPath,
      beamEmbeddingSpendLimitUsd: 0.75,
      beamMaxLanguageCalls: 5_000,
      haluMemCaseConcurrency: 5,
      haluMemDatasetPath,
      haluMemEmbeddingSpendLimitUsd: 0.5,
      haluMemMaxLanguageCalls: 4_000,
      mabBenchmarkRoot: benchmarkRoot,
      outputPath: join(root, "protection-plan.json"),
      protectionManifestPath,
      runIdPrefix: "phase74-protection",
    },
  };
}

describe("Phase 74 protection plan builder", () => {
  it("parses only the exact required create-only CLI contract", () => {
    const options = parsePhase74ProtectionPlanBuilderCliOptions([
      "--output", "./plan.json",
      "--protection-manifest", "./manifest.json",
      "--mab-benchmark-root", "./mab",
      "--halumem-dataset-path", "./halumem.jsonl",
      "--halumem-case-concurrency", "5",
      "--halumem-embedding-spend-limit-usd", "0.5",
      "--halumem-max-language-calls", "4000",
      "--beam-dataset-path", "./beam.json",
      "--beam-case-concurrency", "7",
      "--beam-embedding-spend-limit-usd", "0.75",
      "--beam-max-language-calls", "5000",
      "--run-id-prefix", "phase74-protection",
    ]);

    expect(options.outputPath).toMatch(/plan\.json$/);
    expect(() => parsePhase74ProtectionPlanBuilderCliOptions([
      "--unknown", "value",
    ])).toThrow(/unknown option/i);
    expect(() => parsePhase74ProtectionPlanBuilderCliOptions([
      "--mab-case-concurrency", "2",
    ])).toThrow(/unknown option/i);
    expect(() => parsePhase74ProtectionPlanBuilderCliOptions([
      "--mab-dataset-id", "mab-v1",
    ])).toThrow(/unknown option/i);
    expect(() => parsePhase74ProtectionPlanBuilderCliOptions([
      "--halumem-user-uuids", "user-a,user-b",
    ])).toThrow(/unknown option/i);
    expect(() => parsePhase74ProtectionPlanBuilderCliOptions([
      "--halumem-user-count", "2",
    ])).toThrow(/unknown option/i);
    expect(() => parsePhase74ProtectionPlanBuilderCliOptions([
      "--output", "one.json",
      "--output", "two.json",
    ])).toThrow(/more than once/i);
    expect(() => parsePhase74ProtectionPlanBuilderCliOptions([
      "--output", "plan.json",
    ])).toThrow(/requires --run-id-prefix/i);
  });

  it("fixes the promotion HaluMem population at all 19 unseen users", () => {
    expect(PHASE74_HALUMEM_PROMOTION_USER_COUNT).toBe(19);
  });

  it("pins the complete two-case MemoryAgentBench export provenance", () => {
    expect(PHASE74_MAB_PROTECTION_DATASET_ID).toContain(
      PHASE74_MAB_PROTECTION_DATASET_PROVENANCE.huggingFace.revision,
    );
    expect(PHASE74_MAB_PROTECTION_DATASET_PROVENANCE).toMatchObject({
      huggingFace: {
        conflictResolutionParquetSha256:
          "24d5c3f09ce0ce15625cb9f8a98f44f0d864ca6c94d7b4ad04eb697ca3a5ff45",
        revision: "7ea066982b140a19337e17e60d45d4076e042faf",
        testTimeLearningParquetSha256:
          "5338753be48f925d03318eed66117286e3489025fabe050a547bd086cd7d79c0",
      },
      normalized: {
        sha256:
          "c2a9f0d5ecd3dd1fbaddf5a28c3acac7226ce9a96e5e33e6197973b4ceb8e78f",
      },
      repository: {
        commit: "455306dcabc3842526eb83cd4e225e5d486c5c5d",
      },
    });
    expect(PHASE74_MAB_PROTECTION_DATASET_PROVENANCE.normalization).toEqual([
      {
        competency: "CR",
        maxEvidenceFacts: 3,
        maxQuestions: 0,
        merge: false,
        offset: 4,
        split: "Conflict_Resolution",
      },
      {
        competency: "TTL",
        maxEvidenceFacts: 3,
        maxQuestions: 30,
        merge: true,
        offset: 1,
        split: "Test_Time_Learning",
      },
    ]);
  });

  it("fails before source capture or dataset reads when output exists", async () => {
    const root = await createRoot();
    const { options } = await fixtureOptions(root);
    await writeFile(options.outputPath, "owner bytes\n", "utf8");
    let captured = false;
    let read = false;

    await expect(preparePhase74ProtectionPlan(options, {
      captureEvaluatorSource: async () => {
        captured = true;
        throw new Error("must not capture");
      },
      readFile: async () => {
        read = true;
        throw new Error("must not read");
      },
      resolveModels: () => {
        throw new Error("must not resolve models");
      },
    })).rejects.toThrow(/already exists/i);
    expect(captured).toBe(false);
    expect(read).toBe(false);
    expect(await readFile(options.outputPath, "utf8")).toBe("owner bytes\n");
  });

  it("treats the generated manifest path as create-only too", async () => {
    const root = await createRoot();
    const { options } = await fixtureOptions(root);
    await writeFile(
      options.protectionManifestPath,
      "manifest owner bytes\n",
      "utf8",
    );
    let captured = false;

    await expect(preparePhase74ProtectionPlan(options, {
      captureEvaluatorSource: async () => {
        captured = true;
        throw new Error("must not capture");
      },
      resolveModels: () => {
        throw new Error("must not resolve models");
      },
    })).rejects.toThrow(/already exists/i);
    expect(captured).toBe(false);
    expect(await readFile(options.protectionManifestPath, "utf8")).toBe(
      "manifest owner bytes\n",
    );
  });

  it("writes and reloads one manifest-bound schema-v4 five-suite matrix", async () => {
    const root = await createRoot();
    const { options } = await fixtureOptions(root);
    const source = {
      commit: "b".repeat(40),
      sha256: "c".repeat(64),
    };
    const loaded = await preparePhase74ProtectionPlan(options, {
      captureEvaluatorSource: async () => source,
      expectedHaluMemDatasetSha256: sha256(
        await readFile(options.haluMemDatasetPath),
      ),
      expectedMabDatasetSha256: sha256(
        await readFile(join(options.mabBenchmarkRoot, "cases.json")),
      ),
      prepareBeam: ({ datasetBytes, source: beamSource }) => {
        const dataset = {
          id: PHASE74_BEAM_FULL_100K_DATASET_ID,
          sha256: sha256(datasetBytes),
        };
        const caseIds = ["beam-abstention-a", "beam-abstention-b"];
        return {
          caseIds,
          identity: {
            dataset,
            judge: descriptor("beam-judge"),
            model: descriptor("beam-model"),
            pipeline: descriptor("beam-pipeline"),
            population: {
              caseCount: caseIds.length,
              caseIdsSha256: hashPhase74ProtectionCaseIds(caseIds),
              id: "beam-population",
            },
            prompt: descriptor("beam-prompt"),
            source: beamSource,
          },
        };
      },
      resolveModels: models,
    });

    expect(loaded.path).toBe(options.outputPath);
    expect(loaded.plan).toEqual(
      (await loadPhase74ProtectionPlan(options.outputPath)).plan,
    );
    expect(loaded.plan).toMatchObject({
      admission: { class: "diagnostic" },
      artifactKind: "phase74-protection-plan",
      evaluatorSource: {
        id: `git:${source.commit}`,
        sha256: source.sha256,
      },
      protectionBlueprint: {
        id: PHASE74_PROTECTION_BLUEPRINT_ID,
        sha256: sha256(await readFile(options.protectionManifestPath)),
      },
      schemaVersion: 4,
    });
    expect(loaded.plan.runs).toHaveLength(15);
    expect(isPhase74ProtectionPlanPromotionAdmissible(loaded.plan)).toBe(false);
    for (const suiteId of [
      PHASE74_MAB_PROTECTION_SUITE.id,
      PHASE74_HALUMEM_E4_SUITE.id,
      PHASE74_HALUMEM_UPDATE_SUITE.id,
      PHASE74_HALUMEM_PRIVACY_SUITE.id,
      PHASE74_BEAM_SAFETY_SUITE.id,
    ]) {
      expect(
        loaded.plan.runs.filter(({ suite }) => suite.id === suiteId)
          .map(({ replicate }) => replicate),
      ).toEqual([1, 2, 3]);
    }
    expect(
      loaded.plan.runs.find(
        ({ suite }) => suite.id === PHASE74_MAB_PROTECTION_SUITE.id,
      )?.controls,
    ).toMatchObject({
      callBudget: { id: "no-live-model-calls-v1" },
      caseConcurrency: 1,
      renderedContextTokens: 6_000,
    });
    expect(
      loaded.plan.runs.find(
        ({ suite }) => suite.id === PHASE74_BEAM_SAFETY_SUITE.id,
      )?.controls,
    ).toMatchObject({
      callBudget: { id: "embedding-language-call-budget-v1" },
      caseConcurrency: 7,
      renderedContextTokens: 6_000,
    });
    expect(loaded.plan.runs.map(({ runId }) => runId)).toContain(
      "phase74-protection-halumem-r1-update",
    );
    const manifest = await loadPhase74ProtectionSuiteManifest(
      options.protectionManifestPath,
    );
    expect(manifest.manifest.suites).toHaveLength(5);
    for (const entry of manifest.manifest.suites) {
      const run = loaded.plan.runs.find(({ suite }) => suite.id === entry.id)!;
      expect(entry.identityHash).toBe(
        hashPhase74ProtectionSuiteIdentity(run.identity),
      );
      expect(entry.dataset).toMatchObject(run.identity.dataset);
    }
    const mabRun = loaded.plan.runs.find(
      ({ replicate, suite }) =>
        replicate === 1 && suite.id === PHASE74_MAB_PROTECTION_SUITE.id,
    )!;
    const mabResult = await runPhase74MemoryAgentBenchProtection({
      artifactPath: join(root, "mab-run.json"),
      cases: buildMemoryAgentBenchSmokeCases(),
      dataset: mabRun.identity.dataset,
      protectionPlan: loaded,
      rawArtifactPath: join(root, "mab-raw.json"),
      replicate: 1,
      runId: mabRun.runId,
      source: mabRun.identity.source,
    });
    expect(mabResult.artifact.schemaVersion).toBe(2);
    expect(await readFile(options.outputPath, "utf8")).not.toContain(
      "test-key",
    );
  });

  it("rejects non-canonical MemoryAgentBench bytes before plan creation", async () => {
    const root = await createRoot();
    const { options } = await fixtureOptions(root);

    await expect(preparePhase74ProtectionPlan(options, {
      captureEvaluatorSource: async () => ({
        commit: "b".repeat(40),
        sha256: "c".repeat(64),
      }),
      resolveModels: models,
    })).rejects.toThrow(
      new RegExp(
        `official ${PHASE74_MAB_PROTECTION_DATASET_ID} dataset SHA-256`,
        "i",
      ),
    );
    await expect(readFile(options.outputPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(options.protectionManifestPath)).rejects
      .toMatchObject({ code: "ENOENT" });
  });

  it("rejects non-official HaluMem bytes without creating either artifact", async () => {
    const root = await createRoot();
    const { options } = await fixtureOptions(root);

    await expect(preparePhase74ProtectionPlan(options, {
      captureEvaluatorSource: async () => ({
        commit: "b".repeat(40),
        sha256: "c".repeat(64),
      }),
      expectedMabDatasetSha256: sha256(
        await readFile(join(options.mabBenchmarkRoot, "cases.json")),
      ),
      resolveModels: models,
    })).rejects.toThrow(/official HaluMem-Medium dataset SHA-256/i);
    await expect(readFile(options.outputPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(options.protectionManifestPath)).rejects
      .toMatchObject({ code: "ENOENT" });
  });
});
