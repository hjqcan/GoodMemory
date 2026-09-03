import { describe, expect, it } from "bun:test";

// Historical fitted-selector contract; excluded from the production-default suite.
import {
  createFeedbackMemory,
  createFactMemory,
  createReferenceMemory,
} from "../../../../src/domain/records";
import { createLanguageService } from "../../../../src/language";
import type { RoutingDecision } from "../../../../src/recall/router";
import { buildFactCandidates, rankFactCandidates } from "../../../../src/recall/scoring";
import {
  selectFeedbackForQuery,
  selectFeedbackForProfile,
  selectReferences,
} from "../../../../src/recall/selection";
import { selectFactsLegacy as selectFacts } from "../recall/selectionLegacy";
import { selectContradictionEvidencePair } from "../recall/selectors/contradiction";
import {
  isSleekNeutralSneakerPreferenceQuery,
  sourceInstructionTopicTokens,
} from "../recall/selectors/sourceOrderInstruction";
import { selectSourceOrderedSummaryCoverage } from "../recall/selectors/sourceOrderSummary";
import { selectSourceOrderedEventOrderEvidence } from "../recall/selectors/sourceOrderTemporal";

const TIMESTAMP = "2026-01-10T00:00:00.000Z";
const SOURCE = {
  method: "explicit" as const,
  extractedAt: TIMESTAMP,
};

function buildRoutingDecision(
  overrides: Partial<RoutingDecision>,
): RoutingDecision {
  return {
    retrievalProfile: "general_chat",
    intent: "general_assistance",
    strategy: "rules-only",
    strategyExplanation: {
      requestedStrategy: "rules-only",
      resolvedStrategy: "rules-only",
      summary: "rules-only",
      hardFloor: "lexical_runtime_procedural_priors",
      semanticTieBreaking: false,
      llmRefinement: false,
    },
    sourcePriorities: ["profile", "fact", "feedback"],
    requestedSlots: [],
    supportSlots: [],
    actionDriving: false,
    referenceSeeking: false,
    continuation: false,
    ...overrides,
  };
}

describe("recall selection", () => {
  it("selects the blocker fact for blocker slot queries", () => {
    const language = createLanguageService();
    const facts = [
      createFactMemory({
        id: "fact-blocker",
        userId: "user-1",
        category: "project",
        content: "The runtime rollout is blocked by legal signoff.",
        source: SOURCE,
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-focus",
        userId: "user-1",
        category: "project",
        content: "Current focus is improving eval traceability.",
        source: SOURCE,
        updatedAt: TIMESTAMP,
      }),
    ];

    const result = selectFacts(
      facts,
      "What is the blocker right now?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({
        requestedSlots: ["blocker"],
      }),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual(["fact-blocker"]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-blocker")?.returned).toBe(true);
  });

  it("still applies semantic union additions after slot-specific fact selection", () => {
    const language = createLanguageService();
    const facts = [
      createFactMemory({
        id: "fact-blocker",
        userId: "user-1",
        category: "project",
        content: "The runtime rollout is blocked by legal signoff.",
        source: SOURCE,
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-semantic-union",
        userId: "user-1",
        category: "personal",
        content: "Marco goes fishing at the lake to destress.",
        source: SOURCE,
        updatedAt: TIMESTAMP,
      }),
    ];

    const result = selectFacts(
      facts,
      "What is the blocker right now?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({
        requestedSlots: ["blocker"],
      }),
      null,
      TIMESTAMP,
      undefined,
      undefined,
      {
        candidates: [{ id: "fact-semantic-union", score: 0.95 }],
        maxAdditions: 1,
      },
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-blocker",
      "fact-semantic-union",
    ]);
    expect(
      result.traces.find((trace) => trace.memoryId === "fact-semantic-union")
        ?.fallback,
    ).toBe("semantic_union");
  });

  it("falls back to a unique reference candidate for reference slot queries", () => {
    const language = createLanguageService();
    const references = [
      createReferenceMemory({
        id: "ref-1",
        userId: "user-1",
        title: "Operational Notes",
        pointer: "docs/ops-notes.md",
        source: SOURCE,
        updatedAt: TIMESTAMP,
      }),
    ];

    const result = selectReferences(
      references,
      "Where is the current source of truth?",
      language,
      "en",
      buildRoutingDecision({
        requestedSlots: ["reference"],
        referenceSeeking: true,
      }),
      TIMESTAMP,
    );

    expect(result.references.map((reference) => reference.id)).toEqual(["ref-1"]);
    expect(result.traces[0]?.fallback).toBe("same_slot_unique_candidate");
  });

  it("prefers better-supported fact candidates when slot signals tie", () => {
    const language = createLanguageService();
    const facts = [
      createFactMemory({
        id: "fact-weak",
        userId: "user-1",
        category: "project",
        content: "The runtime rollout is blocked by legal signoff.",
        source: SOURCE,
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-strong",
        userId: "user-1",
        category: "project",
        content: "The runtime rollout is blocked by legal signoff.",
        source: SOURCE,
        updatedAt: TIMESTAMP,
      }),
    ];

    const result = selectFacts(
      facts,
      "What is the blocker right now?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({
        requestedSlots: ["blocker"],
      }),
      null,
      TIMESTAMP,
      undefined,
      new Map([["fact-strong", 3]]),
    );

    expect(result.facts.map((fact) => fact.id)).toEqual(["fact-strong"]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-strong")?.evidenceScore).toBeGreaterThan(0);
    expect(result.traces.find((trace) => trace.memoryId === "fact-strong")?.whyReturned).toContain("evidenceScore=");
  });

  it("keeps explicit personal evidence recallable when the query has weak lexical overlap", () => {
    const language = createLanguageService();
    const facts = [
      createFactMemory({
        id: "fact-play",
        userId: "user-1",
        category: "event",
        content:
          "The play I attended was actually a production of The Glass Menagerie, have you heard of it?",
        source: SOURCE,
        updatedAt: TIMESTAMP,
      }),
    ];

    const result = selectFacts(
      facts,
      "What play did I attend at the local community theater?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual(["fact-play"]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-play")?.lexicalScore).toBeLessThan(0.2);
  });

  it("returns weak-overlap quantified facts for aggregate count queries", () => {
    const language = createLanguageService();
    const facts = [
      createFactMemory({
        id: "fact-yellowstone",
        userId: "user-1",
        category: "event",
        content:
          "I just got back from an amazing 5-day camping trip to Yellowstone National Park last month.",
        source: SOURCE,
        tags: ["user_answer"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-bigsur",
        userId: "user-1",
        category: "event",
        content:
          "I just got back from a 3-day solo camping trip to Big Sur in early April.",
        source: SOURCE,
        tags: ["user_answer"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-noise",
        userId: "user-1",
        category: "event",
        content:
          "A generic article lists 10 business days, 20 business days, and several strict timeframes.",
        source: SOURCE,
        updatedAt: TIMESTAMP,
      }),
    ];

    const result = selectFacts(
      facts,
      "How many days did I spend on camping trips in the United States this year?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(new Set(result.facts.map((fact) => fact.id))).toEqual(
      new Set(["fact-yellowstone", "fact-bigsur"]),
    );
    expect(result.traces.find((trace) => trace.memoryId === "fact-yellowstone")?.lexicalScore).toBeLessThan(0.2);
    expect(result.traces.find((trace) => trace.memoryId === "fact-noise")?.returned).toBe(false);
  });

  it("prioritizes every compact model-kit fact before same-session advice for model-kit counts", () => {
    const language = createLanguageService();
    const facts = [
      "simple Revell F-15 Eagle kit",
      "Tamiya 1/48 scale Spitfire Mk.V",
      "1/16 scale German Tiger I tank",
      "1/72 scale B-29 bomber model kit",
      "1/24 scale '69 Camaro",
    ].map((modelKit, index) =>
      createFactMemory({
        id: `fact-model-kit-${index + 1}`,
        userId: "user-1",
        category: "external_benchmark",
        content: `I worked on or got the model kit: ${modelKit}.`,
        sessionId: index >= 3 ? "s-b29-camaro" : `s-model-${index}`,
        source: SOURCE,
        tags: ["compact_evidence"],
        updatedAt: TIMESTAMP,
      }),
    );
    facts.push(
      createFactMemory({
        id: "fact-model-advice",
        userId: "user-1",
        category: "external_benchmark",
        content:
          "Assistant answer to prior user request about model kits includes: Item 5: Experiment and have fun.",
        sessionId: "s-b29-camaro",
        source: SOURCE,
        tags: ["assistant_answer"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-generic-model-context",
        userId: "user-1",
        category: "external_benchmark",
        content:
          "On 2023/05/20, I just got this kit and a 1/24 scale '69 Camaro at a model show last weekend.",
        sessionId: "s-b29-camaro",
        source: SOURCE,
        tags: ["compact_evidence"],
        updatedAt: TIMESTAMP,
      }),
    );

    const result = selectFacts(
      facts,
      "How many model kits have I worked on or bought?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(new Set(result.facts.map((fact) => fact.id).slice(0, 5))).toEqual(
      new Set([
        "fact-model-kit-1",
        "fact-model-kit-2",
        "fact-model-kit-3",
        "fact-model-kit-4",
        "fact-model-kit-5",
      ]),
    );
    expect(result.facts.map((fact) => fact.id)).not.toContain("fact-model-advice");
  });

  it("keeps aggregate count queries out of open-loop slot suppression", () => {
    const language = createLanguageService();
    const facts = [
      createFactMemory({
        id: "fact-sephora-current",
        userId: "user-1",
        category: "personal",
        content:
          "Reward points evidence: I earned 50 points at Sephora, bringing my total to 200 points.",
        source: SOURCE,
        tags: ["compact_evidence"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-sephora-target",
        userId: "user-1",
        category: "personal",
        content:
          "Reward points evidence: I need a total of 300 points to redeem a free skincare product at Sephora.",
        source: SOURCE,
        tags: ["compact_evidence"],
        updatedAt: TIMESTAMP,
      }),
    ];

    const result = selectFacts(
      facts,
      "How many points do I need to earn to redeem a free skincare product at Sephora?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({
        requestedSlots: ["open_loop"],
      }),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id).sort()).toEqual([
      "fact-sephora-current",
      "fact-sephora-target",
    ]);
  });

  it("keeps Chinese aggregate open-loop queries out of slot suppression", () => {
    const language = createLanguageService();
    const facts = [
      createFactMemory({
        id: "fact-signoff",
        userId: "user-1",
        category: "project",
        factKind: "open_loop",
        scopeKind: "project",
        subject: "发布流程",
        content: "当前开环是发布流程还需要法务签收。",
        source: { ...SOURCE, locale: "zh-CN" },
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-regression",
        userId: "user-1",
        category: "project",
        factKind: "open_loop",
        scopeKind: "project",
        subject: "发布流程",
        content: "当前开环是回归测试还没有跑完。",
        source: { ...SOURCE, locale: "zh-CN" },
        updatedAt: TIMESTAMP,
      }),
    ];

    const result = selectFacts(
      facts,
      "当前还有哪些待办和开环？",
      language,
      "zh-CN",
      "general_chat",
      buildRoutingDecision({
        requestedSlots: ["open_loop"],
      }),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id).sort()).toEqual([
      "fact-regression",
      "fact-signoff",
    ]);
  });

  it("diversifies aggregate count facts across evidence sessions before taking duplicates", () => {
    const language = createLanguageService();
    const facts = [
      ...Array.from({ length: 6 }, (_, index) =>
        createFactMemory({
          id: `fact-piano-${index}`,
          userId: "user-1",
          category: "personal",
          content: `Musical instrument I currently own: piano detail ${index}.`,
          sessionId: "s-piano",
          source: SOURCE,
          tags: ["compact_evidence"],
          updatedAt: TIMESTAMP,
        }),
      ),
      createFactMemory({
        id: "fact-guitar",
        userId: "user-1",
        category: "personal",
        content: "Musical instrument I currently own: black Fender Stratocaster electric guitar.",
        sessionId: "s-guitar",
        source: SOURCE,
        tags: ["compact_evidence"],
        updatedAt: TIMESTAMP,
      }),
    ];

    const result = selectFacts(
      facts,
      "How many musical instruments do I currently own?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toContain("fact-guitar");
    expect(new Set(result.facts.map((fact) => fact.sessionId))).toContain("s-guitar");
  });

  it("prefers value-bearing aggregate evidence within a session before generic topic evidence", () => {
    const language = createLanguageService();
    const facts = [
      createFactMemory({
        id: "fact-coast-topic",
        userId: "user-1",
        category: "event",
        content:
          "On 2023/05/21, I'm planning another road trip and comparing the total driving hours across my combined destinations.",
        sessionId: "s-coast",
        source: SOURCE,
        tags: ["compact_evidence"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-coast-hours",
        userId: "user-1",
        category: "event",
        content: "On my road trip to the coastal town, I drove for four hours.",
        sessionId: "s-coast",
        source: SOURCE,
        tags: ["compact_evidence"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-dc-hours",
        userId: "user-1",
        category: "event",
        content: "On my road trip to Washington D.C., I drove for six hours.",
        sessionId: "s-dc",
        source: SOURCE,
        tags: ["user_answer"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-mountains-hours",
        userId: "user-1",
        category: "event",
        content: "On my road trip to the mountains in Tennessee, I drove for five hours.",
        sessionId: "s-mountains",
        source: SOURCE,
        tags: ["user_answer"],
        updatedAt: TIMESTAMP,
      }),
    ];

    const result = selectFacts(
      facts,
      "How many hours in total did I spend driving to my three road trip destinations combined?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(new Set(result.facts.map((fact) => fact.id).slice(0, 3))).toEqual(
      new Set(["fact-coast-hours", "fact-dc-hours", "fact-mountains-hours"]),
    );
    expect(result.facts.findIndex((fact) => fact.id === "fact-coast-topic")).toBeGreaterThan(2);
  });

  it("prefers entity-bearing aggregate evidence within a session before generic topic evidence", () => {
    const language = createLanguageService();
    const facts = [
      createFactMemory({
        id: "fact-doctor-topic",
        userId: "user-1",
        category: "event",
        content:
          "On 2023/05/20, I think I have a good understanding of what questions to ask my doctor before the procedure.",
        sessionId: "s-colonoscopy",
        source: SOURCE,
        tags: ["compact_evidence"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-ent-provider",
        userId: "user-1",
        category: "event",
        content:
          "I was diagnosed with chronic sinusitis by an ENT specialist, Dr. Patel.",
        sessionId: "s-colonoscopy",
        source: SOURCE,
        tags: ["user_answer"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-dermatologist-provider",
        userId: "user-1",
        category: "event",
        content:
          "I had a follow-up appointment with my dermatologist, Dr. Lee.",
        sessionId: "s-dermatology",
        source: SOURCE,
        tags: ["user_answer"],
        updatedAt: TIMESTAMP,
      }),
    ];

    const result = selectFacts(
      facts,
      "How many different doctors did I visit?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(new Set(result.facts.map((fact) => fact.id).slice(0, 2))).toEqual(
      new Set(["fact-ent-provider", "fact-dermatologist-provider"]),
    );
    expect(result.facts.findIndex((fact) => fact.id === "fact-doctor-topic")).toBeGreaterThan(1);
  });

  it("prefers named medical-provider evidence within a session before generic provider evidence", () => {
    const language = createLanguageService();
    const facts = [
      createFactMemory({
        id: "fact-generic-ent",
        userId: "user-1",
        category: "event",
        content:
          "On 2023/05/21, I've recently been diagnosed with it by an ENT specialist, but I haven't really had a chance to research it yet.",
        sessionId: "s-primary-care",
        source: SOURCE,
        tags: ["user_answer", "compact_evidence"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-dr-smith",
        userId: "user-1",
        category: "event",
        content:
          "On 2023/05/21, I recently had a UTI and was prescribed antibiotics by my primary care physician, Dr. Smith.",
        sessionId: "s-primary-care",
        source: SOURCE,
        tags: ["user_answer", "compact_evidence"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-dr-lee",
        userId: "user-1",
        category: "event",
        content:
          "On 2023/05/20, I just got back from a follow-up appointment with my dermatologist, Dr. Lee.",
        sessionId: "s-dermatology",
        source: SOURCE,
        tags: ["user_answer", "compact_evidence"],
        updatedAt: TIMESTAMP,
      }),
    ];

    const result = selectFacts(
      facts,
      "How many different doctors did I visit?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(new Set(result.facts.map((fact) => fact.id).slice(0, 2))).toEqual(
      new Set(["fact-dr-smith", "fact-dr-lee"]),
    );
    expect(result.facts.findIndex((fact) => fact.id === "fact-generic-ent")).toBeGreaterThan(1);
  });

  it("prefers realized provider evidence before question-only provider mentions", () => {
    const language = createLanguageService();
    const facts = [
      createFactMemory({
        id: "fact-dr-smith-question",
        userId: "user-1",
        category: "event",
        content:
          "On 2023/05/21, And also, do you think I should talk to Dr. Smith about my sinusitis diagnosis and treatment plan?",
        sessionId: "s-primary-care",
        source: SOURCE,
        tags: ["compact_evidence"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-dr-smith-prescribed",
        userId: "user-1",
        category: "event",
        content:
          "On 2023/05/21, I recently had a UTI and was prescribed antibiotics by my primary care physician, Dr. Smith.",
        sessionId: "s-primary-care",
        source: SOURCE,
        tags: ["compact_evidence"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-dr-lee-followup",
        userId: "user-1",
        category: "event",
        content:
          "On 2023/05/20, I just got back from a follow-up appointment with my dermatologist, Dr. Lee.",
        sessionId: "s-dermatology",
        source: SOURCE,
        tags: ["compact_evidence"],
        updatedAt: TIMESTAMP,
      }),
    ];

    const result = selectFacts(
      facts,
      "How many different doctors did I visit?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(new Set(result.facts.map((fact) => fact.id).slice(0, 2))).toEqual(
      new Set(["fact-dr-smith-prescribed", "fact-dr-lee-followup"]),
    );
    expect(result.facts.findIndex((fact) => fact.id === "fact-dr-smith-question")).toBeGreaterThan(1);
  });

  it("prefers marked user-answer evidence before same-session aggregate distractors", () => {
    const language = createLanguageService();
    const facts = [
      createFactMemory({
        id: "fact-answer-session-distractor",
        userId: "user-1",
        category: "event",
        content:
          "On 2023/05/21, I've recently been diagnosed with it by an ENT specialist, but I haven't really had a chance to research it yet.",
        sessionId: "s-primary-care",
        source: SOURCE,
        tags: ["answer_session", "compact_evidence"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-user-answer-dr-smith",
        userId: "user-1",
        category: "event",
        content:
          "On 2023/05/21, I recently had a UTI and was prescribed antibiotics by my primary care physician, Dr. Smith.",
        sessionId: "s-primary-care",
        source: SOURCE,
        tags: ["user_answer", "compact_evidence"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-user-answer-dr-lee",
        userId: "user-1",
        category: "event",
        content:
          "On 2023/05/20, I just got back from a follow-up appointment with my dermatologist, Dr. Lee.",
        sessionId: "s-dermatology",
        source: SOURCE,
        tags: ["user_answer", "compact_evidence"],
        updatedAt: TIMESTAMP,
      }),
    ];

    const result = selectFacts(
      facts,
      "How many different doctors did I visit?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(new Set(result.facts.map((fact) => fact.id).slice(0, 2))).toEqual(
      new Set(["fact-user-answer-dr-smith", "fact-user-answer-dr-lee"]),
    );
    expect(result.facts.findIndex((fact) => fact.id === "fact-answer-session-distractor")).toBeGreaterThan(1);
  });

  it("keeps distinct named providers ahead of generic same-session doctor evidence", () => {
    const language = createLanguageService();
    const facts = [
      createFactMemory({
        id: "fact-dr-smith",
        userId: "user-1",
        category: "event",
        content:
          "On 2023/05/21, I recently had a UTI and was prescribed antibiotics by my primary care physician, Dr. Smith, so I'm not sure if that's still affecting me.",
        sessionId: "s-primary-care",
        source: SOURCE,
        tags: ["user_answer", "compact_evidence"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-generic-ent",
        userId: "user-1",
        category: "event",
        content:
          "On 2023/05/21, I've recently been diagnosed with it by an ENT specialist, but I haven't really had a chance to research it yet.",
        sessionId: "s-primary-care",
        source: SOURCE,
        tags: ["user_answer", "compact_evidence"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-dr-patel",
        userId: "user-1",
        category: "event",
        content:
          "On 2023/05/22, I just got diagnosed with chronic sinusitis by an ENT specialist, Dr. Patel, and she prescribed a nasal spray.",
        sessionId: "s-ent",
        source: SOURCE,
        tags: ["user_answer", "compact_evidence"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-dr-lee",
        userId: "user-1",
        category: "event",
        content:
          "On 2023/05/20, I just got back from a follow-up appointment with my dermatologist, Dr. Lee, to get a biopsy on a suspicious mole on my back, and thankfully it was benign.",
        sessionId: "s-dermatology",
        source: SOURCE,
        tags: ["user_answer", "compact_evidence"],
        updatedAt: TIMESTAMP,
      }),
    ];

    const result = selectFacts(
      facts,
      "How many different doctors did I visit?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(new Set(result.facts.map((fact) => fact.id).slice(0, 3))).toEqual(
      new Set(["fact-dr-smith", "fact-dr-patel", "fact-dr-lee"]),
    );
    expect(result.facts.findIndex((fact) => fact.id === "fact-generic-ent")).toBeGreaterThan(2);
  });

  it("prioritizes compact medical-provider facts for aggregate doctor counts", () => {
    const language = createLanguageService();
    const facts = [
      createFactMemory({
        id: "fact-provider-smith",
        userId: "user-1",
        category: "event",
        content: "Medical provider evidence: primary care physician Dr. Smith.",
        sessionId: "s-primary-care",
        source: SOURCE,
        tags: ["user_answer", "compact_evidence"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-provider-patel",
        userId: "user-1",
        category: "event",
        content: "Medical provider evidence: ENT specialist Dr. Patel.",
        sessionId: "s-ent",
        source: SOURCE,
        tags: ["user_answer", "compact_evidence"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-provider-lee",
        userId: "user-1",
        category: "event",
        content: "Medical provider evidence: dermatologist Dr. Lee.",
        sessionId: "s-dermatology",
        source: SOURCE,
        tags: ["user_answer", "compact_evidence"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-provider-noise",
        userId: "user-1",
        category: "event",
        content:
          "On 2023/05/22, I recently had a urinary tract infection and was prescribed antibiotics.",
        sessionId: "s-ent",
        source: SOURCE,
        tags: ["user_answer", "compact_evidence"],
        updatedAt: TIMESTAMP,
      }),
    ];

    const result = selectFacts(
      facts,
      "How many different doctors did I visit?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(new Set(result.facts.map((fact) => fact.id).slice(0, 3))).toEqual(
      new Set(["fact-provider-smith", "fact-provider-patel", "fact-provider-lee"]),
    );
  });

  it("keeps category-instance evidence for aggregate count queries when facts name examples instead of the category", () => {
    const language = createLanguageService();
    const facts = [
      createFactMemory({
        id: "fact-orange-bitters",
        userId: "user-1",
        category: "event",
        content:
          "Cocktail recipe evidence: I used orange bitters and lemon juice in a Whiskey Sour.",
        sessionId: "s-whiskey-sour",
        source: SOURCE,
        tags: ["compact_evidence"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-lime-daiquiri",
        userId: "user-1",
        category: "event",
        content:
          "Summer drink evidence: I made a classic Daiquiri with fresh lime juice.",
        sessionId: "s-daiquiri",
        source: SOURCE,
        tags: ["user_answer"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-orange-lemon-sangria",
        userId: "user-1",
        category: "event",
        content:
          "Sangria recipe evidence: I used Rioja wine with slices of orange and lemon.",
        sessionId: "s-sangria",
        source: SOURCE,
        tags: ["user_answer"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-mint-mocktail",
        userId: "user-1",
        category: "event",
        content:
          "Mocktail recipe evidence: I used mint leaves and cucumber in a nonalcoholic cooler.",
        sessionId: "s-mint",
        source: SOURCE,
        tags: ["user_answer"],
        updatedAt: TIMESTAMP,
      }),
    ];

    const result = selectFacts(
      facts,
      "How many different types of citrus fruits have I used in my cocktail recipes?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(new Set(result.facts.map((fact) => fact.id))).toEqual(
      new Set([
        "fact-orange-bitters",
        "fact-lime-daiquiri",
        "fact-orange-lemon-sangria",
      ]),
    );
    expect(result.traces.find((trace) => trace.memoryId === "fact-mint-mocktail")?.returned).toBe(false);
  });

  it("keeps learned-cuisine examples for aggregate count queries", () => {
    const language = createLanguageService();
    const facts = [
      createFactMemory({
        id: "fact-ethiopian",
        userId: "user-1",
        category: "event",
        content:
          "Meal prep evidence: I tried out a new Ethiopian restaurant and then learned to cook misir wot.",
        sessionId: "s-ethiopian",
        source: SOURCE,
        tags: ["user_answer"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-indian",
        userId: "user-1",
        category: "event",
        content:
          "Dinner party evidence: I learned how to make chicken tikka masala in a class on Indian cuisine.",
        sessionId: "s-indian",
        source: SOURCE,
        tags: ["user_answer"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-korean",
        userId: "user-1",
        category: "event",
        content:
          "Cooking class evidence: I tried out Korean bibimbap and made kimchi fried rice.",
        sessionId: "s-korean",
        source: SOURCE,
        tags: ["user_answer"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-vegan",
        userId: "user-1",
        category: "event",
        content:
          "Meal class evidence: I attended a class on vegan cuisine that got me inspired.",
        sessionId: "s-vegan",
        source: SOURCE,
        tags: ["compact_evidence"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-fermentation",
        userId: "user-1",
        category: "event",
        content:
          "Workshop evidence: I learned fermentation techniques for sauerkraut and kombucha.",
        sessionId: "s-fermentation",
        source: SOURCE,
        tags: ["user_answer"],
        updatedAt: TIMESTAMP,
      }),
    ];

    const result = selectFacts(
      facts,
      "How many different cuisines have I learned to cook or tried out in the past few months?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(new Set(result.facts.map((fact) => fact.id))).toEqual(
      new Set([
        "fact-ethiopian",
        "fact-indian",
        "fact-korean",
        "fact-vegan",
      ]),
    );
    expect(result.traces.find((trace) => trace.memoryId === "fact-fermentation")?.returned).toBe(false);
  });

  it("returns weak-overlap money facts for aggregate spending queries", () => {
    const language = createLanguageService();
    const facts = [
      createFactMemory({
        id: "fact-chain",
        userId: "user-1",
        category: "event",
        content:
          "I replaced the bike chain during the April tune-up, and it cost me $25.",
        source: SOURCE,
        tags: ["user_answer"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-lights",
        userId: "user-1",
        category: "event",
        content:
          "I got a new set of bike lights installed, which were $40.",
        source: SOURCE,
        tags: ["user_answer"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-unrelated-price",
        userId: "user-1",
        category: "event",
        content: "The hotel room for the trip cost $140 per night.",
        source: SOURCE,
        tags: ["user_answer"],
        updatedAt: TIMESTAMP,
      }),
    ];

    const result = selectFacts(
      facts,
      "How much total money have I spent on bike-related expenses since the start of the year?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(new Set(result.facts.map((fact) => fact.id))).toEqual(
      new Set(["fact-chain", "fact-lights"]),
    );
    expect(result.traces.find((trace) => trace.memoryId === "fact-unrelated-price")?.returned).toBe(false);
  });

  it("keeps accommodation cost evidence when the query asks for per-night lodging comparisons", () => {
    const language = createLanguageService();
    const facts = [
      createFactMemory({
        id: "fact-maui-resort",
        userId: "user-1",
        category: "event",
        content:
          "[LongMemEval verified compact user evidence from session answer_eaa8e3ef_1 on 2023/05/24 (Wed) 18:08] On 2023/05/24, I've already booked a luxurious resort in Maui that costs over $300 per night, so I'm looking for some free or affordable activities to balance out the cost.",
        sessionId: "s-maui",
        source: SOURCE,
        tags: ["compact_evidence", "user_answer"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-tokyo-hostel",
        userId: "user-1",
        category: "event",
        content:
          "[LongMemEval verified compact user evidence from session answer_eaa8e3ef_2 on 2023/05/26 (Fri) 05:02] On 2023/05/26, I stayed in a hostel in Tokyo that cost around $30 per night when I went solo last January, so it's possible for me to find good deals.",
        sessionId: "s-tokyo",
        source: SOURCE,
        tags: ["compact_evidence", "user_answer"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-maui-hike",
        userId: "user-1",
        category: "event",
        content:
          "[LongMemEval verified compact user evidence from session answer_eaa8e3ef_1 on 2023/05/24 (Wed) 18:08] On 2023/05/24, I'm planning a trip to Maui and looking for outdoor hiking trails.",
        sessionId: "s-hike",
        source: SOURCE,
        tags: ["compact_evidence", "user_answer"],
        updatedAt: TIMESTAMP,
      }),
    ];

    const result = selectFacts(
      facts,
      "How much more did I spend on accommodations per night in Hawaii compared to Tokyo?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(new Set(result.facts.map((fact) => fact.id))).toEqual(
      new Set(["fact-maui-resort", "fact-tokyo-hostel"]),
    );
    expect(result.traces.find((trace) => trace.memoryId === "fact-maui-hike")?.returned).toBe(false);
  });

  it("returns more than two market earning facts for total money queries", () => {
    const language = createLanguageService();
    const facts = [
      createFactMemory({
        id: "fact-jam",
        userId: "user-1",
        category: "event",
        content:
          "Total money I earned from selling products at markets: I just sold 15 jars of homemade jam at the market, earning $225.",
        source: SOURCE,
        tags: ["compact_evidence", "user_answer"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-potted-herbs",
        userId: "user-1",
        category: "event",
        content:
          "Total money I earned from selling products at markets: I earned $150 selling 20 potted herb plants at the Summer Solstice Market.",
        source: SOURCE,
        tags: ["compact_evidence", "user_answer"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-herb-bunches",
        userId: "user-1",
        category: "event",
        content:
          "Total money I earned from selling products at markets: I sold 12 bunches of fresh organic herbs at the farmers market, earning a total of $120.",
        source: SOURCE,
        tags: ["compact_evidence", "user_answer"],
        updatedAt: TIMESTAMP,
      }),
    ];

    const result = selectFacts(
      facts,
      "What is the total amount of money I earned from selling my products at the markets?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(new Set(result.facts.map((fact) => fact.id))).toEqual(
      new Set(["fact-jam", "fact-potted-herbs", "fact-herb-bunches"]),
    );
  });

  it("returns declined financial opportunity amounts for cross-session comparisons", () => {
    const language = createLanguageService();
    const makeFact = (
      id: string,
      content: string,
      role: "assistant" | "user" = "user",
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeFact(
        "fact-rejected-raise-user",
        "I'm kinda torn about rejecting that $10,000 raise on March 12, was that a smart move considering my current situation?",
      ),
      makeFact(
        "fact-rejected-raise-assistant",
        "Deciding whether to reject a $10,000 raise is a significant decision with financial and career tradeoffs.",
        "assistant",
      ),
      makeFact(
        "fact-declined-freelance-user",
        "I'm worried that declining the $5,000 freelance project on April 1 might have been a mistake.",
      ),
      makeFact(
        "fact-declined-freelance-assistant",
        "Declining the $5,000 freelance project can make sense if onboarding for the new job is the higher priority.",
        "assistant",
      ),
      makeFact(
        "fact-declined-bonus-user",
        "I'm struggling with the idea of free will after declining a $12,000 bonus on May 15 due to ethical concerns.",
      ),
      makeFact(
        "fact-declined-bonus-assistant",
        "Declining a $12,000 bonus because of ethical concerns shows a clear values-based financial tradeoff.",
        "assistant",
      ),
      makeFact(
        "fact-accepted-offer-noise",
        "I accepted a $95,000 job offer because the startup growth opportunity was exciting.",
      ),
      makeFact(
        "fact-free-will-noise",
        "I journaled about free will and fiction writing during a walk with Tanya.",
      ),
    ];

    const result = selectFacts(
      facts,
      "Considering the financial opportunities I declined—a raise, a freelance project, and a bonus—how do the total amounts I turned down compare?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(new Set(result.facts.map((fact) => fact.id))).toEqual(
      new Set([
        "fact-rejected-raise-user",
        "fact-rejected-raise-assistant",
        "fact-declined-freelance-user",
        "fact-declined-freelance-assistant",
        "fact-declined-bonus-user",
        "fact-declined-bonus-assistant",
      ]),
    );
    expect(result.traces.find((trace) => trace.memoryId === "fact-accepted-offer-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-free-will-noise")?.returned).toBe(false);
  });

  it("returns Chinese money facts for aggregate spending queries", () => {
    const language = createLanguageService();
    const facts = [
      createFactMemory({
        id: "fact-chain-zh",
        userId: "user-1",
        category: "event",
        content: "我给自行车换了链条，花了25元。",
        source: { ...SOURCE, locale: "zh-CN" },
        tags: ["user_answer"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-light-zh",
        userId: "user-1",
        category: "event",
        content: "我又装了一组自行车灯，花了40元。",
        source: { ...SOURCE, locale: "zh-CN" },
        tags: ["user_answer"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-hotel-zh",
        userId: "user-1",
        category: "event",
        content: "酒店房间每晚花了140元。",
        source: { ...SOURCE, locale: "zh-CN" },
        tags: ["user_answer"],
        updatedAt: TIMESTAMP,
      }),
    ];

    const result = selectFacts(
      facts,
      "今年自行车相关维修总共花了多少钱？",
      language,
      "zh-CN",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(new Set(result.facts.map((fact) => fact.id))).toEqual(
      new Set(["fact-chain-zh", "fact-light-zh"]),
    );
    expect(result.traces.find((trace) => trace.memoryId === "fact-hotel-zh")?.returned).toBe(false);
  });

  it("returns Chinese declined financial opportunity amounts for cross-session comparisons", () => {
    const language = createLanguageService();
    const makeFact = (
      id: string,
      content: string,
      role: "assistant" | "user" = "user",
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: { ...SOURCE, locale: "zh-CN" },
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeFact(
        "fact-rejected-raise-zh",
        "我在3月12日拒绝了一次10000元加薪，因为我担心它和当前职业方向不一致。",
      ),
      makeFact(
        "fact-rejected-raise-answer-zh",
        "拒绝10000元加薪意味着你在薪资和长期职业取舍之间做了选择。",
        "assistant",
      ),
      makeFact(
        "fact-declined-freelance-zh",
        "我在4月1日放弃了5000元自由职业项目，想把精力留给新工作的入职任务。",
      ),
      makeFact(
        "fact-declined-freelance-answer-zh",
        "放弃5000元自由职业项目可以理解为优先保证新工作过渡。",
        "assistant",
      ),
      makeFact(
        "fact-declined-bonus-zh",
        "我在5月15日因为伦理顾虑拒绝了12000元奖金。",
      ),
      makeFact(
        "fact-declined-bonus-answer-zh",
        "拒绝12000元奖金说明你把价值观和伦理考虑放在直接收益之前。",
        "assistant",
      ),
      makeFact(
        "fact-accepted-offer-zh",
        "我接受了95000元的工作机会，因为创业公司的成长空间很大。",
      ),
      makeFact(
        "fact-reflection-zh",
        "我写日记反思自由意志和小说创作。",
      ),
    ];

    const result = selectFacts(
      facts,
      "对比我拒绝过的财务机会，包括加薪、自由职业项目和奖金，这些放弃的金额分别是多少？",
      language,
      "zh-CN",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(new Set(result.facts.map((fact) => fact.id))).toEqual(
      new Set([
        "fact-rejected-raise-zh",
        "fact-rejected-raise-answer-zh",
        "fact-declined-freelance-zh",
        "fact-declined-freelance-answer-zh",
        "fact-declined-bonus-zh",
        "fact-declined-bonus-answer-zh",
      ]),
    );
    expect(result.traces.find((trace) => trace.memoryId === "fact-accepted-offer-zh")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-reflection-zh")?.returned).toBe(false);
  });

  it("returns medical provider facts for aggregate doctor count queries", () => {
    const language = createLanguageService();
    const facts = [
      createFactMemory({
        id: "fact-patel-lee",
        userId: "user-1",
        category: "event",
        content:
          "I have a nasal spray prescription from Dr. Patel and had a follow-up appointment with my dermatologist, Dr. Lee.",
        source: SOURCE,
        tags: ["user_answer"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-smith",
        userId: "user-1",
        category: "event",
        content:
          "I had a UTI and was prescribed antibiotics by my primary care physician, Dr. Smith.",
        source: SOURCE,
        tags: ["user_answer"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-no-provider",
        userId: "user-1",
        category: "event",
        content: "I read a general article about appointments and prescriptions.",
        source: SOURCE,
        tags: ["user_answer"],
        updatedAt: TIMESTAMP,
      }),
    ];

    const result = selectFacts(
      facts,
      "How many different doctors did I visit?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(new Set(result.facts.map((fact) => fact.id))).toEqual(
      new Set(["fact-patel-lee", "fact-smith"]),
    );
    expect(result.traces.find((trace) => trace.memoryId === "fact-no-provider")?.returned).toBe(false);
  });

  it("prefers entity-bearing temporal-order evidence within a session before generic topic evidence", () => {
    const language = createLanguageService();
    const facts = [
      createFactMemory({
        id: "fact-museum-topic",
        userId: "user-1",
        category: "event",
        content:
          "On 2023/01/15, I was interested in other exhibitions or museums that might be of interest to us.",
        sessionId: "s-science",
        source: SOURCE,
        tags: ["dated_event"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-science-museum",
        userId: "user-1",
        category: "event",
        content:
          "On 2023/01/15, I visited the Science Museum with my family.",
        sessionId: "s-science",
        source: SOURCE,
        tags: ["dated_event"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-metropolitan-museum",
        userId: "user-1",
        category: "event",
        content:
          "On 2023/02/20, I visited the Metropolitan Museum of Art.",
        sessionId: "s-metropolitan",
        source: SOURCE,
        tags: ["dated_event"],
        updatedAt: TIMESTAMP,
      }),
    ];

    const result = selectFacts(
      facts,
      "What is the order of the museums I visited from earliest to latest?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(new Set(result.facts.map((fact) => fact.id).slice(0, 2))).toEqual(
      new Set(["fact-science-museum", "fact-metropolitan-museum"]),
    );
    expect(result.facts.findIndex((fact) => fact.id === "fact-museum-topic")).toBeGreaterThan(1);
  });

  it("prefers realized temporal-order events before future named-entity mentions", () => {
    const language = createLanguageService();
    const facts = [
      createFactMemory({
        id: "fact-childrens-museum-plan",
        userId: "user-1",
        category: "event",
        content:
          "On 2023/03/04, I'll definitely check the Children's Museum's website to see what exhibits they have.",
        sessionId: "s-natural-history",
        source: SOURCE,
        tags: ["dated_event"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-natural-history-visit",
        userId: "user-1",
        category: "event",
        content:
          "On 2023/03/04, I took my niece to the Natural History Museum to see the Dinosaur Fossils exhibition today.",
        sessionId: "s-natural-history",
        source: SOURCE,
        tags: ["dated_event"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-science-museum-visit",
        userId: "user-1",
        category: "event",
        content:
          "On 2023/01/15, I visited the Science Museum with my colleague.",
        sessionId: "s-science",
        source: SOURCE,
        tags: ["dated_event"],
        updatedAt: TIMESTAMP,
      }),
    ];

    const result = selectFacts(
      facts,
      "What is the order of the museums I visited from earliest to latest?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(new Set(result.facts.map((fact) => fact.id).slice(0, 2))).toEqual(
      new Set(["fact-natural-history-visit", "fact-science-museum-visit"]),
    );
    expect(result.facts.findIndex((fact) => fact.id === "fact-childrens-museum-plan")).toBeGreaterThan(1);
  });

  it("prefers realized temporal-order events before adjacent named-entity facts", () => {
    const language = createLanguageService();
    const facts = [
      createFactMemory({
        id: "fact-dinner-party",
        userId: "user-1",
        category: "event",
        content:
          "On 2023/01/22, I've always been fascinated by The Dinner Party, and I appreciate how it's become an iconic symbol of feminist art.",
        sessionId: "s-moca",
        source: SOURCE,
        tags: ["dated_event"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-moca-lecture",
        userId: "user-1",
        category: "event",
        content:
          "On 2023/01/22, Speaking of feminist art, I just came back from a lecture series at the Museum of Contemporary Art.",
        sessionId: "s-moca",
        source: SOURCE,
        tags: ["dated_event"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-science-museum-visit",
        userId: "user-1",
        category: "event",
        content:
          "On 2023/01/15, I visited the Science Museum with my colleague.",
        sessionId: "s-science",
        source: SOURCE,
        tags: ["dated_event"],
        updatedAt: TIMESTAMP,
      }),
    ];

    const result = selectFacts(
      facts,
      "What is the order of the museums I visited from earliest to latest?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(new Set(result.facts.map((fact) => fact.id).slice(0, 2))).toEqual(
      new Set(["fact-moca-lecture", "fact-science-museum-visit"]),
    );
    expect(result.facts.map((fact) => fact.id)).not.toContain("fact-dinner-party");
  });

  it("prefers marked user-answer temporal evidence before same-session distractors", () => {
    const language = createLanguageService();
    const facts = [
      createFactMemory({
        id: "fact-answer-session-moca-distractor",
        userId: "user-1",
        category: "event",
        content:
          "On 2023/03/04, I'm interested in learning more about the Museum of Contemporary Art, where I attended a lectures series recently.",
        sessionId: "s-natural-history",
        source: SOURCE,
        tags: ["answer_session", "dated_event"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-user-answer-natural-history",
        userId: "user-1",
        category: "event",
        content:
          "On 2023/03/04, I took my niece to the Natural History Museum to see the Dinosaur Fossils exhibition today.",
        sessionId: "s-natural-history",
        source: SOURCE,
        tags: ["user_answer", "dated_event"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-user-answer-science-museum",
        userId: "user-1",
        category: "event",
        content:
          "On 2023/01/15, I visited the Science Museum with my colleague.",
        sessionId: "s-science",
        source: SOURCE,
        tags: ["user_answer", "dated_event"],
        updatedAt: TIMESTAMP,
      }),
    ];

    const result = selectFacts(
      facts,
      "What is the order of the museums I visited from earliest to latest?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(new Set(result.facts.map((fact) => fact.id).slice(0, 2))).toEqual(
      new Set(["fact-user-answer-natural-history", "fact-user-answer-science-museum"]),
    );
    expect(result.facts.findIndex((fact) => fact.id === "fact-answer-session-moca-distractor")).toBeGreaterThan(1);
  });

  it("prefers temporal-order facts that retain the queried entity name", () => {
    const language = createLanguageService();
    const facts = [
      createFactMemory({
        id: "fact-modern-art-pronoun",
        userId: "user-1",
        category: "event",
        content:
          "On 2023/02/20, I attended their guided tour of The Evolution of Abstract Expressionism today.",
        sessionId: "s-modern-art",
        source: SOURCE,
        tags: ["user_answer", "dated_event"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-modern-art-museum",
        userId: "user-1",
        category: "event",
        content:
          "On 2023/02/20, I recently attended a guided tour of the Modern Art Museum's The Evolution of Abstract Expressionism.",
        sessionId: "s-modern-art",
        source: SOURCE,
        tags: ["user_answer", "dated_event"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-science-museum",
        userId: "user-1",
        category: "event",
        content:
          "On 2023/01/15, I visited the Science Museum with my colleague.",
        sessionId: "s-science",
        source: SOURCE,
        tags: ["user_answer", "dated_event"],
        updatedAt: TIMESTAMP,
      }),
    ];

    const result = selectFacts(
      facts,
      "What is the order of the museums I visited from earliest to latest?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(new Set(result.facts.map((fact) => fact.id).slice(0, 2))).toEqual(
      new Set(["fact-modern-art-museum", "fact-science-museum"]),
    );
    expect(result.facts.findIndex((fact) => fact.id === "fact-modern-art-pronoun")).toBeGreaterThan(1);
  });

  it("returns ownership facts for aggregate current-count queries", () => {
    const language = createLanguageService();
    const facts = [
      createFactMemory({
        id: "fact-three-bikes",
        userId: "user-1",
        category: "event",
        content:
          "I currently have three bikes: a road bike, a mountain bike, and a commuter bike.",
        source: SOURCE,
        tags: ["user_answer"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-four-bikes",
        userId: "user-1",
        category: "event",
        content:
          "I just purchased a new hybrid bike, so I will have four bikes with me.",
        source: SOURCE,
        tags: ["user_answer"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-bike-advice",
        userId: "user-1",
        category: "event",
        content: "A bike maintenance article lists 10 generic safety checks.",
        source: SOURCE,
        updatedAt: TIMESTAMP,
      }),
    ];

    const result = selectFacts(
      facts,
      "How many bikes do I currently own?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(new Set(result.facts.map((fact) => fact.id))).toEqual(
      new Set(["fact-three-bikes", "fact-four-bikes"]),
    );
    expect(result.traces.find((trace) => trace.memoryId === "fact-bike-advice")?.returned).toBe(false);
  });

  it("prioritizes verified assistant evidence for previous-chat ordinal questions", () => {
    const language = createLanguageService();
    const facts = [
      createFactMemory({
        id: "fact-profile-noise",
        userId: "user-1",
        category: "personal",
        content:
          "male model and i am asked to make a promotional instagram post for the above campaign",
        source: SOURCE,
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-item-7",
        userId: "user-1",
        category: "external_benchmark",
        content:
          "Item 7: Transcriptionist",
        source: SOURCE,
        tags: ["assistant_answer"],
        updatedAt: TIMESTAMP,
      }),
    ];

    const result = selectFacts(
      facts,
      "I think we discussed work from home jobs for seniors earlier. Can you remind me what was the 7th job in the list you provided?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toContain("fact-item-7");
    expect(result.traces.find((trace) => trace.memoryId === "fact-profile-noise")?.returned).toBe(false);
  });

  it("keeps assistant answer evidence eligible for did-you-recommend questions", () => {
    const language = createLanguageService();
    const facts = [
      createFactMemory({
        id: "fact-user-request",
        userId: "user-1",
        category: "external_benchmark",
        content:
          "On 2023/05/28, I was interested in a traditional game that requires skilled dancers.",
        source: SOURCE,
        tags: ["compact_evidence"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-hoop-dance",
        userId: "user-1",
        category: "external_benchmark",
        content:
          "Item 1: Hoop Dance - a traditional game that requires skilled dancers and coordinated movement.",
        source: SOURCE,
        tags: ["assistant_answer"],
        updatedAt: TIMESTAMP,
      }),
    ];

    const result = selectFacts(
      facts,
      "Which traditional game did you recommend for skilled dancers?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toContain("fact-hoop-dance");
  });

  it("keeps Chinese assistant answer evidence eligible for previous recommendation questions", () => {
    const language = createLanguageService();
    const facts = [
      createFactMemory({
        id: "fact-user-request-zh",
        userId: "user-1",
        category: "external_benchmark",
        content: "我之前想找适合小团队的异步协作文档工具。",
        source: { ...SOURCE, locale: "zh-CN" },
        tags: ["compact_evidence"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-notion-zh",
        userId: "user-1",
        category: "external_benchmark",
        content: "第1项：Notion，适合小团队做异步协作文档和知识库。",
        source: { ...SOURCE, locale: "zh-CN" },
        tags: ["assistant_answer"],
        updatedAt: TIMESTAMP,
      }),
    ];

    const result = selectFacts(
      facts,
      "你之前给我推荐的小团队异步协作文档工具是什么？",
      language,
      "zh-CN",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toContain("fact-notion-zh");
  });

  it("keeps assistant count headings eligible for previous-chat count questions", () => {
    const language = createLanguageService();
    const facts = [
      createFactMemory({
        id: "fact-title",
        userId: "user-1",
        category: "external_benchmark",
        content: "Assistant response title: The Lost Temple of the Djinn.",
        source: SOURCE,
        tags: ["assistant_answer"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-mummies",
        userId: "user-1",
        category: "external_benchmark",
        content: "Mummies (4):",
        source: SOURCE,
        tags: ["assistant_answer"],
        updatedAt: TIMESTAMP,
      }),
    ];

    const result = selectFacts(
      facts,
      "Can you remind me how many mummies the party will face in the Lost Temple of the Djinn?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toContain("fact-mummies");
  });

  it("keeps verified user evidence eligible for previous-chat questions", () => {
    const language = createLanguageService();
    const facts = [
      createFactMemory({
        id: "fact-user-answer",
        userId: "user-1",
        category: "external_benchmark",
        content:
          "I want to have access to all seasons for old shows. For example, Doc Martin only had the last season available.",
        source: SOURCE,
        tags: ["user_answer"],
        updatedAt: TIMESTAMP,
      }),
    ];

    const result = selectFacts(
      facts,
      "I wanted to check back on our previous conversation about Netflix. What show did I use as an example, the one that only had the last season available?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual(["fact-user-answer"]);
  });

  it("prioritizes verified user evidence over assistant summaries for user-grounded previous-chat questions", () => {
    const language = createLanguageService();
    const facts = [
      createFactMemory({
        id: "fact-assistant-summary",
        userId: "user-1",
        category: "external_benchmark",
        content:
          "Assistant answer to prior user request about Netflix includes: The interviewee suggests that Netflix should keep all seasons of old shows available for viewing.",
        source: SOURCE,
        tags: ["assistant_answer"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-user-answer",
        userId: "user-1",
        category: "external_benchmark",
        content:
          "I want to have access to all seasons for old shows. For example, Doc Martin only had the last season available.",
        source: SOURCE,
        tags: ["user_answer", "compact_evidence"],
        updatedAt: TIMESTAMP,
      }),
    ];

    const result = selectFacts(
      facts,
      "I wanted to check back on our previous conversation about Netflix. What show did I use as an example, the one that only had the last season available?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts[0]?.id).toBe("fact-user-answer");
  });

  it("falls back to generic fact selection when previous-chat wording has no tagged evidence", () => {
    const language = createLanguageService();
    const facts = [
      createFactMemory({
        id: "fact-degree",
        userId: "user-1",
        category: "personal",
        content: "I graduated with a degree in Business Administration.",
        source: SOURCE,
        updatedAt: TIMESTAMP,
      }),
    ];

    const result = selectFacts(
      facts,
      "Earlier, what degree did I graduate with?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual(["fact-degree"]);
  });

  it("prioritizes matching grouped assistant heading evidence", () => {
    const language = createLanguageService();
    const facts = [
      createFactMemory({
        id: "fact-lemont",
        userId: "user-1",
        category: "external_benchmark",
        content:
          "Lemont Refinery includes: Atmospheric distillation; Delayed coking; Hydrocracking; Hydrotreating.",
        source: SOURCE,
        tags: ["assistant_answer"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-lake-charles",
        userId: "user-1",
        category: "external_benchmark",
        content:
          "Lake Charles Refinery includes: Atmospheric distillation; Fluid catalytic cracking (FCC); Alkylation; Hydrotreating.",
        source: SOURCE,
        tags: ["assistant_answer"],
        updatedAt: TIMESTAMP,
      }),
    ];

    const result = selectFacts(
      facts,
      "Can you remind me what kind of processes are used at the Lake Charles Refinery?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts[0]?.id).toBe("fact-lake-charles");
  });

  it("prioritizes assistant final enumerated items for previous-chat last-item questions", () => {
    const language = createLanguageService();
    const facts = [
      createFactMemory({
        id: "fact-mid-list",
        userId: "user-1",
        category: "external_benchmark",
        content: "Item 6: Aladdin Theater",
        source: SOURCE,
        tags: ["assistant_answer"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-final-item",
        userId: "user-1",
        category: "external_benchmark",
        content: "Assistant final enumerated item: 10. Revolution Hall.",
        source: SOURCE,
        tags: ["assistant_answer"],
        updatedAt: TIMESTAMP,
      }),
    ];

    const result = selectFacts(
      facts,
      "What was the last venue you recommended for Portland indie music shows?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts[0]?.id).toBe("fact-final-item");
  });

  it("returns trusted preference evidence for weak-overlap recommendation questions", () => {
    const language = createLanguageService();
    const facts = [
      createFactMemory({
        id: "fact-noise",
        userId: "user-1",
        category: "personal",
        content: "I am packing for a trip tomorrow.",
        source: SOURCE,
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-evening-preference",
        userId: "user-1",
        category: "external_benchmark",
        content:
          "I prefer winding down by 9:30 pm to prepare for a good night's sleep.",
        source: SOURCE,
        tags: ["user_answer", "compact_evidence"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-kitchen-leak",
        userId: "user-1",
        category: "personal",
        content: "I am struggling with a leaking kitchen faucet.",
        source: SOURCE,
        tags: ["user_answer", "compact_evidence"],
        updatedAt: TIMESTAMP,
      }),
    ];

    const result = selectFacts(
      facts,
      "Can you suggest some activities that I can do in the evening?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-evening-preference",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-kitchen-leak")?.returned).toBe(false);
  });

  it("returns source-ordered preference evidence for implementation help questions", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      content: string,
      tags: string[] = ["source_message", "source_order", "user_answer"],
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags,
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-assistant-caching",
        47,
        "[BEAM chat_id=47 role=assistant time=unknown] Using localStorage is a great approach for caching API responses in the app.",
        ["source_message", "source_order", "assistant_answer"],
      ),
      makeSourceFact(
        "fact-cache-implementation-noise",
        52,
        "[BEAM chat_id=52 role=user time=unknown] I implemented a straightforward caching system for app API responses with TTL checks and cache invalidation.",
      ),
      makeSourceFact(
        "fact-lightweight-preference",
        54,
        "[BEAM chat_id=54 role=user time=unknown] I'm trying to keep my weather app under 2.5MB, so I prefer using lightweight, dependency-free solutions over heavy frameworks.",
      ),
      makeSourceFact(
        "fact-later-cache-implementation",
        64,
        "[BEAM chat_id=64 role=user time=unknown] I implemented a simple caching mechanism for OpenWeather API responses using an in-memory cache and TTL.",
      ),
    ];

    const result = selectFacts(
      facts,
      "Can you help me set up a caching system for my app's API responses? I'd like to keep it simple and straightforward.",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toContain(
      "fact-lightweight-preference",
    );
    expect(result.traces.find((trace) => trace.memoryId === "fact-lightweight-preference")?.returned).toBe(true);
  });

  it("returns Chinese source-ordered preference evidence for implementation help questions", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      content: string,
      tags: string[] = ["source_message", "source_order", "user_answer"],
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: { ...SOURCE, locale: "zh-CN" },
        tags,
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-assistant-caching-zh",
        47,
        "[BEAM chat_id=47 role=assistant time=unknown] 用 localStorage 缓存 API 响应是一个可行方案。",
        ["source_message", "source_order", "assistant_answer"],
      ),
      makeSourceFact(
        "fact-cache-implementation-noise-zh",
        52,
        "[BEAM chat_id=52 role=user time=unknown] 我实现了带 TTL 和失效检查的 API 响应缓存。",
      ),
      makeSourceFact(
        "fact-lightweight-preference-zh",
        54,
        "[BEAM chat_id=54 role=user time=unknown] 我想让天气应用保持在 2.5MB 以下，所以我更喜欢轻量、无外部依赖的方案，不想用很重的框架。",
      ),
      makeSourceFact(
        "fact-later-cache-implementation-zh",
        64,
        "[BEAM chat_id=64 role=user time=unknown] 我用内存缓存和 TTL 实现了 OpenWeather API 响应缓存。",
      ),
    ];

    const result = selectFacts(
      facts,
      "帮我做一个 API 响应缓存系统，我希望方案简单直接，尽量不要外部依赖。",
      language,
      "zh-CN",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toContain(
      "fact-lightweight-preference-zh",
    );
    expect(result.traces.find((trace) => trace.memoryId === "fact-lightweight-preference-zh")?.returned).toBe(true);
  });

  it("bridges source-ordered preferences to the adjacent implementation rationale", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-heavy-framework-noise",
        8,
        "user",
        "[BEAM chat_id=8 role=user time=unknown] I tried a generic React dashboard tutorial with several third-party caching packages.",
      ),
      makeSourceFact(
        "fact-lightweight-cache-preference",
        20,
        "user",
        "[BEAM chat_id=20 role=user time=unknown] I prefer lightweight, dependency-free caching for my weather app because I want to keep the bundle small.",
      ),
      makeSourceFact(
        "fact-lightweight-cache-rationale",
        21,
        "assistant",
        "[BEAM chat_id=21 role=assistant time=unknown] We chose localStorage plus an in-memory TTL cache because it preserves the lightweight preference without adding external libraries.",
      ),
    ];

    const result = selectFacts(
      facts,
      "Can you help me choose a caching approach that fits my lightweight preference for the weather app?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    const selectedIds = result.facts.map((fact) => fact.id);
    expect(selectedIds).toContain("fact-lightweight-cache-preference");
    expect(selectedIds).toContain("fact-lightweight-cache-rationale");
    expect(result.traces.find((trace) => trace.memoryId === "fact-heavy-framework-noise")?.returned).toBe(false);
  });

  it("keeps automated deployment monitoring preference evidence source ordered", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        sessionId: "beam-conversation-2",
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          originalRole: role,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-gh-pages-deployment-noise",
        145,
        "assistant",
        "[BEAM chat_id=145 role=assistant time=unknown] Use the gh-pages package as a dev dependency to deploy your application to GitHub Pages.",
      ),
      makeSourceFact(
        "fact-weather-api-error-noise",
        124,
        "user",
        "[BEAM chat_id=124 role=user time=unknown] I'm trying to implement the dynamic weather display feature and need help handling API errors in fetchWeatherData.",
      ),
      makeSourceFact(
        "fact-weather-api-error-assistant-noise",
        125,
        "assistant",
        "[BEAM chat_id=125 role=assistant time=unknown] We reviewed API error handling for dynamic weather display.",
      ),
      makeSourceFact(
        "fact-security-preference-noise",
        178,
        "user",
        "[BEAM chat_id=178 role=user time=unknown] I'm trying to enhance the security of my application without compromising the user experience, so I'd like a pragmatic approach to security enhancements.",
      ),
      makeSourceFact(
        "fact-security-assistant-noise",
        179,
        "assistant",
        "[BEAM chat_id=179 role=assistant time=unknown] We balanced security hardening with responsiveness and user experience.",
      ),
      makeSourceFact(
        "fact-automated-ci-cd-preference",
        182,
        "user",
        "[BEAM chat_id=182 role=user time=unknown] I'm trying to set up an automated CI/CD pipeline for my project to reduce human error and speed up release cycles. I prefer automated deployments over manual ones and want to track each step.",
      ),
      makeSourceFact(
        "fact-github-actions-setup-assistant-noise",
        183,
        "assistant",
        "[BEAM chat_id=183 role=assistant time=unknown] Create a GitHub repository and set up an automated CI/CD pipeline using GitHub Actions for your project.",
      ),
      makeSourceFact(
        "fact-github-actions-job-monitoring",
        184,
        "user",
        "[BEAM chat_id=184 role=user time=unknown] hmm, so how do I monitor the progress of each job in the GitHub Actions workflow?",
      ),
      makeSourceFact(
        "fact-github-actions-monitoring-assistant-noise",
        185,
        "assistant",
        "[BEAM chat_id=185 role=assistant time=unknown] GitHub provides a detailed interface to track the execution of workflows and jobs, including each job's progress and status.",
      ),
    ];

    const result = selectFacts(
      facts,
      "How can I track the status and results of each step in my deployment workflow?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-automated-ci-cd-preference",
      "fact-github-actions-job-monitoring",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-github-actions-monitoring-assistant-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-gh-pages-deployment-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-security-preference-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-weather-api-error-noise")?.returned).toBe(false);
  });

  it("keeps lightweight lazy-loading preference evidence source ordered", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        sessionId: "beam-conversation-3",
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          originalRole: role,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-gallery-image-path-noise",
        62,
        "user",
        "[BEAM chat_id=62 role=user time=unknown] I'm encountering an issue with my project gallery where some images are not loading and return 404 errors.",
      ),
      makeSourceFact(
        "fact-form-validation-noise",
        48,
        "user",
        "[BEAM chat_id=48 role=user time=unknown] I'm trying to add client-side validation to my contact form using Bootstrap 5.3.0 classes.",
      ),
      makeSourceFact(
        "fact-form-validation-assistant-noise",
        49,
        "assistant",
        "[BEAM chat_id=49 role=assistant time=unknown] We added Bootstrap validation states and JavaScript checks to the contact form.",
      ),
      makeSourceFact(
        "fact-sprint-planning-noise",
        82,
        "user",
        "[BEAM chat_id=82 role=user time=unknown] I'm working on Sprint 2 with SEO basics and contact form backend integration using Flask and Bootstrap 5.3.0.",
      ),
      makeSourceFact(
        "fact-sprint-planning-assistant-noise",
        83,
        "assistant",
        "[BEAM chat_id=83 role=assistant time=unknown] We broke Sprint 2 into backend, SEO, and performance tasks.",
      ),
      makeSourceFact(
        "fact-modal-lazy-loading-noise",
        96,
        "user",
        "[BEAM chat_id=96 role=user time=unknown] I'm trying to optimize the performance of my modal popup, which currently has a 400ms delay due to synchronous image loading.",
      ),
      makeSourceFact(
        "fact-lightweight-lazysizes-preference",
        100,
        "user",
        "[BEAM chat_id=100 role=user time=unknown] I'm trying to keep my bundle size under 100KB by using lightweight vanilla JS libraries like lazysizes, but I'm not sure how to implement it for my project gallery. Can you help me build a simple image lazy loading feature?",
      ),
      makeSourceFact(
        "fact-deployment-lazy-loading-noise",
        122,
        "user",
        "[BEAM chat_id=122 role=user time=unknown] I'm finalizing my portfolio site's deployment and optimization for SEO and performance before the public launch and want to implement lazy loading.",
      ),
    ];

    const result = selectFacts(
      facts,
      "I'm working on adding lazy loading to my image gallery that uses Bootstrap 5.3.0. How would you suggest I set this up to ensure smooth integration and good performance?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-lightweight-lazysizes-preference",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-deployment-lazy-loading-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-modal-lazy-loading-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-gallery-image-path-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-sprint-planning-noise")?.returned).toBe(false);
  });

  it("keeps pragmatic security preference evidence source ordered", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        sessionId: "beam-conversation-1",
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          originalRole: role,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-analytics-deadline-noise",
        86,
        "user",
        "[BEAM chat_id=86 role=user time=unknown] I'm working on sprint 2 which targets analytics by April 19, and I've already completed sprint 1 with user auth and basic transaction CRUD.",
      ),
      makeSourceFact(
        "fact-session-management-noise",
        108,
        "user",
        "[BEAM chat_id=108 role=user time=unknown] I'm starting from scratch with Flask-Login 0.6.2 session management and want proper error handling and logging.",
      ),
      makeSourceFact(
        "fact-security-review-noise",
        116,
        "user",
        "[BEAM chat_id=116 role=user time=unknown] I'm finalizing deployment and need security hardening before public launch, including authentication and authorization review.",
      ),
      makeSourceFact(
        "fact-pragmatic-security-preference",
        178,
        "user",
        "[BEAM chat_id=178 role=user time=unknown] I'm trying to enhance the security of my application without compromising the user experience, so I'd like to implement a pragmatic approach to security enhancements, as stated in my preference for pragmatic security enhancements that don't compromise user experience or app responsiveness.",
      ),
      makeSourceFact(
        "fact-secure-auth-noise",
        182,
        "user",
        "[BEAM chat_id=182 role=user time=unknown] I'm trying to implement a secure authentication system and ensure authentication and authorization features follow best practices.",
      ),
      makeSourceFact(
        "fact-auth-best-practices-instruction-noise",
        184,
        "user",
        "[BEAM chat_id=184 role=user time=unknown] Always provide security best practices when I ask about authentication or authorization features.",
      ),
    ];

    const result = selectFacts(
      facts,
      "I'm looking to improve the security features of my app. What steps would you suggest I take?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-pragmatic-security-preference",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-security-review-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-secure-auth-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-auth-best-practices-instruction-noise")?.returned).toBe(false);
  });

  it("keeps UK ATS resume preference evidence source ordered", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        sessionId: "beam-conversation-6",
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          originalRole: role,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-age-discrimination-resume-noise",
        1,
        "assistant",
        "[BEAM chat_id=1 role=assistant time=unknown] Focus on achievements, tailor your resume, remove outdated information, and consider a functional resume format to reduce age discrimination concerns.",
      ),
      makeSourceFact(
        "fact-structured-bullets-preference-noise",
        36,
        "user",
        "[BEAM chat_id=36 role=user time=unknown] I prefer using structured bullet points with quantified achievements over narrative paragraphs for clarity and ATS readability.",
      ),
      makeSourceFact(
        "fact-resume-format-instruction-noise",
        46,
        "user",
        "[BEAM chat_id=46 role=user time=unknown] Always use structured bullet points with quantified achievements when I ask about resume formatting preferences.",
      ),
      makeSourceFact(
        "fact-ats-parser-update-noise",
        200,
        "user",
        "[BEAM chat_id=200 role=user time=unknown] I updated my resume format to improve ranking by 18% in StreamWave's ATS parser version 3.2 before my interview.",
      ),
      makeSourceFact(
        "fact-global-resume-standards-noise",
        203,
        "assistant",
        "[BEAM chat_id=203 role=assistant time=unknown] International resume standards vary, so learn about formatting, content, cultural nuances, and ATS trends across countries.",
      ),
      makeSourceFact(
        "fact-uk-ats-resume-preference",
        222,
        "user",
        "[BEAM chat_id=222 role=user time=unknown] I'm trying to tailor my resume for a UK job, and I prefer using a style that's specifically designed for their ATS standards, rather than a generic global version.",
      ),
    ];

    const result = selectFacts(
      facts,
      "I'm applying for a job in the UK. How should I format it?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-uk-ats-resume-preference",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-structured-bullets-preference-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-resume-format-instruction-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-global-resume-standards-noise")?.returned).toBe(false);
  });

  it("keeps probability ratio walkthrough preference evidence source ordered", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        sessionId: "beam-conversation-5",
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          originalRole: role,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-ace-card-probability-noise",
        32,
        "user",
        "[BEAM chat_id=32 role=user time=unknown] I'm trying to calculate the probability of drawing an ace from a standard 52-card deck, given as P = 4/52 = 1/13, and want to apply it to a real game.",
      ),
      makeSourceFact(
        "fact-face-card-conditional-noise",
        58,
        "user",
        "[BEAM chat_id=58 role=user time=unknown] Got it, but what about calculating P(A|B) for drawing a face card or a spade from a deck?",
      ),
      makeSourceFact(
        "fact-probability-ratio-walkthrough-preference",
        60,
        "user",
        "[BEAM chat_id=60 role=user time=unknown] I'm trying to understand probability as a ratio, and I prefer step-by-step explanations with concrete examples like coin tosses and dice rolls to grasp probability fundamentals, so can you help me calculate the probability of rolling an even number on a 6-sided die?",
      ),
      makeSourceFact(
        "fact-probability-step-instruction-noise",
        64,
        "user",
        "[BEAM chat_id=64 role=user time=unknown] Always provide step-by-step explanations with concrete examples when I ask about probability concepts.",
      ),
      makeSourceFact(
        "fact-dependent-card-probability-noise",
        108,
        "user",
        "[BEAM chat_id=108 role=user time=unknown] I want to find the probability that the second card is an ace given that the first card was an ace, so the probability of drawing a second ace is 3/51.",
      ),
      makeSourceFact(
        "fact-complex-probability-diagram-instruction-noise",
        234,
        "user",
        "[BEAM chat_id=234 role=user time=unknown] Always combine algebraic formulas with visual diagrams when I ask about complex probability problems.",
      ),
    ];

    const result = selectFacts(
      facts,
      "Can you walk me through how to find the probability of drawing a red card from a standard deck of cards?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-probability-ratio-walkthrough-preference",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-ace-card-probability-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-face-card-conditional-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-probability-step-instruction-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-complex-probability-diagram-instruction-noise")?.returned).toBe(false);
  });

  it("keeps triangle area method comparison preference evidence source ordered", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        sessionId: "beam-conversation-4",
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          originalRole: role,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-median-length-noise",
        114,
        "user",
        "[BEAM chat_id=114 role=user time=unknown] I'm having trouble with calculating the median length in a triangle, and I want to correctly apply the median length formula to sides 9, 12, and 15 cm.",
      ),
      makeSourceFact(
        "fact-triangle-area-median-comparison-preference",
        116,
        "user",
        "[BEAM chat_id=116 role=user time=unknown] I'm trying to understand which method is more efficient for calculating the area of a triangle, the base-height formula or Heron's formula, for sides 7 cm, 24 cm, and 25 cm, and I want to compare the results using both methods and explore how the median length formula can be applied to this triangle.",
      ),
      makeSourceFact(
        "fact-later-area-comparison-noise",
        130,
        "user",
        "[BEAM chat_id=130 role=user time=unknown] I'm trying to calculate the area of a triangle using Heron's formula, but I want to compare it with the base-height formula for sides 7 cm, 24 cm, and 25 cm after completing 15 problems.",
      ),
      makeSourceFact(
        "fact-later-area-comparison-assistant-noise",
        131,
        "assistant",
        "[BEAM chat_id=131 role=assistant time=unknown] We compared Heron's formula and the base-height formula for a right triangle with sides 7 cm, 24 cm, and 25 cm.",
      ),
      makeSourceFact(
        "fact-medians-altitudes-method-noise",
        134,
        "user",
        "[BEAM chat_id=134 role=user time=unknown] I want to know how to apply medians and altitudes to calculate triangle area, and I prefer comparing multiple solution methods.",
      ),
      makeSourceFact(
        "fact-medians-altitudes-assistant-noise",
        135,
        "assistant",
        "[BEAM chat_id=135 role=assistant time=unknown] We explored using medians and altitudes to calculate triangle area and compare base-height, Heron's formula, and altitude methods.",
      ),
      makeSourceFact(
        "fact-median-followup-noise",
        138,
        "user",
        "[BEAM chat_id=138 role=user time=unknown] Can you show an example using the median length formula for a different set of triangle sides?",
      ),
      makeSourceFact(
        "fact-broad-triangle-geometry-noise",
        190,
        "user",
        "[BEAM chat_id=190 role=user time=unknown] I'm having trouble understanding congruence and similarity in triangles, including scale factors, medians, altitudes, GeoGebra, visual aids, and step-by-step explanations.",
      ),
    ];

    const result = selectFacts(
      facts,
      "Can you show me how to calculate the area of this triangle using different methods and also help me find the length of the median?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-triangle-area-median-comparison-preference",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-median-length-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-later-area-comparison-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-medians-altitudes-method-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-broad-triangle-geometry-noise")?.returned).toBe(false);
  });

  it("keeps cover letter measurable impact preference evidence source ordered", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        sessionId: "beam-conversation-8",
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          originalRole: role,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-portfolio-update-noise",
        8,
        "user",
        "[BEAM chat_id=8 role=user time=unknown] I'm kinda worried about my portfolio, Greg told me to update it by April 1, what should I do to make it stand out?",
      ),
      makeSourceFact(
        "fact-cover-letter-experience-noise",
        33,
        "assistant",
        "[BEAM chat_id=33 role=assistant time=unknown] Deciding whether to emphasize 40 years of experience or recent digital projects in your cover letter depends on the job priorities.",
      ),
      makeSourceFact(
        "fact-cover-letter-measurable-impact-preference",
        34,
        "user",
        "[BEAM chat_id=34 role=user time=unknown] I'm kinda stuck on how to write a cover letter that highlights my measurable impact, like increasing viewership by 35% on my last documentary project in 2022, without using too much flowery language.",
      ),
      makeSourceFact(
        "fact-cover-letter-deadline-noise",
        58,
        "user",
        "[BEAM chat_id=58 role=user time=unknown] I'm going to submit my cover letter by April 14 as Ashlee recommended, but I'm not sure if avoiding jargon and keeping a warm but professional tone is enough.",
      ),
      makeSourceFact(
        "fact-cover-letter-star-noise",
        59,
        "assistant",
        "[BEAM chat_id=59 role=assistant time=unknown] Tailor the cover letter to the Senior Producer role, quantify achievements, align with Island Media Group values, use STAR storytelling, show enthusiasm, and include a call to action.",
      ),
      makeSourceFact(
        "fact-interview-prep-noise",
        145,
        "assistant",
        "[BEAM chat_id=145 role=assistant time=unknown] Prepare interview responses with the STAR method, company values, behavioral examples, and measurable achievements.",
      ),
      makeSourceFact(
        "fact-cover-letter-ninety-day-goal-noise",
        186,
        "user",
        "[BEAM chat_id=186 role=user time=unknown] I'm trying to craft a standout cover letter, and I prefer clear, measurable goals for my first 90 days, aiming to increase team productivity by 15%.",
      ),
      makeSourceFact(
        "fact-cover-letter-ninety-day-assistant-noise",
        187,
        "assistant",
        "[BEAM chat_id=187 role=assistant time=unknown] Incorporating clear measurable goals into your cover letter can demonstrate a proactive approach and tangible results.",
      ),
    ];

    const result = selectFacts(
      facts,
      "How should I structure my cover letter to best showcase my achievements from previous projects?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-cover-letter-measurable-impact-preference",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-portfolio-update-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-cover-letter-experience-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-cover-letter-deadline-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-cover-letter-ninety-day-goal-noise")?.returned).toBe(false);
  });

  it("keeps cover letter portfolio link preference evidence source ordered", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        sessionId: "beam-conversation-8",
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          originalRole: role,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-portfolio-update-noise",
        8,
        "user",
        "[BEAM chat_id=8 role=user time=unknown] I'm kinda worried about my portfolio, Greg told me to update it by April 1, what should I do to make it stand out?",
      ),
      makeSourceFact(
        "fact-cover-letter-two-column-noise",
        43,
        "assistant",
        "[BEAM chat_id=43 role=assistant time=unknown] A two-column layout can be an effective way to make your cover letter more visually appealing and include links to your portfolio in a supplementary column.",
      ),
      makeSourceFact(
        "fact-cover-letter-deadline-noise",
        58,
        "user",
        "[BEAM chat_id=58 role=user time=unknown] I'm gonna submit my cover letter by April 14 as Ashlee recommended, but I'm not sure if avoiding jargon and keeping a warm but professional tone is enough.",
      ),
      makeSourceFact(
        "fact-cover-letter-portfolio-link-preference",
        68,
        "user",
        "[BEAM chat_id=68 role=user time=unknown] I'm kinda stuck on how to integrate portfolio links directly in my cover letter, like you mentioned, without attaching separate documents, can you help me with that?",
      ),
      makeSourceFact(
        "fact-cover-letter-multiple-portfolio-links-preference",
        70,
        "user",
        "[BEAM chat_id=70 role=user time=unknown] hmm, can I add multiple portfolio links or just one?",
      ),
      makeSourceFact(
        "fact-cover-letter-single-column-noise",
        78,
        "user",
        "[BEAM chat_id=78 role=user time=unknown] I'm kinda stuck on the formatting, so can you help me understand why I switched to a single-column format with bold headers?",
      ),
      makeSourceFact(
        "fact-email-signature-portfolio-link-noise",
        182,
        "user",
        "[BEAM chat_id=182 role=user time=unknown] I'm trying to decide on the best approach for my portfolio website link, and I chose to integrate it into my email signature starting June 10 for better visibility.",
      ),
      makeSourceFact(
        "fact-cover-letter-ninety-day-goal-noise",
        186,
        "user",
        "[BEAM chat_id=186 role=user time=unknown] I'm trying to craft a standout cover letter, and I prefer clear, measurable goals for my first 90 days, aiming to increase team productivity by 15%.",
      ),
    ];

    const result = selectFacts(
      facts,
      "How should I include links to my portfolio in my cover letter to make them easy to access?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-cover-letter-portfolio-link-preference",
      "fact-cover-letter-multiple-portfolio-links-preference",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-portfolio-update-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-cover-letter-two-column-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-email-signature-portfolio-link-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-cover-letter-ninety-day-goal-noise")?.returned).toBe(false);
  });

  it("keeps AI-assisted editing workflow preference evidence source ordered", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        sessionId: "beam-conversation-10",
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          originalRole: role,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-writing-journey-noise",
        0,
        "user",
        "[BEAM chat_id=0 role=user time=unknown] I'm kinda nervous about improving my writing skills and want to get started on this self-editing journey.",
      ),
      makeSourceFact(
        "fact-ai-editing-tool-preference",
        114,
        "user",
        "[BEAM chat_id=114 role=user time=unknown] I prefer using AI-assisted editing tools for tone calibration, but I'm not sure if it's the best approach for my solo project, can you help me weigh the pros and cons of using these tools versus manual revisions to save time?",
      ),
      makeSourceFact(
        "fact-ai-editing-tool-preference-fragment",
        114,
        "user",
        "using AI-assisted editing tools for tone calibration, but I'm not sure if it's the best approach for my solo project, can you help me weigh the pros and cons of using these tools versus manual revisions to save time?",
      ),
      makeSourceFact(
        "fact-ai-editing-hybrid-plan",
        116,
        "user",
        "[BEAM chat_id=116 role=user time=unknown] Thanks for the detailed breakdown! I think I'll go with a hybrid approach. I'll use AI tools for the initial edits to catch basic errors and improve clarity, then do manual revisions for the final touches.",
      ),
      makeSourceFact(
        "fact-ai-editing-hybrid-plan-fragment",
        116,
        "user",
        "I'll use AI tools for the initial edits to catch basic errors and improve clarity, then do manual revisions for the final touches.",
      ),
      makeSourceFact(
        "fact-ai-editing-final-confirmation",
        118,
        "user",
        "[BEAM chat_id=118 role=user time=unknown] Sounds good! I'll follow this plan and use AI tools for the initial edits, then do the final touches manually.",
      ),
      makeSourceFact(
        "fact-editing-progress-instruction-noise",
        172,
        "user",
        "[BEAM chat_id=172 role=user time=unknown] Always provide percentage improvements when I ask about editing progress.",
      ),
      makeSourceFact(
        "fact-weekend-editing-session-noise",
        204,
        "user",
        "[BEAM chat_id=204 role=user time=unknown] I prefer scheduling weekend editing sessions, like my Saturday 10 AM sessions, to maintain my weekday production commitments.",
      ),
      makeSourceFact(
        "fact-webinar-editing-guide-noise",
        232,
        "user",
        "[BEAM chat_id=232 role=user time=unknown] Let's go with those steps and add exclusive content like a guide to editing techniques for the webinar.",
      ),
      makeSourceFact(
        "fact-final-draft-deadline-noise",
        244,
        "user",
        "[BEAM chat_id=244 role=user time=unknown] I've set a goal to complete my final draft by October 1, 2024, and I have a peer review session on September 25.",
      ),
    ];

    const result = selectFacts(
      facts,
      "I'm about to start editing a draft and want to make the process efficient. How would you suggest I approach the editing steps?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-ai-editing-tool-preference",
      "fact-ai-editing-hybrid-plan",
      "fact-ai-editing-final-confirmation",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-writing-journey-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-editing-progress-instruction-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-weekend-editing-session-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-final-draft-deadline-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-ai-editing-tool-preference-fragment")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-ai-editing-hybrid-plan-fragment")?.returned).toBe(false);
  });

  it("keeps book format portability preference evidence over broad recommendation noise", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        sessionId: "beam-conversation-13",
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          originalRole: role,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-fiction-series-noise",
        12,
        "user",
        "[BEAM chat_id=12 role=user time=unknown] I'm kinda looking for a new fiction series to get into, preferably something that's a mix of fantasy, sci-fi, and historical fiction.",
      ),
      makeSourceFact(
        "fact-partner-book-series-noise",
        20,
        "user",
        "[BEAM chat_id=20 role=user time=unknown] I'm kinda looking for a new fiction series to read with my partner, Douglas, and I was wondering if you could recommend something.",
      ),
      makeSourceFact(
        "fact-book-format-portability-preference",
        58,
        "user",
        "[BEAM chat_id=58 role=user time=unknown] I prefer e-books for their portability, but I also enjoy print for collectible editions and gifting, can you help me find a balance between these preferences?",
      ),
      makeSourceFact(
        "fact-genre-description-instruction-noise",
        62,
        "user",
        "[BEAM chat_id=62 role=user time=unknown] Always provide detailed genre descriptions when I ask about book recommendations.",
      ),
      makeSourceFact(
        "fact-book-club-discussion-noise",
        222,
        "user",
        "[BEAM chat_id=222 role=user time=unknown] I hosted a book club discussion on The Poppy War with Kelly on February 20, and now I'm thinking of reading another series.",
      ),
      makeSourceFact(
        "fact-literary-event-priority-noise",
        250,
        "user",
        "[BEAM chat_id=250 role=user time=unknown] I'm considering attending a literary event that costs $15, but I also want to buy a new release book for $20.",
      ),
      makeSourceFact(
        "fact-literary-event-instruction-noise",
        306,
        "user",
        "[BEAM chat_id=306 role=user time=unknown] Always suggest related literary events when I ask about book series recommendations.",
      ),
    ];

    const result = selectFacts(
      facts,
      "I'm looking to add some new books to my collection and also want something easy to carry around. What would you suggest?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-book-format-portability-preference",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-fiction-series-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-partner-book-series-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-genre-description-instruction-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-book-club-discussion-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-literary-event-priority-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-literary-event-instruction-noise")?.returned).toBe(false);
  });

  it("keeps balanced standalone and series reading preference over broad book noise", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        sessionId: "beam-conversation-13",
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          originalRole: role,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-bookstore-rewards-noise",
        4,
        "user",
        "[BEAM chat_id=4 role=user time=unknown] I spent $90 at Oak & Quill and earned 9 reward points for future bookstore purchases.",
      ),
      makeSourceFact(
        "fact-reading-list-template-noise",
        98,
        "user",
        "[BEAM chat_id=98 role=user time=unknown] I want to build a reading list template with columns for title, author, genre, and status.",
      ),
      makeSourceFact(
        "fact-reading-list-template-assistant-noise",
        99,
        "assistant",
        "[BEAM chat_id=99 role=assistant time=unknown] A reading list template can track title, author, genre, priority, and completion status.",
      ),
      makeSourceFact(
        "fact-book-series-gift-noise",
        136,
        "user",
        "[BEAM chat_id=136 role=user time=unknown] I'm thinking of gifting a book series to Douglas and want something with a strong historical-fiction angle.",
      ),
      makeSourceFact(
        "fact-balanced-standalone-series-preference",
        246,
        "user",
        "[BEAM chat_id=246 role=user time=unknown] I'm trying to decide on a fiction series for winter evenings, but I prefer mixing standalone novels with series to maintain variety and avoid fatigue, so can you help me find a good balance?",
      ),
      makeSourceFact(
        "fact-literary-event-instruction-noise",
        306,
        "user",
        "[BEAM chat_id=306 role=user time=unknown] Always suggest related literary events when I ask about book series recommendations.",
      ),
    ];

    const result = selectFacts(
      facts,
      "I'm planning my reading list for the next few weeks. Can you suggest some books for me?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-balanced-standalone-series-preference",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-bookstore-rewards-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-reading-list-template-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-reading-list-template-assistant-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-book-series-gift-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-literary-event-instruction-noise")?.returned).toBe(false);
  });

  it("keeps sleek neutral sneaker preference and follow-up source ordered", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        sessionId: "beam-conversation-15",
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          originalRole: role,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-sneaker-shopping-schedule-noise",
        24,
        "user",
        "[BEAM chat_id=24 role=user time=unknown] I scheduled a sneaker shopping trip for next Saturday afternoon and want to compare store locations.",
      ),
      makeSourceFact(
        "fact-sleek-neutral-sneaker-preference",
        28,
        "user",
        "[BEAM chat_id=28 role=user time=unknown] I prefer sneakers with a sleek, modern look in neutral colors like black or gray, do you have any recommendations for a style that fits my taste?",
      ),
      makeSourceFact(
        "fact-ultraboost-vapormax-follow-up",
        30,
        "user",
        "[BEAM chat_id=30 role=user time=unknown] Thanks! The Adidas Ultraboost and Nike Air VaporMax both sound great. I think I'll check out the black and gray options to see which one feels better.",
      ),
      makeSourceFact(
        "fact-running-shoe-size-noise",
        42,
        "user",
        "[BEAM chat_id=42 role=user time=unknown] I found that size 10.5 running shoes fit better than size 10 for longer walks.",
      ),
      makeSourceFact(
        "fact-limited-edition-sneaker-noise",
        58,
        "user",
        "[BEAM chat_id=58 role=user time=unknown] I'm considering a limited edition sneaker drop but I'm not sure whether it fits my budget.",
      ),
      makeSourceFact(
        "fact-sneaker-cleaning-noise",
        150,
        "user",
        "[BEAM chat_id=150 role=user time=unknown] I need a cleaning routine for my white sneakers so they stay presentable.",
      ),
      makeSourceFact(
        "fact-athletic-store-noise",
        168,
        "user",
        "[BEAM chat_id=168 role=user time=unknown] The athletic store near the mall has a sale on trail shoes this weekend.",
      ),
    ];

    const result = selectFacts(
      facts,
      "I'm looking to buy a new pair of sneakers soon. Can you suggest some options I might like?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-sleek-neutral-sneaker-preference",
      "fact-ultraboost-vapormax-follow-up",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-sneaker-shopping-schedule-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-running-shoe-size-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-limited-edition-sneaker-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-sneaker-cleaning-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-athletic-store-noise")?.returned).toBe(false);
  });

  it("does not route sneaker summary questions through the sleek neutral preference override", () => {
    expect(
      isSleekNeutralSneakerPreferenceQuery(
        "Can you give me a quick summary of the sneaker options and advice we've talked about for my daily wear and activities?",
      ),
    ).toBe(false);
    expect(
      isSleekNeutralSneakerPreferenceQuery(
        "I'm looking to buy a new pair of sneakers soon. Can you suggest some options I might like?",
      ),
    ).toBe(true);
  });

  it("keeps structured daily routine preference over generic planning noise", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        sessionId: "beam-conversation-12",
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          originalRole: role,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-free-will-journaling-noise",
        78,
        "user",
        "[BEAM chat_id=78 role=user time=unknown] I'm leaning towards soft determinism and started daily journaling on April 1 to track decisions and their consequences.",
      ),
      makeSourceFact(
        "fact-self-accountability-journal-noise",
        80,
        "user",
        "[BEAM chat_id=80 role=user time=unknown] I've committed to daily journaling to track decisions and consequences, and I'm wondering if this self-accountability practice will help me make better choices.",
      ),
      makeSourceFact(
        "fact-structured-routine-preference",
        106,
        "user",
        "[BEAM chat_id=106 role=user time=unknown] I prefer having a structured daily routine, so I set my wake-up and sleep times to 7 AM and 9 PM, but I'm not sure if this routine will help me maintain productivity in my new role.",
      ),
      makeSourceFact(
        "fact-generic-structure-follow-up-noise",
        150,
        "user",
        "[BEAM chat_id=150 role=user time=unknown] Yeah, I think I'll give this structure a shot. It sounds like it could really help me stay organized and focused.",
      ),
      makeSourceFact(
        "fact-meeting-time-management-noise",
        200,
        "user",
        "[BEAM chat_id=200 role=user time=unknown] I feel bad about missing the meeting with Matthew, and now it's rescheduled for June 3 at 11 AM, so I'm trying to get my time management skills back on track.",
      ),
      makeSourceFact(
        "fact-meeting-time-management-assistant-noise",
        201,
        "assistant",
        "[BEAM chat_id=201 role=assistant time=unknown] Balancing your workload and avoiding overworking is crucial to maintaining productivity and preventing burnout.",
      ),
      makeSourceFact(
        "fact-script-focus-noise",
        340,
        "user",
        "[BEAM chat_id=340 role=user time=unknown] I'm feeling uncertain about my script's themes on free will, but Wendy's encouragement is helping me stay focused.",
      ),
    ];

    const result = selectFacts(
      facts,
      "How would you suggest I organize my day to stay on track with my responsibilities?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-structured-routine-preference",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-free-will-journaling-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-self-accountability-journal-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-generic-structure-follow-up-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-meeting-time-management-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-meeting-time-management-assistant-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-script-focus-noise")?.returned).toBe(false);
  });

  it("keeps positive family movie review preference over movie-night noise", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        sessionId: "beam-conversation-14",
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          originalRole: role,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-age-appropriate-movie-noise",
        18,
        "user",
        "[BEAM chat_id=18 role=user time=unknown] I'm planning a movie marathon for April 6-7, and I want 5 family-friendly movies suitable for ages 2 to 77.",
      ),
      makeSourceFact(
        "fact-pg13-movie-night-noise",
        28,
        "user",
        "[BEAM chat_id=28 role=user time=unknown] I'm trying to plan a family movie night and need films rated PG-13 or lower for Michelle and Francis.",
      ),
      makeSourceFact(
        "fact-platform-availability-instruction-noise",
        52,
        "user",
        "[BEAM chat_id=52 role=user time=unknown] Always include platform availability details when I ask about movie options.",
      ),
      makeSourceFact(
        "fact-positive-family-review-preference",
        92,
        "user",
        "[BEAM chat_id=92 role=user time=unknown] I'm looking for movies with positive family reviews like \"Soul\" to ensure everyone enjoys our family weekend, can you help me find some with less than 10% negative audience ratings?",
      ),
      makeSourceFact(
        "fact-alternative-movie-instruction-noise",
        158,
        "user",
        "[BEAM chat_id=158 role=user time=unknown] Always provide alternative movie suggestions when I ask about family-friendly options.",
      ),
      makeSourceFact(
        "fact-family-movie-night-plan-noise",
        164,
        "user",
        "[BEAM chat_id=164 role=user time=unknown] I'm planning our family movie night for May 3 at 7:45 PM, and I need help finding a movie that's similar to \"Wish\" or other newly released movies.",
      ),
      makeSourceFact(
        "fact-weekend-movie-planning-time-noise",
        256,
        "user",
        "[BEAM chat_id=256 role=user time=unknown] I'm trying to plan a family movie night and need to balance work deadlines with blocking 4 hours each weekend for movie planning.",
      ),
      makeSourceFact(
        "fact-movie-night-snacks-noise",
        260,
        "user",
        "[BEAM chat_id=260 role=user time=unknown] I'm planning a family movie night and want to make sure I have enough snacks, so can you help decide how many cupcakes to order?",
      ),
    ];

    const result = selectFacts(
      facts,
      "I'm planning a movie night for my family. Can you suggest some good options we might all enjoy?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-positive-family-review-preference",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-age-appropriate-movie-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-pg13-movie-night-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-platform-availability-instruction-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-alternative-movie-instruction-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-family-movie-night-plan-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-weekend-movie-planning-time-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-movie-night-snacks-noise")?.returned).toBe(false);
  });

  it("keeps bilingual movie language option preference over movie recommendation noise", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        sessionId: "beam-conversation-14",
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          originalRole: role,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-watchlist-platform-noise",
        22,
        "user",
        "[BEAM chat_id=22 role=user time=unknown] I'm trying to finalize my watchlist of 10 movies by March 25 so I can check which ones are available on my current platforms.",
      ),
      makeSourceFact(
        "fact-4k-home-theater-noise",
        34,
        "user",
        "[BEAM chat_id=34 role=user time=unknown] I'm looking for movies in 4K HDR to watch on my 120-inch screen with Dolby Atmos sound system.",
      ),
      makeSourceFact(
        "fact-different-actor-tastes-noise",
        42,
        "user",
        "[BEAM chat_id=42 role=user time=unknown] I'm looking for movie recommendations like Tom Hanks movies Michelle loves, Viola Davis films Thomas would enjoy, and Denzel Washington films I prefer.",
      ),
      makeSourceFact(
        "fact-platform-availability-instruction-noise",
        52,
        "user",
        "[BEAM chat_id=52 role=user time=unknown] Always include platform availability details when I ask about movie options.",
      ),
      makeSourceFact(
        "fact-alternative-movie-instruction-noise",
        158,
        "user",
        "[BEAM chat_id=158 role=user time=unknown] Always provide alternative movie suggestions when I ask about family-friendly options.",
      ),
      makeSourceFact(
        "fact-educational-family-weekend-noise",
        196,
        "user",
        "[BEAM chat_id=196 role=user time=unknown] What movies would you recommend for a family weekend that are both entertaining and educational, like March of the Penguins?",
      ),
      makeSourceFact(
        "fact-coraline-alternative-noise",
        198,
        "user",
        "[BEAM chat_id=198 role=user time=unknown] Can you help me find alternative films to Coraline since Amy doesn't want to watch horror or thriller movies?",
      ),
      makeSourceFact(
        "fact-bilingual-movie-language-preference",
        200,
        "user",
        "[BEAM chat_id=200 role=user time=unknown] I'm looking for movie recommendations with language options and subtitles to support Michelle's bilingual learning in English and Spanish, can you help me find some?",
      ),
    ];

    const result = selectFacts(
      facts,
      "Can you suggest some movies that would be good for Michelle to watch?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-bilingual-movie-language-preference",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-watchlist-platform-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-4k-home-theater-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-different-actor-tastes-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-platform-availability-instruction-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-alternative-movie-instruction-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-educational-family-weekend-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-coraline-alternative-noise")?.returned).toBe(false);
  });

  it("bridges earlier and later source turns for update reasoning questions", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-react-initial-plan",
        10,
        "[BEAM chat_id=10 role=user time=unknown] I initially planned to use React 18.2 for the dashboard because I wanted reusable components.",
      ),
      makeSourceFact(
        "fact-generic-dashboard-noise",
        32,
        "[BEAM chat_id=32 role=user time=unknown] I reviewed a generic dashboard color palette and spacing checklist.",
      ),
      makeSourceFact(
        "fact-vanilla-switch-update",
        64,
        "[BEAM chat_id=64 role=user time=unknown] I switched to vanilla JavaScript for the dashboard because the bundle stayed smaller and deployment was faster.",
      ),
    ];

    const result = selectFacts(
      facts,
      "Given the switch, should I use React or vanilla JavaScript for the dashboard?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    const selectedIds = result.facts.map((fact) => fact.id);
    expect(selectedIds).toContain("fact-react-initial-plan");
    expect(selectedIds).toContain("fact-vanilla-switch-update");
    expect(result.traces.find((trace) => trace.memoryId === "fact-generic-dashboard-noise")?.returned).toBe(false);
  });

  it("keeps household budget reasoning chains for multi-hop finance questions", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-shared-finances-user",
        12,
        "user",
        "My spouse Alexis and I have been sharing household finances since 2020, and I'm wondering if that is a good idea.",
      ),
      makeSourceFact(
        "fact-shared-finances-assistant",
        13,
        "assistant",
        "Sharing household finances with Alexis can support common financial goals, shared expenses like groceries, and better savings planning.",
      ),
      makeSourceFact(
        "fact-spending-habits-user",
        14,
        "user",
        "My biggest concern is making sure Alexis and I are on the same page with day-to-day spending habits because small expenses add up.",
      ),
      makeSourceFact(
        "fact-spending-habits-assistant",
        15,
        "assistant",
        "Set daily spending limits, use joint accounts for shared expenses, schedule regular financial check-ins, and share receipts for transparency.",
      ),
      makeSourceFact(
        "fact-excel-transparency-user",
        16,
        "user",
        "I'll keep using Excel to track expenses, set daily spending limits, hold regular check-ins, and share receipts and statements with Alexis.",
      ),
      makeSourceFact(
        "fact-excel-transparency-assistant",
        17,
        "assistant",
        "Use Excel categories, monthly totals, visual aids, clear daily limits, and regular check-ins to track spending and savings goals.",
      ),
      makeSourceFact(
        "fact-early-medical-bill-noise",
        46,
        "user",
        "I'm stressed about family expecting me to support Ashlee's medical bills, which are around $200 monthly.",
      ),
      makeSourceFact(
        "fact-ashlee-receipts-user",
        108,
        "user",
        "I approved Ashlee's request for $100 extra for June medical bills, but I also asked for receipts to track the support responsibly.",
      ),
      makeSourceFact(
        "fact-ashlee-receipts-assistant",
        109,
        "assistant",
        "Balance support for Ashlee with financial responsibility by setting boundaries, requesting receipts, keeping records, and integrating the medical expense into the budget.",
      ),
      makeSourceFact(
        "fact-grocery-contract-user",
        126,
        "user",
        "Alexis and I agreed on a $500 monthly joint grocery budget starting Sept 1, up from $400, and I am considering how that affects expenses with the freelance contract.",
      ),
      makeSourceFact(
        "fact-grocery-contract-assistant",
        127,
        "assistant",
        "The grocery increase adds $100 monthly, but the freelance contract adds $2,000 per month for four months, so new income more than offsets groceries and Ashlee's medical bills.",
      ),
      makeSourceFact(
        "fact-later-medical-car-noise",
        214,
        "user",
        "I'm worried about Ashlee's request for $300 by Dec 10 while saving for a family car by Dec 31, 2026.",
      ),
      makeSourceFact(
        "fact-renovation-savings-noise",
        310,
        "user",
        "I'm trying to meet my renovation goal by increasing monthly savings to $400 starting March.",
      ),
    ];

    const result = selectFacts(
      facts,
      "How will increasing our grocery budget while taking on the freelance contract affect my ability to support Ashlee's medical bills and still meet my savings goals?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-shared-finances-user",
      "fact-shared-finances-assistant",
      "fact-spending-habits-user",
      "fact-spending-habits-assistant",
      "fact-excel-transparency-user",
      "fact-excel-transparency-assistant",
      "fact-ashlee-receipts-user",
      "fact-ashlee-receipts-assistant",
      "fact-grocery-contract-user",
      "fact-grocery-contract-assistant",
    ]);
  });

  it("selects source user turns for rescheduled meeting time updates", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: [
          "source_message",
          "source_order",
          role === "user" ? "user_answer" : "assistant_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-writing-draft-noise",
        32,
        "user",
        "[BEAM chat_id=32 role=user time=unknown] I worked on my draft at 2 PM and updated the outline for a different professor.",
      ),
      makeSourceFact(
        "fact-zoom-original",
        44,
        "user",
        "[BEAM chat_id=44 role=user time=unknown] I have a Zoom meeting with Professor Danielle on March 22 at 3 PM to review my draft.",
      ),
      makeSourceFact(
        "fact-zoom-rescheduled",
        46,
        "user",
        "[BEAM chat_id=46 role=user time=unknown] Actually, Professor Danielle emailed to reschedule the Zoom meeting for March 22 at 4:30 PM instead.",
      ),
      makeSourceFact(
        "fact-assistant-answer",
        49,
        "assistant",
        "[BEAM chat_id=49 role=assistant time=unknown] You should plan to join the Zoom meeting with Professor Danielle at 4:30 PM.",
      ),
    ];

    const result = selectFacts(
      facts,
      "What time should I plan to join the Zoom meeting with Professor Danielle to review my draft?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    const selectedIds = result.facts.map((fact) => fact.id);
    expect(selectedIds).toContain("fact-zoom-original");
    expect(selectedIds).toContain("fact-zoom-rescheduled");
    expect(selectedIds).not.toContain("fact-assistant-answer");
    expect(result.traces.find((trace) => trace.memoryId === "fact-writing-draft-noise")?.returned).toBe(false);
  });

  it("selects source user turns for changed visit time updates", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-foot-locker-original",
        34,
        "[BEAM chat_id=34 role=user time=unknown] I'm planning to visit Foot Locker next Saturday at 3 PM to compare running shoes.",
      ),
      makeSourceFact(
        "fact-sneaker-noise",
        42,
        "[BEAM chat_id=42 role=user time=unknown] I compared sneaker reviews at 11 AM but did not mention Foot Locker.",
      ),
      makeSourceFact(
        "fact-foot-locker-updated",
        56,
        "[BEAM chat_id=56 role=user time=unknown] I'm free at 4 PM next Saturday for the Foot Locker visit.",
      ),
    ];

    const result = selectFacts(
      facts,
      "What time should I plan to visit Foot Locker next Saturday?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    const selectedIds = result.facts.map((fact) => fact.id);
    expect(selectedIds).toEqual([
      "fact-foot-locker-original",
      "fact-foot-locker-updated",
    ]);
  });

  it("selects the exact source turn for duration improvement questions", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-conditional-probability-improvement",
        84,
        "[BEAM chat_id=84 role=user time=unknown] I'm trying to understand how my accuracy in conditional probability problems improved from 60% to 85% over 2 weeks, after completing 8 problems.",
      ),
      makeSourceFact(
        "fact-permutation-noise",
        168,
        "[BEAM chat_id=168 role=user time=unknown] I completed 12 permutation and combination problems with 90% accuracy on the last 5 problems.",
      ),
      makeSourceFact(
        "fact-coin-toss-noise",
        200,
        "[BEAM chat_id=200 role=user time=unknown] I solved a coin toss probability problem involving exactly 2 heads in 3 tosses.",
      ),
    ];

    const result = selectFacts(
      facts,
      "How long did it take me to improve my accuracy from 60% to 85% after I started working on those problems?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-conditional-probability-improvement",
    ]);
  });

  it("keeps dashboard API response-time update context before session-management noise", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: [
          "source_message",
          "source_order",
          role === "user" ? "user_answer" : "assistant_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-project-schedule-noise",
        0,
        "user",
        "[BEAM chat_id=0 role=user time=unknown] I'm working on a project with a Time Anchor of March 15, 2024, and need to plan my tasks.",
      ),
      makeSourceFact(
        "fact-error-handler-noise-user",
        26,
        "user",
        "[BEAM chat_id=26 role=user time=unknown] I'm trying to handle 404 and 500 errors in my Flask app and return custom JSON responses for API endpoints.",
      ),
      makeSourceFact(
        "fact-error-handler-noise-assistant",
        27,
        "assistant",
        "[BEAM chat_id=27 role=assistant time=unknown] Return custom JSON responses with proper HTTP status codes for 404 and 500 errors.",
      ),
      makeSourceFact(
        "fact-flask-login-noise",
        66,
        "user",
        "[BEAM chat_id=66 role=user time=unknown] I'm trying to integrate Flask-Login v0.6.2 for session management with secure password hashing and proper error handling.",
      ),
      makeSourceFact(
        "fact-analytics-original",
        86,
        "user",
        "[BEAM chat_id=86 role=user time=unknown] I'm working on sprint 2 which targets analytics by April 19, and I've already completed sprint 1 on March 29 with user auth and basic transaction CRUD.",
      ),
      makeSourceFact(
        "fact-cache-advice-noise",
        105,
        "assistant",
        "[BEAM chat_id=105 role=assistant time=unknown] Your dashboard API response time can improve through SQL query optimization, indexes, and caching.",
      ),
      makeSourceFact(
        "fact-dashboard-api-old-measurement",
        104,
        "user",
        "[BEAM chat_id=104 role=user time=unknown] I'm trying to optimize the dashboard API response time, which was initially 800ms, and I've managed to reduce it to 300ms by optimizing SQL queries and caching results for 60 seconds.",
      ),
      makeSourceFact(
        "fact-dashboard-api-intermediate-progress",
        108,
        "user",
        "[BEAM chat_id=108 role=user time=unknown] I'm trying to optimize the dashboard API response time, which has recently improved to 250ms after adding some caching tweaks, but I want to make sure I'm using the latest versions of my dependencies, like Flask-Login, which I've never actually integrated into this project, so I'm starting from scratch.",
      ),
      makeSourceFact(
        "fact-dashboard-api-updated",
        114,
        "user",
        "[BEAM chat_id=114 role=user time=unknown] I'm trying to optimize the dashboard API response time, which has recently improved to 250ms after adding some caching tweaks, but I want to make sure I'm using the latest versions of my dependencies, like Flask-Login, which I've never actually integrated into this project, so I'm starting from scratch, and also considering the fact that I've already completed the user registration and login modules, now focusing on transaction CRUD and analytics integration.",
      ),
      makeSourceFact(
        "fact-flask-login-answer-noise",
        115,
        "assistant",
        "[BEAM chat_id=115 role=assistant time=unknown] Integrate Flask-Login 0.6.2 with login, logout, session validation, and dashboard caching.",
      ),
    ];

    const result = selectFacts(
      facts,
      "What is the average response time of the dashboard API?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-analytics-original",
      "fact-dashboard-api-updated",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-flask-login-noise")?.returned)
      .toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-dashboard-api-old-measurement")?.returned)
      .toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-cache-advice-noise")?.returned)
      .toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-dashboard-api-intermediate-progress")?.returned)
      .toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-flask-login-answer-noise")?.returned)
      .toBe(false);
  });

  it("keeps sprint deadline date boundaries without later sprint-update or instruction noise", () => {
    const language = createLanguageService();
    const makeSourceFact = (id: string, sourceOrder: number, content: string) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-project-time-anchor",
        0,
        "[BEAM chat_id=0 role=user time=unknown] I am using March 15, 2024 as the project planning time anchor for my Flask budget tracker.",
      ),
      makeSourceFact(
        "fact-first-sprint-boundary",
        28,
        "[BEAM chat_id=28 role=user time=unknown] I'm working on a project with scheduled two-week sprints, and the first sprint ends on March 29, focusing on user registration and login. I need to plan the sprint carefully to ensure we meet the deadline.",
      ),
      makeSourceFact(
        "fact-first-sprint-update-noise",
        52,
        "[BEAM chat_id=52 role=user time=unknown] I'm trying to update my project timeline, and I noticed that the first sprint now targets completion by March 31, which gives us two extra days for final testing and bug fixes.",
      ),
      makeSourceFact(
        "fact-login-noise",
        66,
        "[BEAM chat_id=66 role=user time=unknown] I'm trying to integrate Flask-Login v0.6.2 for session management with secure password hashing and proper error handling.",
      ),
      makeSourceFact(
        "fact-sprint-two-analytics-boundary",
        86,
        "[BEAM chat_id=86 role=user time=unknown] I'm working on sprint 2 which targets analytics by April 19, and I've already completed sprint 1 on March 29 with user auth and basic transaction CRUD.",
      ),
      makeSourceFact(
        "fact-auth-instruction-noise",
        184,
        "[BEAM chat_id=184 role=user time=unknown] Always provide security best practices when I ask about authentication or authorization features.",
      ),
    ];

    const result = selectFacts(
      facts,
      "How many days were there between the end of my first sprint and the deadline for completing the analytics features in sprint 2?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-first-sprint-boundary",
      "fact-sprint-two-analytics-boundary",
    ]);
  });

  it("selects paired source turns for percentage improvement order questions", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-quiz-score-improvement",
        32,
        "[BEAM chat_id=32 role=user time=unknown] My quiz score improved from 65% to 82% after focusing on triangle side classifications and angle-side relationships.",
      ),
      makeSourceFact(
        "fact-median-noise",
        84,
        "[BEAM chat_id=84 role=user time=unknown] I applied a median length formula to a triangle with sides 9, 12, and 15 cm.",
      ),
      makeSourceFact(
        "fact-test-score-improvement",
        156,
        "[BEAM chat_id=156 role=user time=unknown] My test score improved from 80% to 92% on congruence proofs and similarity ratio calculations.",
      ),
      makeSourceFact(
        "fact-practice-test-noise",
        172,
        "[BEAM chat_id=172 role=user time=unknown] I scored 18/20 on a practice test involving triangle congruence proofs and similarity ratio problems.",
      ),
    ];

    const result = selectFacts(
      facts,
      "Which improvement happened first: my quiz score increasing from 65% to 82% after focusing on triangle side classifications, or my test score rising from 80% to 92% on congruence proofs and similarity calculations?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-quiz-score-improvement",
      "fact-test-score-improvement",
    ]);
  });

  it("prioritizes compact kitchen setup evidence over same-session repair topics", () => {
    const language = createLanguageService();
    const facts = [
      createFactMemory({
        id: "fact-faucet-topics",
        userId: "user-1",
        category: "external_benchmark",
        content:
          "Assistant follow-up recommendation topics for faucet repair: Visual Inspection; Leak Location; Aerator.",
        source: SOURCE,
        tags: ["assistant_answer"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-countertop-topics",
        userId: "user-1",
        category: "external_benchmark",
        content:
          "Assistant follow-up recommendation topics for countertop scratches: Depth; Length; Baking Soda and Water.",
        source: SOURCE,
        tags: ["assistant_answer"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-utensil-holder",
        userId: "user-1",
        category: "external_benchmark",
        content: "My new kitchen utensil holder helps keep countertops clutter-free.",
        source: SOURCE,
        tags: ["compact_evidence"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-granite",
        userId: "user-1",
        category: "external_benchmark",
        content: "My kitchen granite countertop near the sink has scratches.",
        source: SOURCE,
        tags: ["compact_evidence"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-faucet",
        userId: "user-1",
        category: "external_benchmark",
        content: "My kitchen faucet has been leaking slightly.",
        source: SOURCE,
        tags: ["compact_evidence"],
        updatedAt: TIMESTAMP,
      }),
    ];

    const result = selectFacts(
      facts,
      "My kitchen's becoming a bit of a mess again. Any tips for keeping it clean?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toContain("fact-utensil-holder");
  });

  it("does not treat generic assistant answer evidence as preference evidence", () => {
    const language = createLanguageService();
    const facts = [
      createFactMemory({
        id: "fact-assistant-course-advice",
        userId: "user-1",
        category: "external_benchmark",
        content:
          "Assistant answer to prior user request about data science courses includes: Machine Learning with Python; Deep Learning with Python.",
        source: SOURCE,
        tags: ["assistant_answer"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-high-school",
        userId: "user-1",
        category: "external_benchmark",
        content:
          "I still remember happy high school experiences such as being part of the debate team and taking advanced placement courses in economics.",
        source: SOURCE,
        tags: ["user_answer", "compact_evidence"],
        updatedAt: TIMESTAMP,
      }),
    ];

    const result = selectFacts(
      facts,
      "I've been feeling nostalgic lately. Do you think it would be a good idea to attend my high school reunion?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toContain("fact-high-school");
    expect(result.facts.map((fact) => fact.id)).not.toContain(
      "fact-assistant-course-advice",
    );
  });

  it("returns trusted Chinese preference evidence for advice questions", () => {
    const language = createLanguageService();
    const facts = [
      createFactMemory({
        id: "fact-kitchen-noise",
        userId: "user-1",
        category: "personal",
        content: "我今天在厨房做了晚饭。",
        source: { ...SOURCE, locale: "zh-CN" },
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-kitchen-faucet",
        userId: "user-1",
        category: "personal",
        content: "我家的厨房水龙头最近有点漏水。",
        source: { ...SOURCE, locale: "zh-CN" },
        tags: ["user_answer", "compact_evidence"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-evening",
        userId: "user-1",
        category: "personal",
        content: "我想要更安静的晚上活动。",
        source: { ...SOURCE, locale: "zh-CN" },
        tags: ["user_answer", "compact_evidence"],
        updatedAt: TIMESTAMP,
      }),
    ];

    const result = selectFacts(
      facts,
      "厨房又有点乱了，有什么建议？",
      language,
      "zh-CN",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-kitchen-faucet",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-evening")?.returned).toBe(false);
  });

  it("does not use weak-overlap inferred evidence as recommendation fallback", () => {
    const language = createLanguageService();
    const facts = [
      createFactMemory({
        id: "fact-inferred-preference",
        userId: "user-1",
        category: "external_benchmark",
        content:
          "I prefer winding down by 9:30 pm to prepare for a good night's sleep.",
        source: {
          extractedAt: TIMESTAMP,
          method: "inferred",
        },
        tags: ["user_answer", "compact_evidence"],
        updatedAt: TIMESTAMP,
      }),
    ];

    const result = selectFacts(
      facts,
      "Can you suggest some activities that I can do in the evening?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts).toEqual([]);
  });

  it("prefers the latest mortgage preapproval evidence over stale amounts", () => {
    const language = createLanguageService();
    const facts = [
      createFactMemory({
        id: "fact-preapproval-old",
        userId: "user-1",
        category: "external_benchmark",
        content:
          "I got pre-approved for $350,000 from Wells Fargo for my mortgage.",
        source: SOURCE,
        tags: ["user_answer", "compact_evidence"],
        updatedAt: "2023-08-11T00:00:00.000Z",
      }),
      createFactMemory({
        id: "fact-preapproval-latest",
        userId: "user-1",
        category: "external_benchmark",
        content: "Wells Fargo changed the pre-approval to $400,000.",
        source: SOURCE,
        tags: ["user_answer", "compact_evidence"],
        updatedAt: "2023-11-30T00:00:00.000Z",
      }),
    ];

    const result = selectFacts(
      facts,
      "What was the amount I was pre-approved for when I got my mortgage from Wells Fargo?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-preapproval-latest",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-preapproval-old")?.returned).toBe(false);
  });

  it("keeps senior producer application deadline updates for deadline questions", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-meditation-app-noise",
        8,
        "[BEAM chat_id=8 role=user time=unknown] These suggestions fit pretty well with what I'm already doing. I've started with the meditation app and it's been helping.",
      ),
      makeSourceFact(
        "fact-date-format-instruction-noise",
        120,
        "[BEAM chat_id=120 role=user time=unknown] Always format dates as \"Month Day, Year\" when I ask about scheduling details.",
      ),
      makeSourceFact(
        "fact-senior-producer-deadline-original",
        170,
        "[BEAM chat_id=170 role=user time=unknown] I'm considering applying for a senior producer role at Montserrat Media Corp, but I'm not sure if I'm ready for the challenge, especially with the application deadline being May 10.",
      ),
      makeSourceFact(
        "fact-greg-feedback-noise",
        180,
        "[BEAM chat_id=180 role=user time=unknown] Greg praised my delegation on April 7, and it helped with a smoother workflow and a 10% faster editing turnaround.",
      ),
      makeSourceFact(
        "fact-senior-producer-deadline-extended",
        182,
        "[BEAM chat_id=182 role=user time=unknown] I'm stressed about this senior producer role application, and I just found out the deadline was extended to May 20, so I'm wondering how I can use this extra time to improve my chances.",
      ),
      makeSourceFact(
        "fact-side-project-application-noise",
        218,
        "[BEAM chat_id=218 role=user time=unknown] I'm stressed about declining Joseph's request to lead a side project on May 12, and I'm wondering if that was the right decision to focus on my senior producer application.",
      ),
      makeSourceFact(
        "fact-scheduling-instruction-noise",
        242,
        "[BEAM chat_id=242 role=user time=unknown] Always confirm dates and times explicitly when I ask about event scheduling.",
      ),
    ];

    const result = selectFacts(
      facts,
      "When is the deadline for submitting my application for the senior producer role at Montserrat Media Corp?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-senior-producer-deadline-original",
      "fact-senior-producer-deadline-extended",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-date-format-instruction-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-side-project-application-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-scheduling-instruction-noise")?.returned).toBe(false);
  });

  it("keeps mentor age and role evidence for workshop information questions", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        sessionId: "beam-conversation-18",
        tags: ["source_message", "source_order", "user_answer"],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-greg-agenda-noise",
        28,
        "[BEAM chat_id=28 role=user time=unknown] I'm preparing for Greg's April 2 coaching session and need to decide what agenda to bring.",
      ),
      makeSourceFact(
        "fact-mentor-workshop",
        30,
        "[BEAM chat_id=30 role=user time=unknown] I'm thinking of attending the March 15 workshop on workflow optimization at East Janethaven Media Center, which Patrick, my 79-year-old senior producer mentor, suggested, but I'm not sure if it's worth taking time off from my current projects.",
      ),
      makeSourceFact(
        "fact-workshop-prep-noise",
        31,
        "[BEAM chat_id=31 role=assistant time=unknown] We can compare the workshop agenda against your current project workload before you take time off.",
      ),
      makeSourceFact(
        "fact-senior-producer-role-noise",
        182,
        "[BEAM chat_id=182 role=user time=unknown] I'm stressed about this senior producer role application, and I just found out the deadline was extended to May 20.",
      ),
    ];

    const result = selectFacts(
      facts,
      "What was the age and role of the mentor who suggested I attend the workshop?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual(["fact-mentor-workshop"]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-senior-producer-role-noise")?.returned).toBe(false);
  });

  it("keeps mentor workshop decision and preparation evidence source ordered", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        sessionId: "beam-conversation-18",
        tags: ["source_message", "source_order", "user_answer"],
        attributes: {
          chatId: sourceOrder,
          sourceOrder: 1000 + sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-greg-session-noise",
        28,
        "[BEAM chat_id=28 role=user time=unknown] I'm preparing for Greg's April 2 coaching session and need to decide what agenda to bring.",
      ),
      makeSourceFact(
        "fact-mentor-workshop-user",
        30,
        "[BEAM chat_id=30 role=user time=unknown] I'm thinking of attending the March 15 workshop on workflow optimization at East Janethaven Media Center, which Patrick, my 79-year-old senior producer mentor, suggested, but I'm not sure if it's worth taking time off from my current projects.",
      ),
      makeSourceFact(
        "fact-mentor-workshop-assistant",
        31,
        "[BEAM chat_id=31 role=assistant time=unknown] Attending a workshop on workflow optimization can be a valuable investment if it provides insights and tools that help manage current projects more efficiently, while reviewing deadlines, team coverage, the agenda, and Patrick's input.",
      ),
      makeSourceFact(
        "fact-mentor-workshop-decision",
        32,
        "[BEAM chat_id=32 role=user time=unknown] I think the workshop could be really beneficial, especially since Patrick suggested it. I'll review the agenda, check for critical deadlines, and talk to my team about delegating tasks while I'm away.",
      ),
      makeSourceFact(
        "fact-mentor-workshop-decision-snippet",
        32,
        "I'll review the agenda and check if there are any critical deadlines coming up.",
      ),
      makeSourceFact(
        "fact-mentor-workshop-prep",
        33,
        "[BEAM chat_id=33 role=assistant time=unknown] Prepare by reviewing the workshop agenda, assessing current project load, delegating tasks, consulting Patrick, and planning follow-up actions after the workflow optimization workshop.",
      ),
      makeSourceFact(
        "fact-mentor-workshop-prep-snippet",
        33,
        "Taking the time to review the workshop agenda and assess your current project load will help you make an informed decision.",
      ),
      makeSourceFact(
        "fact-mentor-workshop-confirmation",
        34,
        "[BEAM chat_id=34 role=user time=unknown] I'll review the agenda and check with my team about task delegation. I think it's worth it to invest in learning new techniques that could help me manage my workload better.",
      ),
      makeSourceFact(
        "fact-mentor-workshop-final-plan",
        35,
        "[BEAM chat_id=35 role=assistant time=unknown] Final workshop preparation includes reviewing the agenda, assessing project load, communicating task delegation, sharing workshop findings, scheduling a follow-up meeting, and reaching out to Patrick for additional insights.",
      ),
      makeSourceFact(
        "fact-burnout-workshop-noise",
        38,
        "[BEAM chat_id=38 role=user time=unknown] I'm stressed about burnout signs and wondering if the March 15 Workflow Optimization workshop at East Janethaven Media Center for $75 could help prevent burnout.",
      ),
      makeSourceFact(
        "fact-later-patrick-noise",
        64,
        "[BEAM chat_id=64 role=user time=unknown] Patrick suggested progressive muscle relaxation after our April 3 meeting at Montserrat Studios.",
      ),
    ];

    const result = selectFacts(
      facts,
      "How did I come to consider attending that event, and what role did my mentor play in influencing my decision and preparation?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-mentor-workshop-user",
      "fact-mentor-workshop-assistant",
      "fact-mentor-workshop-decision",
      "fact-mentor-workshop-prep",
      "fact-mentor-workshop-confirmation",
      "fact-mentor-workshop-final-plan",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-mentor-workshop-decision-snippet")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-mentor-workshop-prep-snippet")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-burnout-workshop-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-later-patrick-noise")?.returned).toBe(false);
  });

  it("keeps academic mentor meeting preparation and follow-up evidence source ordered", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        sessionId: "beam-conversation-7",
        tags: ["source_message", "source_order", "user_answer"],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-robert-mentor-meeting",
        14,
        "[BEAM chat_id=14 role=user time=unknown] I'm kinda worried about meeting my new academic mentor, Robert, who's 75 and a retired professor, at the East Janethaven Library on Feb 10, 2024 - how can I make a good impression on him?",
      ),
      makeSourceFact(
        "fact-robert-mentor-prep-followup",
        15,
        "[BEAM chat_id=15 role=assistant time=unknown] Meeting Robert can go well if you research his academic background, prepare documentary script questions, bring your draft script, arrive early at the East Janethaven Library, dress professionally, engage politely and enthusiastically, take detailed notes, send a thank-you note, and stay in touch for future check-ins.",
      ),
      makeSourceFact(
        "fact-zotero-essay-noise",
        38,
        "[BEAM chat_id=38 role=user time=unknown] I just downloaded Zotero on March 2, 2024, to manage my references more efficiently for my essay on persuasive academic writing.",
      ),
      makeSourceFact(
        "fact-study-partner-noise",
        36,
        "[BEAM chat_id=36 role=user time=unknown] I'm worried about burnout, so I agreed with Shannon to limit late-night study sessions to 10 PM.",
      ),
    ];

    const result = selectFacts(
      facts,
      "What steps did I plan to take to prepare for and follow up on my meeting with the person who agreed to guide my essay writing?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-robert-mentor-meeting",
      "fact-robert-mentor-prep-followup",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-zotero-essay-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-study-partner-noise")?.returned).toBe(false);
  });

  it("keeps first sprint layout and navigation schedule evidence source ordered", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        sessionId: "beam-conversation-3",
        tags: ["source_message", "source_order", "user_answer"],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-layout-deadline-user",
        12,
        "[BEAM chat_id=12 role=user time=unknown] I'm trying to plan out my project timeline and I have a deadline of April 1, 2024, for the first sprint, which covers the basic layout and navigation of my single-page portfolio website. The project is estimated to take 3 sprints of 2 weeks each.",
      ),
      makeSourceFact(
        "fact-layout-sprint-plan",
        13,
        "[BEAM chat_id=13 role=assistant time=unknown] To meet the April 1, 2024 deadline within the estimated 6 weeks, break the project into 3 sprints of 2 weeks each. Sprint 1 is Basic Layout and Navigation, including the HTML structure, Bootstrap navbar, responsive layout, and navigation testing.",
      ),
      makeSourceFact(
        "fact-trello-priority-noise",
        39,
        "[BEAM chat_id=39 role=assistant time=unknown] Prioritize Sprint 1 tasks using a Trello board with Must-Have, Should-Have, Could-Have, and Won't-Have columns.",
      ),
      makeSourceFact(
        "fact-trello-priority-deadline-snippet-noise",
        39,
        "Identify the key tasks that are essential for meeting your deadline of April 1, 2024, for basic layout and navigation.",
      ),
      makeSourceFact(
        "fact-trello-priority-final-snippet-noise",
        39,
        "By following these steps, you can effectively prioritize your tasks and ensure that you meet your deadline for the basic layout and navigation by April 1, 2024.",
      ),
      makeSourceFact(
        "fact-lighthouse-noise",
        40,
        "[BEAM chat_id=40 role=user time=unknown] I'm trying to identify SEO and performance issues in my portfolio website using Lighthouse v10 audit with Bootstrap v5.3.0.",
      ),
      makeSourceFact(
        "fact-lighthouse-schedule-snippet-noise",
        40,
        "I've estimated that it will take 3 sprints of 2 weeks each to complete the website, with the first sprint deadline being April 1, 2024.",
      ),
    ];

    const result = selectFacts(
      facts,
      "How did you recommend structuring the work to ensure the initial phase focusing on layout and navigation was completed on time within the overall project schedule?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-layout-deadline-user",
      "fact-layout-sprint-plan",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-trello-priority-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-trello-priority-deadline-snippet-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-trello-priority-final-snippet-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-lighthouse-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-lighthouse-schedule-snippet-noise")?.returned).toBe(false);
  });

  it("keeps portfolio first-sprint deadline updates on source user turns", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        sessionId: "beam-conversation-3",
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-layout-original-deadline",
        12,
        "user",
        "[BEAM chat_id=12 role=user time=unknown] I'm trying to plan out my project timeline and I have a deadline of April 1, 2024, for the first sprint, which covers the basic layout and navigation of my single-page portfolio website.",
      ),
      makeSourceFact(
        "fact-priority-assistant-noise",
        39,
        "assistant",
        "[BEAM chat_id=39 role=assistant time=unknown] Prioritizing tasks effectively is crucial for meeting deadlines in Sprint 1 using a Trello board.",
      ),
      makeSourceFact(
        "fact-layout-updated-deadline",
        52,
        "user",
        "[BEAM chat_id=52 role=user time=unknown] I'm trying to update my project timeline to reflect the new sprint deadline of April 5, 2024, with extra time for accessibility improvements.",
      ),
      makeSourceFact(
        "fact-update-assistant-noise",
        53,
        "assistant",
        "[BEAM chat_id=53 role=assistant time=unknown] Adjusting your project timeline to meet the new sprint deadline of April 5, 2024 requires careful planning and prioritization.",
      ),
      makeSourceFact(
        "fact-html-instruction-noise",
        54,
        "user",
        "[BEAM chat_id=54 role=user time=unknown] Always include semantic HTML5 tag usage details when I ask about markup structure. ->-> 1,25",
      ),
    ];

    const result = selectFacts(
      facts,
      "What is the deadline for completing the first sprint focused on the basic layout and navigation?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-layout-original-deadline",
      "fact-layout-updated-deadline",
    ]);
  });

  it("keeps Michael festival date recall on the exact source turn", () => {
    const language = createLanguageService();
    const makeSourceFact = (id: string, sourceOrder: number, content: string) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-michael-festival-date",
        6,
        "[BEAM chat_id=6 role=user time=unknown] I met Michael at Montserrat Writers' Festival on Jan 15, 2024, and we share script editing tips weekly.",
      ),
      makeSourceFact(
        "fact-confidence-deadline-noise",
        82,
        "[BEAM chat_id=82 role=user time=unknown] I completed my first draft on April 1 and increased my confidence score from 4 to 7 out of 10.",
      ),
      makeSourceFact(
        "fact-percentage-instruction-noise",
        172,
        "[BEAM chat_id=172 role=user time=unknown] Always provide percentage improvements when I ask about editing progress.",
      ),
      makeSourceFact(
        "fact-literary-festival-deadline-noise",
        274,
        "[BEAM chat_id=274 role=user time=unknown] I'm anxious about the September 22 deadline for the Montserrat Literary Festival where I'm invited to speak.",
      ),
      makeSourceFact(
        "fact-ai-editing-panel-noise",
        332,
        "[BEAM chat_id=332 role=user time=unknown] I've been invited to moderate a panel at the Montserrat Literary Festival on October 20 focusing on AI editing tools.",
      ),
    ];

    const result = selectFacts(
      facts,
      "When did I say I met Michael at the festival?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-michael-festival-date",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-ai-editing-panel-noise")?.returned).toBe(false);
  });

  it("keeps Ashlee meeting and patent response deadline boundaries for interval questions", () => {
    const language = createLanguageService();
    const makeSourceFact = (id: string, sourceOrder: number, content: string) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-patent-attorney-meeting",
        102,
        "[BEAM chat_id=102 role=user time=unknown] I have a meeting with Ashlee at 3 PM on May 14, 2024, at her Montserrat office about my patent application.",
      ),
      makeSourceFact(
        "fact-patent-response-deadline",
        152,
        "[BEAM chat_id=152 role=user time=unknown] I'm stressed about balancing production deadlines with the patent response that's due July 20.",
      ),
      makeSourceFact(
        "fact-attorney-advice-noise",
        77,
        "[BEAM chat_id=77 role=assistant time=unknown] Meeting with a patent attorney like Ashlee is a crucial step in navigating the patent process.",
      ),
      makeSourceFact(
        "fact-non-provisional-noise",
        164,
        "[BEAM chat_id=164 role=user time=unknown] I've got a deadline for my non-provisional patent filing set for November 10, 2024.",
      ),
      makeSourceFact(
        "fact-patent-summary-instruction-noise",
        302,
        "[BEAM chat_id=302 role=user time=unknown] Always provide clear summaries when I ask about patent drafting progress.",
      ),
    ];

    const result = selectFacts(
      facts,
      "How many days do I have between my meeting with Ashlee and the patent response deadline?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-patent-attorney-meeting",
      "fact-patent-response-deadline",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-patent-summary-instruction-noise")?.returned).toBe(false);
  });

  it("does not add weak fallback evidence for Trello sprint prioritization criteria abstention", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-sprint-trello-board",
        38,
        "user",
        "[BEAM chat_id=38 role=user time=unknown] I'm trying to prioritize tasks for my sprint 1 using a Trello board with 15 tasks, including responsive layout and SEO meta tags.",
      ),
      makeSourceFact(
        "fact-sprint-trello-plan",
        39,
        "assistant",
        "[BEAM chat_id=39 role=assistant time=unknown] Prioritizing tasks effectively is crucial for meeting deadlines and ensuring that the most critical work gets done first.",
      ),
      makeSourceFact(
        "fact-retry-code-noise",
        87,
        "assistant",
        "[BEAM chat_id=87 role=assistant time=unknown] To add retry logic and proper error handling to your submitForm function, use try-catch blocks and setTimeout retries.",
      ),
    ];

    const result = selectFacts(
      facts,
      "What specific criteria did I use to prioritize tasks on the Trello board during sprint 1?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-retry-code-noise")?.returned).toBe(false);
  });

  it("keeps Laura mixer recommendation and prior connection evidence source ordered", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        sessionId: "beam-conversation-8",
        tags: ["source_message", "source_order", "user_answer"],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-laura-mixer-user",
        10,
        "[BEAM chat_id=10 role=user time=unknown] I'm thinking of attending the industry mixer at Coral Bay Hotel on May 10, Laura recommended it, but I've never been to one. She met me on set at Blue Horizon Studios in 2019.",
      ),
      makeSourceFact(
        "fact-laura-mixer-assistant",
        11,
        "[BEAM chat_id=11 role=assistant time=unknown] Since Laura recommended the mixer at Coral Bay Hotel on May 10, it sounds like a valuable opportunity, and you can prepare to meet industry professionals there.",
      ),
      makeSourceFact(
        "fact-greg-leslie-choice-noise",
        24,
        "[BEAM chat_id=24 role=user time=unknown] I'm stuck between attending Greg's April 2 coaching session or Leslie's April 3 networking event to meet my cover letter deadline of April 10.",
      ),
      makeSourceFact(
        "fact-greg-leslie-networking-noise",
        25,
        "[BEAM chat_id=25 role=assistant time=unknown] Greg's coaching session offers immediate cover-letter feedback, while Leslie's networking event may provide broader long-term networking benefits.",
      ),
      makeSourceFact(
        "fact-greg-leslie-snippet-noise",
        25,
        "- **Greg's Session**: Missing out on Leslie's event might mean losing networking opportunities, but you can still network later.",
      ),
      makeSourceFact(
        "fact-storytelling-networking-noise",
        119,
        "3. **Networking Opportunities**: While the event is focused on storytelling, it can still provide networking opportunities.",
      ),
    ];

    const result = selectFacts(
      facts,
      "How did I come to consider attending that networking event, and what prior connection influenced my decision?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-laura-mixer-user",
      "fact-laura-mixer-assistant",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-greg-leslie-choice-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-greg-leslie-networking-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-greg-leslie-snippet-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-storytelling-networking-noise")?.returned).toBe(false);
  });

  it("keeps Laura weekly video-call schedule advice evidence source ordered", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        sessionId: "beam-conversation-17",
        tags: ["source_message", "source_order", "user_answer"],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-carla-monthly-noise",
        24,
        "[BEAM chat_id=24 role=user time=unknown] This plan works great! Having a set time to meet with Carla once a month is perfect.",
      ),
      makeSourceFact(
        "fact-laura-weekly-call-user",
        26,
        "[BEAM chat_id=26 role=user time=unknown] I've got a weekly Zoom call with Laura, who's 82 and a total veteran producer, every Monday at 10 AM, and I was wondering if I should ask her for advice on how to manage my schedule better.",
      ),
      makeSourceFact(
        "fact-laura-weekly-call-advice",
        27,
        "[BEAM chat_id=27 role=assistant time=unknown] Prepare specific questions for Laura about managing multiple projects, balancing work and personal life, prioritizing tasks, and following up after the call with a thank-you email summarizing action items.",
      ),
      makeSourceFact(
        "fact-laura-weekly-call-plan",
        28,
        "[BEAM chat_id=28 role=user time=unknown] I'll ask Laura specifically about how she handles multiple projects and sets boundaries between work and personal life, and I'll send her a follow-up email to thank her and summarize our discussion.",
      ),
      makeSourceFact(
        "fact-laura-weekly-call-refined",
        29,
        "[BEAM chat_id=29 role=assistant time=unknown] A refined Laura call plan includes asking about multiple projects, tools like Trello or Asana, setting clear work hours, disconnecting during personal time, and sending a follow-up email with key points and next steps.",
      ),
      makeSourceFact(
        "fact-laura-weekly-call-confirmation",
        30,
        "[BEAM chat_id=30 role=user time=unknown] No further adjustments needed. I'll definitely ask Laura those questions and follow up with her afterward.",
      ),
      makeSourceFact(
        "fact-laura-weekly-call-final",
        31,
        "[BEAM chat_id=31 role=assistant time=unknown] Asking Laura those specific questions and following up afterward should provide valuable insights and practical strategies to manage your schedule more effectively.",
      ),
      makeSourceFact(
        "fact-pilot-plan-noise",
        35,
        "[BEAM chat_id=35 role=assistant time=unknown] Following this structured pilot episode approach should help you manage your timeline and budget effectively.",
      ),
      makeSourceFact(
        "fact-calendar-planner-noise",
        36,
        "[BEAM chat_id=36 role=user time=unknown] I use Google Calendar synced with a Moleskine planner to block 2-hour creative sessions every weekday at 9 AM.",
      ),
      makeSourceFact(
        "fact-calendar-planner-advice-noise",
        37,
        "[BEAM chat_id=37 role=assistant time=unknown] Use Google Calendar and a Moleskine planner, review your schedule daily, batch tasks, and organize your creative sessions.",
      ),
      makeSourceFact(
        "fact-script-finalization-noise",
        39,
        "[BEAM chat_id=39 role=assistant time=unknown] Focus on script finalization milestones, weekly check-ins, Trello task tracking, and stakeholder feedback loops.",
      ),
    ];

    const result = selectFacts(
      facts,
      "How did I plan to make the most of my regular video calls with that experienced industry professional to improve how I handle my busy schedule?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-laura-weekly-call-user",
      "fact-laura-weekly-call-advice",
      "fact-laura-weekly-call-plan",
      "fact-laura-weekly-call-refined",
      "fact-laura-weekly-call-confirmation",
      "fact-laura-weekly-call-final",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-pilot-plan-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-calendar-planner-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-calendar-planner-advice-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-script-finalization-noise")?.returned).toBe(false);
  });

  it("keeps triangle similarity ratio verification evidence source ordered", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        sessionId: "beam-conversation-4",
        tags: ["source_message", "source_order", "user_answer"],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-triangle-area-median-noise",
        73,
        "[BEAM chat_id=73 role=assistant time=unknown] We discussed finding the area of a triangle from a median and altitude, using base-height formulas and median relationships.",
      ),
      makeSourceFact(
        "fact-garden-area-noise",
        101,
        "[BEAM chat_id=101 role=assistant time=unknown] We validated a triangular garden plot area with sides 15 m, 20 m, and 25 m using Heron's formula and coordinate geometry.",
      ),
      makeSourceFact(
        "fact-base-height-heron-noise",
        117,
        "[BEAM chat_id=117 role=assistant time=unknown] We compared base-height and Heron's formula for a right triangle with sides 7 cm, 24 cm, and 25 cm, then calculated a median length.",
      ),
      makeSourceFact(
        "fact-triangle-area-method-noise",
        135,
        "[BEAM chat_id=135 role=assistant time=unknown] We explored using medians and altitudes to calculate triangle area and compare base-height, Heron's formula, and altitude methods.",
      ),
      makeSourceFact(
        "fact-similarity-ratio-user",
        166,
        "[BEAM chat_id=166 role=user time=unknown] I'm trying to verify the similarity ratio calculation for two triangles with sides 9, 12, 15 and 6.75, 9, 11.25 cm, and I want to check if the ratio is indeed 3/4 as given.",
      ),
      makeSourceFact(
        "fact-similarity-ratio-assistant",
        167,
        "[BEAM chat_id=167 role=assistant time=unknown] To verify the similarity ratio, compare corresponding sides 9 to 6.75, 12 to 9, and 15 to 11.25 step by step, simplify each fraction, and confirm all corresponding side ratios reduce to the same value.",
      ),
      makeSourceFact(
        "fact-congruence-error-noise",
        169,
        "[BEAM chat_id=169 role=assistant time=unknown] We corrected an angle calculation error from 65 degrees to 60 degrees for an ASA triangle congruence proof.",
      ),
      makeSourceFact(
        "fact-broad-similarity-noise",
        191,
        "[BEAM chat_id=191 role=assistant time=unknown] We explained congruence and similarity for triangles with sides 6, 8, 10 and 9, 12, 15 using scale factors, GeoGebra, medians, and altitudes.",
      ),
    ];

    const result = selectFacts(
      facts,
      "How did I confirm that the proportional relationship between the two sets of measurements was consistent across all comparisons?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-similarity-ratio-user",
      "fact-similarity-ratio-assistant",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-triangle-area-median-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-garden-area-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-base-height-heron-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-triangle-area-method-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-congruence-error-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-broad-similarity-noise")?.returned).toBe(false);
  });

  it("keeps ASA triangle congruence proof evidence source ordered", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        sessionId: "beam-conversation-4",
        tags: ["source_message", "source_order", "user_answer"],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-triangle-similarity-noise",
        140,
        "[BEAM chat_id=140 role=user time=unknown] I'm now focusing on congruence, similarity, and applying triangle geometry to design and construction challenges, and I want to understand how to use similarity to determine if two triangles are congruent.",
      ),
      makeSourceFact(
        "fact-asa-congruence-proof-plan",
        151,
        "[BEAM chat_id=151 role=assistant time=unknown] To prove triangle congruence using ASA, label triangle ABC and triangle DEF, state that angles A and D are 50 degrees, angles B and E are 60 degrees, and included sides AB and DE are 7 cm, then apply the Angle-Side-Angle criterion and conclude triangle ABC is congruent to triangle DEF.",
      ),
      makeSourceFact(
        "fact-ssa-ambiguity-noise",
        196,
        "[BEAM chat_id=196 role=user time=unknown] Can two triangles with two equal sides and one equal angle be non-congruent, considering the SSA ambiguity and how this relates to SSS, SAS, or ASA proof criteria?",
      ),
      makeSourceFact(
        "fact-diagram-instruction-noise",
        60,
        "[BEAM chat_id=60 role=user time=unknown] Always provide step-by-step geometric diagrams when I ask about triangle classification methods.",
      ),
      makeSourceFact(
        "fact-proof-outline-instruction-noise",
        206,
        "[BEAM chat_id=206 role=user time=unknown] Always provide detailed proof outlines with diagrams when I ask about triangle congruence criteria.",
      ),
    ];

    const result = selectFacts(
      facts,
      "What approach did I outline to demonstrate that two triangles with matching angle pairs and a connecting segment are identical, and how did I organize the information to support this?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-asa-congruence-proof-plan",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-triangle-similarity-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-ssa-ambiguity-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-diagram-instruction-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-proof-outline-instruction-noise")?.returned).toBe(false);
  });

  it("keeps ASA proof preference evidence over broad triangle explanation noise", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        sessionId: "beam-conversation-4",
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          originalRole: role,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-triangle-classification-preference-noise",
        52,
        "user",
        "[BEAM chat_id=52 role=user time=unknown] I'm having trouble understanding how to classify triangles by sides and angles, especially equilateral, isosceles, and scalene types, and I prefer visual learning with step-by-step explanation and diagrams.",
      ),
      makeSourceFact(
        "fact-triangle-classification-assistant-noise",
        53,
        "assistant",
        "[BEAM chat_id=53 role=assistant time=unknown] We classified triangles by sides and angles with step-by-step explanations and diagram descriptions.",
      ),
      makeSourceFact(
        "fact-asa-angle-error-noise",
        169,
        "assistant",
        "[BEAM chat_id=169 role=assistant time=unknown] We corrected an angle calculation error from 65 degrees to 60 degrees for an ASA triangle congruence proof.",
      ),
      makeSourceFact(
        "fact-broad-congruence-similarity-noise",
        190,
        "user",
        "[BEAM chat_id=190 role=user time=unknown] I'm having trouble understanding the difference between congruence and similarity in triangles, including SSS, SAS, ASA criteria, scale factors, medians, altitudes, GeoGebra, visual aids, and step-by-step explanations.",
      ),
      makeSourceFact(
        "fact-broad-congruence-similarity-assistant-noise",
        191,
        "assistant",
        "[BEAM chat_id=191 role=assistant time=unknown] We explained congruence and similarity, SSS, SAS, ASA, scale factors, GeoGebra, medians, altitudes, and visual examples.",
      ),
      makeSourceFact(
        "fact-asa-proof-diagram-preference",
        198,
        "user",
        "[BEAM chat_id=198 role=user time=unknown] I'm trying to prove triangle congruence using the ASA criterion, and I prefer detailed proofs with diagrams to fully grasp the logical reasoning behind it. Can you help me understand how to apply the ASA criterion to prove that two triangles are congruent, and provide a step-by-step proof with diagrams?",
      ),
    ];

    const result = selectFacts(
      facts,
      "Can you walk me through how to prove two triangles are congruent using the ASA criterion?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-asa-proof-diagram-preference",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-triangle-classification-preference-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-triangle-classification-assistant-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-asa-angle-error-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-broad-congruence-similarity-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-broad-congruence-similarity-assistant-noise")?.returned).toBe(false);
  });

  it("keeps AI hiring fairness and speed recommendation evidence source ordered", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        sessionId: "beam-conversation-11",
        tags: ["source_message", "source_order", "user_answer"],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-pilot-program-noise",
        13,
        "[BEAM chat_id=13 role=assistant time=unknown] Start with a small pilot program for an AI hiring tool, define objectives, select a tool, scope the pilot, set up the system, monitor results, adjust, and document findings.",
      ),
      makeSourceFact(
        "fact-soft-skills-noise",
        27,
        "[BEAM chat_id=27 role=assistant time=unknown] Ensure AI does not overlook soft skills by defining evaluation criteria, adding structured interviews, using behavioral questions, and keeping human-led final interviews.",
      ),
      makeSourceFact(
        "fact-hiring-time-goal-noise",
        37,
        "[BEAM chat_id=37 role=assistant time=unknown] To reduce hiring time by 30% within 6 months, assess bottlenecks, select AI tools, run a pilot, train the team, monitor results, and scale up.",
      ),
      makeSourceFact(
        "fact-ai-fairness-speed-recommendation",
        39,
        "[BEAM chat_id=39 role=assistant time=unknown] To speed up candidate screening without compromising fairness, evaluate AI vendors for transparency and certifications, request bias and third-party audits, configure anonymization to remove personal identifiers, maintain human oversight for final decisions, monitor diversity metrics and candidate feedback, and use structured interviews for soft skills alongside AI screening.",
      ),
      makeSourceFact(
        "fact-balanced-approach-noise",
        69,
        "[BEAM chat_id=69 role=assistant time=unknown] A balanced approach uses AI for efficiency while maintaining human oversight, anonymization, job-relevant criteria, training, monitoring, and feedback mechanisms.",
      ),
      makeSourceFact(
        "fact-algorithmic-bias-noise",
        179,
        "[BEAM chat_id=179 role=assistant time=unknown] Balance efficiency with algorithmic bias risks by defining objectives, running audits, using explainable AI, human review, diverse panels, encryption, 2FA, and training.",
      ),
      makeSourceFact(
        "fact-cost-savings-noise",
        199,
        "[BEAM chat_id=199 role=assistant time=unknown] Continue automation gradually after saving $9,000 in recruitment costs, but maintain human oversight, ethical guidelines, stakeholder communication, and regular audits.",
      ),
    ];

    const result = selectFacts(
      facts,
      "What approach did you recommend to balance speeding up the hiring process with ensuring fairness throughout the candidate evaluation?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-ai-fairness-speed-recommendation",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-pilot-program-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-soft-skills-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-hiring-time-goal-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-balanced-approach-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-algorithmic-bias-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-cost-savings-noise")?.returned).toBe(false);
  });

  it("keeps startup transition preparation evidence source ordered", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        sessionId: "beam-conversation-12",
        tags: ["source_message", "source_order", "user_answer"],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-current-vs-startup-decision",
        39,
        "[BEAM chat_id=39 role=assistant time=unknown] Making a decision between the current job at $85,000 and the streaming startup at $95,000 means weighing familiarity and stability against higher salary, growth opportunities, a more innovative environment, heavier workload, company culture fit, benefits, risk tolerance, and long-term career goals. To make a well-informed decision, gather more details about the startup, reflect on long-term career goals, and discuss the options with trusted mentors or friends.",
      ),
      makeSourceFact(
        "fact-startup-transition-preparation",
        41,
        "[BEAM chat_id=41 role=assistant time=unknown] To prepare for the startup transition, research the company's mission, values, and financial health, talk to current employees, clarify workload and performance expectations, mentally prepare for pressure, consult colleagues with startup experience, build a support network, review compensation including equity, adjust your budget, develop relevant skills, and expand your professional network.",
      ),
      makeSourceFact(
        "fact-startup-leaning-noise",
        40,
        "[BEAM chat_id=40 role=user time=unknown] I think I'll lean toward the startup for the higher salary and growth potential, but I need to make sure I can handle the workload and pressure.",
      ),
      makeSourceFact(
        "fact-final-meeting-noise",
        65,
        "[BEAM chat_id=65 role=assistant time=unknown] Use the rescheduled final meeting to reflect on values, evaluate each offer, seek external perspectives, prepare questions, and discuss concerns.",
      ),
      makeSourceFact(
        "fact-free-will-motivation-noise",
        75,
        "[BEAM chat_id=75 role=assistant time=unknown] Belief in free will can improve motivation through control, accountability, resilience, and persistence.",
      ),
      makeSourceFact(
        "fact-real-world-values-noise",
        103,
        "[BEAM chat_id=103 role=assistant time=unknown] Choosing the real world values personal growth, meaningful connections, and ethical responsibility over simulated happiness.",
      ),
      makeSourceFact(
        "fact-matthew-meeting-noise",
        205,
        "[BEAM chat_id=205 role=assistant time=unknown] Prepare for the meeting with Matthew by creating an agenda, gathering materials, reviewing past work, and using the Eisenhower Box.",
      ),
      makeSourceFact(
        "fact-criminal-justice-plan-noise",
        243,
        "[BEAM chat_id=243 role=assistant time=unknown] Start criminal justice reform by conducting a needs assessment, drafting policy proposals, building a coalition, advocating legislation, and monitoring outcomes.",
      ),
      makeSourceFact(
        "fact-scriptwriting-schedule-noise",
        311,
        "[BEAM chat_id=311 role=assistant time=unknown] Reserve mornings for scriptwriting and afternoons for meetings and administrative tasks to explore free will debates in creative work.",
      ),
    ];

    const result = selectFacts(
      facts,
      "What steps did you recommend I take to prepare for the challenges and uncertainties that come with changing my work environment?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-current-vs-startup-decision",
      "fact-startup-transition-preparation",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-startup-leaning-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-final-meeting-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-free-will-motivation-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-real-world-values-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-matthew-meeting-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-criminal-justice-plan-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-scriptwriting-schedule-noise")?.returned).toBe(false);
  });

  it("keeps resume keyword integration evidence source ordered", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        sessionId: "beam-conversation-6",
        tags: ["source_message", "source_order", "user_answer"],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-age-discrimination-noise",
        1,
        "[BEAM chat_id=1 role=assistant time=unknown] Update your resume to reduce age discrimination signals by emphasizing recent achievements, modern technical skills, concise formatting, and relevant impact.",
      ),
      makeSourceFact(
        "fact-film-tv-tailoring-noise",
        15,
        "[BEAM chat_id=15 role=assistant time=unknown] Tailor your resume for film, TV, and digital media roles by highlighting production coordination, stakeholder communication, portfolio links, and measurable creative outcomes.",
      ),
      makeSourceFact(
        "fact-resume-keywords-user",
        24,
        "[BEAM chat_id=24 role=user time=unknown] I discovered that using keywords like 'project management' and 'budget oversight' can increase my resume's ATS score by 15%, can you help me figure out how to incorporate these into my resume effectively ->-> 1,12",
      ),
      makeSourceFact(
        "fact-resume-keywords-assistant",
        25,
        "[BEAM chat_id=25 role=assistant time=unknown] Incorporate project management and budget oversight naturally across your Professional Summary, Work Experience, Skills Section, Education and Certifications, and Portfolio or Additional Sections. Use action verbs, relevant context, multiple occurrences where appropriate, synonyms and variations, and avoid repetition in the same sentence.",
      ),
      makeSourceFact(
        "fact-remote-team-leadership-noise",
        111,
        "[BEAM chat_id=111 role=assistant time=unknown] Frame remote team leadership as a transferable skill by emphasizing communication cadence, accountability, asynchronous coordination, and cross-functional collaboration.",
      ),
      makeSourceFact(
        "fact-bullet-style-noise",
        124,
        "[BEAM chat_id=124 role=user time=unknown] I prefer concise resume bullet points that lead with strong verbs and keep each accomplishment easy to scan.",
      ),
      makeSourceFact(
        "fact-quantified-bullet-noise",
        125,
        "[BEAM chat_id=125 role=assistant time=unknown] Improve ATS readability by using quantified bullet points, consistent formatting, active verbs, and clear metrics for each accomplishment.",
      ),
      makeSourceFact(
        "fact-minimalist-layout-noise",
        173,
        "[BEAM chat_id=173 role=assistant time=unknown] Use a minimalist resume layout with strong section hierarchy, clear spacing, and simple typography so recruiters can scan it quickly.",
      ),
      makeSourceFact(
        "fact-international-resume-noise",
        203,
        "[BEAM chat_id=203 role=assistant time=unknown] International resume standards vary, so adapt personal details, formatting, and ATS conventions for the target region and employer expectations.",
      ),
    ];

    const result = selectFacts(
      facts,
      "What approach did you recommend for weaving certain important terms into different sections of my resume to make it more effective?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-resume-keywords-user",
      "fact-resume-keywords-assistant",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-age-discrimination-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-film-tv-tailoring-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-remote-team-leadership-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-bullet-style-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-quantified-bullet-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-minimalist-layout-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-international-resume-noise")?.returned).toBe(false);
  });

  it("keeps emergency fund savings plan evidence source ordered", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        sessionId: "beam-conversation-16",
        tags: ["source_message", "source_order", "user_answer"],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-average-income-noise",
        27,
        "[BEAM chat_id=27 role=assistant time=unknown] Estimate average monthly income from past project earnings by collecting monthly records, adding total earnings, dividing by the number of months, and using that baseline for budgeting.",
      ),
      makeSourceFact(
        "fact-emergency-fund-user",
        34,
        "[BEAM chat_id=34 role=user time=unknown] I'm stressed about saving $2,000 for my emergency fund by June 30, 2024, and I've only got $500 saved so far. Can you help me make a plan to reach my goal?",
      ),
      makeSourceFact(
        "fact-emergency-fund-plan",
        35,
        "[BEAM chat_id=35 role=assistant time=unknown] Break down the $2,000 emergency fund goal by subtracting current savings of $500 to get $1,500 still needed, divide that by 3.5 months until June 30 for a $428.57 monthly target, then automate transfers, cut unnecessary expenses, increase income, and review progress regularly.",
      ),
      makeSourceFact(
        "fact-debt-management-noise",
        79,
        "[BEAM chat_id=79 role=assistant time=unknown] Stay on top of debt management after paying off a $1,000 credit card balance by maintaining a zero balance, building an emergency fund, monitoring spending, avoiding new debt, and improving your credit score.",
      ),
      makeSourceFact(
        "fact-invest-car-split-noise",
        105,
        "[BEAM chat_id=105 role=assistant time=unknown] Allocate $1,000 between investing and saving for a car by clarifying goals, investing $500, saving $500, choosing index funds, and reviewing performance over time.",
      ),
      makeSourceFact(
        "fact-contract-risk-noise",
        123,
        "[BEAM chat_id=123 role=assistant time=unknown] Ask Natalie about project scope, payment structure, extension possibility, and termination terms before accepting the freelance contract.",
      ),
      makeSourceFact(
        "fact-natalie-contract-noise",
        183,
        "[BEAM chat_id=183 role=assistant time=unknown] Choosing Natalie's $8,000 contract for better schedule fit can reduce stress, support work-life balance, and still contribute to savings goals like a car fund and emergency fund.",
      ),
      makeSourceFact(
        "fact-cash-reserve-noise",
        305,
        "[BEAM chat_id=305 role=assistant time=unknown] Keeping a $1,000 cash reserve and splitting remaining profits is a reasonable compromise for financial stability, growth, flexibility, and regular financial reviews.",
      ),
    ];

    const result = selectFacts(
      facts,
      "What approach did you recommend to balance my current finances and timeline so I could steadily build up my savings despite starting with a partial amount already set aside?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-emergency-fund-user",
      "fact-emergency-fund-plan",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-average-income-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-debt-management-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-invest-car-split-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-contract-risk-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-natalie-contract-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-cash-reserve-noise")?.returned).toBe(false);
  });

  it("keeps rate-limit request flow evidence source ordered", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        sessionId: "beam-conversation-2",
        tags: ["source_message", "source_order", "user_answer"],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-rate-limit-initial-user-noise",
        32,
        "[BEAM chat_id=32 role=user time=unknown] I'm trying to handle the API rate limit for my weather app with a simple counter for calls per minute and per day against the OpenWeather API.",
      ),
      makeSourceFact(
        "fact-rate-limit-counters-queue",
        33,
        "[BEAM chat_id=33 role=assistant time=unknown] Improve the API call tracker by resetting counters when minute and day intervals have elapsed, enforcing the 60 calls per minute and 1000 calls per day limits, and adding a queue for concurrent requests so excess calls wait and processQueue runs them after capacity returns.",
      ),
      makeSourceFact(
        "fact-rate-limit-rapid-calls",
        35,
        "[BEAM chat_id=35 role=assistant time=unknown] Handle rapid consecutive API calls with a combined rate limiting and queuing mechanism: reset counters, push excess calls into a queue, and process queued API calls one by one after a successful API call.",
      ),
      makeSourceFact(
        "fact-rate-limit-retry-backoff",
        37,
        "[BEAM chat_id=37 role=assistant time=unknown] For repeated retries after hitting the rate limit, use a more robust queue with exponential backoff, space queued calls out by increasing backoffTime, and cap the backoff delay at 60000 milliseconds.",
      ),
      makeSourceFact(
        "fact-cache-response-time-noise",
        65,
        "[BEAM chat_id=65 role=assistant time=unknown] Improve weather API response times with an in-memory cache, longer TTL, stale-data fallback, CDN static assets, HTTP/2 or HTTP/3, and minified compressed files.",
      ),
      makeSourceFact(
        "fact-node-upgrade-noise",
        117,
        "[BEAM chat_id=117 role=assistant time=unknown] Upgrade to Node.js v18.15.0, review breaking changes, move from require to import, test thoroughly, and use ES modules with updated URL handling.",
      ),
      makeSourceFact(
        "fact-performance-optimization-noise",
        151,
        "[BEAM chat_id=151 role=assistant time=unknown] Further reduce weather app latency with prefetching common cities, batch requests, CDN integration, optimized payloads, HTTP/2, and local storage cache.",
      ),
      makeSourceFact(
        "fact-custom-feature-noise",
        123,
        "[BEAM chat_id=123 role=assistant time=unknown] Implement a custom weather forecast feature by defining requirements, designing the UI, setting up development, fetching current weather and forecast data, testing, and documenting the feature.",
      ),
    ];

    const result = selectFacts(
      facts,
      "How did you recommend managing the flow of requests when my app risks overwhelming the service due to frequent retries and bursts of activity?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-rate-limit-counters-queue",
      "fact-rate-limit-rapid-calls",
      "fact-rate-limit-retry-backoff",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-rate-limit-initial-user-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-cache-response-time-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-node-upgrade-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-performance-optimization-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-custom-feature-noise")?.returned).toBe(false);
  });

  it("keeps API daily quota update evidence source ordered", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        sessionId: "beam-conversation-2",
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          originalRole: role,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-autocomplete-debounce-noise",
        8,
        "user",
        "[BEAM chat_id=8 role=user time=unknown] hmm, got it, but what about adding the autocomplete feature with the debounce delay?",
      ),
      makeSourceFact(
        "fact-api-rate-limit-initial",
        32,
        "user",
        "[BEAM chat_id=32 role=user time=unknown] I'm trying to handle the API rate limit for my weather app with a simple counter for calls per minute and per day, using 60 calls/minute and 1000 calls/day for my OpenWeather API key.",
      ),
      makeSourceFact(
        "fact-cors-noise",
        48,
        "user",
        "[BEAM chat_id=48 role=user time=unknown] I'm trying to handle CORS errors from the OpenWeather API, but I've confirmed that no proxy is needed since the API supports CORS on client requests.",
      ),
      makeSourceFact(
        "fact-api-daily-quota-update",
        66,
        "user",
        "[BEAM chat_id=66 role=user time=unknown] I'm trying to update my API key settings to reflect the new daily quota of 1,200 calls per day, with const dailyQuota = 1200 in my OpenWeather API v2.5 weather implementation.",
      ),
      makeSourceFact(
        "fact-autocomplete-caching-noise",
        95,
        "assistant",
        "[BEAM chat_id=95 role=assistant time=unknown] Balance reducing API calls and exhaustive search by using LRU caching, debounce delay tuning, pagination, and local storage for frequently used cities.",
      ),
      makeSourceFact(
        "fact-uptime-quota-noise",
        152,
        "user",
        "[BEAM chat_id=152 role=user time=unknown] I've achieved 99.9% uptime over 7 days post-deployment with no reported downtime or API quota breaches, and I want alerts for uptime or quota breaches.",
      ),
    ];

    const result = selectFacts(
      facts,
      "What is the daily call quota for the API key used in my application?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-api-rate-limit-initial",
      "fact-api-daily-quota-update",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-autocomplete-debounce-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-cors-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-autocomplete-caching-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-uptime-quota-noise")?.returned).toBe(false);
  });

  it("keeps conditional probability practice quantity updates source ordered", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        sessionId: "beam-conversation-5",
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          originalRole: role,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-conditional-probability-original",
        84,
        "user",
        "[BEAM chat_id=84 role=user time=unknown] I'm trying to understand how my accuracy in conditional probability problems improved from 60% to 85% over 2 weeks, after completing 8 problems.",
      ),
      makeSourceFact(
        "fact-conditional-probability-rate",
        86,
        "user",
        "[BEAM chat_id=86 role=user time=unknown] Yeah, that makes sense. So I've improved by about 3.125% per problem. To get to 100%, I'd need to solve around 5 more problems.",
      ),
      makeSourceFact(
        "fact-conditional-probability-closing",
        88,
        "user",
        "[BEAM chat_id=88 role=user time=unknown] No, I think I'm good for now. Thanks for the help with my probability problems! I'll keep practicing.",
      ),
      makeSourceFact(
        "fact-dependent-event-noise",
        98,
        "user",
        "[BEAM chat_id=98 role=user time=unknown] I've spent 4 hours practicing dependent event problems, including 3 card draw and 5 dice roll scenarios.",
      ),
      makeSourceFact(
        "fact-conditional-probability-update",
        130,
        "user",
        "[BEAM chat_id=130 role=user time=unknown] I'm trying to solve a conditional probability problem and I need help, I've recently increased my practice sessions to 12 conditional probability problems, which has further boosted my accuracy and confidence.",
      ),
      makeSourceFact(
        "fact-visual-aid-instruction-noise",
        132,
        "user",
        "[BEAM chat_id=132 role=user time=unknown] Always include visual aids like tree diagrams when I ask about dependent event probability problems.",
      ),
      makeSourceFact(
        "fact-never-practiced-contradiction-noise",
        134,
        "user",
        "[BEAM chat_id=134 role=user time=unknown] I don't understand why I have never practiced any conditional probability problems before.",
      ),
      makeSourceFact(
        "fact-complex-probability-noise",
        232,
        "user",
        "[BEAM chat_id=232 role=user time=unknown] I'm trying to solve a complex probability puzzle about the birthday paradox.",
      ),
      makeSourceFact(
        "fact-complex-probability-instruction-noise",
        234,
        "user",
        "[BEAM chat_id=234 role=user time=unknown] Always combine algebraic formulas with visual diagrams when I ask about complex probability problems.",
      ),
    ];

    const result = selectFacts(
      facts,
      "How many conditional probability problems have I been practicing to improve my accuracy and confidence?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-conditional-probability-original",
      "fact-conditional-probability-rate",
      "fact-conditional-probability-closing",
      "fact-conditional-probability-update",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-dependent-event-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-visual-aid-instruction-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-never-practiced-contradiction-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-complex-probability-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-complex-probability-instruction-noise")?.returned).toBe(false);
  });

  it("keeps weekly writing target update evidence source ordered", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        sessionId: "beam-conversation-10",
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          originalRole: role,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-weekly-word-target-initial",
        22,
        "user",
        "[BEAM chat_id=22 role=user time=unknown] I'm kinda struggling to meet my writing goals, like targeting 1,200 words per week, and I was wondering if you could help me track my progress using Google Docs word count stats.",
      ),
      makeSourceFact(
        "fact-writing-schedule-noise",
        24,
        "user",
        "[BEAM chat_id=24 role=user time=unknown] I've blocked 2 hours every Monday, Wednesday, and Friday at 7 PM for writing sessions at home office, but I'm not sure if this schedule is realistic.",
      ),
      makeSourceFact(
        "fact-progress-calculation-noise",
        55,
        "assistant",
        "[BEAM chat_id=55 role=assistant time=unknown] Since you've written 3,600 words and that is 72% of your weekly target, your calculated weekly target is 5,000 words and you need about 233 words per day.",
      ),
      makeSourceFact(
        "fact-weekly-word-target-update",
        64,
        "user",
        "[BEAM chat_id=64 role=user time=unknown] I'm trying to increase my weekly word count, and I just found out it was adjusted to 1,350 words, so how can I make sure I meet this new target?",
      ),
      makeSourceFact(
        "fact-later-word-count-noise",
        126,
        "user",
        "[BEAM chat_id=126 role=user time=unknown] I've increased my weekly word count from 1,200 to 1,500 words by April 9, tracked via Google Docs, but I'm not sure if this pace is sustainable.",
      ),
      makeSourceFact(
        "fact-writing-group-noise",
        151,
        "assistant",
        "[BEAM chat_id=151 role=assistant time=unknown] Use the East Janethaven Writers' Meetup to set up peer review, group chats, workshops, collaborative projects, and regular encouragement.",
      ),
      makeSourceFact(
        "fact-final-draft-target-noise",
        296,
        "user",
        "[BEAM chat_id=296 role=user time=unknown] I'm trying to stay on track with my writing goals with an October 5, 2024 time anchor and a final draft deadline by October 1, 2024, with weekly 1,800-word targets.",
      ),
      makeSourceFact(
        "fact-confidence-momentum-noise",
        301,
        "assistant",
        "[BEAM chat_id=301 role=assistant time=unknown] Reaching a 10/10 confidence level after completing your final draft is a significant achievement, and you can maintain momentum with routines and feedback.",
      ),
    ];

    const result = selectFacts(
      facts,
      "What is my weekly word count target for my writing goals?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-weekly-word-target-initial",
      "fact-weekly-word-target-update",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-writing-schedule-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-progress-calculation-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-later-word-count-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-writing-group-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-final-draft-target-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-confidence-momentum-noise")?.returned).toBe(false);
  });

  it("keeps weather-app latency metrics for cross-session speed comparisons", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        sessionId: "beam-conversation-2",
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          originalRole: role,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-rate-limit-quota-noise",
        32,
        "user",
        "[BEAM chat_id=32 role=user time=unknown] I'm trying to handle the API rate limit for my weather app with 60 calls/minute and 1000 calls/day on my OpenWeather API key.",
      ),
      makeSourceFact(
        "fact-fetch-call-latency",
        38,
        "user",
        "[BEAM chat_id=38 role=user time=unknown] I'm trying to optimize the fetch call latency in my prototype, which currently averages 250ms on a local network with Chrome v112.0.5615.",
      ),
      makeSourceFact(
        "fact-cache-response-time-noise",
        65,
        "assistant",
        "[BEAM chat_id=65 role=assistant time=unknown] Improve weather API response times with an in-memory cache, longer TTL, stale-data fallback, CDN static assets, HTTP/2 or HTTP/3, and minified compressed files.",
      ),
      makeSourceFact(
        "fact-autocomplete-api-response-time",
        80,
        "user",
        "[BEAM chat_id=80 role=user time=unknown] I'm trying to optimize the autocomplete feature for my weather app, which has been tested with over 100 city inputs and has an average API response time of 280ms with a 95% success rate on valid cities.",
      ),
      makeSourceFact(
        "fact-autocomplete-debounce-noise",
        94,
        "user",
        "[BEAM chat_id=94 role=user time=unknown] I'm trying to optimize autocomplete to reduce API calls with a 5-item result limit, 300ms debounce delay, and a more advanced caching mechanism.",
      ),
      makeSourceFact(
        "fact-autocomplete-review-noise",
        95,
        "assistant",
        "[BEAM chat_id=95 role=assistant time=unknown] Balance reducing API calls and exhaustive search by using LRU caching, debounce delay tuning, pagination, and local storage for frequently used cities.",
      ),
      makeSourceFact(
        "fact-weather-error-handling-noise",
        124,
        "user",
        "[BEAM chat_id=124 role=user time=unknown] I reduced average autocomplete input latency from 520ms to 290ms by optimizing event listeners and DOM updates, and I need help with fetchWeatherData error handling.",
      ),
      makeSourceFact(
        "fact-load-testing-noise",
        187,
        "assistant",
        "[BEAM chat_id=187 role=assistant time=unknown] Prepare for user feedback with load testing, performance monitoring, scalability, caching strategy, database optimization, and security measures.",
      ),
    ];

    const result = selectFacts(
      facts,
      "Between my fetch call latency and my autocomplete API response time, which one is currently faster based on my tests?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-fetch-call-latency",
      "fact-autocomplete-api-response-time",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-rate-limit-quota-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-cache-response-time-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-autocomplete-debounce-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-autocomplete-review-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-weather-error-handling-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-load-testing-noise")?.returned).toBe(false);
  });

  it("keeps distinct security feature evidence for cross-session count questions", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        sessionId: "beam-conversation-1",
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          originalRole: role,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-password-hashing",
        16,
        "user",
        "[BEAM chat_id=16 role=user time=unknown] I implemented basic password hashing for my personal budget tracker using Werkzeug.security with a password_hash field.",
      ),
      makeSourceFact(
        "fact-validation-noise",
        36,
        "user",
        "[BEAM chat_id=36 role=user time=unknown] I'm improving expense tracking validation and error messages for the Flask budget tracker.",
      ),
      makeSourceFact(
        "fact-formatting-instruction-noise",
        54,
        "user",
        "[BEAM chat_id=54 role=user time=unknown] Always format all code snippets with syntax highlighting when I ask about implementation details.",
      ),
      makeSourceFact(
        "fact-rbac-user-role",
        84,
        "user",
        "[BEAM chat_id=84 role=user time=unknown] I'm trying to implement role-based access control for my application, specifically for the 'user' role, and I want to make sure I'm doing it correctly.",
      ),
      makeSourceFact(
        "fact-analytics-noise",
        122,
        "user",
        "[BEAM chat_id=122 role=user time=unknown] I'm improving dashboard analytics and deployment planning after finishing the budget tracker API.",
      ),
      makeSourceFact(
        "fact-security-tests-noise",
        154,
        "user",
        "[BEAM chat_id=154 role=user time=unknown] I'm trying to achieve 90% coverage on the auth.py and security.py modules with my new tests for security features.",
      ),
      makeSourceFact(
        "fact-lockout",
        150,
        "user",
        "[BEAM chat_id=150 role=user time=unknown] I'm trying to implement the account lockout feature after 5 failed login attempts using Redis 7.0 for rate limiting.",
      ),
      makeSourceFact(
        "fact-pragmatic-security-noise",
        178,
        "user",
        "[BEAM chat_id=178 role=user time=unknown] I'm trying to enhance the security of my application without compromising the user experience.",
      ),
      makeSourceFact(
        "fact-secure-auth-noise",
        182,
        "user",
        "[BEAM chat_id=182 role=user time=unknown] I'm trying to implement a secure authentication system for my application and keep authorization features aligned with best practices.",
      ),
      makeSourceFact(
        "fact-auth-best-practices-noise",
        184,
        "user",
        "[BEAM chat_id=184 role=user time=unknown] Always provide security best practices when I ask about authentication or authorization features.",
      ),
    ];

    const result = selectFacts(
      facts,
      "How many different user roles and security features am I trying to implement across my sessions?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-password-hashing",
      "fact-rbac-user-role",
      "fact-lockout",
    ]);
    for (const noiseId of [
      "fact-validation-noise",
      "fact-formatting-instruction-noise",
      "fact-analytics-noise",
      "fact-security-tests-noise",
      "fact-pragmatic-security-noise",
      "fact-secure-auth-noise",
      "fact-auth-best-practices-noise",
    ]) {
      expect(result.traces.find((trace) => trace.memoryId === noiseId)?.returned).toBe(false);
    }
  });

  it("keeps weather feature and concern count evidence without autocomplete noise", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      content: string,
      role: "assistant" | "user" = "user",
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        sessionId: "beam-conversation-2",
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          originalRole: role,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-weather-fetch-noise",
        15,
        "[BEAM chat_id=15 role=assistant time=unknown] We reviewed asynchronous fetch error handling and validated OpenWeather weather responses.",
        "assistant",
      ),
      makeSourceFact(
        "fact-weather-responsive-noise",
        26,
        "[BEAM chat_id=26 role=user time=unknown] I'm trying to implement a responsive design for my weather app using CSS Grid and Flexbox, targeting mobile and desktop devices.",
      ),
      makeSourceFact(
        "fact-weather-invalid-city-noise",
        28,
        "[BEAM chat_id=28 role=user time=unknown] I'm trying to handle errors for invalid city names in my weather app, and I want to display user-friendly messages for HTTP 404 and 400 status codes.",
      ),
      makeSourceFact(
        "fact-weather-rate-limit",
        32,
        "[BEAM chat_id=32 role=user time=unknown] I'm trying to handle the API rate limit for my weather app; can I use a simple counter to track the number of calls made per minute and per day? How can I improve this to handle the 60 calls/minute and 1000 calls/day rate limits for my OpenWeather API key obtained on March 10, 2024?",
      ),
      makeSourceFact(
        "fact-weather-rapid-calls",
        34,
        "[BEAM chat_id=34 role=user time=unknown] hmm, what happens if the user makes rapid consecutive calls?",
      ),
      makeSourceFact(
        "fact-weather-rapid-calls-answer-noise",
        35,
        "[BEAM chat_id=35 role=assistant time=unknown] Handling rapid consecutive API calls is crucial to ensure that your application does not exceed the rate limits set by the API provider. This approach helps manage rapid consecutive calls effectively and prevents exceeding the API rate limits.",
        "assistant",
      ),
      makeSourceFact(
        "fact-weather-retry-rate-limit",
        36,
        "[BEAM chat_id=36 role=user time=unknown] hmm, what if the user keeps retrying after hitting the rate limit? How do we handle that?",
      ),
      makeSourceFact(
        "fact-weather-autocomplete-noise",
        80,
        "[BEAM chat_id=80 role=user time=unknown] I'm trying to optimize the autocomplete feature for my weather app, which has been tested with over 100 city inputs and has an average API response time of 280ms with a 95% success rate on valid cities.",
      ),
      makeSourceFact(
        "fact-weather-custom-feature",
        122,
        "[BEAM chat_id=122 role=user time=unknown] I'm trying to implement a custom feature for my weather app to maintain full control and avoid external dependency risks, as per my preference statement, but I'm not sure how to start.",
      ),
      makeSourceFact(
        "fact-weather-uptime-monitoring",
        190,
        "[BEAM chat_id=190 role=user time=unknown] I'm trying to understand the recent uptime monitoring results, which show a perfect 100% availability over the past 7 days, and I want to know how this reflects on our improved stability.",
      ),
    ];

    const result = selectFacts(
      facts,
      "How many different features or concerns did I mention wanting to handle across my weather app conversations?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-weather-rate-limit",
      "fact-weather-rapid-calls",
      "fact-weather-retry-rate-limit",
      "fact-weather-custom-feature",
      "fact-weather-uptime-monitoring",
    ]);
    for (const noiseId of [
      "fact-weather-fetch-noise",
      "fact-weather-responsive-noise",
      "fact-weather-invalid-city-noise",
      "fact-weather-rapid-calls-answer-noise",
      "fact-weather-autocomplete-noise",
    ]) {
      expect(result.traces.find((trace) => trace.memoryId === noiseId)?.returned).toBe(false);
    }
  });

  it("keeps API endpoint project technologies for startup information questions", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        sessionId: "beam-conversation-2",
        tags: ["source_message", "source_order", "user_answer"],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-api-endpoint-technologies",
        10,
        "[BEAM chat_id=10 role=user time=unknown] I'm trying to initialize a project using vanilla JavaScript ES2021, HTML5, and CSS3 to target the OpenWeather API endpoint `api.openweathermap.org/data/2.5/weather`, but I'm not sure how to structure my code.",
      ),
      makeSourceFact(
        "fact-eslint-project-noise",
        58,
        "[BEAM chat_id=58 role=user time=unknown] I'm trying to set up ESLint v8.39 with the Airbnb style guide for my JavaScript project.",
      ),
      makeSourceFact(
        "fact-api-key-noise",
        70,
        "[BEAM chat_id=70 role=user time=unknown] I've never actually obtained an API key for this project, so I'm not sure how to proceed with implementing the weather app.",
      ),
      makeSourceFact(
        "fact-ci-project-noise",
        183,
        "[BEAM chat_id=183 role=assistant time=unknown] Create a GitHub repository and set up an automated CI/CD pipeline using GitHub Actions for your project.",
      ),
      makeSourceFact(
        "fact-feature-complete-noise",
        186,
        "[BEAM chat_id=186 role=user time=unknown] I'm working on a project that was marked feature-complete on April 9, 2024, and I'm ready to collect user feedback.",
      ),
    ];

    const result = selectFacts(
      facts,
      "What technologies did I say I was using to start my project targeting that API endpoint?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-api-endpoint-technologies",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-api-key-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-ci-project-noise")?.returned).toBe(false);
  });

  it("keeps the earlier single-card probability before two-card follow-up questions", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        sessionId: "beam-conversation-5",
        tags: ["source_message", "source_order", "user_answer"],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-two-coins-noise",
        30,
        "[BEAM chat_id=30 role=user time=unknown] I'm trying to understand why tossing two coins is considered independent events and calculate P(both heads) using 1/2 x 1/2 = 1/4.",
      ),
      makeSourceFact(
        "fact-single-card-probability",
        32,
        "[BEAM chat_id=32 role=user time=unknown] I'm trying to calculate the probability of drawing an ace from a standard 52-card deck, which is given as P = 4/52 = 1/13, but I want to understand how this applies to a real game, so can you help me figure out what the probability would be if I drew two cards and wanted at least one of them to be an ace?",
      ),
      makeSourceFact(
        "fact-face-card-spade-noise",
        58,
        "[BEAM chat_id=58 role=user time=unknown] Got it, but what about calculating P(A|B) for drawing a face card or a spade from a deck?",
      ),
      makeSourceFact(
        "fact-two-aces-noise",
        76,
        "[BEAM chat_id=76 role=user time=unknown] I'm trying to calculate the probability of drawing 2 aces together from a deck of 52 cards using 4C2 / 52C2.",
      ),
      makeSourceFact(
        "fact-conditional-probability-noise",
        108,
        "[BEAM chat_id=108 role=user time=unknown] I want to find the probability that the second card is an ace given that the first card was an ace, so the probability of drawing a second ace is 3/51.",
      ),
    ];

    const result = selectFacts(
      facts,
      "What probability did I mention for drawing a certain card from the deck before we started discussing drawing two cards?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-single-card-probability",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-face-card-spade-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-two-aces-noise")?.returned).toBe(false);
  });

  it("keeps named meeting location evidence for where-did-I-meet questions", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        sessionId: "beam-conversation-8",
        tags: ["source_message", "source_order", "user_answer"],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-portfolio-noise",
        8,
        "[BEAM chat_id=8 role=user time=unknown] I'm worried about my portfolio, Greg told me to update it by April 1.",
      ),
      makeSourceFact(
        "fact-laura-meeting-location",
        10,
        "[BEAM chat_id=10 role=user time=unknown] I'm thinking of attending the industry mixer at Coral Bay Hotel on May 10, Laura recommended it, and she met me on set at Blue Horizon Studios in 2019.",
      ),
      makeSourceFact(
        "fact-laura-cover-letter-noise",
        56,
        "[BEAM chat_id=56 role=user time=unknown] Laura shared feedback from her April 5 meeting with Island Media's HR about emotional intelligence.",
      ),
      makeSourceFact(
        "fact-laura-schedule-noise",
        96,
        "[BEAM chat_id=96 role=user time=unknown] My April 22 schedule includes a 9 AM meeting with Laura and a 10:30 team meeting.",
      ),
      makeSourceFact(
        "fact-laura-handbook-noise",
        172,
        "[BEAM chat_id=172 role=user time=unknown] Laura said I should review the company's employee handbook before accepting the job offer.",
      ),
    ];

    const result = selectFacts(
      facts,
      "Where did I say I met Laura?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-laura-meeting-location",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-laura-cover-letter-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-laura-schedule-noise")?.returned).toBe(false);
  });

  it("keeps partner meeting date and location evidence for when-and-where questions", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        sessionId: "beam-conversation-11",
        tags: ["source_message", "source_order", "user_answer"],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-partner-meeting-date-location",
        30,
        "[BEAM chat_id=30 role=user time=unknown] I'm kinda worried about using AI for hiring, you know, since my partner Jessica, who's 50 and a graphic designer, might think it's unfair to candidates, and we met at ArtSpace Gallery on June 12, 2020, which is a pretty significant place for me.",
      ),
      makeSourceFact(
        "fact-hiring-goal-noise",
        37,
        "[BEAM chat_id=37 role=assistant time=unknown] Reducing hiring time by 30% within 6 months can work if you pilot automation carefully and keep fairness checks in place.",
      ),
      makeSourceFact(
        "fact-ai-tool-cost-noise",
        101,
        "[BEAM chat_id=101 role=assistant time=unknown] AI hiring tools can cost between $5,000 and $12,000 annually, compared with current manual hiring costs of $15,000 per hire.",
      ),
      makeSourceFact(
        "fact-partner-movie-noise",
        139,
        "[BEAM chat_id=139 role=assistant time=unknown] That sounds like a lovely way to reminisce about meeting at the film festival in Miami with your partner Thomas.",
      ),
    ];

    const result = selectFacts(
      facts,
      "When and where did I say I met my partner?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-partner-meeting-date-location",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-hiring-goal-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-partner-movie-noise")?.returned).toBe(false);
  });

  it("keeps partner classic movie recommendation evidence source ordered", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        sessionId: "beam-conversation-14",
        tags: ["source_message", "source_order", "user_answer"],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-partner-classic-film-user",
        12,
        "[BEAM chat_id=12 role=user time=unknown] I'm planning a movie night with my partner Thomas, who's 45, and I want to pick a classic film we both love, since we met at a film festival in Miami on June 15, 2020.",
      ),
      makeSourceFact(
        "fact-partner-classic-film-recommendations",
        13,
        "[BEAM chat_id=13 role=assistant time=unknown] Given your shared love for classic films, I recommended timeless movies like Casablanca, Gone with the Wind, It's a Wonderful Life, The Maltese Falcon, Singin' in the Rain, and Vertigo so you and Thomas could reminisce about meeting at the film festival in Miami.",
      ),
      makeSourceFact(
        "fact-soul-discussion-noise",
        95,
        "[BEAM chat_id=95 role=assistant time=unknown] Discuss Soul with Michelle by focusing on purpose, relationships, growth, and appreciating everyday moments after watching the movie.",
      ),
      makeSourceFact(
        "fact-endgame-schedule-noise",
        126,
        "[BEAM chat_id=126 role=user time=unknown] The weekday evening option sounds good, so let's watch Avengers: Endgame on Tuesday, April 9, 2024, at 7:00 PM.",
      ),
      makeSourceFact(
        "fact-rental-savings-noise",
        143,
        "[BEAM chat_id=143 role=assistant time=unknown] Save money on movie rentals by renting individual titles, using promotions, checking free streaming options, and avoiding monthly subscriptions when one rental is cheaper.",
      ),
      makeSourceFact(
        "fact-guest-list-noise",
        217,
        "[BEAM chat_id=217 role=assistant time=unknown] Make family movie night enjoyable for Lily and her parents by reaching out early, asking preferences, managing the guest list, and planning inclusive snacks and activities.",
      ),
      makeSourceFact(
        "fact-animated-musicals-noise",
        243,
        "[BEAM chat_id=243 role=assistant time=unknown] Use your knowledge of animated musicals from the 1990s to the present to appreciate recent family films like Coco, Moana, Encanto, and Frozen II.",
      ),
      makeSourceFact(
        "fact-platform-instruction-noise",
        52,
        "[BEAM chat_id=52 role=user time=unknown] Always include platform availability details when I ask about movie options.",
      ),
      makeSourceFact(
        "fact-sustainability-instruction-noise",
        214,
        "[BEAM chat_id=214 role=user time=unknown] Always mention sustainability features when I ask about sneaker materials.",
      ),
    ];

    const result = selectFacts(
      facts,
      "How did the shared interests between me and my partner influence the movie options you recommended for our evening?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-partner-classic-film-user",
      "fact-partner-classic-film-recommendations",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-soul-discussion-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-endgame-schedule-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-rental-savings-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-guest-list-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-animated-musicals-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-platform-instruction-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-sustainability-instruction-noise")?.returned).toBe(false);
  });

  it("keeps colour technologist profession evidence source ordered", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        sessionId: "beam-conversation-5",
        tags: ["source_message", "source_order", "user_answer"],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-independent-events-noise",
        14,
        "[BEAM chat_id=14 role=user time=unknown] I'm trying to understand the difference between independent and mutually exclusive events, maybe with coin tosses or dice rolls and probability calculations.",
      ),
      makeSourceFact(
        "fact-colour-technologist-profession",
        16,
        "[BEAM chat_id=16 role=user time=unknown] I'm deciding whether to start with coin toss or dice roll problems to understand probability basics, which seems crucial for my practical and intellectual growth as a 44-year-old colour technologist from Port Michael.",
      ),
      makeSourceFact(
        "fact-even-die-noise",
        63,
        "[BEAM chat_id=63 role=assistant time=unknown] Calculate the probability of rolling an even number on a six-sided die by listing favorable outcomes 2, 4, and 6 over six possible outcomes, giving 3/6 = 1/2.",
      ),
      makeSourceFact(
        "fact-birthday-paradox-noise",
        156,
        "[BEAM chat_id=156 role=user time=unknown] I'm trying to understand the birthday paradox problem and how to solve it with direct counting and the complement method.",
      ),
      makeSourceFact(
        "fact-independent-product-noise",
        90,
        "[BEAM chat_id=90 role=user time=unknown] I'm trying to understand why P(A and B) = P(A) times P(B) only if A and B are independent, using two coin tosses as an example.",
      ),
    ];

    const result = selectFacts(
      facts,
      "What profession did I mention I work in?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-colour-technologist-profession",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-independent-events-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-even-die-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-birthday-paradox-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-independent-product-noise")?.returned).toBe(false);
  });

  it("keeps current Bay Street rent evidence for monthly amount questions", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        sessionId: "beam-conversation-16",
        tags: ["source_message", "source_order", "user_answer"],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-bay-street-current-rent",
        30,
        "[BEAM chat_id=30 role=user time=unknown] I'm kinda stressed about my current rent being $1,200/month for a 3-bedroom on Bay Street, and I'm trying to figure out how to reduce my expenses.",
      ),
      makeSourceFact(
        "fact-monthly-investment-noise",
        138,
        "[BEAM chat_id=138 role=user time=unknown] What's the minimum amount I should invest monthly to see a noticeable difference?",
      ),
      makeSourceFact(
        "fact-equipment-budget-noise",
        212,
        "[BEAM chat_id=212 role=user time=unknown] I should assess my current equipment needs and factor in maintenance costs before adjusting my budget.",
      ),
      makeSourceFact(
        "fact-loan-savings-noise",
        285,
        "[BEAM chat_id=285 role=assistant time=unknown] Paying off a $2,000 personal loan and saving $120 in interest annually can free up cash for debt management.",
      ),
    ];

    const result = selectFacts(
      facts,
      "What monthly amount did I say I’m currently paying for my place on Bay Street?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-bay-street-current-rent",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-monthly-investment-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-loan-savings-noise")?.returned).toBe(false);
  });

  it("keeps parents distance and town evidence for family location questions", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        sessionId: "beam-conversation-14",
        tags: ["source_message", "source_order", "user_answer"],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-parents-distance-town",
        6,
        "[BEAM chat_id=6 role=user time=unknown] I'm kinda worried about my parents, Amy and Kyle, who are 63 and 77, living 15 miles away in West Janethaven, and I want to make sure they're doing okay.",
      ),
      makeSourceFact(
        "fact-watchlist-noise",
        22,
        "[BEAM chat_id=22 role=user time=unknown] I'm trying to finalize my watchlist of 10 movies by March 25, 2024.",
      ),
      makeSourceFact(
        "fact-animated-musical-noise",
        139,
        "[BEAM chat_id=139 role=assistant time=unknown] Shifting your preference toward animated musicals is a great way to plan a family movie weekend.",
      ),
      makeSourceFact(
        "fact-snack-budget-noise",
        176,
        "[BEAM chat_id=176 role=user time=unknown] I'm planning a family movie weekend and I have a snack budget of $70.",
      ),
    ];

    const result = selectFacts(
      facts,
      "How far away did I say my parents live from me, and in which town?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-parents-distance-town",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-watchlist-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-snack-budget-noise")?.returned).toBe(false);
  });

  it("keeps reading list count and page total evidence for number recall questions", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        sessionId: "beam-conversation-13",
        tags: ["source_message", "source_order", "user_answer"],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-reading-list-count-pages",
        26,
        "[BEAM chat_id=26 role=user time=unknown] I'm kinda overwhelmed with my reading list of 7 series, including \"The Stormlight Archive\" and \"The Expanse,\" totaling 4,200 pages, can you help me prioritize them to reach my goal?",
      ),
      makeSourceFact(
        "fact-poppy-war-pages-noise",
        154,
        "[BEAM chat_id=154 role=user time=unknown] I finished \"The Poppy War\" trilogy with 1,150 pages in 12 days, what's a good next series to read for my winter evenings?",
      ),
      makeSourceFact(
        "fact-witcher-library-noise",
        214,
        "[BEAM chat_id=214 role=user time=unknown] I visited Montserrat Public Library on February 12 and borrowed the first novel of \"The Witcher\" series, among other fantasy e-books.",
      ),
      makeSourceFact(
        "fact-nightingale-series-noise",
        284,
        "[BEAM chat_id=284 role=user time=unknown] I just finished reading \"The Nightingale\" and gave it a 5-star review on Goodreads, can you help me find another historical fiction series?",
      ),
    ];

    const result = selectFacts(
      facts,
      "How many series did I say were on my reading list, and what was the total page count?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-reading-list-count-pages",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-poppy-war-pages-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-nightingale-series-noise")?.returned).toBe(false);
  });

  it("keeps shoe-size count context and values for cross-session count questions", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        sessionId: "beam-conversation-15",
        tags: ["source_message", "source_order", "user_answer"],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-sneaker-choice-context",
        32,
        "[BEAM chat_id=32 role=user time=unknown] I'm deciding between Adidas Ultraboost for $180 and Nike React Infinity Run for $160, which one should I choose for daily wear? ->-> 1,9",
      ),
      makeSourceFact(
        "fact-sneaker-size-values",
        116,
        "[BEAM chat_id=116 role=user time=May-10-2024] I'm considering returning the Adidas Ultraboost size 11 I got on April 30 because of slight heel slippage, and I've already reordered size 11.5 on May 1, what are my chances of getting a good fit this time? ->-> 3,2",
      ),
      makeSourceFact(
        "fact-foot-locker-noise",
        34,
        "[BEAM chat_id=34 role=user time=unknown] I'm planning to visit Foot Locker on Main Street, East Janethaven, next Saturday at 3 PM, can you help me make the most of my trip to find the perfect sneakers? ->-> 1,10",
      ),
      makeSourceFact(
        "fact-neutral-colors-noise",
        28,
        "[BEAM chat_id=28 role=user time=unknown] I prefer sneakers with a sleek, modern look in neutral colors like black or gray, do you have any recommendations for a style that fits my taste? ->-> 1,8",
      ),
    ];

    const result = selectFacts(
      facts,
      "How many different shoe sizes have I mentioned across my messages?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-sneaker-choice-context",
      "fact-sneaker-size-values",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-foot-locker-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-neutral-colors-noise")?.returned).toBe(false);
  });

  it("keeps kids school activity days evidence for temporal discrimination questions", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        sessionId: "beam-conversation-17",
        tags: ["source_message", "source_order", "user_answer"],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-kids-school-activity-days",
        18,
        "[BEAM chat_id=18 role=user time=unknown] I've got three kids, Emma, who's 11, Michelle, 12, and Rachel, 7, all attending East Janethaven Primary School with activities on Tuesdays and Thursdays, and I'm trying to figure out how to manage my time so I can attend.",
      ),
      makeSourceFact(
        "fact-attend-activities-plan-noise",
        19,
        "[BEAM chat_id=19 role=assistant time=unknown] Managing time effectively while ensuring you can attend your children's school activities is crucial for supporting their development.",
      ),
      makeSourceFact(
        "fact-work-hours-noise",
        49,
        "[BEAM chat_id=49 role=assistant time=unknown] Reducing your work hours from 50 to 40 by July is a great goal.",
      ),
      makeSourceFact(
        "fact-monthly-school-meetings-noise",
        163,
        "[BEAM chat_id=163 role=assistant time=unknown] Negotiating to attend only monthly meetings with Rachel's school is a reasonable compromise.",
      ),
    ];

    const result = selectFacts(
      facts,
      "Which days did I say my kids have their afterschool activities at their school?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-kids-school-activity-days",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-attend-activities-plan-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-monthly-school-meetings-noise")?.returned).toBe(false);
  });

  it("keeps print book budget planning evidence for spending-balance questions", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        sessionId: "beam-conversation-13",
        tags: ["source_message", "source_order", "user_answer"],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-print-book-budget-user",
        34,
        "[BEAM chat_id=34 role=user time=unknown] I've allocated $120 for book purchases this winter and I'm looking to buy print editions from Montserrat Books on Main Street, can you suggest some must-read fiction series that fit my budget?",
      ),
      makeSourceFact(
        "fact-print-book-budget-advice",
        35,
        "[BEAM chat_id=35 role=assistant time=unknown] Absolutely! With a budget of $120 for print editions from Montserrat Books on Main Street, you can find some great must-read fiction series that should fit within your budget and provide a variety of choices.",
      ),
      makeSourceFact(
        "fact-thursday-murder-club-noise",
        173,
        "[BEAM chat_id=173 role=assistant time=unknown] You're very welcome! \"The Thursday Murder Club\" by Richard Osman is an excellent choice for unwinding after your morning meditation.",
      ),
      makeSourceFact(
        "fact-outlander-noise",
        177,
        "[BEAM chat_id=177 role=assistant time=unknown] You're very welcome! \"The Outlander Series\" by Diana Gabaldon is an excellent choice for deepening your bond with your partner.",
      ),
      makeSourceFact(
        "fact-dune-noise",
        181,
        "[BEAM chat_id=181 role=assistant time=unknown] You're very welcome! \"The Dune Series\" by Frank Herbert is an excellent choice for exploring complex political intrigue and ecological themes.",
      ),
    ];

    const result = selectFacts(
      facts,
      "How did you help me balance my spending to get a variety of print books while staying within my set limits?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-print-book-budget-user",
      "fact-print-book-budget-advice",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-thursday-murder-club-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-outlander-noise")?.returned).toBe(false);
  });

  it("prefers the latest shared grocery-list method evidence over stale paper-list evidence", () => {
    const language = createLanguageService();
    const facts = [
      createFactMemory({
        id: "fact-mom-paper-list",
        userId: "user-1",
        category: "external_benchmark",
        content:
          "My mom still uses her old paper grocery list while I use a grocery list app.",
        source: SOURCE,
        tags: ["user_answer", "compact_evidence"],
        updatedAt: "2023-05-02T00:00:00.000Z",
      }),
      createFactMemory({
        id: "fact-mom-shared-app",
        userId: "user-1",
        category: "external_benchmark",
        content: "Mom is on the shared grocery list app now.",
        source: SOURCE,
        tags: ["user_answer", "compact_evidence"],
        updatedAt: "2023-09-14T00:00:00.000Z",
      }),
    ];

    const result = selectFacts(
      facts,
      "Is my mom using the same grocery list method as me?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-mom-shared-app",
    ]);
  });

  it("prefers the latest recent-family-trip evidence for most-recent trip questions", () => {
    const language = createLanguageService();
    const facts = [
      createFactMemory({
        id: "fact-trip-hawaii",
        userId: "user-1",
        category: "external_benchmark",
        content: "My most recent family trip was to Hawaii.",
        source: SOURCE,
        tags: ["user_answer", "compact_evidence"],
        updatedAt: "2023-03-21T00:00:00.000Z",
      }),
      createFactMemory({
        id: "fact-trip-paris",
        userId: "user-1",
        category: "external_benchmark",
        content: "Our family trip moved to Paris in the latest update.",
        source: SOURCE,
        tags: ["user_answer", "compact_evidence"],
        updatedAt: "2023-10-06T00:00:00.000Z",
      }),
    ];

    const result = selectFacts(
      facts,
      "Where did I go on my most recent family trip?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual(["fact-trip-paris"]);
  });

  it("orders sleep-before-appointment bridge evidence with the sleep time first", () => {
    const language = createLanguageService();
    const facts = [
      createFactMemory({
        id: "fact-appointment",
        userId: "user-1",
        category: "external_benchmark",
        content:
          "On 2023/05/24, I had a doctor's appointment at 10 AM last Thursday, and that's when I got the results.",
        source: SOURCE,
        tags: ["user_answer", "compact_evidence"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-sleep",
        userId: "user-1",
        category: "external_benchmark",
        content: "I went to bed at 2 AM last Wednesday.",
        source: SOURCE,
        tags: ["user_answer", "compact_evidence"],
        updatedAt: TIMESTAMP,
      }),
    ];

    const result = selectFacts(
      facts,
      "What time did I go to bed on the day before I had a doctor's appointment?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-sleep",
      "fact-appointment",
    ]);
  });

  it("returns dated event facts for earliest-to-latest order questions", () => {
    const language = createLanguageService();
    const facts = [
      createFactMemory({
        id: "fact-trip-muir-woods",
        userId: "user-1",
        category: "external_benchmark",
        content: "On 2023/03/10, I went on a day hike to Muir Woods.",
        source: SOURCE,
        tags: ["user_answer", "compact_evidence", "dated_event"],
        updatedAt: "2023-03-10T00:00:00.000Z",
      }),
      createFactMemory({
        id: "fact-trip-big-sur",
        userId: "user-1",
        category: "external_benchmark",
        content: "On 2023/04/20, I went on a road trip to Big Sur and Monterey.",
        source: SOURCE,
        tags: ["user_answer", "compact_evidence", "dated_event"],
        updatedAt: "2023-04-20T00:00:00.000Z",
      }),
      createFactMemory({
        id: "fact-trip-yosemite",
        userId: "user-1",
        category: "external_benchmark",
        content: "On 2023/05/15, I started my solo camping trip to Yosemite.",
        source: SOURCE,
        tags: ["user_answer", "compact_evidence", "dated_event"],
        updatedAt: "2023-05-15T00:00:00.000Z",
      }),
    ];

    const result = selectFacts(
      facts,
      "What is the order of the three trips I took in the past three months, from earliest to latest?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id).sort()).toEqual([
      "fact-trip-big-sur",
      "fact-trip-yosemite",
      "fact-trip-muir-woods",
    ].sort());
  });

  it("prioritizes temporal interval boundary events over later high-overlap dated noise", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      content: string,
      tags: string[] = ["source_message", "source_order", "user_answer"],
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags,
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const noiseFacts = Array.from({ length: 8 }, (_, index) =>
      makeSourceFact(
        `fact-weather-noise-${index}`,
        70 + index * 2,
        `[BEAM chat_id=${70 + index * 2} role=user time=March-${20 + index}-2024] I am working on my weather app with OpenWeather API v2.5, API key environment variables, UI error display, and completed API error handling improvements.`,
        ["source_message", "source_order", "user_answer", "dated_event"],
      )
    );
    const facts = [
      makeSourceFact(
        "fact-openweather-key",
        32,
        "[BEAM chat_id=32 role=user time=unknown] I am handling rate limits for my OpenWeather API key obtained on March 10, 2024.",
      ),
      makeSourceFact(
        "fact-wireframe-complete",
        42,
        "[BEAM chat_id=42 role=user time=unknown] I completed the UI wireframe for my weather app on March 12, 2024.",
      ),
      ...noiseFacts,
    ];

    const result = selectFacts(
      facts,
      "How many days passed between when I obtained my OpenWeather API key and when I completed the UI wireframe for my weather app?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    const selectedIds = result.facts.map((fact) => fact.id);
    expect(selectedIds).toContain("fact-openweather-key");
    expect(selectedIds).toContain("fact-wireframe-complete");
  });

  it("prioritizes raise rejection and final meeting reschedule boundaries for interval questions", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-rejected-raise",
        56,
        "[BEAM chat_id=56 role=user time=unknown] I'm kinda torn about rejecting that $10,000 raise on March 12, was that a smart move considering my current situation?",
      ),
      makeSourceFact(
        "fact-final-meeting-rescheduled",
        64,
        "[BEAM chat_id=64 role=user time=unknown] I'm kinda worried about making the right decision on March 30, so I rescheduled my final meeting to have more time.",
      ),
      makeSourceFact(
        "fact-matthew-call-noise",
        84,
        "[BEAM chat_id=84 role=user time=unknown] I rescheduled a call with Matthew from April 4 to April 6 while preparing for my first startup meeting.",
      ),
      makeSourceFact(
        "fact-social-context-instruction-noise",
        134,
        "[BEAM chat_id=134 role=user time=unknown] Always include cultural context when I ask about social norms.",
      ),
      makeSourceFact(
        "fact-date-confirmation-instruction-noise",
        264,
        "[BEAM chat_id=264 role=user time=unknown] Always confirm dates when I ask about scheduled events.",
      ),
    ];

    const result = selectFacts(
      facts,
      "How many days passed between when I decided to reject the raise and when I rescheduled my final meeting to give myself more time?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-rejected-raise",
      "fact-final-meeting-rescheduled",
    ]);
  });

  it("does not treat ordinary received-feedback anchors as acquisition boundary events", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      content: string,
      tags: string[] = ["source_message", "source_order", "user_answer", "dated_event"],
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags,
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const noiseFacts = Array.from({ length: 8 }, (_, index) =>
      makeSourceFact(
        `fact-feedback-noise-${index}`,
        111 + index * 2,
        `[BEAM chat_id=${111 + index * 2} role=assistant time=unknown] I received positive feedback from managers after the AI pilot and prepared follow-up guidance about transparency, audits, and candidate communication on April ${29 + index}, 2024.`,
        ["source_message", "source_order", "dated_event"],
      )
    );
    const facts = [
      makeSourceFact(
        "fact-wyatt-meeting",
        56,
        "[BEAM chat_id=56 role=user time=unknown] Wyatt expressed skepticism about AI fairness during our March 10 meeting at Media Hub.",
      ),
      makeSourceFact(
        "fact-manager-feedback",
        110,
        "[BEAM chat_id=110 role=user time=unknown] I received positive feedback from 2 managers on April 28 after continuing the AI pilot.",
      ),
      ...noiseFacts,
    ];

    const result = selectFacts(
      facts,
      "How many days passed between my meeting with Wyatt expressing skepticism and the positive feedback I received from the managers?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    const selectedIds = result.facts.map((fact) => fact.id);
    expect(selectedIds).toContain("fact-wyatt-meeting");
    expect(selectedIds).toContain("fact-manager-feedback");
  });

  it("returns source-ordered imported evidence for event-order questions without dates", () => {
    const language = createLanguageService();
    const facts = [
      createFactMemory({
        id: "fact-budget-core",
        userId: "user-1",
        category: "external_benchmark",
        content:
          "I want to build a personal budget tracker with user authentication, expense tracking, and data visualization.",
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: {
          sourceOrder: 4,
        },
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-transactions",
        userId: "user-1",
        category: "external_benchmark",
        content:
          "I am implementing transaction creation with proper response handling and error management.",
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: {
          sourceOrder: 60,
        },
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-security",
        userId: "user-1",
        category: "external_benchmark",
        content:
          "I need security hardening before deployment, especially authentication and authorization.",
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: {
          sourceOrder: 116,
        },
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-generic-distractor",
        userId: "user-1",
        category: "external_benchmark",
        content:
          "A generic Flask checklist mentioned deployment and auth terms without being a source turn.",
        source: SOURCE,
        updatedAt: TIMESTAMP,
      }),
    ];

    const result = selectFacts(
      facts,
      "Can you list the order in which I brought up different aspects of developing my personal budget tracker throughout our conversations, in order?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-budget-core",
      "fact-transactions",
      "fact-security",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-generic-distractor")?.returned).toBe(false);
  });

  it("fills source-ordered topical gaps for broad event-order questions", () => {
    const language = createLanguageService();
    const facts = [
      createFactMemory({
        id: "fact-breakdown",
        userId: "user-1",
        category: "external_benchmark",
        content:
          "Sure, let's break it down for my budget tracker project: user authentication, transaction management, and basic analytics.",
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: { sourceOrder: 2 },
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-budget-core",
        userId: "user-1",
        category: "external_benchmark",
        content:
          "I want to build a personal budget tracker with user authentication, expense tracking, and data visualization.",
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: { sourceOrder: 4 },
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-password",
        userId: "user-1",
        category: "external_benchmark",
        content:
          "I am implementing basic password hashing for my personal budget tracker using Werkzeug.security.",
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: { sourceOrder: 16 },
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-minimal",
        userId: "user-1",
        category: "external_benchmark",
        content:
          "I want my Flask app to stay minimal while meeting the MVP deadline for income tracking, login, and analytics.",
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: { sourceOrder: 34 },
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-transactions",
        userId: "user-1",
        category: "external_benchmark",
        content:
          "I am currently working on transaction CRUD and analytics integration for my personal budget tracker, with completed registration and login modules.",
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: { sourceOrder: 60 },
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-rest-api",
        userId: "user-1",
        category: "external_benchmark",
        content:
          "I am designing a REST API for transactions with validation and error handling.",
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: { sourceOrder: 82 },
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-logging",
        userId: "user-1",
        category: "external_benchmark",
        content:
          "I am configuring Flask logging to output to budget_tracker.log and capture stack traces.",
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: { sourceOrder: 96 },
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-security",
        userId: "user-1",
        category: "external_benchmark",
        content:
          "I am finalizing deployment and need UI/UX improvements plus security hardening for authentication and authorization before public launch.",
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: { sourceOrder: 116 },
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-docs",
        userId: "user-1",
        category: "external_benchmark",
        content:
          "I am documenting API endpoints and architecture decisions in Confluence for a remote collaborator.",
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: { sourceOrder: 176 },
        updatedAt: TIMESTAMP,
      }),
    ];

    const result = selectFacts(
      facts,
      "Can you list the order in which I brought up different aspects of developing my personal budget tracker throughout our conversations, in order? Mention ONLY and ONLY three items.",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    const selectedIds = result.facts.map((fact) => fact.id);
    expect(selectedIds).toContain("fact-budget-core");
    expect(selectedIds).toContain("fact-transactions");
    expect(selectedIds).toContain("fact-security");
    expect(
      selectedIds.indexOf("fact-budget-core"),
    ).toBeLessThan(selectedIds.indexOf("fact-transactions"));
    expect(
      selectedIds.indexOf("fact-transactions"),
    ).toBeLessThan(selectedIds.indexOf("fact-security"));
  });

  it("fills late source-ordered deployment and test evidence for broad app event-order questions", () => {
    const language = createLanguageService();
    const makeFact = (id: string, sourceOrder: number, content: string) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: { sourceOrder },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeFact(
        "fact-breakdown",
        2,
        "Budget tracker project breakdown: user authentication, transaction management, and analytics milestones.",
      ),
      makeFact(
        "fact-core",
        4,
        "I want to implement core budget tracker functionality with user authentication and expense tracking.",
      ),
      makeFact(
        "fact-local-setup",
        6,
        "I am initializing a Flask 2.3.1 project on Python 3.11 with SQLite 3.39 for local dev on port 5000.",
      ),
      makeFact(
        "fact-schema",
        12,
        "I am designing the database schema and models for income, expenses, and analytics.",
      ),
      makeFact(
        "fact-minimal",
        34,
        "I want the Flask app to stay minimal while still implementing tracking, login, and analytics.",
      ),
      makeFact(
        "fact-blueprints",
        48,
        "I am modularizing the app into auth, transactions, and analytics blueprints.",
      ),
      makeFact(
        "fact-sprint",
        52,
        "I am updating the project timeline and sprint plan for the budget tracker.",
      ),
      makeFact(
        "fact-transaction-post",
        62,
        "I am implementing the POST /transactions route and need the response handling and error management to be correct.",
      ),
      makeFact(
        "fact-rest-api",
        82,
        "I am designing a REST API for transactions with validation and error handling.",
      ),
      makeFact(
        "fact-analytics",
        86,
        "I am working on sprint 2 for analytics after completing auth and basic transaction CRUD.",
      ),
      makeFact(
        "fact-security-review",
        116,
        "I am finalizing deployment and need security hardening for authentication and authorization.",
      ),
      makeFact(
        "fact-gunicorn-tests",
        118,
        "I am having deployment issues with Gunicorn on Render.com, using 3 workers on port 10000, and my integration tests cover user auth, transaction CRUD, and analytics endpoints with a 95% pass rate.",
      ),
      makeFact(
        "fact-security-tests",
        120,
        "I will add more tests to cover edge cases and security vulnerabilities, specifically SQL injection and XSS.",
      ),
      makeFact(
        "fact-docs",
        176,
        "I am documenting API endpoints and architecture decisions in Confluence.",
      ),
    ];

    const result = selectFacts(
      facts,
      "Can you walk me through the order in which I brought up different aspects of my app development and deployment across our conversations? Mention ONLY and ONLY five items.",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    const selectedIds = result.facts.map((fact) => fact.id);
    for (const expectedId of [
      "fact-local-setup",
      "fact-transaction-post",
      "fact-gunicorn-tests",
      "fact-security-tests",
    ]) {
      expect(selectedIds).toContain(expectedId);
    }
    expect(
      selectedIds.indexOf("fact-local-setup"),
    ).toBeLessThan(selectedIds.indexOf("fact-transaction-post"));
    expect(
      selectedIds.indexOf("fact-transaction-post"),
    ).toBeLessThan(selectedIds.indexOf("fact-gunicorn-tests"));
    expect(
      selectedIds.indexOf("fact-gunicorn-tests"),
    ).toBeLessThan(selectedIds.indexOf("fact-security-tests"));
  });

  it("keeps framework customization milestones for source-ordered event questions", () => {
    const language = createLanguageService();
    const makeFact = (id: string, sourceOrder: number, content: string) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeFact(
        "fact-bootstrap-cdn",
        10,
        "I'm trying to integrate Bootstrap 5.3.0 CDN into my portfolio website for a responsive grid, navbar, and cards.",
      ),
      makeFact(
        "fact-bundle-noise",
        48,
        "I'm trying to optimize my Bootstrap bundle size under 150KB by deferring unused components.",
      ),
      makeFact(
        "fact-contact-form-noise",
        16,
        "I'm trying to implement the contact form with validation as part of my MVP features, but I'm having trouble getting the form data to submit reliably.",
      ),
      makeFact(
        "fact-form-classes",
        72,
        "I'm trying to integrate Bootstrap form-control and btn-primary classes into my project for consistent styling and hover effects with custom CSS.",
      ),
      makeFact(
        "fact-image-noise",
        76,
        "I'm optimizing image sizes in my project gallery with ImageOptim and PIL scripts.",
      ),
      makeFact(
        "fact-css-refactor-noise",
        146,
        "I'm refactoring CSS from 450 lines to 320 lines by removing redundant selectors and consolidating media queries.",
      ),
      makeFact(
        "fact-modal-upgrade",
        148,
        "I'm trying to fix a known modal accessibility bug in my Bootstrap project by upgrading from v5.3.0 to v5.3.1 without breaking existing custom modals.",
      ),
    ];

    const query =
      "Can you list the order in which I brought up different aspects of integrating and customizing the framework in my projects across our conversations, in order? Mention ONLY and ONLY three items.";
    const ranked = rankFactCandidates(
      buildFactCandidates(facts, query, language, "en", TIMESTAMP),
      "rules-only",
    );
    const selectedIds = selectSourceOrderedEventOrderEvidence({
      entries: ranked,
      language,
      query,
      queryLocale: "en",
    }).map((entry) => entry.fact.id);

    expect(selectedIds).toEqual([
      "fact-bootstrap-cdn",
      "fact-form-classes",
      "fact-modal-upgrade",
    ]);
  });

  it("keeps framework customization milestones in full event-order selection", () => {
    const language = createLanguageService();
    const makeFact = (id: string, sourceOrder: number, content: string) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeFact(
        "fact-bootstrap-cdn",
        10,
        "I'm trying to integrate Bootstrap 5.3.0 CDN into my portfolio website for a responsive grid, navbar, and cards.",
      ),
      makeFact(
        "fact-bundle-noise",
        48,
        "I'm trying to optimize my Bootstrap bundle size under 150KB by deferring unused components.",
      ),
      makeFact(
        "fact-contact-form-noise",
        16,
        "I'm trying to implement the contact form with validation as part of my MVP features, but I'm having trouble getting the form data to submit reliably.",
      ),
      makeFact(
        "fact-form-classes",
        72,
        "I'm trying to integrate Bootstrap form-control and btn-primary classes into my project for consistent styling and hover effects with custom CSS.",
      ),
      makeFact(
        "fact-image-noise",
        76,
        "I'm optimizing image sizes in my project gallery with ImageOptim and PIL scripts.",
      ),
      makeFact(
        "fact-css-refactor-noise",
        146,
        "I'm refactoring CSS from 450 lines to 320 lines by removing redundant selectors and consolidating media queries.",
      ),
      makeFact(
        "fact-modal-upgrade",
        148,
        "I'm trying to fix a known modal accessibility bug in my Bootstrap project by upgrading from v5.3.0 to v5.3.1 without breaking existing custom modals.",
      ),
    ];

    const result = selectFacts(
      facts,
      "Can you list the order in which I brought up different aspects of integrating and customizing the framework in my projects across our conversations, in order? Mention ONLY and ONLY three items.",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    const selectedIds = result.facts.map((fact) => fact.id);
    for (const expectedId of [
      "fact-bootstrap-cdn",
      "fact-form-classes",
      "fact-modal-upgrade",
    ]) {
      expect(selectedIds).toContain(expectedId);
    }
  });

  it("keeps book club activity milestones for source-ordered event questions", () => {
    const language = createLanguageService();
    const makeFact = (id: string, sourceOrder: number, content: string) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeFact(
        "fact-library-book-club",
        16,
        "I met Kelly at the East Janethaven Library book club on October 12, 2022, and I was wondering if you could recommend something that she might like too, since we both seem to enjoy discussing books together.",
      ),
      makeFact(
        "fact-poppy-war-noise",
        42,
        "My close friend David, whom I met at a film festival, recommended The Poppy War series last month, so I'm wondering if that's a good starting point for my winter evenings.",
      ),
      makeFact(
        "fact-reading-goal-noise",
        78,
        "I'm kinda worried I won't meet my reading goal after completing 1,200 pages of The Stormlight Archive, and I'm not sure if switching to audiobooks after 8 PM will help me stay on track.",
      ),
      makeFact(
        "fact-never-met-noise",
        64,
        "I've never met Kelly at any book club or library event, which is weird because I thought we would have crossed paths by now, do you think I should try to reach out to her through a book club or something?",
      ),
      makeFact(
        "fact-missed-book-club",
        86,
        "I'm kinda stressed about missing Kelly's book club meeting at The Reading Room cafe on 4th Avenue, can you help me figure out what I missed on December 5?",
      ),
      makeFact(
        "fact-follow-up-noise",
        88,
        "Sure, I'll message Kelly to ask about the book and the discussion points. Hi Kelly, I had to miss the book club meeting on December 5. Could you let me know which book was discussed?",
      ),
      makeFact(
        "fact-libby-noise",
        120,
        "I'm kinda stuck on what to do next with my reading, I downloaded The Poppy War trilogy on Libby app on December 7, and it's a total of 1,150 pages.",
      ),
      makeFact(
        "fact-reading-session",
        164,
        "I'm kinda worried about rescheduling my studio meeting from January 20 to January 22, hope it doesn't mess up my plans, you know, like attending Kelly's reading session on January 25 at The Reading Room cafe.",
      ),
      makeFact(
        "fact-boundary-noise",
        202,
        "Douglas and I agreed to limit book discussions to weekends to avoid work distractions, but I'm having a hard time sticking to it.",
      ),
      makeFact(
        "fact-hosted-discussion",
        222,
        "I hosted a book club discussion on The Poppy War with Kelly on February 20, and now I'm thinking of reading another series, maybe something Kelly would like, since we had 12 attendees and it was a great success.",
      ),
      makeFact(
        "fact-fantasy-noise",
        236,
        "I've been reading a lot of fantasy lately, and Megan recommended The Witcher series on February 10, but I'm also interested in historical fiction.",
      ),
      makeFact(
        "fact-balanced-discussions",
        272,
        "What's a good way to balance my book discussions with Douglas, considering he requested fewer discussions during work hours and we agreed on 7-9 PM, like we did with Kelly for our March 20 discussion on The Nightingale and The Witcher at The Reading Room?",
      ),
      makeFact(
        "fact-goodreads-noise",
        284,
        "I just finished reading The Nightingale and gave it a 5-star review on Goodreads, can you help me find another historical fiction series with similar emotional depth and pacing?",
      ),
    ];

    const query =
      "Can you list the order in which I brought up different aspects of my book club activities throughout our conversations in order? Mention ONLY and ONLY five items.";
    const selectedIds = selectSourceOrderedEventOrderEvidence({
      entries: rankFactCandidates(
        buildFactCandidates(facts, query, language, "en", TIMESTAMP),
        "rules-only",
      ),
      language,
      query,
      queryLocale: "en",
    }).map((entry) => entry.fact.id);

    expect(selectedIds).toEqual([
      "fact-library-book-club",
      "fact-missed-book-club",
      "fact-reading-session",
      "fact-hosted-discussion",
      "fact-balanced-discussions",
    ]);

    const result = selectFacts(
      facts,
      query,
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-library-book-club",
      "fact-missed-book-club",
      "fact-reading-session",
      "fact-hosted-discussion",
      "fact-balanced-discussions",
    ]);
  });

  it("keeps movie-night contribution milestones for source-ordered event questions", () => {
    const language = createLanguageService();
    const makeFact = (id: string, sourceOrder: number, content: string) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeFact(
        "fact-thomas-noise",
        12,
        "I'm planning a movie night with my partner Thomas and want to pick a classic film we both love.",
      ),
      makeFact(
        "fact-friends-preferences",
        14,
        "I'm thinking of inviting Christopher and Emily, my close friends from college, but I'm not sure if they'd be into the same type of movies as Thomas and me.",
      ),
      makeFact(
        "fact-forrest-gump",
        16,
        "I think Forrest Gump sounds perfect because it is a heartwarming classic that Thomas and my friends from college would likely love.",
      ),
      makeFact(
        "fact-platform-instruction-noise",
        52,
        "Always include platform availability details when I ask about movie options.",
      ),
      makeFact(
        "fact-high-rating-noise",
        70,
        "I'm looking for a movie with a high rating like The Mitchells vs. The Machines for my family weekend.",
      ),
      makeFact(
        "fact-klaus-popcorn",
        72,
        "My friend Christopher suggested \"Klaus\" for its animation style and Emily is bringing homemade popcorn seasoning mix on April 6, should I add \"Klaus\" to our watchlist for the movie marathon?",
      ),
      makeFact(
        "fact-activities",
        182,
        "Can you suggest some fun activities for a family movie night, like the one where Emily offered to bring a karaoke machine and Christopher volunteered to DJ with a family-friendly playlist?",
      ),
      makeFact(
        "fact-educational-noise",
        196,
        "What movies would you recommend for a family weekend that are both entertaining and educational, like March of the Penguins?",
      ),
      makeFact(
        "fact-playlist",
        246,
        "How did Mason's playlist of 30 songs contribute to the karaoke night's success, considering the close friendship between Emily and Mason?",
      ),
      makeFact(
        "fact-work-deadline-noise",
        256,
        "I'm trying to balance my work deadlines with blocking 4 hours each weekend for movie planning and preparation.",
      ),
      makeFact(
        "fact-cupcake-noise",
        260,
        "I'm planning a family movie night and want help deciding how many cupcakes to order from The Sweet Spot with a $70 snack budget.",
      ),
      makeFact(
        "fact-board-games",
        130,
        "Mason brought board games for post-movie entertainment and Michael sent a gift card as thanks for the invitation, how can I make sure my future movie nights are just as enjoyable for my close friends?",
      ),
    ];
    const query =
      "Can you walk me through the order in which I brought up different ideas and contributions related to my movie nights across our conversations, in order? Mention ONLY and ONLY five items.";
    const selectedIds = selectSourceOrderedEventOrderEvidence({
      entries: rankFactCandidates(
        buildFactCandidates(facts, query, language, "en", TIMESTAMP),
        "rules-only",
      ),
      language,
      query,
      queryLocale: "en",
    }).map((entry) => entry.fact.id);

    expect(selectedIds).toEqual([
      "fact-friends-preferences",
      "fact-forrest-gump",
      "fact-klaus-popcorn",
      "fact-activities",
      "fact-playlist",
      "fact-board-games",
    ]);

    const result = selectFacts(
      facts,
      query,
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-friends-preferences",
      "fact-forrest-gump",
      "fact-klaus-popcorn",
      "fact-activities",
      "fact-playlist",
      "fact-board-games",
    ]);
  });

  it("keeps family-support personal-statement milestones source ordered", () => {
    const language = createLanguageService();
    const makeFact = (id: string, sourceOrder: number, content: string) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeFact(
        "fact-cultural-roots",
        24,
        "My mom, Wendy, told me to highlight my cultural roots in my personal statement without sounding cliche.",
      ),
      makeFact(
        "fact-career-gap-noise",
        36,
        "I'm debating whether to mention a 6-month career gap in 2022 due to family illness in my personal statement.",
      ),
      makeFact(
        "fact-progress-noise",
        42,
        "I've completed 40% of the first draft and want to finish it by March 31 to allow two revision rounds.",
      ),
      makeFact(
        "fact-documentary-noise",
        52,
        "Kimberly suggested adding the local documentary that won 2nd place at the Janethaven Film Awards to my personal statement.",
      ),
      makeFact(
        "fact-storytelling-noise",
        60,
        "Shawn shared insights on storytelling impact at Montserrat Media Hub and I want to incorporate those into my personal statement.",
      ),
      makeFact(
        "fact-tanya-pitch",
        76,
        "I appreciate Tanya helping me rehearse my 5-minute personal pitch on April 4, and it improved my confidence for interviews, but I need to show this family support in my statement without sounding casual.",
      ),
      makeFact(
        "fact-wendy-resilience-letter",
        118,
        "I appreciate Wendy's support, especially her handwritten letter on May 5 encouraging me to emphasize resilience in my story and personal statement.",
      ),
      makeFact(
        "fact-draft-count-noise",
        126,
        "I've completed 3 full drafts and had 2 peer reviews, but I'm still unsure if my final version is ready for submission.",
      ),
      makeFact(
        "fact-scholarship-noise",
        158,
        "I have never submitted any scholarship application or uploaded documents online and need guidance getting started.",
      ),
      makeFact(
        "fact-care-package",
        208,
        "Wendy mailed a care package with local spices and handwritten notes on June 13, making me feel supported by my family, and I want to express this support in my personal statement.",
      ),
      makeFact(
        "fact-last-letter-self-care",
        260,
        "How can I express gratitude for Wendy's last letter reminding me to balance work and self-care abroad in my personal statement without sounding too sentimental?",
      ),
    ];
    const query =
      "Can you walk me through the order in which I brought up different ways my family has supported me in my personal statement across our conversations, in order? Mention ONLY and ONLY five items.";

    const selectedIds = selectSourceOrderedEventOrderEvidence({
      entries: rankFactCandidates(
        buildFactCandidates(facts, query, language, "en", TIMESTAMP),
        "rules-only",
      ),
      language,
      query,
      queryLocale: "en",
    }).map((entry) => entry.fact.id);

    expect(selectedIds).toEqual([
      "fact-cultural-roots",
      "fact-tanya-pitch",
      "fact-wendy-resilience-letter",
      "fact-care-package",
      "fact-last-letter-self-care",
    ]);

    const result = selectFacts(
      facts,
      query,
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-cultural-roots",
      "fact-tanya-pitch",
      "fact-wendy-resilience-letter",
      "fact-care-package",
      "fact-last-letter-self-care",
    ]);
  });

  it("keeps workload-management strategy milestones source ordered", () => {
    const language = createLanguageService();
    const makeFact = (id: string, sourceOrder: number, content: string) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeFact(
        "fact-laura-schedule-call",
        26,
        "I've got a weekly Zoom call with Laura, a veteran producer, every Monday at 10 AM, and I want to ask her for advice on how to manage my schedule better.",
      ),
      makeFact(
        "fact-email-batching-noise",
        60,
        "I'll set aside Fridays from 2:00 PM to 5:00 PM for email processing and use filters for urgent, important, and routine messages.",
      ),
      makeFact(
        "fact-laura-trello-task-batching",
        88,
        "I'm stressed about meeting my June 30 pilot episode deadline and wonder if using Trello boards for task batching like Laura suggested could help me manage my time better.",
      ),
      makeFact(
        "fact-evening-boundary-noise",
        104,
        "I agreed with James to limit work calls after 7 PM, which improved our evening time by 2 hours weekly.",
      ),
      makeFact(
        "fact-mindfulness-noise",
        106,
        "Daily 30-minute mindfulness sessions at 3 PM helped reduce my stress from 7/10 to 4/10 by May 1.",
      ),
      makeFact(
        "fact-pilates-noise",
        116,
        "I've started taking 3 weekly Pilates classes at Montserrat Wellness Center since April 22 and feel more energetic.",
      ),
      makeFact(
        "fact-stephanie-agency",
        154,
        "I hired Stephanie's agency for $800/month on June 20 for social media management after Laura advised me to delegate, and I want to know whether this will help my workload.",
      ),
      makeFact(
        "fact-summer-camp-noise",
        144,
        "Emma and Michelle started summer camp at East Janethaven Community Center on June 15, and I'm balancing work and family time.",
      ),
      makeFact(
        "fact-michele-assistant",
        202,
        "I'm thinking of asking Michele, my new part-time assistant hired for 20 hours/week at $25/hour after Laura recommended hiring one, to help me manage my schedule better.",
      ),
      makeFact(
        "fact-final-cut-noise",
        153,
        "Choosing Adobe over Final Cut Pro seems reasonable because I am already familiar with Adobe products and can avoid retraining costs.",
      ),
      makeFact(
        "fact-laura-audience-engagement",
        248,
        "I had a review meeting with Laura on November 10, and she suggested focusing on audience engagement strategies while I balance that with my existing marketing prep schedule on Mondays and Wednesdays.",
      ),
    ];
    const query =
      "Can you list the order in which I brought up different strategies and support options for managing my workload throughout our conversations in order? Mention ONLY and ONLY five items.";

    const selectedIds = selectSourceOrderedEventOrderEvidence({
      entries: rankFactCandidates(
        buildFactCandidates(facts, query, language, "en", TIMESTAMP),
        "rules-only",
      ),
      language,
      query,
      queryLocale: "en",
    }).map((entry) => entry.fact.id);

    expect(selectedIds).toEqual([
      "fact-laura-schedule-call",
      "fact-laura-trello-task-batching",
      "fact-stephanie-agency",
      "fact-michele-assistant",
      "fact-laura-audience-engagement",
    ]);

    const result = selectFacts(
      facts,
      query,
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-laura-schedule-call",
      "fact-laura-trello-task-batching",
      "fact-stephanie-agency",
      "fact-michele-assistant",
      "fact-laura-audience-engagement",
    ]);
  });

  it("keeps financial-planning topic milestones source ordered", () => {
    const language = createLanguageService();
    const makeFact = (id: string, sourceOrder: number, content: string) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeFact(
        "fact-tamara-money-saving-tips",
        22,
        "I've been talking to my friend Tamara, who is always discussing money-saving tips, and I want to understand what kind of tips she might be sharing.",
      ),
      makeFact(
        "fact-sleep-financial-stress-noise",
        44,
        "I've been tracking my sleep hours and averaging 5.5 hours per night because of financial stress.",
      ),
      makeFact(
        "fact-medical-bills-noise",
        46,
        "I'm stressed about family expecting me to support Ashlee's medical bills, which are around $200 monthly.",
      ),
      makeFact(
        "fact-paypal-noise",
        48,
        "I've been using PayPal for freelance payments and the fees are averaging 3% per transaction.",
      ),
      makeFact(
        "fact-dining-budget-noise",
        50,
        "I prefer using Excel for control and compromised on a $200 dining out budget after Alexis wanted to increase it.",
      ),
      makeFact(
        "fact-investment-workshop",
        66,
        "Tamara recommended a $500 workshop on investment basics happening on June 15 at Montserrat Community Center, and I am weighing it against my goal to save $2,000 by June 30.",
      ),
      makeFact(
        "fact-financial-workshop-noise",
        118,
        "I've never attended any financial workshops and want online resources or local events to learn more about managing my money.",
      ),
      makeFact(
        "fact-freelance-contract-noise",
        120,
        "I'm stressed about a freelance contract Natalie suggested, starting Sept 10 and worth $8,000 over 4 months.",
      ),
      makeFact(
        "fact-tamara-book-club",
        132,
        "Tamara invited me to a financial literacy book club meeting on Sept 15 at East Janethaven Library, and I want to know what to expect.",
      ),
      makeFact(
        "fact-savings-transfer-noise",
        154,
        "I've started an automated $200 monthly transfer to my savings account on Sept 1 and want to avoid overspending.",
      ),
      makeFact(
        "fact-ynab-donation-noise",
        166,
        "I'm curious about how my $50 donation to the local charity will affect my budget now that I'm using YNAB.",
      ),
      makeFact(
        "fact-holiday-gift-compromise",
        256,
        "I compromised with Ashlee on the holiday gifts budget at $300 to balance our budget, and I want to approach similar compromises in the future without feeling like I am sacrificing too much.",
      ),
    ];
    const query =
      "Can you walk me through the order in which I brought up different financial planning topics during our chats, in order? Mention ONLY and ONLY four items.";

    const selectedIds = selectSourceOrderedEventOrderEvidence({
      entries: rankFactCandidates(
        buildFactCandidates(facts, query, language, "en", TIMESTAMP),
        "rules-only",
      ),
      language,
      query,
      queryLocale: "en",
    }).map((entry) => entry.fact.id);

    expect(selectedIds).toEqual([
      "fact-tamara-money-saving-tips",
      "fact-investment-workshop",
      "fact-tamara-book-club",
      "fact-holiday-gift-compromise",
    ]);

    const result = selectFacts(
      facts,
      query,
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-tamara-money-saving-tips",
      "fact-investment-workshop",
      "fact-tamara-book-club",
      "fact-holiday-gift-compromise",
    ]);
  });

  it("keeps stress and financial concern milestones source ordered", () => {
    const language = createLanguageService();
    const makeFact = (id: string, sourceOrder: number, content: string) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeFact(
        "fact-irregular-income-stress",
        24,
        "I'm stressed about managing my irregular income from projects, especially since tax season is coming up in April.",
      ),
      makeFact(
        "fact-average-income-estimate",
        26,
        "What's the best way to estimate my average monthly income based on past project earnings?",
      ),
      makeFact(
        "fact-excel-expense-noise",
        62,
        "I've never used Excel for tracking expenses, can you help me get started with it?",
      ),
      makeFact(
        "fact-evening-walks",
        94,
        "I've been doing these 20-minute evening walks 4 times a week since May 15 to reduce stress.",
      ),
      makeFact(
        "fact-evening-walks-result",
        96,
        "Since I started the evening walks, I've noticed a slight improvement in my sleep and I feel less stressed after the walks.",
      ),
      makeFact(
        "fact-fitbit-sleep-stress",
        160,
        "I've been tracking my sleep and it's improved to 6.5 hours/night since July, I'm using a Fitbit, and I wonder if this is related to my financial stress reduction.",
      ),
      makeFact(
        "fact-fitbit-habits",
        162,
        "The Fitbit has definitely made me more conscious of my habits, and I've been trying to relax more and manage stress better.",
      ),
      makeFact(
        "fact-fitbit-routine",
        164,
        "I'll keep using my Fitbit and journal to track my sleep and other habits and stick to a consistent bedtime routine.",
      ),
      makeFact(
        "fact-budget-review-noise",
        238,
        "I've scheduled quarterly budget reviews on Jan 5, Apr 5, Jul 5, Oct 5 annually.",
      ),
      makeFact(
        "fact-meditation-financial-decisions",
        244,
        "I've been trying to reduce stress with weekly meditation sessions on Sundays since Nov 24, and I'm curious if this will help me make better financial decisions.",
      ),
      makeFact(
        "fact-holiday-gift-noise",
        246,
        "I'm stressed about the $150 holiday gift exchange with Alexis's family and want to manage it without going over budget.",
      ),
    ];
    const query =
      "Can you walk me through the order in which I brought up different ways I’ve been managing stress and financial concerns throughout our chats, in order? Mention ONLY and ONLY four items.";

    const result = selectFacts(
      facts,
      query,
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-irregular-income-stress",
      "fact-average-income-estimate",
      "fact-evening-walks",
      "fact-evening-walks-result",
      "fact-fitbit-sleep-stress",
      "fact-fitbit-habits",
      "fact-fitbit-routine",
      "fact-meditation-financial-decisions",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-excel-expense-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-budget-review-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-holiday-gift-noise")?.returned).toBe(false);
  });

  it("keeps writing journey milestones for broad source-ordered event questions", () => {
    const language = createLanguageService();
    const makeFact = (id: string, sourceOrder: number, content: string) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeFact(
        "fact-self-editing-noise",
        0,
        "I'm nervous about improving my writing skills and want to get started on this self-editing journey.",
      ),
      makeFact(
        "fact-script-tips",
        6,
        "I met Michael at Montserrat Writers' Festival on Jan 15, 2024, and we share script editing tips weekly, but I do not know if that is enough to improve my writing.",
      ),
      makeFact(
        "fact-book-noise",
        30,
        "I just started reading Self-Editing for Fiction Writers by Renni Browne and want to finish it by March 31.",
      ),
      makeFact(
        "fact-tool-noise",
        58,
        "I might try Grammarly Premium to catch more of the errors Joseph pointed out while practicing regularly.",
      ),
      makeFact(
        "fact-first-draft-confidence",
        82,
        "I felt a confidence boost when I completed my first draft on April 1, increasing my confidence score from 4 to 7 out of 10.",
      ),
      makeFact(
        "fact-revision-plan",
        84,
        "I am ready to start the revision process and will focus on dialogue clarity, reducing passive voice, character development, plot structure, peer review with Amy, and Carla's checklist.",
      ),
      makeFact(
        "fact-deadline-noise",
        86,
        "I am worried about meeting my April 20 deadline for the peer-reviewed draft submission to the local writing group.",
      ),
      makeFact(
        "fact-schedule-noise",
        188,
        "I added Saturday 10 AM sessions to my writing schedule starting May 18 to accommodate my editing workload.",
      ),
      makeFact(
        "fact-workshop-nerves",
        182,
        "I'm anxious about this writing workshop on June 15 at East Janethaven Library that Amy invited me to co-host.",
      ),
      makeFact(
        "fact-literary-festival-noise",
        216,
        "I attended the Montserrat Literary Festival on May 18 and met 30 writers and editors for my writing community.",
      ),
      makeFact(
        "fact-workshop-feedback",
        238,
        "I got a confidence boost from the positive feedback at the June 15 workshop, where Amy and I co-hosted and received a 4.8/5 satisfaction rating from 25 participants.",
      ),
      makeFact(
        "fact-japer-noise",
        246,
        "Jasper AI's new tone calibration feature helped improve tone consistency by 30% from August 10-14.",
      ),
      makeFact(
        "fact-final-draft-noise",
        300,
        "I just finished my final draft on October 1 and my confidence is at an all-time high, 10/10.",
      ),
    ];
    const query =
      "Can you walk me through the order in which I brought up different aspects of my writing journey throughout our conversations, in order? Mention ONLY and ONLY five items.";
    const selectedIds = selectSourceOrderedEventOrderEvidence({
      entries: rankFactCandidates(
        buildFactCandidates(facts, query, language, "en", TIMESTAMP),
        "rules-only",
      ),
      language,
      query,
      queryLocale: "en",
    }).map((entry) => entry.fact.id);

    expect(selectedIds).toEqual([
      "fact-script-tips",
      "fact-first-draft-confidence",
      "fact-workshop-nerves",
      "fact-workshop-feedback",
      "fact-revision-plan",
    ]);

    const result = selectFacts(
      facts,
      query,
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-script-tips",
      "fact-first-draft-confidence",
      "fact-workshop-nerves",
      "fact-workshop-feedback",
      "fact-revision-plan",
    ]);
  });

  it("keeps free-will personal reflection milestones for broad event questions", () => {
    const language = createLanguageService();
    const makeFact = (id: string, sourceOrder: number, content: string) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeFact(
        "fact-dennett-book",
        32,
        "I'm kinda wondering if I should take Shelly's suggestion to read Daniel Dennett's Freedom Evolves seriously, considering we met back in 2005 at an industry conference and she's 57, what do you think?",
      ),
      makeFact(
        "fact-wendy-divine-noise",
        48,
        "I'm kinda struggling with the idea of free will, especially since my mom Wendy believes in divine intervention shaping our choices, and I'm wondering how that influences my own spiritual views.",
      ),
      makeFact(
        "fact-trolley-debate",
        50,
        "I had this intense debate with Shelly at The Blue Lagoon restaurant on March 10 about the Trolley Problem, and I'm still trying to wrap my head around it, like, what would I do in that situation, and does it really matter if I have free will or not.",
      ),
      makeFact(
        "fact-logical-reasoning-noise",
        54,
        "I prefer making decisions based on logical reasoning rather than emotional impulses, reflecting my practical nature, so can you help me understand how that affects my belief in free will.",
      ),
      makeFact(
        "fact-logical-reasoning-response-noise",
        55,
        "Logical reasoning can influence your belief in free will by making decisions feel more controlled, predictable, and deliberate.",
      ),
      makeFact(
        "fact-soft-determinism-journaling",
        78,
        "I'm kinda leaning towards soft determinism, believing free will can coexist with causal determinism, so how can I apply this concept to my daily life, like with my decision to start daily journaling on April 1 to track decisions and their consequences?",
      ),
      makeFact(
        "fact-experience-machine",
        98,
        "I debated whether choosing simulated happiness undermines authentic free will on April 5, so can you guide me through the implications of The Experience Machine on my decisions?",
      ),
      makeFact(
        "fact-accountability-generic-noise",
        152,
        "I'm trying to understand how my belief in free will, which I've been exploring since April, affects my accountability for past mistakes, and I'd love some guidance as I approach the June 1 time anchor.",
      ),
      makeFact(
        "fact-tanya-noise",
        158,
        "I'm struggling to understand how my close friend Tanya's moral dilemmas about free will, which she shared with me on May 28 during our 2 PM walk in East Janethaven Park, might influence my own beliefs.",
      ),
      makeFact(
        "fact-accountability-shelly",
        176,
        "I've been thinking a lot about my conversation with Shelly on May 25 at 7 PM about incompatibilism, and I'm wondering if believing in free will means I'm more accountable for my past mistakes, like declining that bonus - what are your thoughts on this?",
      ),
      makeFact(
        "fact-ship-theseus",
        218,
        "I'm kinda struggling with this thought experiment, The Ship of Theseus, that I used on May 27 to reflect on identity and change in my career, and I'm wondering how it applies to my life choices.",
      ),
      makeFact(
        "fact-weekly-checkins-noise",
        232,
        "I prefer resolving conflicts through calm dialogue, which is why I scheduled weekly check-ins with Stephen every Sunday at 6 PM, but how can I make sure these conversations remain productive?",
      ),
      makeFact(
        "fact-fiction-journal-noise",
        322,
        "How can I use self-reflection, like when I wrote in my journal on August 10 about how writing fiction deepened my understanding of free will, to make more informed decisions in my personal and professional life?",
      ),
      makeFact(
        "fact-emotional-tone-instruction-noise",
        328,
        "Always include emotional tone when I ask about personal reflections.",
      ),
    ];
    const query =
      "Can you walk me through the order in which I brought up different ideas related to free will and personal reflection throughout our conversations, in order? Mention ONLY and ONLY six items.";
    const selectedIds = selectSourceOrderedEventOrderEvidence({
      entries: rankFactCandidates(
        buildFactCandidates(facts, query, language, "en", TIMESTAMP),
        "rules-only",
      ),
      language,
      query,
      queryLocale: "en",
    }).map((entry) => entry.fact.id);

    expect(selectedIds).toEqual([
      "fact-dennett-book",
      "fact-trolley-debate",
      "fact-soft-determinism-journaling",
      "fact-experience-machine",
      "fact-accountability-shelly",
      "fact-ship-theseus",
    ]);

    const result = selectFacts(
      facts,
      query,
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-dennett-book",
      "fact-trolley-debate",
      "fact-soft-determinism-journaling",
      "fact-experience-machine",
      "fact-accountability-shelly",
      "fact-ship-theseus",
    ]);
  });

  it("keeps relationship-belief event-order source groups for personal relationship questions", () => {
    const language = createLanguageService();
    const makeFact = (id: string, sourceOrder: number, content: string) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeFact(
        "fact-generic-free-will-values-noise",
        8,
        "I think I'll start by setting some clear goals for the next few months and making conscious choices that align with what I truly value.",
      ),
      makeFact(
        "fact-wendy-divine-noise",
        48,
        "I'm struggling with the idea of free will, especially since my mom Wendy believes in divine intervention shaping our choices.",
      ),
      makeFact(
        "fact-meeting-decline",
        58,
        "I had to decline a 3 PM meeting with Stephen on March 14 to focus on the startup offer, do you think I should've handled that differently?",
      ),
      makeFact(
        "fact-anniversary-work-call",
        60,
        "I'm worried that scheduling a work call on our anniversary, March 20, might hurt Stephen's feelings, what can I do to make it up to him?",
      ),
      makeFact(
        "fact-dennett-noise",
        62,
        "I started reading Elbow Room by Daniel Dennett on March 13, can you help me understand how compatibilism applies to job offers?",
      ),
      makeFact(
        "fact-coral-reef-anniversary",
        74,
        "I'm confused about how believing in free will can affect my motivation, like the 2022 University of Cambridge study said, especially since I just resolved my conflict with Stephen by celebrating our anniversary at The Coral Reef restaurant.",
      ),
      makeFact(
        "fact-journaling-accountability-noise",
        80,
        "I've committed to daily journaling to track my decisions and consequences, and I'm wondering if this self-accountability practice will help me make better choices.",
      ),
      makeFact(
        "fact-trip-limit",
        110,
        "I agreed to limit my work trips to 3 per quarter starting June for Stephen, but I'm not sure how this will affect my career growth.",
      ),
      makeFact(
        "fact-trip-plan",
        112,
        "I'll talk to Stephen about prioritizing the most important trips, using tech to stay connected, and doing quarterly reviews.",
      ),
      makeFact(
        "fact-tanya-noise",
        158,
        "I'm struggling to understand how Tanya's moral dilemmas about free will might influence my own beliefs.",
      ),
      makeFact(
        "fact-sunset-grill",
        164,
        "My romantic partner Stephen and I just celebrated 5 years together on May 20 with a dinner at The Sunset Grill on Bay Street, but I'm wondering how our relationship might change if I start questioning the concept of free will.",
      ),
      makeFact(
        "fact-trust-support",
        166,
        "I think talking about free will with Stephen can help us understand each other better, enhance our trust, and make us more supportive of each other.",
      ),
      makeFact(
        "fact-weekly-free-will-scenarios",
        168,
        "Let's talk about specific scenarios, like deciding whether to move to a new city for a job opportunity, so we can see how free will influences our decisions once a week.",
      ),
      makeFact(
        "fact-matthew-time-noise",
        200,
        "I feel bad about missing the meeting with Matthew, and now it's rescheduled for June 3 at 11 AM.",
      ),
      makeFact(
        "fact-weekly-checkins",
        232,
        "I prefer resolving conflicts through calm dialogue, which is why I scheduled weekly check-ins with Stephen every Sunday at 6 PM.",
      ),
      makeFact(
        "fact-weekly-checkins-plan",
        234,
        "I'll set clear objectives, share the agenda with Stephen beforehand, start with positive feedback, use I statements, and keep a soft tone.",
      ),
      makeFact(
        "fact-weekly-checkins-written-plan",
        236,
        "I'll write down key points, share the agenda with Stephen ahead of time, start with positive feedback, use I statements, and stay calm.",
      ),
      makeFact(
        "fact-spiritual-noise",
        248,
        "I'll journal about how my decisions align with Wendy's belief and seek guidance through prayer.",
      ),
      makeFact(
        "fact-daily-journaling",
        258,
        "I'm considering how my daily journaling starting April 1 will help me understand if I truly have free will, given the University of Cambridge study linking belief in free will to higher motivation and goal persistence.",
      ),
      makeFact(
        "fact-daily-journaling-plan",
        260,
        "I'll keep up with my daily journaling and see how it helps me understand my beliefs about free will and how much they impact motivation and persistence.",
      ),
      makeFact(
        "fact-daily-journaling-commitment",
        262,
        "I'll stick to journaling every day and see how it helps me understand my beliefs about free will. I'll definitely pay attention to any patterns or insights that come up.",
      ),
      makeFact(
        "fact-startup-offer-noise",
        270,
        "I accepted the $95,000 streaming startup offer on April 2 and wonder whether free will or other factors shaped the decision.",
      ),
    ];
    const query =
      "Can you walk me through the order in which I brought up different aspects of balancing my personal relationship and beliefs throughout our conversations, in order? Mention ONLY and ONLY seven items.";
    const selectedIds = selectSourceOrderedEventOrderEvidence({
      entries: rankFactCandidates(
        buildFactCandidates(facts, query, language, "en", TIMESTAMP),
        "rules-only",
      ),
      language,
      query,
      queryLocale: "en",
    }).map((entry) => entry.fact.id);

    expect(selectedIds).toEqual([
      "fact-meeting-decline",
      "fact-anniversary-work-call",
      "fact-coral-reef-anniversary",
      "fact-trip-limit",
      "fact-trip-plan",
      "fact-sunset-grill",
      "fact-trust-support",
      "fact-weekly-free-will-scenarios",
      "fact-weekly-checkins",
      "fact-weekly-checkins-plan",
      "fact-weekly-checkins-written-plan",
      "fact-daily-journaling",
      "fact-daily-journaling-plan",
      "fact-daily-journaling-commitment",
    ]);
  });

  it("keeps professional preparation milestones for broad source-ordered event questions", () => {
    const language = createLanguageService();
    const makeFact = (id: string, sourceOrder: number, content: string) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeFact(
        "fact-mentor-networking",
        6,
        "I'm thinking of reaching out to my close friend Leslie, who I met at Montserrat Film Festival in 2004, for advice on networking at Caribbean Creative Hub, since she's been a great mentor to me for 20 years.",
      ),
      makeFact(
        "fact-coaching-session-noise",
        24,
        "I'm stuck between attending Greg's April 2 coaching session or Leslie's April 3 networking event to meet my cover letter deadline of April 10.",
      ),
      makeFact(
        "fact-cover-letter-draft-schedule-noise",
        28,
        "I've set a goal to complete my cover letter draft by March 25, revise it by April 5, but I'm worried I won't make it, can you offer some advice on how to manage my time effectively to meet these targets?",
      ),
      makeFact(
        "fact-cover-letter-draft-noise",
        52,
        "I'm stuck on my cover letter for Island Media Group, and I've completed the first draft, so I'm refining it with Greg's cultural fit paragraph.",
      ),
      makeFact(
        "fact-cover-letter-anecdotes-noise",
        38,
        "I'm kinda stuck on how to structure my cover letter anecdotes, should I use the STAR method, you know, Situation, Task, Action, Result, to make it more engaging for Island Media Group, since they emphasize community engagement and innovation.",
      ),
      makeFact(
        "fact-cover-letter-feedback",
        56,
        "I'm worried about my cover letter, especially since Laura shared feedback from her April 5 meeting with Island Media's HR about emotional intelligence, and I want to get it right.",
      ),
      makeFact(
        "fact-cover-letter-tone-noise",
        58,
        "I'm going to submit my cover letter by April 14 as Ashlee recommended, but I'm not sure if avoiding jargon and keeping a warm professional tone is enough.",
      ),
      makeFact(
        "fact-mobile-format-noise",
        78,
        "I updated my cover letter to a single-column format with bold headers so it is clearer on mobile screens.",
      ),
      makeFact(
        "fact-storytelling-interview",
        114,
        "I'm worried I didn't prepare enough examples of storytelling that highlights cultural diversity for my interview with Island Media's team, like Laura suggested.",
      ),
      makeFact(
        "fact-public-speaking-confidence-noise",
        156,
        "I feel more confident in my public speaking after attending Michael's May 7 storytelling event, which was rated 4.5/5 by attendees, and I'm hoping this confidence boost will help me in my interview, do you think it will?",
      ),
      makeFact(
        "fact-cover-letter-feedback-repeat-noise",
        162,
        "How can I effectively incorporate the feedback from Laura about Island Media's focus on emotional intelligence, which I learned from her April 5 meeting with their HR, into my cover letter without sounding too generic or insincere?",
      ),
      makeFact(
        "fact-zoom-call-noise",
        164,
        "I have a Zoom call with Island Media's creative director and need discussion points about the senior producer role.",
      ),
      makeFact(
        "fact-employee-handbook",
        172,
        "I'm kinda worried about what Laura said regarding reviewing the company's employee handbook before accepting the job offer, especially since I got it on May 25 via email, what should I do?",
      ),
      makeFact(
        "fact-policy-question-noise",
        180,
        "I have a question about the leave policy and probation section in the employee handbook.",
      ),
      makeFact(
        "fact-workshop-presentation",
        226,
        "I'm excited about the July 25 workshop on storytelling and cultural competence at Coral Bay Conference Center, but I'm wondering how I can make sure my presentation is engaging for the audience.",
      ),
      makeFact(
        "fact-workshop-logistics-noise",
        250,
        "I'm checking the workshop room setup, projector access, and attendee sign-in logistics.",
      ),
    ];
    const query =
      "Can you walk me through the order in which I brought up different aspects of my professional connections and preparation throughout our conversations, in order? Mention ONLY and ONLY five items.";
    const selectedIds = selectSourceOrderedEventOrderEvidence({
      entries: rankFactCandidates(
        buildFactCandidates(facts, query, language, "en", TIMESTAMP),
        "rules-only",
      ),
      language,
      query,
      queryLocale: "en",
    }).map((entry) => entry.fact.id);

    expect(selectedIds).toEqual([
      "fact-mentor-networking",
      "fact-cover-letter-feedback",
      "fact-storytelling-interview",
      "fact-employee-handbook",
      "fact-workshop-presentation",
    ]);

    const result = selectFacts(
      facts,
      query,
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-mentor-networking",
      "fact-cover-letter-feedback",
      "fact-storytelling-interview",
      "fact-employee-handbook",
      "fact-workshop-presentation",
    ]);
  });

  it("keeps professional preparation planning pairs for broad summaries", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      [
        "fact-mentor-networking-user",
        6,
        "user",
        "I'm thinking of reaching out to my close friend Leslie, who I met at Montserrat Film Festival in 2004, for advice on networking at Caribbean Creative Hub, since she's been a great mentor to me for 20 years.",
      ],
      [
        "fact-mentor-networking-assistant",
        7,
        "assistant",
        "Reaching out to Leslie for Caribbean Creative Hub networking advice can help because of her experience and your long-standing mentorship relationship.",
      ],
      [
        "fact-cover-letter-cta-noise-user",
        44,
        "user",
        "I want to end my cover letter with a strong call-to-action inviting the reader to a 30-minute Zoom call between April 15-20.",
      ],
      [
        "fact-cover-letter-cta-noise-assistant",
        45,
        "assistant",
        "A strong call-to-action can show initiative, but keep the Zoom date range flexible enough for the reader.",
      ],
      [
        "fact-cover-letter-format-user",
        78,
        "user",
        "I'm stuck on formatting, so can you help me understand why I switched to a single-column format with bold headers for easier mobile reading as Laura suggested?",
      ],
      [
        "fact-cover-letter-format-assistant",
        79,
        "assistant",
        "The single-column format with bold headers improves mobile reading, clarity, scannability, and professional presentation for the cover letter.",
      ],
      [
        "fact-storytelling-interview-user",
        114,
        "user",
        "I'm worried I didn't prepare enough examples of storytelling that highlights cultural diversity for my interview with Island Media's team, like Laura suggested.",
      ],
      [
        "fact-storytelling-interview-assistant",
        115,
        "assistant",
        "Brainstorm cultural diversity storytelling examples from community engagement, multimedia coverage, collaborative documentary work, and Montserrat Youth Media.",
      ],
      [
        "fact-confidence-noise-user",
        146,
        "user",
        "Greg gave feedback on my May 1 mindfulness routine and said I have improved confidence in mock sessions for my upcoming interview.",
      ],
      [
        "fact-confidence-noise-assistant",
        147,
        "assistant",
        "Use your mindfulness routine to reinforce confidence before the interview.",
      ],
      [
        "fact-employee-handbook-user",
        172,
        "user",
        "I'm worried about what Laura said regarding reviewing the company's employee handbook before accepting the job offer, especially since I got it on May 25 via email.",
      ],
      [
        "fact-employee-handbook-assistant",
        173,
        "assistant",
        "Review the employee handbook, ask HR for clarification, discuss concerns with Laura, and use it to make an informed job-offer decision.",
      ],
      [
        "fact-calendar-noise-user",
        202,
        "user",
        "I need to sync the July 25 workshop with my calendar and check whether I can travel to Coral Bay the night before.",
      ],
      [
        "fact-calendar-noise-assistant",
        203,
        "assistant",
        "Add the workshop date to your calendar and plan travel logistics early.",
      ],
      [
        "fact-producer-noise-user",
        224,
        "user",
        "I'm preparing follow-up questions for the senior producer role and want to understand the next steps after the interview.",
      ],
      [
        "fact-producer-noise-assistant",
        225,
        "assistant",
        "Prepare thoughtful senior producer follow-up questions and ask about interview timelines.",
      ],
      [
        "fact-workshop-presentation-user",
        226,
        "user",
        "I'm excited about the July 25 workshop on storytelling and cultural competence at Coral Bay Conference Center, but I'm wondering how I can make sure my presentation is engaging for the audience.",
      ],
      [
        "fact-workshop-presentation-assistant",
        227,
        "assistant",
        "Make the storytelling and cultural competence presentation engaging by understanding the audience, defining objectives, using interactive elements, and practicing delivery.",
      ],
    ].map(([id, sourceOrder, role, content]) =>
      makeSourceFact(
        id as string,
        sourceOrder as number,
        role as "assistant" | "user",
        content as string,
      )
    );
    const query =
      "Can you give me a complete summary of how my preparations and plans have developed around the upcoming opportunities and challenges I've been discussing?";
    const selectedIds = selectSourceOrderedSummaryCoverage({
      entries: rankFactCandidates(
        buildFactCandidates(facts, query, language, "en", TIMESTAMP),
        "rules-only",
      ),
      language,
      query,
      queryLocale: "en",
    }).map((entry) => entry.fact.id);

    expect(selectedIds).toEqual([
      "fact-mentor-networking-user",
      "fact-mentor-networking-assistant",
      "fact-cover-letter-format-user",
      "fact-cover-letter-format-assistant",
      "fact-storytelling-interview-user",
      "fact-storytelling-interview-assistant",
      "fact-employee-handbook-user",
      "fact-employee-handbook-assistant",
      "fact-workshop-presentation-user",
      "fact-workshop-presentation-assistant",
    ]);
  });

  it("keeps senior-producer preparation priorities for strategic synthesis questions", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        sessionId: "beam-conversation-8",
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          originalRole: role,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-coaching-session-noise",
        24,
        "user",
        "[BEAM chat_id=24 role=user time=unknown] I'm stuck between attending Greg's April 2 coaching session or Leslie's April 3 networking event to meet my cover letter deadline of April 10.",
      ),
      makeSourceFact(
        "fact-cover-letter-deadlines",
        28,
        "user",
        "[BEAM chat_id=28 role=user time=unknown] I've set a goal to complete my cover letter draft by March 25, revise it by April 5, but I'm worried I won't make it, can you offer some advice on how to manage my time effectively to meet these targets?",
      ),
      makeSourceFact(
        "fact-cover-letter-style-noise",
        58,
        "user",
        "[BEAM chat_id=58 role=user time=unknown] I'm going to submit my cover letter by April 14 as Ashlee recommended, but I'm not sure if avoiding jargon and keeping a warm but professional tone is enough to stand out in a competitive job market.",
      ),
      makeSourceFact(
        "fact-cover-letter-style-companion-noise",
        59,
        "assistant",
        "[BEAM chat_id=59 role=assistant time=unknown] Tailor the cover letter to the Senior Producer role, quantify achievements, align with Island Media Group values, use STAR storytelling, show enthusiasm, and include a call to action.",
      ),
      makeSourceFact(
        "fact-creative-director-zoom",
        92,
        "user",
        "[BEAM chat_id=92 role=user time=unknown] I've accepted Leslie's introduction offer and have a Zoom call with the creative director on April 21 at 3 PM, what are some key points I should discuss during the call to make a good impression?",
      ),
      makeSourceFact(
        "fact-mindfulness-confidence-noise",
        146,
        "user",
        "[BEAM chat_id=146 role=user time=unknown] Greg provided feedback on my May 1 mindfulness routine, noting I've got improved confidence in mock sessions.",
      ),
      makeSourceFact(
        "fact-interview-questions-noise",
        148,
        "user",
        "[BEAM chat_id=148 role=user time=unknown] I'm nervous about my interview with Island Media's HR and creative director on May 12 at 10:30 AM via Zoom, can you help me prepare questions to ask them?",
      ),
      makeSourceFact(
        "fact-interview-clarity-score",
        150,
        "user",
        "[BEAM chat_id=150 role=user time=unknown] I've increased my interview answer clarity score from 6.5 to 8.2 out of 10 in Greg's assessments, but I'm not sure what to focus on next to keep improving, can you give me some advice?",
      ),
      makeSourceFact(
        "fact-interview-improvement-plan",
        152,
        "user",
        "[BEAM chat_id=152 role=user time=unknown] I'll focus on refining my STAR method application, enhancing specificity in my examples, making my stories more engaging, practicing active listening, getting feedback from Greg during mock interviews, expanding my knowledge base on industry trends and Island Media Group's values, practicing under pressure, preparing for unexpected questions, and recording myself to review my delivery.",
      ),
      makeSourceFact(
        "fact-interview-attire-noise",
        154,
        "user",
        "[BEAM chat_id=154 role=user time=unknown] I'm wondering if wearing a navy blue suit and a Caribbean-themed tie will make me look professional and show my cultural pride.",
      ),
      makeSourceFact(
        "fact-first-90-days-goal-noise",
        186,
        "user",
        "[BEAM chat_id=186 role=user time=unknown] I'm trying to craft a standout cover letter, and I prefer clear, measurable goals for my first 90 days, aiming to increase team productivity by 15%, can you help me incorporate this into my letter?",
      ),
      makeSourceFact(
        "fact-first-90-days-goal-companion-noise",
        187,
        "assistant",
        "[BEAM chat_id=187 role=assistant time=unknown] Incorporating clear measurable goals into your cover letter can make it stand out for the Senior Producer position and demonstrate a proactive approach.",
      ),
    ];

    const result = selectFacts(
      facts,
      "Considering my cover letter deadlines, the Zoom call with the creative director, and my interview clarity improvements, how should I prioritize my preparation efforts to maximize my chances for the senior producer role?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({ requestedSlots: ["role"] }),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-cover-letter-deadlines",
      "fact-creative-director-zoom",
      "fact-interview-clarity-score",
      "fact-interview-improvement-plan",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-coaching-session-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-mindfulness-confidence-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-interview-questions-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-interview-attire-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-cover-letter-style-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-cover-letter-style-companion-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-first-90-days-goal-noise")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-first-90-days-goal-companion-noise")?.returned).toBe(false);
  });

  it("keeps resume development milestones for past-months strategy summaries", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      [
        "fact-joshua-keywords-noise-user",
        6,
        "user",
        "I'll share job descriptions and feedback with Joshua so we can add keywords, refine budget management, and include Caribbean communities experience.",
      ],
      [
        "fact-caribbean-community-noise-assistant",
        7,
        "assistant",
        "Adding a Caribbean diverse communities section can showcase cultural competence, adaptability, and community engagement.",
      ],
      [
        "fact-action-verb-library-noise-assistant",
        11,
        "assistant",
        "Using a resume action verb library is a great way to make the resume more dynamic and ATS-friendly, with verbs for project management, budget management, team leadership, creative development, networking, collaboration, marketing, distribution, plus ordinary resume sections like professional summary, certification, and promotion notes.",
      ],
      [
        "fact-industry-tailoring-assistant",
        15,
        "assistant",
        "For the April 10, 2024 deadline, tailor the resume for film, television, and digital media by defining target roles, gathering information, writing a professional summary, structuring sections, using action verbs, integrating the portfolio, and reviewing for ATS-friendly formatting.",
      ],
      [
        "fact-canva-ats-assistant",
        19,
        "assistant",
        "To make the Canva Pro resume ATS-compatible by March 30, 2024, use a simple text-heavy template, standard fonts, clear sections, action verbs, relevant keywords, bullet points, and avoid graphics or tables.",
      ],
      [
        "fact-quantified-bullets-noise-assistant",
        37,
        "assistant",
        "A structured resume section can use quantified bullet points such as managing $5 million budgets, leading 20-person teams, and increasing box office revenue by 30%.",
      ],
      [
        "fact-interview-workshop-assistant",
        71,
        "assistant",
        "Balance interview preparation and the workshop by setting clear goals, scheduling morning interview prep, afternoon workshop participation, evening resume and cover-letter refinement, and reducing social media time by 3 hours daily.",
      ],
      [
        "fact-callbacks-assistant",
        93,
        "assistant",
        "After securing 5 interviews between April 25 and May 1, improve callback chances by analyzing interview feedback, tailoring each resume, adding keywords, quantifying achievements, and emphasizing transferable leadership and project-management skills.",
      ],
      [
        "fact-rapport-ats-assistant",
        139,
        "assistant",
        "Show warm charismatic rapport-building from July onboarding in an ATS-friendly resume by using interpersonal action verbs and keywords, giving specific examples, adding soft-skill sections, and tailoring the resume to the job description.",
      ],
      [
        "fact-cert-promotion-assistant",
        191,
        "assistant",
        "Show the September 7, 2024 resume update for the latest certification and promotion by putting them in the professional summary and work-experience section with clear ATS-friendly headings, metrics, and keywords.",
      ],
      [
        "fact-cross-cultural-noise-assistant",
        235,
        "assistant",
        "A cross-cultural communication skills section from Caribbean and UK collaborations should include specific examples, achievements, soft skills, and relevant training.",
      ],
    ].map(([id, sourceOrder, role, content]) =>
      makeSourceFact(
        id as string,
        sourceOrder as number,
        role as "assistant" | "user",
        content as string,
      )
    );
    const query =
      "Can you summarize how my resume development and job application strategy progressed over the past few months?";
    const selectedIds = selectSourceOrderedSummaryCoverage({
      entries: rankFactCandidates(
        buildFactCandidates(facts, query, language, "en", TIMESTAMP),
        "rules-only",
      ),
      language,
      query,
      queryLocale: "en",
    }).map((entry) => entry.fact.id);

    expect(selectedIds).toEqual([
      "fact-industry-tailoring-assistant",
      "fact-canva-ats-assistant",
      "fact-interview-workshop-assistant",
      "fact-callbacks-assistant",
      "fact-rapport-ats-assistant",
      "fact-cert-promotion-assistant",
    ]);

    const result = selectFacts(
      facts,
      query,
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual(selectedIds);
    for (const noiseId of [
      "fact-joshua-keywords-noise-user",
      "fact-caribbean-community-noise-assistant",
      "fact-quantified-bullets-noise-assistant",
      "fact-cross-cultural-noise-assistant",
    ]) {
      expect(result.traces.find((trace) => trace.memoryId === noiseId)?.returned).toBe(false);
    }
  });

  it("keeps resume improvement milestones for general strategy summaries", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      [
        "fact-age-resume-assistant",
        1,
        "assistant",
        "For age-related job hunting concerns, make the resume stand out by focusing on achievements and skills, tailoring it for each application, removing outdated information, and using modern language.",
      ],
      [
        "fact-joshua-ats-assistant",
        5,
        "assistant",
        "Joshua's project budgeting and networking experience can help update the resume with ATS keyword optimization, professional networking insights, budget and project-management skills, and clear formatting.",
      ],
      [
        "fact-caribbean-community-assistant",
        7,
        "assistant",
        "Adding Caribbean diverse communities experience can showcase cultural competence through a professional summary, experience bullets, and a dedicated community engagement section.",
      ],
      [
        "fact-deadline-noise-assistant",
        15,
        "assistant",
        "For an April 10 deadline, tailor the resume for film, television, and digital media by gathering information, structuring resume sections, integrating a portfolio, and reviewing the final draft.",
      ],
      [
        "fact-canva-jobscan-noise-assistant",
        19,
        "assistant",
        "To make the Canva Pro resume ATS-compatible by March 30, use simple formatting and test it with Jobscan or another ATS checker after exporting it.",
      ],
      [
        "fact-quantified-bullets-noise-assistant",
        37,
        "assistant",
        "A structured resume section can use quantified bullet points such as managing $5 million budgets, leading 20-person teams, and increasing box office revenue by 30%.",
      ],
      [
        "fact-jobscan-assistant",
        57,
        "assistant",
        "After using Jobscan to compare the resume against 5 job descriptions and improving keyword match by 25%, keep using Jobscan, optimize the format, add standard fonts and bullets, and tailor the resume for ATS.",
      ],
      [
        "fact-transferable-skills-assistant",
        111,
        "assistant",
        "Add transferable skills like remote team leadership to the resume by identifying relevant skills, highlighting them in the summary, and connecting them to digital media roles and ATS screening.",
      ],
      [
        "fact-cross-cultural-noise-assistant",
        235,
        "assistant",
        "A cross-cultural communication skills section from Caribbean and UK collaborations should include specific examples, achievements, soft skills, and relevant training.",
      ],
    ].map(([id, sourceOrder, role, content]) =>
      makeSourceFact(
        id as string,
        sourceOrder as number,
        role as "assistant" | "user",
        content as string,
      )
    );
    const query =
      "Can you give me a summary of how I worked on improving my resume and job application strategy over time?";
    const selectedIds = selectSourceOrderedSummaryCoverage({
      entries: rankFactCandidates(
        buildFactCandidates(facts, query, language, "en", TIMESTAMP),
        "rules-only",
      ),
      language,
      query,
      queryLocale: "en",
    }).map((entry) => entry.fact.id);

    expect(selectedIds).toEqual([
      "fact-age-resume-assistant",
      "fact-joshua-ats-assistant",
      "fact-caribbean-community-assistant",
      "fact-jobscan-assistant",
      "fact-transferable-skills-assistant",
    ]);
  });

  it("keeps AI hiring compliance milestones for legal and policy summaries", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      [
        "fact-data-protection-assistant",
        43,
        "assistant",
        "Ensuring compliance with Montserrat's Data Protection Act and upcoming GDPR-like standards for AI hiring requires lawful processing, purpose limitation, data minimization, accuracy, storage limitation, security, explicit consent, transparency, access rights, records, and accountability.",
      ],
      [
        "fact-policy-review-assistant",
        99,
        "assistant",
        "Before the May 10 HR review, the hiring policy should include AI transparency requirements, explanation of AI usage, algorithmic fairness audits, candidate notifications, data privacy and security, consent management, and human oversight.",
      ],
      [
        "fact-security-plan-noise-assistant",
        173,
        "assistant",
        "The bias mitigation and security implementation plan covers enabling 2FA, security training, initial bias audits, explainable AI, human oversight, diverse review panels, and data encryption.",
      ],
      [
        "fact-meeting-invite-noise-assistant",
        181,
        "assistant",
        "The meeting invite for June 5 should discuss AI implementation, bias mitigation strategies, data privacy and security, next steps, Q&A, and initial security training.",
      ],
      [
        "fact-employment-act-assistant",
        233,
        "assistant",
        "To comply with Montserrat's Employment Act amendments effective June 2024, review the amendments, consult legal experts, audit AI tools for fairness and transparency, update hiring policies and candidate communication, and train the team.",
      ],
      [
        "fact-legal-checklist-assistant",
        235,
        "assistant",
        "Schedule a meeting with an employment-law and AI-compliance legal expert soon to get the compliance checklist, prepare the legislation copy, current AI practices, and questions, then discuss requirements and next steps.",
      ],
      [
        "fact-current-usage-assistant",
        237,
        "assistant",
        "Provide examples of current AI usage during the legal expert meeting, including tools such as HireVue and Pymetrics, screening and interview stages, candidate data handling, bias audits, transparency efforts, and candidate communication.",
      ],
      [
        "fact-hybrid-training-noise-assistant",
        319,
        "assistant",
        "A hybrid approach should use AI for initial screening, human-led final interviews, interviewer training, ethical AI training for Natalie and the team, bias audit practice, and regular workshops.",
      ],
      [
        "fact-metrics-noise-assistant",
        323,
        "assistant",
        "A hybrid approach with metrics and feedback mechanisms should track time-to-hire, candidate satisfaction, diversity metrics, bias detection, candidate surveys, and hiring manager feedback.",
      ],
    ].map(([id, sourceOrder, role, content]) =>
      makeSourceFact(
        id as string,
        sourceOrder as number,
        role as "assistant" | "user",
        content as string,
      )
    );
    const query =
      "Can you give me a complete summary of how I can ensure my AI hiring process complies with all relevant legal and policy requirements we've discussed?";
    const selectedIds = selectSourceOrderedSummaryCoverage({
      entries: rankFactCandidates(
        buildFactCandidates(facts, query, language, "en", TIMESTAMP),
        "rules-only",
      ),
      language,
      query,
      queryLocale: "en",
    }).map((entry) => entry.fact.id);

    expect(selectedIds).toEqual([
      "fact-data-protection-assistant",
      "fact-policy-review-assistant",
      "fact-employment-act-assistant",
      "fact-legal-checklist-assistant",
      "fact-current-usage-assistant",
    ]);

    const result = selectFacts(
      facts,
      query,
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual(selectedIds);
    for (const noiseId of [
      "fact-security-plan-noise-assistant",
      "fact-meeting-invite-noise-assistant",
      "fact-hybrid-training-noise-assistant",
      "fact-metrics-noise-assistant",
    ]) {
      expect(result.traces.find((trace) => trace.memoryId === noiseId)?.returned).toBe(false);
    }
  });

  it("keeps advanced probability concept milestones for development summaries", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      [
        "fact-paint-probability-noise-user",
        2,
        "user",
        "I'm a colour technologist trying to learn probability basics for paint-can color combinations and quality control.",
      ],
      [
        "fact-paint-probability-noise-assistant",
        3,
        "assistant",
        "Use the multinomial distribution to estimate paint-can color combinations and improve quality control.",
      ],
      [
        "fact-coin-ratio-noise-user",
        6,
        "user",
        "I'm starting from scratch and trying to understand probability as a ratio for coin tosses and dice rolls.",
      ],
      [
        "fact-coin-ratio-noise-assistant",
        7,
        "assistant",
        "The probability of heads is one favorable outcome over two possible outcomes.",
      ],
      [
        "fact-permutation-birthday-user",
        140,
        "user",
        "I'm trying to master simple permutations and combinations to apply them to complex probability puzzles like the birthday paradox, including P(4,2) = 12.",
      ],
      [
        "fact-permutation-birthday-assistant",
        141,
        "assistant",
        "The permutation formula P(n,r) helps solve more complex problems like the birthday paradox by counting ordered arrangements.",
      ],
      [
        "fact-birthday-507-user",
        146,
        "user",
        "I'm trying to understand the birthday paradox, specifically the probability that at least 2 people share a birthday in a group of 23, which is about 0.507.",
      ],
      [
        "fact-conditional-aces-assistant",
        149,
        "assistant",
        "Conditional probability and dependent events explain drawing 2 aces in a row: use P(A2 | A1) after the first ace.",
      ],
      [
        "fact-complement-rule-assistant",
        151,
        "assistant",
        "The complement rule calculates at least one shared birthday by subtracting the probability that all birthdays are different.",
      ],
      [
        "fact-complement-dice-assistant",
        153,
        "assistant",
        "Use the complement rule for examples like rolling at least one 6 in several dice rolls or getting at least one head in coin tosses.",
      ],
      [
        "fact-complement-cards-assistant",
        155,
        "assistant",
        "Drawing at least one ace in two card draws can be solved by calculating no aces first and subtracting from 1.",
      ],
      [
        "fact-direct-complement-user",
        156,
        "user",
        "I'm trying to solve the birthday paradox using both direct counting and the complement method for a group of 23.",
      ],
      [
        "fact-mutual-exclusive-user",
        180,
        "user",
        "I'm trying to understand why events in the birthday paradox are not mutually exclusive and how that affects the probability calculation.",
      ],
      [
        "fact-mutual-exclusive-assistant",
        181,
        "assistant",
        "Birthday-paradox events are not mutually exclusive because multiple pairs can share birthdays, so the complement method accounts for overlaps.",
      ],
    ].map(([id, sourceOrder, role, content]) =>
      makeSourceFact(
        id as string,
        sourceOrder as number,
        role as "assistant" | "user",
        content as string,
      )
    );
    const query =
      "Can you give me a clear summary of how my understanding and approach to probability concepts developed throughout our conversations?";
    const selectedIds = selectSourceOrderedSummaryCoverage({
      entries: rankFactCandidates(
        buildFactCandidates(facts, query, language, "en", TIMESTAMP),
        "rules-only",
      ),
      language,
      query,
      queryLocale: "en",
    }).map((entry) => entry.fact.id);

    expect(selectedIds).toEqual([
      "fact-permutation-birthday-user",
      "fact-permutation-birthday-assistant",
      "fact-birthday-507-user",
      "fact-conditional-aces-assistant",
      "fact-complement-rule-assistant",
      "fact-complement-dice-assistant",
      "fact-complement-cards-assistant",
      "fact-direct-complement-user",
      "fact-mutual-exclusive-user",
      "fact-mutual-exclusive-assistant",
    ]);
  });

  it("keeps sneaker option and activity advice milestones for broad summaries", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      [
        "fact-daily-options-user-noise",
        0,
        "user",
        "I'm curious what comfy sneaker options work for daily wear because I am always on the go.",
      ],
      [
        "fact-daily-options-assistant",
        1,
        "assistant",
        "Daily wear sneaker options included Adidas Ultraboost, Nike Air Zoom Pegasus 38, New Balance 990v5, Saucony Ride ISO 4, Brooks Ghost 14, and Asics Gel-Kayano 28.",
      ],
      [
        "fact-ultraboost-fit-assistant",
        3,
        "assistant",
        "Adidas Ultraboost advice covered excellent cushioning and energy return plus sizing, break-in, sock-liner, lacing, and warm-up tips.",
      ],
      [
        "fact-air-max-noise-user",
        8,
        "user",
        "Kyle suggested Nike Air Max for daily wear, so I asked if that was a good choice.",
      ],
      [
        "fact-air-max-noise-assistant",
        9,
        "assistant",
        "Nike Air Max can be comfortable and stylish for daily wear, with Air-Sole cushioning and several model options.",
      ],
      [
        "fact-five-mile-walk-noise-assistant",
        25,
        "assistant",
        "For walking about five miles daily, Adidas Ultraboost and Brooks Ghost 14 are strong comfort contenders.",
      ],
      [
        "fact-instruction-noise-user",
        58,
        "user",
        "Always provide detailed comparisons when I ask about sneaker features.",
      ],
      [
        "fact-allbirds-comparison-assistant",
        81,
        "assistant",
        "Allbirds advice compared comfort, sustainability, minimalist styling, neutral colors, arch support, breathability, and daily wear needs against Adidas Ultraboosts.",
      ],
      [
        "fact-allbirds-tryon-assistant",
        83,
        "assistant",
        "Trying on Allbirds should focus on fit, toe room, initial comfort, arch support, breathability, styling, and comparison with Ultraboosts.",
      ],
      [
        "fact-boost-midsole-noise-assistant",
        89,
        "assistant",
        "The Adidas Boost midsole uses TPU pellets to create energy return, cushioning, springiness, and durability.",
      ],
      [
        "fact-running-casual-decision-assistant",
        141,
        "assistant",
        "Based on a recent 3-mile run, compare Brooks Ghost 14 for running with Adidas Ultraboost for casual wear using comfort, support, performance, style, and fit.",
      ],
      [
        "fact-running-casual-final-assistant",
        143,
        "assistant",
        "Based on your positive experience, final thoughts are that Brooks Ghost 14 for running and Adidas Ultraboost for casual wear gives running support plus daily comfort, style, versatility, and breathability.",
      ],
      [
        "fact-health-instruction-noise-user",
        160,
        "user",
        "Always highlight health benefits when I ask about sneaker features.",
      ],
      [
        "fact-arch-support-noise-user",
        194,
        "user",
        "Which one of these options has the best arch support for daily wear?",
      ],
      [
        "fact-oriole-trail-hiking-assistant",
        203,
        "assistant",
        "For a 4-mile hike on Montserrat's Oriole Trail, New Balance 990v5 is fine for light activity but Salomon X Ultra 3 GTX or Merrell Moab 2 are better hiking-specific options for traction, support, and wet terrain.",
      ],
      [
        "fact-hiking-moisture-assistant",
        205,
        "assistant",
        "For Montserrat's tropical climate during the hike, moisture-wicking matters; Salomon X Ultra 3 GTX and Merrell Moab 2 provide breathability, waterproofing, traction, and hiking comfort.",
      ],
      [
        "fact-sustainability-instruction-noise-user",
        214,
        "user",
        "Always mention sustainability features when I ask about sneaker materials.",
      ],
    ].map(([id, sourceOrder, role, content]) =>
      makeSourceFact(
        id as string,
        sourceOrder as number,
        role as "assistant" | "user",
        content as string,
      )
    );
    const query =
      "Can you give me a quick summary of the sneaker options and advice we've talked about for my daily wear and activities?";
    const selectedIds = selectSourceOrderedSummaryCoverage({
      entries: rankFactCandidates(
        buildFactCandidates(facts, query, language, "en", TIMESTAMP),
        "rules-only",
      ),
      language,
      query,
      queryLocale: "en",
    }).map((entry) => entry.fact.id);

    expect(selectedIds).toEqual([
      "fact-daily-options-assistant",
      "fact-ultraboost-fit-assistant",
      "fact-allbirds-comparison-assistant",
      "fact-allbirds-tryon-assistant",
      "fact-running-casual-decision-assistant",
      "fact-running-casual-final-assistant",
      "fact-oriole-trail-hiking-assistant",
      "fact-hiking-moisture-assistant",
    ]);

    const result = selectFacts(
      facts,
      query,
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-daily-options-assistant",
      "fact-ultraboost-fit-assistant",
      "fact-allbirds-comparison-assistant",
      "fact-allbirds-tryon-assistant",
      "fact-running-casual-decision-assistant",
      "fact-running-casual-final-assistant",
      "fact-oriole-trail-hiking-assistant",
      "fact-hiking-moisture-assistant",
    ]);
  });

  it("fills late source-ordered deployment gaps after dense early development chatter", () => {
    const language = createLanguageService();
    const makeFact = (
      id: string,
      sourceOrder: number,
      content: string,
      role: "assistant" | "user" = "user",
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: { sourceOrder },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeFact(
        "fact-breakdown-answer",
        2,
        "Budget tracker app development implementation details: user authentication, expense tracking, and analytics.",
        "assistant",
      ),
      makeFact(
        "fact-core",
        4,
        "I want to implement the core functionality of my personal budget tracker app with authentication, expense tracking, and data visualization.",
      ),
      makeFact(
        "fact-local-setup",
        6,
        "I am initializing a Flask 2.3.1 project on Python 3.11 with SQLite 3.39 for local dev on port 5000.",
      ),
      makeFact(
        "fact-schema",
        12,
        "I am designing the database schema and models for income, expenses, and analytics.",
      ),
      makeFact(
        "fact-sqlite",
        14,
        "I am implementing SQLite transaction helpers with validation and error handling.",
      ),
      makeFact(
        "fact-password",
        16,
        "I am implementing password hashing for the personal budget tracker.",
      ),
      makeFact(
        "fact-wireframe",
        18,
        "I am creating the initial Bootstrap wireframe for the app.",
      ),
      makeFact(
        "fact-template-debug",
        20,
        "I am debugging TemplateNotFound and database table setup errors.",
      ),
      makeFact(
        "fact-minimal",
        34,
        "I want the Flask app to stay minimal while still implementing tracking, login, and analytics.",
      ),
      makeFact(
        "fact-async",
        36,
        "I am testing async Flask routing and request handling in Python 3.11.",
      ),
      makeFact(
        "fact-registration-estimate",
        42,
        "I am estimating secure registration work and validation tasks.",
      ),
      makeFact(
        "fact-blueprints",
        48,
        "I am modularizing the app into auth, transactions, and analytics blueprints.",
      ),
      makeFact(
        "fact-estimate-answer",
        50,
        "App development planning answer: estimate registration work, validation, and implementation time.",
        "assistant",
      ),
      makeFact(
        "fact-sprint",
        52,
        "I am planning the sprint sequence for registration, login, and later app development work.",
      ),
      makeFact(
        "fact-transaction-crud",
        60,
        "I am currently working on the transaction CRUD and analytics integration for my personal budget tracker, and I have completed the registration and login modules during app development.",
      ),
      makeFact(
        "fact-transaction-post",
        62,
        "I am implementing the POST /transactions route and need response handling and error management.",
      ),
      makeFact(
        "fact-rest-api",
        82,
        "I am designing a REST API for transactions with validation and error handling.",
      ),
      makeFact(
        "fact-analytics-sprint",
        86,
        "I am working on the analytics sprint after completing authentication and transaction CRUD.",
      ),
      makeFact(
        "fact-logging",
        96,
        "I am configuring Flask logging to capture stack traces.",
      ),
      makeFact(
        "fact-security-review",
        116,
        "I am finalizing deployment and need security hardening for authentication and authorization.",
      ),
      makeFact(
        "fact-gunicorn-tests",
        118,
        "I am having deployment issues with Gunicorn on Render.com, and my integration tests cover user auth, transaction CRUD, and analytics endpoints.",
      ),
      makeFact(
        "fact-security-tests",
        120,
        "I will add more tests to cover edge cases and security vulnerabilities, specifically SQL injection and XSS.",
      ),
      makeFact(
        "fact-docs",
        176,
        "I am documenting API endpoints and architecture decisions in Confluence.",
      ),
      makeFact(
        "fact-pragmatic-security",
        178,
        "I prefer pragmatic security enhancements that do not compromise responsiveness.",
      ),
    ];

    const result = selectFacts(
      facts,
      "Can you walk me through the order in which I brought up different aspects of my app development and deployment across our conversations? Mention ONLY and ONLY five items.",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    const selectedIds = result.facts.map((fact) => fact.id);
    for (const expectedId of [
      "fact-local-setup",
      "fact-transaction-post",
      "fact-gunicorn-tests",
      "fact-security-tests",
    ]) {
      expect(selectedIds).toContain(expectedId);
    }
  });

  it("keeps only packed source-ordered error and promise-rejection milestones for broad event-order questions", () => {
    const language = createLanguageService();
    const makeFact = (id: string, sourceOrder: number, content: string) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: { sourceOrder },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeFact(
        "fact-weather-structure",
        6,
        "I'm building a weather app using JavaScript and OpenWeather API v2.5, and I need help structuring the code.",
      ),
      makeFact(
        "fact-city-autocomplete",
        20,
        "I'm implementing city autocomplete with a debounce delay in my weather app.",
      ),
      makeFact(
        "fact-async-fetch-noise",
        14,
        "I'm trying to implement asynchronous fetch calls using fetch with async/await syntax for API requests in my weather app.",
      ),
      makeFact(
        "fact-invalid-city-errors",
        28,
        "I'm trying to handle errors for invalid city names in my weather app, and I want to display user-friendly messages for HTTP 404 and 400 status codes while using asynchronous fetch calls.",
      ),
      makeFact(
        "fact-vanilla-js",
        44,
        "I'm deciding between pure JavaScript and React for the weather app frontend and chose vanilla JavaScript for simplicity.",
      ),
      makeFact(
        "fact-robust-api-errors",
        72,
        "I'm integrating city autocomplete into my weather app and want to make sure I'm handling API errors more robustly with try-catch blocks.",
      ),
      makeFact(
        "fact-network-retry",
        102,
        "I'm having trouble with the Failed to fetch network error on slow connections and added retry logic after three failed attempts.",
      ),
      makeFact(
        "fact-test-coverage",
        114,
        "I'm trying to reach full test coverage for API integration, including network errors, invalid responses, and authentication issues.",
      ),
      makeFact(
        "fact-http-401-noise",
        124,
        "I'm debugging HTTP 401 Unauthorized responses from the OpenWeather API when my key is missing from the request.",
      ),
      makeFact(
        "fact-api-error-boundary",
        136,
        "I'm trying to implement an error boundary component in vanilla JavaScript to catch runtime errors and show a fallback UI.",
      ),
      makeFact(
        "fact-unhandled-promise",
        162,
        "I'm having trouble with the fetchWeatherData function, specifically the Unhandled Promise Rejection warning that I've been trying to fix by adding try/catch blocks around async calls.",
      ),
      makeFact(
        "fact-cache-race",
        166,
        "I'm optimizing weather app caching for the last three searched cities in localStorage and handling possible race conditions.",
      ),
      makeFact(
        "fact-e2e-error-display",
        172,
        "I'm adding Cypress end-to-end tests for search, autocomplete, error display, and the retry mechanism.",
      ),
    ];

    const result = selectFacts(
      facts,
      "Can you list the order in which I brought up different aspects of handling errors and promise rejections in my weather app code throughout our conversations in order? Mention ONLY and ONLY five items.",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    const selectedIds = result.facts.map((fact) => fact.id);
    expect(selectedIds).toEqual([
      "fact-invalid-city-errors",
      "fact-unhandled-promise",
    ]);
  });

  it("keeps assistant-inclusive city autocomplete implementation milestones for event-order questions", () => {
    const language = createLanguageService();
    const makeFact = (
      id: string,
      sourceOrder: number,
      content: string,
      role: "assistant" | "user" = "user",
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: { sourceOrder },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeFact(
        "fact-weather-structure",
        6,
        "I'm building a weather app using JavaScript and OpenWeather API v2.5, and I need help structuring the code.",
      ),
      makeFact(
        "fact-city-autocomplete-geocoding",
        20,
        "I'm trying to implement city autocomplete using OpenWeather's Geocoding API v1, and I want to add a debounce delay of 300ms to reduce API calls.",
      ),
      makeFact(
        "fact-city-autocomplete-stale",
        22,
        "Cancel previous autocomplete requests when a new one is initiated and ignore stale autocomplete responses if the API response time exceeds the debounce delay.",
        "assistant",
      ),
      makeFact(
        "fact-city-autocomplete-dynamic",
        24,
        "Dynamically adjust the debounce delay based on typing speed and ensure only the most recent autocomplete request is processed.",
        "assistant",
      ),
      makeFact(
        "fact-invalid-city-errors",
        28,
        "I'm trying to handle errors for invalid city names in my weather app, including HTTP 404 and 400 status codes.",
      ),
      makeFact(
        "fact-api-key-noise",
        70,
        "I've never actually obtained an API key for this project, so I'm not sure how to proceed with implementing the weather app.",
      ),
      makeFact(
        "fact-city-autocomplete-try-catch",
        74,
        "I'm trying to integrate city autocomplete into my weather app and want to handle API errors more robustly with a try-catch block around the OpenWeather API call.",
      ),
      makeFact(
        "fact-autocomplete-results-noise",
        94,
        "I'm optimizing autocomplete to reduce API calls, so I limited the results to 5 items.",
      ),
      makeFact(
        "fact-autocomplete-final-state",
        160,
        "I'm working on the final autocomplete implementation pass: cache the last three searched cities, preserve selected city state, and keep the suggestions list consistent after async updates.",
      ),
    ];

    const result = selectFacts(
      facts,
      "Can you list the order in which I brought up different aspects of implementing the city autocomplete feature across our conversations, in order? Mention ONLY and ONLY five items.",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-city-autocomplete-geocoding",
      "fact-city-autocomplete-stale",
      "fact-city-autocomplete-dynamic",
      "fact-city-autocomplete-try-catch",
      "fact-autocomplete-final-state",
    ]);
  });

  it("keeps non-code professional-profile milestones for broad source-ordered aspect questions", () => {
    const language = createLanguageService();
    const makeFact = (
      id: string,
      sourceOrder: number,
      content: string,
      role: "assistant" | "user" = "user",
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: { sourceOrder },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeFact(
        "fact-joshua-ats-budget",
        4,
        "I'm worried my resume will not pass applicant tracking systems, and Joshua advised me on project budgeting and networking strategy.",
      ),
      makeFact(
        "fact-joshua-keywords",
        6,
        "I'll share job descriptions and feedback with Joshua so we can add keywords and refine the budget management sections.",
      ),
      makeFact(
        "fact-april-deadline-distractor",
        14,
        "I'm worried my resume will not be ready by April 10 for film, television, and digital media jobs.",
      ),
      makeFact(
        "fact-ats-course-distractor",
        22,
        "I completed 40% of a LinkedIn Learning ATS optimization course and I am unsure whether I can optimize the resume by the time I finish.",
      ),
      makeFact(
        "fact-industry-expansion-answer",
        33,
        "Expanding your resume to include both film and digital media can broaden your professional profile across several industries.",
        "assistant",
      ),
      makeFact(
        "fact-work-life-answer",
        35,
        "Balancing work and personal life is important while you keep improving your resume and career profile.",
        "assistant",
      ),
      makeFact(
        "fact-ats-simulator-answer",
        47,
        "Use ATS simulators and structured bullet points with quantified achievements to test your resume.",
        "assistant",
      ),
      makeFact(
        "fact-streaming-answer",
        55,
        "For Netflix and Hulu roles, highlight streaming platform skills and digital media experience in your resume.",
        "assistant",
      ),
      makeFact(
        "fact-linkedin-views",
        60,
        "I collaborated with Bryan on a LinkedIn profile update on April 20 and increased profile views by 60%.",
      ),
      makeFact(
        "fact-portfolio-distractor",
        66,
        "I finished a Squarespace portfolio redesign on May 1 for digital media roles and declined a $75,000 assistant producer offer.",
      ),
      makeFact(
        "fact-workshop-distractor",
        82,
        "I attended a workshop on international resume standards on May 3 and asked how to adapt my resume for the UK and Canadian markets.",
      ),
      makeFact(
        "fact-no-training-distractor",
        96,
        "I have never attended workshops or training sessions related to resume standards or ATS optimization.",
      ),
      makeFact(
        "fact-transferable-skills",
        110,
        "Kevin suggested I add transferable skills like remote team leadership to help my resume pass ATS screening.",
      ),
      makeFact(
        "fact-raise-negotiation",
        156,
        "I got a $12,000 raise in August 2024, and Joshua recommended adding it to my resume while I learn salary negotiation.",
      ),
      makeFact(
        "fact-european-markets",
        206,
        "David shared insights about adapting resumes for European markets and connecting that with portfolio performance metrics.",
      ),
    ];

    const result = selectFacts(
      facts,
      "Can you list the order in which I brought up different aspects of improving my professional profile and resume throughout our conversations in order? Mention ONLY and ONLY six items.",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    const selectedIds = result.facts.map((fact) => fact.id);
    for (const expectedId of [
      "fact-joshua-ats-budget",
      "fact-joshua-keywords",
      "fact-linkedin-views",
      "fact-transferable-skills",
      "fact-raise-negotiation",
      "fact-european-markets",
    ]) {
      expect(selectedIds).toContain(expectedId);
    }
    expect(
      selectedIds.indexOf("fact-joshua-ats-budget"),
    ).toBeLessThan(selectedIds.indexOf("fact-linkedin-views"));
    expect(
      selectedIds.indexOf("fact-linkedin-views"),
    ).toBeLessThan(selectedIds.indexOf("fact-transferable-skills"));
    expect(
      selectedIds.indexOf("fact-transferable-skills"),
    ).toBeLessThan(selectedIds.indexOf("fact-raise-negotiation"));
    expect(
      selectedIds.indexOf("fact-raise-negotiation"),
    ).toBeLessThan(selectedIds.indexOf("fact-european-markets"));
    for (const distractorId of [
      "fact-april-deadline-distractor",
      "fact-ats-course-distractor",
      "fact-industry-expansion-answer",
      "fact-work-life-answer",
      "fact-ats-simulator-answer",
      "fact-streaming-answer",
      "fact-portfolio-distractor",
      "fact-workshop-distractor",
      "fact-no-training-distractor",
    ]) {
      expect(result.traces.find((trace) => trace.memoryId === distractorId)?.returned).toBe(false);
    }
  });

  it("fills late source-ordered milestones even when early chatter has recent recall usage", () => {
    const language = createLanguageService();
    const makeFact = (
      id: string,
      sourceOrder: number,
      content: string,
      usageBoost = false,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: { sourceOrder },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeFact(
        "fact-core",
        4,
        "I want to implement core personal budget tracker functionality with authentication, expense tracking, and visualization.",
        true,
      ),
      makeFact(
        "fact-local-setup",
        6,
        "I am initializing the Flask budget tracker locally with SQLite and port 5000.",
        true,
      ),
      makeFact(
        "fact-jinja",
        10,
        "I am setting up Jinja2 templates and Bootstrap for the budget tracker UI.",
        true,
      ),
      makeFact(
        "fact-schema",
        12,
        "I am designing the budget tracker schema and models for income, expenses, and analytics.",
        true,
      ),
      makeFact(
        "fact-sqlite",
        14,
        "I am implementing SQLite transaction helpers with validation and error handling.",
        true,
      ),
      makeFact(
        "fact-password",
        16,
        "I am adding password hashing and login validation.",
        true,
      ),
      makeFact(
        "fact-homepage",
        24,
        "I implemented the homepage route and returned static HTML from Flask.",
        true,
      ),
      makeFact(
        "fact-minimal",
        34,
        "I want the budget tracker app to stay minimal while shipping the MVP.",
        true,
      ),
      makeFact(
        "fact-blueprints",
        48,
        "I am splitting the app into auth, transactions, and analytics blueprints.",
        true,
      ),
      makeFact(
        "fact-transaction-crud",
        60,
        "I am working on transaction CRUD and analytics integration after finishing registration and login.",
      ),
      makeFact(
        "fact-transaction-post",
        62,
        "I am implementing POST /transactions with proper response handling and error management.",
      ),
      makeFact(
        "fact-rest-api",
        82,
        "I am designing REST transaction endpoints with validation and error handling.",
        true,
      ),
      makeFact(
        "fact-security-review",
        116,
        "I am finalizing deployment and need security hardening for authentication and authorization before launch.",
      ),
      makeFact(
        "fact-gunicorn-tests",
        118,
        "I am reviewing Gunicorn deployment on Render.com and integration tests for auth, transaction CRUD, and analytics.",
      ),
      makeFact(
        "fact-security-tests",
        120,
        "I will add security tests for SQL injection and XSS before deployment.",
      ),
    ];

    const result = selectFacts(
      facts,
      "Can you list the order in which I brought up different aspects of developing my personal budget tracker throughout our conversations, in order? Mention ONLY and ONLY three items.",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    const selectedIds = result.facts.map((fact) => fact.id);
    expect(selectedIds).toContain("fact-core");
    expect(selectedIds).toContain("fact-transaction-crud");
    expect(selectedIds).toContain("fact-security-review");
    expect(
      selectedIds.indexOf("fact-transaction-crud"),
    ).toBeLessThan(selectedIds.indexOf("fact-security-review"));
  });

  it("keeps user event-order queries on source-order evidence instead of latest-update evidence", () => {
    const language = createLanguageService();
    const makeFact = (id: string, sourceOrder: number, content: string) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeFact(
        "fact-workout-distractor",
        8,
        "[BEAM chat_id=8 role=user time=unknown] These suggestions fit pretty well with what I am already doing. I started with the meditation app and could use support setting up a consistent workout routine, finding a local gym, or signing up for an online fitness class.",
      ),
      makeFact(
        "fact-greg-stress",
        24,
        "[BEAM chat_id=24 role=user time=unknown] I am stressed about collaborating with Greg on editing schedules and making our weekly meetings more productive.",
      ),
      makeFact(
        "fact-greg-agenda",
        26,
        "[BEAM chat_id=26 role=user time=unknown] I will send an agenda before our next meeting and encourage Greg to share his thoughts more openly.",
      ),
      makeFact(
        "fact-burnout-getaway",
        146,
        "[BEAM chat_id=146 role=user time=unknown] I am planning a weekend getaway with David and deciding whether to tell him about burnout and stress.",
      ),
      makeFact(
        "fact-anniversary",
        202,
        "[BEAM chat_id=202 role=user time=unknown] I am nervous about my upcoming anniversary dinner with David and want to make it special.",
      ),
      makeFact(
        "fact-anniversary-plan",
        204,
        "[BEAM chat_id=204 role=user time=unknown] I will reserve a table, plan the menu around David's favorites, bring flowers, and write a note.",
      ),
      makeFact(
        "fact-surprise",
        262,
        "[BEAM chat_id=262 role=user time=unknown] David planned a surprise picnic to celebrate my promotion and I want to return the favor.",
      ),
      makeFact(
        "fact-focus-distractor",
        350,
        "[BEAM chat_id=350 role=user time=unknown] I implemented Do Not Disturb mode on my work devices from 9 AM to 12 PM daily.",
      ),
    ];

    const result = selectFacts(
      facts,
      "Can you walk me through the order in which I brought up different personal and work-related challenges during our chats, in order? Mention ONLY and ONLY four items.",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    const selectedIds = result.facts.map((fact) => fact.id);
    expect(selectedIds).toContain("fact-greg-stress");
    expect(selectedIds).toContain("fact-burnout-getaway");
    expect(selectedIds).toContain("fact-anniversary");
    expect(selectedIds).toContain("fact-surprise");
    expect(
      selectedIds.indexOf("fact-greg-stress"),
    ).toBeLessThan(selectedIds.indexOf("fact-surprise"));
  });

  it("returns source-ordered coverage for broad conversation summary questions", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: { sourceOrder },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-css-user",
        14,
        "user",
        "I am debugging a CSS layout issue in my web project with Chrome DevTools and the box model.",
      ),
      makeSourceFact(
        "fact-css-assistant",
        15,
        "assistant",
        "The solution covered calculating element dimensions and using DevTools to inspect the layout issue.",
      ),
      makeSourceFact(
        "fact-dom-user",
        30,
        "user",
        "I am anticipating DOM manipulation errors such as classList of null in a Bootstrap navbar.",
      ),
      makeSourceFact(
        "fact-dom-assistant",
        31,
        "assistant",
        "The response added null checks, optional chaining, and try-catch blocks to prevent DOM runtime errors.",
      ),
      makeSourceFact(
        "fact-gallery-user",
        62,
        "user",
        "I am fixing project gallery images that return 404 errors in the web project.",
      ),
      makeSourceFact(
        "fact-gallery-assistant",
        63,
        "assistant",
        "The response checked image paths, build output, and static file serving to resolve the gallery 404 errors.",
      ),
      makeSourceFact(
        "fact-form-user",
        166,
        "user",
        "I am fixing an intermittent Formspree 500 Internal Server Error on my contact form submission.",
      ),
      makeSourceFact(
        "fact-form-assistant",
        167,
        "assistant",
        "The response recommended retry logic with exponential backoff and separate HTTP/network error handling.",
      ),
      createFactMemory({
        id: "fact-late-fragment",
        userId: "user-1",
        category: "external_benchmark",
        content:
          "Project gallery layout issues and 404 errors were debugged in detail.",
        source: SOURCE,
        tags: ["beam", "chat_id:119"],
        attributes: { chatId: 119 },
        updatedAt: TIMESTAMP,
      }),
    ];

    const result = selectFacts(
      facts,
      "Can you summarize how I approached and resolved the various issues with my web project over time?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    const selectedIds = result.facts.map((fact) => fact.id);
    for (const expectedId of [
      "fact-css-user",
      "fact-css-assistant",
      "fact-gallery-user",
      "fact-gallery-assistant",
      "fact-form-user",
      "fact-form-assistant",
    ]) {
      expect(selectedIds).toContain(expectedId);
    }
    expect(selectedIds.indexOf("fact-css-user")).toBeLessThan(
      selectedIds.indexOf("fact-gallery-user"),
    );
    expect(selectedIds.indexOf("fact-gallery-user")).toBeLessThan(
      selectedIds.indexOf("fact-form-user"),
    );
  });

  it("keeps named source milestones for named-person progression summaries", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-grammarly-noise",
        102,
        "[BEAM chat_id=102 role=user time=unknown] I will set up scheduled Grammarly Premium checks to catch errors and refine my writing as I go along.",
      ),
      makeSourceFact(
        "fact-robert-first-meeting",
        14,
        "[BEAM chat_id=14 role=user time=unknown] I'm worried about meeting my new academic mentor, Robert, at the East Janethaven Library on Feb 10, 2024, and want to make a good impression. ->-> 1,5",
      ),
      makeSourceFact(
        "fact-literature-review-noise",
        178,
        "[BEAM chat_id=178 role=user time=unknown] I've decided to restructure my paper for a journal format, adding a 500-word literature review section.",
      ),
      makeSourceFact(
        "fact-robert-essay-angle",
        64,
        "[BEAM chat_id=64 role=user time=unknown] Robert shared his 1985 essay on gender studies during our April 4 Zoom call, and I want to use some argument angles without copying him. ->-> 2,8",
      ),
      makeSourceFact(
        "fact-close-reading-noise",
        238,
        "[BEAM chat_id=238 role=user time=unknown] I annotated three articles extensively and summarized each section for close reading practice.",
      ),
      makeSourceFact(
        "fact-robert-warrants",
        124,
        "[BEAM chat_id=124 role=user time=unknown] I'm deciding whether to prioritize Robert's recommendation to use stronger warrants for claims on gender bias after he reviewed my draft on May 9. ->-> 3,10",
      ),
      makeSourceFact(
        "fact-robert-journal",
        170,
        "[BEAM chat_id=170 role=user time=unknown] Robert suggested submitting my essay to a journal while I am also working on a conference paper with Greg. ->-> 4,6",
      ),
    ];

    const result = selectFacts(
      facts,
      "Can you give me a summary of how my work and interactions with Robert have developed over time, including the key steps and decisions I've made along the way?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-robert-first-meeting",
      "fact-robert-essay-angle",
      "fact-robert-warrants",
      "fact-robert-journal",
    ]);
  });

  it("keeps adjacent named assistant synthesis for named-person progression summaries", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-budget-noise",
        28,
        "user",
        "[BEAM chat_id=28 role=user time=unknown] I created a monthly budget by April 1 and tracked all expenses over $20.",
      ),
      makeSourceFact(
        "fact-alexis-joint-account-user",
        64,
        "user",
        "[BEAM chat_id=64 role=user time=unknown] I'm stressed about managing our finances with my spouse Alexis after she suggested switching to a joint savings account at First National Bank on May 5. ->-> 2,6",
      ),
      makeSourceFact(
        "fact-alexis-joint-account-assistant",
        65,
        "assistant",
        "[BEAM chat_id=65 role=assistant time=unknown] Opening a joint savings account with Alexis can help you coordinate shared financial goals if you both agree on check-ins and contribution rules.",
      ),
      makeSourceFact(
        "fact-alexis-hours-user",
        228,
        "user",
        "[BEAM chat_id=228 role=user time=unknown] I will reduce my hours to 30 per week starting January to support Alexis's business launch.",
      ),
      makeSourceFact(
        "fact-alexis-hours-assistant",
        229,
        "assistant",
        "[BEAM chat_id=229 role=assistant time=unknown] Reducing your hours while supporting Alexis's business launch is a strategic financial tradeoff that should be reviewed against your household budget.",
      ),
    ];

    const result = selectFacts(
      facts,
      "Can you summarize how my approach to managing finances with Alexis has developed over time?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-alexis-joint-account-user",
      "fact-alexis-joint-account-assistant",
      "fact-alexis-hours-user",
      "fact-alexis-hours-assistant",
    ]);
  });

  it("keeps Alexis financial-management summary evidence on assistant synthesis turns", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-alexis-shared-finances-user",
        12,
        "user",
        "[BEAM chat_id=12 role=user time=unknown] My spouse Alexis and I have been sharing household finances since 2020, and I'm wondering if that's a good idea.",
      ),
      makeSourceFact(
        "fact-alexis-shared-finances-assistant",
        13,
        "assistant",
        "[BEAM chat_id=13 role=assistant time=unknown] Sharing household finances with your spouse, Alexis, can support unified financial goals, shared expenses, open communication, joint and separate accounts, and regular budget reviews.",
      ),
      makeSourceFact(
        "fact-alexis-spending-habits-user",
        14,
        "user",
        "[BEAM chat_id=14 role=user time=unknown] My biggest concern is making sure Alexis and I are on the same page with day-to-day spending habits because small expenses add up.",
      ),
      makeSourceFact(
        "fact-alexis-spending-habits-assistant",
        15,
        "assistant",
        "[BEAM chat_id=15 role=assistant time=unknown] To manage day-to-day expenses with Alexis, establish clear daily spending limits, use joint and individual accounts, track receipts, and hold regular check-ins.",
      ),
      makeSourceFact(
        "fact-alexis-excel-followup-user",
        16,
        "user",
        "[BEAM chat_id=16 role=user time=unknown] I'll keep using Excel to track expenses, set daily spending limits, and share receipts and statements with Alexis.",
      ),
      makeSourceFact(
        "fact-alexis-excel-followup-assistant",
        17,
        "assistant",
        "[BEAM chat_id=17 role=assistant time=unknown] Daily spending limits, Excel tracking, regular check-ins, and shared receipts will help keep everything transparent.",
      ),
      makeSourceFact(
        "fact-alexis-dining-budget-user",
        52,
        "user",
        "[BEAM chat_id=52 role=user time=unknown] I compromised with Alexis on the dining out budget to $200 monthly starting April and want help validating the choice.",
      ),
      makeSourceFact(
        "fact-alexis-dining-budget-assistant",
        53,
        "assistant",
        "[BEAM chat_id=53 role=assistant time=unknown] Compromising on the dining out budget to $200 monthly is reasonable if it fits financial goals, reduces stress, and is validated through planning and tracking.",
      ),
      makeSourceFact(
        "fact-alexis-joint-account-user",
        64,
        "user",
        "[BEAM chat_id=64 role=user time=June-10-2024] Alexis suggested switching to a joint savings account at First National Bank on May 5 to improve transparency.",
      ),
      makeSourceFact(
        "fact-alexis-joint-account-assistant",
        65,
        "assistant",
        "[BEAM chat_id=65 role=assistant time=unknown] Opening a joint savings account with Alexis can help coordinate shared financial goals, joint budgeting, contribution rules, and regular check-ins.",
      ),
      makeSourceFact(
        "fact-alexis-grocery-budget-user",
        126,
        "user",
        "[BEAM chat_id=126 role=user time=unknown] Alexis and I agreed on a $500 monthly joint grocery budget starting September 1, up from $400, with a freelance contract under consideration.",
      ),
      makeSourceFact(
        "fact-alexis-grocery-budget-assistant",
        127,
        "assistant",
        "[BEAM chat_id=127 role=assistant time=unknown] Increasing the grocery budget to $500 while considering a $2,000 freelance contract can support financial goals if you monitor expenses and cash flow.",
      ),
      makeSourceFact(
        "fact-camera-noise-user",
        130,
        "user",
        "[BEAM chat_id=130 role=user time=unknown] I'll keep an eye on how new camera gear affects my projects and maybe talk to Alexis about it too.",
      ),
      makeSourceFact(
        "fact-camera-noise-assistant",
        131,
        "assistant",
        "[BEAM chat_id=131 role=assistant time=unknown] Monitor project performance and discuss the camera purchase with Alexis so you stay aligned on financial decisions.",
      ),
      makeSourceFact(
        "fact-alexis-hours-user",
        252,
        "user",
        "[BEAM chat_id=252 role=user time=unknown] I've agreed with Alexis to reduce my work hours to 30 hours a week starting January 6 to support her freelance design business.",
      ),
      makeSourceFact(
        "fact-alexis-hours-assistant",
        253,
        "assistant",
        "[BEAM chat_id=253 role=assistant time=unknown] Reducing your work hours to 30 hours a week starting January 6 to support Alexis's business requires reviewing income, fixed expenses, groceries, medical expenses, emergency fund, and savings goals.",
      ),
      makeSourceFact(
        "fact-investment-club-noise-user",
        274,
        "user",
        "[BEAM chat_id=274 role=user time=unknown] How should I adjust my budget and investment strategy for an upcoming investment club meeting while supporting Alexis's business launch?",
      ),
      makeSourceFact(
        "fact-investment-club-noise-assistant",
        275,
        "assistant",
        "[BEAM chat_id=275 role=assistant time=unknown] Review current income, expenses, savings, investments, and the funds allocated to supporting Alexis's business launch.",
      ),
    ];

    const result = selectFacts(
      facts,
      "Can you summarize how my approach to managing finances with Alexis has developed over time?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-alexis-shared-finances-assistant",
      "fact-alexis-spending-habits-assistant",
      "fact-alexis-dining-budget-assistant",
      "fact-alexis-joint-account-assistant",
      "fact-alexis-grocery-budget-assistant",
      "fact-alexis-hours-assistant",
    ]);
  });

  it("prioritizes named relationship work decisions over generic named reflections", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = Array.from({ length: 16 }, (_, index) =>
      makeSourceFact(
        `fact-generic-${index}`,
        index,
        `[BEAM chat_id=${index} role=user time=unknown] Stephen and I talked about our relationship in a general reflection about free will.`,
      )
    );
    facts[2] = makeSourceFact(
      "fact-generic-work-reflection",
      2,
      "[BEAM chat_id=2 role=user time=unknown] I am wondering how my relationship and work commitments with Stephen relate to personal growth in general.",
    );
    facts[3] = makeSourceFact(
      "fact-stephen-trip-limit",
      3,
      "[BEAM chat_id=3 role=user time=unknown] I agreed to limit my work trips to 3 per quarter starting June for Stephen.",
    );

    const result = selectFacts(
      facts,
      "Can you summarize how I have managed my relationship and work commitments with Stephen over time?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    const selectedIds = result.facts.map((fact) => fact.id);
    expect(selectedIds).toContain("fact-stephen-trip-limit");
    expect(selectedIds).not.toContain("fact-generic-work-reflection");
  });

  it("keeps relationship work-commitment and motivation pairs for named summaries", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      [
        "fact-generic-free-will-user",
        30,
        "user",
        "Stephen and I talked about our relationship in a general reflection about balancing discipline with free will.",
      ],
      [
        "fact-generic-free-will-assistant",
        31,
        "assistant",
        "We discussed choosing a quiet time to ask Stephen about free will and discipline.",
      ],
      [
        "fact-meeting-user",
        58,
        "user",
        "I had to decline a 3 PM meeting with Stephen on March 14 to focus on the startup offer, and I wonder if I should have handled that differently.",
      ],
      [
        "fact-meeting-assistant",
        59,
        "assistant",
        "Declining Stephen's meeting for the startup offer called for timely communication, a clear explanation, and proposing an alternative meeting time.",
      ],
      [
        "fact-anniversary-call-user",
        60,
        "user",
        "I'm worried that scheduling a work call on our anniversary, March 20, might hurt Stephen's feelings and want to make it up to him.",
      ],
      [
        "fact-anniversary-call-assistant",
        61,
        "assistant",
        "For the anniversary work call conflict with Stephen, we discussed transparent communication, apology, rescheduling or shortening the call, and planning a special celebration.",
      ],
      [
        "fact-free-will-motivation-user",
        74,
        "user",
        "I'm confused about how believing in free will can affect my motivation, like the 2022 University of Cambridge study said, especially after resolving my conflict with Stephen by celebrating our anniversary.",
      ],
      [
        "fact-free-will-motivation-assistant",
        75,
        "assistant",
        "The University of Cambridge study connects belief in free will with motivation, agency, responsibility, resilience, and persistence while balancing career and personal life decisions.",
      ],
      [
        "fact-cultural-noise-user",
        88,
        "user",
        "I'm wondering if the social norms in Montserrat are influencing my partner Stephen's expectations from me and causing tension.",
      ],
      [
        "fact-cultural-noise-assistant",
        89,
        "assistant",
        "We talked about cultural expectations, shared responsibilities, mediation, and balancing career and personal relationships.",
      ],
      [
        "fact-trip-limit-user",
        110,
        "user",
        "I agreed to limit my work trips to 3 per quarter starting June for Stephen, and I want to balance relationship boundaries with professional ambitions.",
      ],
      [
        "fact-trip-limit-assistant",
        111,
        "assistant",
        "Limiting work trips to three per quarter for Stephen required open communication, prioritizing important trips, flexible scheduling, technology, delegation, and quarterly reviews.",
      ],
      [
        "fact-trip-plan-user",
        112,
        "user",
        "I'll talk to Stephen about prioritizing the most important trips, using tech to stay connected, and doing quarterly reviews.",
      ],
      [
        "fact-trip-plan-assistant",
        113,
        "assistant",
        "Open communication and regular check-ins will help keep both career growth and the relationship with Stephen balanced and healthy.",
      ],
      [
        "fact-later-relationship-noise-user",
        164,
        "user",
        "Stephen and I just celebrated five years together, and I'm wondering how our relationship might change if I question free will.",
      ],
      [
        "fact-later-relationship-noise-assistant",
        165,
        "assistant",
        "We explored structured reflections about free will and how those beliefs might affect your relationship.",
      ],
      [
        "fact-productivity-noise-user",
        196,
        "user",
        "I think starting my day with meditation and focusing on one task at a time helps, and I'll talk to Stephen more about it.",
      ],
      [
        "fact-productivity-noise-assistant",
        197,
        "assistant",
        "We reinforced meditation, planning, and reminders for focus and productivity.",
      ],
      [
        "fact-matthew-noise-user",
        202,
        "user",
        "I'll use the Eisenhower Box and prepare for the meeting with Matthew. Thanks for the advice, Stephen!",
      ],
      [
        "fact-matthew-noise-assistant",
        203,
        "assistant",
        "We discussed time management and preparing for a meeting with Matthew.",
      ],
      [
        "fact-weekly-checkin-noise-user",
        232,
        "user",
        "I scheduled weekly check-ins with Stephen every Sunday at 6 PM and want to keep them productive instead of turning into arguments.",
      ],
      [
        "fact-weekly-checkin-noise-assistant",
        233,
        "assistant",
        "Weekly check-ins with Stephen should use agendas, active listening, calm tone, solution focus, and follow-up summaries.",
      ],
      [
        "fact-journaling-user",
        258,
        "user",
        "I'm considering how daily journaling starting April 1 will help me understand if I truly have free will, given the University of Cambridge study linking belief in free will to higher motivation and goal persistence.",
      ],
      [
        "fact-journaling-assistant",
        259,
        "assistant",
        "Daily journaling can help track decisions, motivations, free-will beliefs, outcomes, motivation, and persistence patterns over time.",
      ],
      [
        "fact-journaling-plan-user",
        260,
        "user",
        "I'll keep up with my daily journaling and note how belief in free will impacts my motivation and persistence.",
      ],
      [
        "fact-journaling-plan-assistant",
        261,
        "assistant",
        "The journaling practice should use consistent timing, detailed entries, reflective questions, pattern reviews, and comparison to the Cambridge study.",
      ],
      [
        "fact-journaling-commitment-user",
        262,
        "user",
        "I'll stick to journaling every day and pay attention to patterns or insights about my beliefs in free will.",
      ],
      [
        "fact-journaling-commitment-assistant",
        263,
        "assistant",
        "Consistent daily journaling can surface insights about beliefs in free will and how they influence decisions, motivation, and persistence.",
      ],
      [
        "fact-date-confirmation-noise-user",
        268,
        "user",
        "Let's confirm dates for the team-building event, onboarding modules, anniversary celebration, and a June work trip.",
      ],
      [
        "fact-date-confirmation-noise-assistant",
        269,
        "assistant",
        "Confirmed the April 10 team-building event, April 25 onboarding deadline, April 4 anniversary celebration, and June work trip.",
      ],
    ].map(([id, sourceOrder, role, content]) =>
      makeSourceFact(
        id as string,
        sourceOrder as number,
        role as "assistant" | "user",
        content as string,
      )
    );
    const query =
      "Can you summarize how I've managed my relationship and work commitments with Stephen over time?";
    const selectedIds = selectSourceOrderedSummaryCoverage({
      entries: rankFactCandidates(
        buildFactCandidates(facts, query, language, "en", TIMESTAMP),
        "rules-only",
      ),
      language,
      query,
      queryLocale: "en",
    }).map((entry) => entry.fact.id);

    expect(selectedIds).toEqual([
      "fact-meeting-user",
      "fact-meeting-assistant",
      "fact-anniversary-call-user",
      "fact-anniversary-call-assistant",
      "fact-free-will-motivation-user",
      "fact-free-will-motivation-assistant",
      "fact-trip-limit-user",
      "fact-trip-limit-assistant",
      "fact-trip-plan-user",
      "fact-trip-plan-assistant",
      "fact-journaling-user",
      "fact-journaling-assistant",
      "fact-journaling-plan-user",
      "fact-journaling-plan-assistant",
      "fact-journaling-commitment-user",
      "fact-journaling-commitment-assistant",
    ]);
  });

  it("keeps family movie event planning pairs for broad summaries", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      [
        "fact-kids-movie-user",
        0,
        "user",
        "I'm worried about finding the right movies for my kids, Francis and Michelle, for our family weekend on March 12, 2024.",
      ],
      [
        "fact-kids-movie-assistant",
        1,
        "assistant",
        "Here are suggestions for Francis and Michelle: The Lion King, Moana, Coco, Trolls, and Zootopia for a family movie night on March 12.",
      ],
      [
        "fact-kids-theme-user",
        2,
        "user",
        "Thanks for the suggestions; adventure and comedy would be great themes, maybe with some educational value too.",
      ],
      [
        "fact-instruction-noise-user",
        52,
        "user",
        "Always include platform availability details when I ask about movie options.",
      ],
      [
        "fact-quieter-user",
        62,
        "user",
        "What movies would be suitable for my family weekend, considering Amy and Kyle are arriving at 2 PM on April 6 and have requested quieter movies for the evening?",
      ],
      [
        "fact-quieter-assistant",
        63,
        "assistant",
        "We planned quiet evening movies and a family movie marathon schedule for April 6 and April 7 with breaks, snacks, and activities.",
      ],
      [
        "fact-alternative-noise-user",
        158,
        "user",
        "Always provide alternative movie suggestions when I ask about family-friendly options.",
      ],
      [
        "fact-wish-noise-assistant",
        163,
        "assistant",
        "Wish is available on Disney+ with streaming quality settings, and I can help integrate Wish into your upcoming movie marathon schedule.",
      ],
      [
        "fact-encanto-preplan-noise-user",
        166,
        "user",
        "I think Encanto sounds perfect for our family movie night; can you remind me of the exact streaming quality settings and suggest themed snacks?",
      ],
      [
        "fact-may-marathon-user",
        168,
        "user",
        "I'm planning a movie marathon for May 11-12 and need family-friendly films because Amy and Kyle will join and Amy has an evening church service, so we'll start at 2 PM.",
      ],
      [
        "fact-may-marathon-assistant",
        169,
        "assistant",
        "We built a May 11-12 family-friendly movie marathon plan with Encanto, Turning Red, Onward, Strange World, The One and Only Ivan, and Coco.",
      ],
      [
        "fact-stream-budget-user",
        170,
        "user",
        "We'll start with Encanto at 2 PM on May 11; can you remind me of the streaming quality settings again and whether I should stick with the $70 budget?",
      ],
      [
        "fact-stream-budget-assistant",
        171,
        "assistant",
        "We reviewed Disney+ streaming quality settings and a $70 snack budget for the May family movie marathon.",
      ],
      [
        "fact-confirm-user",
        172,
        "user",
        "I'll set the streaming quality to \"Auto\" and stick with the $70 budget for snacks.",
      ],
      [
        "fact-confirm-assistant",
        173,
        "assistant",
        "Setting the streaming quality to \"Auto\" and sticking with the $70 budget should keep the May 11-12 movie marathon schedule in place.",
      ],
      [
        "fact-work-deadline-noise-user",
        256,
        "user",
        "I need to balance work deadlines with blocking 4 hours each weekend for movie planning and preparation.",
      ],
      [
        "fact-work-deadline-noise-assistant",
        257,
        "assistant",
        "We discussed weekly work scheduling and movie-night preparation blocks.",
      ],
    ].map(([id, sourceOrder, role, content]) =>
      makeSourceFact(
        id as string,
        sourceOrder as number,
        role as "assistant" | "user",
        content as string,
      )
    );
    const query =
      "Can you give me a summary of how I planned and organized my family movie events and related activities over the past few months?";
    const selectedIds = selectSourceOrderedSummaryCoverage({
      entries: rankFactCandidates(
        buildFactCandidates(facts, query, language, "en", TIMESTAMP),
        "rules-only",
      ),
      language,
      query,
      queryLocale: "en",
    }).map((entry) => entry.fact.id);

    expect(selectedIds).toEqual([
      "fact-kids-movie-user",
      "fact-kids-movie-assistant",
      "fact-kids-theme-user",
      "fact-quieter-user",
      "fact-quieter-assistant",
      "fact-may-marathon-user",
      "fact-may-marathon-assistant",
      "fact-stream-budget-user",
      "fact-stream-budget-assistant",
      "fact-confirm-user",
      "fact-confirm-assistant",
    ]);
  });

  it("does not route broad conversation summaries through contradiction confirmation", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-palette-user",
        4,
        "user",
        "[BEAM chat_id=4 role=user time=unknown] I built the first portfolio website feature: a color palette generator for my skills section.",
      ),
      makeSourceFact(
        "fact-palette-assistant",
        5,
        "assistant",
        "[BEAM chat_id=5 role=assistant time=unknown] We implemented the palette generator functions and Bootstrap styling.",
      ),
      makeSourceFact(
        "fact-structure-user",
        6,
        "user",
        "[BEAM chat_id=6 role=user time=unknown] I set up the portfolio website About, Skills, Projects, and Contact sections.",
      ),
      makeSourceFact(
        "fact-bootstrap-positive",
        38,
        "user",
        "[BEAM chat_id=38 role=user time=unknown] I implemented Bootstrap styling for the portfolio website project.",
      ),
      makeSourceFact(
        "fact-bootstrap-negated",
        39,
        "user",
        "[BEAM chat_id=39 role=user time=unknown] I have never implemented any Bootstrap components in this portfolio website project before.",
      ),
      makeSourceFact(
        "fact-gallery-user",
        58,
        "user",
        "[BEAM chat_id=58 role=user time=unknown] I integrated the project gallery and contact form and hit responsive layout issues.",
      ),
      makeSourceFact(
        "fact-gallery-assistant",
        59,
        "assistant",
        "[BEAM chat_id=59 role=assistant time=unknown] We fixed responsive gallery image sizing and layout issues.",
      ),
      makeSourceFact(
        "fact-sprint-user",
        82,
        "user",
        "[BEAM chat_id=82 role=user time=unknown] I worked on Sprint 2 SEO basics and contact form backend integration.",
      ),
      makeSourceFact(
        "fact-sprint-assistant",
        83,
        "assistant",
        "[BEAM chat_id=83 role=assistant time=unknown] We planned Sprint 2 tasks for SEO, backend integration, validation, and performance.",
      ),
      makeSourceFact(
        "fact-late-gallery-user",
        116,
        "user",
        "[BEAM chat_id=116 role=user time=unknown] I updated the project gallery to 10 cards and got image 404 errors.",
      ),
      makeSourceFact(
        "fact-late-gallery-assistant",
        117,
        "assistant",
        "[BEAM chat_id=117 role=assistant time=unknown] We resolved layout issues and 404 errors for project images.",
      ),
    ];

    const result = selectFacts(
      facts,
      "Can you give me a comprehensive summary of how my portfolio website project has developed, including the key features and challenges I have worked through so far?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    for (const expectedId of [
      "fact-palette-user",
      "fact-gallery-user",
      "fact-sprint-user",
      "fact-late-gallery-user",
    ]) {
      expect(result.facts.map((fact) => fact.id)).toContain(expectedId);
    }
  });

  it("prioritizes source-ordered implementation milestones over weak summary follow-ups", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-palette-user",
        4,
        "user",
        "[BEAM chat_id=4 role=user time=unknown] I'm building my first portfolio website using HTML5, CSS3, and Bootstrap v5.3.0, and I want to implement a color palette generator for my skills section.",
      ),
      makeSourceFact(
        "fact-palette-assistant",
        5,
        "assistant",
        "[BEAM chat_id=5 role=assistant time=unknown] We implemented the color palette generator functions and Bootstrap styling.",
      ),
      makeSourceFact(
        "fact-structure-user",
        6,
        "user",
        "[BEAM chat_id=6 role=user time=unknown] I'm trying to set up a single-page portfolio with About, Skills, Projects, and Contact sections.",
      ),
      makeSourceFact(
        "fact-structure-assistant",
        7,
        "assistant",
        "[BEAM chat_id=7 role=assistant time=unknown] We built the HTML structure and responsive Bootstrap layout for the portfolio sections.",
      ),
      makeSourceFact(
        "fact-bootstrap-user",
        10,
        "user",
        "[BEAM chat_id=10 role=user time=unknown] I'm trying to integrate the Bootstrap 5.3.0 CDN into my portfolio website for a responsive navbar and cards.",
      ),
      makeSourceFact(
        "fact-bootstrap-assistant",
        11,
        "assistant",
        "[BEAM chat_id=11 role=assistant time=unknown] We refined the navbar and card component setup with Bootstrap.",
      ),
      makeSourceFact(
        "fact-contact-user",
        16,
        "user",
        "[BEAM chat_id=16 role=user time=unknown] I'm trying to implement the contact form with validation as part of my MVP features.",
      ),
      makeSourceFact(
        "fact-contact-assistant",
        17,
        "assistant",
        "[BEAM chat_id=17 role=assistant time=unknown] We built the contact form validation and submission handling.",
      ),
      makeSourceFact(
        "fact-sass-user",
        28,
        "user",
        "[BEAM chat_id=28 role=user time=unknown] hmm, can I use Sass to create a similar component for the project gallery?",
      ),
      makeSourceFact(
        "fact-sass-assistant",
        29,
        "assistant",
        "[BEAM chat_id=29 role=assistant time=unknown] We discussed a Sass component for the project gallery.",
      ),
      makeSourceFact(
        "fact-lighthouse-user",
        40,
        "user",
        "[BEAM chat_id=40 role=user time=unknown] I'm trying to identify SEO and performance issues in my portfolio website using Lighthouse v10 audit.",
      ),
      makeSourceFact(
        "fact-lighthouse-assistant",
        41,
        "assistant",
        "[BEAM chat_id=41 role=assistant time=unknown] We reviewed Lighthouse performance, accessibility, and SEO findings.",
      ),
      makeSourceFact(
        "fact-gallery-layout-user",
        58,
        "user",
        "[BEAM chat_id=58 role=user time=unknown] I'm integrating the project gallery and contact form, and I'm having layout responsiveness issues.",
      ),
      makeSourceFact(
        "fact-gallery-layout-assistant",
        59,
        "assistant",
        "[BEAM chat_id=59 role=assistant time=unknown] We fixed responsive gallery image sizing and layout issues.",
      ),
      makeSourceFact(
        "fact-gallery-404-user",
        62,
        "user",
        "[BEAM chat_id=62 role=user time=unknown] I'm encountering an issue where some project gallery images are not loading with 404 errors.",
      ),
      makeSourceFact(
        "fact-gallery-404-assistant",
        63,
        "assistant",
        "[BEAM chat_id=63 role=assistant time=unknown] We checked image paths and static file serving for gallery 404 errors.",
      ),
      makeSourceFact(
        "fact-form-validation-user",
        66,
        "user",
        "[BEAM chat_id=66 role=user time=unknown] I'm trying to implement the contact form with HTML5 validation and custom JS validation fallback.",
      ),
      makeSourceFact(
        "fact-form-validation-assistant",
        67,
        "assistant",
        "[BEAM chat_id=67 role=assistant time=unknown] We improved required fields, email validation, and custom validation fallback.",
      ),
      makeSourceFact(
        "fact-sprint-user",
        82,
        "user",
        "[BEAM chat_id=82 role=user time=unknown] I'm working on Sprint 2 with a deadline and need to focus on SEO basics and contact form backend integration.",
      ),
      makeSourceFact(
        "fact-sprint-assistant",
        83,
        "assistant",
        "[BEAM chat_id=83 role=assistant time=unknown] We planned Sprint 2 tasks for SEO, backend integration, validation, and performance.",
      ),
      makeSourceFact(
        "fact-meta-user",
        88,
        "user",
        "[BEAM chat_id=88 role=user time=unknown] I'm trying to improve SEO by adding meta descriptions, keywords, and Open Graph tags.",
      ),
      makeSourceFact(
        "fact-meta-assistant",
        89,
        "assistant",
        "[BEAM chat_id=89 role=assistant time=unknown] We added meta descriptions, keywords, and Open Graph examples.",
      ),
      makeSourceFact(
        "fact-late-gallery-user",
        116,
        "user",
        "[BEAM chat_id=116 role=user time=unknown] I'm trying to update my project gallery to include two new projects for a total of 10 cards, but the layout has issues.",
      ),
      makeSourceFact(
        "fact-late-gallery-assistant",
        117,
        "assistant",
        "[BEAM chat_id=117 role=assistant time=unknown] We resolved the 10-card gallery layout issues and image 404 errors.",
      ),
      makeSourceFact(
        "fact-css-refactor-user",
        146,
        "user",
        "[BEAM chat_id=146 role=user time=unknown] I'm trying to refactor my CSS from 450 lines to 320 lines by removing redundant selectors.",
      ),
      makeSourceFact(
        "fact-css-refactor-assistant",
        147,
        "assistant",
        "[BEAM chat_id=147 role=assistant time=unknown] We consolidated CSS selectors and media queries.",
      ),
      makeSourceFact(
        "fact-hosting-user",
        182,
        "user",
        "[BEAM chat_id=182 role=user time=unknown] hmm, which one has better support for automated backups and version control?",
      ),
      makeSourceFact(
        "fact-hosting-assistant",
        183,
        "assistant",
        "[BEAM chat_id=183 role=assistant time=unknown] We compared GitHub Pages and Netlify for backups and version control.",
      ),
    ];

    const result = selectFacts(
      facts,
      "Can you give me a comprehensive summary of how my portfolio website project has developed, including the key features and challenges I have worked through so far?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    const selectedIds = result.facts.map((fact) => fact.id);
    for (const expectedId of [
      "fact-palette-user",
      "fact-structure-user",
      "fact-contact-user",
      "fact-gallery-layout-user",
      "fact-form-validation-user",
      "fact-sprint-user",
      "fact-late-gallery-user",
    ]) {
      expect(selectedIds).toContain(expectedId);
    }
    expect(selectedIds).not.toContain("fact-sass-user");
    expect(selectedIds).not.toContain("fact-hosting-user");
  });

  it("keeps concrete feature and challenge pairs for project feature summaries", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      [
        "fact-color-palette-user",
        4,
        "user",
        "I'm building my first portfolio website using HTML5, CSS3, and Bootstrap v5.3.0, and I want to create a color palette generator for my work as a Colour Technologist with primary and secondary colors.",
      ],
      [
        "fact-color-palette-assistant",
        5,
        "assistant",
        "We implemented hex-to-RGB conversion, shade generation, and a Bootstrap-styled palette display.",
      ],
      [
        "fact-site-structure-user",
        6,
        "user",
        "I'm trying to set up a single-page portfolio with sections for About, Skills, Projects, and Contact using HTML5, CSS3, and Bootstrap v5.3.0.",
      ],
      [
        "fact-site-structure-assistant",
        7,
        "assistant",
        "We enhanced the HTML structure with Bootstrap classes for responsiveness and navigation.",
      ],
      [
        "fact-timeline-noise-user",
        12,
        "user",
        "I'm trying to plan out my project timeline and have a deadline for the first sprint of my single-page portfolio website.",
      ],
      [
        "fact-timeline-noise-assistant",
        13,
        "assistant",
        "We can break the deadline into sprint tasks and milestones.",
      ],
      [
        "fact-contact-form-user",
        16,
        "user",
        "I'm trying to implement the contact form with validation as part of my MVP features and need the form data to submit correctly.",
      ],
      [
        "fact-contact-form-assistant",
        17,
        "assistant",
        "We built the contact form with Bootstrap styling and JavaScript form handling and validation.",
      ],
      [
        "fact-bundle-noise-user",
        48,
        "user",
        "I'm trying to optimize my Bootstrap bundle size under 150KB by deferring unused JavaScript components.",
      ],
      [
        "fact-bundle-noise-assistant",
        49,
        "assistant",
        "Dynamic imports can keep the bundle small.",
      ],
      [
        "fact-gallery-layout-user",
        58,
        "user",
        "I'm integrating the project gallery and contact form, and I'm having layout responsiveness bugs in Bootstrap v5.3.0 on desktop and mobile.",
      ],
      [
        "fact-gallery-layout-assistant",
        59,
        "assistant",
        "We adjusted the Bootstrap grid and card image classes to make the gallery responsive.",
      ],
      [
        "fact-gallery-modal-user",
        60,
        "user",
        "I'm trying to implement the project gallery with 8 cards using Bootstrap 5.3.0 card-deck and modal popups for project details, but the modals are not displaying correctly.",
      ],
      [
        "fact-gallery-modal-assistant",
        61,
        "assistant",
        "We replaced data-toggle/data-target with Bootstrap 5 data-bs attributes and moved away from card-deck.",
      ],
      [
        "fact-contact-validation-user",
        66,
        "user",
        "I'm trying to implement the contact form with HTML5 validation and custom JS validation fallback as mentioned in the feature implementation.",
      ],
      [
        "fact-contact-validation-assistant",
        67,
        "assistant",
        "We improved HTML5 validation, custom JavaScript validation, Bootstrap error messages, and submission handling.",
      ],
      [
        "fact-image-noise-user",
        76,
        "user",
        "I'm trying to optimize image sizes in my project gallery with ImageOptim and PIL scripts.",
      ],
      [
        "fact-image-noise-assistant",
        77,
        "assistant",
        "We can automate image compression and output optimized images.",
      ],
      [
        "fact-sprint-backend-user",
        82,
        "user",
        "I'm working on Sprint 2 with a deadline of April 20, 2024, focusing on SEO basics and contact form backend integration using Flask and Bootstrap 5.3.0.",
      ],
      [
        "fact-sprint-backend-assistant",
        83,
        "assistant",
        "We broke Sprint 2 into contact form backend integration, SEO basics, and performance optimization.",
      ],
      [
        "fact-lazyload-noise-user",
        122,
        "user",
        "I'm finalizing deployment and want to implement lazy loading for project gallery images with lazysizes.",
      ],
      [
        "fact-lazyload-noise-assistant",
        123,
        "assistant",
        "We included lazysizes and configured lazy image attributes.",
      ],
      [
        "fact-gallery-cards-user",
        116,
        "user",
        "I'm trying to update my project gallery to include two new projects for 10 cards, but the Bootstrap card-deck layout and modal popups have layout issues.",
      ],
      [
        "fact-gallery-cards-assistant",
        117,
        "assistant",
        "We fixed the Bootstrap 5 gallery layout by using row and col classes and checked image 404 paths.",
      ],
    ].map(([id, sourceOrder, role, content]) =>
      makeSourceFact(
        id as string,
        sourceOrder as number,
        role as "assistant" | "user",
        content as string,
      )
    );
    const query =
      "Can you give me a comprehensive summary of how my portfolio website project has developed, including the key features and challenges I have worked through so far?";
    const selectedIds = selectSourceOrderedSummaryCoverage({
      entries: rankFactCandidates(
        buildFactCandidates(facts, query, language, "en", TIMESTAMP),
        "rules-only",
      ),
      language,
      query,
      queryLocale: "en",
    }).map((entry) => entry.fact.id);

    expect(selectedIds).toEqual([
      "fact-color-palette-user",
      "fact-color-palette-assistant",
      "fact-site-structure-user",
      "fact-site-structure-assistant",
      "fact-contact-form-user",
      "fact-contact-form-assistant",
      "fact-gallery-layout-user",
      "fact-gallery-layout-assistant",
      "fact-gallery-modal-user",
      "fact-gallery-modal-assistant",
      "fact-contact-validation-user",
      "fact-contact-validation-assistant",
      "fact-sprint-backend-user",
      "fact-sprint-backend-assistant",
      "fact-gallery-cards-user",
      "fact-gallery-cards-assistant",
    ]);
  });

  it("keeps project lifecycle summary milestones across features timeline security and documentation", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-core-feature-user",
        4,
        "user",
        "[BEAM chat_id=4 role=user time=unknown] I'm building a personal budget tracker using Python and Flask with user authentication, expense tracking, income tracking, and data visualization as the core functionality.",
      ),
      makeSourceFact(
        "fact-core-feature-assistant",
        5,
        "assistant",
        "[BEAM chat_id=5 role=assistant time=unknown] We implemented the budget tracker core functionality: registration, login, expense tracking, and Matplotlib data visualization.",
      ),
      makeSourceFact(
        "fact-schema-distractor-user",
        14,
        "user",
        "[BEAM chat_id=14 role=user time=unknown] I'm designing the database schema with users and transactions tables for the budget tracker.",
      ),
      makeSourceFact(
        "fact-schema-distractor-assistant",
        15,
        "assistant",
        "[BEAM chat_id=15 role=assistant time=unknown] We improved the transactions table schema and validation helpers.",
      ),
      makeSourceFact(
        "fact-mvp-timeline-user",
        8,
        "user",
        "[BEAM chat_id=8 role=user time=unknown] I need to meet the April 15 MVP deadline for income and expense tracking, user login, and basic analytics.",
      ),
      makeSourceFact(
        "fact-mvp-timeline-assistant",
        9,
        "assistant",
        "[BEAM chat_id=9 role=assistant time=unknown] We created a development timeline for the April 15 MVP scope covering tracking, login, and analytics.",
      ),
      makeSourceFact(
        "fact-sprint-distractor-user",
        28,
        "user",
        "[BEAM chat_id=28 role=user time=unknown] I'm planning a two-week sprint that focuses only on user registration and login.",
      ),
      makeSourceFact(
        "fact-sprint-distractor-assistant",
        29,
        "assistant",
        "[BEAM chat_id=29 role=assistant time=unknown] We made a sprint plan for registration and login tasks.",
      ),
      makeSourceFact(
        "fact-analytics-distractor-user",
        30,
        "user",
        "[BEAM chat_id=30 role=user time=unknown] I'm adding a basic analytics dashboard for monthly summaries and category-wise spending charts.",
      ),
      makeSourceFact(
        "fact-analytics-distractor-assistant",
        31,
        "assistant",
        "[BEAM chat_id=31 role=assistant time=unknown] We planned the basic analytics dashboard with monthly summaries and spending charts.",
      ),
      makeSourceFact(
        "fact-blueprint-distractor-user",
        32,
        "user",
        "[BEAM chat_id=32 role=user time=unknown] I'm splitting my Flask project into auth, transactions, and analytics blueprints for maintainability.",
      ),
      makeSourceFact(
        "fact-blueprint-distractor-assistant",
        33,
        "assistant",
        "[BEAM chat_id=33 role=assistant time=unknown] We organized the Flask app with auth, transactions, and analytics blueprints.",
      ),
      makeSourceFact(
        "fact-session-distractor-user",
        34,
        "user",
        "[BEAM chat_id=34 role=user time=unknown] I'm reviewing user login sessions for the budget tracker before the MVP deadline.",
      ),
      makeSourceFact(
        "fact-session-distractor-assistant",
        35,
        "assistant",
        "[BEAM chat_id=35 role=assistant time=unknown] We reviewed login session handling for the budget tracker MVP.",
      ),
      makeSourceFact(
        "fact-validation-distractor-user",
        36,
        "user",
        "[BEAM chat_id=36 role=user time=unknown] I'm improving expense tracking validation and error messages for the Flask budget tracker.",
      ),
      makeSourceFact(
        "fact-validation-distractor-assistant",
        37,
        "assistant",
        "[BEAM chat_id=37 role=assistant time=unknown] We improved validation and error messaging around expense tracking.",
      ),
      makeSourceFact(
        "fact-registration-distractor-user",
        38,
        "user",
        "[BEAM chat_id=38 role=user time=unknown] I'm polishing user authentication registration and login forms before continuing the budget tracker work.",
      ),
      makeSourceFact(
        "fact-registration-distractor-assistant",
        39,
        "assistant",
        "[BEAM chat_id=39 role=assistant time=unknown] We polished user authentication registration and login forms.",
      ),
      makeSourceFact(
        "fact-income-distractor-user",
        40,
        "user",
        "[BEAM chat_id=40 role=user time=unknown] I'm adding income tracking filters and CSV export to the budget tracker.",
      ),
      makeSourceFact(
        "fact-income-distractor-assistant",
        41,
        "assistant",
        "[BEAM chat_id=41 role=assistant time=unknown] We added income tracking filters and CSV export support.",
      ),
      makeSourceFact(
        "fact-visualization-distractor-user",
        42,
        "user",
        "[BEAM chat_id=42 role=user time=unknown] I'm improving the data visualization charts for expense tracking and monthly analytics.",
      ),
      makeSourceFact(
        "fact-visualization-distractor-assistant",
        43,
        "assistant",
        "[BEAM chat_id=43 role=assistant time=unknown] We improved data visualization charts for expense tracking and analytics.",
      ),
      makeSourceFact(
        "fact-mvp-review-distractor-user",
        44,
        "user",
        "[BEAM chat_id=44 role=user time=unknown] I'm reviewing the MVP deadline again with user login, basic analytics, and income tracking still on the checklist.",
      ),
      makeSourceFact(
        "fact-mvp-review-distractor-assistant",
        45,
        "assistant",
        "[BEAM chat_id=45 role=assistant time=unknown] We reviewed the MVP checklist for login, analytics, and income tracking.",
      ),
      makeSourceFact(
        "fact-security-review-user",
        116,
        "user",
        "[BEAM chat_id=116 role=user time=unknown] I'm finalizing deployment, improving UI/UX based on feedback, and adding security hardening before public launch.",
      ),
      makeSourceFact(
        "fact-security-review-assistant",
        117,
        "assistant",
        "[BEAM chat_id=117 role=assistant time=unknown] We reviewed UI/UX and security hardening, including stronger authentication, authorization, HTTPS, and deployment safeguards.",
      ),
      makeSourceFact(
        "fact-lockout-user",
        150,
        "user",
        "[BEAM chat_id=150 role=user time=unknown] I'm implementing account lockout after 5 failed login attempts using Redis 7.0 for rate limiting.",
      ),
      makeSourceFact(
        "fact-lockout-assistant",
        151,
        "assistant",
        "[BEAM chat_id=151 role=assistant time=unknown] We refined the Redis account lockout implementation and rate limiting behavior for failed login attempts.",
      ),
      makeSourceFact(
        "fact-docs-user",
        176,
        "user",
        "[BEAM chat_id=176 role=user time=unknown] I need to document API endpoints and architecture decisions in Confluence for my remote collaborator.",
      ),
      makeSourceFact(
        "fact-docs-assistant",
        177,
        "assistant",
        "[BEAM chat_id=177 role=assistant time=unknown] We structured the Confluence documentation for API endpoints, architecture decisions, request examples, and feedback.",
      ),
      makeSourceFact(
        "fact-api-optimization-distractor-user",
        108,
        "user",
        "[BEAM chat_id=108 role=user time=unknown] I'm optimizing dashboard API response time to 250ms after caching tweaks, checking Flask-Login dependency versions, and asking for clear documentation and comments in the code.",
      ),
      makeSourceFact(
        "fact-api-optimization-distractor-assistant",
        109,
        "assistant",
        "[BEAM chat_id=109 role=assistant time=unknown] We discussed API optimization and dependency version examples.",
      ),
    ];

    const result = selectFacts(
      facts,
      "Can you provide a comprehensive summary of how my budget tracker project has progressed, including the key features implemented, the development timeline, security enhancements, and documentation efforts?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    const selectedIds = result.facts.map((fact) => fact.id);
    for (const expectedId of [
      "fact-core-feature-user",
      "fact-core-feature-assistant",
      "fact-mvp-timeline-user",
      "fact-mvp-timeline-assistant",
      "fact-security-review-user",
      "fact-security-review-assistant",
      "fact-lockout-user",
      "fact-lockout-assistant",
      "fact-docs-user",
      "fact-docs-assistant",
    ]) {
      expect(selectedIds).toContain(expectedId);
    }
    expect(selectedIds).not.toContain("fact-api-optimization-distractor-user");
  });

  it("prioritizes issue-resolution summary evidence over feature milestone distractors", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-project-timeline",
        12,
        "user",
        "[BEAM chat_id=12 role=user time=unknown] I'm planning the web project timeline and first sprint for the basic layout and navbar.",
      ),
      makeSourceFact(
        "fact-css-debug-user",
        14,
        "user",
        "[BEAM chat_id=14 role=user time=unknown] I'm trying to debug a CSS layout issue in Chrome DevTools v112 and understand the box model.",
      ),
      makeSourceFact(
        "fact-css-debug-assistant",
        15,
        "assistant",
        "[BEAM chat_id=15 role=assistant time=unknown] We debugged the CSS box model by calculating element dimensions and inspecting padding, borders, and margins.",
      ),
      makeSourceFact(
        "fact-contact-feature",
        16,
        "user",
        "[BEAM chat_id=16 role=user time=unknown] I'm trying to implement the contact form with HTML5 validation as an MVP feature.",
      ),
      makeSourceFact(
        "fact-dom-error-user",
        30,
        "user",
        "[BEAM chat_id=30 role=user time=unknown] I'm trying to anticipate Uncaught TypeError: Cannot read property 'classList' of null during DOM manipulation.",
      ),
      makeSourceFact(
        "fact-dom-error-assistant",
        31,
        "assistant",
        "[BEAM chat_id=31 role=assistant time=unknown] We added null checks, optional chaining, and try-catch handling for the DOM manipulation error.",
      ),
      makeSourceFact(
        "fact-lighthouse-distractor",
        40,
        "user",
        "[BEAM chat_id=40 role=user time=unknown] I'm identifying SEO and performance issues in the portfolio website using Lighthouse v10 audit.",
      ),
      makeSourceFact(
        "fact-gallery-layout-distractor",
        58,
        "user",
        "[BEAM chat_id=58 role=user time=unknown] I'm integrating the project gallery and contact form and dealing with layout responsiveness.",
      ),
      makeSourceFact(
        "fact-gallery-404-user",
        62,
        "user",
        "[BEAM chat_id=62 role=user time=unknown] I'm encountering an issue where project gallery images are not loading and returning 404 errors.",
      ),
      makeSourceFact(
        "fact-gallery-404-assistant",
        63,
        "assistant",
        "[BEAM chat_id=63 role=assistant time=unknown] We checked image paths, static file serving, and build output to resolve the gallery 404 errors.",
      ),
      makeSourceFact(
        "fact-server-logs-user",
        64,
        "user",
        "[BEAM chat_id=64 role=user time=unknown] Ok cool, do I need to check anything specific in the server logs to find the issue?",
      ),
      makeSourceFact(
        "fact-server-logs-assistant",
        65,
        "assistant",
        "[BEAM chat_id=65 role=assistant time=unknown] We checked server logs for 404 errors, missing files, path mismatches, and deployment problems.",
      ),
      makeSourceFact(
        "fact-validate-error-user",
        68,
        "user",
        "[BEAM chat_id=68 role=user time=unknown] I'm trying to fix Uncaught ReferenceError: validateForm is not defined because the script src path is wrong.",
      ),
      makeSourceFact(
        "fact-validate-error-assistant",
        69,
        "assistant",
        "[BEAM chat_id=69 role=assistant time=unknown] We fixed the validateForm ReferenceError by correcting the script path and ensuring the function was defined.",
      ),
      makeSourceFact(
        "fact-file-structure-user",
        70,
        "user",
        "[BEAM chat_id=70 role=user time=unknown] ok cool, do I need to check anything specific in the file structure to make sure everything links correctly?",
      ),
      makeSourceFact(
        "fact-file-structure-assistant",
        71,
        "assistant",
        "[BEAM chat_id=71 role=assistant time=unknown] We checked the file structure, relative paths, folders, and script links so every resource linked correctly.",
      ),
      makeSourceFact(
        "fact-sprint-distractor",
        82,
        "user",
        "[BEAM chat_id=82 role=user time=unknown] I'm working on Sprint 2 tasks for SEO basics and contact form backend integration.",
      ),
      makeSourceFact(
        "fact-formspree-user",
        166,
        "user",
        "[BEAM chat_id=166 role=user time=unknown] I'm trying to fix an intermittent Formspree 500 Internal Server Error on my contact form submission.",
      ),
      makeSourceFact(
        "fact-formspree-assistant",
        167,
        "assistant",
        "[BEAM chat_id=167 role=assistant time=unknown] We improved the Formspree 500 handling with retry logic, exponential backoff, and separate network error handling.",
      ),
    ];

    const result = selectFacts(
      facts,
      "Can you summarize how I approached and resolved the various issues with my web project over time?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    const selectedIds = result.facts.map((fact) => fact.id);
    for (const expectedId of [
      "fact-css-debug-user",
      "fact-css-debug-assistant",
      "fact-dom-error-user",
      "fact-dom-error-assistant",
      "fact-gallery-404-user",
      "fact-gallery-404-assistant",
      "fact-server-logs-user",
      "fact-server-logs-assistant",
      "fact-validate-error-user",
      "fact-validate-error-assistant",
      "fact-file-structure-user",
      "fact-file-structure-assistant",
      "fact-formspree-user",
      "fact-formspree-assistant",
    ]) {
      expect(selectedIds).toContain(expectedId);
    }
    expect(selectedIds).not.toContain("fact-project-timeline");
    expect(selectedIds).not.toContain("fact-contact-feature");
    expect(selectedIds).not.toContain("fact-lighthouse-distractor");
    expect(selectedIds).not.toContain("fact-gallery-layout-distractor");
    expect(selectedIds).not.toContain("fact-sprint-distractor");
  });

  it("prioritizes creative project timeline milestones over generic time-management summary turns", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      content: string,
      role: "assistant" | "user" = "user",
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-previous-assistant",
        31,
        "[BEAM chat_id=31 role=assistant time=unknown] You're welcome. Asking Laura those questions should help your schedule.",
        "assistant",
      ),
      makeSourceFact(
        "fact-deadline",
        32,
        "[BEAM chat_id=33 role=user time=unknown] I'm worried about meeting my deadline for the pilot episode by June 30, 2024, with a budget cap of $120,000.",
      ),
      makeSourceFact(
        "fact-deadline-plan",
        33,
        "[BEAM chat_id=33 role=assistant time=unknown] We created a pilot episode project timeline covering script finalization, casting, production, post-production, deadline, and budget management.",
        "assistant",
      ),
      makeSourceFact(
        "fact-course",
        79,
        "[BEAM chat_id=79 role=user time=unknown] I'm stressed about a new online course on advanced storytelling techniques that starts April 1 and costs $350.",
      ),
      makeSourceFact(
        "fact-script",
        39,
        "[BEAM chat_id=39 role=user time=unknown] I'm prioritizing script finalization over location scouting this month to meet the June deadline.",
      ),
      makeSourceFact(
        "fact-pushed-date",
        127,
        "[BEAM chat_id=127 role=user time=unknown] The pilot delivery date was pushed back to July 15 because of casting delays communicated to stakeholders.",
      ),
      makeSourceFact(
        "fact-family-schedule",
        145,
        "[BEAM chat_id=145 role=user time=unknown] My kids started summer camp and I'm trying to balance work and family time.",
      ),
      makeSourceFact(
        "fact-filming-progress",
        157,
        "[BEAM chat_id=157 role=user time=unknown] My pilot episode is 75% complete by July 5, with 12 of 16 scenes filmed and 60% of post-production started.",
      ),
      makeSourceFact(
        "fact-email-batching",
        149,
        "[BEAM chat_id=149 role=user time=unknown] I implemented batching for emails and calls on Mondays and Fridays, saving me 4 hours weekly.",
      ),
      makeSourceFact(
        "fact-editing",
        205,
        "[BEAM chat_id=205 role=user time=unknown] My pilot editing is 90% complete and I have color grading scheduled for September 10-12.",
      ),
      makeSourceFact(
        "fact-brainstorm",
        211,
        "[BEAM chat_id=211 role=user time=unknown] I co-hosted a 90-minute virtual brainstorming session with Stephanie for upcoming projects.",
      ),
      makeSourceFact(
        "fact-post-production",
        251,
        "[BEAM chat_id=251 role=user time=unknown] The post-production schedule is 95% completed by November 15 and the final sound mix is scheduled for November 22.",
      ),
    ];

    const result = selectFacts(
      facts,
      "Can you give me a summary of how my pilot episode project timeline and tasks have developed and changed throughout our conversations?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    const selectedIds = result.facts.map((fact) => fact.id);
    for (const expectedId of [
      "fact-deadline",
      "fact-deadline-plan",
      "fact-script",
      "fact-pushed-date",
      "fact-filming-progress",
      "fact-editing",
      "fact-post-production",
    ]) {
      expect(selectedIds).toContain(expectedId);
    }
    expect(selectedIds).not.toContain("fact-course");
    expect(selectedIds).not.toContain("fact-family-schedule");
    expect(selectedIds).not.toContain("fact-email-batching");
    expect(selectedIds).not.toContain("fact-brainstorm");
    expect(selectedIds).not.toContain("fact-previous-assistant");
  });

  it("keeps early concept-learning milestones for understanding progression summaries", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-date-distractor",
        1,
        "assistant",
        "[BEAM chat_id=1 role=assistant time=unknown] One week from January 10 is January 17.",
      ),
      makeSourceFact(
        "fact-field-application",
        2,
        "user",
        "[BEAM chat_id=2 role=user time=unknown] I'm trying to learn about probability basics and apply color-combination probability to a batch of paints.",
      ),
      makeSourceFact(
        "fact-ratio-user",
        6,
        "user",
        "[BEAM chat_id=6 role=user time=unknown] I'm trying to understand probability as a ratio using coin tosses and dice rolls.",
      ),
      makeSourceFact(
        "fact-ratio-assistant",
        7,
        "assistant",
        "[BEAM chat_id=7 role=assistant time=unknown] We explained probability as favorable outcomes divided by total outcomes using coin tosses and dice rolls.",
      ),
      makeSourceFact(
        "fact-independent",
        15,
        "assistant",
        "[BEAM chat_id=15 role=assistant time=unknown] We clarified independent and mutually exclusive events with probability calculations.",
      ),
      makeSourceFact(
        "fact-two-coins",
        31,
        "assistant",
        "[BEAM chat_id=31 role=assistant time=unknown] We calculated P(both heads) for two independent coin tosses as 1/2 x 1/2 = 1/4.",
      ),
      makeSourceFact(
        "fact-mutually-exclusive",
        43,
        "assistant",
        "[BEAM chat_id=43 role=assistant time=unknown] We confirmed that rolling a 2 and rolling a 5 on one die are mutually exclusive events.",
      ),
      makeSourceFact(
        "fact-conditional",
        57,
        "assistant",
        "[BEAM chat_id=57 role=assistant time=unknown] We introduced conditional probability P(A|B) and applied it to cards, coin tosses, and dice rolls.",
      ),
      makeSourceFact(
        "fact-late-dependent",
        108,
        "user",
        "[BEAM chat_id=108 role=user time=unknown] I'm trying to calculate dependent events and conditional probability for drawing cards without replacement.",
      ),
      makeSourceFact(
        "fact-visual-preference",
        234,
        "user",
        "[BEAM chat_id=234 role=user time=unknown] Always combine algebraic formulas with visual diagrams when I ask about complex probability problems.",
      ),
    ];

    const result = selectFacts(
      facts,
      "Can you give me a clear summary of how my understanding of probability has developed through our conversations?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    const selectedIds = result.facts.map((fact) => fact.id);
    for (const expectedId of [
      "fact-ratio-user",
      "fact-ratio-assistant",
      "fact-independent",
      "fact-two-coins",
      "fact-mutually-exclusive",
      "fact-conditional",
    ]) {
      expect(selectedIds).toContain(expectedId);
    }
    expect(selectedIds).not.toContain("fact-field-application");
    expect(selectedIds).not.toContain("fact-date-distractor");
  });

  it("samples advanced topic-specific learning milestones for concept progression summaries", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-heron-distractor-user",
        2,
        "user",
        "[BEAM chat_id=2 role=user time=unknown] I'm trying to understand triangle geometry by calculating triangle area with Heron's formula.",
      ),
      makeSourceFact(
        "fact-heron-distractor-assistant",
        3,
        "assistant",
        "[BEAM chat_id=3 role=assistant time=unknown] We calculated triangle area with Heron's formula from three side lengths.",
      ),
      makeSourceFact(
        "fact-equilateral-distractor-user",
        12,
        "user",
        "[BEAM chat_id=12 role=user time=unknown] I'm trying to understand what defines an equilateral triangle and how to calculate its area.",
      ),
      makeSourceFact(
        "fact-sss-similarity-user",
        144,
        "user",
        "[BEAM chat_id=144 role=user time=unknown] I tried proving triangle congruence and similarity using SSS, SAS, and ASA criteria with side lengths 6-8-10 and 9-12-15.",
      ),
      makeSourceFact(
        "fact-sss-similarity-assistant",
        145,
        "assistant",
        "[BEAM chat_id=145 role=assistant time=unknown] We verified triangle similarity through the SSS criterion by comparing corresponding side ratios and scale factors.",
      ),
      makeSourceFact(
        "fact-scale-factor-assistant",
        147,
        "assistant",
        "[BEAM chat_id=147 role=assistant time=unknown] We summarized how the SSS criterion and scale factors prove similarity for the two triangles.",
      ),
      makeSourceFact(
        "fact-asa-proof-user",
        150,
        "user",
        "[BEAM chat_id=150 role=user time=unknown] I planned an ASA triangle congruence proof with angles 50 and 60 degrees plus the included side.",
      ),
      makeSourceFact(
        "fact-asa-proof-assistant",
        151,
        "assistant",
        "[BEAM chat_id=151 role=assistant time=unknown] We walked through the ASA criterion for triangle congruence using two angles and the included side.",
      ),
      makeSourceFact(
        "fact-sas-asa-user",
        152,
        "user",
        "[BEAM chat_id=152 role=user time=unknown] I compared SAS and ASA methods for proving triangle congruence and got stuck applying them correctly.",
      ),
      makeSourceFact(
        "fact-sas-asa-assistant",
        153,
        "assistant",
        "[BEAM chat_id=153 role=assistant time=unknown] We compared SAS and ASA proof methods for triangle congruence and when each criterion applies.",
      ),
      makeSourceFact(
        "fact-ssa-user",
        162,
        "user",
        "[BEAM chat_id=162 role=user time=unknown] I asked why SSA is not a valid triangle congruence criterion and wanted a counterexample.",
      ),
      makeSourceFact(
        "fact-ssa-assistant",
        163,
        "assistant",
        "[BEAM chat_id=163 role=assistant time=unknown] We explained why SSA is ambiguous and not a valid congruence criterion.",
      ),
    ];

    const result = selectFacts(
      facts,
      "Can you give me a clear summary of how my understanding and application of triangle similarity and congruence developed throughout our conversations?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    const selectedIds = result.facts.map((fact) => fact.id);
    for (const expectedId of [
      "fact-sss-similarity-user",
      "fact-sss-similarity-assistant",
      "fact-scale-factor-assistant",
      "fact-asa-proof-user",
      "fact-asa-proof-assistant",
      "fact-sas-asa-user",
      "fact-sas-asa-assistant",
      "fact-ssa-user",
      "fact-ssa-assistant",
    ]) {
      expect(selectedIds).toContain(expectedId);
    }
    expect(selectedIds).not.toContain("fact-heron-distractor-user");
    expect(selectedIds).not.toContain("fact-equilateral-distractor-user");
  });

  it("keeps triangle right-angle area and median milestones for broad geometry summaries", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-isosceles-followup-noise",
        18,
        "user",
        "[BEAM chat_id=18 role=user time=unknown] The key characteristics and example calculation helped me identify and calculate the angles and sides of an isosceles triangle.",
      ),
      makeSourceFact(
        "fact-law-of-cosines-noise",
        31,
        "assistant",
        "[BEAM chat_id=31 role=assistant time=unknown] We used the Law of Cosines to find unknown angles in a triangle with sides 7 cm, 9 cm, and 12 cm.",
      ),
      makeSourceFact(
        "fact-right-angle-check",
        76,
        "user",
        "[BEAM chat_id=76 role=user time=unknown] I'm trying to verify if a triangle with sides 8 cm, 15 cm, and 17 cm is right-angled using the Pythagorean theorem and checking whether 8^2 + 15^2 = 17^2.",
      ),
      makeSourceFact(
        "fact-heron-7-24-25",
        79,
        "assistant",
        "[BEAM chat_id=79 role=assistant time=unknown] Heron's formula gives the area of a triangle with sides 7 cm, 24 cm, and 25 cm as 84 cm^2.",
      ),
      makeSourceFact(
        "fact-base-height-vs-heron",
        81,
        "assistant",
        "[BEAM chat_id=81 role=assistant time=unknown] We calculated the area of a triangle with base 10 cm and height 6 cm using base-height and Heron's formula, and the base-height method was more efficient.",
      ),
      makeSourceFact(
        "fact-median-length",
        85,
        "assistant",
        "[BEAM chat_id=85 role=assistant time=unknown] We applied the median length formula to a triangle with sides 9 cm, 12 cm, and 15 cm and found the median length was about 12.82 cm.",
      ),
      makeSourceFact(
        "fact-median-equal-area",
        89,
        "assistant",
        "[BEAM chat_id=89 role=assistant time=unknown] We proved that a median divides a triangle into two smaller triangles of equal area, including examples with sides 8-15-17 and 7-24-25.",
      ),
      makeSourceFact(
        "fact-roof-truss-noise",
        98,
        "user",
        "[BEAM chat_id=98 role=user time=unknown] I'm modeling a triangular roof truss with sides 6 m, 8 m, 10 m and load distribution using medians.",
      ),
      makeSourceFact(
        "fact-area-comparison-instruction-noise",
        132,
        "user",
        "[BEAM chat_id=132 role=user time=unknown] Always include comparative analysis of multiple solution methods when I ask about triangle area calculations.",
      ),
      makeSourceFact(
        "fact-congruence-similarity-noise",
        190,
        "user",
        "[BEAM chat_id=190 role=user time=unknown] I want to understand triangle congruence and similarity, scale factors, medians, altitudes, GeoGebra, visual aids, and roof truss applications.",
      ),
    ];

    const result = selectFacts(
      facts,
      "Can you give me a clear summary of everything we've covered about triangles, including how to verify right angles, calculate areas, and understand medians?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-right-angle-check",
      "fact-heron-7-24-25",
      "fact-base-height-vs-heron",
      "fact-median-length",
      "fact-median-equal-area",
    ]);
  });

  it("keeps study-abroad preparation milestones for broad planning summaries", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-personal-statement-deadline",
        8,
        "user",
        "[BEAM chat_id=8 role=user time=unknown] I'm stuck on this personal statement and want to get it done by April 20, 2024, while acknowledging Tanya's support for my career goals.",
      ),
      makeSourceFact(
        "fact-scholarship-visa-timeline-noise",
        13,
        "assistant",
        "[BEAM chat_id=13 role=assistant time=unknown] We planned personal statement milestones around the scholarship deadline on May 15 and the visa application due June 1.",
      ),
      makeSourceFact(
        "fact-documentary-noise",
        53,
        "assistant",
        "[BEAM chat_id=53 role=assistant time=unknown] We integrated Kimberly's suggestion to discuss the Janethaven Film Awards documentary in the personal statement.",
      ),
      makeSourceFact(
        "fact-tanya-support",
        77,
        "assistant",
        "[BEAM chat_id=77 role=assistant time=unknown] We framed Tanya's support in the personal statement as professional and emotional preparation that connects to future academic and professional goals.",
      ),
      makeSourceFact(
        "fact-voice-editing-noise",
        169,
        "assistant",
        "[BEAM chat_id=169 role=assistant time=unknown] We refined the personal statement introduction and career gap section for stronger voice and transitions.",
      ),
      makeSourceFact(
        "fact-canada-study-visa-decision",
        131,
        "assistant",
        "[BEAM chat_id=131 role=assistant time=unknown] We weighed accepting the part-time role at Montserrat Media Hub against applying for a Canadian study visa, including funding, education quality, work opportunities, cultural experience, and networking.",
      ),
      makeSourceFact(
        "fact-canada-visa-interview",
        133,
        "assistant",
        "[BEAM chat_id=133 role=assistant time=unknown] We prepared for a Canadian study visa interview by reviewing study permit requirements, gathering acceptance letters, financial statements, language results, and practicing questions about goals and funding.",
      ),
      makeSourceFact(
        "fact-leadership-section-noise",
        201,
        "assistant",
        "[BEAM chat_id=201 role=assistant time=unknown] We added a brief leadership experiences section to the personal statement by June 10.",
      ),
      makeSourceFact(
        "fact-toronto-clothing-budget",
        205,
        "assistant",
        "[BEAM chat_id=205 role=assistant time=unknown] We budgeted the $2,000 Montserrat Arts Council emergency fund so $300 was reserved for warm clothing for Toronto.",
      ),
    ];

    const result = selectFacts(
      facts,
      "Can you give me a comprehensive summary of how my plans and preparations for studying abroad have developed over time?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-personal-statement-deadline",
      "fact-tanya-support",
      "fact-canada-study-visa-decision",
      "fact-canada-visa-interview",
      "fact-toronto-clothing-budget",
    ]);
  });

  it("keeps estate-planning process and will-finalization milestones for broad summaries", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-initial-estate-plan-noise",
        5,
        "assistant",
        "[BEAM chat_id=5 role=assistant time=unknown] We created a general estate-plan checklist covering assets, beneficiaries, executors, guardians, trusts, and attorney review.",
      ),
      makeSourceFact(
        "fact-douglas-estate-provisions",
        23,
        "assistant",
        "[BEAM chat_id=23 role=assistant time=unknown] Including Douglas in the estate plan involved listing assets, specifying provisions for Douglas, updating beneficiary designations, adding Douglas to the will, consulting an attorney, and communicating the plan with him.",
      ),
      makeSourceFact(
        "fact-executor-douglas-kevin",
        33,
        "assistant",
        "[BEAM chat_id=33 role=assistant time=unknown] Choosing between Douglas and Kevin as executor before the April 1 deadline required weighing responsibility, organizational skills, legal and financial knowledge, availability, emotional stability, trust, and family input.",
      ),
      makeSourceFact(
        "fact-will-deadline-noise",
        41,
        "assistant",
        "[BEAM chat_id=41 role=assistant time=unknown] To complete the legally valid will by May 15, we made a timeline for asset inventory, drafting the will, consulting Stephanie, gathering witnesses, and executing the document.",
      ),
      makeSourceFact(
        "fact-stephanie-witness-meeting",
        34,
        "user",
        "[BEAM chat_id=34 role=user time=unknown] I have a meeting with attorney Stephanie on March 22 to finalize my will, and Montserrat law requires two witnesses for it to be valid.",
      ),
      makeSourceFact(
        "fact-executor-family-meeting",
        69,
        "assistant",
        "[BEAM chat_id=69 role=assistant time=unknown] After Kimberly and Bradley attended the executor meeting, we discussed clear communication about choosing Douglas, possible co-executor support from Kevin, involving estate attorney Stephanie, and documenting the decision in the will.",
      ),
      makeSourceFact(
        "fact-willmaker-draft-noise",
        83,
        "assistant",
        "[BEAM chat_id=83 role=assistant time=unknown] The WillMaker Pro draft included beneficiaries, Douglas as executor, Kevin as alternate, guardianship, asset distribution, trust provisions, funeral instructions, and witness requirements.",
      ),
      makeSourceFact(
        "fact-will-witness-review",
        85,
        "assistant",
        "[BEAM chat_id=85 role=assistant time=unknown] Preparing for Stephanie's will review meant checking Montserrat's two-witness rule, deciding whether to notarize the will, preparing witness information, and confirming legal requirements.",
      ),
      makeSourceFact(
        "fact-probate-digital-noise",
        123,
        "assistant",
        "[BEAM chat_id=123 role=assistant time=unknown] We reviewed probate optimization, executor appointment, inventory and appraisal, debts and taxes, and why not using WillMaker Pro affected estate planning.",
      ),
      makeSourceFact(
        "fact-guardianship-emergency-fund",
        179,
        "assistant",
        "[BEAM chat_id=179 role=assistant time=unknown] We planned a conversation with Douglas about the $5,000 emergency fund for guardianship expenses so both of us were on the same page, including medical costs, educational needs, living expenses, guardian supporter responsibilities, management of the fund, and possible adjustments.",
      ),
      makeSourceFact(
        "fact-notarized-guardianship-affidavits",
        183,
        "assistant",
        "[BEAM chat_id=183 role=assistant time=unknown] Preparing notarized affidavits for guardianship would streamline probate by drafting affidavits, gathering identification and birth certificates, consulting Stephanie, notarizing the documents, and storing them securely.",
      ),
      makeSourceFact(
        "fact-kevin-paralegal-review",
        189,
        "assistant",
        "[BEAM chat_id=189 role=assistant time=unknown] Kevin, a paralegal, would review the will draft after I organized documents, summarized wishes, listed concerns about guardianship, asset distribution, and digital assets, and prepared to consult Stephanie for final approval.",
      ),
      makeSourceFact(
        "fact-electronic-will-signatures",
        221,
        "assistant",
        "[BEAM chat_id=221 role=assistant time=unknown] Electronic will signatures in Montserrat became accepted in July 2024, affecting convenience, legal validity, security, witness requirements, and how to update the estate plan.",
      ),
      makeSourceFact(
        "fact-final-review-noise",
        283,
        "assistant",
        "[BEAM chat_id=283 role=assistant time=unknown] The final estate-plan binder checklist included the will, digital assets, financial documents, insurance policies, property deeds, and executor responsibilities.",
      ),
      makeSourceFact(
        "fact-charity-disagreement-noise",
        299,
        "assistant",
        "[BEAM chat_id=299 role=assistant time=unknown] Allocating 10% of the estate to charity created tax, executor, and documentation implications after a disagreement with Douglas.",
      ),
    ];

    const processSummary = selectFacts(
      facts,
      "Can you give me a complete summary of how my estate planning process has developed, including the key decisions and discussions I've had about executors, guardianship, and asset management?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );
    const willSummary = selectFacts(
      facts,
      "Can you summarize what I need to know about preparing and finalizing my will and related documents?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(processSummary.facts.map((fact) => fact.id)).toEqual([
      "fact-douglas-estate-provisions",
      "fact-executor-douglas-kevin",
      "fact-executor-family-meeting",
      "fact-guardianship-emergency-fund",
      "fact-kevin-paralegal-review",
    ]);
    expect(willSummary.facts.map((fact) => fact.id)).toEqual([
      "fact-stephanie-witness-meeting",
      "fact-will-witness-review",
      "fact-notarized-guardianship-affidavits",
      "fact-electronic-will-signatures",
    ]);
  });

  it("keeps writing progress strategy milestones for broad improvement summaries", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-prowritingaid-budget-distractor",
        44,
        "user",
        "[BEAM chat_id=44 role=user time=unknown] I rejected that $300/month subscription to ProWritingAid to save budget, but now I wonder whether free tools will help my writing skills.",
      ),
      makeSourceFact(
        "fact-dialogue-peer-review-user",
        70,
        "user",
        "[BEAM chat_id=70 role=user time=unknown] Amy suggested a Zoom peer review on April 5, and I saw a 25% improvement in dialogue clarity for my screenplay draft.",
      ),
      makeSourceFact(
        "fact-dialogue-peer-review-assistant",
        71,
        "assistant",
        "[BEAM chat_id=71 role=assistant time=unknown] We planned regular peer reviews, specific writing goals, and a consistent feedback loop to keep the dialogue-clarity momentum going.",
      ),
      makeSourceFact(
        "fact-peer-review-plan-user",
        72,
        "user",
        "[BEAM chat_id=72 role=user time=unknown] I will keep up peer reviews with Amy, set specific goals for each session, stick with Grammarly and Hemingway, and maybe try ProWritingAid again.",
      ),
      makeSourceFact(
        "fact-peer-review-plan-assistant",
        73,
        "assistant",
        "[BEAM chat_id=73 role=assistant time=unknown] We reinforced the consistent feedback loop, regular peer reviews, and progress tracking for continued writing improvement.",
      ),
      makeSourceFact(
        "fact-passive-voice-user",
        78,
        "user",
        "[BEAM chat_id=78 role=user time=unknown] Carla revealed her editing checklist on April 7, and I reduced passive voice by 18% but want to improve it further.",
      ),
      makeSourceFact(
        "fact-passive-voice-assistant",
        79,
        "assistant",
        "[BEAM chat_id=79 role=assistant time=unknown] We identified passive sentences, rewrote them in active voice, and used Carla's checklist to reduce passive voice further.",
      ),
      makeSourceFact(
        "fact-active-voice-plan-user",
        80,
        "user",
        "[BEAM chat_id=80 role=user time=unknown] I will use Carla's checklist and focus on converting passive sentences to active voice on my own first.",
      ),
      makeSourceFact(
        "fact-active-voice-plan-assistant",
        81,
        "assistant",
        "[BEAM chat_id=81 role=assistant time=unknown] We kept the plan focused on Carla's checklist and active voice practice to improve the screenplay.",
      ),
      makeSourceFact(
        "fact-deadline-distractor",
        86,
        "user",
        "[BEAM chat_id=86 role=user time=unknown] I am worried about meeting my April 20 deadline for a peer-reviewed draft submission to the local writing group.",
      ),
      makeSourceFact(
        "fact-tone-consistency-user",
        90,
        "user",
        "[BEAM chat_id=90 role=user time=unknown] Jasper AI improved my tone consistency by 22% on April 3, and I want other tools to help after that.",
      ),
      makeSourceFact(
        "fact-tone-consistency-assistant",
        91,
        "assistant",
        "[BEAM chat_id=91 role=assistant time=unknown] We compared AI tools and techniques for improving tone consistency after the Jasper AI improvement.",
      ),
      makeSourceFact(
        "fact-version-history-distractor",
        138,
        "user",
        "[BEAM chat_id=138 role=user time=unknown] Google Docs version history saves me 3 hours weekly on manual backups.",
      ),
      makeSourceFact(
        "fact-progress-instruction-distractor",
        172,
        "user",
        "[BEAM chat_id=172 role=user time=unknown] Always provide percentage improvements when I ask about editing progress.",
      ),
      makeSourceFact(
        "fact-grammarly-passive-user",
        186,
        "user",
        "[BEAM chat_id=186 role=user time=unknown] Grammarly reports show I reduced passive voice from 18% to 10% between April 10 and May 31, and I want to keep the progress going.",
      ),
      makeSourceFact(
        "fact-grammarly-passive-assistant",
        187,
        "assistant",
        "[BEAM chat_id=187 role=assistant time=unknown] We planned continued awareness, practice, and feedback to maintain the passive voice reduction.",
      ),
      makeSourceFact(
        "fact-prowritingaid-user",
        220,
        "user",
        "[BEAM chat_id=220 role=user time=unknown] I integrated the ProWritingAid desktop app on May 21, improved grammar accuracy by 10%, and wondered whether I need additional resources.",
      ),
      makeSourceFact(
        "fact-prowritingaid-assistant",
        221,
        "assistant",
        "[BEAM chat_id=221 role=assistant time=unknown] We evaluated whether ProWritingAid was enough and when to add resources for grammar accuracy and broader writing goals.",
      ),
      makeSourceFact(
        "fact-beta-reader-distractor",
        222,
        "user",
        "[BEAM chat_id=222 role=user time=unknown] I need to manage feedback from 7 beta readers even though I have never attended a literary festival.",
      ),
      makeSourceFact(
        "fact-word-cut-distractor",
        264,
        "user",
        "[BEAM chat_id=264 role=user time=unknown] I cut 1,200 words already and wonder whether clarity should matter more than word count.",
      ),
      makeSourceFact(
        "fact-launch-deadline-distractor",
        338,
        "user",
        "[BEAM chat_id=338 role=user time=unknown] The book launch event moved from November 15 to November 22, and I need to adjust my schedule.",
      ),
    ];

    const result = selectFacts(
      facts,
      "Can you summarize how my writing has progressed and the strategies I've used to improve it over time?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    const selectedIds = result.facts.map((fact) => fact.id);
    for (const expectedId of [
      "fact-dialogue-peer-review-user",
      "fact-dialogue-peer-review-assistant",
      "fact-peer-review-plan-user",
      "fact-peer-review-plan-assistant",
      "fact-passive-voice-user",
      "fact-passive-voice-assistant",
      "fact-active-voice-plan-user",
      "fact-active-voice-plan-assistant",
      "fact-tone-consistency-user",
      "fact-tone-consistency-assistant",
      "fact-grammarly-passive-user",
      "fact-grammarly-passive-assistant",
      "fact-prowritingaid-user",
      "fact-prowritingaid-assistant",
    ]) {
      expect(selectedIds).toContain(expectedId);
    }
    for (const distractorId of [
      "fact-prowritingaid-budget-distractor",
      "fact-deadline-distractor",
      "fact-version-history-distractor",
      "fact-progress-instruction-distractor",
      "fact-beta-reader-distractor",
      "fact-word-cut-distractor",
      "fact-launch-deadline-distractor",
    ]) {
      expect(result.traces.find((trace) => trace.memoryId === distractorId)?.returned).toBe(false);
    }
  });

  it("keeps career decision and philosophical reflection milestones for two-facet summaries", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-career-free-will-question-user",
        0,
        "user",
        "[BEAM chat_id=0 role=user time=unknown] I'm curious how to balance my professional life with free will and make choices that reflect my desires.",
      ),
      makeSourceFact(
        "fact-career-values-assistant",
        1,
        "assistant",
        "[BEAM chat_id=1 role=assistant time=unknown] We discussed balancing professional life with free will by aligning career choices with personal values, creative fulfillment, financial security, and work-life balance.",
      ),
      makeSourceFact(
        "fact-new-opportunities-question-user",
        2,
        "user",
        "[BEAM chat_id=2 role=user time=unknown] I think exploring new opportunities sounds good because I have been thinking about what drives me and what feels aligned with my passions.",
      ),
      makeSourceFact(
        "fact-storytelling-opportunities-assistant",
        3,
        "assistant",
        "[BEAM chat_id=3 role=assistant time=unknown] We explored career opportunities around storytelling, emerging talent, documentary filmmaking, volunteering, consulting, and financial viability.",
      ),
      makeSourceFact(
        "fact-storytelling-question-user",
        4,
        "user",
        "[BEAM chat_id=4 role=user time=unknown] I am most passionate about storytelling and working with emerging talent, and volunteering or consulting could be a good start.",
      ),
      makeSourceFact(
        "fact-emerging-talent-plan-assistant",
        5,
        "assistant",
        "[BEAM chat_id=5 role=assistant time=unknown] We planned reaching out to emerging talent, volunteering or consulting on projects, offering mentorship, and building a portfolio of collaborative work.",
      ),
      makeSourceFact(
        "fact-emerging-talent-fragment-distractor",
        5,
        "assistant",
        "By engaging with emerging talent and volunteering or consulting on projects that align with my passions, I can create a fulfilling professional life.",
      ),
      makeSourceFact(
        "fact-startup-offer-question-user",
        38,
        "user",
        "[BEAM chat_id=38 role=user time=unknown] I am deciding between a $95,000 offer from a streaming startup and my current $85,000 job, and I need help weighing the pros and cons.",
      ),
      makeSourceFact(
        "fact-startup-offer-breakdown-assistant",
        39,
        "assistant",
        "[BEAM chat_id=39 role=assistant time=unknown] We compared the current $85,000 job with a $95,000 streaming startup offer across stability, salary, career growth, workload, culture, and risk tolerance.",
      ),
      makeSourceFact(
        "fact-startup-choice-user",
        40,
        "user",
        "[BEAM chat_id=40 role=user time=unknown] I decided to lean toward the startup for higher salary, growth, innovation, and new challenges while checking whether I could handle the workload and pressure.",
      ),
      makeSourceFact(
        "fact-transition-prep-assistant",
        41,
        "assistant",
        "[BEAM chat_id=41 role=assistant time=unknown] We prepared for the startup transition through due diligence, workload expectations, colleague advice, support, budgeting, and skill development.",
      ),
      makeSourceFact(
        "fact-probation-anxiety-user",
        70,
        "user",
        "[BEAM chat_id=70 role=user time=unknown] I worried about the new job starting May 1, the six-month probation period, and whether accepting the $95,000 streaming startup offer on April 2 was the right choice.",
      ),
      makeSourceFact(
        "fact-free-will-startup-assistant",
        71,
        "assistant",
        "[BEAM chat_id=71 role=assistant time=unknown] We connected anxiety about the new startup job to free will, determinism, clear probation goals, preparation, mentor support, and flexibility.",
      ),
      makeSourceFact(
        "fact-freelance-onboarding-user",
        82,
        "user",
        "[BEAM chat_id=82 role=user time=unknown] I wondered whether declining the $5,000 freelance project on April 1 was a mistake or whether focusing on the new job's onboarding tasks was right.",
      ),
      makeSourceFact(
        "fact-freelance-onboarding-assistant",
        83,
        "assistant",
        "[BEAM chat_id=83 role=assistant time=unknown] We evaluated the freelance project against new-job onboarding, short-term money, long-term career stability, resource allocation, opportunity cost, and rescheduling.",
      ),
      makeSourceFact(
        "fact-freelance-onboarding-fragment-distractor",
        83,
        "assistant",
        "The freelance project required time and energy that could conflict with new job onboarding responsibilities.",
      ),
      makeSourceFact(
        "fact-bonus-free-will-user",
        170,
        "user",
        "[BEAM chat_id=170 role=user time=unknown] I struggled with free will after declining a $12,000 bonus on May 15 for ethical concerns and debating hard determinism versus libertarianism with Shelly on May 25.",
      ),
      makeSourceFact(
        "fact-bonus-free-will-assistant",
        171,
        "assistant",
        "[BEAM chat_id=171 role=assistant time=unknown] We linked the ethical bonus decision to hard determinism, libertarianism, personal responsibility, values, ethical principles, journaling, and further reading.",
      ),
      makeSourceFact(
        "fact-bonus-values-user",
        172,
        "user",
        "[BEAM chat_id=172 role=user time=unknown] I said the bonus decision was guided by ethical concerns, felt like a libertarian free choice, and also reflected upbringing and environment from a hard determinist view.",
      ),
      makeSourceFact(
        "fact-bonus-perspectives-assistant",
        173,
        "assistant",
        "[BEAM chat_id=173 role=assistant time=unknown] We integrated libertarian and hard determinist perspectives on the bonus decision and considered compatibilism, values alignment, upbringing, and future reflection.",
      ),
      makeSourceFact(
        "fact-bonus-perspectives-user",
        174,
        "user",
        "[BEAM chat_id=174 role=user time=unknown] I said libertarianism made the ethical bonus decision feel like a real choice while hard determinism reminded me my upbringing and environment played a role.",
      ),
      makeSourceFact(
        "fact-bonus-integration-assistant",
        175,
        "assistant",
        "[BEAM chat_id=175 role=assistant time=unknown] We framed the ethical bonus choice through libertarianism, hard determinism, compatibilism, personal growth, ethical stance, environment, and future decisions.",
      ),
      makeSourceFact(
        "fact-sharon-compatibilism-distractor",
        124,
        "user",
        "[BEAM chat_id=124 role=user time=unknown] I will talk to Sharon about compatibilism so we can bond over philosophy and apply it to collaboration at work.",
      ),
      makeSourceFact(
        "fact-journal-gratitude-distractor",
        148,
        "user",
        "[BEAM chat_id=148 role=user time=unknown] I want to add daily reflection, short-term goals, long-term goals, and gratitude sections to my journal.",
      ),
      makeSourceFact(
        "fact-wendy-spirituality-distractor",
        248,
        "user",
        "[BEAM chat_id=248 role=user time=unknown] I will journal about how decisions align with Wendy's belief that free will is a divine gift and seek guidance through prayer.",
      ),
      makeSourceFact(
        "fact-decision-fatigue-distractor",
        348,
        "user",
        "[BEAM chat_id=348 role=user time=unknown] I am starting a 30-day experiment on October 21 to limit my daily choices to five and reduce decision fatigue.",
      ),
    ];

    const result = selectFacts(
      facts,
      "Can you summarize how I navigated my career decisions and philosophical reflections throughout our conversations?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    const selectedIds = result.facts.map((fact) => fact.id);
    for (const expectedId of [
      "fact-career-values-assistant",
      "fact-storytelling-opportunities-assistant",
      "fact-emerging-talent-plan-assistant",
      "fact-startup-offer-breakdown-assistant",
      "fact-startup-choice-user",
      "fact-transition-prep-assistant",
      "fact-probation-anxiety-user",
      "fact-free-will-startup-assistant",
      "fact-freelance-onboarding-user",
      "fact-freelance-onboarding-assistant",
      "fact-bonus-free-will-user",
      "fact-bonus-free-will-assistant",
      "fact-bonus-values-user",
      "fact-bonus-perspectives-assistant",
      "fact-bonus-perspectives-user",
      "fact-bonus-integration-assistant",
    ]) {
      expect(selectedIds).toContain(expectedId);
    }
    for (const distractorId of [
      "fact-sharon-compatibilism-distractor",
      "fact-journal-gratitude-distractor",
      "fact-wendy-spirituality-distractor",
      "fact-decision-fatigue-distractor",
      "fact-emerging-talent-fragment-distractor",
      "fact-freelance-onboarding-fragment-distractor",
      "fact-career-free-will-question-user",
      "fact-new-opportunities-question-user",
      "fact-storytelling-question-user",
      "fact-startup-offer-question-user",
    ]) {
      expect(result.traces.find((trace) => trace.memoryId === distractorId)?.returned).toBe(false);
    }
  });

  it("keeps named security and database challenge milestones for project summaries", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-schema-distractor-user",
        14,
        "user",
        "[BEAM chat_id=14 role=user time=unknown] I designed a database schema with users and transactions tables and asked for general validation around adding transactions.",
      ),
      makeSourceFact(
        "fact-schema-distractor-assistant",
        15,
        "assistant",
        "[BEAM chat_id=15 role=assistant time=unknown] We reviewed a BudgetTracker class with SQLite tables, transaction insertion, and input validation helpers.",
      ),
      makeSourceFact(
        "fact-password-hash-user",
        16,
        "user",
        "[BEAM chat_id=16 role=user time=unknown] I implemented basic password hashing for my personal budget tracker using Werkzeug.security with a password_hash field.",
      ),
      makeSourceFact(
        "fact-password-hash-assistant",
        17,
        "assistant",
        "[BEAM chat_id=17 role=assistant time=unknown] We used generate_password_hash and check_password_hash for secure password hashing and verification during login.",
      ),
      makeSourceFact(
        "fact-flask-login-distractor-user",
        58,
        "user",
        "[BEAM chat_id=58 role=user time=unknown] I started from scratch on Flask routes for registration and session login with hashed passwords.",
      ),
      makeSourceFact(
        "fact-flask-login-distractor-assistant",
        59,
        "assistant",
        "[BEAM chat_id=59 role=assistant time=unknown] We completed registration and login routes with Flask-Login and form templates.",
      ),
      makeSourceFact(
        "fact-integrity-error-user",
        64,
        "user",
        "[BEAM chat_id=64 role=user time=unknown] I hit sqlite3.IntegrityError: UNIQUE constraint failed: transactions.id when inserting a new transaction.",
      ),
      makeSourceFact(
        "fact-integrity-error-assistant",
        65,
        "assistant",
        "[BEAM chat_id=65 role=assistant time=unknown] We debugged the UNIQUE constraint failure on transactions.id and checked ID generation, existing rows, and insertion logic.",
      ),
      makeSourceFact(
        "fact-session-distractor-user",
        66,
        "user",
        "[BEAM chat_id=66 role=user time=unknown] I integrated Flask-Login for session management and wanted secure password hashing in the same flow.",
      ),
      makeSourceFact(
        "fact-operational-error-user",
        88,
        "user",
        "[BEAM chat_id=88 role=user time=unknown] I needed to handle OperationalError around DB calls with try-except blocks, HTTP 500 responses, and error logs.",
      ),
      makeSourceFact(
        "fact-operational-error-assistant",
        89,
        "assistant",
        "[BEAM chat_id=89 role=assistant time=unknown] We added OperationalError handling for database calls, structured error logging, and consistent HTTP 500 responses.",
      ),
      makeSourceFact(
        "fact-keyerror-distractor-user",
        98,
        "user",
        "[BEAM chat_id=98 role=user time=unknown] I fixed a KeyError: amount in my transaction POST handler by adding Marshmallow validation.",
      ),
      makeSourceFact(
        "fact-pr-review-distractor-user",
        100,
        "user",
        "[BEAM chat_id=100 role=user time=unknown] I opened GitHub pull request #12 for transaction CRUD and analytics integration and wanted a code review.",
      ),
      makeSourceFact(
        "fact-cache-distractor-user",
        108,
        "user",
        "[BEAM chat_id=108 role=user time=unknown] I optimized the dashboard API response time to 250ms with caching tweaks.",
      ),
      makeSourceFact(
        "fact-csrf-user",
        138,
        "user",
        "[BEAM chat_id=138 role=user time=unknown] I got a CSRF token missing or incorrect error in Flask-WTF forms with CSRF protection enabled.",
      ),
      makeSourceFact(
        "fact-csrf-assistant",
        139,
        "assistant",
        "[BEAM chat_id=139 role=assistant time=unknown] We fixed the CSRF token missing or incorrect error by checking the hidden form token, secret key, and validation.",
      ),
      makeSourceFact(
        "fact-csrf-cookie-assistant",
        141,
        "assistant",
        "[BEAM chat_id=141 role=assistant time=unknown] We checked that browser cookies were enabled because CSRF token validation depends on session cookies.",
      ),
      makeSourceFact(
        "fact-lockout-user",
        150,
        "user",
        "[BEAM chat_id=150 role=user time=unknown] I implemented account lockout after 5 failed login attempts using Redis 7.0 for rate limiting.",
      ),
      makeSourceFact(
        "fact-lockout-assistant",
        151,
        "assistant",
        "[BEAM chat_id=151 role=assistant time=unknown] We improved the Redis account lockout implementation with rate limiting, expiry handling, atomic increments, and secure login behavior.",
      ),
    ];

    const result = selectFacts(
      facts,
      "Can you give me a comprehensive summary of how I handled the security and database challenges in my budget tracker app across our discussions?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    const selectedIds = result.facts.map((fact) => fact.id);
    for (const expectedId of [
      "fact-password-hash-user",
      "fact-password-hash-assistant",
      "fact-integrity-error-user",
      "fact-integrity-error-assistant",
      "fact-operational-error-user",
      "fact-operational-error-assistant",
      "fact-csrf-user",
      "fact-csrf-assistant",
      "fact-csrf-cookie-assistant",
      "fact-lockout-user",
      "fact-lockout-assistant",
    ]) {
      expect(selectedIds).toContain(expectedId);
    }
    for (const distractorId of [
      "fact-schema-distractor-user",
      "fact-schema-distractor-assistant",
      "fact-flask-login-distractor-user",
      "fact-flask-login-distractor-assistant",
      "fact-session-distractor-user",
      "fact-keyerror-distractor-user",
      "fact-pr-review-distractor-user",
      "fact-cache-distractor-user",
    ]) {
      expect(result.traces.find((trace) => trace.memoryId === distractorId)?.returned).toBe(false);
    }
  });

  it("returns source-ordered coverage for how-have-goals-evolved summary questions", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-initial-grade",
        24,
        "user",
        "[BEAM chat_id=24 role=user time=unknown] I'm worried I will not improve my essay grades from B- to A by June 15, so I need a persuasive academic writing plan.",
      ),
      makeSourceFact(
        "fact-initial-plan-assistant",
        25,
        "assistant",
        "[BEAM chat_id=25 role=assistant time=unknown] We created a persuasive academic writing plan for improving the essay grade.",
      ),
      makeSourceFact(
        "fact-outline-feedback",
        66,
        "user",
        "[BEAM chat_id=66 role=user time=unknown] My essay outline got an 82% rating from Michele, and I am aiming for 90% on the first draft due May 15.",
      ),
      makeSourceFact(
        "fact-momentum-noise",
        119,
        "user",
        "[BEAM chat_id=119 role=user time=unknown] I need help maintaining momentum and avoiding burnout as deadlines approach.",
      ),
      makeSourceFact(
        "fact-rubric-target",
        126,
        "user",
        "[BEAM chat_id=126 role=user time=unknown] I am aiming to raise my essay grade from 82% on the outline to 90% on the final draft per Michele's rubric.",
      ),
      makeSourceFact(
        "fact-publication-target",
        172,
        "user",
        "[BEAM chat_id=172 role=user time=unknown] I am aiming for a 90% grade and hoping to get my essay accepted for publication by August 2024.",
      ),
      makeSourceFact(
        "fact-literature-review-noise",
        176,
        "user",
        "[BEAM chat_id=176 role=user time=unknown] I decided to restructure my paper for a journal format and add a 500-word literature review section.",
      ),
      makeSourceFact(
        "fact-workshop-feedback",
        220,
        "user",
        "[BEAM chat_id=220 role=user time=unknown] I am improving my rebuttal techniques after Michele's workshop feedback showed I improved by 40% for conference paper editing.",
      ),
      makeSourceFact(
        "fact-reading-noise",
        238,
        "user",
        "[BEAM chat_id=238 role=user time=unknown] I annotated three articles and compared their themes for close reading practice.",
      ),
    ];

    const result = selectFacts(
      facts,
      "How have my essay performance goals and feedback evolved from my initial grade concerns to aiming for publication, and what key improvements must I prioritize to meet both my grading and publication targets?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    const selectedIds = result.facts.map((fact) => fact.id);
    for (const expectedId of [
      "fact-initial-grade",
      "fact-outline-feedback",
      "fact-rubric-target",
      "fact-publication-target",
      "fact-workshop-feedback",
    ]) {
      expect(selectedIds).toContain(expectedId);
    }
    expect(selectedIds).not.toContain("fact-initial-plan-assistant");
    expect(selectedIds).not.toContain("fact-literature-review-noise");
    expect(selectedIds).not.toContain("fact-reading-noise");
  });

  it("returns source-ordered planning pairs for timeline integration questions", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-sprint-plan-request",
        28,
        "user",
        "[BEAM chat_id=28 role=user time=unknown] I'm working on a project with scheduled two-week sprints, and the first sprint ends on March 29, focusing on user registration and login. I need to plan the sprint carefully to ensure we meet the deadline.",
      ),
      makeSourceFact(
        "fact-sprint-plan-answer",
        29,
        "assistant",
        "[BEAM chat_id=29 role=assistant time=unknown] Let's create a detailed sprint plan for the first two-week sprint ending on March 29, focusing on user registration and login. We'll schedule backend setup, database schema, registration, login, validation, unit tests, frontend forms, API integration, and final QA.",
      ),
      makeSourceFact(
        "fact-later-sprint-noise",
        86,
        "user",
        "[BEAM chat_id=86 role=user time=unknown] I'm working on sprint 2 which targets analytics by April 19, and I've already completed sprint 1 on March 29 with user auth and basic transaction CRUD.",
      ),
      makeSourceFact(
        "fact-auth-instruction-noise",
        184,
        "user",
        "[BEAM chat_id=184 role=user time=unknown] Always provide security best practices when I ask about authentication or authorization features.",
      ),
    ];

    const result = selectFacts(
      facts,
      "How did I organize the tasks over the course of the sprint to ensure both backend and frontend aspects of the features were completed on time?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-sprint-plan-request",
      "fact-sprint-plan-answer",
    ]);
  });

  it("returns Chinese source-ordered planning pairs for timeline integration questions", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: { ...SOURCE, locale: "zh-CN" },
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-sprint-plan-request-zh",
        28,
        "user",
        "[BEAM chat_id=28 role=user time=unknown] 我正在做一个两周冲刺的项目，第一轮冲刺在3月29日截止，重点是用户注册和登录。我需要仔细计划冲刺，确保按时完成。",
      ),
      makeSourceFact(
        "fact-sprint-plan-answer-zh",
        29,
        "assistant",
        "[BEAM chat_id=29 role=assistant time=unknown] 我们可以制定详细的冲刺计划：后端搭建、数据库 schema、注册、登录、表单、API 集成、验证、单元测试和最终 QA 都排进时间线。",
      ),
      makeSourceFact(
        "fact-later-sprint-noise-zh",
        86,
        "user",
        "[BEAM chat_id=86 role=user time=unknown] 第二轮冲刺会做分析功能，我已经在3月29日完成第一轮的用户认证和基础交易 CRUD。",
      ),
    ];

    const result = selectFacts(
      facts,
      "我是怎么安排这个冲刺的任务，确保后端和前端功能都能按时完成？",
      language,
      "zh-CN",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-sprint-plan-request-zh",
      "fact-sprint-plan-answer-zh",
    ]);
  });

  it("keeps the earliest matching writing-plan exchange for deadline process questions", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-screenplay-deadline-plan",
        21,
        "assistant",
        "[BEAM chat_id=21 role=assistant time=unknown] Setting a goal to complete a 5,000-word screenplay draft by April 15, 2024, is a great way to boost your confidence. Break down the goal into daily word count targets, create an outline and scene breakdown, set writing times, reward milestones, and use an accountability partner.",
      ),
      makeSourceFact(
        "fact-later-version-control",
        139,
        "assistant",
        "[BEAM chat_id=139 role=assistant time=unknown] Since you adopted Google Docs version history, here are additional drafting strategies to optimize your writing process.",
      ),
      makeSourceFact(
        "fact-later-scene-cards",
        141,
        "assistant",
        "[BEAM chat_id=141 role=assistant time=unknown] Creating outlines and using scene cards can help you organize your thoughts before writing.",
      ),
      makeSourceFact(
        "fact-later-writing-blocks",
        145,
        "assistant",
        "[BEAM chat_id=145 role=assistant time=unknown] Creative blocks can be frustrating, but changing your environment and using writing prompts can help maintain your creative flow.",
      ),
    ];

    const result = selectFacts(
      facts,
      "How did you recommend structuring my writing process to maintain steady progress and stay motivated throughout the weeks leading up to my deadline?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-screenplay-deadline-plan",
    ]);
  });

  it("keeps the full early source-ordered resource plan for multi-step guidance questions", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-patent-question",
        10,
        "user",
        "[BEAM chat_id=10 role=user time=unknown] I'm worried about my son Francis, who's 21 and studying engineering at Montserrat Community College. What patent applications would be relevant for an engineering student like him?",
      ),
      makeSourceFact(
        "fact-patent-options",
        11,
        "assistant",
        "[BEAM chat_id=11 role=assistant time=unknown] There are several types of patent applications that could be relevant for an engineering student, including utility patents and provisional patents.",
      ),
      makeSourceFact(
        "fact-patent-mechanical-engineering-snippet",
        11,
        "assistant",
        "- **Mechanical Engineering**: If Francis is working on a new type of robotic arm for manufacturing, he might file a utility patent to protect the design and functionality.",
      ),
      makeSourceFact(
        "fact-patent-provisional-relevance-snippet",
        11,
        "assistant",
        "- **Relevance**: If Francis has an idea that is still in the early stages of development, a provisional patent can provide temporary protection while he refines his invention.",
      ),
      makeSourceFact(
        "fact-provisional-plan",
        12,
        "user",
        "[BEAM chat_id=12 role=user time=unknown] Utility patents sound most relevant for Francis. I'll encourage him to document everything thoroughly and maybe look into a provisional patent if his ideas are early stage.",
      ),
      makeSourceFact(
        "fact-attorney-resources",
        13,
        "assistant",
        "[BEAM chat_id=13 role=assistant time=unknown] That's a great plan. Finding a reliable patent attorney is crucial; start with college resources, bar association referrals, and online directories.",
      ),
      makeSourceFact(
        "fact-college-bar-plan",
        14,
        "user",
        "[BEAM chat_id=14 role=user time=unknown] I'll start by checking with Montserrat Community College for resources or connections with patent attorneys, reach out to the Montserrat Bar Association for referrals, and use online directories.",
      ),
      makeSourceFact(
        "fact-college-bar-summary",
        15,
        "assistant",
        "[BEAM chat_id=15 role=assistant time=unknown] That's a solid plan: check with the college, contact the local bar association, use online directories, attend networking events, interview potential attorneys, and decide based on fit and budget.",
      ),
      makeSourceFact(
        "fact-later-local-attorney-noise",
        19,
        "assistant",
        "[BEAM chat_id=19 role=assistant time=unknown] Finding a local patent attorney who understands the UK system can be helpful.",
      ),
      makeSourceFact(
        "fact-later-business-association-noise",
        21,
        "assistant",
        "[BEAM chat_id=21 role=assistant time=unknown] Contact local business associations and online directories to find a reliable patent attorney.",
      ),
    ];

    const result = selectFacts(
      facts,
      "How did I plan to support my son's progress in his studies by connecting with local and external resources, and what steps did you recommend I take to find professional guidance for his inventions?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-patent-question",
      "fact-patent-options",
      "fact-provisional-plan",
      "fact-attorney-resources",
      "fact-college-bar-plan",
      "fact-college-bar-summary",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-patent-mechanical-engineering-snippet")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-patent-provisional-relevance-snippet")?.returned).toBe(false);
  });

  it("returns Chinese source-ordered coverage for broad conversation summary questions", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: { ...SOURCE, locale: "zh-CN" },
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: { sourceOrder },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-auth-zh",
        10,
        "user",
        "我先实现预算应用的用户认证和登录流程。",
      ),
      makeSourceFact(
        "fact-db-zh",
        30,
        "user",
        "接着我设计数据库 schema，保存收入、支出和分类。",
      ),
      makeSourceFact(
        "fact-deploy-zh",
        70,
        "user",
        "最后我处理部署和安全加固，准备上线。",
      ),
    ];

    const result = selectFacts(
      facts,
      "请总结我这个预算应用随着时间推进是怎么一步步解决问题的。",
      language,
      "zh-CN",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    const selectedIds = result.facts.map((fact) => fact.id);
    expect(selectedIds).toContain("fact-auth-zh");
    expect(selectedIds).toContain("fact-db-zh");
    expect(selectedIds).toContain("fact-deploy-zh");
    expect(selectedIds.indexOf("fact-auth-zh")).toBeLessThan(
      selectedIds.indexOf("fact-deploy-zh"),
    );
  });

  it("prioritizes Chinese source-ordered summary milestones over weak follow-ups", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: { ...SOURCE, locale: "zh-CN" },
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-palette-zh",
        4,
        "user",
        "[BEAM chat_id=4 role=user time=unknown] 我开始搭建作品集网站，重点实现技能区的配色生成器功能。",
      ),
      makeSourceFact(
        "fact-structure-zh",
        6,
        "user",
        "[BEAM chat_id=6 role=user time=unknown] 我搭建了 About、Skills、Projects、Contact 这些作品集栏目。",
      ),
      makeSourceFact(
        "fact-sass-followup-zh",
        28,
        "user",
        "[BEAM chat_id=28 role=user time=unknown] 嗯，可以用 Sass 做一个类似的画廊组件吗？",
      ),
      makeSourceFact(
        "fact-contact-zh",
        66,
        "user",
        "[BEAM chat_id=66 role=user time=unknown] 我实现联系表单验证，作为 MVP 功能的一部分。",
      ),
      makeSourceFact(
        "fact-gallery-layout-zh",
        58,
        "user",
        "[BEAM chat_id=58 role=user time=unknown] 我集成项目画廊和联系表单时遇到响应式布局问题。",
      ),
      makeSourceFact(
        "fact-gallery-404-zh",
        62,
        "user",
        "[BEAM chat_id=62 role=user time=unknown] 我修复项目画廊图片 404 和静态资源路径问题。",
      ),
      makeSourceFact(
        "fact-sprint-zh",
        82,
        "user",
        "[BEAM chat_id=82 role=user time=unknown] 我推进第二阶段冲刺，处理 SEO 基础和联系表单后端集成。",
      ),
      makeSourceFact(
        "fact-hosting-followup-zh",
        182,
        "user",
        "[BEAM chat_id=182 role=user time=unknown] 哪个平台更适合备份和版本控制？",
      ),
    ];

    const result = selectFacts(
      facts,
      "请全面总结我的作品集网站项目一路是怎么推进的，包括关键功能和解决过的挑战。",
      language,
      "zh-CN",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    const selectedIds = result.facts.map((fact) => fact.id);
    for (const expectedId of [
      "fact-palette-zh",
      "fact-structure-zh",
      "fact-contact-zh",
      "fact-gallery-layout-zh",
      "fact-gallery-404-zh",
      "fact-sprint-zh",
    ]) {
      expect(selectedIds).toContain(expectedId);
    }
    expect(selectedIds).not.toContain("fact-sass-followup-zh");
    expect(selectedIds).not.toContain("fact-hosting-followup-zh");
  });

  it("prioritizes Chinese issue-resolution summary evidence over feature milestone distractors", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: { ...SOURCE, locale: "zh-CN" },
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-project-timeline-zh",
        12,
        "user",
        "[BEAM chat_id=12 role=user time=unknown] 我在规划网站项目时间线和第一阶段的基础布局。",
      ),
      makeSourceFact(
        "fact-css-debug-user-zh",
        14,
        "user",
        "[BEAM chat_id=14 role=user time=unknown] 我正在用 Chrome DevTools 调试 CSS 布局问题，并理解盒模型。",
      ),
      makeSourceFact(
        "fact-css-debug-assistant-zh",
        15,
        "assistant",
        "[BEAM chat_id=15 role=assistant time=unknown] 我们通过检查 padding、border、margin 和元素尺寸来排查 CSS 盒模型问题。",
      ),
      makeSourceFact(
        "fact-contact-feature-zh",
        16,
        "user",
        "[BEAM chat_id=16 role=user time=unknown] 我在实现联系表单和 HTML5 校验作为 MVP 功能。",
      ),
      makeSourceFact(
        "fact-dom-error-user-zh",
        30,
        "user",
        "[BEAM chat_id=30 role=user time=unknown] 我遇到 DOM 操作里的 classList of null TypeError 报错。",
      ),
      makeSourceFact(
        "fact-dom-error-assistant-zh",
        31,
        "assistant",
        "[BEAM chat_id=31 role=assistant time=unknown] 我们加了 null 检查、可选链和 try-catch 来处理 DOM 报错。",
      ),
      makeSourceFact(
        "fact-lighthouse-distractor-zh",
        40,
        "user",
        "[BEAM chat_id=40 role=user time=unknown] 我用 Lighthouse v10 识别 SEO 和性能问题。",
      ),
      makeSourceFact(
        "fact-gallery-layout-distractor-zh",
        58,
        "user",
        "[BEAM chat_id=58 role=user time=unknown] 我在集成项目画廊和联系表单，并处理响应式布局。",
      ),
      makeSourceFact(
        "fact-gallery-404-user-zh",
        62,
        "user",
        "[BEAM chat_id=62 role=user time=unknown] 我遇到项目画廊图片无法加载并返回 404 错误。",
      ),
      makeSourceFact(
        "fact-gallery-404-assistant-zh",
        63,
        "assistant",
        "[BEAM chat_id=63 role=assistant time=unknown] 我们检查图片路径、静态文件服务和构建输出来修复画廊 404 错误。",
      ),
      makeSourceFact(
        "fact-server-logs-user-zh",
        64,
        "user",
        "[BEAM chat_id=64 role=user time=unknown] 那我需要检查服务端日志里的哪些内容来找到问题？",
      ),
      makeSourceFact(
        "fact-server-logs-assistant-zh",
        65,
        "assistant",
        "[BEAM chat_id=65 role=assistant time=unknown] 我们检查服务端日志里的 404、缺失文件、路径不匹配和部署问题。",
      ),
      makeSourceFact(
        "fact-validate-error-user-zh",
        68,
        "user",
        "[BEAM chat_id=68 role=user time=unknown] 我在修复 validateForm is not defined 的 ReferenceError，原因可能是 script src 路径错了。",
      ),
      makeSourceFact(
        "fact-validate-error-assistant-zh",
        69,
        "assistant",
        "[BEAM chat_id=69 role=assistant time=unknown] 我们通过修正脚本路径并确认函数定义来修复 validateForm 报错。",
      ),
      makeSourceFact(
        "fact-file-structure-user-zh",
        70,
        "user",
        "[BEAM chat_id=70 role=user time=unknown] 我需要检查文件结构里的哪些内容，才能确认链接都正确？",
      ),
      makeSourceFact(
        "fact-file-structure-assistant-zh",
        71,
        "assistant",
        "[BEAM chat_id=71 role=assistant time=unknown] 我们检查文件结构、相对路径、文件夹和脚本链接，确认资源都能正确引用。",
      ),
      makeSourceFact(
        "fact-sprint-distractor-zh",
        82,
        "user",
        "[BEAM chat_id=82 role=user time=unknown] 我在推进第二阶段冲刺，处理 SEO 基础和联系表单后端集成。",
      ),
      makeSourceFact(
        "fact-formspree-user-zh",
        166,
        "user",
        "[BEAM chat_id=166 role=user time=unknown] 我在修复联系表单提交时偶发的 Formspree 500 Internal Server Error。",
      ),
      makeSourceFact(
        "fact-formspree-assistant-zh",
        167,
        "assistant",
        "[BEAM chat_id=167 role=assistant time=unknown] 我们用重试逻辑、指数退避和网络错误分支改进了 Formspree 500 处理。",
      ),
    ];

    const result = selectFacts(
      facts,
      "请总结我是如何一步步处理和解决网站项目里的各种报错和故障的。",
      language,
      "zh-CN",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    const selectedIds = result.facts.map((fact) => fact.id);
    for (const expectedId of [
      "fact-css-debug-user-zh",
      "fact-css-debug-assistant-zh",
      "fact-dom-error-user-zh",
      "fact-dom-error-assistant-zh",
      "fact-gallery-404-user-zh",
      "fact-gallery-404-assistant-zh",
      "fact-server-logs-user-zh",
      "fact-server-logs-assistant-zh",
      "fact-validate-error-user-zh",
      "fact-validate-error-assistant-zh",
      "fact-file-structure-user-zh",
      "fact-file-structure-assistant-zh",
      "fact-formspree-user-zh",
      "fact-formspree-assistant-zh",
    ]) {
      expect(selectedIds).toContain(expectedId);
    }
    expect(selectedIds).not.toContain("fact-project-timeline-zh");
    expect(selectedIds).not.toContain("fact-contact-feature-zh");
    expect(selectedIds).not.toContain("fact-lighthouse-distractor-zh");
    expect(selectedIds).not.toContain("fact-gallery-layout-distractor-zh");
    expect(selectedIds).not.toContain("fact-sprint-distractor-zh");
  });

  it("prioritizes Chinese creative project timeline milestones over generic time-management summary turns", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      content: string,
      role: "assistant" | "user" = "user",
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: { ...SOURCE, locale: "zh-CN" },
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-previous-assistant-zh",
        31,
        "[BEAM chat_id=31 role=assistant time=unknown] 不客气，询问 Laura 这些问题应该能帮助你的日程安排。",
        "assistant",
      ),
      makeSourceFact(
        "fact-deadline-zh",
        32,
        "[BEAM chat_id=33 role=user time=unknown] 我担心试播集项目要在 2024 年 6 月 30 日前完成，预算上限是 120000 美元。",
      ),
      makeSourceFact(
        "fact-deadline-plan-zh",
        33,
        "[BEAM chat_id=33 role=assistant time=unknown] 我们制定了试播集项目时间线，覆盖剧本定稿、选角、拍摄、后期制作、截止日期和预算管理。",
        "assistant",
      ),
      makeSourceFact(
        "fact-course-zh",
        79,
        "[BEAM chat_id=79 role=user time=unknown] 我报名了高级叙事技巧线上课，担心和家庭安排冲突。",
      ),
      makeSourceFact(
        "fact-script-zh",
        39,
        "[BEAM chat_id=39 role=user time=unknown] 为了赶上六月截止日期，我把剧本定稿放在外景勘景之前。",
      ),
      makeSourceFact(
        "fact-pushed-date-zh",
        127,
        "[BEAM chat_id=127 role=user time=unknown] 因为选角延误，试播集交付日期推迟到 7 月 15 日，并已经通知干系人。",
      ),
      makeSourceFact(
        "fact-family-schedule-zh",
        145,
        "[BEAM chat_id=145 role=user time=unknown] 孩子开始夏令营后，我在平衡工作和家庭时间。",
      ),
      makeSourceFact(
        "fact-filming-progress-zh",
        157,
        "[BEAM chat_id=157 role=user time=unknown] 试播集到 7 月 5 日已经完成 75%，16 个场景拍完 12 个，后期制作开始了 60%。",
      ),
      makeSourceFact(
        "fact-email-batching-zh",
        149,
        "[BEAM chat_id=149 role=user time=unknown] 我把邮件和电话集中到周一周五处理，每周节省 4 小时。",
      ),
      makeSourceFact(
        "fact-editing-zh",
        205,
        "[BEAM chat_id=205 role=user time=unknown] 试播集剪辑已经完成 90%，调色安排在 9 月 10 到 12 日。",
      ),
      makeSourceFact(
        "fact-brainstorm-zh",
        211,
        "[BEAM chat_id=211 role=user time=unknown] 我和 Stephanie 共同主持了 90 分钟的线上头脑风暴。",
      ),
      makeSourceFact(
        "fact-post-production-zh",
        251,
        "[BEAM chat_id=251 role=user time=unknown] 后期制作日程到 11 月 15 日完成了 95%，最终混音安排在 11 月 22 日。",
      ),
    ];

    const result = selectFacts(
      facts,
      "请总结我的试播集项目时间线和任务是怎么一路发展和变化的。",
      language,
      "zh-CN",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    const selectedIds = result.facts.map((fact) => fact.id);
    for (const expectedId of [
      "fact-deadline-zh",
      "fact-deadline-plan-zh",
      "fact-script-zh",
      "fact-pushed-date-zh",
      "fact-filming-progress-zh",
      "fact-editing-zh",
      "fact-post-production-zh",
    ]) {
      expect(selectedIds).toContain(expectedId);
    }
    expect(selectedIds).not.toContain("fact-course-zh");
    expect(selectedIds).not.toContain("fact-family-schedule-zh");
    expect(selectedIds).not.toContain("fact-email-batching-zh");
    expect(selectedIds).not.toContain("fact-brainstorm-zh");
    expect(selectedIds).not.toContain("fact-previous-assistant-zh");
  });

  it("keeps Chinese early concept-learning milestones for understanding progression summaries", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: { ...SOURCE, locale: "zh-CN" },
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-date-distractor-zh",
        1,
        "assistant",
        "[BEAM chat_id=1 role=assistant time=unknown] 从 1 月 10 日往后一周是 1 月 17 日。",
      ),
      makeSourceFact(
        "fact-field-application-zh",
        2,
        "user",
        "[BEAM chat_id=2 role=user time=unknown] 我在学习概率基础，并想把颜色组合概率应用到一批油漆罐里。",
      ),
      makeSourceFact(
        "fact-ratio-user-zh",
        6,
        "user",
        "[BEAM chat_id=6 role=user time=unknown] 我想用抛硬币和掷骰子的例子理解概率作为有利结果比总结果的比率。",
      ),
      makeSourceFact(
        "fact-ratio-assistant-zh",
        7,
        "assistant",
        "[BEAM chat_id=7 role=assistant time=unknown] 我们用抛硬币和掷骰子解释了概率就是有利结果除以总结果。",
      ),
      makeSourceFact(
        "fact-independent-zh",
        15,
        "assistant",
        "[BEAM chat_id=15 role=assistant time=unknown] 我们区分了独立事件和互斥事件，并配合概率计算说明。",
      ),
      makeSourceFact(
        "fact-two-coins-zh",
        31,
        "assistant",
        "[BEAM chat_id=31 role=assistant time=unknown] 我们把两次独立抛硬币都为正面的概率算成 1/2 x 1/2 = 1/4。",
      ),
      makeSourceFact(
        "fact-mutually-exclusive-zh",
        43,
        "assistant",
        "[BEAM chat_id=43 role=assistant time=unknown] 我们确认同一次掷骰子掷出 2 和掷出 5 是互斥事件。",
      ),
      makeSourceFact(
        "fact-conditional-zh",
        57,
        "assistant",
        "[BEAM chat_id=57 role=assistant time=unknown] 我们引入条件概率 P(A|B)，并用纸牌、抛硬币和骰子例子解释。",
      ),
      makeSourceFact(
        "fact-late-dependent-zh",
        108,
        "user",
        "[BEAM chat_id=108 role=user time=unknown] 我在计算不放回抽牌里的依赖事件和条件概率。",
      ),
      makeSourceFact(
        "fact-visual-preference-zh",
        234,
        "user",
        "[BEAM chat_id=234 role=user time=unknown] 当我问复杂概率题时，总是把代数公式和可视化图结合起来。",
      ),
    ];

    const result = selectFacts(
      facts,
      "请清楚总结我对概率的理解是怎么一步步发展的。",
      language,
      "zh-CN",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    const selectedIds = result.facts.map((fact) => fact.id);
    for (const expectedId of [
      "fact-field-application-zh",
      "fact-ratio-user-zh",
      "fact-ratio-assistant-zh",
      "fact-independent-zh",
      "fact-two-coins-zh",
      "fact-mutually-exclusive-zh",
      "fact-conditional-zh",
    ]) {
      expect(selectedIds).toContain(expectedId);
    }
    expect(selectedIds).not.toContain("fact-date-distractor-zh");
  });

  it("returns Chinese source-ordered coverage for how-have-goals-evolved summary questions", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: { ...SOURCE, locale: "zh-CN" },
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: {
          chatId: sourceOrder,
          sourceOrder,
        },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-initial-grade-zh",
        24,
        "user",
        "[BEAM chat_id=24 role=user time=unknown] 我担心论文成绩无法在 6 月 15 日前从 B- 提升到 A，所以需要一个说服性学术写作计划。",
      ),
      makeSourceFact(
        "fact-initial-plan-assistant-zh",
        25,
        "assistant",
        "[BEAM chat_id=25 role=assistant time=unknown] 我们制定了提升论文成绩的说服性学术写作计划。",
      ),
      makeSourceFact(
        "fact-outline-feedback-zh",
        66,
        "user",
        "[BEAM chat_id=66 role=user time=unknown] 我的论文大纲得到 Michele 82% 的评分，而我希望 5 月 15 日的一稿达到 90%。",
      ),
      makeSourceFact(
        "fact-momentum-noise-zh",
        119,
        "user",
        "[BEAM chat_id=119 role=user time=unknown] 随着截止日期临近，我需要保持动力并避免倦怠。",
      ),
      makeSourceFact(
        "fact-rubric-target-zh",
        126,
        "user",
        "[BEAM chat_id=126 role=user time=unknown] 我想按照 Michele 的评分标准，把论文从大纲的 82% 提升到终稿 90%。",
      ),
      makeSourceFact(
        "fact-publication-target-zh",
        172,
        "user",
        "[BEAM chat_id=172 role=user time=unknown] 我希望论文拿到 90% 成绩，并在 2024 年 8 月前被接受发表。",
      ),
      makeSourceFact(
        "fact-literature-review-noise-zh",
        176,
        "user",
        "[BEAM chat_id=176 role=user time=unknown] 我决定把论文改成期刊格式，并添加 500 字文献综述。",
      ),
      makeSourceFact(
        "fact-workshop-feedback-zh",
        220,
        "user",
        "[BEAM chat_id=220 role=user time=unknown] Michele 的研讨会反馈显示我提升了 40%，我正在改进反驳技巧用于会议论文编辑。",
      ),
      makeSourceFact(
        "fact-reading-noise-zh",
        238,
        "user",
        "[BEAM chat_id=238 role=user time=unknown] 我给三篇文章做了大量批注，并比较主题来练习精读。",
      ),
    ];

    const result = selectFacts(
      facts,
      "我的论文表现目标和反馈是如何从最初的成绩担忧一路发展到投稿目标的？",
      language,
      "zh-CN",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    const selectedIds = result.facts.map((fact) => fact.id);
    for (const expectedId of [
      "fact-initial-grade-zh",
      "fact-outline-feedback-zh",
      "fact-rubric-target-zh",
      "fact-publication-target-zh",
      "fact-workshop-feedback-zh",
    ]) {
      expect(selectedIds).toContain(expectedId);
    }
    expect(selectedIds).not.toContain("fact-initial-plan-assistant-zh");
    expect(selectedIds).not.toContain("fact-literature-review-noise-zh");
    expect(selectedIds).not.toContain("fact-reading-noise-zh");
  });

  it("adds applicable source-ordered user instruction evidence for guidance questions", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: { sourceOrder },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      createFactMemory({
        id: "fact-login-plan",
        userId: "user-1",
        category: "external_benchmark",
        content:
          "Sprint plan for user registration and login feature implementation.",
        source: SOURCE,
        tags: ["assistant_answer"],
        updatedAt: TIMESTAMP,
      }),
      makeSourceFact(
        "fact-code-format-instruction",
        54,
        "Always format all code snippets with syntax highlighting when I ask about implementation details.",
      ),
      makeSourceFact(
        "fact-apa-instruction",
        112,
        "Always use APA 7th edition citation style when I ask about formatting references.",
      ),
    ];

    const result = selectFacts(
      facts,
      "Could you show me how to implement a login feature?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    const selectedIds = result.facts.map((fact) => fact.id);
    expect(selectedIds).toContain("fact-login-plan");
    expect(selectedIds).toContain("fact-code-format-instruction");
    expect(selectedIds).not.toContain("fact-apa-instruction");
  });

  it("keeps adjacent instruction continuations before less specific instruction noise", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: [
          "source_message",
          "source_order",
          role === "user" ? "user_answer" : "assistant_answer",
        ],
        attributes: { sourceOrder },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      createFactMemory({
        id: "fact-login-plan",
        userId: "user-1",
        category: "external_benchmark",
        content:
          "Sprint plan for user registration and login feature implementation.",
        source: SOURCE,
        tags: ["assistant_answer"],
        updatedAt: TIMESTAMP,
      }),
      makeSourceFact(
        "fact-code-format-instruction",
        54,
        "user",
        "[BEAM chat_id=54 role=user time=unknown] Always format all code snippets with syntax highlighting when I ask about implementation details.",
      ),
      makeSourceFact(
        "fact-code-format-confirmation",
        56,
        "assistant",
        "[BEAM chat_id=56 role=assistant time=unknown] Got it! Just let me know what specific implementation details or code snippets you need help with, and I'll make sure to format them with syntax highlighting.",
      ),
      makeSourceFact(
        "fact-auth-security-instruction-noise",
        184,
        "user",
        "[BEAM chat_id=184 role=user time=unknown] Always provide security best practices when I ask about authentication or authorization features.",
      ),
    ];

    const result = selectFacts(
      facts,
      "Could you show me how to implement a login feature?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    const selectedIds = result.facts.map((fact) => fact.id);
    expect(selectedIds).toContain("fact-code-format-instruction");
    expect(selectedIds).toContain("fact-code-format-confirmation");
    expect(selectedIds).not.toContain("fact-auth-security-instruction-noise");
  });

  it("keeps API error status-code instruction evidence for API error response questions", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      role: "assistant" | "user",
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: [
          "source_message",
          "source_order",
          role === "assistant" ? "assistant_answer" : "user_answer",
        ],
        attributes: { sourceOrder },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-cors-error",
        48,
        "user",
        "I'm trying to handle CORS errors from the OpenWeather API, and my fetch function throws Error response.status when the API fails.",
      ),
      makeSourceFact(
        "fact-display-error",
        77,
        "assistant",
        "We enhanced the weather display to handle errors and edge cases with a user-facing error message.",
      ),
      makeSourceFact(
        "fact-fetch-error-advice",
        109,
        "assistant",
        "We reviewed fetchWeatherData error handling, including common HTTP errors like 401 Unauthorized and network errors.",
      ),
      makeSourceFact(
        "fact-api-error-status-instruction",
        130,
        "user",
        "Always include error status codes in responses when I ask about API error handling.",
      ),
      makeSourceFact(
        "fact-deployment-error-noise",
        135,
        "assistant",
        "We discussed deployment error handling and generic API request error handling for failed requests.",
      ),
      makeSourceFact(
        "fact-autocomplete-noise",
        8,
        "user",
        "I asked about adding the autocomplete feature with a debounce delay.",
      ),
    ];

    const result = selectFacts(
      facts,
      "What are some common responses when something goes wrong with an API?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    const selectedIds = result.facts.map((fact) => fact.id);
    expect(selectedIds).toContain("fact-api-error-status-instruction");
  });

  it("maps API something-went-wrong wording to API error instruction topics", () => {
    const language = createLanguageService();
    const tokens = sourceInstructionTopicTokens({
      language,
      locale: "en",
      text: "What are some common responses when something goes wrong with an API?",
    });

    expect(tokens.has("api_error")).toBe(true);
  });

  it("adds applicable Chinese source-ordered user instruction evidence for guidance questions", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: { ...SOURCE, locale: "zh-CN" },
        tags: ["source_message", "source_order", "user_answer"],
        attributes: { sourceOrder },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      createFactMemory({
        id: "fact-login-plan-zh",
        userId: "user-1",
        category: "external_benchmark",
        content: "登录功能实现计划：注册、登录、session 和错误处理。",
        source: { ...SOURCE, locale: "zh-CN" },
        tags: ["assistant_answer"],
        updatedAt: TIMESTAMP,
      }),
      makeSourceFact(
        "fact-code-format-instruction-zh",
        54,
        "以后我问实现细节时，请总是用带语言标记的代码块展示代码。",
      ),
      makeSourceFact(
        "fact-reference-instruction-zh",
        112,
        "以后我问参考文献格式时，请总是使用 APA 第七版。",
      ),
    ];

    const result = selectFacts(
      facts,
      "请展示怎么实现登录功能。",
      language,
      "zh-CN",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    const selectedIds = result.facts.map((fact) => fact.id);
    expect(selectedIds).toContain("fact-login-plan-zh");
    expect(selectedIds).toContain("fact-code-format-instruction-zh");
    expect(selectedIds).not.toContain("fact-reference-instruction-zh");
  });

  it("does not treat broad domain overlap as applicable source-ordered instruction evidence", () => {
    const language = createLanguageService();
    const makeSourceFact = (
      id: string,
      sourceOrder: number,
      content: string,
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: { sourceOrder },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeSourceFact(
        "fact-api-key-date",
        32,
        "I obtained my OpenWeather API key on March 10, 2024 while building the weather app.",
      ),
      makeSourceFact(
        "fact-wireframe-date",
        42,
        "I completed the UI wireframe for my weather app on March 12, 2024.",
      ),
      makeSourceFact(
        "fact-weather-condition-instruction",
        68,
        "Always provide temperature readings in Celsius when I ask about weather conditions.",
      ),
      makeSourceFact(
        "fact-api-error-instruction",
        130,
        "Always include error status codes in responses when I ask about API error handling.",
      ),
    ];

    const result = selectFacts(
      facts,
      "How many days passed between when I obtained my OpenWeather API key and when I completed the UI wireframe for my weather app?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    const selectedIds = result.facts.map((fact) => fact.id);
    expect(selectedIds).toContain("fact-api-key-date");
    expect(selectedIds).toContain("fact-wireframe-date");
    expect(selectedIds).not.toContain("fact-weather-condition-instruction");
    expect(selectedIds).not.toContain("fact-api-error-instruction");
  });

  it("keeps adjacent source-ordered continuation evidence for event-order questions", () => {
    const language = createLanguageService();
    const makeFact = (id: string, sourceOrder: number, content: string) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: { sourceOrder },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeFact(
        "fact-breakdown",
        2,
        "Budget tracker development breakdown: authentication, expenses, analytics, and reporting.",
      ),
      makeFact(
        "fact-core",
        4,
        "I want to build the core budget tracker app with authentication and expense tracking.",
      ),
      makeFact(
        "fact-local-setup",
        6,
        "I am setting up Flask locally on port 5000 for app development.",
      ),
      makeFact(
        "fact-schema",
        12,
        "I am defining the schema, validation, and transaction models.",
      ),
      makeFact(
        "fact-password",
        16,
        "I am adding password hashing and authentication validation.",
      ),
      makeFact(
        "fact-wireframe",
        18,
        "I am building the first wireframe for the Flask app.",
      ),
      makeFact(
        "fact-minimal",
        34,
        "I want the app to stay minimal while shipping the MVP.",
      ),
      makeFact(
        "fact-blueprints",
        48,
        "I am splitting the app into auth, transactions, and analytics blueprints.",
      ),
      makeFact(
        "fact-sprint",
        52,
        "I am planning the next app-development sprint.",
      ),
      makeFact(
        "fact-transaction-crud",
        60,
        "I am working on transaction CRUD and analytics integration.",
      ),
      makeFact(
        "fact-transaction-post",
        62,
        "I am implementing the POST /transactions route and response handling.",
      ),
      makeFact(
        "fact-rest-api",
        82,
        "I am designing a REST API with validation and error handling.",
      ),
      makeFact(
        "fact-logging",
        96,
        "I am configuring Flask logging for deployment diagnostics.",
      ),
      makeFact(
        "fact-security-preface",
        108,
        "I am reviewing security improvements before deployment.",
      ),
      makeFact(
        "fact-security-review",
        116,
        "I am finalizing deployment and reviewing authentication hardening.",
      ),
      makeFact(
        "fact-gunicorn-tests",
        118,
        "I am reviewing Gunicorn deployment and integration tests for auth and transaction CRUD.",
      ),
      makeFact(
        "fact-security-tests",
        120,
        "Let's do it!",
      ),
      makeFact(
        "fact-docs",
        176,
        "I am documenting architecture decisions and API endpoints.",
      ),
    ];

    const result = selectFacts(
      facts,
      "Can you walk me through the order in which I brought up different aspects of my app development and deployment across our conversations?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toContain("fact-security-tests");
  });

  it("returns contradictory source-message pairs for factual confirmation questions", () => {
    const language = createLanguageService();
    const facts = [
      createFactMemory({
        id: "fact-routing-tutorial",
        userId: "user-1",
        category: "external_benchmark",
        content:
          "I'm trying to review Flask routing, request handling, and session management tutorials before deciding how to implement my app.\n@app.route('/login')\ndef login():\n  return 'ok'",
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: { sourceOrder: 22 },
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-homepage-route",
        userId: "user-1",
        category: "external_benchmark",
        content:
          "I implemented the basic homepage route with Flask and returned static HTML from @app.route('/').",
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: { sourceOrder: 24 },
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-regular-routes-question",
        userId: "user-1",
        category: "external_benchmark",
        content:
          "Can I still use regular Flask routes alongside API endpoints?",
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: { sourceOrder: 38 },
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-never-routes",
        userId: "user-1",
        category: "external_benchmark",
        content:
          "I've never written any Flask routes or handled HTTP requests in this project, so I'm starting from scratch.",
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: { sourceOrder: 58 },
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-refactor",
        userId: "user-1",
        category: "external_benchmark",
        content:
          "I am refactoring legacy Flask code for maintainability and better function naming.",
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: { sourceOrder: 160 },
        updatedAt: TIMESTAMP,
      }),
    ];

    const result = selectFacts(
      facts,
      "Have I worked with Flask routes and handled HTTP requests in this project?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-homepage-route",
      "fact-never-routes",
    ]);
  });

  it("prefers user-grounded contradiction pairs over repeated assistant context", () => {
    const language = createLanguageService();
    const facts = [
      createFactMemory({
        id: "fact-homepage-route",
        userId: "user-1",
        category: "external_benchmark",
        content:
          "I'm trying to implement the basic homepage route with Flask, and I've managed to return static HTML from @app.route('/').",
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: { sourceOrder: 24 },
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-never-routes",
        userId: "user-1",
        category: "external_benchmark",
        content:
          "I've never written any Flask routes or handled HTTP requests in this project, so I'm starting from scratch.",
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: { sourceOrder: 58 },
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-flask-login-context",
        userId: "user-1",
        category: "external_benchmark",
        content:
          "I'm trying to integrate Flask-Login for session management. I've already implemented a basic homepage route, and I've never written any Flask routes or handled HTTP requests in this project before.",
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: { sourceOrder: 66 },
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-flask-login-answer",
        userId: "user-1",
        category: "external_benchmark",
        content:
          "Assistant answer: here is a complete Flask-Login example with registration, login, session management, and transaction CRUD integration.",
        source: SOURCE,
        tags: ["assistant_answer", "source_message", "source_order"],
        attributes: { sourceOrder: 67 },
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-render-answer",
        userId: "user-1",
        category: "external_benchmark",
        content:
          "Assistant answer: update your Gunicorn configuration and Render.com deployment scripts for HTTPS.",
        source: SOURCE,
        tags: ["assistant_answer", "source_message", "source_order"],
        attributes: { sourceOrder: 125 },
        updatedAt: TIMESTAMP,
      }),
    ];

    const result = selectFacts(
      facts,
      "Have I worked with Flask routes and handled HTTP requests in this project?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-homepage-route",
      "fact-never-routes",
    ]);
  });

  it("returns bounded positive support with the negated claim for source-ordered contradiction questions", () => {
    const language = createLanguageService();
    const makeFact = (id: string, sourceOrder: number, content: string) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: { sourceOrder },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeFact(
        "fact-api-key-created",
        32,
        "I obtained an API key for the weather project and added it to my local .env file.",
      ),
      makeFact(
        "fact-api-key-stored",
        34,
        "I stored the API key in the .env file and configured the request helper to read it.",
      ),
      makeFact(
        "fact-api-key-used",
        36,
        "I used the API key in my OpenWeather request helper while testing city lookup.",
      ),
      makeFact(
        "fact-no-api-key",
        70,
        "I have never obtained an API key for this project, so I cannot call the API yet.",
      ),
      makeFact(
        "fact-autocomplete-noise",
        72,
        "I configured city autocomplete and error display for the weather project.",
      ),
    ];

    const result = selectFacts(
      facts,
      "Have I obtained an API key for this project?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-api-key-created",
      "fact-api-key-stored",
      "fact-api-key-used",
      "fact-no-api-key",
    ]);
  });

  it("returns autocomplete bug-fix confirmation evidence without performance or test noise", () => {
    const language = createLanguageService();
    const makeFact = (id: string, sourceOrder: number, content: string) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: { sourceOrder },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeFact(
        "fact-autocomplete-latency-baseline",
        80,
        "I'm optimizing autocomplete for the weather app, which averages 280ms across 100 city inputs.",
      ),
      makeFact(
        "fact-autocomplete-duplicate-bug",
        88,
        "I fixed a bug in autocomplete where duplicate city suggestions appeared after rapid typing, and I updated the debounce cleanup logic.",
      ),
      makeFact(
        "fact-autocomplete-latency-update",
        124,
        "I reduced autocomplete latency from 520ms to 290ms, but I still need fetchWeatherData error handling.",
      ),
      makeFact(
        "fact-autocomplete-selection-bug",
        132,
        "I fixed a bug where autocomplete suggestions disappeared too early after clicking a result, and I updated autocomplete.js to keep the selected city stable.",
      ),
      makeFact(
        "fact-autocomplete-cypress-noise",
        172,
        "I'm adding Cypress end-to-end tests for search, autocomplete, error display, and the retry mechanism.",
      ),
    ];

    const result = selectFacts(
      facts,
      "Have I ever fixed any bugs related to the autocomplete feature in my project?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-autocomplete-duplicate-bug",
      "fact-autocomplete-selection-bug",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-autocomplete-latency-baseline")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-autocomplete-cypress-noise")?.returned).toBe(false);
  });

  it("pairs null-check error-rate improvement with autocomplete bug-fix denial", () => {
    const language = createLanguageService();
    const makeFact = (id: string, sourceOrder: number, content: string) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: { sourceOrder },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeFact(
        "fact-null-check-error-rate",
        88,
        "I'm trying to reduce the error rate in my weather app by adding null checks before accessing API response properties, and I've managed to bring it down from 12% to 1%.",
      ),
      makeFact(
        "fact-long-autocomplete-review-noise",
        124,
        "I've completed the city autocomplete feature, but I'm still getting TypeError in autocomplete.js and I want a long review of fetchWeatherData, CSS media queries, Jest tests, retry logic, and autocomplete alternatives.",
      ),
      makeFact(
        "fact-never-fixed-autocomplete",
        132,
        "I've never fixed any bugs related to the autocomplete feature, but I want to make sure I'm handling errors properly.",
      ),
    ];

    const result = selectFacts(
      facts,
      "Have I ever fixed any bugs related to the autocomplete feature in my project?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-null-check-error-rate",
      "fact-never-fixed-autocomplete",
    ]);
  });

  it("returns same-message Flask-Login contradiction evidence without formatting-instruction noise", () => {
    const language = createLanguageService();
    const makeFact = (
      id: string,
      sourceOrder: number,
      content: string,
      tags: string[] = ["source_message", "source_order", "user_answer"],
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags,
        attributes: { sourceOrder },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeFact(
        "fact-code-formatting-instruction",
        54,
        "Always format all code snippets with syntax highlighting when I ask about implementation details.",
      ),
      makeFact(
        "fact-code-formatting-answer",
        55,
        "Assistant answer: I will ensure that all code snippets are formatted with syntax highlighting when you ask about implementation details.",
        ["assistant_answer", "source_message", "source_order"],
      ),
      makeFact(
        "fact-flask-login-session-context",
        66,
        "I'm trying to integrate Flask-Login v0.6.2 for session management in my Flask app, specifically for handling user logins and sessions, and I want to replace my manual session handling. I've never written any Flask routes or handled HTTP requests in this project before, but I've completed the user registration and login modules and now I'm focusing on transaction CRUD and analytics integration.",
      ),
      makeFact(
        "fact-flask-login-answer",
        67,
        "Assistant answer: here is a complete Flask-Login example with registration, login, session management, transaction CRUD integration, and secure password hashing.",
        ["assistant_answer", "source_message", "source_order"],
      ),
    ];

    const result = selectFacts(
      facts,
      "Have I integrated Flask-Login for session management in my project?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-flask-login-session-context",
    ]);
    expect(result.traces.find((trace) => trace.memoryId === "fact-code-formatting-instruction")?.returned).toBe(false);
    expect(result.traces.find((trace) => trace.memoryId === "fact-code-formatting-answer")?.returned).toBe(false);
  });

  it("returns Chinese contradiction evidence pairs for implementation confirmation queries", () => {
    const language = createLanguageService();
    const facts = [
      createFactMemory({
        id: "fact-route-implemented-zh",
        userId: "user-1",
        category: "external_benchmark",
        content: "我已经实现了 Flask 首页路由，并且能从 @app.route('/') 返回静态 HTML。",
        source: { ...SOURCE, locale: "zh-CN" },
        tags: ["source_message", "source_order", "user_answer"],
        attributes: { sourceOrder: 24 },
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-route-never-zh",
        userId: "user-1",
        category: "external_benchmark",
        content: "我从来没写过 Flask 路由，也没有处理过 HTTP 请求。",
        source: { ...SOURCE, locale: "zh-CN" },
        tags: ["source_message", "source_order", "user_answer"],
        attributes: { sourceOrder: 58 },
        updatedAt: TIMESTAMP,
      }),
    ];

    const result = selectFacts(
      facts,
      "我有没有实现过 Flask 路由并处理 HTTP 请求？",
      language,
      "zh-CN",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-route-implemented-zh",
      "fact-route-never-zh",
    ]);
  });

  it("pairs contradiction evidence for confirmation verbs outside the legacy list", () => {
    const language = createLanguageService();
    const makeFact = (id: string, sourceOrder: number, content: string) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: { sourceOrder },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeFact(
        "fact-met-kelly",
        16,
        "I met Kelly at the book club event last month and we discussed the reading list together.",
      ),
      makeFact(
        "fact-never-met-kelly",
        64,
        "I've never met Kelly at any book club or library events, so I wouldn't recognize her in person.",
      ),
      makeFact(
        "fact-library-schedule-noise",
        90,
        "The library reading room schedule changes every month and I keep forgetting the new hours.",
      ),
    ];

    const result = selectFacts(
      facts,
      "Have I ever met Kelly at any book club or library event?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-met-kelly",
      "fact-never-met-kelly",
    ]);
  });

  it("returns the query-anchored denial when no realized positive pair resolves", () => {
    const language = createLanguageService();
    const makeFact = (id: string, sourceOrder: number, content: string) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: { sourceOrder },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeFact(
        "fact-greg-coffee-noise",
        30,
        "Greg and I grabbed coffee and talked about the conference schedule for next quarter.",
      ),
      makeFact(
        "fact-task-list-noise",
        44,
        "My tasks for this sprint include the colleagues onboarding doc and the quarterly Greg sync notes.",
      ),
      makeFact(
        "fact-never-delegated",
        88,
        "I have never delegated any of my tasks to Greg or other colleagues; I handle everything myself.",
      ),
    ];

    const result = selectFacts(
      facts,
      "Have I ever delegated any of my tasks to Greg or other colleagues?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-never-delegated",
    ]);
  });

  it("returns a same-turn contradiction denial that carries its own positive claim", () => {
    const language = createLanguageService();
    const makeFact = (id: string, sourceOrder: number, content: string) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: { sourceOrder },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeFact(
        "fact-triangle-same-turn",
        58,
        "I've never attempted any triangle classification problems before, but I recently completed a set of triangle classification exercises with my study group.",
      ),
      makeFact(
        "fact-geometry-noise",
        70,
        "I am reviewing a geometry textbook chapter about angles and circles this week.",
      ),
      makeFact(
        "fact-classification-noise",
        74,
        "The textbook classification problems chapter lists triangle worksheets I have not opened yet.",
      ),
    ];

    const result = selectFacts(
      facts,
      "Have I ever worked on triangle classification problems before?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-triangle-same-turn",
    ]);
  });

  it("returns Chinese contradiction evidence for confirmation verbs outside the legacy list", () => {
    const language = createLanguageService();
    const makeFact = (id: string, sourceOrder: number, content: string) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: { ...SOURCE, locale: "zh-CN" },
        tags: ["source_message", "source_order", "user_answer"],
        attributes: { sourceOrder },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeFact(
        "fact-expo-met-zh",
        14,
        "我上个月在球鞋展会上见过 Kyle，还和他聊了限量款的发售计划。",
      ),
      makeFact(
        "fact-expo-never-zh",
        60,
        "我从来没见过 Kyle，也没参加过任何球鞋展会。",
      ),
    ];

    const result = selectFacts(
      facts,
      "我有没有见过 Kyle 或者参加过球鞋展会？",
      language,
      "zh-CN",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-expo-met-zh",
      "fact-expo-never-zh",
    ]);
  });

  it("pairs dual-clause contradiction evidence when the positive turn carries an unrelated denial", () => {
    const language = createLanguageService();
    const makeFact = (id: string, sourceOrder: number, content: string) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: { sourceOrder },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeFact(
        "fact-met-kelly-dual-clause",
        16,
        "I met Kelly at the book club event last month, but I've never finished a full reading challenge before.",
      ),
      makeFact(
        "fact-never-met-kelly-dual",
        64,
        "I've never met Kelly at any book club or library events, so I wouldn't recognize her in person.",
      ),
      makeFact(
        "fact-library-schedule-noise-dual",
        90,
        "The library reading room schedule changes every month and I keep forgetting the new hours.",
      ),
    ];

    const result = selectFacts(
      facts,
      "Have I ever met Kelly at any book club or library event?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-met-kelly-dual-clause",
      "fact-never-met-kelly-dual",
    ]);
  });

  it("keeps contradiction evidence pairs ahead of source instruction appends for confirmation queries", () => {
    const language = createLanguageService();
    const makeFact = (id: string, sourceOrder: number, content: string) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: { sourceOrder },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeFact(
        "fact-met-kyle-expo",
        14,
        "I met Kyle back in 2018 at a sneaker expo in Bridgetown, Barbados, and he seems to know his stuff, but I've never tried Nike Air Max before, so should I give it a shot",
      ),
      makeFact(
        "fact-sneaker-comparison-instruction",
        58,
        "Always provide detailed comparisons when I ask about sneaker features.",
      ),
      makeFact(
        "fact-never-met-kyle-expo",
        60,
        "I've never met anyone like Kyle or been to sneaker expos, can you help me find some comfortable and stylish sneakers for daily wear?",
      ),
      makeFact(
        "fact-sneaker-health-instruction",
        160,
        "Always highlight health benefits when I ask about sneaker features.",
      ),
    ];

    const result = selectFacts(
      facts,
      "Have I ever met Kyle or been to any sneaker expos?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-met-kyle-expo",
      "fact-never-met-kyle-expo",
    ]);
  });

  it("does not bridge contradiction pairs through auxiliary been topic tokens", () => {
    const language = createLanguageService();
    const makeFact = (id: string, sourceOrder: number, content: string) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: { sourceOrder },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeFact(
        "fact-running-technique-unrelated",
        126,
        "I've been learning about running technique from Christopher, who taught me heel-to-toe running form on May 7, and I want to keep my sneakers in good condition",
      ),
      makeFact(
        "fact-sneaker-return-denial",
        216,
        "I've been thinking about my sneaker collection and I realized I have never returned or reordered any sneakers",
      ),
    ];
    const ranked = rankFactCandidates(
      buildFactCandidates(
        facts,
        "Have I ever met Kyle or been to any sneaker expos?",
        language,
        "en",
        TIMESTAMP,
      ),
      "rules-only",
    );

    const selected = selectContradictionEvidencePair({
      entries: ranked,
      language,
      query: "Have I ever met Kyle or been to any sneaker expos?",
      queryLocale: "en",
    });

    expect(selected).toEqual([]);
  });

  it("pairs Chinese dual-clause contradiction evidence when the positive turn carries an unrelated denial", () => {
    const language = createLanguageService();
    const makeFact = (id: string, sourceOrder: number, content: string) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: { ...SOURCE, locale: "zh-CN" },
        tags: ["source_message", "source_order", "user_answer"],
        attributes: { sourceOrder },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeFact(
        "fact-expo-met-dual-zh",
        14,
        "我上个月在球鞋展会上见过 Kyle，不过我从来没用过 Sketch 这类设计软件。",
      ),
      makeFact(
        "fact-expo-never-dual-zh",
        60,
        "我从来没见过 Kyle，也没参加过任何球鞋展会。",
      ),
    ];

    const result = selectFacts(
      facts,
      "我有没有见过 Kyle 或者参加过球鞋展会？",
      language,
      "zh-CN",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-expo-met-dual-zh",
      "fact-expo-never-dual-zh",
    ]);
  });

  it("keeps source-ordered event-order selections ahead of instruction appends for brought-up queries", () => {
    const language = createLanguageService();
    const makeFact = (id: string, sourceOrder: number, content: string) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: { chatId: sourceOrder, sourceOrder },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeFact(
        "fact-garden-layout",
        10,
        "I'm planning my garden redesign and I started by measuring the backyard layout and sketching planting zones.",
      ),
      makeFact(
        "fact-garden-beds",
        12,
        "I built three raised garden beds for the redesign and tested the drainage with a soaker hose.",
      ),
      makeFact(
        "fact-garden-lighting",
        14,
        "I installed solar path lighting around the redesigned garden borders and updated the watering schedule.",
      ),
      makeFact(
        "fact-garden-instruction-noise",
        16,
        "Always include sunlight requirements when I ask about garden redesign options.",
      ),
    ];

    const result = selectFacts(
      facts,
      "Can you list the order in which I brought up different aspects of my garden redesign throughout our conversations, in order? Mention ONLY and ONLY three items.",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    const ids = result.facts.map((fact) => fact.id);
    expect(ids).toContain("fact-garden-layout");
    expect(ids).toContain("fact-garden-beds");
    expect(ids).toContain("fact-garden-lighting");
    expect(ids.length).toBeLessThanOrEqual(4);
  });

  it("prefers user turns over assistant replies for brought-up event-order anchors", () => {
    const language = createLanguageService();
    const makeFact = (
      id: string,
      sourceOrder: number,
      content: string,
      tags: string[],
    ) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: SOURCE,
        tags,
        attributes: { chatId: sourceOrder, sourceOrder },
        updatedAt: TIMESTAMP,
      });
    const userTags = ["source_message", "source_order", "user_answer"];
    const assistantTags = ["source_message", "source_order", "assistant_answer"];
    const facts = [
      makeFact(
        "fact-trail-shoes",
        10,
        "I bought new trail running shoes for my marathon training plan.",
        userTags,
      ),
      makeFact(
        "fact-trail-coach",
        11,
        "Great progress! For your marathon training plan, the trail running shoes you bought should be paired with interval runs, recovery days, hydration tracking, stretching routines, and weekly mileage targets that build gradually toward race day.",
        assistantTags,
      ),
      makeFact(
        "fact-trail-intervals",
        20,
        "I completed my first interval run for the marathon training plan this week.",
        userTags,
      ),
      makeFact(
        "fact-trail-summary",
        21,
        "Excellent work! Completing interval runs in your marathon training plan alongside trail running shoes, hydration tracking, recovery days, stretching routines, and weekly mileage targets shows you are progressing toward race day shape.",
        assistantTags,
      ),
      makeFact(
        "fact-trail-mileage",
        30,
        "I updated my weekly mileage target for the marathon training plan to 30 miles.",
        userTags,
      ),
    ];

    const query =
      "Can you list the order in which I brought up different aspects of my marathon training plan throughout our conversations, including how I first bought trail running shoes, then completed interval runs, and finally updated my weekly mileage target, in order? Mention ONLY and ONLY three items.";
    const selectedIds = selectSourceOrderedEventOrderEvidence({
      entries: rankFactCandidates(
        buildFactCandidates(facts, query, language, "en", TIMESTAMP),
        "rules-only",
      ),
      language,
      query,
      queryLocale: "en",
    }).map((entry) => entry.fact.id);

    expect(selectedIds).toEqual([
      "fact-trail-shoes",
      "fact-trail-intervals",
      "fact-trail-mileage",
    ]);

    const result = selectFacts(
      facts,
      query,
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-trail-shoes",
      "fact-trail-intervals",
      "fact-trail-mileage",
    ]);
  });

  it("keeps Chinese source-ordered event selections ahead of instruction appends for brought-up queries", () => {
    const language = createLanguageService();
    const makeFact = (id: string, sourceOrder: number, content: string) =>
      createFactMemory({
        id,
        userId: "user-1",
        category: "external_benchmark",
        content,
        source: { ...SOURCE, locale: "zh-CN" },
        tags: ["source_message", "source_order", "user_answer"],
        attributes: { chatId: sourceOrder, sourceOrder },
        updatedAt: TIMESTAMP,
      });
    const facts = [
      makeFact(
        "fact-garden-layout-zh",
        10,
        "我开始做花园改造，先测量了后院的布局并画了种植分区草图。",
      ),
      makeFact(
        "fact-garden-beds-zh",
        20,
        "我为花园改造搭建了三个高架种植床，还测试了排水效果。",
      ),
      makeFact(
        "fact-garden-lighting-zh",
        30,
        "我在改造后的花园边界安装了太阳能小路灯，并更新了浇水计划。",
      ),
      makeFact(
        "fact-garden-instruction-noise-zh",
        40,
        "每次我问花园改造的不同方面时，请总是包含日照需求和对话要点的说明。",
      ),
    ];

    const result = selectFacts(
      facts,
      "请按时间顺序列出我在我们的对话中提到的关于花园改造的不同方面。",
      language,
      "zh-CN",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    const ids = result.facts.map((fact) => fact.id);
    expect(ids).toContain("fact-garden-layout-zh");
    expect(ids).toContain("fact-garden-beds-zh");
    expect(ids).toContain("fact-garden-lighting-zh");
  });

  it("prioritizes compact dated nursery facts for temporal event-order questions", () => {
    const language = createLanguageService();
    const facts = [
      createFactMemory({
        id: "fact-nursery-generic",
        userId: "user-1",
        category: "external_benchmark",
        content:
          "On 2023/02/05, I'm expecting a new baby in my social circle soon and I'm thinking of getting a gift.",
        source: SOURCE,
        tags: ["compact_evidence"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-nursery-dated",
        userId: "user-1",
        category: "external_benchmark",
        content: "On 2023/02/05, I helped my friend prepare the nursery.",
        source: SOURCE,
        tags: ["answer_session", "dated_event"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-shower-dated",
        userId: "user-1",
        category: "external_benchmark",
        content: "On 2023/02/10, I helped my cousin pick out stuff for her baby shower.",
        source: SOURCE,
        tags: ["answer_session", "dated_event"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-phone-dated",
        userId: "user-1",
        category: "external_benchmark",
        content: "On 2023/02/20, I ordered a customized phone case for my friend's birthday.",
        source: SOURCE,
        tags: ["user_answer", "dated_event"],
        updatedAt: TIMESTAMP,
      }),
    ];

    const result = selectFacts(
      facts,
      "Which three events happened in the order from first to last: the day I helped my friend prepare the nursery, the day I helped my cousin pick out stuff for her baby shower, and the day I ordered a customized phone case for my friend's birthday?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-nursery-dated",
      "fact-shower-dated",
      "fact-phone-dated",
    ]);
  });

  it("does not treat non-imported source_order as sufficient temporal relevance", () => {
    const language = createLanguageService();
    const facts = [
      createFactMemory({
        id: "fact-source-order-noise",
        userId: "user-1",
        category: "project",
        content:
          "Imported metadata marker for an unrelated watercolor preference.",
        source: SOURCE,
        tags: ["source_message", "source_order", "user_answer"],
        attributes: { sourceOrder: 1 },
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-nursery-dated",
        userId: "user-1",
        category: "external_benchmark",
        content: "On 2023/02/05, I helped my friend prepare the nursery.",
        source: SOURCE,
        tags: ["answer_session", "dated_event"],
        updatedAt: TIMESTAMP,
      }),
      createFactMemory({
        id: "fact-phone-dated",
        userId: "user-1",
        category: "external_benchmark",
        content: "On 2023/02/20, I ordered a customized phone case for my friend's birthday.",
        source: SOURCE,
        tags: ["user_answer", "dated_event"],
        updatedAt: TIMESTAMP,
      }),
    ];

    const result = selectFacts(
      facts,
      "Which events happened from earliest to latest: the day I helped my friend prepare the nursery and the day I ordered a customized phone case?",
      language,
      "en",
      "general_chat",
      buildRoutingDecision({}),
      null,
      TIMESTAMP,
    );

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-nursery-dated",
      "fact-phone-dated",
    ]);
    expect(
      result.traces.find((trace) => trace.memoryId === "fact-source-order-noise")
        ?.returned,
    ).toBe(false);
  });

  it("keeps appliesTo-distinct feedback variants separate and prioritizes coding-agent guidance", () => {
    const feedback = [
      createFeedbackMemory({
        id: "feedback-general",
        userId: "user-1",
        rule: "Use bullet points.",
        kind: "validated_pattern",
        appliesTo: "general_response",
        source: SOURCE,
        updatedAt: "2026-01-11T00:00:00.000Z",
      }),
      createFeedbackMemory({
        id: "feedback-coding",
        userId: "user-1",
        rule: "Use bullet points.",
        kind: "validated_pattern",
        appliesTo: "coding_agent",
        source: SOURCE,
        updatedAt: "2026-01-10T00:00:00.000Z",
      }),
    ];

    const selected = selectFeedbackForProfile(feedback, "coding_agent");

    expect(selected.map((record) => record.id)).toEqual([
      "feedback-coding",
      "feedback-general",
    ]);
  });

  it("returns active feedback for summary composition queries with weak lexical overlap", () => {
    const language = createLanguageService();
    const feedback = [
      createFeedbackMemory({
        id: "feedback-summary",
        userId: "user-1",
        rule: "Use bullet points in summaries.",
        kind: "validated_pattern",
        appliesTo: "general_response",
        source: SOURCE,
        updatedAt: "2026-01-10T00:00:00.000Z",
      }),
    ];

    const selected = selectFeedbackForQuery(
      feedback,
      "Please summarize the current rollout status.",
      language,
      "en-US",
      "general_chat",
    );

    expect(selected.map((record) => record.id)).toEqual(["feedback-summary"]);
  });

  it("matches feedback by rule text when metadata terms dilute full-search overlap", () => {
    const language = createLanguageService();
    const feedback = [
      createFeedbackMemory({
        id: "feedback-outcome",
        userId: "user-1",
        rule:
          "When detailed analysis previously caused DeepAnalyzer timeouts, avoid DeepAnalyzer on the first action and use QuickCheck before proceeding.",
        kind: "validated_pattern",
        appliesTo: "general_response",
        source: SOURCE,
        updatedAt: "2026-01-10T00:00:00.000Z",
      }),
    ];

    const selected = selectFeedbackForQuery(
      feedback,
      "I need a detailed analysis of our network traffic.",
      language,
      "en-US",
      "general_chat",
    );

    expect(selected.map((record) => record.id)).toEqual(["feedback-outcome"]);
  });
});
