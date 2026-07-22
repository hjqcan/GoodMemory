import { describe, expect, it } from "bun:test";

import {
  renderEvidenceLedgerContext,
} from "../../src/answer/evidenceLedgerContext";
import type { EvidenceLedgerEntry } from "../../src/recall/evidenceLedger";

const entries: EvidenceLedgerEntry[] = [
  {
    actor: "Alice",
    evidenceId: "evidence-current",
    excerpt: "Atlas is now the active project.",
    relation: "supports",
    sourceMemoryId: "memory-current",
    temporalStatus: "current",
    claim: {
      agentId: "agent-1",
      confidence: 0.98,
      evidenceIds: ["evidence-current"],
      extractorVersion: "test-v1",
      id: "claim-current",
      ingestedAt: "2026-07-03T00:00:00.000Z",
      modality: "asserted",
      objectEntityId: "entity-atlas",
      objectText: "Atlas",
      observedAt: "2026-07-03T00:00:00.000Z",
      polarity: "positive",
      predicateKey: "profile.current_project",
      schemaVersion: 2,
      text: "profile.current_project Atlas",
      searchText: "profile current project atlas",
      searchLocale: "en-US",
      languagePackId: "en",
      searchAnalyzerVersion: "test-v1",
      searchSchemaVersion: "gm-search-v2",
      scopeKey: "user-1::::workspace-1::::agent-1",
      sourceMemoryId: "memory-current",
      sourceMessageIds: ["message-current"],
      subjectEntityId: "entity-alice",
      userId: "user-1",
      validFrom: "2026-07-03T00:00:00.000Z",
      workspaceId: "workspace-1",
    },
  },
  {
    evidenceId: "evidence-history-b",
    excerpt: "Beacon was previously active.",
    relation: "contradicts",
    sourceMemoryId: "memory-history-b",
    temporalStatus: "superseded",
    claim: {
      evidenceIds: ["evidence-history-b"],
      extractorVersion: "test-v1",
      id: "claim-history-b",
      ingestedAt: "2026-07-01T00:00:00.000Z",
      modality: "completed",
      objectText: "Beacon",
      observedAt: "2026-07-01T00:00:00.000Z",
      polarity: "negative",
      predicateKey: "profile.current_project",
      schemaVersion: 2,
      text: "profile.current_project Beacon",
      searchText: "profile current project beacon",
      searchLocale: "en-US",
      languagePackId: "en",
      searchAnalyzerVersion: "test-v1",
      searchSchemaVersion: "gm-search-v2",
      scopeKey: "user-1::::workspace-1::::",
      sourceMemoryId: "memory-history-b",
      sourceMessageIds: ["message-history-b"],
      subjectEntityId: "entity-alice",
      userId: "user-1",
      validUntil: "2026-07-03T00:00:00.000Z",
      workspaceId: "workspace-1",
    },
  },
  {
    evidenceId: "evidence-history-a",
    excerpt: "Aurora was also discussed.",
    relation: "context",
    sourceMemoryId: "memory-history-a",
    temporalStatus: "superseded",
    claim: {
      evidenceIds: ["evidence-history-a"],
      extractorVersion: "test-v1",
      id: "claim-history-a",
      ingestedAt: "2026-07-01T00:00:00.000Z",
      modality: "planned",
      objectText: "Aurora",
      observedAt: "2026-07-01T00:00:00.000Z",
      polarity: "positive",
      predicateKey: "profile.current_project",
      schemaVersion: 2,
      text: "profile.current_project Aurora",
      searchText: "profile current project aurora",
      searchLocale: "en-US",
      languagePackId: "en",
      searchAnalyzerVersion: "test-v1",
      searchSchemaVersion: "gm-search-v2",
      scopeKey: "user-1::::workspace-1::::",
      sourceMemoryId: "memory-history-a",
      sourceMessageIds: ["message-history-a"],
      subjectEntityId: "entity-alice",
      userId: "user-1",
      workspaceId: "workspace-1",
    },
  },
];

describe("answer evidence-ledger context", () => {
  it("keeps the same answer-relevant semantics in prose and compact JSON", () => {
    const prose = renderEvidenceLedgerContext(entries, "prose");
    const compact = JSON.parse(
      renderEvidenceLedgerContext(entries, "compact_json"),
    );

    expect(compact[0]).toEqual({
      actor: "Alice",
      claim: {
        modality: "asserted",
        object: "Atlas",
        objectEntityId: "entity-atlas",
        observedAt: "2026-07-03T00:00:00.000Z",
        polarity: "positive",
        predicate: "profile.current_project",
        subject: "entity-alice",
        validFrom: "2026-07-03T00:00:00.000Z",
      },
      evidenceId: "evidence-current",
      excerpt: "Atlas is now the active project.",
      memoryId: "memory-current",
      relation: "supports",
      status: "current",
    });
    for (const value of [
      "Alice",
      "entity-alice",
      "profile.current_project",
      "Atlas",
      "positive",
      "asserted",
      "2026-07-03T00:00:00.000Z",
      "evidence-current",
      "memory-current",
      "supports",
      "current",
    ]) {
      expect(prose).toContain(value);
    }
  });

  it("makes chronology change only the stable entry order", () => {
    const proseLines = renderEvidenceLedgerContext(entries, "prose").split("\n");
    const chronologyLines = renderEvidenceLedgerContext(
      entries,
      "chronology",
    ).split("\n");

    expect([...chronologyLines].sort()).toEqual([...proseLines].sort());
    expect(chronologyLines.map((line) =>
      line.match(/evidence-(?:current|history-[ab])/)?.[0]
    )).toEqual([
      "evidence-history-a",
      "evidence-history-b",
      "evidence-current",
    ]);
  });

  it("adds only a generic locale note around the same JSON evidence", () => {
    const compact = JSON.parse(
      renderEvidenceLedgerContext(entries, "compact_json"),
    );
    const localized = JSON.parse(
      renderEvidenceLedgerContext(entries, "json_locale_note", "zh-CN"),
    );

    expect(localized).toEqual({
      evidence: compact,
      locale: "zh-CN",
      note: "按时间状态和证据关系阅读以下条目。",
    });
    expect(JSON.stringify(localized)).not.toMatch(
      /caseId|expectedAnswer|goldEvidence|questionType|rubric/u,
    );
  });

  it("localizes Traditional Chinese and Japanese evidence guidance", () => {
    const traditional = JSON.parse(
      renderEvidenceLedgerContext(entries, "json_locale_note", "zh-TW"),
    ) as { note: string };
    const japanese = JSON.parse(
      renderEvidenceLedgerContext(entries, "json_locale_note", "ja-JP"),
    ) as { note: string };

    expect(traditional.note).toBe(
      "請按時間狀態和證據關係閱讀以下條目。",
    );
    expect(japanese.note).toBe(
      "各項目を時間状態と根拠関係に従って読んでください。",
    );
    expect(
      renderEvidenceLedgerContext(entries, "prose", "ja-JP"),
    ).toContain("時間状態:");
  });
});
