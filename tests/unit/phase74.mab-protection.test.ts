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

import {
  buildMemoryAgentBenchSmokeCases,
} from "../../src/eval/memoryAgentBench";
import {
  buildPhase74ProtectionPlan,
  describePhase74ProtectionCallBudget,
  loadPhase74ProtectionPlan,
} from "../../src/eval/phase74ProtectionPlan";
import {
  hashPhase74ProtectionValue,
  loadPhase74FrozenProtectionSuiteRunArtifact,
  runPhase74ProtectionSuiteCases,
} from "../../src/eval/phase74ProtectionRun";
import type {
  Phase74ProtectionSuiteBranchScores,
  Phase74ProtectionSuiteKind,
} from "../../src/eval/phase74ProtectionRun";
import {
  buildPhase74FrozenProtectionSuiteEvidence,
  hashPhase74ProtectionSuiteIdentity,
} from "../../src/eval/phase74ProtectionSuiteEvidence";
import type {
  Phase74ProtectionSuiteManifest,
} from "../../src/eval/phase74ProtectionSuiteEvidence";
import {
  PHASE74_MAB_PROTECTION_SUITE,
  PHASE74_MAB_PROTECTION_VERIFIER_ID,
  PHASE74_MEMORY_AGENT_BENCH_PROTECTION_VERIFIER,
} from "../../src/eval/phase74MemoryAgentBenchProtectionVerifier";
import type {
  Phase74ProtectionSuiteVerifier,
} from "../../src/eval/phase74ProtectionVerifier";
import {
  PHASE74_PROTECTION_BLUEPRINT_ID,
} from "../../src/eval/phase74ProtectionVerifier";
import {
  buildPhase74MemoryAgentBenchProtectionPlanIdentity,
  createPhase74MemoryAgentBenchOfflineMemory,
  PHASE74_MAB_PROTECTION_METRICS,
  runPhase74MemoryAgentBenchProtection,
  verifyPhase74MemoryAgentBenchProtectionArtifact,
} from "../../scripts/phase-74-memory-agent-bench-protection";
import {
  buildMemoryAgentBenchScope,
  seedMemoryAgentBenchCase,
} from "../../scripts/run-phase-64-memory-agent-bench-smoke";
import {
  parsePhase74MemoryAgentBenchProtectionCliOptions,
  runPhase74MemoryAgentBenchProtectionCli,
} from "../../scripts/run-phase-74-memory-agent-bench-protection";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, {
    force: true,
    recursive: true,
  })));
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "phase74-mab-protection-"));
  roots.push(root);
  return root;
}

function descriptor(id: string, digit: string) {
  return { id, sha256: digit.repeat(64) };
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalDescriptor(id: string) {
  return { id, sha256: hashPhase74ProtectionValue({ id }) };
}

interface MutableSuiteRawIdentity {
  population: { caseCount: number };
  replicate: number;
  runId: string;
  suite: { id: string };
}

async function rewriteRawArtifact(input: {
  artifactPath: string;
  rawArtifactPath: string;
  raw: string;
}): Promise<void> {
  await writeFile(input.rawArtifactPath, input.raw, "utf8");
  const artifact = JSON.parse(await readFile(input.artifactPath, "utf8"));
  artifact.rawArtifact.sha256 = sha256(input.raw);
  await writeFile(
    input.artifactPath,
    `${JSON.stringify(artifact, null, 2)}\n`,
    "utf8",
  );
}

describe("Phase 74 MemoryAgentBench protection adapter", () => {
  it("exports the canonical ordered population and run identity for planning", () => {
    const cases = buildMemoryAgentBenchSmokeCases();
    const dataset = descriptor("memoryagentbench-synthetic-ar", "1");
    const source = descriptor("source-under-test", "2");
    const planned = buildPhase74MemoryAgentBenchProtectionPlanIdentity({
      cases,
      dataset,
      source,
    });

    expect(planned.caseIds).toEqual(
      cases.flatMap(({ questions }) =>
        questions.map(({ questionId }) => questionId)
      ),
    );
    expect(planned.identity).toMatchObject({
      dataset,
      population: {
        caseCount: planned.caseIds.length,
        id: `${dataset.id}:question-population-v1`,
      },
      source,
    });
  });

  it("runs the legacy and Phase 74 retrieval paths on one identical question population", async () => {
    const root = await createRoot();
    const testCase = buildMemoryAgentBenchSmokeCases()[0]!;
    const result = await runPhase74MemoryAgentBenchProtection({
      artifactPath: join(root, "run.json"),
      cases: [testCase],
      dataset: descriptor("memoryagentbench-synthetic-ar", "1"),
      rawArtifactPath: join(root, "raw.json"),
      replicate: 1,
      runId: "mab-r1",
      source: descriptor("source-under-test", "2"),
    });

    expect(result.artifact.executionFailures).toBe(0);
    expect(result.artifact.artifactKind).toBe(
      "phase74-frozen-protection-suite-run",
    );
    expect(result.artifact.suite).toEqual({
      id: "memoryagentbench-legacy-vs-recommended-hybrid-retrieval-diagnostic-v1",
      kind: "benchmark-protection",
    });
    expect(result.artifact.rows).toHaveLength(1);
    const row = result.artifact.rows[0]!;
    expect(row.caseId).toBe(testCase.questions[0]!.questionId);
    expect(Object.keys(row.baseline.protections!).sort()).toEqual(
      [...PHASE74_MAB_PROTECTION_METRICS].sort(),
    );
    expect(row.baseline).not.toHaveProperty("e4");
    expect(row.baseline).not.toHaveProperty("safety");
    expect(row.candidate).not.toHaveProperty("e4");
    expect(row.candidate).not.toHaveProperty("safety");

    const raw = JSON.parse(await readFile(result.rawArtifactPath, "utf8"));
    for (const branch of ["baseline", "candidate"] as const) {
      const retrieval = raw.rows[0][branch].rawOutput;
      const scores = row[branch].protections!;
      expect(scores.memoryagentbench_evidence_recall).toBe(
        retrieval.evidenceRecall,
      );
      expect(scores.memoryagentbench_gold_evidence_complete).toBe(
        retrieval.goldEvidenceFullyRetrieved ? 1 : 0,
      );
      expect(scores.memoryagentbench_stale_selection_avoidance).toBe(
        retrieval.staleChunkSelected ? 0 : 1,
      );
    }

    const loaded = await loadPhase74FrozenProtectionSuiteRunArtifact(
      result.artifactPath,
    );
    expect(loaded.rows).toEqual(result.artifact.rows);
    expect(loaded.identity.model.id).toBe("no-answer-model-retrieval-only");
    expect(Object.keys(row.baseline.protections!)).not.toContain(
      "memoryagentbench_answer_accuracy",
    );
  });

  it("replays the frozen question inputs and retrieval scores exactly", async () => {
    const root = await createRoot();
    const cases = [buildMemoryAgentBenchSmokeCases()[0]!];
    const dataset = descriptor("memoryagentbench-synthetic-ar", "1");
    const source = descriptor("source-under-test", "2");
    const result = await runPhase74MemoryAgentBenchProtection({
      artifactPath: join(root, "run.json"),
      cases,
      dataset,
      rawArtifactPath: join(root, "raw.json"),
      replicate: 1,
      runId: "mab-exact-r1",
      source,
    });

    await expect(verifyPhase74MemoryAgentBenchProtectionArtifact({
      artifactPath: result.artifactPath,
      cases,
      dataset,
      source,
    })).resolves.toMatchObject({ runId: "mab-exact-r1" });

    const raw = JSON.parse(await readFile(result.rawArtifactPath, "utf8"));
    raw.rows[0].inputSha256 = "f".repeat(64);
    await rewriteRawArtifact({
      artifactPath: result.artifactPath,
      raw: `${JSON.stringify(raw, null, 2)}\n`,
      rawArtifactPath: result.rawArtifactPath,
    });
    await expect(verifyPhase74MemoryAgentBenchProtectionArtifact({
      artifactPath: result.artifactPath,
      cases,
      dataset,
      source,
    })).rejects.toThrow("input SHA-256");
  });

  it("rejects scores forged consistently across the suite and raw artifacts", async () => {
    const root = await createRoot();
    const cases = [buildMemoryAgentBenchSmokeCases()[0]!];
    const dataset = descriptor("memoryagentbench-synthetic-ar", "1");
    const source = descriptor("source-under-test", "2");
    const result = await runPhase74MemoryAgentBenchProtection({
      artifactPath: join(root, "run.json"),
      cases,
      dataset,
      rawArtifactPath: join(root, "raw.json"),
      replicate: 1,
      runId: "mab-forged-score-r1",
      source,
    });
    const raw = JSON.parse(await readFile(result.rawArtifactPath, "utf8"));
    const forged = {
      memoryagentbench_evidence_recall: 1,
      memoryagentbench_gold_evidence_complete: 1,
      memoryagentbench_stale_selection_avoidance: 1,
    };
    raw.rows[0].baseline.rawOutput.retrievedChunkIds = [];
    raw.rows[0].baseline.scores.protections = forged;
    await rewriteRawArtifact({
      artifactPath: result.artifactPath,
      raw: `${JSON.stringify(raw, null, 2)}\n`,
      rawArtifactPath: result.rawArtifactPath,
    });
    const artifact = JSON.parse(await readFile(result.artifactPath, "utf8"));
    artifact.rows[0].baseline.protections = forged;
    await writeFile(
      result.artifactPath,
      `${JSON.stringify(artifact, null, 2)}\n`,
      "utf8",
    );

    await expect(loadPhase74FrozenProtectionSuiteRunArtifact(
      result.artifactPath,
    )).resolves.toBeDefined();
    await expect(verifyPhase74MemoryAgentBenchProtectionArtifact({
      artifactPath: result.artifactPath,
      cases,
      dataset,
      source,
    })).rejects.toThrow("retrieval score drifted");
  });

  it("replays the MAB adapter during suite composition instead of trusting frozen scores", async () => {
    const root = await createRoot();
    const cases = [buildMemoryAgentBenchSmokeCases()[0]!];
    const datasetPath = join(root, "mab-cases.json");
    const datasetRaw = `${JSON.stringify({ cases })}\n`;
    await writeFile(datasetPath, datasetRaw, "utf8");
    const dataset = {
      id: "memoryagentbench-synthetic-ar",
      path: datasetPath,
      sha256: sha256(datasetRaw),
    };
    const source = {
      id: `git:${"a".repeat(40)}`,
      sha256: "b".repeat(64),
    };
    const runArtifactPaths: string[] = [];
    let mabIdentityHash = "";
    for (const replicate of [1, 2, 3] as const) {
      const result = await runPhase74MemoryAgentBenchProtection({
        artifactPath: join(root, `mab-r${replicate}`, "run.json"),
        cases,
        dataset: { id: dataset.id, sha256: dataset.sha256 },
        rawArtifactPath: join(root, `mab-r${replicate}`, "raw.json"),
        replicate,
        runId: `mab-compose-r${replicate}`,
        source,
      });
      mabIdentityHash = hashPhase74ProtectionSuiteIdentity(
        result.artifact.identity,
      );
      runArtifactPaths.push(result.artifactPath);
    }

    const manifestSuites: Phase74ProtectionSuiteManifest["suites"] = [{
      dataset,
      id: PHASE74_MAB_PROTECTION_SUITE.id,
      identityHash: mabIdentityHash,
      kind: PHASE74_MAB_PROTECTION_SUITE.kind,
      requiredMetrics: [...PHASE74_MAB_PROTECTION_METRICS],
      verifierId: PHASE74_MAB_PROTECTION_VERIFIER_ID,
    }];
    const verifiers: Phase74ProtectionSuiteVerifier[] = [
      PHASE74_MEMORY_AGENT_BENCH_PROTECTION_VERIFIER,
    ];
    const addAuxiliarySuite = async (input: {
      id: string;
      kind: Phase74ProtectionSuiteKind;
      requiredMetrics: string[];
      scores: Phase74ProtectionSuiteBranchScores;
    }) => {
      const auxiliaryDatasetPath = join(root, `${input.id}-dataset.json`);
      const auxiliaryDatasetRaw = `${JSON.stringify({ suiteId: input.id })}\n`;
      await writeFile(auxiliaryDatasetPath, auxiliaryDatasetRaw, "utf8");
      const auxiliaryDataset = {
        id: `${input.id}-dataset`,
        path: auxiliaryDatasetPath,
        sha256: sha256(auxiliaryDatasetRaw),
      };
      const verifierId = `${input.id}-test-verifier-v1`;
      let identityHash = "";
      for (const replicate of [1, 2, 3] as const) {
        const result = await runPhase74ProtectionSuiteCases({
          artifactPath: join(root, `${input.id}-r${replicate}`, "run.json"),
          cases: [{ caseId: `${input.id}:case-1`, input: { value: 1 } }],
          evaluate: async () => ({ rawOutput: { value: 1 }, scores: input.scores }),
          identity: {
            dataset: {
              id: auxiliaryDataset.id,
              sha256: auxiliaryDataset.sha256,
            },
            judge: descriptor(`${input.id}-judge`, "3"),
            model: descriptor(`${input.id}-model`, "4"),
            pipeline: descriptor(`${input.id}-pipeline`, "5"),
            populationId: `${input.id}-population`,
            prompt: descriptor(`${input.id}-prompt`, "6"),
            source,
          },
          rawArtifactPath: join(root, `${input.id}-r${replicate}`, "raw.json"),
          replicate,
          runId: `${input.id}-r${replicate}`,
          suite: { id: input.id, kind: input.kind },
        });
        identityHash = hashPhase74ProtectionSuiteIdentity(
          result.artifact.identity,
        );
        runArtifactPaths.push(result.artifactPath);
      }
      manifestSuites.push({
        dataset: auxiliaryDataset,
        id: input.id,
        identityHash,
        kind: input.kind,
        requiredMetrics: input.requiredMetrics,
        verifierId,
      });
      verifiers.push({
        id: verifierId,
        kind: input.kind,
        requiredMetrics: input.requiredMetrics,
        suiteId: input.id,
        verify: async () => {},
      });
    };
    await addAuxiliarySuite({
      id: "e4-test",
      kind: "e4",
      requiredMetrics: ["answer_quality"],
      scores: {
        e4: {
          chronology: { answer_quality: 0.8 },
          compact_json: { answer_quality: 0.8 },
          json_locale_note: { answer_quality: 0.8 },
          prose: { answer_quality: 0.8 },
        },
      },
    });
    await addAuxiliarySuite({
      id: "safety-test",
      kind: "safety",
      requiredMetrics: [
        "abstentionAccuracy",
        "hallucinationRate",
        "privacyPassRate",
        "updateCorrectness",
      ],
      scores: {
        safety: {
          abstentionAccuracy: 1,
          hallucinationRate: 0,
          privacyPassRate: 1,
          updateCorrectness: 1,
        },
      },
    });
    const manifestPath = join(root, "manifest.json");
    await writeFile(manifestPath, `${JSON.stringify({
      admission: "canonical-verifier-bound-v1",
      artifactKind: "phase74-protection-suite-manifest",
      schemaVersion: 2,
      suites: manifestSuites,
    } satisfies Phase74ProtectionSuiteManifest, null, 2)}\n`, "utf8");

    await expect(buildPhase74FrozenProtectionSuiteEvidence({
      manifestPath,
      runArtifactPaths,
    }, { verifiers })).resolves.toBeDefined();

    const mabRunPath = runArtifactPaths[0]!;
    const mabRun = JSON.parse(await readFile(mabRunPath, "utf8"));
    const mabRawPath = join(root, "mab-r1", "raw.json");
    const mabRaw = JSON.parse(await readFile(mabRawPath, "utf8"));
    const forged = {
      memoryagentbench_evidence_recall: 1,
      memoryagentbench_gold_evidence_complete: 1,
      memoryagentbench_stale_selection_avoidance: 1,
    };
    mabRaw.rows[0].baseline.rawOutput.retrievedChunkIds = [];
    mabRaw.rows[0].baseline.scores.protections = forged;
    const mabRawText = `${JSON.stringify(mabRaw, null, 2)}\n`;
    await writeFile(mabRawPath, mabRawText, "utf8");
    mabRun.rawArtifact.sha256 = sha256(mabRawText);
    mabRun.rows[0].baseline.protections = forged;
    await writeFile(mabRunPath, `${JSON.stringify(mabRun, null, 2)}\n`, "utf8");

    await expect(buildPhase74FrozenProtectionSuiteEvidence({
      manifestPath,
      runArtifactPaths,
    }, { verifiers })).rejects.toThrow("retrieval score drifted");
  });

  it("rejects a forged MAB evaluator identity", async () => {
    const root = await createRoot();
    const cases = [buildMemoryAgentBenchSmokeCases()[0]!];
    const dataset = descriptor("memoryagentbench-synthetic-ar", "1");
    const source = descriptor("source-under-test", "2");
    const result = await runPhase74MemoryAgentBenchProtection({
      artifactPath: join(root, "run.json"),
      cases,
      dataset,
      rawArtifactPath: join(root, "raw.json"),
      replicate: 1,
      runId: "mab-forged-identity-r1",
      source,
    });
    const artifact = JSON.parse(await readFile(result.artifactPath, "utf8"));
    artifact.identity.prompt.sha256 = "f".repeat(64);
    await writeFile(
      result.artifactPath,
      `${JSON.stringify(artifact, null, 2)}\n`,
      "utf8",
    );

    await expect(loadPhase74FrozenProtectionSuiteRunArtifact(
      result.artifactPath,
    )).resolves.toBeDefined();
    await expect(verifyPhase74MemoryAgentBenchProtectionArtifact({
      artifactPath: result.artifactPath,
      cases,
      dataset,
      source,
    })).rejects.toThrow("evaluator identity drifted");
  });

  it("fails closed on suite raw kind, non-JSON, and score tampering", async () => {
    const createRun = async (suffix: string) => {
      const root = await createRoot();
      return runPhase74MemoryAgentBenchProtection({
        artifactPath: join(root, `${suffix}-run.json`),
        cases: [buildMemoryAgentBenchSmokeCases()[0]!],
        dataset: descriptor("memoryagentbench-synthetic-ar", "1"),
        rawArtifactPath: join(root, `${suffix}-raw.json`),
        replicate: 1,
        runId: `mab-${suffix}-r1`,
        source: descriptor("source-under-test", "2"),
      });
    };

    const wrongKind = await createRun("wrong-kind");
    const wrongKindRaw = JSON.parse(await readFile(
      wrongKind.rawArtifactPath,
      "utf8",
    ));
    wrongKindRaw.artifactKind = "not-a-protection-suite-raw";
    await rewriteRawArtifact({
      artifactPath: wrongKind.artifactPath,
      raw: `${JSON.stringify(wrongKindRaw, null, 2)}\n`,
      rawArtifactPath: wrongKind.rawArtifactPath,
    });
    await expect(loadPhase74FrozenProtectionSuiteRunArtifact(
      wrongKind.artifactPath,
    )).rejects.toThrow("raw artifact is invalid");

    const nonJson = await createRun("non-json");
    await rewriteRawArtifact({
      artifactPath: nonJson.artifactPath,
      raw: "legacy suite raw log\n",
      rawArtifactPath: nonJson.rawArtifactPath,
    });
    await expect(loadPhase74FrozenProtectionSuiteRunArtifact(
      nonJson.artifactPath,
    )).rejects.toThrow();

    const changedScore = await createRun("changed-score");
    const changedScoreRaw = JSON.parse(await readFile(
      changedScore.rawArtifactPath,
      "utf8",
    ));
    changedScoreRaw.rows[0].candidate.scores.protections[
      PHASE74_MAB_PROTECTION_METRICS[0]
    ] = 0.123;
    await rewriteRawArtifact({
      artifactPath: changedScore.artifactPath,
      raw: `${JSON.stringify(changedScoreRaw, null, 2)}\n`,
      rawArtifactPath: changedScore.rawArtifactPath,
    });
    await expect(loadPhase74FrozenProtectionSuiteRunArtifact(
      changedScore.artifactPath,
    )).rejects.toThrow("raw outcomes do not match frozen rows");
  });

  it("fails closed on suite, metric, run, replicate, and population drift", async () => {
    const createRun = async (suffix: string) => {
      const root = await createRoot();
      return runPhase74MemoryAgentBenchProtection({
        artifactPath: join(root, `${suffix}-run.json`),
        cases: [buildMemoryAgentBenchSmokeCases()[0]!],
        dataset: descriptor("memoryagentbench-synthetic-ar", "1"),
        rawArtifactPath: join(root, `${suffix}-raw.json`),
        replicate: 1,
        runId: `mab-${suffix}-r1`,
        source: descriptor("source-under-test", "2"),
      });
    };

    for (const [suffix, mutate, message] of [
      ["suite", (raw: MutableSuiteRawIdentity) => {
        raw.suite.id = "different-suite";
      }, "raw suite drifted"],
      ["run", (raw: MutableSuiteRawIdentity) => {
        raw.runId = "different-run";
      }, "raw run identity drifted"],
      ["replicate", (raw: MutableSuiteRawIdentity) => {
        raw.replicate = 2;
      }, "raw run identity drifted"],
      ["population", (raw: MutableSuiteRawIdentity) => {
        raw.population.caseCount = 2;
      }, "raw population drifted"],
    ] as const) {
      const result = await createRun(suffix);
      const raw = JSON.parse(await readFile(result.rawArtifactPath, "utf8"));
      mutate(raw);
      await rewriteRawArtifact({
        artifactPath: result.artifactPath,
        raw: `${JSON.stringify(raw, null, 2)}\n`,
        rawArtifactPath: result.rawArtifactPath,
      });
      await expect(loadPhase74FrozenProtectionSuiteRunArtifact(
        result.artifactPath,
      )).rejects.toThrow(message);
    }

    const metric = await createRun("metric");
    const artifact = JSON.parse(await readFile(metric.artifactPath, "utf8"));
    artifact.rows[0].candidate.protections.extra_metric = 0.5;
    await writeFile(
      metric.artifactPath,
      `${JSON.stringify(artifact, null, 2)}\n`,
      "utf8",
    );
    await expect(loadPhase74FrozenProtectionSuiteRunArtifact(
      metric.artifactPath,
    )).rejects.toThrow("branch metric population drifted");
  });

  it("does not inherit ambient provider fragments into the offline branches", async () => {
    const root = await createRoot();
    const key = "GOODMEMORY_ASSISTED_EXTRACTOR_BASE_URL";
    const previous = process.env[key];
    process.env[key] = "https://ambient-provider.invalid/v1";
    try {
      const result = await runPhase74MemoryAgentBenchProtection({
        artifactPath: join(root, "run.json"),
        cases: [buildMemoryAgentBenchSmokeCases()[0]!],
        dataset: descriptor("memoryagentbench-synthetic-ar", "1"),
        rawArtifactPath: join(root, "raw.json"),
        replicate: 1,
        runId: "mab-offline-r1",
        source: descriptor("source-under-test", "2"),
      });
      expect(result.artifact.executionFailures).toBe(0);
    } finally {
      if (previous === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous;
      }
    }
  });

  it("binds actual offline controls before creating runtimes and emits schema v2", async () => {
    const root = await createRoot();
    const testCase = buildMemoryAgentBenchSmokeCases()[0]!;
    const dataset = descriptor("memoryagentbench-synthetic-ar", "1");
    const source = descriptor("source-under-test", "2");
    const seed = await runPhase74MemoryAgentBenchProtection({
      artifactPath: join(root, "seed-run.json"),
      cases: [testCase],
      dataset,
      rawArtifactPath: join(root, "seed-raw.json"),
      replicate: 1,
      runId: "mab-seed-r1",
      source,
    });
    const blueprint = {
      id: PHASE74_PROTECTION_BLUEPRINT_ID,
      sha256: hashPhase74ProtectionValue("exact protection manifest bytes"),
    };
    const buildPlan = async (caseConcurrency: number, path: string) => {
      const plan = buildPhase74ProtectionPlan({
        admissionClass: "diagnostic",
        evaluatorSource: source,
        protectionBlueprint: blueprint,
        runs: [{
          caseIds: seed.artifact.rows.map(({ caseId }) => caseId),
          controls: {
            callBudget: describePhase74ProtectionCallBudget(
              "no-live-model-calls-v1",
            ),
            caseConcurrency,
            renderedContextTokens: 6_000,
          },
          identity: seed.artifact.identity,
          protectionBlueprint: blueprint,
          replicate: 1,
          runId: "mab-planned-r1",
          suite: PHASE74_MAB_PROTECTION_SUITE,
          verifier: canonicalDescriptor(PHASE74_MAB_PROTECTION_VERIFIER_ID),
        }],
      });
      await writeFile(path, `${JSON.stringify(plan, null, 2)}\n`);
      return loadPhase74ProtectionPlan(path);
    };

    const driftedPlan = await buildPlan(2, join(root, "drifted-plan.json"));
    const driftedArtifactPath = join(root, "drifted-run.json");
    const driftedRawPath = join(root, "drifted-raw.json");
    let runtimeCalls = 0;
    await expect(runPhase74MemoryAgentBenchProtection({
      artifactPath: driftedArtifactPath,
      caseConcurrency: 1,
      cases: [testCase],
      dataset,
      protectionPlan: driftedPlan,
      rawArtifactPath: driftedRawPath,
      replicate: 1,
      runId: "mab-planned-r1",
      source,
    }, {
      createMemory: (branch) => {
        runtimeCalls += 1;
        return createPhase74MemoryAgentBenchOfflineMemory(branch);
      },
    })).rejects.toThrow("drifted from its pre-execution plan");
    expect(runtimeCalls).toBe(0);
    expect(await Bun.file(driftedArtifactPath).exists()).toBe(false);
    expect(await Bun.file(driftedRawPath).exists()).toBe(false);

    const loadedPlan = await buildPlan(1, join(root, "protection-plan.json"));
    const result = await runPhase74MemoryAgentBenchProtection({
      artifactPath: join(root, "planned-run.json"),
      caseConcurrency: 1,
      cases: [testCase],
      dataset,
      protectionPlan: loadedPlan,
      rawArtifactPath: join(root, "planned-raw.json"),
      replicate: 1,
      runId: "mab-planned-r1",
      source,
    });
    expect(result.artifact.schemaVersion).toBe(2);
    expect(result.artifact).toMatchObject({
      planPath: loadedPlan.path,
      planSha256: loadedPlan.sha256,
    });
  });

  it("uses identical generated IDs in the isolated baseline and candidate stores", async () => {
    const testCase = buildMemoryAgentBenchSmokeCases()[0]!;
    const scope = buildMemoryAgentBenchScope({
      caseId: testCase.caseId,
      runId: "paired-id-check",
    });
    const baseline = createPhase74MemoryAgentBenchOfflineMemory("baseline");
    const candidate = createPhase74MemoryAgentBenchOfflineMemory("candidate");
    await Promise.all([
      seedMemoryAgentBenchCase({
        memory: baseline,
        runId: "paired-id-check",
        testCase,
      }),
      seedMemoryAgentBenchCase({
        memory: candidate,
        runId: "paired-id-check",
        testCase,
      }),
    ]);
    const [baselineRecall, candidateRecall] = await Promise.all([
      baseline.recall({
        query: testCase.questions[0]!.question,
        scope,
        strategy: "rules-only",
      }),
      candidate.recall({
        query: testCase.questions[0]!.question,
        scope,
        strategy: "rules-only",
      }),
    ]);

    expect(candidateRecall.facts.map(({ id }) => id)).toEqual(
      baselineRecall.facts.map(({ id }) => id),
    );
  });

  it("loads the normalized external root and binds its exact dataset bytes", async () => {
    const root = await createRoot();
    const benchmarkRoot = join(root, "mab");
    await mkdir(benchmarkRoot);
    const datasetRaw = `${JSON.stringify({
      cases: [buildMemoryAgentBenchSmokeCases()[0]!],
    })}\n`;
    await writeFile(
      join(benchmarkRoot, "cases.json"),
      datasetRaw,
      "utf8",
    );
    const options = parsePhase74MemoryAgentBenchProtectionCliOptions([
      "bun",
      "script.ts",
      "--benchmark-root",
      benchmarkRoot,
      "--dataset-id",
      "memoryagentbench-test-root",
      "--output-dir",
      root,
      "--replicate",
      "1",
      "--run-id",
      "mab-cli-r1",
    ]);
    let readCount = 0;
    let verifyCount = 0;
    const result = await runPhase74MemoryAgentBenchProtectionCli(options, {
      captureEvaluatorSource: async () => ({
        commit: "a".repeat(40),
        sha256: "b".repeat(64),
      }),
      readDataset: async () => {
        readCount += 1;
        return Buffer.from(datasetRaw);
      },
      verifyProtectionArtifact: async (input) => {
        verifyCount += 1;
        return verifyPhase74MemoryAgentBenchProtectionArtifact(input);
      },
    });

    expect(result.artifact.identity.dataset.id).toBe(
      "memoryagentbench-test-root",
    );
    expect(result.artifact.identity.dataset.sha256).toBe(sha256(datasetRaw));
    expect(result.artifact.identity.source).toEqual({
      id: `git:${"a".repeat(40)}`,
      sha256: "b".repeat(64),
    });
    expect(result.artifact.rows).toHaveLength(1);
    expect(readCount).toBe(1);
    expect(verifyCount).toBe(1);

    const blueprint = {
      id: PHASE74_PROTECTION_BLUEPRINT_ID,
      sha256: hashPhase74ProtectionValue("exact protection manifest bytes"),
    };
    const planPath = join(root, "protection-plan.json");
    await writeFile(planPath, `${JSON.stringify(buildPhase74ProtectionPlan({
      admissionClass: "diagnostic",
      evaluatorSource: result.artifact.identity.source,
      protectionBlueprint: blueprint,
      runs: [{
        caseIds: result.artifact.rows.map(({ caseId }) => caseId),
        controls: {
          callBudget: describePhase74ProtectionCallBudget(
            "no-live-model-calls-v1",
          ),
          caseConcurrency: 1,
          renderedContextTokens: 6_000,
        },
        identity: result.artifact.identity,
        protectionBlueprint: blueprint,
        replicate: 1,
        runId: "mab-cli-planned-r1",
        suite: PHASE74_MAB_PROTECTION_SUITE,
        verifier: canonicalDescriptor(PHASE74_MAB_PROTECTION_VERIFIER_ID),
      }],
    }), null, 2)}\n`);
    const plannedOptions = parsePhase74MemoryAgentBenchProtectionCliOptions([
      "bun",
      "script.ts",
      "--benchmark-root",
      benchmarkRoot,
      "--dataset-id",
      "memoryagentbench-test-root",
      "--output-dir",
      root,
      "--protection-plan",
      planPath,
      "--replicate",
      "1",
      "--run-id",
      "mab-cli-planned-r1",
    ]);
    expect(plannedOptions.protectionPlanPath).toBe(planPath);
    const planned = await runPhase74MemoryAgentBenchProtectionCli(
      plannedOptions,
      {
        captureEvaluatorSource: async () => ({
          commit: "a".repeat(40),
          sha256: "b".repeat(64),
        }),
        readDataset: async () => Buffer.from(datasetRaw),
      },
    );
    expect(planned.artifact.schemaVersion).toBe(2);

    expect(() => parsePhase74MemoryAgentBenchProtectionCliOptions([
      "--benchmark-root",
      benchmarkRoot,
      "--dataset-id",
      "memoryagentbench-test-root",
      "--output-dir",
      root,
      "--replicate",
      "1",
      "--run-id",
      "mab-cli-r1",
      "--source-id",
      "forged-source",
      "--source-sha256",
      "c".repeat(64),
    ])).toThrow("source identity is computed from the checkout");
  });
});
