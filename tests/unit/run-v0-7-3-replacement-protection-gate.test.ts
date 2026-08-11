import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import type { LocomoCase } from "../../src/eval/locomo";
import {
  createProviderResponseTapeProxy,
  fingerprintProviderTransportAttemptLedger,
} from "../../scripts/provider-response-tape";
import type { ProviderTapeTransportAttempt } from "../../scripts/provider-response-tape";
import {
  decodeProviderResponseTapeBundle,
  parseProviderResponseTapeBundleManifest,
  PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY,
} from "../../scripts/provider-response-tape-bundle";
import {
  assertV073DriverMatchesCandidate,
  assertV073ProviderStageCanContinue,
  assertV073Schema9StoragePreflight,
  assertV073SeedStageReport,
  assertV073ScenarioOutcome,
  buildV073ProviderFreeArgs,
  buildV073StageArm,
  claimV073Schema9FormalAttempt,
  officialQuestionTransitions,
  parseV073ProviderFreeReport,
  parseV073ReplacementGateCliOptions,
  routeV073CommandChainThroughTape,
  runV073ProviderAvailabilityPreflight,
  runV073ProviderStage,
  V073_ASSISTED_EXTRACTION_POLICY,
  V073_PROVIDER_STAGE_ORDER,
  V073_PROVIDER_TRANSPORT_POLICY,
  V073_SCHEMA9_STORAGE_PREFLIGHT_POLICY,
} from "../../scripts/run-v0-7-3-replacement-protection-gate";
import { buildV073PairedCommandChain } from "../../scripts/run-v0-7-3-lifecycle-protection-gate";
import type { V073PairedCommandChain } from "../../scripts/run-v0-7-3-lifecycle-protection-gate";
import {
  buildLocomoScope,
  createLocomoSmokeMemory,
  seedLocomoCase,
  seedLocomoCaseConversational,
} from "../../scripts/run-phase-65-locomo-smoke";

const CLAIM_RECIPE_RAW = readFileSync(
  "reports/release/v0.7/" +
    "v0.7.3-locomo-claim-evidence/claim-recipe-source.json",
  "utf8",
);

function commandChain(): V073PairedCommandChain {
  const invocation = {
    args: ["run", "script.ts"],
    command: "bun" as const,
    cwd: "/worktree",
    environment: {
      GOODMEMORY_ASSISTED_EXTRACTOR_BASE_URL: "https://upstream.test/v1",
      GOODMEMORY_EMBEDDING_BASE_URL: "https://embedding.test/v1",
      GOODMEMORY_EVAL_BASE_URL: "https://upstream.test/v1",
      GOODMEMORY_EVAL_MODEL: "gpt-5.6-terra",
      GOODMEMORY_JUDGE_BASE_URL: "https://upstream.test/v1",
      GOODMEMORY_RERANKING_BASE_URL: "https://upstream.test/v1",
    },
  };
  return {
    officialRescore: { ...invocation, environment: { ...invocation.environment } },
    reanswer: { ...invocation, environment: { ...invocation.environment } },
    seedSmoke: { ...invocation, environment: { ...invocation.environment } },
  };
}

function preflightInput() {
  return {
    credentials: {
      assisted: "assisted-secret",
      embedding: "embedding-secret",
      eval: "eval-secret",
      judge: "judge-secret",
      reranking: "reranking-secret",
    },
    providers: {
      assisted: {
        gateway: "https://ai.gurkiai.com/v1",
        model: "gpt-5.6-terra",
        provider: "openai" as const,
      },
      embedding: {
        gateway: "https://openrouter.ai/api/v1",
        model: "text-embedding-3-small",
        provider: "openai" as const,
      },
      eval: {
        gateway: "https://ai.gurkiai.com/v1",
        model: "gpt-5.6-terra",
        provider: "openai" as const,
      },
      judge: {
        gateway: "https://ai.gurkiai.com/v1",
        model: "gpt-5.5",
        provider: "openai" as const,
      },
      reranking: {
        gateway: "https://ai.gurkiai.com/v1",
        model: "gpt-5.6-terra",
        provider: "openai" as const,
      },
    },
  };
}

describe("v0.7.3 replacement protection gate runner", () => {
  it("requires the driver checkout to be clean at the candidate commit", () => {
    const candidate = {
      branch: null,
      commit: "candidate-commit",
      statusPorcelain: "",
    };

    expect(() => assertV073DriverMatchesCandidate({
      branch: "main",
      commit: candidate.commit,
      statusPorcelain: " M scripts/gate.ts\n",
    }, candidate)).toThrow("driver repository must be clean");
    expect(() => assertV073DriverMatchesCandidate({
      branch: "main",
      commit: "different-commit",
      statusPorcelain: "",
    }, candidate)).toThrow("driver repository must match the candidate commit");
    expect(() => assertV073DriverMatchesCandidate({
      branch: "main",
      commit: candidate.commit,
      statusPorcelain: "",
    }, candidate)).not.toThrow();
  });

  it("requires three real listwise probes plus embedding and judge", async () => {
    const authorizations: string[] = [];
    const result = await runV073ProviderAvailabilityPreflight(
      preflightInput(),
      {
        fetch: async (url, init) => {
          authorizations.push(String(new Headers(init?.headers).get("authorization")));
          if (String(url).endsWith("/embeddings")) {
            return Response.json({ data: [{ embedding: [0.5, -0.5] }] });
          }
          const body = JSON.parse(await new Response(init?.body).text()) as {
            response_format?: unknown;
          };
          return Response.json({
            choices: [{ message: { content: body.response_format
              ? JSON.stringify({
                  orderedCandidateIds: ["candidate-1", "candidate-2"],
                })
              : "OK" } }],
          });
        },
      },
    );

    expect(result.receipt).toEqual({
      probeOrder: [
        "eval-listwise",
        "eval-listwise",
        "eval-listwise",
        "embedding",
        "judge",
      ],
      probes: [
        { attempt: 1, responseKind: "stream-object", status: 200, target: "eval-listwise" },
        { attempt: 2, responseKind: "stream-object", status: 200, target: "eval-listwise" },
        { attempt: 3, responseKind: "stream-object", status: 200, target: "eval-listwise" },
        { attempt: 1, responseKind: "embedding", status: 200, target: "embedding" },
        { attempt: 1, responseKind: "chat-json", status: 200, target: "judge" },
      ],
      totalRequests: 5,
    });
    expect(result.session).toEqual(expect.objectContaining({
      coalesced: 0,
      hits: 0,
      liveRequests: 5,
      misses: 5,
      non2xxResponses: 0,
      requests: 5,
      targetCounts: { embedding: 1, eval: 3, judge: 1 },
      transportAttempts: 5,
      transportErrors: 0,
    }));
    expect(result.tape.entries).toHaveLength(5);
    expect(authorizations).toEqual([
      "Bearer eval-secret",
      "Bearer eval-secret",
      "Bearer eval-secret",
      "Bearer embedding-secret",
      "Bearer judge-secret",
    ]);
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("fails preflight on a provider-side 503 without retaining its body", async () => {
    const input = preflightInput();
    await expect(runV073ProviderAvailabilityPreflight(input, {
      fetch: async (_url, init) => {
        const authorization = new Headers(init?.headers).get("authorization");
        const body = await new Response(init?.body).text();
        if (authorization === "Bearer eval-secret" && body.includes("response_format")) {
          return Response.json({
            error: {
              message: "credential and upstream details must not escape",
            },
          }, { status: 503 });
        }
        if (authorization === "Bearer embedding-secret") {
          return Response.json({ data: [{ embedding: [1] }] });
        }
        return Response.json({ choices: [{ message: { content: "OK" } }] });
      },
    })).rejects.toThrow(
      "provider preflight eval-listwise probe 1 failed: http-503",
    );
  });

  it("requires exact HTTP 200 rather than accepting another successful status", async () => {
    await expect(runV073ProviderAvailabilityPreflight(preflightInput(), {
      fetch: async () => Response.json({
        choices: [{
          message: {
            content: JSON.stringify({
              orderedCandidateIds: ["candidate-1", "candidate-2"],
            }),
          },
        }],
      }, { status: 201 }),
    })).rejects.toThrow(
      "provider preflight eval-listwise probe 1 failed: http-201",
    );
  });

  it("claims the schema 9 formal attempt exactly once outside the movable evidence root", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-v073-attempt-"));
    const path = join(root, "schema9-consumed.json");
    try {
      await claimV073Schema9FormalAttempt(path, "first\n");
      await expect(
        claimV073Schema9FormalAttempt(path, "second\n"),
      ).rejects.toMatchObject({ code: "EEXIST" });
      expect(await readFile(path, "utf8")).toBe("first\n");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("requires 4 GiB of free space before the schema 9 live preflight", () => {
    const minimum = V073_SCHEMA9_STORAGE_PREFLIGHT_POLICY.minimumAvailableBytes;
    expect(assertV073Schema9StoragePreflight({
      availableBlocks: minimum / 4096,
      blockSize: 4096,
      path: "reports/release/v0.7",
    })).toEqual({
      availableBytes: minimum,
      minimumAvailableBytes: minimum,
      path: "reports/release/v0.7",
    });
    expect(() => assertV073Schema9StoragePreflight({
      availableBlocks: minimum / 4096 - 1,
      blockSize: 4096,
      path: "reports/release/v0.7",
    })).toThrow("schema 9 requires at least");
  });

  it("qualifies storage before provider traffic and claims the attempt before creating evidence", () => {
    const source = readFileSync(
      new URL(
        "../../scripts/run-v0-7-3-replacement-protection-gate.ts",
        import.meta.url,
      ),
      "utf8",
    );
    const storageIndex = source.indexOf("const filesystem = await statfs");
    const preflightIndex = source.indexOf(
      "const providerPreflight = await runV073ProviderAvailabilityPreflight",
    );
    const claimIndex = source.indexOf(
      "await claimV073Schema9FormalAttempt",
    );
    const evidenceRootIndex = source.indexOf("await mkdir(outputDir);");
    expect(storageIndex).toBeGreaterThan(-1);
    expect(storageIndex).toBeLessThan(preflightIndex);
    expect(preflightIndex).toBeLessThan(claimIndex);
    expect(claimIndex).toBeLessThan(evidenceRootIndex);
    expect(source).toContain("measurementEvidenceRoot: outputDir");
  });

  it("persists the formal response tape as bounded gzip parts instead of one GitHub-blocked blob", () => {
    const source = readFileSync(
      new URL(
        "../../scripts/run-v0-7-3-replacement-protection-gate.ts",
        import.meta.url,
      ),
      "utf8",
    );
    expect(source).toContain("encodeProviderResponseTapeBundle");
    expect(source).toContain("decodeProviderResponseTapeBundle");
    expect(source).toContain('"provider-response-tape",');
    expect(source).toContain('"manifest.json",');
    expect(source).toContain(
      "tapeMaxParts: PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY.maxParts",
    );
    expect(source).not.toContain('"provider-response-tape.json"');
  });

  it("stops a formal stage after the first command that has tape misses", () => {
    expect(() => assertV073ProviderStageCanContinue("replay", {
      coalesced: 0,
      hits: 10,
      liveRequests: 0,
      misses: 1,
      mode: "replay",
      name: "baseline-formal",
      non2xxResponses: 0,
      requestFingerprintMultisetSha256: "a".repeat(64),
      requestSequence: [],
      requestSequenceSha256: "c".repeat(64),
      requests: 11,
      sequenceMismatchDetails: [],
      sequenceMismatches: 0,
      tapeSha256: "b".repeat(64),
      targetCounts: { eval: 11 },
      transportAttemptLedger: [],
      transportAttemptLedgerSha256: "d".repeat(64),
      transportAttempts: 0,
      transportErrors: 0,
    })).toThrow("formal provider replay observed 1 tape miss");
  });

  it("accepts only non-2xx and transport failures recovered by the same request", async () => {
    for (const firstAttempt of ["non2xx", "transport"] as const) {
      let attempts = 0;
      const proxy = createProviderResponseTapeProxy({
        targets: { eval: "https://eval.example/v1" },
        upstreamFetch: async () => {
          attempts += 1;
          if (attempts === 1 && firstAttempt === "transport") {
            throw new TypeError("connection reset");
          }
          return new Response(attempts === 1 ? "retry" : "ok", {
            status: attempts === 1 ? 503 : 200,
          });
        },
      });
      try {
        proxy.beginSession({
          liveOnMiss: true,
          mode: "prefetch",
          name: `${firstAttempt}-recovery`,
        });
        const request = () => fetch(`${proxy.baseUrl("eval")}/chat/completions`, {
          body: '{"model":"m"}',
          headers: { "content-type": "application/json" },
          method: "POST",
        });
        expect((await request()).status).toBe(firstAttempt === "transport" ? 502 : 503);
        expect((await request()).status).toBe(200);
        expect(() => assertV073ProviderStageCanContinue(
          "prefetch",
          proxy.endSession(),
          proxy.snapshot(),
        )).not.toThrow();
      } finally {
        proxy.stop();
      }
    }
  });

  it("blocks a terminal provider failure hidden by application fallback", async () => {
    const proxy = createProviderResponseTapeProxy({
      targets: { reranking: "https://reranking.example/v1" },
      upstreamFetch: async () => new Response("retry", { status: 503 }),
    });
    try {
      proxy.beginSession({
        liveOnMiss: true,
        mode: "prefetch",
        name: "terminal-failure",
      });
      const request = () => fetch(
        `${proxy.baseUrl("reranking")}/chat/completions`,
        {
          body: '{"model":"m"}',
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );
      expect((await request()).status).toBe(503);
      expect((await request()).status).toBe(503);
      expect(() => assertV073ProviderStageCanContinue(
        "prefetch",
        proxy.endSession(),
        proxy.snapshot(),
      )).toThrow("provider failure was not recovered by an immediate same-request retry");
    } finally {
      proxy.stop();
    }
  });

  it("rejects seed execution failures before downstream provider stages", () => {
    const raw = readFileSync(
      "reports/release/v0.7/blocked-6eb0f87d/attribution-controls/provider-free-c1-baseline.json",
      "utf8",
    );
    expect(() => assertV073SeedStageReport(raw)).not.toThrow();
    expect(() => assertV073SeedStageReport(JSON.stringify({
      ...JSON.parse(raw) as Record<string, unknown>,
      executionFailures: 1,
    }))).toThrow("provider seed report is incomplete");
  });

  it("derives the provider-free population from the four claim categories", () => {
    expect(buildV073ProviderFreeArgs({
      benchmarkRoot: "/tmp/locomo",
      concurrency: 1,
      outputDir: "/tmp/evidence",
      runId: "provider-free-c1",
    })).toEqual([
      "run",
      "scripts/run-phase-65-locomo-smoke.ts",
      "--",
      "--benchmark-root",
      "/tmp/locomo",
      "--case-id",
      "locomo-conv-26",
      "--case-id",
      "locomo-conv-30",
      "--category",
      "single_hop",
      "--category",
      "multi_hop",
      "--category",
      "temporal",
      "--category",
      "open_domain",
      "--label-free-ingest",
      "--generalized-fusion",
      "--concurrency",
      "1",
      "--output-dir",
      "/tmp/evidence",
      "--run-id",
      "provider-free-c1",
    ]);
  });

  it("computes paired transitions from official rows by question identity", () => {
    expect(officialQuestionTransitions(
      [
        { correct: false, questionId: "q1" },
        { correct: true, questionId: "q2" },
        { correct: true, questionId: "q3" },
      ],
      [
        { correct: true, questionId: "q3" },
        { correct: true, questionId: "q1" },
        { correct: false, questionId: "q2" },
      ],
    )).toEqual({ improved: 1, regressed: 1, total: 3 });
  });

  it("runs every provider stage in data-dependency order", () => {
    expect(V073_PROVIDER_STAGE_ORDER).toEqual([
      "seedSmoke",
      "reanswer",
      "officialRescore",
    ]);
  });

  it("binds the existing assisted extraction timeout and attempt limit", () => {
    expect(V073_ASSISTED_EXTRACTION_POLICY).toEqual({
      maxAttempts: 4,
      requestTimeoutMs: 120_000,
    });
  });

  it("binds ordered transport replay without adding a proxy retry owner", () => {
    expect(V073_PROVIDER_TRANSPORT_POLICY).toEqual({
      errorResponseStatus: 502,
      proxyRetries: 0,
      transportErrors: "record-and-replay",
    });
  });

  it("pins every provider diagnostic stage to deterministic concurrency one", () => {
    const claimRecipeRaw = CLAIM_RECIPE_RAW;
    const { arm } = buildV073StageArm({
      benchmarkRoot: join(
        homedir(),
        ".cache/goodmemory-benchmarks/LoCoMo-captioned-full10-v1",
      ),
      claimRecipeRaw,
      commit: "a".repeat(40),
      outputDir: "/tmp/v073-provider-c1",
      providers: {
        assisted: {
          gateway: "https://ai.gurkiai.com/v1",
          model: "gpt-5.6-terra",
          provider: "openai",
        },
        embedding: {
          gateway: "https://openrouter.ai/api/v1",
          model: "text-embedding-3-small",
          provider: "openai",
        },
        eval: {
          gateway: "https://ai.gurkiai.com/v1",
          model: "gpt-5.6-terra",
          provider: "openai",
        },
        judge: {
          gateway: "https://ai.gurkiai.com/v1",
          model: "gpt-5.5",
          provider: "openai",
        },
        reranking: {
          gateway: "https://ai.gurkiai.com/v1",
          model: "gpt-5.6-terra",
          provider: "openai",
        },
      },
      sourceIdentity: {
        officialSourceSha256: "b".repeat(64),
        reanswerSourceSha256: "c".repeat(64),
        seedSourceSha256: "d".repeat(64),
      },
      stage: "baseline-discovery",
      worktreePath: process.cwd(),
    });
    const chain = buildV073PairedCommandChain(arm, claimRecipeRaw);
    const concurrency = (args: readonly string[]): string => {
      const index = args.indexOf("--concurrency");
      return args[index + 1]!;
    };

    expect(arm.execution.concurrency).toBe(1);
    expect(concurrency(chain.seedSmoke.args)).toBe("1");
    expect(concurrency(chain.reanswer.args)).toBe("1");
    expect(concurrency(chain.officialRescore.args)).toBe("1");
  });

  it("keeps canonical listwise bodies stable with one shared semantic seed", async () => {
    const claimRecipeRaw = CLAIM_RECIPE_RAW;
    const buildArm = (stage: string) => buildV073StageArm({
      benchmarkRoot: join(
        homedir(),
        ".cache/goodmemory-benchmarks/LoCoMo-captioned-full10-v1",
      ),
      claimRecipeRaw,
      commit: "a".repeat(40),
      outputDir: "/tmp/v073-semantic-seed",
      providers: preflightInput().providers,
      sourceIdentity: {
        officialSourceSha256: "b".repeat(64),
        reanswerSourceSha256: "c".repeat(64),
        seedSourceSha256: "d".repeat(64),
      },
      stage,
      worktreePath: "/tmp/v073-baseline",
    }).arm;
    const discovery = buildArm("baseline-discovery");
    const formal = buildArm("baseline-formal");
    expect(discovery.execution.seedOutputPath).not.toBe(
      formal.execution.seedOutputPath,
    );
    const discoverySeedCommand = buildV073PairedCommandChain(
      discovery,
      claimRecipeRaw,
    ).seedSmoke;
    const formalSeedCommand = buildV073PairedCommandChain(
      formal,
      claimRecipeRaw,
    ).seedSmoke;
    const normalizeOutputDir = (args: readonly string[]): string[] => {
      const normalized = [...args];
      const outputDirIndex = normalized.indexOf("--output-dir");
      if (outputDirIndex < 0) {
        throw new Error("seed command must include --output-dir");
      }
      normalized[outputDirIndex + 1] = "<artifact-output-dir>";
      return normalized;
    };
    expect(discoverySeedCommand.command).toBe(formalSeedCommand.command);
    expect(discoverySeedCommand.cwd).toBe(formalSeedCommand.cwd);
    expect(discoverySeedCommand.environment).toEqual(
      formalSeedCommand.environment,
    );
    expect(normalizeOutputDir(discoverySeedCommand.args)).toEqual(
      normalizeOutputDir(formalSeedCommand.args),
    );

    const requestBodies: string[] = [];
    const provider = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const body = await request.json() as Record<string, unknown>;
        if (url.pathname.endsWith("/embeddings")) {
          const rawInput = body.input;
          const inputs = Array.isArray(rawInput) ? rawInput : [rawInput];
          return Response.json({
            data: inputs.map((_value, index) => ({
              embedding: [1, 0, 0],
              index,
              object: "embedding",
            })),
            model: "embed",
            object: "list",
            usage: { prompt_tokens: 1, total_tokens: 1 },
          });
        }
        requestBodies.push(JSON.stringify(body));
        const messages = body.messages as
          | Array<{ content?: string }>
          | undefined;
        const prompt = messages
          ?.map((message) => message.content ?? "")
          .join("\n") ?? "";
        const orderedCandidateIds = prompt
          .split("\n")
          .filter((line) => line.startsWith('{"id":"candidate-'))
          .map((line) => (JSON.parse(line) as { id: string }).id);
        return Response.json({
          choices: [{
            message: {
              content: JSON.stringify({ orderedCandidateIds }),
            },
          }],
          usage: { completion_tokens: 1, prompt_tokens: 1, total_tokens: 2 },
        });
      },
    });
    const baseURL = `http://127.0.0.1:${provider.port}/v1`;
    const turns = Array.from({ length: 40 }, (_, index) => ({
      content:
        `${["Alice", "Bob", "Caroline", "Derek"][index % 4]} discussed ` +
        `Project ${String.fromCharCode(65 + (index % 20))} with ` +
        `${["Erin", "Farah", "George", "Hana"][index % 4]} at Place ${index % 9}.`,
      diaId: `D${Math.floor(index / 2) + 1}:${index + 1}`,
      speaker: index % 2 === 0 ? "Alice" : "Bob",
    }));
    const testCase: LocomoCase = {
      caseId: "semantic-seed-capture",
      questions: [{
        adversarialAnswer: null,
        category: "single_hop",
        evidenceTurnIds: ["D1:1"],
        goldAnswer: "Project A",
        matchMode: "f1_token_overlap",
        question:
          "Which projects did Alice and Bob discuss with their friends?",
        questionId: "q1",
      }],
      sourceConversation: "semantic-seed-capture",
      speakers: ["Alice", "Bob"],
      turns,
    };
    const capture = async (runId: string): Promise<string> => {
      const bodyOffset = requestBodies.length;
      const memory = createLocomoSmokeMemory({
        generalizedFusion: true,
        providerEmbedding: true,
        providerEmbeddingConfig: {
          apiKey: "test",
          baseURL,
          model: "embed",
          provider: "openai",
        },
        providerRerankingConfig: {
          apiKey: "test",
          baseURL,
          model: "rerank",
          provider: "openai",
        },
        providerRerankingStrategy: "listwise",
      });
      await seedLocomoCase({
        labelFreeIngest: true,
        memory,
        runId,
        testCase,
      });
      await seedLocomoCaseConversational({
        extractor: {
          async extract(input) {
            return {
              candidates: input.messages.map((message, index) => ({
                content:
                  `${message.content} This is an explicit relationship about ` +
                  `Project ${String.fromCharCode(65 + (index % 20))}.`,
                explicitness: "explicit" as const,
                id: `candidate-${index}`,
                kindHint: "fact" as const,
                sourceMessageIndex: index,
                sourceRole: "user" as const,
              })),
              ignoredMessageCount: 0,
            };
          },
        },
        memory,
        runId,
        testCase,
      });
      await memory.recall({
        query: testCase.questions[0]!.question,
        scope: buildLocomoScope({ caseId: testCase.caseId, runId }),
        strategy: "hybrid",
      });
      return requestBodies[bodyOffset]!;
    };

    try {
      const discoveryBody = await capture(discovery.execution.seedRunId);
      const formalBody = await capture(formal.execution.seedRunId);
      const changedSemanticScopeBody = await capture("different-semantic-seed");
      expect(discovery.execution.seedRunId).toBe(formal.execution.seedRunId);
      expect(discoveryBody).toBe(formalBody);
      expect(changedSemanticScopeBody).not.toBe(discoveryBody);
    } finally {
      provider.stop(true);
    }
  });

  it("persists a hash-only receipt before a formal sequence mismatch aborts", async () => {
    const root = await mkdtemp(join(process.cwd(), ".goodmemory-v073-stage-"));
    const rawRequestMarker = "raw-sequence-mismatch-content";
    const liveKeyMarker = "live-provider-key-marker";
    const upstream = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => Response.json({ choices: [{ message: { content: "ok" } }] }),
    });
    const targets = Object.fromEntries(
      ["assisted", "embedding", "eval", "judge", "reranking"].map(
        (target) => [target, `http://127.0.0.1:${upstream.port}/v1`],
      ),
    );
    const discovery = createProviderResponseTapeProxy({ targets });
    let replay: ReturnType<typeof createProviderResponseTapeProxy> | undefined;
    const previousKey = process.env.GOODMEMORY_EVAL_API_KEY;
    process.env.GOODMEMORY_EVAL_API_KEY = liveKeyMarker;
    try {
      discovery.beginSession({
        liveOnMiss: true,
        mode: "prefetch",
        name: "discovery",
      });
      const expectedResponse = await fetch(
        `${discovery.baseUrl("eval")}/chat/completions`,
        {
          body: JSON.stringify({ content: "expected", model: "m" }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );
      expect(expectedResponse.status).toBe(200);
      const expectedSequence = discovery.endSession().requestSequence;
      replay = createProviderResponseTapeProxy({
        initialTape: discovery.snapshot(),
        targets,
      });
      const claimRecipeRaw = CLAIM_RECIPE_RAW;
      const { arm } = buildV073StageArm({
        benchmarkRoot: join(
          homedir(),
          ".cache/goodmemory-benchmarks/LoCoMo-captioned-full10-v1",
        ),
        claimRecipeRaw,
        commit: "a".repeat(40),
        outputDir: join(root, "evidence"),
        providers: {
          assisted: {
            gateway: "https://ai.gurkiai.com/v1",
            model: "gpt-5.6-terra",
            provider: "openai",
          },
          embedding: {
            gateway: "https://openrouter.ai/api/v1",
            model: "text-embedding-3-small",
            provider: "openai",
          },
          eval: {
            gateway: "https://ai.gurkiai.com/v1",
            model: "gpt-5.6-terra",
            provider: "openai",
          },
          judge: {
            gateway: "https://ai.gurkiai.com/v1",
            model: "gpt-5.5",
            provider: "openai",
          },
          reranking: {
            gateway: "https://ai.gurkiai.com/v1",
            model: "gpt-5.6-terra",
            provider: "openai",
          },
        },
        sourceIdentity: {
          officialSourceSha256: "b".repeat(64),
          reanswerSourceSha256: "c".repeat(64),
          seedSourceSha256: "d".repeat(64),
        },
        stage: "baseline-formal",
        worktreePath: root,
      });

      await expect(runV073ProviderStage({
        arm,
        claimRecipeRaw,
        expectedRequestSequence: expectedSequence,
        liveOnMiss: false,
        mode: "replay",
        proxy: replay,
        sensitiveValues: [],
        stage: "baseline-formal",
      }, {
        runProcess: async ({ environment }) => {
          const response = await fetch(
            `${environment!.GOODMEMORY_EVAL_BASE_URL}/chat/completions`,
            {
              body: JSON.stringify({
                content: rawRequestMarker,
                model: "m",
              }),
              headers: { "content-type": "application/json" },
              method: "POST",
            },
          );
          expect(response.status).toBe(409);
          return { exitCode: 1, stderr: "", stdout: "" };
        },
      })).rejects.toThrow(
        "baseline-formal formal provider replay observed 1 input sequence mismatch(es)",
      );

      const receiptRaw = await readFile(arm.executionReceiptPath, "utf8");
      const receipt = JSON.parse(receiptRaw) as {
        session: {
          sequenceMismatchDetails: Array<{
            actual: { path: string; targetId: string };
            expected: { path: string; targetId: string } | null;
            index: number;
          }>;
          sequenceMismatches: number;
        };
      };
      expect(receipt.session.sequenceMismatches).toBe(1);
      expect(receipt.session.sequenceMismatchDetails).toEqual([
        expect.objectContaining({
          actual: expect.objectContaining({
            path: "/chat/completions",
            targetId: "eval",
          }),
          expected: expect.objectContaining({
            path: "/chat/completions",
            targetId: "eval",
          }),
          index: 0,
        }),
      ]);
      expect(receiptRaw).not.toContain(rawRequestMarker);
      expect(receiptRaw).not.toContain(liveKeyMarker);
    } finally {
      if (previousKey === undefined) {
        delete process.env.GOODMEMORY_EVAL_API_KEY;
      } else {
        process.env.GOODMEMORY_EVAL_API_KEY = previousKey;
      }
      replay?.stop();
      discovery.stop();
      upstream.stop(true);
      await rm(root, { force: true, recursive: true });
    }
  });

  it("atomically persists successful discovery responses before an incomplete seed aborts", async () => {
    const root = await mkdtemp(join(process.cwd(), ".goodmemory-v073-failure-tape-"));
    const malformedResponse = '{"choices":[{"message":{"content":"[truncated"}}]}';
    const requestMarker = "private-request-marker";
    const credentialMarker = "private-credential-marker";
    const transportErrorMarker = "private-transport-error-marker";
    let credentialRequestCount = 0;
    let transportRequestCount = 0;
    let releaseSlowResponse!: () => void;
    let markSlowRequestStarted!: () => void;
    const slowRequestStarted = new Promise<void>((resolve) => {
      markSlowRequestStarted = resolve;
    });
    const slowResponseGate = new Promise<void>((resolve) => {
      releaseSlowResponse = resolve;
    });
    const upstream = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async (request) => {
        const url = new URL(request.url);
        if (url.searchParams.has("slow")) {
          markSlowRequestStarted();
          await slowResponseGate;
          return new Response("slow-success", { status: 200 });
        }
        if (url.searchParams.has("credential_reflection")) {
          credentialRequestCount += 1;
          return new Response(
            credentialRequestCount === 1
              ? `reflected:${credentialMarker}`
              : "credential-free-retry",
            { status: 200 },
          );
        }
        return new Response(malformedResponse, {
          headers: { "content-type": "application/json" },
          status: 200,
        });
      },
    });
    const targets = Object.fromEntries(
      ["assisted", "embedding", "eval", "judge", "reranking"].map(
        (target) => [target, `http://127.0.0.1:${upstream.port}/v1`],
      ),
    );
    const proxy = createProviderResponseTapeProxy({
      targets,
      upstreamFetch: async (request, init) => {
        const url = new URL(
          typeof request === "string"
            ? request
            : request instanceof URL
              ? request
              : request.url,
        );
        if (url.searchParams.has("transport")) {
          transportRequestCount += 1;
          if (transportRequestCount === 1) {
            throw Object.assign(
              new TypeError(`unknown certificate verification error ${transportErrorMarker}`),
              { cause: { code: "UNKNOWN_CERTIFICATE_VERIFICATION_ERROR" } },
            );
          }
        }
        return fetch(request, init);
      },
    });
    try {
      const claimRecipeRaw = CLAIM_RECIPE_RAW;
      const { arm } = buildV073StageArm({
        benchmarkRoot: join(
          homedir(),
          ".cache/goodmemory-benchmarks/LoCoMo-captioned-full10-v1",
        ),
        claimRecipeRaw,
        commit: "a".repeat(40),
        outputDir: join(root, "evidence"),
        providers: {
          assisted: {
            gateway: "https://ai.gurkiai.com/v1",
            model: "gpt-5.6-terra",
            provider: "openai",
          },
          embedding: {
            gateway: "https://openrouter.ai/api/v1",
            model: "text-embedding-3-small",
            provider: "openai",
          },
          eval: {
            gateway: "https://ai.gurkiai.com/v1",
            model: "gpt-5.6-terra",
            provider: "openai",
          },
          judge: {
            gateway: "https://ai.gurkiai.com/v1",
            model: "gpt-5.5",
            provider: "openai",
          },
          reranking: {
            gateway: "https://ai.gurkiai.com/v1",
            model: "gpt-5.6-terra",
            provider: "openai",
          },
        },
        sourceIdentity: {
          officialSourceSha256: "b".repeat(64),
          reanswerSourceSha256: "c".repeat(64),
          seedSourceSha256: "d".repeat(64),
        },
        stage: "baseline-discovery",
        worktreePath: root,
      });

      await expect(runV073ProviderStage({
        arm,
        claimRecipeRaw,
        liveOnMiss: true,
        mode: "prefetch",
        proxy,
        sensitiveValues: [credentialMarker],
        stage: "baseline-discovery",
      }, {
        runProcess: async ({ environment }) => {
          const response = await fetch(
            `${environment!.GOODMEMORY_EVAL_BASE_URL}/chat/completions`,
            {
              body: JSON.stringify({ model: "m", prompt: requestMarker }),
              headers: {
                authorization: `Bearer ${credentialMarker}`,
                "content-type": "application/json",
              },
              method: "POST",
            },
          );
          expect(response.status).toBe(200);
          expect(await response.text()).toBe(malformedResponse);
          const reflected = await fetch(
            `${environment!.GOODMEMORY_EVAL_BASE_URL}/chat/completions?credential_reflection=1`,
            {
              headers: { authorization: `Bearer ${credentialMarker}` },
              method: "POST",
            },
          );
          expect(await reflected.text()).toContain(credentialMarker);
          const cleanRetry = await fetch(
            `${environment!.GOODMEMORY_EVAL_BASE_URL}/chat/completions?credential_reflection=1`,
            {
              headers: { authorization: `Bearer ${credentialMarker}` },
              method: "POST",
            },
          );
          expect(await cleanRetry.text()).toBe("credential-free-retry");
          void fetch(
            `${environment!.GOODMEMORY_EVAL_BASE_URL}/chat/completions?slow=1`,
            { method: "POST" },
          ).catch(() => undefined);
          await slowRequestStarted;
          const transportFailure = await fetch(
            `${environment!.GOODMEMORY_EVAL_BASE_URL}/chat/completions?transport=1`,
            { method: "POST" },
          );
          expect(transportFailure.status).toBe(502);
          const transportRecovery = await fetch(
            `${environment!.GOODMEMORY_EVAL_BASE_URL}/chat/completions?transport=1`,
            { method: "POST" },
          );
          expect(transportRecovery.status).toBe(200);
          setTimeout(releaseSlowResponse, 20);
          await mkdir(join(arm.seedReportPath, ".."), { recursive: true });
          await writeFile(arm.seedReportPath, JSON.stringify({
            cases: [],
            executionFailures: 152,
            questionCount: 233,
          }));
          return {
            exitCode: 0,
            stderr: `provider error: ${JSON.stringify(credentialMarker)}`,
            stdout: `provider url: ${encodeURIComponent(credentialMarker)}`,
          };
        },
      })).rejects.toThrow(
        "baseline-discovery provider seed report is incomplete",
      );

      const failureTapeRoot = join(
        arm.executionReceiptPath,
        "..",
        "failure-tape",
      );
      const failureTapeManifestRaw = await readFile(
        join(failureTapeRoot, "manifest.json"),
        "utf8",
      );
      const failureTapeManifest = parseProviderResponseTapeBundleManifest(
        failureTapeManifestRaw,
      );
      const failureTape = decodeProviderResponseTapeBundle({
        manifestRaw: failureTapeManifestRaw,
        parts: new Map(await Promise.all(failureTapeManifest.parts.map(
          async (part) => [
            part.path,
            await readFile(join(failureTapeRoot, part.path)),
          ] as const,
        ))),
      }).tape;
      expect(failureTape.entries).toHaveLength(4);
      expect(failureTape.entries.map((entry) => Buffer.from(
        entry.response.bodyBase64,
        "base64",
      ).toString("utf8"))).toEqual(expect.arrayContaining([
        malformedResponse,
        "slow-success",
      ]));
      expect(failureTapeManifest.parts.every((part) =>
        part.bytes <= PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY.maxPartBytes
      )).toBe(true);
      expect(JSON.stringify(failureTape)).not.toContain(requestMarker);
      expect(JSON.stringify(failureTape)).not.toContain(credentialMarker);

      const receiptRaw = await readFile(arm.executionReceiptPath, "utf8");
      const receipt = JSON.parse(receiptRaw) as {
        failureTape: { bytes: number; path: string; sha256: string };
        failureTapeExcludedCredentialEntries: number;
        session: {
          transportAttemptLedger: ProviderTapeTransportAttempt[];
          transportAttemptLedgerSha256: string;
          transportAttempts: number;
          transportErrors: number;
        };
      };
      expect(receipt.failureTape).toEqual({
        bytes: Buffer.byteLength(failureTapeManifestRaw, "utf8"),
        path: receipt.failureTape.path,
        sha256: createHash("sha256").update(failureTapeManifestRaw).digest("hex"),
      });
      expect(receipt.failureTapeExcludedCredentialEntries).toBe(2);
      expect(receipt.failureTape.path.endsWith("/failure-tape/manifest.json"))
        .toBe(true);
      expect(receipt.session.transportAttempts).toBe(6);
      expect(receipt.session.transportErrors).toBe(1);
      expect(receipt.session.transportAttemptLedger.map(
        ({ requestIndex }) => requestIndex,
      )).toEqual([0, 1, 2, 3, 4, 5]);
      expect(receipt.session.transportAttemptLedger).toContainEqual(
        expect.objectContaining({
          errorCategory: "certificate",
          errorCode: "UNKNOWN_CERTIFICATE_VERIFICATION_ERROR",
          outcome: "error",
        }),
      );
      expect(receipt.session.transportAttemptLedgerSha256).toBe(
        fingerprintProviderTransportAttemptLedger(
          receipt.session.transportAttemptLedger,
        ),
      );
      expect(receiptRaw).not.toContain(requestMarker);
      expect(receiptRaw).not.toContain(credentialMarker);
      expect(receiptRaw).not.toContain(transportErrorMarker);
      expect(await readFile(join(arm.executionReceiptPath, "..", "stdout.log"), "utf8"))
        .not.toContain(credentialMarker);
      expect(await readFile(join(arm.executionReceiptPath, "..", "stderr.log"), "utf8"))
        .not.toContain(credentialMarker);
    } finally {
      proxy.stop();
      upstream.stop(true);
      await rm(root, { force: true, recursive: true });
    }
  });

  it("routes only provider base URLs through their logical tape lanes", () => {
    const routed = routeV073CommandChainThroughTape(
      commandChain(),
      {
        assisted: "http://127.0.0.1:3000/assisted",
        embedding: "http://127.0.0.1:3000/embedding",
        eval: "http://127.0.0.1:3000/eval",
        judge: "http://127.0.0.1:3000/judge",
        reranking: "http://127.0.0.1:3000/reranking",
      },
      { replayCredentials: true },
    );

    expect(routed.seedSmoke.environment).toMatchObject({
      GOODMEMORY_ASSISTED_EXTRACTOR_BASE_URL:
        "http://127.0.0.1:3000/assisted",
      GOODMEMORY_EMBEDDING_BASE_URL: "http://127.0.0.1:3000/embedding",
      GOODMEMORY_EVAL_BASE_URL: "http://127.0.0.1:3000/eval",
      GOODMEMORY_EVAL_MODEL: "gpt-5.6-terra",
      GOODMEMORY_RERANKING_BASE_URL: "http://127.0.0.1:3000/reranking",
    });
    expect(routed.officialRescore.environment.GOODMEMORY_JUDGE_BASE_URL).toBe(
      "http://127.0.0.1:3000/judge",
    );
    expect(routed.officialRescore.environment).toMatchObject({
      GOODMEMORY_ASSISTED_EXTRACTOR_BASE_URL:
        "http://127.0.0.1:3000/assisted",
      GOODMEMORY_EMBEDDING_BASE_URL: "http://127.0.0.1:3000/embedding",
      GOODMEMORY_EVAL_BASE_URL: "http://127.0.0.1:3000/eval",
      GOODMEMORY_JUDGE_BASE_URL: "http://127.0.0.1:3000/judge",
      GOODMEMORY_RERANKING_BASE_URL: "http://127.0.0.1:3000/reranking",
    });
    expect(routed.officialRescore.environment.GOODMEMORY_JUDGE_API_KEY).toBe(
      "provider-response-tape-replay",
    );
    expect(commandChain().seedSmoke.environment.GOODMEMORY_EVAL_BASE_URL).toBe(
      "https://upstream.test/v1",
    );
  });

  it("parses only detached-checkout inputs and one fresh evidence root", () => {
    expect(parseV073ReplacementGateCliOptions([
      "--baseline-worktree",
      "/tmp/baseline",
      "--candidate-worktree",
      "/tmp/candidate",
      "--benchmark-root",
      "/tmp/locomo",
      "--output-dir",
      "/tmp/evidence",
    ])).toEqual({
      baselineWorktree: "/tmp/baseline",
      benchmarkRoot: "/tmp/locomo",
      candidateWorktree: "/tmp/candidate",
      outputDir: "/tmp/evidence",
    });
  });

  it("makes the package gate invoke the replacement runner", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts["gate:v0.7.3-lifecycle-protection"]).toBe(
      "bun run scripts/run-v0-7-3-replacement-protection-gate.ts",
    );
  });

  it("accepts only the preregistered provider-free population and transport-free mode", () => {
    const raw = readFileSync(
      "reports/release/v0.7/blocked-6eb0f87d/attribution-controls/provider-free-c1-baseline.json",
      "utf8",
    );
    const report = parseV073ProviderFreeReport({
      benchmarkRoot:
        "/Users/hjqcan/.cache/goodmemory-benchmarks/LoCoMo-captioned-full10-v1",
      concurrency: 1,
      raw,
    });
    expect(report.questionCount).toBe(233);

    expect(() => parseV073ProviderFreeReport({
      benchmarkRoot:
        "/Users/hjqcan/.cache/goodmemory-benchmarks/LoCoMo-captioned-full10-v1",
      concurrency: 1,
      raw: JSON.stringify({ ...report, providerReranking: true }),
    })).toThrow("provider-free report does not match the preregistered mode");

    const drifted = JSON.parse(raw) as { cases: Array<{ questionId: string }> };
    drifted.cases[0]!.questionId = "drifted-question";
    expect(() => parseV073ProviderFreeReport({
      benchmarkRoot:
        "/Users/hjqcan/.cache/goodmemory-benchmarks/LoCoMo-captioned-full10-v1",
      concurrency: 1,
      raw: JSON.stringify(drifted),
    })).toThrow("provider-free report does not match the frozen question selection");

    for (const mutate of [
      (row: Record<string, unknown>) => {
        row.evidenceRecall = row.evidenceRecall === 1 ? 0 : 1;
      },
      (row: Record<string, unknown>) => {
        row.goldEvidenceFullyRetrieved = !row.goldEvidenceFullyRetrieved;
      },
      (row: Record<string, unknown>) => {
        row.missingEvidenceTurnIds = ["D999:1"];
      },
      (row: Record<string, unknown>) => {
        row.noiseTurnCount = 0;
      },
      (row: Record<string, unknown>) => {
        row.noiseTurnIds = [];
      },
    ]) {
      const inconsistent = JSON.parse(raw) as {
        cases: Array<Record<string, unknown>>;
      };
      mutate(inconsistent.cases[0]!);
      expect(() => parseV073ProviderFreeReport({
        benchmarkRoot:
          "/Users/hjqcan/.cache/goodmemory-benchmarks/LoCoMo-captioned-full10-v1",
        concurrency: 1,
        raw: JSON.stringify(inconsistent),
      })).toThrow("provider-free retrieval metrics are inconsistent");
    }
  });

  it("rejects unsuccessful or unparseable scenario outcomes", () => {
    expect(() => assertV073ScenarioOutcome({
      exitCode: 1,
      failures: 0,
      passed: 8,
    })).toThrow("scenario replay exited with 1");
    expect(() => assertV073ScenarioOutcome({
      exitCode: 0,
      failures: -1,
      passed: 8,
    })).toThrow("scenario replay counts are invalid");
    expect(() => assertV073ScenarioOutcome({
      exitCode: 0,
      failures: 0,
      passed: 8,
    })).not.toThrow();
  });
});
