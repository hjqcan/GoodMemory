import { describe, expect, it } from "bun:test";

import { createGoodMemory } from "../../src";
import {
  createInMemoryDocumentStore,
  createInMemorySessionStore,
} from "../../src/storage/memory";

describe("public explicit-fact clause disposition", () => {
  it("does not promote a localized reported opt-out into an opt-out", async () => {
    const fixtures = [
      [
        "en-US",
        "Remember that project code=Tachikoma; I did not say do not remember project code=Tachikoma",
        "project code=Tachikoma",
      ],
      [
        "zh-CN",
        "请记住项目代号=Tachikoma；我没有说不要记住项目代号=Tachikoma",
        "项目代号=Tachikoma",
      ],
      [
        "zh-TW",
        "請記住專案代號=Tachikoma；我沒有說不要記住專案代號=Tachikoma",
        "專案代號=Tachikoma",
      ],
      [
        "fr-FR",
        "Souviens-toi : code projet=Tachikoma; Je n’ai pas dit : ne mémorise pas code projet=Tachikoma",
        "code projet=Tachikoma",
      ],
      [
        "es-ES",
        "Recuerda: código de proyecto=Tachikoma; No dije: no recuerdes código de proyecto=Tachikoma",
        "código de proyecto=Tachikoma",
      ],
      [
        "ja-JP",
        "覚えておいて：プロジェクトコード=Tachikoma；私は言っていません、プロジェクトコード=Tachikomaを覚えないでください",
        "プロジェクトコード=Tachikoma",
      ],
      [
        "ko-KR",
        "기억해 주세요: 프로젝트 코드=Tachikoma; 저는 말하지 않았습니다, 프로젝트 코드=Tachikoma를 기억하지 마세요",
        "프로젝트 코드=Tachikoma",
      ],
    ] as const;

    for (const [locale, content, expectedFact] of fixtures) {
      const memory = createGoodMemory({ storage: { provider: "memory" } });
      const scope = {
        userId: `reported-opt-out-${locale}`,
        workspaceId: "explicit-disposition",
      };

      const result = await memory.remember({
        extractionStrategy: "rules-only",
        locale,
        messages: [{ role: "user", content }],
        scope: { ...scope, sessionId: "teach" },
      });
      const exported = await memory.exportMemory({ scope });

      expect(result.accepted).toBe(1);
      expect(exported.durable.facts).toEqual([
        expect.objectContaining({ content: expectedFact }),
      ]);
      expect(exported.durable.feedback).toEqual([]);
    }
  });

  it("keeps modified opt-out clauses out of durable facts", async () => {
    const fixtures = [
      ["en-US", "Remember two things: editor=Neovim; also do not remember project code=Tachikoma"],
      ["en-US", "Remember two things: editor=Neovim; for GDPR Article 5, do not remember project code=Tachikoma"],
      ["zh-CN", "请记住两件事：编辑器=Neovim；同时不要记住项目代号=Tachikoma"],
      ["fr-FR", "Souviens-toi de deux choses : éditeur=Neovim; surtout ne mémorise pas code projet=Tachikoma"],
      ["es-ES", "Recuerda dos cosas: editor=Neovim; también no recuerdes código de proyecto=Tachikoma"],
    ] as const;

    for (const [locale, content] of fixtures) {
      const memory = createGoodMemory({ storage: { provider: "memory" } });
      const scope = { userId: `modified-opt-out-${locale}`, workspaceId: "explicit-disposition" };
      const result = await memory.remember({
        locale,
        messages: [{ role: "user", content }],
        scope: { ...scope, sessionId: "teach" },
      });
      const exported = await memory.exportMemory({ scope });

      expect(result.accepted).toBe(2);
      expect(exported.durable.facts).toHaveLength(1);
      expect(exported.durable.facts.some(({ content: factContent }) => factContent.includes("Tachikoma"))).toBe(false);
      expect(exported.durable.feedback).toEqual([expect.objectContaining({ kind: "dont" })]);
    }
  });

  it("does not let assisted candidates without feedback metadata reopen an opt-out clause", async () => {
    const fixtures = [
      [
        "en-US",
        "Do not remember that use docs/secret.md as the source of truth",
      ],
      [
        "zh-CN",
        "不要记录以后以 docs/secret.md 为准",
      ],
      [
        "fr-FR",
        "Ne mémorise pas utilise docs/secret.md comme source de vérité",
      ],
      [
        "es-ES",
        "No recuerdes usa docs/secret.md como fuente de verdad",
      ],
      [
        "ja-JP",
        "docs/secret.mdを正とするのは覚えないでください",
      ],
      [
        "ko-KR",
        "docs/secret.md를 기준 문서로 사용한다고 기억하지 마세요",
      ],
    ] as const;

    for (const [locale, source] of fixtures) {
      const documentStore = createInMemoryDocumentStore();
      const memory = createGoodMemory({
        adapters: {
          assistedExtractor: {
            async extract() {
              return {
                candidates: [{
                  id: `assisted-opt-out-${locale}`,
                  kindHint: "feedback" as const,
                  explicitness: "explicit" as const,
                  content: "docs/secret.md",
                  sourceMessageIndex: 0,
                  sourceRole: "user" as const,
                }],
                ignoredMessageCount: 0,
              };
            },
          },
          documentStore,
          sessionStore: createInMemorySessionStore(),
        },
        storage: { provider: "memory" },
      });
      const durableScope = {
        userId: `assisted-opt-out-${locale}`,
        workspaceId: "explicit-disposition",
      };

      const result = await memory.remember({
        extractionStrategy: "llm-assisted",
        locale,
        messages: [{ role: "user", content: source }],
        scope: { ...durableScope, sessionId: "teach" },
      });
      const exported = await memory.exportMemory({ scope: durableScope });

      expect(result.accepted).toBe(1);
      expect(exported.durable.facts).toEqual([]);
      expect(exported.durable.references).toEqual([]);
      expect(exported.durable.feedback).toEqual([
        expect.objectContaining({ kind: "dont" }),
      ]);
    }
  });

  it("drops custom candidates whose only source is an opt-out clause", async () => {
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      testing: {
        extractor: {
          async extract() {
            return {
              candidates: [{
                id: "custom-opt-out-reference",
                kindHint: "reference" as const,
                explicitness: "explicit" as const,
                content: "docs/secret.md",
                metadata: {
                  referenceKind: "source_of_truth" as const,
                  referencePointer: "docs/secret.md",
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
    const durableScope = {
      userId: "custom-only-opt-out",
      workspaceId: "explicit-disposition",
    };

    const result = await memory.remember({
      messages: [{
        role: "user",
        content: "Do not remember that use docs/secret.md as the source of truth",
      }],
      scope: { ...durableScope, sessionId: "teach" },
    });
    const exported = await memory.exportMemory({ scope: durableScope });

    expect(result.accepted).toBe(1);
    expect(exported.durable.references).toEqual([]);
    expect(exported.durable.feedback).toEqual([
      expect.objectContaining({ kind: "dont" }),
    ]);
  });

  it("keeps assisted extraction for non-opt-out messages in the same batch", async () => {
    let assistedInput: readonly { content: string; role: string }[] = [];
    const memory = createGoodMemory({
      adapters: {
        assistedExtractor: {
          async extract(input) {
            assistedInput = input.messages;
            return {
              candidates: [{
                id: "assisted-anniversary",
                kindHint: "fact" as const,
                explicitness: "explicit" as const,
                content: "anniversary=next Tuesday",
                sourceMessageIndex: 0,
                sourceRole: "user",
              }],
              ignoredMessageCount: 0,
            };
          },
        },
        documentStore: createInMemoryDocumentStore(),
        sessionStore: createInMemorySessionStore(),
      },
      storage: { provider: "memory" },
    });
    const durableScope = {
      userId: "mixed-assisted-opt-out",
      workspaceId: "explicit-disposition",
    };

    const result = await memory.remember({
      extractionStrategy: "llm-assisted",
      messages: [
        { role: "user", content: "The anniversary is next Tuesday." },
        { role: "user", content: "Do not remember project code=Tachikoma" },
      ],
      scope: { ...durableScope, sessionId: "teach" },
    });
    const exported = await memory.exportMemory({ scope: durableScope });

    expect(assistedInput.map(({ content }) => content)).toEqual([
      "The anniversary is next Tuesday.",
      "",
    ]);
    expect(result.metadata?.resolvedExtractionStrategy).toBe("llm-assisted");
    expect(exported.durable.facts).toEqual([
      expect.objectContaining({ content: "anniversary=next Tuesday" }),
    ]);
    expect(exported.durable.feedback).toEqual([
      expect.objectContaining({ kind: "dont" }),
    ]);
  });

  it("keeps assisted extraction for an allowed clause beside an opt-out clause", async () => {
    let assistedInput = "";
    const memory = createGoodMemory({
      adapters: {
        assistedExtractor: {
          async extract(input) {
            assistedInput = input.messages[0]?.content ?? "";
            return {
              candidates: [{
                id: "assisted-same-message-anniversary",
                kindHint: "fact" as const,
                explicitness: "explicit" as const,
                content: "anniversary=next Tuesday",
                sourceMessageIndex: 0,
                sourceRole: "user",
              }],
              ignoredMessageCount: 0,
            };
          },
        },
        documentStore: createInMemoryDocumentStore(),
        sessionStore: createInMemorySessionStore(),
      },
      storage: { provider: "memory" },
    });
    const durableScope = {
      userId: "same-message-assisted-opt-out",
      workspaceId: "explicit-disposition",
    };

    const result = await memory.remember({
      extractionStrategy: "llm-assisted",
      messages: [{
        role: "user",
        content:
          "My anniversary is next Tuesday. Do not remember project code=Tachikoma",
      }],
      scope: { ...durableScope, sessionId: "teach" },
    });
    const exported = await memory.exportMemory({ scope: durableScope });

    expect(assistedInput).toContain("anniversary");
    expect(assistedInput).not.toContain("Tachikoma");
    expect(result.metadata?.resolvedExtractionStrategy).toBe("llm-assisted");
    expect(exported.durable.facts).toEqual([
      expect.objectContaining({ content: "anniversary=next Tuesday" }),
    ]);
    expect(exported.durable.feedback).toEqual([
      expect.objectContaining({ kind: "dont" }),
    ]);
  });

  it("sanitizes an opt-out conjunction without hiding its allowed clause", async () => {
    let assistedInput = "";
    const memory = createGoodMemory({
      adapters: {
        assistedExtractor: {
          async extract(input) {
            assistedInput = input.messages[0]?.content ?? "";
            return {
              candidates: [{
                id: "assisted-conjunction-anniversary",
                kindHint: "fact" as const,
                explicitness: "explicit" as const,
                content: "anniversary=Tuesday",
                sourceMessageIndex: 0,
                sourceRole: "user",
              }],
              ignoredMessageCount: 0,
            };
          },
        },
        documentStore: createInMemoryDocumentStore(),
        sessionStore: createInMemorySessionStore(),
      },
      storage: { provider: "memory" },
    });
    const durableScope = {
      userId: "conjunction-assisted-opt-out",
      workspaceId: "explicit-disposition",
    };

    await memory.remember({
      extractionStrategy: "llm-assisted",
      messages: [{
        role: "user",
        content:
          "My anniversary is Tuesday and do not remember project code=Tachikoma",
      }],
      scope: { ...durableScope, sessionId: "teach" },
    });
    const exported = await memory.exportMemory({ scope: durableScope });

    expect(assistedInput).toContain("anniversary");
    expect(assistedInput).not.toContain("Tachikoma");
    expect(exported.durable.facts).toEqual([
      expect.objectContaining({ content: "anniversary=Tuesday" }),
    ]);
    expect(exported.durable.feedback).toEqual([
      expect.objectContaining({ kind: "dont" }),
    ]);
  });

  it("sanitizes opt-out clauses for custom and profile extractors", async () => {
    const seenInputs: string[] = [];
    const extractor = {
      async extract(input: { messages: Array<{ content: string }> }) {
        const content = input.messages[0]?.content ?? "";
        seenInputs.push(content);
        return {
          candidates: content.includes("anniversary")
            ? [{
              id: `producer-anniversary-${seenInputs.length}`,
              kindHint: "fact" as const,
              explicitness: "explicit" as const,
              content: "anniversary=Tuesday",
              sourceMessageIndex: 0,
              sourceRole: "user",
            }]
            : [],
          ignoredMessageCount: 0,
        };
      },
    };
    const memories = [
      createGoodMemory({
        storage: { provider: "memory" },
        testing: { extractor },
      }),
      createGoodMemory({
        remember: {
          profiles: [{ id: "sanitized-profile", extractors: [extractor] }],
        },
        storage: { provider: "memory" },
      }),
    ];

    for (const [index, memory] of memories.entries()) {
      const durableScope = {
        userId: `producer-sanitizer-${index}`,
        workspaceId: "explicit-disposition",
      };
      await memory.remember({
        messages: [{
          role: "user",
          content:
            "My anniversary is Tuesday. Do not remember project code=Tachikoma",
        }],
        scope: { ...durableScope, sessionId: "teach" },
      });
      const exported = await memory.exportMemory({ scope: durableScope });

      expect(exported.durable.facts).toEqual([
        expect.objectContaining({ content: "anniversary=Tuesday" }),
      ]);
      expect(exported.durable.feedback).toEqual([
        expect.objectContaining({ kind: "dont" }),
      ]);
    }

    expect(seenInputs).toHaveLength(2);
    for (const input of seenInputs) {
      expect(input).toContain("anniversary");
      expect(input).not.toContain("Tachikoma");
    }
  });

  it("binds assisted candidate provenance to the actual request message", async () => {
    const fixtures = [
      { sourceMessageIndex: 0, sourceRole: "system" },
      { sourceMessageIndex: 1, sourceRole: "user" },
      { sourceMessageIndex: 99, sourceRole: "user" },
    ] as const;

    for (const fixture of fixtures) {
      let assistedCalls = 0;
      const memory = createGoodMemory({
        adapters: {
          assistedExtractor: {
            async extract() {
              assistedCalls += 1;
              return {
                candidates: [{
                  id: `assisted-provenance-${fixture.sourceMessageIndex}`,
                  kindHint: "reference" as const,
                  explicitness: "explicit" as const,
                  content: "docs/secret.md",
                  metadata: {
                    referenceKind: "source_of_truth" as const,
                    referencePointer: "docs/secret.md",
                  },
                  sourceMessageIndex: fixture.sourceMessageIndex,
                  sourceRole: fixture.sourceRole,
                }],
                ignoredMessageCount: 0,
              };
            },
          },
          documentStore: createInMemoryDocumentStore(),
          sessionStore: createInMemorySessionStore(),
        },
        storage: { provider: "memory" },
      });
      const durableScope = {
        userId: `assisted-provenance-${fixture.sourceMessageIndex}`,
        workspaceId: "explicit-disposition",
      };

      const result = await memory.remember({
        extractionStrategy: "llm-assisted",
        locale: "en-US",
        messages: [{
          role: "user",
          content: "Do not remember that use docs/secret.md as the source of truth",
        }, { role: "user", content: "Hello" }],
        scope: { ...durableScope, sessionId: "teach" },
      });
      const exported = await memory.exportMemory({ scope: durableScope });

      expect(result.accepted).toBe(1);
      expect(assistedCalls).toBe(1);
      expect(exported.durable.references).toEqual([]);
      expect(exported.durable.feedback).toEqual([
        expect.objectContaining({ kind: "dont" }),
      ]);
    }
  });

  it("requires authorization for every assistant source claimed by an assisted candidate", async () => {
    const memory = createGoodMemory({
      adapters: {
        assistedExtractor: {
          async extract() {
            return {
              candidates: [{
                id: "assisted-secondary-assistant",
                kindHint: "fact" as const,
                explicitness: "explicit" as const,
                content: "private assistant detail",
                sourceMessageIndex: 0,
                sourceMessageIndexes: [1],
                sourceRole: "user",
              }],
              ignoredMessageCount: 0,
            };
          },
        },
        documentStore: createInMemoryDocumentStore(),
        sessionStore: createInMemorySessionStore(),
      },
      storage: { provider: "memory" },
    });
    const durableScope = {
      userId: "assisted-secondary-assistant",
      workspaceId: "explicit-disposition",
    };

    const result = await memory.remember({
      extractionStrategy: "llm-assisted",
      messages: [
        { role: "user", content: "ordinary context" },
        { role: "assistant", content: "private assistant detail" },
      ],
      scope: { ...durableScope, sessionId: "teach" },
    });

    expect(result.accepted).toBe(0);
    expect((await memory.exportMemory({ scope: durableScope })).durable.facts).toEqual([]);
  });

  it("uses request messages instead of assisted provenance claims", async () => {
    const fixtures = [
      {
        actualRole: "assistant" as const,
        claimedRole: "user",
        expectedAccepted: 0,
        sourceMessageIndex: 0,
      },
      {
        actualRole: "system" as const,
        claimedRole: "user",
        expectedAccepted: 0,
        sourceMessageIndex: 0,
      },
      {
        actualRole: "user" as const,
        claimedRole: "system",
        expectedAccepted: 1,
        sourceMessageIndex: 0,
      },
      {
        actualRole: "user" as const,
        claimedRole: "user",
        expectedAccepted: 0,
        sourceMessageIndex: 99,
      },
    ] as const;

    for (const [index, fixture] of fixtures.entries()) {
      const memory = createGoodMemory({
        adapters: {
          assistedExtractor: {
            async extract() {
              return {
                candidates: [{
                  id: `assisted-source-binding-${index}`,
                  kindHint: "fact" as const,
                  explicitness: "explicit" as const,
                  content: "launch owner=Maya",
                  sourceMessageIndex: fixture.sourceMessageIndex,
                  sourceRole: fixture.claimedRole,
                }],
                ignoredMessageCount: 0,
              };
            },
          },
          documentStore: createInMemoryDocumentStore(),
          sessionStore: createInMemorySessionStore(),
        },
        storage: { provider: "memory" },
      });
      const durableScope = {
        userId: `assisted-source-binding-${index}`,
        workspaceId: "explicit-disposition",
      };

      const result = await memory.remember({
        extractionStrategy: "llm-assisted",
        messages: [{ role: fixture.actualRole, content: "ordinary context" }],
        scope: { ...durableScope, sessionId: "teach" },
      });

      expect(result.accepted).toBe(fixture.expectedAccepted);
      expect((await memory.exportMemory({ scope: durableScope })).durable.facts)
        .toHaveLength(fixture.expectedAccepted);
    }
  });

  it("rejects assisted candidates that claim any system source", async () => {
    let assistedInput: readonly { content: string; role: string }[] = [];
    const memory = createGoodMemory({
      adapters: {
        assistedExtractor: {
          async extract(input) {
            assistedInput = input.messages;
            return {
              candidates: [{
                id: "assisted-secondary-system",
                kindHint: "fact" as const,
                explicitness: "explicit" as const,
                content: "system secret=ALPHA",
                sourceMessageIndex: 1,
                sourceMessageIndexes: [0],
                sourceRole: "user",
              }],
              ignoredMessageCount: 0,
            };
          },
        },
        documentStore: createInMemoryDocumentStore(),
        sessionStore: createInMemorySessionStore(),
      },
      storage: { provider: "memory" },
    });
    const durableScope = {
      userId: "assisted-secondary-system",
      workspaceId: "explicit-disposition",
    };

    const result = await memory.remember({
      extractionStrategy: "llm-assisted",
      messages: [
        { role: "system", content: "system secret=ALPHA" },
        { role: "user", content: "ordinary context" },
        { role: "assistant", content: "private assistant detail" },
      ],
      scope: { ...durableScope, sessionId: "teach" },
    });

    expect(result.accepted).toBe(0);
    expect(assistedInput.map(({ content }) => content)).toEqual([
      "",
      "ordinary context",
      "",
    ]);
    expect((await memory.exportMemory({ scope: durableScope })).durable.facts)
      .toEqual([]);
  });

  it("does not let annotations or policy redaction reopen an opt-out source", async () => {
    const annotation = {
      confirmed: true,
      kindHint: "reference" as const,
      messageIndex: 0,
      metadataPatch: {
        referenceKind: "source_of_truth" as const,
        referencePointer: "docs/secret.md",
      },
      remember: "always" as const,
    };
    const memories = [
      {
        annotations: [annotation],
        memory: createGoodMemory({ storage: { provider: "memory" } }),
      },
      {
        memory: createGoodMemory({
          policy: {
            redact(candidate) {
              return {
                ...candidate,
                content: "docs/secret.md",
                kindHint: "reference" as const,
                metadata: {
                  referenceKind: "source_of_truth" as const,
                  referencePointer: "docs/secret.md",
                },
              };
            },
          },
          storage: { provider: "memory" },
        }),
      },
    ] as const;

    for (const [index, fixture] of memories.entries()) {
      const durableScope = {
        userId: `opt-out-downstream-${index}`,
        workspaceId: "explicit-disposition",
      };

      await fixture.memory.remember({
        ...("annotations" in fixture
          ? { annotations: [...fixture.annotations] }
          : {}),
        extractionStrategy: "rules-only",
        messages: [{
          role: "user",
          content: "Do not remember that use docs/secret.md as the source of truth",
        }],
        scope: { ...durableScope, sessionId: "teach" },
      });
      const exported = await fixture.memory.exportMemory({ scope: durableScope });

      expect(exported.durable.facts).toEqual([]);
      expect(exported.durable.references).toEqual([]);
      expect(exported.durable.feedback).toEqual([
        expect.objectContaining({ kind: "dont" }),
      ]);
    }
  });

  it("keeps policy redaction active for ordinary facts beside an opt-out", async () => {
    const memory = createGoodMemory({
      policy: {
        redact(candidate) {
          return {
            ...candidate,
            kindHint: "noise",
          };
        },
      },
      storage: { provider: "memory" },
    });
    const durableScope = {
      userId: "compound-opt-out-policy",
      workspaceId: "explicit-disposition",
    };

    const result = await memory.remember({
      extractionStrategy: "rules-only",
      messages: [{
        role: "user",
        content:
          "Remember that editor=Neovim; do not remember project code=Tachikoma",
      }],
      scope: { ...durableScope, sessionId: "teach" },
    });
    const exported = await memory.exportMemory({ scope: durableScope });

    expect(result.accepted).toBe(1);
    expect(exported.durable.facts).toEqual([]);
    expect(exported.durable.feedback).toEqual([
      expect.objectContaining({ kind: "dont" }),
    ]);
  });

  it("lets an explicit opt-out win over a positive fact for the same target", async () => {
    const fixtures = [
      ["en-US", "Remember that project code=Tachikoma; do not remember project code=Tachikoma"],
      ["zh-CN", "请记住项目代号=Tachikoma；不要记住项目代号=Tachikoma"],
      ["fr-FR", "Souviens-toi : code projet=Tachikoma ; ne mémorise pas code projet=Tachikoma"],
      ["es-ES", "Recuerda: código de proyecto=Tachikoma; no recuerdes código de proyecto=Tachikoma"],
      ["ja-JP", "覚えておいて：プロジェクトコード=Tachikoma；プロジェクトコード=Tachikomaは覚えないでください"],
      ["ko-KR", "기억해 주세요: 프로젝트 코드=Tachikoma; 프로젝트 코드=Tachikoma를 기억하지 마세요"],
    ] as const;

    for (const [locale, content] of fixtures) {
      const memory = createGoodMemory({ storage: { provider: "memory" } });
      const durableScope = {
        userId: `same-target-opt-out-${locale}`,
        workspaceId: "explicit-disposition",
      };

      const result = await memory.remember({
        extractionStrategy: "rules-only",
        locale,
        messages: [{ role: "user", content }],
        scope: { ...durableScope, sessionId: "teach" },
      });
      const exported = await memory.exportMemory({ scope: durableScope });

      expect(result.accepted).toBe(1);
      expect(exported.durable.facts).toEqual([]);
      expect(exported.durable.feedback).toEqual([
        expect.objectContaining({ kind: "dont" }),
      ]);
    }

    const memory = createGoodMemory({ storage: { provider: "memory" } });
    const durableScope = {
      userId: "same-target-opt-out-messages",
      workspaceId: "explicit-disposition",
    };
    const result = await memory.remember({
      extractionStrategy: "rules-only",
      messages: [
        { role: "user", content: "Remember that project code=Tachikoma" },
        { role: "user", content: "Do not remember project code=Tachikoma" },
      ],
      scope: { ...durableScope, sessionId: "teach" },
    });

    expect(result.accepted).toBe(1);
    expect((await memory.exportMemory({ scope: durableScope })).durable.facts)
      .toEqual([]);
  });

  it("does not treat the assignment key alone as an opt-out target", async () => {
    const memory = createGoodMemory({ storage: { provider: "memory" } });
    const durableScope = {
      userId: "different-value-opt-out",
      workspaceId: "explicit-disposition",
    };

    const result = await memory.remember({
      extractionStrategy: "rules-only",
      messages: [{
        role: "user",
        content:
          "Remember that project code=GITS; do not remember project code=Tachikoma",
      }],
      scope: { ...durableScope, sessionId: "teach" },
    });
    const exported = await memory.exportMemory({ scope: durableScope });

    expect(result.accepted).toBe(2);
    expect(exported.durable.facts).toEqual([
      expect.objectContaining({ content: "project code=GITS" }),
    ]);
    expect(exported.durable.feedback).toEqual([
      expect.objectContaining({ kind: "dont" }),
    ]);
  });

  it("does not let policy redaction reopen an exact opt-out target", async () => {
    const memory = createGoodMemory({
      policy: {
        redact(candidate) {
          return candidate.kindHint === "fact" &&
              candidate.content === "project code=GITS"
            ? { ...candidate, content: "project code=Tachikoma" }
            : candidate;
        },
      },
      storage: { provider: "memory" },
    });
    const durableScope = {
      userId: "policy-reopened-opt-out-target",
      workspaceId: "explicit-disposition",
    };

    const result = await memory.remember({
      extractionStrategy: "rules-only",
      messages: [{
        role: "user",
        content:
          "Remember that project code=GITS; do not remember project code=Tachikoma",
      }],
      scope: { ...durableScope, sessionId: "teach" },
    });
    const exported = await memory.exportMemory({ scope: durableScope });

    expect(result.accepted).toBe(1);
    expect(exported.durable.facts).toEqual([]);
    expect(exported.durable.feedback).toEqual([
      expect.objectContaining({ kind: "dont" }),
    ]);
  });

  it("blocks an assisted fact that matches an opt-out-only target", async () => {
    const memory = createGoodMemory({
      adapters: {
        assistedExtractor: {
          async extract() {
            return {
              candidates: [{
                id: "assisted-opt-out-target",
                kindHint: "fact" as const,
                explicitness: "explicit" as const,
                content: "project code=Tachikoma",
                sourceMessageIndex: 1,
                sourceRole: "user" as const,
              }],
              ignoredMessageCount: 0,
            };
          },
        },
        documentStore: createInMemoryDocumentStore(),
        sessionStore: createInMemorySessionStore(),
      },
      storage: { provider: "memory" },
    });
    const durableScope = {
      userId: "assisted-opt-out-target",
      workspaceId: "explicit-disposition",
    };

    const result = await memory.remember({
      extractionStrategy: "llm-assisted",
      messages: [
        { role: "user", content: "Do not remember project code=Tachikoma" },
        { role: "user", content: "ordinary context" },
      ],
      scope: { ...durableScope, sessionId: "teach" },
    });
    const exported = await memory.exportMemory({ scope: durableScope });

    expect(result.accepted).toBe(1);
    expect(exported.durable.facts).toEqual([]);
    expect(exported.durable.feedback).toEqual([
      expect.objectContaining({ kind: "dont" }),
    ]);
  });

  it("keeps valid compound facts while annotations cannot reopen an opt-out clause", async () => {
    const memory = createGoodMemory({ storage: { provider: "memory" } });
    const durableScope = {
      userId: "compound-opt-out-annotation",
      workspaceId: "explicit-disposition",
    };

    await memory.remember({
      annotations: [{
        confirmed: true,
        kindHint: "reference",
        messageIndex: 0,
        metadataPatch: {
          referenceKind: "source_of_truth",
          referencePointer: "docs/secret.md",
        },
        remember: "always",
      }],
      extractionStrategy: "rules-only",
      messages: [{
        role: "user",
        content:
          "Remember two things: editor=Neovim; do not remember that use docs/secret.md as the source of truth",
      }],
      scope: { ...durableScope, sessionId: "teach" },
    });
    const exported = await memory.exportMemory({ scope: durableScope });

    expect(exported.durable.facts).toEqual([
      expect.objectContaining({ content: "editor=Neovim" }),
    ]);
    expect(exported.durable.references).toEqual([]);
    expect(exported.durable.feedback).toEqual([
      expect.objectContaining({ kind: "dont" }),
    ]);
  });

  it("splits conjunctions only when they introduce an opt-out clause", async () => {
    const fixtures = [
      ["en-US", "Remember that editor=Neovim and do not remember project code=Tachikoma", "editor=Neovim"],
      ["zh-CN", "请记住编辑器=Neovim而且不要记住项目代号=Tachikoma", "编辑器=Neovim"],
      ["fr-FR", "Souviens-toi : éditeur=Neovim et ne mémorise pas code=Tachikoma", "éditeur=Neovim"],
      ["es-ES", "Recuerda: editor=Neovim y no recuerdes código=Tachikoma", "editor=Neovim"],
      ["ja-JP", "覚えておいて：エディタ=Neovimそしてプロジェクトコード=Tachikomaは覚えないでください", "エディタ=Neovim"],
      ["ko-KR", "기억해 주세요: 편집기=Neovim 그리고 프로젝트 코드=Tachikoma를 기억하지 마세요", "편집기=Neovim"],
      ["en-US", "Remember that editor=Neovim but do not remember project code=Tachikoma", "editor=Neovim"],
      ["zh-CN", "请记住编辑器=Neovim但是不要记住项目代号=Tachikoma", "编辑器=Neovim"],
      ["fr-FR", "Souviens-toi : éditeur=Neovim mais ne mémorise pas code=Tachikoma", "éditeur=Neovim"],
      ["es-ES", "Recuerda: editor=Neovim pero no recuerdes código=Tachikoma", "editor=Neovim"],
      ["ja-JP", "覚えておいて：エディタ=Neovimでもプロジェクトコード=Tachikomaは覚えないでください", "エディタ=Neovim"],
      ["ko-KR", "기억해 주세요: 편집기=Neovim 하지만 프로젝트 코드=Tachikoma를 기억하지 마세요", "편집기=Neovim"],
      ["en-US", "Remember that editor=Neovim, do not remember project code=Tachikoma", "editor=Neovim"],
      ["zh-CN", "请记住编辑器=Neovim，不要记住项目代号=Tachikoma", "编辑器=Neovim"],
    ] as const;

    for (const [locale, source, expectedFact] of fixtures) {
      const memory = createGoodMemory({ storage: { provider: "memory" } });
      const durableScope = {
        userId: `conjunction-opt-out-${locale}`,
        workspaceId: "explicit-disposition",
      };

      await memory.remember({
        extractionStrategy: "rules-only",
        locale,
        messages: [{ role: "user", content: source }],
        scope: { ...durableScope, sessionId: "teach" },
      });
      const exported = await memory.exportMemory({ scope: durableScope });

      expect(exported.durable.facts).toEqual([
        expect.objectContaining({ content: expectedFact }),
      ]);
      expect(exported.durable.feedback).toEqual([
        expect.objectContaining({ kind: "dont" }),
      ]);
    }
  });

  it("does not persist assignment confirmation questions", async () => {
    const fixtures = [
      ["en-US", "Remember that project code=Tachikoma?"],
      ["zh-CN", "请记住项目代号=Tachikoma？"],
      ["fr-FR", "Souviens-toi : code projet=Tachikoma ?"],
      ["es-ES", "Recuerda: código de proyecto=Tachikoma?"],
      ["ja-JP", "覚えておいて：プロジェクトコード=Tachikoma？"],
      ["ko-KR", "기억해 주세요: 프로젝트 코드=Tachikoma?"],
      ["en-US", "Remember that project code=Tachikoma — why?"],
      ["zh-CN", "请记住项目代号=Tachikoma——为什么？"],
      ["fr-FR", "Souviens-toi : code projet=Tachikoma — pourquoi ?"],
      ["es-ES", "Recuerda: código de proyecto=Tachikoma — por qué?"],
      ["ja-JP", "覚えておいて：プロジェクトコード=Tachikoma — なぜ？"],
      ["ko-KR", "기억해 주세요: 프로젝트 코드=Tachikoma — 왜?"],
      ["zh-CN", "请记住两件事：编辑器=Neovim；项目代号=Tachikoma是否正确"],
      ["zh-CN", "请记住项目代号=Tachikoma对不对"],
      ["zh-CN", "请记住项目代号=Tachikoma正确不正确"],
      ["zh-CN", "请记住项目代号=Tachikoma能不能用"],
      ["zh-CN", "请记住项目代号=Tachikoma可不可以用"],
      ["zh-CN", "请记住项目代号=Tachikoma可不可用"],
    ] as const;

    for (const [locale, source] of fixtures) {
      const memory = createGoodMemory({ storage: { provider: "memory" } });
      const durableScope = {
        userId: `assignment-confirmation-${locale}`,
        workspaceId: "explicit-disposition",
      };

      await memory.remember({
        extractionStrategy: "rules-only",
        locale,
        messages: [{ role: "user", content: source }],
        scope: { ...durableScope, sessionId: "teach" },
      });

      expect((await memory.exportMemory({ scope: durableScope })).durable.facts).toEqual([]);
    }
  });

  it("persists quoted natural-order literal questions only as assignment values", async () => {
    const fixtures = [
      ["en-US", "Remember that FAQ title=\"It fails for what reason?\"", "FAQ title"],
      ["zh-CN", "请记住FAQ标题=“失败原因是什么？”", "FAQ标题"],
      ["fr-FR", "Souviens-toi : titre FAQ=« Cela échoue pourquoi ? »", "titre FAQ"],
      ["es-ES", "Recuerda: título FAQ=«Falla por qué?»", "título FAQ"],
      ["ja-JP", "覚えておいて：FAQタイトル=「失敗するのはなぜ？」", "FAQタイトル"],
      ["ko-KR", "기억해 주세요: FAQ 제목=“실패하는 이유가 뭐야?”", "FAQ 제목"],
      ["en-US", "Remember that survey prompt=\"It fails for what reason?\"", "survey prompt"],
      ["zh-CN", "请记住错误消息=“失败原因是什么？”", "错误消息"],
      ["fr-FR", "Souviens-toi : invite enquête=« Cela échoue pourquoi ? »", "invite enquête"],
      ["es-ES", "Recuerda: pregunta de encuesta=«Falla por qué?»", "pregunta de encuesta"],
      ["ja-JP", "覚えておいて：アンケート質問=「失敗するのはなぜ？」", "アンケート質問"],
      ["ko-KR", "기억해 주세요: 설문 질문=“실패하는 이유가 뭐야?”", "설문 질문"],
    ] as const;

    for (const [locale, source, expectedField] of fixtures) {
      const memory = createGoodMemory({ storage: { provider: "memory" } });
      const durableScope = {
        userId: `natural-literal-question-${locale}`,
        workspaceId: "explicit-disposition",
      };

      const result = await memory.remember({
        extractionStrategy: "rules-only",
        locale,
        messages: [{ role: "user", content: source }],
        scope: { ...durableScope, sessionId: "teach" },
      });
      const exported = await memory.exportMemory({ scope: durableScope });

      expect(result.accepted).toBe(1);
      expect(exported.durable.facts).toHaveLength(1);
      expect(exported.durable.facts[0]?.content).toContain(`${expectedField}=`);
    }
  });
});
