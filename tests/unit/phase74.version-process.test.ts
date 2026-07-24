import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  Phase74VersionChildProcessError,
  buildPhase74VersionPreparedReceipt,
  buildPhase74VersionPreparedReceiptSet,
  parsePhase74VersionProcessJob,
  parsePhase74VersionProcessOutput,
  runPhase74VersionChildProcess,
  runPhase74VersionProcessJob,
  sealPhase74VersionPreparedSnapshot,
  verifyPhase74VersionPreparedReceipt,
} from "../../scripts/phase74-version-process";
import {
  PHASE74_RELEASE_COMMIT,
  buildPhase74VersionIngestionKey,
} from "../../src/eval/phase74VersionBaseline";

const WORKER_INPUT = {
  arm: "release",
  caseId: "case-opaque",
  memoryGroupId: "group-opaque",
  question: "Which database is current?",
  rawEvidence: [{
    content: "Postgres is current.",
    id: "evidence-1",
    sourceIds: ["session-1:source-1"],
  }],
  schemaVersion: 1,
  sourceCommit: PHASE74_RELEASE_COMMIT,
} as const;

const PROCESS_ENV = {
  GOODMEMORY_EMBEDDING_API_KEY: "embedding-key",
  GOODMEMORY_EMBEDDING_BASE_URL: "https://openrouter.ai/api/v1",
  GOODMEMORY_EMBEDDING_MODEL: "baai/bge-m3",
  GOODMEMORY_EMBEDDING_PROVIDER: "openai",
  GOODMEMORY_EVAL_API_KEY: "reader-key",
  GOODMEMORY_EVAL_BASE_URL: "https://ai.gurkiai.com/v1",
  GOODMEMORY_EVAL_MODEL: "gpt-5.6-terra",
  GOODMEMORY_EVAL_PROVIDER: "openai",
} as const;
const EXECUTION_IDENTITY_HASH = "c".repeat(64);
const INGESTION_KEY = buildPhase74VersionIngestionKey({
  configurationSha256: "d".repeat(64),
  datasetSha256: "e".repeat(64),
  memoryGroupId: WORKER_INPUT.memoryGroupId,
  rawEvidence: WORKER_INPUT.rawEvidence,
  sourceCommit: WORKER_INPUT.sourceCommit,
});
const PREPARE_IDENTITY = {
  executionIdentityHash: EXECUTION_IDENTITY_HASH,
  ingestionKey: INGESTION_KEY,
} as const;

function fakeMemory(input: {
  remember?: () => Promise<void>;
} = {}) {
  return {
    async exportMemory() {
      return { durable: { evidence: [], facts: [] } };
    },
    async recall() {
      return {
        evidence: [],
        facts: [],
        metadata: { latencyMs: 1 },
      };
    },
    async remember() {
      await input.remember?.();
      return { accepted: 1, rejected: 0 };
    },
  };
}

describe("Phase 74 release version process", () => {
  it("accepts only source-bound versioned ingestion keys", () => {
    const job = {
      action: "prepare",
      groups: [{
        ...PREPARE_IDENTITY,
        input: WORKER_INPUT,
        sqlitePath: "/tmp/release.sqlite",
      }],
      schemaVersion: 1,
    } as const;

    expect(parsePhase74VersionProcessJob(job)).toMatchObject({
      groups: [{ ingestionKey: INGESTION_KEY }],
    });
    expect(() => parsePhase74VersionProcessJob({
      ...job,
      groups: [{
        ...job.groups[0],
        ingestionKey: "d".repeat(64),
      }],
    })).toThrow("source-bound versioned key");
    expect(() => parsePhase74VersionProcessJob({
      ...job,
      groups: [{
        ...job.groups[0],
        ingestionKey:
          `phase74-version-ingestion-v1:${"a".repeat(40)}:${"b".repeat(64)}`,
      }],
    })).toThrow("source-bound versioned key");
  });

  it("accepts only label-free prepare and receipt-bound query jobs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "phase74-version-receipt-"));
    const sourceSqlitePath = join(directory, "release.sqlite");
    await writeFile(sourceSqlitePath, "prepared-snapshot");
    const prepared = buildPhase74VersionPreparedReceipt({
      ...PREPARE_IDENTITY,
      ingestionLatencyMs: 1,
      input: WORKER_INPUT,
      sqlitePath: sourceSqlitePath,
    });
    const receipt = await sealPhase74VersionPreparedSnapshot({
      prepared,
      snapshotRoot: join(directory, "sealed"),
    });

    expect(parsePhase74VersionProcessJob({
      action: "prepare",
      groups: [{
        ...PREPARE_IDENTITY,
        input: WORKER_INPUT,
        sqlitePath: "/tmp/release.sqlite",
      }],
      schemaVersion: 1,
    })).toMatchObject({
      action: "prepare",
      groups: [{
        executionIdentityHash: EXECUTION_IDENTITY_HASH,
        ingestionKey: INGESTION_KEY,
        input: { caseId: "case-opaque" },
      }],
    });

    expect(() => parsePhase74VersionProcessJob({
      action: "prepare",
      expectedAnswer: "PHASE74-GOLD-SENTINEL",
      groups: [{
        ...PREPARE_IDENTITY,
        input: WORKER_INPUT,
        sqlitePath: "/tmp/release.sqlite",
      }],
      schemaVersion: 1,
    })).toThrow("version process job");

    expect(() => parsePhase74VersionProcessJob({
      action: "query",
      goldEvidenceIds: ["evidence-1"],
      input: WORKER_INPUT,
      prepared: receipt,
      schemaVersion: 1,
    })).toThrow("version process job");

    expect(parsePhase74VersionProcessJob({
      action: "query",
      input: WORKER_INPUT,
      prepared: receipt,
      schemaVersion: 1,
    })).toMatchObject({
      action: "query",
      prepared: {
        executionIdentityHash: EXECUTION_IDENTITY_HASH,
        ingestionKey: INGESTION_KEY,
        memoryGroupId: "group-opaque",
      },
    });
    expect(receipt.receiptSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(receipt.sqlitePath).not.toBe(sourceSqlitePath);
    expect(await readFile(receipt.sqlitePath, "utf8"))
      .toBe("prepared-snapshot");
    const receiptSet = buildPhase74VersionPreparedReceiptSet([receipt]);
    expect(receiptSet).toMatchObject({
      receiptSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      receipts: [{
        ingestionKey: INGESTION_KEY,
        receiptSha256: receipt.receiptSha256,
      }],
      schemaVersion: 1,
    });

    await expect(verifyPhase74VersionPreparedReceipt({
      ...PREPARE_IDENTITY,
      input: {
        ...WORKER_INPUT,
        rawEvidence: [{
          ...WORKER_INPUT.rawEvidence[0],
          content: "SQLite is current.",
        }],
      },
      receipt,
    })).rejects.toThrow("prepared receipt");
    await expect(verifyPhase74VersionPreparedReceipt({
      executionIdentityHash: "e".repeat(64),
      ingestionKey: INGESTION_KEY,
      input: WORKER_INPUT,
      receipt,
    })).rejects.toThrow("prepared receipt");
    await writeFile(receipt.sqlitePath, "tampered-snapshot");
    await expect(verifyPhase74VersionPreparedReceipt({
      ...PREPARE_IDENTITY,
      input: WORKER_INPUT,
      receipt,
    })).rejects.toThrow("prepared receipt");
    await rm(directory, { force: true, recursive: true });
  });

  it("runs the release job in a different process without inherited judge secrets", async () => {
    const directory = await mkdtemp(join(tmpdir(), "phase74-version-child-"));
    const sourceSqlitePath = join(directory, "release.sqlite");
    await writeFile(sourceSqlitePath, "prepared-snapshot");
    const receipt = await sealPhase74VersionPreparedSnapshot({
      prepared: buildPhase74VersionPreparedReceipt({
        ...PREPARE_IDENTITY,
        ingestionLatencyMs: 1,
        input: WORKER_INPUT,
        sqlitePath: sourceSqlitePath,
      }),
      snapshotRoot: join(directory, "sealed"),
    });
    const result = await runPhase74VersionChildProcess({
      cwd: process.cwd(),
      env: {
        HOME: process.env.HOME,
        PATH: process.env.PATH,
        GOODMEMORY_EVAL_API_KEY: "reader-key",
        GOODMEMORY_JUDGE_API_KEY: "PHASE74-JUDGE-SENTINEL",
      },
      job: parsePhase74VersionProcessJob({
        action: "query",
        input: WORKER_INPUT,
        prepared: receipt,
        schemaVersion: 1,
      }),
      script: resolve("tests/fixtures/phase74-version-process-echo.ts"),
    });
    const observation = JSON.parse(result.stdout) as {
      env: Record<string, string>;
      pid: number;
      raw: string;
    };

    expect(result.pid).not.toBe(process.pid);
    expect(observation.pid).toBe(result.pid);
    expect(observation.raw).not.toContain("expectedAnswer");
    expect(observation.raw).not.toContain("goldEvidenceIds");
    expect(JSON.stringify(observation.env)).not.toContain(
      "PHASE74-JUDGE-SENTINEL",
    );
    await rm(directory, { force: true, recursive: true });
  });

  it("returns structured redacted evidence when a child process fails", async () => {
    try {
      await runPhase74VersionChildProcess({
        cwd: process.cwd(),
        env: {
          HOME: process.env.HOME,
          PATH: process.env.PATH,
        },
        job: parsePhase74VersionProcessJob({
          action: "prepare",
          groups: [{
            ...PREPARE_IDENTITY,
            input: WORKER_INPUT,
            sqlitePath: "/tmp/release.sqlite",
          }],
          schemaVersion: 1,
        }),
        script: resolve("tests/fixtures/phase74-version-process-fail.ts"),
      });
      throw new Error("expected Phase 74 version child failure");
    } catch (error) {
      expect(error).toBeInstanceOf(Phase74VersionChildProcessError);
      const failure = error as Phase74VersionChildProcessError;
      expect(failure.exitCode).toBe(7);
      expect(failure.pid).toBeGreaterThan(0);
      expect(failure.stderrSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(JSON.stringify(failure))
        .not.toContain("PHASE74-CHILD-SECRET-SENTINEL");
    }
  });

  it("refuses to seal a release snapshot with live SQLite sidecars", async () => {
    const directory = await mkdtemp(join(tmpdir(), "phase74-version-sidecar-"));
    const sqlitePath = join(directory, "release.sqlite");
    try {
      await writeFile(sqlitePath, "prepared-snapshot");
      for (const suffix of ["-journal", "-wal", "-shm"]) {
        await writeFile(`${sqlitePath}${suffix}`, "unsealed state");
        await expect(sealPhase74VersionPreparedSnapshot({
          prepared: buildPhase74VersionPreparedReceipt({
            ...PREPARE_IDENTITY,
            ingestionLatencyMs: 1,
            input: WORKER_INPUT,
            sqlitePath,
          }),
          snapshotRoot: join(directory, "sealed"),
        })).rejects.toThrow("sidecar");
        await rm(`${sqlitePath}${suffix}`);
      }
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("forbids loading the v0.7 runtime in the product orchestrator process", async () => {
    const source = await readFile(
      resolve("scripts/run-phase-74-product-comparison.ts"),
      "utf8",
    );

    expect(source).not.toContain("loadPhase74VersionCreateGoodMemory");
    expect(source).toContain("runPhase74VersionChildProcess");
  });

  it("routes release provider calls through the durable budget and complete usage ledger", async () => {
    const directory = await mkdtemp(join(tmpdir(), "phase74-version-usage-"));
    const eventsPath = join(directory, "events.jsonl");
    const intentsPath = join(directory, "intents.jsonl");
    const budgetPath = join(directory, "call-budget.json");
    const requests: string[] = [];
    try {
      await runPhase74VersionProcessJob({
        config: {
          callBudget: {
            embeddingSpendLimitUsd: 1,
            maxLanguageCalls: 4,
            path: budgetPath,
          },
          preparationConcurrency: 1,
          releaseSourceRoot: "/unused/release",
          usage: { eventsPath, intentsPath },
        },
        dependencies: {
          loadCreateGoodMemory: async () => (config) => {
            const sqlitePath = String(
              (config as { storage?: { url?: string } }).storage?.url ?? "",
            );
            return fakeMemory({
              async remember() {
                await globalThis.fetch(
                  "https://ai.gurkiai.com/v1/chat/completions",
                  {
                    body: JSON.stringify({
                      messages: [],
                      model: "gpt-5.6-terra",
                    }),
                    method: "POST",
                  },
                );
                await globalThis.fetch(
                  "https://openrouter.ai/api/v1/embeddings",
                  {
                    body: JSON.stringify({
                      input: ["Postgres is current."],
                      model: "baai/bge-m3",
                    }),
                    method: "POST",
                  },
                );
                await writeFile(sqlitePath, "prepared-snapshot");
              },
            });
          },
        },
        env: PROCESS_ENV,
        fetch: (async (request) => {
          const url = String(request);
          requests.push(url);
          return url.endsWith("/embeddings")
            ? Response.json({
                data: [],
                usage: { prompt_tokens: 4, total_tokens: 4 },
              })
            : Response.json({
                choices: [],
                usage: {
                  completion_tokens: 2,
                  prompt_tokens: 3,
                  total_tokens: 5,
                },
              });
        }) as typeof globalThis.fetch,
        job: parsePhase74VersionProcessJob({
          action: "prepare",
          groups: [{
            ...PREPARE_IDENTITY,
            input: WORKER_INPUT,
            sqlitePath: join(directory, "release.sqlite"),
          }],
          schemaVersion: 1,
        }),
      });

      expect(requests).toHaveLength(2);
      expect(
        (await readFile(eventsPath, "utf8")).trim().split("\n"),
      ).toHaveLength(2);
      expect(
        (await readFile(intentsPath, "utf8")).trim().split("\n"),
      ).toHaveLength(2);
      expect(
        JSON.parse(await readFile(budgetPath, "utf8")),
      ).toMatchObject({
        embeddingCalls: 1,
        languageCalls: 1,
      });
      expect(
        (await readFile(eventsPath, "utf8"))
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line).completeness),
      ).toEqual(["complete", "complete"]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rejects over-budget release calls before reaching the provider", async () => {
    const directory = await mkdtemp(join(tmpdir(), "phase74-version-budget-"));
    let providerCalls = 0;
    try {
      await expect(runPhase74VersionProcessJob({
        config: {
          callBudget: {
            embeddingSpendLimitUsd: 1,
            maxLanguageCalls: 1,
            path: join(directory, "call-budget.json"),
          },
          preparationConcurrency: 1,
          releaseSourceRoot: "/unused/release",
          usage: {
            eventsPath: join(directory, "events.jsonl"),
            intentsPath: join(directory, "intents.jsonl"),
          },
        },
        dependencies: {
          loadCreateGoodMemory: async () => () => fakeMemory({
            async remember() {
              for (let index = 0; index < 2; index += 1) {
                await globalThis.fetch(
                  "https://ai.gurkiai.com/v1/chat/completions",
                  {
                    body: JSON.stringify({
                      messages: [],
                      model: "gpt-5.6-terra",
                    }),
                    method: "POST",
                  },
                );
              }
            },
          }),
        },
        env: PROCESS_ENV,
        fetch: Object.assign(async () => {
          providerCalls += 1;
          return Response.json({
            choices: [],
            usage: {
              completion_tokens: 1,
              prompt_tokens: 1,
              total_tokens: 2,
            },
          });
        }, { preconnect() {} }),
        job: parsePhase74VersionProcessJob({
          action: "prepare",
          groups: [{
            ...PREPARE_IDENTITY,
            input: WORKER_INPUT,
            sqlitePath: join(directory, "release.sqlite"),
          }],
          schemaVersion: 1,
        }),
      })).rejects.toThrow("language-call limit");

      expect(providerCalls).toBe(1);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("waits for every active child preparation before returning a failure", async () => {
    const directory = await mkdtemp(join(tmpdir(), "phase74-version-settle-"));
    let secondSettled = false;
    try {
      await expect(runPhase74VersionProcessJob({
        config: {
          callBudget: {
            embeddingSpendLimitUsd: 1,
            maxLanguageCalls: 4,
            path: join(directory, "call-budget.json"),
          },
          preparationConcurrency: 2,
          releaseSourceRoot: "/unused/release",
          usage: {
            eventsPath: join(directory, "events.jsonl"),
            intentsPath: join(directory, "intents.jsonl"),
          },
        },
        dependencies: {
          loadCreateGoodMemory: async () => (config) => {
            const sqlitePath = String(
              (config as { storage?: { url?: string } }).storage?.url ?? "",
            );
            return fakeMemory({
              async remember() {
                if (sqlitePath.includes("first")) {
                  throw new Error("first preparation failed");
                }
                await new Promise((resolve) => setTimeout(resolve, 20));
                await writeFile(sqlitePath, "prepared-snapshot");
                secondSettled = true;
              },
            });
          },
        },
        env: PROCESS_ENV,
        fetch: Object.assign(
          async () => Response.json({}),
          { preconnect() {} },
        ),
        job: parsePhase74VersionProcessJob({
          action: "prepare",
          groups: [
            {
              ...PREPARE_IDENTITY,
              input: {
                ...WORKER_INPUT,
                memoryGroupId: "group-first",
                rawEvidence: [{
                  ...WORKER_INPUT.rawEvidence[0],
                  content: "first",
                }],
              },
              sqlitePath: join(directory, "first.sqlite"),
            },
            {
              executionIdentityHash: EXECUTION_IDENTITY_HASH,
              ingestionKey:
                `phase74-version-ingestion-v1:${PHASE74_RELEASE_COMMIT}:${"e".repeat(64)}`,
              input: {
                ...WORKER_INPUT,
                memoryGroupId: "group-second",
                rawEvidence: [{
                  ...WORKER_INPUT.rawEvidence[0],
                  content: "second",
                }],
              },
              sqlitePath: join(directory, "second.sqlite"),
            },
          ],
          schemaVersion: 1,
        }),
      })).rejects.toThrow("first preparation failed");

      expect(secondSettled).toBeTrue();
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rejects malformed or source-drifted release process output", () => {
    const valid = {
      action: "query",
      pid: 123,
      preparedReceiptSha256: "f".repeat(64),
      result: {
        arm: "release",
        caseId: "case-opaque",
        ingestionLatencyMs: 1,
        recallLatencyMs: 1,
        retrievedMemories: [],
        schemaVersion: 1,
        sourceCommit: PHASE74_RELEASE_COMMIT,
        storedMemories: [],
      },
      schemaVersion: 1,
    } as const;

    expect(parsePhase74VersionProcessOutput(valid)).toMatchObject({
      action: "query",
      result: { sourceCommit: PHASE74_RELEASE_COMMIT },
    });
    expect(() => parsePhase74VersionProcessOutput({
      ...valid,
      result: { ...valid.result, sourceCommit: "f".repeat(40) },
    })).toThrow("query result");
    expect(() => parsePhase74VersionProcessOutput({
      ...valid,
      result: { ...valid.result, unexpected: true },
    })).toThrow("query result");
    expect(() => parsePhase74VersionProcessOutput({
      ...valid,
      result: { ...valid.result, recallLatencyMs: -1 },
    })).toThrow("query result");
  });
});
