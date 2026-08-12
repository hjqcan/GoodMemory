import { describe, expect, it } from "bun:test";

import {
  resolveCurrentValuesByGroup,
} from "../../src/answer/currentValueResolution";
import type {
  CurrentValueEntry,
} from "../../src/answer/currentValueResolution";
import { createLanguageService } from "../../src/language";
import {
  fuseGeneralizedRecallCandidates,
} from "../../src/recall/generalizedFusion";
import type {
  GeneralizedFusionInput,
  GeneralizedFusionResult,
} from "../../src/recall/generalizedFusion";
import type {
  ClaimProjection,
  EntityProjection,
  RecallIndexDocument,
} from "../../src/recall/projections/contracts";
import {
  buildDeterministicRecallPlan,
} from "../../src/recall/recallPlan";
import type {
  RecallPlan,
} from "../../src/recall/recallPlan";

const scope = { userId: "user-generalization", workspaceId: "workspace-generalization" };
const scopeKey = "user-generalization::::workspace-generalization::::";
const referenceTime = "2026-07-10T00:00:00.000Z";
const language = createLanguageService({ defaultLocale: "en-US" });

const fusionChannelNames = [
  "dense",
  "entity",
  "lexical",
  "relation",
  "temporal",
] as const;

function buildPlan(query: string, resolvedReferenceTime = referenceTime): RecallPlan {
  return buildDeterministicRecallPlan({
    query,
    referenceTime: resolvedReferenceTime,
    scope,
  });
}

function fuseCandidates(
  input: Omit<
    GeneralizedFusionInput,
    "acceptsEntityCandidate" | "matchesEntityAlias" | "tokenize"
  >,
): GeneralizedFusionResult {
  const context = language.resolveFromText({
    locale: "en-US",
    text: input.query,
  });
  return fuseGeneralizedRecallCandidates({
    ...input,
    acceptsEntityCandidate: (candidate) =>
      language.acceptsEntityCandidate(candidate, context),
    matchesEntityAlias: (query, alias) =>
      language.matchesEntityAlias(query, alias, context),
    tokenize: (text) => language.tokenize(text, context),
  });
}

function document(input: {
  entityKeys?: string[];
  id: string;
  sourceMemoryId: string;
  text: string;
}): RecallIndexDocument {
  const entityKeys = input.entityKeys ?? [];
  return {
    id: input.id,
    schemaVersion: 4,
    ...scope,
    scopeKey,
    sourceCollection: "facts",
    sourceMemoryId: input.sourceMemoryId,
    sourceMemoryType: "fact",
    granularity: "field",
    text: input.text,
    searchText: input.text.toLowerCase(),
    searchLocale: "en-US",
    languagePackId: "en",
    searchAnalyzerVersion: "metamorphic-test-v1",
    searchSchemaVersion: "gm-search-v3",
    entityIds: entityKeys.map((key) => `entity-${key}`),
    entityMentions: entityKeys.map((key) => ({
      canonicalKey: key,
      entityId: `entity-${key}`,
      surface: key[0]!.toUpperCase() + key.slice(1),
    })),
    provenance: { method: "explicit" },
    indexedAt: referenceTime,
  };
}

function entity(input: {
  key: string;
  sourceMemoryIds: string[];
}): EntityProjection {
  return {
    id: `entity-${input.key}`,
    schemaVersion: 2,
    ...scope,
    scopeKey,
    canonicalKey: input.key,
    aliases: [input.key, input.key[0]!.toUpperCase() + input.key.slice(1)],
    memoryIds: input.sourceMemoryIds.map((id) => `facts:${id}`),
    updatedAt: referenceTime,
  };
}

function claim(input: {
  id: string;
  objectEntityId?: string;
  objectText: string;
  observedAt: string;
  polarity?: "negative" | "positive";
  predicateKey: string;
  sourceMemoryId: string;
  subjectEntityId: string;
  validUntil?: string;
}): ClaimProjection {
  return {
    id: input.id,
    schemaVersion: 2,
    ...scope,
    scopeKey,
    sourceMemoryId: input.sourceMemoryId,
    subjectEntityId: input.subjectEntityId,
    predicateKey: input.predicateKey,
    objectText: input.objectText,
    text: `${input.predicateKey} ${input.objectText}`,
    searchText: `${input.predicateKey} ${input.objectText}`.toLowerCase(),
    searchLocale: "en-US",
    languagePackId: "en",
    searchAnalyzerVersion: "metamorphic-test-v1",
    searchSchemaVersion: "gm-search-v3",
    objectEntityId: input.objectEntityId,
    polarity: input.polarity ?? "positive",
    modality: "asserted",
    validUntil: input.validUntil,
    observedAt: input.observedAt,
    ingestedAt: input.observedAt,
    evidenceIds: [`evidence-${input.id}`],
    sourceMessageIds: [`message-${input.id}`],
    extractorVersion: "metamorphic-test-v1",
  };
}

function canonicalFusion(result: GeneralizedFusionResult) {
  return result.rankedCandidates.map((candidate) => ({
    channels: fusionChannelNames.flatMap((name) => {
      const channel = candidate.channels[name];
      return channel
        ? [{
            evidenceDocumentIds: [...channel.evidenceDocumentIds].sort(),
            name,
            rank: channel.rank,
            rawScore: channel.rawScore,
            rrfScore: channel.rrfScore,
          }]
        : [];
    }),
    evidenceStrength: candidate.evidenceStrength,
    score: candidate.score,
    sourceCollection: candidate.sourceCollection,
    sourceMemoryId: candidate.sourceMemoryId,
  }));
}

function timelineFixture() {
  const claims = [
    claim({
      id: "claim-project-legacy",
      objectText: "Legacy",
      observedAt: "2026-06-01T00:00:00.000Z",
      predicateKey: "work.project_assignment",
      sourceMemoryId: "fact-project-legacy",
      subjectEntityId: "entity-alice",
      validUntil: "2026-07-01T00:00:00.000Z",
    }),
    claim({
      id: "claim-project-atlas",
      objectText: "Atlas",
      observedAt: "2026-07-01T00:00:00.000Z",
      predicateKey: "work.project_assignment",
      sourceMemoryId: "fact-project-atlas",
      subjectEntityId: "entity-alice",
    }),
    claim({
      id: "claim-project-beacon",
      objectText: "Beacon",
      observedAt: "2026-07-02T00:00:00.000Z",
      predicateKey: "work.project_assignment",
      sourceMemoryId: "fact-project-beacon",
      subjectEntityId: "entity-alice",
    }),
  ];
  const documents = claims.map((item) => document({
    id: `document-${item.id}`,
    sourceMemoryId: item.sourceMemoryId,
    text: `Alice project assignment ${item.objectText}`,
  }));
  return { claims, documents };
}

describe("Phase 74 metamorphic generalization", () => {
  it.each([
    {
      query: "How many current projects does Atlas have?",
      expectedEntity: "atlas",
    },
    {
      query: "How many current gardens does Beacon have?",
      expectedEntity: "beacon",
    },
    {
      query: "How many current campaigns does Cedar have?",
      expectedEntity: "cedar",
    },
  ])("preserves the plan shape under entity and domain substitution: $query", ({
    expectedEntity,
    query,
  }) => {
    const result = buildPlan(query);

    expect(result).toMatchObject({
      aggregation: "count",
      evidenceNeeds: ["direct", "aggregation", "temporal"],
      maxHops: 1,
      maxRenderedTokens: 6_000,
      planes: ["semantic", "episodic"],
      preRankLimit: 32,
      selectedLimit: 12,
      temporalConstraints: [{ kind: "current", referenceTime }],
      uncertainty: "high",
    });
    expect(result.entities).toEqual([expectedEntity]);
  });

  it("shifts an explicit date boundary without changing temporal selection semantics", () => {
    const run = (input: {
      boundary: string;
      newAt: string;
      oldAt: string;
      suffix: string;
    }) => {
      const oldSourceId = `fact-old-${input.suffix}`;
      const newSourceId = `fact-new-${input.suffix}`;
      const claims = [
        claim({
          id: `claim-old-${input.suffix}`,
          objectText: "planned",
          observedAt: input.oldAt,
          predicateKey: "project.status",
          sourceMemoryId: oldSourceId,
          subjectEntityId: "entity-atlas",
        }),
        claim({
          id: `claim-new-${input.suffix}`,
          objectText: "completed",
          observedAt: input.newAt,
          predicateKey: "project.status",
          sourceMemoryId: newSourceId,
          subjectEntityId: "entity-atlas",
        }),
      ];
      const query = `What was Atlas project status before ${input.boundary}?`;
      const plan = buildPlan(query, `${input.boundary}T00:00:00.000Z`);
      const result = fuseCandidates({
        claims,
        documents: claims.map((item) => document({
          id: `document-${item.id}`,
          sourceMemoryId: item.sourceMemoryId,
          text: `Atlas project status ${item.objectText}`,
        })),
        entities: [],
        maxCandidates: 8,
        plan,
        query,
        referenceTime: `${input.boundary}T00:00:00.000Z`,
      });
      return {
        boundary: plan.temporalConstraints,
        selected: result.candidates.map(({ sourceMemoryId }) =>
          sourceMemoryId.replace(`-${input.suffix}`, "")
        ),
      };
    };

    const original = run({
      boundary: "2025-01-01",
      newAt: "2025-02-01T00:00:00.000Z",
      oldAt: "2024-12-01T00:00:00.000Z",
      suffix: "original",
    });
    const shifted = run({
      boundary: "2027-01-01",
      newAt: "2027-02-01T00:00:00.000Z",
      oldAt: "2026-12-01T00:00:00.000Z",
      suffix: "shifted",
    });

    expect(original.selected).toEqual(["fact-old"]);
    expect(shifted.selected).toEqual(original.selected);
    expect(original.boundary).toEqual([
      { kind: "before", referenceTime: "2025-01-01T00:00:00.000Z" },
    ]);
    expect(shifted.boundary).toEqual([
      { kind: "before", referenceTime: "2027-01-01T00:00:00.000Z" },
    ]);
  });

  it("preserves relation retrieval when the subject and object roles are reversed", () => {
    const run = (subject: string, object: string) => {
      const subjectKey = subject.toLowerCase();
      const objectKey = object.toLowerCase();
      const sourceMemoryId = "fact-team-relationship";
      const query = `How is ${subject} connected to ${object}?`;
      const result = fuseCandidates({
        claims: [claim({
          id: `claim-${subjectKey}-${objectKey}`,
          objectEntityId: `entity-${objectKey}`,
          objectText: object,
          observedAt: "2026-07-01T00:00:00.000Z",
          predicateKey: "team.connected_to",
          sourceMemoryId,
          subjectEntityId: `entity-${subjectKey}`,
        })],
        documents: [document({
          entityKeys: [subjectKey, objectKey],
          id: `document-${subjectKey}-${objectKey}`,
          sourceMemoryId,
          text: `${subject} is connected to ${object} through the same team.`,
        })],
        entities: [
          entity({ key: subjectKey, sourceMemoryIds: [sourceMemoryId] }),
          entity({ key: objectKey, sourceMemoryIds: [sourceMemoryId] }),
        ],
        maxCandidates: 8,
        plan: buildPlan(query),
        query,
        referenceTime,
      });
      return result.rankedCandidates.map((candidate) => ({
        hasRelationEvidence: candidate.channels.relation !== undefined,
        sourceMemoryId: candidate.sourceMemoryId,
      }));
    };

    expect(run("Alice", "Bob")).toEqual([
      { hasRelationEvidence: true, sourceMemoryId: "fact-team-relationship" },
    ]);
    expect(run("Bob", "Alice")).toEqual(run("Alice", "Bob"));
  });

  it("keeps fused membership, scores, and evidence stable when inputs are reordered", () => {
    const { claims, documents } = timelineFixture();
    const query = "What is the history of Alice project assignments?";
    const input = {
      claims,
      denseCandidates: [
        { sourceCollection: "facts" as const, sourceMemoryId: "fact-project-atlas", score: 0.8 },
        { sourceCollection: "facts" as const, sourceMemoryId: "fact-project-beacon", score: 0.9 },
        { sourceCollection: "facts" as const, sourceMemoryId: "fact-project-legacy", score: 0.7 },
      ],
      documents,
      entities: [],
      maxCandidates: 8,
      plan: buildPlan(query),
      query,
      referenceTime,
    };
    const forward = fuseCandidates(input);
    const reordered = fuseCandidates({
      ...input,
      claims: [...claims].reverse(),
      denseCandidates: [...input.denseCandidates].reverse(),
      documents: [...documents].reverse(),
    });

    expect(canonicalFusion(reordered)).toEqual(canonicalFusion(forward));
  });

  it("keeps current, history, and count selection predicate-aware", () => {
    const { claims, documents } = timelineFixture();
    const run = (query: string) => fuseCandidates({
      claims,
      documents,
      entities: [],
      maxCandidates: 8,
      plan: buildPlan(query),
      query,
      referenceTime,
    }).rankedCandidates.map(({ sourceMemoryId }) => sourceMemoryId).sort();

    expect(run("What is Alice's current project assignment?")).toEqual([
      "fact-project-beacon",
    ]);
    expect(run("What is the history of Alice project assignments?")).toEqual([
      "fact-project-atlas",
      "fact-project-beacon",
      "fact-project-legacy",
    ]);
    expect(run("How many current project assignments does Alice have?")).toEqual([
      "fact-project-atlas",
      "fact-project-beacon",
    ]);
  });

  it("does not let a later unrelated distractor displace the current target predicate", () => {
    const { claims, documents } = timelineFixture();
    const query = "What is Alice's current project assignment?";
    const input = {
      claims,
      documents,
      entities: [],
      maxCandidates: 8,
      plan: buildPlan(query),
      query,
      referenceTime,
    };
    const baseline = fuseCandidates(input);
    const withDistractor = fuseCandidates({
      ...input,
      claims: [
        ...claims,
        claim({
          id: "claim-cat-count-old",
          objectText: "2",
          observedAt: "2026-07-08T00:00:00.000Z",
          predicateKey: "profile.cat_count",
          sourceMemoryId: "fact-cat-count-old",
          subjectEntityId: "entity-alice",
        }),
        claim({
          id: "claim-cat-count-new",
          objectText: "3",
          observedAt: "2026-07-09T00:00:00.000Z",
          predicateKey: "profile.cat_count",
          sourceMemoryId: "fact-cat-count-new",
          subjectEntityId: "entity-alice",
        }),
      ],
      documents: [
        ...documents,
        document({
          id: "document-cat-count-old",
          sourceMemoryId: "fact-cat-count-old",
          text: "Alice had two cats.",
        }),
        document({
          id: "document-cat-count-new",
          sourceMemoryId: "fact-cat-count-new",
          text: "Alice currently has three cats.",
        }),
      ],
    });

    expect(baseline.rankedCandidates[0]?.sourceMemoryId).toBe("fact-project-beacon");
    expect(withDistractor.rankedCandidates[0]?.sourceMemoryId).toBe(
      baseline.rankedCandidates[0]?.sourceMemoryId,
    );
    expect(
      withDistractor.rankedCandidates.some(
        ({ sourceMemoryId }) => sourceMemoryId === "fact-project-legacy",
      ),
    ).toBe(false);
    expect(
      withDistractor.rankedCandidates.find(
        ({ sourceMemoryId }) => sourceMemoryId === "fact-cat-count-new",
      )?.channels.temporal,
    ).toBeUndefined();
  });

  it("preserves contradictory-update resolution across entity, domain, and evidence-order changes", () => {
    interface GroupedEntry extends CurrentValueEntry {
      group: string;
    }

    const run = (input: {
      domain: string;
      entityName: string;
      reverse: boolean;
    }) => {
      const entries: GroupedEntry[] = [
        {
          content: `${input.entityName} enabled the ${input.domain}`,
          group: `${input.entityName}:${input.domain}`,
          orderKey: 1,
          polarity: "positive",
          sourceId: "affirmative",
        },
        {
          content: `${input.entityName} never enabled the ${input.domain}`,
          group: `${input.entityName}:${input.domain}`,
          orderKey: 2,
          polarity: "negative",
          sourceId: "retraction",
        },
        {
          content: `${input.entityName} has three unrelated notes`,
          group: `${input.entityName}:note_count`,
          orderKey: 3,
          polarity: "positive",
          sourceId: "unrelated",
        },
      ];
      const resolved = resolveCurrentValuesByGroup(
        input.reverse ? [...entries].reverse() : entries,
        (entry) => entry.group,
      );
      const target = resolved.get(`${input.entityName}:${input.domain}`);
      return {
        contradiction: target?.contradiction,
        current: target?.current?.sourceId,
        history: target?.history.map(({ sourceId }) => sourceId),
        unrelatedCurrent: resolved.get(`${input.entityName}:note_count`)?.current?.sourceId,
      };
    };

    const project = run({ domain: "dark mode", entityName: "Atlas", reverse: false });
    const garden = run({ domain: "watering schedule", entityName: "Cedar", reverse: true });

    expect(project).toEqual({
      contradiction: true,
      current: "retraction",
      history: ["affirmative"],
      unrelatedCurrent: "unrelated",
    });
    expect(garden).toEqual(project);
  });

  it("distinguishes spouse relations from commercial partner API wording", () => {
    const spouseQuery = "How is Alice related to her spouse Bob?";
    const spousePlan = buildPlan(spouseQuery);
    const spouse = fuseCandidates({
      claims: [claim({
        id: "claim-spouse",
        objectEntityId: "entity-bob",
        objectText: "Bob",
        observedAt: "2026-07-01T00:00:00.000Z",
        predicateKey: "relationship.spouse",
        sourceMemoryId: "fact-spouse",
        subjectEntityId: "entity-alice",
      })],
      documents: [document({
        entityKeys: ["alice", "bob"],
        id: "document-spouse",
        sourceMemoryId: "fact-spouse",
        text: "Alice is married to Bob.",
      })],
      entities: [
        entity({ key: "alice", sourceMemoryIds: ["fact-spouse"] }),
        entity({ key: "bob", sourceMemoryIds: ["fact-spouse"] }),
      ],
      maxCandidates: 8,
      plan: spousePlan,
      query: spouseQuery,
      referenceTime,
    });

    const businessQuery = "Which business partner API did Acme use?";
    const businessPlan = buildPlan(businessQuery);
    const business = fuseCandidates({
      claims: [claim({
        id: "claim-partner-api",
        objectEntityId: "entity-northwind",
        objectText: "Northwind",
        observedAt: "2026-07-01T00:00:00.000Z",
        predicateKey: "integration.partner_api",
        sourceMemoryId: "fact-partner-api",
        subjectEntityId: "entity-acme",
      })],
      documents: [document({
        entityKeys: ["acme", "northwind"],
        id: "document-partner-api",
        sourceMemoryId: "fact-partner-api",
        text: "Acme uses the Northwind partner API.",
      })],
      entities: [
        entity({ key: "acme", sourceMemoryIds: ["fact-partner-api"] }),
        entity({ key: "northwind", sourceMemoryIds: ["fact-partner-api"] }),
      ],
      maxCandidates: 8,
      plan: businessPlan,
      query: businessQuery,
      referenceTime,
    });

    expect(spousePlan).toMatchObject({ maxHops: 2 });
    expect(spousePlan.evidenceNeeds).toContain("relation");
    expect(spouse.rankedCandidates[0]?.channels.relation).toBeDefined();
    expect(businessPlan).toMatchObject({
      evidenceNeeds: ["direct"],
      maxHops: 1,
    });
    expect(business.rankedCandidates[0]?.channels.relation).toBeUndefined();
  });
});
