import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  parsePhase74VersionProcessJob,
  runPhase74VersionChildProcess,
} from "../../scripts/phase74-version-process";

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
  sourceCommit: "a".repeat(40),
} as const;

describe("Phase 74 release version process", () => {
  it("accepts only label-free prepare and query jobs", () => {
    expect(parsePhase74VersionProcessJob({
      action: "prepare",
      groups: [{
        input: WORKER_INPUT,
        sqlitePath: "/tmp/release.sqlite",
      }],
      schemaVersion: 1,
    })).toMatchObject({
      action: "prepare",
      groups: [{ input: { caseId: "case-opaque" } }],
    });

    expect(() => parsePhase74VersionProcessJob({
      action: "prepare",
      expectedAnswer: "PHASE74-GOLD-SENTINEL",
      groups: [{
        input: WORKER_INPUT,
        sqlitePath: "/tmp/release.sqlite",
      }],
      schemaVersion: 1,
    })).toThrow("version process job");

    expect(() => parsePhase74VersionProcessJob({
      action: "query",
      goldEvidenceIds: ["evidence-1"],
      ingestionLatencyMs: 1,
      input: WORKER_INPUT,
      sqlitePath: "/tmp/release.sqlite",
      schemaVersion: 1,
    })).toThrow("version process job");
  });

  it("runs the release job in a different process without inherited judge secrets", async () => {
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
        ingestionLatencyMs: 1,
        input: WORKER_INPUT,
        sqlitePath: "/tmp/release.sqlite",
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
  });

  it("forbids loading the v0.6 runtime in the product orchestrator process", async () => {
    const source = await readFile(
      resolve("scripts/run-phase-74-product-comparison.ts"),
      "utf8",
    );

    expect(source).not.toContain("loadPhase74VersionCreateGoodMemory");
    expect(source).toContain("runPhase74VersionChildProcess");
  });
});
