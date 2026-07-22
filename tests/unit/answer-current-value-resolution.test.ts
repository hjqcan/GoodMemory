import { describe, expect, it } from "bun:test";
import {
  resolveCurrentValue,
  resolveCurrentValuesByGroup,
  type CurrentValueEntry,
} from "../../src/answer/currentValueResolution";

describe("resolveCurrentValue", () => {
  it("returns an empty resolution for no entries", () => {
    const result = resolveCurrentValue([]);
    expect(result.current).toBeNull();
    expect(result.history).toEqual([]);
    expect(result.contradiction).toBe(false);
    expect(result.reason).toBe("empty");
  });

  it("returns the single entry as current with no history", () => {
    const entry: CurrentValueEntry = {
      content: "Uses Postgres",
      orderKey: 1,
      polarity: "positive",
    };
    const result = resolveCurrentValue([entry]);
    expect(result.current).toBe(entry);
    expect(result.history).toEqual([]);
    expect(result.contradiction).toBe(false);
    expect(result.reason).toBe("single");
  });

  it("picks the latest by orderKey and orders history earliest first", () => {
    const result = resolveCurrentValue([
      { content: "Uses SQLite", orderKey: 2, polarity: "positive", sourceId: "b" },
      { content: "Uses in-memory store", orderKey: 1, polarity: "positive", sourceId: "a" },
      { content: "Uses Postgres", orderKey: 3, polarity: "positive", sourceId: "c" },
    ]);
    expect(result.current?.sourceId).toBe("c");
    expect(result.history.map((entry) => entry.sourceId)).toEqual(["a", "b"]);
    expect(result.reason).toBe("update");
    expect(result.contradiction).toBe(false);
  });

  it("breaks orderKey ties by timeAnchor (parseable timestamp wins later)", () => {
    const result = resolveCurrentValue([
      { content: "January value", orderKey: 5, polarity: "positive", timeAnchor: "2026-01-01" },
      { content: "February value", orderKey: 5, polarity: "positive", timeAnchor: "2026-02-01" },
    ]);
    expect(result.current?.content).toBe("February value");
  });

  it("falls back to input order for full ties, so resolution is stable", () => {
    const result = resolveCurrentValue([
      { content: "first", orderKey: 1, polarity: "positive" },
      { content: "second", orderKey: 1, polarity: "positive" },
      { content: "third", orderKey: 1, polarity: "positive" },
    ]);
    expect(result.current?.content).toBe("third");
    expect(result.history.map((entry) => entry.content)).toEqual([
      "first",
      "second",
    ]);
  });

  it("is order-independent: shuffling the input yields the same current value", () => {
    const entries: CurrentValueEntry[] = [
      { content: "v1", orderKey: 1, polarity: "positive" },
      { content: "v2", orderKey: 2, polarity: "positive" },
      { content: "v3", orderKey: 3, polarity: "positive" },
    ];
    const forward = resolveCurrentValue(entries);
    const reversed = resolveCurrentValue([...entries].reverse());
    expect(forward.current?.content).toBe("v3");
    expect(reversed.current?.content).toBe("v3");
  });

  it("treats a clean replacement (latest is affirmative) as an update, not a contradiction", () => {
    const result = resolveCurrentValue([
      { content: "I use React", orderKey: 1, polarity: "positive" },
      { content: "I switched to Vue", orderKey: 2, polarity: "positive" },
    ]);
    expect(result.current?.content).toBe("I switched to Vue");
    expect(result.contradiction).toBe(false);
    expect(result.reason).toBe("update");
  });

  it("flags a contradiction when the latest entry retracts an earlier affirmative", () => {
    const result = resolveCurrentValue([
      { content: "I added the dark mode feature", orderKey: 1, polarity: "positive" },
      { content: "Actually I never added dark mode", orderKey: 2, polarity: "negative" },
    ]);
    expect(result.current?.content).toBe("Actually I never added dark mode");
    expect(result.contradiction).toBe(true);
    expect(result.reason).toBe("contradiction");
  });

  it("uses language-pack polarity instead of an answer-layer lexicon", () => {
    const result = resolveCurrentValue([
      {
        content: "ダークモードを追加しました。",
        orderKey: 1,
        polarity: "positive",
      },
      {
        content: "実際にはダークモードを追加していません。",
        orderKey: 2,
        polarity: "negative",
      },
    ]);

    expect(result.contradiction).toBe(true);
    expect(result.reason).toBe("contradiction");
  });

  it("does not flag a contradiction when every entry is a denial", () => {
    const result = resolveCurrentValue([
      { content: "I have not shipped it", orderKey: 1, polarity: "negative" },
      { content: "Still not shipped", orderKey: 2, polarity: "negative" },
    ]);
    expect(result.current?.content).toBe("Still not shipped");
    expect(result.contradiction).toBe(false);
    expect(result.reason).toBe("update");
  });
});

describe("resolveCurrentValuesByGroup", () => {
  it("resolves the current value within each group and preserves first-appearance order", () => {
    const entries: CurrentValueEntry[] = [
      { content: "DB is MySQL", orderKey: 1, polarity: "positive", sourceId: "db-1" },
      { content: "Editor is Vim", orderKey: 1, polarity: "positive", sourceId: "ed-1" },
      { content: "DB is Postgres", orderKey: 2, polarity: "positive", sourceId: "db-2" },
      { content: "Editor is VS Code", orderKey: 3, polarity: "positive", sourceId: "ed-2" },
    ];
    const keyOf = (entry: CurrentValueEntry) =>
      String(entry.content).startsWith("DB") ? "db" : "editor";
    const resolved = resolveCurrentValuesByGroup(entries, keyOf);

    expect([...resolved.keys()]).toEqual(["db", "editor"]);
    expect(resolved.get("db")?.current?.sourceId).toBe("db-2");
    expect(resolved.get("editor")?.current?.sourceId).toBe("ed-2");
    expect(resolved.get("db")?.history.map((entry) => entry.sourceId)).toEqual([
      "db-1",
    ]);
  });

  it("returns an empty map for no entries", () => {
    const resolved = resolveCurrentValuesByGroup([], () => "k");
    expect(resolved.size).toBe(0);
  });
});
