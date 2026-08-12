import { describe, expect, it } from "bun:test";
import { buildSourceMessageRecord } from "../../src/remember/builders";

describe("source message temporal provenance", () => {
  it("retains the timezone used to interpret relative calendar language", () => {
    const message = {
      content: "我昨天吃了番茄炒蛋",
      id: "message-1",
      observedAt: "2026-08-12T02:00:00.000Z",
      role: "user",
      timezone: "Asia/Shanghai",
    };
    const record = buildSourceMessageRecord(
      { userId: "user-1" },
      message,
      0,
      "2026-08-12T02:00:01.000Z",
    );

    expect(record.timezone).toBe("Asia/Shanghai");
    expect(buildSourceMessageRecord(
      { userId: "user-1" },
      { ...message, timezone: "America/New_York" },
      0,
      "2026-08-12T02:00:01.000Z",
    ).id).not.toBe(record.id);
  });
});
