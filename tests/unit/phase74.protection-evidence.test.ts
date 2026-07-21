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

import {
  parsePhase74ProtectionEvidenceCliOptions,
  runPhase74ProtectionEvidenceGeneration,
} from "../../scripts/build-phase-74-protection-evidence";
import {
  buildPhase74FrozenProtectionEvidence,
  hashPhase74ProtectionCaseIds,
  loadPhase74FrozenProtectionEvidence,
} from "../../src/eval/phase74ProtectionEvidence";
import type {
  Phase74FrozenProtectionRunArtifact,
  Phase74ProtectionBranchScores,
} from "../../src/eval/phase74ProtectionEvidence";

const roots: string[] = [];
const FORMATS = [
  "prose",
  "chronology",
  "compact_json",
  "json_locale_note",
] as const;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, {
    force: true,
    recursive: true,
  })));
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function formatRecord<T>(
  create: (format: (typeof FORMATS)[number], index: number) => T,
): Record<(typeof FORMATS)[number], T> {
  return {
    chronology: create("chronology", 1),
    compact_json: create("compact_json", 2),
    json_locale_note: create("json_locale_note", 3),
    prose: create("prose", 0),
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

interface Fixture {
  artifactPaths: [string, string, string];
  outputPath: string;
  root: string;
}

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "phase74-protection-"));
  roots.push(root);
  const caseIds = ["case-a", "case-b"];
  const identity = {
    dataset: { id: "protection-suite", sha256: "1".repeat(64) },
    judge: { id: "judge-v1", sha256: "2".repeat(64) },
    model: { id: "answer-model-v1", sha256: "3".repeat(64) },
    pipeline: { id: "pipeline-v1", sha256: "4".repeat(64) },
    population: {
      caseCount: caseIds.length,
      caseIdsSha256: hashPhase74ProtectionCaseIds(caseIds),
      id: "frozen-protection-population-v1",
    },
    prompt: { id: "prompt-v1", sha256: "5".repeat(64) },
    source: { id: "commit-deadbeef", sha256: "6".repeat(64) },
  };
  const artifactPaths = [] as string[];
  for (const replicate of [1, 2, 3] as const) {
    const rawArtifactPath = join(root, `raw-${replicate}.jsonl`);
    const raw = `raw protection evidence ${replicate}\n`;
    await writeFile(rawArtifactPath, raw, "utf8");
    const rows = caseIds.map((caseId, caseIndex) => {
      const baselineProtection = 0.4 + caseIndex * 0.1;
      const candidateProtection = baselineProtection + replicate * 0.05;
      const branch = (candidate: boolean): Phase74ProtectionBranchScores => ({
        e4: formatRecord((_format, formatIndex) => ({
          beam: baselineProtection + (candidate ? (formatIndex + 1) * 0.01 : 0),
          memory_agent_bench: 0.8 + (candidate ? -0.01 : 0),
        })),
        protections: {
          beam: candidate ? candidateProtection : baselineProtection,
          memory_agent_bench: candidate ? 0.79 : 0.8,
        },
        safety: {
          abstentionAccuracy: candidate ? 0.91 : 0.9,
          hallucinationRate: candidate ? 0.09 : 0.1,
          privacyPassRate: candidate ? 1 : 0.99,
          updateCorrectness: candidate ? 0.96 : 0.95,
        },
      });
      return {
        baseline: branch(false),
        candidate: branch(true),
        caseId,
      };
    });
    const artifactPath = join(root, `replicate-${replicate}.json`);
    const artifact = {
      artifactKind: "phase74-frozen-protection-run",
      executionFailures: 0,
      identity,
      rawArtifact: {
        path: rawArtifactPath,
        sha256: sha256(raw),
      },
      replicate,
      rows,
      runId: `protection-run-${replicate}`,
      schemaVersion: 1,
    } satisfies Phase74FrozenProtectionRunArtifact;
    await writeJson(artifactPath, artifact);
    artifactPaths.push(artifactPath);
  }
  return {
    artifactPaths: artifactPaths as [string, string, string],
    outputPath: join(root, "protection-evidence.json"),
    root,
  };
}

describe("Phase 74 frozen protection evidence", () => {
  it("derives promotion, safety, and E4 deltas from three paired case artifacts", async () => {
    const fixture = await createFixture();
    const evidence = await buildPhase74FrozenProtectionEvidence({
      runArtifactPaths: fixture.artifactPaths,
    });

    expect(evidence).toMatchObject({
      artifactKind: "phase74-frozen-protection-evidence",
      derivation: {
        caseCountPerReplicate: 2,
        method: "paired-case-mean-across-three-replicates-v1",
        pairedRowCount: 6,
        replicateCount: 3,
      },
      promotion: {
        protections: [
          { delta: 0.1, name: "beam" },
          { delta: -0.01, name: "memory_agent_bench" },
        ],
        safety: {
          abstentionAccuracyDelta: 0.01,
          hallucinationRateDelta: -0.01,
          privacyPassRateDelta: 0.01,
          updateCorrectnessDelta: 0.01,
        },
      },
      schemaVersion: 2,
      source: {
        runIds: [
          "protection-run-1",
          "protection-run-2",
          "protection-run-3",
        ],
      },
    });
    expect(evidence.e4.formatDeltas.prose).toEqual([
      { delta: 0.01, name: "beam" },
      { delta: -0.01, name: "memory_agent_bench" },
    ]);
    expect(evidence.e4.formatDeltas.json_locale_note[0]?.delta).toBeCloseTo(0.04);
    expect(evidence.source.files.map(({ artifactPath }) => artifactPath)).toEqual(
      fixture.artifactPaths,
    );
    expect(evidence.source.files.every(({ artifactSha256 }) =>
      /^[a-f0-9]{64}$/u.test(artifactSha256)
    )).toBe(true);
  });

  it("writes a v2 artifact and re-derives it while loading", async () => {
    const fixture = await createFixture();
    const report = await runPhase74ProtectionEvidenceGeneration({
      outputPath: fixture.outputPath,
      runArtifactPaths: fixture.artifactPaths,
    });
    const loaded = await loadPhase74FrozenProtectionEvidence(fixture.outputPath);

    expect(loaded.evidence).toEqual(report);
    expect(loaded.sha256).toBe(sha256(await readFile(fixture.outputPath, "utf8")));

    const tampered = JSON.parse(await readFile(fixture.outputPath, "utf8"));
    tampered.promotion.protections[0].delta = 0.9;
    await writeJson(fixture.outputPath, tampered);
    await expect(
      loadPhase74FrozenProtectionEvidence(fixture.outputPath),
    ).rejects.toThrow("does not match its paired source rows");
  });

  it("rejects legacy evidence and every incomplete or drifted source chain", async () => {
    const fixture = await createFixture();
    await writeJson(fixture.outputPath, {
      artifactKind: "phase74-frozen-protection-evidence",
      schemaVersion: 1,
    });
    await expect(
      loadPhase74FrozenProtectionEvidence(fixture.outputPath),
    ).rejects.toThrow("schemaVersion 2");

    const first = JSON.parse(await readFile(fixture.artifactPaths[0], "utf8"));
    first.executionFailures = 1;
    await writeJson(fixture.artifactPaths[0], first);
    await expect(buildPhase74FrozenProtectionEvidence({
      runArtifactPaths: fixture.artifactPaths,
    })).rejects.toThrow("zero execution failures");

    first.executionFailures = 0;
    first.rawArtifact.sha256 = "f".repeat(64);
    await writeJson(fixture.artifactPaths[0], first);
    await expect(buildPhase74FrozenProtectionEvidence({
      runArtifactPaths: fixture.artifactPaths,
    })).rejects.toThrow("raw artifact SHA-256 mismatch");

    first.rawArtifact.sha256 = sha256(await readFile(first.rawArtifact.path, "utf8"));
    first.identity.model.sha256 = "a".repeat(64);
    await writeJson(fixture.artifactPaths[0], first);
    await expect(buildPhase74FrozenProtectionEvidence({
      runArtifactPaths: fixture.artifactPaths,
    })).rejects.toThrow("identity drift");
  });

  it("rejects population drift and requires replicates 1, 2, and 3 exactly once", async () => {
    const fixture = await createFixture();
    const first = JSON.parse(await readFile(fixture.artifactPaths[0], "utf8"));
    first.rows[0].caseId = "different-case";
    await writeJson(fixture.artifactPaths[0], first);
    await expect(buildPhase74FrozenProtectionEvidence({
      runArtifactPaths: fixture.artifactPaths,
    })).rejects.toThrow("case population");

    await expect(buildPhase74FrozenProtectionEvidence({
      runArtifactPaths: [
        fixture.artifactPaths[1],
        fixture.artifactPaths[1],
        fixture.artifactPaths[2],
      ],
    })).rejects.toThrow("duplicate run artifact paths");
  });

  it("rejects protection metric drift across otherwise identical replicates", async () => {
    const fixture = await createFixture();
    const first = JSON.parse(await readFile(fixture.artifactPaths[0], "utf8"));
    for (const row of first.rows) {
      for (const branchName of ["baseline", "candidate"]) {
        const branch = row[branchName];
        branch.protections.renamed_beam = branch.protections.beam;
        delete branch.protections.beam;
        for (const format of FORMATS) {
          branch.e4[format].renamed_beam = branch.e4[format].beam;
          delete branch.e4[format].beam;
        }
      }
    }
    await writeJson(fixture.artifactPaths[0], first);

    await expect(buildPhase74FrozenProtectionEvidence({
      runArtifactPaths: fixture.artifactPaths,
    })).rejects.toThrow("metric population drift across replicates");
  });

  it("exposes a paths-only CLI with no delta or safety escape hatch", async () => {
    const fixture = await createFixture();
    expect(parsePhase74ProtectionEvidenceCliOptions([
      "bun",
      "script.ts",
      ...fixture.artifactPaths.flatMap((path) => ["--run-artifact", path]),
      "--output",
      fixture.outputPath,
    ])).toEqual({
      outputPath: fixture.outputPath,
      runArtifactPaths: fixture.artifactPaths,
    });
    expect(() => parsePhase74ProtectionEvidenceCliOptions([
      ...fixture.artifactPaths.flatMap((path) => ["--run-artifact", path]),
      "--output",
      fixture.outputPath,
      "--delta",
      "0.1",
    ])).toThrow("unknown option --delta");
    expect(() => parsePhase74ProtectionEvidenceCliOptions([
      "--run-artifact",
      fixture.artifactPaths[0],
      "--output",
      fixture.outputPath,
    ])).toThrow("exactly three --run-artifact");
  });

  it("registers the protection evidence producer as a package script", async () => {
    const packageJson = JSON.parse(await readFile(
      new URL("../../package.json", import.meta.url),
      "utf8",
    ));
    expect(packageJson.scripts?.["eval:phase-74-protection-evidence"]).toBe(
      "bun run scripts/build-phase-74-protection-evidence.ts",
    );
  });
});
