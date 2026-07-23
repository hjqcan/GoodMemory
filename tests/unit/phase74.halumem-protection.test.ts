import { createHash } from "node:crypto";
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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
  preparePhase74HaluMemProtectionPlan,
  runPhase74HaluMemProtectionCli,
} from "../../scripts/run-phase-74-halumem-protection";
import type {
  Phase74HaluMemProtectionCliOptions,
} from "../../scripts/run-phase-74-halumem-protection";
import {
  PHASE74_HALUMEM_E4_METRIC,
  PHASE74_HALUMEM_E4_PROTECTION_VERIFIER,
  PHASE74_HALUMEM_E4_PROTECTION_VERIFIER_ID,
  PHASE74_HALUMEM_E4_SUITE,
  PHASE74_HALUMEM_PRIVACY_PROTECTION_VERIFIER,
  PHASE74_HALUMEM_PRIVACY_PROTECTION_VERIFIER_ID,
  PHASE74_HALUMEM_PRIVACY_SUITE,
  PHASE74_HALUMEM_UPDATE_PROTECTION_VERIFIER,
  PHASE74_HALUMEM_UPDATE_PROTECTION_VERIFIER_ID,
  PHASE74_HALUMEM_UPDATE_SUITE,
  PHASE74_HALUMEM_UPSTREAM,
  buildPhase74HaluMemE4RunIdentity,
  buildPhase74HaluMemSourceMessageId,
  buildPhase74HaluMemPrivacyPopulation,
  buildPhase74HaluMemPrivacyRunIdentity,
  buildPhase74HaluMemQuestionPopulation,
  buildPhase74HaluMemUpdatePopulation,
  buildPhase74HaluMemUpdateRunIdentity,
  buildPhase74HaluMemUpdateJudgePrompt,
  buildPhase74HaluMemUpdateSnapshotId,
  buildPhase74HaluMemUpdateSourceRecord,
  countPhase74HaluMemContextTokens,
  phase74HaluMemPrivacyPopulationId,
  phase74HaluMemQuestionPopulationId,
  phase74HaluMemUpdatePopulationId,
  parsePhase74HaluMemJsonl,
  scorePhase74HaluMemUpdateDecision,
  selectPhase74HaluMemUsers,
  verifyPhase74HaluMemE4ProtectionArtifact,
  verifyPhase74HaluMemPrivacyProtectionArtifact,
  verifyPhase74HaluMemUpdateProtectionArtifact,
} from "../../src/eval/phase74HaluMemProtectionVerifier";
import type {
  Phase74HaluMemUser,
} from "../../src/eval/phase74HaluMemProtectionVerifier";
import {
  hashPhase74ProtectionCaseIds,
} from "../../src/eval/phase74ProtectionContracts";
import {
  buildPhase74ProtectionPlan,
  describePhase74ProtectionCallBudget,
} from "../../src/eval/phase74ProtectionPlan";
import {
  PHASE74_PROTECTION_BLUEPRINT_ID,
} from "../../src/eval/phase74ProtectionVerifier";
import {
  hashPhase74ProtectionValue,
  loadPhase74FrozenProtectionSuiteRunArtifact,
} from "../../src/eval/phase74ProtectionRun";
import type {
  Phase74ProtectionSuite,
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

function plannedIdentity(
  identity: ReturnType<typeof buildPhase74HaluMemE4RunIdentity>,
  caseIds: readonly string[],
) {
  const { populationId, ...descriptor } = identity;
  return {
    ...descriptor,
    population: {
      caseCount: caseIds.length,
      caseIdsSha256: hashPhase74ProtectionCaseIds(caseIds),
      id: populationId,
    },
  };
}

async function writeHaluMemProtectionPlan(input: {
  embeddingSpendLimitUsd?: number;
  maxLanguageCalls?: number;
  options: Phase74HaluMemProtectionCliOptions;
  path: string;
}): Promise<void> {
  const dataset = {
    id: input.options.datasetId,
    sha256: sha256(datasetRaw()),
  };
  const source = {
    id: `git:${"a".repeat(40)}`,
    sha256: "b".repeat(64),
  };
  const blueprint = {
    id: PHASE74_PROTECTION_BLUEPRINT_ID,
    sha256: "9".repeat(64),
  };
  const controls = {
    callBudget: describePhase74ProtectionCallBudget({
      embeddingSpendLimitUsd: input.embeddingSpendLimitUsd ?? 0.25,
      maxLanguageCalls: input.maxLanguageCalls ?? 1_000,
    }),
    caseConcurrency: input.options.caseConcurrency ?? 1,
    renderedContextTokens: 6_000,
  };
  const e4Population = buildPhase74HaluMemQuestionPopulation(users);
  const updatePopulation = buildPhase74HaluMemUpdatePopulation(users);
  const privacyPopulation = buildPhase74HaluMemPrivacyPopulation(users);
  const run = (
    caseIds: string[],
    identity: ReturnType<typeof buildPhase74HaluMemE4RunIdentity>,
    runId: string,
    suite: Phase74ProtectionSuite,
    verifierId: string,
  ) => ({
    caseIds,
    controls,
    identity: plannedIdentity(identity, caseIds),
    protectionBlueprint: blueprint,
    replicate: input.options.replicate,
    runId,
    suite,
    verifier: {
      id: verifierId,
      sha256: hashPhase74ProtectionValue({ id: verifierId }),
    },
  });
  const plan = buildPhase74ProtectionPlan({
    admissionClass: "diagnostic",
    evaluatorSource: source,
    protectionBlueprint: blueprint,
    runs: [
      run(
        e4Population.cases.map(({ caseId }) => caseId),
        buildPhase74HaluMemE4RunIdentity({
          configuration: input.options.e4Configuration,
          dataset,
          populationId: phase74HaluMemQuestionPopulationId(
            dataset.id,
            users,
          ),
          source,
        }),
        `${input.options.runId}-e4`,
        PHASE74_HALUMEM_E4_SUITE,
        PHASE74_HALUMEM_E4_PROTECTION_VERIFIER_ID,
      ),
      run(
        updatePopulation.cases.map(({ caseId }) => caseId),
        buildPhase74HaluMemUpdateRunIdentity({
          configuration: input.options.updateConfiguration,
          dataset,
          populationId: phase74HaluMemUpdatePopulationId(
            dataset.id,
            users,
          ),
          source,
        }),
        `${input.options.runId}-update`,
        PHASE74_HALUMEM_UPDATE_SUITE,
        PHASE74_HALUMEM_UPDATE_PROTECTION_VERIFIER_ID,
      ),
      run(
        privacyPopulation.cases.map(({ caseId }) => caseId),
        buildPhase74HaluMemPrivacyRunIdentity({
          configuration: input.options.privacyConfiguration,
          dataset,
          populationId: phase74HaluMemPrivacyPopulationId(
            dataset.id,
            users,
          ),
          source,
        }),
        `${input.options.runId}-privacy`,
        PHASE74_HALUMEM_PRIVACY_SUITE,
        PHASE74_HALUMEM_PRIVACY_PROTECTION_VERIFIER_ID,
      ),
    ],
  });
  await writeFile(input.path, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
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
      const category = retrievedMemories.includes(expectedUpdate)
        ? "Correct"
        : "Omission";
      return JSON.stringify({
        category,
        protocol: "halumem-upstream-per-item-update-v1",
        rawDecision: JSON.stringify({
          evaluation_result: category,
          reason: "fake upstream item decision",
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
      calls.retrieve += 1;
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
  it("derives update correctness only from the strict raw HaluMem category", () => {
    const usage = {
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      inputTokens: 20,
      outputTokens: 5,
      uncachedInputTokens: 20,
    };
    const hallucination = JSON.stringify({
      category: "Hallucination",
      protocol: "halumem-upstream-per-item-update-v1",
      rawDecision: JSON.stringify({
        evaluation_result: "Hallucination",
        reason: "The generated memory contradicts the target update.",
      }),
      usage,
    });

    expect(scorePhase74HaluMemUpdateDecision(hallucination)).toBe(0);
    expect(() => scorePhase74HaluMemUpdateDecision(JSON.stringify({
      category: "Correct",
      protocol: "halumem-upstream-per-item-update-v1",
      rawDecision: JSON.stringify({
        evaluation_result: "Hallucination",
        reason: "The generated memory contradicts the target update.",
      }),
      usage,
    }))).toThrow("category drifted");
    expect(() => scorePhase74HaluMemUpdateDecision(JSON.stringify({
      category: "Correct",
      protocol: "halumem-upstream-per-item-update-v1",
      rawDecision: JSON.stringify({
        evaluation_result: "Correct",
        reason: "No token usage was observed.",
      }),
      usage: {
        cacheCreationInputTokens: null,
        cacheReadInputTokens: null,
        inputTokens: null,
        outputTokens: null,
        uncachedInputTokens: null,
      },
    }))).toThrow("usage");
  });

  it("renders the pinned upstream update prompt byte-for-byte", () => {
    const prompt = buildPhase74HaluMemUpdateJudgePrompt({
      expectedUpdate: "updated",
      originalMemories: ["old"],
      retrievedMemories: ["m1", "m2"],
    });

    expect(sha256(prompt)).toBe(
      "09fe8f86418cf45248d1c12eb4bfe2b61e8ad0adf389fffcb4f0b4e56d014170",
    );
    expect(prompt.endsWith("```\n")).toBe(true);
  });

  it("renders upstream placeholders once without rewriting inserted memory text", () => {
    const prompt = buildPhase74HaluMemUpdateJudgePrompt({
      expectedUpdate: "updated {original_memory}",
      originalMemories: ["original {memories}"],
      retrievedMemories: ["retrieved {updated_memory}"],
    });

    expect(prompt).toContain("retrieved {updated_memory}");
    expect(prompt).toContain("updated {original_memory}");
    expect(prompt).toContain("original {memories}");
  });

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

  it("passes case concurrency through the HaluMem suite adapter", async () => {
    const root = await createRoot();
    let activeCases = 0;
    let maxActiveCases = 0;
    await runPhase74HaluMemUpdateProtection({
      artifactPath: join(root, "concurrent-run.json"),
      caseConcurrency: 2,
      configuration: configuration({
        candidatePipeline: descriptor("halumem-phase74-candidate", "4"),
        updateEvaluator: descriptor("halumem-upstream-evaluation.py", "5"),
      }),
      dataset: descriptor("halumem-test-jsonl", "1"),
      rawArtifactPath: join(root, "concurrent-raw.json"),
      replicate: 1,
      runId: "halumem-concurrent",
      source: descriptor("git:test-source", "2"),
      users,
    }, {
      evaluateUpdate: async () => JSON.stringify({
        category: "Correct",
        protocol: "halumem-upstream-per-item-update-v1",
        rawDecision: JSON.stringify({
          evaluation_result: "Correct",
          reason: "fake upstream item decision",
        }),
        usage: {
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          inputTokens: 10,
          outputTokens: 5,
          uncachedInputTokens: 10,
        },
      }),
      retrieveUpdateEvidence: async ({
        branch,
        memoryPoint,
        sessionIndex,
        updateCaseId,
        user,
      }) => {
        if (branch === "baseline") {
          activeCases += 1;
          maxActiveCases = Math.max(maxActiveCases, activeCases);
        }
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
        if (branch === "candidate") {
          activeCases -= 1;
        }
        const sourceMessageIds = [buildPhase74HaluMemSourceMessageId({
          sessionIndex,
          turnIndex: 0,
          userUuid: user.uuid,
        })];
        const records = [{
          content: memoryPoint.memory_content,
          evidenceLinks: updateEvidenceLinks(
            `${branch}-fact-1`,
            user,
            sessionIndex,
          ),
          id: `${branch}-fact-1`,
          rank: 1,
          sourceMessageIds,
          type: "fact" as const,
        }];
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

    expect(maxActiveCases).toBe(2);
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

  it("rejects rehashed update evidence with non-causal sources or a forged snapshot id", async () => {
    const config = configuration({
      candidatePipeline: descriptor("halumem-phase74-candidate", "4"),
      updateEvaluator: descriptor("halumem-upstream-evaluation.py", "5"),
    });
    const dataset = descriptor("halumem-test-jsonl", "1");
    const source = descriptor("git:test-source", "2");

    const nonCausalRoot = await createRoot();
    const nonCausal = await runPhase74HaluMemUpdateProtection({
      artifactPath: join(nonCausalRoot, "run.json"),
      configuration: config,
      dataset,
      rawArtifactPath: join(nonCausalRoot, "raw.json"),
      replicate: 1,
      runId: "halumem-update-non-causal",
      source,
      users,
    }, updateDependencies({ evaluate: 0, retrieve: 0 }));
    const nonCausalRaw = JSON.parse(
      await readFile(nonCausal.rawArtifactPath, "utf8"),
    );
    nonCausalRaw.rows[0].candidate.rawOutput.sourceMessageIds = [
      "halumem-source-from-another-user-or-future-session",
    ];
    await rewriteRawArtifact({
      artifactPath: nonCausal.artifactPath,
      raw: nonCausalRaw,
      rawArtifactPath: nonCausal.rawArtifactPath,
    });
    await expect(verifyPhase74HaluMemUpdateProtectionArtifact({
      artifactPath: nonCausal.artifactPath,
      configuration: config,
      dataset,
      source,
      users,
    })).rejects.toThrow(/causal|source/iu);

    const forgedSnapshotRoot = await createRoot();
    const forgedSnapshot = await runPhase74HaluMemUpdateProtection({
      artifactPath: join(forgedSnapshotRoot, "run.json"),
      configuration: config,
      dataset,
      rawArtifactPath: join(forgedSnapshotRoot, "raw.json"),
      replicate: 1,
      runId: "halumem-update-forged-snapshot",
      source,
      users,
    }, updateDependencies({ evaluate: 0, retrieve: 0 }));
    const forgedSnapshotRaw = JSON.parse(
      await readFile(forgedSnapshot.rawArtifactPath, "utf8"),
    );
    forgedSnapshotRaw.rows[0].candidate.rawOutput.snapshotId =
      "self-declared-but-not-recomputed";
    await rewriteRawArtifact({
      artifactPath: forgedSnapshot.artifactPath,
      raw: forgedSnapshotRaw,
      rawArtifactPath: forgedSnapshot.rawArtifactPath,
    });
    await expect(verifyPhase74HaluMemUpdateProtectionArtifact({
      artifactPath: forgedSnapshot.artifactPath,
      configuration: config,
      dataset,
      source,
      users,
    })).rejects.toThrow(/snapshot/iu);
  });

  it("records oversized update snapshots as non-composable execution evidence", async () => {
    const root = await createRoot();
    const config = configuration({
      candidatePipeline: descriptor("halumem-phase74-candidate", "4"),
      updateEvaluator: descriptor("halumem-upstream-evaluation.py", "5"),
    });
    const calls = { evaluate: 0, retrieve: 0 };
    const dependencies = updateDependencies(calls);
    dependencies.retrieveUpdateEvidence = async ({ branch }) => ({
      records: Array.from({ length: 11 }, (_, index) => ({
        content: `fact-${index + 1}`,
        evidenceLinks: updateEvidenceLinks(
          `fact-${index + 1}`,
          users[0]!,
          0,
        ),
        id: `fact-${index + 1}`,
        rank: index + 1,
        sourceMessageIds: ["source-message-0"],
        type: "fact" as const,
      })),
      snapshotId: `${branch}-snapshot`,
      sourceMessageIds: ["source-message-0"],
    });
    const artifactPath = join(root, "run.json");
    const rawArtifactPath = join(root, "raw.json");
    const dataset = descriptor("halumem-test-jsonl", "1");
    const source = descriptor("git:test-source", "2");

    await expect(runPhase74HaluMemUpdateProtection({
      artifactPath,
      configuration: config,
      dataset,
      rawArtifactPath,
      replicate: 1,
      runId: "halumem-update-top-k-source",
      source,
      users: [users[0]!],
    }, dependencies)).rejects.toThrow("recorded 1 execution failure");

    const raw = JSON.parse(await readFile(rawArtifactPath, "utf8"));
    expect(raw).toMatchObject({
      executionFailures: 1,
      failures: [{
        branch: "baseline",
        caseId: "user-a:session:0:update:0",
        name: "Error",
      }],
      rows: [],
    });
    expect(raw.failures[0].message).toContain("top-10");
    expect(calls.evaluate).toBe(0);

    const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
    expect(artifact).toMatchObject({ executionFailures: 1, rows: [] });
    await expect(loadPhase74FrozenProtectionSuiteRunArtifact(artifactPath))
      .rejects.toThrow("requires zero execution failures");
    await expect(verifyPhase74HaluMemUpdateProtectionArtifact({
      artifactPath,
      configuration: config,
      dataset,
      source,
      users: [users[0]!],
    })).rejects.toThrow("requires zero execution failures");
  });

  it("rejects a rehashed update artifact with more than ten generated records", async () => {
    const root = await createRoot();
    const config = configuration({
      candidatePipeline: descriptor("halumem-phase74-candidate", "4"),
      updateEvaluator: descriptor("halumem-upstream-evaluation.py", "5"),
    });
    const dataset = descriptor("halumem-test-jsonl", "1");
    const source = descriptor("git:test-source", "2");
    const result = await runPhase74HaluMemUpdateProtection({
      artifactPath: join(root, "run.json"),
      configuration: config,
      dataset,
      rawArtifactPath: join(root, "raw.json"),
      replicate: 1,
      runId: "halumem-update-top-k",
      source,
      users: [users[0]!],
    }, updateDependencies({ evaluate: 0, retrieve: 0 }));
    const raw = JSON.parse(await readFile(result.rawArtifactPath, "utf8"));
    const memories = Array.from({ length: 11 }, (_, index) => `fact-${index + 1}`);
    raw.rows[0].candidate.rawOutput.memories = memories;
    raw.rows[0].candidate.rawOutput.records = memories.map(
      (content: string, index: number) => ({
        content,
        id: `forged-fact-${index + 1}`,
        rank: index + 1,
        sourceMessageIds:
          raw.rows[0].candidate.rawOutput.sourceMessageIds,
        type: "fact",
      }),
    );
    raw.rows[0].candidate.rawOutput.context = memories.join("\n");
    raw.rows[0].candidate.rawOutput.contextTokens =
      countPhase74HaluMemContextTokens(memories.join("\n"));
    await rewriteRawArtifact({
      artifactPath: result.artifactPath,
      raw,
      rawArtifactPath: result.rawArtifactPath,
    });

    await expect(verifyPhase74HaluMemUpdateProtectionArtifact({
      artifactPath: result.artifactPath,
      configuration: config,
      dataset,
      source,
      users: [users[0]!],
    })).rejects.toThrow("top-10");
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
      privacyConfiguration: configuration({
        candidatePipeline: descriptor("halumem-privacy-candidate", "4"),
      }),
      replicate: 1,
      runId: "halumem-cli-r1",
      updateConfiguration: configuration({
        candidatePipeline: descriptor("halumem-update-candidate", "5"),
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
    expect(result.e4.artifact.schemaVersion).toBe(1);
    expect(result.privacy.artifact.schemaVersion).toBe(1);
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

  it("binds one prevalidated plan into all three HaluMem run artifacts", async () => {
    const root = await createRoot();
    const planPath = join(root, "protection-plan.json");
    const options: Phase74HaluMemProtectionCliOptions = {
      caseConcurrency: 2,
      datasetId: "halumem-cli-jsonl",
      datasetPath: join(root, "HaluMem-Medium.jsonl"),
      e4Configuration: configuration(),
      embeddingSpendLimitUsd: 0.25,
      maxLanguageCalls: 1_000,
      outputDir: join(root, "runs"),
      privacyConfiguration: configuration({
        candidatePipeline: descriptor("halumem-privacy-candidate", "4"),
      }),
      protectionPlanPath: planPath,
      replicate: 1,
      runId: "halumem-planned-r1",
      updateConfiguration: configuration({
        candidatePipeline: descriptor("halumem-update-candidate", "5"),
        updateEvaluator: descriptor("halumem-upstream-evaluation.py", "6"),
      }),
      userUuids: ["user-a", "user-b"],
    };
    await writeHaluMemProtectionPlan({ options, path: planPath });
    const e4Calls = { answer: 0, judge: 0, retrieve: 0 };
    const updateCalls = { evaluate: 0, retrieve: 0 };
    let privacyCalls = 0;

    const result = await runPhase74HaluMemProtectionCli(options, {
      captureEvaluatorSource: async () => ({
        commit: "a".repeat(40),
        sha256: "b".repeat(64),
      }),
      e4: e4Dependencies(e4Calls),
      privacy: {
        recallScopes: async (input) => {
          privacyCalls += 1;
          return privacyDependencies().recallScopes(input);
        },
      },
      readDataset: async () => Buffer.from(datasetRaw()),
      update: updateDependencies(updateCalls),
    });

    expect(result.update.status).toBe("completed");
    expect(e4Calls.retrieve).toBeGreaterThan(0);
    expect(updateCalls.retrieve).toBeGreaterThan(0);
    expect(privacyCalls).toBeGreaterThan(0);
    expect(result.e4.artifact.schemaVersion).toBe(2);
    expect(result.privacy.artifact.schemaVersion).toBe(2);
    if (result.update.status !== "completed") {
      throw new Error("Expected planned HaluMem update evidence.");
    }
    expect(result.update.result.artifact.schemaVersion).toBe(2);
    expect(result.e4.artifact).toMatchObject({
      planPath: resolve(planPath),
      schemaVersion: 2,
    });
  });

  it("guards direct E4 retrieval with the same pre-execution binding", async () => {
    const root = await createRoot();
    const planPath = join(root, "protection-plan.json");
    const options: Phase74HaluMemProtectionCliOptions = {
      caseConcurrency: 2,
      datasetId: "halumem-cli-jsonl",
      datasetPath: join(root, "HaluMem-Medium.jsonl"),
      e4Configuration: configuration(),
      embeddingSpendLimitUsd: 0.25,
      maxLanguageCalls: 1_000,
      outputDir: join(root, "runs"),
      privacyConfiguration: configuration({
        candidatePipeline: descriptor("halumem-privacy-candidate", "4"),
      }),
      protectionPlanPath: planPath,
      replicate: 1,
      runId: "halumem-direct-r1",
      updateConfiguration: configuration({
        candidatePipeline: descriptor("halumem-update-candidate", "5"),
        updateEvaluator: descriptor("halumem-upstream-evaluation.py", "6"),
      }),
      userUuids: ["user-a", "user-b"],
    };
    await writeHaluMemProtectionPlan({ options, path: planPath });
    const dataset = {
      id: options.datasetId,
      sha256: sha256(datasetRaw()),
    };
    const source = {
      id: `git:${"a".repeat(40)}`,
      sha256: "b".repeat(64),
    };
    const planned = await preparePhase74HaluMemProtectionPlan({
      caseConcurrency: 2,
      dataset,
      e4Configuration: options.e4Configuration,
      embeddingSpendLimitUsd: 0.25,
      maxLanguageCalls: 1_000,
      planPath,
      privacyConfiguration: options.privacyConfiguration,
      replicate: 1,
      runId: options.runId,
      source,
      updateConfiguration: options.updateConfiguration,
      users,
    });
    const calls = { answer: 0, judge: 0, retrieve: 0 };
    const artifactPath = join(root, "direct", "protection-run.json");
    const rawArtifactPath = join(root, "direct", "raw.json");

    await expect(runPhase74HaluMemE4Protection({
      artifactPath,
      caseConcurrency: 2,
      configuration: options.e4Configuration,
      dataset,
      plan: planned.e4,
      rawArtifactPath,
      replicate: 1,
      runId: `${options.runId}-e4-drift`,
      source,
      users,
    }, e4Dependencies(calls))).rejects.toThrow(/drift|plan/iu);

    expect(calls).toEqual({ answer: 0, judge: 0, retrieve: 0 });
    await expect(readFile(artifactPath, "utf8")).rejects.toThrow();
    await expect(readFile(rawArtifactPath, "utf8")).rejects.toThrow();
  });

  it("rejects any planned control drift before callbacks or output", async () => {
    const root = await createRoot();
    const planPath = join(root, "protection-plan.json");
    const outputDir = join(root, "planned-output");
    const options: Phase74HaluMemProtectionCliOptions = {
      caseConcurrency: 2,
      datasetId: "halumem-cli-jsonl",
      datasetPath: join(root, "HaluMem-Medium.jsonl"),
      e4Configuration: configuration(),
      embeddingSpendLimitUsd: 0.5,
      maxLanguageCalls: 1_000,
      outputDir,
      privacyConfiguration: configuration({
        candidatePipeline: descriptor("halumem-privacy-candidate", "4"),
      }),
      protectionPlanPath: planPath,
      replicate: 1,
      runId: "halumem-drifted-r1",
      updateConfiguration: configuration({
        candidatePipeline: descriptor("halumem-update-candidate", "5"),
        updateEvaluator: descriptor("halumem-upstream-evaluation.py", "6"),
      }),
      userUuids: ["user-a", "user-b"],
    };
    await writeHaluMemProtectionPlan({
      embeddingSpendLimitUsd: 0.25,
      options,
      path: planPath,
    });
    const calls = {
      answer: 0,
      evaluate: 0,
      judge: 0,
      privacy: 0,
      retrieveE4: 0,
      retrieveUpdate: 0,
    };

    await expect(runPhase74HaluMemProtectionCli(options, {
      captureEvaluatorSource: async () => ({
        commit: "a".repeat(40),
        sha256: "b".repeat(64),
      }),
      e4: {
        answer: async () => {
          calls.answer += 1;
          return "unexpected";
        },
        judgeQa: async () => {
          calls.judge += 1;
          return "unexpected";
        },
        retrieveEvidence: async () => {
          calls.retrieveE4 += 1;
          return { evidenceLedger: [], snapshotId: "unexpected" };
        },
      },
      privacy: {
        recallScopes: async () => {
          calls.privacy += 1;
          return {
            foreignScopeSourceMessageIds: [],
            ownerScopeSourceMessageIds: [],
            snapshotId: "unexpected",
          };
        },
      },
      readDataset: async () => Buffer.from(datasetRaw()),
      update: {
        evaluateUpdate: async () => {
          calls.evaluate += 1;
          return "unexpected";
        },
        retrieveUpdateEvidence: async () => {
          calls.retrieveUpdate += 1;
          return {
            records: [],
            snapshotId: "unexpected",
            sourceMessageIds: [],
          };
        },
      },
    })).rejects.toThrow(/drift|plan/iu);

    expect(calls).toEqual({
      answer: 0,
      evaluate: 0,
      judge: 0,
      privacy: 0,
      retrieveE4: 0,
      retrieveUpdate: 0,
    });
    await expect(readdir(outputDir)).rejects.toThrow();
  });
});
