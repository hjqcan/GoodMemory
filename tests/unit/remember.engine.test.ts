import { describe, expect, it } from "bun:test";
import { createMemoryRepositories } from "../../src/storage/repositories";
import {
  createInMemoryDocumentStore,
  createInMemorySessionStore,
  createInMemoryVectorStore,
} from "../../src/storage/memory";
import {
  createRememberEngine,
  type RememberEngineConfig,
} from "../../src/remember/engine";
import {
  createFeedbackMemory,
  createFactMemory,
  createReferenceMemory,
  createUserProfile,
} from "../../src/domain/records";
import {
  DeterministicClock,
  createDeterministicIdGenerator,
} from "../../src/testing/utils";
import { createFakeEmbeddingAdapter } from "../../src/testing/fakes";
import {
  createLanguageService,
  createNeutralLanguagePack,
} from "../../src/language";

function createEngine(overrides: Partial<RememberEngineConfig> = {}) {
  const clock = new DeterministicClock("2026-01-01T00:00:00.000Z");
  const documentStore = createInMemoryDocumentStore();
  const repositories = createMemoryRepositories({
    documentStore,
    sessionStore: createInMemorySessionStore(),
  });
  const engine = createRememberEngine({
    repositories,
    documentStore,
    now: () => clock.now().toISOString(),
    createId: createDeterministicIdGenerator("mem"),
    ...overrides,
  });

  return {
    clock,
    documentStore,
    repositories,
    engine,
  };
}

describe("remember engine", () => {
  it("passes an existing canonical name to assisted extraction context", async () => {
    let knownUserName: string | undefined;
    const { engine, repositories } = createEngine({
      assistedExtractor: {
        async extract(_input, context) {
          knownUserName = context?.knownUserName;
          return { candidates: [], ignoredMessageCount: 0 };
        },
      },
    });
    await repositories.profiles.upsert(
      createUserProfile({
        identity: { name: "Nadia Chen" },
        userId: "u-known-identity",
      }),
    );

    await engine.extract({
      extractionStrategy: "llm-assisted",
      messages: [{ role: "user", content: "I started a new project." }],
      scope: { userId: "u-known-identity" },
    });

    expect(knownUserName).toBe("Nadia Chen");
  });

  it("scores explicit candidates above inferred ones and rejects low-value noise", async () => {
    const { engine } = createEngine();

    const explicit = engine.classifyCandidate({
      id: "c-1",
      kindHint: "fact",
      explicitness: "explicit",
      content: "the robot workflow is blocked on prod migration.",
      sourceMessageIndex: 0,
      sourceRole: "user",
      metadata: { category: "project" },
    });
    const inferred = engine.classifyCandidate({
      id: "c-2",
      kindHint: "fact",
      explicitness: "inferred",
      content: "The robot workflow is still failing in production.",
      sourceMessageIndex: 0,
      sourceRole: "user",
      metadata: { category: "project" },
    });
    const noise = engine.classifyCandidate({
      id: "c-3",
      kindHint: "noise",
      explicitness: "inferred",
      content: "hi",
      sourceMessageIndex: 0,
      sourceRole: "user",
    });

    expect(explicit.score).toBeGreaterThan(inferred.score);
    expect(inferred.decision).toBe("reject");
    expect(noise.decision).toBe("reject");
  });

  it("supersedes an older inferred fact with a newer explicit fact on the same topic", async () => {
    const { clock, repositories, engine } = createEngine();
    const scope = { userId: "u-1", sessionId: "s-1" };

    await repositories.facts.add(
      createFactMemory({
        id: "f-legacy",
        userId: "u-1",
        workspaceId: "workspace-a",
        sessionId: "s-legacy",
        category: "project",
        content: "The robot workflow is still failing in production after the migration.",
        source: { method: "inferred", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );

    clock.advanceMs(1000);
    const result = await engine.remember({
      scope: {
        ...scope,
        workspaceId: "workspace-a",
      },
      messages: [
        {
          role: "user",
          content: "Remember that the robot workflow is now stable in production.",
        },
      ],
    });

    const facts = await repositories.facts.listByUser("u-1");
    expect(facts).toHaveLength(2);
    expect(facts.filter((fact) => fact.lifecycle === "active")).toHaveLength(1);
    expect(facts.find((fact) => fact.lifecycle === "superseded")?.isActive).toBe(false);
    expect(result.events.some((event) => event.outcome === "superseded")).toBe(true);
  });

  it("keeps workspace-scoped durable facts isolated during dedupe and supersession", async () => {
    const { repositories, engine } = createEngine();

    await repositories.facts.add(
      createFactMemory({
        id: "f-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        content: "Robot workflow remains open.",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );

    const result = await engine.remember({
      scope: {
        userId: "u-1",
        sessionId: "s-2",
        workspaceId: "workspace-b",
      },
      messages: [
        {
          role: "user",
          content: "Remember that Robot workflow remains open.",
        },
      ],
    });

    expect(result.events[0]?.outcome).toBe("written");
    expect(
      await repositories.facts.listByScope({
        userId: "u-1",
        workspaceId: "workspace-a",
      }),
    ).toHaveLength(1);
    expect(
      await repositories.facts.listByScope({
        userId: "u-1",
        workspaceId: "workspace-b",
      }),
    ).toHaveLength(1);
  });

  it("uses repositories.vectorIndex by default so legacy engine wiring still writes embeddings", async () => {
    const documentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    const vectorStore = createInMemoryVectorStore();
    const repositories = createMemoryRepositories({
      documentStore,
      sessionStore,
      vectorStore,
    });
    const embeddingAdapter = createFakeEmbeddingAdapter();
    const engine = createRememberEngine({
      repositories,
      documentStore,
      embedding: embeddingAdapter,
      now: () => "2026-01-01T00:00:00.000Z",
      createId: createDeterministicIdGenerator("mem"),
    });
    const scope = { userId: "u-legacy", workspaceId: "workspace-a", sessionId: "s-1" } as const;

    await engine.remember({
      scope,
      messages: [
        {
          role: "user",
          content: "Remember that the runtime rollout is blocked on vendor approval.",
        },
      ],
    });

    const [fact] = await repositories.facts.listByScope(scope);
    const [factEmbedding] = await embeddingAdapter.embed([fact!.content]);

    expect(
      await repositories.vectorIndex?.searchFactEmbedding(factEmbedding, {
        topK: 1,
        filter: { userId: scope.userId, workspaceId: scope.workspaceId },
      }),
    ).toContainEqual(expect.objectContaining({ id: fact?.id }));
  });

  it("updates procedural memory independently from semantic fact storage", async () => {
    const { repositories, engine } = createEngine();
    const scope = { userId: "u-1", sessionId: "s-1" };

    const result = await engine.remember({
      scope,
      messages: [
        {
          role: "user",
          content: "Please keep answers concise and action-oriented.",
        },
      ],
    });

    expect(await repositories.facts.listByUser("u-1")).toHaveLength(0);
    expect(await repositories.feedback.listByUser("u-1")).toHaveLength(1);
    expect(result.accepted).toBe(1);
    expect(result.outcome).toBe("committed");
  });

  it("merges multi-field profile updates into one durable profile", async () => {
    const { repositories, engine } = createEngine();

    await engine.remember({
      scope: { userId: "u-1", sessionId: "s-1", workspaceId: "workspace-a" },
      messages: [
        {
          role: "user",
          content:
            "My name is Felix. I'm a climate policy advisor in Austin, USA. Remember that I'm leading incident playbook refresh.",
        },
      ],
    });

    const profile = await repositories.profiles.get("u-1");
    const facts = await repositories.facts.listByScope({
      userId: "u-1",
      workspaceId: "workspace-a",
      sessionId: "s-1",
    });

    expect(profile?.identity).toEqual({
      name: "Felix",
      role: "climate policy advisor",
      location: "Austin, USA",
    });
    expect(profile?.activeContext.currentProjects).toEqual([
      "incident playbook refresh",
    ]);
    expect(facts).toHaveLength(0);
  });

  it("writes structured profile fields beyond name and explains them in trace reasons", async () => {
    const { repositories, engine } = createEngine();

    const result = await engine.remember({
      scope: { userId: "u-1", sessionId: "s-1", workspaceId: "workspace-a" },
      messages: [
        {
          role: "user",
          content:
            "I'm a staff engineer at Acme Labs. My timezone is Asia/Shanghai. My preferred language is Chinese.",
        },
      ],
    });

    const profile = await repositories.profiles.get("u-1");

    expect(profile?.identity).toEqual({
      role: "staff engineer",
      organization: "Acme Labs",
      timezone: "Asia/Shanghai",
      languagePreference: "Chinese",
    });
    expect(result.events.map((event) => event.reason)).toContain("explicit_profile_role");
    expect(result.events.map((event) => event.reason)).toContain(
      "explicit_profile_organization",
    );
    expect(result.events.map((event) => event.reason)).toContain(
      "explicit_profile_timezone",
    );
    expect(result.events.map((event) => event.reason)).toContain(
      "explicit_profile_language_preference",
    );
  });

  it("exposes extraction and rejects unsupported kinds or policy-vetoed writes", async () => {
    const base = createEngine();
    const blocked = createEngine({
      shouldWrite: () => false,
    });

    const extraction = await base.engine.extract({
      scope: { userId: "u-1", sessionId: "s-1" },
      messages: [{ role: "user", content: "Remember that runtime stability matters." }],
    });
    const unsupported = base.engine.classifyCandidate({
      id: "c-episode",
      kindHint: "episode",
      explicitness: "explicit",
      content: "conversation episode",
      sourceMessageIndex: 0,
      sourceRole: "user",
    });

    const blockedResult = await blocked.engine.remember({
      scope: { userId: "u-1", sessionId: "s-1" },
      messages: [{ role: "user", content: "Remember that runtime stability matters." }],
    });

    expect(extraction.candidates).toHaveLength(1);
    expect(unsupported.decision).toBe("reject");
    expect(unsupported.reason).toBe("unsupported_kind");
    expect(blockedResult.accepted).toBe(0);
    expect(blockedResult.events[0]?.reason).toBe("policy_rejected");
  });

  it("lets remember-always annotations raise valid inferred candidates through normal policy gates", async () => {
    const scope = { userId: "u-annotation-raise", sessionId: "s-1" };
    const { engine, repositories } = createEngine({
      extractor: {
        async extract() {
          return {
            candidates: [
              {
                id: "inferred-1",
                kindHint: "fact",
                explicitness: "inferred",
                content: "The user is trying to stabilize their sleep routine.",
                sourceMessageIndex: 0,
                sourceRole: "user",
                metadata: {
                  category: "habit",
                  tags: ["life_coach"],
                },
              },
            ],
            ignoredMessageCount: 0,
          };
        },
      },
    });

    const result = await engine.remember({
      scope,
      messages: [
        {
          role: "user",
          content: "I want to stabilize my sleep routine this month.",
        },
      ],
      annotations: [
        {
          messageIndex: 0,
          remember: "always",
          reason: "host classified this as durable coaching context",
        },
      ],
    });

    const facts = await repositories.facts.listByScope(scope);

    expect(result.accepted).toBe(1);
    expect(result.events[0]?.sourceMethod).toBe("inferred");
    expect(result.events[0]?.annotation).toEqual({
      remember: "always",
      reason: "host classified this as durable coaching context",
    });
    expect(facts[0]?.source.method).toBe("inferred");
    expect(facts[0]?.tags).toEqual(["life_coach"]);
  });

  it("treats verified remember-always annotations as explicit evidence for existing candidates", async () => {
    const scope = { userId: "u-annotation-verified", sessionId: "s-1" };
    const { engine, repositories } = createEngine({
      extractor: {
        async extract() {
          return {
            candidates: [
              {
                id: "inferred-verified-1",
                kindHint: "fact",
                explicitness: "inferred",
                content: "The play I attended was The Glass Menagerie.",
                sourceMessageIndex: 0,
                sourceRole: "user",
                metadata: {
                  category: "event",
                },
              },
            ],
            ignoredMessageCount: 0,
          };
        },
      },
    });

    const result = await engine.remember({
      scope,
      messages: [
        {
          role: "user",
          content: "The play I attended was The Glass Menagerie.",
        },
      ],
      annotations: [
        {
          confirmed: true,
          messageIndex: 0,
          remember: "always",
          reason: "host verified this turn as durable evidence",
          verified: true,
        },
      ],
    });
    const facts = await repositories.facts.listByScope(scope);

    expect(result.accepted).toBe(1);
    expect(result.events[0]?.sourceMethod).toBe("explicit");
    expect(facts[0]?.source.method).toBe("explicit");
  });

  it("preserves metadata-patched remember-always source messages as retrievable evidence", async () => {
    const scope = { userId: "u-annotation-source", sessionId: "s-1" };
    const { engine, repositories } = createEngine({
      extractor: {
        async extract() {
          return {
            candidates: [
              {
                id: "summary-1",
                kindHint: "fact",
                explicitness: "inferred",
                content: "The user is working on a budget tracker.",
                sourceMessageIndex: 0,
                sourceRole: "user",
                metadata: {
                  category: "project",
                },
              },
            ],
            ignoredMessageCount: 0,
          };
        },
      },
    });

    const sourceMessage =
      "[chat_id=42 time=unknown] I need to implement transaction creation with proper error handling in my personal budget tracker.";
    const result = await engine.remember({
      scope,
      messages: [
        {
          role: "user",
          content: sourceMessage,
        },
      ],
      annotations: [
        {
          confirmed: true,
          messageIndex: 0,
          metadataPatch: {
            attributes: {
              originalRole: "user",
              sourceOrder: 42,
            },
            category: "external_benchmark",
            tags: ["imported_conversation"],
          },
          remember: "always",
          verified: true,
        },
      ],
    });
    const facts = await repositories.facts.listByScope(scope);
    const preserved = facts.find((fact) => fact.content === sourceMessage);

    expect(result.accepted).toBe(2);
    expect(preserved?.category).toBe("external_benchmark");
    expect(preserved?.source.method).toBe("explicit");
    expect(preserved?.tags).toEqual([
      "imported_conversation",
      "source_message",
      "source_order",
      "user_answer",
    ]);
    expect(preserved?.attributes).toMatchObject({
      originalRole: "user",
      sourceMessageIndex: 0,
      sourceOrder: 42,
    });
  });

  it("uses LanguagePack temporal expressions when tagging preserved source events", async () => {
    const neutral = createNeutralLanguagePack();
    const language = createLanguageService({
      defaultLocale: "xx",
      packs: [{
        ...neutral,
        analyzerVersion: "sentinel-v1",
        compatibilityGroup: "xx",
        defaultLocale: "xx",
        detect: () => "distinctive",
        id: "xx-sentinel",
        locales: ["xx"],
        parseTemporalExpressions: (text) =>
          text.includes("zor")
            ? [{ kind: "absolute", raw: "zor" }]
            : [],
      }],
    });
    const scope = { userId: "u-sentinel-temporal" };
    const { engine, repositories } = createEngine({
      language,
      extractor: {
        async extract() {
          return { candidates: [], ignoredMessageCount: 0 };
        },
      },
    });

    await engine.remember({
      annotations: [{
        messageIndex: 0,
        metadataPatch: { category: "event" },
        remember: "always",
        verified: true,
      }],
      locale: "xx",
      messages: [{ role: "user", content: "zor" }],
      scope,
    });

    const facts = await repositories.facts.listByScope(scope);
    expect(facts[0]?.tags).toContain("dated_event");
  });

  it("keeps structured source time markers in the language temporal contract", async () => {
    const scope = { userId: "u-source-time-marker" };
    const { engine, repositories } = createEngine({
      extractor: {
        async extract() {
          return { candidates: [], ignoredMessageCount: 0 };
        },
      },
    });

    await engine.remember({
      annotations: [{
        messageIndex: 0,
        metadataPatch: { category: "event" },
        remember: "always",
        verified: true,
      }],
      messages: [{ role: "user", content: "[time=Jan] source event" }],
      scope,
    });

    const facts = await repositories.facts.listByScope(scope);
    expect(facts[0]?.tags).toContain("dated_event");
  });

  it("merges source-message provenance into exact extracted remember-always candidates", async () => {
    const scope = { userId: "u-annotation-source-exact", sessionId: "s-1" };
    const sourceMessage =
      "[chat_id=130 time=unknown] Always include error status codes in responses when I ask about API error handling.";
    const { engine, repositories } = createEngine({
      extractor: {
        async extract() {
          return {
            candidates: [
              {
                id: "exact-source-1",
                kindHint: "fact",
                explicitness: "explicit",
                content: sourceMessage,
                sourceMessageIndex: 0,
                sourceRole: "user",
                metadata: {
                  category: "external_benchmark",
                  tags: ["imported_conversation"],
                },
              },
            ],
            ignoredMessageCount: 0,
          };
        },
      },
    });

    const result = await engine.remember({
      scope,
      messages: [
        {
          role: "user",
          content: sourceMessage,
        },
      ],
      annotations: [
        {
          confirmed: true,
          messageIndex: 0,
          metadataPatch: {
            attributes: {
              chatId: 130,
              originalRole: "user",
            },
            category: "external_benchmark",
            tags: ["beam", "chat_id:130"],
          },
          remember: "always",
          verified: true,
        },
      ],
    });
    const facts = await repositories.facts.listByScope(scope);
    const preserved = facts.find((fact) => fact.content === sourceMessage);

    expect(result.accepted).toBe(1);
    expect(preserved?.tags).toEqual([
      "imported_conversation",
      "beam",
      "chat_id:130",
      "source_message",
      "source_order",
      "user_answer",
    ]);
    expect(preserved?.attributes).toMatchObject({
      chatId: 130,
      originalRole: "user",
      sourceMessageIndex: 0,
      sourceOrder: 130,
    });
  });

  it("does not let remember-always annotations bypass write policy", async () => {
    const scope = { userId: "u-annotation-policy", sessionId: "s-1" };
    const { engine } = createEngine({
      shouldWrite: () => false,
      extractor: {
        async extract() {
          return {
            candidates: [
              {
                id: "inferred-1",
                kindHint: "fact",
                explicitness: "inferred",
                content: "The user is trying to stabilize their sleep routine.",
                sourceMessageIndex: 0,
                sourceRole: "user",
                metadata: {
                  category: "habit",
                },
              },
            ],
            ignoredMessageCount: 0,
          };
        },
      },
    });

    const result = await engine.remember({
      scope,
      messages: [
        {
          role: "user",
          content: "I want to stabilize my sleep routine this month.",
        },
      ],
      annotations: [
        {
          messageIndex: 0,
          remember: "always",
        },
      ],
    });

    expect(result.accepted).toBe(0);
    expect(result.events[0]?.reason).toBe("policy_rejected");
    expect(result.events[0]?.annotation).toEqual({ remember: "always" });
  });

  it("lets remember-never annotations dominate duplicate remember-always annotations", async () => {
    const scope = {
      userId: "u-annotation-suppression",
      sessionId: "s-1",
      workspaceId: "workspace-a",
    };
    const { engine, repositories } = createEngine();

    const result = await engine.remember({
      scope,
      messages: [
        {
          role: "user",
          content: "Remember that runtime launch is blocked on legal review.",
        },
      ],
      annotations: [
        {
          messageIndex: 0,
          remember: "never",
          reason: "private source text",
        },
        {
          messageIndex: 0,
          remember: "always",
          reason: "duplicate host write intent",
        },
      ],
    });

    expect(result.accepted).toBe(0);
    expect(await repositories.facts.listByScope(scope)).toHaveLength(0);
  });

  it("merges duplicate references and facts within the same scope", async () => {
    const { engine } = createEngine();
    const scope = { userId: "u-1", sessionId: "s-1", workspaceId: "workspace-a" };

    await engine.remember({
      scope,
      messages: [
        {
          role: "user",
          content: "Use docs/runtime-runbook.md as the source of truth for runtime work.",
        },
        {
          role: "user",
          content: "Remember that the runtime migration is blocked on a schema rollout.",
        },
      ],
    });

    const duplicateResult = await engine.remember({
      scope,
      messages: [
        {
          role: "user",
          content: "Use docs/runtime-runbook.md as the source of truth for runtime work.",
        },
        {
          role: "user",
          content: "Remember that the runtime migration is blocked on a schema rollout.",
        },
      ],
    });

    expect(
      duplicateResult.events.some((event) => event.reason === "duplicate_reference"),
    ).toBe(true);
    expect(
      duplicateResult.events.some((event) => event.reason === "duplicate_fact"),
    ).toBe(true);
  });

  it("falls back to rules-only extraction when llm-assisted extraction fails", async () => {
    const scope = { userId: "u-fallback", sessionId: "s-1", workspaceId: "workspace-a" };
    const { engine, repositories } = createEngine({
      extractor: {
        async extract() {
          return {
            candidates: [
              {
                id: "rules-1",
                kindHint: "fact",
                explicitness: "explicit",
                content: "Runtime launch is blocked on legal review.",
                sourceMessageIndex: 0,
                sourceRole: "user",
                metadata: {
                  category: "project",
                  factKind: "open_loop",
                  subject: "runtime launch",
                },
              },
            ],
            ignoredMessageCount: 0,
          };
        },
      },
      assistedExtractor: {
        async extract() {
          throw new Error("OpenAI-compatible gateway timeout after 45000ms.");
        },
      },
    });

    const result = await engine.remember({
      scope,
      extractionStrategy: "llm-assisted",
      messages: [
        {
          role: "user",
          content: "Remember that runtime launch is blocked on legal review.",
        },
      ],
    });

    const facts = await repositories.facts.listByScope(scope);

    expect(result.accepted).toBe(1);
    expect(result.metadata?.requestedExtractionStrategy).toBe("llm-assisted");
    expect(result.metadata?.resolvedExtractionStrategy).toBe("rules-only");
    expect(result.events[0]?.extractionSources).toEqual(["rules-only"]);
    expect(facts).toHaveLength(1);
    expect(facts[0]?.subject).toBe("runtime launch");
    expect(result.outcome).toBe("failed");
    // The assisted extractor threw and was silently swallowed to rules-only;
    // surface it so the caller is not left thinking assisted extraction ran.
    expect(result.warnings ?? []).toContain("assisted_extraction_failed");
  });

  it("warns no_durable_facts_extracted when a batch produces zero durable memories", async () => {
    const scope = { userId: "u-zero-facts", sessionId: "s-1", workspaceId: "workspace-a" };
    const { engine } = createEngine({
      extractor: {
        async extract() {
          return { candidates: [], ignoredMessageCount: 0 };
        },
      },
    });

    const result = await engine.remember({
      scope,
      messages: [
        { role: "user", content: "just some passing chatter about the weather" },
      ],
    });

    expect(result.accepted).toBe(0);
    expect(result.outcome).toBe("no_admissible_candidate");
    expect(result.warnings ?? []).toContain("no_durable_facts_extracted");
  });

  it("does not warn no_durable_facts_extracted when policy rejects extracted candidates", async () => {
    const scope = { userId: "u-policy-reject", sessionId: "s-1", workspaceId: "workspace-a" };
    const { engine } = createEngine({
      extractor: {
        async extract() {
          return {
            candidates: [
              {
                id: "low-value-1",
                kindHint: "fact",
                explicitness: "inferred",
                content: "The deploy might be fine.",
                sourceMessageIndex: 0,
                sourceRole: "user",
                metadata: { category: "project" },
              },
            ],
            ignoredMessageCount: 0,
          };
        },
      },
    });

    const result = await engine.remember({
      scope,
      messages: [
        { role: "user", content: "The deploy might be fine." },
      ],
    });

    expect(result.accepted).toBe(0);
    expect(result.rejected).toBe(1);
    expect(result.events[0]?.outcome).toBe("rejected");
    expect(result.outcome).toBe("no_admissible_candidate");
    expect(result.warnings ?? []).not.toContain("no_durable_facts_extracted");
  });

  it("defaults extraction strategy to auto and keeps simple explicit inputs on rules-only", async () => {
    const scope = { userId: "u-auto-simple", sessionId: "s-1", workspaceId: "workspace-a" };
    let assistedCalls = 0;
    const { engine } = createEngine({
      extractor: {
        async extract() {
          return {
            candidates: [
              {
                id: "rules-1",
                kindHint: "fact",
                explicitness: "explicit",
                content: "Runtime launch is blocked on legal review.",
                sourceMessageIndex: 0,
                sourceRole: "user",
                metadata: {
                  category: "project",
                  factKind: "blocker",
                  subject: "runtime launch",
                },
              },
            ],
            ignoredMessageCount: 0,
          };
        },
      },
      assistedExtractor: {
        async extract() {
          assistedCalls += 1;
          return {
            candidates: [],
            ignoredMessageCount: 0,
          };
        },
      },
    });

    const result = await engine.remember({
      scope,
      messages: [
        {
          role: "user",
          content: "Remember that runtime launch is blocked on legal review.",
        },
      ],
    });

    expect(result.metadata?.requestedExtractionStrategy).toBe("auto");
    expect(result.metadata?.resolvedExtractionStrategy).toBe("rules-only");
    expect(assistedCalls).toBe(0);
    expect(result.events[0]?.extractionSources).toEqual(["rules-only"]);
  });

  it("upgrades auto extraction to llm-assisted for multi-intent replay batches", async () => {
    const scope = { userId: "u-auto-assisted", sessionId: "s-1", workspaceId: "workspace-a" };
    let assistedCalls = 0;
    const { engine } = createEngine({
      extractor: {
        async extract() {
          return {
            candidates: [
              {
                id: "rules-reference",
                kindHint: "reference",
                explicitness: "explicit",
                content: "docs/runtime-runbook.md",
                sourceMessageIndex: 0,
                sourceRole: "user",
                metadata: {
                  referencePointer: "docs/runtime-runbook.md",
                  referenceTitle: "Runtime runbook",
                },
              },
              {
                id: "rules-fact",
                kindHint: "fact",
                explicitness: "explicit",
                content: "Runtime migration is blocked on schema rollout.",
                sourceMessageIndex: 1,
                sourceRole: "user",
                metadata: {
                  category: "project",
                  factKind: "blocker",
                  subject: "runtime migration",
                },
              },
            ],
            ignoredMessageCount: 0,
          };
        },
      },
      assistedExtractor: {
        async extract() {
          assistedCalls += 1;
          return {
            candidates: [
              {
                id: "llm-reference",
                kindHint: "reference",
                explicitness: "explicit",
                content: "The source of truth is docs/runtime-runbook.md.",
                sourceMessageIndex: 0,
                sourceRole: "user",
                metadata: {
                  referenceKind: "runbook",
                  referencePointer: "docs/runtime-runbook.md",
                  referenceTitle: "Runtime runbook",
                },
              },
            ],
            ignoredMessageCount: 0,
          };
        },
      },
    });

    const result = await engine.remember({
      scope,
      messages: [
        {
          role: "user",
          content: "Use docs/runtime-runbook.md as the source of truth.",
        },
        {
          role: "user",
          content: "Remember that runtime migration is blocked on schema rollout.",
        },
      ],
    });

    expect(result.metadata?.requestedExtractionStrategy).toBe("auto");
    expect(result.metadata?.resolvedExtractionStrategy).toBe("llm-assisted");
    expect(assistedCalls).toBe(1);
    expect(
      result.events.some((event) => event.extractionSources?.includes("llm-assisted")),
    ).toBe(true);
  });

  it("falls back from auto extraction to rules-only when assisted extraction fails", async () => {
    const scope = { userId: "u-auto-fallback", sessionId: "s-1", workspaceId: "workspace-a" };
    const { engine, repositories } = createEngine({
      extractor: {
        async extract() {
          return {
            candidates: [
              {
                id: "rules-reference",
                kindHint: "reference",
                explicitness: "explicit",
                content: "docs/runtime-runbook.md",
                sourceMessageIndex: 0,
                sourceRole: "user",
                metadata: {
                  referencePointer: "docs/runtime-runbook.md",
                  referenceTitle: "Runtime runbook",
                },
              },
              {
                id: "rules-fact",
                kindHint: "fact",
                explicitness: "explicit",
                content: "Runtime launch is blocked on legal review.",
                sourceMessageIndex: 1,
                sourceRole: "user",
                metadata: {
                  category: "project",
                  factKind: "blocker",
                  subject: "runtime launch",
                },
              },
            ],
            ignoredMessageCount: 0,
          };
        },
      },
      assistedExtractor: {
        async extract() {
          throw new Error("OpenAI-compatible gateway timeout after 45000ms.");
        },
      },
    });

    const result = await engine.remember({
      scope,
      messages: [
        {
          role: "user",
          content: "Correction: docs/runtime-runbook.md is now the source of truth.",
        },
        {
          role: "user",
          content: "Remember that runtime launch is blocked on legal review.",
        },
      ],
    });

    const references = await repositories.references.listByScope(scope);
    const facts = await repositories.facts.listByScope(scope);

    expect(result.metadata?.requestedExtractionStrategy).toBe("auto");
    expect(result.metadata?.resolvedExtractionStrategy).toBe("rules-only");
    expect(references).toHaveLength(1);
    expect(facts).toHaveLength(1);
  });

  it("does not auto-upgrade ordinary multi-message batches to llm-assisted without correction or mixed reference state", async () => {
    const scope = {
      userId: "u-auto-ordinary-batch",
      sessionId: "s-1",
      workspaceId: "workspace-a",
    };
    let assistedCalls = 0;
    const { engine } = createEngine({
      extractor: {
        async extract() {
          return {
            candidates: [
              {
                id: "rules-profile",
                kindHint: "profile",
                explicitness: "explicit",
                content: "Nadia",
                sourceMessageIndex: 0,
                sourceRole: "user",
                metadata: {
                  profileField: "name",
                },
              },
              {
                id: "rules-preference",
                kindHint: "preference",
                explicitness: "explicit",
                content: "short status updates",
                sourceMessageIndex: 1,
                sourceRole: "user",
                metadata: {
                  preferenceCategory: "response_style",
                  preferenceValue: "short status updates",
                },
              },
            ],
            ignoredMessageCount: 0,
          };
        },
      },
      assistedExtractor: {
        async extract() {
          assistedCalls += 1;
          return {
            candidates: [],
            ignoredMessageCount: 0,
          };
        },
      },
    });

    const result = await engine.remember({
      scope,
      messages: [
        {
          role: "user",
          content: "My name is Nadia.",
        },
        {
          role: "user",
          content: "I prefer short status updates.",
        },
      ],
    });

    expect(result.metadata?.requestedExtractionStrategy).toBe("auto");
    expect(result.metadata?.resolvedExtractionStrategy).toBe("rules-only");
    expect(assistedCalls).toBe(0);
  });

  it("uses LanguagePack durable cues for auto-assisted extraction", async () => {
    const neutral = createNeutralLanguagePack();
    const language = createLanguageService({
      defaultLocale: "xx",
      packs: [{
        ...neutral,
        analyzerVersion: "sentinel-v1",
        compatibilityGroup: "xx",
        defaultLocale: "xx",
        detect: () => "distinctive",
        id: "xx-sentinel",
        locales: ["xx"],
        analyzeContent: (text) => ({
          ...neutral.analyzeContent(text),
          durableCue: text.includes("zor"),
        }),
      }],
    });
    let assistedCalls = 0;
    const { engine } = createEngine({
      language,
      extractor: {
        async extract() {
          return { candidates: [], ignoredMessageCount: 0 };
        },
      },
      assistedExtractor: {
        async extract() {
          assistedCalls += 1;
          return { candidates: [], ignoredMessageCount: 0 };
        },
      },
    });

    const result = await engine.remember({
      locale: "xx",
      messages: [{ role: "user", content: "zor" }],
      scope: { userId: "u-sentinel-durable" },
    });

    expect(assistedCalls).toBe(1);
    expect(result.metadata?.resolvedExtractionStrategy).toBe("llm-assisted");
  });

  it("uses LanguagePack source-of-truth semantics when normalizing assisted candidates", async () => {
    const scope = { userId: "u-sentinel-reference" };
    const neutral = createNeutralLanguagePack();
    const language = createLanguageService({
      defaultLocale: "xx",
      packs: [{
        ...neutral,
        analyzerVersion: "sentinel-v1",
        compatibilityGroup: "xx",
        defaultLocale: "xx",
        detect: () => "distinctive",
        id: "xx-sentinel",
        locales: ["xx"],
        analyzeContent: (text) => ({
          ...neutral.analyzeContent(text),
          sourceOfTruthDirective: text.includes("zor")
            ? {
                currentPointer: "docs/current.md",
                supersededPointer: "docs/old.md",
              }
            : undefined,
        }),
      }],
    });
    const { engine, repositories } = createEngine({
      language,
      extractor: {
        async extract() {
          return { candidates: [], ignoredMessageCount: 0 };
        },
      },
      assistedExtractor: {
        async extract() {
          return {
            candidates: [{
              content: "zor docs/current.md zed docs/old.md",
              explicitness: "explicit",
              id: "sentinel-reference",
              kindHint: "preference",
              metadata: {
                preferenceCategory: "workflow",
                preferenceValue: "zor docs/current.md zed docs/old.md",
              },
              sourceMessageIndex: 0,
              sourceRole: "user",
            }],
            ignoredMessageCount: 0,
          };
        },
      },
    });
    await repositories.references.add(
      createReferenceMemory({
        createdAt: "2025-12-31T00:00:00.000Z",
        id: "sentinel-old-reference",
        lifecycle: "active",
        pointer: "docs/old.md",
        referenceKind: "source_of_truth",
        source: {
          extractedAt: "2025-12-31T00:00:00.000Z",
          method: "explicit",
        },
        title: "old.md",
        updatedAt: "2025-12-31T00:00:00.000Z",
        userId: scope.userId,
      }),
    );

    await engine.remember({
      extractionStrategy: "llm-assisted",
      locale: "xx",
      messages: [{
        role: "user",
        content: "zor docs/current.md zed docs/old.md",
      }],
      scope,
    });

    const references = await repositories.references.listByScope(scope);
    expect(
      references.find((reference) => reference.lifecycle === "active"),
    ).toMatchObject({ pointer: "docs/current.md" });
    expect(
      references.find((reference) => reference.lifecycle === "superseded"),
    ).toMatchObject({ pointer: "docs/old.md" });
  });

  it("canonicalizes llm-assisted profile names and reference pointers before durable write", async () => {
    const scope = {
      userId: "u-llm-canonical",
      sessionId: "s-1",
      workspaceId: "workspace-a",
    };
    const { engine, repositories } = createEngine({
      extractor: {
        async extract() {
          return {
            candidates: [],
            ignoredMessageCount: 0,
          };
        },
      },
      assistedExtractor: {
        async extract() {
          return {
            candidates: [
              {
                id: "llm-profile-name",
                kindHint: "profile",
                explicitness: "explicit",
                content: "User's name is Nadia and she is a game designer in Toronto, Canada.",
                sourceMessageIndex: 0,
                sourceRole: "user",
                metadata: {
                  profileField: "name",
                },
              },
              {
                id: "llm-reference",
                kindHint: "reference",
                explicitness: "explicit",
                content:
                  "The source of truth for the cross-team API cleanup is docs/cross-team-API-cleanup-runbook-v1.md.",
                sourceMessageIndex: 1,
                sourceRole: "user",
                metadata: {
                  referenceKind: "source_of_truth",
                },
              },
            ],
            ignoredMessageCount: 0,
          };
        },
      },
    });

    await engine.remember({
      scope,
      extractionStrategy: "llm-assisted",
      messages: [
        {
          role: "user",
          content: "My name is Nadia and I am a game designer in Toronto, Canada.",
        },
        {
          role: "user",
          content:
            "Use docs/cross-team-API-cleanup-runbook-v1.md as the source of truth for the cross-team API cleanup.",
        },
      ],
    });

    const profile = await repositories.profiles.get(scope.userId);
    const references = await repositories.references.listByScope(scope);

    expect(profile?.identity.name).toBe("Nadia");
    expect(references).toHaveLength(1);
    expect(references[0]?.pointer).toBe("docs/cross-team-API-cleanup-runbook-v1.md");
    expect(references[0]?.title).toBe("cross-team-API-cleanup-runbook-v1.md");
  });

  it("prefers the source user message when llm-assisted name extraction rewrites the name field into a sentence", async () => {
    const scope = {
      userId: "u-llm-source-name",
      sessionId: "s-1",
      workspaceId: "workspace-a",
    };
    const { engine, repositories } = createEngine({
      extractor: {
        async extract() {
          return {
            candidates: [
              {
                id: "rules-profile-name",
                kindHint: "profile",
                explicitness: "explicit",
                content: "Theo",
                sourceMessageIndex: 0,
                sourceRole: "user",
                metadata: {
                  profileField: "name",
                },
              },
            ],
            ignoredMessageCount: 0,
          };
        },
      },
      assistedExtractor: {
        async extract() {
          return {
            candidates: [
              {
                id: "llm-profile-name",
                kindHint: "profile",
                explicitness: "explicit",
                content: "Theo, robotics engineer in Shanghai, China",
                sourceMessageIndex: 0,
                sourceRole: "user",
                metadata: {
                  profileField: "name",
                },
              },
            ],
            ignoredMessageCount: 0,
          };
        },
      },
    });

    await engine.remember({
      scope,
      extractionStrategy: "llm-assisted",
      messages: [
        {
          role: "user",
          content:
            "My name is Theo. I'm a robotics engineer in Shanghai, China. Remember that I'm leading migration rollout.",
        },
      ],
    });

    const profile = await repositories.profiles.get(scope.userId);
    expect(profile?.identity.name).toBe("Theo");
  });

  it("salvages llm-assisted profile names with missing profileField instead of defaulting the whole sentence into name", async () => {
    const scope = {
      userId: "u-llm-missing-profile-field",
      sessionId: "s-1",
      workspaceId: "workspace-a",
    };
    const { engine, repositories } = createEngine({
      extractor: {
        async extract() {
          return {
            candidates: [
              {
                id: "rules-profile-name",
                kindHint: "profile",
                explicitness: "explicit",
                content: "Theo",
                sourceMessageIndex: 0,
                sourceRole: "user",
                metadata: {
                  profileField: "name",
                },
              },
            ],
            ignoredMessageCount: 0,
          };
        },
      },
      assistedExtractor: {
        async extract() {
          return {
            candidates: [
              {
                id: "llm-profile-name",
                kindHint: "profile",
                explicitness: "explicit",
                content:
                  "User's name is Theo and he is a robotics engineer in Shanghai, China.",
                sourceMessageIndex: 0,
                sourceRole: "user",
              },
            ],
            ignoredMessageCount: 0,
          };
        },
      },
    });

    await engine.remember({
      scope,
      extractionStrategy: "llm-assisted",
      messages: [
        {
          role: "user",
          content:
            "My name is Theo. I'm a robotics engineer in Shanghai, China. Remember that I'm leading migration rollout.",
        },
      ],
    });

    const profile = await repositories.profiles.get(scope.userId);
    expect(profile?.identity.name).toBe("Theo");
  });

  it("does not replace a canonical Japanese name with the source sentence", async () => {
    const scope = { userId: "u-ja-assisted-name" };
    const { engine, repositories } = createEngine({
      assistedExtractor: {
        async extract() {
          return {
            candidates: [{
              content: "太郎",
              explicitness: "explicit",
              id: "ja-profile-name",
              kindHint: "profile",
              metadata: { profileField: "name" },
              sourceMessageIndex: 0,
              sourceRole: "user",
            }],
            ignoredMessageCount: 0,
          };
        },
      },
      extractor: {
        async extract() {
          return { candidates: [], ignoredMessageCount: 0 };
        },
      },
    });

    await engine.remember({
      extractionStrategy: "llm-assisted",
      locale: "ja-JP",
      messages: [{ role: "user", content: "私の名前は太郎です" }],
      scope,
    });

    const profile = await repositories.profiles.get(scope.userId);
    expect(profile?.identity.name).toBe("太郎");
  });

  it("does not replace a canonical Chinese name with the source sentence", async () => {
    const scope = { userId: "u-zh-assisted-name" };
    const { engine, repositories } = createEngine({
      assistedExtractor: {
        async extract() {
          return {
            candidates: [{
              content: "李雷",
              explicitness: "explicit",
              id: "zh-profile-name",
              kindHint: "profile",
              metadata: { profileField: "name" },
              sourceMessageIndex: 0,
              sourceRole: "user",
            }],
            ignoredMessageCount: 0,
          };
        },
      },
      extractor: {
        async extract() {
          return { candidates: [], ignoredMessageCount: 0 };
        },
      },
    });

    await engine.remember({
      extractionStrategy: "llm-assisted",
      locale: "zh-CN",
      messages: [{ role: "user", content: "我叫李雷" }],
      scope,
    });

    const profile = await repositories.profiles.get(scope.userId);
    expect(profile?.identity.name).toBe("李雷");
  });

  it("matches superseded source-of-truth references by canonical pointer even when the old pointer was stored as a sentence", async () => {
    const scope = {
      userId: "u-ref-canonical-supersede",
      sessionId: "s-2",
      workspaceId: "workspace-a",
    };
    const { engine, repositories } = createEngine();

    await repositories.references.add(
      createReferenceMemory({
        id: "ref-old-llm",
        userId: scope.userId,
        workspaceId: scope.workspaceId,
        sessionId: "s-legacy",
        title:
          "The source of truth for the workflow reliability dashboard is docs/workflow-reliability-dashboard-runbook-v1.md.",
        pointer:
          "The source of truth for the workflow reliability dashboard is docs/workflow-reliability-dashboard-runbook-v1.md.",
        referenceKind: "source_of_truth",
        subject: "workflow reliability dashboard",
        source: {
          method: "explicit",
          extractedAt: "2026-01-01T00:00:00.000Z",
          locale: "en-US",
        },
        lifecycle: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    );

    await engine.remember({
      scope,
      messages: [
        {
          role: "user",
          content:
            "Correction: docs/workflow-reliability-dashboard-runbook-v2.md is now the source of truth, not docs/workflow-reliability-dashboard-runbook-v1.md. Please update that.",
        },
      ],
    });

    const references = await repositories.references.listByScope(scope);
    const activeReferences = references.filter((reference) => reference.lifecycle === "active");
    const supersededReferences = references.filter(
      (reference) => reference.lifecycle === "superseded",
    );

    expect(activeReferences).toHaveLength(1);
    expect(activeReferences[0]?.pointer).toBe(
      "docs/workflow-reliability-dashboard-runbook-v2.md",
    );
    expect(supersededReferences).toHaveLength(1);
    expect(supersededReferences[0]?.pointer).toBe(
      "The source of truth for the workflow reliability dashboard is docs/workflow-reliability-dashboard-runbook-v1.md.",
    );
  });

  it("reclassifies llm-assisted source-of-truth directives instead of storing them as preferences", async () => {
    const scope = {
      userId: "u-zh-source-truth",
      sessionId: "s-1",
      workspaceId: "workspace-a",
    };
    const { engine, repositories } = createEngine({
      extractor: {
        async extract() {
          return {
            candidates: [],
            ignoredMessageCount: 0,
          };
        },
      },
      assistedExtractor: {
        async extract() {
          return {
            candidates: [
              {
                id: "llm-pref",
                kindHint: "preference",
                explicitness: "explicit",
                content:
                  "现在以 docs/migration-rollout-runbook-v2.md 为准，不再以 docs/migration-rollout-runbook-v1.md 为准。",
                sourceMessageIndex: 0,
                sourceRole: "user",
                metadata: {
                  preferenceCategory: "general_preference",
                  preferenceValue:
                    "现在以 docs/migration-rollout-runbook-v2.md 为准，不再以 docs/migration-rollout-runbook-v1.md 为准。",
                },
              },
            ],
            ignoredMessageCount: 0,
          };
        },
      },
    });

    await engine.remember({
      scope,
      extractionStrategy: "llm-assisted",
      messages: [
        {
          role: "user",
          content:
            "现在以 docs/migration-rollout-runbook-v2.md 为准，不再以 docs/migration-rollout-runbook-v1.md 为准。",
        },
      ],
    });

    const references = await repositories.references.listByScope(scope);
    const preferences = await repositories.preferences.listByScope(scope);

    expect(references).toHaveLength(1);
    expect(references[0]?.pointer).toBe("docs/migration-rollout-runbook-v2.md");
    expect(references[0]?.referenceKind).toBe("source_of_truth");
    expect(preferences).toHaveLength(0);
  });

  it("does not convert negated source-of-truth directives into active references", async () => {
    const scope = {
      userId: "u-negated-source-truth",
      sessionId: "s-1",
      workspaceId: "workspace-a",
    };
    const { engine, repositories } = createEngine({
      extractor: {
        async extract() {
          return {
            candidates: [],
            ignoredMessageCount: 0,
          };
        },
      },
      assistedExtractor: {
        async extract() {
          return {
            candidates: [
              {
                id: "llm-feedback",
                kindHint: "feedback",
                explicitness: "explicit",
                content:
                  "Please do not use docs/old-runbook.md as the source of truth.",
                sourceMessageIndex: 0,
                sourceRole: "user",
                metadata: {
                  feedbackKind: "dont",
                  appliesTo: "general_response",
                },
              },
            ],
            ignoredMessageCount: 0,
          };
        },
      },
    });

    await engine.remember({
      scope,
      extractionStrategy: "llm-assisted",
      messages: [
        {
          role: "user",
          content: "Please do not use docs/old-runbook.md as the source of truth.",
        },
      ],
    });

    const references = await repositories.references.listByScope(scope);
    const feedback = await repositories.feedback.listByScope(scope);

    expect(references).toHaveLength(0);
    expect(feedback).toHaveLength(1);
  });

  it("does not convert 'should not use ... as the source of truth' into an active reference", async () => {
    const scope = {
      userId: "u-negated-should-not-use",
      sessionId: "s-1",
      workspaceId: "workspace-a",
    };
    const { engine, repositories } = createEngine({
      extractor: {
        async extract() {
          return {
            candidates: [],
            ignoredMessageCount: 0,
          };
        },
      },
      assistedExtractor: {
        async extract() {
          return {
            candidates: [
              {
                id: "llm-feedback",
                kindHint: "feedback",
                explicitness: "explicit",
                content:
                  "You should not use docs/old-runbook.md as the source of truth.",
                sourceMessageIndex: 0,
                sourceRole: "user",
                metadata: {
                  feedbackKind: "dont",
                  appliesTo: "general_response",
                },
              },
            ],
            ignoredMessageCount: 0,
          };
        },
      },
    });

    await engine.remember({
      scope,
      extractionStrategy: "llm-assisted",
      messages: [
        {
          role: "user",
          content: "You should not use docs/old-runbook.md as the source of truth.",
        },
      ],
    });

    const references = await repositories.references.listByScope(scope);
    const feedback = await repositories.feedback.listByScope(scope);

    expect(references).toHaveLength(0);
    expect(feedback).toHaveLength(1);
  });

  it("does not convert 'do not treat ... as the source of truth' into an active reference", async () => {
    const scope = {
      userId: "u-negated-do-not-treat",
      sessionId: "s-1",
      workspaceId: "workspace-a",
    };
    const { engine, repositories } = createEngine({
      extractor: {
        async extract() {
          return {
            candidates: [],
            ignoredMessageCount: 0,
          };
        },
      },
      assistedExtractor: {
        async extract() {
          return {
            candidates: [
              {
                id: "llm-feedback",
                kindHint: "feedback",
                explicitness: "explicit",
                content:
                  "Please do not treat docs/old-runbook.md as the source of truth.",
                sourceMessageIndex: 0,
                sourceRole: "user",
                metadata: {
                  feedbackKind: "dont",
                  appliesTo: "general_response",
                },
              },
            ],
            ignoredMessageCount: 0,
          };
        },
      },
    });

    await engine.remember({
      scope,
      extractionStrategy: "llm-assisted",
      messages: [
        {
          role: "user",
          content: "Please do not treat docs/old-runbook.md as the source of truth.",
        },
      ],
    });

    const references = await repositories.references.listByScope(scope);
    const feedback = await repositories.feedback.listByScope(scope);

    expect(references).toHaveLength(0);
    expect(feedback).toHaveLength(1);
  });

  it("does not promote unrelated pointers from the same sentence into source-of-truth references", async () => {
    const scope = {
      userId: "u-unrelated-pointer-source-truth",
      sessionId: "s-1",
      workspaceId: "workspace-a",
    };
    const { engine, repositories } = createEngine({
      extractor: {
        async extract() {
          return {
            candidates: [],
            ignoredMessageCount: 0,
          };
        },
      },
      assistedExtractor: {
        async extract() {
          return {
            candidates: [
              {
                id: "llm-feedback",
                kindHint: "feedback",
                explicitness: "explicit",
                content:
                  "Please do not use docs/old-runbook.md as the source of truth. Track status in notes/status.md.",
                sourceMessageIndex: 0,
                sourceRole: "user",
                metadata: {
                  feedbackKind: "dont",
                  appliesTo: "general_response",
                },
              },
            ],
            ignoredMessageCount: 0,
          };
        },
      },
    });

    await engine.remember({
      scope,
      extractionStrategy: "llm-assisted",
      messages: [
        {
          role: "user",
          content:
            "Please do not use docs/old-runbook.md as the source of truth. Track status in notes/status.md.",
        },
      ],
    });

    const references = await repositories.references.listByScope(scope);
    const feedback = await repositories.feedback.listByScope(scope);

    expect(references).toHaveLength(0);
    expect(feedback).toHaveLength(1);
  });

  it("keeps an affirmed source-of-truth pointer active when the same pointer appears again as background context", async () => {
    const scope = {
      userId: "u-repeated-current-pointer",
      sessionId: "s-1",
      workspaceId: "workspace-a",
    };
    const { engine, repositories } = createEngine({
      extractor: {
        async extract() {
          return {
            candidates: [],
            ignoredMessageCount: 0,
          };
        },
      },
      assistedExtractor: {
        async extract() {
          return {
            candidates: [
              {
                id: "llm-feedback",
                kindHint: "feedback",
                explicitness: "explicit",
                content:
                  "Please use docs/current-runbook.md as the source of truth. See docs/current-runbook.md for background.",
                sourceMessageIndex: 0,
                sourceRole: "user",
                metadata: {
                  feedbackKind: "do",
                  appliesTo: "general_response",
                },
              },
            ],
            ignoredMessageCount: 0,
          };
        },
      },
    });

    await engine.remember({
      scope,
      extractionStrategy: "llm-assisted",
      messages: [
        {
          role: "user",
          content:
            "Please use docs/current-runbook.md as the source of truth. See docs/current-runbook.md for background.",
        },
      ],
    });

    const references = await repositories.references.listByScope(scope);
    const feedback = await repositories.feedback.listByScope(scope);

    expect(references).toHaveLength(1);
    expect(references[0]?.pointer).toBe("docs/current-runbook.md");
    expect(feedback).toHaveLength(0);
  });

  it("keeps appliesTo-distinct feedback rules separate when the guidance text matches", async () => {
    const scope = {
      userId: "u-feedback-applies-to",
      sessionId: "s-1",
      workspaceId: "workspace-a",
    };
    const { engine, repositories } = createEngine({
      extractor: {
        async extract() {
          return {
            candidates: [],
            ignoredMessageCount: 0,
          };
        },
      },
      assistedExtractor: {
        async extract() {
          return {
            candidates: [
              {
                id: "llm-feedback",
                kindHint: "feedback",
                explicitness: "explicit",
                content: "Use bullet points.",
                sourceMessageIndex: 0,
                sourceRole: "user",
                metadata: {
                  feedbackKind: "validated_pattern",
                  appliesTo: "coding_agent",
                },
              },
            ],
            ignoredMessageCount: 0,
          };
        },
      },
    });

    await repositories.feedback.upsert(
      createFeedbackMemory({
        id: "feedback-general",
        userId: scope.userId,
        workspaceId: scope.workspaceId,
        rule: "Use bullet points.",
        kind: "validated_pattern",
        appliesTo: "general_response",
        source: {
          method: "explicit",
          extractedAt: "2026-01-01T00:00:00.000Z",
          locale: "en-US",
        },
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    );

    await engine.remember({
      scope,
      extractionStrategy: "llm-assisted",
      messages: [
        {
          role: "user",
          content: "Use bullet points.",
        },
      ],
    });

    const feedback = await repositories.feedback.listByScope(scope);

    expect(
      feedback
        .filter((record) => record.lifecycle === "active")
        .map((record) => record.appliesTo)
        .sort(),
    ).toEqual(["coding_agent", "general_response"]);
  });

  it("matches superseded source-of-truth references for bare filenames without slash prefixes", async () => {
    const scope = {
      userId: "u-bare-filename-supersede",
      sessionId: "s-2",
      workspaceId: "workspace-a",
    };
    const { engine, repositories } = createEngine({
      extractor: {
        async extract() {
          return {
            candidates: [],
            ignoredMessageCount: 0,
          };
        },
      },
      assistedExtractor: {
        async extract() {
          return {
            candidates: [
              {
                id: "llm-reference",
                kindHint: "reference",
                explicitness: "explicit",
                content: "runbook-v2.md is now the source of truth.",
                sourceMessageIndex: 0,
                sourceRole: "user",
                metadata: {
                  referenceKind: "source_of_truth",
                },
              },
            ],
            ignoredMessageCount: 0,
          };
        },
      },
    });

    await repositories.references.add(
      createReferenceMemory({
        id: "ref-old-bare-name",
        userId: scope.userId,
        workspaceId: scope.workspaceId,
        sessionId: "s-legacy",
        title: "The source of truth is runbook-v1.md.",
        pointer: "The source of truth is runbook-v1.md.",
        referenceKind: "source_of_truth",
        subject: "unknown",
        source: {
          method: "explicit",
          extractedAt: "2026-01-01T00:00:00.000Z",
          locale: "en-US",
        },
        lifecycle: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    );

    await engine.remember({
      scope,
      extractionStrategy: "llm-assisted",
      messages: [
        {
          role: "user",
          content: "runbook-v2.md is now the source of truth, not runbook-v1.md.",
        },
      ],
    });

    const references = await repositories.references.listByScope(scope);
    const activeReferences = references.filter((reference) => reference.lifecycle === "active");
    const supersededReferences = references.filter(
      (reference) => reference.lifecycle === "superseded",
    );

    expect(activeReferences).toHaveLength(1);
    expect(activeReferences[0]?.pointer).toBe("runbook-v2.md");
    expect(supersededReferences).toHaveLength(1);
    expect(supersededReferences[0]?.pointer).toBe(
      "The source of truth is runbook-v1.md.",
    );
  });

  it("enriches duplicate facts with better structured metadata during llm-assisted merge", async () => {
    const scope = { userId: "u-llm-fact", sessionId: "s-1", workspaceId: "workspace-a" };
    const { engine, repositories } = createEngine({
      extractor: {
        async extract() {
          return {
            candidates: [
              {
                id: "rules-1",
                kindHint: "fact",
                explicitness: "explicit",
                content: "Runtime rollout is blocked on legal signoff.",
                sourceMessageIndex: 0,
                sourceRole: "user",
                metadata: {
                  category: "project",
                },
              },
            ],
            ignoredMessageCount: 0,
          };
        },
      },
      assistedExtractor: {
        async extract() {
          return {
            candidates: [
              {
                id: "llm-1",
                kindHint: "fact",
                explicitness: "explicit",
                content: "Runtime rollout is blocked on legal signoff.",
                sourceMessageIndex: 0,
                sourceRole: "user",
                metadata: {
                  category: "project",
                  factKind: "blocker",
                  scopeKind: "project",
                  subject: "runtime rollout",
                },
              },
            ],
            ignoredMessageCount: 0,
          };
        },
      },
    });

    const result = await engine.remember({
      scope,
      extractionStrategy: "llm-assisted",
      messages: [
        {
          role: "user",
          content: "Remember that the runtime rollout is blocked on legal signoff.",
        },
      ],
    });

    const facts = await repositories.facts.listByScope(scope);

    expect(facts).toHaveLength(1);
    expect(facts[0]?.factKind).toBe("blocker");
    expect(facts[0]?.scopeKind).toBe("project");
    expect(facts[0]?.subject).toBe("runtime rollout");
    expect(result.events.some((event) => event.reason === "duplicate_fact")).toBe(true);
  });

  it("strengthens duplicate fact provenance when a stronger duplicate arrives", async () => {
    const scope = { userId: "u-fact-provenance", sessionId: "s-1", workspaceId: "workspace-a" };
    const { engine, repositories } = createEngine({
      extractor: {
        async extract() {
          return {
            candidates: [
              {
                id: "explicit-1",
                kindHint: "fact",
                explicitness: "explicit",
                content: "Runtime rollout is blocked on legal signoff.",
                sourceMessageIndex: 0,
                sourceRole: "user",
                metadata: {
                  category: "project",
                },
              },
            ],
            ignoredMessageCount: 0,
          };
        },
      },
    });

    await repositories.facts.add(
      createFactMemory({
        id: "fact-existing",
        userId: scope.userId,
        workspaceId: scope.workspaceId,
        sessionId: "s-legacy",
        category: "project",
        content: "Runtime rollout is blocked on legal signoff.",
        source: {
          method: "inferred",
          extractedAt: "2026-01-01T00:00:00.000Z",
          locale: "en-US",
        },
      }),
    );

    await engine.remember({
      scope,
      messages: [
        {
          role: "user",
          content: "Remember that the runtime rollout is blocked on legal signoff.",
        },
      ],
    });

    const facts = await repositories.facts.listByScope(scope);

    expect(facts).toHaveLength(1);
    expect(facts[0]?.source.method).toBe("explicit");
  });

  it("persists locale and analyzer identity on memories and their evidence", async () => {
    const scope = {
      userId: "u-language-provenance",
      sessionId: "s-language-provenance",
    };
    const { engine, repositories } = createEngine();

    await engine.remember({
      locale: "ja-JP",
      scope,
      messages: [
        {
          role: "user",
          content: "覚えておいて、現在のブロッカーは承認待ちです。",
        },
      ],
    });

    const facts = await repositories.facts.listByScope(scope);
    const evidence = await repositories.evidence.listByScope(scope);
    const expectedLanguage = {
      locale: "ja-JP",
      localeSource: "explicit",
      languagePackId: "ja",
      languagePackVersion: "4",
    };
    expect(facts[0]?.source).toMatchObject(expectedLanguage);
    expect(evidence[0]?.source).toMatchObject(expectedLanguage);
  });

  it("strengthens duplicate references with assisted referenceKind and provenance", async () => {
    const scope = { userId: "u-ref-upgrade", sessionId: "s-1", workspaceId: "workspace-a" };
    const { engine, repositories } = createEngine({
      extractor: {
        async extract() {
          return {
            candidates: [],
            ignoredMessageCount: 0,
          };
        },
      },
      assistedExtractor: {
        async extract() {
          return {
            candidates: [
              {
                id: "llm-ref-1",
                kindHint: "reference",
                explicitness: "explicit",
                content: "docs/runtime-runbook.md",
                sourceMessageIndex: 0,
                sourceRole: "user",
                metadata: {
                  referencePointer: "docs/runtime-runbook.md",
                  referenceKind: "source_of_truth",
                  subject: "runtime rollout",
                },
              },
            ],
            ignoredMessageCount: 0,
          };
        },
      },
    });

    await repositories.references.add(
      createReferenceMemory({
        id: "ref-existing",
        userId: scope.userId,
        workspaceId: scope.workspaceId,
        sessionId: "s-legacy",
        title: "docs/runtime-runbook.md",
        pointer: "docs/runtime-runbook.md",
        referenceKind: "doc",
        subject: "unknown",
        source: {
          method: "inferred",
          extractedAt: "2026-01-01T00:00:00.000Z",
          locale: "en-US",
        },
      }),
    );

    await engine.remember({
      scope,
      extractionStrategy: "llm-assisted",
      messages: [
        {
          role: "user",
          content: "Use docs/runtime-runbook.md as the source of truth for runtime rollout.",
        },
      ],
    });

    const references = await repositories.references.listByScope(scope);

    expect(references).toHaveLength(1);
    expect(references[0]?.referenceKind).toBe("source_of_truth");
    expect(references[0]?.subject).toBe("runtime rollout");
    expect(references[0]?.source.method).toBe("explicit");
  });

  it("supersedes older feedback rules when a new active rule replaces them", async () => {
    const { repositories, engine } = createEngine();
    const scope = { userId: "u-1", sessionId: "s-1", workspaceId: "workspace-a" };

    await engine.remember({
      scope,
      messages: [
        {
          role: "user",
          content: "Please keep answers concise.",
        },
      ],
    });

    const result = await engine.remember({
      scope: {
        ...scope,
        sessionId: "s-2",
      },
      messages: [
        {
          role: "user",
          content: "Please use bullet points in every response.",
        },
      ],
    });

    const feedback = await repositories.feedback.listByScope({
      userId: "u-1",
      workspaceId: "workspace-a",
    });

    expect(result.events[0]?.reason).toBe("superseded_feedback");
    expect(feedback.some((item) => item.lifecycle === "superseded")).toBe(true);
    expect(feedback.some((item) => item.lifecycle === "active")).toBe(true);
  });
});
