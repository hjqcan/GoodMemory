import { describe, expect, it } from "bun:test";
import { createFactMemory } from "../../src/domain/records";

describe("temporal fact record", () => {
  it("retains an event occurrence independently from fact validity", () => {
    const occurrence = {
      endExclusive: "2026-08-11T16:00:00.000Z",
      precision: "day",
      start: "2026-08-10T16:00:00.000Z",
      timezone: "Asia/Shanghai",
    } as const;
    const fact = createFactMemory({
      category: "event",
      content: "我吃了番茄炒蛋。",
      id: "fact-1",
      occurrence,
      source: {
        extractedAt: "2026-08-12T02:00:01.000Z",
        method: "explicit",
      },
      userId: "user-1",
    });

    expect(fact.occurrence).toEqual(occurrence);
    expect(fact.validFrom).toBeUndefined();
    expect(fact.validUntil).toBeUndefined();
  });
});
