import { describe, expect, it } from "bun:test";

import {
  parseC6CandidatePreparationOptions,
  runC6CandidatePreparationCommand,
} from "../../scripts/prepare-codex-coding-effect-c6-candidate";

describe("Codex coding-effect C6 candidate preparation CLI", () => {
  it("parses only the deterministic protocol-freeze inputs", () => {
    expect(parseC6CandidatePreparationOptions(requiredArgs())).toEqual({
      c5EvidenceRoot: "reports/c5",
      datasetRoot: "fixtures/c6",
      environmentManifestPath: "protocol/environment.json",
      gatePolicyPath: "protocol/gate-policy.json",
      packageTarballPath: "dist/goodmemory.tgz",
      seeds: [101, 202, 303],
      summaryProtocolPath: "protocol/summary.json",
    });
  });

  it("rejects duplicate scalar flags and anything other than three distinct seeds", () => {
    expect(() => parseC6CandidatePreparationOptions([
      ...requiredArgs(),
      "--dataset-root=other",
    ])).toThrow("duplicate C6 candidate option --dataset-root");
    expect(() => parseC6CandidatePreparationOptions(
      requiredArgs().filter((argument) => argument !== "--seed=303"),
    )).toThrow("exactly three distinct --seed");
    expect(() => parseC6CandidatePreparationOptions([
      ...requiredArgs().filter((argument) => argument !== "--seed=303"),
      "--seed=202",
    ])).toThrow("exactly three distinct --seed");
    expect(() => parseC6CandidatePreparationOptions([
      ...requiredArgs(),
      "--unknown=value",
    ])).toThrow("unknown C6 candidate option");
    expect(() => parseC6CandidatePreparationOptions([
      ...requiredArgs(),
      `--repository-design-sha256=${"a".repeat(64)}`,
    ])).toThrow("all four repository-design SHA-256 pins");
  });

  it("accepts only a complete externally pinned repository-design evidence set", () => {
    expect(parseC6CandidatePreparationOptions([
      ...requiredArgs(),
      `--repository-design-sha256=${"a".repeat(64)}`,
      `--repository-power-input-sha256=${"d".repeat(64)}`,
      `--repository-lineage-sha256=${"b".repeat(64)}`,
      `--repository-review-sha256=${"c".repeat(64)}`,
    ])).toMatchObject({
      repositoryDesignEvidence: {
        expectedDesignPowerArtifactSha256: "a".repeat(64),
        expectedPowerInputArtifactSha256: "d".repeat(64),
        expectedRepositoryLineageArtifactSha256: "b".repeat(64),
        expectedReviewReceiptSha256: "c".repeat(64),
      },
    });
  });

  it("dispatches once and does not add any live-call input", async () => {
    const calls: unknown[] = [];
    const marker = { readinessStage: "test-only" };
    const result = await runC6CandidatePreparationCommand(
      requiredArgs(),
      async (input) => {
        calls.push(input);
        return marker;
      },
    );

    expect(result).toBe(marker);
    expect(calls).toEqual([parseC6CandidatePreparationOptions(requiredArgs())]);
  });
});

function requiredArgs(): string[] {
  return [
    "--dataset-root=fixtures/c6",
    "--c5-evidence-root=reports/c5",
    "--environment-manifest=protocol/environment.json",
    "--gate-policy=protocol/gate-policy.json",
    "--package-tarball=dist/goodmemory.tgz",
    "--summary-protocol=protocol/summary.json",
    "--seed=101",
    "--seed=202",
    "--seed=303",
  ];
}
