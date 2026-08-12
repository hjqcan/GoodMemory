import { describe, expect, it } from "bun:test";
import { createLanguageService } from "../../src/language";
import {
  resolveTemporalInterval,
  resolveTemporalReference,
} from "../../src/recall/temporalReference";

describe("recall temporal reference resolution", () => {
  const language = createLanguageService();
  const referenceTime = "2026-07-16T15:30:00.000Z";

  const resolve = (text: string, locale: string) => {
    const context = language.resolveFromText({ locale, text });
    return resolveTemporalReference(
      language.parseTemporalExpressions(text, context),
      referenceTime,
    );
  };

  it("performs UTC calendar arithmetic outside the language pack", () => {
    const cases = [
      ["today", "en-US", "2026-07-16T00:00:00.000Z"],
      ["yesterday", "en-US", "2026-07-15T00:00:00.000Z"],
      ["tomorrow", "en-US", "2026-07-17T00:00:00.000Z"],
      ["3 days ago", "en-US", "2026-07-13T00:00:00.000Z"],
      ["next week", "en-US", "2026-07-23T00:00:00.000Z"],
      ["this quarter", "en-US", "2026-07-01T00:00:00.000Z"],
      ["前天", "zh-CN", "2026-07-14T00:00:00.000Z"],
      ["后天", "zh-CN", "2026-07-18T00:00:00.000Z"],
      ["下季度", "zh-CN", "2026-10-01T00:00:00.000Z"],
      ["一昨日", "ja-JP", "2026-07-14T00:00:00.000Z"],
      ["明後日", "ja-JP", "2026-07-18T00:00:00.000Z"],
      ["来月", "ja-JP", "2026-08-01T00:00:00.000Z"],
      ["来年", "ja-JP", "2027-01-01T00:00:00.000Z"],
    ] as const;
    for (const [text, locale, expected] of cases) {
      expect(resolve(text, locale)).toBe(expected);
    }
  });

  it("resolves language-parsed absolute dates without pack-side Date math", () => {
    expect(resolve("March 5, 2026", "en-US")).toBe(
      "2026-03-05T00:00:00.000Z",
    );
    expect(resolve("2026年5月", "zh-TW")).toBe(
      "2026-05-01T00:00:00.000Z",
    );
  });

  it("preserves explicit quarter precision through core resolution", () => {
    const context = language.resolveFromText({
      locale: "en-US",
      text: "Q2 2026",
    });
    const expressions = language.parseTemporalExpressions("Q2 2026", context);

    expect(expressions[0]).toEqual({
      calendar: { month: 4, year: 2026 },
      kind: "absolute",
      precision: "quarter",
      raw: "Q2 2026",
    });
    expect(resolveTemporalInterval(
      expressions,
      "2026-08-12T02:00:00.000Z",
      "Asia/Shanghai",
      "en-US",
    )).toEqual({
      start: "2026-03-31T16:00:00.000Z",
      endExclusive: "2026-06-30T16:00:00.000Z",
      precision: "quarter",
      timezone: "Asia/Shanghai",
    });
  });

  it("resolves relative days as timezone-aware half-open intervals", () => {
    const context = language.resolveFromText({
      locale: "zh-CN",
      text: "昨天",
    });

    expect(resolveTemporalInterval(
      language.parseTemporalExpressions("昨天", context),
      "2026-08-12T02:00:00.000Z",
      "Asia/Shanghai",
      "zh-CN",
    )).toEqual({
      start: "2026-08-10T16:00:00.000Z",
      endExclusive: "2026-08-11T16:00:00.000Z",
      precision: "day",
      timezone: "Asia/Shanghai",
    });
  });

  it("uses calendar boundaries across daylight-saving transitions", () => {
    const expressions = [{
      kind: "relative",
      offset: -1,
      raw: "yesterday",
      unit: "day",
    }] as const;

    expect(resolveTemporalInterval(
      expressions,
      "2026-03-09T16:00:00.000Z",
      "America/New_York",
      "en-US",
    )).toEqual({
      start: "2026-03-08T05:00:00.000Z",
      endExclusive: "2026-03-09T04:00:00.000Z",
      precision: "day",
      timezone: "America/New_York",
    });
    expect(resolveTemporalInterval(
      expressions,
      "2026-11-02T17:00:00.000Z",
      "America/New_York",
      "en-US",
    )).toEqual({
      start: "2026-11-01T04:00:00.000Z",
      endExclusive: "2026-11-02T05:00:00.000Z",
      precision: "day",
      timezone: "America/New_York",
    });
  });

  it("resolves calendar precision and absolute instants", () => {
    expect(resolveTemporalInterval(
      [{
        calendar: { month: 5, year: 2026 },
        kind: "absolute",
        raw: "2026年5月",
      }],
      referenceTime,
      "Asia/Shanghai",
      "zh-CN",
    )).toEqual({
      start: "2026-04-30T16:00:00.000Z",
      endExclusive: "2026-05-31T16:00:00.000Z",
      precision: "month",
      timezone: "Asia/Shanghai",
    });
    expect(resolveTemporalInterval(
      [{
        iso: "2026-08-12T10:00:00+08:00",
        kind: "absolute",
        raw: "time=2026-08-12T10:00:00+08:00",
      }],
      referenceTime,
      "Asia/Shanghai",
      "zh-CN",
    )).toEqual({
      start: "2026-08-12T02:00:00.000Z",
      endExclusive: "2026-08-12T02:00:00.001Z",
      precision: "instant",
      timezone: "Asia/Shanghai",
    });
  });

  it("prioritizes a technical RFC3339 instant in every built-in language pack", () => {
    for (const locale of [
      "en-US",
      "zh-CN",
      "zh-TW",
      "fr-FR",
      "es-ES",
      "ja-JP",
      "ko-KR",
    ]) {
      const text = "time=2026-08-11T03:04:05Z";
      const context = language.resolveFromText({ locale, text });
      const expressions = language.parseTemporalExpressions(text, context);

      expect(expressions, locale).toEqual([{
        iso: "2026-08-11T03:04:05Z",
        kind: "absolute",
        raw: "time=2026-08-11T03:04:05Z",
      }]);
    }
  });

  it("uses the locale first day when resolving week intervals", () => {
    const expressions = [{
      kind: "relative",
      offset: 0,
      raw: "this week",
      unit: "week",
    }] as const;

    expect(resolveTemporalInterval(
      expressions,
      "2026-07-16T15:30:00.000Z",
      "UTC",
      "en-US",
    )?.start).toBe("2026-07-12T00:00:00.000Z");
    expect(resolveTemporalInterval(
      expressions,
      "2026-07-16T15:30:00.000Z",
      "UTC",
      "en-GB",
    )?.start).toBe("2026-07-13T00:00:00.000Z");
  });

  it("fails closed for invalid temporal anchors and timezones", () => {
    const expressions = [{
      kind: "relative",
      offset: -1,
      raw: "yesterday",
      unit: "day",
    }] as const;

    expect(resolveTemporalInterval(
      expressions,
      "2026-08-12",
      "Asia/Shanghai",
      "zh-CN",
    )).toBeUndefined();
    expect(resolveTemporalInterval(
      expressions,
      "2026-08-12T02:00:00.000Z",
      "+08:00",
      "zh-CN",
    )).toBeUndefined();
    expect(resolveTemporalInterval(
      [{
        calendar: { year: Number.NaN },
        kind: "absolute",
        raw: "invalid",
      }],
      "2026-08-12T02:00:00.000Z",
      "Asia/Shanghai",
      "zh-CN",
    )).toBeUndefined();
    expect(resolveTemporalInterval(
      [{
        kind: "relative",
        offset: Number.NaN,
        raw: "invalid",
        unit: "day",
      }],
      "2026-08-12T02:00:00.000Z",
      "Asia/Shanghai",
      "zh-CN",
    )).toBeUndefined();
  });
});
