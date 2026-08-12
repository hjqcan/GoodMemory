import { describe, expect, it } from "bun:test";

import { createMemorySource } from "../../src/domain/provenance";
import { createEvidenceRecord } from "../../src/evidence/contracts";
import {
  buildEvidenceLedger,
  type EvidenceLedgerEntry,
} from "../../src/recall/evidenceLedger";
import type { ClaimProjection } from "../../src/recall/projections/contracts";

const scope = { userId: "user-1", workspaceId: "workspace-1" };
const scopeKey = "user-1::::workspace-1::::";
const referenceTime = "2026-07-10T00:00:00.000Z";

function evidence(memoryId: string) {
  return createEvidenceRecord({
    id: `evidence-${memoryId}`,
    ...scope,
    kind: "conversation_excerpt",
    excerpt: `source for ${memoryId}`,
    source: createMemorySource({
      method: "explicit",
      extractedAt: referenceTime,
    }),
    sourceMessageIds: [`message-${memoryId}`],
    sourceRecordIds: [`source-record-${memoryId}`],
    linkedMemoryIds: [memoryId],
  });
}

function claim(input: {
  id: string;
  sourceMemoryId: string;
  predicateKey: string;
  objectText: string;
  observedAt: string;
  validUntil?: string;
}): ClaimProjection {
  return {
    id: input.id,
    schemaVersion: 2,
    searchText: `${input.predicateKey} ${input.objectText}`.toLowerCase(),
    searchLocale: "en-US",
    languagePackId: "en",
    searchAnalyzerVersion: "test-v1",
    searchSchemaVersion: "gm-search-v3",
    ...scope,
    scopeKey,
    sourceMemoryId: input.sourceMemoryId,
    subjectEntityId: "entity-alice",
    predicateKey: input.predicateKey,
    objectText: input.objectText,
    text: `${input.predicateKey} ${input.objectText}`,
    polarity: "positive",
    modality: "asserted",
    validUntil: input.validUntil,
    observedAt: input.observedAt,
    ingestedAt: input.observedAt,
    evidenceIds: [`evidence-${input.sourceMemoryId}`],
    sourceMessageIds: [`message-${input.sourceMemoryId}`],
    extractorVersion: "test-v1",
  };
}

function byMemory(entries: EvidenceLedgerEntry[]) {
  return new Map(entries.map((entry) => [entry.sourceMemoryId, entry]));
}

describe("evidence ledger", () => {
  it("resolves current and superseded claims within subject and predicate groups", () => {
    const entries = buildEvidenceLedger({
      aggregation: "current",
      claims: [
        claim({
          id: "claim-project-old",
          sourceMemoryId: "project-old",
          predicateKey: "profile.current_project",
          objectText: "Beacon",
          observedAt: "2026-07-01T00:00:00.000Z",
        }),
        claim({
          id: "claim-project-new",
          sourceMemoryId: "project-new",
          predicateKey: "profile.current_project",
          objectText: "Atlas",
          observedAt: "2026-07-08T00:00:00.000Z",
        }),
        claim({
          id: "claim-cats",
          sourceMemoryId: "cats",
          predicateKey: "profile.pet_count",
          objectText: "3",
          observedAt: "2026-07-09T00:00:00.000Z",
        }),
      ],
      evidence: [
        evidence("project-old"),
        evidence("project-new"),
        evidence("cats"),
      ],
      referenceTime,
      selectedMemoryIds: ["project-old", "project-new", "cats"],
    });
    const ledger = byMemory(entries);

    expect(ledger.get("project-old")).toMatchObject({
      relation: "contradicts",
      temporalStatus: "superseded",
    });
    expect(ledger.get("project-new")).toMatchObject({
      relation: "supports",
      temporalStatus: "current",
    });
    expect(ledger.get("cats")).toMatchObject({
      relation: "supports",
      temporalStatus: "current",
    });
  });

  it("does not mark a selected older claim current when its newer group peer was not selected", () => {
    const entries = buildEvidenceLedger({
      aggregation: "current",
      claims: [
        claim({
          id: "claim-project-old",
          sourceMemoryId: "project-old",
          predicateKey: "profile.current_project",
          objectText: "Beacon",
          observedAt: "2026-07-01T00:00:00.000Z",
        }),
        claim({
          id: "claim-project-new",
          sourceMemoryId: "project-new",
          predicateKey: "profile.current_project",
          objectText: "Atlas",
          observedAt: "2026-07-08T00:00:00.000Z",
        }),
      ],
      evidence: [evidence("project-old")],
      referenceTime,
      selectedMemoryIds: ["project-old"],
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      relation: "contradicts",
      sourceMemoryId: "project-old",
      temporalStatus: "superseded",
    });
  });

  it("keeps multiple active values current for count aggregation", () => {
    const entries = buildEvidenceLedger({
      aggregation: "count",
      claims: [
        claim({
          id: "claim-project-atlas",
          sourceMemoryId: "project-atlas",
          predicateKey: "profile.project",
          objectText: "Atlas",
          observedAt: "2026-07-01T00:00:00.000Z",
        }),
        claim({
          id: "claim-project-beacon",
          sourceMemoryId: "project-beacon",
          predicateKey: "profile.project",
          objectText: "Beacon",
          observedAt: "2026-07-02T00:00:00.000Z",
        }),
      ],
      evidence: [evidence("project-atlas"), evidence("project-beacon")],
      referenceTime,
      selectedMemoryIds: ["project-atlas", "project-beacon"],
    });

    expect(entries.map(({ temporalStatus }) => temporalStatus)).toEqual([
      "current",
      "current",
    ]);
  });

  it("retains evidence without a structured claim as uncertain context", () => {
    expect(buildEvidenceLedger({
      claims: [],
      evidence: [evidence("legacy-fact")],
      referenceTime,
      selectedMemoryIds: ["legacy-fact"],
    })).toEqual([
      expect.objectContaining({
        evidenceId: "evidence-legacy-fact",
        sourceMemoryId: "legacy-fact",
        relation: "context",
        temporalStatus: "uncertain",
      }),
    ]);
  });

  it("reports occurrence support separately from claim lifecycle status", () => {
    const occurrence = {
      start: "2026-08-10T16:00:00.000Z",
      endExclusive: "2026-08-11T16:00:00.000Z",
      precision: "day" as const,
      timezone: "Asia/Shanghai",
    };

    expect(buildEvidenceLedger({
      claims: [],
      evidence: [evidence("meal-event")],
      facts: [{ id: "meal-event", occurrence }],
      occurrenceInterval: occurrence,
      referenceTime,
      selectedMemoryIds: ["meal-event"],
    })).toEqual([
      expect.objectContaining({
        evidenceId: "evidence-meal-event",
        occurrence,
        occurrenceMatch: "matched",
        relation: "supports",
        sourceMemoryId: "meal-event",
        temporalStatus: "uncertain",
      }),
    ]);
  });

  it("does not attach a claim through an ambiguous cross-collection raw ID", () => {
    const factClaim = claim({
      id: "claim-shared",
      sourceMemoryId: "shared-id",
      predicateKey: "project.status",
      objectText: "approved",
      observedAt: "2026-07-01T00:00:00.000Z",
    });
    factClaim.evidenceIds = ["fact-only-evidence"];
    const referenceEvidence = createEvidenceRecord({
      id: "reference-only-evidence",
      ...scope,
      kind: "conversation_excerpt",
      excerpt: "The reference is stored in docs/approval.md.",
      source: createMemorySource({
        method: "explicit",
        extractedAt: referenceTime,
      }),
      linkedMemoryIds: ["shared-id"],
    });

    const entries = buildEvidenceLedger({
      ambiguousSourceMemoryIds: ["shared-id"],
      claims: [factClaim],
      evidence: [referenceEvidence],
      referenceTime,
      selectedMemoryIds: ["shared-id", "shared-id"],
    });

    expect(entries).toEqual([
      expect.objectContaining({
        evidenceId: "reference-only-evidence",
        relation: "context",
        sourceMemoryId: "shared-id",
        temporalStatus: "uncertain",
      }),
    ]);
    expect(entries[0]).not.toHaveProperty("claim");
  });

  it("does not attach an evidence-linked claim to a different evidence record", () => {
    const linkedClaim = claim({
      id: "claim-project",
      sourceMemoryId: "project",
      predicateKey: "project.status",
      objectText: "approved",
      observedAt: "2026-07-01T00:00:00.000Z",
    });
    linkedClaim.evidenceIds = ["evidence-from-another-message"];

    expect(buildEvidenceLedger({
      claims: [linkedClaim],
      evidence: [evidence("project")],
      referenceTime,
      selectedMemoryIds: ["project"],
    })).toEqual([
      expect.objectContaining({
        evidenceId: "evidence-project",
        relation: "context",
        temporalStatus: "uncertain",
      }),
    ]);
  });
});
