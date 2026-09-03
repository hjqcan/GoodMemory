import { describe, expect, it } from "bun:test";

import { createFactMemory } from "../../src/domain/records";
import { createMemorySource } from "../../src/domain/provenance";
import { createLanguageService } from "../../src/language";
import {
  LEGACY_RECALL_PROJECTION_COLLECTIONS,
  PROJECTION_SEARCH_SCHEMA_VERSION,
  RECALL_DOCUMENTS_COLLECTION,
  RECALL_PROJECTION_PIPELINE_VERSION,
} from "../../src/recall/projections/contracts";
import { buildRecallIndexDocuments } from "../../src/recall/projections/projector";

describe("event occurrence projection", () => {
  it("moves derived recall documents to the occurrence-aware generation", () => {
    const occurrence = {
      start: "2026-08-10T16:00:00.000Z",
      endExclusive: "2026-08-11T16:00:00.000Z",
      precision: "day" as const,
      timezone: "Asia/Shanghai",
    };
    const fact = createFactMemory({
      id: "event-fact",
      userId: "projection-user",
      category: "event",
      content: "我吃了番茄炒蛋。",
      occurrence,
      source: createMemorySource({
        extractedAt: "2026-08-12T02:00:00.000Z",
        locale: "zh-CN",
        method: "explicit",
      }),
    });
    const documents = buildRecallIndexDocuments({
      collection: "facts",
      document: fact,
      indexedAt: "2026-08-12T03:00:00.000Z",
      language: createLanguageService(),
      sourceMemoryId: fact.id,
    });

    expect(RECALL_DOCUMENTS_COLLECTION).toBe("recall_documents_v4");
    expect(PROJECTION_SEARCH_SCHEMA_VERSION).toBe("gm-search-v3");
    expect(RECALL_PROJECTION_PIPELINE_VERSION).toBe("gm-projection-v6");
    expect(LEGACY_RECALL_PROJECTION_COLLECTIONS).toContain("recall_documents_v3");
    expect(documents.length).toBeGreaterThan(0);
    expect(documents.every((document) =>
      document.schemaVersion === 4 && document.occurrence === occurrence
    )).toBe(true);
  });
});
