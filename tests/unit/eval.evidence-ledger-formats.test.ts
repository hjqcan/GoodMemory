import { describe, expect, it } from "bun:test";

import {
  renderEvidenceLedger,
  selectEvidenceLedgerFormat,
} from "../../src/eval/evidenceLedgerFormats";
import type { EvidenceLedgerEntry } from "../../src/recall/evidenceLedger";

const entries: EvidenceLedgerEntry[] = [
  {
    actor: "Alice",
    evidenceId: "e-2",
    sourceMemoryId: "m-2",
    excerpt: "Atlas replaced Beacon.",
    temporalStatus: "current",
    relation: "supports",
    claim: {
      evidenceIds: ["e-2"],
      extractorVersion: "test-v1",
      id: "claim-2",
      ingestedAt: "2026-07-02T00:00:00.000Z",
      modality: "asserted",
      objectText: "Atlas",
      observedAt: "2026-07-02T00:00:00.000Z",
      polarity: "positive",
      predicateKey: "profile.current_project",
      schemaVersion: 2,
      text: "project.status active",
      searchText: "project status active",
      searchLocale: "en-US",
      languagePackId: "en",
      searchAnalyzerVersion: "test-v1",
      searchSchemaVersion: "gm-search-v3",
      scopeKey: "user-1::::",
      sourceMemoryId: "m-2",
      sourceMessageIds: ["message-2"],
      subjectEntityId: "entity-alice",
      userId: "user-1",
    },
  },
  {
    evidenceId: "e-1",
    sourceMemoryId: "m-1",
    excerpt: "Beacon was the previous project.",
    temporalStatus: "superseded",
    relation: "contradicts",
  },
];

describe("eval evidence ledger formats", () => {
  it("renders each E4 format without benchmark metadata", () => {
    expect(renderEvidenceLedger(entries, "prose")).toContain(
      "profile.current_project",
    );
    expect(renderEvidenceLedger(entries, "chronology")).toContain(
      "Temporal status: superseded.",
    );
    expect(JSON.parse(renderEvidenceLedger(entries, "compact_json"))).toEqual([
      expect.objectContaining({
        actor: "Alice",
        claim: expect.objectContaining({
          object: "Atlas",
          predicate: "profile.current_project",
          subject: "entity-alice",
        }),
        evidenceId: "e-2",
        status: "current",
      }),
      expect.objectContaining({ evidenceId: "e-1", status: "superseded" }),
    ]);
    const localized = JSON.parse(
      renderEvidenceLedger(entries, "json_locale_note", "zh-CN"),
    );
    expect(localized).toMatchObject({ locale: "zh-CN" });
    expect(localized.evidence).toEqual(
      JSON.parse(renderEvidenceLedger(entries, "compact_json")),
    );
  });

  it("rejects protection regressions over one point then uses the one-point token tie-break", () => {
    expect(selectEvidenceLedgerFormat([
      {
        format: "prose",
        macroScore: 0.72,
        protectionDelta: -0.011,
        averageTokens: 300,
      },
      {
        format: "chronology",
        macroScore: 0.71,
        protectionDelta: 0,
        averageTokens: 250,
      },
      {
        format: "compact_json",
        macroScore: 0.705,
        protectionDelta: -0.005,
        averageTokens: 120,
      },
    ])).toBe("compact_json");
  });
});
