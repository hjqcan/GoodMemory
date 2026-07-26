import { describe, expect, it } from "bun:test";

import {
  parseC6SourceExpansionScreeningFrameV2CliOptions,
} from "../../scripts/snapshot-codex-coding-effect-c6-source-expansion-screening-frame-v2";

describe("Codex coding-effect C6 source-expansion frame v2 CLI", () => {
  it("parses the complete frozen input tuple", () => {
    expect(parseC6SourceExpansionScreeningFrameV2CliOptions([
      `--expected-prior-frame-sha256=${"a".repeat(64)}`,
      `--expected-qualification-sha256=${"b".repeat(64)}`,
      "--prior-frame=prior-frame.json",
      "--qualification=qualification-v2.json",
      "--output=frame-v2.json",
    ])).toEqual({
      expectedPriorFrameSha256: "a".repeat(64),
      expectedQualificationSha256: "b".repeat(64),
      output: "frame-v2.json",
      priorFrame: "prior-frame.json",
      qualification: "qualification-v2.json",
    });
  });

  it("rejects missing, duplicate, padded, and unknown options", () => {
    expect(() => parseC6SourceExpansionScreeningFrameV2CliOptions([]))
      .toThrow("--expected-prior-frame-sha256 is required");
    expect(() => parseC6SourceExpansionScreeningFrameV2CliOptions([
      `--expected-prior-frame-sha256=${"a".repeat(64)}`,
      `--expected-prior-frame-sha256=${"a".repeat(64)}`,
    ])).toThrow("cannot be specified more than once");
    expect(() => parseC6SourceExpansionScreeningFrameV2CliOptions([
      "--prior-frame= padded",
    ])).toThrow("must not be empty or padded");
    expect(() => parseC6SourceExpansionScreeningFrameV2CliOptions([
      "--unknown=value",
    ])).toThrow("unknown C6 source-expansion frame v2 option");
  });
});
