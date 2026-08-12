import { describe, expect, it } from "bun:test";
import { createLanguageService } from "../../src/language";

import {
  fuseGeneralizedRecallCandidates as fuseGeneralizedRecallCandidatesWithLanguage,
  selectDynamicFusionBudget,
  type GeneralizedFusionCandidate,
  type GeneralizedFusionInput,
} from "../../src/recall/generalizedFusion";
import type {
  ClaimProjection,
  EntityProjection,
  RecallIndexDocument,
  RecallProjectionSourceCollection,
} from "../../src/recall/projections/contracts";
import type { RecallPlan } from "../../src/recall/recallPlan";

const scope = { userId: "user-1", workspaceId: "workspace-1" };
const scopeKey = "user-1::::workspace-1::::";
const language = createLanguageService();

type TestGeneralizedFusionInput = Omit<
  GeneralizedFusionInput,
  "acceptsEntityCandidate" | "matchesEntityAlias" | "tokenize"
> & Partial<Pick<
  GeneralizedFusionInput,
  "acceptsEntityCandidate" | "matchesEntityAlias" | "tokenize"
>>;

function fuseGeneralizedRecallCandidates(
  input: TestGeneralizedFusionInput,
) {
  const context = language.resolveFromText({ text: input.query });
  return fuseGeneralizedRecallCandidatesWithLanguage({
    ...input,
    acceptsEntityCandidate: input.acceptsEntityCandidate ?? ((candidate) =>
      language.acceptsEntityCandidate(candidate, context)),
    matchesEntityAlias: input.matchesEntityAlias ?? ((query, alias) =>
      language.matchesEntityAlias(query, alias, context)),
    tokenize: input.tokenize ?? ((text) =>
      language.tokenize(text, context, { excludeStopwords: true })),
  });
}

function document(input: {
  id: string;
  sourceMemoryId: string;
  text: string;
  entityKeys?: string[];
  sourceCollection?: RecallProjectionSourceCollection;
}): RecallIndexDocument {
  const entityKeys = input.entityKeys ?? [];
  return {
    id: input.id,
    schemaVersion: 4,
    ...scope,
    scopeKey,
    sourceCollection: input.sourceCollection ?? "facts",
    sourceMemoryId: input.sourceMemoryId,
    sourceMemoryType: "fact",
    granularity: "field",
    text: input.text,
    searchText: input.text.toLowerCase(),
    searchLocale: "en-US",
    languagePackId: "en",
    searchAnalyzerVersion: "test-analyzer-v1",
    searchSchemaVersion: "gm-search-v3",
    entityIds: entityKeys.map((key) => `entity-${key}`),
    entityMentions: entityKeys.map((key) => ({
      canonicalKey: key,
      entityId: `entity-${key}`,
      surface: key[0]!.toUpperCase() + key.slice(1),
    })),
    provenance: { method: "explicit" },
    indexedAt: "2026-07-10T00:00:00.000Z",
  };
}

function entity(input: {
  key: string;
  memoryIds: string[];
  aliases?: string[];
  description?: string;
}): EntityProjection {
  return {
    id: `entity-${input.key}`,
    schemaVersion: 2,
    ...scope,
    scopeKey,
    canonicalKey: input.key,
    aliases: input.aliases ?? [input.key],
    description: input.description,
    memoryIds: input.memoryIds,
    updatedAt: "2026-07-10T00:00:00.000Z",
  };
}

function claim(input: {
  id: string;
  objectText: string;
  predicateKey: string;
  sourceMemoryId: string;
  subjectEntityId?: string;
  objectEntityId?: string;
  observedAt?: string;
  validUntil?: string;
  extractorVersion?: string;
}): ClaimProjection {
  return {
    id: input.id,
    schemaVersion: 2,
    ...scope,
    scopeKey,
    sourceMemoryId: input.sourceMemoryId,
    subjectEntityId: input.subjectEntityId ?? "entity-atlas",
    predicateKey: input.predicateKey,
    objectText: input.objectText,
    text: `${input.predicateKey} ${input.objectText}`,
    searchText: `${input.predicateKey} ${input.objectText}`.toLowerCase(),
    searchLocale: "en-US",
    languagePackId: "en",
    searchAnalyzerVersion: "test-analyzer-v1",
    searchSchemaVersion: "gm-search-v3",
    objectEntityId: input.objectEntityId,
    polarity: "positive",
    modality: "asserted",
    validUntil: input.validUntil,
    observedAt: input.observedAt ?? "2026-07-09T00:00:00.000Z",
    ingestedAt: input.observedAt ?? "2026-07-09T00:00:00.000Z",
    evidenceIds: [`evidence-${input.id}`],
    sourceMessageIds: [`message-${input.id}`],
    extractorVersion: input.extractorVersion ?? "test-v1",
  };
}

function plan(input?: Partial<RecallPlan>): RecallPlan {
  return {
    entities: ["atlas", "lisbon"],
    facets: [],
    temporalConstraints: [
      { kind: "current", referenceTime: "2026-07-10T00:00:00.000Z" },
    ],
    aggregation: "current",
    evidenceNeeds: ["direct", "relation", "temporal"],
    planes: ["semantic", "episodic"],
    maxHops: 2,
    preRankLimit: 32,
    selectedLimit: 12,
    maxRenderedTokens: 6_000,
    uncertainty: "high",
    ...input,
  };
}

describe("generalized recall fusion", () => {
  it("deduplicates multi-granular documents by source memory", () => {
    const result = fuseGeneralizedRecallCandidates({
      query: "Atlas migration Paris",
      documents: [
        document({
          id: "doc-memory",
          sourceMemoryId: "fact-atlas",
          text: "Atlas migration starts in Paris.",
        }),
        document({
          id: "doc-sentence",
          sourceMemoryId: "fact-atlas",
          text: "Paris hosts the Atlas migration.",
        }),
        document({
          id: "doc-noise",
          sourceMemoryId: "fact-noise",
          text: "The quarterly budget was approved.",
        }),
      ],
      entities: [],
      maxCandidates: 8,
    });

    expect(result.candidates.map((candidate) => candidate.sourceMemoryId)).toEqual([
      "fact-atlas",
    ]);
    expect(result.candidates[0]?.channels.lexical?.evidenceDocumentIds).toEqual([
      "doc-memory",
      "doc-sentence",
    ]);
  });

  it("drops an entity alias that the scope corpus also uses as a common word", () => {
    const result = fuseGeneralizedRecallCandidates({
      query: "What helps you relax in the evenings?",
      documents: [
        document({
          id: "doc-weak",
          sourceMemoryId: "fact-weak",
          // Sentence-initial capitalization made "Evenings" an entity mention,
          // but the corpus below uses the same word lowercase — a common word,
          // not a name.
          text: "Evenings include a grocery run.",
          entityKeys: ["evenings"],
        }),
        document({
          id: "doc-strong",
          sourceMemoryId: "fact-strong",
          text: "A cup of tea helps Marco relax during quiet evenings.",
          entityKeys: ["marco"],
        }),
      ],
      entities: [
        entity({
          key: "evenings",
          aliases: ["Evenings"],
          memoryIds: ["facts:fact-weak"],
        }),
        entity({
          key: "marco",
          aliases: ["Marco"],
          memoryIds: ["facts:fact-strong"],
        }),
      ],
      maxCandidates: 8,
      acceptsEntityCandidate: (input) =>
        language.acceptsEntityCandidate(input, "en-US"),
    });

    const weak = result.rankedCandidates.find(
      (candidate) => candidate.sourceMemoryId === "fact-weak",
    );
    const strong = result.rankedCandidates.find(
      (candidate) => candidate.sourceMemoryId === "fact-strong",
    );
    // The common-word entity coincidence must not grant an entity channel.
    expect(weak?.channels.entity).toBeUndefined();
    // The true lexical match outranks the capitalization artifact.
    expect(strong?.score ?? 0).toBeGreaterThan(weak?.score ?? 0);
  });

  it("uses lexical, dense, and direct entity adjacency as independent RRF channels", () => {
    const result = fuseGeneralizedRecallCandidates({
      query: "What changed for Atlas?",
      documents: [
        document({
          id: "doc-atlas",
          sourceMemoryId: "fact-atlas",
          text: "Atlas moved from Paris to Lisbon.",
          entityKeys: ["atlas", "paris", "lisbon"],
        }),
        document({
          id: "doc-lexical",
          sourceMemoryId: "fact-lexical",
          text: "Atlas has a generic status update.",
          entityKeys: ["atlas"],
        }),
      ],
      denseCandidates: [
        { sourceCollection: "facts", sourceMemoryId: "fact-atlas", score: 0.9 },
      ],
      entities: [
        entity({
          key: "atlas",
          aliases: ["Atlas"],
          description: "Atlas migration project",
          memoryIds: ["facts:fact-atlas", "facts:fact-lexical"],
        }),
      ],
      maxCandidates: 8,
    });

    expect(result.candidates[0]?.sourceMemoryId).toBe("fact-atlas");
    expect(Object.keys(result.candidates[0]?.channels ?? {}).sort()).toEqual([
      "dense",
      "entity",
      "lexical",
    ]);
    expect(result.candidates[0]?.score).toBeGreaterThan(
      result.candidates[1]?.score ?? 0,
    );
  });

  it("lets the active language pack match an entity inside an unsegmented CJK query", () => {
    const result = fuseGeneralizedRecallCandidates({
      query: "資料庫移行の現在の状態は？",
      documents: [
        document({
          id: "doc-database",
          sourceMemoryId: "fact-database",
          text: "PostgreSQL への移行は進行中です。",
        }),
      ],
      entities: [
        entity({
          key: "資料庫移行",
          aliases: ["資料庫移行"],
          memoryIds: ["facts:fact-database"],
        }),
      ],
      matchesEntityAlias(query, alias) {
        return query.includes(alias);
      },
    });

    expect(result.candidates[0]?.channels.entity).toBeDefined();
  });

  it("does not override entity eligibility decided by the active language pack", () => {
    const result = fuseGeneralizedRecallCandidates({
      query: "zor",
      documents: [
        document({
          id: "doc-zor",
          sourceMemoryId: "fact-zor",
          text: "zor is a valid entity in this language",
        }),
      ],
      entities: [
        entity({
          key: "zor",
          aliases: ["Zor"],
          memoryIds: ["facts:fact-zor"],
        }),
      ],
      acceptsEntityCandidate: () => true,
      matchesEntityAlias: () => true,
    });

    expect(result.candidates[0]?.channels.entity).toBeDefined();
  });

  it("fuses lexical, dense, entity, temporal, and relation candidates globally", () => {
    const input: TestGeneralizedFusionInput = {
      query: "What is Atlas's current relation to Lisbon?",
      documents: [
        document({
          id: "doc-atlas",
          sourceMemoryId: "fact-atlas",
          text: "Atlas currently deploys through Lisbon.",
          entityKeys: ["atlas", "lisbon"],
        }),
      ],
      denseCandidates: [
        { sourceCollection: "facts", sourceMemoryId: "fact-atlas", score: 0.9 },
      ],
      entities: [
        entity({
          key: "atlas",
          aliases: ["Atlas"],
          memoryIds: ["facts:fact-atlas"],
        }),
        entity({
          key: "lisbon",
          aliases: ["Lisbon"],
          memoryIds: ["facts:fact-atlas"],
        }),
      ],
      claims: [
        claim({
          id: "claim-atlas-old",
          sourceMemoryId: "fact-atlas",
          predicateKey: "deployment.relation",
          objectText: "deployed through Paris",
          objectEntityId: "entity-paris",
          observedAt: "2026-06-01T00:00:00.000Z",
          validUntil: "2026-07-01T00:00:00.000Z",
        }),
        claim({
          id: "claim-atlas",
          sourceMemoryId: "fact-atlas",
          predicateKey: "deployment.relation",
          objectText: "deploys through Lisbon",
          objectEntityId: "entity-lisbon",
        }),
      ],
      plan: plan(),
      maxCandidates: 32,
      referenceTime: "2026-07-10T00:00:00.000Z",
    };
    const result = fuseGeneralizedRecallCandidates(input);

    expect(Object.keys(result.candidates[0]?.channels ?? {}).sort()).toEqual([
      "dense",
      "entity",
      "lexical",
      "relation",
      "temporal",
    ]);

    const withoutClaimChannels = fuseGeneralizedRecallCandidates({
      ...input,
      channels: ["lexical", "dense", "entity"],
    });
    expect(
      Object.keys(withoutClaimChannels.candidates[0]?.channels ?? {}).sort(),
    ).toEqual(["dense", "entity", "lexical"]);
  });

  it("requires a query-only relation plan and real claim endpoints", () => {
    const entities = [
      entity({ key: "atlas", aliases: ["Atlas"], memoryIds: [] }),
      entity({ key: "lisbon", aliases: ["Lisbon"], memoryIds: [] }),
    ];
    const edge = claim({
      id: "claim-atlas-lisbon",
      sourceMemoryId: "fact-atlas-lisbon",
      predicateKey: "deployment.location",
      objectText: "Lisbon",
      objectEntityId: "entity-lisbon",
    });
    const directPlan = plan({
      aggregation: undefined,
      evidenceNeeds: ["direct"],
      maxHops: 1,
      temporalConstraints: [],
    });
    const relationPlan = plan({
      aggregation: undefined,
      evidenceNeeds: ["direct", "relation"],
      maxHops: 2,
      temporalConstraints: [],
    });

    const unplannedEdge = fuseGeneralizedRecallCandidates({
      claims: [edge],
      documents: [],
      entities,
      maxCandidates: 8,
      plan: directPlan,
      query: "Why do Atlas and Lisbon appear together?",
      referenceTime: "2026-07-10T00:00:00.000Z",
    });
    expect(unplannedEdge.candidates).toEqual([]);

    const bothEndpoints = fuseGeneralizedRecallCandidates({
      claims: [edge],
      documents: [],
      entities,
      maxCandidates: 8,
      plan: relationPlan,
      query: "How is Atlas connected to Lisbon?",
      referenceTime: "2026-07-10T00:00:00.000Z",
    });
    expect(bothEndpoints.candidates[0]?.channels.relation?.evidenceDocumentIds)
      .toEqual(["claim-atlas-lisbon"]);

    const oneUnanchoredEndpoint = fuseGeneralizedRecallCandidates({
      claims: [edge],
      documents: [],
      entities,
      maxCandidates: 8,
      plan: relationPlan,
      query: "Tell me about Atlas",
      referenceTime: "2026-07-10T00:00:00.000Z",
    });
    expect(oneUnanchoredEndpoint.candidates).toEqual([]);

    const oneAnchoredEndpoint = fuseGeneralizedRecallCandidates({
      claims: [edge],
      documents: [document({
        id: "doc-atlas-lisbon",
        sourceMemoryId: "fact-atlas-lisbon",
        text: "Atlas migration details.",
      })],
      entities,
      maxCandidates: 8,
      plan: relationPlan,
      query: "Tell me about Atlas",
      referenceTime: "2026-07-10T00:00:00.000Z",
    });
    expect(Object.keys(oneAnchoredEndpoint.candidates[0]?.channels ?? {}).sort())
      .toEqual(["lexical", "relation"]);

    const missingObjectEndpoint = fuseGeneralizedRecallCandidates({
      claims: [{ ...edge, objectEntityId: undefined }],
      documents: [],
      entities,
      maxCandidates: 8,
      plan: relationPlan,
      query: "Why do Atlas and Lisbon appear together?",
      referenceTime: "2026-07-10T00:00:00.000Z",
    });
    expect(missingObjectEndpoint.candidates).toEqual([]);
  });

  it("applies language-pack entity eligibility to relation endpoints", () => {
    const result = fuseGeneralizedRecallCandidates({
      acceptsEntityCandidate: () => false,
      claims: [claim({
        id: "claim-atlas-lisbon",
        sourceMemoryId: "fact-atlas-lisbon",
        predicateKey: "deployment.location",
        objectText: "Lisbon",
        objectEntityId: "entity-lisbon",
      })],
      documents: [],
      entities: [
        entity({ key: "atlas", aliases: ["Atlas"], memoryIds: [] }),
        entity({ key: "lisbon", aliases: ["Lisbon"], memoryIds: [] }),
      ],
      maxCandidates: 8,
      plan: plan({
        aggregation: undefined,
        evidenceNeeds: ["direct", "relation"],
        maxHops: 2,
        temporalConstraints: [],
      }),
      query: "How is Atlas connected to Lisbon?",
      referenceTime: "2026-07-10T00:00:00.000Z",
    });

    expect(result.candidates).toEqual([]);
  });

  it("does not retrieve a superseded relation without an explicit validUntil", () => {
    const entities = [
      entity({ key: "acacia", aliases: ["Acacia"], memoryIds: [] }),
      entity({ key: "northwind", aliases: ["Northwind"], memoryIds: [] }),
      entity({ key: "tailspin", aliases: ["Tailspin"], memoryIds: [] }),
    ];
    const claims = [
      claim({
        id: "claim-acacia-northwind",
        sourceMemoryId: "fact-acacia-northwind",
        subjectEntityId: "entity-acacia",
        predicateKey: "integration.vendor",
        objectText: "Northwind",
        objectEntityId: "entity-northwind",
        observedAt: "2026-06-01T00:00:00.000Z",
      }),
      claim({
        id: "claim-acacia-tailspin",
        sourceMemoryId: "fact-acacia-tailspin",
        subjectEntityId: "entity-acacia",
        predicateKey: "integration.vendor",
        objectText: "Tailspin",
        objectEntityId: "entity-tailspin",
        observedAt: "2026-07-01T00:00:00.000Z",
      }),
    ];
    const result = fuseGeneralizedRecallCandidates({
      claims,
      documents: [],
      entities,
      maxCandidates: 8,
      plan: plan({
        aggregation: undefined,
        evidenceNeeds: ["direct", "relation"],
        maxHops: 2,
        temporalConstraints: [],
      }),
      query: "How is Acacia connected to Northwind?",
      referenceTime: "2026-07-10T00:00:00.000Z",
    });

    expect(result.candidates).toEqual([]);
  });

  it("keeps temporal current-value evidence predicate-aware", () => {
    const result = fuseGeneralizedRecallCandidates({
      query: "What is Alice's current project?",
      documents: [
        document({
          id: "doc-project-old",
          sourceMemoryId: "fact-project-old",
          text: "Alice's previous project was Legacy.",
        }),
        document({
          id: "doc-project-new",
          sourceMemoryId: "fact-project-new",
          text: "Alice's current project is Atlas.",
        }),
        document({
          id: "doc-cats",
          sourceMemoryId: "fact-cats",
          text: "Alice currently has three cats.",
        }),
      ],
      entities: [],
      claims: [
        claim({
          id: "claim-project-old",
          sourceMemoryId: "fact-project-old",
          subjectEntityId: "entity-alice",
          predicateKey: "profile.current_project",
          objectText: "Legacy",
          observedAt: "2026-06-01T00:00:00.000Z",
        }),
        claim({
          id: "claim-project-new",
          sourceMemoryId: "fact-project-new",
          subjectEntityId: "entity-alice",
          predicateKey: "profile.current_project",
          objectText: "Atlas",
          observedAt: "2026-07-01T00:00:00.000Z",
        }),
        claim({
          id: "claim-cats",
          sourceMemoryId: "fact-cats",
          subjectEntityId: "entity-alice",
          predicateKey: "profile.pet_count",
          objectText: "3 cats",
          observedAt: "2026-07-09T00:00:00.000Z",
        }),
      ],
      plan: plan({
        entities: ["alice"],
        evidenceNeeds: ["direct", "temporal"],
        maxHops: 1,
      }),
      maxCandidates: 32,
      referenceTime: "2026-07-10T00:00:00.000Z",
    });

    const byId = new Map(
      result.rankedCandidates.map((candidate) => [
        candidate.sourceMemoryId,
        candidate,
      ]),
    );
    expect(byId.has("fact-project-old")).toBe(false);
    expect(
      byId.get("fact-project-new")?.channels.temporal?.evidenceDocumentIds,
    ).toEqual(["claim-project-new"]);
    expect(byId.get("fact-cats")?.channels.temporal).toBeUndefined();
  });

  it("does not let a false count plan promote deterministic singleton claims", () => {
    const input: TestGeneralizedFusionInput = {
      query: "How many project hours were spent?",
      documents: [
        document({
          id: "doc-alpha",
          sourceMemoryId: "fact-alpha",
          text: "Project Alpha hours were spent on testing.",
        }),
        document({
          id: "doc-beta",
          sourceMemoryId: "fact-beta",
          text: "Project Beta hours were spent on design.",
        }),
      ],
      entities: [],
      claims: [
        claim({
          id: "claim-alpha",
          sourceMemoryId: "fact-alpha",
          predicateKey: "fact.unstructured.fact-alpha",
          objectText: "Project Alpha hours were spent on testing.",
          extractorVersion: "deterministic-fact-v1",
        }),
        claim({
          id: "claim-beta",
          sourceMemoryId: "fact-beta",
          predicateKey: "fact.unstructured.fact-beta",
          objectText: "Project Beta hours were spent on design.",
          extractorVersion: "deterministic-fact-v1",
        }),
      ],
      plan: plan({
        aggregation: "count",
        evidenceNeeds: ["aggregation", "direct", "temporal"],
        temporalConstraints: [],
      }),
      maxCandidates: 32,
      referenceTime: "2026-07-10T00:00:00.000Z",
    };

    const withTemporal = fuseGeneralizedRecallCandidates(input);
    const baseOnly = fuseGeneralizedRecallCandidates({
      ...input,
      channels: ["lexical", "dense", "entity"],
    });

    expect(withTemporal.rankedCandidates).toEqual(baseOnly.rankedCandidates);
  });

  it("expands only a base-anchored structured temporal group", () => {
    const result = fuseGeneralizedRecallCandidates({
      query: "What is Atlas's current project status?",
      documents: [
        document({
          id: "doc-status-old",
          sourceMemoryId: "fact-status-old",
          text: "Atlas project status was planned.",
        }),
        document({
          id: "doc-status-new",
          sourceMemoryId: "fact-status-new",
          text: "Opaque source text.",
        }),
        document({
          id: "doc-unrelated-old",
          sourceMemoryId: "fact-unrelated-old",
          text: "Another opaque source text.",
        }),
        document({
          id: "doc-unrelated-new",
          sourceMemoryId: "fact-unrelated-new",
          text: "A separate opaque source text.",
        }),
      ],
      entities: [],
      claims: [
        claim({
          id: "claim-status-old",
          sourceMemoryId: "fact-status-old",
          predicateKey: "project.status",
          objectText: "planned",
          observedAt: "2026-06-01T00:00:00.000Z",
        }),
        claim({
          id: "claim-status-new",
          sourceMemoryId: "fact-status-new",
          predicateKey: "project.status",
          objectText: "completed",
          observedAt: "2026-07-01T00:00:00.000Z",
        }),
        claim({
          id: "claim-unrelated-old",
          sourceMemoryId: "fact-unrelated-old",
          predicateKey: "project.note",
          objectText: "Atlas project status retrospective draft",
          observedAt: "2026-06-01T00:00:00.000Z",
        }),
        claim({
          id: "claim-unrelated-new",
          sourceMemoryId: "fact-unrelated-new",
          predicateKey: "project.note",
          objectText: "Atlas project status retrospective final",
          observedAt: "2026-07-09T00:00:00.000Z",
        }),
      ],
      plan: plan({
        entities: ["atlas"],
        evidenceNeeds: ["direct", "temporal"],
        maxHops: 1,
      }),
      maxCandidates: 32,
      referenceTime: "2026-07-10T00:00:00.000Z",
    });

    expect(result.rankedCandidates.map(({ sourceMemoryId }) => sourceMemoryId))
      .toEqual(["fact-status-new"]);
    expect(result.rankedCandidates[0]?.channels.temporal?.evidenceDocumentIds)
      .toEqual(["claim-status-new"]);
  });

  it("does not let other channels reintroduce an older selected claim group source", () => {
    const result = fuseGeneralizedRecallCandidates({
      query: "What is Alice's current project?",
      documents: [
        document({
          id: "doc-project-old",
          sourceMemoryId: "fact-project-old",
          text: "Alice current project current project Legacy.",
        }),
        document({
          id: "doc-project-new",
          sourceMemoryId: "fact-project-new",
          text: "Alice project Atlas.",
        }),
      ],
      denseCandidates: [
        {
          sourceCollection: "facts",
          sourceMemoryId: "fact-project-old",
          score: 1,
        },
        {
          sourceCollection: "facts",
          sourceMemoryId: "fact-project-new",
          score: 0.2,
        },
      ],
      entities: [
        entity({
          key: "alice",
          memoryIds: ["facts:fact-project-old", "facts:fact-project-new"],
        }),
      ],
      claims: [
        claim({
          id: "claim-project-old",
          sourceMemoryId: "fact-project-old",
          subjectEntityId: "entity-alice",
          predicateKey: "profile.current_project",
          objectText: "Legacy",
          observedAt: "2026-06-01T00:00:00.000Z",
        }),
        claim({
          id: "claim-project-new",
          sourceMemoryId: "fact-project-new",
          subjectEntityId: "entity-alice",
          predicateKey: "profile.current_project",
          objectText: "Atlas",
          observedAt: "2026-07-01T00:00:00.000Z",
        }),
      ],
      plan: plan({
        entities: ["alice"],
        evidenceNeeds: ["direct", "temporal"],
        maxHops: 1,
      }),
      maxCandidates: 8,
      referenceTime: "2026-07-10T00:00:00.000Z",
    });

    expect(
      result.rankedCandidates.map(({ sourceMemoryId }) => sourceMemoryId),
    ).toEqual(["fact-project-new"]);
  });

  it("keeps every active value in a counted claim group", () => {
    const result = fuseGeneralizedRecallCandidates({
      query: "How many current project assignments does Alice have?",
      documents: [
        document({
          id: "doc-project-atlas",
          sourceMemoryId: "fact-project-atlas",
          text: "Alice current project assignment Atlas.",
        }),
        document({
          id: "doc-project-beacon",
          sourceMemoryId: "fact-project-beacon",
          text: "Alice current project assignment Beacon.",
        }),
        document({
          id: "doc-project-legacy",
          sourceMemoryId: "fact-project-legacy",
          text: "Alice current project assignment Legacy.",
        }),
      ],
      denseCandidates: [
        {
          sourceCollection: "facts",
          sourceMemoryId: "fact-project-atlas",
          score: 0.8,
        },
        {
          sourceCollection: "facts",
          sourceMemoryId: "fact-project-beacon",
          score: 0.8,
        },
        {
          sourceCollection: "facts",
          sourceMemoryId: "fact-project-legacy",
          score: 1,
        },
      ],
      entities: [],
      claims: [
        claim({
          id: "claim-project-atlas",
          sourceMemoryId: "fact-project-atlas",
          subjectEntityId: "entity-alice",
          predicateKey: "profile.current_project",
          objectText: "Atlas",
          observedAt: "2026-07-01T00:00:00.000Z",
        }),
        claim({
          id: "claim-project-beacon",
          sourceMemoryId: "fact-project-beacon",
          subjectEntityId: "entity-alice",
          predicateKey: "profile.current_project",
          objectText: "Beacon",
          observedAt: "2026-07-02T00:00:00.000Z",
        }),
        claim({
          id: "claim-project-legacy",
          sourceMemoryId: "fact-project-legacy",
          subjectEntityId: "entity-alice",
          predicateKey: "profile.current_project",
          objectText: "Legacy",
          observedAt: "2026-06-01T00:00:00.000Z",
          validUntil: "2026-07-01T00:00:00.000Z",
        }),
      ],
      plan: plan({
        aggregation: "count",
        entities: ["alice"],
        evidenceNeeds: ["aggregation", "direct", "temporal"],
        maxHops: 1,
      }),
      maxCandidates: 8,
      referenceTime: "2026-07-10T00:00:00.000Z",
    });

    expect(
      result.rankedCandidates.map(({ sourceMemoryId }) => sourceMemoryId).sort(),
    ).toEqual(["fact-project-atlas", "fact-project-beacon"]);
  });

  it("keeps every selected predicate when one source carries multiple histories", () => {
    const result = fuseGeneralizedRecallCandidates({
      query: "How did Atlas status and owner change?",
      documents: [
        document({
          id: "doc-atlas",
          sourceMemoryId: "fact-atlas",
          text: "Atlas status and owner history.",
        }),
      ],
      entities: [],
      claims: [
        claim({
          id: "claim-status-old",
          sourceMemoryId: "fact-atlas",
          predicateKey: "project.status",
          objectText: "planned",
          observedAt: "2026-06-01T00:00:00.000Z",
        }),
        claim({
          id: "claim-status-new",
          sourceMemoryId: "fact-atlas",
          predicateKey: "project.status",
          objectText: "completed",
        }),
        claim({
          id: "claim-owner-old",
          sourceMemoryId: "fact-atlas",
          predicateKey: "project.owner",
          objectText: "Bob",
          observedAt: "2026-06-01T00:00:00.000Z",
        }),
        claim({
          id: "claim-owner-new",
          sourceMemoryId: "fact-atlas",
          predicateKey: "project.owner",
          objectText: "Alice",
        }),
      ],
      plan: plan({
        aggregation: "history",
        temporalConstraints: [{
          kind: "history",
          referenceTime: "2026-07-10T00:00:00.000Z",
        }],
      }),
      maxCandidates: 32,
      referenceTime: "2026-07-10T00:00:00.000Z",
    });

    expect(result.rankedCandidates[0]?.channels.temporal?.evidenceDocumentIds)
      .toEqual([
        "claim-status-old",
        "claim-status-new",
        "claim-owner-old",
        "claim-owner-new",
      ]);
  });

  it("executes before and after boundaries over claim history", () => {
    const claims = [
      claim({
        id: "claim-old",
        sourceMemoryId: "fact-old",
        subjectEntityId: "entity-atlas",
        predicateKey: "project.status",
        objectText: "old",
        observedAt: "2024-12-01T00:00:00.000Z",
      }),
      claim({
        id: "claim-new",
        sourceMemoryId: "fact-new",
        subjectEntityId: "entity-atlas",
        predicateKey: "project.status",
        objectText: "new",
        observedAt: "2025-02-01T00:00:00.000Z",
      }),
    ];
    const documents = claims.map((item) =>
      document({
        id: `doc-${item.id}`,
        sourceMemoryId: item.sourceMemoryId,
        text: `Atlas project status ${item.objectText}`,
      })
    );
    const basePlan = plan({
      entities: ["atlas"],
      evidenceNeeds: ["direct", "temporal"],
      maxHops: 1,
    });

    const before = fuseGeneralizedRecallCandidates({
      claims,
      documents,
      entities: [],
      maxCandidates: 8,
      plan: {
        ...basePlan,
        temporalConstraints: [{
          kind: "before",
          referenceTime: "2025-01-01T00:00:00.000Z",
        }],
      },
      query: "Atlas project status before 2025",
      referenceTime: "2025-01-01T00:00:00.000Z",
    });
    const after = fuseGeneralizedRecallCandidates({
      claims,
      documents,
      entities: [],
      maxCandidates: 8,
      plan: {
        ...basePlan,
        temporalConstraints: [{
          kind: "after",
          referenceTime: "2025-01-01T00:00:00.000Z",
        }],
      },
      query: "Atlas project status after 2025",
      referenceTime: "2025-01-01T00:00:00.000Z",
    });

    expect(before.candidates.map(({ sourceMemoryId }) => sourceMemoryId)).toEqual([
      "fact-old",
    ]);
    expect(after.candidates.map(({ sourceMemoryId }) => sourceMemoryId)).toEqual([
      "fact-new",
    ]);
  });

  it("keeps every selected historical claim attached to one canonical source", () => {
    const claims = [
      claim({
        id: "claim-planned",
        sourceMemoryId: "fact-status",
        predicateKey: "project.status",
        objectText: "planned",
        observedAt: "2024-12-01T00:00:00.000Z",
      }),
      claim({
        id: "claim-completed",
        sourceMemoryId: "fact-status",
        predicateKey: "project.status",
        objectText: "completed",
        observedAt: "2025-02-01T00:00:00.000Z",
      }),
    ];
    const result = fuseGeneralizedRecallCandidates({
      claims,
      documents: [document({
        id: "doc-status",
        sourceMemoryId: "fact-status",
        text: "Atlas project status",
      })],
      entities: [],
      maxCandidates: 8,
      plan: plan({
        aggregation: "change",
        entities: ["atlas"],
        evidenceNeeds: ["direct", "temporal"],
        temporalConstraints: [],
      }),
      query: "How did Atlas project status change from planned to completed?",
      referenceTime: "2026-01-01T00:00:00.000Z",
    });

    expect(result.candidates[0]?.channels.temporal?.evidenceDocumentIds).toEqual([
      "claim-planned",
      "claim-completed",
    ]);
  });

  it("does not expand from a matched entity through a second entity to another memory", () => {
    const result = fuseGeneralizedRecallCandidates({
      query: "Tell me about Atlas",
      documents: [
        document({
          id: "doc-atlas",
          sourceMemoryId: "fact-atlas",
          text: "Migration plan",
        }),
        document({
          id: "doc-lisbon",
          sourceMemoryId: "fact-lisbon",
          text: "Office relocation",
        }),
      ],
      entities: [
        entity({
          key: "atlas",
          memoryIds: ["facts:fact-atlas"],
        }),
        entity({
          key: "lisbon",
          memoryIds: ["facts:fact-atlas", "facts:fact-lisbon"],
        }),
      ],
      maxCandidates: 8,
    });

    expect(result.candidates.map((candidate) => candidate.sourceMemoryId)).toEqual([
      "fact-atlas",
    ]);
  });

  it("does not admit a corpus-wide entity such as a recurring speaker name", () => {
    const documents = Array.from({ length: 20 }, (_, index) =>
      document({
        id: `doc-${index}`,
        sourceMemoryId: `fact-${index}`,
        text: `Unrelated record number ${index}`,
      }),
    );
    const result = fuseGeneralizedRecallCandidates({
      query: "What did Alice decide?",
      documents,
      entities: [
        entity({
          key: "alice",
          aliases: ["Alice"],
          memoryIds: documents.map(
            (projection) => `facts:${projection.sourceMemoryId}`,
          ),
        }),
      ],
      maxCandidates: 8,
    });

    expect(result.candidates).toEqual([]);
  });

  it("matches lowercase multiword aliases without relying on proper-noun extraction", () => {
    const result = fuseGeneralizedRecallCandidates({
      query: "what changed for atlas migration?",
      documents: [
        document({
          id: "doc-atlas",
          sourceMemoryId: "fact-atlas",
          text: "The deployment status changed.",
        }),
      ],
      entities: [
        entity({
          key: "internal-project-key",
          aliases: ["atlas migration"],
          memoryIds: ["facts:fact-atlas"],
        }),
      ],
      maxCandidates: 8,
    });

    expect(result.candidates.map((candidate) => candidate.sourceMemoryId)).toEqual([
      "fact-atlas",
    ]);
    expect(result.candidates[0]?.channels.entity).toBeDefined();
  });

  it("does not treat an unrelated lowercase alias as a query match", () => {
    const result = fuseGeneralizedRecallCandidates({
      query: "what changed for atlas migration?",
      documents: [
        document({
          id: "doc-beacon",
          sourceMemoryId: "fact-beacon",
          text: "Beacon launched yesterday.",
        }),
      ],
      entities: [
        entity({
          key: "internal-project-key",
          aliases: ["beacon rollout"],
          memoryIds: ["facts:fact-beacon"],
        }),
      ],
      maxCandidates: 8,
    });

    expect(result.candidates).toEqual([]);
  });

  it("does not let dense or entity channels readmit a temporally expired source", () => {
    const expired = {
      ...document({
        id: "doc-expired",
        sourceMemoryId: "fact-expired",
        text: "An unrelated archived status.",
      }),
      effectiveUntil: "2026-07-01T00:00:00.000Z",
    };
    const active = document({
      id: "doc-active",
      sourceMemoryId: "fact-active",
      text: "A separate current status.",
    });
    const result = fuseGeneralizedRecallCandidates({
      query: "atlas",
      documents: [expired, active],
      denseCandidates: [
        { sourceCollection: "facts", sourceMemoryId: "fact-expired", score: 1 },
        { sourceCollection: "facts", sourceMemoryId: "fact-active", score: 0.8 },
      ],
      entities: [
        entity({
          key: "atlas",
          memoryIds: ["facts:fact-expired"],
        }),
      ],
      maxCandidates: 8,
      referenceTime: "2026-07-10T00:00:00.000Z",
    });

    expect(result.candidates.map((candidate) => candidate.sourceMemoryId)).toEqual([
      "fact-active",
    ]);
    expect(result.candidates[0]?.channels.dense).toBeDefined();
  });

  it("uses deterministic source identity as the final tie-break", () => {
    const result = fuseGeneralizedRecallCandidates({
      query: "Atlas",
      documents: [],
      denseCandidates: [
        { sourceCollection: "facts", sourceMemoryId: "fact-b", score: 0.8 },
        { sourceCollection: "facts", sourceMemoryId: "fact-a", score: 0.8 },
      ],
      entities: [],
      maxCandidates: 8,
    });

    expect(result.candidates.map((candidate) => candidate.sourceMemoryId)).toEqual([
      "fact-a",
      "fact-b",
    ]);
  });
});

describe("dynamic fusion noise budget", () => {
  function candidate(
    sourceMemoryId: string,
    score: number,
    evidenceStrength: number,
  ): GeneralizedFusionCandidate {
    return {
      sourceCollection: "facts",
      sourceMemoryId,
      score,
      evidenceStrength,
      channels: {
        lexical: {
          evidenceDocumentIds: [`doc-${sourceMemoryId}`],
          rank: 1,
          rawScore: evidenceStrength,
          rrfScore: score,
        },
      },
    };
  }

  it("drops a weak tail instead of always filling the hard cap", () => {
    const selected = selectDynamicFusionBudget(
      [
        candidate("strong-a", 1, 1),
        candidate("strong-b", 0.9, 0.7),
        candidate("weak-a", 0.8, 0.15),
        candidate("weak-b", 0.7, 0.1),
      ],
      { maxCandidates: 8, minRelativeStrength: 0.4 },
    );
    expect(selected.map((entry) => entry.sourceMemoryId)).toEqual([
      "strong-a",
      "strong-b",
    ]);
  });

  it("never exceeds the explicit hard cap", () => {
    const selected = selectDynamicFusionBudget(
      Array.from({ length: 10 }, (_, index) =>
        candidate(`fact-${index}`, 1 - index / 100, 1 - index / 100),
      ),
      { maxCandidates: 3 },
    );
    expect(selected).toHaveLength(3);
  });
});

// R7: opt-in personalized PageRank over the bipartite entity-memory graph as
// the entity channel's scoring. Seeded by query-matched entities; ≤3 damped
// iterations (d=0.5) let mass reach 2-hop associated memories that 1-hop
// adjacency can never admit. Default (flag absent) keeps the historical
// 1-hop rarity channel untouched.
describe("entity PageRank channel (R7)", () => {
  function associationFixture() {
    return {
      query: "What changed for Atlas?",
      documents: [
        document({
          id: "doc-hub",
          sourceMemoryId: "fact-hub",
          text: "Atlas moved to Lisbon last spring.",
          entityKeys: ["atlas", "lisbon"],
        }),
        document({
          id: "doc-detail",
          sourceMemoryId: "fact-detail",
          text: "The riverside office keeps a standing desk reserved.",
          entityKeys: ["lisbon"],
        }),
      ],
      entities: [
        entity({
          key: "atlas",
          aliases: ["Atlas"],
          memoryIds: ["facts:fact-hub"],
        }),
        entity({
          key: "lisbon",
          aliases: ["Lisbon"],
          memoryIds: ["facts:fact-hub", "facts:fact-detail"],
        }),
      ],
      maxCandidates: 8,
    };
  }

  it("admits 2-hop associated memories through damped propagation", () => {
    const result = fuseGeneralizedRecallCandidates({
      ...associationFixture(),
      entityPageRank: true,
    });
    const hub = result.rankedCandidates.find(
      (candidate) => candidate.sourceMemoryId === "fact-hub",
    );
    const detail = result.rankedCandidates.find(
      (candidate) => candidate.sourceMemoryId === "fact-detail",
    );
    expect(hub?.channels.entity).toBeDefined();
    // The associated memory is reachable only through Atlas -> fact-hub ->
    // Lisbon -> fact-detail; PPR admits it on the entity channel.
    expect(detail?.channels.entity).toBeDefined();
    // Directly seeded memories keep more mass than 2-hop associations.
    expect(hub?.channels.entity?.rawScore ?? 0).toBeGreaterThan(
      detail?.channels.entity?.rawScore ?? 0,
    );
  });

  it("keeps the historical 1-hop channel when the flag is absent", () => {
    const result = fuseGeneralizedRecallCandidates(associationFixture());
    const detail = result.rankedCandidates.find(
      (candidate) => candidate.sourceMemoryId === "fact-detail",
    );
    // "lisbon" does not match the query: without PPR the associated memory
    // never earns an entity channel.
    expect(detail?.channels.entity).toBeUndefined();
  });

  it("dampens hub conduits: rare bridges beat high-degree bridges", () => {
    const hubMemoryIds = Array.from(
      { length: 6 },
      (_, index) => `facts:fact-hub-fan-${index}`,
    );
    const result = fuseGeneralizedRecallCandidates({
      query: "What changed for Atlas?",
      documents: [
        document({
          id: "doc-seedmem",
          sourceMemoryId: "fact-seedmem",
          text: "Atlas visited the harbor with Nadia.",
          entityKeys: ["atlas", "nadia", "harbor"],
        }),
        document({
          id: "doc-rare",
          sourceMemoryId: "fact-rare",
          text: "A quiet dinner happened downtown.",
          entityKeys: ["nadia"],
        }),
        ...hubMemoryIds.map((memoryId, index) =>
          document({
            id: `doc-hub-fan-${index}`,
            sourceMemoryId: memoryId.split(":")[1]!,
            text: `Harbor log entry ${index}.`,
            entityKeys: ["harbor"],
          })
        ),
      ],
      entities: [
        entity({
          key: "atlas",
          aliases: ["Atlas"],
          memoryIds: ["facts:fact-seedmem"],
        }),
        entity({
          key: "nadia",
          aliases: ["Nadia"],
          memoryIds: ["facts:fact-seedmem", "facts:fact-rare"],
        }),
        entity({
          key: "harbor",
          aliases: ["Harbor"],
          memoryIds: ["facts:fact-seedmem", ...hubMemoryIds],
        }),
      ],
      maxCandidates: 12,
      entityPageRank: true,
    });
    const rare = result.rankedCandidates.find(
      (candidate) => candidate.sourceMemoryId === "fact-rare",
    );
    const hubFan = result.rankedCandidates.find(
      (candidate) => candidate.sourceMemoryId === "fact-hub-fan-0",
    );
    // Both are 2-hop associations, but the high-degree conduit spreads its
    // mass across six memories: the rare bridge must score higher.
    expect(rare?.channels.entity?.rawScore ?? 0).toBeGreaterThan(
      hubFan?.channels.entity?.rawScore ?? 0,
    );
  });
});
