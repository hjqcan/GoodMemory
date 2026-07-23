import { createHash } from "node:crypto";

import { describe, expect, it } from "bun:test";

import {
  buildPhase74EmbeddingIdentity,
  capturePhase74EvaluatorSource,
  createPhase74LiveJudge,
  createPhase74LiveReader,
  PHASE74_GENERIC_READER_SYSTEM_PROMPT,
  PHASE74_EVALUATOR_SOURCE_SNAPSHOT,
  phase74LivePromptSha256s,
  resolvePhase74EvaluatorSource,
  resolvePhase74ExecutorModels,
  resolvePhase74LiveModels,
  resolvePhase74ReaderModel,
  resolvePhase74ScorerModels,
  verifyPhase74EvaluatorSource,
} from "../../src/eval/phase74Live";
import type {
  AttributedModelUsageAttempt,
  AttributedModelUsageIntent,
} from "../../src/eval/modelUsage";
import {
  COMPACT_CONVERSATIONAL_MEMORY_EXTRACTION_SYSTEM_PROMPT,
  CONVERSATIONAL_MEMORY_EXTRACTION_SYSTEM_PROMPT,
  MEMORY_EXTRACTION_SYSTEM_PROMPT,
} from "../../src/provider/memory-extractor";
import { RECALL_PLAN_ASSISTANT_SYSTEM_PROMPT } from "../../src/provider/recall-plan-assistant";
import { POINTWISE_RERANKER_SYSTEM_PROMPT } from "../../src/provider/reranker";
import { PHASE74_PROTOCOL_READER_SYSTEM_PROMPT } from "../../src/eval/phase74ProtocolReader";

const env = {
  GOODMEMORY_EMBEDDING_API_KEY: "embedding-key",
  GOODMEMORY_EMBEDDING_BASE_URL: "https://openrouter.ai/api/v1",
  GOODMEMORY_EMBEDDING_MODEL: "text-embedding-3-small",
  GOODMEMORY_EMBEDDING_PROVIDER: "openai",
  GOODMEMORY_EVAL_API_KEY: "answer-key",
  GOODMEMORY_EVAL_BASE_URL: "https://ai.gurkiai.com/v1",
  GOODMEMORY_EVAL_MODEL: "gpt-5.6-terra",
  GOODMEMORY_EVAL_PROVIDER: "openai",
  GOODMEMORY_JUDGE_API_KEY: "judge-key",
  GOODMEMORY_JUDGE_BASE_URL: "https://ai.gurkiai.com/v1",
  GOODMEMORY_JUDGE_MODEL: "gpt-5.5",
  GOODMEMORY_JUDGE_PROVIDER: "openai",
};

describe("Phase 74 live provider boundary", () => {
  it("binds post-run aggregation and the real storage gate into evaluator source identity", () => {
    expect(PHASE74_EVALUATOR_SOURCE_SNAPSHOT.version).toBe(6);
    expect(PHASE74_EVALUATOR_SOURCE_SNAPSHOT.files).toContain(
      "scripts/aggregate-phase-74-generalization.ts",
    );
    expect(PHASE74_EVALUATOR_SOURCE_SNAPSHOT.files).toContain(
      "scripts/run-phase-74-storage-scale-gate.ts",
    );
    expect(PHASE74_EVALUATOR_SOURCE_SNAPSHOT.files).toContain(
      "scripts/run-phase-74-generalization-executor.ts",
    );
    expect(PHASE74_EVALUATOR_SOURCE_SNAPSHOT.files).toContain(
      "scripts/run-phase-74-generalization-scorer.ts",
    );
    expect(PHASE74_EVALUATOR_SOURCE_SNAPSHOT.files).toContain(
      "scripts/phase-74-memory-agent-bench-protection.ts",
    );
    expect(PHASE74_EVALUATOR_SOURCE_SNAPSHOT.files).toContain(
      "scripts/run-phase-74-memory-agent-bench-protection.ts",
    );
    expect(PHASE74_EVALUATOR_SOURCE_SNAPSHOT.files).toContain(
      "scripts/run-phase-64-memory-agent-bench-smoke.ts",
    );
    expect(PHASE74_EVALUATOR_SOURCE_SNAPSHOT.files).toContain(
      "scripts/run-phase-74-beam-safety-protection.ts",
    );
    expect(PHASE74_EVALUATOR_SOURCE_SNAPSHOT.files).toContain(
      "scripts/phase-74-halumem-protection.ts",
    );
    expect(PHASE74_EVALUATOR_SOURCE_SNAPSHOT.files).toContain(
      "scripts/phase-74-halumem-live-providers.ts",
    );
    expect(PHASE74_EVALUATOR_SOURCE_SNAPSHOT.files).toContain(
      "scripts/run-phase-74-halumem-protection.ts",
    );
    expect(PHASE74_EVALUATOR_SOURCE_SNAPSHOT.files).toContain(
      "scripts/run-phase-74-halumem-live-protection.ts",
    );
  });

  it("hashes the actual extraction, planning, and reranking system prompts", () => {
    const sha256 = (value: string) =>
      createHash("sha256").update(value).digest("hex");
    const hashes = phase74LivePromptSha256s();

    expect(hashes.assistedExtraction).toBe(
      sha256(MEMORY_EXTRACTION_SYSTEM_PROMPT),
    );
    expect(hashes.conversationalExtraction).toBe(
      sha256(COMPACT_CONVERSATIONAL_MEMORY_EXTRACTION_SYSTEM_PROMPT),
    );
    expect(hashes.conversationalExtraction).not.toBe(
      sha256(CONVERSATIONAL_MEMORY_EXTRACTION_SYSTEM_PROMPT),
    );
    expect(hashes.planner).toBe(sha256(RECALL_PLAN_ASSISTANT_SYSTEM_PROMPT));
    expect(hashes.reranker).toBe(sha256(POINTWISE_RERANKER_SYSTEM_PROMPT));
    expect(hashes.protocolReader).toBe(sha256([
      PHASE74_PROTOCOL_READER_SYSTEM_PROMPT,
      PHASE74_GENERIC_READER_SYSTEM_PROMPT,
    ].join("\0")));
  });

  it("requires an exact evaluator commit and source snapshot hash", () => {
    expect(resolvePhase74EvaluatorSource({
      GOODMEMORY_PHASE74_SOURCE_COMMIT:
        "5d7639a8fa164d86e0aa1ed10a8ea398b7912464",
      GOODMEMORY_PHASE74_SOURCE_SHA256:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    })).toEqual({
      commit: "5d7639a8fa164d86e0aa1ed10a8ea398b7912464",
      sha256:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    });
    expect(() => resolvePhase74EvaluatorSource({
      GOODMEMORY_PHASE74_SOURCE_COMMIT: "main",
      GOODMEMORY_PHASE74_SOURCE_SHA256: "short",
    })).toThrow("exact 40-character commit and 64-character SHA-256");
  });

  it("verifies evaluator source declarations against the actual checkout", async () => {
    const declared = {
      commit: "5d7639a8fa164d86e0aa1ed10a8ea398b7912464",
      sha256:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    };
    const dependencies = {
      hashSnapshot: async () => declared.sha256,
      resolveGitHead: async () => declared.commit,
      resolveSourceStatus: async () => "",
    };

    await expect(capturePhase74EvaluatorSource({
      dependencies,
      repoRoot: "/repo",
    })).resolves.toEqual(declared);
    await expect(verifyPhase74EvaluatorSource({
      declared,
      dependencies,
      repoRoot: "/repo",
    })).resolves.toEqual(declared);
    await expect(verifyPhase74EvaluatorSource({
      declared,
      dependencies: {
        ...dependencies,
        resolveGitHead: async () => "a".repeat(40),
      },
      repoRoot: "/repo",
    })).rejects.toThrow("commit does not match git HEAD");
    await expect(verifyPhase74EvaluatorSource({
      declared,
      dependencies: {
        ...dependencies,
        hashSnapshot: async () => "b".repeat(64),
      },
      repoRoot: "/repo",
    })).rejects.toThrow("source snapshot SHA-256 does not match");
    await expect(verifyPhase74EvaluatorSource({
      declared,
      dependencies: {
        ...dependencies,
        resolveSourceStatus: async () => " M src/eval/phase74Live.ts\n",
      },
      repoRoot: "/repo",
    })).rejects.toThrow("tracked tree or evaluator source snapshot is dirty");
  });

  it("captures evaluator source inside a sequential clean-tree bracket", async () => {
    const calls: string[] = [];
    let headCalls = 0;
    let statusCalls = 0;
    const source = {
      commit: "5d7639a8fa164d86e0aa1ed10a8ea398b7912464",
      sha256:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    };

    await expect(capturePhase74EvaluatorSource({
      dependencies: {
        hashSnapshot: async () => {
          calls.push("hash");
          return source.sha256;
        },
        resolveGitHead: async () => {
          calls.push(headCalls === 0 ? "head-before" : "head-after");
          headCalls += 1;
          return source.commit;
        },
        resolveSourceStatus: async () => {
          calls.push(statusCalls === 0 ? "status-before" : "status-after");
          statusCalls += 1;
          return "";
        },
      },
      repoRoot: "/repo",
    })).resolves.toEqual(source);
    expect(calls).toEqual([
      "status-before",
      "head-before",
      "hash",
      "head-after",
      "status-after",
    ]);
  });

  it("rejects evaluator source capture when HEAD changes during hashing", async () => {
    let headCalls = 0;

    await expect(capturePhase74EvaluatorSource({
      dependencies: {
        hashSnapshot: async () => "0".repeat(64),
        resolveGitHead: async () => {
          headCalls += 1;
          return headCalls === 1 ? "1".repeat(40) : "2".repeat(40);
        },
        resolveSourceStatus: async () => "",
      },
      repoRoot: "/repo",
    })).rejects.toThrow("git HEAD changed while evaluator source was captured");
  });

  it("rejects evaluator source capture when the tree becomes dirty after hashing", async () => {
    let statusCalls = 0;

    await expect(capturePhase74EvaluatorSource({
      dependencies: {
        hashSnapshot: async () => "0".repeat(64),
        resolveGitHead: async () => "1".repeat(40),
        resolveSourceStatus: async () => {
          statusCalls += 1;
          return statusCalls === 1 ? "" : " M src/eval/phase74Live.ts\n";
        },
      },
      repoRoot: "/repo",
    })).rejects.toThrow("tracked tree or evaluator source snapshot is dirty");
  });

  it("pins language calls to Terra/GurkiAI, the judge independently, and embeddings to OpenRouter", () => {
    const models = resolvePhase74LiveModels(env);
    expect(models.answer).toMatchObject({
      baseURL: "https://ai.gurkiai.com/v1",
      model: "gpt-5.6-terra",
      provider: "openai",
    });
    expect(models.assistedExtraction).toEqual(models.answer);
    expect(models.planner).toEqual(models.answer);
    expect(models.reranker).toEqual(models.answer);
    expect(models.judge).toMatchObject({ model: "gpt-5.5" });
    expect(models.embedding).toMatchObject({
      baseURL: "https://openrouter.ai/api/v1",
      model: "text-embedding-3-small",
      provider: "openai",
    });

    expect(() => resolvePhase74LiveModels({
      ...env,
      GOODMEMORY_JUDGE_MODEL: "gpt-5.6-terra",
    })).toThrow("independent gpt-5.5");
    expect(() => resolvePhase74LiveModels({
      ...env,
      GOODMEMORY_EVAL_BASE_URL: "https://api.openai.com/v1",
    })).toThrow("gpt-5.6-terra through https://ai.gurkiai.com/v1");
    expect(() => resolvePhase74LiveModels({
      ...env,
      GOODMEMORY_EMBEDDING_BASE_URL: "https://ai.gurkiai.com/v1",
    })).toThrow("text-embedding-3-small through https://openrouter.ai/api/v1");
    expect(() => resolvePhase74LiveModels({
      ...env,
      GOODMEMORY_EMBEDDING_MODEL: "text-embedding-3-large",
    })).toThrow("text-embedding-3-small through https://openrouter.ai/api/v1");
  });

  it("resolves executor and scorer credentials through disjoint capability boundaries", () => {
    const executorEnv = new Proxy({
      ...env,
      GOODMEMORY_JUDGE_API_KEY: "judge-sentinel",
      GOODMEMORY_JUDGE_BASE_URL: "judge-sentinel",
      GOODMEMORY_JUDGE_MODEL: "judge-sentinel",
      GOODMEMORY_JUDGE_PROVIDER: "judge-sentinel",
    }, {
      get(target, property, receiver) {
        if (String(property).startsWith("GOODMEMORY_JUDGE_")) {
          throw new Error("executor read judge credentials");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const executorModels = resolvePhase74ExecutorModels(executorEnv);
    expect(Object.keys(executorModels).sort()).toEqual([
      "answer",
      "assistedExtraction",
      "embedding",
      "planner",
      "reranker",
    ]);
    expect("judge" in executorModels).toBe(false);

    const scorerEnv = new Proxy({
      GOODMEMORY_JUDGE_API_KEY: env.GOODMEMORY_JUDGE_API_KEY,
      GOODMEMORY_JUDGE_BASE_URL: env.GOODMEMORY_JUDGE_BASE_URL,
      GOODMEMORY_JUDGE_MODEL: env.GOODMEMORY_JUDGE_MODEL,
      GOODMEMORY_JUDGE_PROVIDER: env.GOODMEMORY_JUDGE_PROVIDER,
    }, {
      get(target, property, receiver) {
        if (
          String(property).startsWith("GOODMEMORY_EVAL_") ||
          String(property).startsWith("GOODMEMORY_EMBEDDING_")
        ) {
          throw new Error("scorer read executor credentials");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const scorerModels = resolvePhase74ScorerModels(scorerEnv);
    expect(Object.keys(scorerModels)).toEqual(["judge"]);
    expect(scorerModels.judge).toMatchObject({
      baseURL: "https://ai.gurkiai.com/v1",
      model: "gpt-5.5",
      provider: "openai",
    });
  });

  it("resolves the E4 scorer reader without embedding or judge credentials", () => {
    const readerEnv = new Proxy({
      GOODMEMORY_EVAL_API_KEY: env.GOODMEMORY_EVAL_API_KEY,
      GOODMEMORY_EVAL_BASE_URL: env.GOODMEMORY_EVAL_BASE_URL,
      GOODMEMORY_EVAL_MODEL: env.GOODMEMORY_EVAL_MODEL,
      GOODMEMORY_EVAL_PROVIDER: env.GOODMEMORY_EVAL_PROVIDER,
    }, {
      get(target, property, receiver) {
        if (
          String(property).startsWith("GOODMEMORY_EMBEDDING_") ||
          String(property).startsWith("GOODMEMORY_JUDGE_")
        ) {
          throw new Error("reader resolver crossed its capability boundary");
        }
        return Reflect.get(target, property, receiver);
      },
    });

    expect(resolvePhase74ReaderModel(readerEnv)).toMatchObject({
      baseURL: "https://ai.gurkiai.com/v1",
      model: "gpt-5.6-terra",
      provider: "openai",
    });
  });

  it("records embedding configuration without a credential fingerprint", () => {
    const identity = buildPhase74EmbeddingIdentity(
      resolvePhase74LiveModels(env).embedding,
    );

    expect(identity).toEqual({
      adapterVersion: "openai-compatible-embedding-v1",
      batchMaxConcurrency: 8,
      batchMaxInputs: 256,
      batchMaxUtf8Bytes: 200_000,
      gateway: "https://openrouter.ai/api/v1",
      model: "text-embedding-3-small",
      provider: "openai",
      requestTimeoutMs: 45_000,
      retryLimit: 8,
    });
    expect(JSON.stringify(identity)).not.toContain("embedding-key");
    expect(buildPhase74EmbeddingIdentity(
      resolvePhase74LiveModels({
        ...env,
        GOODMEMORY_EMBEDDING_API_KEY: "rotated-key",
      }).embedding,
    )).toEqual(identity);
  });

  it("uses one label-free reader prompt and attributes its exact charged request", async () => {
    const events: AttributedModelUsageAttempt[] = [];
    const intents: AttributedModelUsageIntent[] = [];
    const usageOrder: string[] = [];
    let requestBody = "";
    const reader = createPhase74LiveReader({
      events,
      fetch: async (_url, init) => {
        usageOrder.push("provider");
        requestBody = String(init?.body);
        return new Response([
          'data: {"choices":[{"delta":{"content":"Postgres"},"index":0}]}',
          'data: {"choices":[],"usage":{"prompt_tokens":20,"completion_tokens":2}}',
          "data: [DONE]",
          "",
        ].join("\n\n"), {
          headers: { "content-type": "text/event-stream" },
          status: 200,
        });
      },
      intents,
      model: resolvePhase74LiveModels(env).answer,
      onUsageEvent: () => usageOrder.push("terminal"),
      onUsageIntent: () => usageOrder.push("intent"),
    });

    expect(await reader({
      caseId: "case-1",
      context: "Current database: Postgres",
      purpose: "e4:compact_json",
      question: "Which database is current?",
    })).toBe("Postgres");
    const body = JSON.parse(requestBody);
    expect(body).toMatchObject({
      max_tokens: 512,
      model: "gpt-5.6-terra",
      reasoning_effort: "medium",
      temperature: 0,
    });
    expect(requestBody).not.toContain("questionType");
    expect(requestBody).not.toContain("goldEvidence");
    expect(usageOrder).toEqual(["intent", "provider", "terminal"]);
    expect(intents).toEqual([
      expect.objectContaining({
        branch: "shadow",
        caseId: "case-1",
        operation: "answer_generation",
      }),
    ]);
    expect(intents[0]?.requestId).toBe(events[0]?.requestId);
    expect(events).toEqual([
      expect.objectContaining({
        branch: "shadow",
        caseId: "case-1",
        completeness: "complete",
        operation: "answer_generation",
      }),
    ]);
  });

  it("separates frozen baseline and candidate answer costs from shadow readers", async () => {
    const events: AttributedModelUsageAttempt[] = [];
    const intents: AttributedModelUsageIntent[] = [];
    const reader = createPhase74LiveReader({
      events,
      fetch: async () => new Response([
        'data: {"choices":[{"delta":{"content":"Postgres"},"index":0}]}',
        'data: {"choices":[],"usage":{"prompt_tokens":20,"completion_tokens":2}}',
        "data: [DONE]",
        "",
      ].join("\n\n"), {
        headers: { "content-type": "text/event-stream" },
        status: 200,
      }),
      intents,
      model: resolvePhase74LiveModels(env).answer,
    });

    await reader({
      caseId: "case-1",
      context: "Postgres",
      purpose: "final:baseline:E2:claim-temporal-off",
      question: "Which database is current?",
    });
    await reader({
      caseId: "case-1",
      context: "Postgres",
      purpose: "final:candidate:E2:claim-temporal-on",
      question: "Which database is current?",
    });

    expect(events.map(({ branch }) => branch)).toEqual([
      "baseline",
      "candidate",
    ]);
    expect(intents.map(({ branch }) => branch)).toEqual([
      "baseline",
      "candidate",
    ]);
  });

  it("attributes correctness judging only to the independent judge branch", async () => {
    const events: AttributedModelUsageAttempt[] = [];
    const intents: AttributedModelUsageIntent[] = [];
    let requestBody = "";
    const judge = createPhase74LiveJudge({
      events,
      fetch: async (_url, init) => {
        requestBody = String(init?.body);
        return new Response(JSON.stringify({
          choices: [{
            finish_reason: "stop",
            index: 0,
            message: {
              content: JSON.stringify({ correct: true, reasoning: "Equivalent." }),
              role: "assistant",
            },
          }],
          usage: { completion_tokens: 3, prompt_tokens: 15 },
        }), { headers: { "content-type": "application/json" } });
      },
      intents,
      model: resolvePhase74LiveModels(env).judge,
    });

    expect(await judge({
      answer: "Postgres",
      caseId: "case-1",
      expectedAnswer: "Postgres",
      purpose: "e4:prose",
      question: "Which database is current?",
    })).toEqual({ correct: true });
    expect(JSON.parse(requestBody)).toMatchObject({
      max_tokens: 512,
      reasoning_effort: "medium",
      temperature: 0,
    });
    expect(events).toEqual([
      expect.objectContaining({
        branch: "judge",
        caseId: "case-1",
        completeness: "complete",
        operation: "judge",
      }),
    ]);
    expect(intents).toEqual([
      expect.objectContaining({
        branch: "judge",
        caseId: "case-1",
        operation: "judge",
      }),
    ]);
    expect(intents[0]?.requestId).toBe(events[0]?.requestId);
  });
});
