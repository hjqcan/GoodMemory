import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";

import {
  createPhase72ExternalBoundary,
  evaluatePhase72ExternalBoundary,
  PHASE72_ANSWER_GATEWAY,
  PHASE72_ANSWER_MODEL,
  PHASE72_INDEPENDENT_JUDGE_MODEL,
  PHASE72_UPSTREAMS,
} from "../../scripts/phase-72-external-contracts";

describe("Phase 72 external benchmark contracts", () => {
  it("keeps historical runners directly replayable without package aliases", async () => {
    const packageJson = JSON.parse(await readFile(
      new URL("../../package.json", import.meta.url),
      "utf8",
    )) as { scripts?: Record<string, string> };

    const runners = [
      "run-phase-72-beam-generalization-live.ts",
      "run-phase-72-halumem.ts",
      "run-phase-72-longmemeval-operand-head-preservation-development.ts",
      "run-phase-72-longmemeval-temporal-operands-development.ts",
      "run-phase-72-temporal-operands-protection.ts",
      "run-phase-72-memgym.ts",
      "run-phase-72-minteval-smoke.ts",
      "merge-phase-72-implicitmembench-retry.ts",
      "prepare-phase-72-beam-stored-retry.ts",
    ];

    expect(
      Object.keys(packageJson.scripts ?? {}).filter((name) =>
        name.includes("phase-72")
      ),
    ).toEqual([]);
    for (const runner of runners) {
      expect(
        await Bun.file(new URL(`../../scripts/${runner}`, import.meta.url)).exists(),
      ).toBe(true);
    }
  });

  it("pins the live answer model and each upstream source", () => {
    expect(PHASE72_ANSWER_MODEL).toBe("gpt-5.6-terra");
    expect(PHASE72_ANSWER_GATEWAY).toBe("https://ai.gurkiai.com/v1");
    expect(PHASE72_INDEPENDENT_JUDGE_MODEL).not.toBe(PHASE72_ANSWER_MODEL);
    expect(PHASE72_UPSTREAMS).toEqual({
      halumem: {
        codeCommit: "c29025f43b347f68fc36a06bee8ed29b4dc6c3fb",
        codeLicense: "CC-BY-NC-ND-4.0",
        codeLicenseEvidence: "README badge; no root LICENSE file",
        datasetLicense: "CC-BY-NC-ND-4.0",
        repository: "https://github.com/MemTensor/HaluMem",
      },
      memgym: {
        codeCommit: "50b404e6ae4e1fcd453d3e07963eb3e6312cbded",
        codeLicense: "Apache-2.0",
        codeQaAvailability: "pending",
        repository: "https://github.com/WujiangXu/MemGym",
      },
      minteval: {
        codeCommit: "3dd82be34f4b82d90829bd5572b1e3950cb2f731",
        codeLicense: "unresolved",
        datasetLicense: "CC-BY-4.0",
        datasetRevision: "9b9c5befc5126a4ca0fd88cc03c03260142a0883",
        historicalName: "LongMINT",
        repository: "https://github.com/amy-hyunji/MINTEval",
      },
    });
  });

  it("accepts the honest generated-slice and smoke boundary", () => {
    const boundary = createPhase72ExternalBoundary();

    expect(evaluatePhase72ExternalBoundary(boundary)).toEqual({
      failures: [],
      status: "passed",
    });
  });

  it("fails closed on self-judging, redistribution, or inflated scope", () => {
    const boundary = createPhase72ExternalBoundary();
    const result = evaluatePhase72ExternalBoundary({
      ...boundary,
      judge: { ...boundary.judge, model: PHASE72_ANSWER_MODEL },
      halumem: {
        ...boundary.halumem,
        codeCopiedIntoPackage: true,
        datasetRedistributed: true,
        rawArtifactsTracked: true,
      },
      memgym: {
        ...boundary.memgym,
        claimScope: "public-full-dataset",
        source: "official-public-codeqa",
      },
      minteval: { ...boundary.minteval, mode: "scored-claim" },
    });

    expect(result.status).toBe("failed");
    expect(result.failures).toContain("answer model must not judge its own output");
    expect(result.failures).toContain("HaluMem source or dataset content cannot ship in the package");
    expect(result.failures).toContain("HaluMem raw evaluation artifacts cannot be tracked");
    expect(result.failures).toContain("MemGym CodeQA evidence must remain a generated slice");
    expect(result.failures).toContain("MINTEval is smoke-only in Phase 72");
  });

  it("rejects drift from pinned upstream commits", () => {
    const boundary = createPhase72ExternalBoundary();
    const result = evaluatePhase72ExternalBoundary({
      ...boundary,
      halumem: { ...boundary.halumem, codeCommit: "0".repeat(40) },
      memgym: { ...boundary.memgym, codeCommit: "1".repeat(40) },
      minteval: { ...boundary.minteval, codeCommit: "2".repeat(40) },
    });

    expect(result.failures).toContain("HaluMem upstream commit is not pinned");
    expect(result.failures).toContain("MemGym upstream commit is not pinned");
    expect(result.failures).toContain("MINTEval upstream commit is not pinned");
  });

  it("rejects drift from the pinned MINTEval dataset revision", () => {
    const boundary = createPhase72ExternalBoundary();
    const result = evaluatePhase72ExternalBoundary({
      ...boundary,
      minteval: { ...boundary.minteval, datasetRevision: "3".repeat(40) },
    });

    expect(result.failures).toContain("MINTEval dataset revision is not pinned");
  });
});
