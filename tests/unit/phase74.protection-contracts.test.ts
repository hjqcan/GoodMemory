import { describe, expect, it } from "bun:test";

import {
  hashPhase74ProtectionCaseIds,
  parsePhase74ProtectionRunIdentity,
  PHASE74_PROTECTION_SAFETY_METRICS,
} from "../../src/eval/phase74ProtectionContracts";

function identity() {
  return {
    dataset: { id: "dataset-v1", sha256: "1".repeat(64) },
    judge: { id: "judge-v1", sha256: "2".repeat(64) },
    model: { id: "model-v1", sha256: "3".repeat(64) },
    pipeline: { id: "pipeline-v1", sha256: "4".repeat(64) },
    population: {
      caseCount: 2,
      caseIdsSha256: hashPhase74ProtectionCaseIds(["case-b", "case-a"]),
      id: "population-v1",
    },
    prompt: { id: "prompt-v1", sha256: "5".repeat(64) },
    source: { id: "source-v1", sha256: "6".repeat(64) },
  };
}

describe("Phase 74 protection contracts", () => {
  it("keeps the suite safety metric and order-independent case identity contract", () => {
    expect(PHASE74_PROTECTION_SAFETY_METRICS).toEqual([
      "abstentionAccuracy",
      "hallucinationRate",
      "privacyPassRate",
      "updateCorrectness",
    ]);
    expect(hashPhase74ProtectionCaseIds(["case-a", "case-b"])).toBe(
      hashPhase74ProtectionCaseIds(["case-b", "case-a"]),
    );
  });

  it("parses the exact frozen run identity without legacy artifact fields", () => {
    expect(parsePhase74ProtectionRunIdentity(
      identity(),
      "protection identity",
    )).toEqual(identity());

    expect(() => parsePhase74ProtectionRunIdentity({
      ...identity(),
      legacyEvidence: true,
    }, "protection identity")).toThrow("must contain exactly");
    expect(() => parsePhase74ProtectionRunIdentity({
      ...identity(),
      population: { ...identity().population, caseCount: 0 },
    }, "protection identity")).toThrow("must be greater than zero");
    expect(() => parsePhase74ProtectionRunIdentity({
      ...identity(),
      source: { id: "source-v1", sha256: "A".repeat(64) },
    }, "protection identity")).toThrow("lowercase SHA-256");
  });
});
