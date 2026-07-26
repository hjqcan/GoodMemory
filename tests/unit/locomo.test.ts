import { describe, expect, it } from "bun:test";

// Drift-attribution fix: seeded turn markers render dates human-readable
// (the upstream "h:mm am/pm on D Month, YYYY" shape) while storage keeps the
// normalized ISO form. The formatter is the exact inverse of
// normalizeLocomoDateTime for upstream inputs.
describe("formatLocomoHumanDateTime", () => {
  it("round-trips the upstream date shape through normalization", async () => {
    const { formatLocomoHumanDateTime, normalizeLocomoDateTime } = await import(
      "../../src/eval/locomo"
    );
    for (const raw of [
      "1:56 pm on 8 May, 2023",
      "7:55 pm on 9 June, 2023",
      "1:14 pm on 25 May, 2023",
      "12:05 am on 1 January, 2024",
      "12:00 pm on 31 December, 2023",
    ]) {
      expect(formatLocomoHumanDateTime(normalizeLocomoDateTime(raw))).toBe(raw);
    }
  });

  it("passes through values that are not normalized ISO timestamps", async () => {
    const { formatLocomoHumanDateTime } = await import("../../src/eval/locomo");
    expect(formatLocomoHumanDateTime("1:56 pm on 8 May, 2023")).toBe(
      "1:56 pm on 8 May, 2023",
    );
    expect(formatLocomoHumanDateTime("unknown")).toBe("unknown");
  });
});
