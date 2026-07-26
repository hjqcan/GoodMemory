import { describe, expect, it } from "bun:test";

import {
  parseC6SourceExpansionScreeningFrameCliOptions,
} from "../../scripts/snapshot-codex-coding-effect-c6-source-expansion-screening-frame";

describe("Codex coding-effect C6 source-expansion frame CLI", () => {
  it("parses the complete frozen input tuple", () => {
    expect(parseC6SourceExpansionScreeningFrameCliOptions([
      `--expected-inventory-sha256=${"a".repeat(64)}`,
      `--expected-legacy-frame-sha256=${"b".repeat(64)}`,
      `--expected-qualification-sha256=${"c".repeat(64)}`,
      "--inventory=inventory.json",
      "--legacy-frame=legacy.json",
      "--qualification=qualification.json",
      "--output=frame.json",
    ])).toEqual({
      expectedInventorySha256: "a".repeat(64),
      expectedLegacyFrameSha256: "b".repeat(64),
      expectedQualificationSha256: "c".repeat(64),
      inventory: "inventory.json",
      legacyFrame: "legacy.json",
      output: "frame.json",
      qualification: "qualification.json",
    });
  });

  it("rejects missing, duplicate, padded, and unknown options", () => {
    expect(() => parseC6SourceExpansionScreeningFrameCliOptions([]))
      .toThrow("--expected-inventory-sha256 is required");
    expect(() => parseC6SourceExpansionScreeningFrameCliOptions([
      `--expected-inventory-sha256=${"a".repeat(64)}`,
      `--expected-inventory-sha256=${"a".repeat(64)}`,
    ])).toThrow("cannot be specified more than once");
    expect(() => parseC6SourceExpansionScreeningFrameCliOptions([
      "--inventory= padded",
    ])).toThrow("must not be empty or padded");
    expect(() => parseC6SourceExpansionScreeningFrameCliOptions([
      "--unknown=value",
    ])).toThrow("unknown C6 source-expansion frame option");
  });
});
