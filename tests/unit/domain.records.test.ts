import { describe, expect, it } from "bun:test";
import {
  createEpisodeMemory,
  createFactMemory,
  createFeedbackMemory,
  createPreferenceMemory,
  createReferenceMemory,
  createSessionBuffer,
  createSessionJournal,
  createUserProfile,
  createWorkingMemorySnapshot,
} from "../../src/domain/records";

describe("memory records", () => {
  it("creates semantic records", () => {
    const profile = createUserProfile({
      userId: "u-1",
      identity: { name: "Lin" },
    });
    const preference = createPreferenceMemory({
      id: "pref-1",
      userId: "u-1",
      category: "style",
      value: "concise",
      source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
    });
    const fact = createFactMemory({
      id: "fact-1",
      userId: "u-1",
      category: "project",
      content: "User is building a robot recovery workflow.",
      source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
    });
    const reference = createReferenceMemory({
      id: "ref-1",
      userId: "u-1",
      title: "Grafana board",
      pointer: "grafana.internal/d/api-latency",
      source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
    });

    expect(profile.version).toBe(1);
    expect(preference.evidenceCount).toBe(1);
    expect(fact.isActive).toBe(true);
    expect(reference.pointer).toContain("grafana");
  });

  it("creates episodic records", () => {
    const episode = createEpisodeMemory({
      id: "ep-1",
      userId: "u-1",
      summary: "The user and assistant debugged a migration issue.",
      locale: "zh-CN",
    });

    expect(episode.keyDecisions).toEqual([]);
    expect(episode.unresolvedItems).toEqual([]);
    expect(episode.locale).toBe("zh-CN");
  });

  it("creates procedural records independently of preference or fact", () => {
    const feedback = createFeedbackMemory({
      id: "fb-1",
      userId: "u-1",
      rule: "Prefer concise, code-heavy answers.",
      kind: "prefer",
      source: { method: "confirmed", extractedAt: "2026-01-01T00:00:00.000Z" },
    });

    expect(feedback.kind).toBe("prefer");
    expect(feedback.rule).toContain("concise");
  });

  it("creates runtime records", () => {
    const buffer = createSessionBuffer({
      sessionId: "s-1",
      userId: "u-1",
    });
    const working = createWorkingMemorySnapshot({
      sessionId: "s-1",
      userId: "u-1",
    });
    const journal = createSessionJournal({
      sessionId: "s-1",
      userId: "u-1",
    });

    expect(buffer.messages).toEqual([]);
    expect(working.openLoops).toEqual([]);
    expect(journal.worklog).toEqual([]);
  });
});

describe("v0.8 removed retrieval-exposure telemetry", () => {
  const source = { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" } as const;

  it("never materializes access telemetry on facts", () => {
    const fact = createFactMemory({
      id: "fact-1",
      userId: "u-1",
      category: "project",
      content: "The rollout owner is Nora.",
      source,
    });

    expect("accessCount" in fact).toBe(false);
    expect("lastAccessedAt" in fact).toBe(false);
  });

  it("never materializes usage telemetry on feedback", () => {
    const feedback = createFeedbackMemory({
      id: "feedback-1",
      userId: "u-1",
      rule: "Use bullet points in summaries.",
      kind: "prefer",
      source,
    });

    expect("lastUsedAt" in feedback).toBe(false);
  });
});
