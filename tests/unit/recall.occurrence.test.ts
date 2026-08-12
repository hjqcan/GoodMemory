import { describe, expect, it } from "bun:test";

import { createFactMemory } from "../../src/domain/records";
import { createMemorySource } from "../../src/domain/provenance";
import type { TemporalInterval } from "../../src/domain/temporal";
import {
  filterFactsByOccurrence,
  matchOccurrence,
} from "../../src/recall/occurrence";
import type { TemporalConstraint } from "../../src/recall/recallPlan";

const query: TemporalConstraint = {
  kind: "during",
  interval: {
    start: "2026-08-10T16:00:00.000Z",
    endExclusive: "2026-08-11T16:00:00.000Z",
    precision: "day",
    timezone: "Asia/Shanghai",
  },
};

function fact(
  id: string,
  occurrence?: TemporalInterval,
) {
  return createFactMemory({
    id,
    userId: "temporal-user",
    category: "event",
    content: id,
    source: createMemorySource({
      extractedAt: "2026-08-12T02:00:00.000Z",
      method: "explicit",
    }),
    ...(occurrence ? { occurrence } : {}),
  });
}

describe("event occurrence fence", () => {
  it("admits only occurrences fully contained in an explicit during interval", () => {
    const matching = fact("matching", query.interval);
    const undated = fact("undated");
    const disjoint = fact("disjoint", {
      ...query.interval,
      start: "2026-08-11T16:00:00.000Z",
      endExclusive: "2026-08-12T16:00:00.000Z",
    });
    const partial = fact("partial", {
      ...query.interval,
      start: "2026-08-10T15:00:00.000Z",
    });

    expect(matchOccurrence(matching.occurrence, query.interval)).toBe("matched");
    expect(matchOccurrence(undated.occurrence, query.interval)).toBe("unknown");
    expect(matchOccurrence(disjoint.occurrence, query.interval)).toBe("disjoint");
    expect(matchOccurrence(partial.occurrence, query.interval)).toBe("partial");
    expect(filterFactsByOccurrence(
      [matching, undated, disjoint, partial],
      [query],
    )).toEqual([matching]);
  });

  it("does not alter ordinary recall without a during constraint", () => {
    const facts = [fact("dated", query.interval), fact("undated")];

    expect(filterFactsByOccurrence(facts, [])).toEqual(facts);
  });
});
