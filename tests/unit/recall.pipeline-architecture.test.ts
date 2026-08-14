import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const RECALL_ROOT = join(import.meta.dir, "../../src/recall");

async function readRecallModule(name: string): Promise<string> {
  return readFile(join(RECALL_ROOT, name), "utf8");
}

function lineCount(source: string): number {
  return source.trimEnd().split("\n").length;
}

describe("recall pipeline architecture", () => {
  it("exchanges explicit immutable stage DTOs", async () => {
    const contracts = await readRecallModule("contracts.ts");
    const contentLoader = await readRecallModule("contentLoader.ts");
    const retrievalPipeline = await readRecallModule("retrievalPipeline.ts");
    const resultAssembly = await readRecallModule("resultAssembly.ts");

    expect(contracts).toContain("export interface RecallRequestContext");
    expect(contracts).toContain("export interface LoadedRecallContent");
    expect(contracts).toContain("export interface RetrievedRecallCandidates");
    expect(contentLoader).toContain("Promise<LoadedRecallContent>");
    expect(retrievalPipeline).toContain("Promise<RetrievedRecallCandidates>");
    expect(resultAssembly).toContain("RetrievedRecallCandidates");
  });

  it("keeps orchestration files bounded by stage responsibility", async () => {
    const retrievalPipeline = await readRecallModule("retrievalPipeline.ts");
    const resultAssembly = await readRecallModule("resultAssembly.ts");

    expect(lineCount(retrievalPipeline)).toBeLessThanOrEqual(800);
    expect(lineCount(resultAssembly)).toBeLessThanOrEqual(1_200);
    expect(retrievalPipeline).not.toContain("buildMemoryPacket({");
    expect(resultAssembly).not.toContain("listByScope(input.scope)");
  });
});
