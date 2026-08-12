import { describe, expect, it } from "bun:test";
import {
  isIanaTimezone,
  isRfc3339Instant,
} from "../../src/domain/temporal";

describe("temporal domain validation", () => {
  it("accepts only complete, valid RFC 3339 instants", () => {
    expect(isRfc3339Instant("2026-08-12T10:00:00Z")).toBe(true);
    expect(isRfc3339Instant("2026-08-12T10:00:00.123+08:00")).toBe(true);

    for (const value of [
      "2026-08-12",
      "2026-08-12T10:00Z",
      "2026-08-12T10:00:00",
      "2026-02-30T10:00:00Z",
      " 2026-08-12T10:00:00Z",
    ]) {
      expect(isRfc3339Instant(value)).toBe(false);
    }
  });

  it("accepts IANA names but rejects offsets and unknown zones", () => {
    for (const timezone of ["Asia/Shanghai", "America/New_York", "UTC"]) {
      expect(isIanaTimezone(timezone)).toBe(true);
    }
    for (const timezone of ["", "+08:00", "local", "Not/AZone"]) {
      expect(isIanaTimezone(timezone)).toBe(false);
    }
  });
});
