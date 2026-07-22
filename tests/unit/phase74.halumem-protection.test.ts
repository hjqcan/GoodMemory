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

import { PHASE72_UPSTREAMS } from "../../scripts/phase-72-external-contracts";
import {
  runPhase74HaluMemE4Protection,
  runPhase74HaluMemPrivacyProtection,
  runPhase74HaluMemUpdateProtection,
} from "../../scripts/phase-74-halumem-protection";
import type {
  Phase74HaluMemE4Dependencies,
  Phase74HaluMemPrivacyDependencies,
  Phase74HaluMemProtectionConfiguration,
  Phase74HaluMemUpdateDependencies,
} from "../../scripts/phase-74-halumem-protection";
import {
  runPhase74HaluMemProtectionCli,
} from "../../scripts/run-phase-74-halumem-protection";
import type {
  Phase74HaluMemProtectionCliOptions,
} from "../../scripts/run-phase-74-halumem-protection";
import {
  PHASE74_HALUMEM_E4_METRIC,
  PHASE74_HALUMEM_E4_PROTECTION_VERIFIER,
  PHASE74_HALUMEM_E4_SUITE,
  PHASE74_HALUMEM_PRIVACY_PROTECTION_VERIFIER,
  PHASE74_HALUMEM_PRIVACY_SUITE,
  PHASE74_HALUMEM_UPDATE_PROTECTION_VERIFIER,
  PHASE74_HALUMEM_UPDATE_SUITE,
  PHASE74_HALUMEM_UPSTREAM,
  parsePhase74HaluMemJsonl,
  selectPhase74HaluMemUsers,
  verifyPhase74HaluMemE4ProtectionArtifact,
  verifyPhase74HaluMemPrivacyProtectionArtifact,
  verifyPhase74HaluMemUpdateProtectionArtifact,
} from "../../src/eval/phase74HaluMemProtectionVerifier";
import type {
  Phase74HaluMemUser,
} from "../../src/eval/phase74HaluMemProtectionVerifier";
import {
  loadPhase74FrozenProtectionSuiteRunArtifact,
} from "../../src/eval/phase74ProtectionRun";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, {
    force: true,
    recursive: true,
  })));
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "phase74-halumem-protection-"));
  roots.push(root);
  return root;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function descriptor(id: string, digit: string) {
  return { id, sha256: digit.repeat(64) };
}

function model(model: string) {
  return {
    gateway: "https://ai.gurkiai.com/v1",
    maxOutputTokens: 512,
    model,
    provider: "openai-compatible",
    reasoningEffort: "medium",
    requestTimeoutMs: 45_000,
    retryLimit: 3,
    temperature: 0,
  } as const;
}

function configuration(input: {
  candidatePipeline?: ReturnType<typeof descriptor>;
  updateEvaluator?: ReturnType<typeof descriptor>;
} = {}): Phase74HaluMemProtectionConfiguration {
  const baselinePipeline = descriptor("halumem-frozen-e3-retrieval", "3");
  return {
    answerModel: model("gpt-5.6-terra"),
    baselinePipeline,
    candidatePipeline: input.candidatePipeline ?? baselinePipeline,
    context: {
      maxTokens: 6_000,
      tokenizer: "utf8-byte-upper-bound-v1",
    },
    judgeModel: model("gpt-5.5"),
    retrievalBudget: {
      preRankLimit: 32,
      selectedLimit: 12,
    },
    ...(input.updateEvaluator
      ? { updateEvaluator: input.updateEvaluator }
      : {}),
  };
}

function user(input: {
  answer: string;
  project: string;
  uuid: string;
}): Phase74HaluMemUser {
  return {
    persona_info: `${input.uuid} persona`,
    sessions: [{
      dialogue: [{
        content: `I work on ${input.project}.`,
        dialogue_turn: 0,
        role: "user",
        timestamp: "2026-01-01T00:00:00.000Z",
      }],
      memory_points: [{
        importance: 1,
        is_update: "True",
        memory_content: `I now work on ${input.project} 2.`,
        memory_source: "dialogue_turn=0",
        memory_type: "fact",
        original_memories: [`I worked on ${input.project}.`],
        timestamp: "2026-01-01T00:00:00.000Z",
      }],
      questions: [{
        answer: input.answer,
        evidence: [{ memory_content: `I work on ${input.project}.` }],
        question: `Which project does ${input.uuid} work on?`,
        question_type: "single-hop",
      }],
      start_time: "2026-01-01T00:00:00.000Z",
    }],
    uuid: input.uuid,
  };
}

const users = [
  user({ answer: "Apollo", project: "Apollo", uuid: "user-a" }),
  user({ answer: "Mosaic", project: "Mosaic", uuid: "user-b" }),
];

function datasetRaw(): string {
  return `${users.map((value) => JSON.stringify(value)).join("\n")}\n`;
}

function e4Dependencies(calls: {
  answer: number;
  judge: number;
  retrieve: number;
}): Phase74HaluMemE4Dependencies {
  return {
    answer: async ({ context, question }) => {
      calls.answer += 1;
      if (question.includes("user-a") && context.includes("Apollo")) {
        return "Apollo";
      }
      if (question.includes("user-b") && context.includes("Mosaic")) {
        return "Mosaic";
      }
      return "unknown";
    },
    judgeQa: async ({ answer, expectedAnswer }) => {
      calls.judge += 1;
      return JSON.stringify({
        protocol: "phase74-independent-qa-judge-v1",
        reason: "fake exact comparison",
        verdict: answer === expectedAnswer ? "correct" : "incorrect",
      });
    },
    retrieveEvidence: async ({ questionCaseId }) => {
      calls.retrieve += 1;
      const isA = questionCaseId.startsWith("user-a:");
      return {
        evidenceLedger: [{
          evidenceId: `evidence-${isA ? "a" : "b"}`,
          excerpt: isA ? "Apollo" : "Mosaic",
          relation: "supports",
          sourceMemoryId: `memory-${isA ? "a" : "b"}`,
          temporalStatus: "current",
        }],
        snapshotId: `snapshot-${questionCaseId}`,
      };
    },
  };
}

function updateDependencies(
  calls: { evaluate: number; retrieve: number },
): Phase74HaluMemUpdateDependencies {
  return {
    evaluateUpdate: async ({ expectedUpdate, retrievedMemories }) => {
      calls.evaluate += 1;
      return JSON.stringify({
        protocol: "halumem-upstream-per-item-update-v1",
        rawDecision: { matched: retrievedMemories.includes(expectedUpdate) },
        reason: "fake upstream item decision",
        verdict: retrievedMemories.includes(expectedUpdate)
          ? "correct"
          : "incorrect",
      });
    },
    retrieveUpdateEvidence: async ({ branch, memoryPoint }) => {
      calls.retrieve += 1;
      return {
        memories: branch === "candidate"
          ? [memoryPoint.memory_content]
          : memoryPoint.original_memories,
        snapshotId: `${branch}-${memoryPoint.memory_content}`,
        sourceMessageIds: ["source-message-0"],
      };
    },
  };
}

function privacyDependencies(): Phase74HaluMemPrivacyDependencies {
  return {
    recallScopes: async ({
      branch,
      expectedOwnerSourceMessageIds,
      ownerUserUuid,
    }) => ({
      foreignScopeSourceMessageIds:
        branch === "candidate" && ownerUserUuid === "user-b"
          ? [expectedOwnerSourceMessageIds[0]!]
          : [],
      ownerScopeSourceMessageIds: [expectedOwnerSourceMessageIds[0]!],
      snapshotId: `${branch}-${ownerUserUuid}`,
    }),
  };
}

async function rewriteRawArtifact(input: {
  artifactPath: string;
  rawArtifactPath: string;
  raw: unknown;
}): Promise<void> {
  const rawText = `${JSON.stringify(input.raw, null, 2)}\n`;
  await writeFile(input.rawArtifactPath, rawText, "utf8");
  const artifact = JSON.parse(await readFile(input.artifactPath, "utf8"));
  artifact.rawArtifact.sha256 = sha256(rawText);
  await writeFile(
    input.artifactPath,
    `${JSON.stringify(artifact, null, 2)}\n`,
    "utf8",
  );
}

describe("Phase 74 HaluMem protection adapters", () => {
  it("parses the real HaluMem JSONL user contract and pins the upstream", () => {
    const parsed = parsePhase74HaluMemJsonl(datasetRaw(), "HaluMem-Medium.jsonl");
    expect(parsed).toEqual(users);
    expect(selectPhase74HaluMemUsers(parsed, ["user-b", "user-a"]))
      .toEqual([users[1], users[0]]);
    expect(PHASE74_HALUMEM_UPSTREAM.codeCommit).toBe(
      PHASE72_UPSTREAMS.halumem.codeCommit,
    );
    expect(() => parsePhase74HaluMemJsonl(
      JSON.stringify(users),
      "not-jsonl.json",
    )).toThrow("JSONL row");
  });

  it("runs E4 from one frozen ledger and changes only the rendering format", async () => {
    const root = await createRoot();
    const calls = { answer: 0, judge: 0, retrieve: 0 };
    const config = configuration();
    const dataset = descriptor("halumem-test-jsonl", "1");
    const source = descriptor("git:test-source", "2");
    const result = await runPhase74HaluMemE4Protection({
      artifactPath: join(root, "run.json"),
      configuration: config,
      dataset,
      rawArtifactPath: join(root, "raw.json"),
      replicate: 1,
      runId: "halumem-e4-r1",
      source,
      users,
    }, e4Dependencies(calls));

    expect(result.artifact.suite).toEqual(PHASE74_HALUMEM_E4_SUITE);
    expect(result.artifact.rows).toHaveLength(2);
    expect(calls).toEqual({ answer: 10, judge: 10, retrieve: 2 });
    for (const row of result.artifact.rows) {
      const baseline = row.baseline.e4!;
      expect(new Set(Object.values(baseline).map((scores) =>
        scores[PHASE74_HALUMEM_E4_METRIC]
      ))).toEqual(new Set([1]));
    }

    const raw = JSON.parse(await readFile(result.rawArtifactPath, "utf8"));
    const rawRow = raw.rows[0];
    expect(rawRow.baseline.rawOutput.evidenceLedger).toEqual(
      rawRow.candidate.rawOutput.evidenceLedger,
    );
    expect(rawRow.baseline.rawOutput.context).toBe("Apollo");
    expect(rawRow.candidate.rawOutput.formats.prose.context).not.toBe(
      rawRow.baseline.rawOutput.context,
    );
    expect(Object.keys(rawRow.candidate.rawOutput.formats).sort()).toEqual([
      "chronology",
      "compact_json",
      "json_locale_note",
      "prose",
    ]);

    const callsBeforeVerify = { ...calls };
    await expect(verifyPhase74HaluMemE4ProtectionArtifact({
      artifactPath: result.artifactPath,
      configuration: config,
      dataset,
      source,
      users,
    })).resolves.toMatchObject({ runId: "halumem-e4-r1" });
    expect(calls).toEqual(callsBeforeVerify);
  });

  it("rejects E4 retrieval drift, forged contexts, model drift, and budget overflow", async () => {
    const root = await createRoot();
    const config = configuration();
    const dataset = descriptor("halumem-test-jsonl", "1");
    const source = descriptor("git:test-source", "2");

    await expect(runPhase74HaluMemE4Protection({
      artifactPath: join(root, "different-pipeline-run.json"),
      configuration: configuration({
        candidatePipeline: descriptor("different-pipeline", "4"),
      }),
      dataset,
      rawArtifactPath: join(root, "different-pipeline-raw.json"),
      replicate: 1,
      runId: "different-pipeline",
      source,
      users,
    }, e4Dependencies({ answer: 0, judge: 0, retrieve: 0 })))
      .rejects.toThrow("format-only");

    const result = await runPhase74HaluMemE4Protection({
      artifactPath: join(root, "run.json"),
      configuration: config,
      dataset,
      rawArtifactPath: join(root, "raw.json"),
      replicate: 1,
      runId: "halumem-e4-tamper",
      source,
      users,
    }, e4Dependencies({ answer: 0, judge: 0, retrieve: 0 }));
    const raw = JSON.parse(await readFile(result.rawArtifactPath, "utf8"));
    raw.rows[0].candidate.rawOutput.formats.compact_json.context = "forged";
    await rewriteRawArtifact({
      artifactPath: result.artifactPath,
      raw,
      rawArtifactPath: result.rawArtifactPath,
    });
    await expect(verifyPhase74HaluMemE4ProtectionArtifact({
      artifactPath: result.artifactPath,
      configuration: config,
      dataset,
      source,
      users,
    })).rejects.toThrow("rendered context drifted");

    const changedModel = {
      ...config,
      answerModel: model("different-answer-model"),
    };
    await expect(verifyPhase74HaluMemE4ProtectionArtifact({
      artifactPath: result.artifactPath,
      configuration: changedModel,
      dataset,
      source,
      users,
    })).rejects.toThrow("evaluator identity drifted");

    const oversizedDependencies = e4Dependencies({
      answer: 0,
      judge: 0,
      retrieve: 0,
    });
    oversizedDependencies.retrieveEvidence = async () => ({
      evidenceLedger: [{
        evidenceId: "oversized-evidence",
        excerpt: "x".repeat(6_001),
        relation: "supports",
        sourceMemoryId: "oversized-memory",
        temporalStatus: "current",
      }],
      snapshotId: "oversized",
    });
    await expect(runPhase74HaluMemE4Protection({
      artifactPath: join(root, "oversized-run.json"),
      configuration: config,
      dataset,
      rawArtifactPath: join(root, "oversized-raw.json"),
      replicate: 1,
      runId: "halumem-e4-oversized",
      source,
      users: [users[0]!],
    }, oversizedDependencies)).rejects.toThrow("context budget");
  });

  it("fails update correctness closed without a raw per-item upstream decision", async () => {
    const root = await createRoot();
    await expect(runPhase74HaluMemUpdateProtection({
      artifactPath: join(root, "run.json"),
      configuration: configuration(),
      dataset: descriptor("halumem-test-jsonl", "1"),
      rawArtifactPath: join(root, "raw.json"),
      replicate: 1,
      runId: "halumem-update-unavailable",
      source: descriptor("git:test-source", "2"),
      users,
    }, {
      retrieveUpdateEvidence: updateDependencies({
        evaluate: 0,
        retrieve: 0,
      }).retrieveUpdateEvidence,
    })).rejects.toThrow("per-item upstream update decision");
  });

  it("replays update correctness only from strict raw upstream item decisions", async () => {
    const root = await createRoot();
    const calls = { evaluate: 0, retrieve: 0 };
    const config = configuration({
      candidatePipeline: descriptor("halumem-phase74-candidate", "4"),
      updateEvaluator: descriptor("halumem-upstream-evaluation.py", "5"),
    });
    const rawDataset = datasetRaw();
    const dataset = {
      id: "halumem-test-jsonl",
      sha256: sha256(rawDataset),
    };
    const source = descriptor("git:test-source", "2");
    const result = await runPhase74HaluMemUpdateProtection({
      artifactPath: join(root, "run.json"),
      configuration: config,
      dataset,
      rawArtifactPath: join(root, "raw.json"),
      replicate: 1,
      runId: "halumem-update-r1",
      source,
      users,
    }, updateDependencies(calls));

    expect(result.artifact.suite).toEqual(PHASE74_HALUMEM_UPDATE_SUITE);
    expect(result.artifact.rows).toHaveLength(2);
    expect(result.artifact.rows[0]!.baseline.safety!.updateCorrectness).toBe(0);
    expect(result.artifact.rows[0]!.candidate.safety!.updateCorrectness).toBe(1);
    expect(calls).toEqual({ evaluate: 4, retrieve: 4 });

    const before = { ...calls };
    await expect(verifyPhase74HaluMemUpdateProtectionArtifact({
      artifactPath: result.artifactPath,
      configuration: config,
      dataset,
      source,
      users,
    })).resolves.toMatchObject({ runId: "halumem-update-r1" });
    await expect(PHASE74_HALUMEM_UPDATE_PROTECTION_VERIFIER.verify({
      dataset: {
        ...dataset,
        path: "HaluMem-Medium.jsonl",
      },
      datasetBytes: Buffer.from(rawDataset),
      run: await loadPhase74FrozenProtectionSuiteRunArtifact(
        result.artifactPath,
      ),
    })).resolves.toBeUndefined();
    expect(calls).toEqual(before);
  });

  it("scores real cross-user scope isolation with an owner-scope positive control", async () => {
    const root = await createRoot();
    const config = configuration({
      candidatePipeline: descriptor("halumem-phase74-candidate", "4"),
    });
    const dataset = descriptor("halumem-test-jsonl", "1");
    const source = descriptor("git:test-source", "2");
    const result = await runPhase74HaluMemPrivacyProtection({
      artifactPath: join(root, "run.json"),
      configuration: config,
      dataset,
      rawArtifactPath: join(root, "raw.json"),
      replicate: 1,
      runId: "halumem-privacy-r1",
      source,
      users,
    }, privacyDependencies());

    expect(result.artifact.suite).toEqual(PHASE74_HALUMEM_PRIVACY_SUITE);
    expect(result.artifact.rows).toHaveLength(2);
    expect(result.artifact.rows[0]!.baseline.safety!.privacyPassRate).toBe(1);
    expect(result.artifact.rows[0]!.candidate.safety!.privacyPassRate).toBe(1);
    expect(result.artifact.rows[1]!.baseline.safety!.privacyPassRate).toBe(1);
    expect(result.artifact.rows[1]!.candidate.safety!.privacyPassRate).toBe(0);

    await expect(verifyPhase74HaluMemPrivacyProtectionArtifact({
      artifactPath: result.artifactPath,
      configuration: config,
      dataset,
      source,
      users,
    })).resolves.toMatchObject({ runId: "halumem-privacy-r1" });
  });

  it("runs the CLI from one exact dataset read and leaves update not evaluable", async () => {
    const root = await createRoot();
    const raw = datasetRaw();
    const options: Phase74HaluMemProtectionCliOptions = {
      datasetId: "halumem-cli-jsonl",
      datasetPath: join(root, "HaluMem-Medium.jsonl"),
      e4Configuration: configuration(),
      outputDir: root,
      replicate: 1,
      runId: "halumem-cli-r1",
      safetyConfiguration: configuration({
        candidatePipeline: descriptor("halumem-phase74-candidate", "4"),
      }),
      userUuids: ["user-a", "user-b"],
    };
    let reads = 0;
    const result = await runPhase74HaluMemProtectionCli(options, {
      captureEvaluatorSource: async () => ({
        commit: "a".repeat(40),
        sha256: "b".repeat(64),
      }),
      e4: e4Dependencies({ answer: 0, judge: 0, retrieve: 0 }),
      privacy: privacyDependencies(),
      readDataset: async () => {
        reads += 1;
        return Buffer.from(raw);
      },
    });

    expect(reads).toBe(1);
    expect(result.e4.artifact.identity.dataset).toEqual({
      id: "halumem-cli-jsonl",
      sha256: sha256(raw),
    });
    expect(result.privacy.artifact.identity.source).toEqual({
      id: `git:${"a".repeat(40)}`,
      sha256: "b".repeat(64),
    });
    expect(result.update).toEqual({
      reason: "Pinned upstream HaluMem per-item update decisions are unavailable.",
      status: "not_evaluable",
    });

    const verifierInput = {
      dataset: {
        id: "halumem-cli-jsonl",
        path: options.datasetPath,
        sha256: sha256(raw),
      },
      datasetBytes: Buffer.from(raw),
    };
    await expect(PHASE74_HALUMEM_E4_PROTECTION_VERIFIER.verify({
      ...verifierInput,
      run: await loadPhase74FrozenProtectionSuiteRunArtifact(
        result.e4.artifactPath,
      ),
    })).resolves.toBeUndefined();
    await expect(PHASE74_HALUMEM_PRIVACY_PROTECTION_VERIFIER.verify({
      ...verifierInput,
      run: await loadPhase74FrozenProtectionSuiteRunArtifact(
        result.privacy.artifactPath,
      ),
    })).resolves.toBeUndefined();
    expect(PHASE74_HALUMEM_E4_PROTECTION_VERIFIER.requiredMetrics).toEqual([
      PHASE74_HALUMEM_E4_METRIC,
    ]);
    expect(PHASE74_HALUMEM_UPDATE_PROTECTION_VERIFIER.requiredMetrics).toEqual([
      "updateCorrectness",
    ]);
  });
});
