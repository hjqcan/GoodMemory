import { describe, expect, it } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import type { FactMemory } from "../../src/domain/records";
import type { SourceMessageRecord } from "../../src/evidence/contracts";

const old = "Project decision: We deploy CedarApp with blue-green releases.";
const next = "Project decision: We now deploy CedarApp with canary releases instead of blue-green releases.";
const root = resolve(import.meta.dir, "../..");
describe("source-bound correction process exit consistency", () => {
  it.each(["before-source-commit", "after-source-commit", "before-correction-commit", "after-correction-commit"])
  ("has a fully sourced lifecycle at %s", async fault => {
    const directory = await mkdtemp(join(root, "evidence/crash-"));
    const database = join(directory, "memory.sqlite");
    const run = async (phase: string) => {
      const result = Bun.spawnSync([process.execPath, join(root, "evidence/correction-crash-worker.ts"), database, phase, fault], { cwd: root, env: process.env });
      const stdout = result.stdout.toString(), stderr = result.stderr.toString();
      await writeFile(join(directory, phase + ".stdout"), stdout); await writeFile(join(directory, phase + ".stderr"), stderr);
      await writeFile(join(directory, phase + ".exit.json"), JSON.stringify({ exitCode: result.exitCode, signalCode: result.signalCode }));
      return { ...result, stdout, stderr };
    };
    expect((await run("old")).exitCode).toBe(0);
    expect((await run("correction")).exitCode).toBe(86);
    const read = await run("read"); expect(read.exitCode).toBe(0);
    const result = JSON.parse(read.stdout) as { facts: FactMemory[]; sources: SourceMessageRecord[]; context: string; danglingCorrectionSources: string[] };
    expect(result.danglingCorrectionSources).toEqual([]);
    const committed = fault === "after-correction-commit";
    expect(result.facts.find(fact => fact.content === old)?.lifecycle).toBe(committed ? "superseded" : "active");
    expect(result.facts.filter(fact => fact.lifecycle === "active").map(fact => fact.content)).toEqual([committed ? next : old]);
    expect(result.sources.some(source => source.content === next)).toBe(fault !== "before-source-commit");
    expect(result.context).toContain(committed ? next : old);
  });
});
