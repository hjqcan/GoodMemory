import { describe, expect, it } from "bun:test";

import { createGoodMemory } from "../../src";

const SEMANTIC_BLANK_TEXTS = [
  ["ASCII whitespace", " \t\r\n "],
  ["zero-width space", "\u200B"],
  ["zero-width non-joiner", "\u200C"],
  ["word joiner", "\u2060"],
  ["NUL", "\u0000"],
  ["C0 controls", "\u0000\u0001\u001F"],
  ["C1 controls", "\u007F\u0080\u009F"],
  ["format characters", "\u0600\u0601\u0602"],
  ["mixed whitespace and default-ignorable characters", " \t\u200B\u200C\u2060\r\n"],
] as const;

const VISIBLE_NUL_TEXT = "project\u0000code=Tachikoma";

describe("public semantic-blank write boundary", () => {
  it("drops a NUL-containing source before extraction, policy, or persistence", async () => {
    let extractorContent = "not-called";
    let policyCalls = 0;
    const memory = createGoodMemory({
      policy: {
        redact(candidate) {
          policyCalls += 1;
          return candidate;
        },
      },
      storage: { provider: "memory" },
      testing: {
        extractor: {
          async extract(input) {
            extractorContent = input.messages[0]?.content ?? "missing";
            return {
              candidates: [{
                id: "candidate-from-invalid-source",
                kindHint: "fact" as const,
                explicitness: "explicit" as const,
                content: "project code=Tachikoma",
                sourceMessageIndex: 0,
                sourceRole: "user" as const,
              }],
              ignoredMessageCount: 0,
            };
          },
        },
      },
    });
    const durableScope = {
      userId: "semantic-invalid-source",
      workspaceId: "semantic-blank",
    };

    const remembered = await memory.remember({
      messages: [{ role: "user", content: "hello\u0000world" }],
      scope: { ...durableScope, sessionId: "teach" },
    });
    const exported = await memory.exportMemory({ scope: durableScope });

    expect(extractorContent).toBe("");
    expect(policyCalls).toBe(0);
    expect(remembered.accepted).toBe(0);
    expect(exported.durable.facts).toEqual([]);
    expect(exported.durable.sourceMessages).toEqual([]);
  });

  it("does not let a NUL-containing assistant message enter episode storage", async () => {
    const memory = createGoodMemory({ storage: { provider: "memory" } });
    const durableScope = {
      userId: "semantic-invalid-assistant-episode",
      workspaceId: "semantic-blank",
    };

    const remembered = await memory.remember({
      messages: [
        {
          role: "user",
          content: "Remember that runtime rollout is blocked on legal signoff.",
        },
        {
          role: "assistant",
          content: "I will keep that blocker\u0000 and the next review step in mind.",
        },
      ],
      scope: { ...durableScope, sessionId: "teach" },
    });
    const exported = await memory.exportMemory({ scope: durableScope });

    expect(remembered.accepted).toBe(1);
    expect(exported.durable.facts).toHaveLength(1);
    expect(exported.durable.episodes).toEqual([]);
    expect(exported.durable.sourceMessages).toHaveLength(1);
    expect(exported.durable.sourceMessages?.[0]?.role).toBe("user");
  });

  it("rejects structured candidates whose evidence content contains NUL", async () => {
    const fixtures = [
      {
        kindHint: "preference" as const,
        metadata: {
          preferenceCategory: "response_style",
          preferenceValue: "concise",
        },
      },
      {
        kindHint: "reference" as const,
        metadata: {
          referenceKind: "doc" as const,
          referencePointer: "docs/current.md",
        },
      },
    ] as const;

    for (const [index, fixture] of fixtures.entries()) {
      const memory = createGoodMemory({
        storage: { provider: "memory" },
        testing: {
          extractor: {
            async extract() {
              return {
                candidates: [{
                  id: `nul-evidence-${index}`,
                  kindHint: fixture.kindHint,
                  explicitness: "explicit" as const,
                  content: "visible\u0000evidence",
                  metadata: fixture.metadata,
                  sourceMessageIndex: 0,
                  sourceRole: "user" as const,
                }],
                ignoredMessageCount: 0,
              };
            },
          },
        },
      });
      const durableScope = {
        userId: `semantic-nul-evidence-${index}`,
        workspaceId: "semantic-blank",
      };

      const remembered = await memory.remember({
        messages: [{ role: "user", content: "safe source" }],
        scope: { ...durableScope, sessionId: "teach" },
      });

      expect(remembered).toMatchObject({
        accepted: 0,
        rejected: 1,
        events: [expect.objectContaining({ reason: "invalid_payload" })],
      });
    }
  });

  for (const [name, content] of SEMANTIC_BLANK_TEXTS) {
    it(`rejects an explicit fact containing only ${name}`, async () => {
      const memory = createGoodMemory({
        storage: { provider: "memory" },
        testing: {
          extractor: {
            async extract() {
              return {
                candidates: [{
                  id: `blank-${name}`,
                  kindHint: "fact" as const,
                  explicitness: "explicit" as const,
                  content,
                  sourceMessageIndex: 0,
                  sourceRole: "user" as const,
                }],
                ignoredMessageCount: 0,
              };
            },
          },
        },
      });
      const durableScope = {
        userId: `semantic-blank-${name}`,
        workspaceId: "semantic-blank",
      };

      const remembered = await memory.remember({
        messages: [{ role: "user", content: "source" }],
        scope: { ...durableScope, sessionId: "teach" },
      });
      const exported = await memory.exportMemory({ scope: durableScope });

      expect(remembered).toMatchObject({
        accepted: 0,
        rejected: 1,
        events: [expect.objectContaining({ reason: "invalid_payload" })],
      });
      expect(exported.durable.facts).toEqual([]);
    });
  }

  it("rejects visible fact content containing NUL before storage", async () => {
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      testing: {
        extractor: {
          async extract() {
            return {
              candidates: [{
                id: "visible-with-nul",
                kindHint: "fact" as const,
                explicitness: "explicit" as const,
                content: VISIBLE_NUL_TEXT,
                sourceMessageIndex: 0,
                sourceRole: "user" as const,
              }],
              ignoredMessageCount: 0,
            };
          },
        },
      },
    });
    const durableScope = {
      userId: "semantic-visible-with-nul",
      workspaceId: "semantic-blank",
    };

    const remembered = await memory.remember({
      messages: [{ role: "user", content: "source" }],
      scope: { ...durableScope, sessionId: "teach" },
    });
    const exported = await memory.exportMemory({ scope: durableScope });

    expect(remembered).toMatchObject({
      accepted: 0,
      rejected: 1,
      events: [expect.objectContaining({ reason: "invalid_payload" })],
    });
    expect(exported.durable.facts).toEqual([]);
  });

  it("preserves non-NUL ignored and control characters inside visible fact content", async () => {
    const content = "project\u0001\u0600\u200Ccode=Tachikoma";
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      testing: {
        extractor: {
          async extract() {
            return {
              candidates: [{
                id: "visible-with-joiner",
                kindHint: "fact" as const,
                explicitness: "explicit" as const,
                content,
                sourceMessageIndex: 0,
                sourceRole: "user" as const,
              }],
              ignoredMessageCount: 0,
            };
          },
        },
      },
    });
    const durableScope = {
      userId: "semantic-visible-with-joiner",
      workspaceId: "semantic-blank",
    };

    const remembered = await memory.remember({
      messages: [{ role: "user", content: "source" }],
      scope: { ...durableScope, sessionId: "teach" },
    });
    const exported = await memory.exportMemory({ scope: durableScope });

    expect(remembered).toMatchObject({ accepted: 1, rejected: 0 });
    expect(exported.durable.facts.map((fact) => fact.content)).toEqual([content]);
  });

  for (const [name, content] of SEMANTIC_BLANK_TEXTS) {
    it(`blocks a revision containing only ${name} without supersession`, async () => {
      const originalContent = "release owner=Ren";
      const memory = createGoodMemory({
        storage: { provider: "memory" },
        testing: {
          extractor: {
            async extract() {
              return {
                candidates: [{
                  id: "visible-fact",
                  kindHint: "fact" as const,
                  explicitness: "explicit" as const,
                  content: originalContent,
                  sourceMessageIndex: 0,
                  sourceRole: "user" as const,
                }],
                ignoredMessageCount: 0,
              };
            },
          },
        },
      });
      const scope = {
        sessionId: "teach",
        userId: `semantic-blank-revision-${name}`,
        workspaceId: "semantic-blank",
      };
      const remembered = await memory.remember({
        messages: [{ role: "user", content: "source" }],
        scope,
      });
      const memoryId = remembered.events.find(
        (event) => event.memoryType === "fact",
      )?.memoryId;

      expect(memoryId).toBeString();

      const revised = await memory.reviseMemory({
        idempotencyKey: `semantic-blank-revision-${name}`,
        reason: "user_correction",
        revision: { content },
        scope,
        target: { memoryId: memoryId! },
      });
      const exported = await memory.exportMemory({ scope });

      expect(revised).toMatchObject({
        accepted: false,
        outcome: "blocked",
        previousMemoryId: memoryId,
        reason: "empty_revision",
      });
      expect(exported.durable.facts).toHaveLength(1);
      expect(exported.durable.facts[0]).toMatchObject({
        content: originalContent,
        id: memoryId,
        lifecycle: "active",
      });
    });
  }

  it("blocks a visible revision containing NUL without supersession", async () => {
    const originalContent = "release owner=Ren";
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      testing: {
        extractor: {
          async extract() {
            return {
              candidates: [{
                id: "visible-fact",
                kindHint: "fact" as const,
                explicitness: "explicit" as const,
                content: originalContent,
                sourceMessageIndex: 0,
                sourceRole: "user" as const,
              }],
              ignoredMessageCount: 0,
            };
          },
        },
      },
    });
    const scope = {
      sessionId: "teach",
      userId: "semantic-visible-nul-revision",
      workspaceId: "semantic-blank",
    };
    const remembered = await memory.remember({
      messages: [{ role: "user", content: "source" }],
      scope,
    });
    const memoryId = remembered.events.find(
      (event) => event.memoryType === "fact",
    )?.memoryId;

    expect(memoryId).toBeString();

    const revised = await memory.reviseMemory({
      idempotencyKey: "semantic-visible-nul-revision",
      reason: "user_correction",
      revision: { content: VISIBLE_NUL_TEXT },
      scope,
      target: { memoryId: memoryId! },
    });
    const exported = await memory.exportMemory({ scope });

    expect(revised).toMatchObject({
      accepted: false,
      outcome: "blocked",
      previousMemoryId: memoryId,
      reason: "empty_revision",
    });
    expect(exported.durable.facts).toHaveLength(1);
    expect(exported.durable.facts[0]).toMatchObject({
      content: originalContent,
      id: memoryId,
      lifecycle: "active",
    });
  });

  for (const [name, signal] of SEMANTIC_BLANK_TEXTS) {
    it(`rejects ${name}-only feedback before supersession`, async () => {
      const memory = createGoodMemory({ storage: { provider: "memory" } });
      const scope = {
        sessionId: "teach",
        userId: `semantic-blank-feedback-${name}`,
        workspaceId: "semantic-blank",
      };
      const original = await memory.feedback({
        scope,
        signal: "Please keep release summaries concise.",
      });

      const blocked = await memory.feedback({ scope, signal });
      const exported = await memory.exportMemory({ scope });

      expect(blocked).toEqual({ accepted: false });
      expect(exported.durable.feedback).toHaveLength(1);
      expect(exported.durable.feedback[0]).toMatchObject({
        id: original.memoryId,
        lifecycle: "active",
        rule: "Please keep release summaries concise.",
      });
    });
  }

  it("rejects visible NUL-containing feedback before supersession", async () => {
    const memory = createGoodMemory({ storage: { provider: "memory" } });
    const scope = {
      sessionId: "teach",
      userId: "semantic-visible-nul-feedback",
      workspaceId: "semantic-blank",
    };
    const original = await memory.feedback({
      scope,
      signal: "Please keep release summaries concise.",
    });

    const blocked = await memory.feedback({ scope, signal: VISIBLE_NUL_TEXT });
    const exported = await memory.exportMemory({ scope });

    expect(blocked).toEqual({ accepted: false });
    expect(exported.durable.feedback).toHaveLength(1);
    expect(exported.durable.feedback[0]).toMatchObject({
      id: original.memoryId,
      lifecycle: "active",
      rule: "Please keep release summaries concise.",
    });
  });
});
