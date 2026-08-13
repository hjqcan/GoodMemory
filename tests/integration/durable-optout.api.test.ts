import { describe, expect, it } from "bun:test";

import { createGoodMemory } from "../../src";

const noopAssistedExtractor = {
  async extract() {
    return { candidates: [], ignoredMessageCount: 0 };
  },
};

describe("durable opt-out admission", () => {
  it("rejects exact references, preferences, and profiles with an explicit trace", async () => {
    const fixtures = [
      {
        collection: "references",
        content:
          "Remember two things: use docs/secret.md as the source of truth; do not remember docs/secret.md",
        memoryType: "reference",
      },
      {
        collection: "preferences",
        content:
          "Remember two things: I prefer concise answers; do not remember preference=concise answers",
        memoryType: "preference",
      },
      {
        collection: "profile",
        content:
          "Remember two things: my timezone is Europe/Paris; do not remember timezone=Europe/Paris",
        memoryType: "profile",
      },
      {
        collection: "profile",
        content:
          "Remember two things: my name is Alice; do not remember name=Alice",
        memoryType: "profile",
      },
    ] as const;

    for (const [index, fixture] of fixtures.entries()) {
      const memory = createGoodMemory({
        adapters: { assistedExtractor: noopAssistedExtractor },
        storage: { provider: "memory" },
      });
      const scope = { userId: `durable-opt-out-${index}`, sessionId: "write" };
      const result = await memory.remember({
        extractionStrategy: "rules-only",
        locale: "en-US",
        messages: [{ role: "user", content: fixture.content }],
        scope,
      });
      const exported = await memory.exportMemory({ scope });

      expect(exported.durable[fixture.collection]).toEqual(
        fixture.collection === "profile" ? null : [],
      );
      expect(result.events).toContainEqual(expect.objectContaining({
        memoryType: fixture.memoryType,
        outcome: "rejected",
        reason: "explicit_opt_out",
      }));
      expect(exported.durable.feedback).toHaveLength(1);
      expect(exported.durable.feedback[0]?.kind).toBe("dont");
    }
  });

  it("arbitrates exact targets across language packs", async () => {
    const optOuts = [
      "不要记住项目代号=Tachikoma",
      "プロジェクトコード=Tachikomaは覚えないでください",
      "프로젝트 코드=Tachikoma를 기억하지 마세요",
    ] as const;

    for (const [index, optOut] of optOuts.entries()) {
      const memory = createGoodMemory({
        adapters: { assistedExtractor: noopAssistedExtractor },
        storage: { provider: "memory" },
      });
      const scope = { userId: `cross-pack-opt-out-${index}`, sessionId: "write" };
      const result = await memory.remember({
        extractionStrategy: "rules-only",
        messages: [
          { role: "user", content: "Remember that project code=Tachikoma" },
          { role: "user", content: optOut },
        ],
        scope,
      });
      const exported = await memory.exportMemory({ scope });

      expect(exported.durable.facts).toEqual([]);
      expect(result.events).toContainEqual(expect.objectContaining({
        memoryType: "fact",
        outcome: "rejected",
        reason: "explicit_opt_out",
      }));
      expect(exported.durable.feedback).toHaveLength(1);
    }
  });

  it("vetoes both the original and redacted candidate identity", async () => {
    for (const [index, replacement] of [
      "project code=redacted",
      "project code=Tachikoma",
    ].entries()) {
      const memory = createGoodMemory({
        policy: {
          redact(candidate) {
            return candidate.kindHint === "fact"
              ? { ...candidate, content: replacement }
              : candidate;
          },
        },
        storage: { provider: "memory" },
      });
      const scope = {
        userId: `pre-post-redaction-opt-out-${index}`,
        sessionId: "write",
      };

      const result = await memory.remember({
        extractionStrategy: "rules-only",
        locale: "en-US",
        messages: [{
          role: "user",
          content:
            index === 0
              ? "Remember two things: project code=Tachikoma; do not remember project code=Tachikoma"
              : "Remember two things: project code=GITS; do not remember project code=Tachikoma",
        }],
        scope,
      });
      const exported = await memory.exportMemory({ scope });

      expect(exported.durable.facts).toEqual([]);
      expect(result.events).toContainEqual(expect.objectContaining({
        memoryType: "fact",
        outcome: "rejected",
        reason: "explicit_opt_out",
      }));
      expect(exported.durable.feedback).toHaveLength(1);
    }
  });

  it("preserves symbols when comparing durable opt-out targets", async () => {
    const memory = createGoodMemory({
      adapters: { assistedExtractor: noopAssistedExtractor },
      storage: { provider: "memory" },
    });
    const scope = { userId: "symbol-safe-opt-out", sessionId: "write" };

    await memory.remember({
      extractionStrategy: "rules-only",
      locale: "en-US",
      messages: [{
        role: "user",
        content: "Remember two things: language=C#; do not remember language=C++",
      }],
      scope,
    });
    const exported = await memory.exportMemory({ scope });

    expect(exported.durable.facts.map(({ content }) => content)).toEqual([
      "language=C#",
    ]);
    expect(exported.durable.feedback).toHaveLength(1);

    const distinctFieldMemory = createGoodMemory({
      adapters: { assistedExtractor: noopAssistedExtractor },
      storage: { provider: "memory" },
    });
    const distinctFieldScope = {
      userId: "field-safe-opt-out",
      sessionId: "write",
    };
    await distinctFieldMemory.remember({
      extractionStrategy: "rules-only",
      locale: "en-US",
      messages: [{
        role: "user",
        content:
          "Remember two things: runtime=production; do not remember environment=production",
      }],
      scope: distinctFieldScope,
    });
    expect(
      (await distinctFieldMemory.exportMemory({ scope: distinctFieldScope }))
        .durable.facts.map(({ content }) => content),
    ).toEqual(["runtime=production"]);
  });

  it("keeps opt-out disposition immutable while policy metadata redaction stays authoritative", async () => {
    const memory = createGoodMemory({
      adapters: { assistedExtractor: noopAssistedExtractor },
      policy: {
        async redact(candidate) {
          return candidate.kindHint === "feedback"
            ? {
              ...candidate,
              content: "Do not retain the private value.",
              kindHint: "fact",
              metadata: undefined,
            }
            : candidate;
        },
      },
      storage: { provider: "memory" },
      testing: {
        extractor: {
          async extract() {
            return {
              candidates: [{
                id: "canonical-dont",
                content: "Do not remember SECRET-PAYLOAD.",
                explicitness: "explicit" as const,
                kindHint: "feedback" as const,
                metadata: {
                  attributes: { privateNote: "SECRET-PAYLOAD" },
                  feedbackKind: "dont" as const,
                  optOutTarget: "SECRET-PAYLOAD",
                },
                sourceMessageIndex: 0,
                sourceRole: "user",
              }],
              ignoredMessageCount: 0,
            };
          },
        },
      },
    });
    const scope = { userId: "policy-redacted-opt-out", sessionId: "write" };

    await memory.remember({
      extractionStrategy: "rules-only",
      messages: [{ role: "user", content: "Do not remember SECRET-PAYLOAD." }],
      scope,
    });
    const exported = await memory.exportMemory({ scope });
    const serialized = JSON.stringify(exported.durable);

    expect(exported.durable.facts).toEqual([]);
    expect(exported.durable.feedback).toEqual([
      expect.objectContaining({
        attributes: undefined,
        kind: "dont",
        rule: "Do not retain the private value.",
      }),
    ]);
    expect(serialized).not.toContain("SECRET-PAYLOAD");
    expect(serialized).not.toContain("privateNote");
  });
});
