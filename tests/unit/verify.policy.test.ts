import { describe, expect, it } from "bun:test";
import {
  createEpisodeMemory,
  createFactMemory,
  createReferenceMemory,
} from "../../src/domain/records";
import {
  evaluateVerificationHints,
} from "../../src/verify/policy";

describe("verification policy", () => {
  it("flags stale action-driving facts for verification", () => {
    const hints = evaluateVerificationHints({
      query: "Proceed with the migration steps using the remembered project status.",
      referenceTime: "2026-04-02T00:00:00.000Z",
      evidenceIdsByMemoryId: {
        "fact-1": ["evidence-fact-1"],
      },
      facts: [
        createFactMemory({
          id: "fact-1",
          userId: "u-1",
          category: "project",
          content: "Robot workflow is blocked on prod migration.",
          source: { method: "explicit", extractedAt: "2025-01-01T00:00:00.000Z" },
          updatedAt: "2025-01-01T00:00:00.000Z",
          createdAt: "2025-01-01T00:00:00.000Z",
        }),
      ],
    });

    expect(hints).toHaveLength(1);
    expect(hints[0]?.memoryId).toBe("fact-1");
    expect(hints[0]?.evidenceIds).toEqual(["evidence-fact-1"]);
    expect(hints[0]?.reason).toContain("stale");
  });

  it("allows fresh explicit facts to pass without verification hints", () => {
    const hints = evaluateVerificationHints({
      query: "Summarize the current project context for me.",
      referenceTime: "2026-04-02T00:00:00.000Z",
      facts: [
        createFactMemory({
          id: "fact-1",
          userId: "u-1",
          category: "project",
          content: "Robot workflow is blocked on prod migration.",
          source: { method: "explicit", extractedAt: "2026-03-30T00:00:00.000Z" },
          updatedAt: "2026-03-30T00:00:00.000Z",
          createdAt: "2026-03-30T00:00:00.000Z",
        }),
      ],
    });

    expect(hints).toHaveLength(0);
  });

  it("does not treat a future-effective fact as stale", () => {
    const hints = evaluateVerificationHints({
      query: "Summarize the future project context for me.",
      referenceTime: "2026-04-02T00:00:00.000Z",
      facts: [
        createFactMemory({
          id: "fact-future",
          userId: "u-1",
          category: "project",
          content: "The migration begins next year.",
          validFrom: "2027-04-02T00:00:00.000Z",
          source: { method: "explicit", extractedAt: "2027-04-02T00:00:00.000Z" },
          createdAt: "2027-04-02T00:00:00.000Z",
          updatedAt: "2027-04-02T00:00:00.000Z",
        }),
      ],
    });

    expect(hints).toHaveLength(0);
  });

  it("keeps metadata-enriched memories stale by their semantic time", () => {
    const hints = evaluateVerificationHints({
      query: "Use the remembered runbook and project history to execute the rollout.",
      referenceTime: "2026-04-10T00:00:00.000Z",
      facts: [
        createFactMemory({
          id: "fact-enriched",
          userId: "u-1",
          category: "project",
          content: "Atlas still uses the legacy deployment path.",
          observedAt: "2025-12-01T00:00:00.000Z",
          source: { method: "explicit", extractedAt: "2026-04-09T00:00:00.000Z" },
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-04-09T00:00:00.000Z",
        }),
      ],
      references: [
        createReferenceMemory({
          id: "reference-enriched",
          userId: "u-1",
          title: "Atlas runbook",
          pointer: "docs/atlas-runbook.md",
          source: { method: "explicit", extractedAt: "2026-04-09T00:00:00.000Z" },
          createdAt: "2025-12-01T00:00:00.000Z",
          updatedAt: "2026-04-09T00:00:00.000Z",
        }),
      ],
      episodes: [
        createEpisodeMemory({
          id: "episode-consolidated",
          userId: "u-1",
          summary: "Atlas rollout review.",
          topics: ["Atlas", "rollout"],
          keyDecisions: [],
          unresolvedItems: [],
          importance: 0.8,
          confidence: 0.9,
          observedAt: "2025-12-01T00:00:00.000Z",
          createdAt: "2026-04-09T00:00:00.000Z",
        }),
      ],
    });

    expect(hints.map(({ memoryId }) => memoryId).sort()).toEqual([
      "episode-consolidated",
      "fact-enriched",
      "reference-enriched",
    ]);
  });

  it("flags inferred facts more aggressively on action-oriented prompts", () => {
    const hints = evaluateVerificationHints({
      query: "Use this memory to decide the next rollout step.",
      referenceTime: "2026-04-02T00:00:00.000Z",
      facts: [
        createFactMemory({
          id: "fact-1",
          userId: "u-1",
          category: "technical",
          content: "The runtime refactor might still be unstable.",
          source: { method: "inferred", extractedAt: "2026-03-31T00:00:00.000Z" },
          updatedAt: "2026-03-31T00:00:00.000Z",
          createdAt: "2026-03-31T00:00:00.000Z",
        }),
      ],
    });

    expect(hints).toHaveLength(1);
    expect(hints[0]?.reason).toContain("inferred");
  });

  it("flags stale references and episodes when they drive action", () => {
    const hints = evaluateVerificationHints({
      query: "Use the remembered runbook and workflow to execute the rollout.",
      referenceTime: "2026-04-02T00:00:00.000Z",
      facts: [],
      references: [
        createReferenceMemory({
          id: "ref-1",
          userId: "u-1",
          title: "Runbook",
          pointer: "docs/runbook.md",
          source: { method: "explicit", extractedAt: "2025-12-01T00:00:00.000Z" },
          createdAt: "2025-12-01T00:00:00.000Z",
          updatedAt: "2025-12-01T00:00:00.000Z",
        }),
      ],
      episodes: [
        createEpisodeMemory({
          id: "ep-1",
          userId: "u-1",
          summary: "Previous rollout used the old checklist and manual verification.",
          topics: ["rollout", "workflow"],
          keyDecisions: [],
          unresolvedItems: [],
          importance: 0.8,
          confidence: 0.9,
          createdAt: "2025-12-15T00:00:00.000Z",
        }),
      ],
    });

    expect(hints.map((hint) => hint.memoryType).sort()).toEqual([
      "episode",
      "reference",
    ]);
  });

  it("flags stale facts for Chinese action-driving prompts", () => {
    const hints = evaluateVerificationHints({
      query: "请使用这些记忆来决定下一步。",
      locale: "zh-CN",
      referenceTime: "2026-04-02T00:00:00.000Z",
      facts: [
        createFactMemory({
          id: "fact-zh-1",
          userId: "u-1",
          category: "project",
          content: "当前阻塞是供应商审批。",
          source: { method: "explicit", extractedAt: "2025-01-01T00:00:00.000Z" },
          updatedAt: "2025-01-01T00:00:00.000Z",
          createdAt: "2025-01-01T00:00:00.000Z",
        }),
      ],
    });

    expect(hints).toHaveLength(1);
    expect(hints[0]?.memoryId).toBe("fact-zh-1");
    expect(hints[0]?.reason).toContain("stale");
  });
});
